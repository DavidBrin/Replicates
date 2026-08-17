import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import type { VideoCard } from "@/domain/types";

import type { SearchResultItem } from "../result-row";
import {
  EMPTY_QUERY_STATE,
  PAGE_SIZE,
  SearchResults,
  parseSearchQuery,
  searchFilters,
  searchHref,
  type SearchQueryState,
} from "../search-results";

/**
 * The URL contract and the results column.
 *
 * The URL half is tested hardest, because it is the part three separate
 * callers depend on — the page, the filter panel and `/api/search` — and the
 * failure mode is silent: a filter that stops applying looks exactly like a
 * corpus that has nothing matching it.
 */

const NOW = new Date("2026-08-16T12:00:00Z");

function state(overrides: Partial<SearchQueryState> = {}): SearchQueryState {
  return { ...EMPTY_QUERY_STATE, text: "chocolate", ...overrides };
}

function videoItem(id: string, title = "How It's Made"): SearchResultItem {
  const video: VideoCard = {
    id,
    title,
    channelId: "chn1",
    channelName: "Science Channel",
    channelHandle: "sciencechannel",
    channelAvatarKey: null,
    channelVerified: false,
    thumbnailKey: null,
    previewKey: null,
    durationSeconds: 100,
    viewCount: 10,
    publishedAt: NOW,
    isShort: false,
    watchedSeconds: null,
  };
  return { kind: "video", video, highlight: null };
}

/* ------------------------------------------------------------------ URL -- */

describe("parseSearchQuery", () => {
  it("reads the measured parameter name", () => {
    // `search_query` is the product's, twice over: the masthead input's `name`
    // and the captured results URL.
    expect(parseSearchQuery(new URLSearchParams("search_query=chocolate")).text).toBe(
      "chocolate",
    );
  });

  it("reads every filter and the sort", () => {
    const parsed = parseSearchQuery(
      new URLSearchParams(
        "search_query=rust&sort=views&type=channel&uploaded=week&duration=over20&page=3",
      ),
    );

    expect(parsed).toEqual({
      text: "rust",
      sort: "views",
      kind: "channel",
      uploaded: "week",
      duration: "over20",
      page: 3,
    });
  });

  it("defaults everything a bare URL leaves out", () => {
    expect(parseSearchQuery(new URLSearchParams())).toEqual(EMPTY_QUERY_STATE);
  });

  /**
   * A search URL is hand-editable and gets truncated by chat clients, so an
   * unrecognised value has to mean "no filter" rather than an error page for a
   * typo in a shared link.
   */
  it("drops values it does not recognise instead of failing", () => {
    const parsed = parseSearchQuery(
      new URLSearchParams(
        "search_query=x&sort=magic&type=movie&uploaded=decade&duration=medium&page=-4",
      ),
    );

    expect(parsed.sort).toBe("relevance");
    expect(parsed.kind).toBeNull();
    expect(parsed.uploaded).toBeNull();
    expect(parsed.duration).toBeNull();
    expect(parsed.page).toBe(1);
  });

  it("treats whitespace-only text as no query at all", () => {
    expect(parseSearchQuery(new URLSearchParams("search_query=%20%20")).text).toBe("");
  });
});

describe("searchHref", () => {
  it("round-trips every state through the URL", () => {
    const original = state({
      sort: "rating",
      kind: "video",
      uploaded: "month",
      duration: "4to20",
      page: 4,
    });

    const href = searchHref(original);
    const parsed = parseSearchQuery(new URLSearchParams(href.split("?")[1] ?? ""));

    expect(parsed).toEqual(original);
  });

  /**
   * The two URLs a user can reach the same results by — arriving from the
   * masthead, and clicking *Relevance* — have to be the same string, or the
   * back button starts producing states that look identical and are not.
   */
  it("omits defaults so one result set has one URL", () => {
    expect(searchHref(state())).toBe("/results?search_query=chocolate");
    expect(searchHref(state(), { sort: "relevance" })).toBe(
      "/results?search_query=chocolate",
    );
    expect(searchHref(state({ page: 1 }))).not.toContain("page=");
  });

  it("resets the page when a filter changes", () => {
    // Page 4 of the unfiltered results is an offset past the end of the
    // filtered set: an empty page that reads as a broken filter.
    const href = searchHref(state({ page: 4 }), { duration: "under4" });
    expect(href).toContain("duration=under4");
    expect(href).not.toContain("page=");
  });

  it("keeps the page when only the page changes", () => {
    expect(searchHref(state({ page: 2 }), { page: 3 })).toContain("page=3");
  });

  it("clears a filter when it is set to null", () => {
    const href = searchHref(state({ duration: "under4" }), { duration: null });
    expect(href).not.toContain("duration");
  });

  it("encodes a query that needs it", () => {
    expect(searchHref(state({ text: "a&b c" }))).toBe(
      "/results?search_query=a%26b+c",
    );
  });
});

describe("searchFilters", () => {
  it("is undefined when nothing narrows the set", () => {
    expect(searchFilters(state(), NOW)).toBeUndefined();
  });

  it("passes the kind and the duration bucket through unchanged", () => {
    expect(
      searchFilters(state({ kind: "channel", duration: "over20" }), NOW),
    ).toEqual({ kind: "channel", duration: "over20" });
  });

  it("turns an upload window into the port's single `uploadedAfter` date", () => {
    const filters = searchFilters(state({ uploaded: "week" }), NOW);
    expect(filters?.uploadedAfter?.toISOString()).toBe("2026-08-09T12:00:00.000Z");
  });

  it("measures every window from the clock it is given", () => {
    const at = (window: SearchQueryState["uploaded"]) =>
      searchFilters(state({ uploaded: window }), NOW)?.uploadedAfter?.toISOString();

    expect(at("hour")).toBe("2026-08-16T11:00:00.000Z");
    expect(at("today")).toBe("2026-08-15T12:00:00.000Z");
    // 30 days and 365 days, deliberately not calendar months — see the note on
    // `UPLOAD_WINDOW_MS`.
    expect(at("month")).toBe("2026-07-17T12:00:00.000Z");
    expect(at("year")).toBe("2025-08-16T12:00:00.000Z");
  });
});

/* --------------------------------------------------------------- the UI -- */

describe("SearchResults", () => {
  it('says "About N results", grouped', () => {
    render(
      <SearchResults state={state()} total={1234} items={[videoItem("v1")]} now={NOW} />,
    );
    expect(screen.getByText("About 1,234 results")).toBeInTheDocument();
  });

  it("uses the singular for one result", () => {
    render(<SearchResults state={state()} total={1} items={[videoItem("v1")]} now={NOW} />);
    expect(screen.getByText("About 1 result")).toBeInTheDocument();
  });

  it("renders one row per hit, in the order given", () => {
    render(
      <SearchResults
        state={state()}
        total={2}
        items={[videoItem("v1", "First"), videoItem("v2", "Second")]}
        now={NOW}
      />,
    );

    const titles = screen
      .getAllByRole("link")
      .map((link) => link.textContent)
      .filter((text) => text === "First" || text === "Second");
    expect(titles).toEqual(["First", "Second"]);
  });

  it("prompts rather than searching when there is no query", () => {
    render(<SearchResults state={state({ text: "" })} total={0} items={[]} />);
    expect(screen.getByText("Search YouTube")).toBeInTheDocument();
    expect(screen.queryByText(/About/)).toBeNull();
  });

  /**
   * The stopword case.
   *
   * `the a of` is a legal query that matches nothing:
   * `websearch_to_tsquery('english', 'the a of')` is the empty tsquery. The
   * adapter answers it with an ordinary empty result set rather than an error,
   * and the page must show the empty state rather than a failure — the
   * requirement is that this does not 500 anywhere along the path.
   */
  it("shows an empty state for a query that matches nothing", () => {
    render(<SearchResults state={state({ text: "the a of" })} total={0} items={[]} />);

    expect(screen.getByText("No results found")).toBeInTheDocument();
    expect(screen.getByText("Try different keywords.")).toBeInTheDocument();
    expect(screen.getByText("About 0 results")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Clear filters" })).toBeNull();
  });

  it("offers a way out when filters are what emptied the page", () => {
    render(
      <SearchResults
        state={state({ duration: "over20", kind: "channel" })}
        total={0}
        items={[]}
      />,
    );

    expect(
      screen.getByText("Try different keywords or remove some filters."),
    ).toBeInTheDocument();
    // The escape hatch keeps the query and drops every filter.
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute(
      "href",
      "/results?search_query=chocolate",
    );
  });

  it("pages forward only while there is more to show", () => {
    const items = Array.from({ length: PAGE_SIZE }, (_, i) => videoItem(`v${i}`));
    const { rerender } = render(
      <SearchResults state={state()} total={PAGE_SIZE * 3} items={items} now={NOW} />,
    );

    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      "/results?search_query=chocolate&page=2",
    );
    expect(screen.queryByRole("link", { name: "Previous" })).toBeNull();

    rerender(
      <SearchResults state={state({ page: 3 })} total={PAGE_SIZE * 3} items={items} now={NOW} />,
    );
    expect(screen.queryByRole("link", { name: "Next" })).toBeNull();
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "/results?search_query=chocolate&page=2",
    );
  });

  it("renders no pager at all for a single page", () => {
    render(<SearchResults state={state()} total={1} items={[videoItem("v1")]} now={NOW} />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
