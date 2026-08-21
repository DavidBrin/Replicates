/**
 * Hit-testing + the gesture state machine (SPEC §4.4's interaction vocabulary).
 *
 * The controller is a plain object over injected dependencies — no DOM, no
 * canvas, no React, no direct store import — so every gesture is driven in a
 * unit test by feeding it synthetic pointer events and asserting the *command
 * payloads* it dispatches (`interactions.test.ts`). The host
 * (`PianoRoll.tsx`) does nothing but translate real pointer/wheel events into
 * {@link RollPointer}s and supply the deps.
 *
 * Two rules hold everywhere, because FL's do (lane 1 §10):
 *
 * 1. **One gesture is one undo entry.** Every command a drag emits carries the
 *    same `coalesceKey`, which is what SPEC §2.1's coalescing consumes.
 * 2. **Absolute, not incremental.** A drag re-derives each note from the
 *    snapshot taken at pointer-down, so the same event replayed twice is
 *    idempotent and a dropped move event cannot accumulate drift.
 */

import {
  addNotes,
  removeNotes,
  updateNotes,
  type Command,
  type NotePatch,
} from "@/domain/commands";
import { SNAP_TICKS, snapTicks, snapTicksFloor, type SnapUnit } from "@/domain/tickMath";
import {
  DEFAULT_VELOCITY,
  PATTERN_LENGTH_TICKS,
  TICKS_PER_STEP,
  type ChannelId,
  type Note,
  type NoteId,
  type PatternId,
} from "@/domain/types";

import {
  clamp01,
  clampPitch,
  clampScroll,
  gripRect,
  noteRect,
  pxToTicks,
  rectContains,
  regionAt,
  tickToX,
  velocityToY,
  xToTick,
  yToPitch,
  yToVelocity,
  zoomAtCursor,
  type RollViewport,
} from "./geometry";
import type { RollDragKind, RollTool } from "./uiState";

/* ---------------------------------------------------------------- input -- */

/** A pointer event reduced to what the machine needs; `x`/`y` are canvas CSS px. */
export interface RollPointer {
  x: number;
  y: number;
  /** DOM `MouseEvent.button`: 0 left, 1 middle, 2 right. */
  button: number;
  altKey?: boolean;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export interface RollWheel extends RollPointer {
  deltaX: number;
  deltaY: number;
}

export interface InteractionScene {
  view: RollViewport;
  /** The target channel's notes — the only ones this roll edits. */
  notes: readonly Note[];
  patternId: PatternId;
  channelId: ChannelId;
  snap: SnapUnit;
  tool: RollTool;
  selectedNoteIds: readonly NoteId[];
  lastLengthTicks: number;
}

export interface InteractionDeps {
  getScene: () => InteractionScene;
  dispatch: (command: Command, options?: { coalesceKey?: string }) => void;
  setSelection: (noteIds: NoteId[]) => void;
  setView: (patch: Partial<RollViewport>) => void;
  setLastLength: (lengthTicks: number) => void;
  setDragKind: (dragKind: RollDragKind) => void;
  setPreviewPitch?: (pitch: number | null) => void;
  /** The ONE audition call site — SPEC §8's `previewNote(channelId, pitch)`. */
  previewNote: (channelId: ChannelId, pitch: number) => void;
  createNoteId: () => NoteId;
}

/* ------------------------------------------------------------ constants -- */

export const VELOCITY_HIT_SLOP = 6;
export const VELOCITY_WHEEL_STEP = 0.05;
export const ZOOM_WHEEL_FACTOR = 1.15;
/** Plain-wheel scroll, in rows / px per notch. */
export const WHEEL_SCROLL_PX = 60;

/* ---------------------------------------------------------- hit-testing -- */

export type NoteZone = "body" | "grip";

export interface NoteHit {
  note: Note;
  zone: NoteZone;
}

/**
 * Topmost note under the point, and whether the cursor is on its resize grip.
 *
 * Later notes paint over earlier ones, so the scan runs in reverse — the note
 * you can see is the note you grab.
 */
export function hitTestNote(
  view: RollViewport,
  notes: readonly Note[],
  x: number,
  y: number,
): NoteHit | null {
  for (let index = notes.length - 1; index >= 0; index -= 1) {
    const note = notes[index];
    if (note === undefined) continue;
    if (!rectContains(noteRect(view, note), x, y)) continue;
    return { note, zone: rectContains(gripRect(view, note), x, y) ? "grip" : "body" };
  }
  return null;
}

/** The velocity stem nearest `x`, within {@link VELOCITY_HIT_SLOP} pixels. */
export function hitTestVelocityStem(
  view: RollViewport,
  notes: readonly Note[],
  x: number,
): Note | null {
  let best: Note | null = null;
  let bestDistance = VELOCITY_HIT_SLOP;
  for (const note of notes) {
    const distance = Math.abs(tickToX(view, note.positionTicks) - x);
    if (distance <= bestDistance) {
      best = note;
      bestDistance = distance;
    }
  }
  return best;
}

/** Snap a tick to the grid, honouring the Alt-bypasses-snap rule (lane 1 §3.4). */
export function snapTick(tick: number, snap: SnapUnit, bypass: boolean): number {
  return snapTicks(tick, bypass ? "off" : snap);
}

/** The smallest length a resize may produce: one snap cell, or one tick when off. */
export function minLengthTicks(snap: SnapUnit, bypass: boolean): number {
  if (bypass || snap === "off") return 1;
  return SNAP_TICKS[snap];
}

/* ------------------------------------------------------------- gesture -- */

interface NoteSnapshot {
  id: NoteId;
  positionTicks: number;
  lengthTicks: number;
  pitch: number;
}

type Gesture =
  | { kind: "idle" }
  | {
      kind: "move";
      coalesceKey: string;
      notes: NoteSnapshot[];
      primaryId: NoteId;
      originX: number;
      originY: number;
      lastDeltaTicks: number;
      lastDeltaPitch: number;
      /** A note born from this same gesture: pointer-up must not shrink it. */
      created: boolean;
    }
  | {
      kind: "resize";
      coalesceKey: string;
      notes: NoteSnapshot[];
      primaryId: NoteId;
      originX: number;
      lastDeltaTicks: number;
      finalLengthTicks: number;
    }
  | { kind: "erase"; coalesceKey: string; erased: Set<NoteId> }
  | { kind: "pan"; originX: number; originY: number; scrollX: number; scrollY: number }
  | { kind: "velocity"; coalesceKey: string; noteId: NoteId }
  | { kind: "lane-resize"; originY: number; laneHeight: number }
  | { kind: "preview" };

export interface PianoRollController {
  pointerDown: (input: RollPointer) => void;
  pointerMove: (input: RollPointer) => void;
  pointerUp: (input: RollPointer) => void;
  /** Returns whether the wheel was consumed — the host calls `preventDefault`. */
  wheel: (input: RollWheel) => boolean;
  /** CSS cursor for a hover position, used by the host only. */
  cursorAt: (input: RollPointer) => string;
  cancel: () => void;
  /** Test seam: the gesture currently in flight. */
  peekGesture: () => Gesture["kind"];
}

let gestureCounter = 0;

function nextCoalesceKey(): string {
  gestureCounter += 1;
  return `piano-roll:${gestureCounter}`;
}

/** Test-only: make coalesce keys deterministic. */
export function __resetGestureCounterForTests(): void {
  gestureCounter = 0;
}

export function createPianoRollController(deps: InteractionDeps): PianoRollController {
  let gesture: Gesture = { kind: "idle" };

  const snapshot = (note: Note): NoteSnapshot => ({
    id: note.id,
    positionTicks: note.positionTicks,
    lengthTicks: note.lengthTicks,
    pitch: note.pitch,
  });

  /** The notes a gesture on `note` acts on: the whole selection when it is in it. */
  const gestureSet = (scene: InteractionScene, note: Note): Note[] => {
    if (!scene.selectedNoteIds.includes(note.id)) return [note];
    const byId = new Map(scene.notes.map((candidate) => [candidate.id, candidate]));
    const set = scene.selectedNoteIds
      .map((id) => byId.get(id))
      .filter((candidate): candidate is Note => candidate !== undefined);
    return set.length > 0 ? set : [note];
  };

  const beginDrag = (next: Gesture): void => {
    gesture = next;
    deps.setDragKind(dragKindOf(next));
  };

  const endDrag = (): void => {
    gesture = { kind: "idle" };
    deps.setDragKind(null);
  };

  /* --------------------------------------------------------- pointer down */

  const pointerDown = (input: RollPointer): void => {
    const scene = deps.getScene();
    const { view } = scene;
    const region = regionAt(view, input.x, input.y);

    if (input.button === 1) {
      beginDrag({
        kind: "pan",
        originX: input.x,
        originY: input.y,
        scrollX: view.scrollX,
        scrollY: view.scrollY,
      });
      return;
    }

    if (region === "keyboard") {
      const pitch = clampPitch(yToPitch(view, input.y));
      deps.previewNote(scene.channelId, pitch);
      deps.setPreviewPitch?.(pitch);
      beginDrag({ kind: "preview" });
      return;
    }

    if (region === "splitter") {
      beginDrag({ kind: "lane-resize", originY: input.y, laneHeight: view.velocityLaneHeight });
      return;
    }

    if (region === "velocity") {
      if (input.button !== 0) return;
      const note = hitTestVelocityStem(view, scene.notes, input.x);
      if (note === null) return;
      const coalesceKey = nextCoalesceKey();
      beginDrag({ kind: "velocity", coalesceKey, noteId: note.id });
      applyVelocity(scene, note.id, yToVelocity(view, input.y), coalesceKey);
      return;
    }

    if (region !== "grid") return;

    const hit = hitTestNote(view, scene.notes, input.x, input.y);

    // Right-click deletes — everywhere, and dragging keeps deleting (§4.4).
    if (input.button === 2 || scene.tool === "delete") {
      const coalesceKey = nextCoalesceKey();
      const erased = new Set<NoteId>();
      beginDrag({ kind: "erase", coalesceKey, erased });
      if (hit !== null) eraseNote(scene, hit.note.id, erased, coalesceKey);
      return;
    }

    if (input.button !== 0) return;

    if (hit === null) {
      if (scene.tool === "select") {
        deps.setSelection([]);
        return;
      }
      drawNote(scene, input);
      return;
    }

    const additive = input.ctrlKey === true;
    if (scene.tool === "select" || additive) {
      const next = additive
        ? scene.selectedNoteIds.includes(hit.note.id)
          ? scene.selectedNoteIds.filter((id) => id !== hit.note.id)
          : [...scene.selectedNoteIds, hit.note.id]
        : [hit.note.id];
      deps.setSelection([...next]);
      if (scene.tool === "select") return;
    } else if (!scene.selectedNoteIds.includes(hit.note.id)) {
      deps.setSelection([hit.note.id]);
    }

    if (hit.zone === "grip") {
      const notes = gestureSet(scene, hit.note).map(snapshot);
      beginDrag({
        kind: "resize",
        coalesceKey: nextCoalesceKey(),
        notes,
        primaryId: hit.note.id,
        originX: input.x,
        lastDeltaTicks: 0,
        finalLengthTicks: hit.note.lengthTicks,
      });
      return;
    }

    // Shift+left-click clones the selection, then drags the clones (§4.4).
    const source = gestureSet(scene, hit.note);
    const coalesceKey = nextCoalesceKey();
    if (input.shiftKey === true) {
      const clones = source.map((note) => ({ ...note, id: deps.createNoteId() }));
      deps.dispatch(addNotes(scene.patternId, clones), { coalesceKey });
      deps.setSelection(clones.map((clone) => clone.id));
      const primary = clones.find((clone) => clone.pitch === hit.note.pitch) ?? clones[0];
      beginDrag({
        kind: "move",
        coalesceKey,
        notes: clones.map(snapshot),
        primaryId: primary?.id ?? hit.note.id,
        originX: input.x,
        originY: input.y,
        lastDeltaTicks: 0,
        lastDeltaPitch: 0,
        created: true,
      });
      return;
    }

    deps.previewNote(scene.channelId, hit.note.pitch);
    beginDrag({
      kind: "move",
      coalesceKey,
      notes: source.map(snapshot),
      primaryId: hit.note.id,
      originX: input.x,
      originY: input.y,
      lastDeltaTicks: 0,
      lastDeltaPitch: 0,
      created: false,
    });
  };

  /* ---------------------------------------------------------- draw a note */

  const drawNote = (scene: InteractionScene, input: RollPointer): void => {
    const { view } = scene;
    const bypass = input.altKey === true;
    const rawTick = xToTick(view, input.x);
    const positionTicks = Math.max(
      0,
      bypass || scene.snap === "off"
        ? Math.floor(rawTick)
        : snapTicksFloor(rawTick, scene.snap),
    );
    const pitch = clampPitch(yToPitch(view, input.y));
    const lengthTicks = Math.max(1, Math.round(scene.lastLengthTicks) || TICKS_PER_STEP);
    const note: Note = {
      id: deps.createNoteId(),
      channelId: scene.channelId,
      positionTicks,
      lengthTicks,
      pitch,
      velocity: DEFAULT_VELOCITY,
    };

    const coalesceKey = nextCoalesceKey();
    deps.dispatch(addNotes(scene.patternId, [note]), { coalesceKey });
    deps.setSelection([note.id]);
    deps.previewNote(scene.channelId, pitch);
    // A fresh click may drag to reposition before release (lane 1 §3.5).
    beginDrag({
      kind: "move",
      coalesceKey,
      notes: [snapshot(note)],
      primaryId: note.id,
      originX: input.x,
      originY: input.y,
      lastDeltaTicks: 0,
      lastDeltaPitch: 0,
      created: true,
    });
  };

  const eraseNote = (
    scene: InteractionScene,
    noteId: NoteId,
    erased: Set<NoteId>,
    coalesceKey: string,
  ): void => {
    if (erased.has(noteId)) return;
    erased.add(noteId);
    deps.dispatch(removeNotes(scene.patternId, [noteId]), { coalesceKey });
    deps.setSelection(scene.selectedNoteIds.filter((id) => id !== noteId));
  };

  const applyVelocity = (
    scene: InteractionScene,
    noteId: NoteId,
    velocity: number,
    coalesceKey: string,
  ): void => {
    deps.dispatch(
      updateNotes(scene.patternId, [{ id: noteId, patch: { velocity: clamp01(velocity) } }]),
      { coalesceKey },
    );
  };

  /* --------------------------------------------------------- pointer move */

  const pointerMove = (input: RollPointer): void => {
    if (gesture.kind === "idle" || gesture.kind === "preview") return;
    const scene = deps.getScene();
    const { view } = scene;

    if (gesture.kind === "pan") {
      const scroll = clampScroll(
        view,
        gesture.scrollX - (input.x - gesture.originX),
        gesture.scrollY - (input.y - gesture.originY),
      );
      deps.setView(scroll);
      return;
    }

    if (gesture.kind === "lane-resize") {
      const height = Math.min(
        Math.max(0, view.height - 120),
        Math.max(0, gesture.laneHeight - (input.y - gesture.originY)),
      );
      deps.setView({ velocityLaneHeight: Math.round(height) });
      return;
    }

    if (gesture.kind === "erase") {
      const hit = hitTestNote(view, scene.notes, input.x, input.y);
      if (hit !== null) eraseNote(scene, hit.note.id, gesture.erased, gesture.coalesceKey);
      return;
    }

    if (gesture.kind === "velocity") {
      applyVelocity(scene, gesture.noteId, yToVelocity(view, input.y), gesture.coalesceKey);
      return;
    }

    // Bind the narrowed gesture: a `let` captured by the callbacks below
    // loses its narrowing inside them.
    const active = gesture;
    const bypass = input.altKey === true;
    const primary =
      active.notes.find((note) => note.id === active.primaryId) ?? active.notes[0];
    if (primary === undefined) return;

    if (active.kind === "resize") {
      const rawEnd = primary.positionTicks + primary.lengthTicks + pxToTicks(view, input.x - active.originX);
      const snappedEnd = snapTick(rawEnd, scene.snap, bypass);
      const minLength = minLengthTicks(scene.snap, bypass);
      const deltaTicks = Math.round(
        Math.max(minLength, snappedEnd - primary.positionTicks) - primary.lengthTicks,
      );
      if (deltaTicks === active.lastDeltaTicks) return;
      active.lastDeltaTicks = deltaTicks;

      const patches = active.notes.map((note) => ({
        id: note.id,
        patch: {
          lengthTicks: Math.max(minLength, note.lengthTicks + deltaTicks),
        } satisfies NotePatch,
      }));
      active.finalLengthTicks = Math.max(minLength, primary.lengthTicks + deltaTicks);
      deps.dispatch(updateNotes(scene.patternId, patches), { coalesceKey: active.coalesceKey });
      return;
    }

    // move
    const lockTime = input.ctrlKey === true;
    const lockPitch = input.shiftKey === true && !active.created;

    const rawTicks = primary.positionTicks + pxToTicks(view, input.x - active.originX);
    const snappedPosition = snapTick(rawTicks, scene.snap, bypass);
    let deltaTicks = lockTime ? 0 : Math.round(snappedPosition - primary.positionTicks);
    let deltaPitch = lockPitch
      ? 0
      : yToPitch(view, input.y) - yToPitch(view, active.originY);

    // Keep the whole set inside the pattern and inside MIDI range.
    const minPosition = Math.min(...active.notes.map((note) => note.positionTicks));
    const maxPitch = Math.max(...active.notes.map((note) => note.pitch));
    const minPitch = Math.min(...active.notes.map((note) => note.pitch));
    deltaTicks = Math.max(-minPosition, deltaTicks);
    deltaPitch = Math.min(127 - maxPitch, Math.max(-minPitch, deltaPitch));

    if (deltaTicks === active.lastDeltaTicks && deltaPitch === active.lastDeltaPitch) return;
    const pitchChanged = deltaPitch !== active.lastDeltaPitch;
    active.lastDeltaTicks = deltaTicks;
    active.lastDeltaPitch = deltaPitch;

    const patches = active.notes.map((note) => ({
      id: note.id,
      patch: {
        positionTicks: note.positionTicks + deltaTicks,
        pitch: note.pitch + deltaPitch,
      } satisfies NotePatch,
    }));
    deps.dispatch(updateNotes(scene.patternId, patches), { coalesceKey: active.coalesceKey });
    if (pitchChanged) deps.previewNote(scene.channelId, primary.pitch + deltaPitch);
  };

  /* ----------------------------------------------------------- pointer up */

  const pointerUp = (_input: RollPointer): void => {
    if (gesture.kind === "resize") deps.setLastLength(gesture.finalLengthTicks);
    if (gesture.kind === "preview") deps.setPreviewPitch?.(null);
    endDrag();
  };

  /* ----------------------------------------------------------------- wheel */

  const wheel = (input: RollWheel): boolean => {
    const scene = deps.getScene();
    const { view } = scene;

    if (input.ctrlKey === true || input.metaKey === true) {
      const factor = input.deltaY < 0 ? ZOOM_WHEEL_FACTOR : 1 / ZOOM_WHEEL_FACTOR;
      deps.setView(zoomAtCursor(view, input.x, view.zoomX * factor));
      return true;
    }

    if (input.altKey === true) {
      const hit = hitTestNote(view, scene.notes, input.x, input.y);
      if (hit === null) return false;
      const delta = input.deltaY < 0 ? VELOCITY_WHEEL_STEP : -VELOCITY_WHEEL_STEP;
      deps.dispatch(
        updateNotes(scene.patternId, [
          { id: hit.note.id, patch: { velocity: clamp01(hit.note.velocity + delta) } },
        ]),
        { coalesceKey: `piano-roll:velocity:${hit.note.id}` },
      );
      return true;
    }

    const horizontal = input.shiftKey === true;
    const amount = Math.sign(input.deltaY) * WHEEL_SCROLL_PX;
    deps.setView(
      clampScroll(
        view,
        view.scrollX + (horizontal ? amount : input.deltaX),
        view.scrollY + (horizontal ? 0 : amount),
      ),
    );
    return true;
  };

  /* ---------------------------------------------------------------- cursor */

  const cursorAt = (input: RollPointer): string => {
    if (gesture.kind === "pan") return "grabbing";
    const scene = deps.getScene();
    const region = regionAt(scene.view, input.x, input.y);
    if (region === "keyboard") return "pointer";
    if (region === "splitter") return "ns-resize";
    if (region === "velocity") return "ns-resize";
    if (region !== "grid") return "default";
    const hit = hitTestNote(scene.view, scene.notes, input.x, input.y);
    if (hit === null) return scene.tool === "delete" ? "crosshair" : "cell";
    return hit.zone === "grip" ? "ew-resize" : "move";
  };

  return {
    pointerDown,
    pointerMove,
    pointerUp,
    wheel,
    cursorAt,
    cancel: endDrag,
    peekGesture: () => gesture.kind,
  };
}

function dragKindOf(gesture: Gesture): RollDragKind {
  switch (gesture.kind) {
    case "move":
      return "move";
    case "resize":
      return "resize";
    case "erase":
      return "erase";
    case "pan":
      return "pan";
    case "velocity":
      return "velocity";
    default:
      return null;
  }
}

/* -------------------------------------------------------------- helpers -- */

/** Ticks a note may occupy — v1 patterns are exactly one bar (SPEC §1.2 D-sub). */
export const MAX_NOTE_TICK = PATTERN_LENGTH_TICKS;

/** Y of a note's velocity handle — re-exported so the host can draw a hover ring. */
export { velocityToY };
