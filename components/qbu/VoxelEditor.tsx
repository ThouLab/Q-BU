"use client";

import React, { useEffect, useRef } from "react";
import * as THREE from "three";

import AccountFab from "@/components/account/AccountFab";
import { useTelemetry } from "@/components/telemetry/TelemetryProvider";

import { add, computeBBox, keyOf, parseKey, type Coord } from "./voxelUtils";
import { BAMBU_FILAMENT_COLORS } from "./filamentColors";
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
  cubeMat: any;
  edgeGeo: any;
  edgeMat: any;

  // camera animation / zoom
  anim: { yaw: number; pitch: number; baseRadius: number; zoom: number };
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

  // 見た目（単色 + エッジ）
  cubeColor: string;
  setCubeColor: React.Dispatch<React.SetStateAction<string>>;
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
  yawIndex,
  pitchIndex,
  setYawIndex,
  setPitchIndex,
  previewOpen,
  onOpenPreview,
  cubeCount,
  onClearAll,
  cubeColor,
  setCubeColor,
  showEdges,
  setShowEdges,
  refImages,
  refSettings,
  onFileDrop,
}: Props) {
  const { track } = useTelemetry();
  const trackRef = useRef(track);
  useEffect(() => {
    trackRef.current = track;
  }, [track]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const threeRef = useRef<EditorThree | null>(null);

  // hover 中の「追加候補位置」
  const hoverRef = useRef<Coord | null>(null);

  // stale closure 対策
  const blocksRef = useRef(blocks);
  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

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
  }, [cubeColor]);

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

    // clear old cubes (shared resourcesなのでdisposeしない)
    t.cubesGroup.clear();

    for (const k of keys) {
      const c = parseKey(k);
      const mesh = new THREE.Mesh(t.cubeGeo, t.cubeMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(c.x, c.y, c.z);
      mesh.userData.coord = c;

      // cube edge (toggle)
      const edges = new THREE.LineSegments(t.edgeGeo, t.edgeMat);
      edges.name = "edges";
      edges.scale.set(1.01, 1.01, 1.01);
      edges.visible = showEdgesRef.current;
      edges.renderOrder = 2;
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
    grid.position.y = -6;
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
      audioCtx: null,
      refPlanes: {},
      refTextures: {},
      refUrls: {},

      cubeGeo,
      cubeMat,
      edgeGeo,
      edgeMat,
      anim: {
        yaw: iyaw,
        pitch: ipitch,
        baseRadius: initialRadius,
        zoom: 1,
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

    const toNDC = (ev: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
    };

    const updateHover = (ev: PointerEvent) => {
      const t = threeRef.current;
      if (!t) return;

      toNDC(ev);
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

    const addAtHover = () => {
      const target = hoverRef.current;
      if (!target) return;

      const k = keyOf(target);
      setBlocks((prev) => {
        if (prev.has(k)) return prev;
        const next = new Set(prev);
        next.add(k);
        trackRef.current("voxel_add", { x: target.x, y: target.y, z: target.z, blocks: next.size });
        return next;
      });

      const ac = requestAudioContext();
      if (ac) playPop(ac);
    };

    const removeAtHit = (ev: PointerEvent) => {
      const t = threeRef.current;
      if (!t) return;

      toNDC(ev);
      t.raycaster.setFromCamera(t.mouse, t.camera);
      const hits = t.raycaster.intersectObjects(t.cubesGroup.children, false);
      if (hits.length === 0) return;

      const obj = hits[0].object as any;
      const c = obj.userData.coord as Coord;
      const k = keyOf(c);

      setBlocks((prev) => {
        if (prev.size <= 1) return prev; // 最後の1個は残す
        const next = new Set(prev);
        next.delete(k);
        if (next.size === 0) next.add(keyOf({ x: 0, y: 0, z: 0 }));
        trackRef.current("voxel_remove", { x: c.x, y: c.y, z: c.z, blocks: next.size });
        return next;
      });

      const ac = requestAudioContext();
      if (ac) playClick(ac);
    };

    const onPointerMove = (ev: PointerEvent) => updateHover(ev);

    const onPointerDown = (ev: PointerEvent) => {
      // audio unlock
      requestAudioContext();

      // right click => delete
      if (ev.button === 2) {
        ev.preventDefault();
        removeAtHit(ev);
        return;
      }

      // left click => add
      if (ev.button === 0) addAtHover();
    };

    const onPointerLeave = () => {
      const t = threeRef.current;
      if (!t) return;
      t.highlightPlane.visible = false;
      t.previewCube.visible = false;
      hoverRef.current = null;
    };

    const onContextMenu = (ev: MouseEvent) => {
      ev.preventDefault();
    };

    let lastWheelLog = 0;
    const onWheel = (ev: WheelEvent) => {
      // マウスホイールでズーム（編集がしやすい）
      ev.preventDefault();
      const t = threeRef.current;
      if (!t) return;
      const factor = ev.deltaY > 0 ? 1.12 : 0.88; // 下スクロール=引く / 上スクロール=寄る
      t.anim.zoom = clamp(t.anim.zoom * factor, 0.35, 3.2);

      const now = Date.now();
      if (now - lastWheelLog > 350) {
        lastWheelLog = now;
        trackRef.current("editor_zoom", { method: "wheel", zoom: Number(t.anim.zoom.toFixed(3)) });
      }
    };

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

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

      const desired = new THREE.Vector3(targetR * cp2 * sy2, targetR * sp2, targetR * cp2 * cy2);
      t.camera.position.lerp(desired, 0.16);
      t.camera.lookAt(0, 0, 0);

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
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      renderer.domElement.removeEventListener("wheel", onWheel);

      cancelAnimationFrame(raf);

      // dispose
      if (threeRef.current) {
        Object.values(threeRef.current.refTextures).forEach((tex) => tex?.dispose());
        Object.values(threeRef.current.refPlanes).forEach((p) => p && disposeObject3D(p));
        disposeObject3D(threeRef.current.highlightPlane);
        disposeObject3D(threeRef.current.previewCube);
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

  // blocks 更新時に再構築
  useEffect(() => {
    rebuildCubes(blocks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

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

      {/* 左上：最低限の案内（うっすら） */}
      <div className="editorHud">
        <div className="editorHint">
          クリック: 追加 / 右クリック: 削除
          <br />
          ブロック: {cubeCount}
        </div>

        {/* 色とエッジ（最小UI） */}
        <div className="editorHudTools" aria-label="色とエッジ">
          <div className="swatches" aria-label="色">
            {BAMBU_FILAMENT_COLORS.map((c) => (
              <button
                key={c.name}
                type="button"
                className={`swatch ${cubeColor.toLowerCase() === c.hex.toLowerCase() ? "selected" : ""}`}
                title={c.name}
                aria-label={c.name}
                onClick={() => {
                  setCubeColor(c.hex);
                  track("color_change", { name: c.name, hex: c.hex });
                }}
                style={{ background: c.hex }}
              />
            ))}
          </div>
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
            title="エッジ"
            aria-label="エッジ"
          >
            エッジ
          </button>
        </div>
        <div className="editorHudActions">
          {!previewOpen && (
            <button type="button" className="hudLink" onClick={onOpenPreview}>
              プレビュー
            </button>
          )}
          <button type="button" className="hudLink" onClick={onClearAll}>
            リセット
          </button>
        </div>
      </div>

      {/* 端の三角：視点操作 */}
      <div className="overlayButtons">
        {showUp && (
          <button type="button" className="triBtn posUp" onClick={rotateUp} title="上から見る">
            <div className="tri up" />
          </button>
        )}
        {showDown && (
          <button type="button" className="triBtn posDown" onClick={rotateDown} title="下から見る">
            <div className="tri down" />
          </button>
        )}

        <button type="button" className="triBtn posLeft" onClick={rotateLeft} title="左へ">
          <div className="tri left" />
        </button>
        <button type="button" className="triBtn posRight" onClick={rotateRight} title="右へ">
          <div className="tri right" />
        </button>

        {/* ズーム（ホイールでもOK） */}
        <div className="zoomStack" aria-label="ズーム">
          <button type="button" className="zoomBtn" onClick={zoomIn} title="寄る">
            ＋
          </button>
          <button type="button" className="zoomBtn" onClick={zoomOut} title="引く">
            －
          </button>
        </div>
      </div>

      {/* 左下：アカウント */}
      <AccountFab />
    </div>
  );
}
