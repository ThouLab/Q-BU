import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await getSupabaseServerClient();

  // 未設定でもアプリは動く（ログインなし）
  if (!supabase) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (code) {
    try {
      await supabase.auth.exchangeCodeForSession(code);
    } catch {
      // ignore
    }
  }

  // もとの画面へ
  const redirectUrl = new URL(next, url.origin);
  return NextResponse.redirect(redirectUrl);
}
