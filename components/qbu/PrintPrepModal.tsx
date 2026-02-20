"use client";

import React, { useEffect, useMemo, useState } from "react";

import { useI18n } from "@/components/i18n/I18nProvider";

import PrintPrepViewer from "./PrintPrepViewer";
import { analyzePrintPrepSupport, suggestCompletionSupportBlocks } from "./printPrepUtils";
import { computeMixedBBox, expandBaseBlocksToSubCells, type SubKey } from "./subBlocks";
import {
  estimatePrintPriceYen,
  estimateSolidVolumeCm3,
  formatMm,
  formatYen,
  resolvePrintScale,
  type PricingParams,
  type PrintScaleSetting,
} from "./printScale";

export type PrintPrepModalProps = {
  open: boolean;
  baseName: string;
  /** Print scale setting (max side OR per-block edge) */
  scaleSetting: PrintScaleSetting;
  baseBlocks: Set<string>;
  onClose: () => void;
  onExport: (baseName: string, setting: PrintScaleSetting, baseBlocks: Set<string>, supportBlocks: Set<SubKey>) => void;
  onRequestPrint?: (baseName: string, setting: PrintScaleSetting, baseBlocks: Set<string>, supportBlocks: Set<SubKey>) => void;
};

export default function PrintPrepModal({
  open,
  baseName,
  scaleSetting,
  baseBlocks,
  onClose,
  onExport,
  onRequestPrint,
}: PrintPrepModalProps) {
  const { t } = useI18n();
  const [supportBlocks, setSupportBlocks] = useState<Set<SubKey>>(new Set());

  // Active pricing (v1.0.15-γ)
  const [pricing, setPricing] = useState<Partial<PricingParams> | null>(null);

  // Local editable scale setting (UI)
  const [scaleMode, setScaleMode] = useState<PrintScaleSetting["mode"]>(scaleSetting.mode);
  const [maxSideMmText, setMaxSideMmText] = useState(
    scaleSetting.mode === "maxSide" ? String(scaleSetting.maxSideMm) : "50"
  );
  const [blockEdgeMmText, setBlockEdgeMmText] = useState(
    scaleSetting.mode === "blockEdge" ? String(scaleSetting.blockEdgeMm) : "1"
  );

  // base blocks occupy 8 sub-cells each; used to prevent placing supports inside bases
  const baseSubCells = useMemo(() => expandBaseBlocksToSubCells(baseBlocks), [baseBlocks]);

  // 初回オープン時に自動提案を入れる + UI初期化
  useEffect(() => {
    if (!open) return;
    const suggested = suggestCompletionSupportBlocks(baseBlocks);
    setSupportBlocks(suggested);

    // reset scale UI each open
    setScaleMode(scaleSetting.mode);
    if (scaleSetting.mode === "maxSide") {
      setMaxSideMmText(String(scaleSetting.maxSideMm));
      setBlockEdgeMmText("1");
    } else {
      setBlockEdgeMmText(String(scaleSetting.blockEdgeMm));
      setMaxSideMmText("50");
    }
  }, [open, baseBlocks, scaleSetting]);

  // Load active pricing (public API; falls back to defaults if not configured)
  useEffect(() => {
    if (!open) return;
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
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  const analysis = useMemo(() => {
    return analyzePrintPrepSupport(baseBlocks, supportBlocks);
  }, [baseBlocks, supportBlocks]);

  const isReady = analysis.componentCount <= 1;

  const mixedBBox = useMemo(() => computeMixedBBox(baseBlocks, supportBlocks), [baseBlocks, supportBlocks]);

  const resolvedScale = useMemo(() => {
    const maxSideRaw = Number(maxSideMmText);
    const edgeRaw = Number(blockEdgeMmText);
    const setting: PrintScaleSetting =
      scaleMode === "maxSide"
        ? { mode: "maxSide", maxSideMm: Number.isFinite(maxSideRaw) ? maxSideRaw : 50 }
        : { mode: "blockEdge", blockEdgeMm: Number.isFinite(edgeRaw) ? edgeRaw : 1 };

    return resolvePrintScale({
      bboxMaxDimWorld: mixedBBox.maxDim,
      setting,
      clampMaxSideMm: { min: 10, max: 300 },
      clampBlockEdgeMm: { min: 0.1, max: 500 },
    });
  }, [mixedBBox.maxDim, scaleMode, maxSideMmText, blockEdgeMmText]);

  const finalSetting: PrintScaleSetting = useMemo(() => {
    return resolvedScale.mode === "maxSide"
      ? { mode: "maxSide", maxSideMm: resolvedScale.maxSideMm }
      : { mode: "blockEdge", blockEdgeMm: resolvedScale.mmPerUnit };
  }, [resolvedScale]);

  const quote = useMemo(() => {
    const volume = estimateSolidVolumeCm3({
      baseBlockCount: baseBlocks.size,
      supportBlockCount: supportBlocks.size,
      mmPerUnit: resolvedScale.mmPerUnit,
    });
    return estimatePrintPriceYen(volume, pricing || undefined);
  }, [baseBlocks.size, supportBlocks.size, resolvedScale.mmPerUnit, pricing]);

  function addSupport(sk: SubKey) {
    if (baseSubCells.has(sk)) return; // base volume is not editable
    setSupportBlocks((prev) => {
      if (prev.has(sk)) return prev;
      const next = new Set(prev);
      next.add(sk);
      return next;
    });
  }

  function removeSupport(sk: SubKey) {
    setSupportBlocks((prev) => {
      if (!prev.has(sk)) return prev;
      const next = new Set(prev);
      next.delete(sk);
      return next;
    });
  }

  if (!open) return null;

  const tooLarge = resolvedScale.warnTooLarge;

  const statusText = isReady
    ? t("printprep.status.ready")
    : t("printprep.status.floating", { n: analysis.componentCount });

  const helpText = isReady ? t("printprep.help.ready") : t("printprep.help.floating");

  return (
    <div className="prepOverlay" role="dialog" aria-modal="true">
      <div className="prepCard">
        <div className="prepHeader">
          <div>
            <div className="prepTitle">{t("printprep.title")}</div>
            <div className="prepSub">
              {baseName} ／{" "}
              {resolvedScale.mode === "maxSide" ? (
                <>{t("printprep.sub.maxSide", { mm: formatMm(resolvedScale.maxSideMm, 0) })}</>
              ) : (
                <>
                  {t("printprep.sub.blockEdge", {
                    mm: formatMm(resolvedScale.mmPerUnit, 2),
                    max: formatMm(resolvedScale.maxSideMm, 1),
                  })}
                </>
              )}
            </div>
          </div>
          <button type="button" className="saveClose" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </div>

        <div className="prepBody">
          <div className="prepViewer">
            <PrintPrepViewer
              baseBlocks={baseBlocks}
              supportBlocks={supportBlocks}
              floatingBase={analysis.floatingBaseBlocks}
              floatingSupport={analysis.floatingSupportBlocks}
              onAddSupport={addSupport}
              onRemoveSupport={removeSupport}
            />
          </div>

          <div className="prepFooter">
            <div className="prepStatus">
              <div className={isReady ? "prepOk" : "prepWarn"}>{statusText}</div>
              <div className="prepSub">{helpText}</div>

              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 900, color: "#374151" }}>{t("printprep.size")}</span>
                  <button
                    type="button"
                    className={`chip ${scaleMode === "maxSide" ? "active" : ""}`}
                    onClick={() => setScaleMode("maxSide")}
                  >
                    {t("save.size.maxSide")}
                  </button>
                  <button
                    type="button"
                    className={`chip ${scaleMode === "blockEdge" ? "active" : ""}`}
                    onClick={() => setScaleMode("blockEdge")}
                  >
                    {t("save.size.blockEdge")}
                  </button>
                </div>

                <div className="saveRow" style={{ flexWrap: "wrap" }}>
                  {scaleMode === "maxSide" ? (
                    <>
                      <input
                        className="saveNumber"
                        value={maxSideMmText}
                        onChange={(e) => setMaxSideMmText(e.target.value)}
                        inputMode="numeric"
                      />
                      <div className="saveHint">{t("save.size.mmMaxSide", { mm: formatMm(resolvedScale.maxSideMm, 0) })}</div>
                    </>
                  ) : (
                    <>
                      <input
                        className="saveNumber"
                        value={blockEdgeMmText}
                        onChange={(e) => setBlockEdgeMmText(e.target.value)}
                        inputMode="decimal"
                      />
                      <div className="saveHint">{t("save.size.mmBlock", { mm: formatMm(resolvedScale.maxSideMm, 1) })}</div>
                    </>
                  )}
                </div>

                {tooLarge && <div className="warnYellow">{t("save.warn.tooLarge")}</div>}

                <div className="saveHint">
                  {t("printprep.quote", { yen: formatYen(quote.subtotalYen), vol: formatMm(quote.volumeCm3, 1) })}
                </div>
              </div>
            </div>

            <div className="prepActions">
              <button
                type="button"
                className="saveBtn"
                onClick={() => {
                  const suggested = suggestCompletionSupportBlocks(baseBlocks);
                  setSupportBlocks(suggested);
                }}
              >
                {t("printprep.auto")}
              </button>

              <button type="button" className="saveBtn" onClick={() => setSupportBlocks(new Set())}>
                {t("printprep.clear")}
              </button>

              {isReady && (
                <button
                  type="button"
                  className="saveBtn primary"
                  onClick={() => onExport(baseName, finalSetting, baseBlocks, supportBlocks)}
                >
                  {t("printprep.exportStl")}
                </button>
              )}

              {isReady && onRequestPrint && (
                <button
                  type="button"
                  className="saveBtn"
                  disabled={tooLarge}
                  onClick={() => onRequestPrint(baseName, finalSetting, baseBlocks, supportBlocks)}
                  title={tooLarge ? t("printprep.requestDisabled") : ""}
                >
                  {t("printprep.request")}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
