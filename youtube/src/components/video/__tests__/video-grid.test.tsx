import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MenuItem } from "@/components/primitives";
import { Shelf, VideoGrid } from "@/components/video";
import type { VideoCard } from "@/domain/types";

/**
 * The grid and the shelf.
 *
 * The interesting assertions here are about a *mechanism* rather than about
 * rendered pixels, because the mechanism is what a rebuild gets wrong: jsdom
 * has no layout engine and no container-query support, so the only honest way
 * to test "3 columns at 1680px of content" is to check that the grid reads the
 * variable the measured band table publishes, and that the band table still
 * says what R8 §3.3 measured.
 */

const NOW = new Date("2026-08-16T12:00:00Z");

function makeVideo(id: string, overrides: Partial<VideoCard> = {}): VideoCard {
  return {
    id,
    title: `Video ${id}`,
    channelId: "c1",
    channelName: "Captain Discovery",
    channelHandle: "captaindiscovery",
    channelAvatarKey: null,
    channelVerified: false,
    thumbnailKey: `videos/${id}/thumb.jpg`,
    previewKey: null,
    durationSeconds: 1_821,
    viewCount: 961_368,
    publishedAt: new Date("2025-10-16T12:00:00Z"),
    isShort: false,
    watchedSeconds: null,
    ...overrides,
  };
}

const VIDEOS = [makeVideo("a"), makeVideo("b"), makeVideo("c")];

function gridOf(container: HTMLElement): HTMLElement {
  const node = container.querySelector<HTMLElement>("[data-video-grid]");
  if (!node) throw new Error("no grid rendered");
  return node;
}

/* ----------------------------------------------------- the column count --- */

describe("VideoGrid — columns follow the content column, not the viewport", () => {
  /**
   * The measurement this exists for (R8 §3.3): **1920px gives 3 columns with
   * the guide expanded and 4 with it collapsed**. A viewport media query is
   * wrong at every width the user can toggle the rail, which is all of them.
   */
  it("reads the container query's variable rather than computing a count", () => {
    const { container } = render(<VideoGrid videos={VIDEOS} now={NOW} />);
    expect(gridOf(container).getAttribute("style")).toContain(
      "repeat(var(--yt-grid-columns, 1), minmax(0, 1fr))",
    );
  });

  it("carries no breakpoint utilities of its own", () => {
    // The failure mode this guards: someone adds `md:grid-cols-2 lg:grid-cols-3`
    // "to make it responsive", and the grid now disagrees with the rail on
    // every toggle while looking fine in a screenshot.
    const { container } = render(<VideoGrid videos={VIDEOS} now={NOW} />);
    expect(gridOf(container).className).not.toMatch(/(sm|md|lg|xl|2xl):/);
    expect(gridOf(container).className).not.toMatch(/grid-cols-/);
  });

  it("uses the measured gaps, both of which are tokens", () => {
    const { container } = render(<VideoGrid videos={VIDEOS} now={NOW} />);
    const style = gridOf(container).getAttribute("style") ?? "";
    // 16px, dropping to 8px at ≤571px of content — the narrow mode R8 §3.3
    // records as a layout change rather than a column change.
    expect(style).toContain("--yt-grid-current-item-margin");
    // `--ytd-rich-grid-row-margin: 32px`, the item's declared bottom margin.
    expect(style).toContain("--yt-grid-row-margin");
  });

  it("lets a surface pin a literal count", () => {
    // R9 §4 measures the playlists index at a hard 4 rather than a derived one.
    const { container } = render(<VideoGrid videos={VIDEOS} columns={4} now={NOW} />);
    expect(gridOf(container).getAttribute("style")).toContain(
      "repeat(4, minmax(0, 1fr))",
    );
  });
});

/* ------------------------------------------------- the measured bands ----- */

describe("the band table the grid depends on", () => {
  /**
   * `src/app/globals.css` is the design slice's file and the single source of
   * the column bands. This grid reuses it rather than owning a second copy, so
   * the contract worth asserting is that the bands still match what R8 §3.3
   * measured and what the design slice bisected to the pixel.
   *
   * The numbers: 1 column below 572px of content, 2 from 572 (bisected
   * 571 → 572), 3 from 890 (bisected at the viewport as 961 → 962 behind the
   * 72px mini rail), 4 from 1848 — the last being an upper bound rather than a
   * bisected edge, which the CSS says so in its own comment.
   */
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

  it("still publishes --yt-grid-columns from a container query on the content column", () => {
    expect(css).toContain("container-name: yt-content");
    expect(css).toContain("container-type: inline-size");
  });

  it("matches the measured breakpoints", () => {
    const bands = [...css.matchAll(/@container yt-content \(min-width: (\d+)px\)/g)]
      .map((match) => Number(match[1]));
    expect(bands).toEqual([572, 890, 1848]);
  });

  it("keeps the base state at one column with the narrow item margin", () => {
    expect(css).toMatch(/--yt-grid-columns:\s*1/);
    expect(css).toMatch(
      /--yt-grid-current-item-margin:\s*var\(--yt-grid-item-margin-narrow\)/,
    );
  });

  /**
   * The width formula, checked against three of R8 §3.3's captured rows. This
   * is not testing code — it is recording that CSS Grid with a 16px column gap
   * reproduces the product's `flex-wrap` + `margin: 0 8px` geometry exactly, so
   * that the choice of Grid stays justified rather than merely convenient.
   */
  it("reproduces the measured item widths", () => {
    const itemWidth = (content: number, columns: number, gap = 16): number =>
      (content - (columns - 1) * gap) / columns;

    // 1920, guide expanded: 1680 of content less the 24px page inset each side.
    expect(itemWidth(1632, 3)).toBeCloseTo(533.33, 2);
    // 1920, guide collapsed to the mini rail: 1848 less the same inset.
    expect(itemWidth(1800, 4)).toBe(438);
    // 1024, mini rail: 952 less the inset. Measured 290.66.
    expect(itemWidth(904, 3)).toBeCloseTo(290.66, 1);
  });
});

/* ------------------------------------------------------------- plumbing --- */

describe("VideoGrid — what it hands each card", () => {
  it("renders one card per video", () => {
    render(<VideoGrid videos={VIDEOS} now={NOW} />);
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  it("resolves per-video callbacks before they reach a client card", () => {
    // The seam that makes this grid server-safe: it runs `renderMenu` and
    // `hrefFor` itself and passes a plain node and a plain string on, because
    // a function cannot cross the RSC boundary into `VideoCardView`.
    render(
      <VideoGrid
        videos={VIDEOS}
        now={NOW}
        hrefFor={(video) => `/watch/${video.id}`}
        renderMenu={(video) => <MenuItem>{`Save ${video.id}`}</MenuItem>}
      />,
    );

    expect(screen.getByRole("link", { name: "Video a" })).toHaveAttribute(
      "href",
      "/watch/a",
    );
    expect(screen.getAllByRole("button", { name: /Actions for/ })).toHaveLength(3);
  });

  it("propagates the channel-context flags to every card", () => {
    const { container } = render(
      <VideoGrid videos={VIDEOS} showAvatar={false} showChannel={false} now={NOW} />,
    );
    expect(container.querySelectorAll("[data-card-avatar]")).toHaveLength(0);
    expect(screen.queryByRole("link", { name: "Captain Discovery" })).toBeNull();
  });

  it("renders trailing children in the grid flow, where the continuation sits", () => {
    const { container } = render(
      <VideoGrid videos={VIDEOS} now={NOW}>
        <div data-continuation="" />
      </VideoGrid>,
    );
    const grid = gridOf(container);
    const sentinel = grid.querySelector("[data-continuation]");
    expect(sentinel).not.toBeNull();
    expect(grid.lastElementChild).toBe(sentinel);
  });
});

/* ---------------------------------------------------------------- shelf --- */

describe("Shelf", () => {
  it("heads the row at the measured 15px/700 and scrolls horizontally", () => {
    const { container } = render(<Shelf title="Shorts" videos={VIDEOS} now={NOW} />);

    const heading = screen.getByRole("heading", { name: "Shorts" });
    expect(heading.tagName).toBe("H2");
    expect(heading.className).toContain("text-shelf");
    expect(heading.className).toContain("var(--yt-weight-bold)");

    const scroller = container.querySelector("[data-shelf-scroller]");
    expect(scroller?.className).toContain("overflow-x-auto");
  });

  it("sizes items as a fraction of the shelf, not at a fixed width", () => {
    // The measured shelves declare `elements-per-row` — 3, 4 and 5 across the
    // three captured surfaces — and let the width fall out of it (R9 §5, §7).
    const { container } = render(
      <Shelf title="Most relevant" videos={VIDEOS} itemsPerRow={3} now={NOW} />,
    );
    const first = container.querySelector("[data-shelf-item]");
    expect(first?.getAttribute("style")).toContain(
      "calc((100% - 2 * var(--yt-size-compact)) / 3)",
    );
  });

  it("keeps both arrows in the DOM and disabled at the ends", () => {
    // A control that only exists on hover is unreachable by keyboard and by
    // touch, which is why these are disabled rather than unmounted. jsdom
    // reports zero scroll extent, so both ends are true here.
    render(<Shelf title="Shorts" videos={VIDEOS} now={NOW} />);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("takes pre-rendered children when a surface needs per-item menus", () => {
    // `Shelf` is a client component, so it cannot take a `renderMenu`
    // callback from a server page; composition is the supported route.
    render(
      <Shelf title="Playlists">
        <div data-custom="">one</div>
        <div data-custom="">two</div>
      </Shelf>,
    );
    expect(document.querySelectorAll("[data-shelf-item]")).toHaveLength(2);
    expect(document.querySelectorAll("[data-custom]")).toHaveLength(2);
  });
});
