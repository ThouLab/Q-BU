import { NextResponse } from "next/server";

import { getAdminGate } from "@/lib/admin/adminGate";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { generateTicketCode, hashTicketCode, safeTicketType, ticketCodePrefix, type TicketType } from "@/lib/secure/ticketCode";

export const runtime = "nodejs";

function toIntOrNull(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function parseJsonMaybe(v: any): any | null {
  if (!v) return null;
  if (typeof v === "object") return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }
  return null;
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
    .from("v_tickets_with_usage")
    .select("id,created_at,created_by,type,code_prefix,value,currency,is_active,expires_at,max_total_uses,max_uses_per_user,constraints,note,used_total")
    .order("created_at", { ascending: false })
    .limit(200);

  if (res.error) {
    return NextResponse.json(
      { ok: false, error: "tickets_query_failed", message: res.error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, tickets: res.data || [] });
}

export async function POST(request: Request) {
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

  const type = safeTicketType(body?.type);
  if (!type) {
    return NextResponse.json({ ok: false, error: "bad_request", message: "type が不正です" }, { status: 400 });
  }

  let value: number | null = null;
  if (type === "percent") {
    const n = toIntOrNull(body?.value);
    value = n == null ? null : clamp(n, 0, 100);
  } else if (type === "fixed") {
    const n = toIntOrNull(body?.value);
    value = n == null ? null : clamp(n, 0, 1_000_000);
  } else {
    value = null;
  }

  let expires_at: string | null = null;
  if (typeof body?.expires_at === "string" && body.expires_at.trim()) {
    const d = new Date(body.expires_at);
    if (Number.isFinite(d.getTime())) {
      expires_at = d.toISOString();
    }
  }

  const max_total_uses = (() => {
    const n = toIntOrNull(body?.max_total_uses);
    if (n == null) return null;
    return clamp(n, 0, 1_000_000);
  })();

  const max_uses_per_user = (() => {
    const n = toIntOrNull(body?.max_uses_per_user);
    if (n == null) return null;
    return clamp(n, 0, 1_000_000);
  })();

  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 200) : null;
  const constraints = parseJsonMaybe(body?.constraints);

  // Create code (shown once)
  const code = generateTicketCode();
  const code_hash = hashTicketCode(code);
  const code_prefix = ticketCodePrefix(code);

  const insertRes = await admin
    .from("tickets")
    .insert({
      created_by: gate.admin.userId,
      type: type as TicketType,
      value,
      currency: "JPY",
      code_hash,
      code_prefix,
      is_active: true,
      expires_at,
      max_total_uses,
      max_uses_per_user,
      constraints,
      note,
    })
    .select("id,created_at,created_by,type,code_prefix,value,currency,is_active,expires_at,max_total_uses,max_uses_per_user,constraints,note")
    .single();

  if (insertRes.error || !insertRes.data) {
    return NextResponse.json({ ok: false, error: "ticket_insert_failed", message: insertRes.error?.message || "" }, { status: 500 });
  }

  // Audit
  try {
    await admin.from("audit_logs").insert({
      actor_user_id: gate.admin.userId,
      actor_role: gate.admin.role,
      action: "tickets.create",
      target_table: "tickets",
      target_id: String(insertRes.data.id),
      before: null,
      after: insertRes.data,
      note: "code_prefix=" + code_prefix,
    } as any);
  } catch {
    // ignore
  }

  return NextResponse.json({ ok: true, ticket: insertRes.data, code });
}
