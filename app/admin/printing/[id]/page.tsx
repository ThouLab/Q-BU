import React from "react";
import Link from "next/link";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import OrderDetailClient from "@/components/admin/OrderDetailClient";
import OrderModelPreview from "@/components/admin/OrderModelPreview";

export const dynamic = "force-dynamic";

type OrderRow = {
  id: string;
  created_at: string;
  updated_at: string;
  status: string;
  payment_status: string;
  model_name: string | null;
  model_fingerprint: string | null;
  block_count: number | null;
  support_block_count: number | null;
  max_dim_mm: number | string | null;
  mm_per_unit: number | string | null;
  scale_mode: string | null;
  quote_total_yen: number | null;
  quote_subtotal_yen?: number | null;
  discount_yen?: number | null;
  ticket_id?: string | null;
  quote_volume_cm3: number | string | null;
  warn_exceeds_max: boolean | null;
  customer_note: string | null;
  admin_note: string | null;
  model_data?: any;
};

function fmtTs(ts: string): string {
  try {
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return ts;
    return d.toISOString().replace("T", " ").slice(0, 19);
  } catch {
    return ts;
  }
}

function fmtNum(v: any, digits = 1): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  const k = Math.pow(10, digits);
  return (Math.round(n * k) / k).toString();
}

function fmtYen(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return Math.round(n).toLocaleString("ja-JP");
}

export default async function AdminPrintOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const sb = await getSupabaseServerClient();
  if (!sb) {
    return (
      <div>
        <h1 className="adminH1">注文詳細</h1>
        <div className="adminWarn">Supabase が未設定です。</div>
      </div>
    );
  }

  const { data, error } = await sb.from("print_orders").select("*").eq("id", id).maybeSingle();

  const order = data as OrderRow | null;

  if (error || !order) {
    return (
      <div>
        <h1 className="adminH1">注文詳細</h1>
        <div style={{ marginTop: 10 }}>
          <Link href="/admin/printing">← 一覧へ戻る</Link>
        </div>
        <div className="adminWarn" style={{ marginTop: 12 }}>
          注文の取得に失敗しました。<br />
          <span className="adminMuted">詳細: {error?.message || "not_found"}</span>
        </div>
      </div>
    );
  }

  const discount = Number(order.discount_yen || 0);
  const subtotal = order.quote_subtotal_yen != null ? Number(order.quote_subtotal_yen) : null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h1 className="adminH1">注文詳細</h1>
          <div className="adminMuted" style={{ marginTop: 4 }}>
            ID: <span className="adminKbd">{order.id}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/admin/printing">← 一覧へ</Link>
          <Link href="/admin">総合へ →</Link>
        </div>
      </div>

      <div className="adminCards" style={{ gridTemplateColumns: "minmax(320px, 1.2fr) minmax(320px, 0.8fr)", marginTop: 12 }}>
        <div>
          <table className="adminTable" aria-label="注文情報">
            <tbody>
          <tr>
            <th>作成</th>
            <td>{fmtTs(order.created_at)}</td>
          </tr>
          <tr>
            <th>更新</th>
            <td>{fmtTs(order.updated_at)}</td>
          </tr>
          <tr>
            <th>モデル</th>
            <td>{order.model_name || "Q-BU"}</td>
          </tr>
          <tr>
            <th>指紋</th>
            <td>{order.model_fingerprint ? <span className="adminKbd">{order.model_fingerprint}</span> : "-"}</td>
          </tr>
          <tr>
            <th>ブロック</th>
            <td>
              {order.block_count ?? 0}
              {typeof order.support_block_count === "number" && order.support_block_count > 0 ? (
                <span className="adminMuted">（補完 {order.support_block_count}）</span>
              ) : null}
            </td>
          </tr>
          <tr>
            <th>サイズ</th>
            <td>
              最大辺 {fmtNum(order.max_dim_mm, 1)}mm ／ 1unit={fmtNum(order.mm_per_unit, 2)}mm（{order.scale_mode || "-"}）
              {order.warn_exceeds_max && <span className="warnYellow" style={{ marginLeft: 8 }}>⚠ 180mm超</span>}
            </td>
          </tr>
          <tr>
            <th>見積</th>
            <td>
              {order.quote_total_yen != null ? (
                <>
                  <b>{fmtYen(order.quote_total_yen)}円</b>
                  <span className="adminMuted">（推定体積 {fmtNum(order.quote_volume_cm3, 1)}cm³ / 送料別）</span>
                  {discount > 0 && (
                    <div className="adminMuted" style={{ marginTop: 6 }}>
                      割引 -{fmtYen(discount)}円{subtotal != null ? `（元 ${fmtYen(subtotal)}円）` : ""}
                    </div>
                  )}
                </>
              ) : (
                "-"
              )}
            </td>
          </tr>
          <tr>
            <th>チケット</th>
            <td>{order.ticket_id ? <span className="adminKbd">{String(order.ticket_id).slice(0, 8)}</span> : "-"}</td>
          </tr>
          <tr>
            <th>ステータス</th>
            <td>
              <span className="adminChip">{order.status}</span> <span className="adminChip">{order.payment_status}</span>
            </td>
          </tr>
          <tr>
            <th>ユーザー備考</th>
            <td style={{ whiteSpace: "pre-wrap" }}>{order.customer_note || "-"}</td>
          </tr>
            </tbody>
          </table>
        </div>

        <div>
          <OrderModelPreview orderId={order.id} modelName={order.model_name || "Q-BU"} modelData={order.model_data || null} />
        </div>
      </div>

      <OrderDetailClient orderId={order.id} initialStatus={order.status} initialPaymentStatus={order.payment_status} initialAdminNote={order.admin_note || ""} />
    </div>
  );
}
