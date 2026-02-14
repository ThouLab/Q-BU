import "./admin.css";

import React from "react";
import Link from "next/link";

import { getAdminGate } from "@/lib/admin/adminGate";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const gate = await getAdminGate();

  if (!gate.ok) {
    return (
      <div className="adminRoot">
        <header className="adminHeader">
          <div className="adminBrand">
            <Link href="/">Q-BU Admin</Link>
          </div>
        </header>

        <div className="adminBody" style={{ gridTemplateColumns: "1fr" }}>
          <main className="adminMain">
            <h1 className="adminH1">管理者ダッシュボード</h1>

            {gate.reason === "supabase_not_configured" && (
              <div className="adminWarn">
                Supabase が未設定です。<br />
                <span className="adminMuted">
                  <span className="adminKbd">NEXT_PUBLIC_SUPABASE_URL</span> と <span className="adminKbd">NEXT_PUBLIC_SUPABASE_ANON_KEY</span>
                  を設定してからご利用ください。
                </span>
              </div>
            )}

            {gate.reason === "not_logged_in" && (
              <div className="adminWarn">
                ログインが必要です。<br />
                <span className="adminMuted">アプリに戻ってGoogleログインしてください。</span>
              </div>
            )}

            {gate.reason === "admin_roles_query_failed" && (
              <div className="adminWarn">
                <div>admin_roles の確認に失敗しました。</div>
                <div className="adminMuted" style={{ marginTop: 6 }}>
                  まだSQLを適用していない可能性があります。
                  {gate.userId && (
                    <>
                      <br />あなたの user_id: <span className="adminKbd">{gate.userId}</span>
                    </>
                  )}
                  {gate.details && (
                    <>
                      <br />詳細: <span className="adminKbd">{gate.details}</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {gate.reason === "not_admin" && (
              <div className="adminWarn">
                管理者権限がありません。
                <div className="adminMuted" style={{ marginTop: 6 }}>
                  {gate.userId && (
                    <>
                      あなたの user_id: <span className="adminKbd">{gate.userId}</span>
                    </>
                  )}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
              <Link href="/" style={{ textDecoration: "none", fontWeight: 900 }}>
                ← アプリへ戻る
              </Link>
              <Link href="/privacy" style={{ textDecoration: "none", fontWeight: 900 }}>
                プライバシーポリシー
              </Link>
            </div>

            <div style={{ marginTop: 12 }} className="adminMuted">
              セットアップ方法は、このパッチに含まれる SQL（<span className="adminKbd">supabase/migrations/20260213_v1015_alpha.sql</span>）をご参照ください。
            </div>
          </main>
        </div>
      </div>
    );
  }

  const me = gate.admin;

  return (
    <div className="adminRoot">
      <header className="adminHeader">
        <div className="adminBrand">
          <Link href="/admin">Q-BU Admin</Link>
        </div>
        <div className="adminHeaderRight">
          <span className="adminChip">role: {me.role}</span>
          <span className="adminMuted">{me.email ?? ""}</span>
          <Link href="/" style={{ textDecoration: "none", fontWeight: 900 }}>
            アプリへ
          </Link>
        </div>
      </header>

      <div className="adminBody">
        <nav className="adminNav" aria-label="管理メニュー">
          <Link href="/admin">総合</Link>
          <Link href="/admin/analytics/users">データ分析</Link>
          <Link href="/admin/printing">印刷依頼</Link>
          <Link href="/admin/pricing">価格設定</Link>
          <Link href="/admin/settings">設定</Link>
        </nav>

        <main className="adminMain">{children}</main>
      </div>
    </div>
  );
}
