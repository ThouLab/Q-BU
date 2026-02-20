"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth/AuthProvider";
import { useTelemetry } from "@/components/telemetry/TelemetryProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LANG_OPTIONS, type Lang } from "@/lib/i18n";
import {
  clearUnlock,
  defaultParentGateSettings,
  ensureParentGate,
  ensureParentUnlocked,
  isUnlockedNow,
  loadParentGateSettings,
  saveParentGateSettings,
  setParentPassword,
  setUnlockedForMinutes,
  type ParentGateAction,
  type ParentGateSettings,
} from "@/lib/parentGate";

function initialsFromEmail(email: string) {
  const name = email.split("@")[0] || "";
  const c = (name[0] || "U").toUpperCase();
  return c;
}

/**
 * 左下のアカウントボタン
 * - ログイン／ログアウトだけに絞って安定化
 * - ほかの機能（同意など）はここでは扱わない
 */
export default function AccountFab() {
  const router = useRouter();
  const { supabase, user, signInWithGoogle, signOut } = useAuth();
  const { track } = useTelemetry();
  const { lang, setLang, t } = useI18n();

  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Parent gate settings (local)
  const [pg, setPg] = useState<ParentGateSettings>(() => defaultParentGateSettings());
  const [pgUnlocked, setPgUnlocked] = useState(false);
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwInfo, setPwInfo] = useState<string | null>(null);

  const configured = Boolean(supabase);

  useEffect(() => {
    if (!open) return;
    const s = loadParentGateSettings();
    setPg(s);
    setPgUnlocked(isUnlockedNow());
    setPwNew("");
    setPwConfirm("");
    setPwInfo(null);
  }, [open]);

  const requireKeys: ParentGateAction[] = [
    "print",
    "publish",
    "delete",
    "download",
    "subscribe",
    "change_language",
  ];

  const canEditParent = !pg.passwordHash || pgUnlocked;

  const updatePg = (next: ParentGateSettings) => {
    setPg(next);
    saveParentGateSettings(next);
  };

  const ensureEditUnlocked = async (): Promise<boolean> => {
    if (!pg.passwordHash) return true;
    if (pgUnlocked) return true;
    const ok = await ensureParentUnlocked({ lang, t });
    setPgUnlocked(isUnlockedNow());
    return ok;
  };

  // 外部（保存/エクスポートなど）から「ログインしてね」を開ける
  useEffect(() => {
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<any>;
      const message = ce?.detail?.message;
      if (typeof message === "string") setMsg(message);
      track("auth_required_popup", { reason: message ? "message" : "unknown" });
      setOpen(true);
    };
    window.addEventListener("qbu:open-login", handler as any);
    return () => window.removeEventListener("qbu:open-login", handler as any);
  }, []);

  const display = useMemo(() => {
    if (!user) return { label: "?", sub: t("account.signIn") };
    const e = user.email ?? "";
    return { label: initialsFromEmail(e), sub: e };
  }, [user, t]);

  // keep ref for focus / future
  const panelRef = useRef<HTMLDivElement | null>(null);

  const isEmbedded = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    // Android WebView: `wv` or `Version/4.0`
    const isAndroidWebView = /\bwv\b/i.test(ua) || /Version\/4\.0/i.test(ua);
    // iOS WebView: iOS device but not Safari/Chrome/Firefox/Edge
    const isiOS = /iPhone|iPad|iPod/i.test(ua);
    const isSafari = /Safari/i.test(ua);
    const isCriOS = /CriOS/i.test(ua);
    const isFxiOS = /FxiOS/i.test(ua);
    const isEdgiOS = /EdgiOS/i.test(ua);
    const isiOSWebView = isiOS && !isSafari && !isCriOS && !isFxiOS && !isEdgiOS;
    // Common in-app browsers
    const isInApp = /FBAN|FBAV|Instagram|Line|Twitter|Snapchat|WhatsApp/i.test(ua);
    return isAndroidWebView || isiOSWebView || isInApp;
  }, []);

  const openInBrowser = async () => {
    try {
      const url = window.location.href;
      const w = window.open(url, "_blank", "noopener,noreferrer");
      if (w) return;
      // Popup blocked: try copy as a fallback
      await navigator.clipboard?.writeText?.(url);
      setMsg(t("account.linkCopied"));
    } catch {
      setMsg(t("account.openInBrowserFailed"));
    }
  };

  return (
    <div className="accountFabWrap" ref={panelRef}>
      <button
        type="button"
        className="accountFabBtn"
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (next) track("account_open");
            else track("account_close");
            return next;
          });
        }}
        aria-label={t("account.account")}
        title={t("account.account")}
      >
        <span className="accountFabLabel">{display.label}</span>
      </button>

      {open && (
        <div
          className="accountDrawerOverlay"
          role="presentation"
          onMouseDown={() => {
            setOpen(false);
            track("account_close");
          }}
        >
          <div
            className="accountDrawer"
            role="dialog"
            aria-label={t("account.account")}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="accountDrawerHeader">
              <div className="accountDrawerTitle">{t("account.account")}</div>
              <button
                type="button"
                className="accountDrawerClose"
                onClick={() => {
                  setOpen(false);
                  track("account_close");
                }}
              >
                {t("account.close")}
              </button>
            </div>

            <div className="accountDrawerBody">
              {/* Account */}
              <section className="accountSection">
                {!configured && <div className="accountMuted">{t("account.notConfigured")}</div>}

                {!user && configured && (
                  <>
                    <div className="accountSectionTitle">{t("account.signIn")}</div>
                    <div className="accountRow">
                      <button
                        type="button"
                        className="accountBtn"
                        onClick={() => {
                          track("auth_google_start");
                          signInWithGoogle();
                        }}
                      >
                        {t("account.signInWithGoogle")}
                      </button>
                    </div>

                    {isEmbedded && (
                      <>
                        <div className="accountDivider" />
                        <div className="accountMuted">
                          {lang === "en" ? (
                            <>Google sign-in may be blocked in in-app browsers. Please open in Chrome/Safari.</>
                          ) : lang === "kana" ? (
                            <>あぷりの なかの ぶらうざ だと ろぐいん できないことがあるよ。Chrome/Safariで ひらいてね。</>
                          ) : (
                            <>アプリ内ブラウザ（WebView）では、Googleログインがブロックされる場合があります。Chrome/Safariで開き直してください。</>
                          )}
                        </div>
                        <div className="accountRow">
                          <button
                            type="button"
                            className="accountBtn"
                            onClick={() => {
                              track("auth_open_external_browser");
                              openInBrowser();
                            }}
                          >
                            {t("account.openInBrowser")}
                          </button>
                        </div>
                      </>
                    )}

                    {msg ? <div className="accountMuted">{msg}</div> : null}
                  </>
                )}

                {user && (
                  <>
                    <div className="accountSectionTitle">{display.sub}</div>
                    <div className="accountRow">
                      <button
                        type="button"
                        className="accountBtn"
                        onClick={async () => {
                          track("auth_logout_click");
                          await signOut();
                        }}
                      >
                        {t("account.signOut")}
                      </button>
                    </div>
                  </>
                )}
              </section>

              {/* Docs */}
              <section className="accountSection">
                <div className="accountSectionTitle">{t("account.docs")}</div>
                <div className="accountLinkGrid">
                  <button
                    type="button"
                    className="accountLink"
                    onClick={() => {
                      setOpen(false);
                      router.push("/docs");
                    }}
                  >
                    {t("account.docs.all")}
                  </button>
                  <button
                    type="button"
                    className="accountLink"
                    onClick={() => {
                      setOpen(false);
                      router.push("/docs/modeling");
                    }}
                  >
                    {t("account.docs.modeling")}
                  </button>
                  <button
                    type="button"
                    className="accountLink"
                    onClick={() => {
                      setOpen(false);
                      router.push("/docs/painting");
                    }}
                  >
                    {t("account.docs.painting")}
                  </button>
                  <button
                    type="button"
                    className="accountLink"
                    onClick={() => {
                      setOpen(false);
                      router.push("/docs/coding");
                    }}
                  >
                    {t("account.docs.coding")}
                  </button>
                  <button
                    type="button"
                    className="accountLink"
                    onClick={() => {
                      setOpen(false);
                      router.push("/docs/gallery");
                    }}
                  >
                    {t("account.docs.gallery")}
                  </button>
                </div>
              </section>

              {/* Settings */}
              <section className="accountSection">
                <div className="accountSectionTitle">{t("account.settings")}</div>
                <div className="accountRow between">
                  <div className="accountLabel">{t("account.language")}</div>
                  <select
                    className="accountSelect"
                    value={lang}
                    onChange={async (e) => {
                      const next = e.target.value as Lang;
                      // Kids -> others may be gated
                      if (lang === "kana" && next !== "kana") {
                        const ok = await ensureParentGate({ lang, t, action: "change_language" });
                        if (!ok) return;
                      }
                      setLang(next);
                    }}
                    aria-label="language"
                  >
                    {LANG_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                {lang !== "kana" ? (
                  <>
                    <div className="accountDivider" />

                    <div className="accountSectionTitle">{t("parent.section")}</div>

                    <div className="accountRow between" style={{ alignItems: "flex-start" }}>
                      <div className="accountLabel">{t("parent.password")}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 220 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
                          {pg.passwordHash ? (
                            <span className="accountMuted" style={{ fontWeight: 900 }}>
                              {pgUnlocked ? t("parent.state.ok") : t("parent.state.lock")}
                            </span>
                          ) : (
                            <span className="accountMuted">{t("parent.state.notSet")}</span>
                          )}
                          {pg.passwordHash && !pgUnlocked && (
                            <button
                              type="button"
                              className="accountBtn"
                              onClick={async () => {
                                const ok = await ensureParentUnlocked({ lang, t });
                                setPgUnlocked(isUnlockedNow());
                                if (ok) track("parent_gate_unlock");
                              }}
                            >
                              {t("parent.unlock")}
                            </button>
                          )}
                          {pg.passwordHash && pgUnlocked && (
                            <button
                              type="button"
                              className="accountBtn"
                              onClick={() => {
                                clearUnlock();
                                setPgUnlocked(false);
                                track("parent_gate_lock");
                              }}
                            >
                              {t("parent.lock")}
                            </button>
                          )}
                        </div>

                        <div style={{ display: "grid", gap: 6 }}>
                          <input
                            className="accountSelect"
                            style={{ width: "100%" }}
                            type="password"
                            value={pwNew}
                            onChange={(e) => setPwNew(e.target.value)}
                            placeholder={t("parent.password.new")}
                          />
                          <input
                            className="accountSelect"
                            style={{ width: "100%" }}
                            type="password"
                            value={pwConfirm}
                            onChange={(e) => setPwConfirm(e.target.value)}
                            placeholder={t("parent.password.confirm")}
                          />
                          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            {pg.passwordHash ? (
                              <button
                                type="button"
                                className="accountBtn"
                                onClick={async () => {
                                  const ok = await ensureEditUnlocked();
                                  if (!ok) return;
                                  updatePg({ ...pg, passwordHash: "" });
                                  clearUnlock();
                                  setPgUnlocked(false);
                                  setPwNew("");
                                  setPwConfirm("");
                                  setPwInfo(null);
                                  track("parent_gate_password_clear");
                                }}
                              >
                                {t("parent.password.clear")}
                              </button>
                            ) : null}

                            <button
                              type="button"
                              className="accountBtn"
                              onClick={async () => {
                                const ok = await ensureEditUnlocked();
                                if (!ok) return;
                                if (!pwNew || pwNew !== pwConfirm) {
                                  setPwInfo(t("parent.password.mismatch"));
                                  return;
                                }
                                const hash = await setParentPassword(pwNew);
                                const next: ParentGateSettings = { ...pg, passwordHash: hash };
                                updatePg(next);
                                setUnlockedForMinutes(next.rememberMinutes);
                                setPgUnlocked(true);
                                setPwNew("");
                                setPwConfirm("");
                                setPwInfo(t("parent.password.saved"));
                                track("parent_gate_password_set", { has_old: Boolean(pg.passwordHash) });
                              }}
                            >
                              {pg.passwordHash ? t("parent.password.change") : t("parent.password.set")}
                            </button>
                          </div>

                          {pwInfo ? <div className="accountMuted">{pwInfo}</div> : null}
                        </div>
                      </div>
                    </div>

                    <div className="accountRow between">
                      <div className="accountLabel">{t("parent.remember")}</div>
                      <select
                        className="accountSelect"
                        value={pg.rememberMinutes}
                        onChange={async (e) => {
                          const raw = e.target.value;
                          const ok = await ensureEditUnlocked();
                          if (!ok) return;
                          const minutes = Number(raw);
                          const next = {
                            ...pg,
                            rememberMinutes: Number.isFinite(minutes) ? minutes : pg.rememberMinutes,
                          };
                          updatePg(next);
                          if (pgUnlocked) setUnlockedForMinutes(next.rememberMinutes);
                          track("parent_gate_remember", { minutes: next.rememberMinutes });
                        }}
                      >
                        {[0, 5, 10, 20, 30].map((m) => (
                          <option key={m} value={m}>
                            {m === 0 ? t("parent.remember.onlyNow") : t("parent.remember.minutes", { n: m })}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="accountMuted" style={{ marginTop: 4 }}>
                      {t("parent.require")}
                    </div>

                    <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                      {requireKeys.map((k) => {
                        const checked = Boolean(pg.require[k]);
                        return (
                          <label key={k} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={async (e) => {
                                const nextChecked = e.target.checked;
                                const ok = await ensureEditUnlocked();
                                if (!ok) return;
                                const next = {
                                  ...pg,
                                  require: { ...pg.require, [k]: nextChecked },
                                };
                                updatePg(next);
                                track("parent_gate_toggle", { key: k, on: nextChecked });
                              }}
                            />
                            <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(11,15,24,.82)" }}>
                              {t(`parent.action.${k}`)}
                            </span>
                          </label>
                        );
                      })}

                      {!canEditParent ? <div className="accountMuted">{t("parent.unlockToEdit")}</div> : null}
                    </div>
                  </>
                ) : null}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
