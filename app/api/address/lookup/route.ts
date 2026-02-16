import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Candidate = {
  zipcode: string;
  prefecture: string;
  city: string;
  town: string;
};

type AddressLookupResponse =
  | { ok: true; zipcode: string; candidates: Candidate[]; source: string }
  | { ok: false; error: string; message?: string };

function normalizeZipcode(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/[^0-9]/g, "")
    .slice(0, 7);
}

export async function GET(request: Request): Promise<NextResponse<AddressLookupResponse>> {
  const url = new URL(request.url);
  const zipcode = normalizeZipcode(url.searchParams.get("zipcode") || "");
  if (zipcode.length !== 7) {
    return NextResponse.json({ ok: false, error: "bad_request", message: "郵便番号（7桁）を入力してください。" }, { status: 400 });
  }

  // Default: ZipCloud (no API key)
  const base = process.env.JP_ZIP_LOOKUP_URL || "https://zipcloud.ibsnet.co.jp/api/search?zipcode=";
  const endpoint = base.includes("?") ? `${base}${zipcode}` : `${base}?zipcode=${zipcode}`;

  try {
    const res = await fetch(endpoint, {
      method: "GET",
      headers: { accept: "application/json" },
      // avoid caching issues on edge/CDN; change if needed
      cache: "no-store",
    });

    const json = (await res.json().catch(() => null)) as any;

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: "lookup_failed", message: `住所検索に失敗しました（HTTP ${res.status}）` },
        { status: 502 }
      );
    }

    // ZipCloud format
    const results = Array.isArray(json?.results) ? (json.results as any[]) : [];
    const candidates: Candidate[] = results
      .map((r) => ({
        zipcode: String(r?.zipcode || zipcode),
        prefecture: String(r?.address1 || ""),
        city: String(r?.address2 || ""),
        town: String(r?.address3 || ""),
      }))
      .filter((c) => c.prefecture && c.city);

    if (!candidates.length) {
      const msg = typeof json?.message === "string" ? json.message : "該当する住所が見つかりませんでした。";
      return NextResponse.json({ ok: false, error: "not_found", message: msg }, { status: 404 });
    }

    return NextResponse.json({ ok: true, zipcode, candidates, source: "zip_lookup" });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "lookup_failed", message: e?.message || "住所検索に失敗しました。" },
      { status: 502 }
    );
  }
}
