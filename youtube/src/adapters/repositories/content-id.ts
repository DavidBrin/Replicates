import "server-only";

import type { SqlDatabase, SqlExecutor, SqlRow, SqlValue } from "@/adapters/db";
import {
  MATCH_SCORE_THRESHOLD,
  OFFSET_BUCKET_MS,
  OFFSET_BUCKET_TOLERANCE,
  type Fingerprint,
  type MatchCandidate,
} from "@/domain/fingerprint";

import { atomically, newId, nullableText, num, text, timestamp } from "./shared";

/**
 * Content ID storage: the inverted index, the match query, and claims.
 *
 * `research/06-audio-fingerprinting.md` §6 settles the one architectural
 * question here — **the offset histogram runs in Postgres, not in the
 * application.** The alternative is `select hash, work_id, offset_ms from
 * fingerprints where hash = any($1)` followed by a `GROUP BY` in TypeScript,
 * and §6 rejects it for three reasons that all bite at our scale: it ships tens
 * of thousands of candidate rows over the wire when only the aggregated
 * (work, bucket, count) triples are wanted; Postgres' hash-aggregate is built
 * for exactly this shape; and `HAVING` plus `LIMIT` discard most of the result
 * before it is transferred rather than after.
 *
 * `domain/fingerprint/match.ts` implements the same rule in memory anyway, and
 * that is deliberate rather than redundant: `__tests__/content-id.test.ts`
 * asserts the two agree candidate for candidate. Two implementations of one
 * scoring rule that are never compared are a liability; two that are compared
 * on every run are a check on both.
 */

export type ContentPolicy = "block" | "monetise" | "track";
export type ClaimStatus = "active" | "disputed" | "released";

export interface ReferenceWork {
  readonly id: string;
  readonly title: string;
  readonly rightsHolder: string;
  readonly policy: ContentPolicy;
  readonly videoId: string | null;
  readonly durationSeconds: number;
  readonly createdAt: Date;
}

export interface RegisterWorkInput {
  readonly id?: string;
  readonly title: string;
  readonly rightsHolder: string;
  readonly policy?: ContentPolicy;
  readonly videoId?: string | null;
  readonly durationSeconds?: number;
}

export interface Claim {
  readonly id: string;
  readonly videoId: string;
  readonly referenceId: string;
  readonly policy: ContentPolicy;
  readonly status: ClaimStatus;
  /** The matched span in the *claimed video's* timeline. */
  readonly matchStartMs: number;
  readonly matchEndMs: number;
  /** Where that span begins in the reference work. */
  readonly referenceOffsetMs: number;
  /** The histogram peak height the threshold was applied to. */
  readonly score: number;
  readonly createdAt: Date;
}

/* ------------------------------------------------------- the sign decision -- */

/**
 * `fingerprints.hash` is Postgres `integer` — **signed** 32-bit — and these two
 * functions are the entire defence against that.
 *
 * The failure they prevent is quiet and total. If a packed hash ever sets bit
 * 31, JavaScript can hold it either as a positive number (via `>>> 0`, up to
 * 4.29e9) or as a negative one (via `| 0`), and Postgres can only hold the
 * negative one — the positive value overflows `int4` outright. Get the two
 * sides inconsistent and roughly half the hash space writes rows the query path
 * can never find again: no error, no constraint violation, just an index that
 * works perfectly for hashes below 2^31 and silently misses everything above.
 * Exactly the kind of defect that reads as "matching is a bit unreliable".
 *
 * So: one conversion, `| 0`, applied on the way in *and* on the way out, and it
 * is its own inverse. `| 0` reinterprets any JS number as the signed 32-bit
 * pattern, which is the pattern `int4` stores.
 *
 * With the layout in `hash.ts` this is currently the identity function, because
 * that layout deliberately stays inside 26 bits and never sets bit 31 — that is
 * the safe half of the choice §1.4 leaves open. These are not therefore
 * decoration: the layout reserves its top 6 bits for a future scheme selector,
 * and the day one of them is used, the storage layer is already right. The
 * repository suite exercises that path today with a hash whose top bit is set.
 */
export function toStoredHash(hash: number): number {
  return hash | 0;
}

/** Inverse of {@link toStoredHash}. Deliberately the same operation. */
export function fromStoredHash(stored: number): number {
  return stored | 0;
}

/* ----------------------------------------------------------- registration -- */

export async function registerWork(
  db: SqlExecutor,
  input: RegisterWorkInput,
): Promise<ReferenceWork> {
  const rows = await db.query<SqlRow>(
    `insert into reference_works
       (id, title, rights_holder, policy, video_id, duration_seconds)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [
      input.id ?? newId("ref"),
      input.title,
      input.rightsHolder,
      input.policy ?? "monetise",
      input.videoId ?? null,
      input.durationSeconds ?? 0,
    ],
  );
  return toReferenceWork(rows[0]!);
}

export async function findWork(
  db: SqlExecutor,
  id: string,
): Promise<ReferenceWork | null> {
  const rows = await db.query<SqlRow>(
    `select * from reference_works where id = $1`,
    [id],
  );
  return rows[0] ? toReferenceWork(rows[0]) : null;
}

/**
 * Delete a work and everything fingerprinted from it.
 *
 * The `fingerprints` rows have to be deleted explicitly because the schema
 * gives them no foreign key — and the schema's comment explains why that is
 * right: a bulk insert of tens of thousands of landmark rows should not cost
 * tens of thousands of index probes to re-verify a parent the caller created
 * moments earlier. The bill for that comes due exactly here, once per deletion
 * instead of once per row, and `fingerprints_work_idx` is what makes it cheap.
 *
 * The landmarks go **first**, and both statements go in one transaction. The
 * order matters if the transaction is ever lost halfway: landmarks with no work
 * are inert — `scanVideo` finds no policy for them and raises nothing — whereas
 * a work whose landmarks survived it would keep matching uploads and keep
 * claiming on behalf of a rights-holder who withdrew.
 */
export async function deleteWork(
  db: SqlDatabase,
  workId: string,
  tx?: SqlExecutor,
): Promise<void> {
  await atomically(db, tx, async (exec) => {
    await exec.execute(`delete from fingerprints where work_id = $1`, [workId]);
    await exec.execute(`delete from reference_works where id = $1`, [workId]);
  });
}

/* ------------------------------------------------------------ the index -- */

/**
 * How many landmark rows go into one `insert`.
 *
 * The rows travel as a Postgres array literal in a single bind parameter, which
 * is one round trip rather than one per row, but makes the statement's size
 * proportional to the batch. 10,000 rows is roughly 160 kB of text — measured
 * at 192 ms for 90,000 rows in one statement against PGlite, so the chunking is
 * not for speed. It is for the ceiling: Neon's HTTP driver has a request size
 * limit, and a four-hour reference work would otherwise build a single
 * multi-megabyte statement and fail on the deployment while passing locally.
 */
const INSERT_CHUNK_ROWS = 10_000;

/**
 * Write a fingerprint into the inverted index.
 *
 * `unnest` over two parallel arrays rather than a multi-row `values` list: the
 * statement text is then constant regardless of batch size, so Postgres plans
 * it once instead of re-parsing a query whose shape changes with every call.
 */
export async function storeFingerprint(
  db: SqlExecutor,
  workId: string,
  fingerprint: Fingerprint,
): Promise<number> {
  const { hashes, offsetsMs } = fingerprint;
  let written = 0;

  for (let start = 0; start < hashes.length; start += INSERT_CHUNK_ROWS) {
    const end = Math.min(hashes.length, start + INSERT_CHUNK_ROWS);
    const hashLiteral: number[] = [];
    const offsetLiteral: number[] = [];
    for (let i = start; i < end; i++) {
      hashLiteral.push(toStoredHash(hashes[i]!));
      offsetLiteral.push(offsetsMs[i]!);
    }
    written += await db.execute(
      `insert into fingerprints (hash, work_id, offset_ms)
       select h, $2, o from unnest($1::int[], $3::int[]) as t(h, o)`,
      [`{${hashLiteral.join(",")}}`, workId, `{${offsetLiteral.join(",")}}`],
    );
  }

  return written;
}

/** Landmark rows held for a work. Used by the suite and by capacity checks. */
export async function countFingerprints(
  db: SqlExecutor,
  workId: string,
): Promise<number> {
  const rows = await db.query<{ n: number }>(
    `select count(*)::int as n from fingerprints where work_id = $1`,
    [workId],
  );
  return rows[0]?.n ?? 0;
}

/* -------------------------------------------------------- the match query -- */

export interface MatchOptions {
  readonly minScore?: number;
  readonly limit?: number;
}

/**
 * The offset histogram, in SQL.
 *
 * Reading it from the inside out:
 *
 *   `q`        the query's landmarks, arriving as two parallel arrays;
 *   `hits`     every (query hash, reference occurrence) coincidence, with the
 *              offset difference already bucketed into hop units;
 *   `raw`      the histogram — one row per (work, bucket) with its height and
 *              the first and last query-side times that contributed to it;
 *   `smoothed` the ±1-bucket boxcar of `OFFSET_BUCKET_TOLERANCE`, as a window
 *              `RANGE` frame so that missing buckets are handled by *value*
 *              distance rather than by row adjacency;
 *   the final `distinct on` keeps each work's best bucket.
 *
 * Two details that look incidental and are not.
 *
 * **`floor(x + 0.5)` rather than `round(x)`.** These disagree on exact halves
 * for negative numbers — JavaScript's `Math.round(-1.5)` is -1, Postgres'
 * `round(-1.5)` is -2 — and a query hash that occurs *earlier* in the reference
 * than in the video produces exactly such a negative offset. `floor(x + 0.5)`
 * is what `Math.round` is defined to be, so the SQL and the in-memory matcher
 * bucket every row identically instead of nearly identically.
 *
 * **The bucket width is a parameter, not a literal.** It is the STFT hop, and
 * if the analysis parameters ever change, a hard-coded 50 in this file would
 * keep working and keep being wrong — the histogram would develop a beat
 * against the true quantisation rather than fail.
 *
 * The query hashes travel as one array literal. At our token rate (§3, ~165
 * hashes/s, times the four query alignments of `QUERY_SHIFTS`) a ten-minute
 * upload is around 400,000 values, or a few megabytes of statement. That is the
 * scale ceiling of this shape, and the way past it is to land the query hashes
 * in a temporary table in chunks and aggregate against that — `raw`'s
 * `group by` is decomposable, so partial histograms merge by summing. Not built
 * because nothing here needs it, and named so nobody has to rediscover it.
 */
export async function matchFingerprint(
  db: SqlExecutor,
  query: Fingerprint,
  options: MatchOptions = {},
): Promise<MatchCandidate[]> {
  const minScore = options.minScore ?? MATCH_SCORE_THRESHOLD;
  const limit = options.limit ?? 20;
  if (query.hashes.length === 0) return [];

  const hashLiteral: number[] = [];
  for (let i = 0; i < query.hashes.length; i++) {
    hashLiteral.push(toStoredHash(query.hashes[i]!));
  }

  const params: SqlValue[] = [
    `{${hashLiteral.join(",")}}`,
    `{${Array.from(query.offsetsMs).join(",")}}`,
    OFFSET_BUCKET_MS,
    OFFSET_BUCKET_TOLERANCE,
    minScore,
    limit,
  ];

  const rows = await db.query<SqlRow>(
    `with q(hash, q_ms) as (
       select * from unnest($1::int[], $2::int[])
     ),
     hits as (
       select f.work_id,
              floor((f.offset_ms - q.q_ms)::numeric / $3::numeric + 0.5)::int as bucket,
              q.q_ms
       from fingerprints f
       join q using (hash)
     ),
     raw as (
       select work_id,
              bucket,
              count(*)::int as n,
              min(q_ms)::int as lo,
              max(q_ms)::int as hi
       from hits
       group by work_id, bucket
     ),
     smoothed as (
       select work_id,
              bucket,
              -- The score sums the boxcar; the span stays with this bucket's
              -- own contributions. See \`bestBucket\` in the domain matcher: a
              -- neighbouring bucket's stray coincidence would move a min or a
              -- max on its own, and overstate which part of the video used the
              -- work.
              sum(n) over w as score,
              lo as span_lo,
              hi as span_hi
       from raw
       window w as (
         partition by work_id
         order by bucket
         range between $4 preceding and $4 following
       )
     ),
     best as (
       select distinct on (work_id)
              work_id,
              score::int as score,
              (bucket * $3::numeric)::int as delta_ms,
              span_lo,
              span_hi
       from smoothed
       where score >= $5
       order by work_id, score desc, bucket
     )
     select * from best
     order by score desc, work_id
     limit $6`,
    params,
  );

  return rows.map((row) => {
    const deltaMs = num(row, "delta_ms");
    const matchStartMs = num(row, "span_lo");
    return {
      workId: text(row, "work_id"),
      score: num(row, "score"),
      deltaMs,
      matchStartMs,
      matchEndMs: num(row, "span_hi"),
      // Derived here rather than in SQL so that this and the in-memory matcher
      // compute it from the same two numbers by the same arithmetic.
      referenceOffsetMs: matchStartMs + deltaMs,
    };
  });
}

/* ----------------------------------------------------------- the product -- */

export interface CreateClaimInput {
  readonly id?: string;
  readonly videoId: string;
  readonly referenceId: string;
  readonly policy: ContentPolicy;
  readonly matchStartMs: number;
  readonly matchEndMs: number;
  readonly referenceOffsetMs: number;
  readonly score: number;
}

export async function createClaim(
  db: SqlExecutor,
  input: CreateClaimInput,
): Promise<Claim> {
  const rows = await db.query<SqlRow>(
    `insert into claims
       (id, video_id, reference_id, policy, match_start_ms, match_end_ms,
        reference_offset_ms, score)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning *`,
    [
      input.id ?? newId("clm"),
      input.videoId,
      input.referenceId,
      input.policy,
      input.matchStartMs,
      input.matchEndMs,
      input.referenceOffsetMs,
      input.score,
    ],
  );
  return toClaim(rows[0]!);
}

export async function claimsForVideo(
  db: SqlExecutor,
  videoId: string,
): Promise<Claim[]> {
  const rows = await db.query<SqlRow>(
    `select * from claims where video_id = $1 order by score desc, id`,
    [videoId],
  );
  return rows.map(toClaim);
}

/**
 * Move a claim between `active`, `disputed` and `released`.
 *
 * §7's minimal honest version of the real dispute loop: the uploader disputes,
 * the rights-holder releases or reinstates. There is no legal-review pipeline
 * and deliberately no DMCA-equivalent track — §7 calls that "product theater,
 * not a useful thing to build".
 */
export async function setClaimStatus(
  db: SqlExecutor,
  claimId: string,
  status: ClaimStatus,
): Promise<Claim | null> {
  const rows = await db.query<SqlRow>(
    `update claims set status = $2 where id = $1 returning *`,
    [claimId, status],
  );
  return rows[0] ? toClaim(rows[0]) : null;
}

export interface ScanOptions extends MatchOptions {
  /** Cap on claims raised by one scan. A pathological upload should not create
   * a hundred rows before anyone looks at it. */
  readonly maxClaims?: number;
}

/**
 * Fingerprint-in, claims-out: the whole product layer in one call.
 *
 * §7's first rule is the one that shapes this: **a match creates a claim, not a
 * takedown.** Nothing here touches `videos.visibility`. Whether a `block`
 * policy makes a video unplayable is a decision for whatever renders the video,
 * reading the claim — and keeping it there means an erroneous match is a row to
 * delete rather than a video already pulled down.
 *
 * The policy on the claim is copied from the reference work at claim time
 * rather than joined at read time. That is not denormalisation for speed: the
 * schema lets a rights-holder change a work's default policy afterwards, and a
 * claim has to keep saying what was applied *to it* — otherwise changing a
 * default silently rewrites the terms of every claim already raised under the
 * old one, including ones already disputed.
 *
 * Re-scanning a video will not raise a second claim for a work that already has
 * a live one. Transcodes get retried and scanners get re-run, and a duplicate
 * claim is indistinguishable from a second genuine reuse once it is a row.
 */
export async function scanVideo(
  db: SqlExecutor,
  videoId: string,
  query: Fingerprint,
  options: ScanOptions = {},
): Promise<Claim[]> {
  const candidates = await matchFingerprint(db, query, options);
  if (candidates.length === 0) return [];

  const maxClaims = options.maxClaims ?? 10;
  const ids = candidates.map((c) => c.workId);

  const works = await db.query<{ id: string; policy: ContentPolicy }>(
    `select id, policy from reference_works
     where id = any(string_to_array($1, ',')::text[])`,
    [ids.join(",")],
  );
  const policies = new Map(works.map((w) => [w.id, w.policy]));

  const existing = await db.query<{ reference_id: string }>(
    `select distinct reference_id from claims
     where video_id = $1 and status <> 'released'`,
    [videoId],
  );
  const alreadyClaimed = new Set(existing.map((r) => r.reference_id));

  const claims: Claim[] = [];
  for (const candidate of candidates) {
    if (claims.length >= maxClaims) break;
    // A landmark can outlive the work it came from: the schema drops the
    // foreign key on purpose (see `deleteWork`), so a half-deleted work leaves
    // rows that still match. No policy, no claim.
    const policy = policies.get(candidate.workId);
    if (!policy) continue;
    if (alreadyClaimed.has(candidate.workId)) continue;

    claims.push(
      await createClaim(db, {
        videoId,
        referenceId: candidate.workId,
        policy,
        matchStartMs: candidate.matchStartMs,
        matchEndMs: candidate.matchEndMs,
        referenceOffsetMs: candidate.referenceOffsetMs,
        score: candidate.score,
      }),
    );
  }
  return claims;
}

/* ---------------------------------------------------------------- mapping -- */

const POLICIES: readonly ContentPolicy[] = ["block", "monetise", "track"];
const STATUSES: readonly ClaimStatus[] = ["active", "disputed", "released"];

/**
 * Narrow a text column to its union.
 *
 * The schema's `check` constraint already guarantees the value, so this can
 * never fire against a row this application wrote. It exists for the row this
 * application did *not* write — a hand-edited record, a restored dump, a column
 * widened in a migration and not here — where the alternative is a `policy` of
 * `"blcok"` flowing silently into a claim and matching none of the branches
 * that act on it.
 */
function oneOf<T extends string>(
  row: SqlRow,
  column: string,
  allowed: readonly T[],
): T {
  const value = text(row, column);
  if (!(allowed as readonly string[]).includes(value)) {
    throw new TypeError(
      `Expected ${column} to be one of ${allowed.join(", ")}, got ${value}`,
    );
  }
  return value as T;
}

function toReferenceWork(row: SqlRow): ReferenceWork {
  return {
    id: text(row, "id"),
    title: text(row, "title"),
    rightsHolder: text(row, "rights_holder"),
    policy: oneOf(row, "policy", POLICIES),
    videoId: nullableText(row, "video_id"),
    durationSeconds: num(row, "duration_seconds"),
    createdAt: timestamp(row["created_at"]),
  };
}

function toClaim(row: SqlRow): Claim {
  return {
    id: text(row, "id"),
    videoId: text(row, "video_id"),
    referenceId: text(row, "reference_id"),
    policy: oneOf(row, "policy", POLICIES),
    status: oneOf(row, "status", STATUSES),
    matchStartMs: num(row, "match_start_ms"),
    matchEndMs: num(row, "match_end_ms"),
    referenceOffsetMs: num(row, "reference_offset_ms"),
    score: num(row, "score"),
    createdAt: timestamp(row["created_at"]),
  };
}
