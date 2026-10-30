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
import { kineticSet } from "@/engine/kinetic";
import { hashState } from "@/engine/hash";
import { COPY_DAMAGE, COPY_GRACE_FRAMES, COPY_LOSS_PENDING } from "@/engine/inhale";
import { computeHitlag, computeKnockback, framesAfterHit } from "@/engine/knockback";
import { fighterParams } from "@/engine/params";
import { shieldDamage } from "@/engine/shield";
import { KO_FREEZE_FRAMES, cloneState, createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import type { SimContext } from "@/engine/simulate";
import { GRAB_RELEASE_IMMUNITY, onLanded } from "@/engine/states";
import type { StateContext } from "@/engine/states";
import {
  INHALE_MIN_FRAMES,
  INHALE_WALK,
  STAR_ESCAPE_X,
  STAR_ESCAPE_Y,
} from "@/engine/status/inhale";
import { Btn } from "@/engine/types";
import type { FighterDef, FighterState, GameState, InputFrame, MatchRules, StepEvents } from "@/engine/types";
import { bakedContext } from "@/game/bake";
import { stateInvariantBreaks } from "@/game/stateInvariants";
import { readBakeFromDisk } from "@/game/bakeNode";
import { STAGES } from "@/stages";
import { BATTLEFIELD_LOWER_PLATFORM_Y } from "@/stages/battlefield";
import { FIGHTERS } from "./index";

const ONE_V_ONE: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };
const FREE_FOR_ALL: MatchRules = { ...ONE_V_ONE, oneOnOne: false };
const KIRBY = FIGHTERS.find((f) => f.id === "kirby")!;
const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));
const FD = STAGES.find((s) => s.id === "finalDestination")!;
/** As the game plays: the committed bake's bones, hurtboxes and ECB. */
const BAKED: SimContext = bakedContext({ fighter: (id) => BY_ID.get(id)!, stage: (id) => STAGES.find((s) => s.id === id)! }, readBakeFromDisk());
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

  /**
   * The spit star clanks (Plan 5, Task 13c: rubendal 13.0.1 `kirby_starmissile`
   * `Fly`, `Clang_Rebound=ATTACK_SETOFF_KIND_ON`), weighed at its rider's damage, the
   * one its box carries in `chargeScale` (SmashWiki "Priority": "after most damage
   * multipliers"). `defender` (port 2) presses `press` on the first step that clanks.
   */
  function starClank(defender: string, press: InputFrame) {
    for (let k = 25; k <= 50; k++) {
      // Kirby inhales Mario on 0 and spits him at `defender` on 30, as `inhaled` does.
      const { states, events } = run(lineUp(["mario", defender], 10, FREE_FOR_ALL), 90, (i) => [i === 0 ? Btn.Special : i === 30 ? Btn.Attack : 0, 0, i === k ? press : 0]);
      const at = events.findIndex((e) => e.clanks.length > 0);
      if (at >= 0) return { at, states, events };
    }
    throw new Error("no timing clanked");
  }

  it("spits a star that clanks at its rider's 15%: it beats Fox's 1.8% jab, which rebounds, and flies on with Mario (Task 13c)", () => {
    const { at, states } = starClank("fox", Btn.Attack);
    expect(states[at].projectiles.map((p) => p.defId)).toEqual(["star"]);
    expect(states[at].fighters[1].action).toBe("spatStar");
    expect([states[at].fighters[2].action, states[at].fighters[2].move]).toEqual(["stand", null]);
  });

  it("lets the star's rider go when the star loses a clank: Marth's 18% forward smash, within 9% of it (Task 13c)", () => {
    const { at, states } = starClank("marth", Btn.Left | Btn.Attack);
    expect(states[at].projectiles).toEqual([]);
    expect(states[at].fighters[1]).toMatchObject({ action: "fall", grabbedBy: -1 });
    expect(states[at].fighters[1].combat.ride).toBe(0);
  });

  it("lets Donkey Kong's forward smash trample the star: the star is gone, and the smash swings on into Kirby, nothing blocked (Task 13c)", () => {
    // Donkey Kong's smash (22%, ATTACK_SETOFF_KIND_THRU) and the star (15%) are
    // within 9%: the star loses, and Donkey Kong, who cannot rebound, swings on. No
    // fighter's box met his, so it hits Kirby, the star's owner, as freely as anyone
    // (UNVERIFIED: SmashWiki's "blocked for other clanking character" names a fighter).
    const held = holdingMario(["donkeyKong"], FREE_FOR_ALL);
    let found: { at: number; events: StepEvents[]; states: GameState[] } | null = null;
    for (let k = 0; k <= 20 && found === null; k++) {
      const s = cloneState(held);
      Object.assign(s.fighters[2], { x: s.fighters[0].x + fx(16), facing: -1 });
      const out = run(s, 40, (i) => [i === 20 ? Btn.Attack : 0, 0, i === k ? Btn.Left | Btn.Attack : 0]);
      const at = out.events.findIndex((e) => e.clanks.length > 0);
      if (at >= 0) found = { at, ...out };
    }
    expect(found).not.toBeNull();
    const { at, events, states } = found!;
    expect(states[at].projectiles).toEqual([]);
    expect(states[at].fighters[1].action).toBe("fall");
    expect([states[at].fighters[2].action, states[at].fighters[2].move]).toEqual(["attack", "fsmash"]);
    expect(events.slice(at + 1).some((e) => e.hits.some((h) => h.attacker === 2 && h.victim === 0))).toBe(true);
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

  it("keeps the 4-unit reach and the closed ledge through a swallow or spit before its release", () => {
    // The swallow pressed at the blast line: still holding, so the reach still counts.
    const b = FD.blastZone;
    const s = holdingMario();
    Object.assign(s.fighters[0], { x: b.right - fx(3), y: fx(20), grounded: false, platform: -1, facing: 1 });
    expect(run(s, 1, () => [Btn.Special, 0]).events[0].kos.map((k) => k.port)).toEqual([0]);
    // Falling past the right ledge, facing it: a free Kirby takes it at once; one
    // spitting does not before the spit's release on its frame 8 (step 7).
    const place = (st: GameState) => Object.assign(st.fighters[0], { x: fx(83), y: fx(-2), grounded: false, platform: -1, facing: -1 });
    const free = lineUp(["mario"], 60);
    place(free);
    free.fighters[0].action = "fall";
    expect(run(free, 3, () => [0, 0]).states.some((st) => st.fighters[0].ledge !== null)).toBe(true);
    const spitting = holdingMario();
    place(spitting);
    const { states } = run(spitting, 8, (i) => [i === 0 ? Btn.Attack : 0, 0]);
    expect(states.slice(0, 7).every((st) => st.fighters[0].ledge === null && st.fighters[0].action === "special")).toBe(true);
  });

  it("lands a special that holds someone but lets nobody out (no `release`), as any special lands (forged: none does today)", () => {
    const s = holdingMario();
    const kirby = s.fighters[0];
    const ctx = { def: KIRBY, stage: FD, frame: 1, fighters: s.fighters } as StateContext;
    Object.assign(kirby, { action: "special", move: "upB", grounded: true, platform: 0 });
    onLanded(kirby, ctx);
    expect(kirby.action).toBe("land");
    Object.assign(kirby, { action: "special", move: "inhaleSwallow", actionFrame: 3 });
    onLanded(kirby, ctx);
    expect(kirby).toMatchObject({ action: "special", move: "inhaleSwallow" });
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
  it("deals 10% on its frame 8, gives Kirby Mario's neutral special, and flies Mario out on its star", () => {
    const s = holdingMario([], FREE_FOR_ALL);
    const { states, events } = run(s, 20, (i) => [i === 0 ? Btn.Special : 0, 0]);
    const out = states.findIndex((st) => st.fighters[1].action !== "swallowed");
    expect(out).toBe(7); // move frame 8, entered on step 0
    expect(states[out].fighters[1].damage).toBe(fx(10));
    expect(events[out].hits).toEqual([expect.objectContaining({ attacker: 0, victim: 1, damage: fx(10), knockback: 0 })]);
    expect(states[out].fighters[0].combat.copy).toBe("mario");
    expect(states[out].fighters[0].combat.copyFrames).toBe(0);
    expectNothingHeld(states[out].fighters[0], "Kirby");
    // Out of the mouth and on the swallow's star: the link is gone, 7 above Kirby.
    const kirby = states[out].fighters[0];
    expect(states[out].fighters[1]).toMatchObject({ action: "spatStar", grabbedBy: -1, x: kirby.x, y: kirby.y + fx(7) });
    expect(states[out].fighters[1].combat.ride).toBeLessThan(0);
    expect(states[out].fighters[1].combat).toMatchObject({ mash: 0, grabLength: 0 });
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

  it("in the air flies Mario out on its star from where Kirby is, then lets him fall, nothing held", () => {
    const s = holdingMario();
    Object.assign(s.fighters[0], { y: fx(60), grounded: false, platform: -1 });
    const { states } = run(s, 20, (i) => [i === 0 ? Btn.Special : 0, 0]);
    const out = states[7];
    expect(out.fighters[1]).toMatchObject({ action: "spatStar", x: out.fighters[0].x, y: out.fighters[0].y + fx(7) });
    expectNothingHeld(out.fighters[0], "Kirby");
    expect(out.fighters[0].combat.copy).toBe("mario");
    expect(states[16].fighters[1].action).toBe("spatStar");
    expect(states[17].fighters[1].action).toBe("fall");
    expectNothingHeld(states[17].fighters[1], "the swallowed");
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

  it("leaves no mash credit on its rider, however the ride ends (forged)", () => {
    const { states } = spat();
    const at = states.findIndex((st) => st.fighters[1].action === "spatStar");
    const s = cloneState(states[at]);
    s.fighters[1].combat.mash = 6;
    const after = run(s, 40, () => [0, 0]).states;
    const off = after.findIndex((st) => st.fighters[1].action !== "spatStar");
    expect(off).toBeGreaterThan(0);
    expect(after[off - 1].fighters[1].combat.mash).toBe(6);
    expect(after[off].fighters[1].combat.mash).toBe(0);
  });

  it("carries its rider past the top line if it climbs there, which takes them (forged: no move sends a star up)", () => {
    const b = FD.blastZone;
    const { states } = spat();
    const at = states.findIndex((st) => st.fighters[1].action === "spatStar");
    const s = cloneState(states[at]);
    const star = s.projectiles[0];
    Object.assign(star, { y: b.top - fx(1), vy: fx(3) });
    Object.assign(s.fighters[1], { y: b.top - fx(1) });
    const { events, states: after } = run(s, 1, () => [0, 0]);
    expect(events[0].kos.map((k) => k.port)).toEqual([1]);
    expect(after[0].fighters[1].action).toBe("dead");
  });

  it("is the published star: its box, its flight and its rules (SmashWiki's star parameters and hitbox table)", () => {
    const star = KIRBY.moves.inhaleSpit!.projectiles![0];
    expect(star).toMatchObject({
      id: "star",
      spawnFrame: 8,
      offsetX: fx(7),
      offsetY: fx(7),
      vx: fx(2.8),
      vy: 0,
      gravity: 0,
      lifetime: 60,
      destroyOnHit: false,
      drag: { perFrame: fx(0.05), minSpeed: fx(0.4) },
      ridden: true,
      reflectable: true,
    });
    expect(star.hitbox).toMatchObject({ radius: fx(2.5), angle: fx(45), baseKnockback: fx(70), knockbackGrowth: fx(78), hitlagMultiplier: fx(2) });
    // It clanks (Plan 5, Task 13c): `kirby_starmissile` `Fly` is ATTACK_SETOFF_KIND_ON.
    expect(star.hitbox.transcendent).toBeUndefined();
    expect(KIRBY.moves.inhaleSwallow!.release).toEqual({
      frame: 8,
      kind: "swallow",
      damage: fx(10),
      star: { offsetY: fx(7), speed: fx(3.4), angle: fx(62), friction: fx(0.17), frames: 10 },
    });
    expect(KIRBY.moves.inhaleSpit!).toMatchObject({ totalFrames: 30, aerialTotalFrames: 38, release: { frame: 8, kind: "spit", damage: fx(6) } });
  });

  it("is sent back by a reflector, its rider still aboard", () => {
    const s = holdingMario(["fox"], FREE_FOR_ALL);
    Object.assign(s.fighters[2], { x: fx(10), facing: -1 });
    const { states } = run(s, 40, (i) => [i === 0 ? Btn.Attack : 0, 0, i === 6 ? Btn.Down | Btn.Special : 0]);
    const at = states.findIndex((st) => st.projectiles.some((p) => p.reflected > 0));
    expect(at).toBeGreaterThan(7);
    expect(states[at].projectiles[0]).toMatchObject({ owner: 2, defId: "star" });
    expect(states[at].fighters[1].action).toBe("spatStar");
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

  it("draws on a pummel too, and on a spit's release, as on any damage taken", () => {
    // A pummel: Mario grabs Kirby (copying Fox, grace over) and pummels him.
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = lineUp(["mario"], 8);
      s.rngSeed = seed;
      Object.assign(s.fighters[0].combat, { copy: "fox", copyFrames: COPY_GRACE_FRAMES });
      const { states, events } = run(s, 40, (i) => [0, i === 0 ? Btn.Grab : i === 20 ? Btn.Attack : 0]);
      const at = events.findIndex((e) => e.hits.some((h) => h.attacker === 1 && h.victim === 0));
      expect(at, `seed ${seed}: the pummel`).toBeGreaterThan(0);
      expect(states[at].fighters[0].action, `seed ${seed}`).toBe("grabbed");
      const draw = randomInt(seed, 100 * ONE);
      expect(states[at].rngSeed, `seed ${seed}`).toBe(draw.seed);
      expect(states[at].fighters[0].combat.copy, `seed ${seed}`).toBe(draw.value < events[at].hits[0].damage ? "" : "fox");
    }
    // A spit: one Kirby spits another, who is copying Fox past the grace.
    for (const seed of [1, 2, 3]) {
      const s = lineUp(["kirby"]);
      s.rngSeed = seed;
      Object.assign(s.fighters[1].combat, { copy: "fox", copyFrames: COPY_GRACE_FRAMES });
      const { states, events } = run(s, 50, (i) => [i === 0 ? Btn.Special : i === 20 ? Btn.Attack : 0, 0]);
      const at = states.findIndex((st) => st.fighters[1].action === "spatStar");
      expect(at, `seed ${seed}: the spit`).toBeGreaterThan(0);
      const draw = randomInt(seed, 100 * ONE);
      expect(states[at].rngSeed, `seed ${seed}`).toBe(draw.seed);
      const damage = events[at].hits.find((h) => h.victim === 1)!.damage;
      expect(states[at].fighters[1].combat.copy, `seed ${seed}`).toBe(draw.value < damage ? "" : "fox");
    }
  });

  it("leaves a copied Fireball reflected away when Kirby loses the copy: it is the reflector's (UNVERIFIED)", () => {
    const s = lineUp(["fox"], 30);
    s.fighters[0].combat.copy = "mario";
    const { states } = run(s, 30, (i) => [i === 0 ? Btn.Special : 0, i === 10 ? Btn.Down | Btn.Special : 0]);
    const at = states.findIndex((st) => st.projectiles.some((p) => p.reflected > 0));
    expect(at).toBeGreaterThan(0);
    expect(states[at].projectiles[0]).toMatchObject({ owner: 1, source: "mario", damageMul: COPY_DAMAGE });
    const ko = cloneState(states[at]);
    Object.assign(ko.fighters[0], { x: fx(-400), grounded: false, platform: -1, action: "fall" });
    const after = run(ko, 1, () => [0, 0]).states[0];
    expect(after.fighters[0]).toMatchObject({ action: "dead" });
    expect(after.fighters[0].combat.copy).toBe("");
    expect(after.projectiles.map((p) => p.owner)).toEqual([1]);
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

  it("Kirby grabbed while holding lets Mario out", () => {
    const s = holdingMario(["fox"], FREE_FOR_ALL);
    Object.assign(s.fighters[2], { x: fx(-14), facing: -1 });
    const { states } = run(s, 30, (i) => [0, 0, i === 1 ? Btn.Grab : 0]);
    const grabbed = states.findIndex((st) => st.fighters[0].grabbedBy === 2);
    expect(grabbed).toBeGreaterThan(0);
    expect(states[grabbed].fighters[1]).toMatchObject({ grabbedBy: -1, grabTimer: 0 });
    expect(states[grabbed].fighters[1].combat).toMatchObject({ mash: 0, grabLength: 0 });
    expectNothingHeld(states[grabbed + 1].fighters[1], "Mario");
  });

  it("Kirby hit in the swallow before its frame 8 lets Mario out unswallowed and uncopied", () => {
    const s = holdingMario(["fox"], FREE_FOR_ALL);
    Object.assign(s.fighters[2], { x: fx(-15), facing: -1 });
    // Fox's forward smash, pressed first, lands on the swallow's frame 5.
    const { states, events } = run(s, 30, (i) => [i === 8 ? Btn.Special : 0, 0, i === 0 ? Btn.Attack | Btn.Left : 0]);
    const hit = events.findIndex((e) => e.hits.some((h) => h.victim === 0));
    expect(hit).toBeGreaterThan(8);
    expect(states[hit - 1].fighters[0]).toMatchObject({ action: "special", move: "inhaleSwallow" });
    expect(states[hit - 1].fighters[0].actionFrame + 1).toBeLessThan(8);
    expectNothingHeld(states[hit].fighters[0], "Kirby");
    expectNothingHeld(states[hit + 1].fighters[1], "Mario");
    // No swallow's 10% from Kirby, and no copy.
    expect(events.flatMap((e) => e.hits).filter((h) => h.attacker === 0 && h.victim === 1)).toEqual([]);
    expect(states[states.length - 1].fighters[0].combat.copy).toBe("");
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

  it("a match whose time runs out mid-swallow ends there whole, and replays to the same end", () => {
    // `timeLimit` is in frames.
    const rules: MatchRules = { mode: "time", stocks: 0, timeLimit: 3600, smashBall: false, oneOnOne: true };
    const s = holdingMario([], rules);
    s.timeRemaining = 5;
    // Not a tie, or the clock would call sudden death.
    s.fighters[1].damage = fx(10);
    const script = (i: number): InputFrame[] => [i === 0 ? Btn.Special : 0, 0];
    const { states } = run(s, 5, script);
    const end = states[states.length - 1];
    expect(end.outcome).toEqual({ kind: "timeUp", placings: [0, 1] });
    // Ended mid-swallow (frame 5 of 8), the link whole at both ends.
    expect(end.fighters[0]).toMatchObject({ action: "special", move: "inhaleSwallow", grabbing: 1 });
    expect(end.fighters[1]).toMatchObject({ action: "swallowed", grabbedBy: 0 });
    expect(end.fighters[1].grabTimer).toBeGreaterThan(0);
    expect(hashState(cloneState(end))).toBe(hashState(end));
    // A rollback across the last frame (as an online match's confirmation may run)
    // reaches the same end, hash for hash.
    expectRollbackSafe(s, 5, script, [0, 1, 2, 3]);
  });
});

describe("Inhale's own published shape (Task 9 fix round 1, ruling R-T9f)", () => {
  it("tapped, lasts 63 frames: Kirby acts on frame 64", () => {
    const { states } = run(lineUp(["mario"], 60), 66, (i) => [i === 0 ? Btn.Special : 0, 0]);
    expect(states[62].fighters[0].action).toBe("special");
    expect(states[63].fighters[0].action).toBe("stand");
  });

  it("held, goes round frames 35-44 until B comes up, and acts on the 20th frame from the release", () => {
    const { states } = run(lineUp(["mario"], 60), 125, (i) => [i < 100 ? Btn.Special : 0, 0]);
    for (let i = 44; i < 100; i++) {
      expect(states[i].fighters[0].action, `step ${i}`).toBe("special");
      const frame = states[i].fighters[0].actionFrame + 1;
      expect(frame >= 35 && frame <= 44, `step ${i}: move frame ${frame}`).toBe(true);
    }
    expect(states[118].fighters[0].action).toBe("special");
    expect(states[119].fighters[0].action).toBe("stand");
  });

  it("held, still catches whoever comes into reach after its 63 frames", () => {
    const s = lineUp(["mario"], 60);
    const held = run(s, 80, () => [Btn.Special, 0]).states[79];
    Object.assign(held.fighters[1], { x: held.fighters[0].x + fx(10) });
    const { states } = run(held, 12, () => [Btn.Special, 0]);
    expect(states.some((st) => st.fighters[1].action === "swallowed")).toBe(true);
  });

  it("catches with 6.0 on frame 10, then 5.8, and 5.3 further out for airborne fighters only", () => {
    const caught = (gap: number, air: boolean) => {
      const s = lineUp(["mario"], gap);
      if (air) Object.assign(s.fighters[1], { y: fx(9), grounded: false, platform: -1, action: "fall" });
      const { states, events } = run(s, 30, (i) => [i === 0 ? Btn.Special : 0, 0]);
      return { at: caughtAt(states), pulled: events.findIndex((e) => e.pushes.length > 0) };
    };
    // Frame 10's box (step 9), then the loop's from 11.
    expect(caught(13, false).at).toBe(9);
    expect(caught(14, false).at).toBe(10);
    // 16 apart: the air-only 5.3 box takes an airborne Mario on 11, unpulled; on the
    // ground he is pulled on 11 and caught after.
    expect(caught(16, true)).toEqual({ at: 10, pulled: -1 });
    const ground = caught(16, false);
    expect(ground.pulled).toBe(10);
    expect(ground.at).toBeGreaterThan(10);
  });

  it("pulls on frames 11, 21, 31 and 41, at 160°, and a pulled fighter can still be caught", () => {
    const s = lineUp(["mario"], 18);
    const { states, events } = run(s, 40, (i) => [i === 0 ? Btn.Special : 0, 0]);
    const pulls = events.map((e, i) => (e.pushes.some((p) => p.attacker === 0 && p.victim === 1) ? i : -1)).filter((i) => i >= 0);
    expect(pulls).toEqual([10, 20]);
    // Towards Kirby (160° from the way he faces), then into his mouth.
    expect(states[10].fighters[1].vx).toBeLessThan(0);
    expect(caughtAt(states)).toBe(21);
    // The far pull takes grounded fighters only: airborne beyond the near one's reach, none.
    const air = lineUp(["mario"], 21);
    Object.assign(air.fighters[1], { y: fx(9), grounded: false, platform: -1, action: "fall" });
    expect(run(air, 12, (i) => [i === 0 ? Btn.Special : 0, 0]).events[10].pushes).toEqual([]);
    expect(run(lineUp(["mario"], 21), 12, (i) => [i === 0 ? Btn.Special : 0, 0]).events[10].pushes).toHaveLength(1);
  });

  it("spits for 30 frames on the ground and 38 in the air", () => {
    const ground = run(holdingMario(), 34, (i) => [i === 0 ? Btn.Attack : 0, 0]).states;
    expect(ground[29].fighters[0].action).toBe("special");
    expect(ground[30].fighters[0].action).toBe("stand");
    const high = holdingMario();
    Object.assign(high.fighters[0], { y: fx(150), grounded: false, platform: -1 });
    const air = run(high, 42, (i) => [i === 0 ? Btn.Attack : 0, 0]).states;
    expect(air[37].fighters[0].action).toBe("special");
    expect(air[38].fighters[0].action).toBe("fall");
  });

  it("flies the swallowed out 10 frames along 62°, from 3.4 slowing 0.17 a frame", () => {
    const { states } = run(holdingMario(), 20, (i) => [i === 0 ? Btn.Special : 0, 0]);
    const from = states[7].fighters[1];
    const to = states[16].fighters[1];
    expect(to.action).toBe("spatStar");
    // Nine frames of flight: Σ (3.4 − 0.17k), k = 1..9, along 62°, the way Kirby faces.
    const path = 9 * 3.4 - 0.17 * 45;
    expect(toFloat(to.x - from.x)).toBeCloseTo(path * Math.cos((62 * Math.PI) / 180), 1);
    expect(toFloat(to.y - from.y)).toBeCloseTo(path * Math.sin((62 * Math.PI) / 180), 1);
    // Off it, from rest: the spit star's escape speed is published for that star alone
    // (UNVERIFIED), so only the frame's own gravity moves Mario.
    const off = states[17].fighters[1];
    expect(off.action).toBe("fall");
    expect(off.vx).toBe(0);
    expect(off.vy).toBeLessThanOrEqual(0);
    expect(off.vy).toBeGreaterThan(-fx(0.2));
  });

  it("lets no mash shorten the swallow's star: it \"cannot be influenced by mashing\" (SmashWiki \"Inhale (Kirby)\")", () => {
    const { states } = run(holdingMario(), 20, (i) => [i === 0 ? Btn.Special : 0, i >= 8 && i % 2 === 0 ? Btn.Attack : 0]);
    expect(states[16].fighters[1].action).toBe("spatStar");
    expect(states[17].fighters[1].action).toBe("fall");
  });

  it("flies no swallow's star that would start inside the stage: Kirby pressed to its underside lets Mario out at him (fix round 2)", () => {
    // Swallowing under Final Destination, pressed up against its underside on the release.
    const { states } = run(holdingMario(), 7, (i) => [i === 0 ? Btn.Special : 0, 0]);
    const s = cloneState(states[6]);
    Object.assign(s.fighters[0], { x: 0, y: fx(-66.5), grounded: false, platform: -1 });
    kineticSet(s.fighters[0], 0, fx(2));
    const after = run(s, 20, () => [0, 0]).states;
    expect(after[0].fighters[0].combat.copy).toBe("mario");
    expect(toFloat(after[0].fighters[0].y + fx(7))).toBeGreaterThan(-60);
    expect(after[0].fighters[1].action).toBe("fall");
    expect(after[0].fighters[1].x).toBe(after[0].fighters[0].x);
    after.forEach((st, k) => expect(stateInvariantBreaks(st, FD, k), `step ${k}`).toEqual([]));
  });

  it.each([
    [-83, 1],
    [83, -1],
  ])("launches no spit star inside the stage: spitting at its wall from x %i, Mario comes out at Kirby (fix round 3)", (x, facing) => {
    // Beside Final Destination's side, below its floor, facing it: the star's spawn
    // point (7 ahead, 7 up) is inside the body, so it is never launched
    // (`spawnDueProjectiles`).
    const s = holdingMario();
    Object.assign(s.fighters[0], { x: fx(x), y: fx(-30), grounded: false, platform: -1, facing });
    const { states, events } = run(s, 30, (i) => [i === 0 ? Btn.Attack : 0, 0]);
    expect(events[7].hits).toEqual([expect.objectContaining({ attacker: 0, victim: 1 })]);
    expect(states[7].projectiles).toEqual([]);
    expect(states[7].fighters[1]).toMatchObject({ action: "fall", grabbedBy: -1, x: states[7].fighters[0].x });
    expect(states.every((st) => st.fighters[1].action !== "spatStar")).toBe(true);
    states.forEach((st, k) => expect(stateInvariantBreaks(st, FD, k), `step ${k}`).toEqual([]));
    // A refused spawn leaves nothing behind a rollback could disagree on (Plan 5,
    // Task 13c; the Task 9 re-review 3's carry): from before, at and after it, the
    // same inputs give the same states, hash for hash.
    expectRollbackSafe(s, 30, (i) => [i === 0 ? Btn.Attack : 0, 0], [0, 5, 6, 7, 8, 12]);
  });

  it("stops the swallow's star short of the stage's solid body, and lets its rider go there", () => {
    // Off Final Destination's right side, below its floor, facing it: the star climbs into the side.
    const s = holdingMario();
    Object.assign(s.fighters[0], { x: fx(90), y: fx(-30), grounded: false, platform: -1, facing: -1 });
    const { states } = run(s, 20, (i) => [i === 0 ? Btn.Special : 0, 0]);
    const out = states.findIndex((st, i) => i > 7 && st.fighters[1].action !== "spatStar");
    expect(out).toBeGreaterThan(7);
    expect(out).toBeLessThan(17);
    for (const st of states) {
      const m = st.fighters[1];
      expect(Math.abs(toFloat(m.x)) < 80 && toFloat(m.y) < 0 && toFloat(m.y) > -60, `frame ${st.frame}: Mario inside the stage`).toBe(false);
    }
  });
});

describe("a Copy Ability's end (Task 9 fix round 1)", () => {
  /** Kirby copying Donkey Kong, a full punch stored, grace over: Mario forward-smashes into its armour. */
  function armouredPunch(seed: number) {
    const s = lineUp(["mario"], 12);
    s.rngSeed = seed;
    Object.assign(s.fighters[0].combat, { copy: "donkeyKong", copyFrames: COPY_GRACE_FRAMES, storedCharge: 110 });
    return run(s, 100, (i) => [i === 0 ? Btn.Special : 0, i === 0 ? Btn.Left | Btn.Attack : 0]).states;
  }

  it("lost mid-copied special, waits for that move's end: Kirby finishes the punch, then has no copy and no Inhale (ruling R-T9d)", () => {
    // Seed 7 loses the copy to Mario's hit inside the armour; seed 6 keeps it.
    const lost = armouredPunch(7);
    const kept = armouredPunch(6);
    const pending = lost.findIndex((st) => st.fighters[0].combat.copyFrames === COPY_LOSS_PENDING);
    expect(pending).toBe(14);
    expect(lost[pending].fighters[0]).toMatchObject({ action: "special", move: "neutralB" });
    expect(kept.every((st) => st.fighters[0].combat.copyFrames === COPY_GRACE_FRAMES)).toBe(true);
    // The punch runs on Donkey Kong's timing to its end, frame for frame as when kept.
    const end = kept.findIndex((st, i) => i > 0 && st.fighters[0].action !== "special");
    expect(end).toBeGreaterThan(pending);
    for (let i = 0; i <= end; i++) {
      expect([lost[i].fighters[0].action, lost[i].fighters[0].actionFrame], `step ${i}`).toEqual([kept[i].fighters[0].action, kept[i].fighters[0].actionFrame]);
      expect(lost[i].fighters[0].combat.copy, `step ${i}`).toBe(i < end ? "donkeyKong" : "");
    }
    expect(lost[end].fighters[0].combat).toMatchObject({ copy: "", copyFrames: 0, storedCharge: 0 });
    expect(lost.every((st) => st.fighters[1].action !== "swallowed")).toBe(true);
  });

  it("runs no frame of a lost copy's next special: B on the hand-off starts Kirby's own Inhale (fix round 2)", () => {
    // A forged copy whose neutral special has a box on its frame 1, reaching Mario.
    // Its own move, not Mario's Fireball script (which runs since Plan 5, Task 13).
    const mario = BY_ID.get("mario")!;
    const copycat = {
      ...mario,
      id: "copycat",
      scripts: Object.fromEntries(Object.entries(mario.scripts ?? {}).filter(([slot]) => slot !== "neutralB")),
      moves: {
        ...mario.moves,
        neutralB: {
          slot: "neutralB",
          name: "Copycat",
          totalFrames: 20,
          hitboxes: [{ id: 0, startFrame: 1, endFrame: 1, x: fx(6), y: fx(5), radius: fx(6), damage: fx(5), angle: fx(361), baseKnockback: fx(20), knockbackGrowth: fx(50) }],
        },
      },
    } as FighterDef;
    const ctx: SimContext = { fighter: (id) => (id === "copycat" ? copycat : BY_ID.get(id)!), stage: (id) => STAGES.find((st) => st.id === id)! };
    /** Kirby on the copied special's frame 19 of 20, `copyFrames` as given; B on the hand-off (step 1). */
    const handOff = (copyFrames: number) => {
      const s = lineUp(["mario"], 8);
      Object.assign(s.fighters[0], { action: "special", move: "neutralB", actionFrame: 18 });
      Object.assign(s.fighters[0].combat, { copy: "copycat", copyFrames });
      return run(s, 3, (i) => [i === 1 ? Btn.Special : 0, 0], ctx);
    };
    // Kept, the copy's frame-1 box hits Mario on the hand-off.
    const kept = handOff(COPY_GRACE_FRAMES);
    expect(kept.events[1].hits.some((h) => h.attacker === 0 && h.victim === 1)).toBe(true);
    // Lost (pending), the loss lands on the hand-off and the new special is Kirby's own.
    const lost = handOff(COPY_LOSS_PENDING);
    expect(lost.states[1].fighters[0]).toMatchObject({ action: "special", move: "neutralB", actionFrame: 0 });
    expect(lost.states[1].fighters[0].combat.copy).toBe("");
    expect(lost.events.flatMap((e) => e.hits).filter((h) => h.attacker === 0)).toEqual([]);
  });

  it("takes no stored charge across: a full Charge Shot stored under a Samus copy is no full Giant Punch under a Donkey Kong copy (ruling R-T9e)", () => {
    /** Kirby copying Samus, a full charge stored, grace over, jabbed by Donkey Kong. */
    const jabbed = (seed: number) => {
      const s = lineUp(["donkeyKong"], 10);
      s.rngSeed = seed;
      Object.assign(s.fighters[0].combat, { copy: "samus", copyFrames: COPY_GRACE_FRAMES, storedCharge: 112 });
      return run(s, 30, (i) => [0, i === 0 ? Btn.Attack : 0]).states;
    };
    let seed = 1;
    while (jabbed(seed)[29].fighters[0].combat.copy !== "") seed += 1;
    const after = jabbed(seed)[29];
    expect(after.fighters[0].combat).toMatchObject({ copy: "", storedCharge: 0 });
    // ...and a new copy starts with none either, whatever was stored.
    Object.assign(after.fighters[0], { action: "stand", actionFrame: 0, hitstun: 0, x: fx(-20), facing: 1, grounded: true, platform: 0, y: 0 });
    Object.assign(after.fighters[1], { action: "stand", actionFrame: 0, hitstun: 0, x: fx(-10), facing: -1, grounded: true, platform: 0, y: 0 });
    after.fighters[0].combat.storedCharge = 112;
    after.fighters[0].hitlag = 0;
    after.fighters[1].hitlag = 0;
    const { states } = run(after, 80, (i) => [i === 0 || i === 30 || i === 60 ? Btn.Special : 0, 0]);
    expect(states[50].fighters[0].combat).toMatchObject({ copy: "donkeyKong", storedCharge: 0 });
    // B under the new copy winds a punch up from nothing, on its loop frame.
    const punch = states[61].fighters[0];
    expect(punch).toMatchObject({ action: "special", move: "neutralB" });
    expect(punch.charge).toBeLessThan(110);
  });

  /** `attacker` (or Kirby copying it) hits Fox with its neutral special, in the baked world, outside a 1v1. */
  function neutralSpecial(attacker: string, copying: boolean, keys: (i: number) => InputFrame) {
    const s = createInitialState("finalDestination", [{ defId: copying ? "kirby" : attacker }, { defId: "fox" }], FREE_FOR_ALL, 9, BAKED);
    s.fighters.forEach((f, i) =>
      Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(-20 + i * 12), y: 0, facing: i === 0 ? 1 : -1, intangible: 0, invincible: 0 }),
    );
    if (copying) s.fighters[0].combat.copy = attacker;
    const { states, events } = run(s, 90, (i) => [keys(i), 0], BAKED);
    const at = events.findIndex((e) => e.hits.length > 0);
    return { hit: events[at].hits[0], hitlag: states[at].fighters[1].hitlag };
  }

  it("hurts ×1.2 with a copied melee special, and freezes as the owner's own hit does", () => {
    // Shield Breaker, uncharged: 9 × 1.05 fresh = 9.45, copied 11.34.
    const sb = (copying: boolean) => neutralSpecial("marth", copying, (i) => (i === 0 ? Btn.Special : 0));
    expect(toFloat(sb(false).hit.damage)).toBeCloseTo(9.45, 2);
    expect(sb(true).hit.damage).toBe(mul(sb(false).hit.damage, COPY_DAMAGE));
    expect(toFloat(sb(true).hit.damage)).toBeCloseTo(11.34, 2);
    // Giant Punch, wound 13 frames: 12 × 1.05 = 12.6, copied 15.12.
    const gp = (copying: boolean) => neutralSpecial("donkeyKong", copying, (i) => (i === 0 || i === 20 ? Btn.Special : 0));
    expect(toFloat(gp(false).hit.damage)).toBeCloseTo(12.6, 2);
    expect(toFloat(gp(true).hit.damage)).toBeCloseTo(15.12, 2);
    // UNVERIFIED reading: the ×1.2 is left out of hitlag, as the 1v1 bonus is (here
    // it would cross a frame: 12.6 freezes 13, 15.12 would freeze 14).
    expect(gp(true).hitlag).toBe(gp(false).hitlag);
    expect(sb(true).hitlag).toBe(sb(false).hitlag);
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
