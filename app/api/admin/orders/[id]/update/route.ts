import { NextResponse } from "next/server";

import { getAdminGate } from "@/lib/admin/adminGate";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function safeText(x: unknown, maxLen: number): string {
  const s = typeof x === "string" ? x : "";
  return s.trim().slice(0, maxLen);
}

function normalizeStatus(x: unknown): string | null {
  const s = typeof x === "string" ? x : "";
  switch (s) {
    case "submitted":
    case "confirmed":
    case "printing":
    case "shipped":
    case "done":
    case "cancelled":
      return s;
    default:
      return null;
  }
}

function normalizePayment(x: unknown): string | null {
  const s = typeof x === "string" ? x : "";
  switch (s) {
    case "unpaid":
    case "pending":
    case "paid":
    case "refunded":
    case "failed":
      return s;
    default:
      return null;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const gate = await getAdminGate();
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.reason }, { status: 401 });
  }

  // update is restricted (owner/admin/ops only)
  if (gate.admin.role !== "owner" && gate.admin.role !== "admin" && gate.admin.role !== "ops") {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const admin = getSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "supabase_admin_not_configured" }, { status: 501 });
  }

  let body: any = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const nextStatus = normalizeStatus(body?.status);
  const nextPayment = normalizePayment(body?.payment_status);
  const nextNote = safeText(body?.admin_note, 2000);

  // load before
  const { data: before, error: e0 } = await admin
    .from("print_orders")
    .select("id,status,payment_status,admin_note,updated_at")
    .eq("id", id)
    .maybeSingle();

  if (e0 || !before) {
    return NextResponse.json({ ok: false, error: "not_found", message: e0?.message || "" }, { status: 404 });
  }

  const patch: any = {};
  if (nextStatus) patch.status = nextStatus;
  if (nextPayment) patch.payment_status = nextPayment;
  if (typeof body?.admin_note === "string") patch.admin_note = nextNote;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "no_changes" }, { status: 400 });
  }

  const { error: e1 } = await admin.from("print_orders").update(patch).eq("id", id);
  if (e1) {
    return NextResponse.json({ ok: false, error: "update_failed", message: e1.message }, { status: 500 });
  }

  // audit
  try {
    await admin.from("audit_logs").insert({
      actor_user_id: gate.admin.userId,
      actor_role: gate.admin.role,
      action: "print_orders.update",
      target_table: "print_orders",
      target_id: id,
      before,
      after: { ...(before as any), ...patch },
      note: "admin_api_update",
    });
  } catch {
    // ignore
  }

  return NextResponse.json({ ok: true });
}
