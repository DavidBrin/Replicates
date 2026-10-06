import { registerDebug, unregisterDebug, type RiskDebug } from "@/game/debugBridge";

/**
 * Registering S5's half of `window.__riskDebug` (SPEC §11's T10 block).
 *
 * The bridge, its `registerDebug` and the **one** `declare global` for
 * `Window.__riskDebug` (F27) are S4's, in `src/game/debugBridge.ts`. S4
 * registers `state` and `seq` from the session; S5 registers `pollNow` and
 * `setInterval`. The merge is additive, so whichever slice registers second
 * does not erase the first — that is the whole contract.
 *
 * This module is a two-line pass-through and exists for one reason: to name
 * which keys are S5's, in one place, so the unmount drops exactly those and
 * not S4's.
 */

/** The keys this slice owns. Dropped together on unmount. */
export const S5_DEBUG_KEYS = ["pollNow", "setInterval"] as const satisfies readonly (keyof RiskDebug)[];

export function registerRiskDebug(partial: Partial<RiskDebug>): void {
  registerDebug(partial);
}

export function unregisterRiskDebug(
  keys: readonly (keyof RiskDebug)[] = S5_DEBUG_KEYS,
): void {
  unregisterDebug(keys);
}
