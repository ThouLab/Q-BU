"use client";

import React, { useEffect, useMemo, useState } from "react";

import PrintPrepViewer from "./PrintPrepViewer";
import { analyzePrintPrepSupport, suggestCompletionSupportBlocks } from "./printPrepUtils";
import { computeMixedBBox, expandBaseBlocksToSubCells, type SubKey } from "./subBlocks";
import {
  estimatePrintPriceYen,
  estimateSolidVolumeCm3,
  formatMm,
  formatYen,
  resolvePrintScale,
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
  const [supportBlocks, setSupportBlocks] = useState<Set<SubKey>>(new Set());

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

  // 初回オープン時に自動提案を入れる
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
    return estimatePrintPriceYen(volume);
  }, [baseBlocks.size, supportBlocks.size, resolvedScale.mmPerUnit]);

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
    ? "浮動するブロックはありません。"
    : `浮動するブロックがあります（${analysis.componentCount}パーツ）。`;

  const helpText = isReady
    ? "このまま印刷できます。"
    : "赤い部分が浮いています。青いブロックは自動補完（0.5サイズ）です（不要なら右クリックで削除、クリックで追加）。";

  return (
    <div className="prepOverlay" role="dialog" aria-modal="true">
      <div className="prepCard">
        <div className="prepHeader">
          <div>
            <div className="prepTitle">印刷用につなぎ目を補完</div>
            <div className="prepSub">
              {baseName} ／ {resolvedScale.mode === "maxSide" ? (
                <>最大辺 {formatMm(resolvedScale.maxSideMm, 0)}mm</>
              ) : (
                <>
                  1ブロック {formatMm(resolvedScale.mmPerUnit, 2)}mm（最大辺 {formatMm(resolvedScale.maxSideMm, 1)}mm）
                </>
              )}
            </div>
          </div>
          <button type="button" className="saveClose" onClick={onClose} aria-label="close">
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
                  <span style={{ fontSize: 12, fontWeight: 900, color: "#374151" }}>印刷サイズ</span>
                  <button
                    type="button"
                    className={`chip ${scaleMode === "maxSide" ? "active" : ""}`}
                    onClick={() => setScaleMode("maxSide")}
                  >
                    最長辺
                  </button>
                  <button
                    type="button"
                    className={`chip ${scaleMode === "blockEdge" ? "active" : ""}`}
                    onClick={() => setScaleMode("blockEdge")}
                  >
                    1ブロック
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
                      <div className="saveHint">mm（最長辺を {formatMm(resolvedScale.maxSideMm, 0)}mm に）</div>
                    </>
                  ) : (
                    <>
                      <input
                        className="saveNumber"
                        value={blockEdgeMmText}
                        onChange={(e) => setBlockEdgeMmText(e.target.value)}
                        inputMode="decimal"
                      />
                      <div className="saveHint">mm（1ブロック辺）→ 最大辺 {formatMm(resolvedScale.maxSideMm, 1)}mm</div>
                    </>
                  )}
                </div>

                {tooLarge && <div className="warnYellow">⚠ 最大辺が180mmを超えています（印刷依頼には大きすぎます）</div>}

                <div className="saveHint">
                  概算見積（送料別）: <b>{formatYen(quote.subtotalYen)}円</b> ／ 推定体積 {formatMm(quote.volumeCm3, 1)}cm³
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
                自動補完
              </button>

              <button type="button" className="saveBtn" onClick={() => setSupportBlocks(new Set())}>
                補完を消す
              </button>

              {isReady && (
                <button
                  type="button"
                  className="saveBtn primary"
                  onClick={() => onExport(baseName, finalSetting, baseBlocks, supportBlocks)}
                >
                  書き出す（STL）
                </button>
              )}

              {isReady && onRequestPrint && (
                <button
                  type="button"
                  className="saveBtn"
                  disabled={tooLarge}
                  onClick={() => onRequestPrint(baseName, finalSetting, baseBlocks, supportBlocks)}
                  title={tooLarge ? "最大辺が180mmを超えるため、印刷依頼できません" : ""}
                >
                  印刷を依頼する
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
