/**
 * Reeling statuses: DAMAGE, DAMAGE_FLY, DOWN_WAIT, DOWN_STAND (Plan 2, Task 6).
 *
 * `main` bodies are the legacy `advanceFighter` cases, moved verbatim.
 */

import {
  HITSTUN_CANCEL_AERIAL_FRAME,
  HITSTUN_CANCEL_AERIAL_SPEED,
  HITSTUN_CANCEL_AIR_DODGE_FRAME,
  HITSTUN_CANCEL_AIR_DODGE_SPEED,
  TUMBLE_HITSTUN,
} from "../constants";
import {
  DOWNED_FRAMES,
  GETUP_FRAMES,
  aerialSlot,
  bufferPress,
  hasMove,
  peekBuffer,
  startAction,
  startAirDodge,
  startMove,
} from "../states";
import type { Intent, StateContext } from "../states";
import type { FighterState } from "../types";
import type { FighterStatus } from "./kind";

/**
 * Hitstun cancel (Plan 3, Task 7): late in a slowing launch an airborne victim
 * may air dodge (from frame 41, launch slower than 2.5) or attack (from frame
 * 46, slower than 2) before hitstun runs out. SmashWiki "Hitstun canceling";
 * rubendal `parameters.hitstunCancel`. `actionFrame` counts real frames since
 * the hit's freeze ended, which is how both sources count them: the windows
 * "do not account for the speed-up" (SmashWiki "Hitstun").
 *
 * Only a *press* (fresh or buffered) cancels: a shield held for a ground tech
 * (Task 12) must not spend the air dodge. A fighter whose air dodge is spent
 * stays in hitstun — nothing is cleared before the dodge is known to start.
 * A buffered press is spent only by the cancel it fires.
 */
function hitstunCancel(f: FighterState, intent: Intent, ctx: StateContext): boolean {
  if (f.grounded) return false;
  const dodge = f.actionFrame >= HITSTUN_CANCEL_AIR_DODGE_FRAME && f.launchSpeed < HITSTUN_CANCEL_AIR_DODGE_SPEED;
  const aerial = f.actionFrame >= HITSTUN_CANCEL_AERIAL_FRAME && f.launchSpeed < HITSTUN_CANCEL_AERIAL_SPEED;
  if (!dodge && !aerial) return false;
  const buffered = peekBuffer(f, ctx.frame);
  if (dodge && !f.airDodged && (intent.shieldPressed || buffered === "shield")) {
    if (buffered === "shield") f.bufferedAction = null;
    f.hitstun = 0;
    f.balloon = false;
    return startAirDodge(f, intent);
  }
  if (aerial && (intent.attackPressed || buffered === "attack")) {
    const slot = aerialSlot(f, intent);
    if (!hasMove(ctx, slot)) return false;
    if (buffered === "attack") f.bufferedAction = null;
    f.hitstun = 0;
    f.balloon = false;
    startMove(f, "attack", slot);
    return true;
  }
  return false;
}

/** Shared by DAMAGE and DAMAGE_FLY: tumble is hitstun of `TUMBLE_HITSTUN` frames or more, not a different thing. */
function reelMain(f: FighterState, intent: Intent, ctx: StateContext): void {
  if (f.hitstun > 0) {
    if (hitstunCancel(f, intent, ctx)) return;
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
