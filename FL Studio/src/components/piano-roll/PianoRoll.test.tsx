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
import { selectHasActiveGesture, useAppStore } from "@/lib/store";

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

  /*
   * The cursor was pushed on pointer*move* only, and guarded by the last value
   * written — so `grabbing`, which a middle-button pan installs, survived the
   * release: the roll kept a grab cursor until the pointer happened to move
   * again, and after a pan that is precisely when it has stopped.
   */
  it("drops 'grabbing' when a middle-drag pan is released", () => {
    renderRoll();
    const canvas = screen.getByTestId("piano-roll-canvas");
    const point = { clientX: KEYBOARD_WIDTH + 200, clientY: 200 };

    fireEvent.pointerMove(canvas, point);
    fireEvent.pointerDown(canvas, { ...point, button: 1 });
    fireEvent.pointerMove(canvas, { clientX: point.clientX + 40, clientY: 220 });
    expect(canvas.style.cursor).toBe("grabbing");

    fireEvent.pointerUp(canvas, { clientX: point.clientX + 40, clientY: 220, button: 1 });

    expect(canvas.style.cursor).not.toBe("grabbing");
    expect(canvas.style.cursor).toBe("cell"); // recomputed for where it ended
  });

  it("drops 'grabbing' when the browser cancels the pointer mid-pan", () => {
    renderRoll();
    const canvas = screen.getByTestId("piano-roll-canvas");
    const point = { clientX: KEYBOARD_WIDTH + 200, clientY: 200 };

    fireEvent.pointerDown(canvas, { ...point, button: 1 });
    fireEvent.pointerMove(canvas, { clientX: point.clientX + 40, clientY: 220 });
    expect(canvas.style.cursor).toBe("grabbing");

    fireEvent.pointerCancel(canvas, { clientX: point.clientX + 40, clientY: 220 });

    expect(canvas.style.cursor).not.toBe("grabbing");
  });

  it("drops 'grabbing' when the STORE cancels the pan (undo, pattern switch)", () => {
    useAppStore.getState().dispatch(
      addPattern({ id: "pat-other", name: "Other", color: "hsl(0,0%,50%)", notes: {} }),
    );
    renderRoll();
    const canvas = screen.getByTestId("piano-roll-canvas");
    const point = { clientX: KEYBOARD_WIDTH + 200, clientY: 200 };

    fireEvent.pointerDown(canvas, { ...point, button: 1 });
    fireEvent.pointerMove(canvas, { clientX: point.clientX + 40, clientY: 220 });
    expect(canvas.style.cursor).toBe("grabbing");

    // No pointer event announces this one — that is what "external" means.
    useAppStore.getState().setActivePatternId("pat-other");

    expect(canvas.style.cursor).not.toBe("grabbing");
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

/*
 * Round 8's class sweep, roll family (`@/lib/gestureHold`'s rule (b)). Every
 * ref-driven surface releases its hold when it unmounts; the roll's hold IS
 * `pianoRoll.dragKind`, and nothing cleared it. Flipping away from the roll
 * tab with the button down left `selectHasActiveGesture` true forever, so the
 * debounced autosave deferred every write for the rest of the session.
 */
describe("unmounting mid-drag releases the roll's gesture (round 8)", () => {
  it("clears dragKind — and the store-wide gesture flag — on unmount", () => {
    const { note } = seedNote();
    const view = renderRoll();
    const canvas = screen.getByTestId("piano-roll-canvas");
    const rect = noteRect(DEFAULT_VIEWPORT, note);

    fireEvent.pointerDown(canvas, {
      clientX: rect.x + 4,
      clientY: rect.y + rect.height / 2,
      button: 0,
    });
    expect(getRollUi().pianoRoll.dragKind).toBe("move");
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(true);

    view.unmount();

    expect(getRollUi().pianoRoll.dragKind).toBeNull();
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
  });

  it("costs nothing when the roll unmounts idle", () => {
    const view = renderRoll();
    view.unmount();
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
  });
});
