// @vitest-environment node

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { setDbForTests, type SqlDatabase } from "@/adapters/db";
import { getRepositories } from "@/adapters/repositories";
import {
  createFixture,
  createTestDatabase,
  type Fixture,
} from "@/adapters/repositories/__tests__/harness";
import { PATCH as patchIssue } from "@/app/api/issues/[id]/route";
import { createSession, sessionCookieName } from "@/lib/auth/session";

/**
 * One PATCH is one transaction.
 *
 * The handler writes an issue's labels through a join table and its fields
 * through the row, which used to be two independent writes in sequence. The
 * second one can fail — `dueDate` lands in a Postgres `date` column, and a
 * string that is not a date is rejected by the driver — and when it did, the
 * labels were already committed. The caller saw a 500 and got a label change
 * they never asked for: the worst possible pairing, because the optimistic
 * store rolls back what it *thinks* failed, which is all of it.
 *
 * Both halves are covered here, and they are genuinely different tests:
 *
 *  - the **date** is now refused by the request schema, before any write, so
 *    the known trigger produces a 400 that names the field;
 *  - the **transaction** is what covers every trigger nobody has found yet, so
 *    one test forces the field write to throw and asserts the labels went back.
 *
 * A suite with only the first would pass against a handler that validated the
 * date and still wrote twice.
 */

let db: SqlDatabase;
let dispose: () => Promise<void>;
let fixture: Fixture;

let issueId: string;
let labelIds: string[];

beforeAll(async () => {
  db = await createTestDatabase();
  dispose = setDbForTests(db);
  fixture = await createFixture(db);

  const labels = await Promise.all(
    ["Bug", "Chore"].map((name) =>
      fixture.repos.labels.create({
        workspaceId: fixture.workspaceId,
        teamId: fixture.teamId,
        name,
        color: "#ff0000",
      }),
    ),
  );
  labelIds = labels.map((label) => label.id);
}, 60_000);

afterAll(async () => {
  await dispose();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A fresh issue with no labels and no due date, per test. */
beforeEach(async () => {
  const issue = await fixture.repos.issues.create(
    { teamId: fixture.teamId, title: "Ship it", creatorId: fixture.ownerId },
    fixture.ownerId,
  );
  issueId = issue.id;
});

/* ================================================================ helpers = */

async function patch(body: unknown): Promise<Response> {
  const session = await createSession(fixture.ownerId, { db });
  return patchIssue(
    new Request(`http://x/api/issues/${issueId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: `${sessionCookieName()}=${session.token}`,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: issueId }) },
  );
}

/** The labels actually attached to the issue, read from the join table. */
async function storedLabels(): Promise<string[]> {
  const rows = await db.query<{ label_id: string }>(
    "select label_id from issue_labels where issue_id = $1 order by label_id asc",
    [issueId],
  );
  return rows.map((row) => row.label_id);
}

async function storedDueDate(): Promise<string | null> {
  return (await fixture.repos.issues.byId(issueId))?.dueDate ?? null;
}

/* ====================================================== the date, refused = */

describe("a combined patch whose date is not a date", () => {
  it("refuses the whole request rather than committing the labels", async () => {
    const response = await patch({ labelIds, dueDate: "not-a-date" });

    expect(response.status).toBe(400);
    // The half that used to land anyway.
    expect(await storedLabels()).toEqual([]);
    expect(await storedDueDate()).toBeNull();
  });

  it("refuses a date-shaped string that names no real day", async () => {
    const response = await patch({ labelIds, dueDate: "2026-02-31" });

    expect(response.status).toBe(400);
    expect(await storedLabels()).toEqual([]);
  });

  it("refuses a timestamp, which this column is not", async () => {
    const response = await patch({ dueDate: "2026-03-16T09:00:00.000Z" });

    expect(response.status).toBe(400);
  });

  it("still accepts the shape the picker sends", async () => {
    const response = await patch({ labelIds, dueDate: "2026-03-16" });

    expect(response.status).toBe(200);
    expect(await storedLabels()).toEqual([...labelIds].sort());
    expect(await storedDueDate()).toBe("2026-03-16");
  });

  it("still accepts a null, which is how the picker clears it", async () => {
    await patch({ dueDate: "2026-03-16" });

    const response = await patch({ dueDate: null });

    expect(response.status).toBe(200);
    expect(await storedDueDate()).toBeNull();
  });
});

/* ============================================== the transaction, rolled back */

describe("a combined patch whose field write fails for any other reason", () => {
  it("takes the labels back with it", async () => {
    // The route resolves its repositories through `getRepositories()`, which is
    // memoised on the database handle — so this is the same object the handler
    // will reach for. Stubbing the *field* write is the only way to reach the
    // failure path now that the date is validated, and that is the point: the
    // transaction has to cover the failures nobody enumerated.
    const repositories = getRepositories();
    vi.spyOn(repositories.issues, "update").mockRejectedValue(
      new Error("constraint nobody predicted"),
    );

    await expect(patch({ labelIds, title: "Renamed" })).rejects.toThrow(
      "constraint nobody predicted",
    );

    expect(await storedLabels()).toEqual([]);
  });

  it("leaves the title alone too", async () => {
    const repositories = getRepositories();
    vi.spyOn(repositories.issues, "update").mockRejectedValue(new Error("boom"));

    await expect(patch({ labelIds, title: "Renamed" })).rejects.toThrow("boom");

    expect((await fixture.repos.issues.byId(issueId))?.title).toBe("Ship it");
  });
});
