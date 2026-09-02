import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { removeChannel, updateChannel } from "@/domain/commands/channels";
import { addNotes, stepToggleCommand } from "@/domain/commands/patterns";
import { addPattern } from "@/domain/commands/patterns";
import { replaceProject, updateProject } from "@/domain/commands/project";
import { createDefaultProject } from "@/domain/defaultProject";
import { nextId, resetIds } from "@/domain/ids";
import { serializeProject } from "@/domain/serialization";
import { createHistory } from "@/domain/undo";
import { MASTER_MIXER_TRACK_ID, STORAGE_KEY, TICKS_PER_STEP, type Project } from "@/domain/types";
import {
  AUTOSAVE_DELAY_MS,
  exportProjectJson,
  loadPersistedProject,
  persistProject,
  reconcileUiReferences,
  selectActivePattern,
  selectCanRedo,
  selectCanUndo,
  selectChannels,
  selectClipsForTrack,
  selectMasterTrack,
  selectMixerTracks,
  selectNotesForChannel,
  selectPatterns,
  selectHasActiveGesture,
  selectProjectRevision,
  selectPlaybackMode,
  selectPlaylistTracks,
  selectTempo,
  selectTimeline,
  selectUndoLabel,
  startAutosave,
  useAppStore,
} from "./store";

function reset(project: Project = createDefaultProject({ now: "2026-01-01T00:00:00.000Z" })): void {
  useAppStore.setState({ project, history: createHistory() });
}

beforeEach(() => {
  window.localStorage.clear();
  resetIds(0);
  reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("dispatch and undo", () => {
  it("applies a command and records it", () => {
    useAppStore.getState().dispatch(updateProject({ tempo: 128 }));
    expect(useAppStore.getState().project.tempo).toBe(128);
    expect(selectCanUndo(useAppStore.getState())).toBe(true);
    expect(selectUndoLabel(useAppStore.getState())).toBe("Change project settings");
  });

  it("undoes and redoes through the store", () => {
    const before = useAppStore.getState().project;
    useAppStore.getState().dispatch(updateProject({ tempo: 128 }));
    useAppStore.getState().undo();
    expect(useAppStore.getState().project).toEqual(before);
    expect(selectCanRedo(useAppStore.getState())).toBe(true);

    useAppStore.getState().redo();
    expect(selectTempo(useAppStore.getState())).toBe(128);
  });

  it("toggles a step through the same command the piano roll would dispatch", () => {
    const state = useAppStore.getState();
    state.dispatch(stepToggleCommand(state.project, "pat-1", "ch-kick", 4, () => nextId("note")));

    const notes = selectNotesForChannel("ch-kick")(useAppStore.getState());
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ positionTicks: 4 * TICKS_PER_STEP, lengthTicks: 0 });

    useAppStore.getState().undo();
    expect(selectNotesForChannel("ch-kick")(useAppStore.getState())).toHaveLength(0);
  });

  it("folds a coalesced knob drag into one undo entry", () => {
    for (const volume of [0.7, 0.6, 0.55]) {
      useAppStore
        .getState()
        .dispatch(updateChannel("ch-kick", { volume }), { coalesceKey: "knob:ch-kick:volume" });
    }
    expect(useAppStore.getState().history.past).toHaveLength(1);
    useAppStore.getState().undo();
    expect(useAppStore.getState().project.channels["ch-kick"]!.volume).toBe(0.8);
  });

  /*
   * Round 16, the class, at the store's own layer. `domain/undo.ts` already
   * refuses to file an empty command, so the history half holds either way —
   * what this pins is that the store does not even NOTIFY for one. Every
   * subscriber runs synchronously on `set`, so a committed no-op woke the
   * engine sync, re-ran the UI reconcile and re-armed autosave for a write
   * that never happened.
   */
  it("does not notify a single subscriber for a command that writes nothing", () => {
    const seen = vi.fn();
    const unsubscribe = useAppStore.subscribe(seen);

    useAppStore.getState().dispatch(updateChannel("ch-kick", {}));

    expect(seen).not.toHaveBeenCalled();
    expect(useAppStore.getState().history.past).toHaveLength(0);
    unsubscribe();
  });
});

describe("the non-undoable navigation rule (SPEC.md §5)", () => {
  it("switches the active pattern without touching the undo stack", () => {
    useAppStore.getState().dispatch(addPattern({ id: "pat-2", name: "P2", color: "#fff", notes: {} }));
    const entriesBefore = useAppStore.getState().history.past.length;

    useAppStore.getState().setActivePatternId("pat-2");

    expect(useAppStore.getState().project.activePatternId).toBe("pat-2");
    expect(useAppStore.getState().history.past).toHaveLength(entriesBefore);
    expect(useAppStore.getState().history.future).toHaveLength(0);
  });

  it("flips playback mode without touching the undo stack", () => {
    useAppStore.getState().setPlaybackMode("song");
    expect(selectPlaybackMode(useAppStore.getState())).toBe("song");
    expect(useAppStore.getState().history.past).toHaveLength(0);
  });

  it("undo after navigating still undoes the last *edit*, not the navigation", () => {
    useAppStore.getState().dispatch(updateProject({ tempo: 90 }));
    useAppStore.getState().setPlaybackMode("song");
    useAppStore.getState().undo();

    expect(useAppStore.getState().project.tempo).toBe(140);
    expect(useAppStore.getState().project.playbackMode).toBe("song"); // navigation survives undo
  });

  it("ignores a switch to a pattern that does not exist", () => {
    const project = useAppStore.getState().project;
    useAppStore.getState().setActivePatternId("ghost");
    expect(useAppStore.getState().project).toBe(project);
  });

  it("is a no-op when the value is already set, so no subscriber wakes up", () => {
    const project = useAppStore.getState().project;
    useAppStore.getState().setActivePatternId("pat-1");
    useAppStore.getState().setPlaybackMode("pattern");
    expect(useAppStore.getState().project).toBe(project);
  });
});

describe("loading", () => {
  it("loadProject replaces state and clears history", () => {
    useAppStore.getState().dispatch(updateProject({ tempo: 90 }));
    useAppStore.getState().loadProject(createDefaultProject({ now: "2026-02-02T00:00:00.000Z", id: "prj-2" }));

    expect(useAppStore.getState().project.id).toBe("prj-2");
    expect(selectCanUndo(useAppStore.getState())).toBe(false);
    expect(selectCanRedo(useAppStore.getState())).toBe(false);
  });

  it("reseeds the id counter so new ids cannot collide with loaded ones", () => {
    const loaded = addNotes("pat-1", [
      { id: "n-77", channelId: "ch-kick", positionTicks: 0, lengthTicks: 0, pitch: 60, velocity: 1 },
    ]).apply(createDefaultProject());

    resetIds(0);
    useAppStore.getState().loadProject(loaded);
    expect(nextId("note")).toBe("n-78");
  });

  it("newProject resets to the default", () => {
    useAppStore.getState().dispatch(updateProject({ tempo: 90, name: "Beat" }));
    useAppStore.getState().newProject();
    expect(useAppStore.getState().project.tempo).toBe(140);
    expect(useAppStore.getState().project.name).toBe("New project");
  });

  it("JSON import goes through a command, so it is undoable", () => {
    const before = useAppStore.getState().project;
    const imported = { ...createDefaultProject(), id: "prj-imported", tempo: 174 };
    useAppStore.getState().dispatch(replaceProject(imported));
    expect(useAppStore.getState().project.id).toBe("prj-imported");

    useAppStore.getState().undo();
    expect(useAppStore.getState().project).toEqual(before);
  });
});

describe("persistence", () => {
  it("writes the versioned envelope under the namespaced key", () => {
    persistProject(useAppStore.getState().project);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).schemaVersion).toBe(1);
  });

  it("stamps updatedAt at write time, leaving commands and undo exact", () => {
    const project = { ...useAppStore.getState().project, updatedAt: "1999-01-01T00:00:00.000Z" };
    persistProject(project);
    const restored = loadPersistedProject()!;
    expect(restored.updatedAt).not.toBe("1999-01-01T00:00:00.000Z");
    expect(restored.createdAt).toBe(project.createdAt);
    expect({ ...restored, updatedAt: "" }).toEqual({ ...project, updatedAt: "" });
  });

  it("hydrates from storage on boot", () => {
    const saved = { ...createDefaultProject({ now: "2026-03-03T00:00:00.000Z" }), tempo: 92 };
    window.localStorage.setItem(STORAGE_KEY, serializeProject(saved));

    useAppStore.getState().hydrateFromStorage();
    expect(useAppStore.getState().project.tempo).toBe(92);
  });

  it("keeps the default project when the save is absent or corrupt", () => {
    useAppStore.getState().hydrateFromStorage();
    expect(useAppStore.getState().project.tempo).toBe(140);

    window.localStorage.setItem(STORAGE_KEY, "{{{ not json");
    useAppStore.getState().hydrateFromStorage();
    expect(useAppStore.getState().project.tempo).toBe(140);
    expect(loadPersistedProject()).toBeNull();
  });

  it("exports the same envelope the storage key holds", () => {
    const json = exportProjectJson(useAppStore.getState().project);
    expect(JSON.parse(json).schemaVersion).toBe(1);
    persistProject(useAppStore.getState().project);
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) as string);
    expect(JSON.parse(json).project.channels).toEqual(stored.project.channels);
  });

  it("debounces autosave, so a drag writes once at the end", () => {
    vi.useFakeTimers();
    const stop = startAutosave(AUTOSAVE_DELAY_MS);
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    for (const volume of [0.7, 0.6, 0.5]) {
      useAppStore
        .getState()
        .dispatch(updateChannel("ch-kick", { volume }), { coalesceKey: "knob:ch-kick:volume" });
      vi.advanceTimersByTime(50);
    }
    expect(setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(loadPersistedProject()!.channels["ch-kick"]!.volume).toBe(0.5);

    stop();
    setItem.mockRestore();
  });

  it("does not write for a change that leaves the project object identical", () => {
    vi.useFakeTimers();
    const stop = startAutosave(10);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    useAppStore.getState().setActivePatternId("pat-1"); // already active — no-op
    vi.advanceTimersByTime(100);
    expect(setItem).not.toHaveBeenCalled();
    stop();
    setItem.mockRestore();
  });

  it("flushes a pending write when autosave is stopped", () => {
    vi.useFakeTimers();
    const stop = startAutosave(10_000);
    useAppStore.getState().dispatch(updateProject({ tempo: 111 }));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    stop();
    expect(loadPersistedProject()!.tempo).toBe(111);
  });
});

describe("selectors", () => {
  it("returns ordered channels, patterns, tracks and strips", () => {
    const state = useAppStore.getState();
    expect(selectChannels(state).map((channel) => channel.id)).toEqual(state.project.channelOrder);
    expect(selectPatterns(state).map((pattern) => pattern.id)).toEqual(["pat-1"]);
    expect(selectPlaylistTracks(state).map((track) => track.id)).toEqual(["trk-1", "trk-2"]);
    expect(selectMixerTracks(state)).toHaveLength(9);
    expect(selectMasterTrack(state)!.id).toBe("master");
    expect(selectActivePattern(state)!.id).toBe("pat-1");
    expect(selectClipsForTrack("trk-1")(state)).toEqual([]);
  });

  it("exposes the memoized compiled timeline the scheduler reads", () => {
    const first = selectTimeline(useAppStore.getState());
    expect(first.mode).toBe("pattern");
    expect(selectTimeline(useAppStore.getState())).toBe(first);

    const state = useAppStore.getState();
    state.dispatch(stepToggleCommand(state.project, "pat-1", "ch-kick", 0, () => nextId("note")));
    expect(selectTimeline(useAppStore.getState()).events).toHaveLength(1);

    useAppStore.getState().setPlaybackMode("song");
    expect(selectTimeline(useAppStore.getState()).mode).toBe("song");
  });
});

/* ------------------------------------------------- persistence reporting -- */

describe("persistProject reports whether the write happened", () => {
  it("returns true on a successful write", () => {
    expect(persistProject(createDefaultProject({ now: "2026-01-01T00:00:00.000Z" }))).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("returns false — and does not throw — when the quota is exhausted", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    const project = createDefaultProject({ now: "2026-01-01T00:00:00.000Z" });
    expect(() => persistProject(project)).not.toThrow();
    expect(persistProject(project)).toBe(false);

    setItem.mockRestore();
  });

  it("keeps the autosave quiet on failure rather than letting it throw", () => {
    vi.useFakeTimers();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const stop = startAutosave(10);

    useAppStore.getState().dispatch(updateProject({ tempo: 155 }));
    expect(() => vi.advanceTimersByTime(50)).not.toThrow();

    stop();
    setItem.mockRestore();
    vi.useRealTimers();
  });
});

/* --------------------------------------------- ui ↔ project reconciliation */

/** A project that shares NO ids with the default one. */
function foreignProject(): Project {
  return {
    id: "prj-foreign",
    name: "Foreign",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    tempo: 120,
    globalSwing: 0,
    channels: {
      "zch-1": {
        id: "zch-1",
        name: "Foreign kick",
        color: "hsl(0, 0%, 50%)",
        voice: "kick",
        volume: 0.8,
        pan: 0,
        muted: false,
        defaultStepPitch: 60,
        routedToMixerTrackId: MASTER_MIXER_TRACK_ID,
      },
    },
    channelOrder: ["zch-1"],
    patterns: { "zpat-1": { id: "zpat-1", name: "Z", color: "hsl(0,0%,50%)", notes: {} } },
    patternOrder: ["zpat-1"],
    playlistTracks: {},
    playlistTrackOrder: [],
    clips: {},
    mixerTracks: {
      [MASTER_MIXER_TRACK_ID]: {
        id: MASTER_MIXER_TRACK_ID,
        name: "Master",
        volume: 0.8,
        pan: 0,
        muted: false,
      },
    },
    mixerTrackOrder: [MASTER_MIXER_TRACK_ID],
    playbackMode: "pattern",
    activePatternId: "zpat-1",
  };
}


/**
 * A different project that REUSES the given ids — the ordinary case, since
 * every project mints ids from the same counter.
 */
function collidingProject(ids: { channel: string; pattern: string; mixer: string }): Project {
  const foreign = foreignProject();
  return {
    ...foreign,
    id: "prj-colliding",
    channels: {
      [ids.channel]: {
        id: ids.channel,
        name: "A stranger's channel",
        color: "hsl(0, 0%, 50%)",
        voice: "snare",
        volume: 0.8,
        pan: 0,
        muted: false,
        defaultStepPitch: 60,
        routedToMixerTrackId: MASTER_MIXER_TRACK_ID,
      },
    },
    channelOrder: [ids.channel],
    patterns: {
      [ids.pattern]: {
        id: ids.pattern,
        name: "Z",
        color: "hsl(0,0%,50%)",
        // Note ids collide too — they come from the same counter.
        notes: {
          "n-1": {
            id: "n-1",
            channelId: ids.channel,
            positionTicks: 0,
            lengthTicks: TICKS_PER_STEP,
            pitch: 60,
            velocity: 0.8,
          },
          "n-2": {
            id: "n-2",
            channelId: ids.channel,
            positionTicks: TICKS_PER_STEP,
            lengthTicks: TICKS_PER_STEP,
            pitch: 62,
            velocity: 0.8,
          },
        },
      },
    },
    patternOrder: [ids.pattern],
    activePatternId: ids.pattern,
    mixerTracks: {
      ...foreign.mixerTracks,
      [ids.mixer]: { id: ids.mixer, name: "Stranger insert", volume: 0.8, pan: 0, muted: false },
    },
    mixerTrackOrder: [MASTER_MIXER_TRACK_ID, ids.mixer],
  };
}

describe("replacing the project re-points dangling UI references", () => {
  /** Aim every UI slice at entities of the CURRENT project. */
  function aimUiAtCurrentProject(): void {
    const { project } = useAppStore.getState();
    const channelId = project.channelOrder[0]!;
    const patternId = project.patternOrder[0]!;
    const mixerId = project.mixerTrackOrder.find((id) => id !== MASTER_MIXER_TRACK_ID)!;
    useAppStore.setState({
      selectedChannelId: channelId,
      pianoRollRequestChannelId: channelId,
      selectedMixerTrackId: mixerId,
      playlistPaintPatternId: patternId,
      playlistSelectedClipId: "clip-does-not-exist",
      pianoRoll: {
        ...useAppStore.getState().pianoRoll,
        channelId,
        selectedNoteIds: ["n-1", "n-2"],
        dragKind: "move",
        previewPitch: 60,
      },
    });
  }


  it("clears or re-defaults every field naming a vanished entity", () => {
    aimUiAtCurrentProject();

    useAppStore.getState().loadProject(foreignProject());

    const state = useAppStore.getState();
    expect(state.selectedChannelId).toBeNull();
    expect(state.pianoRollRequestChannelId).toBeNull();
    expect(state.playlistPaintPatternId).toBeNull();
    expect(state.playlistSelectedClipId).toBeNull();
    // The mixer's field is not nullable, so it falls back to Master.
    expect(state.selectedMixerTrackId).toBe(MASTER_MIXER_TRACK_ID);
    expect(state.pianoRoll.channelId).toBeNull();
    expect(state.pianoRoll.selectedNoteIds).toEqual([]);
    expect(state.pianoRoll.dragKind).toBeNull();
    expect(state.pianoRoll.previewPitch).toBeNull();
  });

  it("leaves references that still resolve alone, for an in-project write", () => {
    aimUiAtCurrentProject();
    const before = useAppStore.getState();
    const channelId = before.selectedChannelId!;
    const mixerId = before.selectedMixerTrackId;
    const patternId = before.playlistPaintPatternId;

    // Same project, no replacement: only the genuinely dangling ids move — the
    // fake clip and the fake note ids, and nothing else.
    const patch = reconcileUiReferences(before, before.project);
    expect(patch).not.toBeNull();
    expect(Object.keys(patch!).sort()).toEqual(["pianoRoll", "playlistSelectedClipId"]);
    expect(patch!.playlistSelectedClipId).toBeNull();
    expect(patch!.pianoRoll?.selectedNoteIds).toEqual([]);
    expect(patch!.pianoRoll?.channelId).toBe(channelId); // still resolves — untouched

    // …and an ordinary command takes that same path.
    useAppStore.getState().dispatch(updateChannel(channelId, { volume: 0.5 }));

    const after = useAppStore.getState();
    expect(after.selectedChannelId).toBe(channelId);
    expect(after.selectedMixerTrackId).toBe(mixerId);
    expect(after.playlistPaintPatternId).toBe(patternId);
    expect(after.pianoRoll.channelId).toBe(channelId);
    expect(after.playlistSelectedClipId).toBeNull();
  });

  /*
   * Ids are minted from one `<prefix>-<counter>` sequence per *project*
   * (`domain/ids.ts`), so a stranger's file is full of ids this session also
   * uses. Reconciling a wholesale replacement by liveness alone therefore left
   * every colliding reference in place, silently re-pointed at an entity the
   * user never chose — the selection, the roll's target channel, the
   * playlist's armed pattern.
   */
  it("clears colliding references on a wholesale replacement, not just dangling ones", () => {
    aimUiAtCurrentProject();
    const before = useAppStore.getState();
    const collidingIds = {
      channel: before.selectedChannelId!,
      pattern: before.playlistPaintPatternId!,
      mixer: before.selectedMixerTrackId,
    };

    useAppStore.getState().loadProject(collidingProject(collidingIds));

    // Every id below still RESOLVES in the new project — and means nothing.
    const state = useAppStore.getState();
    expect(state.project.channels[collidingIds.channel]?.name).toBe("A stranger's channel");
    expect(state.selectedChannelId).toBeNull();
    expect(state.pianoRollRequestChannelId).toBeNull();
    expect(state.pianoRoll.channelId).toBeNull();
    expect(state.pianoRoll.selectedNoteIds).toEqual([]);
    expect(state.playlistPaintPatternId).toBeNull();
    expect(state.selectedMixerTrackId).toBe(MASTER_MIXER_TRACK_ID);
  });

  it("clears colliding references when an IMPORT is undone back to another project", () => {
    aimUiAtCurrentProject();
    const ids = {
      channel: useAppStore.getState().selectedChannelId!,
      pattern: useAppStore.getState().playlistPaintPatternId!,
      mixer: useAppStore.getState().selectedMixerTrackId,
    };

    // Import (undoable, SPEC §2.2) then aim the UI at the imported entities…
    useAppStore.getState().dispatch(replaceProject(collidingProject(ids)));
    useAppStore.setState({
      selectedChannelId: ids.channel,
      pianoRoll: { ...useAppStore.getState().pianoRoll, channelId: ids.channel },
    });

    // …and undo it: the entity set is swapped back wholesale.
    useAppStore.getState().undo();

    const state = useAppStore.getState();
    expect(state.project.channels[ids.channel]).toBeDefined(); // resolves…
    expect(state.selectedChannelId).toBeNull(); // …and is cleared anyway
    expect(state.pianoRoll.channelId).toBeNull();
  });

  it("costs nothing when there is nothing to reconcile", () => {
    useAppStore.getState().newProject();
    const state = useAppStore.getState();
    expect(reconcileUiReferences(state, state.project)).toBeNull();
  });
});

/* ------------------------------- reconciliation runs after EVERY write ---- */

describe("every project write reconciles, not just a wholesale replacement", () => {
  it("drops the roll's channel when THAT channel is deleted (rack delete button)", () => {
    const channelId = useAppStore.getState().project.channelOrder[0]!;
    useAppStore.setState({
      selectedChannelId: channelId,
      pianoRoll: { ...useAppStore.getState().pianoRoll, channelId },
    });

    // Exactly what `ChannelRack`'s delete button dispatches.
    useAppStore.getState().dispatch(removeChannel(channelId));

    const state = useAppStore.getState();
    expect(state.pianoRoll.channelId).toBeNull();
    expect(state.selectedChannelId).toBeNull();
    // …and the roll's next draw therefore names a channel that exists.
    expect(() =>
      state.dispatch(
        addNotes(state.project.activePatternId, [
          {
            id: "n-after-delete",
            channelId: state.project.channelOrder[0]!,
            positionTicks: 0,
            lengthTicks: TICKS_PER_STEP,
            pitch: 60,
            velocity: 0.8,
          },
        ]),
      ),
    ).not.toThrow();
  });

  it("restores the reference when that delete is UNDONE", () => {
    const channelId = useAppStore.getState().project.channelOrder[0]!;
    useAppStore.setState({ pianoRoll: { ...useAppStore.getState().pianoRoll, channelId } });

    useAppStore.getState().dispatch(removeChannel(channelId));
    useAppStore.getState().undo();

    // The channel is back, so nothing dangles — the roll simply falls back to
    // the first channel until the user picks one again.
    expect(useAppStore.getState().project.channels[channelId]).toBeDefined();
    expect(useAppStore.getState().pianoRoll.channelId).toBeNull();
  });

  it("reconciles UNDO of an imported replaceProject (the whole entity set swaps back)", () => {
    const foreign = foreignProject();
    // Import: undoable, so it goes through dispatch — the roll then points at
    // a channel of the IMPORTED project.
    useAppStore.getState().dispatch(replaceProject(foreign));
    useAppStore.setState({
      selectedChannelId: "zch-1",
      pianoRoll: { ...useAppStore.getState().pianoRoll, channelId: "zch-1" },
    });

    useAppStore.getState().undo();

    const state = useAppStore.getState();
    expect(state.project.channels["zch-1"]).toBeUndefined();
    expect(state.pianoRoll.channelId).toBeNull();
    expect(state.selectedChannelId).toBeNull();
  });

  it("reconciles REDO back into the imported project", () => {
    const original = useAppStore.getState().project;
    const channelId = original.channelOrder[0]!;
    useAppStore.getState().dispatch(replaceProject(foreignProject()));
    useAppStore.getState().undo();
    useAppStore.setState({
      selectedChannelId: channelId,
      pianoRoll: { ...useAppStore.getState().pianoRoll, channelId },
    });

    useAppStore.getState().redo();

    const state = useAppStore.getState();
    expect(state.project.name).toBe("Foreign");
    expect(state.pianoRoll.channelId).toBeNull();
    expect(state.selectedChannelId).toBeNull();
  });

  it("does NOT cancel the drag a dispatch belongs to", () => {
    const channelId = useAppStore.getState().project.channelOrder[0]!;
    useAppStore.setState({
      pianoRoll: {
        ...useAppStore.getState().pianoRoll,
        channelId,
        dragKind: "move",
        previewPitch: 64,
      },
    });

    // A drag dispatches continuously; the gesture must survive its own edits.
    useAppStore.getState().dispatch(updateProject({ tempo: 131 }));

    expect(useAppStore.getState().pianoRoll.dragKind).toBe("move");
    expect(useAppStore.getState().pianoRoll.previewPitch).toBe(64);
  });

  it("clears a note selection left behind by switching pattern", () => {
    const { project } = useAppStore.getState();
    const noteId = "n-sel";
    useAppStore.getState().dispatch(
      addNotes(project.activePatternId, [
        {
          id: noteId,
          channelId: project.channelOrder[0]!,
          positionTicks: 0,
          lengthTicks: TICKS_PER_STEP,
          pitch: 60,
          velocity: 0.8,
        },
      ]),
    );
    useAppStore.setState({
      pianoRoll: { ...useAppStore.getState().pianoRoll, selectedNoteIds: [noteId] },
    });
    useAppStore.getState().dispatch(
      addPattern({ id: "pat-other", name: "Other", color: "hsl(0,0%,50%)", notes: {} }),
    );

    useAppStore.getState().setActivePatternId("pat-other");

    expect(useAppStore.getState().pianoRoll.selectedNoteIds).toEqual([]);
  });

  it("cancels an in-flight gesture when navigation switches pattern", () => {
    useAppStore.getState().dispatch(
      addPattern({ id: "pat-nav", name: "Nav", color: "hsl(0,0%,50%)", notes: {} }),
    );
    useAppStore.setState({
      pianoRoll: { ...useAppStore.getState().pianoRoll, dragKind: "move", previewPitch: 64 },
    });

    useAppStore.getState().setActivePatternId("pat-nav");

    expect(useAppStore.getState().pianoRoll.dragKind).toBeNull();
    expect(useAppStore.getState().pianoRoll.previewPitch).toBeNull();
  });

  it("cancels an in-flight gesture on undo and on redo", () => {
    const armDrag = (): void => {
      useAppStore.setState({
        pianoRoll: { ...useAppStore.getState().pianoRoll, dragKind: "move", previewPitch: 64 },
      });
    };

    useAppStore.getState().dispatch(updateProject({ tempo: 128 }));
    armDrag();
    useAppStore.getState().undo();
    expect(useAppStore.getState().pianoRoll.dragKind).toBeNull();
    expect(useAppStore.getState().pianoRoll.previewPitch).toBeNull();

    armDrag();
    useAppStore.getState().redo();
    expect(useAppStore.getState().pianoRoll.dragKind).toBeNull();
    expect(useAppStore.getState().pianoRoll.previewPitch).toBeNull();
  });

  it("cancels an in-flight gesture when the playback mode flips", () => {
    useAppStore.setState({
      pianoRoll: { ...useAppStore.getState().pianoRoll, dragKind: "move", previewPitch: 64 },
    });

    useAppStore.getState().setPlaybackMode("song");

    expect(useAppStore.getState().pianoRoll.dragKind).toBeNull();
    expect(useAppStore.getState().pianoRoll.previewPitch).toBeNull();
  });

  /*
   * The clone case, which liveness-filtering alone cannot see: `makeUnique`
   * copies a pattern's notes WITH their ids, so every selected id is alive in
   * the destination and the old selection survived the switch. The next
   * keyboard edit then moved notes of a clone the user never selected.
   */
  it("clears the selection switching to a clone that kept the same note ids", () => {
    const { project } = useAppStore.getState();
    const noteId = "n-shared";
    const note = {
      id: noteId,
      channelId: project.channelOrder[0]!,
      positionTicks: 0,
      lengthTicks: TICKS_PER_STEP,
      pitch: 60,
      velocity: 0.8,
    };
    useAppStore.getState().dispatch(addNotes(project.activePatternId, [note]));
    // The clone: same note id, different pattern — exactly makeUnique's output.
    useAppStore.getState().dispatch(
      addPattern({
        id: "pat-clone",
        name: "Pattern 1 (unique)",
        color: "hsl(0,0%,50%)",
        notes: { [noteId]: { ...note } },
      }),
    );
    useAppStore.setState({
      pianoRoll: { ...useAppStore.getState().pianoRoll, selectedNoteIds: [noteId] },
    });

    useAppStore.getState().setActivePatternId("pat-clone");

    expect(useAppStore.getState().project.patterns["pat-clone"]?.notes[noteId]).toBeDefined();
    expect(useAppStore.getState().pianoRoll.selectedNoteIds).toEqual([]);
  });
});

describe("a FIRST visit seeds the id counter from the default project (round 5 #1)", () => {
  /**
   * The store singleton is built at module scope, so the only way to observe
   * what a fresh boot does is to build a fresh module graph. `vi.resetModules`
   * gives the re-imported store its own `domain/ids` counter too, which is
   * exactly the "counter at 0, no save in localStorage" state a first visit is.
   */
  async function bootFreshStore() {
    vi.resetModules();
    const [store, ids, wiring] = await Promise.all([
      import("./store"),
      import("@/domain/ids"),
      import("@/components/shell/wiring"),
    ]);
    return { store, ids, wiring };
  }

  it("mints a pattern id past the default project's own literals", async () => {
    const { store, ids } = await bootFreshStore();

    // The default project's ids are fixed literals (`pat-1` … `mix-8`), not
    // minted ones, so nothing advances the counter unless the boot reseeds.
    expect(ids.peekIdCounter()).toBeGreaterThanOrEqual(8);
    expect(store.useAppStore.getState().project.patterns["pat-1"]).toBeDefined();
    expect(ids.nextId("pattern")).not.toBe("pat-1");
  });

  it("Add Pattern on a first visit does not throw a colliding-id CommandError", async () => {
    const { store, wiring } = await bootFreshStore();
    const before = Object.keys(store.useAppStore.getState().project.patterns).length;

    expect(() => wiring.addPattern()).not.toThrow();

    expect(Object.keys(store.useAppStore.getState().project.patterns)).toHaveLength(before + 1);
  });
});

describe("wholesale is DECLARED by the command, not inferred from the id (round 5 #2)", () => {
  /** Two different projects that deliberately share an id — a re-imported export. */
  function sameIdPair() {
    const a = createDefaultProject({ id: "prj-shared", name: "Mine" });
    const b = createDefaultProject({ id: "prj-shared", name: "Theirs" });
    // Give `b` a channel set that COLLIDES by id but is a different project.
    return { a, b };
  }

  function armUiAt(project: Project): void {
    useAppStore.setState({
      project,
      history: createHistory(),
      selectedChannelId: "ch-kick",
      selectedMixerTrackId: "mix-3",
      playlistPaintPatternId: "pat-1",
    });
  }

  it("clears colliding references when an import that KEPT the id is undone", () => {
    const { a, b } = sameIdPair();
    armUiAt(a);
    useAppStore.getState().dispatch(replaceProject(b));
    // Re-arm: the import itself already cleared them; the undo is what used to
    // slip through, because `previous.id === next.project.id` said "same
    // project, just an edit".
    useAppStore.setState({ selectedChannelId: "ch-kick", playlistPaintPatternId: "pat-1" });

    useAppStore.getState().undo();

    expect(useAppStore.getState().project.name).toBe("Mine");
    expect(useAppStore.getState().selectedChannelId).toBeNull();
    expect(useAppStore.getState().playlistPaintPatternId).toBeNull();
    expect(useAppStore.getState().selectedMixerTrackId).toBe(MASTER_MIXER_TRACK_ID);
  });

  it("clears them on the REDO back into the same-id import as well", () => {
    const { a, b } = sameIdPair();
    armUiAt(a);
    useAppStore.getState().dispatch(replaceProject(b));
    useAppStore.getState().undo();
    useAppStore.setState({ selectedChannelId: "ch-kick", playlistPaintPatternId: "pat-1" });

    useAppStore.getState().redo();

    expect(useAppStore.getState().project.name).toBe("Theirs");
    expect(useAppStore.getState().selectedChannelId).toBeNull();
    expect(useAppStore.getState().playlistPaintPatternId).toBeNull();
  });

  it("still treats an ORDINARY in-project edit as non-wholesale", () => {
    const { a } = sameIdPair();
    armUiAt(a);
    useAppStore.getState().dispatch(updateProject({ tempo: 128 }));

    // Nothing vanished, so nothing is re-pointed.
    expect(useAppStore.getState().selectedChannelId).toBe("ch-kick");
    expect(useAppStore.getState().playlistPaintPatternId).toBe("pat-1");

    useAppStore.getState().undo();

    expect(useAppStore.getState().selectedChannelId).toBe("ch-kick");
    expect(useAppStore.getState().playlistPaintPatternId).toBe("pat-1");
  });

  it("does not leak the `wholesale` report into store state", () => {
    useAppStore.getState().dispatch(updateProject({ tempo: 131 }));
    expect("wholesale" in useAppStore.getState()).toBe(false);
  });
});

/*
 * Round 7 #4. SPEC.md §2.2: "Writes are debounced and never fire mid-drag."
 * The debounce delivers the first half only. A gesture that dispatches
 * continuously keeps re-arming the timer, but a gesture that goes QUIET while
 * the button is still held — a pointer down on a knob, paused, then moved on —
 * lets the timer expire mid-drag and the write landed in the middle of it.
 */
describe("autosave never fires mid-gesture (SPEC §2.2)", () => {
  beforeEach(() => {
    useAppStore.setState({ activeGestureIds: [] });
  });

  afterEach(() => {
    useAppStore.setState({ activeGestureIds: [] });
  });

  it("defers a flush that comes due while a gesture is held, then writes EXACTLY once", () => {
    vi.useFakeTimers();
    const stop = startAutosave(AUTOSAVE_DELAY_MS);
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    const { beginGesture, dispatch } = useAppStore.getState();
    beginGesture("knob#1");
    dispatch(updateChannel("ch-kick", { volume: 0.5 }), { coalesceKey: "knob#1" });

    // The pointer is still down and the debounce has expired twice over.
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2);
    expect(setItem).not.toHaveBeenCalled();

    useAppStore.getState().endGesture("knob#1");
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(loadPersistedProject()!.channels["ch-kick"]!.volume).toBe(0.5);

    // …and nothing further, once the gesture is over.
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2);
    expect(setItem).toHaveBeenCalledTimes(1);

    stop();
    setItem.mockRestore();
  });

  it("folds several mid-gesture dispatches into the ONE write at gesture end", () => {
    vi.useFakeTimers();
    const stop = startAutosave(AUTOSAVE_DELAY_MS);
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    useAppStore.getState().beginGesture("knob#2");
    for (const volume of [0.7, 0.6, 0.5]) {
      useAppStore
        .getState()
        .dispatch(updateChannel("ch-kick", { volume }), { coalesceKey: "knob#2" });
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2);
    }
    expect(setItem).not.toHaveBeenCalled();

    useAppStore.getState().endGesture("knob#2");
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(loadPersistedProject()!.channels["ch-kick"]!.volume).toBe(0.5);

    stop();
    setItem.mockRestore();
  });

  it("still writes on the debounce alone when no gesture is held", () => {
    vi.useFakeTimers();
    const stop = startAutosave(AUTOSAVE_DELAY_MS);
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    useAppStore.getState().dispatch(updateProject({ tempo: 128 }));
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    expect(setItem).toHaveBeenCalledTimes(1);

    stop();
    setItem.mockRestore();
  });

  it("counts the piano roll's in-store dragKind as a gesture, with no begin/end wiring", () => {
    vi.useFakeTimers();
    const stop = startAutosave(AUTOSAVE_DELAY_MS);
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    useAppStore.getState().setPianoRollDragKind("move");
    useAppStore.getState().dispatch(updateProject({ tempo: 133 }));
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2);
    expect(setItem).not.toHaveBeenCalled();

    useAppStore.getState().setPianoRollDragKind(null);
    expect(setItem).toHaveBeenCalledTimes(1);

    stop();
    setItem.mockRestore();
  });

  it("releasing an id that is not held, or releasing twice, cannot strand the hold", () => {
    const { beginGesture, endGesture } = useAppStore.getState();
    beginGesture("a");
    beginGesture("a"); // re-entrant: still ONE hold
    endGesture("never-held");
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(true);
    endGesture("a");
    endGesture("a");
    expect(selectHasActiveGesture(useAppStore.getState())).toBe(false);
  });

  /*
   * Round 9 #5, through the store: `endGesture` has to pass the ending id down
   * to `domain/undo.ts`, or the seal is "whatever is on top" again and a
   * concurrent gesture's entry is the casualty.
   */
  it("ending one gesture does not seal a CONCURRENT gesture's open entry", () => {
    const store = useAppStore.getState();
    store.beginGesture("swing#1");
    store.beginGesture("tempo#2");
    store.dispatch(updateProject({ globalSwing: 0.3 }), {
      coalesceKey: "transport:swing",
      gestureId: "swing#1",
    });
    store.dispatch(updateProject({ tempo: 140 }), {
      coalesceKey: "transport:tempo",
      gestureId: "tempo#2",
    });

    // The swing slider is let go; the tempo drag is still down.
    useAppStore.getState().endGesture("swing#1");
    const entries = useAppStore.getState().history.past.length;
    useAppStore.getState().dispatch(updateProject({ tempo: 150 }), {
      coalesceKey: "transport:tempo",
      gestureId: "tempo#2",
    });

    // The tempo drag is still ONE entry — it coalesced.
    expect(useAppStore.getState().history.past).toHaveLength(entries);
    useAppStore.getState().endGesture("tempo#2");
    useAppStore.getState().undo();
    expect(useAppStore.getState().project.tempo).not.toBe(150);
  });

  it("does seal the ending gesture's OWN entry, id and all", () => {
    const store = useAppStore.getState();
    store.beginGesture("swing#3");
    const drag = { coalesceKey: "transport:swing", gestureId: "swing#3" };
    store.dispatch(updateProject({ globalSwing: 0.2 }), drag);
    const entries = useAppStore.getState().history.past.length;

    useAppStore.getState().endGesture("swing#3");
    // The slider is let go and grabbed again. Same key, same id — a dead
    // gesture's id can recur after a remount (rule (c) guards the id source,
    // not the store) and the sealed entry must refuse it either way. Dropping
    // the id at the store boundary leaves this entry open, because the seal
    // then has no claim on an entry that names a gesture.
    useAppStore.getState().dispatch(updateProject({ globalSwing: 0.9 }), drag);

    expect(useAppStore.getState().history.past).toHaveLength(entries + 1);
  });

  it("flushes on teardown even mid-gesture — a teardown ends everything", () => {
    vi.useFakeTimers();
    const stop = startAutosave(10_000);
    useAppStore.getState().beginGesture("held");
    useAppStore.getState().dispatch(updateProject({ tempo: 111 }));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    stop();
    expect(loadPersistedProject()!.tempo).toBe(111);
    useAppStore.getState().endGesture("held");
  });
});

/* Round 7 #1's mechanism — see `ChannelRackRow`'s `PaintSession`. */
describe("projectRevision", () => {
  it("advances on every undo and every redo, but not on an ordinary dispatch", () => {
    const start = selectProjectRevision(useAppStore.getState());
    useAppStore.getState().dispatch(updateProject({ tempo: 128 }));
    expect(selectProjectRevision(useAppStore.getState())).toBe(start);

    useAppStore.getState().undo();
    expect(selectProjectRevision(useAppStore.getState())).toBe(start + 1);
    useAppStore.getState().redo();
    expect(selectProjectRevision(useAppStore.getState())).toBe(start + 2);
  });

  /*
   * Round 8, rule (d). It counted undo/redo only, and that missed the harder
   * half: a load or an import swaps the whole entity set while a buffered
   * stroke is still open, and because ids come from one shared counter the
   * incoming project usually carries the same `pat-N` — so the stroke's
   * `patternId` guard passes and pointer-up writes it into a stranger's
   * pattern.
   */
  it("advances on loadProject — the wholesale replacement a stroke cannot survive", () => {
    const start = selectProjectRevision(useAppStore.getState());

    useAppStore.getState().loadProject(createDefaultProject({ now: "2026-03-03T00:00:00.000Z" }));

    expect(selectProjectRevision(useAppStore.getState())).toBe(start + 1);
  });

  it("advances on newProject", () => {
    const start = selectProjectRevision(useAppStore.getState());
    useAppStore.getState().newProject();
    expect(selectProjectRevision(useAppStore.getState())).toBe(start + 1);
  });

  it("advances on an undoable IMPORT, which reaches the store as a command", () => {
    const start = selectProjectRevision(useAppStore.getState());
    const incoming = createDefaultProject({ now: "2026-03-03T00:00:00.000Z" });

    useAppStore.getState().dispatch(replaceProject(incoming));

    // ...and on the undo of one, which puts the previous entity set back.
    expect(selectProjectRevision(useAppStore.getState())).toBe(start + 1);
    useAppStore.getState().undo();
    expect(selectProjectRevision(useAppStore.getState())).toBe(start + 2);
  });
});
