/**
 * The signal chain of SPEC.md §3.4 — "assert that the mixer graph wires
 * channel → track → master → limiter as specced" (§7).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDefaultProject } from "@/domain/defaultProject";
import { MASTER_MIXER_TRACK_ID, type Project } from "@/domain/types";

import { LIMITER, MixerGraph, STRIP_RELEASE_SEC } from "./mixerGraph";
import {
  asBaseContext,
  createStubContext,
  isConnected,
  pathBetween,
  StubAnalyserNode,
  StubAudioNode,
  StubAudioParam,
  StubDynamicsCompressorNode,
  type StubAudioContext,
} from "./testing/audioStub";

function setup(mutate: (project: Project) => Project = (p) => p) {
  const ctx = createStubContext();
  const project = mutate(createDefaultProject());
  const graph = new MixerGraph(asBaseContext(ctx), project);
  return { ctx, project, graph };
}

const node = (value: unknown): StubAudioNode => value as unknown as StubAudioNode;

/** Advance the stub clock so a later `sync` ramps from a distinguishable time. */
function tick(ctx: StubAudioContext, seconds: number): void {
  ctx.currentTime += seconds;
}

describe("MixerGraph — the specced chain", () => {
  it("routes a channel through its strip, its track, the master and the limiter to destination", () => {
    const { ctx, graph } = setup((p) => ({
      ...p,
      channels: {
        ...p.channels,
        "ch-kick": { ...p.channels["ch-kick"]!, routedToMixerTrackId: "mix-1" },
      },
    }));
    const input = node(graph.channelInput("ch-kick"));
    expect(pathBetween(input, ctx.destination)).toEqual([
      "gain", // channel volume
      "panner", // channel pan
      "gain", // mixer-track volume
      "panner", // mixer-track pan
      "gain", // master volume
      "panner", // master pan
      "compressor", // limiter
      "destination",
    ]);
  });

  it("routes a Master-routed channel straight into the master gain", () => {
    const { ctx, graph } = setup();
    const input = node(graph.channelInput("ch-kick"));
    expect(pathBetween(input, ctx.destination)).toEqual([
      "gain",
      "panner",
      "gain", // master — no insert strip in between
      "panner", // master pan
      "compressor",
      "destination",
    ]);
  });

  it("configures the limiter as a low-threshold, high-ratio brickwall", () => {
    const { ctx } = setup();
    const limiter = ctx.created.find(
      (n): n is StubDynamicsCompressorNode => n instanceof StubDynamicsCompressorNode,
    );
    expect(limiter?.threshold.value).toBe(LIMITER.thresholdDb);
    expect(limiter?.ratio.value).toBe(LIMITER.ratio);
    expect(limiter?.ratio.value).toBeGreaterThanOrEqual(10);
    expect(limiter?.threshold.value).toBeLessThan(0);
  });

  it("puts exactly one limiter between the master gain and the destination", () => {
    const { ctx, graph } = setup();
    expect(node(graph.master.input).outputs.map((n) => n.kind)).toEqual(["panner"]);
    expect(node(graph.master.panner).outputs.map((n) => n.kind)).toEqual(["compressor"]);
    expect(node(graph.master.limiter).outputs.map((n) => n.kind).sort()).toEqual([
      "analyser",
      "destination",
    ]);
    expect(ctx.created.filter((n) => n.kind === "compressor")).toHaveLength(1);
  });
});

describe("MixerGraph — meter taps", () => {
  it("taps the master POST-limiter, so the clip light reads what leaves the bus", () => {
    const { graph } = setup();
    const tap = graph.meterTap(MASTER_MIXER_TRACK_ID);
    expect(tap).not.toBeNull();
    expect(node(graph.master.limiter).outputs).toContain(node(tap));
    // …and never inline: the tap feeds nothing onward.
    expect(node(tap).outputs).toEqual([]);
  });

  it("hangs a parallel tap off every insert track", () => {
    const { graph, project } = setup();
    for (const trackId of project.mixerTrackOrder) {
      const tap = graph.meterTap(trackId);
      expect(tap).not.toBeNull();
      expect(node(tap).outputs).toEqual([]);
    }
  });

  it("does not put an analyser in the signal path to the destination", () => {
    const { ctx, graph } = setup();
    const analysers = ctx.created.filter((n): n is StubAnalyserNode => n instanceof StubAnalyserNode);
    expect(analysers.length).toBeGreaterThan(1);
    for (const analyser of analysers) expect(isConnected(analyser, ctx.destination)).toBe(false);
    expect(graph.meterTap("no-such-track")).toBeNull();
  });
});

describe("MixerGraph — parameter sync", () => {
  it("ramps channel volume rather than jumping it", () => {
    const { ctx, graph, project } = setup();
    const strip = graph.channelStrip("ch-kick");
    tick(ctx, 1);
    graph.sync({
      ...project,
      channels: { ...project.channels, "ch-kick": { ...project.channels["ch-kick"]!, volume: 0.25 } },
    });
    const gain = node(strip?.gain) as unknown as { gain: { methods: string[]; calls: { method: string; args: number[] }[] } };
    const last = gain.gain.calls.at(-1);
    expect(last?.method).toBe("linearRampToValueAtTime");
    expect(last?.args[0]).toBe(0.25);
    expect(last?.args[1]).toBeGreaterThan(1);
    // Anchored first, per §3.3.
    expect(gain.gain.calls.at(-2)?.method).toBe("setValueAtTime");
  });

  it("mutes to a ramped zero instead of disconnecting (un-mute must be instant)", () => {
    const { ctx, graph, project } = setup();
    const strip = graph.channelStrip("ch-kick");
    const outputsBefore = node(strip?.panner).outputs.length;
    graph.sync({
      ...project,
      channels: { ...project.channels, "ch-kick": { ...project.channels["ch-kick"]!, muted: true } },
    });
    const gain = node(strip?.gain) as unknown as { gain: { calls: { method: string; args: number[] }[] } };
    expect(gain.gain.calls.at(-1)?.args[0]).toBe(0);
    expect(node(strip?.panner).outputs).toHaveLength(outputsBefore);
    expect(isConnected(node(graph.channelInput("ch-kick")), ctx.destination)).toBe(true);
  });

  it("carries mixer-track volume and pan onto the track strip", () => {
    const { graph, project } = setup();
    graph.sync({
      ...project,
      mixerTracks: {
        ...project.mixerTracks,
        "mix-1": { ...project.mixerTracks["mix-1"]!, volume: 0.4, pan: -0.5 },
      },
    });
    const strip = graph.trackStrip("mix-1");
    const gain = node(strip?.input) as unknown as { gain: { value: number } };
    const panner = node(strip?.panner) as unknown as { pan: { value: number } };
    expect(gain.gain.value).toBeCloseTo(0.4, 6);
    expect(panner.pan.value).toBeCloseTo(-0.5, 6);
  });

  it("clamps out-of-range pan and volume", () => {
    const { graph, project } = setup();
    graph.sync({
      ...project,
      channels: {
        ...project.channels,
        "ch-kick": { ...project.channels["ch-kick"]!, pan: 4, volume: 9 },
      },
    });
    const strip = graph.channelStrip("ch-kick");
    const panner = node(strip?.panner) as unknown as { pan: { value: number } };
    const gain = node(strip?.gain) as unknown as { gain: { value: number } };
    expect(panner.pan.value).toBe(1);
    expect(gain.gain.value).toBe(1);
  });

  it("keeps the master fader on the master gain, not on a second control", () => {
    const { graph, project } = setup();
    graph.sync({
      ...project,
      mixerTracks: {
        ...project.mixerTracks,
        [MASTER_MIXER_TRACK_ID]: { ...project.mixerTracks[MASTER_MIXER_TRACK_ID]!, volume: 0.3 },
      },
    });
    const master = node(graph.master.input) as unknown as { gain: { value: number } };
    expect(master.gain.value).toBeCloseTo(0.3, 6);
  });
});

describe("MixerGraph — reconciliation", () => {
  it("re-routes a channel when its mixer track changes, without duplicating the tail", () => {
    const { graph, project } = setup();
    const strip = graph.channelStrip("ch-kick");
    graph.sync({
      ...project,
      channels: {
        ...project.channels,
        "ch-kick": { ...project.channels["ch-kick"]!, routedToMixerTrackId: "mix-3" },
      },
    });
    expect(node(strip?.panner).outputs).toHaveLength(1);
    expect(node(strip?.panner).outputs[0]).toBe(node(graph.trackStrip("mix-3")?.input));
    expect(strip?.routedTo).toBe("mix-3");
  });

  it("adds a strip for a new channel and drops one for a deleted channel", () => {
    const { graph, project } = setup();
    const withoutKick = { ...project.channels };
    delete withoutKick["ch-kick"];
    graph.sync({ ...project, channels: withoutKick });
    expect(graph.channelInput("ch-kick")).toBeNull();

    graph.sync(project);
    expect(graph.channelInput("ch-kick")).not.toBeNull();
  });

  it("falls back to the master when a channel points at a missing track", () => {
    const { ctx, graph } = setup((p) => ({
      ...p,
      channels: {
        ...p.channels,
        "ch-kick": { ...p.channels["ch-kick"]!, routedToMixerTrackId: "mix-ghost" },
      },
    }));
    expect(isConnected(node(graph.channelInput("ch-kick")), ctx.destination)).toBe(true);
  });

  it("drops a deleted mixer track's strip and its tap", () => {
    const { graph, project } = setup();
    const withoutOne = { ...project.mixerTracks };
    delete withoutOne["mix-1"];
    graph.sync({ ...project, mixerTracks: withoutOne });
    expect(graph.trackStrip("mix-1")).toBeUndefined();
    expect(graph.meterTap("mix-1")).toBeNull();
  });

  it("sends the metronome to the master bus, bypassing the mixer strips", () => {
    const { graph } = setup();
    expect(graph.metronomeDestination).toBe(graph.master.input);
  });

  it("disposes the graph without leaving connections behind", () => {
    const { graph } = setup();
    const input = node(graph.channelInput("ch-kick"));
    graph.dispose();
    expect(input.outputs).toEqual([]);
    expect(node(graph.master.input).outputs).toEqual([]);
    expect(node(graph.master.panner).outputs).toEqual([]);
    expect(graph.channelInput("ch-kick")).toBeNull();
  });
});

/** The recorded automation of one node's `gain`/`pan` param. */
const gainOf = (value: unknown): StubAudioParam =>
  (value as unknown as { gain: StubAudioParam }).gain;
const panOf = (value: unknown): StubAudioParam =>
  (value as unknown as { pan: StubAudioParam }).pan;

describe("MixerGraph — master pan (the knob the surface already persists)", () => {
  it("puts a panner on the master chain, before the limiter", () => {
    const { graph } = setup();
    expect(node(graph.master.input).outputs).toEqual([node(graph.master.panner)]);
    expect(node(graph.master.panner).outputs).toEqual([node(graph.master.limiter)]);
  });

  it("carries the master track's saved pan onto it at construction", () => {
    const { graph } = setup((p) => ({
      ...p,
      mixerTracks: {
        ...p.mixerTracks,
        [MASTER_MIXER_TRACK_ID]: { ...p.mixerTracks[MASTER_MIXER_TRACK_ID]!, pan: -0.75 },
      },
    }));
    expect(panOf(graph.master.panner).value).toBeCloseTo(-0.75, 6);
  });

  it("ramps the master pan on a later change, clamped to -1..1", () => {
    const { ctx, graph, project } = setup();
    tick(ctx, 1);
    graph.sync({
      ...project,
      mixerTracks: {
        ...project.mixerTracks,
        [MASTER_MIXER_TRACK_ID]: { ...project.mixerTracks[MASTER_MIXER_TRACK_ID]!, pan: 3 },
      },
    });
    const pan = panOf(graph.master.panner);
    expect(pan.value).toBe(1);
    expect(pan.calls.at(-1)?.method).toBe("linearRampToValueAtTime");
  });
});

describe("MixerGraph — initial values are SET, not ramped (tick-zero leak)", () => {
  it("gives a muted channel a gain of exactly 0 at construction, with no ramp from 1", () => {
    const { graph } = setup((p) => ({
      ...p,
      channels: { ...p.channels, "ch-kick": { ...p.channels["ch-kick"]!, muted: true } },
    }));
    const gain = gainOf(graph.channelStrip("ch-kick")?.gain);
    expect(gain.value).toBe(0);
    expect(gain.methods).not.toContain("linearRampToValueAtTime");
    expect(gain.callsTo("setValueAtTime").at(-1)?.args).toEqual([0, 0]);
  });

  it("sets saved channel volume/pan and track volume/pan outright at construction", () => {
    const { graph } = setup((p) => ({
      ...p,
      channels: { ...p.channels, "ch-kick": { ...p.channels["ch-kick"]!, volume: 0.3, pan: -0.4 } },
      mixerTracks: {
        ...p.mixerTracks,
        "mix-1": { ...p.mixerTracks["mix-1"]!, volume: 0.2, pan: 0.6 },
        [MASTER_MIXER_TRACK_ID]: { ...p.mixerTracks[MASTER_MIXER_TRACK_ID]!, volume: 0.5 },
      },
    }));
    const channelGain = gainOf(graph.channelStrip("ch-kick")?.gain);
    expect(channelGain.value).toBeCloseTo(0.3, 6);
    expect(panOf(graph.channelStrip("ch-kick")?.panner).value).toBeCloseTo(-0.4, 6);
    expect(gainOf(graph.trackStrip("mix-1")?.input).value).toBeCloseTo(0.2, 6);
    expect(panOf(graph.trackStrip("mix-1")?.panner).value).toBeCloseTo(0.6, 6);
    expect(gainOf(graph.master.input).value).toBeCloseTo(0.5, 6);
    for (const param of [
      channelGain,
      panOf(graph.channelStrip("ch-kick")?.panner),
      gainOf(graph.trackStrip("mix-1")?.input),
      gainOf(graph.master.input),
    ]) {
      expect(param.methods).not.toContain("linearRampToValueAtTime");
    }
  });

  it("sets a strip added by a LATER sync outright too, but ramps the ones that already existed", () => {
    const { ctx, graph, project } = setup();
    tick(ctx, 2);
    const withNewChannel: Project = {
      ...project,
      channels: {
        ...project.channels,
        "ch-new": { ...project.channels["ch-kick"]!, id: "ch-new", volume: 0.15, muted: true },
      },
    };
    graph.sync(withNewChannel);

    const added = gainOf(graph.channelStrip("ch-new")?.gain);
    expect(added.value).toBe(0); // muted: silent from the first sample, not 20ms later
    expect(added.methods).not.toContain("linearRampToValueAtTime");
    // The pre-existing strip is *changing*, so it still glides (§3.3).
    expect(gainOf(graph.channelStrip("ch-kick")?.gain).methods).toContain(
      "linearRampToValueAtTime",
    );
  });
});

describe("MixerGraph — removing a strip ramps before it disconnects", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ramps a deleted channel's gain to 0 and only disconnects after the ramp", () => {
    const { ctx, graph, project } = setup();
    const strip = graph.channelStrip("ch-kick")!;
    const gain = gainOf(strip.gain);
    tick(ctx, 1);

    const withoutKick = { ...project.channels };
    delete withoutKick["ch-kick"];
    graph.sync({ ...project, channels: withoutKick });

    // Gone from the graph immediately — nothing new can route into it…
    expect(graph.channelInput("ch-kick")).toBeNull();
    // …but still connected, riding the release ramp.
    expect(node(strip.gain).disconnectCount).toBe(0);
    expect(node(strip.panner).disconnectCount).toBe(0);
    const last = gain.calls.at(-1);
    expect(last?.method).toBe("linearRampToValueAtTime");
    expect(last?.args[0]).toBe(0);
    expect(last?.args[1]).toBeCloseTo(1 + STRIP_RELEASE_SEC, 6);
    expect(gain.calls.at(-2)?.method).toBe("setValueAtTime"); // anchored, §3.3

    vi.advanceTimersByTime(Math.ceil(STRIP_RELEASE_SEC * 1000) + 5);
    expect(node(strip.gain).disconnectCount).toBe(1);
    expect(node(strip.panner).disconnectCount).toBe(1);
    expect(node(strip.panner).outputs).toEqual([]);
  });

  it("ramps a deleted mixer track's strip down before disconnecting it", () => {
    const { graph, project } = setup();
    const strip = graph.trackStrip("mix-1")!;
    const withoutOne = { ...project.mixerTracks };
    delete withoutOne["mix-1"];
    graph.sync({ ...project, mixerTracks: withoutOne });

    expect(graph.trackStrip("mix-1")).toBeUndefined();
    expect(graph.meterTap("mix-1")).toBeNull();
    expect(node(strip.input).disconnectCount).toBe(0);
    expect(gainOf(strip.input).calls.at(-1)?.args[0]).toBe(0);

    vi.advanceTimersByTime(Math.ceil(STRIP_RELEASE_SEC * 1000) + 5);
    expect(node(strip.input).disconnectCount).toBe(1);
    expect(node(strip.panner).disconnectCount).toBe(1);
  });

  it("flushes a pending retirement on dispose instead of leaving a live timer", () => {
    const { graph, project } = setup();
    const strip = graph.channelStrip("ch-kick")!;
    const withoutKick = { ...project.channels };
    delete withoutKick["ch-kick"];
    graph.sync({ ...project, channels: withoutKick });
    expect(node(strip.panner).disconnectCount).toBe(0);

    graph.dispose();
    expect(node(strip.panner).disconnectCount).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
