// NOTE:
// This file exists only because an older patch accidentally placed ModVoxelViewer at the project root.
// The real implementation lives in `components/qbu/ModVoxelViewer.tsx`.
//
// Keeping this re-export prevents TypeScript from failing the build (tsconfig includes **/*.tsx).
// New code should import from `@/components/qbu/ModVoxelViewer`.

export { default } from "@/components/qbu/ModVoxelViewer";
