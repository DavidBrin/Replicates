// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  createChannelsRepository,
  deriveHandle,
  handleSlug,
  reserveHandle,
} from "@/adapters/repositories/channels";
import { DuplicateError } from "@/adapters/repositories/shared";
import type { Channel } from "@/domain/types";

import { countingExecutor, createTestUser, setupTestDatabase } from "./harness";

const t = setupTestDatabase();

const channels = () => createChannelsRepository(t.db);

/** A published, ready video on `channelId`. */
async function publishVideo(
  channelId: string,
  overrides: { visibility?: string; uploadStatus?: string } = {},
): Promise<void> {
  await t.db.execute(
    `insert into videos (id, channel_id, title, visibility, upload_status)
     values ($1, $2, 'A video', $3, $4)`,
    [
      `vid${Math.random().toString(36).slice(2, 10)}`,
      channelId,
      overrides.visibility ?? "public",
      overrides.uploadStatus ?? "ready",
    ],
  );
}

async function subscribe(channelId: string): Promise<void> {
  const subscriber = await createTestUser(t.db);
  await t.db.execute(
    "insert into subscriptions (subscriber_id, channel_id) values ($1, $2)",
    [subscriber.id, channelId],
  );
}

describe("handleSlug", () => {
  it("folds a display name into something that could be a handle", () => {
    expect(handleSlug("Ada Lovelace")).toBe("adalovelace");
    expect(handleSlug("  Ada  Lovelace!!  ")).toBe("adalovelace");
    expect(handleSlug("ADA_LOVELACE")).toBe("ada_lovelace");
    expect(handleSlug("ada.lovelace")).toBe("ada.lovelace");
    expect(handleSlug("ada--lovelace")).toBe("ada-lovelace");
  });

  it("keeps the letter when it strips the accent", () => {
    expect(handleSlug("Renée")).toBe("renee");
    expect(handleSlug("Étoile")).toBe("etoile");
    expect(handleSlug("Ångström")).toBe("angstrom");
  });

  it("trims separators off both ends, including after truncation", () => {
    expect(handleSlug("_ada_")).toBe("ada");
    expect(handleSlug("...")).toBe("");
    // Thirty characters of `a` then a dot: the dot survives the slice and must
    // still be trimmed, or the handle ends in punctuation.
    expect(handleSlug(`${"a".repeat(29)}.b`)).toBe("a".repeat(29));
  });

  it("never exceeds thirty characters", () => {
    expect(handleSlug("x".repeat(120))).toHaveLength(30);
  });

  it("can produce nothing at all, and says so rather than guessing", () => {
    expect(handleSlug("你好")).toBe("");
    expect(handleSlug("")).toBe("");
  });
});

describe("deriveHandle", () => {
  it("prefers the display name", () => {
    expect(deriveHandle("Ada Lovelace", "someone@example.com")).toBe(
      "adalovelace",
    );
  });

  it("falls back to the address when the name is too short or folds away", () => {
    expect(deriveHandle("Jo", "joanne@example.com")).toBe("joanne");
    expect(deriveHandle("你好", "hopper@example.com")).toBe("hopper");
  });

  it("falls back to `user` when neither survives", () => {
    expect(deriveHandle("你", "你@example.com")).toBe("user");
  });
});

describe("reserveHandle", () => {
  it("hands back the base when nothing has taken it", async () => {
    await expect(reserveHandle(t.db, "adalovelace")).resolves.toBe(
      "adalovelace",
    );
  });

  it("counts upwards, and counts past a differently-cased occupant", async () => {
    const owner = await createTestUser(t.db);
    await channels().create({ ownerId: owner.id, handle: "Ada", name: "A" });
    await expect(reserveHandle(t.db, "ada")).resolves.toBe("ada2");

    await channels().create({ ownerId: owner.id, handle: "ADA2", name: "B" });
    await expect(reserveHandle(t.db, "ada")).resolves.toBe("ada3");
  });

  it("is not confused by a handle that merely starts the same way", async () => {
    const owner = await createTestUser(t.db);
    await channels().create({
      ownerId: owner.id,
      handle: "adalovelace-fanclub",
      name: "Fans",
    });
    await expect(reserveHandle(t.db, "adalovelace")).resolves.toBe(
      "adalovelace",
    );
  });

  /**
   * `_` is a single-character wildcard in `like` *and* a legal handle
   * character. Unescaped, the family query for `ada_x` also matches `adaYx`,
   * and the allocator then skips a handle that was free.
   */
  it("treats `_` in a handle as a literal, not as a wildcard", async () => {
    const owner = await createTestUser(t.db);
    await channels().create({ ownerId: owner.id, handle: "adaXx", name: "X" });
    await expect(reserveHandle(t.db, "ada_x")).resolves.toBe("ada_x");
  });

  it("leaves room for the number when the base is already the maximum length", async () => {
    const owner = await createTestUser(t.db);
    const long = "a".repeat(30);
    await channels().create({ ownerId: owner.id, handle: long, name: "Long" });

    const next = await reserveHandle(t.db, long);
    expect(next.length).toBeLessThanOrEqual(30);
    expect(next).toBe(`${"a".repeat(25)}2`);

    // And it is genuinely insertable, which is the only thing that matters.
    await expect(
      channels().create({ ownerId: owner.id, handle: next, name: "Long 2" }),
    ).resolves.toMatchObject({ handle: next });
  });
});

describe("create and read", () => {
  it("round-trips a channel with both counts at zero", async () => {
    const owner = await createTestUser(t.db);
    const created = await channels().create({
      ownerId: owner.id,
      handle: "adalovelace",
      name: "Ada Lovelace",
      description: "Notes on the Analytical Engine",
    });

    expect(created).toEqual({
      id: expect.stringMatching(/^ch_/),
      ownerId: owner.id,
      handle: "adalovelace",
      name: "Ada Lovelace",
      description: "Notes on the Analytical Engine",
      avatarKey: null,
      bannerKey: null,
      // A new channel is not verified. The tick is a decision somebody makes
      // about a channel, never a property of having created one.
      verified: false,
      subscriberCount: 0,
      videoCount: 0,
      createdAt: expect.any(Date),
    } satisfies Channel);

    // The counts a fresh insert reports without asking are the same ones a
    // real query produces. If they were not, `create` would be lying cheaply.
    await expect(channels().findById(created.id)).resolves.toEqual(created);
  });

  it("finds a channel by handle whatever the casing, with or without the @", async () => {
    const owner = await createTestUser(t.db);
    const created = await channels().create({
      ownerId: owner.id,
      handle: "AdaLovelace",
      name: "Ada",
    });

    for (const spelling of [
      "AdaLovelace",
      "adalovelace",
      "ADALOVELACE",
      "@adalovelace",
      "@AdaLovelace",
    ]) {
      await expect(channels().findByHandle(spelling)).resolves.toEqual(created);
    }
    await expect(channels().findByHandle("someoneelse")).resolves.toBeNull();
  });

  it("preserves the casing the handle was created with", async () => {
    const owner = await createTestUser(t.db);
    const created = await channels().create({
      ownerId: owner.id,
      handle: "AdaLovelace",
      name: "Ada",
    });
    expect(created.handle).toBe("AdaLovelace");
  });

  it("refuses a handle that is taken in another casing", async () => {
    const owner = await createTestUser(t.db);
    await channels().create({
      ownerId: owner.id,
      handle: "adalovelace",
      name: "Ada",
    });

    await expect(
      channels().create({
        ownerId: owner.id,
        handle: "AdaLovelace",
        name: "Impostor",
      }),
    ).rejects.toBeInstanceOf(DuplicateError);
    await expect(
      channels().create({
        ownerId: owner.id,
        handle: "ADALOVELACE",
        name: "Impostor",
      }),
    ).rejects.toMatchObject({ entity: "channel", field: "handle" });

    await expect(t.db.query("select id from channels")).resolves.toHaveLength(1);
  });

  it("lists an owner's channels and nobody else's", async () => {
    const ada = await createTestUser(t.db, { email: "ada@test.local" });
    const grace = await createTestUser(t.db, { email: "grace@test.local" });

    await channels().create({
      ownerId: ada.id,
      handle: "ada-main",
      name: "Main",
    });
    await channels().create({
      ownerId: ada.id,
      handle: "ada-shorts",
      name: "Shorts",
    });
    await channels().create({
      ownerId: grace.id,
      handle: "grace",
      name: "Grace",
    });

    const listed = await channels().listForOwner(ada.id);
    expect(listed.map((channel) => channel.handle)).toEqual([
      "ada-main",
      "ada-shorts",
    ]);
    await expect(channels().listForOwner("usr_nobody")).resolves.toEqual([]);
  });

  it("puts an older channel first even when its handle sorts later", async () => {
    const ada = await createTestUser(t.db);
    const younger = await channels().create({
      ownerId: ada.id,
      handle: "aaa-newer",
      name: "Newer",
    });
    const older = await channels().create({
      ownerId: ada.id,
      handle: "zzz-older",
      name: "Older",
    });
    await t.db.execute(
      "update channels set created_at = now() - interval '1 day' where id = $1",
      [older.id],
    );

    const listed = await channels().listForOwner(ada.id);
    expect(listed.map((channel) => channel.id)).toEqual([older.id, younger.id]);
  });

  /**
   * PGlite's `now()` is only millisecond-resolved, so channels created in one
   * request tie on `created_at`. The order then has to come from somewhere
   * deterministic, and "whatever the planner felt like" is not a somewhere.
   */
  it("orders channels created in the same millisecond by handle, stably", async () => {
    const ada = await createTestUser(t.db);
    for (const handle of ["delta", "alpha", "charlie", "bravo"]) {
      await channels().create({ ownerId: ada.id, handle, name: handle });
    }
    // Pinned rather than assumed. Inserting four rows in a loop *usually*
    // lands them in one millisecond and sometimes straddles two, and a test
    // about the tiebreaker must not be a test about how fast the machine is.
    await t.db.execute(
      "update channels set created_at = timestamptz '2026-01-01 00:00:00Z'",
    );

    const once = await channels().listForOwner(ada.id);
    const twice = await channels().listForOwner(ada.id);

    expect(once.map((channel) => channel.handle)).toEqual([
      "alpha",
      "bravo",
      "charlie",
      "delta",
    ]);
    expect(twice.map((channel) => channel.handle)).toEqual(
      once.map((channel) => channel.handle),
    );
  });
});

describe("the computed counts", () => {
  it("counts subscribers", async () => {
    const owner = await createTestUser(t.db);
    const channel = await channels().create({
      ownerId: owner.id,
      handle: "ada",
      name: "Ada",
    });

    await subscribe(channel.id);
    await subscribe(channel.id);
    await subscribe(channel.id);

    await expect(channels().findById(channel.id)).resolves.toMatchObject({
      subscriberCount: 3,
    });
  });

  /**
   * A visitor reading "42 videos" above a grid of 37 will conclude the grid is
   * broken. The count has to mean the same thing the grid does.
   */
  it("counts only the videos a visitor can actually see in the grid", async () => {
    const owner = await createTestUser(t.db);
    const channel = await channels().create({
      ownerId: owner.id,
      handle: "ada",
      name: "Ada",
    });

    await publishVideo(channel.id);
    await publishVideo(channel.id);
    await publishVideo(channel.id, { visibility: "private" });
    await publishVideo(channel.id, { visibility: "unlisted" });
    await publishVideo(channel.id, { uploadStatus: "uploading" });
    await publishVideo(channel.id, { uploadStatus: "failed" });

    await expect(channels().findById(channel.id)).resolves.toMatchObject({
      videoCount: 2,
    });
  });

  it("attributes each channel's counts to that channel", async () => {
    const owner = await createTestUser(t.db);
    const main = await channels().create({
      ownerId: owner.id,
      handle: "main",
      name: "Main",
    });
    const side = await channels().create({
      ownerId: owner.id,
      handle: "side",
      name: "Side",
    });

    await subscribe(main.id);
    await subscribe(main.id);
    await subscribe(side.id);
    await publishVideo(main.id);
    await publishVideo(side.id);
    await publishVideo(side.id);
    await publishVideo(side.id);

    const listed = await channels().listForOwner(owner.id);
    expect(
      listed.map((channel) => [
        channel.handle,
        channel.subscriberCount,
        channel.videoCount,
      ]),
    ).toEqual([
      ["main", 2, 1],
      ["side", 1, 3],
    ]);
  });

  /**
   * The N+1 assertion, and the only kind of assertion that can make it: no
   * property of the returned data distinguishes one query from eleven.
   */
  it("fetches a list of channels and all their counts in one statement", async () => {
    const owner = await createTestUser(t.db);
    for (let index = 0; index < 5; index += 1) {
      const channel = await channels().create({
        ownerId: owner.id,
        handle: `channel-${index}`,
        name: `Channel ${index}`,
      });
      await subscribe(channel.id);
      await publishVideo(channel.id);
    }

    const counting = countingExecutor(t.db);
    const listed = await channels().listForOwner(owner.id, counting);

    expect(listed).toHaveLength(5);
    expect(listed.every((channel) => channel.subscriberCount === 1)).toBe(true);
    expect(counting.statements).toHaveLength(1);
  });

  it("fetches one channel and its counts in one statement", async () => {
    const owner = await createTestUser(t.db);
    const channel = await channels().create({
      ownerId: owner.id,
      handle: "ada",
      name: "Ada",
    });

    const counting = countingExecutor(t.db);
    await channels().findById(channel.id, counting);
    expect(counting.statements).toHaveLength(1);

    const byHandle = countingExecutor(t.db);
    await channels().findByHandle("@ada", byHandle);
    expect(byHandle.statements).toHaveLength(1);
  });
});

describe("update", () => {
  it("changes only what the patch names", async () => {
    const owner = await createTestUser(t.db);
    const created = await channels().create({
      ownerId: owner.id,
      handle: "ada",
      name: "Ada",
      description: "Original",
      avatarKey: "avatars/ada.png",
    });

    const updated = await channels().update(created.id, { name: "Ada Lovelace" });

    expect(updated).toMatchObject({
      id: created.id,
      name: "Ada Lovelace",
      handle: "ada",
      description: "Original",
      avatarKey: "avatars/ada.png",
    });
  });

  it("distinguishes `absent` from `null`", async () => {
    const owner = await createTestUser(t.db);
    const created = await channels().create({
      ownerId: owner.id,
      handle: "ada",
      name: "Ada",
      avatarKey: "avatars/ada.png",
      bannerKey: "banners/ada.png",
    });

    const updated = await channels().update(created.id, { avatarKey: null });

    expect(updated?.avatarKey).toBeNull();
    expect(updated?.bannerKey).toBe("banners/ada.png");
  });

  it("returns the counts alongside the update, in one statement", async () => {
    const owner = await createTestUser(t.db);
    const created = await channels().create({
      ownerId: owner.id,
      handle: "ada",
      name: "Ada",
    });
    await subscribe(created.id);
    await subscribe(created.id);
    await publishVideo(created.id);

    const counting = countingExecutor(t.db);
    const updated = await channels().update(
      created.id,
      { description: "Notes" },
      counting,
    );

    expect(updated).toMatchObject({
      description: "Notes",
      subscriberCount: 2,
      videoCount: 1,
    });
    expect(counting.statements).toHaveLength(1);
  });

  it("changes a handle, and refuses one that is taken in another casing", async () => {
    const owner = await createTestUser(t.db);
    const mine = await channels().create({
      ownerId: owner.id,
      handle: "ada",
      name: "Ada",
    });
    await channels().create({
      ownerId: owner.id,
      handle: "grace",
      name: "Grace",
    });

    await expect(
      channels().update(mine.id, { handle: "adalovelace" }),
    ).resolves.toMatchObject({ handle: "adalovelace" });

    await expect(
      channels().update(mine.id, { handle: "GRACE" }),
    ).rejects.toMatchObject({ entity: "channel", field: "handle" });

    // The rejected update left the row alone.
    await expect(channels().findById(mine.id)).resolves.toMatchObject({
      handle: "adalovelace",
    });
  });

  it("treats an empty patch as a read rather than a write", async () => {
    const owner = await createTestUser(t.db);
    const created = await channels().create({
      ownerId: owner.id,
      handle: "ada",
      name: "Ada",
    });

    await expect(channels().update(created.id, {})).resolves.toEqual(created);
  });

  it("returns null for a channel that is not there", async () => {
    await expect(
      channels().update("ch_nope", { name: "Ghost" }),
    ).resolves.toBeNull();
    await expect(channels().update("ch_nope", {})).resolves.toBeNull();
  });
});

describe("composition", () => {
  it("rolls back with the caller's transaction", async () => {
    const owner = await createTestUser(t.db);
    const marker = new Error("no");

    await expect(
      t.db.transaction(async (tx) => {
        await channels().create(
          { ownerId: owner.id, handle: "ada", name: "Ada" },
          tx,
        );
        throw marker;
      }),
    ).rejects.toBe(marker);

    await expect(channels().findByHandle("ada")).resolves.toBeNull();
  });
});
