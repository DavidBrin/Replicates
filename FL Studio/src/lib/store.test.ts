import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { updateChannel } from "@/domain/commands/channels";
import { addNotes, stepToggleCommand } from "@/domain/commands/patterns";
import { addPattern } from "@/domain/commands/patterns";
import { replaceProject, updateProject } from "@/domain/commands/project";
import { createDefaultProject } from "@/domain/defaultProject";
import { nextId, resetIds } from "@/domain/ids";
import { serializeProject } from "@/domain/serialization";
import { createHistory } from "@/domain/undo";
import { STORAGE_KEY, TICKS_PER_STEP, type Project } from "@/domain/types";
import {
  AUTOSAVE_DELAY_MS,
  exportProjectJson,
  loadPersistedProject,
  persistProject,
  selectActivePattern,
  selectCanRedo,
  selectCanUndo,
  selectChannels,
  selectClipsForTrack,
  selectMasterTrack,
  selectMixerTracks,
  selectNotesForChannel,
  selectPatterns,
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
