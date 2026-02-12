"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { useTelemetry } from "@/components/telemetry/TelemetryProvider";

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
  const { supabase, user, signInWithGoogle, signOut } = useAuth();
  const { track } = useTelemetry();

  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const configured = Boolean(supabase);

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
    if (!user) return { label: "?", sub: "ログイン" };
    const e = user.email ?? "";
    return { label: initialsFromEmail(e), sub: e };
  }, [user]);

  // クリック外で閉じる
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      const el = panelRef.current;
      if (!el) return;
      if (el.contains(ev.target as any)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

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
      setMsg("リンクをコピーしました。Chrome/Safariで貼り付けて開いてください。");
    } catch {
      setMsg("Chrome/Safariなどのブラウザで開き直してからログインしてください。");
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
        aria-label="アカウント"
        title="アカウント"
      >
        <span className="accountFabLabel">{display.label}</span>
      </button>

      {open && (
        <div className="accountPanel" role="dialog" aria-label="アカウント">
          {!configured && (
            <div className="accountMuted">
              ログイン機能が未設定です。
              <br />
              管理者に連絡してください。
            </div>
          )}

          {!user && configured && (
            <>
              <div className="accountTitle">ログイン</div>
              <div className="accountRow">
                <button
                  type="button"
                  className="accountBtn"
                  onClick={() => {
                    track("auth_google_start");
                    signInWithGoogle();
                  }}
                >
                  Google
                </button>
              </div>

              {isEmbedded && (
                <>
                  <div className="accountDivider" />
                  <div className="accountMuted">
                    アプリ内ブラウザ（WebView）では、Googleログインがブロックされる場合があります。
                    <br />
                    Chrome/Safariで開き直してからログインしてください。
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
                      ブラウザで開く
                    </button>
                  </div>
                </>
              )}

              {msg && <div className="accountMuted">{msg}</div>}
              {!msg && <div className="accountMuted">保存・エクスポートにはログインが必要です。</div>}
            </>
          )}

          {user && (
            <>
              <div className="accountTitle">{display.sub}</div>
              <div className="accountRow">
                <button
                  type="button"
                  className="accountBtn"
                  onClick={async () => {
                    track("auth_logout_click");
                    await signOut();
                  }}
                >
                  ログアウト
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
