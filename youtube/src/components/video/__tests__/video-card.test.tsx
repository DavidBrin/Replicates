import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MenuItem } from "@/components/primitives";
import {
  PREVIEW_DELAY_MS,
  Thumbnail,
  VideoCardView,
  VideoRowView,
} from "@/components/video";
import {
  describeDuration,
  formatCompactCount,
  formatCompactRelativeTime,
  formatDuration,
  formatRelativeTime,
  formatViewCount,
} from "@/domain/format";
import type { VideoCard } from "@/domain/types";

/**
 * The card family.
 *
 * Each assertion is a rule a reimplementation would plausibly break *on its
 * own*. There are no snapshots: a snapshot of a card asserts nothing about
 * whether the card is right, and goes red every time a class name moves.
 *
 * The fixture is the video R8 §4 actually measured — 961,368 views, published
 * ten months before the capture, 30:21 long — so the expected strings in these
 * tests are the strings in `research/extracted/card-dump-1920.json` rather
 * than strings invented to match the implementation.
 */

const NOW = new Date("2026-08-16T12:00:00Z");

function makeVideo(overrides: Partial<VideoCard> = {}): VideoCard {
  return {
    id: "v1",
    title: "How It's Made: Noodles, Pasta, Mac & Cheese",
    channelId: "c1",
    channelName: "Captain Discovery",
    channelHandle: "captaindiscovery",
    channelAvatarKey: "channels/c1/avatar.jpg",
    channelVerified: false,
    thumbnailKey: "videos/v1/thumb.jpg",
    previewKey: null,
    durationSeconds: 1_821,
    viewCount: 961_368,
    publishedAt: new Date("2025-10-16T12:00:00Z"),
    isShort: false,
    watchedSeconds: null,
    ...overrides,
  };
}

function styleOf(element: Element): string {
  return element.getAttribute("style") ?? "";
}

/* --------------------------------------------------- watched progress ----- */

describe("the watched-progress bar", () => {
  /**
   * `VideoCard.watchedSeconds` is `number | null` and the domain type says
   * why: `null` is "never opened", `0` is "started and seeked back". A clone
   * that treats the field as falsy paints a resume marker on every card in a
   * logged-out feed.
   */
  it("does not render for null", () => {
    render(<Thumbnail video={makeVideo({ watchedSeconds: null })} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("renders for 0, which is not the same as null", () => {
    render(<Thumbnail video={makeVideo({ watchedSeconds: 0 })} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    expect(styleOf(bar.firstElementChild as Element)).toContain("width: 0%");
  });

  it("renders the fraction watched, clamped to the video's length", () => {
    render(
      <Thumbnail video={makeVideo({ durationSeconds: 100, watchedSeconds: 25 })} />,
    );
    const fill = screen.getByRole("progressbar").firstElementChild;
    expect(fill).not.toBeNull();
    expect(styleOf(fill as Element)).toContain("width: 25%");
  });

  it("never reports past the end when the stored position overshoots", () => {
    render(
      <Thumbnail video={makeVideo({ durationSeconds: 100, watchedSeconds: 140 })} />,
    );
    expect(styleOf(screen.getByRole("progressbar").firstElementChild as Element)).toContain(
      "width: 100%",
    );
  });

  it("announces the position in words rather than as a seconds count", () => {
    render(
      <Thumbnail video={makeVideo({ durationSeconds: 1_821, watchedSeconds: 910 })} />,
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      `${describeDuration(910)} of ${describeDuration(1_821)}`,
    );
  });
});

/* --------------------------------------------------------- duration ------- */

describe("the duration badge", () => {
  it("shows the measured badge string and announces a spoken form", () => {
    render(<Thumbnail video={makeVideo()} />);

    // R8 §4 captured this exact badge: `30:21`, 12/18/500 white on
    // rgba(0,0,0,.6).
    expect(screen.getByText(formatDuration(1_821))).toBeInTheDocument();
    expect(screen.getByText(formatDuration(1_821))).toHaveTextContent("30:21");

    // …and separately, the form a screen reader can say. `30:21` is announced
    // as "thirty twenty-one", which is a different number.
    expect(screen.getByText(describeDuration(1_821))).toBeInTheDocument();
    expect(screen.getByText(describeDuration(1_821))).toHaveTextContent(
      "30 minutes, 21 seconds",
    );
  });

  it("is omitted rather than rendered as 0:00 when there is no duration", () => {
    render(<Thumbnail video={makeVideo({ durationSeconds: 0 })} />);
    expect(screen.queryByText("0:00")).toBeNull();
  });
});

/* -------------------------------------------------------- hover preview --- */

describe("the hover preview", () => {
  it("does not fetch a clip until the pointer has rested", () => {
    vi.useFakeTimers();
    try {
      render(
        <Thumbnail video={makeVideo({ previewKey: "videos/v1/preview.mp4" })} />,
      );
      const thumb = document.querySelector("[data-thumbnail]");
      expect(thumb).not.toBeNull();

      fireEvent.pointerEnter(thumb as Element);
      // Crossing a grid of forty cards must not start forty media fetches.
      act(() => {
        vi.advanceTimersByTime(PREVIEW_DELAY_MS - 1);
      });
      expect(document.querySelector("[data-thumbnail-preview]")).toBeNull();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(document.querySelector("[data-thumbnail-preview]")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never previews a video that has no preview clip", () => {
    vi.useFakeTimers();
    try {
      render(<Thumbnail video={makeVideo({ previewKey: null })} />);
      fireEvent.pointerEnter(document.querySelector("[data-thumbnail]") as Element);
      act(() => {
        vi.advanceTimersByTime(PREVIEW_DELAY_MS * 4);
      });
      expect(document.querySelector("[data-thumbnail-preview]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

/* --------------------------------------------------------- the anchors --- */

describe("VideoCardView — link structure", () => {
  const video = makeVideo();

  it("is one link to the video, not the product's two", () => {
    render(<VideoCardView video={video} now={NOW} />);
    const toWatch = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href")?.startsWith("/watch"));
    expect(toWatch).toHaveLength(1);
    expect(toWatch[0]).toHaveAccessibleName(video.title);
  });

  it("puts the channel link beside the card link, never inside it", () => {
    render(<VideoCardView video={video} now={NOW} />);
    const card = screen.getByRole("link", { name: video.title });
    const channel = screen.getByRole("link", { name: video.channelName });

    // Nested interactive content is invalid and collapses keyboard traversal
    // — the inner control becomes unreachable in several browsers.
    expect(card.contains(channel)).toBe(false);
    expect(channel).toHaveAttribute("href", "/@captaindiscovery");
  });

  it("keeps the menu trigger and its popup outside the card link", async () => {
    const user = userEvent.setup();
    render(
      <VideoCardView
        video={video}
        now={NOW}
        menuItems={<MenuItem>Save to Watch later</MenuItem>}
      />,
    );

    const card = screen.getByRole("link", { name: video.title });
    const trigger = screen.getByRole("button", { name: `Actions for ${video.title}` });
    expect(card.contains(trigger)).toBe(false);

    await user.click(trigger);
    const menu = screen.getByRole("menu");
    expect(card.contains(menu)).toBe(false);
    expect(screen.getByRole("menuitem", { name: "Save to Watch later" })).toBeInTheDocument();
  });

  it("renders no kebab when the surface supplies no actions", () => {
    render(<VideoCardView video={video} now={NOW} />);
    expect(screen.queryByRole("button", { name: /Actions for/ })).toBeNull();
  });
});

/* ------------------------------------------------------------ variants --- */

describe("VideoCardView — the variants real surfaces need", () => {
  const video = makeVideo();

  it("shows the avatar and the channel name by default", () => {
    const { container } = render(<VideoCardView video={video} now={NOW} />);
    expect(container.querySelector("[data-card-avatar]")).not.toBeNull();
    expect(screen.getByRole("link", { name: video.channelName })).toBeInTheDocument();
  });

  it("drops the avatar on a channel's own page", () => {
    // R8 §3.7: the channel Videos-tab card is measured with "**no avatar**
    // (channel context)".
    const { container } = render(
      <VideoCardView video={video} showAvatar={false} now={NOW} />,
    );
    expect(container.querySelector("[data-card-avatar]")).toBeNull();
  });

  it("drops the channel name independently of the avatar", () => {
    render(<VideoCardView video={video} showChannel={false} now={NOW} />);
    expect(screen.queryByRole("link", { name: video.channelName })).toBeNull();
    // …and the counts row survives, which is the point of the two flags being
    // separate rather than one `channelContext` boolean.
    expect(screen.getByText(formatViewCount(video.viewCount))).toBeInTheDocument();
  });

  it("clamps the title to two lines", () => {
    render(<VideoCardView video={video} now={NOW} />);
    const title = screen.getByRole("link", { name: video.title });
    expect(styleOf(title)).toContain("-webkit-line-clamp: 2");
    expect(styleOf(title)).toContain("-webkit-box");
  });
});

/* ---------------------------------------------------------- formatting --- */

describe("the metadata line uses the domain formatters", () => {
  /**
   * 1,240,000 is the value that separates the two ladders in
   * `src/domain/format.ts`: the view rule gives `1.2M` and the subscriber rule
   * gives `1.24M`. A card that hand-rolls its own abbreviation lands on one of
   * them and is visibly wrong on the other surface.
   */
  const video = makeVideo({ viewCount: 1_240_000 });

  it("writes views to two significant digits, not three", () => {
    render(<VideoCardView video={video} now={NOW} />);
    expect(screen.getByText("1.2M views")).toBeInTheDocument();
    expect(screen.getByText("1.2M views")).toHaveTextContent(
      formatViewCount(1_240_000),
    );
    expect(screen.queryByText("1.24M views")).toBeNull();
  });

  it("writes the publish date in full words on a card", () => {
    render(<VideoCardView video={video} now={NOW} />);
    const expected = formatRelativeTime(video.publishedAt as Date, NOW);
    expect(expected).toBe("10 months ago");
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("separates the two facts with the measured bullet", () => {
    const { container } = render(<VideoCardView video={video} now={NOW} />);
    const delimiter = container.querySelector("[data-meta-delimiter]");
    expect(delimiter).toHaveTextContent("•");
  });

  it("drops the delimiter along with an absent publish date", () => {
    const { container } = render(
      <VideoCardView video={makeVideo({ publishedAt: null })} now={NOW} />,
    );
    expect(container.querySelector("[data-meta-delimiter]")).toBeNull();
    expect(container.querySelector("[data-meta-views]")).not.toBeNull();
  });
});

/* --------------------------------------------------------- VideoRowView --- */

describe("VideoRowView — the watch sidebar", () => {
  const video = makeVideo({ viewCount: 858_000 });

  /**
   * R8 §8.2 calls this "the single most likely thing to get wrong from
   * memory": the same video, on the same page, formatted differently in the
   * sidebar than on a card.
   */
  it("drops the word 'views' and abbreviates the unit", () => {
    render(<VideoRowView video={video} density="sidebar" now={NOW} />);

    expect(screen.getByText(formatCompactCount(858_000))).toHaveTextContent("858K");
    expect(screen.queryByText("858K views")).toBeNull();

    const compact = formatCompactRelativeTime(video.publishedAt as Date, NOW);
    expect(compact).toBe("10mo ago");
    expect(screen.getByText(compact)).toBeInTheDocument();
    expect(screen.queryByText("10 months ago")).toBeNull();
  });

  it("renders the delimiter element with no bullet in it", () => {
    // Measured 0 × 0 with `margin: 0 4px` in
    // `research/extracted/player-chrome-and-sidebar.json`, and confirmed by
    // `screenshots/09-watch-1920.png`: `▷ 296K  2w ago`, no bullet.
    const { container } = render(
      <VideoRowView video={video} density="sidebar" now={NOW} />,
    );
    const delimiter = container.querySelector("[data-meta-delimiter]");
    expect(delimiter).not.toBeNull();
    expect(delimiter?.textContent).not.toContain("•");
  });

  it("clamps its title to three lines and hides the avatar", () => {
    const { container } = render(
      <VideoRowView video={video} density="sidebar" now={NOW} />,
    );
    expect(styleOf(screen.getByRole("link", { name: video.title }))).toContain(
      "-webkit-line-clamp: 3",
    );
    expect(container.querySelector("[data-card-avatar]")).toBeNull();
  });
});

describe("VideoRowView — search and history", () => {
  const video = makeVideo();

  it("gives the search result an 18px two-line title and a 24px avatar", () => {
    const { container } = render(
      <VideoRowView video={video} density="search" showAvatar now={NOW} />,
    );
    expect(styleOf(screen.getByRole("link", { name: video.title }))).toContain(
      "-webkit-line-clamp: 2",
    );
    expect(container.querySelector("[data-card-avatar]")).not.toBeNull();
    // R8 §3.6 and `screenshots/08-search-results-1920.png`: counts first,
    // channel second — the opposite order to the grid card.
    expect(screen.getByText(formatViewCount(video.viewCount))).toBeInTheDocument();
  });

  it("gives the history row one line of title and no date", () => {
    // R9 §6: a single metadata row, "channel • views". The date would repeat
    // the day heading the row already sits under.
    render(<VideoRowView video={video} density="history" now={NOW} />);
    expect(styleOf(screen.getByRole("link", { name: video.title }))).toContain(
      "-webkit-line-clamp: 1",
    );
    expect(screen.getByText(formatViewCount(video.viewCount))).toBeInTheDocument();
    expect(screen.queryByText("10 months ago")).toBeNull();
  });

  it("keeps the history thumbnail at the 8px radius, not the card's 12", () => {
    // R9 §2.3 is explicit that this is the one radius the horizontal variant
    // changes.
    const { container } = render(
      <VideoRowView video={video} density="history" now={NOW} />,
    );
    const thumb = container.querySelector("[data-thumbnail]");
    expect(thumb?.className).toContain("rounded-compact");
    expect(thumb?.className).not.toContain("rounded-cozy");
  });

  it("keeps its menu outside its link, at every density", async () => {
    const user = userEvent.setup();
    render(
      <VideoRowView
        video={video}
        density="history"
        now={NOW}
        menuItems={<MenuItem>Remove from history</MenuItem>}
      />,
    );
    const link = screen.getByRole("link", { name: video.title });
    const trigger = screen.getByRole("button", { name: `Actions for ${video.title}` });
    expect(link.contains(trigger)).toBe(false);

    await user.click(trigger);
    expect(link.contains(screen.getByRole("menu"))).toBe(false);
  });
});

/* ------------------------------------------------------------- motion ---- */

describe("no card animates", () => {
  /**
   * Every element sampled in
   * `research/extracted/theme-light-dark-hover-motion.json` — the lockup and
   * the thumbnail among them — computes `transition: all 0s ease`. R8 §6 lists
   * "card hover" as instant. A 150ms fade on a card you are scanning past is
   * exactly what makes a clone feel slower than the product, and it is the
   * kind of thing that gets added back by reflex.
   */
  it("carries no transition or animation utilities", () => {
    const { container } = render(<VideoCardView video={makeVideo()} now={NOW} />);
    const classes = Array.from(container.querySelectorAll("*"))
      .map((node) => node.className)
      .filter((name): name is string => typeof name === "string")
      .join(" ");
    expect(classes).not.toMatch(/\btransition\b|\banimate-|\bduration-\d/);
  });
});
