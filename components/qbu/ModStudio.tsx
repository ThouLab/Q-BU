"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { DEFAULT_BLOCK_COLOR } from "@/components/qbu/filamentColors";
import ModVoxelViewer from "@/components/qbu/ModVoxelViewer";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";

type WorkerMsg =
  | { type: "status"; message: string }
  | { type: "ready" }
  | {
      type: "result";
      ok: boolean;
      payload?: { blocks: string[]; colors: string[] };
      stdout?: string;
      stderr?: string;
      error?: string;
    };

type ProjectLike = {
  blocks: string[];
  colors: string[];
  edges: boolean;
};

type Suggestion = {
  label: string;
  insertText: string;
  replaceFrom: number;
  replaceTo: number;
};

const STORAGE_KEY = "qbu_project_v1";
const DRAFT_KEY = "qbu_draft_v2";
const CURRENT_MODEL_ID_KEY = "qbu_current_model_id_v1";
const CURRENT_MODEL_NAME_KEY = "qbu_current_model_name_v1";

// Builder と共有（/coding -> / でモード指定）
const UI_MODE_KEY = "qbu_ui_mode_v1";

const EXAMPLES: { id: string; nameKey: string; code: string }[] = [
  {
    id: "mirror_x",
    nameKey: "coding.example.mirror_x",
    code: `# world / model are ready

# Mirror across x=0 plane
model.mirror_x(plane=0)
`,
  },
  {
    id: "box_checker",
    nameKey: "coding.example.box_checker",
    code: `# Shape + pattern paint

model.clear(keep_origin=False)

# Box from (x0,y0,z0) to (x1,y1,z1)
model.add_box(-6, 0, -6, 6, 8, 6, color="#9AA0A6", hollow=True)

# Checker paint
model.paint_checker(color_a="#F6C90E", color_b="#1F1F1F", period=1, axes=("x","z"))
`,
  },
  {
    id: "sphere",
    nameKey: "coding.example.sphere",
    code: `# Sphere

model.clear(keep_origin=False)
model.add_sphere(center=(0, 0, 0), radius=6, color="#1E6BF1", hollow=False)
`,
  },
];

const SNIPPETS: { id: string; titleKey: string; insert: string }[] = [
  {
    id: "picked_cube",
    titleKey: "coding.snippet.picked_cube",
    insert: `# Example: c1 = world.model.cube(x, y, z)
`,
  },
  {
    id: "mirror",
    titleKey: "coding.snippet.mirror",
    insert: `# Mirror across a plane (x=0)
model.mirror(axis="x", plane=0)

# If you want to use a picked cube (e.g. c1) as the plane:
# model.mirror_x(plane=c1)
`,
  },
  {
    id: "box",
    titleKey: "coding.snippet.box",
    insert: `# Box
model.add_box(-2, 0, -2, 2, 4, 2, color="#9AA0A6", hollow=False)
`,
  },
  {
    id: "sphere",
    titleKey: "coding.snippet.sphere",
    insert: `# Sphere
model.add_sphere(center=(0, 0, 0), radius=6, color="#1E6BF1", hollow=False)
`,
  },
  {
    id: "checker",
    titleKey: "coding.snippet.checker",
    insert: `# Checker paint
model.paint_checker(color_a="#F6C90E", color_b="#1F1F1F", period=1, axes=("x","z"))
`,
  },
];

const HINTS = {
  world: ["model", "to_payload()", "clone()"],
  model: [
    "cube(x, y, z)",
    "get(x, y, z)",
    "ensure(x, y, z, color=None)",
    "remove(x, y, z)",
    "clear(keep_origin=True)",
    "cubes()",
    "mirror(axis='x', plane=0)",
    "mirror_x(plane=0)",
    "mirror_y(plane=0)",
    "mirror_z(plane=0)",
    "add_box(x0, y0, z0, x1, y1, z1, color=None, hollow=False)",
    "add_sphere(center=(0, 0, 0), radius=6, color=None, hollow=False)",
    "paint_checker(color_a, color_b, period=1, axes=('x','z'))",
  ],
  cube: ["color", "exists", "pos()", "neighbors6()"],
} as const;

function safeJsonParse(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeProject(obj: any): ProjectLike {
  // v5: {version:5, kind:'project', blocks:[], colors:[], edges?:boolean}
  if (obj && typeof obj === "object" && Array.isArray(obj.blocks)) {
    const blocks = obj.blocks.filter((x: any) => typeof x === "string");

    // legacy: {blocks:[], color:'#...'}
    let colors: string[] = [];
    if (Array.isArray(obj.colors)) {
      colors = obj.colors.map((c: any) => (typeof c === "string" ? c : DEFAULT_BLOCK_COLOR));
    } else if (typeof obj.color === "string") {
      colors = blocks.map(() => obj.color);
    }

    if (colors.length < blocks.length) {
      colors = colors.concat(Array.from({ length: blocks.length - colors.length }, () => DEFAULT_BLOCK_COLOR));
    }

    const edges = typeof obj.edges === "boolean" ? obj.edges : true;
    return { blocks, colors, edges };
  }

  // very old: raw blocks array
  if (Array.isArray(obj)) {
    const blocks = obj.filter((x) => typeof x === "string");
    return { blocks, colors: blocks.map(() => DEFAULT_BLOCK_COLOR), edges: true };
  }

  return { blocks: ["0,0,0"], colors: [DEFAULT_BLOCK_COLOR], edges: true };
}

function toSets(p: ProjectLike) {
  const blocks = new Set<string>(p.blocks.length ? p.blocks : ["0,0,0"]);
  if (!blocks.size) blocks.add("0,0,0");
  if (!blocks.has("0,0,0")) {
    // ensure origin exists
    blocks.add("0,0,0");
    p.blocks = ["0,0,0", ...p.blocks];
    p.colors = [DEFAULT_BLOCK_COLOR, ...p.colors];
  }

  const colors = new Map<string, string>();
  for (let i = 0; i < p.blocks.length; i++) {
    const k = p.blocks[i];
    if (!blocks.has(k)) continue;
    colors.set(k, p.colors[i] || DEFAULT_BLOCK_COLOR);
  }
  // fill missing
  for (const k of blocks) if (!colors.has(k)) colors.set(k, DEFAULT_BLOCK_COLOR);

  return { blocks, colors };
}

type SupportKind = "deps" | "complete";

export default function ModStudio() {
  const router = useRouter();
  const { user, supabase } = useAuth();
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // Project name (shared with Builder via localStorage)
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>("Q-BU");
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  useEffect(() => {
    try {
      const id = localStorage.getItem(CURRENT_MODEL_ID_KEY);
      const name = localStorage.getItem(CURRENT_MODEL_NAME_KEY);
      if (id) setProjectId(id);
      if (name) setProjectName(name);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      if (projectId) localStorage.setItem(CURRENT_MODEL_ID_KEY, projectId);
      if (projectName) localStorage.setItem(CURRENT_MODEL_NAME_KEY, projectName);
    } catch {
      // ignore
    }
  }, [projectId, projectName]);

  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [stdout, setStdout] = useState<string>("");
  const [stderr, setStderr] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const [exampleId, setExampleId] = useState(EXAMPLES[0]?.id || "mirror_x");
  const selectedExample = useMemo(() => EXAMPLES.find((e) => e.id === exampleId) || EXAMPLES[0], [exampleId]);
  const [code, setCode] = useState<string>(EXAMPLES[0]?.code || "");

  const [baseProject, setBaseProject] = useState<ProjectLike>({
    blocks: ["0,0,0"],
    colors: [DEFAULT_BLOCK_COLOR],
    edges: true,
  });
  const baseSets = useMemo(() => toSets({ ...baseProject }), [baseProject]);

  const [resultPayload, setResultPayload] = useState<{ blocks: string[]; colors: string[] } | null>(null);
  const resultSets = useMemo(() => {
    if (!resultPayload) return null;
    return toSets({ blocks: resultPayload.blocks, colors: resultPayload.colors, edges: baseProject.edges });
  }, [resultPayload, baseProject.edges]);

  // クリックした Cube の変数名（c1, c2...）
  const insertCounterRef = useRef(1);
  const [cubeVars, setCubeVars] = useState<string[]>([]);
  const cubeVarsRef = useRef<string[]>([]);
  useEffect(() => {
    cubeVarsRef.current = cubeVars;
  }, [cubeVars]);

  // 入力サポート（表示用）と Tab 補完用（fallback は Tab に載せない）
  const [supportKind, setSupportKind] = useState<SupportKind>("complete");
  const [supportContext, setSupportContext] = useState<string>("top");
  const [supportItems, setSupportItems] = useState<Suggestion[]>([]);
  const [tabItems, setTabItems] = useState<Suggestion[]>([]);

  // code undo/redo（Ctrl+Z / Shift+Ctrl+Z）
  const codeHistoryRef = useRef<{ code: string; cursor: number }[]>([]);
  const codeHistoryIndexRef = useRef<number>(-1);

  const resetCodeHistory = (nextCode: string, cursor: number) => {
    codeHistoryRef.current = [{ code: nextCode, cursor }];
    codeHistoryIndexRef.current = 0;
  };

  const pushCodeHistory = (nextCode: string, cursor: number) => {
    const list = codeHistoryRef.current;
    let idx = codeHistoryIndexRef.current;

    if (idx < 0) {
      resetCodeHistory(nextCode, cursor);
      return;
    }

    // 途中で書いたら redo ブランチを捨てる
    if (idx < list.length - 1) {
      list.splice(idx + 1);
    }

    const last = list[list.length - 1];
    if (last && last.code === nextCode) {
      last.cursor = cursor;
      codeHistoryIndexRef.current = list.length - 1;
      return;
    }

    list.push({ code: nextCode, cursor });

    const MAX = 250;
    if (list.length > MAX) {
      const drop = list.length - MAX;
      list.splice(0, drop);
      idx = Math.max(0, idx - drop);
    }

    codeHistoryIndexRef.current = list.length - 1;
  };

  const applySupportFrom = (text: string, cursor: number) => {
    const before = text.slice(0, cursor);

    const mk = (ctx: string, arr: readonly string[], prefix: string) => {
      const replaceFrom = cursor - prefix.length;
      const replaceTo = cursor;
      return arr
        .filter((s) => s.startsWith(prefix))
        .slice(0, 16)
        .map((s) => ({ label: `${ctx}.${s}`, insertText: s, replaceFrom, replaceTo }));
    };

    // 1) . 入力 -> 依存関係
    const mWorldModel = before.match(/world\.model\.([A-Za-z_][A-Za-z0-9_]*)?$/);
    if (mWorldModel) {
      const prefix = mWorldModel[1] || "";
      const list = mk("model", HINTS.model, prefix);
      setSupportKind("deps");
      setSupportContext("world.model");
      setSupportItems(list);
      setTabItems(list);
      return;
    }

    const mWorld = before.match(/world\.([A-Za-z_][A-Za-z0-9_]*)?$/);
    if (mWorld) {
      const prefix = mWorld[1] || "";
      const list = mk("world", HINTS.world, prefix);
      setSupportKind("deps");
      setSupportContext("world");
      setSupportItems(list);
      setTabItems(list);
      return;
    }

    const mModel = before.match(/model\.([A-Za-z_][A-Za-z0-9_]*)?$/);
    if (mModel) {
      const prefix = mModel[1] || "";
      const list = mk("model", HINTS.model, prefix);
      setSupportKind("deps");
      setSupportContext("model");
      setSupportItems(list);
      setTabItems(list);
      return;
    }

    // c1. / cube. -> Cube hints
    const mAnyDot = before.match(/\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)?$/);
    if (mAnyDot) {
      const obj = mAnyDot[1] || "";
      const prefix = mAnyDot[2] || "";
      const isCube = obj === "cube" || cubeVarsRef.current.includes(obj);
      if (isCube) {
        const replaceFrom = cursor - prefix.length;
        const replaceTo = cursor;
        const list = HINTS.cube
          .filter((s) => s.startsWith(prefix))
          .slice(0, 16)
          .map((s) => ({ label: `${obj}.${s}`, insertText: s, replaceFrom, replaceTo }));
        setSupportKind("deps");
        setSupportContext(obj);
        setSupportItems(list);
        setTabItems(list);
        return;
      }
    }

    // 2) それ以外 -> 入力補完（例: m -> model, c -> c1...）
    const tokenMatch = before.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
    const token = tokenMatch ? tokenMatch[1] : "";
    const replaceFrom = cursor - token.length;
    const replaceTo = cursor;

    const completions: Suggestion[] = [];
    const pushWord = (w: string) => {
      if (!token || w.startsWith(token)) {
        completions.push({ label: w, insertText: w, replaceFrom, replaceTo });
      }
    };

    // m -> model / w -> world
    pushWord("model");
    pushWord("world");

    // c -> c1, c2...
    for (const v of cubeVarsRef.current) {
      if (!token || v.startsWith(token)) {
        completions.push({ label: v, insertText: v, replaceFrom, replaceTo });
      }
    }

    // 表示用 fallback（トップレベルは Tab で補完しない）
    if (!token) {
      const fallback: Suggestion[] = [];
      const rf = cursor;
      const rt = cursor;
      fallback.push({ label: "world", insertText: "world", replaceFrom: rf, replaceTo: rt });
      fallback.push({ label: "model", insertText: "model", replaceFrom: rf, replaceTo: rt });
      for (const v of cubeVarsRef.current) fallback.push({ label: v, insertText: v, replaceFrom: rf, replaceTo: rt });

      setSupportKind("complete");
      setSupportContext("top");
      setSupportItems(fallback);
      setTabItems([]);
      return;
    }

    setSupportKind("complete");
    setSupportContext(token);
    setSupportItems(completions.slice(0, 16));
    setTabItems(completions.slice(0, 16));
  };

  const refreshSupport = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart ?? 0;
    const text = ta.value ?? "";
    applySupportFrom(text, cursor);
  };

  const setCodeAndHistory = (next: string, cursor: number) => {
    setCode(next);
    pushCodeHistory(next, cursor);
    // サポート更新
    applySupportFrom(next, cursor);
  };

  const undoCode = () => {
    const list = codeHistoryRef.current;
    let idx = codeHistoryIndexRef.current;
    if (idx <= 0) return;
    idx -= 1;
    codeHistoryIndexRef.current = idx;
    const st = list[idx]!;
    setCode(st.code);
    setTabItems([]);
    applySupportFrom(st.code, st.cursor);
    setTimeout(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      try {
        ta.focus();
        ta.selectionStart = st.cursor;
        ta.selectionEnd = st.cursor;
      } catch {
        // ignore
      }
    }, 0);
  };

  const redoCode = () => {
    const list = codeHistoryRef.current;
    let idx = codeHistoryIndexRef.current;
    if (idx < 0 || idx >= list.length - 1) return;
    idx += 1;
    codeHistoryIndexRef.current = idx;
    const st = list[idx]!;
    setCode(st.code);
    setTabItems([]);
    applySupportFrom(st.code, st.cursor);
    setTimeout(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      try {
        ta.focus();
        ta.selectionStart = st.cursor;
        ta.selectionEnd = st.cursor;
      } catch {
        // ignore
      }
    }, 0);
  };

  // load current project snapshot
  useEffect(() => {
    const raw = localStorage.getItem(DRAFT_KEY) || localStorage.getItem(STORAGE_KEY);
    const obj = safeJsonParse(raw);
    const p = normalizeProject(obj);
    setBaseProject(p);
  }, []);

  // init worker
  useEffect(() => {
    try {
      const w = new Worker("/qbu_mod_worker.js");
      workerRef.current = w;
      setStatus(t("coding.pyodideBoot"));
      setError(null);
      setReady(false);

      w.onmessage = (ev: MessageEvent<WorkerMsg>) => {
        const msg = ev.data;
        if (!msg || typeof msg !== "object" || !("type" in msg)) return;
        if (msg.type === "status") {
          setStatus(msg.message);
          return;
        }
        if (msg.type === "ready") {
          setReady(true);
          setStatus(t("coding.readyOk"));
          return;
        }
        if (msg.type === "result") {
          setBusy(false);
          setStdout(msg.stdout || "");
          setStderr(msg.stderr || "");
          setError(msg.ok ? null : msg.error || t("coding.runFailed"));
          if (msg.ok && msg.payload?.blocks && msg.payload?.colors) {
            setResultPayload({ blocks: msg.payload.blocks, colors: msg.payload.colors });
            setStatus(t("coding.done", { n: msg.payload.blocks.length.toLocaleString() }));
          } else {
            setStatus(t("coding.error"));
          }
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

    return () => {
      try {
        workerRef.current?.terminate();
      } catch {
        // ignore
      }
      workerRef.current = null;
    };
  }, []);

  // update editor content when example changes
  useEffect(() => {
    const next = selectedExample?.code || "";
    setCode(next);
    setResultPayload(null);
    setStdout("");
    setStderr("");
    setError(null);
    resetCodeHistory(next, next.length);
    applySupportFrom(next, next.length);
    setTabItems([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exampleId]);

  // 初期の入力サポート表示
  useEffect(() => {
    resetCodeHistory(code, code.length);
    applySupportFrom(code, code.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const insertAtCursor = (insertText: string, replace?: { from: number; to: number }) => {
    const ta = textareaRef.current;
    if (!ta) {
      const next = code + insertText;
      setCodeAndHistory(next, next.length);
      return;
    }

    const current = ta.value;
    const from = replace ? replace.from : ta.selectionStart;
    const to = replace ? replace.to : ta.selectionEnd;
    const next = current.slice(0, from) + insertText + current.slice(to);

    const caret = from + insertText.length;
    setCodeAndHistory(next, caret);
    setTabItems([]);

    // move caret
    setTimeout(() => {
      try {
        ta.focus();
        ta.selectionStart = caret;
        ta.selectionEnd = caret;
      } catch {
        // ignore
      }
    }, 0);
  };

  const run = () => {
    const w = workerRef.current;
    if (!w) {
      setError(t("coding.workerNotReady"));
      return;
    }
    setBusy(true);
    setError(null);
    setStdout("");
    setStderr("");
    setStatus(t("coding.running"));

    const base = Array.from(baseSets.blocks);
    const colors = base.map((k) => baseSets.colors.get(k) || DEFAULT_BLOCK_COLOR);

    w.postMessage({
      type: "run",
      code,
      blocks: base,
      colors,
      defaultColor: DEFAULT_BLOCK_COLOR,
    });
  };

  const apply = () => {
    if (!resultPayload) return;
    const data = {
      version: 5,
      kind: "project",
      blocks: resultPayload.blocks,
      colors: resultPayload.colors,
      edges: baseProject.edges,
      updated_at: Date.now(),
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // ignore
    }
    router.push("/");
  };

  const goEditor = (mode: "model" | "paint") => {
    try {
      localStorage.setItem(UI_MODE_KEY, mode);
    } catch {
      // ignore
    }
    router.push("/");
  };

  const requireLogin = (message: string) => {
    try {
      window.dispatchEvent(new CustomEvent("qbu:open-login", { detail: { message } }));
    } catch {
      // ignore
    }
  };

  const beginNameEdit = () => {
    setNameDraft((projectName || "Q-BU").slice(0, 120));
    setNameEditing(true);
  };

  const commitNameEdit = async () => {
    const next = String(nameDraft || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 120);
    setNameEditing(false);
    if (!next) return;
    if (next === projectName) return;

    const prev = projectName;
    setProjectName(next);
    try {
      localStorage.setItem(CURRENT_MODEL_NAME_KEY, next);
    } catch {
      // ignore
    }

    if (!projectId) {
      setStatus(t("toast.renamed", { name: next }));
      return;
    }

    if (!supabase) {
      setStatus(t("coding.supabaseMissing"));
      return;
    }

    if (!user) {
      requireLogin(t("account.loginRequired"));
      setStatus(t("toast.loginToSyncName"));
      return;
    }

    try {
      const res = await supabase
        .from("user_models")
        .update({ name: next, updated_at: new Date().toISOString() })
        .eq("id", projectId);
      if (res.error) throw new Error(res.error.message);
      setStatus(t("toast.renamed", { name: next }));
    } catch (e: any) {
      setProjectName(prev);
      setError(t("toast.renameFailed", { msg: e?.message || String(e) }));
    }
  };

  return (
    <div className="page">
      <header className="topHeader minimal">
        <div className="headerLeft">
          <div className="title">
            Q-BU{" "}
            <span className="modeSelectWrap" aria-label="Mode">
              <select
                className="modeSelect"
                value="coding"
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "gallery") {
                    router.push("/gallery");
                    return;
                  }
                  if (v === "model") goEditor("model");
                  if (v === "paint") goEditor("paint");
                }}
                aria-label="mode"
                disabled={busy}
              >
                <option value="model">{t("mode.model")}</option>
                <option value="paint">{t("mode.paint")}</option>
                <option value="coding">{t("mode.coding")}</option>
                <option value="gallery">{t("mode.gallery")}</option>
              </select>
            </span>
          </div>
        </div>

        <div className="headerCenter">
          {nameEditing ? (
            <input
              className="projectNameInput"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => void commitNameEdit()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commitNameEdit();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setNameDraft(projectName || "Q-BU");
                  setNameEditing(false);
                }
              }}
              autoFocus
              aria-label={t("header.project.rename")}
            />
          ) : (
            <button
              type="button"
              className="projectNameBtn"
              onClick={beginNameEdit}
              title={t("header.project.rename")}
              aria-label={t("header.project.rename")}
            >
              {projectName || "Q-BU"}
            </button>
          )}
        </div>

        <div className="headerRight" />
      </header>

      <main className="main">
        <div
          style={{
            height: "100%",
            width: "100%",
            display: "grid",
            gridTemplateColumns: "1.2fr 1fr 1fr",
            gap: 10,
            padding: 10,
            overflow: "hidden",
          }}
        >
          {/* Left: code */}
          <section
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              overflow: "hidden",
              border: "1px solid rgba(11, 15, 24, 0.14)",
              borderRadius: 14,
              background: "rgba(255,255,255,.92)",
              boxShadow: "0 10px 28px rgba(11, 15, 24, 0.08)",
            }}
          >
            <div style={{ padding: 12, borderBottom: "1px solid rgba(11, 15, 24, 0.12)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontWeight: 1000 }}>{t("coding.code")}</div>
              <select
                value={exampleId}
                onChange={(e) => setExampleId(e.target.value)}
                style={{ padding: "6px 8px", borderRadius: 10, fontWeight: 900, fontSize: 12 }}
                disabled={busy}
                aria-label="examples"
              >
                {EXAMPLES.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {t(ex.nameKey)}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ padding: 12, overflow: "hidden", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
              {/* Input support: always visible ABOVE editor */}
              <div
                style={{
                  border: "1px solid rgba(11, 15, 24, 0.14)",
                  borderRadius: 12,
                  background: "rgba(255,255,255,.98)",
                  padding: 8,
                  maxHeight: 180,
                  overflow: "auto",
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 900, opacity: 0.72, marginBottom: 6 }}>
                  {supportKind === "deps" ? (
                    <>
                      <code>{supportContext}</code> {t("coding.support.depsSuffix")}
                    </>
                  ) : (
                    <>{t("coding.support.complete")}</>
                  )}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {supportItems.length ? (
                    supportItems.map((s, i) => (
                      <button
                        key={`${s.label}_${i}`}
                        type="button"
                        className="chip"
                        onClick={() => insertAtCursor(s.insertText, { from: s.replaceFrom, to: s.replaceTo })}
                      >
                        {s.label}
                      </button>
                    ))
                  ) : (
                    <div style={{ fontSize: 12, opacity: 0.7 }}>{t("coding.support.none")}</div>
                  )}
                </div>
              </div>

              {/* Quick snippets (input helper) ABOVE editor */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {SNIPPETS.map((s) => (
                  <button key={s.id} type="button" className="chip" onClick={() => insertAtCursor(s.insert)} disabled={busy}>
                    {t(s.titleKey)}
                  </button>
                ))}
              </div>

              <textarea
                ref={textareaRef}
                value={code}
                onChange={(e) => {
                  const next = e.target.value;
                  const cursor = e.target.selectionStart ?? next.length;
                  setCode(next);
                  pushCodeHistory(next, cursor);
                  applySupportFrom(next, cursor);
                }}
                onKeyUp={refreshSupport}
                onClick={refreshSupport}
                onKeyDown={(e) => {
                  // undo/redo
                  const isZ = e.key === "z" || e.key === "Z";
                  if ((e.ctrlKey || e.metaKey) && isZ) {
                    e.preventDefault();
                    if (e.shiftKey) redoCode();
                    else undoCode();
                    return;
                  }

                  if (e.key === "Tab") {
                    e.preventDefault();
                    if (tabItems.length) {
                      const s = tabItems[0]!;
                      insertAtCursor(s.insertText, { from: s.replaceFrom, to: s.replaceTo });
                      return;
                    }
                    // insert 2 spaces
                    insertAtCursor("  ");
                    return;
                  }
                  if (e.key === "Escape") {
                    setTabItems([]);
                    // fallback に戻す
                    refreshSupport();
                  }
                }}
                spellCheck={false}
                disabled={busy}
                style={{
                  flex: 1,
                  width: "100%",
                  resize: "none",
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid rgba(11, 15, 24, 0.14)",
                  background: "#fff",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              />

              {/* Run button BELOW editor */}
              <button
                type="button"
                className="hbtn"
                onClick={run}
                disabled={!ready || busy}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 12,
                  fontWeight: 1000,
                  opacity: !ready || busy ? 0.7 : 1,
                }}
              >
                {busy ? t("coding.running") : ready ? t("coding.run") : t("coding.preparing")}
              </button>
            </div>
          </section>

          {/* Middle: current */}
          <section style={{ display: "flex", flexDirection: "column", gap: 10, overflow: "hidden" }}>
            <div style={{ fontWeight: 1000, padding: "0 2px" }}>{t("coding.current")}</div>
            <div style={{ fontSize: 12, opacity: 0.8, padding: "0 2px" }}>{t("coding.stats", { blocks: baseSets.blocks.size.toLocaleString(), edges: baseProject.edges ? t("common.on") : t("common.off") })}</div>
            <div style={{ flex: 1, minHeight: 260 }}>
              <ModVoxelViewer
                blocks={baseSets.blocks}
                blockColors={baseSets.colors}
                showEdges={baseProject.edges}
                onPickCube={(picked) => {
                  // auto-insert into code
                  const vname = `c${insertCounterRef.current++}`;
                  setCubeVars((prev) => (prev.includes(vname) ? prev : [...prev, vname]));
                  const line = `${vname} = world.model.cube(${picked.coord.x}, ${picked.coord.y}, ${picked.coord.z})  # ${picked.color}\n`;
                  insertAtCursor(line);
                }}
              />
            </div>

          </section>

          {/* Right: result */}
          <section style={{ display: "flex", flexDirection: "column", gap: 10, overflow: "hidden" }}>
            <div style={{ fontWeight: 1000, padding: "0 2px" }}>{t("coding.preview")}</div>
            <div style={{ fontSize: 12, opacity: 0.8, padding: "0 2px" }}>{resultPayload ? t("editor.blocks", { n: resultPayload.blocks.length.toLocaleString() }) : ""}</div>

            <div style={{ flex: 1, minHeight: 260 }}>
              {resultSets ? (
                <ModVoxelViewer blocks={resultSets.blocks} blockColors={resultSets.colors} showEdges={baseProject.edges} />
              ) : (
                <div
                  style={{
                    height: "100%",
                    border: "1px dashed rgba(11, 15, 24, 0.22)",
                    borderRadius: 12,
                    background: "rgba(255,255,255,.6)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "rgba(11, 15, 24, 0.6)",
                    padding: 16,
                    textAlign: "center",
                    lineHeight: 1.5,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 900 }}>{t("coding.resultHere")}</div>
                  </div>
                </div>
              )}
            </div>

            {/* Apply button BELOW preview (header には置かない) */}
            <button
              type="button"
              className="hbtn"
              onClick={apply}
              disabled={!resultPayload || busy}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                fontWeight: 1000,
                opacity: !resultPayload || busy ? 0.7 : 1,
              }}
            >
              {t("coding.applyBack")}
            </button>

            {/* Console: stdout/stderr/error under preview */}
            <div style={{ border: "1px solid rgba(11, 15, 24, 0.12)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "6px 10px", fontSize: 11, fontWeight: 900, opacity: 0.75, borderBottom: "1px solid rgba(11, 15, 24, 0.12)" }}>
                {t("coding.console")}
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: 10,
                  background: "rgba(0,0,0,0.82)",
                  color: "#e5e7eb",
                  maxHeight: 220,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  fontSize: 12,
                  lineHeight: 1.4,
                }}
              >
                {status ? `[status] ${status}\n` : ""}
                {stdout ? stdout : ""}
                {stderr ? (stdout ? "\n" : "") + `[stderr]\n${stderr}` : ""}
                {error ? (stdout || stderr ? "\n" : "") + `[error]\n${error}` : ""}
                {!status && !stdout && !stderr && !error ? t("coding.console.empty") : ""}
              </pre>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
