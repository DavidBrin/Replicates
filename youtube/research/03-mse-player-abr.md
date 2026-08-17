# MSE Player + Hand-Rolled ABR — Implementation Reference

Scope: we hand-roll the player — `MediaSource`/`ManagedMediaSource` + our own segment fetcher, buffer controller and ABR logic. No hls.js/dash.js/shaka. Because we author the packager too, the parser only ever has to read fixed-duration (2s), keyframe-aligned, per-rendition-init-segmented fMP4 that we produced — several classes of real-world MSE pain (misaligned GOPs, wall-clock-drifting timestamps, third-party CDN packaging bugs) simply don't apply to us and are noted as such below. Where we borrow behavior from hls.js/dash.js, it's because it's proven, not because we're bound by their constraints.

All spec citations are to the W3C Media Source Extensions™ (2nd Edition) Recommendation unless noted.

---

## 1. MSE lifecycle

**Object graph and events**

```
const mediaSource = new MediaSource();
video.src = URL.createObjectURL(mediaSource);   // or video.srcObject = mediaSource where supported (see below)

mediaSource.addEventListener('sourceopen', () => {
  const videoSB = mediaSource.addSourceBuffer('video/mp4; codecs="avc1.640028"');
  const audioSB = mediaSource.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
  // ... start feeding segments
});
```

- `new MediaSource()` creates a source in `readyState = "closed"`. Attaching it to a `<video>` (via `URL.createObjectURL` or, on newer engines, directly via `HTMLMediaElement.srcObject`) is what triggers the browser to transition `readyState` to `"open"` and fire `sourceopen` — this is the only point at which `addSourceBuffer()` is legal ([W3C MSE-2 §3.7](https://www.w3.org/TR/media-source-2/); [MDN: MSE API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API)). `addSourceBuffer` throws `InvalidStateError` if `readyState !== "open"`, `TypeError` on an empty type string, and `NotSupportedError`/`QuotaExceededError` if the MIME type is unsupported or the engine already has too many source buffers.
- **`updating` flag.** Every `SourceBuffer` has a boolean `updating`, false at creation. Calling `appendBuffer()` or `remove()` sets it `true` synchronously and queues the (spec-defined) *segment parser loop* / *range removal* algorithm to run asynchronously; it flips back to `false` and fires `updateend` once that algorithm completes (or `error`/`abort` on failure). **You cannot call `appendBuffer()` or `remove()` again while `updating === true`** — both throw `InvalidStateError` immediately. In practice this means every append/remove goes through a small queue that drains on `updateend`; never fire-and-forget two appends back to back.
- **`endOfStream([error])`.** Requires `readyState === "open"` and no `SourceBuffer` with `updating === true` (both violations throw `InvalidStateError`). With no argument it signals "no more data, ever" — the browser fixes `MediaSource.duration` to the highest end-time across all track buffers and transitions `readyState` to `"ended"`, firing `sourceended`. With `"network"` or `"decode"` it instead surfaces a corresponding `MediaError` on the element. Call it once you've appended the last segment of a VOD asset so the element's `duration`/seekable range become exact and looping (Shorts) knows precisely where to wrap.
- **`abort()`.** Resets `updating` to `false`, aborts the in-flight append/remove if one is running, resets the segment parser to the state it's in right after having just consumed an init segment, and resets the *append window* to `[0, +Infinity)`. This is the primitive we reach for on every seek and every rendition switch (§3, §5).

**MIME type strings** — always feature-detect with `MediaSource.isTypeSupported(mimeType)` before calling `addSourceBuffer`; never assume support.

| Codec pair | Container | Example `codecs` string |
|---|---|---|
| AVC (H.264) High @ L4.0 + AAC-LC | fMP4 | `video/mp4; codecs="avc1.640028"` / `audio/mp4; codecs="mp4a.40.2"` |
| VP9 profile 0 + Opus | fMP4 | `video/mp4; codecs="vp09.00.10.08"` / `audio/mp4; codecs="opus"` |
| AV1 Main profile, level 5.0, main tier, 8-bit | fMP4 | `video/mp4; codecs="av01.0.05M.08"` |

Codec-string grammar is [RFC 6381](https://www.rfc-editor.org/rfc/rfc6381.html) (`avc1.PPCCLL` hex profile/constraints/level; `mp4a.40.2` = MPEG-4 Audio object type 2 = AAC-LC; `vp09.PP.LL.DD`; `av01.P.LLT.DD`). **Recommendation: package every codec into fMP4 (never mux VP9 into WebM)** — Chrome/Firefox/Edge all decode VP9-in-MP4 and Opus-in-MP4 over MSE (Opus-in-ISOBMFF landed in Chrome 70), which keeps one container format across the whole ladder and lets a single buffer-controller code path handle every codec. Safari is the outlier: it has no VP9 or Opus decoder at all, and AV1 hardware decode is gated to specific silicon (M3+ Macs, M4 iPad Pro, iPhone 15 Pro/16 family) with **no software AV1 fallback** as of this writing — so any VP9/Opus/AV1 rung must be `isTypeSupported`-gated and Safari always falls back to the AVC/AAC rung. Ship **separate audio and video `SourceBuffer`s** (two `addSourceBuffer` calls) rather than muxed segments — it lets audio and video ride independent ABR ladders and independent buffer targets, which is how CMAF/DASH "adaptation sets" are meant to be consumed and what a from-scratch packager should just do from day one.

**`SourceBuffer.mode`: `"segments"` vs `"sequence"`.** Mode is seeded automatically from the container's own timestamps when the `SourceBuffer` is created (parsed PTS present → `"segments"`; none → `"sequence"`), and you can only ever move `"segments"` → `"sequence"`, never back ([MDN: SourceBuffer.mode](https://developer.mozilla.org/en-US/docs/Web/API/SourceBuffer/mode)). In `"segments"` mode, each appended segment plays at its own embedded (optionally `timestampOffset`-shifted) timestamp regardless of append order; in `"sequence"` mode, playback order is simply *append* order, with timestamps auto-generated to be contiguous — a compatibility shim for muxers with broken/discontinuous timestamps ([Chrome for Developers: mse-sourcebuffer](https://developer.chrome.com/blog/mse-sourcebuffer)).

**We want `"segments"` mode.** We own the packager and guarantee every segment's timestamps are correct by construction, so we get nothing from `"sequence"`'s auto-generation and lose something real: `"segments"` mode lets us append out of temporal order (prefetch a later segment while a gap still exists earlier, fill a hole from a seek without re-appending everything after it) and it makes a packager timestamp bug *visible* as a real gap/overlap in `buffered` instead of silently smearing it into a contiguous-but-wrong timeline.

*Aside — MSE off the main thread:* Chrome 108+ exposes `MediaSource` inside a dedicated Worker via `MediaSource.handle` (a transferable `MediaSourceHandle` attached back on the main thread through `video.srcObject`), moving segment-parsing and buffer bookkeeping off the UI thread. Worth revisiting once the buffer controller exists, but treat it as a Chrome-only optimization, not baseline ([MDN: MediaSourceHandle](https://developer.mozilla.org/en-US/docs/Web/API/MediaSourceHandle)).

---

## 2. Managed Media Source (Safari / iOS)

Apple never shipped a fully usable `MediaSource` on iPhone: MSE was withheld from iOS Safari for years on battery-life grounds, so **native HLS (`<video src="playlist.m3u8">`) was the only adaptive-bitrate path on iPhone Safari** before Apple introduced its own managed API. On iPad/Mac, `MediaSource` existed longer but with rougher edges (notably, `QuotaExceededError` is not reliably thrown — see §4).

**`ManagedMediaSource` / `ManagedSourceBuffer`** is Apple's replacement, API-compatible with MSE but with the browser retaining eviction/scheduling control instead of the app:

| Safari version | Platforms | Notes |
|---|---|---|
| 17.0 (Sept 2023) | iPad (iPadOS 17), Mac (macOS Sonoma/Ventura/Monterey) | Initial ship. iPhone **not** included. |
| 17.1 (Oct 2023) | + iPhone (iOS 17.1) | Managed Media Source reaches the whole Apple ecosystem. |

([WebKit: WWDC23 Safari 17 beta](https://webkit.org/blog/14205/news-from-wwdc23-webkit-features-in-safari-17-beta/); [WebKit: Safari 17.0](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/); [WebKit: Safari 17.1](https://webkit.org/blog/14735/webkit-features-in-safari-17-1/))

**This decides our fallback matrix precisely:**
- **iOS/iPadOS/macOS Safari ≥ 17.1**: use `ManagedMediaSource`.
- **iOS Safari < 17.1** (any iPhone stuck on an older OS): no reliable MSE and no Managed Media Source exists at all → **must** ship a native-HLS fallback (an actual `.m3u8` playlist our packager also emits, played via plain `<video src>`; Safari's own HLS engine does the ABR itself — none of our JS runs).
- **iPad/Mac Safari < 17**: legacy `MediaSource` may work but is unreliable enough (per Apple's own framing of MMS as fixing MSE's "drawbacks") that we should prefer Managed Media Source wherever `'ManagedMediaSource' in window` is true and only fall back to plain `MediaSource` on WebKit versions that predate it.

**A critical, easy-to-miss gating condition**: `sourceopen` on a `ManagedMediaSource` **only fires** if either (a) an AirPlay-eligible native `<source>` alternative is present, or (b) `video.disableRemotePlayback = true` is set explicitly. Skip both and the managed source silently never opens — playback just hangs with no error. Always set `disableRemotePlayback = true` before attaching, unless you're deliberately offering an HLS `<source>` sibling for AirPlay.

**`streaming` / `startstreaming` / `endstreaming`.** This is the load-bearing behavioral difference from plain MSE: instead of us deciding when to fetch based on watching `buffered` against a target (§4), the browser tells us when to fetch via `ManagedMediaSource.streaming` (boolean) and its change events:

```js
managedMediaSource.addEventListener('startstreaming', () => {
  // streaming flipped false -> true: browser wants more data. Resume our fetch loop.
});
managedMediaSource.addEventListener('endstreaming', () => {
  // streaming flipped true -> false: browser judges the buffer sufficient. Stop fetching.
});
```

`ManagedSourceBuffer` also fires `bufferedchange` when the *user agent itself* evicts data (for memory/thermal reasons) — something that never happens under our control on plain MSE. Practical implication: **the buffer controller needs two real code paths, not a shim** — a MediaSource path driven by our own buffer-health polling/target math, and a ManagedMediaSource path that is purely event-driven (fetch only between `startstreaming`/`endstreaming`, and reconcile our own segment-index bookkeeping whenever `bufferedchange` reports the engine quietly threw away data we thought we still had).

---

## 3. Rendition switching

**`changeType(type)`** declares the MIME type subsequent `appendBuffer()` calls must conform to. It requires `updating === false`; if `MediaSource.readyState === "ended"` it reopens the source (`readyState → "open"`, fires `sourceopen`); it throws `TypeError` on an empty type and `NotSupportedError` if the type is unsupported or incompatible with the buffer's current track configuration ([MDN: SourceBuffer.changeType](https://developer.mozilla.org/en-US/docs/Web/API/SourceBuffer/changeType); shipped Firefox 63+, Chrome 69+).

**When it's required**: whenever the *codec string* for subsequent appends differs from what the `SourceBuffer` currently expects — not just full codec-family changes (AVC → AV1) but also profile/level changes within the same family, since our packager will typically hand each rendition its own `avc1.PPCCLL` string (a 360p encode and a 720p encode legitimately carry different levels). Treat "codec string differs at all" as the trigger, not "container/codec family differs" — it's a cheap call either way, and skipping it when you shouldn't have is a silent-corruption bug, not a loud one.

**Exact procedure — 360p → 720p fMP4 mid-playback, single `SourceBuffer` per media type:**

1. **Abort** the in-flight network fetch for the old rendition's segment (`AbortController.abort()`), and if `sourceBuffer.updating === true`, call `sourceBuffer.abort()` — this resets the parser to "expects an init segment" and clears the append window, so you don't have to wait for an `updateend` that would otherwise land mid-transition.
2. **Remove** (optional but recommended) any already-buffered *forward* range at the old quality you no longer want to play out — `sourceBuffer.remove(currentTime + guardWindow, bufferedEnd)`. This is itself async (`updating`-gated); wait for its `updateend` before continuing. Skip this for a routine ABR step-down/step-up at a segment boundary (nothing forward-buffered yet to remove); use it for an aggressive "replace what's already buffered" fast-switch (§6 startup/ramp-up).
3. **`changeType(newMimeType)`** if the codec string changed (see above — for us, essentially always).
4. **Append the new rendition's initialization segment**, wait for `updateend`.
5. **Append the new rendition's first media segment**, wait for `updateend`.
6. Resume the normal per-segment fetch loop at the new rendition.

**Must we re-append the init segment on every switch? Yes, always.** The `moov`/`trak` box in an fMP4 init segment carries the exact decoder configuration (SPS/PPS for AVC, the VP9 config record, the AV1 sequence header, sample dimensions) for *that specific rendition*; a 720p rendition's config differs from 360p's even inside the same codec family, so the parser needs the new init segment to interpret subsequent `moof`/`mdat` boxes correctly. This is exactly how the reference [Codec/container switching in MSE sample](https://googlechrome.github.io/samples/media/sourcebuffer-changetype.html) and every real remuxer (hls.js, shaka, dash.js) behave — CMAF-style renditions are packaged with per-rendition init segments precisely so a player can swap cleanly.

**Keyframe alignment.** Because we control the packager, we simply *guarantee* every rendition of a title shares identical segment boundaries and forces a keyframe at the start of every segment — this is an encode-time invariant, not a runtime concern, and it's the single biggest reason our player can be simpler than a generic one. For documentation completeness: if renditions were *not* GOP-aligned, switching mid-stream can land the new rendition's first appended frames mid-GOP with no leading keyframe, which either fails to decode, produces a visible corrupt/green frame until the next real keyframe (a well-documented class of bug in generic DASH players — see the [dash.js green-artifact issue](https://github.com/Dash-Industry-Forum/dash.js/issues/2968) for a concrete example), or in the worst case fires a `SourceBuffer` `error` event that tears down the whole `MediaSource`. A generic player defends against this by snapping switch points to the nearest keyframe boundary in the *target* rendition rather than the current one; we get to skip that defense entirely by construction, but the buffer controller should still assert (in dev/test builds) that segment N's timestamp is identical across every rendition, to catch a packager regression before it becomes a player bug.

**Fast-switch note**: dash.js's `fastSwitchEnabled` — proactively `remove()`-and-re-fetch already-buffered *low*-quality segments at a higher quality when bandwidth jumps, rather than waiting for the buffer to drain naturally — is a reasonable v2 optimization once the basic switch path is solid; not required for a correct v1.

---

## 4. Buffer management

**`buffered`** is a live, spec-normalized `TimeRanges` object: ranges are sorted, non-overlapping, and coalesced whenever contiguous. Read it as `buffered.length`, `buffered.start(i)`, `buffered.end(i)`. "How much runway do I have" = find the range containing `currentTime` and compute `end(i) - currentTime`; a gap between ranges is an unbuffered hole and therefore a seek/stall risk (§5).

**`remove(start, end)`** is async and `updating`-gated exactly like `appendBuffer`; it deletes coded frames whose PTS falls in `[start, end)`. Two uses: (a) evicting played-out back-buffer beyond a target window, and (b) clearing unwanted forward buffer during a rendition switch (§3). Note that hls.js's own default for its back-buffer-eviction knob (`backBufferLength`) is `Infinity` — i.e. it doesn't proactively evict at all by default, leaning on the browser's own eviction instead. We should not copy that default: see the buffer-target recommendation below.

**`QuotaExceededError`.** The browser's own *coded frame eviction* algorithm runs automatically **inside** `appendBuffer`, before your data is rejected: it tries evicting old, already-played buffered data first; only if that's insufficient does the append actually throw. Chrome, Firefox and Edge implement this per spec; **Safari has historically not reliably thrown it at all** (confirmed by multiple WebKit/Mozilla interop threads — see [w3c/media-source#201](https://github.com/w3c/media-source/issues/201) and [Bugzilla 1302465](https://bugzilla.mozilla.org/show_bug.cgi?id=1302465)), so on Safari we cannot depend on the exception as a signal and must self-limit buffer growth proactively instead of reactively. Chrome DevRel's own (still-cited, 2017-era but broadly accurate) practical per-browser ceilings, useful as rough budget planning, not a contract ([Chrome for Developers: Exceeding the buffering quota](https://developer.chrome.com/blog/quotaexceedederror)):

| Browser | Video budget | Audio budget |
|---|---|---|
| Chrome | ~150 MB | ~12 MB |
| Firefox | ~100 MB | ~15 MB |
| Safari | ~290 MB | ~14 MB |
| Chromecast | ~30 MB | ~2 MB |

**Standard recovery on catch(QuotaExceededError):**
1. `sourceBuffer.abort()` to reset any partial-append state.
2. `remove()` conservatively — evict from the *played* back-buffer first; never touch the currently-playing GOP or a small guard window around `currentTime`.
3. Wait for that `remove()`'s `updateend`.
4. Retry the original `appendBuffer()`.
5. If it still fails: shrink what you're appending (retry with a smaller byte slice of the same segment — Chrome's own guidance suggests stepping down through progressively smaller fractions) or force a downswitch to a lower-bitrate rendition (smaller segments) via the §3 procedure.
6. If it *still* fails, surface a real "out of memory" error to the UI rather than looping.

**Recommended buffer targets for our case** (local server/R2, 2s segments, predictable latency — not a hostile multi-CDN internet):

| Target | Value | Rationale |
|---|---|---|
| Forward (steady-state) | 20–30s | Matches hls.js `maxBufferLength=30s` / dash.js `bufferTimeAtTopQuality=30s`; dash.js's `stableBufferTime=12s` is its floor once not at top quality. |
| Startup (before first play) | 4–8s (2–4 segments) | Keep time-to-first-frame low; see §6 startup. |
| Back buffer (kept behind `currentTime`) | 10–20s | Enough for scrub-back without a network round trip; evict beyond it with `remove()` **proactively** rather than depending on the browser's own eviction (which is silent on Safari). |
| Total buffered bytes ceiling | ~60 MB | hls.js's own `maxBufferSize` default; guards a high-bitrate AV1/4K ladder from blowing past seconds-based targets. |

All four values above should be config, not constants — see the tunables table at the end of §6.

---

## 5. Seeking

**On `seeking` (fires immediately; may re-fire repeatedly during a scrub drag before the user settles):**

1. **Debounce** scrub gestures — only act once ~50–100ms has passed with no further `seeking` events ("seek settled"); otherwise every intermediate frame of a drag triggers a wasted fetch.
2. **Check `buffered`** for a range containing the settled target time.
   - **Inside an existing range, not at its edge** → usually nothing to do beyond reconciling the fetch queue (stop chasing whatever segment index the *old* position needed).
   - **In a gap (unbuffered)** →
     a. Abort the in-flight fetch for the old position.
     b. If `sourceBuffer.updating === true`, call `sourceBuffer.abort()` — don't wait for an `updateend` that isn't coming in the shape you expect.
     c. (Hygiene, not correctness) optionally `remove()` far-away buffered ranges to bound memory.
     d. Compute the segment index covering the new `currentTime` directly from the manifest: since every segment has a **fixed, known duration**, this is `floor((currentTime - assetStart) / segmentDuration)` — an O(1) lookup, not the binary-search-over-variable-duration-segments a generic HLS player needs. This is a direct payoff of controlling the packager.
     e. Fetch + append that rendition's init segment (if the `SourceBuffer` isn't already primed for it) then the media segment, then resume the normal forward-fetch loop from there.

**The classic "seek into an unbuffered region stalls forever" bug**, and why it happens: `HTMLMediaElement.readyState` only reaches `HAVE_CURRENT_DATA`/`HAVE_FUTURE_DATA` once a `SourceBuffer` covers `currentTime`. If the buffer controller's fetch trigger is written as "am I within `target` seconds of the *end* of my currently buffered range" (a common, natural-looking implementation), it silently never fires after a seek into a gap — there is no buffered range containing `currentTime` for that logic to measure from. The video just freezes at `HAVE_METADATA`, with **no error and often no `stalled`/`waiting` event either**, because native stall detection is itself heuristic and can miss a gap the app already knows about. This is a very well documented failure mode across every MSE implementation ([Bugzilla 1002297](https://bugzilla.mozilla.org/show_bug.cgi?id=1002297); [w3c/media-source#160](https://github.com/w3c/media-source/issues/160)).

**Fix**: the fetch-loop's "do I need to fetch, and what" logic must have a seek-aware branch that is *not* end-of-buffer-relative — on `seeked` (or seek-settled), unconditionally recompute "what segment covers `currentTime` right now" and fetch from there, independent of whatever the periodic buffer-health check would otherwise decide. Keep fetching forward until the newly-appended range merges with (or safely bridges to) any range the old position left behind; native MSE playback will not cross a gap on its own even if data exists shortly past it.

---

## 6. ABR

### Throughput estimation

Sample every completed segment download as `bps = bytes * 8 / seconds`. Use **two EWMAs at different half-lives**, and take the estimate as their **minimum**:

- **Fast EWMA** (short half-life, e.g. 3s): reacts quickly to a bandwidth *drop* — we want to downswitch fast to avoid a stall.
- **Slow EWMA** (long half-life, e.g. 9s): reacts slowly to a bandwidth *rise* — we don't want to chase a one-segment spike upward and then immediately regret it.
- `estimate = min(fast, slow)` — deliberately biases the composite estimate toward the pessimistic reading, so quality drops fast and climbs cautiously ([hls.js: `ewma-bandwidth-estimator.ts`](https://github.com/video-dev/hls.js/blob/master/src/utils/ewma-bandwidth-estimator.ts)). hls.js's own shipped constants are `abrEwmaFastVoD = 3.0`, `abrEwmaSlowVoD = 9.0` (seconds), with a `minWeight` floor of `0.001` and a `minDelayMs` floor of `50` on the sample duration (prevents a cached/near-instant response from producing an absurd bps value) ([hls.js `docs/API.md`](https://github.com/video-dev/hls.js/blob/master/docs/API.md)).
- **First segment, no prior estimate**: hls.js seeds a hardcoded `abrEwmaDefaultEstimate = 500,000` bps and, when `startLevel = -1` (auto), *also* deliberately downloads the very first fragment at the **lowest** rendition purely to measure real throughput before choosing where to actually start (`testBandwidth`) — i.e., it doesn't trust the hardcoded default for the real starting-quality decision, only as an EWMA seed. See "Startup" below for what we do instead.

**Harmonic mean (the MPC alternative)**: Yin et al.'s RobustMPC predicts near-term throughput as the **harmonic mean of the last *k* (e.g. 5) chunk throughputs**, not an EWMA — a harmonic mean punishes one slow outlier chunk much harder than an EWMA blend would, which matches how "time to download X bytes" actually aggregates (it's dominated by the slowest leg, not the average rate), then further pads the estimate down by an empirically observed prediction-error margin before feeding it into an explicit multi-chunk optimization ([Yin, Jindal, Sekar & Sinopoli, "A Control-Theoretic Approach for Dynamic Adaptive Video Streaming over HTTP," ACM SIGCOMM 2015, DOI: [10.1145/2785956.2787486](https://doi.org/10.1145/2785956.2787486)]). We ship EWMA (simpler, well-understood, cheap to tune) but the harmonic-mean framing is worth keeping in mind as the literature's answer to "a single blip shouldn't be treated as symmetric noise" if EWMA proves too twitchy in practice.

### Buffer-based (BBA / BOLA)

**BBA** (Huang, Johari, McKeown, Trunnell & Watson, "A Buffer-Based Approach to Rate Adaptation," ACM SIGCOMM 2014, DOI: [10.1145/2619239.2626296](https://doi.org/10.1145/2619239.2626296)): pick bitrate as a function of buffer *occupancy alone*, no throughput measurement at all. Below a low "reservoir" threshold, always choose the lowest rendition; above a high "cushion" threshold, always choose the highest; between them, interpolate roughly linearly. The insight that matters for us: buffer occupancy is itself a robust *implicit* throughput signal — if you're downloading faster than you play, the buffer grows; if slower, it drains — and it's immune to the throughput-estimator gaming that pure rate-based ABR is vulnerable to on adversarial CDNs (chunked-transfer probing tricks etc.), which is a threat model we mostly don't have as our own origin.

**BOLA** (Spiteri, Urgaonkar & Sitaraman, "BOLA: Near-Optimal Bitrate Adaptation for Online Videos," IEEE INFOCOM 2016, DOI: [10.1109/INFOCOM.2016.7524428](https://doi.org/10.1109/INFOCOM.2016.7524428); extended journal version in IEEE/ACM ToN 28(4), 2020, DOI: [10.1109/TNET.2020.2996964](https://doi.org/10.1109/TNET.2020.2996964)) formalizes buffer-based ABR via Lyapunov optimization with a provable near-optimality bound (time-average utility within `O(1/V)` of optimal). Per-rendition utility is a log function of bitrate, `v_m = ln(S_m / S_min)` (diminishing marginal returns per extra bit, matching perceptual quality curves). The commonly implemented decision rule, at buffer level `Q` and chunk duration `p` (this is the form reproduced in dash.js's own `BolaRule` and cross-checked against multiple secondary treatments of the paper — treat it as the standard shipped form rather than a verbatim quote of the original notation):

```
choose m* = argmax over rendition m of:  ( V * (v_m + gamma * p) - Q ) / S_m
```

`V` and `gamma` are tunable; dash.js derives them by solving two constraints simultaneously — "always prefer the lowest rendition when `Q` is at its minimum buffer floor, always prefer the highest rendition when `Q` is at the buffer target" — rather than hand-picking them. dash.js's default rule stack replaces this with buffer-occupancy ABR only when explicitly enabled; throughput-based `ThroughputRule` is dash.js's actual default (see below), with BOLA as an alternative mode ([dash.js ABR Logic wiki](https://github.com/Dash-Industry-Forum/dash.js/wiki/ABR-Logic); [Spiteri, Sitaraman & Sparacio, "From Theory to Practice: Improving Bitrate Adaptation in the DASH Reference Player," ACM TOMM 15(2s), Article 67, 2019, DOI: [10.1145/3336497](https://doi.org/10.1145/3336497)]).

### Hybrid schemes as actually shipped

**hls.js**: throughput-driven by default. Level selection applies asymmetric safety margins on top of the EWMA estimate — a downswitch only needs the target bitrate to fit under `bwFactor × estimate` (`bwFactor = 0.95`), while an upswitch requires it to fit under the much stricter `bwUpFactor × estimate` (`bwUpFactor = 0.7`, i.e. ~1.43× headroom demanded before climbing) — the same fast-down/slow-up asymmetry as the dual-EWMA is enforced a *second* time at the decision layer. Layered on top is **`_abandonRulesCheck`**: while a fragment is downloading, hls.js polls every 100ms, projects the in-flight fragment's time-to-finish from bytes-received-so-far, and compares it against how much playable buffer is left (`bufferStarvationDelay`); if the download won't finish in time, it **aborts the request and immediately restarts the same segment at a lower rendition**, rather than waiting for the slow download to finish and reacting only at the next natural decision point.

**dash.js**: an explicit *rule stack*, not one formula — `ThroughputRule` (rate-based candidate), `BolaRule` (optional alternative/co-runner), `InsufficientBufferRule` (hard safety net: `possibleBitrate ≤ currentSafeThroughput × currentBufferLevel / segmentDuration`, where `currentSafeThroughput = measuredThroughput × 0.9`; skipped for the first `segmentIgnoreCount` segments so it doesn't fight the startup ramp — [dash.js: InsufficientBufferRule](https://dashif.org/dash.js/pages/usage/abr/insufficient-buffer-rule.html)), `SwitchHistoryRule` (anti-thrash stability filter), `DroppedFramesRule` (downgrades on *decode*-capability pressure, not just network pressure), and `AbandonRequestRule` (throughput-based mid-download abandonment, computed from progress-event byte deltas — the dash.js analogue of hls.js's `_abandonRulesCheck`). The controller takes the **minimum** quality index across whichever rules are currently triggered at the highest priority — i.e. any guardrail can only pull the choice *down*, never force it up ([dash.js: AbandonRequestRule](https://dashif.org/dash.js/pages/usage/abr/abandon-request-rule.html)).

**The pattern worth copying**: throughput estimate proposes a candidate rendition; independent buffer-level rules act only as a downward-pulling guardrail when the buffer is dangerously low; a separate abandonment check can preempt a bad in-flight choice mid-download instead of waiting for the next per-segment decision point. This composable-rules shape (vs. one monolithic formula) is easier to test in isolation and to extend later.

### Startup

hls.js's default (`startLevel = -1`) downloads the **first fragment at the lowest rendition specifically to measure real throughput**, then picks the actual starting rendition from that measurement — avoiding both "guessed too low, wastes the fast connection" and "guessed too high off a stale default, stalls immediately." dash.js instead lets the app hint an `initialBitrate` (e.g. from a prior session) and, with `fastSwitchEnabled`, can replace an already-buffered conservative first segment with a better one shortly after real throughput is known, rather than living with the cautious startup pick for the whole first buffer window.

**Ramp-up should not be forced to one rung per step in either direction** — if measured throughput clearly supports jumping two or three rungs, do it; a sudden bandwidth cliff likewise shouldn't require multiple segment-boundaries to reach the safe rendition. Single-step-only ramping is a common naive-implementation mistake that makes fast connections feel sluggish and slow connections feel dangerous.

### Recommended algorithm for our case

Our conditions differ from what hls.js/dash.js/BOLA were tuned for in ways that matter: we're both client and origin (predictable, low-noise, honest-by-construction throughput samples — no adversarial multi-CDN probing behavior to defend against), the ladder is small and fully known up front (5–8 rungs), and segments are a fixed 2s. **Recommendation: hls.js's shape (EWMA throughput + asymmetric switch margins + abandonment) as the primary mechanism, with dash.js's `InsufficientBufferRule` adopted verbatim as the hard "never rebuffer" floor.** BOLA's chief advantage — provable optimality *without* needing a throughput predictor at all — matters less here, since our throughput samples are exactly the low-noise, single-origin case that makes a throughput predictor trustworthy in the first place; a full BOLA/MPC implementation is more machinery than our environment currently needs, though the buffer-target *framing* it contributes is cheap and worth keeping regardless.

```
# ---- Throughput estimator ----
class ThroughputEstimator:
    fast = Ewma(halfLifeSeconds = 3.0)     # TUNABLE: fastEwmaHalfLife
    slow = Ewma(halfLifeSeconds = 9.0)     # TUNABLE: slowEwmaHalfLife
    hasSample = false

    function onSegmentDownloaded(bytes, elapsedMs):
        elapsedMs = max(elapsedMs, 50)              # floor: avoid inflated bps from cached/instant responses
        bps = (bytes * 8) / (elapsedMs / 1000)
        weight = elapsedMs / 1000                     # longer downloads count more
        fast.update(bps, weight)
        slow.update(bps, weight)
        hasSample = true

    function estimate():
        return hasSample ? min(fast.value, slow.value) : null   # null => caller must use the startup probe

# ---- Rendition selection ----
function selectRendition(ladder, bufferSeconds, throughputEstimate, lastSwitchDirection, segsSinceLastUpSwitch):
    DOWN_SAFETY = 0.90     # TUNABLE: downSwitchSafetyFactor
    UP_SAFETY   = 0.60     # TUNABLE: upSwitchSafetyFactor  (more conservative: needs ~1.67x headroom)
    BUFFER_LOW  = 6.0      # TUNABLE: bufferLowSeconds   (~3 segments; below this, force lowest rendition)
    BUFFER_HIGH = 20.0     # TUNABLE: bufferHighSeconds  (~10 segments; at/above, throughput alone governs)
    MIN_SEGS_BETWEEN_UPSWITCHES = 2   # TUNABLE: antiThrashSegments

    if bufferSeconds < BUFFER_LOW:
        return ladder.lowest

    safeThroughput = throughputEstimate * DOWN_SAFETY

    # InsufficientBufferRule-equivalent: never pick a rendition whose expected
    # download time would exceed the runway currently buffered.
    maxSustainableBitrate = safeThroughput * bufferSeconds / segmentDuration

    candidate = highest rendition in ladder where bitrate <= maxSustainableBitrate
    if candidate is null:
        candidate = ladder.lowest

    if candidate.bitrate > currentRendition.bitrate:      # this would be an upswitch
        if throughputEstimate * UP_SAFETY < candidate.bitrate:
            candidate = currentRendition                   # not enough headroom yet, stay put
        elif segsSinceLastUpSwitch < MIN_SEGS_BETWEEN_UPSWITCHES:
            candidate = currentRendition                   # anti-thrash: don't chase a one-segment blip

    if bufferSeconds >= BUFFER_HIGH:
        candidate = highest rendition where bitrate <= throughputEstimate * UP_SAFETY

    return candidate

# ---- Abandonment (checked periodically while a segment is downloading) ----
function abandonmentCheck(inFlightDownload, bufferRunwaySeconds):
    POLL_MS = 200                    # TUNABLE: abandonPollIntervalMs (2s segments don't need hls.js's 100ms)
    SAFETY_MARGIN_SEGS = 0.5         # TUNABLE: abandonSafetyMarginSegments

    elapsed = now() - inFlightDownload.startTime
    observedBps = (inFlightDownload.bytesReceived * 8) / (elapsed / 1000)
    remainingBytes = inFlightDownload.expectedTotalBytes - inFlightDownload.bytesReceived
    projectedRemainingSeconds = (remainingBytes * 8) / observedBps

    if projectedRemainingSeconds > bufferRunwaySeconds - segmentDuration * SAFETY_MARGIN_SEGS:
        abort(inFlightDownload)
        # Use the partial sample, don't discard it: restart at the highest rendition
        # the OBSERVED throughput can sustain within the remaining runway, not
        # necessarily the lowest rung.
        restartRendition = highest rendition where bitrate <= observedBps * DOWN_SAFETY
        fetchSegment(inFlightDownload.segmentIndex, restartRendition)

# ---- Startup (first segment only) ----
function onPlaybackStart():
    firstDownload = fetchSegment(index = 0, rendition = ladder.lowest)   # unconditional probe
    throughputEstimator.onSegmentDownloaded(firstDownload.bytes, firstDownload.elapsedMs)
    # From segment index 1 onward, run selectRendition() normally.
```

**Tunable / measurable parameters** (config, not constants — every one of these should be overridable per deployment and logged so a regression is traceable to a specific value):

| Parameter | Recommended default | What it trades off |
|---|---|---|
| `fastEwmaHalfLife` / `slowEwmaHalfLife` | 3.0s / 9.0s | Downswitch reaction speed vs. upswitch stability |
| `downSwitchSafetyFactor` | 0.90 | How much headroom before dropping quality |
| `upSwitchSafetyFactor` | 0.60 | How much headroom before raising quality |
| `bufferLowSeconds` / `bufferHighSeconds` | 6s / 20s | Forced-lowest floor vs. throughput-governs-freely ceiling |
| `antiThrashSegments` | 2 | Oscillation resistance vs. ramp-up responsiveness |
| `abandonPollIntervalMs` | 200 | Abandonment reaction latency vs. CPU overhead |
| `abandonSafetyMarginSegments` | 0.5 | False-abandon rate vs. stall-avoidance aggressiveness |
| `defaultBandwidthEstimateBps` | *(unused — see startup probe)* | We deliberately avoid hardcoding this; a real first-segment probe replaces the guess |

---

## 7. Quality menu UX

YouTube's quality menu, as it presents today: **"Auto"** at the top, with the *currently rendering* resolution shown alongside it (e.g. "Auto (1080p)"), updating live as ABR switches while the menu is open — it is a live readout, not a static label. Below Auto, explicit rungs are listed high→low, with HFR/HDR/enhanced variants as their own distinct rows (e.g. "2160p60 HDR," "1080p60," "1080p," "720p"). For non-Premium accounts, the topmost enhanced-bitrate rungs may appear but be paywalled with a "Premium" badge and "Higher picture quality" framing — YouTube advertises the existence of the better rung rather than hiding it; the ordinary rungs below the paywall remain selectable by everyone, including logged-out users ([YouTube Help: Change the quality of your video](https://support.google.com/youtube/answer/91449)).

**Manual selection pins the rendition and disables automatic switching** — this is a standing override, not a one-shot hint. The design questions this raises, and the recommended answers for us:

- **Survives a seek?** Yes — the pin persists; a seek re-fetches at the pinned rendition, never at whatever ABR would otherwise have chosen.
- **Survives a stall/rebuffer?** This is a real product decision, not a spec fact. Recommendation: **the pin is a hard constraint, not a preference** — the player rebuffers *at* the pinned quality rather than silently dropping the user to a lower rendition without telling them, because silently overriding an explicit choice defeats the point of offering the choice. Optionally surface a UI nudge after repeated rebuffers at a pinned quality (e.g. "Struggling to play at 1080p — Switch to Auto?") rather than auto-reverting.
- **Scope**: separate a *per-playback pin* (this video only, cleared on navigating away) from a *standing preference* (sticky across videos — "always prefer Auto" vs. "always prefer 1080p when available," ideally split by network type the way YouTube's own "Video quality preferences" setting is split by Wi-Fi vs. mobile data).

**Implementation contract**: expose `pinnedRendition: RenditionId | 'auto'`. When not `'auto'`, `selectRendition()` short-circuits to always return the pin (the abandonment/throughput machinery still runs underneath for telemetry, just not for the decision). Switching between Auto and a manual pin should not force a rebuffer/init-segment reset if the pinned rendition happens to already be what's buffered — a no-op switch stays a no-op.

---

## 8. Metrics

These should be precise enough to become CI assertions against a fixed, replayable synthetic network trace, not just eyeballed numbers.

- **Startup time (time-to-first-frame).** Elapsed ms from the `play()` call (or navigation to the watch page, if measuring true cold start) to the first video frame actually painted — prefer `requestVideoFrameCallback` firing after `play()` resolves as the "pixels on screen" signal; fall back to the first `timeupdate` with `currentTime > 0` if unavailable. Break it into sub-phases so a regression is attributable: manifest/metadata fetch time (request → `sourceopen`/`loadedmetadata`), first-segment fetch+append time, and total.
- **Rebuffer count.** A qualifying `waiting` event where `currentTime` fails to advance for > 100ms, is **not** immediately preceded by a `seeking` event (excludes ordinary seek latency, which isn't rebuffering in the QoE sense) and is **not** a deliberate pause. Each `waiting` → (`playing`|`canplay`) pair with those exclusions = one rebuffer event.
- **Rebuffer duration.** Sum of `(resumeTimestamp - waitingTimestamp)` across qualifying events. Report both total seconds *and* the ratio `rebufferSeconds / watchTimeSeconds` — the ratio is the one comparable across videos of different length, and it's the term that appears directly as a penalty in the academic QoE formula below.
- **Average bitrate.** Time-weighted, not segment-count-weighted: `Σ(renditionBitrate_i × secondsPlayedAtThatRendition_i) / totalSecondsPlayed`. A naive mean-of-segment-bitrates over-weights brief oscillation.
- **Switch count.** Split into `upSwitches` and `downSwitches` (a downswitch mid-stall is working as intended; an upswitch that immediately reverts is thrashing), plus an `oscillationCount` = a downswitch followed by an upswitch (or vice versa) within a short window (e.g. 2 segments) — a raw switch count alone can't distinguish one clean ramp-up from flapping.
- **QoE roll-up.** Tie the above to the standard linear QoE objective used across the ABR literature (Yin et al. 2015; Mao, Netravali & Alizadeh, "Neural Adaptive Video Streaming with Pensieve," ACM SIGCOMM 2017, DOI: [10.1145/3098822.3098843](https://doi.org/10.1145/3098822.3098843)):

  ```
  QoE = Σ q(R_n)  -  μ · Σ rebufferSeconds_n  -  Σ |q(R_n+1) - q(R_n)|
  ```

  where `q(R)` is a quality-utility function of the rendition's bitrate (can be the bitrate itself, or `ln(bitrate)` to match BOLA's utility), `μ` weights the rebuffer penalty, and the last term penalizes switching (smoothness). This gives us one scalar to assert against in a trace-driven regression test ("did this change to the ABR logic move QoE up or down on the same synthetic trace") rather than eyeballing several independent numbers.
- **Decode-capability signal.** `HTMLVideoElement.getVideoPlaybackQuality().droppedVideoFrames / totalVideoFrames` ([MDN: VideoPlaybackQuality](https://developer.mozilla.org/en-US/docs/Web/API/VideoPlaybackQuality)) distinguishes a *network*-caused stall from a *decode*-too-slow-for-the-device stall — the same signal dash.js's `DroppedFramesRule` uses to downgrade even when bandwidth is fine.
- **`QuotaExceededError` occurrence count** should be zero on any steady-state test trace; a nonzero count means the buffer targets in §4 are miscalibrated for that device/browser, not a one-off.

---

## 9. Progressive fallback

For engines with neither `MediaSource`/`ManagedMediaSource` nor WebCodecs (embedded webviews, very old browsers, locked-down environments), ship one continuous, `faststart`-flagged (moov-at-front) fMP4 file **per rendition** — not segmented — and let a plain `<video src="...">` element drive playback entirely through the browser's native network+decode stack over HTTP Range requests. No player-side buffer or ABR logic is possible here at all; the browser owns the whole pipeline.

**Server requirements** ([MDN: HTTP range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests); originally specified in RFC 7233, folded into RFC 9110's HTTP semantics):

- Advertise `Accept-Ranges: bytes` on the resource. Omitting it means browsers won't even attempt ranged requests and will download the whole file for a single scrub.
- On `Range: bytes=start-end`, respond **`206 Partial Content`** with `Content-Range: bytes start-end/totalLength` and a `Content-Length` equal to the slice length (not the total file length).
- On an unsatisfiable range (start beyond the file length), respond **`416 Range Not Satisfiable`** with `Content-Range: bytes */totalLength`.
- `If-Range` (conditional validator, typically ETag/Last-Modified) only matters if a URL's content can change after a client's first fetch of it; since our packager output is effectively immutable/content-addressed, we can skip `If-Range` support entirely — a real simplification versus a generic CDN origin.
- **Multi-range** (`Range: bytes=0-99,200-299`, multipart/byteranges) requests are not needed — browsers issue single-range requests for `<video>` seeking. Implement single-range support correctly and, if a multi-range request is ever received, just return the full `200 OK` body rather than half-implementing multipart.
- `Content-Type: video/mp4` is what lets the browser recognize and play the resource natively with zero JS involvement.

**What the player loses on this path**: no ABR (one fixed rendition per playback, chosen up front — manual quality selection via a full `src` swap, which reloads/reconnects and briefly breaks continuity, is the only "switching" available); no fine-grained buffer control (`buffered` is still readable, but there's no `remove()`/append control — the browser's native buffering heuristics are a black box); none of our own abandonment/rebuffer-avoidance logic (whatever the native network stack does, we inherit); and none of our custom metrics beyond whatever `buffered`/`waiting`/`getVideoPlaybackQuality` already expose generically. This path is a compatibility floor, not a target experience.

**Detection/selection order**: `'ManagedMediaSource' in window` → `video.canPlayType('application/vnd.apple.mpegurl')` truthy (catches iOS Safari < 17.1, where a real `.m3u8` playlist and Safari's own native HLS engine is the only adaptive path — see §2) → `'MediaSource' in window` with `isTypeSupported` checked against our actual codec strings → plain progressive fallback as the last resort.

---

## 10. Shorts

A vertical (9:16), autoplaying, looping, swipe-navigated player over the exact same rendition library and MSE pipeline as long-form — everything below is about *orchestrating a feed of many `MediaSource` instances*, not a different playback mechanism.

**Preloading the next item.** Maintain a small window of "hot" items centered on the visible index — typically current ±1 (occasionally ±2): `MediaSource` attached, first segment(s) already appended, ready to play the instant a swipe lands. Items outside that window are either not yet created or already torn down. This mirrors the pattern used across TikTok-style feed implementations generally ([Mux Blog: "An extra-sloppy TikTok-style video feed in React Native"](https://www.mux.com/blog/slop-social)): the preload distance is deliberately small — too wide wastes bandwidth/memory on content the user may never reach, too narrow reintroduces the loading-spinner-on-swipe experience Shorts is explicitly designed to avoid.

**Aggressive teardown of the previous item** matters far more here than in a single long-form player, because a Shorts session can construct dozens-to-hundreds of `MediaSource` instances, and any leak compounds fast — this is the primary mobile OOM/crash risk specific to this surface. As soon as an item scrolls more than one position away (or a memory-pressure signal fires): abort any in-flight append (`sourceBuffer.abort()`), cancel in-flight fetches (`AbortController`), detach the element (`video.removeAttribute('src')` / `srcObject = null`), `URL.revokeObjectURL()` any blob URL used, and drop all references to the `MediaSource`/`SourceBuffer` objects (including any event listeners still attached to them) so they're GC-eligible. `endOfStream()` is not the right call mid-teardown — it's for signaling a clean finish, not an abandonment.

**Muted-autoplay policy** is load-bearing for the whole format — Shorts must "just play" the instant it's swiped to, with no tap-to-play affordance breaking the flow.

- **Universal safe baseline**: `muted` (or no audio track) autoplay is explicitly always allowed in Chrome, Safari and Firefox, and the swipe gesture itself satisfies each browser's user-gesture requirement for the initial `play()` regardless ([Chrome for Developers: Autoplay policy in Chrome](https://developer.chrome.com/blog/autoplay); WebKit's iOS `<video>` policy notes at [webkit.org/blog/6784](https://webkit.org/blog/6784/new-video-policies-for-ios/)). This is why every short-form vertical feed ships muted-by-default with an explicit unmute affordance — it's the only path guaranteed to autoplay across engines without requiring a fresh gesture on every single swipe.
- **Unmute persistence is our job, not the browser's.** A user's explicit unmute tap satisfies that browser's gesture requirement for *that* element, but a freshly created `<video>` for the *next* swiped-to item does not inherit that "warmth." On Chrome desktop, the Media Engagement Index (a per-origin ratio Chrome accrues from real playback-with-sound history — inspectable at `chrome://media-engagement`) *can* eventually allow autoplay-with-sound without a fresh gesture, but it's origin-scoped, accrues slowly, and cannot be forced or reset programmatically — don't design around it. Instead: track "the user unmuted within this session" as our own app state and re-apply `muted = false` to each newly created `<video>` element while that state holds.
- **iOS Safari**: `playsinline` is mandatory — without it, playback forces fullscreen, which breaks the entire vertical-feed layout, not just autoplay. Author `muted`, `playsinline`, and `autoplay` directly as HTML attributes rather than only setting them via script; Safari's heuristics are most reliable when the element is autoplaying-muted from the moment it's created.
- **Firefox**: same muted-always-allowed baseline; Firefox's default user setting ("Block Audio") blocks unmuted autoplay pre-gesture, so the muted path is again the one to design around universally ([Mozilla: Allow or block media autoplay in Firefox](https://support.mozilla.org/en-US/kb/block-autoplay)).

**Autoplay policy vs. MSE — the interaction that actually matters**: constructing a `MediaSource`, adding `SourceBuffer`s, and calling `appendBuffer()` are **never** gated by autoplay policy — none of that requires a user gesture. **Only the `play()` call itself** (or the implicit play the `autoplay` attribute triggers) is subject to the gate. The correct Shorts pattern follows directly: eagerly preload the *next* item's `MediaSource`/first segments regardless of any gesture state (always allowed), and gate only the actual `play()` call on the item becoming the visible/active one, muted (or the session's already-unlocked-audio state). A common implementation mistake is conflating "can't autoplay with sound" with "can't prepare the buffer" — buffer prep is unrestricted; only playback-with-sound is restricted. Always handle the rejection branch of the `play()` Promise (`NotAllowedError`) by falling back to a paused/tap-to-play state rather than leaving the UI looking live when it isn't.

**Looping**: prefer the native `loop` attribute over manually listening for `ended` → seek(0) → `play()`, which is prone to a visible black-frame flash; still call `endOfStream()` once every segment is appended so the browser knows the true content duration and loops at exactly the right point rather than only looping once it detects no further data will ever arrive.

---

## References

1. W3C. *Media Source Extensions™ (2nd Edition)*, W3C Recommendation. https://www.w3.org/TR/media-source-2/
2. W3C/WICG. `media-source` living-spec issue tracker. https://github.com/w3c/media-source
3. MDN. *Media Source Extensions API*. https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API
4. MDN. *SourceBuffer.mode*. https://developer.mozilla.org/en-US/docs/Web/API/SourceBuffer/mode
5. MDN. *SourceBuffer.changeType()*. https://developer.mozilla.org/en-US/docs/Web/API/SourceBuffer/changeType
6. MDN. *ManagedMediaSource*. https://developer.mozilla.org/en-US/docs/Web/API/ManagedMediaSource
7. MDN. *MediaSourceHandle*. https://developer.mozilla.org/en-US/docs/Web/API/MediaSourceHandle
8. MDN. *VideoPlaybackQuality*. https://developer.mozilla.org/en-US/docs/Web/API/VideoPlaybackQuality
9. MDN. *HTTP range requests*. https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests
10. WebKit Blog. *News from WWDC23: WebKit Features in Safari 17 beta*. https://webkit.org/blog/14205/news-from-wwdc23-webkit-features-in-safari-17-beta/
11. WebKit Blog. *WebKit Features in Safari 17.0*. https://webkit.org/blog/14445/webkit-features-in-safari-17-0/
12. WebKit Blog. *WebKit Features in Safari 17.1*. https://webkit.org/blog/14735/webkit-features-in-safari-17-1/
13. WebKit Blog. *New `<video>` Policies for iOS*. https://webkit.org/blog/6784/new-video-policies-for-ios/
14. Chrome for Developers. *Media Source API — Automatically ensure seamless playback of media segments in append order*. https://developer.chrome.com/blog/mse-sourcebuffer
15. Chrome for Developers. *Exceeding the buffering quota*. https://developer.chrome.com/blog/quotaexceedederror
16. Chrome for Developers. *Autoplay policy in Chrome*. https://developer.chrome.com/blog/autoplay
17. Mozilla Hacks. *Streaming media on demand with Media Source Extensions*. https://hacks.mozilla.org/2015/07/streaming-media-on-demand-with-media-source-extensions/
18. Mozilla Support. *Allow or block media autoplay in Firefox*. https://support.mozilla.org/en-US/kb/block-autoplay
19. hls.js source. `src/utils/ewma-bandwidth-estimator.ts`. https://github.com/video-dev/hls.js/blob/master/src/utils/ewma-bandwidth-estimator.ts
20. hls.js source. `src/controller/abr-controller.ts`. https://github.com/video-dev/hls.js/blob/master/src/controller/abr-controller.ts
21. hls.js docs. `docs/API.md` (configuration defaults). https://github.com/video-dev/hls.js/blob/master/docs/API.md
22. dash.js docs. *ABR Settings*. https://dashif.org/dash.js/pages/usage/abr/settings.html
23. dash.js docs. *InsufficientBufferRule*. https://dashif.org/dash.js/pages/usage/abr/insufficient-buffer-rule.html
24. dash.js docs. *AbandonRequestRule*. https://dashif.org/dash.js/pages/usage/abr/abandon-request-rule.html
25. dash.js GitHub Wiki. *ABR Logic*. https://github.com/Dash-Industry-Forum/dash.js/wiki/ABR-Logic
26. Huang, T.-Y., Johari, R., McKeown, N., Trunnell, M., & Watson, M. (2014). *A Buffer-Based Approach to Rate Adaptation: Evidence from a Large Video Streaming Service*. ACM SIGCOMM 2014. DOI: [10.1145/2619239.2626296](https://doi.org/10.1145/2619239.2626296)
27. Yin, X., Jindal, A., Sekar, V., & Sinopoli, B. (2015). *A Control-Theoretic Approach for Dynamic Adaptive Video Streaming over HTTP*. ACM SIGCOMM 2015 (also ACM CCR 45(4):325–338). DOI: [10.1145/2785956.2787486](https://doi.org/10.1145/2785956.2787486)
28. Spiteri, K., Urgaonkar, R., & Sitaraman, R. K. (2016). *BOLA: Near-Optimal Bitrate Adaptation for Online Videos*. IEEE INFOCOM 2016. DOI: [10.1109/INFOCOM.2016.7524428](https://doi.org/10.1109/INFOCOM.2016.7524428). Extended version: IEEE/ACM Transactions on Networking 28(4):1698–1711 (2020). DOI: [10.1109/TNET.2020.2996964](https://doi.org/10.1109/TNET.2020.2996964)
29. Spiteri, K., Sitaraman, R. K., & Sparacio, D. (2019). *From Theory to Practice: Improving Bitrate Adaptation in the DASH Reference Player*. ACM Transactions on Multimedia Computing, Communications, and Applications 15(2s), Article 67. DOI: [10.1145/3336497](https://doi.org/10.1145/3336497)
30. Mao, H., Netravali, R., & Alizadeh, M. (2017). *Neural Adaptive Video Streaming with Pensieve*. ACM SIGCOMM 2017, pp. 197–210. DOI: [10.1145/3098822.3098843](https://doi.org/10.1145/3098822.3098843)
31. IETF. RFC 6381, *The 'Codecs' and 'Profiles' Parameters for "Bucket" Media Types*. https://www.rfc-editor.org/rfc/rfc6381.html
32. IETF. RFC 7233, *HTTP/1.1: Range Requests* (range-request semantics subsequently folded into RFC 9110). https://datatracker.ietf.org/doc/html/rfc7233
33. YouTube Help. *Change the quality of your video*. https://support.google.com/youtube/answer/91449
34. Mux Blog. *An extra-sloppy TikTok-style video feed in React Native*. https://www.mux.com/blog/slop-social
35. Mozilla Bugzilla 1302465 / w3c/media-source#201 — cross-browser `QuotaExceededError` interop gaps (Safari non-conformance). https://bugzilla.mozilla.org/show_bug.cgi?id=1302465 · https://github.com/w3c/media-source/issues/201
36. Mozilla Bugzilla 1002297 / w3c/media-source#160 — seeking into unbuffered ranges. https://bugzilla.mozilla.org/show_bug.cgi?id=1002297 · https://github.com/w3c/media-source/issues/160
37. Google Chrome samples. *Codec and container switching in MSE Sample* (`changeType()` reference implementation). https://googlechrome.github.io/samples/media/sourcebuffer-changetype.html
