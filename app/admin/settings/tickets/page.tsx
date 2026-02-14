import React from "react";
import Link from "next/link";

import TicketsClient, { type TicketRow } from "@/components/admin/TicketsClient";
import { getAdminGate } from "@/lib/admin/adminGate";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function AdminSettingsTickets() {
  const gate = await getAdminGate();
  if (!gate.ok) {
    return (
      <div>
        <h1 className="adminH1">優待チケット</h1>
        <div className="adminWarn">アクセスできません（{gate.reason}）</div>
        <div style={{ marginTop: 12 }}>
          <Link href="/admin/settings">← 設定へ戻る</Link>
        </div>
      </div>
    );
  }

  const admin = getSupabaseAdminClient();
  if (!admin) {
    return (
      <div>
        <h1 className="adminH1">優待チケット</h1>
        <div className="adminWarn">Supabase service role が未設定です。</div>
        <div style={{ marginTop: 12 }}>
          <Link href="/admin/settings">← 設定へ戻る</Link>
        </div>
      </div>
    );
  }

  const res = await admin
    .from("v_tickets_with_usage")
    .select("id,created_at,type,code_prefix,value,currency,is_active,expires_at,max_total_uses,max_uses_per_user,constraints,note,used_total")
    .order("created_at", { ascending: false })
    .limit(200);

  const tickets = (res.data as any[] | null) ?? [];
  const ticketsForUI: TicketRow[] = tickets.map((t) => ({
    id: String(t.id),
    created_at: t.created_at ?? undefined,
    type: t.type as any,
    code_prefix: t.code_prefix ?? null,
    value: t.value != null ? Number(t.value) : null,
    currency: t.currency ?? null,
    is_active: Boolean(t.is_active),
    expires_at: t.expires_at ?? null,
    max_total_uses: t.max_total_uses != null ? Number(t.max_total_uses) : null,
    max_uses_per_user: t.max_uses_per_user != null ? Number(t.max_uses_per_user) : null,
    constraints: t.constraints ?? null,
    note: t.note ?? null,
    used_total: t.used_total != null ? Number(t.used_total) : 0,
  }));

  const canEdit = gate.admin.role === "owner" || gate.admin.role === "admin";

  return (
    <div>
      <h1 className="adminH1">優待チケット</h1>
      <div className="adminMuted">C2. 優待チケット / 権限等の設定（v1.0.15-δ）</div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link href="/admin/settings">← 設定</Link>
        <Link href="/admin">総合</Link>
        <Link href="/admin/printing">印刷依頼</Link>
      </div>

      {res.error && (
        <div className="adminWarn" style={{ marginTop: 12 }}>
          <div>チケットの取得に失敗しました。</div>
          <div className="adminMuted" style={{ marginTop: 6 }}>
            SQL（<span className="adminKbd">supabase/migrations/20260213_v1015_delta.sql</span>）を適用してから再度お試しください。<br />
            詳細: <span className="adminKbd">{res.error.message}</span>
          </div>
        </div>
      )}

      <TicketsClient canEdit={canEdit} initialTickets={ticketsForUI} />

      <div className="adminMuted" style={{ marginTop: 12 }}>
        ※チケットコードはDBに保存されません。発行時に表示されるコードをコピーして共有してください。
      </div>
    </div>
  );
}
