"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { estimatePrintPriceYen, formatYen, type PricingParams } from "@/components/qbu/printScale";

export type PricingRowForUI = {
  id: number;
  currency: string;
  base_fee_yen: number;
  per_cm3_yen: number;
  min_fee_yen: number;
  rounding_step_yen: number;
  note?: string | null;
  effective_from?: string | null;
};

function clampInt(v: string, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export default function PricingClient(props: {
  canEdit: boolean;
  active: PricingRowForUI | null;
}) {
  const router = useRouter();

  const active = props.active;
  const [baseFee, setBaseFee] = useState(String(active?.base_fee_yen ?? 800));
  const [perCm3, setPerCm3] = useState(String(active?.per_cm3_yen ?? 60));
  const [minFee, setMinFee] = useState(String(active?.min_fee_yen ?? 1200));
  const [step, setStep] = useState(String(active?.rounding_step_yen ?? 10));
  const [note, setNote] = useState(String(active?.note ?? ""));

  const [sampleVolume, setSampleVolume] = useState("10");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [okMsg, setOkMsg] = useState<string>("");

  const normalized = useMemo((): PricingParams => {
    return {
      baseFeeYen: clampInt(baseFee, 0, 1_000_000, 800),
      perCm3Yen: clampInt(perCm3, 0, 1_000_000, 60),
      minFeeYen: clampInt(minFee, 0, 1_000_000, 1200),
      roundingStepYen: clampInt(step, 1, 10_000, 10),
    };
  }, [baseFee, perCm3, minFee, step]);

  const sampleQuote = useMemo(() => {
    const v = Math.max(0, Number(sampleVolume) || 0);
    return estimatePrintPriceYen(v, normalized);
  }, [sampleVolume, normalized]);

  const submit = async () => {
    setError("");
    setOkMsg("");
    if (!props.canEdit) {
      setError("この操作は owner のみ実行できます。");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/admin/pricing/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          base_fee_yen: normalized.baseFeeYen,
          per_cm3_yen: normalized.perCm3Yen,
          min_fee_yen: normalized.minFeeYen,
          rounding_step_yen: normalized.roundingStepYen,
          note: note.trim().slice(0, 200),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || data?.message || "update_failed");
      }
      setOkMsg("価格設定を更新しました。新規の注文から適用されます。");
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "更新に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adminCard" style={{ minWidth: 280 }}>
      <div className="adminCardLabel">価格設定（新規注文に適用）</div>

      <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
        <label>
          <div style={{ fontWeight: 800, fontSize: 12 }}>基本料金（円）</div>
          <input
            value={baseFee}
            onChange={(e) => setBaseFee(e.target.value)}
            inputMode="numeric"
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }}
            disabled={!props.canEdit || busy}
          />
        </label>

        <label>
          <div style={{ fontWeight: 800, fontSize: 12 }}>体積単価（円 / cm³）</div>
          <input
            value={perCm3}
            onChange={(e) => setPerCm3(e.target.value)}
            inputMode="numeric"
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }}
            disabled={!props.canEdit || busy}
          />
        </label>

        <label>
          <div style={{ fontWeight: 800, fontSize: 12 }}>最低料金（円）</div>
          <input
            value={minFee}
            onChange={(e) => setMinFee(e.target.value)}
            inputMode="numeric"
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }}
            disabled={!props.canEdit || busy}
          />
        </label>

        <label>
          <div style={{ fontWeight: 800, fontSize: 12 }}>端数丸め（円）</div>
          <input
            value={step}
            onChange={(e) => setStep(e.target.value)}
            inputMode="numeric"
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }}
            disabled={!props.canEdit || busy}
          />
        </label>

        <label>
          <div style={{ fontWeight: 800, fontSize: 12 }}>メモ（任意）</div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }}
            disabled={!props.canEdit || busy}
          />
        </label>

        <div style={{ background: "#f9fafb", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12, padding: 10 }}>
          <div style={{ fontWeight: 900, fontSize: 12 }}>簡易テスト</div>
          <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 800 }}>体積</span>
            <input
              value={sampleVolume}
              onChange={(e) => setSampleVolume(e.target.value)}
              inputMode="decimal"
              style={{ width: 90, padding: 8, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }}
            />
            <span style={{ fontSize: 12, fontWeight: 800 }}>cm³</span>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "#374151", fontWeight: 800 }}>
            概算: <b>{formatYen(sampleQuote.subtotalYen)}円</b>（送料別）
          </div>
          <div className="adminMuted" style={{ marginTop: 6 }}>
            内訳: 基本 {formatYen(sampleQuote.breakdown.baseFeeYen)}円 + 体積 {formatYen(sampleQuote.breakdown.volumeFeeYen)}円
          </div>
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={!props.canEdit || busy}
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

        {!props.canEdit && <div className="adminMuted">※この操作は owner のみ実行できます。</div>}
        {error && <div style={{ color: "#b91c1c", fontWeight: 700, whiteSpace: "pre-wrap" }}>{error}</div>}
        {okMsg && <div style={{ color: "#166534", fontWeight: 800, whiteSpace: "pre-wrap" }}>{okMsg}</div>}
      </div>
    </div>
  );
}
