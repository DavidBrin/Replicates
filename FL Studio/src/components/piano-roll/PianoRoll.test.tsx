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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { addNotes, addPattern } from "@/domain/commands/patterns";
import { createDefaultProject } from "@/domain/defaultProject";
import { createHistory } from "@/domain/undo";
import { TICKS_PER_STEP, type Note } from "@/domain/types";
import { useAppStore } from "@/lib/store";

import { DEFAULT_VIEWPORT, KEYBOARD_WIDTH, noteRect } from "./geometry";
import { PianoRoll } from "./PianoRoll";
import { __resetPianoRollUiForTests, getRollUi } from "./rollUi";

function renderRoll() {
  __resetPianoRollUiForTests();
  // jsdom has no 2D context; silence its "not implemented" console noise.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  return render(<PianoRoll />);
}

// The store is a module singleton: a note seeded by one case is still there
// in the next one.
beforeEach(() => {
  useAppStore.setState({
    project: createDefaultProject({ now: "2026-01-01T00:00:00.000Z" }),
    history: createHistory(),
  });
});

/** Put one note in the active pattern and point the roll at its channel. */
function seedNote(): { note: Note } {
  const { project } = useAppStore.getState();
  const channelId = project.channelOrder[0]!;
  const note: Note = {
    id: "n-host",
    channelId,
    positionTicks: TICKS_PER_STEP * 4,
    lengthTicks: TICKS_PER_STEP * 2,
    pitch: 60,
    velocity: 0.8,
  };
  useAppStore.getState().dispatch(addNotes(project.activePatternId, [note]));
  return { note };
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

/* ---------------------------------------------------------------- cursor -- */

/*
 * `cursorAt` is the roll's affordance vocabulary, and it was computed, tested
 * and thrown away: the canvas kept the CSS `cell` everywhere, so a resize grip
 * and a pan looked exactly like empty grid.
 */
describe("the canvas wears the cursor the controller computes", () => {
  it("changes the cursor between the keyboard column and the grid", () => {
    renderRoll();
    const canvas = screen.getByTestId("piano-roll-canvas");

    fireEvent.pointerMove(canvas, { clientX: KEYBOARD_WIDTH / 2, clientY: 200 });
    expect(canvas.style.cursor).toBe("pointer");

    fireEvent.pointerMove(canvas, { clientX: KEYBOARD_WIDTH + 200, clientY: 200 });
    expect(canvas.style.cursor).toBe("cell");
  });

  it("shows the resize cursor over a note's grip", () => {
    const { note } = seedNote();
    renderRoll();
    const canvas = screen.getByTestId("piano-roll-canvas");
    const rect = noteRect(DEFAULT_VIEWPORT, note);

    fireEvent.pointerMove(canvas, {
      clientX: rect.x + rect.width - 2,
      clientY: rect.y + rect.height / 2,
    });

    expect(canvas.style.cursor).toBe("ew-resize");
  });
});

/* ------------------------------------------------- externally-cancelled -- */

/*
 * The store cancels gestures on writes the pointer did not make — pattern
 * navigation (Numpad +/- is reachable with the button still down), undo and
 * redo — but all it can reach is the UI record, `dragKind`. The gesture
 * itself, holding note snapshots from the pattern it started in, is a closure
 * in the controller that the store may not import (SPEC §6). This host carries
 * the signal across.
 *
 * Asserted on the CLONE, because that is where a surviving gesture does
 * visible damage rather than merely throwing: `makeUnique` keeps the note ids,
 * so the stale `updateNotes` applies cleanly to the destination pattern and
 * silently drags a note the user never touched.
 */
describe("navigating patterns mid-drag cancels the gesture in flight", () => {
  it("does not carry the drag into the pattern it landed on", () => {
    const { note } = seedNote();
    // The clone: same note id, other pattern — makeUnique's output.
    useAppStore.getState().dispatch(
      addPattern({
        id: "pat-clone",
        name: "Pattern 1 (unique)",
        color: "hsl(0,0%,50%)",
        notes: { [note.id]: { ...note } },
      }),
    );
    renderRoll();
    const canvas = screen.getByTestId("piano-roll-canvas");
    const rect = noteRect(DEFAULT_VIEWPORT, note);
    const start = { clientX: rect.x + 4, clientY: rect.y + rect.height / 2 };

    fireEvent.pointerDown(canvas, { ...start, button: 0 });
    expect(getRollUi().pianoRoll.dragKind).toBe("move");

    useAppStore.getState().setActivePatternId("pat-clone");
    expect(getRollUi().pianoRoll.dragKind).toBeNull();

    fireEvent.pointerMove(canvas, { clientX: start.clientX + 120, clientY: start.clientY });

    const { project } = useAppStore.getState();
    expect(project.patterns["pat-clone"]?.notes[note.id]?.positionTicks).toBe(
      note.positionTicks,
    );
  });
});
