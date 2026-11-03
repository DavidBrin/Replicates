/**
 * The reverse smash (Plan 6, Task 6): a forward smash pressed toward a grounded
 * fighter's back turns it round and swings that way. SmashWiki "Forward smash"
 * (https://www.ssbwiki.com/Forward_smash): "tapping the control stick in a horizontal
 * direction and pressing the attack button immediately afterward or simultaneously, or
 * by tilting the C-stick in a horizontal direction". UNVERIFIED: the turn's timing
 * (none published); it is the frame the smash starts.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx } from "@/engine/fixed";
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

/** Mario standing at the centre of Final Destination, facing right; Fox at `foxX`. */
function standing(foxX = fx(60)): GameState {
  const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], RULES, 5);
  Object.assign(s.fighters[0], { action: "stand", actionFrame: 10, grounded: true, platform: 0, x: 0, y: 0, facing: 1, intangible: 0 });
  Object.assign(s.fighters[1], { action: "stand", actionFrame: 10, grounded: true, platform: 0, x: foxX, y: 0, facing: -1, intangible: 0, invincible: 0 });
  return s;
}

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

describe("the reverse smash (Plan 6, Task 6)", () => {
  it("back and Attack on one frame: a forward smash, turned round", () => {
    const [after] = run(standing(), [Btn.Left | Btn.Attack]);
    expect(after.fighters[0].move).toBe("fsmash");
    expect(after.fighters[0].facing).toBe(-1);
  });

  it("a right-stick flick backward: the same", () => {
    const [after] = run(standing(), [Btn.Left | Btn.Attack | Btn.Flick]);
    expect(after.fighters[0].move).toBe("fsmash");
    expect(after.fighters[0].facing).toBe(-1);
  });

  it("a buffered back flick out of landing lag (Task 5's buffer): turned round too", () => {
    const s = standing();
    Object.assign(s.fighters[0], { action: "landingLag", actionFrame: 0, charge: 6 });
    const states = run(s, [Btn.Left | Btn.Attack | Btn.Flick, ...Array<InputFrame>(8).fill(0)]);
    const swing = states.find((st) => st.fighters[0].move === "fsmash");
    expect(swing?.fighters[0].facing).toBe(-1);
  });

  it("forward and Attack is unchanged: a forward smash, still facing right", () => {
    const [after] = run(standing(), [Btn.Right | Btn.Attack]);
    expect(after.fighters[0].move).toBe("fsmash");
    expect(after.fighters[0].facing).toBe(1);
  });

  it("lands on a fighter behind: Fox 12 units back is hit and sent left", () => {
    const states = run(standing(-fx(12)), [Btn.Left | Btn.Attack, ...Array<InputFrame>(40).fill(Btn.Left)]);
    const hit = states.findIndex((st) => st.fighters[1].damage > 0);
    expect(hit).toBeGreaterThan(0);
    const later = states[Math.min(states.length - 1, hit + 25)];
    expect(later.fighters[1].x).toBeLessThan(-fx(12));
  });

  it("back and Attack with Tilt held: a forward tilt, not turned (as at 46e0706; SPEC §6, never a smash)", () => {
    const [after] = run(standing(), [Btn.Left | Btn.Attack | Btn.Soft]);
    expect(after.fighters[0].move).toBe("ftilt");
    expect(after.fighters[0].facing).toBe(1);
  });

  // Reverse smash never turns (final wave, item 26): the turn is only for a forward smash. A
  // run or an initial dash gives the dash attack, a crouch without a flick the down tilt, and
  // neither turns the fighter round.
  it.each([
    ["run", "dashAttack"],
    ["dashStart", "dashAttack"],
    ["crouch", "dtilt"],
    ["crouchStart", "dtilt"],
    ["crawl", "dtilt"],
  ] as const)("back and Attack out of %s: the %s, still facing right", (action, move) => {
    const s = standing();
    Object.assign(s.fighters[0], { action, actionFrame: 10 });
    const [after] = run(s, [Btn.Left | Btn.Attack]);
    expect(after.fighters[0].move).toBe(move);
    expect(after.fighters[0].facing).toBe(1);
  });
});
