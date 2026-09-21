import type { Biome, PlayerColour } from "@/engine/types";

/**
 * Every colour the renderer uses, measured from the store screenshots
 * (`research/05-visual-design.md`, SPEC §8). Nothing in `render/` or
 * `components/game/` may spell a hex literal that is not defined here.
 */

/** The warm near-black every outline uses — never pure black (SPEC §8). */
export const OUTLINE = "#1A1010";
export const WHITE = "#FFFFFF";

export const GROUND: Record<Biome, { fill: string; grid: string; fleck: string }> = {
  grass: { fill: "#B0D848", grid: "#8DAD3A", fleck: "#586C24" },
  desert: { fill: "#F4BF73", grid: "#C39A5C", fleck: "#C39A5C" },
  snow: { fill: "#F2F2F2", grid: "#C2C2C2", fleck: "#C9DDE8" },
};

export const FIELD = { fill: "#99D333", border: "#7AA928" };

export const WATER = {
  fill: "#2898F0",
  shade: "#1453BB",
  icy: "#D5EFFE",
  icyShade: "#9FD3E8",
  beach: "#F0CE70",
};

export const ROAD = "#F0CE70";
export const WOOD = { light: "#C08A4F", mid: "#A28444", dark: "#7D4F1F" };

export const PINE = {
  canopy: "#209058",
  shadow: "#1F5847",
  highlight: "#60C05F",
  trunk: "#502820",
};
export const PALM = { canopy: "#209058", shadow: "#1F5847", highlight: "#60C05F", trunk: "#7D4F1F" };
export const ICE_PINE = { canopy: "#9FD3E8", shadow: "#5E9BC2", highlight: "#D5EFFE", trunk: "#502820" };

export const MOUNTAIN = { mid: "#A86061", highlight: "#BF806F", shadow: "#784049" };
export const STONE = { light: "#AFB9D2", mid: "#838A9C", dark: "#4D525E" };
export const GOLD = { face: "#FED942", rim: "#D7A800" };
export const GRAVE = { stone: "#AFB9D2", shadow: "#4D525E", mound: "#8DAD3A" };

export const SKIN = "#E8B48A";
export const HAIR = "#6B3E1E";
export const TROUSERS = "#6B4A2B";
export const ARMOUR = "#838A9C";
export const ARMOUR_LIGHT = "#AFB9D2";

export const UI = {
  buyGreen: "#228F00",
  unaffordableRed: "#DF2607",
  cardYellow: "#F6D83C",
  cardCream: "#F1E2B2",
  cardKhaki: "#E3C798",
  cardBrown: "#805128",
  woodPanel: "#804A1D",
  woodPanelLight: "#A1632D",
  sky: "#2898F0",
  chartAmber: "#FBC856",
  cardGreen: "#9AD334",
  upkeepRed: "#C6293B",
  disabledGrey: "#8A8A8A",
};

/** The eight seat colours in seat order (SPEC §8, D20). */
export const PLAYER_HEX: Record<PlayerColour, string> = {
  blue: "#337DF8",
  red: "#C6293B",
  green: "#52C73F",
  yellow: "#F2C531",
  purple: "#8E44AD",
  pink: "#DE26D3",
  orange: "#F07C2A",
  grey: "#595959",
};

/** Neutral land beads / roofs: the measured grey. */
export const NEUTRAL_HEX = "#595959";

/** Darkened 15 % for the HUD bar (SPEC §8: blue `#3D4FC4`-class). */
export function darken(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const f = 1 - amount;
  return rgbToHex(Math.round(r * f), Math.round(g * f), Math.round(b * f));
}

export function lighten(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(
    Math.round(r + (255 - r) * amount),
    Math.round(g + (255 - g) * amount),
    Math.round(b + (255 - b) * amount),
  );
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.replace("#", ""), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

export function hudColour(colour: PlayerColour): string {
  return darken(PLAYER_HEX[colour], 0.15);
}

export function playerHex(colour: PlayerColour | null | undefined): string {
  return colour ? PLAYER_HEX[colour] : NEUTRAL_HEX;
}
