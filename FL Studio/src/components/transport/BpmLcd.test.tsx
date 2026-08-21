import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BpmLcd } from "./BpmLcd";
import { TEMPO_MAX, TEMPO_MIN } from "@/components/shell/wiring";

describe("BpmLcd", () => {
  it("renders the current value", () => {
    render(<BpmLcd value={140} onChange={vi.fn()} />);
    expect(screen.getByText("140")).toBeInTheDocument();
  });

  it("increments and decrements by 1 via the spinner", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BpmLcd value={140} onChange={onChange} />);

    await user.click(screen.getByLabelText("Increase tempo"));
    expect(onChange).toHaveBeenLastCalledWith(141);

    await user.click(screen.getByLabelText("Decrease tempo"));
    expect(onChange).toHaveBeenLastCalledWith(139);
  });

  it("clamps typed values to the spec range on commit", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BpmLcd value={140} onChange={onChange} />);

    await user.click(screen.getByText("140"));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "9999{Enter}");

    expect(onChange).toHaveBeenLastCalledWith(TEMPO_MAX);
  });

  it("clamps a below-minimum typed value up to the minimum", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BpmLcd value={140} onChange={onChange} />);

    await user.click(screen.getByText("140"));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "0{Enter}");

    expect(onChange).toHaveBeenLastCalledWith(TEMPO_MIN);
  });

  it("respects custom min/max props, clamping at the custom max", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BpmLcd value={160} onChange={onChange} min={80} max={160} />);

    await user.click(screen.getByLabelText("Increase tempo"));

    expect(onChange).toHaveBeenLastCalledWith(160);
  });
  /*
   * Round 6 #3. `click` fires after `pointerup`, and pointer-up had already
   * cleared the drag state — so the click handler's "was I dragging?" test
   * read `null` and answered no. EVERY completed tempo drag therefore ended
   * in the text editor, with the value it had just been dragged to sitting in
   * a field the user has to dismiss. The verdict is latched at pointer-up now.
   */
  describe("a completed drag is not a click", () => {
    function drag(element: HTMLElement, fromY: number, toY: number): void {
      fireEvent.pointerDown(element, { clientY: fromY, pointerId: 1 });
      fireEvent.pointerMove(element, { clientY: toY, pointerId: 1 });
      fireEvent.pointerUp(element, { clientY: toY, pointerId: 1 });
      fireEvent.click(element, { detail: 1 });
    }

    it("does not open the text editor after a drag that changed the tempo", () => {
      render(<BpmLcd value={140} onChange={vi.fn()} />);
      drag(screen.getByText("140"), 100, 60);

      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("drags the tempo up by the pixels travelled", () => {
      const onChange = vi.fn();
      render(<BpmLcd value={140} onChange={onChange} />);
      drag(screen.getByText("140"), 100, 60);

      expect(onChange).toHaveBeenCalledWith(180); // 40 px up = +40 BPM
    });

    it("still opens the text editor on a press that never moved", () => {
      render(<BpmLcd value={140} onChange={vi.fn()} />);
      const face = screen.getByText("140");
      fireEvent.pointerDown(face, { clientY: 100, pointerId: 1 });
      fireEvent.pointerUp(face, { clientY: 100, pointerId: 1 });
      fireEvent.click(face, { detail: 1 });

      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("still opens the editor after a press that only jittered a pixel", () => {
      render(<BpmLcd value={140} onChange={vi.fn()} />);
      drag(screen.getByText("140"), 100, 99);

      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("opens the editor on the NEXT click, having consumed the drag's verdict", () => {
      const { rerender } = render(<BpmLcd value={140} onChange={vi.fn()} />);
      drag(screen.getByText("140"), 100, 60);
      rerender(<BpmLcd value={180} onChange={vi.fn()} />);

      const face = screen.getByText("180");
      fireEvent.pointerDown(face, { clientY: 10, pointerId: 2 });
      fireEvent.pointerUp(face, { clientY: 10, pointerId: 2 });
      fireEvent.click(face, { detail: 1 });

      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });
  });

  /*
   * Round 6 #9. A cancelled pointer never delivers `pointerup`. The drag left
   * open behind it turned every later HOVER over the LCD into a tempo change
   * with no button held.
   */
  it("stops dragging when the pointer is cancelled", () => {
    const onChange = vi.fn();
    render(<BpmLcd value={140} onChange={onChange} />);
    const lcd = screen.getByTestId("bpm-lcd");

    fireEvent.pointerDown(lcd, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(lcd, { clientY: 90, pointerId: 1 });
    fireEvent.pointerCancel(lcd, { pointerId: 1 });
    onChange.mockClear();

    // A buttonless hover across the plate afterwards.
    fireEvent.pointerMove(lcd, { clientY: 10, pointerId: 1 });

    expect(onChange).not.toHaveBeenCalled();
  });
});
