// @vitest-environment node

import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

import { describe, expect, it, vi } from "vitest";

import { createChannelsRepository } from "@/adapters/repositories/channels";
import { DuplicateError } from "@/adapters/repositories/shared";
import { createUsersRepository } from "@/adapters/repositories/users";

import { setupTestDatabase } from "./harness";

/**
 * `verifyPassword` is wrapped rather than replaced.
 *
 * The interesting assertion in this file is that an unknown address still
 * *reaches* the derivation — see the enumeration test below — and that is a
 * claim about a call, not about a return value. Spreading the real module and
 * wrapping the one function keeps every other test in this file running against
 * real scrypt, which matters because two of them are about hashes being written
 * and upgraded for real.
 */
vi.mock("@/lib/auth/password", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/password")>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

import { verifyPassword } from "@/lib/auth/password";

const t = setupTestDatabase();

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * A hash as some earlier, cheaper version of `password.ts` would have written
 * it.
 *
 * Derived here rather than by editing the parameters out of a current hash: the
 * digest is a function of `N`, so rewriting the number in the string produces a
 * value that decodes cleanly and verifies against nothing. That mistake is
 * worth naming, because it makes a broken upgrade path look like a working one
 * — the test then fails at the *sign-in*, not at the rehash, and the obvious
 * diagnosis is the wrong one.
 */
async function legacyHash(password: string): Promise<string> {
  const N = 16_384;
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, {
    N,
    r: 8,
    p: 1,
    maxmem: 128 * N * 8 * 2,
  });
  return [
    "scrypt",
    N,
    8,
    1,
    64,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
}

const users = () => createUsersRepository(t.db);
const channels = () => createChannelsRepository(t.db);

describe("create and read", () => {
  it("round-trips a user without ever returning the hash", async () => {
    const created = await users().create({
      email: "ada@example.com",
      password: "correct-horse-battery-staple",
      displayName: "Ada Lovelace",
    });

    expect(created).toEqual({
      id: expect.stringMatching(/^usr_/),
      email: "ada@example.com",
      displayName: "Ada Lovelace",
      createdAt: expect.any(Date),
    });
    expect(Object.keys(created)).not.toContain("passwordHash");

    await expect(users().findById(created.id)).resolves.toEqual(created);
    await expect(users().findById("usr_nope")).resolves.toBeNull();
  });

  it("stores a hash, not the password", async () => {
    await users().create({
      email: "ada@example.com",
      password: "correct-horse-battery-staple",
      displayName: "Ada",
    });
    const rows = await t.db.query<{ password_hash: string }>(
      "select password_hash from users",
    );
    expect(rows[0]?.password_hash).not.toContain("correct-horse");
    expect(rows[0]?.password_hash.startsWith("scrypt$")).toBe(true);
  });

  /**
   * The index is on `lower(email)`, so a lookup that does not lower() both
   * sides misses it — and worse, misses the *row*. This is the assertion that
   * catches a `where email = $1` regression.
   */
  it("finds an address regardless of how either side was typed", async () => {
    const created = await users().create({
      email: "Ada@Example.COM",
      password: "hunter2",
      displayName: "Ada",
    });

    for (const spelling of [
      "Ada@Example.COM",
      "ada@example.com",
      "ADA@EXAMPLE.COM",
      "aDa@ExAmPlE.cOm",
    ]) {
      await expect(users().findByEmail(spelling)).resolves.toEqual(created);
    }
    await expect(users().findByEmail("ada@example.org")).resolves.toBeNull();
  });

  it("preserves the case the address was registered with", async () => {
    const created = await users().create({
      email: "Ada@Example.COM",
      password: "hunter2",
      displayName: "Ada",
    });
    expect(created.email).toBe("Ada@Example.COM");
  });

  it("refuses a second registration of the same address in another casing", async () => {
    await users().create({
      email: "ada@example.com",
      password: "hunter2",
      displayName: "Ada",
    });

    await expect(
      users().create({
        email: "ADA@example.com",
        password: "hunter2",
        displayName: "Impostor",
      }),
    ).rejects.toBeInstanceOf(DuplicateError);

    await expect(
      users().create({
        email: "ADA@example.com",
        password: "hunter2",
        displayName: "Impostor",
      }),
    ).rejects.toMatchObject({ entity: "user", field: "email" });

    const rows = await t.db.query("select id from users");
    expect(rows).toHaveLength(1);
  });
});

describe("verifyCredentials", () => {
  it("accepts the right password and rejects the wrong one", async () => {
    const created = await users().create({
      email: "ada@example.com",
      password: "correct-horse-battery-staple",
      displayName: "Ada",
    });

    await expect(
      users().verifyCredentials("ada@example.com", "correct-horse-battery-staple"),
    ).resolves.toEqual(created);
    await expect(
      users().verifyCredentials("ada@example.com", "wrong"),
    ).resolves.toBeNull();
  });

  it("is as case-insensitive about the address as the lookup is", async () => {
    await users().create({
      email: "ada@example.com",
      password: "hunter2",
      displayName: "Ada",
    });
    await expect(
      users().verifyCredentials("ADA@EXAMPLE.COM", "hunter2"),
    ).resolves.not.toBeNull();
  });

  /**
   * The account-enumeration property, asserted as a code path rather than as a
   * duration.
   *
   * If `verifyCredentials` returned early for an unknown address, this call
   * would never happen and the endpoint in front of it would answer in
   * microseconds for addresses with no account and in ~200 ms for addresses
   * with one — which is a list of everybody who has registered here, readable
   * over the network with no statistics at all.
   *
   * Timing it instead would mean asserting on a 200 ms operation while a WASM
   * Postgres runs in the same process. That test fails on a busy machine, gets
   * marked flaky, and then defends nothing.
   */
  it("still runs a derivation when the address has no account", async () => {
    vi.mocked(verifyPassword).mockClear();

    await expect(
      users().verifyCredentials("nobody@example.com", "hunter2"),
    ).resolves.toBeNull();

    expect(verifyPassword).toHaveBeenCalledTimes(1);
    expect(verifyPassword).toHaveBeenCalledWith("hunter2", null);
  });

  it("calls the same function the same number of times for a miss and a wrong password", async () => {
    await users().create({
      email: "ada@example.com",
      password: "hunter2",
      displayName: "Ada",
    });

    vi.mocked(verifyPassword).mockClear();
    await users().verifyCredentials("ada@example.com", "wrong");
    const wrongPassword = vi.mocked(verifyPassword).mock.calls.length;

    vi.mocked(verifyPassword).mockClear();
    await users().verifyCredentials("nobody@example.com", "wrong");
    const noSuchUser = vi.mocked(verifyPassword).mock.calls.length;

    expect(noSuchUser).toBe(wrongPassword);
  });

  /**
   * The payoff for storing the parameters with the hash: a row written under a
   * weaker cost is upgraded the next time its owner proves they know the
   * password, and nobody is locked out in the process.
   */
  it("upgrades a hash written under weaker parameters, on a successful sign-in", async () => {
    const created = await users().create({
      email: "ada@example.com",
      password: "hunter2",
      displayName: "Ada",
    });

    const weak = await legacyHash("hunter2");
    expect(weak.startsWith("scrypt$16384$")).toBe(true);
    await t.db.execute("update users set password_hash = $2 where id = $1", [
      created.id,
      weak,
    ]);

    // The weak hash is not merely tolerated — signing in with it works.
    await expect(
      users().verifyCredentials("ada@example.com", "hunter2"),
    ).resolves.toEqual(created);

    const rows = await t.db.query<{ password_hash: string }>(
      "select password_hash from users where id = $1",
      [created.id],
    );
    expect(rows[0]?.password_hash).not.toBe(weak);
    expect(rows[0]?.password_hash.startsWith("scrypt$131072$")).toBe(true);

    // …and the upgraded hash still verifies the same password.
    await expect(
      users().verifyCredentials("ada@example.com", "hunter2"),
    ).resolves.toEqual(created);
  });

  it("leaves a current hash alone", async () => {
    const created = await users().create({
      email: "ada@example.com",
      password: "hunter2",
      displayName: "Ada",
    });
    const before = await t.db.query<{ password_hash: string }>(
      "select password_hash from users where id = $1",
      [created.id],
    );

    await users().verifyCredentials("ada@example.com", "hunter2");

    const after = await t.db.query<{ password_hash: string }>(
      "select password_hash from users where id = $1",
      [created.id],
    );
    expect(after[0]?.password_hash).toBe(before[0]?.password_hash);
  });
});

describe("register", () => {
  async function playlistsOf(ownerId: string) {
    return t.db.query<{ kind: string; title: string; visibility: string }>(
      "select kind, title, visibility from playlists where owner_id = $1 order by kind",
      [ownerId],
    );
  }

  it("creates a user, a channel and both system playlists", async () => {
    const { user, channel } = await users().register({
      email: "ada@example.com",
      password: "correct-horse-battery-staple",
      displayName: "Ada Lovelace",
    });

    expect(user.email).toBe("ada@example.com");
    expect(channel.ownerId).toBe(user.id);
    expect(channel.name).toBe("Ada Lovelace");
    expect(channel.handle).toBe("adalovelace");
    expect(channel.subscriberCount).toBe(0);
    expect(channel.videoCount).toBe(0);

    await expect(playlistsOf(user.id)).resolves.toEqual([
      { kind: "liked", title: "Liked videos", visibility: "private" },
      { kind: "watch_later", title: "Watch later", visibility: "private" },
    ]);

    // The channel is findable by the handle it was given, which is the only
    // thing the URL will have.
    await expect(channels().findByHandle("@adalovelace")).resolves.toEqual(
      channel,
    );
  });

  it("derives a handle from the address when the display name folds away", async () => {
    const { channel } = await users().register({
      email: "hopper@example.com",
      password: "hunter2",
      displayName: "你好",
    });
    expect(channel.handle).toBe("hopper");
  });

  it("falls back to `user` when neither the name nor the address survives", async () => {
    const { channel } = await users().register({
      email: "你@example.com",
      password: "hunter2",
      displayName: "你",
    });
    expect(channel.handle).toBe("user");
  });

  it("strips diacritics rather than dropping the letters", async () => {
    const { channel } = await users().register({
      email: "renee@example.com",
      password: "hunter2",
      displayName: "Renée Étoile",
    });
    expect(channel.handle).toBe("reneeetoile");
  });

  /**
   * Deterministic, so this can be asserted at all. A random suffix would leave
   * nothing here but a regex, and a regex would pass against an implementation
   * that handed the same handle to two people in different casings.
   */
  it("resolves collisions by counting, in order", async () => {
    const first = await users().register({
      email: "ada1@example.com",
      password: "hunter2",
      displayName: "Ada Lovelace",
    });
    const second = await users().register({
      email: "ada2@example.com",
      password: "hunter2",
      displayName: "Ada Lovelace",
    });
    const third = await users().register({
      email: "ada3@example.com",
      password: "hunter2",
      displayName: "ADA LOVELACE",
    });

    expect(first.channel.handle).toBe("adalovelace");
    expect(second.channel.handle).toBe("adalovelace2");
    expect(third.channel.handle).toBe("adalovelace3");
  });

  it("counts past a handle somebody took by hand", async () => {
    await users().register({
      email: "someone@example.com",
      password: "hunter2",
      displayName: "Someone",
      handle: "AdaLovelace2",
    });
    const { channel } = await users().register({
      email: "ada@example.com",
      password: "hunter2",
      displayName: "Ada Lovelace",
    });
    expect(channel.handle).toBe("adalovelace");

    const next = await users().register({
      email: "ada4@example.com",
      password: "hunter2",
      displayName: "Ada Lovelace",
    });
    // `adalovelace2` is taken in a different casing, and `lower(handle)` is
    // what the index is on, so the next free number is 3.
    expect(next.channel.handle).toBe("adalovelace3");
  });

  it("does not silently renumber a handle somebody asked for by name", async () => {
    await users().register({
      email: "first@example.com",
      password: "hunter2",
      displayName: "First",
      handle: "taken",
    });

    await expect(
      users().register({
        email: "second@example.com",
        password: "hunter2",
        displayName: "Second",
        handle: "TAKEN",
      }),
    ).rejects.toMatchObject({ entity: "channel", field: "handle" });
  });

  /**
   * The whole reason registration is one transaction. A user row that survives
   * a failed channel insert is an account with no channel, and every page after
   * sign-up would have to defend against a state that should not be
   * representable.
   */
  it("rolls the user and the playlists back when the channel insert fails", async () => {
    await users().register({
      email: "first@example.com",
      password: "hunter2",
      displayName: "First",
      handle: "taken",
    });

    const before = await t.db.query("select id from users");

    await expect(
      users().register({
        email: "second@example.com",
        password: "hunter2",
        displayName: "Second",
        handle: "Taken",
      }),
    ).rejects.toBeInstanceOf(DuplicateError);

    await expect(t.db.query("select id from users")).resolves.toHaveLength(
      before.length,
    );
    await expect(
      users().findByEmail("second@example.com"),
    ).resolves.toBeNull();
    await expect(
      t.db.query("select id from channels where lower(handle) = 'taken'"),
    ).resolves.toHaveLength(1);
    await expect(t.db.query("select id from playlists")).resolves.toHaveLength(2);
  });

  it("rolls the channel and the playlists back when the address is taken", async () => {
    await users().register({
      email: "ada@example.com",
      password: "hunter2",
      displayName: "Ada Lovelace",
    });

    await expect(
      users().register({
        email: "ADA@example.com",
        password: "hunter2",
        displayName: "Somebody Else",
      }),
    ).rejects.toMatchObject({ entity: "user", field: "email" });

    await expect(t.db.query("select id from users")).resolves.toHaveLength(1);
    await expect(t.db.query("select id from channels")).resolves.toHaveLength(1);
    await expect(t.db.query("select id from playlists")).resolves.toHaveLength(2);
  });

  it("refuses a second `watch_later` for one owner, which is the schema's job", async () => {
    const { user } = await users().register({
      email: "ada@example.com",
      password: "hunter2",
      displayName: "Ada",
    });

    await expect(
      t.db.execute(
        `insert into playlists (id, owner_id, title, kind)
         values ('pl_dupe', $1, 'Watch later again', 'watch_later')`,
        [user.id],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  /**
   * The optional trailing executor is the whole composition story: a caller
   * that already owns a transaction gets registration inside it, including the
   * rollback.
   */
  it("joins a transaction the caller already owns", async () => {
    const marker = new Error("the caller changed its mind");

    await expect(
      t.db.transaction(async (tx) => {
        await users().register(
          {
            email: "ada@example.com",
            password: "hunter2",
            displayName: "Ada Lovelace",
          },
          tx,
        );
        // Visible inside the transaction…
        await expect(
          users().findByEmail("ada@example.com", tx),
        ).resolves.not.toBeNull();
        throw marker;
      }),
    ).rejects.toBe(marker);

    // …and gone once it rolls back.
    await expect(users().findByEmail("ada@example.com")).resolves.toBeNull();
    await expect(t.db.query("select id from channels")).resolves.toHaveLength(0);
    await expect(t.db.query("select id from playlists")).resolves.toHaveLength(0);
  });
});
