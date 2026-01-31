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
  const { supabase, user, signInWithGoogle, signInWithEmail, signOut } = useAuth();
  const { track } = useTelemetry();

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
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

  const sendEmail = async () => {
    setMsg(null);
    const domain = (email.split("@")[1] || "").slice(0, 64);
    track("auth_email_start", { domain });
    const res = await signInWithEmail(email);
    track("auth_email_result", { ok: res.ok });
    setMsg(res.message ?? null);
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

              <div className="accountDivider" />

              <div className="accountRow">
                <input
                  className="accountInput"
                  placeholder="メールアドレス"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                />
                <button type="button" className="accountBtn" onClick={sendEmail}>
                  送信
                </button>
              </div>
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
