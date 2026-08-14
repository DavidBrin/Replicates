import "server-only";

/**
 * Membership changes — the half of authorization that a table cannot express.
 *
 * `domain/policy.ts` answers "may this role do this?". Everything here answers
 * questions the matrix structurally cannot, because the answer depends on a
 * *count* that has to be true at the moment of the write: is this the last
 * owner, is this the last team admin, does this demotion leave an escalated
 * principal behind. Those are transitions, not permissions.
 *
 * ## Why this module does I/O and the rest of `domain/` does not
 *
 * It has to. The invariant "a workspace always has an owner" is not a property
 * of a request; it is a property of the table at commit time, and the only
 * place both facts exist at once is inside a transaction. `schema.sql` says the
 * same thing from the other side: a partial unique index can require *at most*
 * one of a thing, never *at least* one, so the rule cannot be a constraint.
 *
 * ## The bug this file is shaped around
 *
 * Two admins demote the two remaining owners at the same time. Both read
 * `count = 2`, both pass the check, both write, and the workspace ends with
 * zero owners and nobody who can fix it. The check must therefore be
 * *serialized on the parent row*: `select id from workspaces where id = $1 for
 * update` before counting, inside the same transaction as the write. This is
 * Vikunja's `lockPositionsForViewUpdate` pattern applied to membership
 * (`research/05-oss-architecture.md` §2.3, R4).
 *
 * That lock is necessary and, on the local engine, not sufficient — see
 * {@link withWorkspaceLock}.
 */

import {
  getDb,
  type SqlDatabase,
  type SqlExecutor,
  type SqlRow,
} from "@/adapters/db";

import {
  WORKSPACE_ROLE_RANK,
  type ProjectId,
  type ProjectRole,
  type TeamId,
  type TeamRole,
  type UserId,
  type WorkspaceId,
  type WorkspaceRole,
} from "../entities";
import {
  allowed,
  can,
  checkProjectRoleChange,
  checkTeamRemoval,
  checkTeamRoleChange,
  checkWorkspaceRemoval,
  checkWorkspaceRoleChange,
  demotesContainerRoles,
  denied,
  teamAddAction,
  type Action,
  type Actor,
  type Authorized,
  type WorkspacePolicySettings,
} from "../policy";

/* ================================================================ locks == */

/**
 * Serialize the process's locking transactions per database handle.
 *
 * The SQL lock below is what makes this correct on Neon, where two requests are
 * two connections and Postgres arbitrates between them. It cannot be what makes
 * it correct on PGlite: PGlite is a *single connection*, so two overlapping
 * `begin` calls do not queue — they land in one physical transaction, both
 * halves read the same snapshot, `for update` locks a row against nobody, and
 * both demotions commit. The engine that the whole test suite runs against is
 * precisely the engine where the row lock proves nothing.
 *
 * So there are two layers, and each covers the other's blind spot:
 *
 *  - this queue makes overlapping calls in *one process* strictly sequential,
 *    which is the only concurrency PGlite can have at all;
 *  - `select … for update` makes overlapping calls in *different* processes
 *    sequential, which is the only concurrency a deployment has.
 *
 * Neither alone is enough, and the queue is not test scaffolding: without it
 * this file is wrong against its own default database. It is the same shape as
 * the `collate "C"` note in `schema.sql` — a correctness measure whose failure
 * mode cannot reproduce locally — and it is written down for the same reason.
 *
 * **The queue is not reentrant.** Calling one of the `with*Lock` helpers from
 * inside another one's callback waits for a turn that cannot come until the
 * caller returns, which is a deadlock rather than a slow request. Everything
 * inside a callback therefore takes the `tx` it was handed and calls plain
 * query helpers, never another locking service.
 */
const queues = new WeakMap<SqlDatabase, Promise<unknown>>();

function serialize<T>(db: SqlDatabase, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(db) ?? Promise.resolve();
  // `.then(work, work)` rather than `.finally`: a failed predecessor must not
  // poison the queue, and its rejection is already owned by its own caller.
  const next = previous.then(work, work);
  queues.set(
    db,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/**
 * Run `fn` with the workspace row locked, having first taken the process queue.
 *
 * Returns `NOT_FOUND` rather than throwing when the workspace is gone, so a
 * deleted workspace and a forbidden one leave through the same door and the API
 * does not become an existence oracle.
 */
export async function withWorkspaceLock<T>(
  db: SqlDatabase,
  workspaceId: WorkspaceId,
  fn: (tx: SqlExecutor) => Promise<Authorized<T>>,
): Promise<Authorized<T>> {
  return serialize(db, () =>
    db.transaction(async (tx) => {
      const locked = await tx.query("select id from workspaces where id = $1 for update", [
        workspaceId,
      ]);
      if (locked.length === 0) {
        return denied<T>({ code: "NOT_FOUND", what: "workspace" });
      }
      return fn(tx);
    }),
  );
}

/** R5's counterpart: the same mechanic, scoped to one team. */
async function withTeamLock<T>(
  db: SqlDatabase,
  teamId: TeamId,
  fn: (tx: SqlExecutor, team: TeamRow) => Promise<Authorized<T>>,
): Promise<Authorized<T>> {
  return serialize(db, () =>
    db.transaction(async (tx) => {
      const rows = await tx.query<TeamRow>(
        "select id, workspace_id, private from teams where id = $1 for update",
        [teamId],
      );
      const team = rows[0];
      if (!team) return denied<T>({ code: "NOT_FOUND", what: "team" });
      return fn(tx, team);
    }),
  );
}

async function withProjectLock<T>(
  db: SqlDatabase,
  projectId: ProjectId,
  fn: (tx: SqlExecutor, project: ProjectRow) => Promise<Authorized<T>>,
): Promise<Authorized<T>> {
  return serialize(db, () =>
    db.transaction(async (tx) => {
      const rows = await tx.query<ProjectRow>(
        "select id, workspace_id from projects where id = $1 for update",
        [projectId],
      );
      const project = rows[0];
      if (!project) return denied<T>({ code: "NOT_FOUND", what: "project" });
      return fn(tx, project);
    }),
  );
}

/* ================================================================= reads = */

interface TeamRow extends SqlRow {
  readonly id: TeamId;
  readonly workspace_id: WorkspaceId;
  readonly private: boolean;
}

interface ProjectRow extends SqlRow {
  readonly id: ProjectId;
  readonly workspace_id: WorkspaceId;
}

interface MembershipRow extends SqlRow {
  readonly role: WorkspaceRole;
  readonly active: boolean;
}

/**
 * The actor's standing in one workspace, as `can()` wants it.
 *
 * Every team and project role is loaded, not just the ones for the resource at
 * hand: a request usually asks several questions, and one round trip that
 * returns twenty rows beats twenty that return one. `active = false` on the
 * user row is this schema's suspension (R9) — there is no separate membership
 * status column, and inventing one here would put the authorization model out
 * of step with the table it reads.
 */
export async function loadActor(
  executor: SqlExecutor,
  workspaceId: WorkspaceId,
  userId: UserId,
  settings?: WorkspacePolicySettings,
): Promise<Actor> {
  const memberships = await executor.query<MembershipRow>(
    `select wm.role, u.active
       from workspace_members wm
       join users u on u.id = wm.user_id
      where wm.workspace_id = $1 and wm.user_id = $2`,
    [workspaceId, userId],
  );
  const membership = memberships[0];
  if (!membership) return { userId, workspaceRole: null };

  const [teamRows, projectRows] = await Promise.all([
    executor.query<{ team_id: TeamId; role: TeamRole }>(
      `select tm.team_id, tm.role
         from team_members tm
         join teams t on t.id = tm.team_id
        where t.workspace_id = $1 and tm.user_id = $2`,
      [workspaceId, userId],
    ),
    executor.query<{ project_id: ProjectId; role: ProjectRole }>(
      `select pm.project_id, pm.role
         from project_members pm
         join projects p on p.id = pm.project_id
        where p.workspace_id = $1 and pm.user_id = $2`,
      [workspaceId, userId],
    ),
  ]);

  const teamRoles: Record<TeamId, TeamRole> = {};
  for (const row of teamRows) teamRoles[row.team_id] = row.role;
  const projectRoles: Record<ProjectId, ProjectRole> = {};
  for (const row of projectRows) projectRoles[row.project_id] = row.role;

  return {
    userId,
    workspaceRole: membership.role,
    suspended: !membership.active,
    teamRoles,
    projectRoles,
    settings,
  };
}

async function workspaceRoleOf(
  executor: SqlExecutor,
  workspaceId: WorkspaceId,
  userId: UserId,
): Promise<MembershipRow | null> {
  const rows = await executor.query<MembershipRow>(
    `select wm.role, u.active
       from workspace_members wm
       join users u on u.id = wm.user_id
      where wm.workspace_id = $1 and wm.user_id = $2`,
    [workspaceId, userId],
  );
  return rows[0] ?? null;
}

/**
 * Owners who could actually sign in and use the privilege.
 *
 * Deactivated users are not owners for this purpose — counting them would let a
 * workspace be locked out by a suspension, which is R4's failure mode wearing a
 * different hat. Read under the lock or the number is a guess.
 */
async function activeOwnerCount(
  executor: SqlExecutor,
  workspaceId: WorkspaceId,
): Promise<number> {
  const rows = await executor.query<{ count: number }>(
    `select count(*)::int as count
       from workspace_members wm
       join users u on u.id = wm.user_id
      where wm.workspace_id = $1 and wm.role = 'owner' and u.active`,
    [workspaceId],
  );
  return Number(rows[0]?.count ?? 0);
}

async function teamAdminCount(
  executor: SqlExecutor,
  teamId: TeamId,
): Promise<number> {
  const rows = await executor.query<{ count: number }>(
    `select count(*)::int as count from team_members
      where team_id = $1 and role = 'admin'`,
    [teamId],
  );
  return Number(rows[0]?.count ?? 0);
}

/* ============================================== workspace membership ===== */

export interface WorkspaceRoleChange {
  readonly workspaceId: WorkspaceId;
  readonly actorId: UserId;
  readonly targetUserId: UserId;
  readonly nextRole: WorkspaceRole;
  readonly settings?: WorkspacePolicySettings;
}

/**
 * Promote or demote a workspace member.
 *
 * The actor's own role is re-read inside the transaction rather than taken from
 * the caller: a role handed in from a request was read before the lock, and the
 * whole point of the lock is that anything read before it may already be false.
 */
export async function changeWorkspaceMemberRole(
  input: WorkspaceRoleChange,
  db: SqlDatabase = getDb(),
): Promise<Authorized<{ readonly role: WorkspaceRole }>> {
  const { workspaceId, actorId, targetUserId, nextRole, settings } = input;

  return withWorkspaceLock<{ readonly role: WorkspaceRole }>(db, workspaceId, async (tx) => {
    const actor = await requireActor(tx, workspaceId, actorId, "member.change_role", settings);
    if (!actor.ok) return actor;

    const target = await workspaceRoleOf(tx, workspaceId, targetUserId);
    if (!target) return denied({ code: "NOT_FOUND", what: "member" });

    const decision = checkWorkspaceRoleChange(
      actor.value.workspaceRole,
      { currentRole: target.role, isSelf: targetUserId === actorId },
      nextRole,
      await activeOwnerCount(tx, workspaceId),
      settings,
    );
    if (!decision.ok) return decision;

    await tx.execute(
      "update workspace_members set role = $3 where workspace_id = $1 and user_id = $2",
      [workspaceId, targetUserId, nextRole],
    );

    // R7 — a demotion that leaves a team admin behind has not demoted anybody.
    if (demotesContainerRoles(nextRole)) {
      await stripContainerAdminRoles(tx, workspaceId, targetUserId);
    }

    return allowed({ role: nextRole });
  });
}

/**
 * Remove someone from a workspace, or leave it.
 *
 * One function, because R8's point is that the *rule* differs only in who the
 * target is. `member.leave` and `member.remove` are still separate matrix rows
 * and separate permission questions; what they share is the last-owner check,
 * and sharing it is what stops the two copies drifting.
 */
export async function removeWorkspaceMember(
  input: {
    readonly workspaceId: WorkspaceId;
    readonly actorId: UserId;
    readonly targetUserId: UserId;
    readonly settings?: WorkspacePolicySettings;
  },
  db: SqlDatabase = getDb(),
): Promise<Authorized<{ readonly removed: UserId }>> {
  const { workspaceId, actorId, targetUserId, settings } = input;
  const isSelf = targetUserId === actorId;

  return withWorkspaceLock<{ readonly removed: UserId }>(db, workspaceId, async (tx) => {
    const actor = await requireActor(
      tx,
      workspaceId,
      actorId,
      isSelf ? "member.leave" : "member.remove",
      settings,
    );
    if (!actor.ok) return actor;

    const target = await workspaceRoleOf(tx, workspaceId, targetUserId);
    if (!target) return denied({ code: "NOT_FOUND", what: "member" });

    const decision = checkWorkspaceRemoval(
      actor.value.workspaceRole,
      { currentRole: target.role, isSelf },
      await activeOwnerCount(tx, workspaceId),
    );
    if (!decision.ok) return decision;

    // R11 — the memberships go, the person and everything they wrote stay. The
    // author foreign key on issues and comments still points at a live user
    // row, so the activity feed keeps reading as prose.
    await tx.execute(
      `delete from team_members
        where user_id = $2
          and team_id in (select id from teams where workspace_id = $1)`,
      [workspaceId, targetUserId],
    );
    await tx.execute(
      `delete from project_members
        where user_id = $2
          and project_id in (select id from projects where workspace_id = $1)`,
      [workspaceId, targetUserId],
    );
    await tx.execute(
      "delete from workspace_members where workspace_id = $1 and user_id = $2",
      [workspaceId, targetUserId],
    );

    return allowed({ removed: targetUserId });
  });
}

/** R8 — leaving takes no target, so R2 never needs an "unless it's you" clause. */
export async function leaveWorkspace(
  input: { readonly workspaceId: WorkspaceId; readonly actorId: UserId },
  db: SqlDatabase = getDb(),
): Promise<Authorized<{ readonly removed: UserId }>> {
  return removeWorkspaceMember(
    { ...input, targetUserId: input.actorId },
    db,
  );
}

/**
 * Add someone to a workspace directly.
 *
 * The ordinary path is an invitation; this exists for the seed, for tests, and
 * for the case where an admin adds an account that already exists. R1 still
 * applies — an admin cannot conjure an owner.
 */
export async function addWorkspaceMember(
  input: {
    readonly workspaceId: WorkspaceId;
    readonly actorId: UserId;
    readonly userId: UserId;
    readonly role: WorkspaceRole;
    readonly settings?: WorkspacePolicySettings;
  },
  db: SqlDatabase = getDb(),
): Promise<Authorized<{ readonly added: boolean }>> {
  const { workspaceId, actorId, userId, role, settings } = input;

  return withWorkspaceLock<{ readonly added: boolean }>(db, workspaceId, async (tx) => {
    const actor = await requireActor(tx, workspaceId, actorId, "member.invite", settings);
    if (!actor.ok) return actor;

    if (WORKSPACE_ROLE_RANK[role] > WORKSPACE_ROLE_RANK[actor.value.workspaceRole]) {
      return denied({ code: "CANNOT_GRANT_ABOVE_OWN_RANK", requested: role });
    }

    const inserted = await tx.execute(
      `insert into workspace_members (workspace_id, user_id, role)
       values ($1, $2, $3)
       on conflict (workspace_id, user_id) do nothing`,
      [workspaceId, userId, role],
    );
    return allowed({ added: inserted > 0 });
  });
}

async function stripContainerAdminRoles(
  tx: SqlExecutor,
  workspaceId: WorkspaceId,
  userId: UserId,
): Promise<void> {
  await tx.execute(
    `update team_members set role = 'member'
      where user_id = $2 and role = 'admin'
        and team_id in (select id from teams where workspace_id = $1)`,
    [workspaceId, userId],
  );
  await tx.execute(
    `update project_members set role = 'member'
      where user_id = $2 and role = 'lead'
        and project_id in (select id from projects where workspace_id = $1)`,
    [workspaceId, userId],
  );
}

/* =================================================== team membership ===== */

export async function addTeamMember(
  input: {
    readonly teamId: TeamId;
    readonly actorId: UserId;
    readonly userId: UserId;
    readonly role: TeamRole;
    readonly settings?: WorkspacePolicySettings;
  },
  db: SqlDatabase = getDb(),
): Promise<Authorized<{ readonly added: boolean }>> {
  const { teamId, actorId, userId, role, settings } = input;

  return withTeamLock<{ readonly added: boolean }>(db, teamId, async (tx, team) => {
    const actor = await loadActor(tx, team.workspace_id, actorId, settings);
    const guard = precondition<{ readonly added: boolean }>(actor);
    if (guard) return guard;

    const target = await workspaceRoleOf(tx, team.workspace_id, userId);
    // Not "no such user": a project or team membership for someone who is not a
    // workspace principal is exactly the state §2.1 says cannot exist.
    if (!target) return denied({ code: "NOT_FOUND", what: "member" });

    const action = teamAddAction(target.role);
    if (!can(actor, action, { kind: "team", team: { id: teamId, private: team.private } })) {
      return denied({ code: "INSUFFICIENT_ROLE", action });
    }

    const decision = checkTeamRoleChange(
      teamId,
      {
        workspaceRole: actor.workspaceRole ?? "guest",
        teamRole: actor.teamRoles?.[teamId] ?? null,
      },
      { currentRole: null, workspaceRole: target.role, isSelf: userId === actorId },
      role,
      await teamAdminCount(tx, teamId),
    );
    if (!decision.ok) return decision;

    const inserted = await tx.execute(
      `insert into team_members (team_id, user_id, role) values ($1, $2, $3)
       on conflict (team_id, user_id) do nothing`,
      [teamId, userId, role],
    );
    return allowed({ added: inserted > 0 });
  });
}

export async function changeTeamMemberRole(
  input: {
    readonly teamId: TeamId;
    readonly actorId: UserId;
    readonly targetUserId: UserId;
    readonly nextRole: TeamRole;
    readonly settings?: WorkspacePolicySettings;
  },
  db: SqlDatabase = getDb(),
): Promise<Authorized<{ readonly role: TeamRole }>> {
  const { teamId, actorId, targetUserId, nextRole, settings } = input;

  return withTeamLock<{ readonly role: TeamRole }>(db, teamId, async (tx, team) => {
    const actor = await loadActor(tx, team.workspace_id, actorId, settings);
    const guard = precondition<{ readonly role: TeamRole }>(actor);
    if (guard) return guard;

    if (
      !can(actor, "team.change_member_role", {
        kind: "team",
        team: { id: teamId, private: team.private },
      })
    ) {
      return denied({ code: "INSUFFICIENT_ROLE", action: "team.change_member_role" });
    }

    const target = await teamRoleOf(tx, teamId, targetUserId);
    if (!target) return denied({ code: "NOT_FOUND", what: "member" });
    const targetWorkspace = await workspaceRoleOf(tx, team.workspace_id, targetUserId);
    if (!targetWorkspace) return denied({ code: "NOT_FOUND", what: "member" });

    const decision = checkTeamRoleChange(
      teamId,
      {
        workspaceRole: actor.workspaceRole ?? "guest",
        teamRole: actor.teamRoles?.[teamId] ?? null,
      },
      {
        currentRole: target,
        workspaceRole: targetWorkspace.role,
        isSelf: targetUserId === actorId,
      },
      nextRole,
      await teamAdminCount(tx, teamId),
    );
    if (!decision.ok) return decision;

    await tx.execute(
      "update team_members set role = $3 where team_id = $1 and user_id = $2",
      [teamId, targetUserId, nextRole],
    );
    return allowed({ role: nextRole });
  });
}

export async function removeTeamMember(
  input: {
    readonly teamId: TeamId;
    readonly actorId: UserId;
    readonly targetUserId: UserId;
    readonly settings?: WorkspacePolicySettings;
  },
  db: SqlDatabase = getDb(),
): Promise<Authorized<{ readonly removed: UserId }>> {
  const { teamId, actorId, targetUserId, settings } = input;
  const isSelf = targetUserId === actorId;

  return withTeamLock<{ readonly removed: UserId }>(db, teamId, async (tx, team) => {
    const actor = await loadActor(tx, team.workspace_id, actorId, settings);
    const guard = precondition<{ readonly removed: UserId }>(actor);
    if (guard) return guard;

    const resource = { kind: "team" as const, team: { id: teamId, private: team.private } };
    // Leaving is a different question from removing: everyone may leave (R8),
    // so a plain member's departure is not measured against `team.remove_member`.
    if (!isSelf && !can(actor, "team.remove_member", resource)) {
      return denied({ code: "INSUFFICIENT_ROLE", action: "team.remove_member" });
    }

    const current = await teamRoleOf(tx, teamId, targetUserId);
    if (!current) return denied({ code: "NOT_FOUND", what: "member" });

    const decision = checkTeamRemoval(
      teamId,
      {
        workspaceRole: actor.workspaceRole ?? "guest",
        teamRole: actor.teamRoles?.[teamId] ?? null,
      },
      { currentRole: current, isSelf },
      await teamAdminCount(tx, teamId),
    );
    if (!decision.ok) return decision;

    await tx.execute("delete from team_members where team_id = $1 and user_id = $2", [
      teamId,
      targetUserId,
    ]);
    return allowed({ removed: targetUserId });
  });
}

/** R8 — and leaving a private team is one-way; there is no self-join back in. */
export async function leaveTeam(
  input: { readonly teamId: TeamId; readonly actorId: UserId },
  db: SqlDatabase = getDb(),
): Promise<Authorized<{ readonly removed: UserId }>> {
  return removeTeamMember({ ...input, targetUserId: input.actorId }, db);
}

async function teamRoleOf(
  executor: SqlExecutor,
  teamId: TeamId,
  userId: UserId,
): Promise<TeamRole | null> {
  const rows = await executor.query<{ role: TeamRole }>(
    "select role from team_members where team_id = $1 and user_id = $2",
    [teamId, userId],
  );
  return rows[0]?.role ?? null;
}

/* ================================================ project membership ===== */

/**
 * Make the project's two records of its lead agree — the invariant this file
 * owns, for the same reason it owns the last-owner rule.
 *
 * A lead is stored twice. `project_members.role` is the *grant*: it is what
 * `loadActor` reads and what the permission matrix answers from.
 * `projects.lead_id` is the *denormalisation*: one nullable column, which is
 * what every project header, card and list renders. Neither is redundant — the
 * matrix cannot join a column and a list view cannot afford a per-row lookup —
 * but they can disagree, and a disagreement is not cosmetic: a header naming
 * somebody the matrix has never heard of, or a demoted lead who keeps editing.
 *
 * Two facts have to hold at commit time, which is why this runs inside the
 * caller's `withProjectLock` transaction rather than as a follow-up write:
 *
 *  1. **At most one lead.** The schema cannot say so — a partial unique index
 *     on `(project_id) where role = 'lead'` would be exactly the right
 *     constraint, and adding one is a migration this slice does not own — so
 *     the rule is enforced here, on the way past.
 *  2. **`lead_id` names that row, or nothing.** Recomputed from the membership
 *     rows rather than assumed, so a removal and a demotion clear the column
 *     without either caller having to remember.
 *
 * `targetUserId` is whoever's row the caller just wrote. If that write left
 * them holding the lead role then they are *the* lead and every other lead row
 * yields to them; the promotion is what breaks the tie, not the join date.
 * A removal passes the user who is now gone, whose `exists` clause is false, so
 * nothing is demoted and the column is simply recomputed.
 */
async function reconcileProjectLead(
  tx: SqlExecutor,
  projectId: ProjectId,
  targetUserId: UserId,
): Promise<void> {
  // One statement, so "is the target a lead" is answered by the same snapshot
  // that acts on the answer — and so the demotion cannot fire on a read that a
  // concurrent writer has already invalidated.
  await tx.execute(
    `update project_members set role = 'member'
      where project_id = $1
        and user_id <> $2
        and role = 'lead'
        and exists (select 1 from project_members pm
                     where pm.project_id = $1
                       and pm.user_id = $2
                       and pm.role = 'lead')`,
    [projectId, targetUserId],
  );

  const rows = await tx.query<{ user_id: UserId }>(
    `select user_id from project_members
      where project_id = $1 and role = 'lead'
      order by joined_at asc, user_id asc
      limit 1`,
    [projectId],
  );

  await tx.execute("update projects set lead_id = $2 where id = $1", [
    projectId,
    rows[0]?.user_id ?? null,
  ]);
}

export async function addProjectMember(
  input: {
    readonly projectId: ProjectId;
    readonly actorId: UserId;
    readonly userId: UserId;
    readonly role: ProjectRole;
    readonly settings?: WorkspacePolicySettings;
  },
  db: SqlDatabase = getDb(),
): Promise<Authorized<{ readonly added: boolean }>> {
  const { projectId, actorId, userId, role, settings } = input;

  return withProjectLock<{ readonly added: boolean }>(db, projectId, async (tx, project) => {
    const actor = await loadActor(tx, project.workspace_id, actorId, settings);
    const guard = precondition<{ readonly added: boolean }>(actor);
    if (guard) return guard;

    const resource = await projectResource(tx, project, projectId);
    if (!can(actor, "project.add_member", resource)) {
      return denied({ code: "INSUFFICIENT_ROLE", action: "project.add_member" });
    }

    const target = await workspaceRoleOf(tx, project.workspace_id, userId);
    if (!target) return denied({ code: "NOT_FOUND", what: "member" });

    const decision = checkProjectRoleChange(
      {
        workspaceRole: actor.workspaceRole ?? "guest",
        projectRole: actor.projectRoles?.[projectId] ?? null,
      },
      { workspaceRole: target.role },
      role,
    );
    if (!decision.ok) return decision;

    const inserted = await tx.execute(
      `insert into project_members (project_id, user_id, role) values ($1, $2, $3)
       on conflict (project_id, user_id) do nothing`,
      [projectId, userId, role],
    );
    await reconcileProjectLead(tx, projectId, userId);
    return allowed({ added: inserted > 0 });
  });
}

export async function changeProjectMemberRole(
  input: {
    readonly projectId: ProjectId;
    readonly actorId: UserId;
    readonly targetUserId: UserId;
    readonly nextRole: ProjectRole;
    readonly settings?: WorkspacePolicySettings;
  },
  db: SqlDatabase = getDb(),
): Promise<Authorized<{ readonly role: ProjectRole }>> {
  const { projectId, actorId, targetUserId, nextRole, settings } = input;

  return withProjectLock<{ readonly role: ProjectRole }>(db, projectId, async (tx, project) => {
    const actor = await loadActor(tx, project.workspace_id, actorId, settings);
    const guard = precondition<{ readonly role: ProjectRole }>(actor);
    if (guard) return guard;

    const resource = await projectResource(tx, project, projectId);
    if (!can(actor, "project.change_member_role", resource)) {
      return denied({ code: "INSUFFICIENT_ROLE", action: "project.change_member_role" });
    }

    const target = await workspaceRoleOf(tx, project.workspace_id, targetUserId);
    if (!target) return denied({ code: "NOT_FOUND", what: "member" });

    const decision = checkProjectRoleChange(
      {
        workspaceRole: actor.workspaceRole ?? "guest",
        projectRole: actor.projectRoles?.[projectId] ?? null,
      },
      { workspaceRole: target.role },
      nextRole,
    );
    if (!decision.ok) return decision;

    const updated = await tx.execute(
      "update project_members set role = $3 where project_id = $1 and user_id = $2",
      [projectId, targetUserId, nextRole],
    );
    if (updated === 0) return denied({ code: "NOT_FOUND", what: "member" });
    await reconcileProjectLead(tx, projectId, targetUserId);
    return allowed({ role: nextRole });
  });
}

export async function removeProjectMember(
  input: {
    readonly projectId: ProjectId;
    readonly actorId: UserId;
    readonly targetUserId: UserId;
    readonly settings?: WorkspacePolicySettings;
  },
  db: SqlDatabase = getDb(),
): Promise<Authorized<{ readonly removed: UserId }>> {
  const { projectId, actorId, targetUserId, settings } = input;
  const isSelf = targetUserId === actorId;

  return withProjectLock<{ readonly removed: UserId }>(db, projectId, async (tx, project) => {
    const actor = await loadActor(tx, project.workspace_id, actorId, settings);
    const guard = precondition<{ readonly removed: UserId }>(actor);
    if (guard) return guard;

    const resource = await projectResource(tx, project, projectId);
    // R8 — anyone may leave a project, always. There is no last-lead rule (R6),
    // so nothing can make a departure fail.
    if (!isSelf && !can(actor, "project.remove_member", resource)) {
      return denied({ code: "INSUFFICIENT_ROLE", action: "project.remove_member" });
    }

    const removed = await tx.execute(
      "delete from project_members where project_id = $1 and user_id = $2",
      [projectId, targetUserId],
    );
    if (removed === 0) return denied({ code: "NOT_FOUND", what: "member" });
    // The departing user holds no row now, so this demotes nobody — it clears
    // `lead_id` when the person who just left was the one it named.
    await reconcileProjectLead(tx, projectId, targetUserId);
    return allowed({ removed: targetUserId });
  });
}

export async function leaveProject(
  input: { readonly projectId: ProjectId; readonly actorId: UserId },
  db: SqlDatabase = getDb(),
): Promise<Authorized<{ readonly removed: UserId }>> {
  return removeProjectMember({ ...input, targetUserId: input.actorId }, db);
}

/**
 * Footnote 11's roll-up, computed rather than stored.
 *
 * A project is only fully public when every team attached to it is public, so
 * one private team hides it from workspace members who are not in that team.
 */
async function projectResource(
  tx: SqlExecutor,
  project: ProjectRow,
  projectId: ProjectId,
): Promise<{
  kind: "project";
  project: { id: ProjectId; allTeamsPublic: boolean };
}> {
  const rows = await tx.query<{ count: number }>(
    `select count(*)::int as count
       from project_teams pt
       join teams t on t.id = pt.team_id
      where pt.project_id = $1 and t.private`,
    [projectId],
  );
  return {
    kind: "project",
    project: { id: project.id, allTeamsPublic: Number(rows[0]?.count ?? 0) === 0 },
  };
}

/* =========================================================== preconditions */

/** The two facts no grant can rescue (§2.1). Returns a denial, or nothing. */
function precondition<T>(actor: Actor): Authorized<T> | null {
  if (actor.workspaceRole === null) return denied<T>({ code: "NOT_A_MEMBER" });
  if (actor.suspended === true) return denied<T>({ code: "MEMBERSHIP_SUSPENDED" });
  return null;
}

/**
 * Load the actor and check one workspace-scope action, keeping the workspace
 * role in the result so callers do not have to re-narrow `null` afterwards.
 */
async function requireActor(
  tx: SqlExecutor,
  workspaceId: WorkspaceId,
  actorId: UserId,
  action: Action,
  settings?: WorkspacePolicySettings,
): Promise<Authorized<{ readonly workspaceRole: WorkspaceRole }>> {
  const actor = await loadActor(tx, workspaceId, actorId, settings);
  const guard = precondition<{ workspaceRole: WorkspaceRole }>(actor);
  if (guard) return guard;
  if (!can(actor, action, { kind: "member" })) {
    return denied({ code: "INSUFFICIENT_ROLE", action });
  }
  // `precondition` already rejected a null role; this narrows for the caller.
  return allowed({ workspaceRole: actor.workspaceRole ?? "guest" });
}
