/**
 * The demuxer's public surface: the reciprocal of `src/media/muxer`.
 *
 * The muxer takes `EncodedSample`s and produces fragmented MP4 bytes. This takes
 * a progressive MP4 — the kind a camera, a phone or any ordinary encoder writes
 * — and produces `EncodedSample`s. Same two types at the seam
 * (`src/media/types.ts`), pointed the other way, which is what lets the
 * transcode pipeline be a straight line: demux → `VideoDecoder` → `VideoEncoder`
 * → mux, with no format that only one end understands.
 *
 * ```ts
 * const file = await openMp4(userFile);            // a File, or any ByteSource
 * const video = file.tracks.find((t) => t.kind === "video");
 * // video.config is a TrackConfig: codec string, description, timescale, size.
 * for await (const sample of video.samples()) {
 *   decoder.decode(new EncodedVideoChunk({
 *     type: sample.isKeyFrame ? "key" : "delta",
 *     timestamp: sample.timestampUs,
 *     duration: sample.durationUs,
 *     data: sample.data,
 *   }));
 * }
 * ```
 *
 * ## What this reads, and what it does not
 *
 * **Reads:** non-fragmented MP4 and MOV sample tables — `stts`, `ctts` in both
 * versions, `stsc`, `stsz` in both forms, `stco` and `co64`, `stss` present or
 * absent. `moov` anywhere in the file. `avc1`/`avc3`, `hvc1`/`hev1`,
 * `vp08`/`vp09`, `av01` and `mp4a` sample entries.
 *
 * **Does not, and says so:** fragmented MP4 (`moof`/`mvex`) — the muxer's own
 * output is the example, and it is refused by name rather than read as a file
 * with no samples. Encrypted tracks (`encv`/`enca`). Multiple `stsd` entries in
 * one track. Edit lists are decoded and reported but **not applied** — see
 * `EditListNotice` in `mp4.ts` for exactly what that costs and what to do about
 * it. Anything unreadable is either a thrown `Mp4DemuxError` or an entry in
 * `Mp4File.skippedTracks`; nothing is dropped quietly.
 */

export {
  DemuxedTrack,
  Mp4DemuxError,
  byteSourceFromBlob,
  byteSourceFromBytes,
  openMp4,
  unitsToMicroseconds,
  type ByteSource,
  type EditListNotice,
  type Mp4File,
  type SampleReadOptions,
  type SkippedTrack,
} from "./mp4";

export {
  buildSampleTable,
  decodeChunkOffsets,
  decodeCtts,
  decodeElst,
  decodeStsc,
  decodeStss,
  decodeStsz,
  decodeStts,
  isSyncSample,
  type CompositionOffsetEntry,
  type CompositionOffsets,
  type EditList,
  type EditListEntry,
  type SampleSizes,
  type SampleTable,
  type SampleToChunkEntry,
  type TimeToSampleEntry,
} from "./sample-table";
