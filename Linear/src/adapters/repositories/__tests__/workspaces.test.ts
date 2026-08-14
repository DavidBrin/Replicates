// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlDatabase } from "@/adapters/db/driver";
import { createRepositories } from "@/adapters/repositories";
import { ConflictError, type Repositories } from "@/ports/repositories";

import { createTestDatabase, createUser, fixedClock } from "./harness";

/**
 * Workspaces, membership, and the rule the whole permission model rests on:
 * a workspace always has an owner.
 */

let db: SqlDatabase;
let repos: Repositories;
let owner: string;
let second: string;
let outsider: string;
const clock = fixedClock();

beforeAll(async () => {
  db = await createTestDatabase();
  repos = createRepositories(db, clock.clock);
  owner = await createUser(db, "owner@ws.test", "Owner");
  second = await createUser(db, "second@ws.test", "Second");
  outsider = await createUser(db, "outsider@ws.test", "Outsider");
});

afterAll(async () => {
  await db.close();
});

async function freshWorkspace(name: string) {
  return repos.workspaces.create({ name, ownerId: owner });
}

describe("creating a workspace", () => {
  it("derives a URL key from the name and makes the creator an owner", async () => {
    const workspace = await repos.workspaces.create({
      name: "Acme Corporation",
      ownerId: owner,
    });
    expect(workspace.urlKey).toBe("acme-corporation");
    const membership = await repos.workspaces.memberOf(workspace.id, owner);
    expect(membership?.role).toBe("owner");
  });

  it("uniquifies a URL key that is taken", async () => {
    const first = await repos.workspaces.create({ name: "Duplicate", ownerId: owner });
    const clash = await repos.workspaces.create({ name: "Duplicate", ownerId: owner });
    expect(first.urlKey).toBe("duplicate");
    expect(clash.urlKey).toBe("duplicate-2");
  });

  it("is findable by URL key, case-insensitively", async () => {
    const workspace = await repos.workspaces.create({
      name: "Case Test",
      urlKey: "CaseTest",
      ownerId: owner,
    });
    expect((await repos.workspaces.byUrlKey("casetest"))?.id).toBe(workspace.id);
  });

  it("lists only the workspaces a user belongs to", async () => {
    const mine = await freshWorkspace("Only Mine");
    const theirs = await repos.workspaces.create({
      name: "Only Theirs",
      ownerId: second,
    });
    const forSecond = await repos.workspaces.listForUser(second);
    expect(forSecond.map((w) => w.id)).toContain(theirs.id);
    expect(forSecond.map((w) => w.id)).not.toContain(mine.id);
  });
});

describe("members", () => {
  it("adds, promotes and lists with the user attached", async () => {
    const workspace = await freshWorkspace("Membership");
    await repos.workspaces.addMember(workspace.id, second, "member");

    const members = await repos.workspaces.listMembers(workspace.id);
    expect(members).toHaveLength(2);
    // Owners first — the members screen groups by role.
    expect(members[0]?.role).toBe("owner");
    expect(members[1]?.user.email).toBe("second@ws.test");

    await repos.workspaces.setMemberRole(workspace.id, second, "admin", owner);
    expect((await repos.workspaces.memberOf(workspace.id, second))?.role).toBe("admin");
  });

  it("removes a member's team memberships along with the workspace one", async () => {
    const workspace = await freshWorkspace("Cascade");
    await repos.workspaces.addMember(workspace.id, second, "member");
    const team = await repos.teams.create(
      { workspaceId: workspace.id, name: "Team", key: "TM" },
      owner,
    );
    await repos.teams.addMember(team.id, second, "member");

    await repos.workspaces.removeMember(workspace.id, second, owner);
    const teamMembers = await repos.teams.listMembers(team.id);
    expect(teamMembers.map((m) => m.userId)).not.toContain(second);
  });
});

describe("the last owner", () => {
  it("cannot be demoted", async () => {
    const workspace = await freshWorkspace("Sole Owner");
    await expect(
      repos.workspaces.setMemberRole(workspace.id, owner, "admin", owner),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await repos.workspaces.memberOf(workspace.id, owner))?.role).toBe("owner");
  });

  it("cannot be removed", async () => {
    const workspace = await freshWorkspace("Sole Owner Two");
    await expect(
      repos.workspaces.removeMember(workspace.id, owner, owner),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("can be demoted once a second owner exists", async () => {
    const workspace = await freshWorkspace("Two Owners");
    await repos.workspaces.addMember(workspace.id, second, "owner");
    await repos.workspaces.setMemberRole(workspace.id, owner, "admin", second);
    expect(await repos.workspaces.countOwners(workspace.id)).toBe(1);
  });

  it("survives two concurrent demotions", async () => {
    // The failure this guards against: two demotions that each read
    // `owners = 2`, each conclude they are safe, and both commit — leaving a
    // workspace nobody can administer. A check-then-write cannot prevent it;
    // the count is a predicate of the update statement instead, so the second
    // writer's own statement sees one owner and changes nothing.
    //
    // The assertion is on the invariant rather than on which call won. PGlite
    // multiplexes one connection, so two `transaction()` calls in flight
    // together share a physical transaction and the loser's rollback can
    // discard the winner's write. That is a property of the local adapter, not
    // of the rule: what must hold on either engine is that an owner remains.
    const workspace = await freshWorkspace("Race For The Exit");
    await repos.workspaces.addMember(workspace.id, second, "owner");

    const results = await Promise.allSettled([
      repos.workspaces.setMemberRole(workspace.id, owner, "member", owner),
      repos.workspaces.setMemberRole(workspace.id, second, "member", second),
    ]);

    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await repos.workspaces.countOwners(workspace.id)).toBeGreaterThanOrEqual(1);
  });
});

describe("invites", () => {
  it("stores only the token hash", async () => {
    const workspace = await freshWorkspace("Invites");
    const invite = await repos.workspaces.createInvite({
      workspaceId: workspace.id,
      email: "new@ws.test",
      role: "member",
      teamIds: [],
      tokenHash: "hash-of-the-token",
      invitedById: owner,
      expiresAt: "2026-04-16T09:00:00.000Z",
    });

    expect(invite).not.toHaveProperty("token");
    expect(invite.status).toBe("pending");
    expect((await repos.workspaces.inviteByTokenHash("hash-of-the-token"))?.id).toBe(
      invite.id,
    );
  });

  it("adds the accepting user to the workspace and its named teams", async () => {
    const workspace = await freshWorkspace("Accepting");
    const team = await repos.teams.create(
      { workspaceId: workspace.id, name: "Invited Team", key: "INV" },
      owner,
    );
    const invite = await repos.workspaces.createInvite({
      workspaceId: workspace.id,
      email: null,
      role: "guest",
      teamIds: [team.id],
      tokenHash: `hash-${workspace.id}`,
      invitedById: owner,
      expiresAt: "2026-04-16T09:00:00.000Z",
    });

    const membership = await repos.workspaces.acceptInvite(invite.id, outsider);
    expect(membership.role).toBe("guest");
    const teamMembers = await repos.teams.listMembers(team.id);
    expect(teamMembers.map((m) => m.userId)).toContain(outsider);

    // Spent, and not spendable twice.
    await expect(
      repos.workspaces.acceptInvite(invite.id, second),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses an expired invite and marks it so", async () => {
    const workspace = await freshWorkspace("Expiring");
    const invite = await repos.workspaces.createInvite({
      workspaceId: workspace.id,
      email: null,
      role: "member",
      teamIds: [],
      tokenHash: `hash-expired-${workspace.id}`,
      invitedById: owner,
      expiresAt: "2026-01-01T00:00:00.000Z",
    });

    await expect(
      repos.workspaces.acceptInvite(invite.id, outsider),
    ).rejects.toThrow(/expired/);
    const listed = await repos.workspaces.listInvites(workspace.id, "expired");
    expect(listed.map((i) => i.id)).toContain(invite.id);
  });

  it("revokes an invite", async () => {
    const workspace = await freshWorkspace("Revoking");
    const invite = await repos.workspaces.createInvite({
      workspaceId: workspace.id,
      email: null,
      role: "member",
      teamIds: [],
      tokenHash: `hash-revoked-${workspace.id}`,
      invitedById: owner,
      expiresAt: "2026-04-16T09:00:00.000Z",
    });
    await repos.workspaces.revokeInvite(invite.id, owner);
    await expect(
      repos.workspaces.acceptInvite(invite.id, outsider),
    ).rejects.toThrow(/revoked/);
  });
});

describe("updates", () => {
  it("writes only what changed and reports the fields it wrote", async () => {
    const workspace = await freshWorkspace("Renaming");
    const from = await repos.changefeed.latestSeq(workspace.id);

    const renamed = await repos.workspaces.update(
      workspace.id,
      { name: "Renamed", allowJoinByDomain: true },
      owner,
    );
    expect(renamed.name).toBe("Renamed");
    expect(renamed.allowJoinByDomain).toBe(true);

    const events = await repos.changefeed.since(workspace.id, from);
    expect(events.at(-1)?.payload["fields"]).toEqual(["name", "allowJoinByDomain"]);
  });

  it("is a no-op when nothing changed", async () => {
    const workspace = await freshWorkspace("Unchanged");
    const from = await repos.changefeed.latestSeq(workspace.id);
    await repos.workspaces.update(workspace.id, { name: "Unchanged" }, owner);
    expect(await repos.changefeed.since(workspace.id, from)).toHaveLength(0);
  });
});
