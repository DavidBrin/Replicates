/**
 * A right-stick flick, and Attack, out of shield, and a flick while holding someone (Plan 6,
 * Task 5), through `step()` on the real roster. SmashWiki "C-Stick"
 * (https://www.ssbwiki.com/C-Stick): "The C-Stick can also be used to roll or sidestep out of
 * shield"; SmashWiki "Out of shield" (https://www.ssbwiki.com/Out_of_shield): flicking it
 * "upward while shielding" is "an immediate up smash out of shield", and the stick's up smash
 * comes "with an up smash input". SmashWiki "Grab" (https://www.ssbwiki.com/Grab): a grab "can
 * be performed by pressing the shield and attack buttons simultaneously" (ruling R-P6-14). In a
 * grab the flick throws its way (ruling D1, UNVERIFIED: no page says whether the hold reads the
 * stick or the button first).
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx } from "@/engine/fixed";
import { ROLL_BACK, ROLL_FORWARD } from "@/engine/groundDodge";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** A smash-mode flick's fire frame: its direction and Attack fresh, with `Btn.Flick`. */
const flick = (dir: Btn, held: InputFrame = 0): InputFrame => held | dir | Btn.Attack | Btn.Flick;

/** Mario on Final Destination, facing right, in `action`, Fox standing well away. */
function mario(over: Partial<GameState["fighters"][number]>): GameState {
  const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], RULES, 5);
  Object.assign(s.fighters[0], { grounded: true, platform: 0, x: 0, y: 0, facing: 1, intangible: 0, ...over });
  Object.assign(s.fighters[1], { grounded: true, platform: 0, x: fx(60), y: 0, facing: -1, intangible: 0 });
  return s;
}

/** Step port 0 through `inputs`, port 1 idle; the state after each step. */
function run(s0: GameState, inputs: readonly InputFrame[]): GameState[] {
  let s = s0;
  let prev: InputFrame[] = [0, 0];
  const out: GameState[] = [];
  for (const i of inputs) {
    const now: InputFrame[] = [i, 0];
    s = step(s, now, { prevInputs: prev }).state;
    prev = now;
    out.push(s);
  }
  return out;
}

/** Mario's pummel, in frames (the move's own length: `STATUS_CATCH_ATTACK` ends on it). */
const PUMMEL_FRAMES = FIGHTERS.find((f) => f.id === "mario")?.moves.pummel?.totalFrames ?? 0;

/** Steps port 0 one frame at a time, holding the previous inputs: for a test that reacts to the state. */
function player(s0: GameState) {
  let s = s0;
  let prev: InputFrame[] = [0, 0];
  return {
    get state(): GameState {
      return s;
    },
    tick(i: InputFrame = 0): GameState {
      const now: InputFrame[] = [i, 0];
      s = step(s, now, { prevInputs: prev }).state;
      prev = now;
      return s;
    },
  };
}

describe("out of shield (Plan 6, Task 5)", () => {
  const shielding = () => mario({ action: "shield", actionFrame: 10 });

  it("a flick rolls the way it is flicked", () => {
    const [after] = run(shielding(), [Btn.Shield | flick(Btn.Right)]);
    expect(after.fighters[0].action).toBe("roll");
    // Mario faces right: a right flick is the forward roll (`charge` ROLL_FORWARD), moving right.
    expect(after.fighters[0].charge).toBe(ROLL_FORWARD);
    expect(after.fighters[0].vx).toBeGreaterThan(0);
  });

  it("a flick the other way rolls back: the way is the flick's, not the facing's (Final wave, item 24)", () => {
    const [after] = run(shielding(), [Btn.Shield | flick(Btn.Left)]);
    expect(after.fighters[0].action).toBe("roll");
    expect(after.fighters[0].charge).toBe(ROLL_BACK);
    expect(after.fighters[0].vx).toBeLessThan(0);
  });

  it("a flick down spot-dodges", () => {
    const [after] = run(shielding(), [Btn.Shield | flick(Btn.Down)]);
    expect(after.fighters[0].action).toBe("spotDodge");
  });

  it("a flick up up-smashes", () => {
    const [after] = run(shielding(), [Btn.Shield | flick(Btn.Up)]);
    expect(after.fighters[0].action).toBe("attack");
    expect(after.fighters[0].move).toBe("usmash");
  });

  it("Attack alone grabs: shield and attack together (SmashWiki \"Grab\"; ruling R-P6-14)", () => {
    const [after] = run(shielding(), [Btn.Shield | Btn.Attack]);
    expect(after.fighters[0].action).toBe("grab");
  });

  it("Up and Attack together up-smash: the stick's up smash input (SmashWiki \"Out of shield\")", () => {
    const [after] = run(shielding(), [Btn.Shield | Btn.Up | Btn.Attack]);
    expect(after.fighters[0].action).toBe("attack");
    expect(after.fighters[0].move).toBe("usmash");
  });
});

describe("a flick buffered in shieldstun fires out of shield (Plan 6, Task 5; final wave item 25)", () => {
  /** Mario in shieldstun with 4 frames left, shield held throughout: the next frames are `shield`. */
  function stunned(): GameState {
    return mario({ action: "shieldStun", actionFrame: 6, hitstun: 4 });
  }

  /** Flick `dir` on the stunned shield's first frame, then hold the shield until the status acts. */
  function flickInStun(dir: Btn) {
    const p = player(stunned());
    p.tick(Btn.Shield | flick(dir));
    expect(p.state.fighters[0].action).toBe("shieldStun");
    expect(p.state.fighters[0].bufferedAction).not.toBeNull();
    // The press is made before it can act; hold the shield only, and let the stun run out.
    for (let i = 0; i < 12 && p.state.fighters[0].action === "shieldStun"; i++) p.tick(Btn.Shield);
    expect(p.state.fighters[0].action).toBe("shield");
    // The shield's first frame reads the buffered press with its flick.
    p.tick(Btn.Shield);
    return p;
  }

  it("a down flick made in shieldstun spot-dodges when the shield comes up, not a grab", () => {
    const p = flickInStun(Btn.Down);
    expect(p.state.fighters[0].action).toBe("spotDodge");
  });

  it("a sideways flick made in shieldstun rolls that way when the shield comes up", () => {
    const p = flickInStun(Btn.Left);
    expect(p.state.fighters[0].action).toBe("roll");
    expect(p.state.fighters[0].charge).toBe(ROLL_BACK);
  });

  it("an up flick made in shieldstun up-smashes when the shield comes up", () => {
    const p = flickInStun(Btn.Up);
    expect(p.state.fighters[0].action).toBe("attack");
    expect(p.state.fighters[0].move).toBe("usmash");
  });

  it("control: Attack alone made in shieldstun is a grab when the shield comes up", () => {
    const p = player(stunned());
    p.tick(Btn.Shield | Btn.Attack);
    for (let i = 0; i < 12 && p.state.fighters[0].action === "shieldStun"; i++) p.tick(Btn.Shield);
    p.tick(Btn.Shield);
    expect(p.state.fighters[0].action).toBe("grab");
  });
});

describe("a flick while holding someone (Plan 6, Task 5; ruling D1)", () => {
  function holding(): GameState {
    const s = mario({ action: "grabHold", actionFrame: 0, x: fx(-4), grabbing: 1 });
    Object.assign(s.fighters[1], { action: "grabbed", actionFrame: 0, x: fx(4), facing: -1, grabbedBy: 0, grabTimer: 500 });
    return s;
  }

  it("throws the way it is flicked: down is the down throw", () => {
    const [after] = run(holding(), [flick(Btn.Down)]);
    expect(after.fighters[0].action).toBe("throw");
    expect(after.fighters[0].move).toBe("dthrow");
  });

  it("back is the back throw", () => {
    const [after] = run(holding(), [flick(Btn.Left)]);
    expect(after.fighters[0].move).toBe("bthrow");
  });

  it("Attack alone still pummels", () => {
    const [after] = run(holding(), [Btn.Attack]);
    expect(after.fighters[0].action).toBe("pummel");
  });

  it("a flick made late in a pummel throws its way when the hold resumes (final wave item 25)", () => {
    const p = player(holding());
    p.tick(Btn.Attack);
    expect(p.state.fighters[0].action).toBe("pummel");
    // Idle until the pummel's last frames, then flick down inside its buffer window.
    const total = PUMMEL_FRAMES;
    while (p.state.fighters[0].action === "pummel" && p.state.fighters[0].actionFrame < total - 3) p.tick();
    expect(p.state.fighters[0].action).toBe("pummel");
    p.tick(flick(Btn.Down));
    // The hold resumes on the pummel's last frame and reads the buffered press with its flick at
    // once: the down throw, not another pummel.
    for (let i = 0; i < 8 && p.state.fighters[0].action === "pummel"; i++) p.tick();
    expect(p.state.fighters[0].action).toBe("throw");
    expect(p.state.fighters[0].move).toBe("dthrow");
  });

  it("control: Attack made late in a pummel pummels again when the hold resumes", () => {
    const p = player(holding());
    p.tick(Btn.Attack);
    const total = PUMMEL_FRAMES;
    while (p.state.fighters[0].action === "pummel" && p.state.fighters[0].actionFrame < total - 3) p.tick();
    p.tick(Btn.Attack);
    const first = p.state.fighters[0].actionFrame;
    for (let i = 0; i < 8 && p.state.fighters[0].actionFrame >= first; i++) p.tick();
    // A second pummel started: the action frame restarted at the hold.
    expect(p.state.fighters[0].action).toBe("pummel");
    expect(p.state.fighters[0].actionFrame).toBeLessThan(first);
  });
});
