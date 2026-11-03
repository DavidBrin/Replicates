import { describe, expect, it } from "vitest";

import { Btn, held } from "@/engine/types";
import { createGamepadInput, padPortMap } from "./gamepad";
import { drivingPads, joinPresses, padIndexForSeat, type SeatOfPad } from "./padJoin";

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

/**
 * The final wave (seam review I-1): one rule says which pad drives a seat. `/play`'s
 * `GamepadInput`, the select screen's `drivingPads` and the Gamepad options' capture all
 * read it, so a rebind is heard on the pad that plays the seat.
 */
describe("the pad that drives a seat (final wave, seam review I-1)", () => {
  const human = (joinedPad: number | null): SeatOfPad => ({ kind: "human", joinedPad });
  // The reviewer's setup: P1 and P3 human, P2 a CPU, pads 0-2. Pads 0 and 1 drive P1 and
  // P3 by connection order, so pad 2 is the free one; it presses A and takes P2.
  const seats = [human(null), human(2), human(null)];
  const pads = [pad(0, []), pad(1, []), pad(2, [])];

  it("is a joined seat's own pad, and the k-th unjoined pad for the k-th unjoined human", () => {
    expect(seats.map((_, seat) => padIndexForSeat(pads, seats, seat))).toEqual([0, 2, 1]);
    expect(padIndexForSeat(pads, [human(null), { kind: "cpu", joinedPad: null }], 1)).toBeNull();
    // More unjoined humans than unjoined pads: the last one has none.
    expect(padIndexForSeat([pad(0, [])], [human(null), human(null)], 1)).toBeNull();
  });

  it("agrees with the match: each seat's pad is the one /play's GamepadInput reads for it", () => {
    for (let seat = 0; seat < seats.length; seat++) {
      const index = padIndexForSeat(pads, seats, seat);
      const pressing = pads.map((p) => ({ ...pad(p.index, p.index === index ? [0] : []), axes: [0, 0, 0, 0] }) as unknown as Gamepad);
      // Configured as `src/app/play/page.tsx` configures it.
      const input = createGamepadInput({
        navigator: { getGamepads: () => pressing } as unknown as Navigator,
        portForPad: padPortMap(seats.flatMap((s, port) => (s.joinedPad === null ? [port] : []))),
        portForPadIndex: (i) => seats.findIndex((s) => s.joinedPad === i),
        holdPorts: true,
      });
      const { frames } = input.poll(seats.length);
      expect(frames.map((f) => held(f, Btn.Attack))).toEqual(seats.map((_, port) => port === seat));
    }
  });

  it("leaves a joined seat whose pad is unplugged to that pad: no unjoined pad takes it", () => {
    const unplugged = [pad(0, []), pad(1, [])];
    expect(padIndexForSeat(unplugged, seats, 1)).toBe(2);
    expect(padIndexForSeat(unplugged, seats, 2)).toBe(1);
    expect([...drivingPads(unplugged, seats)].sort()).toEqual([0, 1, 2]);
  });
});
