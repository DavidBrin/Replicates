/**
 * Host smoke test — deliberately thin (SPEC §4.2 puts all the logic in the
 * pure modules, which are tested exhaustively next door).
 *
 * jsdom implements no canvas context, so `getContext("2d")` returns null and
 * the painter never runs here; that is exactly the guard this test pins. What
 * it proves is that the surrounding React chrome mounts, that the canvas
 * exists for the painter to claim, and that a mount in a context-less
 * environment does not throw.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useAppStore } from "@/lib/store";

import { PianoRoll } from "./PianoRoll";
import { __resetPianoRollUiForTests, getRollUi } from "./rollUi";

function renderRoll() {
  __resetPianoRollUiForTests();
  // jsdom has no 2D context; silence its "not implemented" console noise.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  return render(<PianoRoll />);
}

describe("PianoRoll host", () => {
  it("mounts without a canvas context and renders the grid surface", () => {
    renderRoll();
    expect(screen.getByTestId("piano-roll-canvas")).toBeInTheDocument();
    expect(screen.getByText("Piano roll")).toBeInTheDocument();
  });

  it("names the target channel, defaulting to the first in the rack", () => {
    const { container } = renderRoll();
    const firstChannelId = useAppStore.getState().project.channelOrder[0] ?? "";
    const name = useAppStore.getState().project.channels[firstChannelId]?.name ?? "";
    expect(screen.getByRole("combobox", { name: "Target channel" })).toHaveValue(
      firstChannelId,
    );
    // The title's channel label, not the picker option of the same text.
    expect(container.querySelector(".fl-piano-roll__channel")).toHaveTextContent(name);
  });

  it("drives the snap setting through the UI slice, not local state", async () => {
    renderRoll();
    await userEvent.selectOptions(screen.getByLabelText("Snap"), "beat");
    expect(getRollUi().pianoRoll.snap).toBe("beat");
  });

  it("switches the active tool through the UI slice", async () => {
    renderRoll();
    await userEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(getRollUi().pianoRoll.tool).toBe("select");
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
