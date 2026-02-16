"use client";

import { parseKey } from "./voxelUtils";

/**
 * Uint8Array <-> base64 helpers
 * - Browser では atob/btoa
 * - Node では Buffer
 */
export function bytesToBase64(bytes: Uint8Array): string {
  // Node / edge
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyGlobal = globalThis as any;
  if (typeof anyGlobal.Buffer !== "undefined") {
    return anyGlobal.Buffer.from(bytes).toString("base64");
  }

  // Browser
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bin += String.fromCharCode(...(bytes.subarray(i, i + chunk) as any));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  // Node / edge
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyGlobal = globalThis as any;
  if (typeof anyGlobal.Buffer !== "undefined") {
    return new Uint8Array(anyGlobal.Buffer.from(String(b64 || ""), "base64"));
  }

  // Browser
  const bin = atob(String(b64 || ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function formatDateTimeJa(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  if (!d || !Number.isFinite(d.getTime())) return "";
  // e.g. 2026/02/15 21:03
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

/**
 * 軽量サムネ（トップビュー）
 * - 3Dのレンダリングをしないため高速
 * - ギャラリーの一覧用（見分けがつく程度）
 */
export function generateThumbDataUrl(blocks: Set<string>, cubeColor: string, opts?: { size?: number }): string | null {
  if (typeof document === "undefined") return null;
  const size = Math.max(64, Math.min(512, Math.round(opts?.size || 160)));

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // bg
  ctx.fillStyle = "#f7f8fb";
  ctx.fillRect(0, 0, size, size);

  const coords = Array.from(blocks).map((k) => parseKey(k));
  if (coords.length === 0) return canvas.toDataURL("image/png");

  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const c of coords) {
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minZ = Math.min(minZ, c.z);
    maxZ = Math.max(maxZ, c.z);
  }

  const w = Math.max(1, maxX - minX + 1);
  const h = Math.max(1, maxZ - minZ + 1);
  const pad = Math.round(size * 0.12);
  const scale = Math.min((size - pad * 2) / w, (size - pad * 2) / h);
  const cell = Math.max(1, Math.floor(scale));
  const drawW = w * cell;
  const drawH = h * cell;
  const ox = Math.floor((size - drawW) / 2);
  const oy = Math.floor((size - drawH) / 2);

  // blocks
  ctx.fillStyle = cubeColor || "#111827";
  for (const c of coords) {
    const x = ox + (c.x - minX) * cell;
    const y = oy + (c.z - minZ) * cell;
    ctx.fillRect(x, y, cell, cell);
  }

  // subtle border
  ctx.strokeStyle = "rgba(11,15,24,.14)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);

  return canvas.toDataURL("image/png");
}
