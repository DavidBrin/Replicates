/**
 * Mario's Cape, through the real `step()` (Plan 5, Task 4 and its fix round 1).
 *
 * - SmashWiki "Mario (SSBU)/Side special"
 *   (https://www.ssbwiki.com/Mario_(SSBU)/Side_special): "Reflection 9-20",
 *   "Damage multiplier 1.5", "Speed multiplier 1", "Lifetime multiplier 0.75",
 *   "Size 6.5u", "Offsets [0, 6.5, 8]", projectile detector 6-8, "Interruptible
 *   36", animation length 58; in the air "Horizontal speed divisor 2.5", "Air
 *   friction 0.0025", "Vertical speed added 0.3", "Gravity 0.031", "Falling
 *   speed 1".
 * - SmashWiki "Mario (SSBU)" (https://www.ssbwiki.com/Mario_(SSBU)), changes:
 *   the reflector can "start two frames earlier (frame 7) if a projectile is
 *   very close", and then "the entire move loses two frames of startup"; "The
 *   move's animation length is much longer (41 frames → 58). In the air, this
 *   means Mario's air mobility is restricted for much longer, forcing the player
 *   to have to interrupt the move with an aerial or special".
 * - The hit: `game_specials` (rubendal Data Viewer 13.0.1,
 *   `acmd/generated/mario.ts`): 7%, angle 110, FKB 80, KBG 100,
 *   `collision_attr_turn`. SmashWiki "Reverse"
 *   (https://www.ssbwiki.com/Reverse_(effect)): "A fighter hit by a reverse
 *   attack is forcibly turned around to face the opposite direction"; SmashWiki
 *   "Cape" (https://www.ssbwiki.com/Cape): "Cape can even flip shielding
 *   opponents".
 */

import { beforeAll, describe, expect, it } from "vitest";

import { legacyGameScript } from "@/engine/acmd/legacy";
import type { AttackParams } from "@/engine/acmd/types";
import { fx, mul, toFloat } from "@/engine/fixed";
import { actionFrameOf, moveFrameOf } from "@/engine/hitbox";
import { findProjectileDef, spawnProjectile } from "@/engine/projectile";
import { activeReflector, reflectorBubble } from "@/engine/reflect";
import { createInitialState, registerFighters, registerStages, registryContext, step } from "@/engine/simulate";
import type { SimContext } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { FighterDef, GameState, InputFrame, MatchRules, StepEvents } from "@/engine/types";
import { STAGES } from "@/stages";
import { MARIO } from "./acmd/generated/mario";
import { FIGHTERS, fox, mario } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

/** The Cape's 7% in a fresh one-on-one: ×1.05 unstaled, ×1.2 one-on-one. */
const CAPE_DAMAGE = 7 * 1.05 * 1.2;

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

function duel(gap: number, rival = "fox"): GameState {
  const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: rival }], RULES, 5);
  s.fighters.forEach((f, i) =>
    Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? -gap / 2 : gap / 2), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }),
  );
  return s;
}

/** Mario falling in open air above Final Destination, well clear of the floor. */
function falling(vy = fx(-1.4)): GameState {
  const s = duel(80);
  Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, y: fx(90), vy });
  return s;
}

function run(
  s0: GameState,
  frames: number,
  mario: (i: number) => InputFrame,
  rival: (i: number) => InputFrame = () => 0,
): { states: GameState[]; events: StepEvents[] } {
  let s = s0;
  let prev: [InputFrame, InputFrame] = [0, 0];
  const states: GameState[] = [];
  const events: StepEvents[] = [];
  for (let i = 0; i < frames; i++) {
    const now: [InputFrame, InputFrame] = [mario(i), rival(i)];
    const out = step(s, now, { prevInputs: prev });
    s = out.state;
    prev = now;
    states.push(s);
    events.push(out.events);
  }
  return { states, events };
}

const cape = (i: number): InputFrame => (i === 0 ? Btn.Right | Btn.Special : 0);

describe("Mario's Cape", () => {
  it("turns the opponent it hits round, for 7%", () => {
    const { states } = run(duel(10), 30, cape);
    const end = states[states.length - 1].fighters[1];
    expect(end.facing).toBe(1);
    expect(toFloat(end.damage)).toBeCloseTo(CAPE_DAMAGE, 2);
  });

  it("turns round an opponent already facing away from Mario: a flip, not 'face away'", () => {
    const s = duel(10);
    s.fighters[1].facing = 1;
    const { states } = run(s, 30, cape);
    expect(states[states.length - 1].fighters[1].facing).toBe(-1);
  });

  it("sends a laser back at ×1.5, Mario's now", () => {
    // Far enough that the laser arrives inside the reflecting frames (9-20).
    const s = duel(100);
    s.projectiles.push(spawnProjectile(findProjectileDef(fox, "blaster")!, s.fighters[1], 1));
    s.nextProjectileId = 2;
    const { states, events } = run(s, 30, cape);
    const at = events.findIndex((e) => e.reflects.length > 0);
    expect(at).toBeGreaterThanOrEqual(8);
    const p = states[at].projectiles[0];
    expect(p.owner).toBe(0);
    expect(toFloat(p.chargeScale)).toBeCloseTo(1.5, 3);
    expect(states[states.length - 1].fighters[0].damage).toBe(0);
  });

  it("sends it back at the speed it came (×1), with 0.75 of its life", () => {
    const s = duel(100);
    const blaster = findProjectileDef(fox, "blaster")!;
    s.projectiles.push(spawnProjectile(blaster, s.fighters[1], 1));
    s.nextProjectileId = 2;
    const { states, events } = run(s, 30, cape);
    const at = events.findIndex((e) => e.reflects.length > 0);
    const before = states[at - 1].projectiles[0];
    const after = states[at].projectiles[0];
    expect(after.vx).toBe(-before.vx);
    expect(after.age).toBe(blaster.lifetime - Math.trunc((blaster.lifetime * fx(0.75)) / fx(1)));
  });

  it("reflects on frames 9-20 and no others", () => {
    const f = duel(10).fighters[0];
    Object.assign(f, { action: "special", move: "sideB" });
    const upOn = (frame: number): boolean => {
      f.actionFrame = actionFrameOf(frame);
      return activeReflector(f, mario) !== null;
    };
    expect([8, 9, 20, 21].map(upOn)).toEqual([false, true, true, false]);
  });

  it("raises its 6.5u bubble 8 in front of Mario and 6.5 up (\"Offsets [0, 6.5, 8]\")", () => {
    const f = duel(10).fighters[0];
    const r = mario.moves.sideB!.reflector!;
    for (const facing of [1, -1]) {
      Object.assign(f, { x: fx(-3), y: fx(2), facing });
      expect(reflectorBubble(f, r)).toEqual({ x1: fx(-3) + facing * fx(8), y1: fx(8.5), x2: fx(-3) + facing * fx(8), y2: fx(8.5), r: fx(6.5) });
    }
  });

  it("has game_specials' two boxes, field for field", () => {
    const attacks = (cmds: readonly { op: string }[]): AttackParams[] =>
      cmds.filter((c): c is { op: "attack"; params: AttackParams } => c.op === "attack").map((c) => c.params);
    const pick = (a: AttackParams) => [a.id, a.damage, a.angle, a.bkb, a.fkb, a.kbg, a.size, a.y, a.z, a.collisionAttr];
    const ours = attacks(legacyGameScript(mario.moves.sideB!).commands).map(pick);
    const game = attacks(MARIO.scripts.game_specials.commands).map(pick);
    expect(game).toHaveLength(2);
    expect(ours).toEqual(game);
  });
});

describe("the Cape's reflector comes up early for a projectile very close", () => {
  /** Mario 100 apart from Fox, and a laser of Fox's flying at him from `x`. */
  function laserAt(x: number): GameState {
    const s = duel(100);
    const p = spawnProjectile(findProjectileDef(fox, "blaster")!, s.fighters[1], 1);
    p.x = fx(x);
    s.projectiles.push(p);
    s.nextProjectileId = 2;
    return s;
  }

  it("on frame 7, when the detector meets it on frame 6", () => {
    // 5.5 a frame from x −1: inside the detector's reach (Mario −50, +2.5 to +8,
    // 8 wide, the laser 2) on frame 6, and inside the bubble's on frame 7.
    const { states, events } = run(laserAt(-1), 12, cape);
    expect(moveFrameOf(states[5].fighters[0].actionFrame)).toBe(8);
    expect(moveFrameOf(states[6].fighters[0].actionFrame)).toBe(9);
    expect(events.findIndex((e) => e.reflects.length > 0)).toBe(6);
    expect(states[11].fighters[0].damage).toBe(0);
  });

  it("in front of a left-facing Mario too: the detector is mirrored", () => {
    const s = duel(100);
    // The same scene, mirrored: Mario at +50 facing left, Fox's laser flying right at him from +1.
    Object.assign(s.fighters[0], { x: fx(50), facing: -1 });
    Object.assign(s.fighters[1], { x: fx(-50), facing: 1 });
    const p = spawnProjectile(findProjectileDef(fox, "blaster")!, s.fighters[1], 1);
    p.x = fx(1);
    s.projectiles.push(p);
    s.nextProjectileId = 2;
    const { states, events } = run(s, 12, (i) => (i === 0 ? Btn.Left | Btn.Special : 0));
    expect(moveFrameOf(states[5].fighters[0].actionFrame)).toBe(8);
    expect(events.findIndex((e) => e.reflects.length > 0)).toBe(6);
  });

  it("but not for Mario's own projectile on the same path", () => {
    // The first test's laser, Mario's now (as a reflected one is): the detector ignores it.
    const s = laserAt(-1);
    s.projectiles[0].owner = 0;
    const { states, events } = run(s, 12, cape);
    expect(moveFrameOf(states[6].fighters[0].actionFrame)).toBe(7);
    expect(events.some((e) => e.reflects.length > 0)).toBe(false);
  });

  it("but on frame 9 with nothing near", () => {
    const { states } = run(duel(100), 12, cape);
    expect(moveFrameOf(states[6].fighters[0].actionFrame)).toBe(7);
    expect(moveFrameOf(states[8].fighters[0].actionFrame)).toBe(9);
  });
});

describe("the Cape in the air", () => {
  it("stops a fall the first time in an airtime, and only the first", () => {
    const { states } = run(falling(), 80, (i) => (i === 0 || i === 40 ? Btn.Right | Btn.Special : 0));
    expect(states[0].fighters[0].vy).toBe(fx(0.3));
    expect(states[40].fighters[0].vy).toBeLessThan(0);
    // The Cape's own gravity, 0.031, takes it no lower than −0.75 by its 35th
    // frame; the falling-speed cap is pinned below, where it is reached.
    expect(Math.min(...states.slice(1, 34).map((x) => x.fighters[0].vy))).toBeGreaterThanOrEqual(-fx(1));
  });

  it("follows its published motion to its 58th frame: +0.3, then 0.031 a frame, to a falling speed of 1", () => {
    const { states } = run(falling(), 60, cape);
    for (let n = 1; n <= 58; n++) {
      const f = states[n - 1].fighters[0];
      expect([f.action, f.move, moveFrameOf(f.actionFrame)], `move frame ${n}`).toEqual(["special", "sideB", n]);
      expect(f.vy, `move frame ${n}`).toBe(n <= 42 ? fx(0.3) - (n - 1) * fx(0.031) : -fx(1));
    }
    expect(states[58].fighters[0].action).toBe("fall");
  });

  it("caps a fall at its own falling speed, 1, not Mario's 1.5", () => {
    const s0 = run(falling(), 1, cape).states[0];
    Object.assign(s0.fighters[0], { vy: -fx(0.99) });
    const next = step(s0, [0, 0], { prevInputs: [Btn.Right | Btn.Special, 0] }).state.fighters[0];
    expect(next.vy).toBe(-fx(1));
  });

  it("adds its 0.3 to a rise rather than setting it", () => {
    const plain = run(falling(fx(1)), 1, () => 0).states[0].fighters[0].vy;
    const caped = run(falling(fx(1)), 1, cape).states[0].fighters[0].vy;
    expect(caped).toBe(plain + fx(0.3));
  });

  it("uses its own physics on a later use in the airtime, without the stop", () => {
    const { states } = run(falling(), 60, (i) => (i === 0 || i === 40 ? Btn.Right | Btn.Special : 0));
    const was = states[39].fighters[0].vy;
    for (let k = 0; k <= 10; k++) {
      const f = states[40 + k].fighters[0];
      expect([f.move, moveFrameOf(f.actionFrame)]).toEqual(["sideB", k + 1]);
      expect(f.vy, `frame ${k + 1} of the second Cape`).toBe(Math.max(-fx(1), was - (k + 1) * fx(0.031)));
    }
  });

  it("restricts air mobility: holding the stick does not drift Mario", () => {
    const { states } = run(falling(), 58, (i) => (i === 0 ? Btn.Right | Btn.Special : Btn.Right));
    expect(states.map((x) => x.fighters[0].vx)).toEqual(states.map(() => 0));
  });

  it("divides its speed by 2.5 once, then bleeds it by its own air friction, 0.0025 a frame", () => {
    const s = falling();
    s.fighters[0].vx = fx(1);
    const { states } = run(s, 58, (i) => (i === 0 ? Btn.Right | Btn.Special : Btn.Right));
    // "Horizontal speed divisor 2.5" on its first frame, on the speed the friction left.
    expect(states[0].fighters[0].vx).toBe(mul(fx(1) - fx(0.0025), fx(0.4)));
    for (let n = 2; n <= 58; n++) {
      expect(states[n - 1].fighters[0].vx, `move frame ${n}`).toBe(states[n - 2].fighters[0].vx - fx(0.0025));
    }
  });

  it("holds a boost through no-gravity frames rather than overwriting it (a stall with both)", () => {
    const sideB = mario.moves.sideB!;
    const both: FighterDef = { ...mario, moves: { ...mario.moves, sideB: { ...sideB, stall: { ...sideB.stall!, noGravityFrames: 3 } } } };
    const ctx: SimContext = { ...registryContext, fighter: (id) => (id === "mario" ? both : registryContext.fighter(id)) };
    let s = falling();
    const vys: number[] = [];
    for (let i = 0; i < 5; i++) {
      s = step(s, [cape(i), 0], { prevInputs: [i === 1 ? cape(0) : 0, 0], ctx }).state;
      vys.push(s.fighters[0].vy);
    }
    expect(vys).toEqual([fx(0.3), fx(0.3), fx(0.3), fx(0.3) - fx(0.031), fx(0.3) - 2 * fx(0.031)]);
  });

  it("can be interrupted from frame 36 by a special, not before", () => {
    const at = (press: number) =>
      run(falling(), press + 1, (i) => (i === 0 ? Btn.Right | Btn.Special : i === press ? Btn.Up | Btn.Special : 0)).states[press].fighters[0];
    expect(at(34).move).toBe("sideB");
    expect(at(35).move).toBe("upB");
  });
});

describe("the Cape's turn lands with the hit, whatever the hit does", () => {
  it("turns a shielding opponent", () => {
    const { states, events } = run(duel(10), 30, cape, () => Btn.Shield);
    expect(events.some((e) => e.shieldHits.length > 0)).toBe(true);
    expect(states[states.length - 1].fighters[1].facing).toBe(1);
  });

  it("turns one whose stronger launch it cannot replace: 8.82% lands, and it turns", () => {
    const s = duel(10);
    // Frozen with a launch of another source's parked (Plan 3 Task 8's stacking).
    Object.assign(s.fighters[1], { action: "tumble", hitstun: 60, hitlag: 30, pendingFacing: -1, pendingKnockback: fx(300), pendingAngle: fx(45) });
    s.fighters[1].combat.launchSource = 999;
    const { states, events } = run(s, 14, cape);
    const at = events.findIndex((e) => e.hits.length > 0);
    const fox_ = states[at].fighters[1];
    expect(fox_.pendingKnockback).toBe(fx(300));
    expect(toFloat(fox_.damage)).toBeCloseTo(CAPE_DAMAGE, 2);
    expect(fox_.facing).toBe(1);
  });

  it("turns an armoured one (Kirby's Stone), UNVERIFIED", () => {
    // Kirby's Stone two frames after the Cape: it is in its armour (frame 10) when the
    // Cape hits on 12, a frame before its own landing hit comes out on its frame 11
    // (Plan 5, Task 13 fix round 1, which gave it one).
    const { states, events } = run(duel(10, "kirby"), 20, cape, (i) => (i === 2 ? Btn.Down | Btn.Special : 0));
    const at = events.findIndex((e) => e.hits.some((h) => h.attacker === 0));
    expect(states[at].fighters[1].actionFrame + 1).toBe(10);
    const kirby = states[at].fighters[1];
    expect([kirby.action, kirby.move]).toEqual(["special", "downB"]);
    expect(toFloat(kirby.damage)).toBeCloseTo(CAPE_DAMAGE, 2);
    expect(kirby.facing).toBe(1);
  });
});
