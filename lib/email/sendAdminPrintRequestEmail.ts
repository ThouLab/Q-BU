import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type Input = {
  orderId: string;
  createdAt: string;
  modelName: string;
  /**
   * Email 内でクリックできるリンクを生成するためのアプリOrigin。
   * Route Handler 側で `new URL(request.url).origin` を渡すのが最も確実です。
   */
  appOrigin?: string | null;
  customer: {
    name: string;
    email: string;
    phone?: string;
    postal_code?: string;
    address: string;
  };
  quote: {
    item_subtotal_yen: number;
    shipping_yen: number;
    total_before_discount_yen: number;
    discount_yen: number;
    total_yen: number;
    ticket_apply_scope?: string | null;
    shipping_zone?: string | null;
    shipping_size_tier?: string | null;
  };
};

function safeText(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeOrigin(origin: string | null | undefined): string {
  const raw = (origin || "").trim();
  if (!raw) return "";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function guessOriginFromEnv(): string {
  const env =
    process.env.NEXT_PUBLIC_APP_ORIGIN ||
    process.env.APP_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "";
  if (env) return normalizeOrigin(env);
  const vercel = process.env.VERCEL_URL;
  if (vercel) return normalizeOrigin(`https://${vercel}`);
  return "";
}

function yen(n: any): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0";
  return Math.round(x).toLocaleString("ja-JP");
}

export async function sendAdminPrintRequestEmail(input: Input): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const admin = getSupabaseAdminClient();
  if (!admin) return;

  // recipients: admin_roles.notify_print_request = true
  const rolesRes = await admin
    .from("admin_roles")
    .select("user_id")
    .eq("is_active", true)
    .eq("notify_print_request", true)
    .limit(50);

  if (rolesRes.error || !Array.isArray(rolesRes.data) || rolesRes.data.length === 0) return;

  const emails: string[] = [];
  for (const r of rolesRes.data as any[]) {
    const uid = typeof r?.user_id === "string" ? r.user_id : "";
    if (!uid) continue;
    try {
      const u = await admin.auth.admin.getUserById(uid);
      const em = u?.data?.user?.email;
      if (typeof em === "string" && em.includes("@")) emails.push(em);
    } catch {
      // ignore
    }
  }

  const to = Array.from(new Set(emails)).slice(0, 50);
  if (!to.length) return;

  // 要望: 件名は必ず「【印刷依頼】」から始める
  const subject = `【印刷依頼】Q-BU 印刷依頼 #${input.orderId}`;

  const origin = normalizeOrigin(input.appOrigin) || guessOriginFromEnv();
  const detailUrl = origin ? `${origin}/admin/printing/${encodeURIComponent(input.orderId)}` : "";

  const shipMeta = input.quote.shipping_zone && input.quote.shipping_size_tier ? ` (${safeText(String(input.quote.shipping_zone))}/${safeText(String(input.quote.shipping_size_tier))})` : "";
  const applyScope = input.quote.ticket_apply_scope ? safeText(String(input.quote.ticket_apply_scope)) : "";

  const html = `
  <div style="font-family: ui-sans-serif, system-ui; padding: 16px; color: #111827;">
    <h2 style="margin: 0 0 10px 0;">新しい印刷依頼を受け付けました</h2>
    <div style="color:#6b7280; font-size:12px;">Order ID: <b>${safeText(input.orderId)}</b> / ${safeText(input.createdAt)}</div>

    ${
      detailUrl
        ? `<div style="margin-top: 12px; padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 12px; background: #f9fafb;">
            <div style="font-size:12px; font-weight:900; color:#111827;">依頼詳細ページ</div>
            <div style="margin-top:6px; font-size:13px;">
              <a href="${safeText(detailUrl)}" style="font-weight:900; color:#2563eb; text-decoration:underline; text-underline-offset:3px;">管理画面で開く</a>
            </div>
            <div style="margin-top:6px; font-size:12px; color:#6b7280; word-break: break-all;">${safeText(detailUrl)}</div>
          </div>`
        : ``
    }

    <h3 style="margin: 14px 0 6px 0; font-size: 14px;">モデル</h3>
    <div style="font-size:13px;">${safeText(input.modelName)}</div>

    <h3 style="margin: 14px 0 6px 0; font-size: 14px;">お客様</h3>
    <div style="font-size:13px; line-height: 1.6;">
      <div>氏名: <b>${safeText(input.customer.name)}</b></div>
      <div>メール: <b>${safeText(input.customer.email)}</b></div>
      ${input.customer.phone ? `<div>電話: <b>${safeText(input.customer.phone)}</b></div>` : ""}
    </div>

    <h3 style="margin: 14px 0 6px 0; font-size: 14px;">配送先</h3>
    <div style="font-size:13px; line-height: 1.6;">
      ${input.customer.postal_code ? `<div>〒 ${safeText(input.customer.postal_code)}</div>` : ""}
      <div>${safeText(input.customer.address)}</div>
    </div>

    <h3 style="margin: 14px 0 6px 0; font-size: 14px;">概算見積</h3>
    <table style="width:100%; border-collapse: collapse; font-size: 13px;">
      <tbody>
        <tr>
          <td style="padding:6px 0; border-bottom: 1px solid #e5e7eb;">商品小計</td>
          <td style="padding:6px 0; border-bottom: 1px solid #e5e7eb; text-align:right;"><b>${yen(input.quote.item_subtotal_yen)} 円</b></td>
        </tr>
        <tr>
          <td style="padding:6px 0; border-bottom: 1px solid #e5e7eb;">送料${shipMeta}</td>
          <td style="padding:6px 0; border-bottom: 1px solid #e5e7eb; text-align:right;"><b>${yen(input.quote.shipping_yen)} 円</b></td>
        </tr>
        ${input.quote.discount_yen > 0 ? `
        <tr>
          <td style="padding:6px 0; border-bottom: 1px solid #e5e7eb;">値引き${applyScope ? ` <span style=\"color:#6b7280;font-size:12px;\">(${applyScope})</span>` : ""}</td>
          <td style="padding:6px 0; border-bottom: 1px solid #e5e7eb; text-align:right;"><b>-${yen(input.quote.discount_yen)} 円</b></td>
        </tr>` : ""}
        <tr>
          <td style="padding:10px 0; font-size: 16px; font-weight: 900;">合計</td>
          <td style="padding:10px 0; font-size: 16px; font-weight: 900; text-align:right;">${yen(input.quote.total_yen)} 円</td>
        </tr>
      </tbody>
    </table>

    <div style="margin-top: 10px; color:#6b7280; font-size:12px;">
      ※このメールは通知対象の管理者にのみ送信されます（admin_roles.notify_print_request）。
    </div>
  </div>
  `;

  const from = process.env.EMAIL_FROM || process.env.RESEND_FROM || "Q-BU <noreply@q-bu.com>";
  const bcc = process.env.EMAIL_BCC || "";
  const payload: any = { from, to, subject, html };
  if (bcc) payload.bcc = bcc;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }).catch(() => null);
}
