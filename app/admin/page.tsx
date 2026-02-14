import React from "react";
import Link from "next/link";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type DailyDAURow = { day: string; dau: number };
type DailySTLRow = { day: string; stl_exports: number };
type DailyPrintRow = { day: string; print_requests: number };
type DailyOrdersRow = { day: string; orders: number };

type DayPoint = {
  day: string;
  dau: number;
  stl: number;
  print: number;
  orders: number;
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function clampRangeDays(raw?: string): number {
  const n = Number(raw);
  if (n === 7 || n === 14 || n === 30 || n === 90) return n;
  return 7;
}

function toNumber(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function percent(n: number): string {
  if (!Number.isFinite(n)) return "-";
  return `${Math.round(n * 10) / 10}%`;
}

export default async function AdminDashboard({
  searchParams,
}: {
  // Next.js 15+: searchParams is async (Promise). Await before accessing.
  searchParams?: Promise<{ range?: string }> | { range?: string };
}) {
  const sp = (searchParams ? await searchParams : undefined) as { range?: string } | undefined;
  const days = clampRangeDays(sp?.range);

  const sb = await getSupabaseServerClient();

  if (!sb) {
    return (
      <div>
        <h1 className="adminH1">総合ダッシュボード</h1>
        <div className="adminWarn">Supabase が未設定です。</div>
      </div>
    );
  }

  const today = new Date();
  const from = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000);
  const fromDay = ymd(from);
  const toDay = ymd(today);

  const [dauRes, stlRes, printRes, ordersRes] = await Promise.all([
    sb.from("v_dau_daily").select("day,dau").gte("day", fromDay).order("day", { ascending: true }),
    sb.from("v_stl_exports_daily").select("day,stl_exports").gte("day", fromDay).order("day", { ascending: true }),
    sb.from("v_print_request_open_daily").select("day,print_requests").gte("day", fromDay).order("day", { ascending: true }),
    // v1.0.15-β: actual submitted orders (if SQL applied)
    sb.from("v_orders_submitted_daily").select("day,orders").gte("day", fromDay).order("day", { ascending: true }),
  ]);

  const hasAlphaError = Boolean(dauRes.error || stlRes.error || printRes.error);
  const hasOrdersError = Boolean(ordersRes.error);

  const dauMap = new Map<string, number>();
  const stlMap = new Map<string, number>();
  const printMap = new Map<string, number>();
  const ordersMap = new Map<string, number>();

  (dauRes.data as DailyDAURow[] | null)?.forEach((r) => dauMap.set(r.day, toNumber(r.dau)));
  (stlRes.data as DailySTLRow[] | null)?.forEach((r) => stlMap.set(r.day, toNumber(r.stl_exports)));
  (printRes.data as DailyPrintRow[] | null)?.forEach((r) => printMap.set(r.day, toNumber(r.print_requests)));
  (ordersRes.data as DailyOrdersRow[] | null)?.forEach((r) => ordersMap.set(r.day, toNumber((r as any).orders)));

  const series: DayPoint[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from.getTime() + i * 24 * 60 * 60 * 1000);
    const day = ymd(d);
    series.push({
      day,
      dau: dauMap.get(day) ?? 0,
      stl: stlMap.get(day) ?? 0,
      print: printMap.get(day) ?? 0,
      orders: ordersMap.get(day) ?? 0,
    });
  }

  const totalDAU = series.reduce((a, b) => a + b.dau, 0);
  const totalSTL = series.reduce((a, b) => a + b.stl, 0);
  const totalPrint = series.reduce((a, b) => a + b.print, 0);
  const avgDAU = days > 0 ? Math.round(totalDAU / days) : 0;

  const cvProxy = totalSTL > 0 ? (totalPrint / totalSTL) * 100 : NaN;

  const ordersAvailable = !ordersRes.error;
  const totalOrders = ordersAvailable ? series.reduce((a, b) => a + b.orders, 0) : 0;
  const cvOrders = ordersAvailable && totalSTL > 0 ? (totalOrders / totalSTL) * 100 : NaN;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h1 className="adminH1">総合ダッシュボード</h1>
          <div className="adminMuted">
            期間: {fromDay} 〜 {toDay}（{days}日）
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {[7, 14, 30, 90].map((n) => (
            <Link key={n} href={`/admin?range=${n}`} style={{ textDecoration: "none", fontWeight: 900, opacity: n === days ? 1 : 0.55 }}>
              {n}日
            </Link>
          ))}
        </div>
      </div>

      {hasAlphaError && (
        <div className="adminWarn">
          <div>集計ビュー（α）の取得に失敗しました。</div>
          <div className="adminMuted" style={{ marginTop: 6 }}>
            SQL（<span className="adminKbd">supabase/migrations/20260213_v1015_alpha.sql</span>）を適用してから再度お試しください。
            <br />
            {dauRes.error?.message && (
              <>
                DAU: <span className="adminKbd">{dauRes.error.message}</span>
                <br />
              </>
            )}
            {stlRes.error?.message && (
              <>
                STL: <span className="adminKbd">{stlRes.error.message}</span>
                <br />
              </>
            )}
            {printRes.error?.message && (
              <>
                Print: <span className="adminKbd">{printRes.error.message}</span>
                <br />
              </>
            )}
          </div>
        </div>
      )}

      {hasOrdersError && (
        <div className="adminWarn" style={{ marginTop: 12 }}>
          <div>注文数（β）の集計ビューがまだ有効化されていません。</div>
          <div className="adminMuted" style={{ marginTop: 6 }}>
            SQL（<span className="adminKbd">supabase/migrations/20260213_v1015_beta.sql</span>）を適用すると、注文数と「注文 / STL」のCVが表示されます。
            <br />
            {ordersRes.error?.message && (
              <>
                Orders: <span className="adminKbd">{ordersRes.error.message}</span>
              </>
            )}
          </div>
        </div>
      )}

      <div className="adminCards">
        <div className="adminCard">
          <div className="adminCardLabel">平均DAU</div>
          <div className="adminCardValue">{avgDAU}</div>
        </div>

        <div className="adminCard">
          <div className="adminCardLabel">STL書き出し（合計）</div>
          <div className="adminCardValue">{totalSTL}</div>
        </div>

        <div className="adminCard">
          <div className="adminCardLabel">印刷依頼ページ到達（合計）</div>
          <div className="adminCardValue">{totalPrint}</div>
        </div>

        <div className="adminCard">
          <div className="adminCardLabel">CV（到達 / STL）</div>
          <div className="adminCardValue">{percent(cvProxy)}</div>
        </div>

        <div className="adminCard">
          <div className="adminCardLabel">注文送信（合計）</div>
          <div className="adminCardValue">{ordersAvailable ? totalOrders : "-"}</div>
        </div>

        <div className="adminCard">
          <div className="adminCardLabel">CV（注文 / STL）</div>
          <div className="adminCardValue">{ordersAvailable ? percent(cvOrders) : "-"}</div>
        </div>
      </div>

      <div className="adminMuted">
        ※ v1.0.15-α は「印刷依頼ページ到達」をCVの代理指標として表示します。v1.0.15-β で注文送信（A案）を追加しました。
      </div>

      <table className="adminTable" aria-label="日次集計">
        <thead>
          <tr>
            <th>日付</th>
            <th>DAU</th>
            <th>STL</th>
            <th>印刷到達</th>
            <th>注文</th>
            <th>CV（到達/STL）</th>
            <th>CV（注文/STL）</th>
          </tr>
        </thead>
        <tbody>
          {series.map((r) => {
            const cvDayProxy = r.stl > 0 ? (r.print / r.stl) * 100 : NaN;
            const cvDayOrders = ordersAvailable && r.stl > 0 ? (r.orders / r.stl) * 100 : NaN;
            return (
              <tr key={r.day}>
                <td>{r.day}</td>
                <td>{r.dau}</td>
                <td>{r.stl}</td>
                <td>{r.print}</td>
                <td>{ordersAvailable ? r.orders : "-"}</td>
                <td>{percent(cvDayProxy)}</td>
                <td>{ordersAvailable ? percent(cvDayOrders) : "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ marginTop: 12 }} className="adminMuted">
        次: <Link href="/admin/analytics/users">データ分析</Link> / <Link href="/admin/printing">印刷依頼</Link> /{" "}
        <Link href="/admin/settings">設定</Link>
      </div>
    </div>
  );
}
