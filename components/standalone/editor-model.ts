import { unpackQbu } from "@/components/qbu/qbuFile";

export const EDITOR_GRID_SIZE = 160;
export const EDITOR_MAX_BLOCKS = 999_999;
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
    blocks: [...byCoord.values()].sort(
      (a, b) => a.x - b.x || a.y - b.y || a.z - b.z
    )
  };
}

export function toBlockMap(model: VoxelModel): Map<string, VoxelBlock> {
  return new Map(model.blocks.map((block) => [keyOf(block), block]));
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

type ParseOptions = { gridSize?: number; maxBlocks?: number; enforceGrid?: boolean };

const LEGACY_DEFAULT_BLOCK_COLOR = "#9AA0A6";
const LEGACY_COLOR_ALIASES: Record<string, WorkshopColor> = {
  white: "white",
  "jade white": "white",
  gray: "white",
  grey: "white",
  "#fff": "white",
  "#ffffff": "white",
  "#f4f4f2": "white",
  "#f8fafc": "white",
  "#9aa0a6": "white",
  red: "red",
  orange: "red",
  yellow: "red",
  pink: "red",
  brown: "red",
  "#d72638": "red",
  "#dc2626": "red",
  "#ef4444": "red",
  "#ff0000": "red",
  "#f18f01": "red",
  "#f6c90e": "red",
  "#ff5da2": "red",
  "#8d5b3a": "red",
  blue: "blue",
  green: "blue",
  purple: "blue",
  black: "blue",
  "charcoal black": "blue",
  "#000": "blue",
  "#000000": "blue",
  "#1f1f1f": "blue",
  "#1e6bf1": "blue",
  "#2563eb": "blue",
  "#2ecc71": "blue",
  "#7b61ff": "blue"
};

const QBU_MAGIC = new Uint8Array([0x51, 0x42, 0x55, 0x31]);

function startsWithBytes(bytes: Uint8Array, pattern: Uint8Array): boolean {
  if (bytes.length < pattern.length) return false;
  for (let index = 0; index < pattern.length; index += 1) {
    if (bytes[index] !== pattern[index]) return false;
  }
  return true;
}

function parseLegacyCoord(input: unknown): Coord | null {
  if (typeof input === "string") {
    const values = input.split(",").map((part) => Number(part.trim()));
    if (values.length === 3 && values.every((value) => Number.isInteger(value) && Number.isFinite(value))) {
      return { x: values[0], y: values[1], z: values[2] };
    }
  }

  if (Array.isArray(input) && input.length >= 3) {
    const values = input.slice(0, 3).map((value) => Number(value));
    if (values.every((value) => Number.isInteger(value) && Number.isFinite(value))) {
      return { x: values[0], y: values[1], z: values[2] };
    }
  }

  if (input && typeof input === "object" && !Array.isArray(input)) {
    const { x, y, z } = input as Record<string, unknown>;
    const values = [Number(x), Number(y), Number(z)];
    if (values.every((value) => Number.isInteger(value) && Number.isFinite(value))) {
      return { x: values[0], y: values[1], z: values[2] };
    }
  }

  return null;
}

function parseHexColor(input: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!match) return null;
  const hex =
    match[1].length === 3
      ? match[1]
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : match[1];
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16)
  };
}

function nearestWorkshopColor(input: { r: number; g: number; b: number }): WorkshopColor {
  let bestColor: WorkshopColor = "white";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [color, meta] of Object.entries(COLOR_META) as [WorkshopColor, (typeof COLOR_META)[WorkshopColor]][]) {
    const target = parseHexColor(meta.hex);
    if (!target) continue;
    const distance = (input.r - target.r) ** 2 + (input.g - target.g) ** 2 + (input.b - target.b) ** 2;
    if (distance < bestDistance) {
      bestColor = color;
      bestDistance = distance;
    }
  }
  return bestColor;
}

function legacyColorToWorkshopColor(input: unknown): WorkshopColor {
  if (isWorkshopColor(input)) return input;
  if (typeof input !== "string") return "white";
  const normalized = input.trim().toLowerCase();
  const alias = LEGACY_COLOR_ALIASES[normalized];
  if (alias) return alias;
  const rgb = parseHexColor(normalized);
  return rgb ? nearestWorkshopColor(rgb) : "white";
}

function isLegacyProjectPayload(input: unknown): input is Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const payload = input as Record<string, unknown>;
  return Array.isArray(payload.blocks) && [1, 2, 3, 4, 5].includes(Number(payload.version));
}

function parseLegacyQbuPayload(input: Record<string, unknown>, options: ParseOptions): ImportedQbu {
  const rawBlocks = input.blocks as unknown[];
  const maxBlocks = options.maxBlocks ?? EDITOR_MAX_BLOCKS;
  if (rawBlocks.length > maxBlocks) {
    throw new Error(`ブロック数が上限（${maxBlocks}個）を超えています。`);
  }

  const rawColors = Array.isArray(input.colors) ? input.colors : null;
  const fallbackColor = typeof input.color === "string" ? input.color : LEGACY_DEFAULT_BLOCK_COLOR;
  const blocks: VoxelBlock[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < rawBlocks.length; index += 1) {
    const coord = parseLegacyCoord(rawBlocks[index]);
    if (!coord) throw new Error("旧QBUファイルに不正なブロックが含まれています。");
    if ((options.enforceGrid ?? true) && !isWithinGrid(coord, options.gridSize ?? EDITOR_GRID_SIZE)) {
      throw new Error(`編集範囲（${options.gridSize ?? EDITOR_GRID_SIZE}）外のブロックが含まれています。`);
    }
    const key = keyOf(coord);
    if (seen.has(key)) continue;
    seen.add(key);
    const colorInput = rawColors && rawColors[index] !== undefined ? rawColors[index] : fallbackColor;
    blocks.push({ ...coord, color: legacyColorToWorkshopColor(colorInput) });
  }

  if (blocks.length === 0) blocks.push({ x: 0, y: 0, z: 0, color: "white" });

  const fileName =
    typeof input.fileName === "string"
      ? sanitizeQbuFileName(input.fileName)
      : typeof input.name === "string"
        ? sanitizeQbuFileName(input.name)
        : null;

  return {
    fileName,
    model: normalizeModel({ version: 1, blocks })
  };
}

export function parseQbuPayload(
  input: unknown,
  options: ParseOptions = {}
): ImportedQbu {
  if (!input || typeof input !== "object") {
    throw new Error("QBUの内容がJSONオブジェクトではありません。");
  }

  if (isLegacyProjectPayload(input)) {
    return parseLegacyQbuPayload(input, options);
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
  options: ParseOptions = {}
): ImportedQbu {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("QBUファイルをJSONとして読み込めませんでした。");
  }
  return parseQbuPayload(parsed, options);
}

export async function parseQbuFile(file: File, options: ParseOptions = {}): Promise<ImportedQbu> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (startsWithBytes(bytes, QBU_MAGIC)) {
    const unpacked = await unpackQbu(bytes, { password: "" });
    if (!unpacked.ok) {
      throw new Error("旧QBUファイルを読み取れませんでした。");
    }
    return parseQbuText(new TextDecoder().decode(unpacked.body), options);
  }
  return parseQbuText(new TextDecoder().decode(bytes), options);
}
