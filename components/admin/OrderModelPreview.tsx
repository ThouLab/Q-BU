"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { parseKey } from "@/components/qbu/voxelUtils";
import { computeMixedBBox, parseSubKey, subMinToWorldCenter, SUPPORT_EDGE_WORLD } from "@/components/qbu/subBlocks";

type ModelData = {
  blocks: string[];
  supportBlocks: string[];
  scaleSetting?: any;
  mmPerUnit?: number;
  maxSideMm?: number;
  mode?: string;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function fmtYen(v: number): string {
  if (!Number.isFinite(v)) return "-";
  return Math.round(v).toLocaleString("ja-JP");
}

export default function OrderModelPreview(props: { orderId: string; modelName: string; modelData: ModelData | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => {
    const d = props.modelData;
    if (!d || !Array.isArray(d.blocks) || d.blocks.length === 0) return null;
    const blocks = d.blocks.filter((x) => typeof x === "string");
    const supportBlocks = Array.isArray(d.supportBlocks) ? d.supportBlocks.filter((x) => typeof x === "string") : [];

    // Cap for preview performance
    const maxPreview = 40000;
    const blocks2 = blocks.slice(0, maxPreview);
    const supports2 = supportBlocks.slice(0, maxPreview);

    const baseSet = new Set(blocks2);
    const supSet = new Set(supports2 as any);
    const bbox = computeMixedBBox(baseSet, supSet as any);
    return { blocks: blocks2, supportBlocks: supports2, bbox, truncated: blocks.length > blocks2.length || supportBlocks.length > supports2.length };
  }, [props.modelData]);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (!parsed) return;

    const canvas = canvasRef.current;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    renderer.setSize(w, h, false);

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);

    // Simple orbit controls (minimal implementation)
    const target = new THREE.Vector3(0, 0, 0);

    // Compute a comfortable camera distance based on bbox
    const maxDim = parsed.bbox.maxDim || 1;
    const dist = clamp(maxDim * 2.2, 3, 80);
    camera.position.set(dist, dist * 0.8, dist);
    camera.lookAt(target);

    const light1 = new THREE.DirectionalLight(0xffffff, 0.9);
    light1.position.set(5, 8, 6);
    scene.add(light1);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    // Grid + axes
    const grid = new THREE.GridHelper(60, 60, 0xe5e7eb, 0xe5e7eb);
    grid.position.y = -parsed.bbox.center.y;
    scene.add(grid);

    // Build instanced meshes
    const baseGeom = new THREE.BoxGeometry(1, 1, 1);
    const suppGeom = new THREE.BoxGeometry(SUPPORT_EDGE_WORLD, SUPPORT_EDGE_WORLD, SUPPORT_EDGE_WORLD);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0xbdbdbd, roughness: 0.9, metalness: 0.0 });
    const suppMat = new THREE.MeshStandardMaterial({ color: 0x60a5fa, roughness: 0.85, metalness: 0.0, transparent: true, opacity: 0.9 });

    const baseMesh = new THREE.InstancedMesh(baseGeom, baseMat, parsed.blocks.length);
    const tmp = new THREE.Object3D();
    const center = parsed.bbox.center;

    parsed.blocks.forEach((k, i) => {
      const c = parseKey(k);
      tmp.position.set(c.x - center.x, c.y - center.y, c.z - center.z);
      tmp.updateMatrix();
      baseMesh.setMatrixAt(i, tmp.matrix);
    });
    baseMesh.instanceMatrix.needsUpdate = true;
    scene.add(baseMesh);

    // NOTE: This project ships without full three type definitions.
    // Keep refs loosely typed to avoid build-time type errors.
    let suppMesh: any = null;
    if (parsed.supportBlocks.length > 0) {
      suppMesh = new THREE.InstancedMesh(suppGeom, suppMat, parsed.supportBlocks.length);
      parsed.supportBlocks.forEach((sk, i) => {
        const sc = parseSubKey(sk);
        // supportBlocks store the min-corner in 0.5-grid. For rendering we use the cube center.
        const wc = subMinToWorldCenter(sc);
        tmp.position.set(wc.x - center.x, wc.y - center.y, wc.z - center.z);
        tmp.updateMatrix();
        suppMesh!.setMatrixAt(i, tmp.matrix);
      });
      suppMesh.instanceMatrix.needsUpdate = true;
      scene.add(suppMesh);
    }

    // Basic mouse orbit
    let isDown = false;
    let lastX = 0;
    let lastY = 0;
    let theta = Math.atan2(camera.position.x, camera.position.z);
    let phi = Math.acos(camera.position.y / camera.position.length());

    const onDown = (e: MouseEvent) => {
      isDown = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = () => {
      isDown = false;
    };
    const onMove = (e: MouseEvent) => {
      if (!isDown) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      theta -= dx * 0.005;
      phi = clamp(phi - dy * 0.005, 0.15, Math.PI - 0.15);

      const r = camera.position.distanceTo(target);
      camera.position.set(
        target.x + r * Math.sin(phi) * Math.sin(theta),
        target.y + r * Math.cos(phi),
        target.z + r * Math.sin(phi) * Math.cos(theta)
      );
      camera.lookAt(target);
    };
    const onWheel = (e: WheelEvent) => {
      const r = camera.position.distanceTo(target);
      const nr = clamp(r + e.deltaY * 0.01, 1.5, 200);
      const dir = new THREE.Vector3().subVectors(camera.position, target).normalize();
      camera.position.copy(target.clone().add(dir.multiplyScalar(nr)));
      camera.lookAt(target);
    };

    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("mousemove", onMove);
    canvas.addEventListener("wheel", onWheel, { passive: true });

    let raf = 0;
    const animate = () => {
      raf = window.requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      const nw = Math.max(1, Math.floor(r.width));
      const nh = Math.max(1, Math.floor(r.height));
      renderer.setSize(nw, nh, false);
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
    });
    ro.observe(canvas);

    return () => {
      ro.disconnect();
      window.cancelAnimationFrame(raf);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("wheel", onWheel);
      baseGeom.dispose();
      suppGeom.dispose();
      baseMat.dispose();
      suppMat.dispose();
      renderer.dispose();
    };
  }, [parsed]);

  const downloadModelJson = async () => {
    if (!props.modelData) return;
    try {
      const blob = new Blob([JSON.stringify(props.modelData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `qbu_order_${props.orderId.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  };

  const downloadStl = async () => {
    setError("");
    if (!props.modelData) {
      setError("モデルデータが未保存のため、STLを再生成できません。v1.0.15-δ2以降の注文で利用できます。");
      return;
    }
    const blocks = Array.isArray(props.modelData.blocks) ? props.modelData.blocks : [];
    const supports = Array.isArray(props.modelData.supportBlocks) ? props.modelData.supportBlocks : [];
    const mmPerUnit = Number(props.modelData.mmPerUnit || 1);

    // Guard for huge models
    const total = blocks.length + supports.length;
    if (total > 8000) {
      setError("ブロック数が多いため、この画面でのSTL再生成は省略しました。エディタ側でSTL書き出ししてください。");
      return;
    }

    setBusy(true);
    try {
      const { STLExporter } = await import("three/examples/jsm/exporters/STLExporter.js");
      const exporter = new STLExporter();

      const scene = new THREE.Scene();
      const baseGeom = new THREE.BoxGeometry(1, 1, 1);
      const suppGeom = new THREE.BoxGeometry(SUPPORT_EDGE_WORLD, SUPPORT_EDGE_WORLD, SUPPORT_EDGE_WORLD);
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
      const group = new THREE.Group();
      scene.add(group);

      // center
      const bbox = computeMixedBBox(new Set(blocks), new Set(supports as any) as any);
      const center = bbox.center;

      const addMesh = (geom: any, x: number, y: number, z: number) => {
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(x - center.x, y - center.y, z - center.z);
        group.add(mesh);
      };

      for (const k of blocks) {
        const c = parseKey(k);
        addMesh(baseGeom, c.x, c.y, c.z);
      }
      for (const sk of supports) {
        const sc = parseSubKey(sk);
        const wc = subMinToWorldCenter(sc);
        addMesh(suppGeom, wc.x, wc.y, wc.z);
      }

      // Scale world units -> mm
      group.scale.set(mmPerUnit, mmPerUnit, mmPerUnit);

      // IMPORTANT: ensure matrixWorld is up-to-date before exporting.
      // Otherwise, all meshes may be exported at the origin (appears as a single cube).
      scene.updateMatrixWorld(true);

      // Use binary STL to keep file size reasonable.
      const stlBin = exporter.parse(scene, { binary: true }) as ArrayBuffer;
      const blob = new Blob([stlBin], { type: "model/stl" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `qbu_order_${props.orderId.slice(0, 8)}.stl`;
      a.click();
      URL.revokeObjectURL(url);

      baseGeom.dispose();
      suppGeom.dispose();
      mat.dispose();
    } catch (e: any) {
      setError(e?.message || "STL生成に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adminCard">
      <div className="adminCardLabel">モデルプレビュー</div>

      {!parsed ? (
        <div style={{ marginTop: 10, color: "#6b7280", fontSize: 13, lineHeight: 1.6 }}>
          この注文はモデルデータが保存されていないため、プレビューを表示できません。<br />
          <span style={{ fontSize: 12 }}>
            ※v1.0.15-δ2以降の注文では、依頼時のブロック情報を保存してこの欄に表示します。
          </span>
        </div>
      ) : (
        <>
          <div style={{ marginTop: 8, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, overflow: "hidden" }}>
            <canvas ref={canvasRef} style={{ width: "100%", height: 360, display: "block", background: "#fff" }} />
          </div>
          {parsed.truncated && (
            <div className="adminMuted" style={{ marginTop: 8 }}>
              ※プレビュー高速化のため表示ブロック数を制限しています。
            </div>
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            <button
              type="button"
              onClick={downloadStl}
              disabled={busy}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(0,0,0,0.18)",
                background: busy ? "#f3f4f6" : "#ecfccb",
                fontWeight: 900,
              }}
            >
              {busy ? "STL生成中..." : "STLをダウンロード"}
            </button>

            <button
              type="button"
              onClick={downloadModelJson}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(0,0,0,0.18)",
                background: "#fff",
                fontWeight: 800,
              }}
            >
              モデルJSONをダウンロード
            </button>
          </div>
          {error && <div style={{ marginTop: 8, color: "#b91c1c", fontWeight: 700, whiteSpace: "pre-wrap" }}>{error}</div>}
        </>
      )}
    </div>
  );
}
