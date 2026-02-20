"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import { useTelemetry } from "@/components/telemetry/TelemetryProvider";
import { useI18n } from "@/components/i18n/I18nProvider";

import { add, computeBBox, keyOf, parseKey, type Coord } from "./voxelUtils";
import { DEFAULT_BLOCK_COLOR } from "./filamentColors";
import type { RefImages } from "./referenceUtils";
import type { RefSettings } from "./settings";

const STEP_DEG = 45;
const STEP = (Math.PI / 180) * STEP_DEG;

// ---- 音（外部素材なし）: WebAudioで“ポン” ----
function playPop(audioCtx: AudioContext) {
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = "triangle";
  osc.frequency.setValueAtTime(520, t0);
  osc.frequency.exponentialRampToValueAtTime(260, t0 + 0.08);

  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(t0);
  osc.stop(t0 + 0.13);
}

function playClick(audioCtx: AudioContext) {
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = "square";
  osc.frequency.setValueAtTime(140, t0);

  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(t0);
  osc.stop(t0 + 0.07);
}

// face normal を ±X/±Y/±Z に丸める
function snapAxisNormal(n: any): Coord {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  if (ax >= ay && ax >= az) return { x: n.x >= 0 ? 1 : -1, y: 0, z: 0 };
  if (ay >= ax && ay >= az) return { x: 0, y: n.y >= 0 ? 1 : -1, z: 0 };
  return { x: 0, y: 0, z: n.z >= 0 ? 1 : -1 };
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function pickEdgeStyle(hex: string) {
  const c = new THREE.Color(hex);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  // 明るい色なら濃い線、暗い色なら白い線
  if (lum < 0.45) {
    return { color: "#ffffff", opacity: 0.55 };
  }
  return { color: "#111827", opacity: 0.35 };
}

type EditorThree = {
  renderer: any;
  scene: any;
  camera: any;
  raycaster: any;
  mouse: any;

  root: any; // centered group
  cubesGroup: any;
  refsGroup: any;

  highlightPlane: any;
  previewCube: any;
  light: any;
  grid: any;

  audioCtx: AudioContext | null;

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
  edgeGeo: any;
  cubeMats: Map<string, any>; // color -> material
  edgeMats: Map<string, any>; // styleKey -> material

  // camera animation / zoom
  anim: { yaw: number; pitch: number; baseRadius: number; zoom: number; center: Coord };
};

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

type Props = {
  blocks: Set<string>;
  setBlocks: React.Dispatch<React.SetStateAction<Set<string>>>;

  // v1.0.17+: per-block colors
  blockColors: Map<string, string>;
  setBlockColors: React.Dispatch<React.SetStateAction<Map<string, string>>>;

  // v1.0.17+: editor mode & paint selection
  editorMode: "model" | "paint";
  setEditorMode: React.Dispatch<React.SetStateAction<"model" | "paint">>;
  paintColor: string;
  setPaintColor: React.Dispatch<React.SetStateAction<string>>;

  // 編集視点（45°刻み）
  yawIndex: number;
  pitchIndex: number;
  setYawIndex: React.Dispatch<React.SetStateAction<number>>;
  setPitchIndex: React.Dispatch<React.SetStateAction<number>>;

  // プレビューが閉じているときに「プレビュー」を出す
  previewOpen: boolean;
  onOpenPreview: () => void;

  // HUD用
  cubeCount: number;
  onClearAll: () => void;

  // 見た目（エッジ）
  showEdges: boolean;
  setShowEdges: React.Dispatch<React.SetStateAction<boolean>>;

  // 参照画像（3面図）
  refImages: RefImages;
  refSettings: RefSettings;

  // ファイル（画像/プロジェクトjson）ドロップ
  onFileDrop?: (file: File) => void | Promise<void>;
};

export default function VoxelEditor({
  blocks,
  setBlocks,
  blockColors,
  setBlockColors,
  editorMode,
  paintColor,
  setPaintColor,
  yawIndex,
  pitchIndex,
  setYawIndex,
  setPitchIndex,
  previewOpen,
  onOpenPreview,
  cubeCount,
  onClearAll,
  showEdges,
  setShowEdges,
  refImages,
  refSettings,
  onFileDrop,
}: Props) {
  const { track } = useTelemetry();
  const { t } = useI18n();
  const trackRef = useRef(track);
  useEffect(() => {
    trackRef.current = track;
  }, [track]);

  // --- HUD: モバイルでは情報量を抑える（PCは従来どおり） ---
  const [isCompactHud, setIsCompactHud] = useState(false);
  const [showLook, setShowLook] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 600px)");
    const apply = () => setIsCompactHud(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  useEffect(() => {
    // スマホはデフォルトで「見た目」を畳む
    if (isCompactHud) {
      setShowLook(false);
    } else {
      setShowLook(true);
    }
  }, [isCompactHud]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const threeRef = useRef<EditorThree | null>(null);

  const ORIGIN_KEY = keyOf({ x: 0, y: 0, z: 0 });


  // hover 中の「追加候補位置」
  const hoverRef = useRef<Coord | null>(null);

  // stale closure 対策
  const blocksRef = useRef(blocks);
  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  const blockColorsRef = useRef(blockColors);
  useEffect(() => {
    blockColorsRef.current = blockColors;
  }, [blockColors]);

  const editorModeRef = useRef(editorMode);
  useEffect(() => {
    editorModeRef.current = editorMode;
    // mode切替時はホバー表示をリセット
    hoverRef.current = null;
    const t = threeRef.current;
    if (!t) return;
    t.highlightPlane.visible = false;
    t.previewCube.visible = false;
  }, [editorMode]);

  const paintColorRef = useRef(paintColor);
  useEffect(() => {
    paintColorRef.current = paintColor;
  }, [paintColor]);

  const refImagesRef = useRef(refImages);
  const refSettingsRef = useRef(refSettings);
  useEffect(() => {
    refImagesRef.current = refImages;
  }, [refImages]);
  useEffect(() => {
    refSettingsRef.current = refSettings;
  }, [refSettings]);

  const showEdgesRef = useRef(showEdges);
  useEffect(() => {
    showEdgesRef.current = showEdges;

    // 既存キューブのエッジ表示を切り替える
    const t = threeRef.current;
    if (!t) return;
    t.cubesGroup.traverse((o: any) => {
      if (o?.name === "edges") o.visible = showEdges;
    });
  }, [showEdges]);

  // v1.0.17+: 色はブロック単位（material pool で色ごとに共有して描画）

  
type UndoAction =
  | { kind: "add"; key: string; color: string }
  | { kind: "remove"; key: string; color: string }
  | { kind: "paint"; key: string; from: string; to: string }
  | { kind: "bucket"; keys: string[]; from: string; to: string };

const undoStackRef = useRef<UndoAction[]>([]);
const redoStackRef = useRef<UndoAction[]>([]);

const pushUndo = (a: UndoAction) => {
  undoStackRef.current.push(a);
  if (undoStackRef.current.length > 200) undoStackRef.current.shift();
  // 新しい操作が来たら redo は捨てる
  redoStackRef.current = [];
};

const applyAdd = (k: string, col: string) => {
  setBlocks((prev) => {
    if (prev.has(k)) return prev;
    const next = new Set(prev);
    next.add(k);
    return next;
  });
  setBlockColors((prev) => {
    const next = new Map(prev);
    next.set(k, col);
    return next;
  });
};

const applyRemove = (k: string) => {
  setBlocks((prev) => {
    if (!prev.has(k)) return prev;
    const next = new Set(prev);
    next.delete(k);
    if (next.size === 0) next.add(ORIGIN_KEY);
    return next;
  });
  setBlockColors((prev) => {
    const next = new Map(prev);
    next.delete(k);
    if (next.size === 0) next.set(ORIGIN_KEY, DEFAULT_BLOCK_COLOR);
    return next;
  });
};

const applyPaint = (k: string, col: string) => {
  setBlockColors((prev) => {
    if (!prev.has(k)) return prev;
    const next = new Map(prev);
    next.set(k, col);
    return next;
  });
};

const applyBucket = (keys: string[], col: string) => {
  setBlockColors((prev) => {
    const next = new Map(prev);
    for (const kk of keys) if (next.has(kk)) next.set(kk, col);
    return next;
  });
};

const undo = () => {
  const a = undoStackRef.current.pop();
  if (!a) return;

  if (a.kind === "add") {
    applyRemove(a.key);
  } else if (a.kind === "remove") {
    applyAdd(a.key, a.color);
  } else if (a.kind === "paint") {
    applyPaint(a.key, a.from);
  } else if (a.kind === "bucket") {
    applyBucket(a.keys, a.from);
  }

  redoStackRef.current.push(a);
  trackRef.current("undo", { kind: a.kind });
};

const redo = () => {
  const a = redoStackRef.current.pop();
  if (!a) return;

  if (a.kind === "add") {
    applyAdd(a.key, a.color);
  } else if (a.kind === "remove") {
    applyRemove(a.key);
  } else if (a.kind === "paint") {
    applyPaint(a.key, a.to);
  } else if (a.kind === "bucket") {
    applyBucket(a.keys, a.to);
  }

  undoStackRef.current.push(a);
  trackRef.current("redo", { kind: a.kind });
};

const normalizeHex = (hex: string) => String(hex || "").trim().toLowerCase();

  const getCubeMat = (t: EditorThree, hex: string) => {
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
  };

  const getEdgeMat = (t: EditorThree, cubeHex: string) => {
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
  };

  const requestAudioContext = () => {
    const t = threeRef.current;
    if (!t) return null;
    if (!t.audioCtx) t.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (t.audioCtx.state === "suspended") t.audioCtx.resume().catch(() => {});
    return t.audioCtx;
  };

  const applyCameraTarget = (targetYawIndex: number, targetPitchIndex: number) => {
    const t = threeRef.current;
    if (!t) return;
    t.anim.yaw = targetYawIndex * STEP;
    t.anim.pitch = targetPitchIndex * STEP;
  };

  const updateRefPlanes = (t: EditorThree, keys: Set<string>) => {
    const bboxNow = computeBBox(keys);
    const s = refSettingsRef.current;
    const imgs = refImagesRef.current;

    const setPlane = (slot: "front" | "side" | "top", img: RefImages["front"], rot: any, pos: any) => {
      if (!s.enabled || !img) {
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

      // texture update
      if (!t.refTextures[slot] || t.refUrls[slot] !== img.url) {
        if (t.refTextures[slot]) t.refTextures[slot]!.dispose();
        t.refTextures[slot] = makePixelTexture(img.url);
        t.refUrls[slot] = img.url;
      }

      // plane ensure
      if (!t.refPlanes[slot]) {
        const geo = new THREE.PlaneGeometry(1, 1);
        const mat = new THREE.MeshBasicMaterial({
          map: t.refTextures[slot],
          transparent: true,
          opacity: s.opacity,
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
      mat.opacity = s.opacity;
      mat.needsUpdate = true;

      // size
      const aspect = img.w / img.h;
      const height = Math.max(1, s.size);
      const width = Math.max(1, height * aspect);
      plane.scale.set(width, height, 1);
      plane.rotation.copy(rot);
      plane.position.copy(pos);
      plane.visible = true;
    };

    // Auto placement: モデルの外側（min側）に置く
    const margin = Math.max(0, s.margin);
    const center = bboxNow.center;

    setPlane("front", imgs.front, new THREE.Euler(0, 0, 0), new THREE.Vector3(center.x, center.y, bboxNow.min.z - margin));
    setPlane(
      "side",
      imgs.side,
      new THREE.Euler(0, Math.PI / 2, 0),
      new THREE.Vector3(bboxNow.min.x - margin, center.y, center.z)
    );
    setPlane(
      "top",
      imgs.top,
      new THREE.Euler(-Math.PI / 2, 0, 0),
      new THREE.Vector3(center.x, bboxNow.min.y - margin, center.z)
    );
  };

  const rebuildCubes = (keys: Set<string>) => {
    const t = threeRef.current;
    if (!t) return;

    const bboxNow = computeBBox(keys);
    // center to origin
    t.root.position.set(-bboxNow.center.x, -bboxNow.center.y, -bboxNow.center.z);

    // Keep the grid at the model's bottom face (dynamic).
    // With root centered at origin, the bottom face becomes -sizeY/2.
    if (t.grid) {
      t.grid.position.y = -bboxNow.size.y / 2 - 0.001;
    }

    // clear old cubes (shared resourcesなのでdisposeしない)
    t.cubesGroup.clear();

    for (const k of keys) {
      const c = parseKey(k);
      const col = (blockColorsRef.current.get(k) || DEFAULT_BLOCK_COLOR) as string;
      const mesh = new THREE.Mesh(t.cubeGeo, getCubeMat(t, col));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(c.x, c.y, c.z);
      mesh.userData.coord = c;
      mesh.userData.key = k;

      // cube edge (toggle)
      const edges = new THREE.LineSegments(t.edgeGeo, getEdgeMat(t, col));
      edges.name = "edges";
      edges.scale.set(1.01, 1.01, 1.01);
      edges.visible = showEdgesRef.current;
      edges.renderOrder = 2;
      edges.userData.key = k;
      mesh.add(edges);

      t.cubesGroup.add(mesh);
    }

    // radius auto (size dependent)
    const desired = Math.max(7, bboxNow.maxDim * 2.6);
    t.anim.baseRadius = desired;

    updateRefPlanes(t, keys);
  };

  // 初期化
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    // renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(new THREE.Color("#f7f8fb"), 1);
    wrap.appendChild(renderer.domElement);

    // scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f7f8fb");

    // camera
    const camera = new THREE.PerspectiveCamera(55, wrap.clientWidth / wrap.clientHeight, 0.1, 250);

    // lights
    const hemi = new THREE.HemisphereLight(new THREE.Color("#ffffff"), new THREE.Color("#f1f5f9"), 0.95);
    scene.add(hemi);

    const light = new THREE.DirectionalLight(new THREE.Color("#ffffff"), 1.2);
    light.position.set(10, 18, 12);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    scene.add(light);

    // ground grid（明るめ）
    const grid = new THREE.GridHelper(60, 60, new THREE.Color("#d7dde8"), new THREE.Color("#eef2f7"));
    (grid.material as any).transparent = true;
    (grid.material as any).opacity = 0.7;
    // Grid height will be updated dynamically to match the model's bottom face.
    grid.position.y = -0.5;
    scene.add(grid);

    // root group (centered)
    const root = new THREE.Group();
    scene.add(root);

    const refsGroup = new THREE.Group();
    refsGroup.name = "refs";
    root.add(refsGroup);

    const cubesGroup = new THREE.Group();
    cubesGroup.name = "cubes";
    root.add(cubesGroup);

    // shared geometry + material pools
    const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
    const edgeGeo = new THREE.EdgesGeometry(cubeGeo);
    const cubeMats = new Map<string, any>();
    const edgeMats = new Map<string, any>();

    // highlight plane（面ホバー）
    const hpGeo = new THREE.PlaneGeometry(0.96, 0.96);
    const hpMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#ffe16a"),
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const highlightPlane = new THREE.Mesh(hpGeo, hpMat);
    highlightPlane.visible = false;
    root.add(highlightPlane);

    // preview cube（追加候補）
    const pvGeo = new THREE.BoxGeometry(1.02, 1.02, 1.02);
    const pvMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#7ee787"),
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    const previewCube = new THREE.Mesh(pvGeo, pvMat);
    previewCube.visible = false;
    root.add(previewCube);

    // raycasting
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    // 初期視点
    const initialRadius = 12;
    const iyaw = yawIndex * STEP;
    const ipitch = pitchIndex * STEP;
    const cp = Math.cos(ipitch);
    const sp = Math.sin(ipitch);
    const sy = Math.sin(iyaw);
    const cy = Math.cos(iyaw);
    camera.position.set(initialRadius * cp * sy, initialRadius * sp, initialRadius * cp * cy);
    camera.lookAt(0, 0, 0);

    threeRef.current = {
      renderer,
      scene,
      camera,
      raycaster,
      mouse,
      root,
      cubesGroup,
      refsGroup,
      highlightPlane,
      previewCube,
      light,
      grid,
      audioCtx: null,
      refPlanes: {},
      refTextures: {},
      refUrls: {},

      cubeGeo,
      edgeGeo,
      cubeMats,
      edgeMats,
      anim: {
        yaw: iyaw,
        pitch: ipitch,
        baseRadius: initialRadius,
        zoom: 1,
        center: { x: 0, y: 0, z: 0 },
      },
    };

    // 初回構築
    rebuildCubes(blocksRef.current);
    applyCameraTarget(yawIndex, pitchIndex);

    const onResize = () => {
      const t = threeRef.current;
      const w = wrapRef.current;
      if (!t || !w) return;
      t.camera.aspect = w.clientWidth / Math.max(1, w.clientHeight);
      t.camera.updateProjectionMatrix();
      t.renderer.setSize(w.clientWidth, w.clientHeight);
    };

    // レイアウト変更（プレビュー開閉など）でも追従できるようにする
    const ro = new ResizeObserver(() => onResize());
    ro.observe(wrap);

    // Disable browser gestures on the canvas (for mobile pinch/pan)
    renderer.domElement.style.touchAction = "none";

    const toNDCXY = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    };

    const clearHover = () => {
      const t = threeRef.current;
      if (!t) return;
      t.highlightPlane.visible = false;
      t.previewCube.visible = false;
      hoverRef.current = null;
    };

    const updateHoverAt = (clientX: number, clientY: number) => {
      const t = threeRef.current;
      if (!t) return;

      const mode = editorModeRef.current;

      toNDCXY(clientX, clientY);
      t.raycaster.setFromCamera(t.mouse, t.camera);

      const hits = t.raycaster.intersectObjects(t.cubesGroup.children, false);

      if (hits.length === 0) {
        t.highlightPlane.visible = false;
        t.previewCube.visible = false;
        hoverRef.current = null;
        return;
      }

      const hit = hits[0];
      const obj = hit.object as any;
      const coord = obj.userData.coord as Coord;

      // face normal -> world -> snap axis
      const faceNormalLocal = hit.face?.normal?.clone() ?? new THREE.Vector3(0, 1, 0);
      const normalWorld = faceNormalLocal.applyMatrix3(new THREE.Matrix3().getNormalMatrix(obj.matrixWorld)).normalize();
      const n = snapAxisNormal(normalWorld);

      if (mode === "paint") {
        // paint mode: hover target is the existing block itself
        hoverRef.current = coord;

        // highlight plane position/orientation (on the hovered face)
        t.highlightPlane.position.set(coord.x + n.x * 0.5, coord.y + n.y * 0.5, coord.z + n.z * 0.5);
        const q = new THREE.Quaternion();
        q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(n.x, n.y, n.z));
        t.highlightPlane.quaternion.copy(q);

        // preview cube at the block (show selected paint color)
        t.previewCube.position.set(coord.x, coord.y, coord.z);
        (t.previewCube.material as any).color.set(paintColorRef.current || DEFAULT_BLOCK_COLOR);
        t.highlightPlane.visible = true;
        t.previewCube.visible = true;
        return;
      }

      // model mode: hover target is neighbor cell (add)
      const target = add(coord, n);
      hoverRef.current = target;

      const exists = blocksRef.current.has(keyOf(target));

      // highlight plane position/orientation (on the hovered face)
      t.highlightPlane.position.set(coord.x + n.x * 0.5, coord.y + n.y * 0.5, coord.z + n.z * 0.5);

      // rotate plane to match face
      const q = new THREE.Quaternion();
      // default plane is XY facing +Z. rotate to face normal
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(n.x, n.y, n.z));
      t.highlightPlane.quaternion.copy(q);

      // preview cube at target
      t.previewCube.position.set(target.x, target.y, target.z);
      (t.previewCube.material as any).color.set(exists ? "#ff7b72" : "#7ee787");
      t.highlightPlane.visible = true;
      t.previewCube.visible = true;
    };

    const addAt = (clientX: number, clientY: number) => {
      updateHoverAt(clientX, clientY);

      const target = hoverRef.current;
      if (!target) return;

      const mode = editorModeRef.current;

      if (mode === "paint") {
  const k = keyOf(target);
  const toCol = paintColorRef.current || DEFAULT_BLOCK_COLOR;

  // Ctrl+Z / Shift+Ctrl+Z 用
  const fromCol = blockColorsRef.current.get(k) || DEFAULT_BLOCK_COLOR;
  if (normalizeHex(fromCol) !== normalizeHex(toCol)) {
    pushUndo({ kind: "paint", key: k, from: fromCol, to: toCol });
  } else {
    const ac = requestAudioContext();
    if (ac) playClick(ac);
    return;
  }

  setBlockColors((prev) => {
    if (!prev.has(k)) return prev;
    const next = new Map(prev);
    next.set(k, toCol);
    trackRef.current("voxel_paint", { x: target.x, y: target.y, z: target.z, color: toCol });
    return next;
  });

  const ac = requestAudioContext();
  if (ac) playClick(ac);
  return;
}
const k = keyOf(target);
const col = paintColorRef.current || DEFAULT_BLOCK_COLOR;

if (!blocksRef.current.has(k)) {
  pushUndo({ kind: "add", key: k, color: col });
}

setBlocks((prev) => {
        if (prev.has(k)) return prev;
        const next = new Set(prev);
        next.add(k);
        trackRef.current("voxel_add", { x: target.x, y: target.y, z: target.z, blocks: next.size });
        return next;
      });

      // v1.0.17+: new blocks start as current selected color
      setBlockColors((prev) => {
        if (prev.has(k)) return prev;
        const next = new Map(prev);
        next.set(k, col);
        return next;
      });

      const ac = requestAudioContext();
      if (ac) playPop(ac);
    };

    const removeAt = (clientX: number, clientY: number) => {
      const t = threeRef.current;
      if (!t) return;

      const mode = editorModeRef.current;

      toNDCXY(clientX, clientY);
      t.raycaster.setFromCamera(t.mouse, t.camera);
      const hits = t.raycaster.intersectObjects(t.cubesGroup.children, false);
      if (hits.length === 0) return;

      const obj = hits[0].object as any;
      const c = obj.userData.coord as Coord;
      const k = keyOf(c);

      if (mode === "paint") {
        // bucket fill: 右クリック/長押しで同色連結領域を塗りつぶし
        const fromColRaw = blockColorsRef.current.get(k) || DEFAULT_BLOCK_COLOR;
        const toColRaw = paintColorRef.current || DEFAULT_BLOCK_COLOR;
        const fromCol = normalizeHex(fromColRaw);
        const toCol = normalizeHex(toColRaw);

        if (fromCol === toCol) return;

        const keysSet = blocksRef.current;
        const colorsMap = blockColorsRef.current;
        const visited = new Set<string>();
        const q: Coord[] = [{ x: c.x, y: c.y, z: c.z }];
        let qi = 0;
        const fillKeys: string[] = [];
        const dirs: Coord[] = [
          { x: 1, y: 0, z: 0 },
          { x: -1, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 },
          { x: 0, y: -1, z: 0 },
          { x: 0, y: 0, z: 1 },
          { x: 0, y: 0, z: -1 },
        ];

        while (qi < q.length) {
          const cur = q[qi++]!;
          const kk = keyOf(cur);
          if (visited.has(kk)) continue;
          visited.add(kk);
          if (!keysSet.has(kk)) continue;
          const curCol = normalizeHex(colorsMap.get(kk) || DEFAULT_BLOCK_COLOR);
          if (curCol !== fromCol) continue;
          fillKeys.push(kk);
          for (const d of dirs) q.push(add(cur, d));
        }

        if (fillKeys.length === 0) return;

        pushUndo({ kind: "bucket", keys: fillKeys, from: fromColRaw, to: toColRaw });

        setBlockColors((prev) => {
          const next = new Map(prev);
          for (const kk of fillKeys) {
            if (next.has(kk)) next.set(kk, toColRaw);
          }
          trackRef.current("paint_bucket", { x: c.x, y: c.y, z: c.z, from: fromColRaw, to: toColRaw, count: fillKeys.length });
          return next;
        });
        const ac = requestAudioContext();
        if (ac) playClick(ac);
        return;
      }

// Ctrl+Z / Shift+Ctrl+Z 用（削除）
if (blocksRef.current.size <= 1) return;
if (!blocksRef.current.has(k)) return;
const removedCol = blockColorsRef.current.get(k) || DEFAULT_BLOCK_COLOR;
pushUndo({ kind: "remove", key: k, color: removedCol });

      setBlocks((prev) => {
        if (prev.size <= 1) return prev; // 最後の1個は残す
        const next = new Set(prev);
        next.delete(k);
        if (next.size === 0) next.add(keyOf({ x: 0, y: 0, z: 0 }));
        trackRef.current("voxel_remove", { x: c.x, y: c.y, z: c.z, blocks: next.size });
        return next;
      });

      setBlockColors((prev) => {
        if (prev.size <= 1) return prev;
        if (!prev.has(k)) return prev;
        const next = new Map(prev);
        next.delete(k);
        if (next.size === 0) next.set(keyOf({ x: 0, y: 0, z: 0 }), DEFAULT_BLOCK_COLOR);
        return next;
      });

      const ac = requestAudioContext();
      if (ac) playClick(ac);
    };

    const panByPixels = (dx: number, dy: number) => {
      const t = threeRef.current;
      if (!t) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);

      const center = new THREE.Vector3(t.anim.center.x, t.anim.center.y, t.anim.center.z);
      const dist = t.camera.position.distanceTo(center);
      const fov = (t.camera.fov * Math.PI) / 180;
      const worldPerPixelY = (2 * dist * Math.tan(fov / 2)) / h;
      const worldPerPixelX = worldPerPixelY * (w / h);

      const forward = new THREE.Vector3();
      t.camera.getWorldDirection(forward);
      const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(t.camera.quaternion).normalize();
      const rightWorld = new THREE.Vector3().crossVectors(forward, upWorld).normalize();

      const delta = new THREE.Vector3()
        .addScaledVector(rightWorld, -dx * worldPerPixelX)
        .addScaledVector(upWorld, dy * worldPerPixelY);

      t.anim.center = {
        x: t.anim.center.x + delta.x,
        y: t.anim.center.y + delta.y,
        z: t.anim.center.z + delta.z,
      };
    };

    const PAN_BUTTONS = 4; // mouse middle button
    const TAP_MOVE_PX = 8;
    const LONG_PRESS_MS = 480;

    let mousePanning = false;
    let lastMouseX = 0;
    let lastMouseY = 0;

    const touch = {
      pointers: new Map<number, { x: number; y: number }>(),
      mode: "none" as "none" | "one" | "two",
      startX: 0,
      startY: 0,
      moved: false,
      longPressTimer: 0 as any,
      longPressFired: false,
      pinchStartDist: 0,
      pinchStartZoom: 1,
      lastMidX: 0,
      lastMidY: 0,
    };

    const clearLongPress = () => {
      if (touch.longPressTimer) {
        window.clearTimeout(touch.longPressTimer);
        touch.longPressTimer = 0;
      }
    };

    const beginTwoFinger = () => {
      const pts = [...touch.pointers.values()];
      if (pts.length < 2) return;
      const p0 = pts[0]!;
      const p1 = pts[1]!;
      touch.mode = "two";
      touch.pinchStartDist = Math.hypot(p0.x - p1.x, p0.y - p1.y);
      const t = threeRef.current;
      touch.pinchStartZoom = t ? t.anim.zoom : 1;
      touch.lastMidX = (p0.x + p1.x) / 2;
      touch.lastMidY = (p0.y + p1.y) / 2;
      clearHover();
    };

    const onPointerDown = (ev: PointerEvent) => {
      // audio unlock
      requestAudioContext();

      if (ev.pointerType === "mouse") {
        // middle button drag => pan
        if (ev.button === 1) {
          ev.preventDefault();
          mousePanning = true;
          lastMouseX = ev.clientX;
          lastMouseY = ev.clientY;
          clearHover();
          return;
        }

        // right click => delete (only when right button alone)
        if (ev.button === 2) {
          if (ev.buttons === 2) {
            ev.preventDefault();
            removeAt(ev.clientX, ev.clientY);
          }
          return;
        }

        // left click => add (only when left button alone)
        if (ev.button === 0 && ev.buttons === 1) {
          addAt(ev.clientX, ev.clientY);
        }
        return;
      }

      if (ev.pointerType === "touch") {
        ev.preventDefault();
        try {
          renderer.domElement.setPointerCapture(ev.pointerId);
        } catch {
          // ignore
        }

        touch.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

        if (touch.pointers.size === 1) {
          touch.mode = "one";
          touch.startX = ev.clientX;
          touch.startY = ev.clientY;
          touch.moved = false;
          touch.longPressFired = false;
          clearLongPress();
          updateHoverAt(ev.clientX, ev.clientY);

          touch.longPressTimer = window.setTimeout(() => {
            if (touch.mode !== "one") return;
            if (touch.moved) return;
            if (touch.pointers.size !== 1) return;
            touch.longPressFired = true;
            removeAt(touch.startX, touch.startY);
            clearHover();
          }, LONG_PRESS_MS);

          return;
        }

        // 2 finger => pan/zoom
        clearLongPress();
        beginTwoFinger();
      }
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (ev.pointerType === "mouse") {
        // 3 buttons => pan
        if (ev.buttons === PAN_BUTTONS) {
          ev.preventDefault();
          if (!mousePanning) {
            mousePanning = true;
            lastMouseX = ev.clientX;
            lastMouseY = ev.clientY;
            clearHover();
            return;
          }
          const dx = ev.clientX - lastMouseX;
          const dy = ev.clientY - lastMouseY;
          lastMouseX = ev.clientX;
          lastMouseY = ev.clientY;
          panByPixels(dx, dy);
          return;
        }
        if (mousePanning) mousePanning = false;

        updateHoverAt(ev.clientX, ev.clientY);
        return;
      }

      if (ev.pointerType === "touch") {
        ev.preventDefault();
        if (!touch.pointers.has(ev.pointerId)) return;
        touch.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

        if (touch.pointers.size === 1 && touch.mode === "one") {
          const dx = ev.clientX - touch.startX;
          const dy = ev.clientY - touch.startY;
          if (!touch.moved && Math.hypot(dx, dy) > TAP_MOVE_PX) {
            touch.moved = true;
            clearLongPress();
          }
          updateHoverAt(ev.clientX, ev.clientY);
          return;
        }

        // two-finger gesture
        if (touch.pointers.size >= 2) {
          clearLongPress();
          if (touch.mode !== "two") beginTwoFinger();

          const pts = [...touch.pointers.values()];
          const p0 = pts[0]!;
          const p1 = pts[1]!;
          const midX = (p0.x + p1.x) / 2;
          const midY = (p0.y + p1.y) / 2;
          const dist = Math.hypot(p0.x - p1.x, p0.y - p1.y);

          // pan by midpoint delta
          panByPixels(midX - touch.lastMidX, midY - touch.lastMidY);
          touch.lastMidX = midX;
          touch.lastMidY = midY;

          // pinch zoom
          const t = threeRef.current;
          if (t && touch.pinchStartDist > 2 && dist > 2) {
            const factor = touch.pinchStartDist / dist; // pinch-out => zoom in (factor < 1)
            t.anim.zoom = clamp(touch.pinchStartZoom * factor, 0.35, 3.2);
          }

          clearHover();
        }
      }
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (ev.pointerType === "mouse") {
        if (mousePanning && ev.buttons !== PAN_BUTTONS) mousePanning = false;
        return;
      }

      if (ev.pointerType === "touch") {
        ev.preventDefault();

        if (touch.mode === "one") {
          clearLongPress();
          if (!touch.moved && !touch.longPressFired) {
            addAt(ev.clientX, ev.clientY);
          }
        }

        touch.pointers.delete(ev.pointerId);

        if (touch.pointers.size === 0) {
          touch.mode = "none";
          touch.moved = false;
          touch.longPressFired = false;
          clearLongPress();
          return;
        }

        if (touch.pointers.size === 1) {
          // After a 2-finger gesture, prevent accidental tap/add.
          touch.mode = "one";
          const p = [...touch.pointers.values()][0]!;
          touch.startX = p.x;
          touch.startY = p.y;
          touch.moved = true;
          touch.longPressFired = false;
          clearLongPress();
          clearHover();
          return;
        }

        touch.mode = "two";
      }
    };

    const onPointerLeave = () => {
      // Hover only makes sense for mouse
      if (touch.mode === "none") clearHover();
    };

    const onContextMenu = (ev: MouseEvent) => {
      ev.preventDefault();
    };

    let lastWheelLog = 0;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const t = threeRef.current;
      if (!t) return;
      const factor = ev.deltaY > 0 ? 1.12 : 0.88;
      t.anim.zoom = clamp(t.anim.zoom * factor, 0.35, 3.2);

      const now = Date.now();
      if (now - lastWheelLog > 350) {
        lastWheelLog = now;
        trackRef.current("editor_zoom", { method: "wheel", zoom: Number(t.anim.zoom.toFixed(3)) });
      }
    };

    const onKeyDown = (ev: KeyboardEvent) => {
  const target = ev.target as any;
  const tag = (target?.tagName ?? "").toString().toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) return;

  // Ctrl+Z / Shift+Ctrl+Z（編集/ペイント共通）
  const isZ = ev.key === "z" || ev.key === "Z";
  if ((ev.ctrlKey || ev.metaKey) && isZ) {
    ev.preventDefault();
    if (ev.shiftKey) redo();
    else undo();
    return;
  }

  // Space: 視点の中心を原点へ
  if (ev.code !== "Space" && ev.key !== " ") return;

  ev.preventDefault();
  const t = threeRef.current;
  if (!t) return;
  t.anim.center = { x: 0, y: 0, z: 0 };
  clearHover();
};

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);

// animation loop
    let raf = 0;
    const tick = () => {
      const t = threeRef.current;
      if (!t) return;

      const targetYaw = t.anim.yaw;
      const targetPitch = t.anim.pitch;
      const targetR = t.anim.baseRadius * t.anim.zoom;

      const yaw = targetYaw;
      const pitch = targetPitch;
      const cp2 = Math.cos(pitch);
      const sp2 = Math.sin(pitch);
      const sy2 = Math.sin(yaw);
      const cy2 = Math.cos(yaw);

      const c = t.anim.center;
      const desired = new THREE.Vector3(c.x + targetR * cp2 * sy2, c.y + targetR * sp2, c.z + targetR * cp2 * cy2);
      t.camera.position.lerp(desired, 0.16);
      t.camera.lookAt(c.x, c.y, c.z);

      // light follows gently
      t.light.position.lerp(new THREE.Vector3(desired.x + 6, desired.y + 10, desired.z + 6), 0.06);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      ro.disconnect();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      renderer.domElement.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);

      cancelAnimationFrame(raf);

      // dispose
      if (threeRef.current) {
        Object.values(threeRef.current.refTextures).forEach((tex) => tex?.dispose());
        Object.values(threeRef.current.refPlanes).forEach((p) => p && disposeObject3D(p));
        disposeObject3D(threeRef.current.highlightPlane);
        disposeObject3D(threeRef.current.previewCube);
        threeRef.current.cubeGeo?.dispose?.();
        threeRef.current.edgeGeo?.dispose?.();
        // dispose pooled materials
        for (const m of threeRef.current.cubeMats?.values?.() || []) m?.dispose?.();
        for (const m of threeRef.current.edgeMats?.values?.() || []) m?.dispose?.();
      }

      renderer.dispose();
      wrap.removeChild(renderer.domElement);
      threeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // blocks 更新時に再構築
  useEffect(() => {
    rebuildCubes(blocks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  // colors 更新時：既存メッシュの material を差し替える（再構築はしない）
  useEffect(() => {
    const t = threeRef.current;
    if (!t) return;
    for (const mesh of t.cubesGroup.children as any[]) {
      const key = mesh?.userData?.key as string | undefined;
      if (!key) continue;
      const col = (blockColors.get(key) || DEFAULT_BLOCK_COLOR) as string;
      mesh.material = getCubeMat(t, col);
      const edges = (mesh.children || []).find((c: any) => c?.name === "edges");
      if (edges) edges.material = getEdgeMat(t, col);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockColors]);

  // 参照画像・設定変更時に更新
  useEffect(() => {
    const t = threeRef.current;
    if (!t) return;
    updateRefPlanes(t, blocksRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refImages, refSettings]);

  // yaw/pitch 更新時にカメラ目標を更新
  useEffect(() => {
    applyCameraTarget(yawIndex, pitchIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yawIndex, pitchIndex]);

  // 端の三角ボタン（直感操作）
  const showUp = pitchIndex < 1;
  const showDown = pitchIndex > -1;

  const rotateLeft = () => {
    const ac = requestAudioContext();
    if (ac) playClick(ac);
    setYawIndex((v) => {
      const next = (v + 7) % 8;
      track("editor_yaw", { from: v, to: next });
      return next;
    });
  };
  const rotateRight = () => {
    const ac = requestAudioContext();
    if (ac) playClick(ac);
    setYawIndex((v) => {
      const next = (v + 1) % 8;
      track("editor_yaw", { from: v, to: next });
      return next;
    });
  };
  const rotateUp = () => {
    const ac = requestAudioContext();
    if (ac) playClick(ac);
    setPitchIndex((v) => {
      const next = Math.min(v + 1, 1);
      track("editor_pitch", { from: v, to: next });
      return next;
    });
  };
  const rotateDown = () => {
    const ac = requestAudioContext();
    if (ac) playClick(ac);
    setPitchIndex((v) => {
      const next = Math.max(v - 1, -1);
      track("editor_pitch", { from: v, to: next });
      return next;
    });
  };

  const zoomIn = () => {
    const t = threeRef.current;
    if (!t) return;
    const ac = requestAudioContext();
    if (ac) playClick(ac);
    t.anim.zoom = clamp(t.anim.zoom * 0.88, 0.35, 3.2);
    track("editor_zoom", { method: "button", dir: "in", zoom: Number(t.anim.zoom.toFixed(3)) });
  };

  const zoomOut = () => {
    const t = threeRef.current;
    if (!t) return;
    const ac = requestAudioContext();
    if (ac) playClick(ac);
    t.anim.zoom = clamp(t.anim.zoom * 1.12, 0.35, 3.2);
    track("editor_zoom", { method: "button", dir: "out", zoom: Number(t.anim.zoom.toFixed(3)) });
  };

  const handleDrop = async (ev: React.DragEvent) => {
    if (!onFileDrop) return;
    ev.preventDefault();
    const f = ev.dataTransfer.files?.[0];
    if (f) await onFileDrop(f);
  };

  return (
    <div
      className="editorRoot"
      onDragOver={(e) => {
        if (!onFileDrop) return;
        e.preventDefault();
      }}
      onDrop={handleDrop}
    >
      <div className="canvasWrap" ref={wrapRef} />

      {/* 左上：最小HUD（詳細操作は /docs へ） */}
      <div className={`editorHud ${isCompactHud ? "compact" : ""}`}>
        {/* 色とエッジ（スマホは「見た目」で畳む） */}
        <div className="editorHudTools" aria-label="色とエッジ">
          {isCompactHud && (
            <div className="hudCompactRow" aria-label="クイック操作">
              <div className="hudPill" aria-label="ブロック数">
                {t("editor.blocks", { n: cubeCount })}
              </div>
              <button
                type="button"
                className={`miniToggle ${showLook ? "on" : ""}`}
                onClick={() => {
                  setShowLook((v) => {
                    const next = !v;
                    track("hud_toggle_look", { on: next });
                    return next;
                  });
                }}
                title={t("editor.look")}
                aria-label={t("editor.look")}
              >
                <span className="colorDot" style={{ background: paintColor }} />
                {t("editor.look")}
              </button>
            </div>
          )}

          {(!isCompactHud || showLook) && (
            <>
              {!isCompactHud && (
                <div className="hudPill" aria-label="ブロック数">
                  {t("editor.blocks", { n: cubeCount })}
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 8 }} aria-label="ペイント色">
                <input
                  type="color"
                  value={paintColor}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPaintColor(v);
                    track("paint_color_change", { hex: v, method: "picker" });
                  }}
                  title={t("editor.pickColor")}
                  aria-label={t("editor.pickColor")}
                  style={{ width: 32, height: 22, padding: 0, border: "none", background: "transparent" }}
                />
                <span className="colorDot" style={{ background: paintColor }} />
              </div>

{/*
                NOTE: 「全ブロックの色が変わる」誤解を生みやすいので、
                一旦パレット（スウォッチ）は廃止し、カラーピッカーのみ残す。
              */}

              <button
                type="button"
                className={`miniToggle ${showEdges ? "on" : ""}`}
                onClick={() =>
                  setShowEdges((v) => {
                    const next = !v;
                    track("edges_toggle", { on: next });
                    return next;
                  })
                }
                title={t("editor.edges")}
                aria-label={t("editor.edges")}
              >
                {t("editor.edges")}
              </button>
            </>
          )}
        </div>
        <div className="editorHudActions">
          {!previewOpen && (
            <button type="button" className="hudLink" onClick={onOpenPreview}>
              {t("editor.preview")}
            </button>
          )}
          <button type="button" className="hudLink" onClick={onClearAll}>
            {t("editor.reset")}
          </button>
        </div>
      </div>

      {/* 端の三角：視点操作 */}
      <div className="overlayButtons">
        {showUp && (
          <button type="button" className="triBtn posUp" onClick={rotateUp} title={t("editor.viewFromTop")}>
            <div className="tri up" />
          </button>
        )}
        {showDown && (
          <button type="button" className="triBtn posDown" onClick={rotateDown} title={t("editor.viewFromBottom")}>
            <div className="tri down" />
          </button>
        )}

        <button type="button" className="triBtn posLeft" onClick={rotateLeft} title={t("editor.rotateLeft")}>
          <div className="tri left" />
        </button>
        <button type="button" className="triBtn posRight" onClick={rotateRight} title={t("editor.rotateRight")}>
          <div className="tri right" />
        </button>

        {/* ズーム（ホイールでもOK） */}
        <div className="zoomStack" aria-label={t("editor.zoom")}>
          <button type="button" className="zoomBtn" onClick={zoomIn} title={t("editor.zoomIn")}>
            ＋
          </button>
          <button type="button" className="zoomBtn" onClick={zoomOut} title={t("editor.zoomOut")}>
            －
          </button>
        </div>
      </div>

      {/* 左下：アカウント */}
      {/* AccountFab is rendered globally in <Providers /> */}
    </div>
  );
}
