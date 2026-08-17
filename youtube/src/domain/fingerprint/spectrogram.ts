import { fft, hannWindow, powerSpectrum } from "./fft";

/**
 * The short-time Fourier transform: the audio's time-frequency plane, and the
 * only place raw samples are touched.
 *
 * Parameters are from `research/06-audio-fingerprinting.md` §3, which derives
 * them from the three implementations §1.1 surveys. They are restated on the
 * constants below rather than here, so that a reader who jumps to a number
 * finds its justification at the number.
 *
 * One arithmetic coincidence is worth stating up front because several later
 * decisions lean on it: **our STFT grid is dejavu's STFT grid.** dejavu
 * analyses at 44100 Hz with a 4096-point window and a 2048 hop; we analyse at
 * 11025 Hz with a 1024-point window and a 512 hop. Every one of those is
 * exactly a quarter, so the two grids have identical resolution in both axes —
 * 46.44 ms per frame and 10.77 Hz per bin — and differ only in ceiling
 * (5512 Hz against 22050 Hz). That is why dejavu's tuned peak-picking
 * neighbourhood transfers to `peaks.ts` as a *measured* value from a working
 * system rather than as a number that felt about right.
 */

/** 11025 Hz mono. §3: audfprint's field-tested default; 4x less compute than
 * 44.1 kHz and still covers everything melodic or harmonic below 5.5 kHz. */
export const SAMPLE_RATE = 11025;

/** §3: 1024 samples ~= 92.9 ms, sitting between Shazam's 1024@8kHz and
 * audfprint's 512@11025. 10.77 Hz per bin, which is the resolution the 9-bit
 * frequency field of the hash layout (§1.4) is sized against. */
export const FFT_SIZE = 1024;

/** §3: 50% overlap, the convention dejavu and audfprint share. Shazam's patent
 * uses a 64-sample hop (93.75% overlap) because it is identifying a phone-mic
 * capture of a noisy bar; our source is a clean re-encode, so we sit at the
 * "radio monitoring" end of §2.2's spectrum and do not pay for that density. */
export const HOP_SIZE = 512;

/** 513 bins: 0 (DC) through 512 (Nyquist) inclusive, the non-redundant half of
 * a 1024-point real-input FFT (§1.4, §4). */
export const BIN_COUNT = FFT_SIZE / 2 + 1;

/** 46.4399 ms. The unit the hash's Δt field counts in (§1.4) and the natural
 * width of the offset histogram's bucket (§6). */
export const HOP_MS = (HOP_SIZE / SAMPLE_RATE) * 1000;

export interface Spectrogram {
  /**
   * Frame-major |X|², `power[frame * bins + bin]`.
   *
   * One flat `Float64Array` rather than an array of per-frame arrays. A minute
   * of audio is 1292 frames of 513 bins; as boxed rows that is 1292 separate
   * allocations the peak picker then chases pointers through, and the picker's
   * neighbourhood scan is the one place in this slice that touches every cell.
   */
  readonly power: Float64Array;
  readonly frameCount: number;
  readonly bins: number;
  readonly hop: number;
  readonly sampleRate: number;
}

export interface StftOptions {
  readonly fftSize?: number;
  readonly hop?: number;
  readonly sampleRate?: number;
}

/**
 * Hann-window, transform, keep the power spectrum. One frame per hop.
 *
 * **The tail is dropped, not zero-padded.** A final partial frame padded with
 * zeros is a frame of real audio fading into silence that was never there, and
 * it produces spectral peaks — and therefore hashes — that the *same audio*
 * would not produce if it appeared in the middle of a longer file. Since the
 * entire matching scheme rests on a query and a reference independently
 * generating equal hashes for the same sound, an artefact that depends on
 * where the file happens to end is exactly the wrong thing to introduce. The
 * cost is under 93 ms of unanalysed audio at the very end of a track.
 */
export function stft(
  samples: Float32Array | Float64Array,
  options: StftOptions = {},
): Spectrogram {
  const fftSize = options.fftSize ?? FFT_SIZE;
  const hop = options.hop ?? HOP_SIZE;
  const sampleRate = options.sampleRate ?? SAMPLE_RATE;

  if (hop < 1) throw new Error(`stft: hop must be positive, got ${hop}`);

  const bins = fftSize / 2 + 1;
  const frameCount =
    samples.length < fftSize ? 0 : Math.floor((samples.length - fftSize) / hop) + 1;

  const power = new Float64Array(frameCount * bins);
  const window = hannWindow(fftSize);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  // One scratch view per frame, so `powerSpectrum` writes straight into the
  // spectrogram instead of allocating 513 doubles 21 times a second.
  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * hop;
    for (let i = 0; i < fftSize; i++) {
      re[i] = samples[start + i]! * window[i]!;
      im[i] = 0;
    }
    fft(re, im);
    powerSpectrum(re, im, power.subarray(frame * bins, (frame + 1) * bins));
  }

  return { power, frameCount, bins, hop, sampleRate };
}

/** The centre frequency of a bin, in Hz. */
export function binToHz(bin: number, sampleRate = SAMPLE_RATE, fftSize = FFT_SIZE): number {
  return (bin * sampleRate) / fftSize;
}

/** The bin a frequency lands in. Inverse of {@link binToHz}, rounded. */
export function hzToBin(hz: number, sampleRate = SAMPLE_RATE, fftSize = FFT_SIZE): number {
  return Math.round((hz * fftSize) / sampleRate);
}

/**
 * The absolute time of a frame's *start*, in milliseconds.
 *
 * The frame's start rather than its centre. Both are defensible and the choice
 * cancels out of the offset histogram — every δ is a difference of two of
 * these, so a constant bias of half a window vanishes — but only if query and
 * reference use the same convention, so there is exactly one function.
 */
export function frameToMs(frame: number, hop = HOP_SIZE, sampleRate = SAMPLE_RATE): number {
  return (frame * hop * 1000) / sampleRate;
}
