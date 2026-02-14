// Print scale helpers (v1.0.14 preparation)
//
// Q-BU world units:
// - Base block edge length is 1 world unit.
// - If support blocks are used, they can be 0.5 world units, but the overall
//   output scale is still expressed as "mm per 1 world unit".
//
// This module provides:
// - toggle-able print scale setting (max side mm OR per-block edge mm)
// - resolved scale (mmPerUnit) and derived max-side mm
// - very rough price estimate (shipping excluded)

export type PrintScaleSetting =
  | { mode: "maxSide"; maxSideMm: number }
  | { mode: "blockEdge"; blockEdgeMm: number };

export type ResolvedPrintScale = {
  mode: PrintScaleSetting["mode"];
  /** physical mm per 1 world unit (1 block edge) */
  mmPerUnit: number;
  /** physical max side length (mm) derived from bboxMaxDimWorld */
  maxSideMm: number;
  /** true if maxSideMm > 180mm */
  warnTooLarge: boolean;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function resolvePrintScale(args: {
  bboxMaxDimWorld: number;
  setting: PrintScaleSetting;
  // reasonable clamps (matches existing UX: 10..300 for max side)
  clampMaxSideMm?: { min: number; max: number };
  clampBlockEdgeMm?: { min: number; max: number };
}): ResolvedPrintScale {
  const dim = Math.max(1e-6, args.bboxMaxDimWorld || 1);

  const clampMax = args.clampMaxSideMm ?? { min: 10, max: 300 };
  const clampEdge = args.clampBlockEdgeMm ?? { min: 0.1, max: 10_000 }; // generous upper bound

  if (args.setting.mode === "maxSide") {
    const target = clamp(Math.round(args.setting.maxSideMm || 0), clampMax.min, clampMax.max);
    const mmPerUnit = target / dim;
    return {
      mode: "maxSide",
      mmPerUnit,
      maxSideMm: target,
      warnTooLarge: target > 180,
    };
  }

  // blockEdge mode
  const edge = clamp(Number(args.setting.blockEdgeMm || 0), clampEdge.min, clampEdge.max);
  const maxSideMm = dim * edge;
  return {
    mode: "blockEdge",
    mmPerUnit: edge,
    maxSideMm,
    warnTooLarge: maxSideMm > 180,
  };
}

/** Format helpers (UI convenience) */
export function formatMm(v: number, digits = 1): string {
  const n = Number.isFinite(v) ? v : 0;
  return n.toFixed(digits);
}
export function formatYen(v: number): string {
  const n = Math.max(0, Math.round(Number.isFinite(v) ? v : 0));
  return n.toLocaleString("ja-JP");
}

/**
 * Rough solid volume estimate (cm^3), assuming:
 * - base blocks are 1^3 in world units
 * - support blocks are 0.5^3 = 0.125 in world units
 *
 * Actual print cost depends heavily on infill, wall thickness, material, machine, and post-processing.
 * This is intentionally simple to provide a "ballpark" for UI display.
 */
export function estimateSolidVolumeCm3(args: {
  baseBlockCount: number;
  supportBlockCount: number;
  mmPerUnit: number;
}): number {
  const baseCount = Math.max(0, Math.floor(args.baseBlockCount || 0));
  const suppCount = Math.max(0, Math.floor(args.supportBlockCount || 0));
  const mm = Math.max(1e-6, args.mmPerUnit || 1);

  const worldVolume = baseCount * 1 + suppCount * 0.125;
  const mm3 = worldVolume * mm * mm * mm;
  const cm3 = mm3 / 1000.0;
  return cm3;
}

export type PrintPriceEstimate = {
  // shipping excluded
  subtotalYen: number;
  breakdown: {
    baseFeeYen: number;
    volumeFeeYen: number;
    /** pricing params snapshot (optional) */
    perCm3Yen?: number;
    minFeeYen?: number;
    rawYen?: number;
    roundingStepYen?: number;
  };
  volumeCm3: number;
  // for UI copy
  notes: string[];
};

export type PricingParams = {
  baseFeeYen: number;
  perCm3Yen: number;
  minFeeYen: number;
  roundingStepYen?: number;
};

/**
 * Very rough pricing model (shipping excluded).
 *
 * - Base fee covers setup/handling.
 * - Volume fee scales with estimated solid volume.
 * - A minimum charge is applied.
 *
 * Tune these numbers later to match your business assumptions.
 */
export function estimatePrintPriceYen(volumeCm3: number, pricing?: Partial<PricingParams>): PrintPriceEstimate {
  const v = Math.max(0, Number.isFinite(volumeCm3) ? volumeCm3 : 0);

  // --- defaults (ballpark) ---
  const BASE_FEE = Number.isFinite(pricing?.baseFeeYen) ? Number(pricing?.baseFeeYen) : 800;
  const PER_CM3 = Number.isFinite(pricing?.perCm3Yen) ? Number(pricing?.perCm3Yen) : 60;
  const MIN = Number.isFinite(pricing?.minFeeYen) ? Number(pricing?.minFeeYen) : 1200;
  const STEP = Number.isFinite(pricing?.roundingStepYen) ? Math.max(1, Math.round(Number(pricing?.roundingStepYen))) : 10;
  // --------------------------

  const volumeFee = Math.round(v * PER_CM3);
  const raw = BASE_FEE + volumeFee;
  const subtotal = Math.max(MIN, raw);

  // round for nicer UX
  const rounded = Math.round(subtotal / STEP) * STEP;

  return {
    subtotalYen: rounded,
    breakdown: {
      baseFeeYen: BASE_FEE,
      volumeFeeYen: volumeFee,
      perCm3Yen: PER_CM3,
      minFeeYen: MIN,
      rawYen: raw,
      roundingStepYen: STEP,
    },
    volumeCm3: v,
    notes: [
      "概算です（造形方式・材料・肉厚・充填率で変動します）。",
      "配送料は別途です。",
    ],
  };
}
