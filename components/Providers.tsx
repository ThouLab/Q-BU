"use client";

import React from "react";
import { AuthProvider } from "./auth/AuthProvider";
import { I18nProvider } from "./i18n/I18nProvider";
import { TelemetryProvider } from "./telemetry/TelemetryProvider";
import AccountFab from "./account/AccountFab";

/**
 * NOTE:
 * Keep BOTH a named and default export to avoid breaking existing imports:
 *   - import Providers from "@/components/Providers"
 *   - import { Providers } from "@/components/Providers"
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <AuthProvider>
        <TelemetryProvider>
          <AccountFab />
          {children}
        </TelemetryProvider>
      </AuthProvider>
    </I18nProvider>
  );
}

export default Providers;
