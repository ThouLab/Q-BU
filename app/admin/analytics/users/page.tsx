import React from "react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminAnalyticsUsers() {
  return (
    <div>
      <h1 className="adminH1">データ分析（利用者）</h1>
      <div className="adminMuted">
        A1. 利用者数の遷移 / A2. 利用者行動の見える化 に向けたベースページです（v1.0.15-α）。
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link href="/admin">← 総合ダッシュボード</Link>
        <Link href="/admin/analytics/behavior">行動分析へ →</Link>
      </div>

      <div className="adminWarn" style={{ marginTop: 12 }}>
        ここは次フェーズで拡張します。
        <div className="adminMuted" style={{ marginTop: 6 }}>
          ・A1: DAU/WAU/MAU、初回訪問（first_seen）
          <br />
          ・A1: アクティブ維持率（コホート）
          <br />
          ・A2: STL書き出しまでの導線（builder_open → stl_export）
        </div>
      </div>

      <div className="adminMuted" style={{ marginTop: 12 }}>
        まずは <span className="adminKbd">/admin</span> で日次DAUとSTL・印刷到達CVが見える状態を確認してください。
      </div>
    </div>
  );
}
