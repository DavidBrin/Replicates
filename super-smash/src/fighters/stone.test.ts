// @vitest-environment node
/**
 * Kirby's Stone as published (Plan 5, Task 13 fix round 2, rulings R-T13j and
 * R-T13k). SmashWiki "Kirby (SSBU)/Down special"
 * (https://www.ssbwiki.com/Kirby_(SSBU)/Down_special, revision 2041256):
 * - aerial, for the minimum stone duration: vulnerable 1-18, "Damage-based armor
 *   19-28" ("The move's damage-based armor has a threshold of 25%"), "Falling hit
 *   29-46", "Stone protection 29-46", "Interruptible (from cancel) 78 (32)",
 *   "Animation length (from cancel) 81 (35)";
 * - grounded: "Landing hit 11", "Stone protection 11-28", "Interruptible (from
 *   cancel) 60 (32)", "Animation length (from cancel) 63 (35)";
 * - "The stone transformation (and subsequent protection) lasts a minimum of 18
 *   frames and a maximum of 150 frames, depending on when the special move button
 *   is pressed again"; parameters "Maximum stone duration 150 frames", "Period
 *   before the move can be canceled 18 frames", "Stone HP 25", "Hitlag multiplier
 *   for blocked attacks 1.2", "Fall speed 4.5"; "If the move's HP is fully
 *   depleted, Kirby is knocked out of it and takes 0.5× damage from the attack
 *   that caused it to break"; the overview, "he can still be grabbed";
 * - the falling hit, 18.0%, 70°, BK 69, KS 76, FKV 0, radius 6.5 on `top` at y
 *   2.0, hitlag ×0.7, `clang=f rebound=f`.
 * SmashWiki "Armor" (https://www.ssbwiki.com/Armor, revision 2065996): damage-based
 * armour holds "unless the attack deals enough percentage to go over a defined
 * threshold" ("will handle up to 30% ... dealing above 30% will interrupt it"),
 * decided before the 1v1 multiplier.
 *
 * UNVERIFIED and pinned as the replica's reading (`stone.ts`, `kirby.ts`,
 * `simulate.ts`): the fall from 29, straight down, and the fall as he would before
 * it; a stone landing before its frame 11 plays on to 11 (R-T13k); one landing
 * after its stone has ended plays on as it is; the stone's HP counts the damage
 * before the 1v1 multiplier, and exactly 25 breaks it.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ATTACK, clearAll, frame, script, wait } from "@/engine/acmd/dsl";
import { fx, mul } from "@/engine/fixed";
import { computeHitlag, framesAfterHit } from "@/engine/knockback";
import { hashState } from "@/engine/hash";
import { cloneState, createInitialState, step } from "@/engine/simulate";
import type { SimContext } from "@/engine/simulate";
import { damageArmourHolds, damageArmourOf } from "@/engine/states";
import { stoneOf } from "@/engine/stone";
import { Btn } from "@/engine/types";
import type { FighterDef, FighterState, GameState, InputFrame, MatchRules, StageDef, StepEvents } from "@/engine/types";
import { finalDestination } from "@/stages/finalDestination";
import { STAGES } from "@/stages";
import { FIGHTERS, kirby, mario } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };

/** Nowhere to land: a fall, and nothing else. */
const VOID: StageDef = {
  ...finalDestination,
  id: "void",
  platforms: [{ x: 0, y: fx(-4000), halfWidth: fx(10), soft: false, ledges: false }],
  blastZone: { left: fx(-4000), right: fx(4000), top: fx(4000), bottom: fx(-8000) },
  spawns: [{ x: 0, y: 0 }, { x: fx(2000), y: 0 }],
};

/**
 * A fighter whose jab is three hits of `damage`, on frames 2, 8 and 14, each of them
 * able to land (`clear_all` between), reaching 16 in front: it stands 17 off Kirby,
 * out of the landing hit's reach (12).
 */
function hitter(damage: number): FighterDef {
  const box = (z: number) => ATTACK({ id: 0, bone: "top", damage, angle: 45, kbg: 100, bkb: 40, size: 7, x: 0, y: 6, z });
  return {
    ...mario,
    id: "hitter",
    moves: { ...mario.moves, jab1: { slot: "jab1", name: "Three hits", totalFrames: 30, hitboxes: [] } },
    scripts: {
      ...mario.scripts,
      jab1: script("game_attack11", "attack_11", [frame(2), box(9), wait(1), clearAll(), frame(8), box(9), wait(1), clearAll(), frame(14), box(9), wait(1), clearAll()]),
    },
  };
}

const ctx = (extra: FighterDef[] = []): SimContext => ({
  fighter: (id) => extra.find((f) => f.id === id) ?? FIGHTERS.find((f) => f.id === id)!,
  stage: (id) => (id === "void" ? VOID : STAGES.find((s) => s.id === id)!),
});

beforeAll(() => {
  expect(kirby.scripts?.downB).toBeUndefined();
});

/** Kirby and `rival` on `stage`: Kirby at (kx, ky) facing right, the rival at rx facing him, standing. */
function lineUp(stage: string, kx: number, ky: number, rival: string, rx: number, c: SimContext, rules: MatchRules = RULES): GameState {
  const s = createInitialState(stage, [{ defId: "kirby" }, { defId: rival }], rules, 3, c);
  s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? kx : rx), y: 0, facing: i === 0 ? 1 : -1, intangible: 0, invincible: 0 }));
  if (ky !== 0 || stage === "void") Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, y: fx(ky), vx: 0, vy: 0 });
  return s;
}

/** Step `s` with `inputs(i)` per port for `steps` steps; every state and event list. */
function run(s0: GameState, steps: number, inputs: (i: number, s: GameState) => InputFrame[], c: SimContext): { states: GameState[]; events: StepEvents[] } {
  let s = s0;
  let prev: InputFrame[] = s0.fighters.map(() => 0);
  const states: GameState[] = [];
  const events: StepEvents[] = [];
  for (let i = 0; i < steps; i++) {
    const now = inputs(i, s);
    const out = step(s, now, { prevInputs: prev, ctx: c });
    s = out.state;
    prev = now;
    states.push(s);
    events.push(out.events);
  }
  return { states, events };
}

const kirbyOf = (s: GameState): FighterState => s.fighters[0];
const frameOf = (f: FighterState) => f.actionFrame + 1;
/** Down special on step 0, the special button again on the steps in `presses`. */
const stoneInputs = (presses: number[] = []) => (i: number): InputFrame[] => [i === 0 ? Btn.Down | Btn.Special : presses.includes(i) ? Btn.Special : 0, 0];

describe("Kirby's Stone, as published (R-T13j)", () => {
  it("carries its published values", () => {
    const m = kirby.moves.downB!;
    expect([m.totalFrames + 1, (m.aerialTotalFrames ?? 0) + 1]).toEqual([60, 78]);
    expect(m.stone).toEqual({ air: [29, 46], ground: [11, 28], minFrames: 18, maxFrames: 150, hp: fx(25), breakDamage: fx(0.5), blockedHitlag: fx(1.2) });
    expect(m.damageArmour).toEqual({ from: 19, to: 28, threshold: fx(25), whileGrounded: false });
    expect(m.momentum).toEqual([{ frame: 29, x: 0, y: fx(-4.5), hold: 18 }]);
    expect(m.superArmourFrames).toBeUndefined();
    const fall = m.hitboxes.find((hb) => hb.whileGrounded === false)!;
    expect(fall).toMatchObject({ startFrame: 29, endFrame: 46, damage: fx(18), angle: fx(70), baseKnockback: fx(69), knockbackGrowth: fx(76), radius: fx(6.5), y: fx(2), hitlagMultiplier: fx(0.7), transcendent: true });
  });

  it("in the air: falls as he would to 28, then a stone at 4.5 a frame from 29, its falling hit out on 29-46", () => {
    const c = ctx();
    const { states } = run(lineUp("void", 0, 0, "mario", 2000, c), 60, stoneInputs(), c);
    const at = (g: number) => states.find((s) => frameOf(kirbyOf(s)) === g && kirbyOf(s).action === "special")!;
    expect(stoneOf(kirbyOf(at(28)), kirby)).toBeNull();
    expect(stoneOf(kirbyOf(at(29)), kirby)).not.toBeNull();
    for (let g = 30; g <= 46; g++) expect(kirbyOf(at(g)).y - kirbyOf(at(g - 1)).y, `frame ${g}`).toBe(fx(-4.5));
  });

  it("untouched, stays a stone for 150 frames, held on 46, and is interruptible 32 frames after its last (78 at the least)", () => {
    const c = ctx();
    const { states } = run(lineUp("void", 0, 0, "mario", 2000, c), 260, stoneInputs(), c);
    const stone = states.map((s) => stoneOf(kirbyOf(s), kirby) !== null);
    const first = stone.indexOf(true);
    const last = stone.lastIndexOf(true);
    expect(last - first + 1).toBe(150);
    expect(stone.slice(first, last + 1).every(Boolean)).toBe(true);
    expect(frameOf(kirbyOf(states[last]))).toBe(46);
    const free = states.findIndex((s, i) => i > 0 && kirbyOf(s).action !== "special");
    expect(free - last).toBe(32);
  });

  it("is ended by the special button only from its 18th frame: in the air on 46, interruptible on 78", () => {
    const c = ctx();
    // Its stone forms on step 28 (frame 29): the 10th stone frame is step 37, the 18th step 45.
    const early = run(lineUp("void", 0, 0, "mario", 2000, c), 120, stoneInputs([37]), c).states;
    expect(early.slice(38, 60).every((s) => stoneOf(kirbyOf(s), kirby) !== null)).toBe(true);
    const { states } = run(lineUp("void", 0, 0, "mario", 2000, c), 120, stoneInputs([37, 45]), c);
    expect(stoneOf(kirbyOf(states[45]), kirby)).not.toBeNull();
    expect(stoneOf(kirbyOf(states[46]), kirby)).toBeNull();
    expect(frameOf(kirbyOf(states[46]))).toBe(47);
    const free = states.findIndex((s, i) => i > 0 && kirbyOf(s).action !== "special");
    // Interruptible on 78: the step its frame would be 78.
    expect(free).toBe(77);
  });

  it("is not ended by the special button on its 17th frame", () => {
    const c = ctx();
    // Its stone forms on step 28: the 17th stone frame is step 44.
    const { states } = run(lineUp("void", 0, 0, "mario", 2000, c), 70, stoneInputs([44]), c);
    expect(states.slice(44, 70).every((s) => stoneOf(kirbyOf(s), kirby) !== null)).toBe(true);
    expect(frameOf(kirbyOf(states[50]))).toBe(46);
  });

  it("on the ground: the landing hit on 11, its stone on 11-28, ended on its 18th frame, interruptible on 60", () => {
    const c = ctx();
    const hit = run(lineUp("finalDestination", 0, 0, "mario", 8, c), 20, stoneInputs(), c);
    const first = hit.events.findIndex((e) => e.hits.some((h) => h.attacker === 0));
    expect(frameOf(kirbyOf(hit.states[first]))).toBe(11);
    // Mario out of its reach, so no freeze moves the frames below off their steps.
    const { states } = run(lineUp("finalDestination", 0, 0, "mario", 60, c), 80, stoneInputs([27]), c);
    expect(stoneOf(kirbyOf(states[9]), kirby)).toBeNull();
    expect([10, 27].map((i) => stoneOf(kirbyOf(states[i]), kirby) !== null)).toEqual([true, true]);
    expect(stoneOf(kirbyOf(states[28]), kirby)).toBeNull();
    const free = states.findIndex((s, i) => i > 0 && kirbyOf(s).action !== "special");
    expect(free).toBe(59);
  });
});

describe("its damage-based armour (R-T13j)", () => {
  it("holds against no more than 25%: 24.9 and 25 are taken, 25.1 is not", () => {
    expect([24.9, 25, 25.1].map((d) => damageArmourHolds(fx(25), fx(d)))).toEqual([true, true, false]);
  });

  it("is the air's, on 19-28 alone", () => {
    const air = (g: number, grounded = false) => damageArmourOf({ action: "special", move: "downB", actionFrame: g - 1, grounded }, kirby);
    expect([18, 19, 28, 29].map((g) => air(g))).toEqual([null, fx(25), fx(25), null]);
    expect(air(20, true)).toBeNull();
  });

  /** Kirby in the air at frame 20 of his Stone, held in place; a hitter's three-hit jab of `damage` on him. */
  function armouredHit(damage: number, rules: MatchRules = RULES): { kirby: FighterState; launched: boolean; damageTaken: number } {
    const h = hitter(damage);
    const c = ctx([h]);
    const s0 = lineUp("finalDestination", 0, 5, "hitter", 17, c, rules);
    const { states } = run(s0, 24, (i, s) => {
      // Held 5 above the floor: in the air, inside the jab's reach.
      Object.assign(kirbyOf(s), { y: fx(5), vy: 0 });
      // The jab's first hit comes out on its frame 2: pressed so it lands on Kirby's frame 20.
      return [i === 0 ? Btn.Down | Btn.Special : 0, i === 18 ? Btn.Attack : 0];
    }, c);
    const after = kirbyOf(states[23]);
    return { kirby: after, launched: after.action !== "special", damageTaken: after.damage / 4096 };
  }

  it("takes a 10% hit on frame 20 and is not launched by it, and is launched by a 30% one", () => {
    const soft = armouredHit(10);
    expect(soft.launched).toBe(false);
    expect(soft.damageTaken).toBeCloseTo(10 * 1.05, 2);
    const hard = armouredHit(30);
    expect(hard.launched).toBe(true);
  });

  // Fix round 3 (the re-review's N3): what it compares and what it adds up.
  it("compares the damage before the 1v1 multiplier: a 22% hit in 1v1 (23.1 fresh, 27.72 after it) is taken", () => {
    const duel = armouredHit(22, { ...RULES, oneOnOne: true });
    expect(duel.launched).toBe(false);
    expect(duel.damageTaken).toBeCloseTo(22 * 1.05 * 1.2, 1);
  });

  it("weighs each hit alone: two 15% hits on 19-28, 31.5 together, are both taken", () => {
    const h = hitter(15);
    const c = ctx([h]);
    // Each hit freezes both for 15 frames: the second comes 6 of Kirby's frames after the first.
    const { states, events } = run(lineUp("finalDestination", 0, 5, "hitter", 17, c), 50, (i, s) => {
      Object.assign(kirbyOf(s), { y: fx(5), vy: 0 });
      return [i === 0 ? Btn.Down | Btn.Special : 0, i === 18 ? Btn.Attack : 0];
    }, c);
    const hits = events.flatMap((e, i) => e.hits.filter((x) => x.attacker === 1).map(() => i));
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const [first, second] = hits;
    expect([first, second].map((i) => frameOf(kirbyOf(states[i])))).toEqual([20, 26]);
    expect([first, second].map((i) => kirbyOf(states[i]).action)).toEqual(["special", "special"]);
    expect(kirbyOf(states[second]).damage / 4096).toBeCloseTo(2 * 15 * 1.05, 2);
  });
});

describe("its stone (R-T13j)", () => {
  /**
   * Grounded Kirby's Stone, the hitter's three hits of `damage` landing on its stone,
   * every state; `preset` runs on each state before its step (to set the stone's
   * damage taken so far).
   */
  function blocked(damage: number, rules: MatchRules = RULES, preset: (i: number, s: GameState) => void = () => {}) {
    const h = hitter(damage);
    const c = ctx([h]);
    return {
      c,
      ...run(lineUp("finalDestination", 0, 0, "hitter", 17, c, rules), 90, (i, s) => {
        preset(i, s);
        return [i === 0 ? Btn.Down | Btn.Special : 0, i === 12 ? Btn.Attack : 0];
      }, c),
    };
  }
  /** The same jab on a Kirby standing at 0%: its first hit. */
  function control(damage: number) {
    const h = hitter(damage);
    const c = ctx([h]);
    const { states, events } = run(lineUp("finalDestination", 0, 0, "hitter", 17, c), 6, (i) => [0, i === 0 ? Btn.Attack : 0], c);
    const at = events.findIndex((e) => e.hits.length > 0);
    return { state: states[at], hit: events[at].hits[0] };
  }

  it("takes no damage and no knockback from a hit, and freezes both 1.2× as long", () => {
    const { states, events } = blocked(10);
    const at = events.findIndex((e) => e.hits.length > 0);
    const k = kirbyOf(states[at]);
    expect([k.action, k.move, k.damage]).toEqual(["special", "downB", 0]);
    // 10% fresh (×1.05), as Q12 makes it.
    const taken = k.combat.stoneTaken;
    expect(Math.abs(taken - fx(10 * 1.05))).toBeLessThanOrEqual(2);
    expect(k.hitlag).toBe(framesAfterHit(computeHitlag(taken, { moveMultiplier: fx(1.2) })));
    expect(states[at].fighters[1].hitlag).toBe(k.hitlag);
    expect(control(10).state.fighters[0].hitlag).toBe(framesAfterHit(computeHitlag(taken)));
    expect(k.hitlag).toBeGreaterThan(control(10).state.fighters[0].hitlag);
  });

  it("breaks on the hit that takes it to 25: that hit deals half its damage, with its full knockback", () => {
    const { states, events } = blocked(10);
    const hits = events.flatMap((e, i) => e.hits.map((h) => ({ ...h, i })));
    expect(hits).toHaveLength(3);
    // 10.5 and 21 are blocked; 31.5 breaks it.
    expect(kirbyOf(states[hits[1].i]).damage).toBe(0);
    const broke = kirbyOf(states[hits[2].i]);
    const taken = kirbyOf(states[hits[0].i]).combat.stoneTaken;
    expect(broke.damage).toBe(mul(taken, fx(0.5)));
    expect(broke.action).not.toBe("special");
    // Its full knockback: the same hit's on a Kirby at 0% with no stone (whose damage the stone kept at 0).
    expect(hits[2].knockback).toBe(control(10).hit.knockback);
    expect(hits[2].knockback).toBeGreaterThan(0);
    // The stone's record ends with the special.
    expect([broke.combat.stoneFrames, broke.combat.stoneTaken]).toEqual([0, 0]);
  });

  // UNVERIFIED (the replica's reading of "If the move's HP is fully depleted"): a
  // stone whose HP is exactly used up is broken; one Q12 unit short of it holds.
  it("breaks on a hit that takes it to exactly 25, and holds on one a Q12 unit short of it", () => {
    const probe = blocked(10);
    const at = probe.events.findIndex((e) => e.hits.length > 0);
    const per = kirbyOf(probe.states[at]).combat.stoneTaken;
    const exact = blocked(10, RULES, (i, s) => {
      if (i === at) kirbyOf(s).combat.stoneTaken = fx(25) - per;
    });
    expect(kirbyOf(exact.states[at]).damage).toBe(mul(per, fx(0.5)));
    expect(kirbyOf(exact.states[at]).action).not.toBe("special");
    const short = blocked(10, RULES, (i, s) => {
      if (i === at) kirbyOf(s).combat.stoneTaken = fx(25) - per - 1;
    });
    expect(kirbyOf(short.states[at])).toMatchObject({ action: "special", move: "downB", damage: 0 });
    expect(kirbyOf(short.states[at]).combat.stoneTaken).toBe(fx(25) - 1);
  });

  // The stone's HP counts the damage before the 1v1 multiplier, as damage-based
  // armour decides whether it breaks (SmashWiki "Armor": the multiplier "is applied
  // after all other calculations, including deciding whether the armor breaks").
  // In 1v1 the second 10% hit is 12.6 after it: 25.2, past 25, were it counted.
  it("counts the damage before the 1v1 multiplier: the same in 1v1, and broken on the third hit there too", () => {
    const free = blocked(10);
    const duel = blocked(10, { ...RULES, oneOnOne: true });
    const hitsOf = (r: typeof free) => r.events.flatMap((e, i) => e.hits.map(() => i));
    const [a, b] = [hitsOf(free), hitsOf(duel)];
    expect(b).toHaveLength(3);
    expect(kirbyOf(duel.states[b[0]]).combat.stoneTaken).toBe(kirbyOf(free.states[a[0]]).combat.stoneTaken);
    expect(kirbyOf(duel.states[b[1]])).toMatchObject({ action: "special", damage: 0 });
    expect(kirbyOf(duel.states[b[2]]).action).not.toBe("special");
  });

  it("is no stone once broken, nor before it forms, on a frame of its window", () => {
    const stone = kirby.moves.downB!.stone!;
    const k = (frames: number, taken: number) => {
      const f = createInitialState("finalDestination", [{ defId: "kirby" }, { defId: "mario" }], RULES, 3, ctx()).fighters[0];
      Object.assign(f, { action: "special", move: "downB", actionFrame: 14, grounded: true });
      Object.assign(f.combat, { stoneFrames: frames, stoneTaken: taken });
      return stoneOf(f, kirby);
    };
    expect(k(5, stone.hp - 1)).toBe(stone);
    expect(k(5, stone.hp)).toBeNull();
    expect(k(0, 0)).toBeNull();
  });

  it("can still be grabbed, and the grab ends the stone", () => {
    const c = ctx();
    // Mario out of the landing hit's reach; then beside the stone, grabbing.
    const { states } = run(lineUp("finalDestination", 0, 0, "mario", 40, c), 40, (i, s) => {
      if (i === 18) Object.assign(s.fighters[1], { x: fx(7), action: "stand", actionFrame: 0, vx: 0 });
      return [i === 0 ? Btn.Down | Btn.Special : 0, i === 20 ? Btn.Grab : 0];
    }, c);
    const caught = states.findIndex((s) => kirbyOf(s).action === "grabbed");
    expect(caught).toBeGreaterThan(20);
    expect(stoneOf(kirbyOf(states[caught - 1]), kirby)).not.toBeNull();
    expect([kirbyOf(states[caught]).combat.stoneFrames, kirbyOf(states[caught]).combat.stoneTaken]).toEqual([0, 0]);
  });

  it("re-simulates identically from any frame across its break (rollback)", () => {
    const h = hitter(10);
    const c = ctx([h]);
    const inputs = (i: number): InputFrame[] => [i === 0 ? Btn.Down | Btn.Special : 0, i === 12 ? Btn.Attack : 0];
    const { states, events } = run(lineUp("finalDestination", 0, 0, "hitter", 17, c), 90, inputs, c);
    const breakAt = events.findIndex((e, i) => e.hits.length > 0 && kirbyOf(states[i]).damage > 0);
    expect(breakAt).toBeGreaterThan(0);
    for (const at of [breakAt - 9, breakAt - 1, breakAt, breakAt + 3]) {
      let replay = cloneState(states[at]);
      expect(hashState(replay)).toBe(hashState(states[at]));
      for (let i = at + 1; i < 90; i++) replay = step(replay, inputs(i), { prevInputs: inputs(i - 1), ctx: c }).state;
      expect(hashState(replay), `rolled back to ${at}`).toBe(hashState(states[89]));
    }
  });
});

describe("a Stone that lands (R-T13k)", () => {
  it("landing before its frame 11 plays on to 11: no hit before, its landing hit on 11", () => {
    const c = ctx();
    // Pressed 2 units above the floor: it lands on its frame 8 (as a probe measured).
    const { states, events } = run(lineUp("finalDestination", 0, 2, "mario", 8, c), 30, stoneInputs(), c);
    const landed = states.findIndex((s) => kirbyOf(s).grounded);
    expect(frameOf(kirbyOf(states[landed]))).toBeLessThan(11);
    const first = events.findIndex((e) => e.hits.some((h) => h.attacker === 0));
    expect(frameOf(kirbyOf(states[first]))).toBe(11);
  });

  it("landing before its frame 11 goes on a frame a step to 11: none skipped", () => {
    const c = ctx();
    const { states } = run(lineUp("finalDestination", 0, 2, "mario", 60, c), 30, stoneInputs(), c);
    const landed = states.findIndex((s) => kirbyOf(s).grounded);
    const eleven = states.findIndex((s) => frameOf(kirbyOf(s)) === 11);
    expect(eleven).toBeGreaterThan(landed);
    for (let i = landed; i <= eleven; i++) expect(frameOf(kirbyOf(states[i])), `step ${i}`).toBe(frameOf(kirbyOf(states[i - 1])) + 1);
  });

  it("landing on its frames 12-28 jumps back to 11 and is a stone on the landing frame", () => {
    const c = ctx();
    // Pressed 12 above the floor: it lands on its frame 18 (as a probe measured).
    const { states } = run(lineUp("finalDestination", 0, 12, "mario", 60, c), 30, stoneInputs(), c);
    const landed = states.findIndex((s) => kirbyOf(s).grounded);
    expect(frameOf(kirbyOf(states[landed - 1]))).toBeGreaterThan(11);
    expect(frameOf(kirbyOf(states[landed]))).toBe(11);
    expect(stoneOf(kirbyOf(states[landed]), kirby)).not.toBeNull();
  });

  /** A drop from `y` held as a stone (no cancel), Mario at `rx`: every state and event, and the step it lands on. */
  function heldDrop(y: number, rx: number, presses: number[] = []) {
    const c = ctx();
    const out = run(lineUp("finalDestination", 0, y, "mario", rx, c), 140, stoneInputs(presses), c);
    return { ...out, landed: out.states.findIndex((s) => kirbyOf(s).grounded) };
  }

  it("landing while its stone is held on 46 goes to 11, with its landing hit", () => {
    // From 120 it lands on step 49, its stone's 22nd frame, held on 46 (as a probe measured).
    const { states, events, landed } = heldDrop(120, 12);
    expect(frameOf(kirbyOf(states[landed - 1]))).toBe(46);
    expect(kirbyOf(states[landed - 1]).combat.stoneFrames).toBeLessThan(150);
    expect(frameOf(kirbyOf(states[landed]))).toBe(11);
    const hit = events.findIndex((e) => e.hits.some((h) => h.attacker === 0));
    expect(hit).toBe(landed);
    expect(events[hit].hits.filter((h) => h.attacker === 0).every((h) => h.hitboxId === 1 || h.hitboxId === 2)).toBe(true);
  });

  // Fix round 3 (ruling R-T13m): a stone ended on the step it lands plays on.
  it("ended on the step it lands, plays on: no jump back to 11, no stone again, no landing hit, interruptible 32 frames after", () => {
    const { landed } = heldDrop(120, 60);
    const { states, events } = heldDrop(120, 60, [landed]);
    expect(frameOf(kirbyOf(states[landed - 1]))).toBe(46);
    expect(states.findIndex((s) => kirbyOf(s).grounded)).toBe(landed);
    expect(kirbyOf(states[landed]).combat.stoneFrames).toBe(150);
    expect(frameOf(kirbyOf(states[landed]))).toBe(46);
    expect(states.slice(landed + 1).every((s) => stoneOf(kirbyOf(s), kirby) === null)).toBe(true);
    expect(events.slice(landed).every((e) => e.hits.every((h) => h.attacker !== 0))).toBe(true);
    const free = states.findIndex((s, i) => i > landed && kirbyOf(s).action !== "special");
    expect(free - landed).toBe(32);
  });

  // The Task 13 tail (the re-review's N6): the step it lands on is its frame 46, a
  // frame of the air's "Stone protection 29-46", and "The stone transformation (and
  // subsequent protection) lasts a minimum of 18 frames": still a stone there.
  it("ended on the step it lands, is a stone on that step still: its frame 46, the air's protection (N6)", () => {
    const { landed } = heldDrop(120, 60);
    const { states } = heldDrop(120, 60, [landed]);
    expect(frameOf(kirbyOf(states[landed]))).toBe(46);
    expect(kirbyOf(states[landed]).grounded).toBe(true);
    expect(stoneOf(kirbyOf(states[landed]), kirby)).not.toBeNull();
    expect(states.slice(landed + 1).every((s) => stoneOf(kirbyOf(s), kirby) === null)).toBe(true);
  });

  // The Task 13 tail (the re-review's N7): a stone that ends on its 150th frame in
  // the air, untouched, is the air's too, wherever it lands.
  it("untouched, ending on its 150th frame in the air and landing on that step or in its end lag: interruptible 32 frames after its last (N7)", () => {
    // Final Destination with its top blast zone out of the way: dropped from 694 to
    // 698 it lands on the stone's last step, from 699 to about 735 in its end lag.
    const tall: StageDef = { ...finalDestination, id: "tall", blastZone: { ...finalDestination.blastZone, top: fx(4000) } };
    const base = ctx();
    const c: SimContext = { ...base, stage: (id) => (id === "tall" ? tall : base.stage(id)) };
    const seen = { onEnd: 0, inLag: 0 };
    for (let y = 690; y <= 740; y += 2) {
      const { states } = run(lineUp("tall", 0, y, "mario", 60, c), 300, stoneInputs(), c);
      const last = states.findIndex((s) => kirbyOf(s).combat.stoneFrames >= 150);
      const landed = states.findIndex((s) => kirbyOf(s).grounded);
      if (last < 0 || landed < last) continue;
      const free = states.findIndex((s, i) => i > last && kirbyOf(s).action !== "special");
      if (landed - last > 32) continue;
      expect(free - last, `from ${y}: ended ${last}, landed ${landed}`).toBe(32);
      if (landed === last) {
        seen.onEnd += 1;
        // Its frame 46 on the landing step, a stone still (N6).
        expect(stoneOf(kirbyOf(states[landed]), kirby), `from ${y}`).not.toBeNull();
      } else seen.inLag += 1;
    }
    expect(seen.onEnd).toBeGreaterThan(0);
    expect(seen.inLag).toBeGreaterThan(0);
  });

  // Fix round 3 (ruling R-T13m): the air's 32 frames after its cancel, wherever it lands.
  it("cancelled in the air on 46 and landing on 47-77, is interruptible on 78 still (32 frames after the cancel)", () => {
    const frames: number[] = [];
    for (let y = 90; y <= 400; y += 5) {
      const { states, landed } = heldDrop(y, 60, [45]);
      if (kirbyOf(states[45]).grounded || frameOf(kirbyOf(states[45])) !== 46 || landed <= 45) continue;
      const on = frameOf(kirbyOf(states[landed]));
      if (on > 77) continue;
      frames.push(on);
      const free = states.findIndex((s, i) => i > 0 && kirbyOf(s).action !== "special");
      expect(free, `landed on ${on} from ${y}`).toBe(77);
      // The stone's record ends with the special.
      expect(kirbyOf(states[free]).combat).toMatchObject({ stoneFrames: 0, stoneTaken: 0, stoneEndedAir: false });
    }
    expect(frames.some((g) => g <= 59)).toBe(true);
    expect(frames.some((g) => g >= 60)).toBe(true);
  });

  it("re-simulates identically from any frame across an aerial cancel and its landing (rollback)", () => {
    const { landed } = heldDrop(120, 60);
    const c = ctx();
    const inputs = stoneInputs([landed]);
    const { states } = run(lineUp("finalDestination", 0, 120, "mario", 60, c), 100, inputs, c);
    for (const at of [landed - 3, landed - 1, landed, landed + 5]) {
      let replay = cloneState(states[at]);
      expect(hashState(replay)).toBe(hashState(states[at]));
      for (let i = at + 1; i < 100; i++) replay = step(replay, inputs(i), { prevInputs: inputs(i - 1), ctx: c }).state;
      expect(hashState(replay), `rolled back to ${at}`).toBe(hashState(states[99]));
    }
  });

  it("used on the ground after one ended in the air, takes the ground's length again: interruptible on 60", () => {
    const c = ctx();
    // An aerial Stone cancelled on 46 that lands in its end lag; once it is over, a Stone on the ground.
    let firstFree = -1;
    let second = -1;
    const { states } = run(lineUp("finalDestination", 0, 112, "mario", 60, c), 200, (i, s) => {
      const k = kirbyOf(s);
      if (firstFree < 0 && i > 1 && k.action !== "special") firstFree = i;
      if (firstFree >= 0 && second < 0 && k.grounded && k.action === "stand") second = i;
      return [i === 0 || i === second ? Btn.Down | Btn.Special : i === 45 || (second >= 0 && i === second + 27) ? Btn.Special : 0, 0];
    }, c);
    expect(second).toBeGreaterThan(0);
    const free = states.findIndex((s, i) => i > second && kirbyOf(s).action !== "special");
    expect(free - second).toBe(59);
  });

  it("landing after its stone has ended plays on as it is: no stone again, no landing hit", () => {
    const c = ctx();
    // High enough to end the stone on 46 in the air (step 45) and land in its end lag.
    const { states, events } = run(lineUp("finalDestination", 0, 112, "mario", 8, c), 90, stoneInputs([45]), c);
    const landed = states.findIndex((s) => kirbyOf(s).grounded);
    expect(frameOf(kirbyOf(states[landed - 1]))).toBeGreaterThan(46);
    expect(frameOf(kirbyOf(states[landed]))).toBeGreaterThan(46);
    expect(states.slice(landed).every((s) => stoneOf(kirbyOf(s), kirby) === null)).toBe(true);
    expect(events.slice(landed).every((e) => e.hits.every((h) => h.attacker !== 0))).toBe(true);
  });
});
