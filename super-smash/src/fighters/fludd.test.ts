/**
 * F.L.U.D.D., through the real `step()` (Plan 5, Task 6): a store-mode charge
 * (80 frames) that releases seven windbox pumps. A windbox pushes and does
 * nothing else: no damage, no hitstun, no hitlag.
 *
 * Sources, every one read for this task:
 * - SmashWiki "Mario (SSBU)/Down special"
 *   (https://www.ssbwiki.com/Mario_(SSBU)/Down_special): the hitbox row (0%,
 *   angle 55, BK 0, KS 100, FKV 70, size 4.0, `clang=f`, `flinchless=t`,
 *   `reflectable=t`, `nogfx=t`) and its note "Base knockback can increase up to
 *   55 depending on charge"; "Charges between 19-20"; "Pumps 21-32, 26-37,
 *   31-42, 36-47, 41-52, 46-57, 51-62"; "Interruptible (from release) 68 (49)";
 *   "Total charge time 80 frames"; "Default shot angle 12°"; "Number of pumps
 *   shot 7", "Delay between pumps 5 frames"; "Lifetime 12 frames", "Initial
 *   speed 4.3", "Maximum additional speed 4.3", "Gravity 0.17", "Minimum size
 *   multiplier 0.8", "Maximum size multiplier 1.2".
 * - rubendal Data Viewer 13.0.1, `mario_pumpwater` `Regular`
 *   (https://rubendal.github.io/ssbu/data/patch/13.0.1/character/Mario/data.json):
 *   `Damage=0.0, Angle=55, KBG=100, FKB=70, BKB=0, Size=4.0`,
 *   `Clang_Rebound=ATTACK_SETOFF_KIND_OFF`, `Reflectable=true`,
 *   `Flinchless=true`, `DisableHitlag=true`.
 * - UltimateFrameData (https://ultimateframedata.com/mario): "Entering charge
 *   state takes 19 frames"; "Down B, Fully Charged": startup 21, total 67.
 * - SmashWiki "Charge" (https://www.ssbwiki.com/Charge): F.L.U.D.D. is an
 *   "Auto-charge special", shield-cancellable.
 * - SmashWiki "F.L.U.D.D." (https://www.ssbwiki.com/F.L.U.D.D.): "pressing a
 *   shield button while charging will cancel and save the charge"; "as it
 *   deals no damage and doesn't cause the opponent to flinch, it can push
 *   opponents away from the stage during their recovery without giving them
 *   another chance to use it".
 * - SmashWiki "Windbox" (https://www.ssbwiki.com/Windbox): windboxes "deal
 *   knockback, but cause no hitstun"; they "cannot lift opponents off the
 *   ground, but can push them off edges"; "characters hanging from a ledge are
 *   not affected"; "Since it is a form of knockback, its effect stacks with all
 *   other forms of movement (e.g fall speed or running), and cannot be directly
 *   opposed, instead decaying over time"; "Pushing attacks that do not deal
 *   damage are ineffective against shielding opponents".
 * - SmashWiki "Reflection" (https://www.ssbwiki.com/Reflection): Mario's
 *   "F.L.U.D.D." is in the table of reflectable projectiles.
 * - SmashWiki "Knockback" (https://www.ssbwiki.com/Knockback): the set
 *   knockback formula, launch speed `KB × 0.03` decaying by 0.051 a frame, and
 *   knockback stacking (0.5× and 0.9×).
 *
 * UNVERIFIED, and pinned here as the replica's reading: the charge grows the
 * pump linearly; a windbox is not countered; a pump is spent on a shield or an
 * invincible fighter and gone after its first hit; a push meets a live launch
 * by knockback stacking; the ledge's getup options are left alone as the hang
 * is.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { LAUNCH_SPEED_DECAY, LAUNCH_SPEED_RATIO } from "@/engine/constants";
import { ONE, cosDeg, fx, mul, sinDeg, toFloat } from "@/engine/fixed";
import { hashState } from "@/engine/hash";
import { computeKnockback } from "@/engine/knockback";
import { fighterParams } from "@/engine/params";
import { projectileHitbox } from "@/engine/projectile";
import { cloneState, createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { hasSuperArmour } from "@/engine/states";
import { Btn } from "@/engine/types";
import type { FighterDef, FighterState, GameState, InputFrame, MatchRules, ProjectileState, StepEvents } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS, donkeyKong, fox, mario } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

const DOWN = mario.moves.downB!;
const PUMP = DOWN.projectiles![0];

/** A stand-in Mario whose pumps outlive their hits (not a published move): what "spent" means shows only on one. */
const HOSE: FighterDef = {
  ...mario,
  id: "marioHose",
  moves: { ...mario.moves, downB: { ...DOWN, projectiles: DOWN.projectiles!.map((p) => ({ ...p, destroyOnHit: false })) } },
};

beforeAll(() => {
  registerFighters([...FIGHTERS, HOSE]);
  registerStages(STAGES);
});

/** `me` (Mario) at −gap/2 facing right, `other` at +gap/2 facing left, both standing on Final Destination. */
function duel(gap: number, other = "fox", me = "mario"): GameState {
  const s = createInitialState("finalDestination", [{ defId: me }, { defId: other }], RULES, 5);
  s.fighters.forEach((f, i) =>
    Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? -gap / 2 : gap / 2), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }),
  );
  return s;
}

function play(s0: GameState, script: readonly [InputFrame, InputFrame][]): { states: GameState[]; events: StepEvents[] } {
  let s = s0;
  let prev: [InputFrame, InputFrame] = [0, 0];
  const states: GameState[] = [];
  const events: StepEvents[] = [];
  for (const now of script) {
    const out = step(s, now, { prevInputs: prev });
    s = out.state;
    prev = now;
    states.push(s);
    events.push(out.events);
  }
  return { states, events };
}

function run(s0: GameState, script: readonly [InputFrame, InputFrame][]): GameState[] {
  return play(s0, script).states;
}

const frames = (n: number, mario: (i: number) => InputFrame, fox: (i: number) => InputFrame = () => 0): [InputFrame, InputFrame][] =>
  Array.from({ length: n }, (_, i) => [mario(i), fox(i)]);

const DOWN_B = Btn.Down | Btn.Special;
/** Press it, then press B again as the charge loop starts: a tap. */
const tap = (i: number): InputFrame => (i === 0 || i === 20 ? DOWN_B : 0);
/** Press it, and press B again in the entry, still buffered when the loop starts: no charge at all. */
const bare = (i: number): InputFrame => (i === 0 || i === 15 ? DOWN_B : 0);

/** Every water pump alive in `s`. */
const pumps = (s: GameState): ProjectileState[] => s.projectiles.filter((p) => p.defId === "water");

/** The first step whose state has `f`'s push (its DAMAGE energy) set, or −1. */
const pushedAt = (states: GameState[], port = 1): number => states.findIndex((s) => s.fighters[port].kinetic.damageX !== 0);

/** Set knockback's knockback for a pump of base knockback `bkb` against `weight` (SmashWiki "Knockback"). */
const pumpKnockback = (bkb: number, weight: number): number =>
  computeKnockback({ percent: 0, damage: 0, weight, baseKnockback: fx(bkb), knockbackGrowth: fx(100), fixedKnockback: fx(70) });

describe("F.L.U.D.D.'s published numbers", () => {
  it("charges in store mode for 80 frames from frame 19, and is interruptible on 68", () => {
    expect(DOWN.totalFrames).toBe(67);
    expect(DOWN.specialCharge).toEqual({ mode: "store", frames: 80, loopFrame: 19, fromStore: { start: "entry", interruptible: 68 } });
    // The move deals nothing itself: the pumps do it all.
    expect(DOWN.hitboxes).toEqual([]);
  });

  it("pumps seven times, five frames apart, from frame 21, one water each time", () => {
    expect(DOWN.projectiles!.map((p) => p.spawnFrame)).toEqual([21, 26, 31, 36, 41, 46, 51]);
    for (const p of DOWN.projectiles!) expect({ ...p, spawnFrame: 21 }).toEqual(PUMP);
  });

  it("pumps a 0% windbox: angle 55, set knockback 70, growth 100, radius 4 × 0.8, past every clank", () => {
    expect(PUMP.hitbox).toEqual({
      id: 0,
      startFrame: 0,
      endFrame: 11,
      x: 0,
      y: 0,
      radius: fx(3.2),
      damage: 0,
      angle: fx(55),
      baseKnockback: 0,
      knockbackGrowth: fx(100),
      fixedKnockback: fx(70),
      transcendent: true,
      windbox: true,
    });
    // Full charge: base knockback up to 55, size × 1.2.
    expect(PUMP.charged!.hitbox).toEqual({ baseKnockback: fx(55), radius: fx(4.8) });
    expect(PUMP.reflectable).toBe(true);
    expect(PUMP.lifetime).toBe(12);
    // UNVERIFIED (ruling (b), fix round 1): the nozzle's mouth beside his head.
    expect([PUMP.offsetX, PUMP.offsetY]).toEqual([fx(6.5), fx(9.7)]);
    expect(PUMP.gravity).toBe(fx(0.17));
  });

  it("flies at 4.3 along 12°, and at 8.6 at full charge", () => {
    const along = (vx: number, vy: number) => ({ speed: Math.hypot(toFloat(vx), toFloat(vy)), angle: (Math.atan2(toFloat(vy), toFloat(vx)) * 180) / Math.PI });
    const tapped = along(PUMP.vx, PUMP.vy);
    const full = along(PUMP.charged!.vx, PUMP.charged!.vy!);
    expect(tapped.speed).toBeCloseTo(4.3, 2);
    expect(tapped.angle).toBeCloseTo(12, 2);
    expect(full.speed).toBeCloseTo(8.6, 2);
    expect(full.angle).toBeCloseTo(12, 2);
  });
});

describe("F.L.U.D.D.", () => {
  it("charges once pressed and stores a full charge itself", () => {
    const states = run(duel(60), frames(120, (i) => (i === 0 ? DOWN_B : 0)));
    expect(states[states.length - 1].fighters[0].combat.storedCharge).toBe(80);
  });

  it("pushes the opponent without hurting or stunning them", () => {
    const { states, events } = play(duel(24), frames(80, tap));
    const fox = states.map((s) => s.fighters[1]);
    expect(Math.max(...fox.map((f) => f.x))).toBeGreaterThan(fx(12 + 3));
    expect(fox.every((f) => f.damage === 0)).toBe(true);
    expect(fox.some((f) => f.action === "hitstun" || f.action === "tumble" || f.hitlag > 0 || f.hitstun > 0)).toBe(false);
    // Nothing reports a hit (the row's `nogfx=t`), and nobody freezes; each
    // push says who pushed whom, for kill credit.
    expect(events.every((e) => e.hits.length === 0)).toBe(true);
    expect(events.flatMap((e) => e.pushes)).toContainEqual({ attacker: 0, victim: 1 });
    expect(events.flatMap((e) => e.pushes).every((p) => p.attacker === 0 && p.victim === 1)).toBe(true);
    expect(states.every((s) => s.fighters[0].hitlag === 0)).toBe(true);
  });

  it("pushes further from a full charge than from a tap", () => {
    const tapped = run(duel(24), frames(80, tap));
    const full = run(duel(24), frames(170, (i) => (i === 0 || i === 105 ? DOWN_B : 0)));
    const furthest = (states: GameState[]) => Math.max(...states.map((s) => s.fighters[1].x));
    expect(furthest(full)).toBeGreaterThan(furthest(tapped));
  });

  it("is ineffective against a raised shield (SmashWiki \"Windbox\")", () => {
    const { states, events } = play(duel(24), frames(80, tap, () => Btn.Shield));
    const idle = run(duel(24), frames(80, () => 0, () => Btn.Shield));
    // The water reached the shield and was spent there: a pump is gone before its 12 frames.
    const spent = states.some((s, i) => i > 0 && pumps(states[i - 1]).some((p) => p.age < PUMP.lifetime - 1 && !pumps(s).some((q) => q.instanceId === p.instanceId)));
    expect(spent).toBe(true);
    // ...and the shield took nothing from it: no pushback, no wear, no shieldstun.
    states.forEach((s, i) => {
      expect(s.fighters[1].x, `step ${i}`).toBe(idle[i].fighters[1].x);
      expect(s.fighters[1].shieldHealth, `step ${i}`).toBe(idle[i].fighters[1].shieldHealth);
      expect(s.fighters[1].action, `step ${i}`).toBe(idle[i].fighters[1].action);
    });
    expect(events.every((e) => e.shieldHits.length === 0)).toBe(true);
    // Nor does it count as a push for kill credit.
    expect(events.every((e) => e.pushes.length === 0)).toBe(true);
  });
});

describe("F.L.U.D.D.'s timing, through step()", () => {
  /** Mario alone: Fox stands at the far edge, out of the water's ~50-unit reach. */
  const alone = () => duel(150);

  it("fires a bare press's seven pumps on frames 21 to 51, each living 12 frames (21-32 …), and acts again on frame 68", () => {
    const states = run(alone(), frames(80, bare));
    // Step i is frame i + 1, counted from the press.
    const born = states.flatMap((s, i) => pumps(s).filter((p) => p.age === 0).map(() => i + 1));
    expect(born).toEqual([21, 26, 31, 36, 41, 46, 51]);
    for (const id of new Set(states.flatMap((s) => pumps(s).map((p) => p.instanceId)))) {
      const ages = states.flatMap((s) => pumps(s).filter((p) => p.instanceId === id).map((p) => p.age));
      // Ages 0 to 11: "Pumps 21-32, 26-37, …", the spawn frame counted.
      expect(ages, `pump ${id}`).toEqual(Array.from({ length: 12 }, (_, a) => a));
    }
    // No charge at all: the 0% water.
    expect(states[20].projectiles[0].charge).toBe(0);
    expect(states[66].fighters[0].action).toBe("special");
    expect(states[67].fighters[0].action).toBe("stand");
  });

  it("brings a stored full charge back out after its entry: pumps from frame 21, acts on 68 (UltimateFrameData)", () => {
    const s = alone();
    s.fighters[0].combat.storedCharge = 80;
    const states = run(s, frames(80, (i) => (i === 0 ? DOWN_B : 0)));
    expect(states.findIndex((x) => pumps(x).length > 0) + 1).toBe(21);
    const first = pumps(states[20])[0];
    expect(first.charge).toBe(ONE);
    expect(first.vx).toBe(fx(8.412));
    expect(first.vy).toBe(fx(1.788));
    expect(projectileHitbox(first, PUMP)).toMatchObject({ baseKnockback: fx(55), radius: fx(4.8), fixedKnockback: fx(70) });
    expect(states[66].fighters[0].action).toBe("special");
    expect(states[67].fighters[0].action).toBe("stand");
    expect(states[67].fighters[0].combat.storedCharge).toBe(0);
  });

  it("grows the water linearly with the charge: halfway at 40 frames (UNVERIFIED: linear)", () => {
    // The loop opens on step 19; B on step 59 releases 40 charge frames.
    const states = run(alone(), frames(110, (i) => (i === 0 || i === 59 ? DOWN_B : 0)));
    const first = pumps(states.find((x) => pumps(x).length > 0)!)[0];
    expect(first.charge).toBe(ONE / 2);
    expect(first.vx).toBe(fx(4.206) + Math.trunc((fx(8.412) - fx(4.206)) / 2));
    expect(first.vy).toBe(fx(0.894) + Math.trunc((fx(1.788) - fx(0.894)) / 2));
    expect(projectileHitbox(first, PUMP)).toMatchObject({ baseKnockback: Math.trunc(fx(55) / 2), radius: fx(3.2) + Math.trunc((fx(4.8) - fx(3.2)) / 2) });
  });

  it("puts a part charge away on a shield press, and charges on from it next time (SmashWiki \"F.L.U.D.D.\")", () => {
    const states = run(alone(), frames(90, (i) => (i === 0 || i === 70 ? DOWN_B : i === 40 ? Btn.Shield : 0)));
    // Charging steps 19 to 39: 21 frames.
    expect(states[40].fighters[0].combat.storedCharge).toBe(21);
    expect(states[40].fighters[0].action).not.toBe("special");
    expect(states[70].fighters[0]).toMatchObject({ action: "special", move: "downB", charge: 21 });
    expect(states[70].fighters[0].combat.storedCharge).toBe(0);
  });
});

describe("the push (SmashWiki \"Windbox\": knockback without the flinch)", () => {
  it("is the set-knockback launch at 55°, flat along the ground, and a full charge's is base knockback 55 stronger", () => {
    // Set knockback 70 against Fox (weight 77): ((1 + 70/2) × 200/177 × 1.4 + 18) × 1 + 0 = 74.95,
    // and 129.95 with the full charge's 55.
    expect(toFloat(pumpKnockback(0, 77))).toBeCloseTo(74.95, 1);
    expect(toFloat(pumpKnockback(55, 77))).toBeCloseTo(129.95, 1);
    for (const [label, script, bkb] of [
      ["bare", bare, 0],
      ["stored full", (i: number) => (i === 0 ? DOWN_B : 0), 55],
    ] as const) {
      const s = duel(24);
      if (bkb > 0) s.fighters[0].combat.storedCharge = 80;
      const states = run(s, frames(40, script));
      const at = pushedAt(states);
      expect(at, label).toBeGreaterThan(19);
      const f = states[at].fighters[1];
      const speed = mul(pumpKnockback(bkb, 77), LAUNCH_SPEED_RATIO);
      // Away from Mario, the horizontal part only: a windbox "cannot lift opponents off the ground".
      expect(f.kinetic.damageX, label).toBe(mul(speed, cosDeg(fx(55))));
      expect(f.kinetic.damageY, label).toBe(0);
      expect(f.launchSpeed, label).toBe(f.kinetic.damageX);
      expect(f.grounded, label).toBe(true);
      expect(f.action, label).toBe("stand");
    }
  });

  it("decays as a launch does on the ground: 0.051 and the traction a frame", () => {
    const states = run(duel(24), frames(40, bare));
    const at = pushedAt(states);
    const decay = LAUNCH_SPEED_DECAY + fighterParams(fox).ground_brake;
    expect(states[at + 1].fighters[1].launchSpeed).toBe(states[at].fighters[1].launchSpeed - decay);
    expect(states[at + 2].fighters[1].launchSpeed).toBe(states[at].fighters[1].launchSpeed - 2 * decay);
    // ...and moves him by it: the position follows the decayed speed.
    expect(states[at + 1].fighters[1].x - states[at].fighters[1].x).toBe(states[at + 1].fighters[1].vx);
  });

  it("stacks with running: the run keeps its own speed and the push rides on it", () => {
    // Fox runs at Mario from step 4; the control run has no water.
    const run1 = (script: (i: number) => InputFrame) => run(duel(60), frames(40, script, (i) => (i >= 4 ? Btn.Left : 0)));
    const pushed = run1(bare);
    const control = run1(() => 0);
    const at = pushedAt(pushed);
    expect(at).toBeGreaterThan(19);
    const f = pushed[at].fighters[1];
    const c = control[at].fighters[1];
    expect(f.action).toBe("run");
    expect(f.kinetic.controlX).toBe(c.kinetic.controlX);
    expect(f.kinetic.controlX).toBeLessThan(0);
    expect(f.kinetic.damageX).toBe(mul(mul(pumpKnockback(0, 77), LAUNCH_SPEED_RATIO), cosDeg(fx(55))));
    expect(f.vx).toBe(c.vx + f.kinetic.damageX);
  });

  it("stacks with the fall in the air: the whole 55° vector, gravity untouched", () => {
    // Fox falls past the ledge into the water: Mario at the edge, Fox off it.
    const scene = (fire: boolean) => {
      const s = duel(24);
      Object.assign(s.fighters[0], { x: fx(70) });
      Object.assign(s.fighters[1], { action: "fall", grounded: false, platform: -1, x: fx(92), y: fx(44) });
      return run(s, frames(40, fire ? bare : () => 0));
    };
    const pushed = scene(true);
    const control = scene(false);
    const at = pushedAt(pushed);
    expect(at).toBeGreaterThan(19);
    const f = pushed[at].fighters[1];
    const v = { speed: mul(pumpKnockback(0, 77), LAUNCH_SPEED_RATIO) };
    expect(f.grounded).toBe(false);
    expect(f.kinetic.damageX).toBe(mul(v.speed, cosDeg(fx(55))));
    expect(f.kinetic.damageY).toBe(mul(v.speed, sinDeg(fx(55))));
    expect(f.launchSpeed).toBe(v.speed);
    expect(f.kinetic.gravityY).toBe(control[at].fighters[1].kinetic.gravityY);
    expect(f.kinetic.controlX).toBe(control[at].fighters[1].kinetic.controlX);
    expect(f.action).toBe("fall");
  });

  it("leaves the fighter free to act: Fox jabs out of the push", () => {
    const at = pushedAt(run(duel(24), frames(40, bare)));
    const states = run(duel(24), frames(40, bare, (i) => (i === at + 1 ? Btn.Attack : 0)));
    expect(states[at + 1].fighters[1].action).toBe("attack");
  });

  it("pushes a helpless fighter away without giving the recovery back (SmashWiki \"F.L.U.D.D.\")", () => {
    const scene = (fire: boolean) => {
      const s = duel(24);
      Object.assign(s.fighters[0], { x: fx(70) });
      Object.assign(s.fighters[1], { action: "specialFall", grounded: false, platform: -1, x: fx(92), y: fx(44), jumpsUsed: 2, airDodged: true });
      s.fighters[1].combat.helplessMove = "upB";
      s.fighters[1].combat.specialStall = true;
      return run(s, frames(40, fire ? bare : () => 0));
    };
    const pushed = scene(true);
    const control = scene(false);
    const at = pushedAt(pushed);
    expect(at).toBeGreaterThan(19);
    for (const s of pushed.slice(at, at + 10)) {
      const f: FighterState = s.fighters[1];
      expect(f.action).toBe("specialFall");
      expect(f.combat.helplessMove).toBe("upB");
      expect(f.airDodged).toBe(true);
      expect(f.combat.specialStall).toBe(true);
      expect(f.jumpsUsed).toBe(2);
    }
    // Pushed out, well past what the helpless drift alone does.
    expect(pushed[at + 10].fighters[1].x - control[at + 10].fighters[1].x).toBeGreaterThan(fx(5));
  });

  /**
   * Fox on Final Destination's right ledge, past the grab's intangibility (so
   * only the windbox rule can keep the water off), and Mario off the stage to
   * the right, facing the ledge and falling as he charges: his first pump's path
   * runs through Fox's body (x 80, y 0 to 11).
   */
  function atTheLedge(): GameState {
    const s = duel(24);
    Object.assign(s.fighters[1], { action: "fall", grounded: false, platform: -1, x: fx(81.5), y: fx(-1), vy: -fx(0.5), facing: -1 });
    Object.assign(s.fighters[0], { x: fx(-60) });
    const hung = run(s, frames(3, () => 0))[2];
    expect(hung.fighters[1].action).toBe("ledgeHang");
    hung.fighters[1].intangible = 0;
    Object.assign(hung.fighters[0], { action: "fall", grounded: false, platform: -1, x: fx(104), y: fx(13), facing: -1 });
    return hung;
  }

  /** The first pump's whole life in `states`, and that it ran through Fox at the ledge. */
  function firstPumpPath(states: GameState[]): ProjectileState[] {
    const first = states.findIndex((x) => pumps(x).length > 0);
    const id = pumps(states[first])[0].instanceId;
    const path = states.flatMap((x) => pumps(x).filter((p) => p.instanceId === id));
    expect(path.some((p) => Math.abs(toFloat(p.x) - 80) < 2 && toFloat(p.y) > 2 && toFloat(p.y) < 9)).toBe(true);
    return path;
  }

  it("leaves a fighter hanging from the ledge alone, and flies on past (SmashWiki \"Windbox\")", () => {
    const hung = atTheLedge();
    const states = run(hung, frames(40, bare));
    const path = firstPumpPath(states);
    // On to the end of its life, never spent on him.
    expect(path.map((p) => p.age)).toEqual(Array.from({ length: 12 }, (_, a) => a));
    expect(path.every((p) => p.hitPorts.length === 0)).toBe(true);
    for (const x of states) expect(x.fighters[1]).toMatchObject({ action: "ledgeHang", x: hung.fighters[1].x, y: hung.fighters[1].y });
  });

  it("leaves a fighter climbing up from the ledge alone too (UNVERIFIED: the getup holds the ledge as the hang does)", () => {
    // He starts to climb as the first pump leaves; the climb lasts 26 frames.
    const before = run(atTheLedge(), frames(20, bare));
    const climbing = cloneState(before[19]);
    Object.assign(climbing.fighters[1], { action: "ledgeGetUp", actionFrame: 0 });
    const after = run(climbing, frames(20, (i) => bare(i + 20)));
    expect(after.slice(0, 10).every((x) => x.fighters[1].action === "ledgeGetUp" && x.fighters[1].intangible === 0)).toBe(true);
    const path = firstPumpPath([...before, ...after]);
    expect(path.every((p) => p.hitPorts.length === 0)).toBe(true);
    expect(path.map((p) => p.age)).toEqual(Array.from({ length: 12 }, (_, a) => a));
  });

  it("does nothing to an invincible fighter, and is spent on them", () => {
    const s = duel(24);
    s.fighters[1].invincible = 120;
    const { states, events } = play(s, frames(40, bare));
    expect(states.every((x) => x.fighters[1].x === fx(12) && x.fighters[1].kinetic.damageX === 0)).toBe(true);
    expect(events.every((e) => e.hits.length === 0 && e.pushes.length === 0)).toBe(true);
    // Spent: the first pump is gone before its 12 frames.
    const first = pumps(states[20])[0];
    const life = states.filter((x) => pumps(x).some((p) => p.instanceId === first.instanceId)).length;
    expect(life).toBeLessThan(PUMP.lifetime);
  });

  it("is spent on an invincible fighter (UNVERIFIED): a pump that outlives its hits does not push him once he is hittable", () => {
    // Fox is invincible through the first pump's first contact (step 24) and
    // hittable on its next (25), with the same pump still on him.
    const s = duel(24, "fox", "marioHose");
    s.fighters[1].invincible = 26;
    const states = run(s, frames(32, bare));
    expect(states[24].fighters[1].invincible).toBeGreaterThan(0);
    expect(states[25].fighters[1].invincible).toBe(0);
    const first = pumps(states[25])[0];
    expect(first.age).toBe(5);
    expect(first.hitPorts).toEqual([1]);
    // Nothing moves him until the second pump comes (step 29).
    expect(states.slice(0, 29).every((x) => x.fighters[1].kinetic.damageX === 0)).toBe(true);
    // The control: hittable all along, the same pump pushes him on its first contact.
    expect(pushedAt(run(duel(24, "fox", "marioHose"), frames(32, bare)))).toBe(24);
  });
});

describe("the push and what the fighter is doing (Plan 5, Task 6 fix round 1)", () => {
  /** The bare-press duel one step before the first pump reaches Fox (step 24), for `edit` to stage him. */
  function beforeContact(edit: (fox: FighterState) => void, withPump = true): GameState {
    const s = cloneState(run(duel(24), frames(24, bare))[23]);
    edit(s.fighters[1]);
    if (!withPump) s.projectiles = [];
    return s;
  }
  const next = (s: GameState, n = 1) => run(s, frames(n, (i) => bare(i + 24)));

  it("passes through an intangible fighter, unspent", () => {
    const states = run(
      (() => {
        const s = duel(24);
        s.fighters[1].intangible = 60;
        return s;
      })(),
      frames(40, bare),
    );
    expect(states.every((x) => x.fighters[1].kinetic.damageX === 0)).toBe(true);
    const id = pumps(states[20])[0].instanceId;
    const path = states.flatMap((x) => pumps(x).filter((p) => p.instanceId === id));
    expect(path.map((p) => p.age)).toEqual(Array.from({ length: 12 }, (_, a) => a));
    expect(path.every((p) => p.hitPorts.length === 0)).toBe(true);
  });

  it("leaves an invincible fighter's own movement alone, a push he already had included", () => {
    const stage = (withPump: boolean) =>
      beforeContact((f) => {
        f.invincible = 30;
        f.kinetic = { ...f.kinetic, damageX: -fx(1), damageY: 0 };
        f.launchSpeed = fx(1);
        f.vx = -fx(1);
      }, withPump);
    const pushed = next(stage(true))[0].fighters[1];
    const control = next(stage(false))[0].fighters[1];
    expect(control.kinetic.damageX).toBeLessThan(0);
    expect(pushed.kinetic).toEqual(control.kinetic);
    expect(pushed.launchSpeed).toBe(control.launchSpeed);
  });

  it("pushes a frozen fighter that has no launch waiting, who slides once the freeze ends", () => {
    const states = next(beforeContact((f) => Object.assign(f, { hitlag: 6 })), 12);
    const f = states[0].fighters[1];
    expect(f.hitlag).toBeGreaterThan(0);
    expect(f.pendingFacing).toBe(0);
    expect(f.kinetic.damageX).toBe(mul(mul(pumpKnockback(0, 77), LAUNCH_SPEED_RATIO), cosDeg(fx(55))));
    const thawed = states.findIndex((x) => x.fighters[1].hitlag === 0);
    expect(thawed).toBeGreaterThan(0);
    expect(states[thawed - 1].fighters[1].x).toBe(states[0].fighters[1].x);
    expect(states[thawed + 1].fighters[1].x).toBeGreaterThan(states[0].fighters[1].x);
  });

  it("moves a fighter in super armour (SmashWiki \"Armor\"): Donkey Kong's stored full Giant Punch", () => {
    // DK's armour runs frames 9-20 of a stored full punch from the press
    // (`donkeyKong.ts`); pressed on step 12, it covers the water's arrival.
    const s = duel(24, "donkeyKong");
    s.fighters[1].combat.storedCharge = 110;
    const states = run(s, frames(40, bare, (i) => (i === 12 ? Btn.Special : 0)));
    const at = pushedAt(states);
    expect(at).toBeGreaterThan(19);
    const dk = states[at].fighters[1];
    expect(dk.move).toBe("neutralB");
    expect(hasSuperArmour(dk, donkeyKong)).toBe(true);
    expect(dk.kinetic.damageX).toBe(mul(mul(pumpKnockback(0, donkeyKong.attributes.weight), LAUNCH_SPEED_RATIO), cosDeg(fx(55))));
  });
});

describe("the push and a grab (UNVERIFIED: no source covers either; Plan 5, Task 6 fix round 1)", () => {
  const RULES3: MatchRules = { ...RULES, oneOnOne: false };
  /** Mario at −12 facing right; `holder` holding `held` to the right of him. */
  function hold(holder: 1 | 2, held: 1 | 2, holderX: number, facing: 1 | -1): GameState {
    const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }, { defId: "marth" }], RULES3, 5);
    Object.assign(s.fighters[0], { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(-12), y: 0, facing: 1, intangible: 0 });
    Object.assign(s.fighters[holder], { action: "grabHold", actionFrame: 0, grounded: true, platform: 0, x: fx(holderX), y: 0, facing, intangible: 0, grabbing: held });
    Object.assign(s.fighters[held], { action: "grabbed", actionFrame: 0, grounded: true, platform: 0, x: fx(holderX + 6 * facing), y: 0, facing: -facing, intangible: 0, grabbedBy: holder, grabTimer: 500 });
    return s;
  }
  const play3 = (s: GameState, n: number) => {
    let st = s;
    let prev: InputFrame[] = [0, 0, 0];
    const out: { state: GameState; events: StepEvents }[] = [];
    for (let i = 0; i < n; i++) {
      const now = [bare(i), 0, 0];
      const r = step(st, now, { prevInputs: prev });
      st = r.state;
      prev = now;
      out.push(r);
    }
    return out;
  };

  it("gives a held fighter a one-frame push that the hold wipes, and he stays held", () => {
    // Marth (port 2) at x 20 facing left holds Fox in front of him, in the water's path.
    const steps = play3(hold(2, 1, 20, -1), 40);
    const at = steps.findIndex((r) => r.events.pushes.some((p) => p.victim === 1));
    expect(at).toBeGreaterThan(19);
    expect(steps[at].state.fighters[1].kinetic.damageX).toBeGreaterThan(0);
    expect(steps[at + 1].state.fighters[1].kinetic.damageX).toBe(0);
    for (const r of steps) {
      expect(r.state.fighters[1]).toMatchObject({ action: "grabbed", grabbedBy: 2 });
      expect(r.state.fighters[1].x - r.state.fighters[2].x).toBe(steps[0].state.fighters[1].x - steps[0].state.fighters[2].x);
    }
    expect(steps.at(-1)!.state.fighters[2].x).toBe(steps[0].state.fighters[2].x);
  });

  it("slides a captor, who keeps the hold and brings the held fighter along", () => {
    // Fox (port 1) at x 12 facing away from Mario holds Marth; the water comes from behind.
    const steps = play3(hold(1, 2, 12, 1), 40);
    const at = steps.findIndex((r) => r.events.pushes.some((p) => p.victim === 1));
    expect(at).toBeGreaterThan(19);
    expect(steps.at(-1)!.state.fighters[1].x).toBeGreaterThan(steps[at].state.fighters[1].x + fx(3));
    for (const r of steps) {
      expect(r.state.fighters[1]).toMatchObject({ action: "grabHold", grabbing: 2 });
      expect(r.state.fighters[2]).toMatchObject({ action: "grabbed", grabbedBy: 1 });
      expect(r.state.fighters[2].x - r.state.fighters[1].x).toBe(steps[0].state.fighters[2].x - steps[0].state.fighters[1].x);
    }
  });
});

// SmashWiki "Throw" (https://www.ssbwiki.com/Throw): in Ultimate "the thrower is now
// invincible until the opponent has been thrown", "from frame 1 all the way until the
// frame the opponent is thrown", and a push on an invincible fighter does nothing
// (`applyWindbox`). Read off the throw's script (`isInvincible`), not the fighter's
// `invincible` counter, which stays 0 (Task 7 re-review's Minor; Plan 5, Task 7b).
describe("the push and a throw (SmashWiki \"Throw\": the thrower is invincible until the release)", () => {
  const RULES3: MatchRules = { ...RULES, oneOnOne: false };
  /** Mario at −12 facing right; Marth (port 2) at 12, his back to Mario, holding Fox at 18. */
  function marthHolding(): GameState {
    const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }, { defId: "marth" }], RULES3, 5);
    const at = { actionFrame: 0, grounded: true, platform: 0, y: 0, intangible: 0, invincible: 0 };
    Object.assign(s.fighters[0], at, { action: "stand", x: fx(-12), facing: 1 });
    Object.assign(s.fighters[2], at, { action: "grabHold", x: fx(12), facing: 1, grabbing: 1 });
    Object.assign(s.fighters[1], at, { action: "grabbed", x: fx(18), facing: -1, grabbedBy: 2, grabTimer: 500 });
    return s;
  }
  /** Mario's bare F.L.U.D.D., and Marth's inputs from `marth`. */
  const play3 = (s: GameState, n: number, marth: (i: number) => InputFrame) => {
    let st = s;
    let prev: InputFrame[] = [0, 0, 0];
    const out: { state: GameState; events: StepEvents }[] = [];
    for (let i = 0; i < n; i++) {
      const now = [bare(i), 0, marth(i)];
      const r = step(st, now, { prevInputs: prev });
      st = r.state;
      prev = now;
      out.push(r);
    }
    return out;
  };
  const pushedOn = (steps: readonly { events: StepEvents }[]): number[] =>
    steps.flatMap((r, i) => (r.events.pushes.some((p) => p.victim === 2) ? [i] : []));

  it("leaves Marth alone through his forward throw up to its release, and pushes him after it", () => {
    // Holding, the first pump to reach him pushes him (the control).
    const held = pushedOn(play3(marthHolding(), 50, () => 0));
    expect(held.length).toBeGreaterThan(0);
    // Thrown on step 14: the release is UFD's frame 18 (https://ultimateframedata.com/marth), after that first pump.
    const steps = play3(marthHolding(), 50, (i) => (i === 14 ? Btn.Right : 0));
    const release = steps.findIndex((r) => r.events.hits.some((h) => h.attacker === 2 && h.victim === 1));
    expect(release).toBe(14 + 17);
    expect(held[0]).toBeLessThan(release);
    expect(steps.slice(14, release + 1).every((r) => r.state.fighters[2].action === "throw" && r.state.fighters[2].invincible === 0)).toBe(true);
    const pushes = pushedOn(steps);
    expect(pushes.filter((i) => i <= release)).toEqual([]);
    expect(pushes.length).toBeGreaterThan(0);
  });
});

describe("the push against a launch still live (UNVERIFIED: SmashWiki \"Knockback\"'s stacking, read for a push)", () => {
  /**
   * The bare-press run one step before the first pump reaches Fox, with Fox
   * thrown into the air above the pump's path in a tumble flying straight up at
   * `speed`. The control has no pump.
   */
  function launched(speed: number, withPump: boolean): GameState {
    const states = run(duel(24), frames(24, bare));
    const s = cloneState(states[23]);
    const f = s.fighters[1];
    Object.assign(f, { action: "tumble", actionFrame: 0, grounded: false, platform: -1, y: fx(1), hitstun: 30, launchSpeed: speed, vx: 0, vy: speed });
    f.kinetic = { ...f.kinetic, controlX: 0, stopX: 0, motionX: 0, motionY: 0, gravityY: 0, damageX: 0, damageY: speed };
    if (!withPump) s.projectiles = [];
    return s;
  }
  const after = (speed: number, withPump: boolean): FighterState => step(launched(speed, withPump), [0, 0], { prevInputs: [0, 0] }).state.fighters[1];
  // The push at 0 charge on Fox, as it is in the air.
  const push = mul(pumpKnockback(0, 77), LAUNCH_SPEED_RATIO);

  it("does nothing against a launch over twice its speed", () => {
    const fast = fx(5);
    expect(push * 2).toBeLessThan(fast);
    const f = after(fast, true);
    const c = after(fast, false);
    expect(c.kinetic.damageY).toBeGreaterThan(0);
    expect(f.kinetic).toEqual(c.kinetic);
    expect(f.launchSpeed).toBe(c.launchSpeed);
    expect(pumps(step(launched(fast, true), [0, 0], { prevInputs: [0, 0] }).state)).toHaveLength(0);
  });

  it("turns one between 1.1 and 2 times its speed toward the sum of the two, keeping the speed", () => {
    const mid = fx(3);
    const f = after(mid, true);
    const c = after(mid, false);
    expect(f.launchSpeed).toBe(c.launchSpeed);
    expect(c.kinetic.damageX).toBe(0);
    // Along the launch plus the whole 55° push, its rise included.
    const sum = { x: mul(push, cosDeg(fx(55))), y: c.kinetic.damageY + mul(push, sinDeg(fx(55))) };
    expect(f.kinetic.damageY / f.kinetic.damageX).toBeCloseTo(sum.y / sum.x, 2);
    expect(f.hitstun).toBe(c.hitstun);
    expect(f.action).toBe("tumble");
  });

  it("takes over a slower one's velocity, and leaves its hitstun running", () => {
    const slow = fx(2.3);
    const f = after(slow, true);
    const c = after(slow, false);
    expect(f.kinetic.damageX).toBe(mul(push, cosDeg(fx(55))));
    expect(f.kinetic.damageY).toBe(mul(push, sinDeg(fx(55))));
    expect(f.launchSpeed).toBe(push);
    expect(f.hitstun).toBe(c.hitstun);
  });
});

describe("F.L.U.D.D. against a reflector (SmashWiki \"Reflection\": reflectable)", () => {
  it("comes back off Fox's Reflector and pushes Mario, and nobody is hurt", () => {
    const reflecting = (i: number): InputFrame => (i >= 14 && i < 60 ? DOWN_B : 0);
    const { states, events } = play(duel(24), frames(70, bare, reflecting));
    const control = run(duel(24), frames(70, () => 0, reflecting));
    const first = events.findIndex((e) => e.reflects.length > 0);
    expect(first).toBeGreaterThan(19);
    expect(events[first].reflects[0].port).toBe(1);
    const back = pumps(states[first]).find((p) => p.owner === 1)!;
    expect(back.vx).toBeLessThan(0);
    // Fox stays where his own Reflector leaves him; Mario is pushed back by his own water.
    states.forEach((s, i) => expect(s.fighters[1].x, `step ${i}`).toBe(control[i].fighters[1].x));
    expect(Math.min(...states.map((s) => s.fighters[0].x))).toBeLessThan(fx(-12 - 10));
    expect(states.every((s) => s.fighters[0].damage === 0 && s.fighters[1].damage === 0)).toBe(true);
    expect(events.every((e) => e.hits.length === 0)).toBe(true);
  });

  it("pushes the way the water flies, not the way its new owner faces: Fox reflects with his back to Mario", () => {
    const s = duel(24);
    s.fighters[1].facing = 1;
    const { states, events } = play(s, frames(70, bare, (i) => (i >= 14 && i < 60 ? DOWN_B : 0)));
    const first = events.findIndex((e) => e.reflects.length > 0);
    expect(first).toBeGreaterThan(19);
    expect(states[first].fighters[1].facing).toBe(1);
    expect(pumps(states[first]).find((p) => p.owner === 1)!.facing).toBe(-1);
    // Mario goes back, away from Fox, as the water does.
    const mario = pushedAt(states, 0);
    expect(mario).toBeGreaterThan(first);
    expect(states[mario].fighters[0].kinetic.damageX).toBeLessThan(0);
    expect(Math.min(...states.map((x) => x.fighters[0].x))).toBeLessThan(fx(-12 - 10));
  });
});

describe("F.L.U.D.D. against Marth's Counter (UNVERIFIED: a windbox is not countered)", () => {
  it("pushes a countering Marth instead of setting the counter off", () => {
    // When does the water first reach him, standing still?
    const still = run(duel(24, "marth"), frames(80, tap));
    const reached = still.findIndex((s) => s.fighters[1].x > fx(12));
    expect(reached).toBeGreaterThan(10);
    // Counter so its window (frames 6-27) is open as the water arrives.
    const { states, events } = play(duel(24, "marth"), frames(80, tap, (i) => (i === reached - 10 ? DOWN_B : 0)));
    const marth = states.map((s) => s.fighters[1]);
    expect(marth[reached].move).toBe("downB");
    expect(marth.some((f) => f.move === "counterAttack")).toBe(false);
    expect(events.every((e) => e.counters.length === 0)).toBe(true);
    expect(marth.every((f) => f.combat.counterDamage === 0)).toBe(true);
    expect(Math.max(...marth.map((f) => f.x))).toBeGreaterThan(fx(12 + 3));
    expect(marth.every((f) => f.damage === 0)).toBe(true);
  });
});

describe("rollback", () => {
  it("re-simulates identically from mid-charge, mid-pump and mid-push", () => {
    const script = frames(90, (i) => (i === 0 || i === 40 ? DOWN_B : 0), (i) => (i >= 50 && i < 54 ? Btn.Left : 0));
    const live = run(duel(24), script);
    const at = pushedAt(live);
    for (const from of [10, 30, 42, at, at + 3]) {
      let s = cloneState(live[from]);
      for (let i = from + 1; i < live.length; i++) {
        s = step(s, script[i], { prevInputs: script[i - 1] }).state;
        expect(hashState(s), `from step ${from}, step ${i}`).toBe(hashState(live[i]));
      }
    }
    // The snapshots are where they claim to be.
    expect(live[30].fighters[0]).toMatchObject({ action: "special", move: "downB", actionFrame: 18 });
    expect(live[30].fighters[0].charge).toBeGreaterThan(0);
    expect(pumps(live[at]).length + pumps(live[at + 3]).length).toBeGreaterThan(0);
    expect(live[at + 3].fighters[1].launchSpeed).toBeGreaterThan(0);
  });

  it("hashes a push, so a rollback that lost it would be seen", () => {
    const s = duel(24);
    const before = hashState(s);
    s.fighters[1].kinetic.damageX = fx(1);
    expect(hashState(s)).not.toBe(before);
  });
});
