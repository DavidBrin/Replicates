// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import { PgliteDatabase } from "@/adapters/db/pglite";
import { SCHEMA_SQL } from "@/adapters/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { DEMO_PASSWORD, seedDemoWorkspace } from "@/lib/seed";

/**
 * The seam between the seed and the sign-in path.
 *
 * These two were built by different slices and did not agree on the stored
 * password format: the seed's own scrypt writes `scrypt$N$r$p$salt$hash`,
 * while `verifyPassword` parses `scrypt:N:r:p:keyLength:salt:hash` and refuses
 * anything else. Nothing failed loudly — the demo users existed, appeared in
 * the members table, and simply could not be logged into.
 *
 * The first test is the one that matters: it asserts the property the user
 * actually cares about (a seeded account can sign in), rather than asserting
 * that two format strings match, which would pass again the moment someone
 * changed both in the same wrong direction.
 */

const databases: PgliteDatabase[] = [];

function freshDb(): PgliteDatabase {
  const db = new PgliteDatabase(":memory:", SCHEMA_SQL);
  databases.push(db);
  return db;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe("a seeded account can sign in", () => {
  it("verifies against the real hasher when one is injected", async () => {
    const db = freshDb();
    await db.migrate();
    await seedDemoWorkspace(db, {
      hashPassword: (plain) => hashPassword(plain),
    });

    const rows = await db.query<{ email: string; password_hash: string }>(
      `select email, password_hash from users order by email`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(4);

    for (const row of rows) {
      await expect(
        verifyPassword(DEMO_PASSWORD, row.password_hash),
        `${row.email} cannot sign in with the documented demo password`,
      ).resolves.toBe(true);
    }
  });

  it("rejects the wrong password for every seeded account", async () => {
    // Guards against the opposite failure: a verifier that returns true
    // because it could not parse the hash and fell through.
    const db = freshDb();
    await db.migrate();
    await seedDemoWorkspace(db, {
      hashPassword: (plain) => hashPassword(plain),
    });

    const rows = await db.query<{ password_hash: string }>(
      `select password_hash from users`,
    );
    for (const row of rows) {
      await expect(verifyPassword("wrong-password", row.password_hash)).resolves.toBe(
        false,
      );
    }
  });

  it("does NOT verify under the seed's own fallback hasher", async () => {
    // The regression this file exists for, pinned as a test so nobody
    // "simplifies" `boot.ts` by dropping the injection. If this ever starts
    // passing, the two formats have converged and the injection is redundant —
    // which is a fine outcome, but it should be a deliberate one.
    const db = freshDb();
    await db.migrate();
    await seedDemoWorkspace(db);

    const row = await db.query<{ password_hash: string }>(
      `select password_hash from users limit 1`,
    );
    await expect(verifyPassword(DEMO_PASSWORD, row[0]!.password_hash)).resolves.toBe(
      false,
    );
  });
});

describe("seeding is idempotent", () => {
  it("recognises an existing workspace and writes nothing", async () => {
    const db = freshDb();
    await db.migrate();

    const first = await seedDemoWorkspace(db, {
      hashPassword: (plain) => hashPassword(plain),
    });
    expect(first.created).toBe(true);

    const second = await seedDemoWorkspace(db, {
      hashPassword: (plain) => hashPassword(plain),
    });
    expect(second.created).toBe(false);
    expect(second.workspaceId).toBe(first.workspaceId);

    const issues = await db.query<{ count: string }>(
      `select count(*)::text as count from issues`,
    );
    expect(Number(issues[0]!.count)).toBe(first.issueCount);
  });
});
