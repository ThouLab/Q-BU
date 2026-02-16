import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { fallbackShippingRates, type ShippingRateRow } from "@/lib/shipping/rates";

export const runtime = "nodejs";

type ShippingActiveResponse =
  | {
      ok: true;
      shipping: {
        configId: number | null;
        currency: string;
        effectiveFrom?: string | null;
        note?: string | null;
        rates: ShippingRateRow[];
      };
      source: "db" | "fallback";
    }
  | {
      ok: false;
      error: string;
    };

function toIntOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toInt(v: any, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

export async function GET(): Promise<NextResponse<ShippingActiveResponse>> {
  const admin = getSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({
      ok: true,
      shipping: {
        configId: null,
        currency: "JPY",
        effectiveFrom: null,
        note: "default",
        rates: fallbackShippingRates(),
      },
      source: "fallback",
    });
  }

  const fallback = {
    configId: null,
    currency: "JPY",
    effectiveFrom: null,
    note: "default",
    rates: fallbackShippingRates(),
  };

  try {
    const cfgRes = await admin
      .from("shipping_configs")
      .select("id,currency,effective_from,note")
      .eq("is_active", true)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cfgRes.error || !cfgRes.data) {
      return NextResponse.json({ ok: true, shipping: fallback, source: "fallback" });
    }

    const cfg: any = cfgRes.data;
    const configId = toIntOrNull(cfg.id);
    if (configId == null) {
      return NextResponse.json({ ok: true, shipping: fallback, source: "fallback" });
    }

    const ratesRes = await admin
      .from("shipping_rates")
      .select("zone,size_tier,price_yen")
      .eq("config_id", configId)
      .order("zone", { ascending: true })
      .order("size_tier", { ascending: true })
      .limit(500);

    if (ratesRes.error || !Array.isArray(ratesRes.data) || ratesRes.data.length === 0) {
      return NextResponse.json({ ok: true, shipping: fallback, source: "fallback" });
    }

    const rows: ShippingRateRow[] = (ratesRes.data as any[]).map((r) => ({
      zone: String((r as any).zone || ""),
      size_tier: String((r as any).size_tier || ""),
      price_yen: toInt((r as any).price_yen, 0),
    }));

    return NextResponse.json({
      ok: true,
      shipping: {
        configId,
        currency: String(cfg.currency || "JPY"),
        effectiveFrom: cfg.effective_from ?? null,
        note: cfg.note ?? null,
        rates: rows,
      },
      source: "db",
    });
  } catch {
    return NextResponse.json({ ok: true, shipping: fallback, source: "fallback" });
  }
}
