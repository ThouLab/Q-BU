import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

let _admin: SupabaseClient | null = null;

/**
 * サーバー専用（service role）クライアント
 * - 行動ログなど「未ログインでも」保存したい用途向け
 * - SUPABASE_SERVICE_ROLE_KEY を必ずサーバー環境変数に設定すること
 */
export function getSupabaseAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (_admin) return _admin;

  _admin = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return _admin;
}
