import { add, computeBBox, keyOf, parseKey, type Coord } from "./voxelUtils";
import {
  addSub,
  baseKeyToSubMins,
  expandBaseBlocksToSubCells,
  parseSubKey,
  subKeyOf,
  type SubCoord,
  type SubKey,
} from "./subBlocks";


const DIRS: Coord[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

export type Bounds = {
  min: Coord;
  max: Coord;
};

function withinBounds(c: Coord, b: Bounds): boolean {
  return (
    c.x >= b.min.x &&
    c.x <= b.max.x &&
    c.y >= b.min.y &&
    c.y <= b.max.y &&
    c.z >= b.min.z &&
    c.z <= b.max.z
  );
}

export function getConnectedComponents(blocks: Set<string>): Set<string>[] {
  if (blocks.size === 0) return [];

  const visited = new Set<string>();
  const components: Set<string>[] = [];

  for (const start of blocks) {
    if (visited.has(start)) continue;
    const comp = new Set<string>();

    const stack = [start];
    visited.add(start);
    comp.add(start);

    while (stack.length) {
      const curKey = stack.pop()!;
      const cur = parseKey(curKey);
      for (const d of DIRS) {
        const nk = keyOf(add(cur, d));
        if (!blocks.has(nk)) continue;
        if (visited.has(nk)) continue;
        visited.add(nk);
        comp.add(nk);
        stack.push(nk);
      }
    }

    components.push(comp);
  }

  // 大きい順
  components.sort((a, b) => b.size - a.size);
  return components;
}

export function countComponents(blocks: Set<string>): number {
  return getConnectedComponents(blocks).length;
}

export function largestComponent(blocks: Set<string>): Set<string> {
  const comps = getConnectedComponents(blocks);
  return comps[0] || new Set<string>();
}

export function floatingBlocks(blocks: Set<string>): Set<string> {
  const main = largestComponent(blocks);
  const out = new Set<string>();
  for (const k of blocks) {
    if (!main.has(k)) out.add(k);
  }
  return out;
}

function findBridgePath(component: Set<string>, target: Set<string>, occupied: Set<string>, bounds: Bounds): string[] {
  // Multi-source BFS: component の全ブロックをスタート、空マスを探索して target に接する最短経路を探す
  const queue: string[] = [];
  let head = 0;

  const visited = new Set<string>();
  const prev = new Map<string, string | null>();

  for (const s of component) {
    queue.push(s);
    visited.add(s);
    prev.set(s, null);
  }

  let foundCur: string | null = null;

  while (head < queue.length && !foundCur) {
    const curKey = queue[head++]!;
    const cur = parseKey(curKey);

    for (const d of DIRS) {
      const n = add(cur, d);
      if (!withinBounds(n, bounds)) continue;
      const nk = keyOf(n);

      if (target.has(nk)) {
        // curKey と target のブロックが接した
        foundCur = curKey;
        break;
      }

      if (visited.has(nk)) continue;
      // 既存ブロックは通れない（target以外）
      if (occupied.has(nk)) continue;

      visited.add(nk);
      prev.set(nk, curKey);
      queue.push(nk);
    }
  }

  if (!foundCur) return [];

  // foundCur が component 内なら追加不要（隣接していた）
  if (component.has(foundCur)) return [];

  // foundCur は空マス。component まで辿って追加マス列を作る
  const path: string[] = [];
  let k: string | null = foundCur;
  while (k && !component.has(k)) {
    path.push(k);
    k = prev.get(k) ?? null;
  }

  path.reverse();
  return path;
}

export function suggestCompletionBlocks(baseBlocks: Set<string>): Set<string> {
  const comps = getConnectedComponents(baseBlocks);
  if (comps.length <= 1) return new Set<string>();

  // メインは最大成分
  const main = comps[0]!;
  const others = comps.slice(1);

  const bbox = computeBBox(baseBlocks);
  const margin = 4;
  const bounds: Bounds = {
    min: { x: bbox.min.x - margin, y: bbox.min.y - margin, z: bbox.min.z - margin },
    max: { x: bbox.max.x + margin, y: bbox.max.y + margin, z: bbox.max.z + margin },
  };

  const extras = new Set<string>();
  const connected = new Set<string>(main);

  // occupied は「元ブロック + 追加済み」
  const occupied = new Set<string>(baseBlocks);

  for (const comp of others) {
    // 現在の connected へ繋ぐ
    const path = findBridgePath(comp, connected, occupied, bounds);
    for (const k of path) {
      if (!occupied.has(k)) {
        extras.add(k);
        occupied.add(k);
        connected.add(k);
      }
    }

    // comp 自体も connected 側に取り込む（これで次の部品は comp を経由して繋げられる）
    for (const k of comp) connected.add(k);
  }

  return extras;
}
/* -------------------------------------------------------------------------- */
/* Half-block (0.5^3) support utilities (v1.0.14 preparation)                  */
/*                                                                            */
/* NOTE: These functions are NOT wired to the current UI yet.                 */
/* They are provided to make the remaining work easier to "hand over":        */
/* - support blocks are represented by SubKey (min-corner at 0.5 grid)         */
/* - base blocks are expanded into 8 sub-cells to evaluate connectivity        */
/* - bridging path search runs on sub-cells (0.5 resolution)                   */
/* -------------------------------------------------------------------------- */

const SUB_DIRS: SubCoord[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

export type SubBounds = {
  min: SubCoord;
  max: SubCoord;
};

function withinSubBounds(c: SubCoord, b: SubBounds): boolean {
  return (
    c.x >= b.min.x &&
    c.x <= b.max.x &&
    c.y >= b.min.y &&
    c.y <= b.max.y &&
    c.z >= b.min.z &&
    c.z <= b.max.z
  );
}

function subCellsOfBaseBlock(baseKey: string): SubKey[] {
  return baseKeyToSubMins(baseKey).map((c) => subKeyOf(c));
}

export function getConnectedComponentsSubCells(cells: Set<SubKey>): Set<SubKey>[] {
  if (cells.size === 0) return [];

  const visited = new Set<SubKey>();
  const components: Set<SubKey>[] = [];

  for (const start of cells) {
    if (visited.has(start)) continue;

    const comp = new Set<SubKey>();
    const stack: SubKey[] = [start];
    visited.add(start);
    comp.add(start);

    while (stack.length) {
      const curKey = stack.pop()!;
      const cur = parseSubKey(curKey);

      for (const d of SUB_DIRS) {
        const n = addSub(cur, d);
        const nk = subKeyOf(n);
        if (!cells.has(nk)) continue;
        if (visited.has(nk)) continue;
        visited.add(nk);
        comp.add(nk);
        stack.push(nk);
      }
    }

    components.push(comp);
  }

  // 大きい順
  components.sort((a, b) => b.size - a.size);
  return components;
}

function computeSubBoundsFromCells(cells: Set<SubKey>, marginSub: number): SubBounds {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  for (const k of cells) {
    const c = parseSubKey(k);
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    minZ = Math.min(minZ, c.z);
    maxX = Math.max(maxX, c.x);
    maxY = Math.max(maxY, c.y);
    maxZ = Math.max(maxZ, c.z);
  }

  if (!isFinite(minX)) {
    minX = minY = minZ = 0;
    maxX = maxY = maxZ = 0;
  }

  const m = Math.max(0, Math.floor(marginSub || 0));
  return {
    min: { x: minX - m, y: minY - m, z: minZ - m },
    max: { x: maxX + m, y: maxY + m, z: maxZ + m },
  };
}

function findBridgePathSub(
  componentSubCells: Set<SubKey>,
  targetSubCells: Set<SubKey>,
  occupiedSubCells: Set<SubKey>,
  bounds: SubBounds
): SubKey[] {
  // Multi-source BFS:
  // - Start from componentSubCells
  // - Explore empty sub-cells
  // - Stop when a neighbor touches targetSubCells (face-adjacent)

  const queue: SubKey[] = [];
  let head = 0;

  const visited = new Set<SubKey>();
  const prev = new Map<SubKey, SubKey | null>();

  for (const s of componentSubCells) {
    queue.push(s);
    visited.add(s);
    prev.set(s, null);
  }

  let foundCur: SubKey | null = null;

  while (head < queue.length && !foundCur) {
    const curKey = queue[head++]!;
    const cur = parseSubKey(curKey);

    for (const d of SUB_DIRS) {
      const n = addSub(cur, d);
      if (!withinSubBounds(n, bounds)) continue;

      const nk = subKeyOf(n);

      if (targetSubCells.has(nk)) {
        foundCur = curKey;
        break;
      }

      if (visited.has(nk)) continue;

      // cannot pass through occupied (base blocks or already placed supports)
      if (occupiedSubCells.has(nk)) continue;

      visited.add(nk);
      prev.set(nk, curKey);
      queue.push(nk);
    }
  }

  if (!foundCur) return [];

  // If foundCur is inside the component, it was already adjacent to target.
  if (componentSubCells.has(foundCur)) return [];

  const path: SubKey[] = [];
  let k: SubKey | null = foundCur;
  while (k && !componentSubCells.has(k)) {
    path.push(k);
    k = prev.get(k) ?? null;
  }

  path.reverse();
  return path;
}

/**
 * Suggest half-block (0.5^3) support blocks to connect floating components.
 *
 * Return value:
 * - Set of SubKey (support block min-corners on a 0.5 grid)
 *
 * This is meant to replace suggestCompletionBlocks() in the future,
 * once PrintPrepViewer/Modal and STL export are updated to handle SubKey supports.
 */
export function suggestCompletionSupportBlocks(baseBlocks: Set<string>): Set<SubKey> {
  const comps = getConnectedComponents(baseBlocks);
  if (comps.length <= 1) return new Set<SubKey>();

  const main = comps[0]!;
  const others = comps.slice(1);

  // Sub-cell space bounds: derive from all base sub-cells with a margin.
  const allBaseSubCells = expandBaseBlocksToSubCells(baseBlocks);

  // original margin was 4 (in block units). Convert to sub units (0.5 grid):
  const marginSub = 4 * 2; // 8
  const bounds = computeSubBoundsFromCells(allBaseSubCells, marginSub);

  const extras = new Set<SubKey>();

  // connectedSubCells: start from main component sub-cells
  const connectedSubCells = new Set<SubKey>();
  for (const bk of main) {
    for (const sk of subCellsOfBaseBlock(bk)) connectedSubCells.add(sk);
  }

  // occupiedSubCells: all base sub-cells plus placed supports
  const occupiedSubCells = new Set<SubKey>(allBaseSubCells);

  for (const comp of others) {
    const compSubCells = new Set<SubKey>();
    for (const bk of comp) {
      for (const sk of subCellsOfBaseBlock(bk)) compSubCells.add(sk);
    }

    const path = findBridgePathSub(compSubCells, connectedSubCells, occupiedSubCells, bounds);

    for (const sk of path) {
      if (!occupiedSubCells.has(sk)) {
        extras.add(sk);
        occupiedSubCells.add(sk);
        connectedSubCells.add(sk);
      }
    }

    // incorporate the component itself into the connected set
    for (const sk of compSubCells) connectedSubCells.add(sk);
  }

  return extras;
}

export type PrintPrepSupportAnalysis = {
  /** Combined occupancy in sub-cells (base expanded + support blocks) */
  combinedSubCells: Set<SubKey>;
  /** Number of connected components in sub-cells */
  componentCount: number;
  /** Base blocks that are NOT in the largest connected component (floating) */
  floatingBaseBlocks: Set<string>;
  /** Support blocks that are NOT in the largest connected component (floating) */
  floatingSupportBlocks: Set<SubKey>;
};

/**
 * Analyze connectivity when using half-block supports.
 *
 * This is useful for:
 * - deciding whether "ready to print" (componentCount === 1)
 * - coloring floating base blocks red and supports red/blue accordingly
 */
export function analyzePrintPrepSupport(baseBlocks: Set<string>, supportBlocks: Set<SubKey>): PrintPrepSupportAnalysis {
  const baseSubCells = expandBaseBlocksToSubCells(baseBlocks);

  const combined = new Set<SubKey>(baseSubCells);
  for (const sk of supportBlocks) combined.add(sk);

  const comps = getConnectedComponentsSubCells(combined);
  const main = comps[0] ?? new Set<SubKey>();

  const floatingSupportBlocks = new Set<SubKey>();
  for (const sk of supportBlocks) {
    if (!main.has(sk)) floatingSupportBlocks.add(sk);
  }

  const floatingBaseBlocks = new Set<string>();
  for (const bk of baseBlocks) {
    const subCells = subCellsOfBaseBlock(bk);
    let inMain = false;
    for (const sk of subCells) {
      if (main.has(sk)) {
        inMain = true;
        break;
      }
    }
    if (!inMain) floatingBaseBlocks.add(bk);
  }

  return {
    combinedSubCells: combined,
    componentCount: comps.length,
    floatingBaseBlocks,
    floatingSupportBlocks,
  };
}
