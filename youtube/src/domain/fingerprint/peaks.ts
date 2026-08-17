import type { Spectrogram } from "./spectrogram";
import { HOP_MS } from "./spectrogram";

/**
 * Spectral peak picking — the constellation map.
 *
 * `research/06-audio-fingerprinting.md` §1.2 defines the stage twice, once
 * loosely and once precisely, and both halves matter:
 *
 *   - the patent's test: a point at (t0, f0) survives "if it is the
 *     maximum-energy point within a rectangle with corners (t0±T, f0±F)";
 *   - the paper's constraint: candidates are additionally chosen "according to
 *     a density criterion" so the plane has "reasonably uniform coverage", and
 *     by amplitude within each locality, "with the justification that the
 *     highest amplitude peaks are most likely to survive" degradation.
 *
 * So this file is two filters, and it is worth being explicit about which does
 * what. The rectangle is a **de-duplicator**: one spectral event smears across
 * a dozen adjacent cells and the rectangle collapses it to one. The density
 * quota is the **rate control**: it decides how many peaks per second reach the
 * hasher. Sizing the rectangle to hit the target density directly — the obvious
 * one-filter design — was rejected because it couples the two: shrink the
 * rectangle to raise the rate and near-duplicates of one loud event start
 * winning slots that a quieter distinct event should have had.
 *
 * Amplitude is discarded after this file. §2.1: "at this point the amplitude
 * component has been eliminated." A peak is a (frame, bin) coordinate, and that
 * is the whole reason gain changes are a non-issue for the algorithm rather
 * than merely something it survives (§2).
 */

/**
 * ±5 frames × ±5 bins — the rectangle of §1.2. In physical units, ±232 ms and
 * ±54 Hz.
 *
 * Sized to the extent of a single spectral event, which is what a de-duplicator
 * should be sized to. A tone occupies a three-bin main lobe under a Hann window
 * (asserted in `__tests__/fft.test.ts`), and an onset smears across about two
 * frames at a 1024-sample window with 50% overlap. ±5 is two to three times
 * that in both axes: comfortably enough to collapse one event, and not so wide
 * that it swallows a neighbouring one.
 *
 * **dejavu's `PEAK_NEIGHBORHOOD_SIZE = 10` was the first candidate and was
 * measured to be wrong for this pipeline.** The value looked ideal on paper:
 * dejavu analyses at 4096/2048 over 44100 Hz and we analyse at 1024/512 over
 * 11025 Hz, which is the *same* 46.44 ms and 10.77 Hz resolution (see
 * `spectrogram.ts`), so 10 should transfer with no conversion at all. Two
 * things break that:
 *
 *   - dejavu dilates a **diamond** (`generate_binary_structure(2,1)` iterated
 *     ten times, 221 cells); §1.2's patent language and this implementation use
 *     a **rectangle**, and a ±10 rectangle is 441 cells — twice as suppressive
 *     for the same nominal radius.
 *   - ±10 bins is ±108 Hz, which suppresses the second harmonic of any
 *     fundamental below 108 Hz. Bass lines lose their partials.
 *
 * Measured across the 40-track calibration corpus, candidates per second before
 * the quota and peaks per second after it:
 *
 *   ±10 . . . 23.0 -> 22.8      the quota removes almost nothing
 *   ±5  . . . 74.6 -> 33.5      the quota is what sets the rate
 *
 * The top row is the failure. At ±10 the rectangle alone already emits fewer
 * candidates than the 30/s target, so the density quota never binds, the
 * two-filter design silently collapses into one, and `PEAK_DENSITY_PER_SECOND`
 * becomes a number that documents nothing. End to end that is the difference
 * between a 10-second excerpt at +6 dB SNR scoring 0 for the worst track in the
 * corpus and scoring 45.
 */
export const NEIGHBOURHOOD_FRAMES = 5;
export const NEIGHBOURHOOD_BINS = 5;

/**
 * ~30 peaks per second (§3).
 *
 * §1.2 gives the patent's rule of thumb as 5–10 landmarks/s and audfprint's
 * range as 20–70/s (default 20, MIREX-tuned 70). §3 places us at 30: our
 * queries are whole uploaded videos rather than 5–15 s phone captures, so
 * temporal redundancy is abundant and the density does not have to carry the
 * whole robustness budget, but our source has been through a transcode and a
 * loudness pass so it is not the pristine "radio monitoring" case either.
 *
 * The cost of raising it is quadratic-ish in the wrong direction: hashes/sec is
 * density × fan-out (§3), so 60/s would double the index *and* double the
 * per-query lookups, for peaks that are by construction the quieter ones — the
 * ones §1.2 says are least likely to survive degradation anyway.
 */
export const PEAK_DENSITY_PER_SECOND = 30;

/**
 * The density quota is enforced over a sliding ±0.5 s window, not over a fixed
 * grid of one-second buckets.
 *
 * This is the single most important reproducibility decision in the file, and
 * the reason is the excerpt case (§8): a query is a clip cut from an arbitrary
 * sample offset inside a reference. A fixed bucket grid would land in different
 * places relative to the audio in the query than in the reference, so the
 * "top 30 in this bucket" decision would be taken over different sets of
 * candidates on the two sides, and peaks would drop out along every bucket
 * seam. A window centred on the candidate itself moves with the audio, so the
 * decision is translation-invariant: identical on both sides except within half
 * a window of the excerpt's own ends.
 */
export const RANK_WINDOW_FRAMES = Math.round(500 / HOP_MS);

/** A constellation point. Coordinates only — amplitude is gone by now (§2.1). */
export interface Constellation {
  /** STFT frame index of each peak, ascending, ties broken by bin. */
  readonly frames: Int32Array;
  /** FFT bin index of each peak, always in [1, 511] — see `pickPeaks`. */
  readonly bins: Int32Array;
}

export interface PeakOptions {
  readonly neighbourhoodFrames?: number;
  readonly neighbourhoodBins?: number;
  readonly densityPerSecond?: number;
  readonly rankWindowFrames?: number;
}

/**
 * Find the constellation.
 *
 * Bins 0 (DC) and 512 (Nyquist) are excluded from the analysis entirely, not
 * merely from the output. §1.4 drops them from the hash's frequency field —
 * "both are near-zero energy for music/speech" — which leaves exactly 511
 * usable bins and is what makes 9 bits sufficient. Excluding them *before* the
 * maximum filter rather than after matters: a DC offset in the input puts
 * enormous energy in bin 0, and a bin-0 candidate left in the filter would
 * suppress every real peak within ten bins of it.
 *
 * **No absolute amplitude floor**, which is where this departs from dejavu
 * (`amp_min = 10` dB). A fixed dB floor is not gain-invariant: turn a track
 * down by 12 dB and a floor set in dBFS silently deletes its quietest third.
 * §2 is explicit that level invariance is a structural property of this
 * algorithm — "amplitude is discarded entirely at the constellation-map stage"
 * — and a dBFS floor would quietly trade it away. Everything here is ordinal
 * instead, so scaling the input by a constant cannot change any decision.
 * Digital silence is handled by the total order below rather than by a floor:
 * a run of identical values has exactly one winner, so silence contributes at
 * most one candidate per rectangle instead of all of them.
 */
export function pickPeaks(
  spectrogram: Spectrogram,
  options: PeakOptions = {},
): Constellation {
  const { power, frameCount, bins, hop, sampleRate } = spectrogram;
  const tFrames = options.neighbourhoodFrames ?? NEIGHBOURHOOD_FRAMES;
  const fBins = options.neighbourhoodBins ?? NEIGHBOURHOOD_BINS;
  const density = options.densityPerSecond ?? PEAK_DENSITY_PER_SECOND;
  const rankWindow = options.rankWindowFrames ?? RANK_WINDOW_FRAMES;

  const binLo = 1;
  const binHi = bins - 2;
  if (frameCount === 0 || binHi < binLo) {
    return { frames: new Int32Array(0), bins: new Int32Array(0) };
  }

  const rectWinner = rectangleArgmax(
    power,
    frameCount,
    bins,
    binLo,
    binHi,
    tFrames,
    fBins,
  );

  // A cell is a candidate iff it won its own rectangle.
  const candidates: number[] = [];
  for (let frame = 0; frame < frameCount; frame++) {
    const row = frame * bins;
    for (let bin = binLo; bin <= binHi; bin++) {
      const index = row + bin;
      if (rectWinner[index] === index && power[index]! > 0) candidates.push(index);
    }
  }

  // Frames per rank window, converted to the quota that window may pass. The
  // window spans 2*rankWindow+1 frames; at `density` peaks per second that is
  // `density * windowSeconds` slots.
  const framesPerSecond = sampleRate / hop;
  const windowSeconds = (2 * rankWindow + 1) / framesPerSecond;
  const quota = Math.max(1, Math.round(density * windowSeconds));

  const kept = applyDensityQuota(candidates, power, bins, rankWindow, quota);

  const frames = new Int32Array(kept.length);
  const binOut = new Int32Array(kept.length);
  for (let i = 0; i < kept.length; i++) {
    const index = kept[i]!;
    frames[i] = (index / bins) | 0;
    binOut[i] = index % bins;
  }
  return { frames, bins: binOut };
}

/* ------------------------------------------------------- the two filters -- */

/**
 * `power[a] > power[b]`, with ties broken by index so the order is total.
 *
 * The tie-break is not decoration. A sliding maximum over a partially-ordered
 * key has no unique winner on a plateau, so a region of exactly equal values —
 * digital silence, or a synthetic tone whose period divides the hop, which is
 * precisely what a test signal looks like — would report *every* cell in the
 * plateau as a local maximum. Comparing (power, -index) lexicographically makes
 * the winner unique by construction and costs one branch that almost never
 * fires.
 */
function better(power: Float64Array, a: number, b: number): boolean {
  const pa = power[a]!;
  const pb = power[b]!;
  return pa > pb || (pa === pb && a < b);
}

/**
 * For every cell, the index of the largest cell in its (±tFrames, ±fBins)
 * rectangle.
 *
 * Separably, in two linear passes with a monotonic deque, rather than by
 * scanning the rectangle per cell. The naive form is O(cells · (2T+1)(2F+1)) —
 * 291 million comparisons for a minute of audio at our neighbourhood size,
 * which the calibration suite would run several thousand times. Max is
 * associative, so a rectangle max is a max of row maxima, and each pass is
 * O(cells) regardless of radius.
 */
function rectangleArgmax(
  power: Float64Array,
  frameCount: number,
  bins: number,
  binLo: number,
  binHi: number,
  tFrames: number,
  fBins: number,
): Int32Array {
  const rowWinner = new Int32Array(frameCount * bins).fill(-1);
  const deque = new Int32Array(Math.max(frameCount, bins));

  // Pass 1 — along frequency, within each frame.
  for (let frame = 0; frame < frameCount; frame++) {
    const row = frame * bins;
    let head = 0;
    let tail = 0;
    let next = binLo;
    for (let bin = binLo; bin <= binHi; bin++) {
      const windowHi = Math.min(binHi, bin + fBins);
      for (; next <= windowHi; next++) {
        const index = row + next;
        while (tail > head && better(power, index, deque[tail - 1]!)) tail--;
        deque[tail++] = index;
      }
      const windowLo = row + Math.max(binLo, bin - fBins);
      while (deque[head]! < windowLo) head++;
      rowWinner[row + bin] = deque[head]!;
    }
  }

  // Pass 2 — along time, within each bin, over the pass-1 winners.
  const winner = new Int32Array(frameCount * bins).fill(-1);
  for (let bin = binLo; bin <= binHi; bin++) {
    let head = 0;
    let tail = 0;
    let next = 0;
    for (let frame = 0; frame < frameCount; frame++) {
      const windowHi = Math.min(frameCount - 1, frame + tFrames);
      for (; next <= windowHi; next++) {
        const candidate = rowWinner[next * bins + bin]!;
        while (tail > head && better(power, candidate, deque[tail - 1]!)) tail--;
        deque[tail++] = candidate;
      }
      const windowLo = Math.max(0, frame - tFrames);
      // The deque holds cell indices, whose frame is index/bins. Dropping by
      // frame rather than by index is what keeps the two passes composable.
      while (((deque[head]! / bins) | 0) < windowLo) head++;
      winner[frame * bins + bin] = deque[head]!;
    }
  }

  return winner;
}

/**
 * Keep a candidate only if it is among the `quota` strongest candidates within
 * ±`rankWindow` frames of itself.
 *
 * This is §1.2's "chosen by amplitude within each locality" and its density
 * criterion in one test. The window is centred on the candidate — see
 * `RANK_WINDOW_FRAMES` for why that, and not a bucket grid, is the whole
 * difference between an excerpt matching and an excerpt matching only in
 * patches.
 */
function applyDensityQuota(
  candidates: readonly number[],
  power: Float64Array,
  bins: number,
  rankWindow: number,
  quota: number,
): number[] {
  const kept: number[] = [];
  // `candidates` is in frame-major order, so both window edges only advance.
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < candidates.length; i++) {
    const index = candidates[i]!;
    const frame = (index / bins) | 0;
    while (lo < candidates.length && ((candidates[lo]! / bins) | 0) < frame - rankWindow) lo++;
    while (hi < candidates.length && ((candidates[hi]! / bins) | 0) <= frame + rankWindow) hi++;

    let stronger = 0;
    for (let j = lo; j < hi; j++) {
      if (j !== i && better(power, candidates[j]!, index)) {
        stronger++;
        if (stronger >= quota) break;
      }
    }
    if (stronger < quota) kept.push(index);
  }
  return kept;
}

/** Peaks per second — what `PEAK_DENSITY_PER_SECOND` is a target for. */
export function peakDensity(
  constellation: Constellation,
  spectrogram: Spectrogram,
): number {
  const seconds = (spectrogram.frameCount * spectrogram.hop) / spectrogram.sampleRate;
  return seconds > 0 ? constellation.frames.length / seconds : 0;
}
