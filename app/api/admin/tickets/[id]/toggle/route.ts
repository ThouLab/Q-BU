import { NextResponse } from "next/server";

import { getAdminGate } from "@/lib/admin/adminGate";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const gate = await getAdminGate();
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.reason }, { status: 403 });
  }
  if (!(gate.admin.role === "owner" || gate.admin.role === "admin")) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const admin = getSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "supabase_admin_not_configured" }, { status: 501 });
  }

  const body = (await request.json().catch(() => null)) as any;
  const nextActive = body?.is_active === false ? false : body?.is_active === true ? true : null;

  const beforeRes = await admin.from("tickets").select("*").eq("id", id).maybeSingle();
  if (beforeRes.error || !beforeRes.data) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const before = beforeRes.data as any;
  const is_active = nextActive == null ? !Boolean(before.is_active) : Boolean(nextActive);

  const up = await admin
    .from("tickets")
    .update({ is_active })
    .eq("id", id)
    .select("id,created_at,created_by,type,code_prefix,value,currency,is_active,expires_at,max_total_uses,max_uses_per_user,constraints,note")
    .single();

  if (up.error || !up.data) {
    return NextResponse.json({ ok: false, error: "ticket_update_failed", message: up.error?.message || "" }, { status: 500 });
  }

  // Audit
  try {
    await admin.from("audit_logs").insert({
      actor_user_id: gate.admin.userId,
      actor_role: gate.admin.role,
      action: "tickets.toggle",
      target_table: "tickets",
      target_id: String(id),
      before,
      after: up.data,
    } as any);
  } catch {
    // ignore
  }

  return NextResponse.json({ ok: true, ticket: up.data });
}
