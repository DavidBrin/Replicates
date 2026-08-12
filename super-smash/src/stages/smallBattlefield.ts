/**
 * Small Battlefield — Battlefield with the top platform taken away.
 *
 * Added to Ultimate in 8.0.0 for exactly that reason: the top platform is what
 * lets a fighter stall out a timer, so removing it changes the stage's
 * character without changing a single measurement. The stage data bears this
 * out — the two remaining platforms sit at the same height (24.119) and the
 * same half-width (17.3165) as Battlefield's lower pair, shifted inward by
 * about 2 units.
 *
 * Geometry from the shipped collision data for `battlefield_s_00`.
 */

import { fx } from "@/engine/fixed";
import type { Platform, StageDef } from "@/engine/types";
import { BATTLEFIELD_LOWER_PLATFORM_Y, BATTLEFIELD_PLATFORM_HALF_WIDTH } from "./battlefield";

export const SMALL_BATTLEFIELD_PLATFORMS: readonly Platform[] = [
  {
    x: fx(0),
    y: fx(0),
    halfWidth: fx(80),
    soft: false,
    ledges: true,
  },
  {
    // centre of -57.5275..-22.8945
    x: fx(-40.211),
    y: BATTLEFIELD_LOWER_PLATFORM_Y,
    halfWidth: BATTLEFIELD_PLATFORM_HALF_WIDTH,
    soft: true,
    ledges: false,
  },
  {
    // centre of 22.6835..57.3165 — the mirror is 0.2 out, which is in the data
    x: fx(40.0),
    y: BATTLEFIELD_LOWER_PLATFORM_Y,
    halfWidth: BATTLEFIELD_PLATFORM_HALF_WIDTH,
    soft: true,
    ledges: false,
  },
];

/**
 * Battlefield's ceiling is 192; this one's is 180. Losing the top platform
 * *and* twelve units of headroom is what makes the stage kill vertically so
 * much earlier than its parent.
 */
export const SMALL_BATTLEFIELD_BLAST_ZONE = {
  left: fx(-240),
  right: fx(240),
  top: fx(180),
  bottom: fx(-140),
};

export const SMALL_BATTLEFIELD_SPAWNS = [
  { x: fx(-40), y: fx(24.23) },
  { x: fx(40), y: fx(24.23) },
  { x: fx(-20), y: fx(0) },
  { x: fx(20), y: fx(0) },
];

export const smallBattlefield: StageDef = {
  id: "smallBattlefield",
  name: "Small Battlefield",
  series: "Super Smash Bros.",
  platforms: SMALL_BATTLEFIELD_PLATFORMS,
  blastZone: SMALL_BATTLEFIELD_BLAST_ZONE,
  spawns: SMALL_BATTLEFIELD_SPAWNS,
  theme: "battlefield",
};
