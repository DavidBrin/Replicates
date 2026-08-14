import "server-only";

/**
 * Teams, their memberships, and their workflow states.
 *
 * Workflow states live here rather than in their own repository because they
 * have no independent existence: a state belongs to exactly one team, is
 * created with it, and is edited from the team's settings screen. Splitting
 * them out would mean a second repository whose every method takes a team id.
 *
 * ## Two behaviours that are not obvious from the schema
 *
 * **Creating a team creates its states.** A team with no states cannot hold an
 * issue — `issues.state_id` is `not null` — so a team created without them is a
 * team that fails on first use, several screens away from the mistake. The
 * default set is Linear's.
 *
 * **`listForUser` is a query, not a filter.** A guest must not be able to
 * *discover* a team they are not in (SPEC §4), and "fetch everything, hide some"
 * leaks through counts, autocomplete and any endpoint that forgets to apply the
 * filter. The visibility rule is in the `where` clause, so an unlisted team is
 * one that was never selected.
 */

import type { SqlExecutor, SqlRow } from "@/adapters/db/driver";
import type {
  EstimationScale,
  StateId,
  StateType,
  Team,
  TeamId,
  TeamMember,
  TeamRole,
  UserId,
  WorkflowState,
  WorkspaceId,
} from "@/domain/entities";
import { compareWorkflowStates, workflowStateOrderBySql } from "@/domain/sorting";
import { newId, teamKey as keyFromName } from "@/lib/ids";
import {
  ConflictError,
  type CreateTeamInput,
  type CreateWorkflowStateInput,
  NotFoundError,
  type Patch,
  type TeamMemberWithUser,
  type TeamRepository,
  type Tx,
} from "@/ports/repositories";

import { appendChangeEvent } from "./changefeed";
import {
  BaseRepository,
  bool,
  DEFAULT_STATE_ORDER_SQL,
  mapStateRow,
  mapUserRow,
  nullableText,
  num,
  Params,
  text,
  timestamp,
} from "./shared";

/**
 * The states a new team gets.
 *
 * Linear's default workflow, in Linear's order, with Linear's colours. Triage
 * is created only when the team has triage enabled — an unused triage state
 * showing up as an empty group in every board is the reason Linear gates it
 * behind the same toggle.
 */
export const DEFAULT_STATES: readonly {
  readonly name: string;
  readonly type: StateType;
  readonly color: string;
}[] = [
  { name: "Triage", type: "triage", color: "#f2994a" },
  { name: "Backlog", type: "backlog", color: "#bec2c8" },
  { name: "Todo", type: "unstarted", color: "#e2e2e2" },
  { name: "In Progress", type: "started", color: "#f2c94c" },
  { name: "In Review", type: "started", color: "#4ea7fc" },
  { name: "Done", type: "completed", color: "#5e6ad2" },
  { name: "Canceled", type: "canceled", color: "#95a2b3" },
  { name: "Duplicate", type: "canceled", color: "#95a2b3" },
];

const TEAM_KEY_PATTERN = /^[A-Z0-9]{1,5}$/;

export function mapTeamRow(row: SqlRow): Team {
  return {
    id: text(row, "id"),
    workspaceId: text(row, "workspace_id"),
    name: text(row, "name"),
    key: text(row, "key"),
    description: nullableText(row, "description"),
    icon: text(row, "icon"),
    color: text(row, "color"),
    private: bool(row, "private"),
    triageEnabled: bool(row, "triage_enabled"),
    estimationScale: text(row, "estimation_scale") as EstimationScale,
    issueCounter: num(row, "issue_counter"),
    createdAt: timestamp(row["created_at"]),
  };
}

const TEAM_COLUMNS = `id, workspace_id, name, key, description, icon, color,
  private, triage_enabled, estimation_scale, issue_counter, created_at`;

function mapTeamMemberRow(row: SqlRow): TeamMemberWithUser {
  return {
    teamId: text(row, "team_id"),
    userId: text(row, "user_id"),
    role: text(row, "role") as TeamRole,
    joinedAt: timestamp(row["joined_at"]),
    user: mapUserRow(row),
  };
}

export class SqlTeamRepository extends BaseRepository implements TeamRepository {
  async create(input: CreateTeamInput, actorId: UserId, tx?: Tx): Promise<Team> {
    return this.atomically(tx, async (t) => {
      const id = input.id ?? newId("tem");
      const now = this.now();
      const triageEnabled = input.triageEnabled ?? false;
      const key = await this.#uniqueKey(
        t,
        input.workspaceId,
        (input.key ?? keyFromName(input.name)).toUpperCase(),
      );

      await t.execute(
        `insert into teams (id, workspace_id, name, key, description, icon,
                            color, private, triage_enabled, estimation_scale,
                            issue_counter, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,$11)`,
        [
          id,
          input.workspaceId,
          input.name,
          key,
          input.description ?? null,
          input.icon ?? "Squares",
          input.color ?? "#5e6ad2",
          input.private ?? false,
          triageEnabled,
          input.estimationScale ?? "notUsed",
          now,
        ],
      );

      if (input.withoutDefaultStates !== true) {
        const states = DEFAULT_STATES.filter(
          (state) => state.type !== "triage" || triageEnabled,
        );
        for (const [position, state] of states.entries()) {
          await t.execute(
            `insert into workflow_states
               (id, team_id, name, type, color, position, created_at)
             values ($1,$2,$3,$4,$5,$6,$7)`,
            [newId("sta"), id, state.name, state.type, state.color, position, now],
          );
        }
      }

      // The creator administers the team they just made. Without it, a
      // workspace member creates a team they cannot then configure.
      await t.execute(
        `insert into team_members (team_id, user_id, role, joined_at)
         values ($1,$2,'admin',$3) on conflict do nothing`,
        [id, actorId, now],
      );

      await appendChangeEvent(t, {
        workspaceId: input.workspaceId,
        entity: "team",
        entityId: id,
        action: "create",
        actorId,
        payload: { key, name: input.name },
      });

      return this.#require(t, id);
    });
  }

  async byId(id: TeamId, tx?: Tx): Promise<Team | null> {
    const rows = await this.reader(tx).query(
      `select ${TEAM_COLUMNS} from teams where id = $1`,
      [id],
    );
    const row = rows[0];
    return row === undefined ? null : mapTeamRow(row);
  }

  async byKey(
    workspaceId: WorkspaceId,
    key: string,
    tx?: Tx,
  ): Promise<Team | null> {
    // `lower(key)` matches the unique index; anything else would both miss the
    // index and let `ENG` and `eng` coexist.
    const rows = await this.reader(tx).query(
      `select ${TEAM_COLUMNS} from teams
        where workspace_id = $1 and lower(key) = lower($2)`,
      [workspaceId, key],
    );
    const row = rows[0];
    return row === undefined ? null : mapTeamRow(row);
  }

  async listForWorkspace(workspaceId: WorkspaceId, tx?: Tx): Promise<Team[]> {
    const rows = await this.reader(tx).query(
      `select ${TEAM_COLUMNS} from teams where workspace_id = $1 order by key asc`,
      [workspaceId],
    );
    return rows.map(mapTeamRow);
  }

  async listForUser(
    workspaceId: WorkspaceId,
    userId: UserId,
    tx?: Tx,
  ): Promise<Team[]> {
    const rows = await this.reader(tx).query(
      `select ${TEAM_COLUMNS} from teams t
        where t.workspace_id = $1
          and (
            exists (select 1 from team_members tm
                     where tm.team_id = t.id and tm.user_id = $2)
            or (
              t.private = false
              and exists (select 1 from workspace_members wm
                           where wm.workspace_id = $1
                             and wm.user_id = $2
                             and wm.role <> 'guest')
            )
          )
        order by t.key asc`,
      [workspaceId, userId],
    );
    return rows.map(mapTeamRow);
  }

  async update(
    id: TeamId,
    patch: Patch<
      Pick<
        Team,
        | "name"
        | "key"
        | "description"
        | "icon"
        | "color"
        | "private"
        | "triageEnabled"
        | "estimationScale"
      >
    >,
    actorId: UserId,
    tx?: Tx,
  ): Promise<Team> {
    return this.atomically(tx, async (t) => {
      const before = await this.#require(t, id);
      const params = new Params();
      const sets: string[] = [];
      const fields: string[] = [];

      const set = (column: string, field: string, value: string | number | boolean | null) => {
        sets.push(`${column} = ${params.bind(value)}`);
        fields.push(field);
      };

      if (patch.name !== undefined && patch.name !== before.name) {
        set("name", "name", patch.name);
      }
      if (patch.key !== undefined) {
        const key = patch.key.toUpperCase();
        if (!TEAM_KEY_PATTERN.test(key)) {
          throw new ConflictError(
            `Team key must be 1–5 uppercase letters or digits, got "${patch.key}"`,
          );
        }
        if (key !== before.key) {
          const taken = await this.byKey(before.workspaceId, key, t);
          if (taken !== null) {
            throw new ConflictError(`Team key ${key} is already in use`);
          }
          // Nothing else changes. `identifier` is derived at read time from
          // `team.key` and `issue.number` and is never stored, so renaming a
          // key re-labels every issue in the team without touching a row.
          set("key", "key", key);
        }
      }
      if (patch.description !== undefined && patch.description !== before.description) {
        set("description", "description", patch.description);
      }
      if (patch.icon !== undefined && patch.icon !== before.icon) {
        set("icon", "icon", patch.icon);
      }
      if (patch.color !== undefined && patch.color !== before.color) {
        set("color", "color", patch.color);
      }
      if (patch.private !== undefined && patch.private !== before.private) {
        set("private", "private", patch.private);
      }
      if (
        patch.triageEnabled !== undefined &&
        patch.triageEnabled !== before.triageEnabled
      ) {
        set("triage_enabled", "triageEnabled", patch.triageEnabled);
      }
      if (
        patch.estimationScale !== undefined &&
        patch.estimationScale !== before.estimationScale
      ) {
        // Changing the scale migrates no issues: estimates are always stored as
        // the integer, and the t-shirt scale is a presentation of the same
        // integers (`entities.ts`).
        set("estimation_scale", "estimationScale", patch.estimationScale);
      }

      if (sets.length === 0) return before;

      sets.push(`updated_at = ${params.bind(this.now())}`);
      const idParam = params.bind(id);
      await t.execute(
        `update teams set ${sets.join(", ")} where id = ${idParam}`,
        params.values,
      );
      await appendChangeEvent(t, {
        workspaceId: before.workspaceId,
        entity: "team",
        entityId: id,
        action: "update",
        actorId,
        payload: { fields },
      });
      return this.#require(t, id);
    });
  }

  async delete(id: TeamId, actorId: UserId, tx?: Tx): Promise<void> {
    await this.atomically(tx, async (t) => {
      const before = await this.#require(t, id);
      // Cascades to states, memberships and every issue in the team. There is
      // no trash for a team, which is why the UI asks twice.
      await t.execute(`delete from teams where id = $1`, [id]);
      await appendChangeEvent(t, {
        workspaceId: before.workspaceId,
        entity: "team",
        entityId: id,
        action: "delete",
        actorId,
        payload: { key: before.key },
      });
    });
  }

  /* ----------------------------------------------------------- members -- */

  async listMembers(teamId: TeamId, tx?: Tx): Promise<TeamMemberWithUser[]> {
    const rows = await this.reader(tx).query(
      `select tm.team_id, tm.user_id, tm.role, tm.joined_at,
              u.id, u.email, u.name, u.display_name, u.avatar_url,
              u.avatar_color, u.created_at, u.active
         from team_members tm join users u on u.id = tm.user_id
        where tm.team_id = $1
        order by tm.role asc, u.name asc`,
      [teamId],
    );
    return rows.map(mapTeamMemberRow);
  }

  async addMember(
    teamId: TeamId,
    userId: UserId,
    role: TeamRole,
    tx?: Tx,
  ): Promise<TeamMember> {
    return this.atomically(tx, async (t) => {
      const team = await this.#require(t, teamId);
      // A guest can be *in* a team but never administer one — SPEC §4. The
      // check is here as well as in the policy because this method is what an
      // invite acceptance calls, and an invite is not an actor with a role.
      if (role === "admin") {
        const rows = await t.query(
          `select role from workspace_members where workspace_id = $1 and user_id = $2`,
          [team.workspaceId, userId],
        );
        const membership = rows[0];
        if (membership !== undefined && text(membership, "role") === "guest") {
          throw new ConflictError("A guest cannot be a team admin");
        }
      }
      const now = this.now();
      await t.execute(
        `insert into team_members (team_id, user_id, role, joined_at)
         values ($1,$2,$3,$4)
         on conflict (team_id, user_id) do update set role = excluded.role`,
        [teamId, userId, role, now],
      );
      await appendChangeEvent(t, {
        workspaceId: team.workspaceId,
        entity: "teamMember",
        entityId: `${teamId}:${userId}`,
        action: "create",
        actorId: userId,
        payload: { teamId, userId, role },
      });
      return { teamId, userId, role, joinedAt: timestamp(now) };
    });
  }

  async setMemberRole(
    teamId: TeamId,
    userId: UserId,
    role: TeamRole,
    tx?: Tx,
  ): Promise<TeamMember> {
    return this.addMember(teamId, userId, role, tx);
  }

  async removeMember(teamId: TeamId, userId: UserId, tx?: Tx): Promise<void> {
    await this.atomically(tx, async (t) => {
      const team = await this.#require(t, teamId);
      await t.execute(
        `delete from team_members where team_id = $1 and user_id = $2`,
        [teamId, userId],
      );
      await appendChangeEvent(t, {
        workspaceId: team.workspaceId,
        entity: "teamMember",
        entityId: `${teamId}:${userId}`,
        action: "delete",
        actorId: userId,
        payload: { teamId, userId },
      });
    });
  }

  /* ------------------------------------------------------------ states -- */

  async listStates(teamId: TeamId, tx?: Tx): Promise<WorkflowState[]> {
    const rows = await this.reader(tx).query(
      `select id, team_id, name, type, color, description, position
         from workflow_states s
        where s.team_id = $1
        order by ${workflowStateOrderBySql("s")}`,
      [teamId],
    );
    // Sorted again in JavaScript rather than trusted from SQL, because the
    // grouped list re-sorts client-side after an optimistic edit and the two
    // orders must be the same one. `compareWorkflowStates` is that order.
    return rows.map(mapStateRow).sort(compareWorkflowStates);
  }

  async createState(
    input: CreateWorkflowStateInput,
    tx?: Tx,
  ): Promise<WorkflowState> {
    return this.atomically(tx, async (t) => {
      const id = input.id ?? newId("sta");
      const position =
        input.position ?? (await this.#nextStatePosition(t, input.teamId, input.type));
      await t.execute(
        `insert into workflow_states
           (id, team_id, name, type, color, description, position, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          input.teamId,
          input.name,
          input.type,
          input.color,
          input.description ?? null,
          position,
          this.now(),
        ],
      );
      const team = await this.#require(t, input.teamId);
      await appendChangeEvent(t, {
        workspaceId: team.workspaceId,
        entity: "workflowState",
        entityId: id,
        action: "create",
        payload: { teamId: input.teamId, name: input.name, type: input.type },
      });
      return {
        id,
        teamId: input.teamId,
        name: input.name,
        type: input.type,
        color: input.color,
        description: input.description ?? null,
        position,
      };
    });
  }

  async updateState(
    id: StateId,
    patch: Patch<Pick<WorkflowState, "name" | "color" | "description" | "position">>,
    tx?: Tx,
  ): Promise<WorkflowState> {
    return this.atomically(tx, async (t) => {
      const params = new Params();
      const sets: string[] = [];
      if (patch.name !== undefined) sets.push(`name = ${params.bind(patch.name)}`);
      if (patch.color !== undefined) sets.push(`color = ${params.bind(patch.color)}`);
      if (patch.description !== undefined) {
        sets.push(`description = ${params.bind(patch.description)}`);
      }
      if (patch.position !== undefined) {
        sets.push(`position = ${params.bind(patch.position)}`);
      }
      if (sets.length > 0) {
        await t.execute(
          `update workflow_states set ${sets.join(", ")} where id = ${params.bind(id)}`,
          params.values,
        );
      }
      const rows = await t.query(
        `select id, team_id, name, type, color, description, position
           from workflow_states where id = $1`,
        [id],
      );
      const row = rows[0];
      if (row === undefined) throw new NotFoundError("WorkflowState", id);
      const state = mapStateRow(row);
      const team = await this.#require(t, state.teamId);
      await appendChangeEvent(t, {
        workspaceId: team.workspaceId,
        entity: "workflowState",
        entityId: id,
        action: "update",
        payload: { teamId: state.teamId },
      });
      return state;
    });
  }

  async deleteState(id: StateId, reassignToId: StateId, tx?: Tx): Promise<void> {
    if (id === reassignToId) {
      throw new ConflictError("Cannot reassign a state's issues to itself");
    }
    await this.atomically(tx, async (t) => {
      const rows = await t.query(
        `select id, team_id, name, type, color, description, position
           from workflow_states where id = $1`,
        [id],
      );
      const row = rows[0];
      if (row === undefined) throw new NotFoundError("WorkflowState", id);
      const state = mapStateRow(row);

      // Reassign first. `issues.state_id` is `not null` with no cascade, so the
      // delete would either fail or — if the constraint were ever relaxed —
      // leave issues pointing at nothing.
      await t.execute(`update issues set state_id = $2 where state_id = $1`, [
        id,
        reassignToId,
      ]);
      await t.execute(`delete from workflow_states where id = $1`, [id]);

      const team = await this.#require(t, state.teamId);
      await appendChangeEvent(t, {
        workspaceId: team.workspaceId,
        entity: "workflowState",
        entityId: id,
        action: "delete",
        payload: { teamId: state.teamId, reassignedTo: reassignToId },
      });
    });
  }

  async defaultStateFor(teamId: TeamId, tx?: Tx): Promise<WorkflowState> {
    const rows = await this.reader(tx).query(
      `select s.id, s.team_id, s.name, s.type, s.color, s.description, s.position
         from workflow_states s join teams tm on tm.id = s.team_id
        where s.team_id = $1
        order by ${DEFAULT_STATE_ORDER_SQL}
        limit 1`,
      [teamId],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new ConflictError(`Team ${teamId} has no workflow states`);
    }
    return mapStateRow(row);
  }

  /* ----------------------------------------------------------- helpers -- */

  async #require(t: SqlExecutor, id: TeamId): Promise<Team> {
    const team = await this.byId(id, t);
    if (team === null) throw new NotFoundError("Team", id);
    return team;
  }

  /**
   * A free key near the one asked for.
   *
   * `ENG` → `ENG2` → `ENG3`. Suffixing rather than rejecting because this runs
   * during team creation, where the key was *derived* from the name and the
   * user never chose it — failing a creation because two teams start with the
   * same three letters would be an error message about something nobody typed.
   * An explicitly supplied key that collides is caught by `update` instead.
   */
  async #uniqueKey(
    t: SqlExecutor,
    workspaceId: WorkspaceId,
    base: string,
  ): Promise<string> {
    const trimmed = (TEAM_KEY_PATTERN.test(base) ? base : "TEAM").slice(0, 5);
    for (let suffix = 0; suffix < 100; suffix += 1) {
      const candidate =
        suffix === 0
          ? trimmed
          : `${trimmed.slice(0, 5 - String(suffix + 1).length)}${suffix + 1}`;
      const rows = await t.query(
        `select 1 from teams where workspace_id = $1 and lower(key) = lower($2)`,
        [workspaceId, candidate],
      );
      if (rows.length === 0) return candidate;
    }
    throw new ConflictError(`No team key available near "${base}"`);
  }

  async #nextStatePosition(
    t: SqlExecutor,
    teamId: TeamId,
    type: StateType,
  ): Promise<number> {
    const rows = await t.query(
      `select coalesce(max(position), -1) as last from workflow_states
        where team_id = $1 and type = $2`,
      [teamId, type],
    );
    const row = rows[0];
    return (row === undefined ? -1 : num(row, "last")) + 1;
  }
}
