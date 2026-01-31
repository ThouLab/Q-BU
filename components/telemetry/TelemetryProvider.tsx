"use client";

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import ConsentModal from "@/components/account/ConsentModal";
import { useAuth } from "@/components/auth/AuthProvider";

export type TelemetryEvent = {
  name: string;
  ts: number;
  path: string;
  anon_id: string;
  session_id: string;
  user_id?: string | null;
  payload?: any;
};

export type TelemetryAPI = {
  /** 同意済みでイベント送信が有効か */
  enabled: boolean;
  /** 同意済みか（privacyページのUI用） */
  hasConsent: boolean;

  anonId: string;
  sessionId: string;

  track: (name: string, payload?: any) => void;

  /** 必須同意のUIを開く（通常は自動で出る） */
  openConsent: () => void;

  /** 同意を確定する（privacyページなどから呼べる） */
  grantConsent: () => void;
};

const TelemetryContext = createContext<TelemetryAPI | null>(null);

const CONSENT_KEY = "qbu_telemetry_consent_v2";
const ANON_KEY = "qbu_anon_id_v2";
const SESSION_KEY = "qbu_session_id_v2";
const CONSENT_VERSION = "v2";

function uuid(): string {
  try {
    const c: any = (globalThis as any).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    // ignore
  }
  // fallback (not RFC4122, but sufficiently random for analytics IDs)
  return "id-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
}

function safeGetLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetLocalStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function setCookie(name: string, value: string, days = 180) {
  try {
    const maxAge = days * 24 * 60 * 60;
    document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
  } catch {
    // ignore
  }
}

function getOrCreateAnonId(): string {
  const existing = safeGetLocalStorage(ANON_KEY);
  if (existing) return existing;
  const v = uuid();
  safeSetLocalStorage(ANON_KEY, v);
  setCookie("qbu_anon", v);
  return v;
}

function getOrCreateSessionId(): string {
  try {
    let v = sessionStorage.getItem(SESSION_KEY);
    if (!v) {
      v = uuid();
      sessionStorage.setItem(SESSION_KEY, v);
    }
    return v;
  } catch {
    return "mem-" + Math.random().toString(36).slice(2);
  }
}

function readConsent(): boolean {
  const v = safeGetLocalStorage(CONSENT_KEY);
  return v === "1";
}

async function collectClientInfo(): Promise<any> {
  const nav: any = typeof navigator !== "undefined" ? navigator : null;
  const scr: any = typeof screen !== "undefined" ? screen : null;

  const info: any = {
    consent_version: CONSENT_VERSION,
    ua: nav?.userAgent ?? "",
    lang: nav?.language ?? "",
    languages: nav?.languages ?? [],
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
    tz_offset_min: new Date().getTimezoneOffset(),
    platform: nav?.platform ?? "",
    vendor: nav?.vendor ?? "",
    cookie_enabled: nav?.cookieEnabled ?? null,
    do_not_track: (nav as any)?.doNotTrack ?? null,
    screen: scr
      ? {
          w: scr.width,
          h: scr.height,
          avail_w: scr.availWidth,
          avail_h: scr.availHeight,
          color_depth: scr.colorDepth,
          pixel_depth: scr.pixelDepth,
        }
      : null,
    viewport:
      typeof window !== "undefined"
        ? {
            w: window.innerWidth,
            h: window.innerHeight,
            dpr: window.devicePixelRatio ?? 1,
          }
        : null,
    hardware:
      nav
        ? {
            device_memory_gb: (nav as any).deviceMemory ?? null,
            cpu_cores: nav.hardwareConcurrency ?? null,
          }
        : null,
    connection: null as any,
    storage: null as any,
    webgl: null as any,
    referrer: typeof document !== "undefined" ? document.referrer ?? "" : "",
  };

  // Network Information API
  try {
    const c: any = (navigator as any).connection;
    if (c) {
      info.connection = {
        effective_type: c.effectiveType ?? null,
        downlink: c.downlink ?? null,
        rtt: c.rtt ?? null,
        save_data: c.saveData ?? null,
      };
    }
  } catch {
    // ignore
  }

  // Storage estimate
  try {
    if ((navigator as any).storage?.estimate) {
      const est = await (navigator as any).storage.estimate();
      info.storage = {
        quota: est?.quota ?? null,
        usage: est?.usage ?? null,
      };
    }
  } catch {
    // ignore
  }

  // WebGL renderer info (best-effort)
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")) as any;
    if (gl) {
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      if (dbg) {
        info.webgl = {
          vendor: gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) ?? null,
          renderer: gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? null,
        };
      }
    }
  } catch {
    // ignore
  }

  // Navigation timing (best-effort)
  try {
    const navEntry = performance.getEntriesByType("navigation")[0] as any;
    if (navEntry) {
      info.nav = {
        type: navEntry.type,
        dom_content_loaded: Math.round(navEntry.domContentLoadedEventEnd ?? 0),
        load: Math.round(navEntry.loadEventEnd ?? 0),
        ttfb: Math.round(navEntry.responseStart ?? 0),
      };
    }
    const paints = performance.getEntriesByType("paint") as any[];
    if (paints?.length) {
      const rec: any = {};
      for (const p of paints) rec[p.name] = Math.round(p.startTime ?? 0);
      info.paint = rec;
    }
  } catch {
    // ignore
  }

  return info;
}

export function TelemetryProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const isPrivacy = pathname === "/privacy";

  const [consented, setConsented] = useState<boolean>(false);
  const [consentReady, setConsentReady] = useState(false);
  const [consentModalOpen, setConsentModalOpen] = useState(false);

  const sessionId = useMemo(() => getOrCreateSessionId(), []);

  // 初回：同意状態を読み込む
  useEffect(() => {
    const ok = readConsent();
    setConsented(ok);
    setConsentReady(true);
  }, []);

  // 画面に応じてモーダルを出す/出さない
  useEffect(() => {
    if (!consentReady) return;
    if (consented) {
      setConsentModalOpen(false);
      return;
    }
    if (isPrivacy) {
      // privacyページでは文章を読めるように自動ポップアップしない
      setConsentModalOpen(false);
      return;
    }
    setConsentModalOpen(true);
  }, [consentReady, consented, isPrivacy]);

  // 同意後にのみ anonId を生成（同意前に識別子を作らない）
  const anonIdRef = useRef<string>("");
  useEffect(() => {
    if (!consented) return;
    if (!anonIdRef.current) {
      anonIdRef.current = getOrCreateAnonId();
    }
  }, [consented]);

  const enabled = consentReady && consented === true;
  const hasConsent = consented === true;

  const queueRef = useRef<TelemetryEvent[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // セッションカウンタ（summary用）
  const sessionStartMsRef = useRef<number>(Date.now());
  const countersRef = useRef<Record<string, number>>({});
  const seqRef = useRef(0);

  const flush = async (reason: "timer" | "unload" | "limit" = "timer") => {
    if (!enabledRef.current) {
      queueRef.current = [];
      return;
    }
    const batch = queueRef.current.splice(0, 80);
    if (batch.length === 0) return;

    const body = JSON.stringify({ events: batch, reason, v: 2 });

    try {
      // 離脱時は sendBeacon 優先
      if (reason === "unload" && typeof navigator !== "undefined" && "sendBeacon" in navigator) {
        const blob = new Blob([body], { type: "application/json" });
        (navigator as any).sendBeacon("/api/log", blob);
        return;
      }

      await fetch("/api/log", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-QBU-Consent": "1",
        },
        credentials: "include",
        body,
        keepalive: true,
      });
    } catch {
      // 送れなかったら破棄（UIを重くしない）
    }
  };

  const scheduleFlush = () => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(async () => {
      flushTimerRef.current = null;
      await flush("timer");
    }, 1200);
  };

  const track = (name: string, payload?: any) => {
    if (!enabledRef.current) return;
    const anon = anonIdRef.current;
    if (!anon) return;

    // counters
    countersRef.current[name] = (countersRef.current[name] ?? 0) + 1;
    seqRef.current += 1;

    const ev: TelemetryEvent = {
      name,
      ts: Date.now(),
      path: typeof window !== "undefined" ? window.location.pathname : "/",
      anon_id: anon,
      session_id: sessionId,
      user_id: user?.id ?? null,
      payload: payload ? { ...payload, seq: seqRef.current } : { seq: seqRef.current },
    };
    queueRef.current.push(ev);

    if (queueRef.current.length >= 32) {
      void flush("limit");
      return;
    }
    scheduleFlush();
  };

  const grantConsent = () => {
    safeSetLocalStorage(CONSENT_KEY, "1");
    setCookie("qbu_consent", "1");
    setConsented(true);
    setConsentModalOpen(false);

    // consent をDBに残す（失敗してもUXは継続）
    try {
      const anon = getOrCreateAnonId();
      fetch("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anon_id: anon, consent: true, version: CONSENT_VERSION }),
      }).catch(() => {});
    } catch {
      // ignore
    }
  };

  const openConsent = () => {
    if (isPrivacy) return;
    setConsentModalOpen(true);
  };

  // 同意した瞬間：同意イベント＋セッション開始を送る
  const sessionStartSentRef = useRef(false);
  useEffect(() => {
    if (!enabled) {
      sessionStartSentRef.current = false;
      return;
    }
    if (sessionStartSentRef.current) return;
    sessionStartSentRef.current = true;
    sessionStartMsRef.current = Date.now();

    // 詳細な端末情報を1回だけ
    void (async () => {
      const info = await collectClientInfo();
      track("session_start", info);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // userが変わったら紐付けイベント
  const lastUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabledRef.current) return;
    const uid = user?.id ?? null;
    if (uid === lastUserIdRef.current) return;
    lastUserIdRef.current = uid;
    if (uid) track("auth_login", { provider: (user as any)?.app_metadata?.provider ?? null });
    else track("auth_logout");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ページ可視/離脱
  useEffect(() => {
    const onVisibility = () => {
      if (!enabledRef.current) return;
      track("visibility", { state: document.visibilityState });
    };

    const onPageHide = () => {
      if (!enabledRef.current) return;
      // セッションサマリー（最大化：セッション全体の集計を残す）
      const durMs = Math.max(0, Date.now() - sessionStartMsRef.current);
      track("session_summary", {
        duration_ms: durMs,
        counts: countersRef.current,
      });
      void flush("unload");
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onPageHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ハートビート / 画面サイズ変化 / online/offline（最大化：セッションの継続性・環境変化）
  useEffect(() => {
    if (!enabled) return;

    let resizeTimer: any = null;

    const heartbeat = () => {
      if (!enabledRef.current) return;
      const mem: any = (performance as any).memory;
      track("heartbeat", {
        vis: typeof document !== "undefined" ? document.visibilityState : null,
        viewport:
          typeof window !== "undefined"
            ? { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio ?? 1 }
            : null,
        memory: mem
          ? {
              used: mem.usedJSHeapSize ?? null,
              total: mem.totalJSHeapSize ?? null,
              limit: mem.jsHeapSizeLimit ?? null,
            }
          : null,
      });
    };

    const onResize = () => {
      // 連続resizeは1回にまとめる
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!enabledRef.current) return;
        track("viewport_resize", {
          w: window.innerWidth,
          h: window.innerHeight,
          dpr: window.devicePixelRatio ?? 1,
        });
      }, 450);
    };

    const onOnline = () => {
      if (!enabledRef.current) return;
      track("network_online");
    };
    const onOffline = () => {
      if (!enabledRef.current) return;
      track("network_offline");
    };

    const timer = window.setInterval(heartbeat, 30_000);
    window.addEventListener("resize", onResize);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    // 初回も一度送る
    heartbeat();

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      if (resizeTimer) clearTimeout(resizeTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // エラー収集（最大化：クラッシュ/バグの再現用）
  useEffect(() => {
    const onErr = (ev: ErrorEvent) => {
      if (!enabledRef.current) return;
      track("client_error", {
        message: ev.message,
        filename: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
        stack: (ev.error as any)?.stack ?? null,
      });
    };
    const onRej = (ev: PromiseRejectionEvent) => {
      if (!enabledRef.current) return;
      const r: any = ev.reason;
      track("client_unhandledrejection", {
        message: r?.message ?? String(r),
        stack: r?.stack ?? null,
      });
    };
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: TelemetryAPI = {
    enabled,
    hasConsent,
    anonId: anonIdRef.current || "",
    sessionId,
    track,
    openConsent,
    grantConsent,
  };

  return (
    <TelemetryContext.Provider value={value}>
      {/* 同意が取れるまでアプリは表示しない（必須同意） */}
      {enabled || isPrivacy ? children : <div className="consentSplash">Q-BU!</div>}

      {/* privacyページでは自動ポップアップしない（文章が読めるようにする） */}
      {!isPrivacy && (
        <ConsentModal
          open={consentModalOpen}
          onClose={() => {
            // 同意必須：閉じても再表示する
            setConsentModalOpen(true);
          }}
          onAgree={grantConsent}
        />
      )}
    </TelemetryContext.Provider>
  );
}

export function useTelemetry(): TelemetryAPI {
  const ctx = useContext(TelemetryContext);
  if (!ctx) throw new Error("useTelemetry must be used within <TelemetryProvider />");
  return ctx;
}
