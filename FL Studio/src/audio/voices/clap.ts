/**
 * Clap — three ~10 ms bandpassed noise bursts plus a longer tail
 * (SPEC.md §3.3; lane 4 §3's 808-clap emulation).
 *
 * One noise source carries all four hits: the "layering" is entirely in the
 * gain automation, which is both cheaper and easier to keep phase-consistent
 * than four separately-started sources.
 */

import type { ActiveVoice, VoiceTrigger } from "../types";
import { createNoiseSource, finishVoice, SILENCE, velocityPeak } from "./shared";

export const CLAP_BURST_OFFSETS_SEC = [0, 0.011, 0.022];
export const CLAP_BURST_SEC = 0.01;
export const CLAP_TAIL_START_SEC = 0.033;
export const CLAP_TAIL_SEC = 0.12;
export const CLAP_BANDPASS_HZ = 1400;
export const CLAP_BANDPASS_Q = 1.2;

export function createClap(trigger: VoiceTrigger): ActiveVoice {
  const { ctx, time, velocity } = trigger;
  const output = ctx.createGain();
  output.gain.value = 1;

  const noise = createNoiseSource(ctx);
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = CLAP_BANDPASS_HZ;
  band.Q.value = CLAP_BANDPASS_Q;

  const env = ctx.createGain();
  const peak = velocityPeak(velocity, 0.9);
  CLAP_BURST_OFFSETS_SEC.forEach((offset, index) => {
    const level = peak * (1 - index * 0.18);
    env.gain.setValueAtTime(level, time + offset);
    env.gain.exponentialRampToValueAtTime(SILENCE, time + offset + CLAP_BURST_SEC);
  });
  env.gain.setValueAtTime(peak * 0.8, time + CLAP_TAIL_START_SEC);
  env.gain.exponentialRampToValueAtTime(SILENCE, time + CLAP_TAIL_START_SEC + CLAP_TAIL_SEC);
  const endTime = time + CLAP_TAIL_START_SEC + CLAP_TAIL_SEC;
  env.gain.setValueAtTime(0, endTime);

  noise.connect(band).connect(env).connect(output);

  return finishVoice(trigger, {
    kind: "clap",
    output,
    sources: [noise],
    startTime: time,
    endTime,
  });
}
