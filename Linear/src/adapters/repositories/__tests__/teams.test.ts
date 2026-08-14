// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlDatabase } from "@/adapters/db/driver";
import { createRepositories } from "@/adapters/repositories";
import { ConflictError, type Repositories } from "@/ports/repositories";

import { createTestDatabase, createUser, fixedClock } from "./harness";

/**
 * Teams, their workflow states, and the visibility rule that a guest must not
 * be able to see around.
 */

let db: SqlDatabase;
let repos: Repositories;
let workspaceId: string;
let owner: string;
let member: string;
let guest: string;
const clock = fixedClock();

beforeAll(async () => {
  db = await createTestDatabase();
  repos = createRepositories(db, clock.clock);
  owner = await createUser(db, "owner@team.test", "Owner");
  member = await createUser(db, "member@team.test", "Member");
  guest = await createUser(db, "guest@team.test", "Guest");

  const workspace = await repos.workspaces.create({ name: "Teams", ownerId: owner });
  workspaceId = workspace.id;
  await repos.workspaces.addMember(workspaceId, member, "member");
  await repos.workspaces.addMember(workspaceId, guest, "guest");
});

afterAll(async () => {
  await db.close();
});

describe("creating a team", () => {
  it("derives a key from the name and creates the default workflow", async () => {
    const team = await repos.teams.create(
      { workspaceId, name: "Platform Engineering" },
      owner,
    );
    expect(team.key).toBe("PE");

    const states = await repos.teams.listStates(team.id);
    expect(states.map((state) => state.name)).toEqual([
      "Backlog",
      "Todo",
      "In Progress",
      "In Review",
      "Done",
      "Canceled",
      "Duplicate",
    ]);
    // A team with no states cannot hold an issue at all — `issues.state_id` is
    // `not null` — so the failure would land several screens from the cause.
    expect(states.every((state) => state.teamId === team.id)).toBe(true);
  });

  it("creates a Triage state only when the team uses triage", async () => {
    const without = await repos.teams.create({ workspaceId, name: "Quiet" }, owner);
    const with_ = await repos.teams.create(
      { workspaceId, name: "Support Desk", triageEnabled: true },
      owner,
    );
    expect(
      (await repos.teams.listStates(without.id)).some((s) => s.type === "triage"),
    ).toBe(false);
    expect(
      (await repos.teams.listStates(with_.id)).some((s) => s.type === "triage"),
    ).toBe(true);
  });

  it("uniquifies a derived key rather than refusing the creation", async () => {
    // The key was derived from the name; the user never typed it, so failing
    // here would be an error message about something nobody chose.
    const first = await repos.teams.create({ workspaceId, name: "Growth" }, owner);
    const second = await repos.teams.create({ workspaceId, name: "Growth" }, owner);
    expect(first.key).toBe("GRO");
    expect(second.key).not.toBe(first.key);
  });

  it("makes the creator a team admin", async () => {
    const team = await repos.teams.create({ workspaceId, name: "Founded" }, owner);
    const members = await repos.teams.listMembers(team.id);
    expect(members).toEqual([
      expect.objectContaining({ userId: owner, role: "admin" }),
    ]);
  });
});

describe("keys", () => {
  it("is findable case-insensitively", async () => {
    const team = await repos.teams.create(
      { workspaceId, name: "Case", key: "CAS" },
      owner,
    );
    expect((await repos.teams.byKey(workspaceId, "cas"))?.id).toBe(team.id);
  });

  it("renames without rewriting a single issue row", async () => {
    // `identifier` is derived at read time from `team.key` and `issue.number`,
    // so a rename re-labels the whole team at once.
    const team = await repos.teams.create(
      { workspaceId, name: "Renamable", key: "OLD" },
      owner,
    );
    const issue = await repos.issues.create(
      { teamId: team.id, title: "Numbered", creatorId: owner },
      owner,
    );
    expect(issue.identifier).toBe("OLD-1");

    await repos.teams.update(team.id, { key: "NEW" }, owner);
    const after = await repos.issues.byId(issue.id);
    expect(after?.identifier).toBe("NEW-1");
    expect(after?.number).toBe(issue.number);
  });

  it("refuses a key that is taken or malformed", async () => {
    await repos.teams.create({ workspaceId, name: "Taken", key: "TKN" }, owner);
    const other = await repos.teams.create(
      { workspaceId, name: "Other", key: "OTH" },
      owner,
    );
    await expect(
      repos.teams.update(other.id, { key: "TKN" }, owner),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      repos.teams.update(other.id, { key: "TOOLONG" }, owner),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("visibility", () => {
  it("shows a member every public team plus their private ones", async () => {
    const scope = await repos.workspaces.create({ name: "Scoped", ownerId: owner });
    await repos.workspaces.addMember(scope.id, member, "member");
    const open = await repos.teams.create(
      { workspaceId: scope.id, name: "Open", key: "OPN" },
      owner,
    );
    const secret = await repos.teams.create(
      { workspaceId: scope.id, name: "Secret", key: "SEC", private: true },
      owner,
    );

    const visible = await repos.teams.listForUser(scope.id, member);
    expect(visible.map((team) => team.id)).toEqual([open.id]);

    await repos.teams.addMember(secret.id, member, "member");
    const after = await repos.teams.listForUser(scope.id, member);
    expect(after.map((team) => team.id).sort()).toEqual([open.id, secret.id].sort());
  });

  it("shows a guest only the teams they were added to", async () => {
    // Discoverability is decided in the `where` clause. Fetching everything and
    // hiding some leaks through counts, autocomplete, and any endpoint that
    // forgets to apply the filter.
    const scope = await repos.workspaces.create({ name: "Guests", ownerId: owner });
    await repos.workspaces.addMember(scope.id, guest, "guest");
    const open = await repos.teams.create(
      { workspaceId: scope.id, name: "Open", key: "OP2" },
      owner,
    );
    const joined = await repos.teams.create(
      { workspaceId: scope.id, name: "Joined", key: "JND" },
      owner,
    );
    await repos.teams.addMember(joined.id, guest, "member");

    const visible = await repos.teams.listForUser(scope.id, guest);
    expect(visible.map((team) => team.id)).toEqual([joined.id]);
    expect(visible.map((team) => team.id)).not.toContain(open.id);

    // …while the workspace listing still sees both.
    expect(await repos.teams.listForWorkspace(scope.id)).toHaveLength(2);
  });

  it("refuses to make a guest a team admin", async () => {
    const team = await repos.teams.create(
      { workspaceId, name: "No Guest Admins", key: "NGA" },
      owner,
    );
    await expect(
      repos.teams.addMember(team.id, guest, "admin"),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(repos.teams.addMember(team.id, guest, "member")).resolves.toEqual(
      expect.objectContaining({ role: "member" }),
    );
  });
});

describe("workflow states", () => {
  it("picks the first unstarted state as the default", async () => {
    const team = await repos.teams.create({ workspaceId, name: "Defaults" }, owner);
    const fallback = await repos.teams.defaultStateFor(team.id);
    expect(fallback.name).toBe("Todo");
  });

  it("prefers Triage when the team uses it", async () => {
    const team = await repos.teams.create(
      { workspaceId, name: "Triaging", triageEnabled: true },
      owner,
    );
    expect((await repos.teams.defaultStateFor(team.id)).type).toBe("triage");
  });

  it("adds a state at the end of its own type group", async () => {
    const team = await repos.teams.create({ workspaceId, name: "Extended" }, owner);
    const added = await repos.teams.createState({
      teamId: team.id,
      name: "Blocked",
      type: "started",
      color: "#eb5757",
    });
    const states = await repos.teams.listStates(team.id);
    const started = states.filter((state) => state.type === "started");
    expect(started.at(-1)?.id).toBe(added.id);
  });

  it("reassigns a deleted state's issues rather than orphaning them", async () => {
    const team = await repos.teams.create({ workspaceId, name: "Pruned" }, owner);
    const states = await repos.teams.listStates(team.id);
    const doomed = states.find((state) => state.name === "In Review")!;
    const survivor = states.find((state) => state.name === "In Progress")!;

    const issue = await repos.issues.create(
      { teamId: team.id, title: "Homeless", stateId: doomed.id, creatorId: owner },
      owner,
    );
    await repos.teams.deleteState(doomed.id, survivor.id);

    const after = await repos.issues.byId(issue.id);
    expect(after?.stateId).toBe(survivor.id);
    expect(
      (await repos.teams.listStates(team.id)).some((s) => s.id === doomed.id),
    ).toBe(false);
  });

  it("refuses to reassign a state's issues to itself", async () => {
    const team = await repos.teams.create({ workspaceId, name: "Circular" }, owner);
    const state = (await repos.teams.listStates(team.id))[0]!;
    await expect(
      repos.teams.deleteState(state.id, state.id),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("deleting a team", () => {
  it("takes its states, members and issues with it", async () => {
    const team = await repos.teams.create({ workspaceId, name: "Doomed" }, owner);
    const issue = await repos.issues.create(
      { teamId: team.id, title: "Collateral", creatorId: owner },
      owner,
    );
    await repos.teams.delete(team.id, owner);

    expect(await repos.teams.byId(team.id)).toBeNull();
    expect(await repos.issues.byId(issue.id)).toBeNull();
    expect(await repos.teams.listStates(team.id)).toHaveLength(0);
  });
});
