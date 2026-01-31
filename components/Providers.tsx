"use client";

import React from "react";

import { AuthProvider } from "@/components/auth/AuthProvider";
import { TelemetryProvider } from "@/components/telemetry/TelemetryProvider";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <TelemetryProvider>{children}</TelemetryProvider>
    </AuthProvider>
  );
}
