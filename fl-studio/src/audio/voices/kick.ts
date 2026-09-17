/**
 * Kick — sine with an exponential pitch drop plus a 2 ms noise click
 * (SPEC.md §3.3; lane 3 §7, lane 4 §3's 808 recipe).
 */

import type { ActiveVoice, VoiceTrigger } from "../types";
import {
  applyPercussiveEnvelope,
  createNoiseSource,
  drumTuneRatio,
  finishVoice,
  SILENCE,
  velocityPeak,
} from "./shared";

export const KICK_START_HZ = 150;
export const KICK_END_HZ = 40;
export const KICK_PITCH_SWEEP_SEC = 0.15;
export const KICK_ATTACK_SEC = 0.01;
export const KICK_DECAY_SEC = 0.13;
export const KICK_CLICK_SEC = 0.002;

export function createKick(trigger: VoiceTrigger): ActiveVoice {
  const { ctx, time, pitch, velocity } = trigger;
  const tune = drumTuneRatio(pitch);
  const output = ctx.createGain();
  output.gain.value = 1;

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(KICK_START_HZ * tune, time);
  osc.frequency.exponentialRampToValueAtTime(KICK_END_HZ * tune, time + KICK_PITCH_SWEEP_SEC);

  const body = ctx.createGain();
  const endTime = applyPercussiveEnvelope(body.gain, time, {
    peak: velocityPeak(velocity),
    attackSec: KICK_ATTACK_SEC,
    decaySec: KICK_DECAY_SEC,
  });
  osc.connect(body).connect(output);

  // The click transient: a 2 ms highpassed noise blip that gives the thump its
  // attack without adding low end.
  const click = createNoiseSource(ctx);
  const clickFilter = ctx.createBiquadFilter();
  clickFilter.type = "highpass";
  clickFilter.frequency.value = 1200;
  const clickGain = ctx.createGain();
  clickGain.gain.setValueAtTime(velocityPeak(velocity, 0.35), time);
  clickGain.gain.exponentialRampToValueAtTime(SILENCE, time + KICK_CLICK_SEC);
  clickGain.gain.setValueAtTime(0, time + KICK_CLICK_SEC);
  click.connect(clickFilter).connect(clickGain).connect(output);

  return finishVoice(trigger, {
    kind: "kick",
    output,
    sources: [osc, click],
    startTime: time,
    endTime,
  });
}
