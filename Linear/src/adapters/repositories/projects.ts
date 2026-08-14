import "server-only";

/**
 * Projects, their teams, members, milestones and status updates.
 *
 * ## Health is written, never derived
 *
 * `state` is where the work is; `health` is the lead's weekly judgement. Linear
 * keeps them separate and computes neither from the issue list
 * (`research/03-data-model.md` §1.7), which is why {@link
 * SqlProjectRepository.postUpdate} is the only thing that writes `health` — an
 * "at risk" project whose issues all close should stay at risk until somebody
 * says otherwise, because the risk was never about the issue count.
 *
 * ## Progress is computed, never stored
 *
 * The opposite call, for the opposite reason. Linear pre-materialises burn-up
 * series because their sync engine ships whole models to clients; here a
 * `count` and a `sum` over an indexed `project_id` is cheaper than any column
 * that has to be kept true (`research/03-data-model.md` §6, deviation 14).
 *
 * ## Project membership grants permission here, unlike in Linear
 *
 * A deliberate divergence, stated in `entities.ts` and SPEC §4: the brief
 * requires that people added to a project can add to and edit it. This
 * repository only stores the membership — the grant itself is in the
 * authorization policy — but `listForUser` implements the visible half, which
 * is that a guest sees the projects they were added to and nothing else.
 */

import type { SqlExecutor, SqlRow } from "@/adapters/db/driver";
import type {
  MilestoneId,
  Project,
  ProjectHealth,
  ProjectId,
  ProjectMember,
  ProjectMilestone,
  ProjectRole,
  ProjectState,
  ProjectUpdate,
  TeamId,
  UserId,
  WorkspaceId,
} from "@/domain/entities";
import { keyBetween } from "@/domain/ordering";
import { newId, projectSlug } from "@/lib/ids";
import {
  type CreateProjectInput,
  NotFoundError,
  type Patch,
  type ProjectMemberWithUser,
  type ProjectProgress,
  type ProjectRepository,
  type Tx,
} from "@/ports/repositories";

import { appendChangeEvent } from "./changefeed";
import {
  BaseRepository,
  mapUserRow,
  nullableNum,
  nullableText,
  nullableTimestamp,
  num,
  Params,
  text,
  timestamp,
} from "./shared";

const PROJECT_COLUMNS = `id, workspace_id, name, slug_id, description, summary,
  icon, color, state, health, lead_id, start_date::text as start_date,
  target_date::text as target_date, sort_order, created_at, updated_at,
  completed_at, canceled_at, archived_at`;

export function mapProjectRow(row: SqlRow): Project {
  return {
    id: text(row, "id"),
    workspaceId: text(row, "workspace_id"),
    name: text(row, "name"),
    slugId: text(row, "slug_id"),
    description: text(row, "description"),
    summary: text(row, "summary"),
    icon: text(row, "icon"),
    color: text(row, "color"),
    state: text(row, "state") as ProjectState,
    health: nullableText(row, "health") as ProjectHealth | null,
    leadId: nullableText(row, "lead_id"),
    startDate: nullableText(row, "start_date"),
    targetDate: nullableText(row, "target_date"),
    sortOrder: text(row, "sort_order"),
    createdAt: timestamp(row["created_at"]),
    updatedAt: timestamp(row["updated_at"]),
    completedAt: nullableTimestamp(row["completed_at"]),
    canceledAt: nullableTimestamp(row["canceled_at"]),
    archivedAt: nullableTimestamp(row["archived_at"]),
  };
}

function mapMilestoneRow(row: SqlRow): ProjectMilestone {
  return {
    id: text(row, "id"),
    projectId: text(row, "project_id"),
    name: text(row, "name"),
    description: nullableText(row, "description"),
    targetDate: nullableText(row, "target_date"),
    sortOrder: text(row, "sort_order"),
    createdAt: timestamp(row["created_at"]),
  };
}

function mapUpdateRow(row: SqlRow): ProjectUpdate {
  return {
    id: text(row, "id"),
    projectId: text(row, "project_id"),
    userId: text(row, "user_id"),
    body: text(row, "body"),
    health: text(row, "health") as ProjectHealth,
    createdAt: timestamp(row["created_at"]),
  };
}

export class SqlProjectRepository
  extends BaseRepository
  implements ProjectRepository
{
  async create(
    input: CreateProjectInput,
    actorId: UserId,
    tx?: Tx,
  ): Promise<Project> {
    return this.atomically(tx, async (t) => {
      const id = input.id ?? newId("prj");
      const now = this.now();
      const slugId = input.slugId ?? projectSlug(input.name);
      const sortOrder = input.sortOrder ?? (await this.#topSortOrder(t, input.workspaceId));
      const state = input.state ?? "backlog";

      await t.execute(
        `insert into projects (id, workspace_id, name, slug_id, description,
                               summary, icon, color, state, health, lead_id,
                               start_date, target_date, sort_order,
                               created_at, updated_at, completed_at, canceled_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16,$17)`,
        [
          id,
          input.workspaceId,
          input.name,
          slugId,
          input.description ?? "",
          input.summary ?? "",
          input.icon ?? "Cube",
          input.color ?? "#5e6ad2",
          state,
          input.health ?? null,
          input.leadId ?? null,
          input.startDate ?? null,
          input.targetDate ?? null,
          sortOrder,
          now,
          state === "completed" ? now : null,
          state === "canceled" ? now : null,
        ],
      );

      for (const teamId of input.teamIds ?? []) {
        await t.execute(
          `insert into project_teams (project_id, team_id) values ($1,$2)
           on conflict do nothing`,
          [id, teamId],
        );
      }
      // The lead is a member. Otherwise the person accountable for a project is
      // absent from its member list, and — given that membership grants edit
      // here — cannot edit it.
      const members = new Set<string>([
        ...(input.leadId === undefined || input.leadId === null ? [] : [input.leadId]),
        ...(input.memberIds ?? []),
      ]);
      for (const userId of members) {
        await t.execute(
          `insert into project_members (project_id, user_id, role, joined_at)
           values ($1,$2,$3,$4) on conflict do nothing`,
          [id, userId, userId === input.leadId ? "lead" : "member", now],
        );
      }

      await appendChangeEvent(t, {
        workspaceId: input.workspaceId,
        entity: "project",
        entityId: id,
        action: "create",
        actorId,
        payload: { name: input.name, slugId },
      });
      return this.#require(t, id);
    });
  }

  async byId(id: ProjectId, tx?: Tx): Promise<Project | null> {
    const rows = await this.reader(tx).query(
      `select ${PROJECT_COLUMNS} from projects where id = $1`,
      [id],
    );
    const row = rows[0];
    return row === undefined ? null : mapProjectRow(row);
  }

  async bySlug(
    workspaceId: WorkspaceId,
    slugId: string,
    tx?: Tx,
  ): Promise<Project | null> {
    const rows = await this.reader(tx).query(
      `select ${PROJECT_COLUMNS} from projects
        where workspace_id = $1 and slug_id = $2`,
      [workspaceId, slugId],
    );
    const row = rows[0];
    return row === undefined ? null : mapProjectRow(row);
  }

  async listForWorkspace(workspaceId: WorkspaceId, tx?: Tx): Promise<Project[]> {
    const rows = await this.reader(tx).query(
      `select ${PROJECT_COLUMNS} from projects
        where workspace_id = $1 and archived_at is null
        order by sort_order asc, id asc`,
      [workspaceId],
    );
    return rows.map(mapProjectRow);
  }

  async listForUser(
    workspaceId: WorkspaceId,
    userId: UserId,
    tx?: Tx,
  ): Promise<Project[]> {
    // A guest sees only what they were added to — the same shape as
    // `teams.listForUser`, and for the same reason: discoverability is decided
    // in the `where` clause, never by filtering a fetched list.
    const rows = await this.reader(tx).query(
      `select ${PROJECT_COLUMNS} from projects p
        where p.workspace_id = $1 and p.archived_at is null
          and (
            exists (select 1 from project_members pm
                     where pm.project_id = p.id and pm.user_id = $2)
            or exists (select 1 from workspace_members wm
                        where wm.workspace_id = $1 and wm.user_id = $2
                          and wm.role <> 'guest')
          )
        order by p.sort_order asc, p.id asc`,
      [workspaceId, userId],
    );
    return rows.map(mapProjectRow);
  }

  async update(
    id: ProjectId,
    patch: Patch<
      Pick<
        Project,
        | "name"
        | "description"
        | "summary"
        | "icon"
        | "color"
        | "state"
        | "health"
        | "leadId"
        | "startDate"
        | "targetDate"
        | "sortOrder"
      >
    >,
    actorId: UserId,
    tx?: Tx,
  ): Promise<Project> {
    return this.atomically(tx, async (t) => {
      const before = await this.#require(t, id);
      const params = new Params();
      const sets: string[] = [];
      const fields: string[] = [];

      const set = (column: string, field: string, value: string | number | null) => {
        sets.push(`${column} = ${params.bind(value)}`);
        fields.push(field);
      };

      if (patch.name !== undefined && patch.name !== before.name) {
        set("name", "name", patch.name);
      }
      if (patch.description !== undefined && patch.description !== before.description) {
        set("description", "description", patch.description);
      }
      if (patch.summary !== undefined && patch.summary !== before.summary) {
        set("summary", "summary", patch.summary);
      }
      if (patch.icon !== undefined && patch.icon !== before.icon) {
        set("icon", "icon", patch.icon);
      }
      if (patch.color !== undefined && patch.color !== before.color) {
        set("color", "color", patch.color);
      }
      if (patch.leadId !== undefined && patch.leadId !== before.leadId) {
        set("lead_id", "leadId", patch.leadId);
      }
      if (patch.startDate !== undefined && patch.startDate !== before.startDate) {
        set("start_date", "startDate", patch.startDate);
      }
      if (patch.targetDate !== undefined && patch.targetDate !== before.targetDate) {
        set("target_date", "targetDate", patch.targetDate);
      }
      if (patch.health !== undefined && patch.health !== before.health) {
        set("health", "health", patch.health);
      }
      if (patch.sortOrder !== undefined && patch.sortOrder !== before.sortOrder) {
        set("sort_order", "sortOrder", patch.sortOrder);
      }
      if (patch.state !== undefined && patch.state !== before.state) {
        set("state", "state", patch.state);
        // The same entering/leaving rule the issues use, one level up: a
        // project moved out of completed stops being completed.
        const now = this.now();
        set(
          "completed_at",
          "completedAt",
          patch.state === "completed"
            ? (before.completedAt ?? now)
            : null,
        );
        set(
          "canceled_at",
          "canceledAt",
          patch.state === "canceled" ? (before.canceledAt ?? now) : null,
        );
      }

      if (sets.length === 0) return before;

      sets.push(`updated_at = ${params.bind(this.now())}`);
      await t.execute(
        `update projects set ${sets.join(", ")} where id = ${params.bind(id)}`,
        params.values,
      );
      await appendChangeEvent(t, {
        workspaceId: before.workspaceId,
        entity: "project",
        entityId: id,
        action: "update",
        actorId,
        payload: { fields },
      });
      return this.#require(t, id);
    });
  }

  async archive(id: ProjectId, actorId: UserId, tx?: Tx): Promise<Project> {
    return this.atomically(tx, async (t) => {
      const before = await this.#require(t, id);
      const now = this.now();
      await t.execute(
        `update projects set archived_at = $2, updated_at = $2 where id = $1`,
        [id, now],
      );
      await appendChangeEvent(t, {
        workspaceId: before.workspaceId,
        entity: "project",
        entityId: id,
        action: "update",
        actorId,
        payload: { fields: ["archivedAt"] },
      });
      return this.#require(t, id);
    });
  }

  async delete(id: ProjectId, actorId: UserId, tx?: Tx): Promise<void> {
    await this.atomically(tx, async (t) => {
      const before = await this.#require(t, id);
      // `issues.project_id` is `on delete set null`, so deleting a project
      // releases its issues rather than deleting them. Milestones and updates
      // cascade, because neither means anything without the project.
      await t.execute(`delete from projects where id = $1`, [id]);
      await appendChangeEvent(t, {
        workspaceId: before.workspaceId,
        entity: "project",
        entityId: id,
        action: "delete",
        actorId,
        payload: { name: before.name },
      });
    });
  }

  async progress(id: ProjectId, tx?: Tx): Promise<ProjectProgress> {
    const rows = await this.reader(tx).query(
      `select count(*) as total,
              count(*) filter (where s.type = 'completed') as completed,
              count(*) filter (where s.type = 'canceled') as canceled,
              count(*) filter (where s.type = 'started') as started,
              sum(i.estimate) as scope,
              sum(i.estimate) filter (where s.type = 'completed') as completed_scope
         from issues i join workflow_states s on s.id = i.state_id
        where i.project_id = $1 and i.trashed_at is null and i.archived_at is null`,
      [id],
    );
    const row = rows[0];
    if (row === undefined) {
      return {
        total: 0,
        completed: 0,
        canceled: 0,
        started: 0,
        scope: null,
        completedScope: null,
      };
    }
    return {
      total: num(row, "total"),
      completed: num(row, "completed"),
      canceled: num(row, "canceled"),
      started: num(row, "started"),
      // Null rather than zero when nothing is estimated: "no scope" and "a
      // scope of zero points" render differently, and `sum()` over no rows is
      // null, which is the honest answer.
      scope: nullableNum(row, "scope"),
      completedScope: nullableNum(row, "completed_scope"),
    };
  }

  /* ----------------------------------------------------------- members -- */

  async listMembers(id: ProjectId, tx?: Tx): Promise<ProjectMemberWithUser[]> {
    const rows = await this.reader(tx).query(
      `select pm.project_id, pm.user_id, pm.role, pm.joined_at,
              u.id, u.email, u.name, u.display_name, u.avatar_url,
              u.avatar_color, u.created_at, u.active
         from project_members pm join users u on u.id = pm.user_id
        where pm.project_id = $1
        order by case pm.role when 'lead' then 0 else 1 end, u.name asc`,
      [id],
    );
    return rows.map((row) => ({
      projectId: text(row, "project_id"),
      userId: text(row, "user_id"),
      role: text(row, "role") as ProjectRole,
      joinedAt: timestamp(row["joined_at"]),
      user: mapUserRow(row),
    }));
  }

  async addMember(
    projectId: ProjectId,
    userId: UserId,
    role: ProjectRole,
    actorId: UserId,
    tx?: Tx,
  ): Promise<ProjectMember> {
    return this.atomically(tx, async (t) => {
      const project = await this.#require(t, projectId);
      const now = this.now();
      await t.execute(
        `insert into project_members (project_id, user_id, role, joined_at)
         values ($1,$2,$3,$4)
         on conflict (project_id, user_id) do update set role = excluded.role`,
        [projectId, userId, role, now],
      );
      if (role === "lead") {
        await t.execute(`update projects set lead_id = $2 where id = $1`, [
          projectId,
          userId,
        ]);
      }
      await appendChangeEvent(t, {
        workspaceId: project.workspaceId,
        entity: "projectMember",
        entityId: `${projectId}:${userId}`,
        action: "create",
        actorId,
        payload: { projectId, userId, role },
      });
      return { projectId, userId, role, joinedAt: timestamp(now) };
    });
  }

  async removeMember(
    projectId: ProjectId,
    userId: UserId,
    actorId: UserId,
    tx?: Tx,
  ): Promise<void> {
    await this.atomically(tx, async (t) => {
      const project = await this.#require(t, projectId);
      await t.execute(
        `delete from project_members where project_id = $1 and user_id = $2`,
        [projectId, userId],
      );
      if (project.leadId === userId) {
        await t.execute(`update projects set lead_id = null where id = $1`, [
          projectId,
        ]);
      }
      await appendChangeEvent(t, {
        workspaceId: project.workspaceId,
        entity: "projectMember",
        entityId: `${projectId}:${userId}`,
        action: "delete",
        actorId,
        payload: { projectId, userId },
      });
    });
  }

  /* ------------------------------------------------------------- teams -- */

  async listTeams(id: ProjectId, tx?: Tx): Promise<TeamId[]> {
    const rows = await this.reader(tx).query(
      `select pt.team_id from project_teams pt
         join teams t on t.id = pt.team_id
        where pt.project_id = $1
        order by t.key asc`,
      [id],
    );
    return rows.map((row) => text(row, "team_id"));
  }

  async addTeam(
    projectId: ProjectId,
    teamId: TeamId,
    actorId: UserId,
    tx?: Tx,
  ): Promise<void> {
    await this.atomically(tx, async (t) => {
      const project = await this.#require(t, projectId);
      await t.execute(
        `insert into project_teams (project_id, team_id) values ($1,$2)
         on conflict do nothing`,
        [projectId, teamId],
      );
      await appendChangeEvent(t, {
        workspaceId: project.workspaceId,
        entity: "project",
        entityId: projectId,
        action: "update",
        actorId,
        payload: { fields: ["teams"], added: [teamId] },
      });
    });
  }

  async removeTeam(
    projectId: ProjectId,
    teamId: TeamId,
    actorId: UserId,
    tx?: Tx,
  ): Promise<void> {
    await this.atomically(tx, async (t) => {
      const project = await this.#require(t, projectId);
      await t.execute(
        `delete from project_teams where project_id = $1 and team_id = $2`,
        [projectId, teamId],
      );
      await appendChangeEvent(t, {
        workspaceId: project.workspaceId,
        entity: "project",
        entityId: projectId,
        action: "update",
        actorId,
        payload: { fields: ["teams"], removed: [teamId] },
      });
    });
  }

  /* -------------------------------------------------------- milestones -- */

  async listMilestones(
    projectId: ProjectId,
    tx?: Tx,
  ): Promise<ProjectMilestone[]> {
    const rows = await this.reader(tx).query(
      `select id, project_id, name, description, target_date::text as target_date,
              sort_order, created_at
         from project_milestones
        where project_id = $1
        order by sort_order asc, id asc`,
      [projectId],
    );
    return rows.map(mapMilestoneRow);
  }

  async createMilestone(
    input: {
      id?: MilestoneId;
      projectId: ProjectId;
      name: string;
      description?: string | null;
      targetDate?: string | null;
      sortOrder?: string;
    },
    actorId: UserId,
    tx?: Tx,
  ): Promise<ProjectMilestone> {
    return this.atomically(tx, async (t) => {
      const id = input.id ?? newId("mil");
      const now = this.now();
      const bottom = await t.query(
        `select max(sort_order) as bottom from project_milestones where project_id = $1`,
        [input.projectId],
      );
      const bottomRow = bottom[0];
      const sortOrder =
        input.sortOrder ??
        keyBetween(
          bottomRow === undefined ? null : nullableText(bottomRow, "bottom"),
          null,
        );

      await t.execute(
        `insert into project_milestones (id, project_id, name, description,
                                         target_date, sort_order, created_at)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          id,
          input.projectId,
          input.name,
          input.description ?? null,
          input.targetDate ?? null,
          sortOrder,
          now,
        ],
      );
      const project = await this.#require(t, input.projectId);
      await appendChangeEvent(t, {
        workspaceId: project.workspaceId,
        entity: "milestone",
        entityId: id,
        action: "create",
        actorId,
        payload: { projectId: input.projectId, name: input.name },
      });
      return this.#requireMilestone(t, id);
    });
  }

  async updateMilestone(
    id: MilestoneId,
    patch: Patch<
      Pick<ProjectMilestone, "name" | "description" | "targetDate" | "sortOrder">
    >,
    actorId: UserId,
    tx?: Tx,
  ): Promise<ProjectMilestone> {
    return this.atomically(tx, async (t) => {
      const before = await this.#requireMilestone(t, id);
      const params = new Params();
      const sets: string[] = [];
      if (patch.name !== undefined) sets.push(`name = ${params.bind(patch.name)}`);
      if (patch.description !== undefined) {
        sets.push(`description = ${params.bind(patch.description)}`);
      }
      if (patch.targetDate !== undefined) {
        sets.push(`target_date = ${params.bind(patch.targetDate)}`);
      }
      if (patch.sortOrder !== undefined) {
        sets.push(`sort_order = ${params.bind(patch.sortOrder)}`);
      }
      if (sets.length > 0) {
        await t.execute(
          `update project_milestones set ${sets.join(", ")}
            where id = ${params.bind(id)}`,
          params.values,
        );
      }
      const project = await this.#require(t, before.projectId);
      await appendChangeEvent(t, {
        workspaceId: project.workspaceId,
        entity: "milestone",
        entityId: id,
        action: "update",
        actorId,
        payload: { projectId: before.projectId },
      });
      return this.#requireMilestone(t, id);
    });
  }

  async deleteMilestone(
    id: MilestoneId,
    actorId: UserId,
    tx?: Tx,
  ): Promise<void> {
    await this.atomically(tx, async (t) => {
      const before = await this.#requireMilestone(t, id);
      const project = await this.#require(t, before.projectId);
      // `issues.milestone_id` is `on delete set null`, so the issues stay in
      // the project and lose only the milestone.
      await t.execute(`delete from project_milestones where id = $1`, [id]);
      await appendChangeEvent(t, {
        workspaceId: project.workspaceId,
        entity: "milestone",
        entityId: id,
        action: "delete",
        actorId,
        payload: { projectId: before.projectId },
      });
    });
  }

  /* ----------------------------------------------------------- updates -- */

  async listUpdates(projectId: ProjectId, tx?: Tx): Promise<ProjectUpdate[]> {
    const rows = await this.reader(tx).query(
      `select id, project_id, user_id, body, health, created_at
         from project_updates
        where project_id = $1
        order by created_at desc, id desc`,
      [projectId],
    );
    return rows.map(mapUpdateRow);
  }

  async postUpdate(
    input: {
      id?: ProjectUpdate["id"];
      projectId: ProjectId;
      userId: UserId;
      body: string;
      health: ProjectHealth;
    },
    tx?: Tx,
  ): Promise<ProjectUpdate> {
    return this.atomically(tx, async (t) => {
      const id = input.id ?? newId("upd");
      const now = this.now();
      await t.execute(
        `insert into project_updates (id, project_id, user_id, body, health, created_at)
         values ($1,$2,$3,$4,$5,$6)`,
        [id, input.projectId, input.userId, input.body, input.health, now],
      );
      // Posting an update *is* how health changes. Writing both here keeps the
      // project row and its latest update from disagreeing about the same fact.
      await t.execute(
        `update projects set health = $2, updated_at = $3 where id = $1`,
        [input.projectId, input.health, now],
      );
      const project = await this.#require(t, input.projectId);
      await appendChangeEvent(t, {
        workspaceId: project.workspaceId,
        entity: "projectUpdate",
        entityId: id,
        action: "create",
        actorId: input.userId,
        payload: { projectId: input.projectId, health: input.health },
      });
      return {
        id,
        projectId: input.projectId,
        userId: input.userId,
        body: input.body,
        health: input.health,
        createdAt: timestamp(now),
      };
    });
  }

  /* ----------------------------------------------------------- helpers -- */

  async #require(t: SqlExecutor, id: ProjectId): Promise<Project> {
    const project = await this.byId(id, t);
    if (project === null) throw new NotFoundError("Project", id);
    return project;
  }

  async #requireMilestone(
    t: SqlExecutor,
    id: MilestoneId,
  ): Promise<ProjectMilestone> {
    const rows = await t.query(
      `select id, project_id, name, description, target_date::text as target_date,
              sort_order, created_at
         from project_milestones where id = $1`,
      [id],
    );
    const row = rows[0];
    if (row === undefined) throw new NotFoundError("ProjectMilestone", id);
    return mapMilestoneRow(row);
  }

  async #topSortOrder(t: SqlExecutor, workspaceId: WorkspaceId): Promise<string> {
    const rows = await t.query(
      `select min(sort_order) as top from projects where workspace_id = $1`,
      [workspaceId],
    );
    const row = rows[0];
    return keyBetween(null, row === undefined ? null : nullableText(row, "top"));
  }
}
