"use client";

import { usePathname } from "next/navigation";
import Providers from "@/components/Providers";

export default function RootProviders({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/") return <>{children}</>;
  return <Providers>{children}</Providers>;
}
