# Build notes (Q-BU)

このドキュメントは「リリース前に `npm run build` が落ちる」系の事故を、毎回同じ原因で踏まないためのメモです。

---

## Release前チェック（最低限）

1. 依存関係をクリーンにしてからビルド
   - `rm -rf node_modules .next`（Windowsなら該当フォルダ削除）
   - `npm ci`（lock運用） or `npm install`
   - `npm run build`

2. 文字列ベタ書き／型シムの確認（差分が大きい時）
   - `rg "declare module \"three\"" types -n`
   - `rg "new Blob\(\[" -n`（TypedArray → Blobの経路）

---

## よくあるビルド落ち原因と対策

### 1) three.js の型定義が無い / 壊れている

**症状**
- `Could not find a declaration file for module 'three'`
- `Namespace '"three"' has no exported member 'WebGLRenderer'`

**原因**
- このリポジトリの `node_modules/three` には `.d.ts` が同梱されていません。
- 以前の `types/three-shim.d.ts` が `declare module "three";` のみだと、
  **モジュールは存在するが export が空**になり、`THREE.WebGLRenderer` などが解決できません。

**対策（現行の方針）**
- `types/three-shim.d.ts` に、プロジェクトで使う three のシンボルだけを **最小宣言（ほぼ any）** で定義しています。
- three のAPIを追加で使う場合は、**この shim に export を足す**。

**より厳密にしたい場合（将来案）**
- `@types/three` を導入して、この shim を削除。
- ただし、その場合は strict な型エラーが一気に出る可能性があるため、リリース直前にやらない。

---

### 2) TypedArray → Blob で TS が落ちる（ArrayBufferLike 問題）

**症状**
- `Type 'Uint8Array<ArrayBufferLike>' is not assignable to type 'BlobPart'`

**原因**
- TS 5.5+ で `Uint8Array` が `ArrayBufferLike` になるケースがあり、`Blob([bytes])` で弾かれます。

**対策**
- `bytes.buffer instanceof ArrayBuffer` を満たす **ArrayBuffer-backed view** に揃える（必要ならコピー）。
- 既存のユーティリティ（例: `base64ToBytes()` / `bytesToBase64Async()`）を使う。

---


### 3) three-shim のメソッド引数数（overload）で落ちる

**症状**
- `Expected 1 arguments, but got 3.`（例: `camera.lookAt(0, 0, 0)`）

**原因**
- `types/three-shim.d.ts` が three.js の overload を 1つの引数形に限定していると、
  実装は正しいのに型チェックだけ落ちます。

**対策**
- shim では overload を厳密に再現しようとせず、`(...args: any[])` のように **可変長で許容**する。
  （このリポジトリの方針＝「ビルドを落とさないための permissive shim」に一致）


### 4) パッチ適用ミスでルート直下に ts/tsx ファイルが増えて落ちる

**症状**
- `Cannot find module './voxelUtils' or its corresponding type declarations.`
- エラー行が `./ModVoxelViewer.tsx` のように **プロジェクト直下**の `.tsx` を指す

**原因**
- `tsconfig.json` の `include` が `**/*.ts` / `**/*.tsx` なので、
  **import されていないファイルでも型チェック対象**になります。
- 過去のパッチで、`components/qbu/ModVoxelViewer.tsx` を差し替えるつもりが
  誤って `ModVoxelViewer.tsx`（ルート直下）として展開されてしまい、
  相対import（`./voxelUtils` 等）が解決できずビルドが落ちました。

**対策**
1. ルート直下に意図しない `.ts/.tsx` が無いか確認
   - Windows: `dir *.tsx` / `dir *.ts`
   - mac/Linux: `ls -1 *.tsx *.ts`（存在しなければOK）

2. パッチzipの中身を適用前に確認（重要）
   - `unzip -l patch.zip` を見て、
     - `components/...` のように **ディレクトリ付き**で入っているか
     - `SomeFile.tsx` のような **意図しないルート直下のファイル**が含まれていないか

3. もしルート直下に誤配置ファイルができてしまった場合
   - 可能なら削除する（最もクリーン）
   - 削除できない場合は、
     - ルート直下ファイルを **正しい実体への re-export** に置き換える（暫定策）


## 追記するときのルール

- 「一時しのぎの any キャスト」ではなく、**原因が再発しにくい場所（ユーティリティ/型shim/入口）**で潰す。
- 新しいモジュール import を増やしたら、`npm run build` を必ず通してからパッチ化する。
