import "server-only";

/**
 * The parts every repository adapter needs and none of them should own.
 *
 * Three jobs: turning driver values into domain values, keeping the transaction
 * convention in one place, and holding the SQL snippets that build a nested
 * object so that a list query stays a single round trip.
 *
 * ## Why the coercions exist at all
 *
 * Both engines return *typed* values, not strings, and the types they choose
 * are not the ones the domain uses:
 *
 * - `timestamptz` arrives as a JavaScript `Date`. `Timestamp` is an ISO-8601
 *   UTC string, and the conversion has to be explicit or the same field is a
 *   `Date` from one query and a string from another.
 * - A timestamp nested inside `json_build_object` arrives as text in the
 *   *server's local offset* — `2026-08-13T14:36:15.087-08:00`. That string is
 *   a correct instant and a broken sort key, because `domain/sorting.ts`
 *   compares timestamps lexically. Everything goes through `Date` and back out
 *   as `…Z`.
 * - `date` columns are selected as `::text` rather than coerced here. Postgres'
 *   `date` has no time zone, and `pg` parses it into a `Date` at *local*
 *   midnight; `toISOString()` on that shifts the day backwards west of UTC.
 *   The cast in the query avoids the round trip entirely.
 * - `bigserial` is a `number` in PGlite and a decimal *string* in Neon, because
 *   a bigint does not fit a double and the driver refuses to lie about it. The
 *   changefeed cursor is well inside `Number.MAX_SAFE_INTEGER`, so it is parsed
 *   rather than carried as a bigint.
 */

import type { SqlDatabase, SqlExecutor, SqlRow, SqlValue } from "@/adapters/db/driver";
import type {
  Label,
  Reaction,
  StateType,
  Timestamp,
  User,
  WorkflowState,
} from "@/domain/entities";
import { NotFoundError } from "@/ports/repositories";

/* ============================================================ coercions == */

/** A required text column. */
export function text(row: SqlRow, column: string): string {
  const value = row[column];
  if (typeof value === "string") return value;
  if (value === null || value === undefined) {
    throw new TypeError(`Expected ${column} to be text, got ${String(value)}`);
  }
  return String(value);
}

export function nullableText(row: SqlRow, column: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : String(value);
}

export function num(row: SqlRow, column: string): number {
  const value = row[column];
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`Expected ${column} to be a number, got ${String(value)}`);
  }
  return parsed;
}

export function nullableNum(row: SqlRow, column: string): number | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  return num(row, column);
}

export function bool(row: SqlRow, column: string): boolean {
  const value = row[column];
  return value === true || value === "t" || value === "true" || value === 1;
}

/** A `timestamptz`, normalised to ISO-8601 UTC. */
export function timestamp(value: unknown): Timestamp {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  throw new TypeError(`Expected a timestamp, got ${String(value)}`);
}

export function nullableTimestamp(value: unknown): Timestamp | null {
  return value === null || value === undefined ? null : timestamp(value);
}

/**
 * A `jsonb`/`json` column.
 *
 * Both drivers parse these, but a `json_agg` over zero rows comes back as SQL
 * `null` rather than `[]` unless the query coalesces it, and a column written
 * by hand can be a string. Tolerating all three costs four lines and removes a
 * class of "cannot read property of null" that only appears once the demo data
 * has an issue with no labels on it.
 */
export function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

/* ============================================================== helpers == */

/** `$3, $4, $5` — for an `in (…)` whose values are bound separately. */
export function placeholders(count: number, start = 1): string {
  return Array.from({ length: count }, (_, index) => `$${start + index}`).join(", ");
}

/** The first row, or a {@link NotFoundError} naming what was missing. */
export function requireRow<T>(rows: readonly T[], entity: string, id: string): T {
  const row = rows[0];
  if (row === undefined) throw new NotFoundError(entity, id);
  return row;
}

/** A clock, injected so the seed can produce a fixed past and tests a fixed now. */
export type Clock = () => Timestamp;

export const systemClock: Clock = () => new Date().toISOString();

export interface RepositoryContext {
  readonly db: SqlDatabase;
  readonly clock?: Clock;
}

/**
 * What every adapter inherits: a database, a clock, and the two conventions
 * that make the optional trailing executor work.
 */
export abstract class BaseRepository {
  protected readonly db: SqlDatabase;
  protected readonly clock: Clock;

  constructor(context: RepositoryContext) {
    this.db = context.db;
    this.clock = context.clock ?? systemClock;
  }

  /** The executor to read through: the caller's, or the pool. */
  protected reader(tx?: SqlExecutor): SqlExecutor {
    return tx ?? this.db;
  }

  /**
   * Run `fn` atomically.
   *
   * A caller that supplied an executor already owns the boundary, so this joins
   * it rather than opening a second one — Postgres would need a savepoint to do
   * otherwise, and nothing here wants partial rollback. The consequence is
   * documented on the port: passing the *pool* as `tx` is indistinguishable
   * from passing a transaction, and gets no atomicity.
   */
  protected async atomically<T>(
    tx: SqlExecutor | undefined,
    fn: (tx: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    if (tx) return fn(tx);
    return this.db.transaction(fn);
  }

  protected now(): Timestamp {
    return this.clock();
  }
}

/* ============================================== nested-object SQL snippets */

/**
 * The order that picks a team's *default* state — triage when the team uses it,
 * then the first unstarted state, then backlog.
 *
 * Shared because two callers need exactly the same answer: `teams.defaultStateFor`
 * answers it for a picker, and the issue repository answers it for every create
 * that omits a state. Two copies of a fallback chain is two copies that can
 * disagree, and the symptom — issues landing in a different column than the one
 * the UI predicted — reads as a UI bug.
 *
 * Requires `workflow_states s` joined to `teams tm`.
 */
export const DEFAULT_STATE_ORDER_SQL = `case
    when tm.triage_enabled and s.type = 'triage' then 0
    when s.type = 'unstarted' then 1
    when s.type = 'backlog' then 2
    when s.type = 'started' then 3
    else 4
  end, s.position asc, s.id asc`;

/**
 * A user as JSON, without the password hash.
 *
 * `to_jsonb(u)` would be shorter and would put the scrypt hash of every
 * assignee into the response of every list query — a credential in a payload
 * that gets logged, cached and serialised to the client. The columns are named
 * explicitly so that adding one to `users` cannot silently widen this.
 */
export function userJson(alias: string): string {
  return `json_build_object(
    'id', ${alias}.id,
    'email', ${alias}.email,
    'name', ${alias}.name,
    'displayName', ${alias}.display_name,
    'avatarUrl', ${alias}.avatar_url,
    'avatarColor', ${alias}.avatar_color,
    'createdAt', ${alias}.created_at,
    'active', ${alias}.active)`;
}

export function stateJson(alias: string): string {
  return `json_build_object(
    'id', ${alias}.id,
    'teamId', ${alias}.team_id,
    'name', ${alias}.name,
    'type', ${alias}.type,
    'color', ${alias}.color,
    'description', ${alias}.description,
    'position', ${alias}.position)`;
}

export function labelJson(alias: string): string {
  return `json_build_object(
    'id', ${alias}.id,
    'workspaceId', ${alias}.workspace_id,
    'teamId', ${alias}.team_id,
    'name', ${alias}.name,
    'color', ${alias}.color,
    'description', ${alias}.description,
    'parentId', ${alias}.parent_id,
    'createdAt', ${alias}.created_at)`;
}

/* ============================================================== mappers == */

/** The shape {@link userJson} produces. */
interface UserJson {
  id: string;
  email: string;
  name: string;
  displayName: string;
  avatarUrl: string | null;
  avatarColor: string;
  createdAt: string;
  active: boolean;
}

export function mapUserJson(value: unknown): User | null {
  const raw = json<UserJson | null>(value, null);
  if (raw === null) return null;
  return {
    id: raw.id,
    email: raw.email,
    name: raw.name,
    displayName: raw.displayName,
    avatarUrl: raw.avatarUrl,
    avatarColor: raw.avatarColor,
    createdAt: timestamp(raw.createdAt),
    active: raw.active,
  };
}

/** A `users` row selected directly rather than through {@link userJson}. */
export function mapUserRow(row: SqlRow, prefix = ""): User {
  return {
    id: text(row, `${prefix}id`),
    email: text(row, `${prefix}email`),
    name: text(row, `${prefix}name`),
    displayName: text(row, `${prefix}display_name`),
    avatarUrl: nullableText(row, `${prefix}avatar_url`),
    avatarColor: text(row, `${prefix}avatar_color`),
    createdAt: timestamp(row[`${prefix}created_at`]),
    active: bool(row, `${prefix}active`),
  };
}

interface StateJson {
  id: string;
  teamId: string;
  name: string;
  type: StateType;
  color: string;
  description: string | null;
  position: number;
}

export function mapStateJson(value: unknown): WorkflowState {
  const raw = json<StateJson | null>(value, null);
  if (raw === null) {
    throw new TypeError("Expected a workflow state, got null");
  }
  return {
    id: raw.id,
    teamId: raw.teamId,
    name: raw.name,
    type: raw.type,
    color: raw.color,
    description: raw.description,
    position: Number(raw.position),
  };
}

export function mapStateRow(row: SqlRow): WorkflowState {
  return {
    id: text(row, "id"),
    teamId: text(row, "team_id"),
    name: text(row, "name"),
    type: text(row, "type") as StateType,
    color: text(row, "color"),
    description: nullableText(row, "description"),
    position: num(row, "position"),
  };
}

interface LabelJson {
  id: string;
  workspaceId: string;
  teamId: string | null;
  name: string;
  color: string;
  description: string | null;
  parentId: string | null;
  createdAt: string;
}

export function mapLabelsJson(value: unknown): Label[] {
  return json<LabelJson[]>(value, []).map((raw) => ({
    id: raw.id,
    workspaceId: raw.workspaceId,
    teamId: raw.teamId,
    name: raw.name,
    color: raw.color,
    description: raw.description,
    parentId: raw.parentId,
    createdAt: timestamp(raw.createdAt),
  }));
}

export function mapLabelRow(row: SqlRow): Label {
  return {
    id: text(row, "id"),
    workspaceId: text(row, "workspace_id"),
    teamId: nullableText(row, "team_id"),
    name: text(row, "name"),
    color: text(row, "color"),
    description: nullableText(row, "description"),
    parentId: nullableText(row, "parent_id"),
    createdAt: timestamp(row["created_at"]),
  };
}

export function mapReactionRow(row: SqlRow): Reaction {
  return {
    id: text(row, "id"),
    commentId: nullableText(row, "comment_id"),
    issueId: nullableText(row, "issue_id"),
    userId: text(row, "user_id"),
    emoji: text(row, "emoji"),
    createdAt: timestamp(row["created_at"]),
  };
}

/* ================================================================ params = */

/**
 * A parameter list under construction.
 *
 * The same numbering discipline as `domain/filters.ts`, for the statements that
 * are assembled rather than written out: `bind` returns the placeholder for the
 * value it just pushed, so a `$n` cannot name a parameter that was never added.
 */
export class Params {
  readonly values: SqlValue[] = [];

  bind(value: SqlValue): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }

  bindAll(values: readonly SqlValue[]): string {
    return values.map((value) => this.bind(value)).join(", ");
  }

  get next(): number {
    return this.values.length + 1;
  }
}
