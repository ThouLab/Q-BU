import { NextResponse } from "next/server";

import { getAdminGate } from "@/lib/admin/adminGate";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function toInt(v: any, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export async function POST(request: Request) {
  const gate = await getAdminGate();
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.reason }, { status: 403 });
  }
  if (gate.admin.role !== "owner") {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const admin = getSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "supabase_admin_not_configured" }, { status: 501 });
  }

  const body = await request.json().catch(() => null) as any;

  const base_fee_yen = clamp(toInt(body?.base_fee_yen, 800), 0, 1_000_000);
  const per_cm3_yen = clamp(toInt(body?.per_cm3_yen, 60), 0, 1_000_000);
  const min_fee_yen = clamp(toInt(body?.min_fee_yen, 1200), 0, 1_000_000);
  const rounding_step_yen = clamp(toInt(body?.rounding_step_yen, 10), 1, 10_000);
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 200) : null;

  // Snapshot previous active
  const beforeRes = await admin
    .from("pricing_configs")
    .select("*")
    .eq("is_active", true)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Deactivate current active (unique partial index enforces single active)
  await admin.from("pricing_configs").update({ is_active: false }).eq("is_active", true);

  const now = new Date().toISOString();
  const insertRes = await admin
    .from("pricing_configs")
    .insert({
      is_active: true,
      effective_from: now,
      currency: "JPY",
      base_fee_yen,
      per_cm3_yen,
      min_fee_yen,
      rounding_step_yen,
      note,
      created_by: gate.admin.userId,
    })
    .select("*")
    .single();

  if (insertRes.error || !insertRes.data) {
    // Attempt to rollback: if insert failed, re-activate previous row
    if (beforeRes.data?.id) {
      await admin.from("pricing_configs").update({ is_active: true }).eq("id", beforeRes.data.id);
    }
    return NextResponse.json(
      { ok: false, error: "pricing_update_failed", message: insertRes.error?.message || "" },
      { status: 500 }
    );
  }

  // Audit
  try {
    await admin.from("audit_logs").insert({
      actor_user_id: gate.admin.userId,
      actor_role: gate.admin.role,
      action: "pricing.update",
      target_table: "pricing_configs",
      target_id: String(insertRes.data.id),
      before: beforeRes.data ?? null,
      after: insertRes.data,
      note: "activate_new_pricing",
    } as any);
  } catch {
    // ignore
  }

  return NextResponse.json({ ok: true, pricing: insertRes.data });
}
