# Recommender: Co-Visitation (Research Lane R4)

Primary sources, read in full from PDF:

- **Davidson, J. et al. (2010). "The YouTube Video Recommendation System."** RecSys '10, pp. 293–296. DOI: [10.1145/1864708.1864770](https://doi.org/10.1145/1864708.1864770). Four-page short paper — this is the whole thing, not an excerpt. Cited below as **D10**, by section.
- **Covington, P., Adams, J., Sargin, E. (2016). "Deep Neural Networks for YouTube Recommendations."** RecSys '16, pp. 191–198. DOI: [10.1145/2959100.2959190](https://doi.org/10.1145/2959100.2959190). Cited as **C16**.
- **Zhao, Z. et al. (2019). "Recommending What Video to Watch Next: A Multitask Ranking System."** RecSys '19, pp. 43–51. DOI: [10.1145/3298689.3346997](https://doi.org/10.1145/3298689.3346997). Cited as **Z19**.

A note on scope, up front: D10 is a *four-page* paper. It states the algorithm precisely where it states it, but it leaves real gaps — no session-boundary mechanic beyond "usually 24 hours," no multi-hop score-combination formula, no incremental-update description (it describes periodic batch recompute, not streaming updates). Every place below where I fill a gap with an implementation decision rather than a quote, I say so explicitly. Do not read a SQL sketch as "the paper says this" — the paper never mentions SQL, Postgres, or row-level updates at all.

---

## 1. The 2010 system, precisely

### 1.1 The co-visitation graph and session definition

D10 §2.2 defines it in one paragraph:

> "Consider sessions of user watch activities on the site. For a given time period (usually 24 hours), we count for each pair of videos (vi, vj) how often they were co-watched within sessions."

That is the entire definition. Two things to notice:

1. **The brief's "~24h" is correct** — the paper says "usually 24 hours" verbatim, as the session time period.
2. **The paper does not specify a session-boundary mechanic.** It never says whether a session is (a) a rolling 24h window per user, (b) a gap-based session (ends after N minutes of inactivity) capped at 24h, or (c) a calendar-day bucket. All three are compatible with "usually 24 hours." This is a real gap in the source, not something I'm eliding — a 4-page RecSys paper doesn't have room for a sessionization appendix.

For our implementation we need to pick one. **Recommendation (ours, not D10's): gap-based sessionization** — a session ends when a user has gone more than a fixed idle gap (e.g. 30 minutes) without a watch event, with a hard cap of 24 hours on total session length regardless of gaps. This is the standard web-analytics session definition (it's what almost every co-visitation reimplementation since 2010 has converged on, precisely because "session" without a gap rule is ambiguous), and it degrades gracefully: a user who leaves videos playing in a background tab for a week doesn't silently accumulate one giant session.

The co-visitation count `c_ij` is defined as: the number of *distinct sessions* in which both `v_i` and `v_j` were watched. This matters for the incremental-update algorithm in §2 below — it means a pair count increments **once per session**, not once per watch event (a user re-watching the same video five times in one session must not inflate `c_ij` five times against every other video in that session).

### 1.2 The relatedness score — exact formula

D10 §2.2, Equation 1:

```
r(vi, vj) = cij / f(vi, vj)
```

where:
- `c_ij` — the co-visitation count for the pair, as defined above.
- `f(vi, vj)` — "a normalization function that takes the 'global popularity' of both the seed video and the candidate video into account."

The paper gives the simplest concrete instance of `f`:

```
f(vi, vj) = ci · cj
```

where `c_i` and `c_j` are "the total occurrence counts across all sessions for videos vi and vj, respectively" — i.e. how many distinct sessions each video appeared in at all, independent of the pairing.

Then the paper makes an important simplification explicit: **for a fixed seed `v_i`, `c_i` is a constant across every candidate `v_j` being scored**, so it drops out of the ranking (it doesn't change relative order). The paper says this outright:

> "When using the simple product of cardinalities for normalization, ci is the same for all candidate related videos and can be ignored in our setting, so we are normalizing only by the candidate's global popularity. This essentially favors less popular videos over popular ones."

So in practice, ranking candidates for a fixed seed reduces to:

```
r(vi, vj)  ∝  cij / cj
```

This is the operative formula — it is what actually gets computed at candidate-scoring time, and its behavior (favoring less-popular candidates) is a direct, stated consequence of the normalization choice, not a side effect. The paper cites Spertus, Sahami & Buyukkokten (KDD '05, "Evaluating similarity measures: a large-scale study in the orkut social network") as a reference for *other* possible normalization functions, without spelling out which ones — D10 explicitly says "other normalization functions are possible. See [6] for an overview of possible choices." I have not read that paper as part of this task; if you want alternatives, the two standard ones from the co-occurrence-similarity literature generally are Jaccard (`cij / (ci + cj − cij)`) and cosine (`cij / sqrt(ci · cj)`) — flagging these as *standard alternatives*, not something D10 states.

`R_i`, the related-video set for seed `v_i`, is then: the top-N candidates by `r(v_i, v_j)`, subject to **a minimum score threshold** (stated separately from the top-N cutoff — a candidate can fail to make `R_i` even if there's room in the top N, if its score is below the floor). The paper is explicit about the consequence: many low-view-count videos get **no** related-video set at all, because their co-visitation counts with anything are too sparse to clear the threshold. This is the paper's own statement of the cold-start-for-videos problem (see §5).

The related-video mapping induces a **directed graph**: an edge `e_ij` from `v_i` to `v_j` exists iff `v_j ∈ R_i`, weighted by `r(v_i, v_j)`. It is directed and *not* symmetric — `v_j ∈ R_i` does not imply `v_i ∈ R_j`, because the top-N cutoff and the asymmetric normalization (`c_j` in the denominator, not `c_i`) can rank the pair differently from each side.

### 1.3 Candidate generation — bounded transitive closure

D10 §2.3, Equations 2–4. Given a user's **seed set** `S` — the union of watched (past some watch-fraction threshold), favorited, "liked," rated, and playlisted videos — the candidate set is built by hop-wise expansion along the related-videos graph:

```
C1(S) = ⋃_{vi ∈ S} Ri                                    (Eq. 2)

Cn(S) = ⋃_{vi ∈ C(n-1)} Ri,   with C0 = S                (Eq. 3)

Cfinal = ( ⋃_{i=0}^{N} Ci ) \ S                           (Eq. 4)
```

Read literally: `C1` is "every related video of every seed video." `Cn` for `n > 1` is "every related video of every video reached at distance `n-1`" — a proper BFS-style expansion over the directed related-videos graph, not a random walk. `C_final` unions all hop-levels from 0 through N and then removes the original seed set (you don't recommend someone the video they just watched).

**Notation quirk worth flagging explicitly**, because it's easy to silently "fix" when re-deriving this and get the paper's intent wrong: the paper uses the symbol `N` for *two different things* — the top-N cutoff when building each `R_i` (§2.2), and the hop-distance limit in Equation 4 (§2.3). They are unrelated quantities that happen to share a letter. When implementing, use two separate constants (e.g. `TOP_N_PER_VIDEO` and `MAX_HOPS`).

**How many hops in practice**: the paper does not give a specific number. It says:

> "Due to the high branching factor of the related videos graph we found that expanding over a small distance yielded a broad and diverse set of recommendations even for users with a small seed set."

"A small distance" — not quantified further. Given the branching factor (each hop multiplies candidates by roughly `TOP_N_PER_VIDEO`), a working reimplementation should treat 2 hops as the practical ceiling: 1 hop from a handful of seeds already produces `|S| × TOP_N_PER_VIDEO` candidates, and 2 hops with a branching factor of even 20 produces tens of thousands of raw candidate slots before filtering — enough diversity that a 3rd hop mostly adds noise and cost rather than useful reach. This is a reasoned extrapolation from the paper's stated branching-factor argument, not a number D10 gives.

**Score propagation across hops is not specified in the paper.** This is a real gap, not an oversight on my part — D10 §2.3 says only that "each video in the candidate set is associated with one or more videos in the seed set. We keep track of these seed to candidate associations for ranking purposes and to provide explanations of the recommendations to the user." There is no formula in the paper for how a 2-hop candidate's score is derived from the two edge weights it crossed. Our implementation needs to make this decision (see §4 for the concrete SQL); the two standard choices are (a) **multiply** edge weights along the path (score decays with distance, treating relatedness as a chain of conditional probabilities) or (b) **keep the best single-hop score** the candidate achieved from any path (a candidate reachable both directly and via a 2-hop path keeps its strongest signal). We use (b) below because it is simpler in SQL (a `GROUP BY candidate_id` with `MAX(score)`) and because it matches the paper's own emphasis on hop-distance as a *ranking feature* — closer candidates should generally outrank farther ones, so keeping the best hop-distance and score together (rather than compounding a decay) is a defensible, cheap default.

### 1.4 Ranking

D10 §2.4. After candidate generation produces `C_final`, three signal groups are used, in this stated order:

1. **Video quality signals** — "judge the likelihood that the video will be appreciated irrespective of the user." Concretely: view count, ratings, commenting/favoriting/sharing activity, and upload time.
2. **User specificity signals** — "boost videos that are closely matched with a user's unique taste and preferences," via "properties of the seed video in the user's watch history, such as view count and time of watch." I.e., not properties of the *candidate*, but properties of *which seed produced it and how the user engaged with that seed* — a candidate that came from a seed the user watched a lot of, or watched recently, is boosted relative to one from a seed the user barely engaged with.
3. **Diversification** — the paper states these are combined "using a linear combination of these signals" to produce a ranked list. Then, because the UI displays only "between 4 and 60" recommendations, the system does **not** just take the top-K of that ranked list — it explicitly optimizes for "a balance between relevancy and diversity across categories," removing videos "too similar to each other." The two concrete mechanisms named: (a) cap the number of recommendations attributable to a single seed video, and (b) cap the number of recommendations from the same channel/uploader. The paper notes "more sophisticated techniques based on topic clustering and content analysis" are possible but does not describe any.

### 1.5 The headline result — verified

D10 §4 (Results). The brief's "207%" figure is **correct, verbatim**:

> "We measured CTR for these sections over a period of 21 days. Overall we find that co-visitation based recommendation performs at 207% of the baseline Most Viewed page when averaged over the entire period, while Top Favorited and Top Rated perform at similar levels or below the Most Viewed baseline."

Precisely what that number is:

- **Metric**: click-through rate (CTR), not view counts, watch time, or session length. Normalized/relative CTR (see Figure 2 in the paper — a "Normalized Click Through Rate" chart running roughly 0.8–1.0 for Top Favorited/Top Rated, ~1.0 for Most Viewed, ~2.0–2.2 for Recommended).
- **Surface measured**: the **"browse" pages**, not the home page. The paper is explicit about why: "Comparing the performance of recommendations with other modules on the homepage suffers from presentation bias (recommendations are placed at the top by default)." So they instead compared four *algorithmically generated video sets that are all shown on equal footing on browse pages*: (a) Most Viewed — most-viewed videos in a day (the baseline), (b) Top Favorited, (c) Top Rated, (d) Recommended (co-visitation-based).
- **Period**: 21 days (3 weeks) — the brief's "verify against the paper" checks out on this too.
- **Result**: Recommended CTR ≈ 207% of Most Viewed CTR, averaged over the period. Top Favorited and Top Rated were at or below the Most Viewed baseline — co-visitation-based recommendation was the only one of the three alternative algorithms that clearly beat "most popular."

Separately, and not to be confused with the 207% figure: on the **home page** itself (where presentation bias applies), "recommendations account for about 60% of all video clicks from the home page" — a different statistic, measuring share of clicks rather than relative CTR uplift.

Other metrics the paper says it tracks in production (D10 §3): CTR, "long CTR" (clicks that led to watching a substantial fraction of the video), session length, time until first long watch, and recommendation coverage (fraction of logged-in users who have recommendations available at all). Evaluation method is live A/B testing on production traffic, not offline replay.

---

## 2. Incremental maintenance

**What the paper actually says** (D10 §2.6, System Implementation) is *not* an incremental, row-level update scheme. It describes a **batch pipeline**: "We choose a batch-oriented pre-computation approach rather than on-demand calculation... Recommendations are generated through a series of MapReduce computations that walk through the user/video graph... We mitigate [staleness] by pipelining the recommendation generation, updating the data sets several times per day." That's periodic full (or near-full) recomputation over accumulated logs stored in Bigtable, run a handful of times a day — not a streaming counter update triggered by each watch event.

For our scale (Postgres, PGlite/Neon, a demo dataset), a full-rebuild-every-few-hours batch job is unnecessary overhead and directly conflicts with wanting the structure to "never need a full rebuild." So this section is **our design**, built to satisfy the co-visitation *definition* in §1.1 (session-scoped, deduplicated pair counts) using row-level transactional updates instead of MapReduce batch jobs. It's a reasonable generalization of what D10 computes, just computed differently — continuously instead of periodically.

**The invariant to preserve**: `c_ij` = number of *distinct sessions* containing both `v_i` and `v_j`; `c_i` = number of distinct sessions containing `v_i` at all. Both are monotonically non-decreasing counters (co-visitation counts in this design never decay or expire automatically — see §3 for why you might want windowing anyway).

**Given a session's prior watches, what changes on a single new watch event:**

Let the incoming event be `(user_id, video_id = v_new, session_id, watched_at)`, and let the session already contain the distinct video set `{v_1, ..., v_k}` (k may be 0, for the first watch of a session).

1. **Check whether `v_new` is already in this session's distinct set.** If it is (a re-watch within the same session), *only* the raw watch log gets a new row — no counters change. This is the critical dedup step; skipping it is the single most common bug in a from-scratch reimplementation, because it silently turns "co-visited in a session" into "watched together, weighted by replay count," inflating popular-video pairs.
2. **If `v_new` is new to the session:**
   - `c_{v_new}` (the row in the per-video session-occurrence table) increments by 1 — this video has now appeared in one more distinct session.
   - For **every** other video `v_i` already in `{v_1, ..., v_k}`, the pair `(min(v_i, v_new), max(v_i, v_new))` gets its `c_ij` incremented by 1. This is exactly `k` row touches (or upserts) for a session that already had `k` distinct videos — the quadratic blow-up referenced in §3 is visible right here: the `j`-th distinct video added to a session touches `j-1` existing pairs.
   - The new video is recorded as a member of the session (so future watch events in the same session see it in step 2's loop).
3. **The raw watch event is always logged**, regardless of steps 1–2, because it feeds signals unrelated to co-visitation counting — user-specificity ranking signals (time of watch, per §1.4) and the home-feed seed-selection query (§4c) both read the raw watch log, not the pair-count table.

This is naturally expressed as one SQL transaction per watch event (concrete statements in §4a). No step here requires scanning or rewriting the whole co-visitation table — every write touches only rows belonging to the current session (bounded by the session-length cap from §3) plus one row per newly-touched pair. The structure is correct and query-ready after every single commit; there is no separate "rebuild" phase, batch job, or MapReduce step required, unlike D10's own production system.

---

## 3. Scale and pruning

A session with `k` distinct videos produces `C(k, 2) = k(k-1)/2` pairs when it's the *first* session to co-visit all of them — worse, every subsequent watch event within that session touches `j-1` existing pairs for the `j`-th new video, so a single 50-video binge session does up to 1,225 pair-count upserts. Multiplied across millions of sessions, the pair table grows far faster than the video count or the watch-event count. This is the reason D10's system needs Bigtable and MapReduce at YouTube's scale, and it's the reason a from-scratch Postgres implementation needs deliberate pruning even at demo scale, or the covisitation table becomes the largest and slowest thing in the schema.

D10 itself names exactly one pruning mechanism explicitly — the **minimum score threshold** on `r(v_i, v_j)` for inclusion in `R_i` (§2.2) — and states its cost directly: sparse videos get no related-video set. Everything else below is standard practice for co-visitation systems generally, not something D10 spells out; I'm flagging that distinction per pruning mechanism.

| Pruning | What it does | Cost | Recommended value |
|---|---|---|---|
| **Minimum co-visit threshold** (D10-stated, as a score floor; also useful as a raw-count floor before scoring) | Drop/never-materialize pairs with `c_ij` below a floor before computing `r(vi, vj)` | Long-tail and brand-new videos get no related-video row at all until they clear the floor (this is D10's own stated tradeoff — see §5 for how cold videos still surface) | Raw-count floor of **3** at small/demo scale (tens of thousands of watch events); **5–10** once past a few hundred thousand sessions, to keep noise (one-off unrelated co-watches) out of the graph |
| **Top-K neighbours per video** (this *is* D10's `R_i` top-N cutoff, §2.2 — same mechanism, different name) | Only keep the K highest-`r(vi,vj)` candidates per seed, discard the rest | Bounds per-video fan-out so hop expansion (§1.3) stays cheap; a video with a genuinely broad audience (e.g. a viral hit) loses its long tail of weak-but-real related videos | **K = 20** for what's actually served; store up to **K = 50** in the materialized table so re-ranking/diversity filtering (§1.4) has room to work within a candidate's own neighbour list without re-querying |
| **Session length cap** | Stop adding a session's watches to the distinct-video set once it hits a cap; further watches in that session are logged but no longer generate new pairs | Directly bounds the worst-case `O(k²)` blow-up per session; a genuine binge-watcher's 80th video that day doesn't get compared against their first 79 | **50 distinct videos per session.** Pairs from very long sessions are also the *weakest* signal per pair anyway (a session that touches 80 videos says little about any specific pair of them), so this cap trades away low-value data, not high-value data |
| **Time window / decay** (not in D10 at all — D10's `c_ij` accumulates over "all sessions," unbounded in time; this is us extrapolating from the paper's own stated freshness goal, D10 §1.1/§2: "recommendations to be reasonably recent and fresh") | Only count sessions within a rolling window, or decay old counts, so the graph reflects recent behavior rather than all-time history | Without it, a video that was popular for a month in year one keeps outsized influence forever, contradicting D10's own freshness goal; with it, genuinely evergreen relationships need to keep being "re-earned" by ongoing co-watches | Simplest version: only count sessions from the **last 90 days** in `c_ij`/`c_i` (re-derivable by filtering the underlying watch log by date rather than true decay); if a decay is wanted instead, multiply all counts by **0.98–0.99 nightly** and round, so a pair that stops co-occurring fades out over a few months rather than a hard 90-day cliff |

The session-length cap and the minimum co-visit threshold are the two to implement first — they're cheap, they attack the actual quadratic-blowup mechanism directly, and they're stated (in the threshold's case) or directly implied (in the cap's case, via the branching-factor discussion in §1.3) by the paper itself. Windowing/decay is a real production concern but not urgent at demo scale, where the dataset simply isn't old enough for staleness to matter yet.

---

## 4. SQL implementation

Postgres (PGlite locally, Neon deployed), raw SQL, no ORM — matching this repo's actual dependencies (`@electric-sql/pglite`, `@neondatabase/serverless` are already in `package.json`; there's no query builder or ORM in the dependency list).

### 4.1 Schema

```sql
-- Raw event log. Always appended to, never the read path for ranking.
CREATE TABLE watches (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id),
  video_id      uuid NOT NULL REFERENCES videos(id),
  session_id    uuid NOT NULL,
  watched_at    timestamptz NOT NULL,
  watch_seconds integer  -- nullable: may arrive late/never, per D10 §2.1 ("implicit activity
                          -- data is generated asynchronously and can be incomplete")
);
CREATE INDEX watches_user_recency_idx ON watches (user_id, watched_at DESC);
CREATE INDEX watches_session_idx      ON watches (session_id, watched_at);

-- Dedup helper: distinct (session, video) membership. This IS the session's "video set"
-- referenced throughout §2 — existence in this table is the test in step 1 of the
-- incremental-update algorithm.
CREATE TABLE session_videos (
  session_id      uuid NOT NULL,
  video_id        uuid NOT NULL REFERENCES videos(id),
  first_watched_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, video_id)
);

-- c_i: total distinct-session occurrence count per video (D10 Eq.1's "ci").
CREATE TABLE video_session_counts (
  video_id      uuid PRIMARY KEY REFERENCES videos(id),
  session_count bigint NOT NULL DEFAULT 0
);

-- c_ij: the raw, write-optimized pair counter. Canonicalized so video_id_a < video_id_b —
-- an unordered pair is stored once, never as two rows.
CREATE TABLE covisitation_pairs (
  video_id_a         uuid NOT NULL REFERENCES videos(id),
  video_id_b         uuid NOT NULL REFERENCES videos(id),
  cooccurrence_count bigint NOT NULL DEFAULT 0,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (video_id_a, video_id_b),
  CONSTRAINT ordered_pair CHECK (video_id_a < video_id_b)
);

-- Read-optimized, precomputed R_i (D10 §2.2): one row per (seed, candidate), denormalized
-- to BOTH directions so every lookup is "WHERE seed_id = X" against a single index — no
-- OR/CASE needed at read time. Refreshed periodically from covisitation_pairs (§4.4).
CREATE TABLE related_videos_top_k (
  seed_id           uuid NOT NULL REFERENCES videos(id),
  candidate_id      uuid NOT NULL REFERENCES videos(id),
  relatedness_score double precision NOT NULL,
  rank              integer NOT NULL,
  PRIMARY KEY (seed_id, candidate_id)
);
CREATE INDEX related_videos_seed_rank_idx ON related_videos_top_k (seed_id, rank);
```

(`videos(id, title, view_count, like_count, upload_at, channel_id, duration_seconds, ...)` assumed to already exist from lane(s) covering catalog/content — not respecified here.)

### 4.2 (a) Recording a watch event and updating pairs

One transaction per watch event, implementing the algorithm from §2:

```sql
BEGIN;

-- Step 1: is this video new to the session? ON CONFLICT DO NOTHING + RETURNING tells us.
WITH ins AS (
  INSERT INTO session_videos (session_id, video_id, first_watched_at)
  VALUES ($session_id, $video_id, now())
  ON CONFLICT (session_id, video_id) DO NOTHING
  RETURNING video_id
)
SELECT count(*) AS is_new_to_session FROM ins;
-- Application checks this result. If 0, skip straight to the final INSERT below.

-- Step 2 (only runs if is_new_to_session = 1):

-- 2a. bump c_i for the new video
INSERT INTO video_session_counts (video_id, session_count)
VALUES ($video_id, 1)
ON CONFLICT (video_id) DO UPDATE
  SET session_count = video_session_counts.session_count + 1;

-- 2b. bump c_ij for every OTHER distinct video already in this session
--     (respecting the session-length cap from §3 — the app should stop calling this
--     step, though not step 3, once session_videos for this session hits 50 rows)
INSERT INTO covisitation_pairs (video_id_a, video_id_b, cooccurrence_count, updated_at)
SELECT LEAST(sv.video_id, $video_id), GREATEST(sv.video_id, $video_id), 1, now()
FROM session_videos sv
WHERE sv.session_id = $session_id AND sv.video_id <> $video_id
ON CONFLICT (video_id_a, video_id_b) DO UPDATE
  SET cooccurrence_count = covisitation_pairs.cooccurrence_count + 1,
      updated_at = now();

-- Step 3: always log the raw event, new-to-session or not.
INSERT INTO watches (user_id, video_id, session_id, watched_at, watch_seconds)
VALUES ($user_id, $video_id, $session_id, $watched_at, $watch_seconds);

COMMIT;
```

### 4.3 (b) Candidates for a seed video — 1-hop and 2-hop

Reading from the precomputed `related_videos_top_k` table (§4.4), not live from `covisitation_pairs` — see the cost discussion below for why.

```sql
-- 1-hop: direct related videos of a single seed.
SELECT candidate_id, relatedness_score, 1 AS hop
FROM related_videos_top_k
WHERE seed_id = $seed_video_id
ORDER BY rank
LIMIT $k_per_hop;                                   -- e.g. 20

-- 2-hop: expand each 1-hop candidate one more step, bounded, then reconcile with 1-hop.
WITH hop1 AS (
  SELECT candidate_id, relatedness_score
  FROM related_videos_top_k
  WHERE seed_id = $seed_video_id
  ORDER BY rank
  LIMIT $k_per_hop                                  -- e.g. 20
),
hop2 AS (
  SELECT r.candidate_id, r.relatedness_score
  FROM hop1 h
  JOIN related_videos_top_k r
    ON r.seed_id = h.candidate_id
   AND r.rank <= $fanout_cap                        -- e.g. 10 — bounds branching per hop1 node
  WHERE r.candidate_id <> $seed_video_id
    AND r.candidate_id NOT IN (SELECT candidate_id FROM hop1)
)
SELECT candidate_id, MAX(relatedness_score) AS relatedness_score  -- best-hop-wins, per §1.3
FROM (
  SELECT candidate_id, relatedness_score FROM hop1
  UNION ALL
  SELECT candidate_id, relatedness_score FROM hop2
) all_hops
GROUP BY candidate_id
ORDER BY relatedness_score DESC, candidate_id ASC   -- deterministic tiebreak, see §6
LIMIT $final_n;                                     -- e.g. 40
```

### 4.4 (c) Personalized home feed from recent watch history (multi-seed)

```sql
WITH recent_seeds AS (
  SELECT DISTINCT ON (video_id) video_id, watched_at
  FROM watches
  WHERE user_id = $user_id
  ORDER BY video_id, watched_at DESC
  LIMIT 10                                          -- most recent 10 DISTINCT videos as seeds
),
candidates AS (
  SELECT rv.candidate_id, rv.relatedness_score, rv.seed_id
  FROM recent_seeds rs
  JOIN related_videos_top_k rv ON rv.seed_id = rs.video_id
  WHERE rv.candidate_id NOT IN (SELECT video_id FROM watches WHERE user_id = $user_id)
),
scored AS (
  SELECT candidate_id,
         SUM(relatedness_score)         AS agg_score,   -- naive sum across seeds
         COUNT(DISTINCT seed_id)        AS seed_diversity,
         array_agg(DISTINCT seed_id)    AS seed_ids       -- for "Because you watched X" (D10 §2.3)
  FROM candidates
  GROUP BY candidate_id
),
ranked AS (
  -- Diversification (D10 §2.4): cap recs per channel via window function, not sampling.
  SELECT s.*, v.channel_id, v.view_count, v.title,
         row_number() OVER (PARTITION BY v.channel_id ORDER BY s.agg_score DESC, s.candidate_id) AS channel_rank
  FROM scored s
  JOIN videos v ON v.id = s.candidate_id
)
SELECT candidate_id, agg_score, seed_ids, title, view_count, channel_id
FROM ranked
WHERE channel_rank <= 2                              -- cap: 2 recs per channel
ORDER BY agg_score DESC, candidate_id ASC
LIMIT 40;
```

Cold-start backfill (§5) unions onto this — see §5 for the full query with fallback.

### 4.5 Indexes and which query is expensive

Indexes already declared above; the load-bearing ones:

- `related_videos_top_k (seed_id, rank)` — every candidate-generation read (1-hop, 2-hop, multi-seed) hits this. It's why the table is denormalized to both directions: a plain `WHERE seed_id = X` against a btree is as cheap as a lookup gets, versus needing an `OR`/`CASE` across `video_id_a`/`video_id_b` on the raw pair table.
- `watches (user_id, watched_at DESC)` — the home-feed seed-selection query's access path.
- `session_videos (session_id, video_id)` PK — covers the per-session dedup check in the write path; no separate index needed since `session_id` is the PK's leading column.
- `covisitation_pairs (video_id_a, video_id_b)` PK — sufficient for the write path (§4.2), which always upserts with both IDs known. It is *not* meant to be queried live by "give me all pairs involving video X" — that's what `related_videos_top_k` is for.

**The expensive query is the batch job that refreshes `related_videos_top_k` from `covisitation_pairs`** — a full scan of the pair table, computing `r(vi,vj) = cij / cj` for every pair in both directions, applying the minimum-threshold and top-K cutoffs (§3), and rewriting the read table:

```sql
-- Refresh job (run on a schedule — mirrors D10's "updating the data sets several times
-- per day," §2.6 — or on-demand for a small demo dataset).
TRUNCATE related_videos_top_k;

INSERT INTO related_videos_top_k (seed_id, candidate_id, relatedness_score, rank)
SELECT seed_id, candidate_id, relatedness_score, rank
FROM (
  SELECT
    seed_id, candidate_id,
    cooccurrence_count::double precision / vsc.session_count AS relatedness_score,
    row_number() OVER (
      PARTITION BY seed_id ORDER BY cooccurrence_count::double precision / vsc.session_count DESC
    ) AS rank
  FROM (
    SELECT video_id_a AS seed_id, video_id_b AS candidate_id, cooccurrence_count FROM covisitation_pairs
    UNION ALL
    SELECT video_id_b AS seed_id, video_id_a AS candidate_id, cooccurrence_count FROM covisitation_pairs
  ) both_directions
  JOIN video_session_counts vsc ON vsc.video_id = candidate_id
  WHERE cooccurrence_count >= $min_covisit_threshold      -- §3 pruning
) scored
WHERE rank <= $top_k_per_video;                            -- §3 pruning, e.g. 50
```

This is `O(pairs)` with a sort per seed group — the single most expensive operation in the whole system, by design: it's the one place D10's own architecture pushes cost into a batch step specifically so that *serving* (the queries in §4.3/§4.4) stays cheap and index-driven. Everything else — the per-event write transaction, the 1-/2-hop reads, the home-feed aggregation — touches at most a few dozen to a few hundred rows.

---

## 5. Cold start

**New video, no co-visits.** It exists in `videos` but has zero rows in `covisitation_pairs` and zero rows in `related_videos_top_k`, in both directions: nothing points to it as a candidate (it's nobody's `R_i` member yet), and it has no `R_i` of its own to expand from as a seed. This is exactly the situation D10 §2.2 describes as an accepted limitation: "there are many videos for which we will not be able to compute a reliable set of related videos this way because their overall view count (and thereby co-visitation counts with other videos) is too low." The paper does not describe a fix for this within the co-visitation mechanism — because there isn't one; a video with zero co-watches has no co-visitation signal by construction. The fix has to be a separate path: a non-personalized fallback pool. D10 §4 already runs one in production, incidentally — the "Most Viewed," "Top Favorited," and "Top Rated" browse-page sections it benchmarks against are literally that fallback pool, already in production alongside recommendations, not just measurement baselines invented for the experiment.

**New user, no history.** The seed set `S` is empty. By Eq. 2 (§1.3), `C1(∅) = ⋃_{vi ∈ ∅} Ri = ∅` — the union over an empty set is empty, so every subsequent `Cn` and `C_final` is empty too. The multi-seed home-feed query in §4.4 has zero rows in `recent_seeds`, so `candidates` and `scored` are both empty, and the query returns nothing on its own. Same resolution as above: fall back to the non-personalized pool.

**Fresh/near-empty seed database (this repo's actual situation — the demo DB starts nearly empty).** With few users, few videos, and few watch events, `covisitation_pairs` is mostly empty or below the minimum-count threshold from §3, so *almost every request* — not just genuinely new users/videos — hits the cold-start path. This reframes the requirement: "the home page stays non-empty on a fresh seed database" is not really a co-visitation requirement at all. It's a requirement that **the fallback path is always populated and always queried as a backfill**, regardless of how much personalized signal exists. Concretely, every surface-facing query should be written as personalized-candidates-first, backfilled-to-a-floor:

```sql
WITH personalized AS (
  -- the §4.4 query, or an empty result set for a brand-new user
  SELECT candidate_id, agg_score AS score, seed_ids, title, view_count, channel_id
  FROM ranked WHERE channel_rank <= 2
  ORDER BY agg_score DESC, candidate_id ASC
  LIMIT 40
),
fallback AS (
  -- most-viewed / most-recent pool — D10's own "Most Viewed" browse-page baseline,
  -- repurposed here as the cold-start backfill rather than only a comparison arm
  SELECT id AS candidate_id, view_count AS score, ARRAY[]::uuid[] AS seed_ids,
         title, view_count, channel_id
  FROM videos
  WHERE id NOT IN (SELECT candidate_id FROM personalized)
  ORDER BY view_count DESC, upload_at DESC, id ASC
  LIMIT 40
)
SELECT * FROM personalized
UNION ALL
SELECT * FROM fallback
LIMIT 40;                                             -- personalized rows first, backfilled to 40
```

This one query correctly handles all three cold-start cases (new video — never selected by `personalized`, so it can only ever surface via `fallback`'s recency/view-count ordering; new user — `personalized` is empty, `fallback` fills the whole page; near-empty database — `personalized` is thin, `fallback` tops it up) without any special-casing in application code. As real co-visitation data accumulates, `personalized` naturally grows and `fallback`'s share shrinks — no migration or mode switch required.

---

## 6. Determinism for tests

Postgres does not guarantee row order for ties — `ORDER BY score DESC` alone, with two rows sharing the same score, can return either order, and that order isn't even guaranteed stable across runs (parallel query workers, physical storage order after an update, etc.). Every query above needs a **total order**, not just a primary sort key. This is the main place randomness silently enters a system that has no `random()` calls anywhere in it.

Where "randomness" (in the broad sense — anything not fully determined by the fixed inputs) enters, and the fix for each:

1. **Score ties.** `relatedness_score` (a ratio of integers) and `agg_score` (a sum) both produce exact ties routinely on a small seed corpus — e.g. two candidates each co-watched with the seed exactly once, both with `c_j = 1`, produce identical `r = 1/1`. **Fix**: every `ORDER BY` in this document ends with `, candidate_id ASC` (or `video_id ASC`) as a final tiebreaker — video IDs impose a total order, so given the same corpus, the same query always returns the same sequence. This is already baked into every query in §4; it's the one change that matters most for test determinism and the easiest to accidentally drop when someone "simplifies" a query later.
2. **Diversification / subset selection.** D10 §2.4's "optimize for a balance between relevancy and diversity" could be implemented with weighted random sampling among near-tied top candidates (a legitimate real-world technique — it's how you avoid the exact same list every refresh without a full re-rank). We do **not** do that here: §4.4's channel cap is a strict `row_number() OVER (PARTITION BY channel_id ORDER BY score DESC, id ASC)` window function — fully deterministic, no sampling. If diversity-via-sampling is ever added later, it must be seeded (see point 3) rather than left to `random()`.
3. **Exploration (explore/exploit).** Not part of D10 at all, and not built here — flagging it because it's the standard next thing a real recommender adds, and it's the standard place non-determinism creeps in (e.g. epsilon-greedy: "5% of the time, show a random low-confidence candidate instead of the top one"). If/when this is added: never call Postgres's `random()` or an unseeded app-layer RNG directly in a ranking query. Seed a PRNG deterministically from a hash of `(user_id, candidate_id, day_bucket)` or similar fixed inputs, or gate exploration off entirely behind an env flag (e.g. `RECS_EXPLORATION_ENABLED=false`) that the test suite always sets to false.
4. **Wall-clock timestamps.** Several queries and the write path use `now()` (`updated_at`, `first_watched_at`, and any future recency-weighted scoring). A test fixture that inserts watch events using `now()` implicitly makes the resulting recommendation order depend on *when the test happened to run*. **Fix**: test fixtures must insert explicit `watched_at`/timestamp values (a fixed, hand-authored seed corpus with literal timestamps), never rely on the default `now()` used by the production write path in §4.2.

The practical recipe for the test suite: a small, fixed, hand-authored corpus (a known set of users, videos, and watch events with explicit timestamps, checked into the repo or generated deterministically by a seed script — `scripts/seed.ts` already exists in this repo for exactly this purpose); every ranking query fully specified down to a stable ID-based tiebreaker as shown throughout §4; zero `random()`/`ORDER BY random()` anywhere in a ranking or diversification query; and any future exploration feature built behind a flag that's off by default in tests. Given all of that, the same seed corpus run through the same queries produces byte-identical output every time, and the test suite can assert exact ordering rather than "top result is one of these three."

---

## 7. The surfaces

D10 covers exactly two surfaces (home page, Browse page), both feeding from the *same* recommendation set. Neither the watch-next sidebar, autoplay, nor Shorts existed as YouTube features in 2010 in the form they exist today. The characterization below of how these four surfaces differ is informed by C16 (which explicitly targets "the YouTube mobile app home," C16 Fig. 1, via the candidate-generation/ranking funnel) and Z19 (which explicitly frames its entire paper around the watch-next problem: "given a video which a user is currently watching, recommend the next video that the user might watch and enjoy," Z19 §1) — not by D10, which predates the distinction. I'm citing which claim comes from which paper, and marking our own implementation mapping as ours.

| Surface | Optimizes for | Inputs | What it queries in our schema |
|---|---|---|---|
| **Home feed** | Breadth across the user's whole interest profile; D10 §1.1's "unarticulated want" — content the user didn't ask for but is broadly interested in. Ranking-stage goal per D10 §2.4: relevance balanced against diversity across categories, not depth on any one topic. | Multiple seeds — a user's *entire* recent watch/favorite/like history (D10's "seed set" `S`, §2.3). | §4.4's multi-seed aggregation query, backfilled per §5. |
| **Watch-next sidebar** | Immediate topical continuity with the *one* video currently playing. This is Z19's whole paper: "given a video which a user is currently watching, recommend the next video" (Z19 §1) — and Z19 §3.1 confirms co-visitation is explicitly one of its candidate-generation sources: "another algorithm retrieves candidate videos based on how often the video has been watched together with the query video." | A **single** seed — the currently-playing video — lightly blended with user-specificity signals (D10 §2.4) if the viewer is signed in. | §4.3's single-seed 1-hop (primarily) / 2-hop query, ranked by relatedness first, light diversity filtering (still cap per channel — a sidebar that's 8 videos from the same uploader is a bad sidebar) second. |
| **Autoplay-next** | The single best guess at *sustained* watching, not just a click — Z19 doesn't cover autoplay directly, but C16 §4's ranking-objective framing is the relevant transferable idea: "ranking by click-through rate often promotes deceptive videos that the user does not complete ('clickbait') whereas watch time better captures engagement" (C16 §4). Autoplay has no click at all to rank by, which makes this concern sharper, not weaker. | Same single seed as watch-next. | Same query as watch-next, `LIMIT 1`, but tie-break on a quality-signal proxy (e.g. `(like_count + favorite_count)::float / NULLIF(view_count,0)`, a completion/appreciation proxy — we have no real watch-time telemetry, so this is the best available stand-in for C16's "expected watch time" objective) ahead of raw relatedness score, specifically to avoid promoting a high-co-visitation-but-low-quality video into an unattended autoplay slot. |
| **Shorts feed** | Rapid-fire engagement across a swipe session, not a single click-through decision; heavier weight on freshness than any other surface, because upload velocity for short-form content is the most extreme version of C16's "freshness" challenge (C16 §1: "many hours of video are uploaded per second... balancing new content with well-established videos can be understood from an exploration/exploitation perspective"). | Multiple seeds, but a much *shorter* and faster-expiring lookback window than the home feed — the last handful of shorts swiped through in the current sitting, not all-time history. | Same shape as §4.4's multi-seed query, but `recent_seeds` filtered to `videos.duration_seconds < 60` and a much smaller `LIMIT` (e.g. last 5, not last 10) on the seed CTE, candidates also filtered to short-duration videos, and the cold-start fallback (§5) weighted more heavily toward `upload_at DESC` than `view_count DESC` — a healthy Shorts corpus is disproportionately new content that hasn't accumulated co-visits yet, so this surface hits the cold-start path more often than any other, by design, not by data gap. |

---

## 8. What we are explicitly not building

**C16's deep candidate-generation + ranking networks**, and **Z19's multi-objective MMoE ranker on top of that**. Specifically not building:

- C16's candidate generation as extreme multiclass classification: `P(wt = i | U, C) = e^(vi·u) / Σ_{j∈V} e^(vj·u)`, where `u` is a learned dense embedding of the (user, context) pair and each `v_j` is a learned dense embedding of a candidate video (C16 §3.1) — trained via sampled softmax on hundreds of billions of implicit-watch examples, serving via approximate nearest-neighbor search over the embedding space (C16 §3.1). This replaces exact co-occurrence counting with a *learned, generalized notion* of similarity — it can relate two videos that were never actually co-watched, as long as their embeddings end up nearby, which co-visitation structurally cannot do.
- C16's "example age" feature (C16 §3.3) — feeding training-example recency directly into the model, set to zero at serving time, to correct the model's implicit bias toward the training window's average popularity rather than current popularity. Our windowing/decay pruning in §3 is a much cruder, count-based analog of the same underlying concern (staleness bias), not the same mechanism.
- C16's ranking network: a second deep model, separately trained, predicting *expected watch time* via weighted logistic regression (positive/clicked impressions weighted by observed watch time, negative impressions at unit weight — C16 §4.2), fed hundreds of categorical + continuous features (shared ID-space embeddings, quantile-normalized continuous features with power expansions, C16 §4.1) — versus our linear-combination-of-three-signal-groups ranking (D10 §2.4).
- Z19's Multi-gate Mixture-of-Experts architecture (Z19 §4.3, Eq. 1–2) for jointly learning multiple, sometimes-conflicting objectives (engagement vs. satisfaction — clicks/watches vs. likes/ratings/dismissals), and its shallow-tower position-bias correction (Z19 §4.4) that factors the training label into a user-utility term and a learned selection-bias term, trained jointly without needing randomized experiments to estimate propensity.

**Why this is fine to skip, and why a ranking layer can be added later without restructuring anything**: our candidate generation already produces exactly the artifact both C16 and Z19 assume as their *input* — a scored candidate list, capped at a few dozen items, with per-candidate features attached. That's precisely the two-stage funnel shape both papers use: "funnel where candidate videos are retrieved and ranked before presenting only a few to the user" (C16 Fig. 2) — millions → hundreds (candidate generation) → dozens (ranking). Our §4 candidate-generation queries already sit at the "hundreds → dozens" boundary and already join in the raw features (`view_count`, `like_count`, `channel_id`, seed associations) that a ranking step would need. Bolting on a ranking layer later — even a full learned model, not just a better linear combination — means: compute or fetch a feature vector per candidate row (mostly already-joined columns, per §4.4), score it with whatever model, and change one line — `ORDER BY relatedness_score DESC` becomes `ORDER BY model_score DESC` — in the final `SELECT`. It does not touch the write path (§4.2), the `covisitation_pairs`/`related_videos_top_k` schema (§4.1), the incremental-update algorithm (§2), or the pruning parameters (§3). The separation D10 itself drew between candidate generation and ranking (D10 §2, opening: "the set of recommended videos... is generated by using a user's personal activity... as seeds and expanding... The set of videos is then ranked using a variety of signals") is the same separation that makes this repo's architecture forward-compatible with C16/Z19-style ranking, should it ever be worth building.
