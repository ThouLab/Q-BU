import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * サーバー用 Supabase クライアント（Route Handler / Server Actions 向け）
 *
 * Next.js 15 では `cookies()` が async なので、必ず await してから使用します。
 * 環境変数が未設定なら null。
 */
export async function getSupabaseServerClient(): Promise<SupabaseClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

  const cookieStore = await cookies();

  // @supabase/ssr は versions により cookies API の shape が異なるため、
  // getAll/setAll と get/set/remove の両方を提供して安定させます。
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        try {
          return cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
        } catch {
          return [];
        }
      },
      setAll(cookiesToSet: any[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            // Next の cookies().set は (name,value,options) でも object でも受け取れる
            cookieStore.set({ name, value, ...options });
          });
        } catch {
          // ignore
        }
      },

      // legacy shape
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: any) {
        cookieStore.set({ name, value, ...options });
      },
      remove(name: string, options: any) {
        cookieStore.set({ name, value: "", ...options, maxAge: 0 });
      },
    },
  });
}
