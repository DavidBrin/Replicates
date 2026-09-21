import type { PlayerColour } from "@/engine/types";

/**
 * Measured palette (SPEC §8, D20) — the single source every setup/hand-off
 * component reads a seat's colour from, so a swatch, a thumbnail tint and
 * the hand-off panel are always in sync.
 */
export const COLOUR_HEX: Record<PlayerColour, string> = {
  blue: "#337DF8",
  red: "#C6293B",
  green: "#52C73F",
  yellow: "#F2C531",
  purple: "#8E44AD",
  pink: "#DE26D3",
  orange: "#F07C2A",
  grey: "#595959",
};

/** Default hot-seat display name for a seat that hasn't been renamed. */
export function colourDisplayName(colour: PlayerColour): string {
  return colour.charAt(0).toUpperCase() + colour.slice(1);
}
