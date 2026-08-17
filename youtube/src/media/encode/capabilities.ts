/**
 * Codec negotiation — asking the machine what it can encode instead of telling
 * it what it will.
 *
 * There is no codec this pipeline can assume. research/01 §3.2 puts real-world
 * AVC *encoder* availability at 66–68% of Chrome sessions, not 100%, and §4.3
 * shows the same browser answering `false` or `true` for the same codec string
 * depending only on whether it can reach a GPU. So every rung is probed with
 * `VideoEncoder.isConfigSupported` before anything is configured, and the probe
 * is handed the *exact* config the encoder will later receive — a probe that
 * validates one config while the encoder gets another is the standard way a
 * `supported: true` still ends in a closed codec.
 *
 * Preference order and its reason are the point of this file, so they are
 * stated once, here, rather than inferred from the array literal below.
 */

import type { LadderRung } from "@/media/types";

import type { LadderShape } from "./ladder";

export type CodecFamily = "avc" | "av1" | "vp9";

/**
 * AVC, then AV1, then VP9.
 *
 * **AVC first** for three independent reasons, any one of which would be
 * enough. It is on Apple's native-HLS codec list (research/02 §7 quotes
 * "H.264/AVC, HEVC/H.265, Dolby Vision, or AV1"), so an AVC ladder plays in
 * `<video src="master.m3u8">` on iOS with no player library at all. Its
 * software encoder is reachable in headless Chromium with zero flags
 * (research/01 §4.3), which is what the seed script depends on. And it is the
 * only one of the three where WebCodecs hands the muxer a ready-made
 * configuration record — `avcC` arrives complete in
 * `decoderConfig.description` (research/01 §1.4), where `vpcC` must be
 * reconstructed from the codec string and `av1C` needs an OBU parser
 * (research/02 §2.2, §2.3).
 *
 * **AV1 second** because it is the other codec on Apple's native list. If AVC
 * is unavailable, an AV1 ladder is still natively playable everywhere AVC would
 * have been, which VP9 is not. The cost is that the muxer must parse a Sequence
 * Header OBU to write `av1C`, and that AV1 software encode is materially slower
 * than AVC — research/01 §4.5 confirms AV1 encodes headless with no flags but
 * measured nothing about its speed, so "slower" here is the general
 * expectation, not a number this project has observed.
 *
 * **VP9 last** because research/02 §7 records that VP9 is absent from Apple's
 * device codec list: a `vp09` rendition is unusable by AVFoundation and only
 * reachable through an MSE player in a browser. It stays in the list because
 * "browser-only playback" still beats the progressive fallback, which is a
 * single un-adaptive file.
 */
export const CODEC_PREFERENCE: readonly CodecFamily[] = ["avc", "av1", "vp9"];

export type CodecNegotiationReason = "no-webcodecs" | "no-supported-codec";

/**
 * The failure the caller routes on.
 *
 * Both reasons mean the same thing to the upload UI — this browser cannot build
 * a ladder, fall back to uploading the file as-is and let the server or a later
 * job deal with it — but they mean different things to a bug report, so they
 * are kept apart.
 */
export class CodecNegotiationError extends Error {
  readonly reason: CodecNegotiationReason;

  constructor(reason: CodecNegotiationReason, message: string) {
    super(message);
    this.name = "CodecNegotiationError";
    this.reason = reason;
  }
}

export function isCodecNegotiationError(value: unknown): value is CodecNegotiationError {
  return value instanceof CodecNegotiationError;
}

export interface NegotiationRequest {
  readonly shapes: readonly LadderShape[];
  /** The source's frame rate. Only 1080p's AVC level depends on it. */
  readonly frameRate: number;
  readonly preference?: readonly CodecFamily[];
}

export interface NegotiatedLadder {
  readonly family: CodecFamily;
  readonly rungs: readonly LadderRung[];
  /** Names of rungs no candidate in the chosen family could encode. */
  readonly dropped: readonly string[];
}

/* ------------------------------------------------------------ codec strings -- */

interface LevelRow {
  readonly maxShortSide: number;
  readonly value: string;
}

function levelFor(table: readonly LevelRow[], shortSide: number): string {
  for (const row of table) {
    if (shortSide <= row.maxShortSide) return row.value;
  }
  return table[table.length - 1]!.value;
}

/**
 * AVC levels per rung, transcribed from research/01 §6.5.
 *
 * The level bytes are `10 × the level number, in hex` (research/01 §2.1), and
 * the assignment is the document's, not a derivation: §6.4 reproduces only part
 * of the standard's Table A-1, so computing a level from macroblock limits here
 * would mean inventing the rows it omits.
 */
const AVC_LEVELS: readonly LevelRow[] = [
  { maxShortSide: 144, value: "0d" }, // L1.3
  { maxShortSide: 240, value: "15" }, // L2.1
  { maxShortSide: 360, value: "1e" }, // L3.0
  { maxShortSide: 480, value: "1f" }, // L3.1
  { maxShortSide: 720, value: "1f" }, // L3.1
  { maxShortSide: 1080, value: "28" }, // L4.0
];

/** research/01 §6.5: 1080p60 moves to L4.2 where 1080p30 sits at L4.0. */
const AVC_LEVEL_1080P60 = "2a";

/**
 * High → Main → Baseline, the order research/01 §5 recommends.
 *
 * §6.5 assigns Baseline/Main to the lower rungs, which is a *decoder*
 * compatibility argument aimed at hardware that predates High profile. Our
 * playback targets are MSE and native HLS on devices that all decode High, so
 * the ladder asks for the profile that compresses best and lets
 * `isConfigSupported` walk it down. That is a deliberate deviation from the
 * table, not an oversight.
 */
const AVC_PROFILES = ["64", "4d", "42"] as const;

/**
 * VP9 levels, chosen as the lowest whose MaxLumaPictureSize covers the rung.
 *
 * **Honesty flag:** research/01 does not reproduce the VP9 level table, so
 * these came from the VP Codec ISOBMFF binding's level limits rather than from
 * a source this project verified. They are load-bearing in a way AV1's are not:
 * research/02 §2.2 records that WebCodecs returns no structured VP9
 * configuration record, so the muxer parses profile/level/bit-depth straight
 * out of this string to build `vpcC`. Worth re-checking against the primary
 * source before VP9 is ever the shipped family.
 */
const VP9_LEVELS: readonly LevelRow[] = [
  { maxShortSide: 144, value: "10" }, // 1.0 — 36,864 px
  { maxShortSide: 240, value: "20" }, // 2.0 — 122,880 px
  { maxShortSide: 360, value: "21" }, // 2.1 — 245,760 px
  { maxShortSide: 480, value: "30" }, // 3.0 — 552,960 px
  { maxShortSide: 720, value: "31" }, // 3.1 — 983,040 px
  { maxShortSide: 1080, value: "40" }, // 4.0 — 2,228,224 px
];

/**
 * AV1 `seq_level_idx` values, same "lowest level that fits" rule.
 *
 * Less load-bearing than VP9's: research/02 §2.3 records that `av1C` must be
 * built by parsing the bitstream's own Sequence Header OBU, so a mis-signalled
 * level here reaches only the HLS `CODECS` attribute, where it is advisory. The
 * two verified points are research/01 §2.3's `av01.0.01M.08` (level 2.1) and
 * `av01.0.04M.08` (level 3.0), both of which really encoded in Chromium.
 */
const AV1_LEVELS: readonly LevelRow[] = [
  { maxShortSide: 144, value: "00" }, // 2.0 — 147,456 px
  { maxShortSide: 240, value: "00" }, // 2.0
  { maxShortSide: 360, value: "01" }, // 2.1 — 278,784 px
  { maxShortSide: 480, value: "04" }, // 3.0 — 665,856 px
  { maxShortSide: 720, value: "05" }, // 3.1 — 1,065,024 px
  { maxShortSide: 1080, value: "08" }, // 4.0 — 2,359,296 px
];

/**
 * The codec strings to try for one rung, best first.
 *
 * AVC returns three (one per profile); AV1 and VP9 return one each, because
 * their profile axis is about bit depth and chroma subsampling rather than
 * compression tools, and this pipeline only ever produces 8-bit 4:2:0.
 */
export function codecCandidates(
  family: CodecFamily,
  shape: LadderShape,
  frameRate: number,
): string[] {
  const shortSide = Math.min(shape.width, shape.height);

  switch (family) {
    case "avc": {
      const level =
        shortSide > 720 && frameRate > 30
          ? AVC_LEVEL_1080P60
          : levelFor(AVC_LEVELS, shortSide);
      // The middle byte is the constraint_set flags, and `00` is what real
      // Chromium accepted and echoed back in research/01 §1.4's byte dump.
      return AVC_PROFILES.map((profile) => `avc1.${profile}00${level}`);
    }
    case "av1":
      // Profile 0 (8-bit 4:2:0), Main tier, 8-bit — research/01 §2.3.
      return [`av01.0.${levelFor(AV1_LEVELS, shortSide)}M.08`];
    case "vp9":
      // Profile 0, 8-bit — research/01 §2.2.
      return [`vp09.00.${levelFor(VP9_LEVELS, shortSide)}.08`];
  }
}

export function codecFamilyOf(codec: string): CodecFamily | undefined {
  if (codec.startsWith("avc1.") || codec.startsWith("avc3.")) return "avc";
  if (codec.startsWith("av01.")) return "av1";
  if (codec.startsWith("vp09.")) return "vp9";
  return undefined;
}

/* -------------------------------------------------------------- the config -- */

/**
 * The one place a `VideoEncoderConfig` is built.
 *
 * Both the probe and the real `configure()` come through here, so they cannot
 * drift apart. Three of these fields are decisions rather than defaults:
 *
 *  - `hardwareAcceleration: "no-preference"`. **Never `prefer-hardware`.**
 *    research/01 §4.3 measured `prefer-hardware` returning `false` in default
 *    headless Chromium — and then `configure()` silently closing the codec and
 *    the next `encode()` throwing `InvalidStateError` — while `no-preference`
 *    reached a working software encoder in the same run. The seed script runs
 *    headless, so asking for hardware would break it for no gain: with
 *    `no-preference` the browser still uses hardware when it has it.
 *  - `avc: { format: "avc" }`. research/01 §2.4: this is what moves SPS/PPS out
 *    of the bitstream and into `decoderConfig.description`, which *is* the
 *    `avcC` box payload byte for byte. The alternative, `annexb`, would make
 *    the muxer strip start codes and re-derive a configuration record it was
 *    already being handed.
 *  - `bitrateMode: "variable"` with `latencyMode: "quality"`. This is VOD;
 *    nothing is waiting on a frame. `"realtime"` would trade the quality we are
 *    spending the uploader's battery to get for a latency nobody observes.
 */
export function encoderConfigFor(
  rung: Pick<LadderRung, "codec" | "width" | "height" | "bitrate">,
  frameRate: number,
): VideoEncoderConfig {
  const config: VideoEncoderConfig = {
    codec: rung.codec,
    width: rung.width,
    height: rung.height,
    bitrate: rung.bitrate,
    framerate: frameRate,
    bitrateMode: "variable",
    latencyMode: "quality",
    hardwareAcceleration: "no-preference",
  };
  return codecFamilyOf(rung.codec) === "avc"
    ? { ...config, avc: { format: "avc" } }
    : config;
}

/* ---------------------------------------------------------- the negotiation -- */

interface EncoderStatic {
  isConfigSupported(
    config: VideoEncoderConfig,
  ): Promise<{ supported?: boolean; config?: VideoEncoderConfig }>;
}

function encoderStatic(): EncoderStatic | undefined {
  const candidate = (globalThis as { VideoEncoder?: Partial<EncoderStatic> })
    .VideoEncoder;
  return typeof candidate?.isConfigSupported === "function"
    ? (candidate as EncoderStatic)
    : undefined;
}

async function supports(
  encoder: EncoderStatic,
  config: VideoEncoderConfig,
): Promise<boolean> {
  try {
    const result = await encoder.isConfigSupported(config);
    return result.supported === true;
  } catch {
    // w3c/webcodecs#686 leaves it unsettled whether a config an implementation
    // dislikes throws or resolves `false`. Both have to mean "next candidate",
    // or one browser's stricter validation becomes a hard upload failure.
    return false;
  }
}

/**
 * Choose a codec family and a codec string per rung.
 *
 * The family is uniform across the ladder. HLS permits variants in different
 * codecs, but every extra family costs the muxer a sample-entry path and the
 * player a `changeType()` on each switch across the boundary — real complexity
 * bought for a case (a device that can encode 720p in AVC but 1080p only in
 * AV1) that has never been observed.
 *
 * A family is chosen if it can encode **at least one** rung, and rungs it
 * cannot reach are dropped rather than escalating to the next family. The
 * realistic failure here is a level cap on a low-end device, and a shorter AVC
 * ladder is a better outcome than a complete VP9 one that Apple's native player
 * refuses to open.
 */
export async function negotiateLadder(
  request: NegotiationRequest,
): Promise<NegotiatedLadder> {
  const encoder = encoderStatic();
  if (!encoder) {
    throw new CodecNegotiationError(
      "no-webcodecs",
      "VideoEncoder.isConfigSupported is not available. Note that WebCodecs " +
        "requires a secure context — research/01 §4.1 found the API silently " +
        "absent on a page that had never navigated, in headed Chrome as well " +
        "as headless.",
    );
  }

  const preference = request.preference ?? CODEC_PREFERENCE;

  for (const family of preference) {
    const rungs: LadderRung[] = [];
    const dropped: string[] = [];

    for (const shape of request.shapes) {
      let chosen: string | undefined;
      for (const codec of codecCandidates(family, shape, request.frameRate)) {
        const config = encoderConfigFor({ ...shape, codec }, request.frameRate);
        if (await supports(encoder, config)) {
          chosen = codec;
          break;
        }
      }
      if (chosen === undefined) dropped.push(shape.name);
      else rungs.push({ ...shape, codec: chosen });
    }

    if (rungs.length > 0) return { family, rungs, dropped };
  }

  throw new CodecNegotiationError(
    "no-supported-codec",
    `No encoder in this browser supports any rung in ${preference.join(", ")}. ` +
      "The caller should upload the source file for progressive playback " +
      "instead of a ladder.",
  );
}
