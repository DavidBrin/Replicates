import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  ALL_CHIP_LABEL,
  HomeFeed,
  MAX_FEED_CHIPS,
  chipsForFeed,
} from "@/components/feed";
import { formatRelativeTime, formatViewCount } from "@/domain/format";
import type { VideoCard } from "@/domain/types";

/**
 * The home feed.
 *
 * The assertions worth having here are about *delegation* and *state*, not
 * about pixels: jsdom has no layout engine and no container queries, so
 * "3 columns at 1680px of content" is unprovable and "the grid asks the
 * container query for its column count instead of computing one" is exactly
 * provable. The same applies to the numbers on a card — the interesting
 * property is that they come from `domain/format.ts` rather than from a
 * second rounding written into a feed.
 */

/**
 * Every formatter is wrapped rather than replaced, so the rendered strings are
 * the real ones and the calls are still countable. Replacing them would prove
 * only that a mock was installed.
 */
vi.mock("@/domain/format", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/format")>();
  return {
    ...actual,
    formatViewCount: vi.fn(actual.formatViewCount),
    formatRelativeTime: vi.fn(actual.formatRelativeTime),
  };
});

const NOW = new Date("2026-08-16T12:00:00Z");

function makeVideo(id: string, overrides: Partial<VideoCard> = {}): VideoCard {
  return {
    id,
    title: `Video ${id}`,
    channelId: "stackframe",
    channelName: "Stackframe",
    channelHandle: "stackframe",
    channelAvatarKey: null,
    channelVerified: false,
    thumbnailKey: `videos/${id}/thumb.jpg`,
    previewKey: null,
    durationSeconds: 1_821,
    // 1,240,000 is the number R8 §8.1 uses to separate the two ladders: the
    // view rule gives `1.2M` and the subscriber rule `1.24M`.
    viewCount: 1_240_000,
    publishedAt: new Date("2025-10-16T12:00:00Z"),
    isShort: false,
    watchedSeconds: null,
    ...overrides,
  };
}

const STACKFRAME = [makeVideo("a"), makeVideo("b")];
const PATCHBAY = [
  makeVideo("c", { channelId: "patchbay", channelName: "The Patch Bay" }),
];
const VIDEOS = [...STACKFRAME, ...PATCHBAY];

const SHORTS = [
  makeVideo("s1", { isShort: true, durationSeconds: 20 }),
  makeVideo("s2", {
    isShort: true,
    durationSeconds: 18,
    channelId: "patchbay",
    channelName: "The Patch Bay",
  }),
];

function grid(container: HTMLElement): HTMLElement {
  const node = container.querySelector<HTMLElement>("[data-video-grid]");
  if (!node) throw new Error("no grid rendered");
  return node;
}

/* ------------------------------------------------------------ delegation -- */

describe("the grid is VideoGrid's, not this component's", () => {
  /**
   * R8 §3.3's measurement is why: 1920px with the guide expanded is 3 columns
   * and 1920px with it collapsed is 4. The count follows the *content* box, so
   * it is resolved by a container query in `globals.css` and read here as a
   * variable. A breakpoint written into the feed is wrong on every toggle of
   * the rail while looking right in a screenshot.
   */
  it("hands its cards to a single VideoGrid that reads --yt-grid-columns", () => {
    const { container } = render(<HomeFeed videos={VIDEOS} now={NOW} />);

    expect(container.querySelectorAll("[data-video-grid]")).toHaveLength(1);
    expect(grid(container).getAttribute("style")).toContain(
      "repeat(var(--yt-grid-columns, 1), minmax(0, 1fr))",
    );
    expect(within(grid(container)).getAllByRole("article")).toHaveLength(
      VIDEOS.length,
    );
  });

  it("adds no column utilities and no viewport breakpoints of its own", () => {
    const { container } = render(
      <HomeFeed videos={VIDEOS} shorts={SHORTS} chips={chipsForFeed(VIDEOS)} now={NOW} />,
    );

    const classes = [...container.querySelectorAll<HTMLElement>("[class]")]
      .map((node) => node.className)
      .join(" ");

    expect(classes).not.toMatch(/grid-cols-/);
    expect(classes).not.toMatch(/\b(sm|md|lg|xl|2xl):/);
  });

  /**
   * `domain/format.ts` exists because views round to two significant digits
   * and subscriber counts keep three; a call site that formats its own number
   * picks the wrong rule about half the time. The output is checked as well as
   * the call, because a feed could import the module and then ignore it.
   */
  it("renders its counts and times through the shared formatters", () => {
    render(<HomeFeed videos={VIDEOS} now={NOW} />);

    expect(vi.mocked(formatViewCount)).toHaveBeenCalledWith(1_240_000);
    expect(vi.mocked(formatRelativeTime)).toHaveBeenCalled();

    // The view ladder, not the subscriber one: `1.2M`, never `1.24M`.
    expect(screen.getAllByText("1.2M views").length).toBeGreaterThan(0);
    expect(screen.queryByText("1.24M views")).toBeNull();
    expect(screen.getAllByText("10 months ago").length).toBeGreaterThan(0);
  });
});

/* ----------------------------------------------------------------- chips -- */

describe("chipsForFeed", () => {
  it("always leads with All, which filters nothing", () => {
    const chips = chipsForFeed(VIDEOS);
    expect(chips[0]?.label).toBe(ALL_CHIP_LABEL);
    expect(chips[0]?.videoIds).toBeUndefined();
  });

  it("carries each chip's membership rather than a rule for computing it", () => {
    const chips = chipsForFeed(VIDEOS);
    const stackframe = chips.find((chip) => chip.label === "Stackframe");
    expect(stackframe?.videoIds).toEqual(["a", "b"]);
  });

  /**
   * R9 §4's "personalised topic chips derived from watch history", expressed
   * with what this application knows: the viewer's own subscriptions first,
   * everything else by how much of the feed it accounts for. Signed out the
   * promoted list is empty and the order is contribution alone — which is the
   * same "recommendation versus trending fallback" line the grid draws.
   */
  it("promotes the viewer's own subscriptions ahead of a bigger contributor", () => {
    const signedOut = chipsForFeed(VIDEOS).map((chip) => chip.label);
    expect(signedOut).toEqual([ALL_CHIP_LABEL, "Stackframe", "The Patch Bay"]);

    const signedIn = chipsForFeed(VIDEOS, {
      promoteChannelIds: ["patchbay"],
    }).map((chip) => chip.label);
    expect(signedIn).toEqual([ALL_CHIP_LABEL, "The Patch Bay", "Stackframe"]);
  });

  it("draws no bar at all when every card is from one channel", () => {
    // "All" plus one chip is a bar where every choice shows the same feed.
    expect(chipsForFeed(STACKFRAME)).toEqual([]);
    expect(chipsForFeed([])).toEqual([]);
  });

  it("caps the set at the number the product was observed carrying", () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      makeVideo(`v${index}`, {
        channelId: `ch${index}`,
        channelName: `Channel ${index}`,
      }),
    );
    expect(chipsForFeed(many)).toHaveLength(MAX_FEED_CHIPS);
  });
});

describe("filtering", () => {
  it("narrows the grid to the selected chip's videos", async () => {
    const { container } = render(
      <HomeFeed videos={VIDEOS} chips={chipsForFeed(VIDEOS)} now={NOW} />,
    );
    expect(within(grid(container)).getAllByRole("article")).toHaveLength(3);

    await userEvent.click(screen.getByRole("tab", { name: "The Patch Bay" }));

    const cards = within(grid(container)).getAllByRole("article");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent("Video c");
  });

  it("filters the Shorts shelf by the same selection", async () => {
    const { container } = render(
      <HomeFeed
        videos={VIDEOS}
        shorts={SHORTS}
        chips={chipsForFeed([...VIDEOS, ...SHORTS])}
        now={NOW}
      />,
    );

    await userEvent.click(screen.getByRole("tab", { name: "The Patch Bay" }));

    const shelf = container.querySelector<HTMLElement>("[data-shelf]");
    expect(shelf).not.toBeNull();
    expect(shelf?.querySelectorAll("[data-shelf-item]")).toHaveLength(1);
  });

  /**
   * The panel the tabs control has to be a real `tabpanel` pointing back at
   * whichever chip is current, or `aria-selected` describes a relationship
   * that is not in the document.
   */
  it("labels the filtered region with the chip that produced it", async () => {
    render(<HomeFeed videos={VIDEOS} chips={chipsForFeed(VIDEOS)} now={NOW} />);

    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute(
      "aria-labelledby",
      screen.getByRole("tab", { name: ALL_CHIP_LABEL }).id,
    );

    await userEvent.click(screen.getByRole("tab", { name: "Stackframe" }));
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      screen.getByRole("tab", { name: "Stackframe" }).id,
    );
  });

  it("draws no bar, and no tabpanel, when there is nothing to filter by", () => {
    render(<HomeFeed videos={STACKFRAME} chips={chipsForFeed(STACKFRAME)} now={NOW} />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });
});

/* ----------------------------------------------------------------- Shorts -- */

describe("Shorts are a shelf, never grid items", () => {
  it("keeps them out of the grid and in a scrolling shelf of their own", () => {
    const { container } = render(
      <HomeFeed videos={VIDEOS} shorts={SHORTS} now={NOW} />,
    );

    const shelf = container.querySelector<HTMLElement>("[data-shelf]");
    expect(shelf).not.toBeNull();
    expect(
      within(shelf as HTMLElement).getByRole("heading", { level: 2 }),
    ).toHaveTextContent("Shorts");
    expect(shelf?.querySelectorAll("[data-shelf-item]")).toHaveLength(
      SHORTS.length,
    );

    // The grid holds the sixteen-by-nine videos and only those. A vertical
    // video in the grid is letterboxed to about a third of its tile, which is
    // why `videos.ts` excludes shorts from the home query in SQL.
    const gridCards = within(grid(container)).getAllByRole("article");
    expect(gridCards).toHaveLength(VIDEOS.length);
    expect(grid(container).textContent).not.toContain("Video s1");
  });

  /**
   * R9 §5.1: the Shorts lockup is a title over a view count — no avatar, no
   * channel row. The lockup itself is a component the frozen card family does
   * not ship, so this is the closest the available one gets.
   */
  it("drops the channel row the Shorts lockup does not have", () => {
    const { container } = render(<HomeFeed videos={[]} shorts={SHORTS} now={NOW} />);
    const shelf = container.querySelector<HTMLElement>("[data-shelf]");

    expect(shelf?.querySelectorAll("[data-card-avatar]")).toHaveLength(0);
    expect(shelf?.querySelectorAll("[data-channel-link]")).toHaveLength(0);
  });

  it("renders no shelf when the viewer's Shorts feed is empty", () => {
    const { container } = render(<HomeFeed videos={VIDEOS} now={NOW} />);
    expect(container.querySelector("[data-shelf]")).toBeNull();
  });
});

/* ---------------------------------------------------------- empty states -- */

describe("empty states", () => {
  /**
   * R8 §8.3, verbatim: the logged-out cold-start home renders exactly these
   * two lines (`screenshots/01-home-empty-state-1920.png`). This application
   * only reaches the state on an empty corpus — `recommendations.ts` backfills
   * from the most-viewed pool on every call, so a fresh session still gets a
   * feed.
   */
  it("uses the measured cold-start copy for a signed-out viewer", () => {
    render(<HomeFeed videos={[]} shorts={[]} now={NOW} />);

    expect(
      screen.getByRole("heading", { name: "Try searching to get started" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Start watching videos to help us build a feed of videos you'll love.",
      ),
    ).toBeInTheDocument();
  });

  /**
   * And does not use it signed in, which is the one place the measured line is
   * actively wrong: it tells a viewer who already has a history and
   * subscriptions to start building a feed. R9 never captured this state, so
   * the replacement is ours and is marked as such where it is written.
   */
  it("does not tell a signed-in viewer to start building a feed", () => {
    render(<HomeFeed videos={[]} shorts={[]} signedIn now={NOW} />);

    expect(screen.queryByText(/Try searching to get started/)).toBeNull();
    expect(
      screen.getByRole("heading", { name: "No videos to show yet" }),
    ).toBeInTheDocument();
  });

  /**
   * A filter that empties the grid has to look deliberate rather than broken,
   * and it has to *say so* — the page changed without focus moving, so a
   * keyboard or screen-reader user gets no other signal. Hence `role="status"`
   * and copy naming the chip that did it.
   */
  it("says which filter emptied the grid, and keeps the bar to escape it", async () => {
    const chips = [
      ...chipsForFeed(VIDEOS),
      { id: "empty", label: "Orbital Lab", videoIds: [] },
    ];
    render(<HomeFeed videos={VIDEOS} shorts={SHORTS} chips={chips} now={NOW} />);

    await userEvent.click(screen.getByRole("tab", { name: "Orbital Lab" }));

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("No videos in Orbital Lab");
    expect(screen.getByRole("tab", { name: ALL_CHIP_LABEL })).toBeInTheDocument();
    expect(document.querySelector("[data-video-grid]")).toBeNull();
    expect(document.querySelector("[data-shelf]")).toBeNull();
  });

  it("goes back to the full feed when All is chosen again", async () => {
    const chips = [
      ...chipsForFeed(VIDEOS),
      { id: "empty", label: "Orbital Lab", videoIds: [] },
    ];
    const { container } = render(
      <HomeFeed videos={VIDEOS} chips={chips} now={NOW} />,
    );

    await userEvent.click(screen.getByRole("tab", { name: "Orbital Lab" }));
    await userEvent.click(screen.getByRole("tab", { name: ALL_CHIP_LABEL }));

    expect(within(grid(container)).getAllByRole("article")).toHaveLength(3);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
