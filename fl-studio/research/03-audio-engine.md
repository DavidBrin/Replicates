# 03 — Audio engine architecture

Lane 3 of the FL Studio research brief (`00-research-brief.md`). Scope: how
to schedule and play sound accurately in the browser, whether to build on
raw Web Audio or Tone.js, autoplay/SSR interaction, voice management,
mixing/metering, drift pitfalls, and the synthesis/sample-decoding basics
lane 4 will need. Confidence tags: **HIGH** (primary source, quoted),
**MED** (secondary/consistent-across-sources), **LOW** (inference, flagged).

---

## 1. Look-ahead scheduler pattern

**HIGH.** The canonical reference is Chris Wilson's "A Tale of Two Clocks —
Scheduling Web Audio with Precision," republished by web.dev after HTML5
Rocks was retired:
[web.dev/articles/audio-scheduling](https://web.dev/articles/audio-scheduling).
Its algorithm, still the standard citation for this pattern a decade later:

- A `setTimeout`/`setInterval` "scheduler" function runs on the main thread
  at a short, fixed interval — the article's number: **"intervals set to
  25ms."**
- On each tick, it schedules every note whose target time falls within a
  **lookahead window** — the article's number: **"a good place to start is
  probably 100ms of 'lookahead' time."** Loop condition quoted verbatim:
  `while (nextNoteTime < audioContext.currentTime + scheduleAheadTime) { scheduleNote(current16thNote, nextNoteTime); nextNote(); }`
- Actual sound-producing calls (`oscillator.start(time)`,
  `gainNode.gain.setValueAtTime(...)`) are always given a precise
  **`AudioContext.currentTime`-relative timestamp**, computed from
  `nextNoteTime += 0.25 * secondsPerBeat` — never fired "now" from the timer
  callback. This decouples *when the JS runs* from *when the sound plays*:
  the browser's audio thread honors the scheduled timestamp exactly, so
  jitter in the timer (GC pauses, layout, other JS) never reaches the
  listener's ear.
- Tempo changes: because `secondsPerBeat` (hence the increment per tick) is
  recomputed from the current BPM on each `nextNote()` call, tempo can be
  changed live without rescheduling already-queued notes retroactively —
  only future notes shift.

**MED** — the 25ms/100ms pair is widely repeated as current best practice
across secondary sources built directly on Wilson's article: the IRCAM
tutorial
([ircam-ismm.github.io/webaudio-tutorials](https://ircam-ismm.github.io/webaudio-tutorials/scheduling/timing-and-scheduling.html)),
Sonoport's "Understanding The Web Audio Clock"
([sonoport.github.io](https://sonoport.github.io/web-audio-clock.html)),
and Boris Smus's *Web Audio API* book, ch. 2, "Perfect Timing and Latency"
([webaudioapi.com](https://webaudioapi.com/book/Web_Audio_API_Boris_Smus_html/ch02.html)).
No source found argues for materially different numbers in 2026; the
pattern predates AudioWorklet and has not been supplanted for this use
case (see §1a). One MDN-adjacent nuance worth carrying into the spec: the
Web Audio clock (`currentTime`) itself only advances in **~128-sample
render-quantum steps** (~2.9ms at 44.1kHz per the Sonoport source), so
scheduling precision below that is meaningless — the 25/100ms numbers are
about *timer* jitter, not clock resolution.

### 1a. Is an AudioWorklet-based clock warranted?

**MED, with a clear recommendation: no, not for this project.**

- The failure mode AudioWorklet solves is **background-tab throttling**:
  Chrome/Firefox throttle `setTimeout`/`setInterval` in background tabs to
  as infrequently as once per second (sources below), which would silently
  stall the 25ms scheduler tick if the user alt-tabs mid-playback.
  AudioWorklet code runs on the dedicated, high-priority **audio rendering
  thread**, which is immune to main-thread/tab throttling — see the dev.to
  writeup "Why JavaScript Timers Drift: Building a High-Precision
  Metronome with Web Audio API"
  ([dev.to/kandz](https://dev.to/kandz/why-javascript-timers-drift-building-a-high-precision-metronome-with-web-audio-api-c0a))
  and the Firefox bug tracker discussion of exempting pages with an active
  `AudioContext` from throttling
  ([bugzilla 1291741](https://bugzilla.mozilla.org/show_bug.cgi?id=1291741),
  [bugzilla 1181073](https://bugzilla.mozilla.org/show_bug.cgi?id=1181073)).
- **But** the cheaper fix for the exact same failure mode is a **Web
  Worker-based timer** instead of a page-thread `setTimeout` — workers are
  not subject to the same per-tab throttling ceiling, and this is the fix
  actually used in production step-sequencer/metronome code found in
  research (see §6). This gets you background-tab safety without the
  added complexity of AudioWorklet's separate module-loading pipeline,
  `AudioWorkletProcessor` message-passing protocol, and its own debugging
  story.
- AudioWorklet's real advantage — sample-accurate **audio-thread**
  processing for custom DSP (e.g., writing your own synthesis algorithm
  sample-by-sample) — is orthogonal to *transport scheduling*. This
  project's playback events (note-on/note-off, step triggers) are already
  scheduled with sample-accurate timestamps via the standard `start(time)`/
  `stop(time)`/`setValueAtTime(time)` AudioParam APIs regardless of which
  thread ticks the lookahead loop; AudioWorklet doesn't make those calls
  any more precise.
- **Recommendation:** ship the classic look-ahead scheduler (25ms tick /
  100ms lookahead) on a **Web Worker** timer instead of a bare
  `setTimeout` on the main thread. This is the standard hybrid fix cited
  across the drift-focused sources above and is enough to survive
  tab-backgrounding for a step sequencer's needs. Reserve AudioWorklet for
  a later phase only if custom per-sample DSP (e.g. a from-scratch
  synthesis algorithm) is ever needed — not for this lane's scope.

---

## 2. Tone.js vs. raw Web Audio API — recommendation

**Recommendation: use Tone.js.** Reasoning below, weighed against the
brief's stated concern (bundle size vs. musical-API convenience).

### Bundle size

**HIGH** — Bundlephobia reports `tone@15.1.22`: **336,893 bytes minified,
76,599 bytes minified+gzipped**
([bundlephobia.com/package/tone](https://bundlephobia.com/package/tone)).
~75KB gzipped is nontrivial for a page load but is comparable to a single
mid-size UI library and is paid once; per the brief's Lane 7, this is a
client-side-only, code-split-able dependency (dynamic-imported behind the
first user gesture — see §3), so it doesn't block first paint or SSR. Set
against the cost of hand-rolling transport math, tempo-ramp signal
handling, and a Part/Sequence-equivalent event scheduler correctly (the
exact bug class Tone.js's own issue tracker documents — see below), 75KB
is a reasonable trade for this project's timeline.

### Transport/BPM handling and tempo changes during playback

**HIGH.** `Tone.Transport` is a global, single clock: BPM is exposed as a
`Tone.Signal` (`Tone.Transport.bpm`), so it supports **live tempo
changes** without manual rescheduling — `Tone.Transport.bpm.value = 120`
takes effect immediately, and `Tone.Transport.bpm.rampTo(240, 5)` ramps
tempo smoothly over 5 seconds
([GitHub Tone.js wiki — Transport](https://github.com/Tonejs/Tone.js/wiki/Transport)).
This is exactly the raw-Web-Audio look-ahead loop's `secondsPerBeat`
recompute (§1), just packaged. One documented caveat worth designing
around: a GitHub issue,
["Transport stops after bpm change" (#385)](https://github.com/Tonejs/Tone.js/issues/385),
reports that assigning tempo using `context.currentTime` instead of
`context.now()` internally could schedule events in the past and silently
drop them from the timeline — this was a Tone.js internal bug, fixed
upstream, but it's a live example of the exact class of off-by-one timing
bug raw Web Audio would leave entirely on this project's plate to get
right from scratch.

### Per-note scheduling: step grid AND free-timed piano-roll notes on one transport

**HIGH.** Tone.js ships two complementary event-scheduling primitives that
both attach to the same `Tone.Transport` clock:

- **`Tone.Sequence`** — "an alternate notation for [Part] that uses nested
  arrays to represent subdivisions... inspired by step-sequencer logic
  where the timing is derived from the array structure"
  ([Tone.js Sequence docs](https://tonejs.github.io/docs/15.0.4/classes/Sequence.html)) —
  a direct fit for the Channel Rack's fixed step grid.
- **`Tone.Part`** — "a collection of ToneEvent objects that can be started,
  stopped, and looped as a single cohesive unit," each event given an
  arbitrary, independent time/duration
  ([GitHub Tone.js wiki — Events](https://github.com/Tonejs/Tone.js/wiki/Events)) —
  the right fit for the Piano Roll's free-timed notes (arbitrary start
  position, arbitrary length, not grid-quantized to a step).

Both run against the same `Tone.Transport`, so a step-sequenced drum
channel and a free-timed piano-roll melodic channel play back in perfect
sync off one clock — directly answering the brief's question about
"handling a step sequencer's fixed grid vs. the piano roll's free timing
on the same transport." Building this correctly on raw Web Audio means
independently re-deriving both a quantized-grid scheduler and a
sparse-event scheduler and keeping both consistent against tempo changes
— exactly the two-pattern problem Tone.js already solves and tests.

### Stop/rewind cleanly

**HIGH.** `Tone.Transport` exposes `start()`, `stop()`, `pause()`, and a
settable `position`/`seconds` property that "will jump to that position
right away" for rewinding
([GitHub Tone.js wiki — Transport](https://github.com/Tonejs/Tone.js/wiki/Transport)),
plus `loopStart`/`loopEnd`/`loop` for sample-accurate loop-region playback
tied to `setTimeline` internally. One caveat found in a Tone.js issue,
["repeated Transport pause() and start() causes degraded performance"
(#370)](https://github.com/Tonejs/Tone.js/issues/370) — attributed to
internal Clock/TickState/Timeline bookkeeping accumulating on repeated
pause/start cycles — worth a note-to-self for lane 2/implementation:
prefer `stop()` + re-`start()` (which resets transport state) over
rapid repeated `pause()`/`start()` toggling in the playback UI, or budget
time to verify this is fixed in the pinned Tone.js version before
shipping a play/pause button that's hit constantly.

### What real browser-DAW projects chose

**MED.** JSequencer (an explicit brief candidate) is "built with Tone.js,
using both samples and digital synthesis"
([github.com/Eden12345/JSequencer](https://github.com/Eden12345/JSequencer)) —
direct precedent for this project's exact use case (mixed
synth+sample-backed step sequencing) choosing Tone.js over raw Web Audio.
Counter-example found for completeness: `gregjopa/step-sequencer` is
explicitly "designed to use native [Web Audio API] nodes"
([github.com/gregjopa/step-sequencer](https://github.com/gregjopa/step-sequencer)) —
a much smaller, single-purpose toy without a piano roll, free-timed
notes, or a mixer, i.e. a scope that doesn't need a transport abstraction
at all. This split is consistent with the recommendation: raw Web Audio
is fine for a single-grid toy; once a project needs one transport shared
by a quantized grid *and* free-timed notes *and* live tempo changes *and*
multi-pattern arrangement (this project's actual scope per the brief), the
transport/event-scheduling code Tone.js provides is exactly the part worth
not re-deriving. (Lane 5 should be treated as authoritative for a fuller
prior-art survey — this lane only verifies the specific claim the brief
asked it to check.)

### Net recommendation

Use **Tone.js** for: `Transport` (BPM/tempo-ramp, start/stop/pause/seek,
loop points), `Tone.Sequence` for the Channel Rack step grid,
`Tone.Part` for Piano Roll free-timed notes, and Tone.js's `Gain`/`Panner`
/`Volume`/`Destination` nodes for the mixer chain (§5) — but do **not**
adopt Tone.js's prebuilt synth voices (`Synth`, `MembraneSynth`, etc.)
wholesale; build lane-4's ADSR/drum-synthesis voices directly on the
underlying native `OscillatorNode`/`BiquadFilterNode`/`GainNode` graph
(Tone.js nodes are thin wrappers around exactly these, and
`Tone.Synth`'s envelope curves are a specific FL-adjacent musical
character choice, not FL Studio's) — this keeps the specific sound
character (and the licensing posture of "we wrote the synthesis, we didn't
borrow presets") fully under this project's control while still getting
Tone.js's transport/scheduling value, which is where the real engineering
risk is. Import Tone.js lazily (dynamic `import()`), not in the initial
bundle — see §3 — to blunt the ~75KB gzip cost against first paint.

---

## 3. AudioContext autoplay policy and Next.js SSR interaction

**HIGH.** Chrome's autoplay policy: "developers can no longer assume that
audio is allowed to play when a user first arrives at a site" — playback
may be blocked until "a user first interacts with the site through a user
activation (a click or a tap)"
([developer.chrome.com/blog/web-audio-autoplay](https://developer.chrome.com/blog/web-audio-autoplay)).
If an `AudioContext` is constructed before any gesture, it's created in
the `"suspended"` state and must be explicitly resumed:

```javascript
document.querySelector('button').addEventListener('click', function () {
  context.resume().then(() => {
    console.log('AudioContext playback resumed successfully');
  });
});
```

Gesture events the Chrome article's own sample code listens for: `click`,
`contextmenu`, `auxclick`, `dblclick`, `mousedown`, `mouseup`, `pointerup`,
`touchend`, `keydown`, `keyup`. Practical implementation pattern for this
project: guard every resume attempt with `if (context.state !== 'running')
context.resume()` rather than assuming first-gesture-only, since a
context can also be auto-suspended by some browsers after a period of
silence.

**HIGH — Next.js/SSR interaction.** `AudioContext` (like `window`) does
not exist during server rendering, so it must never be constructed at
module scope or during render. The consistent fix across sources
([iloveblogs.blog](https://www.iloveblogs.blog/guides/window-is-not-defined-in-nextjs-react-app),
[dev.to/vvo](https://dev.to/vvo/how-to-solve-window-is-not-defined-errors-in-react-and-next-js-5f97),
[sentry.io](https://sentry.io/answers/next-js-13-window-is-not-defined)):
mark the audio-engine module/component `"use client"`, and lazily
construct the `AudioContext` **inside a `useEffect` or, better, inside the
click handler for the transport's first "play"/"start" gesture itself** —
`useEffect` bodies don't run during SSR, so wrapping construction there
(or later) guarantees it only ever executes client-side, post-hydration.
Concretely for this project: don't create the `AudioContext` on mount at
all — create it (and lazy-`import()` Tone.js, per §2) on the user's first
transport-play click, which simultaneously satisfies the autoplay-gesture
requirement and the SSR-safety requirement with one code path, rather than
creating-then-immediately-suspending on mount and resuming later.

---

## 4. Voice management: polyphony, note stealing, release, clicks

**HIGH — envelope release / avoiding clicks.** Never stop a voice with a
hard `gainNode.gain.value = 0` or an unramped `stop()` — this produces an
audible click because Web Audio interprets an instantaneous value jump as
a discontinuity in the waveform. Standard fix, consistent across sources
([alemangui.github.io/ramp-to-value](http://alemangui.github.io/ramp-to-value),
[phpied.com](https://www.phpied.com/webaudio-deep-note-part-5-gain-node/)):
schedule a short ramp-to-zero release instead —
`gain.linearRampToValueAtTime(0, context.currentTime + releaseSeconds)`,
with a typical release of "a short duration like 0.1 seconds" for a
plain note-off, or the instrument's actual ADSR release time otherwise —
and only call `source.stop()` *after* the ramp completes, not
simultaneously with scheduling it. A ramp function must always be preceded
by `setValueAtTime(currentValue, currentTime)` to anchor the ramp's
starting point — calling a ramp method without first pinning the current
value produces unpredictable curves if a prior automation is still
in-flight. This matters directly for **interrupting an attack with a
release** (e.g., user releases a key before the attack/decay finishes):
the fix documented in the W3C public-audio list thread ("Attack, Hold,
Decay using linearRampToValueAtTime") is to call `setValueAtTime(value,
now)` at the interruption point to flatten the in-flight ramp before
scheduling the release ramp from that point — otherwise the pre-scheduled
attack ramp keeps executing underneath/after the release ramp.

**MED — polyphony / note stealing.** No single canonical spec exists for
voice-stealing strategy; the KVR Audio forum thread on the topic
([kvraudio.com/forum/viewtopic.php?t=593060](https://www.kvraudio.com/forum/viewtopic.php?t=593060))
lists the standard strategies from classic synth design: first-note
priority, last-note priority, highest/lowest-note priority, arbitrary
steal, quietest-voice steal, closest-pitch steal. For a monophonic
allocator specifically, "a FIFO gives first-note priority and a stack
gives last-note priority." Tone.js's `PolySynth` is cited as the
reference implementation pattern to follow structurally even though this
project won't use its prebuilt synth voices (§2): "`PolySynth` accepts a
monophonic synth... and automatically handles the note allocation so you
can pass in multiple notes... it merely manages voices of one of the
other types of synths"
([Tone.js PolySynth docs](https://tonejs.github.io/docs/15.0.4/classes/PolySynth.html)).
**Recommendation for this project's scope:** implement a simple fixed-size
voice pool per channel (e.g., 8–16 voices), with **oldest-voice steal**
(FIFO) as the strategy — it's the simplest to reason about and matches
what most step-sequencer/beat-maker tools need (no key-priority nuance
required for drum/bass patterns); a stolen voice must still get the
click-avoiding release ramp above rather than being hard-cut.

---

## 5. Mixer signal chain: per-channel gain/pan → master → limiter, metering

**HIGH — routing shape.** Web Audio `AudioNode` inputs natively accept
multiple connections, so a mixer is straightforward graph composition:
"mixers can be easily built with `GainNode`s, as inputs to `AudioNode`s
support multiple connections" (Medium — "Audio Processing Series 11" on
`DynamicsCompressorNode`,
[medium.com/@j622amilah](https://medium.com/@j622amilah/audio-processing-series-11-6c0b29c551cd)).
Concrete chain per the brief's Mixer scope (minimal — routing to master,
not full sends/inserts): each channel gets its own `GainNode` (volume) →
`StereoPannerNode` (pan) → connects into a single shared master `GainNode`
→ optional `DynamicsCompressorNode` (limiter role) → `AudioContext.
destination`.

**HIGH — master limiter/compressor.** `BaseAudioContext.createDynamics
Compressor()` (or `new DynamicsCompressorNode(context, options)`) is the
native node for this; MDN documents its six params: `threshold` (dB where
gain reduction begins), `knee`, `ratio`, `attack`, `release`, plus a
read-only `reduction` output for metering the reduction itself
([MDN — createDynamicsCompressor](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/createDynamicsCompressor)).
Setting a low threshold and high ratio approximates a brickwall limiter
on the master bus to absorb the sum of multiple simultaneous
channels/voices clipping 0dBFS — standard practice for exactly this
"prevent clipping on the summed bus" purpose the brief describes.

**HIGH — metering via AnalyserNode.** `AnalyserNode` is the standard node
for visualization/metering use cases per MDN and the Web Audio spec;
connect it in parallel off the point in the chain you want to meter (per
channel and/or on the master) via `channelGain.connect(analyser)` (a tap,
not inline) and read `getFloatTimeDomainData()` (for peak/RMS) or
`getByteFrequencyData()` (for spectrum) each animation frame to drive a
mixer peak meter UI. This is a read-only tap — it does not need to be
inline in the audio-processing chain, so it can't affect the actual
playback signal or add latency to it.

---

## 6. Latency/drift pitfalls others hit

**HIGH — tab-backgrounding throttles setTimeout, breaks the naive
scheduler.** "Modern browsers aggressively throttle background tabs... if
a user switches to another tab while running a timer, `setInterval`
intervals can be delayed or throttled to run only once per second"
([pontistechnology.com](https://pontistechnology.com/learn-why-setinterval-javascript-breaks-when-throttled/));
the dev.to metronome writeup states the browser's native Web Audio clock
itself "does not suffer from main-thread rendering lag or background tab
throttling" because it runs on a separate audio thread, but a
`setTimeout`-driven **scheduler tick** (§1) absolutely does suffer this —
Chrome exempts a tab from throttling only if it's *actively playing
audible audio above a volume threshold*, specifically to prevent pages
from gaming this with silent audio elements
([dev.to/kandz](https://dev.to/kandz/why-javascript-timers-drift-building-a-high-precision-metronome-with-web-audio-api-c0a)).
Practical implication for this project: a silently-paused or
zero-master-volume session backgrounded mid-edit could still throttle the
scheduler if it keeps ticking; more importantly, **during active
playback** a plain page-thread `setTimeout` scheduler risks stalling to
once-per-second if it isn't recognized as "audible." **Fix, consistently
cited:** move the scheduler tick into a **Web Worker** (`postMessage`
loop or `setInterval` inside the worker), which runs on its own thread
outside the tab-throttling policy that targets the main/page thread —
confirmed as the standard mitigation approach in the drift-focused
sources above. This directly answers §1a: prefer Worker-tick over
AudioWorklet for this specific problem, reserving AudioWorklet only if
per-sample audio-thread DSP is separately needed.

**MED — sample-accurate loop boundaries.** Because the Web Audio clock
only advances in ~128-sample render-quantum steps (§1, Sonoport source),
a loop's `loopEnd` timestamp should be computed algebraically from BPM/PPQ
math (beats × secondsPerBeat) rather than accumulated by repeated
floating-point addition across many notes, to avoid compounding rounding
drift over a long loop/pattern. Tone.js's `Transport.loopStart`/`loopEnd`
handle this internally via its `Ticks`/`Time` unit system; if building the
loop-boundary math by hand (raw Web Audio path), recompute each loop
boundary from a fixed pattern-length constant each cycle rather than
`currentLoopEnd += patternLength` repeatedly.

---

## 7. Synthesis basics (for lane 4, if synthesis-only instruments are used)

**HIGH — oscillator+envelope (ADSR) synth voice.** Standard graph:
`OscillatorNode` → `GainNode` (amplitude envelope) → channel chain (§5).
ADSR is implemented purely as scheduled `AudioParam` automation on the
gain node around note-on/note-off times: `setValueAtTime` to pin the
start value, `linearRampToValueAtTime`/`exponentialRampToValueAtTime` for
attack/decay/release segments, holding at the sustain level in between.
Per §4, always anchor with `setValueAtTime(currentValue, now)` before any
ramp to avoid glitches from interrupted envelopes. `exponentialRamp` is
preferred over `linearRamp` for pitch/frequency parameters specifically
because "the human ear perceives sound on a logarithmic principle" (per
the ramp-to-value source above), while gain/amplitude releases are
commonly done as plain linear ramps in practice (both approaches are seen
across the sourced kick-drum examples below — treat as a tunable, not a
hard rule).

**HIGH — kick drum (pitched sine drop).** Sourced pattern
([sonoport.github.io/synthesising-sounds-webaudio.html](https://sonoport.github.io/synthesising-sounds-webaudio.html),
[dsokolovskiy.com/blog/all/kick-synthesis](https://dsokolovskiy.com/blog/all/kick-synthesis/)):
a sine `OscillatorNode` starting around 150Hz, with its `frequency`
AudioParam given an exponential ramp down toward near-zero
(`exponentialRampToValueAtTime(0.01, startTime + 0.5)`) — the frequency
"jump to a higher pitch and then quickly return to the original low
frequency" (or, more commonly, just a fast downward sweep from ~150Hz)
is what gives the thump its "click" transient. Amplitude gets its own
envelope: "rises very fast to a maximum (attack phase of 10–20ms) and
then follows an exponential decay of about 100ms." Layering two
oscillators (fundamental + slightly detuned or higher partial) "produces
a fuller sound" but a single oscillator is sufficient for a minimal kick.

**HIGH — snare/hi-hat (filtered noise).** Pattern from
[blog.cofx.nl/browser-beats-snare-and-hi-hat.html](https://blog.cofx.nl/browser-beats-snare-and-hi-hat.html)
and [noisehack.com/generate-noise-web-audio-api](https://noisehack.com/generate-noise-web-audio-api/):
generate a white-noise `AudioBuffer` once (fill a `Float32Array` with
`Math.random()*2-1` values, wrap in a looping `AudioBufferSourceNode` per
trigger), then route through a `BiquadFilterNode` (`type: 'highpass'`,
cutoff commonly cited around 2000Hz, up to ~7000Hz for a brighter
hi-hat) into a `GainNode` envelope. Snare: noise burst through a highpass
filter around 2kHz with a gain envelope from 1→0 over roughly 0.2s (often
layered with a short pitched-tone "body" component for realism, out of
scope for a minimal kit). Hi-hat: noise through a highpass filter (~2kHz
cutoff, some sources note up to 7kHz) with a much shorter gain envelope
(~0.05–0.1s) for closed hats, longer for open. Both are cheap to
implement — a single shared noise buffer can be reused across all
noise-based instruments; only the filter/envelope parameters differ.

**HIGH — decoding sample files (if lane 4 goes sample-backed).** Standard
pattern per MDN and the riptutorial/audio-loader sources: `fetch(url)` →
`response.arrayBuffer()` → `audioContext.decodeAudioData(arrayBuffer)` →
cache the resulting `AudioBuffer` (e.g., keyed by sample name in a
module-level `Map`) for reuse across every trigger of that sample —
decoding is expensive and should happen once at load time, not per
trigger. Two correctness pitfalls flagged directly in sourced material:
(1) `decodeAudioData` only accepts **complete** file data — if the
`fetch` response is read before the full body has arrived, the resulting
buffer is truncated and decoding throws an `EncodingError`
`DOMException`, so always `await response.arrayBuffer()` fully before
decoding, never stream it in; (2) prefer the modern **promise-based**
`decodeAudioData(arrayBuffer)` signature over the legacy
success/error-callback overload for cleaner `async`/`await` composition
with the rest of a lazy-load-on-first-gesture flow (§3).
(MDN: [BaseAudioContext.decodeAudioData()](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData).)

---

## Summary (10 lines)

1. Use the classic look-ahead scheduler: 25ms timer tick scheduling notes
   up to 100ms ahead on `AudioContext.currentTime` (Chris Wilson's "A Tale
   of Two Clocks," verified as still current best practice, HIGH).
2. Run that timer tick in a **Web Worker**, not on the main thread —
   AudioWorklet is unnecessary for transport scheduling; it solves audio-thread
   DSP, not tab-throttled timers (MED).
3. **Recommendation: use Tone.js**, not raw Web Audio, for
   Transport/BPM/tempo-ramp/seek/loop, `Tone.Sequence` for the step grid,
   and `Tone.Part` for free-timed piano-roll notes on the same clock — but
   build the actual synth/drum voices on native nodes, not Tone.js's
   prebuilt instruments (HIGH for the API facts, reasoned recommendation
   for the overall call).
4. Tone.js costs ~75KB gzipped (bundlephobia, HIGH) — acceptable given it's
   dynamic-imported behind the first user gesture, not in the initial
   bundle.
5. Lazily construct `AudioContext` (and dynamic-import Tone.js) inside the
   transport's first "play" click handler in a `"use client"` component —
   satisfies both Chrome's autoplay-gesture requirement and Next.js SSR
   safety with one code path (HIGH).
6. Voice management: fixed-size voice pool per channel, oldest-voice
   (FIFO) stealing, and always release with a short `linearRampToValueAtTime`
   gain ramp (never a hard stop) to avoid clicks (HIGH for click-avoidance,
   MED for the specific stealing strategy).
7. Mixer: per-channel `GainNode` → `StereoPannerNode` → shared master
   `GainNode` → `DynamicsCompressorNode` as a limiter → destination;
   meter with `AnalyserNode` taps that don't sit inline in the signal path
   (HIGH).
8. Biggest drift pitfall: background-tab throttling stalls a page-thread
   `setTimeout` scheduler to ~1/sec; the fix is moving the tick to a Worker
   (HIGH, multiple independent sources incl. Firefox/Chrome bug trackers).
9. Synthesis basics for lane 4: kick = sine oscillator with an exponential
   pitch-drop + fast-attack/decay amplitude envelope; snare/hi-hat =
   filtered white noise (highpass ~2–7kHz) with a short gain envelope;
   samples = `fetch` → full `arrayBuffer()` → `decodeAudioData` →
   cache once, reuse per trigger (HIGH).
10. Real precedent: JSequencer (an explicit brief candidate) chose
    Tone.js for mixed synth+sample step sequencing, matching this
    project's scope; simpler single-grid toys without a shared
    transport/piano-roll used raw Web Audio instead (MED) — reinforcing
    that the transport/scheduling complexity, not the synthesis itself,
    is what justifies Tone.js here.
