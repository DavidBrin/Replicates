import { describe, expect, it } from "vitest";

import { RESPAWN_INVINCIBILITY_MAX } from "../constants";
import { fx } from "../fixed";
import { emptyKinetic } from "../kinetic";
import type { KineticType } from "../kinetic";
import { DEAD_FRAMES, advanceFighter } from "../states";
import type { Intent, StateContext } from "../states";
import type { ActionState, FighterState, StageDef } from "../types";
import { ALL_STATUSES } from "./index";
import { STATUS_KIND_OF_ACTION, STATUS_TABLE, changeStatus } from "./kind";

function fighter(over: Partial<FighterState> = {}): FighterState {
  return {
    port: 0,
    defId: "t",
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
    ledgeLockout: 0,
    airTime: 0,
    finalSmashReady: 0,
    staleQueue: [],
    hitThisMove: [],
    framesSinceDirPress: 999,
    lastDirPressed: 0,
    bufferedAction: null,
    kinetic: emptyKinetic(),
    ...over,
  };
}

/** The pre-Plan-2 `applyMovement` switch, as a table: what every status must still declare. */
const LEGACY_KINETIC: Readonly<Record<ActionState, KineticType>> = {
  stand: "GROUND_STOP",
  walk: "WALK",
  dashStart: "DASH",
  run: "RUN",
  runBrake: "GROUND_STOP",
  turnaround: "GROUND_STOP",
  crouchStart: "GROUND_STOP",
  crouch: "GROUND_STOP",
  crouchEnd: "GROUND_STOP",
  jumpSquat: "GROUND_STOP",
  jump: "FALL",
  fall: "FALL",
  land: "GROUND_STOP",
  landingLag: "GROUND_STOP",
  attack: "FALL",
  special: "FALL",
  grab: "FALL",
  grabHold: "FALL",
  pummel: "FALL",
  throw: "FALL",
  shieldStart: "GROUND_STOP",
  shield: "GROUND_STOP",
  shieldRelease: "GROUND_STOP",
  shieldStun: "GROUND_STOP",
  shieldBroken: "GROUND_STOP",
  spotDodge: "GROUND_STOP",
  roll: "MOTION",
  airDodge: "AIR_ESCAPE",
  hitstun: "GROUND_STOP",
  tumble: "GROUND_STOP",
  grabbed: "GROUND_STOP",
  thrown: "GROUND_STOP",
  downed: "GROUND_STOP",
  getUp: "GROUND_STOP",
  ledgeHang: "GROUND_STOP",
  ledgeGetUp: "GROUND_STOP",
  ledgeAttack: "GROUND_STOP",
  ledgeRoll: "GROUND_STOP",
  ledgeJump: "GROUND_STOP",
  respawnPlatform: "NONE",
  dead: "NONE",
  entering: "FALL",
};

/** Every action migrated so far; each status-group task extends this list first. */
const MIGRATED = [
  // Task 6
  "entering",
  "dead",
  "respawnPlatform",
  "hitstun",
  "tumble",
  "downed",
  "getUp",
  // Task 7
  "shieldStart",
  "shield",
  "shieldRelease",
  "shieldStun",
  "shieldBroken",
  "spotDodge",
  "roll",
  "airDodge",
  // Task 8
  "attack",
  "special",
  "grab",
  "grabHold",
  "pummel",
  "throw",
  "grabbed",
  "thrown",
  // Task 9
  "ledgeHang",
  "ledgeGetUp",
  "ledgeAttack",
  "ledgeRoll",
  "ledgeJump",
  // Task 10
  "stand",
  "walk",
  "dashStart",
  "run",
  "runBrake",
  "turnaround",
  "crouchStart",
  "crouch",
  "crouchEnd",
  // Task 11
  "jumpSquat",
  "jump",
  "fall",
  "land",
  "landingLag",
];

describe("migrated statuses", () => {
  it("are exactly the groups migrated so far", () => {
    expect(ALL_STATUSES.map((s) => s.action).sort()).toEqual([...MIGRATED].sort());
  });

  it("are registered under their own action", () => {
    for (const s of ALL_STATUSES) expect(STATUS_TABLE[s.action]).toBe(s);
  });

  it("carry the SSBU kind the alias table names, and the legacy kinetic type", () => {
    for (const s of ALL_STATUSES) {
      expect(s.kind, s.action).toBe(STATUS_KIND_OF_ACTION[s.action]);
      expect(s.kineticType, s.action).toBe(LEGACY_KINETIC[s.action]);
    }
  });

  it("cover every action the engine has, so the legacy switch is gone for good", () => {
    expect(ALL_STATUSES.map((s) => s.action).sort()).toEqual((Object.keys(STATUS_KIND_OF_ACTION) as string[]).sort());
  });

  it("are each registered once", () => {
    const actions = ALL_STATUSES.map((s) => s.action);
    expect(new Set(actions).size).toBe(actions.length);
  });
});

describe("REBIRTH", () => {
  it("grants the full respawn invincibility on entry, in pre", () => {
    const f = fighter({ action: "dead", invincible: 0 });
    changeStatus(f, "respawnPlatform");
    expect(f.invincible).toBe(RESPAWN_INVINCIBILITY_MAX);
  });
});

describe("DEAD", () => {
  const SPAWN = { x: fx(-30), y: fx(40) };
  const CTX = { def: {}, stage: { spawns: [SPAWN] } as unknown as StageDef, frame: 1, fighters: [] } as unknown as StateContext;
  const NEUTRAL = { x: 0, y: 0 } as Intent;

  it("respawns a fighter with stocks left onto the platform, invincible, once its frames are up", () => {
    const f = fighter({ action: "dead", actionFrame: DEAD_FRAMES - 2, stocks: 2, grounded: true, jumpsUsed: 2 });
    advanceFighter(f, NEUTRAL, CTX);
    expect([f.action, f.invincible]).toEqual(["dead", 0]);
    advanceFighter(f, NEUTRAL, CTX);
    expect(f).toMatchObject({ action: "respawnPlatform", invincible: RESPAWN_INVINCIBILITY_MAX, x: SPAWN.x, y: SPAWN.y });
    expect(f).toMatchObject({ grounded: false, platform: -1, jumpsUsed: 1, vx: 0, vy: 0 });
  });

  it("never respawns a fighter with no stocks left", () => {
    const f = fighter({ action: "dead", actionFrame: DEAD_FRAMES + 5, stocks: 0 });
    advanceFighter(f, NEUTRAL, CTX);
    expect([f.action, f.invincible]).toEqual(["dead", 0]);
  });
});

describe("ESCAPE_F (the roll)", () => {
  // The roll's stop is in `main`, not `end`, on purpose: `end` also runs when a
  // hit interrupts the roll, and zeroing `vx` there changed what the CPU read
  // during hitlag (guard.ts). This pins it, so an `end` cannot creep back in.
  it("has no end", () => {
    expect(STATUS_TABLE.roll?.end).toBeUndefined();
  });
});

describe("swinging statuses", () => {
  it.each(["attack", "special", "grab", "pummel", "throw"] as const)(
    "%s resets the one-swing-one-hit record in pre",
    (action) => {
      const f = fighter({ action: "stand", hitThisMove: [1, 8] });
      changeStatus(f, action);
      expect(f.hitThisMove).toEqual([]);
    },
  );

  it("leaves the record alone when the hold resumes after a pummel", () => {
    const f = fighter({ action: "pummel", hitThisMove: [1] });
    changeStatus(f, "grabHold");
    expect(f.hitThisMove).toEqual([1]);
  });
});
