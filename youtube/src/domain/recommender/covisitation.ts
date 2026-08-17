/**
 * The co-visitation recommender, with no database in it.
 *
 * `research/04-recommender-covisitation.md` is the specification for this
 * slice. Every constant below cites the section it came from, and where the
 * research marks a value as our decision rather than Davidson et al.'s, so does
 * the comment — the paper is four pages long and genuinely silent on several of
 * these, and attributing our choices to it would make the citations worthless.
 *
 * Two rules that belong to the graph are deliberately *not* here:
 *
 *   Canonical pair ordering stays in SQL. JavaScript's `<` on strings is
 *   UTF-16 code-unit order and Postgres' is the column collation's; they
 *   disagree about case, and every video id is mixed-case base62. Choosing the
 *   canonical order here and letting the `check (video_a < video_b)` constraint
 *   validate it there would pass under PGlite — whose default collation is
 *   byte-wise, so the two happen to agree — and fail against a Neon database
 *   whose default collation is not. `least()`/`greatest()` in the same
 *   statement as the constraint cannot disagree with it.
 *
 *   The top-K and minimum-weight cutoffs are applied by the refresh query, not
 *   by a filter over rows this module has already loaded. They exist to keep
 *   the read table small; applying them after the read would be applying them
 *   to the thing they were supposed to prevent.
 *
 * `relatedness` and `clearsCoVisitFloor` are the score and the floor written
 * once in TypeScript. The refresh query computes both in SQL because it runs
 * over the whole pair table, so the rule genuinely exists twice —
 * `adapters/repositories/__tests__/recommendations.test.ts` asserts the two
 * agree, which is what keeps a real risk from becoming a real problem.
 *
 * Nothing here reads a clock or a random number generator, and every ordering
 * function ends on a comparison of ids. Research §6 is a list of the places
 * non-determinism enters a recommender that contains no `random()` call
 * anywhere, and every one of them is a tie.
 */

/** Who is asking. `userId` is null for a signed-out viewer, which is the
 * common case on a fresh corpus and the case the cold-start path exists for;
 * `sessionKey` is the cookie value that groups their watches and is always
 * present. */
export interface Viewer {
  readonly userId: string | null;
  readonly sessionKey: string;
}

/* ------------------------------------------------------------- the graph -- */

/**
 * The most distinct videos one session contributes to the graph.
 *
 * Research §3. A session with k distinct videos produces k(k−1)/2 pairs, and
 * the j-th video added costs j−1 upserts — the 50th costs 49, an uncapped 80th
 * would cost 79. The cap is not only a cost control, and that is why 50 rather
 * than a smaller number: the research's argument is that pairs from very long
 * sessions are the *weakest* signal per pair anyway, so the cap discards
 * low-value data rather than high-value data. Cutting at 20 would start
 * discarding sessions that say something.
 */
export const SESSION_VIDEO_CAP = 50;

/**
 * The raw co-visit count a pair must reach before it is scored at all.
 *
 * Research §3, for a demo-scale corpus of tens of thousands of watch events; it
 * recommends 5–10 past a few hundred thousand sessions. D10 §2.2 states a
 * minimum *score* threshold; the raw-count floor applied before scoring is the
 * research's addition, and it is the cheaper of the two because it keeps a
 * one-off unrelated co-watch out of the read table without computing anything.
 *
 * The visible consequence is D10's own stated tradeoff, not a defect: on a
 * fresh corpus almost no pair clears 3, so almost every surface is served
 * entirely by the cold-start pool (research §5). Every surface here therefore
 * backfills unconditionally rather than treating cold start as an edge case.
 */
export const MIN_COVISIT_WEIGHT = 3;

/**
 * How many neighbours the refresh materialises per seed, and how many of them
 * a surface actually expands.
 *
 * Research §3 gives both numbers and the reason they differ: 20 is what gets
 * served, 50 is stored so that re-ranking and the channel cap have room to work
 * inside a seed's own neighbour list without a second query. A stored K of 20
 * would mean a seed whose top 20 are all one channel has nothing left after
 * diversification.
 */
export const TOP_K_STORED = 50;
export const TOP_K_SERVED = 20;

/**
 * Hop-wise expansion along the related-videos graph, D10 Eq. 2–4.
 *
 * D10 says only "a small distance" and never quantifies it. Research §1.3
 * extrapolates 2 from the paper's own branching-factor argument: one hop from a
 * handful of seeds already yields |S| × 20 candidates, and a third hop over a
 * graph with this fan-out adds noise and cost rather than reach.
 *
 * `HOP_FANOUT` is smaller than `TOP_K_SERVED` because it multiplies: 20 seeds
 * expanded at 20 each is 400 candidate slots, at 10 each it is 200 and the
 * ranking is not measurably worse on a corpus this size.
 *
 * D10 uses the letter N for both this and the top-K cutoff, which are unrelated
 * quantities — research §1.3 flags the collision explicitly, so they are two
 * named constants here and never one.
 */
export const MAX_HOPS = 2;
export const HOP_FANOUT = 10;

/* ---------------------------------------------------------- the surfaces -- */

/**
 * How many recent distinct videos seed a multi-seed surface.
 *
 * 10 for the home feed is research §4.4's number. Shorts gets 5 because the
 * surface is a swipe session rather than a browsing session — research §7
 * describes its lookback as "the last handful of shorts swiped through in the
 * current sitting, not all-time history", and a 10-video window on a surface
 * people move through in seconds reaches back into a different sitting.
 */
export const HOME_SEED_LIMIT = 10;
export const SHORTS_SEED_LIMIT = 5;

/**
 * How many recommendations a surface returns. D10 §2.4 puts the real product
 * range at "between 4 and 60"; these are the three points in it this
 * application uses, and they are ours rather than the paper's.
 */
export const HOME_FEED_SIZE = 40;
export const SIDEBAR_SIZE = 20;
export const SHORTS_FEED_SIZE = 20;

/**
 * The most recommendations one channel may contribute to a surface.
 *
 * 2 for the home feed is research §4.4's number and D10 §2.4's second named
 * diversification mechanism. The sidebar gets 3 rather than 2 — ours, not the
 * research's, which gives a number only for the home feed. A sidebar is a
 * single-topic surface where a series playing out over three slots is the
 * expected result and not a diversity failure; twenty slots from one uploader
 * still is, which is what the cap is for.
 */
export const HOME_CHANNEL_CAP = 2;
export const SIDEBAR_CHANNEL_CAP = 3;
export const SHORTS_CHANNEL_CAP = 2;

/* --------------------------------------------------------- the write path -- */

/**
 * What a session does with an incoming watch.
 *
 * `replay` is the one that matters. cij counts *distinct sessions* containing
 * both videos, so a viewer replaying one video four times in a sitting must
 * contribute one to each of its pairs and not four. Research §2 names skipping
 * this as the single most common defect in a from-scratch implementation, and
 * the reason it survives review is that the output stays plausible: replay
 * weighting inflates exactly the popular pairs a recommender leans on hardest,
 * so the recommendations still look right while being systematically biased.
 *
 * `capped` skips the membership row as well as the pairs, which is the part
 * worth stating: the invariant is that one row in `session_videos` corresponds
 * to exactly one increment of that video's `session_count`. The rejected
 * alternative — record membership but generate no pairs — breaks it in the
 * worst direction, growing the cj denominator of a video whose cij never grew
 * and quietly penalising it on every surface.
 */
export type SessionAdmission = "admit" | "replay" | "capped";

export function admitToSession(
  distinctVideosInSession: number,
  alreadyInSession: boolean,
): SessionAdmission {
  if (alreadyInSession) return "replay";
  if (distinctVideosInSession >= SESSION_VIDEO_CAP) return "capped";
  return "admit";
}

/* ------------------------------------------------------------- the score -- */

/**
 * D10 Eq. 1, as it is actually computed.
 *
 * The paper's score is r(vi,vj) = cij / f(vi,vj) with f(vi,vj) = ci·cj, and
 * then says outright that ci is constant across every candidate for a fixed
 * seed and can be dropped without changing the ranking. So this takes only the
 * candidate's count, and the stated consequence — the ranking favours less
 * popular candidates — is the normalisation working, not a bug in it.
 *
 * `candidateSessionCount` is the number of distinct sessions containing the
 * candidate. It is not `videos.view_count`: the two diverge the moment anyone
 * rewatches anything, and substituting the view count would penalise a video
 * for being rewatched, which is the opposite of what the signal means.
 *
 * The zero guard is unreachable through the write path — a video only acquires
 * a pair by being in a session, which is the same event that makes its count 1
 * — but a division by zero would take down the whole refresh rather than one
 * row, so it is cheaper to hold than to argue about.
 */
export function relatedness(
  coVisits: number,
  candidateSessionCount: number,
): number {
  return candidateSessionCount > 0 ? coVisits / candidateSessionCount : 0;
}

/** Research §3's raw-count floor, applied before scoring. */
export function clearsCoVisitFloor(weight: number): boolean {
  return weight >= MIN_COVISIT_WEIGHT;
}

/* ------------------------------------------------- candidate generation -- */

/** A candidate and the path that reached it. */
export interface HopCandidate {
  readonly id: string;
  /**
   * The video in the viewer's seed set this candidate was reached from — D10
   * §2.3 keeps these associations "for ranking purposes and to provide
   * explanations", which is where "Because you watched X" comes from. For a
   * candidate two hops out this is the original seed, not the intermediate.
   */
  readonly seedId: string;
  readonly score: number;
  /** 1 for a direct neighbour, 2 for one reached through a neighbour. */
  readonly hop: number;
}

/** A candidate after the seeds that reached it have been combined. */
export interface AggregatedCandidate {
  readonly id: string;
  readonly score: number;
  readonly seedIds: readonly string[];
}

/**
 * Collapse the multiple paths that reach one candidate down to its best score.
 *
 * D10 does not say how a two-hop candidate's score derives from the two edges
 * it crossed — research §1.3 is explicit that this is a gap in the paper and
 * not an omission in the reading. Of the two standard answers, the research
 * picks best-hop-wins over multiplying the edge weights, because it is a
 * `MAX` in SQL rather than a product over paths and because the paper treats
 * hop distance as an association to keep, not a decay to compound.
 *
 * The consequence is real and worth naming: a two-hop candidate can outrank a
 * one-hop one. That follows from the research's own ranking (§4.3 orders by
 * score alone, with hop nowhere in the ORDER BY), so hop is used here only to
 * decide which record survives a tie, never to demote.
 */
export function bestPerCandidate(
  candidates: readonly HopCandidate[],
): HopCandidate[] {
  const best = new Map<string, HopCandidate>();
  for (const candidate of candidates) {
    const incumbent = best.get(candidate.id);
    if (incumbent === undefined || preferredPath(candidate, incumbent) < 0) {
      best.set(candidate.id, candidate);
    }
  }
  return [...best.values()].sort(compareByScore);
}

/**
 * Sum a candidate's score across the distinct seeds that reached it — research
 * §4.4's aggregation for a multi-seed surface.
 *
 * The sum is over seeds, so a candidate is first collapsed *within* each seed
 * by `bestPerCandidate`'s rule. Without that, a candidate reachable from one
 * seed both directly and through a neighbour would be counted twice for one
 * seed and outrank a candidate that genuinely two different seeds agreed on,
 * which is the opposite of what summing across seeds is for.
 */
export function aggregateAcrossSeeds(
  candidates: readonly HopCandidate[],
): AggregatedCandidate[] {
  /**
   * A map of maps, rather than one map keyed on the two ids joined by a
   * separator. Video ids are base62 plus `-` and `_`, so every printable
   * separator is a character an id may legally contain, and a joined key two
   * different pairs can both produce is a collision that surfaces as one seed's
   * score landing silently on another seed's candidate. Nesting removes the
   * question instead of answering it.
   */
  const perSeed = new Map<string, Map<string, HopCandidate>>();
  for (const candidate of candidates) {
    let bySeed = perSeed.get(candidate.seedId);
    if (bySeed === undefined) {
      bySeed = new Map();
      perSeed.set(candidate.seedId, bySeed);
    }
    const incumbent = bySeed.get(candidate.id);
    if (incumbent === undefined || preferredPath(candidate, incumbent) < 0) {
      bySeed.set(candidate.id, candidate);
    }
  }

  const totals = new Map<string, { score: number; seedIds: string[] }>();
  for (const bySeed of perSeed.values()) {
    for (const candidate of bySeed.values()) {
      const entry = totals.get(candidate.id) ?? { score: 0, seedIds: [] };
      entry.score += candidate.score;
      entry.seedIds.push(candidate.seedId);
      totals.set(candidate.id, entry);
    }
  }

  return [...totals.entries()]
    .map(([id, entry]) => ({
      id,
      score: entry.score,
      seedIds: [...entry.seedIds].sort(compareIds),
    }))
    .sort(compareByScore);
}

/* ------------------------------------------------------------- ordering -- */

/**
 * Score descending, then id ascending.
 *
 * The second key is the whole point. Two candidates each co-watched with the
 * seed once, each appearing in one session, both score exactly 1 — on a small
 * corpus that is routine rather than rare, and Postgres does not guarantee an
 * order for ties, nor even a stable one across runs. Research §6 identifies
 * this as the main way non-determinism enters a system that calls `random()`
 * nowhere, and it is the easiest thing to drop when someone later simplifies a
 * comparator.
 */
export function compareByScore(
  a: { readonly id: string; readonly score: number },
  b: { readonly id: string; readonly score: number },
): number {
  if (a.score !== b.score) return b.score - a.score;
  return compareIds(a.id, b.id);
}

/**
 * Autoplay's order: the quality proxy first, then relatedness.
 *
 * Research §7 puts the proxy *ahead* of the relatedness score rather than using
 * it to break ties within it, and the reason is specific to this surface: an
 * autoplayed video is never clicked, so there is no click to have been earned,
 * and C16 §4's argument that CTR promotes clickbait applies harder where
 * consent is implied rather than given.
 *
 * That subordination is only defensible because it runs *after* candidate
 * generation. Everything being ordered here has already cleared the co-visit
 * floor and the top-K cutoff, so this ranks within a set that relatedness
 * already chose — the two-stage funnel research §8 describes. Ordering the
 * whole catalogue this way would hand the slot to any video with one like and
 * one view.
 */
export function compareByAutoplayPriority(
  a: { readonly id: string; readonly score: number; readonly qualityScore: number },
  b: { readonly id: string; readonly score: number; readonly qualityScore: number },
): number {
  if (a.qualityScore !== b.qualityScore) return b.qualityScore - a.qualityScore;
  return compareByScore(a, b);
}

/* --------------------------------------------------------- diversification -- */

/**
 * D10 §2.4's second named diversification mechanism: cap how many
 * recommendations one uploader may contribute.
 *
 * Input order is preserved rather than re-sorted, so this composes after any
 * ranking without knowing what it was. Research §6 rejects the alternative the
 * production literature allows — weighted random sampling among near-ties — for
 * this codebase specifically, because the suites assert exact sequences and a
 * sampled list is indistinguishable from a broken one.
 */
export function capPerChannel<T extends { readonly channelId: string }>(
  items: readonly T[],
  cap: number,
): T[] {
  const perChannel = new Map<string, number>();
  const kept: T[] = [];
  for (const item of items) {
    const used = perChannel.get(item.channelId) ?? 0;
    if (used >= cap) continue;
    perChannel.set(item.channelId, used + 1);
    kept.push(item);
  }
  return kept;
}

/**
 * Personalised rows first, topped up from the fallback pool — research §5.
 *
 * The reframing that matters is research §5's: on a fresh corpus "the home page
 * stays non-empty" is not a co-visitation requirement at all, it is a
 * requirement that the fallback path is queried unconditionally rather than
 * when personalisation is detected to have failed. There is no mode switch to
 * get wrong, and as real co-visitation data accumulates the personalised share
 * grows on its own.
 */
export function backfill<T extends { readonly id: string }>(
  personalised: readonly T[],
  pool: readonly T[],
  size: number,
): T[] {
  const out = personalised.slice(0, size);
  const taken = new Set(out.map((item) => item.id));
  for (const item of pool) {
    if (out.length >= size) break;
    if (taken.has(item.id)) continue;
    taken.add(item.id);
    out.push(item);
  }
  return out;
}

/**
 * The single video autoplay will roll into.
 *
 * `excluded` carries the currently-playing video and everything else watched in
 * this sitting. Returning one of those is the failure mode the surface exists
 * to avoid, so the exclusion is applied here rather than left to the caller's
 * query — the fallback pool that keeps autoplay non-empty on a cold corpus is
 * exactly where a just-watched video would otherwise re-enter.
 */
export function pickAutoplay<
  T extends { readonly id: string; readonly score: number; readonly qualityScore: number },
>(candidates: readonly T[], excluded: ReadonlySet<string>): T | null {
  let best: T | null = null;
  for (const candidate of candidates) {
    if (excluded.has(candidate.id)) continue;
    if (best === null || compareByAutoplayPriority(candidate, best) < 0) {
      best = candidate;
    }
  }
  return best;
}

/* ------------------------------------------------------------- internals -- */

/**
 * Which of two paths to one candidate to keep: the higher score, then the
 * shorter path, then the lower seed id. The last two never change a ranking —
 * the scores are equal by then — they only make the retained record, and so the
 * "because you watched X" attribution, the same on every run.
 */
function preferredPath(a: HopCandidate, b: HopCandidate): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.hop !== b.hop) return a.hop - b.hop;
  return compareIds(a.seedId, b.seedId);
}

/**
 * Code-unit order, which is a total order over ids and is all a tie-break
 * needs. It is not the order Postgres would produce under a case-folding
 * collation, and it does not have to be: an id comparison is only ever reached
 * here when the scores are already equal, so the two engines can disagree about
 * which of two indistinguishable candidates comes first and about nothing else.
 */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
