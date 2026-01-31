"use client";

import React, { useEffect, useMemo, useState } from "react";

type Method = "project" | "stl";

function sanitizeBaseName(input: string): string {
  const raw = (input || "").trim();
  // ファイル名として危険/面倒な文字を落とす（OS差分回避）
  const cleaned = raw
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 40)
    .trim();
  return cleaned || "Q-BU";
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

type Props = {
  open: boolean;
  onClose: () => void;

  maxDim: number;
  defaultTargetMm: number;

  onSaveProject: (baseName: string) => void;
  onExportStl: (baseName: string, targetMm: number) => void;
  onOpenPrintPrep: (baseName: string, targetMm: number) => void;
};

export default function SaveModal({
  open,
  onClose,
  maxDim,
  defaultTargetMm,
  onSaveProject,
  onExportStl,
  onOpenPrintPrep,
}: Props) {
  const [baseName, setBaseName] = useState("Q-BU");
  const [method, setMethod] = useState<Method>("project");
  const [targetMmText, setTargetMmText] = useState(String(defaultTargetMm));

  useEffect(() => {
    if (!open) return;
    // 開くたびに分かりやすい初期値
    setBaseName("Q-BU");
    setMethod("project");
    setTargetMmText(String(defaultTargetMm));
  }, [open, defaultTargetMm]);

  const safeName = useMemo(() => sanitizeBaseName(baseName), [baseName]);

  const targetMm = useMemo(() => {
    const n = Number(targetMmText);
    if (!Number.isFinite(n)) return defaultTargetMm;
    return clamp(Math.round(n), 10, 300);
  }, [targetMmText, defaultTargetMm]);

  const scaleHint = useMemo(() => {
    const dim = Math.max(1, maxDim || 1);
    const s = targetMm / dim;
    return { dim, s };
  }, [maxDim, targetMm]);

  if (!open) return null;

  return (
    <div
      className="saveOverlay"
      role="dialog"
      aria-modal="true"
      aria-label="保存"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="saveCard">
        <div className="saveHeader">
          <div className="saveTitle">保存</div>
          <button type="button" className="saveClose" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>

        <div className="saveBody">
          <div className="saveSection">
            <div className="saveLabel">名前</div>
            <input
              className="saveInput"
              value={baseName}
              onChange={(e) => setBaseName(e.target.value)}
              placeholder="Q-BU"
              autoComplete="off"
            />
          </div>

          <div className="saveSection">
            <div className="saveLabel">方法</div>

            <div
              className={`saveOption ${method === "project" ? "active" : ""}`}
              onClick={() => setMethod("project")}
              role="button"
              tabIndex={0}
            >
              <input type="radio" checked={method === "project"} readOnly />
              <div>
                <div className="saveOptionTitle">プロジェクト</div>
                <div className="saveOptionDesc">あとで続きから編集できます</div>
              </div>
            </div>

            <div
              className={`saveOption ${method === "stl" ? "active" : ""}`}
              onClick={() => setMethod("stl")}
              role="button"
              tabIndex={0}
            >
              <input type="radio" checked={method === "stl"} readOnly />
              <div>
                <div className="saveOptionTitle">STL</div>
                <div className="saveOptionDesc">3Dプリント用に書き出し</div>
              </div>
            </div>
          </div>

          {method === "stl" && (
            <div className="saveSection">
              <div className="saveLabel">サイズ</div>
              <div className="saveRow">
                <input
                  className="saveNumber"
                  value={targetMmText}
                  onChange={(e) => setTargetMmText(e.target.value)}
                  inputMode="numeric"
                />
                <div className="saveHint">mm（最長辺を {targetMm}mm に）</div>
              </div>
              <div className="saveHint">
                現在のモデル：最大 <b>{Math.round(scaleHint.dim)}</b> ブロック → 出力スケール <b>×{scaleHint.s.toFixed(2)}</b>
              </div>
            </div>
          )}
        </div>

        <div className="saveActions">
          <button type="button" className="saveBtn" onClick={onClose}>
            キャンセル
          </button>

          {method === "project" ? (
            <button type="button" className="saveBtn primary" onClick={() => onSaveProject(safeName)}>
              保存
            </button>
          ) : (
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" className="saveBtn" onClick={() => onExportStl(safeName, targetMm)}>
                STLを書き出す
              </button>
              <button type="button" className="saveBtn primary" onClick={() => onOpenPrintPrep(safeName, targetMm)}>
                印刷用にSTLを書き出す
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
