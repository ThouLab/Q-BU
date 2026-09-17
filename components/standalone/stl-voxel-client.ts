"use client";

import {
  STL_MAX_FILE_BYTES,
  StlVoxelizationError,
  type StlVoxelizationErrorCode,
  type StlVoxelizationResult
} from "@/components/standalone/stl-voxelizer";

export type { StlVoxelizationResult } from "@/components/standalone/stl-voxelizer";
export { STL_MAX_FILE_BYTES, StlVoxelizationError } from "@/components/standalone/stl-voxelizer";

type WorkerResponse =
  | { type: "result"; result: StlVoxelizationResult }
  | { type: "error"; code: StlVoxelizationErrorCode; message: string };

export async function voxelizeStlFile(file: File): Promise<StlVoxelizationResult> {
  if (file.size === 0) {
    throw new StlVoxelizationError("STL_EMPTY_FILE", "STLファイルが空です。");
  }
  if (file.size > STL_MAX_FILE_BYTES) {
    throw new StlVoxelizationError(
      "STL_FILE_TOO_LARGE",
      `STLファイルが大きすぎます（上限${Math.floor(STL_MAX_FILE_BYTES / 1024 / 1024)}MB）。`
    );
  }

  const buffer = await file.arrayBuffer();
  return new Promise<StlVoxelizationResult>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./stl-voxel.worker.ts", import.meta.url), {
        type: "module",
        name: "qbu-stl-voxelizer"
      });
    } catch {
      reject(new StlVoxelizationError("STL_WORKER_FAILED", "STL変換処理を開始できませんでした。"));
      return;
    }

    const finish = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message?.type === "result") {
        finish();
        resolve(message.result);
        return;
      }
      if (message?.type === "error") {
        finish();
        reject(new StlVoxelizationError(message.code, message.message));
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(
        new StlVoxelizationError(
          "STL_WORKER_FAILED",
          event.message || "STLのボクセル変換に失敗しました。"
        )
      );
    };

    worker.postMessage({ type: "voxelize", buffer }, [buffer]);
  });
}
