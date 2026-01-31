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
  signInWithEmail: (email: string) => Promise<{ ok: boolean; message?: string }>; // マジックリンク
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function buildCallbackUrl(nextPathname: string) {
  // Supabase の Redirect URLs に追加するURL
  // - http://localhost:3000/auth/callback
  // - https://q-bu.com/auth/callback
  const origin = window.location.origin;
  const next = encodeURIComponent(nextPathname || "/");
  return `${origin}/auth/callback?next=${next}`;
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

    const redirectTo = buildCallbackUrl(window.location.pathname || "/");
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) {
      alert("Googleログインに失敗しました。設定を確認してください。");
      return;
    }

    // 通常は自動リダイレクトされますが、念のため
    if (data?.url) window.location.assign(data.url);
  };

  const signInWithEmail = async (email: string) => {
    if (!supabase) {
      return { ok: false, message: "ログイン機能が未設定です。" };
    }
    const cleaned = email.trim();
    if (!cleaned) return { ok: false, message: "メールアドレスを入力してください。" };

    const emailRedirectTo = buildCallbackUrl(window.location.pathname || "/");
    const { error } = await supabase.auth.signInWithOtp({
      email: cleaned,
      options: { emailRedirectTo },
    });

    if (error) return { ok: false, message: error.message };
    return { ok: true, message: "メールを確認してください。" };
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
    signInWithEmail,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider />");
  return ctx;
}
