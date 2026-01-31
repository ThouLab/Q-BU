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

export const DEFAULT_CUBE_COLOR = BAMBU_FILAMENT_COLORS[0].hex;
