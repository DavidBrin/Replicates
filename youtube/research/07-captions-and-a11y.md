# R7 — Captions, Keyboard Interaction, and Accessibility

Scope: everything that makes the player usable by someone who is not looking at it (screen reader / low vision / keyboard-only) or not hearing it (captions / deaf / hard of hearing). Implementation-grade reference with citations. No application code beyond illustrative snippets.

---

## 1. WebVTT format

Primary sources: [W3C WebVTT: The Web Video Text Tracks Format](https://www.w3.org/TR/webvtt1/) (the REC-track spec) and the [editor's draft](https://w3c.github.io/webvtt/). MDN's [WebVTT API](https://developer.mozilla.org/en-US/docs/Web/API/WebVTT_API) overview corroborates the object-model side.

### 1.1 File structure

```
[BOM]WEBVTT[ optional text, not containing "-->"][LF|CRLF|CR]
[LF|CRLF|CR]                              <- blank line, 2+ line terminators total before first block
[REGION / STYLE / NOTE / cue blocks, each separated by 1+ line terminators]
```

- Optional leading `U+FEFF` BYTE ORDER MARK.
- File **must** start with the literal string `WEBVTT`. Anything after it on that line is ignored, but if present must be preceded by a space or tab (so `WEBVTTFOO` is invalid, `WEBVTT FOO` is valid) and must not contain the substring `-->`.
- MIME type is `text/vtt`, encoding UTF-8.
- After the header line, blocks (REGION, STYLE, NOTE, cues) appear in any order except: all `REGION` blocks must precede any cue, and `STYLE` blocks must precede any cue (they may be interleaved with REGION and NOTE blocks, but once a cue appears, no more STYLE/REGION blocks are allowed). Blocks are separated by one or more blank lines.

### 1.2 Timestamp grammar — the exact off-by-one trap

A WebVTT timestamp is:

```
[HH:]MM:SS.mmm
```

Per spec (§ "WebVTT timestamp"), in order:

1. **Hours** — optional, but *required if the hour value is non-zero*. When present: **two or more** ASCII digits (not capped at 2 — `123:00:00.000` is a legal 123-hour timestamp), followed by `:`.
2. **Minutes** — **exactly two** ASCII digits, value constrained `0 ≤ minutes ≤ 59`. This constraint holds **even when the hours component is omitted.**
3. `:`
4. **Seconds** — exactly two ASCII digits, `0 ≤ seconds ≤ 59`.
5. `.`
6. **Milliseconds** — exactly three ASCII digits (thousandths of a second, so `.5` is invalid; must be `.500`).

**The classic bug this document is warning about:** unlike SubRip (`.srt`), where `MM:SS` timestamps can carry an unbounded minute count, WebVTT's grammar caps minutes at 59 *regardless of whether hours are present*. A caption at 90 minutes into a video **must** be written `01:30:00.000` — `90:00.000` is a parse error, not "90 minutes with hours omitted." A naive port of an SRT parser (or a naive regex `^(\d+):(\d{2})\.(\d{3})$` that doesn't validate the minutes range) will silently mis-handle long-form content. Symmetrically, when writing a two-component timestamp for a cue under one hour, do **not** emit minutes > 59.

Also note: seconds/minutes are exactly 2 digits (not "2 or more") — only the optional hours field is variable-width.

### 1.3 Cue block syntax

```
[cue-identifier LF]
[HH:]MM:SS.mmm --> [HH:]MM:SS.mmm [cue-settings]
cue payload text
[more payload lines]
```

- **Cue identifier** (optional): any text not containing `-->`, LF, or CR, on its own line before the timing line. Commonly a sequential number or a stable ID (`captions.utf8.vtt` conventions vary; the identifier has no defined semantics to the browser — it's purely for scripting/xref, e.g. `cue.id`).
- **Arrow**: exactly `-->`, surrounded by **one or more** U+0020 SPACE or U+0009 TAB characters on each side (not optional whitespace — some whitespace is required).
- **Ordering rule**: a cue's start time must be ≥ every previous cue's start time in file order (cues need not be non-overlapping, but must be non-decreasing by start time as they appear in the file — an out-of-order file is a per-cue parse error in that cue, not necessarily fatal to the whole file; conforming parsers are expected to be resilient and skip just the malformed cue/block, continuing with the next blank-line-delimited block).
- End time must be greater than start time.
- **Payload**: one or more lines of cue text, terminated by a blank line or EOF. Payload lines cannot contain a blank line internally (a blank line always ends the cue) and cannot contain the literal `-->`.

### 1.4 Cue settings

Space/tab-separated `key:value` pairs on the timing line, each key allowed at most once, order-independent:

| Setting | Grammar | Semantics |
|---|---|---|
| `vertical:rl\|lr` | literal `rl` or `lr` | Sets vertical writing mode (growing right-to-left or left-to-right); absent = horizontal. |
| `line:<num>[%][,start\|center\|end]` | signed integer, or percentage with `%` | Line offset of the cue box: as a line-count from the video's caption area edge (can be negative to count from the "before" edge), or as a percentage of the video's height. Optional second component sets line alignment. |
| `position:<percentage>[,line-left\|center\|line-right]` | `0–100%` | Horizontal (or in vertical mode, corresponding-axis) position of the cue box as a percentage of the video width, plus optional position alignment. |
| `size:<percentage>` | `0–100%` | Width of the cue box as a percentage of video width (or height, in vertical mode). |
| `align:start\|center\|end\|left\|right` | keyword | Text alignment inside the cue box. |
| `region:<identifier>` | matches a `REGION` block's `id` | Attaches the cue to a named region; when set, `line`/`position` are ignored (region positioning wins). |

### 1.5 `REGION` block

```
REGION
id:crawl
width:40%
lines:3
regionanchor:0%,100%
viewportanchor:10%,90%
scroll:up
```

- `id` — required, arbitrary string without spaces or `-->`. Referenced by cues via `region:<id>`.
- `width` — percentage of video width the region occupies (default 100%).
- `lines` — number of visible lines in the region's scroll box (default 3).
- `regionanchor` — `X%,Y%` point within the region that's pinned to `viewportanchor` (default `0%,100%`, i.e. bottom-left of region).
- `viewportanchor` — `X%,Y%` point within the video viewport the region is anchored to (default `0%,100%`, bottom-left of viewport).
- `scroll:up` — enables "roll-up" scrolling behavior (new lines push old ones up, like teletext captions); omitted = static/replace behavior.

### 1.6 `STYLE` block

```
STYLE
::cue {
  background-image: linear-gradient(to bottom, dimgray, lightgray);
  color: papayawhip;
}
::cue(b) {
  color: peachpuff;
}
```

Raw CSS, scoped to `::cue` / `::cue(<selector>)` pseudo-elements matching this track's cues. Constraints: cannot contain a blank line (blank line terminates the block) and cannot contain the substring `-->`. Must appear before the first cue in the file.

### 1.7 `NOTE` block

```
NOTE This is a comment
that can span multiple lines.

NOTE
Another comment block.
```

Starts with `NOTE` followed by a space, tab, or line terminator; ends at the next blank line or EOF. Ignored by the parser entirely — pure authoring commentary. Can appear anywhere between blocks (not inside a cue payload).

### 1.8 Inline cue-text markup

Applies inside cue payload text only:

| Tag | Form | Purpose |
|---|---|---|
| Bold | `<b>...</b>` | maps to `::cue(b)` |
| Italic | `<i>...</i>` | maps to `::cue(i)` |
| Underline | `<u>...</u>` | maps to `::cue(u)` |
| Class | `<c.className>...</c>` | arbitrary styling hook; `.` separated, multiple classes stack: `<c.yellow.bg_black>` |
| Voice | `<v Speaker Name>text</v>` (end tag optional if the voice span runs to the end of the cue) | speaker attribution; exposed to CSS as `::cue(v[voice="Speaker Name"])`, and to accessibility tooling as "who is speaking" |
| Language span | `<lang en-US>...</lang>` | overrides text direction/pronunciation for embedded foreign text; value must be a valid BCP 47 tag |
| Ruby | `<ruby>base<rt>annotation</rt></ruby>` | East-Asian ruby annotations; the final `</rt>`/`</ruby>` may be omitted at end of cue |
| **Timestamp tag** | `<HH:MM:SS.mmm>` | **karaoke-style word/phrase timing** — a bare timestamp (same grammar as §1.2) placed inline in the payload; the browser treats text after this point as "active" once playback crosses that timestamp, enabling word-by-word highlight without splitting into separate cues |

Example karaoke cue:

```
00:00:01.000 --> 00:00:04.000
<00:00:01.000>Never <00:00:01.500>gonna <00:00:02.000>give <00:00:02.500>you <00:00:03.000>up
```

A renderer that supports timestamp tags computes, for the currently active cue, which sub-span is "past" vs "future" relative to `currentTime` and can style accordingly (this is exactly what karaoke-style / word-highlight auto-caption UIs — YouTube's own auto-generated captions included — rely on).

Named built-in color classes some UAs give presentational defaults for (not part of the tag grammar itself, just conventional class names): `white lime cyan red yellow magenta blue black` (foreground) and `bg_white bg_lime bg_cyan bg_red bg_yellow bg_magenta bg_blue bg_black` (background).

**Character references**: standard HTML named/numeric character references are permitted in cue text and in tag annotations (voice names, etc.) — `&amp; &lt; &gt; &lrm; &rlm; &nbsp; &#160; &#x00A0;`. `&lrm;`/`&rlm;` (left/right-to-left marks) matter for correctly mixing RTL languages (Arabic/Hebrew captions) with LTR punctuation inside a single cue.

Sources: [W3C WebVTT REC](https://www.w3.org/TR/webvtt1/), [WebVTT editor's draft, timestamp/timing grammar](https://w3c.github.io/webvtt/#collect-a-webvtt-timestamp), [MDN WebVTT API](https://developer.mozilla.org/en-US/docs/Web/API/WebVTT_API).

---

## 2. Rendering captions: native `<track>` vs. self-rendered from `TextTrack`

### Route A — native `<track kind="captions">`

```html
<video controls>
  <source src="video.mp4" type="video/mp4">
  <track kind="captions" src="en.vtt" srclang="en" label="English" default>
</video>
```

The browser parses the VTT, renders cues into its own shadow-DOM caption layer, and exposes a small styling seam via the `::cue` / `::cue(<selector>)` pseudo-elements (`color`, `background-color`, `font-*`, `text-shadow`, `text-decoration`, `line-height`, `white-space`, `outline`/`ruby-position` in some browsers). ([MDN `<track>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/track), [MDN WebVTT API](https://developer.mozilla.org/en-US/docs/Web/API/WebVTT_API))

`kind="captions"` vs `kind="subtitles"` is a semantic distinction the browser surfaces in its CC menu: captions are expected to transcribe *dialogue + sound effects + music cues* (for deaf/HoH users muting or not hearing audio); subtitles transcribe *dialogue only*, typically for language translation. `srclang` is required whenever `kind="subtitles"`. Only one `default` track is honored.

**What you gain**: zero implementation work, correct behavior for browser-native fullscreen (cues render inside the fullscreen element automatically), and OS-level accessibility integration in some UAs (e.g., captions surface in system-level caption-style overrides on some platforms).

**What you lose / can't do**: you cannot reposition the caption box out from under a custom control bar reliably across browsers (`::cue` has no `top`/`left`/positioning properties — line/position are computed internally per the WebVTT rendering algorithm and you can't override that from CSS); you cannot build a caption-settings UI with font family/size/color/background/opacity/edge-style sliders that visibly apply, because `::cue` styling is coarse and inconsistently supported (Safari and Firefox support far fewer `::cue` properties than Chromium); you can't do custom animations, karaoke word-highlighting driven by timestamp tags, or multi-track simultaneous rendering (e.g., captions + a translated subtitle track at once); and fullscreen caption placement fights with any custom overlay UI you draw (native captions render above/below your controls unpredictably per-browser).

### Route B — `TextTrack` with `mode = 'hidden'` + your own DOM (what YouTube does)

```js
const track = video.addTextTrack('captions', 'English', 'en');
track.mode = 'hidden';           // cues are parsed & tracked, NOT painted by the UA
track.addEventListener('cuechange', () => {
  renderCuesYourself([...track.activeCues]);
});
```

Or, load a `.vtt` via a real `<track>` element but immediately set its `.track.mode = 'hidden'` after load so you get free WebVTT parsing from the browser but do 100% of the painting yourself.

**Mode semantics** ([MDN `TextTrack`](https://developer.mozilla.org/en-US/docs/Web/API/TextTrack)): `disabled` = cues not even processed; `hidden` = cues are processed (fires `cuechange`, populates `activeCues`) but the UA does not paint them — this is the mode built for exactly this use case; `showing` = UA paints them (Route A behavior).

**What you gain**: full styling control (this is how you implement YouTube's actual caption-settings panel — font size, font color/opacity, background color/opacity, window color/opacity, and edge style — see §3.5 below — none of which is achievable through `::cue` alone); precise positioning that can avoid the control bar (e.g., shift the caption stack up when the control bar auto-shows on mouse-move, something no native implementation exposes a hook for); the ability to render karaoke/word-level highlighting from timestamp tags; the ability to show two tracks at once (captions + a translation) or a debug/dev overlay; and consistent cross-browser rendering (you're not at the mercy of each engine's WebVTT box-layout implementation quality).

**What you must then reimplement yourself**: the WebVTT cue **positioning/layout algorithm** (mapping `line`/`position`/`size`/`align`/`vertical`/region settings to actual pixel boxes, including the automatic-line-selection behavior when `line` is unset — the spec's algorithm walks "line boxes" from the video edge and avoids overlapping already-active cues), **line wrapping** within the computed cue box width, the **cue-box-vs-video-edge and cue-vs-cue overlap avoidance rules** from the WebVTT rendering section of the spec (§ "Rendering" in the WebVTT spec — a nontrivial algorithm, since default-positioned cues stack from the bottom and must shift previous active cues up rather than overlapping), and inline markup rendering (`<b>/<i>/<u>/<c>/<v>/<lang>/<ruby>` → real DOM nodes with appropriate styling hooks, plus timestamp-tag-driven partial highlighting).

**Recommendation for this project: Route B.** We already need a caption-settings menu with font size/color/background/opacity/edge-style controls (see §6, YouTube's actual settings surface) and we need caption positioning that respects a custom, auto-hiding control bar — neither is achievable through `::cue`. Use the browser's native VTT *parser* for free (a real `<track>` element, or fetch+feed text into a hand-rolled/`vtt.js`-style parser) but always end with `mode = 'hidden'` and our own `cuechange`-driven DOM renderer. Budget real implementation time for the WebVTT cue-layout algorithm — it is the part most likely to be reinvented poorly (naive implementations get multi-active-cue stacking and region scrolling wrong first).

---

## 3. Captions in HLS

### 3.1 Declaring a subtitle rendition in the master (multivariant) playlist

Per [RFC 8216 §4.3.4.1 `EXT-X-MEDIA`](https://datatracker.ietf.org/doc/html/rfc8216):

```
#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,FORCED=NO,URI="subtitles/en.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Español",LANGUAGE="es",DEFAULT=NO,AUTOSELECT=YES,FORCED=NO,URI="subtitles/es.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English (forced)",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,FORCED=YES,URI="subtitles/en-forced.m3u8"

#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",SUBTITLES="subs"
video_720p.m3u8
```

Attribute semantics:

- **`TYPE=SUBTITLES`** — this rendition group carries WebVTT (or IMSC1) text tracks, not audio/video.
- **`GROUP-ID`** — a string tying a set of alternative renditions together; a video variant opts into a subtitle group by setting `SUBTITLES="subs"` on its `EXT-X-STREAM-INF` line (mirrors how `AUDIO="..."` groups work for multi-track audio).
- **`NAME`** — human-readable label for a player's track-selection UI (this is what should populate your CC menu's language list).
- **`LANGUAGE`** — BCP 47 language tag; used for automatic selection against the user's/browser's preferred languages.
- **`DEFAULT=YES|NO`** — at most one rendition per group should be `YES`; the client should play it if the user hasn't made an explicit choice and `AUTOSELECT` allows automatic behavior.
- **`AUTOSELECT=YES|NO`** — whether the client's automatic selection (driven by system language, accessibility settings, etc.) may choose this rendition without explicit user action. Must be `YES` if `DEFAULT=YES`.
- **`FORCED=YES|NO`** — subtitles-only attribute: marks a track containing only forced narrative content (e.g., burned-in-equivalent translations of foreign dialogue/on-screen text in an otherwise-undubbed source) that should display even when the user has subtitles off. A `FORCED=YES` rendition must share `LANGUAGE` with a corresponding non-forced rendition in the same group and must not carry `AUTOSELECT=NO`... practically: forced tracks are a "minimum necessary" track for comprehension, distinct from full closed captions.
- **`URI`** — points to the *media playlist* for that subtitle rendition (a second-level `.m3u8`, not the VTT file directly) unless you're doing single-file delivery (§3.3).

### 3.2 Segmented WebVTT and `X-TIMESTAMP-MAP`

A subtitle media playlist looks like a normal HLS media playlist but its segments are WebVTT files instead of media segments:

```
#EXTM3U
#EXT-X-TARGETDURATION=10
#EXT-X-VERSION=3
#EXT-X-MEDIA-SEQUENCE=0
#EXTINF:10.0,
subs0.vtt
#EXTINF:10.0,
subs1.vtt
#EXT-X-ENDLIST
```

Each referenced `.vtt` segment must either start with a normal `WEBVTT` header or carry an `EXT-X-MAP`-style association, and — critically — should carry an `X-TIMESTAMP-MAP` header line right after `WEBVTT` (RFC 8216 §3.5):

```
WEBVTT
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000

00:00:00.000 --> 00:00:02.000
Hello there.
```

`X-TIMESTAMP-MAP=LOCAL:<vtt-timestamp>,MPEGTS:<90kHz-clock-value>` tells the client the correspondence between this segment's internal (`LOCAL`) WebVTT cue-time zero point and the container's MPEG-2 Transport Stream 90kHz presentation clock (`MPEGTS`) at that same instant — this is what lets a subtitle segment, whose cue times always restart near zero, be placed correctly on the shared program timeline alongside the video/audio segments (which use PTS values from the TS mux). If a segment omits `X-TIMESTAMP-MAP`, the client assumes VTT time `00:00:00.000` maps to MPEG-2 timestamp `0`.

### 3.3 Do we need segmented VTT, given we control both ends?

**No — serve a single whole-file WebVTT per language, not segmented VTT.** `X-TIMESTAMP-MAP` and per-segment VTT splitting exist to solve two problems neither of which applies to us:

1. **Live/DVR windowing** — segmenting subtitles lets a live HLS player evict old subtitle segments from its playlist the same way it evicts old media segments, and lets the player join a live stream mid-way without downloading the whole caption history. We are not building a live-streaming product for this replica's caption path (VOD-only, per the rest of the project); the whole point of windowing doesn't apply.
2. **MPEG-TS-remuxed timestamp discontinuities** — `X-TIMESTAMP-MAP` exists because MPEG-TS segments carry their own PTS space that can jump at discontinuities, ad breaks, etc., and subtitle segments need explicit re-anchoring. If we serve fMP4 (CMAF) segments for video/audio (the modern default; Apple has deprecated plain MPEG-TS for new content) and a *single* VTT file for a whole VOD asset, there's no discontinuity to re-anchor — the VTT file's own cue timestamps line up with the asset's media time directly, no `X-TIMESTAMP-MAP` needed at all.

A single `EXT-X-MEDIA` line whose `URI` points straight at one `.vtt` file (no intermediate subtitle media playlist) is valid HLS and is exactly what Apple's own guidance and most production encoders (Mux, Shaka Packager, Bento4) do for VOD: `URI="en.vtt"` directly, skipping segmentation entirely. This is simpler to generate, simpler to cache (one file, one CDN object, one cache key), and gives the browser everything it needs in one request — precisely because we, as both encoder and player, don't need to solve live-windowing or remux-discontinuity problems for VOD content.

If a live/DVR path is added later, segmented VTT + `X-TIMESTAMP-MAP` becomes necessary and should be revisited then — but it should not be built preemptively into the VOD caption pipeline.

Sources: [RFC 8216 — HTTP Live Streaming](https://datatracker.ietf.org/doc/html/rfc8216), [pantos/HLS current draft (RFC 8216bis)](https://www.rfc-editor.org/rfc/rfc8216.html), [AWS MediaConvert — WebVTT input captions as part of an HLS source](https://docs.aws.amazon.com/mediaconvert/latest/ug/WebVTT-in-HLS.html), [mpegflow — HLS X-TIMESTAMP-MAP](https://www.mpegflow.com/topics/protocols/hls-x-timestamp-map).

---

## 4. Auto-captions via Web Speech

### 4.1 `SpeechRecognition` — what it actually is

Spec home: [Web Speech API, W3C Community Group Draft Report](https://webaudio.github.io/web-speech-api/) (repo: [`WebAudio/web-speech-api`](https://github.com/WebAudio/web-speech-api)). This is **not** a W3C Recommendation — it's a Community Group report, meaning it's implementer-consensus-driven rather than standards-track, and its shape has genuinely changed over the life of the API (see §4.2). MDN: [`SpeechRecognition`](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition).

**Browser support is narrow and historically Chromium-centric.** MDN marks the interface "not Baseline — does not work in some of the most widely used browsers." In practice: Chrome/Edge/other Chromium browsers support it unprefixed as `SpeechRecognition` (with `webkitSpeechRecognition` as a long-lived legacy alias you should still feature-detect for); Safari supports it as `webkitSpeechRecognition`; Firefox's support is limited/partial. Any production use must feature-detect:

```js
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) { /* fall back — see §4.4 null adapter */ }
```

**It has historically been a server-based engine, not on-device.** On Chrome specifically, captured audio is streamed to a Google speech-recognition backend for processing — it does not work offline, and it is a real privacy/data-flow consideration (audio leaves the device) that should be disclosed to users if this path is ever wired to real (non-demo) audio. As of the current spec draft this is evolving: a `processLocally` option and on-device install flow (`SpeechRecognition.available()` / `SpeechRecognition.install()`) have been proposed/shipped in Chrome to allow on-device-only recognition, but the *default* still permits "any available recognition method," which in practice still means "may go to the network" unless the caller opts into `processLocally: true`. Treat "does this stay on-device" as an explicit configuration decision, not an assumption. ([WebAudio/web-speech-api on-device explainer](https://github.com/WebAudio/web-speech-api/blob/main/explainers/on-device-speech-recognition.md))

### 4.2 Key properties, `continuous`, `interimResults`, and the result shape

| Property | Default | Effect |
|---|---|---|
| `lang` | HTML `lang` or UA default | BCP 47 recognition language |
| `continuous` | `false` | `false` = stop after first final result (single-utterance mode); `true` = keep recognizing across pauses until explicitly `.stop()`ped — required for transcribing a whole video rather than one sentence |
| `interimResults` | `false` | `true` = emit non-final, in-progress hypotheses via `result` events (`result.isFinal === false`) as the engine keeps revising them, in addition to final results |
| `maxAlternatives` | `1` | Number of ranked alternative transcripts per result |
| `processLocally` | — (newer) | Request on-device-only recognition |

`result` event shape:

```js
recognition.onresult = (event) => {
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const result = event.results[i];           // SpeechRecognitionResult
    const best = result[0];                     // SpeechRecognitionAlternative
    console.log(best.transcript, best.confidence, result.isFinal);
    // result[1..maxAlternatives-1] = other ranked alternatives
  }
};
```

`SpeechRecognitionEvent.results` is a live-growing `SpeechRecognitionResultList`; each `SpeechRecognitionResult` is itself an indexable list of `SpeechRecognitionAlternative { transcript, confidence }` and carries `isFinal`. Other events: `start`, `audiostart`, `soundstart`, `speechstart`, `speechend`, `soundend`, `audioend`, `nomatch`, `error`, `end`.

### 4.3 Can it transcribe a media element or file directly — and the honest real-time caveat

**Historically: no — microphone only.** For most of this API's life, `start()` took no arguments and always pulled from the default microphone input; there was no supported way to hand it a file or a `MediaStream`.

**Current state (per current MDN documentation for `SpeechRecognition.start()`): `start()` now accepts an optional `audioTrack` parameter — a live `MediaStreamTrack` (`kind: "audio"`, `readyState: "live"`) — which lets you point recognition at *any* audio track, not just the mic.** This is what makes file/media-element transcription possible without a physical loopback:

```js
const audioElement = new Audio('lecture.mp3');
audioElement.addEventListener('canplay', () => {
  const stream = audioElement.captureStream();      // HTMLMediaElement -> MediaStream
  const audioTrack = stream.getAudioTracks()[0];
  audioElement.play();                               // must actually be playing
  recognition.start(audioTrack);
});
```

Passing an `audioTrack` whose `kind` isn't `"audio"` or whose `readyState` isn't `"live"` throws `InvalidStateError`. Cross-browser support for this specific overload should be assumed to be **at least as narrow as `SpeechRecognition` support itself** — verify per-browser before relying on it, and always keep the microphone-only path as the fallback since this parameter is a newer, less broadly implemented addition than the base API.

**The real-time constraint still applies, and this is the important honest caveat regardless of which capture route is used:** `captureStream()` on an `HTMLMediaElement` produces a live `MediaStream` tied to the element's actual real-time playback — it is not an offline/batch decode. The audio must actually play out through the element for samples to reach the track. That means:

- **A 10-minute video takes (at least) 10 minutes to auto-caption this way.** There is no way to hand the API a file and get a transcript back faster than the audio plays, because the browser never decodes-and-recognizes offline — it only recognizes what streams past it in real time.
- Bumping `audioElement.playbackRate` up (e.g., 2×) *might* proportionally shorten wall-clock time, but pitch-corrected fast playback measurably degrades ASR accuracy in practice (word boundaries and phoneme timing shift), and no browser/spec text makes any accuracy or timing guarantee under altered playback rate — treat this as an unverified, likely-lossy trick, not a supported path.
- If muting is desired during background transcription (so a user isn't forced to hear the video while it's being auto-captioned), be aware that some engines quietly ignore captured-but-silent/very-low-gain audio, so `element.muted = true` while `captureStream()`-feeding recognition is a case to test empirically per browser rather than assume works.

Sources: [MDN `SpeechRecognition`](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition), [MDN `SpeechRecognition.start()`](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/start), [Web Speech API spec](https://webaudio.github.io/web-speech-api/), [`WebAudio/web-speech-api` issue #66 — SpeechRecognition on a MediaStreamTrack](https://github.com/WebAudio/web-speech-api/issues/66).

### 4.4 A `SpeechRecogniser` port: real ASR is one adapter away

To avoid coupling caption-generation logic to a single, narrow, historically-shifting browser API, define a small port and keep every recognizer behind it:

```ts
interface TranscriptSegment {
  text: string;
  startMs: number;      // best-effort; see §5 for what's actually available
  endMs: number;
  isFinal: boolean;
  confidence?: number;
}

interface SpeechRecogniser {
  transcribe(
    audio: MediaStreamTrack | Blob | ReadableStream<Uint8Array>,
    opts: { lang: string; interim?: boolean }
  ): AsyncIterable<TranscriptSegment>;
}
```

Adapters:

- **`WebSpeechRecogniserAdapter`** — wraps `SpeechRecognition`, feeding it either the mic or (§4.3) a `captureStream()`-derived `audioTrack`, mapping `onresult` events to `TranscriptSegment`s. Real-time-rate, browser-and-network dependent, best treated as a "demo/no-backend" tier.
- **`CloudAsrRecogniserAdapter`** — wraps a real streaming or batch ASR service (Google Cloud Speech-to-Text, AWS Transcribe, Whisper-based services, etc.), uploading/streaming the actual source audio (not real-time-gated) and normalizing its result shape into the same `TranscriptSegment` stream. This is the tier that can process faster-than-real-time and gives word-level timing (§5.3).
- **`NullSpeechRecogniser`** — the adapter used whenever no recognizer is configured or available (Web Speech unsupported in this browser, no cloud credentials configured, feature-flagged off, etc.). It must not silently no-op in a way that looks like "captions are just empty" — it should synchronously signal "auto-captions unavailable" so the UI can grey out the auto-caption toggle and fall back to any human-authored `.vtt` track instead, rather than showing an empty caption track that looks like a bug.

This mirrors the standard hexagonal-architecture "port and adapter" shape: the player and caption-rendering code depend only on `SpeechRecogniser`/`TranscriptSegment`, never on `SpeechRecognition` directly, so swapping the browser API for a real backend (the near-certain eventual direction, given §4.3's real-time ceiling) is a new adapter, not a rewrite.

---

## 5. Word-level timing

### 5.1 Does Web Speech give timings?

**No.** Nothing in the `SpeechRecognitionResult` / `SpeechRecognitionAlternative` shape carries per-word start/end offsets — you get `transcript` (a string) and `confidence` (a number) per alternative, and `isFinal` per result. There is no word- or phoneme-level timestamp anywhere in the API surface. (Confirmed against the result shape in [MDN `SpeechRecognitionEvent`](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) / [`SpeechRecognitionResult`](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionResult) and the [spec](https://webaudio.github.io/web-speech-api/).)

The only timing signal available at all is *event-level*: the wall-clock time at which a `result` event fires (a JS-side `Date.now()`/`performance.now()` you capture yourself), and the coarse `isFinal` transition between interim and final results for that utterance. That's utterance-boundary timing at best, not word timing.

### 5.2 What a caption built from timing-less ASR output looks like

Without real per-word timing, the honest minimum caption you can produce is one cue per *final result event*, timed to when you observed it, not to when the words were actually spoken:

```vtt
WEBVTT

00:00:00.000 --> 00:00:04.230
so today we're going to look at

00:00:04.230 --> 00:00:09.850
how the scheduler actually assigns priority
```

Where the boundary timestamps are literally "when did the browser fire this final `result` event," possibly backdated by a fixed estimated latency offset. This is **utterance-level, not word-level**, timing, and it drifts: recognition latency is not constant, so cue boundaries creep relative to the actual audio the longer a video runs, and a viewer will see text appear noticeably after (or, if you back-date naively, occasionally before) the corresponding speech. There is no karaoke-style word highlighting possible from this data — the WebVTT timestamp tag (§1.8) has nothing to key off.

### 5.3 How real systems get word-level alignment

Real ASR/captioning pipelines get word timing one of two ways, neither available through Web Speech:

1. **ASR engines that natively emit word timestamps** — most production cloud ASR APIs (Google Cloud Speech-to-Text, AWS Transcribe, Azure Speech, Whisper-derived services with word-timestamp options) return a `words: [{ word, startTime, endTime, confidence }]` array alongside the transcript, because their underlying acoustic models operate on fixed-size audio frames and can report which frame(s) a given decoded token aligned to as a side effect of decoding. This is a fundamentally different (and heavier) computation than what an in-browser, string-only `transcript` API exposes.
2. **Forced alignment** — given a known/finalized transcript and the source audio, a separate alignment model (e.g., Montreal Forced Aligner, Gentle, or an alignment mode of an ASR model) is run purely to map each existing word to a time range in the audio, without doing recognition itself. This is the standard approach when captions are authored/edited by a human (so the *text* is already correct and complete) but per-word timing is still wanted for karaoke-style highlighting or precise cueing — you align known text to audio rather than re-recognizing it.

### 5.4 Our honest minimum

Given the constraints above, the honest minimum for this project's auto-caption path is: **utterance-level (not word-level) cues, timed to observed `result`-event boundaries, generated only via a real ASR adapter that streams/batches actual source audio (not the real-time Web Speech path) if auto-captions are meant to be usable at normal scale.** The Web Speech adapter (§4.4) should be understood and documented as a demo/fallback tier with a real, disclosed real-time cost and no word timing — not the production auto-caption path. If word-level highlighting is ever wanted, it requires either switching to a cloud ASR provider that returns word timestamps, or running forced alignment against human-authored transcripts; Web Speech alone cannot get you there under any configuration.

---

## 6. YouTube's keyboard map

Primary source: [YouTube Help — Keyboard shortcuts for YouTube](https://support.google.com/youtube/answer/7631406?hl=en) (the in-product list, reachable in the web player itself via `Shift+?`). That help-center article covers the core transport/navigation keys but omits the caption-styling and theater-mode keys that are actually present in the live in-player `Shift+?` panel; those are cross-checked below against a community-maintained transcription of that panel's own content ([code-charity/youtube wiki — "Youtube's Shortcuts (from youtube.com)"](https://github.com/code-charity/youtube/wiki/Youtube's-Shortcuts-(from-youtube.com))), which should be treated as corroborating-but-secondary — re-verify directly against the live `Shift+?` panel before shipping, since it is the one authoritative, always-current source and third-party transcriptions of it can drift.

| Key(s) | Action | Scope | Confirmed against |
|---|---|---|---|
| `Space` / `k` | Play / pause | Player-focused (space also activates a focused button when the seek bar/player region has focus — see caveat below) | Official help page |
| `j` | Seek back 10s | Player-focused | Official help page |
| `l` | Seek forward 10s | Player-focused | Official help page |
| `←` | Seek back 5s | Player-focused | Official help page |
| `→` | Seek forward 5s | Player-focused | Official help page |
| `↑` | Volume up 5% | Player-focused | Official help page |
| `↓` | Volume down 5% | Player-focused | Official help page |
| `,` (comma) | Previous frame — **only while paused** | Player-focused | Official help page |
| `.` (period) | Next frame — **only while paused** | Player-focused | Official help page |
| `Home` | Seek to start | Player-focused | Official help page |
| `End` | Seek to end | Player-focused | Official help page |
| `0`–`9` | Seek to `n`×10% of duration (`0` = start) | Player-focused | Official help page |
| `<` (`Shift+,`) | Decrease playback speed | Player-focused | Official help page |
| `>` (`Shift+.`) | Increase playback speed | Player-focused | Official help page |
| `f` | Toggle fullscreen | Player-focused | Official help page |
| `t` | Toggle theater mode | Player-focused | **Not** on the official help page; corroborated by in-player-panel transcription + a Google/YouTube support-community thread confirming the live behavior |
| `i` | Toggle miniplayer | Player-focused | Official help page |
| `Escape` | Close miniplayer or an open dialog | Global-ish | In-player-panel transcription only |
| `m` | Mute / unmute | Player-focused | Official help page |
| `c` | Toggle captions/subtitles on/off (if available) | Player-focused | Official help page |
| `o` | Cycle caption **text opacity** — **only while captions are on** | Player-focused | In-player-panel transcription only, not the official help page |
| `w` | Cycle caption **window (background box) opacity** — **only while captions are on** | Player-focused | In-player-panel transcription only, not the official help page |
| `+` | Increase caption font size — **only while captions are on** | Player-focused | In-player-panel transcription only, not the official help page |
| `-` | Decrease caption font size — **only while captions are on** | Player-focused | In-player-panel transcription only, not the official help page |
| `Ctrl+→` (Win) / `⌥+→` (Mac) | Next chapter | Player-focused | Official help page |
| `Ctrl+←` (Win) / `⌥+←` (Mac) | Previous chapter | Player-focused | Official help page |
| `Shift+N` | Next video (queue/playlist/autoplay context) | Global-ish (works outside strict player focus in a watch page) | Official help page |
| `Shift+P` | Previous video (playlist context) | Global-ish | Official help page |
| `/` | Focus the search box | Global | Official help page |
| `Shift+?` | Open the keyboard shortcuts help panel | Global | Official help page |

Notes and caveats to verify empirically against current YouTube rather than assume are frozen forever:

- The `o`/`w`/`+`/`-` caption-styling keys and `t` theater mode are real, corroborated by multiple independent secondary sources and, for `t`, a YouTube support-community thread — but since they're absent from the one document that was named as the primary source (the help-center article), treat the "Confirmed against" column above as the honesty marker it's meant to be, and re-run the in-player `Shift+?` panel check before shipping a shortcut table into product code.
- `o`/`w`/`+`/`-` are documented as conditional on captions already being on — verify whether they're actually no-ops (vs. silently doing nothing useful, vs. throwing) when captions are off, and build the same guard into our handler rather than letting them act on a caption layer that isn't rendering.
- Numeric seek (`0`–`9`) and frame-step (`,`/`.`) both correctly require player context and, for frame-step, a paused state — build both preconditions into our handler, not just the key match.

### 6.1 Global vs. player-focused, and not stealing keystrokes from inputs

YouTube's shortcuts are **not** truly global document-level `keydown` listeners fired unconditionally — most (play/pause, seek, volume, fullscreen, captions, speed) are scoped to when the player/document body — not a text input — has focus. The mechanism that keeps `j`/`k`/`l`/`c`/etc. from hijacking typing is standard and should be replicated exactly: **the global key handler checks `document.activeElement` (or the event's target) and bails out early whenever focus is inside an editable context** — an `<input>`, `<textarea>`, a `contenteditable` region (the comment box), or the search box — before doing anything with the key. Concretely:

```js
function isTypingContext(target) {
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

document.addEventListener('keydown', (e) => {
  if (isTypingContext(e.target)) return;   // let the search box / comment box own the key
  handlePlayerShortcut(e);
});
```

`/` for "focus search" is itself an example of the inverse of this rule: it's only meaningful to intercept `/` globally *because* the handler that intercepts it checks it isn't already inside an editable field (typing a literal `/` character in the search box or a comment must not re-trigger "focus search" and swallow the keystroke). The general rule is symmetric: shortcut keys are captured at the document/window level only when the active element is not itself a text-entry surface, and once a shortcut moves focus into a text-entry surface (e.g., `/` → search box focused), that surface's own key handling takes over and the shortcut layer stops intercepting until focus leaves it again.

Sources: [YouTube Help — Keyboard shortcuts](https://support.google.com/youtube/answer/7631406?hl=en), [YouTube Help — Manage caption settings](https://support.google.com/youtube/answer/100078?hl=en) (for §6's caption-toggle cross-reference into §7), [code-charity/youtube wiki — Youtube's Shortcuts (from youtube.com)](https://github.com/code-charity/youtube/wiki/Youtube's-Shortcuts-(from-youtube.com)) (secondary corroboration for the caption-styling and theater-mode keys omitted from the help-center article).

---

## 7. Player accessibility (ARIA)

There is no single official "video player" ARIA pattern in the APG the way there is for `slider`/`dialog`/`menu` — a custom player is composed from several APG patterns. Cite each component pattern individually.

### 7.1 Control bar

Group the transport controls under a labelled container — `role="group"` (or, if you want arrow-key roving navigation across the whole bar the way a native OS media-key strip behaves, the [Toolbar pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/), `role="toolbar"` with `aria-label="Player controls"` and roving `tabindex`) rather than leaving each button as an unrelated sibling in the tab order. A `role="toolbar"` groups *related, single-purpose* controls (play, next-frame, mute, CC, fullscreen…) under one arrow-key-navigable strip, matching the same roving-tabindex mechanics as menus (§7.3) — one control at `tabindex="0"`, the rest at `-1"`, arrow keys move the roving position, `Tab` leaves the whole toolbar in one hop.

### 7.2 The scrubber as `role="slider"`

Per the [ARIA APG Slider pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider/):

```html
<div
  role="slider"
  tabindex="0"
  aria-label="Seek"
  aria-valuemin="0"
  aria-valuemax="596"
  aria-valuenow="128"
  aria-valuetext="2 minutes 8 seconds of 9 minutes 56 seconds"
></div>
```

- `aria-valuemin` / `aria-valuemax` — duration bounds in seconds (or any consistent unit); if omitted they default to the same `0`/`100` fallback as `<input type=range>`, which is wrong for a media scrubber, so **always set them explicitly.**
- `aria-valuenow` — current playhead position, numeric.
- **`aria-valuetext`** — required in practice for a time scrubber: a raw `aria-valuenow="128"` reads to a screen reader as "128," not "two minutes eight seconds." Per the pattern's own guidance, whenever the raw numeric value "is not user-friendly," set `aria-valuetext` to a human-readable string — for a seek bar, this means converting seconds to `M:SS`/`H:MM:SS` phrasing (and, ideally, expressing it against total duration, as above) on every value change.
- **Keyboard interaction** (from the pattern): `→`/`↑` increase by one step, `←`/`↓` decrease by one step, `Home` jumps to `aria-valuemin`, `End` jumps to `aria-valuemax`, `Page Up`/`Page Down` (optional) move by a larger increment. For a seek bar this maps naturally onto YouTube's own `←`/`→` = ±5s scoped to the slider, `Home`/`End` = start/end (§6) — reuse the same key bindings rather than inventing new ones, since APG's slider semantics and YouTube's actual player semantics already agree here.
- Needs an accessible name: `aria-label="Seek"` or `aria-labelledby` pointing at a visible label — per the pattern, sliders are not self-describing.

### 7.3 Play/pause as a toggle button

Per the [ARIA APG button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/) and `aria-pressed` semantics — a two-state (play vs. pause) control is a **toggle button**, exposed with `aria-pressed`:

```html
<button aria-pressed="false" aria-label="Play">
  <svg aria-hidden="true">...</svg>
</button>
```

Two correctness details that are easy to get backwards:

1. **Update `aria-label` (or the button's visible/accessible text) to reflect the *action the button will perform next*, not the current state as a noun** — YouTube's real behavior (and the pattern's own guidance) is that the accessible name flips between "Play" and "Pause" as the state changes, so a screen reader always announces what pressing the button *does*, not what it *is*.
2. Keep `aria-pressed` in sync with actual playback state on every transition — including transitions the user didn't initiate via this button (e.g., video ends, autoplay starts, another shortcut like `k` toggles state) — otherwise the toggle state silently desyncs from reality for AT users while sighted users see the icon update correctly.

Mute (`m`) is the same toggle-button shape with `aria-pressed` reflecting muted state.

### 7.4 Settings menu: `role="menu"` + roving `tabindex`

Per the [ARIA APG Menu Button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/): the gear/settings trigger is a `<button aria-haspopup="menu" aria-expanded="false">`; the popup itself is `role="menu"` containing `role="menuitem"` (or `menuitemradio`/`menuitemcheckbox` for the quality/speed/caption-style submenu selections, which are mutually-exclusive-choice items, not commands).

- **Roving tabindex, not focusable-list-of-many-tab-stops**: exactly one menu item is `tabindex="0"` at a time (initially the first item, or the currently-selected item on reopen), every other item is `tabindex="-1"`; `↑`/`↓` (or `←`/`→` for a horizontal submenu) move the roving `tabindex="0"` position and move focus, rather than requiring repeated `Tab` presses through every item. Giving every item `tabindex="0"` is the single most common real-world bug here — it floods the page's `Tab` sequence and breaks the "the whole menu is one tab stop" contract users expect.
- Opening the menu moves focus to the first (or selected) item; `Escape` closes the menu and returns focus to the trigger button; `Enter`/`Space` activates the focused item.
- Submenus (Quality, Speed, Captions options) nest as their own `role="menu"` opened from a `role="menuitem"` with `aria-haspopup="menu"` / `aria-expanded`, following the same roving-tabindex rule recursively.

### 7.5 Live-region announcements for state changes

Use a visually-hidden `role="status"` (implicit `aria-live="polite"`, `aria-atomic="true"`) region for transient state announcements that aren't already conveyed by focus moving to an updated element — e.g. "Captions on," "Playback speed: 1.5×," "Now playing: Chapter 3." Per general ARIA live-region guidance: prefer `role="status"`/`role="alert"` role shortcuts over hand-rolling `aria-live` (the roles carry semantic meaning to AT beyond just the live-region behavior), reserve `aria-live="assertive"`/`role="alert"` for genuinely urgent, rare interruptions (a real error, not routine state), because assertive announcements interrupt whatever the screen reader is currently reading. Play/pause toggling itself should **not** spam a live region on every press — the `aria-pressed`/label change on the button itself already communicates the state to anyone tabbed to it; reserve the live region for changes not already colocated with a focusable, labelled control (e.g., "Video ended," "Buffering," "An ad will play in 5 seconds").

Sources: [ARIA APG — Slider](https://www.w3.org/WAI/ARIA/apg/patterns/slider/), [ARIA APG — Button (toggle button / `aria-pressed`)](https://www.w3.org/WAI/ARIA/apg/patterns/button/), [ARIA APG — Menu Button](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/), [ARIA APG — Toolbar](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/), [MDN — ARIA live regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions).

---

## 8. Focus and the rest of the app

### 8.1 Focus management for modals and menus

Per the [ARIA APG Dialog (Modal) pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): modal surfaces (a "keyboard shortcuts" help panel, a share dialog, a caption-settings panel opened as a real overlay rather than an inline menu) must:

1. **Move focus into the dialog when it opens** — to the first meaningfully-interactive element, or to a heading/close-button if the dialog is primarily read-only content, not left stranded on `document.body`.
2. **Trap focus inside the dialog while open** — `Tab` from the last focusable element wraps to the first, `Shift+Tab` from the first wraps to the last; nothing behind the dialog should be reachable by keyboard while it's open (and should generally be `inert`/`aria-hidden` to also remove it from the AT tree).
3. **Close on `Escape`.**
4. **Restore focus to the triggering element on close** — whatever had focus (typically the button that opened the dialog) gets focus back, so a keyboard user isn't dropped back at the top of the document.
5. Carry `role="dialog"` (or `"alertdialog"` for a confirmation), `aria-modal="true"`, and `aria-labelledby` pointing at the dialog's own visible title.

The same "roving focus + Escape-to-trigger" shape from §7.4's menu pattern generalizes here — menus are the lightweight case, dialogs are the heavyweight case, and both share "trap while open, restore on close."

### 8.2 Visible focus indicators

WCAG 2.4.7 **Focus Visible** (AA) requires that keyboard focus is visibly indicated — never ship `:focus { outline: none }` without a replacement focus style, a common regression when custom-styling buttons/menus. WCAG 2.2 adds **2.4.11 Focus Not Obscured (Minimum)** (AA): a focused element must not be *entirely* hidden by other author content (sticky headers, a fixed control bar, a cookie banner) — relevant directly to us because a custom player's auto-hiding control bar and any sticky page chrome (top nav, a "up next" sidebar) must not be able to fully occlude a keyboard-focused control. Design the auto-hide behavior so that focusing a player control (via `Tab`) forces the control bar visible, rather than letting the timeout hide it out from under an active keyboard focus.

### 8.3 Skip links

WCAG 2.4.1 **Bypass Blocks** (A): provide a mechanism to skip repeated blocks of content (site nav, the video's surrounding recommendation rail) to reach the main content directly. Standard implementation: a "Skip to main content" (and, for a video-heavy layout, arguably also "Skip to player controls" / "Skip to comments") link as the very first focusable element in `<body>`, visually hidden by default and brought on-screen on focus (never `display:none`/`visibility:hidden`, which also hides it from keyboard focus) — paired with real landmark elements (`<main>`, `<nav>`) as a complementary, not alternative, mechanism.

### 8.4 `prefers-reduced-motion`

Per [MDN `prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion): the media query has two values, `no-preference` and `reduce`; `@media (prefers-reduced-motion: reduce)` matches users who've set an OS-level accessibility preference to minimize non-essential motion (relevant to vestibular disorders). Apply it to anything non-essential-motion in the player chrome: control-bar fade/slide transitions, thumbnail-scrub preview animations, autoplay-hover video previews on the homepage/grid, any parallax or scale-in effects — replace with instant or drastically-reduced-duration transitions under the `reduce` branch, while keeping genuinely functional motion (the video content itself, the scrubber thumb moving with playback) unaffected, since suppressing the content itself isn't what this preference is asking for.

### 8.5 Colour contrast for the dark theme

WCAG **1.4.3 Contrast (Minimum)** (AA): body text needs **≥ 4.5:1** contrast against its background; **"large text"** (≥ 24px / 18pt, or ≥ 19px/14pt **and bold**) needs only **≥ 3:1**. WCAG **1.4.11 Non-text Contrast** (AA): UI component boundaries/states and meaningful graphics need **≥ 3:1** against adjacent colors (this covers control-bar icon glyphs, the scrubber's played/buffered/track color distinctions, and focus-indicator outlines — not just body copy).

**YouTube's own dark-theme secondary text is a real, citable borderline case worth calling out explicitly rather than copying blind**: YouTube's dark surface uses a mid-grey (`#aaaaaa`-class) secondary/metadata text color against a near-black (`#0f0f0f`-class) background for things like view counts, upload dates, and channel names under video titles. Depending on the exact grey and exact background sampled, that combination lands close to, and in some sampled instances measurably under, the 4.5:1 AA text threshold — this is a known, discussed pattern in the accessibility community as an example of a major product shipping borderline/sub-threshold secondary text contrast in its dark theme. **Do not treat YouTube's actual shipped grey values as a target to replicate for our own secondary text** — pick our dark-theme secondary/metadata text color by computing contrast against our actual background and holding the line at ≥ 4.5:1 (or explicitly, consciously choosing ≥ 3:1-only if we also bump that text's size into the "large text" bracket), rather than eyeballing a value that visually resembles YouTube's.

Sources: [WCAG 2.2 — Understanding SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [WCAG 2.2 — Understanding SC 1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), [WCAG 2.2 — Understanding SC 2.4.7 Focus Visible](https://www.w3.org/WAI/WCAG21/Understanding/focus-visible.html), [WCAG 2.2 — Understanding SC 2.4.11 Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html), [WCAG 2.2 — Understanding SC 2.4.1 Bypass Blocks](https://www.w3.org/WAI/WCAG21/Understanding/bypass-blocks.html), [MDN — `prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion), [ARIA APG — Dialog (Modal)](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

Additional WCAG media-specific SCs relevant to the player itself, for completeness: **1.2.1** Audio-only/Video-only (Prerecorded) (A), **1.2.2** Captions (Prerecorded) (A) — the whole point of §1–3 of this document, **1.2.3** Audio Description or Media Alternative (Prerecorded) (A), **1.2.4** Captions (Live) (AA), **1.2.5** Audio Description (Prerecorded) (AA), **1.4.2** Audio Control (A) — any auto-playing audio/video longer than 3 seconds must offer a way to pause/stop/mute it, directly implicating autoplay-with-sound behavior on hover-preview thumbnails, **2.1.1** Keyboard (A) / **2.1.2** No Keyboard Trap (A) — everything in §6/§7 must be operable by keyboard alone and must never trap focus outside the intentional modal-trap case in §8.1, **2.2.2** Pause, Stop, Hide (A) — auto-advancing "up next" carousels/animations need a pause control, **2.5.8** Target Size (Minimum) (AA, new in 2.2) — pointer targets (play button, CC toggle, scrubber thumb hit-area) should be **≥ 24×24 CSS px** (padding counts toward the target).

---

## 9. Testing

### 9.1 Caption rendering (Playwright, end-to-end)

Since we're rendering our own DOM from `TextTrack` cues (§2, Route B), assert against the rendered caption DOM directly, driven by actual `currentTime` seeks rather than by waiting for real playback:

```ts
// Seek past a known cue boundary, then assert the caption layer's text.
await page.evaluate((t) => {
  const video = document.querySelector('video')!;
  video.currentTime = t;
}, 4.5);
await expect(page.getByTestId('caption-layer')).toHaveText('how the scheduler actually assigns priority');
```

- Give the custom caption-rendering container a stable `data-testid="caption-layer"` (or a stable role/label) rather than relying on structural CSS selectors, since caption DOM structure is exactly the kind of thing that'll get refactored.
- Assert `cuechange`-driven behavior by listening for the event in-page and resolving a promise, rather than sleeping — `page.waitForFunction(() => window.__lastCueChangeAt > 0)` or exposing a counter, to avoid flaky timing-based waits.
- For the caption **settings menu** (font size/color/background/opacity/edge style), assert the actual computed style of the caption-layer DOM after each control change (`page.evaluate(() => getComputedStyle(el).fontSize)`), not just that the control's own visual state changed — the settings menu can visibly "look" applied while failing to actually restyle the caption layer if the wiring is broken.
- For native-`<track>` fallback paths (if any), Playwright can inspect `video.textTracks[0].cues` and `.activeCues` directly via `page.evaluate`, since these are real DOM/API objects reachable from in-page JS.

### 9.2 Keyboard shortcuts (Playwright)

```ts
await page.getByRole('slider', { name: 'Seek' }).focus();  // or click the player region first
await page.keyboard.press('k');
await expect(video).toHaveJSProperty('paused', true);

await page.keyboard.press('j');
// assert currentTime decreased by ~10s (allow tolerance for seek-event timing)

// The "don't steal keys from inputs" contract (§6.1):
await page.getByRole('searchbox').fill('slash test /');
await expect(page.getByRole('searchbox')).toHaveValue('slash test /');
// i.e. typing "/" *inside* the search box must not re-trigger "focus search" / do nothing weird
```

- Use `page.keyboard.press()` for single keys and `page.keyboard.down()/up()` for modifier combos (`Shift+N`, `Ctrl+→`), matching exactly what a real keyboard user does — avoid dispatching synthetic `KeyboardEvent`s via `page.evaluate`, since that bypasses real OS/browser key-handling paths (and, notably, would not exercise browser-level focus-trap/typing-context behavior faithfully).
- Assert **scope**, not just effect: focus something inside a `contenteditable` comment box, press a player shortcut key, and assert the comment box's content changed (the key was typed, not intercepted) and the player state did *not* change — this is the regression test for §6.1's typing-context guard, and it's the test most likely to be skipped if you only test the "happy path" of shortcuts working.
- Frame-step (`,`/`.`) needs its own test that first pauses, then asserts step behavior, and a second test asserting the *same* keys do nothing (or do something different, per YouTube's actual behavior — verify, don't assume) while playing.

### 9.3 ARIA structure (Playwright + unit tests)

**Playwright — structural/role assertions and aria snapshots**: Playwright's [ARIA snapshot testing](https://playwright.dev/docs/aria-snapshots) (`expect(locator).toMatchAriaSnapshot()`) captures the accessibility tree — role + accessible name + relevant state (`checked`, `expanded`, `pressed`, `level`, `selected`) — as YAML, giving a single assertion that catches role/name/state regressions across the whole control bar at once:

```ts
await expect(page.getByTestId('player-controls')).toMatchAriaSnapshot(`
  - toolbar "Player controls":
    - button "Play" [pressed=false]
    - slider "Seek"
    - button "Mute"
    - button "Captions"
`);
```

Also assert specific ARIA-property values directly where a snapshot would be too broad-brush, e.g. the scrubber's `aria-valuetext` after a seek:

```ts
await expect(page.getByRole('slider', { name: 'Seek' })).toHaveAttribute(
  'aria-valuetext',
  '2 minutes 8 seconds of 9 minutes 56 seconds'
);
```

Playwright's `toHaveAccessibleName` / `toHaveAccessibleDescription` matchers are the right tool for asserting the play/pause button's label actually flips between "Play" and "Pause" (§7.3's easy-to-get-backwards detail) rather than staying static.

**Unit tests — `axe-core` via `jest-axe`/`vitest-axe`**: render each interactive component (control bar, settings menu, scrubber, modal dialogs) in isolation and run an axe scan to catch structural violations — missing accessible names, invalid role/attribute combinations, broken `aria-*` id references — as a fast, CI-friendly first line of defense, before the slower Playwright e2e layer:

```ts
import { axe, toHaveNoViolations } from 'jest-axe'; // or 'vitest-axe'
expect.extend({ toHaveNoViolations });

test('settings menu has no axe violations', async () => {
  const { container } = render(<SettingsMenu open />);
  expect(await axe(container)).toHaveNoViolations();
});
```

Use axe-core-based unit tests for "is this markup structurally valid ARIA," and reserve the Playwright layer for "does the actual keyboard/focus *behavior* match the pattern" (roving tabindex genuinely moves focus on arrow keys, `Escape` genuinely restores focus to the trigger, live-region text genuinely updates) — axe cannot verify interaction behavior, only static/DOM-snapshot structure, so both layers are necessary and neither substitutes for the other.

Sources: [Playwright — Snapshot testing (ARIA snapshots)](https://playwright.dev/docs/aria-snapshots), [jest-axe](https://github.com/nickcolley/jest-axe), [Testing React accessibility with axe (Vitest/Jest patterns)](https://medium.com/@echilaka/testing-react-accessibility-with-axe-dev-console-vitest-and-the-chrome-extension-e24b5ae623df).
