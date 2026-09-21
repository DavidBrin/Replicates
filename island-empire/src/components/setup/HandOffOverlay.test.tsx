import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import HandOffOverlay, { HandOffOverlay as NamedHandOffOverlay } from "./HandOffOverlay";

describe("HandOffOverlay", () => {
  it("exports the same component as both default and named", () => {
    expect(HandOffOverlay).toBe(NamedHandOffOverlay);
  });

  it("renders the player's name and labels the dialog with their name and colour", () => {
    render(<HandOffOverlay playerName="Red" colour="red" onContinue={vi.fn()} />);
    expect(screen.getByTestId("handoff-name")).toHaveTextContent("Red");
    expect(screen.getByRole("dialog", { name: /Red \(Red\)/ })).toBeInTheDocument();
  });

  it("renders a custom player name distinct from the seat colour", () => {
    render(<HandOffOverlay playerName="Dilan" colour="blue" onContinue={vi.fn()} />);
    expect(screen.getByTestId("handoff-name")).toHaveTextContent("Dilan");
    expect(screen.getByRole("dialog", { name: /Dilan \(Blue\)/ })).toBeInTheDocument();
  });

  it("calls onContinue exactly once when CONTINUE is tapped", async () => {
    const onContinue = vi.fn();
    const user = userEvent.setup();
    render(<HandOffOverlay playerName="Blue" colour="blue" onContinue={onContinue} />);

    await user.click(screen.getByTestId("handoff-continue"));

    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
