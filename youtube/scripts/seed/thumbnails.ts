/**
 * The still and near-still images: thumbnails, hover previews, channel art.
 *
 * Everything here goes through the same path the rest of the corpus does. The
 * thumbnail is a frame the clip's own painter drew at a named instant, not a
 * separate illustration; the hover preview is a real encode of a window out of
 * the middle of the clip, through `VideoEncoder` and `TrackMuxer`, not a GIF or
 * a sprite sheet. The point is the same one the whole slice is built on — a
 * fixture that took a shortcut around the pipeline is a fixture that stops
 * noticing when the pipeline breaks.
 *
 * ## Why a preview is a *standalone* fragmented MP4
 *
 * `blobKeys.preview` names a `.mp4`, and a card's hover preview is played by a
 * bare `<video src>` rather than through Media Source — there is no ABR
 * decision to make for three seconds of muted video, and attaching MSE to
 * twenty cards on a grid would be twenty `SourceBuffer`s for a hover. So the
 * init segment and its media segments are concatenated into one file:
 * `ftyp moov (moof mdat)*` is a legal, self-contained fragmented MP4 that every
 * browser plays from a plain URL. The same shape backs the progressive
 * fallback's `source.mp4`, which is why {@link buildStandaloneMp4} is one
 * function used twice rather than two that must agree.
 */

import { TrackMuxer } from "@/media/muxer";
import type { EncodedSample, PackagedSegment, TrackConfig } from "@/media/types";
import type { BlobKey, BlobStore } from "@/ports/blob-store";
import { blobKeys } from "@/ports/blob-store";

import type { EncodedRendition, EncodedSegment } from "./generate-clips";

/** What the thumbnail is rendered at. 1280×720 is YouTube's `maxres` variant. */
export const THUMBNAIL_LONG_SIDE = 1280;
export const THUMBNAIL_SHORT_SIDE = 720;

/** The `variant` component of {@link blobKeys.thumbnail}. */
const THUMBNAIL_VARIANT = "maxres";

/** Poster dimensions for a clip, keeping the clip's own orientation. */
export function posterSize(width: number, height: number): { width: number; height: number } {
  return height > width
    ? { width: THUMBNAIL_SHORT_SIDE, height: THUMBNAIL_LONG_SIDE }
    : { width: THUMBNAIL_LONG_SIDE, height: THUMBNAIL_SHORT_SIDE };
}

/**
 * Concatenate one rendition into a single self-contained fragmented MP4.
 *
 * `initSegment()` is built **after** every media segment has been packaged, and
 * that ordering is the whole reason this is a function rather than three lines
 * at each call site. `TrackMuxer` documents that an init segment built first
 * declares a duration of zero — legal, and what a live stream writes — while one
 * built last declares the total the clock actually accumulated. A VOD file whose
 * `mvhd.duration` is zero plays, and seeks to nowhere: the scrubber has no
 * length to lay itself out against.
 */
export function buildStandaloneMp4(
  track: TrackConfig,
  segments: readonly EncodedSegment[],
): Uint8Array {
  if (segments.length === 0) {
    throw new Error("A standalone MP4 needs at least one media segment.");
  }

  const muxer = new TrackMuxer({ config: track, trackId: 1 });
  const packaged: PackagedSegment[] = [];
  for (const segment of ordered(segments)) {
    packaged.push(muxer.packageSegment(rebase(segment.samples, segments)));
  }

  const init = muxer.initSegment();
  const total =
    init.byteLength + packaged.reduce((bytes, segment) => bytes + segment.data.byteLength, 0);

  const file = new Uint8Array(total);
  file.set(init, 0);
  let offset = init.byteLength;
  for (const segment of packaged) {
    file.set(segment.data, offset);
    offset += segment.data.byteLength;
  }
  return file;
}

/**
 * Shift a preview's samples so the file starts at t=0.
 *
 * A preview is cut from the middle of a clip, so its first sample carries the
 * timestamp it had in the clip's timeline. `TrackMuxer`'s clock is relative — it
 * starts at zero and accumulates the durations it is handed — but the *sample*
 * timestamps still travel into `trun`'s composition offsets, and a file whose
 * first presentation time is eight seconds while its media is three seconds long
 * is a file that appears to start eight seconds after it ends.
 *
 * Rebasing against the first sample of the *first* segment rather than of each
 * segment keeps the gaps between segments intact, which is what stops the
 * preview from playing slightly fast.
 */
function rebase(
  samples: readonly EncodedSample[],
  allSegments: readonly EncodedSegment[],
): EncodedSample[] {
  const origin = ordered(allSegments)[0]?.samples[0]?.timestampUs ?? 0;
  if (origin === 0) return [...samples];
  return samples.map((sample) => ({ ...sample, timestampUs: sample.timestampUs - origin }));
}

function ordered(segments: readonly EncodedSegment[]): EncodedSegment[] {
  return [...segments].sort((a, b) => a.index - b.index);
}

/* ============================================================= writes == */

export interface StoredImage {
  readonly key: BlobKey;
  readonly bytes: number;
}

/** The poster frame. Returns the key to write into `videos.thumbnail_key`. */
export async function storeThumbnail(
  store: BlobStore,
  videoId: string,
  jpeg: Uint8Array,
): Promise<StoredImage> {
  const key = blobKeys.thumbnail(videoId, THUMBNAIL_VARIANT);
  await store.put(key, jpeg, {
    contentType: "image/jpeg",
    contentLength: jpeg.byteLength,
    // Written once at a key that names the video and never rewritten, which is
    // the definition `adapters/blob/index.ts` gives for `immutable`.
    immutable: true,
  });
  return { key, bytes: jpeg.byteLength };
}

/** The animated hover preview. Returns the key for `videos.preview_key`. */
export async function storePreview(
  store: BlobStore,
  videoId: string,
  preview: EncodedRendition,
): Promise<StoredImage> {
  const file = buildStandaloneMp4(preview.track, preview.segments);
  const key = blobKeys.preview(videoId);
  await store.put(key, file, {
    contentType: "video/mp4",
    contentLength: file.byteLength,
    immutable: true,
  });
  return { key, bytes: file.byteLength };
}

/**
 * The untranscoded source for the progressive path.
 *
 * "Untranscoded" is a small lie here and worth naming: a real progressive upload
 * stores the file the uploader chose, byte for byte, because the browser could
 * not encode it. The corpus has no such file — there is no camera and no
 * uploader — so the progressive video's source is the top rung of an encode,
 * written whole instead of segmented. What that exercises is the half that
 * matters on this path: one file, no ladder, no playlist, served over HTTP
 * `Range` by `app/api/media/[...key]` and played by a bare `<video src>`.
 */
export async function storeProgressiveSource(
  store: BlobStore,
  videoId: string,
  rendition: EncodedRendition,
): Promise<StoredImage> {
  const file = buildStandaloneMp4(rendition.track, rendition.segments);
  const key = blobKeys.progressive(videoId, "mp4");
  await store.put(key, file, {
    contentType: "video/mp4",
    contentLength: file.byteLength,
    immutable: true,
  });
  return { key, bytes: file.byteLength };
}

export interface StoredChannelArt {
  readonly avatarKey: BlobKey;
  readonly bannerKey: BlobKey;
  readonly bytes: number;
}

/**
 * The channel avatar and banner.
 *
 * Keyed by channel id, which is generated by `newId("ch")` inside
 * `repositories/channels.ts` and is therefore *not* deterministic across seed
 * runs — see the note in `scripts/seed.ts`. Video blob keys are stable because
 * `createVideo` accepts a caller-supplied id; these are not, and the report
 * that comes with this slice says so rather than letting someone discover it
 * while diffing two `.data/blobs` trees.
 */
export async function storeChannelArt(
  store: BlobStore,
  channelId: string,
  art: { avatarJpeg: Uint8Array; bannerJpeg: Uint8Array },
): Promise<StoredChannelArt> {
  const avatarKey = blobKeys.avatar(channelId);
  const bannerKey = blobKeys.banner(channelId);

  await store.put(avatarKey, art.avatarJpeg, {
    contentType: "image/jpeg",
    contentLength: art.avatarJpeg.byteLength,
    immutable: true,
  });
  await store.put(bannerKey, art.bannerJpeg, {
    contentType: "image/jpeg",
    contentLength: art.bannerJpeg.byteLength,
    immutable: true,
  });

  return {
    avatarKey,
    bannerKey,
    bytes: art.avatarJpeg.byteLength + art.bannerJpeg.byteLength,
  };
}
