/**
 * The app's sourced hex swatches, and the outcome-color cycle built from
 * them — the single source of truth for both.
 *
 * ## Why these live in `src/domain` rather than in the seed
 *
 * They used to live only in `src/adapters/memory/seed-data/palette.ts`, and
 * `POST /api/markets` carried a second, value-for-value identical copy
 * under a different name (`DEFAULT_OUTCOME_COLORS`) with a comment
 * explaining that importing the seed's copy would be unwanted coupling.
 * That reasoning was right and the conclusion was wrong: the answer to "the
 * route shouldn't depend on seed data" is to hoist the shared value, not to
 * clone it. Two copies drift — recolor the ramp in one and a market created
 * through the API silently stops matching the markets in the seed.
 *
 * An `Outcome.color` is a field of a domain entity, so its default palette
 * is domain data. Nothing here is logic; it's a table of constants that
 * both the adapter (seeding) and the app layer (market creation) read.
 *
 * ## Where the values come from
 *
 * `src/app/globals.css`'s `@theme` block only names 5 accent-ish tokens
 * (`--accent`, `--accent-2`, `--yes`, `--no`, `--warn`) — too few for 12
 * visually distinct people or an 8-outcome market — so the rest come from
 * the broader documented accent ramp in
 * `research/design-tokens-extracted.md` ("Accents (dark)": Polymarket's
 * blue/purple/magenta/teal ramp, plus Kalshi's mint and the leaderboard
 * gold), the same research the rest of the app's tokens were extracted
 * from. Every value below is a real, sourced token — nothing invented.
 *
 * These are hex literals by necessity, not a G7 violation: they are *data*
 * (a `User.avatarColor`, an `Outcome.color`) persisted per record and
 * applied via inline style, not colors a component authors for itself. G7
 * governs the latter. See `Avatar`'s `color` prop doc.
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

/**
 * A cycle of colors for outcomes beyond a plain Yes(green)/No(red) pair.
 * Read in order and wrapped modulo its length by every producer of an
 * `Outcome`: the seed's multi-outcome private markets and Explore cards
 * (`adapters/memory/seed-data/**`) and the create-bet wizard's submit
 * (`POST /api/markets`), so a market created in the app is colored exactly
 * like a seeded one.
 */
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
