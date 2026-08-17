import "server-only";

import type { SqlDatabase, SqlRow, SqlValue } from "@/adapters/db";
import type {
  DurationBucket,
  SearchDocument,
  SearchDocumentKind,
  SearchHit,
  SearchIndex,
  SearchQuery,
  SearchResults,
  SearchSort,
} from "@/ports/search-index";

/**
 * Postgres full-text search, behind {@link SearchIndex}.
 *
 * Everything here is core Postgres — `tsvector`, `websearch_to_tsquery`,
 * `ts_rank_cd`, `ts_headline`, a GIN index. That is not an aesthetic
 * preference: PGlite's base bundle registers no extensions. Measured against
 * PGlite 0.5.5 (PostgreSQL 18.3), `create extension pg_trgm` answers
 * `extension "pg_trgm" is not available` — the tarball ships in the package
 * and is simply not registered by `new PGlite()`. An adapter that reached for
 * trigram similarity would work against Neon and fail to boot locally, so the
 * features that need it are absent rather than half-present: there is no fuzzy
 * matching, and `SearchResults.correction` is always `null` because a spelling
 * correction needs either a trigram index over the lexemes or a query log, and
 * this application has neither.
 *
 * Three things in here are worth reading before changing anything:
 *
 *   1. The **field weights** decide that a title match beats a description
 *      match. They are Postgres' fixed `{D, C, B, A}` array order, which is
 *      backwards from how anyone says it out loud.
 *   2. The **blend** decides that a fresh popular video beats a stale obscure
 *      one with the same words. It is three named constants that sum to one,
 *      and `__tests__/ranking.test.ts` pins the trade rather than the formula.
 *   3. The **tsquery is written out at each use** rather than lifted into a
 *      CTE, and the usual reason given for that turns out to be wrong here.
 *      The fear is that a CTE referenced more than once is materialised, that
 *      a materialised CTE is an optimisation fence, and that the planner would
 *      therefore stop seeing `@@` as a scan condition and give up the GIN
 *      index. Measured against 20,000 rows on PGlite 0.5.5 (PostgreSQL 18.3),
 *      **both forms keep the index**: the CTE version plans a nested loop over
 *      the one-row CTE with the same `Bitmap Index Scan on
 *      search_documents_vector_idx` underneath it. So repeating `$1` buys a
 *      simpler plan and a `where` clause you can read the index condition off,
 *      and nothing more than that. It is a preference, not a requirement, and
 *      saying so is cheaper than someone re-deriving it.
 */

/* ------------------------------------------------------------- weights -- */

/**
 * Per-field weights, highest first as prose, and then reversed for Postgres.
 *
 * Title above channel because a video called *Rust* is a better answer to
 * "rust" than a video by a channel called *Rust*; channel well above
 * description because searching for a creator by name is the second thing
 * anyone does with this box.
 *
 * Tags sit at the bottom, below description, which is the one placement here
 * that is a judgement rather than an obvious ordering. Tags are uploader-
 * supplied free text and by far the cheapest field to stuff — YouTube stopped
 * surfacing them for exactly that reason. At 0.1 a tag can still pull a
 * document into the result set, which is what tags are for, and can barely
 * move it up once there.
 */
const WEIGHT_TITLE = 1.0;
const WEIGHT_CHANNEL = 0.5;
const WEIGHT_DESCRIPTION = 0.25;
const WEIGHT_TAGS = 0.1;

/**
 * The same four numbers in the order `ts_rank_cd` wants them: `{D, C, B, A}`.
 * Written from the named constants rather than as a literal so the two cannot
 * drift, because a transposed weight array is invisible — it produces a
 * plausible ordering that is simply wrong, and no test that only checks "the
 * right documents came back" would catch it.
 */
const FIELD_WEIGHTS =
  `'{${WEIGHT_TAGS}, ${WEIGHT_DESCRIPTION}, ` +
  `${WEIGHT_CHANNEL}, ${WEIGHT_TITLE}}'::float4[]`;

/** Which `setweight` label each field gets. Mirrors {@link FIELD_WEIGHTS}. */
const LABEL_TITLE = "A";
const LABEL_CHANNEL = "B";
const LABEL_DESCRIPTION = "C";
const LABEL_TAGS = "D";

/* --------------------------------------------------------------- blend -- */

/**
 * How relevance, popularity and freshness combine into one ordering.
 *
 * `ts_rank_cd` alone is not what a video site returns. A ten-year-old upload
 * with a perfect title match and four hundred views should not sit above this
 * month's version of the same tutorial, and text rank cannot express that
 * because it has never heard of either signal.
 *
 * The three weights sum to 1 and each term is normalised into [0, 1], so the
 * blended score is also in [0, 1]. That is worth the small effort it costs:
 * the score becomes readable — 0.7 means "most of the way to a perfect match
 * on every axis" — and `SearchHit.score` stays comparable within a result set,
 * which is all the port promises of it.
 *
 * The split itself is a judgement, not a measurement. There is no click log to
 * fit it against, so it is written as three constants with an explicit sum
 * rather than buried in an expression, and the *consequences* are pinned in
 * `__tests__/ranking.test.ts` — including the case where popularity beats
 * relevance, which is the one somebody will otherwise "fix".
 */
const WEIGHT_TEXT = 0.6;
const WEIGHT_VIEWS = 0.25;
const WEIGHT_RECENCY = 0.15;

/**
 * `ts_rank_cd`'s normalisation flag 32 — `rank / (rank + 1)`.
 *
 * Chosen for the bound, not for the shape: without it the rank is unbounded
 * and a weighted sum against two [0, 1] signals would be meaningless, since
 * one repeated term in a long description could out-vote every other axis put
 * together. Flag 1 (divide by document length) was rejected because it
 * penalises exactly the long, thorough description that a good video has.
 */
const RANK_NORMALISATION = 32;

/**
 * The view count at which the popularity term reaches 1.
 *
 * Logarithmic because view counts are power-law distributed: the gap between
 * 100 and 10,000 views says far more about a video than the gap between ten
 * million and twenty million, and a linear term would say the opposite. Ten
 * million is a guess at "as popular as this ranking needs to care about",
 * clamped rather than allowed past 1 so that one viral outlier cannot
 * dominate a whole result page.
 */
const VIEW_SATURATION = 10_000_000;

/**
 * Freshness half-life. A video a year old keeps half its freshness credit, two
 * years a quarter, ten years effectively none.
 *
 * Exponential rather than linear because the interesting distinction is
 * between this month and last year, not between year eight and year nine. The
 * number itself is assumed, not measured — there is no engagement data here to
 * fit it to — which is precisely why it is a named constant.
 */
const RECENCY_HALF_LIFE_DAYS = 365;

/* -------------------------------------------------------------- rating -- */

/**
 * Confidence level for the `rating` sort, as a normal-distribution z-score.
 * 1.96 is two-sided 95%.
 *
 * Raising it makes the sort more sceptical of small samples — at 2.58 (99%) a
 * ten-of-ten video falls further behind a thousand-of-a-thousand one. It is
 * the single dial on how much evidence a video must show before its ratio is
 * believed.
 */
const RATING_CONFIDENCE_Z = 1.96;

/**
 * What `rating` sorts by: the lower bound of the Wilson score interval on the
 * like rate, not the like rate itself.
 *
 * The naive `likes / (likes + dislikes)` is the classic wrong answer, and it
 * is wrong in a way that makes the feature useless rather than merely
 * imprecise. One unopposed like scores 1.0 — a perfect rating — and sits above
 * a video with 10,000 likes and 3 dislikes, which scores 0.9997. Sort a real
 * corpus that way and the entire first page is videos with a single vote.
 *
 * A Wilson lower bound asks a different question: *given this many votes, what
 * is the lowest like rate consistent with the evidence at 95% confidence?* A
 * large sample barely moves off its ratio; a tiny one collapses. Measured
 * against PGlite, with the constants below:
 *
 *     10,000 + / 3 −    naive 0.9997   wilson 0.9991
 *        100 + / 0 −    naive 1.0000   wilson 0.9630
 *         10 + / 0 −    naive 1.0000   wilson 0.7225
 *         60 + / 40 −   naive 0.6000   wilson 0.5020
 *          1 + / 0 −    naive 1.0000   wilson 0.2065
 *          2 + / 200 −  naive 0.0099   wilson 0.0027
 *          0 + / 0 −    naive 0.0000   wilson 0.0000
 *
 * The naive ordering puts the one-vote video third from the top and the
 * genuinely well-liked one fourth; the Wilson ordering inverts exactly that.
 *
 * Two consequences worth stating rather than discovering.
 *
 * **No votes scores 0**, which is the formula's own limit rather than a case
 * bolted on: with no evidence, the lowest rate consistent with it is zero. An
 * unrated video therefore sinks in this sort, which is the honest answer to
 * "order these by rating" when it has none.
 *
 * **A badly-rated video with a few votes edges above an unrated one** — 2 likes
 * against 200 dislikes still scores 0.0027, above 0. A lower bound rewards
 * evidence over absence, and inverting that would mean claiming to know
 * something about a video nobody has voted on. Pinned by a test so it reads as
 * a decision.
 *
 * The alternative considered was additive (Bayesian) smoothing — pulling every
 * ratio toward a 0.5 prior with a pseudo-count. It behaves similarly and is
 * cheaper to explain, but the prior is a number nobody can defend, whereas a
 * confidence level is a number with a meaning. Rejected on that.
 *
 * Rating is deliberately a *sort* and not a fourth term in the relevance
 * blend. The blend answers "what did you mean"; a like ratio answers "was it
 * any good", and folding the second into the first would let a well-rated
 * video about something else outrank a mediocre video about the thing you
 * searched for.
 *
 * `likes` and `votes` are the float8 columns projected by the `matched` CTE,
 * which is what keeps this expression readable — `votes` appears six times.
 */
const RATING_SQL = `case when votes = 0 then 0::float8 else
      (likes / votes
       + (${RATING_CONFIDENCE_Z} * ${RATING_CONFIDENCE_Z})::float8 / (2 * votes)
       - ${RATING_CONFIDENCE_Z}::float8 * sqrt(
           ((likes / votes) * (1 - likes / votes)
             + (${RATING_CONFIDENCE_Z} * ${RATING_CONFIDENCE_Z})::float8
                 / (4 * votes)) / votes))
      / (1 + (${RATING_CONFIDENCE_Z} * ${RATING_CONFIDENCE_Z})::float8 / votes)
    end`;

/* ------------------------------------------------------------- filters -- */

/** YouTube's own buckets: under 4 minutes, 4–20, over 20. */
const SHORT_MAX_SECONDS = 4 * 60;
const MEDIUM_MAX_SECONDS = 20 * 60;

/**
 * The three buckets partition durations that exist, and a document with no
 * duration is in none of them.
 *
 * The `> 0` on `under4` is the whole point. Channel and playlist documents
 * carry `duration_seconds = 0`, so without it every channel in the corpus
 * would satisfy "under 4 minutes" — a duration filter is a filter on videos,
 * and the honest way to say that is to require a duration rather than to
 * silently rewrite the caller's `kind`.
 *
 * The boundaries are inclusive at 4:00 and 20:00, so exactly twenty minutes is
 * "4–20" and not "over 20". Someone will eventually notice that a 20:00 video
 * is absent from *Over 20 minutes*; this is where they will find out it was
 * deliberate.
 */
const DURATION_PREDICATE: Record<DurationBucket, string> = {
  under4: `d.duration_seconds > 0 and d.duration_seconds < ${SHORT_MAX_SECONDS}`,
  "4to20":
    `d.duration_seconds >= ${SHORT_MAX_SECONDS} ` +
    `and d.duration_seconds <= ${MEDIUM_MAX_SECONDS}`,
  over20: `d.duration_seconds > ${MEDIUM_MAX_SECONDS}`,
};

/* --------------------------------------------------------- highlighting -- */

/**
 * The marks `ts_headline` wraps matched terms in.
 *
 * U+0002 START OF TEXT and U+0003 END OF TEXT, chosen because the requirement
 * is that the delimiter *cannot* appear in the document. `<b>`, `**`, `[[` and
 * every other printable candidate can: a description is uploader-controlled
 * text, so any printable delimiter lets an uploader forge a highlight — and an
 * HTML-shaped one turns every search result into markup the renderer has to
 * trust. Control characters are not typeable, do not survive a form post, and
 * render as nothing if a renderer forgets to convert them, which is the right
 * failure: an unconverted fragment reads as unstyled text rather than as
 * literal `<b>` or as injected markup.
 *
 * The claim is enforced rather than assumed — {@link stripControlCharacters}
 * removes them from every field on the way in, so a document *cannot* contain
 * one by the time `ts_headline` sees it.
 *
 * Exported because the renderer needs the other half of this contract.
 */
export const HIGHLIGHT_START = "\u0002";
export const HIGHLIGHT_END = "\u0003";

/**
 * One fragment, centred on the match. `MaxWords` is sized for the two-line
 * snippet a result row has room for; `ShortWord=2` stops the fragment opening
 * on a dangling "a" or "of". Passed as a bound parameter rather than inlined,
 * so that no part of this statement is built by string concatenation from
 * anything that could ever become a variable.
 */
const HEADLINE_OPTIONS =
  `StartSel=${HIGHLIGHT_START},StopSel=${HIGHLIGHT_END},` +
  "MaxFragments=1,MinWords=8,MaxWords=28,ShortWord=2";

/* ---------------------------------------------------------------- limits -- */

/**
 * Ceilings on what a caller may ask for in one page. Not distrust of the
 * callers in this repository — a search URL is user-editable, `?limit=100000`
 * is one keystroke, and `ts_headline` runs once per returned row.
 */
const MAX_PAGE_SIZE = 100;
const MAX_SUGGESTIONS = 20;

/** Bounds on what is turned into a `tsquery` for type-ahead. */
const MAX_SUGGEST_TERMS = 6;
const MAX_SUGGEST_TERM_LENGTH = 40;

/** The dictionary. One configuration everywhere: the vector written by
 * {@link PostgresSearchIndex.index} and the query parsed by
 * {@link PostgresSearchIndex.query} must agree, or a stem produced by one will
 * not be found by the other. */
const TEXT_SEARCH_CONFIG = "english";

/* --------------------------------------------------------------- scoring -- */

/**
 * The blended score, as one SQL expression.
 *
 * `$1` is the raw query text; it appears here and again in the `where` clause
 * for the reason given in the module header. Everything else interpolated is a
 * module constant — nothing derived from a caller is ever concatenated into a
 * statement in this file.
 *
 * The two `least(…, 1)` calls guard opposite ends. Views clamps a viral
 * outlier back to the saturation ceiling. Recency clamps a *future*
 * `published_at` — a scheduled premiere, or clock skew between the app and the
 * database — which would otherwise raise 0.5 to a negative power and score
 * above 1.
 *
 * `coalesce(published_at, 'epoch')` treats an unpublished document as
 * maximally old rather than maximally fresh. `now()` would have been the other
 * default and is the dangerous one: a draft with no publication date would
 * take the full freshness bonus and outrank everything real.
 */
const SCORE_SQL = `(
      ${WEIGHT_TEXT}::float8 * ts_rank_cd(
        ${FIELD_WEIGHTS},
        d.search_vector,
        websearch_to_tsquery('${TEXT_SEARCH_CONFIG}', $1),
        ${RANK_NORMALISATION})::float8
    + ${WEIGHT_VIEWS}::float8 * least(
        ln(1 + d.view_count::float8) / ln(1 + ${VIEW_SATURATION}::float8),
        1::float8)
    + ${WEIGHT_RECENCY}::float8 * least(
        power(
          0.5,
          extract(epoch from (now() - coalesce(d.published_at, 'epoch'::timestamptz)))
            / (${RECENCY_HALF_LIFE_DAYS} * 86400)::numeric
        )::float8,
        1::float8)
  )`;

/**
 * Every ordering ends `, id asc`.
 *
 * Not cosmetic: `limit`/`offset` pagination over a non-deterministic ordering
 * lets rows that tie repeat on one page and vanish from the next, and ties are
 * the normal case here — `sort=views` over a corpus where most documents have
 * zero views is entirely ties. The tiebreak makes the sequence of pages a
 * partition of the result set rather than an approximation of one.
 *
 * `rating` takes a second tiebreak before `id`, and it is the one ordering
 * that needs it. Most of a real corpus has no votes at all, so every unrated
 * document scores exactly 0 — without `view_count desc` the bottom of "sort by
 * rating" would be a list in id order, which reads as broken rather than as
 * tied. The other three sorts tie rarely enough that an arbitrary but stable
 * order is fine.
 */
const ORDER_BY: Record<SearchSort, string> = {
  relevance: "score desc, id asc",
  date: "published_at desc nulls last, id asc",
  views: "view_count desc, id asc",
  rating: `${RATING_SQL} desc, view_count desc, id asc`,
};

/* ----------------------------------------------------------------- rows -- */

interface QueryRow extends SqlRow {
  readonly total: number | string;
  readonly id: string | null;
  readonly kind: string | null;
  readonly score: number | string | null;
  readonly highlight: string | null;
}

interface SuggestRow extends SqlRow {
  readonly title: string;
}

const EMPTY_RESULTS: SearchResults = { hits: [], total: 0, correction: null };

/* ----------------------------------------------------------- the adapter -- */

export class PostgresSearchIndex implements SearchIndex {
  constructor(private readonly db: SqlDatabase) {}

  /**
   * Write the document and its vector together.
   *
   * The vector is computed here rather than by a `before insert` trigger, and
   * `schema.sql` says the same thing from the other side. A trigger would work
   * — it would even be harder to bypass — but it would make the weighting
   * decision invisible from the adapter that owns it, and it would mean two
   * places that must agree about the dictionary. The port's `index()` call is
   * already the documented moment a document changes; a trigger would create a
   * second, undocumented one.
   */
  async index(document: SearchDocument): Promise<void> {
    await this.db.execute(INDEX_SQL, indexParams(document));
  }

  /**
   * Bulk form. One statement per document inside one transaction, so a failed
   * reindex leaves the index as it was rather than half-rebuilt.
   *
   * A multi-row `insert … values` would be one round trip instead of N, and
   * was rejected for this path: at eleven parameters per document it needs
   * chunking against Postgres' 65,535-parameter ceiling, and the callers are
   * seeding and reindexing — batch jobs where a round trip costs nothing and a
   * subtle chunking bug costs a corrupted index.
   */
  async indexMany(documents: readonly SearchDocument[]): Promise<void> {
    if (documents.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const document of documents) {
        await tx.execute(INDEX_SQL, indexParams(document));
      }
    });
  }

  async remove(id: string): Promise<void> {
    await this.db.execute("delete from search_documents where id = $1", [id]);
  }

  /**
   * One statement: filter, rank, count, page and highlight.
   *
   * The shape is `matched` → (`matched_total`, `page`), joined back together.
   * It exists to solve one specific problem: `count(*) over ()` is computed
   * before `limit`/`offset`, which is exactly what makes it free — but it
   * travels *on the rows*, so an `offset` past the end returns no rows and
   * therefore no total. The `left join` against a one-row aggregate guarantees
   * a row whatever the offset, with every page column null when the page is
   * empty. Reading the total off `rows[0]` and special-casing the empty page
   * with a second query was the alternative; it is two round trips and two
   * chances for the count and the page to disagree under a concurrent write.
   *
   * `ts_headline` is deliberately in the *outer* select. It re-parses the
   * document text, so running it inside `matched` would headline every match
   * in the corpus to display at most `limit` of them.
   *
   * On `total`: the port documents it as an estimate, and says the UI renders
   * "About N results" because it is allowed to be wrong. Here it is exact —
   * `count(*) over ()` counts the rows the filter actually produced, not a
   * planner estimate. The port's wording is about the engine this port exists
   * to be swapped for: a real search cluster answers from sharded, sampled
   * statistics and genuinely cannot promise this. Callers must keep treating
   * it as approximate, because it will become approximate the day the adapter
   * changes and nothing else will announce that.
   */
  async query(query: SearchQuery): Promise<SearchResults> {
    const text = query.text.trim();

    // The only case answered without touching the database. A query that is
    // *empty* needs no dictionary to recognise; a query that is all stopwords
    // does, and reimplementing the stopword list in TypeScript to save a round
    // trip would put a second copy of it out of step with the dictionary the
    // vectors were built with. That one goes to Postgres and comes back as a
    // legitimately empty result: `websearch_to_tsquery('english', 'the a of')`
    // is the empty tsquery, and the empty tsquery matches nothing (measured).
    if (text === "") return EMPTY_RESULTS;

    const params: SqlValue[] = [text];
    const where = [
      `d.search_vector @@ websearch_to_tsquery('${TEXT_SEARCH_CONFIG}', $1)`,
    ];

    const filters = query.filters;
    if (filters?.kind !== undefined) {
      params.push(filters.kind);
      where.push(`d.kind = $${params.length}`);
    }
    if (filters?.uploadedAfter !== undefined) {
      params.push(filters.uploadedAfter.toISOString());
      where.push(`d.published_at >= $${params.length}::timestamptz`);
    }
    if (filters?.duration !== undefined) {
      where.push(DURATION_PREDICATE[filters.duration]);
    }

    params.push(bounded(query.limit, MAX_PAGE_SIZE));
    const limitParam = params.length;
    params.push(bounded(query.offset, Number.MAX_SAFE_INTEGER));
    const offsetParam = params.length;
    params.push(HEADLINE_OPTIONS);
    const headlineParam = params.length;

    const rows = await this.db.query<QueryRow>(
      `with matched as (
         select d.id,
                d.kind,
                d.description,
                d.published_at,
                d.view_count,
                d.like_count::float8 as likes,
                (d.like_count + d.dislike_count)::float8 as votes,
                ${SCORE_SQL} as score,
                count(*) over () as total
         from search_documents d
         where ${where.join("\n           and ")}
       ),
       matched_total as (
         select coalesce(max(total), 0)::int as total from matched
       ),
       page as (
         select * from matched
         order by ${ORDER_BY[query.sort ?? "relevance"]}
         limit $${limitParam} offset $${offsetParam}
       )
       select matched_total.total as total,
              page.id as id,
              page.kind as kind,
              page.score as score,
              ts_headline(
                '${TEXT_SEARCH_CONFIG}',
                page.description,
                websearch_to_tsquery('${TEXT_SEARCH_CONFIG}', $1),
                $${headlineParam}) as highlight
       from matched_total left join page on true`,
      params,
    );

    const first = rows[0];
    if (first === undefined) return EMPTY_RESULTS;

    const hits: SearchHit[] = [];
    for (const row of rows) {
      if (row.id === null || row.kind === null) continue;
      hits.push({
        id: row.id,
        kind: row.kind as SearchDocumentKind,
        score: toNumber(row.score),
        highlight: usableHighlight(row.highlight),
      });
    }

    return { hits, total: toNumber(first.total), correction: null };
  }

  /**
   * Type-ahead. A different query to {@link query}, not a cheaper call into
   * the same one.
   *
   * `websearch_to_tsquery` is wrong here: it matches whole terms, so it finds
   * nothing until the word is finished, which is the one thing type-ahead must
   * not do. `to_tsquery` with a `:*` wildcard is the core-Postgres way to
   * match a prefix, and the GIN index serves it.
   *
   * The cost is that `to_tsquery` has a *syntax*. `&`, `|`, `!`, `(`, `)`,
   * `:` and `<->` are operators in it, so pasting a user's keystrokes into a
   * tsquery string is two bugs at once: `to_tsquery('english', '&&&:*')` is a
   * hard error (measured — every keystroke of a pasted URL would 500), and
   * `to_tsquery('english', 'a & b | !c')` silently succeeds as *boolean logic
   * the user did not write*. Parameterising the statement does not help,
   * because the injection is into the tsquery grammar rather than into SQL.
   *
   * So the input is reduced to letters and digits before it becomes a query
   * — a whitelist, not an escape pass, for the same reason a colour is six hex
   * digits rather than "not `url(`": there is nothing left to keep up to date.
   *
   * Ordered by view count rather than by relevance: every candidate matches
   * the prefix about equally well, so the useful question is which of them the
   * person is most likely to have meant. It also costs no ranking function and
   * no `ts_headline`, which is the budget this call has.
   */
  async suggest(prefix: string, limit: number): Promise<readonly string[]> {
    const tsquery = prefixTsQuery(prefix);
    const bound = bounded(limit, MAX_SUGGESTIONS);
    if (tsquery === null || bound === 0) return [];

    const rows = await this.db.query<SuggestRow>(
      `select d.title as title
         from search_documents d
        where d.search_vector @@ to_tsquery('${TEXT_SEARCH_CONFIG}', $1)
        group by d.title
        order by max(d.view_count) desc, d.title asc
        limit $2`,
      [tsquery, bound],
    );

    return rows.map((row) => row.title);
  }
}

/* ------------------------------------------------------------ statements -- */

const INDEX_SQL = `
  insert into search_documents
    (id, kind, title, description, channel_name, tags,
     published_at, view_count, duration_seconds, like_count, dislike_count,
     search_vector)
  values
    ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10, $11,
       setweight(to_tsvector('${TEXT_SEARCH_CONFIG}', $3), '${LABEL_TITLE}')
    || setweight(to_tsvector('${TEXT_SEARCH_CONFIG}', $5), '${LABEL_CHANNEL}')
    || setweight(to_tsvector('${TEXT_SEARCH_CONFIG}', $4), '${LABEL_DESCRIPTION}')
    || setweight(to_tsvector('${TEXT_SEARCH_CONFIG}', $6), '${LABEL_TAGS}'))
  on conflict (id) do update set
    kind             = excluded.kind,
    title            = excluded.title,
    description      = excluded.description,
    channel_name     = excluded.channel_name,
    tags             = excluded.tags,
    published_at     = excluded.published_at,
    view_count       = excluded.view_count,
    duration_seconds = excluded.duration_seconds,
    like_count       = excluded.like_count,
    dislike_count    = excluded.dislike_count,
    search_vector    = excluded.search_vector`;

function indexParams(document: SearchDocument): SqlValue[] {
  return [
    document.id,
    document.kind,
    stripControlCharacters(document.title),
    stripControlCharacters(document.description),
    stripControlCharacters(document.channelName),
    // Joined with a comma so the stored value reads as a tag list to a human
    // reading the row. It does *not* stop a phrase query straddling two tags —
    // `to_tsvector` numbers lexemes consecutively regardless of punctuation, so
    // tags "machine" and "learning tips" would satisfy the phrase "machine
    // learning". Accepted rather than worked around: tags carry the lowest
    // weight in the corpus, so the false positive lands at the bottom of the
    // page, and the alternative is a second tsvector column.
    stripControlCharacters(document.tags.join(", ")),
    document.publishedAt.toISOString(),
    document.viewCount,
    document.durationSeconds,
    document.likeCount,
    document.dislikeCount,
  ];
}

/* --------------------------------------------------------------- helpers -- */

/**
 * Remove C0 control characters, keeping tab, newline and carriage return.
 *
 * Two jobs in one pass. It makes {@link HIGHLIGHT_START} and
 * {@link HIGHLIGHT_END} genuinely impossible in a document, which is what
 * turns "cannot collide" from an assumption into a property. And it drops
 * U+0000, which Postgres rejects outright in a `text` value — an uploader who
 * managed to get a null byte into a title would otherwise fail the *indexing*
 * of their video rather than the validation of it.
 */
function stripControlCharacters(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

/** A non-negative integer, capped. Postgres rejects a negative limit outright. */
function bounded(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), max);
}

/**
 * Both drivers are Postgres, and they still disagree about what a number is:
 * PGlite hands back `int8` as a JavaScript number, `@neondatabase/serverless`
 * hands it back as a string. Casting in SQL fixes the columns this file
 * controls; this exists so that a driver change cannot turn a score into a
 * string comparison that sorts "10" before "9" without anything failing.
 */
function toNumber(value: number | string | null): number {
  if (typeof value === "number") return value;
  if (value === null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * A fragment counts as a highlight only if something in it is marked.
 *
 * `ts_headline` never fails loudly. Given a document with no matching term —
 * the normal case when the query matched on the title and the fragment is cut
 * from the description — it returns the opening words of the document with no
 * marks at all. That is a fragment, but it is not a *highlight*, and returning
 * it would render a snippet with nothing bolded in it and no relationship to
 * what was searched for. The port's `null` says "the engine could not produce
 * one", which is exactly the situation.
 */
function usableHighlight(value: string | null): string | null {
  if (value === null || value === "") return null;
  return value.includes(HIGHLIGHT_START) ? value : null;
}

/**
 * Turn raw keystrokes into a prefix tsquery, or `null` when there is nothing
 * left to search for.
 *
 * Everything that is not a letter or a digit is a separator, so the output is
 * always `word( & word)* :*` — a shape `to_tsquery` cannot fail to parse and
 * in which no operator the user did not intend can appear. Complete words are
 * ANDed and only the trailing one takes the wildcard.
 *
 * The trailing word takes `:*` even when the input ends in a space. Branching
 * on that was considered and dropped: `rust:*` still matches `rust`, so the
 * only effect of the branch would be to make the suggestion list flicker
 * between two rankings as the space is typed.
 */
export function prefixTsQuery(prefix: string): string | null {
  const terms = prefix
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 0)
    .slice(0, MAX_SUGGEST_TERMS)
    .map((term) => term.slice(0, MAX_SUGGEST_TERM_LENGTH));

  const last = terms.at(-1);
  if (last === undefined) return null;

  return [...terms.slice(0, -1), `${last}:*`].join(" & ");
}
