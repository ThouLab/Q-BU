import React from "react";

export const dynamic = "force-dynamic";

export default async function AdminAnalyticsBehavior() {
  return (
    <div>
      <h1 className="adminH1">データ分析（行動）</h1>
      <div className="adminMuted">A2. 利用者行動の見える化（v1.0.15-α: 骨組み）</div>

      <div className="adminWarn" style={{ marginTop: 12 }}>
        次フェーズで、主要イベントのファネル、編集導線、STL書き出しまでのステップ数などを追加します。
      </div>
    </div>
  );
}
