"use client";

import React, { useMemo, useState } from "react";

export type TicketRow = {
  id: string;
  created_at?: string;
  type: "percent" | "fixed" | "free" | "shipping_free";
  apply_scope?: "subtotal" | "total" | string | null;
  shipping_free?: boolean | null;
  code_prefix?: string | null;
  value?: number | null;
  currency?: string | null;
  is_active?: boolean | null;
  expires_at?: string | null;
  max_total_uses?: number | null;
  max_uses_per_user?: number | null;
  note?: string | null;
  constraints?: any;
  used_total?: number | null;
};

function fmtTs(ts?: string | null): string {
  if (!ts) return "-";
  try {
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return String(ts);
    return d.toISOString().replace("T", " ").slice(0, 19);
  } catch {
    return String(ts);
  }
}

function fmtValue(t: TicketRow): string {
  const v = Number(t.value);
  if (t.type === "percent") {
    return Number.isFinite(v) ? `${v}%` : "-";
  }
  if (t.type === "fixed") {
    return Number.isFinite(v) ? `${Math.round(v).toLocaleString("ja-JP")}円` : "-";
  }
  if (t.type === "free") return "無料";
  if (t.type === "shipping_free") return "送料0";
  return "-";
}

export default function TicketsClient(props: {
  canEdit: boolean;
  initialTickets: TicketRow[];
}) {
  const { canEdit } = props;
  const [tickets, setTickets] = useState<TicketRow[]>(props.initialTickets || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdCode, setCreatedCode] = useState<string>("");

  // create form
  const [type, setType] = useState<TicketRow["type"]>("percent");
  const [value, setValue] = useState<string>("20");
  const [applyScope, setApplyScope] = useState<string>("subtotal");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [maxTotalUses, setMaxTotalUses] = useState<string>("");
  const [maxPerUser, setMaxPerUser] = useState<string>("1");
  const [note, setNote] = useState<string>("");

  const sorted = useMemo(() => {
    const copy = [...tickets];
    copy.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    return copy;
  }, [tickets]);

  const reload = async () => {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/tickets", { method: "GET" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || "tickets_fetch_failed");
      }
      setTickets(Array.isArray(data.tickets) ? data.tickets : []);
    } catch (e: any) {
      setError(e?.message || "取得に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!canEdit) return;
    setError("");
    setCreatedCode("");
    setBusy(true);
    try {
      const payload: any = {
        type,
        apply_scope: applyScope === "total" ? "total" : "subtotal",
        shipping_free: type === "shipping_free",
        note: note.trim(),
        max_total_uses: maxTotalUses.trim(),
        max_uses_per_user: maxPerUser.trim(),
      };

      if (type === "percent" || type === "fixed") {
        payload.value = value.trim();
      }
      if (expiresAt.trim()) {
        // datetime-local returns "YYYY-MM-DDTHH:mm"
        const d = new Date(expiresAt);
        if (Number.isFinite(d.getTime())) {
          payload.expires_at = d.toISOString();
        }
      }

      const res = await fetch("/api/admin/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || "create_failed");
      }
      setCreatedCode(String(data.code || ""));
      await reload();
    } catch (e: any) {
      setError(e?.message || "作成に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (id: string, is_active: boolean) => {
    if (!canEdit) return;
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tickets/${id}/toggle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_active }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || "toggle_failed");
      }
      await reload();
    } catch (e: any) {
      setError(e?.message || "更新に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adminCard">
      <div className="adminCardLabel">優待チケット</div>

      {!canEdit && (
        <div className="adminWarn" style={{ marginTop: 10 }}>
          このページの作成/変更は <span className="adminKbd">owner / admin</span> のみ可能です。
        </div>
      )}

      {canEdit && (
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <div style={{ fontWeight: 900 }}>新規発行</div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as any)}
              style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)", fontWeight: 900 }}
            >
              <option value="percent">%割引</option>
              <option value="fixed">固定額割引</option>
              <option value="free">無料</option>
              <option value="shipping_free">送料0</option>
            </select>

            {(type === "percent" || type === "fixed" || type === "free") && (
              <label style={{ fontWeight: 900 }}>
                適用範囲
                <select
                  value={applyScope}
                  onChange={(e) => setApplyScope(e.target.value)}
                  style={{ marginLeft: 8, padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)", fontWeight: 900 }}
                >
                  <option value="subtotal">送料別（小計）</option>
                  <option value="total">送料込み（合計）</option>
                </select>
              </label>
            )}

            {(type === "percent" || type === "fixed") && (
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={type === "percent" ? "例: 20" : "例: 500"}
                style={{ width: 160, padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }}
              />
            )}

            <label style={{ fontWeight: 900 }}>
              期限（任意）
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                style={{ marginLeft: 8, padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }}
              />
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={maxTotalUses}
              onChange={(e) => setMaxTotalUses(e.target.value)}
              placeholder="総使用回数上限（空=無制限）"
              style={{ width: 220, padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }}
            />
            <input
              value={maxPerUser}
              onChange={(e) => setMaxPerUser(e.target.value)}
              placeholder="ユーザー毎上限（空=無制限）"
              style={{ width: 220, padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }}
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="メモ（任意）"
              style={{ flex: 1, minWidth: 200, padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }}
            />

            <button
              type="button"
              onClick={create}
              disabled={busy}
              style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.18)", background: "#ecfccb", fontWeight: 900 }}
            >
              {busy ? "処理中..." : "発行"}
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

          {createdCode && (
            <div style={{ padding: 10, borderRadius: 12, border: "1px solid rgba(0,0,0,0.12)", background: "rgba(236, 252, 203, 0.6)" }}>
              <div style={{ fontWeight: 900 }}>発行しました（この表示は一度だけ）</div>
              <div style={{ marginTop: 6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 16 }}>
                {createdCode}
              </div>
              <div className="adminMuted" style={{ marginTop: 6 }}>
                ※DBにはコードのハッシュのみ保存されます。
              </div>
            </div>
          )}
        </div>
      )}

      {error && <div style={{ marginTop: 12, color: "#b91c1c", fontWeight: 800, whiteSpace: "pre-wrap" }}>{error}</div>}

      <table className="adminTable" aria-label="チケット一覧" style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>作成</th>
            <th>種別</th>
            <th>値</th>
            <th>範囲</th>
            <th>prefix</th>
            <th>使用</th>
            <th>期限</th>
            <th>状態</th>
            <th>メモ</th>
            {canEdit ? <th>操作</th> : null}
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => {
            const used = Number(t.used_total ?? 0);
            const totalLimit = t.max_total_uses == null ? null : Number(t.max_total_uses);
            const isOver = totalLimit != null && Number.isFinite(totalLimit) && used >= totalLimit;

            return (
              <tr key={t.id}>
                <td style={{ whiteSpace: "nowrap" }}>{fmtTs(t.created_at || null)}</td>
                <td><span className="adminChip">{t.type}</span></td>
                <td style={{ whiteSpace: "nowrap" }}>{fmtValue(t)}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {t.type === "shipping_free" ? <span className="adminMuted">-</span> : <span className="adminChip">{String(t.apply_scope || "subtotal")}</span>}
                </td>
                <td>{t.code_prefix ? <span className="adminKbd">{t.code_prefix}</span> : "-"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {used.toLocaleString("ja-JP")}
                  {totalLimit != null && Number.isFinite(totalLimit) ? ` / ${Math.round(totalLimit).toLocaleString("ja-JP")}` : ""}
                  {isOver && <div className="warnYellow" style={{ marginTop: 6 }}>上限到達</div>}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>{fmtTs(t.expires_at || null)}</td>
                <td>{t.is_active ? <span className="adminChip">active</span> : <span className="adminMuted">inactive</span>}</td>
                <td className="adminMuted" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.note || ""}
                </td>
                {canEdit ? (
                  <td>
                    <button
                      type="button"
                      onClick={() => toggle(t.id, !t.is_active)}
                      disabled={busy}
                      style={{ padding: "8px 10px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.18)", background: "#fff", fontWeight: 900 }}
                    >
                      {t.is_active ? "無効化" : "有効化"}
                    </button>
                  </td>
                ) : null}
              </tr>
            );
          })}

          {sorted.length === 0 && (
            <tr>
              <td colSpan={canEdit ? 10 : 9} className="adminMuted">
                まだチケットがありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="adminMuted" style={{ marginTop: 10 }}>
        ※利用状況は <span className="adminKbd">ticket_redemptions</span> に記録されます。
      </div>
    </div>
  );
}
