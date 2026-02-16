"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import { computeMixedBBox } from "@/components/qbu/subBlocks";
import { useTelemetry } from "@/components/telemetry/TelemetryProvider";
import {
  estimatePrintPriceYen,
  estimateSolidVolumeCm3,
  formatMm,
  formatYen,
  resolvePrintScale,
  type PricingParams,
  type PrintScaleSetting,
} from "@/components/qbu/printScale";

import { buildRateMap, findShippingYen, fallbackShippingRates, type ShippingRateRow } from "@/lib/shipping/rates";
import { deriveSizeTierFromMm, worldSizeToMm } from "@/lib/shipping/sizeTier";
import { zoneFromPrefecture } from "@/lib/shipping/zones";

type PrintDraft = {
  baseName: string;
  /** v1.0.15+: model fingerprint (analysis) */
  modelFingerprint?: string;
  /** legacy: max-side mm */
  targetMm: number;
  /** v1.0.14+: print scale mode */
  scaleSetting: PrintScaleSetting;
  /** base blocks (1.0) */
  blocks: string[];
  /** support blocks (0.5) */
  supportBlocks: string[];
  created_at: number;
};

const PRINT_DRAFT_KEY = "qbu_print_draft_v1";

type ZipCandidate = {
  zipcode: string;
  prefecture: string;
  city: string;
  town: string;
};

function normalizeZip(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/[^0-9]/g, "")
    .slice(0, 7);
}

function formatZip7(z: string): string {
  const s = normalizeZip(z);
  if (s.length !== 7) return s;
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

export default function PrintPage() {
  const { track, anonId, sessionId } = useTelemetry();

  const [draft, setDraft] = useState<PrintDraft | null>(null);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ orderId: string } | null>(null);

  const [pricing, setPricing] = useState<Partial<PricingParams> | null>(null);
  const [shipping, setShipping] = useState<{ configId: number | null; rates: ShippingRateRow[] } | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [zipBusy, setZipBusy] = useState(false);
  const [zipError, setZipError] = useState<string>("");
  const [zipCandidates, setZipCandidates] = useState<ZipCandidate[]>([]);
  const [zipSelected, setZipSelected] = useState(0);
  const [addressLine2, setAddressLine2] = useState("");
  const [notes, setNotes] = useState("");
  const [ticketCode, setTicketCode] = useState("");


  // load draft
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PRINT_DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as PrintDraft;
      if (d && Array.isArray(d.blocks)) setDraft(d);
    } catch {
      // ignore
    }
  }, []);

  // load active pricing (public)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/pricing/active", { method: "GET" });
        const data = await res.json().catch(() => null);
        if (!alive) return;
        if (!res.ok) return;
        if (data?.ok && data?.pricing) {
          setPricing({
            baseFeeYen: Number(data.pricing.baseFeeYen),
            perCm3Yen: Number(data.pricing.perCm3Yen),
            minFeeYen: Number(data.pricing.minFeeYen),
            roundingStepYen: Number(data.pricing.roundingStepYen),
          });
        }
      } catch {
        // ignore (fallback to defaults)
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // load active shipping (public)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/shipping/active", { method: "GET" });
        const data = await res.json().catch(() => null);
        if (!alive) return;
        if (!res.ok) return;
        if (data?.ok && data?.shipping) {
          setShipping({
            configId: typeof data.shipping.configId === "number" ? data.shipping.configId : null,
            rates: Array.isArray(data.shipping.rates) ? (data.shipping.rates as ShippingRateRow[]) : fallbackShippingRates(),
          });
        }
      } catch {
        // ignore (fallback)
        if (!alive) return;
        setShipping({ configId: null, rates: fallbackShippingRates() });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // log open event once
  const openLoggedRef = useRef(false);
  useEffect(() => {
    if (openLoggedRef.current) return;
    openLoggedRef.current = true;

    if (draft) {
      track("print_request_open", {
        model_fingerprint: draft.modelFingerprint ?? null,
        base_blocks: Array.isArray(draft.blocks) ? draft.blocks.length : 0,
        support_blocks: Array.isArray(draft.supportBlocks) ? draft.supportBlocks.length : 0,
      });
    } else {
      track("print_request_open", { empty: true });
    }
  }, [draft, track]);

  const derived = useMemo(() => {
    if (!draft) return null;

    const base = new Set(draft.blocks || []);
    const supp = new Set(draft.supportBlocks || []);

    const bbox = computeMixedBBox(base, supp as any);

    const setting: PrintScaleSetting = draft.scaleSetting || { mode: "maxSide", maxSideMm: draft.targetMm || 50 };
    const resolved = resolvePrintScale({
      bboxMaxDimWorld: bbox.maxDim,
      setting,
      clampMaxSideMm: { min: 10, max: 300 },
      clampBlockEdgeMm: { min: 0.1, max: 500 },
    });

    const volumeCm3 = estimateSolidVolumeCm3({
      baseBlockCount: base.size,
      supportBlockCount: supp.size,
      mmPerUnit: resolved.mmPerUnit,
    });

    const quote = estimatePrintPriceYen(volumeCm3, pricing || undefined);

    return {
      baseCount: base.size,
      supportCount: supp.size,
      bbox,
      resolved,
      quote,
    };
  }, [draft, pricing]);

  const summary = useMemo(() => {
    if (!draft || !derived) return "";
    const sizeText =
      derived.resolved.mode === "maxSide"
        ? `最大辺 ${formatMm(derived.resolved.maxSideMm, 1)}mm（1unit=${formatMm(derived.resolved.mmPerUnit, 2)}mm）`
        : `1ブロック辺 ${formatMm(derived.resolved.mmPerUnit, 2)}mm（最大辺 ${formatMm(derived.resolved.maxSideMm, 1)}mm）`;
    return `モデル: ${draft.baseName} / ブロック数: ${derived.baseCount}（補完 ${derived.supportCount}） / サイズ: ${sizeText}`;
  }, [draft, derived]);

  const selectedZip = useMemo(() => {
    if (!zipCandidates.length) return null;
    const idx = Math.max(0, Math.min(zipSelected, zipCandidates.length - 1));
    return zipCandidates[idx] || null;
  }, [zipCandidates, zipSelected]);

  const fullAddress = useMemo(() => {
    const z = formatZip7(postalCode);
    const c = selectedZip;
    const base = c ? `${c.prefecture}${c.city}${c.town}` : "";
    const line2 = addressLine2.trim();
    const addr = `${base}${line2}`.trim();
    return { zipcode: z, base, addr, line2 };
  }, [postalCode, selectedZip, addressLine2]);

  const shippingEstimate = useMemo(() => {
    if (!derived) return null;
    if (!shipping?.rates?.length) return null;
    if (!selectedZip?.prefecture) return null;

    const zone = zoneFromPrefecture(selectedZip.prefecture);
    if (!zone) return { ok: false as const, reason: "zone_unknown" };

    const sizeMm = worldSizeToMm(derived.bbox.size as any, derived.resolved.mmPerUnit);
    const tierInfo = deriveSizeTierFromMm(sizeMm, { paddingMm: 20 });

    const map = buildRateMap(shipping.rates);
    const yen = findShippingYen(map, zone, tierInfo.sizeTier);
    if (yen == null) return { ok: false as const, reason: "rate_not_found", zone, sizeTier: tierInfo.sizeTier };

    return {
      ok: true as const,
      zone,
      sizeTier: tierInfo.sizeTier,
      shippingYen: yen,
      capped: tierInfo.capped,
      sumCm: tierInfo.sumCm,
    };
  }, [derived, shipping, selectedZip]);

  const totals = useMemo(() => {
    if (!derived) return null;
    const itemSubtotal = derived.quote.subtotalYen;
    if (shippingEstimate?.ok) {
      const ship = shippingEstimate.shippingYen;
      return { itemSubtotal, ship, total: itemSubtotal + ship };
    }
    return { itemSubtotal, ship: null as number | null, total: null as number | null };
  }, [derived, shippingEstimate]);

  const lookupZip = async () => {
    setZipError("");
    const z = normalizeZip(postalCode);
    if (z.length !== 7) {
      setZipError("郵便番号は7桁で入力してください。");
      return;
    }
    setZipBusy(true);
    try {
      const res = await fetch(`/api/address/lookup?zipcode=${z}`, { method: "GET" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || "住所検索に失敗しました");
      }
      const cands = (Array.isArray(data?.candidates) ? data.candidates : []) as ZipCandidate[];
      if (!cands.length) throw new Error("該当住所が見つかりませんでした。");
      setZipCandidates(cands);
      setZipSelected(0);
    } catch (e: any) {
      setZipCandidates([]);
      setZipSelected(0);
      setZipError(e?.message || "住所検索に失敗しました");
    } finally {
      setZipBusy(false);
    }
  };

  const submit = async () => {
    setError("");
    if (!draft) {
      setError("印刷データがありません。エディターに戻って『印刷を依頼する』から進んでください。");
      return;
    }

    if (derived?.resolved.warnTooLarge) {
      setError("最大辺が180mmを超えるため、印刷依頼できません。サイズを小さくしてください。");
      return;
    }
    if (!email.trim()) {
      setError("連絡先メールアドレスを入力してください。");
      return;
    }
    if (!name.trim()) {
      setError("お名前を入力してください。");
      return;
    }
    if (!normalizeZip(postalCode) || !selectedZip) {
      setError("郵便番号を入力して住所検索を行い、配送先を確定してください。");
      return;
    }
    if (!addressLine2.trim()) {
      setError("番地・建物名など（住所の続き）を入力してください。");
      return;
    }
    if (!fullAddress.addr.trim()) {
      setError("配送先住所を確定してください。");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/print/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draft,
          customer: {
            name: name.trim(),
            email: email.trim(),
            phone: phone.trim(),
            postal_code: fullAddress.zipcode,
            prefecture: selectedZip.prefecture,
            city: selectedZip.city,
            town: selectedZip.town,
            address_line2: fullAddress.line2,
            address: fullAddress.addr,
            notes: notes.trim(),
            ticket_code: ticketCode.trim(),
          },
          telemetry: {
            anon_id: anonId,
            session_id: sessionId,
          },
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message || data?.error || "submit_failed");
      }
      if (data?.ok && typeof data?.order_id === "string") {
        setDone({ orderId: data.order_id });

        // prevent double submit on back/refresh
        try {
          sessionStorage.removeItem(PRINT_DRAFT_KEY);
        } catch {
          // ignore
        }

        return;
      }
      throw new Error("submit_failed");
    } catch (e: any) {
      setError(e?.message || "送信に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div style={{ padding: 18, maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ marginBottom: 6 }}>送信完了</h1>
        <p style={{ marginTop: 0, color: "#6b7280" }}>
          印刷依頼を受け付けました。内容確認のうえ、メールでご連絡します。
        </p>

        <div style={{ background: "#f9fafb", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12, padding: 12, marginBottom: 14 }}>
          <div style={{ fontWeight: 700 }}>注文ID</div>
          <div style={{ marginTop: 6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{done.orderId}</div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button
            type="button"
            onClick={() => (window.location.href = "/")}
            style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.18)", background: "#fff", fontWeight: 800 }}
          >
            エディターへ戻る
          </button>

          <button
            type="button"
            onClick={() => (window.location.href = "/admin/printing")}
            style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.18)", background: "#ecfccb", fontWeight: 900 }}
          >
            管理画面で確認（管理者）
          </button>
        </div>

        <p style={{ marginTop: 12, color: "#6b7280", fontSize: 12 }}>
          ※管理画面は管理者権限が必要です。
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 18, maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 6 }}>印刷を依頼する</h1>
      <p style={{ marginTop: 0, color: "#6b7280" }}>
        ここで連絡先と配送先を入力し、依頼を送信します（見積は概算です）。
      </p>

      {draft ? (
        <div style={{ background: "#f9fafb", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12, padding: 12, marginBottom: 14 }}>
          <div style={{ fontWeight: 700 }}>内容</div>
          <div style={{ marginTop: 4 }}>{summary}</div>

          {derived && (
            <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
              {derived.resolved.warnTooLarge && (
                <div className="warnYellow">⚠ 最大辺が180mmを超えています（印刷依頼には大きすぎます）</div>
              )}
              <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>
                概算見積（小計）: <b>{formatYen(derived.quote.subtotalYen)}円</b> ／ 推定体積 {formatMm(derived.quote.volumeCm3, 1)}cm³
              </div>
              {totals && (
                <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 800 }}>
                  {totals.ship != null && totals.total != null ? (
                    <>
                      送料概算: <b>{formatYen(totals.ship)}円</b> ／ 合計概算: <b>{formatYen(totals.total)}円</b>
                      {shippingEstimate?.ok && (
                        <>
                          {" "}
                          <span style={{ color: "#6b7280", fontSize: 12 }}>
                            （{String(shippingEstimate.zone)} / {String(shippingEstimate.sizeTier)}）
                          </span>
                        </>
                      )}
                    </>
                  ) : (
                    <>送料は配送先入力後に自動計算します。</>
                  )}
                </div>
              )}
              {shippingEstimate && !shippingEstimate.ok && (
                <div style={{ fontSize: 12, color: "#b45309", fontWeight: 800 }}>
                  送料が確定できませんでした（{shippingEstimate.reason}）。郵便番号検索で住所を確定し、管理者側で送料設定をご確認ください。
                </div>
              )}
              <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>※概算です（造形方式・材料・肉厚・充填率で変動します）</div>
              <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>※チケット割引の反映は送信後に確定します。</div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ background: "#fff7ed", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12, padding: 12, marginBottom: 14 }}>
          印刷データが見つかりません。エディターに戻って『印刷を依頼する』から進んでください。
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        <label>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>お名前</div>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }} />
        </label>

        <label>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>メールアドレス</div>
          <input value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }} />
        </label>

        <label>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>電話番号（任意）</div>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }} />
        </label>

        <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 12, background: "#fff" }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>配送先住所（郵便番号 → 検索）</div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              placeholder="例: 252-0802"
              inputMode="numeric"
              style={{ width: 200, padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }}
            />
            <button
              type="button"
              onClick={lookupZip}
              disabled={zipBusy}
              style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.18)", background: zipBusy ? "#f3f4f6" : "#ecfccb", fontWeight: 900 }}
            >
              {zipBusy ? "検索中..." : "住所検索"}
            </button>
            <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>※郵便番号検索で都道府県を確定し、送料を自動計算します。</div>
          </div>

          {zipError && <div style={{ marginTop: 8, color: "#b91c1c", fontWeight: 700 }}>{zipError}</div>}

          {zipCandidates.length > 0 && (
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              <label>
                <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 12, color: "#6b7280" }}>検索結果</div>
                <select
                  value={String(zipSelected)}
                  onChange={(e) => setZipSelected(Number(e.target.value))}
                  style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)", fontWeight: 800 }}
                >
                  {zipCandidates.map((c, i) => (
                    <option key={`${c.zipcode}-${i}`} value={String(i)}>
                      {`${c.prefecture}${c.city}${c.town}`}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 12, color: "#6b7280" }}>住所の続き（番地・建物名など）</div>
                <input
                  value={addressLine2}
                  onChange={(e) => setAddressLine2(e.target.value)}
                  placeholder="例: 250-4 ○○マンション101"
                  style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }}
                />
              </label>

              <div style={{ fontSize: 12, color: "#6b7280" }}>
                確定住所: <b>{fullAddress.addr || "-"}</b>
              </div>
            </div>
          )}
        </div>

        <label>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>優待チケット（任意）</div>
          <input
            value={ticketCode}
            onChange={(e) => setTicketCode(e.target.value)}
            placeholder="例: QBU-ABCD-EFGH-IJKL"
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }}
          />
          <div style={{ marginTop: 4, fontSize: 12, color: "#6b7280" }}>お持ちの場合のみ入力してください。</div>
        </label>

        <label>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>備考（任意）</div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }} />
        </label>
      </div>

      {error && <div style={{ marginTop: 12, color: "#b91c1c", fontWeight: 600, whiteSpace: "pre-wrap" }}>{error}</div>}

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button
          type="button"
          onClick={() => (window.location.href = "/")}
          style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.18)", background: "#fff" }}
        >
          戻る
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || Boolean(derived?.resolved.warnTooLarge)}
          style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.18)", background: busy ? "#f3f4f6" : "#ecfccb", fontWeight: 800 }}
        >
          {busy ? "送信中..." : "依頼を送信する"}
        </button>
      </div>

      <p style={{ marginTop: 12, color: "#6b7280", fontSize: 12 }}>
        ※決済連携（Stripe/Google Pay）は次フェーズで追加予定です。
      </p>
    </div>
  );
}
