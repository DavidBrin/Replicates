import { describe, expect, it } from "vitest";

import { createWheelGestureKeyring, WHEEL_GESTURE_GAP_MS } from "./wheelGesture";

describe("wheel gesture keyring", () => {
  it("folds a rapid run on one target into a single key", () => {
    const ring = createWheelGestureKeyring("test");
    const first = ring.keyFor("note-1", 1_000);
    expect(ring.keyFor("note-1", 1_050)).toBe(first);
    expect(ring.keyFor("note-1", 1_400)).toBe(first);
  });

  it("starts a new key once the gap has elapsed", () => {
    const ring = createWheelGestureKeyring("test");
    const first = ring.keyFor("note-1", 1_000);
    expect(ring.keyFor("note-1", 1_000 + WHEEL_GESTURE_GAP_MS)).toBe(first); // still inside
    expect(ring.keyFor("note-1", 1_000 + WHEEL_GESTURE_GAP_MS * 3)).not.toBe(first);
  });

  it("never merges two different targets, however fast", () => {
    const ring = createWheelGestureKeyring("test");
    expect(ring.keyFor("note-1", 1_000)).not.toBe(ring.keyFor("note-2", 1_001));
  });

  it("measures the gap from the LAST notch, not the first", () => {
    const ring = createWheelGestureKeyring("test");
    const first = ring.keyFor("note-1", 0);
    // A continuous flick: each notch is inside the gap, so the whole run is
    // one entry no matter how long it lasts.
    for (let at = 400; at <= 4_000; at += 400) {
      expect(ring.keyFor("note-1", at)).toBe(first);
    }
  });

  it("reset() forces the next notch to open a new entry", () => {
    const ring = createWheelGestureKeyring("test");
    const first = ring.keyFor("note-1", 1_000);
    ring.reset();
    expect(ring.keyFor("note-1", 1_010)).not.toBe(first);
  });

  /*
   * A target is composite everywhere it is used — (pattern, note) in the roll,
   * (pattern, channel, step) in the rack — and both surfaces used to join the
   * parts with ":". Ids are arbitrary strings once a file is imported, so that
   * join was not injective and two different targets shared one key.
   */
  it("keeps tuple targets apart when their parts contain the separator", () => {
    const ring = createWheelGestureKeyring("test");
    const first = ring.keyFor(["pat:1", "n-2"], 1_000);
    expect(ring.keyFor(["pat", "1:n-2"], 1_001)).not.toBe(first);
    // …and the same tuple is still the same gesture.
    expect(ring.keyFor(["pat", "1:n-2"], 1_002)).toBe(ring.keyFor(["pat", "1:n-2"], 1_003));
  });

  it("distinguishes tuples of different arity that would flatten alike", () => {
    const ring = createWheelGestureKeyring("test");
    const first = ring.keyFor(["pat-1", "ch-1:3"], 1_000);
    expect(ring.keyFor(["pat-1", "ch-1", 3], 1_001)).not.toBe(first);
  });

  it("encodes a number part distinctly from its string spelling", () => {
    const ring = createWheelGestureKeyring("test");
    const first = ring.keyFor(["pat-1", "ch-1", 3], 1_000);
    expect(ring.keyFor(["pat-1", "ch-1", "3"], 1_001)).not.toBe(first);
  });

  it("keeps two live keyrings from ever colliding", () => {
    const a = createWheelGestureKeyring("surface-a");
    const b = createWheelGestureKeyring("surface-b");
    expect(a.keyFor("same-target", 1_000)).not.toBe(b.keyFor("same-target", 1_000));
  });
});
