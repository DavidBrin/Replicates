/**
 * Which rungs to encode, and where the keyframes go.
 *
 * Those two questions look unrelated and are the same question. A ladder is
 * only a ladder if a player can move between its rungs mid-playback, and it can
 * only do that where every rung has a keyframe at the *same* presentation
 * timestamp (research/02 §8). A set of renditions without that property is six
 * separate videos that happen to share a source. So the cadence lives here,
 * next to the rung table, rather than in the transcoder where it would read as
 * an encoder detail.
 *
 * Codec strings are deliberately absent from this file. A rung's resolution and
 * bitrate are properties of the source; its codec is a property of the machine
 * doing the encoding, and only `VideoEncoder.isConfigSupported` knows that.
 * `capabilities.ts` turns a `LadderShape` into a `LadderRung`.
 */

/** The dimensions this module needs from a source file. */
export interface SourceDimensions {
  readonly width: number;
  readonly height: number;
}

/** A rung before codec negotiation: `LadderRung` minus the codec string. */
export interface LadderShape {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly bitrate: number;
}

/**
 * The 16:9 reference table, from research/01 §6.5, with the bitrates from §6.2
 * (Mux's published guidance) where Mux covers the rung and §6.5's synthesis
 * where it does not.
 *
 * Stored as the *short* side rather than as a "height", which is the whole
 * trick for vertical video: a 1080×1920 Short and a 1920×1080 landscape clip
 * both have a short side of 1080, both deserve the full ladder, and neither
 * needs a special case anywhere below.
 *
 * The table stops at 1080p on purpose. research/01 §6.5 stops there, and a 4K
 * rung would ask a laptop to software-encode 8.3 megapixels per frame six times
 * over — the architectural bet in this project is that client-side transcode is
 * *cheap*, and a 2160p rung is where that stops being true.
 *
 * `referencePixels` is the area of the canonical 16:9 frame at that rung. It is
 * what the bitrate below was quoted for, and it is what a non-16:9 source's
 * bitrate is scaled against (see `bitrateFor`).
 */
export const LADDER_REFERENCE_RUNGS = [
  { name: "1080p", shortSide: 1080, width: 1920, height: 1080, bitrate: 5_000_000 },
  { name: "720p", shortSide: 720, width: 1280, height: 720, bitrate: 2_800_000 },
  { name: "480p", shortSide: 480, width: 854, height: 480, bitrate: 1_400_000 },
  { name: "360p", shortSide: 360, width: 640, height: 360, bitrate: 800_000 },
  { name: "240p", shortSide: 240, width: 426, height: 240, bitrate: 400_000 },
  { name: "144p", shortSide: 144, width: 256, height: 144, bitrate: 150_000 },
] as const;

export type LadderReferenceRung = (typeof LADDER_REFERENCE_RUNGS)[number];

/** The smallest rung, used as the bits-per-pixel reference for tiny sources. */
const SMALLEST_REFERENCE_RUNG =
  LADDER_REFERENCE_RUNGS[LADDER_REFERENCE_RUNGS.length - 1]!;

/**
 * Round to an even number of pixels.
 *
 * `Math.round(x / 2) * 2` rather than `x + (x % 2)`: the former lands 854 for a
 * 480p rung of a 16:9 source and 426 for the 240p rung, which is exactly the
 * published table (research/01 §6.5). Rounding *up* to even gives 854 and 428,
 * so the ladder would silently stop matching any documented resolution.
 *
 * Even at all because 4:2:0 chroma planes are half-resolution in both axes and
 * there is no such thing as half a chroma sample. Encoders cope with odd
 * dimensions by padding, which is a quiet waste and, on some hardware, a
 * configure() failure.
 */
function roundToEven(value: number): number {
  return Math.round(value / 2) * 2;
}

function floorToEven(value: number): number {
  return Math.floor(value / 2) * 2;
}

/**
 * Scale a reference bitrate by how much of the reference frame this rung
 * actually fills.
 *
 * A 4:3 source at the 480p rung is 640×480, three quarters the area of the
 * 854×480 the 1400 kbps in the table was quoted for. Handing it 1400 kbps
 * spends a third more bytes than the frame can use.
 *
 * Scaling is linear in pixel count *within* a rung and never across rungs — the
 * table's own bits-per-pixel falls from 4.07 at 144p to 2.41 at 1080p, because
 * larger frames genuinely compress better per pixel, so extrapolating one rung's
 * bits-per-pixel to another resolution would be wrong. Within one rung the
 * aspect ratio moves the area by well under 2×, and linear is a good local fit.
 */
function bitrateFor(reference: LadderReferenceRung, width: number, height: number): number {
  const referencePixels = reference.width * reference.height;
  const scaled = (reference.bitrate * width * height) / referencePixels;
  return Math.round(scaled / 1000) * 1000;
}

/**
 * The rungs to encode for a given source.
 *
 * Returned largest first, which is the order a master playlist and a quality
 * menu present, and the order in which a degraded ladder loses rungs.
 *
 * Two rules, both about not wasting the uploader's battery:
 *
 *  - **Never upscale.** A 480p source re-encoded to 1080p is a bigger file that
 *    looks identical — worse, actually, since it has been through a second
 *    lossy generation. The filter is on the *short* side, so vertical video is
 *    handled by the same comparison rather than by an orientation branch.
 *  - **Only standard rungs.** A 1000×562 source is capped at 480p rather than
 *    given a bespoke "562p" top rung. YouTube does the same. A non-standard
 *    rung is one the quality menu cannot label and one no other video shares,
 *    so it defeats CDN co-tenancy for a 15% linear-resolution gain.
 *
 * The one exception is a source smaller than the smallest rung: it gets a single
 * rung at its own (even-floored) size, because the alternative is an empty
 * ladder and no playable output at all.
 */
export function selectLadder(source: SourceDimensions): LadderShape[] {
  const { width, height } = source;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) {
    throw new Error(
      `A video needs at least 2×2 pixels; got ${width}×${height}. A source this ` +
        `small is a decode failure, not a video.`,
    );
  }

  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  const portrait = height > width;
  const longSideCap = floorToEven(longSide);

  const rungs: LadderShape[] = [];
  for (const reference of LADDER_REFERENCE_RUNGS) {
    if (reference.shortSide > shortSide) continue;

    const scaledLong = Math.min(
      roundToEven((longSide * reference.shortSide) / shortSide),
      longSideCap,
    );
    const rungWidth = portrait ? reference.shortSide : scaledLong;
    const rungHeight = portrait ? scaledLong : reference.shortSide;

    rungs.push({
      name: reference.name,
      width: rungWidth,
      height: rungHeight,
      bitrate: bitrateFor(reference, rungWidth, rungHeight),
    });
  }

  if (rungs.length > 0) return rungs;

  const nativeWidth = Math.max(2, floorToEven(width));
  const nativeHeight = Math.max(2, floorToEven(height));
  return [
    {
      name: `${Math.min(nativeWidth, nativeHeight)}p`,
      width: nativeWidth,
      height: nativeHeight,
      bitrate: bitrateFor(SMALLEST_REFERENCE_RUNG, nativeWidth, nativeHeight),
    },
  ];
}

/* ------------------------------------------------------- keyframe cadence -- */

/**
 * 2s segments.
 *
 * research/02 §8 recommends 6s *segments* for VOD CDN efficiency while keeping
 * a 2s *IDR interval* inside them, which is Apple's own guidance. This pipeline
 * uses 2s for both, and the reason is the upload, not the playback: the muxer
 * emits a segment as soon as its last frame is encoded, and a segment is the
 * unit this project uploads. 2s segments mean the first bytes leave the browser
 * two seconds into the transcode and upload overlaps encode for the whole run.
 * 6s segments would triple the time before the upload can start and triple the
 * work lost if the tab is closed mid-transcode.
 *
 * The cost is real and is accepted: three times as many HTTP objects, and worse
 * CDN packing. Changing this constant is safe — everything downstream reads it —
 * but it must change for every rung at once or the ladder stops being
 * switchable, which is why it is one constant and not a per-rung option.
 */
export const SEGMENT_DURATION_US = 2_000_000;

/**
 * Which segment a presentation timestamp belongs to.
 *
 * `Math.floor`, so negative timestamps — which an MP4 edit list can genuinely
 * produce for the first few frames — land in segment −1 rather than sharing
 * segment 0 with the frames after t=0.
 */
export function segmentIndexAt(
  timestampUs: number,
  segmentDurationUs: number = SEGMENT_DURATION_US,
): number {
  return Math.floor(timestampUs / segmentDurationUs);
}

export interface SegmentAdmission {
  readonly segmentIndex: number;
  /** Whether this frame must be encoded with `{ keyFrame: true }`. */
  readonly keyFrame: boolean;
}

export interface SegmentGate {
  /**
   * Called once per source frame, in presentation order. The answer is a pure
   * function of the timestamp and the gate's position, so every rung fed the
   * same timestamps gets the same answer.
   */
  admit(timestampUs: number): SegmentAdmission;
}

/**
 * The keyframe decision, computed from the timestamp rather than from a frame
 * counter.
 *
 * research/01 §7 frames this as "every 60th frame at 30fps", which is right for
 * a source that delivers exactly 60 frames every two seconds and wrong for
 * every real file. A dropped frame, a duplicated frame, a variable-frame-rate
 * screen recording, or 30000/1001 fps all shift a counter away from the clock —
 * and the shift is per-rung only if each rung counts separately, but it is a
 * *drift* even when shared: at 30000/1001, sixty frames is 2.002s, so a
 * counter-driven IDR walks 2ms further into the next segment every segment
 * until it crosses a boundary and the segment lengths visibly jump.
 *
 * Deriving it from the PTS makes the answer depend only on the timeline, which
 * is the thing the player is actually switching on.
 *
 * The transcoder calls this **once per frame and fans the answer out** to every
 * encoder. Six gates fed the same timestamps would agree — that property is
 * tested — but one gate cannot disagree with itself, and "cannot disagree" is a
 * stronger guarantee than "was observed to agree".
 */
export function createSegmentGate(
  segmentDurationUs: number = SEGMENT_DURATION_US,
): SegmentGate {
  let openSegment: number | undefined;
  return {
    admit(timestampUs: number): SegmentAdmission {
      const segmentIndex = segmentIndexAt(timestampUs, segmentDurationUs);
      const keyFrame = openSegment === undefined || segmentIndex !== openSegment;
      openSegment = segmentIndex;
      return { segmentIndex, keyFrame };
    },
  };
}
