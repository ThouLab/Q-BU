import { NextResponse } from "next/server";

import { getAdminGate } from "@/lib/admin/adminGate";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_SIZE_TIERS, DEFAULT_ZONES, toInt, type ShippingRateRow } from "@/lib/shipping/rates";

export const runtime = "nodejs";

function isValidZone(z: string): boolean {
  return DEFAULT_ZONES.includes(z as any);
}

function isValidTier(t: string): boolean {
  return DEFAULT_SIZE_TIERS.includes(t as any);
}

export async function POST(request: Request) {
  const gate = await getAdminGate();
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.reason }, { status: 403 });
  if (gate.admin.role !== "owner") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ ok: false, error: "supabase_admin_not_configured" }, { status: 501 });

  const body = (await request.json().catch(() => null)) as any;
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 200) : null;
  const ratesIn = Array.isArray(body?.rates) ? (body.rates as any[]) : [];

  // Normalize / validate
  const matrix: ShippingRateRow[] = [];
  for (const z of DEFAULT_ZONES) {
    for (const t of DEFAULT_SIZE_TIERS) {
      matrix.push({ zone: z, size_tier: t, price_yen: 0 });
    }
  }
  const idx = new Map<string, number>();
  matrix.forEach((r, i) => idx.set(`${r.zone}__${r.size_tier}`, i));

  for (const r of ratesIn) {
    const zone = String(r?.zone || "").toLowerCase();
    const tier = String(r?.size_tier || "");
    if (!isValidZone(zone) || !isValidTier(tier)) continue;
    const yen = Math.max(0, toInt(r?.price_yen, 0));
    const k = `${zone}__${tier}`;
    const i = idx.get(k);
    if (i == null) continue;
    matrix[i] = { zone, size_tier: tier, price_yen: yen };
  }

  // Snapshot previous active
  const beforeRes = await admin
    .from("shipping_configs")
    .select("*")
    .eq("is_active", true)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Deactivate current
  await admin.from("shipping_configs").update({ is_active: false }).eq("is_active", true);

  const now = new Date().toISOString();
  const cfgRes = await admin
    .from("shipping_configs")
    .insert({
      is_active: true,
      effective_from: now,
      currency: "JPY",
      note,
      created_by: gate.admin.userId,
    })
    .select("id")
    .single();

  if (cfgRes.error || !cfgRes.data?.id) {
    if (beforeRes.data?.id) {
      await admin.from("shipping_configs").update({ is_active: true }).eq("id", beforeRes.data.id);
    }
    return NextResponse.json({ ok: false, error: "shipping_update_failed", message: cfgRes.error?.message || "" }, { status: 500 });
  }

  const configId = Number(cfgRes.data.id);
  if (!Number.isFinite(configId)) {
    return NextResponse.json({ ok: false, error: "shipping_update_failed", message: "bad_config_id" }, { status: 500 });
  }

  const insertRatesRes = await admin
    .from("shipping_rates")
    .insert(
      matrix.map((r) => ({
        config_id: configId,
        zone: r.zone,
        size_tier: r.size_tier,
        price_yen: r.price_yen,
      }))
    );

  if (insertRatesRes.error) {
    // rollback
    await admin.from("shipping_configs").delete().eq("id", configId);
    if (beforeRes.data?.id) {
      await admin.from("shipping_configs").update({ is_active: true }).eq("id", beforeRes.data.id);
    }
    return NextResponse.json({ ok: false, error: "shipping_update_failed", message: insertRatesRes.error.message }, { status: 500 });
  }

  // Audit (best-effort)
  try {
    await admin.from("audit_logs").insert({
      actor_user_id: gate.admin.userId,
      actor_role: gate.admin.role,
      action: "shipping.update",
      target_table: "shipping_configs",
      target_id: String(configId),
      before: beforeRes.data ?? null,
      after: { id: configId, note, currency: "JPY", effective_from: now, is_active: true },
      note: "activate_new_shipping",
    } as any);
  } catch {
    // ignore
  }

  return NextResponse.json({ ok: true, shipping_config_id: configId });
}
