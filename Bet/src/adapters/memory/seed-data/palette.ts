/**
 * Seed-specific palette: the fixed 12-swatch avatar ramp, plus a re-export
 * of the shared tokens the rest of the seed data reads by name.
 *
 * The swatch values themselves — and `OUTCOME_COLOR_CYCLE`, which
 * `POST /api/markets` also needs — now live in `src/domain/palette.ts`, so
 * the app layer can reach them without importing seed data and without
 * keeping a second copy (final-review minor #4). What stays here is the one
 * thing that really is seed-only: which color each of the 12 demo users
 * gets.
 */

export {
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
  OUTCOME_COLOR_CYCLE,
} from "@/domain/palette";

import {
  TOKEN_ACCENT,
  TOKEN_ACCENT_2,
  TOKEN_BLUE,
  TOKEN_GOLD,
  TOKEN_MAGENTA,
  TOKEN_MINT,
  TOKEN_NO,
  TOKEN_ORANGE,
  TOKEN_PURPLE,
  TOKEN_TEAL,
  TOKEN_WARN,
  TOKEN_YES,
} from "@/domain/palette";

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
