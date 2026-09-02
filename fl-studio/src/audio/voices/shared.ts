/**
 * Primitives every voice recipe is built from (SPEC.md §3.3).
 *
 * Two rules live here rather than in each recipe, because getting them wrong
 * in one file out of seven is how a DAW ends up with one clicky drum:
 *
 * 1. **Never a hard cut.** {@link rampedRelease} anchors the param's current
 *    value with `setValueAtTime` before it ramps, and the sources are stopped
 *    only *after* the ramp lands — the click-avoidance rule of §3.3 and lane 3
 *    §4. `cancelAndHoldAtTime` (where implemented) flattens an in-flight
 *    attack first, which is the documented fix for releasing mid-attack.
 * 2. **Exponential ramps never touch zero.** `exponentialRampToValueAtTime(0)`
 *    throws; every decay lands on {@link SILENCE} and is then pinned to a true
 *    zero with `setValueAtTime`.
 */

import type { ActiveVoice, VoiceKind, VoiceTrigger } from "../types";

/** Lowest value an exponential ramp may target (a true 0 throws). */
export const SILENCE = 0.0001;

/** Default click-free release for a steal or a choke (SPEC.md §3.3). */
export const DEFAULT_RELEASE_SEC = 0.02;

/** MIDI pitch that means "no transposition" for a percussive recipe. */
export const NEUTRAL_PITCH = 60;

/** Concert-pitch frequency of a MIDI note. */
export function midiToFrequency(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

/**
 * Tuning multiplier for a drum: 1 at MIDI 60, an octave per 12 semitones,
 * clamped so a stray piano-roll note cannot sweep a kick out of audibility.
 */
export function drumTuneRatio(pitch: number): number {
  const semitones = Math.max(-24, Math.min(24, pitch - NEUTRAL_PITCH));
  return Math.pow(2, semitones / 12);
}

/* ------------------------------------------------------------- noise ---- */

/**
 * One shared white-noise buffer per context (SPEC.md §3.3: "a single shared
 * white-noise AudioBuffer is generated once"). Keyed by context in a WeakMap so
 * the offline export context gets its own and both are collectable.
 */
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

export const NOISE_BUFFER_SECONDS = 2;

export function getNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = noiseBuffers.get(ctx);
  if (cached !== undefined) return cached;
  const length = Math.max(1, Math.floor(ctx.sampleRate * NOISE_BUFFER_SECONDS));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  noiseBuffers.set(ctx, buffer);
  return buffer;
}

/** A looping noise source — cheap enough to mint per trigger (lane 3 §7). */
export function createNoiseSource(ctx: BaseAudioContext): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = getNoiseBuffer(ctx);
  source.loop = true;
  return source;
}

/* --------------------------------------------------------- envelopes ---- */

export interface PercussiveEnvelope {
  peak: number;
  attackSec: number;
  decaySec: number;
}

/**
 * Fast-attack / exponential-decay amplitude envelope — every drum voice's amp
 * shape. Returns the context time the envelope reaches silence.
 */
export function applyPercussiveEnvelope(
  param: AudioParam,
  time: number,
  { peak, attackSec, decaySec }: PercussiveEnvelope,
): number {
  const safePeak = Math.max(SILENCE, peak);
  param.setValueAtTime(0, time);
  param.linearRampToValueAtTime(safePeak, time + attackSec);
  param.exponentialRampToValueAtTime(SILENCE, time + attackSec + decaySec);
  param.setValueAtTime(0, time + attackSec + decaySec);
  return time + attackSec + decaySec;
}

export interface AdsrEnvelope {
  peak: number;
  attackSec: number;
  decaySec: number;
  /** 0..1 fraction of `peak`. */
  sustain: number;
  releaseSec: number;
}

/**
 * ADSR held for `durationSec` from note-on, then released. Returns the context
 * time the envelope reaches silence (release included) — the voice's
 * `endTime`.
 */
export function applyAdsrEnvelope(
  param: AudioParam,
  time: number,
  durationSec: number,
  { peak, attackSec, decaySec, sustain, releaseSec }: AdsrEnvelope,
): number {
  const safePeak = Math.max(SILENCE, peak);
  const sustainLevel = Math.max(SILENCE, safePeak * sustain);
  // A note shorter than attack+decay still gets its full attack: cutting the
  // attack short is what makes fast melodic lines sound gated rather than
  // played.
  const hold = Math.max(attackSec + decaySec, durationSec);
  param.setValueAtTime(0, time);
  param.linearRampToValueAtTime(safePeak, time + attackSec);
  param.exponentialRampToValueAtTime(sustainLevel, time + attackSec + decaySec);
  param.setValueAtTime(sustainLevel, time + hold);
  param.exponentialRampToValueAtTime(SILENCE, time + hold + releaseSec);
  param.setValueAtTime(0, time + hold + releaseSec);
  return time + hold + releaseSec;
}

/* ----------------------------------------------------------- release ---- */

/**
 * The one sanctioned way to silence a voice early (§3.3).
 *
 * Anchor → ramp → stop, in that order and never any other. `time` is clamped
 * to the context's own clock: automation scheduled in the past is applied
 * instantly by the spec, which is exactly the discontinuity we are avoiding.
 */
export function rampedRelease(
  ctx: BaseAudioContext,
  param: AudioParam,
  sources: readonly AudioScheduledSourceNode[],
  time: number,
  releaseSec: number = DEFAULT_RELEASE_SEC,
): number {
  const at = Math.max(time, ctx.currentTime);
  // Flatten any in-flight attack/decay first, so the release ramps from where
  // the envelope actually is rather than fighting a queued ramp.
  const holdable = param as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (typeof holdable.cancelAndHoldAtTime === "function") holdable.cancelAndHoldAtTime(at);
  else param.cancelScheduledValues(at);
  param.setValueAtTime(param.value, at);
  param.linearRampToValueAtTime(0, at + releaseSec);
  for (const source of sources) source.stop(at + releaseSec);
  return at + releaseSec;
}

/* -------------------------------------------------------- voice shell --- */

export interface VoiceParts {
  kind: VoiceKind;
  output: GainNode;
  sources: AudioScheduledSourceNode[];
  startTime: number;
  endTime: number;
}

/**
 * Wrap a built graph in the {@link ActiveVoice} contract: start every source,
 * schedule its natural stop, and expose the single ramped `release`.
 */
export function finishVoice(trigger: VoiceTrigger, parts: VoiceParts): ActiveVoice {
  const { ctx, destination } = trigger;
  parts.output.connect(destination);
  for (const source of parts.sources) {
    source.start(parts.startTime);
    source.stop(parts.endTime);
  }

  const voice: ActiveVoice = {
    kind: parts.kind,
    output: parts.output,
    startTime: parts.startTime,
    endTime: parts.endTime,
    released: false,
    release(time: number, releaseSec: number = DEFAULT_RELEASE_SEC): void {
      if (voice.released) return;
      voice.released = true;
      voice.endTime = rampedRelease(ctx, parts.output.gain, parts.sources, time, releaseSec);
    },
  };
  return voice;
}

/** Envelope peak from velocity, with a floor so velocity 0 is not silence. */
export function velocityPeak(velocity: number, ceiling = 1): number {
  const v = Number.isFinite(velocity) ? Math.min(1, Math.max(0, velocity)) : 1;
  return ceiling * (0.15 + 0.85 * v);
}
