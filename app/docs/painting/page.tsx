"use client";

import React from "react";
import Link from "next/link";

import { useI18n } from "@/components/i18n/I18nProvider";

export default function PaintingDocsPage() {
  const { lang, t } = useI18n();

  const title = lang === "en" ? "Painting" : lang === "kana" ? "いろぬり" : "Painting（ペイント）";

  const ops =
    lang === "en"
      ? [
          ["Left click / Tap", "Paint the selected block"],
          ["Right click / Long press", "Bucket fill (connected blocks of the same color)"],
        ]
      : lang === "kana"
        ? [
            ["ひだり くりっく / たっぷ", "えらんだ ぶろっくに いろを ぬる"],
            ["みぎ くりっく / ながおし", "ばけつ（つながってる ところを まとめて ぬる）"],
          ]
        : [
            ["左クリック / タップ", "選択したブロックを塗る"],
            ["右クリック / 長押し", "バケツ（同色で連結しているブロックを塗りつぶし）"],
          ];

  const colorText =
    lang === "en"
      ? "Pick a color from the top-left color picker. Painted colors stay even after switching modes."
      : lang === "kana"
        ? "ひだりうえの いろ から えらぶよ。ぬった いろは きえないよ。"
        : "キャンバス左上のカラーピッカーで色を選びます。塗った色は保持され、モードを切り替えても消えません。";

  const undoText =
    lang === "en"
      ? [
          ["Ctrl + Z", "Undo (paint / bucket / add / remove)"],
          ["Ctrl + Shift + Z", "Redo"],
        ]
      : lang === "kana"
        ? [
            ["Ctrl + Z", "もどす（ぬる / ばけつ / ふやす / けす）"],
            ["Ctrl + Shift + Z", "すすむ"],
          ]
        : [
            ["Ctrl + Z", "1つ戻す（塗り / バケツ / 追加 / 削除）"],
            ["Ctrl + Shift + Z", "1つ進める"],
          ];

  const modeText =
    lang === "en"
      ? "Use the mode dropdown on the top-left to switch modes."
      : lang === "kana"
        ? "ひだりうえの もーど で きりかえ できるよ。"
        : "左上のモード切替で、Modeling / Coding へ切り替えできます。";

  return (
    <div className="page">
      <header className="topHeader minimal">
        <div className="headerLeft">
          <div className="title">Q-BU Docs</div>
        </div>
        <div className="headerRight">
          <Link className="hbtn" href="/">
            {t("common.toEditor")}
          </Link>
          <Link className="hbtn" href="/docs">
            {t("account.docs.all")}
          </Link>
        </div>
      </header>

      <main style={{ flex: 1, overflow: "auto", padding: 16, maxWidth: 920, width: "100%", margin: "0 auto" }}>
        <h1 style={{ fontSize: 22, margin: "8px 0 10px" }}>{title}</h1>

        <h2 style={{ fontSize: 16, margin: "16px 0 8px" }}>{lang === "en" ? "Basics" : lang === "kana" ? "きほん" : "基本操作"}</h2>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
          {ops.map(([k, v]) => (
            <li key={k}>
              <b>{k}</b>：{v}
            </li>
          ))}
        </ul>

        <h2 style={{ fontSize: 16, margin: "16px 0 8px" }}>{lang === "en" ? "Color" : lang === "kana" ? "いろ" : "色の選択"}</h2>
        <p style={{ margin: 0, opacity: 0.9, lineHeight: 1.8 }}>{colorText}</p>

        <h2 style={{ fontSize: 16, margin: "16px 0 8px" }}>Undo / Redo</h2>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
          {undoText.map(([k, v]) => (
            <li key={k}>
              <b>{k}</b>：{v}
            </li>
          ))}
        </ul>

        <h2 style={{ fontSize: 16, margin: "16px 0 8px" }}>{lang === "en" ? "Mode" : lang === "kana" ? "もーど" : "モード切り替え"}</h2>
        <p style={{ margin: 0, opacity: 0.9, lineHeight: 1.8 }}>{modeText}</p>
      </main>
    </div>
  );
}
