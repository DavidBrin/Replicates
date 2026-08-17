/**
 * Content ID — landmark audio fingerprinting.
 *
 * Wang's ISMIR 2003 algorithm, implemented from
 * `research/06-audio-fingerprinting.md`, which reads the paper alongside the
 * companion patent (US 6,990,453 B2) because the paper deliberately omits every
 * numeric constant the implementation needs — it never states a window
 * function, a window size, or a hop.
 *
 * The pipeline, one module per stage:
 *
 *   fft.ts          radix-2 Cooley-Tukey, and the Hann window (§4)
 *   spectrogram.ts  mono PCM at 11025 Hz -> STFT, 1024/512 (§3)
 *   peaks.ts        local maxima + density quota -> constellation (§1.2)
 *   hash.ts         anchor x target zone -> packed 32-bit landmarks (§1.3, §1.4)
 *   match.ts        offset histogram -> a score that is a count (§1.5)
 *
 * **What this does not do, by design.** It will not match a pitch-shifted or
 * sped-up re-upload. §2 explains the mechanism rather than leaving it as a
 * disappointment: a hash is the exact quantised triple (f1, f2, Δt), and any
 * multiplicative rescale of the frequency or time axis moves every one of those
 * bin indices, so the query's hashes and the reference's hashes stop being
 * *equal* and the index lookup misses. No threshold tuning reaches it; the keys
 * themselves have diverged. The documented fixes are to search several
 * pre-shifted variants (multiplying index size by the variant count) or to
 * change to a representation where a pitch shift is a translation rather than a
 * rescale (Chromaprint's chroma axis), and both are out of scope here. The
 * limitation is asserted as expected behaviour in `__tests__/match.test.ts`, so
 * that it is a known boundary rather than a surprise.
 */

import { pairConstellation, type Landmarks, type PairingOptions } from "./hash";
import { pickPeaks, type PeakOptions } from "./peaks";
import {
  HOP_MS,
  HOP_SIZE,
  SAMPLE_RATE,
  stft,
  type StftOptions,
} from "./spectrogram";

export { fft, hannWindow, powerSpectrum } from "./fft";
export {
  BIN_COUNT,
  FFT_SIZE,
  HOP_MS,
  HOP_SIZE,
  SAMPLE_RATE,
  binToHz,
  frameToMs,
  hzToBin,
  stft,
  type Spectrogram,
} from "./spectrogram";
export {
  NEIGHBOURHOOD_BINS,
  NEIGHBOURHOOD_FRAMES,
  PEAK_DENSITY_PER_SECOND,
  RANK_WINDOW_FRAMES,
  peakDensity,
  pickPeaks,
  type Constellation,
} from "./peaks";
export {
  FAN_OUT,
  MAX_BIN,
  MAX_DT_HOPS,
  MIN_BIN,
  MIN_DT_HOPS,
  packHash,
  pairConstellation,
  unpackHash,
  type Landmarks,
  type UnpackedHash,
} from "./hash";
export {
  MATCH_SCORE_THRESHOLD,
  OFFSET_BUCKET_MS,
  OFFSET_BUCKET_TOLERANCE,
  buildIndex,
  matchAgainstIndex,
  type MatchCandidate,
  type MatchOptions,
  type Posting,
} from "./match";

export interface Fingerprint extends Landmarks {
  /** Length of the analysed audio. What `reference_works.duration_seconds`
   * and a claim's end-of-span clamp are derived from. */
  readonly durationMs: number;
}

export interface ShiftOptions {
  /**
   * How many sub-hop alignments to analyse the audio at. 1 for a reference
   * work; {@link QUERY_SHIFTS} for a query. See {@link QUERY_SHIFTS}.
   */
  readonly shifts?: number;
}

export type FingerprintOptions = StftOptions &
  PeakOptions &
  PairingOptions &
  ShiftOptions;

/**
 * A query is analysed at four sub-hop alignments; a reference at one.
 *
 * **This is the largest correction the implementation makes to a naive reading
 * of the papers, and it is here because it was measured.** A reference work is
 * analysed on an STFT grid starting at its own sample 0. A query is a clip cut
 * from an arbitrary *sample* offset inside some upload, so its grid is
 * displaced from the reference's by anywhere in [0, 512) samples. Both sides
 * then analyse the same audio through windows that do not line up.
 *
 * What that costs, measured on a 10-second excerpt of a synthetic track against
 * its own reference, single-pass on both sides, varying only the excerpt's
 * start sample:
 *
 *   displacement    hashes matching, time-aligned
 *   0 samples       1389  (98% of the query's tokens)
 *   128 samples      375  (27%)
 *   256 samples      194  (14%)
 *   341 samples      262  (19%)
 *
 * A factor of seven, from nothing but where the cut fell. The mechanism is
 * §1.4's Δt field: a peak whose analysis window moves half a hop can be picked
 * one frame earlier or later, and Δt is a *difference* of two frame indices, so
 * one displaced endpoint changes the hash and the equality lookup misses. The
 * anchor's own displacement is harmless — the offset histogram subtracts it —
 * but Δt is inside the key.
 *
 * Shazam does not have this problem because the patent's embodiment hops 64
 * samples (93.75% overlap), so its time quantisation is fine enough that
 * displacement rarely crosses a frame boundary. §3 rejected that hop for us at
 * eight times the compute. Analysing the *query* at four alignments buys the
 * same robustness on the side that is cheap: the index is untouched, and the
 * worst displacement any pass sees falls from 256 samples to 64.
 *
 * The same technique is `--shifts` in audfprint (§1.1's third implementation),
 * which is where the shape of the fix comes from; the numbers above are ours.
 *
 * One honest consequence for the score. The four passes overlap, so a single
 * audio event can contribute a matching token from more than one pass, and the
 * score is therefore not a count of *distinct* events. It remains exactly what
 * §2.3 defines — "the number of matching, time-aligned hash tokens" — over the
 * token set this pipeline actually generates, and `MATCH_SCORE_THRESHOLD` is
 * calibrated against that same pipeline on both the true-positive and the
 * false-positive side. Changing this constant invalidates that calibration.
 */
export const QUERY_SHIFTS = 4;

/**
 * PCM in, landmarks out.
 *
 * `samples` must already be **mono at 11025 Hz**. Decoding, downmixing and
 * resampling are deliberately not this module's job: §5 shows they are done in
 * three different places by three different mechanisms depending on where the
 * pipeline runs — `AudioDecoder` in a Worker (the only decoder available there,
 * since `OfflineAudioContext` is Window-scoped), `decodeAudioData` on the main
 * thread, `node-web-audio-api` on the server — and none of them belongs inside
 * a pure DSP module that a test can drive with a generated array.
 */
export function fingerprint(
  samples: Float32Array | Float64Array,
  options: FingerprintOptions = {},
): Fingerprint {
  const sampleRate = options.sampleRate ?? SAMPLE_RATE;
  const hop = options.hop ?? HOP_SIZE;
  const hopMs = options.hopMs ?? (hop / sampleRate) * 1000;
  const shifts = Math.max(1, Math.round(options.shifts ?? 1));

  const hashes: number[] = [];
  const offsetsMs: number[] = [];
  for (let pass = 0; pass < shifts; pass++) {
    const startSample = Math.round((pass * hop) / shifts);
    const window = startSample === 0 ? samples : samples.subarray(startSample);
    const spectrogram = stft(window, options);
    const constellation = pickPeaks(spectrogram, options);
    const landmarks = pairConstellation(constellation, {
      ...options,
      hopMs,
      originMs: (startSample * 1000) / sampleRate,
    });
    for (let i = 0; i < landmarks.hashes.length; i++) {
      hashes.push(landmarks.hashes[i]!);
      offsetsMs.push(landmarks.offsetsMs[i]!);
    }
  }

  return {
    hashes: Int32Array.from(hashes),
    offsetsMs: Int32Array.from(offsetsMs),
    durationMs: Math.round((samples.length * 1000) / sampleRate),
  };
}

/** The hop duration the offset histogram buckets on, re-exported so a caller
 * that only imports the barrel does not have to reach into `spectrogram`. */
export const FINGERPRINT_HOP_MS = HOP_MS;
