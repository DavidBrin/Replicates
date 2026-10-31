/**
 * Smash-input specials (Plan 5, Task 13d, ruling P5-R29): a side special pressed
 * within its move's window of a smash flick is its smash version, a move of its own
 * (`MoveDef.smashInput`). In this roster, Samus's Missile becomes her Super Missile
 * and Link's Boomerang its smash throw.
 *
 * Sources (published only):
 * - SmashWiki "Samus (SSBU)/Side special" (https://www.ssbwiki.com/Samus_(SSBU)/Side_special,
 *   revision 1708939): "Smash input window 5 frames"; "Super Missile 21-96",
 *   "Interruptible (grounded) 58", "Interruptible (aerial) 62"; the Super Missile's
 *   "Initial speed 0.18", "Period before accelerating 26 frames", "Lifetime upon
 *   accelerating 50 frames", "Acceleration 0.16", "Maximum speed 4.2"; its row 12.0%,
 *   65°, BK 50, KS 65, radius 2.5; "Maximum Homing Missiles at a time 2", "Maximum
 *   Super Missiles at a time 1".
 * - UltimateFrameData (https://ultimateframedata.com/samus): "Side B (Super Missle)",
 *   landing lag 30.
 * - SmashWiki "Control stick" (https://www.ssbwiki.com/Control_stick, revision 2062569),
 *   "Stick sensitivity": "'Smashed' side special moves - 7/8/9 frames" (low, normal,
 *   high), which "applies to ... only the following side special moves: Link ... -
 *   Boomerang": 8 at the default setting.
 * - SmashWiki "Link (SSBU)/Side special" (https://www.ssbwiki.com/Link_(SSBU)/Side_special,
 *   revision 1840696): "Smash input hitboxes (clean, late, returning) 27-36, 37-86,
 *   87-192"; "Lifetime ... 167 frames (smash)"; "Initial speed ... 3.1 (smash)";
 *   "Smash input damage multiplier 1.2"; "Deceleration 0.047", "Minimum speed 0.3".
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx, toFloat } from "@/engine/fixed";
import { hashState } from "@/engine/hash";
import { findProjectileDef, projectileHitbox, spawnProjectile } from "@/engine/projectile";
import { cloneState, createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { beginSpecial, onLanded } from "@/engine/states";
import { Btn } from "@/engine/types";
import type { FighterState, GameState, InputFrame, MatchRules, MoveSlot, ProjectileDef, ProjectileState } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS, link, samus } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

const projectileDef = (fighter: string, id: string): ProjectileDef => findProjectileDef(FIGHTERS.find((f) => f.id === fighter)!, id)!;

/** `a` at `x0` facing right and `b` at `x1`, standing on Final Destination's floor (or `a` in the air at `airY`). */
function duel(a: string, b: string, x0: number, x1: number, airY?: number): GameState {
  const s = createInitialState("finalDestination", [{ defId: a }, { defId: b }], RULES, 0x13d);
  const place = (f: FighterState, x: number, facing: number) =>
    Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(x), y: 0, vx: 0, vy: 0, facing, intangible: 0, invincible: 0 });
  place(s.fighters[0], x0, 1);
  place(s.fighters[1], x1, x1 >= x0 ? -1 : 1);
  if (airY !== undefined) Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, y: fx(airY) });
  return s;
}

/** `frames` steps of `script`: every state. */
function run(s0: GameState, frames: number, script: (i: number) => InputFrame[]): GameState[] {
  const states: GameState[] = [];
  let s = s0;
  let prev = script(0).map(() => 0);
  for (let i = 0; i < frames; i++) {
    const now = script(i);
    s = step(s, now, { prevInputs: prev }).state;
    prev = now;
    states.push(s);
  }
  return states;
}

/** From every snapshot in `at` (−1 is the start), the same inputs give the same states, hash for hash. */
function expectRollbackSafe(s0: GameState, frames: number, script: (i: number) => InputFrame[], at: readonly number[]): void {
  const states = run(s0, frames, script);
  for (const k of at) {
    let s = cloneState(k < 0 ? s0 : states[k]);
    let prev = k < 0 ? script(0).map(() => 0) : script(k);
    for (let i = k + 1; i < frames; i++) {
      const now = script(i);
      s = step(s, now, { prevInputs: prev }).state;
      prev = now;
      expect(hashState(s), `snapshot ${k}, step ${i}`).toBe(hashState(states[i]));
    }
  }
}

const ofId = (s: GameState, id: string): ProjectileState[] => s.projectiles.filter((p) => p.defId === id);

describe("a side special's smash input: the smash attacks' flick, at its own move's window", () => {
  it("is one field on the move: the published window and the smash version's slot, on Samus's and Link's side specials only", () => {
    expect(samus.moves.sideB!.smashInput).toEqual({ within: 5, slot: "sideBSmash" });
    expect(link.moves.sideB!.smashInput).toEqual({ within: 8, slot: "sideBSmash" });
    const others = FIGHTERS.filter((f) => f.id !== "samus" && f.id !== "link");
    for (const f of others) for (const m of Object.values(f.moves)) expect(m?.smashInput, `${f.id} ${m?.slot}`).toBeUndefined();
  });

  /** `id` in the air facing right: Right pressed on step 0 and held, B pressed on step `k` (with `extra` held). The move B starts. */
  function sideBAfter(id: string, k: number, extra: InputFrame = 0): MoveSlot | null {
    const states = run(duel(id, "mario", -30, 60, 60), k + 1, (i) => [Btn.Right | extra | (i === k ? Btn.Special : 0), 0]);
    const f = states[k].fighters[0];
    expect(f.action, `${id}: B on step ${k}`).toBe("special");
    return f.move;
  }

  it.each([
    ["samus", 5],
    ["link", 8],
  ] as const)("%s: B within %i frames of a fresh Right press is the smash version, a frame later the tilt one", (id, within) => {
    expect(sideBAfter(id, 0)).toBe("sideBSmash");
    expect(sideBAfter(id, within)).toBe("sideBSmash");
    expect(sideBAfter(id, within + 1)).toBe("sideB");
  });

  it("is never a soft tilt's (Btn.Soft: no smash), as a smash attack is not", () => {
    expect(sideBAfter("samus", 0, Btn.Soft)).toBe("sideB");
    expect(sideBAfter("link", 0, Btn.Soft)).toBe("sideB");
  });

  it("needs the flick still held: a fresh press let go is no flick, as for a smash attack", () => {
    // Left held from step 0; Down tapped on 10 and let go on 11 (a fresh press, two
    // frames old on 12); B on 12 with Left still held is the side special, a tilt.
    const states = run(duel("samus", "mario", -30, 60, 60), 13, (i) => [Btn.Left | (i === 10 ? Btn.Down : 0) | (i === 12 ? Btn.Special : 0), 0]);
    expect(states[12].fighters[0]).toMatchObject({ action: "special", move: "sideB" });
  });

  it("falls back to the tilt version where the smash version's move is missing: a half-finished fighter stays playable", () => {
    const s = duel("samus", "mario", -30, 60);
    const stage = STAGES.find((st) => st.id === "finalDestination")!;
    const missing = { ...samus, moves: { ...samus.moves, sideBSmash: undefined } };
    const begin = (def: typeof samus) => {
      const f = structuredClone(s.fighters[0]);
      expect(beginSpecial(f, { def, stage, frame: 0, fighters: s.fighters }, "sideB", 1, { x: 1, y: 0, soft: false }, 0)).toBe(true);
      return f.move;
    };
    expect(begin(samus)).toBe("sideBSmash");
    expect(begin(missing)).toBe("sideB");
  });

  it("on the ground too: Right and B pressed together", () => {
    for (const id of ["samus", "link"]) {
      const f = run(duel(id, "mario", -30, 60), 1, () => [Btn.Right | Btn.Special, 0])[0].fighters[0];
      expect([f.action, f.move], id).toEqual(["special", "sideBSmash"]);
    }
  });

  it("needs a fresh B press: a B buffered through a landing lag comes out as the tilt version, held or not, as a buffered attack is never a smash", () => {
    const s = duel("samus", "mario", -30, 60);
    Object.assign(s.fighters[0], { action: "landingLag", actionFrame: 0, charge: 5 });
    // Right and B pressed together on step 2, in the lag, and both held after: B is
    // held, not pressed, on the frame the buffered special comes out (fix round 1).
    const states = run(s, 8, (i) => [i >= 2 ? Btn.Right | Btn.Special : 0, 0]);
    const start = states.findIndex((st) => st.fighters[0].action === "special");
    expect(start).toBeGreaterThan(2);
    // The flick is 3 frames old, inside the 5: only the B press is not fresh.
    expect(start - 2).toBeLessThanOrEqual(5);
    expect(states[start].fighters[0].move).toBe("sideB");
  });

  it("turns the fighter round first when pressed backward, as the tilt version does", () => {
    for (const id of ["samus", "link"]) {
      const f = run(duel(id, "mario", -30, 60), 1, () => [Btn.Left | Btn.Special, 0])[0].fighters[0];
      expect([f.action, f.move, f.facing], id).toEqual(["special", "sideBSmash", -1]);
    }
  });
});

describe("Samus's Super Missile (SmashWiki \"Samus (SSBU)/Side special\")", () => {
  const SUPER = () => projectileDef("samus", "superMissile");
  const SMASH = Btn.Right | Btn.Special;
  const TILT = Btn.Soft | Btn.Right | Btn.Special;

  it("carries the page's numbers: its move, its missile and the missile's row", () => {
    const move = samus.moves.sideBSmash!;
    expect(move).toMatchObject({ slot: "sideBSmash", name: "Super Missile", totalFrames: 57, aerialTotalFrames: 61, aerialLandingLag: 30 });
    expect(move.projectiles!.map((p) => p.id)).toEqual(["superMissile"]);
    expect(SUPER()).toMatchObject({ spawnFrame: 21, vx: fx(0.18), vy: 0, gravity: 0, lifetime: 76, destroyOnHit: true, reflectable: true, maxOut: 1 });
    expect(SUPER().accelerate).toEqual({ after: 26, perFrame: fx(0.16), maxSpeed: fx(4.2) });
    expect(SUPER().hitbox).toMatchObject({ startFrame: 0, endFrame: 75, radius: fx(2.5), damage: fx(12), angle: fx(65), baseKnockback: fx(50), knockbackGrowth: fx(65), effect: "fire" });
    // samus_supermissile `Ready` and `Straight`: Clang_Rebound=ATTACK_SETOFF_KIND_ON.
    expect([SUPER().hitbox.transcendent, SUPER().hitbox.noRebound]).toEqual([undefined, undefined]);
    expect(projectileDef("samus", "missile").maxOut).toBe(2);
  });

  it("launches on frame 21 and is actionable on 58 on the ground", () => {
    const states = run(duel("samus", "mario", -60, -80), 60, (i) => [i === 0 ? SMASH : 0, 0]);
    expect(states.findIndex((st) => ofId(st, "superMissile").length > 0)).toBe(20);
    expect(states[56].fighters[0]).toMatchObject({ action: "special", move: "sideBSmash" });
    expect(states[57].fighters[0].action).toBe("stand");
    // The Homing Missile keeps its own: out on 18, actionable on 55.
    const tilt = run(duel("samus", "mario", -60, -80), 56, (i) => [i === 0 ? TILT : 0, 0]);
    expect(tilt.findIndex((st) => ofId(st, "missile").length > 0)).toBe(17);
    expect([tilt[53].fighters[0].action, tilt[54].fighters[0].action]).toEqual(["special", "stand"]);
  });

  it("is actionable on 62 in the air (\"Interruptible (aerial) 62\")", () => {
    const states = run(duel("samus", "mario", -60, -80, 120), 64, (i) => [i === 0 ? SMASH : 0, 0]);
    expect(states[60].fighters[0]).toMatchObject({ action: "special", move: "sideBSmash", grounded: false });
    expect(states[61].fighters[0].action).toBe("fall");
  });

  it("waits 26 frames at 0.18, then gains 0.16 a frame up to 4.2, and is gone after its 76", () => {
    const states = run(duel("samus", "mario", -60, -80), 100, (i) => [i === 0 ? SMASH : 0, 0]);
    const life = states.slice(20).map((st) => ofId(st, "superMissile")[0]);
    expect(life[0]!.x).toBe(states[20].fighters[0].x + fx(8));
    let v = fx(0.18);
    for (let age = 1; age < 76; age++) {
      if (age >= 26) v = Math.min(v + fx(0.16), fx(4.2));
      expect([life[age]!.vx, life[age]!.x - life[age - 1]!.x], `age ${age}`).toEqual([v, v]);
    }
    expect(life[75]!.vx).toBe(fx(4.2));
    expect(life[76]).toBeUndefined();
  });

  it("hits for 12% at 65°, and is gone on the hit", () => {
    const states = run(duel("samus", "mario", -60, 20), 90, (i) => [i === 0 ? SMASH : 0, 0]);
    const hit = states.findIndex((st) => st.fighters[1].damage > 0);
    expect(hit).toBeGreaterThan(20);
    // A projectile is exempt from staleness (`swingDamage`): its 12, in a match that is not one-on-one.
    expect(states[hit].fighters[1].damage).toBe(fx(12));
    expect(ofId(states[hit], "superMissile")).toEqual([]);
    expect(states[hit - 1].fighters[1].damage).toBe(0);
  });

  it("lands into its own 30 frames of landing lag in the air (UFD), where the Homing Missile lands plainly", () => {
    const landing = (press: InputFrame) => {
      const states = run(duel("samus", "mario", -60, -80, 3), 60, (i) => [i === 0 ? press : 0, 0]);
      const at = states.findIndex((st) => st.fighters[0].grounded);
      return { at, states };
    };
    const smash = landing(SMASH);
    expect(smash.at).toBeGreaterThan(0);
    expect(smash.states[smash.at].fighters[0]).toMatchObject({ action: "landingLag", charge: 30 });
    expect(smash.states[smash.at + 29].fighters[0].action).toBe("landingLag");
    expect(smash.states[smash.at + 30].fighters[0].action).toBe("stand");
    const tilt = landing(TILT);
    expect(tilt.states[tilt.at].fighters[0].action).toBe("land");
  });

  it("lands plainly when begun on the ground, whatever then took it off (UNVERIFIED: UFD's landing lag is the aerial one's)", () => {
    const s = duel("samus", "mario", -60, -80);
    const stage = STAGES.find((st) => st.id === "finalDestination")!;
    const at = (airTime: number) => {
      const f = structuredClone(s.fighters[0]);
      Object.assign(f, { action: "special", move: "sideBSmash", actionFrame: 30, airTime, grounded: true, platform: 0 });
      onLanded(f, { def: samus, stage, frame: 0, fighters: s.fighters });
      return [f.action, f.charge];
    };
    // Begun on the ground, then airborne for 10 of its 30 frames: a plain landing.
    expect(at(10)[0]).toBe("land");
    // Begun in the air (airborne on more frames than the move has run): its own 30.
    expect(at(31)).toEqual(["landingLag", 30]);
  });

  /**
   * A Super Missile of Samus's (port 0, at x 70, out of the way) put at `x`, flying
   * `vx` along the floor, at `age`, `reflected` times sent back already.
   */
  function missileAt(s: GameState, x: number, vx: number, age: number, reflected = 0): ProjectileState {
    const p = spawnProjectile(SUPER(), s.fighters[0], s.nextProjectileId, "samus");
    Object.assign(p, { x: fx(x), y: fx(6.5), vx, vy: 0, facing: vx < 0 ? -1 : 1, age, reflected });
    s.projectiles.push(p);
    s.nextProjectileId += 1;
    return p;
  }

  /** Its speed from the step after the reflection on: [age, |vx|] while it flies. */
  function afterReflection(states: GameState[]): [number, number][] {
    const at = states.findIndex((st) => st.projectiles.some((p) => p.reflected > 0 && p.owner === 1));
    expect(at, "reflected").toBeGreaterThan(0);
    return states.slice(at).flatMap((st) => st.projectiles.filter((p) => p.defId === "superMissile").map((p): [number, number] => [p.age, Math.abs(p.vx)]));
  }

  it("sent back by Fox's Reflector, keeps its ×1.4 through its old wait and past age 26: no second wait, no clamp to 4.2 (R-T13d-e, UNVERIFIED)", () => {
    // Fox at 0 facing left, the Reflector up and held; the missile comes at him at 4.2.
    const s = duel("samus", "fox", 70, 0);
    Object.assign(s.fighters[1], { facing: -1 });
    missileAt(s, -60, fx(4.2), 50);
    const flight = afterReflection(run(s, 60, () => [0, Btn.Down | Btn.Special]));
    const sent = flight[0][1];
    expect(sent).toBeGreaterThan(fx(4.2 * 1.39));
    // Fox's "Lifetime multiplier" ×1 renews its clock to 0: through ages 0 to 25 (its
    // old wait) and on past 26 it flies at the speed it was sent back at.
    expect(flight[0][0]).toBe(0);
    expect(flight.some(([age]) => age > 30)).toBe(true);
    for (const [age, v] of flight) expect(v, `age ${age}`).toBe(sent);
  });

  it("sent back by Mario's Cape, is not clamped back either, and does not wait again (R-T13d-e, UNVERIFIED)", () => {
    // Mario at 0 facing left caping a missile one reflector already sent back at 5.88.
    const fast = duel("samus", "mario", 70, 0);
    Object.assign(fast.fighters[1], { facing: -1 });
    missileAt(fast, -70, Math.trunc((fx(4.2) * fx(1.4)) / 4096), 10, 1);
    const kept = afterReflection(run(fast, 45, (i) => [0, i === 0 ? Btn.Left | Btn.Special : 0]));
    // The Cape's ×0.75 lifetime puts it at age 19: past 26 it still flies at its speed.
    expect(kept[0][0]).toBe(19);
    expect(kept.some(([age]) => age > 30)).toBe(true);
    for (const [age, v] of kept) expect(v, `age ${age}`).toBe(kept[0][1]);
    // One caped in its wait (0.18, age 5) gains from the next frame on, not after a second wait.
    const slow = duel("samus", "mario", 70, 0);
    Object.assign(slow.fighters[1], { facing: -1 });
    missileAt(slow, -8, fx(0.18), 5);
    const gained = afterReflection(run(slow, 20, (i) => [0, i === 0 ? Btn.Left | Btn.Special : 0]));
    expect(gained.slice(0, 4).map(([, v]) => v)).toEqual([fx(0.18), fx(0.18) + fx(0.16), fx(0.18) + 2 * fx(0.16), fx(0.18) + 3 * fx(0.16)]);
  });

  it("rolls back across a Super Missile, hash for hash: its launch, its wait, its acceleration and its hit", () => {
    expectRollbackSafe(duel("samus", "mario", -60, 20), 90, (i) => [i === 0 ? SMASH : 0, 0], [-1, 19, 20, 21, 45, 46, 47, 60, 70]);
  });
});

describe("Samus's missiles out at a time (SmashWiki: \"Maximum Homing Missiles at a time 2\", \"Maximum Super Missiles at a time 1\")", () => {
  const SMASH = Btn.Right | Btn.Special;
  const TILT = Btn.Soft | Btn.Right | Btn.Special;
  /** Samus at −60 facing right, Mario behind her, out of every missile's way; `presses` maps a step to its keys. */
  const fire = (presses: Readonly<Record<number, InputFrame>>, frames: number) =>
    run(duel("samus", "mario", -60, -80), frames, (i) => [presses[i] ?? 0, 0]);

  it("launches no third Homing Missile while two are out, and one again once one is gone", () => {
    const states = fire({ 0: TILT, 55: TILT, 110: TILT, 165: TILT }, 190);
    expect(ofId(states[126], "missile")).toHaveLength(2);
    // The third press plays its move; its missile, due on 127, is not launched.
    expect(states[127].fighters[0]).toMatchObject({ action: "special", move: "sideB" });
    expect(ofId(states[127], "missile")).toHaveLength(2);
    expect(states[127].nextProjectileId - states[0].nextProjectileId, "launched").toBe(2);
    // The first is gone after 136; the fourth, due on 182, goes out beside the second.
    expect(ofId(states[182], "missile")).toHaveLength(2);
    expect(states[182].nextProjectileId - states[0].nextProjectileId, "launched").toBe(3);
  });

  it("launches no second Super Missile while one is out", () => {
    const states = fire({ 0: SMASH, 58: SMASH, 116: SMASH }, 140);
    expect(states[78].fighters[0]).toMatchObject({ action: "special", move: "sideBSmash" });
    expect(ofId(states[78], "superMissile")).toHaveLength(1);
    expect(states[78].nextProjectileId - states[0].nextProjectileId, "launched").toBe(1);
    // The first is gone after 95; the third goes out on 136.
    expect(ofId(states[136], "superMissile")).toHaveLength(1);
    expect(states[136].nextProjectileId - states[0].nextProjectileId, "launched").toBe(2);
  });

  it("counts each kind apart: a Super Missile goes out beside two Homing Missiles (UNVERIFIED: the two limits apart)", () => {
    const states = fire({ 0: TILT, 55: TILT, 110: SMASH }, 135);
    expect(ofId(states[130], "missile")).toHaveLength(2);
    expect(ofId(states[130], "superMissile")).toHaveLength(1);
  });

  it("counts each Samus's own: in a ditto, both Super Missiles go out", () => {
    const states = run(duel("samus", "samus", -60, 60), 22, (i) => [i === 0 ? SMASH : 0, i === 0 ? Btn.Left | Btn.Special : 0]);
    expect(ofId(states[20], "superMissile").map((p) => p.owner).sort()).toEqual([0, 1]);
  });

  it("rolls back across a missile the limit holds back, hash for hash", () => {
    const presses: Record<number, InputFrame> = { 0: SMASH, 58: SMASH };
    expectRollbackSafe(duel("samus", "mario", -60, -80), 100, (i) => [presses[i] ?? 0, 0], [57, 58, 77, 78, 79]);
  });
});

describe("Link's smash-thrown Boomerang (SmashWiki \"Link (SSBU)/Side special\")", () => {
  const SMASH_THROW = () => projectileDef("link", "boomerangSmash");
  const TILT_THROW = () => projectileDef("link", "boomerang");

  it("carries the page's numbers: 3.1 out, 167 frames, its clean hit ×1.2, the rest as the tilt throw's", () => {
    const move = link.moves.sideBSmash!;
    expect(move).toMatchObject({ slot: "sideBSmash", totalFrames: 45, motionOf: "sideB" });
    expect(move.projectiles!.map((p) => p.id)).toEqual(["boomerangSmash"]);
    const s = SMASH_THROW();
    const t = TILT_THROW();
    expect(s).toMatchObject({ spawnFrame: 27, vx: fx(3.1), lifetime: 167 });
    expect(s.hitbox).toMatchObject({ endFrame: 166, damage: fx(9.6) });
    expect(toFloat(s.hitbox.damage)).toBeCloseTo(8 * 1.2, 3);
    // Everything else is the tilt throw's: the way back, its returning hit (not ×1.2:
    // the page multiplies the "clean and late hits"), the clash, the floor.
    const same = (p: ProjectileDef) => ({ ...p, id: "", vx: 0, lifetime: 0, hitbox: { ...p.hitbox, endFrame: 0, damage: 0 } });
    expect(same(s)).toEqual(same(t));
  });

  /** Link standing at −60 facing right, Mario far behind him; `press` on step 0. The boomerang at each age, and where it was thrown from. */
  function thrown(press: InputFrame, id: string, frames = 220) {
    const states = run(duel("link", "mario", -60, -80), frames, (i) => [i === 0 ? press : 0, 0]);
    const born = states.findIndex((st) => ofId(st, id).length > 0);
    expect(born, "thrown on frame 27").toBe(26);
    return states.slice(born).map((st) => ofId(st, id)[0]);
  }

  it("turns on frame 60 of its flight, where its returning hit starts (87 − 27)", () => {
    const life = thrown(Btn.Right | Btn.Special, "boomerangSmash");
    for (let age = 0; age < 60; age++) expect([life[age]!.returning, life[age]!.vx], `age ${age}`).toEqual([false, fx(3.1) - age * fx(0.047)]);
    expect([life[60]!.returning, life[60]!.vx]).toEqual([true, -fx(0.3)]);
    expect(projectileHitbox(life[59]!, SMASH_THROW()).damage).toBe(fx(9.6));
    expect(projectileHitbox(life[60]!, SMASH_THROW()).damage).toBe(fx(3));
  });

  it("flies out Σ (3.1 − 0.047k) for k = 1..59, about 99.7, where the tilt throw flies Σ (2.4 − 0.047k) for k = 1..44, about 59.1", () => {
    const out = (press: InputFrame, id: string) => {
      const life = thrown(press, id).filter((p) => p !== undefined);
      return Math.max(...life.map((p) => p!.x)) - life[0]!.x;
    };
    const smash = out(Btn.Right | Btn.Special, "boomerangSmash");
    const tilt = out(Btn.Soft | Btn.Right | Btn.Special, "boomerang");
    expect(smash).toBe(59 * fx(3.1) - 1770 * fx(0.047));
    expect(tilt).toBe(44 * fx(2.4) - 990 * fx(0.047));
    expect(toFloat(smash)).toBeCloseTo(59 * 3.1 - 0.047 * 1770, 0);
    expect(toFloat(tilt)).toBeCloseTo(44 * 2.4 - 0.047 * 990, 0);
  });

  it("comes home: Link catches it before its 167 frames are out", () => {
    const life = thrown(Btn.Right | Btn.Special, "boomerangSmash");
    const gone = life.findIndex((p) => p === undefined);
    expect(gone).toBeGreaterThan(60);
    expect(gone).toBeLessThan(166);
  });

  it("rolls back across its turn, hash for hash", () => {
    expectRollbackSafe(duel("link", "mario", -60, -80), 110, (i) => [i === 0 ? Btn.Right | Btn.Special : 0, 0], [-1, 25, 26, 27, 85, 86, 87]);
  });
});

/**
 * One Boomerang at a time (fix round 1, ruling R-T13d-d): a throw with one out is the
 * failed throw. SmashWiki "Link (SSBU)/Side special" (revision 1840696), "Throw
 * (failed)": "Interruptible (grounded) 60", "Interruptible (aerial) 46", "Animation
 * length 63"; rubendal 13.0.1 Link Motions: `special_s1_blank` CancelFrame 60 and
 * `special_air_s1_blank` CancelFrame 46, both on the throw's animation `d01specials1`.
 */
describe("Link's failed throw: one Boomerang out at a time", () => {
  const TILT = Btn.Soft | Btn.Right | Btn.Special;
  const SMASH = Btn.Right | Btn.Special;
  const boomerangs = (s: GameState) => s.projectiles.filter((p) => p.defId === "boomerang" || p.defId === "boomerangSmash");
  /** Link standing at −60 facing right, Mario far behind him; `presses` maps a step to its keys. */
  const throws = (presses: Readonly<Record<number, InputFrame>>, frames: number, airY?: number) =>
    run(duel("link", "mario", -60, -80, airY), frames, (i) => [presses[i] ?? 0, 0]);

  it("is one field on each throw, and one article both throws count as, at most one out", () => {
    expect(link.moves.sideB!.whenOut).toBe("sideBFailed");
    expect(link.moves.sideBSmash!.whenOut).toBe("sideBFailed");
    for (const id of ["boomerang", "boomerangSmash"]) expect(projectileDef("link", id), id).toMatchObject({ article: "boomerang", maxOut: 1 });
    expect(link.moves.sideBFailed).toMatchObject({ slot: "sideBFailed", totalFrames: 59, aerialTotalFrames: 45 });
    // A motion of its own since Plan 5, Task 17: the throw's clip across its own length.
    expect(link.moves.sideBFailed!.motionOf).toBeUndefined();
    expect(link.moves.sideBFailed!.projectiles).toBeUndefined();
    // Samus's two missiles keep a count each (ruling R-T13d-a): no shared article.
    expect([projectileDef("samus", "missile").article, projectileDef("samus", "superMissile").article]).toEqual([undefined, undefined]);
  });

  it.each([
    ["a tilt throw, then a smash one", TILT, SMASH],
    ["a smash throw, then a tilt one", SMASH, TILT],
  ] as const)("%s: the second is the failed throw, launching nothing, actionable on 60 on the ground", (_name, first, second) => {
    const states = throws({ 0: first, 50: second }, 112);
    expect(boomerangs(states[49])).toHaveLength(1);
    expect(states[50].fighters[0]).toMatchObject({ action: "special", move: "sideBFailed" });
    expect(states.slice(50).every((st) => boomerangs(st).length <= 1)).toBe(true);
    expect(states[111].nextProjectileId - states[0].nextProjectileId, "launched").toBe(1);
    expect(states[108].fighters[0]).toMatchObject({ action: "special", move: "sideBFailed" });
    expect(states[109].fighters[0].action).toBe("stand");
  });

  it("is actionable on 46 in the air", () => {
    const states = throws({ 0: TILT, 50: SMASH }, 100, 170);
    expect(states[50].fighters[0]).toMatchObject({ action: "special", move: "sideBFailed", grounded: false });
    expect(states[94].fighters[0]).toMatchObject({ action: "special", grounded: false });
    expect(states[95].fighters[0].action).toBe("fall");
  });

  it("throws again once the Boomerang is home", () => {
    const states = throws({ 0: TILT, 50: TILT, 160: TILT }, 200);
    const home = states.findIndex((st, i) => i > 26 && boomerangs(st).length === 0);
    expect(home).toBeGreaterThan(71);
    expect(home).toBeLessThan(160);
    expect(states[160].fighters[0]).toMatchObject({ action: "special", move: "sideB" });
    expect(boomerangs(states[186])).toHaveLength(1);
    expect(states[199].nextProjectileId - states[0].nextProjectileId, "launched").toBe(2);
  });

  it("lands plainly in the air, as the throw does (UNVERIFIED: no landing is published for either)", () => {
    const states = throws({ 0: TILT, 50: SMASH }, 120, 120);
    const failed = states[50].fighters[0];
    expect(failed.move).toBe("sideBFailed");
    const landed = states.findIndex((st, i) => i > 50 && st.fighters[0].grounded);
    expect(landed).toBeGreaterThan(50);
    // Landed in it, not after it.
    expect(states[landed - 1].fighters[0]).toMatchObject({ action: "special", move: "sideBFailed" });
    expect(states[landed].fighters[0].action).toBe("land");
  });

  it("throws as usual where the failed version's move is missing: a half-finished fighter stays playable", () => {
    const s = duel("link", "mario", -60, -80);
    const stage = STAGES.find((st) => st.id === "finalDestination")!;
    const begin = (def: typeof link) => {
      const f = structuredClone(s.fighters[0]);
      expect(beginSpecial(f, { def, stage, frame: 0, fighters: s.fighters, out: () => 1 }, "sideB", 1, { x: 1, y: 0, soft: true })).toBe(true);
      return f.move;
    };
    expect(begin(link)).toBe("sideBFailed");
    expect(begin({ ...link, moves: { ...link.moves, sideBFailed: undefined } })).toBe("sideB");
  });

  it("launches no second one from a throw already under way: the limit holds at the launch too, by article", () => {
    // A tilt throw on its frame 21, with a smash-thrown Boomerang of his already out.
    const s = duel("link", "mario", -60, -80);
    Object.assign(s.fighters[0], { action: "special", move: "sideB", actionFrame: 20 });
    const out = spawnProjectile(projectileDef("link", "boomerangSmash"), s.fighters[0], s.nextProjectileId, "link");
    Object.assign(out, { x: fx(40), y: fx(7) });
    s.projectiles.push(out);
    s.nextProjectileId += 1;
    const states = run(s, 10, () => [0, 0]);
    expect(states[9].fighters[0]).toMatchObject({ action: "special", move: "sideB" });
    expect(states.map((st) => boomerangs(st).length)).toEqual(states.map(() => 1));
  });

  it("rolls back across a failed throw, hash for hash", () => {
    const presses: Record<number, InputFrame> = { 0: TILT, 50: SMASH };
    expectRollbackSafe(duel("link", "mario", -60, -80), 115, (i) => [presses[i] ?? 0, 0], [-1, 49, 50, 51, 76, 77, 108, 109, 110]);
  });
});
