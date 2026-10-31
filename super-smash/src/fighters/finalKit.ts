/**
 * Building blocks for the Final Smashes (Plan 5, Tasks 15–16).
 *
 * The published `game_final*` scripts hang their scene's boxes off bones the
 * cutscene places (`virtualfinalattack`), or off the user's limbs, or apply them
 * by `ATTACK_ABS`; the replica has none of those placements. So a scene's boxes
 * here are root-bone stand-ins: in the scene they reach every trapped fighter
 * wherever they are (`engine/final.ts`), and only their numbers and frames
 * matter. A start's trap box is a world box, and where its script hangs it off
 * the root bone (`top`) its offsets and far end are the script's own.
 *
 * Every number is quoted in the fighter file that uses it. The defaults here (`x`
 * 10, `y` 8, `radius` 10), and any offset or radius a fighter file does not quote,
 * are UNVERIFIED stand-ins.
 *
 * A scene box keeps no hit record (Task 14), so one live n frames would land n
 * times: each scene hit is authored one frame long, on the first frame of its
 * script's window (`barrage`, and a single `finalBox(id, f, f, …)`), and lands
 * once, as each published hit does. So is a start's ordinary hit (`trap: false`,
 * fix round 1, ruling R-T15j), which keeps no hit record either.
 */

import { fx } from "@/engine/fixed";
import type { HitEffect, Hitbox } from "@/engine/types";

/** One box's numbers, raw (the scripts' units); fixed-point conversion is `finalBox`'s. */
export interface Hit {
  readonly damage: number;
  readonly angle: number;
  readonly kbg: number;
  readonly bkb?: number;
  /** Set ("fixed") knockback, the script's `FKB`; 0 or absent for none. */
  readonly fkb?: number;
  readonly radius?: number;
  /** Offset, facing-relative: the script's `Z` (forward) and `Y` on the root bone. */
  readonly x?: number;
  readonly y?: number;
  /** A capsule's far end (`Z2`, `Y2`): compiled since ruling P5-R19. */
  readonly x2?: number;
  readonly y2?: number;
  /** The script's `Hitlag` multiplier; absent for 1.0. */
  readonly hitlag?: number;
  /** `ATTACK_SETOFF_KIND_OFF`: clanks with nothing (`Hitbox.transcendent`). */
  readonly transcendent?: boolean;
  /** `ATTACK_LR_CHECK_POS` ("position") or `_B` ("back"); absent for `_F`. */
  readonly lr?: Hitbox["lr"];
  /** The script's `collision_attr_*`, as the replica's effect; absent for normal. */
  readonly effect?: HitEffect;
  /** `AttackModule::set_force_reaction`: through super armour (`Hitbox.forceReaction`; fix round 1). */
  readonly forceReaction?: boolean;
  /** False: in a trapping start, the box hits instead of trapping (`Hitbox.trap`; fix round 1, ruling R-T15j). */
  readonly trap?: false;
  /** The box's own `Rehit`, over its move's (`Hitbox.rehit`; Task 16 fix round 1, ruling R-T16d). */
  readonly rehit?: number;
  /** The box's `Part`, a hit record of its own (`Hitbox.part`; Task 16 fix round 1, ruling R-T16e). */
  readonly part?: number;
  /** `Flinchless=true`: a windbox, which pushes and does not hit (`Hitbox.windbox`; ruling R-T16c). */
  readonly windbox?: boolean;
  /** `COLLISION_CATEGORY_MASK_FIGHTER`: hits fighters and nothing else (`Hitbox.fightersOnly`; ruling R-T16g). */
  readonly fightersOnly?: boolean;
}

/** One box, live on `from`–`to` (game frames). */
export function finalBox(id: number, from: number, to: number, h: Hit): Hitbox {
  return {
    id,
    startFrame: from,
    endFrame: to,
    x: fx(h.x ?? 10),
    y: fx(h.y ?? 8),
    ...(h.x2 !== undefined ? { x2: fx(h.x2) } : {}),
    ...(h.y2 !== undefined ? { y2: fx(h.y2) } : {}),
    radius: fx(h.radius ?? 10),
    damage: fx(h.damage),
    angle: fx(h.angle),
    baseKnockback: fx(h.bkb ?? 0),
    knockbackGrowth: fx(h.kbg),
    ...(h.fkb !== undefined && h.fkb > 0 ? { fixedKnockback: fx(h.fkb) } : {}),
    ...(h.hitlag !== undefined ? { hitlagMultiplier: fx(h.hitlag) } : {}),
    ...(h.transcendent === true ? { transcendent: true } : {}),
    ...(h.lr !== undefined ? { lr: h.lr } : {}),
    ...(h.effect !== undefined ? { effect: h.effect } : {}),
    ...(h.forceReaction === true ? { forceReaction: true } : {}),
    ...(h.trap === false ? { trap: false } : {}),
    ...(h.rehit !== undefined ? { rehit: h.rehit } : {}),
    ...(h.part !== undefined && h.part !== 0 ? { part: h.part } : {}),
    ...(h.windbox === true ? { windbox: true } : {}),
    ...(h.fightersOnly === true ? { fightersOnly: true } : {}),
  };
}

/** `count` one-frame hits, `every` frames apart from `from`: a scene's barrage. Ids from `firstId`. */
export function barrage(firstId: number, from: number, count: number, every: number, h: Hit): Hitbox[] {
  return Array.from({ length: count }, (_, i) => finalBox(firstId + i, from + i * every, from + i * every, h));
}
