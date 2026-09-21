import type { Biome } from "@/engine/types";

import {
  FIELD,
  GRAVE,
  GROUND,
  ICE_PINE,
  MOUNTAIN,
  OUTLINE,
  PALM,
  PINE,
  ROAD,
  WATER,
  WHITE,
  WOOD,
} from "../palette";
import { NATIVE, hash2, type Pix } from "./pix";

/**
 * Terrain painters, all 32 native px (SPEC §8 "How each element is drawn").
 * `variant` picks a fleck layout so neighbouring tiles do not repeat; the
 * renderer derives it from the tile coordinates.
 */

export function paintGround(p: Pix, biome: Biome, variant: number): void {
  const g = GROUND[biome];
  p.rect(0, 0, NATIVE, NATIVE, g.fill);
  const count = 4 + (variant % 3);
  for (let i = 0; i < count; i++) {
    const x = 2 + Math.floor(hash2(variant * 31 + i, 7) * 28);
    const y = 2 + Math.floor(hash2(variant * 17 + i, 11) * 28);
    p.px(x, y, g.fleck);
    if (biome === "grass" && i % 2 === 0) p.px(x + 1, y, g.fleck);
    if (biome === "snow") p.px(x + 1, y, WHITE);
  }
  if (biome === "grass" && variant % 4 === 1) {
    // a tiny white flower cluster
    const x = 6 + (variant * 5) % 16;
    const y = 18 + (variant * 3) % 8;
    p.px(x, y, WHITE);
    p.px(x + 2, y + 1, WHITE);
    p.px(x + 1, y + 2, WHITE);
  }
}

/** Water: flat fill with 1 px current dashes that shift with `frame` (0/1). */
export function paintWater(p: Pix, biome: Biome, frame: number): void {
  const icy = biome === "snow";
  p.rect(0, 0, NATIVE, NATIVE, icy ? WATER.icy : WATER.fill);
  const dash = icy ? WATER.icyShade : WATER.shade;
  const shift = frame % 2 === 0 ? 0 : 3;
  for (let row = 0; row < 4; row++) {
    const y = 5 + row * 8;
    const x = ((row * 9 + shift) % 20) + 2;
    p.hline(x, y, 6, dash);
    p.hline(x + 14, y + 3, 4, dash);
  }
  if (icy) {
    // ice floes
    p.rect(4, 6, 7, 4, WHITE);
    p.rect(19, 20, 8, 5, WHITE);
  }
}

/** A beach fringe strip along one edge of a water tile that touches land. */
export function paintBeach(p: Pix, edge: "n" | "e" | "s" | "w"): void {
  const t = 3;
  switch (edge) {
    case "n":
      p.rect(0, 0, NATIVE, t, WATER.beach);
      p.hline(0, t, NATIVE, OUTLINE);
      break;
    case "s":
      p.rect(0, NATIVE - t, NATIVE, t, WATER.beach);
      p.hline(0, NATIVE - t - 1, NATIVE, OUTLINE);
      break;
    case "w":
      p.rect(0, 0, t, NATIVE, WATER.beach);
      p.vline(t, 0, NATIVE, OUTLINE);
      break;
    case "e":
      p.rect(NATIVE - t, 0, t, NATIVE, WATER.beach);
      p.vline(NATIVE - t - 1, 0, NATIVE, OUTLINE);
      break;
  }
}

/** Bridge: 6 plank rows across the water; frame 0 = spans N–S, 1 = spans E–W. */
export function paintBridge(p: Pix, biome: Biome, frame: number): void {
  paintWater(p, biome, 0);
  const vertical = frame % 2 === 0;
  if (vertical) {
    p.rect(6, 0, 20, NATIVE, WOOD.mid);
    for (let i = 0; i < 6; i++) p.hline(6, 2 + i * 5, 20, WOOD.dark);
    p.vline(5, 0, NATIVE, OUTLINE);
    p.vline(26, 0, NATIVE, OUTLINE);
    p.vline(7, 0, NATIVE, WOOD.light);
    p.vline(24, 0, NATIVE, WOOD.light);
  } else {
    p.rect(0, 6, NATIVE, 20, WOOD.mid);
    for (let i = 0; i < 6; i++) p.vline(2 + i * 5, 6, 20, WOOD.dark);
    p.hline(0, 5, NATIVE, OUTLINE);
    p.hline(0, 26, NATIVE, OUTLINE);
    p.hline(0, 7, NATIVE, WOOD.light);
    p.hline(0, 24, NATIVE, WOOD.light);
  }
}

/** Grass field: base tile plus an inset 24×24 rounded square in `#99D333`. */
export function paintField(p: Pix, biome: Biome): void {
  paintGround(p, biome, 0);
  p.rect(5, 4, 22, 24, FIELD.border);
  p.rect(4, 5, 24, 22, FIELD.border);
  p.rect(6, 5, 20, 22, FIELD.fill);
  p.rect(5, 6, 22, 20, FIELD.fill);
  for (let i = 0; i < 6; i++) {
    p.px(8 + i * 3, 9 + (i % 3) * 5, FIELD.border);
    p.px(9 + i * 3, 10 + (i % 3) * 5, FIELD.border);
  }
}

/** Grave: an 8×10 rounded-top tombstone on a 12×4 mound. */
export function paintGrave(p: Pix, biome: Biome): void {
  paintGround(p, biome, 2);
  p.rect(10, 24, 12, 4, GRAVE.mound);
  p.hline(10, 28, 12, OUTLINE);
  p.rect(12, 14, 8, 10, GRAVE.stone);
  p.hline(13, 13, 6, GRAVE.stone);
  p.rect(18, 15, 2, 9, GRAVE.shadow);
  p.frame(12, 14, 8, 10, OUTLINE);
  p.hline(13, 13, 6, OUTLINE);
  p.px(12, 13, OUTLINE);
  p.px(19, 13, OUTLINE);
  p.hline(12, 12, 8, OUTLINE);
  p.hline(13, 12, 6, GRAVE.stone);
  // cross scratch
  p.vline(15, 16, 5, GRAVE.shadow);
  p.hline(14, 17, 3, GRAVE.shadow);
  p.px(9, 26, WHITE);
}

interface TreePalette {
  canopy: string;
  shadow: string;
  highlight: string;
  trunk: string;
}

function pineAt(p: Pix, ax: number, ay: number, pal: TreePalette): void {
  p.triangle(ax, ay - 1, 9, OUTLINE);
  p.rect(ax - 8, ay + 8, 17, 1, OUTLINE);
  p.triangle(ax, ay, 8, pal.canopy);
  for (let i = 2; i < 8; i++) p.rect(ax + 1, ay + i, i - 1, 1, pal.shadow);
  p.px(ax - 1, ay + 3, pal.highlight);
  p.px(ax - 2, ay + 5, pal.highlight);
  p.rect(ax - 1, ay + 8, 3, 3, OUTLINE);
  p.rect(ax, ay + 8, 1, 3, pal.trunk);
}

/** Forest: 4 overlapping pines in two rows. */
export function paintForest(p: Pix, biome: Biome, kind: "pine" | "palm" | "ice"): void {
  paintGround(p, biome, 3);
  if (kind === "palm") {
    paintPalms(p);
    return;
  }
  const pal = kind === "ice" ? ICE_PINE : PINE;
  pineAt(p, 8, 2, pal);
  pineAt(p, 24, 2, pal);
  pineAt(p, 16, 12, pal);
  pineAt(p, 4, 18, pal);
  pineAt(p, 28, 18, pal);
}

function palmAt(p: Pix, cx: number, top: number): void {
  p.rect(cx - 1, top + 6, 3, 10, OUTLINE);
  p.rect(cx, top + 6, 1, 10, PALM.trunk);
  // 5 fronds from a top point
  const fronds: Array<[number, number]> = [
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
    [0, 1],
  ];
  fronds.forEach(([dx, dy], i) => {
    for (let s = 0; s < 6; s++) {
      const x = cx + dx * s;
      const y = top + (dy === 0 ? s / 2 : s) - (i === 4 ? 2 : 0);
      p.px(x - 1, y, OUTLINE);
      p.px(x + 1, y, OUTLINE);
      p.px(x, y + 1, OUTLINE);
      p.px(x, y, s < 3 ? PALM.highlight : PALM.canopy);
    }
  });
  p.px(cx, top + 4, PALM.shadow);
}

function paintPalms(p: Pix): void {
  palmAt(p, 9, 2);
  palmAt(p, 23, 6);
  palmAt(p, 15, 15);
}

/** Mountain: 3 stacked rounded boulders in the rose palette, biome-independent. */
export function paintMountain(p: Pix, biome: Biome): void {
  paintGround(p, biome, 1);
  const boulder = (cx: number, cy: number, r: number) => {
    p.disc(cx, cy, r + 1, OUTLINE);
    p.rect(cx - r - 1, cy, r * 2 + 3, r + 1, OUTLINE);
    p.disc(cx, cy, r, MOUNTAIN.mid);
    p.rect(cx - r, cy, r * 2 + 1, r, MOUNTAIN.mid);
    p.disc(cx - Math.ceil(r / 2), cy - Math.ceil(r / 2), Math.max(1, Math.floor(r / 3)), MOUNTAIN.highlight);
    p.rect(cx + 1, cy + Math.floor(r / 2), r, 1, MOUNTAIN.shadow);
    p.vline(cx + r - 1, cy - 1, r, MOUNTAIN.shadow);
  };
  boulder(8, 20, 6);
  boulder(24, 21, 6);
  boulder(16, 13, 7);
  p.hline(3, 28, 26, OUTLINE);
}

/** Road overlay: connects to the edges whose neighbours also carry a road. `mask` bits N=1 E=2 S=4 W=8. */
export function paintRoad(p: Pix, mask: number): void {
  const half = 7;
  const c = 16;
  p.rect(c - half, c - half, half * 2, half * 2, ROAD);
  if (mask & 1) p.rect(c - half, 0, half * 2, c, ROAD);
  if (mask & 4) p.rect(c - half, c, half * 2, NATIVE - c, ROAD);
  if (mask & 8) p.rect(0, c - half, c, half * 2, ROAD);
  if (mask & 2) p.rect(c, c - half, NATIVE - c, half * 2, ROAD);
  for (let i = 0; i < 5; i++) {
    p.px(10 + i * 4, 14 + (i % 2) * 5, WOOD.light);
  }
}

export function paintDecoration(
  p: Pix,
  kind: "rock" | "flowerWhite" | "flowerPurple" | "bush" | "tree",
): void {
  switch (kind) {
    case "rock":
      p.rect(11, 20, 8, 4, OUTLINE);
      p.rect(12, 19, 6, 1, OUTLINE);
      p.rect(12, 20, 6, 3, "#8A8A8A");
      p.rect(13, 20, 3, 1, "#B5B5B5");
      p.rect(12, 22, 6, 1, "#5C5C5C");
      break;
    case "flowerWhite":
    case "flowerPurple": {
      const petal = kind === "flowerWhite" ? WHITE : "#A24BD6";
      const centre = "#F2C531";
      p.px(12, 14, petal);
      p.px(10, 15, petal);
      p.px(14, 15, petal);
      p.px(12, 16, petal);
      p.px(12, 15, centre);
      p.vline(12, 17, 3, PINE.shadow);
      p.px(20, 21, petal);
      p.px(19, 22, petal);
      p.px(21, 22, petal);
      p.px(20, 23, petal);
      p.px(20, 22, centre);
      p.vline(20, 24, 2, PINE.shadow);
      break;
    }
    case "bush":
      p.disc(12, 22, 5, OUTLINE);
      p.disc(19, 21, 5, OUTLINE);
      p.disc(12, 22, 4, PINE.canopy);
      p.disc(19, 21, 4, PINE.canopy);
      p.rect(9, 20, 3, 1, PINE.highlight);
      p.rect(17, 19, 3, 1, PINE.highlight);
      p.rect(8, 24, 14, 1, PINE.shadow);
      break;
    case "tree":
      pineAt(p, 16, 8, PINE);
      break;
  }
}
