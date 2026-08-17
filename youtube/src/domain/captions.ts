/**
 * WebVTT: reading a caption file, and writing one back.
 *
 * `research/07-captions-and-a11y.md` §1 is the grammar this implements, and §2
 * is why it exists at all. The recommendation there is Route B — load the track,
 * set `mode = 'hidden'`, and paint the cues ourselves — because `::cue` cannot
 * express the caption-settings panel (font size, colours, opacities, edge style)
 * or keep the caption box clear of an auto-hiding control bar. Painting them
 * ourselves means we need the cues as data, and the browser only hands them over
 * in an environment that has a `<track>` element. The parser therefore lives
 * here, in the domain, where the seed script, the auto-caption path, a route
 * handler and the player can all reach it and none of them needs a DOM.
 *
 * ## The trap this file is mostly about
 *
 * §1.2: minutes are **exactly two digits, 0–59, even when the hours field is
 * omitted**. SubRip has no such rule — `90:00,000` is a perfectly ordinary SRT
 * timestamp — so a parser ported from SRT, or written to the plausible regex
 * `^(\d+):(\d{2})\.(\d{3})$`, accepts `90:00.000` and silently files a cue at 90
 * minutes that the spec says is a parse error. A caption at 90 minutes must be
 * written `01:30:00.000`.
 *
 * The failure only appears on long content, which is exactly the content nobody
 * tests with, and it appears as captions that are subtly in the wrong place
 * rather than as an error. {@link parseTimestamp} enforces the field widths, and
 * {@link formatTimestamp} always emits the hours field so that the writing half
 * cannot produce the bug the reading half is guarding against.
 *
 * ## Strict on the grammar, resilient on the file
 *
 * A malformed timestamp is an error for that cue. A malformed *file* is not:
 * §1.3 says a conforming parser skips the offending block and carries on, and
 * dropping the other ninety cues because one is broken would be an
 * accessibility failure produced by a parser written to be tidy. So
 * {@link parseVtt} throws only when the file is not a WebVTT file at all, and
 * everything else lands in {@link VttDocument.issues} — where a caller can log
 * it, show it to an uploader, or ignore it.
 */

/* ============================================================== timestamps == */

/** A parse failure, with the line it happened on when there is one. */
export class VttError extends Error {
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(message);
    this.name = "VttError";
  }
}

/** Something the parser skipped. One per block, never fatal. */
export interface VttParseIssue {
  /** 1-based, so it matches what an editor shows. */
  readonly line: number;
  readonly message: string;
}

/**
 * `[HH:]MM:SS.mmm`, per §1.2, with every field width enforced.
 *
 * `[0-5]\d` for minutes and seconds does two jobs at once: exactly two digits,
 * and a value of at most 59. Writing it as `\d{2}` plus a range check would be
 * the same rule in two places, and the range check is the half that gets
 * dropped.
 *
 * Hours are `\d{2,}` — variable width, because §1.2 is explicit that
 * `123:00:00.000` is a legal 123-hour timestamp. This is stricter than the
 * spec's own *parsing algorithm*, which accepts a one-digit hours field
 * (`1:30:00.000`) because it decides "these digits are hours" from the field not
 * being exactly two characters. The grammar section says two or more, and we
 * are also the thing that writes these files, so the strict reading is the one
 * that catches our own writer going wrong. A file from an SRT converter with
 * one-digit hours is rejected, deliberately and loudly.
 */
const TIMESTAMP = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/;

/**
 * Seconds, from a WebVTT timestamp.
 *
 * Throws rather than returning `null`, and the caller decides whether that ends
 * the cue or the file. Every message names the offending text, because the
 * failure this file exists to prevent looks like a working file until somebody
 * scrolls to 90 minutes.
 */
export function parseTimestamp(input: string): number {
  const match = TIMESTAMP.exec(input);
  if (!match) {
    throw new VttError(
      `Not a WebVTT timestamp: ${JSON.stringify(input)}. ` +
        `Expected [HH:]MM:SS.mmm with minutes and seconds 0-59 and exactly ` +
        `two digits each — a cue at 90 minutes is 01:30:00.000, not 90:00.000.`,
    );
  }
  const [, hours = "0", minutes = "0", seconds = "0", milliseconds = "0"] =
    match;
  return (
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(milliseconds) / 1000
  );
}

/**
 * A WebVTT timestamp, from seconds. Always with the hours field.
 *
 * §1.2 makes hours optional below one hour, and omitting them is where the
 * minutes-over-59 bug is born: a writer that emits `MM:SS.mmm` has to remember
 * to switch formats at 3600 seconds, and the version that forgets produces
 * `90:00.000` — which reads back as a parse error rather than as 90 minutes.
 * Always emitting hours removes the branch, and `HH` widening past two digits
 * for very long content is legal by the same clause that permits
 * `123:00:00.000`.
 */
export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new VttError(`Cannot format ${String(seconds)} as a timestamp.`);
  }
  // Rounded to milliseconds first, then decomposed, so that 59.9996 becomes
  // 00:01:00.000 rather than 00:00:60.000 — which is not a legal timestamp and
  // would be written by any decomposition that floors each field separately.
  const total = Math.round(seconds * 1000);
  const ms = total % 1000;
  const wholeSeconds = (total - ms) / 1000;
  const hh = Math.floor(wholeSeconds / 3600);
  const mm = Math.floor((wholeSeconds % 3600) / 60);
  const ss = wholeSeconds % 60;
  return (
    `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:` +
    `${String(ss).padStart(2, "0")}.${String(ms).padStart(3, "0")}`
  );
}

/* ================================================================ settings == */

export type CueVertical = "rl" | "lr";
export type CueAlign = "start" | "center" | "end" | "left" | "right";
export type LineAlign = "start" | "center" | "end";
export type PositionAlign = "line-left" | "center" | "line-right";

/** `line:` — a line count from the caption area's edge, or a percentage. */
export interface CueLine {
  readonly value: number;
  readonly unit: "line" | "percent";
  readonly align?: LineAlign;
}

export interface CuePosition {
  /** Percentage of the video's width, 0–100. */
  readonly value: number;
  readonly align?: PositionAlign;
}

/** §1.4. Every key optional, every key at most once, order-independent. */
export interface CueSettings {
  readonly vertical?: CueVertical;
  readonly line?: CueLine;
  readonly position?: CuePosition;
  /** Percentage of the video's width, 0–100. */
  readonly size?: number;
  readonly align?: CueAlign;
  readonly region?: string;
}

const VERTICAL: readonly string[] = ["rl", "lr"];
const ALIGN: readonly string[] = ["start", "center", "end", "left", "right"];
const LINE_ALIGN: readonly string[] = ["start", "center", "end"];
const POSITION_ALIGN: readonly string[] = ["line-left", "center", "line-right"];

/**
 * The `key:value` pairs after the arrow.
 *
 * An unrecognised or malformed setting is dropped and reported rather than
 * failing the cue: a cue with the wrong box position still carries its words,
 * and the words are the part somebody needs.
 */
export function parseCueSettings(
  input: string,
  line = 0,
): { settings: CueSettings; issues: VttParseIssue[] } {
  const settings: {
    vertical?: CueVertical;
    line?: CueLine;
    position?: CuePosition;
    size?: number;
    align?: CueAlign;
    region?: string;
  } = {};
  const issues: VttParseIssue[] = [];
  const seen = new Set<string>();

  for (const pair of input.split(/[ \t]+/).filter(Boolean)) {
    const colon = pair.indexOf(":");
    if (colon <= 0) {
      issues.push({ line, message: `Ignored cue setting ${pair}.` });
      continue;
    }
    const key = pair.slice(0, colon);
    const value = pair.slice(colon + 1);

    if (seen.has(key)) {
      issues.push({ line, message: `Ignored a repeated ${key} cue setting.` });
      continue;
    }
    seen.add(key);

    switch (key) {
      case "vertical": {
        if (!VERTICAL.includes(value)) break;
        settings.vertical = value as CueVertical;
        continue;
      }
      case "align": {
        if (!ALIGN.includes(value)) break;
        settings.align = value as CueAlign;
        continue;
      }
      case "region": {
        if (value.length === 0) break;
        settings.region = value;
        continue;
      }
      case "size": {
        const size = percentage(value, { requireSign: true });
        if (size === null) break;
        settings.size = size;
        continue;
      }
      case "line": {
        const [head = "", align] = value.split(",", 2);
        if (align !== undefined && !LINE_ALIGN.includes(align)) break;
        const percent = head.endsWith("%");
        const raw = percent ? head.slice(0, -1) : head;
        // A line count may be negative — §1.4 says it counts from the "before"
        // edge — but a percentage may not, so the two cases validate
        // differently rather than sharing one number parse.
        if (percent) {
          const offset = percentage(raw);
          if (offset === null) break;
          settings.line = {
            value: offset,
            unit: "percent",
            ...(align ? { align: align as LineAlign } : {}),
          };
          continue;
        }
        if (!/^-?\d+$/.test(raw)) break;
        settings.line = { value: Number(raw), unit: "line", ...(align ? { align: align as LineAlign } : {}) };
        continue;
      }
      case "position": {
        const [head = "", align] = value.split(",", 2);
        if (align !== undefined && !POSITION_ALIGN.includes(align)) break;
        const percent = percentage(head, { requireSign: true });
        if (percent === null) break;
        settings.position = {
          value: percent,
          ...(align ? { align: align as PositionAlign } : {}),
        };
        continue;
      }
      default: {
        issues.push({ line, message: `Ignored unknown cue setting ${key}.` });
        continue;
      }
    }
    issues.push({ line, message: `Ignored cue setting ${pair}: bad value.` });
  }

  return { settings, issues };
}

/**
 * A §1.4 percentage: 0–100, and — where the grammar says `<percentage>` rather
 * than a bare number — carrying its `%`. `size:40` is not `size:40%`, and
 * accepting it would make us the only parser that renders that cue.
 */
function percentage(
  raw: string,
  options: { readonly requireSign?: boolean } = {},
): number | null {
  const hasSign = raw.endsWith("%");
  if (options.requireSign && !hasSign) return null;
  const digits = hasSign ? raw.slice(0, -1) : raw;
  if (!/^\d+(?:\.\d+)?$/.test(digits)) return null;
  const value = Number(digits);
  return value >= 0 && value <= 100 ? value : null;
}

/**
 * Settings back onto a timing line, in the spec's own table order.
 *
 * Order-independent on the way in (§1.4) and fixed on the way out, so that
 * serialising the same cue twice produces the same bytes — a file whose diff
 * churns because a `Map` iterated differently is a file nobody can review.
 */
export function formatCueSettings(settings: CueSettings): string {
  const parts: string[] = [];
  if (settings.vertical) parts.push(`vertical:${settings.vertical}`);
  if (settings.line) {
    const unit = settings.line.unit === "percent" ? "%" : "";
    const align = settings.line.align ? `,${settings.line.align}` : "";
    parts.push(`line:${settings.line.value}${unit}${align}`);
  }
  if (settings.position) {
    const align = settings.position.align ? `,${settings.position.align}` : "";
    parts.push(`position:${settings.position.value}%${align}`);
  }
  if (settings.size !== undefined) parts.push(`size:${settings.size}%`);
  if (settings.align) parts.push(`align:${settings.align}`);
  if (settings.region) parts.push(`region:${settings.region}`);
  return parts.join(" ");
}

/* ============================================================ inline markup == */

/**
 * Cue text as a tree, per §1.8.
 *
 * A tree rather than a string because Route B paints the cues itself: `<b>` has
 * to become an element, `<v Speaker>` has to become the thing a screen reader
 * announces as an attribution, and `<00:00:01.500>` has to become the split
 * point that karaoke-style highlighting keys off. A renderer handed a string
 * would have to parse it again, in a component, per frame.
 */
export type CueNode =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "bold" | "italic" | "underline" | "class" | "ruby" | "rt";
      readonly classes: readonly string[];
      readonly children: readonly CueNode[];
    }
  | {
      readonly kind: "voice";
      readonly speaker: string;
      readonly classes: readonly string[];
      readonly children: readonly CueNode[];
    }
  | {
      readonly kind: "lang";
      readonly language: string;
      readonly classes: readonly string[];
      readonly children: readonly CueNode[];
    }
  /** `<00:00:01.500>` — a split point, not a container. */
  | { readonly kind: "timestamp"; readonly atSeconds: number };

/**
 * The node kinds a tag can open — everything except `text`, which has no tag,
 * and `timestamp`, which is a point rather than a container. Narrowed to this
 * union rather than `CueNode["kind"]` so that the tag table cannot name a kind
 * the tag parser is unable to push onto its stack.
 */
type ElementKind = Exclude<CueNode["kind"], "text" | "timestamp">;

const TAG_KINDS: Readonly<Record<string, ElementKind>> = {
  b: "bold",
  i: "italic",
  u: "underline",
  c: "class",
  v: "voice",
  lang: "lang",
  ruby: "ruby",
  rt: "rt",
};

const TAG_NAMES: Readonly<Record<string, string>> = {
  bold: "b",
  italic: "i",
  underline: "u",
  class: "c",
  voice: "v",
  lang: "lang",
  ruby: "ruby",
  rt: "rt",
};

/**
 * The named character references §1.8 actually calls out, plus the two that
 * every HTML tokeniser has.
 *
 * `&lrm;` and `&rlm;` are the interesting ones: they are invisible, and they
 * are what makes an Arabic or Hebrew caption with Latin punctuation in it read
 * in the right order. A parser that dropped them would produce text that looks
 * identical in a diff and wrong on screen.
 */
const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  lrm: "‎",
  rlm: "‏",
};

/** The inverse, for the characters that must or should be escaped on the way out. */
const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  " ": "&nbsp;",
  "‎": "&lrm;",
  "‏": "&rlm;",
};

/**
 * Whether a numeric reference names a character that exists.
 *
 * `Number.isFinite` was the whole guard, and it is not one:
 * `String.fromCodePoint` throws `RangeError` for anything above U+10FFFF or
 * for a surrogate half, both of which are finite. A caption file containing
 * `&#99999999;` — malformed, or simply a `&#` followed by digits in ordinary
 * prose — therefore did not degrade to leaving the text alone, it aborted the
 * parse of the whole track and took the video's captions with it.
 *
 * Surrogates are excluded as well as out-of-range values: D800–DFFF are code
 * points that only exist as halves of a UTF-16 pair, and `fromCodePoint`
 * rejects them for the same reason.
 */
function isScalarValue(code: number): boolean {
  return (
    Number.isInteger(code) &&
    code >= 0 &&
    code <= 0x10ffff &&
    !(code >= 0xd800 && code <= 0xdfff)
  );
}

export function decodeCharacterReferences(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return isScalarValue(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return isScalarValue(code) ? String.fromCodePoint(code) : whole;
    }
    // An unrecognised name is left exactly as it was found rather than dropped:
    // `&foo;` is more likely to be somebody's text than a reference we failed
    // to implement, and deleting it would be silent.
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

export function encodeCharacterReferences(text: string): string {
  return text.replace(/[&<> ‎‏]/g, (ch) => ESCAPES[ch] ?? ch);
}

/**
 * Cue payload text into nodes.
 *
 * Unclosed tags close at the end of the cue, which is not leniency — §1.8 says
 * the final `</v>`, `</rt>` and `</ruby>` may be omitted, and `<v Speaker>` with
 * no end tag is the commonest form in real caption files.
 */
export function parseCueText(text: string): CueNode[] {
  const root: CueNode[] = [];
  const stack: { kind: string; children: CueNode[] }[] = [];
  const children = (): CueNode[] => stack[stack.length - 1]?.children ?? root;

  let position = 0;
  let plain = "";

  const flush = (): void => {
    if (plain.length === 0) return;
    children().push({ kind: "text", text: decodeCharacterReferences(plain) });
    plain = "";
  };

  while (position < text.length) {
    const next = text.indexOf("<", position);
    if (next < 0) {
      plain += text.slice(position);
      break;
    }
    plain += text.slice(position, next);

    const close = text.indexOf(">", next);
    if (close < 0) {
      // An unterminated `<` is literal text; a caption saying "5 < 6" that
      // forgot to escape should still read as "5 < 6".
      plain += text.slice(next);
      break;
    }

    const raw = text.slice(next + 1, close);
    position = close + 1;

    if (raw.startsWith("/")) {
      flush();
      const name = raw.slice(1).trim();
      const kind = TAG_KINDS[name];
      // Close the innermost matching element. A mismatched end tag closes
      // nothing rather than unwinding the stack, so `<b>a</i>b</b>` keeps both
      // letters bold instead of losing the second one.
      for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
        if (stack[depth]?.kind === kind) {
          stack.length = depth;
          break;
        }
      }
      continue;
    }

    flush();

    // Tested before the tag is split on `.`, because a timestamp tag is *all*
    // dots and colons: splitting `00:00:01.000` on `.` first yields the tag name
    // `00:00:01` with a class of `000`, which is neither an error nor a
    // timestamp — it is a silently dropped karaoke split point.
    if (TIMESTAMP.test(raw)) {
      children().push({ kind: "timestamp", atSeconds: parseTimestamp(raw) });
      continue;
    }

    const space = raw.search(/[ \t]/);
    const head = space < 0 ? raw : raw.slice(0, space);
    const annotation = space < 0 ? "" : raw.slice(space + 1).trim();
    const [name = "", ...classes] = head.split(".");

    const kind = TAG_KINDS[name];
    if (kind === undefined) {
      // An unknown tag is dropped, not rendered: §1.8's tag list is closed, and
      // passing `<script>` through to a renderer that builds real DOM is how a
      // caption file becomes an injection vector.
      continue;
    }

    const node =
      kind === "voice"
        ? {
            kind,
            speaker: decodeCharacterReferences(annotation),
            classes,
            children: [] as CueNode[],
          }
        : kind === "lang"
          ? {
              kind,
              language: decodeCharacterReferences(annotation),
              classes,
              children: [] as CueNode[],
            }
          : { kind, classes, children: [] as CueNode[] };

    children().push(node);
    stack.push({ kind, children: node.children });
  }

  flush();
  return root;
}

/** Nodes back to cue payload text. Closes every element it opens. */
export function serialiseCueText(nodes: readonly CueNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.kind === "text") {
      out += encodeCharacterReferences(node.text);
      continue;
    }
    if (node.kind === "timestamp") {
      out += `<${formatTimestamp(node.atSeconds)}>`;
      continue;
    }
    const name = TAG_NAMES[node.kind] ?? node.kind;
    const classes = node.classes.map((c) => `.${c}`).join("");
    const annotation =
      node.kind === "voice"
        ? ` ${encodeCharacterReferences(node.speaker)}`
        : node.kind === "lang"
          ? ` ${encodeCharacterReferences(node.language)}`
          : "";
    out += `<${name}${classes}${annotation}>${serialiseCueText(node.children)}</${name}>`;
  }
  return out;
}

/* ================================================================== a file == */

export interface VttCue {
  /** §1.3: optional, no defined semantics, surfaced as `cue.id` for scripting. */
  readonly id: string | null;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly settings: CueSettings;
  /** The payload as written, markup and all. {@link parseCueText} turns it into nodes. */
  readonly text: string;
}

export interface VttRegion {
  readonly id: string;
  /** The remaining `key:value` lines, unparsed — §1.5's five settings and any future one. */
  readonly settings: Readonly<Record<string, string>>;
}

export interface VttDocument {
  /** Whatever followed `WEBVTT` on the first line. Usually empty. */
  readonly header: string;
  readonly regions: readonly VttRegion[];
  /** Raw CSS from `STYLE` blocks, one string per block. */
  readonly styles: readonly string[];
  readonly cues: readonly VttCue[];
  /** Blocks that were skipped, and why. Never fatal — see the file header. */
  readonly issues: readonly VttParseIssue[];
}

const BLANK = /^[ \t]*$/;

/**
 * Parse a whole file.
 *
 * Throws only when the input is not a WebVTT file: no `WEBVTT` on the first
 * line, or a header line that runs the word into other text (§1.1 —
 * `WEBVTTFOO` is invalid where `WEBVTT FOO` is fine). Everything after that is
 * recoverable and recorded.
 */
export function parseVtt(source: string): VttDocument {
  // The BOM is optional and, if present, is not part of the first line's text —
  // a `startsWith("WEBVTT")` against an unstripped string fails on a file every
  // Windows editor produces.
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const lines = text.split(/\r\n|\r|\n/);

  const first = lines[0] ?? "";
  if (!first.startsWith("WEBVTT")) {
    throw new VttError("Not a WebVTT file: the first line must be `WEBVTT`.", 1);
  }
  const header = first.slice("WEBVTT".length);
  if (header.length > 0 && !/^[ \t]/.test(header)) {
    throw new VttError(
      `Not a WebVTT file: \`WEBVTT\` must be followed by a space or tab, got ${JSON.stringify(first)}.`,
      1,
    );
  }
  if (header.includes("-->")) {
    throw new VttError("Not a WebVTT file: the header line contains `-->`.", 1);
  }

  const regions: VttRegion[] = [];
  const styles: string[] = [];
  const cues: VttCue[] = [];
  const issues: VttParseIssue[] = [];

  let index = 1;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (BLANK.test(line)) {
      index += 1;
      continue;
    }

    const start = index;
    const keyword = line.trim();

    if (keyword === "NOTE" || /^NOTE[ \t]/.test(line)) {
      index = skipToBlank(lines, index);
      continue;
    }

    if (keyword === "STYLE" || keyword === "REGION") {
      const end = skipToBlank(lines, index + 1);
      const body = lines.slice(index + 1, end);
      index = end;
      // §1.1: once a cue has appeared, no more STYLE or REGION blocks. Recorded
      // rather than obeyed — the block still describes something the author
      // meant, and rejecting it silently is how a caption file loses its styling
      // with no explanation.
      if (cues.length > 0) {
        issues.push({
          line: start + 1,
          message: `A ${keyword} block appears after the first cue, which §1.1 does not allow.`,
        });
      }
      if (keyword === "STYLE") styles.push(body.join("\n"));
      else {
        const region = toRegion(body);
        if (region) regions.push(region);
        else
          issues.push({
            line: start + 1,
            message: "Skipped a REGION block with no id.",
          });
      }
      continue;
    }

    /* --- a cue ------------------------------------------------------------ */

    let id: string | null = null;
    let timing = line;
    if (!timing.includes("-->")) {
      id = timing.trim();
      index += 1;
      const second = lines[index];
      if (second === undefined || BLANK.test(second) || !second.includes("-->")) {
        issues.push({
          line: start + 1,
          message: `Skipped a block with no timing line: ${JSON.stringify(id)}.`,
        });
        index = skipToBlank(lines, index);
        continue;
      }
      timing = second;
    }
    index += 1;

    const payload: string[] = [];
    while (index < lines.length) {
      const next = lines[index] ?? "";
      if (BLANK.test(next)) break;
      // §1.3: a payload line cannot contain `-->`. A line that does belongs to
      // the next cue, and if the line before it is not blank it is that cue's
      // identifier — so it is handed back rather than kept. Without this, one
      // missing blank line swallows every remaining cue in the file into a
      // single payload.
      if (next.includes("-->")) {
        if (payload.length > 0) {
          payload.pop();
          index -= 1;
        }
        break;
      }
      payload.push(next);
      index += 1;
    }

    const cue = toCue(id, timing, payload, start + 1, issues);
    if (cue) {
      const previous = cues[cues.length - 1];
      if (previous && cue.startSeconds < previous.startSeconds) {
        // §1.3 calls this a per-cue parse error. The cue is kept anyway: it
        // carries words somebody needs to read, and the only thing its position
        // in the file costs us is the ability to binary-search — which
        // `activeCues` does not do.
        issues.push({
          line: start + 1,
          message: "A cue starts before the one before it, which §1.3 forbids.",
        });
      }
      cues.push(cue);
    }
  }

  return { header: header.trim(), regions, styles, cues, issues };
}

function skipToBlank(lines: readonly string[], from: number): number {
  let index = from;
  while (index < lines.length && !BLANK.test(lines[index] ?? "")) index += 1;
  return index;
}

function toRegion(body: readonly string[]): VttRegion | null {
  const settings: Record<string, string> = {};
  for (const line of body) {
    for (const pair of line.split(/[ \t]+/).filter(Boolean)) {
      const colon = pair.indexOf(":");
      if (colon <= 0) continue;
      settings[pair.slice(0, colon)] = pair.slice(colon + 1);
    }
  }
  const { id, ...rest } = settings;
  return id === undefined ? null : { id, settings: rest };
}

/**
 * §1.3's arrow: `-->` with **one or more** spaces or tabs on each side. The
 * whitespace is required, not optional, so `00:00.000-->00:01.000` is not a
 * timing line — and a regex written with `\s*` would accept it and quietly
 * disagree with every other parser about what this file contains.
 */
const TIMING = /^([^\s]+)[ \t]+-->[ \t]+([^\s]+)[ \t]*(.*)$/;

function toCue(
  id: string | null,
  timing: string,
  payload: readonly string[],
  line: number,
  issues: VttParseIssue[],
): VttCue | null {
  const match = TIMING.exec(timing.trim());
  if (!match) {
    issues.push({ line, message: `Skipped a cue: bad timing line ${JSON.stringify(timing)}.` });
    return null;
  }

  const [, rawStart = "", rawEnd = "", rawSettings = ""] = match;
  let startSeconds: number;
  let endSeconds: number;
  try {
    startSeconds = parseTimestamp(rawStart);
    endSeconds = parseTimestamp(rawEnd);
  } catch (error) {
    issues.push({
      line,
      message: `Skipped a cue: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }

  if (endSeconds <= startSeconds) {
    issues.push({
      line,
      message: `Skipped a cue: its end (${rawEnd}) is not after its start (${rawStart}).`,
    });
    return null;
  }

  const { settings, issues: settingIssues } = parseCueSettings(rawSettings, line);
  issues.push(...settingIssues);

  return {
    id: id && id.length > 0 ? id : null,
    startSeconds,
    endSeconds,
    settings,
    text: payload.join("\n"),
  };
}

/**
 * A document back to a file.
 *
 * Cues are written in the order given, not sorted: §1.3's non-decreasing rule
 * is about start times, and sorting here would silently reorder a file whose
 * author overlapped two cues on purpose. A caller that wants them sorted sorts
 * them.
 */
export function serialiseVtt(
  document: Partial<Omit<VttDocument, "cues" | "issues">> & {
    readonly cues: readonly VttCue[];
  },
): string {
  const header = document.header ? `WEBVTT ${document.header}` : "WEBVTT";
  const blocks: string[] = [header];

  for (const region of document.regions ?? []) {
    const settings = Object.entries(region.settings).map(
      ([key, value]) => `${key}:${value}`,
    );
    blocks.push(["REGION", `id:${region.id}`, ...settings].join("\n"));
  }

  for (const style of document.styles ?? []) {
    blocks.push(`STYLE\n${style}`);
  }

  for (const cue of document.cues) {
    const settings = formatCueSettings(cue.settings);
    const timing =
      `${formatTimestamp(cue.startSeconds)} --> ${formatTimestamp(cue.endSeconds)}` +
      (settings ? ` ${settings}` : "");
    blocks.push([...(cue.id ? [cue.id] : []), timing, cue.text].join("\n"));
  }

  // A trailing newline, because §1.1's blocks are separated by line
  // terminators and a file whose last cue has none is one an editor will
  // "helpfully" change on first save.
  return `${blocks.join("\n\n")}\n`;
}

/**
 * The cues covering a moment, in file order.
 *
 * Half-open on the end — a cue ending at 4.000 is not active at 4.000 — which
 * is the boundary the browser's own `activeCues` uses, and matching it means a
 * self-rendered caption layer and a native one do not disagree by one frame at
 * every cue change.
 */
export function activeCuesAt(
  cues: readonly VttCue[],
  seconds: number,
): VttCue[] {
  return cues.filter(
    (cue) => seconds >= cue.startSeconds && seconds < cue.endSeconds,
  );
}
