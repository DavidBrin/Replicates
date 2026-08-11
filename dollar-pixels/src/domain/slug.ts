/**
 * Page slugs and user handles.
 *
 * The reserved list is the load-bearing part: a page slugged `api` or `new`
 * would shadow a real route, and a page slugged `the-wall` would collide with
 * the flagship. Slugs are unique across every page kind, so an unlisted
 * private page still consumes the name.
 */

export const SLUG_MIN = 3;
export const SLUG_MAX = 32;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Names a page may not take.
 *
 * Every top-level route segment, plus the flagship, plus a few that would be
 * actively confusing to hand to a stranger.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "api",
  "new",
  "pages",
  "page",
  "dashboard",
  "checkout",
  "the-wall",
  "wall",
  "admin",
  "settings",
  "login",
  "logout",
  "signin",
  "signout",
  "session",
  "orders",
  "order",
  "static",
  "_next",
  "favicon",
  "robots",
  "sitemap",
  "public",
  "null",
  "undefined",
]);

export type SlugError =
  | "too-short"
  | "too-long"
  | "bad-characters"
  | "reserved";

export function validateSlug(slug: string): SlugError | null {
  if (slug.length < SLUG_MIN) return "too-short";
  if (slug.length > SLUG_MAX) return "too-long";
  if (!SLUG_RE.test(slug)) return "bad-characters";
  if (RESERVED_SLUGS.has(slug)) return "reserved";
  return null;
}

export function isValidSlug(slug: string): boolean {
  return validateSlug(slug) === null;
}

export function slugErrorMessage(error: SlugError): string {
  switch (error) {
    case "too-short":
      return `Needs at least ${SLUG_MIN} characters.`;
    case "too-long":
      return `Keep it to ${SLUG_MAX} characters or fewer.`;
    case "bad-characters":
      return "Lowercase letters, numbers and single hyphens only.";
    case "reserved":
      return "That name is taken by the site itself.";
  }
}

/**
 * Best-effort slug from free text.
 *
 * Deliberately lossy and never throws — it seeds an input the user can then
 * edit, so an empty result is a legitimate outcome that the field reports.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    // Combining diacritics, which NFKD has just split off from their letters.
    // Written as escapes: the literal range is invisible in an editor and
    // silently becomes an empty class if anything re-normalises the file.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

/* --------------------------------------------------------------- handles -- */

export const HANDLE_MAX = 24;

/**
 * A handle from a display name, with a disambiguating suffix when taken.
 *
 * Falls back to `pixeler` rather than an empty string, because a display name
 * of entirely non-Latin characters slugifies to nothing and an empty handle
 * would collide with every other empty handle.
 */
export function handleFrom(displayName: string, taken: ReadonlySet<string>): string {
  const base = slugify(displayName).slice(0, HANDLE_MAX) || "pixeler";
  if (!taken.has(base)) return base;
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${base.slice(0, HANDLE_MAX - String(n).length - 1)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error("could not allocate a handle");
}
