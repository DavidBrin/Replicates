import { useState } from "react";

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  ALL_CHIP_ID,
  ALL_CHIP_LABEL,
  FeedChipBar,
  feedTabId,
  type FeedChip,
} from "@/components/feed";

/**
 * The feed filter bar.
 *
 * jsdom has no layout engine, so every scroll extent reads zero and both
 * overflow arrows are always at their end — which is still the assertion worth
 * making, because "the control exists and is disabled" is the measured
 * behaviour and "the control is absent until you can use it" is the common
 * mistake. Everything else here is about state, semantics and the two measured
 * numbers that are easy to lose: **32px tall, 8px radius, not a pill**.
 */

const CHIPS: readonly FeedChip[] = [
  { id: ALL_CHIP_ID, label: ALL_CHIP_LABEL },
  { id: "c1", label: "Stackframe", videoIds: ["a", "b"] },
  { id: "c2", label: "The Patch Bay", videoIds: ["c"] },
];

const PANEL_ID = "feed-panel";

/**
 * The bar is controlled, so the harness owns the selection the way `HomeFeed`
 * does. `onSelect` is a spy *and* drives the state, so a test can assert both
 * the call and what the bar looks like afterwards.
 */
function Harness({
  chips = CHIPS,
  onSelect = vi.fn(),
}: {
  chips?: readonly FeedChip[];
  onSelect?: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState(ALL_CHIP_ID);
  return (
    <FeedChipBar
      chips={chips}
      selectedId={selectedId}
      panelId={PANEL_ID}
      onSelect={(id) => {
        onSelect(id);
        setSelectedId(id);
      }}
    />
  );
}

function tablist(): HTMLElement {
  return screen.getByRole("tablist");
}

/* ------------------------------------------------------------- geometry --- */

describe("the measured chip", () => {
  /**
   * R9 §2.2 and `research/extracted/chips-and-miniguide.json`: `.ytChipShapeChip`
   * is `height: 32px`, `border-radius: 8px`, `padding: 0 12px`. Every other
   * rounded control in this system is a pill — a 40px button has a 20px radius
   * — which is exactly why the chip gets rebuilt as one from memory.
   */
  it("is 32px tall with an 8px radius, and is not a pill", () => {
    render(<Harness />);
    const chip = screen.getByRole("tab", { name: ALL_CHIP_LABEL });

    expect(chip.className).toContain("h-8");
    expect(chip.className).toContain("rounded-compact");
    expect(chip.className).not.toContain("rounded-full");
    expect(chip.className).toContain("px-3");
  });

  /**
   * The bar is 56px with a 12px gap, which is the arithmetic of the measured
   * chip margin `12px 12px 12px 0`: 12 + 32 + 12 = 56, and the gap between two
   * chips is one 12px margin rather than two.
   */
  it("sits in a 56px bar with a 12px gap", () => {
    render(<Harness />);
    expect(tablist().className).toContain("h-14");
    expect(tablist().className).toContain("gap-3");
  });

  /**
   * Selected and unselected are a fill *inversion*, not a tint: the measured
   * active chip is `bg #0f0f0f / color #f1f1f1` in the light capture, which is
   * `inverted-background` with `text-primary-inverse`; inactive is
   * `additive-background`.
   */
  it("inverts the fill between states rather than tinting it", () => {
    render(<Harness />);
    expect(
      screen.getByRole("tab", { name: ALL_CHIP_LABEL }).className,
    ).toContain("bg-inverted");
    expect(screen.getByRole("tab", { name: "Stackframe" }).className).toContain(
      "bg-additive",
    );
  });

  /**
   * `#chips-wrapper` is `position: fixed` at `z-index: 2019`, directly under
   * the 56px masthead. Sticky is the CSS-native expression of the same result
   * — see the file header for why the product needs `fixed` and this does not.
   * The paint is the part that is *not* measured and matters: forty cards
   * scroll underneath, and a transparent bar shows them through.
   */
  it("is pinned under the masthead and painted", () => {
    const { container } = render(<Harness />);
    const bar = container.querySelector<HTMLElement>("[data-chip-bar]");

    expect(bar?.className).toContain("sticky");
    expect(bar?.className).toContain("top-[var(--yt-masthead-height)]");
    expect(bar?.className).toContain("z-[2019]");
    expect(bar?.className).toContain("bg-base");
  });
});

/* ------------------------------------------------------------ selection --- */

describe("selection", () => {
  it("starts on All, which is always the first chip", () => {
    render(<Harness />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveTextContent(ALL_CHIP_LABEL);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
  });

  it("reports the chip that was clicked and moves the selection to it", async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);

    await userEvent.click(screen.getByRole("tab", { name: "The Patch Bay" }));

    expect(onSelect).toHaveBeenCalledWith("c2");
    expect(screen.getByRole("tab", { name: "The Patch Bay" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: ALL_CHIP_LABEL })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });
});

/* -------------------------------------------------------- the tab pattern -- */

describe("the tab pattern the measured markup commits to", () => {
  /**
   * The captured chip is `<button role="tab" aria-selected>` inside the filter
   * bar, so the bar is a tablist — and a tablist owes one tab stop for the
   * whole set. R9 §4 counted 21 chips in one session; without this, reaching
   * the grid from the search box is 21 presses of Tab.
   */
  it("gives the whole bar one tab stop", () => {
    render(<Harness />);
    const stops = screen
      .getAllByRole("tab")
      .filter((tab) => tab.getAttribute("tabindex") === "0");

    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveTextContent(ALL_CHIP_LABEL);
  });

  it("moves the selection with the arrow keys, and to the ends with Home and End", async () => {
    render(<Harness />);
    const all = screen.getByRole("tab", { name: ALL_CHIP_LABEL });
    all.focus();

    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Stackframe" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await userEvent.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "The Patch Bay" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: ALL_CHIP_LABEL })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("stops at the ends rather than wrapping", async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    screen.getByRole("tab", { name: ALL_CHIP_LABEL }).focus();

    await userEvent.keyboard("{ArrowLeft}");

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: ALL_CHIP_LABEL })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  /**
   * A `role="tab"` announcing a selection state has to say what it selects,
   * and the panel has to point back at whichever tab is current. The two ids
   * come from one exported function so they cannot drift — an
   * `aria-labelledby` that resolves to nothing is invisible until somebody
   * runs a screen reader.
   */
  it("wires each tab to the panel it filters", () => {
    render(<Harness />);
    const chip = screen.getByRole("tab", { name: "Stackframe" });

    expect(chip).toHaveAttribute("aria-controls", PANEL_ID);
    expect(chip).toHaveAttribute("id", feedTabId(PANEL_ID, "c1"));
  });
});

/* ------------------------------------------------------ overflow arrows --- */

describe("the overflow affordance", () => {
  /**
   * Measured at 56×56 at each end of the bar, labelled `Previous` / `Next`
   * (R8 §7, and `home-1920.json` puts `#right-arrow-button` at x=1864 against
   * a column ending at 1920). They stay in the DOM and go `disabled` at their
   * end for the same reason the card's kebab is always rendered: a control
   * that appears only when it is usable moves the ones beside it, and one that
   * appears only on hover cannot be reached by keyboard or by touch.
   */
  it("keeps both arrows in the DOM, disabled where there is nothing to scroll to", () => {
    render(<Harness />);

    const previous = screen.getByRole("button", { name: "Previous" });
    const next = screen.getByRole("button", { name: "Next" });

    // jsdom reports a zero scroll extent, so both ends are true here.
    expect(previous).toBeDisabled();
    expect(next).toBeDisabled();
    expect(previous.className).toContain("size-14");
    expect(next.className).toContain("size-14");
  });
});
