"use client";

import React from "react";
import Link from "next/link";

import { useI18n } from "@/components/i18n/I18nProvider";

export default function DocsIndexPage() {
  const { lang, t } = useI18n();

  const lead =
    lang === "en"
      ? "Choose a mode to learn the basics."
      : lang === "kana"
        ? "みたい ものを えらんでね。"
        : "知りたいモードを選んでください。";

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 22, marginBottom: 6 }}>{t("account.docs")}</h1>
      <div style={{ opacity: 0.8, marginBottom: 16 }}>{lead}</div>

      <ul style={{ display: "grid", gap: 10, paddingLeft: 18 }}>
        <li>
          <Link href="/docs/modeling">{t("account.docs.modeling")}</Link>
        </li>
        <li>
          <Link href="/docs/painting">{t("account.docs.painting")}</Link>
        </li>
        <li>
          <Link href="/docs/coding">{t("account.docs.coding")}</Link>
        </li>
        <li>
          <Link href="/docs/gallery">{t("account.docs.gallery")}</Link>
        </li>
      </ul>
    </main>
  );
}
