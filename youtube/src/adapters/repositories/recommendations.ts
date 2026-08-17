import "server-only";

import { database } from "@/adapters/db";
import type { SqlExecutor, SqlRow } from "@/adapters/db";
import {
  HOME_CHANNEL_CAP,
  HOME_FEED_SIZE,
  HOME_SEED_LIMIT,
  HOP_FANOUT,
  MAX_HOPS,
  SHORTS_CHANNEL_CAP,
  SHORTS_FEED_SIZE,
  SHORTS_SEED_LIMIT,
  SIDEBAR_CHANNEL_CAP,
  SIDEBAR_SIZE,
  TOP_K_SERVED,
  aggregateAcrossSeeds,
  backfill,
  bestPerCandidate,
  capPerChannel,
  pickAutoplay,
} from "@/domain/recommender";
import type { HopCandidate, Viewer } from "@/domain/recommender";
import type { VideoCard } from "@/domain/types";

import { Params, bool, num, text } from "./shared";
import { toCard } from "./videos";

/**
 * Reading the co-visitation graph, for the four surfaces that read it.
 *
 * All four run the same three stages — seed, expand, rank — and differ only in
 * what they seed from and what they refuse to return. The stages are split
 * between SQL and TypeScript along one line: SQL does the parts whose cost
 * depends on the size of the corpus (the seed lookup, the indexed hop, the
 * fallback pool, the card join), and the domain module does the parts whose
 * cost depends on the size of the candidate list, which is a few hundred rows
 * at most. Research §4.4 writes the channel cap as a window function; it is a
 * pure function here instead, because four surfaces share it and a window
 * function copied into four queries is four places for it to drift.
 *
 * Every query that limits is ordered down to a tie-break on the id, per
 * research §6 — a `LIMIT` over a partial order is a sampler. Never on a
 * timestamp, even though `watched_at` and `published_at` look like they would
 * separate any two rows: PGlite's `now()` resolves to the millisecond where
 * real Postgres resolves to the microsecond (measured by the auth slice), so
 * rows written together are indistinguishable here and distinguishable on Neon.
 * A timestamp tie-break is a test that passes deployed and flakes locally,
 * which is the direction that gets assertions weakened instead of bugs fixed.
 *
 * Nothing here consults `covisitation` directly. The read path is
 * `related_videos`, which is denormalised to both directions precisely so that
 * a lookup is `where seed_id = …` against one index rather than a union with a
 * `CASE` over the canonical pair.
 */

/** A candidate, with the seeds that reached it kept for "Because you watched X"
 * — D10 §2.3 keeps these associations for exactly that. */
export interface RecommendationCandidate {
  readonly card: VideoCard;
  readonly score: number;
  readonly seedIds: readonly string[];
}

/* ------------------------------------------------------------- surfaces -- */

/**
 * The watch page's sidebar: what is related to the one video playing.
 *
 * Z19 §1 frames its whole paper around this problem and Z19 §3.1 confirms
 * co-visitation as one of its candidate sources, so a single-seed expansion is
 * the right shape here rather than a personalised one. The viewer's history is
 * used only for the red progress bar under each thumbnail; a video the viewer
 * has already seen is a legitimate sidebar row, unlike on the home feed.
 *
 * Backfilled like every other surface. A watch page whose sidebar is empty
 * because the corpus is young is the cold-start case research §5 says will be
 * the *common* case, not the exception.
 */
export async function watchNextSidebar(
  seedVideoId: string,
  viewer: Viewer,
  exec?: SqlExecutor,
): Promise<VideoCard[]> {
  const handle = exec ?? (await database());
  const related = await relatedScoredCards(handle, seedVideoId, viewer);
  const ranked = capPerChannel(related, SIDEBAR_CHANNEL_CAP);
  const pool = await fallbackPool(handle, viewer, {
    exclude: [seedVideoId, ...ranked.map((row) => row.id)],
    limit: SIDEBAR_SIZE,
  });
  return backfill(ranked, pool, SIDEBAR_SIZE).map((row) => row.card);
}

/**
 * The home feed: many seeds, D10 §1.1's "unarticulated want".
 *
 * Two exclusions differ here and the difference is deliberate. The personalised
 * half drops anything the viewer has already watched, per research §4.4 — a
 * recommendation to rewatch is not a recommendation. The fallback half does
 * not, because its entire job is to guarantee the page is non-empty, and a
 * viewer who has worked through a small corpus would otherwise be shown a blank
 * home page as a reward. Research §5's cold-start query makes the same choice:
 * its fallback excludes only what the personalised half already returned.
 */
export async function homeFeed(
  viewer: Viewer,
  exec?: SqlExecutor,
): Promise<VideoCard[]> {
  const handle = exec ?? (await database());
  const seedIds = await recentSeeds(handle, viewer, HOME_SEED_LIMIT, false);
  const ranked = capPerChannel(
    (await personalisedCandidates(handle, viewer, seedIds, false)).filter(
      (row) => !row.watchedByViewer,
    ),
    HOME_CHANNEL_CAP,
  );
  const pool = await fallbackPool(handle, viewer, {
    exclude: ranked.map((row) => row.id),
    limit: HOME_FEED_SIZE,
  });
  return backfill(ranked, pool, HOME_FEED_SIZE).map((row) => row.card);
}

/**
 * The Shorts feed: same multi-seed shape, three narrower windows.
 *
 * Seeded from the last few shorts rather than the last ten videos, restricted
 * to vertical videos on both the seed and the candidate side, and backfilled
 * newest-first rather than most-viewed-first. Research §7's reasoning for the
 * last of those is that a healthy Shorts corpus is disproportionately new
 * content that has not accumulated co-visits yet, so this surface lands on the
 * cold-start path more than any other by design rather than by data gap —
 * ordering its fallback by popularity would show the same handful of videos
 * until the graph caught up.
 */
export async function shortsFeed(
  viewer: Viewer,
  exec?: SqlExecutor,
): Promise<VideoCard[]> {
  const handle = exec ?? (await database());
  const seedIds = await recentSeeds(handle, viewer, SHORTS_SEED_LIMIT, true);
  const ranked = capPerChannel(
    (await personalisedCandidates(handle, viewer, seedIds, true)).filter(
      (row) => !row.watchedByViewer,
    ),
    SHORTS_CHANNEL_CAP,
  );
  const pool = await fallbackPool(handle, viewer, {
    exclude: ranked.map((row) => row.id),
    limit: SHORTS_FEED_SIZE,
    shortsOnly: true,
    freshestFirst: true,
  });
  return backfill(ranked, pool, SHORTS_FEED_SIZE).map((row) => row.card);
}

/**
 * The one video that plays when this one ends.
 *
 * Two things separate it from taking the sidebar's first row. It ranks on the
 * quality proxy ahead of relatedness (research §7 — see
 * `compareByAutoplayPriority` for why the subordination is safe), and it
 * excludes everything watched in this sitting rather than only the video on
 * screen, because "not the one that just played" is the property and the
 * previous video in a two-video corpus is just as wrong an answer.
 *
 * The fallback is consulted only when relatedness produced nothing at all,
 * rather than merged with the related candidates. Merging would let a popular
 * unrelated video win the slot on the quality proxy, which is the one place the
 * proxy is *not* ranking within a set relatedness already chose.
 */
export async function autoplayNext(
  currentVideoId: string,
  viewer: Viewer,
  exec?: SqlExecutor,
): Promise<VideoCard | null> {
  const handle = exec ?? (await database());
  const watchedThisSitting = await sessionWatchedIds(handle, viewer.sessionKey);
  const excluded = new Set([currentVideoId, ...watchedThisSitting]);

  const related = await relatedScoredCards(handle, currentVideoId, viewer);
  const fromGraph = pickAutoplay(related, excluded);
  if (fromGraph !== null) return fromGraph.card;

  const pool = await fallbackPool(handle, viewer, {
    exclude: [...excluded],
    limit: SIDEBAR_SIZE,
  });
  return pickAutoplay(pool, excluded)?.card ?? null;
}

/* ------------------------------------------------- candidate generation -- */

/**
 * D10 Eq. 2–4 for a single seed: expand, collapse the paths, drop the seed
 * itself, attach the cards.
 *
 * Exported because it is the stage before every surface's own filtering, and
 * because a surface's output cannot tell a candidate the graph produced from
 * one the fallback backfilled — a test that wants to prove a two-hop expansion
 * reached something has to look here.
 */
export async function relatedCandidates(
  seedVideoId: string,
  viewer: Viewer,
  exec?: SqlExecutor,
): Promise<RecommendationCandidate[]> {
  const handle = exec ?? (await database());
  const scored = await relatedScoredCards(handle, seedVideoId, viewer);
  return scored.map((row) => ({
    card: row.card,
    score: row.score,
    seedIds: row.seedIds,
  }));
}

/**
 * The same expansion, keeping the per-viewer columns the surfaces rank on.
 *
 * The quality proxy is one of them, and it has to travel with the row rather
 * than be recomputed from the card: `VideoCard` carries the view count but not
 * the like count, deliberately — a feed row does not display it — so a card
 * alone cannot reconstruct the ratio autoplay ranks by.
 */
async function relatedScoredCards(
  exec: SqlExecutor,
  seedVideoId: string,
  viewer: Viewer,
): Promise<ScoredCard[]> {
  const reached = bestPerCandidate(await expand(exec, [seedVideoId])).filter(
    (candidate) => candidate.id !== seedVideoId,
  );
  const cards = await loadCards(
    exec,
    viewer,
    reached.map((candidate) => candidate.id),
  );

  const out: ScoredCard[] = [];
  for (const candidate of reached) {
    const row = cards.get(candidate.id);
    if (row === undefined) continue;
    out.push({ ...row, score: candidate.score, seedIds: [candidate.seedId] });
  }
  return out;
}

/** The multi-seed half of D10 §2.3, with research §4.4's aggregation. */
async function personalisedCandidates(
  exec: SqlExecutor,
  viewer: Viewer,
  seedIds: readonly string[],
  shortsOnly: boolean,
): Promise<ScoredCard[]> {
  if (seedIds.length === 0) return [];
  const seeds = new Set(seedIds);
  const aggregated = aggregateAcrossSeeds(await expand(exec, seedIds)).filter(
    (candidate) => !seeds.has(candidate.id),
  );

  const cards = await loadCards(
    exec,
    viewer,
    aggregated.map((candidate) => candidate.id),
  );

  const out: ScoredCard[] = [];
  for (const candidate of aggregated) {
    const row = cards.get(candidate.id);
    if (row === undefined) continue;
    if (shortsOnly && !row.card.isShort) continue;
    out.push({ ...row, score: candidate.score, seedIds: candidate.seedIds });
  }
  return out;
}

/**
 * Hop-wise expansion over `related_videos` — D10 Eq. 3's recursion, run to
 * `MAX_HOPS`.
 *
 * A candidate first seen at hop 2 is credited to the seed that reached its
 * intermediate, not to the intermediate: D10 §2.3 associates candidates with
 * videos *in the seed set*, and "because you watched a video related to
 * something you watched" is not an explanation anyone can act on.
 *
 * Each video enters the frontier once, so a diamond in the graph costs one
 * expansion rather than one per path into it. The candidate is still emitted
 * once per path, because `bestPerCandidate` needs to see them all to pick the
 * best.
 */
async function expand(
  exec: SqlExecutor,
  seedIds: readonly string[],
): Promise<HopCandidate[]> {
  const seen = new Set(seedIds);

  /**
   * The seeds a video was reached from — a **set** per video, not one origin.
   *
   * It was `Map<string, string>`, keeping only the first seed to reach each
   * video, and that quietly dropped half the evidence at the second hop. Given
   * S1→B, S2→B and B→X, B is expanded once (which is the intended saving) but
   * its origin was whichever of S1 or S2 the rows happened to list first, so X
   * was credited to one seed and scored as though only one of the viewer's
   * videos led to it. A candidate sitting behind two things you watched is
   * precisely the candidate that should rank highest, and it was ranking as
   * though it sat behind one.
   *
   * The cost stays where the original comment put it: one expansion per video
   * however many paths reach it. What changes is that the emission is per
   * (origin, candidate) rather than per candidate, which is the granularity
   * `aggregateAcrossSeeds` already de-duplicates at.
   *
   * Reading the set at *expansion* time rather than at discovery time is what
   * makes the order of rows within a hop stop mattering: S2→B may be seen
   * after B has already been queued, and B's origins are not consulted until
   * the next hop, by which point both are recorded.
   */
  const originsOf = new Map<string, Set<string>>(
    seedIds.map((id) => [id, new Set([id])] as const),
  );

  const out: HopCandidate[] = [];
  let frontier: readonly string[] = seedIds;

  for (let hop = 1; hop <= MAX_HOPS && frontier.length > 0; hop++) {
    const rows = await neighbours(
      exec,
      frontier,
      hop === 1 ? TOP_K_SERVED : HOP_FANOUT,
    );
    const next: string[] = [];
    for (const row of rows) {
      const origins = originsOf.get(row.seedId) ?? new Set([row.seedId]);
      for (const origin of origins) {
        out.push({ id: row.candidateId, seedId: origin, score: row.score, hop });
      }

      const known = originsOf.get(row.candidateId);
      if (known === undefined) {
        originsOf.set(row.candidateId, new Set(origins));
      } else {
        for (const origin of origins) known.add(origin);
      }

      if (seen.has(row.candidateId)) continue;
      seen.add(row.candidateId);
      next.push(row.candidateId);
    }
    frontier = next;
  }
  return out;
}

interface NeighbourRow {
  readonly seedId: string;
  readonly candidateId: string;
  readonly score: number;
}

async function neighbours(
  exec: SqlExecutor,
  seedIds: readonly string[],
  maxRank: number,
): Promise<NeighbourRow[]> {
  if (seedIds.length === 0) return [];
  const params = new Params();
  const rows = await exec.query(
    `select seed_id, candidate_id, score
       from related_videos
      where seed_id in (${params.bindAll(seedIds)})
        and rank <= ${params.bind(maxRank)}
      order by seed_id, rank`,
    params.values,
  );
  return rows.map((row) => ({
    seedId: text(row, "seed_id"),
    candidateId: text(row, "candidate_id"),
    score: num(row, "score"),
  }));
}

/* ------------------------------------------------------- seeds and cards -- */

/**
 * The seed set: the viewer's most recently watched distinct videos.
 *
 * Grouped and ordered on `max(watched_at)`, not `distinct on`. Research §4.4
 * writes this as `select distinct on (video_id) … order by video_id,
 * watched_at desc limit 10`, which is wrong in a way that reads as right:
 * `distinct on` forces the `order by` to lead with the distinct key, so the
 * `limit` takes the ten lowest video ids rather than the ten most recent
 * watches. The seed set would be a stable arbitrary sample of the viewer's
 * history instead of the recent part of it.
 *
 * A signed-out viewer seeds from the session cookie, which is the whole reason
 * `watch_events.session_key` is `not null` — co-visitation has to work before
 * anyone has an account, or the graph never gets built on a demo corpus.
 *
 * This is the one query where a timestamp is the *primary* sort key, because
 * recency is the thing being asked for. It is still terminated by the video id:
 * two watches in the same millisecond are one row apart in PGlite and two rows
 * apart in real Postgres, and a seed set that differed between the two engines
 * would change every downstream recommendation.
 */
async function recentSeeds(
  exec: SqlExecutor,
  viewer: Viewer,
  limit: number,
  shortsOnly: boolean,
): Promise<string[]> {
  const params = new Params();
  const column = viewer.userId === null ? "w.session_key" : "w.user_id";
  const rows = await exec.query(
    `select w.video_id
       from watch_events w
       join videos v on v.id = w.video_id
      where ${column} = ${params.bind(viewer.userId ?? viewer.sessionKey)}
        and ${PUBLIC_AND_READY}
        ${shortsOnly ? "and v.is_short" : ""}
      group by w.video_id
      order by max(w.watched_at) desc, w.video_id asc
      limit ${params.bind(limit)}`,
    params.values,
  );
  return rows.map((row) => text(row, "video_id"));
}

/** Every distinct video watched under this session cookie. Autoplay's "just
 * watched" set — bounded by the session, so no lookback window has to be
 * invented for it. */
async function sessionWatchedIds(
  exec: SqlExecutor,
  sessionKey: string,
): Promise<string[]> {
  const rows = await exec.query(
    `select distinct video_id from watch_events where session_key = $1`,
    [sessionKey],
  );
  return rows.map((row) => text(row, "video_id"));
}

interface CardRow {
  readonly id: string;
  readonly channelId: string;
  readonly qualityScore: number;
  readonly watchedByViewer: boolean;
  readonly card: VideoCard;
}

interface ScoredCard extends CardRow {
  readonly score: number;
  readonly seedIds: readonly string[];
}

/**
 * Cards for a known set of candidate ids, with the two per-viewer facts the
 * ranking needs attached.
 *
 * Both of those are correlated subqueries, which is affordable only because
 * this runs against an id list of at most a few hundred rather than the
 * catalogue. `watched_by_viewer` is computed rather than filtered so that one
 * query serves both the home feed, which drops those rows, and the sidebar,
 * which keeps them.
 *
 * The eligibility filter is here rather than in the expansion, so a private or
 * still-processing video can act as a bridge between two public ones without
 * ever being recommended. Filtering it out of the graph instead would silently
 * disconnect its neighbours from each other.
 */
async function loadCards(
  exec: SqlExecutor,
  viewer: Viewer,
  ids: readonly string[],
): Promise<Map<string, CardRow>> {
  if (ids.length === 0) return new Map();
  const params = new Params();
  const rows = await exec.query(
    `${cardSelect(viewer, params)} and v.id in (${params.bindAll(ids)})`,
    params.values,
  );
  return new Map(rows.map((row) => [text(row, "id"), toCardRow(row)]));
}

/**
 * D10 §4's "Most Viewed" browse-page module, repurposed as the backfill every
 * surface ends with rather than as a comparison arm.
 *
 * Research §5's reframing is the one this depends on: on a young corpus this is
 * not the exceptional path, it is the path, and a cold-start branch that only
 * runs when personalisation returns empty would be the least-tested code in the
 * slice while serving most of the traffic.
 */
async function fallbackPool(
  exec: SqlExecutor,
  viewer: Viewer,
  options: {
    readonly exclude: readonly string[];
    readonly limit: number;
    readonly shortsOnly?: boolean;
    readonly freshestFirst?: boolean;
  },
): Promise<ScoredCard[]> {
  const params = new Params();
  const filters = [
    options.shortsOnly === true ? "and v.is_short" : "",
    options.exclude.length > 0
      ? `and v.id not in (${params.bindAll(options.exclude)})`
      : "",
  ].join(" ");

  /**
   * Both orders end on `v.id desc` rather than `asc`, which is the direction
   * `videos_shorts_idx` and `videos_published_idx` declare. The direction of a
   * tie-break is arbitrary as long as it is total, so it costs nothing to point
   * it at the index — and the freshest-first order is exactly the index's
   * `(published_at desc, id desc)`, on the surface research §5 says spends most
   * of its life on this path. `nulls last` is absent because it would defeat
   * that match and because `PUBLIC_AND_READY` has already excluded the rows it
   * would have moved.
   */
  const order =
    options.freshestFirst === true
      ? "v.published_at desc, v.id desc"
      : "v.view_count desc, v.published_at desc, v.id desc";

  const rows = await exec.query(
    `${cardSelect(viewer, params)} ${filters}
      order by ${order}
      limit ${params.bind(options.limit)}`,
    params.values,
  );

  /**
   * Score zero, not the view count. These rows are appended beneath the
   * personalised ones rather than ranked against them, and giving them a score
   * on a different scale would only invite someone to sort the two together.
   * Their order is the `order by` above.
   */
  return rows.map((row) => ({ ...toCardRow(row), score: 0, seedIds: [] }));
}

/**
 * The card projection, shared so the two queries that return cards cannot
 * return different shapes. `$1` is the viewer's user id and may be null: the
 * `watch_progress` join then matches nothing and every card's progress bar is
 * absent, which is correct for a signed-out viewer and does not need a second
 * query to say so.
 *
 * `quality_score` is autoplay's appreciation proxy. Research §7 names
 * `(like_count + favorite_count) / view_count`; this schema has no favourite
 * counter on a video — the "liked" playlist is a playlist — so it is the like
 * ratio alone. C16 §4's real objective is expected watch time, which needs
 * telemetry this application does not collect; the research is explicit that
 * the ratio is a stand-in for it rather than a measurement of it.
 */
function cardSelect(viewer: Viewer, params: Params): string {
  const userId = params.bind(viewer.userId);
  const viewerKey = params.bind(viewer.userId ?? viewer.sessionKey);
  const watchedBy = viewer.userId === null ? "w.session_key" : "w.user_id";

  return `
    select v.id,
           v.title,
           v.channel_id,
           ch.name        as channel_name,
           ch.handle      as channel_handle,
           ch.avatar_key  as channel_avatar_key,
           ch.verified    as channel_verified,
           v.thumbnail_key,
           v.preview_key,
           v.duration_seconds,
           v.view_count,
           v.published_at,
           v.is_short,
           wp.position_seconds as watched_seconds,
           case when v.view_count > 0
                then v.like_count::double precision / v.view_count
                else 0 end as quality_score,
           exists (
             select 1 from watch_events w
              where w.video_id = v.id and ${watchedBy} = ${viewerKey}
           ) as watched_by_viewer
      from videos v
      join channels ch on ch.id = v.channel_id
      left join watch_progress wp
        on wp.video_id = v.id and wp.user_id = ${userId}::text
     where ${PUBLIC_AND_READY}`;
}

/**
 * What every public feed in this application means by "a video", restated from
 * `videos.ts` because it is a private constant there.
 *
 * `published_at is not null` is the part worth keeping in step: without it a
 * ready, public, never-published video sorts to the *front* of the Shorts feed,
 * because `order by published_at desc` puts nulls first in Postgres. Two
 * repositories disagreeing about which rows are feed-eligible would show a
 * video on one surface and not another with nothing in either query looking
 * wrong.
 */
const PUBLIC_AND_READY = `
  v.visibility = 'public'
  and v.upload_status = 'ready'
  and v.published_at is not null`;

/* ------------------------------------------------------------- plumbing -- */

/**
 * The card itself is mapped by `videos.ts`, which owns the projection every
 * feed shares. Only the two columns this file adds are read here.
 *
 * Going through `shared.ts`'s coercions rather than reading `row.quality_score`
 * directly is what makes a typo'd alias throw: `Number(null)` is `0`, and this
 * slice is almost entirely counts and ratios, so a missing column would arrive
 * as a plausible score rather than as an error and quietly rank every candidate
 * the same.
 */
function toCardRow(row: SqlRow): CardRow {
  return {
    id: text(row, "id"),
    channelId: text(row, "channel_id"),
    qualityScore: num(row, "quality_score"),
    watchedByViewer: bool(row, "watched_by_viewer"),
    card: toCard(row),
  };
}
