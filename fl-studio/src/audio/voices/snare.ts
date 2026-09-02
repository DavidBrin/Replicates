/**
 * Snare — two detuned triangle oscillators for the body, a bandpassed noise
 * layer for the buzz (SPEC.md §3.3; lane 4 §3's layering technique).
 */

import type { ActiveVoice, VoiceTrigger } from "../types";
import {
  applyPercussiveEnvelope,
  createNoiseSource,
  drumTuneRatio,
  finishVoice,
  velocityPeak,
} from "./shared";

export const SNARE_BODY_HZ = 185;
export const SNARE_BODY_DETUNE_HZ = 12;
export const SNARE_BODY_DECAY_SEC = 0.11;
export const SNARE_NOISE_HZ = 3000;
export const SNARE_NOISE_Q = 0.8;
export const SNARE_NOISE_DECAY_SEC = 0.18;

export function createSnare(trigger: VoiceTrigger): ActiveVoice {
  const { ctx, time, pitch, velocity } = trigger;
  const tune = drumTuneRatio(pitch);
  const peak = velocityPeak(velocity);
  const output = ctx.createGain();
  output.gain.value = 1;

  const bodyGain = ctx.createGain();
  const bodyEnd = applyPercussiveEnvelope(bodyGain.gain, time, {
    peak: peak * 0.6,
    attackSec: 0.002,
    decaySec: SNARE_BODY_DECAY_SEC,
  });
  const oscillators = [SNARE_BODY_HZ, SNARE_BODY_HZ + SNARE_BODY_DETUNE_HZ].map((hz) => {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = hz * tune;
    osc.connect(bodyGain);
    return osc;
  });
  bodyGain.connect(output);

  const noise = createNoiseSource(ctx);
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = SNARE_NOISE_HZ;
  band.Q.value = SNARE_NOISE_Q;
  const noiseGain = ctx.createGain();
  const noiseEnd = applyPercussiveEnvelope(noiseGain.gain, time, {
    peak: peak * 0.7,
    attackSec: 0.001,
    decaySec: SNARE_NOISE_DECAY_SEC,
  });
  noise.connect(band).connect(noiseGain).connect(output);

  return finishVoice(trigger, {
    kind: "snare",
    output,
    sources: [...oscillators, noise],
    startTime: time,
    endTime: Math.max(bodyEnd, noiseEnd),
  });
}
