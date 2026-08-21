/**
 * The zustand store — a **composer**, not a monolith (SPEC.md §5, §8).
 *
 * This file owns exactly two things: the domain slice (the normalized
 * `Project`, `dispatch`, undo/redo, the non-undoable navigation setters) and
 * the list of UI slices spread into the store. Everything ephemeral —
 * selection, hover, active tool, snap, zoom/scroll, drag-in-progress, focused
 * window — belongs to the surface that owns it and is registered here.
 *
 * ## Registering a UI slice (the extension point)
 *
 * A surface owns `src/components/<surface>/uiState.ts` and exports two things:
 *
 * ```ts
 * // src/components/piano-roll/uiState.ts
 * import type { AppStateCreator } from "@/lib/store";
 *
 * export interface PianoRollUiSlice {
 *   snap: SnapUnit;
 *   selectedNoteIds: string[];
 *   setSnap: (snap: SnapUnit) => void;
 * }
 *
 * export const createPianoRollUi: AppStateCreator<PianoRollUiSlice> = (set) => ({
 *   snap: "quarterBeat",
 *   selectedNoteIds: [],
 *   setSnap: (snap) => set({ snap }),
 * });
 * ```
 *
 * Registration is then exactly two lines in *this* file — an import, and a
 * spread in the creator below — plus adding the interface to {@link UiSlices}:
 *
 * ```ts
 * import { createPianoRollUi, type PianoRollUiSlice } from "@/components/piano-roll/uiState";
 * export type UiSlices = PianoRollUiSlice;              // & PlaylistUiSlice & …
 * // …
 * ...createPianoRollUi(...args),
 * ```
 *
 * No other slice edits this file; the change is requested from slice A via the
 * orchestrator. Because every creator is typed against the whole
 * {@link AppState}, a UI slice may read domain state (`get().project`) and call
 * `get().dispatch(...)`, but it must never write domain fields itself.
 */

import { create, type StateCreator } from "zustand";

import { compileTimelineCached, type CompiledTimeline } from "@/domain/compile";
import type { Command } from "@/domain/commands";
import { createDefaultProject } from "@/domain/defaultProject";
import { reseedIds } from "@/domain/ids";
import { deserializeProject, serializeProject } from "@/domain/serialization";
import {
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  createHistory,
  dispatchCommand,
  redo as historyRedo,
  redoLabel as historyRedoLabel,
  undo as historyUndo,
  undoLabel as historyUndoLabel,
  type DispatchOptions,
  type History,
} from "@/domain/undo";
import {
  MASTER_MIXER_TRACK_ID,
  STORAGE_KEY,
  type Channel,
  type ChannelId,
  type ClipId,
  type MixerTrack,
  type Note,
  type Pattern,
  type PatternClip,
  type PatternId,
  type PlaybackMode,
  type PlaylistTrack,
  type PlaylistTrackId,
  type Project,
} from "@/domain/types";

/* ---------------------------------------------------------- domain slice */

export interface DomainSlice {
  project: Project;
  history: History;

  /**
   * The only way domain state changes (SPEC.md §5). Applies the command and
   * pushes an undo entry; pass `{ coalesceKey }` during a drag so the whole
   * gesture folds into one entry, committed on pointer-up.
   */
  dispatch: (command: Command, options?: DispatchOptions) => void;
  undo: () => void;
  redo: () => void;

  /**
   * Navigation, **not** an edit: persisted domain state that bypasses the
   * command/undo stack entirely, so switching patterns never floods undo
   * (SPEC.md §5).
   */
  setActivePatternId: (patternId: PatternId) => void;
  /** Navigation too — the `L` key's pattern/song flip. */
  setPlaybackMode: (mode: PlaybackMode) => void;

  /**
   * Replace the project outright and clear history — boot hydration and "new
   * project". JSON *import* is undoable and goes through
   * `dispatch(replaceProject(...))` instead (SPEC.md §2.2).
   */
  loadProject: (project: Project) => void;
  /** Reset to the default project (SPEC.md §2.2's "new project"). */
  newProject: () => void;
  /** Read localStorage and adopt what is there; falls back to the default. */
  hydrateFromStorage: () => void;
}

export const createDomainSlice: StateCreator<AppState, [], [], DomainSlice> = (set, get) => ({
  project: createDefaultProject({ now: nowIso() }),
  history: createHistory(),

  dispatch: (command, options) => {
    const { project, history } = get();
    set(dispatchCommand(project, history, command, options));
  },

  undo: () => {
    const { project, history } = get();
    set(historyUndo(project, history));
  },

  redo: () => {
    const { project, history } = get();
    set(historyRedo(project, history));
  },

  setActivePatternId: (patternId) => {
    const { project } = get();
    if (project.patterns[patternId] === undefined) return;
    if (project.activePatternId === patternId) return;
    set({ project: { ...project, activePatternId: patternId } });
  },

  setPlaybackMode: (mode) => {
    const { project } = get();
    if (project.playbackMode === mode) return;
    set({ project: { ...project, playbackMode: mode } });
  },

  loadProject: (project) => {
    reseedIds(project);
    set({ project, history: createHistory() });
  },

  newProject: () => {
    get().loadProject(createDefaultProject({ now: nowIso() }));
  },

  hydrateFromStorage: () => {
    const stored = loadPersistedProject();
    if (stored !== null) get().loadProject(stored);
  },
});

/* ------------------------------------------------------------ ui slices */

/**
 * The registered ephemeral UI slices.
 *
 * Starts as `object` (an empty intersection). Each surface that lands a
 * `uiState.ts` turns this into `PianoRollUiSlice & PlaylistUiSlice & …`.
 */
export type UiSlices = object;

export type AppState = DomainSlice & UiSlices;

/** The type every surface-owned slice creator is declared with. */
export type AppStateCreator<TSlice> = StateCreator<AppState, [], [], TSlice>;

export const useAppStore = create<AppState>()((...args) => ({
  ...createDomainSlice(...args),
  // --- registered UI slices (one line each) -------------------------------
  // ...createPianoRollUi(...args),
  // ...createPlaylistUi(...args),
}));

/**
 * Non-hook handle for modules outside React — the audio engine reads the
 * project this way rather than subscribing per scheduler tick (lane 5 §2).
 */
export const appStore = useAppStore;

/* ----------------------------------------------------------- selectors -- */

/**
 * Frozen selector names (SPEC.md §8 "contract points"). Selectors that build a
 * new array or object must be used with zustand's `useShallow`, or read
 * through a stable primitive selector — they cannot be compared by identity.
 */
export const selectProject = (state: AppState): Project => state.project;
export const selectTempo = (state: AppState): number => state.project.tempo;
export const selectGlobalSwing = (state: AppState): number => state.project.globalSwing;
export const selectProjectName = (state: AppState): string => state.project.name;
export const selectPlaybackMode = (state: AppState): PlaybackMode => state.project.playbackMode;
export const selectActivePatternId = (state: AppState): PatternId => state.project.activePatternId;

export const selectChannelOrder = (state: AppState): ChannelId[] => state.project.channelOrder;
export const selectChannels = (state: AppState): Channel[] =>
  state.project.channelOrder
    .map((id) => state.project.channels[id])
    .filter((channel): channel is Channel => channel !== undefined);
export const selectChannel =
  (id: ChannelId) =>
  (state: AppState): Channel | undefined =>
    state.project.channels[id];

export const selectPatterns = (state: AppState): Pattern[] =>
  state.project.patternOrder
    .map((id) => state.project.patterns[id])
    .filter((pattern): pattern is Pattern => pattern !== undefined);
export const selectActivePattern = (state: AppState): Pattern | undefined =>
  state.project.patterns[state.project.activePatternId];
export const selectPattern =
  (id: PatternId) =>
  (state: AppState): Pattern | undefined =>
    state.project.patterns[id];

export const selectPlaylistTracks = (state: AppState): PlaylistTrack[] =>
  state.project.playlistTrackOrder
    .map((id) => state.project.playlistTracks[id])
    .filter((track): track is PlaylistTrack => track !== undefined);
export const selectClips = (state: AppState): PatternClip[] => Object.values(state.project.clips);
export const selectClipsForTrack =
  (trackId: PlaylistTrackId) =>
  (state: AppState): PatternClip[] =>
    Object.values(state.project.clips).filter((clip) => clip.trackId === trackId);
export const selectClip =
  (id: ClipId) =>
  (state: AppState): PatternClip | undefined =>
    state.project.clips[id];

export const selectMixerTracks = (state: AppState): MixerTrack[] =>
  state.project.mixerTrackOrder
    .map((id) => state.project.mixerTracks[id])
    .filter((track): track is MixerTrack => track !== undefined);
export const selectMasterTrack = (state: AppState): MixerTrack | undefined =>
  state.project.mixerTracks[MASTER_MIXER_TRACK_ID];

/** Notes of one channel in the active pattern — the rack row / roll source. */
export const selectNotesForChannel =
  (channelId: ChannelId) =>
  (state: AppState): Note[] => {
    const pattern = state.project.patterns[state.project.activePatternId];
    if (pattern === undefined) return [];
    return Object.values(pattern.notes).filter((note) => note.channelId === channelId);
  };

/** The memoized compiled event list the scheduler reads (SPEC.md §2.1). */
export const selectTimeline = (state: AppState): CompiledTimeline =>
  compileTimelineCached(state.project);

export const selectCanUndo = (state: AppState): boolean => historyCanUndo(state.history);
export const selectCanRedo = (state: AppState): boolean => historyCanRedo(state.history);
export const selectUndoLabel = (state: AppState): string | null => historyUndoLabel(state.history);
export const selectRedoLabel = (state: AppState): string | null => historyRedoLabel(state.history);

/* --------------------------------------------------------- persistence -- */

/**
 * `updatedAt` is stamped here, at the moment of the write, and nowhere else.
 *
 * Spec ambiguity resolved: commands are pure and may not read a clock, and if
 * `dispatch` stamped the time then undo would restore every field *except*
 * that one. Making it "the time this project was last written to storage"
 * keeps commands total and undo exact.
 */
function nowIso(): string {
  return new Date().toISOString();
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null; // Safari private mode and friends
  }
}

/** Read the saved project, or `null` when absent/corrupt (SPEC.md §2.2). */
export function loadPersistedProject(): Project | null {
  const store = storage();
  if (store === null) return null;
  try {
    return deserializeProject(store.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Write the project under the versioned envelope, stamping `updatedAt`. */
export function persistProject(project: Project): void {
  const store = storage();
  if (store === null) return;
  try {
    store.setItem(STORAGE_KEY, serializeProject({ ...project, updatedAt: nowIso() }));
  } catch {
    // Quota or private mode — a failed autosave must never break playback.
  }
}

/** The JSON-export payload (D3) — the same envelope localStorage holds. */
export function exportProjectJson(project: Project): string {
  return serializeProject({ ...project, updatedAt: nowIso() });
}

export const AUTOSAVE_DELAY_MS = 750;

/**
 * Debounced autosave (SPEC.md §2.2: "writes are debounced and never fire
 * mid-drag"). The debounce is what keeps a drag quiet: a coalescing gesture
 * dispatches continuously, and the timer only fires once it settles.
 *
 * Returns an unsubscribe that also flushes a pending write.
 */
export function startAutosave(delayMs: number = AUTOSAVE_DELAY_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Project | null = null;

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending !== null) {
      persistProject(pending);
      pending = null;
    }
  };

  const unsubscribe = useAppStore.subscribe((state, previous) => {
    if (state.project === previous.project) return;
    pending = state.project;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
  });

  return () => {
    flush();
    unsubscribe();
  };
}
