import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  HistoryControls,
  HistoryList,
  historyRowMenu,
  type HistoryDayView,
} from "@/components/history";
import { dayKeyInZone, formatDayHeading } from "@/domain/format";
import type { VideoCard } from "@/domain/types";

/**
 * Watch history.
 *
 * ## The day headings are built the way the repository builds them
 *
 * The fixtures below run real dates through `dayKeyInZone` and
 * `formatDayHeading` — the same two functions `adapters/repositories/history.ts`
 * uses — rather than hard-coding the strings. That is deliberate: a test that
 * asserted the literal `"Today"` would still pass if the page stopped using the
 * formatter and wrote its own, which is exactly the drift `domain/format.ts`
 * exists to prevent. It also means these tests state, in code, that the page's
 * headings and the repository's are the same function.
 *
 * `Today` and `Yesterday` are **measured** — R9 §6 records the day label
 * verbatim as «Today», «Yesterday», then a date. `formatDayHeading`'s own doc
 * comment calls them assumed on the grounds that R8 never captured the page;
 * R8 did not and R9 did, so that comment is stale. The *fallback date format*
 * is still an assumption, and nothing here asserts its exact shape.
 *
 * ## Grouping is asserted, not re-implemented
 *
 * `listHistory` groups; `HistoryList` renders what it is given. So these tests
 * assert that every day becomes one section with one heading, in the order
 * supplied, and that no row escapes its day — which is the whole of this
 * component's contract.
 */

const NOW = new Date("2026-08-16T12:00:00Z");
const YESTERDAY = new Date("2026-08-15T20:00:00Z");
const LAST_WEEK = new Date("2026-08-09T09:00:00Z");

function makeVideo(overrides: Partial<VideoCard> = {}): VideoCard {
  return {
    id: "v1",
    title: "Whatever You Hide As, You Keep!",
    channelId: "c1",
    channelName: "A Channel",
    channelHandle: "achannel",
    channelAvatarKey: null,
    channelVerified: false,
    thumbnailKey: "videos/v1/thumb.jpg",
    previewKey: null,
    durationSeconds: 1_460,
    viewCount: 14_000_000,
    publishedAt: new Date("2026-08-15T12:00:00Z"),
    isShort: false,
    watchedSeconds: null,
    ...overrides,
  };
}

/** A day section built the way `listHistory` builds one. */
function makeDay(watchedAt: Date, items: readonly VideoCard[]): HistoryDayView {
  return {
    dayKey: dayKeyInZone(watchedAt, "UTC"),
    heading: formatDayHeading(watchedAt, NOW, "UTC"),
    items,
  };
}

const DAYS: readonly HistoryDayView[] = [
  makeDay(NOW, [
    makeVideo({ id: "v1", title: "Watched today, first" }),
    makeVideo({ id: "v2", title: "Watched today, second" }),
  ]),
  makeDay(YESTERDAY, [makeVideo({ id: "v3", title: "Watched yesterday" })]),
  makeDay(LAST_WEEK, [makeVideo({ id: "v4", title: "Watched last week" })]),
];

/* ---------------------------------------------------------------- list --- */

describe("HistoryList", () => {
  it("renders one section per day, headed Today, Yesterday, then a date", () => {
    render(<HistoryList days={DAYS} now={NOW} />);

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((node) => node.textContent);
    expect(headings).toEqual([
      formatDayHeading(NOW, NOW, "UTC"),
      formatDayHeading(YESTERDAY, NOW, "UTC"),
      formatDayHeading(LAST_WEEK, NOW, "UTC"),
    ]);
    // The two that R9 §6 records verbatim.
    expect(headings[0]).toBe("Today");
    expect(headings[1]).toBe("Yesterday");
    // And the third is neither — a real date, whose format is the one thing
    // here that is assumed rather than measured.
    expect(headings[2]).not.toBe("Today");
    expect(headings[2]).not.toBe("Yesterday");
  });

  it("keeps each day's rows inside that day's section", () => {
    render(<HistoryList days={DAYS} now={NOW} />);

    const today = document.querySelector(
      `[data-history-day="${dayKeyInZone(NOW, "UTC")}"]`,
    );
    const yesterday = document.querySelector(
      `[data-history-day="${dayKeyInZone(YESTERDAY, "UTC")}"]`,
    );
    expect(today).not.toBeNull();
    expect(yesterday).not.toBeNull();

    expect(
      within(today as HTMLElement).getAllByRole("link", { name: /Watched today/ }),
    ).toHaveLength(2);
    expect(
      within(today as HTMLElement).queryByRole("link", {
        name: "Watched yesterday",
      }),
    ).toBeNull();
    expect(
      within(yesterday as HTMLElement).getByRole("link", {
        name: "Watched yesterday",
      }),
    ).toBeInTheDocument();
  });

  it("keys a section on its day, not on its heading", () => {
    // Two different days can share a heading only if the formatter breaks; the
    // key that survives that is the ISO day, which is also what sorts.
    render(<HistoryList days={DAYS} now={NOW} />);
    const keys = Array.from(document.querySelectorAll("[data-history-day]")).map(
      (node) => node.getAttribute("data-history-day"),
    );
    expect(keys).toEqual([
      dayKeyInZone(NOW, "UTC"),
      dayKeyInZone(YESTERDAY, "UTC"),
      dayKeyInZone(LAST_WEEK, "UTC"),
    ]);
    expect(keys[0]).toBe("2026-08-16");
  });

  it("renders the rows through the shared lockup at history density", () => {
    render(<HistoryList days={DAYS} now={NOW} />);
    const rows = document.querySelectorAll("[data-video-row]");
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.getAttribute("data-density")).toBe("history");
    }
  });

  it("gives a signed-out viewer an empty state, not an error and not rows", () => {
    render(<HistoryList days={[]} signedIn={false} />);
    expect(
      document.querySelector('[data-history-empty="signed-out"]'),
    ).not.toBeNull();
    expect(screen.getByText(/Sign in/)).toBeInTheDocument();
    expect(document.querySelectorAll("[data-video-row]")).toHaveLength(0);
  });

  it("prefers the sign-in prompt even if days somehow arrive while signed out", () => {
    // `listHistory` returns `[]` for a null viewer, so this cannot happen from
    // the page — but the component must not be the thing that leaks a list if
    // some other caller gets it wrong.
    render(<HistoryList days={DAYS} signedIn={false} />);
    expect(
      document.querySelector('[data-history-empty="signed-out"]'),
    ).not.toBeNull();
    expect(document.querySelectorAll("[data-video-row]")).toHaveLength(0);
  });

  it("distinguishes 'signed out' from 'nothing watched'", () => {
    render(<HistoryList days={[]} signedIn />);
    expect(document.querySelector('[data-history-empty="none"]')).not.toBeNull();
    expect(screen.getByText("No watch history")).toBeInTheDocument();
    expect(screen.queryByText(/Sign in/)).toBeNull();
  });

  it("gives every row the same menu when one is supplied, and none when it is not", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<HistoryList days={DAYS} now={NOW} />);
    expect(screen.queryAllByRole("button", { name: /^Actions for/ })).toHaveLength(
      0,
    );

    rerender(<HistoryList days={DAYS} now={NOW} rowMenu={historyRowMenu()} />);
    const kebabs = screen.getAllByRole("button", { name: /^Actions for/ });
    expect(kebabs).toHaveLength(4);

    await user.click(kebabs[0] as HTMLElement);
    const item = screen.getByRole("menuitem", {
      name: "Remove from watch history",
    });
    // The write lives in `watch-events.ts`, which is another slice and has no
    // per-event delete. A disabled row says so; an enabled one would lie.
    expect(item).toHaveAttribute("aria-disabled", "true");
  });
});

/* ---------------------------------------------------------------- rail --- */

describe("HistoryControls", () => {
  it("renders the three measured actions and the three indented sub-links", () => {
    render(<HistoryControls />);
    expect(
      screen.getByRole("button", { name: "Clear all watch history" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Pause watch history" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Manage all history" }),
    ).toBeInTheDocument();
    for (const label of ["Comments", "Posts", "Live chat"]) {
      expect(
        document.querySelector(`[data-history-sublink="${label}"]`),
      ).not.toBeNull();
    }
  });

  it("carries a search field over a rule rather than a boxed input", () => {
    render(<HistoryControls query="muons" />);
    const field = screen.getByLabelText("Search watch history");
    expect(field).toHaveValue("muons");
    expect(
      document.querySelector("[data-history-search]")?.className,
    ).toContain("border-b");
  });

  it("asks before clearing, and is honest that nothing was deleted", async () => {
    const user = userEvent.setup();
    render(<HistoryControls />);

    await user.click(screen.getByRole("button", { name: "Clear all watch history" }));
    expect(document.querySelector("[data-history-confirm]")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("status")).toHaveTextContent("nothing was deleted");
  });

  it("backs out of the confirm without saying anything happened", async () => {
    const user = userEvent.setup();
    render(<HistoryControls />);

    await user.click(screen.getByRole("button", { name: "Clear all watch history" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(document.querySelector("[data-history-confirm]")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("labels the pause control by its current state", () => {
    const { rerender } = render(<HistoryControls />);
    expect(
      screen.getByRole("button", { name: "Pause watch history" }),
    ).toHaveAttribute("aria-pressed", "false");

    rerender(<HistoryControls paused />);
    expect(
      screen.getByRole("button", { name: "Resume watch history" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("disables the actions a signed-out viewer cannot take", () => {
    render(<HistoryControls signedIn={false} />);
    expect(
      screen.getByRole("button", { name: "Clear all watch history" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Pause watch history" }),
    ).toBeDisabled();
  });
});
