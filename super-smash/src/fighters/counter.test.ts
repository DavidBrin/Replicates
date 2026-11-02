/**
 * Marth's Counter, through the real `step()` (Plan 5, Task 5). SmashWiki
 * "Marth (SSBU)/Down special": catches hits on frames 6–27; returns ×1.2,
 * at least 8%, at most 50%; both freeze 21 frames, the catch's own frame the
 * first of them (Plan 5, Task 7b: `framesAfterHit`); a grab goes through.
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
 *   total 64, "Counter window 6-27"; "Counter, Attack" startup 4, active 4—6,
 *   "Intangible on frame 1-7 in addition to counter freeze frames": counted
 *   from the end of the freeze, the counterattack's frame 1 spent inside it.
 * - SmashWiki "Counterattack" (https://www.ssbwiki.com/Counterattack): a grab
 *   "is immune to counterattacks"; "Counterattacks also do not trigger if the
 *   fighter is invincible".
 * - The attacks Marth catches: Mario's jab (`game_attack11`, 2.2%, live 2-3),
 *   forward smash (legacy table: arm 14.7% id 0, fist 17.8% id 1, live 15-17),
 *   fireball (5%), and Pikachu's jab loop; `acmd/generated/*.ts`, `mario.ts`.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ATTACK, clearAll, frame, script, wait } from "@/engine/acmd/dsl";
import { STRONG_COUNTER_WINDOW } from "@/audio";
import { STRONG_COUNTER_DAMAGE, activeCounter, counterBubble, counterDamage } from "@/engine/counter";
import { fx, mul, ONE, toFloat } from "@/engine/fixed";
import { circle, contactPoint } from "@/engine/hitbox";
import { hashState } from "@/engine/hash";
import { findProjectileDef, spawnProjectile } from "@/engine/projectile";
import { ONE_ON_ONE_MULTIPLIER } from "@/engine/constants";
import { computeHitlag, computeKnockback, computeStaleness, resolveAngle } from "@/engine/knockback";
import { cloneState, createInitialState, registerFighters, registerStages, registryContext, step } from "@/engine/simulate";
import type { SimContext } from "@/engine/simulate";
import { chargeMultiplier } from "@/engine/states";
import { changeStatus, STATUS_KIND_OF_ACTION } from "@/engine/status/kind";
import { Btn } from "@/engine/types";
import type { ActionState, CounterDef, FighterDef, FighterState, GameState, InputFrame, MatchRules, MoveDef, ProjectileDef, StepEvents } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS, fox, link, mario, marth } from "./index";

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

/**
 * A plain pellet from a stand-in moveset that only the projectile lookup reads
 * (as in `reflect.test.ts`), flying level at a chosen height.
 */
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

/** A pellet of port 0's at (x, y), flying +x at 2 a frame. */
function pelletAt(s: GameState, id: number, x: number, y: number): void {
  const p = spawnProjectile(PELLET, s.fighters[0], id, "zoner");
  Object.assign(p, { x, y, vx: fx(2), facing: 1, age: 5 });
  s.projectiles.push(p);
  s.nextProjectileId = Math.max(s.nextProjectileId, id + 1);
}

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

  // The 21 frames count the one the counter catches on (Plan 5, Task 7b), so 20
  // follow it, and Marth shows the counterattack's frame 1 for all 21.
  it("freezes both fighters for 21 frames when it catches, the catch's own frame the first", () => {
    const { states, events } = run(duel("mario", 12), 40, (i) => [i === 7 ? Btn.Attack : 0, i === 0 ? COUNTER : 0]);
    const at = events.findIndex((e) => e.counters.length > 0);
    expect(states[at].fighters[1].hitlag).toBe(21 - 1);
    expect(states[at].fighters[0].hitlag).toBe(21 - 1);
    expect(states[at].fighters[1].move).toBe("counterAttack");
    expect(states.filter((s) => s.fighters[1].move === "counterAttack" && s.fighters[1].actionFrame === 0)).toHaveLength(21);
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

  it("reports the damage it caught, the box's own, for the presentation's strong catch (Task 17)", () => {
    // Mario's forward smash sweetspot, 17.8 (`game_attacks4`): over the 13% a strong catch needs.
    const smash = run(duel("mario", 16), 30, FSMASH).events;
    expect(toFloat(smash[caughtAt(smash)].counters[0].damage)).toBeCloseTo(17.8, 3);
    expect(smash[caughtAt(smash)].counters[0].damage).toBeGreaterThanOrEqual(STRONG_COUNTER_DAMAGE);
    // A jab is under it.
    const jab = run(duel("mario", 12), 30, (i) => [i === 7 ? Btn.Attack : 0, i === 0 ? COUNTER : 0]).events;
    expect(jab[caughtAt(jab)].counters[0].damage).toBeLessThan(STRONG_COUNTER_DAMAGE);
    // A charged smash's, with its charge, as the counter multiplies it: the
    // counterattack's damage is the counter's own of what the report says.
    const charged = run(duel("mario", 16), 80, (i) => [i === 0 ? Btn.Right : i >= 1 && i <= 21 ? Btn.Right | Btn.Attack : 0, i === 24 ? COUNTER : 0]);
    const at = caughtAt(charged.events);
    expect(at).toBeGreaterThan(0);
    const caught = charged.events[at].counters[0].damage;
    expect(caught).toBeGreaterThan(fx(17.8));
    expect(charged.states[at].fighters[1].combat.counterDamage).toBe(counterDamage(COUNTER_DEF, caught));
  });

  it("lands its counterattack inside the audio's window for the strong catch's ring (Task 17 fix round 1)", () => {
    // The ring plays on the counter user's first hit within STRONG_COUNTER_WINDOW
    // frames of the catch (`audio/index.ts`). Mario's forward smash, plain and
    // charged: Marth's counterattack strikes 24 frames after the catch.
    for (const script of [FSMASH, (i: number): [InputFrame, InputFrame] => [i === 0 ? Btn.Right : i >= 1 && i <= 21 ? Btn.Right | Btn.Attack : 0, i === 24 ? COUNTER : 0]]) {
      const { events } = run(duel("mario", 16), 90, script);
      const caught = caughtAt(events);
      const struck = events.findIndex((e, i) => i > caught && e.hits.some((h) => h.attacker === 1));
      expect(caught).toBeGreaterThan(0);
      expect(struck - caught).toBe(24);
      expect(struck - caught).toBeLessThan(STRONG_COUNTER_WINDOW);
    }
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
    // 21 frames counting the catch's (Plan 5, Task 7b).
    expect(states[at].fighters[1].hitlag).toBe(21 - 1);
    // The thrower acts on through Marth's freeze: its frame moves on.
    expect(states[at + 5].fighters[0].actionFrame).toBeGreaterThan(states[at].fighters[0].actionFrame);
  });

  it("catches what a melee attacker throws and freezes the thrower; a projectile's thrower, never", () => {
    const melee = run(duel("mario", 12), 40, (i) => [i === 7 ? Btn.Attack : 0, i === 0 ? COUNTER : 0]);
    const shot = run(duel("mario", 50), 120, (i) => [i === 0 ? Btn.Special : 0, i === 14 ? COUNTER : 0]);
    // 21 frames counting the catch's (Plan 5, Task 7b).
    expect(melee.states[caughtAt(melee.events)].fighters[0].hitlag).toBe(21 - 1);
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

  it("holds the aerial Counter's physics and lengths (fix round 1): ×0.5, friction 0.0025, gravity 0.04, fall speed 1.2; 79 and 51 frames", () => {
    const stall = { startX: fx(0.5), boostY: 0, noGravityFrames: 0, gravity: fx(0.04), fallSpeed: fx(1.2), airFriction: fx(0.0025), everyUse: true };
    expect(marth.moves.downB).toMatchObject({ stall, airTotalFrames: 79 });
    expect(marth.moves.counterAttack).toMatchObject({ stall, airTotalFrames: 51 });
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
        // Fix round 1: `clang=f` (SETOFF_KIND_OFF), and `set_force_reaction`.
        transcendent: true,
        forceReaction: true,
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
    // Mario holds his forward smash (Attack held to step 30) from its published hold
    // on frame 5 (Plan 5, Task 13 fix round 2) and lets it go into the counter, its
    // box out 10 frames later; the fist alone reaches the bubble at 16 apart.
    const { states, events } = run(duel("mario", 16), 60, (i) => [
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

  // The 21 frames count the catch's own (Plan 5, Task 7b): UFD's "Counter, Attack"
  // startup 4 (https://ultimateframedata.com/marth) is SmashWiki's frame 5, 4 frames
  // after the freeze's last.
  it("strikes on its frame 5, 4 frames after the 21-frame freeze spent on its frame 1", () => {
    const { states, at, hitAt } = scene();
    // Caught on the forward smash's first live frame, frame 15.
    expect(states[at].fighters[0]).toMatchObject({ move: "fsmash", actionFrame: 14 });
    expect(states[at].fighters[1]).toMatchObject({ action: "special", move: "counterAttack", actionFrame: 0 });
    // Neither moves through the freeze, the catch's frame and 20 more…
    expect(states[at + 20].fighters[1].actionFrame).toBe(0);
    expect(states[at + 20].fighters[0].actionFrame).toBe(14);
    // …then both go on together, and the boxes go live on frame 5.
    expect(states[at + 21].fighters[1].actionFrame).toBe(1);
    expect(states[at + 21].fighters[0].actionFrame).toBe(15);
    expect(hitAt).toBe(at + 20 + 4);
    expect(states[hitAt].fighters[1].actionFrame).toBe(4);
  });

  it("launches with BKB 90 and KBG 60 on the counter's damage, at the Sakurai angle, and freezes by its hitlag ×1.4", () => {
    const { states, hitAt, hit } = scene();
    const victim = states[hitAt].fighters[0];
    // The riposte's damage is the caught 17.8 × 1.2, fresh (×1.05) and one-on-one (×1.2).
    const caught = mul(fx(17.8), fx(1.2));
    expect(toFloat(hit.damage)).toBeCloseTo(17.8 * 1.2 * 1.05 * 1.2, 2);
    // The knockback formula's `d` is staled only 30% (`computeStaleness`): fresh, ×1.015.
    // The one-on-one bonus is on the damage alone (ruling R-7b-b; SmashWiki "Armor",
    // https://www.ssbwiki.com/Armor: "knockback is calculated before the 1v1 multiplier
    // is applied to damage"): not in `d`, and not in the percent, which is Mario's
    // before the hit and the hit's damage without the bonus.
    const kbDamage = mul(caught, computeStaleness([], "counterAttack").knockback);
    const dealtBefore1v1 = mul(caught, computeStaleness([], "counterAttack").damage);
    expect(hit.damage).toBe(mul(dealtBefore1v1, ONE_ON_ONE_MULTIPLIER));
    const kb = computeKnockback({
      percent: victim.damage - hit.damage + dealtBefore1v1,
      damage: kbDamage,
      weight: mario.attributes.weight,
      baseKnockback: fx(90),
      knockbackGrowth: fx(60),
      rage: ONE,
    });
    expect(hit.knockback).toBe(kb);
    // 361 on a grounded victim: the angle rises with the knockback (Sakurai angle).
    expect(victim.pendingAngle).toBe(resolveAngle({ angle: fx(361) }, true, kb));
    // The freeze reads the damage without the one-on-one ×1.2 (SmashWiki "Hitlag",
    // https://www.ssbwiki.com/Hitlag: "The 1v1 multiplier and shield damage are not
    // factored"): ⌊(22.428 × 0.65 + 6) × 1.4⌋ = 28 frames, counting the hit's, so 27
    // after it (Plan 5, Task 7b). One-on-one, 26.9% would freeze the cap, 30.
    const lagDamage = mul(caught, computeStaleness([], "counterAttack").damage);
    expect(computeHitlag(lagDamage, { moveMultiplier: fx(1.4) })).toBe(28);
    expect(computeHitlag(hit.damage, { moveMultiplier: fx(1.4) })).toBe(30);
    expect(victim.hitlag).toBe(28 - 1);
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
    // The freeze is all on frame 1, intangible throughout: its 21 frames, the
    // catch's the first (Plan 5, Task 7b).
    expect(riposte.filter((s) => s.fighters[1].actionFrame === 0)).toHaveLength(21);
  });
});

describe("the bubble: 10.5 round a centre 10 above his feet", () => {
  /** Marth (at x 30) countering on move frame 11; pellets of Mario's flying at him at these heights, from these x. */
  function volley(shots: readonly { x: number; y: number }[]): GameState {
    const s = duel("mario", 60);
    Object.assign(s.fighters[1], { action: "special", move: "downB", actionFrame: 10 });
    shots.forEach((at, k) => pelletAt(s, k + 1, fx(at.x), fx(at.y)));
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
  /**
   * A stand-in forward smash: one long box, live 15-60, 20 out, so it reaches
   * Marth's body from 22 apart, where the riposte cannot reach back. Marth is
   * intangible to his counterattack's frame 8; the box is still live after it.
   */
  function poke(transcendent: boolean) {
    const fsmash = mario.moves.fsmash!;
    const poker: FighterDef = {
      ...mario,
      id: "poker",
      moves: {
        ...mario.moves,
        fsmash: {
          ...fsmash,
          totalFrames: 70,
          hitboxes: [{ id: 0, startFrame: 15, endFrame: 60, x: fx(20), y: fx(8), radius: fx(3), damage: fx(5), angle: fx(361), baseKnockback: fx(30), knockbackGrowth: fx(50), transcendent }],
        },
      },
    };
    const ctx: SimContext = { ...registryContext, fighter: (id) => (id === "poker" ? poker : registryContext.fighter(id)) };
    return run(duel("poker", 22), 80, FSMASH, ctx);
  }

  it("a box still live after the counterattack's intangibility does not hit Marth again", () => {
    // Transcendent, so this asks only about the hit record (the next test has the clank).
    const { states, events } = poke(true);
    const at = caughtAt(events);
    expect(at).toBeGreaterThan(0);
    // Past the counterattack's intangibility, and the box still out.
    const later = states.findIndex((s) => s.fighters[1].move === "counterAttack" && s.fighters[1].actionFrame === 12);
    expect(later).toBeGreaterThan(at);
    expect(states[later].fighters[0]).toMatchObject({ move: "fsmash" });
    expect(states[later].fighters[1].intangible).toBe(0);
    expect(states.every((s) => s.fighters[1].damage === 0)).toBe(true);
  });

  it("and a box that can clank meets the riposte without a clank (fix round 1: clang=f)", () => {
    const { states, events } = poke(false);
    expect(caughtAt(events)).toBeGreaterThan(0);
    expect(events.flatMap((e) => e.clanks)).toEqual([]);
    // The riposte played out instead of rebounding into a stand.
    expect(states.some((s) => s.fighters[1].move === "counterAttack" && s.fighters[1].actionFrame === 12)).toBe(true);
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
    for (const from of [at - 3, at + 10, at + 23]) {
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
    expect(live[at + 23].fighters[1]).toMatchObject({ move: "counterAttack", actionFrame: 3 });
    expect(live[at + 23].fighters[1].combat.counterDamage).toBe(mul(fx(17.8), fx(1.2)));
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

describe("fix round 1: a move's own intangibility holds through its owner's hitlag", () => {
  it("keeps the riposte's frames 5-8 intangible through its own hit's hitlag, so a pellet in flight passes through", () => {
    const live = run(duel("mario", 16), 90, FSMASH);
    const hitAt = live.events.findIndex((e) => e.hits.some((h) => h.attacker === 1));
    expect(hitAt).toBeGreaterThan(0);
    const frozen = live.states.filter((s, i) => i >= hitAt && s.fighters[1].move === "counterAttack" && s.fighters[1].hitlag > 0);
    // The riposte's hitlag ×1.4 holds it on frame 5 for its whole length…
    expect(frozen.length).toBeGreaterThan(20);
    for (const s of frozen) {
      expect(s.fighters[1].actionFrame).toBe(4);
      // …and frame 5 is in "Intangibility 1-8".
      expect(s.fighters[1].intangible, `hitlag ${s.fighters[1].hitlag}`).toBeGreaterThan(0);
    }
    // A pellet of Mario's already at Marth's body as the riposte connects.
    const s = cloneState(live.states[hitAt]);
    pelletAt(s, 1, s.fighters[1].x - fx(3), fx(7));
    const after = run(s, 8, () => [0, 0], withZoner());
    expect(after.states.every((t) => t.fighters[1].hitlag > 0)).toBe(true);
    expect(after.events.flatMap((e) => e.hits).filter((h) => h.victim === 1)).toEqual([]);
    expect(after.states[after.states.length - 1].fighters[1].damage).toBe(0);
  });

  it("does the same for Fox's Reflector: intangible 2-3, its 2% connecting on frame 3, held through that hit's hitlag", () => {
    // SmashWiki "Fox (SSBU)/Down special" (https://www.ssbwiki.com/Fox_(SSBU)/Down_special):
    // intangibility 2-3 (`fox.ts`, `intangible: [2, 3]`), the box live on frame 3.
    expect(fox.moves.downB?.intangible).toEqual([2, 3]);
    const s = createInitialState("finalDestination", [{ defId: "fox" }, { defId: "mario" }], RULES, 5);
    s.fighters.forEach((f, i) =>
      Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? -3 : 3), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }),
    );
    const { states, events } = run(s, 20, (i) => [i === 0 ? Btn.Down | Btn.Special : 0, 0]);
    const hitAt = events.findIndex((e) => e.hits.some((h) => h.attacker === 0));
    expect(states[hitAt].fighters[0]).toMatchObject({ move: "downB", actionFrame: 2 });
    const frozen = states.filter((t, i) => i >= hitAt && t.fighters[0].hitlag > 0);
    expect(frozen.length).toBeGreaterThan(5);
    for (const t of frozen) expect(t.fighters[0].intangible).toBeGreaterThan(0);
    // Once it moves on to frame 4, the window is over.
    const on = states.findIndex((t) => t.fighters[0].actionFrame === 3);
    expect(states[on].fighters[0].intangible).toBe(0);
  });
});

describe("fix round 1: the riposte cannot clank (SmashWiki clang=f, rebound=f; SETOFF_KIND_OFF)", () => {
  it("lands on a caught Link forward tilt instead of clanking with it", () => {
    // Link's forward tilt (a soft forward press, so no smash), caught on its first
    // live frame at 14 apart; its box is still out when the cut comes.
    const { states, events } = run(duel("link", 14), 90, (i) => [i === 12 ? Btn.Right | Btn.Soft | Btn.Attack : 0, i === 0 ? COUNTER : 0]);
    const at = caughtAt(events);
    expect(states[at].fighters[0].move).toBe("ftilt");
    expect(events.flatMap((e) => e.clanks)).toEqual([]);
    const riposte = events.flatMap((e) => e.hits).find((h) => h.attacker === 1);
    expect(riposte, "the riposte never landed").toBeDefined();
    expect(toFloat(riposte!.damage)).toBeCloseTo(toFloat(states[at].fighters[1].combat.counterDamage) * 1.05 * 1.2, 2);
  });
});

describe("fix round 1: the aerial Counter (SmashWiki Marth (SSBU)/Down special, Parameters)", () => {
  /** Marth high over Final Destination, falling at 1.5 and drifting at 1, countering on step 0. */
  function aerial(frames: number, script: (i: number) => InputFrame = (i) => (i === 0 ? COUNTER : 0)) {
    const s = duel("mario", 60);
    Object.assign(s.fighters[1], { action: "fall", grounded: false, platform: -1, x: 0, y: fx(110), vx: fx(1), vy: -fx(1.5) });
    s.fighters[1].kinetic.controlX = fx(1);
    return run(s, frames, (i) => [0, script(i)]).states.map((t) => t.fighters[1]);
  }

  it("halves the speed and stops the fall on its first frame (UNVERIFIED: the stop), then bleeds 0.0025 a frame and falls by 0.04 to 1.2", () => {
    const m = aerial(40);
    expect(m[0]).toMatchObject({ action: "special", move: "downB", actionFrame: 0, vy: 0 });
    // The air friction's frame, then ×0.5 ("Horizontal speed multiplier on startup 0.5").
    expect(m[0].vx).toBe(mul(fx(1) - fx(0.0025), fx(0.5)));
    for (let k = 1; k < 39; k++) {
      // "Air friction 0.0025": no drift, the speed bleeding by it.
      expect(m[k].vx, `frame ${k + 1}`).toBe(m[k - 1].vx - fx(0.0025));
      // "Gravity 0.04", "Fall speed 1.2".
      expect(m[k].vy, `frame ${k + 1}`).toBe(Math.max(-fx(1.2), m[k - 1].vy - fx(0.04)));
    }
    expect(m[30].vy).toBe(-fx(1.2));
    expect(m[38].vy).toBe(-fx(1.2));
  });

  it("plays to its 79th frame in the air, then falls as Marth does ('Animation length (aerial) 79')", () => {
    const m = aerial(82);
    expect(m[78]).toMatchObject({ action: "special", move: "downB", actionFrame: 78 });
    expect(m[79].action).toBe("fall");
    // Marth's own fall from there, faster than the Counter's 1.2.
    expect(m[81].vy).toBeLessThan(-fx(1.2));
  });

  it("is interruptible from frame 65 in the air ('Interruptible 65')", () => {
    const m = aerial(70, (i) => (i === 0 ? COUNTER : i === 64 ? Btn.Attack : 0));
    expect(m[63]).toMatchObject({ action: "special", move: "downB" });
    expect(m[64]).toMatchObject({ action: "attack", move: "nair" });
  });

  // The Task 5 re-review's N1. UNVERIFIED: the stop and the ×0.5 are the airtime's
  // first aerial stall's (`specialStallExec`); the rest of the physics run on every use.
  it("on a second Counter in one airtime, keeps its speed and its fall: no second ×0.5, no second stop", () => {
    const m = aerial(70, (i) => (i === 0 || i === 64 ? COUNTER : 0));
    expect(m[63]).toMatchObject({ action: "special", move: "downB", actionFrame: 63, vy: -fx(1.2) });
    expect(m[64]).toMatchObject({ action: "special", move: "downB", actionFrame: 0 });
    expect(m[64].vx).toBe(m[63].vx - fx(0.0025));
    expect(m[64].vy).toBe(-fx(1.2));
    expect(m[64].combat.specialStall).toBe(true);
  });

  // The Task 5 re-review's N2: the counterattack reached by a real aerial catch, so
  // with the flags that path leaves (the stall spent, the stop's own flag cleared).
  it("plays the counterattack after an aerial catch with the same physics: frozen 21 frames, then 0.04 to 1.2, 51 frames in all", () => {
    const s = duel("mario", 60);
    Object.assign(s.fighters[1], { action: "fall", grounded: false, platform: -1, x: 0, y: fx(110), vx: fx(1), vy: -fx(1.5) });
    s.fighters[1].kinetic.controlX = fx(1);
    // Caught on the guard's eighth frame, at the bubble's top.
    pelletAt(s, 1, fx(-24), fx(119));
    const { states, events } = run(s, 80, (i) => [0, i === 0 ? COUNTER : 0], withZoner());
    const m = states.map((t) => t.fighters[1]);
    const at = caughtAt(events);
    expect(at).toBe(7);
    expect(m[at]).toMatchObject({ move: "counterAttack", actionFrame: 0 });
    expect([m[at].combat.specialStall, m[at].combat.stalling]).toEqual([true, false]);
    // The freeze: still in the air, speeds held.
    for (let k = at + 1; k <= at + 20; k++) expect([m[k].y, m[k].vx, m[k].vy], `step ${k}`).toEqual([m[at].y, m[at].vx, m[at].vy]);
    // Then "Air friction 0.0025", "Gravity 0.04" to "Fall speed 1.2", no stop.
    for (let k = at + 21; k < at + 71; k++) {
      expect(m[k].vx, `step ${k}`).toBe(m[k - 1].vx - fx(0.0025));
      expect(m[k].vy, `step ${k}`).toBe(Math.max(-fx(1.2), m[k - 1].vy - fx(0.04)));
    }
    expect(m[at + 70]).toMatchObject({ action: "special", move: "counterAttack", actionFrame: 50 });
    expect(m[at + 71].action).toBe("fall");
  });

  it("gives the counterattack the same physics and its 51 frames in the air (UNVERIFIED that the Parameters govern it)", () => {
    const s = duel("mario", 60);
    Object.assign(s.fighters[1], { action: "special", move: "counterAttack", actionFrame: 40, grounded: false, platform: -1, x: 0, y: fx(100), vx: 0, vy: -fx(0.5) });
    s.fighters[1].combat.counterDamage = fx(12);
    const m = run(s, 14, () => [0, 0]).states.map((t) => t.fighters[1]);
    for (let k = 1; k < 9; k++) expect(m[k].vy).toBe(m[k - 1].vy - fx(0.04));
    expect(m[9]).toMatchObject({ action: "special", move: "counterAttack", actionFrame: 50 });
    expect(m[10].action).toBe("fall");
  });
});

describe("fix round 1: the riposte goes through armour (SmashWiki: it ignores \"most kinds of armor\")", () => {
  /**
   * Kirby in his Stone beside Marth's riposte, one frame from its cut: on the ground
   * on frame 21, inside its stone (11-28), formed (Plan 5, Task 13 fix round 2: the
   * Stone's HP is cumulative damage-based armour, SmashWiki "Armor").
   */
  function stone(marthDef: FighterDef = marth) {
    const s = createInitialState("finalDestination", [{ defId: "kirby" }, { defId: "marth" }], RULES, 5);
    s.fighters.forEach((f, i) =>
      Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? -5 : 5), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }),
    );
    Object.assign(s.fighters[0], { action: "special", move: "downB", actionFrame: 20 });
    s.fighters[0].combat.stoneFrames = 10;
    Object.assign(s.fighters[1], { action: "special", move: "counterAttack", actionFrame: 3 });
    s.fighters[1].combat.counterDamage = fx(12);
    const ctx: SimContext = { ...registryContext, fighter: (id) => (id === "marth" ? marthDef : registryContext.fighter(id)) };
    return run(s, 2, () => [0, 0], ctx);
  }

  it("launches an armoured Stone", () => {
    const { states, events } = stone();
    const hit = events[0].hits.find((h) => h.attacker === 1)!;
    expect(hit.knockback).toBeGreaterThan(0);
    expect(states[0].fighters[0].action).not.toBe("special");
  });

  it("where the same boxes without it are absorbed by the armour (the scene's control)", () => {
    const ca = marth.moves.counterAttack!;
    const plain: FighterDef = { ...marth, moves: { ...marth.moves, counterAttack: { ...ca, hitboxes: ca.hitboxes.map((h) => ({ ...h, forceReaction: false })) } } };
    const { states, events } = stone(plain);
    expect(events[0].hits.find((h) => h.attacker === 1)!.knockback).toBe(0);
    expect(states[0].fighters[0]).toMatchObject({ action: "special", move: "downB" });
  });

  /**
   * Kirby in the air on frame 22 of his Stone, inside its damage-based armour
   * (19-28, a threshold of 25%; Plan 5, Task 13 fix round 2), beside the riposte
   * one frame from its cut: 12% countered is under the threshold.
   */
  function aerialArmour(marthDef: FighterDef = marth) {
    const s = createInitialState("finalDestination", [{ defId: "kirby" }, { defId: "marth" }], RULES, 5);
    s.fighters.forEach((f, i) =>
      Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? -5 : 5), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }),
    );
    Object.assign(s.fighters[0], { action: "special", move: "downB", actionFrame: 21, grounded: false, platform: -1, y: fx(4), vx: 0, vy: 0 });
    Object.assign(s.fighters[1], { action: "special", move: "counterAttack", actionFrame: 3 });
    s.fighters[1].combat.counterDamage = fx(12);
    const ctx: SimContext = { ...registryContext, fighter: (id) => (id === "marth" ? marthDef : registryContext.fighter(id)) };
    return run(s, 2, () => [0, 0], ctx);
  }

  it("launches a Stone in its aerial damage-based armour", () => {
    const { states, events } = aerialArmour();
    expect(events[0].hits.find((h) => h.attacker === 1)!.knockback).toBeGreaterThan(0);
    expect(states[0].fighters[0].action).not.toBe("special");
  });

  it("where the same boxes without it are taken by that armour (the scene's control)", () => {
    const ca = marth.moves.counterAttack!;
    const plain: FighterDef = { ...marth, moves: { ...marth.moves, counterAttack: { ...ca, hitboxes: ca.hitboxes.map((h) => ({ ...h, forceReaction: false })) } } };
    const { states, events } = aerialArmour(plain);
    const hit = events[0].hits.find((h) => h.attacker === 1)!;
    expect(hit.knockback).toBe(0);
    expect(states[0].fighters[0]).toMatchObject({ action: "special", move: "downB", grounded: false });
    expect(states[0].fighters[0].damage).toBeGreaterThan(0);
  });
});

describe("fix round 1: the branches no test pinned", () => {
  it("consumes the roster's projectiles that survive a hit: Fox's blaster, Link's boomerang and Remote Bomb (UNVERIFIED)", () => {
    for (const [who, def, id] of [["fox", fox, "blaster"], ["link", link, "boomerang"], ["link", link, "remoteBomb"]] as const) {
      const pdef = findProjectileDef(def, id)!;
      expect(pdef.destroyOnHit, `${id} survives a hit`).toBe(false);
      const s = duel(who, 40);
      Object.assign(s.fighters[1], { action: "special", move: "downB", actionFrame: 10 });
      const p = spawnProjectile(pdef, s.fighters[0], 1);
      Object.assign(p, { x: s.fighters[1].x - fx(13), y: fx(8), vx: fx(2), vy: 0, facing: 1, age: Math.max(p.age, pdef.hitbox.startFrame) });
      s.projectiles.push(p);
      s.nextProjectileId = 2;
      const { states, events } = run(s, 6, () => [0, 0]);
      const at = caughtAt(events);
      expect(at, `${id} was never caught`).toBeGreaterThanOrEqual(0);
      expect(states[at].projectiles, `${id} survived the counter`).toHaveLength(0);
    }
  });

  it("reports the counter as its owner's, where the box met the bubble", () => {
    // A stand-in forward smash scripted as a capsule (a sphere's contact point is
    // its centre, the candidate's own point): 4 to 16 in front at height 8. From
    // 22 apart its far end meets the bubble, nearest the bubble's centre.
    const capsule: FighterDef = {
      ...mario,
      id: "lancer",
      scripts: {
        ...mario.scripts,
        fsmash: script("game_attacks4", "attack_s4_s", [
          frame(15),
          ATTACK({ id: 0, bone: "top", damage: 10, angle: 361, kbg: 50, bkb: 30, size: 1, x: 0, y: 8, z: 4, x2: 0, y2: 8, z2: 16 }),
          wait(3),
          clearAll(),
        ]),
      },
    };
    const ctx: SimContext = { ...registryContext, fighter: (id) => (id === "lancer" ? capsule : registryContext.fighter(id)) };
    const { states, events } = run(duel("lancer", 22), 20, FSMASH, ctx);
    const at = caughtAt(events);
    expect(at).toBeGreaterThan(0);
    const lancer = states[at].fighters[0];
    const box = { x1: lancer.x + fx(4), y1: lancer.y + fx(8), x2: lancer.x + fx(16), y2: lancer.y + fx(8), r: fx(1) };
    const point = contactPoint(box, counterBubble(states[at - 1].fighters[1], COUNTER_DEF));
    expect(events[at].counters).toEqual([{ port: 1, ...point, damage: fx(10) }]);
    // The far end, not the box's own first point.
    expect(point).toEqual({ x: box.x2, y: box.y2 });
  });

  it("triggers once invincibility is over, and not on its last frame", () => {
    const f = duel("mario", 60).fighters[1];
    Object.assign(f, { action: "special", move: "downB", actionFrame: 10 });
    f.invincible = 1;
    expect(activeCounter(f, marth)).toBeNull();
    f.invincible = 0;
    expect(activeCounter(f, marth)).toBe(COUNTER_DEF);
  });

  it("mirrors the bubble's forward offset with the fighter's facing", () => {
    const c: CounterDef = { ...COUNTER_DEF, x: fx(3) };
    const f = duel("mario", 60).fighters[1];
    Object.assign(f, { x: fx(20), y: fx(2), facing: 1 });
    expect(counterBubble(f, c)).toEqual(circle(fx(23), fx(12), fx(10.5)));
    f.facing = -1;
    expect(counterBubble(f, c)).toEqual(circle(fx(17), fx(12), fx(10.5)));
  });
});
