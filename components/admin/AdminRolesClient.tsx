"use client";

import React, { useMemo, useState } from "react";

export type AdminRoleRow = {
  user_id: string;
  role: "owner" | "admin" | "ops" | "analyst";
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

function fmtTs(ts?: string): string {
  if (!ts) return "-";
  try {
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return ts;
    return d.toISOString().replace("T", " ").slice(0, 19);
  } catch {
    return ts;
  }
}

export default function AdminRolesClient(props: {
  canEdit: boolean;
  actorUserId: string;
  initialRoles: AdminRoleRow[];
}) {
  const { canEdit, actorUserId } = props;

  const [roles, setRoles] = useState<AdminRoleRow[]>(props.initialRoles || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [created, setCreated] = useState<string>("");

  const [newUserId, setNewUserId] = useState("");
  const [newRole, setNewRole] = useState<AdminRoleRow["role"]>("admin");
  const [newActive, setNewActive] = useState(true);

  const sorted = useMemo(() => {
    const copy = [...roles];
    copy.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
    return copy;
  }, [roles]);

  const reload = async () => {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/roles", { method: "GET" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || "roles_fetch_failed");
      }
      setRoles(Array.isArray(data.roles) ? data.roles : []);
    } catch (e: any) {
      setError(e?.message || "取得に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const upsert = async (row: AdminRoleRow) => {
    setError("");
    setCreated("");
    if (!canEdit) return;

    setBusy(true);
    try {
      const res = await fetch("/api/admin/roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_id: row.user_id,
          role: row.role,
          is_active: row.is_active,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || "update_failed");
      }
      setCreated(`更新しました: ${row.user_id.slice(0, 8)}...`);
      await reload();
    } catch (e: any) {
      setError(e?.message || "更新に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const addNew = async () => {
    const u = newUserId.trim();
    if (!u) {
      setError("user_id を入力してください");
      return;
    }
    await upsert({ user_id: u, role: newRole, is_active: newActive });
    setNewUserId("");
  };

  return (
    <div className="adminCard">
      <div className="adminCardLabel">管理者一覧</div>

      <div className="adminMuted" style={{ marginTop: 8 }}>
        自分の user_id: <span className="adminKbd">{actorUserId}</span>
      </div>

      {!canEdit && (
        <div className="adminWarn" style={{ marginTop: 10 }}>
          このページの変更操作は <span className="adminKbd">owner</span> のみ可能です。
        </div>
      )}

      {canEdit && (
        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 900 }}>追加 / 更新</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={newUserId}
              onChange={(e) => setNewUserId(e.target.value)}
              placeholder="user_id (UUID)"
              style={{ flex: 1, minWidth: 240, padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }}
            />

            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as any)}
              style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)", fontWeight: 800 }}
            >
              <option value="owner">owner</option>
              <option value="admin">admin</option>
              <option value="ops">ops</option>
              <option value="analyst">analyst</option>
            </select>

            <label style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 800 }}>
              <input type="checkbox" checked={newActive} onChange={(e) => setNewActive(e.target.checked)} />
              有効
            </label>

            <button
              type="button"
              onClick={addNew}
              disabled={busy}
              style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.18)", background: "#ecfccb", fontWeight: 900 }}
            >
              {busy ? "処理中..." : "追加/更新"}
            </button>

            <button
              type="button"
              onClick={reload}
              disabled={busy}
              style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.18)", background: "#fff", fontWeight: 900 }}
            >
              再読込
            </button>
          </div>

          <div className="adminMuted">※ user_id は Supabase Auth のユーザーID（UUID）です。</div>
        </div>
      )}

      {error && <div style={{ marginTop: 12, color: "#b91c1c", fontWeight: 800, whiteSpace: "pre-wrap" }}>{error}</div>}
      {created && <div style={{ marginTop: 12, color: "#065f46", fontWeight: 800 }}>{created}</div>}

      <table className="adminTable" aria-label="管理者一覧" style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>user_id</th>
            <th>role</th>
            <th>active</th>
            <th>updated</th>
            {canEdit ? <th>操作</th> : null}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const isMe = r.user_id === actorUserId;
            return (
              <tr key={r.user_id}>
                <td style={{ whiteSpace: "nowrap" }}>
                  <span className="adminKbd" title={r.user_id}>
                    {r.user_id.slice(0, 8)}
                  </span>
                  {isMe && <span className="adminMuted" style={{ marginLeft: 6 }}>(me)</span>}
                </td>

                <td>
                  {canEdit ? (
                    <select
                      value={r.role}
                      onChange={(e) => {
                        const v = e.target.value as any;
                        setRoles((prev) => prev.map((x) => (x.user_id === r.user_id ? { ...x, role: v } : x)));
                      }}
                      style={{ padding: 8, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)", fontWeight: 800 }}
                    >
                      <option value="owner">owner</option>
                      <option value="admin">admin</option>
                      <option value="ops">ops</option>
                      <option value="analyst">analyst</option>
                    </select>
                  ) : (
                    <span className="adminChip">{r.role}</span>
                  )}
                </td>

                <td>
                  {canEdit ? (
                    <input
                      type="checkbox"
                      checked={!!r.is_active}
                      onChange={(e) => setRoles((prev) => prev.map((x) => (x.user_id === r.user_id ? { ...x, is_active: e.target.checked } : x)))}
                    />
                  ) : r.is_active ? (
                    <span className="adminChip">active</span>
                  ) : (
                    <span className="adminMuted">inactive</span>
                  )}
                </td>

                <td style={{ whiteSpace: "nowrap" }}>{fmtTs(r.updated_at)}</td>

                {canEdit ? (
                  <td>
                    <button
                      type="button"
                      onClick={() => upsert(r)}
                      disabled={busy}
                      style={{ padding: "8px 10px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.18)", background: "#fff", fontWeight: 900 }}
                    >
                      保存
                    </button>
                  </td>
                ) : null}
              </tr>
            );
          })}

          {sorted.length === 0 && (
            <tr>
              <td colSpan={canEdit ? 5 : 4} className="adminMuted">
                まだ管理者が登録されていません。
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="adminMuted" style={{ marginTop: 10 }}>
        ※最後の owner を無効化 / 降格する操作はサーバー側で拒否されます。
      </div>
    </div>
  );
}
