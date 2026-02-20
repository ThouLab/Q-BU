"use client";

import React from "react";
import Link from "next/link";

import { useI18n } from "@/components/i18n/I18nProvider";

export default function CodingDocsPage() {
  const { lang, t } = useI18n();

  const title = lang === "en" ? "Coding (Python)" : lang === "kana" ? "ぷろぐらむ" : "CodingMode（Python）";

  const lead =
    lang === "en"
      ? "Write Python code to generate or transform cubes, then preview and apply the result."
      : lang === "kana"
        ? "ぷろぐらむで ぶろっくを ふやしたり うごかしたり できるよ。"
        : "Pythonでブロックの生成/変形を行い、プレビューしてから適用します。";

  const steps =
    lang === "en"
      ? [
          "Left panel: write code",
          "Middle: current model",
          "Right: result preview",
          "Click Run to preview, Apply to send to the editor",
          "Click a cube in the middle view to insert code like world.model.cube(...)",
        ]
      : lang === "kana"
        ? [
            "ひだり：かく",
            "まんなか：いまの さくひん",
            "みぎ：けっか",
            "うごかす → けっかをみる / つかう → えでぃたへ",
            "まんなかの ぶろっくを くりっく すると こーどが はいるよ",
          ]
        : [
            "左：コード",
            "中央：保存ファイルの今の状態",
            "右：実行後の状態（プレビュー）",
            "実行でプレビュー、適用でエディタへ反映",
            "中央のCubeをクリックすると world.model.cube(...) が自動挿入されます",
          ];

  const shortcuts =
    lang === "en"
      ? [
          ["Ctrl + Z", "Undo"],
          ["Ctrl + Shift + Z", "Redo"],
        ]
      : lang === "kana"
        ? [
            ["Ctrl + Z", "もどす"],
            ["Ctrl + Shift + Z", "すすむ"],
          ]
        : [
            ["Ctrl + Z", "Undo"],
            ["Ctrl + Shift + Z", "Redo"],
          ];

  return (
    <div className="page">
      <header className="topHeader minimal">
        <div className="headerLeft">
          <div className="title">Q-BU Docs</div>
        </div>
        <div className="headerRight">
          <Link className="hbtn" href="/coding">
            {t("mode.coding")}
          </Link>
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
        <p style={{ margin: 0, opacity: 0.9, lineHeight: 1.8 }}>{lead}</p>

        <h2 style={{ fontSize: 16, margin: "16px 0 8px" }}>{lang === "en" ? "How it works" : lang === "kana" ? "やりかた" : "使い方"}</h2>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>

        <h2 style={{ fontSize: 16, margin: "16px 0 8px" }}>Undo / Redo</h2>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
          {shortcuts.map(([k, v]) => (
            <li key={k}>
              <b>{k}</b>：{v}
            </li>
          ))}
        </ul>

        <h2 style={{ fontSize: 16, margin: "16px 0 8px" }}>{lang === "en" ? "Notes" : lang === "kana" ? "ちゅうい" : "注意"}</h2>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
          <li>{lang === "en" ? "Your code runs in the browser (Pyodide)." : lang === "kana" ? "ぶらうざの なかで うごくよ" : "ブラウザ上（Pyodide）で実行します。"}</li>
          <li>{lang === "en" ? "If you see an error, check the Console area under the preview." : lang === "kana" ? "えらーは こんそーる を みてね" : "エラーはプレビュー下のConsoleに表示されます。"}</li>
        </ul>
      </main>
    </div>
  );
}
