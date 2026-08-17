// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { SqlDatabase } from "@/adapters/db/driver";
import { ensureSystemPlaylist, listPlaylistItems } from "../playlists";
import {
  ReactionTargetNotFoundError,
  getViewerReaction,
  getViewerReactions,
  reactToComment,
  reactToVideo,
} from "../reactions";
import type { QueryCounter } from "./library-harness";
import {
  countingDatabase,
  createTestDatabase,
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
  await raw.execute("delete from reactions");
  await raw.execute("delete from comments");
  await raw.execute("delete from playlists");
  await raw.execute("delete from videos");
  await raw.execute("delete from channels");
  await raw.execute("delete from users");
  db.reset();
});

async function counts(videoId: string): Promise<[number, number]> {
  const rows = await raw.query(
    `select like_count, dislike_count from videos where id = $1`,
    [videoId],
  );
  return [Number(rows[0]?.like_count), Number(rows[0]?.dislike_count)];
}

async function reactionRows(userId: string): Promise<number> {
  const rows = await raw.query(
    `select count(*) as n from reactions where user_id = $1`,
    [userId],
  );
  return Number(rows[0]?.n);
}

describe("the video reaction state machine", () => {
  it("goes none → like → none", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const videoId = await seedVideo(raw, channelId);

    const liked = await reactToVideo(db, viewer, videoId, 1);
    expect(liked).toEqual({
      viewerReaction: 1,
      likeCount: 1,
      dislikeCount: 0,
    });

    const unliked = await reactToVideo(db, viewer, videoId, 1);
    expect(unliked).toEqual({
      viewerReaction: null,
      likeCount: 0,
      dislikeCount: 0,
    });
    // Taking a like back removes the row rather than storing a zero.
    expect(await reactionRows(viewer)).toBe(0);
  });

  it("goes none → like → dislike → none", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const videoId = await seedVideo(raw, channelId);

    await reactToVideo(db, viewer, videoId, 1);

    const disliked = await reactToVideo(db, viewer, videoId, -1);
    expect(disliked).toEqual({
      viewerReaction: -1,
      likeCount: 0,
      dislikeCount: 1,
    });
    // One opinion, one row: the switch was an update, not a second row.
    expect(await reactionRows(viewer)).toBe(1);

    const cleared = await reactToVideo(db, viewer, videoId, -1);
    expect(cleared).toEqual({
      viewerReaction: null,
      likeCount: 0,
      dislikeCount: 0,
    });
  });

  it("goes none → dislike → like", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const videoId = await seedVideo(raw, channelId);

    await reactToVideo(db, viewer, videoId, -1);
    expect(await counts(videoId)).toEqual([0, 1]);

    const liked = await reactToVideo(db, viewer, videoId, 1);
    expect(liked.viewerReaction).toBe(1);
    expect(await counts(videoId)).toEqual([1, 0]);
  });

  it("switches sides in one statement, not a delete and an insert", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const videoId = await seedVideo(raw, channelId);
    await reactToVideo(db, viewer, videoId, 1);

    db.reset();
    await reactToVideo(db, viewer, videoId, -1);

    const writes = db.statements.filter((s) => /^with prior/.test(s));
    expect(writes).toHaveLength(1);
  });

  it("keeps two viewers' opinions apart while interleaving them", async () => {
    const ada = await seedUser(raw);
    const grace = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const videoId = await seedVideo(raw, channelId);

    await reactToVideo(db, ada, videoId, 1);
    await reactToVideo(db, grace, videoId, 1);
    expect(await counts(videoId)).toEqual([2, 0]);

    await reactToVideo(db, ada, videoId, -1);
    expect(await counts(videoId)).toEqual([1, 1]);

    await reactToVideo(db, grace, videoId, 1);
    expect(await counts(videoId)).toEqual([0, 1]);

    await reactToVideo(db, ada, videoId, -1);
    expect(await counts(videoId)).toEqual([0, 0]);

    expect(await getViewerReaction(db, ada, "video", videoId)).toBeNull();
    expect(await getViewerReaction(db, grace, "video", videoId)).toBeNull();
  });

  it("never lets a count go negative", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const videoId = await seedVideo(raw, channelId);

    await reactToVideo(db, viewer, videoId, 1);
    // Something outside this path cleared the counter — a migration, a repair
    // script — and the un-like must not drive it below zero.
    await raw.execute(`update videos set like_count = 0 where id = $1`, [videoId]);

    const result = await reactToVideo(db, viewer, videoId, 1);
    expect(result.likeCount).toBe(0);
  });

  it("refuses a video that does not exist, leaving no orphan row", async () => {
    const viewer = await seedUser(raw);
    await expect(
      reactToVideo(db, viewer, "missing", 1),
    ).rejects.toBeInstanceOf(ReactionTargetNotFoundError);
    expect(await reactionRows(viewer)).toBe(0);
  });
});

describe("liking is what puts a video in the liked playlist", () => {
  it("adds on a like and removes when the like is taken back", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const videoId = await seedVideo(raw, channelId);

    await reactToVideo(db, viewer, videoId, 1);
    const liked = await ensureSystemPlaylist(db, viewer, "liked");
    expect((await listPlaylistItems(db, liked)).map((c) => c.id)).toEqual([
      videoId,
    ]);

    await reactToVideo(db, viewer, videoId, 1);
    expect(await listPlaylistItems(db, liked)).toEqual([]);
  });

  it("removes when the like becomes a dislike", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const videoId = await seedVideo(raw, channelId);

    await reactToVideo(db, viewer, videoId, 1);
    await reactToVideo(db, viewer, videoId, -1);

    const liked = await ensureSystemPlaylist(db, viewer, "liked");
    expect(await listPlaylistItems(db, liked)).toEqual([]);
  });

  it("never adds for a dislike", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const videoId = await seedVideo(raw, channelId);

    await reactToVideo(db, viewer, videoId, -1);

    const liked = await ensureSystemPlaylist(db, viewer, "liked");
    expect(await listPlaylistItems(db, liked)).toEqual([]);
  });

  it("holds a video once, however many times the like is toggled", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const videoId = await seedVideo(raw, channelId);

    for (let i = 0; i < 5; i += 1) {
      await reactToVideo(db, viewer, videoId, 1);
      await reactToVideo(db, viewer, videoId, 1);
    }
    await reactToVideo(db, viewer, videoId, 1);

    const liked = await ensureSystemPlaylist(db, viewer, "liked");
    expect(await listPlaylistItems(db, liked)).toHaveLength(1);
    expect((await counts(videoId))[0]).toBe(1);
  });

  it("rolls the playlist back with the reaction when the video is gone", async () => {
    const viewer = await seedUser(raw);
    // The liked playlist already exists, so a failed like must not leave an
    // item in it.
    const liked = await ensureSystemPlaylist(db, viewer, "liked");

    await expect(reactToVideo(db, viewer, "missing", 1)).rejects.toThrow();
    expect(await listPlaylistItems(db, liked)).toEqual([]);
  });
});

describe("comment reactions", () => {
  async function seedComment(): Promise<{ viewer: string; commentId: string }> {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const videoId = await seedVideo(raw, channelId);
    await raw.execute(
      `insert into comments (id, video_id, author_id, body)
       values ('cm-1', $1, $2, 'Nice')`,
      [videoId, viewer],
    );
    return { viewer, commentId: "cm-1" };
  }

  it("counts likes and toggles them off", async () => {
    const { viewer, commentId } = await seedComment();

    expect((await reactToComment(db, viewer, commentId, 1)).likeCount).toBe(1);
    expect((await reactToComment(db, viewer, commentId, 1)).likeCount).toBe(0);
  });

  it("stores a dislike without counting it", async () => {
    const { viewer, commentId } = await seedComment();

    const disliked = await reactToComment(db, viewer, commentId, -1);
    expect(disliked.viewerReaction).toBe(-1);
    expect(disliked.likeCount).toBe(0);
    // Stored, or pressing dislike again would have nothing to take back.
    expect(await reactionRows(viewer)).toBe(1);

    expect((await reactToComment(db, viewer, commentId, -1)).viewerReaction)
      .toBeNull();
  });

  it("takes the like count down when a like becomes a dislike", async () => {
    const { viewer, commentId } = await seedComment();

    await reactToComment(db, viewer, commentId, 1);
    expect((await reactToComment(db, viewer, commentId, -1)).likeCount).toBe(0);
  });

  it("keeps a comment's reaction separate from a video's with the same id", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    // One id, two kinds — the composite key is what keeps them apart.
    const videoId = await seedVideo(raw, channelId, { id: "shared-id" });
    await raw.execute(
      `insert into comments (id, video_id, author_id, body)
       values ('shared-id', $1, $2, 'Nice')`,
      [videoId, viewer],
    );

    await reactToVideo(db, viewer, "shared-id", 1);
    await reactToComment(db, viewer, "shared-id", -1);

    expect(await getViewerReaction(db, viewer, "video", "shared-id")).toBe(1);
    expect(await getViewerReaction(db, viewer, "comment", "shared-id")).toBe(-1);
  });

  it("refuses a comment that does not exist", async () => {
    const viewer = await seedUser(raw);
    await expect(
      reactToComment(db, viewer, "missing", 1),
    ).rejects.toBeInstanceOf(ReactionTargetNotFoundError);
  });
});

describe("reading reactions back", () => {
  it("answers for a page of targets in one statement", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const liked = await seedVideo(raw, channelId);
    const disliked = await seedVideo(raw, channelId);
    const untouched = await seedVideo(raw, channelId);

    await reactToVideo(db, viewer, liked, 1);
    await reactToVideo(db, viewer, disliked, -1);

    db.reset();
    const map = await getViewerReactions(db, viewer, "video", [
      liked,
      disliked,
      untouched,
    ]);

    expect(db.count).toBe(1);
    expect(map.get(liked)).toBe(1);
    expect(map.get(disliked)).toBe(-1);
    expect(map.has(untouched)).toBe(false);
  });

  it("asks nothing for a signed-out viewer", async () => {
    db.reset();
    expect(await getViewerReaction(db, null, "video", "any")).toBeNull();
    expect(await getViewerReactions(db, null, "video", ["a"])).toEqual(new Map());
    expect(db.count).toBe(0);
  });
});
