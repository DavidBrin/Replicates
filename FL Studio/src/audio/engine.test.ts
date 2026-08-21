/**
 * The engine's public surface and its boot lifecycle (SPEC.md §3.1, §3.2, §8).
 *
 * Tone is injected as a fake module through `__setToneLoaderForTests`, and the
 * context is the hand-rolled stub — so this suite asserts *lifecycle decisions*
 * (nothing audio before a gesture, one boot, re-arm only when the schedule
 * changed, stop-over-pause) without any real audio anywhere.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { compilePatternMode } from "@/domain/compile";
import { createDefaultProject } from "@/domain/defaultProject";
import { MASTER_MIXER_TRACK_ID, TICKS_PER_STEP, type Note, type Project } from "@/domain/types";

import {
  __setToneLoaderForTests,
  disposeEngine,
  ensureStarted,
  exportWav,
  getMeterTap,
  getPlayheadSeconds,
  getPlayheadTicks,
  getSnapshot,
  isPlaying,
  isStarted,
  play,
  previewNote,
  PREVIEW_DURATION_SEC,
  setMetronomeEnabled,
  setMode,
  stop,
  subscribe,
  syncProject,
  type ToneLike,
} from "./engine";
import type { TransportLike } from "./scheduler";
import { createStubContext, StubOfflineAudioContext, type StubAudioContext } from "./testing/audioStub";

/* ------------------------------------------------------------- fake Tone */

interface FakeTone extends ToneLike {
  ctx: StubAudioContext;
  transport: FakeTransport;
  startCalls: number;
}

interface FakeTransport extends TransportLike {
  scheduled: { time: string | number; callback: (time: number) => void }[];
  cancelCalls: number;
  startCalls: number;
  stopCalls: number;
}

function makeFakeTone(): FakeTone {
  const ctx = createStubContext();
  const transport: FakeTransport = {
    PPQ: 192,
    bpm: { value: 120 },
    loop: false,
    loopStart: 0,
    loopEnd: 0,
    ticks: 0,
    state: "stopped",
    scheduled: [],
    cancelCalls: 0,
    startCalls: 0,
    stopCalls: 0,
    schedule(callback, time) {
      this.scheduled.push({ time, callback });
      return this.scheduled.length - 1;
    },
    cancel() {
      this.cancelCalls += 1;
      this.scheduled = [];
      return this;
    },
    start() {
      this.startCalls += 1;
      this.state = "started";
      return this;
    },
    stop() {
      this.stopCalls += 1;
      this.state = "stopped";
      return this;
    },
  };
  const tone: FakeTone = {
    ctx,
    transport,
    startCalls: 0,
    async start() {
      tone.startCalls += 1;
      ctx.state = "running";
    },
    getContext: () => ({ rawContext: ctx as unknown as BaseAudioContext }),
    getTransport: () => transport,
  };
  return tone;
}

/** Install a fake Tone and return it, along with a loader call counter. */
function installTone(): { tone: FakeTone; loads: () => number } {
  const tone = makeFakeTone();
  let loads = 0;
  __setToneLoaderForTests(async () => {
    loads += 1;
    return tone;
  });
  return { tone, loads: () => loads };
}

function step(id: string, positionTicks: number, channelId = "ch-kick"): Note {
  return { id, channelId, positionTicks, lengthTicks: 0, pitch: 60, velocity: 0.9 };
}

function projectWith(notes: Note[], patch: Partial<Project> = {}): Project {
  const base = createDefaultProject();
  return {
    ...base,
    ...patch,
    patterns: {
      ...base.patterns,
      "pat-1": { ...base.patterns["pat-1"]!, notes: Object.fromEntries(notes.map((n) => [n.id, n])) },
    },
  };
}

afterEach(() => {
  disposeEngine();
  __setToneLoaderForTests(null);
});

/* --------------------------------------------------------------- boot --- */

describe("ensureStarted — the gesture-gated boot (§3.1)", () => {
  it("creates nothing audio before it is called", () => {
    installTone();
    syncProject(projectWith([]));
    expect(isStarted()).toBe(false);
    expect(getMeterTap(MASTER_MIXER_TRACK_ID)).toBeNull();
    expect(getPlayheadTicks()).toBe(0);
  });

  it("dynamic-imports Tone, starts it, and builds nodes on the raw context", async () => {
    const { tone, loads } = installTone();
    syncProject(projectWith([]));
    await ensureStarted();
    expect(loads()).toBe(1);
    expect(tone.startCalls).toBe(1);
    expect(isStarted()).toBe(true);
    // Every node came from the ONE context Tone owns.
    expect(tone.ctx.created.length).toBeGreaterThan(0);
    expect(tone.ctx.nodesOfKind("compressor")).toHaveLength(1);
  });

  it("boots once no matter how many gestures arrive", async () => {
    const { tone, loads } = installTone();
    syncProject(projectWith([]));
    await Promise.all([ensureStarted(), ensureStarted(), ensureStarted()]);
    await ensureStarted();
    expect(loads()).toBe(1);
    expect(tone.startCalls).toBe(1);
    expect(tone.ctx.nodesOfKind("compressor")).toHaveLength(1);
  });

  it("resumes a context that fell back to suspended, rather than assuming first-gesture-only", async () => {
    const { tone } = installTone();
    syncProject(projectWith([]));
    await ensureStarted();
    const resumesAfterBoot = tone.ctx.resumeCount;
    tone.ctx.state = "suspended"; // browsers auto-suspend after silence
    await ensureStarted();
    expect(tone.ctx.resumeCount).toBe(resumesAfterBoot + 1);
    expect(tone.ctx.state).toBe("running");
  });

  it("boots with no project yet, then completes the graph on the first sync", async () => {
    const { tone } = installTone();
    await ensureStarted();
    expect(isStarted()).toBe(false); // Tone is loaded, but there is no graph
    syncProject(projectWith([]));
    expect(isStarted()).toBe(true);
    expect(tone.ctx.nodesOfKind("compressor")).toHaveLength(1);
  });
});

/* ---------------------------------------------------------- transport --- */

describe("play / stop", () => {
  it("arms the transport and starts it from the top", async () => {
    const { tone } = installTone();
    syncProject(projectWith([step("a", 0), step("b", TICKS_PER_STEP * 4)]));
    await ensureStarted();
    play();
    expect(tone.transport.scheduled).toHaveLength(2);
    expect(tone.transport.loop).toBe(true);
    expect(tone.transport.ticks).toBe(0);
    expect(tone.transport.startCalls).toBe(1);
    expect(isPlaying()).toBe(true);
  });

  it("stops before every start — stop-over-pause (§3.2, Tone #370)", async () => {
    const { tone } = installTone();
    syncProject(projectWith([step("a", 0)]));
    await ensureStarted();
    play();
    play();
    expect(tone.transport.stopCalls).toBe(2);
    expect(tone.transport.startCalls).toBe(2);
  });

  it("gates boot when Play is the very first thing the user does", async () => {
    const { tone } = installTone();
    syncProject(projectWith([step("a", 0)]));
    play(); // synchronous, before any await
    expect(isPlaying()).toBe(false);
    await vi.waitFor(() => expect(isPlaying()).toBe(true));
    expect(tone.transport.startCalls).toBe(1);
  });

  it("rewinds and releases every ringing voice on stop", async () => {
    const { tone } = installTone();
    syncProject(projectWith([step("a", 0)]));
    await ensureStarted();
    play();
    tone.transport.ticks = 200;
    tone.transport.scheduled[0]?.callback(1);
    stop();
    expect(tone.transport.ticks).toBe(0);
    expect(isPlaying()).toBe(false);
    // Every voice gain was ramped to zero, none hard-cut.
    const ramped = tone.ctx.created
      .filter((n) => n.kind === "gain")
      .some((n) =>
        (n as unknown as { gain: { calls: { method: string; args: number[] }[] } }).gain.calls.some(
          (c) => c.method === "linearRampToValueAtTime" && c.args[0] === 0,
        ),
      );
    expect(ramped).toBe(true);
  });

  it("stop before boot is a harmless no-op that cancels a pending play", async () => {
    const { tone } = installTone();
    syncProject(projectWith([step("a", 0)]));
    play();
    stop();
    await ensureStarted();
    expect(tone.transport.startCalls).toBe(0);
    expect(isPlaying()).toBe(false);
  });

  it("reads the playhead off the transport in domain ticks", async () => {
    const { tone } = installTone();
    syncProject(projectWith([]), );
    await ensureStarted();
    tone.transport.ticks = 96;
    expect(getPlayheadTicks()).toBe(96);
    expect(getPlayheadSeconds()).toBeCloseTo(60 / 140, 6);
  });
});

/* --------------------------------------------------------- store sync --- */

describe("syncProject — the store seam (§5)", () => {
  it("re-arms when the compiled timeline changes", async () => {
    const { tone } = installTone();
    const first = projectWith([step("a", 0)]);
    syncProject(first);
    await ensureStarted();
    play();
    const armings = tone.transport.cancelCalls;
    syncProject(projectWith([step("a", 0), step("b", TICKS_PER_STEP)]));
    expect(tone.transport.cancelCalls).toBe(armings + 1);
    expect(tone.transport.scheduled).toHaveLength(2);
  });

  it("does NOT re-arm when nothing about the schedule changed", async () => {
    const { tone } = installTone();
    const project = projectWith([step("a", 0)]);
    syncProject(project);
    await ensureStarted();
    play();
    const armings = tone.transport.cancelCalls;
    syncProject(project);
    syncProject(project);
    expect(tone.transport.cancelCalls).toBe(armings);
  });

  it("does NOT re-arm for a tempo change — BPM is a live signal", async () => {
    const { tone } = installTone();
    const project = projectWith([step("a", 0)]);
    syncProject(project);
    await ensureStarted();
    play();
    const armings = tone.transport.cancelCalls;
    syncProject({ ...project, tempo: 174 });
    expect(tone.transport.cancelCalls).toBe(armings);
    expect(tone.transport.bpm.value).toBe(174);
  });

  it("DOES re-arm for a swing change — swing is applied at scheduling time", async () => {
    const { tone } = installTone();
    const project = projectWith([step("off", TICKS_PER_STEP)]);
    syncProject(project);
    await ensureStarted();
    play();
    expect(tone.transport.scheduled[0]?.time).toBe(`${TICKS_PER_STEP}i`);
    syncProject({ ...project, globalSwing: 1 });
    expect(tone.transport.scheduled[0]?.time).toBe(`${TICKS_PER_STEP * 1.5}i`);
  });

  it("ramps a fader change into the graph without re-arming", async () => {
    const { tone } = installTone();
    const project = projectWith([step("a", 0)]);
    syncProject(project);
    await ensureStarted();
    play();
    const armings = tone.transport.cancelCalls;
    syncProject({
      ...project,
      mixerTracks: {
        ...project.mixerTracks,
        [MASTER_MIXER_TRACK_ID]: { ...project.mixerTracks[MASTER_MIXER_TRACK_ID]!, volume: 0.2 },
      },
    });
    expect(tone.transport.cancelCalls).toBe(armings);
  });

  it("triggers a note through the channel's voice with the transport's time", async () => {
    const { tone } = installTone();
    syncProject(projectWith([step("a", 0)]));
    await ensureStarted();
    play();
    tone.transport.scheduled[0]?.callback(7.5);
    const osc = tone.ctx.nodesOfKind("oscillator")[0] as unknown as { startTime: number };
    expect(osc.startTime).toBe(7.5);
  });

  it("reads the CURRENT project at fire time, so a voice change needs no re-arm", async () => {
    const { tone } = installTone();
    const project = projectWith([step("a", 0)]);
    syncProject(project);
    await ensureStarted();
    play();
    syncProject({
      ...project,
      channels: { ...project.channels, "ch-kick": { ...project.channels["ch-kick"]!, voice: "lead" } },
    });
    tone.transport.scheduled[0]?.callback(1);
    // The lead is two detuned saws; the kick is one sine.
    const oscs = tone.ctx.nodesOfKind("oscillator") as unknown as { type: string }[];
    expect(oscs).toHaveLength(2);
    expect(oscs.every((o) => o.type === "sawtooth")).toBe(true);
  });
});

/* -------------------------------------------------------------- modes --- */

describe("setMode", () => {
  it("re-arms the transport source for song mode", async () => {
    const { tone } = installTone();
    const project = projectWith([step("a", 0)], {
      clips: {
        c1: { id: "c1", trackId: "trk-1", patternId: "pat-1", startTick: 0 },
        c2: { id: "c2", trackId: "trk-1", patternId: "pat-1", startTick: 384 },
      },
    });
    syncProject(project);
    await ensureStarted();
    play();
    expect(tone.transport.scheduled).toHaveLength(1);
    setMode("song");
    expect(tone.transport.scheduled).toHaveLength(2);
    expect(tone.transport.loopEnd).toBe("768i");
    expect(getSnapshot().mode).toBe("song");
  });

  it("keeps playing across a mode flip, from the top of the new source", async () => {
    const { tone } = installTone();
    syncProject(projectWith([step("a", 0)]));
    await ensureStarted();
    play();
    const starts = tone.transport.startCalls;
    setMode("song");
    expect(isPlaying()).toBe(true);
    expect(tone.transport.startCalls).toBe(starts + 1);
  });

  it("stays stopped if it was stopped", async () => {
    installTone();
    syncProject(projectWith([step("a", 0)]));
    await ensureStarted();
    setMode("song");
    expect(isPlaying()).toBe(false);
  });

  it("ignores a flip to the mode already set", async () => {
    const { tone } = installTone();
    syncProject(projectWith([step("a", 0)]));
    await ensureStarted();
    play();
    const armings = tone.transport.cancelCalls;
    setMode("pattern");
    expect(tone.transport.cancelCalls).toBe(armings);
  });
});

/* ---------------------------------------------------------- metronome --- */

describe("metronome (D1)", () => {
  it("adds a click per beat when enabled and removes them when off", async () => {
    const { tone } = installTone();
    syncProject(projectWith([step("a", 0)]));
    await ensureStarted();
    play();
    expect(tone.transport.scheduled).toHaveLength(1);
    setMetronomeEnabled(true);
    expect(tone.transport.scheduled).toHaveLength(5); // 1 note + 4 beats
    setMetronomeEnabled(false);
    expect(tone.transport.scheduled).toHaveLength(1);
  });

  it("sounds the click on the master bus, bypassing the mixer strips", async () => {
    const { tone } = installTone();
    syncProject(projectWith([]));
    await ensureStarted();
    setMetronomeEnabled(true);
    play();
    const before = tone.ctx.nodesOfKind("bufferSource").length;
    tone.transport.scheduled[0]?.callback(3);
    expect(tone.ctx.nodesOfKind("bufferSource").length).toBe(before + 1);
    expect(getSnapshot().metronomeEnabled).toBe(true);
  });
});

/* -------------------------------------------------------- previewNote --- */

describe("previewNote", () => {
  it("sounds one note on the channel's voice at the default preview length", async () => {
    const { tone } = installTone();
    syncProject(projectWith([]));
    await ensureStarted();
    tone.ctx.currentTime = 5;
    previewNote("ch-bass", 43);
    const oscs = tone.ctx.nodesOfKind("oscillator") as unknown as {
      startTime: number;
      stopTime: number;
    }[];
    expect(oscs.length).toBeGreaterThan(0);
    expect(oscs[0]!.startTime).toBeCloseTo(5.001, 6);
    expect(oscs[0]!.stopTime).toBeGreaterThan(5 + PREVIEW_DURATION_SEC);
  });

  it("honours an explicit duration", async () => {
    const { tone } = installTone();
    syncProject(projectWith([]));
    await ensureStarted();
    previewNote("ch-lead", 72, 1.5);
    const short = tone.ctx.nodesOfKind("oscillator")[0] as unknown as { stopTime: number };
    expect(short.stopTime).toBeGreaterThan(1.5);
  });

  it("gates the boot when a key press is the first gesture", async () => {
    const { tone } = installTone();
    syncProject(projectWith([]));
    previewNote("ch-kick", 60);
    expect(tone.ctx.nodesOfKind("oscillator")).toHaveLength(0);
    await vi.waitFor(() => expect(tone.ctx.nodesOfKind("oscillator").length).toBe(1));
  });

  it("ignores an unknown channel", async () => {
    const { tone } = installTone();
    syncProject(projectWith([]));
    await ensureStarted();
    previewNote("ch-nope", 60);
    expect(tone.ctx.nodesOfKind("oscillator")).toHaveLength(0);
  });

  it("chokes across the group like a scheduled note does", async () => {
    const { tone } = installTone();
    syncProject(projectWith([]));
    await ensureStarted();
    const rampsToZero = (): number =>
      tone.ctx
        .nodesOfKind("gain")
        .flatMap(
          (n) => (n as unknown as { gain: { calls: { method: string; args: number[] }[] } }).gain.calls,
        )
        .filter((c) => c.method === "linearRampToValueAtTime" && c.args[0] === 0).length;

    previewNote("ch-hat-open", 60);
    const before = rampsToZero();
    previewNote("ch-hat-closed", 60);
    expect(rampsToZero()).toBeGreaterThan(before);
  });
});

/* -------------------------------------------------------- meters, misc -- */

describe("meter taps and snapshots", () => {
  it("returns the master tap by default and a per-track tap by id", async () => {
    installTone();
    syncProject(projectWith([]));
    await ensureStarted();
    expect(getMeterTap()).toBe(getMeterTap(MASTER_MIXER_TRACK_ID));
    expect(getMeterTap("mix-1")).not.toBeNull();
    expect(getMeterTap("mix-1")).not.toBe(getMeterTap(MASTER_MIXER_TRACK_ID));
    expect(getMeterTap("nope")).toBeNull();
  });

  it("notifies subscribers on transport state changes and unsubscribes cleanly", async () => {
    installTone();
    const seen: boolean[] = [];
    const unsubscribe = subscribe((snapshot) => seen.push(snapshot.playing));
    syncProject(projectWith([step("a", 0)]));
    await ensureStarted();
    play();
    stop();
    expect(seen).toContain(true);
    expect(seen.at(-1)).toBe(false);
    unsubscribe();
    const count = seen.length;
    play();
    expect(seen).toHaveLength(count);
  });

  it("reports a snapshot that starts empty", () => {
    installTone();
    expect(getSnapshot()).toEqual({
      started: false,
      playing: false,
      mode: "pattern",
      metronomeEnabled: false,
    });
  });
});

describe("exportWav", () => {
  it("renders the synced project through an offline context", async () => {
    installTone();
    const project = projectWith([step("a", 0)]);
    syncProject(project);
    const contexts: StubOfflineAudioContext[] = [];
    const result = await exportWav({
      sampleRate: 8000,
      createOfflineContext: (channels, frames, sampleRate) => {
        const ctx = new StubOfflineAudioContext(channels, frames, sampleRate);
        contexts.push(ctx);
        return ctx as unknown as OfflineAudioContext;
      },
    });
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.renderCount).toBe(1);
    expect(result.blob.type).toBe("audio/wav");
    expect(compilePatternMode(project).events).toHaveLength(1);
  });

  it("does not need a live engine", async () => {
    installTone();
    syncProject(projectWith([step("a", 0)]));
    expect(isStarted()).toBe(false);
    await expect(
      exportWav({
        sampleRate: 8000,
        createOfflineContext: (c, f, s) =>
          new StubOfflineAudioContext(c, f, s) as unknown as OfflineAudioContext,
      }),
    ).resolves.toBeDefined();
  });

  it("refuses without a project rather than exporting silence", async () => {
    installTone();
    await expect(exportWav()).rejects.toThrow(/no project/i);
  });
});

describe("disposeEngine", () => {
  it("tears everything down so a later boot starts clean", async () => {
    const { tone } = installTone();
    syncProject(projectWith([step("a", 0)]));
    await ensureStarted();
    play();
    disposeEngine();
    expect(isStarted()).toBe(false);
    expect(isPlaying()).toBe(false);
    expect(getMeterTap()).toBeNull();
    expect(tone.transport.stopCalls).toBeGreaterThan(0);
    expect(tone.transport.cancelCalls).toBeGreaterThan(0);
  });
});
