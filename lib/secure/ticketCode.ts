import crypto from "crypto";

/**
 * Ticket code utilities (server-side)
 * - We do NOT store raw codes in DB.
 * - We store a salted SHA-256 hash (code_hash).
 */

export type TicketType = "percent" | "fixed" | "free" | "shipping_free";

function getTicketSalt(): string {
  // Dedicated salt is optional. Fallback to service role key (server secret).
  return process.env.QBU_TICKET_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

/**
 * Normalize user input.
 * - upper-case
 * - remove spaces and hyphens
 */
export function normalizeTicketCode(code: string): string {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "");
}

/**
 * Generate a human-friendly code (shown ONCE at creation).
 */
export function generateTicketCode(): string {
  // 12 hex chars = 48 bits
  const hex = crypto.randomBytes(6).toString("hex").toUpperCase();
  return `QBU-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

export function ticketCodePrefix(code: string): string {
  const n = normalizeTicketCode(code);
  return n.slice(0, 8);
}

/**
 * Salted SHA-256 hash used as DB lookup key.
 */
export function hashTicketCode(code: string): string {
  const salt = getTicketSalt();
  const normalized = normalizeTicketCode(code);
  return crypto.createHash("sha256").update(`${salt}|${normalized}`).digest("hex");
}

export function safeTicketType(v: any): TicketType | null {
  switch (v) {
    case "percent":
    case "fixed":
    case "free":
    case "shipping_free":
      return v;
    default:
      return null;
  }
}

export function computeDiscountYen(args: {
  type: TicketType;
  value: number | null;
  subtotalYen: number;
}): number {
  const subtotal = Math.max(0, Math.round(args.subtotalYen || 0));
  if (subtotal <= 0) return 0;

  if (args.type === "free") return subtotal;
  if (args.type === "shipping_free") return 0; // shipping is not modeled yet

  if (args.type === "percent") {
    const pct = Number(args.value);
    if (!Number.isFinite(pct)) return 0;
    const p = Math.max(0, Math.min(100, pct));
    return Math.floor((subtotal * p) / 100);
  }

  // fixed
  const fixed = Number(args.value);
  if (!Number.isFinite(fixed)) return 0;
  return Math.max(0, Math.min(subtotal, Math.round(fixed)));
}

export function roundToStepYen(amountYen: number, stepYen: number): number {
  const step = Math.max(1, Math.round(Number(stepYen) || 1));
  const a = Math.max(0, Math.round(Number(amountYen) || 0));
  return Math.round(a / step) * step;
}
