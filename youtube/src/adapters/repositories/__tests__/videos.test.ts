// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { SqlDatabase } from "@/adapters/db/driver";
import type { VideoPatch } from "../videos";
import {
  SHORT_MAX_ASPECT_RATIO,
  SHORT_MAX_DURATION_SECONDS,
  createVideo,
  getVideo,
  getVideoWithRenditions,
  isShortVideo,
  listCardsByIds,
  listChannelVideos,
  listHomeFeed,
  listShortsFeed,
  newVideoId,
  publishVideo,
  recordView,
  replaceRenditions,
  setTags,
  stampVideoFixtureFacts,
  updateVideo,
} from "../videos";
import { createChannelsRepository } from "../channels";
import {
  countingDatabase,
  createTestDatabase,
  seedChannel,
  seedCreator,
  seedUser,
  seedVideo,
} from "./library-harness";

let db: SqlDatabase & { reset(): void; readonly count: number; readonly statements: readonly string[] };
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
  await raw.execute("delete from channels");
  await raw.execute("delete from users");
  db.reset();
});

describe("the video record", () => {
  it("starts life uploading and unpublished", async () => {
    const { channelId } = await seedCreator(raw);
    const video = await createVideo(db, {
      channelId,
      title: "First light",
      description: "Notes in the description",
      tags: ["astro", "timelapse", "astro"],
    });

    expect(video.uploadStatus).toBe("uploading");
    expect(video.publishedAt).toBeNull();
    expect(video.id).toHaveLength(11);
    // Deduplicated and sorted, because tags are a set.
    expect(video.tags).toEqual(["astro", "timelapse"]);
  });

  it("generates ids of the shape that fits in /watch?v=", () => {
    const id = newVideoId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{11}$/);
  });

  it("carries its channel without a second query", async () => {
    const { channelId } = await seedCreator(raw, {
      handle: "kurzgesagt",
      name: "Kurzgesagt",
    });
    const id = await seedVideo(raw, channelId);

    db.reset();
    const video = await getVideo(db, id);

    expect(db.count).toBe(1);
    expect(video?.channelName).toBe("Kurzgesagt");
    expect(video?.channelHandle).toBe("kurzgesagt");
  });

  it("patches only the columns it was given a name for", async () => {
    const { channelId } = await seedCreator(raw);
    const id = await seedVideo(raw, channelId, { viewCount: 500 });

    // `view_count` is a real column and not a name the patch map lists. It has
    // to be ignored rather than applied, or the update surface is the whole
    // table and any route that forwards a request body can rewrite a counter.
    const hostile = {
      title: "Retitled",
      view_count: 1_000_000_000,
    } as unknown as VideoPatch;

    const patched = await updateVideo(db, id, hostile);

    expect(patched?.title).toBe("Retitled");
    expect(patched?.viewCount).toBe(500);
  });

  it("returns null rather than throwing for a video that is not there", async () => {
    expect(await getVideo(db, "missing")).toBeNull();
    expect(await publishVideo(db, "missing")).toBeNull();
    expect(await updateVideo(db, "missing", { title: "x" })).toBeNull();
  });

  it("counts a view", async () => {
    const { channelId } = await seedCreator(raw);
    const id = await seedVideo(raw, channelId);
    await recordView(db, id);
    await recordView(db, id);
    expect((await getVideo(db, id))?.viewCount).toBe(2);
  });
});

describe("publishing", () => {
  it("flips the status and stamps the date", async () => {
    const { channelId } = await seedCreator(raw);
    const id = await seedVideo(raw, channelId, {
      uploadStatus: "processing",
      publishedAt: null,
    });

    const published = await publishVideo(db, id);

    expect(published?.uploadStatus).toBe("ready");
    expect(published?.publishedAt).toBeInstanceOf(Date);
  });

  it("keeps the original publish date when a video is published twice", async () => {
    const { channelId } = await seedCreator(raw);
    const original = new Date("2020-01-01T00:00:00.000Z");
    const id = await seedVideo(raw, channelId, { publishedAt: original });

    const republished = await publishVideo(db, id);

    expect(republished?.publishedAt?.toISOString()).toBe(
      original.toISOString(),
    );
  });

  /**
   * The rule exists twice — once in TypeScript for a caller that has not
   * written the row yet, once in SQL so publishing is a single statement. A
   * second expression of one rule is only safe while something checks that the
   * two agree, so this table is run through both.
   */
  const shortCases: readonly {
    label: string;
    width: number;
    height: number;
    durationSeconds: number;
    expected: boolean;
  }[] = [
    { label: "vertical and brief", width: 1080, height: 1920, durationSeconds: 45, expected: true },
    { label: "square and brief", width: 1080, height: 1080, durationSeconds: 45, expected: true },
    { label: "vertical at the duration limit", width: 1080, height: 1920, durationSeconds: SHORT_MAX_DURATION_SECONDS, expected: true },
    { label: "vertical one second over", width: 1080, height: 1920, durationSeconds: SHORT_MAX_DURATION_SECONDS + 1, expected: false },
    { label: "landscape and brief", width: 1920, height: 1080, durationSeconds: 30, expected: false },
    { label: "one pixel wider than tall", width: 1081, height: 1080, durationSeconds: 30, expected: false },
    { label: "dimensions unknown", width: 0, height: 0, durationSeconds: 30, expected: false },
    { label: "zero duration", width: 1080, height: 1920, durationSeconds: 0, expected: false },
  ];

  it.each(shortCases)(
    "derives is_short in SQL for a video that is $label",
    async ({ width, height, durationSeconds, expected }) => {
      const { channelId } = await seedCreator(raw);
      const id = await seedVideo(raw, channelId, {
        width,
        height,
        durationSeconds,
        isShort: !expected,
      });

      expect((await publishVideo(db, id))?.isShort).toBe(expected);
    },
  );

  it.each(shortCases)(
    "derives is_short in TypeScript for a video that is $label",
    ({ width, height, durationSeconds, expected }) => {
      expect(isShortVideo({ width, height, durationSeconds })).toBe(expected);
    },
  );

  it("uses three minutes and an aspect ratio of one", () => {
    expect(SHORT_MAX_DURATION_SECONDS).toBe(180);
    expect(SHORT_MAX_ASPECT_RATIO).toBe(1);
  });
});

describe("renditions", () => {
  const rung = (name: string, height: number, bandwidth: number) => ({
    name,
    width: Math.round((height * 16) / 9),
    height,
    bandwidth,
    codec: "avc1.4d401f",
    frameRate: 30,
    initKey: `${name}/init.mp4`,
    playlistKey: `${name}/index.m3u8`,
    segmentCount: 12,
    totalBytes: bandwidth * 60,
  });

  it("fetches the video and its ladder in a bounded number of queries", async () => {
    const { channelId } = await seedCreator(raw);
    const id = await seedVideo(raw, channelId);
    await replaceRenditions(db, id, [
      rung("720p", 720, 2_500_000),
      rung("1080p", 1080, 5_000_000),
    ]);

    db.reset();
    const loaded = await getVideoWithRenditions(db, id);

    expect(db.count).toBe(2);
    expect(loaded?.renditions.map((r) => r.name)).toEqual(["1080p", "720p"]);
    expect(loaded?.renditions[0]?.bandwidth).toBe(5_000_000);
    expect(loaded?.renditions[0]?.codec).toBe("avc1.4d401f");
  });

  it("replaces the ladder wholesale rather than merging rungs", async () => {
    const { channelId } = await seedCreator(raw);
    const id = await seedVideo(raw, channelId);

    await replaceRenditions(db, id, [rung("720p", 720, 2_500_000)]);
    await replaceRenditions(db, id, [rung("1080p", 1080, 5_000_000)]);

    const loaded = await getVideoWithRenditions(db, id);
    expect(loaded?.renditions.map((r) => r.name)).toEqual(["1080p"]);
  });

  it("survives an empty ladder", async () => {
    const { channelId } = await seedCreator(raw);
    const id = await seedVideo(raw, channelId);
    await replaceRenditions(db, id, []);
    expect((await getVideoWithRenditions(db, id))?.renditions).toEqual([]);
  });
});

describe("tags", () => {
  it("replaces the set and trims what it is given", async () => {
    const { channelId } = await seedCreator(raw);
    const id = await seedVideo(raw, channelId);

    await setTags(db, id, [" space ", "space", "", "physics"]);
    expect((await getVideo(db, id))?.tags).toEqual(["physics", "space"]);

    await setTags(db, id, ["chemistry"]);
    expect((await getVideo(db, id))?.tags).toEqual(["chemistry"]);
  });

  it("returns an empty array, not null, for an untagged video", async () => {
    const { channelId } = await seedCreator(raw);
    const id = await seedVideo(raw, channelId);
    expect((await getVideo(db, id))?.tags).toEqual([]);
  });
});

describe("the home feed", () => {
  it("shows public, ready, published, non-Short videos newest first", async () => {
    const { channelId } = await seedCreator(raw);
    const older = await seedVideo(raw, channelId, {
      publishedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const newer = await seedVideo(raw, channelId, {
      publishedAt: new Date("2026-06-01T00:00:00.000Z"),
    });

    await seedVideo(raw, channelId, { visibility: "private" });
    await seedVideo(raw, channelId, { visibility: "unlisted" });
    await seedVideo(raw, channelId, { uploadStatus: "processing" });
    await seedVideo(raw, channelId, { publishedAt: null });
    await seedVideo(raw, channelId, { isShort: true });

    const feed = await listHomeFeed(db);
    expect(feed.map((c) => c.id)).toEqual([newer, older]);
  });

  it("puts Shorts in the Shorts feed and nowhere else", async () => {
    const { channelId } = await seedCreator(raw);
    const short = await seedVideo(raw, channelId, {
      isShort: true,
      width: 1080,
      height: 1920,
      durationSeconds: 30,
    });
    const long = await seedVideo(raw, channelId);

    expect((await listShortsFeed(db)).map((c) => c.id)).toEqual([short]);
    expect((await listHomeFeed(db)).map((c) => c.id)).toEqual([long]);
  });

  it("carries the channel's name, handle and avatar on every card", async () => {
    const { channelId } = await seedCreator(raw, {
      handle: "veritasium",
      name: "Veritasium",
    });
    await seedVideo(raw, channelId);

    const [card] = await listHomeFeed(db);
    expect(card?.channelName).toBe("Veritasium");
    expect(card?.channelHandle).toBe("veritasium");
    expect(card?.channelAvatarKey).toBe(`${channelId}/avatar.jpg`);
  });

  it("distinguishes a video never started from one started at zero", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const started = await seedVideo(raw, channelId);
    const untouched = await seedVideo(raw, channelId);

    await raw.execute(
      `insert into watch_progress (user_id, video_id, position_seconds)
       values ($1, $2, 0)`,
      [viewer, started],
    );

    const byId = new Map(
      (await listHomeFeed(db, { viewerId: viewer })).map((c) => [c.id, c]),
    );
    expect(byId.get(started)?.watchedSeconds).toBe(0);
    expect(byId.get(untouched)?.watchedSeconds).toBeNull();
  });

  it("gives a signed-out viewer cards with no watch position", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const id = await seedVideo(raw, channelId);
    await raw.execute(
      `insert into watch_progress (user_id, video_id, position_seconds)
       values ($1, $2, 90)`,
      [viewer, id],
    );

    const [card] = await listHomeFeed(db);
    expect(card?.watchedSeconds).toBeNull();
  });

  it("pages without repeating or skipping a row", async () => {
    const { channelId } = await seedCreator(raw);
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      ids.push(
        await seedVideo(raw, channelId, {
          publishedAt: new Date(Date.UTC(2026, 0, i + 1)),
        }),
      );
    }
    const newestFirst = [...ids].reverse();

    // Exact sequences, not set membership. The order is total on both engines
    // now that every feed's `order by` ends in `id desc`, so a weaker assertion
    // here would be giving up the thing that tiebreaker was added to buy.
    expect((await listHomeFeed(db, { limit: 2 })).map((c) => c.id)).toEqual(
      newestFirst.slice(0, 2),
    );
    expect(
      (await listHomeFeed(db, { limit: 2, offset: 2 })).map((c) => c.id),
    ).toEqual(newestFirst.slice(2, 4));
    expect(
      (await listHomeFeed(db, { limit: 2, offset: 4 })).map((c) => c.id),
    ).toEqual(newestFirst.slice(4));
  });

  /**
   * The point of the whole projection. Forty cards, forty distinct channels,
   * every one of them with a watch position — the shape that makes the naïve
   * implementation issue eighty-one statements and return exactly these rows.
   */
  it("fetches forty cards from forty channels in one statement", async () => {
    const viewer = await seedUser(raw);
    for (let i = 0; i < 40; i += 1) {
      const owner = await seedUser(raw);
      const channelId = await seedChannel(raw, owner);
      const videoId = await seedVideo(raw, channelId, {
        publishedAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
      });
      await raw.execute(
        `insert into watch_progress (user_id, video_id, position_seconds)
         values ($1, $2, $3)`,
        [viewer, videoId, i],
      );
    }

    db.reset();
    const feed = await listHomeFeed(db, { viewerId: viewer, limit: 40 });

    expect(feed).toHaveLength(40);
    expect(db.count).toBe(1);
    expect(feed.every((c) => c.channelName.length > 0)).toBe(true);
    expect(feed.every((c) => typeof c.watchedSeconds === "number")).toBe(true);
  });

  it("costs one statement whether it returns one card or forty", async () => {
    const { channelId } = await seedCreator(raw);
    await seedVideo(raw, channelId);

    db.reset();
    await listHomeFeed(db);
    const forOne = db.count;

    for (let i = 0; i < 39; i += 1) {
      const owner = await seedUser(raw);
      await seedVideo(raw, await seedChannel(raw, owner));
    }

    db.reset();
    await listHomeFeed(db, { limit: 40 });
    expect(db.count).toBe(forOne);
  });
});

describe("a channel's videos", () => {
  it("hides drafts and private videos from the public", async () => {
    const { channelId } = await seedCreator(raw);
    const live = await seedVideo(raw, channelId);
    await seedVideo(raw, channelId, { visibility: "private" });
    await seedVideo(raw, channelId, { publishedAt: null });

    expect((await listChannelVideos(db, channelId)).map((c) => c.id)).toEqual([
      live,
    ]);
  });

  it("shows the owner everything, in one statement", async () => {
    const { channelId } = await seedCreator(raw);
    await seedVideo(raw, channelId);
    await seedVideo(raw, channelId, { visibility: "private" });
    await seedVideo(raw, channelId, { publishedAt: null, uploadStatus: "failed" });

    db.reset();
    const all = await listChannelVideos(db, channelId, {
      includeUnlisted: true,
    });
    expect(all).toHaveLength(3);
    expect(db.count).toBe(1);
  });

  it("sorts by popularity when asked", async () => {
    const { channelId } = await seedCreator(raw);
    const quiet = await seedVideo(raw, channelId, { viewCount: 10 });
    const loud = await seedVideo(raw, channelId, { viewCount: 1_000_000 });

    expect(
      (await listChannelVideos(db, channelId, { sort: "popular" })).map(
        (c) => c.id,
      ),
    ).toEqual([loud, quiet]);
  });

  it("keeps a Short in its channel's list", async () => {
    const { channelId } = await seedCreator(raw);
    const short = await seedVideo(raw, channelId, { isShort: true });
    expect((await listChannelVideos(db, channelId)).map((c) => c.id)).toEqual([
      short,
    ]);
  });
});

describe("cards for a ranked list of ids", () => {
  it("preserves the caller's order in one statement", async () => {
    const { channelId } = await seedCreator(raw);
    const a = await seedVideo(raw, channelId);
    const b = await seedVideo(raw, channelId);
    const c = await seedVideo(raw, channelId);

    db.reset();
    const cards = await listCardsByIds(db, [c, a, b]);

    expect(cards.map((card) => card.id)).toEqual([c, a, b]);
    expect(db.count).toBe(1);
  });

  it("asks nothing at all for an empty list", async () => {
    db.reset();
    expect(await listCardsByIds(db, [])).toEqual([]);
    expect(db.count).toBe(0);
  });

  it("silently drops ids that no longer exist", async () => {
    const { channelId } = await seedCreator(raw);
    const a = await seedVideo(raw, channelId);
    expect((await listCardsByIds(db, [a, "deleted"])).map((c) => c.id)).toEqual([
      a,
    ]);
  });
});

describe("the credit for licensed material", () => {
  it("round-trips, and survives the description being rewritten", async () => {
    const { channelId } = await seedCreator(raw);
    const created = await createVideo(db, {
      channelId,
      title: "Big Buck Bunny",
      description: "A rabbit, some rodents, and a great deal of fur.",
    });

    // Nothing owes a credit by default — most videos are their creator's own.
    expect(created.attribution).toBeNull();
    expect(created.licence).toBeNull();
    expect(created.licenceUrl).toBeNull();

    const credit = {
      attribution: "Blender Foundation | www.blender.org",
      licence: "CC BY 3.0",
      licenceUrl: "https://creativecommons.org/licenses/by/3.0/",
    };
    expect(await updateVideo(db, created.id, credit)).toMatchObject(credit);
    expect(await getVideo(db, created.id)).toMatchObject(credit);

    // The whole reason these are columns: the description is the uploader's to
    // edit, and CC-BY's attribution requirement is not.
    await updateVideo(db, created.id, { description: "New description." });
    expect(await getVideo(db, created.id)).toMatchObject(credit);
  });
});

describe("the verified tick", () => {
  it("reaches a card off the join the feed already makes", async () => {
    const channels = createChannelsRepository(raw);
    const verifiedOwner = await seedUser(raw);
    const plainOwner = await seedUser(raw);
    const verifiedChannel = await seedChannel(raw, verifiedOwner);
    const plainChannel = await seedChannel(raw, plainOwner);
    await channels.update(verifiedChannel, { verified: true });

    const verifiedVideo = await seedVideo(raw, verifiedChannel);
    const plainVideo = await seedVideo(raw, plainChannel);

    db.reset();
    const cards = await listHomeFeed(db, { limit: 10 });
    const byId = new Map(cards.map((card) => [card.id, card]));

    expect(byId.get(verifiedVideo)?.channelVerified).toBe(true);
    expect(byId.get(plainVideo)?.channelVerified).toBe(false);
    // Off the existing `join channels`, so two cards still cost one statement —
    // the property this whole projection exists to hold.
    expect(db.count).toBe(1);
  });

  it("round-trips on the channel itself", async () => {
    const channels = createChannelsRepository(raw);
    const ownerId = await seedUser(raw);
    const channelId = await seedChannel(raw, ownerId);

    expect((await channels.findById(channelId))?.verified).toBe(false);
    expect((await channels.update(channelId, { verified: true }))?.verified).toBe(
      true,
    );
    expect((await channels.findById(channelId))?.verified).toBe(true);
    expect((await channels.update(channelId, { verified: false }))?.verified).toBe(
      false,
    );
  });
});

/**
 * The setters exist because a corpus states facts about the past that no write
 * path can produce, and the thing worth testing about them is exactly that:
 * that they write what they say and nothing else.
 */
describe("the fixture setters", () => {
  it("writes the four facts it names, and only those", async () => {
    const { channelId } = await seedCreator(raw);
    const created = await createVideo(db, { channelId, title: "A video" });
    await publishVideo(db, created.id);
    await recordView(db, created.id);

    const publishedAt = new Date(Date.UTC(2025, 10, 4, 9, 30));
    const stamped = await stampVideoFixtureFacts(db, created.id, {
      publishedAt,
      viewCount: 1_204_338,
      likeCount: 41_207,
      dislikeCount: 903,
    });

    expect(stamped).toMatchObject({
      publishedAt,
      viewCount: 1_204_338,
      likeCount: 41_207,
      dislikeCount: 903,
      // Untouched: publishing is `publishVideo`'s job, and a setter that also
      // flipped these would be a second publish path.
      title: "A video",
      uploadStatus: "ready",
      commentCount: 0,
    });
    expect(await getVideo(db, created.id)).toMatchObject({
      publishedAt,
      viewCount: 1_204_338,
    });
  });

  it("leaves alone what it was not given", async () => {
    const { channelId } = await seedCreator(raw);
    const created = await createVideo(db, { channelId, title: "A video" });
    await publishVideo(db, created.id);
    await stampVideoFixtureFacts(db, created.id, { viewCount: 500 });

    const after = await getVideo(db, created.id);
    expect(after?.viewCount).toBe(500);
    // `published_at` was set by `publishVideo` and is not in the patch, so it
    // stands — a setter that wrote every column it knows about would silently
    // un-publish half a corpus.
    expect(after?.publishedAt).toBeInstanceOf(Date);
    expect(after?.likeCount).toBe(0);
  });

  it("gives a corpus the spread of upload dates a feed can order by", async () => {
    // The failure this closes: `publishVideo` writes `now()`, so every video in
    // a seeded library is published in the same second, `order by published_at
    // desc` degenerates to the id tiebreak, and every card reads "0 seconds
    // ago".
    const { channelId } = await seedCreator(raw);
    const ids: string[] = [];
    for (let month = 0; month < 4; month += 1) {
      const video = await createVideo(db, { channelId, title: `Video ${month}` });
      await publishVideo(db, video.id);
      await stampVideoFixtureFacts(db, video.id, {
        publishedAt: new Date(Date.UTC(2026, month, 1)),
      });
      ids.push(video.id);
    }

    const feed = await listHomeFeed(db, { limit: 10 });
    expect(feed.map((card) => card.id)).toEqual([...ids].reverse());
  });

  it("un-publishes on an explicit null, and reads on an empty patch", async () => {
    const { channelId } = await seedCreator(raw);
    const created = await createVideo(db, { channelId, title: "A video" });
    await publishVideo(db, created.id);

    expect(
      (await stampVideoFixtureFacts(db, created.id, { publishedAt: null }))
        ?.publishedAt,
    ).toBeNull();
    expect((await stampVideoFixtureFacts(db, created.id, {}))?.id).toBe(created.id);
    expect(await stampVideoFixtureFacts(db, "nosuchvideo", { viewCount: 1 })).toBeNull();
  });

  it("refuses a count that is not a count", async () => {
    const { channelId } = await seedCreator(raw);
    const created = await createVideo(db, { channelId, title: "A video" });

    // A corpus generator multiplying a power-law figure by a share produces
    // fractions, and a `bigint` column would report that from three layers down
    // as a type error naming neither the fixture nor the field.
    await expect(
      stampVideoFixtureFacts(db, created.id, { viewCount: 1.5 }),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      stampVideoFixtureFacts(db, created.id, { likeCount: -1 }),
    ).rejects.toBeInstanceOf(TypeError);
  });
});
