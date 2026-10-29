/**
 * The air dodge's rules that more than one layer reads (Plan 3, Task 20c):
 * each fighter's lengths and intangibility, the direction an air dodge
 * remembers, the directional dodge's slingshot, slide and hand-off, its
 * landing lag, and its ledge-grab gate.
 *
 * The status (`status/guard.ts`: how long it lasts), the state machine
 * (`states.ts`: intangibility, movement, landing), the ledge grab
 * (`physics.ts`) and the readers outside the engine (the CPU, the renderer)
 * all ask these questions, and must agree. This module imports only constants
 * and types, so none of them has to import another to get the answer.
 *
 * Sources are cited on the constants (`constants.ts`, "Air dodges") and on
 * `AirDodgeAttributes` (`types.ts`); P is fudgepop01/amiibo_research
 * `fighter_param_motion.xml` @523374aa.
 */

import {
  AIR_DODGE_LEDGE_FRAMES,
  AIR_DODGE_SLIDE_DISTANCE,
  AIR_DODGE_SLIDE_END_SPEED,
  AIR_DODGE_SLIDE_SPEED,
  AIR_DODGE_SLINGSHOT_CURVE,
  AIR_DODGE_SLINGSHOT_DISTANCE,
  AIR_DODGE_SLINGSHOT_FRAMES,
  DIRECTIONAL_AIR_DODGE_LANDING_LAG_MAX,
  DIRECTIONAL_AIR_DODGE_LANDING_LAG_MIN,
} from "./constants";
import { DIAGONAL, ONE } from "./fixed";
import type { Ratio } from "./fixed";
import type { AirDodgeAttributes, FighterAttributes, FighterState } from "./types";

/* ------------------------------------------------------ per fighter -- */

/**
 * Mario's entry (P L5 `fighter_kind_mario`; L26 `escape_air_stiff_frame` 52,
 * L22-23 `escape_air_hit_xlu_frame` 3 / `escape_air_hit_normal_frame` 27,
 * L114-116 the directional lengths 86 / 115 / 71, L29-30 their
 * intangibility 3 / 19). What a fighter whose definition authors no air dodge
 * gets: the engine's hand-built test fighters, which have Mario's weight, gravity
 * and fall speed. Every roster fighter authors its own.
 */
export const DEFAULT_AIR_DODGE: AirDodgeAttributes = {
  neutralFrames: 52,
  neutralIntangible: [3, 27],
  sideFrames: 86,
  upFrames: 115,
  downFrames: 71,
  directionalIntangible: [3, 19],
};

/** A fighter's air dodges, or Mario's when its definition has none. */
export function airDodgeOf(attrs: Pick<FighterAttributes, "airDodge">): AirDodgeAttributes {
  return attrs.airDodge ?? DEFAULT_AIR_DODGE;
}

/* -------------------------------------------------------- direction -- */

/**
 * The one rule for whether a press makes a directional air dodge: a direction
 * is held (SmashWiki "Air dodge", https://www.ssbwiki.com/Air_dodge: "If a
 * direction is held, they perform a directional air dodge"). UNVERIFIED for a
 * stick: the game asks for a deflection of `escape_air_slide_stick` 0.66 (C L118,
 * `common.xml` @523374aa); a key is all or nothing.
 */
export function isDirectionalDodge(intent: { readonly x: number; readonly y: number }): boolean {
  return intent.x !== 0 || intent.y !== 0;
}

/**
 * `charge` means nothing outside a smash, so an air dodge borrows it to
 * remember its direction: 0 for a neutral dodge, otherwise
 * `1 + (x + 1) + 3 (y + 1)` for the stick's x and y (−1, 0 or 1 each). That is
 * 1 to 9, and never 5, which would be no direction.
 */
export function airDodgeCharge(x: number, y: number): number {
  return x === 0 && y === 0 ? 0 : 1 + (x + 1) + 3 * (y + 1);
}

/** The direction an air dodge's `charge` remembers: (0, 0) for a neutral one. */
export function airDodgeDirection(charge: number): { readonly x: number; readonly y: number } {
  if (charge <= 0 || charge > 9) return { x: 0, y: 0 };
  const c = charge - 1;
  return { x: (c % 3) - 1, y: Math.trunc(c / 3) - 1 };
}

/** Is this fighter in a directional air dodge? */
export function isDirectionalAirDodge(f: Pick<FighterState, "action" | "charge">): boolean {
  return f.action === "airDodge" && f.charge > 0;
}

/* ------------------------------------------------- length and window -- */

/**
 * How many frames an air dodge lasts: the status ends on the frame
 * `actionFrame` reaches it (`STATUS_ESCAPE_AIR`). Neutral: P
 * `escape_air_stiff_frame`. Directional: `escape_air_slide_stiff_frame`
 * sideways, `_u_` straight up, `_d_` straight down.
 *
 * A diagonal is halfway between the sideways length and the up (or down) one,
 * rounded up. UNVERIFIED (mods only): HewDraw Remix `airdodge.rs` L512-520
 * (https://github.com/HDR-Development/HewDraw-Remix/blob/a56075404c96853b260689a341d63fcb90a33f93/fighters/common/src/general_statuses/airdodge.rs#L512-L520)
 * and ssbexo `escape_air.rs` L155-161
 * (https://github.com/Armasher5872/ssbexo/blob/e725aa375677092adf81c67e5a982cde3e478670/fighters/common/src/status/escape/escape_air.rs#L155-L161)
 * lerp the two by the stick's angle, and a keyboard's diagonal is 45°, the
 * midpoint. The lerp keeps a fraction (the length is a float param), which a
 * whole frame count first reaches on the frame after, hence rounding up.
 * SmashWiki "Air dodge"'s table gives Mario 102 diagonally up and 77 down; this
 * gives 101 and 79.
 */
export function airDodgeFrames(a: AirDodgeAttributes, charge: number): number {
  const d = airDodgeDirection(charge);
  if (d.x === 0 && d.y === 0) return a.neutralFrames;
  if (d.y === 0) return a.sideFrames;
  const vertical = d.y > 0 ? a.upFrames : a.downFrames;
  if (d.x === 0) return vertical;
  return Math.ceil((a.sideFrames + vertical) / 2);
}

/**
 * An air dodge's intangible window as [first, last] `actionFrame`: from the
 * pair's first number for its second's count of frames (`AirDodgeAttributes`),
 * the same frame numbering as every other dodge window here (`dodgeWindow`).
 */
export function airDodgeIntangible(a: AirDodgeAttributes, charge: number): readonly [number, number] {
  const [xlu, normal] = charge > 0 ? a.directionalIntangible : a.neutralIntangible;
  return [xlu, xlu + normal - 1];
}

/**
 * The landing lag of a directional air dodge that lands on `actionFrame`
 * `frame` of its `total`: 19 on its first frame, 10 on its last, falling
 * linearly between (`DIRECTIONAL_AIR_DODGE_LANDING_LAG_MAX`/`_MIN`).
 * UNVERIFIED: the line. SmashWiki publishes the two ends and that "landing
 * later suffers less"; HewDraw Remix uses the maximum flat (`airdodge.rs`
 * L123), its own choice. The dodge cannot land in its slingshot when aimed
 * down, so its earliest landing is a few frames in; the truncation keeps that
 * at 19.
 */
export function directionalLandingLag(frame: number, total: number): number {
  const last = total - 1;
  const max = DIRECTIONAL_AIR_DODGE_LANDING_LAG_MAX;
  const min = DIRECTIONAL_AIR_DODGE_LANDING_LAG_MIN;
  if (last <= 0) return min;
  const at = frame < 0 ? 0 : frame > last ? last : frame;
  return max - Math.trunc(((max - min) * at) / last);
}

/**
 * Whether the dodge keeps this fighter off every ledge: a directional one, in
 * its first `AIR_DODGE_LEDGE_FRAMES` frames. The starting frame is the dodge's
 * first (it already moves and collides, as `AIR_DODGE_TECH_FRAMES` counts), so
 * `actionFrame` 0-23 are the first 24.
 */
export function airDodgeRefusesLedge(f: Pick<FighterState, "action" | "charge" | "actionFrame">): boolean {
  return isDirectionalAirDodge(f) && f.actionFrame < AIR_DODGE_LEDGE_FRAMES;
}

/* ----------------------------------------------- directional schedule -- */

/** The slingshot's Bezier is sampled at 0, 1/3, 2/3 and 1: three intervals. */
const SLINGSHOT_INTERVALS = AIR_DODGE_SLINGSHOT_FRAMES - 1;

/**
 * How far the slingshot has carried the fighter back by the end of its frame
 * `k` (0 to 3), Q12: the distance times the cubic Bezier at k/3. With the
 * control points in tenths, B(k/3) is a sum of integers over 3³ × 10, so this
 * truncates once and the last frame ends on exactly 7.
 */
function slingshotCovered(k: number): number {
  const [p0, p1, p2, p3] = AIR_DODGE_SLINGSHOT_CURVE;
  const n = SLINGSHOT_INTERVALS;
  const i = k;
  const r = n - i;
  const num = r * r * r * p0 + 3 * r * r * i * p1 + 3 * r * i * i * p2 + i * i * i * p3;
  const den = n * n * n * 10;
  return Math.trunc((AIR_DODGE_SLINGSHOT_DISTANCE * num) / den);
}

/** How far the slingshot moves the fighter back on its frame `k` (0 to 3), Q12. */
export function airDodgeSlingshotStep(k: number): number {
  return slingshotCovered(k) - (k > 0 ? slingshotCovered(k - 1) : 0);
}

/**
 * How many frames the slide moves for: the most whose constant brake still
 * leaves the last frame no slower than the end speed. With speeds v0 − k·b
 * summing to D over n frames, the last is 2D/n − v0, so n is the whole part of
 * 2D / (v0 + v1): 7 for 4.2, 1.3 and 20, a bounded reading (the review's
 * "about 7 frames of slide"). UNVERIFIED with the brake itself.
 */
export const AIR_DODGE_SLIDE_FRAMES = Math.trunc(
  (2 * AIR_DODGE_SLIDE_DISTANCE) / (AIR_DODGE_SLIDE_SPEED + AIR_DODGE_SLIDE_END_SPEED),
);

/** n(n − 1) / 2: the brakes a slide of n frames has applied by its last. */
function triangle(n: number): number {
  return (n * (n - 1)) / 2;
}

/**
 * The slide's constant brake, Q12 a frame, as an exact fraction: the n frames
 * at v0, v0 − b, …, v0 − (n − 1)·b cover D, so b = (n·v0 − D) / (n(n − 1)/2).
 * 38501/21 Q12, about 0.4476 a frame. UNVERIFIED: that the brake is constant.
 */
export const AIR_DODGE_SLIDE_BRAKE: Ratio = [
  AIR_DODGE_SLIDE_FRAMES * AIR_DODGE_SLIDE_SPEED - AIR_DODGE_SLIDE_DISTANCE,
  triangle(AIR_DODGE_SLIDE_FRAMES),
];

/** How far the slide has carried the fighter after `m` of its frames, Q12: m·v0 − b·m(m − 1)/2, truncated once. */
function slideCovered(m: number): number {
  const [num, den] = AIR_DODGE_SLIDE_BRAKE;
  return m * AIR_DODGE_SLIDE_SPEED - Math.trunc((num * triangle(m)) / den);
}

/** How far the slide moves the fighter on its frame `k` (0 to n − 1), Q12; the n frames cover exactly 20. */
export function airDodgeSlideStep(k: number): number {
  return slideCovered(k + 1) - slideCovered(k);
}

/**
 * A length along one axis of the dodge's direction, a diagonal's scaled by
 * 1/√2: the direction is the stick normalised, so a diagonal dodge covers the
 * same distance as a straight one (HewDraw Remix `airdodge.rs` L485,
 * `sv_math::vec2_normalize(stick_x, stick_y)`; ssbexo `escape_air.rs` L136).
 */
function along(length: number, axis: number, diagonal: boolean): number {
  if (axis === 0) return 0;
  return axis * (diagonal ? Math.trunc((length * DIAGONAL) / ONE) : length);
}

/** What a directional air dodge's own movement does on one frame. */
export interface DirectionalDodgeFrame {
  /**
   * `slingshot` and `slide`: (x, y) is this frame's velocity, and the dodge
   * holds it with nothing else moving the fighter (`kineticAirDodge`).
   * `handOff`: (x, y) is the end speed, handed to drift and gravity, which run
   * from this frame (`kineticAirDodgeHandOff`).
   */
  readonly phase: "slingshot" | "slide" | "handOff";
  readonly x: number;
  readonly y: number;
}

/**
 * A directional air dodge's schedule: the slingshot back on `actionFrame` 0-3,
 * the slide on 4-10, and on 11 the hand-off of 1.3 along its direction to drift
 * and gravity (UNVERIFIED: that frame, the slide's end; SmashWiki only says the
 * fighter "begin[s] to fall shortly afterwards"). Null for a neutral dodge, any
 * other action, and every frame after the hand-off, when the dodge falls by the
 * fall's rules until it ends.
 */
export function directionalDodgeFrame(
  f: Pick<FighterState, "action" | "charge" | "actionFrame">,
): DirectionalDodgeFrame | null {
  if (!isDirectionalAirDodge(f)) return null;
  const d = airDodgeDirection(f.charge);
  const diagonal = d.x !== 0 && d.y !== 0;
  if (f.actionFrame < AIR_DODGE_SLINGSHOT_FRAMES) {
    // Back, against the direction: "left and upward if the air dodge was aimed
    // right and downward" (SmashWiki "Air dodge").
    const back = airDodgeSlingshotStep(f.actionFrame);
    return { phase: "slingshot", x: along(back, -d.x, diagonal), y: along(back, -d.y, diagonal) };
  }
  const k = f.actionFrame - AIR_DODGE_SLINGSHOT_FRAMES;
  if (k < AIR_DODGE_SLIDE_FRAMES) {
    const step = airDodgeSlideStep(k);
    return { phase: "slide", x: along(step, d.x, diagonal), y: along(step, d.y, diagonal) };
  }
  if (k === AIR_DODGE_SLIDE_FRAMES) {
    const end = AIR_DODGE_SLIDE_END_SPEED;
    return { phase: "handOff", x: along(end, d.x, diagonal), y: along(end, d.y, diagonal) };
  }
  return null;
}
