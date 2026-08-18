import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Toc, nextActiveId, TOP_BOUNDARY_PX } from "../Toc";

describe("Toc", () => {
  it("renders nothing when there are no sections", () => {
    const { container } = render(<Toc sections={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("always lists (Top) first, followed by the given sections in order", () => {
    render(
      <Toc
        sections={[
          { id: "History", heading: "History" },
          { id: "Reception", heading: "Reception" },
        ]}
      />,
    );

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["(Top)", "History", "Reception"]);
  });

  it("links each entry to its section anchor", () => {
    render(<Toc sections={[{ id: "History", heading: "History" }]} />);
    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("href", "#History");
    expect(screen.getByRole("link", { name: "(Top)" })).toHaveAttribute("href", "#top");
  });
});

describe("nextActiveId", () => {
  const ids = ["History", "Reception"];

  function state(entries: Record<string, number>): Map<string, number> {
    return new Map(Object.entries(entries));
  }

  // The rule (scrollspy, as Vector 2022 behaves): active = the LAST heading
  // at or above the anchor boundary (TOP_BOUNDARY_PX, sticky header 50px +
  // 8px margin = 58). No heading there yet -> "" i.e. "(Top)". This replaced
  // an IntersectionObserver band model twice patched for staleness: an
  // instant hash jump produced no observer events at all, and a heading
  // landing subpixel-under the boundary was neither "intersecting" nor
  // cleanly passed, so the highlight never moved.

  it("activates the last heading at or above the boundary", () => {
    const s = state({ History: -400, Reception: 40 });
    expect(nextActiveId(ids, s)).toBe("Reception");
  });

  it("keeps the earlier section active while the next heading is still below the boundary", () => {
    const s = state({ History: -400, Reception: 300 });
    expect(nextActiveId(ids, s)).toBe("History");
  });

  it("clears to (Top) when every heading is below the boundary", () => {
    const s = state({ History: 70, Reception: 300 });
    expect(nextActiveId(ids, s)).toBe("");
  });

  // An anchor jump lands the target at exactly scroll-margin-top (= the
  // boundary), which the browser may report fractionally under it — the +1
  // tolerance must count that as arrived (the codex round-6 e2e failure).
  it("counts a heading landed exactly on the boundary as arrived", () => {
    const s = state({ History: -200, Reception: TOP_BOUNDARY_PX + 0.4 });
    expect(nextActiveId(ids, s)).toBe("Reception");
  });

  it("treats a heading within the sticky header's footprint (top=40) as passed", () => {
    const s = state({ History: 40, Reception: 300 });
    expect(nextActiveId(ids, s)).toBe("History");
  });

  it("skips headings with no measurement yet", () => {
    const s = state({ History: -10 });
    expect(nextActiveId(ids, s)).toBe("History");
  });

  it("returns (Top) for an empty state", () => {
    expect(nextActiveId(ids, new Map())).toBe("");
  });
});
