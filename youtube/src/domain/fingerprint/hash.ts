import type { Constellation } from "./peaks";
import { HOP_MS } from "./spectrogram";

/**
 * Combinatorial hashing: constellation points into packed 32-bit landmarks.
 *
 * `research/06-audio-fingerprinting.md` §1.3 is the specification. A single
 * constellation point carries about 10 bits — just its frequency — which is
 * why registering raw constellations against each other is the slow approach
 * the rest of the algorithm exists to avoid. A *pair* of points carries three
 * fields instead of one, and the paper's accounting for that trade is worth
 * restating because both halves are large:
 *
 *   - a pair is ~10^6 times more specific than a point, so an index lookup is
 *     that much narrower;
 *   - but both sides generate F times as many tokens, so the net speedup is
 *     10^6/F² — about 40,000 at our F=5;
 *   - and a pair only survives degradation if *both* its points do, so
 *     survival probability drops from p to ~p². Fan-out is what buys it back:
 *     with F targets per anchor, the chance at least one of an anchor's hashes
 *     survives is p·[1-(1-p)^F].
 *
 * §2.2's summary of the whole trade: "approximately 10 times the storage space
 * for approximately 10000 times improvement in speed, and a small loss in
 * probability of signal detection."
 */

/* ---------------------------------------------------------- the 32 bits -- */

/**
 * §1.4's layout, transcribed:
 *
 * ```
 * bit:   31        26 25          17 16           8 7            0
 *       [ reserved 6 ][  freq1  9  ][  freq2  9   ][   Δt   8    ]
 *         (0, spare)   bin index      bin index      hops forward
 *                       1–511          1–511          1–255
 * ```
 *
 * Absolute f1 and absolute f2, following the paper's own diagram, rather than
 * audfprint's delta encoding (`F1_BITS=8`, `DF_BITS=6` signed, `DT_BITS=6`).
 * The delta form is narrower and would leave more room to spare; it was
 * rejected because it buys nothing we need — we are not short of bits — and it
 * puts a signed field in the middle of a packed integer, which is one more
 * place for a sign to go wrong (see below, where we already have one).
 *
 * Frequency is a **raw linear FFT bin index**, exactly as both the paper and
 * the patent do. A log/mel/chroma axis is Chromaprint's approach and §2
 * contrasts it deliberately: it buys octave-invariance and costs the
 * fine-grained specificity that makes a short excerpt findable inside a long
 * upload, which is our whole problem.
 *
 * Δt is in **integer hop units**, not milliseconds, so it is quantised by the
 * STFT's own time resolution and cannot drift against it.
 */
const FREQ1_SHIFT = 17;
const FREQ2_SHIFT = 8;
const FREQ_MASK = 0x1ff;
const DT_MASK = 0xff;

/** Bins 1..511. Bin 0 (DC) and bin 512 (Nyquist) are excluded by `pickPeaks`;
 * that exclusion is what makes 511 values fit in 9 bits (§1.4). */
export const MIN_BIN = 1;
export const MAX_BIN = 511;

/**
 * Δt ∈ [1, 255] hops ≈ [46 ms, 11.8 s] (§3's target zone).
 *
 * The lead is 1 hop, not 0. §1.3 gives the lead's purpose as avoiding pairs
 * "too close to carry independent information", and Δt = 0 is the degenerate
 * case of that: two peaks in the same frame encode no time relationship at all,
 * and the pair would be generated identically from either end.
 */
export const MIN_DT_HOPS = 1;
export const MAX_DT_HOPS = 255;

/**
 * The fan-out F: how many target-zone points each anchor is paired with (§3).
 *
 * 5, matching dejavu's current default. §1.3 notes that F > 10 is where
 * `p·[1-(1-p)^F] ≈ p` — where fan-out fully restores single-point survival —
 * and we are deliberately below it. The reason is that the paper's F=10 is
 * sized for a 5–15 second phone capture, where the anchor set is small and each
 * anchor has to carry its weight. Our queries are whole uploaded videos: a
 * 10-minute upload offers roughly 18,000 anchors, so temporal redundancy
 * supplies the survivability that fan-out would otherwise have to, and F=5
 * halves both the index and the per-query lookup count against F=10.
 *
 * §3's arithmetic at these numbers: 30 peaks/s × 5 = 150 hashes/s, i.e. 9,000
 * per minute of registered audio.
 */
export const FAN_OUT = 5;

/**
 * Pack (f1, f2, Δt) into the 26 meaningful bits of a 32-bit word.
 *
 * **The sign decision, and why this is the safe half of it.** Postgres `integer`
 * is signed 32-bit, and `fingerprints.hash` is an `integer`. A layout that used
 * bit 31 would produce values JavaScript reports as positive (`>>> 0`) and
 * Postgres stores as negative — and any inconsistency between the two, on
 * either the write path or the query path, yields an index that works perfectly
 * for half the hash space and silently misses the other half. Half of all
 * matches, gone, with no error anywhere.
 *
 * We keep the packed value inside 26 bits, so bit 31 is never set and the value
 * is identical read as signed or unsigned. That is the safe option of the two
 * §1.4 leaves open, and it costs nothing: the 6 high bits are already reserved
 * by the layout for a future scheme selector.
 *
 * Keeping the layout narrow is *not* the same as being sign-safe, though, so
 * `content-id.ts` still converts explicitly in both directions and is tested
 * with the top bit set. Should those 6 reserved bits ever be used, the storage
 * layer is already correct; only this function would change.
 */
export function packHash(freq1: number, freq2: number, dtHops: number): number {
  return (
    ((freq1 & FREQ_MASK) << FREQ1_SHIFT) |
    ((freq2 & FREQ_MASK) << FREQ2_SHIFT) |
    (dtHops & DT_MASK)
  );
}

export interface UnpackedHash {
  readonly freq1: number;
  readonly freq2: number;
  readonly dtHops: number;
}

/** Inverse of {@link packHash}. `>>>` throughout, so a value that arrived from
 * Postgres with its sign bit set still unpacks its own fields correctly. */
export function unpackHash(hash: number): UnpackedHash {
  return {
    freq1: (hash >>> FREQ1_SHIFT) & FREQ_MASK,
    freq2: (hash >>> FREQ2_SHIFT) & FREQ_MASK,
    dtHops: hash & DT_MASK,
  };
}

/* ----------------------------------------------------------- the pairing -- */

export interface Landmarks {
  /** Packed hashes, one per (anchor, target) pair. */
  readonly hashes: Int32Array;
  /**
   * The **anchor's absolute time**, in milliseconds from the start of the
   * audio, parallel to `hashes`.
   *
   * Stored alongside the hash and deliberately not inside it — §1.3, point 4:
   * "the absolute time is not a part of the hash itself." That is the entire
   * reason the scheme works on excerpts: the hash of a sound is the same
   * wherever it occurs, and where it occurred is a separate column that the
   * offset histogram subtracts away.
   */
  readonly offsetsMs: Int32Array;
}

export interface PairingOptions {
  readonly fanOut?: number;
  readonly minDtHops?: number;
  readonly maxDtHops?: number;
  readonly hopMs?: number;
  /**
   * Milliseconds to add to every anchor time, for a spectrogram that did not
   * start at sample 0. Used by the sub-hop query analysis in `index.ts`, where
   * frame 0 of the third pass is 23.2 ms into the audio rather than at its
   * start — without this the shifted passes would all claim to be at time zero
   * and their offsets would disagree with each other by exactly the thing they
   * exist to correct.
   */
  readonly originMs?: number;
}

/**
 * Pair each anchor with the points in its target zone and emit one hash per
 * pair.
 *
 * The target zone is §1.3's {(t,f) : t ∈ [t0+L, t0+L+W]} with L = 1 hop and
 * W = 254 hops, and **unbounded in frequency** — the F that bounds the zone in
 * frequency is left open because our hash stores absolute f2 rather than a
 * delta (§1.4), so there is no narrow field for a large jump to overflow. A
 * frequency bound would only discard pairs, and a pair spanning a wide interval
 * is if anything *more* distinctive than a narrow one.
 *
 * Targets are taken in time order, nearest first, up to `fanOut` of them. That
 * is dejavu's behaviour and it follows from the zone being far wider (254 hops)
 * than the fan-out can consume at our density: the zone's far end is reached
 * only where peaks are sparse, which is exactly where it should be.
 */
export function pairConstellation(
  constellation: Constellation,
  options: PairingOptions = {},
): Landmarks {
  const fanOut = options.fanOut ?? FAN_OUT;
  const minDt = options.minDtHops ?? MIN_DT_HOPS;
  const maxDt = options.maxDtHops ?? MAX_DT_HOPS;
  const hopMs = options.hopMs ?? HOP_MS;
  const originMs = options.originMs ?? 0;

  const { frames, bins } = constellation;
  const count = frames.length;

  const hashes: number[] = [];
  const offsets: number[] = [];

  for (let i = 0; i < count; i++) {
    const anchorFrame = frames[i]!;
    const anchorBin = bins[i]!;
    const anchorMs = Math.round(anchorFrame * hopMs + originMs);

    let paired = 0;
    for (let j = i + 1; j < count && paired < fanOut; j++) {
      const dt = frames[j]! - anchorFrame;
      if (dt < minDt) continue;
      // The list is frame-ascending, so the first target past the zone ends the
      // search for this anchor rather than merely being skipped.
      if (dt > maxDt) break;
      hashes.push(packHash(anchorBin, bins[j]!, dt));
      offsets.push(anchorMs);
      paired++;
    }
  }

  return { hashes: Int32Array.from(hashes), offsetsMs: Int32Array.from(offsets) };
}
