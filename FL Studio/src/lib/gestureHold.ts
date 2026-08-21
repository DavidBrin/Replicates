"use client";

/**
 * The one place a pointer gesture is registered with the store.
 *
 * Two hooks, one rule set. Every drag surface in this app keeps its gesture
 * state in a `useRef` (the piano roll is the single exception — its `dragKind`
 * is store state), and a ref is invisible to `store.subscribe`. These hooks
 * are the bridge, and they exist as hooks rather than as a pair of bare calls
 * so that the checklist below is satisfied by *construction* rather than by
 * every call site remembering it:
 *
 * a. **A gesture that dispatches project changes registers a hold**, so the
 *    debounced autosave defers any flush that comes due mid-drag
 *    (`startAutosave` in `@/lib/store`; SPEC §2.2 "never fires mid-drag").
 * b. **A hold releases on pointerup AND pointercancel AND unmount** (and on
 *    blur where the gesture is keyboard-reachable). {@link GestureSession}
 *    hands the first three out as a spreadable `terminators` object and takes
 *    the last one itself; a surface therefore cannot wire only `pointerup`.
 * c. **Per-gesture ids come from a MODULE-level counter**, never a
 *    component-local `useRef`. A ref resets when the component remounts (an
 *    F5-equivalent re-render, a tab flip, a keyed list re-order), so two
 *    different gestures could mint the same id and `domain/undo.ts` would
 *    weld them into one undo entry. This counter outlives every remount in
 *    the page's lifetime.
 * d. Buffered sessions additionally watch `store.projectRevision` — see
 *    `ChannelRackRow`'s `PaintSession`.
 * e. A keyboard-triggered one-shot must NOT open a session: there is no
 *    pointer-up coming. Use {@link GestureSession.keyFor}, which mints a
 *    standalone id without taking a hold.
 *
 * Three properties of the hold itself, and they are why this is stateful:
 *
 * 1. **Re-entrant open is a no-op.** A second pointer-down without an
 *    intervening release does not stack two ids, so it cannot need two
 *    releases.
 * 2. **Release without a hold is a no-op** — pointerup and pointercancel may
 *    both arrive, and a surface may release defensively.
 * 3. **Unmounting releases.** A control torn down mid-drag (the rack row
 *    whose channel was deleted under the pointer) would otherwise leave a
 *    hold that nothing can ever clear, and autosave would be silent for the
 *    rest of the session. This is the leak the id-set in the store is shaped
 *    to survive, and the unmount effect is what stops it happening at all.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";

import { useAppStore } from "@/lib/store";

/**
 * Module-level, deliberately — see rule (c) above. A component-local counter
 * restarts at 0 on remount and re-mints ids a previous mount already used.
 */
let gestureCounter = 0;

/** Mint a process-unique gesture id. Monotonic so a test can read it back. */
export function nextGestureId(prefix: string): string {
  gestureCounter += 1;
  return `${prefix}#${gestureCounter}`;
}

/** Test seam: deterministic ids across test files. */
export function __resetGestureCounterForTests(): void {
  gestureCounter = 0;
}

export interface GestureHold {
  /** Open the hold (pointer-down). Idempotent while one is already open. */
  hold: () => void;
  /** Close it (pointer-up / pointer-cancel). Idempotent when none is open. */
  release: () => void;
}

/**
 * The minimal form: a persistence hold with no id of its own to hand out.
 *
 * For surfaces that already mint their own per-gesture coalesce key
 * (`Knob`, `Fader`) or that buffer their commands and commit exactly one
 * (`ChannelRackRow`'s paint stroke). If the surface needs the gesture's id —
 * to pass as `coalesceKey` or `gestureId` — use {@link useGestureSession}
 * instead, which is the same hold plus that id.
 */
export function useGestureHold(prefix: string): GestureHold {
  const session = useGestureSession(prefix);
  return useMemo(
    () => ({ hold: () => void session.begin(), release: session.end }),
    [session],
  );
}

export interface GestureSession extends GestureHold {
  /**
   * Open the session (pointer-down / focus) and return its id, which doubles
   * as the gesture's `coalesceKey`/`gestureId`. Re-entrant: a second call
   * with one already open returns the SAME id and takes no second hold.
   */
  begin: () => string;
  /**
   * The open session's id, or — with nothing open — a **fresh** one-shot id
   * that takes no hold.
   *
   * This is what a keyboard nudge, a spinner click or a menu item asks for
   * (rule (e)): the action commits now, so it needs an id that separates it
   * from its neighbours in the undo stack, and it must never leave a hold
   * behind waiting for a pointer-up that is not coming.
   */
  keyFor: () => string;
  /** The open session's id, or `null`. For assertions and guards. */
  peek: () => string | null;
  /**
   * Close the session: releases the persistence hold **and** seals the undo
   * entry, so the next dispatch cannot fold into this gesture. Idempotent.
   */
  end: () => void;
  /**
   * Every way a gesture can end that is not the surface's own commit path,
   * in one spreadable object (rule (b)). Spread it onto the element that
   * owns the gesture:
   *
   * ```tsx
   * <input onPointerDown={swing.begin} onFocus={swing.begin} {...swing.terminators} />
   * ```
   *
   * A surface that must run code of its own on pointer-up (a commit) still
   * spreads this and overrides `onPointerUp` after the spread — the other two
   * terminators stay wired, which is the half that keeps getting forgotten.
   */
  terminators: {
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onBlur: () => void;
  };
}

export function useGestureSession(prefix: string): GestureSession {
  const idRef = useRef<string | null>(null);

  const end = useCallback((): void => {
    const id = idRef.current;
    if (id === null) return;
    idRef.current = null;
    // `endGesture(id)` does both halves: seals the coalescing undo entry and
    // drops the persistence hold. Releasing an id that is not held is a no-op
    // in the store, so a double release cannot go negative.
    useAppStore.getState().endGesture(id);
  }, []);

  const begin = useCallback((): string => {
    const open = idRef.current;
    if (open !== null) return open;
    const id = nextGestureId(prefix);
    idRef.current = id;
    useAppStore.getState().beginGesture(id);
    return id;
  }, [prefix]);

  const keyFor = useCallback((): string => idRef.current ?? nextGestureId(prefix), [prefix]);

  const peek = useCallback((): string | null => idRef.current, []);

  // Rule (b)'s last terminator: unmounting mid-gesture releases the hold.
  useEffect(() => end, [end]);

  const terminators = useMemo(
    () => ({ onPointerUp: end, onPointerCancel: end, onBlur: end }),
    [end],
  );

  return useMemo(
    () => ({
      begin,
      keyFor,
      peek,
      end,
      hold: () => void begin(),
      release: end,
      terminators,
    }),
    [begin, keyFor, peek, end, terminators],
  );
}
