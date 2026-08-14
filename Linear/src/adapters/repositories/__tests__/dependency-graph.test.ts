// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SqlDatabase } from "@/adapters/db/driver";
import type { IssueWithRelations } from "@/domain/entities";

import {
  createFixture,
  createTestDatabase,
  fixedClock,
  type Fixture,
} from "./harness";

/**
 * `IssueRepository.dependencyGraph`, against a real Postgres.
 *
 * The recursive CTE is the reason this file exists. It is the one query in the
 * repository with no `limit` implied by its shape, it walks a relation that can
 * be cyclic, and it carries the visibility rule *inside* the recursion — three
 * things that typecheck perfectly while being wrong, and that a mocked executor
 * would happily confirm.
 *
 * Each test builds its own team so that `isolatedCount`, which counts every
 * live issue in a team, is not a running total of everything the file has
 * created.
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

let counter = 0;

/** A fresh team, so each test's counts are its own. */
async function team(options: { private?: boolean } = {}) {
  counter += 1;
  return fx.repos.teams.create(
    {
      workspaceId: fx.workspaceId,
      name: `Team ${counter}`,
      key: `T${counter}`,
      ...(options.private === true ? { private: true } : {}),
    },
    fx.ownerId,
  );
}

async function issue(teamId: string, title: string): Promise<IssueWithRelations> {
  return fx.repos.issues.create(
    { teamId, title, creatorId: fx.ownerId },
    fx.ownerId,
  );
}

function blocks(blocker: IssueWithRelations, blocked: IssueWithRelations) {
  return fx.repos.issues.addRelation(blocker.id, blocked.id, "blocks", fx.ownerId);
}

function graph(teamId: string, visible: string[], maxNodes = 100) {
  return fx.repos.issues.dependencyGraph({
    teamId,
    visibleTeamIds: visible,
    maxNodes,
  });
}

describe("dependencyGraph", () => {
  it("returns the chain and leaves the unrelated issues out of it", async () => {
    const t = await team();
    const a = await issue(t.id, "A");
    const b = await issue(t.id, "B");
    await issue(t.id, "Alone");
    await blocks(a, b);

    const result = await graph(t.id, [t.id]);
    expect(result.issues.map((i) => i.title).sort()).toEqual(["A", "B"]);
    expect(result.isolatedCount).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.relations).toHaveLength(1);
  });

  it("walks a chain several hops long", async () => {
    const t = await team();
    const issues = [];
    for (const title of ["1", "2", "3", "4", "5"]) {
      issues.push(await issue(t.id, title));
    }
    for (let i = 1; i < issues.length; i += 1) {
      await blocks(issues[i - 1]!, issues[i]!);
    }

    const result = await graph(t.id, [t.id]);
    expect(result.issues).toHaveLength(5);
    expect(result.relations).toHaveLength(4);
  });

  it("reports relations as stored, without flipping them", async () => {
    const t = await team();
    const a = await issue(t.id, "Blocker");
    const b = await issue(t.id, "Blocked");
    await fx.repos.issues.addRelation(b.id, a.id, "blocked_by", fx.ownerId);

    const result = await graph(t.id, [t.id]);
    expect(result.relations).toEqual([
      { issueId: b.id, relatedIssueId: a.id, type: "blocked_by" },
    ]);
  });

  /**
   * `union`, not `union all`. With `union all` the visited set does not exist
   * and this query never returns — the first cyclic dependency anybody creates
   * would hang the page rather than draw a red arrow.
   */
  it("terminates on a cycle", async () => {
    const t = await team();
    const a = await issue(t.id, "A");
    const b = await issue(t.id, "B");
    const c = await issue(t.id, "C");
    await blocks(a, b);
    await blocks(b, c);
    await blocks(c, a);

    const result = await graph(t.id, [t.id]);
    expect(result.issues).toHaveLength(3);
    expect(result.relations).toHaveLength(3);
  });

  it("ignores relations that are not blocking", async () => {
    const t = await team();
    const a = await issue(t.id, "A");
    const b = await issue(t.id, "B");
    await fx.repos.issues.addRelation(a.id, b.id, "related", fx.ownerId);

    const result = await graph(t.id, [t.id]);
    expect(result.issues).toEqual([]);
    expect(result.isolatedCount).toBe(2);
  });

  it("leaves out an issue that has been trashed", async () => {
    const t = await team();
    const a = await issue(t.id, "A");
    const b = await issue(t.id, "B");
    await blocks(a, b);
    await fx.repos.issues.trash(b.id, fx.ownerId);

    const result = await graph(t.id, [t.id]);
    // `a` still has a relation row, so it is not isolated — but the issue on
    // the other end is gone, so there is no edge left to draw it with.
    expect(result.issues.map((i) => i.title)).toEqual(["A"]);
    expect(result.relations).toEqual([]);
  });

  describe("crossing team boundaries", () => {
    it("follows a chain into another visible team", async () => {
      const here = await team();
      const there = await team();
      const a = await issue(here.id, "Ours");
      const b = await issue(there.id, "Theirs");
      await blocks(b, a);

      const result = await graph(here.id, [here.id, there.id]);
      expect(result.issues.map((i) => i.title).sort()).toEqual([
        "Ours",
        "Theirs",
      ]);
      expect(result.issues[0]!.teamKey).toBe(here.key);
    });

    it("stops at the boundary of a team the viewer cannot see", async () => {
      const here = await team();
      const hidden = await team({ private: true });
      const a = await issue(here.id, "Ours");
      const secret = await issue(hidden.id, "Secret");
      await blocks(secret, a);

      const result = await graph(here.id, [here.id]);
      expect(result.issues.map((i) => i.title)).toEqual(["Ours"]);
      expect(result.relations).toEqual([]);
    });

    /**
     * The reason the visibility predicate is inside the recursion rather than
     * applied to the result.
     *
     * `Ours` and `Also ours` are joined only through an issue in a team the
     * viewer cannot see. Filtering afterwards would drop the middle node and
     * keep the two visible ones — telling the viewer they are connected, and
     * that there is exactly one hop between them, which is a fact about a
     * private team's contents. Refusing to traverse it means they arrive as two
     * unrelated issues, which is what someone without access should see.
     */
    it("does not let an invisible issue act as a bridge", async () => {
      const here = await team();
      const hidden = await team({ private: true });
      const left = await issue(here.id, "Ours");
      const middle = await issue(hidden.id, "Bridge");
      const right = await issue(here.id, "Also ours");
      await blocks(left, middle);
      await blocks(middle, right);

      const result = await graph(here.id, [here.id]);
      expect(result.issues.map((i) => i.title).sort()).toEqual([
        "Also ours",
        "Ours",
      ]);
      expect(result.relations).toEqual([]);
    });

    it("draws nothing when no team is visible", async () => {
      const t = await team();
      const a = await issue(t.id, "A");
      const b = await issue(t.id, "B");
      await blocks(a, b);

      const result = await graph(t.id, []);
      expect(result.issues).toEqual([]);
      expect(result.relations).toEqual([]);
    });
  });

  describe("the size cap", () => {
    it("cuts an oversized component and says so", async () => {
      const t = await team();
      const chain = [];
      for (let i = 0; i < 8; i += 1) chain.push(await issue(t.id, `n${i}`));
      for (let i = 1; i < chain.length; i += 1) {
        await blocks(chain[i - 1]!, chain[i]!);
      }

      const result = await graph(t.id, [t.id], 5);
      expect(result.issues).toHaveLength(5);
      expect(result.truncated).toBe(true);
    });

    /**
     * Truncation must not leave an edge pointing at a node that was cut. The
     * layout would either throw on the dangling id or invent a node for it, and
     * inventing one is the worse outcome — a box on screen for an issue nobody
     * asked to see.
     */
    it("keeps only relations whose both ends survived the cut", async () => {
      const t = await team();
      const chain = [];
      for (let i = 0; i < 8; i += 1) chain.push(await issue(t.id, `n${i}`));
      for (let i = 1; i < chain.length; i += 1) {
        await blocks(chain[i - 1]!, chain[i]!);
      }

      const result = await graph(t.id, [t.id], 5);
      const kept = new Set(result.issues.map((i) => i.id));
      for (const relation of result.relations) {
        expect(kept.has(relation.issueId)).toBe(true);
        expect(kept.has(relation.relatedIssueId)).toBe(true);
      }
    });

    it("does not report truncation when the component exactly fits", async () => {
      const t = await team();
      const a = await issue(t.id, "A");
      const b = await issue(t.id, "B");
      await blocks(a, b);

      const result = await graph(t.id, [t.id], 2);
      expect(result.issues).toHaveLength(2);
      expect(result.truncated).toBe(false);
    });
  });

  it("carries what a card needs to render", async () => {
    const t = await team();
    const a = await issue(t.id, "Rendered");
    const b = await issue(t.id, "Other");
    await blocks(a, b);

    const result = await graph(t.id, [t.id]);
    const node = result.issues.find((i) => i.title === "Rendered")!;
    expect(node.identifier).toBe(`${t.key}-${1}`);
    expect(node.teamKey).toBe(t.key);
    expect(node.stateName).toBeTruthy();
    expect(node.stateColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(node.assigneeName).toBeNull();
  });
});
