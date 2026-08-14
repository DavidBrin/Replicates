import "server-only";

/**
 * Invitations, with no email provider anywhere in the deployment.
 *
 * ## The trade, stated rather than hidden
 *
 * There is no SMTP on a free host, so an invite is **a shareable link carrying
 * a bearer token**, not a message sent to an address. The consequence is
 * blunt and deliberate: *whoever holds the link may accept it*. `invites.email`
 * is a hint rendered in the members list so an admin can see who a link was
 * meant for — it is not an authentication factor and nothing checks it at
 * acceptance. Forwarding the link forwards the invitation.
 *
 * The alternative on this host is no invitations at all, which is worse for a
 * product whose entire premise is multi-user membership. What makes the trade
 * survivable is everything else in this file: 256 bits of entropy so the token
 * cannot be guessed, a stored hash so a database dump is not a set of working
 * links, an expiry, single use, and revocation
 * (`research/05-oss-architecture.md` §4).
 *
 * ## Why only the hash is stored
 *
 * `invites.token_hash` holds `sha256(token)` and the raw token is returned to
 * the creator exactly once. A constant-time compare is unnecessary here and its
 * absence is not an oversight: the lookup *is* the comparison, performed by a
 * unique index on the digest, so there is no secret-dependent branch to time.
 *
 * The cost is that the link cannot be shown again — "copy link" after the fact
 * is impossible, and the honest answer is to mint a new token and let the old
 * one die. That is the choice §4.3 offers; storing a reversible copy so the UI
 * can re-display it is the other, and it means holding a decryption key that
 * turns the whole table back into live credentials.
 */

import { createHash, randomBytes } from "node:crypto";

import { getDb, type SqlDatabase, type SqlExecutor, type SqlRow } from "@/adapters/db";
import { config } from "@/config/env";
import { WORKSPACE_ROLE_RANK } from "@/domain/entities";
import type {
  Id,
  TeamId,
  UserId,
  WorkspaceId,
  WorkspaceRole,
} from "@/domain/entities";
import {
  allowed,
  can,
  denied,
  type Authorized,
  type WorkspacePolicySettings,
} from "@/domain/policy";
import { loadActor, withWorkspaceLock } from "@/domain/services/membership";
import { newId } from "@/lib/ids";

export type InviteId = Id<"inv">;

/* ================================================================ tokens = */

export interface MintedToken {
  readonly token: string;
  readonly tokenHash: string;
}

/**
 * 32 bytes from the CSPRNG, base64url.
 *
 * Never `Math.random`, never a UUID: a v4 UUID carries 122 bits and, worse,
 * advertises its own structure. 256 bits makes offline guessing meaningless,
 * which is the property that lets a bearer link be acceptable at all.
 */
export function mintInviteToken(): MintedToken {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/* ================================================================= rows == */

interface InviteRow extends SqlRow {
  readonly id: InviteId;
  readonly workspace_id: WorkspaceId;
  readonly email: string | null;
  readonly role: WorkspaceRole;
  readonly team_ids: unknown;
  readonly invited_by_id: UserId;
  readonly status: string;
  readonly expires_at: string | Date;
}

/**
 * `team_ids` is a Postgres `text[]`.
 *
 * PGlite and the Neon driver both hand back a JavaScript array, but the two
 * disagree often enough about array decoding that a parser for the literal form
 * (`{a,b}`) is cheaper than finding out in production which one this is.
 */
function readTeamIds(value: unknown): TeamId[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  if (typeof value !== "string") return [];
  const inner = value.replace(/^\{|\}$/g, "").trim();
  if (inner === "") return [];
  return inner.split(",").map((entry) => entry.replace(/^"|"$/g, ""));
}

export interface Invite {
  readonly id: InviteId;
  readonly workspaceId: WorkspaceId;
  readonly email: string | null;
  readonly role: WorkspaceRole;
  readonly teamIds: readonly TeamId[];
  readonly invitedById: UserId;
  readonly status: string;
  readonly expiresAt: Date;
}

function toInvite(row: InviteRow): Invite {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    email: row.email,
    role: row.role,
    teamIds: readTeamIds(row.team_ids),
    invitedById: row.invited_by_id,
    status: row.status,
    expiresAt: new Date(row.expires_at),
  };
}

/* =============================================================== minting = */

export interface CreateInviteInput {
  readonly workspaceId: WorkspaceId;
  readonly actorId: UserId;
  readonly role: WorkspaceRole;
  readonly teamIds?: readonly TeamId[];
  /** A hint for the members list. Never checked at acceptance. */
  readonly email?: string | null;
  readonly settings?: WorkspacePolicySettings;
}

/**
 * Mint an invitation and return its link token once.
 *
 * R1 applies at mint time *and* again at acceptance: an admin cannot create an
 * owner invite, and an invite created by an admin who is later demoted stops
 * granting what they can no longer grant.
 */
export async function createInvite(
  input: CreateInviteInput,
  db: SqlDatabase = getDb(),
): Promise<Authorized<{ readonly invite: Invite; readonly token: string }>> {
  const { workspaceId, actorId, role, teamIds = [], email = null, settings } = input;

  return withWorkspaceLock<{ invite: Invite; token: string }>(
    db,
    workspaceId,
    async (tx) => {
      const actor = await loadActor(tx, workspaceId, actorId, settings);
      if (actor.workspaceRole === null) return denied({ code: "NOT_A_MEMBER" });
      if (actor.suspended === true) return denied({ code: "MEMBERSHIP_SUSPENDED" });
      if (!can(actor, "member.invite", { kind: "invite" })) {
        return denied({ code: "INSUFFICIENT_ROLE", action: "member.invite" });
      }
      if (WORKSPACE_ROLE_RANK[role] > WORKSPACE_ROLE_RANK[actor.workspaceRole]) {
        return denied({ code: "CANNOT_GRANT_ABOVE_OWN_RANK", requested: role });
      }

      const { token, tokenHash } = mintInviteToken();
      const id = newId("inv");
      const expiresAt = new Date(
        Date.now() + config().auth.inviteTtlSeconds * 1000,
      );

      const rows = await tx.query<InviteRow>(
        `insert into invites
           (id, workspace_id, email, role, team_ids, token_hash, invited_by_id, expires_at)
         values ($1, $2, $3, $4,
                 (select coalesce(array_agg(t.value), '{}'::text[])
                    from json_array_elements_text($5::json) as t(value)),
                 $6, $7, $8::timestamptz)
         returning id, workspace_id, email, role, team_ids, invited_by_id, status, expires_at`,
        [
          id,
          workspaceId,
          email,
          role,
          JSON.stringify(teamIds),
          tokenHash,
          actorId,
          expiresAt.toISOString(),
        ],
      );

      const row = rows[0];
      if (!row) return denied({ code: "NOT_FOUND", what: "invite" });
      return allowed({ invite: toInvite(row), token });
    },
  );
}

/* =============================================================== reading = */

export interface InvitePreview {
  readonly workspaceName: string;
  readonly workspaceUrlKey: string;
  readonly inviterName: string;
  readonly role: WorkspaceRole;
  readonly teamNames: readonly string[];
  readonly email: string | null;
}

/**
 * What the invite page may show before anyone is signed in.
 *
 * Workspace name, who invited, the role, the team names — and nothing else. Not
 * the member list, not issue counts: the token is the only credential and its
 * holder is not yet a principal.
 *
 * Returns `null` for anything unusable, so the page cannot tell a wrong token
 * from an expired one and cannot be used to probe for real workspaces.
 */
export async function previewInvite(
  token: string,
  db: SqlDatabase = getDb(),
): Promise<InvitePreview | null> {
  const rows = await db.query<
    SqlRow & {
      role: WorkspaceRole;
      email: string | null;
      team_ids: unknown;
      workspace_name: string;
      workspace_url_key: string;
      inviter_name: string;
      status: string;
      expires_at: string | Date;
    }
  >(
    `select i.role, i.email, i.team_ids, i.status, i.expires_at,
            w.name as workspace_name, w.url_key as workspace_url_key,
            u.name as inviter_name
       from invites i
       join workspaces w on w.id = i.workspace_id
       join users u on u.id = i.invited_by_id
      where i.token_hash = $1`,
    [hashInviteToken(token)],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.status !== "pending") return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  const teamIds = readTeamIds(row.team_ids);
  const teams = teamIds.length
    ? await db.query<SqlRow & { name: string }>(
        `select name from teams where id in (select value from json_array_elements_text($1::json))`,
        [JSON.stringify(teamIds)],
      )
    : [];

  return {
    workspaceName: row.workspace_name,
    workspaceUrlKey: row.workspace_url_key,
    inviterName: row.inviter_name,
    role: row.role,
    teamNames: teams.map((team) => team.name),
    email: row.email,
  };
}

/* ============================================================= accepting = */

export interface AcceptedInvite {
  readonly workspaceId: WorkspaceId;
  readonly role: WorkspaceRole;
  readonly teamIds: readonly TeamId[];
  /** True when the user was already in the workspace — a re-click, not an error. */
  readonly alreadyMember: boolean;
}

/**
 * Redeem a link.
 *
 * Everything happens under the workspace lock and a `for update` on the invite
 * row, which is what makes a double-click one membership rather than two rows
 * and a unique-violation. The inserts are `on conflict do nothing` for the same
 * reason: re-accepting is a no-op that still ends with the user inside.
 *
 * Failures are specific — expired, already used, revoked — because the caller
 * already holds the token, so telling them *why* their own link is dead leaks
 * nothing. The generic answer is reserved for a token that matches no row,
 * which is the only case where a distinction would help someone guessing.
 */
export async function acceptInvite(
  input: { readonly token: string; readonly userId: UserId },
  db: SqlDatabase = getDb(),
): Promise<Authorized<AcceptedInvite>> {
  const tokenHash = hashInviteToken(input.token);

  // Read once, unlocked, only to find which workspace to lock. Everything that
  // decides anything is re-read inside the transaction.
  const located = await db.query<SqlRow & { workspace_id: WorkspaceId }>(
    "select workspace_id from invites where token_hash = $1",
    [tokenHash],
  );
  const workspaceId = located[0]?.workspace_id;
  if (!workspaceId) return denied({ code: "INVITE_INVALID" });

  return withWorkspaceLock<AcceptedInvite>(db, workspaceId, async (tx) => {
    const rows = await tx.query<InviteRow>(
      `select id, workspace_id, email, role, team_ids, invited_by_id, status, expires_at
         from invites where token_hash = $1 for update`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) return denied({ code: "INVITE_INVALID" });
    const invite = toInvite(row);

    if (invite.status === "accepted") return denied({ code: "INVITE_ALREADY_USED" });
    if (invite.status !== "pending") return denied({ code: "INVITE_INVALID" });
    if (invite.expiresAt.getTime() <= Date.now()) {
      await tx.execute("update invites set status = 'expired' where id = $1", [
        invite.id,
      ]);
      return denied({ code: "INVITE_EXPIRED" });
    }

    // §4.4.6 — the role is re-validated against the *inviter's current* rank.
    // An invite minted by an admin who has since been demoted must not still
    // hand out admin.
    const inviter = await tx.query<SqlRow & { role: WorkspaceRole }>(
      "select role from workspace_members where workspace_id = $1 and user_id = $2",
      [invite.workspaceId, invite.invitedById],
    );
    const inviterRole = inviter[0]?.role;
    if (!inviterRole) return denied({ code: "INVITE_INVALID" });
    if (WORKSPACE_ROLE_RANK[invite.role] > WORKSPACE_ROLE_RANK[inviterRole]) {
      return denied({ code: "CANNOT_GRANT_ABOVE_OWN_RANK", requested: invite.role });
    }

    const inserted = await tx.execute(
      `insert into workspace_members (workspace_id, user_id, role)
       values ($1, $2, $3)
       on conflict (workspace_id, user_id) do nothing`,
      [invite.workspaceId, input.userId, invite.role],
    );

    const joinedTeams = await addToTeams(tx, invite, input.userId);

    await tx.execute(
      `update invites set status = 'accepted', accepted_at = now(), accepted_by_id = $2
        where id = $1`,
      [invite.id, input.userId],
    );

    return allowed({
      workspaceId: invite.workspaceId,
      role: invite.role,
      teamIds: joinedTeams,
      alreadyMember: inserted === 0,
    });
  });
}

/**
 * Put the new member in the invite's teams.
 *
 * Always at `member`: an invitation cannot mint a team admin. R7 is the reason
 * it also cannot be skipped for a guest — a guest invited into a team is the
 * normal case, and `member` is the only role they may hold there.
 *
 * The insert filters by `workspace_id` rather than trusting `team_ids`, so an
 * invite whose team has since moved or been deleted lands the user in the
 * workspace anyway instead of failing on a foreign key.
 */
async function addToTeams(
  tx: SqlExecutor,
  invite: Invite,
  userId: UserId,
): Promise<TeamId[]> {
  if (invite.teamIds.length === 0) return [];
  const rows = await tx.query<SqlRow & { team_id: TeamId }>(
    `insert into team_members (team_id, user_id, role)
     select t.id, $2, 'member'
       from teams t
      where t.workspace_id = $3
        and t.id in (select value from json_array_elements_text($1::json))
     on conflict (team_id, user_id) do nothing
     returning team_id`,
    [JSON.stringify(invite.teamIds), userId, invite.workspaceId],
  );
  return rows.map((row) => row.team_id);
}

/* ============================================================= revoking == */

export async function revokeInvite(
  input: {
    readonly inviteId: InviteId;
    readonly actorId: UserId;
    readonly settings?: WorkspacePolicySettings;
  },
  db: SqlDatabase = getDb(),
): Promise<Authorized<{ readonly revoked: InviteId }>> {
  const rows = await db.query<InviteRow>(
    `select id, workspace_id, email, role, team_ids, invited_by_id, status, expires_at
       from invites where id = $1`,
    [input.inviteId],
  );
  const row = rows[0];
  if (!row) return denied({ code: "NOT_FOUND", what: "invite" });
  const invite = toInvite(row);

  return withWorkspaceLock<{ revoked: InviteId }>(
    db,
    invite.workspaceId,
    async (tx) => {
      const actor = await loadActor(tx, invite.workspaceId, input.actorId, input.settings);
      if (actor.workspaceRole === null) return denied({ code: "NOT_A_MEMBER" });
      if (actor.suspended === true) return denied({ code: "MEMBERSHIP_SUSPENDED" });

      // Footnote 5: a plain member may only revoke invitations they created,
      // which the policy expresses as authorship of the invite.
      if (
        !can(actor, "invite.revoke", { kind: "invite", authorId: invite.invitedById })
      ) {
        return denied({ code: "INSUFFICIENT_ROLE", action: "invite.revoke" });
      }

      await tx.execute("update invites set status = 'revoked' where id = $1", [
        invite.id,
      ]);
      return allowed({ revoked: invite.id });
    },
  );
}
