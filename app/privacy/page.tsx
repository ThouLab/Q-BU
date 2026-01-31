"use client";

import { useRouter } from "next/navigation";
import { useTelemetry } from "@/components/telemetry/TelemetryProvider";

export default function PrivacyPage() {
  const router = useRouter();
  const { hasConsent, grantConsent } = useTelemetry();

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "28px 16px", lineHeight: 1.7 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 20 }}>プライバシーと利用状況の計測</h1>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            style={{
              border: "1px solid rgba(11,15,24,0.14)",
              background: "rgba(255,255,255,0.92)",
              borderRadius: 12,
              padding: "10px 12px",
              fontWeight: 900,
              cursor: "pointer",
            }}
            onClick={() => router.push("/")}
          >
            戻る
          </button>

          {!hasConsent && (
            <button
              type="button"
              style={{
                border: "1px solid rgba(11,15,24,0.14)",
                background: "rgba(16,185,129,0.16)",
                borderRadius: 12,
                padding: "10px 12px",
                fontWeight: 1000,
                cursor: "pointer",
              }}
              onClick={() => {
                grantConsent();
                router.push("/");
              }}
            >
              同意して開始
            </button>
          )}
        </div>
      </div>

      <p style={{ margin: 0, opacity: 0.78, fontWeight: 700 }}>
        Q-BU! は、体験の改善と効果検証のために利用状況（操作ログ）を計測します。アプリの利用にはこの計測への同意が必要です。
      </p>

      <h2 style={{ marginTop: 20, fontSize: 16 }}>収集する情報</h2>
      <ul style={{ opacity: 0.78, fontWeight: 700 }}>
        <li>操作イベント（編集/プレビュー操作、ズーム、ボタン操作、保存操作など）</li>
        <li>編集状態の統計（例：ブロック数、視点/ズームの状態、参照画像の有無）</li>
        <li>端末・ブラウザ情報（例：ユーザーエージェント、画面/ビューポート、言語、タイムゾーン、通信情報）</li>
        <li>パフォーマンス情報（表示時間などの計測値）</li>
        <li>エラー情報（クラッシュや例外のメッセージ等）</li>
        <li>IPアドレスは保存せず、サーバー側でハッシュ化した識別値として扱う場合があります</li>
      </ul>

      <h2 style={{ marginTop: 20, fontSize: 16 }}>収集しない情報</h2>
      <ul style={{ opacity: 0.78, fontWeight: 700 }}>
        <li>パスワード</li>
        <li>メール本文</li>
        <li>参照画像の画像データ（ファイル内容）</li>
      </ul>

      <h2 style={{ marginTop: 20, fontSize: 16 }}>同意の撤回</h2>
      <p style={{ opacity: 0.78, fontWeight: 700 }}>
        同意を撤回したい場合は、ブラウザのサイトデータ（localStorage / Cookie）を削除してください。その場合、次回アクセス時に再度同意の確認が表示されます。
        （同意がない場合はアプリを利用できません）
      </p>
    </div>
  );
}
