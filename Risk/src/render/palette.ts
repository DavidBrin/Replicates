/**
 * The painter's view of the token sheet (SPEC §8).
 *
 * `globals.css` is the only place a hex lives (F8); everything here resolves
 * a CSS custom property by name, so a component never hard-codes a colour and
 * the nine player palettes stay in one file.
 */
import type { PlayerColour } from "@/engine/types";

export const PLAYER_COLOURS: readonly PlayerColour[] = [
  "red", "green", "blue", "yellow", "orange", "pink", "black", "white", "purple",
];

export type ColourVariant = "" | "light" | "dark" | "wall" | "hot" | "on";

/** `var(--p-green-dark)` and friends, by name. */
export function playerVar(colour: PlayerColour, variant: ColourVariant = ""): string {
  return `var(--p-${colour}${variant ? `-${variant}` : ""})`;
}

/** The `data-owner` attribute value for a territory state's owner. */
export function ownerKey(owner: number, seats: readonly { seat: number; colour: PlayerColour }[]): string {
  if (owner === -2) return "neutral";
  if (owner === -3) return "unknown";
  if (owner < 0) return "none";
  return seats.find((s) => s.seat === owner)?.colour ?? "none";
}

/** Display name for a colour, used by the hand-off overlay's aria label. */
export function colourName(colour: PlayerColour): string {
  return colour.charAt(0).toUpperCase() + colour.slice(1);
}

/** Token radius by map density: 19 px on a sparse board, 15 on a dense one (§8). */
export function tokenRadius(territoryCount: number): number {
  return territoryCount > 48 ? 15 : 19;
}

/**
 * The Blitz readout is **constant gold at every probability** (D47). The
 * opt-in `winChanceRamp` setting is flagged as our usability deviation.
 */
export function winChanceColour(chance: number, ramp: boolean): string {
  if (!ramp) return "var(--gold)";
  if (chance >= 0.9) return "var(--ok)";
  if (chance >= 0.7) return "#C6D84A";
  if (chance >= 0.4) return "var(--gold)";
  if (chance >= 0.15) return "#E8863A";
  return "var(--danger)";
}

/** The colour-vision pattern id for a seat, or null when the setting is off. */
export function patternFor(colour: PlayerColour, enabled: boolean): string | null {
  if (!enabled) return null;
  const index = PLAYER_COLOURS.indexOf(colour);
  return `cv-${["dots", "diagonal", "cross"][index % 3]}`;
}

/** Continent accent tokens, by continent index, cycling the six shipped hues. */
export const CONTINENT_VARS: readonly string[] = [
  "var(--c-na)", "var(--c-sa)", "var(--c-eu)", "var(--c-af)", "var(--c-as)", "var(--c-au)",
];

export function continentVar(index: number): string {
  return CONTINENT_VARS[index % CONTINENT_VARS.length] as string;
}
