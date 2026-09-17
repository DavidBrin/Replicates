/**
 * Keyboard-binding tests: the bindings are registered in the real registry
 * (`src/lib/keyboard.ts`) and fired through `dispatchKeyEvent`, so the combo
 * itself — not just the handler — is under test. Effects land on a mocked
 * dispatch and are asserted by applying the command to a fixture project.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addNotes, type Command } from "@/domain/commands";
import { registerExternalGesture, __resetGestureCounterForTests } from "@/lib/gestureHold";
import { fixtureProject } from "@/domain/testKit";
import {
  DEFAULT_VELOCITY,
  TICKS_PER_BEAT,
  TICKS_PER_STEP,
  type Note,
  type Project,
} from "@/domain/types";
import {
  __resetKeyboardRegistryForTests,
  dispatchKeyEvent,
  getAllBindings,
} from "@/lib/keyboard";

import {
  createViewport,
  DEFAULT_VIEWPORT,
  gridWidth,
  KEYBOARD_WIDTH,
  MAX_ZOOM_X,
  MIN_ZOOM_X,
  noteRect,
  xToTick,
  type RollViewport,
} from "./geometry";
import { createPianoRollController, type RollPointer } from "./interactions";
import {
  PIANO_ROLL_SURFACE_ID,
  ZOOM_KEY_FACTOR,
  registerPianoRollBindings,
  transposeCommand,
} from "./bindings";

const PATTERN = fixtureProject().activePatternId;

function makeNote(patch: Partial<Note> = {}): Note {
  return {
    id: "n-1",
    channelId: "ch-kick",
    positionTicks: 0,
    lengthTicks: TICKS_PER_STEP,
    pitch: 60,
    velocity: DEFAULT_VELOCITY,
    ...patch,
  };
}

function harness(notes: Note[], selectedNoteIds: string[]) {
  const commands: Command[] = [];
  const dispatch = vi.fn((command: Command) => void commands.push(command));
  const setSelection = vi.fn();
  const toggleSnap = vi.fn();
  let view: RollViewport = { ...DEFAULT_VIEWPORT, width: 800, height: 600 };
  const setView = vi.fn((patch: { zoomX: number; scrollX: number }) => {
    view = { ...view, ...patch };
  });
  const unregister = registerPianoRollBindings({
    getScene: () => ({ patternId: PATTERN, notes, selectedNoteIds }),
    dispatch,
    setSelection,
    toggleSnap,
    getView: () => view,
    setView,
  });

  const applied = (): Project => {
    let project = addNotes(PATTERN, notes).apply(fixtureProject());
    for (const command of commands) project = command.apply(project);
    return project;
  };

  return {
    dispatch,
    setSelection,
    toggleSnap,
    setView,
    getView: () => view,
    commands,
    applied,
    unregister,
  };
}

function press(code: string, modifiers: Partial<KeyboardEvent> = {}): boolean {
  const event = new KeyboardEvent("keydown", { code, ...modifiers });
  return dispatchKeyEvent(event);
}

beforeEach(() => {
  __resetKeyboardRegistryForTests();
});

afterEach(() => {
  __resetKeyboardRegistryForTests();
});

describe("registration", () => {
  it("registers under the surface id and unregisters cleanly", () => {
    const h = harness([makeNote()], []);
    expect(getAllBindings().length).toBeGreaterThan(0);
    h.unregister();
    expect(getAllBindings()).toHaveLength(0);
  });

  it("uses a surface id nothing else claims", () => {
    expect(PIANO_ROLL_SURFACE_ID).toBe("piano-roll");
  });
});

describe("Ctrl+A / Ctrl+D", () => {
  it("selects every note of the target channel", () => {
    const notes = [makeNote({ id: "a" }), makeNote({ id: "b", positionTicks: 96 })];
    const h = harness(notes, []);
    expect(press("KeyA", { ctrlKey: true })).toBe(true);
    expect(h.setSelection).toHaveBeenCalledWith(["a", "b"]);
  });

  it("deselects all", () => {
    const h = harness([makeNote()], ["n-1"]);
    expect(press("KeyD", { ctrlKey: true })).toBe(true);
    expect(h.setSelection).toHaveBeenCalledWith([]);
  });

  it("does not fire on a bare A", () => {
    const h = harness([makeNote()], []);
    expect(press("KeyA")).toBe(false);
    expect(h.setSelection).not.toHaveBeenCalled();
  });
});

describe("Delete", () => {
  it("removes exactly the selected notes", () => {
    const notes = [makeNote({ id: "a" }), makeNote({ id: "b", positionTicks: 96 })];
    const h = harness(notes, ["a"]);
    press("Delete");
    const project = h.applied();
    const remaining = project.patterns[PATTERN]?.notes ?? {};
    expect(remaining.a).toBeUndefined();
    expect(remaining.b).toBeDefined();
  });

  it("does nothing with an empty selection", () => {
    const h = harness([makeNote()], []);
    press("Delete");
    expect(h.dispatch).not.toHaveBeenCalled();
  });
});

describe("transpose", () => {
  it("moves the selection an octave with Ctrl+↑/↓", () => {
    const h = harness([makeNote({ pitch: 60 })], ["n-1"]);
    press("ArrowUp", { ctrlKey: true });
    expect(h.applied().patterns[PATTERN]?.notes["n-1"]?.pitch).toBe(72);

    const down = harness([makeNote({ pitch: 60 })], ["n-1"]);
    press("ArrowDown", { ctrlKey: true });
    expect(down.applied().patterns[PATTERN]?.notes["n-1"]?.pitch).toBe(48);
  });

  it("moves the selection a semitone with Shift+↑/↓", () => {
    const h = harness([makeNote({ pitch: 60 })], ["n-1"]);
    press("ArrowUp", { shiftKey: true });
    expect(h.applied().patterns[PATTERN]?.notes["n-1"]?.pitch).toBe(61);
  });

  it("keeps a chord's shape when it runs into the top of the keyboard", () => {
    const notes = [makeNote({ id: "low", pitch: 120 }), makeNote({ id: "high", pitch: 124 })];
    const command = transposeCommand(
      { patternId: PATTERN, notes, selectedNoteIds: ["low", "high"] },
      12,
    );
    expect(command).not.toBeNull();
    let project = addNotes(PATTERN, notes).apply(fixtureProject());
    project = (command as Command).apply(project);
    const after = project.patterns[PATTERN]?.notes;
    // Shifted by 3, not 12 — the interval survives, nothing collapses onto 127.
    expect(after?.low?.pitch).toBe(123);
    expect(after?.high?.pitch).toBe(127);
  });

  it("does nothing when the selection is already against the ceiling", () => {
    const h = harness([makeNote({ pitch: 127 })], ["n-1"]);
    press("ArrowUp", { ctrlKey: true });
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("does nothing with an empty selection", () => {
    const h = harness([makeNote()], []);
    press("ArrowUp", { ctrlKey: true });
    press("ArrowDown", { shiftKey: true });
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("ignores notes that are selected but not in this channel's scene", () => {
    const h = harness([makeNote({ id: "a" })], ["a", "ghost-from-another-channel"]);
    press("ArrowUp", { shiftKey: true });
    const project = h.applied();
    expect(Object.keys(project.patterns[PATTERN]?.notes ?? {})).toEqual(["a"]);
  });
});

/*
 * Round 16 #2. `mutate()` used to mint the one-shot BEFORE calling `build()`,
 * so a keystroke that turns out to write nothing still pre-empted: it ended
 * whatever drag was open app-wide and flushed any pending editor commit on its
 * way to dispatching nothing at all. Both no-op shapes are reachable with one
 * finger — `Delete` with the selection empty, `Ctrl+↑` with the selection
 * already on 127.
 */
describe("a keystroke that writes nothing pre-empts nothing (round 16 #2)", () => {
  function openGesture(): string[] {
    const ended: string[] = [];
    registerExternalGesture(() => ended.push("drag"));
    return ended;
  }

  beforeEach(() => {
    __resetGestureCounterForTests();
  });

  it("leaves the open gesture alone on Delete with an empty selection", () => {
    const h = harness([makeNote()], []);
    const ended = openGesture();

    press("Delete");

    expect(ended).toEqual([]);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("leaves the open gesture alone on a transpose at the MIDI ceiling", () => {
    const h = harness([makeNote({ pitch: 127 })], ["n-1"]);
    const ended = openGesture();

    press("ArrowUp", { ctrlKey: true });

    expect(ended).toEqual([]);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("STILL pre-empts when the keystroke does write — the round 11 rule stands", () => {
    const h = harness([makeNote({ pitch: 60 })], ["n-1"]);
    const ended = openGesture();

    press("ArrowUp", { ctrlKey: true });

    expect(ended).toEqual(["drag"]);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });

  it("pre-empts before it builds the command it dispatches", () => {
    // The round 15 ordering, still in force: the dispatched command is built
    // AFTER the pre-emption, so it describes the project as the cancelled
    // gesture left it. The probe that decides whether to pre-empt at all is a
    // separate, earlier build — this asserts the sequence, not just the ends.
    const notes = [makeNote({ id: "a", pitch: 60 })];
    const order: string[] = [];
    const h = harness(notes, ["a"]);
    registerExternalGesture(() => order.push("preempt"));
    h.dispatch.mockImplementation(() => void order.push("dispatch"));

    press("ArrowUp", { shiftKey: true });

    expect(order).toEqual(["preempt", "dispatch"]);
  });
});

describe("Backspace", () => {
  it("toggles snap", () => {
    const h = harness([], []);
    expect(press("Backspace")).toBe(true);
    expect(h.toggleSnap).toHaveBeenCalledTimes(1);
  });
});

/*
 * Round 6 #10. SPEC §4.4's keyboard list ends with "`PgUp/PgDn` zoom" and
 * nothing was bound to either key. Horizontal zoom, about the grid's centre —
 * there is no cursor to anchor on, and anchoring at the left edge would walk
 * the view rightwards with every press.
 */
describe("PgUp / PgDn zoom", () => {
  it("zooms in about the grid centre on PgUp", () => {
    const h = harness([], []);
    const before = h.getView();

    expect(press("PageUp")).toBe(true);

    expect(h.setView).toHaveBeenCalledTimes(1);
    expect(h.getView().zoomX).toBeCloseTo(before.zoomX * ZOOM_KEY_FACTOR, 6);
  });

  it("zooms out on PgDn", () => {
    const h = harness([], []);
    const before = h.getView();

    expect(press("PageDown")).toBe(true);

    expect(h.getView().zoomX).toBeCloseTo(before.zoomX / ZOOM_KEY_FACTOR, 6);
  });

  it("keeps the tick at the grid's centre under the grid's centre", () => {
    const h = harness([], []);
    // Zoom in far enough that the bar is wider than the grid — until then
    // the whole pattern fits, `scrollX` is pinned at 0 by `clampScroll`, and
    // no anchoring is possible (or wanted).
    for (let i = 0; i < 4; i += 1) press("PageUp");

    const before = h.getView();
    const centreX = KEYBOARD_WIDTH + gridWidth(before) / 2;
    const anchorTick = xToTick(before, centreX);

    press("PageUp");

    expect(xToTick(h.getView(), centreX)).toBeCloseTo(anchorTick, 6);
  });

  it("returns to where it started after a PgUp/PgDn round trip", () => {
    const h = harness([], []);
    const before = h.getView();

    press("PageUp");
    press("PageDown");

    expect(h.getView().zoomX).toBeCloseTo(before.zoomX, 6);
    expect(h.getView().scrollX).toBeCloseTo(before.scrollX, 6);
  });

  it("never zooms past the clamp, however many times it is pressed", () => {
    const h = harness([], []);
    for (let i = 0; i < 40; i += 1) press("PageUp");
    expect(h.getView().zoomX).toBe(MAX_ZOOM_X);

    for (let i = 0; i < 80; i += 1) press("PageDown");
    expect(h.getView().zoomX).toBe(MIN_ZOOM_X);
  });

  it("does not fire with a modifier held — those are the browser's", () => {
    const h = harness([], []);
    expect(press("PageUp", { ctrlKey: true })).toBe(false);
    expect(h.setView).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------- keyboard vs. a live drag ---- */

describe("a mutating keystroke pre-empts the drag in flight (round 11 #1)", () => {
  /**
   * The two halves of the roll wired to each other exactly as `PianoRoll.tsx`
   * wires them: the controller registered with the app-wide gesture registry,
   * the bindings dispatching through the shared one-shot path, and a dispatch
   * that really APPLIES each command — which is what makes the bug reachable
   * here. `Delete` mid-drag removed the notes while the controller went on
   * holding snapshots of them, and the next `pointermove` built
   * `updateNotes` for ids the project no longer had. `requireNote` throws in
   * `apply`, so this harness reproduces the crash rather than describing it.
   */
  function liveHarness() {
    const note = makeNote({ id: "n-drag", pitch: 60, positionTicks: TICKS_PER_BEAT });
    let project = addNotes(PATTERN, [note]).apply(fixtureProject());
    const view = createViewport({ width: 800, height: 500 });

    const notesOf = (): Note[] =>
      Object.values(project.patterns[PATTERN]!.notes).filter((n) => n.channelId === "ch-kick");

    const dispatch = (command: Command): void => {
      project = command.apply(project);
    };

    let selectedNoteIds: string[] = [];

    const controller = createPianoRollController({
      getScene: () => ({
        view,
        notes: notesOf(),
        patternId: PATTERN,
        channelId: "ch-kick",
        snap: "quarterBeat",
        tool: "draw",
        selectedNoteIds,
        lastLengthTicks: TICKS_PER_STEP,
      }),
      dispatch,
      setSelection: (ids) => {
        selectedNoteIds = ids;
      },
      setView: () => {},
      setLastLength: () => {},
      setDragKind: () => {},
      setPreviewPitch: () => {},
      previewNote: () => {},
      createNoteId: () => "n-new",
      registerGesture: (end) => registerExternalGesture(end),
    });

    const unregister = registerPianoRollBindings({
      getScene: () => ({ patternId: PATTERN, notes: notesOf(), selectedNoteIds }),
      dispatch,
      setSelection: (ids) => {
        selectedNoteIds = ids;
      },
      toggleSnap: () => {},
      getView: () => view,
      setView: () => {},
    });

    const at = (n: Note, dx = 0): RollPointer => {
      const rect = noteRect(view, n);
      return {
        x: rect.x + rect.width / 2 + dx,
        y: rect.y + rect.height / 2,
        button: 0,
        altKey: false,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
      };
    };

    return { controller, note, at, notesOf, unregister, project: () => project };
  }

  beforeEach(() => {
    __resetGestureCounterForTests();
  });

  it("cancels the controller's drag, so the next pointermove cannot resurrect deleted notes", () => {
    const h = liveHarness();

    h.controller.pointerDown(h.at(h.note));
    expect(h.controller.peekGesture()).toBe("move");

    press("Delete");

    expect(h.notesOf()).toHaveLength(0);
    // The gesture — and with it the snapshots naming `n-drag` — is gone.
    expect(h.controller.peekGesture()).toBe("idle");

    // The crash: this used to dispatch `updateNotes` for a deleted id.
    expect(() => h.controller.pointerMove(h.at(h.note, 40))).not.toThrow();
    expect(h.notesOf()).toHaveLength(0);

    h.unregister();
  });

  it("leaves an unrelated gesture-less press alone", () => {
    const h = liveHarness();
    press("Delete"); // nothing selected, nothing in flight
    expect(h.notesOf()).toHaveLength(1);
    h.unregister();
  });
});
