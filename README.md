# Q-BU!

## セットアップ

```bash
npm install
npm run dev
```

## Supabase（ログイン + 利用ログ計測）

1. Supabase で新しいプロジェクトを作成
2. SQL Editor で `supabase.sql` を実行（telemetry_consents / event_logs を作成）
3. `.env.local.example` を `.env.local` にコピーし、値を設定

```bash
cp .env.local.example .env.local
```

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`（必須：未ログインでもログを保存するため）

4. Supabase Dashboard > Authentication
   - Email / OAuth（Google等）を有効化
   - Redirect URL に以下を追加
     - `http://localhost:3000/auth/callback`
     - 本番URL: `https://<your-domain>/auth/callback`

※ メールに表示されるアプリ名は Supabase 側のメールテンプレートで変更できます。

## 使い方

- 最初に「利用状況の計測（必須）」の同意が表示されます。
  - 同意しない場合はアプリを利用できません。
- 画面左下の丸いボタンからログインできます。
  - 保存・エクスポートにはログインが必要です。
- 同意後、ログインの有無に関係なく `event_logs` にイベントが保存されます。
