import "server-only";

/**
 * Workspaces, their members, and the invitations that create members.
 *
 * ## The last-owner rule, and why it needs a lock
 *
 * A workspace must always have at least one owner (SPEC §4). The obvious
 * implementation — count the owners, refuse if the count is one — is wrong
 * under concurrency in a way that is invisible in a test suite and permanent in
 * production: with two owners, two simultaneous demotions each read `count = 2`,
 * each conclude they are safe, and both commit. The workspace ends with zero
 * owners and nobody who can promote one.
 *
 * A partial unique index cannot express it either: an index can require *at
 * most* one of a thing, never *at least* one.
 *
 * So both mutations take a row lock on the workspace before counting. `select …
 * for update` serialises them; the second transaction blocks until the first
 * commits and then reads `count = 1` and refuses. The lock is held for the
 * microseconds it takes to count and write one row.
 *
 * ## Invites carry no token
 *
 * Only `token_hash` reaches the database. There is no email provider in this
 * deployment, so an invite is a shareable link and whoever holds it may accept
 * — which makes the token a bearer credential, and a bearer credential stored
 * in plaintext is one database dump away from being every pending invitation in
 * the workspace. {@link StoredInvite} is `Invite` without the token, so a
 * repository *cannot* hand one back.
 */

import type { SqlExecutor, SqlRow } from "@/adapters/db/driver";
import type {
  Invite,
  InviteStatus,
  TeamId,
  UserId,
  Workspace,
  WorkspaceId,
  WorkspaceMember,
  WorkspaceRole,
} from "@/domain/entities";
import { newId, workspaceUrlKey } from "@/lib/ids";
import {
  ConflictError,
  type CreateInviteInput,
  type CreateWorkspaceInput,
  NotFoundError,
  type Patch,
  type StoredInvite,
  type Tx,
  type WorkspaceMemberWithUser,
  type WorkspaceRepository,
} from "@/ports/repositories";

import { appendChangeEvent } from "./changefeed";
import {
  BaseRepository,
  bool,
  mapUserRow,
  nullableText,
  nullableTimestamp,
  num,
  Params,
  text,
  timestamp,
} from "./shared";

const WORKSPACE_COLUMNS = `id, name, url_key, logo_url, allow_join_by_domain,
  allowed_domain, created_at`;

export function mapWorkspaceRow(row: SqlRow): Workspace {
  return {
    id: text(row, "id"),
    name: text(row, "name"),
    urlKey: text(row, "url_key"),
    logoUrl: nullableText(row, "logo_url"),
    createdAt: timestamp(row["created_at"]),
    allowJoinByDomain: bool(row, "allow_join_by_domain"),
    allowedDomain: nullableText(row, "allowed_domain"),
  };
}

function mapInviteRow(row: SqlRow): StoredInvite {
  const teamIds = row["team_ids"];
  return {
    id: text(row, "id"),
    workspaceId: text(row, "workspace_id"),
    email: nullableText(row, "email"),
    role: text(row, "role") as WorkspaceRole,
    teamIds: Array.isArray(teamIds) ? (teamIds as TeamId[]) : [],
    invitedById: text(row, "invited_by_id"),
    status: text(row, "status") as InviteStatus,
    createdAt: timestamp(row["created_at"]),
    expiresAt: timestamp(row["expires_at"]),
    acceptedAt: nullableTimestamp(row["accepted_at"]),
    acceptedById: nullableText(row, "accepted_by_id"),
  };
}

/**
 * A Postgres array literal.
 *
 * `SqlValue` is deliberately scalar — the driver port carries no array type —
 * so the one array column in this schema is formatted here. Every element is
 * double-quoted with backslashes escaped, which is the array literal's own
 * quoting rule and makes the content of an id irrelevant to whether the
 * statement parses.
 */
function arrayLiteral(values: readonly string[]): string {
  const quoted = values.map(
    (value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
  );
  return `{${quoted.join(",")}}`;
}

export class SqlWorkspaceRepository
  extends BaseRepository
  implements WorkspaceRepository
{
  async create(input: CreateWorkspaceInput, tx?: Tx): Promise<Workspace> {
    return this.atomically(tx, async (t) => {
      const id = input.id ?? newId("wsp");
      const now = this.now();
      const urlKey = await this.#uniqueUrlKey(
        t,
        input.urlKey ?? workspaceUrlKey(input.name),
      );

      await t.execute(
        `insert into workspaces (id, name, url_key, created_at, updated_at)
         values ($1,$2,$3,$4,$4)`,
        [id, input.name, urlKey, now],
      );
      await t.execute(
        `insert into workspace_members (workspace_id, user_id, role, joined_at)
         values ($1,$2,'owner',$3)`,
        [id, input.ownerId, now],
      );
      await appendChangeEvent(t, {
        workspaceId: id,
        entity: "workspace",
        entityId: id,
        action: "create",
        actorId: input.ownerId,
        payload: { urlKey },
      });
      return this.#require(t, id);
    });
  }

  async byId(id: WorkspaceId, tx?: Tx): Promise<Workspace | null> {
    const rows = await this.reader(tx).query(
      `select ${WORKSPACE_COLUMNS} from workspaces where id = $1`,
      [id],
    );
    const row = rows[0];
    return row === undefined ? null : mapWorkspaceRow(row);
  }

  async byUrlKey(urlKey: string, tx?: Tx): Promise<Workspace | null> {
    const rows = await this.reader(tx).query(
      `select ${WORKSPACE_COLUMNS} from workspaces where lower(url_key) = lower($1)`,
      [urlKey],
    );
    const row = rows[0];
    return row === undefined ? null : mapWorkspaceRow(row);
  }

  async listForUser(userId: UserId, tx?: Tx): Promise<Workspace[]> {
    const rows = await this.reader(tx).query(
      `select w.id, w.name, w.url_key, w.logo_url, w.allow_join_by_domain,
              w.allowed_domain, w.created_at
         from workspaces w
         join workspace_members m on m.workspace_id = w.id
        where m.user_id = $1
        order by m.joined_at asc, w.name asc`,
      [userId],
    );
    return rows.map(mapWorkspaceRow);
  }

  async update(
    id: WorkspaceId,
    patch: Patch<
      Pick<Workspace, "name" | "logoUrl" | "allowJoinByDomain" | "allowedDomain">
    >,
    actorId: UserId,
    tx?: Tx,
  ): Promise<Workspace> {
    return this.atomically(tx, async (t) => {
      const before = await this.#require(t, id);
      const params = new Params();
      const sets: string[] = [];
      const fields: string[] = [];

      if (patch.name !== undefined && patch.name !== before.name) {
        sets.push(`name = ${params.bind(patch.name)}`);
        fields.push("name");
      }
      if (patch.logoUrl !== undefined && patch.logoUrl !== before.logoUrl) {
        sets.push(`logo_url = ${params.bind(patch.logoUrl)}`);
        fields.push("logoUrl");
      }
      if (
        patch.allowJoinByDomain !== undefined &&
        patch.allowJoinByDomain !== before.allowJoinByDomain
      ) {
        sets.push(`allow_join_by_domain = ${params.bind(patch.allowJoinByDomain)}`);
        fields.push("allowJoinByDomain");
      }
      if (
        patch.allowedDomain !== undefined &&
        patch.allowedDomain !== before.allowedDomain
      ) {
        sets.push(`allowed_domain = ${params.bind(patch.allowedDomain)}`);
        fields.push("allowedDomain");
      }
      if (sets.length === 0) return before;

      sets.push(`updated_at = ${params.bind(this.now())}`);
      await t.execute(
        `update workspaces set ${sets.join(", ")} where id = ${params.bind(id)}`,
        params.values,
      );
      await appendChangeEvent(t, {
        workspaceId: id,
        entity: "workspace",
        entityId: id,
        action: "update",
        actorId,
        payload: { fields },
      });
      return this.#require(t, id);
    });
  }

  /* ----------------------------------------------------------- members -- */

  async listMembers(
    id: WorkspaceId,
    tx?: Tx,
  ): Promise<WorkspaceMemberWithUser[]> {
    const rows = await this.reader(tx).query(
      `select m.workspace_id, m.user_id, m.role, m.joined_at,
              u.id, u.email, u.name, u.display_name, u.avatar_url,
              u.avatar_color, u.created_at, u.active
         from workspace_members m join users u on u.id = m.user_id
        where m.workspace_id = $1
        order by case m.role
                   when 'owner' then 0 when 'admin' then 1
                   when 'member' then 2 else 3 end,
                 u.name asc`,
      [id],
    );
    return rows.map((row) => ({
      workspaceId: text(row, "workspace_id"),
      userId: text(row, "user_id"),
      role: text(row, "role") as WorkspaceRole,
      joinedAt: timestamp(row["joined_at"]),
      user: mapUserRow(row),
    }));
  }

  async memberOf(
    workspaceId: WorkspaceId,
    userId: UserId,
    tx?: Tx,
  ): Promise<WorkspaceMember | null> {
    const rows = await this.reader(tx).query(
      `select workspace_id, user_id, role, joined_at from workspace_members
        where workspace_id = $1 and user_id = $2`,
      [workspaceId, userId],
    );
    const row = rows[0];
    if (row === undefined) return null;
    return {
      workspaceId: text(row, "workspace_id"),
      userId: text(row, "user_id"),
      role: text(row, "role") as WorkspaceRole,
      joinedAt: timestamp(row["joined_at"]),
    };
  }

  async addMember(
    workspaceId: WorkspaceId,
    userId: UserId,
    role: WorkspaceRole,
    tx?: Tx,
  ): Promise<WorkspaceMember> {
    return this.atomically(tx, async (t) => {
      const now = this.now();
      await t.execute(
        `insert into workspace_members (workspace_id, user_id, role, joined_at)
         values ($1,$2,$3,$4)
         on conflict (workspace_id, user_id) do update set role = excluded.role`,
        [workspaceId, userId, role, now],
      );
      await appendChangeEvent(t, {
        workspaceId,
        entity: "workspaceMember",
        entityId: `${workspaceId}:${userId}`,
        action: "create",
        actorId: userId,
        payload: { userId, role },
      });
      return { workspaceId, userId, role, joinedAt: timestamp(now) };
    });
  }

  async setMemberRole(
    workspaceId: WorkspaceId,
    userId: UserId,
    role: WorkspaceRole,
    actorId: UserId,
    tx?: Tx,
  ): Promise<WorkspaceMember> {
    return this.atomically(tx, async (t) => {
      await this.#lock(t, workspaceId);
      const current = await this.memberOf(workspaceId, userId, t);
      if (current === null) throw new NotFoundError("WorkspaceMember", userId);
      if (current.role === role) return current;

      // The invariant is in the statement, not in a preceding `if`. Reading
      // the count and then writing is a check-then-act, and the lock above only
      // closes it when the two callers are on different connections — which is
      // true of Neon and false of PGlite, where one connection interleaves both
      // at their `await` points and each reads `owners = 2`. Making the count a
      // predicate of the update means the second writer's own statement sees
      // one owner and changes nothing, on either engine.
      const changed = await t.execute(
        `update workspace_members m set role = $3
          where m.workspace_id = $1 and m.user_id = $2
            and (m.role <> 'owner'
                 or (select count(*) from workspace_members o
                      where o.workspace_id = $1 and o.role = 'owner') > 1)`,
        [workspaceId, userId, role],
      );
      if (changed === 0) {
        // The membership exists — that was checked above — so the only thing
        // the predicate can have rejected is the last owner.
        throw new ConflictError(
          "The last owner cannot be demoted. Promote another owner first.",
        );
      }
      await appendChangeEvent(t, {
        workspaceId,
        entity: "workspaceMember",
        entityId: `${workspaceId}:${userId}`,
        action: "update",
        actorId,
        payload: { userId, from: current.role, to: role },
      });
      return { ...current, role };
    });
  }

  async removeMember(
    workspaceId: WorkspaceId,
    userId: UserId,
    actorId: UserId,
    tx?: Tx,
  ): Promise<void> {
    await this.atomically(tx, async (t) => {
      await this.#lock(t, workspaceId);
      const current = await this.memberOf(workspaceId, userId, t);
      if (current === null) return;
      // Same shape as `setMemberRole`: the invariant rides in the statement.
      const removed = await t.execute(
        `delete from workspace_members m
          where m.workspace_id = $1 and m.user_id = $2
            and (m.role <> 'owner'
                 or (select count(*) from workspace_members o
                      where o.workspace_id = $1 and o.role = 'owner') > 1)`,
        [workspaceId, userId],
      );
      if (removed === 0) {
        throw new ConflictError(
          "The last owner cannot be removed. Promote another owner first.",
        );
      }
      // Team memberships are scoped to the workspace, so leaving it leaves
      // every team in it. Without this the user keeps rows granting access to
      // teams in a workspace they are no longer part of.
      await t.execute(
        `delete from team_members
          where user_id = $2
            and team_id in (select id from teams where workspace_id = $1)`,
        [workspaceId, userId],
      );
      await appendChangeEvent(t, {
        workspaceId,
        entity: "workspaceMember",
        entityId: `${workspaceId}:${userId}`,
        action: "delete",
        actorId,
        payload: { userId },
      });
    });
  }

  async countOwners(workspaceId: WorkspaceId, tx?: Tx): Promise<number> {
    return this.#countOwners(this.reader(tx), workspaceId);
  }

  /* ----------------------------------------------------------- invites -- */

  async createInvite(input: CreateInviteInput, tx?: Tx): Promise<StoredInvite> {
    return this.atomically(tx, async (t) => {
      const id = input.id ?? newId("inv");
      const now = this.now();
      await t.execute(
        `insert into invites (id, workspace_id, email, role, team_ids, token_hash,
                              invited_by_id, status, created_at, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9)`,
        [
          id,
          input.workspaceId,
          input.email,
          input.role,
          arrayLiteral([...input.teamIds]),
          input.tokenHash,
          input.invitedById,
          now,
          input.expiresAt,
        ],
      );
      await appendChangeEvent(t, {
        workspaceId: input.workspaceId,
        entity: "invite",
        entityId: id,
        action: "create",
        actorId: input.invitedById,
        payload: { role: input.role },
      });
      return this.#requireInvite(t, id);
    });
  }

  async inviteByTokenHash(
    tokenHash: string,
    tx?: Tx,
  ): Promise<StoredInvite | null> {
    const rows = await this.reader(tx).query(
      `select id, workspace_id, email, role, team_ids, invited_by_id, status,
              created_at, expires_at, accepted_at, accepted_by_id
         from invites where token_hash = $1`,
      [tokenHash],
    );
    const row = rows[0];
    return row === undefined ? null : mapInviteRow(row);
  }

  async listInvites(
    workspaceId: WorkspaceId,
    status?: InviteStatus,
    tx?: Tx,
  ): Promise<StoredInvite[]> {
    const params = new Params();
    const workspace = params.bind(workspaceId);
    const statusClause =
      status === undefined ? "" : ` and status = ${params.bind(status)}`;
    const rows = await this.reader(tx).query(
      `select id, workspace_id, email, role, team_ids, invited_by_id, status,
              created_at, expires_at, accepted_at, accepted_by_id
         from invites
        where workspace_id = ${workspace}${statusClause}
        order by created_at desc`,
      params.values,
    );
    return rows.map(mapInviteRow);
  }

  async acceptInvite(
    inviteId: Invite["id"],
    userId: UserId,
    tx?: Tx,
  ): Promise<WorkspaceMember> {
    // Validated *before* the transaction opens, deliberately. An expired
    // invite is marked expired so the members screen stops showing it as
    // pending — and that write has to survive the refusal. Doing it inside the
    // transaction we are about to abort would roll it back, leaving an invite
    // that reports itself pending forever and fails every time it is used.
    const executor = this.reader(tx);
    const invite = await this.#requireInvite(executor, inviteId);
    if (invite.status !== "pending") {
      throw new ConflictError(`This invitation is ${invite.status}`);
    }
    if (Date.parse(invite.expiresAt) < Date.parse(this.now())) {
      await executor.execute(`update invites set status = 'expired' where id = $1`, [
        inviteId,
      ]);
      throw new ConflictError("This invitation has expired");
    }

    return this.atomically(tx, async (t) => {
      const member = await this.addMember(
        invite.workspaceId,
        userId,
        invite.role,
        t,
      );
      for (const teamId of invite.teamIds) {
        await t.execute(
          `insert into team_members (team_id, user_id, role, joined_at)
           values ($1,$2,'member',$3) on conflict do nothing`,
          [teamId, userId, this.now()],
        );
      }
      await t.execute(
        `update invites set status = 'accepted', accepted_at = $2,
                            accepted_by_id = $3
          where id = $1`,
        [inviteId, this.now(), userId],
      );
      await appendChangeEvent(t, {
        workspaceId: invite.workspaceId,
        entity: "invite",
        entityId: inviteId,
        action: "update",
        actorId: userId,
        payload: { status: "accepted" },
      });
      return member;
    });
  }

  async revokeInvite(
    inviteId: Invite["id"],
    actorId: UserId,
    tx?: Tx,
  ): Promise<void> {
    await this.atomically(tx, async (t) => {
      const invite = await this.#requireInvite(t, inviteId);
      await t.execute(`update invites set status = 'revoked' where id = $1`, [
        inviteId,
      ]);
      await appendChangeEvent(t, {
        workspaceId: invite.workspaceId,
        entity: "invite",
        entityId: inviteId,
        action: "update",
        actorId,
        payload: { status: "revoked" },
      });
    });
  }

  /* ----------------------------------------------------------- helpers -- */

  async #require(t: SqlExecutor, id: WorkspaceId): Promise<Workspace> {
    const workspace = await this.byId(id, t);
    if (workspace === null) throw new NotFoundError("Workspace", id);
    return workspace;
  }

  async #requireInvite(t: SqlExecutor, id: Invite["id"]): Promise<StoredInvite> {
    const rows = await t.query(
      `select id, workspace_id, email, role, team_ids, invited_by_id, status,
              created_at, expires_at, accepted_at, accepted_by_id
         from invites where id = $1`,
      [id],
    );
    const row = rows[0];
    if (row === undefined) throw new NotFoundError("Invite", id);
    return mapInviteRow(row);
  }

  /**
   * Serialise the owner-count check.
   *
   * `for update` on the workspace row, not on `workspace_members`: the rows
   * being counted are the ones changing, and locking a set you are about to
   * shrink does not stop a *different* transaction from shrinking a different
   * row of the same set. The workspace row is the one thing both transactions
   * agree on, so it is the mutex.
   */
  async #lock(t: SqlExecutor, workspaceId: WorkspaceId): Promise<void> {
    const rows = await t.query(`select id from workspaces where id = $1 for update`, [
      workspaceId,
    ]);
    if (rows.length === 0) throw new NotFoundError("Workspace", workspaceId);
  }

  async #countOwners(t: SqlExecutor, workspaceId: WorkspaceId): Promise<number> {
    const rows = await t.query(
      `select count(*) as owners from workspace_members
        where workspace_id = $1 and role = 'owner'`,
      [workspaceId],
    );
    const row = rows[0];
    return row === undefined ? 0 : num(row, "owners");
  }

  async #uniqueUrlKey(t: SqlExecutor, base: string): Promise<string> {
    for (let suffix = 0; suffix < 100; suffix += 1) {
      const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
      const rows = await t.query(
        `select 1 from workspaces where lower(url_key) = lower($1)`,
        [candidate],
      );
      if (rows.length === 0) return candidate;
    }
    throw new ConflictError(`No workspace URL key available near "${base}"`);
  }
}
