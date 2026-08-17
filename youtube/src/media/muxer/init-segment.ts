/**
 * The initialization segment: `ftyp` + `moov`, and nothing else.
 *
 * "An ISO BMFF initialization segment is defined in this specification as a
 * single File Type Box (`ftyp`) followed by a single Movie Box (`moov`)"
 * (research §6.1). Not a header we may extend — appending anything else to the
 * bytes handed to `SourceBuffer.appendBuffer` makes them not an init segment.
 *
 * It carries no samples. Its entire job is to describe the tracks: the codec
 * configuration record in `stsd` (which MSE requires out-of-band, in this
 * segment, never parsed from the bitstream later), and `mvex`, which is the
 * declaration that samples are coming in fragments rather than that there are
 * none.
 *
 * The builder takes an array of tracks even though the recommended shape is one
 * track per init segment — a CMAF track file carries exactly one, and this
 * project ships video rungs and a shared audio rendition as separate playlists
 * for the reasons in research §9. The array exists because the multi-track case
 * is the one where `trun.data_offset` arithmetic can go wrong, and a builder
 * that cannot express it is a builder whose offset code cannot be tested.
 */

import type { TrackConfig } from "../types";

import {
  DEFAULT_MOVIE_TIMESCALE,
  microsecondsToTimescale,
  writeDinf,
  writeFtyp,
  writeHdlr,
  writeMdhd,
  writeMvhd,
  writeSmhd,
  writeStbl,
  writeTkhd,
  writeTrex,
  writeVmhd,
} from "./boxes";
import { ByteWriter } from "./writer";

export interface InitTrack {
  /**
   * `tkhd.track_ID`. Never 0 — the spec reserves it — and never reused within a
   * movie. Video conventionally takes 1 and audio 2.
   */
  readonly id: number;
  readonly config: TrackConfig;
}

export interface InitSegmentOptions {
  readonly tracks: readonly InitTrack[];
  /**
   * `mvhd.timescale`. Only denominates `mvhd.duration` and `tkhd.duration`, and
   * deliberately unrelated to any track's media timescale (research §5.1).
   */
  readonly movieTimescale?: number;
  /**
   * Total presentation duration in microseconds, or omitted while the total is
   * not yet known. Zero is the legal "unknown" value and is what a live or
   * still-encoding stream writes.
   */
  readonly durationUs?: number;
}

/**
 * Builds `ftyp` + `moov` for one or more tracks.
 *
 * The two duration fields below are the point at which the timescale mix-up in
 * research §10 happens, so they are computed side by side, from the same
 * microsecond input, through the same conversion, differing only in the
 * timescale argument — `tkhd` in the movie's, `mdhd` in the track's. Written as
 * two separate call sites in two separate files they would eventually agree by
 * accident and then stop.
 */
export function buildInitSegment(options: InitSegmentOptions): Uint8Array {
  const { tracks } = options;
  const movieTimescale = options.movieTimescale ?? DEFAULT_MOVIE_TIMESCALE;
  const durationUs = options.durationUs ?? 0;

  if (tracks.length === 0) {
    throw new Error("An init segment needs at least one track");
  }
  const seen = new Set<number>();
  for (const track of tracks) {
    if (!Number.isInteger(track.id) || track.id < 1) {
      throw new Error(`track_ID ${track.id} is invalid: it must be a positive integer`);
    }
    if (seen.has(track.id)) {
      throw new Error(`track_ID ${track.id} appears twice; track IDs are unique per movie`);
    }
    seen.add(track.id);
  }

  const w = new ByteWriter(1024);
  writeFtyp(w);

  const moov = w.beginBox("moov");
  writeMvhd(w, {
    timescale: movieTimescale,
    duration: microsecondsToTimescale(durationUs, movieTimescale),
    nextTrackId: Math.max(...tracks.map((track) => track.id)) + 1,
  });

  for (const track of tracks) {
    writeTrak(w, track, movieTimescale, durationUs);
  }

  // `mvex` last, after every `trak`, because a reader that has not yet seen the
  // tracks cannot make sense of the `trex` defaults that reference them.
  const mvex = w.beginBox("mvex");
  for (const track of tracks) writeTrex(w, track.id);
  w.endBox(mvex);

  w.endBox(moov);
  return w.finish();
}

/**
 * One `trak`: `tkhd` then `mdia` → (`mdhd`, `hdlr`, `minf`), and `minf` →
 * (`vmhd`|`smhd`, `dinf`, `stbl`). The order is mandatory, not stylistic.
 */
function writeTrak(
  w: ByteWriter,
  track: InitTrack,
  movieTimescale: number,
  durationUs: number,
): void {
  const { config } = track;

  const trak = w.beginBox("trak");
  writeTkhd(w, {
    trackId: track.id,
    kind: config.kind,
    durationInMovieTimescale: microsecondsToTimescale(durationUs, movieTimescale),
    // A `tkhd` on an audio track carries 0×0: the fields are display geometry
    // and an audio track has none. Writing the container's video dimensions
    // here would make some players lay out a phantom video surface for it.
    width: config.kind === "video" ? (config.width ?? 0) : 0,
    height: config.kind === "video" ? (config.height ?? 0) : 0,
  });

  const mdia = w.beginBox("mdia");
  writeMdhd(w, {
    timescale: config.timescale,
    duration: microsecondsToTimescale(durationUs, config.timescale),
  });
  writeHdlr(w, config.kind);

  const minf = w.beginBox("minf");
  if (config.kind === "video") writeVmhd(w);
  else writeSmhd(w);
  writeDinf(w);
  writeStbl(w, config);
  w.endBox(minf);

  w.endBox(mdia);
  w.endBox(trak);
}
