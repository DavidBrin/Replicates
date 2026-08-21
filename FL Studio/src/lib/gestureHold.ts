"use client";

/**
 * The "a pointer gesture is in flight" hold every ref-driven drag surface
 * takes (SPEC.md §2.2: persistence "never fires mid-drag").
 *
 * The store can see a drag only when the drag lives in the store — which is
 * true of exactly one surface, the piano roll and its `dragKind`. Every other
 * drag (knob, fader, tempo LCD, rack swing slider, clip move, rack paint
 * stroke) keeps its state in a `useRef`, invisible to `store.subscribe`. This
 * hook is the two-line bridge: `hold()` on pointer-down, `release()` on
 * pointer-up/cancel, and the autosave debounce defers any flush that comes due
 * in between (`startAutosave` in `@/lib/store`).
 *
 * Three properties matter, and they are why this is a hook rather than a pair
 * of bare calls:
 *
 * 1. **Re-entrant `hold()` is a no-op.** A second pointer-down without an
 *    intervening release does not stack two ids, so it cannot need two
 *    releases.
 * 2. **`release()` without a hold is a no-op** — pointerup and pointercancel
 *    may both arrive, and a surface may release defensively.
 * 3. **Unmounting releases.** A control torn down mid-drag (the rack row whose
 *    channel was deleted under the pointer) would otherwise leave a hold that
 *    nothing can ever clear, and autosave would be silent for the rest of the
 *    session. This is the leak the id-set in the store is shaped to survive,
 *    and this effect is what stops it happening at all.
 */

import { useCallback, useEffect, useRef } from "react";

import { useAppStore } from "@/lib/store";

let gestureCounter = 0;

/** Monotonic rather than random so a test can read the id back. */
function mintGestureId(prefix: string): string {
  gestureCounter += 1;
  return `${prefix}#${gestureCounter}`;
}

export interface GestureHold {
  /** Open the hold (pointer-down). Idempotent while one is already open. */
  hold: () => void;
  /** Close it (pointer-up / pointer-cancel). Idempotent when none is open. */
  release: () => void;
}

export function useGestureHold(prefix: string): GestureHold {
  const idRef = useRef<string | null>(null);

  const releaseId = useCallback((): void => {
    const id = idRef.current;
    if (id === null) return;
    idRef.current = null;
    useAppStore.getState().endGesture(id);
  }, []);

  const hold = useCallback((): void => {
    if (idRef.current !== null) return;
    const id = mintGestureId(prefix);
    idRef.current = id;
    useAppStore.getState().beginGesture(id);
  }, [prefix]);

  useEffect(() => releaseId, [releaseId]);

  return { hold, release: releaseId };
}
