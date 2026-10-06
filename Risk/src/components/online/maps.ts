import { FIXTURE_SLUGS, MAP_SLUGS } from "@/content/maps";

/**
 * The slugs a lobby may actually choose from.
 *
 * `MAP_SLUGS` is the whole catalogue and includes the four engine fixtures,
 * which are loadable but **never appear in a picker** (D39) — they exist for
 * the engine suites and for the tiny-map e2e. Importing the catalogue's
 * enumeration rather than restating twelve names keeps this a filter rather
 * than a second list to forget to update.
 *
 * The names are derived from the slug rather than fetched: the real titles
 * live inside each map file, and loading twelve of them to label a dropdown
 * would pull every board's geometry into the lobby bundle, which is exactly
 * what D40's per-slug dynamic import exists to prevent.
 */
export const PLAYABLE_MAP_SLUGS: readonly string[] = MAP_SLUGS.filter(
  (slug) => !FIXTURE_SLUGS.includes(slug),
);

/** `classic-world` → `Classic World`. */
export function mapLabel(slug: string): string {
  return slug
    .split("-")
    .map((word) => (word.length <= 3 ? word.toUpperCase() : word[0]!.toUpperCase() + word.slice(1)))
    .join(" ");
}
