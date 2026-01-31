"use client";

import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { useTelemetry } from "@/components/telemetry/TelemetryProvider";

import { computeBBox, parseKey, type BBox } from "./voxelUtils";
import type { RefImages } from "./referenceUtils";
import type { RefSettings, ViewDir } from "./settings";

type PreviewThree = {
  renderer: any;
  scene: any;
  camera: any;

  root: any;
  cubesGroup: any;
  refsGroup: any;

  light: any;

  refPlanes: {
    front?: any;
    side?: any;
    top?: any;
  };
  refTextures: {
    front?: any;
    side?: any;
    top?: any;
  };
  refUrls: {
    front?: string;
    side?: string;
    top?: string;
  };

  // shared resources
  cubeGeo: any;
  cubeMat: any;
  edgeGeo: any;
  edgeMat: any;
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function pickEdgeStyle(hex: string) {
  const c = new THREE.Color(hex);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  if (lum < 0.45) {
    return { color: "#ffffff", opacity: 0.55 };
  }
  return { color: "#111827", opacity: 0.35 };
}

function makePixelTexture(url: string) {
  const tex = new THREE.TextureLoader().load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

function disposeObject3D(obj: any) {
  obj.traverse((o: any) => {
    const anyO = o as any;
    if (anyO.geometry) anyO.geometry.dispose?.();
    if (anyO.material) {
      if (Array.isArray(anyO.material)) anyO.material.forEach((m: any) => m.dispose?.());
      else anyO.material.dispose?.();
    }
  });
}

function computeHalfExtent(bbox: BBox, refImages: RefImages, refSettings: RefSettings) {
  const model = bbox.maxDim;
  if (!refSettings.enabled || !refSettings.showInPreview) return model / 2 + 2;

  const aspects: number[] = [];
  if (refImages.front) aspects.push(refImages.front.w / refImages.front.h);
  if (refImages.side) aspects.push(refImages.side.w / refImages.side.h);
  if (refImages.top) aspects.push(refImages.top.w / refImages.top.h);
  const maxAspect = aspects.length ? Math.max(...aspects) : 1;

  const refMax = refSettings.size * Math.max(1, maxAspect);
  const maxDim = Math.max(model, refMax);
  return maxDim / 2 + 2;
}

function applyPreviewCamera(camera: any, wrap: HTMLDivElement, dir: ViewDir, half: number) {
  const aspect = wrap.clientWidth / Math.max(1, wrap.clientHeight);
  camera.left = -half * aspect;
  camera.right = half * aspect;
  camera.top = half;
  camera.bottom = -half;
  camera.near = 0.1;
  camera.far = 1000;

  const dist = 60;
  camera.up.set(0, 1, 0);
  if (dir === "front") camera.position.set(0, 0, dist);
  if (dir === "back") camera.position.set(0, 0, -dist);
  if (dir === "right") camera.position.set(dist, 0, 0);
  if (dir === "left") camera.position.set(-dist, 0, 0);
  if (dir === "top") {
    camera.position.set(0, dist, 0);
    camera.up.set(0, 0, -1);
  }
  if (dir === "bottom") {
    camera.position.set(0, -dist, 0);
    camera.up.set(0, 0, 1);
  }

  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

function updateRefPlanes(t: PreviewThree, keys: Set<string>, refImages: RefImages, refSettings: RefSettings) {
  const bboxNow = computeBBox(keys);

  const setPlane = (
    slot: "front" | "side" | "top",
    img: RefImages["front"],
    rot: any,
    pos: any
  ) => {
    if (!refSettings.enabled || !refSettings.showInPreview || !img) {
      if (t.refPlanes[slot]) {
        t.refsGroup.remove(t.refPlanes[slot]!);
        disposeObject3D(t.refPlanes[slot]!);
        delete t.refPlanes[slot];
      }
      if (t.refTextures[slot]) {
        t.refTextures[slot]!.dispose();
        delete t.refTextures[slot];
        delete t.refUrls[slot];
      }
      return;
    }

    if (!t.refTextures[slot] || t.refUrls[slot] !== img.url) {
      if (t.refTextures[slot]) t.refTextures[slot]!.dispose();
      t.refTextures[slot] = makePixelTexture(img.url);
      t.refUrls[slot] = img.url;
    }

    if (!t.refPlanes[slot]) {
      const geo = new THREE.PlaneGeometry(1, 1);
      const mat = new THREE.MeshBasicMaterial({
        map: t.refTextures[slot],
        transparent: true,
        opacity: refSettings.opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const plane = new THREE.Mesh(geo, mat);
      plane.renderOrder = -1;
      t.refsGroup.add(plane);
      t.refPlanes[slot] = plane;
    }

    const plane = t.refPlanes[slot]!;
    const mat = plane.material as any;
    mat.map = t.refTextures[slot];
    mat.opacity = refSettings.opacity;
    mat.needsUpdate = true;

    const aspect = img.w / img.h;
    const height = Math.max(1, refSettings.size);
    const width = Math.max(1, height * aspect);
    plane.scale.set(width, height, 1);
    plane.rotation.copy(rot);
    plane.position.copy(pos);
    plane.visible = true;
  };

  const margin = Math.max(0, refSettings.margin);
  const center = bboxNow.center;
  setPlane("front", refImages.front, new THREE.Euler(0, 0, 0), new THREE.Vector3(center.x, center.y, bboxNow.min.z - margin));
  setPlane("side", refImages.side, new THREE.Euler(0, Math.PI / 2, 0), new THREE.Vector3(bboxNow.min.x - margin, center.y, center.z));
  setPlane("top", refImages.top, new THREE.Euler(-Math.PI / 2, 0, 0), new THREE.Vector3(center.x, bboxNow.min.y - margin, center.z));
}

function rebuildCubes(t: PreviewThree, keys: Set<string>, showEdges: boolean) {
  const bboxNow = computeBBox(keys);
  t.root.position.set(-bboxNow.center.x, -bboxNow.center.y, -bboxNow.center.z);

  // shared resourcesなのでdisposeしない
  t.cubesGroup.clear();

  for (const k of keys) {
    const c = parseKey(k);
    const mesh = new THREE.Mesh(t.cubeGeo, t.cubeMat);
    mesh.position.set(c.x, c.y, c.z);

    const edges = new THREE.LineSegments(t.edgeGeo, t.edgeMat);
    edges.name = "edges";
    edges.scale.set(1.01, 1.01, 1.01);
    edges.visible = showEdges;
    edges.renderOrder = 2;
    mesh.add(edges);

    t.cubesGroup.add(mesh);
  }
}

type Props = {
  blocks: Set<string>;
  bbox: BBox;
  dir: ViewDir;
  onDirChange: (dir: ViewDir) => void;
  onClose: () => void;

  // 見た目
  cubeColor: string;
  showEdges: boolean;

  // 3面図（参照）
  onImportThreeView: (file: File) => void | Promise<void>;
  hasRefs: boolean;
  onClearRefs: () => void;

  // ファイル（画像/プロジェクトjson）ドロップ
  onFileDrop?: (file: File) => void | Promise<void>;

  refImages: RefImages;
  refSettings: RefSettings;
};

export default function VoxelPreview({
  blocks,
  bbox,
  dir,
  onDirChange,
  onClose,
  cubeColor,
  showEdges,
  onImportThreeView,
  hasRefs,
  onClearRefs,
  onFileDrop,
  refImages,
  refSettings,
}: Props) {
  const { track } = useTelemetry();
  const trackRef = useRef(track);
  useEffect(() => {
    trackRef.current = track;
  }, [track]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const threeRef = useRef<PreviewThree | null>(null);
  const zoomRef = useRef(1);

  const half = useMemo(() => computeHalfExtent(bbox, refImages, refSettings), [bbox, refImages, refSettings]);

  const renderOnce = () => {
    const t = threeRef.current;
    const wrap = wrapRef.current;
    if (!t || !wrap) return;
    applyPreviewCamera(t.camera, wrap, dir, half * zoomRef.current);
    t.renderer.render(t.scene, t.camera);
  };

  const zoomIn = () => {
    zoomRef.current = clamp(zoomRef.current * 0.88, 0.35, 3.2);
    renderOnce();
    track("preview_zoom", { method: "button", dir: "in", zoom: Number(zoomRef.current.toFixed(3)) });
  };

  const zoomOut = () => {
    zoomRef.current = clamp(zoomRef.current * 1.12, 0.35, 3.2);
    renderOnce();
    track("preview_zoom", { method: "button", dir: "out", zoom: Number(zoomRef.current.toFixed(3)) });
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(new THREE.Color("#f7f8fb"), 1);
    wrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f7f8fb");

    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);

    const ambient = new THREE.AmbientLight(new THREE.Color("#ffffff"), 0.95);
    scene.add(ambient);
    const light = new THREE.DirectionalLight(new THREE.Color("#ffffff"), 1.15);
    light.position.set(10, 16, 12);
    scene.add(light);

    const grid = new THREE.GridHelper(60, 60, new THREE.Color("#d7dde8"), new THREE.Color("#eef2f7"));
    (grid.material as any).transparent = true;
    (grid.material as any).opacity = 0.7;
    grid.position.y = -6;
    scene.add(grid);

    const root = new THREE.Group();
    scene.add(root);
    const refsGroup = new THREE.Group();
    root.add(refsGroup);
    const cubesGroup = new THREE.Group();
    root.add(cubesGroup);

    // shared cube material (単色) + edge
    const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
    const cubeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(cubeColor),
      roughness: 0.55,
      metalness: 0.05,
    });
    const edgeGeo = new THREE.EdgesGeometry(cubeGeo);
    const edgeStyle = pickEdgeStyle(cubeColor);
    const edgeMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(edgeStyle.color),
      transparent: edgeStyle.opacity < 1,
      opacity: edgeStyle.opacity,
      depthTest: true,
    });

    threeRef.current = {
      renderer,
      scene,
      camera,
      root,
      cubesGroup,
      refsGroup,
      light,
      refPlanes: {},
      refTextures: {},
      refUrls: {},
      cubeGeo,
      cubeMat,
      edgeGeo,
      edgeMat,
    };

    rebuildCubes(threeRef.current, blocks, showEdges);
    updateRefPlanes(threeRef.current, blocks, refImages, refSettings);
    renderOnce();

    const onResize = () => {
      const t = threeRef.current;
      const w = wrapRef.current;
      if (!t || !w) return;
      t.renderer.setSize(w.clientWidth, w.clientHeight);
      renderOnce();
    };

    // レイアウト変更（プレビュー開閉など）でも追従できるようにする
    const ro = new ResizeObserver(() => onResize());
    ro.observe(wrap);

    let lastWheelLog = 0;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const factor = ev.deltaY > 0 ? 1.12 : 0.88;
      zoomRef.current = clamp(zoomRef.current * factor, 0.35, 3.2);
      renderOnce();

      const now = Date.now();
      if (now - lastWheelLog > 350) {
        lastWheelLog = now;
        trackRef.current("preview_zoom", { method: "wheel", zoom: Number(zoomRef.current.toFixed(3)) });
      }
    };
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      ro.disconnect();
      renderer.domElement.removeEventListener("wheel", onWheel);
      if (threeRef.current) {
        Object.values(threeRef.current.refTextures).forEach((tex) => tex?.dispose());
        Object.values(threeRef.current.refPlanes).forEach((p) => p && disposeObject3D(p));
        threeRef.current.cubeGeo?.dispose?.();
        threeRef.current.cubeMat?.dispose?.();
        threeRef.current.edgeGeo?.dispose?.();
        threeRef.current.edgeMat?.dispose?.();
      }
      renderer.dispose();
      wrap.removeChild(renderer.domElement);
      threeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // blocks / refs / view change
  useEffect(() => {
    const t = threeRef.current;
    if (!t) return;
    rebuildCubes(t, blocks, showEdges);
    updateRefPlanes(t, blocks, refImages, refSettings);
    renderOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  useEffect(() => {
    // エッジ表示切り替え
    const t = threeRef.current;
    if (!t) return;
    t.cubesGroup.traverse((o: any) => {
      if (o?.name === "edges") o.visible = showEdges;
    });
    renderOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEdges]);

  useEffect(() => {
    // 色変更 → shared material に反映
    const t = threeRef.current;
    if (!t) return;
    t.cubeMat.color.set(cubeColor);
    const edgeStyle = pickEdgeStyle(cubeColor);
    t.edgeMat.color.set(edgeStyle.color);
    t.edgeMat.opacity = edgeStyle.opacity;
    t.edgeMat.transparent = edgeStyle.opacity < 1;
    t.edgeMat.needsUpdate = true;
    renderOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cubeColor]);

  useEffect(() => {
    const t = threeRef.current;
    if (!t) return;
    updateRefPlanes(t, blocks, refImages, refSettings);
    renderOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refImages, refSettings]);

  useEffect(() => {
    renderOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, half]);

  const handleDrop = async (ev: React.DragEvent) => {
    if (!onFileDrop) return;
    ev.preventDefault();
    const f = ev.dataTransfer.files?.[0];
    if (f) await onFileDrop(f);
  };

  return (
    <div
      className="previewRoot"
      onDragOver={(e) => {
        if (!onFileDrop) return;
        e.preventDefault();
      }}
      onDrop={handleDrop}
    >
      <div className="previewCanvasWrap" ref={wrapRef} />

      {/* プレビュー内に操作をまとめる */}
      <div className="previewHud">
        <div className="previewHudRow">
          <div className="pvGroup">
            <button type="button" className={`pvChip ${dir === "front" ? "active" : ""}`} onClick={() => onDirChange("front")}>
              前
            </button>
            <button type="button" className={`pvChip ${dir === "back" ? "active" : ""}`} onClick={() => onDirChange("back")}>
              後
            </button>
            <button type="button" className={`pvChip ${dir === "left" ? "active" : ""}`} onClick={() => onDirChange("left")}>
              左
            </button>
            <button type="button" className={`pvChip ${dir === "right" ? "active" : ""}`} onClick={() => onDirChange("right")}>
              右
            </button>
            <button type="button" className={`pvChip ${dir === "top" ? "active" : ""}`} onClick={() => onDirChange("top")}>
              上
            </button>
            <button type="button" className={`pvChip ${dir === "bottom" ? "active" : ""}`} onClick={() => onDirChange("bottom")}>
              下
            </button>

            {/* ズーム */}
            <button type="button" className="pvChip" onClick={zoomIn} title="寄る">
              ＋
            </button>
            <button type="button" className="pvChip" onClick={zoomOut} title="引く">
              －
            </button>
          </div>

          <div className="pvGroup">
            <label className="pvChip">
              3面図
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onImportThreeView(f);
                  e.currentTarget.value = "";
                }}
                style={{ display: "none" }}
              />
            </label>
            {hasRefs && (
              <button type="button" className="pvChip" onClick={onClearRefs}>
                消す
              </button>
            )}
            <button type="button" className="pvChip" onClick={onClose}>
              閉じる
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
