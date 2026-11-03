import { describe, expect, it } from "vitest";

import { joinPresses } from "./padJoin";

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
