export type FilamentColor = {
  /** 表示名（簡単でOK） */
  name: string;
  /** 表示色（HEX） */
  hex: string;
};

/**
 * Bambu公式フィラメントの“代表的な色”に寄せたプリセット（見た目用）。
 * ※STL自体には色は入りません。
 */
export const BAMBU_FILAMENT_COLORS: FilamentColor[] = [
  { name: "Jade White", hex: "#F4F4F2" },
  { name: "Charcoal Black", hex: "#1F1F1F" },
  { name: "Gray", hex: "#9AA0A6" },
  { name: "Red", hex: "#D72638" },
  { name: "Orange", hex: "#F18F01" },
  { name: "Yellow", hex: "#F6C90E" },
  { name: "Green", hex: "#2ECC71" },
  { name: "Blue", hex: "#1E6BF1" },
  { name: "Purple", hex: "#7B61FF" },
  { name: "Pink", hex: "#FF5DA2" },
  { name: "Brown", hex: "#8D5B3A" },
];

/**
 * v1.0.17+: ブロック単位で色を持つため、モデル全体の色切り替えは廃止。
 * 追加されるブロックのデフォルト色として「Gray」を採用。
 */
export const DEFAULT_BLOCK_COLOR = BAMBU_FILAMENT_COLORS.find((c) => c.name === "Gray")?.hex || "#9AA0A6";

/**
 * Legacy (v1.0.16以前): モデル全体の単色。
 * 既存のJSON/QBU読み込み互換のために残しています。
 */
export const DEFAULT_CUBE_COLOR = BAMBU_FILAMENT_COLORS[0].hex;
