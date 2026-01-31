import { NextResponse } from "next/server";
import crypto from "crypto";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type IncomingEvent = {
  name: unknown;
  ts: unknown;
  path?: unknown;
  anon_id?: unknown;
  session_id?: unknown;
  user_id?: unknown;
  payload?: unknown;
};

function firstIpFromHeaders(h: Headers): string | null {
  const xff = h.get("x-forwarded-for") ?? "";
  if (xff) {
    // 例: "1.2.3.4, 5.6.7.8"
    const ip = xff.split(",")[0]?.trim();
    if (ip) return ip;
  }
  const xri = h.get("x-real-ip")?.trim();
  if (xri) return xri;
  return null;
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function safeJsonSize(obj: any, maxBytes: number) {
  try {
    const s = JSON.stringify(obj);
    if (s.length <= maxBytes) return obj;
    // サイズ超過：最低限だけ残す
    return { _truncated: true, _bytes: s.length };
  } catch {
    return { _invalid: true };
  }
}

export async function POST(request: Request) {
  // consent は必須（クライアントが必ず付ける）
  const consentHeader = request.headers.get("x-qbu-consent");
  const consentCookie = request.headers.get("cookie")?.includes("qbu_consent=1");
  if (consentHeader !== "1" && !consentCookie) {
    return new NextResponse(null, { status: 204 });
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

  const events = Array.isArray(body?.events) ? (body.events as IncomingEvent[]) : [];
  if (events.length === 0) return new NextResponse(null, { status: 204 });

  const ua = request.headers.get("user-agent") ?? "";
  const acceptLang = request.headers.get("accept-language") ?? "";

  // IP はそのまま保存せず、salt 付きのハッシュにする（最大化しつつリスク低減）
  const ip = firstIpFromHeaders(request.headers);
  const salt = process.env.QBU_TELEMETRY_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const ip_hash = ip && salt ? sha256Hex(`${ip}|${salt}`) : null;

  const rows = events
    .map((ev) => {
      const name = typeof ev.name === "string" ? ev.name.slice(0, 80) : null;
      const ts = typeof ev.ts === "number" ? ev.ts : null;
      const path = typeof ev.path === "string" ? ev.path.slice(0, 200) : "/";
      const anon_id = typeof ev.anon_id === "string" ? ev.anon_id : null;
      const session_id = typeof ev.session_id === "string" ? ev.session_id : null;

      const user_id = typeof ev.user_id === "string" ? ev.user_id : null;

      if (!name || !ts || !anon_id) return null;

      // payload は JSONB へ（大きすぎる場合は切る）
      let payload: any = ev.payload;
      if (payload && typeof payload === "object") {
        payload = { ...payload, client_ts: ts };
      } else {
        payload = { client_ts: ts };
      }
      payload = safeJsonSize(payload, 32_000);

      return {
        anon_id,
        user_id,
        session_id,
        event_name: name,
        payload,
        path,
        user_agent: ua,
        accept_language: acceptLang,
        ip_hash,
      };
    })
    .filter(Boolean) as any[];

  if (rows.length === 0) return new NextResponse(null, { status: 204 });

  try {
    await admin.from("event_logs").insert(rows);
  } catch {
    // ログ失敗で UI を壊さない
  }

  return new NextResponse(null, { status: 204 });
}
