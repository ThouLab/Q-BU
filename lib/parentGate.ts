import type { Lang } from "@/lib/i18n";

/**
 * Parent gate (kids mode)
 * - When language is `kana` (kids), selected actions can require a parent password.
 * - Settings are stored in localStorage.
 * - Unlock is stored in sessionStorage with an expiry time.
 */

export type ParentGateAction =
  | "print" // print request flow
  | "publish" // publish/unpublish a project
  | "delete" // delete a project
  | "download" // download .qbu
  | "subscribe" // future: subscription/payment flow
  | "change_language"; // switching language away from kids

export type ParentGateSettings = {
  /** sha256 hex string (lowercase). empty => not set */
  passwordHash: string;
  /** remember unlock for N minutes (session) */
  rememberMinutes: number;
  /** which actions require password (effective only in kids language) */
  require: Record<ParentGateAction, boolean>;
};

export const PARENT_GATE_STORAGE_KEY = "qbu_parent_gate_v1";
export const PARENT_GATE_UNLOCK_UNTIL_KEY = "qbu_parent_gate_unlock_until_v1";

export function defaultParentGateSettings(): ParentGateSettings {
  return {
    passwordHash: "",
    rememberMinutes: 10,
    require: {
      print: true,
      publish: true,
      delete: true,
      download: false,
      subscribe: true,
      change_language: true,
    },
  };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

export function loadParentGateSettings(): ParentGateSettings {
  const base = defaultParentGateSettings();
  if (typeof window === "undefined") return base;
  try {
    const raw = localStorage.getItem(PARENT_GATE_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return base;

    const out: ParentGateSettings = {
      passwordHash: typeof parsed.passwordHash === "string" ? parsed.passwordHash : base.passwordHash,
      rememberMinutes:
        typeof parsed.rememberMinutes === "number" && Number.isFinite(parsed.rememberMinutes)
          ? Math.max(0, Math.min(120, Math.floor(parsed.rememberMinutes)))
          : base.rememberMinutes,
      require: { ...base.require },
    };

    const req = parsed.require;
    if (isRecord(req)) {
      (Object.keys(base.require) as ParentGateAction[]).forEach((k) => {
        if (typeof req[k] === "boolean") out.require[k] = req[k] as boolean;
      });
    }
    return out;
  } catch {
    return base;
  }
}

export function saveParentGateSettings(next: ParentGateSettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PARENT_GATE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function getUnlockUntil(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = sessionStorage.getItem(PARENT_GATE_UNLOCK_UNTIL_KEY);
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function clearUnlock(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(PARENT_GATE_UNLOCK_UNTIL_KEY);
  } catch {
    // ignore
  }
}

export function isUnlockedNow(): boolean {
  const until = getUnlockUntil();
  return until > Date.now();
}

export function setUnlockedForMinutes(minutes: number): void {
  if (typeof window === "undefined") return;
  const ms = Math.max(0, Math.floor(minutes)) * 60 * 1000;
  const until = Date.now() + ms;
  try {
    sessionStorage.setItem(PARENT_GATE_UNLOCK_UNTIL_KEY, String(until));
  } catch {
    // ignore
  }
}

async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = enc.encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Ensure parent is unlocked (password prompt).
 * - If no password is set, returns true (no lock).
 */
export async function ensureParentUnlocked(opts: {
  lang: Lang;
  t: (key: string, vars?: Record<string, string | number>) => string;
}): Promise<boolean> {
  const { t } = opts;
  const s = loadParentGateSettings();
  if (!s.passwordHash) return true;
  if (isUnlockedNow()) return true;

  const pw = window.prompt(t("parent.prompt.enter")) ?? "";
  if (!pw) return false;
  try {
    const hash = await sha256Hex(pw);
    if (hash !== s.passwordHash) {
      window.alert(t("parent.prompt.wrong"));
      return false;
    }
    setUnlockedForMinutes(s.rememberMinutes);
    return true;
  } catch {
    window.alert(t("parent.prompt.failed"));
    return false;
  }
}

/**
 * Gate a specific action.
 * - Only active in kids language (kana)
 * - Effective only when password is set.
 */
export async function ensureParentGate(opts: {
  lang: Lang;
  t: (key: string, vars?: Record<string, string | number>) => string;
  action: ParentGateAction;
}): Promise<boolean> {
  const { lang, action, t } = opts;
  if (lang !== "kana") return true;
  const s = loadParentGateSettings();
  if (!s.require[action]) return true;
  // If password is not set, don't block (parent can configure later)
  if (!s.passwordHash) return true;
  return ensureParentUnlocked({ lang, t });
}

export async function setParentPassword(newPassword: string): Promise<string> {
  return sha256Hex(newPassword);
}
