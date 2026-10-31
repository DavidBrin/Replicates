/**
 * The one rehit mechanism, through `step()` on stand-in scripts (Plan 5, Task 16 fix
 * round 1: the review's M4 and M9, rulings R-T16d, R-T16e and R-T16i).
 *
 * SmashWiki "Hitbox" (https://www.ssbwiki.com/Hitbox): a rehit rate, "If not 0, allows
 * the hitbox to strike again after the specified amount of frames"; a part, "Determines
 * how many hitboxes can hit in one attack. If a hitbox has a part value of 1, for
 * example, it can connect after landing a hitbox with a part value of 0". SmashWiki
 * "Priority" (https://www.ssbwiki.com/Priority): "clanking blocks only the current hit".
 */

import { describe, expect, it } from "vitest";

import { ATTACK, clearAll, frame, script } from "./acmd/dsl";
import { fx } from "./fixed";
import { kineticClear } from "./kinetic";
import { cloneState, createInitialState, step } from "./simulate";
import type { SimContext } from "./simulate";
import { Btn } from "./types";
import type { AcmdScript } from "./acmd/types";
import type { FighterAttributes, FighterDef, GameState, InputFrame, MatchRules, MoveDef, StageDef } from "./types";

const ATTRS: FighterAttributes = {
  weight: 98,
  walkSpeed: fx(1.1),
  initialDashSpeed: fx(1.76),
  runSpeed: fx(1.5),
  airSpeed: fx(1.15),
  airAccelBase: fx(0.01),
  airAccelAdditional: fx(0.05),
  gravity: fx(0.087),
  fallSpeed: fx(1.5),
  fastFallSpeed: fx(2.4),
  traction: fx(0.08),
  fullHopVelocity: fx(3.1),
  shortHopVelocity: fx(1.7),
  airJumpVelocity: fx(2.85),
  jumps: 2,
  canWallJump: false,
  width: fx(2),
  height: fx(12),
  jumpSquatFrames: 3,
};

const JAB: MoveDef = { slot: "jab1", name: "stand-in", totalFrames: 24, hitboxes: [] };

/** A stand-in fighter whose jab runs `jab` (an imported-style script). */
function fighterWith(id: string, jab: AcmdScript): FighterDef {
  return {
    id,
    name: id,
    series: "test",
    number: 1,
    attributes: ATTRS,
    moves: { jab1: JAB },
    scripts: { jab1: jab },
    palette: { primary: "#f00", secondary: "#00f", accent: "#ff0", skin: "#fca", outline: "#000", alts: [] },
    blurb: "test",
  } as FighterDef;
}

const STAGE: StageDef = {
  id: "flat",
  name: "Flat",
  series: "test",
  platforms: [{ x: 0, y: 0, halfWidth: fx(200), soft: false, ledges: true }],
  blastZone: { left: fx(-400), right: fx(400), top: fx(300), bottom: fx(-200) },
  spawns: [
    { x: fx(-40), y: 0 },
    { x: fx(40), y: 0 },
    { x: fx(60), y: 0 },
  ],
  theme: "test",
};

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };

/** `defs` standing at `xs`, port 0 facing right, the rest left, in `ctx`. */
function standing(ctx: SimContext, ids: readonly string[], xs: readonly number[]): GameState {
  const s = createInitialState("flat", ids.map((defId) => ({ defId })), RULES, 7, ctx);
  s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(xs[i]), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }));
  return s;
}

/**
 * Every hit, as [step, attacker, victim, box id], over `frames` steps of `keys`; each
 * victim in `held` is put back where it stood before every step.
 */
function hits(ctx: SimContext, s0: GameState, frames: number, keys: (i: number) => InputFrame[], held: readonly number[]): [number, number, number, number][] {
  const home = s0.fighters.map((f) => ({ x: f.x, y: f.y }));
  let s = s0;
  let prev: InputFrame[] = keys(0).map(() => 0);
  const out: [number, number, number, number][] = [];
  for (let i = 0; i < frames; i++) {
    s = cloneState(s);
    for (const port of held) {
      Object.assign(s.fighters[port], { x: home[port].x, y: home[port].y, grounded: true, platform: 0 });
      kineticClear(s.fighters[port]);
    }
    const now = keys(i);
    const result = step(s, now, { prevInputs: prev, ctx });
    s = result.state;
    prev = now;
    for (const h of result.events.hits) out.push([i + 1, h.attacker, h.victim, h.hitboxId]);
  }
  return out;
}

describe("a script's boxes each keep their own rehit (the review's X3)", () => {
  // Box 0 reaches the fighter in front only, and strikes once (`Rehit=0`); box 1 reaches
  // the fighter behind only, and strikes every 3 frames (`Rehit=3`). Both live 2-14,
  // no hitlag, so the move's frames are the steps.
  const jab = script("game_attack11", "attack_11", [
    frame(2),
    ATTACK({ id: 0, bone: "top", damage: 1, angle: 0, kbg: 0, fkb: 10, bkb: 0, size: 3, x: 0, y: 6, z: 10, hitlag: 0 }),
    ATTACK({ id: 1, bone: "top", damage: 1, angle: 0, kbg: 0, fkb: 10, bkb: 0, size: 3, x: 0, y: 6, z: -10, hitlag: 0, rehit: 3 }),
    frame(15),
    clearAll(),
  ]);
  const ctx: SimContext = { fighter: (id) => fighterWith(id, jab), stage: () => STAGE };

  it("strikes the fighter in front once and the one behind every 3 frames", () => {
    const s = standing(ctx, ["a", "b", "c"], [0, 10, -10]);
    const landed = hits(ctx, s, 20, (i) => [i === 0 ? Btn.Attack : 0, 0, 0], [1, 2]);
    expect(landed.filter(([, , v]) => v === 1).map(([f, , , id]) => [f, id])).toEqual([[2, 0]]);
    expect(landed.filter(([, , v]) => v === 2).map(([f, , , id]) => [f, id])).toEqual([2, 5, 8, 11, 14].map((f) => [f, 1]));
  });
});

describe("a box's part keeps a hit record of its own (ruling R-T16e)", () => {
  // Two boxes over the same fighter on the same frames: on one part the lower id lands
  // alone, once; on two parts each lands, beside the other.
  const twoBoxes = (part: number) =>
    script("game_attack11", "attack_11", [
      frame(2),
      ATTACK({ id: 0, bone: "top", damage: 1, angle: 0, kbg: 0, fkb: 10, bkb: 0, size: 4, x: 0, y: 6, z: 10, hitlag: 0 }),
      ATTACK({ id: 1, part, bone: "top", damage: 2, angle: 0, kbg: 0, fkb: 10, bkb: 0, size: 4, x: 0, y: 6, z: 10, hitlag: 0 }),
      frame(5),
      clearAll(),
    ]);

  it.each([
    [0, [[2, 0]]],
    [1, [[2, 0], [2, 1]]],
  ] as const)("part %i: %j", (part, want) => {
    const ctx: SimContext = { fighter: (id) => fighterWith(id, twoBoxes(part)), stage: () => STAGE };
    const s = standing(ctx, ["a", "b"], [0, 10]);
    const landed = hits(ctx, s, 8, (i) => [i === 0 ? Btn.Attack : 0, 0], [1]);
    expect(landed.map(([f, , , id]) => [f, id])).toEqual(want);
  });
});

describe("a clank blocks only the current hit of a box with a rehit (ruling R-T16i)", () => {
  // A's weak box tramples (ATTACK_SETOFF_KIND_THRU) and strikes again every 4 frames; B's
  // 15% box meets it on 2 and 3 and wins, so A's hit on B is blocked there. The rehit
  // re-arms B for A's box 4 frames on (A's frames: the clank freezes it), where before it
  // was blocked for the whole swing.
  const weak = script("game_attack11", "attack_11", [
    frame(2),
    ATTACK({ id: 0, bone: "top", damage: 1, angle: 0, kbg: 0, fkb: 5, bkb: 0, size: 4, x: 0, y: 6, z: 8, hitlag: 0, clang: "ATTACK_SETOFF_KIND_THRU", rehit: 4 }),
    frame(20),
    clearAll(),
  ]);
  const strong = script("game_attack11", "attack_11", [
    frame(2),
    ATTACK({ id: 0, bone: "top", damage: 15, angle: 0, kbg: 0, fkb: 5, bkb: 0, size: 4, x: 0, y: 6, z: 8, hitlag: 0 }),
    frame(4),
    clearAll(),
  ]);
  const ctx: SimContext = { fighter: (id) => fighterWith(id, id === "a" ? weak : strong), stage: () => STAGE };

  it("strikes the fighter it clanked with once its rehit has run", () => {
    const s = standing(ctx, ["a", "b"], [0, 10]);
    const landed = hits(ctx, s, 40, (i) => [i === 0 ? Btn.Attack : 0, i === 0 ? Btn.Attack : 0], [0, 1]);
    expect(landed.filter(([, a, v]) => a === 0 && v === 1).length).toBeGreaterThan(0);
  });
});

describe("a clank blocks only the current hit of a projectile with a rehit (ruling R-T16i)", () => {
  // A's jab leaves a still, trampling (ATTACK_SETOFF_KIND_THRU) 1% projectile that
  // strikes again every 4 of its frames, in front of B, on its move's 2. B's 15% box
  // meets it there and wins, so its hit on B is blocked. The rehit re-arms B for it 4
  // of its frames on, where before it was blocked for its whole flight.
  const PELLET = "pellet";
  const thrower: FighterDef = {
    ...fighterWith("a", script("game_attack11", "attack_11", [])),
    scripts: {},
    moves: {
      jab1: {
        ...JAB,
        projectiles: [
          {
            id: PELLET,
            spawnFrame: 2,
            offsetX: fx(20),
            offsetY: fx(6),
            vx: 0,
            vy: 0,
            gravity: 0,
            lifetime: 30,
            destroyOnHit: false,
            visual: "energy",
            rehit: 4,
            hitbox: { id: 0, startFrame: 0, endFrame: 29, x: 0, y: 0, radius: fx(4), damage: fx(1), angle: 0, baseKnockback: 0, knockbackGrowth: 0, fixedKnockback: fx(5), hitlagMultiplier: 0, noRebound: true },
          },
        ],
      },
    },
  } as FighterDef;
  const strong = script("game_attack11", "attack_11", [
    frame(2),
    ATTACK({ id: 0, bone: "top", damage: 15, angle: 0, kbg: 0, fkb: 5, bkb: 0, size: 4, x: 0, y: 6, z: 8, hitlag: 0 }),
    frame(4),
    clearAll(),
  ]);
  const ctx: SimContext = { fighter: (id) => (id === "a" ? thrower : fighterWith(id, strong)), stage: () => STAGE };

  it("strikes the fighter it clanked with once its rehit has run", () => {
    const s = standing(ctx, ["a", "b"], [-10, 14]);
    const landed = hits(ctx, s, 30, (i) => [i === 0 ? Btn.Attack : 0, i === 0 ? Btn.Attack : 0], [0, 1]);
    expect(landed.filter(([, a, v]) => a === 0 && v === 1).length).toBeGreaterThan(0);
  });
});
