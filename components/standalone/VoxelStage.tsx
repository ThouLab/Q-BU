"use client";

import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import {
  COLOR_META,
  type Coord,
  type VoxelBlock,
  type VoxelModel,
  type WorkshopColor,
  isWithinGrid,
  keyOf,
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
  previewBlocks?: readonly VoxelBlock[];
  interactionLocked?: boolean;
  frameRequest: number;
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
const MAX_CAMERA_DISTANCE = 400;
const START_TARGET_Y_OFFSET = 1.05;
const DEFAULT_CAMERA = {
  yaw: 0.76,
  pitch: 0.5,
  distance: 7.5,
  targetX: 0,
  targetY: START_TARGET_Y_OFFSET,
  targetZ: 0
};
const CUBE_SIZE = 0.96;
const CUBE_HALF_SIZE = CUBE_SIZE / 2;
const MAX_EDGE_BLOCKS = 50_000;
const CUBE_EDGE_OFFSETS = new Float32Array([
  -CUBE_HALF_SIZE, -CUBE_HALF_SIZE, -CUBE_HALF_SIZE, CUBE_HALF_SIZE, -CUBE_HALF_SIZE, -CUBE_HALF_SIZE,
  -CUBE_HALF_SIZE, -CUBE_HALF_SIZE, CUBE_HALF_SIZE, CUBE_HALF_SIZE, -CUBE_HALF_SIZE, CUBE_HALF_SIZE,
  -CUBE_HALF_SIZE, CUBE_HALF_SIZE, -CUBE_HALF_SIZE, CUBE_HALF_SIZE, CUBE_HALF_SIZE, -CUBE_HALF_SIZE,
  -CUBE_HALF_SIZE, CUBE_HALF_SIZE, CUBE_HALF_SIZE, CUBE_HALF_SIZE, CUBE_HALF_SIZE, CUBE_HALF_SIZE,
  -CUBE_HALF_SIZE, -CUBE_HALF_SIZE, -CUBE_HALF_SIZE, -CUBE_HALF_SIZE, CUBE_HALF_SIZE, -CUBE_HALF_SIZE,
  CUBE_HALF_SIZE, -CUBE_HALF_SIZE, -CUBE_HALF_SIZE, CUBE_HALF_SIZE, CUBE_HALF_SIZE, -CUBE_HALF_SIZE,
  -CUBE_HALF_SIZE, -CUBE_HALF_SIZE, CUBE_HALF_SIZE, -CUBE_HALF_SIZE, CUBE_HALF_SIZE, CUBE_HALF_SIZE,
  CUBE_HALF_SIZE, -CUBE_HALF_SIZE, CUBE_HALF_SIZE, CUBE_HALF_SIZE, CUBE_HALF_SIZE, CUBE_HALF_SIZE,
  -CUBE_HALF_SIZE, -CUBE_HALF_SIZE, -CUBE_HALF_SIZE, -CUBE_HALF_SIZE, -CUBE_HALF_SIZE, CUBE_HALF_SIZE,
  CUBE_HALF_SIZE, -CUBE_HALF_SIZE, -CUBE_HALF_SIZE, CUBE_HALF_SIZE, -CUBE_HALF_SIZE, CUBE_HALF_SIZE,
  -CUBE_HALF_SIZE, CUBE_HALF_SIZE, -CUBE_HALF_SIZE, -CUBE_HALF_SIZE, CUBE_HALF_SIZE, CUBE_HALF_SIZE,
  CUBE_HALF_SIZE, CUBE_HALF_SIZE, -CUBE_HALF_SIZE, CUBE_HALF_SIZE, CUBE_HALF_SIZE, CUBE_HALF_SIZE
]);

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
    previewGroup: THREE.Group;
    raycaster: THREE.Raycaster;
    pointer: THREE.Vector2;
  } | null>(null);
  const propsRef = useRef(props);
  const viewRef = useRef({ ...DEFAULT_CAMERA });
  const hasFramedInitialModelRef = useRef(false);
  const lastFrameRequestRef = useRef(props.frameRequest);
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

  const frameModel = useCallback((model: VoxelModel, previewBlocks: readonly VoxelBlock[] = []) => {
    const blocks = model.blocks;
    const view = viewRef.current;
    if (blocks.length === 0 && previewBlocks.length === 0) {
      Object.assign(view, DEFAULT_CAMERA);
      return;
    }

    const bounds = {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY,
      maxZ: Number.NEGATIVE_INFINITY
    };
    const includeBlock = (block: Coord) => {
      if (![block.x, block.y, block.z].every(Number.isFinite)) return;
      bounds.minX = Math.min(bounds.minX, block.x);
      bounds.maxX = Math.max(bounds.maxX, block.x);
      bounds.minY = Math.min(bounds.minY, block.y);
      bounds.maxY = Math.max(bounds.maxY, block.y);
      bounds.minZ = Math.min(bounds.minZ, block.z);
      bounds.maxZ = Math.max(bounds.maxZ, block.z);
    };
    blocks.forEach(includeBlock);
    previewBlocks.forEach(includeBlock);

    if (!Number.isFinite(bounds.minX)) {
      Object.assign(view, DEFAULT_CAMERA);
      return;
    }

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
    const instancedMeshes = new Set<THREE.InstancedMesh>();
    group.traverse((object) => {
      const renderable = object as {
        geometry?: { dispose?: () => void };
        material?: { dispose?: () => void } | Array<{ dispose?: () => void }>;
      };
      if (object instanceof THREE.InstancedMesh) instancedMeshes.add(object);
      if (renderable.geometry?.dispose) geometries.add(renderable.geometry as { dispose: () => void });
      const objectMaterials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
      for (const material of objectMaterials) {
        if (material?.dispose) materials.add(material as { dispose: () => void });
      }
    });
    group.clear();
    instancedMeshes.forEach((mesh) => mesh.dispose?.());
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
  }, []);

  const rebuildCubes = useCallback(() => {
    const three = threeRef.current;
    if (!three) return;
    disposeGroup(three.group);
    const blocks = propsRef.current.model.blocks;
    const blocksByColor = new Map<WorkshopColor, typeof blocks>();
    for (const block of blocks) {
      const colorBlocks = blocksByColor.get(block.color);
      if (colorBlocks) colorBlocks.push(block);
      else blocksByColor.set(block.color, [block]);
    }

    const cubeGeometry = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
    const instanceMatrix = new THREE.Matrix4();
    for (const [color, colorBlocks] of blocksByColor) {
      const material = new THREE.MeshStandardMaterial({
        color: COLOR_META[color].hex,
        roughness: 0.65,
        metalness: 0.02
      });
      const mesh = new THREE.InstancedMesh(cubeGeometry, material, colorBlocks.length);
      const coords = new Int16Array(colorBlocks.length * 3);
      for (let index = 0; index < colorBlocks.length; index += 1) {
        const block = colorBlocks[index];
        instanceMatrix.makeTranslation(block.x, block.y, block.z);
        mesh.setMatrixAt(index, instanceMatrix);
        const coordIndex = index * 3;
        coords[coordIndex] = block.x;
        coords[coordIndex + 1] = block.y;
        coords[coordIndex + 2] = block.z;
      }
      mesh.userData.coords = coords;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      three.group.add(mesh);
    }

    if (blocks.length > 0 && blocks.length <= MAX_EDGE_BLOCKS) {
      const edgePositions = new Float32Array(blocks.length * CUBE_EDGE_OFFSETS.length);
      let positionIndex = 0;
      for (const block of blocks) {
        for (let offsetIndex = 0; offsetIndex < CUBE_EDGE_OFFSETS.length; offsetIndex += 3) {
          edgePositions[positionIndex] = block.x + CUBE_EDGE_OFFSETS[offsetIndex];
          edgePositions[positionIndex + 1] = block.y + CUBE_EDGE_OFFSETS[offsetIndex + 1];
          edgePositions[positionIndex + 2] = block.z + CUBE_EDGE_OFFSETS[offsetIndex + 2];
          positionIndex += 3;
        }
      }
      const edgeGeometry = new THREE.BufferGeometry();
      edgeGeometry.setAttribute("position", new THREE.BufferAttribute(edgePositions, 3));
      edgeGeometry.computeBoundingSphere();
      const edges = new THREE.LineSegments(
        edgeGeometry,
        new THREE.LineBasicMaterial({ color: "#0f172a", transparent: true, opacity: 0.25 })
      );
      three.group.add(edges);
    } else if (blocks.length === 0) {
      cubeGeometry.dispose();
    }

    if (
      !hasFramedInitialModelRef.current ||
      lastFrameRequestRef.current !== propsRef.current.frameRequest
    ) {
      frameModel(propsRef.current.model, propsRef.current.previewBlocks);
      hasFramedInitialModelRef.current = true;
      lastFrameRequestRef.current = propsRef.current.frameRequest;
    }

    updateCamera();
  }, [disposeGroup, frameModel, updateCamera]);

  const rebuildPreview = useCallback(() => {
    const three = threeRef.current;
    if (!three) return;
    disposeGroup(three.previewGroup);

    const blocks = propsRef.current.previewBlocks ?? [];
    if (blocks.length === 0) {
      updateCamera();
      return;
    }

    const blocksByColor = new Map<WorkshopColor, VoxelBlock[]>();
    for (const block of blocks) {
      const colorBlocks = blocksByColor.get(block.color);
      if (colorBlocks) colorBlocks.push(block);
      else blocksByColor.set(block.color, [block]);
    }

    const cubeGeometry = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
    const instanceMatrix = new THREE.Matrix4();
    for (const [color, colorBlocks] of blocksByColor) {
      const material = new THREE.MeshStandardMaterial({
        color: COLOR_META[color].hex,
        roughness: 0.55,
        metalness: 0.02,
        transparent: true,
        opacity: 0.4,
        depthWrite: false
      });
      const mesh = new THREE.InstancedMesh(cubeGeometry, material, colorBlocks.length);
      for (let index = 0; index < colorBlocks.length; index += 1) {
        const block = colorBlocks[index];
        instanceMatrix.makeTranslation(block.x, block.y, block.z);
        mesh.setMatrixAt(index, instanceMatrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      mesh.renderOrder = 1;
      three.previewGroup.add(mesh);
    }

    updateCamera();
  }, [disposeGroup, updateCamera]);

  const pick = useCallback((clientX: number, clientY: number): PickResult | null => {
    const three = threeRef.current;
    if (!three) return null;
    const rect = three.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    three.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    three.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    three.group.updateMatrixWorld(true);
    three.raycaster.setFromCamera(three.pointer, three.camera);
    const voxelMeshes = three.group.children.filter(
      (object): object is THREE.InstancedMesh => object instanceof THREE.InstancedMesh
    );
    const hits = three.raycaster.intersectObjects(voxelMeshes, false);
    const hit = hits[0];
    if (
      hit?.object instanceof THREE.InstancedMesh &&
      typeof hit.instanceId === "number"
    ) {
      const coords = hit.object.userData.coords as Int16Array | undefined;
      const coordIndex = hit.instanceId * 3;
      if (!(coords instanceof Int16Array) || coordIndex + 2 >= coords.length) return null;
      const from = {
        x: coords[coordIndex],
        y: coords[coordIndex + 1],
        z: coords[coordIndex + 2]
      };
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
    if (current.interactionLocked) return;
    const model = current.model;
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
      const current = propsRef.current;
      if (current.interactionLocked) return;
      const mode = current.toolMode;
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
    const previewGroup = new THREE.Group();
    scene.add(group);
    scene.add(previewGroup);
    scene.add(new THREE.AmbientLight("#ffffff", 1.2));
    const keyLight = new THREE.DirectionalLight("#ffffff", 2.8);
    keyLight.position.set(8, 10, 6);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight("#93c5fd", 1.5);
    fillLight.position.set(-8, 4, -6);
    scene.add(fillLight);
    const gridSize = Math.max(2, Math.min(propsRef.current.gridSize, 160));
    const grid = new THREE.GridHelper(gridSize, gridSize, "#334155", "#1e293b");
    grid.position.y = -0.55;
    scene.add(grid);

    threeRef.current = {
      scene,
      camera,
      renderer,
      group,
      previewGroup,
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
      const current = propsRef.current;
      const hit =
        !current.interactionLocked &&
        (current.toolMode === "add" || current.toolMode === "remove")
          ? pick(event.clientX, event.clientY)
          : null;
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
        if (
          !propsRef.current.interactionLocked &&
          propsRef.current.toolMode === "add" &&
          isFaceCandidate(hit)
        ) {
          propsRef.current.onExtendCandidate(hit);
        }
        return;
      }
      if (
        pointerMapRef.current.size === 1 &&
        !propsRef.current.interactionLocked &&
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
        !longPressTriggeredRef.current &&
        !propsRef.current.interactionLocked &&
        (propsRef.current.toolMode === "add" || propsRef.current.toolMode === "remove")
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
      disposeGroup(previewGroup);
      renderer.dispose();
      mount.replaceChildren();
      threeRef.current = null;
    };
  }, [commitAt, disposeGroup, panCamera, pick, rebuildCubes, updateCamera]);

  useEffect(() => {
    rebuildCubes();
  }, [props.model, rebuildCubes]);

  useEffect(() => {
    rebuildPreview();
  }, [props.previewBlocks, rebuildPreview]);

  useEffect(() => {
    if (!threeRef.current || lastFrameRequestRef.current === props.frameRequest) return;
    frameModel(props.model, props.previewBlocks);
    lastFrameRequestRef.current = props.frameRequest;
    hasFramedInitialModelRef.current = true;
    updateCamera();
  }, [frameModel, props.frameRequest, props.model, props.previewBlocks, updateCamera]);

  return <div ref={mountRef} className="standalone-canvas-stage" />;
}
