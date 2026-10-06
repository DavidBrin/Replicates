import type { GameState } from "@/engine/types";

import { riskDebugEnabled } from "./debugFlag";

/**
 * Registering S5's half of `window.__riskDebug` (SPEC §11's T10 block).
 *
 * The bridge itself — `src/game/debugBridge.ts`, its `registerDebug` and the
 * **one** `declare global` for `Window.__riskDebug` (F27) — is S4's file.
 * S5 registers `seq`, `pollNow` and `setInterval` through it; S4 registers
 * `state`.
 *
 * While that file does not exist, `registerDebug` is resolved at runtime
 * through a variable specifier (so TypeScript does not try to resolve a
 * module that is not there yet) and the handle is merged onto
 * `window.__riskDebug` directly if it is missing. Either way the merge is
 * additive, so whichever slice registers second does not erase the first —
 * which is the entire contract of `registerDebug`.
 *
 * No `declare global` here, deliberately: a second one would collide with
 * S4's the moment it lands. The window is reached through a local cast
 * instead.
 */

export interface RiskDebugPartial {
  seq?: () => number;
  state?: () => GameState;
  pollNow?: () => Promise<void>;
  setInterval?: (ms: number) => void;
}

type DebugWindow = { __riskDebug?: RiskDebugPartial };

const BRIDGE_SPECIFIER = "@/game/debugBridge";

/**
 * Merge `partial` into `window.__riskDebug`. A no-op when the debug flag is
 * off, so the production bundle installs nothing at all.
 */
export async function registerRiskDebug(partial: RiskDebugPartial): Promise<void> {
  if (!riskDebugEnabled() || typeof window === "undefined") return;

  try {
    const bridge = (await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ BRIDGE_SPECIFIER
    )) as { registerDebug?: (value: RiskDebugPartial) => void };
    if (typeof bridge.registerDebug === "function") {
      bridge.registerDebug(partial);
      return;
    }
  } catch {
    // S4's bridge has not landed yet; fall through to the direct merge.
  }

  const target = window as unknown as DebugWindow;
  target.__riskDebug = { ...target.__riskDebug, ...partial };
}

/** Remove the keys this slice registered, on unmount. */
export function unregisterRiskDebug(keys: readonly (keyof RiskDebugPartial)[]): void {
  if (typeof window === "undefined") return;
  const target = window as unknown as DebugWindow;
  const existing = target.__riskDebug;
  if (!existing) return;
  const next: RiskDebugPartial = { ...existing };
  for (const key of keys) delete next[key];
  target.__riskDebug = next;
}
