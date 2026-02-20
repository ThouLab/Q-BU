"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";

function hasConsent(): boolean {
  try {
    return localStorage.getItem("qbu_consent_v1") === "yes";
  } catch {
    return false;
  }
}

async function grantConsent() {
  try {
    localStorage.setItem("qbu_consent_v1", "yes");
  } catch {
    // ignore
  }
  // best-effort server-side log
  try {
    await fetch("/api/consent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consent: true }) });
  } catch {
    // ignore
  }
}

export default function PrivacyPage() {
  const { t } = useI18n();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    setOk(hasConsent());
  }, []);

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 18px" }}>
      <h1 style={{ marginTop: 0 }}>{t("privacy.title")}</h1>

      <p>{t("privacy.intro")}</p>

      <h3 style={{ marginTop: 22 }}>{t("privacy.collect.title")}</h3>
      <ul>
        <li>{t("privacy.collect.item1")}</li>
        <li>{t("privacy.collect.item2")}</li>
        <li>{t("privacy.collect.item3")}</li>
        <li>{t("privacy.collect.item4")}</li>
        <li>{t("privacy.collect.item5")}</li>
        <li>{t("privacy.collect.item6")}</li>
      </ul>

      <h3 style={{ marginTop: 22 }}>{t("privacy.notCollect.title")}</h3>
      <ul>
        <li>{t("privacy.notCollect.item1")}</li>
        <li>{t("privacy.notCollect.item2")}</li>
        <li>{t("privacy.notCollect.item3")}</li>
      </ul>

      <h3 style={{ marginTop: 22 }}>{t("privacy.revoke.title")}</h3>
      <p>{t("privacy.revoke.text")}</p>

      <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
        <button
          type="button"
          onClick={() => (window.location.href = "/")}
          style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.18)", background: "#fff" }}
        >
          {t("privacy.back")}
        </button>

        {!ok ? (
          <button
            type="button"
            onClick={async () => {
              await grantConsent();
              setOk(true);
              window.location.href = "/";
            }}
            style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.18)", background: "#ecfccb", fontWeight: 800 }}
          >
            {t("privacy.agreeStart")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
