/**
 * Ledge statuses: CLIFF_WAIT, CLIFF_CLIMB, CLIFF_ATTACK, CLIFF_ESCAPE,
 * CLIFF_JUMP1 (Plan 2, Task 9) and CLIFF_ROBBED (Plan 3, Task 15).
 *
 * `main` bodies are the legacy `advanceFighter` cases, moved verbatim. The
 * four ledge options share one `main`, parameterised by their length, as the
 * cases did when `advanceFighter` was one switch.
 */

import { LEDGE_REGRAB_LIMIT, LEDGE_REGRAB_LOCKOUT_FRAMES, LEDGE_TRUMPED_FRAMES } from "../constants";
import {
  LEDGE_ATTACK_FRAMES,
  LEDGE_GETUP_FRAMES,
  LEDGE_HANG_MIN,
  LEDGE_JUMP_FRAMES,
  LEDGE_ROLL_FRAMES,
  bufferPress,
  finishLedgeOption,
  presses,
  startAction,
} from "../states";
import type { Intent, StateContext } from "../states";
import type { FighterState } from "../types";
import type { FighterStatus } from "./kind";

export const STATUS_CLIFF_WAIT: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_CLIFF_WAIT",
  action: "ledgeHang",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (f.actionFrame < LEDGE_HANG_MIN) return;
    const p = presses(f, intent, ctx.frame);
    const inward = f.ledge !== null ? -f.ledge.side : f.facing;
    if (p.jump) {
      startAction(f, "ledgeJump");
      return;
    }
    if (p.attack) {
      startAction(f, "ledgeAttack");
      return;
    }
    if (intent.shieldHeld) {
      startAction(f, "ledgeRoll");
      return;
    }
    if (intent.y > 0 || intent.x === inward) {
      startAction(f, "ledgeGetUp");
      return;
    }
    if (intent.y < 0 || intent.x === -inward) {
      f.ledge = null;
      f.intangible = 0;
      // Letting go is not an invitation to take the ledge straight back.
      f.ledgeLockout = LEDGE_REGRAB_LOCKOUT_FRAMES;
      startAction(f, "fall");
      return;
    }
    // Six grabs and the game stops letting you hang: you get up whether you
    // like it or not, which is what makes ledge-stalling a losing plan.
    if (f.ledgeRegrabs > LEDGE_REGRAB_LIMIT) startAction(f, "ledgeGetUp");
  },
};

function ledgeOption(total: number) {
  return (f: FighterState, intent: Intent, ctx: StateContext): void => {
    if (f.actionFrame < total) {
      bufferPress(f, intent, ctx.frame);
      return;
    }
    finishLedgeOption(f, intent, ctx);
  };
}

export const STATUS_CLIFF_CLIMB: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_CLIFF_CLIMB",
  action: "ledgeGetUp",
  kineticType: "GROUND_STOP",
  main: ledgeOption(LEDGE_GETUP_FRAMES),
};

export const STATUS_CLIFF_ATTACK: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_CLIFF_ATTACK",
  action: "ledgeAttack",
  kineticType: "GROUND_STOP",
  main: ledgeOption(LEDGE_ATTACK_FRAMES),
};

export const STATUS_CLIFF_ESCAPE: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_CLIFF_ESCAPE",
  action: "ledgeRoll",
  kineticType: "GROUND_STOP",
  main: ledgeOption(LEDGE_ROLL_FRAMES),
};

export const STATUS_CLIFF_JUMP1: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_CLIFF_JUMP1",
  action: "ledgeJump",
  kineticType: "GROUND_STOP",
  main: ledgeOption(LEDGE_JUMP_FRAMES),
};

/**
 * CLIFF_ROBBED (Plan 3, Task 15): the ledge was taken from under this fighter
 * (`trumpLedge`). It falls, with no say in where, and may not act until the lag
 * is over: no `handleActionable`, no buffering, and no ledge (`ledgeLockout`,
 * set for the same length). GROUND_STOP in the air is exactly that: gravity, air
 * friction, no air control.
 */
export const STATUS_CLIFF_ROBBED: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_CLIFF_ROBBED",
  action: "ledgeTrumped",
  kineticType: "GROUND_STOP",
  main(f) {
    if (f.actionFrame >= LEDGE_TRUMPED_FRAMES) startAction(f, "fall");
  },
};

export const CLIFF_STATUSES: readonly FighterStatus[] = [
  STATUS_CLIFF_WAIT,
  STATUS_CLIFF_CLIMB,
  STATUS_CLIFF_ATTACK,
  STATUS_CLIFF_ESCAPE,
  STATUS_CLIFF_JUMP1,
  STATUS_CLIFF_ROBBED,
];
