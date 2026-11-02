/**
 * Gamepad remapping and the right stick (Plan 5, Task 21). Ultimate lets each
 * player rebind the pad's buttons and set the right stick to Smash Attack
 * (its main use), Special or Off.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { fx } from "@/engine/fixed";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn, CONTROL_STICK_JUMP_OFF } from "@/engine/types";
import type { FighterState, GameState, InputFrame, MatchRules } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";
import { KeyboardInput } from "./keyboard";
import { CONFIG_ARROWS } from "./schemes";
import {
  DEFAULT_PAD_SETTINGS,
  GamepadInput,
  STANDARD_MAPPING,
  isPadSettings,
  mappingFrom,
  mergeKeyboardAndPad,
  padButtonName,
  padPortMap,
  rebind,
  type GamepadMapping,
  type PadSettings,
  type RightStickMode,
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

  /**
   * Ruling R-FW3a (codex P2-1): the flick lets go of the left stick, not the
   * d-pad. Before, d-pad Up held through a flick to the right packed
   * `[4, 0, 18, 4]`: one hold, two presses.
   */
  describe("over a held d-pad direction (ruling R-FW3a)", () => {
    const DPAD = { up: 12, left: 14, right: 15 } as const;

    /** Four polls with d-pad `button` held and the right stick at rest, then flicked right to 0.9 and held. */
    function overDpad(button: number): { frames: InputFrame[]; presses: InputFrame[]; flicks: InputFrame[] } {
      const { nav, set } = livePad();
      const pads = input(nav, mappingFrom(DEFAULT_PAD_SETTINGS));
      const polls = [0, 0.9, 0.9, 0.9].map((x) => {
        set(pad({ buttons: [button], axes: [0, 0, x, 0] }));
        return pads.poll(1);
      });
      return { frames: polls.map((p) => p.frames[0]), presses: polls.map((p) => p.pressed[0]), flicks: polls.map((p) => p.flicks[0]) };
    }

    it("keeps a direction across the flick held: d-pad Up is pressed once", () => {
      const { frames, presses } = overDpad(DPAD.up);
      expect(frames).toEqual([Btn.Up, Btn.Up, Btn.Up | Btn.Right | Btn.Attack, Btn.Up]);
      expect(presses.map((p) => (p & Btn.Up) !== 0)).toEqual([true, false, false, false]);
    });

    it("yields the flick's own axis to it for its two frames: the same direction comes back held", () => {
      const { frames, presses } = overDpad(DPAD.right);
      expect(frames).toEqual([Btn.Right, 0, Btn.Right | Btn.Attack, Btn.Right]);
      // The second press is the flick's own: a smash needs a fresh direction.
      expect(presses.map((p) => (p & Btn.Right) !== 0)).toEqual([true, false, true, false]);
    });

    it("yields the opposite direction too, which comes back as a fresh press", () => {
      const { frames, presses } = overDpad(DPAD.left);
      expect(frames).toEqual([Btn.Left, 0, Btn.Right | Btn.Attack, Btn.Left]);
      expect(presses.map((p) => (p & Btn.Left) !== 0)).toEqual([true, false, false, true]);
    });

    it("reports the flick's frame, its direction and button, where they are pressed (ruling R-FW3b)", () => {
      expect(overDpad(DPAD.up).flicks).toEqual([0, 0, Btn.Right | Btn.Attack, 0]);
    });
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

  /**
   * R-T21a as amended: "at rest" is below the walk threshold, the neutral the
   * flick rule itself reads. A worn stick resting outside the dead zone (raw
   * 0.3, short of the threshold's raw ~0.41) arms on its first poll and flicks
   * as any other; read strictly, it would never arm, and the right stick would
   * be dead for the match with nothing to say so.
   */
  it("arms a worn stick resting short of the walk threshold, outside the dead zone, and flicks from there", () => {
    const { nav, set } = livePad();
    const pads = input(nav, mappingFrom(DEFAULT_PAD_SETTINGS));
    const frames = [0.3, 0.3, 1, 1, 0.3, 0.3, 1, 1].map((x) => {
      set(pad({ axes: [0, 0, x, 0] }));
      return pads.poll(1).frames[0];
    });
    expect(frames).toEqual([0, 0, 0, Btn.Right | Btn.Attack, 0, 0, 0, Btn.Right | Btn.Attack]);
  });

  /**
   * A flick from one side straight to the other crosses neutral between two
   * polls, so no poll sees it at rest. The flick rule already reads that as a
   * change of direction, not a flick (as "needs the stick back at neutral
   * before another flick"): it never fires, and it never arms an unarmed
   * stick either. A poll at rest, then a flick, fires as ever.
   */
  it("reads a fast flick to the other side, never seen at rest, as no flick, armed or not", () => {
    expect(run(DEFAULT_PAD_SETTINGS, [RIGHT, RIGHT, [0, 0, -0.9, 0], [0, 0, -0.9, 0], NEUTRAL, [0, 0, -0.9, 0], [0, 0, -0.9, 0]])).toEqual([
      0,
      Btn.Right | Btn.Attack,
      0,
      0,
      0,
      0,
      Btn.Left | Btn.Attack,
    ]);
    const { nav, set } = livePad();
    const pads = input(nav, mappingFrom(DEFAULT_PAD_SETTINGS));
    const unarmed = [RIGHT, [0, 0, -0.9, 0], [0, 0, -0.9, 0]].map((axes) => {
      set(pad({ axes }));
      return pads.poll(1).frames[0];
    });
    expect(unarmed).toEqual([0, 0, 0]);
  });

  /** The `gamepaddisconnected` event forgets the stick's rest, as the poll that misses the pad does. */
  it("never fires for a stick held through a disconnect event and back", () => {
    const { nav, set } = livePad();
    live = new GamepadInput({ window, navigator: nav, mappingForPort: () => mappingFrom(DEFAULT_PAD_SETTINGS) });
    live.attach();
    live.poll(1);
    const gone = new Event("gamepaddisconnected") as GamepadEvent;
    Object.defineProperty(gone, "gamepad", { value: pad() });
    window.dispatchEvent(gone);
    // Back at once, with the stick held, before any poll saw it gone.
    set(pad({ axes: RIGHT }));
    expect([live.poll(1).frames[0], live.poll(1).frames[0]]).toEqual([0, 0]);
  });

  it("never fires for a stick held through a detach and a new attach", () => {
    const { nav, set } = livePad();
    live = new GamepadInput({ window, navigator: nav, mappingForPort: () => mappingFrom(DEFAULT_PAD_SETTINGS) });
    live.attach();
    live.poll(1);
    live.detach();
    live.attach();
    set(pad({ axes: RIGHT }));
    expect([live.poll(1).frames[0], live.poll(1).frames[0]]).toEqual([0, 0]);
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

  /**
   * Ruling R-FW3b (codex P2-2): the keyboard's Tilt key held on the same port
   * made the flick's forward smash a forward tilt: `Btn.Soft` rode onto the
   * flick's frame (`[512, 530, 512]`). The flick is a full push of its own.
   */
  it("is still a smash with the keyboard's Tilt key held: Mario's forward smash, not his forward tilt", () => {
    const { nav, set } = livePad();
    const pads = input(nav, mappingFrom(DEFAULT_PAD_SETTINGS));
    pads.poll(1);
    const merged = [0.9, 0.9, 0.9].map((x) => {
      set(pad({ axes: [0, 0, x, 0] }));
      const p = pads.poll(1);
      return mergeKeyboardAndPad(Btn.Soft, p.frames[0], p.flicks[0]);
    });
    expect(merged).toEqual([Btn.Soft, Btn.Right | Btn.Attack | Btn.Flick, Btn.Soft]);
    expect(moveAfter(merged)).toBe("fsmash");
  });

  /**
   * Ruling R-FW3e: the flick's direction wins the attack's over a d-pad direction held
   * across it. The held bit stays held (one press, R-FW3a), and the sim reads y before x,
   * so without `Btn.Flick` a flick right over d-pad Up started the d-pad's move.
   * Through the real `GamepadInput`, its merge and `step()`: Mario facing right, the
   * d-pad held from the first poll, `settle` polls at rest, then a flick right (fired on
   * the poll after), in `mode`. The fighter on the fire frame.
   */
  function flickOver(over: Partial<FighterState>, dpad: number, settle: number, mode: RightStickMode = "smash", controls = 0): FighterState {
    const { nav, set } = livePad();
    const pads = input(nav, mappingFrom({ ...DEFAULT_PAD_SETTINGS, rightStick: mode }));
    let s = standing();
    Object.assign(s.fighters[0], over);
    s.fighters[0].combat.controls = controls;
    let prev: InputFrame = 0;
    const seen: FighterState[] = [];
    for (const x of [...Array<number>(settle).fill(0), 0.9, 0.9]) {
      set(pad({ buttons: [dpad], axes: [0, 0, x, 0] }));
      const p = pads.poll(1);
      const frame = mergeKeyboardAndPad(0, p.frames[0], p.flicks[0]);
      s = step(s, [frame], { prevInputs: [prev] }).state;
      prev = frame;
      seen.push(s.fighters[0]);
    }
    expect(prev & Btn.Flick, "the last poll is the flick's fire frame").toBe(Btn.Flick);
    return seen[seen.length - 1];
  }
  const UP = 12;
  const DOWN = 13;
  const AIR: Partial<FighterState> = { action: "fall", grounded: false, platform: -1, y: fx(60), jumpsUsed: 1 };

  it("takes the flick's direction over a d-pad one held across it, in the air: a forward air with Up or Down held (ruling R-FW3e)", () => {
    expect(flickOver(AIR, UP, 2).move).toBe("fair");
    expect(flickOver(AIR, DOWN, 2).move).toBe("fair");
  });

  it("in special mode, the side special with Up or Down held, on the ground and in the air (ruling R-FW3e)", () => {
    // Stick Jump off, so a held Up stands rather than jumps.
    expect(flickOver({}, UP, 2, "special", CONTROL_STICK_JUMP_OFF).move).toBe("sideB");
    expect(flickOver(AIR, UP, 2, "special").move).toBe("sideB");
    expect(flickOver(AIR, DOWN, 2, "special").move).toBe("sideB");
  });

  it("from a crouch on a held d-pad Down, the forward smash, not the down tilt (ruling R-FW3e)", () => {
    const f = flickOver({}, DOWN, 12);
    expect([f.action, f.move]).toEqual(["attack", "fsmash"]);
  });

  it("leaves the keyboard's own presses as they were: Up held, then Right and Attack in the air, is an up air", () => {
    const kb = new KeyboardInput([{ port: 0, scheme: CONFIG_ARROWS }], { window, overlayHost: null });
    kb.attach();
    try {
      let s = standing();
      let prev: InputFrame = 0;
      const key = (code: string) => window.dispatchEvent(new KeyboardEvent("keydown", { code, cancelable: true }));
      for (let i = 0; i < 16; i++) {
        // Up on 0 (a tap jump: airborne by 10), Right and Attack together on 14.
        if (i === 0) key(CONFIG_ARROWS.bindings.up);
        if (i === 14) {
          key(CONFIG_ARROWS.bindings.right);
          key(CONFIG_ARROWS.bindings.attack);
        }
        const frame = mergeKeyboardAndPad(kb.drain().frames[0], 0);
        expect(frame & Btn.Flick, `frame ${i}`).toBe(0);
        s = step(s, [frame], { prevInputs: [prev] }).state;
        prev = frame;
        if (i === 13) expect(s.fighters[0].grounded).toBe(false);
      }
      expect(s.fighters[0].move).toBe("uair");
    } finally {
      kb.detach();
    }
  });

  it("leaves the Tilt key softening the left stick: its full push and attack are a forward tilt (Task 21b)", () => {
    const merged = mergeKeyboardAndPad(Btn.Soft, Btn.Right | Btn.Attack);
    expect(merged).toBe(Btn.Soft | Btn.Right | Btn.Attack);
    expect(moveAfter([Btn.Soft, merged, Btn.Soft])).toBe("ftilt");
  });
});
