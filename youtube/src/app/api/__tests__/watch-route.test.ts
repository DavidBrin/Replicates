// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/watch/route";
import { closeDatabaseForTests, database } from "@/adapters/db";
import type { SqlDatabase, SqlValue } from "@/adapters/db";
import {
  createTestChannel,
  createTestUser,
} from "@/adapters/repositories/__tests__/harness";
import { resetMediaAccessCacheForTests } from "@/adapters/repositories/media-access";
import { createVideo } from "@/adapters/repositories/videos";
import { resetConfigForTests } from "@/config/env";
import { SESSION_COOKIE, createSession } from "@/lib/auth";
import { VIEWER_KEY_COOKIE, mintViewerKey } from "@/lib/viewer/session-key";
import { HISTORY_PAUSED_COOKIE } from "@/lib/viewer/history-pause";
import { clearHistory } from "@/adapters/repositories/history";
import { num } from "@/adapters/repositories/shared";

/**
 * `POST /api/watch`, against a real database.
 *
 * This route is the only caller of `recordWatch`, `recordView` and
 * `recordWatchProgress`, and the property that matters is not that it writes —
 * it is **how often**. The reporter posts every few seconds for the whole
 * length of a video, and each of the three writes has a different correct
 * frequency:
 *
 *   progress   every report (throttled inside the repository)
 *   watch      once per session per video
 *   view       once per session per video, and always with the watch
 *
 * A version that got the gate wrong would look perfect on a single request and
 * would give a ten-minute video a hundred and twenty views. So almost every
 * test here posts more than once.
 */

const savedEnv = { ...process.env };

let db: SqlDatabase;
let ownerToken: string;
let ownerId: string;

/** A fresh key per test, so no two tests share a co-visitation session. */
function freshKey(): string {
  return mintViewerKey(Date.now()).value;
}

function watchRequest(
  body: Record<string, unknown>,
  options: { readonly key?: string | null; readonly session?: string | null } = {},
): Request {
  const cookies: string[] = [];
  if (options.key !== null) cookies.push(`${VIEWER_KEY_COOKIE}=${options.key ?? ""}`);
  if (options.session != null) cookies.push(`${SESSION_COOKIE}=${options.session}`);

  return new Request("http://localhost/api/watch", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookies.length > 0 ? { cookie: cookies.join("; ") } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** A report that clears the view threshold for a ten-minute video. */
function watched(videoId: string, seconds = 45) {
  return {
    videoId,
    positionSeconds: seconds,
    watchedSeconds: seconds,
    durationSeconds: 600,
    reason: "tick" as const,
  };
}

async function viewCount(videoId: string): Promise<number> {
  const rows = await db.query(`select view_count from videos where id = $1`, [videoId]);
  const row = rows[0];
  if (row === undefined) throw new Error(`no video ${videoId}`);
  return num(row, "view_count");
}

async function countRows(
  table: string,
  where: string,
  params: readonly SqlValue[],
): Promise<number> {
  const rows = await db.query(`select count(*)::int as n from ${table} where ${where}`, params);
  const row = rows[0];
  return row === undefined ? 0 : num(row, "n");
}

beforeAll(async () => {
  process.env = { ...savedEnv, DB_DATA_DIR: ":memory:", BLOB_DRIVER: "filesystem" };
  resetConfigForTests();
  resetMediaAccessCacheForTests();

  db = await database();
  const owner = await createTestUser(db, { email: "watcher@test.local" });
  const stranger = await createTestUser(db, { email: "stranger@test.local" });
  const ownerChannel = await createTestChannel(db, { ownerId: owner.id });
  const strangerChannel = await createTestChannel(db, { ownerId: stranger.id });

  for (const [id, channelId, visibility] of [
    ["pub1", ownerChannel.id, "public"],
    ["pub2", ownerChannel.id, "public"],
    ["short1", ownerChannel.id, "public"],
    ["secret1", strangerChannel.id, "private"],
  ] as const) {
    await createVideo(db, {
      id,
      channelId,
      title: `Video ${id}`,
      description: "",
      visibility,
      durationSeconds: id === "short1" ? 15 : 600,
    });
  }

  ownerId = owner.id;
  ownerToken = (await createSession(owner.id)).token;
});

beforeEach(async () => {
  // Only the tables this route writes. The fixtures above stay.
  await db.execute(`delete from covisitation`);
  await db.execute(`delete from session_videos`);
  await db.execute(`delete from video_session_counts`);
  await db.execute(`delete from watch_events`);
  await db.execute(`delete from watch_progress`);
  await db.execute(`delete from related_videos`);
  await db.execute(`update videos set view_count = 0`);
});

afterAll(async () => {
  await closeDatabaseForTests();
  process.env = savedEnv;
  resetConfigForTests();
});

describe("what a watch report writes", () => {
  it("counts one view no matter how many times the reporter posts", async () => {
    const key = freshKey();

    for (let post = 0; post < 20; post += 1) {
      const response = await POST(watchRequest(watched("pub1", 45 + post), { key }));
      expect(response.status).toBe(200);
    }

    // The whole reason `sessionHasLoggedWatch` exists. Without it this is 20.
    expect(await viewCount("pub1")).toBe(1);
    expect(await countRows("watch_events", "video_id = $1", ["pub1"])).toBe(1);
    expect(
      await countRows("session_videos", "session_key = $1 and video_id = $2", [
        key,
        "pub1",
      ]),
    ).toBe(1);
  });

  it("reports the view on exactly one response", async () => {
    const key = freshKey();
    const first = await POST(watchRequest(watched("pub1"), { key }));
    const second = await POST(watchRequest(watched("pub1", 60), { key }));

    expect(await first.json()).toMatchObject({ viewRecorded: true });
    expect(await second.json()).toMatchObject({ viewRecorded: false });
  });

  it("writes nothing to the graph before the threshold", async () => {
    const key = freshKey();
    // 10 seconds of a 600-second video: a real watch, and not yet a view.
    await POST(
      watchRequest(
        { ...watched("pub1"), watchedSeconds: 10, positionSeconds: 10 },
        { key },
      ),
    );

    expect(await viewCount("pub1")).toBe(0);
    expect(await countRows("watch_events", "video_id = $1", ["pub1"])).toBe(0);
  });

  it("counts a short at half its length rather than never", async () => {
    const key = freshKey();
    await POST(
      watchRequest(
        {
          videoId: "short1",
          positionSeconds: 8,
          watchedSeconds: 8,
          durationSeconds: 15,
          reason: "ended",
        },
        { key },
      ),
    );

    // A flat 30-second rule would leave every Short on zero for ever.
    expect(await viewCount("short1")).toBe(1);
  });

  it("does not count a scrub to the end", async () => {
    const key = freshKey();
    await POST(
      watchRequest(
        {
          videoId: "pub1",
          positionSeconds: 599,
          watchedSeconds: 0.5,
          durationSeconds: 600,
          reason: "seek",
        },
        { key },
      ),
    );

    // The schema's rule, end to end: "a seek to the end is not a view".
    expect(await viewCount("pub1")).toBe(0);
  });

  it("pairs two videos watched in one session, and only once", async () => {
    const key = freshKey();
    await POST(watchRequest(watched("pub1"), { key }));
    await POST(watchRequest(watched("pub2"), { key }));
    // A rewatch of the first, which must not re-increment the pair.
    await POST(watchRequest(watched("pub1", 120), { key }));

    const rows = await db.query(`select weight from covisitation`);
    expect(rows).toHaveLength(1);
    expect(num(rows[0] ?? {}, "weight")).toBe(1);
  });

  it("does not pair videos watched in two different sessions", async () => {
    // The rule the 30-minute idle gap exists to enforce, seen from the other
    // end: two sessions is two keys, and two keys share no pair.
    await POST(watchRequest(watched("pub1"), { key: freshKey() }));
    await POST(watchRequest(watched("pub2"), { key: freshKey() }));

    expect(await countRows("covisitation", "true", [])).toBe(0);
    expect(await viewCount("pub1")).toBe(1);
    expect(await viewCount("pub2")).toBe(1);
  });
});

describe("what history's own controls do to it", () => {
  it("records nothing at all while history is paused", async () => {
    const key = freshKey();
    const request = watchRequest(watched("pub1"), { key, session: ownerToken });
    request.headers.set(
      "cookie",
      `${request.headers.get("cookie")}; ${HISTORY_PAUSED_COOKIE}=1`,
    );

    const response = await POST(request);

    expect(await response.json()).toMatchObject({
      progress: "paused",
      viewRecorded: false,
    });
    expect(await viewCount("pub1")).toBe(0);
    expect(await countRows("watch_events", "video_id = $1", ["pub1"])).toBe(0);
    // The resume position too: a paused viewer who is told nothing is recorded
    // and finds their position saved has been misled about what pause means.
    expect(await countRows("watch_progress", "video_id = $1", ["pub1"])).toBe(0);
  });

  /**
   * Clearing history and rewatching in the same sitting.
   *
   * The gate used to ask `session_videos`, which `clearHistory` does not delete
   * from and cannot — that table is keyed on the viewing cookie and backs
   * counters other people's recommendations depend on. So a viewer who cleared
   * their history and rewatched hit a membership row that was still there, no
   * log row was written, and the history page stayed empty. Clearing history
   * made a video unrecordable for up to twenty-four hours, which is the worst
   * possible reading of a privacy control.
   */
  it("records a rewatch after the history was cleared", async () => {
    const key = freshKey();
    await POST(watchRequest(watched("pub1"), { key, session: ownerToken }));
    expect(await countRows("watch_events", "video_id = $1", ["pub1"])).toBe(1);
    expect(await viewCount("pub1")).toBe(1);

    await clearHistory(db, ownerId);
    expect(await countRows("watch_events", "video_id = $1", ["pub1"])).toBe(0);

    await POST(watchRequest(watched("pub1", 90), { key, session: ownerToken }));

    // The history entry comes back…
    expect(await countRows("watch_events", "video_id = $1", ["pub1"])).toBe(1);
    // …and the view count does not move again, because the membership row is
    // still there and `newToSession` is still false. Both halves matter: a fix
    // that deleted `session_videos` would have restored history by handing out
    // a second view.
    expect(await viewCount("pub1")).toBe(1);
  });
});

describe("who may report a watch", () => {
  it("stores a resume position for a signed-in viewer", async () => {
    const response = await POST(
      watchRequest(
        {
          videoId: "pub1",
          positionSeconds: 123,
          watchedSeconds: 123,
          durationSeconds: 600,
          reason: "pause",
        },
        { key: freshKey(), session: ownerToken },
      ),
    );

    expect(await response.json()).toMatchObject({ progress: "written" });
    expect(await countRows("watch_progress", "video_id = $1", ["pub1"])).toBe(1);
  });

  it("records the watch but no position for a signed-out viewer", async () => {
    const response = await POST(watchRequest(watched("pub1"), { key: freshKey() }));

    // The honest consequence of not having an account: the recommender still
    // learns from the watch, and only the resume position is lost.
    expect(await response.json()).toMatchObject({
      progress: "anonymous",
      viewRecorded: true,
    });
    expect(await countRows("watch_progress", "video_id = $1", ["pub1"])).toBe(0);
  });

  it("refuses to attribute a watch with no viewer key", async () => {
    const response = await POST(watchRequest(watched("pub1"), { key: null }));

    // Minting one here would be a new session per request: a graph of
    // single-video sessions, which has no pairs at all and yet looks populated.
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ viewRecorded: false });
    expect(await viewCount("pub1")).toBe(0);
  });

  it("refuses a forged viewer key", async () => {
    const response = await POST(
      watchRequest(watched("pub1"), { key: "../../etc/passwd" }),
    );
    expect(await response.json()).toMatchObject({ viewRecorded: false });
    expect(await viewCount("pub1")).toBe(0);
  });

  it("404s someone else's private video", async () => {
    const response = await POST(
      watchRequest(watched("secret1"), { key: freshKey(), session: ownerToken }),
    );

    // Otherwise a private video's id is an oracle: a report against it moves a
    // counter its owner can see, and enters it into a graph that surfaces
    // related videos on public pages.
    expect(response.status).toBe(404);
    expect(await viewCount("secret1")).toBe(0);
  });

  it("404s a video that does not exist", async () => {
    const response = await POST(watchRequest(watched("nope"), { key: freshKey() }));
    expect(response.status).toBe(404);
  });
});

describe("what the route refuses to believe", () => {
  /**
   * The duration is the database's, and these are the tests that say so.
   *
   * The first version of this block passed `durationSeconds: 600` in the body
   * of a video that really is 600 seconds long, so it could not tell a route
   * that read the database from one that read the request — which is what the
   * route did, and it made view inflation two lines. Every duration in a
   * request below is therefore **deliberately wrong**.
   */
  it("does not let a small claimed duration buy a view", async () => {
    const key = freshKey();
    // `pub1` is 600 seconds. Claiming it is one second long puts the threshold
    // at half a second, which the half-second of claimed viewing then clears.
    const response = await POST(
      watchRequest(
        {
          videoId: "pub1",
          positionSeconds: 0.5,
          watchedSeconds: 0.5,
          durationSeconds: 1,
          reason: "tick",
        },
        { key },
      ),
    );

    expect(await response.json()).toMatchObject({ viewRecorded: false });
    expect(await viewCount("pub1")).toBe(0);
  });

  it("does not let a huge claimed duration suppress one", async () => {
    // The other direction, which a one-sided test would miss: claiming a short
    // video is enormous would raise its threshold out of reach and let anyone
    // freeze a rival's view count by reporting on their behalf.
    const key = freshKey();
    await POST(
      watchRequest(
        {
          videoId: "short1", // really 15 seconds; threshold 7.5
          positionSeconds: 8,
          watchedSeconds: 8,
          durationSeconds: 86_400,
          reason: "ended",
        },
        { key },
      ),
    );

    expect(await viewCount("short1")).toBe(1);
  });

  it("caps a claim at the video's real length, not the claimed one", async () => {
    const key = freshKey();
    await POST(
      watchRequest(
        {
          videoId: "pub1",
          positionSeconds: 600,
          watchedSeconds: 31_536_000, // a year
          durationSeconds: 31_536_000, // …and a matching lie about the video
          reason: "ended",
        },
        { key },
      ),
    );

    const rows = await db.query(
      `select watched_seconds from watch_events where video_id = $1`,
      ["pub1"],
    );
    // 600, the row's own duration — not the year, and not the year the request
    // asked us to cap against.
    expect(num(rows[0] ?? {}, "watched_seconds")).toBe(600);
  });

  it("rejects a report that is not one", async () => {
    const bad = [
      {},
      { videoId: "pub1" },
      { videoId: "", positionSeconds: 1, watchedSeconds: 1, durationSeconds: 1 },
      { videoId: "pub1", positionSeconds: -1, watchedSeconds: 1, durationSeconds: 1 },
      {
        videoId: "pub1",
        positionSeconds: 1,
        watchedSeconds: Number.NaN,
        durationSeconds: 1,
      },
      { videoId: "pub1", positionSeconds: 1, watchedSeconds: 1, durationSeconds: 1, reason: "x" },
    ];

    for (const body of bad) {
      const response = await POST(watchRequest(body, { key: freshKey() }));
      expect(response.status).toBe(400);
    }
  });

  it("refuses a cross-site request outright", async () => {
    // `SameSite=Lax` stops the cookie being *sent*; it does not stop the
    // request being delivered, and this one moves a public counter.
    const request = watchRequest(watched("pub1"), { key: freshKey() });
    request.headers.set("sec-fetch-site", "cross-site");

    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(await viewCount("pub1")).toBe(0);
  });

  it("refuses one whose Origin is not ours", async () => {
    const request = watchRequest(watched("pub1"), { key: freshKey() });
    request.headers.set("origin", "https://evil.example");

    expect((await POST(request)).status).toBe(403);
  });

  it("allows one with no fetch metadata at all", async () => {
    // curl, a mobile client, an old browser. None of them is the CSRF threat
    // model, which is specifically a browser the victim is already using.
    const response = await POST(watchRequest(watched("pub1"), { key: freshKey() }));
    expect(response.status).toBe(200);
  });

  it("rejects a body that is not JSON", async () => {
    const response = await POST(
      new Request("http://localhost/api/watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(response.status).toBe(400);
  });
});
