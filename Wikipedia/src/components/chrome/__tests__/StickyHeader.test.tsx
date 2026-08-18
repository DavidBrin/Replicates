import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { StickyHeader } from "../StickyHeader";

/**
 * WCAG 4.1.2: the sticky bar hides itself with opacity/pointer-events, but
 * that alone leaves its link/input/button focusable while invisible.
 * `inert` (mirrored from the same `visible` state that drives `aria-hidden`)
 * must remove them from the tab order too.
 *
 * jsdom 30.0.1 (this project's pinned version, verified directly against
 * `require("jsdom").JSDOM`) does not implement the `inert` IDL property or
 * its focus-blocking behavior at all — `"inert" in document.createElement`
 * is `false` — so these tests assert the reflected HTML attribute rather
 * than relying on jsdom to actually enforce it.
 */
describe("StickyHeader", () => {
  it("carries the inert attribute at the initial (unscrolled, hidden) position", () => {
    render(<StickyHeader />);
    const bar = document.getElementById("vector-sticky-header")!;

    expect(bar.getAttribute("aria-hidden")).toBe("true");
    expect(bar.hasAttribute("inert")).toBe(true);
  });

  it("drops the inert attribute once scrolled past the reveal threshold", () => {
    render(<StickyHeader />);
    const bar = document.getElementById("vector-sticky-header")!;

    Object.defineProperty(window, "scrollY", { value: 400, configurable: true });
    fireEvent.scroll(window);

    expect(bar.getAttribute("aria-hidden")).toBe("false");
    expect(bar.hasAttribute("inert")).toBe(false);
  });

  it("keeps aria-hidden and inert consistent with each other in both states", () => {
    render(<StickyHeader />);
    const bar = document.getElementById("vector-sticky-header")!;

    expect(bar.getAttribute("aria-hidden") === "true").toBe(bar.hasAttribute("inert"));

    Object.defineProperty(window, "scrollY", { value: 400, configurable: true });
    fireEvent.scroll(window);

    expect(bar.getAttribute("aria-hidden") === "true").toBe(bar.hasAttribute("inert"));
  });
});
