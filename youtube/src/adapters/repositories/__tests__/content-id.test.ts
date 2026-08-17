// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createPGliteDatabase } from "@/adapters/db/pglite";
import type { SqlDatabase } from "@/adapters/db";
import {
  buildIndex,
  fingerprint,
  matchAgainstIndex,
  packHash,
  HOP_MS,
  MATCH_SCORE_THRESHOLD,
  QUERY_SHIFTS,
  type Fingerprint,
} from "@/domain/fingerprint";
import {
  addNoise,
  excerpt,
  gain,
  lowPass,
  makeTrack,
} from "@/domain/fingerprint/__tests__/synthetic-audio";
import {
  claimsForVideo,
  countFingerprints,
  createClaim,
  deleteWork,
  findWork,
  fromStoredHash,
  matchFingerprint,
  registerWork,
  scanVideo,
  setClaimStatus,
  storeFingerprint,
  toStoredHash,
} from "../content-id";

/**
 * The repository suite, against a real in-process Postgres.
 *
 * PGlite with no data directory — the same WASM Postgres 18 the application
 * runs locally, the same `schema.sql`, the same planner. A mock would prove
 * nothing about a query whose whole point is a window `RANGE` frame and a
 * `distinct on`.
 *
 * This file deliberately does **not** use the shared
 * `__tests__/harness.ts` in this directory. That file belongs to another slice
 * building concurrently; the four lines of setup below are cheaper than a
 * coupling neither of us asked for.
 */

let db: SqlDatabase;

/** A minimal video row. `claims.video_id` has a real foreign key. */
async function seedVideo(id: string): Promise<string> {
  await db.execute(
    `insert into users (id, email, password_hash, display_name)
     values ($1, $2, 'x', 'Uploader') on conflict (id) do nothing`,
    ["u-content-id", "uploader@example.com"],
  );
  await db.execute(
    `insert into channels (id, owner_id, handle, name)
     values ($1, $2, $3, 'Channel') on conflict (id) do nothing`,
    ["c-content-id", "u-content-id", "contentid"],
  );
  await db.execute(
    `insert into videos (id, channel_id, title) values ($1, $2, $3)`,
    [id, "c-content-id", `Video ${id}`],
  );
  return id;
}

beforeAll(async () => {
  db = await createPGliteDatabase(":memory:");
  await db.migrate();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.execute("delete from claims");
  await db.execute("delete from fingerprints");
  await db.execute("delete from reference_works");
  await db.execute("delete from videos");
});

/* ------------------------------------------------------------ the index -- */

describe("registerWork / storeFingerprint", () => {
  it("registers a work with a policy and reads it back", async () => {
    const work = await registerWork(db, {
      id: "ref-1",
      title: "Nocturne",
      rightsHolder: "Example Publishing",
      policy: "block",
      durationSeconds: 212.5,
    });

    expect(work.policy).toBe("block");
    expect(work.durationSeconds).toBeCloseTo(212.5, 6);
    expect(await findWork(db, "ref-1")).toEqual(work);
  });

  it("defaults to monetise, which is what the schema says", async () => {
    const work = await registerWork(db, { title: "T", rightsHolder: "R" });
    expect(work.policy).toBe("monetise");
    // The house id shape from `shared.ts`: a prefix so a row is identifiable at
    // a glance in a diagnostic query, then 96 bits of base64url.
    expect(work.id).toMatch(/^ref_[A-Za-z0-9_-]{16}$/);
  });

  it("rejects a policy the schema does not allow", async () => {
    await expect(
      registerWork(db, {
        title: "T",
        rightsHolder: "R",
        policy: "takedown" as never,
      }),
    ).rejects.toThrow();
  });

  it("writes one landmark row per hash", async () => {
    await registerWork(db, { id: "ref-1", title: "T", rightsHolder: "R" });
    const fp = fingerprint(makeTrack(1, { seconds: 10 }));
    const written = await storeFingerprint(db, "ref-1", fp);

    expect(written).toBe(fp.hashes.length);
    expect(await countFingerprints(db, "ref-1")).toBe(fp.hashes.length);
  });

  it("chunks a large insert without losing or duplicating a row", async () => {
    // The batch is larger than INSERT_CHUNK_ROWS, so this exercises the loop
    // boundary rather than a single statement.
    await registerWork(db, { id: "ref-1", title: "T", rightsHolder: "R" });
    const fp = fingerprint(makeTrack(2, { seconds: 90 }));
    expect(fp.hashes.length).toBeGreaterThan(10_000);

    await storeFingerprint(db, "ref-1", fp);
    expect(await countFingerprints(db, "ref-1")).toBe(fp.hashes.length);

    const rows = await db.query<{ hash: number; offset_ms: number }>(
      `select hash, offset_ms from fingerprints order by offset_ms, hash`,
    );
    const expected = Array.from(fp.hashes, (h, i) => ({
      hash: toStoredHash(h),
      offset_ms: fp.offsetsMs[i]!,
    })).sort((a, b) => a.offset_ms - b.offset_ms || a.hash - b.hash);
    expect(rows).toEqual(expected);
  });

  it("deletes the landmarks with the work, since no foreign key will", async () => {
    // The schema drops the FK on purpose — a bulk insert should not pay tens of
    // thousands of parent probes — so cleanup is this repository's job, and a
    // missed cleanup leaves rows that still match and still claim.
    await registerWork(db, { id: "ref-1", title: "T", rightsHolder: "R" });
    await storeFingerprint(db, "ref-1", fingerprint(makeTrack(3, { seconds: 5 })));
    expect(await countFingerprints(db, "ref-1")).toBeGreaterThan(0);

    await deleteWork(db, "ref-1");
    expect(await findWork(db, "ref-1")).toBeNull();
    expect(await countFingerprints(db, "ref-1")).toBe(0);
  });
});

/* --------------------------------------------------------- the sign trap -- */

describe("the signed-integer round trip", () => {
  it("stores and finds a hash whose top bit is set", async () => {
    // The layout in `hash.ts` stays inside 26 bits so this cannot happen today,
    // and that is precisely why it has to be tested: the six reserved bits are
    // reserved, not forbidden, and the day one is used the storage layer must
    // already be right. A hash above 2^31 written as unsigned would overflow
    // int4 outright; written inconsistently it would insert fine and never be
    // found again.
    await registerWork(db, { id: "ref-1", title: "T", rightsHolder: "R" });

    const topBitSet = (0x80000000 | packHash(300, 400, 7)) | 0;
    expect(topBitSet).toBeLessThan(0);

    const probe: Fingerprint = {
      hashes: Int32Array.from([topBitSet, packHash(1, 2, 3), -1, 0x7fffffff]),
      offsetsMs: Int32Array.from([0, 100, 200, 300]),
      durationMs: 1000,
    };
    await storeFingerprint(db, "ref-1", probe);

    const rows = await db.query<{ hash: number }>(
      `select hash from fingerprints order by offset_ms`,
    );
    expect(rows.map((r) => fromStoredHash(r.hash))).toEqual(
      Array.from(probe.hashes),
    );

    // And the query path finds them — the half of the trap that a write-only
    // test would miss entirely.
    const found = await matchFingerprint(db, probe, { minScore: 1 });
    expect(found[0]?.workId).toBe("ref-1");
    expect(found[0]?.score).toBe(4);
  });

  it("is its own inverse across the whole int32 range", () => {
    for (const value of [0, 1, -1, 0x7fffffff, -0x80000000, 0x3ffffff]) {
      expect(fromStoredHash(toStoredHash(value))).toBe(value);
    }
    // And the unsigned spelling of a top-bit hash collapses onto the signed one,
    // which is the whole point: both JS spellings must reach the same row.
    expect(toStoredHash(0x80000000)).toBe(toStoredHash(-0x80000000));
  });
});

/* -------------------------------------------------------- the match query -- */

describe("matchFingerprint", () => {
  const REFERENCE_SECONDS = 20;
  const EXCERPT_START_S = 5.0003;
  const EXCERPT_START_MS = EXCERPT_START_S * 1000;
  const CATALOGUE = 6;

  let tracks: Float32Array[];
  let references: Fingerprint[];

  beforeAll(() => {
    tracks = [];
    for (let i = 0; i < CATALOGUE; i++) {
      tracks.push(makeTrack(1000 + i, { seconds: REFERENCE_SECONDS }));
    }
    references = tracks.map((t) => fingerprint(t));
  });

  async function loadCatalogue(): Promise<void> {
    for (let i = 0; i < CATALOGUE; i++) {
      await registerWork(db, {
        id: `ref-${i}`,
        title: `Work ${i}`,
        rightsHolder: "Example Publishing",
        durationSeconds: REFERENCE_SECONDS,
      });
      await storeFingerprint(db, `ref-${i}`, references[i]!);
    }
  }

  function queryFor(
    i: number,
    degrade: (clip: Float32Array, seed: number) => Float32Array = (c) => c,
  ): Fingerprint {
    const clip = excerpt(tracks[i]!, EXCERPT_START_S, 10);
    return fingerprint(degrade(clip, 500 + i), { shifts: QUERY_SHIFTS });
  }

  it("finds a middle excerpt, at the right work and the right offset", async () => {
    await loadCatalogue();
    for (let i = 0; i < CATALOGUE; i++) {
      const found = await matchFingerprint(db, queryFor(i));
      expect(found[0]?.workId).toBe(`ref-${i}`);
      expect(found[0]!.score).toBeGreaterThanOrEqual(MATCH_SCORE_THRESHOLD);
      // §8 point (c): the offset is what proves the histogram works.
      expect(Math.abs(found[0]!.deltaMs - EXCERPT_START_MS)).toBeLessThanOrEqual(
        2 * HOP_MS,
      );
    }
  });

  it("agrees with the in-memory matcher, candidate for candidate", async () => {
    // The reason `domain/fingerprint/match.ts` keeps its own implementation of
    // the scoring rule. Two versions that are never compared are a liability;
    // compared on every run, each checks the other — and this is the assertion
    // that would catch the `round` vs `floor(x + 0.5)` bucketing difference
    // between Postgres and JavaScript, which disagree only on negative halves.
    await loadCatalogue();

    const entries: { hash: number; workId: string; offsetMs: number }[] = [];
    references.forEach((fp, i) => {
      for (let k = 0; k < fp.hashes.length; k++) {
        entries.push({ hash: fp.hashes[k]!, workId: `ref-${i}`, offsetMs: fp.offsetsMs[k]! });
      }
    });
    const memoryIndex = buildIndex(entries);

    for (let i = 0; i < CATALOGUE; i++) {
      const q = queryFor(i);
      const fromSql = await matchFingerprint(db, q, { minScore: 1, limit: 50 });
      const fromMemory = matchAgainstIndex(q, memoryIndex, { minScore: 1, limit: 50 });
      expect(fromSql).toEqual(fromMemory);
    }
  });

  it("agrees with the in-memory matcher on degraded queries too", async () => {
    // Clean queries produce large, unambiguous spikes. Degraded ones produce
    // the marginal buckets and ties where two implementations of one rule are
    // most likely to disagree.
    await loadCatalogue();

    const entries: { hash: number; workId: string; offsetMs: number }[] = [];
    references.forEach((fp, i) => {
      for (let k = 0; k < fp.hashes.length; k++) {
        entries.push({ hash: fp.hashes[k]!, workId: `ref-${i}`, offsetMs: fp.offsetsMs[k]! });
      }
    });
    const memoryIndex = buildIndex(entries);

    const degradations = [
      (c: Float32Array, s: number) => addNoise(c, 6, s),
      (c: Float32Array) => lowPass(c, 1500),
      (c: Float32Array) => gain(c, 0.501187),
    ];
    for (const degrade of degradations) {
      for (let i = 0; i < CATALOGUE; i++) {
        const q = queryFor(i, degrade);
        const fromSql = await matchFingerprint(db, q, { minScore: 1, limit: 50 });
        const fromMemory = matchAgainstIndex(q, memoryIndex, { minScore: 1, limit: 50 });
        expect(fromSql).toEqual(fromMemory);
      }
    }
  });

  it("returns nothing for a track that is not in the catalogue", async () => {
    await loadCatalogue();
    const stranger = fingerprint(makeTrack(90210, { seconds: 20 }), {
      shifts: QUERY_SHIFTS,
    });
    expect(await matchFingerprint(db, stranger)).toEqual([]);
  });

  it("scores every unrelated pairing below the threshold", async () => {
    // The leave-one-out shape of §8, at the repository level: with the catalogue
    // loaded, every non-self work must stay under the bar for every query.
    await loadCatalogue();
    let worst = 0;
    for (let i = 0; i < CATALOGUE; i++) {
      const found = await matchFingerprint(db, queryFor(i), { minScore: 1, limit: 50 });
      for (const c of found) {
        if (c.workId !== `ref-${i}`) worst = Math.max(worst, c.score);
      }
    }
    expect(worst).toBeGreaterThan(0); // there ARE coincidences; that is the point
    expect(worst).toBeLessThan(MATCH_SCORE_THRESHOLD);
  });

  it("honours minScore and limit in the database, not after the fact", async () => {
    await loadCatalogue();
    const q = queryFor(0);
    const all = await matchFingerprint(db, q, { minScore: 1, limit: 50 });
    expect(all.length).toBeGreaterThan(1);

    const capped = await matchFingerprint(db, q, { minScore: 1, limit: 1 });
    expect(capped).toHaveLength(1);
    expect(capped[0]).toEqual(all[0]);

    const raised = await matchFingerprint(db, q, { minScore: all[0]!.score });
    expect(raised).toHaveLength(1);
  });

  it("returns candidates in descending score order", async () => {
    await loadCatalogue();
    const found = await matchFingerprint(db, queryFor(0), { minScore: 1, limit: 50 });
    for (let i = 1; i < found.length; i++) {
      expect(found[i]!.score).toBeLessThanOrEqual(found[i - 1]!.score);
    }
  });

  it("does not query at all for an empty fingerprint", async () => {
    await loadCatalogue();
    const empty: Fingerprint = {
      hashes: new Int32Array(0),
      offsetsMs: new Int32Array(0),
      durationMs: 0,
    };
    expect(await matchFingerprint(db, empty)).toEqual([]);
  });

  it("finds a short reuse buried inside a long unrelated upload", async () => {
    // The actual Content ID case, and the one landmark hashing exists for: six
    // seconds of a reference under the middle of a minute of something else.
    await loadCatalogue();

    const host = makeTrack(777, { seconds: 60 });
    const borrowed = excerpt(tracks[2]!, 8, 6);
    const insertAt = Math.round(25.0007 * 11025);
    const upload = Float32Array.from(host);
    for (let i = 0; i < borrowed.length; i++) {
      upload[insertAt + i] = 0.5 * upload[insertAt + i]! + borrowed[i]!;
    }

    const found = await matchFingerprint(
      db,
      fingerprint(upload, { shifts: QUERY_SHIFTS }),
    );
    expect(found[0]?.workId).toBe("ref-2");

    // The span sits where the borrowed audio was pasted, and points back at
    // where it came from in the reference.
    const insertMs = (insertAt / 11025) * 1000;
    expect(found[0]!.matchStartMs).toBeGreaterThanOrEqual(insertMs - 500);
    expect(found[0]!.matchEndMs).toBeLessThanOrEqual(insertMs + 6500);
    expect(found[0]!.referenceOffsetMs).toBeGreaterThan(8000 - 500);
    expect(found[0]!.referenceOffsetMs).toBeLessThan(8000 + 1500);
  });
});

/* ---------------------------------------------------------------- claims -- */

describe("claims", () => {
  it("stores the score precisely, so a dispute argues about evidence", async () => {
    await seedVideo("vid-1");
    await registerWork(db, { id: "ref-1", title: "T", rightsHolder: "R" });

    const claim = await createClaim(db, {
      videoId: "vid-1",
      referenceId: "ref-1",
      policy: "monetise",
      matchStartMs: 12_000,
      matchEndMs: 21_500,
      referenceOffsetMs: 45_250,
      score: 1337,
    });

    expect(claim.score).toBe(1337);
    expect(claim.status).toBe("active");
    expect(await claimsForVideo(db, "vid-1")).toEqual([claim]);
  });

  it("moves through the dispute states §7 documents", async () => {
    await seedVideo("vid-1");
    await registerWork(db, { id: "ref-1", title: "T", rightsHolder: "R" });
    const claim = await createClaim(db, {
      videoId: "vid-1",
      referenceId: "ref-1",
      policy: "block",
      matchStartMs: 0,
      matchEndMs: 1000,
      referenceOffsetMs: 0,
      score: 900,
    });

    expect((await setClaimStatus(db, claim.id, "disputed"))?.status).toBe("disputed");
    expect((await setClaimStatus(db, claim.id, "released"))?.status).toBe("released");
    expect(await setClaimStatus(db, "nope", "released")).toBeNull();
  });

  it("rejects a status the schema does not allow", async () => {
    await seedVideo("vid-1");
    await registerWork(db, { id: "ref-1", title: "T", rightsHolder: "R" });
    const claim = await createClaim(db, {
      videoId: "vid-1",
      referenceId: "ref-1",
      policy: "track",
      matchStartMs: 0,
      matchEndMs: 1,
      referenceOffsetMs: 0,
      score: 1,
    });
    await expect(setClaimStatus(db, claim.id, "struck" as never)).rejects.toThrow();
  });

  it("goes with the video when the video goes", async () => {
    await seedVideo("vid-1");
    await registerWork(db, { id: "ref-1", title: "T", rightsHolder: "R" });
    await createClaim(db, {
      videoId: "vid-1",
      referenceId: "ref-1",
      policy: "track",
      matchStartMs: 0,
      matchEndMs: 1,
      referenceOffsetMs: 0,
      score: 1,
    });

    await db.execute("delete from videos where id = $1", ["vid-1"]);
    expect(await claimsForVideo(db, "vid-1")).toEqual([]);
  });
});

/* -------------------------------------------------------------- scanning -- */

describe("scanVideo", () => {
  const EXCERPT_START_S = 5.0003;
  let track: Float32Array;

  beforeAll(() => {
    track = makeTrack(4242, { seconds: 20 });
  });

  async function loadOne(policy: "block" | "monetise" | "track"): Promise<void> {
    await registerWork(db, {
      id: "ref-1",
      title: "Nocturne",
      rightsHolder: "Example Publishing",
      policy,
      durationSeconds: 20,
    });
    await storeFingerprint(db, "ref-1", fingerprint(track));
  }

  function upload(): Fingerprint {
    return fingerprint(excerpt(track, EXCERPT_START_S, 10), { shifts: QUERY_SHIFTS });
  }

  it("raises a claim carrying the work's policy and the matched spans", async () => {
    await seedVideo("vid-1");
    await loadOne("block");

    const [claim] = await scanVideo(db, "vid-1", upload());

    expect(claim?.referenceId).toBe("ref-1");
    expect(claim?.policy).toBe("block");
    expect(claim?.score).toBeGreaterThanOrEqual(MATCH_SCORE_THRESHOLD);
    expect(Math.abs(claim!.referenceOffsetMs - claim!.matchStartMs - 5000)).toBeLessThanOrEqual(
      2 * HOP_MS,
    );
    expect(claim!.matchEndMs).toBeGreaterThan(claim!.matchStartMs);
  });

  it("does not touch the video's availability", async () => {
    // §7's first rule: a match produces a claim, explicitly *not* a takedown.
    // Whether a `block` policy makes the video unplayable is a decision for
    // whatever renders it, reading the claim — which keeps an erroneous match a
    // row to delete rather than a video already pulled down.
    await seedVideo("vid-1");
    await loadOne("block");
    await scanVideo(db, "vid-1", upload());

    const rows = await db.query<{ visibility: string; upload_status: string }>(
      "select visibility, upload_status from videos where id = $1",
      ["vid-1"],
    );
    expect(rows[0]).toEqual({ visibility: "public", upload_status: "uploading" });
  });

  it("raises nothing for an upload that matches nothing", async () => {
    await seedVideo("vid-1");
    await loadOne("monetise");
    const stranger = fingerprint(makeTrack(31337, { seconds: 20 }), {
      shifts: QUERY_SHIFTS,
    });
    expect(await scanVideo(db, "vid-1", stranger)).toEqual([]);
    expect(await claimsForVideo(db, "vid-1")).toEqual([]);
  });

  it("does not double-claim when the scanner is re-run", async () => {
    // Transcodes get retried. A duplicate claim is indistinguishable from a
    // second genuine reuse once it is a row.
    await seedVideo("vid-1");
    await loadOne("monetise");

    expect(await scanVideo(db, "vid-1", upload())).toHaveLength(1);
    expect(await scanVideo(db, "vid-1", upload())).toHaveLength(0);
    expect(await claimsForVideo(db, "vid-1")).toHaveLength(1);
  });

  it("claims again once the rights-holder has released the first", async () => {
    await seedVideo("vid-1");
    await loadOne("monetise");
    const [first] = await scanVideo(db, "vid-1", upload());
    await setClaimStatus(db, first!.id, "released");

    expect(await scanVideo(db, "vid-1", upload())).toHaveLength(1);
  });

  it("keeps the policy that was applied when the work's default changes", async () => {
    // The claim records what was applied *to it*. Joining the policy at read
    // time instead would let a rights-holder silently rewrite the terms of
    // every claim already raised — including ones already under dispute.
    await seedVideo("vid-1");
    await loadOne("track");
    const [claim] = await scanVideo(db, "vid-1", upload());
    expect(claim?.policy).toBe("track");

    await db.execute("update reference_works set policy = 'block' where id = 'ref-1'");
    expect((await claimsForVideo(db, "vid-1"))[0]?.policy).toBe("track");
  });

  it("ignores landmarks left behind by a deleted work", async () => {
    // The schema has no foreign key from `fingerprints`, so a partial delete
    // can leave rows that still match. A landmark with no work has no policy
    // and must not become a claim.
    await seedVideo("vid-1");
    await loadOne("monetise");
    await db.execute("delete from reference_works where id = 'ref-1'");

    expect(await scanVideo(db, "vid-1", upload())).toEqual([]);
  });

  it("caps how many claims one scan may raise", async () => {
    await seedVideo("vid-1");
    for (let i = 0; i < 3; i++) {
      const t = makeTrack(600 + i, { seconds: 20 });
      await registerWork(db, { id: `ref-${i}`, title: `W${i}`, rightsHolder: "R" });
      await storeFingerprint(db, `ref-${i}`, fingerprint(t));
    }
    // An upload that is a mixture of all three references.
    const clips = [0, 1, 2].map((i) =>
      excerpt(makeTrack(600 + i, { seconds: 20 }), 5.0003, 10),
    );
    const mixed = new Float32Array(clips[0]!.length);
    for (let i = 0; i < mixed.length; i++) {
      mixed[i] = (clips[0]![i]! + clips[1]![i]! + clips[2]![i]!) / 2;
    }

    const claims = await scanVideo(
      db,
      "vid-1",
      fingerprint(mixed, { shifts: QUERY_SHIFTS }),
      { maxClaims: 1 },
    );
    expect(claims).toHaveLength(1);
  });
});
