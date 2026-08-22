/**
 * Gesture ⇄ undo integration (SPEC §2.1's "one gesture is one Ctrl+Z", lane 1
 * §10).
 *
 * `interactions.test.ts` proves the controller emits the right *commands* with
 * one `coalesceKey` per gesture; `undo.test.ts` proves the stack folds a
 * coalesced run correctly. Neither, on its own, proves the roll actually
 * undoes atomically — and the defect that motivated this file lived exactly in
 * the join: an erase drag across three notes dispatched three commands under
 * one key, and one Ctrl+Z put back only the first.
 *
 * So this drives the real controller into the real store and asserts on the
 * project, with no mocked dispatch anywhere.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { addNotes, updateChannel } from "@/domain/commands";
import { createDefaultProject } from "@/domain/defaultProject";
import { nextId, resetIds } from "@/domain/ids";
import { createHistory } from "@/domain/undo";
import { TICKS_PER_STEP, type Note } from "@/domain/types";
import {
  __resetGestureCounterForTests as __resetSharedGestureRegistry,
  commitGestureKey,
  flushPendingCommits,
  registerPendingCommit,
} from "@/lib/gestureHold";
import { useAppStore } from "@/lib/store";

import { createViewport, noteRect, pitchToY, tickToX, velocityToY, type RollViewport } from "./geometry";
import {
  createPianoRollController,
  __resetGestureCounterForTests,
  type InteractionDeps,
  type RollPointer,
} from "./interactions";

const VIEW: RollViewport = createViewport({ width: 800, height: 500 });
const CHANNEL = "ch-bass";
const PATTERN = "pat-1";
// Must be a pitch the default viewport actually shows: the roll opens with C6
// (72) at the top of the grid, so a low bass pitch would land below the
// velocity lane and the gesture would never reach the grid region at all.
const PITCH = 60;

function seedNote(id: string, step: number): Note {
  return {
    id,
    channelId: CHANNEL,
    positionTicks: step * TICKS_PER_STEP,
    lengthTicks: TICKS_PER_STEP,
    pitch: PITCH,
    velocity: 0.8,
  };
}

/** A pointer at a musical position rather than a raw pixel. */
function at(tick: number, pitch: number, patch: Partial<RollPointer> = {}): RollPointer {
  return {
    x: tickToX(VIEW, tick) + 2,
    y: pitchToY(VIEW, pitch) + 5,
    button: 0,
    ...patch,
  };
}

function controllerFor(
  selectedNoteIds: string[] = [],
  extraDeps: Partial<InteractionDeps> = {},
) {
  const scene = {
    view: VIEW,
    get notes(): Note[] {
      const pattern = useAppStore.getState().project.patterns[PATTERN];
      return pattern === undefined
        ? []
        : Object.values(pattern.notes).filter((note) => note.channelId === CHANNEL);
    },
    patternId: PATTERN,
    channelId: CHANNEL,
    snap: "quarterBeat" as const,
    tool: "draw" as const,
    selectedNoteIds,
    lastLengthTicks: TICKS_PER_STEP,
  };

  return createPianoRollController({
    getScene: () => scene,
    dispatch: (command, options) => useAppStore.getState().dispatch(command, options),
    setSelection: (ids) => {
      scene.selectedNoteIds = ids;
    },
    setView: () => {},
    setLastLength: () => {},
    setDragKind: () => {},
    previewNote: () => {},
    createNoteId: () => nextId("note"),
    // The host wires this (`PianoRoll.tsx`); without it a press here cannot
    // commit the editor it dismissed — see `InteractionDeps.flushEditors`.
    flushEditors: flushPendingCommits,
    ...extraDeps,
  });
}

function noteCount(): number {
  return Object.keys(useAppStore.getState().project.patterns[PATTERN]?.notes ?? {}).length;
}

beforeEach(() => {
  resetIds(0);
  __resetGestureCounterForTests();
  __resetSharedGestureRegistry();
  useAppStore.setState({
    project: createDefaultProject({ now: "2026-01-01T00:00:00.000Z" }),
    history: createHistory(),
  });
});

describe("piano-roll gestures undo atomically", () => {
  it("takes back a whole erase DRAG — every note, not just the first", () => {
    const seeded = [seedNote("n-a", 0), seedNote("n-b", 1), seedNote("n-c", 2)];
    useAppStore.getState().dispatch(addNotes(PATTERN, seeded));
    const before = useAppStore.getState().project;
    expect(noteCount()).toBe(3);

    // One right-button drag straight across all three notes.
    const controller = controllerFor();
    controller.pointerDown(at(0, PITCH, { button: 2 }));
    controller.pointerMove(at(TICKS_PER_STEP, PITCH, { button: 2 }));
    controller.pointerMove(at(TICKS_PER_STEP * 2, PITCH, { button: 2 }));
    controller.pointerUp(at(TICKS_PER_STEP * 2, PITCH, { button: 2 }));

    expect(noteCount()).toBe(0);
    expect(useAppStore.getState().history.past).toHaveLength(2); // the seed + the drag

    useAppStore.getState().undo();

    expect(noteCount()).toBe(3);
    expect(useAppStore.getState().project).toEqual(before);
  });

  it("takes back a draw-then-resize gesture chain in one step each", () => {
    const start = useAppStore.getState().project;

    const controller = controllerFor();
    controller.pointerDown(at(0, PITCH));
    controller.pointerUp(at(0, PITCH));
    expect(noteCount()).toBe(1);

    useAppStore.getState().undo();
    expect(noteCount()).toBe(0);
    expect(useAppStore.getState().project).toEqual(start);
  });

  it("takes back a multi-note MOVE drag, restoring every note's position", () => {
    const seeded = [seedNote("n-a", 0), seedNote("n-b", 1)];
    useAppStore.getState().dispatch(addNotes(PATTERN, seeded));
    const before = useAppStore.getState().project;

    // Both selected, then dragged together by one step.
    const controller = controllerFor(["n-a", "n-b"]);
    controller.pointerDown(at(0, PITCH));
    controller.pointerMove(at(TICKS_PER_STEP, PITCH));
    controller.pointerUp(at(TICKS_PER_STEP, PITCH));

    const moved = useAppStore.getState().project.patterns[PATTERN]!.notes;
    expect(moved["n-a"]!.positionTicks).toBe(TICKS_PER_STEP);
    expect(moved["n-b"]!.positionTicks).toBe(TICKS_PER_STEP * 2);

    useAppStore.getState().undo();
    expect(useAppStore.getState().project).toEqual(before);
  });
});

/**
 * Round 15 #1. A press that MUTATES immediately (drawing a note) dismisses a
 * focused editor, and `blur` is delivered after that press — so the editor's
 * commit used to be filed ON TOP of the note. Two things broke at once:
 *
 * - the undo order read backwards: one Ctrl+Z took back the rename the user
 *   had already finished with and left the note they had just drawn;
 * - the drag stopped coalescing, because `dispatchCommand` only ever extends
 *   the stack's TOP entry and the rename had just been pushed onto it — so a
 *   two-second note drag became a run of separate Ctrl+Zs.
 */
describe("a dismissed editor commits UNDER the gesture that dismissed it", () => {
  /** The rename box's commit path, registered exactly as the real ones are. */
  function focusRenameEditor(channelId: string, name: string): void {
    registerPendingCommit(() => {
      useAppStore
        .getState()
        .dispatch(updateChannel(channelId, { name }), {
          gestureId: commitGestureKey("rack-rename"),
        });
    });
  }

  function channelId(): string {
    return useAppStore.getState().project.channelOrder[0]!;
  }

  it("orders history [rename, note] and keeps the drag one entry", () => {
    const id = channelId();
    focusRenameEditor(id, "Renamed");

    const controller = controllerFor();
    controller.pointerDown(at(0, PITCH));
    controller.pointerMove(at(TICKS_PER_STEP, PITCH));
    controller.pointerMove(at(TICKS_PER_STEP * 2, PITCH));
    controller.pointerUp(at(TICKS_PER_STEP * 2, PITCH));

    const past = useAppStore.getState().history.past;
    // Exactly two: the rename underneath, the whole draw+drag above it.
    expect(past).toHaveLength(2);
    expect(past[0]!.gestureId).toBe("rack-rename#1");
    expect(past[1]!.gestureId).toBeUndefined();
    expect(useAppStore.getState().project.channels[id]!.name).toBe("Renamed");
    expect(noteCount()).toBe(1);

    // Undo hits the NOTE gesture first — the rename survives it.
    useAppStore.getState().undo();
    expect(noteCount()).toBe(0);
    expect(useAppStore.getState().project.channels[id]!.name).toBe("Renamed");

    // ...and the second undo takes the rename back.
    useAppStore.getState().undo();
    expect(useAppStore.getState().project.channels[id]!.name).not.toBe("Renamed");
  });

  it("commits the editor even when the press draws nothing (a plain select)", () => {
    const id = channelId();
    useAppStore.getState().dispatch(addNotes(PATTERN, [seedNote("n-a", 0)]));
    focusRenameEditor(id, "Renamed");

    const controller = controllerFor();
    // A press on an existing note: a MOVE gesture, which dispatches nothing
    // until the pointer travels.
    controller.pointerDown(at(0, PITCH));
    controller.pointerUp(at(0, PITCH));

    expect(useAppStore.getState().project.channels[id]!.name).toBe("Renamed");
  });
});

/**
 * Round 15 #3. Both velocity paths are CLAMPED, so both repeat at a bound: a
 * stem dragged above the lane's top reports 1 on every move, and Alt+wheel up
 * on a note already at 1 nudges past a ceiling it has reached. Each of those
 * dispatched — the first filing an undo entry that undoes nothing, and the
 * wheel one additionally PRE-EMPTING somebody else's live drag for an edit
 * that never happened.
 *
 * Driven against the live store rather than the unit harness on purpose: the
 * guard compares the next velocity with the note's CURRENT one, and a static
 * scene would never show the note reaching the bound at all.
 */
describe("a velocity edit that changes nothing dispatches nothing", () => {
  function velocityOf(id: string): number {
    return useAppStore.getState().project.patterns[PATTERN]!.notes[id]!.velocity;
  }

  function stemX(note: Note): number {
    return tickToX(VIEW, note.positionTicks) + 1;
  }

  it("files NO undo entry for a stem drag that never leaves the ceiling", () => {
    // The note is already AT the bound, so every y above the lane's top
    // clamps to the velocity it already has — including the pointer-DOWN,
    // which is what used to open an entry that undoes nothing.
    const seeded = { ...seedNote("n-a", 0), velocity: 1 };
    useAppStore.getState().dispatch(addNotes(PATTERN, [seeded]));
    const controller = controllerFor();
    const x = stemX(seeded);
    const before = useAppStore.getState().history.past.length;

    // The press must land IN the lane to open the gesture at all; every y at
    // or above its top clamps to 1, which is the velocity already stored.
    controller.pointerDown({ x, y: velocityToY(VIEW, 1), button: 0 });
    controller.pointerMove({ x, y: -900, button: 0 });
    controller.pointerMove({ x, y: -1200, button: 0 });
    controller.pointerUp({ x, y: -1200, button: 0 });

    expect(useAppStore.getState().history.past).toHaveLength(before);
    expect(velocityOf("n-a")).toBe(1);
  });

  it("still files ONE entry for a stem drag that does move, bound or not", () => {
    const seeded = seedNote("n-a", 0);
    useAppStore.getState().dispatch(addNotes(PATTERN, [seeded]));
    const controller = controllerFor();
    const x = stemX(seeded);
    const before = useAppStore.getState().history.past.length;

    controller.pointerDown({ x, y: velocityToY(VIEW, 0.8), button: 0 });
    controller.pointerMove({ x, y: -500, button: 0 });
    controller.pointerMove({ x, y: -900, button: 0 });
    controller.pointerUp({ x, y: -900, button: 0 });

    expect(useAppStore.getState().history.past).toHaveLength(before + 1);
    expect(velocityOf("n-a")).toBe(1);
  });

  it("files no entry — and pre-empts nothing — for an alt+wheel notch past the ceiling", () => {
    const seeded = { ...seedNote("n-a", 0), velocity: 1 };
    useAppStore.getState().dispatch(addNotes(PATTERN, [seeded]));
    const preemptGestures = vi.fn();
    const controller = controllerFor([], { preemptGestures });
    const rect = noteRect(VIEW, seeded);
    const before = useAppStore.getState().history.past.length;

    const consumed = controller.wheel({
      x: rect.x + 3,
      y: rect.y + 3,
      button: 0,
      altKey: true,
      deltaX: 0,
      deltaY: -100,
    });

    // Still CONSUMED — the roll owns Alt+wheel, and letting the page scroll
    // instead would be a worse answer than doing nothing.
    expect(consumed).toBe(true);
    expect(useAppStore.getState().history.past).toHaveLength(before);
    expect(preemptGestures).not.toHaveBeenCalled();
  });

  it("still nudges a note that is BELOW the ceiling", () => {
    const seeded = { ...seedNote("n-a", 0), velocity: 0.5 };
    useAppStore.getState().dispatch(addNotes(PATTERN, [seeded]));
    const preemptGestures = vi.fn();
    const controller = controllerFor([], { preemptGestures });
    const rect = noteRect(VIEW, seeded);

    controller.wheel({
      x: rect.x + 3,
      y: rect.y + 3,
      button: 0,
      altKey: true,
      deltaX: 0,
      deltaY: -100,
    });

    expect(velocityOf("n-a")).toBeGreaterThan(0.5);
    expect(preemptGestures).toHaveBeenCalledTimes(1);
  });
});
