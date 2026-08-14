import "server-only";

/**
 * The issue repository — the one aggregate everything else orbits.
 *
 * Four rules live here and nowhere else, because getting any of them slightly
 * wrong produces data that looks right until it is aggregated:
 *
 * 1. **Numbering.** `issues.number` comes from `teams.issue_counter`, bumped
 *    with `update … set issue_counter = issue_counter + 1 … returning`, inside
 *    the same transaction as the insert. The `returning` is what makes it
 *    race-free: the row lock is taken by the update and held until commit, so a
 *    second creator blocks on it rather than reading the same value. A
 *    `select max(number) + 1` under the same load hands out duplicates, and
 *    `unique (team_id, number)` turns that into a 500 for whichever writer is
 *    second. A sequence would be race-free and gappy, and Linear's numbers have
 *    no gaps.
 *
 * 2. **Ordering.** New issues are prepended — Linear puts a new issue at the
 *    top — with a key from `keyBetween(null, currentMinimum)`. Bulk creation
 *    uses `keysBetween` in one pass; calling `keyBetween` in a loop would
 *    subdivide the same gap n times and grow the key a character per issue.
 *
 * 3. **Category-transition timestamps.** `started_at` is first-write-wins and
 *    never cleared; `completed_at` and `canceled_at` are stamped on *entering*
 *    their category and **cleared on leaving it**. A move within a category
 *    (In Progress → In Review) re-stamps nothing. See {@link transitionStamps}.
 *
 * 4. **Every mutation writes an activity row and a change event, in the same
 *    transaction as the write.** A change event that commits without its write
 *    tells a polling client to refetch something that never happened.
 *
 * ## What does *not* write an activity row
 *
 * `ACTIVITY_TYPES` is a closed set in `domain/entities.ts` and contains no
 * ordering, subscription or trash event. Reordering an issue, subscribing to
 * it, and moving it to the trash therefore append a change event — so other
 * clients still converge — and record nothing in the feed. That is not an
 * omission: a feed that logs every drag is a feed nobody reads, and Linear's
 * does not log them either.
 */

import type { SqlExecutor, SqlRow, SqlValue } from "@/adapters/db/driver";
import {
  type ActivityPayload,
  type ActivityType,
  formatIdentifier,
  INVERSE_RELATION,
  type IssueId,
  type IssueRelation,
  type IssueRelationType,
  type IssueWithRelations,
  type LabelId,
  type Priority,
  PRIORITY_LABELS,
  type StateType,
  type Timestamp,
  type User,
  type UserId,
  type WorkspaceId,
  parseIdentifier,
} from "@/domain/entities";
import { issueFilterSql } from "@/domain/filters";
import { keyBetween, keysBetween } from "@/domain/ordering";
import { issueOrderBySql } from "@/domain/sorting";
import { newId } from "@/lib/ids";
import {
  ConflictError,
  type CreateIssueInput,
  type DependencyGraphIssue,
  type DependencyGraphQuery,
  type DependencyGraphRows,
  type DependencyRelation,
  type IssueQuery,
  type IssueRelationWithTarget,
  type IssueRepository,
  NotFoundError,
  type Tx,
  type UpdateIssueInput,
} from "@/ports/repositories";

import { change, insertActivity } from "./activity";
import { appendChangeEvent } from "./changefeed";
import {
  BaseRepository,
  DEFAULT_STATE_ORDER_SQL,
  labelJson,
  mapLabelsJson,
  mapStateJson,
  mapUserJson,
  mapUserRow,
  nullableNum,
  nullableText,
  nullableTimestamp,
  num,
  Params,
  stateJson,
  text,
  timestamp,
  userJson,
} from "./shared";

/* ============================================================ projection = */

/**
 * One statement, one round trip, whole rows.
 *
 * The nested objects are built in SQL rather than assembled from a second query
 * because a list view renders 50 issues with an assignee, a state, a project
 * and a label set each — the N+1 version is 200 statements per page load.
 * Aggregating in the database costs a subselect per row against indexed
 * columns, which is dramatically cheaper than the round trips.
 */
const ISSUE_SELECT = `
  i.id, i.team_id, i.number, i.title, i.description, i.state_id, i.priority,
  i.assignee_id, i.creator_id, i.project_id, i.milestone_id, i.parent_id,
  i.estimate, i.due_date::text as due_date,
  i.sort_order, i.sub_issue_sort_order,
  i.created_at, i.updated_at,
  i.started_at, i.completed_at, i.canceled_at, i.archived_at, i.triaged_at,
  t.key || '-' || i.number::text as identifier,
  json_build_object(
    'id', t.id, 'key', t.key, 'name', t.name, 'color', t.color, 'icon', t.icon
  ) as team,
  ${stateJson("s")} as state,
  case when au.id is null then null else ${userJson("au")} end as assignee,
  case when cu.id is null then null else ${userJson("cu")} end as creator,
  case when p.id is null then null else json_build_object(
    'id', p.id, 'name', p.name, 'icon', p.icon, 'color', p.color
  ) end as project,
  coalesce((
    select json_agg(${labelJson("l")} order by l.name)
      from issue_labels il join labels l on l.id = il.label_id
     where il.issue_id = i.id
  ), '[]'::json) as labels,
  (select count(*) from issues si
    where si.parent_id = i.id
      and si.trashed_at is null and si.archived_at is null) as sub_issue_count,
  (select count(*) from issues si
     join workflow_states ss on ss.id = si.state_id
    where si.parent_id = i.id
      and si.trashed_at is null and si.archived_at is null
      and ss.type = 'completed') as completed_sub_issue_count,
  (select count(*) from comments cm where cm.issue_id = i.id) as comment_count
`;

const ISSUE_FROM = `
  from issues i
  join teams t on t.id = i.team_id
  join workflow_states s on s.id = i.state_id
  left join users au on au.id = i.assignee_id
  left join users cu on cu.id = i.creator_id
  left join projects p on p.id = i.project_id
`;

/**
 * What "the issue" means to everything above this layer.
 *
 * A trashed issue is *gone* — it is in a 30-day recovery window, and until
 * somebody restores it, loading its page or accepting an edit to it are both
 * wrong. An archived one is out of the working set for the same reason Linear
 * archives rather than deletes: it should stop appearing, stop counting, and
 * stop being editable, without losing its history.
 *
 * `list` and `count` already enforce this through `domain/filters.ts`, where
 * `includeArchived` can opt back in and nothing opts back into trashed. The
 * single-row reads did not, which meant a trashed issue's page still rendered
 * and every mutation route — each of which loads the issue by id first — still
 * accepted writes to it. Naming the predicate once is what keeps the reads that
 * use it from drifting apart.
 *
 * {@link SqlIssueRepository.byIdIncludingDeleted} is the deliberate exception,
 * for the lifecycle mutations and anything that has to show the trash.
 */
const LIVE_ISSUE = `i.archived_at is null and i.trashed_at is null`;

/**
 * The most nodes `dependencyGraph` will return, whatever it is asked for.
 *
 * The caller's `maxNodes` is a *view* decision and lives in
 * `config/dependency-graph.ts`. This is the floor under it: a query parameter
 * that reached this method unchecked would otherwise be able to ask for the
 * whole workspace, and the recursive walk that answers it is the one query here
 * with no natural bound of its own.
 */
const HARD_GRAPH_NODE_CEILING = 1_000;

interface TeamJson {
  id: string;
  key: string;
  name: string;
  color: string;
  icon: string;
}

interface ProjectJson {
  id: string;
  name: string;
  icon: string;
  color: string;
}

export function mapIssueRow(row: SqlRow): IssueWithRelations {
  const teamRaw = row["team"] as TeamJson;
  const projectRaw = row["project"] as ProjectJson | null;
  return {
    id: text(row, "id"),
    teamId: text(row, "team_id"),
    number: num(row, "number"),
    title: text(row, "title"),
    description: text(row, "description"),
    stateId: text(row, "state_id"),
    priority: num(row, "priority") as Priority,
    assigneeId: nullableText(row, "assignee_id"),
    creatorId: text(row, "creator_id"),
    projectId: nullableText(row, "project_id"),
    milestoneId: nullableText(row, "milestone_id"),
    parentId: nullableText(row, "parent_id"),
    estimate: nullableNum(row, "estimate"),
    dueDate: nullableText(row, "due_date"),
    sortOrder: text(row, "sort_order"),
    subIssueSortOrder: nullableText(row, "sub_issue_sort_order"),
    createdAt: timestamp(row["created_at"]),
    updatedAt: timestamp(row["updated_at"]),
    startedAt: nullableTimestamp(row["started_at"]),
    completedAt: nullableTimestamp(row["completed_at"]),
    canceledAt: nullableTimestamp(row["canceled_at"]),
    archivedAt: nullableTimestamp(row["archived_at"]),
    triagedAt: nullableTimestamp(row["triaged_at"]),

    identifier: text(row, "identifier"),
    team: {
      id: teamRaw.id,
      key: teamRaw.key,
      name: teamRaw.name,
      color: teamRaw.color,
      icon: teamRaw.icon,
    },
    state: mapStateJson(row["state"]),
    assignee: mapUserJson(row["assignee"]),
    creator: mapUserJson(row["creator"]),
    project:
      projectRaw === null
        ? null
        : {
            id: projectRaw.id,
            name: projectRaw.name,
            icon: projectRaw.icon,
            color: projectRaw.color,
          },
    labels: mapLabelsJson(row["labels"]),
    subIssueCount: num(row, "sub_issue_count"),
    completedSubIssueCount: num(row, "completed_sub_issue_count"),
    commentCount: num(row, "comment_count"),
  };
}

/* =========================================================== transitions = */

/** The four stamps, as they stand before and after a state change. */
export interface TransitionStamps {
  readonly startedAt: Timestamp | null;
  readonly completedAt: Timestamp | null;
  readonly canceledAt: Timestamp | null;
  readonly triagedAt: Timestamp | null;
}

/**
 * The category-transition rule, in one pure function so it can be tested
 * without a database.
 *
 * ```
 * started_at    first write wins, never cleared
 * completed_at  set on ENTERING completed, cleared on LEAVING it
 * canceled_at   set on ENTERING canceled,  cleared on LEAVING it
 * triaged_at    set when the issue LEAVES triage  ← the name is Linear's and
 *               means "triage completed at", not "entered triage at"
 * ```
 *
 * The clearing half is the part a clone gets wrong. Deriving the stamps from
 * the activity log instead — "the timestamp of the last transition into a
 * completed state" — looks equivalent and is not: a Backlog → Done → In
 * Progress round trip leaves a `completedAt` behind, and every cycle-time and
 * project-progress rollup that reads it is then wrong in a way nothing
 * surfaces. `research/02-features.md` §2, SPEC §3.
 *
 * A move *within* a category re-stamps nothing: `from === to` short-circuits
 * every branch, so In Progress → In Review keeps the original `startedAt` and
 * Done → Duplicate keeps the original `completedAt`.
 */
export function transitionStamps(
  from: StateType | null,
  to: StateType,
  current: TransitionStamps,
  now: Timestamp,
): TransitionStamps {
  const entering = (type: StateType) => to === type && from !== type;
  const leaving = (type: StateType) => from === type && to !== type;

  return {
    // Never cleared, and never re-stamped: cycle time is measured from the
    // first pickup, not the most recent one.
    startedAt: to === "started" ? (current.startedAt ?? now) : current.startedAt,
    completedAt: entering("completed")
      ? now
      : to === "completed"
        ? current.completedAt
        : null,
    canceledAt: entering("canceled")
      ? now
      : to === "canceled"
        ? current.canceledAt
        : null,
    triagedAt: leaving("triage") ? (current.triagedAt ?? now) : current.triagedAt,
  };
}

/* ============================================================ repository = */

/** The row `#load` reads: the issue plus the context a mutation needs. */
interface IssueContext {
  readonly id: IssueId;
  readonly teamId: string;
  readonly workspaceId: WorkspaceId;
  readonly teamKey: string;
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly stateId: string;
  readonly stateName: string;
  readonly stateType: StateType;
  readonly priority: Priority;
  readonly assigneeId: string | null;
  readonly projectId: string | null;
  readonly milestoneId: string | null;
  readonly parentId: string | null;
  readonly estimate: number | null;
  readonly dueDate: string | null;
  readonly sortOrder: string;
  readonly subIssueSortOrder: string | null;
  readonly startedAt: Timestamp | null;
  readonly completedAt: Timestamp | null;
  readonly canceledAt: Timestamp | null;
  readonly triagedAt: Timestamp | null;
  readonly archivedAt: Timestamp | null;
}

type LabelKind = "user" | "project" | "milestone" | "state" | "issue" | "label";

export class SqlIssueRepository extends BaseRepository implements IssueRepository {
  /* ------------------------------------------------------------ create -- */

  async create(
    input: CreateIssueInput,
    actorId: UserId,
    tx?: Tx,
  ): Promise<IssueWithRelations> {
    return this.atomically(tx, async (t) => {
      const [created] = await this.#insertBatch(t, [input], actorId);
      if (created === undefined) throw new Error("create produced no issue");
      return created;
    });
  }

  async createMany(
    inputs: readonly CreateIssueInput[],
    actorId: UserId,
    tx?: Tx,
  ): Promise<IssueWithRelations[]> {
    if (inputs.length === 0) return [];
    return this.atomically(tx, (t) => this.#insertBatch(t, inputs, actorId));
  }

  /**
   * The single insert path, batched.
   *
   * `create` is `createMany` with one element rather than the other way round,
   * so there is exactly one place that allocates a number, chooses a state,
   * computes an order key and writes the two logs. Two paths would drift, and
   * the one that drifted would be whichever is less used.
   */
  async #insertBatch(
    t: SqlExecutor,
    inputs: readonly CreateIssueInput[],
    actorId: UserId,
  ): Promise<IssueWithRelations[]> {
    const now = this.now();
    const byTeam = new Map<string, CreateIssueInput[]>();
    for (const input of inputs) {
      const bucket = byTeam.get(input.teamId);
      if (bucket) bucket.push(input);
      else byTeam.set(input.teamId, [input]);
    }

    const createdIds: IssueId[] = [];

    for (const [teamId, batch] of byTeam) {
      // One statement allocates the whole block. The row lock it takes is held
      // to commit, so a concurrent creator waits here rather than reading a
      // stale counter — and the numbers stay contiguous because the counter is
      // the allocator, not a high-water mark derived from the rows.
      const counterRows = await t.query(
        `update teams set issue_counter = issue_counter + $2
          where id = $1
        returning issue_counter, workspace_id, key`,
        [teamId, batch.length],
      );
      const counter = counterRows[0];
      if (counter === undefined) throw new NotFoundError("Team", teamId);
      const lastNumber = num(counter, "issue_counter");
      const workspaceId = text(counter, "workspace_id");
      const key = text(counter, "key");
      const firstNumber = lastNumber - batch.length + 1;

      // Keys for the whole batch in one pass. Sequential `keyBetween` calls
      // would each subdivide the leading gap and grow the key by a character
      // per issue — `ordering.ts`, `keysBetween`.
      const topKey = await this.#topSortOrder(t, teamId);
      const generated = keysBetween(null, topKey, batch.length);

      for (const [index, input] of batch.entries()) {
        const id = input.id ?? newId("iss");
        const state = await this.#resolveState(t, teamId, input.stateId);
        const stamps = transitionStamps(
          null,
          state.type,
          {
            startedAt: null,
            completedAt: null,
            canceledAt: null,
            triagedAt: null,
          },
          now,
        );
        const sortOrder = input.sortOrder ?? generated[index] ?? keyBetween(null, topKey);
        const parentId = input.parentId ?? null;
        const subIssueSortOrder =
          parentId === null ? null : await this.#nextSubIssueKey(t, parentId);

        await t.execute(
          `insert into issues (
             id, team_id, number, title, description, state_id, priority,
             assignee_id, creator_id, project_id, milestone_id, parent_id,
             estimate, due_date, sort_order, sub_issue_sort_order,
             created_at, updated_at, started_at, completed_at, canceled_at,
             triaged_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                   $17,$18,$19,$20,$21,$22)`,
          [
            id,
            teamId,
            firstNumber + index,
            input.title,
            input.description ?? "",
            state.id,
            input.priority ?? 0,
            input.assigneeId ?? null,
            input.creatorId,
            input.projectId ?? null,
            input.milestoneId ?? null,
            parentId,
            input.estimate ?? null,
            input.dueDate ?? null,
            sortOrder,
            subIssueSortOrder,
            now,
            now,
            stamps.startedAt,
            stamps.completedAt,
            stamps.canceledAt,
            stamps.triagedAt,
          ],
        );

        for (const labelId of input.labelIds ?? []) {
          await t.execute(
            `insert into issue_labels (issue_id, label_id) values ($1,$2)
             on conflict do nothing`,
            [id, labelId],
          );
        }

        // The creator and the assignee are subscribed implicitly. Without it
        // nobody is notified about the issue they just filed, which reads as
        // notifications being broken rather than as a subscription default.
        const subscribers = new Set<string>([
          input.creatorId,
          ...(input.assigneeId ? [input.assigneeId] : []),
          ...(input.subscriberIds ?? []),
        ]);
        for (const userId of subscribers) {
          await t.execute(
            `insert into issue_subscribers (issue_id, user_id, subscribed_at)
             values ($1,$2,$3) on conflict do nothing`,
            [id, userId, now],
          );
        }

        const identifier = formatIdentifier(key, firstNumber + index);
        await insertActivity(
          t,
          {
            issueId: id,
            userId: actorId,
            type: "issue_created",
            payload: {
              ...change(null, { id, label: identifier }),
              title: input.title,
            },
            createdAt: now,
          },
          now,
        );
        await appendChangeEvent(t, {
          workspaceId,
          entity: "issue",
          entityId: id,
          action: "create",
          actorId,
          payload: { teamId, identifier },
        });

        createdIds.push(id);
      }
    }

    return this.#selectByIds(t, createdIds);
  }

  /* -------------------------------------------------------------- reads -- */

  /** A live issue — see {@link LIVE_ISSUE} for what that excludes and why. */
  async byId(id: IssueId, tx?: Tx): Promise<IssueWithRelations | null> {
    const rows = await this.reader(tx).query(
      `select ${ISSUE_SELECT} ${ISSUE_FROM} where i.id = $1 and ${LIVE_ISSUE}`,
      [id],
    );
    const row = rows[0];
    return row === undefined ? null : mapIssueRow(row);
  }

  /**
   * The row whatever state it is in, archived and trashed included.
   *
   * Separate from {@link byId} rather than a flag on it, because the safe
   * answer has to be the one you get by default: a caller that forgets the flag
   * should refuse to load a trashed issue, not accept an edit to it. The
   * callers are the lifecycle mutations — archiving an issue and then reading
   * it back through a read that hides archived issues would report the write it
   * just made as a missing row — and anything that has to show the trash.
   */
  async byIdIncludingDeleted(
    id: IssueId,
    tx?: Tx,
  ): Promise<IssueWithRelations | null> {
    const rows = await this.reader(tx).query(
      `select ${ISSUE_SELECT} ${ISSUE_FROM} where i.id = $1`,
      [id],
    );
    const row = rows[0];
    return row === undefined ? null : mapIssueRow(row);
  }

  async byIdentifier(
    workspaceId: WorkspaceId,
    identifier: string,
    tx?: Tx,
  ): Promise<IssueWithRelations | null> {
    const parsed = parseIdentifier(identifier);
    if (parsed === null) return null;
    const rows = await this.reader(tx).query(
      `select ${ISSUE_SELECT} ${ISSUE_FROM}
        where t.workspace_id = $1 and lower(t.key) = lower($2) and i.number = $3
          and ${LIVE_ISSUE}`,
      [workspaceId, parsed.teamKey, parsed.number],
    );
    const row = rows[0];
    return row === undefined ? null : mapIssueRow(row);
  }

  async list(query: IssueQuery, tx?: Tx): Promise<IssueWithRelations[]> {
    const params = new Params();
    const workspace = params.bind(query.workspaceId);
    const filter = issueFilterSql(query.filter ?? {}, {
      alias: "i",
      startIndex: params.next,
    });
    params.values.push(...(filter.params as readonly SqlValue[]));

    const limit = params.bind(Math.max(1, Math.min(query.limit ?? 250, 1_000)));
    const offset = params.bind(Math.max(0, query.offset ?? 0));

    const rows = await this.reader(tx).query(
      `select ${ISSUE_SELECT} ${ISSUE_FROM}
        where t.workspace_id = ${workspace} and (${filter.text})
        order by ${issueOrderBySql(query.orderBy, query.direction, "i")}
        limit ${limit} offset ${offset}`,
      params.values,
    );
    return rows.map(mapIssueRow);
  }

  async count(
    query: Omit<IssueQuery, "limit" | "offset">,
    tx?: Tx,
  ): Promise<number> {
    const params = new Params();
    const workspace = params.bind(query.workspaceId);
    const filter = issueFilterSql(query.filter ?? {}, {
      alias: "i",
      startIndex: params.next,
    });
    params.values.push(...(filter.params as readonly SqlValue[]));

    const rows = await this.reader(tx).query(
      `select count(*) as total
         from issues i join teams t on t.id = i.team_id
        where t.workspace_id = ${workspace} and (${filter.text})`,
      params.values,
    );
    const row = rows[0];
    return row === undefined ? 0 : num(row, "total");
  }

  /**
   * A parent's children, in their manual order.
   *
   * The same predicate as the progress counts in {@link ISSUE_SELECT}, and it
   * has to be: a list showing four sub-issues under a donut that says "3 of 3"
   * is a bug report waiting to happen, and the two disagreeing is exactly what
   * happens when one of them forgets a lifecycle column.
   */
  async listSubIssues(parentId: IssueId, tx?: Tx): Promise<IssueWithRelations[]> {
    const rows = await this.reader(tx).query(
      `select ${ISSUE_SELECT} ${ISSUE_FROM}
        where i.parent_id = $1 and ${LIVE_ISSUE}
        order by i.sub_issue_sort_order asc, i.id asc`,
      [parentId],
    );
    return rows.map(mapIssueRow);
  }

  /* ------------------------------------------------------------ update -- */

  async update(
    id: IssueId,
    patch: UpdateIssueInput,
    actorId: UserId,
    tx?: Tx,
  ): Promise<IssueWithRelations> {
    return this.atomically(tx, async (t) => {
      await this.#applyPatch(t, id, patch, actorId);
      return this.#require(t, id);
    });
  }

  async updateMany(
    ids: readonly IssueId[],
    patch: UpdateIssueInput,
    actorId: UserId,
    tx?: Tx,
  ): Promise<IssueWithRelations[]> {
    if (ids.length === 0) return [];
    return this.atomically(tx, async (t) => {
      for (const id of ids) await this.#applyPatch(t, id, patch, actorId);
      return this.#selectByIds(t, ids);
    });
  }

  /**
   * The whole update path: diff, write, log.
   *
   * A field absent from the patch is untouched; a field present and equal to
   * what is stored is dropped here rather than written, so a settings form that
   * submits every field does not produce a feed of "changed title from X to X"
   * and does not bump `updated_at`. That is Linear's own definition —
   * `updatedAt` is "the last time at which the entity was **meaningfully**
   * updated" (`research/03-data-model.md` §3.3).
   */
  async #applyPatch(
    t: SqlExecutor,
    id: IssueId,
    patch: UpdateIssueInput,
    actorId: UserId,
  ): Promise<void> {
    const before = await this.#load(t, id);
    const now = this.now();
    const params = new Params();
    const sets: string[] = [];
    const activities: { type: ActivityType; payload: ActivityPayload }[] = [];
    const fields: string[] = [];

    const set = (column: string, value: SqlValue): void => {
      sets.push(`${column} = ${params.bind(value)}`);
    };

    if (patch.title !== undefined && patch.title !== before.title) {
      set("title", patch.title);
      fields.push("title");
      activities.push({
        type: "title_changed",
        payload: change(
          { id: null, label: before.title },
          { id: null, label: patch.title },
        ),
      });
    }

    if (patch.description !== undefined && patch.description !== before.description) {
      set("description", patch.description);
      fields.push("description");
      // A marker, with no bodies in the payload. Storing both revisions of a
      // markdown description in an append-only table makes it grow without
      // bound for the one field nobody diffs in a feed
      // (`research/03-data-model.md` §5.3).
      activities.push({ type: "description_changed", payload: change(null, null) });
    }

    if (patch.priority !== undefined && patch.priority !== before.priority) {
      set("priority", patch.priority);
      fields.push("priority");
      activities.push({
        type: "priority_changed",
        payload: change(
          { id: String(before.priority), label: PRIORITY_LABELS[before.priority] },
          { id: String(patch.priority), label: PRIORITY_LABELS[patch.priority] },
        ),
      });
    }

    if (patch.estimate !== undefined && patch.estimate !== before.estimate) {
      set("estimate", patch.estimate);
      fields.push("estimate");
      activities.push({
        type: "estimate_changed",
        payload: change(
          before.estimate === null
            ? null
            : { id: String(before.estimate), label: String(before.estimate) },
          patch.estimate === null
            ? null
            : { id: String(patch.estimate), label: String(patch.estimate) },
        ),
      });
    }

    if (patch.dueDate !== undefined && patch.dueDate !== before.dueDate) {
      set("due_date", patch.dueDate);
      fields.push("dueDate");
      activities.push({
        type: "due_date_changed",
        payload: change(
          before.dueDate === null ? null : { id: before.dueDate, label: before.dueDate },
          patch.dueDate === null ? null : { id: patch.dueDate, label: patch.dueDate },
        ),
      });
    }

    if (patch.assigneeId !== undefined && patch.assigneeId !== before.assigneeId) {
      set("assignee_id", patch.assigneeId);
      fields.push("assignee");
      activities.push({
        type: "assignee_changed",
        payload: change(
          await this.#side(t, "user", before.assigneeId),
          await this.#side(t, "user", patch.assigneeId),
        ),
      });
      // Whoever is now responsible follows the issue. Unassigning does not
      // unsubscribe: someone who was assigned and then moved off still wants
      // to know how it ends.
      if (patch.assigneeId !== null) {
        await t.execute(
          `insert into issue_subscribers (issue_id, user_id, subscribed_at)
           values ($1,$2,$3) on conflict do nothing`,
          [id, patch.assigneeId, now],
        );
      }
    }

    if (patch.projectId !== undefined && patch.projectId !== before.projectId) {
      set("project_id", patch.projectId);
      fields.push("project");
      activities.push({
        type: "project_changed",
        payload: change(
          await this.#side(t, "project", before.projectId),
          await this.#side(t, "project", patch.projectId),
        ),
      });
      // A milestone belongs to a project; leaving the project has to drop it
      // or the issue points at a milestone on a board it is no longer on.
      if (patch.milestoneId === undefined && before.milestoneId !== null) {
        set("milestone_id", null);
        fields.push("milestone");
      }
    }

    if (patch.milestoneId !== undefined && patch.milestoneId !== before.milestoneId) {
      set("milestone_id", patch.milestoneId);
      fields.push("milestone");
      activities.push({
        type: "milestone_changed",
        payload: change(
          await this.#side(t, "milestone", before.milestoneId),
          await this.#side(t, "milestone", patch.milestoneId),
        ),
      });
    }

    if (patch.parentId !== undefined && patch.parentId !== before.parentId) {
      if (patch.parentId === id) {
        throw new ConflictError("An issue cannot be its own parent");
      }
      set("parent_id", patch.parentId);
      fields.push("parent");
      // `subIssueSortOrder` exists only while the issue has a parent
      // (`entities.ts`), so it is allocated and dropped with the relationship
      // rather than left behind as a key into a list the issue has left.
      set(
        "sub_issue_sort_order",
        patch.parentId === null ? null : await this.#nextSubIssueKey(t, patch.parentId),
      );
      activities.push({
        type: "parent_changed",
        payload: change(
          await this.#side(t, "issue", before.parentId),
          await this.#side(t, "issue", patch.parentId),
        ),
      });
    }

    if (patch.sortOrder !== undefined && patch.sortOrder !== before.sortOrder) {
      set("sort_order", patch.sortOrder);
      fields.push("sortOrder");
    }

    if (
      patch.subIssueSortOrder !== undefined &&
      patch.subIssueSortOrder !== before.subIssueSortOrder &&
      patch.parentId === undefined
    ) {
      set("sub_issue_sort_order", patch.subIssueSortOrder);
      fields.push("subIssueSortOrder");
    }

    if (patch.stateId !== undefined && patch.stateId !== before.stateId) {
      const next = await this.#state(t, patch.stateId);
      const stamps = transitionStamps(before.stateType, next.type, before, now);

      set("state_id", next.id);
      set("started_at", stamps.startedAt);
      set("completed_at", stamps.completedAt);
      set("canceled_at", stamps.canceledAt);
      set("triaged_at", stamps.triagedAt);
      fields.push("state");
      activities.push({
        type: "state_changed",
        payload: {
          ...change(
            { id: before.stateId, label: before.stateName },
            { id: next.id, label: next.name },
          ),
          fromType: before.stateType,
          toType: next.type,
        },
      });
    }

    if (sets.length === 0) return;

    set("updated_at", now);
    const idParam = params.bind(id);
    await t.execute(
      `update issues set ${sets.join(", ")} where id = ${idParam}`,
      params.values,
    );

    for (const entry of activities) {
      await insertActivity(
        t,
        { issueId: id, userId: actorId, type: entry.type, payload: entry.payload },
        now,
      );
    }
    await appendChangeEvent(t, {
      workspaceId: before.workspaceId,
      entity: "issue",
      entityId: id,
      action: "update",
      actorId,
      payload: { fields },
    });
  }

  async move(
    id: IssueId,
    beforeKey: string | null,
    afterKey: string | null,
    actorId: UserId,
    tx?: Tx,
  ): Promise<IssueWithRelations> {
    // `keyBetween` throws when the neighbours are out of sequence rather than
    // inventing a key that lands somewhere arbitrary — a drag handler that got
    // its neighbours the wrong way round is a bug worth surfacing, not one
    // worth papering over with a list that silently reorders itself.
    const sortOrder = keyBetween(beforeKey, afterKey);
    return this.atomically(tx, async (t) => {
      const before = await this.#load(t, id);
      const now = this.now();
      await t.execute(
        `update issues set sort_order = $2, updated_at = $3 where id = $1`,
        [id, sortOrder, now],
      );
      await appendChangeEvent(t, {
        workspaceId: before.workspaceId,
        entity: "issue",
        entityId: id,
        action: "update",
        actorId,
        payload: { fields: ["sortOrder"], sortOrder },
      });
      return this.#require(t, id);
    });
  }

  /* ------------------------------------------------------------ labels -- */

  async addLabel(
    issueId: IssueId,
    labelId: LabelId,
    actorId: UserId,
    tx?: Tx,
  ): Promise<void> {
    await this.atomically(tx, async (t) => {
      const before = await this.#load(t, issueId);
      const added = await t.execute(
        `insert into issue_labels (issue_id, label_id) values ($1,$2)
         on conflict do nothing`,
        [issueId, labelId],
      );
      if (added === 0) return;
      await insertActivity(
        t,
        {
          issueId,
          userId: actorId,
          type: "label_added",
          payload: change(null, await this.#side(t, "label", labelId)),
        },
        this.now(),
      );
      await appendChangeEvent(t, {
        workspaceId: before.workspaceId,
        entity: "issue",
        entityId: issueId,
        action: "update",
        actorId,
        payload: { fields: ["labels"], added: [labelId] },
      });
    });
  }

  async removeLabel(
    issueId: IssueId,
    labelId: LabelId,
    actorId: UserId,
    tx?: Tx,
  ): Promise<void> {
    await this.atomically(tx, async (t) => {
      const before = await this.#load(t, issueId);
      const side = await this.#side(t, "label", labelId);
      const removed = await t.execute(
        `delete from issue_labels where issue_id = $1 and label_id = $2`,
        [issueId, labelId],
      );
      if (removed === 0) return;
      await insertActivity(
        t,
        {
          issueId,
          userId: actorId,
          type: "label_removed",
          payload: change(side, null),
        },
        this.now(),
      );
      await appendChangeEvent(t, {
        workspaceId: before.workspaceId,
        entity: "issue",
        entityId: issueId,
        action: "update",
        actorId,
        payload: { fields: ["labels"], removed: [labelId] },
      });
    });
  }

  async setLabels(
    issueId: IssueId,
    labelIds: readonly LabelId[],
    actorId: UserId,
    tx?: Tx,
  ): Promise<void> {
    await this.atomically(tx, async (t) => {
      const rows = await t.query(
        `select label_id from issue_labels where issue_id = $1`,
        [issueId],
      );
      const current = new Set(rows.map((row) => text(row, "label_id")));
      const next = new Set<string>(labelIds);
      for (const labelId of next) {
        if (!current.has(labelId)) await this.addLabel(issueId, labelId, actorId, t);
      }
      for (const labelId of current) {
        if (!next.has(labelId)) await this.removeLabel(issueId, labelId, actorId, t);
      }
    });
  }

  /* --------------------------------------------------------- relations -- */

  async addRelation(
    issueId: IssueId,
    relatedIssueId: IssueId,
    type: IssueRelationType,
    actorId: UserId,
    tx?: Tx,
  ): Promise<IssueRelation> {
    if (issueId === relatedIssueId) {
      throw new ConflictError("An issue cannot relate to itself");
    }
    return this.atomically(tx, async (t) => {
      const before = await this.#load(t, issueId);
      const id = newId("rel");
      const now = this.now();
      const inserted = await t.query(
        `insert into issue_relations (id, issue_id, related_issue_id, type, created_at)
         values ($1,$2,$3,$4,$5)
         on conflict (issue_id, related_issue_id, type) do nothing
         returning id, created_at`,
        [id, issueId, relatedIssueId, type, now],
      );
      const row = inserted[0];
      if (row === undefined) {
        throw new ConflictError(`That ${type} relation already exists`);
      }
      await insertActivity(
        t,
        {
          issueId,
          userId: actorId,
          type: "relation_added",
          payload: {
            ...change(null, await this.#side(t, "issue", relatedIssueId)),
            relationType: type,
          },
        },
        now,
      );
      await appendChangeEvent(t, {
        workspaceId: before.workspaceId,
        entity: "issueRelation",
        entityId: id,
        action: "create",
        actorId,
        payload: { issueId, relatedIssueId, type },
      });
      return {
        id,
        issueId,
        relatedIssueId,
        type,
        createdAt: timestamp(row["created_at"]),
      };
    });
  }

  async removeRelation(
    relationId: IssueRelation["id"],
    actorId: UserId,
    tx?: Tx,
  ): Promise<void> {
    await this.atomically(tx, async (t) => {
      const rows = await t.query(
        `select issue_id, related_issue_id, type from issue_relations where id = $1`,
        [relationId],
      );
      const row = rows[0];
      if (row === undefined) throw new NotFoundError("IssueRelation", relationId);
      const issueId = text(row, "issue_id");
      const before = await this.#load(t, issueId);
      const side = await this.#side(t, "issue", text(row, "related_issue_id"));

      await t.execute(`delete from issue_relations where id = $1`, [relationId]);
      await insertActivity(
        t,
        {
          issueId,
          userId: actorId,
          type: "relation_removed",
          payload: { ...change(side, null), relationType: text(row, "type") },
        },
        this.now(),
      );
      await appendChangeEvent(t, {
        workspaceId: before.workspaceId,
        entity: "issueRelation",
        entityId: relationId,
        action: "delete",
        actorId,
        payload: { issueId },
      });
    });
  }

  /**
   * Both ends of the graph, with the inverse *derived*.
   *
   * A row is stored once, in the direction it was created. The second half of
   * the union re-reads those rows from the other side and flips the type
   * through `INVERSE_RELATION`, so `A blocks B` is listed on B as `blocked_by
   * A` without a second row that could disagree with the first.
   */
  async listRelations(
    issueId: IssueId,
    tx?: Tx,
  ): Promise<IssueRelationWithTarget[]> {
    const rows = await this.reader(tx).query(
      `select r.id, r.type, r.created_at, r.issue_id, r.related_issue_id,
              false as inverted,
              ot.key || '-' || o.number::text as related_identifier,
              o.title as related_title, os.type as related_state_type
         from issue_relations r
         join issues o on o.id = r.related_issue_id
         join teams ot on ot.id = o.team_id
         join workflow_states os on os.id = o.state_id
        where r.issue_id = $1
       union all
       select r.id, r.type, r.created_at, r.issue_id, r.related_issue_id,
              true as inverted,
              ot.key || '-' || o.number::text as related_identifier,
              o.title as related_title, os.type as related_state_type
         from issue_relations r
         join issues o on o.id = r.issue_id
         join teams ot on ot.id = o.team_id
         join workflow_states os on os.id = o.state_id
        where r.related_issue_id = $1
        order by created_at asc, id asc`,
      [issueId],
    );

    return rows.map((row) => {
      const inverted = row["inverted"] === true;
      const stored = text(row, "type") as IssueRelationType;
      return {
        id: text(row, "id"),
        issueId,
        relatedIssueId: inverted
          ? text(row, "issue_id")
          : text(row, "related_issue_id"),
        type: inverted ? INVERSE_RELATION[stored] : stored,
        createdAt: timestamp(row["created_at"]),
        relatedIdentifier: text(row, "related_identifier"),
        relatedTitle: text(row, "related_title"),
        relatedStateType: text(row, "related_state_type") as StateType,
      };
    });
  }

  /**
   * The blocking component around a team, bounded by visibility and by size.
   *
   * ## One walk, not one query per issue
   *
   * A recursive CTE follows `issue_relations` out from the team's issues in
   * both stored directions — the row for "A blocks B" is the same row as "B is
   * blocked by A" — until it stops finding anything new. `union` rather than
   * `union all` is what makes it terminate on a cyclic graph: the duplicate
   * elimination is the visited set, and `A → B → C → A` would otherwise recurse
   * until the server gave up.
   *
   * ## The visibility predicate is inside the recursion
   *
   * `other.team_id in (…)` sits in the recursive term, not in the final select.
   * Filtering afterwards would leave an invisible issue working as a bridge: a
   * private issue blocking two visible ones would still tell the viewer those
   * two are connected, and how many hops apart, while showing nothing in
   * between. Refusing to step onto it ends the chain there instead, which looks
   * exactly like a chain that ended.
   *
   * ## Direction is not decided here
   *
   * The rows come back as stored — `(issue_id, related_issue_id, type)` — and
   * `domain/services/dependency-graph.ts` turns them into blocker → blocked
   * edges. A `case` expression in this query could do it in two lines, and then
   * the knowledge of what the inverse of a relation *is* would live both in
   * `entities.ts` and in a string in this file.
   */
  async dependencyGraph(
    query: DependencyGraphQuery,
    tx?: Tx,
  ): Promise<DependencyGraphRows> {
    const reader = this.reader(tx);
    const isolatedCount = await this.#isolatedIssueCount(query.teamId, reader);
    const empty: DependencyGraphRows = {
      issues: [],
      relations: [],
      isolatedCount,
      truncated: false,
    };
    // `in ()` is a syntax error, and a viewer with no visible team has no
    // graph to draw in any case.
    if (query.visibleTeamIds.length === 0) return empty;

    const cap = Math.max(1, Math.min(query.maxNodes, HARD_GRAPH_NODE_CEILING));

    const params = new Params();
    const team = params.bind(query.teamId);
    const visible = params.bindAll(query.visibleTeamIds as readonly SqlValue[]);
    // One more than the cap, so a full page and an overflowing one are
    // distinguishable without a second counting query.
    const limit = params.bind(cap + 1);

    const rows = await reader.query(
      `with recursive seeds as (
         select i.id
           from issues i
          where i.team_id = ${team}
            and ${LIVE_ISSUE}
            and exists (
              select 1
                from issue_relations r
               where (r.issue_id = i.id or r.related_issue_id = i.id)
                 and r.type in ('blocks', 'blocked_by'))
       ),
       reachable as (
         select id from seeds
          union
         select other.id
           from reachable c
           join issue_relations r
             on r.issue_id = c.id or r.related_issue_id = c.id
           join issues other
             on other.id = case
                             when r.issue_id = c.id then r.related_issue_id
                             else r.issue_id
                           end
          where r.type in ('blocks', 'blocked_by')
            and other.archived_at is null
            and other.trashed_at is null
            and other.team_id in (${visible})
       )
       select i.id, i.title, i.priority, i.number,
              t.key as team_key, i.team_id,
              s.name as state_name, s.type as state_type, s.color as state_color,
              u.name as assignee_name,
              u.avatar_color as assignee_avatar_color,
              u.avatar_url as assignee_avatar_url
         from reachable c
         join issues i on i.id = c.id
         join teams t on t.id = i.team_id
         join workflow_states s on s.id = i.state_id
         left join users u on u.id = i.assignee_id
        order by case when i.team_id = ${team} then 0 else 1 end,
                 t.key asc, i.number asc
        limit ${limit}`,
      params.values,
    );

    // The team's own issues sort first, so a cut component keeps the issues the
    // page is *about* and loses the far end of somebody else's chain.
    const truncated = rows.length > cap;
    const issues = (truncated ? rows.slice(0, cap) : rows).map(
      (row): DependencyGraphIssue => ({
        id: text(row, "id"),
        identifier: formatIdentifier(text(row, "team_key"), num(row, "number")),
        title: text(row, "title"),
        teamId: text(row, "team_id"),
        teamKey: text(row, "team_key"),
        stateName: text(row, "state_name"),
        stateType: text(row, "state_type") as StateType,
        stateColor: text(row, "state_color"),
        priority: num(row, "priority") as Priority,
        assigneeName: nullableText(row, "assignee_name"),
        assigneeAvatarColor: nullableText(row, "assignee_avatar_color"),
        assigneeAvatarUrl: nullableText(row, "assignee_avatar_url"),
      }),
    );

    if (issues.length === 0) return empty;

    const relations = await this.#relationsAmong(
      issues.map((issue) => issue.id),
      reader,
    );
    return { issues, relations, isolatedCount, truncated };
  }

  /**
   * Blocking relations with *both* ends in the given set.
   *
   * Both, not either: an edge with one end outside is an edge to a node that
   * will not be drawn, and the layout would either crash on the dangling id or
   * silently invent a node for it. Truncation is the ordinary way that happens.
   */
  async #relationsAmong(
    ids: readonly IssueId[],
    reader: SqlExecutor,
  ): Promise<DependencyRelation[]> {
    const params = new Params();
    const list = params.bindAll(ids as readonly SqlValue[]);
    const rows = await reader.query(
      `select r.issue_id, r.related_issue_id, r.type
         from issue_relations r
        where r.type in ('blocks', 'blocked_by')
          and r.issue_id in (${list})
          and r.related_issue_id in (${list})
        order by r.created_at asc, r.id asc`,
      params.values,
    );
    return rows.map((row) => ({
      issueId: text(row, "issue_id"),
      relatedIssueId: text(row, "related_issue_id"),
      type: text(row, "type") as IssueRelationType,
    }));
  }

  /** Live issues in the team that no blocking relation touches. */
  async #isolatedIssueCount(
    teamId: string,
    reader: SqlExecutor,
  ): Promise<number> {
    const rows = await reader.query(
      `select count(*) as total
         from issues i
        where i.team_id = $1
          and ${LIVE_ISSUE}
          and not exists (
            select 1
              from issue_relations r
             where (r.issue_id = i.id or r.related_issue_id = i.id)
               and r.type in ('blocks', 'blocked_by'))`,
      [teamId],
    );
    const row = rows[0];
    return row === undefined ? 0 : num(row, "total");
  }

  /* ------------------------------------------------------ subscriptions -- */

  async subscribe(issueId: IssueId, userId: UserId, tx?: Tx): Promise<void> {
    await this.reader(tx).execute(
      `insert into issue_subscribers (issue_id, user_id, subscribed_at)
       values ($1,$2,$3) on conflict do nothing`,
      [issueId, userId, this.now()],
    );
  }

  async unsubscribe(issueId: IssueId, userId: UserId, tx?: Tx): Promise<void> {
    await this.reader(tx).execute(
      `delete from issue_subscribers where issue_id = $1 and user_id = $2`,
      [issueId, userId],
    );
  }

  async listSubscribers(issueId: IssueId, tx?: Tx): Promise<User[]> {
    const rows = await this.reader(tx).query(
      `select u.id, u.email, u.name, u.display_name, u.avatar_url,
              u.avatar_color, u.created_at, u.active
         from issue_subscribers s join users u on u.id = s.user_id
        where s.issue_id = $1
        order by u.name asc`,
      [issueId],
    );
    return rows.map((row) => mapUserRow(row));
  }

  /* ---------------------------------------------------------- lifecycle -- */

  async archive(id: IssueId, actorId: UserId, tx?: Tx): Promise<IssueWithRelations> {
    return this.#setArchived(id, true, actorId, tx);
  }

  async unarchive(id: IssueId, actorId: UserId, tx?: Tx): Promise<IssueWithRelations> {
    return this.#setArchived(id, false, actorId, tx);
  }

  async #setArchived(
    id: IssueId,
    archived: boolean,
    actorId: UserId,
    tx?: Tx,
  ): Promise<IssueWithRelations> {
    return this.atomically(tx, async (t) => {
      const before = await this.#load(t, id);
      if ((before.archivedAt !== null) === archived) return this.#require(t, id);
      const now = this.now();
      await t.execute(
        `update issues set archived_at = $2, updated_at = $3 where id = $1`,
        [id, archived ? now : null, now],
      );
      await insertActivity(
        t,
        {
          issueId: id,
          userId: actorId,
          type: archived ? "issue_archived" : "issue_unarchived",
          payload: change(null, null),
        },
        now,
      );
      await appendChangeEvent(t, {
        workspaceId: before.workspaceId,
        entity: "issue",
        entityId: id,
        action: "update",
        actorId,
        payload: { fields: ["archivedAt"], archived },
      });
      return this.#require(t, id);
    });
  }

  async trash(id: IssueId, actorId: UserId, tx?: Tx): Promise<void> {
    await this.#setTrashed(id, true, actorId, tx);
  }

  async restore(id: IssueId, actorId: UserId, tx?: Tx): Promise<IssueWithRelations> {
    return this.#setTrashed(id, false, actorId, tx);
  }

  async #setTrashed(
    id: IssueId,
    trashed: boolean,
    actorId: UserId,
    tx?: Tx,
  ): Promise<IssueWithRelations> {
    return this.atomically(tx, async (t) => {
      const before = await this.#load(t, id);
      const now = this.now();
      await t.execute(
        `update issues set trashed_at = $2, updated_at = $3 where id = $1`,
        [id, trashed ? now : null, now],
      );
      await appendChangeEvent(t, {
        workspaceId: before.workspaceId,
        entity: "issue",
        entityId: id,
        action: trashed ? "delete" : "update",
        actorId,
        payload: { fields: ["trashedAt"], trashed },
      });
      return this.#require(t, id);
    });
  }

  async purge(id: IssueId, actorId: UserId, tx?: Tx): Promise<void> {
    await this.atomically(tx, async (t) => {
      const before = await this.#load(t, id);
      // Sub-issues survive their parent: `issues.parent_id` is `on delete set
      // null`, so purging a parent orphans its children rather than deleting
      // work nobody asked to delete.
      await t.execute(`delete from issues where id = $1`, [id]);
      await appendChangeEvent(t, {
        workspaceId: before.workspaceId,
        entity: "issue",
        entityId: id,
        action: "delete",
        actorId,
        payload: { purged: true },
      });
    });
  }

  /* ------------------------------------------------------------ helpers -- */

  /**
   * The row a mutation just wrote, read back.
   *
   * Deliberately the lifecycle-blind read: archiving an issue and then loading
   * it through {@link byId} would report the write that just succeeded as a
   * missing row. Whether the *caller* was entitled to touch a trashed issue is
   * a question for the layer that resolved the id, and it asks it with `byId`.
   */
  async #require(t: SqlExecutor, id: IssueId): Promise<IssueWithRelations> {
    const issue = await this.byIdIncludingDeleted(id, t);
    if (issue === null) throw new NotFoundError("Issue", id);
    return issue;
  }

  async #selectByIds(
    t: SqlExecutor,
    ids: readonly IssueId[],
  ): Promise<IssueWithRelations[]> {
    if (ids.length === 0) return [];
    const params = new Params();
    const list = params.bindAll([...ids]);
    const rows = await t.query(
      `select ${ISSUE_SELECT} ${ISSUE_FROM} where i.id in (${list})`,
      params.values,
    );
    // Returned in the order asked for, not the order the planner produced —
    // `createMany` is expected to hand back its inputs' results positionally.
    const byId = new Map(rows.map((row) => [text(row, "id"), mapIssueRow(row)]));
    return ids
      .map((id) => byId.get(id))
      .filter((issue): issue is IssueWithRelations => issue !== undefined);
  }

  async #load(t: SqlExecutor, id: IssueId): Promise<IssueContext> {
    const rows = await t.query(
      `select i.id, i.team_id, i.number, i.title, i.description, i.state_id,
              i.priority, i.assignee_id, i.project_id, i.milestone_id,
              i.parent_id, i.estimate, i.due_date::text as due_date,
              i.sort_order, i.sub_issue_sort_order,
              i.started_at, i.completed_at, i.canceled_at, i.triaged_at,
              i.archived_at,
              s.name as state_name, s.type as state_type,
              t.workspace_id as workspace_id, t.key as team_key
         from issues i
         join workflow_states s on s.id = i.state_id
         join teams t on t.id = i.team_id
        where i.id = $1`,
      [id],
    );
    const row = rows[0];
    if (row === undefined) throw new NotFoundError("Issue", id);
    return {
      id: text(row, "id"),
      teamId: text(row, "team_id"),
      workspaceId: text(row, "workspace_id"),
      teamKey: text(row, "team_key"),
      number: num(row, "number"),
      title: text(row, "title"),
      description: text(row, "description"),
      stateId: text(row, "state_id"),
      stateName: text(row, "state_name"),
      stateType: text(row, "state_type") as StateType,
      priority: num(row, "priority") as Priority,
      assigneeId: nullableText(row, "assignee_id"),
      projectId: nullableText(row, "project_id"),
      milestoneId: nullableText(row, "milestone_id"),
      parentId: nullableText(row, "parent_id"),
      estimate: nullableNum(row, "estimate"),
      dueDate: nullableText(row, "due_date"),
      sortOrder: text(row, "sort_order"),
      subIssueSortOrder: nullableText(row, "sub_issue_sort_order"),
      startedAt: nullableTimestamp(row["started_at"]),
      completedAt: nullableTimestamp(row["completed_at"]),
      canceledAt: nullableTimestamp(row["canceled_at"]),
      triagedAt: nullableTimestamp(row["triaged_at"]),
      archivedAt: nullableTimestamp(row["archived_at"]),
    };
  }

  /** The key that puts an issue at the top of its team's list. */
  async #topSortOrder(t: SqlExecutor, teamId: string): Promise<string | null> {
    const rows = await t.query(
      `select min(sort_order) as top from issues
        where team_id = $1 and archived_at is null and trashed_at is null`,
      [teamId],
    );
    const row = rows[0];
    return row === undefined ? null : nullableText(row, "top");
  }

  /** The key that appends a sub-issue to its parent's children. */
  async #nextSubIssueKey(t: SqlExecutor, parentId: string): Promise<string> {
    const rows = await t.query(
      `select max(sub_issue_sort_order) as bottom from issues where parent_id = $1`,
      [parentId],
    );
    const row = rows[0];
    return keyBetween(row === undefined ? null : nullableText(row, "bottom"), null);
  }

  async #state(
    t: SqlExecutor,
    stateId: string,
  ): Promise<{ id: string; name: string; type: StateType }> {
    const rows = await t.query(
      `select id, name, type from workflow_states where id = $1`,
      [stateId],
    );
    const row = rows[0];
    if (row === undefined) throw new NotFoundError("WorkflowState", stateId);
    return {
      id: text(row, "id"),
      name: text(row, "name"),
      type: text(row, "type") as StateType,
    };
  }

  /**
   * The state a new issue lands in.
   *
   * Triage when the team uses it, then the first `unstarted` state, then the
   * first `backlog` one. The fallback chain matters because a team's states are
   * editable: an admin who deletes "Todo" should not make issue creation fail.
   */
  async #resolveState(
    t: SqlExecutor,
    teamId: string,
    requested: string | undefined,
  ): Promise<{ id: string; name: string; type: StateType }> {
    if (requested !== undefined) return this.#state(t, requested);
    const rows = await t.query(
      `select s.id, s.name, s.type
         from workflow_states s
         join teams tm on tm.id = s.team_id
        where s.team_id = $1
        order by ${DEFAULT_STATE_ORDER_SQL}
        limit 1`,
      [teamId],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new ConflictError(`Team ${teamId} has no workflow states`);
    }
    return {
      id: text(row, "id"),
      name: text(row, "name"),
      type: text(row, "type") as StateType,
    };
  }

  /**
   * One side of a field change, as `{ id, label }`.
   *
   * The label is read *now* and stored in the payload, which is the whole point
   * — see the module docstring on `activity.ts`. A missing row yields a null
   * label rather than throwing: an activity row for an assignee who has since
   * been hard-deleted should still write.
   */
  async #side(
    t: SqlExecutor,
    kind: LabelKind,
    id: string | null,
  ): Promise<{ id: string | null; label: string | null } | null> {
    if (id === null) return null;
    const sql: Record<LabelKind, string> = {
      user: `select name from users where id = $1`,
      project: `select name from projects where id = $1`,
      milestone: `select name from project_milestones where id = $1`,
      state: `select name from workflow_states where id = $1`,
      label: `select name from labels where id = $1`,
      issue: `select t.key || '-' || i.number::text as name
                from issues i join teams t on t.id = i.team_id where i.id = $1`,
    };
    const rows = await t.query(sql[kind], [id]);
    const row = rows[0];
    return { id, label: row === undefined ? null : nullableText(row, "name") };
  }
}
