/**
 * Grab pressed in the air (Plan 6, Task 8). SmashWiki "Air dodge": "the grab button
 * (when used in midair by a character without a grab aerial)" air-dodges; SmashWiki
 * "Grab aerial": with one, "simply pressing the grab button while in the air" uses it.
 * Samus's: SmashWiki "Samus (SSBU)/Grab aerial" and rubendal 13.0.1 `game_aircatch`.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx, toFloat } from "@/engine/fixed";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules, StepEvents } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** `who` 40 units over Final Destination's centre, falling, facing right; the other fighter at `otherX`, `otherY`. */
function airborne(who: string, other = "mario", otherX = fx(60), otherY = 0): GameState {
  const s = createInitialState("finalDestination", [{ defId: who }, { defId: other }], RULES, 5);
  Object.assign(s.fighters[0], { action: "fall", actionFrame: 10, grounded: false, platform: -1, x: 0, y: fx(40), facing: 1, intangible: 0, jumpsUsed: 1, airDodged: false });
  Object.assign(s.fighters[1], { action: "fall", actionFrame: 10, grounded: false, platform: -1, x: otherX, y: otherY === 0 ? fx(40) : otherY, facing: -1, intangible: 0, invincible: 0 });
  return s;
}

function run(s0: GameState, inputs: readonly InputFrame[]): { states: GameState[]; events: StepEvents[] } {
  let s = s0;
  let prev: InputFrame[] = [0, 0];
  const states: GameState[] = [];
  const events: StepEvents[] = [];
  for (const i of inputs) {
    const now: InputFrame[] = [i, 0];
    const out = step(s, now, { prevInputs: prev });
    s = out.state;
    prev = now;
    states.push(s);
    events.push(out.events);
  }
  return { states, events };
}

describe("Grab in the air (Plan 6, Task 8)", () => {
  it("air-dodges a fighter without a grab aerial, as Shield does", () => {
    for (const who of ["mario", "donkeyKong", "link", "kirby", "fox", "pikachu", "marth"]) {
      const { states } = run(airborne(who), [Btn.Grab]);
      expect(states[0].fighters[0].action, who).toBe("airDodge");
    }
  });

  it("uses the air dodge it spends: a second Grab in the same airtime does nothing", () => {
    const s = airborne("mario");
    s.fighters[0].airDodged = true;
    const { states } = run(s, [Btn.Grab]);
    expect(states[0].fighters[0].action).toBe("fall");
  });

  it("is Samus's grab aerial: two electric hits, 2.5% on 8-15 and 4% on 16-19", () => {
    const { states } = run(airborne("samus"), [Btn.Grab]);
    expect(states[0].fighters[0].action).toBe("attack");
    expect(states[0].fighters[0].move).toBe("airGrab");
    const zair = FIGHTERS.find((d) => d.id === "samus")!.moves.airGrab!;
    expect(zair.totalFrames).toBe(59);
    expect(zair.landingLag).toBe(8);
    expect(zair.hitboxes.map((h) => [h.startFrame, h.endFrame, toFloat(h.damage), h.part ?? 0])).toEqual([
      [8, 15, 2.5, 0],
      [16, 19, 4, 1],
    ]);
  });

  it("Samus's grab aerial lands both hits on Mario in front of her (part 1 may follow part 0)", () => {
    // Hit 2 comes 8 frames after hit 1's electric freeze (9 steps): step 25 of the run.
    const { events } = run(airborne("samus", "mario", fx(13), fx(40)), [Btn.Grab, ...Array<InputFrame>(39).fill(0)]);
    const hits = events.flatMap((e) => e.hits.filter((h) => h.attacker === 0));
    expect(hits.length).toBe(2);
  });

  it("gives way to nothing a wall jump or footstool would take (R-T10e): airActionFirst says yes for Grab", async () => {
    const { airActionFirst, interpretInput } = await import("@/engine/states");
    const s = airborne("mario");
    const f = s.fighters[0];
    const intent = interpretInput(f, Btn.Grab, 0);
    const ctx = { def: FIGHTERS.find((d) => d.id === "mario")!, stage: STAGES.find((st) => st.id === "finalDestination")!, frame: s.frame, fighters: s.fighters };
    expect(airActionFirst(f, intent, ctx)).toBe(true);
  });
});
