// Half-step (0.5) grid utilities for print-prep support blocks.
//
// IMPORTANT: Existing Q-BU voxel coordinates are "block centers" at integer positions with edge length 1.
//   - Base block center: (x, y, z) as integers.
//   - Base block AABB: [x-0.5, x+0.5] etc.
//
// For 0.5 support blocks, the most robust discrete representation is to store the *min-corner*
// on a 0.5 grid (so that supports can touch faces without overlap).
//
// We represent support blocks with "sub" coordinates where:
//   - 1 sub unit = 0.5 world units
//   - A SubKey encodes the support block *min-corner* at (sx, sy, sz) in sub units
//   - The support block size is 1 sub unit (0.5 world) along each axis

import { parseKey, type Coord } from "./voxelUtils";

export type SubCoord = { x: number; y: number; z: number }; // integer grid (sub units)
export type SubKey = string;

// 1 sub unit = 0.5 world units
export const SUB_UNIT_WORLD = 0.5;

// Support block dimensions
export const SUPPORT_EDGE_WORLD = 0.5;
export const SUPPORT_EDGE_SUB = 1; // SUPPORT_EDGE_WORLD / SUB_UNIT_WORLD

export function subKeyOf(c: SubCoord): SubKey {
  return `${Math.trunc(c.x)},${Math.trunc(c.y)},${Math.trunc(c.z)}`;
}

export function parseSubKey(k: SubKey): SubCoord {
  const [x, y, z] = (k || "0,0,0").split(",").map((v) => parseInt(v, 10));
  return { x: x || 0, y: y || 0, z: z || 0 };
}

export function addSub(a: SubCoord, b: SubCoord): SubCoord {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subToWorld(v: number): number {
  return v * SUB_UNIT_WORLD;
}

export function worldToSub(v: number): number {
  return Math.round(v / SUB_UNIT_WORLD);
}

// Support block min-corner in world units
export function subMinToWorldMin(c: SubCoord): Coord {
  return { x: subToWorld(c.x), y: subToWorld(c.y), z: subToWorld(c.z) };
}

export function subMinToWorldCenter(c: SubCoord): Coord {
  const m = subMinToWorldMin(c);
  const half = SUPPORT_EDGE_WORLD / 2;
  return { x: m.x + half, y: m.y + half, z: m.z + half };
}

export function worldMinToSubMin(c: Coord): SubCoord {
  return { x: worldToSub(c.x), y: worldToSub(c.y), z: worldToSub(c.z) };
}

/**
 * Expand a base block (center coords) into 8 support-cells (0.5^3) that tile its volume.
 *
 * If base center is at (x, y, z), its min-corner is (x-0.5, y-0.5, z-0.5).
 * In sub units, min = (2x-1, 2y-1, 2z-1). The 8 half-cubes have min corners at:
 *   (min + dx, min + dy, min + dz) where dx/dy/dz in {0,1}
 */
export function baseKeyToSubMins(baseKey: string): SubCoord[] {
  const c = parseKey(baseKey);
  const minX = 2 * c.x - 1;
  const minY = 2 * c.y - 1;
  const minZ = 2 * c.z - 1;

  const out: SubCoord[] = [];
  for (const dx of [0, 1] as const) {
    for (const dy of [0, 1] as const) {
      for (const dz of [0, 1] as const) {
        out.push({ x: minX + dx, y: minY + dy, z: minZ + dz });
      }
    }
  }
  return out;
}

export function expandBaseBlocksToSubCells(baseBlocks: Set<string>): Set<SubKey> {
  const out = new Set<SubKey>();
  for (const bk of baseBlocks) {
    for (const sc of baseKeyToSubMins(bk)) out.add(subKeyOf(sc));
  }
  return out;
}

export type MixedBBox = {
  /** world min corner (continuous) */
  min: Coord;
  /** world max corner (continuous) */
  max: Coord;
  center: Coord;
  /** world size (continuous) */
  size: Coord;
  /** max(size.x, size.y, size.z) in world units */
  maxDim: number;
};

/**
 * Compute world-space bounding box for mixed geometry:
 * - base blocks: 1×1×1 cubes centered at integer coords
 * - support blocks: 0.5×0.5×0.5 cubes specified by sub-min corner
 */
export function computeMixedBBox(baseBlocks: Set<string>, supportBlocks: Set<SubKey>): MixedBBox {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  // base cubes
  for (const k of baseBlocks) {
    const c = parseKey(k);
    minX = Math.min(minX, c.x - 0.5);
    minY = Math.min(minY, c.y - 0.5);
    minZ = Math.min(minZ, c.z - 0.5);
    maxX = Math.max(maxX, c.x + 0.5);
    maxY = Math.max(maxY, c.y + 0.5);
    maxZ = Math.max(maxZ, c.z + 0.5);
  }

  // support cubes
  for (const sk of supportBlocks) {
    const sc = parseSubKey(sk);
    const m = subMinToWorldMin(sc);
    minX = Math.min(minX, m.x);
    minY = Math.min(minY, m.y);
    minZ = Math.min(minZ, m.z);
    maxX = Math.max(maxX, m.x + SUPPORT_EDGE_WORLD);
    maxY = Math.max(maxY, m.y + SUPPORT_EDGE_WORLD);
    maxZ = Math.max(maxZ, m.z + SUPPORT_EDGE_WORLD);
  }

  if (!isFinite(minX)) {
    // fallback (empty)
    minX = minY = minZ = -0.5;
    maxX = maxY = maxZ = 0.5;
  }

  const sizeX = maxX - minX;
  const sizeY = maxY - minY;
  const sizeZ = maxZ - minZ;

  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
    size: { x: sizeX, y: sizeY, z: sizeZ },
    maxDim: Math.max(sizeX, sizeY, sizeZ),
  };
}
