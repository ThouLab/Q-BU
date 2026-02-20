"use client";

import React from "react";
import { useI18n } from "@/components/i18n/I18nProvider";

type Props = {
  open: boolean;
  onAgree: () => void;
  onClose: () => void;
};

export default function ConsentModal({ open, onAgree, onClose }: Props) {
  const { t } = useI18n();

  if (!open) return null;

  return (
    <div className="consentOverlay" role="dialog" aria-modal="true" aria-label={t("consent.aria")}>
      <div className="consentCard">
        <div className="consentHeader">
          <div className="consentTitle">{t("consent.title")}</div>
          <button type="button" className="consentClose" onClick={onClose} aria-label={t("common.close")} title={t("consent.required")} disabled>
            ✕
          </button>
        </div>

        <div className="consentBody">
          <p style={{ marginTop: 0 }}>{t("consent.text")}</p>
          <ul style={{ marginTop: 8 }}>
            <li>{t("consent.collect")}</li>
            <li>{t("consent.notCollect")}</li>
          </ul>

          <a className="consentLink" href="/privacy" target="_blank" rel="noreferrer">
            {t("consent.detail")}
          </a>
        </div>

        <div className="consentFooter">
          <button type="button" className="consentAgree" onClick={onAgree}>
            {t("consent.agree")}
          </button>
        </div>
      </div>
    </div>
  );
}
