import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import type { VideoCard } from "@/domain/types";

import { SIDEBAR_MIN_VIEWPORT, WatchSidebar } from "../sidebar";

/**
 * The related rail.
 *
 * There is one finding worth a test here, and it is a negative:
 * `research/08-youtube-ui-measured.md` §3.2 records that the sidebar **does not
 * stack below the player** at narrow widths in this build — `#secondary`
 * becomes non-rendering below 1000px and the related list disappears entirely.
 * Every clone reflows it into a column, which is the wrong behaviour measured
 * against the wrong breakpoint.
 *
 * `research/extracted/watch-sidebar-breakpoint.json` is marked `SUPERSEDED`
 * because an earlier pass recorded 1399/1400 for this. The corrected value is
 * what is asserted.
 */

const NOW = new Date("2026-08-16T12:00:00Z");

function card(id: string, title: string): VideoCard {
  return {
    id,
    title,
    channelId: "ch-1",
    channelName: "Science Channel",
    channelHandle: "sciencechannel",
    channelAvatarKey: null,
    channelVerified: true,
    thumbnailKey: null,
    previewKey: null,
    durationSeconds: 1191,
    viewCount: 858_000,
    publishedAt: new Date("2024-08-16T12:00:00Z"),
    isShort: false,
    watchedSeconds: null,
  };
}

const RELATED: readonly VideoCard[] = [
  card("v-a", "Learn the Secret Behind Irresistible Food Creations"),
  card("v-b", "How Ice Cream Cones, Waffles, Peanut Butter & More Are Made"),
];

describe("WatchSidebar", () => {
  it("is a labelled complementary region", () => {
    render(<WatchSidebar videos={RELATED} now={NOW} />);
    expect(screen.getByRole("complementary", { name: "Related videos" })).toBeInTheDocument();
  });

  it("renders one row per related video", () => {
    render(<WatchSidebar videos={RELATED} now={NOW} />);
    expect(document.querySelectorAll("[data-video-row]")).toHaveLength(2);
    expect(screen.getByText(RELATED[0]?.title ?? "")).toBeInTheDocument();
  });

  it("delegates to the shared lockup at its sidebar density", () => {
    // §3.4 measures the item at 528×185.63 with a 330px thumbnail, and
    // `VideoRowView`'s `sidebar` density already carries those numbers — along
    // with §8.2's third set of formatters (`858K`, `2y ago`), which is what
    // makes building a second card here actively wrong.
    render(<WatchSidebar videos={RELATED} now={NOW} />);
    const row = document.querySelector("[data-video-row]");
    expect(row).toHaveAttribute("data-density", "sidebar");
  });

  it("uses the sidebar's own compact formatters, not the card's", () => {
    // Same data, same page, different formatter — §8.2 calls this "the single
    // most likely thing to get wrong from memory".
    render(<WatchSidebar videos={RELATED} now={NOW} />);
    expect(screen.getAllByText("858K").length).toBe(2);
    expect(screen.getAllByText("2y ago").length).toBe(2);
    expect(screen.queryByText("858K views")).toBeNull();
  });

  it("disappears below 1000px rather than stacking under the player", () => {
    // §3.2, binary-searched: last px of hidden is 999, first px of shown is
    // 1000. Expressed as a class rather than a JS media query so the server's
    // markup is already correct — a JS breakpoint would render the rail and
    // then remove it on the client.
    render(<WatchSidebar videos={RELATED} now={NOW} />);
    const aside = screen.getByRole("complementary", { name: "Related videos" });
    expect(aside.className).toContain("hidden");
    expect(aside.className).toContain(`min-[${SIDEBAR_MIN_VIEWPORT}px]:block`);
  });

  it("drops the fixed column width in theatre, where it sits below the player", () => {
    // §3.4: in theatre `#secondary` moves to y=991 and is no longer a 528px
    // column beside anything.
    const { rerender } = render(<WatchSidebar videos={RELATED} now={NOW} />);
    const aside = () => screen.getByRole("complementary", { name: "Related videos" });
    expect(aside().style.width).not.toBe("");

    rerender(<WatchSidebar videos={RELATED} now={NOW} theatre />);
    expect(aside().style.width).toBe("");
  });

  it("renders an empty rail rather than failing on a cold corpus", () => {
    // The recommender's own note: a watch page whose sidebar is empty because
    // the corpus is young is the *common* case on a fresh install.
    render(<WatchSidebar videos={[]} now={NOW} />);
    expect(screen.getByRole("complementary", { name: "Related videos" })).toBeInTheDocument();
    expect(document.querySelectorAll("[data-video-row]")).toHaveLength(0);
  });
});
