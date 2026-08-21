/**
 * Undo-gesture bounding for wheel edits — the shared half of SPEC §2.1's
 * coalescing rule.
 *
 * Every *drag* has a pointer-down and a pointer-up, and those two events are
 * what bound one undo entry. A wheel has neither: Alt+wheel over a piano-roll
 * note and Alt+wheel over a rack step both nudge velocity, and both used to
 * pass a fixed `coalesceKey`. A fixed key never closes, so every nudge the
 * user ever made on that note — one now, twenty edits and a minute later —
 * folded into a single Ctrl+Z that took all of them back at once.
 *
 * The bound this reintroduces is time plus target: a run of notches on the
 * same target within {@link WHEEL_GESTURE_GAP_MS} is one entry, and a pause
 * past the gap, or moving to a different target, starts a new one.
 *
 * Lives in `src/lib` rather than in either surface because both surfaces need
 * it and neither may import the other (SPEC §6's layering rule).
 */

/**
 * The silence that ends a wheel gesture. Long enough that a continuous
 * trackpad flick or a run of notches stays one entry, short enough that
 * coming back to the same note later is a separate one.
 */
export const WHEEL_GESTURE_GAP_MS = 500;

/** What a caller passes so two gestures on *different* things never merge. */
export type WheelGestureTarget = string;

export interface WheelGestureKeyring {
  /**
   * The `coalesceKey` for a notch on `target`, minting a fresh one whenever
   * the target changed or the gap elapsed.
   */
  keyFor: (target: WheelGestureTarget, now?: number) => string;
  /** Force the next notch to start a new entry (a deliberate boundary). */
  reset: () => void;
}

let keyringCounter = 0;

/**
 * One keyring per surface instance — the counter behind it is module-level and
 * monotonic, so keys from two live keyrings can never collide.
 *
 * @param prefix names the surface in the key, purely so an undo label or a
 * failing test says where the entry came from.
 */
export function createWheelGestureKeyring(
  prefix: string,
  gapMs: number = WHEEL_GESTURE_GAP_MS,
): WheelGestureKeyring {
  let active: { target: WheelGestureTarget; key: string; lastAt: number } | null = null;

  return {
    keyFor(target, now = Date.now()) {
      if (active === null || active.target !== target || now - active.lastAt > gapMs) {
        keyringCounter += 1;
        active = { target, key: `${prefix}:${keyringCounter}`, lastAt: now };
      } else {
        active.lastAt = now;
      }
      return active.key;
    },
    reset() {
      active = null;
    },
  };
}

/** Test-only: make keys deterministic across files. */
export function __resetWheelGestureCounterForTests(): void {
  keyringCounter = 0;
}
