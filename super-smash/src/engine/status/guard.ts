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
 *
 * The shield start, the shield drop and the three dodges end on their first
 * actionable frame, where the next status's `main` runs (`handOff`; Plan 3
 * final wave). The spot dodge's and the rolls' lengths are each fighter's own
 * (`groundDodge.ts`), and a roll keeps its way, forward or back, in `charge`.
 */

import { airDodgeFrames, airDodgeOf } from "../airDodge";
import {
  FURAFURA_END_FRAMES,
  SHIELD_BREAK_MASH_BUTTON,
  SHIELD_BREAK_MASH_STICK,
  SHIELD_BREAK_RESET,
  SHIELD_MIN_HOLD,
  SHIELD_RELEASE_FRAMES,
} from "../constants";
import { groundDodgeOf, rollCharge, rollOf } from "../groundDodge";
import { kineticSetX } from "../kinetic";
import { mashFrames } from "../shield";
import {
  ROLL_DISTANCE,
  SHIELD_START_FRAMES,
  bufferPress,
  buttonPresses,
  handOff,
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
  main(f, intent, ctx) {
    if (f.actionFrame >= SHIELD_START_FRAMES) handOff(f, "shield", intent, ctx);
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
      // Forward or back, each its own length (`groundDodge.ts`); the distance is
      // the same either way (`ROLL_DISTANCE`, UNVERIFIED), spread over the roll.
      f.charge = rollCharge(intent.x, f.facing);
      const frames = rollOf(groundDodgeOf(ctx.def.attributes), f.charge).frames;
      kineticSetX(f, intent.x * Math.trunc(ROLL_DISTANCE / frames), "stop");
    }
  },
};

export const STATUS_GUARD_OFF: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_GUARD_OFF",
  action: "shieldRelease",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (f.actionFrame >= SHIELD_RELEASE_FRAMES) handOff(f, "stand", intent, ctx);
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
  // A new break's mash starts at zero, whatever an earlier struggle left in the
  // shared carry (`mashFrames`; Plan 3 final wave, the Task 9 review's minor).
  pre(f) {
    f.combat.mash = 0;
  },
  // The shield comes back at 75% (SmashWiki "Shield break",
  // https://www.ssbwiki.com/Shield_break: "the shield is reset to ... 75% in
  // Ultimate"), not empty, however the stunned state ends: run out, or cut short
  // by a hit ("Any attack that causes a stunned fighter to flinch ends the
  // stunned state", the same page) or a grab. UNVERIFIED: that an early end
  // resets it too; the page gives the reset only for the stun running out. A KO
  // has already refilled it (`step`, phase 9), so it is never lowered here.
  end(f) {
    f.shieldHealth = Math.max(f.shieldHealth, SHIELD_BREAK_RESET);
  },
  main(f, intent) {
    // `charge` is free in this status: 0 while stunned, 1 in FuraFuraEnd.
    if (f.hitstun > 0) {
      if (f.charge === 1) return;
      // Mashing: 5.4 frames a button press, 3 a stick input (SmashWiki "Stun").
      const sticks = f.framesSinceDirPress === 0 ? 1 : 0;
      const earned = mashFrames(f.combat, buttonPresses(intent), sticks, SHIELD_BREAK_MASH_BUTTON, SHIELD_BREAK_MASH_STICK);
      f.hitstun = Math.max(0, f.hitstun - earned);
      return;
    }
    if (f.charge === 0) {
      // FuraFuraEnd: the fighter comes to for 33 frames, still unable to act
      // (SmashWiki "Stun"), and mashing no longer helps.
      f.charge = 1;
      f.hitstun = FURAFURA_END_FRAMES;
      f.combat.mash = 0;
      return;
    }
    // The shield comes back as the status ends (`end`).
    startAction(f, "stand");
  },
};

export const STATUS_ESCAPE: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_ESCAPE",
  action: "spotDodge",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    // Each fighter's own length, UFD's "Total frames" (`groundDodge.ts`).
    if (f.actionFrame >= groundDodgeOf(ctx.def.attributes).spotDodge.frames) handOff(f, "stand", intent, ctx);
    else bufferPress(f, intent, ctx.frame);
  },
};

export const STATUS_ESCAPE_F: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_ESCAPE_F",
  action: "roll",
  kineticType: "MOTION",
  main(f, intent, ctx) {
    // Forward or back, by the way `charge` remembers (`rollOf`).
    if (f.actionFrame >= rollOf(groundDodgeOf(ctx.def.attributes), f.charge).frames) {
      kineticSetX(f, 0, "stop");
      handOff(f, "stand", intent, ctx);
    } else bufferPress(f, intent, ctx.frame);
  },
};

export const STATUS_ESCAPE_AIR: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_ESCAPE_AIR",
  action: "airDodge",
  kineticType: "AIR_ESCAPE",
  end(f) {
    // The tech trigger belongs to this air dodge alone (Plan 3, Task 12).
    f.combat.tumbleDodge = false;
    // The dodge ends a fast fall (SmashWiki "Air friction",
    // https://www.ssbwiki.com/Air_friction; `startAirDodge`; Plan 3, Task 20c).
    f.fastFalling = false;
  },
  main(f, intent, ctx) {
    // Each fighter's own length, by the direction `charge` remembers (Plan 3,
    // Task 20c; `airDodgeFrames`).
    const total = airDodgeFrames(airDodgeOf(ctx.def.attributes), f.charge);
    if (f.actionFrame >= total) handOff(f, "fall", intent, ctx);
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
