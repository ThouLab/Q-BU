import JSZip from "jszip";
import {
  WORKSHOP_COLORS,
  buildStandaloneQbu,
  keyOf,
  normalizeModel,
  sanitizeQbuFileName,
  type Coord,
  type VoxelModel,
  type WorkshopColor
} from "@/components/standalone/editor-model";

type Vec3 = [number, number, number];

type Face = {
  normal: Vec3;
  corners: [Vec3, Vec3, Vec3, Vec3];
};

const PROJECT_CODE = "0001";
const DIRECTIONS: Coord[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 }
];

const faceDefinitions = (min: Vec3, max: Vec3): Face[] => {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  return [
    { normal: [1, 0, 0], corners: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]] },
    { normal: [-1, 0, 0], corners: [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]] },
    { normal: [0, 1, 0], corners: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]] },
    { normal: [0, -1, 0], corners: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] },
    { normal: [0, 0, 1], corners: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
    { normal: [0, 0, -1], corners: [[x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]] }
  ];
};

const neighborForFace = (coord: Coord, normal: Vec3): Coord => ({
  x: coord.x + normal[0],
  y: coord.y + normal[1],
  z: coord.z + normal[2]
});

const numberText = (value: number): string => {
  if (Object.is(value, -0)) return "0";
  return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/g, "").replace(/\.$/g, "");
};

const facet = (normal: Vec3, a: Vec3, b: Vec3, c: Vec3): string =>
  [
    `  facet normal ${normal.map(numberText).join(" ")}`,
    "    outer loop",
    `      vertex ${a.map(numberText).join(" ")}`,
    `      vertex ${b.map(numberText).join(" ")}`,
    `      vertex ${c.map(numberText).join(" ")}`,
    "    endloop",
    "  endfacet"
  ].join("\n");

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
};

const slugifyFileSegment = (input: string): string => {
  const normalized = sanitizeQbuFileName(input).normalize("NFKC");
  return normalized
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "")
    .slice(0, 80) || "Q-BU";
};

const colorCounts = (model: VoxelModel): Record<WorkshopColor, number> => {
  const counts: Record<WorkshopColor, number> = { white: 0, red: 0, blue: 0 };
  for (const block of model.blocks) counts[block.color] += 1;
  return counts;
};

const componentCount = (keys: Set<string>): number => {
  const remaining = new Set(keys);
  let count = 0;
  while (remaining.size > 0) {
    const first = remaining.values().next().value as string;
    const stack = [first];
    remaining.delete(first);
    count += 1;
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      const [x, y, z] = current.split(",").map((part) => Number.parseInt(part, 10));
      for (const direction of DIRECTIONS) {
        const next = keyOf({ x: x + direction.x, y: y + direction.y, z: z + direction.z });
        if (!remaining.has(next)) continue;
        remaining.delete(next);
        stack.push(next);
      }
    }
  }
  return count;
};

const validationWarnings = (model: VoxelModel): string[] => {
  if (model.blocks.length === 0) return ["EMPTY_MODEL_WARNING"];
  const warnings: string[] = [];
  const allKeys = new Set(model.blocks.map(keyOf));
  if (componentCount(allKeys) > 1) warnings.push("FLOATING_BLOCKS_WARNING");
  if (
    WORKSHOP_COLORS.some(
      (color) => componentCount(new Set(model.blocks.filter((block) => block.color === color).map(keyOf))) > 1
    )
  ) {
    warnings.push("COLOR_ISLANDS_WARNING");
  }
  return warnings;
};

const generateAsciiStl = (
  model: VoxelModel,
  blockSizeMm: number,
  solidName: string,
  color?: WorkshopColor
): string | null => {
  const blocks = color ? model.blocks.filter((block) => block.color === color) : model.blocks;
  if (blocks.length === 0) return null;

  const includedKeys = new Set(blocks.map(keyOf));
  const lines = [`solid ${solidName}`];
  const half = blockSizeMm / 2;

  for (const block of blocks) {
    const min: Vec3 = [
      block.x * blockSizeMm - half,
      block.y * blockSizeMm - half,
      block.z * blockSizeMm - half
    ];
    const max: Vec3 = [
      block.x * blockSizeMm + half,
      block.y * blockSizeMm + half,
      block.z * blockSizeMm + half
    ];
    for (const face of faceDefinitions(min, max)) {
      if (includedKeys.has(keyOf(neighborForFace(block, face.normal)))) continue;
      const [a, b, c, d] = face.corners;
      lines.push(facet(face.normal, a, b, c));
      lines.push(facet(face.normal, a, c, d));
    }
  }

  lines.push(`endsolid ${solidName}`);
  return `${lines.join("\n")}\n`;
};

export type StandaloneExport = {
  blob: Blob;
  fileName: string;
};

export type StandaloneArchive = StandaloneExport;

export async function buildStandaloneExport(input: {
  fileName: string;
  blockSizeMm: number;
  model: VoxelModel;
  singleStlOnly?: boolean;
}): Promise<StandaloneExport> {
  if (!Number.isFinite(input.blockSizeMm) || input.blockSizeMm < 0.1 || input.blockSizeMm > 100) {
    throw new Error("1ブロックの長さは0.1〜100mmで指定してください。");
  }

  const exportedAt = new Date().toISOString();
  const model = normalizeModel(input.model);
  const fileName = sanitizeQbuFileName(input.fileName);
  const rootSegment = slugifyFileSegment(fileName);
  const stlBaseName = `${PROJECT_CODE}_${rootSegment}`;
  const combinedStl =
    generateAsciiStl(model, input.blockSizeMm, "qbu_all") ??
    "solid qbu_all\nendsolid qbu_all\n";

  if (input.singleStlOnly) {
    return {
      blob: new Blob([combinedStl], { type: "model/stl" }),
      fileName: `${stlBaseName}_all.stl`
    };
  }

  const zip = new JSZip();
  const root = zip.folder(rootSegment);
  const projectFolder = root?.folder(PROJECT_CODE);
  if (!root || !projectFolder) throw new Error("ZIPの作成に失敗しました。");

  const qbuPayload = buildStandaloneQbu(fileName, model, input.blockSizeMm);
  projectFolder.file(`${PROJECT_CODE}.qbu`, `${JSON.stringify(qbuPayload, null, 2)}\n`);

  for (const color of WORKSHOP_COLORS) {
    const stl = generateAsciiStl(model, input.blockSizeMm, `qbu_${color}`, color);
    if (stl) projectFolder.file(`${stlBaseName}_${color}.stl`, stl);
  }
  projectFolder.file(`${stlBaseName}_all.stl`, combinedStl);

  const counts = colorCounts(model);
  const warnings = validationWarnings(model);
  const manifest = [
    [
      "confirmation_code",
      "file_name",
      "host_memo",
      "source_project_id",
      "revision_number",
      "project_id",
      "status",
      "block_count",
      "white_blocks",
      "red_blocks",
      "blue_blocks",
      "warnings",
      "completed_at",
      "downloaded_at"
    ],
    [
      PROJECT_CODE,
      fileName,
      "",
      "",
      "1",
      "",
      "downloaded",
      String(model.blocks.length),
      String(counts.white),
      String(counts.red),
      String(counts.blue),
      warnings.join("|") || "OK",
      exportedAt,
      exportedAt
    ]
  ];
  root.file("manifest.csv", `${manifest.map((row) => row.map(csvCell).join(",")).join("\n")}\n`);

  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });

  return {
    blob,
    fileName: `${rootSegment}_${exportedAt.slice(0, 10)}.zip`
  };
}

export async function buildStandaloneArchive(input: {
  fileName: string;
  blockSizeMm: number;
  model: VoxelModel;
}): Promise<StandaloneArchive> {
  return buildStandaloneExport(input);
}
