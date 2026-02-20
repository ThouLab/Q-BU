"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import { DEFAULT_BLOCK_COLOR } from "@/components/qbu/filamentColors";

type ModPanelProps = {
  open: boolean;
  onClose: () => void;
  blocks: Set<string>;
  blockColors: Map<string, string>;
  onApply: (next: { blocks: string[]; colors: string[] }) => void;
};

type WorkerMsg =
  | { type: "status"; message: string }
  | { type: "ready" }
  | { type: "result"; ok: boolean; payload?: { blocks: string[]; colors: string[] }; stdout?: string; stderr?: string; error?: string };

const EXAMPLES: { id: string; name: string; code: string }[] = [
  {
    id: "mirror_x",
    name: "ミラー（X軸）",
    code: `# 例: X軸ミラー（左右対称を作る）\nfrom qbu import Mirror\n\n# 0 を中心に左右反転コピー\nMirror(axis="x", about=0).apply(model)\n`,
  },
  {
    id: "box",
    name: "箱（中空）+ チェッカーペイント",
    code: `# 例: 図形生成 + パターンペイント\nfrom qbu import Box, CheckerPaint\n\nmodel.clear(keep_origin=False)\n\n# (x0,y0,z0)〜(x1,y1,z1) の箱\nBox(-6, 0, -6, 6, 8, 6, color="#9AA0A6", hollow=True).apply(model)\n\n# チェッカーで塗り分け\nCheckerPaint(color_a="#F6C90E", color_b="#1F1F1F", period=1, axes=("x","z")).apply(model)\n`,
  },
  {
    id: "sphere",
    name: "球（ソリッド）",
    code: `# 例: 球を作る\nfrom qbu import Sphere\n\nmodel.clear(keep_origin=False)\nSphere(center=(0, 0, 0), radius=6, color="#1E6BF1", hollow=False).apply(model)\n`,
  },
];

export default function ModPanel({ open, onClose, blocks, blockColors, onApply }: ModPanelProps) {
  const workerRef = useRef<Worker | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [stdout, setStdout] = useState<string>("");
  const [stderr, setStderr] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const [exampleId, setExampleId] = useState<string>(EXAMPLES[0]?.id || "mirror_x");
  const selectedExample = useMemo(() => EXAMPLES.find((e) => e.id === exampleId) || EXAMPLES[0], [exampleId]);
  const [code, setCode] = useState<string>(EXAMPLES[0]?.code || "");

  // Lazily create a persistent worker (kept even when the panel is closed).
  useEffect(() => {
    if (!open) return;
    if (workerRef.current) return;

    try {
      const w = new Worker("/qbu_mod_worker.js");
      workerRef.current = w;
      setStatus("Pyodide を起動しています...");
      setError(null);

      w.onmessage = (ev: MessageEvent<WorkerMsg>) => {
        const msg = ev.data;
        if (!msg || typeof msg !== "object" || !("type" in msg)) return;

        if (msg.type === "status") {
          setStatus(msg.message);
          return;
        }
        if (msg.type === "ready") {
          setReady(true);
          setStatus("準備OK");
          return;
        }
        if (msg.type === "result") {
          setBusy(false);
          setStdout(msg.stdout || "");
          setStderr(msg.stderr || "");
          setError(msg.ok ? null : msg.error || "実行に失敗しました");

          if (msg.ok && msg.payload?.blocks && msg.payload?.colors) {
            onApply({ blocks: msg.payload.blocks, colors: msg.payload.colors });
            setStatus(`適用しました（blocks: ${msg.payload.blocks.length.toLocaleString()}）`);
          }
          return;
        }
      };

      w.onerror = (e) => {
        setBusy(false);
        setError(e.message || "Worker error");
        setStatus(null);
      };

      w.postMessage({ type: "init" });
    } catch (e: any) {
      setError(String(e?.message || e));
      setStatus(null);
    }
  }, [open, onApply]);

  // terminate on unmount (usually never, but safe)
  useEffect(() => {
    return () => {
      try {
        workerRef.current?.terminate();
      } catch {
        // ignore
      }
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    // update editor content when example changes (but don't clobber user's edits if they already started typing)
    // MVP: always load selected example into the textarea.
    setCode(selectedExample?.code || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exampleId]);

  const run = () => {
    const w = workerRef.current;
    if (!w) {
      setError("Worker が起動していません");
      return;
    }

    setBusy(true);
    setError(null);
    setStdout("");
    setStderr("");
    setStatus("実行中...");

    // blocks/colors are aligned by the same order
    const base = Array.from(blocks);
    const colors = base.map((k) => blockColors.get(k) || DEFAULT_BLOCK_COLOR);

    w.postMessage({
      type: "run",
      code,
      blocks: base,
      colors,
      defaultColor: DEFAULT_BLOCK_COLOR,
    });
  };

  if (!open) return null;

  return (
    <div className="saveOverlay" role="dialog" aria-modal="true" aria-label="MOD">
      <div className="saveCard" style={{ maxWidth: 960, width: "min(960px, 96vw)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h3 style={{ margin: 0 }}>MOD（Python）</h3>
          <button type="button" className="saveBtn" onClick={onClose}>
            閉じる
          </button>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ fontSize: 12, opacity: 0.9 }}>
            例:
            <select
              value={exampleId}
              onChange={(e) => setExampleId(e.target.value)}
              style={{ marginLeft: 8, padding: "6px 8px", borderRadius: 8 }}
              disabled={busy}
            >
              {EXAMPLES.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name}
                </option>
              ))}
            </select>
          </label>

          <button type="button" className="saveBtn primary" onClick={run} disabled={!ready || busy}>
            {busy ? "実行中..." : "実行して適用"}
          </button>

          <div style={{ fontSize: 12, opacity: 0.85 }}>
            {ready ? "モデルは model 変数として渡されます" : "（初回はPyodideの起動に時間がかかります）"}
          </div>
        </div>

        {status && <div style={{ marginTop: 8, fontSize: 12, opacity: 0.9 }}>{status}</div>}
        {error && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#ef4444", whiteSpace: "pre-wrap" }}>{error}</div>
        )}

        <textarea
          className="saveTextarea"
          style={{ marginTop: 10, height: 280 }}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          disabled={busy}
        />

        {(stdout || stderr) && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>ログ</div>
            <pre
              style={{
                margin: 0,
                padding: 10,
                borderRadius: 10,
                background: "rgba(0,0,0,0.45)",
                color: "#e5e7eb",
                maxHeight: 220,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                fontSize: 12,
              }}
            >
              {stdout}
              {stderr ? `\n[stderr]\n${stderr}` : ""}
            </pre>
          </div>
        )}

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8, lineHeight: 1.6 }}>
          <div>使い方（MVP）:</div>
          <ul style={{ marginTop: 6, paddingLeft: 18 }}>
            <li>
              <code>model</code> は現在のブロック/色を読み込んだオブジェクトです。
            </li>
            <li>
              生成/編集して <code>実行して適用</code> を押すと、結果がエディタに反映されます。
            </li>
            <li>
              右クリック/長押しでスポイト（色取得）も可能です（エディタ側）。
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
