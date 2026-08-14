// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlDatabase } from "@/adapters/db/driver";
import { createRepositories } from "@/adapters/repositories";
import { compareOrderKeys } from "@/domain/ordering";
import type { Repositories } from "@/ports/repositories";

import { createTestDatabase, createUser, fixedClock } from "./harness";

let db: SqlDatabase;
let repos: Repositories;
let workspaceId: string;
let teamId: string;
let owner: string;
let member: string;
let guest: string;
const clock = fixedClock();

beforeAll(async () => {
  db = await createTestDatabase();
  repos = createRepositories(db, clock.clock);
  owner = await createUser(db, "owner@prj.test", "Owner");
  member = await createUser(db, "member@prj.test", "Member");
  guest = await createUser(db, "guest@prj.test", "Guest");

  const workspace = await repos.workspaces.create({ name: "Projects", ownerId: owner });
  workspaceId = workspace.id;
  await repos.workspaces.addMember(workspaceId, member, "member");
  await repos.workspaces.addMember(workspaceId, guest, "guest");
  const team = await repos.teams.create(
    { workspaceId, name: "Engineering", key: "ENG" },
    owner,
  );
  teamId = team.id;
});

afterAll(async () => {
  await db.close();
});

describe("creating a project", () => {
  it("slugs the name with a stable token appended", async () => {
    const project = await repos.projects.create(
      { workspaceId, name: "Realtime Sync" },
      owner,
    );
    // The token is what keeps a URL working across a rename and what stops two
    // projects called "Q1 Planning" colliding on the unique index.
    expect(project.slugId).toMatch(/^realtime-sync-[0-9a-z]{12}$/);
    expect((await repos.projects.bySlug(workspaceId, project.slugId))?.id).toBe(
      project.id,
    );

    await repos.projects.update(project.id, { name: "Realtime Sync v2" }, owner);
    expect((await repos.projects.bySlug(workspaceId, project.slugId))?.name).toBe(
      "Realtime Sync v2",
    );
  });

  it("makes the lead a member", async () => {
    const project = await repos.projects.create(
      { workspaceId, name: "Led", leadId: member, memberIds: [owner] },
      owner,
    );
    const members = await repos.projects.listMembers(project.id);
    expect(members[0]).toEqual(expect.objectContaining({ userId: member, role: "lead" }));
    expect(members.map((m) => m.userId).sort()).toEqual([owner, member].sort());
  });

  it("prepends new projects, like issues", async () => {
    const first = await repos.projects.create({ workspaceId, name: "Older" }, owner);
    const second = await repos.projects.create({ workspaceId, name: "Newer" }, owner);
    expect(compareOrderKeys(second.sortOrder, first.sortOrder)).toBe(-1);
  });

  it("attaches teams", async () => {
    const project = await repos.projects.create(
      { workspaceId, name: "Teamed", teamIds: [teamId] },
      owner,
    );
    expect(await repos.projects.listTeams(project.id)).toEqual([teamId]);

    await repos.projects.removeTeam(project.id, teamId, owner);
    expect(await repos.projects.listTeams(project.id)).toEqual([]);
  });
});

describe("state and health", () => {
  it("stamps completedAt on entering completed and clears it on leaving", async () => {
    // The same entering/leaving rule the issues use, one level up.
    const project = await repos.projects.create({ workspaceId, name: "Closing" }, owner);
    expect(project.completedAt).toBeNull();

    const done = await repos.projects.update(project.id, { state: "completed" }, owner);
    expect(done.completedAt).not.toBeNull();

    const reopened = await repos.projects.update(project.id, { state: "started" }, owner);
    expect(reopened.completedAt).toBeNull();
  });

  it("changes health only through an update post", async () => {
    // Health is the lead's judgement, never derived from the issue list.
    const project = await repos.projects.create(
      { workspaceId, name: "Health", leadId: owner },
      owner,
    );
    expect(project.health).toBeNull();

    await repos.projects.postUpdate({
      projectId: project.id,
      userId: owner,
      body: "Slipping on the audit.",
      health: "atRisk",
    });

    expect((await repos.projects.byId(project.id))?.health).toBe("atRisk");
    const updates = await repos.projects.listUpdates(project.id);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.body).toContain("Slipping");
  });
});

describe("milestones", () => {
  it("appends and reorders by fractional index", async () => {
    const project = await repos.projects.create(
      { workspaceId, name: "Milestoned" },
      owner,
    );
    const first = await repos.projects.createMilestone(
      { projectId: project.id, name: "Alpha" },
      owner,
    );
    const second = await repos.projects.createMilestone(
      { projectId: project.id, name: "Beta" },
      owner,
    );
    expect(compareOrderKeys(first.sortOrder, second.sortOrder)).toBe(-1);
    expect((await repos.projects.listMilestones(project.id)).map((m) => m.name)).toEqual(
      ["Alpha", "Beta"],
    );
  });

  it("releases its issues rather than deleting them", async () => {
    const project = await repos.projects.create({ workspaceId, name: "Released" }, owner);
    const milestone = await repos.projects.createMilestone(
      { projectId: project.id, name: "Ship" },
      owner,
    );
    const issue = await repos.issues.create(
      {
        teamId,
        title: "Scoped",
        creatorId: owner,
        projectId: project.id,
        milestoneId: milestone.id,
      },
      owner,
    );

    await repos.projects.deleteMilestone(milestone.id, owner);
    const after = await repos.issues.byId(issue.id);
    expect(after).not.toBeNull();
    expect(after?.milestoneId).toBeNull();
    expect(after?.projectId).toBe(project.id);
  });

  it("drops the milestone when an issue leaves the project", async () => {
    // A milestone belongs to a project; keeping it would leave the issue
    // pointing at a marker on a board it is no longer on.
    const project = await repos.projects.create({ workspaceId, name: "Leaving" }, owner);
    const milestone = await repos.projects.createMilestone(
      { projectId: project.id, name: "Phase" },
      owner,
    );
    const issue = await repos.issues.create(
      {
        teamId,
        title: "Moving on",
        creatorId: owner,
        projectId: project.id,
        milestoneId: milestone.id,
      },
      owner,
    );

    const moved = await repos.issues.update(issue.id, { projectId: null }, owner);
    expect(moved.projectId).toBeNull();
    expect(moved.milestoneId).toBeNull();
  });
});

describe("progress", () => {
  it("counts and sums instead of storing a rollup", async () => {
    const project = await repos.projects.create({ workspaceId, name: "Counted" }, owner);
    const states = await repos.teams.listStates(teamId);
    const done = states.find((state) => state.type === "completed")!;
    const doing = states.find((state) => state.type === "started")!;

    const created = await repos.issues.createMany(
      [
        { teamId, title: "One", creatorId: owner, projectId: project.id, estimate: 3 },
        { teamId, title: "Two", creatorId: owner, projectId: project.id, estimate: 5 },
        { teamId, title: "Three", creatorId: owner, projectId: project.id },
      ],
      owner,
    );
    await repos.issues.update(created[0]!.id, { stateId: done.id }, owner);
    await repos.issues.update(created[1]!.id, { stateId: doing.id }, owner);

    const progress = await repos.projects.progress(project.id);
    expect(progress).toMatchObject({
      total: 3,
      completed: 1,
      started: 1,
      canceled: 0,
      scope: 8,
      completedScope: 3,
    });
  });

  it("reports no scope rather than zero when nothing is estimated", async () => {
    const project = await repos.projects.create({ workspaceId, name: "Unsized" }, owner);
    await repos.issues.create(
      { teamId, title: "Unsized", creatorId: owner, projectId: project.id },
      owner,
    );
    expect((await repos.projects.progress(project.id)).scope).toBeNull();
  });
});

describe("visibility", () => {
  it("shows a guest only the projects they were added to", async () => {
    const scope = await repos.workspaces.create({ name: "Guarded", ownerId: owner });
    await repos.workspaces.addMember(scope.id, guest, "guest");
    await repos.workspaces.addMember(scope.id, member, "member");

    const open = await repos.projects.create({ workspaceId: scope.id, name: "Open" }, owner);
    const shared = await repos.projects.create(
      { workspaceId: scope.id, name: "Shared", memberIds: [guest] },
      owner,
    );

    expect((await repos.projects.listForUser(scope.id, guest)).map((p) => p.id)).toEqual([
      shared.id,
    ]);
    // A full member sees both — project membership only ever *adds* access.
    expect(
      (await repos.projects.listForUser(scope.id, member)).map((p) => p.id).sort(),
    ).toEqual([open.id, shared.id].sort());
  });

  it("hides an archived project from the list but keeps the row", async () => {
    const project = await repos.projects.create({ workspaceId, name: "Archived" }, owner);
    await repos.projects.archive(project.id, owner);
    const listed = await repos.projects.listForWorkspace(workspaceId);
    expect(listed.map((p) => p.id)).not.toContain(project.id);
    expect(await repos.projects.byId(project.id)).not.toBeNull();
  });
});

describe("deleting a project", () => {
  it("releases its issues rather than deleting them", async () => {
    const project = await repos.projects.create({ workspaceId, name: "Dissolving" }, owner);
    const issue = await repos.issues.create(
      { teamId, title: "Surviving", creatorId: owner, projectId: project.id },
      owner,
    );
    await repos.projects.delete(project.id, owner);

    const after = await repos.issues.byId(issue.id);
    expect(after).not.toBeNull();
    expect(after?.projectId).toBeNull();
  });

  it("clears the lead when the lead leaves", async () => {
    const project = await repos.projects.create(
      { workspaceId, name: "Leaderless", leadId: member },
      owner,
    );
    await repos.projects.removeMember(project.id, member, owner);
    expect((await repos.projects.byId(project.id))?.leadId).toBeNull();
  });
});
