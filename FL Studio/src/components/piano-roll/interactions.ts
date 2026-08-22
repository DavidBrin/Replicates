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
import {
  effectiveLengthTicks,
  noteEndTicks,
  SNAP_TICKS,
  snapTicks,
  snapTicksFloor,
  type SnapUnit,
} from "@/domain/tickMath";
import { createWheelGestureKeyring, WHEEL_GESTURE_GAP_MS } from "@/lib/wheelGesture";
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
  zoomAtCursorY,
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
  /**
   * DOM `PointerEvent.pointerId` — which pointer sent this, and therefore
   * whether it owns the gesture in flight (`@/lib/gestureHold` rule (g)).
   *
   * Two things read it, and the roll used to DROP it, so neither could. The
   * machine ignores move/up from a pointer that does not own the drag (a
   * second finger used to drag the owner's note snapshots to its own
   * position, and its release ended the owner's gesture mid-drag). And the
   * app-wide registry needs it to know a roll drag is a POINTER gesture:
   * registered with `null`, the drag claimed no press of its own, so the
   * same-press exemption treated every later pointer-down as its own nesting
   * partner and nothing could ever pre-empt it — a knob drag started under a
   * live roll drag left both open at once.
   *
   * Optional because the unit tests (and the wheel path, which has no
   * pointer) drive the machine with plain records; absent, ownership is not
   * asserted and the pre-registry behaviour stands.
   */
  pointerId?: number | null;
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
  /**
   * Announce a gesture to the app-wide single-active-gesture registry
   * (`@/lib/gestureHold`'s `registerExternalGesture`), returning the
   * unregister function.
   *
   * The roll is the one surface whose gesture is a *closure in this file* —
   * note snapshots and all — rather than a hook session or a ref, so the
   * registry could not see it and nothing outside could end it. A keyboard
   * `Delete` mid-drag went straight to `dispatch` (see `bindings.ts`), the
   * notes under the drag vanished, and the very next `pointermove` dispatched
   * `updateNotes` for ids that no longer existed — `requireNote` threw out of
   * the pointer handler. Registering makes that keystroke pre-empt the drag
   * through the same path a knob press uses, which cancels it and drops the
   * snapshots.
   *
   * Injected rather than imported so this module stays free of the store
   * (see the file header); the host wires the real one. Absent, the roll
   * simply keeps its pre-registry behaviour, which is what the unit tests
   * drive.
   */
  registerGesture?: (end: () => void, options?: { pointerId?: number | null }) => () => void;
  /**
   * End every gesture open elsewhere in the app — `@/lib/gestureHold`'s
   * `preemptOpenGestures`, injected for the same layering reason
   * {@link InteractionDeps.registerGesture} is.
   *
   * Alt+wheel velocity nudges are a MUTATING gesture with no pointer-down to
   * announce them and no pointer-up to close them: their undo bound is the
   * keyring's target+gap, so they cannot take a fresh one-shot id per notch
   * without losing the coalescing that makes a run one Ctrl+Z. They went
   * straight to `dispatch`, past the registry — so a knob drag, a clip drag or
   * a rack paint stroke another pointer still had open stayed open across the
   * edit and went on extending its own undo entry. Pre-emption is the half
   * they were missing; the key stays the keyring's.
   */
  preemptGestures?: () => void;
  /**
   * Commit any open text editor NOW — `@/lib/gestureHold`'s
   * `flushPendingCommits`, injected for the same layering reason
   * {@link InteractionDeps.registerGesture} is.
   *
   * {@link InteractionDeps.registerGesture} covers most of this surface,
   * because registering flushes too — but the DRAW path dispatches its
   * `addNotes` *before* it calls `beginDrag`, so by the time the registry saw
   * the gesture the note was already in the stack. A press here is a
   * dismissal of whatever editor had focus (`blur` is delivered after it), and
   * that editor's commit belongs UNDERNEATH the note, not on top of it: on
   * top it inverted the undo order and stopped the drag coalescing, since
   * coalescing only ever extends the stack's top entry.
   */
  flushEditors?: () => void;
}

/* ------------------------------------------------------------ constants -- */

export const VELOCITY_HIT_SLOP = 6;
export const VELOCITY_WHEEL_STEP = 0.05;
/**
 * How close two velocities have to be before an edit is a NO-OP — the knob's
 * and fader's epsilon, for the same float reason (`channel-rack/Knob.tsx`).
 * Velocity's whole range is `[0, 1]`, so an absolute epsilon has no scale to
 * lose.
 */
export const VELOCITY_NO_OP_EPSILON = 1e-9;
export const ZOOM_WHEEL_FACTOR = 1.15;
/** Plain-wheel scroll, in rows / px per notch. */
export const WHEEL_SCROLL_PX = 60;
/**
 * Alt+wheel velocity nudges (SPEC §4.4) have no pointer-down/up to bound a
 * gesture, unlike every drag — so they are bounded by target + time instead.
 *
 * The rule and its implementation live in `@/lib/wheelGesture`, because the
 * channel rack's Alt+wheel step nudges need exactly the same bound; this
 * re-export is here so the roll's own tests and docs keep naming it.
 */
export { WHEEL_GESTURE_GAP_MS };

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

/**
 * The ticks a note actually occupies, and where it ends.
 *
 * Both live in `@/domain/tickMath` and are re-exported here because this file
 * is where the rule was first needed and where its tests name it. There is
 * exactly one definition: clamping a *move* against a step's stored 0 let a
 * step in the final cell slide to tick 384, and validating an *import* against
 * the same 0 let a step land at 361 — the two ends of one rule, so they may
 * not be written twice.
 */
export { effectiveLengthTicks, noteEndTicks };

/**
 * Length of a freshly drawn note (SPEC §4's Piano Roll table: "Default length
 * = current snap unit"). `off` has no unit to draw at, so it falls back to
 * the last length a manual resize produced — the pre-existing "last used"
 * behaviour (lane 1 §3.5), preserved only for the unsnapped case.
 */
export function defaultDrawLengthTicks(snap: SnapUnit, lastLengthTicks: number): number {
  if (snap !== "off") return SNAP_TICKS[snap];
  return Math.max(1, Math.round(lastLengthTicks) || TICKS_PER_STEP);
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
  /**
   * Abandon the gesture in flight. Pass the pointer event for a
   * `pointercancel` — a cancel from a pointer that does not own the gesture
   * is ignored — and nothing for an external cancel (unmount, undo/redo,
   * registry pre-emption), which is unconditional.
   */
  cancel: (input?: RollPointer) => void;
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

/**
 * Whether the roll has a channel to write to at all.
 *
 * `InteractionScene.channelId` is `""` when the project has no channels — the
 * host's `ui.channelId ?? project.channelOrder[0] ?? ""`. Everything that
 * *reads* notes is fine with that (nothing matches an empty channel id);
 * everything that *creates* or auditions one is not.
 *
 * This is honest only because `""` cannot also *be* a channel: ids are minted
 * `<prefix>-<counter>` (`domain/ids.ts`) and an imported project's `""`-keyed
 * entities are dropped at deserialization (`domain/serialization.ts`'s
 * `safeEntries`). The two halves are one rule — do not relax either alone.
 */
function hasTargetChannel(scene: InteractionScene): boolean {
  return scene.channelId !== "";
}

export function createPianoRollController(deps: InteractionDeps): PianoRollController {
  let gesture: Gesture = { kind: "idle" };
  // Bounds alt+wheel velocity nudges into gestures — see WHEEL_GESTURE_GAP_MS.
  const velocityWheel = createWheelGestureKeyring("piano-roll-velocity");

  const snapshot = (note: Note): NoteSnapshot => ({
    id: note.id,
    positionTicks: note.positionTicks,
    lengthTicks: note.lengthTicks,
    pitch: note.pitch,
  });

  /**
   * The notes a gesture on `note` acts on: the whole selection when it is in it.
   *
   * `selection` is passed in rather than read off the scene because the click
   * that starts the drag may have *changed* the selection a line earlier, and
   * `getScene()` is a snapshot taken before it — reading `scene.selectedNoteIds`
   * here would be reading the selection as it was before the press. That was
   * live damage while Ctrl+click fell through into the drag branches (it
   * dragged the pre-click selection); with the toggle returning early the two
   * readings happen to agree again, and this parameter is what keeps them from
   * diverging the next time a branch above changes the selection.
   */
  const gestureSet = (
    scene: InteractionScene,
    selection: readonly NoteId[],
    note: Note,
  ): Note[] => {
    if (!selection.includes(note.id)) return [note];
    const byId = new Map(scene.notes.map((candidate) => [candidate.id, candidate]));
    const set = selection
      .map((id) => byId.get(id))
      .filter((candidate): candidate is Note => candidate !== undefined);
    return set.length > 0 ? set : [note];
  };

  /** Drops this gesture out of the app-wide registry, or `null` when unregistered. */
  let unregisterGesture: (() => void) | null = null;
  /**
   * The pointer that opened the gesture in flight, or `null` when it was
   * opened without one (a test record, a wheel).
   */
  let gesturePointerId: number | null = null;

  /**
   * Whether `input` belongs to the gesture in flight — pointer ownership
   * (`@/lib/gestureHold` rule (g)). Both `null`/absent cases abstain: a
   * gesture opened without a pointer cannot claim an event is somebody
   * else's, and an event with no id cannot be shown to be foreign.
   */
  const ownsPointer = (input: RollPointer): boolean => {
    if (gesturePointerId === null) return true;
    const id = input.pointerId;
    return id === undefined || id === null || id === gesturePointerId;
  };

  const leaveRegistry = (): void => {
    const unregister = unregisterGesture;
    if (unregister === null) return;
    unregisterGesture = null;
    unregister();
  };

  const beginDrag = (next: Gesture, pointerId: number | null = null): void => {
    gesture = next;
    gesturePointerId = pointerId;
    // Registered BEFORE the store write: registering pre-empts whatever else
    // was open, and a pre-empted owner's `onCancel` may dispatch. Registering
    // after would let that land inside this gesture's own coalesce window.
    leaveRegistry();
    // With the pointer id, so the registry can tell this press from the next
    // one — see {@link RollPointer.pointerId}.
    unregisterGesture = deps.registerGesture?.(cancel, { pointerId }) ?? null;
    deps.setDragKind(dragKindOf(next));
  };

  /**
   * Close whatever is in flight and tell the host — **gesture first**.
   *
   * The order matters because `setDragKind`/`setPreviewPitch` write the store
   * synchronously, and the host relays an externally-cleared `dragKind` back
   * into {@link PianoRollController.cancel} (see `PianoRoll.tsx`). Notifying
   * before clearing would re-enter this function with the gesture still set.
   * Returns what was in flight, so callers can act on it after the reset.
   */
  const endDrag = (): Gesture => {
    const finished = gesture;
    gesture = { kind: "idle" };
    gesturePointerId = null;
    // Out of the registry first, for the same reason the gesture record is
    // cleared first: `end`/`cancel` re-entering through a pre-emption must
    // find nothing in flight.
    leaveRegistry();
    deps.setDragKind(null);
    return finished;
  };

  /**
   * Abandon whatever is in flight — the host's `pointercancel`.
   *
   * It has to undo everything a pointer-*up* would have released, not just
   * the gesture record: a `pointercancel` during a keyboard audition (the
   * browser stealing the pointer for a scroll or a gesture) left
   * `previewPitch` set, so the key stayed lit until the next audition.
   */
  const cancel = (input?: RollPointer): void => {
    // With a pointer (the host's `pointercancel`), only the OWNER may cancel;
    // without one (unmount, the store's reconcile, registry pre-emption) the
    // cancel is unconditional — that caller is not a pointer at all.
    if (input !== undefined && gesture.kind !== "idle" && !ownsPointer(input)) return;
    const finished = endDrag();
    if (finished.kind === "preview") deps.setPreviewPitch?.(null);
  };

  /* --------------------------------------------------------- pointer down */

  const pointerDown = (input: RollPointer): void => {
    // Before ANY branch below dispatches — see `InteractionDeps.flushEditors`.
    // The draw path in particular dispatches its note before `beginDrag`, so
    // the registration that would otherwise flush arrives one command late.
    deps.flushEditors?.();
    // A press by a pointer that does not own the gesture in flight is a NEW
    // gesture: the old one is sealed here, before anything installs the new
    // one. Doing it the other way round (letting the registry's pre-emption
    // run the teardown *after* the new gesture was recorded) had the outgoing
    // gesture's `cancel` clear the incoming one — the drag that had just
    // started was thrown away by the one it replaced.
    if (gesture.kind !== "idle" && !ownsPointer(input)) cancel();
    const scene = deps.getScene();
    const { view } = scene;
    const region = regionAt(view, input.x, input.y);

    if (input.button === 1) {
      beginDrag(
        {
          kind: "pan",
          originX: input.x,
          originY: input.y,
          scrollX: view.scrollX,
          scrollY: view.scrollY,
        },
        input.pointerId ?? null,
      );
      return;
    }

    /*
     * The keyboard column and the splitter are LEFT-button gestures, and both
     * used to run before the primary-button guard further down.
     *
     * §4.4 gives left-click "draw/add/activate" and right-click "delete
     * (content areas); context menu (chrome/non-content)" — auditioning a note
     * and dragging the velocity lane's divider are neither. Right-clicking the
     * key column played the note (and lit the key, and held a `preview`
     * gesture open until a `pointerup` that a context menu may never deliver);
     * right-clicking the splitter started a lane resize that then tracked the
     * pointer with no button held. The velocity lane's own branch below has
     * always checked `button !== 0`; these two are that same check, moved to
     * where each branch is decided rather than left to a guard they jump over.
     * Button 1 is still the pan, handled above.
     */
    if (region === "keyboard") {
      if (input.button !== 0) return;
      if (!hasTargetChannel(scene)) return;
      const pitch = clampPitch(yToPitch(view, input.y));
      deps.previewNote(scene.channelId, pitch);
      deps.setPreviewPitch?.(pitch);
      beginDrag({ kind: "preview" }, input.pointerId ?? null);
      return;
    }

    if (region === "splitter") {
      if (input.button !== 0) return;
      beginDrag(
        { kind: "lane-resize", originY: input.y, laneHeight: view.velocityLaneHeight },
        input.pointerId ?? null,
      );
      return;
    }

    if (region === "velocity") {
      if (input.button !== 0) return;
      const note = hitTestVelocityStem(view, scene.notes, input.x);
      if (note === null) return;
      const coalesceKey = nextCoalesceKey();
      beginDrag({ kind: "velocity", coalesceKey, noteId: note.id }, input.pointerId ?? null);
      applyVelocity(scene, note.id, yToVelocity(view, input.y), coalesceKey);
      return;
    }

    if (region !== "grid") return;

    const hit = hitTestNote(view, scene.notes, input.x, input.y);

    /*
     * Ctrl+left-click on a note is a pure *selection* toggle whatever the tool
     * is (see the branch further down), and that has to be decided **before**
     * the erase branch, not after it. With the delete tool active the erase
     * branch matched first, so the one gesture the user has for "add this note
     * to the selection" deleted it instead — the note was gone before the
     * toggle could run, and there is no way to build a selection with that
     * tool held. Right-click delete stays unconditional: it is not a modifier
     * gesture and §4.4 makes it universal.
     */
    const ctrlSelect = input.button === 0 && input.ctrlKey === true && hit !== null;

    // Right-click deletes — everywhere, and dragging keeps deleting (§4.4).
    if (input.button === 2 || (scene.tool === "delete" && !ctrlSelect)) {
      const coalesceKey = nextCoalesceKey();
      const erased = new Set<NoteId>();
      beginDrag({ kind: "erase", coalesceKey, erased }, input.pointerId ?? null);
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

    /*
     * Ctrl+click is a *selection* gesture, whatever the tool, and it starts
     * nothing else.
     *
     * It used to fall through to the branches below whenever the tool was not
     * `select`: Ctrl+Shift+click on a note added it to the selection and then
     * immediately *cloned* the selection, and a plain Ctrl+click began a move
     * whose note set came from the pre-click selection. Toggling membership
     * and dragging are two different intents; the toggle wins, and the drag is
     * the next press.
     */
    if (input.ctrlKey === true) {
      const next = scene.selectedNoteIds.includes(hit.note.id)
        ? scene.selectedNoteIds.filter((id) => id !== hit.note.id)
        : [...scene.selectedNoteIds, hit.note.id];
      deps.setSelection([...next]);
      return;
    }

    if (scene.tool === "select") {
      deps.setSelection([hit.note.id]);
      return;
    }

    // What the drag below acts on — the selection *after* this click, not the
    // one `getScene()` snapshotted before it (see `gestureSet`).
    let selection: readonly NoteId[] = scene.selectedNoteIds;
    if (!selection.includes(hit.note.id)) {
      selection = [hit.note.id];
      deps.setSelection([hit.note.id]);
    }

    if (hit.zone === "grip") {
      const notes = gestureSet(scene, selection, hit.note).map(snapshot);
      beginDrag(
        {
          kind: "resize",
          coalesceKey: nextCoalesceKey(),
          notes,
          primaryId: hit.note.id,
          originX: input.x,
          lastDeltaTicks: 0,
          // A step's stored `0` is a marker, not a length: the grip the user
          // grabbed is drawn one cell to the right of the note's origin, so
          // the resize has to start from the *effective* length or the very
          // first move snaps the note back to a single tick.
          finalLengthTicks: effectiveLengthTicks(hit.note.lengthTicks),
        },
        input.pointerId ?? null,
      );
      return;
    }

    // Shift+left-click clones the selection, then drags the clones (§4.4).
    const source = gestureSet(scene, selection, hit.note);
    const coalesceKey = nextCoalesceKey();
    if (input.shiftKey === true) {
      const clones = source.map((note) => ({ ...note, id: deps.createNoteId() }));
      deps.dispatch(addNotes(scene.patternId, clones), { coalesceKey });
      deps.setSelection(clones.map((clone) => clone.id));
      // The primary is the clone *of the note under the pointer*, because the
      // whole drag snaps against the primary's position. `clones` is
      // index-aligned with `source`, so the source's index names it exactly.
      //
      // Matching by pitch instead (what this did) is not injective: two
      // selected notes on the same row — a chord voice repeated later in the
      // bar is the ordinary case — made the *first* of them primary whichever
      // one was grabbed, and the drag then snapped to a baseline the user
      // never touched, offsetting the whole clone set by the gap between them.
      const primaryIndex = source.findIndex((note) => note.id === hit.note.id);
      const primary = primaryIndex >= 0 ? clones[primaryIndex] : clones[0];
      beginDrag(
        {
          kind: "move",
          coalesceKey,
          notes: clones.map(snapshot),
          primaryId: primary?.id ?? hit.note.id,
          originX: input.x,
          originY: input.y,
          lastDeltaTicks: 0,
          lastDeltaPitch: 0,
          created: true,
        },
        input.pointerId ?? null,
      );
      return;
    }

    deps.previewNote(scene.channelId, hit.note.pitch);
    beginDrag(
      {
        kind: "move",
        coalesceKey,
        notes: source.map(snapshot),
        primaryId: hit.note.id,
        originX: input.x,
        originY: input.y,
        lastDeltaTicks: 0,
        lastDeltaPitch: 0,
        created: false,
      },
      input.pointerId ?? null,
    );
  };

  /* ---------------------------------------------------------- draw a note */

  const drawNote = (scene: InteractionScene, input: RollPointer): void => {
    // No channel to draw *into*. The host reports the empty rack as an empty
    // target (`channelId: ""`), and `addNotes` rejects a note naming a channel
    // that does not exist — so a click on an empty project threw a
    // `CommandError` out of a pointer handler instead of doing nothing.
    if (!hasTargetChannel(scene)) return;
    const { view } = scene;
    const bypass = input.altKey === true;
    const rawTick = xToTick(view, input.x);
    const rawPosition = Math.max(
      0,
      bypass || scene.snap === "off"
        ? Math.floor(rawTick)
        : snapTicksFloor(rawTick, scene.snap),
    );
    const pitch = clampPitch(yToPitch(view, input.y));
    const lengthTicks = Math.min(
      PATTERN_LENGTH_TICKS,
      defaultDrawLengthTicks(scene.snap, scene.lastLengthTicks),
    );
    // A note may never extend past the pattern (SPEC §1.2 D-sub) — the grid
    // renders a dead zone there (`renderer.ts`'s drawOutOfPatternOverlay) but
    // nothing may actually be scheduled past it (`interactions.ts` ~1).
    const positionTicks = Math.min(rawPosition, PATTERN_LENGTH_TICKS - lengthTicks);
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
    beginDrag(
      {
        kind: "move",
        coalesceKey,
        notes: [snapshot(note)],
        primaryId: note.id,
        originX: input.x,
        originY: input.y,
        lastDeltaTicks: 0,
        lastDeltaPitch: 0,
        created: true,
      },
      input.pointerId ?? null,
    );
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

  /**
   * Write a note's velocity — **only** when it is actually a different one.
   *
   * Both callers are CLAMPED (`clamp01`), so both repeat: a stem dragged above
   * the lane's top or below its floor reports 1 or 0 on every move, and
   * Alt+wheel at either end nudges past a bound that is already reached. Each
   * of those dispatched — the first one filing an undo entry that undoes
   * nothing, the rest costing a store write and an autosave schedule apiece.
   *
   * Epsilon rather than `===` for the same reason `Knob`/`Fader` use one:
   * these are floats, and a stem dragged away and back lands on
   * `0.7999999999999999`, which is the velocity it already had.
   */
  const applyVelocity = (
    scene: InteractionScene,
    noteId: NoteId,
    velocity: number,
    coalesceKey: string,
  ): void => {
    const next = clamp01(velocity);
    const current = scene.notes.find((note) => note.id === noteId)?.velocity;
    if (current !== undefined && Math.abs(next - current) <= VELOCITY_NO_OP_EPSILON) return;
    deps.dispatch(updateNotes(scene.patternId, [{ id: noteId, patch: { velocity: next } }]), {
      coalesceKey,
    });
  };

  /* --------------------------------------------------------- pointer move */

  const pointerMove = (input: RollPointer): void => {
    if (gesture.kind === "idle" || gesture.kind === "preview") return;
    // Only the pointer that opened the drag drives it — a second pointer's
    // coordinates against this drag's origin are not this drag's travel.
    if (!ownsPointer(input)) return;
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
      // Every length in this branch is the *effective* one (`tickMath.ts`): a
      // step stores `lengthTicks: 0` as a marker and is drawn — grip included
      // — one whole cell wide. Anchoring at the stored zero put the resize's
      // origin a cell to the left of the grip the user actually grabbed, so
      // dragging one cell right produced a one-step note and holding still
      // rewrote the marker into a 1-tick length.
      const primaryLength = effectiveLengthTicks(primary.lengthTicks);
      const minLength = minLengthTicks(scene.snap, bypass);
      // "Did the pointer move?" is a question about the POINTER, and it has to
      // be answered before snap gets a vote. Asking it of the snapped end
      // instead made every note shorter than the snap cell impossible to leave
      // alone: a 24-tick note under bar snap has its origin end (24) snapped to
      // 0, then raised to `minLength`, so a drag out and straight back computed
      // a delta of +360 and the "back where it started" restoration below never
      // fired — the note silently became a whole bar long. Zero pointer
      // displacement is zero delta at every snap setting.
      const pointerDx = input.x - active.originX;
      const rawEnd = primary.positionTicks + primaryLength + pxToTicks(view, pointerDx);
      const snappedEnd = snapTick(rawEnd, scene.snap, bypass);
      const deltaTicks =
        pointerDx === 0
          ? 0
          : Math.round(Math.max(minLength, snappedEnd - primary.positionTicks) - primaryLength);
      if (deltaTicks === active.lastDeltaTicks) return;
      active.lastDeltaTicks = deltaTicks;

      // Every note in the set keeps its own end inside the pattern (SPEC
      // §1.2 D-sub) — clamped per-note rather than by a shared delta cap so
      // one note near the pattern boundary cannot mute the drag for the rest
      // of the selection.
      //
      // The pattern bound WINS. Nesting the snap minimum inside the clamp
      // (`min(desired, max(minLength, available))`) let a note near the bar
      // end grow past it whenever snap made `available < minLength`: at
      // position 383 with a quarter-beat snap the "minimum" of 24 ticks was
      // longer than the 1 tick left, and the note ended at 407 — outside the
      // pattern, where nothing is ever scheduled. `minLength` is a floor on
      // what a resize *aims* for, never a licence to overrun; one tick is the
      // real floor, and it always fits because a note starts inside the bar.
      const clampedLength = (note: NoteSnapshot): number => {
        // Back where it started is not a resize. Every other length in this
        // branch is the *effective* one, and that substitution is exactly what
        // a step must not be committed with: dragging the grip out and back to
        // the origin left `deltaTicks` at 0 but stored
        // `effectiveLengthTicks(0)` — 24 — silently promoting the rack's
        // `lengthTicks: 0` step marker into an ordinary note that the rack can
        // no longer round-trip. Restore the STORED length verbatim; for a real
        // note stored and effective are the same value, so nothing else moves.
        if (deltaTicks === 0) return note.lengthTicks;
        const available = PATTERN_LENGTH_TICKS - note.positionTicks;
        const desired = Math.max(minLength, effectiveLengthTicks(note.lengthTicks) + deltaTicks);
        return Math.max(1, Math.min(desired, available));
      };

      const patches = active.notes.map((note) => ({
        id: note.id,
        patch: { lengthTicks: clampedLength(note) } satisfies NotePatch,
      }));
      // `setLastLength` seeds the next drawn note, and a 0 there would mean
      // "one tick" to `defaultDrawLengthTicks`, not "one step" — so the
      // remembered length is the effective one even when the stored one is a
      // marker.
      active.finalLengthTicks = effectiveLengthTicks(clampedLength(primary));
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

    // Keep the whole set inside the pattern and inside MIDI range. Both
    // bounds are shared across the group (not clamped per-note) so a
    // multi-note drag keeps its relative offsets intact right up to the
    // edge, instead of one note hitting the wall while the rest keep moving.
    const minPosition = Math.min(...active.notes.map((note) => note.positionTicks));
    const maxEndDelta = Math.min(
      ...active.notes.map(
        (note) => PATTERN_LENGTH_TICKS - noteEndTicks(note.positionTicks, note.lengthTicks),
      ),
    );
    const maxPitch = Math.max(...active.notes.map((note) => note.pitch));
    const minPitch = Math.min(...active.notes.map((note) => note.pitch));
    deltaTicks = Math.max(-minPosition, Math.min(maxEndDelta, deltaTicks));
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

  const pointerUp = (input: RollPointer): void => {
    // Another pointer lifting is not this gesture's release: ending here
    // would seal the undo entry and drop the note snapshots with the owning
    // button still down.
    if (gesture.kind !== "idle" && !ownsPointer(input)) return;
    const finished = endDrag();
    if (finished.kind === "resize") deps.setLastLength(finished.finalLengthTicks);
    if (finished.kind === "preview") deps.setPreviewPitch?.(null);
  };

  /* ----------------------------------------------------------------- wheel */

  const wheel = (input: RollWheel): boolean => {
    const scene = deps.getScene();
    const { view } = scene;
    const ctrl = input.ctrlKey === true || input.metaKey === true;

    // Vertical zoom-at-cursor has no documented FL wheel binding (research/01
    // §3.6 only lists middle-drag) — Ctrl+Alt+wheel is this app's own choice,
    // grouped under the same modifier family as Ctrl+wheel's horizontal zoom
    // so the two read as one gesture with an axis toggle.
    if (ctrl && input.altKey === true) {
      const factor = input.deltaY < 0 ? ZOOM_WHEEL_FACTOR : 1 / ZOOM_WHEEL_FACTOR;
      deps.setView(zoomAtCursorY(view, input.y, view.zoomY * factor));
      return true;
    }

    if (ctrl) {
      const factor = input.deltaY < 0 ? ZOOM_WHEEL_FACTOR : 1 / ZOOM_WHEEL_FACTOR;
      deps.setView(zoomAtCursor(view, input.x, view.zoomX * factor));
      return true;
    }

    if (input.altKey === true) {
      const hit = hitTestNote(view, scene.notes, input.x, input.y);
      if (hit === null) return false;
      const delta = input.deltaY < 0 ? VELOCITY_WHEEL_STEP : -VELOCITY_WHEEL_STEP;
      // A notch past a bound is a NO-OP, and it must not even pre-empt: the
      // clamp returns the velocity the note already has, so dispatching filed
      // an undo entry that undoes nothing and sealed whatever gesture was
      // open elsewhere for an edit that never happened.
      const nudged = clamp01(hit.note.velocity + delta);
      if (Math.abs(nudged - hit.note.velocity) <= VELOCITY_NO_OP_EPSILON) return true;
      // Through the registry first — see `InteractionDeps.preemptGestures`.
      // Only here: zoom and scroll below write no domain state, so they are
      // not gestures and must not seal anybody's.
      deps.preemptGestures?.();
      deps.dispatch(
        updateNotes(scene.patternId, [{ id: hit.note.id, patch: { velocity: nudged } }]),
        // Keyed by pattern AND note, exactly as the rack keys by pattern +
        // channel + step. A note id is unique within a pattern, not across
        // them: `makeUnique` preserves ids when it clones a pattern, so two
        // nudges on "the same" note in the source and the clone, inside
        // WHEEL_GESTURE_GAP_MS, coalesced into one undo entry spanning two
        // patterns. The pair is passed as a tuple, never joined by hand — see
        // `wheelGesture.ts`'s `encodeTarget`.
        { coalesceKey: velocityWheel.keyFor([scene.patternId, hit.note.id]) },
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
    cancel,
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
