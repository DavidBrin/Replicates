import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProbabilityChartInteractive } from "../ProbabilityChartInteractive";

const series = [
  {
    outcomeId: "yes",
    label: "Yes",
    color: "#2bae4c",
    points: [
      { at: 0, p: 0.4 },
      { at: 1000, p: 0.72 },
    ],
  },
];

describe("ProbabilityChartInteractive", () => {
  it("shows no crosshair readout until hovered", () => {
    render(<ProbabilityChartInteractive series={series} width={300} height={150} />);
    expect(screen.queryByText("Yes")).not.toBeInTheDocument();
  });

  it("shows a per-series readout on pointer move, keyed to the nearest point", () => {
    const { container } = render(
      <ProbabilityChartInteractive series={series} width={300} height={150} />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    // jsdom reports a zero-size bounding rect by default, which the
    // component's t = px / rect.width guard maps to t = 0 — i.e. the
    // earliest point (p: 0.4).
    fireEvent.pointerMove(wrapper, { clientX: 100, clientY: 10 });
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
  });
});
