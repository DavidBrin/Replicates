"use client";

import type { ReactNode } from "react";

import { ContainerProvider } from "./container-provider";
import { ServiceWorkerRegistrar } from "./service-worker";
import { SettingsProvider } from "./settings-provider";

/**
 * The provider stack, in dependency order: settings are read through a port
 * that the container owns, so the container has to exist first.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ContainerProvider>
      <SettingsProvider>
        <ServiceWorkerRegistrar />
        <div className="app-frame">{children}</div>
      </SettingsProvider>
    </ContainerProvider>
  );
}
