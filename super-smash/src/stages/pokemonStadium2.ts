/**
 * Pokémon Stadium 2 — the widest of the six, with two flanking soft platforms.
 *
 * Its ledges sit at ∓93.78, nearly fourteen units further out than
 * Battlefield's, and its side blast zones are further out again at ∓250. The
 * combination is what gives the stage its reputation: horizontal KOs are hard
 * and vertical ones are not, because the ceiling is only 180.
 *
 * The real stage cycles through four elemental transformations. Those are
 * hazards, and SPEC §12 cuts hazards, so the neutral form is what is modelled —
 * which is also what the stage looks like with hazards toggled off, the only
 * form used competitively.
 *
 * Geometry from the shipped collision data for `xstadium_00`.
 */

import { fx } from "@/engine/fixed";
import type { Platform, StageDef } from "@/engine/types";

export const POKEMON_STADIUM_2_PLATFORMS: readonly Platform[] = [
  {
    x: fx(0),
    y: fx(0),
    halfWidth: fx(93.78),
    soft: false,
    ledges: true,
  },
  {
    // COL_00_Platform01, spanning -56.129..-25.161 at y 27.075. The LVD gives
    // this platform three vertices rather than two — it has a midpoint at
    // -40.645 — but all three share the same y, so it is flat and a single
    // centre/half-width pair reproduces it exactly.
    x: fx(-40.645),
    y: fx(27.075),
    halfWidth: fx(15.484),
    soft: true,
    ledges: false,
  },
  {
    x: fx(40.645),
    y: fx(27.075),
    halfWidth: fx(15.484),
    soft: true,
    ledges: false,
  },
];

export const POKEMON_STADIUM_2_BLAST_ZONE = {
  left: fx(-250),
  right: fx(250),
  top: fx(180),
  bottom: fx(-125),
};

/** Two on the platforms, two on the floor — the stage's own opening positions. */
export const POKEMON_STADIUM_2_SPAWNS = [
  { x: fx(-45), y: fx(27.075) },
  { x: fx(45), y: fx(27.075) },
  { x: fx(-20), y: fx(0.013) },
  { x: fx(20), y: fx(0.013) },
];

export const pokemonStadium2: StageDef = {
  id: "pokemonStadium2",
  name: "Pokémon Stadium 2",
  series: "Pokémon",
  platforms: POKEMON_STADIUM_2_PLATFORMS,
  blastZone: POKEMON_STADIUM_2_BLAST_ZONE,
  spawns: POKEMON_STADIUM_2_SPAWNS,
  theme: "pokemonStadium2",
};
