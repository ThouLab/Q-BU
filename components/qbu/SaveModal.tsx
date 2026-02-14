"use client";

import React, { useEffect, useMemo, useState } from "react";

import { formatMm, resolvePrintScale, type PrintScaleSetting } from "./printScale";

type Method = "project" | "stl";

type ProjectFormat = "json" | "qbu";

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

  onSaveProject: (baseName: string, opts?: { format?: ProjectFormat; password?: string }) => void;
  onExportStl: (baseName: string, setting: PrintScaleSetting) => void;
  onOpenPrintPrep: (baseName: string, setting: PrintScaleSetting) => void;
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
  const [projectFormat, setProjectFormat] = useState<ProjectFormat>("json");
  const [qbuPassword, setQbuPassword] = useState("");
  const [scaleMode, setScaleMode] = useState<PrintScaleSetting["mode"]>("maxSide");
  const [targetMmText, setTargetMmText] = useState(String(defaultTargetMm));
  const [blockEdgeMmText, setBlockEdgeMmText] = useState("1");

  useEffect(() => {
    if (!open) return;
    // 開くたびに分かりやすい初期値
    setBaseName("Q-BU");
    setMethod("project");
    setProjectFormat("json");
    setQbuPassword("");
    setScaleMode("maxSide");
    setTargetMmText(String(defaultTargetMm));
    setBlockEdgeMmText("1");
  }, [open, defaultTargetMm]);

  const safeName = useMemo(() => sanitizeBaseName(baseName), [baseName]);

  const resolved = useMemo(() => {
    const dim = Math.max(1e-6, maxDim || 1);
    const maxSideRaw = Number(targetMmText);
    const edgeRaw = Number(blockEdgeMmText);

    const setting: PrintScaleSetting =
      scaleMode === "maxSide"
        ? { mode: "maxSide", maxSideMm: Number.isFinite(maxSideRaw) ? maxSideRaw : defaultTargetMm }
        : { mode: "blockEdge", blockEdgeMm: Number.isFinite(edgeRaw) ? edgeRaw : 1 };

    return resolvePrintScale({
      bboxMaxDimWorld: dim,
      setting,
      clampMaxSideMm: { min: 10, max: 300 },
      clampBlockEdgeMm: { min: 0.1, max: 500 },
    });
  }, [maxDim, scaleMode, targetMmText, blockEdgeMmText, defaultTargetMm]);

  const finalSetting: PrintScaleSetting = useMemo(() => {
    return resolved.mode === "maxSide"
      ? { mode: "maxSide", maxSideMm: resolved.maxSideMm }
      : { mode: "blockEdge", blockEdgeMm: resolved.mmPerUnit };
  }, [resolved]);

  const scaleHint = useMemo(() => {
    const dim = Math.max(1, maxDim || 1);
    return { dim, blockEdgeMm: resolved.mmPerUnit };
  }, [maxDim, resolved.mmPerUnit]);

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

          {method === "project" && (
            <div className="saveSection">
              <div className="saveLabel">形式</div>

              <div className="saveRow" style={{ flexWrap: "wrap" }}>
                <button
                  type="button"
                  className={`chip ${projectFormat === "json" ? "active" : ""}`}
                  onClick={() => setProjectFormat("json")}
                >
                  JSON（互換）
                </button>
                <button
                  type="button"
                  className={`chip ${projectFormat === "qbu" ? "active" : ""}`}
                  onClick={() => setProjectFormat("qbu")}
                >
                  QBU（圧縮/暗号）
                </button>
              </div>

              {projectFormat === "qbu" ? (
                <>
                  <div className="saveHint">
                    .qbu は圧縮＋暗号化された保存形式です（他アプリでの読み込みを抑制できます）。
                  </div>
                  <div className="saveRow" style={{ flexWrap: "wrap" }}>
                    <input
                      className="saveInput"
                      value={qbuPassword}
                      onChange={(e) => setQbuPassword(e.target.value)}
                      placeholder="パスワード（任意）"
                      autoComplete="off"
                    />
                  </div>
                  <div className="saveHint">
                    ※未入力でも保存できます（軽い難読化）。秘密性が必要ならパスワードを設定してください。
                  </div>
                </>
              ) : (
                <div className="saveHint">.json で保存します（従来互換）。</div>
              )}
            </div>
          )}

          {method === "stl" && (
            <div className="saveSection">
              <div className="saveLabel">サイズ</div>

              <div className="saveRow" style={{ flexWrap: "wrap" }}>
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

              <div className="saveRow">
                {scaleMode === "maxSide" ? (
                  <>
                    <input
                      className="saveNumber"
                      value={targetMmText}
                      onChange={(e) => setTargetMmText(e.target.value)}
                      inputMode="numeric"
                    />
                    <div className="saveHint">mm（最長辺を {Math.round(resolved.maxSideMm)}mm に）</div>
                  </>
                ) : (
                  <>
                    <input
                      className="saveNumber"
                      value={blockEdgeMmText}
                      onChange={(e) => setBlockEdgeMmText(e.target.value)}
                      inputMode="decimal"
                    />
                    <div className="saveHint">
                      mm（1ブロック辺）→ 最大辺 {formatMm(resolved.maxSideMm, 1)}mm
                    </div>
                  </>
                )}
              </div>
              <div className="saveHint">
                現在のモデル：最大 <b>{Math.round(scaleHint.dim)}</b> ブロック ／ 1ブロック辺 <b>{formatMm(scaleHint.blockEdgeMm, 2)}mm</b>
              </div>

              {resolved.warnTooLarge && (
                <div className="warnYellow">⚠ 最大辺が180mmを超えています（印刷依頼には大きすぎます）</div>
              )}
            </div>
          )}
        </div>

        <div className="saveActions">
          <button type="button" className="saveBtn" onClick={onClose}>
            キャンセル
          </button>

          {method === "project" ? (
            <button
              type="button"
              className="saveBtn primary"
              onClick={() => onSaveProject(safeName, { format: projectFormat, password: qbuPassword })}
            >
              保存
            </button>
          ) : (
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" className="saveBtn" onClick={() => onExportStl(safeName, finalSetting)}>
                STLを書き出す
              </button>
              <button type="button" className="saveBtn primary" onClick={() => onOpenPrintPrep(safeName, finalSetting)}>
                印刷用にSTLを書き出す
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
