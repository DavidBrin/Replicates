import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  COLLAPSED_AFFORDANCE,
  Description,
  EXPANDED_AFFORDANCE,
} from "../description";

/**
 * The description card.
 *
 * The interesting assertion is not "the text appears" — it is that the *same
 * two facts are formatted differently in the two states*.
 * `research/08-youtube-ui-measured.md` §8.1 records the collapsed info line as
 * `961K views  10 months ago` and the expanded panel as `961,368 views` beside
 * `Oct 7, 2025`. Comma grouping appears in exactly two places in the product
 * and this is one of them.
 */

const PUBLISHED = new Date("2025-10-07T12:00:00Z");
const NOW = new Date("2026-08-16T12:00:00Z");

function renderDescription(description = "A long description that runs on.") {
  render(
    <Description
      description={description}
      viewCount={961_368}
      publishedAt={PUBLISHED}
      now={NOW}
    />,
  );
}

describe("Description — collapsed", () => {
  it("abbreviates the view count and writes the age in words", () => {
    renderDescription();
    // §8.1's measured watch info line, exactly: the *card's* abbreviation, not
    // the exact figure. Getting this backwards is the easy mistake in the other
    // direction.
    expect(screen.getByText("961K views")).toBeInTheDocument();
    expect(screen.getByText("10 months ago")).toBeInTheDocument();
  });

  it("clamps the body and offers the measured affordance", () => {
    renderDescription();
    const body = document.querySelector("[data-description-body]") as HTMLElement;
    expect(body.className).toContain("line-clamp-2");
    // §8.3, verbatim: `...more`. Three periods and a word — not an ellipsis
    // character, not "Show more".
    expect(screen.getByRole("button", { name: COLLAPSED_AFFORDANCE })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

describe("Description — expanded", () => {
  it("switches to the exact, comma-grouped count and an absolute date", async () => {
    const user = userEvent.setup();
    renderDescription();
    await user.click(screen.getByRole("button", { name: COLLAPSED_AFFORDANCE }));

    // The whole point of the component: a formatter that runs once and reveals
    // is wrong on both of these lines.
    expect(screen.getByText("961,368 views")).toBeInTheDocument();
    expect(screen.getByText("Oct 7, 2025")).toBeInTheDocument();
    expect(screen.queryByText("961K views")).toBeNull();
    expect(screen.queryByText("10 months ago")).toBeNull();
  });

  it("unclamps the body and flips the affordance", async () => {
    const user = userEvent.setup();
    renderDescription();
    await user.click(screen.getByRole("button", { name: COLLAPSED_AFFORDANCE }));

    const body = document.querySelector("[data-description-body]") as HTMLElement;
    expect(body.className).not.toContain("line-clamp-2");
    expect(screen.getByRole("button", { name: EXPANDED_AFFORDANCE })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("collapses again", async () => {
    const user = userEvent.setup();
    renderDescription();
    await user.click(screen.getByRole("button", { name: COLLAPSED_AFFORDANCE }));
    await user.click(screen.getByRole("button", { name: EXPANDED_AFFORDANCE }));
    expect(screen.getByText("961K views")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: COLLAPSED_AFFORDANCE })).toBeInTheDocument();
  });

  it("keeps the description's own line breaks", async () => {
    const user = userEvent.setup();
    renderDescription("line one\nline two");
    await user.click(screen.getByRole("button", { name: COLLAPSED_AFFORDANCE }));
    const body = document.querySelector("[data-description-body]") as HTMLElement;
    // A description is written with newlines and rendering it as one paragraph
    // loses the chapter list every long video has.
    expect(body.className).toContain("whitespace-pre-wrap");
    expect(body.textContent).toBe("line one\nline two");
  });
});

describe("Description — a video with no publish date", () => {
  it("shows the count alone rather than an empty slot", () => {
    // An unpublished or scheduled video has `published_at = null`.
    render(
      <Description description="Draft" viewCount={0} publishedAt={null} now={NOW} />,
    );
    expect(screen.getByText("No views")).toBeInTheDocument();
    expect(document.querySelector("[data-description-when]")).toBeNull();
  });
});
