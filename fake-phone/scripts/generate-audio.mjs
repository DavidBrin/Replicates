/**
 * Generates the app's sound assets as real WAV files, with no dependencies.
 *
 * Why generate instead of ship a file: we cannot use Apple's "Reflection" or
 * any Android system tone — they are copyrighted, and a safety app that gets
 * pulled from a store helps nobody (SPEC §6, research/ios-call-ui.md §6). So
 * every sound in this repo is an original additive-synthesis composition,
 * reproducible from this script, with zero licensing exposure and zero runtime
 * network fetches.
 *
 * Everything here is written by hand against the RIFF/WAVE spec: a 44-byte
 * header (`RIFF` size `WAVE` / `fmt ` / `data`) followed by little-endian
 * signed 16-bit PCM samples. Node ships `Buffer`, which is all that needs.
 *
 * Usage: node scripts/generate-audio.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "audio");

const SAMPLE_RATE = 44_100;

/* ------------------------------------------------------------------ wave -- */

/**
 * Encodes a mono float signal (nominally -1..1) as a 16-bit PCM WAV.
 *
 * Mono on purpose: the ringtone is the largest asset in the app and a stereo
 * image is worthless for a sound that is meant to come out of a phone speaker
 * held at arm's length. Mono halves the bytes a first-time visitor downloads
 * before the app can ring, which is the only latency that matters here.
 */
function encodeWav(samples) {
  const bytesPerSample = 2;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4); // size of everything after this field
  buffer.write("WAVE", 8, "ascii");

  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // fmt chunk size for PCM
  buffer.writeUInt16LE(1, 20); // audio format: 1 = PCM (uncompressed)
  buffer.writeUInt16LE(1, 22); // channels
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(bytesPerSample, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample

  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < samples.length; i += 1) {
    // Clamp before scaling: a value past ±1 would wrap around the 16-bit range
    // and turn a loud note into a burst of digital noise.
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32_767), 44 + i * bytesPerSample);
  }

  return buffer;
}

const seconds = (n) => Math.round(n * SAMPLE_RATE);

/** Scales the whole signal so its loudest moment sits at `peak`. */
function normalize(samples, peak) {
  let loudest = 0;
  for (const sample of samples) loudest = Math.max(loudest, Math.abs(sample));
  if (loudest === 0) return samples;
  const gain = peak / loudest;
  for (let i = 0; i < samples.length; i += 1) samples[i] *= gain;
  return samples;
}

/** Ramps the first and last few ms to zero so a loop seam never clicks. */
function deClick(samples, fadeInMs, fadeOutMs) {
  const fadeIn = seconds(fadeInMs / 1000);
  const fadeOut = seconds(fadeOutMs / 1000);
  for (let i = 0; i < fadeIn && i < samples.length; i += 1) samples[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut && i < samples.length; i += 1) {
    samples[samples.length - 1 - i] *= i / fadeOut;
  }
  return samples;
}

/* -------------------------------------------------------------- synthesis -- */

/**
 * One struck-bar note, built by additive synthesis.
 *
 * A marimba bar is not a harmonic series — its overtones sit at roughly 4× and
 * 10× the fundamental, and they die away far faster than the fundamental does.
 * Reproducing that (rather than stacking clean octaves) is what stops this
 * sounding like a synthesiser beep: the partials below are slightly detuned
 * from whole-number ratios so the attack shimmers, and each carries its own
 * exponential decay so the tone darkens as it rings out, exactly like a struck
 * wooden bar does.
 */
const PARTIALS = [
  { ratio: 1.0, amp: 1.0, decay: 0.62 },
  { ratio: 2.005, amp: 0.26, decay: 0.34 },
  { ratio: 3.94, amp: 0.2, decay: 0.24 },
  { ratio: 6.02, amp: 0.08, decay: 0.16 },
  { ratio: 9.85, amp: 0.05, decay: 0.1 },
];

/** Adds a note into `out` at `startSec`. Mutates `out`. */
function strike(out, startSec, freq, velocity, ringSec = 1.1) {
  const start = seconds(startSec);
  const length = seconds(ringSec);
  // A 5ms attack: instant enough to read as a strike, slow enough that the
  // waveform starts from silence instead of a step discontinuity (a click).
  const attack = seconds(0.005);

  for (let i = 0; i < length; i += 1) {
    const index = start + i;
    if (index >= out.length) break;
    const t = i / SAMPLE_RATE;
    const attackGain = i < attack ? i / attack : 1;

    let sample = 0;
    for (const partial of PARTIALS) {
      sample += partial.amp * Math.exp(-t / partial.decay) * Math.sin(2 * Math.PI * freq * partial.ratio * t);
    }
    out[index] += sample * velocity * attackGain * 0.2;
  }
}

/** A plain sine tone with a fast attack and exponential decay. */
function tone(out, startSec, freq, durationSec, velocity, decay = 0.09) {
  const start = seconds(startSec);
  const length = seconds(durationSec);
  const attack = seconds(0.008);

  for (let i = 0; i < length; i += 1) {
    const index = start + i;
    if (index >= out.length) break;
    const t = i / SAMPLE_RATE;
    const attackGain = i < attack ? i / attack : 1;
    // A gentle release over the last 20% keeps the tail from ending on a step.
    const release = i > length * 0.8 ? (length - i) / (length * 0.2) : 1;
    out[index] += Math.sin(2 * Math.PI * freq * t) * Math.exp(-t / decay) * velocity * attackGain * release;
  }
}

/* ---------------------------------------------------------------- assets -- */

// A major pentatonic. Pentatonic because it has no semitone clashes, so the
// overlapping tails of a fast arpeggio never sound sour — and because a warm,
// unresolved shape draws attention without the alarm-clock urgency of a minor
// or dissonant interval. This has to be audible across a street without making
// the person holding the phone feel worse.
const A4 = 440;
const CS5 = 554.365;
const E5 = 659.255;
const A5 = 880;

/**
 * ~4s loopable ringtone: two ring bursts with a gap, the way a real ring
 * cadence works. The gap matters — a continuous arpeggio reads as music, two
 * spaced bursts read as a phone.
 *
 * The loop seam is designed, not hoped for: the last note starts at 2.75s and
 * its longest partial is inaudible well before 4.0s, so the tail has fully
 * decayed into silence before the element wraps around and the loop is
 * seamless without a crossfade.
 */
function buildRingtone() {
  const out = new Float64Array(seconds(4));

  // Up and back down, which gives the burst a shape rather than a run.
  const figure = [
    { at: 0.0, freq: A4, velocity: 0.9 },
    { at: 0.15, freq: CS5, velocity: 0.78 },
    { at: 0.3, freq: E5, velocity: 0.85 },
    { at: 0.45, freq: A5, velocity: 1.0 },
    { at: 0.6, freq: E5, velocity: 0.62 },
    { at: 0.75, freq: CS5, velocity: 0.55 },
  ];

  for (const burstStart of [0.0, 2.0]) {
    for (const note of figure) {
      strike(out, burstStart + note.at, note.freq, note.velocity);
    }
    // A soft octave-below sine under the first note of each burst gives the
    // burst a body that survives a tinny phone speaker, where the fundamental
    // of a 440Hz bell is most of what gets thrown away.
    tone(out, burstStart, A4 / 2, 0.5, 0.18, 0.2);
  }

  return deClick(normalize(out, 0.78), 6, 40);
}

/** ~200ms two-tone rising blip: "the other end picked up". */
function buildConnect() {
  const out = new Float64Array(seconds(0.2));
  tone(out, 0.0, 660, 0.08, 0.6, 0.05);
  tone(out, 0.085, 990, 0.11, 0.7, 0.06);
  return deClick(normalize(out, 0.55), 4, 25);
}

/** ~400ms descending two-tone: the classic hang-up cue. */
function buildDisconnect() {
  const out = new Float64Array(seconds(0.4));
  tone(out, 0.0, 620, 0.17, 0.7, 0.13);
  tone(out, 0.18, 460, 0.22, 0.7, 0.16);
  return deClick(normalize(out, 0.55), 4, 40);
}

/* ------------------------------------------------------------------ main -- */

mkdirSync(OUT_DIR, { recursive: true });

const assets = [
  { name: "ringtone.wav", samples: buildRingtone() },
  { name: "connect.wav", samples: buildConnect() },
  { name: "disconnect.wav", samples: buildDisconnect() },
];

for (const { name, samples } of assets) {
  const wav = encodeWav(samples);
  writeFileSync(join(OUT_DIR, name), wav);
  const durationMs = Math.round((samples.length / SAMPLE_RATE) * 1000);
  console.log(
    `wrote public/audio/${name} (${durationMs}ms, mono ${SAMPLE_RATE}Hz 16-bit, ${wav.length} bytes)`,
  );
}
