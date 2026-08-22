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

/*
 * Round 7 #3. The spinner buttons live INSIDE the `.fl-lcd` plate, so their
 * pointer events bubbled straight into the LCD's drag initializer: holding a
 * spinner and twitching dragged the tempo, and the release then applied the
 * button's ±1 on top — two edits from one press.
 */
describe("BpmLcd — the spinner is not a tempo drag handle (round 7 #3)", () => {
  it("does not drag the tempo when the press landed on the ▲ spinner", () => {
    const onChange = vi.fn();
    render(<BpmLcd value={140} onChange={onChange} />);
    const lcd = screen.getByTestId("bpm-lcd");
    const up = screen.getByLabelText("Increase tempo");

    fireEvent.pointerDown(up, { clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(lcd, { clientY: 60, pointerId: 1 }); // a 40px twitch
    fireEvent.pointerUp(lcd, { clientY: 60, pointerId: 1 });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("still applies exactly the ±1 increment from that same press", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BpmLcd value={140} onChange={onChange} />);

    await user.click(screen.getByLabelText("Decrease tempo"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(139);
  });

  it("does not drag from the ▼ spinner either", () => {
    const onChange = vi.fn();
    render(<BpmLcd value={140} onChange={onChange} />);
    const lcd = screen.getByTestId("bpm-lcd");

    fireEvent.pointerDown(screen.getByLabelText("Decrease tempo"), {
      clientY: 100,
      pointerId: 1,
      button: 0,
    });
    fireEvent.pointerMove(lcd, { clientY: 140, pointerId: 1 });
    fireEvent.pointerUp(lcd, { clientY: 140, pointerId: 1 });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores a NON-primary press on the value face", () => {
    const onChange = vi.fn();
    render(<BpmLcd value={140} onChange={onChange} />);
    const lcd = screen.getByTestId("bpm-lcd");

    fireEvent.pointerDown(lcd, { clientY: 100, pointerId: 1, button: 2 });
    fireEvent.pointerMove(lcd, { clientY: 60, pointerId: 1 });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("still drags from a primary press on the value face", () => {
    const onChange = vi.fn();
    render(<BpmLcd value={140} onChange={onChange} />);
    const lcd = screen.getByTestId("bpm-lcd");

    fireEvent.pointerDown(screen.getByText("140"), { clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(lcd, { clientY: 90, pointerId: 1 });

    expect(onChange).toHaveBeenLastCalledWith(150);
  });
});

/*
 * Round 8 #7. `moved` correctly stayed false below the slop threshold — so
 * the press was still treated as a click — but `onChange` fired on every move
 * regardless. An intended click that wandered a pixel therefore edited the
 * tempo AND opened the editor on the edited value, with an undo entry behind
 * a gesture the user meant as a click.
 */
describe("sub-slop jitter never changes the tempo (round 8 #7)", () => {
  it("reports nothing for movement inside the slop threshold", () => {
    const onChange = vi.fn();
    render(<BpmLcd value={140} onChange={onChange} />);
    const lcd = screen.getByTestId("bpm-lcd");

    fireEvent.pointerDown(screen.getByText("140"), { clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(lcd, { clientY: 99, pointerId: 1 });
    fireEvent.pointerMove(lcd, { clientY: 101, pointerId: 1 });
    fireEvent.pointerMove(lcd, { clientY: 98, pointerId: 1 }); // exactly the threshold
    fireEvent.pointerUp(lcd, { clientY: 98, pointerId: 1 });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("still opens the editor after a jittered click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<BpmLcd value={140} onChange={onChange} />);
    const lcd = screen.getByTestId("bpm-lcd");

    fireEvent.pointerDown(screen.getByText("140"), { clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(lcd, { clientY: 99, pointerId: 1 });
    fireEvent.pointerUp(lcd, { clientY: 99, pointerId: 1 });
    await user.click(screen.getByText("140"));

    expect(screen.getByRole("textbox")).toHaveValue("140");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports from the ORIGINAL anchor once the threshold is crossed", () => {
    const onChange = vi.fn();
    render(<BpmLcd value={140} onChange={onChange} />);
    const lcd = screen.getByTestId("bpm-lcd");

    fireEvent.pointerDown(screen.getByText("140"), { clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(lcd, { clientY: 99, pointerId: 1 }); // swallowed
    fireEvent.pointerMove(lcd, { clientY: 90, pointerId: 1 });

    // The full 10px of travel, not 10 minus the slop it spent getting there.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(150);
  });
});

describe("a tempo drag belongs to ONE pointer (round 12)", () => {
  it("ignores a stranger's move and its release", () => {
    const onChange = vi.fn();
    render(<BpmLcd value={140} onChange={onChange} />);
    const lcd = screen.getByTestId("bpm-lcd");

    fireEvent.pointerDown(lcd, { clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(lcd, { clientY: 90, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(150);

    // A second pointer, 60px further up: not this drag's travel.
    fireEvent.pointerMove(lcd, { clientY: 30, pointerId: 9 });
    expect(onChange).toHaveBeenLastCalledWith(150);

    // Nor this drag's release — the owner is still dragging.
    fireEvent.pointerUp(lcd, { clientY: 30, pointerId: 9 });
    fireEvent.pointerMove(lcd, { clientY: 80, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(160);
  });
});
