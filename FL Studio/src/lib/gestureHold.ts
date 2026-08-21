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
 * d. **A hold dies with the project it was taken against.** Every session
 *    watches `store.projectRevision` and cancels itself when it moves, so a
 *    control that is still mounted after an undo/redo/import (a `ClipView`
 *    whose id survived a same-id re-import, a knob on a channel the new
 *    project happens to name the same) cannot keep a hold — or an undo
 *    entry — open across the replacement. Surfaces that additionally BUFFER
 *    commands still compare the revision themselves (`ChannelRackRow`'s
 *    `PaintSession`): the shared cancel drops the hold, but only the surface
 *    knows its buffer must be thrown away rather than dispatched.
 * e. **A keyboard-triggered edit must NOT open a session**: there is no
 *    pointer-up coming, and a control that keeps focus would hold autosave off
 *    for as long as it stayed focused. Use {@link GestureSession.keyForEdit}
 *    for a control that is edited by BOTH pointer and keyboard (it returns the
 *    open drag's id when there is one, and otherwise a time-bounded one-shot
 *    key that takes no hold), or {@link GestureSession.keyFor} for a pure
 *    one-shot (a menu item, a spinner click).
 * f. **A drag whose release can land off the element wires a window
 *    backstop.** `pointerup` on a surface only fires for a release inside its
 *    bounds, and a right-button sweep cannot use pointer capture without
 *    swallowing the context menu. Pass `{ windowBackstop: true }` and the hook
 *    listens on the window for BOTH `pointerup` and `pointercancel` while a
 *    session is open (the shared form of the backstop `ChannelRackRow` wires
 *    by hand for its buffered stroke).
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
import { createWheelGestureKeyring, type WheelGestureKeyring } from "@/lib/wheelGesture";

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
export function useGestureHold(prefix: string, options: GestureSessionOptions = {}): GestureHold {
  const session = useGestureSession(prefix, options);
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
  /**
   * The key for an EDIT that may come from the pointer or from the keyboard.
   *
   * With a drag open it is that drag's id, so a pointer gesture is unchanged.
   * With nothing open — arrow keys on a focused range input — it is a
   * **time-bounded** key from a private keyring (the wheel keyring's rule,
   * `@/lib/wheelGesture`): a run of arrow presses within
   * {@link GestureSessionOptions.editGapMs} is one undo entry, a pause or a
   * closed drag starts a new one. It takes **no hold**, which is the whole
   * point: `begin()` on a keyboard edit opens a hold that only `blur` can
   * close, so a user who nudges a slider and leaves it focused silences
   * autosave for the rest of the session (rule (e)).
   */
  keyForEdit: (now?: number) => string;
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

export interface GestureSessionOptions {
  /**
   * Listen on the WINDOW for `pointerup`/`pointercancel` while a session is
   * open (rule (f)). For a drag whose release may land outside the element
   * that opened it and which cannot take pointer capture — the playlist's
   * right-button erase sweep, where capture would break the context menu.
   */
  windowBackstop?: boolean;
  /**
   * The silence that ends a KEYBOARD edit run in {@link
   * GestureSession.keyForEdit}. Defaults to the wheel gesture's gap, which is
   * tuned for exactly the same thing: a stream of discrete nudges with no
   * gesture end of its own.
   */
  editGapMs?: number;
}

export function useGestureSession(
  prefix: string,
  options: GestureSessionOptions = {},
): GestureSession {
  // Destructured, not held as an object: a call site passing an inline literal
  // hands a new object every render, and every callback below would change
  // identity with it.
  const { windowBackstop = false, editGapMs } = options;

  const idRef = useRef<string | null>(null);
  /** The `projectRevision` the open session was opened at — rule (d). */
  const revisionRef = useRef(0);
  /** Detaches the window backstop, or `null` when none is attached. */
  const backstopRef = useRef<(() => void) | null>(null);
  /** Lazily built: only a surface that calls `keyForEdit` ever needs one. */
  const keyringRef = useRef<WheelGestureKeyring | null>(null);

  const detachBackstop = useCallback((): void => {
    const detach = backstopRef.current;
    if (detach === null) return;
    backstopRef.current = null;
    detach();
  }, []);

  const end = useCallback((): void => {
    detachBackstop();
    // A keyboard run and a drag are different gestures even back to back, so
    // the drag's end closes the keyring's entry too: without this, arrowing a
    // slider within the gap after releasing it folds into the run BEFORE the
    // drag.
    keyringRef.current?.reset();
    const id = idRef.current;
    if (id === null) return;
    idRef.current = null;
    // `endGesture(id)` does both halves: seals the coalescing undo entry this
    // gesture owns and drops the persistence hold. Releasing an id that is not
    // held is a no-op in the store, so a double release cannot go negative.
    useAppStore.getState().endGesture(id);
  }, [detachBackstop]);

  const attachBackstop = useCallback((): void => {
    if (backstopRef.current !== null) return;
    if (typeof window === "undefined") return;
    // BOTH, never just `pointerup`: a cancelled pointer (capture lost, a
    // system gesture, the tab hidden) delivers only `pointercancel`, and the
    // hold it leaves behind silences autosave for the rest of the session.
    const onUp = (): void => end();
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    backstopRef.current = () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [end]);

  const begin = useCallback((): string => {
    const open = idRef.current;
    if (open !== null) return open;
    const id = nextGestureId(prefix);
    idRef.current = id;
    revisionRef.current = useAppStore.getState().projectRevision;
    useAppStore.getState().beginGesture(id);
    if (windowBackstop) attachBackstop();
    return id;
  }, [prefix, windowBackstop, attachBackstop]);

  const keyFor = useCallback((): string => idRef.current ?? nextGestureId(prefix), [prefix]);

  const keyForEdit = useCallback(
    (now?: number): string => {
      const open = idRef.current;
      if (open !== null) return open;
      keyringRef.current ??= createWheelGestureKeyring(prefix, editGapMs);
      // One keyring per session, so the target is the session itself; the
      // keyring's own counter keeps the key distinct from every gesture id
      // (`prefix:N` vs `prefix#N`).
      return keyringRef.current.keyFor(prefix, now);
    },
    [prefix, editGapMs],
  );

  const peek = useCallback((): string | null => idRef.current, []);

  /*
   * Rule (b)'s last terminator (unmount) and rule (d)'s watcher, in one
   * subscription.
   *
   * The watcher is imperative rather than a `useAppStore(selectProjectRevision)`
   * selector on purpose: every knob, fader and clip in the app runs this hook,
   * and a subscribed selector would re-render all of them on every undo.
   */
  useEffect(() => {
    const unsubscribe = useAppStore.subscribe((state) => {
      if (idRef.current === null) return;
      if (state.projectRevision === revisionRef.current) return;
      // The project this gesture was taken against is gone (undo, redo, load,
      // import, a pattern/mode switch). Anything the control writes from here
      // lands in a stranger's project, and the hold would outlive the session
      // that justified it.
      end();
    });
    return () => {
      unsubscribe();
      end();
    };
  }, [end]);

  const terminators = useMemo(
    () => ({ onPointerUp: end, onPointerCancel: end, onBlur: end }),
    [end],
  );

  return useMemo(
    () => ({
      begin,
      keyFor,
      keyForEdit,
      peek,
      end,
      hold: () => void begin(),
      release: end,
      terminators,
    }),
    [begin, keyFor, keyForEdit, peek, end, terminators],
  );
}
