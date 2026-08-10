import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Pill } from "../Pill";

describe("Pill", () => {
  it("always renders the numeral — probability is never color-only (G9)", () => {
    render(<Pill value={0.7239} />);
    expect(screen.getByText("72%")).toBeInTheDocument();
  });

  it("auto tone picks yes-green above 0.5", () => {
    render(<Pill value={0.72} />);
    expect(screen.getByText("72%")).toHaveClass("text-(--yes)");
  });

  it("auto tone picks neutral at or below 0.5", () => {
    render(<Pill value={0.5} />);
    expect(screen.getByText("50%")).toHaveClass("text-(--text-2)");

    render(<Pill value={0.28} />);
    expect(screen.getByText("28%")).toHaveClass("text-(--text-2)");
  });

  it("an explicit tone overrides auto", () => {
    render(<Pill value={0.28} tone="no" />);
    expect(screen.getByText("28%")).toHaveClass("text-(--no)");
  });

  it("renders tabular numerals", () => {
    render(<Pill value={0.5} />);
    expect(screen.getByText("50%")).toHaveClass("tabular-nums");
  });

  it("emphasis bumps font weight", () => {
    render(<Pill value={0.72} emphasis />);
    expect(screen.getByText("72%")).toHaveClass("font-semibold");
  });
});
