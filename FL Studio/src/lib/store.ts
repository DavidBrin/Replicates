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

import {
  createChannelRackUi,
  type ChannelRackUiSlice,
} from "@/components/channel-rack/uiState";
import { createMixerUi, type MixerUiSlice } from "@/components/mixer/uiState";
import {
  createPianoRollUi,
  type PianoRollUiSlice,
} from "@/components/piano-roll/uiState";
import { createPlaylistUi, type PlaylistUiSlice } from "@/components/playlist/uiState";

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
  endGesture as historyEndGesture,
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
   * Close the coalescing gesture in flight, so the next `dispatch` starts a
   * fresh undo entry even if it repeats the same `coalesceKey`.
   *
   * The escape hatch for gestures with no natural id; the preferred form is
   * `dispatch(cmd, { coalesceKey, gestureId })` — see `domain/undo.ts`'s
   * header for the canonical pattern.
   */
  endGesture: () => void;

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

  /**
   * Point every UI slice's project-referencing field back at something that
   * exists (see {@link reconcileUiReferences}), *and* cancel any gesture in
   * flight — the wholesale-replacement form.
   *
   * Called automatically by {@link DomainSlice.loadProject}. Every other
   * project write reconciles on its own: {@link DomainSlice.dispatch} without
   * the gesture reset (a drag's own commands must not cancel the drag),
   * undo/redo and the navigation setters *with* it.
   */
  reconcileUiToProject: () => void;
}

/** Options for {@link reconcileUiReferences}. */
export interface ReconcileOptions {
  /**
   * Also clear the piano roll's in-flight drag and held preview key.
   *
   * True for a *wholesale* replacement (`loadProject`, an undoable import)
   * and for every write the user did not make with the pointer they are
   * holding — pattern navigation, undo and redo. A drag cannot survive the
   * project it was dragging, and it cannot survive an undo that deleted the
   * notes it is dragging either.
   *
   * It must stay false for the ordinary per-command pass, because a drag
   * dispatches continuously and would otherwise cancel itself on its own
   * first move.
   */
  resetGestures?: boolean;

  /**
   * This write swapped the whole entity set — a load, an import, or an
   * undo/redo of one.
   *
   * Liveness is the wrong test for that. `Object.hasOwn(project.channels,
   * selectedChannelId)` asks whether *an* entity answers to that id, not
   * whether it is the one the field meant, and ids are not globally unique:
   * every project mints them from the same `<prefix>-<counter>` sequence
   * (`domain/ids.ts`), so an unrelated file's `ch-2` collides with this
   * session's `ch-2` as a matter of course. Importing a stranger's project
   * therefore left the rack selecting, the roll editing and the playlist
   * painting *its* entities, silently re-pointed at whatever happened to
   * share the number.
   *
   * So a wholesale replacement clears every project-scoped ephemeral field
   * unconditionally: nothing the user chose in the old project has a meaning
   * in the new one. In-project mutations keep the liveness test — deleting one
   * channel must not drop the roll's selection.
   */
  wholesale?: boolean;

  /**
   * The active pattern *before* this write, when the caller knows it.
   *
   * Selection is reconciled by note-id liveness, and that is not enough on a
   * pattern switch: `makeUnique` clones a pattern with its note ids intact,
   * so every selected id is alive in the destination too and the old
   * selection survives the navigation — a subsequent keyboard edit then hits
   * notes of the clone the user never selected. A changed active pattern
   * clears the roll's selection outright.
   */
  previousPatternId?: PatternId;
}

/* ------------------------------------------- ui ↔ project reconciliation */

/**
 * Every ephemeral field that names a domain entity, and what it must become
 * when that entity is not in the project any more.
 *
 * This table lives here, in the composer, rather than in each surface's
 * `uiState.ts` for the reason the file header gives: an entity disappearing
 * is a *store-level* event, and no surface can be relied on to notice one.
 * Before this existed, importing a JSON file left the playlist armed with a
 * pattern id from the old project and the piano roll pointed at a channel
 * that no longer existed — the next click on either threw.
 *
 * **Import is not the only way an entity disappears.** Deleting the channel
 * the roll is editing, or undoing/redoing the import that replaced the whole
 * entity set, dangles exactly the same fields — so this runs after *every*
 * project write (`dispatch`, `undo`, `redo`, the navigation setters), not
 * just at import. It is an id-validation pass over a handful of fields: a few
 * `Object.hasOwn` lookups plus one filter over the roll's selection.
 *
 * Each entry is guarded by a `typeof`/`in` check on the live state, so a slice
 * is free to rename or drop a field without breaking this: an absent field is
 * simply not reconciled. Only genuinely dangling values are rewritten, and the
 * function returns `null` when nothing dangles, so a no-op costs no render.
 */
export function reconcileUiReferences(
  state: AppState,
  project: Project,
  { resetGestures = false, wholesale = false, previousPatternId }: ReconcileOptions = {},
): Partial<AppState> | null {
  const patch: Record<string, unknown> = {};

  const alive = (record: Record<string, unknown>, id: unknown): boolean =>
    typeof id === "string" && Object.hasOwn(record, id);
  /**
   * Whether a field must be re-pointed. On a wholesale replacement every
   * project-scoped id is stale by construction, colliding or not — see
   * {@link ReconcileOptions.wholesale}.
   */
  const stale = (record: Record<string, unknown>, id: unknown): boolean =>
    wholesale || !alive(record, id);

  // --- channel-rack ------------------------------------------------------
  if (state.selectedChannelId !== null && stale(project.channels, state.selectedChannelId)) {
    patch.selectedChannelId = null;
  }
  if (
    state.pianoRollRequestChannelId !== null &&
    stale(project.channels, state.pianoRollRequestChannelId)
  ) {
    patch.pianoRollRequestChannelId = null;
  }

  // --- mixer: never null, so it falls back to Master rather than clearing --
  if (
    stale(project.mixerTracks, state.selectedMixerTrackId) &&
    state.selectedMixerTrackId !== MASTER_MIXER_TRACK_ID
  ) {
    patch.selectedMixerTrackId = MASTER_MIXER_TRACK_ID;
  }

  // --- playlist ----------------------------------------------------------
  if (
    state.playlistSelectedClipId !== null &&
    stale(project.clips, state.playlistSelectedClipId)
  ) {
    patch.playlistSelectedClipId = null;
  }
  if (
    state.playlistPaintPatternId !== null &&
    stale(project.patterns, state.playlistPaintPatternId)
  ) {
    // `null` is this field's documented "follow the active pattern".
    patch.playlistPaintPatternId = null;
  }

  // --- piano roll (one namespaced object, so patch it as a whole) ---------
  const roll = state.pianoRoll;
  if (roll !== undefined && roll !== null) {
    const rollPatch: Record<string, unknown> = {};
    if (roll.channelId !== null && stale(project.channels, roll.channelId)) {
      rollPatch.channelId = null;
    }
    const notes = project.patterns[project.activePatternId]?.notes ?? {};
    // A pattern switch — or a whole new project — drops the selection outright;
    // otherwise only ids whose notes are gone. Filtering by liveness alone is a
    // no-op across a clone, and across an import it is worse than a no-op: the
    // surviving ids name a stranger's notes.
    const patternChanged =
      previousPatternId !== undefined && previousPatternId !== project.activePatternId;
    const survivingNotes =
      wholesale || patternChanged ? [] : roll.selectedNoteIds.filter((id) => alive(notes, id));
    if (survivingNotes.length !== roll.selectedNoteIds.length) {
      rollPatch.selectedNoteIds = survivingNotes;
    }
    // A drag cannot survive the project it was dragging — but only a
    // wholesale replacement counts as "the project it was dragging" going
    // away; a drag's own commands must not cancel the drag.
    if (resetGestures || wholesale) {
      if (roll.dragKind !== null) rollPatch.dragKind = null;
      if (roll.previewPitch !== null) rollPatch.previewPitch = null;
    }
    if (Object.keys(rollPatch).length > 0) {
      patch.pianoRoll = { ...roll, ...rollPatch };
    }
  }

  return Object.keys(patch).length === 0 ? null : (patch as Partial<AppState>);
}

export const createDomainSlice: StateCreator<AppState, [], [], DomainSlice> = (set, get) => {
  /**
   * The ONE way a project write reaches the store.
   *
   * Every write is followed by {@link reconcileUiReferences}, because every
   * write can delete the entity some ephemeral field names — `removeChannel`
   * while the roll is open on it, an undo of an imported `replaceProject`
   * that swaps the whole entity set. Doing it here rather than at each call
   * site is what makes that true by construction: a new command, or a new
   * caller, cannot forget.
   */
  const commit = (
    next: { project: Project; history?: History },
    options: ReconcileOptions = {},
  ): void => {
    // Captured before the write: the reconcile pass has to know whether this
    // write navigated to a different pattern (see `previousPatternId`), and
    // whether it swapped the project outright (see `wholesale`).
    const previous = get().project;
    const previousPatternId = previous.activePatternId;
    // `replaceProject` — a JSON import, and the undo/redo of one — is the only
    // command that changes the project's own id, which is what makes this a
    // reliable "different project" test rather than a list of call sites to
    // keep in sync.
    const wholesale = options.wholesale === true || previous.id !== next.project.id;
    set(next);
    const state = get();
    const patch = reconcileUiReferences(state, state.project, {
      ...options,
      wholesale,
      resetGestures: options.resetGestures === true || wholesale,
      previousPatternId,
    });
    if (patch !== null) set(patch);
  };

  return {
    project: createDefaultProject({ now: nowIso() }),
    history: createHistory(),

    dispatch: (command, options) => {
      const { project, history } = get();
      commit(dispatchCommand(project, history, command, options));
    },

    // Undo/redo are not the gesture's own writes, even mid-drag: a Ctrl+Z
    // between two pointermoves can delete the very notes the drag holds
    // snapshots of, and the next move would dispatch `updateNotes` against
    // ids that no longer exist. Resetting the gesture is what stops that —
    // the host relays the cleared `dragKind` into the controller's `cancel()`.
    undo: () => {
      const { project, history } = get();
      commit(historyUndo(project, history), { resetGestures: true });
    },

    redo: () => {
      const { project, history } = get();
      commit(historyRedo(project, history), { resetGestures: true });
    },

    endGesture: () => {
      const { history } = get();
      const next = historyEndGesture(history);
      if (next !== history) set({ history: next });
    },

    setActivePatternId: (patternId) => {
      const { project } = get();
      if (project.patterns[patternId] === undefined) return;
      if (project.activePatternId === patternId) return;
      // Navigation cancels the gesture in flight. A drag that began in the
      // pattern being left holds note snapshots from it, and Numpad +/- is
      // reachable with the pointer still down.
      commit({ project: { ...project, activePatternId: patternId } }, { resetGestures: true });
    },

    setPlaybackMode: (mode) => {
      const { project } = get();
      if (project.playbackMode === mode) return;
      commit({ project: { ...project, playbackMode: mode } }, { resetGestures: true });
    },

    loadProject: (project) => {
      reseedIds(project);
      set({ project, history: createHistory() });
      get().reconcileUiToProject();
    },

    newProject: () => {
      get().loadProject(createDefaultProject({ now: nowIso() }));
    },

    hydrateFromStorage: () => {
      const stored = loadPersistedProject();
      if (stored !== null) get().loadProject(stored);
    },

    reconcileUiToProject: () => {
      const state = get();
      const patch = reconcileUiReferences(state, state.project, {
        resetGestures: true,
        wholesale: true,
      });
      if (patch !== null) set(patch);
    },
  };
};

/* ------------------------------------------------------------ ui slices */

/**
 * The registered ephemeral UI slices — one intersection member per surface.
 *
 * Every surface `uiState.ts` imported here must import from *this* file with
 * `import type` only. A runtime edge back into `store.ts` would close an
 * import cycle whose two ends are both evaluated at module scope (this file
 * calls each creator inside `create()`), and whichever module the bundler
 * reached second would read the other's `const` in its temporal dead zone.
 * That is why the surfaces' store-reading hooks live beside their slices
 * (e.g. `piano-roll/rollUi.ts`) rather than inside `uiState.ts`.
 */
export type UiSlices = ChannelRackUiSlice & MixerUiSlice & PianoRollUiSlice & PlaylistUiSlice;

export type AppState = DomainSlice & UiSlices;

/** The type every surface-owned slice creator is declared with. */
export type AppStateCreator<TSlice> = StateCreator<AppState, [], [], TSlice>;

export const useAppStore = create<AppState>()((...args) => ({
  ...createDomainSlice(...args),
  // --- registered UI slices (one line each) -------------------------------
  ...createChannelRackUi(...args),
  ...createMixerUi(...args),
  ...createPianoRollUi(...args),
  ...createPlaylistUi(...args),
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

/**
 * Write the project under the versioned envelope, stamping `updatedAt`.
 *
 * **Returns whether the write happened.** Swallowing the failure silently (as
 * this did) is right for the debounced autosave — a full quota must never
 * break playback — and wrong for the Save button, which otherwise reports
 * success by saying nothing at all while the project is not on disk. The
 * failure is reported, not thrown, so the autosave caller can keep ignoring it
 * with no try/catch of its own.
 */
export function persistProject(project: Project): boolean {
  const store = storage();
  if (store === null) return false;
  try {
    store.setItem(STORAGE_KEY, serializeProject({ ...project, updatedAt: nowIso() }));
    return true;
  } catch {
    // Quota or private mode.
    return false;
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
      // Autosave stays quiet on failure by design (SPEC §2.2: writes must
      // never interrupt); the explicit Save button is what surfaces it.
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
