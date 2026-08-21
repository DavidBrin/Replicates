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
 * ## Until registration lands
 *
 * {@link useRollUi} reads the app store when the slice is registered there and
 * falls back to a standalone store with the *same* creator when it is not, so
 * the roll is fully functional before integration and needs no change after
 * it. Delete the fallback once `store.ts` spreads the creator.
 */

import { create } from "zustand";

import { SNAP_UNITS, type SnapUnit } from "@/domain/tickMath";
import { TICKS_PER_STEP, type ChannelId, type NoteId } from "@/domain/types";
import { useAppStore, type AppState, type AppStateCreator } from "@/lib/store";

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
   * against `AppState`, which does not yet include this slice's own keys — so
   * writing `pianoRoll` through the raw setter is an excess-property error
   * until slice A widens `UiSlices`. Casting here (rather than declaring the
   * creator against `AppState & PianoRollUiSlice`) keeps the exported type
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

/* ------------------------------------------- store bridge (pre-wiring) -- */

/**
 * The standalone fallback store, used only while `store.ts` has not spread
 * {@link createPianoRollUi} yet. It carries the UI slice alone; the roll's
 * domain reads and `dispatch` always go to the real app store.
 */
const fallbackStore = create<PianoRollUiSlice>()((...args) =>
  createPianoRollUi(...(args as unknown as Parameters<AppStateCreator<PianoRollUiSlice>>)),
);

/** True once slice A registers this slice in `src/lib/store.ts`. */
export function isPianoRollUiRegistered(): boolean {
  return "pianoRoll" in (useAppStore.getState() as Partial<PianoRollUiSlice>);
}

const registered = isPianoRollUiRegistered();

/** The store holding this slice — the app store once registered, else the fallback. */
export const rollUiStore = (registered
  ? (useAppStore as unknown as typeof fallbackStore)
  : fallbackStore) as typeof fallbackStore;

/** React binding: `useRollUi((ui) => ui.pianoRoll.snap)`. */
export function useRollUi<T>(selector: (slice: PianoRollUiSlice) => T): T {
  return rollUiStore(selector);
}

/** Non-hook read, for the imperative canvas painter and the key bindings. */
export function getRollUi(): PianoRollUiSlice {
  return rollUiStore.getState();
}

/** Test-only: return the slice to its defaults between cases. */
export function __resetPianoRollUiForTests(): void {
  rollUiStore.setState({ pianoRoll: DEFAULT_PIANO_ROLL_UI });
}
