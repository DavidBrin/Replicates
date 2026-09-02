/**
 * Lead — two detuned saws → lowpass → ADSR (SPEC.md §3.3).
 *
 * Polyphony is not a property of this file: it comes from the channel's
 * 8-voice pool (§3.3), which is what lets a piano-roll chord sound as a chord
 * instead of stealing itself down to one note.
 */

import type { ActiveVoice, VoiceTrigger } from "../types";
import { applyAdsrEnvelope, finishVoice, midiToFrequency, velocityPeak } from "./shared";

export const LEAD_DETUNE_CENTS = 7;
export const LEAD_FILTER_HZ = 3200;
export const LEAD_FILTER_Q = 1;
export const LEAD_ATTACK_SEC = 0.012;
export const LEAD_DECAY_SEC = 0.12;
export const LEAD_SUSTAIN = 0.6;
export const LEAD_RELEASE_SEC = 0.16;

export function createLead(trigger: VoiceTrigger): ActiveVoice {
  const { ctx, time, pitch, velocity, durationSec } = trigger;
  const frequency = midiToFrequency(pitch);
  const output = ctx.createGain();
  output.gain.value = 1;

  const oscillators = [LEAD_DETUNE_CENTS, -LEAD_DETUNE_CENTS].map((cents) => {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = frequency;
    osc.detune.value = cents;
    return osc;
  });

  const mix = ctx.createGain();
  mix.gain.value = 0.5; // two oscillators summing, so halve before the filter
  for (const osc of oscillators) osc.connect(mix);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = Math.max(LEAD_FILTER_HZ, frequency * 6);
  filter.Q.value = LEAD_FILTER_Q;

  const amp = ctx.createGain();
  const endTime = applyAdsrEnvelope(amp.gain, time, durationSec, {
    peak: velocityPeak(velocity, 0.7),
    attackSec: LEAD_ATTACK_SEC,
    decaySec: LEAD_DECAY_SEC,
    sustain: LEAD_SUSTAIN,
    releaseSec: LEAD_RELEASE_SEC,
  });

  mix.connect(filter).connect(amp).connect(output);

  return finishVoice(trigger, {
    kind: "lead",
    output,
    sources: oscillators,
    startTime: time,
    endTime,
  });
}
