import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Btn, held } from "@/engine/types";
import {
  DASH_THRESHOLD,
  GamepadInput,
  NEUTRAL_STICK,
  RADIAL_DEADZONE,
  STANDARD_MAPPING,
  WALK_THRESHOLD,
  createGamepadInput,
  radialDeadzone,
} from "./gamepad";

/* --------------------------------------------------------------- fixtures -- */

function pad(over: { buttons?: number[]; axes?: number[]; index?: number } = {}): Gamepad {
  const pressedButtons = new Set(over.buttons ?? []);
  return {
    id: "fake",
    index: over.index ?? 0,
    connected: true,
    mapping: "standard",
    timestamp: 0,
    axes: over.axes ?? [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({
      pressed: pressedButtons.has(i),
      touched: pressedButtons.has(i),
      value: pressedButtons.has(i) ? 1 : 0,
    })),
    vibrationActuator: null,
  } as unknown as Gamepad;
}

function navigatorWith(pads: (Gamepad | null)[]): Navigator {
  return { getGamepads: () => pads } as unknown as Navigator;
}

let live: GamepadInput | null = null;
afterEach(() => {
  live?.detach();
  live = null;
});

/* -------------------------------------------------------------- deadzone -- */

const unit = fc.double({ min: -1, max: 1, noNaN: true });

describe("the radial deadzone", () => {
  it("never reports more than full deflection", () => {
    fc.assert(
      fc.property(unit, unit, (x, y) => {
        const stick = radialDeadzone(x, y);
        expect(stick.magnitude).toBeLessThanOrEqual(1);
        expect(Math.sqrt(stick.x * stick.x + stick.y * stick.y)).toBeLessThanOrEqual(1 + 1e-9);
      }),
    );
  });

  it("agrees with its own reported magnitude", () => {
    fc.assert(
      fc.property(unit, unit, (x, y) => {
        const stick = radialDeadzone(x, y);
        const length = Math.sqrt(stick.x * stick.x + stick.y * stick.y);
        expect(length).toBeCloseTo(stick.magnitude, 9);
      }),
    );
  });

  it("does not clip a diagonal shorter than a cardinal", () => {
    const cardinal = radialDeadzone(1, 0);
    const diagonal = radialDeadzone(1, 1);
    expect(diagonal.magnitude).toBeGreaterThanOrEqual(cardinal.magnitude);
    expect(cardinal.magnitude).toBeCloseTo(1, 9);
    expect(diagonal.magnitude).toBeCloseTo(1, 9);
  });

  it("treats every direction alike at equal deflection", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 6.28, noNaN: true }), (angle) => {
        // Deliberately allowed to use Math.sin/cos: this is a test's own
        // scaffolding, not simulation code.
        const x = Math.cos(angle) * 0.6;
        const y = Math.sin(angle) * 0.6;
        expect(radialDeadzone(x, y).magnitude).toBeCloseTo(
          (0.6 - RADIAL_DEADZONE) / (1 - RADIAL_DEADZONE),
          9,
        );
      }),
    );
  });

  it("zeroes everything inside the dead radius and nothing outside it", () => {
    fc.assert(
      fc.property(unit, unit, (x, y) => {
        const raw = Math.sqrt(x * x + y * y);
        const stick = radialDeadzone(x, y);
        if (raw <= RADIAL_DEADZONE) expect(stick).toEqual(NEUTRAL_STICK);
        else expect(stick.magnitude).toBeGreaterThan(0);
      }),
    );
  });

  it("keeps the shallow diagonal that per-axis clamping would swallow", () => {
    // 0.2 total deflection at 45 degrees is 0.141 on each axis. Per-axis
    // clamping zeroes both and the input disappears; the same 0.2 pushed along
    // an axis survives. That asymmetry is exactly what "diagonals need a
    // harder push" feels like, and the radial form does not have it.
    const diagonal = radialDeadzone(0.1414, 0.1414);
    const cardinal = radialDeadzone(0.2, 0);
    expect(diagonal.magnitude).toBeGreaterThan(0);
    expect(diagonal.magnitude).toBeCloseTo(cardinal.magnitude, 3);
  });

  it("rescales from the deadzone edge, so the first nudge past it is small", () => {
    const justOutside = radialDeadzone(RADIAL_DEADZONE + 0.001, 0);
    expect(justOutside.magnitude).toBeGreaterThan(0);
    expect(justOutside.magnitude).toBeLessThan(0.01);
  });

  it("rises monotonically with deflection and keeps the sign", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.2, max: 0.9, noNaN: true }),
        fc.double({ min: 0.001, max: 0.1, noNaN: true }),
        (base, delta) => {
          const smaller = radialDeadzone(-base, 0);
          const larger = radialDeadzone(-(base + delta), 0);
          expect(larger.magnitude).toBeGreaterThan(smaller.magnitude);
          expect(smaller.x).toBeLessThan(0);
        },
      ),
    );
  });
});

/* ---------------------------------------------------------------- polling -- */

describe("polling", () => {
  it("packs the standard mapping into an InputFrame", () => {
    const input = new GamepadInput({
      navigator: navigatorWith([pad({ buttons: [0, 5] })]),
      window: window,
    });
    live = input;

    const frame = input.poll().frames[0];
    expect(held(frame, Btn.Attack)).toBe(true);
    expect(held(frame, Btn.Grab)).toBe(true);
    expect(held(frame, Btn.Special)).toBe(false);
    expect(STANDARD_MAPPING.grab).toContain(5);
  });

  it("reads the left stick with the Y axis flipped to the simulation's sign", () => {
    // Pads report +Y downwards; the stage's blast zones are positive at the top.
    const input = new GamepadInput({ navigator: navigatorWith([pad({ axes: [0, -1] })]) });
    live = input;

    const poll = input.poll();
    expect(poll.sticks[0].y).toBeCloseTo(1, 6);
    expect(held(poll.frames[0], Btn.Up)).toBe(true);
    expect(held(poll.frames[0], Btn.Down)).toBe(false);
  });

  it("ignores stick drift under the walk threshold", () => {
    const drift = WALK_THRESHOLD - 0.05;
    const input = new GamepadInput({ navigator: navigatorWith([pad({ axes: [drift, 0] })]) });
    live = input;
    expect(input.poll().frames[0]).toBe(0);
  });

  it("merges the d-pad with the stick", () => {
    const input = new GamepadInput({ navigator: navigatorWith([pad({ buttons: [14] })]) });
    live = input;
    expect(held(input.poll().frames[0], Btn.Left)).toBe(true);
  });

  it("edge-detects by diffing against the previous poll", () => {
    const pads: (Gamepad | null)[] = [pad({ buttons: [] })];
    const input = new GamepadInput({ navigator: navigatorWith(pads) });
    live = input;

    input.poll();
    pads[0] = pad({ buttons: [0] });
    const down = input.poll();
    expect(down.pressed[0] & Btn.Attack).toBe(Btn.Attack);
    expect(down.released[0]).toBe(0);

    const stillDown = input.poll();
    expect(stillDown.pressed[0] & Btn.Attack).toBe(0);
    expect(held(stillDown.frames[0], Btn.Attack)).toBe(true);

    pads[0] = pad({ buttons: [] });
    const up = input.poll();
    expect(up.released[0] & Btn.Attack).toBe(Btn.Attack);
    expect(up.frames[0]).toBe(0);
  });

  it("reports a flick as a fresh press, which is what makes it a smash", () => {
    const pads: (Gamepad | null)[] = [pad({ axes: [0, 0] })];
    const input = new GamepadInput({ navigator: navigatorWith(pads) });
    live = input;

    input.poll();
    pads[0] = pad({ axes: [DASH_THRESHOLD + 0.2, 0] });
    const flick = input.poll();
    expect(flick.pressed[0] & Btn.Right).toBe(Btn.Right);
    expect(flick.sticks[0].magnitude).toBeGreaterThan(DASH_THRESHOLD);
  });

  it("skips the holes getGamepads leaves for empty slots", () => {
    const input = new GamepadInput({
      navigator: navigatorWith([null, pad({ index: 1, buttons: [1] })]),
    });
    live = input;

    const poll = input.poll();
    expect(poll.frames[0]).toBe(0);
    expect(held(poll.frames[1], Btn.Special)).toBe(true);
    expect(poll.connectedPads).toEqual([1]);
  });

  it("routes pads to ports through portForPad", () => {
    const input = new GamepadInput({
      navigator: navigatorWith([pad({ buttons: [0] })]),
      portForPad: () => 2,
    });
    live = input;
    expect(held(input.poll().frames[2], Btn.Attack)).toBe(true);
  });

  it("does not latch the last frame of a pad that was unplugged", () => {
    const pads: (Gamepad | null)[] = [pad({ buttons: [15] })];
    const input = new GamepadInput({ navigator: navigatorWith(pads) });
    live = input;

    expect(held(input.poll().frames[0], Btn.Right)).toBe(true);
    pads[0] = null;
    expect(input.poll().frames[0]).toBe(0);
  });

  it("degrades to neutral where the API is absent", () => {
    const input = new GamepadInput({ navigator: {} as Navigator });
    live = input;
    expect(input.supported).toBe(false);
    expect(input.poll().frames).toEqual([0, 0, 0, 0]);
  });
});

describe("connection events", () => {
  it("tracks connect and disconnect", () => {
    const onConnectionChange = vi.fn();
    const input = createGamepadInput({
      window,
      navigator: navigatorWith([]),
      onConnectionChange,
    });
    live = input;
    input.attach();

    const connect = new Event("gamepadconnected") as GamepadEvent;
    Object.defineProperty(connect, "gamepad", { value: pad({ index: 3 }) });
    window.dispatchEvent(connect);
    expect(input.connectedPads).toEqual([3]);
    expect(onConnectionChange).toHaveBeenCalledWith(3, true);

    const disconnect = new Event("gamepaddisconnected") as GamepadEvent;
    Object.defineProperty(disconnect, "gamepad", { value: pad({ index: 3 }) });
    window.dispatchEvent(disconnect);
    expect(input.connectedPads).toEqual([]);
    expect(onConnectionChange).toHaveBeenCalledWith(3, false);
  });
});
