/**
 * Guard and escape statuses: GUARD_ON, GUARD, GUARD_OFF, GUARD_DAMAGE,
 * FURAFURA, ESCAPE, ESCAPE_F, ESCAPE_AIR (Plan 2, Task 7).
 *
 * `main` bodies are the legacy `advanceFighter` cases, moved verbatim.
 *
 * The roll's stop stays in `main` rather than moving to ESCAPE_F's `end`, on
 * purpose: `end` also runs when a hit interrupts the roll, which would zero
 * `vx` during the victim's hitlag. Nothing moves while frozen, but the CPU
 * reads `vx`, and the golden trace catches the difference.
 */

import {
  AIR_DODGE_FRAMES,
  DIRECTIONAL_AIR_DODGE_FRAMES,
  ROLL_FRAMES,
  SHIELD_MIN_HOLD,
  SHIELD_RELEASE_FRAMES,
  SPOT_DODGE_FRAMES,
} from "../constants";
import { kineticSetX } from "../kinetic";
import {
  ROLL_DISTANCE,
  SHIELD_START_FRAMES,
  bufferPress,
  hasMove,
  presses,
  startAction,
  startMove,
} from "../states";
import type { FighterStatus } from "./kind";

export const STATUS_GUARD_ON: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_GUARD_ON",
  action: "shieldStart",
  kineticType: "GROUND_STOP",
  main(f) {
    if (f.actionFrame >= SHIELD_START_FRAMES) startAction(f, "shield");
  },
};

export const STATUS_GUARD: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_GUARD",
  action: "shield",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    // The shield may not be dropped for its first 3 frames, which is what
    // makes a perfect shield a commitment rather than something you mash.
    if (!intent.shieldHeld && f.actionFrame >= SHIELD_MIN_HOLD) {
      startAction(f, "shieldRelease");
      return;
    }
    const p = presses(f, intent, ctx.frame);
    if (p.jump) {
      startAction(f, "jumpSquat");
      return;
    }
    if (p.grab) {
      startMove(f, "grab", "grab");
      return;
    }
    if (p.attack && hasMove(ctx, "usmash")) {
      startMove(f, "attack", "usmash");
      return;
    }
    if (intent.y < 0) {
      startAction(f, "spotDodge");
      return;
    }
    if (intent.x !== 0) {
      startAction(f, "roll");
      kineticSetX(f, intent.x * Math.trunc(ROLL_DISTANCE / ROLL_FRAMES), "stop");
    }
  },
};

export const STATUS_GUARD_OFF: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_GUARD_OFF",
  action: "shieldRelease",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (f.actionFrame >= SHIELD_RELEASE_FRAMES) startAction(f, "stand");
    else bufferPress(f, intent, ctx.frame);
  },
};

export const STATUS_GUARD_DAMAGE: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_GUARD_DAMAGE",
  action: "shieldStun",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    // Shieldstun reuses the `hitstun` counter: a shielding fighter is never
    // simultaneously in hitstun, and the alternative is a field that exists to
    // be zero 99% of the time and hashed on every frame regardless.
    if (f.hitstun > 0) {
      bufferPress(f, intent, ctx.frame);
      return;
    }
    startAction(f, intent.shieldHeld ? "shield" : "shieldRelease");
  },
};

export const STATUS_FURAFURA: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_FURAFURA",
  action: "shieldBroken",
  kineticType: "GROUND_STOP",
  main(f) {
    if (f.hitstun > 0) return;
    startAction(f, "stand");
  },
};

export const STATUS_ESCAPE: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_ESCAPE",
  action: "spotDodge",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (f.actionFrame >= SPOT_DODGE_FRAMES) startAction(f, "stand");
    else bufferPress(f, intent, ctx.frame);
  },
};

export const STATUS_ESCAPE_F: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_ESCAPE_F",
  action: "roll",
  kineticType: "MOTION",
  main(f, intent, ctx) {
    if (f.actionFrame >= ROLL_FRAMES) {
      kineticSetX(f, 0, "stop");
      startAction(f, "stand");
    } else bufferPress(f, intent, ctx.frame);
  },
};

export const STATUS_ESCAPE_AIR: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_ESCAPE_AIR",
  action: "airDodge",
  kineticType: "AIR_ESCAPE",
  main(f, intent, ctx) {
    // `charge` remembers a directional dodge: 63 frames rather than 50.
    const total = f.charge === 1 ? DIRECTIONAL_AIR_DODGE_FRAMES : AIR_DODGE_FRAMES;
    if (f.actionFrame >= total) startAction(f, "fall");
    else bufferPress(f, intent, ctx.frame);
  },
};

export const GUARD_STATUSES: readonly FighterStatus[] = [
  STATUS_GUARD_ON,
  STATUS_GUARD,
  STATUS_GUARD_OFF,
  STATUS_GUARD_DAMAGE,
  STATUS_FURAFURA,
  STATUS_ESCAPE,
  STATUS_ESCAPE_F,
  STATUS_ESCAPE_AIR,
];
