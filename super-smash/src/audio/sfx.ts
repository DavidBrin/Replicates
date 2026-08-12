/**
 * The recipes.
 *
 * Each of these is a small, specific claim about what a sound in Smash is made
 * of, and the numbers are the interesting part of the file. Three ideas run
 * through all of them:
 *
 * **Weight is duration and pitch, not volume.** A light jab and a fully charged
 * forward smash both peak at roughly the same loudness; what separates them is
 * that the smash is three times longer and lives an octave and a half lower. If
 * the only difference were volume, the game would read as "quiet hit" and "loud
 * hit" rather than "fast" and "heavy".
 *
 * **Impacts need a transient.** The first two milliseconds carry the impact.
 * Every hit here has a click or a noise crack layered on top of its body, at a
 * fraction of the body's length, because without one the sound arrives late
 * even when it is sample-accurate.
 *
 * **Sounds that recede close their filter.** A KO is not just a falling pitch;
 * it is a lowpass sweeping from 8kHz down to 200Hz, which is what distance
 * does to a sound in air. Pitch alone reads as a slide whistle.
 */

import { drone, noise, tone, type SynthContext, type Voice } from "./synth";

/** A hit that barely moved anybody: jabs, tilts, weak aerials. */
export function lightHit(sc: SynthContext, when?: number): void {
  const at = when ?? sc.ctx.currentTime;
  // 400 down to 150 in fifty milliseconds. Fast enough to read as a snap
  // rather than a fall.
  tone(sc, {
    wave: "triangle",
    freqStart: 400,
    freqEnd: 150,
    duration: 0.05,
    attack: 0.002,
    decay: 0.05,
    gain: 0.35,
    when: at,
  });
  // The click. One and a half milliseconds of square wave, high enough to sit
  // above the body. This is the entire difference between a hit landing and a
  // hit being reported.
  tone(sc, {
    wave: "square",
    freqStart: 1800,
    duration: 0.0015,
    attack: 0.0005,
    decay: 0.0015,
    gain: 0.22,
    when: at,
  });
}

/** A smash attack, or anything that sends somebody a long way. */
export function heavyHit(sc: SynthContext, when?: number): void {
  const at = when ?? sc.ctx.currentTime;
  // The thump: 120Hz to 40Hz over 180ms. Below 60Hz a laptop speaker gives
  // back more of a thud than a tone, which is the desired outcome.
  tone(sc, {
    wave: "sine",
    freqStart: 120,
    freqEnd: 40,
    duration: 0.18,
    attack: 0.004,
    decay: 0.18,
    gain: 0.5,
    when: at,
  });
  // The crack, layered on top: fifteen milliseconds of noise through a
  // bandpass at 2kHz, with a lowpass falling 4kHz to 500Hz across it so the
  // crack collapses inward instead of just stopping.
  noise(sc, {
    duration: 0.015,
    gain: 0.4,
    attack: 0.001,
    decay: 0.015,
    band: { type: "bandpass", frequency: 2000, Q: 1.2 },
    sweep: { type: "lowpass", from: 4000, to: 500 },
    when: at,
  });
}

/**
 * The shield bubble, held.
 *
 * Two saws four Hertz apart beat against each other at 4Hz, and a 2Hz LFO on
 * the filter cutoff makes the whole thing breathe. Together they are why it
 * sounds like a membrane under tension rather than a synthesiser holding a
 * note. Fifty milliseconds in, eighty out.
 */
export function shieldVoice(sc: SynthContext, when?: number): Voice {
  return drone(sc, {
    frequencies: [220, 224],
    wave: "sawtooth",
    gain: 0.12,
    attack: 0.05,
    release: 0.08,
    filter: { type: "lowpass", frequency: 700, Q: 4 },
    lfo: { rate: 2, depth: 260 },
    when,
  });
}

/** A hit absorbed by a shield: the same impact, muffled by the bubble. */
export function shieldHit(sc: SynthContext, when?: number): void {
  const at = when ?? sc.ctx.currentTime;
  tone(sc, {
    wave: "sine",
    freqStart: 180,
    freqEnd: 90,
    duration: 0.08,
    attack: 0.003,
    decay: 0.08,
    gain: 0.3,
    when: at,
  });
  noise(sc, {
    duration: 0.05,
    gain: 0.15,
    band: { type: "lowpass", frequency: 800, Q: 0.7 },
    when: at,
  });
}

/** A perfect shield: the parry spark, bright and immediate. */
export function perfectShield(sc: SynthContext, when?: number): void {
  const at = when ?? sc.ctx.currentTime;
  noise(sc, {
    duration: 0.04,
    gain: 0.3,
    attack: 0.001,
    decay: 0.04,
    band: { type: "highpass", frequency: 3000 },
    sweep: { type: "lowpass", from: 9000, to: 3000 },
    when: at,
  });
  tone(sc, {
    wave: "triangle",
    freqStart: 1200,
    freqEnd: 2400,
    duration: 0.09,
    attack: 0.002,
    decay: 0.09,
    gain: 0.18,
    when: at,
  });
}

/** Fifty HP of shield gone at once, and the fighter is stunned for four
 *  seconds. The sound has to justify that. */
export function shieldBreak(sc: SynthContext, when?: number): void {
  const at = when ?? sc.ctx.currentTime;
  // The burst.
  noise(sc, {
    duration: 0.18,
    gain: 0.45,
    attack: 0.001,
    decay: 0.18,
    band: { type: "highpass", frequency: 1200 },
    sweep: { type: "lowpass", from: 10000, to: 900 },
    when: at,
  });
  // Then shards: three quick descending squares, each a little later and a
  // little quieter, which is the cheapest convincing shatter there is.
  for (let i = 0; i < 3; i++) {
    tone(sc, {
      wave: "square",
      freqStart: 1600 - i * 300,
      freqEnd: 400 - i * 80,
      duration: 0.12,
      attack: 0.001,
      decay: 0.12,
      gain: 0.12 - i * 0.03,
      when: at + 0.02 + i * 0.045,
    });
  }
}

/** Leaving the ground. Rises, because everything that goes up does. */
export function jump(sc: SynthContext, when?: number): void {
  const at = when ?? sc.ctx.currentTime;
  tone(sc, {
    wave: "square",
    freqStart: 300,
    freqEnd: 850,
    duration: 0.12,
    attack: 0.004,
    decay: 0.12,
    gain: 0.14,
    when: at,
  });
  // The puff of the fighter pushing off. Brief, and mostly felt.
  noise(sc, {
    duration: 0.06,
    gain: 0.1,
    attack: 0.002,
    decay: 0.06,
    band: { type: "highpass", frequency: 900 },
    when: at,
  });
}

/** Landing. The mirror of the jump: falls, and is more felt than heard. */
export function land(sc: SynthContext, when?: number): void {
  const at = when ?? sc.ctx.currentTime;
  tone(sc, {
    wave: "sine",
    freqStart: 90,
    freqEnd: 50,
    duration: 0.1,
    attack: 0.002,
    decay: 0.1,
    gain: 0.3,
    when: at,
  });
  noise(sc, {
    duration: 0.07,
    gain: 0.14,
    band: { type: "lowpass", frequency: 500 },
    when: at,
  });
}

/**
 * The KO blast.
 *
 * The game's signature moment, and the one sound worth the most tuning. Three
 * things happen at once and they have to happen in this order.
 *
 * A fifteen-millisecond noise crack is the launch — it is what makes the moment
 * feel like an *event* rather than a fade. Then a sine falls 800Hz to 30Hz over
 * half a second, which is the fighter travelling. And underneath it, the
 * lowpass closes from 8kHz to 200Hz, which is the thing that sells it: as a
 * sound source moves away, air absorbs its high frequencies first. Pitch alone
 * would be a slide whistle. Pitch plus a closing filter is distance.
 */
export function koBlast(sc: SynthContext, when?: number): void {
  const at = when ?? sc.ctx.currentTime;
  noise(sc, {
    duration: 0.015,
    gain: 0.5,
    attack: 0.0005,
    decay: 0.015,
    band: { type: "highpass", frequency: 500 },
    when: at,
  });
  tone(sc, {
    wave: "sine",
    freqStart: 800,
    freqEnd: 30,
    duration: 0.5,
    attack: 0.003,
    decay: 0.5,
    gain: 0.45,
    when: at,
  });
  // The distance. Long, and the reason a KO does not simply stop.
  noise(sc, {
    duration: 0.5,
    gain: 0.22,
    attack: 0.002,
    decay: 0.5,
    sweep: { type: "lowpass", from: 8000, to: 200 },
    when: at,
  });
}

/** Two hitboxes of similar strength meeting. Metal, and brief. */
export function clank(sc: SynthContext, when?: number): void {
  const at = when ?? sc.ctx.currentTime;
  noise(sc, {
    duration: 0.09,
    gain: 0.22,
    attack: 0.001,
    decay: 0.09,
    band: { type: "bandpass", frequency: 3200, Q: 8 },
    when: at,
  });
  tone(sc, {
    wave: "square",
    freqStart: 2400,
    freqEnd: 1900,
    duration: 0.05,
    attack: 0.001,
    decay: 0.05,
    gain: 0.1,
    when: at,
  });
}

/** A dodge or a roll: air, moving. */
export function dodge(sc: SynthContext, when?: number): void {
  noise(sc, {
    duration: 0.2,
    gain: 0.16,
    attack: 0.03,
    decay: 0.17,
    band: { type: "bandpass", frequency: 1200, Q: 1.5 },
    sweep: { type: "highpass", from: 300, to: 2500 },
    when,
  });
}

/** A grab connecting. Blunt, close, no ring at all. */
export function grab(sc: SynthContext, when?: number): void {
  const at = when ?? sc.ctx.currentTime;
  tone(sc, {
    wave: "sine",
    freqStart: 220,
    freqEnd: 140,
    duration: 0.06,
    attack: 0.002,
    decay: 0.06,
    gain: 0.24,
    when: at,
  });
  noise(sc, {
    duration: 0.03,
    gain: 0.16,
    band: { type: "bandpass", frequency: 700, Q: 2 },
    when: at,
  });
}

/** A throw: the wind-up, then the release. */
export function throwRelease(sc: SynthContext, when?: number): void {
  const at = when ?? sc.ctx.currentTime;
  noise(sc, {
    duration: 0.16,
    gain: 0.18,
    attack: 0.02,
    decay: 0.14,
    band: { type: "bandpass", frequency: 900, Q: 1.2 },
    sweep: { type: "lowpass", from: 6000, to: 800 },
    when: at,
  });
  tone(sc, {
    wave: "triangle",
    freqStart: 200,
    freqEnd: 520,
    duration: 0.1,
    attack: 0.004,
    decay: 0.1,
    gain: 0.2,
    when: at + 0.06,
  });
}

/**
 * The Smash Ball breaking — a rising rainbow arpeggio.
 *
 * Seven notes up a major scale, each 45ms apart, over a rising shimmer. It is
 * the most conspicuously *musical* sound in the game, and deliberately so: it
 * is the only moment in a match that is pure reward, and it should sound like
 * one.
 */
export function smashBallBreak(sc: SynthContext, when?: number): void {
  const at = when ?? sc.ctx.currentTime;
  const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1318.5];
  scale.forEach((frequency, i) => {
    tone(sc, {
      wave: "triangle",
      freqStart: frequency,
      freqEnd: frequency * 1.01,
      duration: 0.18,
      attack: 0.005,
      decay: 0.18,
      gain: 0.14,
      when: at + i * 0.045,
    });
  });
  noise(sc, {
    duration: 0.5,
    gain: 0.14,
    attack: 0.15,
    decay: 0.35,
    sweep: { type: "highpass", from: 800, to: 7000 },
    when: at,
  });
}

/** A Final Smash starting. The screen has already gone dark; this fills it. */
export function finalSmash(sc: SynthContext, when?: number): void {
  const at = when ?? sc.ctx.currentTime;
  tone(sc, {
    wave: "sawtooth",
    freqStart: 110,
    freqEnd: 880,
    duration: 0.6,
    attack: 0.05,
    decay: 0.55,
    gain: 0.2,
    when: at,
  });
  noise(sc, {
    duration: 0.7,
    gain: 0.2,
    attack: 0.2,
    decay: 0.5,
    sweep: { type: "highpass", from: 200, to: 6000 },
    when: at,
  });
}

/* -------------------------------------------------------------------- menu -- */

/** Moving between menu items. Short enough to survive being spammed. */
export function menuMove(sc: SynthContext, when?: number): void {
  tone(sc, {
    wave: "square",
    freqStart: 550,
    duration: 0.045,
    attack: 0.002,
    decay: 0.045,
    gain: 0.1,
    when,
  });
}

/** Confirming. Two notes, rising — the universal grammar for "yes". */
export function menuConfirm(sc: SynthContext, when?: number): void {
  const at = when ?? sc.ctx.currentTime;
  tone(sc, { wave: "square", freqStart: 660, duration: 0.06, gain: 0.11, when: at });
  tone(sc, { wave: "square", freqStart: 880, duration: 0.1, gain: 0.11, when: at + 0.06 });
}

/** Backing out. The same two notes, falling. */
export function menuBack(sc: SynthContext, when?: number): void {
  const at = when ?? sc.ctx.currentTime;
  tone(sc, { wave: "square", freqStart: 880, duration: 0.06, gain: 0.1, when: at });
  tone(sc, { wave: "square", freqStart: 660, duration: 0.1, gain: 0.1, when: at + 0.06 });
}

/** Three… two… one… Each beep identical, so the change on "GO!" lands. */
export function countdownBeep(sc: SynthContext, when?: number): void {
  tone(sc, {
    wave: "square",
    freqStart: 880,
    duration: 0.12,
    attack: 0.004,
    decay: 0.12,
    gain: 0.16,
    when,
  });
}

/** GO! An octave above the countdown, and twice as long. */
export function goStinger(sc: SynthContext, when?: number): void {
  const at = when ?? sc.ctx.currentTime;
  tone(sc, {
    wave: "square",
    freqStart: 880,
    freqEnd: 1760,
    duration: 0.25,
    attack: 0.004,
    decay: 0.25,
    gain: 0.2,
    when: at,
  });
  noise(sc, {
    duration: 0.12,
    gain: 0.15,
    attack: 0.002,
    decay: 0.12,
    band: { type: "highpass", frequency: 2000 },
    when: at,
  });
}
