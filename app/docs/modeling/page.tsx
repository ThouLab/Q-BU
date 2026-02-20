"use client";

import React from "react";
import Link from "next/link";

import { useI18n } from "@/components/i18n/I18nProvider";

export default function ModelingDocsPage() {
  const { lang, t } = useI18n();

  const title = lang === "en" ? "Modeling" : lang === "kana" ? "つくる" : "Modeling（造形）";

  const basic =
    lang === "en"
      ? [
          ["Left click / Tap", "Add a block on the pointed face"],
          ["Right click / Long press", "Remove a block"],
          ["Wheel / Pinch", "Zoom"],
          ["Middle button / 2-finger drag", "Pan"],
          ["Drag", "Rotate"],
          ["Space", "Center camera"],
        ]
      : lang === "kana"
        ? [
            ["ひだり くりっく / たっぷ", "ぶろっくを ふやす"],
            ["みぎ くりっく / ながおし", "ぶろっくを けす"],
            ["ほいーる / ぴんち", "ちかづく / はなれる"],
            ["2ほんゆび どらっぐ", "うごかす（へいこう いどう）"],
            ["どらっぐ", "まわす"],
            ["Space", "まんなかへ"],
          ]
        : [
            ["左クリック / タップ", "ブロック追加（カーソル位置の面に追加）"],
            ["右クリック / 長押し", "ブロック削除"],
            ["ホイール / ピンチ", "ズーム"],
            ["中ボタン / 2本指ドラッグ", "平行移動"],
            ["ドラッグ", "回転"],
            ["Space", "中心へ（カメラをモデル中央へ）"],
          ];

  const undo =
    lang === "en"
      ? [
          ["Ctrl + Z", "Undo"],
          ["Ctrl + Shift + Z", "Redo"],
        ]
      : lang === "kana"
        ? [
            ["Ctrl + Z", "ひとつ もどす"],
            ["Ctrl + Shift + Z", "ひとつ すすむ"],
          ]
        : [
            ["Ctrl + Z", "1つ戻す"],
            ["Ctrl + Shift + Z", "1つ進める"],
          ];

  const colorText =
    lang === "en"
      ? "Pick a color from the color picker (top-left). New blocks use the currently selected color (both Modeling and Painting)."
      : lang === "kana"
        ? "ひだりうえの いろ から えらべるよ。あたらしく ふやす ぶろっくは いまの いろ になるよ。"
        : "キャンバス左上のカラーピッカーで現在色を選べます。新しく追加するブロックは現在選択中の色になります（Modeling / Painting 共通）。";

  const modeText =
    lang === "en"
      ? "Use the mode dropdown on the top-left to switch modes."
      : lang === "kana"
        ? "ひだりうえの もーど で きりかえ できるよ。"
        : "左上のモード切替で、Painting / Coding へ切り替えできます。";

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
          {basic.map(([k, v]) => (
            <li key={k}>
              <b>{k}</b>：{v}
            </li>
          ))}
        </ul>

        <h2 style={{ fontSize: 16, margin: "16px 0 8px" }}>Undo / Redo</h2>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
          {undo.map(([k, v]) => (
            <li key={k}>
              <b>{k}</b>：{v}
            </li>
          ))}
        </ul>

        <h2 style={{ fontSize: 16, margin: "16px 0 8px" }}>{lang === "en" ? "Color" : lang === "kana" ? "いろ" : "色"}</h2>
        <p style={{ margin: 0, opacity: 0.9, lineHeight: 1.8 }}>{colorText}</p>

        <h2 style={{ fontSize: 16, margin: "16px 0 8px" }}>{lang === "en" ? "Mode" : lang === "kana" ? "もーど" : "モード切り替え"}</h2>
        <p style={{ margin: 0, opacity: 0.9, lineHeight: 1.8 }}>{modeText}</p>
      </main>
    </div>
  );
}
