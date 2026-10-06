/**
 * Append-only registry read by `layering.test.ts` (D9).
 *
 * Each engine slice adds its own line and never edits another's, so the
 * purity guard can be extended without three slices contending for one file.
 * Paths are relative to `src/engine/`.
 */

/** Files that must exist for the guard to be checking the real engine. */
export const ENGINE_ENTRY_POINTS: readonly string[] = [
  "layering.test.ts",
  "types.ts", "index.ts", "prng.ts", "resolver/index.ts",
  // S1 adds: "reducer.ts", "hash.ts"
  "odds/index.ts", "bots/index.ts",
  // S3: "map/index.ts"
];

/**
 * Bare package imports the engine may make, and the one directory each is
 * confined to. Everything else from node_modules is banned inside the engine.
 */
export const ALLOWED_PACKAGES: readonly { readonly name: string; readonly under: string }[] = [
  { name: "polylabel", under: "map/" },
];
