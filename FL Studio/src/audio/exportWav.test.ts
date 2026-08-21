/**
 * WAV export (SPEC.md §3.5, D2).
 *
 * The render is asserted through an injected `OfflineAudioContext` stub: what
 * matters is that the export reuses the live graph's own chain and voices, that
 * the render length follows the timeline and tempo, and that the encoder emits
 * a well-formed 16-bit PCM WAV.
 */

import { describe, expect, it } from "vitest";

import { createDefaultProject } from "@/domain/defaultProject";
import { compilePatternMode, compileSongMode } from "@/domain/compile";
import { ticksToSeconds } from "@/domain/tickMath";
import {
  PATTERN_LENGTH_TICKS,
  TICKS_PER_BAR,
  TICKS_PER_STEP,
  type Note,
  type Project,
} from "@/domain/types";

import {
  encodeWav,
  EXPORT_CHANNELS,
  EXPORT_TAIL_SECONDS,
  exportProjectWav,
  renderLengthSeconds,
  renderProject,
  wavFileName,
} from "./exportWav";
import { StubAudioBuffer, StubOfflineAudioContext } from "./testing/audioStub";

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

function recorder() {
  const contexts: StubOfflineAudioContext[] = [];
  const createOfflineContext = (channels: number, frames: number, sampleRate: number) => {
    const ctx = new StubOfflineAudioContext(channels, frames, sampleRate);
    contexts.push(ctx);
    return ctx as unknown as OfflineAudioContext;
  };
  return { contexts, createOfflineContext };
}

describe("renderLengthSeconds", () => {
  it("is the timeline length at tempo plus a release tail", () => {
    const project = projectWith([]);
    const timeline = compilePatternMode(project);
    expect(renderLengthSeconds(timeline, 140)).toBeCloseTo(
      ticksToSeconds(PATTERN_LENGTH_TICKS, 140) + EXPORT_TAIL_SECONDS,
      6,
    );
  });

  it("shrinks as tempo rises", () => {
    const timeline = compilePatternMode(projectWith([]));
    expect(renderLengthSeconds(timeline, 200)).toBeLessThan(renderLengthSeconds(timeline, 100));
  });
});

describe("renderProject", () => {
  it("renders one loop of the active pattern in pattern mode", async () => {
    const { contexts, createOfflineContext } = recorder();
    const project = projectWith([step("a", 0)], { playbackMode: "pattern" });
    await renderProject(project, { createOfflineContext, sampleRate: 8000 });

    const ctx = contexts[0]!;
    expect(ctx.numberOfChannels).toBe(EXPORT_CHANNELS);
    expect(ctx.renderCount).toBe(1);
    expect(ctx.length).toBe(
      Math.ceil(renderLengthSeconds(compilePatternMode(project), project.tempo) * 8000),
    );
  });

  it("renders the whole arrangement in song mode", async () => {
    const { contexts, createOfflineContext } = recorder();
    const project = projectWith([step("a", 0)], {
      playbackMode: "song",
      clips: {
        c1: { id: "c1", trackId: "trk-1", patternId: "pat-1", startTick: 0 },
        c2: { id: "c2", trackId: "trk-1", patternId: "pat-1", startTick: TICKS_PER_BAR * 3 },
      },
    });
    await renderProject(project, { createOfflineContext, sampleRate: 8000 });
    expect(compileSongMode(project).lengthTicks).toBe(TICKS_PER_BAR * 4);
    expect(contexts[0]!.length).toBe(
      Math.ceil(renderLengthSeconds(compileSongMode(project), project.tempo) * 8000),
    );
  });

  it("lets the caller override the mode without touching the project", async () => {
    const { contexts, createOfflineContext } = recorder();
    const project = projectWith([step("a", 0)], { playbackMode: "pattern" });
    await renderProject(project, { createOfflineContext, sampleRate: 8000, mode: "song" });
    expect(contexts[0]!.length).toBe(
      Math.ceil(renderLengthSeconds(compileSongMode(project), project.tempo) * 8000),
    );
    expect(project.playbackMode).toBe("pattern");
  });

  it("builds the SAME channel → track → master → limiter chain the live graph uses", async () => {
    const { contexts, createOfflineContext } = recorder();
    await renderProject(projectWith([step("a", 0)]), { createOfflineContext, sampleRate: 8000 });
    const ctx = contexts[0]!;
    expect(ctx.nodesOfKind("compressor")).toHaveLength(1);
    expect(ctx.nodesOfKind("compressor")[0]!.outputs).toContain(ctx.destination);
    expect(ctx.nodesOfKind("analyser").length).toBeGreaterThan(0);
  });

  it("uses the same voice code — a kick step builds its oscillator offline", async () => {
    const { contexts, createOfflineContext } = recorder();
    await renderProject(projectWith([step("a", 0), step("b", TICKS_PER_STEP * 4)]), {
      createOfflineContext,
      sampleRate: 8000,
    });
    // Two kicks: one sine oscillator each.
    expect(contexts[0]!.nodesOfKind("oscillator")).toHaveLength(2);
  });

  it("places notes at their SWUNG time, matching what was auditioned", async () => {
    const { contexts, createOfflineContext } = recorder();
    const project = projectWith([step("off", TICKS_PER_STEP)], { globalSwing: 1, tempo: 120 });
    await renderProject(project, { createOfflineContext, sampleRate: 8000 });
    const osc = contexts[0]!.nodesOfKind("oscillator")[0] as unknown as { startTime: number };
    expect(osc.startTime).toBeCloseTo(ticksToSeconds(TICKS_PER_STEP * 1.5, 120), 6);
  });

  it("never renders the metronome into the file", async () => {
    const { contexts, createOfflineContext } = recorder();
    await renderProject(projectWith([step("a", 0)]), { createOfflineContext, sampleRate: 8000 });
    // The click is bandpassed noise; a lone kick contributes one highpass and
    // no bandpass at all.
    const filters = contexts[0]!.nodesOfKind("filter") as unknown as { type: string }[];
    expect(filters.some((f) => f.type === "bandpass")).toBe(false);
  });

  it("skips notes whose channel has been deleted", async () => {
    const { contexts, createOfflineContext } = recorder();
    const project = projectWith([step("orphan", 0, "ch-kick")]);
    const channels = { ...project.channels };
    delete channels["ch-kick"];
    await renderProject({ ...project, channels }, { createOfflineContext, sampleRate: 8000 });
    expect(contexts[0]!.nodesOfKind("oscillator")).toHaveLength(0);
  });
});

describe("encodeWav", () => {
  const buffer = (channels: number, frames: number, sampleRate = 8000): AudioBuffer => {
    const buf = new StubAudioBuffer(channels, frames, sampleRate);
    for (let c = 0; c < channels; c += 1) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < frames; i += 1) data[i] = c === 0 ? 1 : -1;
    }
    return buf as unknown as AudioBuffer;
  };

  it("writes a RIFF/WAVE header sized for the PCM payload", () => {
    const bytes = encodeWav(buffer(2, 10));
    const view = new DataView(bytes);
    const ascii = (at: number) =>
      String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(at + i)));
    expect(ascii(0)).toBe("RIFF");
    expect(ascii(8)).toBe("WAVE");
    expect(ascii(12)).toBe("fmt ");
    expect(ascii(36)).toBe("data");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(2); // stereo
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    const dataBytes = 10 * 2 * 2;
    expect(view.getUint32(40, true)).toBe(dataBytes);
    expect(view.getUint32(4, true)).toBe(36 + dataBytes);
    expect(bytes.byteLength).toBe(44 + dataBytes);
  });

  it("interleaves channels and maps ±1 to full scale", () => {
    const view = new DataView(encodeWav(buffer(2, 2)));
    expect(view.getInt16(44, true)).toBe(32767); // L
    expect(view.getInt16(46, true)).toBe(-32768); // R
    expect(view.getInt16(48, true)).toBe(32767);
  });

  it("clamps out-of-range samples instead of wrapping them", () => {
    const buf = new StubAudioBuffer(1, 2, 8000);
    buf.getChannelData(0).set([4, -4]);
    const view = new DataView(encodeWav(buf as unknown as AudioBuffer));
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });

  it("handles a mono buffer", () => {
    const view = new DataView(encodeWav(buffer(1, 4)));
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(4 * 2);
  });
});

describe("wavFileName", () => {
  it("slugs the project name and names the mode", () => {
    const project = { ...createDefaultProject(), name: "My  Beat!! v2" };
    expect(wavFileName(project, "song")).toBe("my-beat-v2-song.wav");
    expect(wavFileName(project, "pattern")).toBe("my-beat-v2-pattern.wav");
  });

  it("falls back when the name slugs to nothing", () => {
    expect(wavFileName({ ...createDefaultProject(), name: "***" }, "song")).toBe("project-song.wav");
  });
});

describe("exportProjectWav", () => {
  it("returns a WAV blob, a filename and the rendered duration", async () => {
    const { createOfflineContext } = recorder();
    const project = projectWith([step("a", 0)], { playbackMode: "pattern" });
    const result = await exportProjectWav(project, { createOfflineContext, sampleRate: 8000 });
    expect(result.blob.type).toBe("audio/wav");
    expect(result.blob.size).toBeGreaterThan(44);
    expect(result.fileName).toBe("new-project-pattern.wav");
    expect(result.durationSeconds).toBeCloseTo(
      renderLengthSeconds(compilePatternMode(project), project.tempo),
      2,
    );
  });
});
