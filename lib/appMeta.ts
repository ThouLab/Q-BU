export const APP_VERSION: string = process.env.NEXT_PUBLIC_APP_VERSION || "dev";

export type DeviceType = "mobile" | "desktop";

/**
 * 軽量な端末種別判定（分析用）
 * - 厳密なUA判定は避け、viewport幅ベースで十分な運用指標にする
 */
export function detectDeviceType(): DeviceType {
  try {
    if (typeof window === "undefined") return "desktop";
    return window.innerWidth <= 900 ? "mobile" : "desktop";
  } catch {
    return "desktop";
  }
}
