"use client";

import React, { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

import VoxelEditor from "@/components/qbu/VoxelEditor";
import VoxelPreview from "@/components/qbu/VoxelPreview";
import SaveModal from "@/components/qbu/SaveModal";
import MyModelsModal from "@/components/qbu/MyModelsModal";
import PrintPrepModal from "@/components/qbu/PrintPrepModal";
import { useTelemetry } from "@/components/telemetry/TelemetryProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { computeBBox, keyOf, parseKey } from "@/components/qbu/voxelUtils";
import { computeMixedBBox, parseSubKey, subMinToWorldCenter, type SubKey } from "@/components/qbu/subBlocks";
import { DEFAULT_REF_SETTINGS, type ViewDir } from "@/components/qbu/settings";
import { DEFAULT_CUBE_COLOR } from "@/components/qbu/filamentColors";
import { readFileAsDataURL, splitThreeViewSheet, type RefImages } from "@/components/qbu/referenceUtils";
import { countComponents } from "@/components/qbu/printPrepUtils";
import { resolvePrintScale, type PrintScaleSetting } from "@/components/qbu/printScale";
import { encodeQbu, unpackQbu } from "@/components/qbu/qbuFile";
import { base64ToBytes, generateThumbDataUrl } from "@/components/qbu/myModelsUtils";

const STORAGE_KEY = "qbu_project_v1";
const DRAFT_KEY = "qbu_draft_v2";
const PENDING_SAVE_KEY = "qbu_pending_save_v1";
const PRINT_DRAFT_KEY = "qbu_print_draft_v1";
const DEFAULT_TARGET_MM = 50; // 5cm

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    // Safari対策：即revokeすると失敗することがあるため、次tickで解放
    window.setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
      try {
        a.remove();
      } catch {
        // ignore
      }
    }, 0);
  }
}
// --- helpers for non-blocking save ---
function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(() => resolve());
    } else {
      window.setTimeout(() => resolve(), 0);
    }
  });
}

async function bytesToBase64Async(bytes: Uint8Array<ArrayBufferLike>): Promise<string> {
  // Browser: FileReader (async, avoids blocking UI for large files)
  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      try {
        // TS5.5+ typed arrays are generic over ArrayBufferLike. BlobPart expects ArrayBuffer-backed views.
        // Ensure the view is backed by ArrayBuffer (copy only when needed).
        const safeBytes =
          bytes.buffer instanceof ArrayBuffer
            ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            : new Uint8Array(bytes);

        const blob = new Blob([safeBytes], { type: "application/octet-stream" });
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("base64_encode_failed"));
        reader.onload = () => {
          const result = String(reader.result || "");
          const comma = result.indexOf(",");
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.readAsDataURL(blob);
      } catch (e) {
        reject(e);
      }
    });
  }

  // Node.js fallback
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyGlobal = globalThis as any;
  if (typeof anyGlobal.Buffer !== "undefined") {
    // Buffer.from accepts Uint8Array in Node.
    return anyGlobal.Buffer.from(bytes as any).toString("base64");
  }
  throw new Error("base64_encode_unavailable");
}

function calcBase64DecodedLength(b64: string): number {
  const s = String(b64 || "").trim();
  if (!s) return 0;
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((s.length * 3) / 4) - pad);
}

/**
 * base64 -> Uint8Array (chunked)
 * - atob() を巨大文字列で一気に呼ぶと固まりやすいため、チャンク分割して復元します。
 * - 進捗をコールバックで通知できます。
 */
async function base64ToBytesChunkedAsync(b64: string, onProgress?: (p: number) => void): Promise<Uint8Array> {
  // Node / edge
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyGlobal = globalThis as any;
  if (typeof anyGlobal.Buffer !== "undefined") {
    return new Uint8Array(anyGlobal.Buffer.from(String(b64 || ""), "base64"));
  }

  const s = String(b64 || "");
  if (!s) return new Uint8Array(0);

  const outLen = calcBase64DecodedLength(s);
  const out = new Uint8Array(outLen);

  // base64 は 4文字単位（=3bytes）なので、チャンクも4の倍数に揃える
  const CHUNK_BASE64 = 4 * 1024 * 1024; // 4MB base64 -> 3MB bytes 程度
  let outOff = 0;
  let i = 0;
  let lastUi = 0;

  while (i < s.length) {
    let end = Math.min(s.length, i + CHUNK_BASE64);

    // 最終チャンク以外は 4 の倍数に丸める（paddingを壊さない）
    if (end < s.length) {
      end -= (end - i) % 4;
      if (end <= i) end = Math.min(s.length, i + 4 * 1024);
    }

    const part = s.slice(i, end);
    const bin = atob(part);
    for (let j = 0; j < bin.length; j++) out[outOff++] = bin.charCodeAt(j);

    i = end;

    if (onProgress) {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - lastUi > 80 || i >= s.length) {
        lastUi = now;
        onProgress(i / s.length);
      }
    }

    await nextTick();
  }

  return outOff === out.length ? out : out.slice(0, outOff);
}

function sampleSetForThumb(src: Set<string>, max = 12000): Set<string> {
  if (!src || src.size <= max) return src;
  const out = new Set<string>();
  const step = Math.max(1, Math.ceil(src.size / max));
  let i = 0;
  for (const k of src) {
    if (i % step === 0) out.add(k);
    i++;
    if (out.size >= max) break;
  }
  return out;
}
type FastParsedProject = {
  blocks: Set<string>;
  color?: string;
  edges?: boolean;
  version?: number;
  kind?: string;
};

// JSON field patterns (ASCII)
// "blocks" / "color" / "edges" / "version" / "kind"
const PAT_BLOCKS = new Uint8Array([34, 98, 108, 111, 99, 107, 115, 34]);
const PAT_COLOR = new Uint8Array([34, 99, 111, 108, 111, 114, 34]);
const PAT_EDGES = new Uint8Array([34, 101, 100, 103, 101, 115, 34]);
const PAT_VERSION = new Uint8Array([34, 118, 101, 114, 115, 105, 111, 110, 34]);
const PAT_KIND = new Uint8Array([34, 107, 105, 110, 100, 34]);
// Future binary body marker: "QBP1"
const PAT_QBP1 = new Uint8Array([81, 66, 80, 49]);

function findPattern(bytes: Uint8Array, pattern: Uint8Array, start: number, end: number): number {
  const max = end - pattern.length;
  const first = pattern[0];
  for (let i = start; i <= max; i++) {
    if (bytes[i] !== first) continue;
    let ok = true;
    for (let j = 1; j < pattern.length; j++) {
      if (bytes[i + j] !== pattern[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function findByte(bytes: Uint8Array, byte: number, start: number, end: number): number {
  for (let i = start; i < end; i++) if (bytes[i] === byte) return i;
  return -1;
}

function skipWs(bytes: Uint8Array, i: number, end: number): number {
  while (i < end) {
    const c = bytes[i];
    // space / tab / nl / cr etc.
    if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) {
      i++;
      continue;
    }
    break;
  }
  return i;
}

function extractJsonStringField(bytes: Uint8Array, keyPattern: Uint8Array, searchEnd: number): string | undefined {
  const idx = findPattern(bytes, keyPattern, 0, searchEnd);
  if (idx < 0) return undefined;

  let i = idx + keyPattern.length;
  i = findByte(bytes, 0x3a, i, searchEnd); // ':'
  if (i < 0) return undefined;
  i++;
  i = skipWs(bytes, i, searchEnd);

  if (bytes[i] !== 0x22) return undefined; // '"'
  i++;
  const start = i;

  i = findByte(bytes, 0x22, i, searchEnd);
  if (i < 0) return undefined;

  const dec = new TextDecoder();
  return dec.decode(bytes.subarray(start, i));
}

function extractJsonBooleanField(bytes: Uint8Array, keyPattern: Uint8Array, searchEnd: number): boolean | undefined {
  const idx = findPattern(bytes, keyPattern, 0, searchEnd);
  if (idx < 0) return undefined;

  let i = idx + keyPattern.length;
  i = findByte(bytes, 0x3a, i, searchEnd); // ':'
  if (i < 0) return undefined;
  i++;
  i = skipWs(bytes, i, searchEnd);

  const c = bytes[i];
  if (c === 0x74) return true; // 't' in 'true'
  if (c === 0x66) return false; // 'f' in 'false'
  return undefined;
}

function extractJsonNumberField(bytes: Uint8Array, keyPattern: Uint8Array, searchEnd: number): number | undefined {
  const idx = findPattern(bytes, keyPattern, 0, searchEnd);
  if (idx < 0) return undefined;

  let i = idx + keyPattern.length;
  i = findByte(bytes, 0x3a, i, searchEnd); // ':'
  if (i < 0) return undefined;
  i++;
  i = skipWs(bytes, i, searchEnd);

  let sign = 1;
  if (bytes[i] === 0x2d) {
    sign = -1;
    i++;
  }

  let num = 0;
  let has = false;
  while (i < searchEnd) {
    const c = bytes[i];
    if (c < 0x30 || c > 0x39) break;
    has = true;
    num = num * 10 + (c - 0x30);
    i++;
  }
  if (!has) return undefined;
  return sign * num;
}

function readSignedInt(bytes: Uint8Array, i: number, end: number): { value: number; next: number } {
  let sign = 1;
  if (bytes[i] === 0x2d) {
    sign = -1;
    i++;
  }
  let num = 0;
  while (i < end) {
    const c = bytes[i];
    if (c < 0x30 || c > 0x39) break;
    num = num * 10 + (c - 0x30);
    i++;
  }
  return { value: sign * num, next: i };
}

async function parseBinaryProjectBody(
  body: Uint8Array,
  opts: { expectedBlocks?: number; onStatus?: (s: string) => void }
): Promise<FastParsedProject> {
  // Layout:
  // 0..3  "QBP1"
  // 4     fmtVersion (1)
  // 5     coordFormat (1=int16, 2=int32)
  // 6..7  reserved
  // 8..11 metaLen (u32)
  // 12..  metaJson (utf8)
  // ..    blockCount (u32)
  // ..    coords
  if (body.length < 16) throw new Error("qbu_body_too_small");

  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const fmtVersion = body[4] || 1;
  if (fmtVersion !== 1) throw new Error("qbu_body_version_unsupported");

  const coordFmt = body[5] || 2;
  const metaLen = dv.getUint32(8, true);

  const metaStart = 12;
  const metaEnd = metaStart + metaLen;
  if (metaEnd + 4 > body.length) throw new Error("qbu_body_meta_bad");

  const metaText = new TextDecoder().decode(body.subarray(metaStart, metaEnd));
  const meta = metaText ? JSON.parse(metaText) : {};

  const blockCount = dv.getUint32(metaEnd, true);
  let off = metaEnd + 4;

  const blocks = new Set<string>();
  const total = opts.expectedBlocks && opts.expectedBlocks > 0 ? opts.expectedBlocks : blockCount;

  const CHUNK = 20000;
  let lastUi = 0;

  for (let i = 0; i < blockCount; i++) {
    let x = 0,
      y = 0,
      z = 0;

    if (coordFmt === 1) {
      x = dv.getInt16(off, true);
      y = dv.getInt16(off + 2, true);
      z = dv.getInt16(off + 4, true);
      off += 6;
    } else {
      x = dv.getInt32(off, true);
      y = dv.getInt32(off + 4, true);
      z = dv.getInt32(off + 8, true);
      off += 12;
    }

    blocks.add(`${x},${y},${z}`);

    if ((i + 1) % CHUNK === 0 || i === blockCount - 1) {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (opts.onStatus && now - lastUi > 80) {
        lastUi = now;
        if (total > 0) {
          const p = Math.min(1, (i + 1) / total);
          const pct = Math.max(0, Math.min(100, p * 100));
          const pctText = pct < 1 ? pct.toFixed(2) : pct < 10 ? pct.toFixed(1) : String(Math.floor(pct));
          opts.onStatus(`QBUを解析しています... ${pctText}% (${(i + 1).toLocaleString()}/${total.toLocaleString()})`);
        } else {
          opts.onStatus(`QBUを解析しています... ${(i + 1).toLocaleString()} blocks`);
        }
      }
      await nextTick();
    }
  }

  if (blocks.size === 0) blocks.add(keyOf({ x: 0, y: 0, z: 0 }));

  return {
    blocks,
    color: typeof meta?.color === "string" ? meta.color : undefined,
    edges: typeof meta?.edges === "boolean" ? meta.edges : undefined,
    version: typeof meta?.version === "number" ? meta.version : undefined,
    kind: typeof meta?.kind === "string" ? meta.kind : undefined,
  };
}

async function parseJsonProjectBody(
  body: Uint8Array,
  opts: { expectedBlocks?: number; onStatus?: (s: string) => void }
): Promise<FastParsedProject> {
  const searchEnd = Math.min(body.length, 64 * 1024);
  const color = extractJsonStringField(body, PAT_COLOR, searchEnd);
  const edges = extractJsonBooleanField(body, PAT_EDGES, searchEnd);
  const version = extractJsonNumberField(body, PAT_VERSION, searchEnd);
  const kind = extractJsonStringField(body, PAT_KIND, searchEnd);

  const idx = findPattern(body, PAT_BLOCKS, 0, body.length);
  if (idx < 0) {
    // fallback (small file): try normal JSON.parse
    const text = new TextDecoder().decode(body);
    const obj = JSON.parse(text);
    const blocksArr: string[] = Array.isArray(obj?.blocks) ? obj.blocks : [];
    const blocks = new Set<string>();
    for (const k of blocksArr) if (typeof k === "string") blocks.add(k);
    if (blocks.size === 0) blocks.add(keyOf({ x: 0, y: 0, z: 0 }));
    return {
      blocks,
      color: typeof obj?.color === "string" ? obj.color : color,
      edges: typeof obj?.edges === "boolean" ? obj.edges : edges,
      version: typeof obj?.version === "number" ? obj.version : version,
      kind: typeof obj?.kind === "string" ? obj.kind : kind,
    };
  }

  // find '[' after "blocks":
  let i = idx + PAT_BLOCKS.length;
  i = findByte(body, 0x3a, i, body.length);
  if (i < 0) throw new Error("qbu_blocks_colon_not_found");
  i++;
  i = skipWs(body, i, body.length);
  i = findByte(body, 0x5b, i, body.length); // '['
  if (i < 0) throw new Error("qbu_blocks_array_not_found");
  i++; // after '['

  const blocks = new Set<string>();
  const total = opts.expectedBlocks && opts.expectedBlocks > 0 ? opts.expectedBlocks : 0;

  const CHUNK = 20000;
  let count = 0;
  let lastUi = 0;

  const end = body.length;

  while (i < end) {
    // skip ws and commas
    while (i < end) {
      const c = body[i];
      if (c === 0x2c || c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) {
        i++;
        continue;
      }
      break;
    }
    if (i >= end) break;

    if (body[i] === 0x5d) {
      // ']'
      break;
    }

    if (body[i] !== 0x22) {
      // not a string start, skip
      i++;
      continue;
    }
    i++; // skip '"'

    // parse "x,y,z" inside the string (no spaces)
    const rx = readSignedInt(body, i, end);
    const x = rx.value;
    i = rx.next;
    if (body[i] === 0x2c) i++; // ','
    const ry = readSignedInt(body, i, end);
    const y = ry.value;
    i = ry.next;
    if (body[i] === 0x2c) i++;
    const rz = readSignedInt(body, i, end);
    const z = rz.value;
    i = rz.next;

    // skip until closing quote
    i = findByte(body, 0x22, i, end);
    if (i < 0) break;
    i++; // after closing quote

    blocks.add(`${x},${y},${z}`);
    count++;

    if (count % CHUNK === 0) {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (opts.onStatus && now - lastUi > 80) {
        lastUi = now;
        if (total > 0) {
          const p = Math.min(1, count / total);
          const pct = Math.max(0, Math.min(100, p * 100));
          const pctText = pct < 1 ? pct.toFixed(2) : pct < 10 ? pct.toFixed(1) : String(Math.floor(pct));
          opts.onStatus(`QBUを解析しています... ${pctText}% (${count.toLocaleString()}/${total.toLocaleString()})`);
        } else {
          opts.onStatus(`QBUを解析しています... ${count.toLocaleString()} blocks`);
        }
      }
      await nextTick();
    }
  }

  if (blocks.size === 0) blocks.add(keyOf({ x: 0, y: 0, z: 0 }));

  // final status
  if (opts.onStatus) {
    if (total > 0) {
      opts.onStatus(`QBUを解析しています... 100% (${Math.min(count, total).toLocaleString()}/${total.toLocaleString()})`);
    } else {
      opts.onStatus(`QBUを解析しています... ${count.toLocaleString()} blocks`);
    }
  }

  return { blocks, color, edges, version, kind };
}

async function parseQbuBodyToProjectFast(
  body: Uint8Array,
  opts: { expectedBlocks?: number; onStatus?: (s: string) => void }
): Promise<FastParsedProject> {
  // Binary body marker (future): "QBP1"
  if (
    body.length >= 4 &&
    body[0] === PAT_QBP1[0] &&
    body[1] === PAT_QBP1[1] &&
    body[2] === PAT_QBP1[2] &&
    body[3] === PAT_QBP1[3]
  ) {
    return await parseBinaryProjectBody(body, opts);
  }

  return await parseJsonProjectBody(body, opts);
}


type ProjectDataV1 = {
  version: 1;
  blocks: string[];
};

type ProjectDataV2 = {
  version: 2;
  blocks: string[];
  color?: string;
  edges?: boolean;
};

type ProjectDataV3 = {
  version: 3;
  blocks: string[];
  // v3 には connector 等が入っている可能性があるが、ここでは無視する
  color?: string;
  edges?: boolean;
};

// v1.0.15+: print-order / print-draft JSON can be saved/downloaded as well.
// This format is also used for admin-side model_data snapshots.
type ProjectDataV4 = {
  version: 4;
  kind?: string;
  blocks: string[];
  supportBlocks?: string[];
  scaleSetting?: PrintScaleSetting;
  // optional UI state
  color?: string;
  edges?: boolean;
  // convenience fields (order snapshots)
  mmPerUnit?: number;
  maxSideMm?: number;
  mode?: string;
};

type ProjectData = ProjectDataV1 | ProjectDataV2 | ProjectDataV3 | ProjectDataV4;

function parseScaleSettingFromAny(obj: any): PrintScaleSetting | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const mode = (obj as any).mode;
  if (mode === "maxSide") {
    const mm = Number((obj as any).maxSideMm);
    if (Number.isFinite(mm) && mm > 0) return { mode: "maxSide", maxSideMm: mm };
  }
  if (mode === "blockEdge") {
    const mm = Number((obj as any).blockEdgeMm);
    if (Number.isFinite(mm) && mm > 0) return { mode: "blockEdge", blockEdgeMm: mm };
  }
  return undefined;
}

function parseProjectJSON(text: string): ProjectData | null {
  try {
    const obj = JSON.parse(text);
    if (!obj || typeof obj !== "object") return null;

    // v1-v4 (project file)
    if ((obj as any).version === 1 || (obj as any).version === 2 || (obj as any).version === 3 || (obj as any).version === 4) {
      if (!Array.isArray((obj as any).blocks)) return null;
      const blocks = (obj as any).blocks as string[];

      if ((obj as any).version === 1) return { version: 1, blocks };

      const color = typeof (obj as any).color === "string" ? (obj as any).color : undefined;
      const edges = typeof (obj as any).edges === "boolean" ? (obj as any).edges : undefined;

      if ((obj as any).version === 2) return { version: 2, blocks, color, edges };
      if ((obj as any).version === 3) return { version: 3, blocks, color, edges };

      // v4: may include print supports and scale setting
      const supportBlocks = Array.isArray((obj as any).supportBlocks) ? ((obj as any).supportBlocks as string[]) : undefined;
      const scaleSetting = parseScaleSettingFromAny((obj as any).scaleSetting);
      const kind = typeof (obj as any).kind === "string" ? (obj as any).kind : undefined;
      const mmPerUnit = Number.isFinite(Number((obj as any).mmPerUnit)) ? Number((obj as any).mmPerUnit) : undefined;
      const maxSideMm = Number.isFinite(Number((obj as any).maxSideMm)) ? Number((obj as any).maxSideMm) : undefined;
      const mode = typeof (obj as any).mode === "string" ? (obj as any).mode : undefined;
      return { version: 4, kind, blocks, supportBlocks, scaleSetting, color, edges, mmPerUnit, maxSideMm, mode };
    }

    // v1.0.15-δ2: unversioned print-order snapshot JSON (admin download)
    if (Array.isArray((obj as any).blocks)) {
      const blocks = (obj as any).blocks as string[];
      const supportBlocks = Array.isArray((obj as any).supportBlocks) ? ((obj as any).supportBlocks as string[]) : undefined;
      const scaleSetting = parseScaleSettingFromAny((obj as any).scaleSetting) ||
        parseScaleSettingFromAny({ mode: (obj as any).mode, maxSideMm: (obj as any).maxSideMm, blockEdgeMm: (obj as any).blockEdgeMm });
      const kind = typeof (obj as any).kind === "string" ? (obj as any).kind : "print_order";
      const mmPerUnit = Number.isFinite(Number((obj as any).mmPerUnit)) ? Number((obj as any).mmPerUnit) : undefined;
      const maxSideMm = Number.isFinite(Number((obj as any).maxSideMm)) ? Number((obj as any).maxSideMm) : undefined;
      const mode = typeof (obj as any).mode === "string" ? (obj as any).mode : undefined;
      return { version: 4, kind, blocks, supportBlocks, scaleSetting, mmPerUnit, maxSideMm, mode };
    }

    return null;
  } catch {
    return null;
  }
}

function normalizeProjectObject(obj: any): ProjectData | null {
  try {
    if (!obj || typeof obj !== "object") return null;

    // v1-v4 (project file)
    if ((obj as any).version === 1 || (obj as any).version === 2 || (obj as any).version === 3 || (obj as any).version === 4) {
      if (!Array.isArray((obj as any).blocks)) return null;
      const blocks = (obj as any).blocks as string[];

      if ((obj as any).version === 1) return { version: 1, blocks };

      const color = typeof (obj as any).color === "string" ? (obj as any).color : undefined;
      const edges = typeof (obj as any).edges === "boolean" ? (obj as any).edges : undefined;

      if ((obj as any).version === 2) return { version: 2, blocks, color, edges };
      if ((obj as any).version === 3) return { version: 3, blocks, color, edges };

      // v4: may include print supports and scale setting
      const supportBlocks = Array.isArray((obj as any).supportBlocks) ? ((obj as any).supportBlocks as string[]) : undefined;
      const scaleSetting = parseScaleSettingFromAny((obj as any).scaleSetting);
      const kind = typeof (obj as any).kind === "string" ? (obj as any).kind : undefined;
      const mmPerUnit = Number.isFinite(Number((obj as any).mmPerUnit)) ? Number((obj as any).mmPerUnit) : undefined;
      const maxSideMm = Number.isFinite(Number((obj as any).maxSideMm)) ? Number((obj as any).maxSideMm) : undefined;
      const mode = typeof (obj as any).mode === "string" ? (obj as any).mode : undefined;
      return { version: 4, kind, blocks, supportBlocks, scaleSetting, color, edges, mmPerUnit, maxSideMm, mode };
    }

    // v1.0.15-δ2: unversioned print-order snapshot JSON (admin download)
    if (Array.isArray((obj as any).blocks)) {
      const blocks = (obj as any).blocks as string[];
      const supportBlocks = Array.isArray((obj as any).supportBlocks) ? ((obj as any).supportBlocks as string[]) : undefined;
      const scaleSetting =
        parseScaleSettingFromAny((obj as any).scaleSetting) ||
        parseScaleSettingFromAny({
          mode: (obj as any).mode,
          maxSideMm: (obj as any).maxSideMm,
          blockEdgeMm: (obj as any).blockEdgeMm,
        });
      const kind = typeof (obj as any).kind === "string" ? (obj as any).kind : "print_order";
      const mmPerUnit = Number.isFinite(Number((obj as any).mmPerUnit)) ? Number((obj as any).mmPerUnit) : undefined;
      const maxSideMm = Number.isFinite(Number((obj as any).maxSideMm)) ? Number((obj as any).maxSideMm) : undefined;
      const mode = typeof (obj as any).mode === "string" ? (obj as any).mode : undefined;
      return { version: 4, kind, blocks, supportBlocks, scaleSetting, mmPerUnit, maxSideMm, mode };
    }

    return null;
  } catch {
    return null;
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function uuid(): string {
  try {
    const c: any = (globalThis as any).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    // ignore
  }
  return "id-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
}

// 軽量・同期の安定ハッシュ（暗号学的強度は不要：分析用途）
const MASK64 = 0xffffffffffffffffn;

// Stable 64-bit FNV-1a
function fnv1a64(input: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & MASK64;
  }
  return hash;
}

/**
 * ギャラリー用の軽量フィンガープリント
 * - ブロック数が多くても固まらないよう O(n)（ソートなし）
 * - 順序に依存しないよう XOR と SUM を併用（簡易）
 */
function computeModelFingerprint(baseKeys: Iterable<string>, supportKeys: Iterable<SubKey>): string {
  let xor = 0n;
  let sum = 0n;
  let countB = 0n;

  for (const k of baseKeys) {
    const h = fnv1a64(k);
    xor ^= h;
    sum = (sum + h) & MASK64;
    countB++;
  }

  let countS = 0n;
  for (const k of supportKeys) {
    const h = fnv1a64(String(k));
    xor ^= h;
    sum = (sum + h) & MASK64;
    countS++;
  }

  const mixed = (xor ^ ((sum << 1n) & MASK64) ^ (countB & MASK64) ^ ((countS << 32n) & MASK64)) & MASK64;
  const hex = mixed.toString(16).padStart(16, "0");
  return `m2_${hex}_${countB.toString()}_${countS.toString()}`;
}

export default function Builder() {
  const { track, trackNow } = useTelemetry();
  const { user, supabase } = useAuth();

  const requireLogin = (message: string) => {
    // AccountFab を開く
    try {
      window.dispatchEvent(new CustomEvent("qbu:open-login", { detail: { message } }));
    } catch {
      // ignore
    }
  };

  // 少なくとも1個は置いておく（操作の入口）
  const [blocks, setBlocks] = useState<Set<string>>(() => new Set([keyOf({ x: 0, y: 0, z: 0 })]));
  const bbox = useMemo(() => computeBBox(blocks), [blocks]);

  // 左：プレビュー（閉じられる）
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDir, setPreviewDir] = useState<ViewDir>("front");

  // 見た目（単色）
  const [cubeColor, setCubeColor] = useState<string>(DEFAULT_CUBE_COLOR);
  const [showEdges, setShowEdges] = useState<boolean>(true);

  // 3面図（参照画像）
  const [refImages, setRefImages] = useState<RefImages>({});
  const [refSettings, setRefSettings] = useState(DEFAULT_REF_SETTINGS);
  const hasRefs = Boolean(refImages.front || refImages.side || refImages.top);

  // 編集カメラ（最初は右上から）
  const [yawIndex, setYawIndex] = useState(1); // 45°
  const [pitchIndex, setPitchIndex] = useState(1); // +45°

  // 分析用：エディタ表示
  useEffect(() => {
    track("builder_open", { logged_in: Boolean(user) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 初回：保存済みがあれば復元（ドラフト優先）
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY) || localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = parseProjectJSON(raw);
      if (!parsed) return;

      const next = new Set<string>();
      for (const k of parsed.blocks) next.add(k);
      if (next.size === 0) next.add(keyOf({ x: 0, y: 0, z: 0 }));
      setBlocks(next);

      // v2+：色・エッジ
      if (parsed.version >= 2) {
        if (typeof (parsed as any).color === "string") setCubeColor((parsed as any).color);
        if (typeof (parsed as any).edges === "boolean") setShowEdges((parsed as any).edges);
      }
    } catch {
      // ignore
    }
  }, []);

  // 編集中の状態は自動でドラフト保存（ログインでリロードされても消えない）
  useEffect(() => {
    const t = window.setTimeout(() => {
      const data: any = {
        version: 2,
        blocks: Array.from(blocks),
        color: cubeColor,
        edges: showEdges,
        updated_at: Date.now(),
      };
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
      } catch {
        // ignore
      }
    }, 320);
    return () => window.clearTimeout(t);
  }, [blocks, cubeColor, showEdges]);

  const clearAll = () => {
    track("project_reset", { before: blocks.size });
    setBlocks(new Set([keyOf({ x: 0, y: 0, z: 0 })]));

    // 重要: リセット後は「新しいプロジェクト」として扱う。
    // 既存モデル編集中のままだと誤って上書き保存してしまうため、紐づけを解除する。
    setCurrentModelId(null);
    setCurrentModelName(null);
  };

  const [saveOpen, setSaveOpen] = useState(false);

  const [saveBusy, setSaveBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);


const [loadBusy, setLoadBusy] = useState(false);
const [loadStatus, setLoadStatus] = useState<string | null>(null);
const [toast, setToast] = useState<string | null>(null);

// toast auto-hide
useEffect(() => {
  if (!toast) return;
  const t = window.setTimeout(() => setToast(null), 2400);
  return () => window.clearTimeout(t);
}, [toast]);

  // MyQ-BUModels (cloud gallery)
  const [modelsOpen, setModelsOpen] = useState(false);
  const [currentModelId, setCurrentModelId] = useState<string | null>(null);
  const [currentModelName, setCurrentModelName] = useState<string | null>(null);

  // 印刷用補完
  const [prepOpen, setPrepOpen] = useState(false);
  const [prepName, setPrepName] = useState("Q-BU");
  const [prepScaleSetting, setPrepScaleSetting] = useState<PrintScaleSetting>({
    mode: "maxSide",
    maxSideMm: DEFAULT_TARGET_MM,
  });

  // ログイン後に“保存画面を自動で開く”ための復元
  useEffect(() => {
    if (!user) return;
    try {
      const pending = sessionStorage.getItem(PENDING_SAVE_KEY);
      if (pending === "1") {
        sessionStorage.removeItem(PENDING_SAVE_KEY);
        setSaveOpen(true);
        track("save_modal_open_after_login");
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const openSaveFlow = () => {
    setSaveStatus(null);
    setSaveError(null);
    track("save_button_click", { logged_in: Boolean(user) });
    if (!user) {
      try {
        sessionStorage.setItem(PENDING_SAVE_KEY, "1");
      } catch {
        // ignore
      }
      requireLogin("保存するにはログインが必要です。（ログイン後に保存画面が開きます）");
      return;
    }
    setSaveOpen(true);
    track("save_modal_open");
  };

  const openModelsFlow = () => {
    track("my_models_open_click", { logged_in: Boolean(user) });
    if (!user) {
      requireLogin("MyQ-BUModels を開くにはログインが必要です。");
      return;
    }
    if (!supabase) {
      window.alert("クラウド保存が未設定です（Supabase環境変数を確認してください）。");
      return;
    }
    setModelsOpen(true);
    track("my_models_open");
  };

  const saveProject = async (
    baseName: string,
    opts?: {
      downloadLocal?: boolean;
      asNew?: boolean;
    }
  ): Promise<boolean> => {
    if (!user) {
      requireLogin("保存するにはログインが必要です。");
      return false;
    }
    if (!supabase) {
      setSaveError("クラウド保存が未設定です（NEXT_PUBLIC_SUPABASE_* を確認してください）。");
      return false;
    }

    setSaveBusy(true);
    setSaveError(null);
    setSaveStatus("保存内容をまとめています...");
    await nextTick();

    try {
      track("project_save", {
        blocks: blocks.size,
        max_dim: bbox.maxDim,
        color: cubeColor,
        edges: showEdges,
        has_current_model: Boolean(currentModelId),
        as_new: Boolean(opts?.asNew),
        download_local: Boolean(opts?.downloadLocal),
      });

      setSaveStatus("ブロックを集計しています...");
      await nextTick();
      const base = Array.from(blocks);

      // Local restore snapshot (同じ端末では復元できる)
      // 大きいモデルで localStorage JSON を作ると固まりやすいため、一定数以上はスキップします。
      const MAX_LOCAL_BACKUP_BLOCKS = 20000;
      if (base.length <= MAX_LOCAL_BACKUP_BLOCKS) {
        const restoreData: ProjectDataV2 = {
          version: 2,
          blocks: base,
          color: cubeColor,
          edges: showEdges,
        };
        window.setTimeout(() => {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(restoreData));
          } catch {
            // ignore
          }
          try {
            localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...restoreData, updated_at: Date.now() }));
          } catch {
            // ignore
          }
        }, 0);
      }

      // Cloud payload (.qbu)
      const payload: ProjectDataV4 = {
        version: 4,
        kind: "project",
        blocks: base,
        color: cubeColor,
        edges: showEdges,
      };

      // 1) Encode (.qbu)
      // v1.0.16 以降はパスワード付き書き出しを廃止し、常に非暗号化でパッケージ化します。
      // 大きいモデルではパッケージ化に時間がかかるため、進捗（% と 件数）を表示します。
      const totalBlocks = base.length;
      setSaveStatus(`パッケージ化しています... 0% (0/${totalBlocks.toLocaleString()})`);
      await nextTick();

      let lastUiUpdate = 0;
      const bytesCloud = await encodeQbu(payload, {
        password: "", // keep explicit: old API compatibility
        compress: true,
        onProgress: (p) => {
          const now = typeof performance !== "undefined" ? performance.now() : Date.now();
          // UI更新は間引く（頻繁すぎると逆に遅くなる）
          if (now - lastUiUpdate < 150) return;
          lastUiUpdate = now;

          const pct = Math.max(0, Math.min(100, p * 100));
          const pctText = pct < 1 ? pct.toFixed(2) : pct < 10 ? pct.toFixed(1) : String(Math.floor(pct));
          const done = Math.max(0, Math.min(totalBlocks, Math.floor(p * totalBlocks)));

          setSaveStatus(`パッケージ化しています... ${pctText}% (${done.toLocaleString()}/${totalBlocks.toLocaleString()})`);
        },
      });


      setSaveStatus("データを変換しています...");
      await nextTick();
      const qbu_base64 = await bytesToBase64Async(bytesCloud);

      setSaveStatus("サムネイルを生成しています...");
      await nextTick();
      const thumbBlocks = sampleSetForThumb(blocks, 12000);
      const thumb_data_url = generateThumbDataUrl(thumbBlocks, cubeColor, { size: 160 });

      setSaveStatus("モデル情報を計算しています...");
      await nextTick();
      const model_fingerprint = computeModelFingerprint(base, []);

      const nowIso = new Date().toISOString();

      // 2) Cloud save
      setSaveStatus("クラウドへ保存しています...");

      const doUpdate = Boolean(currentModelId) && !opts?.asNew;
      let savedId: string | null = null;

      if (doUpdate && currentModelId) {
        const res = await supabase
          .from("user_models")
          .update({
            name: baseName,
            qbu_base64,
            thumb_data_url,
            model_fingerprint,
            block_count: base.length,
            support_block_count: 0,
            updated_at: nowIso,
          })
          .eq("id", currentModelId);
        if (res.error) throw res.error;
        savedId = currentModelId;
      } else {
        const res = await supabase
          .from("user_models")
          .insert({
            user_id: user.id,
            name: baseName,
            qbu_base64,
            thumb_data_url,
            model_fingerprint,
            block_count: base.length,
            support_block_count: 0,
            updated_at: nowIso,
          })
          .select("id")
          .single();
        if (res.error) throw res.error;
        savedId = (res.data as any)?.id || null;
      }

      if (savedId) {
        setCurrentModelId(savedId);
        setCurrentModelName(baseName);
      }

      track("my_models_save", {
        op: doUpdate ? "update" : "insert",
        id: savedId,
        blocks: base.length,
      });

      // 3) Optional local download (after cloud save)
      if (opts?.downloadLocal) {
        setSaveStatus("ローカルへ書き出しています...");
        await nextTick();
        // ローカル書き出しは常に非暗号化（パスワード指定は廃止）
        downloadBlob(new Blob([bytesCloud as any], { type: "application/octet-stream" }), `${baseName}.qbu`);
        track("project_save_download", { kind: "qbu" });
      }

      setSaveStatus("保存しました");
      return true;
    } catch (e: any) {
      console.error(e);
      const msg = e?.message || String(e);
      setSaveError(msg);
      setSaveStatus(null);
      return false;
    } finally {
      setSaveBusy(false);
    }
  };




const MAX_LOCAL_BACKUP_BLOCKS = 20000;

const showToast = (msg: string) => {
  setToast(msg);
  try {
    // eslint-disable-next-line no-console
    console.info("[QBU]", msg);
  } catch {
    // ignore
  }
};

const buildBlocksSetChunked = async (arr: string[]) => {
  const total = Math.max(0, arr?.length || 0);
  const next = new Set<string>();
  if (total === 0) {
    next.add(keyOf({ x: 0, y: 0, z: 0 }));
    return next;
  }

  const CHUNK = 5000;
  let lastUiUpdate = 0;

  for (let i = 0; i < total; i++) {
    const k = arr[i];
    if (typeof k === "string") next.add(k);

    if ((i + 1) % CHUNK === 0 || i === total - 1) {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - lastUiUpdate > 80) {
        lastUiUpdate = now;
        const p = (i + 1) / total;
        const pct = Math.max(0, Math.min(100, p * 100));
        const pctText = pct < 1 ? pct.toFixed(2) : pct < 10 ? pct.toFixed(1) : String(Math.floor(pct));
        setLoadStatus(`ブロックを展開しています... ${pctText}% (${(i + 1).toLocaleString()}/${total.toLocaleString()})`);
      }
      await nextTick();
    }
  }

  if (next.size === 0) next.add(keyOf({ x: 0, y: 0, z: 0 }));
  return next;
};

const applyLoadedProject = async (data: ProjectData, opts: { name: string | null; modelId: string | null }) => {
  setLoadBusy(true);
  setLoadStatus("読み込み中...");

  try {
    const next = await buildBlocksSetChunked(data.blocks || []);
    setBlocks(next);

    const loadedColor = typeof (data as any).color === "string" ? (data as any).color : cubeColor;
    const loadedEdges = typeof (data as any).edges === "boolean" ? (data as any).edges : showEdges;
    setCubeColor(loadedColor);
    setShowEdges(loadedEdges);

    setCurrentModelId(opts.modelId);
    setCurrentModelName(opts.name);

    // Local restore snapshot (avoid huge synchronous JSON.stringify)
    const baseArr = Array.from(next);
    if (baseArr.length <= MAX_LOCAL_BACKUP_BLOCKS) {
      const restoreData: ProjectDataV2 = {
        version: 2,
        blocks: baseArr,
        color: loadedColor,
        edges: loadedEdges,
      };
      window.setTimeout(() => {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(restoreData));
        } catch {
          // ignore
        }
        try {
          localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...restoreData, updated_at: Date.now() }));
        } catch {
          // ignore
        }
      }, 0);
    }
  } finally {
    setLoadBusy(false);
    setLoadStatus(null);
  }
};

const openModelFromGallery = async (id: string) => {
  if (!user) {
    requireLogin("MyQ-BUModels を開くにはログインが必要です。");
    return;
  }
  if (!supabase) {
    window.alert("クラウド保存が未設定です（Supabase環境変数を確認してください）。");
    return;
  }

  track("my_models_open_select", { id });

  setLoadBusy(true);
  setLoadStatus("クラウドから取得しています...");

  try {
    const res = await supabase
      .from("user_models")
      .select("id,name,qbu_base64,block_count")
      .eq("id", id)
      .single();
    if (res.error || !res.data) {
      window.alert(`読み込みに失敗しました: ${res.error?.message || "not_found"}`);
      return;
    }

    const row = res.data as any;
    const name = typeof row?.name === "string" ? row.name : "Q-BU";
    const b64 = typeof row?.qbu_base64 === "string" ? row.qbu_base64 : "";
    const expectedBlocks = typeof row?.block_count === "number" ? row.block_count : undefined;

    if (!b64) {
      window.alert("モデルデータが空です。");
      return;
    }

    // base64 decode can be heavy for large projects; decode in chunks and show progress.
    setLoadStatus("base64をデコードしています... 0%");
    await nextTick();

    const bytes = await base64ToBytesChunkedAsync(b64, (p) => {
      const pct = Math.max(0, Math.min(100, p * 100));
      const pctText = pct < 1 ? pct.toFixed(2) : pct < 10 ? pct.toFixed(1) : String(Math.floor(pct));
      setLoadStatus(`base64をデコードしています... ${pctText}%`);
    });

    setLoadStatus("QBUを展開しています...");
    await nextTick();

    // Try without password; if it fails, ask once.
    let unpacked = await unpackQbu(bytes, { password: "" });
    if (!unpacked.ok) {
      const pw = window.prompt("（旧形式のQBUのみ）パスワードを入力してください\n※ v1.0.16以降の新規保存はパスワード無しです") || "";
      unpacked = await unpackQbu(bytes, { password: pw });
    }
    if (!unpacked.ok) {
      window.alert(`QBUの展開に失敗しました: ${unpacked.error}`);
      return;
    }

    setLoadStatus("QBUを解析しています... 0%");
    await nextTick();

    const parsed = await parseQbuBodyToProjectFast(unpacked.body, {
      expectedBlocks,
      onStatus: (s) => setLoadStatus(s),
    });

    setLoadStatus("表示を更新しています...");
    await nextTick();

    const nextSet = parsed.blocks;
    setBlocks(nextSet);

    const loadedColor = typeof parsed.color === "string" ? parsed.color : cubeColor;
    const loadedEdges = typeof parsed.edges === "boolean" ? parsed.edges : showEdges;
    setCubeColor(loadedColor);
    setShowEdges(loadedEdges);

    setCurrentModelId(id);
    setCurrentModelName(name);

    // Local restore snapshot (avoid huge synchronous JSON.stringify)
    if (nextSet.size <= MAX_LOCAL_BACKUP_BLOCKS) {
      const baseArr = Array.from(nextSet);
      const restoreData: ProjectDataV2 = {
        version: 2,
        blocks: baseArr,
        color: loadedColor,
        edges: loadedEdges,
      };
      window.setTimeout(() => {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(restoreData));
        } catch {
          // ignore
        }
        try {
          localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...restoreData, updated_at: Date.now() }));
        } catch {
          // ignore
        }
      }, 0);
    }

    track("my_models_open_loaded", {
      id,
      blocks: nextSet.size,
      qbu_encrypted: unpacked.encrypted,
      qbu_compressed: unpacked.compressed,
    });
    showToast(`読み込みました: ${name}`);
  } catch (e: any) {
    console.error(e);
    window.alert(`読み込みに失敗しました: ${e?.message || e}`);
  } finally {
    setLoadBusy(false);
    setLoadStatus(null);
  }
};


  const exportStlFromBlocks = (
    baseName: string,
    scaleSetting: PrintScaleSetting,
    baseKeys: Set<string>,
    supportKeys: Set<SubKey>,
    exportKind: "direct" | "print_prep" = "direct"
  ) => {
    if (!user) {
      requireLogin("保存するにはログインが必要です。");
      return;
    }

    const bboxNow = computeMixedBBox(baseKeys, supportKeys);
    const resolved = resolvePrintScale({
      bboxMaxDimWorld: bboxNow.maxDim,
      setting: scaleSetting,
      clampMaxSideMm: { min: 10, max: 300 },
      clampBlockEdgeMm: { min: 0.1, max: 500 },
    });

    // 出力用の group（参照画像なし）
    const outRoot = new THREE.Group();

    // 中心を原点へ（mixed bbox）
    outRoot.position.set(-bboxNow.center.x, -bboxNow.center.y, -bboxNow.center.z);

    // STLの単位=mmとして出力するため、world unit を mmPerUnit 倍する
    const s = resolved.mmPerUnit;
    outRoot.scale.set(s, s, s);

    const export_id = uuid();
    const model_fingerprint = computeModelFingerprint(baseKeys, supportKeys);

    // 重要イベント：取りこぼし防止のため即flush
    trackNow("stl_export", {
      export_id,
      export_kind: exportKind,
      model_fingerprint,
      block_count: baseKeys.size,
      support_block_count: supportKeys.size,
      bbox_max_dim_world: bboxNow.maxDim,
      scale_mode: resolved.mode,
      max_side_mm: resolved.maxSideMm,
      mm_per_unit: resolved.mmPerUnit,
      warn_too_large: Boolean(resolved.warnTooLarge),
      name: baseName,
    });

    const outCubes = new THREE.Group();
    outRoot.add(outCubes);

    const geoBase = new THREE.BoxGeometry(1, 1, 1);
    const geoSupport = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color("#ffffff") });

    // base cubes
    for (const k of baseKeys) {
      const c = parseKey(k);
      const mesh = new THREE.Mesh(geoBase, mat);
      mesh.position.set(c.x, c.y, c.z);
      outCubes.add(mesh);
    }

    // half-size support cubes
    for (const sk of supportKeys) {
      const c = subMinToWorldCenter(parseSubKey(sk));
      const mesh = new THREE.Mesh(geoSupport, mat);
      mesh.position.set(c.x, c.y, c.z);
      outCubes.add(mesh);
    }

    outRoot.updateMatrixWorld(true);

    const exporter = new STLExporter();
    const stl = exporter.parse(outRoot, { binary: true }) as ArrayBuffer;

    track("project_save_download", { kind: "stl", max_side_mm: resolved.maxSideMm, mode: resolved.mode });
    downloadBlob(new Blob([stl], { type: "model/stl" }), `${baseName}.stl`);

    geoBase.dispose();
    geoSupport.dispose();
    mat.dispose();
  };

  const exportStlDirect = (baseName: string, scaleSetting: PrintScaleSetting) => {
    if (!user) {
      requireLogin("保存するにはログインが必要です。");
      return;
    }

    const parts = countComponents(blocks);
    if (parts > 1) {
      const ok = window.confirm(
        `モデルが複数のパーツに分かれています（${parts}個）。\n` +
          `通常のSTLだと、印刷時にバラバラになる可能性があります。\n\n` +
          `続行しますか？（おすすめ:「印刷用にSTLを書き出す」）`
      );
      if (!ok) return;
    }

    exportStlFromBlocks(baseName, scaleSetting, blocks, new Set(), "direct");
  };

  const handleImportThreeView = async (file: File) => {
    try {
      const dataUrl = await readFileAsDataURL(file);
      const parts = await splitThreeViewSheet(dataUrl, "auto");
      setRefImages(parts);

      const ext = file.name.includes(".") ? file.name.split(".").pop()?.slice(0, 12) : "";
      track("ref_import", {
        ext,
        size: file.size,
        type: file.type,
      });

      // パラメータは自動（ユーザーは迷わない）
      const autoSize = Math.max(12, Math.round(bbox.maxDim + 8));
      setRefSettings((p) => ({
        ...p,
        enabled: true,
        showInPreview: true,
        opacity: 0.35,
        size: autoSize,
        margin: 1.5,
      }));
    } catch (e) {
      console.error(e);
      alert("画像の読み込みに失敗しました。");
    }
  };

  const clearRefs = () => {
    track("ref_clear");
    setRefImages({});
    setRefSettings((p) => ({ ...p, enabled: false }));
  };

  // モデルの大きさが変わったら、3面図のサイズだけ自動追従
  useEffect(() => {
    if (!hasRefs || !refSettings.enabled) return;
    const autoSize = Math.max(12, Math.round(bbox.maxDim + 8));
    setRefSettings((p) => {
      if (p.size === autoSize && p.margin === 1.5) return p;
      return { ...p, size: autoSize, margin: 1.5 };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bbox.maxDim, hasRefs]);

const handleDroppedFile = async (file: File) => {
  // 画像 → 3面図
  if (file.type.startsWith("image/")) {
    await handleImportThreeView(file);
    return;
  }

  // QBU packaged file (.qbu)
    // QBU packaged file (.qbu)
  if (file.name.toLowerCase().endsWith(".qbu")) {
    setLoadBusy(true);
    setLoadStatus("QBUを読み込んでいます...");

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());

      setLoadStatus("QBUを展開しています...");
      await nextTick();

      // Try without password first; if it fails, ask once.
      let unpacked = await unpackQbu(bytes, { password: "" });
      if (!unpacked.ok) {
        let password = "";
        try {
          password = window.prompt("（旧形式のQBUのみ）パスワードを入力してください\n※ v1.0.16以降の新規保存はパスワード無しです") || "";
        } catch {
          // ignore
        }
        unpacked = await unpackQbu(bytes, { password });
      }

      if (!unpacked.ok) {
        window.alert(`QBUの読み込みに失敗しました: ${unpacked.error}`);
        return;
      }

      setLoadStatus("QBUを解析しています... 0%");
      await nextTick();

      const parsed = await parseQbuBodyToProjectFast(unpacked.body, {
        onStatus: (s) => setLoadStatus(s),
      });

      // ローカル読み込みは「ギャラリーの紐づけ」を解除（誤上書き防止）
      const baseName = file.name.replace(/\.qbu$/i, "").trim() || "Q-BU";
      setCurrentModelId(null);
      setCurrentModelName(baseName);

      track("project_load", {
        ext: "qbu",
        size: file.size,
        version: parsed.version,
        blocks: parsed.blocks.size,
        qbu_encrypted: unpacked.encrypted,
        qbu_compressed: unpacked.compressed,
      });

      setLoadStatus("表示を更新しています...");
      await nextTick();

      const nextSet = parsed.blocks;
      setBlocks(nextSet);

      const loadedColor = typeof parsed.color === "string" ? parsed.color : cubeColor;
      const loadedEdges = typeof parsed.edges === "boolean" ? parsed.edges : showEdges;
      setCubeColor(loadedColor);
      setShowEdges(loadedEdges);

      // Local restore snapshot (avoid huge synchronous JSON.stringify)
      if (nextSet.size <= MAX_LOCAL_BACKUP_BLOCKS) {
        const baseArr = Array.from(nextSet);
        const restoreData: ProjectDataV2 = {
          version: 2,
          blocks: baseArr,
          color: loadedColor,
          edges: loadedEdges,
        };
        window.setTimeout(() => {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(restoreData));
          } catch {
            // ignore
          }
          try {
            localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...restoreData, updated_at: Date.now() }));
          } catch {
            // ignore
          }
        }, 0);
      }

      showToast(`読み込みました: ${baseName}`);
    } catch (e: any) {
      console.error(e);
      window.alert(`QBUの読み込みに失敗しました: ${e?.message || e}`);
    } finally {
      setLoadBusy(false);
      setLoadStatus(null);
    }
    return;
  }
// JSON → プロジェクト/印刷データ読み込み
  if (file.name.toLowerCase().endsWith(".json")) {
    setLoadBusy(true);
    setLoadStatus("JSONを読み込んでいます...");

    try {
      const text = await file.text();
      const data = parseProjectJSON(text);
      if (!data) {
        window.alert("JSONの解析に失敗しました。（形式が未対応）");
        return;
      }

      // ローカル読み込みは「ギャラリーの紐づけ」を解除（誤上書き防止）
      const baseName = file.name.replace(/\.json$/i, "").trim() || "Q-BU";
      setCurrentModelId(null);
      setCurrentModelName(baseName);

      const ext = file.name.includes(".") ? file.name.split(".").pop()?.slice(0, 12) : "";
      track("project_load", { ext, size: file.size, version: data.version, blocks: data.blocks.length });

      await applyLoadedProject(data, { name: baseName, modelId: null });

      showToast(`読み込みました: ${baseName}`);
    } catch (e: any) {
      console.error(e);
      window.alert(`読み込みに失敗しました: ${e?.message || e}`);
    } finally {
      setLoadBusy(false);
      setLoadStatus(null);
    }
    return;
  }
};

  const requestPrintFlow = (
    baseName: string,
    scaleSetting: PrintScaleSetting,
    baseKeys: Set<string>,
    supportKeys: Set<SubKey>
  ) => {
    // ひとまず“印刷依頼ページへ遷移”できるところまで用意
    // 実決済（GooglePay）は /print 側で Stripe 等の設定が必要
    const bboxNow = computeMixedBBox(baseKeys, supportKeys);
    const resolved = resolvePrintScale({
      bboxMaxDimWorld: bboxNow.maxDim,
      setting: scaleSetting,
      clampMaxSideMm: { min: 10, max: 300 },
      clampBlockEdgeMm: { min: 0.1, max: 500 },
    });

    const finalSetting: PrintScaleSetting =
      resolved.mode === "maxSide"
        ? { mode: "maxSide", maxSideMm: resolved.maxSideMm }
        : { mode: "blockEdge", blockEdgeMm: resolved.mmPerUnit };

    const modelFingerprint = computeModelFingerprint(baseKeys, supportKeys);

    track("print_request_start", {
      model_fingerprint: modelFingerprint,
      block_count: baseKeys.size,
      support_block_count: supportKeys.size,
      max_side_mm: resolved.maxSideMm,
      mm_per_unit: resolved.mmPerUnit,
      scale_mode: resolved.mode,
    });

    try {
      sessionStorage.setItem(
        PRINT_DRAFT_KEY,
        JSON.stringify({
          baseName,
          modelFingerprint,
          // legacy (print/page.tsx v1 expects targetMm)
          targetMm: resolved.maxSideMm,
          // v1.0.14+ (scale toggle)
          scaleSetting: finalSetting,
          // backward compatible field name (print/page.tsx expects `blocks`)
          blocks: Array.from(baseKeys),
          // v1.0.14+ (0.5 supports)
          supportBlocks: Array.from(supportKeys),
          created_at: Date.now(),
        })
      );
    } catch {
      // ignore
    }

    window.location.href = "/print";
  };
  const cubeCount = blocks.size;

  return (
    <div className="page">
      <header className="topHeader minimal">
        <div className="title">Q-BU!{currentModelName ? <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 900, opacity: 0.75 }}>（編集中: {currentModelName}）</span> : null}</div>
        <div className="headerRight">
          <button type="button" className="hbtn" onClick={openModelsFlow}>
            MyQ-BUModels
          </button>
          <button type="button" className="hbtn" onClick={openSaveFlow}>
            保存する
          </button>
        </div>
      </header>

      <main className="main">
        <div className={`workspace ${previewOpen ? "" : "previewClosed"}`}>
          {previewOpen && (
            <div className="previewPane">
              <VoxelPreview
                blocks={blocks}
                bbox={bbox}
                dir={previewDir}
                onDirChange={(d) => {
                  setPreviewDir(d);
                  track("preview_dir", { dir: d });
                }}
                onClose={() => {
                  setPreviewOpen(false);
                  track("preview_close");
                }}
                cubeColor={cubeColor}
                showEdges={showEdges}
                onImportThreeView={handleImportThreeView}
                hasRefs={hasRefs}
                onClearRefs={clearRefs}
                refImages={refImages}
                refSettings={refSettings}
                onFileDrop={handleDroppedFile}
              />
            </div>
          )}

          <div className="editorPane">
            <VoxelEditor
              blocks={blocks}
              setBlocks={setBlocks}
              yawIndex={yawIndex}
              pitchIndex={pitchIndex}
              setYawIndex={setYawIndex}
              setPitchIndex={setPitchIndex}
              previewOpen={previewOpen}
              onOpenPreview={() => {
                setPreviewOpen(true);
                track("preview_open");
              }}
              cubeCount={cubeCount}
              onClearAll={clearAll}
              cubeColor={cubeColor}
              setCubeColor={setCubeColor}
              showEdges={showEdges}
              setShowEdges={setShowEdges}
              refImages={refImages}
              refSettings={refSettings}
              onFileDrop={handleDroppedFile}
            />
          </div>
        </div>
      </main>

      <MyModelsModal
        open={modelsOpen}
        onClose={() => {
          setModelsOpen(false);
          track("my_models_close");
        }}
        supabase={supabase}
        currentModelId={currentModelId}
        onDeletedCurrent={() => {
          setCurrentModelId(null);
          setCurrentModelName(null);
        }}
        onOpenModel={async (id) => {
          setModelsOpen(false);
          track("my_models_close_after_open");
          await openModelFromGallery(id);
        }}
      />

      <SaveModal
        open={saveOpen}
        onClose={() => {
          if (saveBusy) return;
          setSaveOpen(false);
          track("save_modal_close");
        }}
        maxDim={bbox.maxDim}
        defaultTargetMm={DEFAULT_TARGET_MM}
        initialName={currentModelName || "Q-BU"}
        existingModelId={currentModelId}
        saving={saveBusy}
        statusText={saveStatus}
        errorText={saveError}
        onSaveProject={async (name, opts) => {
          const ok = await saveProject(name, opts);
          if (ok) {
            setSaveOpen(false);
            setModelsOpen(true);
            track("my_models_open_after_save");
          }
        }}
        onExportStl={(name, setting) => {
          exportStlDirect(name, setting);
          setSaveOpen(false);
        }}
        onOpenPrintPrep={(name, setting) => {
          if (!user) {
            requireLogin("保存するにはログインが必要です。");
            return;
          }
          track("print_prep_open", {
            blocks: blocks.size,
            max_dim: bbox.maxDim,
          });
          setPrepName(name);
          setPrepScaleSetting(setting);
          setPrepOpen(true);
          setSaveOpen(false);
        }}
      />

      <PrintPrepModal
        open={prepOpen}
        baseName={prepName}
        scaleSetting={prepScaleSetting}
        baseBlocks={blocks}
        onClose={() => setPrepOpen(false)}
        onExport={(name, setting, baseKeys, supportKeys) => {
          exportStlFromBlocks(name, setting, baseKeys, supportKeys, "print_prep");
          setPrepOpen(false);
        }}
        onRequestPrint={(name, setting, baseKeys, supportKeys) => {
          requestPrintFlow(name, setting, baseKeys, supportKeys);
        }}
      />
{/* Load status / toast (軽量フィードバック) */}
{loadBusy ? (
  <div
    style={{
      position: "fixed",
      left: 12,
      right: 12,
      bottom: 12,
      padding: "10px 12px",
      borderRadius: 12,
      background: "rgba(17,24,39,.92)",
      color: "white",
      fontSize: 13,
      fontWeight: 900,
      zIndex: 9999,
      boxShadow: "0 10px 30px rgba(0,0,0,.20)",
    }}
  >
    {loadStatus || "読み込み中..."}
  </div>
) : null}

{toast ? (
  <div
    style={{
      position: "fixed",
      left: 12,
      right: 12,
      bottom: loadBusy ? 56 : 12,
      padding: "8px 12px",
      borderRadius: 12,
      background: "rgba(16,185,129,.92)",
      color: "white",
      fontSize: 13,
      fontWeight: 900,
      zIndex: 9999,
      boxShadow: "0 10px 30px rgba(0,0,0,.20)",
    }}
  >
    {toast}
  </div>
) : null}

    </div>
  );
}
