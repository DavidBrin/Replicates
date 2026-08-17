import { CACHE_CONTROL_NONE } from "@/adapters/blob";
import { searchIndex } from "@/adapters/search";
import {
  PAGE_SIZE,
  parseSearchQuery,
  searchFilters,
} from "@/components/search/search-results";

/**
 * `GET /api/search` — the index's answer, and nothing else.
 *
 * ## What it returns, and why it is not result rows
 *
 * The port's `SearchHit` is `{ id, kind, score, highlight }` — an index does
 * not know what a video card looks like, which is the whole reason
 * `ports/search-index.ts` exposes nothing Postgres-shaped. Turning those ids
 * into cards is a *repository* projection: `listCardsByIds` for videos, the
 * channels repository for channels, both of which decide visibility and both
 * of which belong to the page that renders them. Hydrating here as well would
 * put that projection in two files, and the two would drift the first time a
 * card gains a field.
 *
 * So this route answers with the hits. That is genuinely useful — it is the
 * surface an e2e test asserts ranking and filtering against, and it is what a
 * future "load more" would page through — and it is honest about the layering.
 * `src/app/(main)/results/page.tsx` hydrates for itself.
 *
 * ## The query string is the page's, not a second dialect
 *
 * Parsing goes through `parseSearchQuery`, the same function the page and the
 * filter panel use, so `/api/search?search_query=x&duration=over20` and
 * `/results?search_query=x&duration=over20` cannot disagree about what they
 * asked for. `q` is accepted as an alias because it is what anyone reaches for
 * when calling an API by hand.
 *
 * ## A stopword-only query is a 200
 *
 * `?search_query=the a of` must not 500, and it does not: the adapter sends it
 * to Postgres, `websearch_to_tsquery('english', 'the a of')` is the empty
 * tsquery, the empty tsquery matches nothing, and the answer is an ordinary
 * empty result set. An empty query is answered without touching the database
 * at all. Neither is an error, and neither is reported as one.
 */
export const runtime = "nodejs";

/** The masthead's parameter is `search_query`; `q` is the hand-typed alias. */
const ALIAS_PARAM = "q";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const params = url.searchParams;

  // `parseSearchQuery` reads `search_query`. Copying `q` onto it before parsing
  // keeps the alias in one line rather than making the shared parser learn
  // about an API-only spelling.
  const alias = params.get(ALIAS_PARAM);
  if (alias !== null && params.get("search_query") === null) {
    params.set("search_query", alias);
  }

  const state = parseSearchQuery(params);
  const filters = searchFilters(state, new Date());

  const index = await searchIndex();
  const results = await index.query({
    text: state.text,
    ...(filters === undefined ? {} : { filters }),
    sort: state.sort,
    limit: PAGE_SIZE,
    offset: (state.page - 1) * PAGE_SIZE,
  });

  return json(200, {
    query: state.text,
    sort: state.sort,
    page: state.page,
    pageSize: PAGE_SIZE,
    // Documented as an estimate by the port even though this adapter's is
    // exact. Named `total` rather than `resultCount` so the field and the
    // port's wording stay recognisably the same thing.
    total: results.total,
    /**
     * Always `null` under this adapter: a spelling correction needs either a
     * trigram index over the lexemes or a query log, and PGlite ships no
     * `pg_trgm` and this application keeps no log (D13). It is in the response
     * because the port promises the field, and a client that omitted it would
     * have to be changed the day an adapter can fill it.
     */
    correction: results.correction,
    hits: results.hits.map((hit) => ({
      id: hit.id,
      kind: hit.kind,
      score: hit.score,
      /**
       * The fragment with its U+0002/U+0003 marks intact. They survive JSON —
       * `JSON.stringify` escapes a C0 control as a `\uXXXX` sequence — and stripping them
       * here would leave a client that cannot tell what matched. Rendering
       * them is `src/components/search/result-row.tsx`'s job and nobody else's.
       */
      highlight: hit.highlight,
    })),
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      // A search result depends on the corpus and on `now()` — the relevance
      // blend has a freshness term — so there is nothing here a shared cache
      // may keep.
      "Cache-Control": CACHE_CONTROL_NONE,
    },
  });
}
