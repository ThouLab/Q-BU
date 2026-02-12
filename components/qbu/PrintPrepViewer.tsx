"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Group,
  Color,
  AmbientLight,
  DirectionalLight,
  BoxGeometry,
  MeshStandardMaterial,
  InstancedMesh,
  Matrix4,
  GridHelper,
  Object3D,
  Vector3,
} from "three";

import { parseKey, type Coord } from "./voxelUtils";
import {
  computeMixedBBox,
  expandBaseBlocksToSubCells,
  parseSubKey,
  subKeyOf,
  subMinToWorldCenter,
  worldMinToSubMin,
  type SubKey,
} from "./subBlocks";

const STEP_DEG = 45;
const STEP = (Math.PI / 180) * STEP_DEG;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
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

// Support cubes are 0.5 edge -> center is always (k*0.5 + 0.25)
function quantizeSupportCenter(v: number): number {
  return Math.round((v - 0.25) / 0.5) * 0.5 + 0.25;
}

type ThreeState = {
  renderer: InstanceType<typeof WebGLRenderer>;
  scene: InstanceType<typeof Scene>;
  camera: InstanceType<typeof PerspectiveCamera>;
  raycaster: InstanceType<typeof Raycaster>;
  mouse: InstanceType<typeof Vector2>;
  root: InstanceType<typeof Group>;

  cubeGeo: InstanceType<typeof BoxGeometry>;
  supportGeo: InstanceType<typeof BoxGeometry>;
  matMain: InstanceType<typeof MeshStandardMaterial>;
  matFloat: InstanceType<typeof MeshStandardMaterial>;
  matSupport: InstanceType<typeof MeshStandardMaterial>;

  meshMain?: InstanceType<typeof InstancedMesh>;
  meshFloat?: InstanceType<typeof InstancedMesh>;
  meshSupport?: InstanceType<typeof InstancedMesh>;
  meshSupportFloat?: InstanceType<typeof InstancedMesh>;
  grid?: InstanceType<typeof GridHelper>;

  keysMain: string[];
  keysFloat: string[];
  keysSupport: SubKey[];
  keysSupportFloat: SubKey[];

  anim: {
    yaw: number;
    pitch: number;
    zoom: number;
    baseRadius: number;
    center: Coord;
  };
};

function disposeMesh(m?: InstanceType<typeof InstancedMesh>) {
  if (!m) return;
  m.geometry.dispose();
  // materials are shared; do not dispose here
}

export default function PrintPrepViewer(props: {
  baseBlocks: Set<string>;
  supportBlocks: Set<SubKey>;
  floatingBase: Set<string>;
  floatingSupport: Set<SubKey>;
  onAddSupport: (k: SubKey) => void;
  onRemoveSupport: (k: SubKey) => void;
}) {
  const { baseBlocks, supportBlocks, floatingBase, floatingSupport, onAddSupport, onRemoveSupport } = props;

  // HUD: スマホは情報量を抑える
  const [isCompactHud, setIsCompactHud] = useState(false);
  const [showHelp, setShowHelp] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 600px)");
    const apply = () => setIsCompactHud(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  useEffect(() => {
    if (isCompactHud) setShowHelp(false);
    else setShowHelp(true);
  }, [isCompactHud]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const threeRef = useRef<ThreeState | null>(null);

  const [yawIndex, setYawIndex] = useState(1); // 右上から
  const [pitchIndex, setPitchIndex] = useState(1);

  // 状態参照（stale回避）
  const baseRef = useRef(baseBlocks);
  const supportRef = useRef(supportBlocks);
  const floatingBaseRef = useRef(floatingBase);
  const floatingSupportRef = useRef(floatingSupport);

  const baseSubCells = useMemo(() => expandBaseBlocksToSubCells(baseBlocks), [baseBlocks]);
  const baseSubCellsRef = useRef(baseSubCells);

  useEffect(() => {
    baseRef.current = baseBlocks;
  }, [baseBlocks]);
  useEffect(() => {
    supportRef.current = supportBlocks;
  }, [supportBlocks]);
  useEffect(() => {
    floatingBaseRef.current = floatingBase;
  }, [floatingBase]);
  useEffect(() => {
    floatingSupportRef.current = floatingSupport;
  }, [floatingSupport]);
  useEffect(() => {
    baseSubCellsRef.current = baseSubCells;
  }, [baseSubCells]);

  // 初期化
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const renderer = new WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(new Color("#f7f7fb"), 1);

    const scene = new Scene();
    const camera = new PerspectiveCamera(45, 1, 0.1, 2000);

    const raycaster = new Raycaster();
    const mouse = new Vector2();

    const root = new Group();
    scene.add(root);

    // lights
    const ambient = new AmbientLight(0xffffff, 0.75);
    scene.add(ambient);
    const dir = new DirectionalLight(0xffffff, 0.65);
    dir.position.set(10, 18, 12);
    scene.add(dir);

    const cubeGeo = new BoxGeometry(1, 1, 1);
    const supportGeo = new BoxGeometry(0.5, 0.5, 0.5);

    const matMain = new MeshStandardMaterial({ color: new Color("#d1d5db"), roughness: 1, metalness: 0 });
    const matFloat = new MeshStandardMaterial({ color: new Color("#ef4444"), roughness: 1, metalness: 0 });
    const matSupport = new MeshStandardMaterial({ color: new Color("#3b82f6"), roughness: 1, metalness: 0 });

    const st: ThreeState = {
      renderer,
      scene,
      camera,
      raycaster,
      mouse,
      root,
      cubeGeo,
      supportGeo,
      matMain,
      matFloat,
      matSupport,
      keysMain: [],
      keysFloat: [],
      keysSupport: [],
      keysSupportFloat: [],
      anim: {
        yaw: yawIndex * STEP,
        pitch: pitchIndex * STEP,
        zoom: 1,
        baseRadius: 20,
        center: { x: 0, y: 0, z: 0 },
      },
    };

    threeRef.current = st;
    renderer.domElement.style.touchAction = "none";
    el.appendChild(renderer.domElement);

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = Math.max(1e-6, w / Math.max(1, h));
      camera.updateProjectionMatrix();
    };

    resize();

    const onResize = () => resize();
    window.addEventListener("resize", onResize);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = threeRef.current;
      if (!t) return;

      const r = t.anim.baseRadius * t.anim.zoom;
      const yaw = t.anim.yaw;
      const pitch = t.anim.pitch;
      const cx = t.anim.center.x;
      const cy = t.anim.center.y;
      const cz = t.anim.center.z;

      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const cyaw = Math.cos(yaw);
      const syaw = Math.sin(yaw);

      t.camera.position.set(cx + r * cp * cyaw, cy + r * sp, cz + r * cp * syaw);
      t.camera.lookAt(cx, cy, cz);

      t.renderer.render(t.scene, t.camera);
    };

    loop();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      try {
        el.removeChild(renderer.domElement);
      } catch {
        // ignore
      }
      disposeMesh(st.meshMain);
      disposeMesh(st.meshFloat);
      disposeMesh(st.meshSupport);
      disposeMesh(st.meshSupportFloat);
      cubeGeo.dispose();
      supportGeo.dispose();
      matMain.dispose();
      matFloat.dispose();
      matSupport.dispose();
      renderer.dispose();
      threeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Space: reset pan center
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.code !== "Space" && ev.key !== " ") return;
      ev.preventDefault();
      const t = threeRef.current;
      if (!t) return;
      t.anim.center = { x: 0, y: 0, z: 0 };
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

// カメラターゲット（状態）
  useEffect(() => {
    const t = threeRef.current;
    if (!t) return;
    t.anim.yaw = yawIndex * STEP;
    t.anim.pitch = pitchIndex * STEP;
  }, [yawIndex, pitchIndex]);

  // モデル更新（メッシュ再構築）
  useEffect(() => {
    const t = threeRef.current;
    if (!t) return;

    // root children cleanup (meshes/grid)
    if (t.meshMain) {
      t.root.remove(t.meshMain);
      disposeMesh(t.meshMain);
      t.meshMain = undefined;
    }
    if (t.meshFloat) {
      t.root.remove(t.meshFloat);
      disposeMesh(t.meshFloat);
      t.meshFloat = undefined;
    }
    if (t.meshSupport) {
      t.root.remove(t.meshSupport);
      disposeMesh(t.meshSupport);
      t.meshSupport = undefined;
    }
    if (t.meshSupportFloat) {
      t.root.remove(t.meshSupportFloat);
      disposeMesh(t.meshSupportFloat);
      t.meshSupportFloat = undefined;
    }
    if (t.grid) {
      t.scene.remove(t.grid);
      t.grid.geometry.dispose();
      (t.grid.material as any).dispose?.();
      t.grid = undefined;
    }

    const mainKeys: string[] = [];
    const floatKeys: string[] = [];
    for (const k of baseBlocks) {
      if (floatingBase.has(k)) floatKeys.push(k);
      else mainKeys.push(k);
    }

    const supportKeys: SubKey[] = [];
    const supportFloatKeys: SubKey[] = [];
    for (const sk of supportBlocks) {
      if (floatingSupport.has(sk)) supportFloatKeys.push(sk);
      else supportKeys.push(sk);
    }

    const bb = computeMixedBBox(baseBlocks, supportBlocks);

    // root moves model so bbox.center becomes origin
    t.root.position.set(-bb.center.x, -bb.center.y, -bb.center.z);

    // base radius depends on model size
    t.anim.baseRadius = Math.max(12, bb.maxDim * 2.8 + 8);

    // grid helper
    const gridSize = Math.max(12, Math.ceil(bb.maxDim + 16));
    const grid = new GridHelper(gridSize, gridSize);
    (grid.material as any).opacity = 0.22;
    (grid.material as any).transparent = true;
    // Keep the grid on the model's bottom face.
    grid.position.y = -bb.size.y / 2 - 0.001;
    t.grid = grid;
    t.scene.add(grid);

    // instanced meshes
    const mk = mainKeys;
    const fk = floatKeys;
    const sk = supportKeys;
    const sfk = supportFloatKeys;

    if (mk.length > 0) {
      const m = new InstancedMesh(t.cubeGeo.clone(), t.matMain, mk.length);
      const mat = new Matrix4();
      for (let i = 0; i < mk.length; i++) {
        const c = parseKey(mk[i]!);
        mat.makeTranslation(c.x, c.y, c.z);
        m.setMatrixAt(i, mat);
      }
      m.instanceMatrix.needsUpdate = true;
      t.meshMain = m;
      t.root.add(m);
    }

    if (fk.length > 0) {
      const m = new InstancedMesh(t.cubeGeo.clone(), t.matFloat, fk.length);
      const mat = new Matrix4();
      for (let i = 0; i < fk.length; i++) {
        const c = parseKey(fk[i]!);
        mat.makeTranslation(c.x, c.y, c.z);
        m.setMatrixAt(i, mat);
      }
      m.instanceMatrix.needsUpdate = true;
      t.meshFloat = m;
      t.root.add(m);
    }

    if (sk.length > 0) {
      const m = new InstancedMesh(t.supportGeo.clone(), t.matSupport, sk.length);
      const mat = new Matrix4();
      for (let i = 0; i < sk.length; i++) {
        const c = subMinToWorldCenter(parseSubKey(sk[i]!));
        mat.makeTranslation(c.x, c.y, c.z);
        m.setMatrixAt(i, mat);
      }
      m.instanceMatrix.needsUpdate = true;
      t.meshSupport = m;
      t.root.add(m);
    }

    if (sfk.length > 0) {
      const m = new InstancedMesh(t.supportGeo.clone(), t.matFloat, sfk.length);
      const mat = new Matrix4();
      for (let i = 0; i < sfk.length; i++) {
        const c = subMinToWorldCenter(parseSubKey(sfk[i]!));
        mat.makeTranslation(c.x, c.y, c.z);
        m.setMatrixAt(i, mat);
      }
      m.instanceMatrix.needsUpdate = true;
      t.meshSupportFloat = m;
      t.root.add(m);
    }

    t.keysMain = mk;
    t.keysFloat = fk;
    t.keysSupport = sk;
    t.keysSupportFloat = sfk;
  }, [baseBlocks, supportBlocks, floatingBase, floatingSupport]);
  const PAN_BUTTONS = 4; // mouse middle button
  const TAP_MOVE_PX = 8;
  const LONG_PRESS_MS = 480;

  const gestureRef = useRef({
    mousePanning: false,
    lastMouseX: 0,
    lastMouseY: 0,

    touches: new Map<number, { x: number; y: number }>(),
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
  });

  const clearLongPress = () => {
    const g = gestureRef.current;
    if (g.longPressTimer) {
      window.clearTimeout(g.longPressTimer);
      g.longPressTimer = 0;
    }
  };

  const panByPixels = (dx: number, dy: number) => {
    const t = threeRef.current;
    const el = wrapRef.current;
    if (!t || !el) return;

    const rect = el.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);

    const center = new Vector3(t.anim.center.x, t.anim.center.y, t.anim.center.z);
    const dist = t.camera.position.distanceTo(center);
    const fov = (t.camera.fov * Math.PI) / 180;
    const worldPerPixelY = (2 * dist * Math.tan(fov / 2)) / h;
    const worldPerPixelX = worldPerPixelY * (w / h);

    const forward = new Vector3();
    t.camera.getWorldDirection(forward);
    const upWorld = new Vector3(0, 1, 0).applyQuaternion(t.camera.quaternion).normalize();
    const rightWorld = new Vector3().crossVectors(forward, upWorld).normalize();

    const delta = new Vector3()
      .addScaledVector(rightWorld, -dx * worldPerPixelX)
      .addScaledVector(upWorld, dy * worldPerPixelY);

    t.anim.center = {
      x: t.anim.center.x + delta.x,
      y: t.anim.center.y + delta.y,
      z: t.anim.center.z + delta.z,
    };
  };

  const handlePointerAt = (clientX: number, clientY: number, action: "add" | "remove") => {
    const t = threeRef.current;
    const el = wrapRef.current;
    if (!t || !el) return;

    const rect = el.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    t.mouse.set(x, y);
    t.raycaster.setFromCamera(t.mouse, t.camera);

    const objs: InstanceType<typeof Object3D>[] = [];
    // prioritize supports (smaller)
    if (t.meshSupport) objs.push(t.meshSupport);
    if (t.meshSupportFloat) objs.push(t.meshSupportFloat);
    if (t.meshFloat) objs.push(t.meshFloat);
    if (t.meshMain) objs.push(t.meshMain);

    const hits = t.raycaster.intersectObjects(objs, false);
    if (hits.length === 0) return;

    const hit = hits[0]!;
    const obj = hit.object as any;
    const instanceId = (hit as any).instanceId as number | undefined;
    if (instanceId === undefined || instanceId === null) return;

    const isSupport = obj === t.meshSupport || obj === t.meshSupportFloat;

    // remove: supports only
    if (action === "remove") {
      if (!isSupport) return;
      const k = obj === t.meshSupport ? t.keysSupport[instanceId] : t.keysSupportFloat[instanceId];
      if (!k) return;
      onRemoveSupport(k);
      return;
    }

    // add: place a 0.5 support cube adjacent to the clicked face
    const faceN = snapAxisNormal(hit.face?.normal ?? { x: 0, y: 1, z: 0 });

    let clickedCenter: Coord = { x: 0, y: 0, z: 0 };
    let clickedHalf = 0.5;

    if (isSupport) {
      const k = obj === t.meshSupport ? t.keysSupport[instanceId] : t.keysSupportFloat[instanceId];
      if (!k) return;
      clickedCenter = subMinToWorldCenter(parseSubKey(k));
      clickedHalf = 0.25;
    } else {
      const k = obj === t.meshFloat ? t.keysFloat[instanceId] : t.keysMain[instanceId];
      if (!k) return;
      clickedCenter = parseKey(k);
      clickedHalf = 0.5;
    }

    // hit point in model space (root local)
    const p = new Vector3(hit.point.x, hit.point.y, hit.point.z);
    p.sub(t.root.position);

    const newCenter: Coord = { x: 0, y: 0, z: 0 };

    for (const axis of ["x", "y", "z"] as const) {
      const n = (faceN as any)[axis] as number;
      if (n !== 0) {
        // along normal axis, move outside by (clickedHalf + supportHalf)
        const v = (clickedCenter as any)[axis] + n * (clickedHalf + 0.25);
        (newCenter as any)[axis] = quantizeSupportCenter(v);
      } else {
        // within face plane, snap based on click location
        const v = (p as any)[axis] as number;
        (newCenter as any)[axis] = quantizeSupportCenter(v);
      }
    }

    const minWorld: Coord = { x: newCenter.x - 0.25, y: newCenter.y - 0.25, z: newCenter.z - 0.25 };
    const subMin = worldMinToSubMin(minWorld);
    const newKey = subKeyOf(subMin);

    // collision checks (do not place inside base blocks or on existing supports)
    if (baseSubCellsRef.current.has(newKey)) return;
    if (supportRef.current.has(newKey)) return;

    onAddSupport(newKey);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const g = gestureRef.current;

    if (e.pointerType === "mouse") {
      // middle button drag => pan
      if (e.button === 1) {
        e.preventDefault();
        g.mousePanning = true;
        g.lastMouseX = e.clientX;
        g.lastMouseY = e.clientY;
        return;
      }

      // right click remove (only when right button alone)
      if (e.button === 2) {
        if (e.buttons === 2) {
          e.preventDefault();
          handlePointerAt(e.clientX, e.clientY, "remove");
        }
        return;
      }

      // left click add (only when left button alone)
      if (e.button === 0 && e.buttons === 1) {
        handlePointerAt(e.clientX, e.clientY, "add");
      }
      return;
    }

    if (e.pointerType === "touch") {
      e.preventDefault();
      const el = e.currentTarget as HTMLElement;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }

      g.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (g.touches.size === 1) {
        g.mode = "one";
        g.startX = e.clientX;
        g.startY = e.clientY;
        g.moved = false;
        g.longPressFired = false;
        clearLongPress();

        g.longPressTimer = window.setTimeout(() => {
          if (g.mode !== "one") return;
          if (g.moved) return;
          if (g.touches.size !== 1) return;
          g.longPressFired = true;
          handlePointerAt(g.startX, g.startY, "remove");
        }, LONG_PRESS_MS);

        return;
      }

      // 2 finger => pan/zoom
      clearLongPress();
      g.mode = "two";
      const pts = [...g.touches.values()];
      const p0 = pts[0]!;
      const p1 = pts[1]!;
      g.pinchStartDist = Math.hypot(p0.x - p1.x, p0.y - p1.y);
      const t = threeRef.current;
      g.pinchStartZoom = t ? t.anim.zoom : 1;
      g.lastMidX = (p0.x + p1.x) / 2;
      g.lastMidY = (p0.y + p1.y) / 2;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gestureRef.current;

    if (e.pointerType === "mouse") {
      if (e.buttons === PAN_BUTTONS) {
        e.preventDefault();
        if (!g.mousePanning) {
          g.mousePanning = true;
          g.lastMouseX = e.clientX;
          g.lastMouseY = e.clientY;
          return;
        }
        const dx = e.clientX - g.lastMouseX;
        const dy = e.clientY - g.lastMouseY;
        g.lastMouseX = e.clientX;
        g.lastMouseY = e.clientY;
        panByPixels(dx, dy);
        return;
      }

      if (g.mousePanning) g.mousePanning = false;
      return;
    }

    if (e.pointerType === "touch") {
      e.preventDefault();
      if (!g.touches.has(e.pointerId)) return;
      g.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (g.touches.size === 1 && g.mode === "one") {
        const dx = e.clientX - g.startX;
        const dy = e.clientY - g.startY;
        if (!g.moved && Math.hypot(dx, dy) > TAP_MOVE_PX) {
          g.moved = true;
          clearLongPress();
        }
        return;
      }

      if (g.touches.size >= 2) {
        clearLongPress();
        if (g.mode !== "two") {
          g.mode = "two";
          const pts = [...g.touches.values()];
          const p0 = pts[0]!;
          const p1 = pts[1]!;
          g.pinchStartDist = Math.hypot(p0.x - p1.x, p0.y - p1.y);
          const t = threeRef.current;
          g.pinchStartZoom = t ? t.anim.zoom : 1;
          g.lastMidX = (p0.x + p1.x) / 2;
          g.lastMidY = (p0.y + p1.y) / 2;
        }

        const pts = [...g.touches.values()];
        const p0 = pts[0]!;
        const p1 = pts[1]!;
        const midX = (p0.x + p1.x) / 2;
        const midY = (p0.y + p1.y) / 2;
        const dist = Math.hypot(p0.x - p1.x, p0.y - p1.y);

        panByPixels(midX - g.lastMidX, midY - g.lastMidY);
        g.lastMidX = midX;
        g.lastMidY = midY;

        const t = threeRef.current;
        if (t && g.pinchStartDist > 2 && dist > 2) {
          const factor = g.pinchStartDist / dist;
          t.anim.zoom = clamp(g.pinchStartZoom * factor, 0.35, 3.0);
        }
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gestureRef.current;

    if (e.pointerType === "mouse") {
      if (g.mousePanning && e.buttons !== PAN_BUTTONS) g.mousePanning = false;
      return;
    }

    if (e.pointerType === "touch") {
      e.preventDefault();

      if (g.mode === "one") {
        clearLongPress();
        if (!g.moved && !g.longPressFired) {
          handlePointerAt(e.clientX, e.clientY, "add");
        }
      }

      g.touches.delete(e.pointerId);

      if (g.touches.size == 0) {
        g.mode = "none";
        g.moved = false;
        g.longPressFired = false;
        clearLongPress();
        return;
      }

      if (g.touches.size == 1) {
        // Prevent accidental tap/add after pinch.
        g.mode = "one";
        const p = [...g.touches.values()][0]!;
        g.startX = p.x;
        g.startY = p.y;
        g.moved = true;
        g.longPressFired = false;
        clearLongPress();
        return;
      }

      g.mode = "two";
    }
  };


  const rotateLeft = () => setYawIndex((v) => v - 1);
  const rotateRight = () => setYawIndex((v) => v + 1);
  const rotateUp = () => setPitchIndex((v) => clamp(v + 1, -2, 2));
  const rotateDown = () => setPitchIndex((v) => clamp(v - 1, -2, 2));

  const zoomIn = () => {
    const t = threeRef.current;
    if (!t) return;
    t.anim.zoom = clamp(t.anim.zoom * 0.9, 0.35, 3.0);
  };
  const zoomOut = () => {
    const t = threeRef.current;
    if (!t) return;
    t.anim.zoom = clamp(t.anim.zoom / 0.9, 0.35, 3.0);
  };

  const showUp = pitchIndex < 2;
  const showDown = pitchIndex > -2;

  const floatingTotal = floatingBase.size + floatingSupport.size;

  return (
    <div className="prepViewerRoot">
      <div
        className="prepCanvasWrap"
        ref={wrapRef}
        onContextMenu={(e) => {
          e.preventDefault();
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => {
          e.preventDefault();
          const t = threeRef.current;
          if (!t) return;
          const delta = Math.sign(e.deltaY);
          if (delta > 0) t.anim.zoom = clamp(t.anim.zoom / 0.93, 0.35, 3.0);
          else t.anim.zoom = clamp(t.anim.zoom * 0.93, 0.35, 3.0);
        }}
      />

      <div className={`prepHud ${isCompactHud ? "compact" : ""}`}>
        {(!isCompactHud || showHelp) && (
          <div className={`prepHint ${isCompactHud ? "compact" : ""}`}>
            {isCompactHud ? (
              <>
                タップ: 補完(0.5)追加　長押し: 補完削除
                <br />
                2本指: 移動　ピンチ: ズーム
                <br />
                赤: 浮動 / 青: 補完
              </>
            ) : (
              <>
                クリック/タップ: 補完ブロック（0.5）追加　右クリック/長押し: 補完ブロック削除
                <br />
                中ボタン/2本指: 移動　ホイール/ピンチ: ズーム　Space: 中央へ
                <br />
                赤: 浮動 / 青: 補完
              </>
            )}
          </div>
        )}

        <div className="prepCountsRow">
          <div className="prepCounts">
            ブロック: {baseBlocks.size}　補完: {supportBlocks.size}　浮動: {floatingTotal}
            {floatingSupport.size > 0 && `（支柱:${floatingSupport.size}）`}
          </div>

          {isCompactHud && (
            <button
              type="button"
              className={`miniToggle ${showHelp ? "on" : ""}`}
              onClick={() => setShowHelp((v) => !v)}
              title="操作"
              aria-label="操作"
            >
              操作
            </button>
          )}
        </div>
      </div>

      <div className="overlayButtons">
        {showUp && (
          <button type="button" className="triBtn posUp" onClick={rotateUp} title="上から">
            <div className="tri up" />
          </button>
        )}
        {showDown && (
          <button type="button" className="triBtn posDown" onClick={rotateDown} title="下から">
            <div className="tri down" />
          </button>
        )}

        <button type="button" className="triBtn posLeft" onClick={rotateLeft} title="左へ">
          <div className="tri left" />
        </button>
        <button type="button" className="triBtn posRight" onClick={rotateRight} title="右へ">
          <div className="tri right" />
        </button>

        <div className="zoomStack" aria-label="ズーム">
          <button type="button" className="zoomBtn" onClick={zoomIn} title="寄る">
            ＋
          </button>
          <button type="button" className="zoomBtn" onClick={zoomOut} title="引く">
            －
          </button>
        </div>
      </div>
    </div>
  );
}
