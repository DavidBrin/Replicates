import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
