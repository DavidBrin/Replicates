/**
 * The specials that are made of movement, driven through the real simulation.
 *
 * ## Why this file exists
 *
 * `MoveDef.momentum` and `MoveDef.superArmourFrames` were both in the type from
 * the start, both used by the roster, and both read by nothing. The visible
 * consequence was that **no fighter could recover**: up-special played its
 * animation and left you exactly where you were, so every hit that sent you off
 * the stage was a stock, for all eight fighters, from the first match.
 *
 * Nothing caught it, and the reason is worth stating. Every unit test around it
 * passed: the frame data was well-formed, `specialSlot` returned `"upB"` for an
 * up input, the state machine entered `special`, the animation played. The
 * property nobody had written down is the one a player would notice in ten
 * seconds — that pressing up-special off the side of the stage gets you back.
 *
 * So these tests run the actual `step()` loop with the actual roster and assert
 * on where the fighter ends up. Nothing here inspects `momentum` directly; a
 * test that read the same table the code reads would pass just as happily
 * against an engine that ignored it, which is exactly the failure that shipped.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { fx, toFloat } from "@/engine/fixed";
import { Btn } from "@/engine/types";
import type { FighterState, GameState, InputFrame, MatchRules } from "@/engine/types";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { FIGHTERS } from "./index";
import { STAGES } from "@/stages";

const RULES: MatchRules = {
  mode: "stock",
  stocks: 3,
  timeLimit: 60 * 60 * 7,
  smashBall: false,
  oneOnOne: false,
};

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** One fighter, alone, dropped into the air well above the stage. */
function airborne(defId: string): GameState {
  const state = createInitialState("finalDestination", [{ defId }], RULES, 0x51de);
  const f = state.fighters[0];
  f.action = "fall";
  f.actionFrame = 0;
  f.grounded = false;
  f.platform = -1;
  f.x = fx(0);
  f.y = fx(70);
  f.vx = 0;
  f.vy = 0;
  f.facing = 1;
  return state;
}

/**
 * Run `frames` of simulation on one input, reporting every frame.
 *
 * The input is held rather than tapped because that is how a recovery is
 * actually done, and because a special that only moved you on the frame it was
 * pressed would pass a one-frame check and still be useless.
 */
function run(state: GameState, input: InputFrame, frames: number): FighterState[] {
  let s = state;
  let prev: InputFrame = 0;
  const seen: FighterState[] = [];
  for (let i = 0; i < frames; i++) {
    const result = step(s, [input], { prevInputs: [prev] });
    s = result.state;
    prev = input;
    seen.push(s.fighters[0]);
  }
  return seen;
}

const UP_SPECIAL = Btn.Up | Btn.Special;

describe("every fighter can recover", () => {
  for (const fighter of FIGHTERS) {
    it(`${fighter.id}'s up-special gains height`, () => {
      const state = airborne(fighter.id);
      const startY = toFloat(state.fighters[0].y);

      const frames = run(state, UP_SPECIAL, 90);
      const peak = Math.max(...frames.map((f) => toFloat(f.y)));

      // A fighter falls under gravity from the first frame, so merely "did not
      // go down" would be a real result. The bar is a fighter's own height:
      // less than that is not a recovery, it is a stumble.
      expect(peak - startY, `${fighter.id} rose ${(peak - startY).toFixed(1)}`).toBeGreaterThan(13);
    });

    it(`${fighter.id}'s up-special enters the special state at all`, () => {
      // Guards the test above against passing for the wrong reason: if the
      // input never reached the move, a fighter who happened to drift upward
      // would still look like a recovery.
      const frames = run(airborne(fighter.id), UP_SPECIAL, 10);
      expect(frames.some((f) => f.action === "special" && f.move === "upB")).toBe(true);
    });
  }
});

describe("Kirby's Stone is a stone", () => {
  it("falls markedly faster than Kirby otherwise does", () => {
    // Against his own fast fall, not against a constant: the claim is that the
    // rock is heavy, and "heavy" only means anything relative to the puffball.
    // Twenty frames, which is short enough that neither run has reached the
    // ground — a comparison that ends with both of them stopped on the floor
    // measures the floor, not the fall.
    const fastFalling = run(airborne("kirby"), Btn.Down, 20);
    const stone = run(airborne("kirby"), Btn.Down | Btn.Special, 20);

    // Terminal speed, not distance travelled: distance mixes in however long
    // the transformation takes, so it understates the difference and would
    // still pass if the Stone fell at a brisk walk.
    const fastest = (frames: FighterState[]) => Math.min(...frames.map((f) => toFloat(f.vy)));
    expect(fastest(stone)).toBeLessThan(fastest(fastFalling) * 1.8);

    const dropOf = (frames: FighterState[]) => 70 - Math.min(...frames.map((f) => toFloat(f.y)));
    expect(dropOf(stone)).toBeGreaterThan(dropOf(fastFalling));
  });

  it("sits still on the ground rather than falling out of the world", () => {
    const state = createInitialState("finalDestination", [{ defId: "kirby" }], RULES, 11);
    const f = state.fighters[0];
    f.action = "stand";
    f.actionFrame = 0;
    f.grounded = true;
    f.platform = 0;
    f.intangible = 0;
    f.x = 0;
    f.y = 0;

    const frames = run(state, Btn.Down | Btn.Special, 40);
    const lowest = Math.min(...frames.map((g) => toFloat(g.y)));
    expect(lowest).toBeGreaterThanOrEqual(-0.001);
  });

  it("shrugs off a hit instead of being launched by it", () => {
    // The armour is the move. Kirby drops through the middle of a fight and the
    // point is that nothing stops him — he takes the damage and keeps going.
    const state = createInitialState("finalDestination", [{ defId: "kirby" }, { defId: "mario" }], RULES, 7);
    const kirby = state.fighters[0];
    const mario = state.fighters[1];

    kirby.action = "special";
    kirby.move = "downB";
    // Inside the armour window declared on the move.
    kirby.actionFrame = 20;
    kirby.grounded = true;
    kirby.x = fx(0);
    kirby.y = 0;
    // Fighters spawn intangible, and an intangible victim is skipped before
    // armour is ever consulted — so without this the test would pass by
    // reporting no hit at all, which is the opposite of what it claims.
    kirby.intangible = 0;
    kirby.invincible = 0;

    mario.action = "attack";
    mario.move = "fsmash";
    mario.actionFrame = 14;
    mario.grounded = true;
    mario.x = fx(-7);
    mario.y = 0;
    mario.facing = 1;
    mario.hitThisMove = [];

    const after = step(state, [0, 0], { prevInputs: [0, 0] });
    const hitKirby = after.state.fighters[0];

    expect(after.events.hits.length, "the hit should still land").toBeGreaterThan(0);
    expect(toFloat(hitKirby.damage), "and still hurt").toBeGreaterThan(0);
    // But not move him: no launch, no hitstun, still doing his move.
    expect(hitKirby.hitstun).toBe(0);
    expect(hitKirby.action).toBe("special");
  });
});

describe("Fox Illusion actually crosses ground", () => {
  it("carries Fox further than walking would", () => {
    // Started well left of the ledge, and stopped before either run could
    // reach it: at the edge both are clamped to the same x and the comparison
    // silently becomes "the stage is as wide as the stage".
    const start = fx(-70);

    // Standing on the ground, not spawning: a fighter in the entry animation
    // cannot act, so the special press lands on a frame that ignores it and
    // both runs turn into the same plain dash.
    const onGround = (s: GameState) => {
      const f = s.fighters[0];
      f.action = "stand";
      f.actionFrame = 0;
      f.grounded = true;
      f.platform = 0;
      f.intangible = 0;
      f.x = start;
      f.y = 0;
      f.facing = 1;
      return s;
    };

    const state = onGround(createInitialState("finalDestination", [{ defId: "fox" }], RULES, 3));
    const illusion = run(state, Btn.Right | Btn.Special, 34);
    const travelled = toFloat(illusion[illusion.length - 1].x);

    const walkState = onGround(createInitialState("finalDestination", [{ defId: "fox" }], RULES, 3));
    const walked = run(walkState, Btn.Right, 34);
    const walkedTo = toFloat(walked[walked.length - 1].x);

    expect(walkedTo, "the walk must not have hit the ledge").toBeLessThan(80);

    expect(travelled).toBeGreaterThan(walkedTo);
  });
});
