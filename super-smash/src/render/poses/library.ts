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
import { fall, fallFlip, fastFall } from "./fall";
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
import { footstooled } from "./footstooled";
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
  // Plan 5, Task 17: crawling out of a crouch (Pikachu's own; Task 12's action)
  | "crawl"
  | "jumpSquat"
  | "rise"
  | "doubleJump"
  | "fall"
  | "fastFall"
  // Plan 6, Task 21: the flip off a dash.
  | "fallFlip"
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
  // Plan 5, Task 17: stood on by a footstool jump, on the ground (Task 11's action)
  | "footstooled"
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
  // Plan 5, Task 5: the strike a counter returns (Marth's Counter).
  | "counterAttack"
  // Plan 5, Task 17 fix rounds 1 and 3: a Final Smash's start, its scene and its
  // finishing blow (its `finalSmash`, `finalAttack` and `finalEnd` parts).
  | "finalSmash"
  | "finalAttack"
  | "finalEnd"
  | "fthrow"
  | "bthrow"
  | "uthrow"
  | "dthrow"
  // Plan 6, Task 20: Donkey Kong's carry, on the ground and in the air, and his lift.
  | "cargoCarry"
  | "cargoFall"
  | "cargoLift";

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
  /**
   * A crawl (Plan 5, Task 17). Only Pikachu crawls in this roster (SmashWiki
   * "Crawling", `FighterAttributes.canCrawl`), and he authors his own; the
   * shared default is the crouch the crawl moves in, which no other fighter can
   * be in (and the bake bakes the crawl for a crawler alone, `statusSamplers`).
   */
  crawl: crouch,
  jumpSquat,
  rise,
  doubleJump,
  fall,
  fastFall,
  fallFlip,
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
  footstooled,
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

  /**
   * The strike a counter returns once it has caught something (Plan 5, Task 5),
   * a clip of its own so the guard and the cut are two moves, each timed on its
   * own frames. Only a fighter with a counter has the slot, and the one who does
   * (Marth) draws his own; the shared default is the forward tilt's strike, a
   * forward cut on any rig.
   */
  counterAttack: attacks.ftilt,

  /**
   * A Final Smash's scene, its `finalAttack` part (Plan 5, Task 17 fix round 1,
   * ruling R-T17d). It borrows the neutral special's clip, as the Final Smash's
   * start does (`SLOT_POSE`), and a fighter that authors no scene of its own
   * plays its *own* neutral special's (`clipFor`'s `POSE_FALLBACK`), so this
   * default is only the shared neutral special's, for a fighter with neither.
   */
  finalAttack: attacks.neutralB,
  /** The finishing blow, its `finalEnd` part: likewise. */
  finalEnd: attacks.neutralB,
  /**
   * A Final Smash's start, its `finalSmash` part (Task 17 fix round 3, ruling
   * R-T17m): likewise, but for Samus, whose Zero Laser holds her cannon level along
   * its beam.
   */
  finalSmash: attacks.neutralB,
  /**
   * Kong Karry (Plan 6, Task 20): only Donkey Kong carries, and he draws his own; the
   * shared defaults are the clips his carry played before, the walk, the fall and the
   * forward throw.
   */
  cargoCarry: walk,
  cargoFall: fall,
  cargoLift: attacks.fthrow,
};
