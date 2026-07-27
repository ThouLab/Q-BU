import "./globals.css";
import "./standalone-editor.css";
import RootProviders from "@/components/RootProviders";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Q-BU",
  description: "ブラウザだけで使えるQ-BU編集画面"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <RootProviders>{children}</RootProviders>
      </body>
    </html>
  );
}
