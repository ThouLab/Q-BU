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
} from "three";

import { add, computeBBox, keyOf, parseKey, type Coord } from "./voxelUtils";

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

type ThreeState = {
  renderer: InstanceType<typeof WebGLRenderer>;
  scene: InstanceType<typeof Scene>;
  camera: InstanceType<typeof PerspectiveCamera>;
  raycaster: InstanceType<typeof Raycaster>;
  mouse: InstanceType<typeof Vector2>;
  root: InstanceType<typeof Group>;

  cubeGeo: InstanceType<typeof BoxGeometry>;
  matMain: InstanceType<typeof MeshStandardMaterial>;
  matFloat: InstanceType<typeof MeshStandardMaterial>;
  matExtra: InstanceType<typeof MeshStandardMaterial>;

  meshMain?: InstanceType<typeof InstancedMesh>;
  meshFloat?: InstanceType<typeof InstancedMesh>;
  meshExtra?: InstanceType<typeof InstancedMesh>;
  grid?: InstanceType<typeof GridHelper>;

  keysMain: string[];
  keysFloat: string[];
  keysExtra: string[];

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
  extraBlocks: Set<string>;
  floating: Set<string>;
  onAddExtra: (c: Coord) => void;
  onRemoveExtra: (c: Coord) => void;
}) {
  const { baseBlocks, extraBlocks, floating, onAddExtra, onRemoveExtra } = props;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const threeRef = useRef<ThreeState | null>(null);

  const [yawIndex, setYawIndex] = useState(1); // 右上から
  const [pitchIndex, setPitchIndex] = useState(1);

  // 状態参照（stale回避）
  const baseRef = useRef(baseBlocks);
  const extraRef = useRef(extraBlocks);
  const floatingRef = useRef(floating);
  useEffect(() => {
    baseRef.current = baseBlocks;
  }, [baseBlocks]);
  useEffect(() => {
    extraRef.current = extraBlocks;
  }, [extraBlocks]);
  useEffect(() => {
    floatingRef.current = floating;
  }, [floating]);

  const combined = useMemo(() => {
    const s = new Set<string>(baseBlocks);
    for (const k of extraBlocks) s.add(k);
    return s;
  }, [baseBlocks, extraBlocks]);

  // bbox は将来の調整用に残す（現状は computeBBox だけでOK）
  useMemo(() => computeBBox(combined), [combined]);

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
    const matMain = new MeshStandardMaterial({ color: new Color("#d1d5db"), roughness: 1, metalness: 0 });
    const matFloat = new MeshStandardMaterial({ color: new Color("#ef4444"), roughness: 1, metalness: 0 });
    const matExtra = new MeshStandardMaterial({ color: new Color("#3b82f6"), roughness: 1, metalness: 0 });

    const st: ThreeState = {
      renderer,
      scene,
      camera,
      raycaster,
      mouse,
      root,
      cubeGeo,
      matMain,
      matFloat,
      matExtra,
      keysMain: [],
      keysFloat: [],
      keysExtra: [],
      anim: {
        yaw: yawIndex * STEP,
        pitch: pitchIndex * STEP,
        zoom: 1,
        baseRadius: 20,
        center: { x: 0, y: 0, z: 0 },
      },
    };

    threeRef.current = st;
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
      disposeMesh(st.meshExtra);
      cubeGeo.dispose();
      matMain.dispose();
      matFloat.dispose();
      matExtra.dispose();
      renderer.dispose();
      threeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (t.meshExtra) {
      t.root.remove(t.meshExtra);
      disposeMesh(t.meshExtra);
      t.meshExtra = undefined;
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
      if (floating.has(k)) floatKeys.push(k);
      else mainKeys.push(k);
    }
    const extraKeys = Array.from(extraBlocks);

    // bbox and centering
    const bb = computeBBox(new Set<string>([...baseBlocks, ...extraBlocks]));
    t.anim.center = { x: 0, y: 0, z: 0 };

    // root moves model so bbox.center becomes origin
    t.root.position.set(-bb.center.x, -bb.center.y, -bb.center.z);

    // base radius depends on model size
    t.anim.baseRadius = Math.max(12, bb.maxDim * 2.8 + 8);

    // grid helper
    const gridSize = Math.max(12, bb.maxDim + 16);
    const grid = new GridHelper(gridSize, gridSize);
    (grid.material as any).opacity = 0.22;
    (grid.material as any).transparent = true;
    t.grid = grid;
    t.scene.add(grid);

    // instanced meshes
    const mk = mainKeys;
    const fk = floatKeys;
    const ek = extraKeys;

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

    if (ek.length > 0) {
      const m = new InstancedMesh(t.cubeGeo.clone(), t.matExtra, ek.length);
      const mat = new Matrix4();
      for (let i = 0; i < ek.length; i++) {
        const c = parseKey(ek[i]!);
        mat.makeTranslation(c.x, c.y, c.z);
        m.setMatrixAt(i, mat);
      }
      m.instanceMatrix.needsUpdate = true;
      t.meshExtra = m;
      t.root.add(m);
    }

    t.keysMain = mk;
    t.keysFloat = fk;
    t.keysExtra = ek;
  }, [baseBlocks, extraBlocks, floating]);

  const handlePointer = (ev: React.MouseEvent, isRightClick: boolean) => {
    const t = threeRef.current;
    const el = wrapRef.current;
    if (!t || !el) return;

    const rect = el.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
    t.mouse.set(x, y);
    t.raycaster.setFromCamera(t.mouse, t.camera);

    const objs: InstanceType<typeof Object3D>[] = [];
    if (t.meshExtra) objs.push(t.meshExtra);
    if (t.meshFloat) objs.push(t.meshFloat);
    if (t.meshMain) objs.push(t.meshMain);

    const hits = t.raycaster.intersectObjects(objs, false);
    if (hits.length === 0) return;

    const hit = hits[0]!;
    const obj = hit.object as any;
    const instanceId = (hit as any).instanceId as number | undefined;
    if (instanceId === undefined || instanceId === null) return;

    const isExtra = obj === t.meshExtra;

    // 右クリック: extraのみ削除
    if (isRightClick) {
      if (!isExtra) return;
      const k = t.keysExtra[instanceId];
      if (!k) return;
      onRemoveExtra(parseKey(k));
      return;
    }

    // 左クリック: 面方向に 1 ブロック追加（extraとして）
    const baseKey =
      isExtra
        ? t.keysExtra[instanceId]
        : obj === t.meshFloat
          ? t.keysFloat[instanceId]
          : t.keysMain[instanceId];

    if (!baseKey) return;

    const baseCoord = parseKey(baseKey);
    const n = snapAxisNormal(hit.face?.normal ?? { x: 0, y: 1, z: 0 });
    const next = add(baseCoord, n);
    const nk = keyOf(next);

    if (baseRef.current.has(nk)) return;
    if (extraRef.current.has(nk)) return;
    onAddExtra(next);
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

  return (
    <div className="prepViewerRoot">
      <div
        className="prepCanvasWrap"
        ref={wrapRef}
        onContextMenu={(e) => {
          e.preventDefault();
        }}
        onMouseDown={(e) => {
          if (e.button === 2) return;
          handlePointer(e, false);
        }}
        onMouseUp={(e) => {
          if (e.button === 2) {
            handlePointer(e, true);
          }
        }}
        onWheel={(e) => {
          const t = threeRef.current;
          if (!t) return;
          const delta = Math.sign(e.deltaY);
          if (delta > 0) t.anim.zoom = clamp(t.anim.zoom / 0.93, 0.35, 3.0);
          else t.anim.zoom = clamp(t.anim.zoom * 0.93, 0.35, 3.0);
        }}
      />

      <div className="prepHud">
        <div className="prepHint">
          クリック: 補完ブロック追加 / 右クリック: 補完ブロック削除
          <br />
          赤: 浮動 / 青: 補完
        </div>
        <div className="prepCounts">
          ブロック: {baseBlocks.size}　補完: {extraBlocks.size}　浮動: {floating.size}
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
