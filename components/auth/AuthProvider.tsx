"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type AuthState = {
  /** Supabase が未設定の場合は null */
  supabase: SupabaseClient | null;
  user: User | null;
  session: Session | null;
  loading: boolean;

  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function buildCallbackUrl() {
  // Supabase の Redirect URLs に追加するURL（クエリなしで固定）
  // - http://localhost:3000/auth/callback
  // - https://q-bu.com/auth/callback
  const origin = window.location.origin;
  return `${origin}/auth/callback`;
}

function setNextCookie(nextPathname: string) {
  // redirectTo にクエリを付けると Supabase 側の許可判定で弾かれ、Site URL にフォールバックしてしまうことがあります。
  // そのため戻り先は cookie で渡します。
  try {
    const v = encodeURIComponent(nextPathname || "/");
    document.cookie = `qb_next=${v}; Path=/; Max-Age=300; SameSite=Lax`;
  } catch {
    // ignore
  }
}

function isProbablyEmbeddedWebView(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // Android WebView includes `wv` or `Version/4.0`
  const isAndroidWebView = /\bwv\b/.test(ua) || /Version\/4\.0/i.test(ua);
  // iOS WebView: iOS device but not Safari/Chrome/Firefox/Edge
  const isiOS = /iPhone|iPad|iPod/i.test(ua);
  const isSafari = /Safari/i.test(ua);
  const isCriOS = /CriOS/i.test(ua);
  const isFxiOS = /FxiOS/i.test(ua);
  const isEdgiOS = /EdgiOS/i.test(ua);
  const isiOSWebView = isiOS && !isSafari && !isCriOS && !isFxiOS && !isEdgiOS;
  // Some in-app browsers are effectively embedded webviews.
  const isInApp = /FBAN|FBAV|Instagram|Line|Twitter|Snapchat|WhatsApp/i.test(ua);
  return isAndroidWebView || isiOSWebView || isInApp;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);

  // 初回セッション取得 + auth change 監視
  useEffect(() => {
    let unsub: { data?: { subscription?: { unsubscribe: () => void } } } | null = null;

    const init = async () => {
      if (!supabase) {
        setLoading(false);
        return;
      }

      // 念のため：/ に code が付いて戻るケースもあるため、ここでも exchange しておく
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        if (code) {
          await supabase.auth.exchangeCodeForSession(code);
          url.searchParams.delete("code");
          url.searchParams.delete("next");
          window.history.replaceState({}, "", url.pathname + url.search + url.hash);
        }
      } catch {
        // ignore
      }

      const { data } = await supabase.auth.getSession();
      const sess = data.session ?? null;
      setSession(sess);
      setUser(sess?.user ?? null);
      setLoading(false);
    };

    init().catch(() => setLoading(false));

    if (supabase) {
      unsub = supabase.auth.onAuthStateChange((_event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
      });
    }

    return () => {
      try {
        unsub?.data?.subscription?.unsubscribe();
      } catch {
        // ignore
      }
    };
  }, [supabase]);

  const signInWithGoogle = async () => {
    if (!supabase) {
      alert("ログイン機能が未設定です。管理者に連絡してください。");
      return;
    }

    const nextPath = `${window.location.pathname}${window.location.search || ""}` || "/";
    setNextCookie(nextPath);

    const redirectTo = buildCallbackUrl();
    const embedded = isProbablyEmbeddedWebView();

    // Embedded webviews may be blocked by Google's OAuth policy (disallowed_useragent).
    // In those cases, opening in a new tab / external browser tends to work better.
    let popup: Window | null = null;
    if (embedded) {
      try {
        // Open immediately to avoid popup blockers.
        popup = window.open("about:blank", "_blank", "noopener,noreferrer");
      } catch {
        popup = null;
      }
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true },
    });

    if (error) {
      try {
        popup?.close();
      } catch {
        // ignore
      }
      alert("Googleログインに失敗しました。設定を確認してください。");
      return;
    }

    const url = data?.url;
    if (!url) return;

    if (popup) {
      try {
        popup.location.href = url;
        popup.focus?.();
        return;
      } catch {
        // ignore
      }
    }

    // Same-tab fallback
    window.location.assign(url);
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  const value: AuthState = {
    supabase,
    user,
    session,
    loading,
    signInWithGoogle,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider />");
  return ctx;
}
