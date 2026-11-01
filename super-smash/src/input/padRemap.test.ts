/**
 * Gamepad remapping and the right stick (Plan 5, Task 21). Ultimate lets each
 * player rebind the pad's buttons and set the right stick to Smash Attack
 * (its main use), Special or Off.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";
import {
  DEFAULT_PAD_SETTINGS,
  GamepadInput,
  STANDARD_MAPPING,
  isPadSettings,
  mappingFrom,
  padButtonName,
  padPortMap,
  rebind,
  type GamepadMapping,
  type PadSettings,
} from "./gamepad";

function pad(over: { buttons?: number[]; axes?: number[]; index?: number; mapping?: GamepadMappingType } = {}): Gamepad {
  const pressed = new Set(over.buttons ?? []);
  return {
    id: "fake",
    index: over.index ?? 0,
    connected: true,
    mapping: over.mapping ?? "standard",
    timestamp: 0,
    axes: over.axes ?? [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.has(i), touched: pressed.has(i), value: pressed.has(i) ? 1 : 0 })),
    vibrationActuator: null,
  } as unknown as Gamepad;
}

/** A pad whose state the test changes between polls. */
function livePad(): { nav: Navigator; set(next: Gamepad | null): void } {
  let current: Gamepad | null = pad();
  return { nav: { getGamepads: () => [current] } as unknown as Navigator, set: (next) => (current = next) };
}

let live: GamepadInput | null = null;
afterEach(() => {
  live?.detach();
  live = null;
});

function input(nav: Navigator, mapping: GamepadMapping): GamepadInput {
  live = new GamepadInput({ navigator: nav, mappingForPort: () => mapping });
  return live;
}

describe("rebinding a button", () => {
  it("gives the action that button alone, and takes it off whatever had it", () => {
    // Y (3) jumps by default; bind it to attack.
    const next = rebind(DEFAULT_PAD_SETTINGS, "attack", 3);
    expect(next.buttons.attack).toEqual([3]);
    expect(next.buttons.jump).toEqual([2]);
    expect(next.buttons.special).toEqual(STANDARD_MAPPING.special);
    expect(DEFAULT_PAD_SETTINGS.buttons.attack).toEqual([0]);
  });

  it("is what the pad reads, port by port", () => {
    const { nav, set } = livePad();
    const pads = input(nav, mappingFrom(rebind(DEFAULT_PAD_SETTINGS, "attack", 3)));
    set(pad({ buttons: [3] }));
    expect(pads.poll(1).frames[0]).toBe(Btn.Attack);
    set(pad({ buttons: [0] }));
    // A is unbound now: it does nothing.
    expect(pads.poll(1).frames[0]).toBe(0);
  });

  it("swaps rather than leave an action unbound: B on attack puts A on special", () => {
    const next = rebind(DEFAULT_PAD_SETTINGS, "attack", 1);
    expect(next.buttons.attack).toEqual([1]);
    expect(next.buttons.special).toEqual([0]);
    // Both jump buttons to shield: jump keeps one of shield's.
    const both = rebind(rebind(DEFAULT_PAD_SETTINGS, "shield", 2), "shield", 3);
    expect(both.buttons.shield).toEqual([3]);
    expect(both.buttons.jump.length).toBeGreaterThan(0);
    for (const a of ["attack", "special", "jump", "shield", "grab"] as const) expect(both.buttons[a].length).toBeGreaterThan(0);
  });

  it("takes a d-pad button off its direction once it is bound to an action", () => {
    const { nav, set } = livePad();
    const pads = input(nav, mappingFrom(rebind(DEFAULT_PAD_SETTINGS, "jump", 12)));
    set(pad({ buttons: [12] }));
    expect(pads.poll(1).frames[0]).toBe(Btn.Jump);
    // The other directions still move.
    set(pad({ buttons: [13] }));
    expect(pads.poll(1).frames[0]).toBe(Btn.Down);
  });

  it("checks settings read back from storage", () => {
    expect(isPadSettings(DEFAULT_PAD_SETTINGS)).toBe(true);
    expect(isPadSettings({ ...DEFAULT_PAD_SETTINGS, rightStick: "tilt" })).toBe(false);
    expect(isPadSettings({ ...DEFAULT_PAD_SETTINGS, buttons: { ...DEFAULT_PAD_SETTINGS.buttons, jump: [] } })).toBe(false);
    expect(isPadSettings({ ...DEFAULT_PAD_SETTINGS, buttons: { ...DEFAULT_PAD_SETTINGS.buttons, attack: ["0"] } })).toBe(false);
    expect(isPadSettings(null)).toBe(false);
  });

  it("refuses settings that put one button on two actions, which a rebind never makes", () => {
    expect(isPadSettings({ ...DEFAULT_PAD_SETTINGS, buttons: { ...DEFAULT_PAD_SETTINGS.buttons, grab: [5, 0] } })).toBe(false);
    expect(isPadSettings({ ...DEFAULT_PAD_SETTINGS, buttons: { ...DEFAULT_PAD_SETTINGS.buttons, jump: [2, 2] } })).toBe(false);
    expect(isPadSettings(rebind(rebind(DEFAULT_PAD_SETTINGS, "grab", 0), "special", 5))).toBe(true);
  });

  it("refuses button numbers no pad has", () => {
    for (const bad of [[-1], [32], [1.5], [Number.NaN]]) {
      expect(isPadSettings({ ...DEFAULT_PAD_SETTINGS, buttons: { ...DEFAULT_PAD_SETTINGS.buttons, grab: bad } })).toBe(false);
    }
    expect(isPadSettings({ ...DEFAULT_PAD_SETTINGS, buttons: { ...DEFAULT_PAD_SETTINGS.buttons, grab: [31] } })).toBe(true);
  });

  it("refuses more than eight buttons on one action", () => {
    const eight = [5, 8, 9, 10, 11, 12, 13, 14];
    expect(isPadSettings({ ...DEFAULT_PAD_SETTINGS, buttons: { ...DEFAULT_PAD_SETTINGS.buttons, grab: eight } })).toBe(true);
    expect(isPadSettings({ ...DEFAULT_PAD_SETTINGS, buttons: { ...DEFAULT_PAD_SETTINGS.buttons, grab: [...eight, 15] } })).toBe(false);
  });

  it("maps the five actions alone: the stick's axes are never the settings'", () => {
    const odd = { ...DEFAULT_PAD_SETTINGS, buttons: { ...DEFAULT_PAD_SETTINGS.buttons, stickX: 3 } } as unknown as PadSettings;
    expect(mappingFrom(odd).stickX).toBe(STANDARD_MAPPING.stickX);
  });

  it("names the standard buttons", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(padButtonName)).toEqual(["A", "B", "X", "Y", "LB", "RB", "LT", "RT"]);
    expect(padButtonName(20)).toBe("Button 20");
  });

  it("reads each port's own mapping, ports held for the match", () => {
    const pads: (Gamepad | null)[] = [pad({ index: 0, buttons: [3] }), pad({ index: 1, buttons: [3] })];
    const mine = mappingFrom(rebind(DEFAULT_PAD_SETTINGS, "attack", 3));
    live = new GamepadInput({
      navigator: { getGamepads: () => pads } as unknown as Navigator,
      portForPad: padPortMap([0, 2]),
      holdPorts: true,
      mappingForPort: (port) => (port === 2 ? mine : STANDARD_MAPPING),
    });
    const { frames } = live.poll(3);
    expect(frames).toEqual([Btn.Jump, 0, Btn.Attack]);
  });
});

describe("the right stick", () => {
  const NEUTRAL = [0, 0, 0, 0];
  const RIGHT = [0, 0, 1, 0];
  const UP = [0, 0, 0, -1];

  /** The packed frames over four polls with the right stick at `axes` and the left at `left`. */
  function flick(settings: PadSettings, axes: number[], left: number[] = [0, 0]): InputFrame[] {
    return run(settings, Array.from({ length: 4 }, () => [left[0], left[1], axes[2], axes[3]]));
  }

  /**
   * The packed frames over `polls`, after one poll (not reported) with the
   * right stick at rest and the left as on the first: a flick needs the stick
   * seen at rest first (R-T21a).
   */
  function run(settings: PadSettings, polls: readonly number[][]): InputFrame[] {
    const { nav, set } = livePad();
    const pads = input(nav, mappingFrom(settings));
    set(pad({ axes: [polls[0][0], polls[0][1], 0, 0] }));
    pads.poll(1);
    return polls.map((axes) => {
      set(pad({ axes }));
      return pads.poll(1).frames[0];
    });
  }

  it("smash (the default): a flick lets go of the left stick for a frame, then is that direction and attack", () => {
    expect(flick(DEFAULT_PAD_SETTINGS, RIGHT)).toEqual([0, Btn.Right | Btn.Attack, 0, 0]);
  });

  it("does it over a held left stick, so the direction is a fresh press", () => {
    expect(flick(DEFAULT_PAD_SETTINGS, RIGHT, [-1, 0])).toEqual([0, Btn.Right | Btn.Attack, Btn.Left, Btn.Left]);
  });

  it("is a full push even over a soft left stick", () => {
    expect(flick(DEFAULT_PAD_SETTINGS, UP, [0.5, 0])).toEqual([0, Btn.Up | Btn.Attack, Btn.Right | Btn.Soft, Btn.Right | Btn.Soft]);
  });

  it("special: the same with the special button", () => {
    expect(flick({ ...DEFAULT_PAD_SETTINGS, rightStick: "special" }, UP)).toEqual([0, Btn.Up | Btn.Special, 0, 0]);
  });

  it("off: nothing", () => {
    expect(flick({ ...DEFAULT_PAD_SETTINGS, rightStick: "off" }, RIGHT)).toEqual([0, 0, 0, 0]);
  });

  it("reports the attack and the direction as presses on the second frame", () => {
    const { nav, set } = livePad();
    const pads = input(nav, mappingFrom(DEFAULT_PAD_SETTINGS));
    pads.poll(1);
    set(pad({ axes: RIGHT }));
    expect(pads.poll(1).pressed[0]).toBe(0);
    expect(pads.poll(1).pressed[0]).toBe(Btn.Right | Btn.Attack);
  });

  it("comes out even when the stick is back at neutral by the second frame", () => {
    expect(run(DEFAULT_PAD_SETTINGS, [RIGHT, NEUTRAL, NEUTRAL])).toEqual([0, Btn.Right | Btn.Attack, 0]);
  });

  it("needs the stick back at neutral before another flick", () => {
    expect(run(DEFAULT_PAD_SETTINGS, [RIGHT, RIGHT, UP, UP])).toEqual([0, Btn.Right | Btn.Attack, 0, 0]);
    expect(run(DEFAULT_PAD_SETTINGS, [RIGHT, NEUTRAL, UP, UP])).toEqual([0, Btn.Right | Btn.Attack, 0, Btn.Up | Btn.Attack]);
  });

  it("ignores a push inside the walk threshold", () => {
    expect(flick(DEFAULT_PAD_SETTINGS, [0, 0, 0.3, 0])).toEqual([0, 0, 0, 0]);
  });

  it("forgets a flick whose pad is unplugged before its second frame", () => {
    const { nav, set } = livePad();
    const pads = input(nav, mappingFrom(DEFAULT_PAD_SETTINGS));
    pads.poll(1);
    set(pad({ axes: RIGHT }));
    expect(pads.poll(1).frames[0]).toBe(0);
    set(null);
    expect(pads.poll(1).frames[0]).toBe(0);
    set(pad({ axes: NEUTRAL }));
    expect(pads.poll(1).frames[0]).toBe(0);
  });

  it("forgets a flick whose pad reports itself disconnected", () => {
    const { nav, set } = livePad();
    live = new GamepadInput({ window, navigator: nav, mappingForPort: () => mappingFrom(DEFAULT_PAD_SETTINGS) });
    live.attach();
    live.poll(1);
    set(pad({ axes: RIGHT }));
    expect(live.poll(1).frames[0]).toBe(0);
    const gone = new Event("gamepaddisconnected") as GamepadEvent;
    Object.defineProperty(gone, "gamepad", { value: pad() });
    window.dispatchEvent(gone);
    // Plugged back in at once, before a poll could see it gone.
    set(pad({ axes: NEUTRAL }));
    expect(live.poll(1).frames[0]).toBe(0);
  });

  it("forgets a flick on detach", () => {
    const { nav, set } = livePad();
    live = new GamepadInput({ window, navigator: nav, mappingForPort: () => mappingFrom(DEFAULT_PAD_SETTINGS) });
    live.attach();
    live.poll(1);
    set(pad({ axes: RIGHT }));
    expect(live.poll(1).frames[0]).toBe(0);
    live.detach();
    set(pad({ axes: NEUTRAL }));
    expect(live.poll(1).frames[0]).toBe(0);
  });

  /**
   * R-T21a: axes 2 and 3 are the right stick only in the W3C standard
   * mapping. On another layout they may be triggers, which rest at an end of
   * their travel.
   */
  it("reads nothing on a pad without the standard mapping: a trigger on axis 2 is not a stick", () => {
    const { nav, set } = livePad();
    const pads = input(nav, mappingFrom(DEFAULT_PAD_SETTINGS));
    // At rest at +1 from the first poll, pulled through to -1, let back through 0, and at rest again.
    const frames = [1, 1, -1, -1, 0, 1, 1].map((trigger) => {
      set(pad({ axes: [0, 0, trigger, 0], mapping: "" }));
      return pads.poll(1).frames[0];
    });
    expect(frames).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  /** R-T21a: a flick starts from rest, so a stick already pushed when the pads are first read waits to come back. */
  it("never fires for a stick already pushed on the first poll, until it is back at rest and flicked again", () => {
    const { nav, set } = livePad();
    const pads = input(nav, mappingFrom(DEFAULT_PAD_SETTINGS));
    const frames = [RIGHT, RIGHT, NEUTRAL, RIGHT, RIGHT].map((axes) => {
      set(pad({ axes }));
      return pads.poll(1).frames[0];
    });
    expect(frames).toEqual([0, 0, 0, 0, Btn.Right | Btn.Attack]);
  });

  it("waits for the stick inside the dead zone: resting short of the walk threshold is not at rest", () => {
    const { nav, set } = livePad();
    const pads = input(nav, mappingFrom(DEFAULT_PAD_SETTINGS));
    const frames = [0.25, 1, 1, 0, 1, 1].map((x) => {
      set(pad({ axes: [0, 0, x, 0] }));
      return pads.poll(1).frames[0];
    });
    expect(frames).toEqual([0, 0, 0, 0, 0, Btn.Right | Btn.Attack]);
  });

  it("never fires for a stick held through an unplug and back", () => {
    const { nav, set } = livePad();
    const pads = input(nav, mappingFrom(DEFAULT_PAD_SETTINGS));
    pads.poll(1);
    set(null);
    pads.poll(1);
    const frames = [RIGHT, RIGHT].map((axes) => {
      set(pad({ axes }));
      return pads.poll(1).frames[0];
    });
    expect(frames).toEqual([0, 0]);
  });
});

describe("what the fighter does with a right-stick flick", () => {
  const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };

  beforeAll(() => {
    registerFighters(FIGHTERS);
    registerStages(STAGES);
  });

  function standing(): GameState {
    const s = createInitialState("finalDestination", [{ defId: "mario" }], RULES, 2);
    Object.assign(s.fighters[0], { action: "stand", grounded: true, platform: 0, x: 0, y: 0, facing: 1, intangible: 0 });
    return s;
  }

  function moveAfter(frames: readonly InputFrame[]): string | null {
    let s = standing();
    let prev: InputFrame = 0;
    for (const i of frames) {
      s = step(s, [i], { prevInputs: [prev] }).state;
      prev = i;
    }
    return s.fighters[0].move;
  }

  it("is a forward smash on the ground", () => {
    expect(moveAfter([0, Btn.Right | Btn.Attack, 0])).toBe("fsmash");
  });

  it("is an up smash, not a jump, with Stick Jump on", () => {
    expect(moveAfter([0, Btn.Up | Btn.Attack, 0])).toBe("usmash");
  });
});
