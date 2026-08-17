// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  binToHz,
  hzToBin,
  packHash,
  pairConstellation,
  peakDensity,
  pickPeaks,
  stft,
  unpackHash,
  FFT_SIZE,
  HOP_SIZE,
  MAX_BIN,
  MAX_DT_HOPS,
  MIN_BIN,
  NEIGHBOURHOOD_FRAMES,
  PEAK_DENSITY_PER_SECOND,
  SAMPLE_RATE,
} from "../index";
import { gain, makeTrack, mulberry32 } from "./synthetic-audio";

/** A steady sum of sinusoids at exactly bin-centred frequencies. */
function tones(freqs: readonly number[], seconds: number): Float32Array {
  const n = Math.round(seconds * SAMPLE_RATE);
  const out = new Float32Array(n);
  const rand = mulberry32(4242);
  for (const f of freqs) {
    const phase = rand() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      out[i] = out[i]! + Math.sin((2 * Math.PI * f * i) / SAMPLE_RATE + phase) / freqs.length;
    }
  }
  // A tiny noise floor, so no frame is bit-identical to its neighbour and the
  // plateau tie-break is not what is under test here.
  for (let i = 0; i < n; i++) out[i] = out[i]! + 0.0001 * (rand() * 2 - 1);
  return out;
}

describe("pickPeaks", () => {
  it("collapses a sustained tone to one landmark per neighbourhood width", () => {
    const bin = 100;
    const spec = stft(tones([binToHz(bin)], 3));
    const peaks = pickPeaks(spec);

    // A steady tone is *one* spectral event that happens to last three seconds,
    // and the rectangle is a de-duplicator, so it should emit the tone once per
    // rectangle width rather than once per frame. That width is 2T+1 = 11
    // frames, so a 63-frame spectrogram should carry about six of them. This is
    // the clearest statement of what NEIGHBOURHOOD_FRAMES actually does.
    const toneFrames = new Set<number>();
    for (let i = 0; i < peaks.bins.length; i++) {
      if (Math.abs(peaks.bins[i]! - bin) <= 1) toneFrames.add(peaks.frames[i]!);
    }
    const width = 2 * NEIGHBOURHOOD_FRAMES + 1;
    expect(toneFrames.size).toBeGreaterThanOrEqual(Math.floor(spec.frameCount / (width + 1)));
    expect(toneFrames.size).toBeLessThanOrEqual(Math.ceil(spec.frameCount / (width - 1)));

    // It is also the single most-picked bin in the whole constellation. The
    // *rest* of it is the -80 dB noise floor's own local maxima, and their
    // presence is correct rather than a defect: with no absolute amplitude
    // floor (see `pickPeaks`) the quota has 32 slots per half-second window and
    // one sustained sinusoid supplies about one. Real material fills those
    // slots with signal; the price of gain invariance is that a near-silent
    // passage fills them with noise instead — bounded by the quota, and
    // generating hashes that match nothing.
    const perBin = new Map<number, number>();
    for (let i = 0; i < peaks.bins.length; i++) {
      perBin.set(peaks.bins[i]!, (perBin.get(peaks.bins[i]!) ?? 0) + 1);
    }
    const modal = [...perBin.entries()].sort((a, b) => b[1] - a[1])[0]!;
    expect(Math.abs(modal[0] - bin)).toBeLessThanOrEqual(1);
  });

  it("resolves two tones a hundred hertz apart into two distinct bins", () => {
    // The case that sizes NEIGHBOURHOOD_BINS. 100 Hz is nine bins, so a +-10
    // bin rectangle would report only the louder of the two — which is why
    // dejavu's radius was rejected.
    const low = binToHz(hzToBin(200));
    const high = binToHz(hzToBin(300));
    const spec = stft(tones([low, high], 3));
    const peaks = pickPeaks(spec);

    const found = new Set<number>();
    for (let i = 0; i < peaks.bins.length; i++) found.add(peaks.bins[i]!);
    expect(found).toContain(hzToBin(200));
    expect(found).toContain(hzToBin(300));
  });

  it("never emits DC or Nyquist", () => {
    // A large DC offset plus a tone. Bin 0 would carry more energy than
    // anything else in the frame if it were in the running at all, and §1.4's
    // 9-bit frequency field has no room for bin 512.
    const n = 3 * SAMPLE_RATE;
    const samples = new Float32Array(n);
    const rand = mulberry32(11);
    for (let i = 0; i < n; i++) {
      samples[i] = 0.8 + 0.2 * Math.sin((2 * Math.PI * 1500 * i) / SAMPLE_RATE) + 0.001 * rand();
    }
    const peaks = pickPeaks(stft(samples));

    expect(peaks.bins.length).toBeGreaterThan(0);
    for (let i = 0; i < peaks.bins.length; i++) {
      expect(peaks.bins[i]!).toBeGreaterThanOrEqual(MIN_BIN);
      expect(peaks.bins[i]!).toBeLessThanOrEqual(MAX_BIN);
    }
  });

  it("holds the density near its target on real-shaped material", () => {
    // PEAK_DENSITY_PER_SECOND is a target for the quota, not a hard cap: the
    // quota is "top N within +-0.5 s of yourself", so a stretch of audio whose
    // candidates are unusually evenly spread can pass slightly more.
    for (const seed of [1, 2, 3, 4, 5]) {
      const spec = stft(makeTrack(seed, { seconds: 10 }));
      const density = peakDensity(pickPeaks(spec), spec);
      expect(density).toBeGreaterThan(PEAK_DENSITY_PER_SECOND * 0.7);
      expect(density).toBeLessThan(PEAK_DENSITY_PER_SECOND * 2);
    }
  });

  it("lets the density quota do the rate control", () => {
    // The two-filter design of the module header, asserted: the rectangle must
    // over-produce so that the quota is what decides the rate. If this ever
    // stops holding, the rectangle has silently become the only filter and the
    // density target means nothing — which is exactly what happened at the
    // +-10 radius the constants document as rejected.
    const spec = stft(makeTrack(7, { seconds: 10 }));
    const unquotaed = pickPeaks(spec, { densityPerSecond: 1e9 });
    const quotaed = pickPeaks(spec);
    expect(peakDensity(unquotaed, spec)).toBeGreaterThan(2 * PEAK_DENSITY_PER_SECOND);
    expect(quotaed.frames.length).toBeLessThan(unquotaed.frames.length);
  });

  it("is exactly invariant to gain, not merely tolerant of it", () => {
    // §2: amplitude is discarded at the constellation stage, so a level change
    // cannot move a peak — it is a non-issue by construction rather than
    // something the algorithm survives. 0.25 and 4 are exact in binary floating
    // point, so every intermediate scales exactly and the assertion can be
    // equality rather than similarity. A near-miss here would mean an absolute
    // amplitude threshold had crept in somewhere.
    const track = makeTrack(21, { seconds: 6 });
    const base = pickPeaks(stft(track));
    for (const factor of [0.25, 4, 0.0625]) {
      const scaled = pickPeaks(stft(gain(track, factor)));
      expect(Array.from(scaled.frames)).toEqual(Array.from(base.frames));
      expect(Array.from(scaled.bins)).toEqual(Array.from(base.bins));
    }
  });

  it("emits peaks in frame order, which the pairing relies on", () => {
    const peaks = pickPeaks(stft(makeTrack(9, { seconds: 5 })));
    for (let i = 1; i < peaks.frames.length; i++) {
      expect(peaks.frames[i]!).toBeGreaterThanOrEqual(peaks.frames[i - 1]!);
    }
  });

  it("finds nothing in digital silence rather than everything", () => {
    // Every cell is exactly equal, so "is this larger than its neighbours" has
    // no answer. The total order in `better()` makes one cell per rectangle win
    // anyway; what must not happen is the whole plateau being reported.
    const spec = stft(new Float32Array(3 * SAMPLE_RATE));
    const peaks = pickPeaks(spec);
    expect(peaks.frames.length).toBe(0);
  });

  it("returns an empty constellation for audio shorter than one frame", () => {
    const peaks = pickPeaks(stft(new Float32Array(FFT_SIZE - 1)));
    expect(peaks.frames.length).toBe(0);
  });

  it("survives a signal whose period divides the hop", () => {
    // A tone at a frequency where every frame is bit-identical to the last: the
    // plateau case that a non-total comparison would report as one peak per
    // cell. 11025/512 = 21.53 Hz per hop-period; a tone at an exact multiple
    // repeats every hop exactly.
    const n = 4 * SAMPLE_RATE;
    const samples = new Float32Array(n);
    const f = (SAMPLE_RATE / HOP_SIZE) * 32;
    for (let i = 0; i < n; i++) samples[i] = Math.sin((2 * Math.PI * f * i) / SAMPLE_RATE);
    const spec = stft(samples);
    const peaks = pickPeaks(spec);
    expect(peakDensity(peaks, spec)).toBeLessThan(PEAK_DENSITY_PER_SECOND * 2);
  });
});

describe("packHash", () => {
  it("round-trips every field at its extremes", () => {
    for (const f1 of [MIN_BIN, 2, 255, 256, MAX_BIN]) {
      for (const f2 of [MIN_BIN, 300, MAX_BIN]) {
        for (const dt of [1, 127, 128, MAX_DT_HOPS]) {
          expect(unpackHash(packHash(f1, f2, dt))).toEqual({
            freq1: f1,
            freq2: f2,
            dtHops: dt,
          });
        }
      }
    }
  });

  it("stays inside 26 bits, so the sign bit is never set", () => {
    // The decision recorded on `packHash`: Postgres `integer` is signed, and a
    // layout that reached bit 31 would need consistent conversion on every read
    // and write or it would silently lose half the hash space. Keeping the
    // layout narrow removes the problem at the source. The reserved bits are
    // §1.4's, held for a future scheme selector.
    const widest = packHash(MAX_BIN, MAX_BIN, MAX_DT_HOPS);
    expect(widest).toBe(0x3ffffff);
    expect(widest).toBeLessThan(2 ** 26);
    expect(widest | 0).toBe(widest);
    expect(widest >>> 0).toBe(widest);
  });

  it("puts the three fields in the documented bit positions", () => {
    expect(packHash(1, 0, 0)).toBe(1 << 17);
    expect(packHash(0, 1, 0)).toBe(1 << 8);
    expect(packHash(0, 0, 1)).toBe(1);
  });

  it("unpacks a value whose sign bit is set", () => {
    // Not reachable from `packHash` today, but the reserved bits are reserved
    // rather than forbidden. `unpackHash` uses `>>>` so that the day one of
    // them is used, the fields below it still read correctly.
    const withTopBit = (0x80000000 | packHash(300, 400, 7)) | 0;
    expect(withTopBit).toBeLessThan(0);
    expect(unpackHash(withTopBit)).toEqual({ freq1: 300, freq2: 400, dtHops: 7 });
  });
});

describe("pairConstellation", () => {
  const peaks = pickPeaks(stft(makeTrack(31, { seconds: 8 })));

  it("emits at most fanOut hashes per anchor", () => {
    const fanOut = 5;
    const { hashes, offsetsMs } = pairConstellation(peaks, { fanOut });
    expect(hashes.length).toBe(offsetsMs.length);

    // Keyed by (anchor time, anchor bin), not by time alone: the constellation
    // routinely holds several peaks in one frame, and they are separate anchors
    // that happen to share a millisecond.
    const perAnchor = new Map<string, number>();
    for (let i = 0; i < hashes.length; i++) {
      const key = `${offsetsMs[i]}:${unpackHash(hashes[i]!).freq1}`;
      perAnchor.set(key, (perAnchor.get(key) ?? 0) + 1);
    }
    for (const count of perAnchor.values()) expect(count).toBeLessThanOrEqual(fanOut);
  });

  it("scales the token count with the fan-out, as §1.3 says it must", () => {
    const five = pairConstellation(peaks, { fanOut: 5 }).hashes.length;
    const ten = pairConstellation(peaks, { fanOut: 10 }).hashes.length;
    expect(ten).toBeGreaterThan(five);
    expect(ten).toBeLessThanOrEqual(2 * five);
  });

  it("keeps every Δt inside the target zone", () => {
    const { hashes } = pairConstellation(peaks);
    for (const hash of hashes) {
      const { dtHops } = unpackHash(hash);
      expect(dtHops).toBeGreaterThanOrEqual(1);
      expect(dtHops).toBeLessThanOrEqual(MAX_DT_HOPS);
    }
  });

  it("never pairs an anchor with a peak in its own frame", () => {
    // The lead L of §1.3. Δt = 0 carries no time information and would be
    // generated twice, once from each end of the pair.
    const { hashes } = pairConstellation(peaks);
    for (const hash of hashes) expect(unpackHash(hash).dtHops).not.toBe(0);
  });

  it("stores the anchor's absolute time outside the hash", () => {
    // §1.3 point 4, and the reason excerpts work at all: the same sound hashes
    // the same wherever it occurs, and where it occurred is a separate column.
    const shifted = pairConstellation(peaks, { originMs: 5000 });
    const base = pairConstellation(peaks);
    expect(Array.from(shifted.hashes)).toEqual(Array.from(base.hashes));
    for (let i = 0; i < base.offsetsMs.length; i++) {
      expect(shifted.offsetsMs[i]!).toBe(base.offsetsMs[i]! + 5000);
    }
  });

  it("produces roughly the hashes-per-second §3 predicts", () => {
    // §3: peak density x fan-out = 30 x 5 = 150 hashes/s, i.e. 9,000 per minute
    // of registered audio. This is the number the index-size estimate rests on,
    // so it is worth pinning rather than assuming.
    const seconds = 20;
    const { hashes } = pairConstellation(
      pickPeaks(stft(makeTrack(33, { seconds }))),
    );
    const perSecond = hashes.length / seconds;
    expect(perSecond).toBeGreaterThan(100);
    expect(perSecond).toBeLessThan(250);
  });

  it("returns nothing for an empty constellation", () => {
    const empty = { frames: new Int32Array(0), bins: new Int32Array(0) };
    expect(pairConstellation(empty).hashes.length).toBe(0);
  });
});

describe("grid geometry", () => {
  it("matches dejavu's time and frequency resolution exactly", () => {
    // The coincidence `spectrogram.ts` documents, and that peak picking's
    // rejected-alternative note leans on. If someone changes the sample rate or
    // the FFT size, this is where the claim stops being true.
    expect((HOP_SIZE / SAMPLE_RATE) * 1000).toBeCloseTo((2048 / 44100) * 1000, 6);
    expect(SAMPLE_RATE / FFT_SIZE).toBeCloseTo(44100 / 4096, 6);
  });

  it("puts 511 usable bins between DC and Nyquist", () => {
    // Which is what makes §1.4's 9-bit frequency field exactly sufficient.
    expect(MAX_BIN - MIN_BIN + 1).toBe(511);
    expect(MAX_BIN).toBeLessThan(2 ** 9);
    expect(FFT_SIZE / 2 + 1).toBe(513);
  });
});
