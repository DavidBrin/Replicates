/**
 * Bass — subtractive: saw + sine sub → envelope-modulated lowpass → amp ADSR
 * (SPEC.md §3.3; lane 4 §3's textbook subtractive patch).
 */

import type { ActiveVoice, VoiceTrigger } from "../types";
import { applyAdsrEnvelope, finishVoice, midiToFrequency, velocityPeak } from "./shared";

export const BASS_FILTER_OPEN_HZ = 2200;
export const BASS_FILTER_FLOOR_HZ = 220;
export const BASS_FILTER_SWEEP_SEC = 0.18;
export const BASS_FILTER_Q = 6;
export const BASS_ATTACK_SEC = 0.006;
export const BASS_DECAY_SEC = 0.08;
export const BASS_SUSTAIN = 0.72;
export const BASS_RELEASE_SEC = 0.09;

export function createBass(trigger: VoiceTrigger): ActiveVoice {
  const { ctx, time, pitch, velocity, durationSec } = trigger;
  const frequency = midiToFrequency(pitch);
  const output = ctx.createGain();
  output.gain.value = 1;

  const saw = ctx.createOscillator();
  saw.type = "sawtooth";
  saw.frequency.value = frequency;

  // The −1-octave sine sub of the recipe: weight without mud, mixed under the
  // saw rather than level with it.
  const sub = ctx.createOscillator();
  sub.type = "sine";
  sub.frequency.value = frequency / 2;
  const subGain = ctx.createGain();
  subGain.gain.value = 0.55;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = BASS_FILTER_Q;
  // Cutoff env: open, then close — the "pluck" of a subtractive bass.
  filter.frequency.setValueAtTime(Math.max(BASS_FILTER_OPEN_HZ, frequency * 4), time);
  filter.frequency.exponentialRampToValueAtTime(
    Math.max(BASS_FILTER_FLOOR_HZ, frequency * 1.5),
    time + BASS_FILTER_SWEEP_SEC,
  );

  const amp = ctx.createGain();
  const endTime = applyAdsrEnvelope(amp.gain, time, durationSec, {
    peak: velocityPeak(velocity, 0.8),
    attackSec: BASS_ATTACK_SEC,
    decaySec: BASS_DECAY_SEC,
    sustain: BASS_SUSTAIN,
    releaseSec: BASS_RELEASE_SEC,
  });

  saw.connect(filter);
  sub.connect(subGain).connect(filter);
  filter.connect(amp).connect(output);

  return finishVoice(trigger, {
    kind: "bass",
    output,
    sources: [saw, sub],
    startTime: time,
    endTime,
  });
}
