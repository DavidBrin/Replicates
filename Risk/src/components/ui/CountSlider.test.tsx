import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { CountSlider } from "./CountSlider";

function Harness({
  min = 1, max = 12, start = 5, showMoveAll = false, title = "Deploy Troops",
  onConfirm = () => {}, onCancel = () => {},
}: {
  min?: number; max?: number; start?: number; showMoveAll?: boolean; title?: string;
  onConfirm?: () => void; onCancel?: () => void;
}) {
  const [value, setValue] = useState(start);
  return (
    <CountSlider
      title={title}
      min={min}
      max={max}
      value={value}
      onChange={setValue}
      onConfirm={onConfirm}
      onCancel={onCancel}
      showMoveAll={showMoveAll}
    />
  );
}

describe("CountSlider", () => {
  it("carries the three §7.2 titles verbatim", () => {
    const { rerender } = render(<Harness title="Deploy Troops" />);
    expect(screen.getByTestId("count-slider-title")).toHaveTextContent("Deploy Troops");
    rerender(<Harness title="Fortify Troops" />);
    expect(screen.getByTestId("count-slider-title")).toHaveTextContent("Fortify Troops");
    rerender(<Harness title="Move Troops" />);
    expect(screen.getByTestId("count-slider-title")).toHaveTextContent("Move Troops");
  });

  it("shows five numerals with the selected value inside the notched ring", () => {
    render(<Harness start={5} />);
    for (const n of [3, 4, 5, 6, 7]) {
      expect(screen.getByTestId(`count-numeral-${n}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("count-numeral-8")).toBeNull();
    expect(screen.getByTestId("count-ring")).toHaveAttribute("data-value", "5");
    expect(screen.getByTestId("notched-ring-notch")).toBeInTheDocument();
  });

  it("clips the numerals that fall outside min..max", () => {
    render(<Harness min={1} max={12} start={1} />);
    expect(screen.queryByTestId("count-numeral-0")).toBeNull();
    expect(screen.getByTestId("count-numeral-1")).toBeInTheDocument();
    expect(screen.getByTestId("count-numeral-3")).toBeInTheDocument();
  });

  it("jumps to a tapped numeral", () => {
    render(<Harness start={5} />);
    fireEvent.click(screen.getByTestId("count-numeral-7"));
    expect(screen.getByTestId("count-slider")).toHaveAttribute("data-value", "7");
  });

  it("scrolls the numerals through on a horizontal drag", () => {
    render(<Harness start={5} />);
    const strip = screen.getByTestId("count-slider-strip");
    fireEvent.pointerDown(strip, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(strip, { clientX: 200 + 48 * 3, pointerId: 1 });
    expect(screen.getByTestId("count-slider")).toHaveAttribute("data-value", "8");
    fireEvent.pointerMove(strip, { clientX: 200 - 48 * 2, pointerId: 1 });
    expect(screen.getByTestId("count-slider")).toHaveAttribute("data-value", "3");
    fireEvent.pointerUp(strip, { pointerId: 1 });
    fireEvent.pointerMove(strip, { clientX: 999, pointerId: 1 });
    expect(screen.getByTestId("count-slider")).toHaveAttribute("data-value", "3");
  });

  it("maps 1 / 5 / 0 and A per §9", () => {
    render(<Harness min={1} max={12} start={4} />);
    const slider = screen.getByTestId("count-slider");
    fireEvent.keyDown(window, { key: "1" });
    expect(slider).toHaveAttribute("data-value", "1");
    fireEvent.keyDown(window, { key: "5" });
    expect(slider).toHaveAttribute("data-value", "5");
    fireEvent.keyDown(window, { key: "0" });
    expect(slider).toHaveAttribute("data-value", "12");
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "A" });
    expect(slider).toHaveAttribute("data-value", "12");
  });

  it("confirms on Enter and cancels on Escape", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<Harness onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("wires the red ✗ and the green ✓", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<Harness onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId("count-cancel"));
    fireEvent.click(screen.getByTestId("count-confirm"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("offers `Move All`, which jumps to max, only when asked", () => {
    const { rerender } = render(<Harness start={2} max={9} />);
    expect(screen.queryByTestId("count-move-all")).toBeNull();
    rerender(<Harness start={2} max={9} showMoveAll />);
    const moveAll = screen.getByTestId("count-move-all");
    expect(moveAll).toHaveTextContent("Move All");
    fireEvent.click(moveAll);
    expect(screen.getByTestId("count-slider")).toHaveAttribute("data-value", "9");
  });
});
