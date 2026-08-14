// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlDatabase } from "@/adapters/db/driver";
import { transitionStamps } from "@/adapters/repositories/issues";
import { compareOrderKeys } from "@/domain/ordering";
import { ConflictError, NotFoundError } from "@/ports/repositories";

import {
  createFixture,
  createTestDatabase,
  fixedClock,
  type Fixture,
} from "./harness";

/**
 * The issue repository, against a real Postgres.
 *
 * The four rules in its module docstring are the four this file is here to
 * hold: numbering, ordering, the category-transition stamps, and the two logs.
 * Everything else is coverage.
 */

let db: SqlDatabase;
let fx: Fixture;
const clock = fixedClock("2026-03-16T09:00:00.000Z");

beforeAll(async () => {
  db = await createTestDatabase();
  fx = await createFixture(db, clock.clock);
});

afterAll(async () => {
  await db.close();
});

function create(overrides: Partial<Parameters<Fixture["repos"]["issues"]["create"]>[0]> = {}) {
  return fx.repos.issues.create(
    {
      teamId: fx.teamId,
      title: "An issue",
      creatorId: fx.ownerId,
      ...overrides,
    },
    fx.ownerId,
  );
}

describe("issue numbering", () => {
  it("allocates from the team counter, contiguously", async () => {
    const first = await create({ title: "First" });
    const second = await create({ title: "Second" });
    expect(second.number).toBe(first.number + 1);
    expect(second.identifier).toBe(`ENG-${second.number}`);
  });

  it("never reuses a number after a delete", async () => {
    const doomed = await create({ title: "Doomed" });
    await fx.repos.issues.purge(doomed.id, fx.ownerId);
    const next = await create({ title: "Next" });
    expect(next.number).toBeGreaterThan(doomed.number);
  });

  it("hands out unique, contiguous numbers under concurrent creation", async () => {
    // The allocator is `update … set issue_counter = issue_counter + 1 …
    // returning`, whose row lock is held to commit. A `select max(number) + 1`
    // would hand the same number to two of these and violate
    // `unique (team_id, number)` — the failure this test exists to catch.
    const team = await fx.repos.teams.create(
      { workspaceId: fx.workspaceId, name: "Race", key: "RAC" },
      fx.ownerId,
    );

    const created = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        fx.repos.issues.create(
          { teamId: team.id, title: `Concurrent ${index}`, creatorId: fx.ownerId },
          fx.ownerId,
        ),
      ),
    );

    const numbers = created.map((issue) => issue.number).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(12);
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));

    const after = await fx.repos.teams.byId(team.id);
    expect(after?.issueCounter).toBe(12);
  });
});

describe("ordering", () => {
  it("puts a new issue at the top of its team's list", async () => {
    const team = await fx.repos.teams.create(
      { workspaceId: fx.workspaceId, name: "Order", key: "ORD" },
      fx.ownerId,
    );
    const first = await fx.repos.issues.create(
      { teamId: team.id, title: "Oldest", creatorId: fx.ownerId },
      fx.ownerId,
    );
    const second = await fx.repos.issues.create(
      { teamId: team.id, title: "Newest", creatorId: fx.ownerId },
      fx.ownerId,
    );
    expect(compareOrderKeys(second.sortOrder, first.sortOrder)).toBe(-1);
  });

  it("moves an issue between two neighbours, writing one row", async () => {
    const team = await fx.repos.teams.create(
      { workspaceId: fx.workspaceId, name: "Move", key: "MOV" },
      fx.ownerId,
    );
    const [a, b, c] = await fx.repos.issues.createMany(
      ["A", "B", "C"].map((title) => ({
        teamId: team.id,
        title,
        creatorId: fx.ownerId,
      })),
      fx.ownerId,
    );
    const before = [a!, b!, c!].sort((x, y) =>
      compareOrderKeys(x.sortOrder, y.sortOrder),
    );

    const moved = await fx.repos.issues.move(
      before[2]!.id,
      null,
      before[0]!.sortOrder,
      fx.ownerId,
    );
    expect(compareOrderKeys(moved.sortOrder, before[0]!.sortOrder)).toBe(-1);

    // Nothing else moved: the other two keys are unchanged.
    const others = await Promise.all(
      [before[0]!.id, before[1]!.id].map((id) => fx.repos.issues.byId(id)),
    );
    expect(others.map((issue) => issue?.sortOrder)).toEqual([
      before[0]!.sortOrder,
      before[1]!.sortOrder,
    ]);
  });

  it("refuses a move whose neighbours are the wrong way round", async () => {
    const issue = await create({ title: "Backwards" });
    await expect(
      fx.repos.issues.move(issue.id, "a5", "a1", fx.ownerId),
    ).rejects.toThrow(/out of sequence/);
  });

  it("keeps bulk-created keys short", async () => {
    const team = await fx.repos.teams.create(
      { workspaceId: fx.workspaceId, name: "Bulk", key: "BLK" },
      fx.ownerId,
    );
    const issues = await fx.repos.issues.createMany(
      Array.from({ length: 30 }, (_, index) => ({
        teamId: team.id,
        title: `Pasted ${index}`,
        creatorId: fx.ownerId,
      })),
      fx.ownerId,
    );
    // Sequential `keyBetween` calls would subdivide the same leading gap 30
    // times and end with 30-character keys.
    const longest = Math.max(...issues.map((issue) => issue.sortOrder.length));
    expect(longest).toBeLessThanOrEqual(4);
    expect(new Set(issues.map((issue) => issue.sortOrder)).size).toBe(30);
  });

  it("gives a sub-issue a key in its parent's list, and drops it on unparenting", async () => {
    const parent = await create({ title: "Parent" });
    const child = await create({ title: "Child", parentId: parent.id });
    expect(child.subIssueSortOrder).not.toBeNull();

    const orphaned = await fx.repos.issues.update(
      child.id,
      { parentId: null },
      fx.ownerId,
    );
    expect(orphaned.subIssueSortOrder).toBeNull();
  });

  it("refuses to make an issue its own parent", async () => {
    const issue = await create({ title: "Ouroboros" });
    await expect(
      fx.repos.issues.update(issue.id, { parentId: issue.id }, fx.ownerId),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("category-transition timestamps", () => {
  it("is a pure function of the two state types", () => {
    const empty = {
      startedAt: null,
      completedAt: null,
      canceledAt: null,
      triagedAt: null,
    };
    const now = "2026-03-16T09:00:00.000Z";

    expect(transitionStamps("backlog", "started", empty, now).startedAt).toBe(now);
    expect(transitionStamps("backlog", "completed", empty, now).completedAt).toBe(now);
    expect(transitionStamps("backlog", "canceled", empty, now).canceledAt).toBe(now);

    // First-write-wins, and never cleared.
    const started = { ...empty, startedAt: "2026-03-01T00:00:00.000Z" };
    expect(transitionStamps("started", "started", started, now).startedAt).toBe(
      started.startedAt,
    );
    expect(transitionStamps("completed", "backlog", started, now).startedAt).toBe(
      started.startedAt,
    );

    // Leaving a category clears its stamp.
    const done = { ...started, completedAt: "2026-03-02T00:00:00.000Z" };
    expect(transitionStamps("completed", "started", done, now).completedAt).toBeNull();

    // Moving within a category does not re-stamp.
    expect(transitionStamps("completed", "completed", done, now).completedAt).toBe(
      done.completedAt,
    );
  });

  it("clears completedAt on a Backlog → Done → In Progress round trip", async () => {
    // The rule a clone is most likely to get wrong. Deriving the stamps from
    // the activity log resurrects the old value and corrupts every rollup that
    // reads it.
    const backlog = fx.stateOfType("backlog");
    const done = fx.stateOfType("completed");
    const doing = fx.stateOfType("started");

    const issue = await create({ title: "Round trip", stateId: backlog.id });
    expect(issue.startedAt).toBeNull();
    expect(issue.completedAt).toBeNull();

    const closed = await fx.repos.issues.update(
      issue.id,
      { stateId: done.id },
      fx.ownerId,
    );
    expect(closed.completedAt).not.toBeNull();

    const reopened = await fx.repos.issues.update(
      issue.id,
      { stateId: doing.id },
      fx.ownerId,
    );
    expect(reopened.completedAt).toBeNull();
    expect(reopened.startedAt).not.toBeNull();
  });

  it("keeps startedAt from the first pickup across a reopen", async () => {
    const doing = fx.stateOfType("started");
    const done = fx.stateOfType("completed");

    const issue = await create({ title: "Cycle time", stateId: doing.id });
    const firstStart = issue.startedAt;
    expect(firstStart).not.toBeNull();

    clock.advance(86_400_000);
    await fx.repos.issues.update(issue.id, { stateId: done.id }, fx.ownerId);
    clock.advance(86_400_000);
    const reopened = await fx.repos.issues.update(
      issue.id,
      { stateId: doing.id },
      fx.ownerId,
    );

    expect(reopened.startedAt).toBe(firstStart);
  });

  it("does not re-stamp on a move within the started category", async () => {
    const inProgress = fx.states["In Progress"]!;
    const inReview = fx.states["In Review"]!;
    const issue = await create({ title: "Within", stateId: inProgress.id });
    const started = issue.startedAt;

    clock.advance(3_600_000);
    const moved = await fx.repos.issues.update(
      issue.id,
      { stateId: inReview.id },
      fx.ownerId,
    );
    expect(moved.startedAt).toBe(started);
  });

  it("clears canceledAt when an issue leaves the canceled category", async () => {
    const canceled = fx.stateOfType("canceled");
    const todo = fx.stateOfType("unstarted");
    const issue = await create({ title: "Not so canceled", stateId: canceled.id });
    expect(issue.canceledAt).not.toBeNull();

    const revived = await fx.repos.issues.update(
      issue.id,
      { stateId: todo.id },
      fx.ownerId,
    );
    expect(revived.canceledAt).toBeNull();
  });

  it("stamps triagedAt when an issue leaves triage", async () => {
    // Linear's name means "triage completed at", not "entered triage at".
    // Only a triage-enabled team has the state at all, which is also the
    // assertion that a new issue on such a team lands in Triage by default.
    const team = await fx.repos.teams.create(
      {
        workspaceId: fx.workspaceId,
        name: "Support",
        key: "SUP",
        triageEnabled: true,
      },
      fx.ownerId,
    );
    const states = await fx.repos.teams.listStates(team.id);
    const todo = states.find((state) => state.type === "unstarted")!;

    const issue = await fx.repos.issues.create(
      { teamId: team.id, title: "Triaged", creatorId: fx.ownerId },
      fx.ownerId,
    );
    expect(issue.state.type).toBe("triage");
    expect(issue.triagedAt).toBeNull();

    const sorted = await fx.repos.issues.update(
      issue.id,
      { stateId: todo.id },
      fx.ownerId,
    );
    expect(sorted.triagedAt).not.toBeNull();
  });
});

describe("the activity feed", () => {
  it("records a creation naming the issue's identifier", async () => {
    const issue = await create({ title: "Logged" });
    const feed = await fx.repos.activity.listForIssue(issue.id);
    expect(feed).toHaveLength(1);
    expect(feed[0]?.type).toBe("issue_created");
    expect(feed[0]?.payload["toLabel"]).toBe(issue.identifier);
    expect(feed[0]?.user?.id).toBe(fx.ownerId);
  });

  it("carries both the id and the label of each side of a change", async () => {
    const todo = fx.stateOfType("unstarted");
    const doing = fx.states["In Progress"]!;
    const issue = await create({ title: "Both sides", stateId: todo.id });
    await fx.repos.issues.update(issue.id, { stateId: doing.id }, fx.ownerId);

    const feed = await fx.repos.activity.listForIssue(issue.id);
    const change = feed.find((entry) => entry.type === "state_changed");
    expect(change?.payload).toMatchObject({
      fromId: todo.id,
      fromLabel: todo.name,
      toId: doing.id,
      toLabel: doing.name,
      fromType: "unstarted",
      toType: "started",
    });
  });

  it("still reads correctly after the state it names is renamed", async () => {
    // The whole reason the label is denormalised. A feed that resolved names by
    // joining would silently rewrite a year of history on one rename.
    const team = await fx.repos.teams.create(
      { workspaceId: fx.workspaceId, name: "Rename", key: "REN" },
      fx.ownerId,
    );
    const states = await fx.repos.teams.listStates(team.id);
    const from = states.find((state) => state.name === "Todo")!;
    const to = states.find((state) => state.name === "In Progress")!;

    const issue = await fx.repos.issues.create(
      { teamId: team.id, title: "Renamed", stateId: from.id, creatorId: fx.ownerId },
      fx.ownerId,
    );
    await fx.repos.issues.update(issue.id, { stateId: to.id }, fx.ownerId);
    await fx.repos.teams.updateState(to.id, { name: "Doing" });

    const feed = await fx.repos.activity.listForIssue(issue.id);
    const change = feed.find((entry) => entry.type === "state_changed");
    expect(change?.payload["toLabel"]).toBe("In Progress");
  });

  it("records assignee, priority, title, estimate and due-date changes", async () => {
    const issue = await create({ title: "Everything" });
    await fx.repos.issues.update(
      issue.id,
      {
        title: "Everything, renamed",
        assigneeId: fx.memberId,
        priority: 1,
        estimate: 5,
        dueDate: "2026-04-01",
        description: "Now with a body",
      },
      fx.ownerId,
    );

    const types = (await fx.repos.activity.listForIssue(issue.id)).map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "issue_created",
        "title_changed",
        "assignee_changed",
        "priority_changed",
        "estimate_changed",
        "due_date_changed",
        "description_changed",
      ]),
    );
  });

  it("records a description change as a marker, without the bodies", async () => {
    const issue = await create({ title: "Prose", description: "before" });
    await fx.repos.issues.update(issue.id, { description: "after" }, fx.ownerId);
    const entry = (await fx.repos.activity.listForIssue(issue.id)).find(
      (e) => e.type === "description_changed",
    );
    expect(entry?.payload).toEqual({
      fromId: null,
      fromLabel: null,
      toId: null,
      toLabel: null,
    });
  });

  it("writes nothing for a patch that changes nothing", async () => {
    const issue = await create({ title: "Idempotent", priority: 2 });
    const before = await fx.repos.activity.listForIssue(issue.id);
    await fx.repos.issues.update(
      issue.id,
      { title: "Idempotent", priority: 2 },
      fx.ownerId,
    );
    const after = await fx.repos.activity.listForIssue(issue.id);
    expect(after).toHaveLength(before.length);
  });

  it("does not bump updatedAt for a no-op patch", async () => {
    const issue = await create({ title: "Untouched" });
    clock.advance(60_000);
    const same = await fx.repos.issues.update(
      issue.id,
      { title: "Untouched" },
      fx.ownerId,
    );
    expect(same.updatedAt).toBe(issue.updatedAt);
  });

  it("logs label additions and removals", async () => {
    const label = await fx.repos.labels.create({
      workspaceId: fx.workspaceId,
      name: "Bug",
      color: "#eb5757",
    });
    const issue = await create({ title: "Labelled" });

    await fx.repos.issues.addLabel(issue.id, label.id, fx.ownerId);
    await fx.repos.issues.removeLabel(issue.id, label.id, fx.ownerId);

    const feed = await fx.repos.activity.listForIssue(issue.id);
    expect(feed.find((e) => e.type === "label_added")?.payload).toMatchObject({
      toId: label.id,
      toLabel: "Bug",
    });
    expect(feed.find((e) => e.type === "label_removed")?.payload).toMatchObject({
      fromId: label.id,
      fromLabel: "Bug",
    });
  });

  it("logs archive and unarchive", async () => {
    const issue = await create({ title: "Archivable" });
    await fx.repos.issues.archive(issue.id, fx.ownerId);
    const archived = await fx.repos.issues.byId(issue.id);
    expect(archived?.archivedAt).not.toBeNull();

    await fx.repos.issues.unarchive(issue.id, fx.ownerId);
    const restored = await fx.repos.issues.byId(issue.id);
    expect(restored?.archivedAt).toBeNull();

    const types = (await fx.repos.activity.listForIssue(issue.id)).map((e) => e.type);
    expect(types).toContain("issue_archived");
    expect(types).toContain("issue_unarchived");
  });
});

describe("the changefeed", () => {
  it("appends an event for every mutation, in the same transaction", async () => {
    const from = await fx.repos.changefeed.latestSeq(fx.workspaceId);
    const issue = await create({ title: "Observable" });
    await fx.repos.issues.update(issue.id, { priority: 1 }, fx.ownerId);
    await fx.repos.issues.move(issue.id, null, null, fx.ownerId);

    const events = await fx.repos.changefeed.since(fx.workspaceId, from);
    const mine = events.filter((event) => event.entityId === issue.id);
    expect(mine.map((event) => event.action)).toEqual([
      "create",
      "update",
      "update",
    ]);
    expect(mine[1]?.payload["fields"]).toEqual(["priority"]);
    expect(mine[2]?.payload["fields"]).toEqual(["sortOrder"]);
  });

  it("rolls the event back with the write that failed", async () => {
    const from = await fx.repos.changefeed.latestSeq(fx.workspaceId);
    await expect(
      fx.repos.issues.create(
        { teamId: fx.teamId, title: "Doomed", creatorId: "usr_missing" },
        fx.ownerId,
      ),
    ).rejects.toThrow();
    const events = await fx.repos.changefeed.since(fx.workspaceId, from);
    expect(events).toHaveLength(0);
  });
});

describe("reading", () => {
  it("finds an issue by identifier, case-insensitively", async () => {
    const issue = await create({ title: "Findable" });
    const found = await fx.repos.issues.byIdentifier(
      fx.workspaceId,
      issue.identifier.toLowerCase(),
    );
    expect(found?.id).toBe(issue.id);
  });

  it("returns null for something that is not an identifier", async () => {
    expect(await fx.repos.issues.byIdentifier(fx.workspaceId, "nonsense")).toBeNull();
  });

  it("joins the whole row in one query", async () => {
    const label = await fx.repos.labels.create({
      workspaceId: fx.workspaceId,
      name: "Joined",
      color: "#26b5ce",
    });
    const project = await fx.repos.projects.create(
      { workspaceId: fx.workspaceId, name: "Sync" },
      fx.ownerId,
    );
    const issue = await create({
      title: "Fully joined",
      assigneeId: fx.memberId,
      projectId: project.id,
      labelIds: [label.id],
    });

    const read = await fx.repos.issues.byId(issue.id);
    expect(read?.team.key).toBe("ENG");
    expect(read?.state.type).toBeDefined();
    expect(read?.assignee?.id).toBe(fx.memberId);
    expect(read?.creator?.id).toBe(fx.ownerId);
    expect(read?.project?.name).toBe("Sync");
    expect(read?.labels.map((l) => l.name)).toEqual(["Joined"]);
    // The assignee is a full user without their password hash.
    expect(read?.assignee).not.toHaveProperty("password_hash");
  });

  it("counts sub-issues and completed sub-issues", async () => {
    const parent = await create({ title: "With children" });
    await create({ title: "Child one", parentId: parent.id });
    const second = await create({ title: "Child two", parentId: parent.id });
    await fx.repos.issues.update(
      second.id,
      { stateId: fx.stateOfType("completed").id },
      fx.ownerId,
    );

    const read = await fx.repos.issues.byId(parent.id);
    expect(read?.subIssueCount).toBe(2);
    expect(read?.completedSubIssueCount).toBe(1);
    expect(await fx.repos.issues.listSubIssues(parent.id)).toHaveLength(2);
  });

  it("lists and counts through the filter grammar", async () => {
    const team = await fx.repos.teams.create(
      { workspaceId: fx.workspaceId, name: "Listing", key: "LST" },
      fx.ownerId,
    );
    await fx.repos.issues.createMany(
      [
        { teamId: team.id, title: "Urgent one", creatorId: fx.ownerId, priority: 1 as const },
        { teamId: team.id, title: "Low one", creatorId: fx.ownerId, priority: 4 as const },
        { teamId: team.id, title: "None", creatorId: fx.ownerId, priority: 0 as const },
      ],
      fx.ownerId,
    );

    const listed = await fx.repos.issues.list({
      workspaceId: fx.workspaceId,
      filter: { teamIds: [team.id] },
      orderBy: "priority",
    });
    expect(listed.map((issue) => issue.priority)).toEqual([1, 4, 0]);
    expect(
      await fx.repos.issues.count({
        workspaceId: fx.workspaceId,
        filter: { teamIds: [team.id] },
      }),
    ).toBe(3);
  });

  it("scopes a list to one workspace", async () => {
    const otherOwner = await fx.repos.workspaces.create({
      name: "Other",
      urlKey: "other",
      ownerId: fx.ownerId,
    });
    const otherTeam = await fx.repos.teams.create(
      { workspaceId: otherOwner.id, name: "Other team", key: "OTH" },
      fx.ownerId,
    );
    await fx.repos.issues.create(
      { teamId: otherTeam.id, title: "Elsewhere", creatorId: fx.ownerId },
      fx.ownerId,
    );

    const here = await fx.repos.issues.list({ workspaceId: fx.workspaceId });
    expect(here.every((issue) => issue.title !== "Elsewhere")).toBe(true);
  });
});

describe("relations", () => {
  it("stores one row and derives the inverse", async () => {
    const blocker = await create({ title: "Blocker" });
    const blocked = await create({ title: "Blocked" });
    await fx.repos.issues.addRelation(blocker.id, blocked.id, "blocks", fx.ownerId);

    const forward = await fx.repos.issues.listRelations(blocker.id);
    expect(forward).toHaveLength(1);
    expect(forward[0]?.type).toBe("blocks");
    expect(forward[0]?.relatedIdentifier).toBe(blocked.identifier);

    const inverse = await fx.repos.issues.listRelations(blocked.id);
    expect(inverse).toHaveLength(1);
    expect(inverse[0]?.type).toBe("blocked_by");
    expect(inverse[0]?.relatedIdentifier).toBe(blocker.identifier);
  });

  it("refuses a self-relation and a duplicate", async () => {
    const a = await create({ title: "A" });
    const b = await create({ title: "B" });
    await expect(
      fx.repos.issues.addRelation(a.id, a.id, "related", fx.ownerId),
    ).rejects.toBeInstanceOf(ConflictError);

    await fx.repos.issues.addRelation(a.id, b.id, "related", fx.ownerId);
    await expect(
      fx.repos.issues.addRelation(a.id, b.id, "related", fx.ownerId),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("removes a relation from either end", async () => {
    const a = await create({ title: "Left" });
    const b = await create({ title: "Right" });
    const relation = await fx.repos.issues.addRelation(
      a.id,
      b.id,
      "duplicate",
      fx.ownerId,
    );
    await fx.repos.issues.removeRelation(relation.id, fx.ownerId);
    expect(await fx.repos.issues.listRelations(a.id)).toHaveLength(0);
    expect(await fx.repos.issues.listRelations(b.id)).toHaveLength(0);
  });
});

describe("subscriptions", () => {
  it("subscribes the creator and the assignee on creation", async () => {
    const issue = await create({ title: "Watched", assigneeId: fx.memberId });
    const subscribers = await fx.repos.issues.listSubscribers(issue.id);
    expect(subscribers.map((user) => user.id).sort()).toEqual(
      [fx.ownerId, fx.memberId].sort(),
    );
  });

  it("subscribes a new assignee, and does not unsubscribe the old one", async () => {
    const issue = await create({ title: "Handover", assigneeId: fx.memberId });
    await fx.repos.issues.update(issue.id, { assigneeId: fx.guestId }, fx.ownerId);
    const subscribers = await fx.repos.issues.listSubscribers(issue.id);
    expect(subscribers.map((user) => user.id).sort()).toEqual(
      [fx.ownerId, fx.memberId, fx.guestId].sort(),
    );
  });

  it("unsubscribes on request", async () => {
    const issue = await create({ title: "Muted" });
    await fx.repos.issues.unsubscribe(issue.id, fx.ownerId);
    expect(await fx.repos.issues.listSubscribers(issue.id)).toHaveLength(0);
  });
});

describe("lifecycle", () => {
  it("hides a trashed issue from lists but keeps the row", async () => {
    const issue = await create({ title: "Trashed" });
    await fx.repos.issues.trash(issue.id, fx.ownerId);

    const listed = await fx.repos.issues.list({
      workspaceId: fx.workspaceId,
      filter: { teamIds: [fx.teamId], includeArchived: true },
    });
    expect(listed.map((i) => i.id)).not.toContain(issue.id);
    expect(await fx.repos.issues.byId(issue.id)).not.toBeNull();

    const restored = await fx.repos.issues.restore(issue.id, fx.ownerId);
    expect(restored.id).toBe(issue.id);
  });

  it("orphans a purged issue's children rather than deleting them", async () => {
    const parent = await create({ title: "Doomed parent" });
    const child = await create({ title: "Surviving child", parentId: parent.id });
    await fx.repos.issues.purge(parent.id, fx.ownerId);

    const survivor = await fx.repos.issues.byId(child.id);
    expect(survivor).not.toBeNull();
    expect(survivor?.parentId).toBeNull();
  });

  it("reports a missing issue rather than returning nothing", async () => {
    await expect(
      fx.repos.issues.update("iss_nope", { title: "x" }, fx.ownerId),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("bulk edit", () => {
  it("applies one patch to many issues in one transaction", async () => {
    const team = await fx.repos.teams.create(
      { workspaceId: fx.workspaceId, name: "Bulk edit", key: "BED" },
      fx.ownerId,
    );
    const issues = await fx.repos.issues.createMany(
      Array.from({ length: 5 }, (_, index) => ({
        teamId: team.id,
        title: `Bulk ${index}`,
        creatorId: fx.ownerId,
      })),
      fx.ownerId,
    );

    const updated = await fx.repos.issues.updateMany(
      issues.map((issue) => issue.id),
      { assigneeId: fx.memberId, priority: 2 },
      fx.ownerId,
    );
    expect(updated).toHaveLength(5);
    expect(updated.every((issue) => issue.assigneeId === fx.memberId)).toBe(true);
    expect(updated.every((issue) => issue.priority === 2)).toBe(true);
  });
});

describe("composing into a caller's transaction", () => {
  it("rolls back everything when the caller throws", async () => {
    const before = await fx.repos.issues.count({ workspaceId: fx.workspaceId });

    await expect(
      db.transaction(async (tx) => {
        await fx.repos.issues.create(
          { teamId: fx.teamId, title: "Half a mutation", creatorId: fx.ownerId },
          fx.ownerId,
          tx,
        );
        throw new Error("caller changed its mind");
      }),
    ).rejects.toThrow(/changed its mind/);

    expect(await fx.repos.issues.count({ workspaceId: fx.workspaceId })).toBe(before);
  });
});
