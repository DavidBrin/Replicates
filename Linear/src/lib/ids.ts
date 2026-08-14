/**
 * Id generation, and the two slugs that are not ids.
 *
 * Every row in this database carries an application-generated, prefixed id
 * rather than a database sequence or a bare UUID. `entities.ts` states the
 * reasoning; this module is the implementation, and it is deliberately usable
 * from the browser. That is the whole point of generating ids client-side: an
 * optimistic issue can be rendered, referenced by its children, and reconciled
 * by id when the write lands, instead of being patched by position.
 *
 * ## Why base-62 and not nanoid's default alphabet
 *
 * nanoid's default alphabet includes `-` and `_`. An underscore inside the
 * random half of `iss_a-b_c` makes the id ambiguous to split, and this codebase
 * splits it in exactly one place that matters — {@link idPrefix}, which is what
 * a log line and a `expect(id).toMatch(...)` lean on. Restricting the alphabet
 * to base-62 costs 3 bits of entropy per character and buys an id whose prefix
 * can be read off by a human and by a regex that cannot be wrong.
 *
 * Sixteen characters of base-62 is ~95 bits — a collision needs on the order of
 * 10^14 ids in one table before it is worth thinking about, which is several
 * orders of magnitude past "a demo workspace".
 */

import { customAlphabet } from "nanoid";

import type { Id } from "@/domain/entities";

/* ================================================================== ids == */

/**
 * Every prefix in the system, and the entity each names.
 *
 * A record rather than a bare tuple, because the mapping is the documentation:
 * `rel` and `rct` are two characters apart and name completely different
 * things, and a reader hitting `rct_` in a stack trace should not have to
 * guess.
 */
export const ID_PREFIXES = Object.freeze({
  usr: "user",
  wsp: "workspace",
  tem: "team",
  sta: "workflow state",
  lbl: "label",
  prj: "project",
  mil: "project milestone",
  upd: "project update",
  iss: "issue",
  rel: "issue relation",
  cmt: "comment",
  rct: "reaction",
  act: "activity",
  ntf: "notification",
  inv: "invite",
  viw: "saved view",
} as const);

export type IdPrefix = keyof typeof ID_PREFIXES;

/** Ascending-ASCII base 62 — the same alphabet the order keys use. */
const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const ID_LENGTH = 16;

const random = customAlphabet(ALPHABET, ID_LENGTH);

/**
 * A fresh id for `prefix`.
 *
 * The return type is narrowed to `Id<P>`, which is a branded string: assigning
 * a `Id<"iss">` where a `Id<"prj">` is expected is a type error even though
 * both are strings at runtime. The brand is optional (`__prefix?`) so a plain
 * string still flows in from the database without a cast — the check is a
 * guard-rail for hand-written code, not a wall.
 */
export function newId<P extends IdPrefix>(prefix: P): Id<P> {
  return `${prefix}_${random()}`;
}

/** The prefix of an id, or null if it does not carry a known one. */
export function idPrefix(id: string): IdPrefix | null {
  const separator = id.indexOf("_");
  if (separator <= 0) return null;
  const candidate = id.slice(0, separator);
  return candidate in ID_PREFIXES ? (candidate as IdPrefix) : null;
}

/**
 * Whether `value` is an id of `prefix`.
 *
 * Worth using at trust boundaries — a route handler taking `issueId` from a
 * URL segment. A mis-typed id otherwise reaches the database and comes back as
 * "not found", which reads as a missing row rather than a wrong argument.
 */
export function isId<P extends IdPrefix>(
  value: unknown,
  prefix: P,
): value is Id<P> {
  return (
    typeof value === "string" &&
    value.length === prefix.length + 1 + ID_LENGTH &&
    value.startsWith(`${prefix}_`) &&
    isBase62(value.slice(prefix.length + 1))
  );
}

function isBase62(value: string): boolean {
  for (const char of value) {
    if (!ALPHABET.includes(char)) return false;
  }
  return value.length > 0;
}

/**
 * An id derived from a seed string — same shape, no randomness.
 *
 * Only the demo seed uses it, and it needs it: re-running the seed has to
 * produce the same workspace, which means the same ids, or a bookmarked issue
 * URL breaks every time the database is rebuilt. Hand-written ids like
 * `iss_demo_eng_1` would do that too and would fail {@link isId}, so the seeded
 * data would be the one data set the app's own boundary checks reject.
 *
 * FNV-1a over the seed, emitted as base-62 digits and re-hashed when the
 * 64 bits run out. Not a cryptographic hash and not trying to be: the property
 * needed is "same input, same output, and no two seeds in one workspace
 * collide", which 64 bits over ~150 ids gives with room to spare.
 */
export function deterministicId<P extends IdPrefix>(
  prefix: P,
  seed: string,
): Id<P> {
  const MASK = 0xffffffffffffffffn;
  const hash = (input: string): bigint => {
    let value = 0xcbf29ce484222325n;
    for (const char of input) {
      value ^= BigInt(char.codePointAt(0) ?? 0);
      value = (value * 0x100000001b3n) & MASK;
    }
    return value;
  };

  let state = hash(`${prefix}:${seed}`);
  let out = "";
  for (let index = 0; index < ID_LENGTH; index += 1) {
    out += ALPHABET[Number(state % 62n)] ?? "0";
    state /= 62n;
    if (state === 0n) state = hash(`${prefix}:${seed}:${index}`);
  }
  return `${prefix}_${out}`;
}

/**
 * A short random token in the same alphabet, for things that are not ids.
 *
 * Two callers: the hex-ish suffix on a project slug, and invite tokens. An
 * invite token is a bearer credential — whoever holds the link may accept it —
 * so the default length is generous rather than pretty.
 */
export function randomToken(length = 32): string {
  return customAlphabet(ALPHABET, length)();
}

/* ================================================================ slugs == */

/**
 * A URL-safe slug.
 *
 * Accent folding is done with `normalize("NFKD")` plus a combining-mark strip,
 * so "Équipe Créative" becomes `equipe-creative` rather than `quipe-crative`.
 * Dropping the marks without decomposing first is the common bug, and it eats
 * the letter along with the accent.
 *
 * @param fallback returned when the input slugifies to nothing at all — a name
 *   made entirely of CJK characters or emoji does, and a workspace whose URL
 *   key is the empty string is not a recoverable state.
 */
export function slugify(value: string, fallback = "untitled"): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug === "" ? fallback : slug;
}

/**
 * A project's `slugId`: the slugified name with a stable token appended.
 *
 * Linear does the same (`…/project/singularity-mvp-planning-43620d505e2d`), and
 * the token is the part that earns its keep — it is what keeps a project's URL
 * working after a rename, and what stops two projects called "Q1 Planning" from
 * colliding on a unique index. Pass `token` to make the result deterministic;
 * the seed does, so re-seeding produces the same URLs.
 */
export function projectSlug(name: string, token = randomToken(12)): string {
  return `${slugify(name, "project")}-${token.toLowerCase()}`;
}

/**
 * A workspace URL key from its name.
 *
 * Same shape as {@link slugify} with a shorter cap, because this one appears in
 * every path segment the app ever renders (`/{urlKey}/team/ENG/all`).
 */
export function workspaceUrlKey(name: string): string {
  return slugify(name, "workspace").slice(0, 24).replace(/-+$/g, "");
}

/**
 * A team key — the `ENG` in `ENG-123`.
 *
 * Linear publishes no rule for this; `research/03-data-model.md` §3.1 settles
 * on `^[A-Z0-9]{1,5}$` from observed keys. Multi-word names take their
 * initials, which is what Linear's own generator appears to do ("Customer
 * Support" → `CS`); a single word takes its first three characters.
 */
export function teamKey(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((word) => word.length > 0);

  if (words.length === 0) return "TEAM";
  if (words.length === 1) return words[0]!.slice(0, 3);
  return words
    .map((word) => word[0]!)
    .join("")
    .slice(0, 5);
}
