"use client";

import React from "react";

type Props = {
  open: boolean;
  onAgree: () => void;
  onClose: () => void;
};

export default function ConsentModal({ open, onAgree, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="consentOverlay" role="dialog" aria-modal="true" aria-label="利用状況の計測">
      <div className="consentCard">
        <div className="consentHeader">
          <div className="consentTitle">利用状況の計測（必須）</div>
          {/* 必須同意：閉じる操作はできない（同意がないと利用できないため） */}
          <button
            type="button"
            className="consentClose"
            onClick={onClose}
            aria-label="閉じる"
            title="同意が必要です"
            disabled
          >
            ×
          </button>
        </div>

        <div className="consentBody">
          <p className="consentText">Q-BU! は、改善と検証のために利用状況（操作ログなど）を収集します。</p>
          <ul className="consentList">
            <li>収集：編集/プレビュー操作、ズーム、ボタン操作、保存操作、エラー情報、端末/ブラウザ情報（例：画面サイズ等）</li>
            <li>収集しない：メール本文、パスワード、画像そのもの（ファイル内容）</li>
          </ul>
          <a className="consentLink" href="/privacy">
            収集内容の詳細を見る
          </a>
        </div>

        <div className="consentActions">
          <button type="button" className="consentBtn primary" onClick={onAgree}>
            同意して開始
          </button>
        </div>
      </div>
    </div>
  );
}
