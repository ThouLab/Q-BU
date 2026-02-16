import crypto from "crypto";

export type ShippingInfo = {
  name: string;
  email: string;
  phone?: string;
  /** e.g. "123-4567" */
  postal_code?: string;
  /** prefecture/city/town resolved by postal lookup (optional) */
  prefecture?: string;
  city?: string;
  town?: string;
  /** street/building etc (optional) */
  address_line2?: string;
  address: string;
};

/**
 * Normalize email for hashing/search.
 * - trim + lowercase
 */
export function normalizeEmail(email: string): string {
  return (email || "").trim().toLowerCase();
}

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function emailHash(email: string): string {
  const norm = normalizeEmail(email);
  return norm ? sha256Hex(norm) : "";
}

/**
 * Try to find Japanese postal code in address and return prefix (first 3 digits).
 * Example: 123-4567 -> "123"
 */
export function postalCodePrefixFromAddress(address: string): string | null {
  const a = (address || "").trim();
  if (!a) return null;
  const m = a.match(/\b(\d{3})-?(\d{4})\b/);
  if (!m) return null;
  return m[1] || null;
}

export function postalCodePrefix(code: string): string | null {
  const s = String(code || "").trim();
  const m = s.match(/^(\d{3})-?(\d{4})$/);
  if (!m) return null;
  return m[1] || null;
}

function decodeKeyMaterial(raw: string): Buffer | null {
  const s = (raw || "").trim();
  if (!s) return null;

  if (s.startsWith("base64:")) {
    try {
      const b = Buffer.from(s.slice("base64:".length), "base64");
      return b.length >= 32 ? b.subarray(0, 32) : null;
    } catch {
      return null;
    }
  }

  if (s.startsWith("hex:")) {
    const hex = s.slice("hex:".length).trim();
    if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
    const b = Buffer.from(hex, "hex");
    return b.length >= 32 ? b.subarray(0, 32) : null;
  }

  // 64-hex (=32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    return Buffer.from(s, "hex");
  }

  // base64 (32 bytes)
  try {
    const b = Buffer.from(s, "base64");
    if (b.length === 32) return b;
  } catch {
    // ignore
  }

  // fallback: derive from string
  return crypto.createHash("sha256").update(s).digest();
}

/**
 * Shipping encryption key
 * - Prefer QBU_SHIPPING_ENC_KEY (32 bytes recommended)
 * - Fallback: derive from SUPABASE_SERVICE_ROLE_KEY (stable secret on server)
 */
function getKey(): Buffer {
  const env = process.env.QBU_SHIPPING_ENC_KEY || process.env.SHIPPING_ENC_KEY || "";
  const fromEnv = decodeKeyMaterial(env);
  if (fromEnv && fromEnv.length === 32) return fromEnv;

  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const fromFallback = decodeKeyMaterial(fallback);
  if (fromFallback && fromFallback.length === 32) return fromFallback;

  throw new Error("shipping_encryption_key_missing");
}

/**
 * Encrypt shipping info (AES-256-GCM) into a compact token string.
 * token format: v1.<iv_b64>.<cipher_b64>.<tag_b64>
 */
export function encryptShipping(info: ShippingInfo): string {
  const key = getKey();

  const iv = crypto.randomBytes(12); // recommended for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const plaintext = Buffer.from(JSON.stringify(info), "utf8");
  const cipherText = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1.${iv.toString("base64")}.${cipherText.toString("base64")}.${tag.toString("base64")}`;
}

export function decryptShipping(token: string): ShippingInfo {
  const key = getKey();

  const parts = (token || "").split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("bad_shipping_token");
  }

  const iv = Buffer.from(parts[1], "base64");
  const ct = Buffer.from(parts[2], "base64");
  const tag = Buffer.from(parts[3], "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  const obj = JSON.parse(plain);

  // minimal shape validation
  return {
    name: typeof obj?.name === "string" ? obj.name : "",
    email: typeof obj?.email === "string" ? obj.email : "",
    phone: typeof obj?.phone === "string" ? obj.phone : undefined,
    postal_code: typeof obj?.postal_code === "string" ? obj.postal_code : undefined,
    prefecture: typeof obj?.prefecture === "string" ? obj.prefecture : undefined,
    city: typeof obj?.city === "string" ? obj.city : undefined,
    town: typeof obj?.town === "string" ? obj.town : undefined,
    address_line2: typeof obj?.address_line2 === "string" ? obj.address_line2 : undefined,
    address: typeof obj?.address === "string" ? obj.address : "",
  };
}
