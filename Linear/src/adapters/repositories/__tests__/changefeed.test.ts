// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlDatabase } from "@/adapters/db/driver";
import { createRepositories } from "@/adapters/repositories";
import type { Repositories } from "@/ports/repositories";

import { createTestDatabase, createUser, fixedClock } from "./harness";

/**
 * The changefeed — the whole realtime story on a host with nowhere to put a
 * broker.
 *
 * What has to be true for a 15-second cursor poll to converge: every event a
 * client has not seen comes back exactly once, in order, and nothing from
 * another workspace comes back at all.
 */

let db: SqlDatabase;
let repos: Repositories;
let workspaceId: string;
let otherWorkspaceId: string;
let teamId: string;
let owner: string;
const clock = fixedClock();

beforeAll(async () => {
  db = await createTestDatabase();
  repos = createRepositories(db, clock.clock);
  owner = await createUser(db, "owner@feed.test", "Owner");

  const workspace = await repos.workspaces.create({ name: "Feed", ownerId: owner });
  workspaceId = workspace.id;
  const other = await repos.workspaces.create({ name: "Other Feed", ownerId: owner });
  otherWorkspaceId = other.id;

  const team = await repos.teams.create(
    { workspaceId, name: "Engineering", key: "ENG" },
    owner,
  );
  teamId = team.id;
});

afterAll(async () => {
  await db.close();
});

describe("cursors", () => {
  it("returns everything after the cursor, oldest first", async () => {
    const from = await repos.changefeed.latestSeq(workspaceId);
    const ids = ["one", "two", "three"];
    for (const id of ids) {
      await repos.changefeed.append({
        workspaceId,
        entity: "issue",
        entityId: `iss_${id}`,
        action: "create",
        actorId: owner,
      });
    }

    const batch = await repos.changefeed.since(workspaceId, from);
    expect(batch.map((event) => event.entityId)).toEqual([
      "iss_one",
      "iss_two",
      "iss_three",
    ]);
    // Strictly after: polling again with the last seq returns nothing, so an
    // event is delivered exactly once rather than replayed on every poll.
    expect(await repos.changefeed.since(workspaceId, batch.at(-1)!.seq)).toHaveLength(0);
  });

  it("is monotonic within a workspace", async () => {
    const events = await repos.changefeed.since(workspaceId, 0);
    const seqs = events.map((event) => event.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });

  it("never leaks another workspace's events", async () => {
    await repos.changefeed.append({
      workspaceId: otherWorkspaceId,
      entity: "issue",
      entityId: "iss_elsewhere",
      action: "create",
    });
    const here = await repos.changefeed.since(workspaceId, 0);
    expect(here.map((event) => event.entityId)).not.toContain("iss_elsewhere");
  });

  it("gives a client with no state the whole retained feed", async () => {
    // A first poll has nothing to be inconsistent with, so seq 0 is the correct
    // starting cursor rather than a special case.
    const all = await repos.changefeed.since(workspaceId, 0);
    expect(all.length).toBeGreaterThan(0);
    expect(all[0]?.workspaceId).toBe(workspaceId);
  });

  it("caps a batch so a client that fell far behind catches up over several polls", async () => {
    for (let index = 0; index < 12; index += 1) {
      await repos.changefeed.append({
        workspaceId: otherWorkspaceId,
        entity: "issue",
        entityId: `iss_bulk_${index}`,
        action: "update",
      });
    }
    const capped = await repos.changefeed.since(otherWorkspaceId, 0, { limit: 5 });
    expect(capped).toHaveLength(5);

    const next = await repos.changefeed.since(otherWorkspaceId, capped.at(-1)!.seq, {
      limit: 5,
    });
    expect(next[0]!.seq).toBeGreaterThan(capped.at(-1)!.seq);
  });

  it("reports the latest sequence, and zero for a workspace with no events", async () => {
    const fresh = await repos.workspaces.create({ name: "Silent", ownerId: owner });
    // A workspace's creation is itself an event, so "no events" means a
    // workspace id that has never appeared — not a freshly created one.
    expect(await repos.changefeed.latestSeq("wsp_nothing")).toBe(0);
    expect(await repos.changefeed.latestSeq(fresh.id)).toBeGreaterThan(0);
  });
});

describe("payloads", () => {
  it("round-trips a JSON payload", async () => {
    const event = await repos.changefeed.append({
      workspaceId,
      entity: "issue",
      entityId: "iss_payload",
      action: "update",
      actorId: owner,
      payload: { fields: ["title", "priority"], nested: { ok: true } },
    });
    const [read] = await repos.changefeed.since(workspaceId, event.seq - 1, {
      limit: 1,
    });
    expect(read?.payload).toEqual({
      fields: ["title", "priority"],
      nested: { ok: true },
    });
  });

  it("defaults the payload and the actor rather than rejecting them", async () => {
    const event = await repos.changefeed.append({
      workspaceId,
      entity: "label",
      entityId: "lbl_minimal",
      action: "delete",
    });
    expect(event.payload).toEqual({});
    expect(event.actorId).toBeNull();
  });
});

describe("what a poll sees after real work", () => {
  it("describes an issue's whole life", async () => {
    const from = await repos.changefeed.latestSeq(workspaceId);
    const issue = await repos.issues.create(
      { teamId, title: "Tracked", creatorId: owner },
      owner,
    );
    await repos.issues.update(issue.id, { title: "Tracked, renamed" }, owner);
    await repos.issues.archive(issue.id, owner);
    await repos.issues.trash(issue.id, owner);

    const events = (await repos.changefeed.since(workspaceId, from)).filter(
      (event) => event.entityId === issue.id,
    );
    expect(events.map((event) => event.action)).toEqual([
      "create",
      "update",
      "update",
      "delete",
    ]);
    expect(events.every((event) => event.entity === "issue")).toBe(true);
    expect(events.every((event) => event.actorId === owner)).toBe(true);
  });
});
