// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setDbForTests, type SqlDatabase } from "@/adapters/db";
import {
  createFixture,
  createTestDatabase,
  type Fixture,
} from "@/adapters/repositories/__tests__/harness";
import {
  GET as listNotifications,
  POST as markAllRead,
} from "@/app/api/notifications/route";
import { PATCH as patchNotification } from "@/app/api/notifications/[id]/route";
import type { InboxNotification } from "@/components/inbox/types";
import { createSession, sessionCookieName } from "@/lib/auth/session";

/**
 * The Inbox is addressed to one workspace, and now so are its set operations.
 *
 * Every request to these routes names a workspace and is refused without
 * standing in it. The two things that ignored that were the badge count and
 * "mark all read": `notifications.user_id` was their only clause, so the count
 * summed **every workspace the user belongs to** and the mark-all cleared all of
 * them from whichever tab was open.
 *
 * One user in two workspaces, one unread notification in each, is the whole
 * fixture — the bug is invisible with fewer.
 */

let db: SqlDatabase;
let dispose: () => Promise<void>;
let fixture: Fixture;

let betaNotificationId: string;

beforeAll(async () => {
  db = await createTestDatabase();
  dispose = setDbForTests(db);
  fixture = await createFixture(db);

  // Workspace one: the fixture's Acme. One unread notification for the member,
  // about an issue in the team they belong to.
  const acmeIssue = await fixture.repos.issues.create(
    { teamId: fixture.teamId, title: "Acme work", creatorId: fixture.ownerId },
    fixture.ownerId,
  );
  await fixture.repos.notifications.create({
    userId: fixture.memberId,
    type: "issue_assigned",
    issueId: acmeIssue.id,
    actorId: fixture.ownerId,
  });

  // Workspace two: the same two people, a different workspace entirely.
  const beta = await fixture.repos.workspaces.create({
    name: "Beta",
    urlKey: "beta",
    ownerId: fixture.ownerId,
  });
  await fixture.repos.workspaces.addMember(beta.id, fixture.memberId, "member");
  const betaTeam = await fixture.repos.teams.create(
    { workspaceId: beta.id, name: "Platform", key: "PLT" },
    fixture.ownerId,
  );
  await fixture.repos.teams.addMember(betaTeam.id, fixture.memberId, "member");
  const betaIssue = await fixture.repos.issues.create(
    { teamId: betaTeam.id, title: "Beta work", creatorId: fixture.ownerId },
    fixture.ownerId,
  );
  const betaNotification = await fixture.repos.notifications.create({
    userId: fixture.memberId,
    type: "issue_assigned",
    issueId: betaIssue.id,
    actorId: fixture.ownerId,
  });
  if (betaNotification === null) throw new Error("fixture failed to notify");
  betaNotificationId = betaNotification.id;
}, 60_000);

afterAll(async () => {
  await dispose();
});

async function cookie(): Promise<string> {
  const session = await createSession(fixture.memberId, { db });
  return `${sessionCookieName()}=${session.token}`;
}

interface Inbox {
  readonly notifications: readonly InboxNotification[];
  readonly unread: number;
}

async function inbox(workspace: string): Promise<Inbox> {
  const response = await listNotifications(
    new Request(`http://x/api/notifications?workspace=${workspace}`, {
      headers: { cookie: await cookie() },
    }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as Inbox;
}

async function clear(workspace: string): Promise<Response> {
  return markAllRead(
    new Request("http://x/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: await cookie() },
      body: JSON.stringify({ workspace, action: "markAllRead" }),
    }),
  );
}

describe("the Inbox's counts and mark-all are workspace-scoped", () => {
  it("counts only the workspace that was asked for", async () => {
    // Two unread rows exist for this user. One belongs to this inbox.
    const acme = await inbox("acme");
    expect(acme.notifications).toHaveLength(1);
    expect(acme.unread).toBe(1);

    const beta = await inbox("beta");
    expect(beta.notifications).toHaveLength(1);
    expect(beta.unread).toBe(1);
  });

  it("marks all read in one workspace without touching the other", async () => {
    const response = await clear("acme");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ updated: 1 });

    expect((await inbox("acme")).unread).toBe(0);

    // The row a request that never mentioned Beta must not have written.
    const beta = await inbox("beta");
    expect(beta.unread).toBe(1);
    expect(beta.notifications[0]?.id).toBe(betaNotificationId);
    expect(beta.notifications[0]?.readAt).toBeNull();
  });

  it("reports the workspace's count from a single-row mutation too", async () => {
    // Otherwise the badge changes meaning depending on which request last
    // refreshed it: a scoped number from the list, an account-wide one from a
    // click on a row.
    const response = await patchNotification(
      new Request(`http://x/api/notifications/${betaNotificationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: await cookie() },
        body: JSON.stringify({ workspace: "beta", read: true }),
      }),
      { params: Promise.resolve({ id: betaNotificationId }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ unread: 0 });
  });
});
