export type ShippingZone = "hokkaido" | "tohoku" | "kanto" | "chubu" | "kinki" | "chugoku" | "shikoku" | "kyushu" | "okinawa";

// ZipCloud returns address1 as prefecture name (e.g. "神奈川県").
const PREF_TO_ZONE: Record<string, ShippingZone> = {
  北海道: "hokkaido",

  青森県: "tohoku",
  岩手県: "tohoku",
  宮城県: "tohoku",
  秋田県: "tohoku",
  山形県: "tohoku",
  福島県: "tohoku",

  茨城県: "kanto",
  栃木県: "kanto",
  群馬県: "kanto",
  埼玉県: "kanto",
  千葉県: "kanto",
  東京都: "kanto",
  神奈川県: "kanto",

  新潟県: "chubu",
  富山県: "chubu",
  石川県: "chubu",
  福井県: "chubu",
  山梨県: "chubu",
  長野県: "chubu",
  岐阜県: "chubu",
  静岡県: "chubu",
  愛知県: "chubu",

  三重県: "kinki",
  滋賀県: "kinki",
  京都府: "kinki",
  大阪府: "kinki",
  兵庫県: "kinki",
  奈良県: "kinki",
  和歌山県: "kinki",

  鳥取県: "chugoku",
  島根県: "chugoku",
  岡山県: "chugoku",
  広島県: "chugoku",
  山口県: "chugoku",

  徳島県: "shikoku",
  香川県: "shikoku",
  愛媛県: "shikoku",
  高知県: "shikoku",

  福岡県: "kyushu",
  佐賀県: "kyushu",
  長崎県: "kyushu",
  熊本県: "kyushu",
  大分県: "kyushu",
  宮崎県: "kyushu",
  鹿児島県: "kyushu",

  沖縄県: "okinawa",
};

export function zoneFromPrefecture(prefecture: string): ShippingZone | null {
  const p0 = String(prefecture || "").trim();
  if (!p0) return null;
  const p = p0.replace(/\s+/g, "");
  if ((PREF_TO_ZONE as any)[p]) return (PREF_TO_ZONE as any)[p] as ShippingZone;

  // fallback: match by removing suffix
  const pNoSuffix = p.replace(/[都道府県]$/, "");
  for (const [k, z] of Object.entries(PREF_TO_ZONE)) {
    if (k.replace(/[都道府県]$/, "") === pNoSuffix) return z;
  }
  return null;
}
