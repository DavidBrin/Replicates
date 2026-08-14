// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import { PgliteDatabase } from "@/adapters/db/pglite";

/**
 * The transaction boundary of the embedded adapter.
 *
 * PGlite is one connection, so "two transactions at once" is not a thing the
 * engine can do — the adapter has to decide what happens instead, and there are
 * only two possible answers for a second `transaction()` call: *queue* (it is an
 * independent unit of work) or *join* (it is nested inside the one already
 * running). Guessing wrong in the joining direction is silent data loss, which
 * is what the first test here is about, so both directions are pinned.
 *
 * The tests use their own one-column table rather than `schema.sql`: nothing
 * here is about the schema, and a full migration costs a second per suite.
 */

const PROBE_SCHEMA = `create table probe (id text primary key);`;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let db: PgliteDatabase | null = null;

async function open(): Promise<PgliteDatabase> {
  const instance = new PgliteDatabase(":memory:", PROBE_SCHEMA);
  await instance.migrate();
  db = instance;
  return instance;
}

async function ids(instance: PgliteDatabase): Promise<string[]> {
  const rows = await instance.query<{ id: string }>(
    "select id from probe order by id",
  );
  return rows.map((row) => row.id);
}

afterEach(async () => {
  await db?.close();
  db = null;
});

describe("PgliteDatabase.transaction", () => {
  it("keeps an unrelated concurrent transaction out of the one already open", async () => {
    // The defect this test exists for: a process-global depth counter cannot
    // tell "nested inside the transaction in flight" from "a second request
    // that happens to overlap it". The second one joins, reports success, and
    // then the first one's rollback silently takes its write away.
    const instance = await open();
    const opened = deferred();
    const release = deferred();

    const first = instance.transaction(async (tx) => {
      await tx.execute("insert into probe (id) values ('rolled-back')");
      opened.resolve(); // A now holds an open transaction…
      await release.promise; // …and keeps holding it while B is dispatched.
      throw new Error("A changed its mind");
    });

    await opened.promise;

    // B shares nothing with A but the process. It must queue, not join.
    const second = instance.transaction(async (tx) => {
      await tx.execute("insert into probe (id) values ('committed')");
    });
    release.resolve();

    const [outcome] = await Promise.all([
      first.then(
        () => "committed" as const,
        (error: Error) => error.message,
      ),
      second,
    ]);

    expect(outcome).toBe("A changed its mind");
    expect(await ids(instance)).toEqual(["committed"]);
  });

  it("serialises independent transactions rather than interleaving them", async () => {
    // Two read-modify-write pairs against one row. On one connection they can
    // only be correct if the second waits for the first to commit.
    const instance = await open();
    await instance.execute("create table counter (id int primary key, n int)");
    await instance.execute("insert into counter (id, n) values (1, 0)");

    const bump = () =>
      instance.transaction(async (tx) => {
        const rows = await tx.query<{ n: number }>(
          "select n from counter where id = 1",
        );
        await tx.execute("update counter set n = $1 where id = 1", [
          Number(rows[0]?.n ?? 0) + 1,
        ]);
      });

    await Promise.all([bump(), bump(), bump()]);

    const rows = await instance.query<{ n: number }>(
      "select n from counter where id = 1",
    );
    expect(Number(rows[0]?.n)).toBe(3);
  });

  it("lets a genuinely nested call join the transaction it is inside", async () => {
    const instance = await open();

    await expect(
      instance.transaction(async (tx) => {
        await tx.execute("insert into probe (id) values ('outer')");
        // No executor threaded through — this is the case the marker exists
        // for. Queueing here would deadlock behind the very transaction the
        // call is running inside.
        await instance.transaction(async (inner) => {
          await inner.execute("insert into probe (id) values ('inner')");
        });
        throw new Error("outer changed its mind");
      }),
    ).rejects.toThrow(/outer changed its mind/);

    // Joined rather than committed separately, so the inner write went back
    // with the outer one.
    expect(await ids(instance)).toEqual([]);
  });

  it("does not poison later transactions with an earlier failure", async () => {
    const instance = await open();

    await expect(
      instance.transaction(async () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow(/nope/);

    await instance.transaction(async (tx) => {
      await tx.execute("insert into probe (id) values ('after')");
    });
    expect(await ids(instance)).toEqual(["after"]);
  });
});
