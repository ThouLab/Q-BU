import React from "react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminSettings() {
  return (
    <div>
      <h1 className="adminH1">設定</h1>
      <div className="adminMuted">C. アプリケーション諸設定（v1.0.15-δ）</div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link href="/admin">← 総合ダッシュボード</Link>
        <Link href="/admin/printing">印刷依頼</Link>
        <Link href="/admin/pricing">価格設定</Link>
        <Link href="/admin/shipping">送料設定</Link>
      </div>

      <div className="adminCards" style={{ marginTop: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        <div className="adminCard">
          <div className="adminCardLabel">C1. 管理者権限等の設定</div>
          <div className="adminCardValue" style={{ fontSize: 16 }}>管理者一覧 / 追加 / 無効化</div>
          <div className="adminMuted" style={{ marginTop: 8 }}>
            ※変更は <span className="adminKbd">owner</span> のみ可能です。
          </div>
          <div style={{ marginTop: 10 }}>
            <Link href="/admin/settings/admins" style={{ fontWeight: 900 }}>管理者設定へ →</Link>
          </div>
        </div>

        <div className="adminCard">
          <div className="adminCardLabel">C2. 優待チケット / 権限等の設定</div>
          <div className="adminCardValue" style={{ fontSize: 16 }}>チケット発行 / 有効化 / 利用状況</div>
          <div className="adminMuted" style={{ marginTop: 8 }}>
            印刷依頼時にチケットコードを入力すると、割引（または無料）が適用されます。
          </div>
          <div style={{ marginTop: 10 }}>
            <Link href="/admin/settings/tickets" style={{ fontWeight: 900 }}>チケット設定へ →</Link>
          </div>
        </div>

        <div className="adminCard">
          <div className="adminCardLabel">C3. 送料設定（v1.0.16）</div>
          <div className="adminCardValue" style={{ fontSize: 16 }}>ゾーン × サイズTier</div>
          <div className="adminMuted" style={{ marginTop: 8 }}>
            郵便番号検索で確定した配送先（都道府県）とサイズTierから配送料を計算します。
          </div>
          <div style={{ marginTop: 10 }}>
            <Link href="/admin/shipping" style={{ fontWeight: 900 }}>送料設定へ →</Link>
          </div>
        </div>
      </div>

      <div className="adminMuted" style={{ marginTop: 12 }}>
        ※ここでの操作は <span className="adminKbd">audit_logs</span> に記録されます（v1.0.15-β）。
      </div>
    </div>
  );
}
