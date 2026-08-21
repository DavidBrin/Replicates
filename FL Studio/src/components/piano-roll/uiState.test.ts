/**
 * UI-slice tests — run against the REAL composed store (`useAppStore`), which
 * is where `src/lib/store.ts` now spreads this creator. Asserting through the
 * genuine article rather than a hand-composed stand-in is what makes the
 * *registration* part of what is under test: unregister the slice and these
 * fail.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { TICKS_PER_BEAT, TICKS_PER_STEP } from "@/domain/types";
import { useAppStore, type AppState } from "@/lib/store";

import { DEFAULT_VIEWPORT, MAX_ZOOM_X, MIN_ZOOM_X } from "./geometry";
import { DEFAULT_PIANO_ROLL_UI, type PianoRollUiSlice } from "./uiState";

const useTestStore = useAppStore;

const initial = useTestStore.getState();

beforeEach(() => {
  useTestStore.setState({ pianoRoll: DEFAULT_PIANO_ROLL_UI }, false);
});

const ui = (): PianoRollUiSlice["pianoRoll"] => useTestStore.getState().pianoRoll;

describe("composition into the app store", () => {
  it("registers under one namespaced key, colliding with no other surface", () => {
    expect(Object.keys(initial)).toContain("pianoRoll");
    // Generic names a Playlist slice would also want stay out of the store.
    for (const key of ["snap", "zoom", "scrollX", "selectedNoteIds", "tool"]) {
      expect(Object.keys(initial)).not.toContain(key);
    }
  });

  it("keeps domain state reachable from the same store (`get().dispatch`)", () => {
    const state: AppState = useTestStore.getState();
    expect(typeof state.dispatch).toBe("function");
    expect(state.project.channelOrder.length).toBeGreaterThan(0);
  });

  it("never writes domain fields itself", () => {
    const before = useTestStore.getState().project;
    useTestStore.getState().setPianoRollSnap("bar");
    expect(useTestStore.getState().project).toBe(before);
  });
});

describe("snap", () => {
  it("sets a known unit and ignores an unknown one", () => {
    useTestStore.getState().setPianoRollSnap("beat");
    expect(ui().snap).toBe("beat");
    useTestStore.getState().setPianoRollSnap("nonsense" as never);
    expect(ui().snap).toBe("beat");
  });

  it("toggles off and back to the unit that was in use (Backspace)", () => {
    useTestStore.getState().setPianoRollSnap("halfBeat");
    useTestStore.getState().togglePianoRollSnap();
    expect(ui().snap).toBe("off");
    useTestStore.getState().togglePianoRollSnap();
    expect(ui().snap).toBe("halfBeat");
  });

  it("falls back to a usable unit if snap was already off at boot", () => {
    useTestStore.setState({
      pianoRoll: { ...DEFAULT_PIANO_ROLL_UI, snap: "off", previousSnap: "off" },
    });
    useTestStore.getState().togglePianoRollSnap();
    expect(ui().snap).toBe("quarterBeat");
  });
});

describe("view", () => {
  it("clamps zoom into the supported range", () => {
    useTestStore.getState().setPianoRollView({ zoomX: 999 });
    expect(ui().view.zoomX).toBe(MAX_ZOOM_X);
    useTestStore.getState().setPianoRollView({ zoomX: 0 });
    expect(ui().view.zoomX).toBe(MIN_ZOOM_X);
  });

  it("clamps scroll so the grid can never be dragged off-screen", () => {
    useTestStore.getState().setPianoRollView({ scrollX: -400, scrollY: -400 });
    expect(ui().view.scrollX).toBe(0);
    expect(ui().view.scrollY).toBe(0);
  });

  it("patches only the keys given — a resize keeps the zoom", () => {
    useTestStore.getState().setPianoRollView({ zoomX: 2 });
    useTestStore.getState().setPianoRollView({ width: 1200, height: 700 });
    expect(ui().view).toMatchObject({ zoomX: 2, width: 1200, height: 700 });
    expect(ui().view.velocityLaneHeight).toBe(DEFAULT_VIEWPORT.velocityLaneHeight);
  });
});

describe("selection", () => {
  it("replaces the selection, copying the array", () => {
    const ids = ["a", "b"];
    useTestStore.getState().setPianoRollSelection(ids);
    ids.push("c");
    expect(ui().selectedNoteIds).toEqual(["a", "b"]);
  });

  it("adds and removes with the additive flag, replaces without it", () => {
    useTestStore.getState().togglePianoRollSelected("a", false);
    useTestStore.getState().togglePianoRollSelected("b", true);
    expect(ui().selectedNoteIds).toEqual(["a", "b"]);
    useTestStore.getState().togglePianoRollSelected("a", true);
    expect(ui().selectedNoteIds).toEqual(["b"]);
    useTestStore.getState().togglePianoRollSelected("c", false);
    expect(ui().selectedNoteIds).toEqual(["c"]);
  });

  it("clears the selection when the target channel changes", () => {
    useTestStore.getState().setPianoRollSelection(["a"]);
    useTestStore.getState().setPianoRollChannel("ch-bass");
    expect(ui().channelId).toBe("ch-bass");
    expect(ui().selectedNoteIds).toEqual([]);
  });
});

describe("last-used note length", () => {
  it("remembers a positive length and rejects nonsense", () => {
    useTestStore.getState().setPianoRollLastLength(TICKS_PER_BEAT);
    expect(ui().lastLengthTicks).toBe(TICKS_PER_BEAT);
    useTestStore.getState().setPianoRollLastLength(0);
    useTestStore.getState().setPianoRollLastLength(Number.NaN);
    useTestStore.getState().setPianoRollLastLength(-5);
    expect(ui().lastLengthTicks).toBe(TICKS_PER_BEAT);
  });

  it("defaults to one step, so a fresh roll draws a 16th", () => {
    expect(DEFAULT_PIANO_ROLL_UI.lastLengthTicks).toBe(TICKS_PER_STEP);
  });
});

describe("transient drag + preview state", () => {
  it("records the gesture kind and the held preview pitch", () => {
    useTestStore.getState().setPianoRollDragKind("resize");
    useTestStore.getState().setPianoRollPreviewPitch(64);
    expect(ui().dragKind).toBe("resize");
    expect(ui().previewPitch).toBe(64);
    useTestStore.getState().setPianoRollDragKind(null);
    useTestStore.getState().setPianoRollPreviewPitch(null);
    expect(ui().dragKind).toBeNull();
    expect(ui().previewPitch).toBeNull();
  });
});
