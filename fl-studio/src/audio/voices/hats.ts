/**
 * Hats — highpassed noise, one chain, two decays (SPEC.md §3.3).
 *
 * Closed and open hats are literally the same graph with a different decay.
 * The open hat is *not* choked from inside this file: choking is the
 * cross-channel choke-group rule of §3.3, enforced by the voice pool, because
 * the two hats are separate channels that happen to share group `"hats"`.
 */

import type { ActiveVoice, VoiceKind, VoiceTrigger } from "../types";
import {
  applyPercussiveEnvelope,
  createNoiseSource,
  finishVoice,
  velocityPeak,
} from "./shared";

export const HAT_HIGHPASS_HZ = 7000;
export const HAT_BANDPASS_HZ = 10000;
export const HAT_ATTACK_SEC = 0.001;
export const HAT_CLOSED_DECAY_SEC = 0.04;
export const HAT_OPEN_DECAY_SEC = 0.26;

function createHat(trigger: VoiceTrigger, kind: VoiceKind, decaySec: number): ActiveVoice {
  const { ctx, time, velocity } = trigger;
  const output = ctx.createGain();
  output.gain.value = 1;

  const noise = createNoiseSource(ctx);
  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = HAT_HIGHPASS_HZ;
  // A second, gentle bandpass gives the metallic tilt a bare highpass lacks.
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = HAT_BANDPASS_HZ;
  band.Q.value = 0.7;

  const env = ctx.createGain();
  const endTime = applyPercussiveEnvelope(env.gain, time, {
    peak: velocityPeak(velocity, 0.7),
    attackSec: HAT_ATTACK_SEC,
    decaySec,
  });

  noise.connect(highpass).connect(band).connect(env).connect(output);

  return finishVoice(trigger, { kind, output, sources: [noise], startTime: time, endTime });
}

export function createHatClosed(trigger: VoiceTrigger): ActiveVoice {
  return createHat(trigger, "hatClosed", HAT_CLOSED_DECAY_SEC);
}

export function createHatOpen(trigger: VoiceTrigger): ActiveVoice {
  return createHat(trigger, "hatOpen", HAT_OPEN_DECAY_SEC);
}
