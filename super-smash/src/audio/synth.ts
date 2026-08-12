/**
 * Sound, from arithmetic.
 *
 * No audio files ship with this game, for the same reason no sprites do: there
 * is no legitimate way to obtain Nintendo's, and a fighting game with silent
 * hits is not the game. So every sound here is built at runtime out of
 * oscillators, gain envelopes, biquad filters and noise — which turns out to be
 * a good fit rather than a compromise, because impact sounds are mostly
 * envelope. What makes a punch read as a punch is a two-millisecond attack and
 * a fast decay; the pitch content is almost secondary. That is precisely what
 * the Web Audio API is good at describing.
 *
 * Three primitives, and one rule.
 *
 * The rule: **every node this file creates is disconnected when its source
 * ends.** A match is eight minutes of hits, and an oscillator that is stopped
 * but still connected keeps its whole graph alive. Leak one per hit and the
 * audio thread is dragging a thousand dead nodes by the last stock. Every
 * factory below wires `onended` before it returns, and the tests assert it.
 */

/** Where a sound is built and where it goes. */
export interface SynthContext {
  readonly ctx: BaseAudioContext;
  /** Usually the engine's SFX bus, so one slider moves everything. */
  readonly destination: AudioNode;
}

/**
 * A sound in flight.
 *
 * `stop` exists for the sustained ones — a shield hum has no natural end, it
 * ends when the player lets go.
 */
export interface Voice {
  /** Begin the release and schedule teardown. Idempotent. */
  stop(when?: number): void;
  readonly output: GainNode;
}

export interface EnvelopeOptions {
  /** Context time the envelope starts. Defaults to "now". */
  when?: number;
  /** Seconds to the peak. Two milliseconds is a click; fifty is a swell. */
  attack?: number;
  /** Peak gain. */
  peak?: number;
  /** Seconds of exponential fall after the peak. */
  decay?: number;
  /** Level held after the decay, as a fraction of peak. 0 for a one-shot. */
  sustain?: number;
  /** Seconds the sustain is held before the release. */
  hold?: number;
  /** Seconds of fade at the end. */
  release?: number;
}

const SILENCE = 0.0001;

/**
 * Apply an ADSR to a gain parameter, and return when it finishes.
 *
 * Exponential ramps for the falling edges, because loudness is perceived
 * logarithmically: a linear fade sounds like it hangs at the end and then drops
 * off a cliff. Exponential ramps cannot reach zero, hence `SILENCE` and the
 * explicit `setValueAtTime(0)` afterwards — a node left at 0.0001 is inaudible
 * but still costs the same to mix.
 */
export function envelope(param: AudioParam, options: EnvelopeOptions = {}): number {
  const start = options.when ?? 0;
  const peak = Math.max(SILENCE, options.peak ?? 1);
  const attack = Math.max(0.0005, options.attack ?? 0.002);
  const decay = Math.max(0.001, options.decay ?? 0.05);
  const sustain = options.sustain ?? 0;
  const hold = options.hold ?? 0;
  const release = options.release ?? 0;

  const attackEnd = start + attack;
  const decayEnd = attackEnd + decay;
  const sustainLevel = Math.max(SILENCE, peak * sustain);

  param.cancelScheduledValues(start);
  param.setValueAtTime(SILENCE, start);
  param.linearRampToValueAtTime(peak, attackEnd);
  param.exponentialRampToValueAtTime(sustain > 0 ? sustainLevel : SILENCE, decayEnd);

  if (sustain <= 0) {
    param.setValueAtTime(0, decayEnd);
    return decayEnd;
  }

  const holdEnd = decayEnd + hold;
  param.setValueAtTime(sustainLevel, holdEnd);
  const end = holdEnd + Math.max(0.001, release);
  param.exponentialRampToValueAtTime(SILENCE, end);
  param.setValueAtTime(0, end);
  return end;
}

export interface ToneOptions {
  wave?: OscillatorType;
  freqStart: number;
  /** Where the pitch lands. Omit for a steady note. */
  freqEnd?: number;
  /** Seconds. The pitch sweep and the envelope both span it. */
  duration: number;
  attack?: number;
  decay?: number;
  gain?: number;
  detune?: number;
  when?: number;
  destination?: AudioNode;
  /** Pitch sweeps are exponential by default — that is how pitch is heard. */
  glide?: "exponential" | "linear";
}

/**
 * One oscillator through one gain envelope.
 *
 * The workhorse. Nearly every sound in `sfx.ts` is one or two of these plus a
 * noise layer.
 */
export function tone(sc: SynthContext, options: ToneOptions): Voice {
  const now = options.when ?? sc.ctx.currentTime;
  const duration = Math.max(0.005, options.duration);
  const osc = sc.ctx.createOscillator();
  const gain = sc.ctx.createGain();

  osc.type = options.wave ?? "sine";
  if (options.detune) osc.detune.setValueAtTime(options.detune, now);

  const from = Math.max(1, options.freqStart);
  osc.frequency.setValueAtTime(from, now);
  if (options.freqEnd !== undefined) {
    const to = Math.max(1, options.freqEnd);
    if ((options.glide ?? "exponential") === "exponential") {
      osc.frequency.exponentialRampToValueAtTime(to, now + duration);
    } else {
      osc.frequency.linearRampToValueAtTime(to, now + duration);
    }
  }

  const end = envelope(gain.gain, {
    when: now,
    peak: options.gain ?? 0.3,
    attack: options.attack ?? 0.002,
    decay: options.decay ?? duration,
  });

  osc.connect(gain);
  gain.connect(options.destination ?? sc.destination);
  osc.start(now);
  const stopAt = Math.max(end, now + duration);
  osc.stop(stopAt);
  teardown(osc, [osc, gain]);

  return {
    output: gain,
    stop(when) {
      const at = when ?? sc.ctx.currentTime;
      gain.gain.cancelScheduledValues(at);
      gain.gain.setValueAtTime(Math.max(SILENCE, gain.gain.value), at);
      gain.gain.exponentialRampToValueAtTime(SILENCE, at + 0.02);
      safeStop(osc, at + 0.03);
    },
  };
}

export interface NoiseOptions {
  duration: number;
  gain?: number;
  attack?: number;
  decay?: number;
  when?: number;
  destination?: AudioNode;
  /** A fixed filter — a bandpass for a crack, a highpass for a whoosh. */
  band?: { type?: BiquadFilterType; frequency: number; Q?: number };
  /** A second filter whose cutoff moves. This is what makes a sound recede. */
  sweep?: { type?: BiquadFilterType; from: number; to: number; Q?: number };
  /** Resample the noise buffer. Below 1 it gets darker and grittier. */
  playbackRate?: number;
}

/**
 * White noise, shaped.
 *
 * Unfiltered noise is a hiss and sounds like nothing in particular. Everything
 * percussive in this game is noise plus a filter: a bandpass around 2kHz is a
 * crack, a lowpass closing over half a second is something disappearing into
 * the distance, a highpass sweep is air moving.
 */
export function noise(sc: SynthContext, options: NoiseOptions): Voice {
  const now = options.when ?? sc.ctx.currentTime;
  const duration = Math.max(0.005, options.duration);
  const source = sc.ctx.createBufferSource();
  source.buffer = noiseBuffer(sc.ctx);
  source.loop = true;
  if (options.playbackRate !== undefined) {
    source.playbackRate.setValueAtTime(options.playbackRate, now);
  }

  const nodes: AudioNode[] = [source];
  let tail: AudioNode = source;

  if (options.band) {
    const filter = sc.ctx.createBiquadFilter();
    filter.type = options.band.type ?? "bandpass";
    filter.frequency.setValueAtTime(Math.max(1, options.band.frequency), now);
    if (options.band.Q !== undefined) filter.Q.setValueAtTime(options.band.Q, now);
    tail.connect(filter);
    tail = filter;
    nodes.push(filter);
  }

  if (options.sweep) {
    const filter = sc.ctx.createBiquadFilter();
    filter.type = options.sweep.type ?? "lowpass";
    if (options.sweep.Q !== undefined) filter.Q.setValueAtTime(options.sweep.Q, now);
    filter.frequency.setValueAtTime(Math.max(1, options.sweep.from), now);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(1, options.sweep.to),
      now + duration,
    );
    tail.connect(filter);
    tail = filter;
    nodes.push(filter);
  }

  const gain = sc.ctx.createGain();
  const end = envelope(gain.gain, {
    when: now,
    peak: options.gain ?? 0.3,
    attack: options.attack ?? 0.001,
    decay: options.decay ?? duration,
  });
  tail.connect(gain);
  gain.connect(options.destination ?? sc.destination);
  nodes.push(gain);

  source.start(now);
  const stopAt = Math.max(end, now + duration);
  source.stop(stopAt);
  teardown(source, nodes);

  return {
    output: gain,
    stop(when) {
      const at = when ?? sc.ctx.currentTime;
      gain.gain.cancelScheduledValues(at);
      gain.gain.setValueAtTime(Math.max(SILENCE, gain.gain.value), at);
      gain.gain.exponentialRampToValueAtTime(SILENCE, at + 0.02);
      safeStop(source, at + 0.03);
    },
  };
}

/* ------------------------------------------------------------------ shared -- */

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/**
 * Two seconds of white noise, made once per context and looped thereafter.
 *
 * Generating a fresh buffer per hit would allocate 96kB and burn a millisecond
 * of main thread on a frame where a lot else is happening. Two seconds is long
 * enough that the loop point never becomes audible in a 15ms crack.
 *
 * `Math.random` is fine here and *only* here: this is presentation, outside the
 * simulation, and nothing about which sample the noise starts on can change
 * what happens in the match.
 */
export function noiseBuffer(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  const cached = noiseBuffers.get(ctx);
  if (cached) return cached;
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffers.set(ctx, buffer);
  return buffer;
}

/**
 * Disconnect the whole chain when the source finishes.
 *
 * `onended` fires once, after `stop()`'s scheduled time has passed. Doing the
 * teardown here rather than on a timer means it happens exactly when the node
 * is genuinely finished, whatever the scheduling ended up being.
 */
function teardown(source: AudioScheduledSourceNode, nodes: AudioNode[]): void {
  source.onended = () => {
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch {
        // Already disconnected — a voice stopped early then reaching its
        // natural end is the normal way to get here.
      }
    }
  };
}

function safeStop(source: AudioScheduledSourceNode, when: number): void {
  try {
    source.stop(when);
  } catch {
    // `stop` throws if it was never started, and is a no-op if already
    // scheduled earlier. Neither is worth propagating into a game loop.
  }
}

/* --------------------------------------------------------------- sustained -- */

export interface DroneOptions {
  /** Two frequencies a few Hz apart beat against each other and sound alive. */
  frequencies: number[];
  wave?: OscillatorType;
  gain?: number;
  attack?: number;
  release?: number;
  when?: number;
  destination?: AudioNode;
  /** A lowpass the drone plays through. */
  filter?: { type?: BiquadFilterType; frequency: number; Q?: number };
  /** Slow modulation of the filter cutoff. A shield bubble wobbles. */
  lfo?: { rate: number; depth: number };
}

/**
 * A sound that lasts until something stops it.
 *
 * Used for the shield hum, which is held rather than triggered — the one sound
 * in the game whose length is a player decision. Detuning two oscillators a few
 * Hz apart produces a beat at the difference frequency, which is what stops a
 * held note from sounding like a test tone.
 */
export function drone(sc: SynthContext, options: DroneOptions): Voice {
  const now = options.when ?? sc.ctx.currentTime;
  const gain = sc.ctx.createGain();
  const nodes: AudioNode[] = [gain];
  const sources: AudioScheduledSourceNode[] = [];

  let tail: AudioNode = gain;

  if (options.filter) {
    const filter = sc.ctx.createBiquadFilter();
    filter.type = options.filter.type ?? "lowpass";
    filter.frequency.setValueAtTime(Math.max(1, options.filter.frequency), now);
    if (options.filter.Q !== undefined) filter.Q.setValueAtTime(options.filter.Q, now);
    gain.connect(filter);
    tail = filter;
    nodes.push(filter);

    if (options.lfo) {
      const lfo = sc.ctx.createOscillator();
      const depth = sc.ctx.createGain();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(options.lfo.rate, now);
      depth.gain.setValueAtTime(options.lfo.depth, now);
      lfo.connect(depth);
      depth.connect(filter.frequency);
      lfo.start(now);
      sources.push(lfo);
      nodes.push(lfo, depth);
    }
  }

  for (const frequency of options.frequencies) {
    const osc = sc.ctx.createOscillator();
    osc.type = options.wave ?? "sawtooth";
    osc.frequency.setValueAtTime(Math.max(1, frequency), now);
    osc.connect(gain);
    osc.start(now);
    sources.push(osc);
    nodes.push(osc);
  }

  const peak = options.gain ?? 0.15;
  const attack = options.attack ?? 0.05;
  gain.gain.setValueAtTime(SILENCE, now);
  gain.gain.linearRampToValueAtTime(peak, now + attack);
  tail.connect(options.destination ?? sc.destination);

  // A drone has several sources — the oscillators and, if there is one, the
  // LFO — so the graph comes down when the last of them ends rather than the
  // first. Tearing down on the first would silence a shield that is still held.
  let remaining = sources.length;
  for (const source of sources) {
    source.onended = () => {
      if (--remaining > 0) return;
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch {
          /* already gone */
        }
      }
    };
  }

  let stopped = false;
  return {
    output: gain,
    stop(when) {
      if (stopped) return;
      stopped = true;
      const at = when ?? sc.ctx.currentTime;
      const release = options.release ?? 0.08;
      gain.gain.cancelScheduledValues(at);
      gain.gain.setValueAtTime(Math.max(SILENCE, gain.gain.value), at);
      gain.gain.exponentialRampToValueAtTime(SILENCE, at + release);
      gain.gain.setValueAtTime(0, at + release);
      for (const source of sources) safeStop(source, at + release + 0.01);
    },
  };
}
