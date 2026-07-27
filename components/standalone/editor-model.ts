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
  };
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

export function buildStandaloneQbu(fileName: string, model: VoxelModel): StandaloneQbuPayload {
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
      maxBlocks: EDITOR_MAX_BLOCKS
    },
    model: normalizeModel(model)
  };
}
