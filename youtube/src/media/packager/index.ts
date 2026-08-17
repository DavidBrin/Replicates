/**
 * The packager's public surface.
 *
 * Everything here is a pure function from a description of what was packaged to
 * a string of playlist text. It touches no storage and knows no URLs beyond the
 * ones it is handed — where the segments actually live is the delivery slice's
 * problem, and keeping that out of here is what lets the playlist emitters be
 * tested by reading their output rather than by standing up a server.
 */

export {
  HLS_VERSION_FMP4,
  buildLadderMaster,
  buildMasterPlaylist,
  buildMediaPlaylist,
  targetDurationFor,
  type LadderAudioGroup,
  type LadderMasterOptions,
  type LadderSubtitleGroup,
  type LadderVariantSource,
  type MasterPlaylistOptions,
  type MediaPlaylistOptions,
  type MediaPlaylistSegment,
  type Rendition,
  type RenditionType,
  type VariantStream,
} from "./hls";
