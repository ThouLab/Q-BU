// NOTE:
// このプロジェクトは "three" を使用しますが、環境によっては TypeScript の型定義が
// 入っていないことがあります（@types/three など）。
// まずは動くことを優先するため、最低限のモジュール宣言を同梱しています。
//
// 型をしっかり付けたい場合は、以下を追加してください:
//   npm i -D @types/three

declare module "three";
declare module "three/examples/jsm/exporters/STLExporter.js";
