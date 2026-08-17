// @vitest-environment node
import { describe, expect, it } from "vitest";

import { fft, hannWindow, powerSpectrum } from "../fft";

/**
 * Known-answer tests for the FFT.
 *
 * An FFT that is subtly wrong — a twiddle sign flipped, a bit-reversal table
 * off by one stage — still produces a *plausible* spectrogram, so peak-picking
 * still finds peaks and the fingerprinter still appears to work. It fails only
 * on real audio, months later, as "matching is a bit unreliable". The whole
 * point of this file is that the transform is pinned to closed-form answers
 * rather than to whatever it happened to produce on the day it was written.
 *
 * Every case here has an answer derivable on paper:
 *
 *   DC          — all energy in bin 0 and nowhere else
 *   bin-centred — one nonzero bin, at a known amplitude
 *   two-tone    — superposition, both bins, correct amplitudes
 *   Parseval    — energy is conserved by the transform
 *   linearity   — F(ax + by) = aF(x) + bF(y)
 *
 * Plus a naive O(N²) DFT to cross-check an arbitrary signal, because the five
 * structural cases above are all ones a broken-but-symmetric implementation
 * could still pass.
 */

/** The textbook definition, transcribed. Slow, and that is the point. */
function naiveDft(input: readonly number[]): { re: number[]; im: number[] } {
  const n = input.length;
  const re = new Array<number>(n).fill(0);
  const im = new Array<number>(n).fill(0);
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let t = 0; t < n; t++) {
      const angle = (-2 * Math.PI * k * t) / n;
      sr += input[t]! * Math.cos(angle);
      si += input[t]! * Math.sin(angle);
    }
    re[k] = sr;
    im[k] = si;
  }
  return { re, im };
}

function run(samples: readonly number[]): { re: Float64Array; im: Float64Array } {
  const re = Float64Array.from(samples);
  const im = new Float64Array(samples.length);
  fft(re, im);
  return { re, im };
}

/** A deterministic PRNG. `Math.random()` would make a failure unreproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("fft", () => {
  it("puts a DC signal entirely in bin 0", () => {
    const n = 64;
    const { re, im } = run(new Array<number>(n).fill(1));

    // sum of n ones, and nothing anywhere else.
    expect(re[0]).toBeCloseTo(n, 10);
    expect(im[0]).toBeCloseTo(0, 10);
    for (let k = 1; k < n; k++) {
      expect(re[k]).toBeCloseTo(0, 10);
      expect(im[k]).toBeCloseTo(0, 10);
    }
  });

  it("puts a bin-centred sinusoid in exactly its own bin", () => {
    // A sinusoid at exactly bin k has an integer number of periods in the
    // frame, so it does not leak: cos(2*pi*k*t/n) = (e^+ + e^-)/2 transforms to
    // n/2 at bin k and n/2 at bin n-k, and zero elsewhere. This is the case
    // that catches a twiddle-sign or bit-reversal error, because a wrong
    // implementation lands the energy in a *different* bin rather than
    // spreading it.
    const n = 256;
    const bin = 17;
    const input = Array.from({ length: n }, (_, t) =>
      Math.cos((2 * Math.PI * bin * t) / n),
    );
    const { re, im } = run(input);

    expect(re[bin]).toBeCloseTo(n / 2, 8);
    expect(im[bin]).toBeCloseTo(0, 8);
    expect(re[n - bin]).toBeCloseTo(n / 2, 8);
    expect(im[n - bin]).toBeCloseTo(0, 8);

    for (let k = 0; k < n; k++) {
      if (k === bin || k === n - bin) continue;
      expect(Math.hypot(re[k]!, im[k]!)).toBeLessThan(1e-9);
    }
  });

  it("carries the phase sign of a sine into the imaginary part", () => {
    // sin(2*pi*k*t/n) = (e^+ - e^-)/(2i), so the forward transform (the e^-jwt
    // convention, §4) puts -n/2 in the *imaginary* part at bin k. Getting the
    // sign of the exponent backwards passes the cosine test above and fails
    // this one, which is why both exist.
    const n = 128;
    const bin = 9;
    const input = Array.from({ length: n }, (_, t) =>
      Math.sin((2 * Math.PI * bin * t) / n),
    );
    const { re, im } = run(input);

    expect(re[bin]).toBeCloseTo(0, 8);
    expect(im[bin]).toBeCloseTo(-n / 2, 8);
    expect(im[n - bin]).toBeCloseTo(n / 2, 8);
  });

  it("resolves a two-tone signal into two bins at the right amplitudes", () => {
    const n = 512;
    const a = { bin: 40, amp: 1 };
    const b = { bin: 137, amp: 0.25 };
    const input = Array.from(
      { length: n },
      (_, t) =>
        a.amp * Math.cos((2 * Math.PI * a.bin * t) / n) +
        b.amp * Math.cos((2 * Math.PI * b.bin * t) / n),
    );
    const { re, im } = run(input);

    expect(Math.hypot(re[a.bin]!, im[a.bin]!)).toBeCloseTo((a.amp * n) / 2, 7);
    expect(Math.hypot(re[b.bin]!, im[b.bin]!)).toBeCloseTo((b.amp * n) / 2, 7);

    // and the quieter tone is quieter by exactly its amplitude ratio, which is
    // the property peak-picking depends on.
    const ratio =
      Math.hypot(re[b.bin]!, im[b.bin]!) / Math.hypot(re[a.bin]!, im[a.bin]!);
    expect(ratio).toBeCloseTo(b.amp / a.amp, 7);
  });

  it("conserves energy (Parseval)", () => {
    // sum |x[t]|^2 = (1/N) sum |X[k]|^2. A scaling error anywhere in the
    // butterfly network breaks this even when the bin *positions* are right.
    const n = 1024;
    const rand = mulberry32(20030101);
    const input = Array.from({ length: n }, () => rand() * 2 - 1);
    const { re, im } = run(input);

    const timeEnergy = input.reduce((s, v) => s + v * v, 0);
    let freqEnergy = 0;
    for (let k = 0; k < n; k++) freqEnergy += re[k]! * re[k]! + im[k]! * im[k]!;

    expect(freqEnergy / n).toBeCloseTo(timeEnergy, 6);
  });

  it("is linear", () => {
    const n = 128;
    const rand = mulberry32(7);
    const x = Array.from({ length: n }, () => rand() * 2 - 1);
    const y = Array.from({ length: n }, () => rand() * 2 - 1);
    const alpha = 2.5;
    const beta = -0.75;

    const fx = run(x);
    const fy = run(y);
    const combined = run(x.map((v, i) => alpha * v + beta * y[i]!));

    for (let k = 0; k < n; k++) {
      expect(combined.re[k]!).toBeCloseTo(alpha * fx.re[k]! + beta * fy.re[k]!, 9);
      expect(combined.im[k]!).toBeCloseTo(alpha * fx.im[k]! + beta * fy.im[k]!, 9);
    }
  });

  it("agrees with a naive DFT on an arbitrary signal", () => {
    // The structural cases above are all ones a symmetric-but-wrong transform
    // could survive. This one is not: an arbitrary signal has no symmetry to
    // hide behind.
    const n = 256;
    const rand = mulberry32(1962);
    const input = Array.from({ length: n }, () => rand() * 2 - 1);

    const fast = run(input);
    const slow = naiveDft(input);

    for (let k = 0; k < n; k++) {
      expect(fast.re[k]!).toBeCloseTo(slow.re[k]!, 8);
      expect(fast.im[k]!).toBeCloseTo(slow.im[k]!, 8);
    }
  });

  it("is its own inverse up to conjugation and scale", () => {
    // Round-tripping catches a bit-reversal table that is wrong but
    // self-consistent — such a table permutes the output and un-permutes it on
    // the way back, so only a comparison against the *definition* (above)
    // catches it. This test is here for the different failure: an in-place
    // butterfly that clobbers a value it still needs.
    const n = 64;
    const rand = mulberry32(99);
    const input = Array.from({ length: n }, () => rand() * 2 - 1);

    const { re, im } = run(input);
    // conjugate, transform, conjugate, scale -> the inverse transform.
    for (let k = 0; k < n; k++) im[k] = -im[k]!;
    fft(re, im);
    for (let k = 0; k < n; k++) {
      expect(re[k]! / n).toBeCloseTo(input[k]!, 10);
    }
  });

  it("rejects a non-power-of-two length rather than producing nonsense", () => {
    expect(() => run(new Array<number>(100).fill(0))).toThrow(/power of two/i);
  });

  it("rejects mismatched real and imaginary buffers", () => {
    expect(() => fft(new Float64Array(64), new Float64Array(32))).toThrow(
      /same length/i,
    );
  });
});

describe("hannWindow", () => {
  it("matches the symmetric definition from research/06 §4", () => {
    const n = 16;
    const w = hannWindow(n);
    for (let i = 0; i < n; i++) {
      expect(w[i]!).toBeCloseTo(0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1))), 12);
    }
  });

  it("is zero at both ends, which is what makes it the symmetric form", () => {
    // The last sample being exactly zero is what distinguishes symmetric from
    // periodic (whose last sample is w[1] and is not zero). research/06 §4
    // picks symmetric because we analyse but never resynthesise.
    const w = hannWindow(1024);
    expect(w[0]).toBe(0);
    expect(w[1023]).toBeCloseTo(0, 15);

    // The peak is 1 but no *sample* reaches it: with an even length the apex
    // at (N-1)/2 = 511.5 falls between two samples, so the largest sample is
    // one half-step down the cosine. Asserting `=== 1` here would be asserting
    // the periodic window instead.
    expect(Math.max(...w)).toBeLessThan(1);
    expect(Math.max(...w)).toBeGreaterThan(0.99999);
  });

  it("is symmetric about its centre", () => {
    // To within the rounding of Math.cos on two angles that are exact
    // reflections in exact arithmetic and not in binary floating point.
    const n = 1024;
    const w = hannWindow(n);
    for (let i = 0; i < n; i++) expect(w[i]!).toBeCloseTo(w[n - 1 - i]!, 14);
  });

  it("caches by size so the STFT does not rebuild it per frame", () => {
    expect(hannWindow(1024)).toBe(hannWindow(1024));
  });

  it("narrows a bin-centred tone to a three-bin main lobe", () => {
    // The reason we window at all: a Hann window trades a wider main lobe for
    // far lower sidelobes than the implicit rectangular window, which is what
    // stops a loud tone from planting spurious "peaks" across the spectrum.
    const n = 512;
    const bin = 64;
    const w = hannWindow(n);
    const input = Array.from(
      { length: n },
      (_, t) => w[t]! * Math.cos((2 * Math.PI * bin * t) / n),
    );
    const { re, im } = run(input);
    const power = powerSpectrum(re, im);

    const peak = power[bin]!;
    // Hann's transform is one centre bin plus two half-amplitude neighbours,
    // so the main lobe is three bins wide and each shoulder carries a quarter
    // of the centre's *power*. Not exactly a quarter: the symmetric window is
    // not quite periodic in the frame, which perturbs it by well under a
    // percent. That residue is the price of §4's symmetric-form choice, and
    // pinning it here is what would catch the window being swapped out.
    expect(power[bin - 1]! / peak).toBeCloseTo(0.25, 2);
    expect(power[bin + 1]! / peak).toBeCloseTo(0.25, 2);
    // and everything outside it is down by more than 50 dB.
    for (let k = 0; k < power.length; k++) {
      if (Math.abs(k - bin) <= 2) continue;
      expect(10 * Math.log10(power[k]! / peak)).toBeLessThan(-50);
    }
  });
});

describe("powerSpectrum", () => {
  it("returns only the non-redundant half, DC through Nyquist", () => {
    const n = 256;
    const { re, im } = run(Array.from({ length: n }, (_, t) => Math.sin(t)));
    expect(powerSpectrum(re, im).length).toBe(n / 2 + 1);
  });

  it("is the squared magnitude", () => {
    const n = 64;
    const { re, im } = run(Array.from({ length: n }, (_, t) => Math.cos(t * 0.3)));
    const power = powerSpectrum(re, im);
    for (let k = 0; k <= n / 2; k++) {
      expect(power[k]!).toBeCloseTo(re[k]! * re[k]! + im[k]! * im[k]!, 9);
    }
  });
});
