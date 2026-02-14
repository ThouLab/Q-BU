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
import { computeMixedBBox, parseSubKey, subMinToWorldCenter, type SubKey } from "@/components/qbu/subBlocks";
import { DEFAULT_REF_SETTINGS, type ViewDir } from "@/components/qbu/settings";
import { DEFAULT_CUBE_COLOR } from "@/components/qbu/filamentColors";
import { readFileAsDataURL, splitThreeViewSheet, type RefImages } from "@/components/qbu/referenceUtils";
import { countComponents } from "@/components/qbu/printPrepUtils";
import { resolvePrintScale, type PrintScaleSetting } from "@/components/qbu/printScale";
import { decodeQbu, encodeQbu } from "@/components/qbu/qbuFile";

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

// v1.0.15+: print-order / print-draft JSON can be saved/downloaded as well.
// This format is also used for admin-side model_data snapshots.
type ProjectDataV4 = {
  version: 4;
  kind?: string;
  blocks: string[];
  supportBlocks?: string[];
  scaleSetting?: PrintScaleSetting;
  // optional UI state
  color?: string;
  edges?: boolean;
  // convenience fields (order snapshots)
  mmPerUnit?: number;
  maxSideMm?: number;
  mode?: string;
};

type ProjectData = ProjectDataV1 | ProjectDataV2 | ProjectDataV3 | ProjectDataV4;

function parseScaleSettingFromAny(obj: any): PrintScaleSetting | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const mode = (obj as any).mode;
  if (mode === "maxSide") {
    const mm = Number((obj as any).maxSideMm);
    if (Number.isFinite(mm) && mm > 0) return { mode: "maxSide", maxSideMm: mm };
  }
  if (mode === "blockEdge") {
    const mm = Number((obj as any).blockEdgeMm);
    if (Number.isFinite(mm) && mm > 0) return { mode: "blockEdge", blockEdgeMm: mm };
  }
  return undefined;
}

function parseProjectJSON(text: string): ProjectData | null {
  try {
    const obj = JSON.parse(text);
    if (!obj || typeof obj !== "object") return null;

    // v1-v4 (project file)
    if ((obj as any).version === 1 || (obj as any).version === 2 || (obj as any).version === 3 || (obj as any).version === 4) {
      if (!Array.isArray((obj as any).blocks)) return null;
      const blocks = (obj as any).blocks.filter((v: any) => typeof v === "string");

      if ((obj as any).version === 1) return { version: 1, blocks };

      const color = typeof (obj as any).color === "string" ? (obj as any).color : undefined;
      const edges = typeof (obj as any).edges === "boolean" ? (obj as any).edges : undefined;

      if ((obj as any).version === 2) return { version: 2, blocks, color, edges };
      if ((obj as any).version === 3) return { version: 3, blocks, color, edges };

      // v4: may include print supports and scale setting
      const supportBlocks = Array.isArray((obj as any).supportBlocks)
        ? (obj as any).supportBlocks.filter((v: any) => typeof v === "string")
        : undefined;
      const scaleSetting = parseScaleSettingFromAny((obj as any).scaleSetting);
      const kind = typeof (obj as any).kind === "string" ? (obj as any).kind : undefined;
      const mmPerUnit = Number.isFinite(Number((obj as any).mmPerUnit)) ? Number((obj as any).mmPerUnit) : undefined;
      const maxSideMm = Number.isFinite(Number((obj as any).maxSideMm)) ? Number((obj as any).maxSideMm) : undefined;
      const mode = typeof (obj as any).mode === "string" ? (obj as any).mode : undefined;
      return { version: 4, kind, blocks, supportBlocks, scaleSetting, color, edges, mmPerUnit, maxSideMm, mode };
    }

    // v1.0.15-δ2: unversioned print-order snapshot JSON (admin download)
    if (Array.isArray((obj as any).blocks)) {
      const blocks = (obj as any).blocks.filter((v: any) => typeof v === "string");
      const supportBlocks = Array.isArray((obj as any).supportBlocks)
        ? (obj as any).supportBlocks.filter((v: any) => typeof v === "string")
        : undefined;
      const scaleSetting = parseScaleSettingFromAny((obj as any).scaleSetting) ||
        parseScaleSettingFromAny({ mode: (obj as any).mode, maxSideMm: (obj as any).maxSideMm, blockEdgeMm: (obj as any).blockEdgeMm });
      const kind = typeof (obj as any).kind === "string" ? (obj as any).kind : "print_order";
      const mmPerUnit = Number.isFinite(Number((obj as any).mmPerUnit)) ? Number((obj as any).mmPerUnit) : undefined;
      const maxSideMm = Number.isFinite(Number((obj as any).maxSideMm)) ? Number((obj as any).maxSideMm) : undefined;
      const mode = typeof (obj as any).mode === "string" ? (obj as any).mode : undefined;
      return { version: 4, kind, blocks, supportBlocks, scaleSetting, mmPerUnit, maxSideMm, mode };
    }

    return null;
  } catch {
    return null;
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function uuid(): string {
  try {
    const c: any = (globalThis as any).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    // ignore
  }
  return "id-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
}

// 軽量・同期の安定ハッシュ（暗号学的強度は不要：分析用途）
function fnv1a64Hex(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

function computeModelFingerprint(baseKeys: Set<string>, supportKeys: Set<SubKey>): string {
  const base = Array.from(baseKeys).sort();
  const sup = Array.from(supportKeys).sort();
  const raw = `b:${base.join(",")}|s:${sup.join(",")}`;
  return `m1_${fnv1a64Hex(raw)}`;
}

export default function Builder() {
  const { track, trackNow } = useTelemetry();
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

  // 分析用：エディタ表示
  useEffect(() => {
    track("builder_open", { logged_in: Boolean(user) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const [prepScaleSetting, setPrepScaleSetting] = useState<PrintScaleSetting>({
    mode: "maxSide",
    maxSideMm: DEFAULT_TARGET_MM,
  });

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

  const downloadProject = async (baseName: string, opts?: { format?: "json" | "qbu"; password?: string }) => {
    if (!user) {
      requireLogin("保存するにはログインが必要です。");
      return;
    }

    const format = opts?.format || "json";

    track("project_save", {
      blocks: blocks.size,
      max_dim: bbox.maxDim,
      color: cubeColor,
      edges: showEdges,
    });

    const base = Array.from(blocks);

    // Local restore always keeps a JSON snapshot (regardless of download format)
    const restoreData: ProjectDataV2 = {
      version: 2,
      blocks: base,
      color: cubeColor,
      edges: showEdges,
    };

    // 同じ端末では「保存」で復元できる
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(restoreData));
    } catch {
      // ignore
    }

    // ドラフトも最新化
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...restoreData, updated_at: Date.now() }));
    } catch {
      // ignore
    }

    if (format === "qbu") {
      const payload: ProjectDataV4 = {
        version: 4,
        kind: "project",
        blocks: base,
        color: cubeColor,
        edges: showEdges,
      };
      const bytes = await encodeQbu(payload, { password: opts?.password, compress: true });
      track("project_save_download", { kind: "qbu" });
      // TSのlib.dom型の都合で BlobPart にキャスト
      downloadBlob(new Blob([bytes as any], { type: "application/octet-stream" }), `${baseName}.qbu`);
      return;
    }

    // Default: JSON (legacy)
    track("project_save_download", { kind: "json" });
    downloadBlob(new Blob([JSON.stringify(restoreData)], { type: "application/json" }), `${baseName}_project.json`);
  };

  const exportStlFromBlocks = (
    baseName: string,
    scaleSetting: PrintScaleSetting,
    baseKeys: Set<string>,
    supportKeys: Set<SubKey>,
    exportKind: "direct" | "print_prep" = "direct"
  ) => {
    if (!user) {
      requireLogin("保存するにはログインが必要です。");
      return;
    }

    const bboxNow = computeMixedBBox(baseKeys, supportKeys);
    const resolved = resolvePrintScale({
      bboxMaxDimWorld: bboxNow.maxDim,
      setting: scaleSetting,
      clampMaxSideMm: { min: 10, max: 300 },
      clampBlockEdgeMm: { min: 0.1, max: 500 },
    });

    // 出力用の group（参照画像なし）
    const outRoot = new THREE.Group();

    // 中心を原点へ（mixed bbox）
    outRoot.position.set(-bboxNow.center.x, -bboxNow.center.y, -bboxNow.center.z);

    // STLの単位=mmとして出力するため、world unit を mmPerUnit 倍する
    const s = resolved.mmPerUnit;
    outRoot.scale.set(s, s, s);

    const export_id = uuid();
    const model_fingerprint = computeModelFingerprint(baseKeys, supportKeys);

    // 重要イベント：取りこぼし防止のため即flush
    trackNow("stl_export", {
      export_id,
      export_kind: exportKind,
      model_fingerprint,
      block_count: baseKeys.size,
      support_block_count: supportKeys.size,
      bbox_max_dim_world: bboxNow.maxDim,
      scale_mode: resolved.mode,
      max_side_mm: resolved.maxSideMm,
      mm_per_unit: resolved.mmPerUnit,
      warn_too_large: Boolean(resolved.warnTooLarge),
      name: baseName,
    });

    const outCubes = new THREE.Group();
    outRoot.add(outCubes);

    const geoBase = new THREE.BoxGeometry(1, 1, 1);
    const geoSupport = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color("#ffffff") });

    // base cubes
    for (const k of baseKeys) {
      const c = parseKey(k);
      const mesh = new THREE.Mesh(geoBase, mat);
      mesh.position.set(c.x, c.y, c.z);
      outCubes.add(mesh);
    }

    // half-size support cubes
    for (const sk of supportKeys) {
      const c = subMinToWorldCenter(parseSubKey(sk));
      const mesh = new THREE.Mesh(geoSupport, mat);
      mesh.position.set(c.x, c.y, c.z);
      outCubes.add(mesh);
    }

    outRoot.updateMatrixWorld(true);

    const exporter = new STLExporter();
    const stl = exporter.parse(outRoot, { binary: true }) as ArrayBuffer;

    track("project_save_download", { kind: "stl", max_side_mm: resolved.maxSideMm, mode: resolved.mode });
    downloadBlob(new Blob([stl], { type: "model/stl" }), `${baseName}.stl`);

    geoBase.dispose();
    geoSupport.dispose();
    mat.dispose();
  };

  const exportStlDirect = (baseName: string, scaleSetting: PrintScaleSetting) => {
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

    exportStlFromBlocks(baseName, scaleSetting, blocks, new Set(), "direct");
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

    // QBU packaged file (.qbu)
    if (file.name.toLowerCase().endsWith(".qbu")) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        // First try without prompting (works for non-password files / default passphrase).
        let dec = await decodeQbu(bytes, { password: "" });
        if (!dec.ok) {
          let password = "";
          try {
            password = window.prompt("QBUファイルのパスワード（未設定なら空欄）") || "";
          } catch {
            // ignore
          }
          dec = await decodeQbu(bytes, { password });
        }
        if (!dec.ok) {
          window.alert(`QBUの読み込みに失敗しました: ${dec.error}`);
          return;
        }

        const data = parseProjectJSON(JSON.stringify(dec.payload));
        if (!data) {
          window.alert("QBUの中身を解析できませんでした。（形式が未対応）");
          return;
        }

        track("project_load", {
          ext: "qbu",
          size: file.size,
          version: data.version,
          blocks: data.blocks.length,
          qbu_encrypted: dec.encrypted,
          qbu_compressed: dec.compressed,
        });

        const next = new Set<string>();
        for (const k of data.blocks) next.add(k);
        if (next.size === 0) next.add(keyOf({ x: 0, y: 0, z: 0 }));
        setBlocks(next);

        // v2+：色・エッジ
        if (data.version >= 2) {
          if (typeof (data as any).color === "string") setCubeColor((data as any).color);
          if (typeof (data as any).edges === "boolean") setShowEdges((data as any).edges);
        }

        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
          localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...(data as any), updated_at: Date.now() }));
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
      return;
    }

    // JSON → プロジェクト/印刷データ読み込み
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

        // v2+：色・エッジ
        if (data.version >= 2) {
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

  const requestPrintFlow = (
    baseName: string,
    scaleSetting: PrintScaleSetting,
    baseKeys: Set<string>,
    supportKeys: Set<SubKey>
  ) => {
    // ひとまず“印刷依頼ページへ遷移”できるところまで用意
    // 実決済（GooglePay）は /print 側で Stripe 等の設定が必要
    const bboxNow = computeMixedBBox(baseKeys, supportKeys);
    const resolved = resolvePrintScale({
      bboxMaxDimWorld: bboxNow.maxDim,
      setting: scaleSetting,
      clampMaxSideMm: { min: 10, max: 300 },
      clampBlockEdgeMm: { min: 0.1, max: 500 },
    });

    const finalSetting: PrintScaleSetting =
      resolved.mode === "maxSide"
        ? { mode: "maxSide", maxSideMm: resolved.maxSideMm }
        : { mode: "blockEdge", blockEdgeMm: resolved.mmPerUnit };

    const modelFingerprint = computeModelFingerprint(baseKeys, supportKeys);

    track("print_request_start", {
      model_fingerprint: modelFingerprint,
      block_count: baseKeys.size,
      support_block_count: supportKeys.size,
      max_side_mm: resolved.maxSideMm,
      mm_per_unit: resolved.mmPerUnit,
      scale_mode: resolved.mode,
    });

    try {
      sessionStorage.setItem(
        PRINT_DRAFT_KEY,
        JSON.stringify({
          baseName,
          modelFingerprint,
          // legacy (print/page.tsx v1 expects targetMm)
          targetMm: resolved.maxSideMm,
          // v1.0.14+ (scale toggle)
          scaleSetting: finalSetting,
          // backward compatible field name (print/page.tsx expects `blocks`)
          blocks: Array.from(baseKeys),
          // v1.0.14+ (0.5 supports)
          supportBlocks: Array.from(supportKeys),
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
        onSaveProject={(name, opts) => {
          void downloadProject(name, opts);
          setSaveOpen(false);
        }}
        onExportStl={(name, setting) => {
          exportStlDirect(name, setting);
          setSaveOpen(false);
        }}
        onOpenPrintPrep={(name, setting) => {
          if (!user) {
            requireLogin("保存するにはログインが必要です。");
            return;
          }
          track("print_prep_open", {
            blocks: blocks.size,
            max_dim: bbox.maxDim,
          });
          setPrepName(name);
          setPrepScaleSetting(setting);
          setPrepOpen(true);
          setSaveOpen(false);
        }}
      />

      <PrintPrepModal
        open={prepOpen}
        baseName={prepName}
        scaleSetting={prepScaleSetting}
        baseBlocks={blocks}
        onClose={() => setPrepOpen(false)}
        onExport={(name, setting, baseKeys, supportKeys) => {
          exportStlFromBlocks(name, setting, baseKeys, supportKeys, "print_prep");
          setPrepOpen(false);
        }}
        onRequestPrint={(name, setting, baseKeys, supportKeys) => {
          requestPrintFlow(name, setting, baseKeys, supportKeys);
        }}
      />
    </div>
  );
}
