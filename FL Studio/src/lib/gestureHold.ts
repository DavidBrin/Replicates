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
 *
 * ## The single-active-mutating-gesture invariant
 *
 * **At most one mutating gesture is open at a time, app-wide.** Beginning a
 * new one — {@link GestureSession.begin} (pointer), {@link
 * GestureSession.keyForEdit} (a wheel-keyring / keyboard edit run), {@link
 * GestureSession.keyFor} (a one-shot) — first ENDS whichever gesture was
 * active, sealing its undo entry and dropping its hold. {@link openGestures}
 * below is the module-level registry that enforces it; it is module-level for
 * the same reason the id counter is, since the gesture being pre-empted
 * belongs to a *different component*.
 *
 * The one exception is two sessions opened by the SAME pointer — the tempo
 * wrapper around the BPM plate — which are one gesture wearing two hats, not
 * two gestures.
 *
 * Two consequences, both deliberate:
 *
 * - **Multi-pointer simultaneous editing is out of scope.** SPEC.md does not
 *   ask for it and no conventional DAW offers it. A second pointer starting a
 *   drag ends the first one rather than editing beside it.
 * - **The undo stack never holds two open entries.** Interleaved dispatches
 *   cannot extend an entry buried below the top, because there is no second
 *   open gesture to extend one — see `domain/undo.ts`, which additionally
 *   serializes in the dispatch path so the history is correct even if a
 *   surface dispatches with a `gestureId` it did not take a session for.
 *   History SEGMENTS are deliberately not built: the problem is prevented,
 *   not modelled.
 *
 * ## Owner state dies with the session
 *
 * A session ending is not always the owner's idea. The revision watcher
 * (rule (d)), the window backstop (rule (f)), unmount and pre-emption all end
 * it from the outside, and the hold is only *half* the state a gesture holds:
 * the other half is the owner's own `useRef` — `Knob`/`Fader`'s `dragState`,
 * `ClipView`'s `dragState`, `Playlist`'s `middlePan`. Left set, that ref made
 * the next pointermove — a plain HOVER, with no button held — dispatch the
 * dead gesture's start value and coalesce key into the *replacement* project.
 *
 * So {@link GestureSessionOptions.onCancel} is part of the session contract,
 * not an extra: an owner with per-gesture state registers it and clears that
 * state there, and it fires on EVERY close (the owner's own `end()` included,
 * where clearing an already-cleared ref is a no-op). A callback that fires on
 * only *some* of the ways a gesture can end is the exact bug it exists to
 * prevent.
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

/** A session's stable identity in {@link openGestures}. */
interface ActiveGesture {
  end: () => void;
  /** The pointer that opened it, or `null` for a keyboard/focus open. */
  pointerId: number | null;
}

/**
 * Every mutating session currently open, app-wide — the registry behind the
 * single-active-mutating-gesture invariant (module header).
 *
 * Module-level so a gesture in one component can pre-empt one in another:
 * that is the whole point, and a context or a store field would re-render
 * every knob in the app on every pointer-down.
 *
 * A *set* rather than a single slot, because ONE press can legitimately open
 * two sessions: `TransportBar` wraps `BpmLcd` in a session that owns the
 * tempo's undo identity while the LCD plate's own session owns the hold, so
 * the same `pointerId` opens both. They are one gesture and must end together
 * rather than tear each other down — see {@link preemptOtherGestures}.
 */
const openGestures = new Set<ActiveGesture>();

/**
 * End every open gesture that is not `self` and not part of the same press.
 *
 * "Same press" is `pointerId` equality: a physical pointer cannot pre-empt
 * itself, and nested surfaces sharing one press are one gesture (see
 * {@link openGestures}). A keyboard/focus open — `pointerId === null` — makes
 * no such claim and pre-empts everything, which is exactly the case the
 * invariant exists for: a keyboard edit landing mid-drag.
 *
 * Each victim is removed from the registry BEFORE its `end` runs, so the
 * re-entrant `end` that `onCancel` owners trigger (`ChannelRackRow`'s
 * `cancelPaint` calls `release()`) cannot see it still open.
 */
function preemptOtherGestures(self: ActiveGesture, pointerId: number | null): void {
  if (openGestures.size === 0) return;
  for (const other of [...openGestures]) {
    if (other === self) continue;
    if (pointerId !== null && other.pointerId === pointerId) continue;
    openGestures.delete(other);
    other.end();
  }
}

/** Test seam: deterministic ids across test files. */
export function __resetGestureCounterForTests(): void {
  gestureCounter = 0;
  openGestures.clear();
}

/**
 * Where a pointer id can be read from.
 *
 * `begin` is wired straight onto elements as a handler in places
 * (`onPointerDown={swing.begin}`), so it is handed a React synthetic event
 * rather than a number and must cope with both — and with neither, for the
 * keyboard/focus openers that have no pointer at all.
 */
export type PointerIdSource = number | { pointerId?: unknown } | null | undefined;

function readPointerId(source: PointerIdSource): number | null {
  if (typeof source === "number") return Number.isFinite(source) ? source : null;
  if (source === null || source === undefined) return null;
  const id = (source as { pointerId?: unknown }).pointerId;
  return typeof id === "number" && Number.isFinite(id) ? id : null;
}

export interface GestureHold {
  /**
   * Open the hold (pointer-down). Idempotent while one is already open.
   *
   * Pass the pointer event (or its `pointerId`) so the window backstop can
   * tell this gesture's release from a stray second pointer's — see
   * {@link GestureSessionOptions.windowBackstop}.
   */
  hold: (pointer?: PointerIdSource) => void;
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
    () => ({
      hold: (pointer?: PointerIdSource) => void session.begin(pointer),
      release: session.end,
    }),
    [session],
  );
}

export interface GestureSession extends GestureHold {
  /**
   * Open the session (pointer-down / focus) and return its id, which doubles
   * as the gesture's `coalesceKey`/`gestureId`. Re-entrant: a second call
   * with one already open returns the SAME id and takes no second hold.
   *
   * Opening ENDS whatever gesture was active elsewhere in the app — the
   * single-active-mutating-gesture invariant, see this module's header.
   *
   * The argument is the opening pointer event, or its `pointerId`, or nothing
   * for a keyboard/focus open. It is wired directly as a handler in places
   * (`onPointerDown={swing.begin}`), so a synthetic event is a first-class
   * argument here rather than an accident.
   */
  begin: (pointer?: PointerIdSource) => string;
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
   *
   * The backstop is scoped to the pointer that OPENED the session, when
   * {@link GestureSession.begin} was told which one that is. A window
   * listener sees every pointer in the document: a touch elsewhere on the
   * screen, a stylus hover ending, the OS releasing a pointer the app never
   * saw — each delivers a `pointerup` that used to end this gesture from
   * under the still-pressed button that owns it, sealing the undo entry
   * mid-drag so the rest of the drag became a second Ctrl+Z. (The invariant
   * makes a second *editing* pointer impossible; it says nothing about which
   * pointer's release ENDS the one gesture that is open.) With no id
   * recorded — a keyboard/focus open — any release still ends it, which is
   * the only safe reading when the gesture has no pointer of its own.
   */
  windowBackstop?: boolean;
  /**
   * Clear the owner's per-gesture state. Called on EVERY close of an open
   * session, whatever ended it: the owner's own `end()`/`release()`, a
   * terminator, the window backstop, the revision watcher, unmount, or
   * pre-emption by another gesture.
   *
   * Every surface holding a `useRef` of drag state must register this — see
   * this module's "Owner state dies with the session". The callback is read
   * through a ref, so an inline arrow is fine and does not re-subscribe
   * anything.
   */
  onCancel?: () => void;
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
  const { windowBackstop = false, editGapMs, onCancel } = options;

  const idRef = useRef<string | null>(null);
  /** The `projectRevision` the open session was opened at — rule (d). */
  const revisionRef = useRef(0);
  /** Detaches the window backstop, or `null` when none is attached. */
  const backstopRef = useRef<(() => void) | null>(null);
  /** Lazily built: only a surface that calls `keyForEdit` ever needs one. */
  const keyringRef = useRef<WheelGestureKeyring | null>(null);
  /** The pointer that opened the session, or `null` for a keyboard/focus open. */
  const pointerIdRef = useRef<number | null>(null);
  /**
   * The owner's cleanup, held through a ref so a caller may pass an inline
   * arrow. Reading it out of `options` directly would change `end`'s identity
   * on every render, and `end` is this hook's unmount cleanup — the effect
   * would tear down and re-run each render, releasing the hold mid-drag.
   */
  const onCancelRef = useRef(onCancel);
  /** This session's stable identity in the app-wide {@link openGestures} registry. */
  const selfRef = useRef<ActiveGesture>({ end: () => {}, pointerId: null });

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
    openGestures.delete(selfRef.current);
    const id = idRef.current;
    if (id === null) return;
    // Cleared FIRST, so the owner's `onCancel` (and anything it dispatches)
    // sees a closed session and a re-entrant `end` — `ChannelRackRow`'s
    // `cancelPaint` calls `release()` — returns here instead of recursing.
    idRef.current = null;
    pointerIdRef.current = null;
    // The owner's state goes with the session: a `dragState`/`middlePan` ref
    // left set makes the next pointermove edit the REPLACEMENT project with
    // this dead gesture's values (module header, "Owner state dies with the
    // session"). Before the store call, so nothing can observe the store
    // change while the owner still believes it is dragging.
    onCancelRef.current?.();
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
    // Scoped to the pointer that opened the session (see `windowBackstop`):
    // a window listener hears every pointer in the document, and another
    // one's release is not this gesture's end.
    const onUp = (event: PointerEvent): void => {
      const owner = pointerIdRef.current;
      if (owner !== null && event.pointerId !== owner) return;
      end();
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    backstopRef.current = () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [end]);

  const begin = useCallback(
    (pointer?: PointerIdSource): string => {
      const open = idRef.current;
      if (open !== null) return open;
      const pointerId = readPointerId(pointer);
      // The invariant: one mutating gesture at a time, app-wide. Whatever was
      // being edited is sealed and released before this one opens.
      preemptOtherGestures(selfRef.current, pointerId);
      const id = nextGestureId(prefix);
      idRef.current = id;
      pointerIdRef.current = pointerId;
      selfRef.current.pointerId = pointerId;
      revisionRef.current = useAppStore.getState().projectRevision;
      openGestures.add(selfRef.current);
      useAppStore.getState().beginGesture(id);
      if (windowBackstop) attachBackstop();
      return id;
    },
    [prefix, windowBackstop, attachBackstop],
  );

  const keyFor = useCallback((): string => {
    const open = idRef.current;
    if (open !== null) return open;
    // A one-shot is a mutating gesture too — it just begins and ends inside
    // one call — so it seals the gesture in flight exactly as `begin` does.
    preemptOtherGestures(selfRef.current, null);
    return nextGestureId(prefix);
  }, [prefix]);

  const keyForEdit = useCallback(
    (now?: number): string => {
      const open = idRef.current;
      if (open !== null) return open;
      // A keyboard/wheel edit run is a mutating gesture (module header), so
      // it pre-empts too — the run itself is bounded by the keyring's gap
      // rather than by a hold, which is why it takes no session of its own.
      preemptOtherGestures(selfRef.current, null);
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
   * The two latest-value refs, synced after every render rather than during
   * it (a ref written in render is both a lint error and a real hazard under
   * concurrent rendering — a render that is thrown away must not leave the
   * registry pointing at it).
   *
   * No dependency array: both must track EVERY render. `onCancel` is
   * typically an inline arrow, and `selfRef.end` is how a gesture in another
   * component pre-empts this one, so a stale one would run the wrong
   * cleanup — or none.
   *
   * After-render is early enough for both: nothing here is read during
   * render, only from event handlers, effects and the store subscription,
   * all of which run after the commit that set them.
   */
  useEffect(() => {
    onCancelRef.current = onCancel;
    selfRef.current.end = end;
  });

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
      hold: (pointer?: PointerIdSource) => void begin(pointer),
      release: end,
      terminators,
    }),
    [begin, keyFor, keyForEdit, peek, end, terminators],
  );
}
