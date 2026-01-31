"use client";

import React, { useEffect, useMemo, useState } from "react";

import { keyOf, type Coord } from "./voxelUtils";
import PrintPrepViewer from "./PrintPrepViewer";
import { getConnectedComponents, suggestCompletionBlocks } from "./printPrepUtils";

function unionSets(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>(a);
  for (const k of b) out.add(k);
  return out;
}

export type PrintPrepModalProps = {
  open: boolean;
  baseName: string;
  targetMm: number;
  baseBlocks: Set<string>;
  onClose: () => void;
  onExport: (baseName: string, targetMm: number, blocksForExport: Set<string>) => void;
  onRequestPrint?: (baseName: string, targetMm: number, blocksForExport: Set<string>) => void;
};

export default function PrintPrepModal({
  open,
  baseName,
  targetMm,
  baseBlocks,
  onClose,
  onExport,
  onRequestPrint,
}: PrintPrepModalProps) {
  const [extraBlocks, setExtraBlocks] = useState<Set<string>>(new Set());

  // 初回オープン時に自動提案を入れる
  useEffect(() => {
    if (!open) return;
    const suggested = suggestCompletionBlocks(baseBlocks);
    setExtraBlocks(suggested);
  }, [open]);

  const analysis = useMemo(() => {
    const combined = unionSets(baseBlocks, extraBlocks);
    const comps = getConnectedComponents(combined);
    const main = comps.reduce((best, cur) => (cur.size > best.size ? cur : best), comps[0] ?? new Set<string>());

    const floating = new Set<string>();
    for (const comp of comps) {
      if (comp === main) continue;
      for (const k of comp) floating.add(k);
    }

    return {
      combined,
      componentCount: comps.length,
      floating,
    };
  }, [baseBlocks, extraBlocks]);

  const isReady = analysis.floating.size === 0;

  function addExtra(c: Coord) {
    const k = keyOf(c);
    if (baseBlocks.has(k)) return; // 元ブロックは編集不可
    setExtraBlocks((prev) => {
      const next = new Set(prev);
      next.add(k);
      return next;
    });
  }

  function removeExtra(c: Coord) {
    const k = keyOf(c);
    setExtraBlocks((prev) => {
      if (!prev.has(k)) return prev;
      const next = new Set(prev);
      next.delete(k);
      return next;
    });
  }

  if (!open) return null;

  const statusText = isReady
    ? "浮動するブロックはありません。"
    : `浮動するブロックがあります（${analysis.componentCount}パーツ）。`;

  const helpText = isReady
    ? "このまま印刷できます。"
    : "赤い部分が浮いています。青いブロックは自動補完です（不要なら右クリックで削除、クリックで追加）。";

  return (
    <div className="prepOverlay" role="dialog" aria-modal="true">
      <div className="prepCard">
        <div className="prepHeader">
          <div>
            <div className="prepTitle">印刷用につなぎ目を補完</div>
            <div className="prepSub">{baseName} ／ 最大辺 {targetMm}mm</div>
          </div>
          <button type="button" className="saveClose" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <div className="prepBody">
          <div className="prepViewer">
            <PrintPrepViewer
              baseBlocks={baseBlocks}
              extraBlocks={extraBlocks}
              floating={analysis.floating}
              onAddExtra={addExtra}
              onRemoveExtra={removeExtra}
            />
          </div>

          <div className="prepFooter">
            <div className="prepStatus">
              <div className={isReady ? "prepOk" : "prepWarn"}>{statusText}</div>
              <div className="prepSub">{helpText}</div>
            </div>

            <div className="prepActions">
              <button
                type="button"
                className="saveBtn"
                onClick={() => {
                  const suggested = suggestCompletionBlocks(baseBlocks);
                  setExtraBlocks(suggested);
                }}
              >
                自動補完
              </button>

              <button type="button" className="saveBtn" onClick={() => setExtraBlocks(new Set())}>
                補完を消す
              </button>

              {isReady && (
                <button type="button" className="saveBtn primary" onClick={() => onExport(baseName, targetMm, analysis.combined)}>
                  書き出す（STL）
                </button>
              )}

              {isReady && onRequestPrint && (
                <button type="button" className="saveBtn" onClick={() => onRequestPrint(baseName, targetMm, analysis.combined)}>
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
