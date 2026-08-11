import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge, type BadgeTone } from "../Badge";
import { Panel } from "../Panel";
import { Spinner } from "../Spinner";
import { Stat, type StatTone } from "../Stat";

describe("Panel", () => {
  it("renders its children with no title or footer chrome", () => {
    render(<Panel>Nothing sold yet.</Panel>);
    expect(screen.getByText("Nothing sold yet.")).toBeInTheDocument();
  });

  it("renders an optional title and footer", () => {
    render(
      <Panel title="Your selection" footer="Held for 30 minutes">
        16 blocks
      </Panel>,
    );
    expect(screen.getByText("Your selection")).toBeInTheDocument();
    expect(screen.getByText("16 blocks")).toBeInTheDocument();
    expect(screen.getByText("Held for 30 minutes")).toBeInTheDocument();
  });

  it("leaves heading semantics to the page", () => {
    render(<Panel title="Your selection">16 blocks</Panel>);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});

describe("Badge", () => {
  const tones: BadgeTone[] = ["neutral", "sold", "open", "premium", "private"];

  it.each(tones)("renders the %s tone with its meaning on the element", (tone) => {
    render(<Badge tone={tone}>{tone}</Badge>);
    expect(screen.getByText(tone)).toHaveAttribute("data-tone", tone);
  });
});

describe("Stat", () => {
  const tones: StatTone[] = ["neutral", "sold", "open", "money"];

  it.each(tones)("renders label and value in the %s tone", (tone) => {
    const { container } = render(<Stat tone={tone} label="Sold" value="128,000" />);
    expect(screen.getByText("Sold")).toBeInTheDocument();
    expect(screen.getByText("128,000")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("data-tone", tone);
  });

  it("renders the figure with tabular numerals so a live counter does not jitter", () => {
    render(<Stat label="Available" value="32,000" />);
    expect(screen.getByText("32,000")).toHaveClass("tnum");
  });
});

describe("Spinner", () => {
  it("is hidden from assistive tech unless it is given a label", () => {
    const { container } = render(<Spinner />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("announces itself when it is the only thing on screen", () => {
    render(<Spinner label="Loading the grid" />);
    expect(screen.getByRole("status", { name: "Loading the grid" })).toBeInTheDocument();
  });
});
