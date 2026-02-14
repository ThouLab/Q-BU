import React from "react";
import Link from "next/link";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type OrderRow = {
  id: string;
  created_at: string;
  status: string;
  payment_status: string;
  quote_total_yen: number | null;
  quote_subtotal_yen?: number | null;
  discount_yen?: number | null;
  ticket_id?: string | null;
  max_dim_mm: number | string | null;
  block_count: number | null;
  support_block_count: number | null;
  model_name: string | null;
  warn_exceeds_max: boolean | null;
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

function fmtYen(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return Math.round(n).toLocaleString("ja-JP");
}

function fmtMm(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return (Math.round(n * 10) / 10).toString();
}

export default async function AdminPrinting() {
  const sb = await getSupabaseServerClient();
  if (!sb) {
    return (
      <div>
        <h1 className="adminH1">印刷依頼管理</h1>
        <div className="adminWarn">Supabase が未設定です。</div>
      </div>
    );
  }

  const { data, error } = await sb
    .from("print_orders")
    .select("id,created_at,status,payment_status,quote_total_yen,quote_subtotal_yen,discount_yen,ticket_id,max_dim_mm,block_count,support_block_count,model_name,warn_exceeds_max")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div>
      <h1 className="adminH1">印刷依頼管理</h1>
      <div className="adminMuted">B1. 印刷依頼一覧（v1.0.15-β） / B2. 価格設定（v1.0.15-γ） / C2. チケット（v1.0.15-δ）</div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link href="/admin">← 総合ダッシュボード</Link>
        <Link href="/admin/pricing">価格設定</Link>
        <Link href="/admin/settings/tickets">チケット</Link>
      </div>

      {error && (
        <div className="adminWarn" style={{ marginTop: 12 }}>
          <div>print_orders の取得に失敗しました。</div>
          <div className="adminMuted" style={{ marginTop: 6 }}>
            まだ SQL を適用していない可能性があります。<br />
            詳細: <span className="adminKbd">{error.message}</span>
          </div>
        </div>
      )}

      {!error && (
        <>
          <div className="adminMuted" style={{ marginTop: 12 }}>
            最新50件を表示しています。配送先などの個人情報は暗号化保存され、詳細画面でのみ復号表示します。
          </div>

          <table className="adminTable" aria-label="印刷依頼一覧">
            <thead>
              <tr>
                <th>日時</th>
                <th>モデル</th>
                <th>サイズ</th>
                <th>見積</th>
                <th>ステータス</th>
                <th>支払い</th>
                <th>ブロック</th>
              </tr>
            </thead>
            <tbody>
              {(data as OrderRow[] | null)?.map((o) => {
                const discount = Number(o.discount_yen || 0);
                const subtotal = o.quote_subtotal_yen != null ? Number(o.quote_subtotal_yen) : null;
                return (
                  <tr key={o.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtTs(o.created_at)}</td>
                    <td>
                      <Link href={`/admin/printing/${o.id}`} style={{ fontWeight: 900 }}>
                        {o.model_name || "Q-BU"}
                      </Link>
                      {o.warn_exceeds_max && <div className="warnYellow" style={{ marginTop: 6 }}>⚠ 180mm超</div>}
                      {o.ticket_id && <div className="adminMuted" style={{ marginTop: 6 }}>🎟 {String(o.ticket_id).slice(0, 8)}</div>}
                      <div className="adminMuted" style={{ marginTop: 6 }}>
                        <span className="adminKbd">{o.id.slice(0, 8)}</span>
                      </div>
                    </td>
                    <td>{fmtMm(o.max_dim_mm)}mm</td>
                    <td>
                      {o.quote_total_yen != null ? (
                        <>
                          <b>{fmtYen(o.quote_total_yen)}円</b>
                          {discount > 0 && (
                            <div className="adminMuted" style={{ marginTop: 4 }}>
                              割引 -{fmtYen(discount)}円{subtotal != null ? `（元 ${fmtYen(subtotal)}円）` : ""}
                            </div>
                          )}
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      <span className="adminChip">{o.status}</span>
                    </td>
                    <td>
                      <span className="adminChip">{o.payment_status}</span>
                    </td>
                    <td>
                      {o.block_count ?? 0}
                      {typeof o.support_block_count === "number" && o.support_block_count > 0 ? (
                        <span className="adminMuted">（補完 {o.support_block_count}）</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {(data as OrderRow[] | null)?.length === 0 && (
                <tr>
                  <td colSpan={7} className="adminMuted">
                    まだ注文がありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="adminMuted" style={{ marginTop: 12 }}>
            価格設定（B2）は <Link href="/admin/pricing">価格設定</Link> で変更できます（新規の注文から適用）。
          </div>
        </>
      )}
    </div>
  );
}
