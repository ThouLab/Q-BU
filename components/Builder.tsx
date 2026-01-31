"use client";

import React, { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

import VoxelEditor from "@/components/qbu/VoxelEditor";
import VoxelPreview from "@/components/qbu/VoxelPreview";
import SaveModal from "@/components/qbu/SaveModal";
import PrintPrepModal from "@/components/qbu/PrintPrepModal";
import { useTelemetry } from "@/components/telemetry/TelemetryProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { computeBBox, keyOf, parseKey } from "@/components/qbu/voxelUtils";
import { DEFAULT_REF_SETTINGS, type ViewDir } from "@/components/qbu/settings";
import { DEFAULT_CUBE_COLOR } from "@/components/qbu/filamentColors";
import { readFileAsDataURL, splitThreeViewSheet, type RefImages } from "@/components/qbu/referenceUtils";
import { countComponents } from "@/components/qbu/printPrepUtils";

const STORAGE_KEY = "qbu_project_v1";
const DRAFT_KEY = "qbu_draft_v2";
const PENDING_SAVE_KEY = "qbu_pending_save_v1";
const PRINT_DRAFT_KEY = "qbu_print_draft_v1";
const DEFAULT_TARGET_MM = 50; // 5cm

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type ProjectDataV1 = {
  version: 1;
  blocks: string[];
};

type ProjectDataV2 = {
  version: 2;
  blocks: string[];
  color?: string;
  edges?: boolean;
};

type ProjectDataV3 = {
  version: 3;
  blocks: string[];
  // v3 には connector 等が入っている可能性があるが、ここでは無視する
  color?: string;
  edges?: boolean;
};

type ProjectData = ProjectDataV1 | ProjectDataV2 | ProjectDataV3;

function parseProjectJSON(text: string): ProjectData | null {
  try {
    const obj = JSON.parse(text);
    if (!obj || typeof obj !== "object") return null;
    if (obj.version !== 1 && obj.version !== 2 && obj.version !== 3) return null;
    if (!Array.isArray(obj.blocks)) return null;

    const blocks = obj.blocks.filter((v: any) => typeof v === "string");

    if (obj.version === 1) return { version: 1, blocks };

    const color = typeof (obj as any).color === "string" ? (obj as any).color : undefined;
    const edges = typeof (obj as any).edges === "boolean" ? (obj as any).edges : undefined;

    if (obj.version === 2) return { version: 2, blocks, color, edges };

    // v3
    return { version: 3, blocks, color, edges };
  } catch {
    return null;
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function Builder() {
  const { track } = useTelemetry();
  const { user } = useAuth();

  const requireLogin = (message: string) => {
    // AccountFab を開く
    try {
      window.dispatchEvent(new CustomEvent("qbu:open-login", { detail: { message } }));
    } catch {
      // ignore
    }
  };

  // 少なくとも1個は置いておく（操作の入口）
  const [blocks, setBlocks] = useState<Set<string>>(() => new Set([keyOf({ x: 0, y: 0, z: 0 })]));
  const bbox = useMemo(() => computeBBox(blocks), [blocks]);

  // 左：プレビュー（閉じられる）
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDir, setPreviewDir] = useState<ViewDir>("front");

  // 見た目（単色）
  const [cubeColor, setCubeColor] = useState<string>(DEFAULT_CUBE_COLOR);
  const [showEdges, setShowEdges] = useState<boolean>(true);

  // 3面図（参照画像）
  const [refImages, setRefImages] = useState<RefImages>({});
  const [refSettings, setRefSettings] = useState(DEFAULT_REF_SETTINGS);
  const hasRefs = Boolean(refImages.front || refImages.side || refImages.top);

  // 編集カメラ（最初は右上から）
  const [yawIndex, setYawIndex] = useState(1); // 45°
  const [pitchIndex, setPitchIndex] = useState(1); // +45°

  // 初回：保存済みがあれば復元（ドラフト優先）
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY) || localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = parseProjectJSON(raw);
      if (!parsed) return;

      const next = new Set<string>();
      for (const k of parsed.blocks) next.add(k);
      if (next.size === 0) next.add(keyOf({ x: 0, y: 0, z: 0 }));
      setBlocks(next);

      // v2/v3：色・エッジ
      if (parsed.version === 2 || parsed.version === 3) {
        if (typeof parsed.color === "string") setCubeColor(parsed.color);
        if (typeof parsed.edges === "boolean") setShowEdges(parsed.edges);
      }
    } catch {
      // ignore
    }
  }, []);

  // 編集中の状態は自動でドラフト保存（ログインでリロードされても消えない）
  useEffect(() => {
    const t = window.setTimeout(() => {
      const data: any = {
        version: 2,
        blocks: Array.from(blocks),
        color: cubeColor,
        edges: showEdges,
        updated_at: Date.now(),
      };
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
      } catch {
        // ignore
      }
    }, 320);
    return () => window.clearTimeout(t);
  }, [blocks, cubeColor, showEdges]);

  const clearAll = () => {
    track("project_reset", { before: blocks.size });
    setBlocks(new Set([keyOf({ x: 0, y: 0, z: 0 })]));
  };

  const [saveOpen, setSaveOpen] = useState(false);

  // 印刷用補完
  const [prepOpen, setPrepOpen] = useState(false);
  const [prepName, setPrepName] = useState("Q-BU");
  const [prepTargetMm, setPrepTargetMm] = useState(DEFAULT_TARGET_MM);

  // ログイン後に“保存画面を自動で開く”ための復元
  useEffect(() => {
    if (!user) return;
    try {
      const pending = sessionStorage.getItem(PENDING_SAVE_KEY);
      if (pending === "1") {
        sessionStorage.removeItem(PENDING_SAVE_KEY);
        setSaveOpen(true);
        track("save_modal_open_after_login");
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const openSaveFlow = () => {
    track("save_button_click", { logged_in: Boolean(user) });
    if (!user) {
      try {
        sessionStorage.setItem(PENDING_SAVE_KEY, "1");
      } catch {
        // ignore
      }
      requireLogin("保存するにはログインが必要です。（ログイン後に保存画面が開きます）");
      return;
    }
    setSaveOpen(true);
    track("save_modal_open");
  };

  const downloadProject = (baseName: string) => {
    if (!user) {
      requireLogin("保存するにはログインが必要です。");
      return;
    }

    track("project_save", {
      blocks: blocks.size,
      max_dim: bbox.maxDim,
      color: cubeColor,
      edges: showEdges,
    });

    const data: ProjectDataV2 = {
      version: 2,
      blocks: Array.from(blocks),
      color: cubeColor,
      edges: showEdges,
    };

    // 同じ端末では「保存」で復元できる
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // ignore
    }

    // ドラフトも最新化
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...data, updated_at: Date.now() }));
    } catch {
      // ignore
    }

    track("project_save_download", { kind: "json" });
    downloadBlob(new Blob([JSON.stringify(data)], { type: "application/json" }), `${baseName}_project.json`);
  };

  const exportStlFromBlocks = (baseName: string, targetMm: number, keys: Set<string>) => {
    if (!user) {
      requireLogin("保存するにはログインが必要です。");
      return;
    }

    const bboxNow = computeBBox(keys);

    // 出力用の group（参照画像なし）
    const outRoot = new THREE.Group();

    // 中心を原点へ
    outRoot.position.set(-bboxNow.center.x, -bboxNow.center.y, -bboxNow.center.z);

    // 指定mmに収まるようスケール（最大辺を targetMm に合わせる）
    const target = clamp(Math.round(targetMm || DEFAULT_TARGET_MM), 10, 300);
    const s = target / Math.max(1, bboxNow.maxDim);
    outRoot.scale.set(s, s, s);

    track("project_export_stl", {
      blocks: keys.size,
      max_dim: bboxNow.maxDim,
      target_mm: target,
      scale: s,
    });

    const outCubes = new THREE.Group();
    outRoot.add(outCubes);

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color("#ffffff") });

    for (const k of keys) {
      const c = parseKey(k);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(c.x, c.y, c.z);
      outCubes.add(mesh);
    }

    outRoot.updateMatrixWorld(true);

    const exporter = new STLExporter();
    const stl = exporter.parse(outRoot, { binary: true }) as ArrayBuffer;

    track("project_save_download", { kind: "stl", target_mm: target });
    downloadBlob(new Blob([stl], { type: "model/stl" }), `${baseName}.stl`);

    geo.dispose();
    mat.dispose();
  };

  const exportStlDirect = (baseName: string, targetMm: number) => {
    if (!user) {
      requireLogin("保存するにはログインが必要です。");
      return;
    }

    const parts = countComponents(blocks);
    if (parts > 1) {
      const ok = window.confirm(
        `モデルが複数のパーツに分かれています（${parts}個）。\n` +
          `通常のSTLだと、印刷時にバラバラになる可能性があります。\n\n` +
          `続行しますか？（おすすめ:「印刷用にSTLを書き出す」）`
      );
      if (!ok) return;
    }

    exportStlFromBlocks(baseName, targetMm, blocks);
  };

  const handleImportThreeView = async (file: File) => {
    try {
      const dataUrl = await readFileAsDataURL(file);
      const parts = await splitThreeViewSheet(dataUrl, "auto");
      setRefImages(parts);

      const ext = file.name.includes(".") ? file.name.split(".").pop()?.slice(0, 12) : "";
      track("ref_import", {
        ext,
        size: file.size,
        type: file.type,
      });

      // パラメータは自動（ユーザーは迷わない）
      const autoSize = Math.max(12, Math.round(bbox.maxDim + 8));
      setRefSettings((p) => ({
        ...p,
        enabled: true,
        showInPreview: true,
        opacity: 0.35,
        size: autoSize,
        margin: 1.5,
      }));
    } catch (e) {
      console.error(e);
      alert("画像の読み込みに失敗しました。");
    }
  };

  const clearRefs = () => {
    track("ref_clear");
    setRefImages({});
    setRefSettings((p) => ({ ...p, enabled: false }));
  };

  // モデルの大きさが変わったら、3面図のサイズだけ自動追従
  useEffect(() => {
    if (!hasRefs || !refSettings.enabled) return;
    const autoSize = Math.max(12, Math.round(bbox.maxDim + 8));
    setRefSettings((p) => {
      if (p.size === autoSize && p.margin === 1.5) return p;
      return { ...p, size: autoSize, margin: 1.5 };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bbox.maxDim, hasRefs]);

  const handleDroppedFile = async (file: File) => {
    // 画像 → 3面図
    if (file.type.startsWith("image/")) {
      await handleImportThreeView(file);
      return;
    }

    // JSON → プロジェクト読み込み
    if (file.name.toLowerCase().endsWith(".json")) {
      try {
        const text = await file.text();
        const data = parseProjectJSON(text);
        if (!data) return;

        const ext = file.name.includes(".") ? file.name.split(".").pop()?.slice(0, 12) : "";
        track("project_load", { ext, size: file.size, version: data.version, blocks: data.blocks.length });

        const next = new Set<string>();
        for (const k of data.blocks) next.add(k);
        if (next.size === 0) next.add(keyOf({ x: 0, y: 0, z: 0 }));
        setBlocks(next);

        // v2/v3：色・エッジ
        if (data.version === 2 || data.version === 3) {
          if (typeof (data as any).color === "string") setCubeColor((data as any).color);
          if (typeof (data as any).edges === "boolean") setShowEdges((data as any).edges);
        }

        // 保存も更新（ドラフトも更新して“ログインで消える”を防ぐ）
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
          localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...(data as any), updated_at: Date.now() }));
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    }
  };

  const requestPrintFlow = (baseName: string, targetMm: number, keys: Set<string>) => {
    // ひとまず“印刷依頼ページへ遷移”できるところまで用意
    // 実決済（GooglePay）は /print 側で Stripe 等の設定が必要
    try {
      sessionStorage.setItem(
        PRINT_DRAFT_KEY,
        JSON.stringify({
          name: baseName,
          target_mm: targetMm,
          blocks: Array.from(keys),
          created_at: Date.now(),
        })
      );
    } catch {
      // ignore
    }

    window.location.href = "/print";
  };

  const cubeCount = blocks.size;

  return (
    <div className="page">
      <header className="topHeader minimal">
        <div className="title">Q-BU!</div>
        <div className="headerRight">
          <button type="button" className="hbtn" onClick={openSaveFlow}>
            保存する
          </button>
        </div>
      </header>

      <main className="main">
        <div className={`workspace ${previewOpen ? "" : "previewClosed"}`}>
          {previewOpen && (
            <div className="previewPane">
              <VoxelPreview
                blocks={blocks}
                bbox={bbox}
                dir={previewDir}
                onDirChange={(d) => {
                  setPreviewDir(d);
                  track("preview_dir", { dir: d });
                }}
                onClose={() => {
                  setPreviewOpen(false);
                  track("preview_close");
                }}
                cubeColor={cubeColor}
                showEdges={showEdges}
                onImportThreeView={handleImportThreeView}
                hasRefs={hasRefs}
                onClearRefs={clearRefs}
                refImages={refImages}
                refSettings={refSettings}
                onFileDrop={handleDroppedFile}
              />
            </div>
          )}

          <div className="editorPane">
            <VoxelEditor
              blocks={blocks}
              setBlocks={setBlocks}
              yawIndex={yawIndex}
              pitchIndex={pitchIndex}
              setYawIndex={setYawIndex}
              setPitchIndex={setPitchIndex}
              previewOpen={previewOpen}
              onOpenPreview={() => {
                setPreviewOpen(true);
                track("preview_open");
              }}
              cubeCount={cubeCount}
              onClearAll={clearAll}
              cubeColor={cubeColor}
              setCubeColor={setCubeColor}
              showEdges={showEdges}
              setShowEdges={setShowEdges}
              refImages={refImages}
              refSettings={refSettings}
              onFileDrop={handleDroppedFile}
            />
          </div>
        </div>
      </main>

      <SaveModal
        open={saveOpen}
        onClose={() => {
          setSaveOpen(false);
          track("save_modal_close");
        }}
        maxDim={bbox.maxDim}
        defaultTargetMm={DEFAULT_TARGET_MM}
        onSaveProject={(name) => {
          downloadProject(name);
          setSaveOpen(false);
        }}
        onExportStl={(name, mm) => {
          exportStlDirect(name, mm);
          setSaveOpen(false);
        }}
        onOpenPrintPrep={(name, mm) => {
          if (!user) {
            requireLogin("保存するにはログインが必要です。");
            return;
          }
          setPrepName(name);
          setPrepTargetMm(mm);
          setPrepOpen(true);
          setSaveOpen(false);
        }}
      />

      <PrintPrepModal
        open={prepOpen}
        baseName={prepName}
        targetMm={prepTargetMm}
        baseBlocks={blocks}
        onClose={() => setPrepOpen(false)}
        onExport={(name, mm, keys) => {
          exportStlFromBlocks(name, mm, keys);
          setPrepOpen(false);
        }}
        onRequestPrint={(name, mm, keys) => {
          requestPrintFlow(name, mm, keys);
        }}
      />
    </div>
  );
}
