/**
 * What a search query means, before anything is fetched.
 *
 * Pure, dependency-free, and imported by **both** the client dialog and
 * `/api/search` — the parse must be identical on the two sides or the
 * client's "did you mean ENG-12?" affordance and the server's identifier
 * lookup disagree, which is the sort of bug that only shows up for issue
 * numbers the user actually types.
 *
 * ## Three shapes of query
 *
 * 1. **A full identifier** — `ENG-12`, `eng-12`, `eng12`. Linear accepts all
 *    three ("`lin123` matches `LIN-123`, case- and dash-insensitive",
 *    `research/04-interaction.md` §1.4) and so does this, because the dash is
 *    the character people drop when they retype an id from memory.
 * 2. **A bare number** — `12`. Only meaningful inside a team, so it resolves
 *    against the team the user is currently looking at and is otherwise just
 *    text. A bare number that searched every team would return one row per
 *    team, all of them equally wrong.
 * 3. **Free text** — matched against issue titles and project names with
 *    `ilike`. There is no `pg_trgm` in PGlite (`DECISIONS.md` D2), so this is
 *    a substring match and not a similarity ranking; the ranking happens in
 *    {@link scoreTextMatch} instead, where it can be tested without a database.
 */

/**
 * `ENG-12`. The key may contain digits, which is why the dash is required here.
 */
const DASHED_IDENTIFIER = /^([A-Za-z][A-Za-z0-9]{0,4})-(\d+)$/;

/**
 * `eng12` — the dashless shorthand.
 *
 * A separate pattern, and the key is letters-only. Making the dash optional in
 * {@link DASHED_IDENTIFIER} looks equivalent and is not: the key group is
 * greedy, so `eng12` backtracks to a key of `ENG1` and a number of `2`, which
 * resolves to a real issue in a team that is not the one the user meant.
 */
const DASHLESS_IDENTIFIER = /^([A-Za-z]{1,5})(\d+)$/;

/** A bare issue number, meaningful only within a team. */
const BARE_NUMBER = /^\d{1,9}$/;

export interface ParsedQuery {
  /** The query with surrounding whitespace removed. Never empty when `valid`. */
  readonly text: string;
  /** True once the query is long enough to be worth a round trip. */
  readonly valid: boolean;
  /** Set when the query looks like `ENG-12`. */
  readonly identifier: { readonly teamKey: string; readonly number: number } | null;
  /** Set when the query is a bare number, e.g. `12`. */
  readonly number: number | null;
}

/**
 * The shortest query worth sending.
 *
 * One character matches most of the workspace and teaches the user nothing,
 * and every keystroke below the threshold is a round trip that will be
 * superseded before it lands. Two is the point at which `ilike '%xx%'` starts
 * to discriminate.
 */
export const MIN_QUERY_LENGTH = 2;

export function parseQuery(raw: string): ParsedQuery {
  const text = raw.trim();
  if (text === "") {
    return { text, valid: false, identifier: null, number: null };
  }

  // `ENG-12` first, then `eng12`. Both require a letter prefix, so a bare `12`
  // matches neither and falls through to the number branch below.
  const identifierMatch =
    DASHED_IDENTIFIER.exec(text) ?? DASHLESS_IDENTIFIER.exec(text);
  const identifier =
    identifierMatch !== null && identifierMatch[1] !== undefined
      ? {
          teamKey: identifierMatch[1].toUpperCase(),
          number: Number(identifierMatch[2]),
        }
      : null;

  const number = BARE_NUMBER.test(text) ? Number(text) : null;

  return {
    text,
    // An identifier or a number is always worth looking up, however short:
    // `A-1` is three characters and is an exact answer.
    valid: identifier !== null || number !== null || text.length >= MIN_QUERY_LENGTH,
    identifier,
    number,
  };
}

/** The `ilike` pattern for a free-text query, with the wildcards escaped. */
export function likePattern(text: string): string {
  // `%` and `_` are wildcards in `like`; a user searching for "100%" means the
  // character. `\` escapes them under Postgres' default `escape` character.
  const escaped = text.replace(/([\\%_])/g, "\\$1");
  return `%${escaped}%`;
}

/* =============================================================== ranking = */

export type SearchResultType = "issue" | "project";

export interface SearchResult {
  readonly type: SearchResultType;
  readonly id: string;
  /** `ENG-12` for an issue, the team key for context; null for a project. */
  readonly identifier: string | null;
  readonly title: string;
  /** Second line: the team name, the project state. */
  readonly subtitle: string | null;
  readonly href: string;
  /** Status glyph inputs, so the row can render the same icon as the list. */
  readonly stateType: string | null;
  readonly stateColor: string | null;
  /** Higher is better. Computed server-side so the order is stable. */
  readonly score: number;
}

/**
 * How well a title matches, on a scale where bigger wins.
 *
 * Deliberately coarse — four bands, not a similarity metric. `ilike` has
 * already decided *whether* the row matches, so the only job left is to order
 * the rows a human would have ordered the same way:
 *
 * | Band | Example for the query `sync` |
 * |---|---|
 * | 1000 | the whole title is `sync` |
 * |  800 | `Sync cursor drift` — a prefix |
 * |  600 | `Realtime sync engine` — a word boundary |
 * |  400 | `Resyncing` — inside a word |
 *
 * Ties break on shorter titles, which is what makes "Sync" beat "Sync the
 * cursor across a reconnect when the tab wakes" for a one-word query.
 */
export function scoreTextMatch(title: string, query: string): number {
  const haystack = title.toLowerCase();
  const needle = query.toLowerCase();
  const at = haystack.indexOf(needle);
  if (at === -1) return 0;

  const band =
    haystack === needle
      ? 1000
      : at === 0
        ? 800
        : // A match that starts a word reads as intentional; one that starts
          // mid-word usually does not.
          /[\s\-_/(]/.test(haystack[at - 1] ?? "")
          ? 600
          : 400;

  // Up to 99 points of "shorter is better", so it can never outrank a band.
  return band + Math.max(0, 99 - title.length);
}

/** An exact identifier hit outranks every text match, by construction. */
export const IDENTIFIER_SCORE = 10_000;

/** One group of results, as `/api/search` returns them. */
export interface SearchGroup {
  readonly type: SearchResultType;
  readonly label: string;
  readonly results: readonly SearchResult[];
}

export interface SearchResponse {
  readonly query: string;
  readonly groups: readonly SearchGroup[];
}

/**
 * Order results the way a person would expect them.
 *
 * Issues before projects at equal score, because a workspace has an order of
 * magnitude more issues than projects and the identifier syntax only ever means
 * an issue — a project that happened to score the same is almost never what was
 * being looked for.
 */
export function compareResults(a: SearchResult, b: SearchResult): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.type !== b.type) return a.type === "issue" ? -1 : 1;
  return a.title.localeCompare(b.title);
}
