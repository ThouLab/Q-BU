"use client";

import React from "react";
import Link from "next/link";

import { useI18n } from "@/components/i18n/I18nProvider";

export default function GalleryDocsPage() {
  const { lang, t } = useI18n();

  const title = lang === "en" ? "Gallery" : lang === "kana" ? "さくひん" : "Gallery";
  const lead =
    lang === "en"
      ? "Browse your saved projects (MyProjects) and public projects (PublicProjects)."
      : lang === "kana"
        ? "じぶんの さくひん と みんなの さくひん を みられるよ。"
        : "保存したプロジェクト（MyProjects）と公開プロジェクト（PublicProjects）を一覧できます。";

  const ops =
    lang === "en"
      ? [
          "Open: open a project in the editor",
          "Open as copy: open without overwriting the original",
          "Rename / Thumbnail / Download",
          "Publish: show your project in PublicProjects",
        ]
      : lang === "kana"
        ? ["ひらく：えでぃたで つづきを する", "こぴーで ひらく：もとの さくひんを まもる", "なまえ / ひょうし / だうんろーど", "みんなに みせる：みんなの さくひんに でる"]
        : ["Open：エディタで開く", "コピーとして開く：元データを上書きしない", "Rename / Thumbnail / Download", "Publish：PublicProjects に公開"];

  return (
    <div className="page">
      <header className="topHeader minimal">
        <div className="headerLeft">
          <div className="title">Q-BU Docs</div>
        </div>
        <div className="headerRight">
          <Link className="hbtn" href="/gallery">
            {t("mode.gallery")}
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

        <h2 style={{ fontSize: 16, margin: "16px 0 8px" }}>{lang === "en" ? "What you can do" : lang === "kana" ? "できること" : "できること"}</h2>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
          {ops.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </main>
    </div>
  );
}
