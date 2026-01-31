export type Coord = { x: number; y: number; z: number };

export function keyOf(c: Coord) {
  return `${c.x},${c.y},${c.z}`;
}

export function parseKey(k: string): Coord {
  const [x, y, z] = k.split(",").map((v) => parseInt(v, 10));
  return { x, y, z };
}

export function add(a: Coord, b: Coord): Coord {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function equal(a: Coord, b: Coord) {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export type BBox = {
  min: Coord;
  max: Coord;
  center: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
  maxDim: number;
};

export function computeBBox(keys: Set<string>): BBox {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  for (const k of keys) {
    const { x, y, z } = parseKey(k);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  // fallback
  if (!isFinite(minX)) {
    minX = minY = minZ = 0;
    maxX = maxY = maxZ = 0;
  }

  const sizeX = maxX - minX + 1;
  const sizeY = maxY - minY + 1;
  const sizeZ = maxZ - minZ + 1;

  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
    size: { x: sizeX, y: sizeY, z: sizeZ },
    maxDim: Math.max(sizeX, sizeY, sizeZ),
  };
}

export const PALETTE = ["#a7d3ff", "#b6f2c1", "#ffd6a5", "#ffadad", "#cdb4ff", "#fdffb6"] as const;

// 安定した色を返す（座標に依存して毎回同じ色）
export function stablePaletteIndex(key: string, mod: number) {
  // FNV-1a (32bit) っぽい軽いハッシュ
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // >>> 0 で unsigned 化
  return (h >>> 0) % mod;
}
