import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
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

  const anon_id = typeof body?.anon_id === "string" ? body.anon_id : null;
  const consent = body?.consent;
  const version = typeof body?.version === "string" ? body.version.slice(0, 24) : "v?";

  if (!anon_id || typeof consent !== "boolean") {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  if (consent !== true) {
    // 必須同意なので false は基本的に来ない想定（来ても記録しない）
    return new NextResponse(null, { status: 204 });
  }

  try {
    await admin.from("telemetry_consents").upsert(
      {
        anon_id,
        consented_at: new Date().toISOString(),
        consent_version: version,
      },
      { onConflict: "anon_id" }
    );
  } catch {
    // 失敗してもUXは継続
  }

  return new NextResponse(null, { status: 204 });
}
