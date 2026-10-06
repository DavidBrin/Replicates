/**
 * The one `declare global` for `window.__riskDebug` (SPEC §11 T10, F27).
 *
 * Installed only when `NEXT_PUBLIC_RISK_DEBUG === "1"`. S4 registers
 * `state`/`seq` from the session; S5 calls `registerDebug` again for
 * `pollNow`/`setInterval`. Merging rather than replacing is the whole point:
 * two slices contribute to one handle and neither clobbers the other.
 */
import type { GameState } from "@/engine/types";

export interface RiskDebug {
  seq(): number;
  /** The CONFIRMED state (§4.15), cloned. Simulation truth, not pixels. */
  state(): GameState;
  /** Resolves when the response has been applied. */
  pollNow(): Promise<void>;
  setInterval(ms: number): void;
}

declare global {
  interface Window { __riskDebug?: Partial<RiskDebug> }
}

/** True when the build opted into the debug handle. */
export function debugEnabled(): boolean {
  return process.env.NEXT_PUBLIC_RISK_DEBUG === "1";
}

/**
 * Merge `partial` into `window.__riskDebug`, creating it on first call.
 * A no-op when the flag is off or there is no `window`, so callers never
 * guard.
 */
export function registerDebug(partial: Partial<RiskDebug>): void {
  if (typeof window === "undefined" || !debugEnabled()) return;
  window.__riskDebug = { ...(window.__riskDebug ?? {}), ...partial };
}

/** Drop the keys this caller registered, so a torn-down session leaves nothing behind. */
export function unregisterDebug(keys: readonly (keyof RiskDebug)[]): void {
  if (typeof window === "undefined" || !window.__riskDebug) return;
  const next = { ...window.__riskDebug };
  for (const key of keys) delete next[key];
  window.__riskDebug = next;
}

/** Structured clone where it exists, a JSON round-trip where it does not. */
export function cloneState(state: GameState): GameState {
  try {
    if (typeof structuredClone === "function") return structuredClone(state);
  } catch {
    /* fall through */
  }
  return JSON.parse(JSON.stringify(state)) as GameState;
}
