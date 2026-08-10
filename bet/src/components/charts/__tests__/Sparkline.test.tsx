import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Sparkline } from "../Sparkline";

describe("Sparkline", () => {
  it("renders a 60x20 svg by default with a line and an area fill", () => {
    const { container } = render(
      <Sparkline
        points={[
          { at: 0, p: 0.4 },
          { at: 1, p: 0.6 },
          { at: 2, p: 0.5 },
        ]}
      />,
    );
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("width", "60");
    expect(svg).toHaveAttribute("height", "20");
    expect(container.querySelectorAll("path")).toHaveLength(2);
  });

  it("does not crash on an empty series", () => {
    const { container } = render(<Sparkline points={[]} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelectorAll("path")).toHaveLength(0);
  });

  it("does not crash on a single point", () => {
    const { container } = render(<Sparkline points={[{ at: 0, p: 0.5 }]} />);
    expect(container.querySelectorAll("path").length).toBeGreaterThan(0);
  });
});
