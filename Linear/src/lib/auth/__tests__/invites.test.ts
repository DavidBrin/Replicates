// @vitest-environment node
import { createHash } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PgliteDatabase, SCHEMA_SQL, type SqlDatabase } from "@/adapters/db";
import { DEFAULT_WORKSPACE_POLICY_SETTINGS } from "@/domain/policy";

import {
  acceptInvite,
  createInvite,
  mintInviteToken,
  previewInvite,
  revokeInvite,
} from "../invites";

/**
 * Invitations end to end, against a real database.
 *
 * The property under test is not "a token round-trips" — it is that the link is
 * a *bearer credential with an expiry, a single use and a revocation*, because
 * those four together are what make "whoever holds the link may accept" an
 * acceptable trade rather than a hole.
 */

const WORKSPACE = "wsp_inv";
const TEAM = "tem_inv";
const OWNER = "usr_inv_owner";
const ADMIN = "usr_inv_admin";
const MEMBER = "usr_inv_member";
const NEWCOMER = "usr_inv_newcomer";

let db: SqlDatabase;

beforeAll(async () => {
  db = new PgliteDatabase(":memory:", SCHEMA_SQL);
  await db.migrate();
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  for (const table of [
    "invites",
    "team_members",
    "teams",
    "workspace_members",
    "workspaces",
    "users",
  ]) {
    await db.execute(`delete from ${table}`);
  }

  await db.execute(
    "insert into workspaces (id, name, url_key) values ($1, 'Invites', 'invites')",
    [WORKSPACE],
  );
  for (const [id, role] of [
    [OWNER, "owner"],
    [ADMIN, "admin"],
    [MEMBER, "member"],
  ] as const) {
    await db.execute(
      `insert into users (id, email, password_hash, name, display_name)
       values ($1, $2, 'x', $1, $1)`,
      [id, `${id}@example.com`],
    );
    await db.execute(
      "insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)",
      [WORKSPACE, id, role],
    );
  }
  await db.execute(
    `insert into users (id, email, password_hash, name, display_name)
     values ($1, $2, 'x', 'Newcomer', 'newcomer')`,
    [NEWCOMER, `${NEWCOMER}@example.com`],
  );
  await db.execute(
    "insert into teams (id, workspace_id, name, key) values ($1, $2, 'Design', 'DES')",
    [TEAM, WORKSPACE],
  );
});

async function inviteFrom(
  actorId: string,
  role: "owner" | "admin" | "member" | "guest" = "member",
  teamIds: string[] = [],
) {
  const result = await createInvite(
    { workspaceId: WORKSPACE, actorId, role, teamIds, email: "who@example.com" },
    db,
  );
  if (!result.ok) throw new Error(`createInvite denied: ${result.denial.code}`);
  return result.value;
}

async function roleOf(userId: string): Promise<string | null> {
  const rows = await db.query<{ role: string }>(
    "select role from workspace_members where workspace_id = $1 and user_id = $2",
    [WORKSPACE, userId],
  );
  return rows[0]?.role ?? null;
}

/* ================================================================ tokens = */

describe("mintInviteToken", () => {
  it("produces a url-safe token and its digest", () => {
    const { token, tokenHash } = mintInviteToken();
    // 32 bytes of base64url.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("does not repeat", () => {
    const tokens = new Set(Array.from({ length: 64 }, () => mintInviteToken().token));
    expect(tokens.size).toBe(64);
  });
});

/* =============================================================== minting = */

describe("createInvite", () => {
  it("stores only the hash, and hands the link back exactly once", async () => {
    const { invite, token } = await inviteFrom(OWNER);

    const rows = await db.query<{ token_hash: string }>(
      "select token_hash from invites where id = $1",
      [invite.id],
    );
    expect(rows[0]?.token_hash).toBe(createHash("sha256").update(token).digest("hex"));
    // Nothing in the row can reconstruct the link.
    const all = await db.query("select * from invites where id = $1", [invite.id]);
    expect(JSON.stringify(all)).not.toContain(token);
  });

  it("R1 — an admin cannot mint an owner invite", async () => {
    const result = await createInvite(
      { workspaceId: WORKSPACE, actorId: ADMIN, role: "owner" },
      db,
    );
    expect(result.ok === false && result.denial.code).toBe(
      "CANNOT_GRANT_ABOVE_OWN_RANK",
    );
  });

  it("fn 2 — a plain member cannot invite under the default policy", async () => {
    const result = await createInvite(
      { workspaceId: WORKSPACE, actorId: MEMBER, role: "member" },
      db,
    );
    expect(result.ok === false && result.denial.code).toBe("INSUFFICIENT_ROLE");
  });

  it("fn 2 — …and can once the workspace opens invitations up", async () => {
    const result = await createInvite(
      {
        workspaceId: WORKSPACE,
        actorId: MEMBER,
        role: "member",
        settings: {
          ...DEFAULT_WORKSPACE_POLICY_SETTINGS,
          memberInvitePolicy: "anyMember",
        },
      },
      db,
    );
    expect(result.ok).toBe(true);
  });

  it("refuses somebody who is not in the workspace", async () => {
    const result = await createInvite(
      { workspaceId: WORKSPACE, actorId: NEWCOMER, role: "member" },
      db,
    );
    expect(result.ok === false && result.denial.code).toBe("NOT_A_MEMBER");
  });

  it("keeps the team list", async () => {
    const { invite } = await inviteFrom(OWNER, "member", [TEAM]);
    expect(invite.teamIds).toStrictEqual([TEAM]);
  });
});

/* ============================================================= accepting = */

describe("acceptInvite", () => {
  it("adds the workspace membership at the invited role", async () => {
    const { token } = await inviteFrom(ADMIN, "member");

    const result = await acceptInvite({ token, userId: NEWCOMER }, db);

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.alreadyMember).toBe(false);
    expect(await roleOf(NEWCOMER)).toBe("member");
  });

  it("adds the invite's teams, always as a plain team member", async () => {
    const { token } = await inviteFrom(OWNER, "guest", [TEAM]);

    const result = await acceptInvite({ token, userId: NEWCOMER }, db);

    expect(result.ok && result.value.teamIds).toStrictEqual([TEAM]);
    const rows = await db.query<{ role: string }>(
      "select role from team_members where team_id = $1 and user_id = $2",
      [TEAM, NEWCOMER],
    );
    // R7: a guest may be in a team, never as its admin.
    expect(rows[0]?.role).toBe("member");
  });

  it("marks the invite used, and says so on a second click", async () => {
    const { token, invite } = await inviteFrom(OWNER);

    expect((await acceptInvite({ token, userId: NEWCOMER }, db)).ok).toBe(true);

    const rows = await db.query<{ status: string; accepted_by_id: string }>(
      "select status, accepted_by_id from invites where id = $1",
      [invite.id],
    );
    expect(rows[0]?.status).toBe("accepted");
    expect(rows[0]?.accepted_by_id).toBe(NEWCOMER);

    const second = await acceptInvite({ token, userId: MEMBER }, db);
    expect(second.ok === false && second.denial.code).toBe("INVITE_ALREADY_USED");
    // …and the second person did not quietly get in.
    expect(await roleOf(MEMBER)).toBe("member");
  });

  it("is idempotent for somebody who is already a member", async () => {
    const { token } = await inviteFrom(OWNER, "admin");

    const result = await acceptInvite({ token, userId: MEMBER }, db);

    expect(result.ok && result.value.alreadyMember).toBe(true);
    // An existing membership is not silently upgraded by a link.
    expect(await roleOf(MEMBER)).toBe("member");
  });

  it("expires, and records that it did", async () => {
    const { token, invite } = await inviteFrom(OWNER);
    await db.execute(
      "update invites set expires_at = now() - interval '1 second' where id = $1",
      [invite.id],
    );

    const result = await acceptInvite({ token, userId: NEWCOMER }, db);

    expect(result.ok === false && result.denial.code).toBe("INVITE_EXPIRED");
    const rows = await db.query<{ status: string }>(
      "select status from invites where id = $1",
      [invite.id],
    );
    expect(rows[0]?.status).toBe("expired");
    expect(await roleOf(NEWCOMER)).toBeNull();
  });

  it("gives an unknown token the same answer as a nonexistent workspace", async () => {
    const result = await acceptInvite({ token: mintInviteToken().token, userId: NEWCOMER }, db);
    expect(result.ok === false && result.denial.code).toBe("INVITE_INVALID");
  });

  it("stops working once revoked", async () => {
    const { token, invite } = await inviteFrom(OWNER);
    const revoked = await revokeInvite({ inviteId: invite.id, actorId: OWNER }, db);
    expect(revoked.ok).toBe(true);

    const result = await acceptInvite({ token, userId: NEWCOMER }, db);
    expect(result.ok === false && result.denial.code).toBe("INVITE_INVALID");
  });

  it("§4.4.6 — re-validates the role against the inviter's *current* rank", async () => {
    // An admin mints an admin invite, then loses the rank that allowed it. The
    // link must not still hand out admin.
    const { token } = await inviteFrom(ADMIN, "admin");
    await db.execute(
      "update workspace_members set role = 'member' where workspace_id = $1 and user_id = $2",
      [WORKSPACE, ADMIN],
    );

    const result = await acceptInvite({ token, userId: NEWCOMER }, db);

    expect(result.ok === false && result.denial.code).toBe(
      "CANNOT_GRANT_ABOVE_OWN_RANK",
    );
    expect(await roleOf(NEWCOMER)).toBeNull();
  });

  it("dies with the inviter's membership", async () => {
    const { token } = await inviteFrom(ADMIN, "member");
    await db.execute(
      "delete from workspace_members where workspace_id = $1 and user_id = $2",
      [WORKSPACE, ADMIN],
    );

    const result = await acceptInvite({ token, userId: NEWCOMER }, db);
    expect(result.ok === false && result.denial.code).toBe("INVITE_INVALID");
  });

  it("survives a double-click without creating two memberships", async () => {
    const { token } = await inviteFrom(OWNER, "member");

    const [first, second] = await Promise.all([
      acceptInvite({ token, userId: NEWCOMER }, db),
      acceptInvite({ token, userId: NEWCOMER }, db),
    ]);

    // Whichever order they land in, the outcome is one membership and one
    // invite marked used.
    expect([first.ok, second.ok].filter(Boolean).length).toBeGreaterThanOrEqual(1);
    const rows = await db.query(
      "select 1 from workspace_members where workspace_id = $1 and user_id = $2",
      [WORKSPACE, NEWCOMER],
    );
    expect(rows).toHaveLength(1);
  });
});

/* =============================================================== preview = */

describe("previewInvite", () => {
  it("shows the workspace, the inviter, the role and the teams — and nothing else", async () => {
    const { token } = await inviteFrom(OWNER, "member", [TEAM]);

    const preview = await previewInvite(token, db);

    expect(preview).toStrictEqual({
      workspaceName: "Invites",
      workspaceUrlKey: "invites",
      inviterName: OWNER,
      role: "member",
      teamNames: ["Design"],
      email: "who@example.com",
    });
  });

  it("is null for anything unusable, so it cannot be used to probe", async () => {
    const { token, invite } = await inviteFrom(OWNER);
    expect(await previewInvite(mintInviteToken().token, db)).toBeNull();

    await db.execute("update invites set status = 'revoked' where id = $1", [invite.id]);
    expect(await previewInvite(token, db)).toBeNull();
  });
});

/* =============================================================== revoking */

describe("revokeInvite", () => {
  it("fn 5 — a member may revoke their own invitation", async () => {
    const created = await createInvite(
      {
        workspaceId: WORKSPACE,
        actorId: MEMBER,
        role: "member",
        settings: {
          ...DEFAULT_WORKSPACE_POLICY_SETTINGS,
          memberInvitePolicy: "anyMember",
        },
      },
      db,
    );
    if (!created.ok) throw new Error("setup failed");

    const result = await revokeInvite(
      { inviteId: created.value.invite.id, actorId: MEMBER },
      db,
    );
    expect(result.ok).toBe(true);
  });

  it("fn 5 — but not somebody else's", async () => {
    const { invite } = await inviteFrom(OWNER);
    const result = await revokeInvite({ inviteId: invite.id, actorId: MEMBER }, db);
    expect(result.ok === false && result.denial.code).toBe("INSUFFICIENT_ROLE");
  });
});
