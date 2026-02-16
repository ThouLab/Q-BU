"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { base64ToBytes, formatDateTimeJa } from "./myModelsUtils";

type ModelRow = {
  id: string;
  name: string;
  updated_at: string;
  created_at?: string;
  thumb_data_url: string | null;
  block_count?: number | null;
  support_block_count?: number | null;
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sanitizeFileName(name: string): string {
  const raw = (name || "").trim();
  const cleaned = raw
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 60)
    .trim();
  return cleaned || "Q-BU";
}

type Props = {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient | null;
  currentModelId?: string | null;
  onOpenModel: (id: string) => Promise<void> | void;
  onDeletedCurrent?: () => void;
};

export default function MyModelsModal({ open, onClose, supabase, currentModelId, onOpenModel, onDeletedCurrent }: Props) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ModelRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const qq = (q || "").trim().toLowerCase();
    if (!qq) return rows;
    return rows.filter((r) => String(r.name || "").toLowerCase().includes(qq));
  }, [rows, q]);

  const refresh = async () => {
    if (!supabase) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await supabase
        .from("user_models")
        .select("id,name,updated_at,created_at,thumb_data_url,block_count,support_block_count")
        .order("updated_at", { ascending: false })
        .limit(200);

      if (res.error) {
        setError(res.error.message || "failed_to_load");
        setRows([]);
        return;
      }
      setRows((res.data as any[]) as ModelRow[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, Boolean(supabase)]);

  const onRename = async (row: ModelRow) => {
    if (!supabase) return;
    const next = window.prompt("プロジェクト名を変更", row.name || "")?.trim() || "";
    if (!next) return;
    setLoading(true);
    setError(null);
    try {
      const res = await supabase
        .from("user_models")
        .update({ name: next, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (res.error) {
        setError(res.error.message || "rename_failed");
        return;
      }
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const onDelete = async (row: ModelRow) => {
    if (!supabase) return;
    const ok = window.confirm(`「${row.name || "(無名)"}」を削除しますか？\n※この操作は取り消せません。`);
    if (!ok) return;
    setLoading(true);
    setError(null);
    try {
      const res = await supabase.from("user_models").delete().eq("id", row.id);
      if (res.error) {
        setError(res.error.message || "delete_failed");
        return;
      }
      if (row.id && currentModelId && row.id === currentModelId) {
        onDeletedCurrent?.();
      }
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const onDownload = async (row: ModelRow) => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      const res = await supabase.from("user_models").select("qbu_base64").eq("id", row.id).single();
      if (res.error || !res.data) {
        setError(res.error?.message || "download_failed");
        return;
      }
      const b64 = (res.data as any).qbu_base64 as string;
      const bytes = base64ToBytes(b64);
      downloadBlob(new Blob([bytes as any], { type: "application/octet-stream" }), `${sanitizeFileName(row.name)}.qbu`);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="saveOverlay"
      role="dialog"
      aria-modal="true"
      aria-label="MyQ-BUModels"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="saveCard" style={{ width: "min(920px, 96vw)", maxHeight: "90vh", overflow: "hidden" }}>
        <div className="saveHeader">
          <div className="saveTitle">MyQ-BUModels</div>
          <button type="button" className="saveClose" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>

        <div className="saveBody" style={{ marginTop: 10, overflow: "auto", paddingRight: 2 }}>
          {!supabase ? (
            <div className="saveHint">クラウド保存が未設定です（NEXT_PUBLIC_SUPABASE_* を確認してください）。</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  className="saveInput"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="検索（プロジェクト名）"
                  autoComplete="off"
                  style={{ flex: "1 1 260px" }}
                />
                <button type="button" className="saveBtn" onClick={() => void refresh()} disabled={loading}>
                  更新
                </button>
              </div>

              {error ? <div className="warnYellow">⚠ {error}</div> : null}

              {loading ? <div className="saveHint">読み込み中...</div> : null}

              {filtered.length === 0 && !loading ? <div className="saveHint">保存済みプロジェクトはまだありません。</div> : null}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                  gap: 12,
                  marginTop: 10,
                }}
              >
                {filtered.map((r) => {
                  const isCurrent = Boolean(currentModelId && r.id === currentModelId);
                  return (
                    <div
                      key={r.id}
                      style={{
                        border: "1px solid rgba(11,15,24,.12)",
                        borderRadius: 14,
                        padding: 10,
                        background: isCurrent ? "rgba(16,185,129,.10)" : "rgba(255,255,255,.72)",
                        display: "grid",
                        gridTemplateColumns: "72px 1fr",
                        gap: 10,
                        alignItems: "center",
                      }}
                    >
                      <div
                        style={{
                          width: 72,
                          height: 72,
                          borderRadius: 12,
                          border: "1px solid rgba(11,15,24,.12)",
                          overflow: "hidden",
                          background: "#f7f8fb",
                          display: "grid",
                          placeItems: "center",
                        }}
                      >
                        {r.thumb_data_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.thumb_data_url} alt={r.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(11,15,24,.45)" }}>No Thumb</div>
                        )}
                      </div>

                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "baseline", justifyContent: "space-between" }}>
                          <div style={{ fontSize: 13, fontWeight: 1000, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {r.name || "(無名)"}
                          </div>
                          {isCurrent ? (
                            <div style={{ fontSize: 11, fontWeight: 1000, color: "rgba(5,150,105,.95)" }}>編集中</div>
                          ) : null}
                        </div>
                        <div className="saveHint" style={{ marginTop: 3 }}>
                          最終編集: <b>{formatDateTimeJa(r.updated_at)}</b>
                          {(r.block_count || 0) > 0 ? (
                            <>
                              <br />
                              blocks: {Math.max(0, Number(r.block_count) || 0)}
                            </>
                          ) : null}
                        </div>

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", marginTop: 8 }}>
                          <button
                            type="button"
                            className="saveBtn primary"
                            onClick={() => void onOpenModel(r.id)}
                            disabled={loading}
                          >
                            開く
                          </button>
                          <button type="button" className="saveBtn" onClick={() => void onDownload(r)} disabled={loading}>
                            書き出し
                          </button>
                          <button type="button" className="saveBtn" onClick={() => void onRename(r)} disabled={loading}>
                            名称変更
                          </button>
                          <button type="button" className="saveBtn" onClick={() => void onDelete(r)} disabled={loading}>
                            削除
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="saveActions">
          <button type="button" className="saveBtn" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
