// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlDatabase } from "@/adapters/db/driver";
import { createRepositories } from "@/adapters/repositories";
import { compareOrderKeys } from "@/domain/ordering";
import { isId } from "@/lib/ids";
import { DEMO_PASSWORD, seedDemoWorkspace, type SeedResult } from "@/lib/seed";
import type { Repositories } from "@/ports/repositories";

import { createTestDatabase } from "./harness";

/**
 * The demo workspace.
 *
 * Read back through the repositories rather than by inspecting the inserts —
 * the fixture is only useful if the application's own queries can see it, and a
 * seed that satisfies its own SELECTs and not the repositories' is the failure
 * this file is for.
 */

let db: SqlDatabase;
let repos: Repositories;
let seed: SeedResult;

beforeAll(async () => {
  db = await createTestDatabase();
  repos = createRepositories(db);
  seed = await seedDemoWorkspace(db);
});

afterAll(async () => {
  await db.close();
});

describe("determinism", () => {
  it("produces the same ids on a second, independent run", async () => {
    const other = await createTestDatabase();
    try {
      const again = await seedDemoWorkspace(other);
      expect(again.workspaceId).toBe(seed.workspaceId);
      expect(again.users).toEqual(seed.users);
      expect(again.teams).toEqual(seed.teams);
      expect(again.projects).toEqual(seed.projects);
    } finally {
      await other.close();
    }
  });

  it("produces ids the application's own guards accept", async () => {
    // Hand-written ids like `iss_demo_eng_1` would be stable and would fail
    // `isId`, making the seeded data the one data set the boundary checks
    // reject.
    expect(isId(seed.workspaceId, "wsp")).toBe(true);
    expect(isId(seed.users.owner, "usr")).toBe(true);
    expect(isId(seed.teams.eng, "tem")).toBe(true);
    expect(isId(seed.projects.sync, "prj")).toBe(true);

    const issues = await repos.issues.list({ workspaceId: seed.workspaceId });
    expect(issues.every((issue) => isId(issue.id, "iss"))).toBe(true);
  });

  it("is idempotent: a second run against the same database writes nothing", async () => {
    const before = await repos.issues.count({ workspaceId: seed.workspaceId });
    const again = await seedDemoWorkspace(db);
    expect(again.created).toBe(false);
    expect(again.workspaceId).toBe(seed.workspaceId);
    expect(await repos.issues.count({ workspaceId: seed.workspaceId })).toBe(before);
  });

  it("takes its base date from the caller", async () => {
    const other = await createTestDatabase();
    try {
      await seedDemoWorkspace(other, { now: "2030-01-01T00:00:00.000Z", urlKey: "later" });
      const otherRepos = createRepositories(other);
      const workspace = await otherRepos.workspaces.byUrlKey("later");
      const issues = await otherRepos.issues.list({ workspaceId: workspace!.id });
      expect(issues.every((issue) => issue.createdAt < "2030-01-02")).toBe(true);
      expect(issues.some((issue) => issue.createdAt > "2029-11-01")).toBe(true);
    } finally {
      await other.close();
    }
  });
});

describe("the workspace", () => {
  it("has four accounts at four permission levels, all on one password", async () => {
    const members = await repos.workspaces.listMembers(seed.workspaceId);
    expect(members.map((m) => `${m.user.email}:${m.role}`).sort()).toEqual([
      "admin@demo.test:admin",
      "guest@demo.test:guest",
      "member@demo.test:member",
      "owner@demo.test:owner",
    ]);
    expect(DEMO_PASSWORD).toBe("demo1234");

    const hashes = await db.query<{ password_hash: string }>(
      `select password_hash from users`,
    );
    // Every account is hashed, and none of them stores the plaintext.
    expect(hashes).toHaveLength(4);
    expect(hashes.every((row) => !row.password_hash.includes(DEMO_PASSWORD))).toBe(true);
  });

  it("accepts an injected hasher, because the auth slice owns the format", async () => {
    const other = await createTestDatabase();
    try {
      await seedDemoWorkspace(other, {
        urlKey: "hashed",
        hashPassword: async (plain, email) => `custom:${email}:${plain.length}`,
      });
      const rows = await other.query<{ password_hash: string }>(
        `select password_hash from users where email = 'owner@demo.test'`,
      );
      expect(rows[0]?.password_hash).toBe("custom:owner@demo.test:8");
    } finally {
      await other.close();
    }
  });

  it("has three teams, one of them private", async () => {
    const teams = await repos.teams.listForWorkspace(seed.workspaceId);
    expect(teams.map((team) => team.key).sort()).toEqual(["DES", "ENG", "OPS"]);
    expect(teams.filter((team) => team.private).map((t) => t.key)).toEqual(["DES"]);
  });

  it("puts the guest in exactly one team, and not the private one", async () => {
    // This is what the permission journey asserts against.
    const guestId = seed.users.guest;
    const visible = await repos.teams.listForUser(seed.workspaceId, guestId);
    expect(visible.map((team) => team.key)).toEqual(["ENG"]);

    const design = await repos.teams.byKey(seed.workspaceId, "DES");
    const designMembers = await repos.teams.listMembers(design!.id);
    expect(designMembers.map((m) => m.userId)).not.toContain(guestId);
  });

  it("gives the guest exactly one project to edit", async () => {
    const projects = await repos.projects.listForUser(
      seed.workspaceId,
      seed.users.guest,
    );
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe("Onboarding Revamp");
  });

  it("enables triage on one team only", async () => {
    const teams = await repos.teams.listForWorkspace(seed.workspaceId);
    expect(teams.filter((team) => team.triageEnabled).map((t) => t.key)).toEqual(["ENG"]);
    const eng = teams.find((team) => team.key === "ENG")!;
    expect((await repos.teams.listStates(eng.id)).some((s) => s.type === "triage")).toBe(
      true,
    );
  });
});

/**
 * The seeded dependency web, read back the way the DAG page reads it.
 *
 * The seed's own comment claims the relations demonstrate four things; these
 * are three of them checked against the query that will actually draw them, and
 * the fourth — the cross-team edge into a private team — checked from both
 * sides, because "the owner sees it and the member does not" is the only part
 * of the fixture that is a security claim rather than a layout one.
 */
describe("the dependency web", () => {
  async function graphFor(userId: string) {
    const eng = await repos.teams.byKey(seed.workspaceId, "ENG");
    const visible = await repos.teams.listForUser(seed.workspaceId, userId);
    return repos.issues.dependencyGraph({
      teamId: eng!.id,
      visibleTeamIds: visible.map((team) => team.id),
      maxNodes: 500,
    });
  }

  it("draws a connected web rather than a scattering of pairs", async () => {
    const graph = await graphFor(seed.users.owner);
    expect(graph.relations.length).toBeGreaterThanOrEqual(7);
    expect(graph.truncated).toBe(false);
    // Issues with no dependency at all are the majority, and are counted
    // rather than drawn.
    expect(graph.isolatedCount).toBeGreaterThan(0);
  });

  it("stores every relation once, in the blocks direction", async () => {
    const graph = await graphFor(seed.users.owner);
    expect(graph.relations.every((r) => r.type === "blocks")).toBe(true);
  });

  it("shows the owner the Design issue that blocks an Engineering one", async () => {
    const graph = await graphFor(seed.users.owner);
    expect(graph.issues.some((issue) => issue.teamKey === "DES")).toBe(true);
  });

  /**
   * The member is not in Design, which is private. The chain has to end at the
   * boundary — not continue through a hidden node, and not report a placeholder
   * that would confirm one exists.
   */
  it("ends the chain at the private team for a member who is not in it", async () => {
    const graph = await graphFor(seed.users.member);
    expect(graph.issues.some((issue) => issue.teamKey === "DES")).toBe(false);
    for (const relation of graph.relations) {
      const ends = new Set(graph.issues.map((issue) => issue.id));
      expect(ends.has(relation.issueId)).toBe(true);
      expect(ends.has(relation.relatedIssueId)).toBe(true);
    }
  });
});

describe("the issues", () => {
  it("has forty of them, numbered per team from one", async () => {
    const issues = await repos.issues.list({
      workspaceId: seed.workspaceId,
      filter: { includeArchived: true, includeSubIssues: true },
      limit: 500,
    });
    expect(issues).toHaveLength(40);
    expect(seed.issueCount).toBe(40);

    for (const key of ["ENG", "DES", "OPS"]) {
      const team = await repos.teams.byKey(seed.workspaceId, key);
      const mine = issues
        .filter((issue) => issue.teamId === team!.id)
        .map((issue) => issue.number)
        .sort((a, b) => a - b);
      expect(mine[0]).toBe(1);
      expect(mine.at(-1)).toBe(mine.length);
      // The counter has to agree, or the next created issue collides.
      expect(team!.issueCounter).toBe(mine.length);
    }
  });

  it("continues the numbering when a new issue is created", async () => {
    const eng = await repos.teams.byKey(seed.workspaceId, "ENG");
    const created = await repos.issues.create(
      { teamId: eng!.id, title: "Filed after the seed", creatorId: seed.users.owner },
      seed.users.owner,
    );
    expect(created.number).toBe(eng!.issueCounter + 1);
    expect(created.identifier).toBe(`ENG-${created.number}`);
    await repos.issues.purge(created.id, seed.users.owner);
  });

  it("covers every workflow state type", async () => {
    const issues = await repos.issues.list({
      workspaceId: seed.workspaceId,
      filter: { includeArchived: true, includeSubIssues: true },
      limit: 500,
    });
    const types = new Set(issues.map((issue) => issue.state.type));
    expect([...types].sort()).toEqual([
      "backlog",
      "canceled",
      "completed",
      "started",
      "triage",
      "unstarted",
    ]);
  });

  it("obeys the category-transition rule it was written with", async () => {
    const issues = await repos.issues.list({
      workspaceId: seed.workspaceId,
      filter: { includeArchived: true, includeSubIssues: true },
      limit: 500,
    });
    for (const issue of issues) {
      if (issue.state.type === "completed") {
        expect(issue.completedAt).not.toBeNull();
        expect(issue.startedAt).not.toBeNull();
      } else {
        expect(issue.completedAt).toBeNull();
      }
      expect(issue.canceledAt === null).toBe(issue.state.type !== "canceled");
    }
  });

  it("gives every issue a distinct order key inside its team", async () => {
    const eng = await repos.teams.byKey(seed.workspaceId, "ENG");
    const issues = await repos.issues.list({
      workspaceId: seed.workspaceId,
      filter: { teamIds: [eng!.id], includeArchived: true, includeSubIssues: true },
      limit: 500,
    });
    const keys = issues.map((issue) => issue.sortOrder);
    expect(new Set(keys).size).toBe(keys.length);
    // Bulk-allocated in one pass, so they stay short.
    expect(Math.max(...keys.map((key) => key.length))).toBeLessThanOrEqual(4);
    expect([...keys].sort(compareOrderKeys)).toEqual(keys);
  });

  it("has unassigned issues and issues with no project", async () => {
    // Both are the states a naive list query gets wrong.
    const unassigned = await repos.issues.count({
      workspaceId: seed.workspaceId,
      filter: { assigneeIds: [null] },
    });
    const unplanned = await repos.issues.count({
      workspaceId: seed.workspaceId,
      filter: { projectIds: [null] },
    });
    expect(unassigned).toBeGreaterThan(0);
    expect(unplanned).toBeGreaterThan(0);
  });

  it("labels issues from both the workspace and the team sets", async () => {
    const labels = await repos.labels.listForWorkspace(
      seed.workspaceId,
      seed.teams.eng,
    );
    expect(labels.map((label) => label.name)).toEqual(
      expect.arrayContaining(["Bug", "Feature", "Backend", "Frontend"]),
    );

    const bug = labels.find((label) => label.name === "Bug")!;
    const tagged = await repos.issues.count({
      workspaceId: seed.workspaceId,
      filter: { labelIds: [bug.id] },
    });
    expect(tagged).toBeGreaterThan(0);
  });

  it("is searchable by text and by identifier", async () => {
    const byText = await repos.issues.list({
      workspaceId: seed.workspaceId,
      filter: { query: "cursor" },
    });
    expect(byText.length).toBeGreaterThan(0);
    expect(await repos.issues.byIdentifier(seed.workspaceId, "ENG-1")).not.toBeNull();
  });
});

describe("the feed", () => {
  it("gives every issue a creation entry, and some a history", async () => {
    const issues = await repos.issues.list({
      workspaceId: seed.workspaceId,
      filter: { includeArchived: true, includeSubIssues: true },
      limit: 500,
    });

    let withHistory = 0;
    for (const issue of issues) {
      const feed = await repos.activity.listForIssue(issue.id);
      expect(feed[0]?.type).toBe("issue_created");
      // Oldest first, matching the detail pane.
      const times = feed.map((entry) => entry.createdAt);
      expect([...times].sort()).toEqual(times);
      if (feed.length > 1) withHistory += 1;
    }
    expect(withHistory).toBeGreaterThan(20);
  });

  it("carries both sides of a state change, with labels", async () => {
    const issues = await repos.issues.list({
      workspaceId: seed.workspaceId,
      filter: { stateTypes: ["started"] },
      limit: 10,
    });
    const feed = await repos.activity.listForIssue(issues[0]!.id);
    const change = feed.find((entry) => entry.type === "state_changed");
    expect(change?.payload["fromLabel"]).toBe("Backlog");
    expect(typeof change?.payload["toId"]).toBe("string");
    expect(typeof change?.payload["toLabel"]).toBe("string");
  });

  it("has threaded comments with their authors", async () => {
    const rows = await db.query<{ issue_id: string }>(
      `select distinct issue_id from comments where parent_id is not null`,
    );
    expect(rows.length).toBeGreaterThan(0);

    const comments = await repos.comments.listForIssue(rows[0]!.issue_id);
    expect(comments.length).toBeGreaterThan(1);
    expect(comments.some((comment) => comment.parentId !== null)).toBe(true);
    expect(comments.every((comment) => comment.user.email.endsWith("@demo.test"))).toBe(
      true,
    );
  });

  it("has unread notifications for someone other than the owner", async () => {
    expect(await repos.notifications.unreadCount(seed.users.member)).toBeGreaterThan(0);
    const inbox = await repos.notifications.listForUser(seed.users.member);
    expect(inbox.every((n) => n.actorId !== seed.users.member)).toBe(true);
  });
});

describe("the projects", () => {
  it("has four, with milestones and a lead who is a member", async () => {
    const projects = await repos.projects.listForWorkspace(seed.workspaceId);
    expect(projects).toHaveLength(4);

    for (const project of projects) {
      const milestones = await repos.projects.listMilestones(project.id);
      expect(milestones.length).toBeGreaterThanOrEqual(2);
      expect([...milestones].sort((a, b) => compareOrderKeys(a.sortOrder, b.sortOrder))).toEqual(
        milestones,
      );

      const members = await repos.projects.listMembers(project.id);
      expect(members.map((m) => m.userId)).toContain(project.leadId);
    }
  });

  it("has progress that is computed, not stored", async () => {
    const progress = await repos.projects.progress(seed.projects.sync);
    expect(progress.total).toBeGreaterThan(0);
    expect(progress.completed).toBeLessThanOrEqual(progress.total);
  });

  it("records a status update that set the project's health", async () => {
    const updates = await repos.projects.listUpdates(seed.projects.system);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.health).toBe("atRisk");
    expect((await repos.projects.byId(seed.projects.system))?.health).toBe("atRisk");
  });

  it("leaves a planned project without a health, rather than guessing one", async () => {
    expect((await repos.projects.byId(seed.projects.onboarding))?.health).toBeNull();
  });
});

describe("the changefeed", () => {
  it("announces the workspace without replaying four hundred rows", async () => {
    // A client's first poll starts from `latestSeq()`, so seeding one event per
    // row would hand a brand-new client a backlog describing a workspace it is
    // about to load in full anyway.
    const events = await repos.changefeed.since(seed.workspaceId, 0, { limit: 1000 });
    const seeded = events.filter((event) => event.entity === "workspace");
    expect(seeded).toHaveLength(1);
    expect(seeded[0]?.payload["seeded"]).toBe(true);
  });
});
