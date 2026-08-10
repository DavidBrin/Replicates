/**
 * Hex swatches the seed draws avatar/outcome colors from — David's
 * ambiguity resolution: "each with a distinct avatarColor drawn from the
 * token palette." `src/app/globals.css`'s `@theme` block only names 5
 * accent-ish tokens (`--accent`, `--accent-2`, `--yes`, `--no`, `--warn`),
 * too few for 12 visually distinct people, so this also draws from the
 * broader documented accent ramp in `research/design-tokens-extracted.md`
 * ("Accents (dark)" — Polymarket's blue/purple/magenta/teal ramp, plus
 * Kalshi's mint and the leaderboard gold), which is the same design
 * research the rest of the app's tokens were extracted from. Every value
 * below is a real, sourced token — nothing invented for this file.
 */

export const TOKEN_ACCENT = "#7c6cff"; // globals.css --accent (Bet indigo)
export const TOKEN_ACCENT_2 = "#a394ff"; // globals.css --accent-2
export const TOKEN_YES = "#2bae4c"; // globals.css --yes
export const TOKEN_NO = "#f43437"; // globals.css --no
export const TOKEN_WARN = "#efc500"; // globals.css --warn
export const TOKEN_BLUE = "#4877ff"; // research/design-tokens-extracted.md, Polymarket blue-600
export const TOKEN_PURPLE = "#a261e1"; // ...purple-600
export const TOKEN_MAGENTA = "#ee2ba6"; // ...magenta-600
export const TOKEN_TEAL = "#0595b3"; // ...teal-600
export const TOKEN_ORANGE = "#ff9500"; // ...Kalshi orange-x10
export const TOKEN_MINT = "#28cc95"; // Kalshi/Explore accent
export const TOKEN_GOLD = "#e5bd45"; // Kalshi special-gold

/** Twelve distinct swatches, one per demo user, in the fixed order the
 * users are seeded (`users.ts`). */
export const AVATAR_PALETTE: readonly string[] = [
  TOKEN_ACCENT,
  TOKEN_ACCENT_2,
  TOKEN_YES,
  TOKEN_NO,
  TOKEN_WARN,
  TOKEN_BLUE,
  TOKEN_PURPLE,
  TOKEN_MAGENTA,
  TOKEN_TEAL,
  TOKEN_ORANGE,
  TOKEN_MINT,
  TOKEN_GOLD,
];

/** A cycle of colors for outcomes beyond a plain Yes(green)/No(red) pair —
 * multi-outcome private markets and Explore's multi-outcome cards pull from
 * this in order. */
export const OUTCOME_COLOR_CYCLE: readonly string[] = [
  TOKEN_ACCENT,
  TOKEN_BLUE,
  TOKEN_PURPLE,
  TOKEN_TEAL,
  TOKEN_ORANGE,
  TOKEN_MAGENTA,
  TOKEN_GOLD,
  TOKEN_ACCENT_2,
];
