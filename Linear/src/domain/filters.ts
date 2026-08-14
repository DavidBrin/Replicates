/**
 * {@link IssueFilter} → SQL.
 *
 * The filter grammar is described in `entities.ts`: an optional set of accepted
 * values per field, ANDed across fields and ORed within one. That shape is
 * chosen precisely so this translation is mechanical — one `in (…)` per present
 * key, no query planner, no operator tree.
 *
 * ## The rule this file exists to enforce
 *
 * **No filter value is ever concatenated into SQL.** Every one leaves here as a
 * `$n` placeholder with its value in the returned `params` array, including the
 * free-text `query`, which is the field a user types into directly and the only
 * one an attacker controls end to end. Identifiers that *are* interpolated —
 * the table alias — are matched against `^[a-z_][a-z0-9_]*$` first and come
 * from this codebase, never from a request.
 *
 * The test suite asserts this from the outside: it runs a filter whose `query`
 * is `'; drop table issues; --` against a real database and checks that the
 * table is still there afterwards. A parameterised statement makes that string
 * a search term and nothing else.
 *
 * ## Why it does not import the database port
 *
 * A filter is a domain concept; the fact that it is currently rendered for
 * Postgres is not. {@link FilterParam} is structurally identical to the
 * driver's `SqlValue` and deliberately declared here, so `domain/` keeps its
 * property of importing nothing.
 */

import {
  type IssueFilter,
  PRIORITY_VALUES,
  STATE_TYPES,
} from "./entities";

/** A value that may cross into a statement as a bound parameter. */
export type FilterParam = string | number | boolean | null;

/** A `where`-clause fragment and the parameters its placeholders refer to. */
export interface SqlFragment {
  /** SQL text. Never contains a value — only `$n` placeholders. */
  readonly text: string;
  /** Positional parameters, in placeholder order starting at `startIndex`. */
  readonly params: readonly FilterParam[];
}

export interface IssueFilterOptions {
  /** The alias the `issues` table is bound to in the caller's statement. */
  readonly alias?: string;
  /**
   * The number the first placeholder should take.
   *
   * A caller that has already bound `$1` to a workspace id passes `2`, and the
   * fragment starts numbering there. Getting this wrong is the one way to
   * mis-wire a parameterised query, so it is an explicit argument rather than
   * something the caller patches up afterwards.
   */
  readonly startIndex?: number;
}

const ALIAS_PATTERN = /^[a-z_][a-z0-9_]*$/;

/**
 * A fragment that matches every row, used when a filter constrains nothing.
 *
 * `true` rather than an empty string so the caller can always write
 * `where <fragment>` without branching on emptiness.
 */
export const MATCH_ALL: SqlFragment = Object.freeze({ text: "true", params: [] });

/**
 * Collects predicates and keeps the placeholder numbering honest.
 *
 * The numbering is the whole reason this is a class and not a series of string
 * concatenations: every `bind` returns the placeholder for the value it just
 * appended, so a predicate cannot name a `$n` that does not correspond to the
 * parameter it pushed.
 */
class PredicateBuilder {
  readonly #predicates: string[] = [];
  readonly #params: FilterParam[] = [];
  #next: number;

  constructor(startIndex: number) {
    this.#next = startIndex;
  }

  /** Bind one value, returning its placeholder. */
  bind(value: FilterParam): string {
    this.#params.push(value);
    return `$${this.#next++}`;
  }

  /** Bind several, returning `$3, $4, $5` for use inside an `in (…)`. */
  bindAll(values: readonly FilterParam[]): string {
    return values.map((value) => this.bind(value)).join(", ");
  }

  add(predicate: string): void {
    this.#predicates.push(predicate);
  }

  build(): SqlFragment {
    if (this.#predicates.length === 0) return MATCH_ALL;
    return {
      text: this.#predicates.join(" and "),
      params: this.#params,
    };
  }
}

/**
 * Translate a filter into a `where` fragment.
 *
 * The result is always a usable boolean expression — `true` when the filter
 * constrains nothing — so callers can interpolate it unconditionally.
 *
 * ## Two decisions worth knowing about
 *
 * **An explicitly empty array matches nothing.** `{ stateIds: [] }` reads as
 * "state is any of ∅", which is false, and the fragment says so. The
 * alternative — treating it as no constraint — means a UI that clears the last
 * value from a filter chip silently shows every issue in the workspace, which
 * looks like the filter broke. Omit the key to remove the constraint.
 *
 * **Archived and trashed issues are excluded by default.** `includeArchived`
 * opts back into archived; nothing opts back into trashed, because the trash is
 * a 30-day recovery window with its own screen rather than a view state.
 */
export function issueFilterSql(
  filter: IssueFilter,
  options: IssueFilterOptions = {},
): SqlFragment {
  const alias = options.alias ?? "i";
  if (!ALIAS_PATTERN.test(alias)) {
    throw new Error(`Unsafe SQL alias: ${JSON.stringify(alias)}`);
  }

  const b = new PredicateBuilder(options.startIndex ?? 1);

  /* -- lifecycle ------------------------------------------------------- */

  // Always. A trashed issue is recoverable, not visible.
  b.add(`${alias}.trashed_at is null`);
  if (filter.includeArchived !== true) {
    b.add(`${alias}.archived_at is null`);
  }
  if (filter.includeSubIssues !== true) {
    // Sub-issues are represented by their parent's progress donut in a list;
    // showing both is double counting. `research/02-features.md` §2.
    b.add(`${alias}.parent_id is null`);
  }

  /* -- plain column sets ----------------------------------------------- */

  addIn(b, `${alias}.team_id`, filter.teamIds);
  addIn(b, `${alias}.state_id`, filter.stateIds);
  addIn(b, `${alias}.creator_id`, filter.creatorIds);
  addIn(b, `${alias}.milestone_id`, filter.milestoneIds);
  addIn(b, `${alias}.parent_id`, filter.parentIds);

  /* -- nullable sets --------------------------------------------------- */

  // `[null]` is the "Unassigned" / "No project" chip in Linear's filter bar,
  // and it is not expressible as an `in (…)` — `x in (null)` is *unknown*, not
  // true, so the obvious translation silently matches nothing. The null has to
  // become an `is null` disjunct.
  addNullableIn(b, `${alias}.assignee_id`, filter.assigneeIds);
  addNullableIn(b, `${alias}.project_id`, filter.projectIds);

  /* -- enumerated sets ------------------------------------------------- */

  if (filter.priorities !== undefined) {
    // Validated rather than trusted: `priority` is a `smallint` column with a
    // `check` constraint, and a value outside 0–4 would make the statement
    // fail at execution rather than here, where the error can name the field.
    addIn(
      b,
      `${alias}.priority`,
      filter.priorities.filter((value) =>
        (PRIORITY_VALUES as readonly number[]).includes(value),
      ),
    );
  }

  if (filter.stateTypes !== undefined) {
    const types = filter.stateTypes.filter((value) =>
      (STATE_TYPES as readonly string[]).includes(value),
    );
    if (types.length === 0) {
      b.add("false");
    } else {
      // `::text` because the column is a Postgres enum and the parameter
      // arrives as text; without the cast the planner has to infer the enum
      // type for `$n` and refuses when the statement is prepared standalone.
      b.add(
        `exists (select 1 from workflow_states fs
                  where fs.id = ${alias}.state_id
                    and fs.type::text in (${b.bindAll(types)}))`,
      );
    }
  }

  /* -- many-to-many ---------------------------------------------------- */

  if (filter.labelIds !== undefined) {
    if (filter.labelIds.length === 0) {
      b.add("false");
    } else {
      b.add(
        `exists (select 1 from issue_labels fl
                  where fl.issue_id = ${alias}.id
                    and fl.label_id in (${b.bindAll([...filter.labelIds])}))`,
      );
    }
  }

  if (filter.notLabelIds !== undefined && filter.notLabelIds.length > 0) {
    // Excluding nothing is not the same failure as including nothing: an empty
    // `notLabelIds` genuinely removes no issues, so it is a no-op rather than
    // `false`.
    b.add(
      `not exists (select 1 from issue_labels xl
                    where xl.issue_id = ${alias}.id
                      and xl.label_id in (${b.bindAll([...filter.notLabelIds])}))`,
    );
  }

  if (filter.subscriberIds !== undefined) {
    if (filter.subscriberIds.length === 0) {
      b.add("false");
    } else {
      b.add(
        `exists (select 1 from issue_subscribers fsub
                  where fsub.issue_id = ${alias}.id
                    and fsub.user_id in (${b.bindAll([...filter.subscriberIds])}))`,
      );
    }
  }

  /* -- dates ----------------------------------------------------------- */

  // Inclusive bounds. A user picking "due before the 14th" in a date picker
  // means the range up to and including the 14th; a strict `<` drops a day and
  // the missing issue is invisible rather than obviously missing.
  if (filter.dueBefore !== undefined) {
    b.add(`${alias}.due_date <= ${b.bind(filter.dueBefore)}::date`);
  }
  if (filter.dueAfter !== undefined) {
    b.add(`${alias}.due_date >= ${b.bind(filter.dueAfter)}::date`);
  }
  if (filter.createdAfter !== undefined) {
    b.add(`${alias}.created_at >= ${b.bind(filter.createdAfter)}::timestamptz`);
  }
  if (filter.updatedAfter !== undefined) {
    b.add(`${alias}.updated_at >= ${b.bind(filter.updatedAfter)}::timestamptz`);
  }

  /* -- text ------------------------------------------------------------ */

  const query = filter.query?.trim();
  if (query !== undefined && query !== "") {
    // One parameter, referenced three times. `ilike` rather than a trigram
    // index because PGlite ships no `pg_trgm` (`schema.sql` header) — at demo
    // scale a sequential scan over a few thousand rows is well under a frame.
    const pattern = b.bind(`%${escapeLike(query)}%`);
    b.add(
      `(${alias}.title ilike ${pattern}
        or ${alias}.description ilike ${pattern}
        or exists (select 1 from teams qt
                    where qt.id = ${alias}.team_id
                      and qt.key || '-' || ${alias}.number::text ilike ${pattern}))`,
    );
  }

  return b.build();
}

/**
 * `column in ($1, $2)`, or `false` for an empty set.
 *
 * The empty case is `false` whether the caller passed nothing or passed values
 * that were all rejected as invalid: an out-of-range priority should narrow the
 * result, never widen it back to "no constraint".
 */
function addIn(
  builder: PredicateBuilder,
  column: string,
  values: readonly FilterParam[] | undefined,
): void {
  if (values === undefined) return;
  if (values.length === 0) {
    builder.add("false");
    return;
  }
  builder.add(`${column} in (${builder.bindAll(values)})`);
}

/** As {@link addIn}, but a `null` member means "is null" rather than a value. */
function addNullableIn(
  builder: PredicateBuilder,
  column: string,
  values: readonly (string | null)[] | undefined,
): void {
  if (values === undefined) return;
  if (values.length === 0) {
    builder.add("false");
    return;
  }

  const present = values.filter((value): value is string => value !== null);
  const wantsNull = values.length !== present.length;

  if (present.length === 0) {
    builder.add(`${column} is null`);
    return;
  }
  const inClause = `${column} in (${builder.bindAll(present)})`;
  builder.add(wantsNull ? `(${inClause} or ${column} is null)` : inClause);
}

/**
 * Escape the wildcards in a user's search term.
 *
 * Without this a query of `%` matches every issue and a query of `_` matches
 * every one-character title — surprising rather than dangerous, but the kind of
 * surprise that gets reported as "search is broken". The backslash is Postgres'
 * default `ilike` escape character, and it must itself be escaped first or the
 * two passes cancel out.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
