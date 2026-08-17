// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { SqlDatabase, SqlExecutor } from "@/adapters/db/driver";
import {
  getWatchPositions,
  getWatchProgress,
  listContinueWatching,
  listHistory,
} from "../history";
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
  await raw.execute("delete from watch_events");
  await raw.execute("delete from watch_progress");
  await raw.execute("delete from videos");
  await raw.execute("delete from channels");
  await raw.execute("delete from users");
  db.reset();
});

/**
 * The write path belongs to another slice, so these suites write the rows
 * directly. Every timestamp is explicit: PGlite's `now()` stops at the
 * millisecond, and a history test is entirely about what fell on which day.
 */
async function watched(
  sql: SqlExecutor,
  userId: string,
  videoId: string,
  at: string,
): Promise<void> {
  await sql.execute(
    `insert into watch_events (user_id, session_key, video_id, watched_at,
                               watched_seconds)
     values ($1, $2, $3, $4, 60)`,
    [userId, `session-${userId}`, videoId, at],
  );
}

async function progress(
  sql: SqlExecutor,
  userId: string,
  videoId: string,
  seconds: number,
  options: { completed?: boolean; updatedAt?: string } = {},
): Promise<void> {
  await sql.execute(
    `insert into watch_progress (user_id, video_id, position_seconds, completed,
                                 updated_at)
     values ($1, $2, $3, $4, coalesce($5::timestamptz, now()))
     on conflict (user_id, video_id) do update
       set position_seconds = excluded.position_seconds,
           completed = excluded.completed,
           updated_at = excluded.updated_at`,
    [userId, videoId, seconds, options.completed ?? false, options.updatedAt ?? null],
  );
}

describe("the history page", () => {
  it("groups by day, newest day first and newest watch first within it", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const morning = await seedVideo(raw, channelId);
    const evening = await seedVideo(raw, channelId);
    const yesterday = await seedVideo(raw, channelId);

    await watched(raw, viewer, morning, "2026-08-16T09:00:00.000Z");
    await watched(raw, viewer, evening, "2026-08-16T21:00:00.000Z");
    await watched(raw, viewer, yesterday, "2026-08-15T12:00:00.000Z");

    const days = await listHistory(db, viewer, {
      now: new Date("2026-08-16T23:00:00.000Z"),
    });

    expect(days.map((d) => d.dayKey)).toEqual(["2026-08-16", "2026-08-15"]);
    expect(days.map((d) => d.heading)).toEqual(["Today", "Yesterday"]);
    expect(days[0]?.items.map((c) => c.id)).toEqual([evening, morning]);
    expect(days[1]?.items.map((c) => c.id)).toEqual([yesterday]);
  });

  it("shows a video once per day it was watched, at its latest time", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const repeated = await seedVideo(raw, channelId);
    const other = await seedVideo(raw, channelId);

    await watched(raw, viewer, repeated, "2026-08-16T08:00:00.000Z");
    await watched(raw, viewer, repeated, "2026-08-16T20:00:00.000Z");
    await watched(raw, viewer, other, "2026-08-16T12:00:00.000Z");
    await watched(raw, viewer, repeated, "2026-08-15T10:00:00.000Z");

    const days = await listHistory(db, viewer, {
      now: new Date("2026-08-16T23:00:00.000Z"),
    });

    // Once in today, at 20:00 — so ahead of the 12:00 watch, not behind it.
    expect(days[0]?.items.map((c) => c.id)).toEqual([repeated, other]);
    // And again under yesterday, which is a different day's viewing.
    expect(days[1]?.items.map((c) => c.id)).toEqual([repeated]);
  });

  it("files a late-evening watch on the viewer's day, not on UTC's", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const videoId = await seedVideo(raw, channelId);

    // 23:30 on the 16th in New York; 03:30 on the 17th in UTC.
    await watched(raw, viewer, videoId, "2026-08-17T03:30:00.000Z");

    const inUtc = await listHistory(db, viewer, { timeZone: "UTC" });
    const inNewYork = await listHistory(db, viewer, {
      timeZone: "America/New_York",
    });

    expect(inUtc[0]?.dayKey).toBe("2026-08-17");
    expect(inNewYork[0]?.dayKey).toBe("2026-08-16");
  });

  it("carries the resume position that draws the red bar", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const resumed = await seedVideo(raw, channelId);
    const untouched = await seedVideo(raw, channelId);

    await watched(raw, viewer, resumed, "2026-08-16T09:00:00.000Z");
    await watched(raw, viewer, untouched, "2026-08-16T10:00:00.000Z");
    await progress(raw, viewer, resumed, 125.5);

    const items = (await listHistory(db, viewer))[0]?.items ?? [];
    const byId = new Map(items.map((c) => [c.id, c]));
    expect(byId.get(resumed)?.watchedSeconds).toBe(125.5);
    expect(byId.get(untouched)?.watchedSeconds).toBeNull();
  });

  it("reads a whole page of history in one statement", async () => {
    const viewer = await seedUser(raw);
    for (let i = 0; i < 30; i += 1) {
      const owner = await seedUser(raw);
      const channelId = await seedChannel(raw, owner);
      const videoId = await seedVideo(raw, channelId);
      await watched(
        raw,
        viewer,
        videoId,
        `2026-08-${String(10 + (i % 5)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00.000Z`,
      );
      await progress(raw, viewer, videoId, i + 1);
    }

    db.reset();
    const days = await listHistory(db, viewer);

    expect(db.count).toBe(1);
    expect(days).toHaveLength(5);
    expect(days.flatMap((d) => d.items)).toHaveLength(30);
    expect(
      days.flatMap((d) => d.items).every((c) => c.channelName.length > 0),
    ).toBe(true);
  });

  it("gives a signed-out viewer an empty history without asking anything", async () => {
    db.reset();
    expect(await listHistory(db, null)).toEqual([]);
    expect(db.count).toBe(0);
  });

  it("shows nothing for a viewer who has watched nothing", async () => {
    const viewer = await seedUser(raw);
    expect(await listHistory(db, viewer)).toEqual([]);
  });
});

describe("continue watching", () => {
  it("lists what was started and not finished, most recent first", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const older = await seedVideo(raw, channelId);
    const newer = await seedVideo(raw, channelId);
    const finished = await seedVideo(raw, channelId);
    const untouched = await seedVideo(raw, channelId);

    await progress(raw, viewer, older, 30, {
      updatedAt: "2026-08-10T00:00:00.000Z",
    });
    await progress(raw, viewer, newer, 90, {
      updatedAt: "2026-08-15T00:00:00.000Z",
    });
    await progress(raw, viewer, finished, 600, {
      completed: true,
      updatedAt: "2026-08-16T00:00:00.000Z",
    });

    const shelf = await listContinueWatching(db, viewer);

    expect(shelf.map((c) => c.id)).toEqual([newer, older]);
    expect(shelf.map((c) => c.id)).not.toContain(finished);
    expect(shelf.map((c) => c.id)).not.toContain(untouched);
  });

  it("leaves out a video parked at zero, which is not started", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const videoId = await seedVideo(raw, channelId);
    await progress(raw, viewer, videoId, 0);

    expect(await listContinueWatching(db, viewer)).toEqual([]);
  });

  it("is empty and free for a signed-out viewer", async () => {
    db.reset();
    expect(await listContinueWatching(db, null)).toEqual([]);
    expect(db.count).toBe(0);
  });

  it("takes one statement whatever the shelf's length", async () => {
    const viewer = await seedUser(raw);
    for (let i = 0; i < 20; i += 1) {
      const owner = await seedUser(raw);
      const videoId = await seedVideo(raw, await seedChannel(raw, owner));
      await progress(raw, viewer, videoId, i + 1, {
        updatedAt: `2026-08-16T00:${String(i).padStart(2, "0")}:00.000Z`,
      });
    }

    db.reset();
    expect(await listContinueWatching(db, viewer, { limit: 20 })).toHaveLength(20);
    expect(db.count).toBe(1);
  });
});

describe("resume positions", () => {
  it("reports where playback resumes", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const videoId = await seedVideo(raw, channelId);
    await progress(raw, viewer, videoId, 42.5);

    const found = await getWatchProgress(db, viewer, videoId);
    expect(found?.positionSeconds).toBe(42.5);
    expect(found?.completed).toBe(false);
    expect(found?.updatedAt).toBeInstanceOf(Date);
  });

  it("has nothing to report for an unopened video or a signed-out viewer", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const videoId = await seedVideo(raw, channelId);

    expect(await getWatchProgress(db, viewer, videoId)).toBeNull();
    db.reset();
    expect(await getWatchProgress(db, null, videoId)).toBeNull();
    expect(db.count).toBe(0);
  });

  it("answers for a page of videos in one statement, absent meaning unstarted", async () => {
    const viewer = await seedUser(raw);
    const { channelId } = await seedCreator(raw);
    const started = await seedVideo(raw, channelId);
    const parked = await seedVideo(raw, channelId);
    const untouched = await seedVideo(raw, channelId);

    await progress(raw, viewer, started, 12);
    await progress(raw, viewer, parked, 0);

    db.reset();
    const positions = await getWatchPositions(db, viewer, [
      started,
      parked,
      untouched,
    ]);

    expect(db.count).toBe(1);
    expect(positions.get(started)).toBe(12);
    // Present at zero: seeked back to the start is not the same as never opened.
    expect(positions.get(parked)).toBe(0);
    expect(positions.has(untouched)).toBe(false);
  });

  it("asks nothing for a signed-out viewer or an empty page", async () => {
    const viewer = await seedUser(raw);
    db.reset();
    expect(await getWatchPositions(db, null, ["a"])).toEqual(new Map());
    expect(await getWatchPositions(db, viewer, [])).toEqual(new Map());
    expect(db.count).toBe(0);
  });
});
