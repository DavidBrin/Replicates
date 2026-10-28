import { describe, expect, it } from "vitest";

import { fx } from "../fixed";
import { emptyKinetic } from "../kinetic";
import { advanceFighter } from "../states";
import type { Intent, StateContext } from "../states";
import type { ActionState, FighterDef, FighterState } from "../types";
import {
  ACTION_OF_STATUS_KIND,
  STATUS_KIND_OF_ACTION,
  changeStatus,
  registerStatus,
  statusKindOf,
} from "./kind";
import type { FighterStatus, StatusTable } from "./kind";

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

const CTX = { def: {} as FighterDef, stage: { platforms: [] }, frame: 1, fighters: [] } as unknown as StateContext;

describe("the status alias table", () => {
  it("names an SSBU-style kind for every replica action, one-to-one", () => {
    const actions = Object.keys(STATUS_KIND_OF_ACTION) as ActionState[];
    expect(actions).toHaveLength(42);
    const kinds = new Set(actions.map((a) => STATUS_KIND_OF_ACTION[a]));
    expect(kinds.size).toBe(actions.length);
    for (const a of actions) expect(ACTION_OF_STATUS_KIND[STATUS_KIND_OF_ACTION[a]]).toBe(a);
  });

  it("uses skyline-smash names where the game has the status", () => {
    // ultimate-research/skyline-smash src/lua_const.rs
    expect(statusKindOf({ action: "stand" })).toBe("FIGHTER_STATUS_KIND_WAIT");
    expect(statusKindOf({ action: "jumpSquat" })).toBe("FIGHTER_STATUS_KIND_JUMP_SQUAT");
    expect(statusKindOf({ action: "ledgeHang" })).toBe("FIGHTER_STATUS_KIND_CLIFF_WAIT");
    expect(statusKindOf({ action: "airDodge" })).toBe("FIGHTER_STATUS_KIND_ESCAPE_AIR");
  });
});

describe("changeStatus", () => {
  function spy(action: ActionState, log: string[]): FighterStatus {
    return {
      kind: STATUS_KIND_OF_ACTION[action],
      action,
      kineticType: "GROUND_STOP",
      pre: () => log.push(`pre:${action}`),
      main: () => log.push(`main:${action}`),
      end: () => log.push(`end:${action}`),
    };
  }

  it("runs the old status's end, then the new status's pre, once each", () => {
    const log: string[] = [];
    const table: StatusTable = { stand: spy("stand", log), walk: spy("walk", log) };
    const f = fighter({ action: "stand", actionFrame: 9 });
    changeStatus(f, "walk", table);
    expect(log).toEqual(["end:stand", "pre:walk"]);
    expect(f.action).toBe("walk");
    expect(f.actionFrame).toBe(0);
  });

  it("re-enters a status it is already in, as a dash-dance does", () => {
    const log: string[] = [];
    const f = fighter({ action: "walk" });
    changeStatus(f, "walk", { walk: spy("walk", log) });
    expect(log).toEqual(["end:walk", "pre:walk"]);
  });

  it("keeps the move for attack-like statuses and clears it for the rest", () => {
    const keep = fighter({ action: "attack", move: "jab1", charge: 3 });
    changeStatus(keep, "attack", {});
    expect([keep.move, keep.charge]).toEqual(["jab1", 3]);
    const drop = fighter({ action: "attack", move: "jab1", charge: 3 });
    changeStatus(drop, "stand", {});
    expect([drop.move, drop.charge]).toEqual([null, 0]);
  });
});

describe("advanceFighter dispatch", () => {
  it("fails loudly for a status nobody registered", () => {
    // This file never imports `status/index.ts`, so nothing but the test's own
    // registration below exists here.
    const f = fighter({ action: "crouch" });
    expect(() => advanceFighter(f, {} as Intent, CTX)).toThrow(/no status registered for "crouch"/);
  });

  it("runs a registered status's main instead of the legacy switch", () => {
    const seen: number[] = [];
    registerStatus({
      kind: "FIGHTER_STATUS_KIND_ENTRY",
      action: "entering",
      kineticType: "FALL",
      main: (f) => seen.push(f.actionFrame),
    });
    const f = fighter({ action: "entering", actionFrame: 0 });
    advanceFighter(f, {} as Intent, CTX);
    advanceFighter(f, {} as Intent, CTX);
    expect(seen).toEqual([1, 2]);
  });
});
