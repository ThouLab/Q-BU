"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type ReactNode
} from "react";
import {
  COLOR_META,
  EDITOR_GRID_SIZE,
  EDITOR_MAX_BLOCKS,
  WORKSHOP_COLORS,
  initialModel,
  isWithinGrid,
  keyOf,
  normalizeModel,
  parseQbuFile,
  sanitizeQbuFileName,
  toBlockMap,
  type Coord,
  type VoxelBlock,
  type VoxelModel,
  type WorkshopColor
} from "@/components/standalone/editor-model";
import { buildStandaloneExport } from "@/components/standalone/export-archive";
import {
  STL_MAX_FILE_BYTES,
  voxelizeStlFile
} from "@/components/standalone/stl-voxel-client";
import VoxelStage, { type ExtendCandidate } from "@/components/standalone/VoxelStage";

type ToolMode = "add" | "remove" | "pan" | "rotate";
type SidebarSide = "left" | "right";
type HotkeyAction = "add" | "remove" | "pan" | "rotate" | "color" | "settings";
type HotkeyMap = Record<HotkeyAction, string>;
type DraftState = "loading" | "saving" | "saved" | "skipped" | "error";

type StlPlacement = {
  sourceName: string;
  voxels: Int16Array;
  offset: Coord;
  color: WorkshopColor;
  triangleCount: number;
  dimensions: Coord;
  bounds: { min: Coord; max: Coord };
};

const DRAFT_STORAGE_KEY = "qbu_standalone_draft_v1";
const PREFERENCES_STORAGE_KEY = "qbu_standalone_editor_settings_v1";
const FILE_NAME_STORAGE_KEY = "qbu_standalone_file_name_v1";
const BLOCK_SIZE_STORAGE_KEY = "qbu_standalone_block_size_mm_v1";
const MAX_QBU_IMPORT_FILE_BYTES = 100 * 1024 * 1024;
const MAX_LOCAL_BACKUP_BLOCKS = 20_000;
const EMPTY_VOXEL_MODEL: VoxelModel = { version: 1, blocks: [] };

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

const isStarterModel = (model: VoxelModel): boolean => {
  const block = model.blocks[0];
  return (
    model.blocks.length === 1 &&
    block.x === 0 &&
    block.y === 0 &&
    block.z === 0 &&
    block.color === "white"
  );
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
  disabled?: boolean;
  expanded: boolean;
  label: string;
  onClick: () => void;
};

function ToolButton({
  active = false,
  ariaLabel,
  children,
  className = "",
  disabled = false,
  expanded,
  label,
  onClick
}: ToolButtonProps) {
  return (
    <button
      aria-label={ariaLabel}
      className={["standalone-tool-button", active ? "active" : "", className].filter(Boolean).join(" ")}
      disabled={disabled}
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
  const [isPristineModel, setIsPristineModel] = useState(true);
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
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [fileName, setFileName] = useState("Q-BU");
  const [blockSizeMm, setBlockSizeMm] = useState("5");
  const [singleStlOnly, setSingleStlOnly] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isImportingStl, setIsImportingStl] = useState(false);
  const [stlPlacement, setStlPlacement] = useState<StlPlacement | null>(null);
  const [placementOffsetInputs, setPlacementOffsetInputs] = useState<Record<keyof Coord, string>>({
    x: "0",
    y: "0",
    z: "0"
  });
  const [frameRequest, setFrameRequest] = useState(0);
  const [downloadedAt, setDownloadedAt] = useState<string | null>(null);
  const fileNameInputRef = useRef<HTMLInputElement | null>(null);
  const qbuInputRef = useRef<HTMLInputElement | null>(null);
  const stlInputRef = useRef<HTMLInputElement | null>(null);
  const qbuImportChoiceRef = useRef<HTMLButtonElement | null>(null);
  const stlImportSequenceRef = useRef(0);
  const dragDepthRef = useRef(0);

  // All model entry points validate or create unique in-grid blocks. Keep the canonical
  // state by reference so large models are not copied and sorted again on every render.
  const normalizedModel = model;
  const hasStlPlacement = stlPlacement !== null;
  const placementBaseBlocks = useMemo(
    () => (isPristineModel && isStarterModel(normalizedModel) ? [] : normalizedModel.blocks),
    [isPristineModel, normalizedModel]
  );
  const stageModel = useMemo<VoxelModel>(
    () =>
      stlPlacement && placementBaseBlocks.length === 0 && isPristineModel
        ? EMPTY_VOXEL_MODEL
        : normalizedModel,
    [isPristineModel, normalizedModel, placementBaseBlocks.length, stlPlacement]
  );
  const occupiedKeys = useMemo(
    () =>
      hasStlPlacement
        ? new Set(placementBaseBlocks.map((block) => keyOf(block)))
        : new Set<string>(),
    [hasStlPlacement, placementBaseBlocks]
  );
  const stlPreview = useMemo(() => {
    const previewBlocks: VoxelBlock[] = [];
    const addableBlocks: VoxelBlock[] = [];
    let collisionCount = 0;
    let outOfBoundsCount = 0;
    if (!stlPlacement) {
      return { previewBlocks, addableBlocks, collisionCount, outOfBoundsCount, limitExceeded: false };
    }

    for (let index = 0; index < stlPlacement.voxels.length; index += 3) {
      const block: VoxelBlock = {
        x: stlPlacement.voxels[index] + stlPlacement.offset.x,
        y: stlPlacement.voxels[index + 1] + stlPlacement.offset.y,
        z: stlPlacement.voxels[index + 2] + stlPlacement.offset.z,
        color: stlPlacement.color
      };
      if (!isWithinGrid(block, EDITOR_GRID_SIZE)) {
        outOfBoundsCount += 1;
        continue;
      }
      previewBlocks.push(block);
      if (occupiedKeys.has(keyOf(block))) collisionCount += 1;
      else addableBlocks.push(block);
    }

    return {
      previewBlocks,
      addableBlocks,
      collisionCount,
      outOfBoundsCount,
      limitExceeded: placementBaseBlocks.length + addableBlocks.length > EDITOR_MAX_BLOCKS
    };
  }, [occupiedKeys, placementBaseBlocks.length, stlPlacement]);

  const placementOffsetLimits = useMemo(() => {
    if (!stlPlacement) return null;
    const radius = Math.floor(EDITOR_GRID_SIZE / 2);
    return {
      x: { min: -radius - stlPlacement.bounds.min.x, max: radius - 1 - stlPlacement.bounds.max.x },
      y: { min: -radius - stlPlacement.bounds.min.y, max: radius - 1 - stlPlacement.bounds.max.y },
      z: { min: -radius - stlPlacement.bounds.min.z, max: radius - 1 - stlPlacement.bounds.max.z }
    };
  }, [stlPlacement]);
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
      if (raw) {
        const restoredModel = normalizeModel(JSON.parse(raw));
        setModel(restoredModel);
        setIsPristineModel(isStarterModel(restoredModel));
        setFrameRequest((current) => current + 1);
      }
      setDraftState("saved");
    } catch {
      setModel(initialModel());
      setIsPristineModel(true);
      setDraftState("error");
    } finally {
      setDraftHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!draftHydrated) return;
    if (normalizedModel.blocks.length > MAX_LOCAL_BACKUP_BLOCKS) {
      try {
        window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch {
        // Large models stay editable even when browser storage is unavailable.
      }
      setDraftState("skipped");
      return;
    }
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
      const savedBlockSize = Number(window.localStorage.getItem(BLOCK_SIZE_STORAGE_KEY));
      if (Number.isFinite(savedBlockSize) && savedBlockSize >= 0.1 && savedBlockSize <= 100) {
        setBlockSizeMm(String(savedBlockSize));
      }
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

  useEffect(() => {
    if (!showImportDialog) return;
    window.setTimeout(() => qbuImportChoiceRef.current?.focus(), 0);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowImportDialog(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showImportDialog]);

  const handleModelChange = useCallback((nextModel: VoxelModel) => {
    setDownloadedAt(null);
    setIsPristineModel(false);
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
        showImportDialog ||
        isImportingStl ||
        stlPlacement ||
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
  }, [
    extendCandidate,
    hotkeys,
    isImportingStl,
    runHotkeyAction,
    showImportDialog,
    showSaveDialog,
    showUserSettings,
    stlPlacement
  ]);

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

  const importQbuFile = useCallback(async (file: File) => {
    if (!/\.qbu$/i.test(file.name)) {
      window.alert("拡張子が.qbuのファイルを選択してください。");
      return;
    }
    if (file.size > MAX_QBU_IMPORT_FILE_BYTES) {
      window.alert("QBUファイルが大きすぎます（上限100MB）。");
      return;
    }

    try {
      const imported = await parseQbuFile(file);
      if (!window.confirm("現在の作品を、選択したQBUの内容で置き換えますか？")) return;
      setExtendCandidate(null);
      setStlPlacement(null);
      setShowImportDialog(false);
      setShowUserSettings(false);
      setShowSaveDialog(false);
      handleModelChange(imported.model);
      setFrameRequest((current) => current + 1);
      const importedName =
        imported.fileName ?? sanitizeQbuFileName(file.name.replace(/\.qbu$/i, ""));
      setFileName(importedName);
      try {
        window.localStorage.setItem(FILE_NAME_STORAGE_KEY, importedName);
      } catch {
        // Import remains usable when browser storage is unavailable.
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "QBUファイルを読み込めませんでした。");
    }
  }, [handleModelChange]);

  const importQbu = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (file) await importQbuFile(file);
  };

  const importStlFile = useCallback(async (file: File) => {
    if (!/\.stl$/i.test(file.name)) {
      window.alert("拡張子が.stlのファイルを選択してください。");
      return;
    }
    if (file.size > STL_MAX_FILE_BYTES) {
      window.alert(
        `STLファイルが大きすぎます（上限${Math.floor(STL_MAX_FILE_BYTES / 1024 / 1024)}MB）。`
      );
      return;
    }

    setShowImportDialog(false);
    setShowUserSettings(false);
    setShowSaveDialog(false);
    setExtendCandidate(null);
    setIsImportingStl(true);
    const importSequence = stlImportSequenceRef.current + 1;
    stlImportSequenceRef.current = importSequence;
    try {
      const result = await voxelizeStlFile(file);
      if (stlImportSequenceRef.current !== importSequence) return;
      if (result.voxelCount <= 0 || result.voxels.length === 0) {
        throw new Error("STLから表面ボクセルを作成できませんでした。");
      }
      const initialOffset = {
        x: -Math.round((result.bounds.min.x + result.bounds.max.x) / 2),
        y: -result.bounds.min.y,
        z: -Math.round((result.bounds.min.z + result.bounds.max.z) / 2)
      };
      setStlPlacement({
        sourceName: file.name,
        voxels: result.voxels,
        offset: initialOffset,
        color,
        triangleCount: result.triangleCount,
        dimensions: result.dimensions,
        bounds: result.bounds
      });
      setPlacementOffsetInputs({
        x: String(initialOffset.x),
        y: String(initialOffset.y),
        z: String(initialOffset.z)
      });
      setToolMode("rotate");
      setFrameRequest((current) => current + 1);
    } catch (error) {
      if (stlImportSequenceRef.current !== importSequence) return;
      window.alert(error instanceof Error ? error.message : "STLファイルを読み込めませんでした。");
    } finally {
      if (stlImportSequenceRef.current === importSequence) setIsImportingStl(false);
    }
  }, [color]);

  const importStl = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (file) await importStlFile(file);
  };

  const setPlacementAxis = useCallback((axis: keyof Coord, value: number) => {
    if (!stlPlacement || !Number.isFinite(value)) return;
    const radius = Math.floor(EDITOR_GRID_SIZE / 2);
    const minimum = -radius - stlPlacement.bounds.min[axis];
    const maximum = radius - 1 - stlPlacement.bounds.max[axis];
    const nextValue = Math.min(maximum, Math.max(minimum, Math.trunc(value)));
    setStlPlacement((current) =>
      current ? { ...current, offset: { ...current.offset, [axis]: nextValue } } : current
    );
    setPlacementOffsetInputs((inputs) => ({ ...inputs, [axis]: String(nextValue) }));
  }, [stlPlacement]);

  const placeStl = useCallback(() => {
    if (
      !stlPlacement ||
      stlPreview.outOfBoundsCount > 0 ||
      stlPreview.limitExceeded ||
      stlPreview.addableBlocks.length === 0
    ) {
      return;
    }
    handleModelChange({
      version: 1,
      blocks: [...placementBaseBlocks, ...stlPreview.addableBlocks]
    });
    setStlPlacement(null);
  }, [handleModelChange, placementBaseBlocks, stlPlacement, stlPreview]);

  const isFileDrag = (event: ReactDragEvent<HTMLElement>): boolean =>
    Array.from(event.dataTransfer.types).includes("Files");

  const handleQbuDragEnter = (event: ReactDragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setIsDragActive(true);
  };

  const handleQbuDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleQbuDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    if (!isFileDrag(event) && dragDepthRef.current === 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragActive(false);
  };

  const handleQbuDrop = async (event: ReactDragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragActive(false);

    if (isImportingStl) {
      window.alert("STLを変換中です。完了してから次のファイルを読み込んでください。");
      return;
    }

    const files = Array.from(event.dataTransfer.files);
    if (files.length !== 1) {
      window.alert(".qbuまたは.stlファイルを1つだけドロップしてください。");
      return;
    }
    const file = files[0];
    setShowImportDialog(false);
    if (/\.qbu$/i.test(file.name)) {
      await importQbuFile(file);
      return;
    }
    if (/\.stl$/i.test(file.name)) {
      await importStlFile(file);
      return;
    }
    window.alert("読み込める形式は.qbuまたは.stlです。");
  };

  const saveQbu = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isExporting) return;
    setIsExporting(true);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    try {
      const safeFileName = sanitizeQbuFileName(fileName);
      const sizeMm = Number(blockSizeMm);
      const exportedFile = await buildStandaloneExport({
        fileName: safeFileName,
        blockSizeMm: sizeMm,
        model: normalizedModel,
        singleStlOnly
      });
      downloadBlob(exportedFile.blob, exportedFile.fileName);
      setFileName(safeFileName);
      setBlockSizeMm(String(sizeMm));
      setDownloadedAt(new Date().toISOString());
      setShowSaveDialog(false);
      try {
        window.localStorage.setItem(FILE_NAME_STORAGE_KEY, safeFileName);
        window.localStorage.setItem(BLOCK_SIZE_STORAGE_KEY, String(sizeMm));
      } catch {
        // File download does not depend on browser storage.
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "ファイルを書き出せませんでした。");
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
          ? "保存済み"
          : draftState === "skipped"
            ? "大規模作品のため自動保存対象外"
          : "端末内の自動保存に失敗";

  return (
    <main
      className="standalone-editor"
      onContextMenu={(event) => event.preventDefault()}
      onDragEnter={handleQbuDragEnter}
      onDragLeave={handleQbuDragLeave}
      onDragOver={handleQbuDragOver}
      onDrop={handleQbuDrop}
    >
      <header className="standalone-editor-header">
        <div className="standalone-brand-mark">
          <span className="standalone-brand-dot" />
          Q-BU
        </div>
        <button
          className="standalone-save-button"
          disabled={isImportingStl || Boolean(stlPlacement)}
          onClick={() => setShowSaveDialog(true)}
          type="button"
        >
          書き出し
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
          disabled={Boolean(stlPlacement) || isImportingStl}
          expanded={toolbarExpanded}
          label="ブロックの追加"
          onClick={() => setToolMode("add")}
        >
          ＋
        </ToolButton>
        <ToolButton
          ariaLabel="ブロックの削除"
          active={toolMode === "remove"}
          disabled={Boolean(stlPlacement) || isImportingStl}
          expanded={toolbarExpanded}
          label="ブロックの削除"
          onClick={() => setToolMode("remove")}
        >
          −
        </ToolButton>
        <ToolButton
          ariaLabel="視点の移動"
          active={toolMode === "pan"}
          disabled={isImportingStl}
          expanded={toolbarExpanded}
          label="視点の移動"
          onClick={() => setToolMode("pan")}
        >
          <PanIcon />
        </ToolButton>
        <ToolButton
          ariaLabel="視点の回転"
          active={toolMode === "rotate"}
          disabled={isImportingStl}
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
              disabled={Boolean(stlPlacement) || isImportingStl}
              expanded
              label="色の切り替え"
              onClick={() => setColor(nextColor(color))}
            >
              {COLOR_META[color].label}
            </ToolButton>
            <ToolButton
              ariaLabel="ファイルをインポート"
              disabled={Boolean(stlPlacement) || isImportingStl}
              expanded
              label="インポート"
              onClick={() => setShowImportDialog(true)}
            >
              ↓
            </ToolButton>
            <ToolButton
              ariaLabel="ユーザー設定"
              disabled={Boolean(stlPlacement) || isImportingStl}
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

      <input
        accept=".qbu"
        aria-label=".qbuファイルを選択"
        className="standalone-visually-hidden"
        onChange={importQbu}
        ref={qbuInputRef}
        tabIndex={-1}
        type="file"
      />
      <input
        accept=".stl"
        aria-label=".stlファイルを選択"
        className="standalone-visually-hidden"
        onChange={importStl}
        ref={stlInputRef}
        tabIndex={-1}
        type="file"
      />

      {isDragActive && (
        <div aria-live="polite" className="standalone-drop-overlay" role="status">
          <div className="standalone-drop-message">
            <strong>.qbu または .stl をここにドロップ</strong>
            <span>ファイル形式を自動判定して読み込みます</span>
          </div>
        </div>
      )}

      <VoxelStage
        model={stageModel}
        previewBlocks={stlPreview.previewBlocks}
        interactionLocked={Boolean(stlPlacement) || isImportingStl}
        frameRequest={frameRequest}
        toolMode={toolMode}
        color={color}
        gridSize={EDITOR_GRID_SIZE}
        maxBlocks={EDITOR_MAX_BLOCKS}
        onChange={handleModelChange}
        onExtendCandidate={openExtendCandidate}
      />

      {stlPlacement && placementOffsetLimits && (
        <section
          aria-label="STLの配置"
          className={`standalone-placement-panel ${sidebarSide === "left" ? "right" : "left"}`}
        >
          <div>
            <h2>STLを配置</h2>
            <p className="standalone-placement-help" title={stlPlacement.sourceName}>
              {stlPlacement.sourceName}
            </p>
          </div>
          <div className="standalone-placement-summary">
            <span>
              サイズ {stlPlacement.dimensions.x}×{stlPlacement.dimensions.y}×{stlPlacement.dimensions.z}
            </span>
            <span>{stlPlacement.voxels.length / 3} ボクセル</span>
            <span>{stlPlacement.triangleCount.toLocaleString()} 三角形</span>
            <span>{stlPreview.addableBlocks.length.toLocaleString()} 個を追加</span>
          </div>
          <div className="standalone-field">
            単色
            <div className="standalone-color-options">
              {WORKSHOP_COLORS.map((stlColor) => (
                <button
                  aria-pressed={stlPlacement.color === stlColor}
                  className={`standalone-color-choice ${stlPlacement.color === stlColor ? "active" : ""}`}
                  key={stlColor}
                  onClick={() =>
                    setStlPlacement((current) => current && { ...current, color: stlColor })
                  }
                  type="button"
                >
                  <span
                    className="standalone-color-dot"
                    style={{ background: COLOR_META[stlColor].hex }}
                  />
                  {COLOR_META[stlColor].label}
                </button>
              ))}
            </div>
          </div>
          <div className="standalone-field">
            XYZ位置
            <div className="standalone-axis-grid">
              {(["x", "y", "z"] as const).map((axis) => {
                const limits = placementOffsetLimits[axis];
                const value = stlPlacement.offset[axis];
                return (
                  <div className="standalone-axis-row" key={axis}>
                    <span>{axis.toUpperCase()}</span>
                    <button
                      aria-label={`${axis.toUpperCase()}を1減らす`}
                      disabled={value <= limits.min}
                      onClick={() => setPlacementAxis(axis, value - 1)}
                      type="button"
                    >
                      −
                    </button>
                    <input
                      aria-label={`${axis.toUpperCase()}位置`}
                      autoComplete="off"
                      inputMode="text"
                      onBlur={() => {
                        const parsed = Number.parseInt(placementOffsetInputs[axis], 10);
                        setPlacementAxis(axis, Number.isFinite(parsed) ? parsed : value);
                      }}
                      onChange={(event) => {
                        if (/^-?\d*$/.test(event.target.value)) {
                          setPlacementOffsetInputs((inputs) => ({
                            ...inputs,
                            [axis]: event.target.value
                          }));
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      pattern="-?[0-9]*"
                      spellCheck={false}
                      type="text"
                      value={placementOffsetInputs[axis]}
                    />
                    <button
                      aria-label={`${axis.toUpperCase()}を1増やす`}
                      disabled={value >= limits.max}
                      onClick={() => setPlacementAxis(axis, value + 1)}
                      type="button"
                    >
                      ＋
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          {stlPreview.collisionCount > 0 && (
            <div className="standalone-notice">
              既存ブロックと重なる{stlPreview.collisionCount.toLocaleString()}個は変更せずに配置します。
            </div>
          )}
          {stlPreview.outOfBoundsCount > 0 && (
            <div className="standalone-notice">
              編集範囲外のボクセルが{stlPreview.outOfBoundsCount.toLocaleString()}個あります。
            </div>
          )}
          {stlPreview.limitExceeded && (
            <div className="standalone-notice">
              配置すると上限{EDITOR_MAX_BLOCKS.toLocaleString()}個を超えます。
            </div>
          )}
          <p className="standalone-placement-help">
            半透明表示はプレビューです。確定するまで現在の作品は変更されません。
          </p>
          <div className="standalone-row">
            <button
              className="standalone-button"
              disabled={
                stlPreview.outOfBoundsCount > 0 ||
                stlPreview.limitExceeded ||
                stlPreview.addableBlocks.length === 0
              }
              onClick={placeStl}
              type="button"
            >
              この位置に配置
            </button>
            <button
              className="standalone-button ghost"
              onClick={() => setStlPlacement(null)}
              type="button"
            >
              キャンセル
            </button>
          </div>
        </section>
      )}

      {!stlPlacement && <div className="standalone-editor-hint">{TOOL_MODE_LABELS[toolMode]}</div>}

      <span
        aria-live="polite"
        className={[
          "standalone-save-badge",
          sidebarSide === "right" ? "left" : "right",
          draftState === "error" ? "danger" : ""
        ].join(" ")}
      >
        {downloadedAt ? "書き出し済み・" : ""}
        {draftLabel}（{normalizedModel.blocks.length}個）
      </span>

      {showImportDialog && (
        <div className="standalone-editor-overlay">
          <section
            aria-labelledby="standalone-import-title"
            aria-modal="true"
            className="standalone-editor-modal standalone-stack"
            role="dialog"
          >
            <div>
              <h2 id="standalone-import-title">インポート</h2>
              <p className="standalone-muted">読み込むファイル形式を選択してください。</p>
            </div>
            <div className="standalone-import-options">
              <button
                className="standalone-import-choice"
                onClick={() => {
                  setShowImportDialog(false);
                  qbuInputRef.current?.click();
                }}
                ref={qbuImportChoiceRef}
                type="button"
              >
                <strong>.qbu</strong>
                <small>保存済みのQ-BU作品で、現在の作品を置き換えます。</small>
              </button>
              <button
                className="standalone-import-choice"
                onClick={() => {
                  setShowImportDialog(false);
                  stlInputRef.current?.click();
                }}
                type="button"
              >
                <strong>.stl</strong>
                <small>表面を最長辺40でボクセル化し、位置を決めて作品へ追加します。</small>
              </button>
            </div>
            <button
              className="standalone-button ghost"
              onClick={() => setShowImportDialog(false)}
              type="button"
            >
              キャンセル
            </button>
          </section>
        </div>
      )}

      {isImportingStl && (
        <div aria-live="polite" className="standalone-editor-overlay" role="status">
          <section className="standalone-editor-modal standalone-stack">
            <h2>STLを変換中…</h2>
            <p>表面の形状を解析し、最長辺40のボクセルプレビューを作成しています。</p>
          </section>
        </div>
      )}

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
              <h2>作品を書き出し</h2>
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
              </div>
            </label>
            <label className="standalone-field">
              1ブロックあたりの長さ（mm）
              <input
                aria-label="1ブロックあたりの長さ"
                className="standalone-input"
                inputMode="decimal"
                max="100"
                min="0.1"
                onChange={(event) => setBlockSizeMm(event.target.value)}
                required
                step="0.1"
                type="number"
                value={blockSizeMm}
              />
            </label>
            <label className="standalone-export-option">
              <input
                checked={singleStlOnly}
                className="standalone-checkbox"
                onChange={(event) => setSingleStlOnly(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>1つのSTLで出力</strong>
                <small>すべての色を単色として統合した全体STLだけをダウンロードします</small>
              </span>
            </label>
            <div className="standalone-row">
              <button className="standalone-button" disabled={isExporting} type="submit">
                {isExporting
                  ? "作成中…"
                  : singleStlOnly
                    ? "STLをダウンロード"
                    : "ZIPをダウンロード"}
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
