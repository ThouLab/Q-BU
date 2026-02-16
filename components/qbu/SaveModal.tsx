"use client";

import React, { useEffect, useMemo, useState } from "react";

import { formatMm, resolvePrintScale, type PrintScaleSetting } from "./printScale";

type Method = "project" | "stl";

function sanitizeBaseName(input: string): string {
  const raw = (input || "").trim();
  // ファイル名として危険/面倒な文字を落とす（OS差分回避）
  const cleaned = raw
    .replace(/[\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 40)
    .trim();
  return cleaned || "Q-BU";
}

type Props = {
  open: boolean;
  onClose: () => void;

  maxDim: number;
  defaultTargetMm: number;

  /** 保存モーダルを開いたときに入れる初期名（ギャラリーから開いた場合など） */
  initialName?: string;
  /** 既存モデルを編集中かどうか（上書き/新規保存のUIに使用） */
  existingModelId?: string | null;

  /** Builder側の保存状態 */
  saving?: boolean;
  /** Builder側の保存メッセージ */
  statusText?: string | null;
  /** Builder側のエラーメッセージ */
  errorText?: string | null;

  onSaveProject: (
    baseName: string,
    opts?: {
      /** ローカルへ .qbu を同時に書き出す */
      downloadLocal?: boolean;
      /** 既存モデル編集中に「新規として保存」 */
      asNew?: boolean;
    }
  ) => Promise<void> | void;

  onExportStl: (baseName: string, setting: PrintScaleSetting) => void;
  onOpenPrintPrep: (baseName: string, setting: PrintScaleSetting) => void;
};

export default function SaveModal({
  open,
  onClose,
  maxDim,
  defaultTargetMm,
  initialName,
  existingModelId,
  saving,
  statusText,
  errorText,
  onSaveProject,
  onExportStl,
  onOpenPrintPrep,
}: Props) {
  const [baseName, setBaseName] = useState("Q-BU");
  const [method, setMethod] = useState<Method>("project");
  const [downloadLocal, setDownloadLocal] = useState(false);
  const [asNew, setAsNew] = useState(false);
  const [scaleMode, setScaleMode] = useState<PrintScaleSetting["mode"]>("maxSide");
  const [targetMmText, setTargetMmText] = useState(String(defaultTargetMm));
  const [blockEdgeMmText, setBlockEdgeMmText] = useState("1");

  const busy = Boolean(saving);

  useEffect(() => {
    if (!open) return;
    // 開くたびに分かりやすい初期値
    setBaseName(initialName && String(initialName).trim() ? String(initialName).trim() : "Q-BU");
    setMethod("project");
    setDownloadLocal(false);
    setAsNew(false);
    setScaleMode("maxSide");
    setTargetMmText(String(defaultTargetMm));
    setBlockEdgeMmText("1");
  }, [open, defaultTargetMm, initialName]);

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
        if (busy) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="saveCard">
        <div className="saveHeader">
          <div className="saveTitle">保存</div>
          <button type="button" className="saveClose" onClick={onClose} aria-label="閉じる" disabled={busy}>
            ✕
          </button>
        </div>

        <div className="saveBody">
          {errorText ? <div className="warnYellow">⚠ {errorText}</div> : null}
          {statusText ? <div className="saveHint">{statusText}</div> : null}

          <div className="saveSection">
            <div className="saveLabel">名前</div>
            <input
              className="saveInput"
              value={baseName}
              onChange={(e) => setBaseName(e.target.value)}
              placeholder="Q-BU"
              autoComplete="off"
              disabled={busy}
            />
          </div>

          <div className="saveSection">
            <div className="saveLabel">方法</div>

            <div
              className={`saveOption ${method === "project" ? "active" : ""}`}
              onClick={() => !busy && setMethod("project")}
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
              onClick={() => !busy && setMethod("stl")}
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
              <div className="saveLabel">保存先</div>
              <div className="saveHint">
                MyQ-BUModels（クラウド）に保存します。
                <br />
                ※ v1.0.16 から新規の JSON 保存は廃止し、.qbu 形式に統一します。
              </div>

              {existingModelId ? (
                <div className="saveRow" style={{ alignItems: "flex-start" }}>
                  <input type="checkbox" checked={asNew} onChange={(e) => setAsNew(e.target.checked)} disabled={busy} />
                  <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(11,15,24,.72)", lineHeight: 1.35 }}>
                    新規として保存（コピー）
                    <div className="saveHint" style={{ marginTop: 2 }}>
                      OFFの場合は上書き保存になります。
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="saveLabel" style={{ marginTop: 6 }}>
                ローカル書き出し（任意）
              </div>
              <div className="saveRow" style={{ alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={downloadLocal}
                  onChange={(e) => setDownloadLocal(e.target.checked)}
                  disabled={busy}
                />
                <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(11,15,24,.72)", lineHeight: 1.35 }}>
                  .qbu をローカルにも書き出す
                  <div className="saveHint" style={{ marginTop: 2 }}>外部共有やバックアップ用途。</div>
                </div>
              </div>

              {downloadLocal ? <div className="saveHint">※ v1.0.16 以降、書き出し時のパスワード指定は廃止しました。</div> : null}
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
                  disabled={busy}
                >
                  最長辺
                </button>
                <button
                  type="button"
                  className={`chip ${scaleMode === "blockEdge" ? "active" : ""}`}
                  onClick={() => setScaleMode("blockEdge")}
                  disabled={busy}
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
                      disabled={busy}
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
                      disabled={busy}
                    />
                    <div className="saveHint">mm（1ブロック辺）→ 最大辺 {formatMm(resolved.maxSideMm, 1)}mm</div>
                  </>
                )}
              </div>
              <div className="saveHint">
                現在のモデル：最大 <b>{Math.round(scaleHint.dim)}</b> ブロック ／ 1ブロック辺 <b>{formatMm(scaleHint.blockEdgeMm, 2)}mm</b>
              </div>

              {resolved.warnTooLarge && <div className="warnYellow">⚠ 最大辺が180mmを超えています（印刷依頼には大きすぎます）</div>}
            </div>
          )}
        </div>

        <div className="saveActions">
          <button type="button" className="saveBtn" onClick={onClose} disabled={busy}>
            キャンセル
          </button>

          {method === "project" ? (
            <button
              type="button"
              className="saveBtn primary"
              disabled={busy}
              onClick={() =>
                void onSaveProject(safeName, {
                  downloadLocal,
                  asNew,
                })
              }
            >
              {busy ? "保存中..." : "保存"}
            </button>
          ) : (
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" className="saveBtn" onClick={() => onExportStl(safeName, finalSetting)} disabled={busy}>
                STLを書き出す
              </button>
              <button
                type="button"
                className="saveBtn primary"
                onClick={() => onOpenPrintPrep(safeName, finalSetting)}
                disabled={busy}
              >
                印刷用にSTLを書き出す
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
