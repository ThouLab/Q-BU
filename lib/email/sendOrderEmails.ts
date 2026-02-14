type SendOrderEmailsInput = {
  to: string;
  customerName: string;
  orderId: string;
  createdAt: string;
  modelName: string;
  modelFingerprint: string | null;
  sizeMaxMm: number;
  mmPerUnit: number;
  blockCount: number;
  supportBlockCount: number;
  volumeCm3: number;
  subtotalYen: number;
  discountYen: number;
  totalYen: number;
  ticketCodeUsed: string | null;
};

function yen(n: number): string {
  if (!Number.isFinite(n)) return "-";
  return Math.round(n).toLocaleString("ja-JP");
}

function mm(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "-";
  const k = Math.pow(10, digits);
  return (Math.round(n * k) / k).toString();
}

function isoToJstDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    // show as ISO-like without timezone suffix
    return d.toISOString().replace("T", " ").slice(0, 19);
  } catch {
    return iso;
  }
}

function safeText(s: string): string {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function buildInvoiceHtml(input: SendOrderEmailsInput) {
  const company = process.env.INVOICE_ISSUER_NAME || process.env.COMPANY_NAME || "Q-BU";
  const companyAddr = process.env.INVOICE_ISSUER_ADDRESS || process.env.COMPANY_ADDRESS || "";
  const companyTel = process.env.INVOICE_ISSUER_TEL || "";
  const companyEmail = process.env.INVOICE_ISSUER_EMAIL || process.env.EMAIL_FROM || "";

  const bankName = process.env.INVOICE_BANK_NAME || "";
  const bankBranch = process.env.INVOICE_BANK_BRANCH || "";
  const accountType = process.env.INVOICE_ACCOUNT_TYPE || "";
  const accountNumber = process.env.INVOICE_ACCOUNT_NUMBER || "";
  const accountName = process.env.INVOICE_ACCOUNT_NAME || "";
  const paymentNote = process.env.INVOICE_PAYMENT_NOTE || "（お支払い方法はこのメールに追記して運用できます）";

  const dueDays = Number(process.env.INVOICE_DUE_DAYS || 7);
  const issuedAt = isoToJstDateTime(input.createdAt);
  const dueAt = (() => {
    try {
      const d = new Date(input.createdAt);
      d.setDate(d.getDate() + (Number.isFinite(dueDays) ? dueDays : 7));
      return d.toISOString().slice(0, 10);
    } catch {
      return "";
    }
  })();

  const invoiceNo = `QB-${input.orderId.slice(0, 8)}`;
  const discountLine = input.discountYen > 0 ? `<tr><td style="padding:6px 0;">割引</td><td style="padding:6px 0; text-align:right;">- ${yen(input.discountYen)} 円</td></tr>` : "";

  const ticketInfo = input.ticketCodeUsed ? `<div style="color:#6b7280; font-size:12px; margin-top:6px;">適用チケット: ${safeText(input.ticketCodeUsed)}</div>` : "";

  const payInfo =
    bankName || bankBranch || accountType || accountNumber || accountName
      ? `
  <div style="margin-top:10px; padding:10px; border:1px solid rgba(0,0,0,0.12); border-radius:10px; background:#fafafa;">
    <div style="font-weight:700; margin-bottom:6px;">お支払い情報</div>
    <div style="font-size:13px; line-height:1.6;">
      ${bankName ? `銀行名: ${safeText(bankName)}<br/>` : ""}
      ${bankBranch ? `支店名: ${safeText(bankBranch)}<br/>` : ""}
      ${accountType ? `種別: ${safeText(accountType)}<br/>` : ""}
      ${accountNumber ? `口座番号: ${safeText(accountNumber)}<br/>` : ""}
      ${accountName ? `口座名義: ${safeText(accountName)}<br/>` : ""}
      <div style="color:#6b7280; font-size:12px; margin-top:6px;">${safeText(paymentNote)}</div>
    </div>
  </div>`
      : `
  <div style="margin-top:10px; padding:10px; border:1px solid rgba(0,0,0,0.12); border-radius:10px; background:#fafafa;">
    <div style="font-weight:700; margin-bottom:6px;">お支払い方法</div>
    <div style="font-size:13px; line-height:1.6; color:#6b7280;">${safeText(paymentNote)}</div>
  </div>`;

  return `
  <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; color:#111827;">
    <h2 style="margin:0 0 6px 0;">印刷依頼を受け付けました</h2>
    <div style="color:#6b7280; font-size:13px;">この度は Q-BU の印刷依頼をご利用いただきありがとうございます。内容を確認のうえ、制作・発送のご案内をメールでご連絡します。</div>

    <div style="margin-top:14px; padding:12px; border:1px solid rgba(0,0,0,0.12); border-radius:12px;">
      <div style="font-weight:800;">注文情報</div>
      <div style="margin-top:6px; font-size:13px; line-height:1.7;">
        注文ID: <span style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">${safeText(input.orderId)}</span><br/>
        モデル: ${safeText(input.modelName)}<br/>
        ブロック: ${input.blockCount}（補完 ${input.supportBlockCount}）<br/>
        サイズ: 最大辺 ${mm(input.sizeMaxMm, 1)}mm / 1unit=${mm(input.mmPerUnit, 2)}mm<br/>
        指紋: ${input.modelFingerprint ? `<span style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">${safeText(input.modelFingerprint)}</span>` : "-"}
      </div>
    </div>

    <h3 style="margin:18px 0 8px 0;">請求書</h3>
    <div style="border:1px solid rgba(0,0,0,0.12); border-radius:12px; padding:12px;">
      <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
        <div style="min-width:240px;">
          <div style="font-weight:800;">${safeText(company)}</div>
          ${companyAddr ? `<div style="font-size:12px; color:#6b7280; white-space:pre-wrap;">${safeText(companyAddr)}</div>` : ""}
          ${companyTel ? `<div style="font-size:12px; color:#6b7280;">TEL: ${safeText(companyTel)}</div>` : ""}
          ${companyEmail ? `<div style="font-size:12px; color:#6b7280;">${safeText(companyEmail)}</div>` : ""}
        </div>
        <div style="min-width:240px; text-align:right;">
          <div style="font-size:12px; color:#6b7280;">請求書番号</div>
          <div style="font-weight:900;">${safeText(invoiceNo)}</div>
          <div style="font-size:12px; color:#6b7280; margin-top:6px;">発行日: ${safeText(issuedAt)}</div>
          ${dueAt ? `<div style="font-size:12px; color:#6b7280;">お支払期限: ${safeText(dueAt)}</div>` : ""}
        </div>
      </div>

      <div style="margin-top:12px; font-size:13px;">
        <div style="font-weight:700;">請求先</div>
        <div style="color:#374151;">${safeText(input.customerName)} 様（${safeText(input.to)}）</div>
      </div>

      <table style="width:100%; border-collapse:collapse; margin-top:12px; font-size:13px;">
        <thead>
          <tr>
            <th style="text-align:left; padding:6px 0; border-bottom:1px solid rgba(0,0,0,0.12);">項目</th>
            <th style="text-align:right; padding:6px 0; border-bottom:1px solid rgba(0,0,0,0.12);">金額</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:6px 0;">3Dプリント制作（推定体積 ${mm(input.volumeCm3, 1)}cm³）</td>
            <td style="padding:6px 0; text-align:right;">${yen(input.subtotalYen)} 円</td>
          </tr>
          ${discountLine}
          <tr>
            <td style="padding:8px 0; font-weight:900; border-top:1px solid rgba(0,0,0,0.12);">合計（送料別）</td>
            <td style="padding:8px 0; text-align:right; font-weight:900; border-top:1px solid rgba(0,0,0,0.12);">${yen(input.totalYen)} 円</td>
          </tr>
        </tbody>
      </table>
      ${ticketInfo}
      ${payInfo}
      <div style="margin-top:10px; color:#6b7280; font-size:12px;">
        ※送料は配送先により別途ご案内します。制作開始後のキャンセルは原則お受けできません。
      </div>
    </div>

    <div style="margin-top:14px; color:#6b7280; font-size:12px;">
      このメールに心当たりがない場合は破棄してください。
    </div>
  </div>
  `;
}

async function sendViaResend(args: { to: string; subject: string; html: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY is not set; skip sending email");
    return { ok: false, skipped: true };
  }

  const from = process.env.EMAIL_FROM || process.env.RESEND_FROM || "Q-BU <noreply@q-bu.com>";
  const bcc = process.env.EMAIL_BCC || "";

  const payload: any = {
    from,
    to: args.to,
    subject: args.subject,
    html: args.html,
  };
  if (bcc) payload.bcc = bcc;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`resend_failed:${res.status}:${text.slice(0, 200)}`);
  }
  return { ok: true };
}

export async function sendOrderEmails(input: SendOrderEmailsInput) {
  const subject = `【Q-BU】印刷依頼を受け付けました（請求書） / 注文ID ${input.orderId.slice(0, 8)}`;
  const html = buildInvoiceHtml(input);
  return await sendViaResend({ to: input.to, subject, html });
}
