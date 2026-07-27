# Q-BU standalone editor

`/` を開くと、クラス選択・ログイン・参加QRを経由せず編集画面が直接表示されます。
作品はサーバーへ送信せず、右上の「保存」から `.qbu` ファイルとして端末へダウンロードします。

## ローカル起動

```bash
npm ci
npm run dev
```

`http://localhost:3000/` を開いて確認します。Production build の確認は次のとおりです。

```bash
npm run build
npm run start
```

## 保存仕様

- ブラウザ内でUTF-8 JSONを生成し、`<入力名>.qbu` としてダウンロード
- `fetch`、Supabase、作品送信APIは使用しない
- Class ID、Project ID、確認コード、参加者トークン、個人情報は保存しない
- 編集中モデルとツールバー設定は、同じブラウザの `localStorage` に自動保存

`.qbu` のトップレベル形式は次のとおりです。

```json
{
  "format": "qbu-standalone",
  "version": 1,
  "app": "Q-BU",
  "exportedAt": "2026-01-01T00:00:00.000Z",
  "project": {
    "fileName": "Q-BU"
  },
  "editor": {
    "gridSize": 32,
    "maxBlocks": 300
  },
  "model": {
    "version": 1,
    "blocks": [
      { "x": 0, "y": 0, "z": 0, "color": "white" }
    ]
  }
}
```

## 公開面

公開面は `/` のスタンドアロン編集画面だけです。旧版のソースは復元用に残していますが、
旧ページと `/api/**` は `middleware.ts` で404にしています。
