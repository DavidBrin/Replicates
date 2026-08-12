/**
 * Town & City — three soft platforms over a wide, slightly off-centre floor.
 *
 * The real stage alternates between a "town" layout and a "city" layout, with
 * the platforms drifting off and new ones drifting in. Stage transformations
 * are out of scope (SPEC §12 cuts stage hazards), so what is modelled here is
 * the **town** phase, which is the one the stage spends most of its time in and
 * the one its competitive reputation is built on. The city-phase platform
 * geometry is recorded in a comment below rather than dropped, so that adding
 * the transition later is a change of behaviour, not a research job.
 *
 * Geometry from the shipped collision data for `village2_00`.
 */

import { fx } from "@/engine/fixed";
import type { Platform, StageDef } from "@/engine/types";

/** All three town platforms share a half-width of 19.25 in the stage data. */
export const TOWN_AND_CITY_PLATFORM_HALF_WIDTH = fx(19.25);

export const TOWN_AND_CITY_PLATFORMS: readonly Platform[] = [
  {
    // ledges -81.78 and 83.22 → centre 0.72, half-width 82.5
    x: fx(0.72),
    y: fx(0),
    halfWidth: fx(82.5),
    soft: false,
    ledges: true,
  },
  {
    // COL_00_MuraC — the centre platform, and the lowest of the three
    x: fx(0),
    y: fx(27.518),
    halfWidth: TOWN_AND_CITY_PLATFORM_HALF_WIDTH,
    soft: true,
    ledges: false,
  },
  {
    // COL_00_MuraL, centre of -98.525..-60.025. The outer pair sit *higher*
    // than the centre one and hang well past the ledges, which is why Town &
    // City's edgeguarding plays so differently from Battlefield's.
    x: fx(-79.275),
    y: fx(41.539),
    halfWidth: TOWN_AND_CITY_PLATFORM_HALF_WIDTH,
    soft: true,
    ledges: false,
  },
  {
    // COL_00_MuraR, centre of 60.556..99.056
    x: fx(79.806),
    y: fx(41.539),
    halfWidth: TOWN_AND_CITY_PLATFORM_HALF_WIDTH,
    soft: true,
    ledges: false,
  },
  // City phase, for whenever transitions land: two platforms of the same
  // half-width authored at the origin (COL_00_CityL / COL_00_CityR, y = -10.786
  // in the LVD) which the stage animation lifts and separates.
];

/**
 * Blast zones as specified by the brief's Kurogane Hammer table.
 *
 * The shipped LVD for `village2_00` reports 190 / -123 rather than 195 / -118.
 * The difference is that the stage's blast zones *move* with the transition —
 * the LVD holds one phase's values, and the quoted table holds another. The
 * brief's numbers are used because they are what the rest of the project was
 * specified against; the discrepancy is recorded here rather than silently
 * resolved.
 */
export const TOWN_AND_CITY_BLAST_ZONE = {
  left: fx(-230),
  right: fx(230),
  top: fx(195),
  bottom: fx(-118),
};

export const TOWN_AND_CITY_SPAWNS = [
  { x: fx(-65), y: fx(0) },
  { x: fx(65), y: fx(0) },
  { x: fx(-21.667), y: fx(0) },
  { x: fx(21.667), y: fx(0) },
];

export const townAndCity: StageDef = {
  id: "townAndCity",
  name: "Town & City",
  series: "Animal Crossing",
  platforms: TOWN_AND_CITY_PLATFORMS,
  blastZone: TOWN_AND_CITY_BLAST_ZONE,
  spawns: TOWN_AND_CITY_SPAWNS,
  theme: "townAndCity",
};
