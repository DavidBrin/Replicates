/**
 * Edge slipping (Plan 6, Task 7). SmashWiki "Edge slipping"
 * (https://www.ssbwiki.com/Edge_slipping): knocked off a platform "while they were still
 * on their feet", one facing forward is "free to perform any action immediately"; one
 * slipping "in the reverse direction they were looking" is locked out for its fighter's
 * frames (Ultimate: Mario 26, Donkey Kong 25, Pikachu 25), may "DI the fall left or right
 * after the eighth frame", and in Ultimate can tech; "If the edge is grabbable, then they
 * will always grab it".
 *
 * The slip is entered on contact (phase 5, `onLeftGround`), as a landing is: the step it
 * starts on is its `actionFrame` 0, the frame before its frame 1, so its frame n is
 * `actionFrame` n, and a lockout of N frames ends on `actionFrame` N, acting on the next.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx } from "@/engine/fixed";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { emptyKinetic } from "@/engine/kinetic";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules } from "@/engine/types";
import { BATTLEFIELD_UPPER_PLATFORM_Y } from "@/stages/battlefield";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/**
 * `who` standing on `stage`'s platform `platform` at x, facing `facing`, pushed along x at
 * `push` a frame on the DAMAGE energy (as a windbox leaves it); Fox parked far away.
 */
function pushed(who: string, stage: string, platform: number, x: number, y: number, facing: number, push: number): GameState {
  const s = createInitialState(stage, [{ defId: who }, { defId: "fox" }], RULES, 5);
  Object.assign(s.fighters[0], {
    action: "stand", actionFrame: 10, grounded: true, platform, x, y, facing, intangible: 0,
    vx: push, kinetic: { ...emptyKinetic(), damageX: push },
  });
  Object.assign(s.fighters[1], { action: "stand", grounded: true, platform: 0, x: -fx(60), y: 0, intangible: 0 });
  return s;
}

/**
 * `who` as `onLeftGround` leaves a slipping fighter (`actionFrame` 0), 80 over Final
 * Destination's centre, at rest: no floor is in reach for longer than any lockout, so the
 * lockout is read alone. State `i` of a run from here is the slip's frame `i + 1`.
 */
function slipping(who: string): GameState {
  const s = pushed(who, "finalDestination", 0, 0, fx(80), -1, 0);
  Object.assign(s.fighters[0], { action: "edgeSlip", actionFrame: 0, grounded: false, platform: -1, vx: 0, vy: 0, kinetic: emptyKinetic() });
  return s;
}

function run(s0: GameState, frames: number, input: (i: number) => InputFrame = () => 0): GameState[] {
  let s = s0;
  let prev: InputFrame[] = [0, 0];
  const out: GameState[] = [];
  for (let i = 0; i < frames; i++) {
    const now: InputFrame[] = [input(i), 0];
    s = step(s, now, { prevInputs: prev }).state;
    prev = now;
    out.push(s);
  }
  return out;
}

const upper = (): number => STAGES.find((st) => st.id === "battlefield")!.platforms.findIndex((p) => p.y === BATTLEFIELD_UPPER_PLATFORM_Y);
/** Battlefield's top platform's right end. */
const TOP_RIGHT = fx(17.3165);

describe("edge slipping (Plan 6, Task 7)", () => {
  it("pushed backward off a soft platform's end on its feet: the edge slip, on the step it leaves the ground", () => {
    const [first] = run(pushed("mario", "battlefield", upper(), TOP_RIGHT - fx(1), BATTLEFIELD_UPPER_PLATFORM_Y, -1, fx(1.5)), 1);
    expect(first.fighters[0].grounded).toBe(false);
    expect(first.fighters[0].action).toBe("edgeSlip");
  });

  it("pushed forward off the same edge: a fall, free to act", () => {
    const [first] = run(pushed("mario", "battlefield", upper(), TOP_RIGHT - fx(1), BATTLEFIELD_UPPER_PLATFORM_Y, 1, fx(1.5)), 1);
    expect(first.fighters[0].action).toBe("fall");
  });

  it("lifted off the platform's middle with the push behind it: a fall, not a slip", () => {
    const s = pushed("mario", "battlefield", upper(), 0, BATTLEFIELD_UPPER_PLATFORM_Y, -1, fx(1.5));
    Object.assign(s.fighters[0], { vy: fx(1), kinetic: { ...emptyKinetic(), damageX: fx(1.5), gravityY: fx(1) } });
    const [first] = run(s, 1);
    expect(first.fighters[0].grounded).toBe(false);
    expect(first.fighters[0].action).toBe("fall");
  });

  it("locks Mario out for 26 frames: frames 1-25 slipping, the fall on frame 26", () => {
    const states = run(slipping("mario"), 30);
    for (let i = 0; i <= 24; i++) expect(states[i].fighters[0].action, `slip frame ${i + 1}`).toBe("edgeSlip");
    expect(states[25].fighters[0].action, "slip frame 26").toBe("fall");
  });

  it("locks Donkey Kong and Pikachu out for 25", () => {
    for (const who of ["donkeyKong", "pikachu"]) {
      const states = run(slipping(who), 30);
      expect(states[23].fighters[0].action, `${who} slip frame 24`).toBe("edgeSlip");
      expect(states[24].fighters[0].action, `${who} slip frame 25`).toBe("fall");
    }
  });

  it("keeps an Attack pressed on its last frame, and swings it on the first frame after", () => {
    const states = run(slipping("mario"), 30, (i) => (i === 25 ? Btn.Attack : 0));
    expect(states.slice(0, 25).every((st) => st.fighters[0].action === "edgeSlip")).toBe(true);
    expect(states[25].fighters[0].action, "slip frame 26, the press").toBe("fall");
    expect(states[26].fighters[0].action, "the first frame after").toBe("attack");
  });

  // "Unable to perform any action" (SmashWiki "Edge slipping"; final wave, item 28): a press in
  // the middle of the lockout starts nothing. Slip frame 10 is the run's state 9.
  it.each([
    ["Jump", Btn.Jump],
    ["Attack", Btn.Attack],
    ["Special", Btn.Special],
    ["Grab", Btn.Grab],
  ] as const)("a press of %s on slip frame 10 leaves it slipping through frame 25", (_name, press) => {
    const states = run(slipping("mario"), 26, (i) => (i === 9 ? press : 0));
    for (let i = 0; i <= 24; i++) expect(states[i].fighters[0].action, `slip frame ${i + 1}`).toBe("edgeSlip");
    expect(states[25].fighters[0].action, "slip frame 26").toBe("fall");
  });

  it("drifts with the stick only after its eighth frame", () => {
    const states = run(slipping("mario"), 12, () => Btn.Left);
    expect(states[7].fighters[0].kinetic.controlX, "slip frame 8").toBe(0);
    expect(states[8].fighters[0].kinetic.controlX, "slip frame 9").toBeLessThan(0);
  });

  it("lands lying down without a tech, and techs on a timely shield press (Ultimate)", () => {
    // Already slipping, on its sixth frame, three units over Final Destination and falling:
    // it reaches the floor inside its lockout.
    const low = (): GameState => {
      const s = pushed("mario", "finalDestination", 0, 0, fx(3), -1, 0);
      Object.assign(s.fighters[0], {
        action: "edgeSlip", actionFrame: 5, grounded: false, platform: -1, vx: 0, vy: -fx(1.5),
        kinetic: { ...emptyKinetic(), gravityY: -fx(1.5) },
      });
      return s;
    };
    const lies = run(low(), 6);
    expect(lies.map((st) => st.fighters[0].action)).toContain("downed");
    const techs = run(low(), 6, (i) => (i === 0 ? Btn.Shield : 0));
    expect(techs.some((st) => /^tech/.test(st.fighters[0].action))).toBe(true);
  });

  it("Review Focus: slipping off a ledge-bearing edge hangs on the ledge", () => {
    // Pushed off Final Destination's right edge backward: the ledge is taken on the step it
    // leaves the ground (`findLedgeGrab` runs after `onLeftGround`), never fallen past.
    const [first] = run(pushed("mario", "finalDestination", 0, fx(79), 0, -1, fx(1.5)), 1);
    expect(first.fighters[0].action).toBe("ledgeHang");
    // Already slipping, in its lockout, just outboard of that ledge and under it: it hangs.
    const s = pushed("mario", "finalDestination", 0, fx(81), -fx(2), -1, 0);
    Object.assign(s.fighters[0], {
      action: "edgeSlip", actionFrame: 5, grounded: false, platform: -1, vx: 0, vy: -fx(0.5),
      kinetic: { ...emptyKinetic(), gravityY: -fx(0.5) },
    });
    expect(run(s, 3).some((st) => st.fighters[0].action === "ledgeHang")).toBe(true);
  });
});
