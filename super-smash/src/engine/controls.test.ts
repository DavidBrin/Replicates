import { beforeAll, describe, expect, it } from "vitest";

import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";
import { emptyCombat } from "./combat";
import { fx } from "./fixed";
import { kineticLaunch } from "./kinetic";
import { createInitialState, registerFighters, registerStages, step } from "./simulate";
import { interpretInput } from "./states";
import { Btn, CONTROL_STICK_JUMP_OFF } from "./types";
import type { FighterState, GameState, InputFrame, MatchRules } from "./types";

/** Just what `interpretInput` reads: the press tracking and the control options. */
function tracking(controls: number, framesSinceDirPress: number): FighterState {
  return { lastDirPressed: Btn.Up, framesSinceDirPress, combat: { ...emptyCombat(), controls } } as unknown as FighterState;
}

describe("stick jump (Plan 5)", () => {
  it("jumps off an up flick by default, Ultimate's Stick Jump on", () => {
    const i = interpretInput(tracking(0, 5), Btn.Up, Btn.Up);
    expect(i.jumpPressed).toBe(true);
    expect(i.jumpHeld).toBe(true);
  });

  it("does neither with Stick Jump off: up is only up", () => {
    const i = interpretInput(tracking(CONTROL_STICK_JUMP_OFF, 5), Btn.Up, Btn.Up);
    expect(i.jumpPressed).toBe(false);
    expect(i.jumpHeld).toBe(false);
    expect(i.y).toBe(1);
  });

  it("still jumps on the jump button either way", () => {
    expect(interpretInput(tracking(CONTROL_STICK_JUMP_OFF, 20), Btn.Jump, 0).jumpPressed).toBe(true);
  });

  it("never jumps off a soft Up, Stick Jump on or off: a tilt short of the flick only aims (P5-R27)", () => {
    for (const controls of [0, CONTROL_STICK_JUMP_OFF]) {
      const i = interpretInput(tracking(controls, 5), Btn.Up | Btn.Soft, Btn.Up | Btn.Soft);
      expect(i.jumpPressed, `controls ${controls}`).toBe(false);
      expect(i.jumpHeld, `controls ${controls}`).toBe(false);
      expect(i.y, `controls ${controls}`).toBe(1);
    }
  });

  it("leaves the jump button's own press alone, Stick Jump off or a soft Up held: a mash counts it", () => {
    const i = interpretInput(tracking(CONTROL_STICK_JUMP_OFF, 20), Btn.Jump | Btn.Up | Btn.Soft, Btn.Up | Btn.Soft);
    expect(i.jumpButtonPressed).toBe(true);
    expect(i.jumpHeld).toBe(true);
  });
});

/* -------------------------------------------------- through the real step -- */

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** Port 0 presses `inputs`, and port 1 (if any) nothing; every frame's state. */
function run(s0: GameState, inputs: readonly InputFrame[]): GameState[] {
  let s = s0;
  let prev: readonly InputFrame[] = s0.fighters.map(() => 0);
  const out: GameState[] = [];
  for (const i of inputs) {
    const now = s0.fighters.map((_, port) => (port === 0 ? i : 0));
    s = step(s, now, { prevInputs: prev }).state;
    prev = now;
    out.push(s);
  }
  return out;
}

const idle = (n: number): InputFrame[] => Array<InputFrame>(n).fill(0);

/** Mario on Final Destination with `controls`, landed from the entry drop and standing. */
function standing(controls: number): GameState {
  const s = createInitialState("finalDestination", [{ defId: "mario", controls }], RULES, 3);
  const landed = run(s, idle(40)).at(-1)!;
  expect(landed.fighters[0].action).toBe("stand");
  return landed;
}

/**
 * Fox launched at Final Destination's right wall below the floor, tumbling, with
 * a shield press on the first frame: a wall tech, as `walljump.test.ts`'s
 * `intoTheWall`, with his control options.
 */
function intoTheWall(controls: number): GameState {
  const s = createInitialState("finalDestination", [{ defId: "fox", controls }], RULES, 3);
  const f = s.fighters[0];
  Object.assign(f, { x: fx(100), y: fx(-20), grounded: false, platform: -1, action: "tumble", actionFrame: 0, hitstun: 60, intangible: 0, invincible: 0, jumpsUsed: 1 });
  kineticLaunch(f, -fx(4), 0, fx(4));
  return s;
}

describe("stick jump in the simulation (Plan 5)", () => {
  it("is the player's selection, carried into the match; the default is 0", () => {
    const s = createInitialState("finalDestination", [{ defId: "mario", controls: CONTROL_STICK_JUMP_OFF }, { defId: "fox" }], RULES, 3);
    expect(s.fighters.map((f) => f.combat.controls)).toEqual([CONTROL_STICK_JUMP_OFF, 0]);
  });

  it("holding Up on the stage jumps with it on, and never with it off", () => {
    const leaves = (controls: number) => run(standing(controls), Array<InputFrame>(30).fill(Btn.Up)).some((q) => !q.fighters[0].grounded);
    expect(leaves(0)).toBe(true);
    expect(leaves(CONTROL_STICK_JUMP_OFF)).toBe(false);
  });

  /**
   * SmashWiki "Tech" (https://www.ssbwiki.com/Tech): "If a jump input is active
   * when a wall tech is performed (such as holding up or pressing a jump button),
   * then the teching character will wall jump". With Stick Jump off a held Up is
   * no jump input, so it is no wall tech jump either (the Task 10 review's carry);
   * the jump button still is.
   */
  it("stops a held Up from wall-tech-jumping with it off; the jump button still wall-tech-jumps", () => {
    const heldIntoTheTech = (controls: number, key: InputFrame): GameState[] => {
      const states = run(intoTheWall(controls), [Btn.Shield, ...Array<InputFrame>(30).fill(key)]);
      expect(states.some((q) => q.fighters[0].action === "techWall"), `a wall tech, ${controls}, ${key}`).toBe(true);
      return states;
    };
    const wallJumped = (states: GameState[]) => states.some((q) => q.fighters[0].combat.wallJumps > 0);
    expect(wallJumped(heldIntoTheTech(0, Btn.Up))).toBe(true);
    expect(wallJumped(heldIntoTheTech(CONTROL_STICK_JUMP_OFF, Btn.Up))).toBe(false);
    expect(wallJumped(heldIntoTheTech(CONTROL_STICK_JUMP_OFF, Btn.Jump))).toBe(true);
    // A soft Up is no jump input whatever the option (P5-R27).
    expect(wallJumped(heldIntoTheTech(0, Btn.Up | Btn.Soft))).toBe(false);
  });

  it("survive a KO and the respawn: they are the player's, not the stock's", () => {
    const s = createInitialState("finalDestination", [{ defId: "mario", controls: CONTROL_STICK_JUMP_OFF }, { defId: "fox" }], RULES, 3);
    Object.assign(s.fighters[0], { action: "fall", actionFrame: 0, grounded: false, platform: -1, intangible: 0, x: fx(300), y: fx(20) });
    const ko = step(s, [0, 0], { prevInputs: [0, 0] });
    expect(ko.events.kos.map((k) => k.port)).toEqual([0]);
    expect(ko.state.fighters[0].combat.controls).toBe(CONTROL_STICK_JUMP_OFF);
    let after = ko.state;
    for (let i = 0; i < 600 && (after.fighters[0].action === "dead" || after.fighters[0].action === "respawnPlatform"); i++) {
      after = step(after, [0, 0], { prevInputs: [0, 0] }).state;
    }
    expect(after.fighters[0].stocks).toBe(2);
    expect(["dead", "respawnPlatform"]).not.toContain(after.fighters[0].action);
    expect(after.fighters[0].combat.controls).toBe(CONTROL_STICK_JUMP_OFF);
  });
});
