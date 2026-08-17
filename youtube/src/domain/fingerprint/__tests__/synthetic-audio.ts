import { SAMPLE_RATE } from "../spectrogram";

/**
 * Synthetic audio for the fingerprinter's suites.
 *
 * Not a test file — a fixture generator, imported by `peaks.test.ts`,
 * `match.test.ts` and the repository suite. It lives here rather than in
 * `src/adapters/repositories/__tests__/` because the domain suites are its
 * primary caller and because a sibling slice owns a `harness.ts` in that
 * directory that this slice must not touch.
 *
 * Everything is generated. There are no audio files in this repository and
 * nothing here downloads any, which is not only a licensing convenience:
 * `research/06-audio-fingerprinting.md` §8 recommends a generated corpus
 * precisely because the non-match test needs tracks that are *known* to be
 * unrelated, and "these two MP3s sound different to me" is not that.
 *
 * Every random number comes from a seeded generator. `Math.random()` would make
 * a false-positive score that appears once in fifty runs impossible to
 * reproduce, and the threshold in `match.ts` is calibrated against exactly that
 * tail.
 */

/**
 * mulberry32. Small, fast, and — the property that matters here — identical on
 * every machine and every Node version, so a calibration measured once stays
 * measured.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TrackOptions {
  readonly seconds?: number;
  readonly sampleRate?: number;
  /**
   * Force the tonal material. Two tracks built from the same `melodySeed` and
   * different `seed`s are §8's "near-duplicate but genuinely distinct" case:
   * same notes, different tempo and timbre.
   */
  readonly melodySeed?: number;
}

const SCALE = [0, 2, 4, 7, 9] as const; // major pentatonic

/**
 * A short synthesised track: a pentatonic melody over a percussive pulse.
 *
 * The shape is chosen for what peak picking needs rather than for musicality.
 * A melody gives strong, sparse, *moving* partials — the time-frequency plane
 * has structure to find local maxima in, and it changes, so the constellation
 * is not one repeated pattern that would collide with itself at every offset.
 * The percussive pulse adds broadband transients, which is where a real
 * recording's most degradation-resistant peaks come from. The noise floor
 * ensures no frame is digital silence.
 */
export function makeTrack(seed: number, options: TrackOptions = {}): Float32Array {
  const sampleRate = options.sampleRate ?? SAMPLE_RATE;
  const seconds = options.seconds ?? 20;
  const rand = mulberry32(seed);
  const melodyRand = mulberry32(options.melodySeed ?? seed);

  const n = Math.round(seconds * sampleRate);
  const out = new Float64Array(n);
  const nyquist = sampleRate / 2;

  const bpm = 84 + Math.floor(rand() * 96);
  const beat = 60 / bpm;
  const step = beat / (rand() < 0.5 ? 2 : 3);
  const root = 98 * Math.pow(2, Math.floor(rand() * 24) / 12);
  // Timbre: how fast the harmonic series rolls off. 0.6 is brassy, 2.2 is
  // nearly a sine, and the difference is what makes two tracks in the same key
  // land on different frequency bins.
  const rolloff = 0.6 + rand() * 1.6;
  const partials = 3 + Math.floor(rand() * 7);

  let degree = 0;
  for (let t = 0; t < seconds; t += step) {
    degree += Math.floor(melodyRand() * 5) - 2;
    degree = Math.max(-5, Math.min(12, degree));
    const octave = Math.floor(degree / SCALE.length);
    const idx = ((degree % SCALE.length) + SCALE.length) % SCALE.length;
    const semitones = SCALE[idx]! + 12 * octave;
    const f0 = root * Math.pow(2, semitones / 12);

    const start = Math.round(t * sampleRate);
    const length = Math.round(step * 1.9 * sampleRate);
    const decay = 1 / (step * 0.7 * sampleRate);
    for (let h = 1; h <= partials; h++) {
      const f = f0 * h;
      if (f >= nyquist * 0.98) break;
      const amp = Math.pow(h, -rolloff);
      const phase = melodyRand() * Math.PI * 2;
      const omega = (2 * Math.PI * f) / sampleRate;
      for (let i = 0; i < length; i++) {
        const s = start + i;
        if (s >= n) break;
        out[s] = out[s]! + amp * Math.exp(-i * decay) * Math.sin(omega * i + phase);
      }
    }
  }

  // Percussion: a noise burst on every beat, low-passed by a one-pole so it is
  // a thud rather than a click and therefore survives band-limiting.
  //
  // Its brightness, length and decay vary per track, and so does whether it
  // falls on every beat or every other one. That is not garnish. An earlier
  // version of this generator gave all forty tracks the *same* percussion
  // synthesis, and the leave-one-out false-positive tail reached 165 while the
  // deliberately near-duplicate melodic pairs reached only 10 — the corpus was
  // colliding on a shared drum timbre rather than on anything musical, and it
  // was the calibration corpus that was wrong rather than the matcher. §8 asks
  // for tracks that are acoustically distinct; identical percussion is not that.
  const percRand = mulberry32(seed ^ 0x5bf03635);
  const brightness = 0.45 + percRand() * 0.45;
  const burst = 0.05 + percRand() * 0.14;
  const decay = 3 + percRand() * 6;
  const everyOther = percRand() < 0.4;
  let hit = 0;
  for (let t = 0; t < seconds; t += beat, hit++) {
    if (everyOther && hit % 2 === 1) continue;
    const start = Math.round(t * sampleRate);
    const length = Math.round(burst * sampleRate);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const s = start + i;
      if (s >= n) break;
      lp = brightness * lp + (1 - brightness) * (percRand() * 2 - 1);
      out[s] = out[s]! + 0.9 * lp * Math.exp((-i / length) * decay);
    }
  }

  // A -66 dB noise floor. Not decoration: it guarantees no frame is exactly
  // zero, which is the one input shape where "is this cell larger than its
  // neighbours" has no answer.
  const floorRand = mulberry32(seed ^ 0x2545f491);
  for (let i = 0; i < n; i++) out[i] = out[i]! + 0.0005 * (floorRand() * 2 - 1);

  return normalise(out, 0.5);
}

function normalise(samples: Float64Array, target: number): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]!));
  const scale = peak > 0 ? target / peak : 1;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i]! * scale;
  return out;
}

/* --------------------------------------------------------- degradations -- */

/** A slice of a track, by sample index. §8: excerpts come from the middle. */
export function excerpt(
  samples: Float32Array,
  startSeconds: number,
  durationSeconds: number,
  sampleRate = SAMPLE_RATE,
): Float32Array {
  const start = Math.round(startSeconds * sampleRate);
  const end = Math.min(samples.length, start + Math.round(durationSeconds * sampleRate));
  return samples.slice(start, end);
}

/**
 * Additive white noise at a given SNR in dB, measured on RMS power.
 *
 * SNR = 10·log10(P_signal / P_noise), so the noise gain is
 * sqrt(P_signal / 10^(SNR/10)). §2's Figure 4 numbers — 50% recognition at
 * about -6 dB for a 10-second clip — are the yardstick the suite compares
 * against, with the caveat §8 states: our source is a clean re-encode rather
 * than a phone-mic capture of a pub, so we should do better than the paper, not
 * merely as well.
 */
export function addNoise(
  samples: Float32Array,
  snrDb: number,
  seed: number,
): Float32Array {
  const rand = mulberry32(seed);
  let power = 0;
  for (let i = 0; i < samples.length; i++) power += samples[i]! * samples[i]!;
  power /= samples.length || 1;

  const noisePower = power / Math.pow(10, snrDb / 10);
  // Uniform noise on [-1,1] has variance 1/3, so scale by sqrt(3·P).
  const gain = Math.sqrt(3 * noisePower);

  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[i]! + gain * (rand() * 2 - 1);
  }
  return out;
}

/** Multiply every sample. `0.25` and `4` are exact in binary floating point,
 * which is what lets the gain test assert an *identical* constellation rather
 * than a similar one. */
export function gain(samples: Float32Array, factor: number): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i]! * factor;
  return out;
}

/**
 * A linear-phase windowed-sinc low-pass, time-aligned.
 *
 * Linear phase, and the (taps-1)/2 samples of group delay are trimmed off the
 * front, so the output sits at the same times as the input. Without that trim
 * the band-limiting test would be measuring a time shift as well as a spectral
 * change, and a failed offset assertion would not say which.
 */
export function lowPass(
  samples: Float32Array,
  cutoffHz: number,
  sampleRate = SAMPLE_RATE,
  taps = 129,
): Float32Array {
  const half = (taps - 1) / 2;
  const fc = cutoffHz / sampleRate;
  const kernel = new Float64Array(taps);
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - half;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (taps - 1)));
    kernel[i] = sinc * window;
    sum += kernel[i]!;
  }
  for (let i = 0; i < taps; i++) kernel[i] = kernel[i]! / sum;

  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    let acc = 0;
    for (let k = 0; k < taps; k++) {
      const s = i + half - k;
      if (s >= 0 && s < samples.length) acc += kernel[k]! * samples[s]!;
    }
    out[i] = acc;
  }
  return out;
}

/**
 * Naive resampling by linear interpolation — playback-speed change, which
 * scales the time *and* frequency axes together.
 *
 * `ratio > 1` speeds up. This is the "sped up 5%" evasion §2 documents, and it
 * exists here to be asserted as a **non**-match: it is the algorithm's
 * structural blind spot, not a bug to be fixed by tuning.
 */
export function changeSpeed(samples: Float32Array, ratio: number): Float32Array {
  const length = Math.floor(samples.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const frac = pos - lo;
    const a = samples[lo] ?? 0;
    const b = samples[lo + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}
