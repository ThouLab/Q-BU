"use client";

import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import {
  COLOR_META,
  type Coord,
  type VoxelModel,
  type WorkshopColor,
  isWithinGrid,
  keyOf,
  normalizeModel,
  toBlockMap
} from "@/components/standalone/editor-model";

type ToolMode = "add" | "remove" | "pan" | "rotate";

export type ExtendCandidate = {
  kind: "face";
  from: Coord;
  normal: Coord;
};

type PickResult = ExtendCandidate;

type Props = {
  model: VoxelModel;
  toolMode: ToolMode;
  color: WorkshopColor;
  gridSize: number;
  maxBlocks: number;
  onChange: (model: VoxelModel) => void;
  onExtendCandidate: (candidate: ExtendCandidate) => void;
};

type PointerState = {
  startX: number;
  startY: number;
  x: number;
  y: number;
  hit: PickResult | null;
};

const TAP_TOLERANCE_PX = 14;
const MIN_CAMERA_DISTANCE = 3;
const MAX_CAMERA_DISTANCE = 80;
const START_TARGET_Y_OFFSET = 1.05;
const DEFAULT_CAMERA = {
  yaw: 0.76,
  pitch: 0.5,
  distance: 7.5,
  targetX: 0,
  targetY: START_TARGET_Y_OFFSET,
  targetZ: 0
};

const snapAxisNormal = (normal: THREE.Vector3): Coord => {
  const absX = Math.abs(normal.x);
  const absY = Math.abs(normal.y);
  const absZ = Math.abs(normal.z);

  if (absX >= absY && absX >= absZ) return { x: normal.x >= 0 ? 1 : -1, y: 0, z: 0 };
  if (absY >= absX && absY >= absZ) return { x: 0, y: normal.y >= 0 ? 1 : -1, z: 0 };
  return { x: 0, y: 0, z: normal.z >= 0 ? 1 : -1 };
};

const capturePointer = (element: HTMLElement, pointerId: number): boolean => {
  try {
    element.setPointerCapture(pointerId);
    return true;
  } catch {
    return false;
  }
};

const isFaceCandidate = (candidate: PickResult | null): candidate is ExtendCandidate => Boolean(candidate);

export default function VoxelStage(props: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const threeRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    group: THREE.Group;
    raycaster: THREE.Raycaster;
    pointer: THREE.Vector2;
  } | null>(null);
  const propsRef = useRef(props);
  const viewRef = useRef({ ...DEFAULT_CAMERA });
  const hasFramedInitialModelRef = useRef(false);
  const pointerMapRef = useRef(new Map<number, PointerState>());
  const gestureRef = useRef<{ distance: number; midX: number; midY: number } | null>(null);
  const pressTimerRef = useRef<number | null>(null);
  const pressMovedRef = useRef(false);
  const longPressTriggeredRef = useRef(false);
  const lastCommitAtRef = useRef(0);

  useEffect(() => {
    propsRef.current = props;
  }, [props]);

  const updateCamera = useCallback(() => {
    const three = threeRef.current;
    if (!three) return;
    const view = viewRef.current;
    const radius = Math.max(MIN_CAMERA_DISTANCE, view.distance);
    const target = new THREE.Vector3(view.targetX, view.targetY, view.targetZ);
    three.camera.position.set(
      target.x + Math.sin(view.yaw) * Math.cos(view.pitch) * radius,
      target.y + Math.sin(view.pitch) * radius,
      target.z + Math.cos(view.yaw) * Math.cos(view.pitch) * radius
    );
    three.camera.lookAt(target);
    three.renderer.render(three.scene, three.camera);
  }, []);

  const frameModel = useCallback((model: VoxelModel) => {
    const blocks = normalizeModel(model).blocks;
    const view = viewRef.current;
    if (blocks.length === 0) {
      Object.assign(view, DEFAULT_CAMERA);
      return;
    }

    const bounds = blocks.reduce(
      (current, block) => ({
        minX: Math.min(current.minX, block.x),
        maxX: Math.max(current.maxX, block.x),
        minY: Math.min(current.minY, block.y),
        maxY: Math.max(current.maxY, block.y),
        minZ: Math.min(current.minZ, block.z),
        maxZ: Math.max(current.maxZ, block.z)
      }),
      {
        minX: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
        minZ: Number.POSITIVE_INFINITY,
        maxZ: Number.NEGATIVE_INFINITY
      }
    );

    const spanX = bounds.maxX - bounds.minX + 1;
    const spanY = bounds.maxY - bounds.minY + 1;
    const spanZ = bounds.maxZ - bounds.minZ + 1;
    const maxSpan = Math.max(spanX, spanY, spanZ);

    view.yaw = DEFAULT_CAMERA.yaw;
    view.pitch = DEFAULT_CAMERA.pitch;
    view.distance = Math.min(MAX_CAMERA_DISTANCE, Math.max(DEFAULT_CAMERA.distance, maxSpan * 2.4));
    view.targetX = (bounds.minX + bounds.maxX) / 2;
    view.targetY = (bounds.minY + bounds.maxY) / 2 + START_TARGET_Y_OFFSET;
    view.targetZ = (bounds.minZ + bounds.maxZ) / 2;
  }, []);

  const panCamera = useCallback(
    (deltaX: number, deltaY: number) => {
      const three = threeRef.current;
      if (!three) return;

      three.camera.updateMatrixWorld();
      const height = Math.max(1, three.renderer.domElement.clientHeight);
      const visibleHeight =
        2 * Math.tan(((three.camera.fov * Math.PI) / 180) / 2) * viewRef.current.distance;
      const unitsPerPixel = visibleHeight / height;
      const right = new THREE.Vector3().setFromMatrixColumn(three.camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(three.camera.matrixWorld, 1);
      const movement = right
        .multiplyScalar(-deltaX * unitsPerPixel)
        .add(up.multiplyScalar(deltaY * unitsPerPixel));
      const view = viewRef.current;

      view.targetX += movement.x;
      view.targetY += movement.y;
      view.targetZ += movement.z;
      updateCamera();
    },
    [updateCamera]
  );

  const disposeGroup = useCallback((group: THREE.Group) => {
    const geometries = new Set<{ dispose: () => void }>();
    const materials = new Set<{ dispose: () => void }>();
    group.traverse((object) => {
      const renderable = object as {
        geometry?: { dispose?: () => void };
        material?: { dispose?: () => void } | Array<{ dispose?: () => void }>;
      };
      if (renderable.geometry?.dispose) geometries.add(renderable.geometry as { dispose: () => void });
      const objectMaterials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
      for (const material of objectMaterials) {
        if (material?.dispose) materials.add(material as { dispose: () => void });
      }
    });
    group.clear();
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
  }, []);

  const rebuildCubes = useCallback(() => {
    const three = threeRef.current;
    if (!three) return;
    disposeGroup(three.group);
    const geometry = new THREE.BoxGeometry(0.96, 0.96, 0.96);
    const edgeGeometry = new THREE.EdgesGeometry(geometry);

    for (const block of normalizeModel(propsRef.current.model).blocks) {
      const material = new THREE.MeshStandardMaterial({
        color: COLOR_META[block.color].hex,
        roughness: 0.65,
        metalness: 0.02
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(block.x, block.y, block.z);
      mesh.userData.coord = { x: block.x, y: block.y, z: block.z };
      mesh.userData.key = keyOf(block);
      const edges = new THREE.LineSegments(
        edgeGeometry,
        new THREE.LineBasicMaterial({ color: "#0f172a", transparent: true, opacity: 0.25 })
      );
      mesh.add(edges);
      three.group.add(mesh);
    }

    if (!hasFramedInitialModelRef.current) {
      frameModel(propsRef.current.model);
      hasFramedInitialModelRef.current = true;
    }

    updateCamera();
  }, [disposeGroup, frameModel, updateCamera]);

  const pick = useCallback((clientX: number, clientY: number): PickResult | null => {
    const three = threeRef.current;
    if (!three) return null;
    const rect = three.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    three.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    three.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    three.group.updateMatrixWorld(true);
    three.raycaster.setFromCamera(three.pointer, three.camera);
    const hits = three.raycaster.intersectObjects(three.group.children, false);
    const hit = hits[0];
    if (hit?.object?.userData?.coord) {
      const from = hit.object.userData.coord as Coord;
      const faceNormalLocal = hit.face?.normal?.clone() ?? new THREE.Vector3(0, 1, 0);
      const normalWorld = faceNormalLocal
        .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
        .normalize();
      return { kind: "face", from, normal: snapAxisNormal(normalWorld) };
    }

    return null;
  }, []);

  const commitTap = useCallback((hit: PickResult | null) => {
    const current = propsRef.current;
    const model = normalizeModel(current.model);
    const map = toBlockMap(model);

    if (!hit) {
      if (current.toolMode === "add" && model.blocks.length === 0) {
        current.onChange({ version: 1, blocks: [{ x: 0, y: 0, z: 0, color: current.color }] });
      }
      return;
    }

    if (current.toolMode === "remove" && hit.kind === "face") {
      map.delete(keyOf(hit.from));
      current.onChange({ version: 1, blocks: [...map.values()] });
      return;
    }

    if (current.toolMode !== "add" || model.blocks.length >= current.maxBlocks) return;
    const target = {
      x: hit.from.x + hit.normal.x,
      y: hit.from.y + hit.normal.y,
      z: hit.from.z + hit.normal.z
    };
    if (!isWithinGrid(target, current.gridSize) || map.has(keyOf(target))) return;
    map.set(keyOf(target), { ...target, color: current.color });
    current.onChange({ version: 1, blocks: [...map.values()] });
  }, []);

  const commitAt = useCallback(
    (clientX: number, clientY: number, hitOverride?: PickResult | null) => {
      const mode = propsRef.current.toolMode;
      if (mode !== "add" && mode !== "remove") return;
      lastCommitAtRef.current = performance.now();
      commitTap(hitOverride !== undefined ? hitOverride : pick(clientX, clientY));
    },
    [commitTap, pick]
  );

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#020617");
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    mount.append(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);
    scene.add(new THREE.AmbientLight("#ffffff", 1.2));
    const keyLight = new THREE.DirectionalLight("#ffffff", 2.8);
    keyLight.position.set(8, 10, 6);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight("#93c5fd", 1.5);
    fillLight.position.set(-8, 4, -6);
    scene.add(fillLight);
    const grid = new THREE.GridHelper(36, 36, "#334155", "#1e293b");
    grid.position.y = -0.55;
    scene.add(grid);

    threeRef.current = {
      scene,
      camera,
      renderer,
      group,
      raycaster: new THREE.Raycaster(),
      pointer: new THREE.Vector2()
    };

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height);
      camera.aspect = rect.width / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
      updateCamera();
    };

    const clearPressTimer = () => {
      if (pressTimerRef.current) {
        window.clearTimeout(pressTimerRef.current);
        pressTimerRef.current = null;
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      event.preventDefault();
      capturePointer(renderer.domElement, event.pointerId);
      const hit = pick(event.clientX, event.clientY);
      pointerMapRef.current.set(event.pointerId, {
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        hit
      });
      pressMovedRef.current = false;
      longPressTriggeredRef.current = false;
      clearPressTimer();
      if (event.button === 2) {
        longPressTriggeredRef.current = true;
        if (propsRef.current.toolMode === "add" && isFaceCandidate(hit)) {
          propsRef.current.onExtendCandidate(hit);
        }
        return;
      }
      if (
        pointerMapRef.current.size === 1 &&
        propsRef.current.toolMode === "add" &&
        isFaceCandidate(hit)
      ) {
        pressTimerRef.current = window.setTimeout(() => {
          if (pressMovedRef.current) return;
          longPressTriggeredRef.current = true;
          propsRef.current.onExtendCandidate(hit);
        }, 520);
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      event.preventDefault();
      const pointers = pointerMapRef.current;
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      const totalMove = Math.hypot(event.clientX - previous.startX, event.clientY - previous.startY);
      if (totalMove > TAP_TOLERANCE_PX) {
        pressMovedRef.current = true;
        clearPressTimer();
      }
      pointers.set(event.pointerId, { ...previous, x: event.clientX, y: event.clientY });

      if (pointers.size === 1 && totalMove > TAP_TOLERANCE_PX) {
        if (propsRef.current.toolMode === "pan") {
          panCamera(dx, dy);
          return;
        }

        if (propsRef.current.toolMode === "rotate") {
          const view = viewRef.current;
          view.yaw -= dx * 0.008;
          view.pitch = Math.max(-1.15, Math.min(1.25, view.pitch - dy * 0.006));
          updateCamera();
        }
        return;
      }

      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const last = gestureRef.current ?? { distance, midX, midY };
        const view = viewRef.current;
        view.distance = Math.min(
          MAX_CAMERA_DISTANCE,
          Math.max(MIN_CAMERA_DISTANCE, view.distance * (last.distance / Math.max(1, distance)))
        );
        panCamera(midX - last.midX, midY - last.midY);

        gestureRef.current = { distance, midX, midY };
        updateCamera();
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      event.preventDefault();
      clearPressTimer();
      const pointer = pointerMapRef.current.get(event.pointerId);
      pointerMapRef.current.delete(event.pointerId);
      gestureRef.current = null;
      const totalMove = pointer
        ? Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY)
        : Number.POSITIVE_INFINITY;
      if (
        pointer &&
        pointerMapRef.current.size === 0 &&
        totalMove <= TAP_TOLERANCE_PX &&
        !longPressTriggeredRef.current
      ) {
        commitAt(event.clientX, event.clientY, pointer.hit ?? pick(event.clientX, event.clientY));
      }
    };

    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || performance.now() - lastCommitAtRef.current < 250) return;
      commitAt(event.clientX, event.clientY);
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const view = viewRef.current;
      view.distance = Math.min(
        MAX_CAMERA_DISTANCE,
        Math.max(MIN_CAMERA_DISTANCE, view.distance * Math.exp(event.deltaY * 0.001))
      );
      updateCamera();
    };

    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("click", onClick);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("resize", resize);
    resize();
    rebuildCubes();

    return () => {
      clearPressTimer();
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      disposeGroup(group);
      renderer.dispose();
      mount.replaceChildren();
      threeRef.current = null;
    };
  }, [commitAt, disposeGroup, panCamera, pick, rebuildCubes, updateCamera]);

  useEffect(() => {
    rebuildCubes();
  }, [props.model, rebuildCubes]);

  return <div ref={mountRef} className="standalone-canvas-stage" />;
}
