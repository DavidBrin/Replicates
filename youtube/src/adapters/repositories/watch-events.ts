import "server-only";

import { database } from "@/adapters/db";
import type { SqlDatabase, SqlExecutor } from "@/adapters/db";
import {
  MIN_COVISIT_WEIGHT,
  TOP_K_STORED,
  admitToSession,
} from "@/domain/recommender";

import { bool, first, num } from "./shared";

/**
 * Recording a watch, and keeping the co-visitation graph correct as it goes.
 *
 * D10 §2.6 does not do it this way. The paper describes a batch pipeline —
 * "a series of MapReduce computations", "updating the data sets several times
 * per day" — and research §2 is explicit that continuous row-level maintenance
 * is our design, built to satisfy the paper's *definition* of cij rather than
 * to reproduce its implementation. At this scale a full rebuild every few hours
 * would be more machinery than the thing it maintains, and it would mean a
 * demo whose recommendations are up to a few hours stale for no reason.
 *
 * What is preserved is the definition: cij is the number of distinct sessions
 * containing both videos, ci the number containing one, and both are counters
 * that only ever move up. Every write below touches rows belonging to the
 * current session plus the pairs of the one video that just joined it — there
 * is no rebuild phase, and the structure is query-ready after every commit.
 *
 * Sessionisation is upstream of this file. Research §1.1 recommends gap-based
 * sessions — a 30-minute idle gap, capped at 24 hours — and notes D10 states
 * only "usually 24 hours" without a boundary mechanic. Here the boundary is
 * whatever the caller's cookie says, because `watch_events.session_key` is a
 * cookie value by the schema's own description. If the idle-gap rule is ever
 * wanted it belongs in whatever issues that cookie, not here: this file cannot
 * tell a returning viewer from a continuing one.
 */

export interface WatchEvent {
  /** Groups a viewer's watches whether or not they have an account. */
  readonly sessionKey: string;
  readonly videoId: string;
  readonly userId?: string | null;
  /**
   * Seconds actually watched, not the position reached — the schema is
   * emphatic that a seek to the end is not a view.
   */
  readonly watchedSeconds?: number;
  /**
   * Required, and deliberately not defaulted to now(). Research §6 lists
   * wall-clock timestamps as one of the four ways non-determinism enters this
   * system: a fixture that lets the write path stamp its own time makes the
   * resulting recommendation order depend on when the suite happened to run.
   * An optional parameter is a default one test in ten forgets to pass.
   */
  readonly watchedAt: Date;
}

export interface WatchRecorded {
  /**
   * False for a replay. This is the flag the whole dedup rule reduces to: when
   * it is false, no counter moved and no pair was touched.
   */
  readonly newToSession: boolean;
  /** How many pairs the new video co-visited into. Zero for a replay. */
  readonly pairsTouched: number;
}

/**
 * One watch, one transaction.
 *
 * The four steps are research §2's, in its order, and the ordering is
 * load-bearing rather than incidental: the membership row must exist before the
 * pair insert reads the session's set, so the pair statement excludes the new
 * video by id rather than by relying on having run first.
 */
export async function recordWatch(
  event: WatchEvent,
  db?: SqlDatabase,
): Promise<WatchRecorded> {
  const handle = db ?? (await database());
  return handle.transaction(async (tx) => {
    const at = event.watchedAt.toISOString();

    /**
     * The count and the membership test in one statement: both describe the
     * session as it stands before this event, and reading them separately
     * would be two chances to describe two different moments.
     *
     * An aggregate over zero rows still returns one row, so `first` is never
     * `undefined` here — the fallbacks satisfy the compiler rather than
     * describing a state the query can reach.
     */
    const state = first(
      await tx.query(
        `select count(*)::int as member_count,
                coalesce(bool_or(video_id = $2), false) as is_member
           from session_videos
          where session_key = $1`,
        [event.sessionKey, event.videoId],
      ),
    );

    const admission = admitToSession(
      state === undefined ? 0 : num(state, "member_count"),
      state !== undefined && bool(state, "is_member"),
    );

    /**
     * `on conflict do nothing returning` rather than trusting the read above.
     * The read decides whether we are allowed to admit the video; this decides
     * whether we did. Under read-committed two watches of the same video in the
     * same session can both pass the read, and only one of them may increment
     * the counters — an insert that returns no row is the only evidence of that
     * which does not require a lock.
     */
    const inserted =
      admission === "admit"
        ? await tx.query<{ video_id: string }>(
            `insert into session_videos (session_key, video_id, first_watched_at)
             values ($1, $2, $3)
             on conflict (session_key, video_id) do nothing
             returning video_id`,
            [event.sessionKey, event.videoId, at],
          )
        : [];

    const newToSession = inserted.length > 0;
    let pairsTouched = 0;

    if (newToSession) {
      await tx.execute(
        `insert into video_session_counts (video_id, session_count)
         values ($1, 1)
         on conflict (video_id) do update
            set session_count = video_session_counts.session_count + 1`,
        [event.videoId],
      );

      /**
       * `least`/`greatest` rather than ordering the pair in TypeScript: the
       * `check (video_a < video_b)` constraint is evaluated with the column's
       * collation, and only an expression evaluated in the same statement is
       * guaranteed to agree with it. Ordering in the application would pass
       * against PGlite, whose collation is byte-wise like JavaScript's, and
       * reject rows against a Neon database whose collation folds case.
       *
       * Reading the membership set inside the statement rather than passing it
       * back down as a list of parameters costs nothing and closes the window
       * where a concurrent watch in the same session joins between the read and
       * the write.
       */
      pairsTouched = await tx.execute(
        `insert into covisitation (video_a, video_b, weight, updated_at)
         select least(sv.video_id, $2), greatest(sv.video_id, $2), 1, $3
           from session_videos sv
          where sv.session_key = $1 and sv.video_id <> $2
         on conflict (video_a, video_b) do update
            set weight = covisitation.weight + 1,
                updated_at = excluded.updated_at`,
        [event.sessionKey, event.videoId, at],
      );
    }

    /**
     * Logged whether or not anything else happened. The raw log feeds the
     * history page and the seed selection for every multi-seed surface, none of
     * which care about the dedup rule that governs the pair counts.
     */
    await tx.execute(
      `insert into watch_events
         (user_id, session_key, video_id, watched_at, watched_seconds)
       values ($1, $2, $3, $4, $5)`,
      [
        event.userId ?? null,
        event.sessionKey,
        event.videoId,
        at,
        event.watchedSeconds ?? 0,
      ],
    );

    if (newToSession) {
      await refreshRelatedFor(tx, event.sessionKey, event.videoId);
    }

    return { newToSession, pairsTouched };
  });
}

/**
 * Rebuild every seed's neighbour list from the pair counts.
 *
 * This is research §4.5's batch job, and it is the most expensive thing in the
 * slice by design — a full scan of the pair table with a sort per seed group.
 * `recordWatch` never calls it; it exists for a seed script, for a corpus
 * imported behind the write path's back, and as the definition the incremental
 * refresh below has to match.
 */
export async function refreshRelatedVideos(exec?: SqlExecutor): Promise<void> {
  const handle = exec ?? (await database());
  await handle.execute(`delete from related_videos`);
  await handle.execute(
    `insert into related_videos (seed_id, candidate_id, score, rank)
     select seed_id, candidate_id, score, rank
       from (${SCORED_NEIGHBOURS}) ranked
      where rank <= $2`,
    [MIN_COVISIT_WEIGHT, TOP_K_STORED],
  );
}

/**
 * Rebuild only the neighbour lists this watch could have changed.
 *
 * The affected set is exactly two things unioned, and the second is the one
 * that is easy to miss:
 *
 *   Every video in the session, because the new video's pair with each of them
 *   gained weight, and weight appears in both directions' scores.
 *
 *   Every video anywhere in the graph that has the new video as a neighbour,
 *   because the new video's session_count is the *denominator* of their score
 *   for it. A video co-visited with it in some session last week is not in this
 *   session and its stored score for it is now stale.
 *
 * Nothing else moved: no other video's count changed and no other pair's weight
 * changed, so no other seed's list can differ. The rejected alternative is
 * calling `refreshRelatedVideos` after each watch, which is correct and scans
 * the whole pair table to rewrite the handful of rows this rewrites.
 */
async function refreshRelatedFor(
  exec: SqlExecutor,
  sessionKey: string,
  videoId: string,
): Promise<void> {
  await exec.execute(
    `with affected (seed_id) as (${AFFECTED_SEEDS})
     delete from related_videos
      where seed_id in (select seed_id from affected)`,
    [sessionKey, videoId],
  );

  await exec.execute(
    `with affected (seed_id) as (${AFFECTED_SEEDS})
     insert into related_videos (seed_id, candidate_id, score, rank)
     select seed_id, candidate_id, score, rank
       from (${SCORED_NEIGHBOURS_FOR_AFFECTED}) ranked
      where rank <= $4`,
    [sessionKey, videoId, MIN_COVISIT_WEIGHT, TOP_K_STORED],
  );
}

const AFFECTED_SEEDS = `
  select video_id from session_videos where session_key = $1
  union
  select case when video_a = $2 then video_b else video_a end
    from covisitation
   where video_a = $2 or video_b = $2
`;

/**
 * Relatedness, written once.
 *
 * Both refresh paths interpolate this rather than spelling the division out,
 * because for a while they spelled it out differently. See the note on
 * `SCORED_NEIGHBOURS_FOR_AFFECTED`.
 */
const RELATEDNESS = `d.weight::double precision / (s.session_count * c.session_count)`;

/** The two joins `RELATEDNESS` reads `s` and `c` from. Shared for the same reason. */
const SESSION_COUNT_JOINS = `
    join video_session_counts s
      on s.video_id = d.seed_id and s.session_count > 0
    join video_session_counts c
      on c.video_id = d.candidate_id and c.session_count > 0
`;

/**
 * The scoring half of the refresh, shared by the full and the scoped rebuild so
 * the two cannot drift into two definitions of relatedness.
 *
 * `union all` over both column orders is what turns the write table's one
 * canonical row per pair into the read table's two directions.
 *
 * ## Both session counts are in the denominator, and the seed's is not optional
 *
 * D10 Eq. 1 is r(vi,vj) = cij / (ci·cj). This query divided by the
 * *candidate's* count alone, on the reasoning that ci is constant within a
 * seed's partition and therefore cannot change that seed's ranking. That
 * reasoning is correct and the conclusion drawn from it was wrong, because the
 * ranking inside one partition is not what these scores are used for.
 *
 * `aggregateAcrossSeeds` in the domain module **sums** a candidate's scores
 * over every seed that reached it. The moment scores from different seeds are
 * added together they have to be on the same scale, and cij/cj is not: a seed
 * watched in 300 sessions contributes numbers roughly a hundred times larger
 * than one watched in 3. The whole of a viewer's recommendations then comes
 * from whichever of their recent videos happens to be the most popular, which
 * looks entirely plausible — the results are still *related* videos — and is
 * not what the model says.
 *
 * It also made the stored score asymmetric while the schema comment beside
 * `covisitation` promises r(vi,vj) = r(vj,vi): with ci=3, cj=30, cij=3, the
 * two directions came out 0.1 and 1.0 for one and the same pair.
 *
 * So the join happens twice, on the seed and on the candidate. `> 0` on both
 * is what keeps the division defined; a video in `covisitation` always has a
 * session count, so the guard costs nothing and removes the question.
 *
 * The `order by … , candidate_id` inside the window is not decoration. Without
 * it, two candidates with equal scores get their ranks assigned in whatever
 * order the plan produced them, and the top-K cutoff then keeps a different
 * one on different runs — research §6 calls score ties routine on a small
 * corpus rather than exotic.
 */
const SCORED_NEIGHBOURS = `
  select d.seed_id,
         d.candidate_id,
         ${RELATEDNESS} as score,
         row_number() over (
           partition by d.seed_id
           order by ${RELATEDNESS} desc,
                    d.candidate_id
         ) as rank
    from (
      select video_a as seed_id, video_b as candidate_id, weight from covisitation
      union all
      select video_b as seed_id, video_a as candidate_id, weight from covisitation
    ) d
    ${SESSION_COUNT_JOINS}
   where d.weight >= $1
`;

/**
 * The same scoring, restricted to the affected seeds. The restriction is
 * pushed into each arm of the union rather than applied to the union's result
 * so that both arms can use `covisitation_a_idx` and `covisitation_b_idx`
 * instead of scanning the pair table twice per watch.
 *
 * "The same scoring" is now enforced rather than asserted. It was a promise
 * this file made in a comment and broke the moment the denominator changed in
 * one query and not the other: the full rebuild started dividing by both
 * session counts while the incremental path kept dividing by one, so a
 * video's neighbours had different scores depending on which refresh last
 * touched them. The suite caught it — `refreshRelatedVideos` is asserted to
 * produce byte-identical rows to the incremental path — but only because that
 * assertion already existed. Sharing the expression removes the possibility
 * instead of relying on the test to notice.
 */
const SCORED_NEIGHBOURS_FOR_AFFECTED = `
  select d.seed_id,
         d.candidate_id,
         ${RELATEDNESS} as score,
         row_number() over (
           partition by d.seed_id
           order by ${RELATEDNESS} desc,
                    d.candidate_id
         ) as rank
    from (
      select video_a as seed_id, video_b as candidate_id, weight
        from covisitation
       where video_a in (select seed_id from affected)
      union all
      select video_b as seed_id, video_a as candidate_id, weight
        from covisitation
       where video_b in (select seed_id from affected)
    ) d
    ${SESSION_COUNT_JOINS}
   where d.weight >= $3
`;
