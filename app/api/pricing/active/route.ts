import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type PricingActiveResponse = {
  ok: true;
  pricing: {
    configId: number | null;
    currency: string;
    baseFeeYen: number;
    perCm3Yen: number;
    minFeeYen: number;
    roundingStepYen: number;
    effectiveFrom?: string | null;
    note?: string | null;
  };
  source: "db" | "fallback";
} | {
  ok: false;
  error: string;
};

function toInt(v: any, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function toIntOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export async function GET(): Promise<NextResponse<PricingActiveResponse>> {
  const admin = getSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "supabase_admin_not_configured" }, { status: 501 });
  }

  // defaults (matches v1.0.14 estimate)
  const fallback = {
    configId: null,
    currency: "JPY",
    baseFeeYen: 800,
    perCm3Yen: 60,
    minFeeYen: 1200,
    roundingStepYen: 10,
    effectiveFrom: null,
    note: "default",
  };

  try {
    const { data, error } = await admin
      .from("pricing_configs")
      .select("id,currency,base_fee_yen,per_cm3_yen,min_fee_yen,rounding_step_yen,effective_from,note")
      .eq("is_active", true)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ ok: true, pricing: fallback, source: "fallback" });
    }

    return NextResponse.json({
      ok: true,
      pricing: {
        configId: toIntOrNull((data as any).id),
        currency: String((data as any).currency || "JPY"),
        baseFeeYen: toInt((data as any).base_fee_yen, 800),
        perCm3Yen: toInt((data as any).per_cm3_yen, 60),
        minFeeYen: toInt((data as any).min_fee_yen, 1200),
        roundingStepYen: Math.max(1, toInt((data as any).rounding_step_yen, 10)),
        effectiveFrom: (data as any).effective_from ?? null,
        note: (data as any).note ?? null,
      },
      source: "db",
    });
  } catch {
    return NextResponse.json({ ok: true, pricing: fallback, source: "fallback" });
  }
}
