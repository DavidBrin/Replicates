/**
 * Crawling (Plan 5, Task 12), through the real `step()`.
 *
 * SmashWiki "Crawling" (https://www.ssbwiki.com/Crawling, revision 2030850 of
 * 2026-03-13): of the eight, only Pikachu crawls in Ultimate (the page's
 * "Crawlers" table), at the majority's "forward crawl speed of 0.7 and a
 * backward crawl speed of 0.5" (Pikachu is not among its Ultimate exceptions),
 * and "all crawling characters can crawl backwards". From Smash 4 on, "any
 * regular grounded option" can be used out of a crawl; an attack is the down
 * tilt, as from a crouch (`groundAttackSlot`).
 */

import { beforeAll, describe, expect, it } from "vitest";

import { CRAWL_BACK_SPEED, CRAWL_FORWARD_SPEED } from "@/engine/constants";
import { fx, toFloat } from "@/engine/fixed";
import { hashState } from "@/engine/hash";
import { STALE_FRESH_BONUS } from "@/engine/knockback";
import { cloneState, createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { FighterState, GameState, InputFrame, MatchRules } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

function standing(defId: string): GameState {
  const s = createInitialState("finalDestination", [{ defId }], RULES, 2);
  Object.assign(s.fighters[0], { action: "stand", grounded: true, platform: 0, x: 0, y: 0, facing: 1, intangible: 0 });
  return s;
}

/** Port 0 `defId` standing at `x`, and Mario standing `gap` in front of it, facing it. */
function facingMario(defId: string, x: number, gap: number): GameState {
  const s = createInitialState("finalDestination", [{ defId }, { defId: "mario" }], RULES, 2);
  Object.assign(s.fighters[0], { action: "stand", grounded: true, platform: 0, x: fx(x), y: 0, facing: 1, intangible: 0, invincible: 0 });
  Object.assign(s.fighters[1], { action: "stand", grounded: true, platform: 0, x: fx(x + gap), y: 0, facing: -1, intangible: 0, invincible: 0 });
  return s;
}

/** Every port's keys, frame by frame: port 0's (`held` before the first), and the rest idle. */
function run(s0: GameState, inputs: readonly InputFrame[], held: InputFrame = 0): GameState[] {
  let s = s0;
  const idle = s0.fighters.slice(1).map((): InputFrame => 0);
  let prev: InputFrame[] = [held, ...idle];
  const out: GameState[] = [];
  for (const i of inputs) {
    const now = [i, ...idle];
    s = step(s, now, { prevInputs: prev }).state;
    prev = now;
    out.push(s);
  }
  return out;
}

const last = (states: readonly GameState[]): FighterState => states[states.length - 1].fighters[0];
const hold = (n: number, keys: InputFrame): InputFrame[] => Array<InputFrame>(n).fill(keys);

const CROUCH: InputFrame[] = hold(12, Btn.Down);
const DR = Btn.Down | Btn.Right;
const DL = Btn.Down | Btn.Left;

describe("crawling", () => {
  it("is Pikachu's alone of the eight (SmashWiki's Ultimate crawlers)", () => {
    expect(FIGHTERS.filter((d) => d.attributes.canCrawl === true).map((d) => d.id)).toEqual(["pikachu"]);
  });

  it("Pikachu crawls forward at 0.7 and back at 0.5, still facing forward", () => {
    expect(CRAWL_FORWARD_SPEED).toBe(fx(0.7));
    expect(CRAWL_BACK_SPEED).toBe(fx(0.5));
    const fwd = run(standing("pikachu"), [...CROUCH, ...hold(10, DR)]);
    expect(last(fwd).action).toBe("crawl");
    expect(toFloat(last(fwd).vx)).toBeCloseTo(0.7, 3);
    // It moves at that speed: ten frames' worth from its first (UNVERIFIED: no
    // published acceleration, so it is at full speed at once).
    expect(toFloat(last(fwd).x - fwd[CROUCH.length - 1].fighters[0].x)).toBeCloseTo(7, 2);
    const back = run(standing("pikachu"), [...CROUCH, ...hold(10, DL)]);
    expect(last(back).action).toBe("crawl");
    expect(toFloat(last(back).vx)).toBeCloseTo(-0.5, 3);
    expect(toFloat(last(back).x - back[CROUCH.length - 1].fighters[0].x)).toBeCloseTo(-5, 2);
    expect(last(back).facing).toBe(1);
    // Facing left, forward is left.
    const s = standing("pikachu");
    s.fighters[0].facing = -1;
    const left = run(s, [...CROUCH, ...hold(10, DL)]);
    expect(toFloat(last(left).vx)).toBeCloseTo(-0.7, 3);
    expect(last(left).facing).toBe(-1);
  });

  it("stops crawling when the side is let go, and stands up when down is", () => {
    const stop = run(standing("pikachu"), [...CROUCH, ...hold(6, DR), Btn.Down]);
    expect(last(stop).action).toBe("crouch");
    const up = run(standing("pikachu"), [...CROUCH, ...hold(6, DR), Btn.Right]);
    expect(last(up).action).toBe("crouchEnd");
  });

  it("down tilts out of a crawl", () => {
    const states = run(standing("pikachu"), [...CROUCH, ...hold(6, DR), DR | Btn.Attack]);
    expect(last(states).action).toBe("attack");
    expect(last(states).move).toBe("dtilt");
  });

  // Ruling R-T12b: the down tilt out of a crawl is the down tilt, frame for frame.
  // UltimateFrameData (https://ultimateframedata.com/pikachu), "Down Tilt":
  // startup 7, active 7-8, total 18, base damage 6.0, which a fresh move deals
  // ×1.05 (`STALE_FRESH_BONUS`; SmashWiki "Stale-move negation").
  it("whose hit comes out on its frame 7 for 6% fresh, and which lasts its 18 frames (UltimateFrameData)", () => {
    const pressAt = CROUCH.length + 4;
    const hit = run(facingMario("pikachu", 0, 8), [...CROUCH, ...hold(4, DR), DR | Btn.Attack, ...hold(12, Btn.Down)]);
    expect(hit[pressAt - 1].fighters[0].action).toBe("crawl");
    expect(hit[pressAt].fighters[0].move).toBe("dtilt");
    const firstHurt = hit.findIndex((s) => s.fighters[1].damage > 0);
    expect(firstHurt - pressAt + 1, "the frame of the down tilt it hits on").toBe(7);
    expect(toFloat(hit[firstHurt].fighters[1].damage)).toBeCloseTo(6 * toFloat(STALE_FRESH_BONUS), 3);
    // Whiffed (nothing to freeze on), it is the move's frames 1..18, and acts on the next.
    const whiff = run(standing("pikachu"), [...CROUCH, ...hold(4, DR), DR | Btn.Attack, ...hold(20, Btn.Down)]);
    for (let k = 0; k < 18; k++) expect(whiff[pressAt + k].fighters[0].action, `move frame ${k + 1}`).toBe("attack");
    expect(whiff[pressAt + 18].fighters[0].action).not.toBe("attack");
  });

  it("can leave a crawl by any grounded option: a jump", () => {
    const states = run(standing("pikachu"), [...CROUCH, ...hold(6, DR), DR | Btn.Jump]);
    expect(last(states).action).toBe("jumpSquat");
  });

  it("is Pikachu's alone: Mario stays crouched", () => {
    const states = run(standing("mario"), [...CROUCH, ...hold(10, DR)]);
    expect(last(states).action).toBe("crouch");
    expect(last(states).x).toBe(fx(0));
  });
});

/**
 * Ruling R-T12b: a crawl off the ground is what `isActionable` makes of it, as
 * for a walk: the fighter falls (`onLeftGround`), and is never left crawling in
 * the air. UNVERIFIED: no source says whether a crawl stops at an edge (SmashWiki
 * "Teeter" names a slow walk only).
 */
describe("crawling off the ground", () => {
  function crawlsOff(stage: string, platform: number, x: number, y: number, over: Partial<FighterState> = {}): GameState[] {
    const s = createInitialState(stage, [{ defId: "pikachu" }], RULES, 2);
    Object.assign(s.fighters[0], { action: "crouch", actionFrame: 0, grounded: true, platform, x: fx(x), y: fx(y), facing: 1, intangible: 0, invincible: 0, ...over });
    // Down already held: a fresh press of it on a soft platform drops through.
    return run(s, hold(30, DR), Btn.Down);
  }

  /** It crawls up to the frame it leaves the ground, is `then` on that frame, and never crawls in the air. */
  function expectLeaves(states: readonly GameState[], then: string): void {
    const off = states.findIndex((s) => !s.fighters[0].grounded);
    expect(off, "it left the ground").toBeGreaterThan(0);
    expect(states[off - 1].fighters[0].action).toBe("crawl");
    expect(states[off].fighters[0].action).toBe(then);
    for (const s of states) if (!s.fighters[0].grounded) expect(s.fighters[0].action).not.toBe("crawl");
  }

  // Final Destination's right edge is at 79.99; Pikachu crawls off it facing out.
  it("off the stage's edge, catches the ledge on the frame it leaves the ground", () => {
    expectLeaves(crawlsOff("finalDestination", 0, 74, 0.005), "ledgeHang");
  });

  it("off the stage's edge with the ledge not to be had, falls", () => {
    expectLeaves(crawlsOff("finalDestination", 0, 74, 0.005, { ledgeLockout: 60 }), "fall");
  });

  it("falls off a soft platform's end", () => {
    // Battlefield's right platform spans 24.79 to 59.42 (half-width 17.3165 about 42.1055).
    const bf = STAGES.find((st) => st.id === "battlefield")!;
    const plat = bf.platforms[3];
    expect(plat.soft).toBe(true);
    const states = crawlsOff("battlefield", 3, 54, toFloat(plat.y));
    expect(states[0].fighters[0].grounded).toBe(true);
    expectLeaves(states, "fall");
  });
});

/**
 * P5-R12: crawling is not crouching for crouch cancel until a source says it is.
 * SmashWiki "Crouch cancel" (https://www.ssbwiki.com/Crouch_cancel) names no
 * crawl. So a crawling Pikachu's hit freezes its attacker as a standing one's
 * does, and longer than a crouching one's.
 */
describe("crawling is not a crouch cancel", () => {
  /** Mario's freeze when his down tilt hits Pikachu doing `keys`, and what Pikachu was doing when it landed. */
  function marioFreeze(keys: InputFrame): { freeze: number; hit: string } {
    const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "pikachu" }], RULES, 2);
    Object.assign(s.fighters[0], { action: "stand", grounded: true, platform: 0, x: fx(0), y: 0, facing: 1, intangible: 0, invincible: 0 });
    Object.assign(s.fighters[1], { action: keys === 0 ? "stand" : "crouch", grounded: true, platform: 0, x: fx(9), y: 0, facing: -1, intangible: 0, invincible: 0 });
    let st = s;
    let prev: InputFrame[] = [0, keys];
    for (let i = 0; i < 20; i++) {
      const now: InputFrame[] = [i === 0 ? Btn.Down | Btn.Attack : Btn.Down, keys];
      const was = st.fighters[1];
      st = step(st, now, { prevInputs: prev }).state;
      prev = now;
      if (st.fighters[1].damage > was.damage) return { freeze: st.fighters[0].hitlag, hit: was.action };
    }
    throw new Error("the down tilt never hit");
  }

  it("freezes the attacker as a standing victim does, longer than a crouching one", () => {
    const crawling = marioFreeze(Btn.Down | Btn.Left);
    const standingStill = marioFreeze(0);
    const crouching = marioFreeze(Btn.Down);
    expect([crawling.hit, standingStill.hit, crouching.hit]).toEqual(["crawl", "stand", "crouch"]);
    expect(crawling.freeze).toBe(standingStill.freeze);
    expect(crawling.freeze).toBeGreaterThan(crouching.freeze);
  });
});

describe("rollback across a crawl", () => {
  it("re-simulates identically from any frame of it", () => {
    const inputs = [...CROUCH, ...hold(8, DR), ...hold(6, DL), Btn.Down, ...hold(4, DR), DR | Btn.Attack, ...hold(10, Btn.Down)];
    const live = run(standing("pikachu"), inputs);
    expect(live.some((s) => s.fighters[0].action === "crawl")).toBe(true);
    for (const at of [CROUCH.length, CROUCH.length + 5, CROUCH.length + 12, CROUCH.length + 19]) {
      let replay = cloneState(live[at]);
      expect(hashState(replay)).toBe(hashState(live[at]));
      for (let i = at + 1; i < inputs.length; i++) replay = step(replay, [inputs[i]], { prevInputs: [inputs[i - 1]] }).state;
      expect(hashState(replay), `rolled back to ${at}`).toBe(hashState(live[inputs.length - 1]));
    }
  });
});
