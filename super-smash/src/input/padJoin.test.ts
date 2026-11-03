import { describe, expect, it } from "vitest";

import { drivingPads, joinPresses } from "./padJoin";

/** A connected pad at `index` with `pressed` buttons down. */
const pad = (index: number, pressed: number[]): Gamepad =>
  ({ index, connected: true, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) }) as unknown as Gamepad;

describe("press-to-join (Plan 6, Task 30)", () => {
  it("reports an unseated pad whose A or Start went down, once a press", () => {
    const last = new Map<number, boolean>();
    expect(joinPresses([pad(0, [])], new Set(), last)).toEqual([]);
    expect(joinPresses([pad(0, [0])], new Set(), last)).toEqual([0]);
    expect(joinPresses([pad(0, [0])], new Set(), last)).toEqual([]);
    expect(joinPresses([pad(0, []), pad(2, [9])], new Set(), last)).toEqual([2]);
  });

  it("ignores a pad already seated, an empty slot and a disconnected pad", () => {
    const last = new Map<number, boolean>();
    const gone = { ...pad(4, [0]), connected: false } as unknown as Gamepad;
    expect(joinPresses([null, pad(1, [0]), gone], new Set([1]), last)).toEqual([]);
  });
});

describe("the pads that already drive a seat (Plan 6, Task 30, fix round 1)", () => {
  const human = (joinedPad: number | null) => ({ kind: "human" as const, joinedPad });
  const cpu = { kind: "cpu" as const, joinedPad: null };

  it("counts each joined pad, and the unjoined pads connection order gives the human seats nobody joined", () => {
    // A lone pad plays P1 by connection order: it drives a seat without having joined.
    expect([...drivingPads([pad(0, [])], [human(null), cpu])]).toEqual([0]);
    // Pad 0 joined P2, so P1 goes to the first pad nobody joined, pad 1; pad 2 is free.
    expect([...drivingPads([pad(0, []), pad(1, []), pad(2, [])], [human(null), human(0)])].sort()).toEqual([0, 1]);
    // Connection order is index order, over connected pads only; a CPU seat takes none.
    expect([...drivingPads([null, pad(3, []), pad(1, [])], [human(null), cpu])]).toEqual([1]);
  });
});
