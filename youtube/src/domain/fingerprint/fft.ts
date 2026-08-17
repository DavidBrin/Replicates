/**
 * Radix-2 iterative Cooley-Tukey FFT, and the Hann window that precedes it.
 *
 * Written rather than installed. `research/06-audio-fingerprinting.md` §4 makes
 * the case: our frame size is a power of two by construction (1024, §3), the
 * transform is thirty lines, and the alternative — a DSP package — would land
 * in a `package.json` that six other slices of this project are building
 * against simultaneously.
 *
 * The rejected browser alternative is worth naming because it is the obvious
 * one and it does not work. `AnalyserNode` looks like a free STFT and is not:
 * §4 documents four independent reasons — its output is exponentially smoothed
 * across calls by `smoothingTimeConstant`, phase is never exposed, its window
 * is a Blackman fixed by the Web Audio spec rather than the Hann we want, and
 * it is a pull API reading a ring buffer at whatever moment you happen to call
 * it rather than a driven fixed-hop transform. Any one of those disqualifies
 * it for offline landmark analysis.
 *
 * ---
 *
 * A note on the `!` assertions below. `noUncheckedIndexedAccess` types every
 * typed-array read as `number | undefined`, which is right for a `Record` and
 * wrong for a `Float64Array` whose length this file allocated itself. The
 * alternative — a guarded read per access — puts a branch in the innermost
 * loop of the hottest function in the slice. The assertions are confined to
 * loops whose bounds are derived from `.length` on the line above.
 */

/* ------------------------------------------------------------------ hann -- */

const hannCache = new Map<number, Float64Array>();

/**
 * The symmetric Hann window, w[n] = 0.5(1 - cos(2*pi*n/(N-1))).
 *
 * Symmetric, not periodic. research/06 §4 draws the distinction and picks this
 * side of it: the periodic form (2*pi*n/N) exists so that overlap-add
 * resynthesis sums to unity, and we never resynthesise — the samples go in, a
 * constellation of peak coordinates comes out, and the audio is never
 * reconstructed. For pure analysis the symmetric form is standard.
 *
 * Hann rather than rectangular or Hamming because every implementation
 * surveyed in §1.1 — the Shazam patent ("Hanning", the older name for the same
 * window), dejavu, audfprint — uses Hann and none uses anything else. The
 * mechanism matters for us specifically: peak picking asks "is this point
 * larger than its neighbours", and a rectangular window's -13 dB sidelobes
 * would plant answers to that question all over the spectrum around every loud
 * tone.
 *
 * Cached by size. The STFT calls this once per frame and there is exactly one
 * size in the pipeline, so rebuilding 1024 cosines per frame would be the
 * second-largest cost in the whole fingerprinter.
 */
export function hannWindow(size: number): Float64Array {
  const cached = hannCache.get(size);
  if (cached) return cached;

  if (size < 2) throw new Error(`Hann window needs at least 2 points, got ${size}`);

  const w = new Float64Array(size);
  const denominator = size - 1;
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denominator));
  }
  hannCache.set(size, w);
  return w;
}

/* ------------------------------------------------------------------- fft -- */

interface Tables {
  /** `rev[i]` is the bit-reversal of `i` over log2(n) bits. */
  readonly rev: Uint32Array;
  /** cos(-2*pi*j/n) for j in [0, n/2). */
  readonly cos: Float64Array;
  /** sin(-2*pi*j/n) for j in [0, n/2). */
  readonly sin: Float64Array;
}

const tableCache = new Map<number, Tables>();

/**
 * The twiddle factors and the bit-reversal permutation, built once per size.
 *
 * §4's reference implementation calls `Math.cos`/`Math.sin` inside the
 * butterfly loop — correct, and it recomputes the same n/2 distinct angles on
 * every single frame. At 1024 points and ~21.5 frames per second of audio that
 * is ~11,000 transcendental calls per second of audio, for values that never
 * change. One table per size, shared across every frame of every track, is the
 * same arithmetic with the repetition removed.
 *
 * One table of n/2 entries serves every stage: the twiddle a stage of width
 * `size` needs at step k is angle -2*pi*k/size = -2*pi*(k*n/size)/n, so it
 * lives at index k*(n/size) in the full-resolution table.
 */
function tablesFor(n: number): Tables {
  const cached = tableCache.get(n);
  if (cached) return cached;

  const rev = new Uint32Array(n);
  // The incremental construction from §4: `j` walks the bit-reversed counter
  // alongside `i` walking the natural one, so no per-index reversal is needed.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j |= bit;
    rev[i] = j;
  }

  const half = n >> 1;
  const cos = new Float64Array(half);
  const sin = new Float64Array(half);
  for (let j = 0; j < half; j++) {
    const angle = (-2 * Math.PI * j) / n;
    cos[j] = Math.cos(angle);
    sin[j] = Math.sin(angle);
  }

  const tables: Tables = { rev, cos, sin };
  tableCache.set(n, tables);
  return tables;
}

function isPowerOfTwo(n: number): boolean {
  return n >= 2 && (n & (n - 1)) === 0;
}

/**
 * In-place forward FFT, decimation in time.
 *
 * `re` and `im` are overwritten with the transform. For real audio input, `im`
 * starts as all zeros. The sign convention is the forward transform,
 * `X[k] = sum x[t] e^(-2*pi*i*k*t/N)`, which is the one §4 specifies and the
 * one that puts a sine's energy in the *negative* imaginary part.
 *
 * Throws on a bad length rather than silently producing a permuted spectrum.
 * A non-power-of-two array would run the butterfly network over a truncated
 * stage count and return something that looks like a spectrum and is not; the
 * only cheap defence is refusing the input.
 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (im.length !== n) {
    throw new Error(
      `fft: real and imaginary buffers must be the same length (${n} vs ${im.length})`,
    );
  }
  if (!isPowerOfTwo(n)) {
    throw new Error(`fft: length must be a power of two, got ${n}`);
  }

  const { rev, cos, sin } = tablesFor(n);

  for (let i = 1; i < n; i++) {
    const j = rev[i]!;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const stride = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0, twiddle = 0; k < half; k++, twiddle += stride) {
        const wr = cos[twiddle]!;
        const wi = sin[twiddle]!;
        const even = start + k;
        const odd = even + half;

        const or_ = re[odd]!;
        const oi = im[odd]!;
        const tr = or_ * wr - oi * wi;
        const ti = or_ * wi + oi * wr;

        const er = re[even]!;
        const ei = im[even]!;
        re[odd] = er - tr;
        im[odd] = ei - ti;
        re[even] = er + tr;
        im[even] = ei + ti;
      }
    }
  }
}

/**
 * The non-redundant half of the spectrum, as **power** (|X|²) rather than
 * magnitude.
 *
 * Two decisions, both deliberate.
 *
 * Half the bins, because the input is real: bin N-k is the complex conjugate
 * of bin k, so bins N/2+1..N-1 carry no information the first half does not.
 * That is where §1.4's "513 usable bins for a 1024-point FFT" comes from —
 * 0 (DC) through 512 (Nyquist) inclusive.
 *
 * Power, not magnitude, because the square root would be *thrown away*.
 * Everything downstream of here is ordinal: peak picking asks whether a point
 * exceeds its neighbours (§1.2) and then discards amplitude entirely (§2.1,
 * "at this point the amplitude component has been eliminated"). `sqrt` is
 * monotone on non-negative reals, so it cannot change the answer to any
 * comparison — it would just cost 513 square roots per frame to produce
 * identical constellations. Skipping it is not an approximation.
 */
export function powerSpectrum(
  re: Float64Array,
  im: Float64Array,
  out?: Float64Array,
): Float64Array {
  const bins = (re.length >> 1) + 1;
  const power = out ?? new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    const r = re[k]!;
    const i = im[k]!;
    power[k] = r * r + i * i;
  }
  return power;
}
