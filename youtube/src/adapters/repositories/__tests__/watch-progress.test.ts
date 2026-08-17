// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { SqlDatabase } from "@/adapters/db/driver";
import { getWatchProgress, listContinueWatching } from "../history";
import { newVideoId } from "../videos";
import {
  PROGRESS_MOVEMENT_THRESHOLD_SECONDS,
  PROGRESS_WRITE_INTERVAL_MS,
  clearWatchProgress,
  isWatchCompleted,
  recordWatchProgress,
} from "../watch-progress";

import { countingExecutor, createTestChannel, createTestUser, setupTestDatabase } from "./harness";

const t = setupTestDatabase();

const DURATION = 600;

/**
 * Every time in this suite is explicit and derived from one epoch.
 *
 * The throttle is arithmetic on `updated_at`, so a test that let the write path
 * stamp `now()` would be asserting against the speed of the machine it ran on —
 * and PGlite's `now()` stops at the millisecond, which is inside the interval
 * being tested.
 */
const EPOCH = Date.UTC(2026, 7, 16, 12, 0, 0);
const at = (secondsAfter: number): Date =>
  new Date(EPOCH + secondsAfter * 1000);

async function seedVideo(db: SqlDatabase): Promise<string> {
  const channel = await createTestChannel(db);
  const id = newVideoId();
  await db.execute(
    `insert into videos (id, channel_id, title, duration_seconds, upload_status,
                         published_at)
     values ($1, $2, 'A video', $3, 'ready', now())`,
    [id, channel.id, DURATION],
  );
  return id;
}

async function viewerAndVideo(): Promise<{ userId: string; videoId: string }> {
  const user = await createTestUser(t.db);
  return { userId: user.id, videoId: await seedVideo(t.db) };
}

/** A tick, with the boring fields filled in. */
function tick(
  userId: string | null,
  videoId: string,
  positionSeconds: number,
  atSeconds: number,
  overrides: {
    watchedSeconds?: number;
    durationSeconds?: number;
    reason?: "tick" | "pause" | "seek" | "ended" | "unload";
  } = {},
) {
  return {
    userId,
    videoId,
    positionSeconds,
    // Defaulting `watchedSeconds` to the position is the *ordinary* case —
    // somebody who has played from the start — so a test that cares about the
    // difference has to say so, which is the point.
    watchedSeconds: overrides.watchedSeconds ?? positionSeconds,
    durationSeconds: overrides.durationSeconds ?? DURATION,
    at: at(atSeconds),
    ...(overrides.reason ? { reason: overrides.reason } : {}),
  };
}

describe("the first report", () => {
  it("writes the row the red bar and the resume position come from", async () => {
    const { userId, videoId } = await viewerAndVideo();

    const result = await recordWatchProgress(t.db, tick(userId, videoId, 12, 12));

    expect(result.outcome).toBe("written");
    expect(result.progress).toMatchObject({
      videoId,
      positionSeconds: 12,
      completed: false,
    });
    // The point of the whole file: `history.ts` can now see something.
    expect((await getWatchProgress(t.db, userId, videoId))?.positionSeconds).toBe(12);
    expect(
      (await listContinueWatching(t.db, userId)).map((card) => card.id),
    ).toEqual([videoId]);
  });

  it("is an insert, so it is never throttled", async () => {
    const { userId, videoId } = await viewerAndVideo();
    // Quarter of a second in — inside the interval, under the threshold, and
    // still written, because there is no row to compare against yet.
    const result = await recordWatchProgress(
      t.db,
      tick(userId, videoId, 0.25, 0.25),
    );
    expect(result.outcome).toBe("written");
  });
});

describe("throttling", () => {
  it("suppresses the ticks a player fires between intervals", async () => {
    const { userId, videoId } = await viewerAndVideo();
    await recordWatchProgress(t.db, tick(userId, videoId, 10, 10));

    // `timeupdate` fires at 4–66 Hz; these are four of the sixty-odd reports
    // that arrive in the second after the write above.
    for (const offset of [0.25, 0.5, 0.75, 1]) {
      const result = await recordWatchProgress(
        t.db,
        tick(userId, videoId, 10 + offset, 10 + offset),
      );
      expect(result.outcome).toBe("throttled");
      expect(result.progress).toBeNull();
    }

    // Nothing moved. Not "moved a little" — the stored row is byte-identical.
    const stored = await getWatchProgress(t.db, userId, videoId);
    expect(stored?.positionSeconds).toBe(10);
    expect(stored?.updatedAt.getTime()).toBe(at(10).getTime());
  });

  it("lets one through once the interval has passed", async () => {
    const { userId, videoId } = await viewerAndVideo();
    await recordWatchProgress(t.db, tick(userId, videoId, 10, 10));

    const interval = PROGRESS_WRITE_INTERVAL_MS / 1000;
    // A hair inside the interval is still throttled; the boundary itself is not.
    expect(
      (await recordWatchProgress(
        t.db,
        tick(userId, videoId, 10 + interval - 0.1, 10 + interval - 0.1),
      )).outcome,
    ).toBe("throttled");

    const result = await recordWatchProgress(
      t.db,
      tick(userId, videoId, 10 + interval, 10 + interval),
    );
    expect(result.outcome).toBe("written");
    expect(result.progress?.positionSeconds).toBe(10 + interval);
  });

  it("suppresses a tick whose position has not moved, however long it has been", async () => {
    const { userId, videoId } = await viewerAndVideo();
    await recordWatchProgress(t.db, tick(userId, videoId, 10, 10));

    // A minute later, still parked at ten seconds: paused, buffering, or a tab
    // in the background. The interval has passed and the threshold has not.
    const parked = await recordWatchProgress(
      t.db,
      tick(userId, videoId, 10 + PROGRESS_MOVEMENT_THRESHOLD_SECONDS / 2, 70),
    );
    expect(parked.outcome).toBe("throttled");

    // …and the moment it does move by the threshold, it writes.
    const moved = await recordWatchProgress(
      t.db,
      tick(userId, videoId, 10 + PROGRESS_MOVEMENT_THRESHOLD_SECONDS, 71),
    );
    expect(moved.outcome).toBe("written");
  });

  it("issues no statement at all for a signed-out viewer", async () => {
    const { videoId } = await viewerAndVideo();
    const counting = countingExecutor(t.db);

    const result = await recordWatchProgress(counting, tick(null, videoId, 30, 30));

    expect(result).toEqual({ outcome: "anonymous", progress: null });
    // The table's primary key needs a user, so there is nowhere to put this —
    // and asking the database to find that out would be a round trip per tick
    // for every signed-out viewer on the site.
    expect(counting.statements).toEqual([]);
  });

  it("costs one statement per report, throttled or not", async () => {
    const { userId, videoId } = await viewerAndVideo();
    const counting = countingExecutor(t.db);

    await recordWatchProgress(counting, tick(userId, videoId, 10, 10));
    await recordWatchProgress(counting, tick(userId, videoId, 11, 11));

    // The throttle is a `where` on the conflict update rather than a read
    // followed by a write, which is what keeps the suppressed case as cheap as
    // the written one — and race-free.
    expect(counting.statements).toHaveLength(2);
  });
});

describe("flushing", () => {
  it("writes on a pause, a seek, an end and an unload without waiting", async () => {
    for (const reason of ["pause", "seek", "ended", "unload"] as const) {
      const { userId, videoId } = await viewerAndVideo();
      await recordWatchProgress(t.db, tick(userId, videoId, 10, 10));

      // Half a second later and half a second along: throttled as a tick.
      const result = await recordWatchProgress(
        t.db,
        tick(userId, videoId, 10.5, 10.5, { reason }),
      );

      expect(result.outcome).toBe("written");
      expect(result.progress?.positionSeconds).toBe(10.5);
    }
  });

  it("keeps a seek backwards, which is where the viewer now is", async () => {
    const { userId, videoId } = await viewerAndVideo();
    await recordWatchProgress(t.db, tick(userId, videoId, 300, 300));

    const result = await recordWatchProgress(
      t.db,
      tick(userId, videoId, 42, 301, { reason: "seek", watchedSeconds: 300 }),
    );

    expect(result.outcome).toBe("written");
    expect((await getWatchProgress(t.db, userId, videoId))?.positionSeconds).toBe(42);
  });

  it("cannot be rewound by a beacon that arrives late", async () => {
    const { userId, videoId } = await viewerAndVideo();

    // The tab closes at t=100 and its `unload` beacon is slow. Meanwhile the
    // viewer opens the video again and gets to t=200 — which lands first.
    await recordWatchProgress(t.db, tick(userId, videoId, 20, 200));
    const late = await recordWatchProgress(
      t.db,
      tick(userId, videoId, 500, 100, { reason: "unload" }),
    );

    expect(late.outcome).toBe("throttled");
    expect((await getWatchProgress(t.db, userId, videoId))?.positionSeconds).toBe(20);
  });
});

describe("completion", () => {
  it("marks a video finished when it was actually watched", async () => {
    const { userId, videoId } = await viewerAndVideo();

    const result = await recordWatchProgress(
      t.db,
      tick(userId, videoId, DURATION, DURATION, { reason: "ended" }),
    );

    expect(result.progress?.completed).toBe(true);
    // Off the shelf, which is what `completed` is for.
    expect(await listContinueWatching(t.db, userId)).toEqual([]);
  });

  it("does not mark a seek to the end as finished", async () => {
    const { userId, videoId } = await viewerAndVideo();

    // Ten seconds of a ten-minute video, then the scrubber dragged to the end.
    // `watched_seconds` is what tells the two apart, and the schema is explicit
    // that a seek to the end is not a view — this is the same rule seen from
    // the progress side.
    const result = await recordWatchProgress(
      t.db,
      tick(userId, videoId, DURATION, 12, {
        watchedSeconds: 10,
        reason: "seek",
      }),
    );

    expect(result.progress?.completed).toBe(false);
    expect(
      (await listContinueWatching(t.db, userId)).map((card) => card.id),
    ).toEqual([videoId]);
  });

  it("never throttles the tick that completes", async () => {
    const { userId, videoId } = await viewerAndVideo();
    // Two seconds short of the completion line, and written.
    const before = await recordWatchProgress(t.db, tick(userId, videoId, 568, 568));
    expect(before.progress?.completed).toBe(false);

    // Two seconds later — well inside the five-second interval, so a tick that
    // changed nothing else would be suppressed — and now past the line.
    // Deferring this would leave a finished video on the "Continue watching"
    // shelf, and a player that stops ticking at the end would leave it there
    // for good.
    const result = await recordWatchProgress(t.db, tick(userId, videoId, 570, 570));

    expect(result.outcome).toBe("written");
    expect(result.progress?.completed).toBe(true);
  });

  it("is impossible for a video whose duration is unknown", async () => {
    // The progressive fallback path can report zero here. Dividing by it would
    // make every such video either always or never finished.
    expect(
      isWatchCompleted({
        positionSeconds: 100,
        watchedSeconds: 100,
        durationSeconds: 0,
      }),
    ).toBe(false);
  });

  it("needs both the position and the watched credit", async () => {
    const base = { durationSeconds: 100 };
    // Reached the end, barely watched: a scrub.
    expect(isWatchCompleted({ ...base, positionSeconds: 99, watchedSeconds: 5 })).toBe(
      false,
    );
    // Watched almost all of it but stopped before the end: not finished.
    expect(isWatchCompleted({ ...base, positionSeconds: 80, watchedSeconds: 80 })).toBe(
      false,
    );
    // Skipped an intro and a sponsor read, then watched to the end.
    expect(isWatchCompleted({ ...base, positionSeconds: 96, watchedSeconds: 70 })).toBe(
      true,
    );
  });
});

describe("what it refuses and what it repairs", () => {
  it("throws on a position a media element reports before metadata loads", async () => {
    const { userId, videoId } = await viewerAndVideo();
    await expect(
      recordWatchProgress(t.db, tick(userId, videoId, Number.NaN, 5)),
    ).rejects.toBeInstanceOf(TypeError);
    // `double precision` accepts NaN, and every comparison against a stored NaN
    // is false — the row would stop updating for that viewer forever.
    expect(await getWatchProgress(t.db, userId, videoId)).toBeNull();
  });

  it("clamps a position outside the video's own timeline", async () => {
    const { userId, videoId } = await viewerAndVideo();

    const past = await recordWatchProgress(
      t.db,
      tick(userId, videoId, DURATION + 3, 10, { watchedSeconds: DURATION }),
    );
    expect(past.progress?.positionSeconds).toBe(DURATION);

    const negative = await recordWatchProgress(
      t.db,
      tick(userId, videoId, -5, 20, { reason: "seek" }),
    );
    expect(negative.progress?.positionSeconds).toBe(0);
  });

  it("leaves a position alone when the duration is not known yet", async () => {
    const { userId, videoId } = await viewerAndVideo();
    const result = await recordWatchProgress(
      t.db,
      tick(userId, videoId, 42, 42, { durationSeconds: 0 }),
    );
    expect(result.progress?.positionSeconds).toBe(42);
    expect(result.progress?.completed).toBe(false);
  });
});

describe("forgetting a video", () => {
  it("removes the row rather than resetting it to zero", async () => {
    const { userId, videoId } = await viewerAndVideo();
    await recordWatchProgress(t.db, tick(userId, videoId, 120, 120));

    expect(await clearWatchProgress(t.db, userId, videoId)).toBe(true);
    // `null`, not `0`: never started and seeked back to the start are different
    // states, and only one of them draws no bar.
    expect(await getWatchProgress(t.db, userId, videoId)).toBeNull();
    expect(await listContinueWatching(t.db, userId)).toEqual([]);
  });

  it("has nothing to forget for a signed-out viewer or an untouched video", async () => {
    const { userId, videoId } = await viewerAndVideo();
    const counting = countingExecutor(t.db);

    expect(await clearWatchProgress(counting, null, videoId)).toBe(false);
    expect(counting.statements).toEqual([]);
    expect(await clearWatchProgress(t.db, userId, videoId)).toBe(false);
  });
});
