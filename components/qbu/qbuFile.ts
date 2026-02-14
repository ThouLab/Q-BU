// QBU packaged file format (.qbu)
//
// Goals:
// - Keep JSON compatibility (we still support .json project files)
// - Provide a compact, optionally password-protected format for saving projects
// - Implemented entirely on the client (no server dependency)
//
// Format (binary):
//   0..3   magic "QBU1"
//   4      flags (bit0=encrypted, bit1=gzip)
//   5..7   reserved
//   if encrypted:
//     8..11  iterations (uint32 LE)
//     12..27 salt (16 bytes)
//     28..39 iv (12 bytes) (AES-GCM)
//     40..   ciphertext
//   else:
//     8..    payload (plain)
//   payload is JSON bytes, optionally gzip compressed.

export type QbuDecodeResult =
  | { ok: true; payload: any; encrypted: boolean; compressed: boolean }
  | { ok: false; error: string };

const MAGIC = new Uint8Array([0x51, 0x42, 0x55, 0x31]); // "QBU1"
const FLAG_ENCRYPTED = 1;
const FLAG_GZIP = 2;

// If the user doesn't provide a password, we still encrypt with this fixed phrase.
// NOTE: This is "obfuscation" only. For real confidentiality, set a user password.
const DEFAULT_PASSPHRASE = "qbu-default";

function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  // BufferSource in lib.dom expects ArrayBuffer (not SharedArrayBuffer).
  // TypedArray.buffer is ArrayBuffer in browsers, but TS types treat it as ArrayBufferLike,
  // so we slice+cast to satisfy the type system.
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function gzipCompress(input: Uint8Array): Promise<Uint8Array> {
  if (typeof (globalThis as any).CompressionStream === "undefined") return input;
  const cs = new (globalThis as any).CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  await writer.write(input);
  await writer.close();
  const buf = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(buf);
}

async function gzipDecompress(input: Uint8Array): Promise<Uint8Array> {
  if (typeof (globalThis as any).DecompressionStream === "undefined") {
    throw new Error("このブラウザはgzip展開に対応していません。");
  }
  const ds = new (globalThis as any).DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  await writer.write(input);
  await writer.close();
  const buf = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(buf);
}

async function deriveAesKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encodeQbu(payload: any, opts?: { password?: string; compress?: boolean }): Promise<Uint8Array> {
  const pass = (opts?.password || "").trim() || DEFAULT_PASSPHRASE;
  const wantCompress = opts?.compress !== false;

  const jsonBytes = new TextEncoder().encode(JSON.stringify(payload));

  let flags = 0;
  let body: Uint8Array = jsonBytes;
  if (wantCompress) {
    const gz = await gzipCompress(jsonBytes);
    // If compression isn't supported, gzipCompress returns input unchanged.
    if (gz !== jsonBytes) {
      body = gz;
      flags |= FLAG_GZIP;
    }
  }

  // Always encrypt (password is optional; fixed phrase acts as a lightweight obfuscation).
  flags |= FLAG_ENCRYPTED;
  const iterations = 120_000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(pass, salt, iterations);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(body))
  );

  const header = new Uint8Array(40);
  header.set(MAGIC, 0);
  header[4] = flags;
  header[5] = 0;
  header[6] = 0;
  header[7] = 0;

  const dv = new DataView(header.buffer);
  dv.setUint32(8, iterations, true);
  header.set(salt, 12);
  header.set(iv, 28);

  return concatBytes(header, cipher);
}

export async function decodeQbu(bytes: Uint8Array, opts?: { password?: string }): Promise<QbuDecodeResult> {
  try {
    if (bytes.length < 8) return { ok: false, error: "qbu_too_small" };
    const magic = bytes.slice(0, 4);
    if (!equalBytes(magic, MAGIC)) return { ok: false, error: "qbu_bad_magic" };

    const flags = bytes[4] || 0;
    const encrypted = (flags & FLAG_ENCRYPTED) !== 0;
    const compressed = (flags & FLAG_GZIP) !== 0;

    let offset = 8;
    let body: Uint8Array = bytes.slice(offset);

    if (encrypted) {
      if (bytes.length < 40) return { ok: false, error: "qbu_bad_header" };
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const iterations = dv.getUint32(8, true);
      const salt = bytes.slice(12, 28);
      const iv = bytes.slice(28, 40);
      offset = 40;
      const cipher = bytes.slice(offset);
      const pass = (opts?.password || "").trim() || DEFAULT_PASSPHRASE;
      const key = await deriveAesKey(pass, salt, iterations || 120_000);
      body = new Uint8Array(
        await crypto.subtle.decrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(cipher))
      );
    }

    if (compressed) {
      body = await gzipDecompress(body);
    }

    const text = new TextDecoder().decode(body);
    const payload = JSON.parse(text);
    return { ok: true, payload, encrypted, compressed };
  } catch (e: any) {
    return { ok: false, error: e?.message || "qbu_decode_failed" };
  }
}
