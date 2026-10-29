/**
 * Reeling statuses: DAMAGE, DAMAGE_FLY, DAMAGE_FALL, DOWN_WAIT, DOWN_STAND
 * (Plan 2, Task 6; DAMAGE_FALL Plan 3, Task 12).
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
import { airMain } from "./air";
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
 * A buffered press is spent only by the cancel it fires. Near the floor the
 * press is still the air dodge, which techs the surface it meets in its first 15
 * frames (`techOrBounce`): a neutral one keeps the tumble's momentum and falls
 * into it (Plan 3, Task 20b), and one with a direction held is the directional
 * dodge, which reaches the floor or not by its own movement (Task 20c; SmashWiki
 * "Lucario (SSBU)/Techs": "when not in enough hitstun, holding the analog stick
 * in a direction while pressing shield/grab can turn into a directional air
 * dodge buffer, which can be a misinput").
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

/**
 * Shared by DAMAGE and DAMAGE_FLY: tumble is hitstun of `TUMBLE_HITSTUN` frames or more, not a different thing.
 *
 * A tumble whose hitstun runs out in the air keeps tumbling (`tumbleFall`,
 * SSBU's DAMAGE_FALL): it does not become a plain `fall`. A reel that never
 * tumbled still does.
 */
function reelMain(f: FighterState, intent: Intent, ctx: StateContext): void {
  if (f.hitstun > 0) {
    if (hitstunCancel(f, intent, ctx)) return;
    if (f.hitstun >= TUMBLE_HITSTUN && f.action !== "tumble") startAction(f, "tumble");
    bufferPress(f, intent, ctx.frame);
    return;
  }
  startAction(f, f.grounded ? "stand" : f.action === "tumble" ? "tumbleFall" : "fall");
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

/**
 * Tumbling after the hitstun (SSBU's DAMAGE_FALL, "DamageFall" in SmashWiki
 * "Tumbling", https://www.ssbwiki.com/Tumbling). The fighter is free to act as
 * in a fall: "They can move horizontally through the air as per normal", "They
 * can perform aerial attacks, use any remaining jumps, and use any special
 * moves, all of which end the tumbling state", air dodging "will end tumbling",
 * and "They can still grab ledges as usual" (`findLedgeGrab` asks only that
 * hitstun be over). So `main` is the fall's. Fast falling is the one thing the
 * page leaves open for Ultimate (it names only Smash 64 and Melee): UNVERIFIED,
 * kept as in a fall.
 *
 * What it does not do is land: it has no bounce, and "if tumbling characters
 * hit the ground without teching, they will land into a lying position"
 * (`onLanded`: `downed`, at any speed; `techOrBounce` for the tech). The
 * reimplementations of the vanilla `DamageFall_Main` agree: HewDraw Remix
 * `damagefall.rs` and WuBor Patch `damage_fall.rs` (cited in the Task 12 review).
 * A press of shield is an air dodge, which ends it, and techs a surface it meets
 * in its first 15 frames (`techOrBounce`). A neutral one keeps the tumble's
 * momentum and falls into it (`startAirDodge`; Plan 3, Task 20b); one with a
 * direction held is the directional dodge, which may not reach the floor in time:
 * the misinput SmashWiki "Lucario (SSBU)/Techs" warns of (Task 20c).
 */
export const STATUS_DAMAGE_FALL: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_DAMAGE_FALL",
  action: "tumbleFall",
  kineticType: "FALL",
  main(f, intent, ctx) {
    // Never grounded here: touching the floor ends it (`onLanded`, `techOrBounce`).
    if (f.grounded) {
      startAction(f, "downed");
      return;
    }
    airMain(f, intent, ctx);
  },
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
  STATUS_DAMAGE_FALL,
  STATUS_DOWN_WAIT,
  STATUS_DOWN_STAND,
];
