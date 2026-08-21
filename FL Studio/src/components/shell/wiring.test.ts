/**
 * The wiring layer's own tests — the seams no surface test can reach.
 *
 * `@/audio` is mocked wholesale rather than driven through the real engine:
 * every behaviour under test here is about what the wiring does *around* the
 * engine (an awaited boot that loses a race, a rejected boot, a project
 * replacement that goes around `loadProject`), and jsdom has no AudioContext
 * to build a real graph in anyway. `audioSupported()` reads
 * `window.AudioContext`, so the mocked-engine tests define one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/audio", () => ({
  ensureStarted: vi.fn(async () => {}),
  play: vi.fn(),
  stop: vi.fn(),
  setMode: vi.fn(),
  setMetronomeEnabled: vi.fn(),
  previewNote: vi.fn(async () => {}),
  syncProject: vi.fn(),
  exportWav: vi.fn(),
  getMeterTap: vi.fn(() => null),
  getPlayheadTicks: vi.fn(() => 0),
  getSnapshot: vi.fn(() => ({ playing: false, metronomeEnabled: false, mode: "pattern" })),
  isStarted: vi.fn(() => false),
  subscribe: vi.fn(() => () => {}),
}));

import * as engine from "@/audio";
import { addNotes } from "@/domain/commands/patterns";
import { nextId, peekIdCounter, resetIds } from "@/domain/ids";
import { serializeProject } from "@/domain/serialization";
import { TICKS_PER_STEP, type Project } from "@/domain/types";
import { useAppStore } from "@/lib/store";

import {
  __resetWiringForTests,
  exportWav,
  importJson,
  previewNote,
  loadSavedProject,
  nextEmptyPattern,
  panic,
  peekNotice as getNotice,
  peekTransportUi,
  saveProject,
  setNotice,
  setTempo,
  startPlayback,
  stopPlayback,
  toggleMetronome,
} from "./wiring";

function fileOf(text: string): File {
  return { text: async () => text } as unknown as File;
}

function noteOn(channelId: string, id = "n-1") {
  return {
    id,
    channelId,
    positionTicks: 0,
    lengthTicks: TICKS_PER_STEP,
    pitch: 60,
    velocity: 0.8,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` clears CALLS, not implementations — a test that made the
  // boot hang would otherwise hang every test after it.
  vi.mocked(engine.ensureStarted).mockReset().mockResolvedValue(undefined);
  vi.mocked(engine.getMeterTap).mockReset().mockReturnValue(null);
  (window as { AudioContext?: unknown }).AudioContext = class {} as never;
  __resetWiringForTests();
  window.localStorage.clear();
  // The notice mirrors itself to the console; keep the test output readable.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  delete (window as { AudioContext?: unknown }).AudioContext;
  setNotice(null);
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------- playback -- */

describe("play intent survives the Tone boot window", () => {
  it("does not start the engine when Stop is pressed during boot", async () => {
    let releaseBoot: () => void = () => {};
    vi.mocked(engine.ensureStarted).mockImplementation(
      () => new Promise<void>((resolve) => { releaseBoot = resolve; }),
    );

    const starting = startPlayback();
    // The user hits Stop while `import("tone")` is still in flight.
    stopPlayback();
    releaseBoot();
    await starting;

    expect(engine.play).not.toHaveBeenCalled();
    expect(engine.stop).toHaveBeenCalledTimes(1);
    expect(peekTransportUi().isPlaying).toBe(false);
  });

  it("still starts the engine on an uninterrupted boot", async () => {
    await startPlayback();
    expect(engine.play).toHaveBeenCalledTimes(1);
  });

  it("lets the LAST play win when two boots overlap", async () => {
    const releases: Array<() => void> = [];
    vi.mocked(engine.ensureStarted).mockImplementation(
      () => new Promise<void>((resolve) => { releases.push(resolve); }),
    );

    const first = startPlayback();
    const second = startPlayback();
    releases[0]?.();
    releases[1]?.();
    await Promise.all([first, second]);

    // The stale continuation is dropped; exactly one play() reaches the engine.
    expect(engine.play).toHaveBeenCalledTimes(1);
  });

  it("rolls the UI back and reports when the boot rejects", async () => {
    vi.mocked(engine.ensureStarted).mockRejectedValue(new Error("no AudioContext"));

    // The rejection must be consumed here, not escape as an unhandled one.
    await expect(startPlayback()).resolves.toBeUndefined();

    expect(engine.play).not.toHaveBeenCalled();
    // The optimistic flag is back where it started — no stuck "Stop" button.
    expect(peekTransportUi().isPlaying).toBe(false);
    expect(getNotice()).toContain("no AudioContext");
  });

  it("does not roll back a boot failure that a newer Stop already handled", async () => {
    vi.mocked(engine.ensureStarted).mockImplementation(
      () => new Promise<void>((_, reject) => setTimeout(() => reject(new Error("boom")), 0)),
    );

    const starting = startPlayback();
    stopPlayback();
    await starting;

    // Stop's own UI write stands, and no notice shouts over a deliberate stop.
    expect(getNotice()).toBeNull();
  });

  it("keeps a metronome toggle made DURING the boot when the boot then fails", async () => {
    let rejectBoot: (error: Error) => void = () => {};
    vi.mocked(engine.ensureStarted).mockImplementation(
      () => new Promise<void>((_, reject) => { rejectBoot = reject; }),
    );

    const starting = startPlayback();
    // The user reaches for the metronome while Tone is still loading.
    toggleMetronome();
    expect(peekTransportUi().metronomeEnabled).toBe(true);

    rejectBoot(new Error("no AudioContext"));
    await starting;

    // Only the optimistic PLAY flag is rolled back. Restoring the whole
    // captured snapshot (what this did) silently un-toggled the metronome.
    expect(peekTransportUi().isPlaying).toBe(false);
    expect(peekTransportUi().metronomeEnabled).toBe(true);
  });

  it("panic stops the transport (SPEC §4.4 Ctrl+H)", async () => {
    await startPlayback();
    panic();
    expect(engine.stop).toHaveBeenCalledTimes(1);
  });
});

/* --------------------------------------------------------------- saving -- */

describe("explicit Save reports failure", () => {
  it("says nothing when the write succeeds", () => {
    expect(saveProject()).toBe(true);
    expect(getNotice()).toBeNull();
  });

  it("surfaces a notice when storage refuses the write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    expect(saveProject()).toBe(false);
    expect(getNotice()).toMatch(/could not save/i);
  });

  it("reports when there is nothing saved to load", () => {
    window.localStorage.clear();
    expect(loadSavedProject()).toBe(false);
    expect(getNotice()).toMatch(/nothing saved/i);
  });

  it("adopts the saved project when there is one", () => {
    const project = useAppStore.getState().project;
    useAppStore.getState().dispatch(
      addNotes(project.activePatternId, [
        noteOn(project.channelOrder[0]!, "n-saved"),
      ]),
    );
    expect(saveProject()).toBe(true);

    useAppStore.getState().newProject();
    expect(loadSavedProject()).toBe(true);
    const pattern = useAppStore.getState().project;
    expect(Object.keys(pattern.patterns[pattern.activePatternId]!.notes)).toContain("n-saved");
  });
});

/* -------------------------------------------------------- undoable import */

describe("JSON import", () => {
  /** A project whose ids are numerically HIGHER than the fresh counter's. */
  function importable(): Project {
    const base = useAppStore.getState().project;
    return {
      ...base,
      id: "prj-900",
      name: "Imported",
      channels: { "ch-900": { ...base.channels[base.channelOrder[0]!]!, id: "ch-900" } },
      channelOrder: ["ch-900"],
      patterns: {
        "pat-900": { id: "pat-900", name: "Imported pattern", color: "hsl(0,0%,50%)", notes: {} },
      },
      patternOrder: ["pat-900"],
      clips: {},
      activePatternId: "pat-900",
    };
  }

  it("reseeds the id counter, so the next minted id cannot collide", async () => {
    resetIds(1);
    await importJson(fileOf(serializeProject(importable())));

    expect(peekIdCounter()).toBeGreaterThanOrEqual(900);
    const minted = nextId("note");
    const project = useAppStore.getState().project;
    expect(Object.hasOwn(project.channels, minted)).toBe(false);
    expect(Object.hasOwn(project.patterns, minted)).toBe(false);
  });

  it("clears UI references to entities the import threw away", async () => {
    const before = useAppStore.getState().project;
    useAppStore.setState({
      selectedChannelId: before.channelOrder[0]!,
      playlistPaintPatternId: before.patternOrder[0]!,
      pianoRoll: { ...useAppStore.getState().pianoRoll, channelId: before.channelOrder[0]! },
    });

    await importJson(fileOf(serializeProject(importable())));

    const state = useAppStore.getState();
    expect(state.project.name).toBe("Imported");
    expect(state.selectedChannelId).toBeNull();
    expect(state.playlistPaintPatternId).toBeNull();
    expect(state.pianoRoll.channelId).toBeNull();
  });

  it("stays undoable — the import is one Ctrl+Z (SPEC §2.2)", async () => {
    const originalName = useAppStore.getState().project.name;
    await importJson(fileOf(serializeProject(importable())));
    expect(useAppStore.getState().project.name).toBe("Imported");

    useAppStore.getState().undo();
    expect(useAppStore.getState().project.name).toBe(originalName);
  });

  it("reports a file that is not a project instead of failing silently", async () => {
    await importJson(fileOf("{\"nope\":true}"));
    expect(getNotice()).toMatch(/not an FL Studio project/i);
  });
});

/* --------------------------------------------------------- WAV export ---- */

describe("WAV export failures reach the user", () => {
  it("reports a render that rejects instead of leaving an unhandled rejection", async () => {
    vi.mocked(engine.exportWav).mockRejectedValue(new Error("render failed"));

    await expect(exportWav()).resolves.toBeUndefined();

    expect(getNotice()).toMatch(/wav export failed/i);
    expect(getNotice()).toContain("render failed");
  });

  it("reports an environment with no OfflineAudioContext", async () => {
    vi.mocked(engine.exportWav).mockRejectedValue(
      new Error("OfflineAudioContext is unavailable in this environment"),
    );

    await exportWav();

    expect(getNotice()).toMatch(/OfflineAudioContext/);
  });

  it("says so when there is no audio support at all, rather than nothing", async () => {
    delete (window as { AudioContext?: unknown }).AudioContext;

    await exportWav();

    expect(engine.exportWav).not.toHaveBeenCalled();
    expect(getNotice()).toMatch(/not supported/i);
  });
});

describe("a successful WAV export clears a stale failure", () => {
  it("does not leave 'export failed' standing beside a file that downloaded", async () => {
    vi.mocked(engine.exportWav).mockRejectedValueOnce(new Error("render failed"));
    await exportWav();
    expect(getNotice()).toMatch(/wav export failed/i);

    vi.mocked(engine.exportWav).mockResolvedValueOnce({
      blob: new Blob(["riff"]),
      fileName: "project.wav",
    } as never);
    await exportWav();

    expect(getNotice()).toBeNull();
  });
});

/* ---------------------------------------------------------- preview ------ */

describe("a preview that boots audio reports a failed boot", () => {
  it("routes the rejection into the notice instead of leaving it unhandled", async () => {
    vi.mocked(engine.previewNote).mockRejectedValueOnce(new Error("no AudioContext"));

    previewNote("ch-kick", 60);
    await vi.waitFor(() => expect(getNotice()).toMatch(/audio could not start/i));

    expect(getNotice()).toContain("no AudioContext");
  });

  it("says nothing when the preview succeeds", async () => {
    previewNote("ch-kick", 60);
    await Promise.resolve();

    expect(engine.previewNote).toHaveBeenCalledWith("ch-kick", 60, undefined);
    expect(getNotice()).toBeNull();
  });

  it("does not touch the engine with no audio support", () => {
    delete (window as { AudioContext?: unknown }).AudioContext;

    previewNote("ch-kick", 60);

    expect(engine.previewNote).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------ F4 / F2 ---- */

describe("next empty pattern (F4)", () => {
  it("creates one when every pattern has notes", () => {
    const project = useAppStore.getState().project;
    useAppStore.getState().dispatch(
      addNotes(project.activePatternId, [noteOn(project.channelOrder[0]!)]),
    );
    const before = useAppStore.getState().project.patternOrder.length;

    nextEmptyPattern();

    const after = useAppStore.getState().project;
    expect(after.patternOrder).toHaveLength(before + 1);
    expect(Object.keys(after.patterns[after.activePatternId]!.notes)).toEqual([]);
  });

  it("jumps to an existing empty pattern rather than minting another", () => {
    const project = useAppStore.getState().project;
    useAppStore.getState().dispatch(
      addNotes(project.activePatternId, [noteOn(project.channelOrder[0]!)]),
    );
    nextEmptyPattern(); // mints pattern 2
    const created = useAppStore.getState().project.activePatternId;
    const count = useAppStore.getState().project.patternOrder.length;

    // Back to the full one, then F4 again: it should return to `created`.
    useAppStore.getState().setActivePatternId(project.activePatternId);
    nextEmptyPattern();

    expect(useAppStore.getState().project.activePatternId).toBe(created);
    expect(useAppStore.getState().project.patternOrder).toHaveLength(count);
  });

  it("stays put when the current pattern is already empty and alone", () => {
    const before = useAppStore.getState().project;
    nextEmptyPattern();
    expect(useAppStore.getState().project.patternOrder).toEqual(before.patternOrder);
    expect(useAppStore.getState().project.activePatternId).toBe(before.activePatternId);
  });
});

/* ------------------------------------------------------------- tempo ----- */

describe("transport tempo gestures", () => {
  it("folds one gesture but not two", () => {
    setTempo(150, "drag-a");
    setTempo(151, "drag-a");
    expect(useAppStore.getState().history.past).toHaveLength(1);

    setTempo(160, "drag-b");
    expect(useAppStore.getState().history.past).toHaveLength(2);

    useAppStore.getState().undo();
    expect(useAppStore.getState().project.tempo).toBe(151);
  });

  it("gives an id-less caller one entry per change", () => {
    setTempo(150);
    setTempo(151);
    expect(useAppStore.getState().history.past).toHaveLength(2);
  });
});
