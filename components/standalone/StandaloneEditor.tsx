"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import {
  COLOR_META,
  EDITOR_GRID_SIZE,
  EDITOR_MAX_BLOCKS,
  WORKSHOP_COLORS,
  buildStandaloneQbu,
  initialModel,
  isWithinGrid,
  keyOf,
  normalizeModel,
  sanitizeQbuFileName,
  toBlockMap,
  type Coord,
  type VoxelModel,
  type WorkshopColor
} from "@/components/standalone/editor-model";
import VoxelStage, { type ExtendCandidate } from "@/components/standalone/VoxelStage";

type ToolMode = "add" | "remove" | "pan" | "rotate";
type SidebarSide = "left" | "right";
type HotkeyAction = "add" | "remove" | "pan" | "rotate" | "color" | "settings";
type HotkeyMap = Record<HotkeyAction, string>;
type DraftState = "loading" | "saving" | "saved" | "error";

const DRAFT_STORAGE_KEY = "qbu_standalone_draft_v1";
const PREFERENCES_STORAGE_KEY = "qbu_standalone_editor_settings_v1";
const FILE_NAME_STORAGE_KEY = "qbu_standalone_file_name_v1";

const HOTKEY_ITEMS: Array<{ action: HotkeyAction; label: string }> = [
  { action: "add", label: "追加" },
  { action: "remove", label: "削除" },
  { action: "pan", label: "移動" },
  { action: "rotate", label: "回転" },
  { action: "color", label: "色切り替え" },
  { action: "settings", label: "設定を開く" }
];

const DEFAULT_HOTKEYS: HotkeyMap = {
  add: "A",
  remove: "D",
  pan: "M",
  rotate: "R",
  color: "C",
  settings: "S"
};

const TOOL_MODE_LABELS: Record<ToolMode, string> = {
  add: "ブロックの追加",
  remove: "ブロックの削除",
  pan: "視点の移動",
  rotate: "視点の回転"
};

const nextColor = (color: WorkshopColor): WorkshopColor => {
  const index = WORKSHOP_COLORS.indexOf(color);
  return WORKSHOP_COLORS[(index + 1) % WORKSHOP_COLORS.length];
};

const normalizeHotkey = (value: string): string => {
  const firstCharacter = Array.from(value.trim())[0];
  return firstCharacter ? firstCharacter.toUpperCase() : "";
};

const normalizePressedKey = (key: string): string => {
  if (Array.from(key).length !== 1) return "";
  return normalizeHotkey(key);
};

const normalizeHotkeys = (source?: Partial<Record<HotkeyAction, string>>): HotkeyMap => {
  const next = { ...DEFAULT_HOTKEYS };
  const used = new Set<string>();
  for (const { action } of HOTKEY_ITEMS) {
    const hotkey = normalizeHotkey(source?.[action] ?? next[action]);
    if (!hotkey || used.has(hotkey)) {
      next[action] = "";
      continue;
    }
    next[action] = hotkey;
    used.add(hotkey);
  }
  return next;
};

const isTextInputTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
};

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
      anchor.remove();
    }, 0);
  }
};

function PanIcon() {
  return (
    <svg className="standalone-tool-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3v18M12 3 9 6M12 3l3 3M12 21l-3-3M12 21l3-3M3 12h18M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
    </svg>
  );
}

function RotateIcon() {
  return (
    <svg className="standalone-tool-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M17.5 6.2A7 7 0 1 0 19 12" />
      <path d="M17.5 6.2h-4M17.5 6.2V2.5" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg
      className="standalone-tool-icon standalone-gear-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.2a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4A2 2 0 0 0 4 9.8l.2.1a2 2 0 0 1 1 1.7v.6a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.2a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.2a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.6a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.2a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2Z" />
    </svg>
  );
}

function ToolbarToggleIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <svg className="standalone-tool-toggle-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={direction === "up" ? "M12 5 4 17h16Z" : "M12 19 4 7h16Z"} />
    </svg>
  );
}

type ToolButtonProps = {
  active?: boolean;
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  expanded: boolean;
  label: string;
  onClick: () => void;
};

function ToolButton({
  active = false,
  ariaLabel,
  children,
  className = "",
  expanded,
  label,
  onClick
}: ToolButtonProps) {
  return (
    <button
      aria-label={ariaLabel}
      className={["standalone-tool-button", active ? "active" : "", className].filter(Boolean).join(" ")}
      onClick={onClick}
      type="button"
    >
      <span className="standalone-tool-button-icon">{children}</span>
      {expanded && <span className="standalone-tool-button-label">{label}</span>}
    </button>
  );
}

export default function StandaloneEditor() {
  const [model, setModel] = useState<VoxelModel>(() => initialModel());
  const [draftState, setDraftState] = useState<DraftState>("loading");
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [toolMode, setToolMode] = useState<ToolMode>("add");
  const [color, setColor] = useState<WorkshopColor>("white");
  const [extendCandidate, setExtendCandidate] = useState<ExtendCandidate | null>(null);
  const [extendCount, setExtendCount] = useState("1");
  const [sidebarSide, setSidebarSide] = useState<SidebarSide>("left");
  const [toolbarExpanded, setToolbarExpanded] = useState(false);
  const [hotkeys, setHotkeys] = useState<HotkeyMap>(DEFAULT_HOTKEYS);
  const [preferencesHydrated, setPreferencesHydrated] = useState(false);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [fileName, setFileName] = useState("Q-BU");
  const [isExporting, setIsExporting] = useState(false);
  const [downloadedAt, setDownloadedAt] = useState<string | null>(null);
  const fileNameInputRef = useRef<HTMLInputElement | null>(null);

  const normalizedModel = useMemo(() => normalizeModel(model), [model]);
  const extendLimit = useMemo(() => {
    if (!extendCandidate) return 0;
    const map = toBlockMap(normalizedModel);
    let count = 0;
    for (let step = 1; map.size + count < EDITOR_MAX_BLOCKS; step += 1) {
      const target = {
        x: extendCandidate.from.x + extendCandidate.normal.x * step,
        y: extendCandidate.from.y + extendCandidate.normal.y * step,
        z: extendCandidate.from.z + extendCandidate.normal.z * step
      };
      if (!isWithinGrid(target, EDITOR_GRID_SIZE) || map.has(keyOf(target))) break;
      count += 1;
    }
    return count;
  }, [extendCandidate, normalizedModel]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) setModel(normalizeModel(JSON.parse(raw)));
      setDraftState("saved");
    } catch {
      setModel(initialModel());
      setDraftState("error");
    } finally {
      setDraftHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!draftHydrated) return;
    setDraftState("saving");
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(normalizedModel));
        setDraftState("saved");
      } catch {
        setDraftState("error");
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [draftHydrated, normalizedModel]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          hotkeys?: Partial<Record<HotkeyAction, string>>;
          sidebarSide?: SidebarSide;
          toolbarExpanded?: boolean;
        };
        if (parsed.sidebarSide === "left" || parsed.sidebarSide === "right") {
          setSidebarSide(parsed.sidebarSide);
        }
        if (typeof parsed.toolbarExpanded === "boolean") {
          setToolbarExpanded(parsed.toolbarExpanded);
        }
        setHotkeys(normalizeHotkeys(parsed.hotkeys));
      }
      const savedFileName = window.localStorage.getItem(FILE_NAME_STORAGE_KEY);
      if (savedFileName) setFileName(sanitizeQbuFileName(savedFileName));
    } catch {
      setSidebarSide("left");
      setToolbarExpanded(false);
      setHotkeys(DEFAULT_HOTKEYS);
    } finally {
      setPreferencesHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!preferencesHydrated) return;
    try {
      window.localStorage.setItem(
        PREFERENCES_STORAGE_KEY,
        JSON.stringify({ hotkeys, sidebarSide, toolbarExpanded })
      );
    } catch {
      // The editor remains usable when browser storage is unavailable.
    }
  }, [hotkeys, preferencesHydrated, sidebarSide, toolbarExpanded]);

  useEffect(() => {
    if (!showSaveDialog) return;
    window.setTimeout(() => fileNameInputRef.current?.select(), 0);
  }, [showSaveDialog]);

  const handleModelChange = useCallback((nextModel: VoxelModel) => {
    setDownloadedAt(null);
    setModel(nextModel);
  }, []);

  const openExtendCandidate = useCallback((candidate: ExtendCandidate) => {
    setExtendCandidate(candidate);
    setExtendCount("1");
  }, []);

  const setHotkey = useCallback((action: HotkeyAction, value: string) => {
    const hotkey = normalizeHotkey(value);
    setHotkeys((current) => {
      const next = { ...current, [action]: hotkey };
      if (hotkey) {
        for (const item of HOTKEY_ITEMS) {
          if (item.action !== action && next[item.action] === hotkey) next[item.action] = "";
        }
      }
      return next;
    });
  }, []);

  const runHotkeyAction = useCallback((action: HotkeyAction) => {
    if (action === "add") setToolMode("add");
    if (action === "remove") setToolMode("remove");
    if (action === "pan") setToolMode("pan");
    if (action === "rotate") setToolMode("rotate");
    if (action === "color") setColor((currentColor) => nextColor(currentColor));
    if (action === "settings") setShowUserSettings(true);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        showUserSettings ||
        showSaveDialog ||
        extendCandidate ||
        isTextInputTarget(event.target)
      ) {
        return;
      }
      const pressedKey = normalizePressedKey(event.key);
      if (!pressedKey) return;
      const item = HOTKEY_ITEMS.find(({ action }) => hotkeys[action] === pressedKey);
      if (!item) return;
      event.preventDefault();
      runHotkeyAction(item.action);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [extendCandidate, hotkeys, runHotkeyAction, showSaveDialog, showUserSettings]);

  const applyExtend = () => {
    if (!extendCandidate) return;
    if (extendLimit <= 0) {
      setExtendCandidate(null);
      return;
    }
    const count = Math.min(Math.max(1, Number.parseInt(extendCount, 10) || 1), extendLimit);
    const map = toBlockMap(normalizedModel);
    for (let index = 1; index <= count; index += 1) {
      if (map.size >= EDITOR_MAX_BLOCKS) break;
      const target: Coord = {
        x: extendCandidate.from.x + extendCandidate.normal.x * index,
        y: extendCandidate.from.y + extendCandidate.normal.y * index,
        z: extendCandidate.from.z + extendCandidate.normal.z * index
      };
      if (!isWithinGrid(target, EDITOR_GRID_SIZE) || map.has(keyOf(target))) break;
      map.set(keyOf(target), { ...target, color });
    }
    handleModelChange({ version: 1, blocks: [...map.values()] });
    setExtendCandidate(null);
  };

  const saveQbu = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isExporting) return;
    setIsExporting(true);
    try {
      const safeFileName = sanitizeQbuFileName(fileName);
      const payload = buildStandaloneQbu(safeFileName, normalizedModel);
      const json = `${JSON.stringify(payload, null, 2)}\n`;
      downloadBlob(new Blob([json], { type: "application/json;charset=utf-8" }), `${safeFileName}.qbu`);
      setFileName(safeFileName);
      setDownloadedAt(new Date().toISOString());
      setShowSaveDialog(false);
      try {
        window.localStorage.setItem(FILE_NAME_STORAGE_KEY, safeFileName);
      } catch {
        // File download does not depend on browser storage.
      }
    } finally {
      setIsExporting(false);
    }
  };

  const draftLabel =
    draftState === "loading"
      ? "復元中"
      : draftState === "saving"
        ? "端末内に自動保存中"
        : draftState === "saved"
          ? "端末内に自動保存済み"
          : "端末内の自動保存に失敗";

  return (
    <main className="standalone-editor" onContextMenu={(event) => event.preventDefault()}>
      <header className="standalone-editor-header">
        <div className="standalone-brand-mark">
          <span className="standalone-brand-dot" />
          Q-BU
        </div>
        <button className="standalone-save-button" onClick={() => setShowSaveDialog(true)} type="button">
          保存
        </button>
      </header>

      <nav
        className={[
          "standalone-tool-rail",
          sidebarSide,
          toolbarExpanded ? "expanded" : "collapsed"
        ].join(" ")}
        aria-label="編集ツール"
      >
        {!toolbarExpanded && (
          <button
            aria-label="ツールバーを展開"
            className="standalone-tool-toggle"
            onClick={() => setToolbarExpanded(true)}
            type="button"
          >
            <ToolbarToggleIcon direction="up" />
          </button>
        )}
        <ToolButton
          ariaLabel="ブロックの追加"
          active={toolMode === "add"}
          expanded={toolbarExpanded}
          label="ブロックの追加"
          onClick={() => setToolMode("add")}
        >
          ＋
        </ToolButton>
        <ToolButton
          ariaLabel="ブロックの削除"
          active={toolMode === "remove"}
          expanded={toolbarExpanded}
          label="ブロックの削除"
          onClick={() => setToolMode("remove")}
        >
          −
        </ToolButton>
        <ToolButton
          ariaLabel="視点の移動"
          active={toolMode === "pan"}
          expanded={toolbarExpanded}
          label="視点の移動"
          onClick={() => setToolMode("pan")}
        >
          <PanIcon />
        </ToolButton>
        <ToolButton
          ariaLabel="視点の回転"
          active={toolMode === "rotate"}
          expanded={toolbarExpanded}
          label="視点の回転"
          onClick={() => setToolMode("rotate")}
        >
          <RotateIcon />
        </ToolButton>
        {toolbarExpanded && (
          <>
            <ToolButton
              ariaLabel={`色の切り替え（${COLOR_META[color].label}）`}
              className={`standalone-color-tool swatch-${color}`}
              expanded
              label="色の切り替え"
              onClick={() => setColor(nextColor(color))}
            >
              {COLOR_META[color].label}
            </ToolButton>
            <ToolButton
              ariaLabel="ユーザー設定"
              expanded
              label="ユーザー設定"
              onClick={() => setShowUserSettings(true)}
            >
              <GearIcon />
            </ToolButton>
          </>
        )}
        {toolbarExpanded && (
          <button
            aria-label="ツールバーを折りたたむ"
            className="standalone-tool-toggle"
            onClick={() => setToolbarExpanded(false)}
            type="button"
          >
            <ToolbarToggleIcon direction="down" />
          </button>
        )}
      </nav>

      <VoxelStage
        model={normalizedModel}
        toolMode={toolMode}
        color={color}
        gridSize={EDITOR_GRID_SIZE}
        maxBlocks={EDITOR_MAX_BLOCKS}
        onChange={handleModelChange}
        onExtendCandidate={openExtendCandidate}
      />

      <div className="standalone-editor-hint">{TOOL_MODE_LABELS[toolMode]}</div>

      <span
        aria-live="polite"
        className={[
          "standalone-save-badge",
          sidebarSide === "right" ? "left" : "right",
          draftState === "error" ? "danger" : ""
        ].join(" ")}
      >
        {downloadedAt ? "ファイル保存済み・" : ""}
        {draftLabel}（{normalizedModel.blocks.length}個）
      </span>

      {extendCandidate && (
        <div className="standalone-editor-overlay">
          <form
            className="standalone-editor-modal standalone-stack"
            onSubmit={(event) => {
              event.preventDefault();
              applyExtend();
            }}
          >
            <h2>追加するブロック数を指定</h2>
            {extendLimit <= 0 && <div className="standalone-notice">これ以上追加できません。</div>}
            <label className="standalone-field">
              個数
              <input
                className="standalone-input"
                disabled={extendLimit <= 0}
                inputMode="numeric"
                max={Math.max(1, extendLimit)}
                min="1"
                onChange={(event) => setExtendCount(event.target.value)}
                type="number"
                value={extendCount}
              />
            </label>
            <div className="standalone-row">
              <button className="standalone-button" disabled={extendLimit <= 0} type="submit">
                追加
              </button>
              <button
                className="standalone-button ghost"
                onClick={() => setExtendCandidate(null)}
                type="button"
              >
                キャンセル
              </button>
            </div>
          </form>
        </div>
      )}

      {showUserSettings && (
        <div className="standalone-editor-overlay">
          <section className="standalone-editor-modal standalone-stack">
            <h2>ユーザー設定</h2>
            <div className="standalone-field">
              サイドバー
              <div className="standalone-row">
                <button
                  className={`standalone-button ${sidebarSide === "left" ? "" : "secondary"}`}
                  onClick={() => setSidebarSide("left")}
                  type="button"
                >
                  左
                </button>
                <button
                  className={`standalone-button ${sidebarSide === "right" ? "" : "secondary"}`}
                  onClick={() => setSidebarSide("right")}
                  type="button"
                >
                  右
                </button>
              </div>
            </div>
            <div className="standalone-field">
              ホットキー
              <div className="standalone-hotkey-grid">
                {HOTKEY_ITEMS.map((item) => (
                  <label className="standalone-hotkey-field" key={item.action}>
                    <span>{item.label}</span>
                    <input
                      aria-label={`${item.label}のホットキー`}
                      autoCapitalize="characters"
                      className="standalone-hotkey-input"
                      maxLength={1}
                      onChange={(event) => setHotkey(item.action, event.target.value)}
                      onFocus={(event) => event.currentTarget.select()}
                      spellCheck={false}
                      value={hotkeys[item.action]}
                    />
                  </label>
                ))}
              </div>
              <button
                className="standalone-button ghost"
                onClick={() => setHotkeys({ ...DEFAULT_HOTKEYS })}
                type="button"
              >
                初期設定に戻す
              </button>
            </div>
            <button
              className="standalone-button secondary"
              onClick={() => setShowUserSettings(false)}
              type="button"
            >
              閉じる
            </button>
          </section>
        </div>
      )}

      {showSaveDialog && (
        <div className="standalone-editor-overlay">
          <form className="standalone-editor-modal standalone-stack" onSubmit={saveQbu}>
            <div>
              <h2>作品を保存</h2>
              <p className="standalone-muted">
                作成内容をこの端末へ .qbu ファイルとしてダウンロードします。
              </p>
            </div>
            <label className="standalone-field">
              ファイル名
              <div className="standalone-file-name-row">
                <input
                  aria-label="保存するファイル名"
                  className="standalone-input"
                  maxLength={84}
                  onChange={(event) => setFileName(event.target.value)}
                  ref={fileNameInputRef}
                  required
                  value={fileName}
                />
                <span>.qbu</span>
              </div>
            </label>
            <div className="standalone-row">
              <button className="standalone-button" disabled={isExporting} type="submit">
                {isExporting ? "保存中…" : "ダウンロード"}
              </button>
              <button
                className="standalone-button ghost"
                disabled={isExporting}
                onClick={() => setShowSaveDialog(false)}
                type="button"
              >
                キャンセル
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
