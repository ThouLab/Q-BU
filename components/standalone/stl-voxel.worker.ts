import {
  StlVoxelizationError,
  voxelizeStlArrayBuffer,
  type StlVoxelizationErrorCode,
  type StlVoxelizationResult
} from "@/components/standalone/stl-voxelizer";

type VoxelizeRequest = {
  type: "voxelize";
  buffer: ArrayBuffer;
};

type VoxelizeResponse =
  | { type: "result"; result: StlVoxelizationResult }
  | { type: "error"; code: StlVoxelizationErrorCode; message: string };

type WorkerScope = {
  onmessage: ((event: MessageEvent<VoxelizeRequest>) => void) | null;
  postMessage: (message: VoxelizeResponse, transfer?: Transferable[]) => void;
};

const workerScope = globalThis as unknown as WorkerScope;

workerScope.onmessage = (event) => {
  if (event.data?.type !== "voxelize" || !(event.data.buffer instanceof ArrayBuffer)) {
    workerScope.postMessage({
      type: "error",
      code: "STL_INVALID_FORMAT",
      message: "STL変換リクエストが不正です。"
    });
    return;
  }

  try {
    const result = voxelizeStlArrayBuffer(event.data.buffer);
    workerScope.postMessage(
      { type: "result", result },
      [result.voxels.buffer as ArrayBuffer]
    );
  } catch (error) {
    const knownError = error instanceof StlVoxelizationError ? error : null;
    workerScope.postMessage({
      type: "error",
      code: knownError?.code ?? "STL_WORKER_FAILED",
      message: knownError?.message ?? "STLのボクセル変換に失敗しました。"
    });
  }
};

export {};
