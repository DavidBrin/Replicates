/**
 * Issue ordering — one definition, rendered twice.
 *
 * The list is sorted in two places that must agree: Postgres, when a view is
 * loaded, and JavaScript, when an optimistic edit re-slots a row without a
 * round trip. Two implementations of "sorted by priority" that disagree produce
 * the worst kind of bug — a row that jumps when the server's answer arrives —
 * so both live here, next to each other, built from the same table.
 *
 * ## The trap, and it is the whole reason this file exists
 *
 * `priority` is Linear's integer enum, and `0` means **No priority**, not
 * "highest". `order by priority asc` therefore puts every unprioritised issue
 * at the top of the list, which is exactly backwards. The correct order is
 * Urgent, High, Medium, Low, *then* No priority — `entities.ts` publishes it as
 * `PRIORITY_SORT_RANK` and {@link priorityRankSql} is the same mapping as a SQL
 * expression. Nothing in this codebase should order by the raw column.
 *
 * `research/03-data-model.md` §6 records the related decision: Linear persists a
 * third column, `prioritySortOrder`, for manual ordering inside the priority
 * view. This clone computes the rank instead, because a third order column is a
 * third thing that can drift out of sync with the other two.
 *
 * ## Determinism
 *
 * Every order-by ends with `id`. Two issues can legitimately share a sort key —
 * fractional indexing deliberately has no uniqueness constraint
 * (`ordering.ts`), and two issues created in the same second share a
 * `created_at` — and an unbroken tie is resolved by whatever order the planner
 * happened to return, which differs between a sequential scan and an index
 * scan. The list then reshuffles on reload for no visible reason.
 */

import {
  type Issue,
  type OrderBy,
  type Priority,
  PRIORITY_SORT_RANK,
  type StateType,
  STATE_TYPES,
  type WorkflowState,
} from "./entities";
import { compareOrderKeys } from "./ordering";

export type SortDirection = "asc" | "desc";

const ALIAS_PATTERN = /^[a-z_][a-z0-9_]*$/;

function checkAlias(alias: string): string {
  if (!ALIAS_PATTERN.test(alias)) {
    throw new Error(`Unsafe SQL alias: ${JSON.stringify(alias)}`);
  }
  return alias;
}

/* ============================================================ priority == */

/**
 * The priority rank as a SQL expression: Urgent first, No priority last.
 *
 * Written as a `case` rather than a lookup table because it has to be usable in
 * an `order by`, a `group by` and an expression index without any of them
 * needing a join.
 */
export function priorityRankSql(alias = "i"): string {
  const a = checkAlias(alias);
  return `(case when ${a}.priority = 0 then 5 else ${a}.priority end)`;
}

/** The same mapping in JavaScript. Lower sorts first. */
export function priorityRank(priority: Priority): number {
  return PRIORITY_SORT_RANK[priority];
}

/* ======================================================= state grouping == */

/**
 * Rank of a state *type*, which is the order status groups appear in.
 *
 * Derived from `STATE_TYPES` rather than restated, so adding a type to the
 * domain cannot leave the grouping silently unaware of it.
 */
export const STATE_TYPE_RANK: Readonly<Record<StateType, number>> =
  Object.freeze(
    Object.fromEntries(STATE_TYPES.map((type, index) => [type, index])) as Record<
      StateType,
      number
    >,
  );

/**
 * Workflow states in the order a grouped list shows them: by type, then by the
 * team's own arrangement within that type.
 *
 * The name tiebreak is not cosmetic — `position` is a float a team admin drags,
 * and two states given the same position by an import would otherwise render in
 * an arbitrary order that changes between page loads.
 */
export function compareWorkflowStates(
  a: Pick<WorkflowState, "type" | "position" | "name" | "id">,
  b: Pick<WorkflowState, "type" | "position" | "name" | "id">,
): number {
  const byType = STATE_TYPE_RANK[a.type] - STATE_TYPE_RANK[b.type];
  if (byType !== 0) return byType;
  if (a.position !== b.position) return a.position - b.position;
  const byName = a.name.localeCompare(b.name);
  return byName !== 0 ? byName : compareOrderKeys(a.id, b.id);
}

/** The `order by` for a team's workflow states. */
export function workflowStateOrderBySql(alias = "s"): string {
  const a = checkAlias(alias);
  const cases = STATE_TYPES.map(
    (type, index) => `when '${type}' then ${index}`,
  ).join(" ");
  return `case ${a}.type ${cases} else ${STATE_TYPES.length} end, ${a}.position, ${a}.name, ${a}.id`;
}

/* ============================================================== issues == */

/**
 * The `order by` list for an issue query — the column expressions only, with no
 * `order by` keyword, so a caller can prepend `distinct on` or append its own
 * tiebreak.
 *
 * `alias` is interpolated and therefore validated; nothing else here comes from
 * outside this module — `orderBy` and `direction` index into closed sets, so an
 * unrecognised value is a `default` branch, never a string that reaches SQL.
 */
export function issueOrderBySql(
  orderBy: OrderBy = "manual",
  direction: SortDirection = "asc",
  alias = "i",
): string {
  const a = checkAlias(alias);
  const dir = direction === "desc" ? "desc" : "asc";

  switch (orderBy) {
    case "priority":
      // Within a priority band the manual order still applies — this is the
      // view Linear calls "priority", not "priority and then nothing".
      return `${priorityRankSql(a)} ${dir}, ${a}.sort_order asc, ${a}.id asc`;
    case "created":
      return `${a}.created_at ${dir}, ${a}.id asc`;
    case "updated":
      return `${a}.updated_at ${dir}, ${a}.id asc`;
    case "dueDate":
      // `nulls last` in *both* directions. A due date is a deadline; issues
      // without one are not "infinitely far away", they are unscheduled, and
      // burying them under a hundred nulls when the sort flips to descending
      // is never what the click meant.
      return `${a}.due_date ${dir} nulls last, ${a}.sort_order asc, ${a}.id asc`;
    case "title":
      return `lower(${a}.title) ${dir}, ${a}.id asc`;
    case "manual":
    default:
      // `sort_order` is `collate "C"` on the column, so this comparison is
      // byte-wise without the query having to say so. See `schema.sql`.
      return `${a}.sort_order ${dir}, ${a}.id asc`;
  }
}

/**
 * The fields a comparator needs.
 *
 * Structural rather than `Issue`, so a partially-hydrated optimistic row in the
 * client store can be sorted with the same function that sorts a full one.
 */
export type SortableIssue = Pick<
  Issue,
  | "id"
  | "title"
  | "priority"
  | "sortOrder"
  | "createdAt"
  | "updatedAt"
  | "dueDate"
>;

/**
 * The JavaScript twin of {@link issueOrderBySql}.
 *
 * Returns a comparator rather than sorting, because the caller usually wants to
 * sort a slice of a normalised store rather than an array it owns.
 *
 * Timestamps are compared as strings, not parsed to `Date`. That is only safe
 * because every timestamp leaving a repository is normalised to the same
 * fixed-width UTC ISO-8601 form, where lexical order *is* chronological order —
 * a local-offset string like `…T14:36:15-08:00` would break it, which is why
 * the mappers convert rather than pass through.
 */
export function compareIssues(
  orderBy: OrderBy = "manual",
  direction: SortDirection = "asc",
): (a: SortableIssue, b: SortableIssue) => number {
  const sign = direction === "desc" ? -1 : 1;

  switch (orderBy) {
    case "priority":
      return (a, b) =>
        (priorityRank(a.priority) - priorityRank(b.priority)) * sign ||
        compareOrderKeys(a.sortOrder, b.sortOrder) ||
        compareOrderKeys(a.id, b.id);
    case "created":
      return (a, b) =>
        compareOrderKeys(a.createdAt, b.createdAt) * sign ||
        compareOrderKeys(a.id, b.id);
    case "updated":
      return (a, b) =>
        compareOrderKeys(a.updatedAt, b.updatedAt) * sign ||
        compareOrderKeys(a.id, b.id);
    case "dueDate":
      return (a, b) =>
        compareNullsLast(a.dueDate, b.dueDate, sign) ||
        compareOrderKeys(a.sortOrder, b.sortOrder) ||
        compareOrderKeys(a.id, b.id);
    case "title":
      return (a, b) =>
        a.title.toLowerCase().localeCompare(b.title.toLowerCase()) * sign ||
        compareOrderKeys(a.id, b.id);
    case "manual":
    default:
      return (a, b) =>
        compareOrderKeys(a.sortOrder, b.sortOrder) * sign ||
        compareOrderKeys(a.id, b.id);
  }
}

/**
 * Compare two optional values, keeping nulls at the end whichever way the sort
 * runs — the JavaScript half of the `nulls last` above. The sign is applied to
 * the value comparison only, never to the null test, which is precisely what
 * makes it survive a direction flip.
 */
function compareNullsLast(
  a: string | null,
  b: string | null,
  sign: number,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareOrderKeys(a, b) * sign;
}
