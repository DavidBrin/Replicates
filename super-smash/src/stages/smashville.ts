/**
 * Smashville — one flat platform and a single soft platform sweeping across it.
 *
 * The moving platform is the whole stage: it is what stops Smashville being
 * Final Destination, and it is the reason the stage is on every legal list —
 * the platform's position is the same information for both players, so it adds
 * variety without adding randomness.
 *
 * Geometry from the shipped collision data for `xvillage00`, cross-checked
 * against Kurogane Hammer's blast-zone table. Note the stage is asymmetric:
 * the left ledge is at -69.05 and the right at 70.25, so its centre is 0.6
 * units right of the origin.
 */

import { fx } from "@/engine/fixed";
import type { Platform, StageDef } from "@/engine/types";

/**
 * The sweep period.
 *
 * UNVERIFIED: the platform's travel time is not published in the stage
 * collision data — the LVD carries only the platform's rest geometry, and the
 * motion path lives in the stage's animation, which is not part of any dump I
 * could reach. The value below is the widely repeated competitive figure of
 * roughly thirteen seconds for a full there-and-back cycle. It is cosmetic
 * either way: nothing in the physics branches on it.
 */
export const SMASHVILLE_SWEEP_PERIOD_FRAMES = 780;

/**
 * How far the platform travels either side of centre. Taken from where it
 * visibly turns around relative to the ledges rather than from a dump, since
 * the path is not in the collision data — it overhangs both ledges slightly,
 * which is what makes it useful for recovery.
 */
export const SMASHVILLE_SWEEP_AMPLITUDE = fx(58);

export const SMASHVILLE_PLATFORMS: readonly Platform[] = [
  {
    // ledges -69.05 and 70.25 → centre 0.6, half-width 69.65
    x: fx(0.6),
    y: fx(0.1),
    halfWidth: fx(69.65),
    soft: false,
    ledges: true,
  },
  {
    // The platform's own half-width, 23.838, is from the collision data; its
    // resting x there is off-stage because the object is authored at the end of
    // its path, so the centre here is the stage centre it sweeps about.
    x: fx(0.6),
    y: fx(28.798),
    halfWidth: fx(23.838),
    soft: true,
    ledges: false,
    motion: {
      kind: "sweep",
      amplitude: SMASHVILLE_SWEEP_AMPLITUDE,
      periodFrames: SMASHVILLE_SWEEP_PERIOD_FRAMES,
    },
  },
];

export const SMASHVILLE_BLAST_ZONE = {
  left: fx(-229),
  right: fx(230),
  top: fx(190),
  bottom: fx(-115),
};

/**
 * All four on the floor — the moving platform is never a spawn, because where
 * it happens to be at match start is not something the stage wants to decide.
 */
export const SMASHVILLE_SPAWNS = [
  { x: fx(-27), y: fx(0.1) },
  { x: fx(27), y: fx(0.1) },
  { x: fx(-63), y: fx(0.1) },
  { x: fx(63), y: fx(0.1) },
];

export const smashville: StageDef = {
  id: "smashville",
  name: "Smashville",
  series: "Animal Crossing",
  platforms: SMASHVILLE_PLATFORMS,
  blastZone: SMASHVILLE_BLAST_ZONE,
  spawns: SMASHVILLE_SPAWNS,
  theme: "smashville",
};
