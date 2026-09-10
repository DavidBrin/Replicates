"use client";

/**
 * The single client boundary for the workspace app.
 *
 * Everything interactive lives below this. It owns theme context, storage
 * hydration, and the gate that keeps the first client render byte-identical
 * to the server render.
 */

import type { ReactNode } from "react";
import { ThemeProvider } from "@/lib/theme/theme-provider";
import { useWorkspacePersistence } from "@/lib/store/hydration";
import { DemoAuthGate } from "@/components/auth/DemoAuthGate";

function HydrationGate({ children }: { children: ReactNode }) {
  const { hydrated } = useWorkspacePersistence();

  // The seeded workspace renders on the server and on the first client pass;
  // the saved snapshot arrives one tick later. Showing a skeleton for that
  // tick is what keeps the two passes identical.
  if (!hydrated) return <WorkspaceSkeleton />;
  return <>{children}</>;
}

function WorkspaceSkeleton() {
  return (
    <div
      className="flex h-screen w-full"
      style={{ background: "var(--bac-pri)" }}
      aria-busy="true"
      aria-label="Loading workspace"
    >
      <div className="h-full w-60 shrink-0" style={{ background: "var(--bac-sec)" }} />
      <div className="flex-1" />
    </div>
  );
}

export function WorkspaceProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <HydrationGate>{children}</HydrationGate>
      <DemoAuthGate />
    </ThemeProvider>
  );
}
