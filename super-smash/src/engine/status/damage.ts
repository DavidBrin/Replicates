/**
 * Reeling statuses: DAMAGE, DAMAGE_FLY, DOWN_WAIT, DOWN_STAND (Plan 2, Task 6).
 *
 * `main` bodies are the legacy `advanceFighter` cases, moved verbatim.
 */

import { TUMBLE_HITSTUN } from "../constants";
import { DOWNED_FRAMES, GETUP_FRAMES, bufferPress, startAction } from "../states";
import type { Intent, StateContext } from "../states";
import type { FighterState } from "../types";
import type { FighterStatus } from "./kind";

/** Shared by DAMAGE and DAMAGE_FLY: tumble is hitstun of `TUMBLE_HITSTUN` frames or more, not a different thing. */
function reelMain(f: FighterState, intent: Intent, ctx: StateContext): void {
  if (f.hitstun > 0) {
    if (f.hitstun >= TUMBLE_HITSTUN && f.action !== "tumble") startAction(f, "tumble");
    bufferPress(f, intent, ctx.frame);
    return;
  }
  startAction(f, f.grounded ? "stand" : "fall");
}

export const STATUS_DAMAGE: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_DAMAGE",
  action: "hitstun",
  kineticType: "GROUND_STOP",
  main: reelMain,
};

export const STATUS_DAMAGE_FLY: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_DAMAGE_FLY",
  action: "tumble",
  kineticType: "GROUND_STOP",
  main: reelMain,
};

export const STATUS_DOWN_WAIT: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_DOWN_WAIT",
  action: "downed",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (f.actionFrame >= DOWNED_FRAMES) startAction(f, "getUp");
    else bufferPress(f, intent, ctx.frame);
  },
};

export const STATUS_DOWN_STAND: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_DOWN_STAND",
  action: "getUp",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (f.actionFrame >= GETUP_FRAMES) startAction(f, "stand");
    else bufferPress(f, intent, ctx.frame);
  },
};

export const DAMAGE_STATUSES: readonly FighterStatus[] = [
  STATUS_DAMAGE,
  STATUS_DAMAGE_FLY,
  STATUS_DOWN_WAIT,
  STATUS_DOWN_STAND,
];
