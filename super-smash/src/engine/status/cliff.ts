/**
 * Ledge statuses: CLIFF_WAIT, CLIFF_CLIMB, CLIFF_ATTACK, CLIFF_ESCAPE,
 * CLIFF_JUMP1 (Plan 2, Task 9).
 *
 * `main` bodies are the legacy `advanceFighter` cases, moved verbatim. The
 * four ledge options share one `main`, parameterised by their length, as the
 * legacy switch did.
 */

import { LEDGE_REGRAB_LIMIT } from "../constants";
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
      startAction(f, "fall");
      return;
    }
    // Six grabs and the game stops letting you hang.
    if (f.ledgeRegrabs > LEDGE_REGRAB_LIMIT) startAction(f, "ledgeGetUp");
  },
};

function ledgeOption(total: number) {
  return (f: FighterState, intent: Intent, ctx: StateContext): void => {
    if (f.actionFrame < total) {
      bufferPress(f, intent, ctx.frame);
      return;
    }
    finishLedgeOption(f, ctx);
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

export const CLIFF_STATUSES: readonly FighterStatus[] = [
  STATUS_CLIFF_WAIT,
  STATUS_CLIFF_CLIMB,
  STATUS_CLIFF_ATTACK,
  STATUS_CLIFF_ESCAPE,
  STATUS_CLIFF_JUMP1,
];
