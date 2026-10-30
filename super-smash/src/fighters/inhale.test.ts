/**
 * Kirby's Inhale, through the real `step()` (Plan 5, Task 9). SmashWiki "Kirby
 * (SSBU)/Neutral special": swallow 10% and copy; spit 6% and the victim flies
 * as a star whose damage follows their weight (Mario, 98: 15%); the mouthful
 * mashes free sooner; a Copy Ability hurts ×1.2.
 *
 * Sources for every number pinned here:
 * - SmashWiki "Kirby (SSBU)/Neutral special"
 *   (https://www.ssbwiki.com/Kirby_(SSBU)/Neutral_special):
 *   - the hold, "180 + 1.1t - k"; "On the ground, button mashing reduces this
 *     amount by 12 frames per stick input, and 21.6 frames per button input; in
 *     the air, these amounts are increased to 16 and 28.8";
 *   - "Walk speed multiplier with inhaled opponent 1.08"; Kirby can "walk around
 *     slowly, or perform a short hop";
 *   - Swallow: "Throw" 10.0%, "Throw release frame 8", "Interruptible 21"; Spit:
 *     "Throw" 6.0%, release 8, grounded "Interruptible 31";
 *   - the star: "Offsets 7, 7"; "Can pierce opponents? Yes"; radius 2.5, angle
 *     45 (speed-based), BK 70, KS 78, "H× 2.0×"; damage by weight (Mario's 95 -
 *     100 row: 15%); "The duration in frames is determined by 25 + 0.5t, with a
 *     maximum of 60, while its speed in units per frame is determined by 2.8 +
 *     0.008(t - k). The star's speed decreases by 0.05 per frame, and it releases
 *     the target when its speed drops below 0.4"; "Button mashing from the target
 *     reduces the star's duration by 10 frames per stick input, and 18 frames per
 *     button input, with a minimum resulting duration of 4 frames"; "Opponent's
 *     speed when escaping star 0.73, 2.3";
 *   - Kirby's blast line detection, while he holds someone, "extended forward and
 *     down by 4 units";
 *   - "Copy Ability damage multiplier 1.2"; "Period before Copy Ability can be lost
 *     by damage taken 1200 frames".
 * - SmashWiki "Inhale (Kirby)" (https://www.ssbwiki.com/Inhale_(Kirby)): "Kirby
 *   can swallow the victim by pressing down or the special move button", "spit
 *   them out as a star ... by pressing the attack button"; "Kirby always has a
 *   minimum of 14 frames to swallow or spit the opponent"; "Kirby's Copy
 *   Abilities have a 1.2× damage multiplier applied to all their hitboxes"; the
 *   multiplier "raises damage percent, but knockback only reflects the change in
 *   percent"; "If a Kirby swallows a Kirby with a Copy Ability, he will steal it";
 *   "Kirby can't inhale another Kirby who already has someone in his mouth"; the
 *   loss chance is "directly equal to damage taken"; the ability is lost "upon
 *   being KO'd"; held characters, after the hold, "are automatically released".
 * - SmashWiki "Copy Ability" (https://www.ssbwiki.com/Copy_Ability): "Kirby gains a
 *   1.2× damage multiplier for the copied move; however, knockback is not
 *   affected"; it "allows Kirby's Rollout to instantly break a shield" (the shield
 *   damage takes it too); "anything spawned by the ability will vanish if Kirby
 *   loses it".
 *
 * UNVERIFIED and pinned as the replica's reading (`status/inhale.ts` and
 * `engine/inhale.ts` say why): the hold's and the flight's rounding; the
 * spit by the grab button; turning only on the ground; one hop; a landing keeps the
 * mouthful and a begun swallow or spit; the held fighter cannot struggle once the
 * swallow or spit has begun; the swallowed drop out where Kirby is; the star's
 * rider is intangible; the exit speed points the way the star flew; the copy's
 * ×1.2 rides on its projectiles (SmashWiki's "all their hitboxes"), not on hitlag
 * or knockback's `d`; a fighter hanging from a ledge cannot be inhaled.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ONE, fx, mul, randomInt, toFloat } from "@/engine/fixed";
import { hashState } from "@/engine/hash";
import { COPY_DAMAGE, COPY_GRACE_FRAMES } from "@/engine/inhale";
import { computeHitlag, computeKnockback, framesAfterHit } from "@/engine/knockback";
import { fighterParams } from "@/engine/params";
import { shieldDamage } from "@/engine/shield";
import { KO_FREEZE_FRAMES, cloneState, createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import type { SimContext } from "@/engine/simulate";
import { GRAB_RELEASE_IMMUNITY } from "@/engine/states";
import {
  INHALE_MIN_FRAMES,
  INHALE_WALK,
  STAR_ESCAPE_X,
  STAR_ESCAPE_Y,
} from "@/engine/status/inhale";
import { Btn } from "@/engine/types";
import type { FighterState, GameState, InputFrame, MatchRules, StepEvents } from "@/engine/types";
import { bakedContext } from "@/game/bake";
import { readBakeFromDisk } from "@/game/bakeNode";
import { STAGES } from "@/stages";
import { BATTLEFIELD_LOWER_PLATFORM_Y } from "@/stages/battlefield";
import { FIGHTERS } from "./index";

const ONE_V_ONE: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };
const FREE_FOR_ALL: MatchRules = { ...ONE_V_ONE, oneOnOne: false };
const KIRBY = FIGHTERS.find((f) => f.id === "kirby")!;
const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));
const FD = STAGES.find((s) => s.id === "finalDestination")!;
const INHALE_STATES = ["inhaleHold", "swallowed", "spatStar"];

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** Kirby facing Mario (and anybody else, further right) on Final Destination. */
function lineUp(others: readonly string[], gap = 10, rules = ONE_V_ONE, ctx?: SimContext): GameState {
  const s = createInitialState("finalDestination", [{ defId: "kirby" }, ...others.map((defId) => ({ defId }))], rules, 9, ctx);
  s.fighters.forEach((f, i) =>
    Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(-20 + i * gap), y: 0, facing: i === 0 ? 1 : -1, intangible: 0, invincible: 0 }),
  );
  return s;
}

function run(s0: GameState, frames: number, script: (i: number) => InputFrame[], ctx?: SimContext): { states: GameState[]; events: StepEvents[] } {
  let s = s0;
  let prev: InputFrame[] = s0.fighters.map(() => 0);
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

/** Kirby inhales on frame 0; `then(i)` is his input after the catch. */
function inhaled(others: readonly string[], then: (i: number) => InputFrame, frames = 80, mario: (i: number) => InputFrame = () => 0, rules = ONE_V_ONE) {
  return run(lineUp(others, 10, rules), frames, (i) => [i === 0 ? Btn.Special : then(i), mario(i), ...others.slice(1).map(() => 0)]);
}

/** The step on which Mario was caught. */
function caughtAt(states: readonly GameState[]): number {
  return states.findIndex((s) => s.fighters[1].action === "swallowed");
}

/** Kirby holding Mario on the ground, as a catch leaves them: the state after it. */
function holdingMario(others: readonly string[] = [], rules = ONE_V_ONE): GameState {
  const { states } = inhaled(["mario", ...others], () => 0, 12, () => 0, rules);
  const at = caughtAt(states);
  expect(at, "the inhale catches Mario").toBeGreaterThan(0);
  return states[at];
}

/** Nothing of a mouthful left on `f`: no link, no timer, no mash credit, no star. */
function expectNothingHeld(f: FighterState, what: string): void {
  expect(INHALE_STATES, `${what}: port ${f.port} is ${f.action}`).not.toContain(f.action);
  expect(f.grabbing, what).toBe(-1);
  expect(f.grabbedBy, what).toBe(-1);
  expect(f.grabTimer, what).toBe(0);
  expect(f.combat.mash, what).toBe(0);
  expect(f.combat.grabLength, what).toBe(0);
  expect(f.combat.ride, what).toBe(0);
}

/** From every snapshot in `at`, re-simulating the same inputs gives the same states, hash for hash. */
function expectRollbackSafe(s0: GameState, frames: number, script: (i: number) => InputFrame[], at: readonly number[]): void {
  const { states } = run(s0, frames, script);
  for (const k of at) {
    let s = cloneState(states[k]);
    let prev = script(k);
    for (let i = k + 1; i < frames; i++) {
      const now = script(i);
      s = step(s, now, { prevInputs: prev }).state;
      prev = now;
      expect(hashState(s), `snapshot ${k}, step ${i}`).toBe(hashState(states[i]));
    }
  }
}

describe("Kirby's Inhale", () => {
  it("swallows Mario whole: he is inside, intangible, and Kirby holds him", () => {
    const { states } = inhaled(["mario"], () => 0, 30);
    const end = states[states.length - 1];
    expect(end.fighters[0].action).toBe("inhaleHold");
    expect(end.fighters[1].action).toBe("swallowed");
    expect(end.fighters[1].x).toBe(end.fighters[0].x);
    expect(end.fighters[1].intangible).toBeGreaterThan(0);
  });

  it("copies Mario on a swallow: 10%, then Kirby throws fireballs that hurt ×1.2", () => {
    const { states } = inhaled(["mario"], (i) => (i === 30 ? Btn.Special : 0), 60);
    const end = states[states.length - 1];
    expect(toFloat(end.fighters[1].damage)).toBeCloseTo(10 * 1.2, 2);
    expect(end.fighters[0].combat.copy).toBe("mario");

    // Now Kirby's neutral special is Mario's Fireball, and it is Mario's projectile.
    const after = run(end, 40, (i) => [i === 0 ? Btn.Special : 0, 0]);
    const fired = after.states.find((s) => s.projectiles.length > 0)!;
    expect(fired.projectiles[0].defId).toBe("fireball");
    expect(fired.projectiles[0].source).toBe("mario");
    expect(fired.projectiles[0].damageMul).toBe(COPY_DAMAGE);
  });

  it("spits Mario as a star that hits Fox for Mario's weight's 15%", () => {
    const { states, events } = inhaled(["mario", "fox"], (i) => (i === 30 ? Btn.Attack : 0), 90, () => 0, FREE_FOR_ALL);
    expect(states.some((s) => s.fighters[1].action === "spatStar")).toBe(true);
    const onFox = events.flatMap((e) => e.hits).find((h) => h.victim === 2);
    expect(onFox).toBeDefined();
    expect(toFloat(onFox!.damage)).toBeCloseTo(15, 2);
    // Mario took the spit's 6%, and is himself again by the end.
    const end = states[states.length - 1];
    expect(toFloat(end.fighters[1].damage)).toBeCloseTo(6, 2);
    expect(end.fighters[1].action).not.toBe("spatStar");
  });

  it("finds its own star when another fighter's projectile spawns on the same frame", () => {
    const spit = (i: number) => (i === 30 ? Btn.Attack : 0);
    const alone = inhaled(["mario", "fox"], spit, 60, () => 0, FREE_FOR_ALL).states;
    const starAt = alone.findIndex((s) => s.fighters[1].action === "spatStar");
    expect(starAt).toBeGreaterThan(30);
    // Fox fires his blaster at every moment that could put his laser out on the star's frame.
    let together = 0;
    for (let k = starAt - 25; k <= starAt; k++) {
      const s = lineUp(["mario", "fox"], 10, FREE_FOR_ALL);
      // Fox shoots away from the others, so his laser only shares the frame.
      s.fighters[2].facing = 1;
      const { states } = run(s, 60, (i) => [i === 0 ? Btn.Special : spit(i), 0, i === k ? Btn.Special : 0]);
      const at = states[starAt];
      if (at.projectiles.filter((p) => p.age === 0).length === 2) together += 1;
      expect(at.fighters[1].action).toBe("spatStar");
      const star = at.projectiles.find((p) => p.instanceId === at.fighters[1].combat.ride);
      expect(star?.owner).toBe(0);
    }
    expect(together).toBeGreaterThan(0);
  });

  it("inhales a shielding fighter: its catch is a grabbox, and grabs beat shields", () => {
    const { states } = inhaled(["mario"], () => 0, 30, () => Btn.Shield);
    expect(states[states.length - 1].fighters[1].action).toBe("swallowed");
  });

  it("does not inhale an invincible fighter, as no grab takes one", () => {
    const s = lineUp(["mario"]);
    s.fighters[1].invincible = 120;
    const { states } = run(s, 30, (i) => [i === 0 ? Btn.Special : 0, 0]);
    expect(states.every((st) => st.fighters[1].action !== "swallowed")).toBe(true);
  });

  it("lets Mario mash his way out sooner", () => {
    const outAt = (mash: boolean) =>
      inhaled(["mario"], () => 0, 300, (i) => (mash && i % 2 === 0 ? Btn.Attack : 0)).states.findIndex(
        (s, i) => i > 15 && s.fighters[1].action !== "swallowed",
      );
    const calm = outAt(false);
    expect(calm).toBeGreaterThan(150); // 180 + 1.1 × 0 − 0 frames, from the catch
    expect(outAt(true)).toBeLessThan(calm);
  });

  it("loses the Copy Ability with a stock", () => {
    const { states } = inhaled(["mario"], (i) => (i === 30 ? Btn.Special : 0), 60);
    const s = states[states.length - 1];
    s.fighters[0].x = fx(400); // past the blast zone
    s.fighters[0].grounded = false;
    s.fighters[0].platform = -1;
    s.fighters[0].action = "fall";
    const after = run(s, 3, () => [0, 0]).states;
    expect(after[after.length - 1].fighters[0].combat.copy).toBe("");
    expect(after[after.length - 1].fighters[0].combat.copyFrames).toBe(0);
  });

  it("changes the caught fighter's status through the status module, so a helpless fall's record is cleared (Task 4b carry)", () => {
    const s = lineUp(["mario"]);
    // Mario falls helpless in front of Kirby's mouth.
    Object.assign(s.fighters[1], { action: "specialFall", grounded: false, platform: -1, y: fx(2), jumpsUsed: 2 });
    s.fighters[1].combat.helplessMove = "upB";
    const { states } = run(s, 14, (i) => [i === 0 ? Btn.Special : 0, 0]);
    const at = caughtAt(states);
    expect(at).toBeGreaterThan(0);
    expect(states[at].fighters[1].combat.helplessMove).toBeNull();
  });
});

describe("holding a mouthful", () => {
  it("walks at 1.08 times Kirby's walk, Mario inside him all the way", () => {
    const s = holdingMario();
    const { states } = run(s, 60, () => [Btn.Right, 0]);
    const p = fighterParams(KIRBY);
    expect(INHALE_WALK).toBe(fx(1.08));
    expect(Math.max(...states.map((st) => st.fighters[0].vx))).toBe(mul(p.walk_speed_max, INHALE_WALK));
    for (const st of states) {
      expect(st.fighters[0].action).toBe("inhaleHold");
      expect(st.fighters[1].x).toBe(st.fighters[0].x);
      expect(st.fighters[1].y).toBe(st.fighters[0].y);
    }
  });

  it("turns to the stick on the ground, and not in the air (UNVERIFIED)", () => {
    const s = holdingMario();
    const { states } = run(s, 3, () => [Btn.Left, 0]);
    expect(states[0].fighters[0].facing).toBe(-1);
    const air = holdingMario();
    Object.assign(air.fighters[0], { y: fx(60), grounded: false, platform: -1 });
    const aloft = run(air, 3, () => [Btn.Left, 0]).states;
    expect(aloft.every((st) => st.fighters[0].facing === 1)).toBe(true);
  });

  it("short-hops once, from the ground only, and lands still holding", () => {
    const s = holdingMario();
    const p = fighterParams(KIRBY);
    const once = run(s, 90, (i) => [i === 1 ? Btn.Jump : 0, 0]).states;
    const twice = run(s, 90, (i) => [i === 1 || i === 12 ? Btn.Jump : 0, 0]).states;
    const peak = Math.max(...once.map((st) => st.fighters[0].y));
    // Kirby's short hop, within a unit: `mini_jump_y`, not his full `jump_y`.
    expect(toFloat(peak)).toBeGreaterThan(toFloat(p.mini_jump_y) - 1);
    expect(toFloat(peak)).toBeLessThan(toFloat(p.mini_jump_y) + 1);
    expect(twice.map((st) => st.fighters[0].y)).toEqual(once.map((st) => st.fighters[0].y));
    const end = once[once.length - 1];
    expect(end.fighters[0]).toMatchObject({ action: "inhaleHold", grounded: true });
    expect(end.fighters[1].action).toBe("swallowed");
  });

  it("lets go, and gives the grab's immunity, if its mouthful left the mouth with the link whole (a backstop; forged)", () => {
    const s = holdingMario();
    // No path leaves `swallowed` with the link intact; force one.
    Object.assign(s.fighters[1], { action: "fall", actionFrame: 0 });
    const next = run(s, 1, () => [0, 0]).states[0];
    expect(next.fighters[0].grabbing).toBe(-1);
    expect(next.fighters[1].grabbedBy).toBe(-1);
    // Kirby (port 0) lets go first; Mario's own count runs down once later that frame.
    expect(next.fighters[1].combat.grabImmune).toBe(GRAB_RELEASE_IMMUNITY - 1);
    expect(next.fighters[0].action).toBe("stand");
  });

  it("swallows on B or down and spits on attack", () => {
    const after = (key: InputFrame) => run(holdingMario(), 3, (i) => [i === 1 ? key : 0, 0]).states[2].fighters[0].move;
    expect(after(Btn.Special)).toBe("inhaleSwallow");
    expect(after(Btn.Down)).toBe("inhaleSwallow");
    expect(after(Btn.Attack)).toBe("inhaleSpit");
    // UNVERIFIED: the grab button spits as attack does (SmashWiki names attack).
    expect(after(Btn.Grab)).toBe("inhaleSpit");
  });

  it("takes no ledge: a full mouth walks off Final Destination and falls past it", () => {
    const s = holdingMario();
    Object.assign(s.fighters[0], { x: fx(70) });
    const { states } = run(s, 70, () => [Btn.Right, 0]);
    expect(states.some((st) => st.fighters[0].action === "inhaleHold" && !st.fighters[0].grounded)).toBe(true);
    expect(states.every((st) => st.fighters[0].ledge === null)).toBe(true);
  });

  it("extends Kirby's blast lines forward and down by 4 while he holds someone", () => {
    const b = FD.blastZone;
    const at = (x: number, y: number, facing: number, holding: boolean): boolean => {
      const s = holding ? holdingMario() : lineUp(["mario"]);
      Object.assign(s.fighters[0], { x, y, facing, grounded: false, platform: -1 });
      if (!holding) s.fighters[0].action = "fall";
      return run(s, 1, () => [0, 0]).events[0].kos.some((k) => k.port === 0);
    };
    expect(at(b.right - fx(3), fx(20), 1, true)).toBe(true);
    expect(at(b.right - fx(3), fx(20), -1, true)).toBe(false);
    expect(at(b.right - fx(3), fx(20), 1, false)).toBe(false);
    expect(at(0, b.bottom + fx(3), 1, true)).toBe(true);
    expect(at(0, b.bottom + fx(3), 1, false)).toBe(false);
  });
});

describe("the mash out of Kirby's mouth", () => {
  /** How far Mario's hold timer falls on step 2 when he presses `key` then. */
  function drop(key: InputFrame, air: boolean): number {
    const s = holdingMario();
    if (air) Object.assign(s.fighters[0], { y: fx(60), grounded: false, platform: -1 });
    const { states } = run(s, 3, (i) => [0, i === 2 ? key : 0]);
    return states[1].fighters[1].grabTimer - states[2].fighters[1].grabTimer;
  }

  it("takes 21.6 frames a button and 12 a stick input on the ground, 28.8 and 16 in the air", () => {
    // One frame passes, plus the whole frames the press earns (a tenth carries).
    expect(drop(Btn.Attack, false)).toBe(1 + 21);
    expect(drop(Btn.Up, false)).toBe(1 + 12);
    expect(drop(Btn.Attack, true)).toBe(1 + 28);
    expect(drop(Btn.Up, true)).toBe(1 + 16);
    expect(drop(0, false)).toBe(1);
  });

  it("never lets go before the hold's 14th frame, however short its time", () => {
    const s = holdingMario();
    s.fighters[1].grabTimer = 1;
    const { states } = run(s, 20, () => [0, 0]);
    const out = states.findIndex((st) => st.fighters[1].action !== "swallowed");
    expect(INHALE_MIN_FRAMES).toBe(14);
    expect(states[out - 1].fighters[1].actionFrame).toBe(INHALE_MIN_FRAMES - 1);
  });

  it("is released when the hold runs out, immune to grabs for a second, and Kirby stands", () => {
    const { states } = inhaled(["mario"], () => 0, 220);
    const at = caughtAt(states);
    const out = states.findIndex((s, i) => i > at && s.fighters[1].action !== "swallowed");
    expect(out - at).toBe(180);
    const free = states[out];
    expectNothingHeld(free.fighters[1], "the released");
    expect(free.fighters[1].combat.grabImmune).toBe(GRAB_RELEASE_IMMUNITY);
    // Kirby's link went with Mario's; his own status sees it on his next frame.
    expect(free.fighters[0].grabbing).toBe(-1);
    expect(states[out + 1].fighters[0].action).toBe("stand");
    expectNothingHeld(states[out + 1].fighters[0], "Kirby");
  });

  it("cannot struggle once the swallow or the spit has begun", () => {
    for (const key of [Btn.Special, Btn.Attack]) {
      const s = holdingMario();
      s.fighters[1].grabTimer = 1;
      s.fighters[1].actionFrame = 40;
      const { states } = run(s, 12, (i) => [i === 0 ? key : 0, Btn.Attack]);
      // Released by the move on its frame 8, never by the struggle.
      expect(states.slice(0, 7).every((st) => st.fighters[1].action === "swallowed")).toBe(true);
    }
  });
});

describe("the swallow", () => {
  it("deals 10% on its frame 8, gives Kirby Mario's neutral special, and lets Mario out", () => {
    const s = holdingMario([], FREE_FOR_ALL);
    const { states, events } = run(s, 20, (i) => [i === 0 ? Btn.Special : 0, 0]);
    const out = states.findIndex((st) => st.fighters[1].action !== "swallowed");
    expect(out).toBe(7); // move frame 8, entered on step 0
    expect(states[out].fighters[1].damage).toBe(fx(10));
    expect(events[out].hits).toEqual([expect.objectContaining({ attacker: 0, victim: 1, damage: fx(10), knockback: 0 })]);
    expect(states[out].fighters[0].combat.copy).toBe("mario");
    expect(states[out].fighters[0].combat.copyFrames).toBe(0);
    expectNothingHeld(states[out].fighters[1], "the swallowed");
    expectNothingHeld(states[out].fighters[0], "Kirby");
    // The swallow's own length: interruptible on 21.
    expect(states[19].fighters[0].action).toBe("special");
    expect(states[19].fighters[0].move).toBe("inhaleSwallow");
  });

  it("zeroes the mash credit Mario had earned, as every release does (ruling R-T9b)", () => {
    const s = holdingMario();
    // One press earns 21.6 frames: 21 spent, 0.6 kept as credit.
    const { states } = run(s, 14, (i) => [i === 3 ? Btn.Special : 0, i === 1 ? Btn.Attack : 0]);
    expect(states[2].fighters[1].combat.mash).toBe(6);
    expect(states[3 + 7].fighters[1].action).not.toBe("swallowed");
    expect(states[3 + 7].fighters[1].combat.mash).toBe(0);
  });

  it("begun in the air and landed in, still lets Mario out on its frame 8 and copies him", () => {
    const s = holdingMario();
    Object.assign(s.fighters[0], { y: fx(1.5), grounded: false, platform: -1 });
    const { states } = run(s, 10, (i) => [i === 0 ? Btn.Special : 0, 0]);
    expect(states.slice(0, 7).some((st) => st.fighters[0].grounded)).toBe(true);
    expect(states[6].fighters[0]).toMatchObject({ action: "special", move: "inhaleSwallow" });
    expect(states[7].fighters[1].action).not.toBe("swallowed");
    expect(states[7].fighters[0].combat.copy).toBe("mario");
  });

  it("in the air lets Mario out where Kirby is, falling, and nothing is held", () => {
    const s = holdingMario();
    Object.assign(s.fighters[0], { y: fx(60), grounded: false, platform: -1 });
    const { states } = run(s, 12, (i) => [i === 0 ? Btn.Special : 0, 0]);
    const out = states[7];
    expect(out.fighters[1].action).toBe("fall");
    expect(out.fighters[1].x).toBe(out.fighters[0].x);
    expectNothingHeld(out.fighters[1], "the swallowed");
    expectNothingHeld(out.fighters[0], "Kirby");
    expect(out.fighters[0].combat.copy).toBe("mario");
  });

  it("takes a swallowed Kirby's Copy Ability from him", () => {
    const s = lineUp(["kirby"]);
    s.fighters[1].combat.copy = "fox";
    s.fighters[1].combat.copyFrames = 300;
    const { states } = run(s, 40, (i) => [i === 0 || i === 20 ? Btn.Special : 0, 0]);
    const end = states[states.length - 1];
    expect(end.fighters[0].combat.copy).toBe("fox");
    expect(end.fighters[1].combat.copy).toBe("");
    expect(end.fighters[1].combat.copyFrames).toBe(0);
  });

  it("holds one fighter: a second in reach on the same frame is left alone", () => {
    const s = lineUp(["mario", "fox"], 10, FREE_FOR_ALL);
    // Fox stands where Mario does.
    Object.assign(s.fighters[2], { x: fx(-10) });
    const { states } = run(s, 20, (i) => [i === 0 ? Btn.Special : 0, 0, 0]);
    const at = caughtAt(states);
    expect(at).toBeGreaterThan(0);
    expect(states[at].fighters[0].grabbing).toBe(1);
    expect(states.every((st) => st.fighters[2].grabbedBy === -1 && st.fighters[2].action !== "swallowed")).toBe(true);
  });

  it("cannot take a Kirby who already has someone in his mouth", () => {
    const s = createInitialState("finalDestination", [{ defId: "kirby" }, { defId: "kirby" }, { defId: "mario" }], FREE_FOR_ALL, 9);
    const at = [-30, -20, -10];
    s.fighters.forEach((f, i) =>
      Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(at[i]), y: 0, facing: i === 2 ? -1 : 1, intangible: 0, invincible: 0 }),
    );
    const { states } = run(s, 60, (i) => [i === 20 ? Btn.Special : 0, i === 0 ? Btn.Special : 0, 0]);
    expect(states[15].fighters[1].action).toBe("inhaleHold");
    expect(states.every((st) => st.fighters[1].grabbedBy !== 0)).toBe(true);
  });
});

describe("the spit and the star", () => {
  /** Kirby (at `percent`) spits Mario on step 0; the star leaves on step 7. */
  function spat(percent = 0, mario: (i: number) => InputFrame = () => 0, frames = 80, place?: (s: GameState) => void) {
    const s = holdingMario([], FREE_FOR_ALL);
    s.fighters[0].damage = percent;
    place?.(s);
    return run(s, frames, (i) => [i === 0 ? Btn.Attack : 0, mario(i)]);
  }

  it("deals 6% and flies the rider at 2.8 + 0.008(t − k), slowing 0.05 a frame", () => {
    const { states, events } = spat();
    const at = states.findIndex((st) => st.fighters[1].action === "spatStar");
    expect(at).toBe(7);
    expect(events[at].hits).toEqual([expect.objectContaining({ attacker: 0, victim: 1, damage: fx(6), knockback: 0 })]);
    const star = states[at].projectiles.find((p) => p.instanceId === states[at].fighters[1].combat.ride)!;
    expect(star.defId).toBe("star");
    // t = 6 (after the spit), k = 0: 2.848.
    expect(toFloat(star.vx)).toBeCloseTo(2.848, 3);
    const next = states[at + 1].projectiles.find((p) => p.instanceId === star.instanceId)!;
    expect(toFloat(next.vx)).toBeCloseTo(2.848 - 0.05, 3);
    // Spawned 7 ahead and 7 up of Kirby; the rider rides it, intangible.
    expect(star.x - states[at].fighters[0].x).toBe(fx(7));
    expect(star.y - states[at].fighters[0].y).toBe(fx(7));
    for (let i = at; i < at + 10; i++) {
      const p = states[i].projectiles.find((q) => q.instanceId === star.instanceId)!;
      expect(states[i].fighters[1]).toMatchObject({ x: p.x, y: p.y, action: "spatStar" });
      expect(states[i].fighters[1].intangible).toBeGreaterThan(0);
    }
  });

  it("flies 25 + 0.5t frames, then lets go at (0.73, 2.3) and the star is gone", () => {
    const { states } = spat();
    const at = states.findIndex((st) => st.fighters[1].action === "spatStar");
    const off = states.findIndex((st, i) => i > at && st.fighters[1].action !== "spatStar");
    // t = 6: 28 frames, the release frame its first.
    expect(off - at).toBe(28);
    expect(states[off].projectiles).toHaveLength(0);
    expectNothingHeld(states[off].fighters[1], "the rider");
    expect(STAR_ESCAPE_X).toBe(fx(0.73));
    expect(STAR_ESCAPE_Y).toBe(fx(2.3));
    // That frame's own gravity and drift follow, as they do after any set speed.
    expect(toFloat(states[off].fighters[1].vy)).toBeGreaterThan(2.2);
    expect(toFloat(states[off].fighters[1].vy)).toBeLessThanOrEqual(2.3);
    expect(toFloat(states[off].fighters[1].vx)).toBeGreaterThan(0.6);
    expect(toFloat(states[off].fighters[1].vx)).toBeLessThanOrEqual(0.73);
  });

  it("lets go when the star slows below 0.4, before its time is up", () => {
    // k = 200: 2.8 + 0.008(6 − 200) = 1.248, below 0.4 after 17 frames of 0.05.
    const { states } = spat(fx(200));
    const at = states.findIndex((st) => st.fighters[1].action === "spatStar");
    const off = states.findIndex((st, i) => i > at && st.fighters[1].action !== "spatStar");
    expect(off - at).toBe(17);
    expect(states[off].projectiles).toHaveLength(0);
  });

  it("flies shorter for the rider's mashing, 18 a button and 10 a stick input, never under 4 frames", () => {
    const flight = (mario: (i: number) => InputFrame): number => {
      const { states } = spat(0, mario);
      const at = states.findIndex((st) => st.fighters[1].action === "spatStar");
      return states.findIndex((st, i) => i > at && st.fighters[1].action !== "spatStar") - at;
    };
    expect(flight((i) => (i === 9 ? Btn.Attack : 0))).toBe(28 - 18);
    expect(flight((i) => (i === 9 ? Btn.Up : 0))).toBe(28 - 10);
    expect(flight((i) => (i >= 8 && i % 2 === 0 ? Btn.Attack : 0))).toBe(4);
  });

  it("hits for the rider's weight with twice the hitlag, and flies on through", () => {
    const s = holdingMario(["fox"], FREE_FOR_ALL);
    Object.assign(s.fighters[2], { x: fx(10) });
    const { states, events } = run(s, 40, (i) => [i === 0 ? Btn.Attack : 0, 0, 0]);
    const at = events.findIndex((e) => e.hits.some((h) => h.victim === 2));
    expect(at).toBeGreaterThan(7);
    const hit = events[at].hits.find((h) => h.victim === 2)!;
    expect(hit.damage).toBe(fx(15));
    expect(states[at].fighters[2].hitlag).toBe(framesAfterHit(computeHitlag(fx(15), { moveMultiplier: fx(2) })));
    // It pierces: the star and its rider fly on.
    expect(states[at + 1].fighters[1].action).toBe("spatStar");
    expect(states[at + 1].projectiles).toHaveLength(1);
  });

  it("carries its rider along a soft platform's top without setting them down on it", () => {
    /** Kirby, holding Mario, spits him from the air at (−75, `y0`) on Battlefield, towards its lower left platform. */
    const spitFrom = (y0: number) => {
      const s = createInitialState("battlefield", [{ defId: "kirby" }, { defId: "mario" }], FREE_FOR_ALL, 9);
      s.fighters.forEach((f, i) =>
        Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(-20 + i * 10), y: 0, facing: i === 0 ? 1 : -1, intangible: 0, invincible: 0 }),
      );
      const caught = run(s, 12, (i) => [i === 0 ? Btn.Special : 0, 0]).states;
      const held = cloneState(caught[caughtAt(caught)]);
      Object.assign(held.fighters[0], { x: fx(-75), y: y0, grounded: false, platform: -1, facing: 1 });
      const out = run(held, 40, (i) => [i === 0 ? Btn.Attack : 0, 0]);
      const at = out.states.findIndex((st) => st.fighters[1].action === "spatStar");
      return { ...out, at, starY: out.states[at].fighters[1].y };
    };
    // Kirby falls on the way to the release: start him where the star leaves just over
    // the platform's top (a star flying exactly at a surface's height meets it, as any
    // projectile does), nearer it than one frame of the rider's own gravity.
    const over = BATTLEFIELD_LOWER_PLATFORM_Y + fx(0.05);
    const probe = spitFrom(fx(40));
    const { states, at, starY } = spitFrom(over - (probe.starY - fx(40)));
    expect(starY).toBe(over);
    expect(fighterParams(BY_ID.get("mario")!).air_accel_y).toBeGreaterThan(fx(0.05));
    // t = 6: its whole 28 frames, over the platform and on.
    expect(states.slice(at, at + 28).every((st) => st.fighters[1].action === "spatStar" && st.fighters[1].y === starY)).toBe(true);
  });

  it("dies against a wall and lets its rider go where it last was", () => {
    // Below Final Destination's floor, off its right side, spitting back at it.
    const { states } = spat(0, () => 0, 40, (s) => Object.assign(s.fighters[0], { x: fx(100), y: fx(-20), grounded: false, platform: -1, facing: -1 }));
    const at = states.findIndex((st) => st.fighters[1].action === "spatStar");
    const off = states.findIndex((st, i) => i > at && st.fighters[1].action !== "spatStar");
    expect(off - at).toBeLessThan(28);
    expect(states[off].projectiles).toHaveLength(0);
    expect(toFloat(states[off].fighters[1].x)).toBeGreaterThan(80);
    expectNothingHeld(states[off].fighters[1], "the rider");
  });

  it("carries its rider past a blast line, which takes them", () => {
    const b = FD.blastZone;
    const { states, events } = spat(0, () => 0, 30, (s) => Object.assign(s.fighters[0], { x: b.right - fx(30), y: fx(60), grounded: false, platform: -1, facing: 1 }));
    const ko = events.findIndex((e) => e.kos.some((k) => k.port === 1));
    expect(ko).toBeGreaterThan(7);
    expect(states[ko - 1].fighters[1].action).toBe("spatStar");
    expectNothingHeld(states[ko].fighters[1], "the rider");
    expect(states[ko].fighters[1].action).toBe("dead");
    expect(states[ko].projectiles).toHaveLength(0);
  });
});

describe("the Copy Ability", () => {
  /** `attacker` (Kirby copying Mario, or Mario) fires a Fireball at Fox. */
  function fireball(copying: boolean, shield = false) {
    const s = createInitialState("finalDestination", [{ defId: copying ? "kirby" : "mario" }, { defId: "fox" }], FREE_FOR_ALL, 9);
    s.fighters.forEach((f, i) =>
      Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(-20 + i * 30), y: 0, facing: i === 0 ? 1 : -1, intangible: 0, invincible: 0 }),
    );
    if (copying) s.fighters[0].combat.copy = "mario";
    const { states, events } = run(s, 60, (i) => [i === 0 ? Btn.Special : 0, shield ? Btn.Shield : 0]);
    return { states, events };
  }

  it("hurts ×1.2 with a copied Fireball, which launches only by the higher percent (SmashWiki \"Inhale (Kirby)\")", () => {
    const own = fireball(false).events.flatMap((e) => e.hits)[0];
    const copied = fireball(true).events.flatMap((e) => e.hits)[0];
    expect(own.damage).toBe(fx(5));
    expect(copied.damage).toBe(mul(fx(5), COPY_DAMAGE));
    const fox = BY_ID.get("fox")!.attributes.weight;
    const kb = (percent: number) => computeKnockback({ percent, damage: fx(5), weight: fox, baseKnockback: fx(20), knockbackGrowth: fx(30), rage: ONE });
    expect(own.knockback).toBe(kb(fx(5)));
    expect(copied.knockback).toBe(kb(mul(fx(5), COPY_DAMAGE)));
  });

  it("wears a shield ×1.2 too (Rollout breaks a shield with it)", () => {
    const worn = (copying: boolean) => {
      const { states, events } = fireball(copying, true);
      const at = events.findIndex((e) => e.shieldHits.length > 0);
      return states[at - 1].fighters[1].shieldHealth - states[at].fighters[1].shieldHealth;
    };
    // Each frame's wear has the shield's own decay in it too; the two differ by the hits'.
    expect(worn(true) - worn(false)).toBe(shieldDamage(mul(fx(5), COPY_DAMAGE)) - shieldDamage(fx(5)));
  });

  it("counts its 1200-frame grace and stops there", () => {
    const s = lineUp(["mario"]);
    s.fighters[0].combat.copy = "mario";
    const { states } = run(s, COPY_GRACE_FRAMES + 10, () => [0, 0]);
    expect(states[99].fighters[0].combat.copyFrames).toBe(100);
    expect(states[states.length - 1].fighters[0].combat.copyFrames).toBe(COPY_GRACE_FRAMES);
  });

  /** Kirby, copying Mario past the grace, takes Mario's jab with the match's seed at `seed`. */
  function jabbed(seed: number) {
    const s = lineUp(["mario"]);
    s.rngSeed = seed;
    Object.assign(s.fighters[1], { x: fx(-12) });
    s.fighters[0].combat.copy = "mario";
    s.fighters[0].combat.copyFrames = COPY_GRACE_FRAMES;
    return run(s, 12, (i) => [0, i === 0 ? Btn.Attack : 0]);
  }

  it("may lose the ability to a hit after the grace: chance damage / 100, from the match's seed", () => {
    let lost = 0;
    let kept = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const { states, events } = jabbed(seed);
      const at = events.findIndex((e) => e.hits.length > 0);
      expect(at, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      const draw = randomInt(seed, 100 * ONE);
      expect(states[at].rngSeed, `seed ${seed}`).toBe(draw.seed);
      const loses = draw.value < events[at].hits[0].damage;
      expect(states[at].fighters[0].combat.copy, `seed ${seed}`).toBe(loses ? "" : "mario");
      if (loses) lost += 1;
      else kept += 1;
    }
    expect(lost).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0);
  });

  it("re-simulates hash-equal across the draw", () => {
    const s = lineUp(["mario"]);
    s.rngSeed = 3;
    Object.assign(s.fighters[1], { x: fx(-12) });
    s.fighters[0].combat.copy = "mario";
    s.fighters[0].combat.copyFrames = COPY_GRACE_FRAMES;
    expectRollbackSafe(s, 14, (i) => [0, i === 0 ? Btn.Attack : 0], [0, 1, 2, 3, 4, 5]);
  });

  it("takes what it spawned with it when it is lost, and leaves the copied fighter's own", () => {
    // Back to back, each firing away from the other.
    const s = createInitialState("finalDestination", [{ defId: "kirby" }, { defId: "mario" }], ONE_V_ONE, 9);
    s.fighters.forEach((f, i) =>
      Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(-40 + i * 10), y: 0, facing: i === 0 ? -1 : 1, intangible: 0, invincible: 0 }),
    );
    s.fighters[0].combat.copy = "mario";
    const { states } = run(s, 25, (i) => [i === 0 ? Btn.Special : 0, i === 0 ? Btn.Special : 0]);
    const both = states.findIndex((st) => st.projectiles.length === 2);
    expect(both).toBeGreaterThan(0);
    const ko = cloneState(states[both]);
    Object.assign(ko.fighters[0], { x: fx(400), grounded: false, platform: -1, action: "fall" });
    const after = run(ko, 2, () => [0, 0]).states[0];
    expect(after.fighters[0].action).toBe("dead");
    expect(after.projectiles.map((p) => p.owner)).toEqual([1]);
    // Kept, the same frame without the KO, both fly on.
    expect(run(cloneState(states[both]), 1, () => [0, 0]).states[0].projectiles).toHaveLength(2);
  });
});

describe("every way out of a mouthful clears it", () => {
  it("Kirby hit while holding lets Mario out", () => {
    const s = holdingMario(["fox"], FREE_FOR_ALL);
    // Fox forward-smashes Kirby from beside him.
    Object.assign(s.fighters[2], { x: fx(-15), facing: -1 });
    const { states, events } = run(s, 40, (i) => [0, 0, i === 1 ? Btn.Attack | Btn.Left : 0]);
    const hit = events.findIndex((e) => e.hits.some((h) => h.victim === 0));
    expect(hit).toBeGreaterThan(0);
    expectNothingHeld(states[hit].fighters[0], "Kirby");
    expectNothingHeld(states[hit + 1].fighters[1], "Mario");
  });

  it("the mouthful mashing out", () => {
    const { states } = inhaled(["mario"], () => 0, 200, (i) => (i > 12 && i % 2 === 0 ? Btn.Attack : 0));
    const at = caughtAt(states);
    const out = states.findIndex((s, i) => i > at && s.fighters[1].action !== "swallowed");
    expect(out).toBeGreaterThan(at + INHALE_MIN_FRAMES - 1);
    expectNothingHeld(states[out].fighters[1], "Mario");
    expect(states[out].fighters[0].grabbing).toBe(-1);
    expectNothingHeld(states[out + 1].fighters[0], "Kirby");
  });

  it("a blast line taking Kirby: him first, then the one he let go", () => {
    const s = holdingMario();
    Object.assign(s.fighters[0], { x: 0, y: FD.blastZone.bottom + fx(8), grounded: false, platform: -1 });
    const { states, events } = run(s, 120, () => [0, 0]);
    const kirbyOut = events.findIndex((e) => e.kos.some((k) => k.port === 0));
    const marioOut = events.findIndex((e) => e.kos.some((k) => k.port === 1));
    expect(kirbyOut).toBeGreaterThanOrEqual(0);
    expect(marioOut).toBeGreaterThan(kirbyOut);
    expectNothingHeld(states[kirbyOut].fighters[0], "Kirby");
    // The KO's freeze holds every status; Mario leaves the mouth on the first frame that runs.
    expect(states[kirbyOut].fighters[1]).toMatchObject({ grabbedBy: -1, grabTimer: 0 });
    expect(states[kirbyOut].fighters[1].combat).toMatchObject({ mash: 0, grabLength: 0 });
    expectNothingHeld(states[kirbyOut + KO_FREEZE_FRAMES + 1].fighters[1], "Mario");
    expectNothingHeld(states[marioOut].fighters[1], "Mario");
  });

  it("Kirby walking off a ledge with a mouthful, and spitting it there", () => {
    const s = lineUp(["mario"]);
    Object.assign(s.fighters[0], { x: fx(70) });
    Object.assign(s.fighters[1], { x: fx(78) });
    const { states } = run(s, 260, (i) => [i === 0 ? Btn.Special : i >= 20 && i < 40 ? Btn.Right : i === 45 ? Btn.Attack : 0, 0]);
    expect(states.some((st) => st.fighters[0].action === "inhaleHold" && !st.fighters[0].grounded)).toBe(true);
    for (const f of states[states.length - 1].fighters) expectNothingHeld(f, "the end");
  });

  it("a match whose time runs out mid-swallow ends there, and the next starts empty", () => {
    // `timeLimit` is in frames.
    const rules: MatchRules = { mode: "time", stocks: 0, timeLimit: 3600, smashBall: false, oneOnOne: true };
    const s = holdingMario([], rules);
    s.timeRemaining = 5;
    // Not a tie, or the clock would call sudden death.
    s.fighters[1].damage = fx(10);
    const { states } = run(s, 5, (i) => [i === 0 ? Btn.Special : 0, 0]);
    const end = states[states.length - 1];
    expect(end.outcome?.kind).toBe("timeUp");
    expect(end.fighters[1].action).toBe("swallowed");
    expect(hashState(cloneState(end))).toBe(hashState(end));
    const next = createInitialState("finalDestination", [{ defId: "kirby" }, { defId: "mario" }], rules, 9);
    for (const f of next.fighters) {
      expectNothingHeld(f, "the rematch");
      expect(f.combat.copy).toBe("");
      expect(f.combat.copyFrames).toBe(0);
    }
  });
});

describe("rollback through an Inhale", () => {
  it("re-simulates hash-equal from snapshots mid-inhale, mid-hold and mid-swallow", () => {
    const script = (i: number): InputFrame[] => [i === 0 || i === 40 ? Btn.Special : i >= 20 && i < 30 ? Btn.Right : 0, i % 3 === 0 ? Btn.Attack : 0];
    expectRollbackSafe(lineUp(["mario"]), 70, script, [3, 12, 25, 41, 44, 47, 52]);
  });

  it("re-simulates hash-equal from snapshots mid-spit and mid-star", () => {
    const s = lineUp(["mario", "fox"], 10, FREE_FOR_ALL);
    const script = (i: number): InputFrame[] => [i === 0 ? Btn.Special : i === 30 ? Btn.Attack : 0, i % 5 === 0 ? Btn.Up : 0, 0];
    expectRollbackSafe(s, 80, script, [31, 36, 38, 40, 45, 55]);
  });
});

describe("Review Focus: Inhale at the ledge", () => {
  it("does not take a fighter hanging from the ledge, and leaves them hanging", () => {
    const s = lineUp(["mario"]);
    const fd = s.fighters;
    // Mario hangs from Final Destination's right ledge; Kirby stands at it.
    const ledgeX = fx(80);
    Object.assign(fd[1], { action: "ledgeHang", actionFrame: 30, grounded: false, platform: -1, x: ledgeX, y: 0, ledge: { platform: 0, side: 1 }, facing: -1, intangible: 0 });
    Object.assign(fd[0], { x: ledgeX - fx(6), facing: 1 });
    const { states } = run(s, 50, (i) => [i === 0 ? Btn.Special : 0, 0]);
    expect(states.every((st) => st.fighters[1].action !== "swallowed")).toBe(true);
    expect(states[20].fighters[1].action).toBe("ledgeHang");
  });

  it("still lets an ordinary grab take a hanging fighter (D56, ruling P5-R11)", () => {
    const s = lineUp(["mario"]);
    const fd = s.fighters;
    const ledgeX = fx(80);
    Object.assign(fd[1], { action: "ledgeHang", actionFrame: 30, grounded: false, platform: -1, x: ledgeX, y: 0, ledge: { platform: 0, side: 1 }, facing: -1, intangible: 0 });
    Object.assign(fd[0], { x: ledgeX - fx(6), facing: 1 });
    const { states } = run(s, 20, (i) => [i === 0 ? Btn.Grab : 0, 0]);
    expect(states.some((st) => st.fighters[1].action === "grabbed" && st.fighters[1].ledge === null)).toBe(true);
  });

  it("carries a mouthful off the stage and spits it there without stranding anybody", () => {
    const s = lineUp(["mario"]);
    Object.assign(s.fighters[0], { x: fx(70) });
    Object.assign(s.fighters[1], { x: fx(78) });
    // Inhale, walk off the right edge, spit in the air, then let go of everything.
    const { states } = run(s, 260, (i) => [i === 0 ? Btn.Special : i >= 20 && i < 40 ? Btn.Right : i === 45 ? Btn.Attack : 0, 0]);
    expect(states.some((st) => st.fighters[0].action === "inhaleHold" && !st.fighters[0].grounded)).toBe(true);
    const end = states[states.length - 1];
    for (const f of end.fighters) {
      expect(["swallowed", "spatStar", "inhaleHold"]).not.toContain(f.action);
      expect(f.grabbing).toBe(-1);
      expect(f.grabbedBy).toBe(-1);
    }
  });
});

describe("every neutral special on the roster, as Kirby's Copy Ability, in the baked world", () => {
  const BAKED: SimContext = bakedContext({ fighter: (id) => BY_ID.get(id)!, stage: (id) => STAGES.find((s) => s.id === id)! }, readBakeFromDisk());
  const OTHERS = FIGHTERS.filter((f) => f.id !== "kirby");

  it.each(OTHERS.map((d) => [d.id, d] as const))("Kirby runs %s's neutral special as his own", (id, copied) => {
    const s = lineUp(["mario"], 40, ONE_V_ONE, BAKED);
    s.fighters[0].combat.copy = id;
    // A stored charge (Charge Shot, Giant Punch) fires on a second press.
    const again = copied.moves.neutralB?.specialCharge?.mode === "store" ? 40 : -1;
    const { states } = run(s, 100, (i) => [i === 0 || i === again ? Btn.Special : 0, 0], BAKED);
    expect(states[1].fighters[0]).toMatchObject({ action: "special", move: "neutralB" });
    const own = copied.moves.neutralB?.projectiles ?? [];
    if (own.length > 0) {
      const fired = states.flatMap((st) => st.projectiles).find((p) => p.owner === 0);
      expect(fired, `${id}'s projectile`).toBeDefined();
      expect(fired!.source).toBe(id);
      expect(fired!.damageMul).toBe(COPY_DAMAGE);
    }
  });
});
