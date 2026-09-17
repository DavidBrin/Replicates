/**
 * Voice-graph construction against the hand-rolled stub (SPEC.md §7).
 *
 * Nothing here renders sound. What it asserts is the two things a silent test
 * *can* prove about a synthesis recipe: that the graph is wired the way the
 * §3.3 recipe table says, and that every envelope obeys the ramp rules that
 * keep it click-free.
 */

import { describe, expect, it } from "vitest";

import {
  asBaseContext,
  createStubContext,
  pathBetween,
  StubAudioBufferSourceNode,
  StubBiquadFilterNode,
  StubGainNode,
  StubOscillatorNode,
  type StubAudioContext,
} from "../testing/audioStub";
import type { ActiveVoice, VoiceTrigger } from "../types";
import { VOICE_BUILDERS } from "./index";
import {
  applyAdsrEnvelope,
  applyPercussiveEnvelope,
  drumTuneRatio,
  getNoiseBuffer,
  midiToFrequency,
  NOISE_BUFFER_SECONDS,
  rampedRelease,
  SILENCE,
  velocityPeak,
} from "./shared";

function makeTrigger(
  ctx: StubAudioContext,
  overrides: Partial<VoiceTrigger> = {},
): { trigger: VoiceTrigger; destination: StubGainNode } {
  const destination = ctx.createGain();
  return {
    destination,
    trigger: {
      ctx: asBaseContext(ctx),
      destination: destination as unknown as AudioNode,
      time: 1,
      pitch: 60,
      velocity: 1,
      durationSec: 0.25,
      ...overrides,
    },
  };
}

function build(kind: keyof typeof VOICE_BUILDERS, ctx: StubAudioContext, overrides = {}) {
  const { trigger, destination } = makeTrigger(ctx, overrides);
  return { voice: VOICE_BUILDERS[kind](trigger), destination, ctx };
}

const KINDS = Object.keys(VOICE_BUILDERS) as (keyof typeof VOICE_BUILDERS)[];

describe("shared voice primitives", () => {
  it("generates exactly one shared noise buffer per context", () => {
    const ctx = createStubContext();
    const base = asBaseContext(ctx);
    const first = getNoiseBuffer(base);
    expect(getNoiseBuffer(base)).toBe(first);
    expect(first.length).toBe(ctx.sampleRate * NOISE_BUFFER_SECONDS);
  });

  it("gives a different context its own buffer", () => {
    const a = getNoiseBuffer(asBaseContext(createStubContext()));
    const b = getNoiseBuffer(asBaseContext(createStubContext()));
    expect(a).not.toBe(b);
  });

  it("fills the noise buffer with values in [-1, 1] and not all zero", () => {
    const buffer = getNoiseBuffer(asBaseContext(createStubContext(400)));
    const data = buffer.getChannelData(0);
    expect(data.some((v) => v !== 0)).toBe(true);
    expect(data.every((v) => v >= -1 && v <= 1)).toBe(true);
  });

  it("maps MIDI to concert pitch", () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 6);
    expect(midiToFrequency(57)).toBeCloseTo(220, 6);
    expect(midiToFrequency(81)).toBeCloseTo(880, 6);
  });

  it("tunes a drum an octave per 12 semitones from MIDI 60, clamped at ±2 octaves", () => {
    expect(drumTuneRatio(60)).toBe(1);
    expect(drumTuneRatio(72)).toBeCloseTo(2, 6);
    expect(drumTuneRatio(48)).toBeCloseTo(0.5, 6);
    expect(drumTuneRatio(127)).toBeCloseTo(4, 6);
    expect(drumTuneRatio(0)).toBeCloseTo(0.25, 6);
  });

  it("scales the envelope peak by velocity but never to silence", () => {
    expect(velocityPeak(1)).toBeCloseTo(1, 6);
    expect(velocityPeak(0)).toBeGreaterThan(0);
    expect(velocityPeak(0.5)).toBeGreaterThan(velocityPeak(0.1));
    expect(velocityPeak(5)).toBeCloseTo(velocityPeak(1), 6);
  });

  it("never targets a true zero with an exponential ramp", () => {
    const ctx = createStubContext();
    const gain = ctx.createGain();
    applyPercussiveEnvelope(gain.gain as unknown as AudioParam, 0, {
      peak: 1,
      attackSec: 0.01,
      decaySec: 0.1,
    });
    for (const call of gain.gain.callsTo("exponentialRampToValueAtTime")) {
      expect(call.args[0]).toBeGreaterThan(0);
      expect(call.args[0]).toBe(SILENCE);
    }
  });

  it("holds an ADSR for the note length and returns the release end", () => {
    const ctx = createStubContext();
    const gain = ctx.createGain();
    const end = applyAdsrEnvelope(gain.gain as unknown as AudioParam, 2, 0.5, {
      peak: 1,
      attackSec: 0.01,
      decaySec: 0.05,
      sustain: 0.5,
      releaseSec: 0.1,
    });
    expect(end).toBeCloseTo(2 + 0.5 + 0.1, 6);
  });

  it("gives a note shorter than attack+decay its full attack rather than gating it", () => {
    const ctx = createStubContext();
    const gain = ctx.createGain();
    const end = applyAdsrEnvelope(gain.gain as unknown as AudioParam, 0, 0.001, {
      peak: 1,
      attackSec: 0.02,
      decaySec: 0.08,
      sustain: 0.5,
      releaseSec: 0.1,
    });
    expect(end).toBeCloseTo(0.02 + 0.08 + 0.1, 6);
  });

  it("anchors, ramps, then stops — never a hard cut", () => {
    const ctx = createStubContext();
    const gain = ctx.createGain();
    const source = ctx.createOscillator();
    const end = rampedRelease(
      asBaseContext(ctx),
      gain.gain as unknown as AudioParam,
      [source as unknown as AudioScheduledSourceNode],
      3,
      0.02,
    );
    const methods = gain.gain.methods;
    const anchor = methods.indexOf("setValueAtTime");
    const ramp = methods.indexOf("linearRampToValueAtTime");
    expect(anchor).toBeGreaterThanOrEqual(0);
    expect(ramp).toBeGreaterThan(anchor);
    const rampCall = gain.gain.callsTo("linearRampToValueAtTime")[0];
    expect(rampCall?.args[0]).toBe(0);
    expect(rampCall?.args[1]).toBeCloseTo(3.02, 6);
    // The source stops only after the ramp lands.
    expect(source.stopTime).toBeCloseTo(end, 6);
    expect(source.stopTime).toBeGreaterThanOrEqual(rampCall?.args[1] ?? 0);
  });

  it("flattens an in-flight ramp before releasing (mid-attack interruption)", () => {
    const ctx = createStubContext();
    const gain = ctx.createGain();
    rampedRelease(asBaseContext(ctx), gain.gain as unknown as AudioParam, [], 1);
    expect(gain.gain.methods[0]).toBe("cancelAndHoldAtTime");
  });

  it("never schedules a release in the past", () => {
    const ctx = createStubContext();
    ctx.currentTime = 10;
    const gain = ctx.createGain();
    const end = rampedRelease(asBaseContext(ctx), gain.gain as unknown as AudioParam, [], 2, 0.05);
    expect(end).toBeCloseTo(10.05, 6);
  });
});

describe("every voice recipe", () => {
  it.each(KINDS)("%s connects its output to the channel destination", (kind) => {
    const ctx = createStubContext();
    const { voice, destination } = build(kind, ctx);
    expect(voice.output.gain).toBeDefined();
    expect((voice.output as unknown as StubGainNode).outputs).toContain(destination);
  });

  it.each(KINDS)("%s reports its own kind", (kind) => {
    const ctx = createStubContext();
    expect(build(kind, ctx).voice.kind).toBe(kind);
  });

  it.each(KINDS)("%s ends after it starts and starts its sources at the note time", (kind) => {
    const ctx = createStubContext();
    const { voice } = build(kind, ctx, { time: 4 });
    expect(voice.startTime).toBe(4);
    expect(voice.endTime).toBeGreaterThan(4);
    const sources = [
      ...ctx.created.filter(
        (n): n is StubOscillatorNode | StubAudioBufferSourceNode =>
          n instanceof StubOscillatorNode || n instanceof StubAudioBufferSourceNode,
      ),
    ];
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) expect(source.startTime).toBe(4);
  });

  it.each(KINDS)("%s stops every source at its natural end", (kind) => {
    const ctx = createStubContext();
    const { voice } = build(kind, ctx, { time: 0 });
    const sources = ctx.created.filter(
      (n): n is StubOscillatorNode | StubAudioBufferSourceNode =>
        n instanceof StubOscillatorNode || n instanceof StubAudioBufferSourceNode,
    );
    for (const source of sources) expect(source.stopTime).toBeCloseTo(voice.endTime, 6);
  });

  it.each(KINDS)("%s releases with a ramp and shortens its endTime", (kind) => {
    const ctx = createStubContext();
    const { voice } = build(kind, ctx, { time: 0 });
    const natural = voice.endTime;
    voice.release(0.01, 0.02);
    expect(voice.released).toBe(true);
    expect(voice.endTime).toBeCloseTo(0.03, 6);
    expect(voice.endTime).toBeLessThan(natural);
    const gain = voice.output as unknown as StubGainNode;
    expect(gain.gain.callsTo("linearRampToValueAtTime").at(-1)?.args[0]).toBe(0);
  });

  it.each(KINDS)("%s ignores a second release", (kind) => {
    const ctx = createStubContext();
    const { voice } = build(kind, ctx, { time: 0 });
    voice.release(0.01, 0.02);
    const after = (voice.output as unknown as StubGainNode).gain.calls.length;
    voice.release(0.5, 0.02);
    expect((voice.output as unknown as StubGainNode).gain.calls.length).toBe(after);
  });

  it.each(KINDS)("%s scales with velocity", (kind) => {
    const loud = build(kind, createStubContext(), { velocity: 1 }).voice;
    const soft = build(kind, createStubContext(), { velocity: 0.1 }).voice;
    const peakOf = (voice: ActiveVoice): number => {
      const ctx = (voice.output as unknown as StubGainNode).context;
      return Math.max(
        ...ctx.created
          .filter((n): n is StubGainNode => n instanceof StubGainNode)
          .flatMap((n) => n.gain.calls.map((c) => c.args[0] ?? 0)),
      );
    };
    expect(peakOf(loud)).toBeGreaterThan(peakOf(soft));
  });
});

describe("kick", () => {
  it("sweeps a sine from 150 Hz down to 40 Hz", () => {
    const ctx = createStubContext();
    build("kick", ctx, { time: 0 });
    const osc = ctx.created.find((n): n is StubOscillatorNode => n instanceof StubOscillatorNode);
    expect(osc?.type).toBe("sine");
    expect(osc?.frequency.callsTo("setValueAtTime")[0]?.args[0]).toBeCloseTo(150, 6);
    const sweep = osc?.frequency.callsTo("exponentialRampToValueAtTime")[0];
    expect(sweep?.args[0]).toBeCloseTo(40, 6);
    expect(sweep?.args[1]).toBeCloseTo(0.15, 6);
  });

  it("transposes the sweep with pitch", () => {
    const ctx = createStubContext();
    build("kick", ctx, { pitch: 72 });
    const osc = ctx.created.find((n): n is StubOscillatorNode => n instanceof StubOscillatorNode);
    expect(osc?.frequency.callsTo("setValueAtTime")[0]?.args[0]).toBeCloseTo(300, 6);
  });

  it("adds a highpassed noise click", () => {
    const ctx = createStubContext();
    build("kick", ctx);
    const filters = ctx.created.filter(
      (n): n is StubBiquadFilterNode => n instanceof StubBiquadFilterNode,
    );
    expect(filters.some((f) => f.type === "highpass")).toBe(true);
    expect(
      ctx.created.some((n) => n instanceof StubAudioBufferSourceNode),
    ).toBe(true);
  });
});

describe("clap", () => {
  it("layers three offset bursts plus a tail through a bandpass", () => {
    const ctx = createStubContext();
    build("clap", ctx, { time: 0 });
    const band = ctx.created.find(
      (n): n is StubBiquadFilterNode => n instanceof StubBiquadFilterNode,
    );
    expect(band?.type).toBe("bandpass");
    expect(band?.frequency.value).toBeGreaterThanOrEqual(1000);
    expect(band?.frequency.value).toBeLessThanOrEqual(2000);
    // Three burst attacks + the tail attack + the final pin to zero.
    const env = ctx.created
      .filter((n): n is StubGainNode => n instanceof StubGainNode)
      .find((n) => n.gain.callsTo("setValueAtTime").length > 1);
    const attacks = env?.gain.callsTo("setValueAtTime") ?? [];
    expect(attacks.length).toBe(5);
    const offsets = attacks.slice(0, 4).map((c) => c.args[1] ?? 0);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(new Set(offsets).size).toBe(4); // slightly offset, not stacked
  });
});

describe("hats", () => {
  it("highpasses noise above 7 kHz for both hats", () => {
    for (const kind of ["hatClosed", "hatOpen"] as const) {
      const ctx = createStubContext();
      build(kind, ctx);
      const highpass = ctx.created.find(
        (n): n is StubBiquadFilterNode =>
          n instanceof StubBiquadFilterNode && n.type === "highpass",
      );
      expect(highpass?.frequency.value).toBeGreaterThanOrEqual(7000);
    }
  });

  it("gives the open hat a decay several times the closed hat's", () => {
    const closed = build("hatClosed", createStubContext(), { time: 0 }).voice;
    const open = build("hatOpen", createStubContext(), { time: 0 }).voice;
    expect(open.endTime).toBeGreaterThan(closed.endTime * 4);
    expect(open.endTime).toBeLessThan(0.35);
  });

  it("does not choke itself from inside the recipe — that is the pool's job", () => {
    const ctx = createStubContext();
    const first = build("hatOpen", ctx, { time: 0 }).voice;
    build("hatClosed", ctx, { time: 0.1 });
    expect(first.released).toBe(false);
  });
});

describe("snare", () => {
  it("layers two detuned tonal oscillators with a bandpassed noise buzz", () => {
    const ctx = createStubContext();
    build("snare", ctx);
    const oscs = ctx.created.filter(
      (n): n is StubOscillatorNode => n instanceof StubOscillatorNode,
    );
    expect(oscs).toHaveLength(2);
    expect(oscs.every((o) => o.type === "triangle")).toBe(true);
    expect(oscs[0]?.frequency.value).not.toBe(oscs[1]?.frequency.value);
    for (const osc of oscs) {
      expect(osc.frequency.value).toBeGreaterThanOrEqual(170);
      expect(osc.frequency.value).toBeLessThanOrEqual(210);
    }
    expect(
      ctx.created.some(
        (n) => n instanceof StubBiquadFilterNode && n.type === "bandpass",
      ),
    ).toBe(true);
  });
});

describe("bass", () => {
  it("runs a saw plus a −1-octave sine sub into an envelope-swept lowpass", () => {
    const ctx = createStubContext();
    build("bass", ctx, { pitch: 36, time: 0 });
    const oscs = ctx.created.filter(
      (n): n is StubOscillatorNode => n instanceof StubOscillatorNode,
    );
    expect(oscs.map((o) => o.type)).toEqual(["sawtooth", "sine"]);
    expect(oscs[1]?.frequency.value).toBeCloseTo((oscs[0]?.frequency.value ?? 0) / 2, 6);
    const filter = ctx.created.find(
      (n): n is StubBiquadFilterNode => n instanceof StubBiquadFilterNode,
    );
    expect(filter?.type).toBe("lowpass");
    const open = filter?.frequency.callsTo("setValueAtTime")[0]?.args[0] ?? 0;
    const closed = filter?.frequency.callsTo("exponentialRampToValueAtTime")[0]?.args[0] ?? 0;
    expect(open).toBeGreaterThan(closed); // the cutoff closes, that's the pluck
  });

  it("sustains for the requested duration", () => {
    const short = build("bass", createStubContext(), { time: 0, durationSec: 0.2 }).voice;
    const long = build("bass", createStubContext(), { time: 0, durationSec: 1.5 }).voice;
    expect(long.endTime - short.endTime).toBeCloseTo(1.3, 6);
  });
});

describe("lead", () => {
  it("detunes two saws in opposite directions and is polyphony-ready", () => {
    const ctx = createStubContext();
    build("lead", ctx, { pitch: 72 });
    const oscs = ctx.created.filter(
      (n): n is StubOscillatorNode => n instanceof StubOscillatorNode,
    );
    expect(oscs).toHaveLength(2);
    expect(oscs.every((o) => o.type === "sawtooth")).toBe(true);
    expect(oscs[0]?.detune.value).toBeCloseTo(-(oscs[1]?.detune.value ?? 0), 6);
    expect(oscs[0]?.detune.value).not.toBe(0);
    expect(oscs[0]?.frequency.value).toBeCloseTo(midiToFrequency(72), 6);
  });

  it("routes oscillators through the filter to the output", () => {
    const ctx = createStubContext();
    const { voice, destination } = build("lead", ctx);
    const osc = ctx.created.find((n): n is StubOscillatorNode => n instanceof StubOscillatorNode);
    expect(osc).toBeDefined();
    expect(pathBetween(osc!, destination)).toEqual([
      "oscillator",
      "gain", // mix
      "filter",
      "gain", // amp
      "gain", // voice output
      "gain", // channel destination
    ]);
    expect(voice.kind).toBe("lead");
  });
});
