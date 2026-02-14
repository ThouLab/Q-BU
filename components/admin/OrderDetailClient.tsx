"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ShippingInfo = {
  name: string;
  email: string;
  phone?: string;
  address: string;
};

const STATUS_OPTIONS = ["submitted", "confirmed", "printing", "shipped", "done", "cancelled"] as const;
const PAYMENT_OPTIONS = ["unpaid", "pending", "paid", "refunded", "failed"] as const;

export default function OrderDetailClient(props: {
  orderId: string;
  initialStatus: string;
  initialPaymentStatus: string;
  initialAdminNote: string;
}) {
  const router = useRouter();

  const [status, setStatus] = useState<string>(props.initialStatus || "submitted");
  const [payment, setPayment] = useState<string>(props.initialPaymentStatus || "unpaid");
  const [adminNote, setAdminNote] = useState<string>(props.initialAdminNote || "");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  const [shipping, setShipping] = useState<ShippingInfo | null>(null);
  const [shippingBusy, setShippingBusy] = useState(false);
  const [shippingError, setShippingError] = useState<string>("");

  const canSave = useMemo(() => !busy, [busy]);

  const loadShipping = async () => {
    setShippingError("");
    setShippingBusy(true);
    try {
      const res = await fetch(`/api/admin/orders/${props.orderId}/shipping`, { method: "GET" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "shipping_fetch_failed");
      }
      setShipping(data?.shipping || null);
    } catch (e: any) {
      setShippingError(e?.message || "配送先の取得に失敗しました。");
    } finally {
      setShippingBusy(false);
    }
  };

  const save = async () => {
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/orders/${props.orderId}/update`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          payment_status: payment,
          admin_note: adminNote,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || data?.message || "update_failed");
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "更新に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 6 }}>管理操作</div>

      <div className="adminCards" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <div className="adminCard">
          <div className="adminCardLabel">ステータス</div>
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 10 }}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <select value={payment} onChange={(e) => setPayment(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 10 }}>
              {PAYMENT_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(0,0,0,0.18)",
                background: busy ? "#f3f4f6" : "#ecfccb",
                fontWeight: 900,
              }}
            >
              {busy ? "更新中..." : "更新する"}
            </button>

            {error && <div style={{ color: "#b91c1c", fontWeight: 700, whiteSpace: "pre-wrap" }}>{error}</div>}
          </div>
        </div>

        <div className="adminCard">
          <div className="adminCardLabel">管理者メモ</div>
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            <textarea
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              rows={6}
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }}
              placeholder="制作状況、連絡履歴、メモなど"
            />
            <div className="adminMuted">※更新すると監査ログに記録されます（audit_logs）。</div>
          </div>
        </div>

        <div className="adminCard">
          <div className="adminCardLabel">配送先（復号表示）</div>
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            {!shipping && (
              <button
                type="button"
                onClick={loadShipping}
                disabled={shippingBusy}
                style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.18)", background: "#fff", fontWeight: 900 }}
              >
                {shippingBusy ? "読み込み中..." : "配送先を表示"}
              </button>
            )}

            {shippingError && <div style={{ color: "#b91c1c", fontWeight: 700, whiteSpace: "pre-wrap" }}>{shippingError}</div>}

            {shipping && (
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                <div>
                  <b>氏名:</b> {shipping.name}
                </div>
                <div>
                  <b>Email:</b> {shipping.email}
                </div>
                {shipping.phone && (
                  <div>
                    <b>電話:</b> {shipping.phone}
                  </div>
                )}
                <div style={{ whiteSpace: "pre-wrap" }}>
                  <b>住所:</b> {shipping.address}
                </div>

                <button
                  type="button"
                  onClick={() => setShipping(null)}
                  style={{ marginTop: 8, padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)", background: "#fff" }}
                >
                  閉じる
                </button>
              </div>
            )}

            <div className="adminMuted">※配送先は暗号化保存され、owner/admin/ops のみ復号できます。</div>
          </div>
        </div>
      </div>
    </div>
  );
}