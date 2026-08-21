/**
 * Keyboard-binding tests: the bindings are registered in the real registry
 * (`src/lib/keyboard.ts`) and fired through `dispatchKeyEvent`, so the combo
 * itself — not just the handler — is under test. Effects land on a mocked
 * dispatch and are asserted by applying the command to a fixture project.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addNotes, type Command } from "@/domain/commands";
import { fixtureProject } from "@/domain/testKit";
import { DEFAULT_VELOCITY, TICKS_PER_STEP, type Note, type Project } from "@/domain/types";
import {
  __resetKeyboardRegistryForTests,
  dispatchKeyEvent,
  getAllBindings,
} from "@/lib/keyboard";

import {
  PIANO_ROLL_SURFACE_ID,
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
  const unregister = registerPianoRollBindings({
    getScene: () => ({ patternId: PATTERN, notes, selectedNoteIds }),
    dispatch,
    setSelection,
    toggleSnap,
  });

  const applied = (): Project => {
    let project = addNotes(PATTERN, notes).apply(fixtureProject());
    for (const command of commands) project = command.apply(project);
    return project;
  };

  return { dispatch, setSelection, toggleSnap, commands, applied, unregister };
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

describe("Backspace", () => {
  it("toggles snap", () => {
    const h = harness([], []);
    expect(press("Backspace")).toBe(true);
    expect(h.toggleSnap).toHaveBeenCalledTimes(1);
  });
});
