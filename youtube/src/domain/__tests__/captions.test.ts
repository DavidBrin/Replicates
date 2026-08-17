import { describe, expect, it } from "vitest";

import {
  VttError,
  activeCuesAt,
  formatCueSettings,
  formatTimestamp,
  parseCueSettings,
  parseCueText,
  parseTimestamp,
  parseVtt,
  serialiseCueText,
  serialiseVtt,
} from "../captions";

/**
 * The suite is weighted towards the timestamp grammar on purpose.
 *
 * `research/07-captions-and-a11y.md` §1.2 names one defect as the classic:
 * minutes are capped at 59 even with the hours field omitted, unlike SubRip,
 * so `90:00.000` is a parse error rather than "90 minutes". It is invisible on
 * short content and wrong on long content, which is the worst combination a
 * test suite can be asked to catch.
 */

describe("the WebVTT timestamp grammar", () => {
  it("reads the three- and four-field forms", () => {
    expect(parseTimestamp("00:00.000")).toBe(0);
    expect(parseTimestamp("00:01.500")).toBe(1.5);
    expect(parseTimestamp("59:59.999")).toBeCloseTo(3599.999, 6);
    expect(parseTimestamp("01:30:00.000")).toBe(5400);
    // §1.2: hours are variable-width, so a 123-hour timestamp is legal.
    expect(parseTimestamp("123:00:00.000")).toBe(123 * 3600);
  });

  it("rejects 90:00.000 — the SubRip habit that files a cue in the wrong place", () => {
    // The whole point: 90 minutes is `01:30:00.000`. With the hours field
    // omitted the minutes field may not exceed 59, so this is an error and not
    // a 90-minute timestamp.
    expect(() => parseTimestamp("90:00.000")).toThrow(VttError);
    expect(() => parseTimestamp("60:00.000")).toThrow(VttError);
    // …and the same cap applies to the minutes field when hours *are* present.
    expect(() => parseTimestamp("01:60:00.000")).toThrow(VttError);
    expect(parseTimestamp("01:59:00.000")).toBe(3600 + 59 * 60);
  });

  it("holds minutes, seconds and milliseconds to their exact widths", () => {
    // Only the hours field is variable-width (§1.2's closing note).
    expect(() => parseTimestamp("1:30.000")).toThrow(VttError);
    expect(() => parseTimestamp("001:30.000")).toThrow(VttError);
    expect(() => parseTimestamp("00:1.000")).toThrow(VttError);
    expect(() => parseTimestamp("00:001.000")).toThrow(VttError);
    // `.5` is not half a second; milliseconds are exactly three digits.
    expect(() => parseTimestamp("00:01.5")).toThrow(VttError);
    expect(() => parseTimestamp("00:01.5000")).toThrow(VttError);
    expect(() => parseTimestamp("00:01")).toThrow(VttError);
    // Seconds are capped at 59 as well.
    expect(() => parseTimestamp("00:60.000")).toThrow(VttError);
  });

  it("rejects a one-digit hours field, which an SRT converter will emit", () => {
    // Stricter than the spec's own collection algorithm and exactly what its
    // grammar says. We write these files too, so the strict reading is what
    // catches our own writer.
    expect(() => parseTimestamp("1:30:00.000")).toThrow(VttError);
  });

  it("always writes the hours field, so the writer cannot produce 90:00.000", () => {
    expect(formatTimestamp(0)).toBe("00:00:00.000");
    expect(formatTimestamp(1.5)).toBe("00:00:01.500");
    expect(formatTimestamp(5400)).toBe("01:30:00.000");
    expect(formatTimestamp(123 * 3600)).toBe("123:00:00.000");
  });

  it("rounds to milliseconds without carrying a 60 into the seconds field", () => {
    // Flooring each field separately produces `00:00:60.000`, which does not
    // parse — the bug is only reachable within a thousandth of a boundary.
    expect(formatTimestamp(59.9996)).toBe("00:01:00.000");
    expect(parseTimestamp(formatTimestamp(59.9996))).toBe(60);
    expect(formatTimestamp(3599.9999)).toBe("01:00:00.000");
  });

  it("round-trips every timestamp it writes", () => {
    for (const seconds of [0, 0.001, 1.5, 61.25, 3599.999, 5400, 86_399.999]) {
      expect(parseTimestamp(formatTimestamp(seconds))).toBeCloseTo(seconds, 6);
    }
  });

  it("refuses to format a negative or non-finite position", () => {
    expect(() => formatTimestamp(-1)).toThrow(VttError);
    expect(() => formatTimestamp(Number.NaN)).toThrow(VttError);
  });
});

describe("cue settings", () => {
  it("reads §1.4's six keys in any order", () => {
    const { settings, issues } = parseCueSettings(
      "align:end region:crawl size:40% vertical:rl position:10%,line-left line:-2,start",
    );
    expect(issues).toEqual([]);
    expect(settings).toEqual({
      vertical: "rl",
      line: { value: -2, unit: "line", align: "start" },
      position: { value: 10, align: "line-left" },
      size: 40,
      align: "end",
      region: "crawl",
    });
  });

  it("tells a line count from a line percentage", () => {
    expect(parseCueSettings("line:5").settings.line).toEqual({
      value: 5,
      unit: "line",
    });
    expect(parseCueSettings("line:5%").settings.line).toEqual({
      value: 5,
      unit: "percent",
    });
    // Negative counts from the "before" edge; a negative percentage is not a
    // thing, and the two therefore validate differently.
    expect(parseCueSettings("line:-3").settings.line?.value).toBe(-3);
    expect(parseCueSettings("line:-3%").settings.line).toBeUndefined();
  });

  it("drops what it cannot use and says so, keeping the rest", () => {
    const { settings, issues } = parseCueSettings(
      "align:sideways size:200% colour:red align:start",
    );
    expect(settings).toEqual({});
    expect(issues).toHaveLength(4);
    expect(issues.map((issue) => issue.message).join(" ")).toContain("colour");
    // §1.4: each key at most once, so the second `align` is ignored rather than
    // used to repair the first.
    expect(settings.align).toBeUndefined();
  });

  it("writes settings back in a fixed order", () => {
    const { settings } = parseCueSettings("align:end line:0% size:80%");
    expect(formatCueSettings(settings)).toBe("line:0% size:80% align:end");
    expect(formatCueSettings({})).toBe("");
  });
});

describe("inline cue markup", () => {
  it("reads the tags §1.8 defines", () => {
    const nodes = parseCueText(
      "<v.loud Ada Lovelace><b>Note</b> the <i>engine</i>, <c.yellow>quietly</c>",
    );
    expect(nodes).toHaveLength(1);
    const voice = nodes[0];
    if (voice?.kind !== "voice") throw new Error("expected a voice span");
    expect(voice.speaker).toBe("Ada Lovelace");
    expect(voice.classes).toEqual(["loud"]);
    expect(voice.children.map((child) => child.kind)).toEqual([
      "bold",
      "text",
      "italic",
      "text",
      "class",
    ]);
  });

  it("keeps the karaoke timestamp tags a word-highlighting renderer needs", () => {
    const nodes = parseCueText(
      "<00:00:01.000>Never <00:00:01.500>gonna <00:00:02.000>give",
    );
    const stamps = nodes.filter((node) => node.kind === "timestamp");
    expect(stamps).toHaveLength(3);
    expect(stamps.map((node) => (node.kind === "timestamp" ? node.atSeconds : 0))).toEqual(
      [1, 1.5, 2],
    );
  });

  it("closes a voice span at the end of the cue, which §1.8 permits", () => {
    const nodes = parseCueText("<v Speaker>runs to the end");
    const voice = nodes[0];
    if (voice?.kind !== "voice") throw new Error("expected a voice span");
    expect(voice.children).toEqual([{ kind: "text", text: "runs to the end" }]);
    // Serialising supplies the end tag it was allowed to omit.
    expect(serialiseCueText(nodes)).toBe("<v Speaker>runs to the end</v>");
  });

  it("decodes the character references that matter, including the invisible ones", () => {
    const nodes = parseCueText("Tom &amp; Jerry &lt;3 &#160;&lrm;&#x200F;");
    expect(nodes[0]).toEqual({
      kind: "text",
      text: "Tom & Jerry <3  ‎‏",
    });
  });

  it("treats an unterminated `<` as text rather than eating the rest of the cue", () => {
    expect(parseCueText("5 < 6")).toEqual([{ kind: "text", text: "5 < 6" }]);
  });

  it("drops a tag §1.8 does not define instead of passing it to the renderer", () => {
    // Route B builds real DOM from these nodes, so an unknown tag reaching the
    // renderer is an injection seam rather than a formatting quirk.
    expect(parseCueText("safe<script>alert(1)</script>")).toEqual([
      { kind: "text", text: "safe" },
      { kind: "text", text: "alert(1)" },
    ]);
  });

  it("round-trips markup through nodes and back", () => {
    const source =
      "<v Ada><b>Hello</b> <i.big>world</i> <lang en-GB>colour</lang> &amp; more</v>";
    expect(serialiseCueText(parseCueText(source))).toBe(source);
  });
});

describe("parsing a file", () => {
  const file = [
    "WEBVTT Kind: captions",
    "",
    "REGION",
    "id:crawl",
    "width:40%",
    "lines:3",
    "scroll:up",
    "",
    "STYLE",
    "::cue { color: papayawhip; }",
    "",
    "NOTE This block is authoring commentary",
    "and it spans two lines.",
    "",
    "intro",
    "00:00:00.000 --> 00:00:04.000 align:start line:0%",
    "so today we're going to look at",
    "",
    "00:00:04.000 --> 00:00:09.850",
    "how the scheduler <b>actually</b>",
    "assigns priority",
    "",
  ].join("\n");

  it("reads the header, the blocks and the cues", () => {
    const document = parseVtt(file);
    expect(document.header).toBe("Kind: captions");
    expect(document.issues).toEqual([]);
    expect(document.regions).toEqual([
      { id: "crawl", settings: { width: "40%", lines: "3", scroll: "up" } },
    ]);
    expect(document.styles).toEqual(["::cue { color: papayawhip; }"]);
    expect(document.cues).toHaveLength(2);
    expect(document.cues[0]?.id).toBe("intro");
    expect(document.cues[0]?.settings).toEqual({
      align: "start",
      line: { value: 0, unit: "percent" },
    });
    expect(document.cues[1]?.id).toBeNull();
    // A multi-line payload keeps its line break, which is a hard break on
    // screen rather than a wrap.
    expect(document.cues[1]?.text).toBe(
      "how the scheduler <b>actually</b>\nassigns priority",
    );
  });

  it("tolerates a BOM and every line terminator", () => {
    const crlf = `﻿WEBVTT\r\n\r\n00:00:00.000 --> 00:00:01.000\r\nHello\r\n`;
    expect(parseVtt(crlf).cues[0]?.text).toBe("Hello");
    const cr = `WEBVTT\r\r00:00:00.000 --> 00:00:01.000\rHello\r`;
    expect(parseVtt(cr).cues[0]?.text).toBe("Hello");
  });

  it("refuses a file that is not a WebVTT file", () => {
    expect(() => parseVtt("WEBVTTFOO\n\n")).toThrow(VttError);
    expect(() => parseVtt("something else")).toThrow(VttError);
    expect(() => parseVtt("WEBVTT --> nope")).toThrow(VttError);
    // …but the bare header, with nothing after it, is a legal empty track.
    expect(parseVtt("WEBVTT\n").cues).toEqual([]);
  });

  it("skips the broken cue and keeps the ones around it", () => {
    const document = parseVtt(
      [
        "WEBVTT",
        "",
        "00:00:00.000 --> 00:00:01.000",
        "first",
        "",
        "90:00.000 --> 90:02.000",
        "ninety minutes in, the SubRip way",
        "",
        "00:00:02.000 --> 00:00:03.000",
        "third",
        "",
      ].join("\n"),
    );

    expect(document.cues.map((cue) => cue.text)).toEqual(["first", "third"]);
    expect(document.issues).toHaveLength(1);
    expect(document.issues[0]?.message).toContain("90:00.000");
    expect(document.issues[0]?.line).toBe(6);
  });

  it("skips a cue whose end is not after its start", () => {
    const document = parseVtt(
      "WEBVTT\n\n00:00:05.000 --> 00:00:05.000\nzero length\n",
    );
    expect(document.cues).toEqual([]);
    expect(document.issues[0]?.message).toContain("not after its start");
  });

  it("requires whitespace around the arrow, as §1.3 does", () => {
    const document = parseVtt("WEBVTT\n\n00:00:00.000-->00:00:01.000\nsquashed\n");
    expect(document.cues).toEqual([]);
    expect(document.issues[0]?.message).toContain("bad timing line");
  });

  it("starts a new cue at a timing line, even with the blank line missing", () => {
    // One missing blank line otherwise swallows every remaining cue into one
    // payload — and the line before the timing line is the next cue's
    // identifier, so it has to be handed back rather than kept.
    const document = parseVtt(
      [
        "WEBVTT",
        "",
        "00:00:00.000 --> 00:00:01.000",
        "first",
        "second-id",
        "00:00:01.000 --> 00:00:02.000",
        "second",
        "",
      ].join("\n"),
    );

    expect(document.cues).toHaveLength(2);
    expect(document.cues[0]?.text).toBe("first");
    expect(document.cues[1]?.id).toBe("second-id");
    expect(document.cues[1]?.text).toBe("second");
  });

  it("keeps an out-of-order cue and records that it is out of order", () => {
    const document = parseVtt(
      [
        "WEBVTT",
        "",
        "00:00:10.000 --> 00:00:12.000",
        "later",
        "",
        "00:00:01.000 --> 00:00:02.000",
        "earlier",
        "",
      ].join("\n"),
    );
    // Kept: the words are the part somebody needs, and §1.3 makes this a
    // per-cue error rather than a fatal one.
    expect(document.cues).toHaveLength(2);
    expect(document.issues[0]?.message).toContain("before the one before it");
  });

  it("ignores a block with an identifier and no timing line", () => {
    const document = parseVtt("WEBVTT\n\nstray-id\nnot a timing line\n");
    expect(document.cues).toEqual([]);
    expect(document.issues[0]?.message).toContain("no timing line");
  });
});

describe("writing a file", () => {
  it("round-trips a document with settings, markup and a region", () => {
    const source = [
      "WEBVTT",
      "",
      "REGION",
      "id:crawl",
      "width:40%",
      "",
      "STYLE",
      "::cue(b) { color: peachpuff; }",
      "",
      "one",
      "00:00:01.000 --> 00:00:04.000 line:-2,start align:end",
      "<v Ada>Never <00:00:02.000>gonna</v>",
      "",
      "01:30:00.000 --> 01:30:04.000 position:10%,line-left size:80%",
      "ninety minutes in",
      "",
    ].join("\n");

    const first = parseVtt(source);
    const written = serialiseVtt(first);
    const second = parseVtt(written);

    expect(second.issues).toEqual([]);
    expect(second.cues).toEqual(first.cues);
    expect(second.regions).toEqual(first.regions);
    expect(second.styles).toEqual(first.styles);
    // The long-form cue survives as an hours-carrying timestamp rather than
    // becoming the `90:00.000` that would not parse back.
    expect(written).toContain("01:30:00.000 --> 01:30:04.000");
    expect(written).not.toContain("90:00.000");
  });

  it("writes a file the parser accepts from cues built by hand", () => {
    const written = serialiseVtt({
      cues: [
        {
          id: null,
          startSeconds: 0,
          endSeconds: 2,
          settings: { align: "center" },
          text: "Hello",
        },
      ],
    });
    expect(written).toBe(
      "WEBVTT\n\n00:00:00.000 --> 00:00:02.000 align:center\nHello\n",
    );
    expect(parseVtt(written).cues[0]?.text).toBe("Hello");
  });
});

describe("which cues are showing", () => {
  const cues = parseVtt(
    [
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:04.000",
      "first",
      "",
      "00:00:03.000 --> 00:00:06.000",
      "overlapping",
      "",
    ].join("\n"),
  ).cues;

  it("is half-open at the end, matching the browser's own activeCues", () => {
    expect(activeCuesAt(cues, 0).map((cue) => cue.text)).toEqual(["first"]);
    expect(activeCuesAt(cues, 3.5).map((cue) => cue.text)).toEqual([
      "first",
      "overlapping",
    ]);
    // 4.000 is the first moment the first cue is gone, not the last it shows.
    expect(activeCuesAt(cues, 4).map((cue) => cue.text)).toEqual(["overlapping"]);
    expect(activeCuesAt(cues, 6)).toEqual([]);
  });
});
