import { NextResponse } from "next/server";

export async function POST(request: Request) {
  // Stripe / Google Pay 決済は、環境変数・決済アカウント設定が必要です。
  // ここは“流れ”を先に作っておき、後で本番設定で有効化できます。
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "stripe_not_configured",
        message:
          "Stripe(=Google Pay)が未設定です。STRIPE_SECRET_KEY を .env.local に設定し、実装を有効化してください。",
      },
      { status: 501 }
    );
  }

  // ここまで来たら本来はStripe Checkout Sessionを作成してURLを返す。
  // 依存ライブラリ(stripe)の導入と、価格/配送/税/通知の設計が必要になるため、
  // 現段階では明示的に停止します。
  return NextResponse.json(
    {
      ok: false,
      error: "stripe_checkout_not_implemented",
      message: "Stripeは設定されていますが、Checkout作成処理が未実装です。",
    },
    { status: 501 }
  );
}
