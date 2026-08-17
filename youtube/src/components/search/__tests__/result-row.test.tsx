import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import type { VideoCard } from "@/domain/types";

import {
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  SearchResultRow,
  type SearchChannelCard,
} from "../result-row";

/**
 * The two renderers, and the difference between them.
 *
 * `hit.kind` is the only thing that selects one, and the product's two rows
 * share almost nothing: a channel has no thumbnail, no duration badge and no
 * view count, and it has a handle and a subscriber count that a video does not.
 * A single renderer with optional halves would pass a "renders a row" test
 * while showing `No views` under a channel name.
 */

const NOW = new Date("2026-08-16T12:00:00Z");

function videoCard(overrides: Partial<VideoCard> = {}): VideoCard {
  return {
    id: "vid00000001",
    title: "How It's Made: Chocolate",
    channelId: "chn00000001",
    channelName: "Science Channel",
    channelHandle: "sciencechannel",
    channelAvatarKey: null,
    channelVerified: true,
    thumbnailKey: null,
    previewKey: null,
    durationSeconds: 632,
    viewCount: 318_000,
    publishedAt: new Date("2026-07-16T12:00:00Z"),
    isShort: false,
    watchedSeconds: null,
    ...overrides,
  };
}

function channelCard(
  overrides: Partial<SearchChannelCard> = {},
): SearchChannelCard {
  return {
    id: "chn00000001",
    handle: "HowItsMade8",
    name: "How It's Made",
    avatarUrl: null,
    verified: false,
    subscriberCount: 322_000,
    videoCount: 416,
    description: "Every episode, one factory floor.",
    ...overrides,
  };
}

describe("a video result", () => {
  it("renders the measured lockup — title, counts, channel", () => {
    render(
      <SearchResultRow
        item={{ kind: "video", video: videoCard(), highlight: null }}
        now={NOW}
      />,
    );

    expect(
      screen.getByRole("link", { name: "How It's Made: Chocolate" }),
    ).toHaveAttribute("href", "/watch?v=vid00000001");
    // The search density's own formatters: `318K views` and `1 month ago`,
    // not the sidebar's bare `318K` / `1mo ago`.
    expect(screen.getByText("318K views")).toBeInTheDocument();
    expect(screen.getByText("1 month ago")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Science Channel" })).toHaveAttribute(
      "href",
      "/@sciencechannel",
    );
  });

  it("renders the description snippet with the match marked", () => {
    const { container } = render(
      <SearchResultRow
        item={{
          kind: "video",
          video: videoCard(),
          highlight: `What sweet delight pairs well with ${HIGHLIGHT_START}chocolate${HIGHLIGHT_END}`,
        }}
        now={NOW}
      />,
    );

    expect(container.querySelector("[data-search-snippet]")).not.toBeNull();
    const mark = screen.getByText("chocolate");
    expect(mark.tagName).toBe("MARK");
  });

  /**
   * `highlight: null` is the normal case, not an error.
   *
   * The port says so and the adapter's `usableHighlight` explains why: a
   * title-only match makes `ts_headline` return the opening words of the
   * description with nothing marked, which is a fragment and not a highlight.
   * The row shows no snippet at all rather than an unmarked one.
   */
  it("shows no snippet when the match was title-only", () => {
    const { container } = render(
      <SearchResultRow
        item={{ kind: "video", video: videoCard(), highlight: null }}
        now={NOW}
      />,
    );

    expect(container.querySelector("[data-search-snippet]")).toBeNull();
    expect(container.querySelector("mark")).toBeNull();
  });

  it("uses the search density rather than the sidebar's", () => {
    const { container } = render(
      <SearchResultRow
        item={{ kind: "video", video: videoCard(), highlight: null }}
        now={NOW}
      />,
    );

    // The density carries the measured 419.5px thumbnail, the 18/26 title and
    // the counts-then-channel order. Asserting the attribute rather than the
    // pixels: the geometry is `video-row.tsx`'s and has its own tests.
    expect(container.querySelector("[data-video-row]")).toHaveAttribute(
      "data-density",
      "search",
    );
  });
});

describe("a channel result", () => {
  it("renders a channel, not a video", () => {
    render(
      <SearchResultRow
        item={{ kind: "channel", channel: channelCard(), highlight: null }}
        now={NOW}
      />,
    );

    expect(screen.getByRole("link", { name: "How It's Made" })).toHaveAttribute(
      "href",
      "/@HowItsMade8",
    );
    expect(screen.getByText("@HowItsMade8")).toBeInTheDocument();
    // Three significant digits — a subscriber count is not a view count.
    expect(screen.getByText("322K subscribers")).toBeInTheDocument();
    expect(screen.getByText("416 videos")).toBeInTheDocument();
  });

  it("has none of the video row's furniture", () => {
    const { container } = render(
      <SearchResultRow
        item={{ kind: "channel", channel: channelCard(), highlight: null }}
        now={NOW}
      />,
    );

    expect(container.querySelector("[data-video-row]")).toBeNull();
    expect(container.querySelector("[data-channel-row]")).not.toBeNull();
    expect(screen.queryByText(/views/)).toBeNull();
  });

  it("shows the tick only when the channel is verified, and says so in text", () => {
    const { container, rerender } = render(
      <SearchResultRow
        item={{ kind: "channel", channel: channelCard(), highlight: null }}
      />,
    );
    expect(container.querySelector("[data-channel-verified]")).toBeNull();
    expect(screen.queryByText("Verified")).toBeNull();

    rerender(
      <SearchResultRow
        item={{
          kind: "channel",
          channel: channelCard({ verified: true }),
          highlight: null,
        }}
      />,
    );
    expect(container.querySelector("[data-channel-verified]")).not.toBeNull();
    // The glyph is decorative; the fact reaches a screen reader as text.
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  it("prefers the marked fragment over the plain description", () => {
    render(
      <SearchResultRow
        item={{
          kind: "channel",
          channel: channelCard(),
          highlight: `one ${HIGHLIGHT_START}factory${HIGHLIGHT_END} floor`,
        }}
      />,
    );

    expect(screen.getByText("factory").tagName).toBe("MARK");
    expect(screen.queryByText("Every episode, one factory floor.")).toBeNull();
  });

  it("falls back to the description when there is no fragment", () => {
    render(
      <SearchResultRow
        item={{ kind: "channel", channel: channelCard(), highlight: null }}
      />,
    );
    expect(
      screen.getByText("Every episode, one factory floor."),
    ).toBeInTheDocument();
  });

  it("renders the trailing action only when one is supplied", () => {
    const { rerender } = render(
      <SearchResultRow
        item={{ kind: "channel", channel: channelCard(), highlight: null }}
      />,
    );
    // No invented Subscribe button: subscription state belongs to another
    // slice, and a button that does nothing is worse than an absent one.
    expect(screen.queryByRole("button")).toBeNull();

    rerender(
      <SearchResultRow
        item={{
          kind: "channel",
          channel: channelCard(),
          highlight: null,
          action: <button type="button">Subscribe</button>,
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeInTheDocument();
  });
});
