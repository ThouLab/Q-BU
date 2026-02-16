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

export type QbuUnpackResult =
  | { ok: true; body: Uint8Array; encrypted: boolean; compressed: boolean }
  | { ok: false; error: string };

const MAGIC = new Uint8Array([0x51, 0x42, 0x55, 0x31]); // "QBU1"
const FLAG_ENCRYPTED = 1;
const FLAG_GZIP = 2;

// Backward compatibility:
// v1.0.15 では「パスワード未入力でも固定フレーズで暗号化」していたため、
// decode 側ではパスワード未入力時にこの固定フレーズも試せるように残しています。
const DEFAULT_PASSPHRASE = "qbu-default";

// TS5.5+ typed arrays are generic over ArrayBufferLike. WebCrypto BufferSource expects ArrayBuffer-backed views.
// Most browser-created Uint8Array are ArrayBuffer-backed, but we defensively ensure the correct type.
function asArrayBufferView(bytes: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes); // copy into a new ArrayBuffer
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

async function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function readAllBytes(stream: ReadableStream<any>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  let lastYield = typeof performance !== "undefined" ? performance.now() : Date.now();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;

    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    chunks.push(chunk);
    total += chunk.length;

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - lastYield > 16) {
      lastYield = now;
      await yieldToEventLoop();
    }
  }

  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

async function gzipCompress(input: Uint8Array): Promise<Uint8Array> {
  if (typeof (globalThis as any).CompressionStream === "undefined") return input;

  const cs = new (globalThis as any).CompressionStream("gzip");
  // Read concurrently to avoid backpressure deadlock on large payloads.
  const readPromise = readAllBytes(cs.readable);

  const writer = cs.writable.getWriter();
  await writer.write(input);
  await writer.close();

  return await readPromise;
}

async function gzipDecompress(input: Uint8Array): Promise<Uint8Array> {
  if (typeof (globalThis as any).DecompressionStream === "undefined") {
    throw new Error("このブラウザはgzip展開に対応していません。");
  }

  const ds = new (globalThis as any).DecompressionStream("gzip");
  // Read concurrently (Response(arrayBuffer) は大きいデータで固まりやすいことがある)
  const readPromise = readAllBytes(ds.readable);

  const writer = ds.writable.getWriter();
  // Chunked write to keep the event loop responsive.
  const CHUNK = 1024 * 1024; // 1MB
  for (let i = 0; i < input.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, input.length);
    await writer.write(input.subarray(i, end));
    if (i % (CHUNK * 8) === 0) await yieldToEventLoop();
  }
  await writer.close();

  return await readPromise;
}

async function deriveAesKey(passphrase: string, salt: Uint8Array<ArrayBufferLike>, iterations: number): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const safeSalt = asArrayBufferView(salt);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: safeSalt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encode payload into .qbu bytes.
 *
 * - compress: default true (gzip if supported)
 * - password: optional. If empty, we DO NOT encrypt (fast path).
 *             If provided, we encrypt with AES-GCM (PBKDF2 derived key).
 */
export type QbuEncodeOptions = {
  password?: string;
  compress?: boolean;
  /**
   * 0.0 .. 1.0 progress callback for large payload packaging.
   * (Used to keep UI responsive; may be called many times.)
   */
  onProgress?: (progress: number) => void;
};

async function writeWithTimeout(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  writer: any,
  chunk: Uint8Array,
  timeoutMs: number
): Promise<void> {
  if (!timeoutMs || timeoutMs <= 0) {
    await writer.write(chunk);
    return;
  }

  let t: any;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error("gzip_write_timeout")), timeoutMs);
  });

  try {
    await Promise.race([writer.write(chunk), timeout]);
  } finally {
    if (t) clearTimeout(t);
  }
}

function isStringArray(value: any): value is string[] {
  return Array.isArray(value) && (value.length === 0 || typeof value[0] === "string");
}

/**
 * For large voxel projects, JSON.stringify(payload) can freeze the UI for a long time.
 * This builder streams the JSON bytes (and optionally gzip) incrementally.
 */
async function buildJsonBody(
  payload: any,
  opts: { compress: boolean; onProgress?: (p: number) => void }
): Promise<{ body: Uint8Array; compressed: boolean }> {
  const blocksRaw = payload && typeof payload === "object" ? (payload as any).blocks : null;
  const blocks = isStringArray(blocksRaw) ? blocksRaw : null;

  // Small payloads: keep it simple and fast.
  const STREAM_THRESHOLD = 500;
  if (!blocks || blocks.length < STREAM_THRESHOLD) {
    const jsonBytes = new TextEncoder().encode(JSON.stringify(payload));
    if (!opts.compress) return { body: jsonBytes, compressed: false };

    const gz = await gzipCompress(jsonBytes);
    // gzipCompress returns input unchanged if CompressionStream is unavailable.
    if (gz !== jsonBytes) return { body: gz, compressed: true };
    return { body: jsonBytes, compressed: false };
  }

  const total = blocks.length;
  const onProgress = opts.onProgress;

  // Split payload into "rest" + blocks array to stream only the heavy part.
  const rest: any = { ...(payload as any) };
  delete rest.blocks;

  let head = JSON.stringify(rest);
  if (head.endsWith("}")) {
    head = head === "{}" ? '{"blocks":[' : head.slice(0, -1) + ',"blocks":[';
  } else {
    head = '{"blocks":[';
  }
  const tail = "]}";

  const enc = new TextEncoder();
  const CHUNK_BLOCKS = 2000;

  // If gzip is requested and supported, stream into CompressionStream.
  if (opts.compress && typeof (globalThis as any).CompressionStream !== "undefined") {
    try {
      const cs = new (globalThis as any).CompressionStream("gzip");
      const readPromise = readAllBytes(cs.readable);
      const writer = cs.writable.getWriter();

      // Some browser implementations can hang here on large payloads due to backpressure.
      // Use a timeout to fall back to the non-gzip path.
      await writeWithTimeout(writer, enc.encode(head), 2000);

      let lastYield = typeof performance !== "undefined" ? performance.now() : Date.now();

      for (let i = 0; i < total; i += CHUNK_BLOCKS) {
        const end = Math.min(i + CHUNK_BLOCKS, total);

        const parts: string[] = [];
        for (let j = i; j < end; j++) parts.push(JSON.stringify(blocks[j]));

        let chunkStr = parts.join(",");
        if (i > 0) chunkStr = "," + chunkStr;

        await writeWithTimeout(writer, enc.encode(chunkStr), 8000);

        if (onProgress) onProgress(end / total);

        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        if (now - lastYield > 16) {
          lastYield = now;
          await yieldToEventLoop();
        }
      }

      await writeWithTimeout(writer, enc.encode(tail), 8000);
      await writer.close();

      if (onProgress) onProgress(1);

      const out = await readPromise;
      return { body: out, compressed: true };
    } catch (e) {
      // Fallback to non-gzip path below.
      // eslint-disable-next-line no-console
      console.warn("[QBU] gzip packaging failed; falling back to plain JSON.", e);
    }
  }

  // No gzip (or unsupported): build bytes in manageable chunks.
  const chunks: Uint8Array[] = [];
  chunks.push(enc.encode(head));

  let lastYield = typeof performance !== "undefined" ? performance.now() : Date.now();

  for (let i = 0; i < total; i += CHUNK_BLOCKS) {
    const end = Math.min(i + CHUNK_BLOCKS, total);

    const parts: string[] = [];
    for (let j = i; j < end; j++) parts.push(JSON.stringify(blocks[j]));

    let chunkStr = parts.join(",");
    if (i > 0) chunkStr = "," + chunkStr;

    chunks.push(enc.encode(chunkStr));

    if (onProgress) onProgress(end / total);

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - lastYield > 16) {
      lastYield = now;
      await yieldToEventLoop();
    }
  }

  chunks.push(enc.encode(tail));

  let totalLen = 0;
  for (const c of chunks) totalLen += c.length;

  const out = new Uint8Array(totalLen);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }

  return { body: out, compressed: false };
}

/**
 * Encode payload into QBU bytes.
 * - If password is empty: plain (optionally gzipped) package.
 * - If password is provided: AES-GCM encrypted (PBKDF2 derived key).
 */
export async function encodeQbu(payload: any, opts?: QbuEncodeOptions): Promise<Uint8Array> {
  const rawPass = (opts?.password || "").trim();
  const wantEncrypt = rawPass.length > 0;
  const wantCompress = opts?.compress !== false;

  let flags = 0;

  const built = await buildJsonBody(payload, { compress: wantCompress, onProgress: opts?.onProgress });
  const body = built.body;
  if (built.compressed) flags |= FLAG_GZIP;

  if (!wantEncrypt) {
    // Plain (optionally gzipped)
    const header = new Uint8Array(8);
    header.set(MAGIC, 0);
    header[4] = flags; // no encrypted flag
    header[5] = 0;
    header[6] = 0;
    header[7] = 0;
    return concatBytes(header, body);
  }

  // Encrypted
  flags |= FLAG_ENCRYPTED;

  // UX-first: keep reasonably strong but responsive.
  // (We can raise later if needed; admin can recommend strong password.)
  const iterations = 60_000;

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const key = await deriveAesKey(rawPass, salt, iterations);
  const safeIv = asArrayBufferView(iv);
  const safeBody = asArrayBufferView(body);
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: safeIv }, key, safeBody);
  const cipher = new Uint8Array(cipherBuf);

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

/**
 * Unpack QBU envelope and return decrypted + decompressed body bytes.
 * (Fast path for huge projects: caller can parse body without JSON.parse on the main thread.)
 */
export async function unpackQbu(bytes: Uint8Array, opts?: { password?: string }): Promise<QbuUnpackResult> {
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

      const rawPass = (opts?.password || "").trim();
      const pass = rawPass || DEFAULT_PASSPHRASE;

      const key = await deriveAesKey(pass, salt, iterations || 60_000);
      const safeIv = asArrayBufferView(iv);
      const safeCipher = asArrayBufferView(cipher);
      const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: safeIv }, key, safeCipher);
      body = new Uint8Array(plainBuf);
    }

    if (compressed) {
      body = await gzipDecompress(body);
    }

    return { ok: true, body, encrypted, compressed };
  } catch (e: any) {
    return { ok: false, error: e?.message || "qbu_unpack_failed" };
  }
}

export async function decodeQbu(bytes: Uint8Array, opts?: { password?: string }): Promise<QbuDecodeResult> {
  const unpacked = await unpackQbu(bytes, opts);
  if (!unpacked.ok) return unpacked;
  try {
    const text = new TextDecoder().decode(unpacked.body);
    const payload = JSON.parse(text);
    return { ok: true, payload, encrypted: unpacked.encrypted, compressed: unpacked.compressed };
  } catch (e: any) {
    return { ok: false, error: e?.message || "qbu_decode_failed" };
  }
}
