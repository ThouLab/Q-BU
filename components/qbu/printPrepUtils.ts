import { add, computeBBox, keyOf, parseKey, type Coord } from "./voxelUtils";

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
