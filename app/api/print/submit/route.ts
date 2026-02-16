import { NextResponse } from "next/server";

import { computeMixedBBox, type SubKey } from "@/components/qbu/subBlocks";
import { analyzePrintPrepSupport } from "@/components/qbu/printPrepUtils";
import { estimatePrintPriceYen, estimateSolidVolumeCm3, resolvePrintScale, type PrintScaleSetting } from "@/components/qbu/printScale";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { emailHash, encryptShipping, postalCodePrefix, postalCodePrefixFromAddress, type ShippingInfo } from "@/lib/secure/shippingCrypto";
import { sendOrderEmails } from "@/lib/email/sendOrderEmails";
import {
  computeDiscountYen,
  hashTicketCode,
  roundToStepYen,
  safeTicketType,
  type TicketType,
} from "@/lib/secure/ticketCode";

import { buildRateMap, fallbackShippingRates, findShippingYen, type ShippingRateRow } from "@/lib/shipping/rates";
import { deriveSizeTierFromMm, worldSizeToMm } from "@/lib/shipping/sizeTier";
import { zoneFromPrefecture } from "@/lib/shipping/zones";

import { sendAdminPrintRequestEmail } from "@/lib/email/sendAdminPrintRequestEmail";

export const runtime = "nodejs";

type IncomingDraft = {
  baseName?: unknown;
  modelFingerprint?: unknown;
  blocks?: unknown;
  supportBlocks?: unknown;
  scaleSetting?: unknown;
  // legacy
  targetMm?: unknown;
};

function safeText(x: unknown, maxLen: number): string {
  const s = typeof x === "string" ? x : "";
  return s.trim().slice(0, maxLen);
}

function getRequestOrigin(request: Request): string | null {
  // Most reliable in Next route handlers
  try {
    const u = new URL(request.url);
    if (u.origin && u.origin !== "null") return u.origin;
  } catch {
    // ignore
  }

  // Fallbacks for proxy / edge
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  if (host) return `${proto}://${host}`;

  // Last resort: envs
  const env = process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.APP_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (env) return env;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return null;
}

function parseScaleSetting(x: unknown, fallbackTargetMm: number): PrintScaleSetting {
  if (x && typeof x === "object") {
    const m = (x as any).mode;
    if (m === "maxSide") {
      const v = Number((x as any).maxSideMm);
      if (Number.isFinite(v)) return { mode: "maxSide", maxSideMm: v };
    }
    if (m === "blockEdge") {
      const v = Number((x as any).blockEdgeMm);
      if (Number.isFinite(v)) return { mode: "blockEdge", blockEdgeMm: v };
    }
  }
  // legacy fallback
  const t = Number(fallbackTargetMm);
  return { mode: "maxSide", maxSideMm: Number.isFinite(t) ? t : 50 };
}

function parseStringArray(x: unknown, maxItems: number): string[] {
  if (!Array.isArray(x)) return [];
  const out: string[] = [];
  for (const v of x) {
    if (typeof v === "string") {
      out.push(v);
      if (out.length >= maxItems) break;
    }
  }
  return out;
}

function readCookie(header: string | null, key: string): string | null {
  const c = header || "";
  const m = c.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

async function resolveLoggedInUserId(): Promise<string | null> {
  try {
    const sb = await getSupabaseServerClient();
    if (!sb) return null;
    const { data } = await sb.auth.getUser();
    return data?.user?.id || null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const appOrigin = getRequestOrigin(request);
  const admin = getSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "supabase_admin_not_configured" }, { status: 501 });
  }

  let body: any = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const draft: IncomingDraft = body?.draft || {};
  const customer = body?.customer || {};

  const baseName = safeText(draft.baseName, 80) || "Q-BU";
  const modelFingerprint = safeText(draft.modelFingerprint, 80) || null;

  const blocks = parseStringArray(draft.blocks, 20000);
  const supportBlocks = parseStringArray(draft.supportBlocks, 20000) as SubKey[];

  if (blocks.length === 0) {
    return NextResponse.json({ ok: false, error: "no_blocks" }, { status: 400 });
  }

  const name = safeText(customer.name, 80);
  const email = safeText(customer.email, 120);
  const phone = safeText(customer.phone, 40);
  const postal_code = safeText((customer as any).postal_code, 16);
  const prefecture = safeText((customer as any).prefecture, 20);
  const city = safeText((customer as any).city, 40);
  const town = safeText((customer as any).town, 80);
  const address_line2 = safeText((customer as any).address_line2, 200);

  // Backward compat: accept either a composed address, or (pref/city/town + line2).
  let address = safeText(customer.address, 500);
  if (!address) {
    const composed = `${prefecture || ""}${city || ""}${town || ""}${address_line2 || ""}`.trim();
    if (composed) address = composed;
  }
  const note = safeText(customer.notes, 1000);

  const ticketCodeRaw = safeText(customer.ticket_code ?? (customer as any).ticketCode, 80);

  if (!name || !email || !address) {
    return NextResponse.json({ ok: false, error: "missing_customer_fields" }, { status: 400 });
  }

  if (postal_code && !/^\d{3}-?\d{4}$/.test(postal_code)) {
    return NextResponse.json({ ok: false, error: "invalid_postal_code" }, { status: 400 });
  }

  // Identify who (if logged in)
  const userId = await resolveLoggedInUserId();

  // telemetry ids (for analytics)
  const anonFromBody = typeof body?.telemetry?.anon_id === "string" ? body.telemetry.anon_id : null;
  const sessFromBody = typeof body?.telemetry?.session_id === "string" ? body.telemetry.session_id : null;

  const cookieHeader = request.headers.get("cookie");
  const anonFromCookie = readCookie(cookieHeader, "qbu_anon");

  const anon_id = (anonFromBody || anonFromCookie || "").slice(0, 80) || null;
  const session_id = (sessFromBody || "").slice(0, 80) || null;

  // scale + quote (server-side snapshot)
  const baseSet = new Set<string>(blocks);
  const supSet = new Set<SubKey>(supportBlocks);

  // Server-side safety: accept ONLY print-ready (single component) data.
  // This prevents operators from receiving a model that still has floating parts.
  const analysis = analyzePrintPrepSupport(baseSet, supSet);
  if (analysis.componentCount > 1) {
    return NextResponse.json(
      {
        ok: false,
        error: "model_not_ready",
        message:
          `モデルが${analysis.componentCount}パーツに分かれています。\n` +
          `エディターで「印刷用につなぎ目を補完」を開き、浮動パーツが無い状態で依頼してください。`,
      },
      { status: 400 }
    );
  }

  const bbox = computeMixedBBox(baseSet, supSet);
  const scaleSetting = parseScaleSetting(draft.scaleSetting, Number(draft.targetMm));
  const resolved = resolvePrintScale({
    bboxMaxDimWorld: bbox.maxDim,
    setting: scaleSetting,
    clampMaxSideMm: { min: 10, max: 300 },
    clampBlockEdgeMm: { min: 0.1, max: 500 },
  });

  const volume = estimateSolidVolumeCm3({
    baseBlockCount: baseSet.size,
    supportBlockCount: supSet.size,
    mmPerUnit: resolved.mmPerUnit,
  });

  // pricing config (v1.0.15-γ)
  let pricingConfigId: number | null = null;
  let pricingParams: any = undefined;
  try {
    const { data: p, error: pe } = await admin
      .from("pricing_configs")
      .select("id,base_fee_yen,per_cm3_yen,min_fee_yen,rounding_step_yen")
      .eq("is_active", true)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!pe && p) {
      const id = Number((p as any).id);
      pricingConfigId = Number.isFinite(id) ? id : null;
      pricingParams = {
        baseFeeYen: Number((p as any).base_fee_yen),
        perCm3Yen: Number((p as any).per_cm3_yen),
        minFeeYen: Number((p as any).min_fee_yen),
        roundingStepYen: Number((p as any).rounding_step_yen),
      };
    }
  } catch {
    // ignore (fallback to defaults)
  }

  const quote = estimatePrintPriceYen(volume, pricingParams);
  const itemSubtotalYen = quote.subtotalYen;
  const roundingStep = Number(quote.breakdown?.roundingStepYen) || 10;

  // shipping config (v1.0.16)
  let shippingConfigId: number | null = null;
  let shippingRates: ShippingRateRow[] = fallbackShippingRates();
  try {
    const { data: s, error: se } = await admin
      .from("shipping_configs")
      .select("id")
      .eq("is_active", true)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!se && s?.id != null) {
      const sid = Number((s as any).id);
      shippingConfigId = Number.isFinite(sid) ? sid : null;
      if (shippingConfigId != null) {
        const { data: rows, error: re } = await admin
          .from("shipping_rates")
          .select("zone,size_tier,price_yen")
          .eq("config_id", shippingConfigId)
          .limit(500);
        if (!re && Array.isArray(rows) && rows.length) {
          shippingRates = rows.map((r: any) => ({
            zone: String(r?.zone || ""),
            size_tier: String(r?.size_tier || ""),
            price_yen: Number(r?.price_yen) || 0,
          }));
        }
      }
    }
  } catch {
    // ignore (fallback)
  }

  // shipping computation: prefecture(zone) + sizeTier
  let prefForZone = prefecture;
  if (!prefForZone && address) {
    const m = address.match(/(北海道|東京都|大阪府|京都府|..県|...県)/);
    if (m?.[1]) prefForZone = m[1];
  }

  const shipZone = prefForZone ? zoneFromPrefecture(prefForZone) : null;
  const sizeMm = worldSizeToMm((bbox as any).size, resolved.mmPerUnit);
  const tierInfo = deriveSizeTierFromMm(sizeMm, { paddingMm: 20 });
  const shipTier = tierInfo.sizeTier;

  const shipMap = buildRateMap(shippingRates);
  let shippingYen: number | null = shipZone ? findShippingYen(shipMap, shipZone, shipTier) : null;
  if (shippingYen == null && shipZone) {
    const fbMap = buildRateMap(fallbackShippingRates());
    shippingYen = findShippingYen(fbMap, shipZone, shipTier);
  }
  if (shippingYen == null) shippingYen = 0;

  const totalBeforeDiscountYen = itemSubtotalYen + shippingYen;

  // ticket validation + discount
  let ticketId: string | null = null;
  let ticketApplyScope: string | null = null;
  let discountAppliedYen = 0;
  let finalTotalYen = totalBeforeDiscountYen;
  let ticketType: TicketType | null = null;
  let ticketValue: number | null = null;

  if (ticketCodeRaw) {
    // Lookup by hash
    const codeHash = hashTicketCode(ticketCodeRaw);
    const tRes = await admin.from("tickets").select("*").eq("code_hash", codeHash).maybeSingle();
    if (tRes.error || !tRes.data) {
      return NextResponse.json({ ok: false, error: "invalid_ticket", message: "チケットコードが無効です。" }, { status: 400 });
    }

    const t: any = tRes.data;
    const tt = safeTicketType(t.type);
    if (!tt) {
      return NextResponse.json({ ok: false, error: "invalid_ticket", message: "チケット種別が無効です。" }, { status: 400 });
    }
    if (t.is_active !== true) {
      return NextResponse.json({ ok: false, error: "invalid_ticket", message: "このチケットは無効です。" }, { status: 400 });
    }
    if (t.expires_at) {
      const exp = new Date(String(t.expires_at));
      if (Number.isFinite(exp.getTime()) && exp.getTime() <= Date.now()) {
        return NextResponse.json({ ok: false, error: "invalid_ticket", message: "このチケットは期限切れです。" }, { status: 400 });
      }
    }

    // usage limits
    try {
      const totalLimit = t.max_total_uses != null ? Number(t.max_total_uses) : null;
      if (totalLimit != null && totalLimit >= 0) {
        const cRes = await admin
          .from("ticket_redemptions")
          .select("id", { count: "exact", head: true })
          .eq("ticket_id", t.id);
        const usedTotal = (cRes as any).count || 0;
        if (usedTotal >= totalLimit) {
          return NextResponse.json({ ok: false, error: "invalid_ticket", message: "このチケットは上限回数に達しています。" }, { status: 400 });
        }
      }

      const perLimit = t.max_uses_per_user != null ? Number(t.max_uses_per_user) : null;
      if (perLimit != null && perLimit >= 0) {
        if (userId) {
          const cRes = await admin
            .from("ticket_redemptions")
            .select("id", { count: "exact", head: true })
            .eq("ticket_id", t.id)
            .eq("user_id", userId);
          const used = (cRes as any).count || 0;
          if (used >= perLimit) {
            return NextResponse.json({ ok: false, error: "invalid_ticket", message: "このチケットは使用済みです。" }, { status: 400 });
          }
        } else if (anon_id) {
          const cRes = await admin
            .from("ticket_redemptions")
            .select("id", { count: "exact", head: true })
            .eq("ticket_id", t.id)
            .eq("anon_id", anon_id);
          const used = (cRes as any).count || 0;
          if (used >= perLimit) {
            return NextResponse.json({ ok: false, error: "invalid_ticket", message: "このチケットは使用済みです。" }, { status: 400 });
          }
        }
      }
    } catch {
      // If redemptions table isn't present yet, don't hard-fail; treat as invalid to be safe.
      return NextResponse.json({ ok: false, error: "invalid_ticket", message: "チケットの検証に失敗しました。" }, { status: 400 });
    }

    ticketId = String(t.id);
    ticketType = tt;
    ticketValue = t.value != null ? Number(t.value) : null;

    // v1.0.16: percent/fixed/free can be applied to "subtotal" or "total" (subtotal+shipping)
    ticketApplyScope = t.apply_scope === "total" ? "total" : "subtotal";
    const shipping_free = Boolean(t.shipping_free);

    const wanted = computeDiscountYen({
      type: tt,
      value: ticketValue,
      subtotalYen: itemSubtotalYen,
      shippingYen,
      applyScope: ticketApplyScope,
      shipping_free,
    });
    const rawFinal = Math.max(0, totalBeforeDiscountYen - wanted);
    const roundedFinal = roundToStepYen(rawFinal, roundingStep);
    finalTotalYen = roundedFinal;
    discountAppliedYen = Math.max(0, totalBeforeDiscountYen - roundedFinal);
  }

  // secure shipping
  const shipping: ShippingInfo = {
    name,
    email,
    phone: phone || undefined,
    postal_code: postal_code || undefined,
    prefecture: prefecture || undefined,
    city: city || undefined,
    town: town || undefined,
    address_line2: address_line2 || undefined,
    address,
  };

  let shipping_enc: string;
  try {
    shipping_enc = encryptShipping(shipping);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "shipping_encrypt_failed", message: e?.message || "" }, { status: 500 });
  }

  const email_hash = emailHash(email) || null;
  const postal_prefix = postalCodePrefix(postal_code) || postalCodePrefixFromAddress(address);

  const app_version = process.env.NEXT_PUBLIC_APP_VERSION || "dev";

  // build breakdown with ticket snapshot
  const breakdown: any = {
    ...quote.breakdown,
  };

  breakdown.itemSubtotalYen = itemSubtotalYen;
  breakdown.shipping = {
    configId: shippingConfigId,
    zone: shipZone,
    sizeTier: shipTier,
    yen: shippingYen,
    sumCm: tierInfo.sumCm,
    cappedTier: tierInfo.capped,
  };
  breakdown.totalBeforeDiscountYen = totalBeforeDiscountYen;
  breakdown.totalYen = finalTotalYen;

  if (ticketId) {
    breakdown.preDiscountYen = totalBeforeDiscountYen;
    breakdown.discountYen = discountAppliedYen;
    breakdown.ticket = {
      id: ticketId,
      type: ticketType,
      value: ticketValue,
      apply_scope: ticketApplyScope,
    };
  }

  // create order
  const insertOrder: any = {
    user_id: userId,
    anon_id,
    session_id,
    app_version,
    status: "submitted",
    payment_status: "unpaid",
    currency: "JPY",

    pricing_config_id: pricingConfigId,

    // shipping snapshot (v1.0.16)
    shipping_config_id: shippingConfigId,
    shipping_zone: shipZone,
    shipping_size_tier: shipTier,
    shipping_yen: shippingYen,
    ticket_apply_scope: ticketId ? ticketApplyScope : null,

    // snapshot
    quote_total_yen: finalTotalYen,
    quote_subtotal_yen: itemSubtotalYen,
    discount_yen: ticketId ? discountAppliedYen : null,
    ticket_id: ticketId,

    quote_volume_cm3: quote.volumeCm3,
    quote_breakdown: breakdown,

    model_name: baseName,
    model_fingerprint: modelFingerprint,
    block_count: baseSet.size,
    support_block_count: supSet.size,
    max_dim_mm: resolved.maxSideMm,
    warn_exceeds_max: Boolean(resolved.warnTooLarge),

    scale_mode: resolved.mode,
    block_edge_mm: resolved.mode === "blockEdge" ? resolved.mmPerUnit : null,
    target_max_side_mm: resolved.mode === "maxSide" ? resolved.maxSideMm : null,
    mm_per_unit: resolved.mmPerUnit,

    customer_note: note || null,

    // v1.0.15-δ2+: store model data for admin preview / STL regeneration
    model_data: {
      version: 4,
      kind: "print_order",
      blocks,
      supportBlocks,
      scaleSetting,
      // for convenience
      mmPerUnit: resolved.mmPerUnit,
      maxSideMm: resolved.maxSideMm,
      mode: resolved.mode,
    },
  };

  // Insert order with graceful fallback if migrations are not applied yet.
  let createdRes: any = null;
  let payloadToInsert: any = { ...insertOrder };

  for (let i = 0; i < 4; i++) {
    createdRes = await admin.from("print_orders").insert(payloadToInsert).select("id").single();
    if (!createdRes.error) break;

    const msg = String(createdRes.error?.message || "").toLowerCase();
    let changed = false;

    for (const col of ["pricing_config_id", "ticket_id", "discount_yen", "quote_subtotal_yen", "model_data"] as const) {
      if (msg.includes(col)) {
        if (col in payloadToInsert) {
          delete payloadToInsert[col];
          changed = true;
        }
      }
    }

    if (!changed) break;
  }

  if (createdRes.error || !createdRes.data?.id) {
    return NextResponse.json(
      { ok: false, error: "order_insert_failed", message: createdRes.error?.message || "" },
      { status: 500 }
    );
  }

  const orderId = String(createdRes.data.id);

  try {
    await admin.from("print_order_shipping_secure").insert({
      order_id: orderId,
      shipping_enc,
      email_hash,
      postal_code_prefix: postal_prefix,
    });
  } catch {
    // if this fails, order is still created; admin can contact user later if needed
  }

  // ticket redemption log
  if (ticketId) {
    try {
      await admin.from("ticket_redemptions").insert({
        ticket_id: ticketId,
        order_id: orderId,
        user_id: userId,
        anon_id,
        discount_yen: discountAppliedYen,
        snapshot: {
          type: ticketType,
          value: ticketValue,
          apply_scope: ticketApplyScope,
          item_subtotal_before: itemSubtotalYen,
          shipping_yen: shippingYen,
          total_before: totalBeforeDiscountYen,
          total_after: finalTotalYen,
        },
      } as any);
    } catch {
      // ignore
    }
  }

  // analytics (server-side reliable)
  try {
    const ua = request.headers.get("user-agent") ?? "";
    const acceptLang = request.headers.get("accept-language") ?? "";

    await admin.from("event_logs").insert({
      event_name: "order_submitted",
      path: "/print",
      anon_id: anon_id || "unknown",
      session_id: session_id || "unknown",
      user_id: userId,
      payload: {
        order_id: orderId,
        pricing_config_id: pricingConfigId,
        shipping_config_id: shippingConfigId,
        model_fingerprint: modelFingerprint,
        block_count: baseSet.size,
        support_block_count: supSet.size,
        max_side_mm: resolved.maxSideMm,
        mm_per_unit: resolved.mmPerUnit,
        scale_mode: resolved.mode,
        quote_subtotal_yen: itemSubtotalYen,
        shipping_yen: shippingYen,
        total_before_discount_yen: totalBeforeDiscountYen,
        discount_yen: discountAppliedYen,
        ticket_id: ticketId,
        ticket_apply_scope: ticketApplyScope,
        shipping_zone: shipZone,
        shipping_size_tier: shipTier,
        quote_total_yen: finalTotalYen,
        warn_too_large: Boolean(resolved.warnTooLarge),
      },
      user_agent: ua,
      accept_language: acceptLang,
    } as any);
  } catch {
    // ignore
  }

  // transactional emails (order received + invoice)
  try {
    const createdAtIso = new Date().toISOString();
    await Promise.all([
      sendOrderEmails({
        to: email,
        customerName: name,
        orderId,
        createdAt: createdAtIso,
        modelName: baseName,
        modelFingerprint,
        sizeMaxMm: Number(resolved.maxSideMm),
        mmPerUnit: Number(resolved.mmPerUnit),
        blockCount: baseSet.size,
        supportBlockCount: supSet.size,
        volumeCm3: Number(quote.volumeCm3),
        itemSubtotalYen,
        shippingYen,
        totalBeforeDiscountYen,
        discountYen: discountAppliedYen,
        totalYen: finalTotalYen,
        ticketApplyScope,
        shippingZone: shipZone,
        shippingSizeTier: shipTier,
        ticketCodeUsed: ticketCodeRaw || null,
      }),
      sendAdminPrintRequestEmail({
        orderId,
        createdAt: createdAtIso,
        modelName: baseName,
        appOrigin,
        customer: {
          name,
          email,
          phone: phone || undefined,
          postal_code: postal_code || undefined,
          address,
        },
        quote: {
          item_subtotal_yen: itemSubtotalYen,
          shipping_yen: shippingYen,
          total_before_discount_yen: totalBeforeDiscountYen,
          discount_yen: discountAppliedYen,
          total_yen: finalTotalYen,
          ticket_apply_scope: ticketApplyScope,
          shipping_zone: shipZone,
          shipping_size_tier: shipTier,
        },
      }),
    ]);
  } catch {
    // do not fail the request if emails are misconfigured
  }

  return NextResponse.json({
    ok: true,
    order_id: orderId,
    quote: {
      item_subtotal_yen: itemSubtotalYen,
      shipping_yen: shippingYen,
      total_before_discount_yen: totalBeforeDiscountYen,
      discount_yen: discountAppliedYen,
      total_yen: finalTotalYen,
      ticket_apply_scope: ticketApplyScope,
      shipping_zone: shipZone,
      shipping_size_tier: shipTier,
    },
    ticket_id: ticketId,
  });
}
