"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { computeBBox, parseKey, keyOf, type Coord } from "./voxelUtils";
import { DEFAULT_BLOCK_COLOR } from "./filamentColors";

type PickedCube = {
  key: string;
  coord: Coord;
  color: string;
};

type ViewerThree = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  raycaster: THREE.Raycaster;
  mouse: THREE.Vector2;
  root: THREE.Group;
  cubesGroup: THREE.Group;
  selection: THREE.Mesh;

  cubeGeo: THREE.BoxGeometry;
  edgeGeo: THREE.EdgesGeometry;
  cubeMats: Map<string, THREE.MeshStandardMaterial>;
  edgeMats: Map<string, THREE.LineBasicMaterial>;

  anim: {
    yaw: number;
    pitch: number;
    baseRadius: number;
    zoom: number;
    center: Coord;
  };
};

const STEP = Math.PI / 4;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function pickEdgeStyle(hex: string) {
  const c = new THREE.Color(hex);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  if (lum < 0.45) return { color: "#ffffff", opacity: 0.55 };
  return { color: "#111827", opacity: 0.35 };
}

function normalizeHex(hex: string) {
  return String(hex || "").trim().toLowerCase();
}

function getCubeMat(t: ViewerThree, hex: string) {
  const key = normalizeHex(hex || DEFAULT_BLOCK_COLOR) || DEFAULT_BLOCK_COLOR;
  const cached = t.cubeMats.get(key);
  if (cached) return cached;
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(key),
    roughness: 0.55,
    metalness: 0.05,
  });
  t.cubeMats.set(key, mat);
  return mat;
}

function getEdgeMat(t: ViewerThree, cubeHex: string) {
  const style = pickEdgeStyle(cubeHex || DEFAULT_BLOCK_COLOR);
  const styleKey = `${style.color}_${String(style.opacity)}`;
  const cached = t.edgeMats.get(styleKey);
  if (cached) return cached;
  const mat = new THREE.LineBasicMaterial({
    color: new THREE.Color(style.color),
    transparent: true,
    opacity: style.opacity,
    depthTest: true,
  });
  t.edgeMats.set(styleKey, mat);
  return mat;
}

function disposeObject3D(obj: THREE.Object3D) {
  obj.traverse((o: any) => {
    if (o.geometry) o.geometry.dispose?.();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m: any) => m.dispose?.());
      else o.material.dispose?.();
    }
  });
}

type Props = {
  blocks: Set<string>;
  blockColors: Map<string, string>;
  showEdges?: boolean;
  onPickCube?: (picked: PickedCube) => void;
  style?: React.CSSProperties;
  /** Thumbnail capture etc. (keep default false for performance) */
  preserveDrawingBuffer?: boolean;
  /** Provides a function that returns the current canvas snapshot as a data URL. */
  onSnapshotReady?: (takeSnapshot: () => string | null) => void;
};

export default function ModVoxelViewer({
  blocks,
  blockColors,
  showEdges = true,
  onPickCube,
  style,
  preserveDrawingBuffer = false,
  onSnapshotReady,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const threeRef = useRef<ViewerThree | null>(null);

  const yawIndexRef = useRef(1);
  const pitchIndexRef = useRef(1);
  const blockColorsRef = useRef(blockColors);

  const [yawIndex, setYawIndex] = useState(1);
  const [pitchIndex, setPitchIndex] = useState(1);

  useEffect(() => {
    yawIndexRef.current = yawIndex;
  }, [yawIndex]);
  useEffect(() => {
    pitchIndexRef.current = pitchIndex;
  }, [pitchIndex]);
  useEffect(() => {
    blockColorsRef.current = blockColors;
  }, [blockColors]);

  const bbox = useMemo(() => computeBBox(blocks), [blocks]);

  const rebuild = () => {
    const t = threeRef.current;
    if (!t) return;

    // center
    t.root.position.set(-bbox.center.x, -bbox.center.y, -bbox.center.z);
    t.anim.center = { ...bbox.center };

    // clear
    t.cubesGroup.clear();

    for (const k of blocks) {
      const coord = parseKey(k);
      const col = blockColors.get(k) || DEFAULT_BLOCK_COLOR;
      const mesh = new THREE.Mesh(t.cubeGeo, getCubeMat(t, col));
      mesh.position.set(coord.x, coord.y, coord.z);
      mesh.userData.key = k;
      mesh.userData.coord = coord;
      mesh.userData.color = col;

      const edges = new THREE.LineSegments(t.edgeGeo, getEdgeMat(t, col));
      edges.name = "edges";
      edges.scale.set(1.01, 1.01, 1.01);
      edges.visible = showEdges;
      edges.renderOrder = 2;
      mesh.add(edges);

      t.cubesGroup.add(mesh);
    }
  };

  const applyCameraTarget = (y: number, p: number) => {
    const t = threeRef.current;
    const wrap = wrapRef.current;
    if (!t || !wrap) return;

    const radius = Math.max(8, t.anim.baseRadius);
    const iyaw = y * STEP;
    const ipitch = p * STEP;

    const cp = Math.cos(ipitch);
    const sp = Math.sin(ipitch);
    const sy = Math.sin(iyaw);
    const cy = Math.cos(iyaw);

    const r = radius * t.anim.zoom;
    t.camera.position.set(r * cp * sy, r * sp, r * cp * cy);
    t.camera.lookAt(0, 0, 0);

    t.camera.aspect = wrap.clientWidth / Math.max(1, wrap.clientHeight);
    t.camera.updateProjectionMatrix();
  };

  const renderOnce = () => {
    const t = threeRef.current;
    if (!t) return;
    t.renderer.render(t.scene, t.camera);
  };

  // init
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    renderer.domElement.style.touchAction = "none";
    wrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f7f8fb");

    const camera = new THREE.PerspectiveCamera(45, wrap.clientWidth / Math.max(1, wrap.clientHeight), 0.1, 2000);

    const ambient = new THREE.AmbientLight(new THREE.Color("#ffffff"), 0.9);
    scene.add(ambient);
    const light = new THREE.DirectionalLight(new THREE.Color("#ffffff"), 1.15);
    light.position.set(10, 16, 12);
    scene.add(light);

    const grid = new THREE.GridHelper(80, 80, new THREE.Color("#d7dde8"), new THREE.Color("#eef2f7"));
    (grid.material as any).transparent = true;
    (grid.material as any).opacity = 0.65;
    grid.position.y = -6;
    scene.add(grid);

    const root = new THREE.Group();
    scene.add(root);
    const cubesGroup = new THREE.Group();
    root.add(cubesGroup);

    // selection box
    const selGeo = new THREE.BoxGeometry(1.06, 1.06, 1.06);
    const selMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#f59e0b"),
      transparent: true,
      opacity: 0.22,
      wireframe: true,
      depthWrite: false,
    });
    const selection = new THREE.Mesh(selGeo, selMat);
    selection.visible = false;
    root.add(selection);

    const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
    const edgeGeo = new THREE.EdgesGeometry(cubeGeo);
    const cubeMats = new Map<string, THREE.MeshStandardMaterial>();
    const edgeMats = new Map<string, THREE.LineBasicMaterial>();

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const baseRadius = Math.max(10, bbox.maxDim * 1.6 + 6);
    const iyaw = yawIndex * STEP;
    const ipitch = pitchIndex * STEP;
    const cp = Math.cos(ipitch);
    const sp = Math.sin(ipitch);
    const sy = Math.sin(iyaw);
    const cy = Math.cos(iyaw);
    camera.position.set(baseRadius * cp * sy, baseRadius * sp, baseRadius * cp * cy);
    camera.lookAt(0, 0, 0);

    threeRef.current = {
      renderer,
      scene,
      camera,
      raycaster,
      mouse,
      root,
      cubesGroup,
      selection,
      cubeGeo,
      edgeGeo,
      cubeMats,
      edgeMats,
      anim: {
        yaw: iyaw,
        pitch: ipitch,
        baseRadius,
        zoom: 1,
        center: { ...bbox.center },
      },
    };

    if (onSnapshotReady) {
      onSnapshotReady(() => {
        const t = threeRef.current;
        if (!t) return null;
        try {
          t.renderer.render(t.scene, t.camera);
          return t.renderer.domElement.toDataURL("image/png");
        } catch {
          return null;
        }
      });
    }

    rebuild();
    applyCameraTarget(yawIndex, pitchIndex);
    renderOnce();

    const toNDC = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    };

    const pick = (clientX: number, clientY: number) => {
      const t = threeRef.current;
      if (!t) return;
      toNDC(clientX, clientY);
      t.raycaster.setFromCamera(t.mouse, t.camera);
      const hits = t.raycaster.intersectObjects(t.cubesGroup.children, false);
      if (!hits.length) {
        t.selection.visible = false;
        renderOnce();
        return;
      }
      const obj = hits[0]!.object as any;
      const key = obj?.userData?.key as string | undefined;
      const coord = obj?.userData?.coord as Coord | undefined;
      if (!key || !coord) return;

      const color = blockColorsRef.current.get(key) || DEFAULT_BLOCK_COLOR;

      t.selection.position.set(coord.x, coord.y, coord.z);
      t.selection.visible = true;
      renderOnce();

      onPickCube?.({ key, coord, color });
    };

    // pointer
    const onPointerDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      pick(ev.clientX, ev.clientY);
    };

    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const t = threeRef.current;
      if (!t) return;
      const factor = ev.deltaY > 0 ? 1.12 : 0.88;
      t.anim.zoom = clamp(t.anim.zoom * factor, 0.35, 3.2);
      applyCameraTarget(yawIndexRef.current, pitchIndexRef.current);
      renderOnce();
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    const ro = new ResizeObserver(() => {
      const t = threeRef.current;
      const w = wrapRef.current;
      if (!t || !w) return;
      t.renderer.setSize(w.clientWidth, w.clientHeight);
      applyCameraTarget(yawIndexRef.current, pitchIndexRef.current);
      renderOnce();
    });
    ro.observe(wrap);

    return () => {
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("wheel", onWheel);

      try {
        disposeObject3D(selection);
      } catch {
        // ignore
      }

      try {
        threeRef.current?.cubeGeo?.dispose?.();
        threeRef.current?.edgeGeo?.dispose?.();
        for (const m of threeRef.current?.cubeMats?.values?.() || []) m.dispose();
        for (const m of threeRef.current?.edgeMats?.values?.() || []) m.dispose();
      } catch {
        // ignore
      }

      renderer.dispose();
      if (wrap.contains(renderer.domElement)) wrap.removeChild(renderer.domElement);
      threeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // update camera on yaw/pitch
  useEffect(() => {
    applyCameraTarget(yawIndex, pitchIndex);
    renderOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yawIndex, pitchIndex]);

  // update scene on blocks/colors
  useEffect(() => {
    const t = threeRef.current;
    if (!t) return;
    t.anim.baseRadius = Math.max(10, bbox.maxDim * 1.6 + 6);
    rebuild();
    applyCameraTarget(yawIndex, pitchIndex);
    renderOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, blockColors, showEdges]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        border: "1px solid rgba(11, 15, 24, 0.14)",
        borderRadius: 12,
        overflow: "hidden",
        background: "#fff",
        ...style,
      }}
    >
      <div ref={wrapRef} style={{ position: "absolute", inset: 0 }} />

      {/* Controls */}
      <div
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          pointerEvents: "auto",
        }}
      >
        <button type="button" className="hbtn" onClick={() => setYawIndex((v) => (v + 7) % 8)}>
          ◀
        </button>
        <button type="button" className="hbtn" onClick={() => setYawIndex((v) => (v + 1) % 8)}>
          ▶
        </button>
        <button type="button" className="hbtn" onClick={() => setPitchIndex((v) => Math.min(v + 1, 1))}>
          ▲
        </button>
        <button type="button" className="hbtn" onClick={() => setPitchIndex((v) => Math.max(v - 1, -1))}>
          ▼
        </button>
      </div>
    </div>
  );
}
