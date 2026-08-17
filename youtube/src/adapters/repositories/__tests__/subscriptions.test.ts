// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { SqlDatabase } from "@/adapters/db/driver";
import {
  CannotSubscribeToOwnChannelError,
  ChannelNotFoundError,
  countSubscribers,
  filterSubscribed,
  getSubscription,
  listSubscriptionFeed,
  listSubscriptions,
  setNotifications,
  subscribe,
  unsubscribe,
} from "../subscriptions";
import type { QueryCounter } from "./library-harness";
import {
  countingDatabase,
  createTestDatabase,
  seedChannel,
  seedCreator,
  seedUser,
  seedVideo,
} from "./library-harness";

let db: SqlDatabase & QueryCounter;
let raw: SqlDatabase;

beforeAll(async () => {
  raw = await createTestDatabase();
  db = countingDatabase(raw);
});

afterAll(async () => {
  await raw.close();
});

beforeEach(async () => {
  await raw.execute("delete from videos");
  await raw.execute("delete from subscriptions");
  await raw.execute("delete from channels");
  await raw.execute("delete from users");
  db.reset();
});

describe("subscribing", () => {
  it("records the subscription with the default bell", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);

    const subscription = await subscribe(db, viewer, channelId);

    expect(subscription.notifications).toBe("personalised");
    expect(await countSubscribers(db, channelId)).toBe(1);
  });

  it("is idempotent — pressing subscribe twice is one subscriber", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);

    await subscribe(db, viewer, channelId);
    await subscribe(db, viewer, channelId);

    expect(await countSubscribers(db, channelId)).toBe(1);
  });

  it("changes the bell on a second call rather than failing", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);

    await subscribe(db, viewer, channelId, "none");
    const updated = await subscribe(db, viewer, channelId, "all");

    expect(updated.notifications).toBe("all");
    expect((await getSubscription(db, viewer, channelId))?.notifications).toBe(
      "all",
    );
  });

  it("refuses a channel's own owner", async () => {
    const { userId, channelId } = await seedCreator(raw);

    await expect(subscribe(db, userId, channelId)).rejects.toBeInstanceOf(
      CannotSubscribeToOwnChannelError,
    );
    expect(await countSubscribers(db, channelId)).toBe(0);
  });

  it("distinguishes a missing channel from an owner's own", async () => {
    const viewer = await seedUser(raw);
    await expect(subscribe(db, viewer, "nope")).rejects.toBeInstanceOf(
      ChannelNotFoundError,
    );
  });

  it("takes one statement, guard included", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);

    db.reset();
    await subscribe(db, viewer, channelId);
    expect(db.count).toBe(1);
  });
});

describe("unsubscribing and the bell", () => {
  it("removes the subscription and reports whether there was one", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    await subscribe(db, viewer, channelId);

    expect(await unsubscribe(db, viewer, channelId)).toBe(true);
    expect(await unsubscribe(db, viewer, channelId)).toBe(false);
    expect(await countSubscribers(db, channelId)).toBe(0);
  });

  it("will not create a subscription by setting its bell", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);

    expect(await setNotifications(db, viewer, channelId, "all")).toBe(false);
    expect(await countSubscribers(db, channelId)).toBe(0);
  });

  it("sets the bell on a subscription that exists", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    await subscribe(db, viewer, channelId);

    expect(await setNotifications(db, viewer, channelId, "all")).toBe(true);
    expect((await getSubscription(db, viewer, channelId))?.notifications).toBe(
      "all",
    );
  });

  it("has no subscription to report for a signed-out viewer", async () => {
    const { channelId } = await seedCreator(raw);
    db.reset();
    expect(await getSubscription(db, null, channelId)).toBeNull();
    expect(db.count).toBe(0);
  });
});

describe("the subscription list", () => {
  it("carries each channel's subscriber and video counts in one statement", async () => {
    const viewer = await seedUser(raw);
    const other = await seedUser(raw);
    const { channelId } = await seedCreator(raw, { name: "Applied Science" });

    await seedVideo(raw, channelId);
    await seedVideo(raw, channelId);
    await seedVideo(raw, channelId, { visibility: "private" });
    await subscribe(db, viewer, channelId);
    await subscribe(db, other, channelId);

    db.reset();
    const channels = await listSubscriptions(db, viewer);

    expect(db.count).toBe(1);
    expect(channels).toHaveLength(1);
    expect(channels[0]?.name).toBe("Applied Science");
    expect(channels[0]?.subscriberCount).toBe(2);
    // The private video is not part of the public count.
    expect(channels[0]?.videoCount).toBe(2);
  });

  it("does not multiply the two counts against each other", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    for (let i = 0; i < 3; i += 1) await seedVideo(raw, channelId);
    for (let i = 0; i < 4; i += 1) {
      await subscribe(db, await seedUser(raw), channelId);
    }
    await subscribe(db, viewer, channelId);

    const [channel] = await listSubscriptions(db, viewer);
    expect(channel?.subscriberCount).toBe(5);
    expect(channel?.videoCount).toBe(3);
  });

  it("sorts by name, case-insensitively", async () => {
    const viewer = await seedUser(raw);
    for (const name of ["zeta", "Alpha", "beta"]) {
      const owner = await seedUser(raw);
      const channelId = await seedChannel(raw, owner, { name });
      await subscribe(db, viewer, channelId);
    }

    expect((await listSubscriptions(db, viewer)).map((c) => c.name)).toEqual([
      "Alpha",
      "beta",
      "zeta",
    ]);
  });

  it("is empty and free for a signed-out viewer", async () => {
    db.reset();
    expect(await listSubscriptions(db, null)).toEqual([]);
    expect(db.count).toBe(0);
  });
});

describe("filterSubscribed", () => {
  it("answers for a page of channels in one statement", async () => {
    const viewer = await seedUser(raw);
    const followed = await seedCreator(raw);
    const ignored = await seedCreator(raw);
    await subscribe(db, viewer, followed.channelId);

    db.reset();
    const subscribed = await filterSubscribed(db, viewer, [
      followed.channelId,
      ignored.channelId,
    ]);

    expect(db.count).toBe(1);
    expect([...subscribed]).toEqual([followed.channelId]);
  });

  it("asks nothing for a signed-out viewer or an empty page", async () => {
    const viewer = await seedUser(raw);
    db.reset();
    expect(await filterSubscribed(db, null, ["a"])).toEqual(new Set());
    expect(await filterSubscribed(db, viewer, [])).toEqual(new Set());
    expect(db.count).toBe(0);
  });
});

describe("the subscription feed", () => {
  it("shows only subscribed channels, newest first", async () => {
    const viewer = await seedUser(raw);
    const followed = await seedCreator(raw);
    const ignored = await seedCreator(raw);
    await subscribe(db, viewer, followed.channelId);

    const older = await seedVideo(raw, followed.channelId, {
      publishedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const newer = await seedVideo(raw, followed.channelId, {
      publishedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    await seedVideo(raw, ignored.channelId);

    expect((await listSubscriptionFeed(db, viewer)).map((c) => c.id)).toEqual([
      newer,
      older,
    ]);
  });

  it("leaves Shorts to their own shelf unless asked", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    await subscribe(db, viewer, channelId);
    const long = await seedVideo(raw, channelId);
    const short = await seedVideo(raw, channelId, { isShort: true });

    expect((await listSubscriptionFeed(db, viewer)).map((c) => c.id)).toEqual([
      long,
    ]);
    expect(
      (await listSubscriptionFeed(db, viewer, { includeShorts: true })).length,
    ).toBe(2);
    expect(short).toBeDefined();
  });

  it("carries resume positions and channel identity in one statement", async () => {
    const viewer = await seedUser(raw);
    for (let i = 0; i < 20; i += 1) {
      const owner = await seedUser(raw);
      const channelId = await seedChannel(raw, owner);
      await subscribe(db, viewer, channelId);
      const videoId = await seedVideo(raw, channelId, {
        publishedAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
      });
      await raw.execute(
        `insert into watch_progress (user_id, video_id, position_seconds)
         values ($1, $2, $3)`,
        [viewer, videoId, i + 1],
      );
    }

    db.reset();
    const feed = await listSubscriptionFeed(db, viewer);

    expect(db.count).toBe(1);
    expect(feed).toHaveLength(20);
    expect(feed.every((c) => typeof c.watchedSeconds === "number")).toBe(true);
    expect(feed.every((c) => c.channelHandle.length > 0)).toBe(true);
  });

  it("is empty and free for a signed-out viewer", async () => {
    db.reset();
    expect(await listSubscriptionFeed(db, null)).toEqual([]);
    expect(db.count).toBe(0);
  });
});
