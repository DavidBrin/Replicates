/**
 * The shared pose library.
 *
 * Every fighter reuses every pose here. That is the decision the whole
 * procedural-art approach rests on: eight fighters × fifty poses hand-authored
 * per character is four hundred animations nobody is going to write, whereas
 * fifty poses shared across eight *rigs* is fifty. Per-fighter identity comes
 * from bone-length scaling, props and palette (see `characterArt.ts`) — Donkey
 * Kong's forward smash is Mario's forward smash played on a rig with a torso
 * twice as wide and arms half again as long, and it reads as Donkey Kong's
 * because of the arms, not because of the keyframes.
 *
 * One clip per file, because each of these is an animation with its own
 * reference in the real game and its own reasoning about how long each beat
 * lasts, and because a file per clip is what lets several of them be worked on
 * at once without stepping on each other.
 */

import type { PoseClip } from "./clip";

import { idle } from "./idle";
import { walk } from "./walk";
import { dash } from "./dash";
import { run } from "./run";
import { brake } from "./brake";
import { turn } from "./turn";
import { crouch, crouchStart, crouchEnd } from "./crouch";
import { jumpSquat } from "./jumpSquat";
import { rise, doubleJump } from "./rise";
import { fall, fastFall } from "./fall";
import { land, landingLag } from "./land";
import { shield, shieldRelease } from "./shield";
import { shieldBroken } from "./shieldBroken";
import { roll } from "./roll";
import { spotDodge } from "./spotDodge";
import { airDodge } from "./airDodge";
import { hitstun } from "./hitstun";
import { tumble } from "./tumble";
import { downed, getUp } from "./downed";
import { grabbed, thrown } from "./grabbed";
import { ledgeHang, ledgeGetUp } from "./ledgeHang";
import * as attacks from "./attacks";

export type PoseName =
  // locomotion and neutral
  | "idle"
  | "walk"
  | "dash"
  | "run"
  | "brake"
  | "turn"
  | "crouchStart"
  | "crouch"
  | "crouchEnd"
  | "jumpSquat"
  | "rise"
  | "doubleJump"
  | "fall"
  | "fastFall"
  | "land"
  | "landingLag"
  // defence
  | "shield"
  | "shieldRelease"
  | "shieldBroken"
  | "roll"
  | "spotDodge"
  | "airDodge"
  // reeling
  | "hitstun"
  | "tumble"
  | "downed"
  | "getUp"
  | "grabbed"
  | "thrown"
  | "ledgeHang"
  | "ledgeGetUp"
  // offence
  | "grab"
  | "jab"
  | "jab2"
  | "jab3"
  | "rapidJab"
  | "ftilt"
  | "utilt"
  | "dtilt"
  | "dashAttack"
  | "fsmash"
  | "usmash"
  | "dsmash"
  | "nair"
  | "fair"
  | "bair"
  | "uair"
  | "dair"
  | "neutralB"
  | "sideB"
  | "upB"
  | "downB"
  | "fthrow"
  | "bthrow"
  | "uthrow"
  | "dthrow";

export const POSE_LIBRARY: Record<PoseName, PoseClip> = {
  idle,
  walk,
  dash,
  run,
  brake,
  turn,
  crouchStart,
  crouch,
  crouchEnd,
  jumpSquat,
  rise,
  doubleJump,
  fall,
  fastFall,
  land,
  landingLag,

  shield,
  shieldRelease,
  shieldBroken,
  roll,
  spotDodge,
  airDodge,

  hitstun,
  tumble,
  downed,
  getUp,
  grabbed,
  thrown,
  ledgeHang,
  ledgeGetUp,

  ...attacks,

  /**
   * The rest of the jab string, defaulting to the same clip as the first hit.
   *
   * A jab is not one animation. Mario's third hit is a roundhouse kick, Fox's
   * and Kirby's end in a rapid flurry, Marth's and Samus's are two-hit strings
   * — and every one of those was playing the punch authored for hit one,
   * because `SLOT_POSE` collapsed all four slots onto a single name. Two
   * character agents reported it independently as the thing they could not
   * express.
   *
   * Aliased rather than duplicated so the default is unchanged: a fighter who
   * says nothing still throws the same punch three times, which is what they
   * did before. A fighter who wants a kick on the third hit now has somewhere
   * to put it, and putting it there does not put a kick in the tail of every
   * jab.
   */
  jab2: attacks.jab,
  jab3: attacks.jab,
  rapidJab: attacks.jab,
};
