/**
 * The piano roll's keyboard bindings (SPEC §4.4, registered via §6's registry).
 *
 * `src/lib/keyboard.ts` is a registry that owns no bindings of its own — this
 * surface registers its own under the `"piano-roll"` id and unregisters on
 * unmount. The bindings take their state and effects through
 * {@link PianoRollBindingDeps}, so they are driven synchronously in tests with
 * a mocked dispatch and no store, no canvas and no React.
 *
 * | Combo | Effect |
 * |---|---|
 * | `Ctrl+A` | select every note of the target channel |
 * | `Ctrl+D` | deselect all |
 * | `Del` / `Backspace`+nothing-selected | delete the selection |
 * | `Ctrl+↑` / `Ctrl+↓` | transpose the selection an octave |
 * | `Shift+↑` / `Shift+↓` | transpose the selection a semitone |
 * | `Backspace` | toggle snap off ⇄ last unit |
 * | `PgUp` / `PgDn` | horizontal zoom in / out about the grid centre |
 */

import { isEmptyCommand, removeNotes, updateNotes, type Command } from "@/domain/commands";
import type { Note, NoteId, PatternId } from "@/domain/types";
import { oneShotGestureKey } from "@/lib/gestureHold";
import { registerBindings, type KeyBinding } from "@/lib/keyboard";

import { clampPitch, zoomAboutGridCenter, type RollViewport } from "./geometry";

export const PIANO_ROLL_SURFACE_ID = "piano-roll";

export interface PianoRollBindingScene {
  patternId: PatternId;
  /** The target channel's notes — `Ctrl+A` selects exactly these. */
  notes: readonly Note[];
  selectedNoteIds: readonly NoteId[];
}

export interface PianoRollBindingDeps {
  getScene: () => PianoRollBindingScene;
  dispatch: (command: Command, options?: { coalesceKey?: string; gestureId?: string }) => void;
  setSelection: (noteIds: NoteId[]) => void;
  toggleSnap: () => void;
  /** Current viewport — `PgUp`/`PgDn` zoom needs the geometry, not the notes. */
  getView: () => RollViewport;
  setView: (patch: { zoomX: number; scrollX: number }) => void;
}

/**
 * One `PgUp`/`PgDn` press, as a multiplier on `zoomX`. Deliberately coarser
 * than {@link ZOOM_WHEEL_FACTOR}'s 1.15: a wheel notch comes in bursts, a key
 * press comes one at a time.
 */
export const ZOOM_KEY_FACTOR = 1.5;

/**
 * Transpose by `semitones`, clamped so the *whole* selection stays in MIDI
 * range — a chord near the top of the keyboard must keep its shape rather than
 * collapsing onto pitch 127.
 */
export function transposeCommand(
  scene: PianoRollBindingScene,
  semitones: number,
): Command | null {
  const selected = scene.notes.filter((note) => scene.selectedNoteIds.includes(note.id));
  if (selected.length === 0) return null;
  const highest = Math.max(...selected.map((note) => note.pitch));
  const lowest = Math.min(...selected.map((note) => note.pitch));
  const shift = Math.min(127 - highest, Math.max(-lowest, semitones));
  if (shift === 0) return null;
  return updateNotes(
    scene.patternId,
    selected.map((note) => ({ id: note.id, patch: { pitch: clampPitch(note.pitch + shift) } })),
  );
}

export function deleteSelectionCommand(scene: PianoRollBindingScene): Command | null {
  const ids = scene.notes
    .filter((note) => scene.selectedNoteIds.includes(note.id))
    .map((note) => note.id);
  return ids.length === 0 ? null : removeNotes(scene.patternId, ids);
}

/**
 * Builds the binding list. Exported separately from
 * {@link registerPianoRollBindings} so a test can fire each handler without
 * touching the global registry.
 */
export function createPianoRollBindings(deps: PianoRollBindingDeps): KeyBinding[] {
  /**
   * Every mutating keystroke on this surface goes through here.
   *
   * `oneShotGestureKey` (`@/lib/gestureHold`) ENDS whatever gesture is open
   * app-wide before the command is built, and hands back an id to dispatch
   * under. Both halves matter, and the first is why this exists at all: with a
   * bare `dispatch`, pressing `Delete` in the middle of a note drag removed
   * the notes while the roll's controller went on holding SNAPSHOTS of them,
   * and the next `pointermove` dispatched `updateNotes` against ids the
   * project no longer had — `requireNote` threw straight out of the pointer
   * handler. The roll's drag is registered with the same registry (see
   * `interactions.ts`'s `registerGesture`), so pre-empting it here cancels it.
   *
   * The dispatched command is built AFTER the pre-emption: cancelling a drag
   * can change what the scene says (the drag's own last dispatch is already
   * applied, and the cancel clears the roll's drag state), so a scene read
   * before it would be describing a project state that no longer stands.
   *
   * But the PROBE comes first, and it is not the same thing as the build.
   * Pre-empting is itself an effect — it ends a drag somebody is still holding
   * and flushes an open editor's commit — and a keystroke that writes nothing
   * has no right to it. `Delete` with an empty selection and a transpose with
   * the selection already against the MIDI ceiling both build `null`, and both
   * used to kill a live drag on the way to doing nothing at all. So: build
   * against the current scene to ask "is there an edit here?", pre-empt only
   * if there is, then build AGAIN against the post-pre-emption scene and
   * dispatch that. Both builds are pure functions of a scene, so the probe
   * costs a filter over the target channel's notes and nothing else.
   *
   * The second build can still come back empty — the pre-emption may have
   * removed the very notes the probe saw — and that answer is honoured too.
   */
  const mutate = (build: (scene: PianoRollBindingScene) => Command | null) => (): void => {
    const writes = (command: Command | null): command is Command =>
      command !== null && !isEmptyCommand(command);
    if (!writes(build(deps.getScene()))) return;
    const gestureId = oneShotGestureKey(PIANO_ROLL_SURFACE_ID);
    const command = build(deps.getScene());
    if (writes(command)) deps.dispatch(command, { gestureId });
  };

  const transpose = (semitones: number) =>
    mutate((scene) => transposeCommand(scene, semitones));

  return [
    {
      id: "select-all",
      code: "KeyA",
      ctrl: true,
      description: "Select all notes",
      handler: () => {
        const scene = deps.getScene();
        deps.setSelection(scene.notes.map((note) => note.id));
      },
    },
    {
      id: "deselect-all",
      code: "KeyD",
      ctrl: true,
      description: "Deselect all",
      handler: () => deps.setSelection([]),
    },
    {
      id: "delete-selection",
      code: "Delete",
      description: "Delete selection",
      handler: mutate(deleteSelectionCommand),
    },
    {
      id: "transpose-octave-up",
      code: "ArrowUp",
      ctrl: true,
      description: "Transpose selection up an octave",
      handler: transpose(12),
    },
    {
      id: "transpose-octave-down",
      code: "ArrowDown",
      ctrl: true,
      description: "Transpose selection down an octave",
      handler: transpose(-12),
    },
    {
      id: "transpose-semitone-up",
      code: "ArrowUp",
      shift: true,
      description: "Transpose selection up a semitone",
      handler: transpose(1),
    },
    {
      id: "transpose-semitone-down",
      code: "ArrowDown",
      shift: true,
      description: "Transpose selection down a semitone",
      handler: transpose(-1),
    },
    {
      id: "zoom-in",
      code: "PageUp",
      description: "Zoom in (horizontal)",
      handler: () => deps.setView(zoomAboutGridCenter(deps.getView(), ZOOM_KEY_FACTOR)),
    },
    {
      id: "zoom-out",
      code: "PageDown",
      description: "Zoom out (horizontal)",
      handler: () => deps.setView(zoomAboutGridCenter(deps.getView(), 1 / ZOOM_KEY_FACTOR)),
    },
    {
      id: "toggle-snap",
      code: "Backspace",
      description: "Toggle snap",
      handler: () => deps.toggleSnap(),
    },
  ];
}

/**
 * Registers this surface's bindings and returns the unregister function —
 * call it on unmount / when the roll loses focus.
 *
 * Integration note: nothing else needs to change. `src/lib/keyboard.ts` is a
 * registry, and `AppShell` already attaches the single DOM listener; this
 * module is called from `PianoRoll.tsx`'s mount effect.
 */
export function registerPianoRollBindings(
  deps: PianoRollBindingDeps,
  register: (surfaceId: string, bindings: KeyBinding[]) => () => void = registerBindings,
): () => void {
  return register(PIANO_ROLL_SURFACE_ID, createPianoRollBindings(deps));
}
