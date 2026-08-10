import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ProbabilityChart } from "../ProbabilityChart";

const series = [
  {
    outcomeId: "yes",
    label: "Yes",
    color: "#2bae4c",
    points: [
      { at: 0, p: 0.4 },
      { at: 1000, p: 0.6 },
      { at: 2000, p: 0.72 },
    ],
  },
  {
    outcomeId: "no",
    label: "No",
    color: "#f43437",
    points: [
      { at: 0, p: 0.6 },
      { at: 1000, p: 0.4 },
      { at: 2000, p: 0.28 },
    ],
  },
];

describe("ProbabilityChart", () => {
  it("draws one path per outcome plus a final-point dot each", () => {
    const { container } = render(<ProbabilityChart series={series} width={300} height={150} />);
    expect(container.querySelectorAll("path")).toHaveLength(2);
    expect(container.querySelectorAll("circle")).toHaveLength(2);
  });

  it("draws grid lines at 0/25/50/75/100%", () => {
    const { container } = render(<ProbabilityChart series={series} width={300} height={150} />);
    expect(container.querySelectorAll("line")).toHaveLength(5);
  });

  it("renders y-axis labels as whole percents", () => {
    const { getByText } = render(<ProbabilityChart series={series} width={300} height={150} />);
    expect(getByText("0%")).toBeInTheDocument();
    expect(getByText("100%")).toBeInTheDocument();
  });

  it("does not crash on an empty series list", () => {
    const { container } = render(<ProbabilityChart series={[]} width={300} height={150} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelectorAll("path")).toHaveLength(0);
  });

  it("does not crash when a series has zero points", () => {
    const { container } = render(
      <ProbabilityChart
        series={[{ outcomeId: "yes", label: "Yes", color: "#2bae4c", points: [] }]}
        width={300}
        height={150}
      />,
    );
    expect(container.querySelectorAll("path")).toHaveLength(0);
    expect(container.querySelectorAll("circle")).toHaveLength(0);
  });
});
