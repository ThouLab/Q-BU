export type RefSettings = {
  /** 参照画像を表示する */
  enabled: boolean;
  /** 参照画像の透明度 (0..1) */
  opacity: number;
  /** 参照画像の高さ（ボクセル単位） */
  size: number;
  /** 参照画像をモデルの外側に配置する余白（ボクセル単位） */
  margin: number;
  /** プレビュー側にも参照画像を表示する */
  showInPreview: boolean;
};

export const DEFAULT_REF_SETTINGS: RefSettings = {
  enabled: false,
  opacity: 0.35,
  size: 20,
  margin: 1.5,
  showInPreview: true,
};

export type ViewDir = "front" | "back" | "left" | "right" | "top" | "bottom";
