import type { Coord } from "@/components/standalone/editor-model";

export const STL_VOXEL_RESOLUTION = 40;
export const STL_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const STL_MAX_TRIANGLES = 1_000_000;
export const STL_MAX_CELL_TESTS = 25_000_000;

export type StlVoxelizationResult = {
  /** Flat xyz triples in local 0..39 voxel coordinates. */
  voxels: Int16Array;
  voxelCount: number;
  triangleCount: number;
  dimensions: Coord;
  bounds: {
    min: Coord;
    max: Coord;
  };
};

export type StlVoxelizationErrorCode =
  | "STL_EMPTY_FILE"
  | "STL_FILE_TOO_LARGE"
  | "STL_INVALID_FORMAT"
  | "STL_TOO_MANY_TRIANGLES"
  | "STL_SAMPLE_LIMIT_EXCEEDED"
  | "STL_DEGENERATE_MODEL"
  | "STL_EMPTY_RESULT"
  | "STL_WORKER_FAILED";

export class StlVoxelizationError extends Error {
  readonly code: StlVoxelizationErrorCode;

  constructor(code: StlVoxelizationErrorCode, message: string) {
    super(message);
    this.name = "StlVoxelizationError";
    this.code = code;
  }
}

type ParsedStl = {
  /** Editor axes: source X -> X, source Z -> Y, source Y -> -Z. */
  positions: Float32Array;
  triangleCount: number;
};

type FloatBounds = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

const ASCII_NUMBER_SOURCE = "[+-]?(?:(?:\\d+(?:\\.\\d*)?)|(?:\\.\\d+))(?:[eE][+-]?\\d+)?";

const stlError = (code: StlVoxelizationErrorCode, message: string): never => {
  throw new StlVoxelizationError(code, message);
};

function assertInputSize(buffer: ArrayBuffer): void {
  if (buffer.byteLength === 0) {
    stlError("STL_EMPTY_FILE", "STLファイルが空です。");
  }
  if (buffer.byteLength > STL_MAX_FILE_BYTES) {
    stlError(
      "STL_FILE_TOO_LARGE",
      `STLファイルが大きすぎます（上限${Math.floor(STL_MAX_FILE_BYTES / 1024 / 1024)}MB）。`
    );
  }
}

function binaryTriangleCount(buffer: ArrayBuffer): number | null {
  if (buffer.byteLength < 84) return null;
  return new DataView(buffer).getUint32(80, true);
}

function isProbablyBinaryStl(buffer: ArrayBuffer): boolean {
  const triangleCount = binaryTriangleCount(buffer);
  if (triangleCount !== null) {
    const expectedLength = 84 + triangleCount * 50;
    // Some binary STL writers use a textual "solid" header and append vendor metadata.
    // A complete declared facet section is therefore stronger evidence than the header text.
    if (triangleCount > 0 && expectedLength <= buffer.byteLength) return true;
  }

  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 512));
  const prefix = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
  if (/^\s*solid(?:\s|$)/i.test(prefix)) return false;
  if (/\b(?:facet|vertex|endsolid)\b/i.test(prefix)) return false;

  // Binary STL headers and facet records usually contain NUL/control bytes.
  for (const byte of bytes) {
    if (byte === 0 || (byte < 9 && byte !== 0)) return true;
  }

  return false;
}

function checkedFloat32(value: number): number {
  const rounded = Math.fround(value);
  if (!Number.isFinite(value) || !Number.isFinite(rounded)) {
    stlError("STL_INVALID_FORMAT", "STLに不正な座標が含まれています。");
  }
  return rounded;
}

function writeEditorAxes(
  target: Float32Array,
  offset: number,
  sourceX: number,
  sourceY: number,
  sourceZ: number
): void {
  target[offset] = checkedFloat32(sourceX);
  target[offset + 1] = checkedFloat32(sourceZ);
  target[offset + 2] = checkedFloat32(-sourceY);
}

function parseBinaryStl(buffer: ArrayBuffer): ParsedStl {
  if (buffer.byteLength < 84) {
    stlError("STL_INVALID_FORMAT", "バイナリSTLのヘッダーが不足しています。");
  }

  const view = new DataView(buffer);
  const triangleCount = view.getUint32(80, true);
  if (triangleCount === 0) {
    stlError("STL_INVALID_FORMAT", "STLに三角形が含まれていません。");
  }
  if (triangleCount > STL_MAX_TRIANGLES) {
    stlError(
      "STL_TOO_MANY_TRIANGLES",
      `STLの三角形数が上限（${STL_MAX_TRIANGLES.toLocaleString()}個）を超えています。`
    );
  }

  const expectedLength = 84 + triangleCount * 50;
  if (expectedLength > buffer.byteLength) {
    stlError("STL_INVALID_FORMAT", "バイナリSTLのデータが途中で切れています。");
  }

  const positions = new Float32Array(triangleCount * 9);
  let outputOffset = 0;
  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const facetOffset = 84 + triangleIndex * 50;
    for (let vertexIndex = 0; vertexIndex < 3; vertexIndex += 1) {
      const vertexOffset = facetOffset + 12 + vertexIndex * 12;
      writeEditorAxes(
        positions,
        outputOffset,
        view.getFloat32(vertexOffset, true),
        view.getFloat32(vertexOffset + 4, true),
        view.getFloat32(vertexOffset + 8, true)
      );
      outputOffset += 3;
    }
  }

  return { positions, triangleCount };
}

function createAsciiVertexPattern(): RegExp {
  return new RegExp(
    `\\bvertex\\s+(${ASCII_NUMBER_SOURCE})\\s+(${ASCII_NUMBER_SOURCE})\\s+(${ASCII_NUMBER_SOURCE})`,
    "gi"
  );
}

function parseAsciiStl(buffer: ArrayBuffer): ParsedStl {
  const text = new TextDecoder("utf-8").decode(buffer);
  const countPattern = createAsciiVertexPattern();
  let vertexCount = 0;
  while (countPattern.exec(text)) {
    vertexCount += 1;
    if (vertexCount > STL_MAX_TRIANGLES * 3) {
      stlError(
        "STL_TOO_MANY_TRIANGLES",
        `STLの三角形数が上限（${STL_MAX_TRIANGLES.toLocaleString()}個）を超えています。`
      );
    }
  }

  if (vertexCount === 0 || vertexCount % 3 !== 0) {
    stlError("STL_INVALID_FORMAT", "ASCII STLの三角形データを読み取れませんでした。");
  }

  const triangleCount = vertexCount / 3;
  const positions = new Float32Array(vertexCount * 3);
  const valuePattern = createAsciiVertexPattern();
  let outputOffset = 0;
  let match: RegExpExecArray | null;
  while ((match = valuePattern.exec(text))) {
    writeEditorAxes(
      positions,
      outputOffset,
      Number(match[1]),
      Number(match[2]),
      Number(match[3])
    );
    outputOffset += 3;
  }

  return { positions, triangleCount };
}

function parseStl(buffer: ArrayBuffer): ParsedStl {
  return isProbablyBinaryStl(buffer) ? parseBinaryStl(buffer) : parseAsciiStl(buffer);
}

function findBounds(positions: Float32Array): FloatBounds {
  const bounds: FloatBounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY
  };

  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index];
    const y = positions[index + 1];
    const z = positions[index + 2];
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.minZ = Math.min(bounds.minZ, z);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
    bounds.maxZ = Math.max(bounds.maxZ, z);
  }

  return bounds;
}

function normalizedAxis(value: number, min: number, scale: number, padding: number): number {
  return (value - min) * scale + padding;
}

const SAT_EPSILON = 1e-6;
const HALF_VOXEL = 0.5;

function axisSeparatesTriangleAndUnitBox(
  axisX: number,
  axisY: number,
  axisZ: number,
  v0x: number,
  v0y: number,
  v0z: number,
  v1x: number,
  v1y: number,
  v1z: number,
  v2x: number,
  v2y: number,
  v2z: number
): boolean {
  const axisLengthSquared = axisX * axisX + axisY * axisY + axisZ * axisZ;
  if (axisLengthSquared <= Number.EPSILON) return false;

  const projection0 = v0x * axisX + v0y * axisY + v0z * axisZ;
  const projection1 = v1x * axisX + v1y * axisY + v1z * axisZ;
  const projection2 = v2x * axisX + v2y * axisY + v2z * axisZ;
  const triangleMin = Math.min(projection0, projection1, projection2);
  const triangleMax = Math.max(projection0, projection1, projection2);
  const boxRadius = HALF_VOXEL * (Math.abs(axisX) + Math.abs(axisY) + Math.abs(axisZ));
  const tolerance = SAT_EPSILON * (Math.abs(axisX) + Math.abs(axisY) + Math.abs(axisZ) + 1);
  return triangleMin > boxRadius + tolerance || triangleMax < -boxRadius - tolerance;
}

function edgeCreatesSeparatingAxis(
  edgeX: number,
  edgeY: number,
  edgeZ: number,
  v0x: number,
  v0y: number,
  v0z: number,
  v1x: number,
  v1y: number,
  v1z: number,
  v2x: number,
  v2y: number,
  v2z: number
): boolean {
  return (
    axisSeparatesTriangleAndUnitBox(
      0,
      edgeZ,
      -edgeY,
      v0x,
      v0y,
      v0z,
      v1x,
      v1y,
      v1z,
      v2x,
      v2y,
      v2z
    ) ||
    axisSeparatesTriangleAndUnitBox(
      -edgeZ,
      0,
      edgeX,
      v0x,
      v0y,
      v0z,
      v1x,
      v1y,
      v1z,
      v2x,
      v2y,
      v2z
    ) ||
    axisSeparatesTriangleAndUnitBox(
      edgeY,
      -edgeX,
      0,
      v0x,
      v0y,
      v0z,
      v1x,
      v1y,
      v1z,
      v2x,
      v2y,
      v2z
    )
  );
}

/** Full 13-axis SAT test between one triangle and the closed unit cell at x/y/z. */
function triangleIntersectsUnitCell(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  cellX: number,
  cellY: number,
  cellZ: number
): boolean {
  const centerX = cellX + HALF_VOXEL;
  const centerY = cellY + HALF_VOXEL;
  const centerZ = cellZ + HALF_VOXEL;
  const v0x = ax - centerX;
  const v0y = ay - centerY;
  const v0z = az - centerZ;
  const v1x = bx - centerX;
  const v1y = by - centerY;
  const v1z = bz - centerZ;
  const v2x = cx - centerX;
  const v2y = cy - centerY;
  const v2z = cz - centerZ;

  // The three unit-box face normals.
  if (
    Math.max(v0x, v1x, v2x) < -HALF_VOXEL - SAT_EPSILON ||
    Math.min(v0x, v1x, v2x) > HALF_VOXEL + SAT_EPSILON ||
    Math.max(v0y, v1y, v2y) < -HALF_VOXEL - SAT_EPSILON ||
    Math.min(v0y, v1y, v2y) > HALF_VOXEL + SAT_EPSILON ||
    Math.max(v0z, v1z, v2z) < -HALF_VOXEL - SAT_EPSILON ||
    Math.min(v0z, v1z, v2z) > HALF_VOXEL + SAT_EPSILON
  ) {
    return false;
  }

  const edge0x = v1x - v0x;
  const edge0y = v1y - v0y;
  const edge0z = v1z - v0z;
  const edge1x = v2x - v1x;
  const edge1y = v2y - v1y;
  const edge1z = v2z - v1z;
  const edge2x = v0x - v2x;
  const edge2y = v0y - v2y;
  const edge2z = v0z - v2z;

  // Triangle normal.
  const normalX = edge0y * (v2z - v0z) - edge0z * (v2y - v0y);
  const normalY = edge0z * (v2x - v0x) - edge0x * (v2z - v0z);
  const normalZ = edge0x * (v2y - v0y) - edge0y * (v2x - v0x);
  if (
    axisSeparatesTriangleAndUnitBox(
      normalX,
      normalY,
      normalZ,
      v0x,
      v0y,
      v0z,
      v1x,
      v1y,
      v1z,
      v2x,
      v2y,
      v2z
    )
  ) {
    return false;
  }

  // Nine axes formed by crossing each triangle edge with the three box axes.
  if (
    edgeCreatesSeparatingAxis(
      edge0x,
      edge0y,
      edge0z,
      v0x,
      v0y,
      v0z,
      v1x,
      v1y,
      v1z,
      v2x,
      v2y,
      v2z
    ) ||
    edgeCreatesSeparatingAxis(
      edge1x,
      edge1y,
      edge1z,
      v0x,
      v0y,
      v0z,
      v1x,
      v1y,
      v1z,
      v2x,
      v2y,
      v2z
    ) ||
    edgeCreatesSeparatingAxis(
      edge2x,
      edge2y,
      edge2z,
      v0x,
      v0y,
      v0z,
      v1x,
      v1y,
      v1z,
      v2x,
      v2y,
      v2z
    )
  ) {
    return false;
  }

  return true;
}

/**
 * Converts an ASCII or binary STL into a deterministic 40^3 surface voxel set.
 *
 * Every candidate unit cell is tested against each triangle using the complete
 * separating-axis test. This conservative surface rasterization does not leave
 * sampling gaps on thin or oblique faces. The mesh keeps its aspect ratio and is
 * centered in the 40^3 local cube. Coordinates are flat xyz triples in 0..39.
 */
export function voxelizeStlArrayBuffer(buffer: ArrayBuffer): StlVoxelizationResult {
  assertInputSize(buffer);
  const parsed = parseStl(buffer);
  const sourceBounds = findBounds(parsed.positions);
  const spanX = sourceBounds.maxX - sourceBounds.minX;
  const spanY = sourceBounds.maxY - sourceBounds.minY;
  const spanZ = sourceBounds.maxZ - sourceBounds.minZ;
  const maxSpan = Math.max(spanX, spanY, spanZ);

  if (!Number.isFinite(maxSpan) || maxSpan <= Number.EPSILON) {
    stlError("STL_DEGENERATE_MODEL", "STLの大きさを判定できませんでした。");
  }

  const resolution = STL_VOXEL_RESOLUTION;
  // Keep the maximum point just inside the final cell so floor() always yields 0..39.
  const normalizedSpan = resolution - 1e-4;
  const scale = normalizedSpan / maxSpan;
  const paddingX = (resolution - spanX * scale) / 2;
  const paddingY = (resolution - spanY * scale) / 2;
  const paddingZ = (resolution - spanZ * scale) / 2;
  const occupied = new Uint8Array(resolution * resolution * resolution);
  let voxelCount = 0;
  let testedCellCount = 0;

  triangleLoop: for (
    let positionIndex = 0;
    positionIndex < parsed.positions.length;
    positionIndex += 9
  ) {
    const ax = normalizedAxis(parsed.positions[positionIndex], sourceBounds.minX, scale, paddingX);
    const ay = normalizedAxis(parsed.positions[positionIndex + 1], sourceBounds.minY, scale, paddingY);
    const az = normalizedAxis(parsed.positions[positionIndex + 2], sourceBounds.minZ, scale, paddingZ);
    const bx = normalizedAxis(parsed.positions[positionIndex + 3], sourceBounds.minX, scale, paddingX);
    const by = normalizedAxis(parsed.positions[positionIndex + 4], sourceBounds.minY, scale, paddingY);
    const bz = normalizedAxis(parsed.positions[positionIndex + 5], sourceBounds.minZ, scale, paddingZ);
    const cx = normalizedAxis(parsed.positions[positionIndex + 6], sourceBounds.minX, scale, paddingX);
    const cy = normalizedAxis(parsed.positions[positionIndex + 7], sourceBounds.minY, scale, paddingY);
    const cz = normalizedAxis(parsed.positions[positionIndex + 8], sourceBounds.minZ, scale, paddingZ);

    const minCellX = Math.max(0, Math.floor(Math.min(ax, bx, cx) - SAT_EPSILON));
    const minCellY = Math.max(0, Math.floor(Math.min(ay, by, cy) - SAT_EPSILON));
    const minCellZ = Math.max(0, Math.floor(Math.min(az, bz, cz) - SAT_EPSILON));
    const maxCellX = Math.min(resolution - 1, Math.floor(Math.max(ax, bx, cx) + SAT_EPSILON));
    const maxCellY = Math.min(resolution - 1, Math.floor(Math.max(ay, by, cy) + SAT_EPSILON));
    const maxCellZ = Math.min(resolution - 1, Math.floor(Math.max(az, bz, cz) + SAT_EPSILON));
    const candidateCount =
      (maxCellX - minCellX + 1) *
      (maxCellY - minCellY + 1) *
      (maxCellZ - minCellZ + 1);
    testedCellCount += candidateCount;
    if (testedCellCount > STL_MAX_CELL_TESTS) {
      stlError(
        "STL_SAMPLE_LIMIT_EXCEEDED",
        "STLの面が複雑すぎるため、安全な交差判定上限を超えました。形状を簡略化して再度お試しください。"
      );
    }

    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
          if (
            !triangleIntersectsUnitCell(
              ax,
              ay,
              az,
              bx,
              by,
              bz,
              cx,
              cy,
              cz,
              cellX,
              cellY,
              cellZ
            )
          ) {
            continue;
          }
          const occupiedIndex = cellX + resolution * (cellY + resolution * cellZ);
          if (occupied[occupiedIndex] !== 0) continue;
          occupied[occupiedIndex] = 1;
          voxelCount += 1;
        }
      }
    }
    if (voxelCount === occupied.length) break triangleLoop;
  }

  if (voxelCount === 0) {
    stlError("STL_EMPTY_RESULT", "STLからボクセルを生成できませんでした。");
  }

  const voxels = new Int16Array(voxelCount * 3);
  const min: Coord = { x: resolution, y: resolution, z: resolution };
  const max: Coord = { x: -1, y: -1, z: -1 };
  let outputIndex = 0;
  for (let z = 0; z < resolution; z += 1) {
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        const occupiedIndex = x + resolution * (y + resolution * z);
        if (occupied[occupiedIndex] === 0) continue;
        voxels[outputIndex] = x;
        voxels[outputIndex + 1] = y;
        voxels[outputIndex + 2] = z;
        outputIndex += 3;
        min.x = Math.min(min.x, x);
        min.y = Math.min(min.y, y);
        min.z = Math.min(min.z, z);
        max.x = Math.max(max.x, x);
        max.y = Math.max(max.y, y);
        max.z = Math.max(max.z, z);
      }
    }
  }

  return {
    voxels,
    voxelCount,
    triangleCount: parsed.triangleCount,
    dimensions: {
      x: max.x - min.x + 1,
      y: max.y - min.y + 1,
      z: max.z - min.z + 1
    },
    bounds: { min, max }
  };
}
