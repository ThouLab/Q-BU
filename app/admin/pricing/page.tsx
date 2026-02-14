import React from "react";
import Link from "next/link";

import PricingClient, { type PricingRowForUI } from "@/components/admin/PricingClient";
import { getAdminGate } from "@/lib/admin/adminGate";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function fmtTs(ts?: string | null): string {
  if (!ts) return "-";
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

export default async function AdminPricing() {
  const gate = await getAdminGate();
  const sb = await getSupabaseServerClient();

  if (!sb) {
    return (
      <div>
        <h1 className="adminH1">価格設定</h1>
        <div className="adminWarn">Supabase が未設定です。</div>
      </div>
    );
  }

  // Active config (via view)
  const activeRes = await sb
    .from("v_pricing_active")
    .select("id,currency,base_fee_yen,per_cm3_yen,min_fee_yen,rounding_step_yen,note,effective_from")
    .maybeSingle();

  const histRes = await sb
    .from("pricing_configs")
    .select("id,currency,base_fee_yen,per_cm3_yen,min_fee_yen,rounding_step_yen,note,effective_from,is_active,created_at")
    .order("created_at", { ascending: false })
    .limit(30);

  const active = activeRes.data as any | null;
  const history = (histRes.data as any[] | null) ?? [];

  const canEdit = gate.ok && gate.admin.role === "owner";

  const activeForUI: PricingRowForUI | null = active
    ? {
        id: Number(active.id),
        currency: String(active.currency || "JPY"),
        base_fee_yen: Number(active.base_fee_yen),
        per_cm3_yen: Number(active.per_cm3_yen),
        min_fee_yen: Number(active.min_fee_yen),
        rounding_step_yen: Number(active.rounding_step_yen),
        note: active.note ?? null,
        effective_from: active.effective_from ?? null,
      }
    : null;

  return (
    <div>
      <h1 className="adminH1">価格設定</h1>
      <div className="adminMuted">B2. 印刷依頼価格等の設定（v1.0.15-γ）</div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link href="/admin">← 総合ダッシュボード</Link>
        <Link href="/admin/printing">印刷依頼一覧</Link>
      </div>

      {(activeRes.error || histRes.error) && (
        <div className="adminWarn" style={{ marginTop: 12 }}>
          <div>pricing_configs の取得に失敗しました。</div>
          <div className="adminMuted" style={{ marginTop: 6 }}>
            SQL（<span className="adminKbd">supabase/migrations/20260213_v1015_gamma.sql</span>）を適用してから再度お試しください。
            <br />
            {activeRes.error?.message && (
              <>
                Active: <span className="adminKbd">{activeRes.error.message}</span>
                <br />
              </>
            )}
            {histRes.error?.message && (
              <>
                History: <span className="adminKbd">{histRes.error.message}</span>
              </>
            )}
          </div>
        </div>
      )}

      <div className="adminCards" style={{ marginTop: 12, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <div className="adminCard">
          <div className="adminCardLabel">現在の有効設定</div>
          {active ? (
            <>
              <div style={{ marginTop: 10, fontSize: 16, fontWeight: 900 }}>
                {fmtYen(active.base_fee_yen)}円 + {fmtYen(active.per_cm3_yen)}円/cm³（最低 {fmtYen(active.min_fee_yen)}円）
              </div>
              <div className="adminMuted" style={{ marginTop: 6 }}>
                端数丸め: {fmtYen(active.rounding_step_yen)}円 ／ 有効化: {fmtTs(active.effective_from)}
              </div>
              {active.note && <div className="adminMuted" style={{ marginTop: 6 }}>メモ: {String(active.note)}</div>}
            </>
          ) : (
            <div className="adminMuted" style={{ marginTop: 10 }}>
              有効な設定が見つかりません（migration 未適用の可能性があります）。
            </div>
          )}
        </div>

        <PricingClient canEdit={canEdit} active={activeForUI} />
      </div>

      <div className="adminMuted" style={{ marginTop: 12 }}>
        ※価格設定は「概算見積（送料別）」の前提です。実際の造形方式・材料・後加工等により、最終価格が変動する可能性があります。
      </div>

      <h2 className="adminH2" style={{ marginTop: 18 }}>履歴（最新30件）</h2>
      <table className="adminTable" aria-label="価格設定履歴">
        <thead>
          <tr>
            <th>作成</th>
            <th>有効化</th>
            <th>状態</th>
            <th>基本</th>
            <th>単価</th>
            <th>最低</th>
            <th>丸め</th>
            <th>メモ</th>
          </tr>
        </thead>
        <tbody>
          {history.map((r: any) => (
            <tr key={String(r.id)}>
              <td style={{ whiteSpace: "nowrap" }}>{fmtTs(r.created_at)}</td>
              <td style={{ whiteSpace: "nowrap" }}>{fmtTs(r.effective_from)}</td>
              <td>{r.is_active ? <span className="adminChip">active</span> : <span className="adminMuted">-</span>}</td>
              <td>{fmtYen(r.base_fee_yen)}円</td>
              <td>{fmtYen(r.per_cm3_yen)}円/cm³</td>
              <td>{fmtYen(r.min_fee_yen)}円</td>
              <td>{fmtYen(r.rounding_step_yen)}円</td>
              <td className="adminMuted" style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.note ? String(r.note) : ""}
              </td>
            </tr>
          ))}
          {history.length === 0 && (
            <tr>
              <td colSpan={8} className="adminMuted">履歴がありません。</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
