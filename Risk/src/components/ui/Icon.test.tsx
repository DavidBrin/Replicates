import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ICON_NAMES, Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { Tray } from "./Tray";

describe("Icon", () => {
  it("draws every name in the §8 set as a currentColor silhouette", () => {
    render(
      <div>
        {ICON_NAMES.map((name) => (
          <Icon key={name} name={name} />
        ))}
      </div>,
    );
    expect(ICON_NAMES).toHaveLength(24);
    for (const name of ICON_NAMES) {
      const svg = screen.getByTestId(`icon-${name}`);
      expect(svg).toHaveAttribute("fill", "currentColor");
      // flat silhouettes: filled sub-paths, never strokes
      expect(svg.querySelector("[stroke]")).toBeNull();
      expect(svg.querySelectorAll("path").length).toBeGreaterThan(0);
    }
  });

  it("is hidden from the a11y tree unless it is given a title", () => {
    const { rerender } = render(<Icon name="globe" />);
    expect(screen.getByTestId("icon-globe")).toHaveAttribute("aria-hidden", "true");
    rerender(<Icon name="globe" title="Online" />);
    expect(screen.getByTestId("icon-globe")).toHaveAttribute("role", "img");
  });
});

describe("IconButton", () => {
  it("offers the circle, grey tray and outline chassis of §8", () => {
    render(
      <>
        <IconButton icon="check" label="Confirm" chassis="circle" testId="a" />
        <IconButton icon="bar-chart" label="Stats" chassis="tray" size={90} testId="b" />
        <IconButton icon="gear" label="Settings" chassis="outline" testId="c" />
      </>,
    );
    expect(screen.getByTestId("a")).toHaveAttribute("data-chassis", "circle");
    // the utility tray's radius is ≈20% of the box
    expect(screen.getByTestId("b")).toHaveStyle({ borderRadius: "18px" });
    // the top-left utility button: 3 px white stroke, no fill
    const outline = screen.getByTestId("c").getAttribute("style") ?? "";
    expect(outline).toContain("background: transparent");
    expect(outline).toContain("border: 3px solid var(--text)");
  });

  it("keeps a 44 px touch target however small the size prop is", () => {
    render(<IconButton icon="cross" label="Close" size={20} testId="x" />);
    expect(screen.getByTestId("x")).toHaveStyle({ width: "44px", height: "44px" });
  });

  it("names itself for assistive tech and fires onClick", () => {
    const onClick = vi.fn();
    render(<IconButton icon="question" label="Help" onClick={onClick} testId="h" />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("Tray", () => {
  it("is the grey --tray gradient at a 16–18 radius", () => {
    render(<Tray testId="t">x</Tray>);
    expect(screen.getByTestId("t")).toHaveStyle({ background: "var(--tray)", borderRadius: "18px" });
  });
});
