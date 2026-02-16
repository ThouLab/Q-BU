import React from "react";
import Link from "next/link";

import AdminRolesClient, { type AdminRoleRow } from "@/components/admin/AdminRolesClient";
import { getAdminGate } from "@/lib/admin/adminGate";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function AdminSettingsAdmins() {
  const gate = await getAdminGate();
  if (!gate.ok) {
    return (
      <div>
        <h1 className="adminH1">管理者権限</h1>
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
        <h1 className="adminH1">管理者権限</h1>
        <div className="adminWarn">Supabase service role が未設定です。</div>
        <div style={{ marginTop: 12 }}>
          <Link href="/admin/settings">← 設定へ戻る</Link>
        </div>
      </div>
    );
  }

  const listRes = await admin
    .from("admin_roles")
    .select("user_id,role,is_active,notify_print_request,created_at,updated_at")
    .order("updated_at", { ascending: false });

  const roles = (listRes.data as any[] | null) ?? [];
  const rolesForUI: AdminRoleRow[] = roles.map((r) => ({
    user_id: String(r.user_id),
    role: (r.role as any) || "admin",
    is_active: Boolean(r.is_active),
    notify_print_request: Boolean(r.notify_print_request),
    created_at: r.created_at ?? undefined,
    updated_at: r.updated_at ?? undefined,
  }));

  const canEdit = gate.admin.role === "owner";

  return (
    <div>
      <h1 className="adminH1">管理者権限</h1>
      <div className="adminMuted">C1. 管理者権限等の設定（v1.0.15-δ）</div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link href="/admin/settings">← 設定</Link>
        <Link href="/admin">総合</Link>
      </div>

      {listRes.error && (
        <div className="adminWarn" style={{ marginTop: 12 }}>
          <div>admin_roles の取得に失敗しました。</div>
          <div className="adminMuted" style={{ marginTop: 6 }}>
            詳細: <span className="adminKbd">{listRes.error.message}</span>
          </div>
        </div>
      )}

      <AdminRolesClient canEdit={canEdit} actorUserId={gate.admin.userId} initialRoles={rolesForUI} />

      <div className="adminMuted" style={{ marginTop: 12 }}>
        ※権限変更は <span className="adminKbd">audit_logs</span> に記録されます。
      </div>
    </div>
  );
}
