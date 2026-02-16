import type { ShippingZone } from "./zones";
import type { SizeTier } from "./sizeTier";

export type ShippingRateRow = {
  zone: ShippingZone | string;
  size_tier: SizeTier | string;
  price_yen: number;
};

export const DEFAULT_ZONES: ShippingZone[] = ["hokkaido", "tohoku", "kanto", "chubu", "kinki", "chugoku", "shikoku", "kyushu", "okinawa"];
export const DEFAULT_SIZE_TIERS: SizeTier[] = ["60", "80", "100", "120"];

export function toInt(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

export function normalizeZone(z: any): string {
  return String(z || "").trim().toLowerCase();
}

export function normalizeTier(t: any): string {
  return String(t || "").trim();
}

export function buildRateMap(rows: ShippingRateRow[]): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>();
  for (const r of rows || []) {
    const zone = normalizeZone((r as any).zone);
    const tier = normalizeTier((r as any).size_tier);
    const yen = toInt((r as any).price_yen, NaN);
    if (!zone || !tier || !Number.isFinite(yen)) continue;
    if (!m.has(zone)) m.set(zone, new Map());
    m.get(zone)!.set(tier, yen);
  }
  return m;
}

export function findShippingYen(map: Map<string, Map<string, number>>, zone: string, tier: string): number | null {
  const z = normalizeZone(zone);
  const t = normalizeTier(tier);
  if (!z || !t) return null;
  const row = map.get(z);
  if (!row) return null;
  const yen = row.get(t);
  return Number.isFinite(yen as any) ? (yen as number) : null;
}

export function fallbackShippingRates(): ShippingRateRow[] {
  // Must match the seeded defaults in 20260214_v1016_alpha.sql
  return [
    { zone: "kanto", size_tier: "60", price_yen: 700 },
    { zone: "kanto", size_tier: "80", price_yen: 900 },
    { zone: "kanto", size_tier: "100", price_yen: 1100 },
    { zone: "kanto", size_tier: "120", price_yen: 1300 },

    { zone: "chubu", size_tier: "60", price_yen: 750 },
    { zone: "chubu", size_tier: "80", price_yen: 950 },
    { zone: "chubu", size_tier: "100", price_yen: 1150 },
    { zone: "chubu", size_tier: "120", price_yen: 1350 },

    { zone: "kinki", size_tier: "60", price_yen: 750 },
    { zone: "kinki", size_tier: "80", price_yen: 950 },
    { zone: "kinki", size_tier: "100", price_yen: 1150 },
    { zone: "kinki", size_tier: "120", price_yen: 1350 },

    { zone: "tohoku", size_tier: "60", price_yen: 850 },
    { zone: "tohoku", size_tier: "80", price_yen: 1050 },
    { zone: "tohoku", size_tier: "100", price_yen: 1250 },
    { zone: "tohoku", size_tier: "120", price_yen: 1450 },

    { zone: "chugoku", size_tier: "60", price_yen: 950 },
    { zone: "chugoku", size_tier: "80", price_yen: 1150 },
    { zone: "chugoku", size_tier: "100", price_yen: 1350 },
    { zone: "chugoku", size_tier: "120", price_yen: 1550 },

    { zone: "shikoku", size_tier: "60", price_yen: 950 },
    { zone: "shikoku", size_tier: "80", price_yen: 1150 },
    { zone: "shikoku", size_tier: "100", price_yen: 1350 },
    { zone: "shikoku", size_tier: "120", price_yen: 1550 },

    { zone: "kyushu", size_tier: "60", price_yen: 1050 },
    { zone: "kyushu", size_tier: "80", price_yen: 1250 },
    { zone: "kyushu", size_tier: "100", price_yen: 1450 },
    { zone: "kyushu", size_tier: "120", price_yen: 1650 },

    { zone: "hokkaido", size_tier: "60", price_yen: 1200 },
    { zone: "hokkaido", size_tier: "80", price_yen: 1400 },
    { zone: "hokkaido", size_tier: "100", price_yen: 1600 },
    { zone: "hokkaido", size_tier: "120", price_yen: 1800 },

    { zone: "okinawa", size_tier: "60", price_yen: 1400 },
    { zone: "okinawa", size_tier: "80", price_yen: 1600 },
    { zone: "okinawa", size_tier: "100", price_yen: 1800 },
    { zone: "okinawa", size_tier: "120", price_yen: 2000 },
  ];
}
