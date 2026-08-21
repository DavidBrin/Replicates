"use client";

/**
 * The roll's window onto the composed app store (SPEC §5).
 *
 * `uiState.ts` owns the slice; this file owns the *reads*. The split is not
 * cosmetic: `src/lib/store.ts` imports `uiState.ts` at module scope to spread
 * `createPianoRollUi`, so a runtime import of `useAppStore` from `uiState.ts`
 * would close a module cycle in which one side always evaluates first and sees
 * the other's `const` in its temporal dead zone. Nothing in `store.ts` imports
 * *this* file, so the edge only ever points one way.
 *
 * These are thin aliases — `useRollUi(s => s.pianoRoll.snap)` is exactly
 * `useAppStore(s => s.pianoRoll.snap)` — kept so the surface reads through one
 * named seam rather than sprinkling raw store access through the canvas host.
 */

import { useAppStore } from "@/lib/store";

import { DEFAULT_PIANO_ROLL_UI, type PianoRollUiSlice } from "./uiState";

/** React binding: `useRollUi((ui) => ui.pianoRoll.snap)`. */
export function useRollUi<T>(selector: (slice: PianoRollUiSlice) => T): T {
  return useAppStore(selector);
}

/** Non-hook read, for the imperative canvas painter and the key bindings. */
export function getRollUi(): PianoRollUiSlice {
  return useAppStore.getState();
}

/** The store to `subscribe()` to for repaints — the one app store. */
export const rollUiStore = useAppStore;

/** Test-only: return the slice to its defaults between cases. */
export function __resetPianoRollUiForTests(): void {
  useAppStore.setState({ pianoRoll: DEFAULT_PIANO_ROLL_UI });
}
