import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { fx } from "./fixed";
import { hashState, mixBool, mixInt, mixString } from "./hash";
import type { FighterState, GameState, ProjectileState } from "./types";

function fighter(over: Partial<FighterState> = {}): FighterState {
  return {
    port: 0,
    defId: "mario",
    costume: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: true,
    platform: 0,
    action: "stand",
    actionFrame: 0,
    move: null,
    charge: 0,
    damage: 0,
    stocks: 3,
    jumpsUsed: 0,
    airDodged: false,
    fastFalling: false,
    shortHop: false,
    shieldHealth: fx(50),
    hitstun: 0,
    hitlag: 0,
    launchSpeed: 0,
    pendingKnockback: 0,
    pendingAngle: 0,
    pendingFacing: 0,
    balloon: false,
    intangible: 0,
    invincible: 0,
    grabbedBy: -1,
    grabbing: -1,
    grabTimer: 0,
    ledge: null,
    ledgeRegrabs: 0,
    airTime: 0,
    finalSmashReady: 0,
    staleQueue: [],
    hitThisMove: [],
    framesSinceDirPress: 999,
    lastDirPressed: 0,
    bufferedAction: null,
    ...over,
  };
}

function projectile(over: Partial<ProjectileState> = {}): ProjectileState {
  return {
    instanceId: 1,
    defId: "arrow",
    owner: 0,
    x: fx(10),
    y: fx(6),
    vx: fx(4),
    vy: 0,
    facing: 1,
    age: 3,
    bouncesLeft: 0,
    chargeScale: fx(1),
    hitPorts: [],
    returning: false,
    ...over,
  };
}

function state(over: Partial<GameState> = {}): GameState {
  return {
    frame: 0,
    rngSeed: 12345,
    fighters: [fighter({ port: 0 }), fighter({ port: 1, x: fx(20) })],
    stageId: "battlefield",
    projectiles: [],
    nextProjectileId: 1,
    rules: { mode: "stock", stocks: 3, timeLimit: 0, smashBall: true, oneOnOne: true },
    smashBall: { active: false, x: 0, y: 0, vx: 0, vy: 0, health: 0, driftTimer: 0 },
    timeRemaining: 0,
    outcome: null,
    freezeFrames: 0,
    ...over,
  };
}

/** Change one field on a deep-ish copy and report whether the hash noticed. */
function noticesChange(mutate: (s: GameState) => void): boolean {
  const a = state();
  const before = hashState(a);
  mutate(a);
  return hashState(a) !== before;
}

describe("mixers", () => {
  it("produces a 32-bit unsigned result", () => {
    fc.assert(
      fc.property(fc.integer(), (v) => {
        const h = mixInt(0x811c9dc5, v);
        return Number.isInteger(h) && h >= 0 && h <= 0xffffffff;
      }),
    );
  });

  it("distinguishes false from absent", () => {
    expect(mixBool(0, false)).not.toBe(mixBool(0, true));
    expect(mixBool(0, false)).not.toBe(mixInt(0, 0));
  });

  it("is sensitive to string order and length", () => {
    expect(mixString(0, "ab")).not.toBe(mixString(0, "ba"));
    expect(mixString(0, "a")).not.toBe(mixString(0, "aa"));
  });
});

describe("hashState", () => {
  it("is stable for an unchanged state", () => {
    const s = state();
    expect(hashState(s)).toBe(hashState(s));
    expect(hashState(state())).toBe(hashState(state()));
  });

  it("returns a 32-bit unsigned integer", () => {
    const h = hashState(state());
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  /**
   * The point of the whole file. A field the hash cannot see is a class of
   * desync that reads as a clean bill of health, so every branchable field gets
   * its own case here rather than a spot check.
   */
  it("notices a change to every simulation-relevant field", () => {
    const mutations: [string, (s: GameState) => void][] = [
      ["frame", (s) => (s.frame += 1)],
      ["rngSeed", (s) => (s.rngSeed += 1)],
      ["stageId", (s) => (s.stageId = "final-destination")],
      ["timeRemaining", (s) => (s.timeRemaining += 1)],
      ["freezeFrames", (s) => (s.freezeFrames += 1)],
      ["nextProjectileId", (s) => (s.nextProjectileId += 1)],
      ["rules.mode", (s) => (s.rules = { ...s.rules, mode: "time" })],
      ["rules.stocks", (s) => (s.rules = { ...s.rules, stocks: 2 })],
      ["rules.smashBall", (s) => (s.rules = { ...s.rules, smashBall: false })],
      ["rules.oneOnOne", (s) => (s.rules = { ...s.rules, oneOnOne: false })],
      ["outcome", (s) => (s.outcome = { kind: "timeUp", placings: [1, 0] })],
      ["smashBall.active", (s) => (s.smashBall.active = true)],
      ["smashBall.x", (s) => (s.smashBall.x += 1)],
      ["smashBall.health", (s) => (s.smashBall.health += 1)],
      ["smashBall.driftTimer", (s) => (s.smashBall.driftTimer += 1)],
      ["fighter.defId", (s) => (s.fighters[0].defId = "fox")],
      ["fighter.costume", (s) => (s.fighters[0].costume = 2)],
      ["fighter.x", (s) => (s.fighters[0].x += 1)],
      ["fighter.y", (s) => (s.fighters[0].y += 1)],
      ["fighter.vx", (s) => (s.fighters[0].vx += 1)],
      ["fighter.vy", (s) => (s.fighters[0].vy += 1)],
      ["fighter.facing", (s) => (s.fighters[0].facing = -1)],
      ["fighter.grounded", (s) => (s.fighters[0].grounded = false)],
      ["fighter.platform", (s) => (s.fighters[0].platform = 1)],
      ["fighter.action", (s) => (s.fighters[0].action = "run")],
      ["fighter.actionFrame", (s) => (s.fighters[0].actionFrame += 1)],
      ["fighter.move", (s) => (s.fighters[0].move = "fair")],
      ["fighter.charge", (s) => (s.fighters[0].charge += 1)],
      ["fighter.damage", (s) => (s.fighters[0].damage += 1)],
      ["fighter.stocks", (s) => (s.fighters[0].stocks -= 1)],
      ["fighter.jumpsUsed", (s) => (s.fighters[0].jumpsUsed += 1)],
      ["fighter.airDodged", (s) => (s.fighters[0].airDodged = true)],
      ["fighter.fastFalling", (s) => (s.fighters[0].fastFalling = true)],
      ["fighter.shortHop", (s) => (s.fighters[0].shortHop = true)],
      ["fighter.shieldHealth", (s) => (s.fighters[0].shieldHealth -= 1)],
      ["fighter.hitstun", (s) => (s.fighters[0].hitstun += 1)],
      ["fighter.hitlag", (s) => (s.fighters[0].hitlag += 1)],
      ["fighter.launchSpeed", (s) => (s.fighters[0].launchSpeed += 1)],
      ["fighter.pendingKnockback", (s) => (s.fighters[0].pendingKnockback += 1)],
      ["fighter.pendingAngle", (s) => (s.fighters[0].pendingAngle += 1)],
      ["fighter.pendingFacing", (s) => (s.fighters[0].pendingFacing = -1)],
      ["fighter.intangible", (s) => (s.fighters[0].intangible += 1)],
      ["fighter.invincible", (s) => (s.fighters[0].invincible += 1)],
      ["fighter.grabbedBy", (s) => (s.fighters[0].grabbedBy = 1)],
      ["fighter.grabbing", (s) => (s.fighters[0].grabbing = 1)],
      ["fighter.grabTimer", (s) => (s.fighters[0].grabTimer += 1)],
      ["fighter.ledge", (s) => (s.fighters[0].ledge = { platform: 0, side: -1 })],
      ["fighter.ledgeRegrabs", (s) => (s.fighters[0].ledgeRegrabs += 1)],
      ["fighter.airTime", (s) => (s.fighters[0].airTime += 1)],
      ["fighter.finalSmashReady", (s) => (s.fighters[0].finalSmashReady += 1)],
      ["fighter.staleQueue", (s) => s.fighters[0].staleQueue.push("jab1")],
      ["fighter.hitThisMove", (s) => s.fighters[0].hitThisMove.push(1)],
      ["fighter.framesSinceDirPress", (s) => (s.fighters[0].framesSinceDirPress = 2)],
      ["fighter.lastDirPressed", (s) => (s.fighters[0].lastDirPressed = 2)],
      ["fighter.bufferedAction", (s) => (s.fighters[0].bufferedAction = { kind: "jump", frame: 3 })],
      ["projectiles", (s) => s.projectiles.push(projectile())],
    ];
    for (const [name, mutate] of mutations) {
      expect(noticesChange(mutate), `hash ignored ${name}`).toBe(true);
    }
  });

  it("notices a change to every projectile field", () => {
    const withProjectile = (over: Partial<ProjectileState>) =>
      hashState(state({ projectiles: [projectile(over)] }));
    const base = withProjectile({});
    expect(withProjectile({ instanceId: 2 })).not.toBe(base);
    expect(withProjectile({ defId: "bomb" })).not.toBe(base);
    expect(withProjectile({ owner: 1 })).not.toBe(base);
    expect(withProjectile({ x: fx(11) })).not.toBe(base);
    expect(withProjectile({ y: fx(7) })).not.toBe(base);
    expect(withProjectile({ vx: fx(5) })).not.toBe(base);
    expect(withProjectile({ vy: fx(1) })).not.toBe(base);
    expect(withProjectile({ facing: -1 })).not.toBe(base);
    expect(withProjectile({ age: 4 })).not.toBe(base);
    expect(withProjectile({ bouncesLeft: 1 })).not.toBe(base);
    expect(withProjectile({ chargeScale: fx(2) })).not.toBe(base);
    expect(withProjectile({ hitPorts: [1] })).not.toBe(base);
    expect(withProjectile({ returning: true })).not.toBe(base);
  });

  it("distinguishes two fighters swapped between ports", () => {
    const a = state();
    a.fighters[0].damage = fx(50);
    const b = state();
    b.fighters[1].damage = fx(50);
    expect(hashState(a)).not.toBe(hashState(b));
  });

  it("distinguishes a differently ordered stale queue", () => {
    const a = state();
    a.fighters[0].staleQueue = ["jab1", "fair"];
    const b = state();
    b.fighters[0].staleQueue = ["fair", "jab1"];
    expect(hashState(a)).not.toBe(hashState(b));
  });

  it("distinguishes a null move from a move named nothing-like", () => {
    const a = state();
    const b = state();
    b.fighters[0].move = "jab1";
    expect(hashState(a)).not.toBe(hashState(b));
  });

  it("does not depend on how many fighters happen to share a value", () => {
    const two = state();
    const one = state({ fighters: [fighter()] });
    expect(hashState(two)).not.toBe(hashState(one));
  });
});
