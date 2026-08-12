/**
 * Final Destination — one flat platform, nothing else.
 *
 * The other half of the pair Battlefield belongs to: every stage's Ω form is
 * this geometry wearing that stage's skin, so this file is the source the
 * transform in `index.ts` reads from.
 *
 * Geometry from the shipped collision data for `bossstage_final1_00`,
 * cross-checked against Kurogane Hammer. Both agree.
 */

import { fx } from "@/engine/fixed";
import type { Platform, StageDef } from "@/engine/types";

/**
 * Final Destination is not quite symmetric — its left ledge is at exactly -80
 * and its right at 79.99. That 0.01 is far too small to matter in play, but it
 * is what the stage data says, and encoding the centre as -0.005 with a
 * half-width of 79.995 reproduces *both* ledges exactly rather than rounding
 * one of them to make the arithmetic tidy.
 */
export const FINAL_DESTINATION_PLATFORMS: readonly Platform[] = [
  {
    x: fx(-0.005),
    y: fx(0.005),
    halfWidth: fx(79.995),
    soft: false,
    ledges: true,
  },
];

export const FINAL_DESTINATION_BLAST_ZONE = {
  left: fx(-240),
  right: fx(240),
  top: fx(180),
  bottom: fx(-140),
};

/**
 * Four evenly spread positions on the floor. Ultimate's own data puts these at
 * ∓30 and ∓70; with nothing to stand on but the floor, the only decision the
 * stage makes is how far apart the players start.
 */
export const FINAL_DESTINATION_SPAWNS = [
  { x: fx(-30), y: fx(0.005) },
  { x: fx(30), y: fx(0.005) },
  { x: fx(-70), y: fx(0.005) },
  { x: fx(70), y: fx(0.005) },
];

export const finalDestination: StageDef = {
  id: "finalDestination",
  name: "Final Destination",
  series: "Super Smash Bros.",
  platforms: FINAL_DESTINATION_PLATFORMS,
  blastZone: FINAL_DESTINATION_BLAST_ZONE,
  spawns: FINAL_DESTINATION_SPAWNS,
  theme: "finalDestination",
};
