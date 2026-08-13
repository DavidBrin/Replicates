/**
 * Minimal simulation objects for the renderer's tests.
 *
 * Deliberately built here rather than imported from `fighters/` or `stages/`:
 * the renderer is written against the *shapes* in `engine/types.ts`, not against
 * any particular roster, and a test that imported the real Mario would fail when
 * somebody rebalanced him. The geometry below is Battlefield's from SPEC §8
 * because using real numbers catches sign errors that a 10×10 test stage would
 * not.
 */

import { ONE, fx } from "@/engine/fixed";
import type {
  FighterDef,
  FighterState,
  GameState,
  MatchRules,
  ProjectileDef,
  ProjectileState,
  StageDef,
  StepEvents,
} from "@/engine/types";
import { emptyEvents } from "@/engine/types";
import { createCamera } from "./camera";
import type { FxContext } from "./fxKit";

export function makeFighter(over: Partial<FighterState> = {}): FighterState {
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
    framesSinceDirPress: 99,
    lastDirPressed: 0,
    bufferedAction: null,
    ...over,
  };
}

export const TEST_RULES: MatchRules = {
  mode: "stock",
  stocks: 3,
  timeLimit: 60 * 60 * 3,
  smashBall: true,
  oneOnOne: true,
};

export function makeState(over: Partial<GameState> = {}): GameState {
  return {
    frame: 0,
    rngSeed: 1,
    fighters: [makeFighter({ port: 0 }), makeFighter({ port: 1, x: fx(40) })],
    stageId: "battlefield",
    rules: TEST_RULES,
    smashBall: { active: false, x: 0, y: fx(60), vx: 0, vy: 0, health: fx(40), driftTimer: 0 },
    projectiles: [],
    nextProjectileId: 1,
    timeRemaining: 60 * 60 * 3,
    outcome: null,
    freezeFrames: 0,
    ...over,
  };
}

export function makeProjectile(over: Partial<ProjectileState> = {}): ProjectileState {
  return {
    instanceId: 1,
    defId: "arrow",
    owner: 0,
    x: fx(20),
    y: fx(12),
    vx: fx(3),
    vy: 0,
    facing: 1,
    age: 4,
    bouncesLeft: 0,
    chargeScale: ONE,
    hitPorts: [],
    returning: false,
    ...over,
  };
}

export function makeProjectileDef(over: Partial<ProjectileDef> = {}): ProjectileDef {
  return {
    id: "arrow",
    spawnFrame: 12,
    offsetX: fx(6),
    offsetY: fx(7),
    vx: fx(3),
    vy: 0,
    gravity: 0,
    lifetime: 60,
    hitbox: {
      id: 0,
      startFrame: 0,
      endFrame: 60,
      x: 0,
      y: 0,
      radius: fx(2),
      damage: fx(4),
      angle: fx(361),
      baseKnockback: fx(20),
      knockbackGrowth: fx(40),
    },
    destroyOnHit: true,
    visual: "arrow",
    ...over,
  };
}

/** Battlefield, to the measurements in SPEC §8. */
export function makeStage(over: Partial<StageDef> = {}): StageDef {
  return {
    id: "battlefield",
    name: "Battlefield",
    series: "Super Smash Bros.",
    platforms: [
      { x: 0, y: 0, halfWidth: fx(79.99), soft: false, ledges: true },
      { x: fx(-57.6), y: fx(27.2), halfWidth: fx(28.8), soft: true, ledges: false },
      { x: fx(57.6), y: fx(27.2), halfWidth: fx(28.8), soft: true, ledges: false },
      { x: 0, y: fx(54.4), halfWidth: fx(28.8), soft: true, ledges: false },
    ],
    blastZone: { left: fx(-240), right: fx(240), top: fx(192), bottom: fx(-140) },
    spawns: [
      { x: fx(-50), y: 0 },
      { x: fx(50), y: 0 },
      { x: fx(-20), y: fx(27.2) },
      { x: fx(20), y: fx(27.2) },
    ],
    theme: "battlefield",
    ...over,
  };
}

export function makeDef(over: Partial<FighterDef> = {}): FighterDef {
  return {
    id: "mario",
    name: "Mario",
    series: "Super Mario",
    number: 1,
    attributes: {
      weight: 98,
      walkSpeed: fx(1.1),
      initialDashSpeed: fx(1.76),
      runSpeed: fx(1.76),
      airSpeed: fx(1.15),
      airAccelBase: fx(0.01),
      airAccelAdditional: fx(0.06),
      gravity: fx(0.087),
      fallSpeed: fx(1.5),
      fastFallSpeed: fx(2.4),
      traction: fx(0.09),
      fullHopVelocity: fx(3.15),
      shortHopVelocity: fx(1.7),
      airJumpVelocity: fx(3.15),
      jumps: 2,
      canWallJump: true,
      width: fx(3),
      height: fx(12),
      jumpSquatFrames: 3,
    },
    moves: {
      jab1: { slot: "jab1", name: "Jab 1", totalFrames: 18, hitboxes: [] },
      fsmash: { slot: "fsmash", name: "Forward Smash", totalFrames: 44, hitboxes: [], chargeable: true },
    },
    palette: {
      primary: "#E03A2C",
      secondary: "#2B4CA8",
      accent: "#F2D14E",
      skin: "#F5C79A",
      outline: "#1A0E10",
      alts: [{ primary: "#2C7A3A", secondary: "#5A3A18", accent: "#F2D14E" }],
    },
    blurb: "The all-rounder every other fighter is read against.",
    ...over,
  };
}

export function makeEvents(over: Partial<StepEvents> = {}): StepEvents {
  return { ...emptyEvents(), ...over };
}

/**
 * A context to call one move effect with, without a match behind it.
 *
 * Every character's tests used to build this by hand as an object literal,
 * which meant that adding a field to `FxContext` broke six files that had no
 * interest in it. `over` is the field that forced the issue and it is also the
 * one a hand-built literal gets wrong in the worst way: an effect's deferred
 * paints have to go *somewhere*, and a test that supplied no sink would report
 * a move as painting nothing when the truth was that the test dropped it.
 *
 * The default runs deferred paints immediately, so a test that only counts
 * draw calls sees the whole effect. A test that cares which layer a paint
 * landed on passes its own `over` and drains it.
 */
export function makeFxContext(over: Partial<FxContext> & { ctx: CanvasRenderingContext2D }): FxContext {
  return {
    f: makeFighter(),
    def: makeDef(),
    cam: { ...createCamera(makeStage()), zoom: 12 },
    height: 13,
    x: 0,
    y: 0,
    u: 12,
    frame: 0,
    total: 30,
    t: 0,
    dir: 1,
    over: (paint) => paint(),
    ...over,
  };
}
