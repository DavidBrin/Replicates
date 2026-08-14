// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlDatabase } from "@/adapters/db/driver";
import { ConflictError } from "@/ports/repositories";

import {
  createFixture,
  createTestDatabase,
  fixedClock,
  type Fixture,
} from "./harness";

/**
 * The four small repositories: comments, notifications, labels and views.
 *
 * They share a file because they share a fixture and because none of them
 * carries a rule big enough to warrant its own. The rules that are here —
 * one-level threads, self-actions notifying nobody, a saved view storing a
 * query rather than a result — are each one test.
 */

let db: SqlDatabase;
let fx: Fixture;
const clock = fixedClock();

beforeAll(async () => {
  db = await createTestDatabase();
  fx = await createFixture(db, clock.clock);
});

afterAll(async () => {
  await db.close();
});

function newIssue(title: string) {
  return fx.repos.issues.create(
    { teamId: fx.teamId, title, creatorId: fx.ownerId },
    fx.ownerId,
  );
}

describe("comments", () => {
  it("attaches a reply to the thread root, not to the reply", async () => {
    // Replying to a reply flattens onto the same thread — Linear's behaviour,
    // and what keeps rendering a thread a single pass over a flat list.
    const issue = await newIssue("Threaded");
    const root = await fx.repos.comments.create({
      issueId: issue.id,
      userId: fx.ownerId,
      body: "The opening question",
    });
    const reply = await fx.repos.comments.create({
      issueId: issue.id,
      userId: fx.memberId,
      body: "An answer",
      parentId: root.id,
    });
    const nested = await fx.repos.comments.create({
      issueId: issue.id,
      userId: fx.ownerId,
      body: "A follow-up to the answer",
      parentId: reply.id,
    });

    expect(reply.parentId).toBe(root.id);
    expect(nested.parentId).toBe(root.id);
  });

  it("returns the author with the comment", async () => {
    const issue = await newIssue("Attributed");
    const comment = await fx.repos.comments.create({
      issueId: issue.id,
      userId: fx.memberId,
      body: "Mine",
    });
    expect(comment.user.id).toBe(fx.memberId);
    expect(comment.user).not.toHaveProperty("password_hash");
  });

  it("subscribes whoever comments", async () => {
    const issue = await newIssue("Discussed");
    await fx.repos.comments.create({
      issueId: issue.id,
      userId: fx.guestId,
      body: "Passing through",
    });
    const subscribers = await fx.repos.issues.listSubscribers(issue.id);
    expect(subscribers.map((user) => user.id)).toContain(fx.guestId);
  });

  it("marks an edit and leaves createdAt alone", async () => {
    const issue = await newIssue("Edited");
    const comment = await fx.repos.comments.create({
      issueId: issue.id,
      userId: fx.ownerId,
      body: "First draft",
    });
    expect(comment.editedAt).toBeNull();

    clock.advance(60_000);
    const edited = await fx.repos.comments.update(comment.id, "Second draft", fx.ownerId);
    expect(edited.editedAt).not.toBeNull();
    expect(edited.createdAt).toBe(comment.createdAt);
  });

  it("takes replies with it when the root is deleted", async () => {
    const issue = await newIssue("Deleted thread");
    const root = await fx.repos.comments.create({
      issueId: issue.id,
      userId: fx.ownerId,
      body: "Root",
    });
    await fx.repos.comments.create({
      issueId: issue.id,
      userId: fx.memberId,
      body: "Reply",
      parentId: root.id,
    });

    await fx.repos.comments.delete(root.id, fx.ownerId);
    expect(await fx.repos.comments.listForIssue(issue.id)).toHaveLength(0);
  });

  it("bumps the issue's comment count", async () => {
    const issue = await newIssue("Counted");
    await fx.repos.comments.create({
      issueId: issue.id,
      userId: fx.ownerId,
      body: "One",
    });
    expect((await fx.repos.issues.byId(issue.id))?.commentCount).toBe(1);
  });
});

describe("reactions", () => {
  it("is idempotent for the same user and emoji", async () => {
    const issue = await newIssue("Reacted");
    const comment = await fx.repos.comments.create({
      issueId: issue.id,
      userId: fx.ownerId,
      body: "React to me",
    });

    const first = await fx.repos.comments.addReaction(
      { commentId: comment.id },
      fx.memberId,
      "👍",
    );
    // A double-tap on a phone should not produce an error toast.
    const again = await fx.repos.comments.addReaction(
      { commentId: comment.id },
      fx.memberId,
      "👍",
    );
    expect(again.id).toBe(first.id);

    const withReaction = await fx.repos.comments.byId(comment.id);
    expect(withReaction?.reactions).toHaveLength(1);

    await fx.repos.comments.removeReaction(first.id, fx.memberId);
    expect((await fx.repos.comments.byId(comment.id))?.reactions).toHaveLength(0);
  });

  it("targets exactly one of a comment or an issue", async () => {
    const issue = await newIssue("One target");
    await expect(
      fx.repos.comments.addReaction({}, fx.ownerId, "🎉"),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      fx.repos.comments.addReaction(
        { issueId: issue.id, commentId: "cmt_x" },
        fx.ownerId,
        "🎉",
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      fx.repos.comments.addReaction({ issueId: issue.id }, fx.ownerId, "🎉"),
    ).resolves.toBeDefined();
  });
});

describe("notifications", () => {
  it("notifies nobody about your own actions", async () => {
    // The guard is here rather than at every call site: forgetting it once
    // produces an inbox that tells you what you just did.
    const issue = await newIssue("Self");
    const skipped = await fx.repos.notifications.create({
      userId: fx.ownerId,
      actorId: fx.ownerId,
      type: "issue_assigned",
      issueId: issue.id,
    });
    expect(skipped).toBeNull();
    expect(await fx.repos.notifications.unreadCount(fx.ownerId)).toBe(0);
  });

  it("lists newest first, and counts only the unread", async () => {
    const issue = await newIssue("Inbox");
    for (const [index, type] of (["issue_assigned", "issue_commented"] as const).entries()) {
      clock.advance(1_000 * (index + 1));
      await fx.repos.notifications.create({
        userId: fx.memberId,
        actorId: fx.ownerId,
        type,
        issueId: issue.id,
      });
    }

    const inbox = await fx.repos.notifications.listForUser(fx.memberId);
    expect(inbox).toHaveLength(2);
    expect(inbox[0]?.type).toBe("issue_commented");
    expect(await fx.repos.notifications.unreadCount(fx.memberId)).toBe(2);

    await fx.repos.notifications.markRead([inbox[0]!.id], fx.memberId);
    expect(await fx.repos.notifications.unreadCount(fx.memberId)).toBe(1);

    await fx.repos.notifications.markAllRead(fx.memberId);
    expect(await fx.repos.notifications.unreadCount(fx.memberId)).toBe(0);
  });

  it("hides a notification snoozed into the future and returns it later", async () => {
    // No background job: the notification reappears because the comparison in
    // the `where` clause changed its mind.
    const issue = await newIssue("Snoozed");
    const notification = await fx.repos.notifications.create({
      userId: fx.guestId,
      actorId: fx.ownerId,
      type: "issue_mentioned",
      issueId: issue.id,
    });

    const until = new Date(Date.parse(clock.now()) + 3_600_000).toISOString();
    await fx.repos.notifications.snooze(notification!.id, until, fx.guestId);
    expect(await fx.repos.notifications.listForUser(fx.guestId)).toHaveLength(0);
    expect(
      await fx.repos.notifications.listForUser(fx.guestId, { hideSnoozed: false }),
    ).toHaveLength(1);

    clock.advance(7_200_000);
    expect(await fx.repos.notifications.listForUser(fx.guestId)).toHaveLength(1);
  });

  it("refuses to touch another account's notification", async () => {
    const issue = await newIssue("Not yours");
    const notification = await fx.repos.notifications.create({
      userId: fx.memberId,
      actorId: fx.ownerId,
      type: "issue_assigned",
      issueId: issue.id,
    });
    await expect(
      fx.repos.notifications.snooze(notification!.id, null, fx.guestId),
    ).rejects.toThrow(/not found/);
  });
});

describe("labels", () => {
  it("scopes a team label to that team and keeps workspace labels everywhere", async () => {
    const shared = await fx.repos.labels.create({
      workspaceId: fx.workspaceId,
      name: "Shared",
      color: "#5e6ad2",
    });
    const scoped = await fx.repos.labels.create({
      workspaceId: fx.workspaceId,
      teamId: fx.teamId,
      name: "Scoped",
      color: "#eb5757",
    });

    const forTeam = await fx.repos.labels.listForWorkspace(fx.workspaceId, fx.teamId);
    expect(forTeam.map((l) => l.id)).toEqual(
      expect.arrayContaining([shared.id, scoped.id]),
    );

    const workspaceOnly = await fx.repos.labels.listForWorkspace(fx.workspaceId);
    expect(workspaceOnly.map((l) => l.id)).not.toContain(scoped.id);
  });

  it("promotes children when a label group is deleted", async () => {
    const group = await fx.repos.labels.create({
      workspaceId: fx.workspaceId,
      name: "Platform",
      color: "#95a2b3",
    });
    const child = await fx.repos.labels.create({
      workspaceId: fx.workspaceId,
      name: "iOS",
      color: "#95a2b3",
      parentId: group.id,
    });

    await fx.repos.labels.delete(group.id);
    const survivor = await fx.repos.labels.byId(child.id);
    expect(survivor).not.toBeNull();
    expect(survivor?.parentId).toBeNull();
  });

  it("removes a deleted label from its issues", async () => {
    const label = await fx.repos.labels.create({
      workspaceId: fx.workspaceId,
      name: "Temporary",
      color: "#f2994a",
    });
    const issue = await newIssue("Tagged");
    await fx.repos.issues.addLabel(issue.id, label.id, fx.ownerId);
    expect((await fx.repos.issues.byId(issue.id))?.labels).toHaveLength(1);

    await fx.repos.labels.delete(label.id);
    expect((await fx.repos.issues.byId(issue.id))?.labels).toHaveLength(0);
  });

  it("replaces a whole label set with one call", async () => {
    const [a, b, c] = await Promise.all(
      ["A", "B", "C"].map((name) =>
        fx.repos.labels.create({
          workspaceId: fx.workspaceId,
          name: `Set ${name}`,
          color: "#26b5ce",
        }),
      ),
    );
    const issue = await newIssue("Re-labelled");
    await fx.repos.issues.setLabels(issue.id, [a!.id, b!.id], fx.ownerId);
    await fx.repos.issues.setLabels(issue.id, [b!.id, c!.id], fx.ownerId);

    const labels = (await fx.repos.issues.byId(issue.id))?.labels ?? [];
    expect(labels.map((l) => l.id).sort()).toEqual([b!.id, c!.id].sort());

    const feed = await fx.repos.activity.listForIssue(issue.id);
    expect(feed.filter((e) => e.type === "label_added")).toHaveLength(3);
    expect(feed.filter((e) => e.type === "label_removed")).toHaveLength(1);
  });
});

describe("saved views", () => {
  const display = {
    layout: "board",
    groupBy: "assignee",
    orderBy: "priority",
    orderDirection: "asc",
    showSubIssues: true,
    showEmptyGroups: false,
    showCompletedIssues: false,
    properties: ["priority", "assignee"],
  } as const;

  it("stores the query, not the result", async () => {
    const view = await fx.repos.views.create({
      workspaceId: fx.workspaceId,
      ownerId: fx.ownerId,
      name: "Urgent and mine",
      filter: { priorities: [1], assigneeIds: [fx.ownerId] },
      display,
    });

    const read = await fx.repos.views.byId(view.id);
    expect(read?.filter).toEqual({ priorities: [1], assigneeIds: [fx.ownerId] });
    expect(read?.display.groupBy).toBe("assignee");

    // …and it is directly usable as a query.
    const results = await fx.repos.issues.list({
      workspaceId: fx.workspaceId,
      filter: read!.filter,
    });
    expect(Array.isArray(results)).toBe(true);
  });

  it("fills in display options a saved view predates", async () => {
    await db.execute(
      `insert into saved_views (id, workspace_id, owner_id, name, filter, display)
       values ('viw_legacy', $1, $2, 'Legacy', '{}'::jsonb, '{"layout":"list"}'::jsonb)`,
      [fx.workspaceId, fx.ownerId],
    );
    const legacy = await fx.repos.views.byId("viw_legacy");
    expect(legacy?.display.groupBy).toBe("status");
    expect(legacy?.display.properties.length).toBeGreaterThan(0);
  });

  it("shows a user their own views plus the shared ones", async () => {
    const mine = await fx.repos.views.create({
      workspaceId: fx.workspaceId,
      ownerId: fx.memberId,
      name: "Only mine",
      filter: {},
      display,
    });
    const shared = await fx.repos.views.create({
      workspaceId: fx.workspaceId,
      ownerId: fx.ownerId,
      name: "Everyone's",
      filter: {},
      display,
      shared: true,
    });

    const visible = await fx.repos.views.listForUser(fx.workspaceId, fx.memberId);
    expect(visible.map((view) => view.id)).toEqual(
      expect.arrayContaining([mine.id, shared.id]),
    );
    expect(
      (await fx.repos.views.listForUser(fx.workspaceId, fx.guestId)).map((v) => v.id),
    ).not.toContain(mine.id);
  });

  it("takes its favourite with it when deleted", async () => {
    const view = await fx.repos.views.create({
      workspaceId: fx.workspaceId,
      ownerId: fx.ownerId,
      name: "Bookmarked",
      filter: {},
      display,
    });
    await fx.repos.views.addFavorite(fx.ownerId, "view", view.id);
    expect(await fx.repos.views.listFavorites(fx.ownerId)).toHaveLength(1);

    await fx.repos.views.delete(view.id, fx.ownerId);
    expect(await fx.repos.views.listFavorites(fx.ownerId)).toHaveLength(0);
  });

  it("keeps favourites in a manual order and never duplicates one", async () => {
    const issue = await newIssue("Favourite");
    const first = await fx.repos.views.addFavorite(fx.memberId, "issue", issue.id);
    const again = await fx.repos.views.addFavorite(fx.memberId, "issue", issue.id);
    expect(again.id).toBe(first.id);

    const second = await fx.repos.views.addFavorite(fx.memberId, "team", fx.teamId);
    const favorites = await fx.repos.views.listFavorites(fx.memberId);
    expect(favorites.map((f) => f.id)).toEqual([first.id, second.id]);

    await fx.repos.views.removeFavorite(fx.memberId, "issue", issue.id);
    expect(await fx.repos.views.listFavorites(fx.memberId)).toHaveLength(1);
  });
});
