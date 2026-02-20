"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth/AuthProvider";
import { useTelemetry } from "@/components/telemetry/TelemetryProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ensureParentGate } from "@/lib/parentGate";
import ModVoxelViewer from "@/components/qbu/ModVoxelViewer";
import { unpackQbu } from "@/components/qbu/qbuFile";
import { DEFAULT_BLOCK_COLOR } from "@/components/qbu/filamentColors";
import { base64ToBytes, formatDateTimeJa } from "@/components/qbu/myModelsUtils";
import { keyOf } from "@/components/qbu/voxelUtils";

type ModelRow = {
  id: string;
  name: string;
  updated_at?: string | null;
  created_at?: string | null;
  block_count?: number | null;
  thumb_data_url?: string | null;
  is_public?: boolean | null;
  published_at?: string | null;
};

const UI_MODE_KEY = "qbu_ui_mode_v1";
const OPEN_MODEL_KEY = "qbu_open_model_id_v1";
const OPEN_MODEL_COPY_KEY = "qbu_open_model_copy_v1";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    window.setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
      try {
        a.remove();
      } catch {
        // ignore
      }
    }, 0);
  }
}

function sanitizeFileName(name: string) {
  return String(name || "Q-BU")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\\/:*?\"<>|]/g, "-")
    .slice(0, 120);
}

function projectToBlocksAndColors(payload: any): { blocks: Set<string>; colors: Map<string, string> } {
  const blocksArr: unknown[] = Array.isArray(payload?.blocks) ? payload.blocks : [];
  const colorsArr: unknown[] | null = Array.isArray(payload?.colors) ? payload.colors : null;
  const legacy = typeof payload?.color === "string" ? payload.color : DEFAULT_BLOCK_COLOR;

  const blocks = new Set<string>();
  const colors = new Map<string, string>();

  for (let i = 0; i < blocksArr.length; i++) {
    const k = blocksArr[i];
    if (typeof k !== "string") continue;
    blocks.add(k);
    const c = colorsArr && typeof colorsArr[i] === "string" ? (colorsArr[i] as string) : legacy;
    colors.set(k, c);
  }

  if (blocks.size === 0) {
    const origin = keyOf({ x: 0, y: 0, z: 0 });
    blocks.add(origin);
    colors.set(origin, DEFAULT_BLOCK_COLOR);
  }

  return { blocks, colors };
}

async function downscaleDataUrl(src: string, size = 200): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = size;
        c.height = size;
        const ctx = c.getContext("2d");
        if (!ctx) return resolve(src);
        ctx.drawImage(img, 0, 0, size, size);
        resolve(c.toDataURL("image/png"));
      } catch {
        resolve(src);
      }
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

export default function GalleryPage() {
  const router = useRouter();
  const { track } = useTelemetry();
  const { user, supabase, loading: authLoading } = useAuth();
  const { t, lang } = useI18n();

  const [myRows, setMyRows] = useState<ModelRow[]>([]);
  const [publicRows, setPublicRows] = useState<ModelRow[]>([]);
  const [myBusy, setMyBusy] = useState(false);
  const [pubBusy, setPubBusy] = useState(false);
  const [myErr, setMyErr] = useState<string | null>(null);
  const [pubErr, setPubErr] = useState<string | null>(null);

  const [qMy, setQMy] = useState("");
  const [qPub, setQPub] = useState("");

  const snapshotFnRef = useRef<(() => string | null) | null>(null);
  const [thumbOpen, setThumbOpen] = useState(false);
  const [thumbBusy, setThumbBusy] = useState(false);
  const [thumbErr, setThumbErr] = useState<string | null>(null);
  const [thumbRow, setThumbRow] = useState<ModelRow | null>(null);
  const [thumbBlocks, setThumbBlocks] = useState<Set<string>>(new Set([keyOf({ x: 0, y: 0, z: 0 })]));
  const [thumbColors, setThumbColors] = useState<Map<string, string>>(new Map([[keyOf({ x: 0, y: 0, z: 0 }), DEFAULT_BLOCK_COLOR]]));

  useEffect(() => {
    track("gallery_open", { logged_in: Boolean(user) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goEditor = (mode: "model" | "paint") => {
    try {
      localStorage.setItem(UI_MODE_KEY, mode);
    } catch {
      // ignore
    }
    router.push("/");
  };

  const onModeChange = (v: string) => {
    if (v === "model") return goEditor("model");
    if (v === "paint") return goEditor("paint");
    if (v === "coding") return router.push("/coding");
    // gallery: stay
  };

  const refreshMy = async () => {
    if (!supabase) {
      setMyErr(t("gallery.supabaseMissing"));
      return;
    }
    if (!user) {
      setMyRows([]);
      return;
    }
    setMyBusy(true);
    setMyErr(null);
    try {
      const res = await supabase
        .from("user_models")
        .select("id,name,updated_at,created_at,block_count,thumb_data_url,is_public,published_at")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (res.error) throw new Error(res.error.message);
      setMyRows((res.data || []) as any);
    } catch (e: any) {
      setMyErr(e?.message || String(e));
    } finally {
      setMyBusy(false);
    }
  };

  const refreshPublic = async () => {
    if (!supabase) {
      setPubErr(t("gallery.supabaseMissing"));
      return;
    }
    setPubBusy(true);
    setPubErr(null);
    try {
      const res = await supabase
        .from("user_models")
        .select("id,name,updated_at,created_at,block_count,thumb_data_url,is_public,published_at")
        .eq("is_public", true)
        .order("published_at", { ascending: false })
        .limit(200);
      if (res.error) throw new Error(res.error.message);
      setPublicRows((res.data || []) as any);
    } catch (e: any) {
      setPubErr(e?.message || String(e));
    } finally {
      setPubBusy(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!supabase) return;
    void refreshPublic();
    if (user) void refreshMy();
    else setMyRows([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, supabase, user?.id]);

  const filteredMy = useMemo(() => {
    const q = qMy.trim().toLowerCase();
    if (!q) return myRows;
    return myRows.filter((r) => String(r.name || "").toLowerCase().includes(q));
  }, [myRows, qMy]);

  const filteredPub = useMemo(() => {
    const q = qPub.trim().toLowerCase();
    if (!q) return publicRows;
    return publicRows.filter((r) => String(r.name || "").toLowerCase().includes(q));
  }, [publicRows, qPub]);

  const openInEditor = (id: string, asCopy: boolean) => {
    try {
      localStorage.setItem(OPEN_MODEL_KEY, id);
      localStorage.setItem(OPEN_MODEL_COPY_KEY, asCopy ? "1" : "0");
      localStorage.setItem(UI_MODE_KEY, "model");
    } catch {
      // ignore
    }
    track("gallery_open_in_editor", { as_copy: asCopy });
    router.push("/");
  };

  const renameModel = async (row: ModelRow) => {
    if (!supabase) return;
    if (!user) {
      window.dispatchEvent(new CustomEvent("qbu:open-login", { detail: { message: t("account.loginRequired") } }));
      return;
    }
    const next = window.prompt(t("gallery.prompt.rename"), row.name || "Q-BU");
    if (!next) return;
    const name = next.trim();
    if (!name) return;
    const res = await supabase.from("user_models").update({ name, updated_at: new Date().toISOString() }).eq("id", row.id);
    if (res.error) {
      window.alert(t("gallery.alert.updateFailed", { msg: res.error.message }));
      return;
    }
    await refreshMy();
    await refreshPublic();
  };

  const deleteModel = async (row: ModelRow) => {
    const okGate = await ensureParentGate({ lang, t, action: "delete" });
    if (!okGate) return;
    if (!supabase) return;
    if (!user) {
      window.dispatchEvent(new CustomEvent("qbu:open-login", { detail: { message: t("account.loginRequired") } }));
      return;
    }
    if (!window.confirm(t("gallery.confirm.delete", { name: row.name || t("header.project.untitled") }))) return;
    const res = await supabase.from("user_models").delete().eq("id", row.id);
    if (res.error) {
      window.alert(t("gallery.alert.deleteFailed", { msg: res.error.message }));
      return;
    }
    await refreshMy();
    await refreshPublic();
  };

  const togglePublic = async (row: ModelRow) => {
    const okGate = await ensureParentGate({ lang, t, action: "publish" });
    if (!okGate) return;
    if (!supabase) return;
    if (!user) {
      window.dispatchEvent(new CustomEvent("qbu:open-login", { detail: { message: t("account.loginRequired") } }));
      return;
    }
    const next = !Boolean(row.is_public);
    const patch: any = next
      ? { is_public: true, published_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      : { is_public: false, published_at: null, updated_at: new Date().toISOString() };
    const res = await supabase.from("user_models").update(patch).eq("id", row.id);
    if (res.error) {
      window.alert(t("gallery.alert.updateFailed", { msg: res.error.message }));
      return;
    }
    await refreshMy();
    await refreshPublic();
  };

  const downloadQbu = async (row: ModelRow) => {
    const okGate = await ensureParentGate({ lang, t, action: "download" });
    if (!okGate) return;
    if (!supabase) return;
    if (!user) {
      window.dispatchEvent(new CustomEvent("qbu:open-login", { detail: { message: t("account.loginRequired") } }));
      return;
    }
    const res = await supabase.from("user_models").select("name,qbu_base64").eq("id", row.id).single();
    if (res.error || !res.data) {
      window.alert(t("gallery.alert.downloadFailed", { msg: res.error?.message || "not_found" }));
      return;
    }
    const name = typeof (res.data as any).name === "string" ? (res.data as any).name : row.name;
    const b64 = typeof (res.data as any).qbu_base64 === "string" ? (res.data as any).qbu_base64 : "";
    if (!b64) {
      window.alert(t("gallery.alert.dataEmpty"));
      return;
    }
    // base64 decode (sync). For huge files this can take time.
    const bytes = base64ToBytes(b64);
    downloadBlob(new Blob([bytes], { type: "application/octet-stream" }), `${sanitizeFileName(name)}.qbu`);
  };

  const openThumbEditor = async (row: ModelRow) => {
    if (!supabase) return;
    if (!user) {
      window.dispatchEvent(new CustomEvent("qbu:open-login", { detail: { message: t("account.loginRequired") } }));
      return;
    }
    setThumbErr(null);
    snapshotFnRef.current = null;
    setThumbRow(row);
    setThumbOpen(true);
    setThumbBusy(true);
    try {
      const res = await supabase.from("user_models").select("qbu_base64,name").eq("id", row.id).single();
      if (res.error || !res.data) throw new Error(res.error?.message || "not_found");
      const b64 = typeof (res.data as any).qbu_base64 === "string" ? (res.data as any).qbu_base64 : "";
      if (!b64) throw new Error("model_data_empty");
      const bytes = base64ToBytes(b64);

      // Try without password; if it fails, ask once.
      let unpacked = await unpackQbu(bytes, { password: "" });
      if (!unpacked.ok) {
        const pw = window.prompt(t("gallery.prompt.legacyPassword")) || "";
        unpacked = await unpackQbu(bytes, { password: pw });
      }
      if (!unpacked.ok) throw new Error(`unpack_failed: ${unpacked.error}`);

      const text = new TextDecoder().decode(unpacked.body);
      const payload = JSON.parse(text);
      const built = projectToBlocksAndColors(payload);
      setThumbBlocks(built.blocks);
      setThumbColors(built.colors);
    } catch (e: any) {
      setThumbErr(e?.message || String(e));
    } finally {
      setThumbBusy(false);
    }
  };

  const saveThumbnail = async () => {
    if (!supabase) return;
    if (!user) {
      window.dispatchEvent(new CustomEvent("qbu:open-login", { detail: { message: t("account.loginRequired") } }));
      return;
    }
    if (!thumbRow) return;
    const take = snapshotFnRef.current;
    if (!take) {
      setThumbErr(t("gallery.thumb.notReady"));
      return;
    }
    const raw = take();
    if (!raw) {
      setThumbErr(t("gallery.thumb.failed"));
      return;
    }
    setThumbBusy(true);
    setThumbErr(null);
    try {
      const scaled = await downscaleDataUrl(raw, 200);
      const res = await supabase
        .from("user_models")
        .update({ thumb_data_url: scaled, updated_at: new Date().toISOString() })
        .eq("id", thumbRow.id);
      if (res.error) throw new Error(res.error.message);
      await refreshMy();
      await refreshPublic();
      setThumbOpen(false);
      setThumbRow(null);
    } catch (e: any) {
      setThumbErr(e?.message || String(e));
    } finally {
      setThumbBusy(false);
    }
  };

  const colStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    border: "1px solid rgba(11, 15, 24, 0.14)",
    borderRadius: 16,
    background: "rgba(255,255,255,.92)",
    boxShadow: "0 10px 28px rgba(11, 15, 24, 0.08)",
  };

  const listStyle: React.CSSProperties = {
    flex: 1,
    overflow: "auto",
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  };

  const cardStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "92px 1fr",
    gap: 10,
    alignItems: "center",
    border: "1px solid rgba(11, 15, 24, 0.12)",
    borderRadius: 14,
    padding: 10,
    background: "rgba(255,255,255,.95)",
  };

  const thumbStyle: React.CSSProperties = {
    width: 92,
    height: 92,
    borderRadius: 12,
    border: "1px solid rgba(11, 15, 24, 0.14)",
    overflow: "hidden",
    background: "#f5f6fa",
    display: "grid",
    placeItems: "center",
  };

  return (
    <div className="page">
      <header className="topHeader minimal">
        <div className="headerLeft">
          <div className="title">
            Q-BU{" "}
            <span className="modeSelectWrap" aria-label="Mode">
              <select className="modeSelect" value="gallery" onChange={(e) => onModeChange(e.target.value)}>
                <option value="model">{t("mode.model")}</option>
                <option value="paint">{t("mode.paint")}</option>
                <option value="coding">{t("mode.coding")}</option>
                <option value="gallery">{t("mode.gallery")}</option>
              </select>
            </span>
          </div>
        </div>
        <div className="headerRight" />
      </header>

      <main className="main">
        <div
          style={{
            height: "100%",
            width: "100%",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            padding: 12,
            overflow: "hidden",
          }}
        >
          {/* Left: MyProjects */}
          <section style={colStyle}>
            <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(11, 15, 24, 0.12)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontWeight: 1000 }}>{t("gallery.my")}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  className="saveInput"
                  value={qMy}
                  onChange={(e) => setQMy(e.target.value)}
                  placeholder={t("gallery.search")}
                  style={{ width: 200, padding: "8px 10px", fontSize: 12 }}
                />
                <button type="button" className="hbtn" onClick={() => void refreshMy()} disabled={myBusy || !user}>
                  ↻
                </button>
              </div>
            </div>

            <div style={listStyle}>
              {authLoading ? <div className="hintText">{t("gallery.loading")}</div> : null}
              {!authLoading && !user ? (
                <div className="hintText">{t("gallery.loginToSeeMy")}</div>
              ) : null}
              {myErr ? <div className="hintText">Error: {myErr}</div> : null}

              {filteredMy.map((r) => {
                const isPublic = Boolean(r.is_public);
                return (
                  <div key={r.id} style={cardStyle}>
                    <div style={thumbStyle}>
                      {r.thumb_data_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.thumb_data_url} alt={r.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.55 }}>{t("gallery.noImage")}</div>
                      )}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 6, overflow: "hidden" }}>
                      <div style={{ fontWeight: 1000, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <span className="hintText">
                          {t("gallery.blocks")}: {typeof r.block_count === "number" ? r.block_count.toLocaleString() : "-"}
                        </span>
                        <span className="hintText">
                          {t("gallery.updated")}: {formatDateTimeJa(r.updated_at || r.created_at || "")}
                        </span>
                        {isPublic ? <span className="warnYellow">{t("gallery.publicTag")}</span> : null}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button type="button" className="saveBtn" onClick={() => openInEditor(r.id, false)}>
                          {t("gallery.open")}
                        </button>
                        <button type="button" className="saveBtn" onClick={() => renameModel(r)}>
                          {t("gallery.rename")}
                        </button>
                        <button type="button" className="saveBtn" onClick={() => void openThumbEditor(r)}>
                          {t("gallery.thumbnail")}
                        </button>
                        <button type="button" className="saveBtn" onClick={() => void downloadQbu(r)}>
                          {t("gallery.download")}
                        </button>
                        <button type="button" className="saveBtn" onClick={() => void togglePublic(r)}>
                          {isPublic ? t("gallery.unpublish") : t("gallery.publish")}
                        </button>
                        <button type="button" className="saveBtn" onClick={() => void deleteModel(r)}>
                          {t("gallery.delete")}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {!myBusy && user && filteredMy.length === 0 ? <div className="hintText">{t("gallery.noMy")}</div> : null}
            </div>
          </section>

          {/* Right: PublicProjects */}
          <section style={colStyle}>
            <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(11, 15, 24, 0.12)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontWeight: 1000 }}>{t("gallery.public")}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  className="saveInput"
                  value={qPub}
                  onChange={(e) => setQPub(e.target.value)}
                  placeholder={t("gallery.search")}
                  style={{ width: 200, padding: "8px 10px", fontSize: 12 }}
                />
                <button type="button" className="hbtn" onClick={() => void refreshPublic()} disabled={pubBusy}>
                  ↻
                </button>
              </div>
            </div>

            <div style={listStyle}>
              {pubErr ? <div className="hintText">Error: {pubErr}</div> : null}
              {filteredPub.map((r) => {
                return (
                  <div key={r.id} style={cardStyle}>
                    <div style={thumbStyle}>
                      {r.thumb_data_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.thumb_data_url} alt={r.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.55 }}>{t("gallery.noImage")}</div>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, overflow: "hidden" }}>
                      <div style={{ fontWeight: 1000, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <span className="hintText">blocks: {typeof r.block_count === "number" ? r.block_count.toLocaleString() : "-"}</span>
                        <span className="hintText">published: {formatDateTimeJa(r.published_at || r.updated_at || "")}</span>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button type="button" className="saveBtn" onClick={() => openInEditor(r.id, true)}>
                          {t("gallery.open")}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {!pubBusy && filteredPub.length === 0 ? <div className="hintText">{t("gallery.noPublic")}</div> : null}
            </div>
          </section>
        </div>
      </main>

      {/* AccountFab is rendered globally in <Providers /> */}

      {/* Thumbnail editor */}
      {thumbOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1200,
            padding: 16,
          }}
        >
          <div
            style={{
              width: "min(980px, 96vw)",
              height: "min(720px, 92vh)",
              background: "#fff",
              borderRadius: 18,
              overflow: "hidden",
              boxShadow: "0 14px 44px rgba(0,0,0,.25)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(0,0,0,.08)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontWeight: 1000 }}>
                {t("gallery.thumbnail")}: {thumbRow?.name}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="hbtn"
                  onClick={() => {
                    if (thumbBusy) return;
                    setThumbOpen(false);
                    setThumbRow(null);
                  }}
                >
                  {t("common.close")}
                </button>
              </div>
            </div>

            <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 320px", gap: 12, padding: 12, overflow: "hidden" }}>
              <div style={{ overflow: "hidden" }}>
                <ModVoxelViewer
                  blocks={thumbBlocks}
                  blockColors={thumbColors}
                  showEdges={true}
                  preserveDrawingBuffer
                  onSnapshotReady={(fn) => {
                    snapshotFnRef.current = fn;
                  }}
                  style={{ height: "100%" }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div className="hintText">{t("gallery.thumbHint")}</div>
                {thumbErr ? <div className="hintText">Error: {thumbErr}</div> : null}
                <button type="button" className="saveBtn primary" onClick={() => void saveThumbnail()} disabled={thumbBusy}>
                  {t("gallery.thumbSave")}
                </button>
                {thumbBusy ? <div className="hintText">{t("common.processing")}</div> : null}
                <div className="hintText">{t("gallery.thumbPublicNote")}</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
