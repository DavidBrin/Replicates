"use client";

/**
 * Store-aware wrapper that decides whether to render the demo login dialog.
 *
 * Gated on `useMounted()` for the same reason `HydrationGate` in
 * `src/app/workspace/providers.tsx` gates on `hydrated`: the server pass and
 * the very first client pass must render identically, so this renders
 * nothing until the client has painted once.
 */

import { useMounted } from "@/lib/utils/use-mounted";
import { demoAuth } from "@/config/app.config";
import { useDemoAuthStore } from "@/lib/auth/demo-auth-store";
import { DemoLoginDialog } from "@/components/auth/DemoLoginDialog";

export function DemoAuthGate() {
  const mounted = useMounted();
  const gateResolved = useDemoAuthStore((s) => s.gateResolved);
  const signIn = useDemoAuthStore((s) => s.signIn);
  const skip = useDemoAuthStore((s) => s.skip);

  if (!demoAuth.enabled || !mounted || gateResolved) return null;
  return <DemoLoginDialog onSignIn={signIn} onSkip={skip} />;
}
