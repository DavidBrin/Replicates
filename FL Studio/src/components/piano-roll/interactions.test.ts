/**
 * Gesture state-machine tests (SPEC §7 — "interaction state machine tests …
 * via a mocked dispatch").
 *
 * The controller is driven with synthetic pointer records and every assertion
 * is made against the **command payload** it dispatches — a command is applied
 * to a real fixture project whenever the *result* matters, so the test proves
 * the edit, not just the call shape. No DOM, no canvas, no store.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { addNotes, type Command } from "@/domain/commands";
import { fixtureProject } from "@/domain/testKit";
import {
  DEFAULT_VELOCITY,
  PATTERN_LENGTH_TICKS,
  TICKS_PER_BAR,
  TICKS_PER_BEAT,
  TICKS_PER_STEP,
  type Note,
  type Project,
} from "@/domain/types";

import {
  KEYBOARD_WIDTH,
  createViewport,
  gripRect,
  noteRect,
  pitchToY,
  tickToX,
  velocityToY,
  type RollViewport,
} from "./geometry";
import {
  __resetGestureCounterForTests,
  createPianoRollController,
  hitTestNote,
  hitTestVelocityStem,
  minLengthTicks,
  snapTick,
  type InteractionDeps,
  type InteractionScene,
  type RollPointer,
} from "./interactions";
import type { RollTool } from "./uiState";

/* --------------------------------------------------------------- harness -- */

const VIEW: RollViewport = createViewport({ width: 800, height: 500 });

/** The default project's first channel and only pattern — the roll's target. */
const CHANNEL = "ch-kick";
const PATTERN = fixtureProject().activePatternId;

function makeNote(patch: Partial<Note> = {}): Note {
  return {
    id: "n-1",
    channelId: CHANNEL,
    positionTicks: 0,
    lengthTicks: TICKS_PER_STEP,
    pitch: 67,
    velocity: DEFAULT_VELOCITY,
    ...patch,
  };
}

interface Harness {
  controller: ReturnType<typeof createPianoRollController>;
  dispatch: ReturnType<typeof vi.fn>;
  setSelection: ReturnType<typeof vi.fn>;
  setView: ReturnType<typeof vi.fn>;
  setLastLength: ReturnType<typeof vi.fn>;
  setDragKind: ReturnType<typeof vi.fn>;
  setPreviewPitch: ReturnType<typeof vi.fn>;
  previewNote: ReturnType<typeof vi.fn>;
  scene: InteractionScene;
  /** The last command dispatched, with its coalesce key. */
  last: () => { command: Command; coalesceKey?: string };
  commands: () => Command[];
  /** Apply every dispatched command to a fixture project, in order. */
  applied: () => Project;
}

function harness(
  overrides: Partial<InteractionScene> = {},
  extraDeps: Partial<InteractionDeps> = {},
): Harness {
  const scene: InteractionScene = {
    view: VIEW,
    notes: [],
    patternId: PATTERN,
    channelId: CHANNEL,
    snap: "quarterBeat",
    tool: "draw" as RollTool,
    selectedNoteIds: [],
    lastLengthTicks: TICKS_PER_STEP,
    ...overrides,
  };

  const calls: { command: Command; coalesceKey?: string }[] = [];
  const dispatch = vi.fn((command: Command, options?: { coalesceKey?: string }) => {
    calls.push({ command, coalesceKey: options?.coalesceKey });
  });
  const setSelection = vi.fn((ids: string[]) => {
    scene.selectedNoteIds = ids;
  });
  const setView = vi.fn();
  const setLastLength = vi.fn();
  const setDragKind = vi.fn();
  const setPreviewPitch = vi.fn();
  const previewNote = vi.fn();
  let idCounter = 0;

  const controller = createPianoRollController({
    // A *copy*, exactly like the host's `buildScene()`: each `getScene()` call
    // is a snapshot, so a handler that reads the scene it took at entry cannot
    // see a `setSelection` it made afterwards. Handing out the mutable object
    // hid a real staleness bug (`gestureSet` read the pre-click selection).
    getScene: () => ({ ...scene }),
    dispatch,
    setSelection,
    setView,
    setLastLength,
    setDragKind,
    setPreviewPitch,
    previewNote,
    createNoteId: () => {
      idCounter += 1;
      return `new-${idCounter}`;
    },
    ...extraDeps,
  });

  return {
    controller,
    dispatch,
    setSelection,
    setView,
    setLastLength,
    setDragKind,
    setPreviewPitch,
    previewNote,
    scene,
    last: () => {
      const entry = calls[calls.length - 1];
      if (entry === undefined) throw new Error("no command dispatched");
      return entry;
    },
    commands: () => calls.map((entry) => entry.command),
    applied: () => {
      const base = fixtureProject();
      // Seed the scene's notes so update/remove commands have something to hit.
      let project =
        scene.notes.length > 0
          ? addNotes(base.activePatternId, scene.notes as Note[]).apply(base)
          : base;
      for (const { command } of calls) project = command.apply(project);
      return project;
    },
  };
}

/** A pointer at a musical position rather than a raw pixel. */
function at(tick: number, pitch: number, patch: Partial<RollPointer> = {}): RollPointer {
  return {
    x: tickToX(VIEW, tick),
    y: pitchToY(VIEW, pitch) + 5,
    button: 0,
    ...patch,
  };
}

beforeEach(() => {
  __resetGestureCounterForTests();
});

/* ---------------------------------------------------------- hit-testing -- */

describe("hit-testing", () => {
  const note = makeNote({ lengthTicks: TICKS_PER_BEAT });

  it("finds the note under the pointer and reports the body", () => {
    const rect = noteRect(VIEW, note);
    const hit = hitTestNote(VIEW, [note], rect.x + 3, rect.y + 3);
    expect(hit).toEqual({ note, zone: "body" });
  });

  it("reports the grip on the right edge and the body just left of it", () => {
    const grip = gripRect(VIEW, note);
    expect(hitTestNote(VIEW, [note], grip.x + 1, grip.y + 3)?.zone).toBe("grip");
    expect(hitTestNote(VIEW, [note], grip.x - 2, grip.y + 3)?.zone).toBe("body");
  });

  it("misses one pixel past the right edge and one row below", () => {
    const rect = noteRect(VIEW, note);
    expect(hitTestNote(VIEW, [note], rect.x + rect.width + 0.5, rect.y + 3)).toBeNull();
    expect(hitTestNote(VIEW, [note], rect.x + 3, rect.y + rect.height + 1)).toBeNull();
  });

  it("returns the topmost note when two overlap", () => {
    const under = makeNote({ id: "under", lengthTicks: TICKS_PER_BEAT });
    const over = makeNote({ id: "over", positionTicks: TICKS_PER_STEP, lengthTicks: TICKS_PER_BEAT });
    const rect = noteRect(VIEW, over);
    expect(hitTestNote(VIEW, [under, over], rect.x + 2, rect.y + 3)?.note.id).toBe("over");
  });

  it("hits a zero-length step note, which paints one step wide", () => {
    const step = makeNote({ lengthTicks: 0 });
    const rect = noteRect(VIEW, step);
    expect(hitTestNote(VIEW, [step], rect.x + rect.width - 2, rect.y + 2)).not.toBeNull();
  });

  it("snaps a velocity-lane grab to the nearest stem within the slop", () => {
    const stemX = tickToX(VIEW, 0);
    expect(hitTestVelocityStem(VIEW, [note], stemX + 4)?.id).toBe(note.id);
    expect(hitTestVelocityStem(VIEW, [note], stemX + 40)).toBeNull();
  });
});

describe("snap helpers", () => {
  it("snaps to the unit, and to a whole tick when Alt bypasses", () => {
    expect(snapTick(30, "quarterBeat", false)).toBe(TICKS_PER_STEP);
    expect(snapTick(30.4, "quarterBeat", true)).toBe(30);
    expect(snapTick(60, "beat", false)).toBe(TICKS_PER_BEAT);
  });

  it("keeps a resize at least one snap cell long, one tick when bypassed", () => {
    expect(minLengthTicks("quarterBeat", false)).toBe(TICKS_PER_STEP);
    expect(minLengthTicks("beat", false)).toBe(TICKS_PER_BEAT);
    expect(minLengthTicks("quarterBeat", true)).toBe(1);
    expect(minLengthTicks("off", false)).toBe(1);
  });
});

/* ---------------------------------------------------------------- draw -- */

describe("draw (left-click on empty grid)", () => {
  it("adds a note of the SNAP UNIT's length, ignoring lastLengthTicks (SPEC §4's Piano Roll table)", () => {
    const h = harness({ snap: "beat", lastLengthTicks: TICKS_PER_STEP });
    h.controller.pointerDown(at(TICKS_PER_BEAT + 7, 64));
    h.controller.pointerUp(at(TICKS_PER_BEAT + 7, 64));

    const project = h.applied();
    const notes = Object.values(project.patterns[project.activePatternId]?.notes ?? {});
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      channelId: CHANNEL,
      positionTicks: TICKS_PER_BEAT,
      lengthTicks: TICKS_PER_BEAT,
      pitch: 64,
      velocity: DEFAULT_VELOCITY,
    });
  });

  it("draws a bar-long note when snap is Bar", () => {
    const h = harness({ snap: "bar", lastLengthTicks: TICKS_PER_STEP });
    h.controller.pointerDown(at(0, 60));
    const project = h.applied();
    const notes = Object.values(project.patterns[project.activePatternId]?.notes ?? {});
    expect(notes[0]?.lengthTicks).toBe(TICKS_PER_BAR);
  });

  it("falls back to the last-resized length when snap is off", () => {
    const h = harness({ snap: "off", lastLengthTicks: TICKS_PER_BEAT * 1.5 });
    h.controller.pointerDown(at(0, 60));
    const project = h.applied();
    const notes = Object.values(project.patterns[project.activePatternId]?.notes ?? {});
    expect(notes[0]?.lengthTicks).toBe(TICKS_PER_BEAT * 1.5);
  });

  it("floors to the snap cell the click fell in, never forward to the next one", () => {
    const h = harness();
    h.controller.pointerDown(at(TICKS_PER_STEP * 2 - 1, 60));
    const project = h.applied();
    const notes = Object.values(project.patterns[project.activePatternId]?.notes ?? {});
    expect(notes[0]?.positionTicks).toBe(TICKS_PER_STEP);
  });

  it("places at the raw tick when Alt bypasses snap", () => {
    const h = harness();
    h.controller.pointerDown(at(TICKS_PER_STEP + 7, 60, { altKey: true }));
    const project = h.applied();
    const notes = Object.values(project.patterns[project.activePatternId]?.notes ?? {});
    expect(notes[0]?.positionTicks).toBe(TICKS_PER_STEP + 7);
  });

  it("selects the new note, auditions it, and arms a move gesture", () => {
    const h = harness();
    h.controller.pointerDown(at(0, 60));
    expect(h.setSelection).toHaveBeenCalledWith(["new-1"]);
    expect(h.previewNote).toHaveBeenCalledWith(CHANNEL, 60);
    expect(h.controller.peekGesture()).toBe("move");
    expect(h.setDragKind).toHaveBeenCalledWith("move");
  });

  it("never draws a zero-length note — a roll note always has duration", () => {
    const h = harness({ snap: "off", lastLengthTicks: 0 });
    h.controller.pointerDown(at(0, 60));
    const project = h.applied();
    const notes = Object.values(project.patterns[project.activePatternId]?.notes ?? {});
    expect(notes[0]?.lengthTicks).toBeGreaterThan(0);
  });

  it("draws nothing on empty grid with the select tool — it clears the selection", () => {
    const h = harness({ tool: "select", selectedNoteIds: ["n-1"] });
    h.controller.pointerDown(at(0, 60));
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.setSelection).toHaveBeenCalledWith([]);
  });

  it("clicking past the pattern's end still lands inside it — a note may never exceed PATTERN_LENGTH_TICKS", () => {
    const h = harness({ snap: "bar", lastLengthTicks: TICKS_PER_STEP });
    // A click past the 1-bar pattern but still on the visible canvas; a
    // bar-long note can only start at 0.
    h.controller.pointerDown(at(PATTERN_LENGTH_TICKS + TICKS_PER_BAR, 60));
    const project = h.applied();
    const notes = Object.values(project.patterns[project.activePatternId]?.notes ?? {});
    expect(notes[0]?.positionTicks).toBe(0);
    expect((notes[0]?.positionTicks ?? 0) + (notes[0]?.lengthTicks ?? 0)).toBeLessThanOrEqual(
      PATTERN_LENGTH_TICKS,
    );
  });

  it("clamps a quarter-beat note drawn right at the pattern boundary to fit inside it", () => {
    const h = harness({ snap: "quarterBeat" });
    h.controller.pointerDown(at(PATTERN_LENGTH_TICKS - 1, 60));
    const project = h.applied();
    const notes = Object.values(project.patterns[project.activePatternId]?.notes ?? {});
    expect((notes[0]?.positionTicks ?? 0) + (notes[0]?.lengthTicks ?? 0)).toBeLessThanOrEqual(
      PATTERN_LENGTH_TICKS,
    );
  });
});

/* ---------------------------------------------------------------- move -- */

describe("move (drag the note body)", () => {
  const note = makeNote({ positionTicks: TICKS_PER_BEAT, lengthTicks: TICKS_PER_BEAT, pitch: 67 });

  function grabBody(h: Harness, patch: Partial<RollPointer> = {}): RollPointer {
    const rect = noteRect(VIEW, note);
    const point = { x: rect.x + 4, y: rect.y + 4, button: 0, ...patch };
    h.controller.pointerDown(point);
    return point;
  }

  it("moves by whole snap cells and reports absolute positions", () => {
    const h = harness({ notes: [note] });
    const start = grabBody(h);
    h.controller.pointerMove({ ...start, x: start.x + tickToX(VIEW, TICKS_PER_STEP) - KEYBOARD_WIDTH });

    const project = h.applied();
    const moved = project.patterns[project.activePatternId]?.notes[note.id];
    expect(moved?.positionTicks).toBe(TICKS_PER_BEAT + TICKS_PER_STEP);
    expect(moved?.pitch).toBe(67);
  });

  it("changes pitch by whole rows when dragged vertically", () => {
    const h = harness({ notes: [note] });
    const start = grabBody(h);
    h.controller.pointerMove({ ...start, y: start.y - 21 * 3 });
    const project = h.applied();
    expect(project.patterns[project.activePatternId]?.notes[note.id]?.pitch).toBe(70);
  });

  it("locks pitch with Shift and locks time with Ctrl", () => {
    const shift = harness({ notes: [note], selectedNoteIds: [note.id] });
    const shiftPoint = grabBody(shift);
    shift.controller.pointerMove({
      ...shiftPoint,
      x: shiftPoint.x + 60,
      y: shiftPoint.y - 63,
      shiftKey: true,
    });
    const shifted = shift.applied();
    const shiftedNote = shifted.patterns[shifted.activePatternId]?.notes[note.id];
    expect(shiftedNote?.pitch).toBe(67); // pitch locked
    expect(shiftedNote?.positionTicks).toBeGreaterThan(TICKS_PER_BEAT); // time free

    const ctrl = harness({ notes: [note], selectedNoteIds: [note.id] });
    const ctrlPoint = grabBody(ctrl);
    ctrl.controller.pointerMove({
      ...ctrlPoint,
      x: ctrlPoint.x + 60,
      y: ctrlPoint.y - 42,
      ctrlKey: true,
    });
    const ctrlProject = ctrl.applied();
    const ctrlNote = ctrlProject.patterns[ctrlProject.activePatternId]?.notes[note.id];
    expect(ctrlNote?.positionTicks).toBe(TICKS_PER_BEAT); // time locked
    expect(ctrlNote?.pitch).toBe(69); // pitch free
  });

  it("bypasses snap with Alt, landing on the raw tick", () => {
    const h = harness({ notes: [note] });
    const start = grabBody(h, { altKey: true });
    h.controller.pointerMove({ ...start, x: start.x + 5, altKey: true });
    const project = h.applied();
    const moved = project.patterns[project.activePatternId]?.notes[note.id];
    expect(moved?.positionTicks).not.toBe(TICKS_PER_BEAT + TICKS_PER_STEP);
    expect(moved?.positionTicks).toBeGreaterThan(TICKS_PER_BEAT);
  });

  it("folds the whole drag into ONE undo entry (one coalesce key)", () => {
    const h = harness({ notes: [note] });
    const start = grabBody(h);
    h.controller.pointerMove({ ...start, x: start.x + 30 });
    h.controller.pointerMove({ ...start, x: start.x + 60 });
    h.controller.pointerUp({ ...start, x: start.x + 60 });

    const keys = h.dispatch.mock.calls.map((call) => call[1]?.coalesceKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBeDefined();
  });

  it("moves the whole selection together, keeping relative offsets", () => {
    const other = makeNote({ id: "n-2", positionTicks: TICKS_PER_BEAT * 2, pitch: 70 });
    const h = harness({ notes: [note, other], selectedNoteIds: [note.id, other.id] });
    const start = grabBody(h);
    h.controller.pointerMove({ ...start, x: start.x + tickToX(VIEW, TICKS_PER_STEP) - KEYBOARD_WIDTH });

    const project = h.applied();
    const notes = project.patterns[project.activePatternId]?.notes;
    expect(notes?.[note.id]?.positionTicks).toBe(TICKS_PER_BEAT + TICKS_PER_STEP);
    expect(notes?.[other.id]?.positionTicks).toBe(TICKS_PER_BEAT * 2 + TICKS_PER_STEP);
  });

  it("never drags a note before tick 0", () => {
    const h = harness({ notes: [note] });
    const start = grabBody(h);
    h.controller.pointerMove({ ...start, x: start.x - 5000 });
    const project = h.applied();
    expect(
      project.patterns[project.activePatternId]?.notes[note.id]?.positionTicks,
    ).toBe(0);
  });

  it("never drags a note's end past the pattern's length", () => {
    const h = harness({ notes: [note] });
    const start = grabBody(h);
    h.controller.pointerMove({ ...start, x: start.x + 50000 });
    const project = h.applied();
    const moved = project.patterns[project.activePatternId]?.notes[note.id];
    expect((moved?.positionTicks ?? 0) + (moved?.lengthTicks ?? 0)).toBe(PATTERN_LENGTH_TICKS);
  });

  it("keeps relative offsets when a multi-note drag hits the pattern's end", () => {
    const other = makeNote({ id: "n-2", positionTicks: TICKS_PER_BEAT * 3, pitch: 70 });
    const h = harness({ notes: [note, other], selectedNoteIds: [note.id, other.id] });
    const start = grabBody(h);
    const originalGap = other.positionTicks - note.positionTicks;
    h.controller.pointerMove({ ...start, x: start.x + 50000 });
    const project = h.applied();
    const notesById = project.patterns[project.activePatternId]?.notes;
    const movedNote = notesById?.[note.id];
    const movedOther = notesById?.[other.id];
    expect((movedOther?.positionTicks ?? 0) + (movedOther?.lengthTicks ?? 0)).toBe(
      PATTERN_LENGTH_TICKS,
    );
    expect((movedOther?.positionTicks ?? 0) - (movedNote?.positionTicks ?? 0)).toBe(originalGap);
  });

  it("keeps a zero-length STEP inside the pattern, not on its end tick", () => {
    // A rack step is `lengthTicks: 0` (SPEC §2's Note), and the last cell of
    // the bar starts at 360. Clamping against the stored 0 let it slide to
    // 384 — inside the arithmetic, outside the loop, and never scheduled.
    const step = makeNote({ id: "n-step", positionTicks: PATTERN_LENGTH_TICKS - TICKS_PER_STEP, lengthTicks: 0 });
    const h = harness({ notes: [step] });
    const rect = noteRect(VIEW, step);
    const start = { x: rect.x + 2, y: rect.y + 3, button: 0 };
    h.controller.pointerDown(start);
    h.controller.pointerMove({ ...start, x: start.x + 50000 });

    const project = h.applied();
    const moved = project.patterns[project.activePatternId]?.notes[step.id];
    expect(moved?.lengthTicks).toBe(0);
    expect(moved?.positionTicks).toBe(PATTERN_LENGTH_TICKS - TICKS_PER_STEP);
    expect(moved?.positionTicks).toBeLessThan(PATTERN_LENGTH_TICKS);
  });

  it("still lets a step move RIGHT while a whole cell remains", () => {
    const step = makeNote({
      id: "n-step",
      positionTicks: PATTERN_LENGTH_TICKS - TICKS_PER_STEP * 2,
      lengthTicks: 0,
    });
    const h = harness({ notes: [step] });
    const rect = noteRect(VIEW, step);
    const start = { x: rect.x + 2, y: rect.y + 3, button: 0 };
    h.controller.pointerDown(start);
    h.controller.pointerMove({ ...start, x: start.x + 50000 });

    const project = h.applied();
    expect(
      project.patterns[project.activePatternId]?.notes[step.id]?.positionTicks,
    ).toBe(PATTERN_LENGTH_TICKS - TICKS_PER_STEP);
  });

  it("emits nothing while the pointer stays inside the same snap cell", () => {
    const h = harness({ notes: [note] });
    const start = grabBody(h);
    h.dispatch.mockClear();
    h.controller.pointerMove({ ...start, x: start.x + 1 });
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("ignores pointer moves when no gesture is in flight", () => {
    const h = harness({ notes: [note] });
    h.controller.pointerMove(at(0, 60));
    expect(h.dispatch).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------- resize -- */

describe("resize (drag the right-edge grip)", () => {
  const note = makeNote({ positionTicks: 0, lengthTicks: TICKS_PER_BEAT, pitch: 67 });

  function grabGrip(h: Harness, patch: Partial<RollPointer> = {}): RollPointer {
    const grip = gripRect(VIEW, note);
    const point = { x: grip.x + 2, y: grip.y + 4, button: 0, ...patch };
    h.controller.pointerDown(point);
    return point;
  }

  it("changes only the length, snapped, leaving position and pitch alone", () => {
    const h = harness({ notes: [note] });
    const start = grabGrip(h);
    h.controller.pointerMove({ ...start, x: tickToX(VIEW, TICKS_PER_BEAT * 2) });

    const project = h.applied();
    const resized = project.patterns[project.activePatternId]?.notes[note.id];
    expect(resized?.lengthTicks).toBe(TICKS_PER_BEAT * 2);
    expect(resized?.positionTicks).toBe(0);
    expect(resized?.pitch).toBe(67);
  });

  it("never shrinks below one snap cell", () => {
    const h = harness({ notes: [note] });
    const start = grabGrip(h);
    h.controller.pointerMove({ ...start, x: KEYBOARD_WIDTH - 500 });
    const project = h.applied();
    expect(
      project.patterns[project.activePatternId]?.notes[note.id]?.lengthTicks,
    ).toBe(TICKS_PER_STEP);
  });

  it("never resizes a note's end past the pattern's length", () => {
    const h = harness({ notes: [note] });
    const start = grabGrip(h);
    h.controller.pointerMove({ ...start, x: tickToX(VIEW, PATTERN_LENGTH_TICKS * 3) });
    const project = h.applied();
    const resized = project.patterns[project.activePatternId]?.notes[note.id];
    expect((resized?.positionTicks ?? 0) + (resized?.lengthTicks ?? 0)).toBe(
      PATTERN_LENGTH_TICKS,
    );
  });

  it("cannot overrun the bar even when the snap minimum is longer than what is left", () => {
    // 1 tick of room at position 383, with a 24-tick snap minimum: nesting
    // the minimum inside the clamp produced a 24-tick note ending at 407.
    const tail = makeNote({ id: "n-tail", positionTicks: PATTERN_LENGTH_TICKS - 1, lengthTicks: 1 });
    const h = harness({ notes: [tail], snap: "quarterBeat" });
    const grip = gripRect(VIEW, tail);
    const start = { x: grip.x + 1, y: grip.y + 4, button: 0 };
    h.controller.pointerDown(start);
    h.controller.pointerMove({ ...start, x: start.x + 500 });

    const project = h.applied();
    const resized = project.patterns[project.activePatternId]?.notes[tail.id];
    expect(resized?.positionTicks).toBe(PATTERN_LENGTH_TICKS - 1);
    expect(resized?.lengthTicks).toBe(1); // all the room there is
    expect((resized?.positionTicks ?? 0) + (resized?.lengthTicks ?? 0)).toBeLessThanOrEqual(
      PATTERN_LENGTH_TICKS,
    );
  });

  it("keeps every note of a multi-note resize inside the bar, each by its own room", () => {
    const early = makeNote({ id: "n-early", positionTicks: 0, lengthTicks: TICKS_PER_STEP });
    const tail = makeNote({
      id: "n-tail",
      positionTicks: PATTERN_LENGTH_TICKS - 6,
      lengthTicks: 2,
      pitch: 70,
    });
    const h = harness({
      notes: [early, tail],
      selectedNoteIds: [early.id, tail.id],
      snap: "quarterBeat",
    });
    const grip = gripRect(VIEW, early);
    const start = { x: grip.x + 1, y: grip.y + 4, button: 0 };
    h.controller.pointerDown(start);
    h.controller.pointerMove({ ...start, x: start.x + 500 });

    const project = h.applied();
    const notes = project.patterns[project.activePatternId]?.notes;
    for (const id of [early.id, tail.id]) {
      const resized = notes?.[id];
      expect((resized?.positionTicks ?? 0) + (resized?.lengthTicks ?? 0)).toBeLessThanOrEqual(
        PATTERN_LENGTH_TICKS,
      );
      expect(resized?.lengthTicks).toBeGreaterThanOrEqual(1);
    }
    // The one with room still grew — a boundary note may not mute the drag.
    expect(notes?.[early.id]?.lengthTicks).toBeGreaterThan(early.lengthTicks);
  });

  /*
   * Round 16 #1. `deltaTicks` moving is not proof that a LENGTH moved: with
   * every selected note already flush against the pattern's end the clamp
   * hands back the length each note already has, so dragging further right
   * dispatched patches identical to the project — an undo entry that undoes
   * nothing, one per pointermove.
   */
  it("dispatches nothing when every selected note is already flush with the pattern end", () => {
    const full = makeNote({ positionTicks: 0, lengthTicks: PATTERN_LENGTH_TICKS });
    const h = harness({ notes: [full] });
    const grip = gripRect(VIEW, full);
    const start = { x: grip.x + 1, y: grip.y + 4, button: 0 };
    h.controller.pointerDown(start);
    h.controller.pointerMove({ ...start, x: start.x + 200 });
    h.controller.pointerMove({ ...start, x: start.x + 400 });

    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("still remembers the length for the next drawn note across a no-op resize", () => {
    // The bail is about the WRITE, not about the gesture: the drag happened,
    // and the length it settled on still seeds the next drawn note.
    const full = makeNote({ positionTicks: 0, lengthTicks: PATTERN_LENGTH_TICKS });
    const h = harness({ notes: [full] });
    const grip = gripRect(VIEW, full);
    const start = { x: grip.x + 1, y: grip.y + 4, button: 0 };
    h.controller.pointerDown(start);
    h.controller.pointerMove({ ...start, x: start.x + 200 });
    h.controller.pointerUp(start);

    expect(h.setLastLength).toHaveBeenCalledWith(PATTERN_LENGTH_TICKS);
  });

  it("still dispatches for the notes that DO have room beside one that does not", () => {
    const early = makeNote({ id: "n-early", positionTicks: 0, lengthTicks: TICKS_PER_STEP });
    const full = makeNote({
      id: "n-full",
      positionTicks: PATTERN_LENGTH_TICKS - 2,
      lengthTicks: 2,
      pitch: 70,
    });
    const h = harness({
      notes: [early, full],
      selectedNoteIds: [early.id, full.id],
      snap: "quarterBeat",
    });
    const grip = gripRect(VIEW, early);
    const start = { x: grip.x + 1, y: grip.y + 4, button: 0 };
    h.controller.pointerDown(start);
    h.controller.pointerMove({ ...start, x: start.x + 300 });

    expect(h.dispatch).toHaveBeenCalled();
    const project = h.applied();
    const notes = project.patterns[project.activePatternId]?.notes;
    expect(notes?.[early.id]?.lengthTicks).toBeGreaterThan(early.lengthTicks);
    expect(notes?.[full.id]?.lengthTicks).toBe(2);
  });

  it("remembers the new length as the next drawn note's length", () => {
    const h = harness({ notes: [note] });
    const start = grabGrip(h);
    h.controller.pointerMove({ ...start, x: tickToX(VIEW, TICKS_PER_BEAT * 2) });
    h.controller.pointerUp(start);
    expect(h.setLastLength).toHaveBeenCalledWith(TICKS_PER_BEAT * 2);
  });

  it("is one undo entry, like every other drag", () => {
    const h = harness({ notes: [note] });
    const start = grabGrip(h);
    h.controller.pointerMove({ ...start, x: start.x + 40 });
    h.controller.pointerMove({ ...start, x: start.x + 90 });
    const keys = h.dispatch.mock.calls.map((call) => call[1]?.coalesceKey);
    expect(new Set(keys).size).toBe(1);
  });

  /*
   * A rack step stores `lengthTicks: 0` — a marker, not a length — and is
   * painted one cell wide, grip included. The resize used to anchor at the
   * stored zero, i.e. a whole cell LEFT of the grip the user grabbed: dragging
   * to the next boundary produced a one-step note (no growth at all) and
   * merely holding the grip still rewrote the marker into a 1-tick length.
   */
  describe("a step note (lengthTicks 0) resizes from the grip, not from tick 0", () => {
    const step = makeNote({ id: "n-step", positionTicks: 0, lengthTicks: 0, pitch: 67 });

    function grabStepGrip(h: Harness): RollPointer {
      const grip = gripRect(VIEW, step);
      const point = { x: grip.x + 2, y: grip.y + 4, button: 0 };
      h.controller.pointerDown(point);
      return point;
    }

    it("grows to TWO steps when dragged one step past the grip", () => {
      const h = harness({ notes: [step], snap: "quarterBeat" });
      const start = grabStepGrip(h);
      h.controller.pointerMove({ ...start, x: tickToX(VIEW, TICKS_PER_STEP * 2) });

      const project = h.applied();
      expect(project.patterns[project.activePatternId]?.notes[step.id]?.lengthTicks).toBe(
        TICKS_PER_STEP * 2,
      );
    });

    it("dispatches nothing at all when the grip does not move", () => {
      const h = harness({ notes: [step], snap: "quarterBeat" });
      const start = grabStepGrip(h);
      h.controller.pointerMove({ ...start });
      h.controller.pointerUp(start);

      expect(h.dispatch).not.toHaveBeenCalled();
      // …so the marker is still a marker.
      const project = h.applied();
      expect(project.patterns[project.activePatternId]?.notes[step.id]?.lengthTicks).toBe(0);
    });

    it("remembers the step's effective length, not its stored zero", () => {
      const h = harness({ notes: [step], snap: "quarterBeat" });
      const start = grabStepGrip(h);
      h.controller.pointerUp(start);
      expect(h.setLastLength).toHaveBeenCalledWith(TICKS_PER_STEP);
    });

    /*
     * Round 5 #6. "Dispatched nothing" above only holds when the grip never
     * moved at all: `lastDeltaTicks` starts at 0, so the first move is
     * short-circuited. Drag the grip AWAY and back and the delta returns to 0
     * through a non-zero value, so the short-circuit no longer fires — and the
     * write that then landed stored `effectiveLengthTicks(0)`, silently
     * promoting the marker to a 24-tick note. A resize that ends where it
     * began must put the STORED length back.
     */
    it("restores the stored ZERO when the grip is dragged away and back", () => {
      const h = harness({ notes: [step], snap: "quarterBeat" });
      const start = grabStepGrip(h);
      h.controller.pointerMove({ ...start, x: tickToX(VIEW, TICKS_PER_STEP * 4) });
      h.controller.pointerMove({ ...start });
      h.controller.pointerUp(start);

      const project = h.applied();
      expect(project.patterns[project.activePatternId]?.notes[step.id]?.lengthTicks).toBe(0);
    });

    it("still remembers ONE STEP as the draw length after that round trip", () => {
      const h = harness({ notes: [step], snap: "quarterBeat" });
      const start = grabStepGrip(h);
      h.controller.pointerMove({ ...start, x: tickToX(VIEW, TICKS_PER_STEP * 4) });
      h.controller.pointerMove({ ...start });
      h.controller.pointerUp(start);

      // A remembered 0 would mean "one TICK" to `defaultDrawLengthTicks`.
      expect(h.setLastLength).toHaveBeenLastCalledWith(TICKS_PER_STEP);
    });

    /*
     * Round 6 #1. The round trip above only restored the stored length when
     * snap was FINER than the note: the origin end was snapped *before* the
     * `minLength` floor applied, so with a coarser snap a zero-pixel drag
     * still computed a non-zero delta — 24 ticks became a whole beat under
     * beat snap and a whole BAR under bar snap, and the restoration above
     * never fired because `deltaTicks` was never 0. Zero pointer displacement
     * is zero delta at every snap setting, so the question is asked of the
     * pointer, before snap gets a vote.
     */
    it.each(["beat", "bar"] as const)(
      "restores the stored zero under %s snap, coarser than the note",
      (snap) => {
        const h = harness({ notes: [step], snap });
        const start = grabStepGrip(h);
        h.controller.pointerMove({ ...start, x: tickToX(VIEW, TICKS_PER_BAR) });
        h.controller.pointerMove({ ...start });
        h.controller.pointerUp(start);

        const project = h.applied();
        expect(project.patterns[project.activePatternId]?.notes[step.id]?.lengthTicks).toBe(0);
      },
    );

    it.each(["beat", "bar"] as const)(
      "dispatches nothing when the grip never moves under %s snap",
      (snap) => {
        const h = harness({ notes: [step], snap });
        const start = grabStepGrip(h);
        h.controller.pointerMove({ ...start });
        h.controller.pointerUp(start);

        expect(h.dispatch).not.toHaveBeenCalled();
      },
    );

    it("leaves a SHORT ordinary note alone on a zero-pixel drag under bar snap", () => {
      const note = makeNote({ id: "n-short", positionTicks: 0, lengthTicks: TICKS_PER_STEP });
      const h = harness({ notes: [note], snap: "bar" });
      const grip = gripRect(VIEW, note);
      const start = { x: grip.x + 2, y: grip.y + 4, button: 0 };
      h.controller.pointerDown(start);
      h.controller.pointerMove({ ...start });
      h.controller.pointerUp(start);

      expect(h.dispatch).not.toHaveBeenCalled();
      const project = h.applied();
      expect(project.patterns[project.activePatternId]?.notes[note.id]?.lengthTicks).toBe(
        TICKS_PER_STEP,
      );
    });

    it("still grows to a whole bar when the grip really is dragged there", () => {
      const h = harness({ notes: [step], snap: "bar" });
      const start = grabStepGrip(h);
      h.controller.pointerMove({ ...start, x: tickToX(VIEW, TICKS_PER_BAR) });

      const project = h.applied();
      expect(project.patterns[project.activePatternId]?.notes[step.id]?.lengthTicks).toBe(
        TICKS_PER_BAR,
      );
    });

    it("leaves an ORDINARY note's length untouched by the same round trip", () => {
      const note = makeNote({ id: "n-real", positionTicks: 0, lengthTicks: TICKS_PER_BEAT });
      const h = harness({ notes: [note], snap: "quarterBeat" });
      const grip = gripRect(VIEW, note);
      const start = { x: grip.x + 2, y: grip.y + 4, button: 0 };
      h.controller.pointerDown(start);
      h.controller.pointerMove({ ...start, x: tickToX(VIEW, TICKS_PER_BEAT * 3) });
      h.controller.pointerMove({ ...start });
      h.controller.pointerUp(start);

      const project = h.applied();
      expect(project.patterns[project.activePatternId]?.notes[note.id]?.lengthTicks).toBe(
        TICKS_PER_BEAT,
      );
    });
  });
});

/* -------------------------------------------------------------- delete -- */

describe("delete (right-click and right-drag sweep)", () => {
  const first = makeNote({ id: "n-1", positionTicks: 0, pitch: 67 });
  const second = makeNote({ id: "n-2", positionTicks: TICKS_PER_BEAT, pitch: 67 });

  it("removes the note under a right-click", () => {
    const h = harness({ notes: [first, second] });
    const rect = noteRect(VIEW, first);
    h.controller.pointerDown({ x: rect.x + 3, y: rect.y + 3, button: 2 });

    const project = h.applied();
    const notes = project.patterns[project.activePatternId]?.notes ?? {};
    expect(notes[first.id]).toBeUndefined();
    expect(notes[second.id]).toBeDefined();
  });

  it("sweeps: a right-drag erases every note it crosses, once each", () => {
    const h = harness({ notes: [first, second] });
    const firstRect = noteRect(VIEW, first);
    const secondRect = noteRect(VIEW, second);
    h.controller.pointerDown({ x: firstRect.x + 3, y: firstRect.y + 3, button: 2 });
    h.controller.pointerMove({ x: firstRect.x + 4, y: firstRect.y + 3, button: 2 });
    h.controller.pointerMove({ x: secondRect.x + 3, y: secondRect.y + 3, button: 2 });

    expect(h.commands()).toHaveLength(2);
    const keys = h.dispatch.mock.calls.map((call) => call[1]?.coalesceKey);
    expect(new Set(keys).size).toBe(1); // one sweep, one undo entry
  });

  it("right-clicking empty grid deletes nothing", () => {
    const h = harness({ notes: [first] });
    h.controller.pointerDown({ x: tickToX(VIEW, TICKS_PER_BEAT * 3), y: pitchToY(VIEW, 60), button: 2 });
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("the delete tool erases on LEFT click too", () => {
    const h = harness({ notes: [first], tool: "delete" });
    const rect = noteRect(VIEW, first);
    h.controller.pointerDown({ x: rect.x + 3, y: rect.y + 3, button: 0 });
    const project = h.applied();
    expect(project.patterns[project.activePatternId]?.notes[first.id]).toBeUndefined();
  });
});

/* ------------------------------------------------------------ velocity -- */

describe("velocity", () => {
  const note = makeNote({ positionTicks: TICKS_PER_BEAT, pitch: 67, velocity: 0.5 });

  it("sets velocity from the y a lane drag lands on", () => {
    const h = harness({ notes: [note] });
    const x = tickToX(VIEW, note.positionTicks);
    h.controller.pointerDown({ x, y: velocityToY(VIEW, 0.5), button: 0 });
    h.controller.pointerMove({ x, y: velocityToY(VIEW, 0.9), button: 0 });

    const project = h.applied();
    expect(
      project.patterns[project.activePatternId]?.notes[note.id]?.velocity,
    ).toBeCloseTo(0.9, 6);
  });

  it("clamps to 0..1 and stays one undo entry for the drag", () => {
    const h = harness({ notes: [note] });
    const x = tickToX(VIEW, note.positionTicks);
    h.controller.pointerDown({ x, y: velocityToY(VIEW, 0.5), button: 0 });
    h.controller.pointerMove({ x, y: -400, button: 0 });
    h.controller.pointerMove({ x, y: 5000, button: 0 });

    const project = h.applied();
    expect(project.patterns[project.activePatternId]?.notes[note.id]?.velocity).toBe(0);
    const keys = h.dispatch.mock.calls.map((call) => call[1]?.coalesceKey);
    expect(new Set(keys).size).toBe(1);
  });

  it("alt+wheel over a note nudges its velocity", () => {
    const h = harness({ notes: [note] });
    const rect = noteRect(VIEW, note);
    const consumed = h.controller.wheel({
      x: rect.x + 3,
      y: rect.y + 3,
      button: 0,
      altKey: true,
      deltaX: 0,
      deltaY: -100,
    });
    expect(consumed).toBe(true);
    const project = h.applied();
    expect(
      project.patterns[project.activePatternId]?.notes[note.id]?.velocity,
    ).toBeGreaterThan(note.velocity);
  });

  it("coalesces a RAPID alt+wheel burst on one note into a single undo entry", () => {
    const h = harness({ notes: [note] });
    const rect = noteRect(VIEW, note);
    const point = { x: rect.x + 3, y: rect.y + 3, button: 0, altKey: true, deltaX: 0 };
    h.controller.wheel({ ...point, deltaY: -100 });
    h.controller.wheel({ ...point, deltaY: -100 });
    h.controller.wheel({ ...point, deltaY: -100 });
    const keys = h.dispatch.mock.calls.map((call) => call[1]?.coalesceKey);
    expect(new Set(keys).size).toBe(1);
  });

  it("gives two SEPARATE alt+wheel sessions on the same note two undo entries", () => {
    vi.useFakeTimers();
    try {
      const h = harness({ notes: [note] });
      const rect = noteRect(VIEW, note);
      const point = { x: rect.x + 3, y: rect.y + 3, button: 0, altKey: true, deltaX: 0 };
      h.controller.wheel({ ...point, deltaY: -100 });
      vi.advanceTimersByTime(1000); // past WHEEL_GESTURE_GAP_MS — a new gesture
      h.controller.wheel({ ...point, deltaY: -100 });
      const keys = h.dispatch.mock.calls.map((call) => call[1]?.coalesceKey);
      expect(new Set(keys).size).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives two DIFFERENT notes two undo entries even wheeled back to back", () => {
    const other = makeNote({ id: "n-2", positionTicks: TICKS_PER_BEAT * 2, pitch: 70 });
    const h = harness({ notes: [note, other] });
    const rect = noteRect(VIEW, note);
    const otherRect = noteRect(VIEW, other);
    h.controller.wheel({ x: rect.x + 3, y: rect.y + 3, button: 0, altKey: true, deltaX: 0, deltaY: -100 });
    h.controller.wheel({
      x: otherRect.x + 3,
      y: otherRect.y + 3,
      button: 0,
      altKey: true,
      deltaX: 0,
      deltaY: -100,
    });
    const keys = h.dispatch.mock.calls.map((call) => call[1]?.coalesceKey);
    expect(new Set(keys).size).toBe(2);
  });

  /*
   * The coalesce target is (pattern, note), not just note. `makeUnique` clones
   * a pattern keeping every note id, so "the same note" in the source and in
   * the clone are two different notes — and a nudge on each, inside the wheel
   * gap, folded into ONE undo entry spanning two patterns.
   */
  it("gives the SAME note id in two patterns two undo entries", () => {
    const h = harness({ notes: [note] });
    const rect = noteRect(VIEW, note);
    const point = { x: rect.x + 3, y: rect.y + 3, button: 0, altKey: true, deltaX: 0 };
    h.controller.wheel({ ...point, deltaY: -100 });
    h.scene.patternId = "pat-clone";
    h.controller.wheel({ ...point, deltaY: -100 });

    const keys = h.dispatch.mock.calls.map((call) => call[1]?.coalesceKey);
    expect(new Set(keys).size).toBe(2);
  });

  /*
   * …and the (pattern, note) pair is ENCODED, not joined with a separator.
   * Ids are arbitrary strings in an imported file, so `${pattern}:${note}` was
   * not injective: ("pat:1", "n-2") and ("pat", "1:n-2") produced one target,
   * and two nudges on genuinely different notes folded into one undo entry.
   */
  it("keeps two different (pattern, note) pairs apart even when their ids contain colons", () => {
    const colonNote = makeNote({ id: "1:n-2", positionTicks: 0, pitch: 67 });
    const h = harness({ notes: [colonNote], patternId: "pat" });
    const rect = noteRect(VIEW, colonNote);
    const point = { x: rect.x + 3, y: rect.y + 3, button: 0, altKey: true, deltaX: 0 };
    h.controller.wheel({ ...point, deltaY: -100 });

    // The other pair that the naive join collapsed onto the same string.
    h.scene.patternId = "pat:1";
    h.scene.notes = [makeNote({ id: "n-2", positionTicks: 0, pitch: 67 })];
    h.controller.wheel({ ...point, deltaY: -100 });

    const keys = h.dispatch.mock.calls.map((call) => call[1]?.coalesceKey);
    expect(new Set(keys).size).toBe(2);
  });

  it("alt+wheel over empty grid changes nothing", () => {
    const h = harness({ notes: [note] });
    expect(
      h.controller.wheel({
        x: tickToX(VIEW, TICKS_PER_BEAT * 3),
        y: pitchToY(VIEW, 60),
        button: 0,
        altKey: true,
        deltaX: 0,
        deltaY: -100,
      }),
    ).toBe(false);
    expect(h.dispatch).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------- zoom, pan, keys -- */

describe("zoom, pan and the preview keyboard", () => {
  it("ctrl+wheel zooms horizontally at the cursor, never editing notes", () => {
    const h = harness({ notes: [makeNote()] });
    expect(
      h.controller.wheel({ x: 400, y: 200, button: 0, ctrlKey: true, deltaX: 0, deltaY: -100 }),
    ).toBe(true);
    expect(h.dispatch).not.toHaveBeenCalled();
    const patch = h.setView.mock.calls[0]?.[0] as { zoomX: number };
    expect(patch.zoomX).toBeGreaterThan(VIEW.zoomX);
  });

  it("ctrl+alt+wheel zooms VERTICALLY at the cursor instead, never editing notes", () => {
    const h = harness({ notes: [makeNote()] });
    expect(
      h.controller.wheel({
        x: 400,
        y: 200,
        button: 0,
        ctrlKey: true,
        altKey: true,
        deltaX: 0,
        deltaY: -100,
      }),
    ).toBe(true);
    expect(h.dispatch).not.toHaveBeenCalled();
    const patch = h.setView.mock.calls[0]?.[0] as { zoomX?: number; zoomY: number };
    expect(patch.zoomY).toBeGreaterThan(VIEW.zoomY);
    expect(patch.zoomX).toBeUndefined(); // the X axis is untouched
  });

  it("middle-drag pans both axes and edits nothing", () => {
    const h = harness({ notes: [makeNote()] });
    h.controller.pointerDown({ x: 400, y: 200, button: 1 });
    h.controller.pointerMove({ x: 360, y: 160, button: 1 });
    expect(h.controller.peekGesture()).toBe("pan");
    expect(h.dispatch).not.toHaveBeenCalled();
    const patch = h.setView.mock.calls[0]?.[0] as { scrollX: number; scrollY: number };
    expect(patch.scrollX).toBeGreaterThanOrEqual(VIEW.scrollX);
    expect(patch.scrollY).toBe(VIEW.scrollY + 40);
  });

  it("clicking the keyboard column auditions that pitch and edits nothing", () => {
    const h = harness();
    h.controller.pointerDown({ x: 20, y: pitchToY(VIEW, 65) + 4, button: 0 });
    expect(h.previewNote).toHaveBeenCalledWith(CHANNEL, 65);
    expect(h.dispatch).not.toHaveBeenCalled();
    h.controller.pointerUp({ x: 20, y: pitchToY(VIEW, 65) + 4, button: 0 });
    expect(h.controller.peekGesture()).toBe("idle");
  });

  it("plain wheel scrolls vertically, shift+wheel horizontally", () => {
    const h = harness();
    h.controller.wheel({ x: 400, y: 200, button: 0, deltaX: 0, deltaY: 100 });
    const vertical = h.setView.mock.calls[0]?.[0] as { scrollY: number };
    expect(vertical.scrollY).toBeGreaterThan(VIEW.scrollY);

    h.setView.mockClear();
    h.controller.wheel({ x: 400, y: 200, button: 0, shiftKey: true, deltaX: 0, deltaY: 100 });
    const horizontal = h.setView.mock.calls[0]?.[0] as { scrollX: number; scrollY: number };
    expect(horizontal.scrollY).toBe(VIEW.scrollY);
  });

  it("reports a cursor per region, so the host never re-implements hit-testing", () => {
    const note = makeNote({ lengthTicks: TICKS_PER_BEAT, pitch: 67 });
    const h = harness({ notes: [note] });
    const rect = noteRect(VIEW, note);
    const grip = gripRect(VIEW, note);
    expect(h.controller.cursorAt({ x: 20, y: 200, button: 0 })).toBe("pointer");
    expect(h.controller.cursorAt({ x: rect.x + 2, y: rect.y + 3, button: 0 })).toBe("move");
    expect(h.controller.cursorAt({ x: grip.x + 1, y: grip.y + 3, button: 0 })).toBe("ew-resize");
    expect(h.controller.cursorAt({ x: 600, y: 200, button: 0 })).toBe("cell");
  });

  it("cancel during a keyboard audition releases the held key", () => {
    const h = harness();
    const point = { x: 20, y: pitchToY(VIEW, 65) + 4, button: 0 };
    h.controller.pointerDown(point);
    expect(h.setPreviewPitch).toHaveBeenLastCalledWith(65);

    // The browser steals the pointer (a scroll, a gesture) — there is no
    // pointerup, so nothing else will ever clear the highlight.
    h.controller.cancel();

    expect(h.setPreviewPitch).toHaveBeenLastCalledWith(null);
    expect(h.controller.peekGesture()).toBe("idle");
  });

  it("cancel drops the gesture without dispatching", () => {
    const h = harness();
    h.controller.pointerDown({ x: 400, y: 200, button: 1 });
    h.controller.cancel();
    expect(h.controller.peekGesture()).toBe("idle");
    expect(h.setDragKind).toHaveBeenLastCalledWith(null);
  });
});

/* --------------------------------------------------------------- clone -- */

describe("shift+left-click clone", () => {
  it("adds copies of the selection and drags the copies, leaving the originals", () => {
    const note = makeNote({ positionTicks: TICKS_PER_BEAT, pitch: 67 });
    const h = harness({ notes: [note], selectedNoteIds: [note.id] });
    const rect = noteRect(VIEW, note);
    h.controller.pointerDown({ x: rect.x + 3, y: rect.y + 3, button: 0, shiftKey: true });

    const project = h.applied();
    const notes = project.patterns[project.activePatternId]?.notes ?? {};
    expect(Object.keys(notes)).toHaveLength(2);
    expect(notes[note.id]).toMatchObject({ positionTicks: TICKS_PER_BEAT, pitch: 67 });
    expect(h.setSelection).toHaveBeenLastCalledWith(["new-1"]);
  });

  it("clones the selection the CLICK produced, not the one before it", () => {
    // Shift-clicking an unselected note selects it first; the clone must be of
    // that note, not of whatever was selected a moment earlier.
    const clicked = makeNote({ id: "n-clicked", positionTicks: TICKS_PER_BEAT, pitch: 67 });
    const other = makeNote({ id: "n-other", positionTicks: 0, pitch: 70 });
    const h = harness({ notes: [clicked, other], selectedNoteIds: [other.id] });
    const rect = noteRect(VIEW, clicked);
    h.controller.pointerDown({ x: rect.x + 3, y: rect.y + 3, button: 0, shiftKey: true });

    const project = h.applied();
    const notes = project.patterns[project.activePatternId]?.notes ?? {};
    expect(Object.keys(notes)).toHaveLength(3); // two originals + ONE clone
    expect(notes["new-1"]).toMatchObject({ positionTicks: TICKS_PER_BEAT, pitch: 67 });
  });

  /*
   * Round 5 #7. The whole clone drag snaps against ONE primary clone, and the
   * primary used to be picked by matching `clone.pitch === hit.note.pitch` —
   * not injective. Two selected notes on the same row (an ordinary repeated
   * voice) made the FIRST of them primary whichever one was grabbed, so the
   * drag measured from a baseline the user never touched and the whole clone
   * set landed offset by the gap between the two.
   */
  it("anchors the drag on the clone of the note actually GRABBED, not the first at that pitch", () => {
    // Same pitch, and the LATE one sits OFF the snap grid — so which clone is
    // primary decides where the whole set lands, not just which id leads.
    const early = makeNote({ id: "n-early", positionTicks: 0, pitch: 67 });
    const late = makeNote({ id: "n-late", positionTicks: 101, pitch: 67 }); // 101 % 24 = 5
    const h = harness({
      notes: [early, late],
      selectedNoteIds: [early.id, late.id],
      snap: "quarterBeat",
    });

    // Grab the LATE one; `early` shares its pitch and comes first in the set.
    const rect = noteRect(VIEW, late);
    const start = { x: rect.x + 3, y: rect.y + 3, button: 0, shiftKey: true };
    h.controller.pointerDown(start);
    h.controller.pointerMove({
      ...start,
      x: start.x + tickToX(VIEW, TICKS_PER_STEP) - KEYBOARD_WIDTH,
    });

    const notes = h.applied().patterns[PATTERN]?.notes ?? {};
    // `new-1` clones `early`, `new-2` clones `late` (index-aligned with `source`).
    //
    // Snapping is measured from the PRIMARY: 101 + 24 = 125 snaps to 120, so
    // the grabbed note's clone lands ON the grid and the other rides along at
    // the same +19. Anchoring on `early` instead snapped 0 + 24 to 24 and put
    // the grabbed note's clone at 125 — off the grid the user was snapping to.
    expect(notes["new-2"]?.positionTicks).toBe(120);
    expect(notes["new-2"]!.positionTicks % TICKS_PER_STEP).toBe(0);
    expect(notes["new-1"]?.positionTicks).toBe(19);
    // The originals never moved.
    expect(notes[early.id]?.positionTicks).toBe(0);
    expect(notes[late.id]?.positionTicks).toBe(101);
  });
});

/* ------------------------------------------------------------ Ctrl-click -- */

/*
 * Ctrl+click is a selection gesture and nothing else, whatever the tool.
 *
 * It used to run the additive toggle and then FALL THROUGH to the branches
 * below it whenever the tool was not `select`: Ctrl+Shift+click added the note
 * to the selection and immediately cloned it, and a plain Ctrl+click began a
 * move drag whose note set came from the pre-click selection.
 */
describe("Ctrl+click adds to the selection and starts nothing", () => {
  const first = makeNote({ id: "n-1", positionTicks: 0, pitch: 67 });
  const second = makeNote({ id: "n-2", positionTicks: TICKS_PER_BEAT, pitch: 70 });

  function ctrlClick(h: Harness, note: Note, patch: Partial<RollPointer> = {}): void {
    const rect = noteRect(VIEW, note);
    h.controller.pointerDown({ x: rect.x + 3, y: rect.y + 3, button: 0, ctrlKey: true, ...patch });
  }

  it("adds a note to the selection with the DRAW tool, without dragging it", () => {
    const h = harness({ notes: [first, second], selectedNoteIds: [first.id], tool: "draw" });
    ctrlClick(h, second);

    expect(h.setSelection).toHaveBeenCalledWith([first.id, second.id]);
    expect(h.controller.peekGesture()).toBe("idle");
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("removes an already-selected note, with the draw tool too", () => {
    const h = harness({ notes: [first, second], selectedNoteIds: [first.id, second.id] });
    ctrlClick(h, first);
    expect(h.setSelection).toHaveBeenCalledWith([second.id]);
    expect(h.controller.peekGesture()).toBe("idle");
  });

  it("does NOT clone when Shift is held too — the selection toggle wins", () => {
    const h = harness({ notes: [first, second], selectedNoteIds: [first.id], tool: "draw" });
    ctrlClick(h, second, { shiftKey: true });

    expect(h.dispatch).not.toHaveBeenCalled(); // no addNotes: nothing was cloned
    expect(h.setSelection).toHaveBeenCalledWith([first.id, second.id]);
    expect(h.controller.peekGesture()).toBe("idle");
    expect(Object.keys(h.applied().patterns[PATTERN]?.notes ?? {})).toHaveLength(2);
  });

  it("keeps behaving as before with the select tool", () => {
    const h = harness({ notes: [first, second], selectedNoteIds: [first.id], tool: "select" });
    ctrlClick(h, second);
    expect(h.setSelection).toHaveBeenCalledWith([first.id, second.id]);
    expect(h.controller.peekGesture()).toBe("idle");
  });

  /*
   * Round 5 #3. The erase branch is matched BEFORE this one, and it used to
   * fire on `scene.tool === "delete"` alone — so with the delete tool active
   * the only gesture the app has for "add this to the selection" deleted the
   * note instead. Ctrl outranks a tool; the right-click delete below does not
   * change, because it is not a modifier gesture.
   */
  it("SELECTS rather than erases with the DELETE tool active", () => {
    const h = harness({ notes: [first, second], selectedNoteIds: [first.id], tool: "delete" });
    ctrlClick(h, second);

    expect(h.setSelection).toHaveBeenCalledWith([first.id, second.id]);
    expect(h.controller.peekGesture()).toBe("idle");
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(Object.keys(h.applied().patterns[PATTERN]?.notes ?? {})).toHaveLength(2);
  });

  it("de-selects rather than erases with the DELETE tool active", () => {
    const h = harness({ notes: [first, second], selectedNoteIds: [first.id, second.id], tool: "delete" });
    ctrlClick(h, first);

    expect(h.setSelection).toHaveBeenCalledWith([second.id]);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("does NOT rescue a RIGHT-click from deletion — that binding is unconditional", () => {
    const h = harness({ notes: [first, second], tool: "delete" });
    const rect = noteRect(VIEW, first);
    h.controller.pointerDown({ x: rect.x + 3, y: rect.y + 3, button: 2, ctrlKey: true });

    const project = h.applied();
    expect(project.patterns[project.activePatternId]?.notes[first.id]).toBeUndefined();
  });

  it("still starts an erase SWEEP on Ctrl+click over EMPTY grid with the delete tool", () => {
    // No note to select, so the delete tool keeps the grid it owns: the sweep
    // must still arm, or a Ctrl-held drag across notes would erase nothing.
    const h = harness({ notes: [first, second], tool: "delete" });
    h.controller.pointerDown(at(TICKS_PER_BEAT * 3, 60, { ctrlKey: true }));

    expect(h.controller.peekGesture()).toBe("erase");
    expect(h.dispatch).not.toHaveBeenCalled(); // nothing under the pointer yet
  });

  /*
   * And the drag that follows the NEXT press acts on the selection the press
   * itself produced: `gestureSet` used to read `getScene()`'s snapshot, taken
   * before the click's own `setSelection`.
   */
  it("the following plain drag moves the whole Ctrl-built selection", () => {
    const h = harness({ notes: [first, second], selectedNoteIds: [first.id], tool: "draw" });
    ctrlClick(h, second);

    const rect = noteRect(VIEW, second);
    const start = { x: rect.x + 3, y: rect.y + 3, button: 0 };
    h.controller.pointerDown(start);
    h.controller.pointerMove({ ...start, x: start.x + tickToX(VIEW, TICKS_PER_BEAT) - KEYBOARD_WIDTH });

    const notes = h.applied().patterns[PATTERN]?.notes ?? {};
    expect(notes[first.id]?.positionTicks).toBe(TICKS_PER_BEAT);
    expect(notes[second.id]?.positionTicks).toBe(TICKS_PER_BEAT * 2);
  });
});

/* ---------------------------------------------------- a rack with nothing -- */

/*
 * A project with no channels at all — every channel deleted, or a crafted
 * import. The host has no channel to name, so it reports `channelId: ""`, and
 * `addNotes` rejects a note whose channel does not exist: a click on the grid
 * threw a `CommandError` out of a React pointer handler.
 */
describe("no channel to draw into", () => {
  it("draws nothing, dispatches nothing, starts no drag", () => {
    const h = harness({ channelId: "" });

    h.controller.pointerDown(at(TICKS_PER_BEAT, 64));

    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.setSelection).not.toHaveBeenCalled();
    expect(h.controller.peekGesture()).toBe("idle");
  });

  it("auditions nothing from the keyboard column", () => {
    const h = harness({ channelId: "" });

    h.controller.pointerDown({ x: KEYBOARD_WIDTH / 2, y: 200, button: 0 });

    expect(h.previewNote).not.toHaveBeenCalled();
    expect(h.setPreviewPitch).not.toHaveBeenCalled();
    expect(h.controller.peekGesture()).toBe("idle");
  });

  it("still draws once a channel exists", () => {
    const h = harness();
    h.controller.pointerDown(at(TICKS_PER_BEAT, 64));
    expect(h.dispatch).toHaveBeenCalled();
  });
});

/* --------------------------------------------------- pointer ownership -- */

/**
 * Round 12's class fix, at the surface that dropped the id entirely: a
 * `RollPointer` carried no `pointerId`, so the machine could not tell the
 * pointer that opened a drag from any other, and the registry could not tell
 * the drag was a pointer gesture at all.
 */
describe("a roll drag belongs to the pointer that opened it", () => {
  it("ignores moves from another pointer", () => {
    const note = makeNote();
    const h = harness({ notes: [note], tool: "draw" });

    h.controller.pointerDown(at(0, 67, { pointerId: 1 }));
    const beforeStranger = h.dispatch.mock.calls.length;

    h.controller.pointerMove(at(TICKS_PER_BEAT * 3, 72, { pointerId: 2 }));

    expect(h.dispatch.mock.calls.length).toBe(beforeStranger);
    expect(h.controller.peekGesture()).toBe("move");
  });

  it("ignores a release from another pointer — the drag stays in flight", () => {
    const note = makeNote();
    const h = harness({ notes: [note], tool: "draw" });

    h.controller.pointerDown(at(0, 67, { pointerId: 1 }));
    h.controller.pointerUp(at(0, 67, { pointerId: 2 }));
    expect(h.controller.peekGesture()).toBe("move");

    // The owner's move still lands, which is the half a "just end it" fix
    // gets wrong: the gesture must be alive, not merely un-ended.
    h.controller.pointerMove(at(TICKS_PER_BEAT, 67, { pointerId: 1 }));
    expect(h.last().command.label).toBe("Edit note");

    h.controller.pointerUp(at(TICKS_PER_BEAT, 67, { pointerId: 1 }));
    expect(h.controller.peekGesture()).toBe("idle");
  });

  it("ignores a pointercancel from another pointer", () => {
    const h = harness({ notes: [makeNote()], tool: "draw" });
    h.controller.pointerDown(at(0, 67, { pointerId: 1 }));

    h.controller.cancel(at(0, 67, { pointerId: 2 }));
    expect(h.controller.peekGesture()).toBe("move");

    // An EXTERNAL cancel (no pointer at all — unmount, undo, pre-emption)
    // is unconditional.
    h.controller.cancel();
    expect(h.controller.peekGesture()).toBe("idle");
  });

  it("registers the drag under its pointer id, so the registry can pre-empt it", () => {
    /*
     * Registered with `null`, a roll drag claimed no press: `gestureHold`'s
     * same-press exemption then treated EVERY later pointer-down as its
     * nesting partner, so nothing could ever pre-empt it — a knob drag
     * started under a live roll drag left two gestures open at once.
     */
    const registerGesture = vi.fn(
      (_end: () => void, _options?: { pointerId?: number | null }) => () => {},
    );
    const h = harness({ notes: [makeNote()], tool: "draw" }, { registerGesture });

    h.controller.pointerDown(at(0, 67, { pointerId: 4 }));

    expect(registerGesture).toHaveBeenCalledTimes(1);
    expect(registerGesture.mock.calls[0]![1]).toEqual({ pointerId: 4 });
  });

  it("seals the gesture in flight BEFORE installing a new pointer's", () => {
    const h = harness({ notes: [makeNote()], tool: "draw" });

    h.controller.pointerDown(at(0, 67, { pointerId: 1 }));
    h.controller.pointerDown(at(TICKS_PER_BEAT * 2, 60, { pointerId: 2 }));

    // The new press owns the roll now: its moves drive, the old pointer's
    // do not.
    expect(h.controller.peekGesture()).toBe("move");
    const before = h.dispatch.mock.calls.length;
    h.controller.pointerMove(at(TICKS_PER_BEAT * 3, 60, { pointerId: 1 }));
    expect(h.dispatch.mock.calls.length).toBe(before);
    h.controller.pointerMove(at(TICKS_PER_BEAT * 3, 60, { pointerId: 2 }));
    expect(h.dispatch.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("Alt+wheel velocity nudges go through the gesture registry", () => {
  it("pre-empts whatever drag is open before dispatching", () => {
    /*
     * Round 12 #2. A wheel run's key comes from a keyring, so it cannot take a
     * one-shot id per notch without losing the coalescing that makes the run
     * one Ctrl+Z — and it therefore dispatched past the registry entirely,
     * leaving another pointer's drag open across the edit.
     */
    const preemptGestures = vi.fn();
    const note = makeNote();
    const h = harness({ notes: [note] }, { preemptGestures });

    h.controller.wheel({ ...at(0, 67), altKey: true, deltaX: 0, deltaY: -1 });

    expect(preemptGestures).toHaveBeenCalledTimes(1);
    expect(h.last().command.label).toBe("Edit note");
  });

  it("does NOT pre-empt for zoom or scroll — they write no domain state", () => {
    const preemptGestures = vi.fn();
    const h = harness({ notes: [makeNote()] }, { preemptGestures });

    h.controller.wheel({ ...at(0, 67), ctrlKey: true, deltaX: 0, deltaY: -1 });
    h.controller.wheel({ ...at(0, 67), deltaX: 0, deltaY: 3 });

    expect(preemptGestures).not.toHaveBeenCalled();
  });
});

describe("the velocity lane can be re-opened after a full collapse", () => {
  /*
   * Round 12 #6. The splitter strip was drawn only when the lane had height,
   * so dragging the lane shut removed the only region a `lane-resize` gesture
   * can start from: `regionAt` answered "outside" everywhere below the grid
   * and the lane could never be opened again.
   */
  it("still starts a lane-resize with the lane collapsed to zero", () => {
    const collapsed = { ...VIEW, velocityLaneHeight: 0 };
    const h = harness({ view: collapsed, notes: [] });

    // The strip the collapse leaves behind: the last pixels of the canvas.
    h.controller.pointerDown({ x: 400, y: collapsed.height - 1, button: 0, pointerId: 1 });
    expect(h.controller.peekGesture()).toBe("lane-resize");

    // And dragging it back up restores a usable lane.
    h.controller.pointerMove({ x: 400, y: collapsed.height - 90, button: 0, pointerId: 1 });
    const patch = h.setView.mock.calls.at(-1)![0] as { velocityLaneHeight: number };
    expect(patch.velocityLaneHeight).toBeGreaterThan(0);
  });
});

/*
 * Round 14 #5. The keyboard column and the splitter were decided BEFORE the
 * primary-button guard the grid branches share, so both ran for any button
 * §4.4 does not give them. Right-clicking the key column played the note and
 * left a `preview` gesture open waiting for a `pointerup` a context menu may
 * never deliver; right-clicking the splitter started a lane resize that then
 * tracked the pointer with no button held. §4.4: left-click is
 * "draw/add/activate", right-click is "delete (content areas); context menu"
 * — neither branch is either of those.
 */
describe("the keyboard column and the splitter are PRIMARY-button only (round 14)", () => {
  const keyboardPoint = { x: 20, y: pitchToY(VIEW, 65) + 4 };

  it("does not audition on a secondary press in the keyboard column", () => {
    const h = harness();

    h.controller.pointerDown({ ...keyboardPoint, button: 2, pointerId: 1 });

    expect(h.previewNote).not.toHaveBeenCalled();
    expect(h.setPreviewPitch).not.toHaveBeenCalled();
    expect(h.controller.peekGesture()).toBe("idle");
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("leaves no key lit and no gesture open after that secondary press moves", () => {
    const h = harness();
    h.controller.pointerDown({ ...keyboardPoint, button: 2, pointerId: 1 });

    h.controller.pointerMove({ x: 20, y: pitchToY(VIEW, 72) + 4, button: 2, pointerId: 1 });

    expect(h.previewNote).not.toHaveBeenCalled();
    expect(h.controller.peekGesture()).toBe("idle");
  });

  it("still auditions on a primary press", () => {
    const h = harness();

    h.controller.pointerDown({ ...keyboardPoint, button: 0, pointerId: 1 });

    expect(h.previewNote).toHaveBeenCalledWith(CHANNEL, 65);
    expect(h.controller.peekGesture()).toBe("preview");
  });

  it("does not start a lane resize from a secondary press on the splitter", () => {
    const collapsed = { ...VIEW, velocityLaneHeight: 0 };
    const h = harness({ view: collapsed, notes: [] });

    h.controller.pointerDown({ x: 400, y: collapsed.height - 1, button: 2, pointerId: 1 });

    expect(h.controller.peekGesture()).toBe("idle");
    // …and a later move must not drag the lane open either.
    h.controller.pointerMove({ x: 400, y: collapsed.height - 90, button: 2, pointerId: 1 });
    expect(h.setView).not.toHaveBeenCalled();
  });

  it("still starts a lane resize from a primary press on the splitter", () => {
    const collapsed = { ...VIEW, velocityLaneHeight: 0 };
    const h = harness({ view: collapsed, notes: [] });

    h.controller.pointerDown({ x: 400, y: collapsed.height - 1, button: 0, pointerId: 1 });

    expect(h.controller.peekGesture()).toBe("lane-resize");
  });

  /* The middle button is still the pan, decided before either branch. */
  it("keeps the middle button's pan in both regions", () => {
    const h = harness();
    h.controller.pointerDown({ ...keyboardPoint, button: 1, pointerId: 1 });
    expect(h.controller.peekGesture()).toBe("pan");
    expect(h.previewNote).not.toHaveBeenCalled();
  });
});
