/**
 * Battlefield — the stage every discussion of Smash geometry starts from.
 *
 * Three soft platforms in a triangle over a flat main platform. It is the
 * reference layout: Ultimate guarantees that *every* stage's Battlefield form
 * is geometrically identical to this one, which is why `stages/index.ts` can
 * produce all six Battlefield forms from this single definition rather than
 * from six hand-written variants.
 *
 * Geometry is from the shipped stage collision data (the LVD for
 * `battlefield_00`, as dumped by rubendal's SSBU data browser), cross-checked
 * against the Kurogane Hammer blast-zone table. Both agree exactly.
 */

import { fx } from "@/engine/fixed";
import type { Platform, StageDef } from "@/engine/types";

/**
 * The soft platforms all share one half-width — 17.3165 — which is not a
 * coincidence: the two lower ones are the same collision object mirrored, and
 * the top one is that object again, recentred. Encoding the shared value once
 * makes the symmetry a fact of the file rather than something a reader has to
 * notice by comparing three numbers.
 */
export const BATTLEFIELD_PLATFORM_HALF_WIDTH = fx(17.3165);

/** Lower pair: y = 24.119, spanning -59.422..-24.789 and its mirror. */
export const BATTLEFIELD_LOWER_PLATFORM_Y = fx(24.119);
/** Upper single: y = 47.189, centred on the stage. */
export const BATTLEFIELD_UPPER_PLATFORM_Y = fx(47.189);

/**
 * The main platform and the three soft ones, shared with every Battlefield
 * form. Exported because the transform in `index.ts` needs the *geometry*
 * separately from the skin.
 */
export const BATTLEFIELD_PLATFORMS: readonly Platform[] = [
  {
    // Ledges at ∓79.99 give a half-width of 79.99 about a centred origin.
    // Floor sits at y = 0.111 rather than 0 — a real quirk of the stage, and
    // the reason its spawn points are quoted as 0.111 rather than zero.
    x: fx(0),
    y: fx(0.111),
    halfWidth: fx(79.99),
    soft: false,
    ledges: true,
  },
  {
    // centre of -59.422..-24.789
    x: fx(-42.1055),
    y: BATTLEFIELD_LOWER_PLATFORM_Y,
    halfWidth: BATTLEFIELD_PLATFORM_HALF_WIDTH,
    soft: true,
    ledges: false,
  },
  {
    x: fx(0),
    y: BATTLEFIELD_UPPER_PLATFORM_Y,
    halfWidth: BATTLEFIELD_PLATFORM_HALF_WIDTH,
    soft: true,
    ledges: false,
  },
  {
    // centre of 24.789..59.422
    x: fx(42.1055),
    y: BATTLEFIELD_LOWER_PLATFORM_Y,
    halfWidth: BATTLEFIELD_PLATFORM_HALF_WIDTH,
    soft: true,
    ledges: false,
  },
];

export const BATTLEFIELD_BLAST_ZONE = {
  left: fx(-240),
  right: fx(240),
  top: fx(192),
  bottom: fx(-140),
};

/**
 * Start positions, straight from the stage data. Two players open on the lower
 * platforms; the third and fourth take the top platform and the centre of the
 * floor. Each one is at or above the surface it stands on, which is what the
 * spawn test checks.
 */
export const BATTLEFIELD_SPAWNS = [
  { x: fx(-40), y: fx(24.23) },
  { x: fx(40), y: fx(24.23) },
  { x: fx(0), y: fx(47.3) },
  { x: fx(0), y: fx(0.111) },
];

export const battlefield: StageDef = {
  id: "battlefield",
  name: "Battlefield",
  series: "Super Smash Bros.",
  platforms: BATTLEFIELD_PLATFORMS,
  blastZone: BATTLEFIELD_BLAST_ZONE,
  spawns: BATTLEFIELD_SPAWNS,
  theme: "battlefield",
};
