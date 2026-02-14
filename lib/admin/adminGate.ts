import { getSupabaseServerClient } from "@/lib/supabase/server";

export type AdminRole = "owner" | "admin" | "ops" | "analyst";

export type AdminUser = {
  userId: string;
  email: string | null;
  role: AdminRole;
};

export type AdminGateResult =
  | {
      ok: true;
      supabaseConfigured: true;
      admin: AdminUser;
    }
  | {
      ok: false;
      supabaseConfigured: boolean;
      reason: "supabase_not_configured" | "not_logged_in" | "not_admin" | "admin_roles_query_failed";
      userId?: string | null;
      email?: string | null;
      details?: string;
    };

function normalizeRole(role: any): AdminRole {
  switch (role) {
    case "owner":
    case "admin":
    case "ops":
    case "analyst":
      return role;
    default:
      return "admin";
  }
}

/**
 * /admin 配下のアクセス判定
 * - Supabase未設定 / 未ログイン / admin_rolesに権限が無い場合は ok:false
 */
export async function getAdminGate(): Promise<AdminGateResult> {
  const sb = await getSupabaseServerClient();
  if (!sb) {
    return { ok: false, supabaseConfigured: false, reason: "supabase_not_configured" };
  }

  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) {
    return { ok: false, supabaseConfigured: true, reason: "not_logged_in" };
  }

  const user = data.user;

  // 自分の権限だけ読めればOK（RLS: user_id=auth.uid() を想定）
  const { data: row, error: e2 } = await sb
    .from("admin_roles")
    .select("role,is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (e2) {
    return {
      ok: false,
      supabaseConfigured: true,
      reason: "admin_roles_query_failed",
      userId: user.id,
      email: user.email ?? null,
      details: e2.message,
    };
  }

  if (!row || row.is_active !== true) {
    return {
      ok: false,
      supabaseConfigured: true,
      reason: "not_admin",
      userId: user.id,
      email: user.email ?? null,
    };
  }

  return {
    ok: true,
    supabaseConfigured: true,
    admin: {
      userId: user.id,
      email: user.email ?? null,
      role: normalizeRole((row as any).role),
    },
  };
}
