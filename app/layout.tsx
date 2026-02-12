import "./globals.css";
import Providers from "@/components/Providers";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Q-BU!",
};

// Mobile support
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
