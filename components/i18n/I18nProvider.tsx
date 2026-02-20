"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

import type { Lang } from "@/lib/i18n";
import { LANG_STORAGE_KEY, translate } from "@/lib/i18n";

type I18nContextValue = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function isLang(x: unknown): x is Lang {
  return x === "en" || x === "ja" || x === "kana";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ja");

  // load
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LANG_STORAGE_KEY);
      if (isLang(raw)) setLangState(raw);
    } catch {
      // ignore
    }
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, l);
    } catch {
      // ignore
    }
  };

  // set <html lang>
  useEffect(() => {
    try {
      document.documentElement.lang = lang === "en" ? "en" : "ja";
    } catch {
      // ignore
    }
  }, [lang]);

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang,
      t: (key, vars) => translate(lang, key, vars),
    }),
    [lang]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  // Fallback (should not happen if provider is set)
  return {
    lang: "ja",
    setLang: () => {
      // noop
    },
    t: (key, vars) => translate("ja", key, vars),
  };
}
