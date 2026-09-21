/**
 * The one-pixel brush every painter uses. A sprite is authored on a
 * 32×40 native canvas whose tile area is rows 8..39: the 8 rows above the
 * tile are headroom for a plume or a tower top (SPEC §8: units may overflow
 * upward by up to 8 px). Painters receive a `Pix` whose origin is the tile's
 * top-left, so negative `y` draws into the headroom.
 */

export const NATIVE = 32;
/** Rows of headroom above the tile in every sprite canvas. */
export const HEADROOM = 8;
export const SPRITE_W = NATIVE;
export const SPRITE_H = NATIVE + HEADROOM;

export interface Pix {
  ctx: CanvasRenderingContext2D;
  px(x: number, y: number, colour: string): void;
  rect(x: number, y: number, w: number, h: number, colour: string): void;
  hline(x: number, y: number, w: number, colour: string): void;
  vline(x: number, y: number, h: number, colour: string): void;
  /** A 1 px frame just outside the given rectangle. */
  frame(x: number, y: number, w: number, h: number, colour: string): void;
  /** Filled disc of integer radius, pixel-stepped. */
  disc(cx: number, cy: number, r: number, colour: string): void;
  /** Filled disc plus a 1 px outline ring. */
  ball(cx: number, cy: number, r: number, fill: string, outline: string): void;
  /** Rows of characters mapped through `legend`; `.` is transparent. */
  bitmap(rows: readonly string[], legend: Record<string, string>, x: number, y: number): void;
  /** Isosceles triangle pointing up with its apex at (ax, ay), `h` rows tall. */
  triangle(ax: number, ay: number, h: number, colour: string): void;
}

export function createPix(ctx: CanvasRenderingContext2D, originY = HEADROOM): Pix {
  ctx.imageSmoothingEnabled = false;
  const px = (x: number, y: number, colour: string) => {
    ctx.fillStyle = colour;
    ctx.fillRect(Math.round(x), Math.round(y) + originY, 1, 1);
  };
  const rect = (x: number, y: number, w: number, h: number, colour: string) => {
    if (w <= 0 || h <= 0) return;
    ctx.fillStyle = colour;
    ctx.fillRect(Math.round(x), Math.round(y) + originY, Math.round(w), Math.round(h));
  };
  const p: Pix = {
    ctx,
    px,
    rect,
    hline: (x, y, w, c) => rect(x, y, w, 1, c),
    vline: (x, y, h, c) => rect(x, y, 1, h, c),
    frame(x, y, w, h, c) {
      rect(x - 1, y - 1, w + 2, 1, c);
      rect(x - 1, y + h, w + 2, 1, c);
      rect(x - 1, y, 1, h, c);
      rect(x + w, y, 1, h, c);
    },
    disc(cx, cy, r, c) {
      for (let dy = -r; dy <= r; dy++) {
        const span = Math.floor(Math.sqrt(r * r - dy * dy + 0.25));
        rect(cx - span, cy + dy, span * 2 + 1, 1, c);
      }
    },
    ball(cx, cy, r, fill, outline) {
      p.disc(cx, cy, r + 1, outline);
      p.disc(cx, cy, r, fill);
    },
    bitmap(rows, legend, x, y) {
      rows.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) {
          const ch = row[rx];
          if (!ch || ch === ".") continue;
          const colour = legend[ch];
          if (colour) px(x + rx, y + ry, colour);
        }
      });
    },
    triangle(ax, ay, h, c) {
      for (let i = 0; i < h; i++) rect(ax - i, ay + i, i * 2 + 1, 1, c);
    },
  };
  return p;
}

/** Deterministic tiny hash for fleck placement; never Math.random. */
export function hash2(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
