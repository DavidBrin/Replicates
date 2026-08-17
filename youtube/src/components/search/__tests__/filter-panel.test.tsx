import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SearchFilterPanel } from "../filter-panel";
import { EMPTY_QUERY_STATE, type SearchQueryState } from "../search-results";

/**
 * The filter panel.
 *
 * Every option is a link, so the assertions here are about `href`s. That is
 * deliberate rather than convenient: the requirement is that a filtered search
 * is shareable and that back and forward work, and an `href` is the only thing
 * that proves both. A test that clicked a button and asserted a `router.push`
 * would pass against an implementation with no URL in it at all.
 */

function state(overrides: Partial<SearchQueryState> = {}): SearchQueryState {
  return { ...EMPTY_QUERY_STATE, text: "rust", ...overrides };
}

async function open(initial: SearchQueryState = state()): Promise<void> {
  render(<SearchFilterPanel state={initial} />);
  await userEvent.click(screen.getByRole("button", { name: "Search filters" }));
}

function group(heading: string): HTMLElement {
  return screen.getByRole("region", { name: heading });
}

describe("the trigger", () => {
  it("is collapsed until asked, as the product's is", () => {
    render(<SearchFilterPanel state={state()} />);

    const trigger = screen.getByRole("button", { name: "Search filters" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Upload date" })).toBeNull();
    // The visible label is `Filters`; the accessible name is the measured
    // `Search filters`, which is what the capture records on the button.
    expect(trigger).toHaveTextContent("Filters");
  });

  it("opens and closes the panel it points at", async () => {
    render(<SearchFilterPanel state={state()} />);
    const trigger = screen.getByRole("button", { name: "Search filters" });

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(group("Upload date")).toBeInTheDocument();

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Upload date" })).toBeNull();
  });

  it("names the panel it controls", async () => {
    render(<SearchFilterPanel state={state()} defaultOpen />);
    const trigger = screen.getByRole("button", { name: "Search filters" });
    const panelId = trigger.getAttribute("aria-controls");

    expect(panelId).not.toBeNull();
    expect(document.getElementById(panelId ?? "")).not.toBeNull();
  });
});

describe("each group reaches the adapter through the URL", () => {
  it("upload date", async () => {
    await open();

    expect(
      within(group("Upload date")).getByRole("link", { name: "This week" }),
    ).toHaveAttribute("href", "/results?search_query=rust&uploaded=week");
    expect(
      within(group("Upload date")).getByRole("link", { name: "Last hour" }),
    ).toHaveAttribute("href", "/results?search_query=rust&uploaded=hour");
  });

  it("type", async () => {
    await open();

    expect(
      within(group("Type")).getByRole("link", { name: "Video" }),
    ).toHaveAttribute("href", "/results?search_query=rust&type=video");
    expect(
      within(group("Type")).getByRole("link", { name: "Channel" }),
    ).toHaveAttribute("href", "/results?search_query=rust&type=channel");
  });

  /**
   * `playlist` is a legal `SearchDocumentKind` and there is deliberately no
   * option for it: nothing indexes a playlist, so the control could only ever
   * return zero results, which reads as a broken search rather than an empty
   * category.
   */
  it("offers no type the index cannot answer", async () => {
    await open();
    expect(within(group("Type")).queryByRole("link", { name: /playlist/i })).toBeNull();
  });

  it("duration", async () => {
    await open();
    const durations = group("Duration");

    expect(
      within(durations).getByRole("link", { name: "Under 4 minutes" }),
    ).toHaveAttribute("href", "/results?search_query=rust&duration=under4");
    expect(
      within(durations).getByRole("link", { name: "4 – 20 minutes" }),
    ).toHaveAttribute("href", "/results?search_query=rust&duration=4to20");
    expect(
      within(durations).getByRole("link", { name: "Over 20 minutes" }),
    ).toHaveAttribute("href", "/results?search_query=rust&duration=over20");
  });

  it("sort", async () => {
    await open();
    const sorts = group("Sort by");

    expect(
      within(sorts).getByRole("link", { name: "Upload date" }),
    ).toHaveAttribute("href", "/results?search_query=rust&sort=date");
    expect(
      within(sorts).getByRole("link", { name: "View count" }),
    ).toHaveAttribute("href", "/results?search_query=rust&sort=views");
    expect(within(sorts).getByRole("link", { name: "Rating" })).toHaveAttribute(
      "href",
      "/results?search_query=rust&sort=rating",
    );
    // The default is the value that is never written into the URL.
    expect(
      within(sorts).getByRole("link", { name: "Relevance" }),
    ).toHaveAttribute("href", "/results?search_query=rust");
  });

  it("keeps the filters already in effect when adding another", async () => {
    await open(state({ duration: "over20", sort: "date" }));

    expect(
      within(group("Type")).getByRole("link", { name: "Video" }),
    ).toHaveAttribute(
      "href",
      "/results?search_query=rust&sort=date&type=video&duration=over20",
    );
  });
});

describe("the active option", () => {
  it("is marked as the current one", async () => {
    await open(state({ duration: "under4" }));

    const active = within(group("Duration")).getByRole("link", {
      name: "Under 4 minutes",
    });
    expect(active).toHaveAttribute("aria-current", "true");
    expect(
      within(group("Duration")).getByRole("link", { name: "Over 20 minutes" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("clears the filter when clicked again, so the group needs no reset", async () => {
    await open(state({ uploaded: "today" }));

    expect(
      within(group("Upload date")).getByRole("link", { name: "Today" }),
    ).toHaveAttribute("href", "/results?search_query=rust");
  });

  /**
   * Sort is the exception: one is always in effect, so clicking the active one
   * has to be a no-op rather than a jump back to relevance nobody asked for.
   */
  it("does not toggle off for sort", async () => {
    await open(state({ sort: "views" }));

    const active = within(group("Sort by")).getByRole("link", {
      name: "View count",
    });
    expect(active).toHaveAttribute("aria-current", "true");
    expect(active).toHaveAttribute("href", "/results?search_query=rust&sort=views");
  });
});

describe("clear all", () => {
  it("appears only when something is filtering", async () => {
    render(<SearchFilterPanel state={state()} defaultOpen />);
    expect(screen.queryByRole("link", { name: "Clear all filters" })).toBeNull();
  });

  it("drops every filter and keeps the query and the sort", async () => {
    render(
      <SearchFilterPanel
        state={state({ kind: "video", uploaded: "year", duration: "under4", sort: "date" })}
        defaultOpen
      />,
    );

    expect(
      screen.getByRole("link", { name: "Clear all filters" }),
    ).toHaveAttribute("href", "/results?search_query=rust&sort=date");
  });
});
