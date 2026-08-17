# R1 — WebCodecs Encoding Path

Scope: the client-side transcode primitive itself — `VideoEncoder`/`AudioEncoder` lifecycle, codec strings, browser support (with special attention to headless Chromium, since the seed script depends on it), the rendition ladder, keyframe alignment, performance, frame acquisition/demuxing, and memory/backpressure discipline. Implementation-grade reference with citations. No application code beyond illustrative snippets and one verification harness (§4.5) used to produce first-party evidence for this document.

**Headline finding (§4):** I could not find a trustworthy secondhand answer to "does headless Chromium have a working AVC encoder," so I built and ran the experiment myself against the actual Playwright/Chromium binaries already installed on this machine. Result: **yes** — headless Chromium (both current default "new" headless mode and the legacy `chromium-headless-shell`) exposes `VideoEncoder` and can produce real, byte-verified AVC output with zero extra flags, via a *software* encoder. The *hardware* AVC encoder path is gated behind GPU access, which default headless disables — but `--enable-gpu` restores it, and hardware AVC encode then works headless too. Details, caveats, and the reproduction script are in §4.

---

## Table of contents

1. [API shape — VideoEncoder / AudioEncoder lifecycle](#1-api-shape)
2. [Codec strings](#2-codec-strings)
3. [Support matrix](#3-support-matrix)
4. [Headless Chromium — empirical findings](#4-headless-chromium)
5. [`isConfigSupported`](#5-isconfigsupported)
6. [Rendition ladder](#6-rendition-ladder)
7. [Keyframe alignment](#7-keyframe-alignment)
8. [Performance](#8-performance)
9. [Getting frames in / demuxing](#9-getting-frames-in)
10. [Memory and backpressure](#10-memory-and-backpressure)
11. [What I could not verify](#11-what-i-could-not-verify)
12. [Citations](#12-citations)

---

## 1. API shape

Primary source: [W3C WebCodecs spec](https://www.w3.org/TR/webcodecs/), cross-checked against [MDN VideoEncoder](https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder) and empirically verified (§4.5) against a real Chromium build.

### 1.1 `VideoEncoder` lifecycle

```js
const encoder = new VideoEncoder({
  output: (chunk, metadata) => { /* EncodedVideoChunk, EncodedVideoChunkMetadata */ },
  error: (e) => { /* DOMException */ },
});

encoder.configure({
  codec: 'avc1.42001f',              // required
  width: 1280, height: 720,          // required (coded size)
  bitrate: 2_000_000,                // optional, bits/sec
  framerate: 30,                     // optional
  bitrateMode: 'constant',           // 'constant' | 'variable' | 'quantizer'
  latencyMode: 'quality',            // 'quality' | 'realtime'
  hardwareAcceleration: 'no-preference', // 'no-preference' | 'prefer-hardware' | 'prefer-software'
  avc: { format: 'avc' },            // AVC-specific extension — see §2.4
});

encoder.encode(videoFrame, { keyFrame: true }); // VideoEncoderEncodeOptions.keyFrame forces an IDR
videoFrame.close();                              // see §10 — close as soon as encode() has been called

await encoder.flush();  // MUST resolve before you can assume every queued chunk has been emitted
encoder.close();        // terminal; state -> "closed", further calls throw InvalidStateError
```

- **`state`**: `"unconfigured" | "configured" | "closed"`.
- **`encodeQueueSize`**: read-only count of `encode()` calls queued but not yet drained by the underlying codec (§10).
- **`reset()`**: cancels all pending work/callbacks immediately without invoking `error`; returns to `"unconfigured"`.
- A codec **may be reconfigured** at any point while not `"closed"` — `configure()` must flush all pending outputs from the *previous* config before the new one takes effect, so the "active encoder config" tagged on each emitted chunk stays accurate ([w3c/webcodecs#138](https://github.com/w3c/webcodecs/issues/138)).
- `flush()` returns a `Promise<void>`; per spec "the underlying codec implementation MUST emit all outputs in response to a flush" — this is the only way to guarantee the last few frames (buffered inside the codec for lookahead/B-frame reordering) have actually been emitted before you finalize a mux.

### 1.2 `AudioEncoder` — same shape

```js
const audioEncoder = new AudioEncoder({
  output: (chunk, metadata) => {},
  error: (e) => {},
});
await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2 });
audioEncoder.configure({
  codec: 'mp4a.40.2',      // AAC-LC, or 'opus'
  sampleRate: 48000,
  numberOfChannels: 2,
  bitrate: 128_000,
  bitrateMode: 'constant',
});
audioEncoder.encode(audioDataInstance); // AudioData, no per-call options
await audioEncoder.flush();
audioEncoder.close();
```

Identical `state`/`encodeQueueSize`/`dequeue`/`reset()`/`close()`/`isConfigSupported()` surface as `VideoEncoder`. `EncodedAudioChunk` mirrors `EncodedVideoChunk` (§1.3). [MDN AudioEncoder](https://developer.mozilla.org/en-US/docs/Web/API/AudioEncoder).

### 1.3 What `EncodedVideoChunk` actually contains

Verified empirically (§4.5) — `EncodedVideoChunk` does **not** expose a raw `.data` property. Its surface is:

- `type`: `"key" | "delta"`
- `timestamp`: microseconds (matches the `VideoFrame`'s timestamp)
- `duration`: microseconds, optional
- `byteLength`: size of the encoded bitstream
- `copyTo(destination: BufferSource)`: the only way to read the bytes out — you must allocate a buffer of `byteLength` and call this.

```js
const buf = new Uint8Array(chunk.byteLength);
chunk.copyTo(buf);
```

### 1.4 `EncodedVideoChunkMetadata.decoderConfig.description` — confirmed, byte-for-byte

This is the load-bearing question for the muxer, so it was verified two ways: against the W3C AVC registration spec text, and by literally decoding the bytes Chromium produced.

**Spec text** ([AVC (H.264) WebCodecs Registration](https://www.w3.org/TR/webcodecs-avc-codec-registration/)):

> "SPS and PPS data are not included in the bitstream and are instead emitted via the output callback as the `VideoDecoderConfig.description` of the `EncodedVideoChunkMetadata.decoderConfig`... If the description is present, it is assumed to be an **AVCDecoderConfigurationRecord**, as defined by [ISO/IEC 14496-15], section 5.3.3.1."

That is exactly the payload of an MP4 `avcC` box. **Confirmed — this claim in the brief is correct.**

**Empirical confirmation** — encoding one 1280×720 frame with `codec: 'avc1.42001f'` in real (non-mocked) headless Chromium and dumping `metadata.decoderConfig.description` produced 33 bytes:

```
01 42 00 1f ff e1 00 0f 27 42 00 1f ab 30 0a 00 b7 4d 40 40 40 40 80 01 00 04 28 ce 3c 80
```

Decoded field-by-field against the AVCDecoderConfigurationRecord layout (ISO/IEC 14496-15 §5.3.3.1):

| Bytes | Field | Value |
|---|---|---|
| `01` | `configurationVersion` | 1 |
| `42` | `AVCProfileIndication` | 0x42 = 66 = Baseline — matches the `42` in the codec string `avc1.42001f` |
| `00` | `profile_compatibility` | 0x00 |
| `1f` | `AVCLevelIndication` | 0x1f = 31 = Level 3.1 — matches the `1f` in `avc1.42001f` |
| `ff` | reserved(6) + `lengthSizeMinusOne`(2) | `11111111` → length-prefix size = 4 bytes |
| `e1` | reserved(3) + `numOfSequenceParameterSets`(5) | `1` SPS follows |
| `00 0f` | SPS length | 15 |
| `27 42 00 1f ab 30 0a 00 b7 4d 40 40 40 40 80` | SPS NALU | NAL header `0x27` = nal_unit_type 7 (SPS) |
| `01` | `numOfPictureParameterSets` | 1 |
| `00 04` | PPS length | 4 |
| `28 ce 3c 80` | PPS NALU | NAL header `0x28` = nal_unit_type 8 (PPS) |

This is a textbook-correct `avcC` payload, and it round-trips exactly with the `avc1.42001f` codec string used to configure the encoder. `decoderConfig` itself (empirically observed keys) is: `codec, codedHeight, codedWidth, colorSpace, description, flip, hardwareAcceleration, rotation`. `EncodedVideoChunkMetadata` had exactly one key present, `decoderConfig` (the spec also defines optional `svc` and `alphaSideData` members for scalable/alpha-channel content, not exercised here).

**Practical consequence for our muxer:** write the fMP4 `stsd → avc1 → avcC` box body as a direct copy of `metadata.decoderConfig.description` the first time it's present (it's typically only emitted once, on the first chunk, and again if it changes) — no re-derivation of SPS/PPS needed.

---

## 2. Codec strings

Primary sources: [WebCodecs Codec Registry](https://www.w3.org/TR/webcodecs-codec-registry/), [AVC registration](https://www.w3.org/TR/webcodecs-avc-codec-registration/), [RFC 6381 §3.4](https://www.rfc-editor.org/rfc/rfc6381.html), [VP9 ISOBMFF binding](https://www.webmproject.org/vp9/mp4/), [AV1 ISOBMFF binding §5](https://aomediacodec.github.io/av1-isobmff/).

### 2.1 AVC — `avc1.PPCCLL`

Format: prefix `avc1.` or `avc3.` + 6 hex characters = 3 bytes taken directly from the SPS: `profile_idc`, the `constraint_set` flags byte, `level_idc` (RFC 6381 §3.4 / ISO 14496-15 §5.4.1).

- **PP** = `profile_idc`, hex of the decimal profile number:
  - `42` = 66 = **Baseline**
  - `4D` = 77 = **Main**
  - `58` = 88 = Extended
  - `64` = 100 = **High**
- **CC** = constraint_set flags byte (`constraint_set0_flag` in the high bit through `constraint_set5_flag`, then 2 reserved zero bits). `00` (no constraints set) is the common default and is what real Chromium accepted and echoed back in the empirical test above. `E0` (bits 7,6,5 set — constraint_set0/1/2) is the conventional "Constrained Baseline" marker seen in the wild, e.g. `avc1.42E01E` ([reference](https://blog.pearce.org.nz/2013/11/what-does-h264avc1-codecs-parameters.html)).
- **LL** = `level_idc` = 10 × the level number, in hex. Level 3.1 → 31 decimal → `1F`. Confirmed by direct decode of the SPS above (`1f` byte ↔ Level 3.1 ↔ the `1f` in `avc1.42001f`).

Common level hex values: 3.0=`1E`, 3.1=`1F`, 3.2=`20`, 4.0=`28`, 4.1=`29`, 4.2=`2A`, 5.0=`32`, 5.1=`33`, 5.2=`34`.

Ladder-rung strings (see §6 for the profile/level rationale per rung):

| Rung | Codec string |
|---|---|
| 144p/240p — Baseline L1.3/L2.1 | `avc1.42000D` (L1.3) / `avc1.420015` (L2.1) |
| 360p — Main L3.0 | `avc1.4D001E` |
| 480p — Main/High L3.1 | `avc1.4D001F` or `avc1.64001F` |
| 720p — High L3.1 | `avc1.64001F` |
| 1080p@30 — High L4.0 | `avc1.640028` |
| 1080p@60 — High L4.2 | `avc1.64002A` |

`avc1` vs `avc3`: `avc1` sample entries carry SPS/PPS **out-of-band** in the `avcC` box (parameter sets fixed for the whole track) — this is the standard fMP4/MP4 layout and matches `format: "avc"` (§2.4). `avc3` allows **in-band** (bitstream-embedded, potentially changing) parameter sets, matching Annex B-style streams. For our muxer, `avc1` + `format: "avc"` is correct.

### 2.2 VP9 — `vp09.PP.LL.DD[.CC.cp.tc.mc.F]`

`vp09.` + profile(2 digits) + level(2 digits) + bitDepth(2 digits) — mandatory. Then, optionally **all-or-nothing**: chromaSubsampling(2), colourPrimaries(2), transferCharacteristics(2), matrixCoefficients(2), videoFullRangeFlag(1).

Examples (from the [WebM Project spec](https://www.webmproject.org/vp9/mp4/)):
- `vp09.00.10.08` — profile 0, level 1.0, 8-bit (common default / what Chromium's `isConfigSupported` accepted with no optional fields in the empirical test).
- `vp09.00.41.08` — profile 0, level 4.1, 8-bit, 4:2:0, BT.709, legal range.
- `vp09.02.10.10.01.09.16.09.01` — profile 2, level 1, **10-bit**, 4:2:0, BT.2020 primaries, ST 2084 (PQ) transfer, BT.2020 non-constant-luminance matrix, full range — an HDR example.

### 2.3 AV1 — `av01.P.LLT.DD[.M.CCC.cp.tc.mc.F]`

`av01.` + profile(1 digit, 0–2) + level(2 digits)+tier(`M`=Main/`H`=High) + bitDepth(2 digits) — mandatory. Then, optionally **all-or-nothing**: monochrome(1), chromaSubsampling(3: subsampling_x, subsampling_y, chroma_sample_position), colorPrimaries(2), transferCharacteristics(2), matrixCoefficients(2), videoFullRangeFlag(1). Defaults when the optional group is omitted: monochrome=0, chroma subsampling=`110` (4:2:0), primaries=`01` (BT.709), transfer=`01`, matrix=`01`, full-range=`0` ([AV1-ISOBMFF §5](https://aomediacodec.github.io/av1-isobmff/)).

Examples: `av01.0.01M.08` (Main profile, level 2.1, Main tier, 8-bit, defaults) — this and `av01.0.04M.08` (level 3.0) both worked directly against real Chromium in the empirical test. HDR example: `av01.0.04M.10.0.112.09.16.09.0` (10-bit, 4:2:0, BT.2100 primaries, PQ transfer, BT.2100 matrix, studio range).

### 2.4 `avc` vs `annexb` format — and which one we want

`AvcEncoderConfig.format` (default `"avc"`) controls the **output bitstream packaging**, independent of the codec string:

- **`"annexb"`**: SPS/PPS are embedded periodically *inside* the bitstream (start-code-prefixed NAL units) — the layout `ffmpeg` expects for a raw `.h264` file.
- **`"avc"`**: SPS/PPS are **not** in the bitstream at all; every NAL unit is instead prefixed with its own length (a length-prefixed layout), and SPS/PPS are delivered once, out-of-band, as `EncodedVideoChunkMetadata.decoderConfig.description` (§1.4).

**`"avc"` is what we want.** It is *literally* the MP4/fMP4 sample layout (length-prefixed NALUs + a separate `avcC` box) — using it means zero bitstream rewriting between "what the encoder emits" and "what goes in the `mdat`." Using `"annexb"` instead would require stripping start codes / emulation-prevention bytes and re-deriving an `avcC` ourselves before muxing — pure waste. [AVC registration §"format"](https://www.w3.org/TR/webcodecs-avc-codec-registration/); confirmed empirically by explicitly passing `avc: { format: 'avc' }` and dumping the resulting `description` (§1.4).

---

## 3. Support matrix

### 3.1 Baseline `VideoEncoder`/`VideoDecoder` presence

| Browser | Version | Source |
|---|---|---|
| Chrome / Edge | 94+ (2021) | [caniuse.com/webcodecs](https://caniuse.com/webcodecs) |
| Opera | 80+ | caniuse |
| Samsung Internet | 17+ | caniuse |
| Firefox (desktop) | 130+ (shipped H1 2024) | [Mozilla meta bug 1746557](https://bugzilla.mozilla.org/show_bug.cgi?id=1746557); caniuse |
| Firefox (Android) | **not supported, any version** | caniuse; confirmed still true via the same meta bug ("mobile support remains missing") |
| Safari | 16.4+ (video only), 26+ (full incl. audio) | see §3.3 |

caniuse reports **~93.6% global usage-weighted support** for the "WebCodecs" feature as a whole ([caniuse.com/webcodecs](https://caniuse.com/webcodecs)) — treat this cautiously, it measures *API presence*, not "does this device actually have a working H.264 encoder," which is the question that matters for us.

### 3.2 Real-world AVC **encoder** support (not just API presence)

[webcodecsfundamentals.org's codec-analysis dataset](https://webcodecsfundamentals.org/datasets/codec-analysis-2026/) (real-session telemetry, 109M+ sessions, methodology not independently audited by me — treat as directional, not authoritative) reports AVC Baseline **encoder** support (i.e., a session where `VideoEncoder.isConfigSupported` for a baseline-profile config actually returned true) broken down by browser × platform:

| Browser | Windows | macOS | Linux | Android | iOS |
|---|---|---|---|---|---|
| Chrome/Chromium | 68.06% | 68.36% | 67.15% | 66.99% | 29.88% |
| Firefox | 96.07% | 99.99% | 98.62% | 0.0% | n/a |
| Safari | — | 29.44% | — | — | 29.13% |
| Edge | 68.35% | 68.42% | — | 67.58% | — |

Two things stand out and are worth flagging rather than smoothing over: (1) Chrome/Edge's ~66–68% figures are *lower* than Firefox's desktop figures in this dataset — plausibly because a meaningful slice of Chrome sessions are headless/server/low-end-device sessions without GPU access defaulting `prefer-hardware` checks to false (consistent with §4's findings), while Firefox's desktop AVC encoder is reportedly software-only and thus available almost everywhere; (2) Safari's ~29% figure is much lower than "Safari 16.4+ ships VideoEncoder" would suggest — almost certainly because this aggregate blends in all the pre-16.4 Safari sessions with zero WebCodecs support, dragging the average down; it is **not** evidence that current Safari lacks a working encoder (see §3.3).

### 3.3 Safari — the "Safari 26 closed the gap" claim: **partially true, for the wrong reason**

Timeline, cross-checked across multiple sources ([search summary citing WebKit/Apple docs](https://www.digitalsamba.com/blog/webcodecs-api-explained); [MDN Codec selection](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection); WebKit commit history for `WebCodecsVideoEncoder`, e.g. [AVC H264 encoder support commit](https://github.com/WebKit/WebKit/commit/a591b2669d7568d05194a2a2f3d419c855a02a68), [STP 157 release notes, Nov 2022](https://webkit.org/blog/13575/release-notes-for-safari-technology-preview-157/)):

- **Safari 16.4 (March 2023)** already shipped `VideoDecoder`/`VideoEncoder`/`EncodedVideoChunk`/`VideoFrame` — i.e., **H.264 hardware encode via WebCodecs has existed in shipping Safari for ~3 years**, using Apple's VideoToolbox hardware path.
- What was **missing** through Safari 18.7 was the **audio** side: `AudioEncoder`/`AudioDecoder` simply did not exist.
- **Safari 26 (fall 2025)** is what added `AudioEncoder`/`AudioDecoder`, making WebCodecs feature-complete (video *and* audio) on macOS/iOS/iPadOS for the first time.

**Verdict on the brief's claim:** if "the gap" means "Safari didn't have a usable WebCodecs pipeline," Safari 26 did close a real gap — but it closed it on the *audio* side, not the H.264 video-encode side, which was never the gap. If our seed-script/client concern is specifically "does Safari have a working H.264 hardware encoder," the honest answer is **yes, and has been since Safari 16.4** — Safari 26 doesn't change that story, it completes the *audio* half of our pipeline (which we also need, for the AAC/Opus rendition audio track). Don't cite "Safari 26 closed the H.264 gap" as written in the brief; cite "Safari 26 added AudioEncoder/AudioDecoder, completing WebCodecs on Apple platforms; H.264 VideoEncoder support predates it (16.4)."

### 3.4 HEVC, for context (not in our ladder)

MDN: "significant gaps in browser support outside of Apple platforms" ([MDN WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)) — confirms we should not plan around HEVC encode availability cross-browser.

---

## 4. Headless Chromium

This is the highest-value question in the brief, and secondhand sources were contradictory and stale (a Playwright issue claiming H.264 "unsupported" in headless Chromium was actually about `<video>`/`MediaSource` codec registration, not WebCodecs; a community forum thread reported `'VideoEncoder' in window` as false, which — as shown below — is almost certainly an artifact of testing on an insecure/no-navigation page, not of headless mode itself). Given the stakes for the seed script, **I built the smallest experiment that would settle it and ran it against the actual installed Playwright + Chromium binaries on this machine**, rather than relying on secondhand reports.

### 4.1 Setup

- Playwright `1.62.1` (installed fresh via `npm install playwright@1.62.1`), resolving to the already-cached `chromium-1234` revision (~Chrome 151, "Chrome for Testing", `HeadlessChrome/151.0.7922.34`), on macOS (Apple Silicon).
- **Critical trap discovered first**: on a page with no navigation (Playwright's default blank page), `typeof VideoEncoder === 'undefined'` in *every* mode tested, including fully headed (`headless:false`). This is because **WebCodecs requires a secure context**, and an un-navigated page apparently doesn't count. Fixed by spinning up a tiny local HTTP server on `127.0.0.1` and navigating there — Chrome treats `http://127.0.0.1`/`localhost` as a "potentially trustworthy origin," so `window.isSecureContext === true` and `VideoEncoder` becomes visible. **This is a real gotcha for the seed script**: if it doesn't `page.goto()` a real (or `127.0.0.1`) origin before touching `VideoEncoder`, the API will silently not exist, and this is very plausibly what several of the secondhand "headless doesn't support VideoEncoder" reports actually hit.
- Verification methodology per run: check `typeof VideoEncoder`, call `VideoEncoder.isConfigSupported(...)`, then — because `isConfigSupported` can be optimistic or wrong — **actually construct a real encoder, configure it, encode one synthetic `OffscreenCanvas`-sourced `VideoFrame`, and confirm a real `EncodedVideoChunk` comes out** with a plausible byte length and (for AVC) a valid `avcC` description. Also probed `WEBGL_debug_renderer_info` as a proxy for whether real GPU access was available.

### 4.2 Result: `VideoEncoder` **is** exposed headless, once on a secure-context origin

Both Playwright's default `headless: true` (new headless mode, full Chrome binary) and the explicit `channel: 'chromium-headless-shell'` (legacy headless shell binary) exposed `typeof VideoEncoder === 'function'` once served from `http://127.0.0.1`. This directly contradicts the premise that headless Chromium lacks the API at all.

### 4.3 Result: hardware AVC encode fails headless by default; software AVC encode works with zero flags

Testing `avc1.42001f` (Baseline) and `avc1.64001f` (High) with all three `hardwareAcceleration` preferences, on a 1280×720 synthetic frame, default headless (no extra CLI args):

| `hardwareAcceleration` | `isConfigSupported` | Real encode |
|---|---|---|
| `prefer-hardware` | **false** | **fails** — `configure()` silently closes the codec (spec-correct behavior for an unsupported config), and the subsequent `encode()` throws `InvalidStateError: Cannot call 'encode' on a closed codec.` |
| `prefer-software` | **true** | **works** — produced a real 2881-byte keyframe, with a valid 33-byte `avcC` description (the exact bytes decoded in §1.4) |
| `no-preference` | **true** | **works**, identical output to `prefer-software` |

Root cause, confirmed via the WebGL renderer probe: default headless Chromium's `UNMASKED_RENDERER_WEBGL` reports `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device...), SwiftShader driver)` — i.e., **no real GPU, software rasterizer only**. This matches the long-documented Chromium behavior that headless mode disables GPU access by default ([Chromium issue 765284 / 40540071, "Support GPU hardware in headless mode"](https://issues.chromium.org/issues/40540071); [puppeteer#1260](https://github.com/puppeteer/puppeteer/issues/1260)). Without GPU access, there is no hardware video-encode path to reach, so `prefer-hardware` correctly reports unsupported — but it does **not** take down the software encoder, which is a fully separate code path.

**This directly answers the brief's question "if AVC is unavailable headless, what IS available":** the framing is slightly off — AVC *is* available headless, unconditionally, via software encode. What's unavailable by default is specifically the *hardware-accelerated* AVC path.

### 4.4 `--enable-gpu` restores the real GPU — and hardware AVC encode along with it

Isolated single-flag runs against default headless:

| Flags | WebGL renderer | `prefer-hardware` AVC `isConfigSupported` | Real encode |
|---|---|---|---|
| *(none)* | SwiftShader (software) | false | fails |
| `--enable-gpu` | `ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Max...)` (real GPU) | **true** | **works** |
| `--ignore-gpu-blocklist` alone | SwiftShader (unchanged) | false | fails |
| `--enable-gpu` + `--ignore-gpu-blocklist` | real GPU | true | works |
| `--use-angle=metal` alone | real GPU | true | works |

So on this platform, `--enable-gpu` (or an explicit real ANGLE backend like `--use-angle=metal`) alone is sufficient to make headless Chromium reach the true hardware encoder (VideoToolbox, on macOS) via WebCodecs — it is gated by the *same* GPU-availability switch as every other GPU feature in headless mode, nothing WebCodecs-specific. `--ignore-gpu-blocklist` alone does nothing here.

### 4.5 VP8/VP9/AV1 worked unconditionally

`vp8`, `vp09.00.10.08`, and `av01.0.04M.08` all produced real `EncodedVideoChunk`s in every configuration tested — default headless, headless+GPU, and headed — with no flags required. These codecs' software encoders are reachable headless with zero configuration on this platform.

### 4.6 Reproduction

The full test harness (three scripts: initial broad sweep, secure-origin fix, single-flag isolation) is preserved in this session's scratchpad for reference; the essential shape is:

```js
const { chromium } = require('playwright');
const http = require('http');

// Serve over 127.0.0.1 — NOT about:blank — so isSecureContext is true.
const server = http.createServer((_, res) => res.end('<html></html>'));
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ headless: true, args: ['--enable-gpu'] });
const page = await browser.newPage();
await page.goto(url);

const result = await page.evaluate(async () => {
  const support = await VideoEncoder.isConfigSupported({
    codec: 'avc1.42001f', width: 1280, height: 720,
    bitrate: 1_000_000, framerate: 30, hardwareAcceleration: 'prefer-hardware',
  });
  // ... then actually construct+configure+encode+flush and confirm a real chunk arrives
  // (isConfigSupported alone is not proof — see §5).
  return support;
});
```

### 4.7 What's genuinely unverified — and the experiment to run before trusting this in production

Everything above was measured on **macOS (Apple Silicon), one Chrome build (~151.0.7922.34 "Chrome for Testing" via Playwright 1.62.1)**. The seed script's real deploy target is very likely **Linux CI**, which I could not test in this sandbox (no Linux box, no GPU passthrough available here). Linux hardware video encode is gated behind VAAPI rather than VideoToolbox, and per current documentation needs `--enable-features=AcceleratedVideoEncoder,VaapiVideoEncoder` in addition to GPU being enabled (flag requirements have also shifted across Chromium versions — `--use-gl=angle --use-angle=gl` was needed pre-131, not needed on 131+) ([hardware-acceleration Linux notes](https://wiki.cachyos.org/configuration/enabling_hardware_acceleration_in_google_chrome/)). The **software-AVC-works-headless-with-zero-flags** finding should transfer to Linux (it's a pure-CPU codec path, unrelated to VAAPI/GPU), but this is inference, not verification.

**Smallest experiment to close this gap**: run the exact 4-line check from §4.6 — `isConfigSupported` for `avc1.42001f` at `hardwareAcceleration: 'no-preference'`, then a real `configure()+encode()+flush()` round trip — inside the actual CI container image that will run the seed script, once with no flags and once with `--enable-gpu --enable-features=AcceleratedVideoEncoder,VaapiVideoEncoder`. Takes under a minute; don't hardcode an assumption about Linux headless hardware-encode availability into the architecture without running it.

One more open thread I could not resolve authoritatively: whether Chromium's software AVC path reachable from WebCodecs is literally the same **OpenH264** binary WebRTC uses (one search result mentioned an `OpenH264SoftwareEncoder` flag "affecting WebRTC, WebCodecs, and MediaRecorder APIs," suggesting shared code) or a separate internal software encoder. I found no single authoritative Chromium source doc confirming this explicitly. It doesn't change the operative conclusion (a working software AVC encoder is reachable headless with zero flags — confirmed directly, regardless of what's underneath it), but flagging the provenance as unconfirmed rather than asserting it.

---

## 5. `isConfigSupported`

[MDN VideoEncoder.isConfigSupported()](https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder/isConfigSupported_static):

```js
const { supported, config } = await VideoEncoder.isConfigSupported({
  codec: 'avc1.42001f', width: 1280, height: 720,
  bitrate: 2_000_000, framerate: 30,
});
if (supported) {
  const encoder = new VideoEncoder({ output, error });
  encoder.configure(config); // `config` is the UA's normalized/defaulted copy
}
```

- **Static** method on `VideoEncoder`/`AudioEncoder` (and the decoders) — no instance needed, cheap to call speculatively for many candidate configs.
- Resolves `{ supported: boolean, config: VideoEncoderConfig }` — `config` is a recognized/defaulted copy of what you passed, not necessarily identical.
- **Truthful in the environment I tested, not just optimistic**: in §4.3/§4.4, `isConfigSupported({ hardwareAcceleration: 'prefer-hardware' })` correctly returned `false` exactly when a real construct+encode also failed, and `true` exactly when it succeeded, across five different flag/GPU configurations — i.e., it's safe to treat as an authoritative runtime gate here, not merely a hint. There have historically been edge-case disagreements about exactly when it should throw vs. resolve `false` for malformed configs ([w3c/webcodecs#686](https://github.com/w3c/webcodecs/issues/686)), so still wrap the real `configure()`/`encode()` call in a `try/catch` defensively.
- **Recommended negotiation pattern**: iterate a priority-ordered candidate list (best quality/compat first) and take the first `supported: true`:

```js
const candidates = ['avc1.64001f', 'avc1.4d001f', 'avc1.42001f']; // High → Main → Baseline
let chosen;
for (const codec of candidates) {
  const { supported } = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate, framerate });
  if (supported) { chosen = codec; break; }
}
```

---

## 6. Rendition ladder

**Honesty flag up front**: I could not extract Apple's current HLS Authoring Specification table text directly — the primary [Apple Developer doc](https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices) fetched as header-only (body not retrievable via the fetch tool), and every secondary source that discusses it (e.g. [streaminglearningcenter.com](https://streaminglearningcenter.com/articles/apple-makes-sweeping-changes-to-hls-encoding-recommendations.html)) embeds the table as an **image**, not text. What follows blends the widely-repeated (but not independently re-verified) classic Apple numbers with two directly-fetched, text-form industry tables (Mux, Bitmovin) and the AVC level-limits table (which *was* independently verified).

### 6.1 Apple's classic recommended ladder (secondary-source reproduction — verify against the current spec before hardcoding)

Commonly cited 8-rung ladder, High Profile capped at Level 4.2, 6-second segments / 2-second keyframe interval, VBR peak ≤ 200% of average for VOD ([streaminglearningcenter.com](https://streaminglearningcenter.com/articles/apple-makes-sweeping-changes-to-hls-encoding-recommendations.html)):

| Resolution | Bitrate |
|---|---|
| 416×234 | 145 Kbps |
| 640×360 | 365 Kbps |
| 960×540 | 730 Kbps |
| 1280×720 | 2000 Kbps |
| 1280×720 (high fps) | 3000 Kbps |
| 1920×1080 | 4500 Kbps |
| 1920×1080 (high fps) | 6000 Kbps |
| 1920×1080 (top) | 7800 Kbps |

### 6.2 Mux's published guidance (directly fetched, primary)

[Mux — Video encoding for streaming](https://www.mux.com/articles/video-encoding-for-streaming-developers-guide): 360p/800 kbps + 96 kbps audio, 480p/1400 kbps + 128 kbps audio, 720p/2800 kbps + 128 kbps audio, 1080p/5000 kbps + 192 kbps audio.

### 6.3 Bitmovin's three-tier guidance (directly fetched, primary; 24fps content)

[Bitmovin — Choosing the right video bitrate](https://bitmovin.com/blog/video-bitrate-streaming-hls-dash/):

| Resolution | Min | Average | Max |
|---|---|---|---|
| 426×240 | 250 | 400 | 700 |
| 640×360 | 500 | 800 | 1400 |
| 854×480 | 750 | 1200 | 2100 |
| 1280×720 | 1500 | 2400 | 4200 |
| 1920×1080 | 3000 | 4800 | 8400 |
| 4096×2160 | 10000 | 16000 | 28000 |

(kbps throughout)

### 6.4 AVC level limits (independently verified — [Wikipedia AVC article's level table](https://en.wikipedia.org/wiki/Advanced_Video_Coding), which reproduces the standard's Table A-1)

| Level | Max MB/s | Max frame (MBs) | Max bitrate (Baseline/Main, kbps) | Canonical example resolution@fps |
|---|---|---|---|---|
| 3.0 | 40,500 | 1,620 | 10,000 | 720×576@25.0 |
| 3.1 | 108,000 | 3,600 | 14,000 | **1,280×720@30.0** |
| 4.0 | 245,760 | 8,192 | 20,000 | **1,920×1,080@30.1** |
| 5.0 | 589,824 | 22,080 | 135,000 | 3,840×2,160@31.7 |
| 5.1 | 983,040 | 36,864 | 240,000 | 3,840×2,160@31.7 |

Note the table's own canonical example resolutions for Level 3.1 and Level 4.0 are **exactly** 720p@30 and 1080p@30 — i.e., these are not arbitrary assignments, they're literally what the standard uses to illustrate those two levels.

### 6.5 Synthesized concrete table for our ladder

Combining §6.2–6.4 (bitrates ≈ the Mux/Bitmovin "average" consensus; profile/level chosen so the rung is comfortably within, or at, the level's documented limits):

| Rung | Resolution | FPS | Video bitrate | Profile / Level | Codec string |
|---|---|---|---|---|---|
| 144p | 256×144 | 30 | 100–150 kbps | Baseline / L1.3 | `avc1.42000D` |
| 240p | 426×240 | 30 | 300–400 kbps | Baseline or Main / L2.1 | `avc1.420015` / `avc1.4D0015` |
| 360p | 640×360 | 30 | 700–800 kbps | Main / L3.0 | `avc1.4D001E` |
| 480p | 854×480 | 30 | 1200–1400 kbps | Main or High / L3.1 | `avc1.4D001F` / `avc1.64001F` |
| 720p | 1280×720 | 30 | 2400–2800 kbps | High / L3.1 | `avc1.64001F` |
| 1080p | 1920×1080 | 30 | 4800–5000 kbps | High / L4.0 (L4.2 for 60fps) | `avc1.640028` (`avc1.64002A` @60fps) |

Audio: AAC-LC 96–128 kbps stereo for the lower rungs, 128–192 kbps for 720p/1080p, per Mux's numbers (§6.2).

This is presented as **synthesized reference guidance**, not a single canonical source — treat it as a starting point, and note (as multiple sources stressed, e.g. Bitmovin's per-title benchmarking tool) that per-title/content-aware encoding will beat any static ladder; a static ladder like this is what you fall back to when you can't run per-title analysis in-browser at upload time.

---

## 7. Keyframe alignment

`encode(frame, { keyFrame: true })` — the `VideoEncoderEncodeOptions.keyFrame` boolean forces an IDR/keyframe at that specific call, overriding whatever the encoder's internal GOP-interval heuristic would otherwise have done.

**Why every rendition needs keyframes at identical PTS**: an ABR player (`hls.js`, Shaka, native HLS/DASH) can only switch renditions at a **segment boundary**, and a decoder can only *start* decoding a fresh bitstream at a keyframe — every non-keyframe (P/B frame) references prior frames that won't exist in a freshly-started decode after a rendition switch. Segment boundaries are therefore required to coincide with keyframes in *every* rendition, and — because the player must be able to switch renditions at *any* segment boundary — every rendition's keyframes must land at the *same* presentation timestamps. If rendition A has keyframes at t=0,2,4,6s and rendition B drifts to t=0,2.1,4.3,6s, the player can only cleanly switch at t=0, or must skip/duplicate frames on every other switch, producing visible glitches — defeating the entire point of adaptive streaming ([Unified Streaming — GOP alignment](https://docs.unified-streaming.com/best-practice/content-preparation/improving-content-recommendations.html); [mpegflow.com — keyframe interval tuning](https://www.mpegflow.com/recipes/keyframe-interval-tuning-for-hls)).

Practical rule of thumb: segment length = GOP duration (2s segments ↔ `keyint`=60 @30fps; 4s segments ↔ `keyint`=120 @30fps).

**Consequence for our architecture**: since one JS loop feeds the *same* source frames to *N* parallel `VideoEncoder` instances (one per ladder rung) on a shared timeline, we must explicitly call `encode(frame, { keyFrame: true })` on **every** encoder at the same input-frame index (e.g., every 60th frame at 30fps for a 2s GOP) — never rely on each encoder's own automatic keyframe-interval setting, since nothing guarantees those heuristics stay synchronized across N independently-configured encoder instances, and drift here is exactly the segment-alignment bug that breaks mid-stream quality switching.

---

## 8. Performance

The brief's specific numbers — "~500fps native hardware vs ~40fps ffmpeg.wasm at 720p" — **could not be verified from any source found**. What was found:

- [remotion-dev/webcodecs-benchmark](https://github.com/remotion-dev/webcodecs-benchmark) (M2 MacBook Air, Chrome 131.0.6778.205, 3-run averages, methodology deliberately biased in ffmpeg.wasm's favor): `@remotion/webcodecs` averaged **7.4s** vs ffmpeg.wasm's **113.3s** for an MP4→WebM conversion (resolution/fps not disclosed) — roughly **15×** faster. A second AV1 WebM→MP4 test: 4s vs 20.3s (**~5×**).
- [BurnSub — WebCodecs vs ffmpeg.wasm](https://burnsub.com/blog/webcodecs-vs-ffmpeg-wasm/) explicitly **declines to invent numbers** ("I will not invent benchmark numbers"), but states the architectural reason the brief's directional claim is sound: native ffmpeg with hardware acceleration does "hundreds of fps" at 1080p H.264 on a desktop GPU; WebCodecs "uses identical underlying hardware paths to native FFmpeg" and is therefore "in the same order of magnitude"; ffmpeg.wasm, by contrast, runs inside a WASM sandbox that **cannot reach GPU encode APIs at all**, so it is always pure-software x264 regardless of host hardware — "roughly an order of magnitude slower than the same FFmpeg binary natively."
- A secondary summary (not independently fetched/confirmed by me) cited Mediabunny (a WebCodecs-based library) achieving "~200fps on 1080p H.264 encoding — eight times faster than FFmpeg.wasm" — flagging this as **unverified, secondhand**.

**Verdict**: the *direction* of the brief's claim (hardware WebCodecs encode is roughly one to two orders of magnitude faster than ffmpeg.wasm) is well-supported by multiple independent sources and by the architectural fact that ffmpeg.wasm structurally cannot reach hardware encode. The *specific* "~500fps / ~40fps at 720p" figures should be treated as unverified and re-benchmarked on real target hardware/codec settings rather than cited as fact in planning docs.

---

## 9. Getting frames in

Three documented ways to obtain a `VideoFrame`, per [Chrome for Developers — Video processing with WebCodecs](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs) and [MDN VideoFrame](https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame):

1. **`VideoDecoder`** — feed it demuxed `EncodedVideoChunk`s, it emits `VideoFrame`s. Not tied to real-time playback rate; runs as fast as the codec can decode.
2. **`MediaStreamTrackProcessor`** — turns a *live* `MediaStreamTrack` (camera via `getUserMedia`, or `canvas.captureStream()`/`videoElement.captureStream()`) into a `ReadableStream<VideoFrame>`.
3. **Direct construction from a `CanvasImageSource`** — `new VideoFrame(canvasOrVideoElementOrImageBitmap, { timestamp })`. `VideoFrame` is itself a valid `CanvasImageSource`, so it composes with `drawImage()`/`texImage2D()` etc.

### 9.1 Which is right for transcoding an arbitrary user-selected MP4/MOV

**`VideoDecoder`**, fed by a demuxed source, is the right choice — and it's the only one of the three that is *decoupled from real-time playback*:

- `HTMLVideoElement` + `canvas.drawImage()`/`requestVideoFrameCallback` is simpler to wire up, but ties frame delivery to something close to real-time playback speed and goes through the browser's normal display media pipeline (which can downscale/color-convert for on-screen rendering) — risky for a precise, frame-accurate batch transcode. (This "less frame-accurate" characterization reflects general community consensus rather than a specific spec citation — flagging it as such rather than overclaiming.)
- `MediaStreamTrackProcessor` is built for *live* tracks and likewise ties frame delivery to real-time wall-clock playback if sourced from a playing `<video>`'s `captureStream()`.
- `VideoDecoder` has no such constraint: you push `EncodedVideoChunk`s as fast as you can demux them, and it emits `VideoFrame`s as fast as it can decode — the only path that lets the whole client-side transcode run *faster than real playback speed*, which matters directly for the "browser encodes the whole ladder before upload" architectural bet. If decode itself were pinned to 1× realtime, a 10-minute source video would cost at least 10 minutes just for decode, before any of the N encode passes.

### 9.2 The catch: WebCodecs does not demux, and that's a real, non-trivial cost

WebCodecs is explicitly scoped to encode/decode only. Per the [web-demuxer project's own framing](https://github.com/bilibili/web-demuxer): "WebCodecs only provide the ability to decode, but not to demux." To feed a `VideoDecoder`, the source MP4/MOV container must be parsed ourselves to extract: (1) the codec string + `description` (the source file's own `avcC`/`hvcC`/etc., needed to configure the decoder), and (2) each sample's encoded bytes + timestamp + keyframe flag, packaged as `EncodedVideoChunk`s.

Demuxing library options found:
- **[mp4box.js](https://github.com/gpac/mp4box.js)** (gpac) — mature, widely used, but **MP4-only**; a wrapper pattern ("MP4Demuxer") is the common bridge to WebCodecs.
- **[web-demuxer](https://github.com/bilibili/web-demuxer)** (ForeverSc/bilibili) — a WASM (ffmpeg-based) demuxer purpose-built for WebCodecs integration, with broader container support: mov/mp4/mkv/webm/flv/m4v/wmv/avi/ts. Cost: bundles ffmpeg's demux code as WASM, a nontrivial payload-size addition.
- **Mediabunny** — highest-level abstraction; can hand back decoded `VideoFrame`s directly without the caller touching `EncodedVideoChunk`/`VideoDecoder` at all.

**Implication for our architecture**: since users pick arbitrary MP4/**MOV** (QuickTime) files, and MOV has real format quirks/box variants relative to plain ISO-BMFF MP4, an MP4-only demuxer (mp4box.js) is a real compatibility risk for the MOV case specifically — a broader-coverage WASM demuxer (e.g. web-demuxer) is the safer bet, at the cost of a meaningfully larger client bundle. Demuxing is not a free byproduct of "just use WebCodecs" — it's a distinct dependency and a real CPU/bundle-size cost layered on top of the encode work itself, and should be budgeted for explicitly.

---

## 10. Memory and backpressure

Sources: [MDN VideoFrame.close()](https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame/close), [Chrome for Developers — Video processing with WebCodecs](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs), spec text for `encodeQueueSize`/`dequeue` (§1).

- **`VideoFrame.close()`**: "clears all states and releases the reference to the media resource." `VideoFrame`s frequently wrap GPU-backed buffers/textures with a **hard resource ceiling** (not just ordinary GC-eligible memory) — Chrome's own guidance: "once a frame is no longer needed, call `close()` to release underlying memory before the garbage collector gets to it." Practically: not closing frames promptly risks hitting that hard ceiling and erroring out, not merely "using more memory than ideal until GC catches up."
- **Discipline**: close a frame as soon as its last synchronous use has happened — immediately after the `encode()` call that consumes it, not after `flush()`/after the encoder's async work completes:

```js
encoder.encode(frame, { keyFrame });
frame.close(); // safe immediately — encode() takes what it needs synchronously/by internal ref
```

  This exact pattern (`encode()` then immediate `close()`) was used throughout the §4 empirical tests and worked correctly — chunks were still produced with correct content after the frame handle was closed.

- **`encodeQueueSize`**: read-only count of `encode()` calls queued but not yet drained by the underlying codec. Increments on every `encode()` call; decrements as the codec catches up.
- **`dequeue` event**: fires on the encoder whenever `encodeQueueSize` decreases — the correct backpressure signal, rather than polling.
- **Recommended pattern** (per Chrome's guidance): check `encoder.encodeQueueSize` before calling `encode()`; if it's above a threshold, either wait for a `dequeue` event or drop the frame. **For our batch transcode use case, frame-dropping is not acceptable** (every source frame must appear in the output) — so the correct response to backpressure here is to pause pulling more frames from the upstream `VideoDecoder`/demuxer, not to drop them, turning `dequeue` into a flow-control signal for the decode stage rather than a discard trigger.
- **What happens if you don't drain**: enqueuing faster than the codec can consume leads to unbounded growth of queued `VideoFrame`s plus internal encoder buffers, risking tab-level OOM — a documented gotcha reflected in Chrome's own sample apps implementing exactly the drop/await-`dequeue` pattern above.
- **`flush()` as the drain-completion signal**: only after `await encoder.flush()` resolves is it safe to assume every queued frame has produced its output chunk (or the promise rejects) — don't consider an encode pass "done," and don't finalize/mux, before that.

---

## 11. What I could not verify

Being explicit, per the brief's ask for honesty about gaps:

1. **Apple's current HLS Authoring Spec ladder table, verbatim from the primary source** (§6.1) — the doc's body wasn't retrievable via the fetch tooling available, and every secondary source embeds it as an image. The numbers given are a secondary-source reproduction of the classic/legacy table; verify against the current spec PDF before hardcoding into the seed script or ladder config.
2. **Linux headless hardware AVC encode** (§4.7) — everything in §4 was measured on macOS/Apple Silicon. The software-encode-works-headless finding should transfer to Linux; the exact flags needed to unlock *hardware* encode headless on Linux (VAAPI-specific) are inferred from general Chromium documentation, not independently run. Smallest closing experiment is given in §4.7.
3. **Whether Chromium's software AVC encoder reachable via WebCodecs is the same OpenH264 binary WebRTC uses** (§4.7) — plausible, one flag name suggests shared plumbing, but no single authoritative source confirms it. Doesn't affect the operative conclusion.
4. **The brief's specific "~500fps hardware / ~40fps ffmpeg.wasm at 720p" performance figures** (§8) — direction confirmed by multiple sources, exact numbers not found anywhere and should be re-benchmarked, not cited as-is.
5. **AAC/Opus-specific `AudioEncoderConfig` extension dictionaries** (§1.2) — confirmed the base fields (`codec`, `sampleRate`, `numberOfChannels`, `bitrate`, `bitrateMode`) and the two codec strings we need, but did not chase down codec-specific extension members (e.g. Opus's `frameDuration`/`complexity`, AAC's `format` variants) since the brief's question 1 focused on video; flagging the gap rather than fabricating field names.
6. **HTMLVideoElement/`captureStream()` frame-accuracy claim** (§9.1) — reflects community consensus, not a specific spec citation; called out inline rather than presented as a hard spec guarantee.

---

## 12. Citations

**Spec / primary standards:**
- [W3C WebCodecs specification](https://www.w3.org/TR/webcodecs/)
- [WebCodecs Codec Registry](https://www.w3.org/TR/webcodecs-codec-registry/)
- [AVC (H.264) WebCodecs Registration](https://www.w3.org/TR/webcodecs-avc-codec-registration/)
- [VP9 WebCodecs Registration](https://www.w3.org/TR/webcodecs-vp9-codec-registration/)
- [AV1 WebCodecs Registration](https://www.w3.org/TR/webcodecs-av1-codec-registration/)
- [RFC 6381 — The 'Codecs' and 'Profiles' Parameters](https://www.rfc-editor.org/rfc/rfc6381.html)
- [VP Codec ISO Media File Format Binding (WebM Project)](https://www.webmproject.org/vp9/mp4/)
- [AV1 Codec ISO Media File Format Binding](https://aomediacodec.github.io/av1-isobmff/)
- [w3c/webcodecs GitHub issues #138](https://github.com/w3c/webcodecs/issues/138), [#686](https://github.com/w3c/webcodecs/issues/686), [#394](https://github.com/w3c/webcodecs/issues/394)

**MDN:**
- [Using the WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Using_the_WebCodecs_API)
- [WebCodecs API overview](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
- [Codec selection](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection)
- [VideoEncoder](https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder), [VideoEncoder.isConfigSupported()](https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder/isConfigSupported_static)
- [AudioEncoder](https://developer.mozilla.org/en-US/docs/Web/API/AudioEncoder)
- [VideoFrame](https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame), [VideoFrame.close()](https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame/close)

**Chrome / Chromium:**
- [Chrome for Developers — Video processing with WebCodecs](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs)
- [Chromium issue 40540071 — Support GPU hardware in headless mode](https://issues.chromium.org/issues/40540071) (formerly bugs.chromium.org 765284)
- [puppeteer#1260 — GPU is always disabled in headless mode](https://github.com/puppeteer/puppeteer/issues/1260)
- [Chromium docs — Using GPU hardware in headless Chrome](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/gpu/using-gpu-hardware-in-headless-chrome.md)

**Browser support data:**
- [caniuse.com/webcodecs](https://caniuse.com/webcodecs)
- [webcodecsfundamentals.org — AVC (H.264) Family codec support](https://webcodecsfundamentals.org/codecs/avc.html)
- [webcodecsfundamentals.org — codec-analysis-2026 dataset](https://webcodecsfundamentals.org/datasets/codec-analysis-2026/)
- [Mozilla Bugzilla — WebCodecs meta bug 1746557](https://bugzilla.mozilla.org/show_bug.cgi?id=1746557)
- [WebKit STP 157 release notes (AVC H264 encoder)](https://webkit.org/blog/13575/release-notes-for-safari-technology-preview-157/)
- [WebKit commit — AVC H264 WebCodecsVideoEncoder support](https://github.com/WebKit/WebKit/commit/a591b2669d7568d05194a2a2f3d419c855a02a68)

**Headless / Playwright:**
- [microsoft/playwright#7942 — H264 decoding in headless Chromium](https://github.com/microsoft/playwright/issues/7942)
- [Latenode community — GPU-accelerated video encoding via Playwright on Linux](https://community.latenode.com/t/encountering-difficulties-with-browser-based-gpu-accelerated-video-encoding-on-linux-using-playwright/10187)
- Empirical test harness run in this session against Playwright 1.62.1 / Chromium r1234 (self-produced, §4).

**Ladder / streaming guidance:**
- [Apple — HLS Authoring Specification for Apple devices](https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices) (body not retrievable; see §11)
- [Streaming Learning Center — Apple Makes Sweeping Changes to HLS Encoding Recommendations](https://streaminglearningcenter.com/articles/apple-makes-sweeping-changes-to-hls-encoding-recommendations.html)
- [Mux — Video encoding for streaming: a developer's guide](https://www.mux.com/articles/video-encoding-for-streaming-developers-guide)
- [Bitmovin — Choosing the Right Video Bitrate for Streaming HLS and DASH](https://bitmovin.com/blog/video-bitrate-streaming-hls-dash/)
- [Wikipedia — Advanced Video Coding (level limits table)](https://en.wikipedia.org/wiki/Advanced_Video_Coding)
- [Unified Streaming — GOP alignment across bitrates](https://docs.unified-streaming.com/best-practice/content-preparation/improving-content-recommendations.html)
- [mpegflow.com — Keyframe interval tuning for HLS](https://www.mpegflow.com/recipes/keyframe-interval-tuning-for-hls)

**Performance:**
- [remotion-dev/webcodecs-benchmark](https://github.com/remotion-dev/webcodecs-benchmark)
- [BurnSub — WebCodecs vs ffmpeg.wasm](https://burnsub.com/blog/webcodecs-vs-ffmpeg-wasm/)

**Demuxing:**
- [bilibili/web-demuxer](https://github.com/bilibili/web-demuxer)
- [gpac/mp4box.js](https://github.com/gpac/mp4box.js)
