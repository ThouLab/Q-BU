import React from "react";
import Link from "next/link";

import ShippingClient from "@/components/admin/ShippingClient";
import { getAdminGate } from "@/lib/admin/adminGate";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
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

export default async function AdminShipping() {
  const gate = await getAdminGate();
  const sb = await getSupabaseServerClient();
  const admin = getSupabaseAdminClient();
  const client = (admin ?? sb) as any;

  if (!sb) {
    return (
      <div>
        <h1 className="adminH1">送料設定</h1>
        <div className="adminWarn">Supabase が未設定です。</div>
      </div>
    );
  }

  const canEdit = gate.ok && gate.admin.role === "owner";

  const activeRes = await client
    .from("shipping_configs")
    .select("id,currency,effective_from,note")
    .eq("is_active", true)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  const active = activeRes.data as any | null;
  const activeId = active?.id != null ? Number(active.id) : null;

  const ratesRes = activeId
    ? await client
        .from("shipping_rates")
        .select("zone,size_tier,price_yen")
        .eq("config_id", activeId)
        .order("zone", { ascending: true })
        .order("size_tier", { ascending: true })
        .limit(500)
    : ({ data: [], error: null } as any);

  const histRes = await client
    .from("shipping_configs")
    .select("id,created_at,effective_from,is_active,note")
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <div>
      <h1 className="adminH1">送料設定</h1>
      <div className="adminMuted">v1.0.16: 配送料テーブル（暫定）</div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link href="/admin">← 総合ダッシュボード</Link>
        <Link href="/admin/printing">印刷依頼一覧</Link>
        <Link href="/admin/pricing">価格設定</Link>
        <Link href="/admin/settings">設定</Link>
      </div>

      {(activeRes.error || ratesRes.error || histRes.error) && (
        <div className="adminWarn" style={{ marginTop: 12 }}>
          <div>shipping_configs / shipping_rates の取得に失敗しました。</div>
          <div className="adminMuted" style={{ marginTop: 6 }}>
            SQL（<span className="adminKbd">supabase/migrations/20260214_v1016_alpha.sql</span>）を適用してから再度お試しください。
            <br />
            {activeRes.error?.message && (
              <>
                Active: <span className="adminKbd">{activeRes.error.message}</span>
                <br />
              </>
            )}
            {ratesRes.error?.message && (
              <>
                Rates: <span className="adminKbd">{ratesRes.error.message}</span>
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
                設定ID: {String(active.id)} / 通貨: {String(active.currency || "JPY")}
              </div>
              <div className="adminMuted" style={{ marginTop: 6 }}>
                有効化: {fmtTs(active.effective_from)}
              </div>
              {active.note && <div className="adminMuted" style={{ marginTop: 6 }}>メモ: {String(active.note)}</div>}
              <div className="adminMuted" style={{ marginTop: 10 }}>
                ※発送元はオフィス（藤沢市高倉250-4）に最も近い想定（Kanto）として、都道府県→ゾーンで計算します。
              </div>
            </>
          ) : (
            <div className="adminMuted" style={{ marginTop: 10 }}>有効な設定が見つかりません（migration 未適用の可能性があります）。</div>
          )}
        </div>

        <ShippingClient canEdit={canEdit} activeConfigId={activeId} activeRates={(ratesRes.data as any[]) || []} activeNote={active?.note ?? null} />
      </div>

      <h2 className="adminH2" style={{ marginTop: 18 }}>
        履歴（最新20件）
      </h2>
      <table className="adminTable" aria-label="送料設定履歴">
        <thead>
          <tr>
            <th>作成</th>
            <th>有効化</th>
            <th>状態</th>
            <th>メモ</th>
          </tr>
        </thead>
        <tbody>
          {(histRes.data as any[] | null)?.map((r: any) => (
            <tr key={String(r.id)}>
              <td style={{ whiteSpace: "nowrap" }}>{fmtTs(r.created_at)}</td>
              <td style={{ whiteSpace: "nowrap" }}>{fmtTs(r.effective_from)}</td>
              <td>{r.is_active ? <span className="adminChip">active</span> : <span className="adminMuted">-</span>}</td>
              <td className="adminMuted" style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.note ? String(r.note) : ""}
              </td>
            </tr>
          ))}
          {((histRes.data as any[] | null) ?? []).length === 0 && (
            <tr>
              <td colSpan={4} className="adminMuted">
                履歴がありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
