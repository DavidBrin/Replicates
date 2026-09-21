import { GOLD, OUTLINE, STONE, UI, WHITE, darken, lighten } from "../palette";
import { NATIVE, type Pix } from "./pix";

/**
 * UI glyphs drawn in canvas so the HUD, info card and strength chart share
 * one pixel vocabulary with the board (research §10). All 32×32, centred.
 */

/** A flat gold coin, 14 px across. */
export function paintCoin(p: Pix, cx = 16, cy = 16): void {
  p.disc(cx, cy, 8, OUTLINE);
  p.disc(cx, cy, 7, GOLD.rim);
  p.disc(cx - 1, cy - 1, 5, GOLD.face);
  p.rect(cx - 1, cy - 4, 2, 7, GOLD.rim);
  p.rect(cx - 3, cy - 4, 4, 1, GOLD.rim);
  p.rect(cx - 3, cy + 2, 4, 1, GOLD.rim);
  p.px(cx - 4, cy - 3, "#FFF3A8");
}

/** The income icon: a coin with a green "+" badge on its upper-left. */
export function paintIncome(p: Pix): void {
  paintCoin(p, 17, 17);
  p.disc(9, 9, 5, OUTLINE);
  p.disc(9, 9, 4, UI.buyGreen);
  p.rect(8, 6, 2, 7, WHITE);
  p.rect(6, 8, 7, 2, WHITE);
}

/** Upkeep: a small red pouch with a tie. */
export function paintUpkeep(p: Pix): void {
  const red = UI.upkeepRed;
  p.disc(16, 19, 8, OUTLINE);
  p.disc(16, 19, 7, red);
  p.rect(9, 19, 15, 6, red);
  p.rect(8, 19, 17, 6, OUTLINE);
  p.rect(9, 19, 15, 6, red);
  p.rect(9, 25, 15, 1, OUTLINE);
  p.rect(12, 9, 8, 4, OUTLINE);
  p.rect(13, 10, 6, 2, darken(red, 0.3));
  p.rect(11, 12, 10, 2, GOLD.face);
  p.frame(11, 12, 10, 2, OUTLINE);
  p.px(12, 16, lighten(red, 0.4));
  p.rect(13, 17, 2, 1, lighten(red, 0.4));
}

/** Strength: a grey sword, blade up-right. */
export function paintSword(p: Pix): void {
  for (let i = 0; i < 10; i++) {
    p.rect(20 - i - 1, 5 + i, 4, 1, OUTLINE);
    p.rect(20 - i, 5 + i, 2, 1, STONE.light);
    p.px(21 - i, 5 + i, STONE.mid);
  }
  p.rect(7, 16, 8, 2, OUTLINE);
  p.rect(8, 16, 6, 1, GOLD.rim);
  p.rect(6, 18, 5, 1, OUTLINE);
  p.rect(5, 19, 5, 1, OUTLINE);
  p.rect(6, 19, 3, 1, "#7D4F1F");
  p.rect(4, 21, 3, 3, OUTLINE);
  p.rect(5, 22, 1, 1, GOLD.face);
}

/** Shield badge: rounded-top pentagon, 20 px wide, in the defender's colour. */
export function paintShield(p: Pix, colour: string): void {
  const x = 6;
  const y = 6;
  const w = 20;
  // rounded top rows
  p.rect(x + 2, y, w - 4, 1, OUTLINE);
  p.rect(x + 1, y + 1, w - 2, 1, OUTLINE);
  p.rect(x + 2, y + 1, w - 4, 1, colour);
  p.rect(x, y + 2, w, 12, OUTLINE);
  p.rect(x + 1, y + 2, w - 2, 12, colour);
  // point
  for (let i = 0; i < 7; i++) {
    const inset = i + 1;
    p.rect(x + inset - 1, y + 14 + i, w - inset * 2 + 2, 1, OUTLINE);
    if (w - inset * 2 > 0) p.rect(x + inset, y + 14 + i, w - inset * 2, 1, colour);
  }
  p.rect(x + 2, y + 3, 3, 1, lighten(colour, 0.45));
  p.rect(x + 2, y + 4, 1, 4, lighten(colour, 0.45));
}

/** Four beads along one tile edge, inset 1 px (SPEC §8 territory borders). */
export function paintBeads(p: Pix, colour: string, orientation: "h" | "v"): void {
  // a 4×4 rounded bead: 2×2 fill inside a 1 px ring (~3 native px across)
  const bead = [".oo.", "oCCo", "oCCo", ".oo."];
  for (let i = 0; i < 4; i++) {
    const c = 2 + i * 8;
    if (orientation === "h") p.bitmap(bead, { o: OUTLINE, C: colour }, c, 0);
    else p.bitmap(bead, { o: OUTLINE, C: colour }, 0, c);
  }
}

/** Dotted frame used for the move zone and placement zone. */
export function paintDottedFrame(p: Pix): void {
  for (let i = 0; i < NATIVE; i += 4) {
    for (const [x, y] of [
      [i, 0],
      [i, NATIVE - 2],
      [0, i],
      [NATIVE - 2, i],
    ] as const) {
      p.rect(x, y, 2, 2, OUTLINE);
      p.px(x, y, WHITE);
    }
  }
}

/** A gold star for the victory modal. */
export function paintStar(p: Pix, filled: boolean): void {
  const rows = [
    "........oo........",
    ".......oggo.......",
    ".......oggo.......",
    "......ogggggo.....",
    "oooooooggggggooooo",
    "oggggggggggggggggo",
    ".oggggggggggggggo.",
    "..ogggggggggggggo.",
    "...oggggggggggo...",
    "....oggggggggo....",
    "....ogggggggggo...",
    "...ogggggooggggo..",
    "...oggggo..ogggo..",
    "..ogggo......oggo.",
    "..ooo..........oo.",
  ];
  const g = filled ? GOLD.face : "#8A8A8A";
  p.bitmap(rows, { o: OUTLINE, g }, 7, 8);
  if (filled) p.px(11, 13, "#FFF3A8");
}
