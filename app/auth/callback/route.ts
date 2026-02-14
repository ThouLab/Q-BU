import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";

function getCookieValue(cookieHeader: string, key: string): string | null {
  // e.g. "a=1; qb_next=%2Fadmin; b=2"
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`));
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

function sanitizeNextPath(next: string | null | undefined): string {
  const v = (next || "").trim();
  // Only allow same-origin relative paths
  if (!v) return "/";
  if (!v.startsWith("/")) return "/";
  if (v.startsWith("//")) return "/";
  return v;
}

export async function GET(request: Request) {
  const supabase = await getSupabaseServerClient();

  // 未設定でもアプリは動く（ログインなし）
  if (!supabase) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (code) {
    try {
      await supabase.auth.exchangeCodeForSession(code);
    } catch {
      // ignore
    }
  }

  // もとの画面へ（redirectTo はクエリ無し固定のため、戻り先は cookie を優先）
  const cookie = request.headers.get("cookie") || "";
  const nextFromQuery = url.searchParams.get("next");
  const nextFromCookie = getCookieValue(cookie, "qb_next");
  const next = sanitizeNextPath(nextFromQuery ?? nextFromCookie ?? "/");

  const redirectUrl = new URL(next, url.origin);
  const res = NextResponse.redirect(redirectUrl);

  // 使い終わったら消す
  res.headers.append("Set-Cookie", "qb_next=; Path=/; Max-Age=0; SameSite=Lax");

  return res;
}
