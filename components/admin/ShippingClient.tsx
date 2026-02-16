"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { DEFAULT_SIZE_TIERS, DEFAULT_ZONES, type ShippingRateRow, toInt } from "@/lib/shipping/rates";
import { formatYen } from "@/components/qbu/printScale";

type Props = {
  canEdit: boolean;
  activeConfigId: number | null;
  activeRates: ShippingRateRow[];
  activeNote?: string | null;
};

function key(zone: string, tier: string): string {
  return `${zone}__${tier}`;
}

export default function ShippingClient({ canEdit, activeConfigId, activeRates, activeNote }: Props) {
  const router = useRouter();

  const initialMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of activeRates || []) {
      const z = String((r as any).zone || "").toLowerCase();
      const t = String((r as any).size_tier || "");
      if (!z || !t) continue;
      m.set(key(z, t), toInt((r as any).price_yen, 0));
    }
    return m;
  }, [activeRates]);

  const [note, setNote] = useState(String(activeNote || ""));
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const obj: Record<string, string> = {};
    for (const z of DEFAULT_ZONES) {
      for (const t of DEFAULT_SIZE_TIERS) {
        obj[key(z, t)] = String(initialMap.get(key(z, t)) ?? "");
      }
    }
    return obj;
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const matrix = useMemo(() => {
    const rows: ShippingRateRow[] = [];
    for (const z of DEFAULT_ZONES) {
      for (const t of DEFAULT_SIZE_TIERS) {
        const v = vals[key(z, t)];
        const yen = Math.max(0, toInt(v, 0));
        rows.push({ zone: z, size_tier: t, price_yen: yen });
      }
    }
    return rows;
  }, [vals]);

  const submit = async () => {
    setError("");
    setOkMsg("");
    if (!canEdit) {
      setError("この操作は owner のみ実行できます。");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/admin/shipping/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          note: note.trim().slice(0, 200),
          rates: matrix,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || "update_failed");
      }
      setOkMsg("送料設定を更新しました。新規の注文から適用されます。");
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "更新に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adminCard" style={{ minWidth: 280 }}>
      <div className="adminCardLabel">送料設定（新規注文に適用）</div>
      <div className="adminMuted" style={{ marginTop: 6 }}>
        v1.0.16: 郵便番号検索で確定した配送先（都道府県）とサイズTierから送料を算出します。
      </div>

      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        <label>
          <div style={{ fontWeight: 800, fontSize: 12 }}>メモ（任意）</div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={!canEdit || busy}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }}
          />
        </label>

        <div style={{ overflowX: "auto" }}>
          <table className="adminTable" aria-label="送料テーブル" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>ゾーン</th>
                {DEFAULT_SIZE_TIERS.map((t) => (
                  <th key={t} style={{ whiteSpace: "nowrap" }}>
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DEFAULT_ZONES.map((z) => (
                <tr key={z}>
                  <td>
                    <span className="adminChip">{z}</span>
                  </td>
                  {DEFAULT_SIZE_TIERS.map((t) => {
                    const k = key(z, t);
                    return (
                      <td key={k} style={{ whiteSpace: "nowrap" }}>
                        <input
                          value={vals[k] ?? ""}
                          onChange={(e) => setVals((prev) => ({ ...prev, [k]: e.target.value }))}
                          inputMode="numeric"
                          disabled={!canEdit || busy}
                          style={{ width: 92, padding: 8, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }}
                        />
                        <span className="adminMuted" style={{ marginLeft: 6 }}>
                          円
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="adminMuted">
          現在の有効設定ID: <span className="adminKbd">{activeConfigId ?? "-"}</span>
        </div>

        <div style={{ background: "#f9fafb", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12, padding: 10 }}>
          <div style={{ fontWeight: 900, fontSize: 12 }}>簡易テスト（kanto / 60）</div>
          <div style={{ marginTop: 6, fontSize: 12, fontWeight: 800 }}>
            {formatYen(Math.max(0, toInt(vals[key("kanto", "60")], 0)))}円
          </div>
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={!canEdit || busy}
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.18)",
            background: busy ? "#f3f4f6" : "#ecfccb",
            fontWeight: 900,
          }}
        >
          {busy ? "更新中..." : "更新して有効化"}
        </button>

        {!canEdit && <div className="adminMuted">※この操作は owner のみ実行できます。</div>}
        {error && <div style={{ color: "#b91c1c", fontWeight: 700, whiteSpace: "pre-wrap" }}>{error}</div>}
        {okMsg && <div style={{ color: "#166534", fontWeight: 800, whiteSpace: "pre-wrap" }}>{okMsg}</div>}
      </div>
    </div>
  );
}
