import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { Pill } from "./Pill";

describe("Pill", () => {
  it("renders the label and fires onClick", () => {
    const onClick = vi.fn();
    render(<Pill label="BATTLE" testId="home-battle" onClick={onClick} />);
    const pill = screen.getByTestId("home-battle");
    expect(pill).toHaveTextContent("BATTLE");
    fireEvent.click(pill);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is the measured 238×48 at the primary size and ~290×72 as a hero", () => {
    const { rerender } = render(<Pill label="Next" testId="p" />);
    expect(screen.getByTestId("p")).toHaveStyle({ height: "48px" });
    rerender(<Pill label="BATTLE" size="hero" testId="p" />);
    expect(screen.getByTestId("p")).toHaveStyle({ height: "72px" });
    expect(screen.getByTestId("p")).toHaveAttribute("data-size", "hero");
  });

  it("falls back to the flat --disabled chassis and swallows the click", () => {
    const onClick = vi.fn();
    render(<Pill label="No Matching Cards" disabled testId="p" onClick={onClick} />);
    const pill = screen.getByTestId("p");
    expect(pill).toHaveAttribute("data-variant", "disabled");
    expect(pill).toBeDisabled();
    fireEvent.click(pill);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("collapses the bezel on press and restores it on release", () => {
    render(<Pill label="End Turn" testId="p" />);
    const pill = screen.getByTestId("p");
    expect(pill).toHaveAttribute("data-pressed", "false");
    fireEvent.pointerDown(pill);
    expect(pill).toHaveAttribute("data-pressed", "true");
    fireEvent.pointerUp(pill);
    expect(pill).toHaveAttribute("data-pressed", "false");
  });

  it("paints only tokens, never a hex", () => {
    render(<Pill label="BATTLE" testId="p" />);
    const style = screen.getByTestId("p").getAttribute("style") ?? "";
    expect(style).toContain("var(--go)");
    expect(style).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
