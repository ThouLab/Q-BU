"use client";

import React, { useEffect, useMemo, useState } from "react";

import { computeMixedBBox } from "@/components/qbu/subBlocks";
import {
  estimatePrintPriceYen,
  estimateSolidVolumeCm3,
  formatMm,
  formatYen,
  resolvePrintScale,
  type PrintScaleSetting,
} from "@/components/qbu/printScale";

type PrintDraft = {
  baseName: string;
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

export default function PrintPage() {
  const [draft, setDraft] = useState<PrintDraft | null>(null);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PRINT_DRAFT_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return;
      if (!Array.isArray(obj.blocks)) return;

      const baseName = typeof obj.baseName === "string" ? obj.baseName : "Q-BU";
      const targetMm = typeof obj.targetMm === "number" ? obj.targetMm : 50;

      const scaleSetting: PrintScaleSetting = (() => {
        const s = (obj as any).scaleSetting;
        if (s && typeof s === "object") {
          if (s.mode === "maxSide" && typeof s.maxSideMm === "number") {
            return { mode: "maxSide", maxSideMm: s.maxSideMm };
          }
          if (s.mode === "blockEdge" && typeof s.blockEdgeMm === "number") {
            return { mode: "blockEdge", blockEdgeMm: s.blockEdgeMm };
          }
        }
        // fallback (legacy)
        return { mode: "maxSide", maxSideMm: targetMm };
      })();

      const supportBlocks: string[] = Array.isArray((obj as any).supportBlocks)
        ? (obj as any).supportBlocks.filter((x: any) => typeof x === "string")
        : [];

      setDraft({
        baseName,
        targetMm,
        scaleSetting,
        blocks: obj.blocks.filter((x: any) => typeof x === "string"),
        supportBlocks,
        created_at: typeof obj.created_at === "number" ? obj.created_at : Date.now(),
      });
    } catch {
      // ignore
    }
  }, []);

  const derived = useMemo(() => {
    if (!draft) return null;
    const baseSet = new Set(draft.blocks);
    const supportSet = new Set(draft.supportBlocks);
    const bbox = computeMixedBBox(baseSet, supportSet);
    const resolved = resolvePrintScale({
      bboxMaxDimWorld: bbox.maxDim,
      setting: draft.scaleSetting,
      clampMaxSideMm: { min: 10, max: 300 },
      clampBlockEdgeMm: { min: 0.1, max: 500 },
    });
    const volume = estimateSolidVolumeCm3({
      baseBlockCount: baseSet.size,
      supportBlockCount: supportSet.size,
      mmPerUnit: resolved.mmPerUnit,
    });
    const quote = estimatePrintPriceYen(volume);
    return {
      baseCount: baseSet.size,
      supportCount: supportSet.size,
      bbox,
      resolved,
      quote,
    };
  }, [draft]);

  const summary = useMemo(() => {
    if (!draft || !derived) return "";
    const sizeText =
      derived.resolved.mode === "maxSide"
        ? `最大辺 ${formatMm(derived.resolved.maxSideMm, 0)}mm（1ブロック辺 ${formatMm(
            derived.resolved.mmPerUnit,
            2
          )}mm）`
        : `1ブロック辺 ${formatMm(derived.resolved.mmPerUnit, 2)}mm（最大辺 ${formatMm(
            derived.resolved.maxSideMm,
            1
          )}mm）`;
    return `モデル: ${draft.baseName} / ブロック数: ${derived.baseCount}（補完 ${derived.supportCount}） / サイズ: ${sizeText}`;
  }, [draft, derived]);

  const submit = async () => {
    setError("");
    if (!draft) {
      setError("印刷データがありません。エディターに戻って『印刷用にSTLを書き出す』から進んでください。");
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
    if (!address.trim()) {
      setError("配送先住所を入力してください。");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/print/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draft,
          customer: {
            name: name.trim(),
            email: email.trim(),
            phone: phone.trim(),
            address: address.trim(),
            notes: notes.trim(),
          },
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || "checkout_failed");
      }
      const data = await res.json();
      if (data?.url && typeof data.url === "string") {
        window.location.href = data.url;
        return;
      }
      throw new Error("checkout_url_missing");
    } catch (e: any) {
      setError(e?.message || "決済の開始に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 18, maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 6 }}>印刷を依頼する</h1>
      <p style={{ marginTop: 0, color: "#6b7280" }}>
        ここで連絡先と配送先を入力し、Google Payでお支払いします。
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
                概算見積（送料別）: <b>{formatYen(derived.quote.subtotalYen)}円</b> ／ 推定体積 {formatMm(
                  derived.quote.volumeCm3,
                  1
                )}
                cm³
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>
                ※概算です（造形方式・材料・肉厚・充填率で変動します）
              </div>
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

        <label>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>配送先住所</div>
          <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={3} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }} />
        </label>

        <label>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>備考（任意）</div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.18)" }} />
        </label>
      </div>

      {error && (
        <div style={{ marginTop: 12, color: "#b91c1c", fontWeight: 600, whiteSpace: "pre-wrap" }}>{error}</div>
      )}

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
          {busy ? "準備中..." : "Google Payで支払う"}
        </button>
      </div>

      <p style={{ marginTop: 12, color: "#6b7280", fontSize: 12 }}>
        ※決済連携（Stripe/Google Pay）と管理者通知（メール送信）はサーバー側の設定が必要です。
      </p>
    </div>
  );
}
