// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  SearchIndex,
  SearchQuery,
  SearchResults,
} from "@/ports/search-index";

/**
 * `/api/search` and `/api/search/suggest`.
 *
 * These are the tests that prove a filter reaches the adapter. Everything
 * above them — the panel's `href`, the page's parse — is assertable on its own,
 * but "the URL said `duration=over20` and the index was asked for `over20`" is
 * only observable here, and it is the seam where a filter silently stops
 * applying.
 *
 * The index is a fake rather than a real PGlite, deliberately: the question is
 * what the route *asks for*, and a real index would answer an empty corpus
 * identically whether the filter arrived or not.
 */

const index = {
  index: vi.fn(),
  indexMany: vi.fn(),
  remove: vi.fn(),
  query: vi.fn(),
  suggest: vi.fn(),
};

vi.mock("@/adapters/search", () => ({
  searchIndex: async (): Promise<SearchIndex> => index as unknown as SearchIndex,
}));

const EMPTY: SearchResults = { hits: [], total: 0, correction: null };

/**
 * A fragment with one marked run, written as escapes.
 *
 * The delimiters are U+0002 and U+0003 and are invisible in a source file, so
 * they are never typed literally anywhere in this repository — a reviewer
 * cannot see what they are looking at, and a stray one survives every visual
 * check.
 */
const MARKED = "a \u0002b\u0003 c";

const { GET } = await import("@/app/api/search/route");
const { GET: SUGGEST } = await import("@/app/api/search/suggest/route");

function get(url: string): Promise<Response> {
  return GET(new Request(`http://localhost${url}`));
}

function suggest(url: string): Promise<Response> {
  return SUGGEST(new Request(`http://localhost${url}`));
}

/** The `SearchQuery` the route handed the index on its last call. */
function lastQuery(): SearchQuery {
  const call = index.query.mock.calls.at(-1);
  if (call === undefined) throw new Error("the index was never queried");
  return call[0] as SearchQuery;
}

beforeEach(() => {
  vi.clearAllMocks();
  index.query.mockResolvedValue(EMPTY);
  index.suggest.mockResolvedValue([]);
});

describe("GET /api/search", () => {
  it("passes the query text through", async () => {
    await get("/api/search?search_query=chocolate");
    expect(lastQuery().text).toBe("chocolate");
  });

  it("accepts `q` as the hand-typed alias", async () => {
    await get("/api/search?q=chocolate");
    expect(lastQuery().text).toBe("chocolate");
  });

  it("prefers the measured parameter when both are present", async () => {
    await get("/api/search?search_query=real&q=alias");
    expect(lastQuery().text).toBe("real");
  });

  it.each([
    ["relevance", "sort=relevance"],
    ["date", "sort=date"],
    ["views", "sort=views"],
    ["rating", "sort=rating"],
  ] as const)("sends the %s sort", async (sort, query) => {
    await get(`/api/search?search_query=x&${query}`);
    expect(lastQuery().sort).toBe(sort);
  });

  it("defaults to relevance", async () => {
    await get("/api/search?search_query=x");
    expect(lastQuery().sort).toBe("relevance");
  });

  it.each([
    ["video", "type=video"],
    ["channel", "type=channel"],
  ] as const)("sends the %s kind filter", async (kind, query) => {
    await get(`/api/search?search_query=x&${query}`);
    expect(lastQuery().filters?.kind).toBe(kind);
  });

  it.each([
    ["under4", "duration=under4"],
    ["4to20", "duration=4to20"],
    ["over20", "duration=over20"],
  ] as const)("sends the %s duration bucket", async (bucket, query) => {
    await get(`/api/search?search_query=x&${query}`);
    expect(lastQuery().filters?.duration).toBe(bucket);
  });

  it("turns an upload window into a date in the recent past", async () => {
    const before = Date.now();
    await get("/api/search?search_query=x&uploaded=week");
    const after = Date.now();

    const uploadedAfter = lastQuery().filters?.uploadedAfter?.getTime() ?? 0;
    const week = 7 * 24 * 60 * 60 * 1000;
    expect(uploadedAfter).toBeGreaterThanOrEqual(before - week);
    expect(uploadedAfter).toBeLessThanOrEqual(after - week);
  });

  it("combines filters rather than letting the last one win", async () => {
    await get("/api/search?search_query=x&type=video&duration=over20&uploaded=year");
    const filters = lastQuery().filters;

    expect(filters?.kind).toBe("video");
    expect(filters?.duration).toBe("over20");
    expect(filters?.uploadedAfter).toBeInstanceOf(Date);
  });

  it("sends no filters at all when none are asked for", async () => {
    await get("/api/search?search_query=x");
    expect(lastQuery().filters).toBeUndefined();
  });

  it("drops an unrecognised filter instead of refusing the request", async () => {
    const response = await get("/api/search?search_query=x&duration=medium&sort=magic");
    expect(response.status).toBe(200);
    expect(lastQuery().filters).toBeUndefined();
    expect(lastQuery().sort).toBe("relevance");
  });

  it("turns the page number into an offset", async () => {
    await get("/api/search?search_query=x&page=3");
    const query = lastQuery();
    expect(query.offset).toBe(query.limit * 2);
  });

  it("starts at offset zero", async () => {
    await get("/api/search?search_query=x");
    expect(lastQuery().offset).toBe(0);
  });

  /**
   * The stopword case, at the layer where a 500 would happen.
   *
   * The adapter sends `the a of` to Postgres — reimplementing the stopword list
   * in TypeScript would put a second copy of it out of step with the dictionary
   * the vectors were built from — and `websearch_to_tsquery('english', 'the a
   * of')` is the empty tsquery, which matches nothing. The route's job is to
   * report that as an ordinary empty result set.
   */
  it("answers a stopword-only query with an empty 200", async () => {
    const response = await get("/api/search?search_query=the+a+of");

    expect(response.status).toBe(200);
    expect(lastQuery().text).toBe("the a of");
    expect(await response.json()).toMatchObject({ total: 0, hits: [] });
  });

  it("answers an empty query with an empty 200", async () => {
    const response = await get("/api/search");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ hits: [] });
  });

  it("returns the hits as the index gave them, marks intact", async () => {
    index.query.mockResolvedValue({
      hits: [
        { id: "v1", kind: "video", score: 0.5, highlight: MARKED },
        { id: "c1", kind: "channel", score: 0.4, highlight: null },
      ],
      total: 2,
      correction: null,
    } satisfies SearchResults);

    const body = (await (await get("/api/search?search_query=b")).json()) as {
      hits: { id: string; kind: string; highlight: string | null }[];
      correction: string | null;
    };

    // The delimiters survive JSON. Stripping them here would leave a client
    // unable to tell what matched, which is the only reason to send a fragment.
    expect(body.hits[0]?.highlight).toBe(MARKED);
    // `null` is the normal case for a title-only match, not an error.
    expect(body.hits[1]?.highlight).toBeNull();
    expect(body.hits.map((hit) => hit.kind)).toEqual(["video", "channel"]);
    // Always `null` under this adapter — no `pg_trgm`, no query log. Present in
    // the response because the port promises the field.
    expect(body.correction).toBeNull();
  });

  it("is never cached", async () => {
    const response = await get("/api/search?search_query=x");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
});

describe("GET /api/search/suggest", () => {
  it("passes the prefix and a bounded limit", async () => {
    await suggest("/api/search/suggest?q=rus&limit=5");
    expect(index.suggest).toHaveBeenCalledWith("rus", 5);
  });

  it("defaults the limit", async () => {
    await suggest("/api/search/suggest?q=rus");
    expect(index.suggest).toHaveBeenCalledWith("rus", 10);
  });

  it("clamps a limit a caller invented", async () => {
    await suggest("/api/search/suggest?q=rus&limit=10000");
    expect(index.suggest).toHaveBeenCalledWith("rus", 20);
  });

  it("answers a blank prefix without touching the index", async () => {
    const response = await suggest("/api/search/suggest?q=%20%20");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ suggestions: [] });
    expect(index.suggest).not.toHaveBeenCalled();
  });

  it("truncates a paste rather than turning it into a tsquery", async () => {
    await suggest(`/api/search/suggest?q=${"a".repeat(4000)}`);
    const prefix = index.suggest.mock.calls[0]?.[0] as string;
    expect(prefix.length).toBe(100);
  });

  it("returns the index's answer", async () => {
    index.suggest.mockResolvedValue(["rust", "rust book"]);
    const response = await suggest("/api/search/suggest?q=rus");
    expect(await response.json()).toEqual({ suggestions: ["rust", "rust book"] });
  });

  /**
   * Type-ahead is an accelerator. A failure behind it must cost the user
   * nothing more than the accelerator — the search itself does not go through
   * this route.
   */
  it("degrades to an empty list rather than a 500", async () => {
    index.suggest.mockRejectedValue(new Error("index unreachable"));
    const response = await suggest("/api/search/suggest?q=rus");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ suggestions: [] });
  });
});
