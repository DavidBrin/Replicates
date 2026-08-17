/**
 * The media segment: `moof` + `mdat`, and the arithmetic that lets them be
 * written in one forward pass.
 *
 * ---
 *
 * **Why `trun.data_offset` is not back-patched here.**
 *
 * With `default-base-is-moof` set, `data_offset` is measured from the first
 * byte of the enclosing `moof` to the first byte of that track's samples. It
 * therefore depends on the size of the `moof` that contains it, which is
 * circular on the face of it — and the standard resolution, the one the
 * cross-checked reference muxer uses, is to write a placeholder, keep writing,
 * and seek back over `moof` once the true offsets are known (research §3.6,
 * resolution B).
 *
 * That is unnecessary here, and research §3.6 resolution A says why: a fragment
 * is closed before it is written. Every sample's final size, duration and flags
 * is already known, and **nothing inside `moof` is variable-length** — no
 * strings, no optional trailing data. So `moof`'s exact byte size is a function
 * of three integers per track: the sample count, which `trun` flag bits are
 * set, and whether any 64-bit field is needed. `computeMoofSize` below is that
 * function. Given it, `data_offset` for the first track is
 * `moofSize + mdatHeaderSize`, and each later track adds the earlier tracks'
 * sample bytes.
 *
 * The payoff is not elegance, it is a whole class of bug that cannot happen:
 * there is no placeholder to forget to overwrite, no recorded position to
 * record wrongly, and no requirement that the output target support seeking —
 * these bytes can be piped straight into a `fetch` body. An off-by-one
 * `data_offset` leaves the box tree perfectly well-formed and hands the decoder
 * a shifted window of bytes, so it is diagnosed as a codec problem
 * (research §10). Not writing the field twice is the cheapest way to be sure it
 * was written once, correctly.
 *
 * The model is not trusted on faith: `buildMediaSegment` compares the predicted
 * `moof` size against the bytes actually written and throws if they disagree.
 * That check is what stops the size model and the serialiser drifting apart the
 * first time a field is added to either.
 */

import type { EncodedSample } from "../types";

import {
  MFHD_SIZE,
  TFDT_SIZE,
  TFHD_SIZE,
  TRUN_DATA_OFFSET_PRESENT,
  TRUN_FIRST_SAMPLE_FLAGS_PRESENT,
  TRUN_SAMPLE_COMPOSITION_TIME_OFFSETS_PRESENT,
  TRUN_SAMPLE_DURATION_PRESENT,
  TRUN_SAMPLE_FLAGS_PRESENT,
  TRUN_SAMPLE_SIZE_PRESENT,
  mdatHeaderSize,
  microsecondsToTimescale,
  sampleFlags,
  trunSize,
  writeMdatHeader,
  writeMfhd,
  writeTfdt,
  writeTfhd,
  writeTrun,
} from "./boxes";
import { BOX_HEADER_SIZE, ByteWriter } from "./writer";

/** One sample, already converted into its track's timescale. */
export interface FragmentSample {
  readonly data: Uint8Array;
  /** In the track's own timescale. */
  readonly duration: number;
  readonly size: number;
  /** The composed 32-bit `sample_flags` word — see `sampleFlags` in boxes.ts. */
  readonly flags: number;
  /** Signed, in the track's own timescale. */
  readonly compositionOffset: number;
}

export interface FragmentTrack {
  readonly id: number;
  /** `tfdt.baseMediaDecodeTime`, in this track's own timescale. */
  readonly baseMediaDecodeTime: number;
  readonly samples: readonly FragmentSample[];
}

export interface MediaSegmentOptions {
  /** `mfhd.sequence_number`: file-wide, 1-based, one per fragment. */
  readonly sequenceNumber: number;
  readonly tracks: readonly FragmentTrack[];
}

/* ----------------------------------------------------------- run planning -- */

export interface TrackFragmentPlan {
  readonly trackId: number;
  readonly baseMediaDecodeTime: number;
  readonly defaultSampleDuration: number;
  readonly defaultSampleSize: number;
  readonly defaultSampleFlags: number;
  readonly trunFlags: number;
  readonly firstSampleFlags: number | undefined;
  readonly sampleBytes: number;
  readonly samples: readonly FragmentSample[];
}

/**
 * Decides `tfhd`'s three defaults and the minimal `trun` flag set for one
 * track's samples (research §3.3, §3.4).
 *
 * The defaults come from `samples[1] ?? samples[0]`, which looks arbitrary and
 * is not: a keyframe-aligned fragment starts with the one sample that differs
 * from every other — different flags, and usually several times the size. Using
 * sample 0 as the reference would make the whole rest of the fragment an
 * override. Sample 1 is representative, and sample 0 gets carried by
 * `first_sample_flags` instead.
 *
 * Each optional per-sample `trun` field is switched on only if that field
 * actually varies, because each one that is on costs four bytes per sample for
 * the length of the fragment. At 6 seconds and 30fps that is 720 bytes per
 * needless field per fragment.
 */
export function planTrackFragment(track: FragmentTrack): TrackFragmentPlan {
  const { samples } = track;
  const first = samples[0];
  if (first === undefined) {
    throw new Error(`Track ${track.id} has no samples; a traf with an empty run is invalid`);
  }
  // `?? first` covers the one-sample fragment, where there is no second sample
  // to be representative and sample 0 is trivially the reference.
  const reference = samples[1] ?? first;

  let trunFlags = TRUN_DATA_OFFSET_PRESENT;
  let firstSampleFlags: number | undefined;

  if (samples.some((sample) => sample.duration !== reference.duration)) {
    trunFlags |= TRUN_SAMPLE_DURATION_PRESENT;
  }
  if (samples.some((sample) => sample.size !== reference.size)) {
    trunFlags |= TRUN_SAMPLE_SIZE_PRESENT;
  }
  if (samples.some((sample) => sample.compositionOffset !== 0)) {
    trunFlags |= TRUN_SAMPLE_COMPOSITION_TIME_OFFSETS_PRESENT;
  }

  // Sample 0's flags can ride in `first_sample_flags`; anything past it that
  // disagrees with the default forces the per-sample table, which then covers
  // sample 0 too. The two are mutually exclusive by §3.4.
  const tailDisagrees = samples
    .slice(1)
    .some((sample) => sample.flags !== reference.flags);
  if (tailDisagrees) {
    trunFlags |= TRUN_SAMPLE_FLAGS_PRESENT;
  } else if (first.flags !== reference.flags) {
    trunFlags |= TRUN_FIRST_SAMPLE_FLAGS_PRESENT;
    firstSampleFlags = first.flags;
  }

  let sampleBytes = 0;
  for (const sample of samples) {
    if (sample.size !== sample.data.byteLength) {
      throw new Error(
        `Track ${track.id}: sample declares ${sample.size} bytes but carries ${sample.data.byteLength}`,
      );
    }
    sampleBytes += sample.size;
  }

  return {
    trackId: track.id,
    baseMediaDecodeTime: track.baseMediaDecodeTime,
    defaultSampleDuration: reference.duration,
    defaultSampleSize: reference.size,
    defaultSampleFlags: reference.flags,
    trunFlags,
    firstSampleFlags,
    sampleBytes,
    samples,
  };
}

/**
 * The exact serialised size of the `moof` these plans produce, computed rather
 * than measured:
 *
 *     moof = header + mfhd + Σ traf
 *     traf = header + tfhd + tfdt + trun
 *
 * `tfhd` and `tfdt` are fixed-width because this muxer always writes the same
 * flag combination and always uses `tfdt` version 1. `trun` is the only
 * variable part, and `trunSize` derives it from the flags and the sample count.
 */
export function computeMoofSize(plans: readonly TrackFragmentPlan[]): number {
  let total = BOX_HEADER_SIZE + MFHD_SIZE;
  for (const plan of plans) {
    total +=
      BOX_HEADER_SIZE + TFHD_SIZE + TFDT_SIZE + trunSize(plan.trunFlags, plan.samples.length);
  }
  return total;
}

/* -------------------------------------------------------------- assembly -- */

/**
 * Serialises one media segment: `moof`, then a single `mdat` holding every
 * track's samples back to back in the order the `traf`s appear.
 *
 * One `mdat`, not one per track. MSE permits "one or more" (research §6.2), but
 * a second `mdat` buys nothing and adds a second header whose size the offset
 * arithmetic would then have to account for.
 */
export function buildMediaSegment(options: MediaSegmentOptions): Uint8Array {
  if (options.tracks.length === 0) {
    throw new Error("A media segment needs at least one traf");
  }
  if (!Number.isInteger(options.sequenceNumber) || options.sequenceNumber < 1) {
    throw new Error(
      `mfhd.sequence_number must be a positive integer, got ${options.sequenceNumber}`,
    );
  }

  const plans = options.tracks.map(planTrackFragment);
  const moofSize = computeMoofSize(plans);
  const payloadBytes = plans.reduce((total, plan) => total + plan.sampleBytes, 0);
  const headerSize = mdatHeaderSize(payloadBytes);

  // The whole point of the analytic size: every offset is known before a byte
  // of `moof` is written. Track k starts after `moof`, after `mdat`'s header,
  // and after every earlier track's samples.
  const dataOffsets: number[] = [];
  let cursor = moofSize + headerSize;
  for (const plan of plans) {
    dataOffsets.push(cursor);
    cursor += plan.sampleBytes;
  }

  const w = new ByteWriter(moofSize + headerSize + payloadBytes);

  const moof = w.beginBox("moof");
  writeMfhd(w, options.sequenceNumber);
  for (const [index, plan] of plans.entries()) {
    const traf = w.beginBox("traf");
    writeTfhd(w, {
      trackId: plan.trackId,
      defaultSampleDuration: plan.defaultSampleDuration,
      defaultSampleSize: plan.defaultSampleSize,
      defaultSampleFlags: plan.defaultSampleFlags,
    });
    // Between `tfhd` and `trun`, which is where §3.5 requires it.
    writeTfdt(w, plan.baseMediaDecodeTime);
    writeTrun(w, {
      flags: plan.trunFlags,
      dataOffset: dataOffsets[index] ?? 0,
      firstSampleFlags: plan.firstSampleFlags,
      samples: plan.samples,
    });
    w.endBox(traf);
  }
  w.endBox(moof);

  // The invariant that keeps the size model honest. If this ever fires, every
  // `data_offset` in the segment is wrong by the same amount, and the symptom
  // downstream would be a decode error rather than anything pointing here.
  if (w.length !== moofSize) {
    throw new Error(
      `moof was predicted at ${moofSize} bytes and serialised to ${w.length}; ` +
        `computeMoofSize and the box writers disagree`,
    );
  }

  writeMdatHeader(w, payloadBytes);
  for (const plan of plans) {
    for (const sample of plan.samples) w.bytes(sample.data);
  }

  return w.finish();
}

/* ----------------------------------------------------------------- clock -- */

/**
 * A track's running position, in both units at once.
 *
 * `elapsedUs` is the exact sum of every sample's declared duration and is never
 * rounded. `elapsedUnits` is that same position in the track's timescale, and
 * is what the next fragment's `tfdt` writes.
 *
 * Carrying both is the whole anti-drift mechanism (research §5.2). Rounding
 * each sample's duration independently and summing the results accumulates one
 * error per frame, which is inaudible for a minute and then obvious; rounding
 * the *absolute* position and taking the difference bounds the total error at
 * under one timescale unit forever, because each frame's error cancels the
 * previous frame's.
 */
export interface MediaClock {
  readonly elapsedUs: number;
  readonly elapsedUnits: number;
}

export const MEDIA_CLOCK_START: MediaClock = { elapsedUs: 0, elapsedUnits: 0 };

export interface FragmentPlan {
  readonly samples: readonly FragmentSample[];
  /** This fragment's `tfdt`, in track timescale units. */
  readonly baseMediaDecodeTime: number;
  /** The fragment's own length, in track timescale units. */
  readonly durationUnits: number;
  /** The clock to hand to the next fragment. */
  readonly clock: MediaClock;
}

/**
 * Converts a fragment's worth of `EncodedSample`s into timescale units.
 *
 * The media timeline is built from the samples' declared *durations*, not from
 * the deltas between their timestamps. That is a real choice with a real
 * consequence: if the encoder emits a gap, this produces a gapless timeline
 * that disagrees with the timestamps rather than propagating the gap. It is the
 * right side of the trade because Apple requires that "the track fragment
 * decode time MUST be consistent with the decode time and duration of the
 * previous segment" (research §7.2, 7.3) — the decode clock has to be a
 * continuous running total across segment boundaries, and deriving it from
 * durations makes that true by construction rather than by hoping the encoder's
 * timestamps never skip.
 *
 * It also rules out the drift bug this function exists to prevent: computing
 * `baseMediaDecodeTime` as `segmentIndex × nominalDuration` is correct for as
 * long as every segment is exactly nominal, and silently wrong from the first
 * one that is not.
 */
export function planFragment(
  samples: readonly EncodedSample[],
  timescale: number,
  clock: MediaClock,
): FragmentPlan {
  if (samples.length === 0) {
    throw new Error("Cannot plan a fragment with no samples");
  }

  const baseMediaDecodeTime = clock.elapsedUnits;
  let elapsedUs = clock.elapsedUs;
  let elapsedUnits = clock.elapsedUnits;
  const planned: FragmentSample[] = [];

  for (const sample of samples) {
    if (!Number.isFinite(sample.durationUs) || sample.durationUs < 0) {
      throw new Error(`Sample at ${sample.timestampUs}µs has an invalid duration`);
    }
    elapsedUs += sample.durationUs;
    const nextUnits = microsecondsToTimescale(elapsedUs, timescale);
    planned.push({
      data: sample.data,
      size: sample.data.byteLength,
      duration: nextUnits - elapsedUnits,
      flags: sampleFlags(sample.isKeyFrame),
      compositionOffset: microsecondsToTimescale(sample.compositionOffsetUs ?? 0, timescale),
    });
    elapsedUnits = nextUnits;
  }

  return {
    samples: planned,
    baseMediaDecodeTime,
    durationUnits: elapsedUnits - baseMediaDecodeTime,
    clock: { elapsedUs, elapsedUnits },
  };
}
