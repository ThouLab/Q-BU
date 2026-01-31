import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/**
 * ブラウザ用 Supabase クライアント
 * - 環境変数が未設定の場合は null を返し、アプリは通常どおり動作します。
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) return null;
  _client = createBrowserClient(url, anon);
  return _client;
}
