"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { computeMixedBBox } from "@/components/qbu/subBlocks";
import {
  estimatePrintPriceYen,
  estimateSolidVolumeCm3,
  formatMm,
  formatYen,
  resolvePrintScale,
  type PricingParams,
  type PrintScaleSetting,
} from "@/components/qbu/printScale";
import { useTelemetry } from "@/components/telemetry/TelemetryProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { translate, type Lang } from "@/lib/i18n";
import { buildRateMap, findShippingYen } from "@/lib/shipping/rates";
import { deriveSizeTierFromMm, worldSizeToMm } from "@/lib/shipping/sizeTier";
import { zoneFromPrefecture } from "@/lib/shipping/zones";

type PrintDraft = {
  baseName: string;
  // legacy: max-side mm
  targetMm?: number;
  // v1.0.14+: print scale mode
  scaleSetting?: PrintScaleSetting;
  // base blocks (1.0)
  blocks?: string[];
  // some older/experimental variants used baseBlocks
  baseBlocks?: string[];
  supportBlocks: string[];
  created_at?: number;
};

type ZipCandidate = {
  zipcode: string;
  prefecture: string;
  city: string;
  town: string;
};

function parseZipDigits(s: string): string {
  return (s || "").replace(/[^0-9]/g, "");
}

export default function PrintRequestPage() {
  const { lang } = useI18n();
  // For print/request related pages, kana mode uses Japanese (no hiragana conversion required).
  const effLang: Lang = (lang === "kana" ? "ja" : lang) as Lang;
  const t = (key: string, vars?: Record<string, string | number>) => translate(effLang, key, vars);

  const { track } = useTelemetry();

  // Active pricing (public API; falls back to defaults)
  const [pricing, setPricing] = useState<Partial<PricingParams> | null>(null);

  const [draft, setDraft] = useState<PrintDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneId, setDoneId] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  // Form fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [ticketCode, setTicketCode] = useState("");
  const [notes, setNotes] = useState("");

  // Address lookup
  const [postalCode, setPostalCode] = useState("");
  const [zipBusy, setZipBusy] = useState(false);
  const [zipError, setZipError] = useState("");
  const [zipCandidates, setZipCandidates] = useState<ZipCandidate[]>([]);
  const [zipSelected, setZipSelected] = useState<number>(0);
  const [addressLine2, setAddressLine2] = useState("");

  // Shipping estimate
  const [shippingEstimate, setShippingEstimate] = useState<any | null>(null);

  // Active shipping config (public API; falls back to defaults)
  const [shippingActive, setShippingActive] = useState<any | null>(null);

  // Load draft from sessionStorage (primary) then localStorage (fallback)
  useEffect(() => {
    try {
      const KEY = "qbu_print_draft_v1";
      const raw = sessionStorage.getItem(KEY) || localStorage.getItem(KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PrintDraft;
      const base = Array.isArray(parsed?.blocks)
        ? parsed.blocks
        : Array.isArray(parsed?.baseBlocks)
          ? parsed.baseBlocks
          : [];
      if (base.length) {
        setDraft({
          ...parsed,
          blocks: base,
          supportBlocks: Array.isArray(parsed?.supportBlocks) ? parsed.supportBlocks : [],
        });
      }
    } catch {
      // ignore
    }
  }, []);

  // Load active pricing (public)
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

  
  // Load active shipping rates (public)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/shipping/active", { method: "GET" });
        const data = await res.json().catch(() => null);
        if (!alive) return;
        if (data?.ok && data?.shipping?.rates) setShippingActive(data.shipping);
      } catch {
        // ignore (fallback handled by API)
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const derived = useMemo(() => {
    if (!draft) return null;

    const baseBlocks = new Set(Array.isArray(draft.blocks) ? draft.blocks : Array.isArray(draft.baseBlocks) ? draft.baseBlocks : []);
    const supportBlocks = new Set(Array.isArray(draft.supportBlocks) ? draft.supportBlocks : []);

    const fallbackSetting: PrintScaleSetting = {
      mode: "maxSide",
      maxSideMm: Math.max(10, Math.min(300, Math.round(Number(draft.targetMm || 120) || 120))),
    };
    const scaleSetting: PrintScaleSetting = draft.scaleSetting || fallbackSetting;

    const bbox = computeMixedBBox(baseBlocks, supportBlocks);
    const resolved = resolvePrintScale({
      bboxMaxDimWorld: bbox.maxDim,
      setting: scaleSetting,
      clampMaxSideMm: { min: 10, max: 300 },
      clampBlockEdgeMm: { min: 0.1, max: 500 },
    });
    const baseCount = baseBlocks.size;
    const supportCount = supportBlocks.size;

    const volume = estimateSolidVolumeCm3({
      baseBlockCount: baseCount,
      supportBlockCount: supportCount,
      mmPerUnit: resolved.mmPerUnit,
    });

    const quote = estimatePrintPriceYen(volume, pricing || undefined);

    const sizeText =
      resolved.mode === "maxSide"
        ? t("print.summary.size.maxSide", { max: formatMm(resolved.maxSideMm, 0), unit: formatMm(resolved.mmPerUnit, 2) })
        : t("print.summary.size.blockEdge", { unit: formatMm(resolved.mmPerUnit, 2), max: formatMm(resolved.maxSideMm, 1) });

    const summary = t("print.summary", {
      name: draft.baseName,
      base: baseCount.toLocaleString(),
      supp: supportCount.toLocaleString(),
      size: sizeText,
    });

    return {
      baseBlocks,
      supportBlocks,
      bbox,
      scaleSetting,
      resolved,
      quote,
      baseCount,
      supportCount,
      summary,
    };
  }, [draft, effLang, pricing]);

  const fullAddress = useMemo(() => {
    const c = zipCandidates[zipSelected];
    const addr1 = c ? `${c.prefecture}${c.city}${c.town}` : "";
    const addr = addr1 && addressLine2 ? `${addr1}${addressLine2}` : addr1;
    return { addr1, addr };
  }, [zipCandidates, zipSelected, addressLine2]);

  
// Estimate shipping when address changes
useEffect(() => {
  const c = zipCandidates[zipSelected];
  if (!derived || !c || !shippingActive?.rates) {
    setShippingEstimate(null);
    return;
  }

  try {
    const zone = zoneFromPrefecture(c.prefecture);
    if (!zone) {
      setShippingEstimate({ ok: false, reason: "unknown_zone" });
      return;
    }

    const sizeMm = worldSizeToMm(derived.bbox.size, derived.resolved.mmPerUnit);
    const tierInfo = deriveSizeTierFromMm(sizeMm, { paddingMm: 20 });

    const map = buildRateMap(shippingActive.rates);
    const yen = findShippingYen(map, zone, tierInfo.sizeTier);

    if (yen == null) {
      setShippingEstimate({ ok: false, reason: "rate_not_found", zone, sizeTier: tierInfo.sizeTier });
      return;
    }

    setShippingEstimate({
      ok: true,
      zone,
      sizeTier: tierInfo.sizeTier,
      price_yen: yen,
      sum_cm: tierInfo.sumCm,
      cappedTier: tierInfo.capped,
    });
  } catch (e: any) {
    setShippingEstimate({ ok: false, reason: e?.message || "calc_error" });
  }
}, [zipCandidates, zipSelected, derived, shippingActive]);

  const totals = useMemo(() => {
    if (!derived) return null;
    const ship = shippingEstimate?.ok ? Number(shippingEstimate.price_yen) : null;
    const subtotal = derived.quote.subtotalYen || 0;
    const total = ship != null ? subtotal + ship : null;
    return { ship, subtotal, total };
  }, [derived, shippingEstimate]);

  async function lookupZip() {
    setZipError("");
    setZipCandidates([]);
    setZipSelected(0);

    const digits = parseZipDigits(postalCode);
    if (digits.length !== 7) {
      setZipError(t("print.error.zip7"));
      return;
    }

    setZipBusy(true);
    try {
      const res = await fetch("/api/address/lookup?zipcode=" + digits);
      const data = await res.json();
      if (!res.ok) {
        setZipError(data?.message || data?.error || t("print.error.zipLookupFailed"));
        return;
      }
      const items: ZipCandidate[] = data?.candidates || [];
      if (!items.length) {
        setZipError(t("print.error.zipNotFound"));
        return;
      }
      setZipCandidates(items);
      setZipSelected(0);
      track("print_zip_lookup", { ok: true });
    } catch (e: any) {
      setZipError(e?.message || t("print.error.zipLookupFailed"));
      track("print_zip_lookup", { ok: false, error: String(e?.message || e) });
    } finally {
      setZipBusy(false);
    }
  }

  async function submit() {
    setError("");
    if (!derived || !draft) {
      setError(t("print.error.noDraft"));
      return;
    }
    if (derived.resolved.warnTooLarge) {
      setError(t("print.error.tooLarge"));
      return;
    }
    if (!email.trim()) {
      setError(t("print.error.email"));
      return;
    }
    if (!name.trim()) {
      setError(t("print.error.name"));
      return;
    }
    if (!zipCandidates.length) {
      setError(t("print.error.addressLookup"));
      return;
    }
    if (!addressLine2.trim()) {
      setError(t("print.error.addressLine2"));
      return;
    }
    if (!fullAddress.addr) {
      setError(t("print.error.addressConfirm"));
      return;
    }

    setBusy(true);
    try {
      const c = zipCandidates[zipSelected];

      
const body = {
  draft: {
    baseName: draft.baseName,
    modelFingerprint: (draft as any).modelFingerprint || null,
    blocks: Array.from(derived.baseBlocks),
    supportBlocks: Array.from(derived.supportBlocks),
    scaleSetting: derived.scaleSetting,
    // legacy
    targetMm: draft.targetMm ?? derived.resolved.maxSideMm,
  },
  customer: {
    name: name.trim(),
    email: email.trim(),
    phone: phone.trim(),
    postal_code: parseZipDigits(postalCode),
    prefecture: c.prefecture,
    city: c.city,
    town: c.town,
    address_line2: addressLine2.trim(),
    address: fullAddress.addr,
    notes: notes.trim(),
    ticket_code: ticketCode.trim(),
  },
};

const res = await fetch("/api/print/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || t("print.error.submitFailed"));
      }

      const orderId = data?.order_id || null;
      setDoneId(orderId ? String(orderId) : "ok");
      track("print_submit", { ok: true, order_id: orderId });
    } catch (e: any) {
      setError(e?.message || t("print.error.submitFailed"));
      track("print_submit", { ok: false, error: String(e?.message || e) });
    } finally {
      setBusy(false);
    }
  }

  if (doneId) {
    return (
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 18px" }}>
        <h1 style={{ marginTop: 0 }}>{t("print.done.title")}</h1>
        <p>{t("print.done.text")}</p>

        <div style={{ padding: 12, borderRadius: 12, background: "#ecfccb", border: "1px solid rgba(0,0,0,0.12)", fontWeight: 800 }}>
          {t("print.done.orderId")}: {doneId}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          <Link
            href="/"
            style={{ display: "inline-block", padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.18)", background: "#fff", fontWeight: 800, textDecoration: "none" }}
          >
            {t("print.done.backEditor")}
          </Link>

          <Link
            href={"/admin/print"}
            style={{ display: "inline-block", padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.18)", background: "#fff", fontWeight: 800, textDecoration: "none" }}
          >
            {t("print.done.admin")}
          </Link>
        </div>

        <p style={{ marginTop: 12, color: "#6b7280", fontSize: 12 }}>{t("print.done.adminNote")}</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 18px" }}>
      <h1 style={{ marginTop: 0 }}>{t("print.title")}</h1>
      <p style={{ marginTop: 8, color: "#6b7280" }}>{t("print.subtitle")}</p>

      {derived ? (
        <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 12, background: "#fff", marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 800 }}>{t("print.section.content")}</div>
              <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280", fontWeight: 700, whiteSpace: "pre-wrap" }}>{derived.summary}</div>
            </div>
          </div>

          {derived.resolved.warnTooLarge && (
            <div style={{ marginTop: 10, color: "#b45309", fontWeight: 800 }}>{t("print.warn.tooLarge")}</div>
          )}

          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 800 }}>
              {t("print.quote.subtotal", { yen: formatYen(derived.quote.subtotalYen), vol: formatMm(derived.quote.volumeCm3, 1) })}
            </div>

            {totals && (
              <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 800 }}>
                {totals.ship != null && totals.total != null ? (
                  <>
                    {t("print.quote.shippingLabel")}: <b>{formatYen(totals.ship)}¥</b> ／ {t("print.quote.totalLabel")}: <b>{formatYen(totals.total)}¥</b>
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
                  <>{t("print.quote.shippingPending")}</>
                )}
              </div>
            )}

            {shippingEstimate && !shippingEstimate.ok && (
              <div style={{ fontSize: 12, color: "#b45309", fontWeight: 800 }}>
                {t("print.shipping.cannot", { reason: String(shippingEstimate.reason || "unknown") })}
              </div>
            )}

            <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>{t("print.note.rough")}</div>
            <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>{t("print.note.ticket")}</div>
          </div>
        </div>
      ) : (
        <div style={{ background: "#fff7ed", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12, padding: 12, marginBottom: 14 }}>
          {t("print.noDraft")}
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        <label>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t("print.field.name")}</div>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }} />
        </label>

        <label>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t("print.field.email")}</div>
          <input value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }} />
        </label>

        <label>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t("print.field.phone")}</div>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }} />
        </label>

        <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 12, background: "#fff" }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>{t("print.address.title")}</div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              placeholder={t("print.address.zipPlaceholder")}
              inputMode="numeric"
              style={{ width: 200, padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }}
            />
            <button
              type="button"
              onClick={lookupZip}
              disabled={zipBusy}
              style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.18)", background: zipBusy ? "#f3f4f6" : "#ecfccb", fontWeight: 900 }}
            >
              {zipBusy ? t("print.address.looking") : t("print.address.lookup")}
            </button>
            <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>{t("print.address.hint")}</div>
          </div>

          {zipError && <div style={{ marginTop: 8, color: "#b91c1c", fontWeight: 700 }}>{zipError}</div>}

          {zipCandidates.length > 0 && (
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              <label>
                <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 12, color: "#6b7280" }}>{t("print.address.results")}</div>
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
                <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 12, color: "#6b7280" }}>{t("print.address.line2")}</div>
                <input
                  value={addressLine2}
                  onChange={(e) => setAddressLine2(e.target.value)}
                  placeholder={t("print.address.line2Placeholder")}
                  style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }}
                />
              </label>

              <div style={{ fontSize: 12, color: "#6b7280" }}>
                {t("print.address.confirmed")} <b>{fullAddress.addr || "-"}</b>
              </div>
            </div>
          )}
        </div>

        <label>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t("print.field.ticket")}</div>
          <input
            value={ticketCode}
            onChange={(e) => setTicketCode(e.target.value)}
            placeholder={t("print.field.ticketPlaceholder")}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }}
          />
          <div style={{ marginTop: 4, fontSize: 12, color: "#6b7280" }}>{t("print.field.ticketHint")}</div>
        </label>

        <label>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t("print.field.notes")}</div>
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
          {t("print.btn.back")}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || Boolean(derived?.resolved.warnTooLarge)}
          style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.18)", background: busy ? "#f3f4f6" : "#ecfccb", fontWeight: 800 }}
        >
          {busy ? t("print.btn.submitting") : t("print.btn.submit")}
        </button>
      </div>

      <p style={{ marginTop: 12, color: "#6b7280", fontSize: 12 }}>{t("print.paymentNote")}</p>
    </div>
  );
}
