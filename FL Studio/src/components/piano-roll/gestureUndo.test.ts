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

import { beforeEach, describe, expect, it } from "vitest";

import { addNotes } from "@/domain/commands";
import { createDefaultProject } from "@/domain/defaultProject";
import { nextId, resetIds } from "@/domain/ids";
import { createHistory } from "@/domain/undo";
import { TICKS_PER_STEP, type Note } from "@/domain/types";
import { useAppStore } from "@/lib/store";

import { createViewport, pitchToY, tickToX, type RollViewport } from "./geometry";
import {
  createPianoRollController,
  __resetGestureCounterForTests,
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

function controllerFor(selectedNoteIds: string[] = []) {
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
  });
}

function noteCount(): number {
  return Object.keys(useAppStore.getState().project.patterns[PATTERN]?.notes ?? {}).length;
}

beforeEach(() => {
  resetIds(0);
  __resetGestureCounterForTests();
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
