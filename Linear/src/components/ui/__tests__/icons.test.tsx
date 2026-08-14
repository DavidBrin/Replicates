import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  StatusIcon,
  WEDGE_CIRCUMFERENCE,
  startedStateProgress,
} from "@/components/ui/icons/status-icon";
import { PriorityIcon } from "@/components/ui/icons/priority-icon";
import { ProgressDonut } from "@/components/ui/progress-donut";
import { STATE_TYPES, PRIORITY_VALUES } from "@/domain/entities";

/**
 * These assert the *geometry*, not the rendering.
 *
 * A snapshot would pass on any change that both the component and the snapshot
 * agreed on, which is exactly the failure mode here: the values below were
 * transcribed from Linear's shipped SVG, and the thing worth protecting is that
 * they still equal what was transcribed. So each test names the measurement it
 * is defending.
 */

function svgOf(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("no svg rendered");
  return svg as SVGSVGElement;
}

describe("StatusIcon", () => {
  it("renders a distinct glyph for every state type", () => {
    // Not a coverage ritual: adding a state type without a glyph would render
    // an empty 14px box in every row, and nothing else would fail.
    for (const type of STATE_TYPES) {
      const { container, unmount } = render(<StatusIcon type={type} />);
      expect(svgOf(container).getAttribute("data-status-type")).toBe(type);
      expect(container.querySelectorAll("circle, path").length).toBeGreaterThan(0);
      unmount();
    }
  });

  it("draws Backlog as a dashed ring and Todo as a solid one", () => {
    const { container: backlog } = render(<StatusIcon type="backlog" />);
    const { container: todo } = render(<StatusIcon type="unstarted" />);

    // Dash 1.4 / gap 1.74 — period π, which is exactly 12 dashes at r=6.
    expect(
      backlog.querySelector("circle")?.getAttribute("stroke-dasharray"),
    ).toBe("1.4 1.74");
    // "3.14 0" is a zero-gap dash array: a solid stroke from the same component.
    expect(todo.querySelector("circle")?.getAttribute("stroke-dasharray")).toBe(
      "3.14 0",
    );
  });

  it("offsets the wedge by A × (1 − progress), with A = 2π × 1.94", () => {
    expect(WEDGE_CIRCUMFERENCE).toBeCloseTo(12.189379495928398, 12);

    const { container } = render(<StatusIcon type="started" progress={0.75} />);
    const wedge = container.querySelectorAll("circle")[1];

    // Linear's own shipped value for a 75% state ("In Review").
    expect(Number(wedge?.getAttribute("stroke-dashoffset"))).toBeCloseTo(
      3.0473448739820994,
      12,
    );
    expect(wedge?.getAttribute("stroke-dasharray")).toBe(
      `${WEDGE_CIRCUMFERENCE} ${2 * WEDGE_CIRCUMFERENCE}`,
    );
    // Rotated so the wedge starts at twelve o'clock, not at three.
    expect(wedge?.getAttribute("transform")).toBe("rotate(-90 7 7)");
  });

  it("leaves the wedge empty for every non-started type", () => {
    for (const type of ["backlog", "unstarted"] as const) {
      const { container, unmount } = render(
        // A stray progress value must not leak into a state that has no
        // progress: a Todo issue with a half-filled ring reads as In Progress.
        <StatusIcon type={type} progress={0.9} />,
      );
      const wedge = container.querySelectorAll("circle")[1];
      expect(Number(wedge?.getAttribute("stroke-dashoffset"))).toBeCloseTo(
        WEDGE_CIRCUMFERENCE,
        12,
      );
      unmount();
    }
  });

  it("punches the terminal glyphs out of the disc instead of painting them on", () => {
    // The knockout is what survives a background change. A white check over an
    // indigo disc looks right on one surface and wrong on hover.
    for (const type of ["completed", "canceled", "triage"] as const) {
      const { container, unmount } = render(<StatusIcon type={type} />);
      const path = container.querySelector("path");
      expect(path?.getAttribute("fill-rule")).toBe("evenodd");
      expect(container.querySelectorAll("circle")).toHaveLength(0);
      unmount();
    }
  });

  it("names itself by state, and goes silent when decorative", () => {
    render(<StatusIcon type="started" />);
    expect(screen.getByRole("img", { name: "In Progress" })).toBeInTheDocument();

    const { container } = render(
      <StatusIcon type="started" label="In Review" decorative />,
    );
    expect(svgOf(container)).toHaveAttribute("aria-hidden", "true");
  });

  it("clamps a progress value that arrives out of range", () => {
    const { container } = render(<StatusIcon type="started" progress={4} />);
    const wedge = container.querySelectorAll("circle")[1];
    expect(Number(wedge?.getAttribute("stroke-dashoffset"))).toBeCloseTo(0, 12);
  });
});

describe("startedStateProgress", () => {
  it("gives a lone started state a half-filled wedge", () => {
    expect(startedStateProgress(0, 1)).toBe(0.5);
  });

  it("gives two started states 50% and 75%, not thirds", () => {
    // The general formula would say ⅓ and ⅔. Linear special-cases this, and
    // "In Progress" + "In Review" is the common workflow, so the special case
    // is what most workspaces actually see.
    expect(startedStateProgress(0, 2)).toBe(0.5);
    expect(startedStateProgress(1, 2)).toBe(0.75);
  });

  it("spreads three or more evenly across (1 / n+1) steps", () => {
    expect(startedStateProgress(0, 3)).toBeCloseTo(0.25, 12);
    expect(startedStateProgress(1, 3)).toBeCloseTo(0.5, 12);
    expect(startedStateProgress(2, 3)).toBeCloseTo(0.75, 12);
  });
});

describe("PriorityIcon", () => {
  it("renders a glyph and an accessible name for every priority", () => {
    const names = ["No priority", "Urgent", "High", "Medium", "Low"];
    for (const priority of PRIORITY_VALUES) {
      const { unmount } = render(<PriorityIcon priority={priority} />);
      expect(
        screen.getByRole("img", { name: names[priority] }),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it("dims two bars for Low and one for Medium", () => {
    // The research lane calls a single-dimmed Low "a common clone error".
    const dimmed = (priority: 2 | 3 | 4): number => {
      const { container, unmount } = render(<PriorityIcon priority={priority} />);
      const count = container.querySelectorAll(
        'rect[fill-opacity="0.4"]',
      ).length;
      unmount();
      return count;
    };
    expect(dimmed(2)).toBe(0); // High — all three solid
    expect(dimmed(3)).toBe(1); // Medium
    expect(dimmed(4)).toBe(2); // Low
  });

  it("puts the bars on the measured grid", () => {
    const { container } = render(<PriorityIcon priority={2} />);
    const rects = Array.from(container.querySelectorAll("rect"));
    expect(rects.map((rect) => rect.getAttribute("x"))).toEqual([
      "1.5",
      "6.5",
      "11.5",
    ]);
    expect(rects.map((rect) => rect.getAttribute("height"))).toEqual([
      "6",
      "9",
      "12",
    ]);
  });

  it("draws No priority as three dashes rather than three short bars", () => {
    const { container } = render(<PriorityIcon priority={0} />);
    const rects = Array.from(container.querySelectorAll("rect"));
    expect(rects).toHaveLength(3);
    // 1.5 tall and centred on the midline — the bars are bottom-aligned to 14.
    expect(rects.every((rect) => rect.getAttribute("height") === "1.5")).toBe(true);
    expect(rects.every((rect) => rect.getAttribute("y") === "7.25")).toBe(true);
  });

  it("draws Urgent as one even-odd path, orange by default and grey when muted", () => {
    const { container } = render(<PriorityIcon priority={1} />);
    expect(container.querySelector("path")).toHaveAttribute("fill-rule", "evenodd");
    // #ff7235, the theme token — not #f2994a, the label swatch of the same name.
    expect(svgOf(container)).toHaveAttribute("fill", "var(--priority-urgent-bg)");

    const { container: muted } = render(<PriorityIcon priority={1} muted />);
    expect(svgOf(muted)).toHaveAttribute("fill", "var(--priority-icon)");
  });

  it("keeps priority at 16px while status stays at 14px", () => {
    // Unifying the two is item 7 on the list of what clones get wrong.
    const { container: priority } = render(<PriorityIcon priority={2} />);
    const { container: status } = render(<StatusIcon type="unstarted" />);
    expect(svgOf(priority)).toHaveAttribute("width", "16");
    expect(svgOf(status)).toHaveAttribute("width", "14");
  });
});

describe("ProgressDonut", () => {
  it("reports the count, not a shape", () => {
    render(<ProgressDonut completed={3} total={7} />);
    const meter = screen.getByRole("progressbar", {
      name: "3 of 7 sub-issues completed",
    });
    expect(meter).toHaveAttribute("aria-valuenow", "3");
    expect(meter).toHaveAttribute("aria-valuemax", "7");
  });

  it("shares the status icon's wedge arithmetic exactly", () => {
    const { container } = render(<ProgressDonut completed={1} total={2} />);
    const wedge = container.querySelectorAll("circle")[1];
    expect(Number(wedge?.getAttribute("stroke-dashoffset"))).toBeCloseTo(
      WEDGE_CIRCUMFERENCE * 0.5,
      12,
    );
  });

  it("survives a total of zero without dividing by it", () => {
    const { container } = render(<ProgressDonut completed={0} total={0} />);
    const wedge = container.querySelectorAll("circle")[1];
    expect(Number(wedge?.getAttribute("stroke-dashoffset"))).toBeCloseTo(
      WEDGE_CIRCUMFERENCE,
      12,
    );
  });
});
