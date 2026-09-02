/**
 * The invented channel/pattern/track colour palette (lane 1 §11: HSL-clamped
 * S 35–60%, L 45–65%). No FL Studio colour values are copied.
 *
 * Kept in `domain` because `defaultProject` needs it and a colour is stored
 * domain state; the picker UI that offers these lives in `components`.
 */

export const PALETTE: readonly string[] = [
  "hsl(4, 55%, 55%)", // rose
  "hsl(28, 58%, 54%)", // amber
  "hsl(48, 52%, 52%)", // straw
  "hsl(96, 40%, 50%)", // moss
  "hsl(150, 42%, 48%)", // jade
  "hsl(178, 45%, 48%)", // teal
  "hsl(200, 52%, 55%)", // sky
  "hsl(222, 50%, 58%)", // indigo
  "hsl(262, 42%, 58%)", // violet
  "hsl(300, 38%, 55%)", // orchid
  "hsl(330, 48%, 58%)", // pink
  "hsl(15, 35%, 50%)", // clay
];

/** Deterministic pick, so a default project is byte-identical every time. */
export function colorAt(index: number): string {
  const palette = PALETTE;
  const entry = palette[((index % palette.length) + palette.length) % palette.length];
  return entry ?? "hsl(200, 52%, 55%)";
}
