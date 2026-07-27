export const EDITOR_GRID_SIZE = 32;
export const EDITOR_MAX_BLOCKS = 300;
export const WORKSHOP_COLORS = ["white", "red", "blue"] as const;

export type WorkshopColor = (typeof WORKSHOP_COLORS)[number];

export type Coord = {
  x: number;
  y: number;
  z: number;
};

export type VoxelBlock = Coord & {
  color: WorkshopColor;
};

export type VoxelModel = {
  version: 1;
  blocks: VoxelBlock[];
};

export type StandaloneQbuPayload = {
  format: "qbu-standalone";
  version: 1;
  app: "Q-BU";
  exportedAt: string;
  project: {
    fileName: string;
  };
  editor: {
    gridSize: number;
    maxBlocks: number;
    blockSizeMm: number;
  };
  model: VoxelModel;
};

export type ImportedQbu = {
  fileName: string | null;
  model: VoxelModel;
};

export const COLOR_META: Record<WorkshopColor, { label: string; hex: string }> = {
  white: { label: "白", hex: "#F8FAFC" },
  red: { label: "赤", hex: "#DC2626" },
  blue: { label: "青", hex: "#2563EB" }
};

export function keyOf(coord: Coord): string {
  return `${coord.x},${coord.y},${coord.z}`;
}

export function isWorkshopColor(color: unknown): color is WorkshopColor {
  return typeof color === "string" && WORKSHOP_COLORS.includes(color as WorkshopColor);
}

export function initialModel(): VoxelModel {
  return {
    version: 1,
    blocks: [{ x: 0, y: 0, z: 0, color: "white" }]
  };
}

export function normalizeModel(input: unknown): VoxelModel {
  const blocks = Array.isArray((input as VoxelModel | null)?.blocks) ? (input as VoxelModel).blocks : [];
  const byCoord = new Map<string, VoxelBlock>();

  for (const block of blocks) {
    const x = Math.round(Number(block?.x));
    const y = Math.round(Number(block?.y));
    const z = Math.round(Number(block?.z));
    if (![x, y, z].every(Number.isFinite)) continue;
    const color = isWorkshopColor(block?.color) ? block.color : "white";
    const coord = { x, y, z };
    if (!isWithinGrid(coord, EDITOR_GRID_SIZE)) continue;
    byCoord.set(keyOf(coord), { ...coord, color });
    if (byCoord.size >= EDITOR_MAX_BLOCKS) break;
  }

  return {
    version: 1,
    blocks: [...byCoord.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
  };
}

export function toBlockMap(model: VoxelModel): Map<string, VoxelBlock> {
  return new Map(normalizeModel(model).blocks.map((block) => [keyOf(block), block]));
}

export function isWithinGrid(coord: Coord, gridSize: number): boolean {
  const radius = Math.floor(gridSize / 2);
  return (
    coord.x >= -radius &&
    coord.x < radius &&
    coord.y >= -radius &&
    coord.y < radius &&
    coord.z >= -radius &&
    coord.z < radius
  );
}

export function sanitizeQbuFileName(value: string): string {
  const withoutExtension = value.trim().replace(/\.qbu$/i, "");
  const cleaned = withoutExtension
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 80);
  const fallback = cleaned || "Q-BU";
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(fallback) ? `${fallback}_` : fallback;
}

export function buildStandaloneQbu(
  fileName: string,
  model: VoxelModel,
  blockSizeMm = 5
): StandaloneQbuPayload {
  return {
    format: "qbu-standalone",
    version: 1,
    app: "Q-BU",
    exportedAt: new Date().toISOString(),
    project: {
      fileName
    },
    editor: {
      gridSize: EDITOR_GRID_SIZE,
      maxBlocks: EDITOR_MAX_BLOCKS,
      blockSizeMm
    },
    model: normalizeModel(model)
  };
}

export function parseQbuPayload(
  input: unknown,
  options: { gridSize?: number; maxBlocks?: number } = {}
): ImportedQbu {
  if (!input || typeof input !== "object") {
    throw new Error("QBUの内容がJSONオブジェクトではありません。");
  }

  const payload = input as {
    format?: unknown;
    version?: unknown;
    project?: { fileName?: unknown };
    model?: { version?: unknown; blocks?: unknown };
  };
  if (
    (payload.format !== "qbu-standalone" && payload.format !== "qbu-workshop") ||
    payload.version !== 1
  ) {
    throw new Error("対応していないQBU形式です。");
  }
  if (!payload.model || payload.model.version !== 1 || !Array.isArray(payload.model.blocks)) {
    throw new Error("QBUに編集モデルが含まれていません。");
  }

  const gridSize = options.gridSize ?? EDITOR_GRID_SIZE;
  const maxBlocks = options.maxBlocks ?? EDITOR_MAX_BLOCKS;
  if (payload.model.blocks.length > maxBlocks) {
    throw new Error(`ブロック数が上限（${maxBlocks}個）を超えています。`);
  }

  const blocks: VoxelBlock[] = [];
  const seen = new Set<string>();
  for (const value of payload.model.blocks) {
    if (!value || typeof value !== "object") {
      throw new Error("不正なブロック情報が含まれています。");
    }
    const block = value as Partial<VoxelBlock>;
    const { x, y, z, color } = block;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof z !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z) ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      !Number.isInteger(z) ||
      !isWorkshopColor(color)
    ) {
      throw new Error("不正な座標または色のブロックが含まれています。");
    }
    const coord = { x, y, z };
    if (!isWithinGrid(coord, gridSize)) {
      throw new Error(`編集範囲（${gridSize}）外のブロックが含まれています。`);
    }
    const key = keyOf(coord);
    if (seen.has(key)) {
      throw new Error("同じ座標のブロックが重複しています。");
    }
    seen.add(key);
    blocks.push({ ...coord, color });
  }

  const importedName =
    typeof payload.project?.fileName === "string" && payload.project.fileName.trim()
      ? sanitizeQbuFileName(payload.project.fileName)
      : null;

  return {
    fileName: importedName,
    model: normalizeModel({ version: 1, blocks })
  };
}

export function parseQbuText(
  text: string,
  options: { gridSize?: number; maxBlocks?: number } = {}
): ImportedQbu {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("QBUファイルをJSONとして読み込めませんでした。");
  }
  return parseQbuPayload(parsed, options);
}
