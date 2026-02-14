import { NextResponse } from "next/server";

import { getAdminGate } from "@/lib/admin/adminGate";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function safeRole(v: any): "owner" | "admin" | "ops" | "analyst" {
  switch (v) {
    case "owner":
    case "admin":
    case "ops":
    case "analyst":
      return v;
    default:
      return "admin";
  }
}

function isUuid(v: string): boolean {
  return /^[0-9a-fA-F-]{36}$/.test(v);
}

export async function GET() {
  const gate = await getAdminGate();
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.reason }, { status: 403 });
  }

  const admin = getSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "supabase_admin_not_configured" }, { status: 501 });
  }

  const res = await admin
    .from("admin_roles")
    .select("user_id,role,is_active,created_at,updated_at")
    .order("updated_at", { ascending: false });

  if (res.error) {
    return NextResponse.json({ ok: false, error: "roles_query_failed", message: res.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, roles: res.data || [] });
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

  const body = (await request.json().catch(() => null)) as any;

  const user_id = typeof body?.user_id === "string" ? body.user_id.trim() : "";
  const role = safeRole(body?.role);
  const is_active = body?.is_active === false ? false : true;

  if (!user_id || !isUuid(user_id)) {
    return NextResponse.json({ ok: false, error: "bad_request", message: "user_id が不正です" }, { status: 400 });
  }

  // Prevent removing the last active owner.
  const beforeRes = await admin.from("admin_roles").select("user_id,role,is_active").eq("user_id", user_id).maybeSingle();
  const before = beforeRes.data ?? null;

  const willBeActiveOwner = is_active && role === "owner";
  const wasActiveOwner = before?.is_active === true && before?.role === "owner";

  if (wasActiveOwner && !willBeActiveOwner) {
    const otherOwners = await admin
      .from("admin_roles")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "owner")
      .eq("is_active", true)
      .neq("user_id", user_id);

    const cnt = (otherOwners as any).count || 0;
    if (cnt <= 0) {
      return NextResponse.json(
        { ok: false, error: "forbidden", message: "最後のownerは無効化/降格できません" },
        { status: 400 }
      );
    }
  }

  const up = await admin
    .from("admin_roles")
    .upsert({ user_id, role, is_active }, { onConflict: "user_id" })
    .select("user_id,role,is_active,created_at,updated_at")
    .single();

  if (up.error || !up.data) {
    return NextResponse.json({ ok: false, error: "roles_upsert_failed", message: up.error?.message || "" }, { status: 500 });
  }

  // Audit
  try {
    await admin.from("audit_logs").insert({
      actor_user_id: gate.admin.userId,
      actor_role: gate.admin.role,
      action: "admin_roles.upsert",
      target_table: "admin_roles",
      target_id: user_id,
      before,
      after: up.data,
    } as any);
  } catch {
    // ignore
  }

  return NextResponse.json({ ok: true, role: up.data });
}
