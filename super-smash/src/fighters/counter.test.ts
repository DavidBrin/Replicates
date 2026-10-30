/**
 * Marth's Counter, through the real `step()` (Plan 5, Task 5). SmashWiki
 * "Marth (SSBU)/Down special": catches hits on frames 6–27; returns ×1.2,
 * at least 8%, at most 50%; both freeze 21 frames; a grab goes through.
 *
 * Sources, every number below:
 * - SmashWiki "Marth (SSBU)/Down special"
 *   (https://www.ssbwiki.com/Marth_(SSBU)/Down_special): Counter "Intangibility
 *   5-6", "Counter 6-27", "Interruptible 65"; "Counter hitlag on activation 21
 *   frames", "Counter damage multiplier 1.2", "Counter minimum damage 8%",
 *   "Counter maximum damage 50%", "Counter bubble size 10.5u", "Counter bubble
 *   offsets [0, 10, 0]"; Attack "Intangibility 1-8", "Hitboxes 5-7",
 *   "Interruptible 42", "Upon countering an attack, Marth immediately
 *   transitions to the first frame of this state, in which he freezes for 21
 *   frames alongside the opponent"; the four boxes 8.0%, angle 361, BKB 90, KBG
 *   60, radius 5.5, hitlag ×1.4.
 * - rubendal Data Viewer 13.0.1, `game_speciallwhit`
 *   (https://rubendal.github.io/ssbu/data/patch/13.0.1/character/Marth/data.json):
 *   the same boxes; the motion's CancelFrame 42.
 * - UltimateFrameData (https://ultimateframedata.com/marth): "Down B (Counter)"
 *   total 64, "Counter window 6-27".
 * - SmashWiki "Counterattack" (https://www.ssbwiki.com/Counterattack): a grab
 *   "is immune to counterattacks"; "Counterattacks also do not trigger if the
 *   fighter is invincible".
 * - The attacks Marth catches: Mario's jab (`game_attack11`, 2.2%, live 2-3),
 *   forward smash (legacy table: arm 14.7% id 0, fist 17.8% id 1, live 15-17),
 *   fireball (5%), and Pikachu's jab loop; `acmd/generated/*.ts`, `mario.ts`.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { activeCounter, counterDamage } from "@/engine/counter";
import { fx, mul, ONE, toFloat } from "@/engine/fixed";
import { hashState } from "@/engine/hash";
import { spawnProjectile } from "@/engine/projectile";
import { ONE_ON_ONE_MULTIPLIER } from "@/engine/constants";
import { computeHitlag, computeKnockback, computeStaleness, resolveAngle } from "@/engine/knockback";
import { cloneState, createInitialState, registerFighters, registerStages, registryContext, step } from "@/engine/simulate";
import type { SimContext } from "@/engine/simulate";
import { chargeMultiplier } from "@/engine/states";
import { changeStatus, STATUS_KIND_OF_ACTION } from "@/engine/status/kind";
import { Btn } from "@/engine/types";
import type { ActionState, CounterDef, FighterDef, FighterState, GameState, InputFrame, MatchRules, MoveDef, ProjectileDef, StepEvents } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS, mario, marth } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** `attacker` on the left facing Marth on the right, `gap` apart. */
function duel(attacker: string, gap: number): GameState {
  const s = createInitialState("finalDestination", [{ defId: attacker }, { defId: "marth" }], RULES, 5);
  s.fighters.forEach((f, i) =>
    Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? -gap / 2 : gap / 2), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }),
  );
  return s;
}

function run(
  s0: GameState,
  frames: number,
  script: (i: number) => [InputFrame, InputFrame],
  ctx?: SimContext,
): { states: GameState[]; events: StepEvents[] } {
  let s = s0;
  let prev: [InputFrame, InputFrame] = [0, 0];
  const states: GameState[] = [];
  const events: StepEvents[] = [];
  for (let i = 0; i < frames; i++) {
    const now = script(i);
    const out = step(s, now, { prevInputs: prev, ...(ctx !== undefined ? { ctx } : {}) });
    s = out.state;
    prev = now;
    states.push(s);
    events.push(out.events);
  }
  return { states, events };
}

const COUNTER: InputFrame = Btn.Down | Btn.Special;

/** The first step on which a counter caught something, or −1. */
const caughtAt = (events: readonly StepEvents[]) => events.findIndex((e) => e.counters.length > 0);

/** Mario's forward smash into Marth's counter, Marth countering on frame 0. */
const FSMASH = (i: number): [InputFrame, InputFrame] => [i === 0 ? Btn.Right : i === 1 ? Btn.Right | Btn.Attack : 0, i === 0 ? COUNTER : 0];

/** The Counter as `marth.ts` holds it, read once. */
const COUNTER_DEF = marth.moves.downB!.counter as CounterDef;

describe("Marth's Counter", () => {
  it("returns a forward smash at ×1.2, and Marth takes nothing", () => {
    // Marth counters on frame 0; Mario's forward smash (17%, frame 15) lands inside the window.
    // At 16 apart only the fist (the 17.8% sweetspot, id 1) reaches the counter's
    // bubble; closer in, the arm (id 0) reaches it too and wins on its lower id
    // (the next describe).
    const { states, events } = run(duel("mario", 16), 90, FSMASH);
    expect(events.some((e) => e.counters.length > 0)).toBe(true);
    const end = states[states.length - 1];
    expect(end.fighters[1].damage).toBe(0);
    // Mario's forward smash sweetspot (17.8%, game_attacks4) × 1.2, then the
    // counterattack's own fresh-move ×1.05 and one-on-one ×1.2.
    expect(toFloat(end.fighters[0].damage)).toBeCloseTo(17.8 * 1.2 * 1.05 * 1.2, 1);
  });

  it("returns a weak jab at the 8% floor", () => {
    const { states } = run(duel("mario", 12), 90, (i) => [i === 7 ? Btn.Attack : 0, i === 0 ? COUNTER : 0]);
    const end = states[states.length - 1];
    expect(end.fighters[1].damage).toBe(0);
    expect(toFloat(end.fighters[0].damage)).toBeCloseTo(8 * 1.05 * 1.2, 1);
  });

  it("freezes both fighters for 21 frames when it catches", () => {
    const { states, events } = run(duel("mario", 12), 40, (i) => [i === 7 ? Btn.Attack : 0, i === 0 ? COUNTER : 0]);
    const at = events.findIndex((e) => e.counters.length > 0);
    expect(states[at].fighters[1].hitlag).toBe(21);
    expect(states[at].fighters[0].hitlag).toBe(21);
    expect(states[at].fighters[1].move).toBe("counterAttack");
  });

  it("whiffs harmlessly and ends on frame 64", () => {
    const { states } = run(duel("mario", 60), 70, (i) => [0, i === 0 ? COUNTER : 0]);
    expect(states[62].fighters[1].move).toBe("downB");
    expect(states[64].fighters[1].action).toBe("stand");
  });

  it("catches a multi-hit once: Pikachu's looping jab is countered on its first hit and lands none after", () => {
    // Pikachu mashes its looping jab into Marth's counter.
    const { states, events } = run(duel("pikachu", 9), 60, (i) => [i >= 6 && i % 2 === 0 ? Btn.Attack : 0, i === 0 ? COUNTER : 0]);
    expect(events.filter((e) => e.counters.length > 0)).toHaveLength(1);
    expect(states.every((s) => s.fighters[1].damage === 0)).toBe(true);
    expect(states[states.length - 1].fighters[0].damage).toBeGreaterThan(0);
  });

  it("is beaten by a grab", () => {
    const { states, events } = run(duel("mario", 10), 30, (i) => [i === 6 ? Btn.Grab : 0, i === 0 ? COUNTER : 0]);
    expect(events.some((e) => e.counters.length > 0)).toBe(false);
    expect(states.some((s) => s.fighters[1].action === "grabbed")).toBe(true);
  });
});

describe("Review Focus: counter against a projectile", () => {
  it("catches Mario's fireball: the fireball is gone, Marth is untouched, and the riposte whiffs at range", () => {
    const { states, events } = run(duel("mario", 50), 120, (i) => [i === 0 ? Btn.Special : 0, i === 14 ? COUNTER : 0]);
    const at = events.findIndex((e) => e.counters.length > 0);
    expect(at).toBeGreaterThan(0);
    expect(states[at].projectiles).toHaveLength(0);
    expect(states[at].fighters[1].move).toBe("counterAttack");
    // The thrower is not frozen: the projectile's owner is not a party to it.
    expect(states[at].fighters[0].hitlag).toBe(0);
    const end = states[states.length - 1];
    expect(end.fighters[1].damage).toBe(0);
    expect(end.fighters[0].damage).toBe(0);
  });

  it("returns the fireball's 5% × 1.2 at the 8% floor, and Marth still freezes the full 21 frames", () => {
    const { states, events } = run(duel("mario", 50), 120, (i) => [i === 0 ? Btn.Special : 0, i === 14 ? COUNTER : 0]);
    const at = caughtAt(events);
    expect(states[at].fighters[1].combat.counterDamage).toBe(fx(8));
    expect(states[at].fighters[1].hitlag).toBe(21);
    // The thrower acts on through Marth's freeze: its frame moves on.
    expect(states[at + 5].fighters[0].actionFrame).toBeGreaterThan(states[at].fighters[0].actionFrame);
  });

  it("catches what a melee attacker throws and freezes the thrower; a projectile's thrower, never", () => {
    const melee = run(duel("mario", 12), 40, (i) => [i === 7 ? Btn.Attack : 0, i === 0 ? COUNTER : 0]);
    const shot = run(duel("mario", 50), 120, (i) => [i === 0 ? Btn.Special : 0, i === 14 ? COUNTER : 0]);
    expect(melee.states[caughtAt(melee.events)].fighters[0].hitlag).toBe(21);
    expect(shot.states[caughtAt(shot.events)].fighters[0].hitlag).toBe(0);
  });
});

describe("the Counter's published numbers, as data (SmashWiki Marth (SSBU)/Down special)", () => {
  it("holds the window, the bubble, the multiplier and its limits, the freeze, and the move it turns into", () => {
    expect(COUNTER_DEF).toEqual({
      active: [6, 27],
      radius: fx(10.5),
      x: 0,
      y: fx(10),
      multiplier: fx(1.2),
      minDamage: fx(8),
      maxDamage: fx(50),
      freeze: 21,
      then: "counterAttack",
    });
    expect(marth.moves.downB).toMatchObject({ totalFrames: 64, intangible: [5, 6], hitboxes: [] });
  });

  it("gives the counterattack its frames and its boxes: 5-7, 8% at 361°, BKB 90, KBG 60, size 5.5, hitlag ×1.4", () => {
    const move = marth.moves.counterAttack!;
    expect(move).toMatchObject({ totalFrames: 41, intangible: [1, 8], counterDamage: true });
    expect(move.hitboxes.length).toBeGreaterThan(0);
    for (const h of move.hitboxes) {
      expect(h).toMatchObject({
        startFrame: 5,
        endFrame: 7,
        damage: fx(8),
        angle: fx(361),
        baseKnockback: fx(90),
        knockbackGrowth: fx(60),
        radius: fx(5.5),
        hitlagMultiplier: fx(1.4),
      });
    }
  });
});

describe("the counterattack's damage: ×1.2, at least 8%, at most 50%", () => {
  it("multiplies inside the limits and clamps outside them", () => {
    expect(counterDamage(COUNTER_DEF, fx(10))).toBe(mul(fx(10), fx(1.2)));
    expect(counterDamage(COUNTER_DEF, fx(2.2))).toBe(fx(8));
    // 8 / 1.2 = 6.67: just under it is the floor, just over it the product.
    expect(counterDamage(COUNTER_DEF, fx(6.6))).toBe(fx(8));
    expect(counterDamage(COUNTER_DEF, fx(6.7))).toBe(mul(fx(6.7), fx(1.2)));
    // 50 / 1.2 = 41.67: just under it is the product, just over it the cap.
    expect(counterDamage(COUNTER_DEF, fx(41.6))).toBe(mul(fx(41.6), fx(1.2)));
    expect(counterDamage(COUNTER_DEF, fx(41.7))).toBe(fx(50));
    expect(counterDamage(COUNTER_DEF, fx(45))).toBe(fx(50));
  });

  it("returns the hit it caught: the fist's 17.8% alone at 16 apart, and the arm's 14.7% (id 0) when both reach the bubble at 12", () => {
    const far = run(duel("mario", 16), 30, FSMASH);
    const near = run(duel("mario", 12), 30, FSMASH);
    expect(far.states[caughtAt(far.events)].fighters[1].combat.counterDamage).toBe(mul(fx(17.8), fx(1.2)));
    expect(near.states[caughtAt(near.events)].fighters[1].combat.counterDamage).toBe(mul(fx(14.7), fx(1.2)));
  });

  it("returns a charged smash with its charge: the caught damage is the box's with the smash's multiplier", () => {
    // Mario holds his forward smash 17 frames (Attack held to step 30) and lets it
    // go into the counter; the fist alone reaches the bubble at 16 apart.
    const { states, events } = run(duel("mario", 16), 40, (i) => [
      i === 0 ? Btn.Right : i === 1 ? Btn.Right | Btn.Attack : i <= 30 ? Btn.Attack : 0,
      i === 21 ? COUNTER : 0,
    ]);
    const at = caughtAt(events);
    const charge = states[at].fighters[0].charge;
    expect(charge).toBeGreaterThan(0);
    expect(states[at].fighters[1].combat.counterDamage).toBe(mul(mul(fx(17.8), chargeMultiplier(charge)), fx(1.2)));
  });

  it("returns a jab at the floor exactly", () => {
    const { states, events } = run(duel("mario", 12), 40, (i) => [i === 7 ? Btn.Attack : 0, i === 0 ? COUNTER : 0]);
    expect(states[caughtAt(events)].fighters[1].combat.counterDamage).toBe(fx(8));
  });

  it("caps a 45% hit at 50%, and the riposte deals that 50% (×1.05 fresh, ×1.2 one-on-one)", () => {
    // A stand-in whose forward smash hits for 45%: nothing on the roster hits that hard.
    const fsmash = mario.moves.fsmash!;
    const hitter: FighterDef = {
      ...mario,
      id: "hitter",
      moves: { ...mario.moves, fsmash: { ...fsmash, hitboxes: fsmash.hitboxes.map((h) => ({ ...h, damage: fx(45) })) } },
    };
    const ctx: SimContext = { ...registryContext, fighter: (id) => (id === "hitter" ? hitter : registryContext.fighter(id)) };
    const { states, events } = run(duel("hitter", 16), 90, FSMASH, ctx);
    expect(states[caughtAt(events)].fighters[1].combat.counterDamage).toBe(fx(50));
    // Read off the hit: a 63% riposte at BKB 90 sends the hitter off the stage.
    const riposte = events.flatMap((e) => e.hits).find((h) => h.attacker === 1);
    expect(toFloat(riposte!.damage)).toBeCloseTo(50 * 1.05 * 1.2, 1);
    expect(states.every((s) => s.fighters[1].damage === 0)).toBe(true);
  });
});

describe("the riposte", () => {
  /** The fist-only forward smash: caught on its first live frame, the riposte in reach. */
  const scene = () => {
    const r = run(duel("mario", 16), 90, FSMASH);
    const at = caughtAt(r.events);
    const hitAt = r.events.findIndex((e) => e.hits.some((h) => h.attacker === 1));
    return { ...r, at, hitAt, hit: r.events[hitAt].hits.find((h) => h.attacker === 1)! };
  };

  it("strikes on its frame 5, after the 21-frame freeze spent on its frame 1", () => {
    const { states, at, hitAt } = scene();
    // Caught on the forward smash's first live frame, frame 15.
    expect(states[at].fighters[0]).toMatchObject({ move: "fsmash", actionFrame: 14 });
    expect(states[at].fighters[1]).toMatchObject({ action: "special", move: "counterAttack", actionFrame: 0 });
    // Neither moves through the freeze…
    expect(states[at + 21].fighters[1].actionFrame).toBe(0);
    expect(states[at + 21].fighters[0].actionFrame).toBe(14);
    // …then both go on together, and the boxes go live on frame 5.
    expect(states[at + 22].fighters[1].actionFrame).toBe(1);
    expect(states[at + 22].fighters[0].actionFrame).toBe(15);
    expect(hitAt).toBe(at + 21 + 4);
    expect(states[hitAt].fighters[1].actionFrame).toBe(4);
  });

  it("launches with BKB 90 and KBG 60 on the counter's damage, at the Sakurai angle, and freezes by its hitlag ×1.4", () => {
    const { states, hitAt, hit } = scene();
    const victim = states[hitAt].fighters[0];
    // The riposte's damage is the caught 17.8 × 1.2, fresh (×1.05) and one-on-one (×1.2).
    const caught = mul(fx(17.8), fx(1.2));
    expect(toFloat(hit.damage)).toBeCloseTo(17.8 * 1.2 * 1.05 * 1.2, 2);
    // The knockback formula's `d` is staled only 30% (`computeStaleness`): fresh, ×1.015.
    const kbDamage = mul(mul(caught, computeStaleness([], "counterAttack").knockback), ONE_ON_ONE_MULTIPLIER);
    const kb = computeKnockback({
      percent: victim.damage,
      damage: kbDamage,
      weight: mario.attributes.weight,
      baseKnockback: fx(90),
      knockbackGrowth: fx(60),
      rage: ONE,
    });
    expect(hit.knockback).toBe(kb);
    // 361 on a grounded victim: the angle rises with the knockback (Sakurai angle).
    expect(victim.pendingAngle).toBe(resolveAngle({ angle: fx(361) }, true, kb));
    expect(victim.hitlag).toBe(computeHitlag(hit.damage, { moveMultiplier: fx(1.4) }));
  });

  it("deals its own 8% only when the counter caught nothing: the damage it deals is the counter's", () => {
    // Placed by hand, a counterattack that caught a 30% hit (36 back).
    const s = duel("mario", 10);
    Object.assign(s.fighters[1], { action: "special", move: "counterAttack", actionFrame: 3 });
    s.fighters[1].combat.counterDamage = fx(36);
    const { events } = run(s, 3, () => [0, 0]);
    const hit = events.flatMap((e) => e.hits).find((h) => h.attacker === 1)!;
    expect(toFloat(hit.damage)).toBeCloseTo(36 * 1.05 * 1.2, 2);
  });

  it("whiffs at range: a hit caught at the bubble's edge is out of the riposte's reach", () => {
    // At 22 apart the fist meets the bubble; Mario stands beyond the cut.
    const { states, events } = run(duel("mario", 22), 90, FSMASH);
    expect(caughtAt(events)).toBeGreaterThan(0);
    expect(states[states.length - 1].fighters[0].damage).toBe(0);
    expect(states[states.length - 1].fighters[1].damage).toBe(0);
  });
});

describe("the window: frames 6-27, intangible 5-6", () => {
  // Mario jabs on step 30; standing, Marth is hit on step 31 (the jab's frame 2,
  // live 2-3). Marth counters on step 31 − (g − 1), so the jab's first live frame
  // meets his move frame g.
  const JAB_STEP = 30;
  const FIRST_LIVE = JAB_STEP + 1;
  const jabOn = (g: number) =>
    run(duel("mario", 10), 70, (i) => [i === JAB_STEP ? Btn.Attack : 0, i === FIRST_LIVE - (g - 1) ? COUNTER : 0]);

  it("the jab lands where it does on a Marth standing still (the scene's control)", () => {
    const { events } = run(duel("mario", 10), 40, (i) => [i === JAB_STEP ? Btn.Attack : 0, 0]);
    expect(events.findIndex((e) => e.hits.length > 0)).toBe(FIRST_LIVE);
  });

  it("frame 4 is startup: the jab hits Marth", () => {
    const { states, events } = jabOn(4);
    expect(caughtAt(events)).toBe(-1);
    expect(states[FIRST_LIVE].fighters[1].damage).toBeGreaterThan(0);
  });

  it("frame 5 is intangible, and the jab's second live frame meets the window's first, frame 6", () => {
    const { states, events } = jabOn(5);
    expect(caughtAt(events)).toBe(FIRST_LIVE + 1);
    expect(states.every((s) => s.fighters[1].damage === 0)).toBe(true);
  });

  it("frame 6 catches", () => {
    expect(caughtAt(jabOn(6).events)).toBe(FIRST_LIVE);
  });

  it("frame 27 catches", () => {
    expect(caughtAt(jabOn(27).events)).toBe(FIRST_LIVE);
  });

  it("frame 28 is past it: the jab hits Marth", () => {
    const { states, events } = jabOn(28);
    expect(caughtAt(events)).toBe(-1);
    expect(states[FIRST_LIVE].fighters[1].damage).toBeGreaterThan(0);
  });

  it("is intangible on its own frames 5-6 only, whiffing", () => {
    const { states } = run(duel("mario", 60), 70, (i) => [0, i === 0 ? COUNTER : 0]);
    const intangible = states.flatMap((s) => (s.fighters[1].action === "special" && s.fighters[1].intangible > 0 ? [s.fighters[1].actionFrame + 1] : []));
    expect(intangible).toEqual([5, 6]);
  });

  it("names the frames `activeCounter` gives out", () => {
    const f = duel("mario", 60).fighters[1];
    const out: number[] = [];
    for (let g = 1; g <= 64; g++) {
      Object.assign(f, { action: "special", move: "downB", actionFrame: g - 1 });
      if (activeCounter(f, marth) !== null) out.push(g);
    }
    expect(out[0]).toBe(6);
    expect(out[out.length - 1]).toBe(27);
    expect(out).toHaveLength(22);
  });
});

describe("intangible through the freeze and the counterattack's frames 1-8", () => {
  it("is never hittable from the catch to its frame 8, and is from frame 9", () => {
    // Caught at the bubble's edge, so the riposte whiffs and its own hitlag
    // does not interrupt the count.
    const { states, events } = run(duel("mario", 22), 90, FSMASH);
    const at = caughtAt(events);
    const riposte = states.slice(at).filter((s) => s.fighters[1].move === "counterAttack");
    for (const s of riposte) {
      const frame = s.fighters[1].actionFrame + 1;
      expect(s.fighters[1].intangible > 0, `frame ${frame}, hitlag ${s.fighters[1].hitlag}`).toBe(frame <= 8);
    }
    // The freeze is all on frame 1, intangible throughout.
    expect(riposte.filter((s) => s.fighters[1].actionFrame === 0)).toHaveLength(22);
  });
});

describe("the bubble: 10.5 round a centre 10 above his feet", () => {
  // A plain pellet from a stand-in moveset that only the projectile lookup reads
  // (as in `reflect.test.ts`), flying level at a chosen height into the guard.
  const PELLET: ProjectileDef = {
    id: "pellet",
    spawnFrame: 1,
    offsetX: 0,
    offsetY: 0,
    vx: fx(2),
    vy: 0,
    gravity: 0,
    lifetime: 60,
    destroyOnHit: true,
    visual: "energy",
    hitbox: { id: 0, startFrame: 0, endFrame: 60, x: 0, y: 0, radius: fx(2), damage: fx(5), angle: fx(45), baseKnockback: fx(30), knockbackGrowth: fx(50) },
  };
  const ZONER: FighterDef = { ...mario, id: "zoner", moves: { neutralB: { slot: "neutralB", name: "Pellet", totalFrames: 20, hitboxes: [], projectiles: [PELLET] } } };
  const withZoner = (marthDef: FighterDef = marth): SimContext => ({
    ...registryContext,
    fighter: (id) => (id === "zoner" ? ZONER : id === "marth" ? marthDef : registryContext.fighter(id)),
  });

  /** Marth (at x 30) countering on move frame 11; pellets of Mario's flying at him at these heights, from these x. */
  function volley(shots: readonly { x: number; y: number }[]): GameState {
    const s = duel("mario", 60);
    Object.assign(s.fighters[1], { action: "special", move: "downB", actionFrame: 10 });
    shots.forEach((at, k) => {
      const p = spawnProjectile(PELLET, s.fighters[0], k + 1, "zoner");
      Object.assign(p, { x: fx(at.x), y: fx(at.y), vx: fx(2), facing: 1, age: 5 });
      s.projectiles.push(p);
    });
    s.nextProjectileId = shots.length + 1;
    return s;
  }

  it("catches a pellet passing over his head, inside the bubble's top (centre 10, radius 10.5, pellet 2: up to 22.5)", () => {
    // At 18 high the pellet never reaches Marth's body (13 tall): only the bubble.
    const { states, events } = run(volley([{ x: 10, y: 18 }]), 16, () => [0, 0], withZoner());
    expect(caughtAt(events)).toBeGreaterThanOrEqual(0);
    expect(states[states.length - 1].fighters[1].move).toBe("counterAttack");
  });

  it("lets a pellet above the bubble's top fly past", () => {
    const { states, events } = run(volley([{ x: 10, y: 23 }]), 30, () => [0, 0], withZoner());
    expect(caughtAt(events)).toBe(-1);
    expect(states[states.length - 1].fighters[1].damage).toBe(0);
    expect(states[states.length - 1].projectiles).toHaveLength(1);
  });

  it("misses with a second source that reached only the bubble once the counter has gone, even with no intangibility to stop it", () => {
    // A stand-in counterattack with no intangibility, so nothing but the body
    // test stands between the second pellet and Marth. Both pellets meet the
    // bubble on the first step: the first (the lower key) sets the counter off;
    // the second, high over his head, never reaches his body.
    const counterAttack = Object.fromEntries(Object.entries(marth.moves.counterAttack!).filter(([k]) => k !== "intangible")) as unknown as MoveDef;
    const bare: FighterDef = { ...marth, moves: { ...marth.moves, counterAttack } };
    const { states, events } = run(volley([{ x: 16.5, y: 7 }, { x: 19, y: 18 }]), 12, () => [0, 0], withZoner(bare));
    expect(caughtAt(events)).toBe(0);
    expect(events.flatMap((e) => e.counters)).toHaveLength(1);
    expect(states.every((s2) => s2.fighters[1].damage === 0)).toBe(true);
  });
});

describe("the hit it catches is spent", () => {
  it("a box still live after the counterattack's intangibility does not hit Marth again", () => {
    // A stand-in forward smash: one long box, live 15-60, 20 out, so it reaches
    // Marth's body from 22 apart, where the riposte cannot reach back. Marth is
    // intangible to his counterattack's frame 8; the box is still live after it.
    const fsmash = mario.moves.fsmash!;
    const poker: FighterDef = {
      ...mario,
      id: "poker",
      moves: {
        ...mario.moves,
        fsmash: {
          ...fsmash,
          totalFrames: 70,
          // Transcendent, so it cannot clank with the riposte and end itself there.
          hitboxes: [{ id: 0, startFrame: 15, endFrame: 60, x: fx(20), y: fx(8), radius: fx(3), damage: fx(5), angle: fx(361), baseKnockback: fx(30), knockbackGrowth: fx(50), transcendent: true }],
        },
      },
    };
    const ctx: SimContext = { ...registryContext, fighter: (id) => (id === "poker" ? poker : registryContext.fighter(id)) };
    const { states, events } = run(duel("poker", 22), 80, FSMASH, ctx);
    const at = caughtAt(events);
    expect(at).toBeGreaterThan(0);
    // Past the counterattack's intangibility, and the box still out.
    const later = states.findIndex((s) => s.fighters[1].move === "counterAttack" && s.fighters[1].actionFrame === 12);
    expect(later).toBeGreaterThan(at);
    expect(states[later].fighters[0]).toMatchObject({ move: "fsmash" });
    expect(states[later].fighters[1].intangible).toBe(0);
    expect(states.every((s) => s.fighters[1].damage === 0)).toBe(true);
  });
});

describe("what the counter does not catch", () => {
  it("an invincible Marth's counter does not trigger: the hit connects and transfers nothing", () => {
    // SmashWiki "Counterattack": "Counterattacks also do not trigger if the
    // fighter is invincible, even if the opponent hits them."
    const s = duel("mario", 12);
    s.fighters[1].invincible = 60;
    const { states, events } = run(s, 40, (i) => [i === 7 ? Btn.Attack : 0, i === 0 ? COUNTER : 0]);
    expect(caughtAt(events)).toBe(-1);
    const hit = events.flatMap((e) => e.hits).find((h) => h.victim === 1);
    expect(hit?.damage).toBe(0);
    expect(states[states.length - 1].fighters[1].damage).toBe(0);
    expect(states.some((s2) => s2.fighters[1].move === "counterAttack")).toBe(false);
  });

  it("catches a hit from behind, keeps facing the way it faced, and cuts at nothing (UNVERIFIED: no turn)", () => {
    const s = duel("mario", 10);
    s.fighters[1].facing = 1; // Marth faces away from Mario
    const { states, events } = run(s, 90, (i) => [i === 7 ? Btn.Attack : 0, i === 0 ? COUNTER : 0]);
    const at = caughtAt(events);
    expect(at).toBeGreaterThan(0);
    expect(states[at].fighters[1].facing).toBe(1);
    expect(states[states.length - 1].fighters[0].damage).toBe(0);
    expect(states[states.length - 1].fighters[1].damage).toBe(0);
  });
});

describe("the counterattack's damage leaves with the move", () => {
  /** Marth in the counterattack on `actionFrame`, carrying a caught hit, Mario beside him. */
  function riposting(over: Partial<FighterState>, gap = 10): GameState {
    const s = duel("mario", gap);
    Object.assign(s.fighters[1], { action: "special", move: "counterAttack", actionFrame: 15, ...over });
    s.fighters[1].combat.counterDamage = fx(12);
    return s;
  }

  it("at its own end", () => {
    const { states } = run(riposting({ actionFrame: 38 }, 60), 6, () => [0, 0]);
    const end = states[states.length - 1].fighters[1];
    expect(end.action).toBe("stand");
    expect(end.combat.counterDamage).toBe(0);
  });

  it("on a hit, past its intangible frames", () => {
    const { states } = run(riposting({}), 6, (i) => [i === 0 ? Btn.Attack : 0, 0]);
    const hit = states.find((s) => s.fighters[1].action === "hitstun" || s.fighters[1].action === "tumble");
    expect(hit, "Marth was never hit").toBeDefined();
    expect(hit!.fighters[1].combat.counterDamage).toBe(0);
  });

  it("on being grabbed", () => {
    const { states } = run(riposting({}), 12, (i) => [i === 0 ? Btn.Grab : 0, 0]);
    const held = states.find((s) => s.fighters[1].action === "grabbed");
    expect(held, "Marth was never grabbed").toBeDefined();
    expect(held!.fighters[1].combat.counterDamage).toBe(0);
  });

  it("on landing", () => {
    const { states } = run(riposting({ grounded: false, platform: -1, y: fx(1), vy: -fx(1) }, 60), 4, () => [0, 0]);
    const landed = states.find((s) => s.fighters[1].grounded);
    expect(landed, "Marth never landed").toBeDefined();
    expect(landed!.fighters[1].action).not.toBe("special");
    expect(landed!.fighters[1].combat.counterDamage).toBe(0);
  });

  it("on a ledge", () => {
    // Final Destination's right ledge is at x 80, its surface at y 0.
    const { states } = run(riposting({ grounded: false, platform: -1, x: fx(81.5), y: fx(-1), vy: -fx(0.5), facing: -1 }, 60), 1, () => [0, 0]);
    expect(states[0].fighters[1].action).toBe("ledgeHang");
    expect(states[0].fighters[1].combat.counterDamage).toBe(0);
  });

  it("on a KO", () => {
    const { states } = run(riposting({ grounded: false, platform: -1, y: fx(-139), vy: -fx(2) }, 60), 1, () => [0, 0]);
    expect(states[0].fighters[1].action).toBe("dead");
    expect(states[0].fighters[1].combat.counterDamage).toBe(0);
  });

  it("however the special is left: every status it can change to", () => {
    for (const to of Object.keys(STATUS_KIND_OF_ACTION) as ActionState[]) {
      const f = riposting({}).fighters[1];
      changeStatus(f, to);
      expect(f.combat.counterDamage, `counterAttack to ${to}`).toBe(0);
    }
  });
});

describe("rollback", () => {
  it("re-simulates identically from mid-window, mid-freeze and mid-riposte", () => {
    const live = run(duel("mario", 16), 90, FSMASH).states;
    const at = caughtAt(run(duel("mario", 16), 90, FSMASH).events);
    for (const from of [at - 3, at + 10, at + 24]) {
      const snapshot = cloneState(live[from]);
      let s = snapshot;
      let prev = FSMASH(from);
      for (let i = from + 1; i < live.length; i++) {
        const now = FSMASH(i);
        s = step(s, now, { prevInputs: prev }).state;
        prev = now;
        expect(hashState(s), `from step ${from}, step ${i}`).toBe(hashState(live[i]));
      }
    }
    // The snapshots are where they claim to be.
    expect(live[at - 3].fighters[1].move).toBe("downB");
    expect(live[at + 10].fighters[1]).toMatchObject({ move: "counterAttack", actionFrame: 0 });
    expect(live[at + 24].fighters[1]).toMatchObject({ move: "counterAttack", actionFrame: 3 });
    expect(live[at + 24].fighters[1].combat.counterDamage).toBe(mul(fx(17.8), fx(1.2)));
  });

  it("hashes the caught damage, so a rollback that lost it would be seen", () => {
    const s = duel("mario", 16);
    Object.assign(s.fighters[1], { action: "special", move: "counterAttack", actionFrame: 3 });
    const before = hashState(s);
    s.fighters[1].combat.counterDamage = fx(12);
    expect(hashState(s)).not.toBe(before);
    expect(cloneState(s).fighters[1].combat.counterDamage).toBe(fx(12));
  });
});
