export type RefImage = {
  url: string;
  w: number;
  h: number;
};

export type RefImages = {
  front?: RefImage;
  side?: RefImage;
  top?: RefImage;
};

export type ThreeViewSplitMode = "auto" | "horizontal" | "vertical";

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
    img.src = url;
  });
}

export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("ファイルの読み込みに失敗しました"));
    reader.readAsDataURL(file);
  });
}

function cropToDataURL(img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number): RefImage {
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context を作成できませんでした");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const url = canvas.toDataURL("image/png");
  return { url, w: sw, h: sh };
}

/**
 * 3面図（1枚の画像）を front / side / top に分割して返す。
 * - horizontal: 横に3分割
 * - vertical: 縦に3分割
 * - auto: 縦横比から推測
 */
export async function splitThreeViewSheet(dataUrl: string, mode: ThreeViewSplitMode = "auto"): Promise<Required<RefImages>> {
  const img = await loadHtmlImage(dataUrl);

  const ratio = img.width / img.height;
  let m: ThreeViewSplitMode = mode;
  if (m === "auto") {
    if (ratio >= 2.2) m = "horizontal";
    else if (ratio <= 1 / 2.2) m = "vertical";
    else m = "horizontal"; // 迷ったら横
  }

  if (m === "horizontal") {
    const sw = Math.floor(img.width / 3);
    const sh = img.height;
    return {
      front: cropToDataURL(img, 0, 0, sw, sh),
      side: cropToDataURL(img, sw, 0, sw, sh),
      top: cropToDataURL(img, sw * 2, 0, img.width - sw * 2, sh),
    };
  }

  // vertical
  const sw = img.width;
  const sh = Math.floor(img.height / 3);
  return {
    front: cropToDataURL(img, 0, 0, sw, sh),
    side: cropToDataURL(img, 0, sh, sw, sh),
    top: cropToDataURL(img, 0, sh * 2, sw, img.height - sh * 2),
  };
}
