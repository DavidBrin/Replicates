import type { Biome, Building, Decoration, PlayerColour, Terrain } from "@/engine/types";

/**
 * Flat colours for the editor grid and the map thumbnails, from SPEC §8's
 * measured palette. The real sprites are the render slice's
 * (`src/render/**`); the editor only needs a legible coloured square per
 * tile and a glyph per object, so it carries its own small table rather
 * than depending on a module that may not exist yet.
 */

export const TERRAIN_FILL: Record<Terrain, string> = {
  grass: "#B0D848",
  sand: "#F4BF73",
  snow: "#F2F2F2",
  water: "#2898F0",
  bridge: "#C08A4F",
  grassField: "#99D333",
  grave: "#AFB9D2",
  forestPine: "#209058",
  forestPalm: "#2E9E5A",
  forestIcePine: "#9FD3E8",
  mountain: "#A86061",
};

export const TERRAIN_GRID: Record<Biome, string> = {
  grass: "#8DAD3A",
  desert: "#C39A5C",
  snow: "#C2C2C2",
};

/** The ground tile each biome paints by default. */
export const BIOME_BASE: Record<Biome, Terrain> = {
  grass: "grass",
  desert: "sand",
  snow: "snow",
};

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

export const BUILDING_GLYPH: Record<Building, string> = {
  city: "C",
  farm: "F",
  mine: "M",
  chest: "$",
  woodwall: "W",
  stoneTower: "T",
};

export const DECORATION_DOT: Record<Decoration, string> = {
  rock: "#838A9C",
  flowerWhite: "#FFFFFF",
  flowerPurple: "#8E44AD",
  bush: "#1F5847",
  tree: "#502820",
};

export const UI = {
  outline: "#1A1010",
  sky: "#2898F0",
  woodDark: "#804A1D",
  woodLight: "#A1632D",
  woodFooter: "#5E3414",
  green: "#228F00",
  greenLight: "#52C73F",
  red: "#DF2607",
  cardYellow: "#F6D83C",
  cream: "#F1E2B2",
  khaki: "#E3C798",
  road: "#F0CE70",
  gold: "#FED942",
  medalGreen: "#9BE83B",
  medalGrey: "#7A7A7A",
} as const;

/** The four-direction outline SPEC §8 gives every piece of UI text. */
export const PIXEL_TEXT_SHADOW =
  "-2px -2px 0 #1A1010, 2px -2px 0 #1A1010, -2px 2px 0 #1A1010, 2px 2px 0 #1A1010";
