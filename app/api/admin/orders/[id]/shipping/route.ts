import { NextResponse } from "next/server";

import { getAdminGate } from "@/lib/admin/adminGate";
import { decryptShipping } from "@/lib/secure/shippingCrypto";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const gate = await getAdminGate();
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.reason }, { status: 401 });
  }

  // PII access is restricted (owner/admin/ops only)
  if (gate.admin.role !== "owner" && gate.admin.role !== "admin" && gate.admin.role !== "ops") {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const admin = getSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "supabase_admin_not_configured" }, { status: 501 });
  }

  const { data, error } = await admin.from("print_order_shipping_secure").select("shipping_enc").eq("order_id", id).maybeSingle();

  if (error || !data?.shipping_enc) {
    return NextResponse.json({ ok: false, error: "not_found", message: error?.message || "" }, { status: 404 });
  }

  try {
    const shipping = decryptShipping(String(data.shipping_enc));
    return NextResponse.json({ ok: true, shipping });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "decrypt_failed", message: e?.message || "" }, { status: 500 });
  }
}
