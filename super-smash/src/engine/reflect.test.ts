/**
 * Reflectors in isolation (Plan 5, Task 3), on a stand-in reflector with Fox's
 * numbers: SmashWiki "Fox (SSBU)/Down special"
 * (https://www.ssbwiki.com/Fox_(SSBU)/Down_special) and "Reflection"
 * (https://www.ssbwiki.com/Reflection). Fox's own data is pinned through
 * `step()` in `src/fighters/reflect.test.ts`.
 */

import { describe, expect, it } from "vitest";

import { ONE, fx, mul } from "./fixed";
import { emptyEvents } from "./types";
import { MAX_REFLECTIONS, activeReflector, reflectProjectile, reflectProjectiles } from "./reflect";
import type { ReflectCandidate } from "./reflect";
import { createInitialState } from "./simulate";
import type { SimContext } from "./simulate";
import type { FighterDef, MatchRules, ProjectileDef, ProjectileState, ReflectorDef, StageDef } from "./types";

const REFLECTOR: ReflectorDef = {
  active: [4, 23],
  radius: fx(8.5),
  x: 0,
  y: fx(6.5),
  damage: fx(1.4),
  speed: fx(1.4),
  lifetime: fx(1),
  maxDamage: fx(50),
  holdAfterReflect: 20,
};

const SHOT: ProjectileDef = {
  id: "shot",
  spawnFrame: 1,
  offsetX: 0,
  offsetY: 0,
  vx: fx(2),
  vy: 0,
  gravity: 0,
  lifetime: 40,
  visual: "energy",
  reflectable: true,
  hitbox: { id: 0, startFrame: 0, endFrame: 40, x: 0, y: 0, radius: fx(2), damage: fx(10), angle: fx(45), baseKnockback: fx(30), knockbackGrowth: fx(50) },
};

const DEF = {
  id: "t",
  name: "T",
  series: "",
  number: 0,
  attributes: {} as FighterDef["attributes"],
  moves: { downB: { slot: "downB", name: "Reflector", totalFrames: 36, hitboxes: [], reflector: REFLECTOR }, neutralB: { slot: "neutralB", name: "Shot", totalFrames: 20, hitboxes: [], projectiles: [SHOT] } },
  palette: {} as FighterDef["palette"],
  blurb: "",
} as unknown as FighterDef;

const STAGE: StageDef = {
  id: "s",
  name: "S",
  series: "",
  platforms: [{ x: 0, y: 0, halfWidth: fx(100), soft: false, ledges: true }],
  blastZone: { left: fx(-200), right: fx(200), top: fx(200), bottom: fx(-100) },
  spawns: [{ x: fx(-20), y: 0 }, { x: fx(20), y: 0 }],
  theme: "",
};
const CTX: SimContext = { fighter: () => DEF, stage: () => STAGE };
const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

function shotAt(x: number, over: Partial<ProjectileState> = {}): ProjectileState {
  return { instanceId: 1, defId: "shot", owner: 0, x, y: fx(6), vx: fx(2), vy: 0, facing: 1, age: 10, bouncesLeft: 0, chargeScale: ONE, hitPorts: [0], returning: false, source: "t", charge: 0, reflected: 0, damageMul: ONE, mode: "fly", life: 0, ground: -1, face: -1, lived: 10, staleAs: null, staleDamage: ONE, staleKnockback: ONE, ...over };
}

function scene(p: ProjectileState, damage = SHOT.hitbox.damage) {
  const s = createInitialState("s", [{ defId: "t" }, { defId: "t" }], RULES, 1, CTX);
  const fox = s.fighters[1];
  Object.assign(fox, { action: "special", move: "downB", actionFrame: 5, x: fx(20), y: 0, facing: -1 });
  s.projectiles.push(p);
  const c: ReflectCandidate = { projectile: p, hitbox: { radius: SHOT.hitbox.radius, damage }, x: p.x, y: p.y, prevX: p.x - p.vx, prevY: p.y, suppressed: false };
  const events = emptyEvents();
  const destroyed = new Set<number>();
  reflectProjectiles(s, [DEF, DEF], () => SHOT, [c], events, destroyed);
  return { s, c, events, destroyed };
}

describe("activeReflector", () => {
  it("is up only inside its frames", () => {
    const s = createInitialState("s", [{ defId: "t" }], RULES, 1, CTX);
    const f = s.fighters[0];
    Object.assign(f, { action: "special", move: "downB" });
    f.actionFrame = 2; // game frame 3
    expect(activeReflector(f, DEF)).toBeNull();
    f.actionFrame = 3; // game frame 4
    expect(activeReflector(f, DEF)).toBe(REFLECTOR);
    f.actionFrame = 23; // game frame 24
    expect(activeReflector(f, DEF)).toBeNull();
  });

  it("is raised by a special only, the one status that counts its hold down and clears it", () => {
    const s = createInitialState("s", [{ defId: "t" }], RULES, 1, CTX);
    const f = s.fighters[0];
    Object.assign(f, { action: "attack", move: "downB", actionFrame: 5 });
    expect(activeReflector(f, DEF)).toBeNull();
  });
});

describe("reflectProjectile", () => {
  it("hands it over, reverses and speeds it, multiplies its damage, renews it and clears its record", () => {
    const p = shotAt(fx(15));
    const s = createInitialState("s", [{ defId: "t" }, { defId: "t" }], RULES, 1, CTX);
    reflectProjectile(p, SHOT, s.fighters[1], REFLECTOR);
    expect(p.owner).toBe(1);
    expect(p.vx).toBe(-mul(fx(2), fx(1.4)));
    expect(p.facing).toBe(-1);
    expect(p.chargeScale).toBe(fx(1.4));
    expect(p.age).toBe(0);
    expect(p.hitPorts).toEqual([]);
    expect(p.reflected).toBe(1);
  });

  it("keeps the spawner as its source, so its definition is still found (SmashWiki \"Reflection\": only ownership changes)", () => {
    const p = shotAt(fx(15), { source: "mario" });
    const s = createInitialState("s", [{ defId: "t" }, { defId: "t" }], RULES, 1, CTX);
    reflectProjectile(p, SHOT, s.fighters[1], REFLECTOR);
    expect(p.owner).toBe(1);
    expect(p.source).toBe("mario");
  });

  it("starts a returning boomerang's flight over, so it turns again later (UNVERIFIED: no source covers it)", () => {
    const p = shotAt(fx(15), { returning: true });
    const s = createInitialState("s", [{ defId: "t" }, { defId: "t" }], RULES, 1, CTX);
    reflectProjectile(p, SHOT, s.fighters[1], REFLECTOR);
    expect(p.returning).toBe(false);
  });

  it("leaves the vertical speed as it was (UNVERIFIED: the speed multiplier is read as horizontal only)", () => {
    const p = shotAt(fx(15), { vy: fx(1) });
    const s = createInitialState("s", [{ defId: "t" }, { defId: "t" }], RULES, 1, CTX);
    reflectProjectile(p, SHOT, s.fighters[1], REFLECTOR);
    expect(p.vy).toBe(fx(1));
  });

  // The Cape's "Lifetime multiplier 0.75": SmashWiki "Mario (SSBU)/Side special"
  // (https://www.ssbwiki.com/Mario_(SSBU)/Side_special), and "Reflection"'s table.
  it("renews a lifetime multiplier below one as that share of the whole (Cape: 0.75)", () => {
    const p = shotAt(fx(15));
    const s = createInitialState("s", [{ defId: "t" }, { defId: "t" }], RULES, 1, CTX);
    reflectProjectile(p, SHOT, s.fighters[1], { ...REFLECTOR, lifetime: fx(0.75) });
    expect(p.age).toBe(10);
  });
});

describe("reflectProjectiles", () => {
  it("reflects a reflectable projectile that reaches the bubble, and the candidate does not hit", () => {
    const { s, c, events } = scene(shotAt(fx(15)));
    expect(c.suppressed).toBe(true);
    expect(s.projectiles[0].owner).toBe(1);
    expect(events.reflects).toEqual([{ port: 1, x: fx(15), y: fx(6) }]);
    expect(s.fighters[1].combat.reflectHold).toBe(20);
  });

  // SmashWiki "Fox (SSBU)/Down special": "Damage threshold 50%"; "Reflection":
  // past it, "the projectile simply ignores the reflector and hits the user".
  it("lets a projectile past the damage threshold through (SmashWiki: 50%)", () => {
    const { c, s } = scene(shotAt(fx(15)), fx(51));
    expect(c.suppressed).toBe(false);
    expect(s.projectiles[0].owner).toBe(0);
  });

  it("reflects one of exactly the threshold", () => {
    expect(scene(shotAt(fx(15)), fx(50)).c.suppressed).toBe(true);
    expect(scene(shotAt(fx(15)), fx(50) + 1).c.suppressed).toBe(false);
  });

  it("deletes a projectile that has already been reflected seven times", () => {
    const { c, destroyed } = scene(shotAt(fx(15), { reflected: MAX_REFLECTIONS }));
    expect(c.suppressed).toBe(true);
    expect(destroyed.has(1)).toBe(true);
  });

  it("never reflects its owner's own projectile", () => {
    const { c } = scene(shotAt(fx(15), { owner: 1 }));
    expect(c.suppressed).toBe(false);
  });
});
