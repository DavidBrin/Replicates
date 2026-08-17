// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { LadderRung } from "../../types";
import {
  buildLadderMaster,
  buildMasterPlaylist,
  buildMediaPlaylist,
  targetDurationFor,
  type MediaPlaylistSegment,
  type Rendition,
} from "../hls";

/**
 * A playlist is text, so an emitter can produce something that *looks* right
 * and is not: an attribute in the wrong syntactic class, a target duration a
 * fraction below an actual segment, a group reference nothing declares. None of
 * those stop a lenient player from starting, and all of them are rejected by
 * Apple's validator or by a different player on a different day.
 *
 * So rather than compare against expected strings — which would only prove the
 * emitter is consistent with itself — the structural tests below run the output
 * through `readMediaPlaylistStrictly` / `readAttributeList`, two small readers
 * written here from RFC 8216 §4.1–§4.3 and deliberately unforgiving. They know
 * nothing about the emitter and share no code with it.
 */

/* -------------------------------------------------- a strict RFC 8216 reader -- */

interface StrictSegment {
  readonly durationSeconds: number;
  readonly title: string;
  readonly uri: string;
}

interface StrictPlaylist {
  readonly tags: ReadonlyMap<string, string>;
  readonly segments: readonly StrictSegment[];
}

/**
 * Reads a Media Playlist under a strict reading of RFC 8216 §4.
 *
 * Enforced here: the file starts with `#EXTM3U` on its own first line; every
 * URI line is immediately preceded by an `EXTINF`; `EXTINF` carries a duration
 * and a comma; `EXT-X-TARGETDURATION` is a decimal-integer no smaller than any
 * segment; `EXT-X-MAP` implies version ≥ 6; `EXT-X-ENDLIST` is last; and no tag
 * that must be unique appears twice.
 */
function readMediaPlaylistStrictly(text: string): StrictPlaylist {
  const lines = text.split("\n");
  if (lines.at(-1) !== "") throw new Error("Playlist does not end with a line terminator");

  const body = lines.slice(0, -1);
  if (body[0] !== "#EXTM3U") throw new Error("First line must be exactly #EXTM3U");

  const tags = new Map<string, string>();
  const segments: StrictSegment[] = [];
  let pendingExtinf: { duration: number; title: string } | undefined;
  let sawEndList = false;

  for (const [index, line] of body.slice(1).entries()) {
    if (line === "") continue;
    if (sawEndList) throw new Error(`Line ${index + 2} follows #EXT-X-ENDLIST`);

    if (line.startsWith("#EXT")) {
      const colon = line.indexOf(":");
      const name = colon === -1 ? line.slice(1) : line.slice(1, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1);

      if (name === "EXTINF") {
        if (!value.includes(",")) throw new Error("EXTINF must carry a comma before its title");
        const [durationText, ...rest] = value.split(",");
        const duration = Number(durationText);
        if (!Number.isFinite(duration) || duration < 0) {
          throw new Error(`EXTINF duration "${durationText}" is not a number`);
        }
        pendingExtinf = { duration, title: rest.join(",") };
        continue;
      }

      if (name === "EXT-X-ENDLIST") sawEndList = true;
      if (tags.has(name)) throw new Error(`Tag ${name} appears more than once`);
      tags.set(name, value);
      continue;
    }

    if (line.startsWith("#")) continue; // a comment, which is always legal

    if (pendingExtinf === undefined) {
      throw new Error(`URI "${line}" is not preceded by an EXTINF`);
    }
    segments.push({
      durationSeconds: pendingExtinf.duration,
      title: pendingExtinf.title,
      uri: line,
    });
    pendingExtinf = undefined;
  }

  if (pendingExtinf !== undefined) throw new Error("An EXTINF has no URI after it");
  if (segments.length === 0) throw new Error("A media playlist needs at least one segment");

  const target = tags.get("EXT-X-TARGETDURATION");
  if (target === undefined) throw new Error("EXT-X-TARGETDURATION is REQUIRED");
  if (!/^\d+$/.test(target)) throw new Error(`EXT-X-TARGETDURATION "${target}" is not an integer`);
  for (const segment of segments) {
    if (segment.durationSeconds > Number(target)) {
      throw new Error(
        `Segment "${segment.uri}" runs ${segment.durationSeconds}s, past the ${target}s target`,
      );
    }
  }

  const version = Number(tags.get("EXT-X-VERSION") ?? "1");
  if (tags.has("EXT-X-MAP") && version < 6) {
    throw new Error(`EXT-X-MAP needs EXT-X-VERSION 6 or above, saw ${version}`);
  }

  return { tags, segments };
}

/**
 * Splits an attribute list per RFC 8216 §4.2, respecting quoted-strings — a
 * naive `split(",")` would cut `CODECS="avc1.640028,mp4a.40.2"` in half, which
 * is exactly the sort of thing an emitter test should not be able to hide.
 */
function readAttributeList(value: string): Map<string, string> {
  const attributes = new Map<string, string>();
  let at = 0;

  while (at < value.length) {
    const equals = value.indexOf("=", at);
    if (equals === -1) throw new Error(`Attribute at ${at} has no "="`);
    const name = value.slice(at, equals);
    if (!/^[A-Z0-9-]+$/.test(name)) throw new Error(`"${name}" is not an AttributeName`);

    let raw: string;
    if (value[equals + 1] === '"') {
      const close = value.indexOf('"', equals + 2);
      if (close === -1) throw new Error(`Unterminated quoted-string for ${name}`);
      raw = value.slice(equals + 2, close);
      at = close + 1;
      if (at < value.length && value[at] !== ",") {
        throw new Error(`Junk after the quoted value of ${name}`);
      }
      at += 1;
    } else {
      const comma = value.indexOf(",", equals + 1);
      raw = comma === -1 ? value.slice(equals + 1) : value.slice(equals + 1, comma);
      at = comma === -1 ? value.length : comma + 1;
    }

    if (attributes.has(name)) throw new Error(`Attribute ${name} appears twice`);
    attributes.set(name, raw);
  }

  return attributes;
}

function streamInfLines(master: string): { attributes: Map<string, string>; uri: string }[] {
  const lines = master.split("\n");
  const variants: { attributes: Map<string, string>; uri: string }[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;
    const uri = lines[index + 1];
    if (uri === undefined || uri === "" || uri.startsWith("#")) {
      throw new Error("EXT-X-STREAM-INF must be followed immediately by a URI line");
    }
    variants.push({ attributes: readAttributeList(line.slice("#EXT-X-STREAM-INF:".length)), uri });
  }
  return variants;
}

function mediaLines(master: string): Map<string, string>[] {
  return master
    .split("\n")
    .filter((line) => line.startsWith("#EXT-X-MEDIA:"))
    .map((line) => readAttributeList(line.slice("#EXT-X-MEDIA:".length)));
}

/* -------------------------------------------------------------- fixtures -- */

const LADDER: readonly LadderRung[] = [
  { name: "480p", width: 854, height: 480, bitrate: 1_200_000, codec: "avc1.640028" },
  { name: "720p", width: 1280, height: 720, bitrate: 2_800_000, codec: "avc1.640028" },
  { name: "1080p", width: 1920, height: 1080, bitrate: 5_000_000, codec: "avc1.640028" },
];

function evenSegments(count: number, seconds: number): MediaPlaylistSegment[] {
  return Array.from({ length: count }, (_, i) => ({
    uri: `segment${i}.m4s`,
    durationSeconds: seconds,
  }));
}

/* ---------------------------------------------------------- media playlist -- */

describe("media playlist", () => {
  it("parses under a strict reading of RFC 8216", () => {
    const text = buildMediaPlaylist({
      segments: evenSegments(3, 6.006),
      initSegmentUri: "init.mp4",
      playlistType: "VOD",
    });

    const playlist = readMediaPlaylistStrictly(text);
    expect(playlist.tags.get("EXT-X-VERSION")).toBe("6");
    expect(playlist.tags.get("EXT-X-PLAYLIST-TYPE")).toBe("VOD");
    expect(playlist.tags.get("EXT-X-MAP")).toBe('URI="init.mp4"');
    expect(playlist.tags.has("EXT-X-ENDLIST")).toBe(true);
    expect(playlist.segments.map((s) => s.uri)).toEqual([
      "segment0.m4s",
      "segment1.m4s",
      "segment2.m4s",
    ]);
    expect(playlist.segments.every((s) => s.durationSeconds === 6.006)).toBe(true);
  });

  it("puts EXT-X-MAP before the first segment and EXT-X-ENDLIST last", () => {
    // EXT-X-MAP applies to the segments that follow it, so its position is a
    // requirement rather than a convention.
    const lines = buildMediaPlaylist({
      segments: evenSegments(2, 6),
      initSegmentUri: "init.mp4",
    })
      .trimEnd()
      .split("\n");

    expect(lines.indexOf("#EXT-X-MAP:URI=\"init.mp4\"")).toBeLessThan(
      lines.findIndex((line) => line.startsWith("#EXTINF")),
    );
    expect(lines.at(-1)).toBe("#EXT-X-ENDLIST");
  });

  it("writes EXTINF with a trailing comma even when there is no title", () => {
    const text = buildMediaPlaylist({ segments: evenSegments(1, 6.006) });
    expect(text).toContain("#EXTINF:6.00600,\n");
  });

  it("keeps a title after the comma when one is given", () => {
    const text = buildMediaPlaylist({
      segments: [{ uri: "a.m4s", durationSeconds: 2, title: "opening" }],
    });
    expect(readMediaPlaylistStrictly(text).segments[0]?.title).toBe("opening");
  });

  it("omits EXT-X-MAP for a WebVTT rendition, whose segments are plain text", () => {
    const text = buildMediaPlaylist({
      segments: [{ uri: "segment0.vtt", durationSeconds: 6.006 }],
      playlistType: "VOD",
    });
    expect(text).not.toContain("EXT-X-MAP");
    expect(() => readMediaPlaylistStrictly(text)).not.toThrow();
  });

  it("leaves EXT-X-ENDLIST off a playlist that is still growing", () => {
    const text = buildMediaPlaylist({ segments: evenSegments(2, 6), endList: false });
    expect(text).not.toContain("EXT-X-ENDLIST");
  });

  it("refuses a playlist with no segments, and a URI that spans lines", () => {
    expect(() => buildMediaPlaylist({ segments: [] })).toThrow(/at least one segment/);
    expect(() =>
      buildMediaPlaylist({ segments: [{ uri: "a\nb.m4s", durationSeconds: 2 }] }),
    ).toThrow(/spans lines/);
  });

  it("refuses a URI it cannot quote inside EXT-X-MAP", () => {
    expect(() =>
      buildMediaPlaylist({ segments: evenSegments(1, 2), initSegmentUri: 'in"it.mp4' }),
    ).toThrow(/quoted-string cannot carry/);
  });
});

describe("EXT-X-TARGETDURATION", () => {
  it("rounds the longest segment up, over an uneven list", () => {
    // The final segment of a VOD asset is almost always short, and a keyframe
    // landing late makes one segment long — so uneven is the normal case.
    const segments: MediaPlaylistSegment[] = [
      { uri: "0.m4s", durationSeconds: 6.006 },
      { uri: "1.m4s", durationSeconds: 4.2 },
      { uri: "2.m4s", durationSeconds: 7.4 },
      { uri: "3.m4s", durationSeconds: 1.03 },
    ];
    expect(targetDurationFor(segments)).toBe(8);
    expect(buildMediaPlaylist({ segments })).toContain("#EXT-X-TARGETDURATION:8\n");
  });

  it("never lands below an actual EXTINF, across many shapes of segment list", () => {
    const cases: number[][] = [
      [6, 6, 6],
      [6.006, 6.006, 2.002],
      [1.999, 2.0, 2.001],
      [0.4],
      [9.5, 0.5],
      [5.999999, 6.000001],
    ];
    for (const durations of cases) {
      const segments = durations.map((durationSeconds, i) => ({
        uri: `${i}.m4s`,
        durationSeconds,
      }));
      const target = targetDurationFor(segments);
      for (const duration of durations) {
        expect(target, `target ${target} vs EXTINF ${duration}`).toBeGreaterThanOrEqual(duration);
      }
      // And the strict reader agrees, which is the same check from the other end.
      expect(() => readMediaPlaylistStrictly(buildMediaPlaylist({ segments }))).not.toThrow();
    }
  });

  it("never emits zero, even for a sub-second segment", () => {
    // The tag is a positive integer, and 0 would sit below every EXTINF.
    expect(targetDurationFor([{ uri: "a.m4s", durationSeconds: 0.4 }])).toBe(1);
  });

  it("rounds up rather than to nearest, which is stricter than the RFC requires", () => {
    // RFC 8216 §4.3.3.1 phrases the rule as "every EXTINF, rounded to nearest,
    // MUST be ≤ the target", which would allow 6 here. `ceil` also satisfies
    // the plain reading that no segment exceeds the target, and cannot be
    // invalid under either. The cost is one declared second.
    expect(targetDurationFor(evenSegments(3, 6.006))).toBe(7);
  });
});

/* --------------------------------------------------------- master playlist -- */

describe("master playlist", () => {
  const SUBTITLES: Rendition = {
    type: "SUBTITLES",
    groupId: "subs",
    name: "English",
    language: "en",
    uri: "subs/en/playlist.m3u8",
    isDefault: true,
  };

  function threeRungMaster(): string {
    return buildLadderMaster({
      variants: LADDER.map((rung) => ({
        rung,
        uri: `video/${rung.name}/playlist.m3u8`,
        frameRate: 29.97,
        averageBandwidth: rung.bitrate,
        bandwidth: Math.round(rung.bitrate * 1.06),
      })),
      audio: {
        groupId: "aac-stereo",
        name: "English",
        uri: "audio/stereo/playlist.m3u8",
        codec: "mp4a.40.2",
        channels: "2",
        language: "en",
        bitrate: 128_000,
      },
      subtitles: { groupId: "subs", renditions: [SUBTITLES] },
    });
  }

  it("writes the four attributes Apple treats as mandatory on every variant", () => {
    for (const variant of streamInfLines(threeRungMaster())) {
      // Apple §9: BANDWIDTH, RESOLUTION (with video), CODECS, FRAME-RATE.
      expect(variant.attributes.get("BANDWIDTH")).toMatch(/^\d+$/);
      expect(variant.attributes.get("RESOLUTION")).toMatch(/^\d+x\d+$/);
      expect(variant.attributes.get("CODECS")).toBeDefined();
      expect(variant.attributes.get("FRAME-RATE")).toMatch(/^\d+\.\d{3}$/);
    }
  });

  it("gives each rung its own resolution and the shared audio codec", () => {
    const variants = streamInfLines(threeRungMaster());
    expect(variants.map((v) => v.attributes.get("RESOLUTION"))).toEqual([
      "854x480",
      "1280x720",
      "1920x1080",
    ]);
    // Research §7.3: the CODECS list must name every sample format in any
    // rendition of a referenced group, even though the audio bytes are in
    // another playlist entirely.
    for (const variant of variants) {
      expect(variant.attributes.get("CODECS")).toBe("avc1.640028,mp4a.40.2");
      expect(variant.attributes.get("AUDIO")).toBe("aac-stereo");
      expect(variant.attributes.get("SUBTITLES")).toBe("subs");
    }
    expect(variants.map((v) => v.uri)).toEqual([
      "video/480p/playlist.m3u8",
      "video/720p/playlist.m3u8",
      "video/1080p/playlist.m3u8",
    ]);
  });

  it("includes the audio bitrate in every variant's BANDWIDTH", () => {
    // BANDWIDTH is the peak across any playable combination of renditions, and
    // the client is fetching the audio playlist at the same time. Leaving it
    // out under-states the variant and biases ABR upward on a weak connection.
    const variants = streamInfLines(threeRungMaster());
    expect(variants[0]?.attributes.get("BANDWIDTH")).toBe(String(Math.round(1_200_000 * 1.06) + 128_000));
    expect(variants[0]?.attributes.get("AVERAGE-BANDWIDTH")).toBe(String(1_200_000 + 128_000));
  });

  it("falls back to the rung's target bitrate when nothing has been measured", () => {
    const master = buildLadderMaster({
      variants: [{ rung: LADDER[1] as LadderRung, uri: "720p/playlist.m3u8" }],
    });
    expect(streamInfLines(master)[0]?.attributes.get("BANDWIDTH")).toBe("2800000");
    expect(streamInfLines(master)[0]?.attributes.get("AVERAGE-BANDWIDTH")).toBeUndefined();
  });

  it("declares the audio and subtitle groups the variants reference", () => {
    const groups = mediaLines(threeRungMaster());
    expect(groups).toHaveLength(2);

    expect(Object.fromEntries(groups[0] ?? [])).toEqual({
      TYPE: "AUDIO",
      "GROUP-ID": "aac-stereo",
      NAME: "English",
      LANGUAGE: "en",
      DEFAULT: "YES",
      AUTOSELECT: "YES",
      CHANNELS: "2",
      URI: "audio/stereo/playlist.m3u8",
    });
    expect(Object.fromEntries(groups[1] ?? [])).toEqual({
      TYPE: "SUBTITLES",
      "GROUP-ID": "subs",
      NAME: "English",
      LANGUAGE: "en",
      DEFAULT: "YES",
      AUTOSELECT: "YES",
      URI: "subs/en/playlist.m3u8",
    });
  });

  it("declares EXT-X-INDEPENDENT-SEGMENTS, which the muxer enforces", () => {
    expect(threeRungMaster()).toContain("#EXT-X-INDEPENDENT-SEGMENTS");
  });

  it("emits FORCED and CHARACTERISTICS on an SDH subtitle rendition", () => {
    const master = buildMasterPlaylist({
      variants: [
        {
          uri: "v.m3u8",
          bandwidth: 1_000_000,
          codecs: ["avc1.640028"],
          resolution: { width: 640, height: 360 },
          subtitlesGroupId: "subs",
        },
      ],
      renditions: [
        {
          type: "SUBTITLES",
          groupId: "subs",
          name: "English SDH",
          uri: "subs/sdh.m3u8",
          language: "en",
          forced: false,
          autoselect: true,
          characteristics: ["public.accessibility.transcribes-spoken-dialog"],
        },
      ],
    });
    const group = mediaLines(master)[0];
    expect(group?.get("FORCED")).toBe("NO");
    expect(group?.get("CHARACTERISTICS")).toBe(
      "public.accessibility.transcribes-spoken-dialog",
    );
  });
});

describe("master playlist validation", () => {
  const VIDEO_ONLY = {
    uri: "v.m3u8",
    bandwidth: 1_000_000,
    codecs: ["avc1.640028"],
    resolution: { width: 640, height: 360 },
  };

  it("refuses a variant with no CODECS", () => {
    expect(() =>
      buildMasterPlaylist({ variants: [{ ...VIDEO_ONLY, codecs: [] }] }),
    ).toThrow(/needs a CODECS attribute/);
  });

  it("refuses a video variant with no RESOLUTION", () => {
    expect(() =>
      buildMasterPlaylist({ variants: [{ ...VIDEO_ONLY, resolution: undefined }] }),
    ).toThrow(/needs RESOLUTION/);
  });

  it("allows an audio-only variant with no RESOLUTION", () => {
    expect(() =>
      buildMasterPlaylist({
        variants: [{ uri: "a.m3u8", bandwidth: 128_000, codecs: ["mp4a.40.2"] }],
      }),
    ).not.toThrow();
  });

  it("refuses a variant with a non-positive BANDWIDTH", () => {
    expect(() => buildMasterPlaylist({ variants: [{ ...VIDEO_ONLY, bandwidth: 0 }] })).toThrow(
      /positive integer BANDWIDTH/,
    );
  });

  it("refuses a group reference nothing declares", () => {
    expect(() =>
      buildMasterPlaylist({ variants: [{ ...VIDEO_ONLY, audioGroupId: "ghost" }] }),
    ).toThrow(/which no EXT-X-MEDIA declares/);
  });

  it("refuses a variant whose CODECS omits its audio group's codec", () => {
    expect(() =>
      buildMasterPlaylist({
        variants: [{ ...VIDEO_ONLY, audioGroupId: "aac" }],
        renditions: [
          { type: "AUDIO", groupId: "aac", name: "English", uri: "a.m3u8", codec: "mp4a.40.2" },
        ],
      }),
    ).toThrow(/but its CODECS list is avc1.640028/);
  });

  it("refuses a subtitle rendition with no URI", () => {
    expect(() =>
      buildMasterPlaylist({
        variants: [{ ...VIDEO_ONLY, subtitlesGroupId: "subs" }],
        renditions: [{ type: "SUBTITLES", groupId: "subs", name: "English" }],
      }),
    ).toThrow(/needs a URI/);
  });

  it("refuses FORCED on anything but a subtitle rendition", () => {
    expect(() =>
      buildMasterPlaylist({
        variants: [{ ...VIDEO_ONLY, audioGroupId: "aac" }],
        renditions: [
          { type: "AUDIO", groupId: "aac", name: "English", uri: "a.m3u8", forced: true },
        ],
      }),
    ).toThrow(/FORCED is only valid on a SUBTITLES rendition/);
  });

  it("refuses DEFAULT=YES beside AUTOSELECT=NO", () => {
    expect(() =>
      buildMasterPlaylist({
        variants: [{ ...VIDEO_ONLY, audioGroupId: "aac" }],
        renditions: [
          {
            type: "AUDIO",
            groupId: "aac",
            name: "English",
            uri: "a.m3u8",
            isDefault: true,
            autoselect: false,
          },
        ],
      }),
    ).toThrow(/DEFAULT=YES but AUTOSELECT=NO/);
  });

  it("refuses two DEFAULT=YES renditions in one group", () => {
    // Two defaults leaves the player to choose, and two players would choose
    // differently.
    expect(() =>
      buildMasterPlaylist({
        variants: [{ ...VIDEO_ONLY, audioGroupId: "aac" }],
        renditions: [
          { type: "AUDIO", groupId: "aac", name: "English", uri: "en.m3u8", isDefault: true },
          { type: "AUDIO", groupId: "aac", name: "Deutsch", uri: "de.m3u8", isDefault: true },
        ],
      }),
    ).toThrow(/two DEFAULT=YES renditions/);
  });

  it("refuses a master playlist with no variants", () => {
    expect(() => buildMasterPlaylist({ variants: [] })).toThrow(/at least one variant/);
  });
});

/* ----------------------------------------------------- the worked example -- */

describe("the research's worked three-rung example", () => {
  /**
   * research §7.4 works through a 3-rung AVC ladder with one shared AAC-LC
   * rendition and one WebVTT subtitle rendition. Reproducing it line for line
   * checks attribute *order* and quoting, which no structural assertion above
   * covers — and which is what makes a playlist diffable against a reference.
   *
   * Blank lines are ignored by every HLS parser and this emitter writes none,
   * so the comparison is against the document's non-blank lines.
   */
  it("emits the documented master playlist", () => {
    const master = buildLadderMaster({
      variants: [
        {
          rung: LADDER[0] as LadderRung,
          uri: "video/480p/playlist.m3u8",
          bandwidth: 1_280_000,
          averageBandwidth: 1_200_000,
          frameRate: 29.97,
        },
        {
          rung: LADDER[1] as LadderRung,
          uri: "video/720p/playlist.m3u8",
          bandwidth: 2_950_000,
          averageBandwidth: 2_800_000,
          frameRate: 29.97,
        },
        {
          rung: LADDER[2] as LadderRung,
          uri: "video/1080p/playlist.m3u8",
          bandwidth: 5_200_000,
          averageBandwidth: 5_000_000,
          frameRate: 29.97,
        },
      ],
      audio: {
        groupId: "aac-stereo",
        name: "English",
        uri: "audio/stereo/playlist.m3u8",
        codec: "mp4a.40.2",
        channels: "2",
        language: "en",
      },
      subtitles: {
        groupId: "subs",
        renditions: [
          {
            type: "SUBTITLES",
            groupId: "subs",
            name: "English",
            language: "en",
            isDefault: true,
            uri: "subs/en/playlist.m3u8",
          },
        ],
      },
    });

    expect(master).toBe(
      `${[
        "#EXTM3U",
        "#EXT-X-VERSION:6",
        "#EXT-X-INDEPENDENT-SEGMENTS",
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac-stereo",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2",URI="audio/stereo/playlist.m3u8"',
        '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="subs/en/playlist.m3u8"',
        '#EXT-X-STREAM-INF:BANDWIDTH=1280000,AVERAGE-BANDWIDTH=1200000,RESOLUTION=854x480,FRAME-RATE=29.970,CODECS="avc1.640028,mp4a.40.2",AUDIO="aac-stereo",SUBTITLES="subs"',
        "video/480p/playlist.m3u8",
        '#EXT-X-STREAM-INF:BANDWIDTH=2950000,AVERAGE-BANDWIDTH=2800000,RESOLUTION=1280x720,FRAME-RATE=29.970,CODECS="avc1.640028,mp4a.40.2",AUDIO="aac-stereo",SUBTITLES="subs"',
        "video/720p/playlist.m3u8",
        '#EXT-X-STREAM-INF:BANDWIDTH=5200000,AVERAGE-BANDWIDTH=5000000,RESOLUTION=1920x1080,FRAME-RATE=29.970,CODECS="avc1.640028,mp4a.40.2",AUDIO="aac-stereo",SUBTITLES="subs"',
        "video/1080p/playlist.m3u8",
      ].join("\n")}\n`,
    );
  });

  it("emits the documented media playlist, apart from the deliberate target duration", () => {
    // The document shows `#EXT-X-TARGETDURATION:6` for 6.006-second segments,
    // which is `round`. We emit 7, for the reason argued in `targetDurationFor`.
    const playlist = buildMediaPlaylist({
      segments: evenSegments(3, 6.006),
      initSegmentUri: "init.mp4",
      playlistType: "VOD",
    });

    expect(playlist).toBe(
      `${[
        "#EXTM3U",
        "#EXT-X-VERSION:6",
        "#EXT-X-TARGETDURATION:7",
        "#EXT-X-PLAYLIST-TYPE:VOD",
        '#EXT-X-MAP:URI="init.mp4"',
        "#EXTINF:6.00600,",
        "segment0.m4s",
        "#EXTINF:6.00600,",
        "segment1.m4s",
        "#EXTINF:6.00600,",
        "segment2.m4s",
        "#EXT-X-ENDLIST",
      ].join("\n")}\n`,
    );
  });
});
