/**
 * The piano roll's ephemeral UI slice (SPEC §5's composition seam).
 *
 * ## Registering this slice — the two lines slice A adds to `src/lib/store.ts`
 *
 * ```ts
 * import { createPianoRollUi, type PianoRollUiSlice } from "@/components/piano-roll/uiState";
 * export type UiSlices = PianoRollUiSlice;          // & PlaylistUiSlice & …
 * // inside create<AppState>():
 * ...createPianoRollUi(...args),
 * ```
 *
 * Nothing else in `store.ts` changes, and this file is never co-edited by
 * another slice (SPEC §8).
 *
 * **State is namespaced under one `pianoRoll` key** rather than spread flat.
 * The store's doc example spreads flat (`snap`, `selectedNoteIds`), which is
 * fine for one slice but collides the moment the Playlist lands its own
 * `zoom`/`scroll`/`selection`. One object + prefixed setters keeps every
 * surface's registration collision-free.
 *
 * ## Where the store hooks live
 *
 * Registered. `store.ts` imports this file at module scope to spread the
 * creator, so this file may only `import type` from it — the store-reading
 * hooks (`useRollUi`, `getRollUi`) therefore live one door down in
 * `rollUi.ts`, which nothing in `store.ts` imports.
 */

import { SNAP_UNITS, type SnapUnit } from "@/domain/tickMath";
import { TICKS_PER_STEP, type ChannelId, type NoteId } from "@/domain/types";
import type { AppState, AppStateCreator } from "@/lib/store";

import {
  DEFAULT_VIEWPORT,
  clampScroll,
  clampZoomX,
  type RollViewport,
} from "./geometry";

/** The tools of lane 1 §3.5 this slice ships; the rest are OUT for v1. */
export type RollTool = "draw" | "select" | "delete";

/** Which gesture is mid-flight — cursor/CSS only; the machine owns the detail. */
export type RollDragKind = "draw" | "move" | "resize" | "erase" | "pan" | "velocity" | null;

export interface PianoRollUiState {
  /** Snap unit for draw/move/resize; `off` still quantizes to a whole tick. */
  snap: SnapUnit;
  /** Restored by the `Backspace` snap toggle (SPEC §4.4). */
  previousSnap: SnapUnit;
  tool: RollTool;
  /** Canvas geometry: zoom, scroll, lane height. Size is written by the host. */
  view: RollViewport;
  selectedNoteIds: NoteId[];
  /** Length of the next drawn note — "last used", per lane 1 §3.5. */
  lastLengthTicks: number;
  /** The channel the roll edits; `null` = the first channel in the rack. */
  channelId: ChannelId | null;
  dragKind: RollDragKind;
  /** Pitch held on the preview keyboard, for the pressed-key highlight. */
  previewPitch: number | null;
}

export interface PianoRollUiSlice {
  pianoRoll: PianoRollUiState;
  setPianoRollSnap: (snap: SnapUnit) => void;
  /** `Backspace`: snap off ⇄ the unit that was in use (SPEC §4.4). */
  togglePianoRollSnap: () => void;
  setPianoRollTool: (tool: RollTool) => void;
  setPianoRollView: (patch: Partial<RollViewport>) => void;
  setPianoRollSelection: (noteIds: readonly NoteId[]) => void;
  togglePianoRollSelected: (noteId: NoteId, additive: boolean) => void;
  setPianoRollLastLength: (lengthTicks: number) => void;
  setPianoRollChannel: (channelId: ChannelId | null) => void;
  setPianoRollDragKind: (dragKind: RollDragKind) => void;
  setPianoRollPreviewPitch: (pitch: number | null) => void;
}

export const DEFAULT_PIANO_ROLL_UI: PianoRollUiState = {
  snap: "quarterBeat",
  previousSnap: "quarterBeat",
  tool: "draw",
  view: DEFAULT_VIEWPORT,
  selectedNoteIds: [],
  lastLengthTicks: TICKS_PER_STEP,
  channelId: null,
  dragKind: null,
  previewPitch: null,
};

/** The composed state this slice sees once it is registered in the app store. */
export type RollAppState = AppState & PianoRollUiSlice;

export const createPianoRollUi: AppStateCreator<PianoRollUiSlice> = (set, get) => {
  /*
   * One documented cast, in one place. `AppStateCreator<T>` types `set`/`get`
   * against `AppState` as seen from *inside* the creator, where this slice's
   * own keys are the thing being produced. Casting here (rather than declaring
   * the creator against `AppState & PianoRollUiSlice`) keeps the exported type
   * exactly the one `store.ts` documents.
   */
  const setUi = set as unknown as (
    updater: (state: RollAppState) => Partial<RollAppState>,
  ) => void;
  const getUi = get as unknown as () => RollAppState;

  const patch = (next: Partial<PianoRollUiState>): void => {
    setUi((state) => ({ pianoRoll: { ...state.pianoRoll, ...next } }));
  };

  return {
    pianoRoll: DEFAULT_PIANO_ROLL_UI,

    setPianoRollSnap: (snap) => {
      if (!SNAP_UNITS.includes(snap)) return;
      const current = getUi().pianoRoll.snap;
      patch({ snap, previousSnap: current === "off" ? getUi().pianoRoll.previousSnap : current });
    },

    togglePianoRollSnap: () => {
      const { snap, previousSnap } = getUi().pianoRoll;
      if (snap === "off") {
        patch({ snap: previousSnap === "off" ? "quarterBeat" : previousSnap });
      } else {
        patch({ snap: "off", previousSnap: snap });
      }
    },

    setPianoRollTool: (tool) => patch({ tool }),

    setPianoRollView: (viewPatch) => {
      const view = { ...getUi().pianoRoll.view, ...viewPatch };
      const zoomX = clampZoomX(view.zoomX);
      const scroll = clampScroll({ ...view, zoomX }, view.scrollX, view.scrollY);
      patch({ view: { ...view, zoomX, ...scroll } });
    },

    setPianoRollSelection: (noteIds) => patch({ selectedNoteIds: [...noteIds] }),

    togglePianoRollSelected: (noteId, additive) => {
      const current = getUi().pianoRoll.selectedNoteIds;
      if (!additive) {
        patch({ selectedNoteIds: current.includes(noteId) && current.length === 1 ? [] : [noteId] });
        return;
      }
      patch({
        selectedNoteIds: current.includes(noteId)
          ? current.filter((id) => id !== noteId)
          : [...current, noteId],
      });
    },

    setPianoRollLastLength: (lengthTicks) => {
      if (!Number.isFinite(lengthTicks) || lengthTicks <= 0) return;
      patch({ lastLengthTicks: Math.round(lengthTicks) });
    },

    setPianoRollChannel: (channelId) => patch({ channelId, selectedNoteIds: [] }),
    setPianoRollDragKind: (dragKind) => patch({ dragKind }),
    setPianoRollPreviewPitch: (previewPitch) => patch({ previewPitch }),
  };
};
