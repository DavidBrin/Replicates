// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { TrackConfig } from "../../types";
import { buildInitSegment } from "../init-segment";
import {
  type ParsedBox,
  flattenBoxes,
  formatBoxTree,
  parseAudioSampleEntry,
  parseBoxes,
  parseFtyp,
  parseHdlr,
  parseMdhd,
  parseMvhd,
  parseStsd,
  parseTkhd,
  parseTrex,
  parseVisualSampleEntry,
  readFullBoxHeader,
  requireBox,
} from "../parser";

/**
 * Everything here goes through the parser, and none of it asserts a byte count
 * at the top level. "The init segment is 640 bytes" is satisfied by a segment
 * with the right total and the wrong contents; "walk to
 * `moov.trak.mdia.minf.stbl.stsd.avc1.avcC` and compare its payload to the
 * description we passed in" is not.
 *
 * The one exception is the worked-example case at the bottom, which asserts
 * every box's exact size — and it earns that because the numbers come from an
 * independently generated, byte-verified artifact in the research document
 * rather than from this implementation.
 */

/* -------------------------------------------------------------- fixtures -- */

/**
 * A fabricated AVCDecoderConfigurationRecord, structured exactly as research
 * §2.1 lays it out:
 *
 *     01           configurationVersion
 *     64 00 28     profile (High), compatibility, level (4.0)
 *     ff           111111b reserved | lengthSizeMinusOne = 3 (4-byte NAL prefixes)
 *     e1           111b reserved | numOfSequenceParameterSets = 1
 *     00 06 …      SPS: 2-byte length, then 6 bytes
 *     01           numOfPictureParameterSets
 *     00 04 …      PPS: 2-byte length, then 4 bytes
 *
 * 21 bytes, which is deliberate: it is the size the research's verified worked
 * example used, so the box tree below is directly comparable to it.
 */
const AVCC = Uint8Array.from([
  0x01, 0x64, 0x00, 0x28, 0xff, 0xe1, //
  0x00, 0x06, 0x67, 0x64, 0x00, 0x28, 0xac, 0xd9, //
  0x01, //
  0x00, 0x04, 0x68, 0xeb, 0xe3, 0xcb,
]);

/** A plausible `av1C`: the marker/version byte, three config bytes, a seq-header OBU. */
const AV1C = Uint8Array.from([0x81, 0x04, 0x0c, 0x00, 0x0a, 0x0b, 0x00, 0x00, 0x00]);

/** A `vpcC` body as a caller might supply it, rather than derived from the string. */
const VPCC = Uint8Array.from([0x00, 0x1f, 0x80, 0x02, 0x02, 0x02, 0x00, 0x00]);

/**
 * AudioSpecificConfig for AAC-LC, 48 kHz, stereo — research §2.4:
 * `audioObjectType=2` (5 bits), `samplingFrequencyIndex=3` (4 bits),
 * `channelConfiguration=2` (4 bits), then 3 padding bits.
 *
 *     00010 0011 0010 000  →  0x11 0x90
 */
const AAC_LC_48K_STEREO = Uint8Array.from([0x11, 0x90]);

const AVC_TRACK: TrackConfig = {
  kind: "video",
  codec: "avc1.640028",
  description: AVCC,
  timescale: 1_000_000,
  width: 1920,
  height: 1080,
};

const AAC_TRACK: TrackConfig = {
  kind: "audio",
  codec: "mp4a.40.2",
  description: AAC_LC_48K_STEREO,
  timescale: 48_000,
  sampleRate: 48_000,
  channelCount: 2,
};

/* ---------------------------------------------------------------- helpers -- */

/**
 * The recursive size audit. Two independent statements:
 *
 *   1. the top-level boxes tile the buffer exactly, and
 *   2. every container's declared size equals its own prefix plus the sum of
 *      its children's declared sizes.
 *
 * Neither reuses the muxer's arithmetic — the sizes come back out of the parsed
 * bytes. Leaf boxes are covered by the parser itself, which refuses to parse a
 * sibling run that does not tile its parent, so a leaf whose size is wrong by
 * even one byte cannot reach these assertions.
 */
function auditSizes(boxes: readonly ParsedBox[], totalBytes: number): void {
  const topLevel = boxes.reduce((sum, box) => sum + box.size, 0);
  expect(topLevel, `top-level boxes must tile the buffer:\n${formatBoxTree(boxes)}`).toBe(
    totalBytes,
  );

  for (const box of flattenBoxes(boxes)) {
    if (box.children.length === 0) continue;
    const prefixBytes = box.childrenOffset - box.offset;
    const childBytes = box.children.reduce((sum, child) => sum + child.size, 0);
    expect(prefixBytes + childBytes, `${box.type} declares size ${box.size}`).toBe(box.size);
  }
}

function videoAudioInit(durationUs: number): Uint8Array {
  return buildInitSegment({
    tracks: [
      { id: 1, config: AVC_TRACK },
      { id: 2, config: AAC_TRACK },
    ],
    movieTimescale: 1000,
    durationUs,
  });
}

/* ------------------------------------------------------------------ tests -- */

describe("shape", () => {
  it("is exactly ftyp followed by moov, and nothing else", () => {
    // Research §6.1: an init segment "is defined in this specification as a
    // single File Type Box followed by a single Movie Box". Appending anything
    // makes the bytes not an init segment.
    const boxes = parseBoxes(videoAudioInit(0));
    expect(boxes.map((box) => box.type)).toEqual(["ftyp", "moov"]);
  });

  it("declares every box's size correctly, recursively", () => {
    const bytes = videoAudioInit(10_500_000);
    auditSizes(parseBoxes(bytes), bytes.byteLength);
  });

  it("declares brands it actually conforms to", () => {
    const ftyp = parseFtyp(requireBox(parseBoxes(videoAudioInit(0)), "ftyp"));
    expect(ftyp.majorBrand).toBe("iso5");
    // iso5 for default-base-is-moof, iso6 for tfdt-on-every-traf and trun v1,
    // mp41 for readers that know neither — research §1.2.
    expect(ftyp.compatibleBrands).toEqual(["iso5", "iso6", "mp41"]);
  });

  it("orders each track's boxes the way the spec requires", () => {
    const boxes = parseBoxes(videoAudioInit(0));
    expect(requireBox(boxes, "moov").children.map((c) => c.type)).toEqual([
      "mvhd",
      "trak",
      "trak",
      "mvex",
    ]);
    expect(requireBox(boxes, "moov.trak.mdia").children.map((c) => c.type)).toEqual([
      "mdhd",
      "hdlr",
      "minf",
    ]);
    expect(requireBox(boxes, "moov.trak.mdia.minf").children.map((c) => c.type)).toEqual([
      "vmhd",
      "dinf",
      "stbl",
    ]);
    expect(requireBox(boxes, "moov.trak[1].mdia.minf").children.map((c) => c.type)).toEqual([
      "smhd",
      "dinf",
      "stbl",
    ]);
  });
});

describe("mvex and trex", () => {
  /**
   * The failure this guards is the quietest one in the format. Without `mvex`,
   * a reader sees `moov`'s empty sample tables and concludes the file has zero
   * samples rather than that samples arrive in fragments — no error, no
   * warning, just permanent blank video (research §10).
   */
  it("declares mvex, so the file is understood as fragmented", () => {
    const boxes = parseBoxes(videoAudioInit(0));
    expect(requireBox(boxes, "moov.mvex")).toBeDefined();
  });

  it("declares one trex per track, keyed to the same track_IDs as the tkhds", () => {
    const boxes = parseBoxes(videoAudioInit(0));
    const trexes = requireBox(boxes, "moov.mvex").children;
    expect(trexes.map((box) => box.type)).toEqual(["trex", "trex"]);

    const trackIds = [0, 1].map((i) => parseTkhd(requireBox(boxes, `moov.trak[${i}].tkhd`)).trackId);
    expect(trexes.map((box) => parseTrex(box).trackId)).toEqual(trackIds);
  });

  it("points each trex at the single stsd entry and zeroes its defaults", () => {
    // The defaults are unused because every `tfhd` supplies its own
    // (research §1.11); the box has to exist regardless.
    const trex = parseTrex(requireBox(parseBoxes(videoAudioInit(0)), "moov.mvex.trex"));
    expect(trex.defaultSampleDescriptionIndex).toBe(1);
    expect(trex.defaultSampleDuration).toBe(0);
    expect(trex.defaultSampleSize).toBe(0);
    expect(trex.defaultSampleFlags).toBe(0);
  });
});

describe("timescales", () => {
  /**
   * The case is built so that a conflation cannot pass by coincidence: the
   * movie timescale is 1000, the video track's is 1e6 and the audio track's is
   * 48000, so the same 10.5 seconds is three different integers. Reusing the
   * track timescale for `tkhd.duration` — the documented habit-driven bug in
   * research §10 — makes this test fail by a factor of a thousand.
   */
  const DURATION_US = 10_500_000;

  it("writes tkhd.duration in the movie timescale and mdhd.duration in the track's", () => {
    const boxes = parseBoxes(videoAudioInit(DURATION_US));

    const mvhd = parseMvhd(requireBox(boxes, "moov.mvhd"));
    expect(mvhd.timescale).toBe(1000);
    expect(mvhd.duration).toBe(10_500);

    const videoTkhd = parseTkhd(requireBox(boxes, "moov.trak.tkhd"));
    const videoMdhd = parseMdhd(requireBox(boxes, "moov.trak.mdia.mdhd"));
    expect(videoMdhd.timescale).toBe(1_000_000);
    expect(videoTkhd.duration).toBe(10_500); // movie timescale
    expect(videoMdhd.duration).toBe(10_500_000); // track timescale

    const audioTkhd = parseTkhd(requireBox(boxes, "moov.trak[1].tkhd"));
    const audioMdhd = parseMdhd(requireBox(boxes, "moov.trak[1].mdia.mdhd"));
    expect(audioMdhd.timescale).toBe(48_000);
    expect(audioTkhd.duration).toBe(10_500); // movie timescale, same as video's
    expect(audioMdhd.duration).toBe(504_000); // track timescale
  });

  it("keeps both tkhd durations equal even though the tracks' timescales differ", () => {
    // Both express the same wall-clock length in the same unit. If one of them
    // ever picks up its own track's timescale, they stop agreeing.
    const boxes = parseBoxes(videoAudioInit(DURATION_US));
    expect(parseTkhd(requireBox(boxes, "moov.trak.tkhd")).duration).toBe(
      parseTkhd(requireBox(boxes, "moov.trak[1].tkhd")).duration,
    );
  });

  it("declares an unknown duration as zero rather than guessing", () => {
    const boxes = parseBoxes(videoAudioInit(0));
    expect(parseMvhd(requireBox(boxes, "moov.mvhd")).duration).toBe(0);
    expect(parseTkhd(requireBox(boxes, "moov.trak.tkhd")).duration).toBe(0);
    expect(parseMdhd(requireBox(boxes, "moov.trak.mdia.mdhd")).duration).toBe(0);
  });
});

describe("movie and track headers", () => {
  it("writes a next_track_ID above every track it declared", () => {
    const boxes = parseBoxes(videoAudioInit(0));
    expect(parseMvhd(requireBox(boxes, "moov.mvhd")).nextTrackId).toBe(3);
  });

  it("writes the unity matrix with a 2.30 fixed-point bottom-right cell", () => {
    // 0x40000000 is 1.0 in 2.30. Writing 0x00010000 there looks identity-ish
    // and distorts geometry in the players that apply the matrix (research §1.9).
    const boxes = parseBoxes(videoAudioInit(0));
    const expected = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
    expect(parseMvhd(requireBox(boxes, "moov.mvhd")).matrix).toEqual(expected);
    expect(parseTkhd(requireBox(boxes, "moov.trak.tkhd")).matrix).toEqual(expected);
  });

  it("enables the track in the movie and in previews", () => {
    const tkhd = parseTkhd(requireBox(parseBoxes(videoAudioInit(0)), "moov.trak.tkhd"));
    expect(tkhd.flags).toBe(0x000007);
  });

  it("gives video display dimensions and volume, and audio the reverse", () => {
    const boxes = parseBoxes(videoAudioInit(0));
    const video = parseTkhd(requireBox(boxes, "moov.trak.tkhd"));
    expect([video.width, video.height]).toEqual([1920, 1080]);
    expect(video.volume).toBe(0);

    const audio = parseTkhd(requireBox(boxes, "moov.trak[1].tkhd"));
    // An audio track has no display geometry; writing the video's here makes
    // some players lay out a phantom surface for it.
    expect([audio.width, audio.height]).toEqual([0, 0]);
    expect(audio.volume).toBe(1);
  });

  it("declares the media language as undetermined rather than inventing one", () => {
    const boxes = parseBoxes(videoAudioInit(0));
    expect(parseMdhd(requireBox(boxes, "moov.trak.mdia.mdhd")).language).toBe("und");
  });

  it("writes the handler type and name each track kind requires", () => {
    const boxes = parseBoxes(videoAudioInit(0));
    expect(parseHdlr(requireBox(boxes, "moov.trak.mdia.hdlr"))).toEqual({
      handlerType: "vide",
      name: "VideoHandler",
    });
    expect(parseHdlr(requireBox(boxes, "moov.trak[1].mdia.hdlr"))).toEqual({
      handlerType: "soun",
      name: "SoundHandler",
    });
  });

  it("writes vmhd with flags 1 and smhd with flags 0", () => {
    // vmhd is the one box the spec calls out as requiring a non-zero flags
    // field (research §1.8); a vmhd with flags 0 is malformed.
    const boxes = parseBoxes(videoAudioInit(0));
    expect(readFullBoxHeader(requireBox(boxes, "moov.trak.mdia.minf.vmhd")).flags).toBe(1);
    expect(readFullBoxHeader(requireBox(boxes, "moov.trak[1].mdia.minf.smhd")).flags).toBe(0);
  });

  it("declares the media as self-contained, with no URL string at all", () => {
    const boxes = parseBoxes(videoAudioInit(0));
    const dref = requireBox(boxes, "moov.trak.mdia.minf.dinf.dref");
    expect(dref.children.map((box) => box.type)).toEqual(["url "]);

    const url = requireBox(boxes, "moov.trak.mdia.minf.dinf.dref.url ");
    expect(readFullBoxHeader(url).flags).toBe(1);
    // "no string (not even an empty one) shall be supplied" — research §1.9.
    // The payload is the 4-byte version/flags word and nothing more.
    expect(url.payload.byteLength).toBe(4);
    expect(url.size).toBe(12);
  });
});

describe("the empty sample tables", () => {
  it("declares stbl's four tables with zero entries", () => {
    const boxes = parseBoxes(videoAudioInit(0));
    const stbl = requireBox(boxes, "moov.trak.mdia.minf.stbl");
    expect(stbl.children.map((box) => box.type)).toEqual([
      "stsd",
      "stts",
      "stsc",
      "stsz",
      "stco",
    ]);

    // stts/stsc/stco carry one count; stsz carries two, both zero.
    for (const type of ["stts", "stsc", "stco"] as const) {
      const box = requireBox(boxes, `moov.trak.mdia.minf.stbl.${type}`);
      expect(box.size, type).toBe(16);
      expect([...box.payload.subarray(4)], type).toEqual([0, 0, 0, 0]);
    }
    const stsz = requireBox(boxes, "moov.trak.mdia.minf.stbl.stsz");
    expect(stsz.size).toBe(20);
    expect([...stsz.payload.subarray(4)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("omits stss entirely", () => {
    // Its absence means "every sample is a sync sample", which is meaningless
    // for an empty table; sync is signalled per-sample in `trun` (research §1.10).
    const boxes = parseBoxes(videoAudioInit(0));
    const types = requireBox(boxes, "moov.trak.mdia.minf.stbl").children.map((b) => b.type);
    expect(types).not.toContain("stss");
  });
});

describe("sample entries", () => {
  function stsdFor(config: TrackConfig): ParsedBox {
    const boxes = parseBoxes(buildInitSegment({ tracks: [{ id: 1, config }] }));
    return requireBox(boxes, "moov.trak.mdia.minf.stbl.stsd");
  }

  it("carries exactly one entry, for the life of the track", () => {
    const stsd = parseStsd(stsdFor(AVC_TRACK));
    expect(stsd.entryCount).toBe(1);
    expect(stsd.entries).toHaveLength(1);
  });

  it("builds a well-formed avc1 entry carrying the avcC we supplied", () => {
    const stsd = stsdFor(AVC_TRACK);
    const entry = stsd.children[0];
    expect(entry?.type).toBe("avc1");

    const visual = parseVisualSampleEntry(entry as ParsedBox);
    expect(visual).toEqual({
      dataReferenceIndex: 1,
      width: 1920,
      height: 1080,
      horizontalResolution: 72,
      verticalResolution: 72,
      frameCount: 1,
      depth: 0x18,
    });

    const avcC = requireBox([stsd], "stsd.avc1.avcC");
    expect([...avcC.payload]).toEqual([...AVCC]);
  });

  it("builds a well-formed av01 entry carrying the av1C we supplied", () => {
    // av1C is the one record that genuinely cannot be derived — its fields come
    // from the Sequence Header OBU (research §2.3), so verbatim is the only
    // correct handling and this asserts nothing was "corrected" on the way.
    const stsd = stsdFor({
      kind: "video",
      codec: "av01.0.04M.08",
      description: AV1C,
      timescale: 1_000_000,
      width: 1280,
      height: 720,
    });
    expect(stsd.children[0]?.type).toBe("av01");
    expect(parseVisualSampleEntry(stsd.children[0] as ParsedBox).width).toBe(1280);
    expect([...requireBox([stsd], "stsd.av01.av1C").payload]).toEqual([...AV1C]);
  });

  it("builds a well-formed vp09 entry from a supplied vpcC", () => {
    const stsd = stsdFor({
      kind: "video",
      codec: "vp09.00.10.08",
      description: VPCC,
      timescale: 1_000_000,
      width: 854,
      height: 480,
    });
    expect(stsd.children[0]?.type).toBe("vp09");

    const vpcC = requireBox([stsd], "stsd.vp09.vpcC");
    expect(readFullBoxHeader(vpcC).version).toBe(1); // version 0 is deprecated
    expect([...vpcC.payload.subarray(4)]).toEqual([...VPCC]);
  });

  it("derives vpcC from the codec string when WebCodecs gave no description", () => {
    /**
     * VP9 is the one codec where a missing `description` is expected rather
     * than an error: research §2.2 records that WebCodecs hands back only a
     * codec string for it, and every mandatory `vpcC` field is in that string.
     * `vp09.02.10.10` is profile 2, level 1.0, 10-bit.
     */
    const stsd = stsdFor({
      kind: "video",
      codec: "vp09.02.10.10",
      timescale: 1_000_000,
      width: 640,
      height: 360,
    });
    const body = requireBox([stsd], "stsd.vp09.vpcC").payload.subarray(4);
    expect(body[0]).toBe(2); // profile
    expect(body[1]).toBe(10); // level
    expect(body[2]).toBe((10 << 4) | (0 << 1) | 0); // bitDepth | chroma | fullRange
    expect([body[3], body[4], body[5]]).toEqual([2, 2, 2]); // colour: unspecified
    expect([body[6], body[7]]).toEqual([0, 0]); // codecInitializationDataSize
  });

  it("builds a well-formed mp4a entry with the AudioSpecificConfig inside esds", () => {
    const stsd = stsdFor(AAC_TRACK);
    expect(stsd.children[0]?.type).toBe("mp4a");

    expect(parseAudioSampleEntry(stsd.children[0] as ParsedBox)).toEqual({
      dataReferenceIndex: 1,
      channelCount: 2,
      sampleSize: 16,
      sampleRate: 48_000,
    });

    const esds = requireBox([stsd], "stsd.mp4a.esds");
    const payload = [...esds.payload];
    // version/flags, then ES_Descr (0x03) with the 4-byte expandable length.
    expect(payload.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(payload.slice(4, 9)).toEqual([0x03, 0x80, 0x80, 0x80, 0x20 + AAC_LC_48K_STEREO.length]);
    // DecoderConfigDescr (0x04), then its objectTypeIndication and streamType.
    expect(payload.slice(12, 17)).toEqual([
      0x04,
      0x80,
      0x80,
      0x80,
      0x12 + AAC_LC_48K_STEREO.length,
    ]);
    expect(payload.slice(17, 19)).toEqual([0x40, 0x15]);
    // DecSpecificInfo (0x05) wrapping the config, then SLConfigDescr (0x06).
    expect(payload.slice(30, 35)).toEqual([0x05, 0x80, 0x80, 0x80, AAC_LC_48K_STEREO.length]);
    expect(payload.slice(35, 37)).toEqual([...AAC_LC_48K_STEREO]);
    expect(payload.slice(37)).toEqual([0x06, 0x80, 0x80, 0x80, 0x01, 0x02]);
  });
});

describe("rejections", () => {
  it("refuses a codec it has no sample entry for", () => {
    expect(() =>
      buildInitSegment({
        tracks: [{ id: 1, config: { ...AVC_TRACK, codec: "hvc1.1.6.L93.B0" } }],
      }),
    ).toThrow(/Unsupported codec/);
  });

  it("refuses an AVC track with no avcC to write", () => {
    // With `avc: { format: "avc" }` the SPS/PPS are not in the bitstream at
    // all, so there is nothing to fall back to (research §2.1).
    expect(() =>
      buildInitSegment({
        tracks: [{ id: 1, config: { ...AVC_TRACK, description: undefined } }],
      }),
    ).toThrow(/needs a decoder configuration record for its avcC/);
  });

  it("refuses an AV1 track with no av1C, rather than synthesising one", () => {
    expect(() =>
      buildInitSegment({
        tracks: [
          {
            id: 1,
            config: { kind: "video", codec: "av01.0.04M.08", timescale: 1e6, width: 8, height: 8 },
          },
        ],
      }),
    ).toThrow(/needs a decoder configuration record for its av1C/);
  });

  it("refuses an AAC track with no AudioSpecificConfig", () => {
    expect(() =>
      buildInitSegment({ tracks: [{ id: 1, config: { ...AAC_TRACK, description: undefined } }] }),
    ).toThrow(/needs a decoder configuration record for its esds/);
  });

  it("refuses a video track with no dimensions", () => {
    expect(() =>
      buildInitSegment({
        tracks: [{ id: 1, config: { ...AVC_TRACK, width: undefined, height: undefined } }],
      }),
    ).toThrow(/needs width and height/);
  });

  it("refuses track_ID 0, duplicates, and an empty track list", () => {
    expect(() => buildInitSegment({ tracks: [] })).toThrow(/at least one track/);
    expect(() => buildInitSegment({ tracks: [{ id: 0, config: AVC_TRACK }] })).toThrow(
      /must be a positive integer/,
    );
    expect(() =>
      buildInitSegment({
        tracks: [
          { id: 1, config: AVC_TRACK },
          { id: 1, config: AAC_TRACK },
        ],
      }),
    ).toThrow(/appears twice/);
  });
});

describe("the research's byte-verified worked example", () => {
  /**
   * research/02-fmp4-hls-packaging.md closes with a 640-byte init segment —
   * one `avc1` track, a 21-byte fabricated `avcC` — that was generated by a
   * separate Python script against the field tables and parsed back to confirm
   * every declared size. Reproducing its exact box tree is the strongest
   * available evidence that this implementation read the tables the same way,
   * because the numbers were not derived from this code.
   */
  const bytes = buildInitSegment({
    tracks: [
      {
        id: 1,
        config: {
          kind: "video",
          codec: "avc1.640028",
          description: AVCC,
          timescale: 1_000_000,
          width: 1920,
          height: 1080,
        },
      },
    ],
    movieTimescale: 1000,
  });

  it("produces the documented box tree, size for size", () => {
    expect(formatBoxTree(parseBoxes(bytes))).toBe(
      [
        "ftyp size=28",
        "moov size=612",
        "  mvhd size=108",
        "  trak size=456",
        "    tkhd size=92",
        "    mdia size=356",
        "      mdhd size=32",
        "      hdlr size=45",
        "      minf size=271",
        "        vmhd size=20",
        "        dinf size=36",
        "          dref size=28",
        "            url  size=12",
        "        stbl size=207",
        "          stsd size=131",
        "            avc1 size=115",
        "              avcC size=29",
        "          stts size=16",
        "          stsc size=16",
        "          stsz size=20",
        "          stco size=16",
        "  mvex size=40",
        "    trex size=32",
      ].join("\n"),
    );
    expect(bytes.byteLength).toBe(640);
  });

  it("matches the documented hex dump of the first 48 bytes", () => {
    const hex = [...bytes.subarray(0, 0x48)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(" ");
    expect(hex).toBe(
      [
        "00 00 00 1c", "66 74 79 70", "69 73 6f 35", "00 00 02 00", // ftyp
        "69 73 6f 35", "69 73 6f 36", "6d 70 34 31", //               brands
        "00 00 02 64", "6d 6f 6f 76", //                              moov, 612
        "00 00 00 6c", "6d 76 68 64", "00 00 00 00", //               mvhd, 108
        "00 00 00 00", "00 00 00 00", //                              times
        "00 00 03 e8", "00 00 00 00", //                              timescale 1000, duration 0
        "00 01 00 00", "01 00", "00 00", //                           rate, volume, reserved
      ].join(" "),
    );
  });
});
