import { describe, expect, it } from "vitest";

import {
  MockBiquadFilter,
  MockBufferSource,
  MockGain,
  MockOscillator,
  asAudioParam,
  mockSynthContext,
} from "./mockContext";
import { drone, envelope, noise, noiseBuffer, tone } from "./synth";

describe("envelope", () => {
  it("rises linearly to the peak and falls exponentially", () => {
    // Linear up, exponential down: loudness is perceived logarithmically, so a
    // linear fade sounds like it hangs and then drops off a cliff.
    const { mock } = mockSynthContext();
    const gain = mock.createGain();

    const end = envelope(asAudioParam(gain.gain), { when: 0, attack: 0.01, peak: 0.5, decay: 0.1 });

    const methods = gain.gain.events.map((e) => e.method);
    expect(methods).toContain("linearRampToValueAtTime");
    expect(methods).toContain("exponentialRampToValueAtTime");
    const peak = gain.gain.events.find((e) => e.method === "linearRampToValueAtTime");
    expect(peak).toMatchObject({ value: 0.5, time: 0.01 });
    expect(end).toBeCloseTo(0.11, 5);
  });

  it("never asks an exponential ramp to reach zero", () => {
    // The Web Audio spec throws on that, and it is the single easiest way to
    // kill every sound in the game with one bad envelope.
    const { mock } = mockSynthContext();
    const gain = mock.createGain();
    expect(() => envelope(asAudioParam(gain.gain), { when: 0, peak: 1, decay: 0.05 })).not.toThrow();
    for (const event of gain.gain.events) {
      if (event.method === "exponentialRampToValueAtTime") expect(event.value).toBeGreaterThan(0);
    }
  });

  it("lands on a true zero, so a finished voice costs nothing to mix", () => {
    const { mock } = mockSynthContext();
    const gain = mock.createGain();
    envelope(asAudioParam(gain.gain), { when: 0, peak: 1, decay: 0.05 });
    expect(gain.gain.events.at(-1)).toMatchObject({ method: "setValueAtTime", value: 0 });
  });

  it("holds a sustain and releases it", () => {
    const { mock } = mockSynthContext();
    const gain = mock.createGain();
    const end = envelope(asAudioParam(gain.gain), {
      when: 0,
      attack: 0.01,
      peak: 1,
      decay: 0.05,
      sustain: 0.5,
      hold: 0.2,
      release: 0.08,
    });
    expect(end).toBeCloseTo(0.34, 5);
    expect(gain.gain.events.some((e) => e.value === 0.5)).toBe(true);
  });
});

describe("tone", () => {
  it("builds oscillator into gain into the destination", () => {
    const { mock, sc } = mockSynthContext();
    tone(sc, { freqStart: 440, duration: 0.1 });

    const osc = mock.created.find((n) => n instanceof MockOscillator) as MockOscillator;
    const gain = mock.created.find((n) => n instanceof MockGain) as MockGain;
    expect(osc.outputs).toEqual([gain]);
    expect(gain.outputs).toEqual([mock.destination]);
  });

  it("sweeps the pitch exponentially, which is how pitch is heard", () => {
    const { mock, sc } = mockSynthContext();
    tone(sc, { freqStart: 400, freqEnd: 150, duration: 0.05 });

    const osc = mock.created.find((n) => n instanceof MockOscillator) as MockOscillator;
    expect(osc.frequency.events[0]).toMatchObject({ method: "setValueAtTime", value: 400 });
    expect(osc.frequency.events[1]).toMatchObject({
      method: "exponentialRampToValueAtTime",
      value: 150,
      time: 0.05,
    });
  });

  it("takes a linear sweep when asked", () => {
    const { mock, sc } = mockSynthContext();
    tone(sc, { freqStart: 100, freqEnd: 200, duration: 0.1, glide: "linear" });
    const osc = mock.created.find((n) => n instanceof MockOscillator) as MockOscillator;
    expect(osc.frequency.events[1].method).toBe("linearRampToValueAtTime");
  });

  it("never sweeps to zero Hertz, whatever it is handed", () => {
    const { mock, sc } = mockSynthContext();
    expect(() => tone(sc, { freqStart: 0, freqEnd: 0, duration: 0.1 })).not.toThrow();
    const osc = mock.created.find((n) => n instanceof MockOscillator) as MockOscillator;
    for (const event of osc.frequency.events) expect(event.value).toBeGreaterThan(0);
  });

  it("starts and stops the oscillator", () => {
    const { mock, sc } = mockSynthContext();
    mock.currentTime = 5;
    tone(sc, { freqStart: 440, duration: 0.1 });
    const osc = mock.created.find((n) => n instanceof MockOscillator) as MockOscillator;
    expect(osc.startTime).toBe(5);
    expect(osc.stopTime).toBeGreaterThanOrEqual(5.1);
  });
});

describe("noise", () => {
  it("loops one shared buffer rather than allocating per hit", () => {
    // A fresh buffer per hit is 96kB and a millisecond of main thread on a
    // frame that is already busy.
    const { mock, sc } = mockSynthContext();
    const first = noiseBuffer(mock as unknown as BaseAudioContext);
    noise(sc, { duration: 0.05 });
    noise(sc, { duration: 0.05 });
    const sources = mock.created.filter((n) => n instanceof MockBufferSource) as MockBufferSource[];
    expect(sources).toHaveLength(2);
    expect(sources[0].buffer).toBe(first);
    expect(sources[1].buffer).toBe(first);
    expect(sources[0].loop).toBe(true);
  });

  it("builds source into band filter into sweep filter into gain", () => {
    const { mock, sc } = mockSynthContext();
    noise(sc, {
      duration: 0.015,
      band: { type: "bandpass", frequency: 2000, Q: 1.2 },
      sweep: { type: "lowpass", from: 4000, to: 500 },
    });

    const source = mock.created.find((n) => n instanceof MockBufferSource) as MockBufferSource;
    const [band, sweep] = mock.filters;
    const gain = mock.created.find((n) => n instanceof MockGain) as MockGain;

    expect(source.outputs).toEqual([band]);
    expect(band.type).toBe("bandpass");
    expect(band.frequency.value).toBe(2000);
    expect(band.outputs).toEqual([sweep]);
    expect(sweep.type).toBe("lowpass");
    expect(sweep.outputs).toEqual([gain]);
    expect(gain.outputs).toEqual([mock.destination]);
  });

  it("sweeps the second filter across the duration", () => {
    const { mock, sc } = mockSynthContext();
    noise(sc, { duration: 0.5, sweep: { from: 8000, to: 200 } });
    const [sweep] = mock.filters;
    expect(sweep.frequency.events[0]).toMatchObject({ value: 8000, time: 0 });
    expect(sweep.frequency.events[1]).toMatchObject({ value: 200, time: 0.5 });
  });

  it("skips the filters entirely when none are asked for", () => {
    const { mock, sc } = mockSynthContext();
    noise(sc, { duration: 0.05 });
    expect(mock.filters).toHaveLength(0);
  });
});

describe("drone", () => {
  it("detunes two oscillators through one filter, wobbled by an LFO", () => {
    // Two saws 4Hz apart beat at 4Hz; the LFO on the cutoff makes the bubble
    // breathe. Neither is decoration — a single undetuned saw sounds like a
    // test tone.
    const { mock, sc } = mockSynthContext();
    drone(sc, {
      frequencies: [220, 224],
      filter: { type: "lowpass", frequency: 700, Q: 4 },
      lfo: { rate: 2, depth: 260 },
    });

    const oscillators = mock.oscillators;
    // Two voices plus the LFO.
    expect(oscillators).toHaveLength(3);
    const lfo = oscillators.find((o) => o.frequency.value === 2)!;
    const voices = oscillators.filter((o) => o !== lfo);
    expect(voices.map((o) => o.frequency.value).sort()).toEqual([220, 224]);

    const [filter] = mock.filters;
    expect(filter.frequency.value).toBe(700);
    expect(filter.Q.value).toBe(4);

    // The LFO drives the *filter's frequency parameter*, not the audio path.
    const depth = lfo.outputs[0] as MockGain;
    expect(depth.gain.value).toBe(260);
    expect(depth.outputs).toEqual([filter.frequency]);
  });

  it("fades in, and fades out only when stopped", () => {
    const { mock, sc } = mockSynthContext();
    mock.currentTime = 1;
    const voice = drone(sc, { frequencies: [220], attack: 0.05, release: 0.08 });
    const gain = voice.output as unknown as MockGain;

    expect(gain.gain.events[1]).toMatchObject({
      method: "linearRampToValueAtTime",
      time: 1.05,
    });
    // Nothing has scheduled an end: a held shield lasts as long as it is held.
    const oscillator = mock.oscillators[0];
    expect(oscillator.stopTime).toBeNull();

    mock.currentTime = 3;
    voice.stop();
    expect(oscillator.stopTime).toBeCloseTo(3.09, 5);
  });

  it("ignores a second stop", () => {
    const { mock, sc } = mockSynthContext();
    const voice = drone(sc, { frequencies: [220] });
    voice.stop(1);
    voice.stop(2);
    expect(mock.oscillators[0].stopTime).toBeCloseTo(1.09, 5);
  });
});

describe("teardown", () => {
  // A stopped oscillator that is still connected keeps its whole graph alive.
  // One leak per hit is a thousand dead nodes by the last stock, on a machine
  // that is also drawing the game.
  it("disconnects every node of a tone when it ends", () => {
    const { mock, sc } = mockSynthContext();
    tone(sc, { freqStart: 440, duration: 0.1 });
    expect(mock.liveNodes.length).toBeGreaterThan(0);

    mock.advance(1);

    expect(mock.liveNodes).toEqual([]);
  });

  it("disconnects every node of a filtered noise burst when it ends", () => {
    const { mock, sc } = mockSynthContext();
    noise(sc, {
      duration: 0.015,
      band: { frequency: 2000 },
      sweep: { from: 4000, to: 500 },
    });
    expect(mock.created.filter((n) => n instanceof MockBiquadFilter)).toHaveLength(2);

    mock.advance(1);

    expect(mock.liveNodes).toEqual([]);
  });

  it("leaks nothing across a thousand hits", () => {
    const { mock, sc } = mockSynthContext();
    for (let i = 0; i < 1000; i++) {
      mock.currentTime = i * 0.05;
      tone(sc, { freqStart: 400, freqEnd: 150, duration: 0.05 });
      noise(sc, { duration: 0.015, band: { frequency: 2000 } });
    }
    mock.advance(10);

    expect(mock.created.length).toBeGreaterThan(3000);
    expect(mock.liveNodes).toEqual([]);
  });

  it("waits for the last of a drone's sources before tearing it down", () => {
    // Tearing down when the *first* source ends would silence a shield that is
    // still being held.
    const { mock, sc } = mockSynthContext();
    const voice = drone(sc, {
      frequencies: [220, 224],
      filter: { frequency: 700 },
      lfo: { rate: 2, depth: 200 },
    });

    mock.advance(1);
    expect(mock.liveNodes.length).toBeGreaterThan(0);

    voice.stop();
    mock.advance(1);
    expect(mock.liveNodes).toEqual([]);
  });

  it("survives a voice being cut short before its natural end", () => {
    const { mock, sc } = mockSynthContext();
    const voice = tone(sc, { freqStart: 440, duration: 2 });
    voice.stop(0.1);
    mock.advance(1);
    expect(mock.liveNodes).toEqual([]);
  });
});
