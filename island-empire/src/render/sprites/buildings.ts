import type { Biome } from "@/engine/types";

import {
  GOLD,
  MOUNTAIN,
  OUTLINE,
  ROAD,
  STONE,
  UI,
  WHITE,
  WOOD,
  darken,
  lighten,
} from "../palette";
import type { Pix } from "./pix";

/**
 * Building painters (SPEC §8 table). Every building is drawn over a
 * transparent tile — the ground underneath is a separate blit — and casts a
 * soft flat shadow ellipse at its base.
 */

function shadow(p: Pix, cx: number, cy: number, rx: number): void {
  p.ctx.save();
  p.ctx.globalAlpha = 0.22;
  p.rect(cx - rx, cy, rx * 2, 2, OUTLINE);
  p.rect(cx - rx + 2, cy + 2, rx * 2 - 4, 1, OUTLINE);
  p.ctx.restore();
}

/** A peaked-roof cottage; `w` even, roof `h` rows, wall `wh` rows. */
function house(
  p: Pix,
  x: number,
  y: number,
  w: number,
  wh: number,
  roof: string,
  wall: string,
  door = true,
): void {
  const rh = Math.floor(w / 2) - 1;
  // roof
  for (let i = 0; i < rh; i++) {
    const inset = rh - 1 - i;
    p.rect(x + inset - 1, y + i, w - inset * 2 + 2, 1, OUTLINE);
    p.rect(x + inset, y + i, w - inset * 2, 1, roof);
  }
  p.rect(x - 1, y + rh, w + 2, 1, OUTLINE);
  p.rect(x + 1, y + 1, 2, 1, lighten(roof, 0.35));
  // wall
  p.rect(x, y + rh + 1, w, wh, wall);
  p.frame(x, y + rh + 1, w, wh, OUTLINE);
  p.rect(x, y + rh + 1, w, 1, darken(wall, 0.15));
  if (door) {
    p.rect(x + Math.floor(w / 2) - 1, y + rh + wh - 2, 2, 2, OUTLINE);
    p.px(x + 1, y + rh + 2, "#7FB2E5");
  }
}

function tent(p: Pix, ax: number, ay: number, h: number, colour: string): void {
  p.triangle(ax, ay - 1, h + 1, OUTLINE);
  p.rect(ax - h - 1, ay + h, h * 2 + 3, 1, OUTLINE);
  p.triangle(ax, ay, h, colour);
  for (let i = 1; i < h; i++) p.px(ax + i - 1, ay + i, darken(colour, 0.25));
  p.rect(ax - 1, ay + h - 2, 2, 2, OUTLINE);
  p.px(ax, ay + 1, lighten(colour, 0.4));
}

/** City: a 3-house cluster; roofs in the owner colour, skin by biome. */
export function paintCity(p: Pix, biome: Biome, roof: string): void {
  shadow(p, 16, 28, 13);
  if (biome === "desert") {
    tent(p, 8, 14, 7, roof);
    tent(p, 24, 15, 7, roof);
    tent(p, 16, 7, 9, roof);
    p.rect(12, 26, 8, 2, ROAD);
    return;
  }
  const wall = biome === "snow" ? WHITE : UI.cardCream;
  house(p, 2, 12, 10, 8, roof, wall);
  house(p, 20, 13, 10, 7, roof, wall);
  house(p, 10, 3, 12, 9, roof, wall);
  p.rect(9, 27, 14, 2, ROAD);
  p.rect(14, 24, 4, 3, ROAD);
  if (biome === "snow") {
    p.rect(3, 12, 8, 1, WHITE);
    p.rect(21, 13, 8, 1, WHITE);
  }
}

/** Farm: 12×10 house beside two hay bales; roof colour by biome. */
export function paintFarm(p: Pix, biome: Biome): void {
  shadow(p, 16, 28, 12);
  const roof = biome === "grass" ? "#C6293B" : biome === "desert" ? WOOD.dark : "#5E9BC2";
  house(p, 3, 6, 12, 8, roof, WOOD.light);
  const bale = (cx: number, cy: number) => {
    p.disc(cx, cy, 5, OUTLINE);
    p.rect(cx - 6, cy - 2, 13, 5, OUTLINE);
    p.disc(cx, cy, 4, GOLD.face);
    p.rect(cx - 5, cy - 2, 11, 5, GOLD.face);
    p.rect(cx - 4, cy + 2, 9, 1, GOLD.rim);
    p.px(cx - 2, cy - 2, "#FFF3A8");
    p.px(cx + 3, cy, GOLD.rim);
    p.px(cx - 3, cy + 1, GOLD.rim);
  };
  bale(23, 12);
  bale(23, 24);
  p.rect(15, 18, 4, 2, ROAD);
}

/** Mine: a rose boulder with a 6×6 doorway and two gold ore pixels. */
export function paintMine(p: Pix): void {
  shadow(p, 16, 28, 12);
  p.disc(16, 16, 12, OUTLINE);
  p.rect(3, 16, 26, 12, OUTLINE);
  p.disc(16, 16, 11, MOUNTAIN.mid);
  p.rect(5, 16, 23, 11, MOUNTAIN.mid);
  p.disc(11, 11, 3, MOUNTAIN.highlight);
  p.rect(20, 22, 6, 1, MOUNTAIN.shadow);
  p.rect(13, 20, 6, 7, OUTLINE);
  p.rect(14, 21, 4, 6, "#0F0A0A");
  p.rect(12, 19, 8, 1, WOOD.mid);
  p.vline(12, 19, 8, WOOD.mid);
  p.vline(19, 19, 8, WOOD.mid);
  p.px(8, 20, GOLD.face);
  p.px(23, 14, GOLD.face);
  p.px(24, 15, GOLD.rim);
  // ore cart
  p.rect(22, 25, 6, 3, WOOD.dark);
  p.frame(22, 25, 6, 3, OUTLINE);
  p.px(23, 24, GOLD.face);
  p.px(25, 24, GOLD.face);
}

/** Chest: 14×10 box, dark lid band, gold clasp. */
export function paintChest(p: Pix): void {
  shadow(p, 16, 27, 8);
  p.rect(9, 12, 14, 12, WOOD.mid);
  p.frame(9, 12, 14, 12, OUTLINE);
  p.rect(9, 12, 14, 4, WOOD.dark);
  p.hline(9, 16, 14, OUTLINE);
  p.rect(10, 13, 12, 1, WOOD.light);
  p.vline(12, 17, 7, WOOD.dark);
  p.vline(19, 17, 7, WOOD.dark);
  p.rect(14, 15, 4, 4, OUTLINE);
  p.rect(15, 16, 2, 2, GOLD.face);
  p.px(16, 18, GOLD.rim);
}

/** Woodwall: 5 pointed planks, a cross brace, a small owner-colour shield. */
export function paintWoodwall(p: Pix, colour: string): void {
  shadow(p, 16, 28, 13);
  for (let i = 0; i < 5; i++) {
    const x = 3 + i * 6;
    const top = 6 + (i % 2) * 2;
    p.rect(x - 1, top - 1, 6, 24 - top + 6, OUTLINE);
    p.px(x + 1, top - 2, OUTLINE);
    p.px(x + 2, top - 2, OUTLINE);
    p.rect(x, top, 4, 28 - top, WOOD.light);
    p.rect(x + 3, top, 1, 28 - top, WOOD.dark);
    p.rect(x + 1, top - 1, 2, 1, WOOD.light);
    p.px(x, top + 4, WOOD.dark);
    p.px(x + 1, top + 9, WOOD.dark);
  }
  p.rect(2, 16, 28, 2, WOOD.dark);
  p.hline(2, 18, 28, OUTLINE);
  // shield
  p.rect(12, 19, 8, 6, OUTLINE);
  p.rect(13, 25, 6, 1, OUTLINE);
  p.rect(14, 26, 4, 1, OUTLINE);
  p.rect(13, 20, 6, 5, colour);
  p.rect(14, 25, 4, 1, colour);
  p.px(14, 21, lighten(colour, 0.4));
}

/** Stone tower: 12×24 tapered body, 3 crenels, a window slit, a pennant. */
export function paintStoneTower(p: Pix, colour: string): void {
  shadow(p, 16, 28, 9);
  // body (tapered: wider at the base)
  for (let y = 4; y < 28; y++) {
    const w = 12 + Math.floor((y - 4) / 8);
    const x = 16 - Math.floor(w / 2);
    p.rect(x - 1, y, w + 2, 1, OUTLINE);
    p.rect(x, y, w, 1, STONE.mid);
    p.rect(x, y, 2, 1, STONE.light);
    p.rect(x + w - 2, y, 2, 1, STONE.dark);
  }
  p.hline(9, 28, 15, OUTLINE);
  // brick seams
  for (let y = 8; y < 27; y += 4) {
    p.hline(11, y, 10, STONE.dark);
    p.px(13 + (y % 8 === 0 ? 0 : 3), y + 2, STONE.dark);
  }
  // crenels
  for (let i = 0; i < 3; i++) {
    const x = 10 + i * 4;
    p.rect(x - 1, 0, 4, 5, OUTLINE);
    p.rect(x, 1, 2, 4, STONE.light);
  }
  p.hline(9, 4, 14, STONE.light);
  // window slit
  p.rect(15, 12, 2, 5, OUTLINE);
  // pennant
  p.vline(21, -3, 8, OUTLINE);
  p.rect(22, -3, 5, 3, OUTLINE);
  p.rect(22, -2, 4, 1, colour);
  p.px(22, -1, colour);
  p.px(23, -3, colour);
}
