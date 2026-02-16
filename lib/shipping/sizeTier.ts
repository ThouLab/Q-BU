export type SizeTier = "60" | "80" | "100" | "120";

export type SizeMm = { x: number; y: number; z: number };

function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function worldSizeToMm(worldSize: { x: number; y: number; z: number }, mmPerUnit: number): SizeMm {
  const k = Math.max(0, toNum(mmPerUnit));
  return {
    x: Math.max(0, toNum(worldSize.x) * k),
    y: Math.max(0, toNum(worldSize.y) * k),
    z: Math.max(0, toNum(worldSize.z) * k),
  };
}

export function deriveSizeTierFromMm(sizeMm: SizeMm, opts?: { paddingMm?: number }): {
  sizeTier: SizeTier;
  sumCm: number;
  paddedMm: SizeMm;
  capped: boolean;
} {
  const pad = Math.max(0, toNum(opts?.paddingMm ?? 20));
  const padded = {
    x: Math.max(0, toNum(sizeMm.x) + pad),
    y: Math.max(0, toNum(sizeMm.y) + pad),
    z: Math.max(0, toNum(sizeMm.z) + pad),
  };
  const sumCm = (padded.x + padded.y + padded.z) / 10;

  if (sumCm <= 60) return { sizeTier: "60", sumCm, paddedMm: padded, capped: false };
  if (sumCm <= 80) return { sizeTier: "80", sumCm, paddedMm: padded, capped: false };
  if (sumCm <= 100) return { sizeTier: "100", sumCm, paddedMm: padded, capped: false };
  // cap at 120 for v1.0.16 (rates are editable)
  return { sizeTier: "120", sumCm, paddedMm: padded, capped: true };
}
