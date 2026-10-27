/**
 * The product's name, in one place.
 *
 * The directory, the wiki slug and the David-Internet slug all keep the old
 * `super-smash` spelling on purpose (spec §3.1): renaming them would break the
 * docs mirror and every inbound link. Only what a player reads changes, and a
 * constant is how "only what a player reads" stays a short, testable list.
 */
export const PRODUCT_NAME = "David-Smash";

/** The network namespace: Trystero's appId and the BroadcastChannel prefix. */
export const PRODUCT_SLUG = "david-smash";

/** `"Main Menu · David-Smash"` — every route's `<title>`. */
export function pageTitle(screen: string): string {
  return `${screen} · ${PRODUCT_NAME}`;
}
