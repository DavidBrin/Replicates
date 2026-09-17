# Lane 5 — Comparable prior art

Survey of existing browser sequencers/DAWs, read against `00-research-brief.md`'s
goal for this lane: stop lanes 2 (data model) and 3 (audio engine) from
re-deriving mistakes other public projects already made. Confidence tags:
**HIGH** (primary source, quoted/read directly — repo README, source file,
canonical spec doc), **MED** (secondary source, consistent across several
hits), **LOW** (inference or a single weak source, flagged as unverified).

---

## 1. The canonical scheduling pattern — Chris Wilson, "A Tale of Two Clocks"

**HIGH.** [web.dev/audio-scheduling](https://web.dev/audio-scheduling) (the
current home of the old HTML5Rocks tutorial; this is the article every other
project in this survey either cites or independently reinvents).

This is not a DAW, it's the reference architecture nearly all browser
sequencers below are built on, so it's covered first.

- **The bug it fixes:** scheduling each note with `setTimeout` at its exact
  play time drifts, because the main JS thread can be blocked "tens of
  milliseconds or more" by layout, GC, or other callbacks — audio glitches
  and jitters.
- **The naive fix that's also wrong:** pre-scheduling all notes for the next
  N bars up front on the Web Audio timeline (`osc.start(exactTime)` for every
  future note) is sample-accurate but freezes tempo — Wilson: "if you want to
  change the tempo in the middle of those two bars — or stop playing before
  the two bars are up — you're out of luck." This is the concrete argument
  for why the piano roll's free timing and the step sequencer's fixed grid
  both need a **rolling** scheduler, not a batch one — directly relevant to
  lane 3's "step grid vs. free timing on the same transport" question.
- **The actual pattern:** a `setTimeout` timer fires at a short, regular
  interval (Wilson's number: **25ms**); each tick, a `while` loop schedules
  every upcoming note whose time falls inside a **lookahead window** ahead of
  `audioContext.currentTime` (Wilson's number: **100ms**), using the Web
  Audio node's own precise start-time argument (`osc.start(time)`) rather
  than firing the sound immediately:
  ```js
  while (nextNoteTime < audioContext.currentTime + scheduleAheadTime) {
    scheduleNote(current16thNote, nextNoteTime);
    nextNote();
  }
  ```
  This decouples "when the JS callback runs" (imprecise, throttled by the
  main thread) from "when the sound actually starts" (sample-accurate, set
  on the audio graph). Tone.js's `Transport` (§2 below) is a productized
  version of exactly this loop.
- **Tradeoff to carry into lane 3:** longer lookahead = more resilience to
  main-thread jank, but longer perceptible delay when the user changes tempo
  or hits stop — this is the direct tension between "smooth playback" and
  "responsive transport controls," worth stating explicitly in lane 3 rather
  than picking one number silently.

**Pattern to reuse:** the interval-timer + lookahead-window scheduler is the
correct primitive for both the Channel Rack step grid and the Piano Roll —
one Transport, one scheduler, both surfaces just enqueue notes into it at
different resolutions.

---

## 2. Tone.js — official step sequencer example

**HIGH.** [tonejs.github.io/examples/stepSequencer](https://tonejs.github.io/examples/stepSequencer),
source at [`Tone.js/examples/stepSequencer.html`](https://github.com/Tonejs/Tone.js/blob/dev/examples/stepSequencer.html).

- Uses `Tone.Transport` as the single global timekeeper — described in
  Tone's own docs as providing "sample-accurate scheduling" plus
  tempo-curves/automation, i.e. it *is* the Wilson pattern wrapped in an
  object with `bpm`, `start()`, `stop()`.
- Step triggering goes through `Tone.Transport.scheduleRepeat(callback,
  "16n")` (or similar subdivision) — the callback receives the precise
  Web-Audio `time` argument and is expected to pass it straight into
  whatever plays the sound (`player.start(time, 0, "16t")`), never trigger
  sound synchronously off the JS callback's own wall-clock time. This is the
  concrete API-level lesson for lane 3: **any code that fires audio must
  receive and use the scheduler's `time` parameter**, not `Tone.now()` or
  `Date.now()`, or timing collapses back to jittery `setTimeout` behavior.
- State for "which steps are on" lives outside `Transport` entirely, in a
  custom `<tone-step-sequencer>` web component that just emits a `trigger`
  event `{row, time}` on each active step; Tone.js itself is scheduler +
  synths only, deliberately unopinionated about pattern data shape. That's a
  useful precedent for lane 2: don't expect (or need) an audio library to
  dictate your Pattern/Step data model — that's your own state layer.

**Pattern to reuse:** separate the *scheduler* (owns transport time, ticks,
callback dispatch) from the *pattern store* (owns which steps/notes are
active) — they should only communicate one direction, pattern store → what
to schedule next, never the reverse.

---

## 3. Signal (ryohey/signal) — most relevant comparable, read in depth

**HIGH.** [github.com/ryohey/signal](https://github.com/ryohey/signal),
package manifest read directly at
`raw.githubusercontent.com/ryohey/signal/main/app/package.json`, plus
[deepwiki.com/ryohey/signal](https://deepwiki.com/ryohey/signal). Live at
signalmidi.app (moved off signal.vercel.app per
[HN discussion](https://news.ycombinator.com/item?id=41987352)).

Signal is an open-source (MIT), full-featured, browser-only, multi-track
MIDI piano-roll editor with SoundFont playback and WAV export — the closest
public analog to FL Studio's Piano Roll surface specifically (not a full
DAW with a step sequencer or mixer, but the piano-roll rendering problem is
shared).

**Rendering — the key finding for this lane's "DOM vs canvas" question:**
Signal renders its piano roll with **WebGL, not DOM and not plain
`<canvas>` 2D**, via the author's own small custom package
`@ryohey/webgl-react` (`^0.7.1` in `app/package.json`) plus `gl-matrix` for
the transform math. It does *not* use React DOM elements for notes, and it
does not use a general-purpose 2D canvas library like PixiJS/Konva —
confirmed by dependency list, no `pixi.js`/`konva` in `package.json`. It
also uses `react-window` for virtualized list rendering elsewhere in the UI
(track list), i.e. windowing is used where WebGL isn't, rather than
rendering every DOM row.

**Why this matters — the companion benchmark repo:**
The same author separately published
[`ryohey/react-canvas-perf`](https://github.com/ryohey/react-canvas-perf), a
benchmark comparing six ways to render 1,000 elements in React: raw
`pixi.js`, `@inlet/react-pixi`, `react-pixi-fiber`, `react-konva`, DOM
`<div>`s, and SVG. **HIGH** — measured numbers, read directly:

| Approach | Production FPS (1,000 items) |
|---|---|
| raw pixi.js (no React wrapper) | 31 |
| DOM `<div>`s + CSS | 29 |
| react-konva | 9 |
| react-pixi / react-pixi-fiber | 6 |

The takeaway that explains Signal's architecture choice: **React-wrapped
canvas libraries are the worst option, not the best** — the reconciliation
overhead of a React-fiber layer sitting on top of a retained-mode canvas
scene graph erases canvas's raw speed advantage. Raw canvas/WebGL with a
*thin, hand-written* React binding (which is exactly what
`@ryohey/webgl-react` is — Signal's own author built it specifically to
avoid the react-pixi/react-konva penalty) beats both plain DOM and
React-canvas-library approaches. Plain DOM is competitive with raw canvas at
1,000 items in production builds, but the dev-build gap is large (16fps DOM
vs 38fps raw pixi.js) — meaningful for local dev experience even if
production is closer.

**State management:** `mobx` + `mobx-persist-store` for the reactive
document state, plus `jotai` (+`jotai-effect`/`jotai-optics`/`jotai-scope`)
for more local/derived UI state — i.e. Signal doesn't use one state library
for everything; it splits "the project document" (MobX, needs
persistence/observability) from "ephemeral UI state" (Jotai, needs cheap
scoped atoms). Worth carrying into lane 2 as a precedent for splitting
"Pattern/Note/Channel domain state" from "which step is currently
hovered/selected" state.

**Explicit scope cuts** (from the app's own positioning, quoted via
deepwiki): Signal calls itself a "complementary tool" to full DAWs, not a
replacement, and explicitly ships **no effects/Fx chain** and "Basic Sound
Quality... no high-fidelity audio processing" — a direct precedent for this
project's own Mixer-lane scope cut (brief already scopes out "full
sends/inserts/automation").

**Pattern to reuse:** for the Piano Roll specifically (highest note-density
surface in this project), render notes on canvas/WebGL with a thin custom
binding, not a full React-canvas abstraction library; keep persisted domain
state and ephemeral UI/selection state in separate stores.

**Mistake to avoid:** don't reach for `react-pixi`/`react-konva`/similar
"canvas but it's also React components" libraries for the note grid — the
measured numbers above show they're slower than plain DOM, not faster.

---

## 4. GridSound (`gridsound/daw`)

**MED.** [github.com/gridsound/daw](https://github.com/GridSound/daw),
[wiki: help-pianoroll](https://github.com/gridsound/daw/wiki/help-pianoroll),
[Hackaday coverage](https://hackaday.com/2020/08/17/gridsound-an-audio-workstation-in-your-browser/).

A free, AGPL-3.0, still-work-in-progress browser DAW (self-described
"half open-source" — some services/backend aren't public) with a drum kit,
piano roll, and synthesizer, positioned by its own README as similar in
spirit to LMMS. ~1.9k GitHub stars, live at daw.gridsound.com.

- Confirmed interaction details from the wiki (**HIGH**, quoted from the
  page directly): Ctrl+scroll zooms the piano-roll X-axis, scrolling on the
  virtual-keyboard gutter zooms the Y-axis (pitch) axis independently; each
  key row supports its own gain/pan/low-highpass via a bottom panel; keys
  can be "linked" for glissando/portamento; shift+drag does rectangular
  multi-select. These are concrete interaction-vocabulary data points lane 1
  should compare against FL's own piano roll if not already covered there.
- The project's own changelog notes the piano roll went through **"a full
  rewrite with native scroll and better rect-selection behaviour"** — a
  documented sign that piano-roll scroll/selection performance was bad
  enough on a first pass to justify a rewrite. **MED** confidence on the
  *reason* (inferred from "full rewrite" + "better... behaviour" language;
  the changelog entry itself doesn't state the original bug), but the
  pattern — rect-selection and scroll are the parts of a piano roll that
  get revisited — is corroborating evidence to weight lane 1/2's rect-select
  and scroll-performance requirements more heavily up front rather than as
  an afterthought.
- Could not confirm GridSound's specific canvas-vs-DOM choice from public
  docs (the wiki and README don't state it, and the source tree wasn't
  readable through available tools in this pass) — flagging as an open gap
  rather than guessing. Do not cite GridSound as an argument for either
  side of the canvas/DOM decision; use Signal's numbers instead.

---

## 5. webaudio-pianoroll (g200kg)

**MED.** [github.com/g200kg/webaudio-pianoroll](https://github.com/g200kg/webaudio-pianoroll).

A minimal, dependency-free piano-roll **Web Component**
(`<webaudio-pianoroll>`), part of the same author's `webaudio-controls`
family used widely in small synth demos. Notable for extreme simplicity of
its note data model, useful as a lower bound for lane 2's Note shape:

```
{ t: noteOnTick, g: noteLength, n: noteNumber }
```

i.e. start-tick, duration-in-ticks, pitch — no velocity, no per-note
metadata, by design (this is a toy-scale library, not evidence that
velocity should be omitted — the brief explicitly wants velocity). Exposes
four edit modes (`gridmono`/`gridpoly` for fixed-length step toggling,
`dragmono`/`dragpoly` for variable-length drag-to-resize), which maps
cleanly onto FL's own "click to add a default-length note, drag the right
edge to resize" interaction — a small independent confirmation of the
interaction model lane 1 should already be measuring from FL screenshots
directly.

**Pattern to reuse:** keep the Note record minimal and orthogonal
(position, length, pitch, velocity as separate scalar fields) — resist the
temptation to fold interaction-mode state (is this note currently being
dragged/resized) into the persisted Note shape; that's ephemeral UI state,
same lesson as Signal's Jotai/MobX split above.

---

## 6. waveform-playlist (naomiaro)

**MED.** [github.com/naomiaro/waveform-playlist](https://github.com/naomiaro/waveform-playlist).

Not a step sequencer, but the most relevant public prior art for the
**Playlist/arranger surface** specifically: a multitrack Web Audio
editor/player "inspired by Audacity," with canvas waveform rendering per
track, cue/fade editing, and — notably — **Tone.js listed as a peer
dependency used only for effects**, not for its own scheduling; the
project's own transport/timeline is separate from Tone's. This is a useful
data point for lane 3: it's normal and doesn't require re-architecting
everything to use Tone.js only for synths/effects while keeping a
project-specific transport/timeline model for the arrangement view, if that
ends up being the right split for the Playlist.

**Pattern to reuse:** canvas-rendered per-track waveform/pattern-block
previews scale to "multitrack" (their stated design goal) without a DOM
node per audio sample — same direction as Signal's answer for the piano
roll. For this project's Playlist, this supports rendering pattern blocks
on canvas rather than one DOM element per block once playlist length grows
(exact threshold not stated by the source — treat as directional, not a
measured number).

---

## 7. ToneMatrix / ToneMatrixRedux (Andre Michelle's original + TS rewrite)

**MED.** [github.com/andremichelle/tonematrix](https://github.com/andremichelle/tonematrix)
(author's own modern TypeScript rewrite),
[github.com/MaxLaumeister/ToneMatrixRedux](https://github.com/MaxLaumeister/ToneMatrixRedux)
(community HTML5 revival of the original Flash toy).

The canonical "click boxes, make music" step-grid toy — pentatonic, no
tempo/BPM control, no per-cell velocity, one shared instrument. Relevant
only as the *lower bound* of step-grid scope: it proves a step grid can be
implemented as a single `<canvas>` with a plain 2D fill-rect loop and no
framework at all, useful as a sanity check that the Channel Rack's step
grid is not a hard rendering problem at FL Studio's actual scale (a few
dozen channels × up to 64-ish steps) — orders of magnitude below where
Signal's WebGL/virtualization effort was needed for a piano roll spanning
many octaves × many bars. **LOW** confidence on exact step-grid dimensions
in these toys (not stated precisely in search results) — the point is
qualitative (grid is small and simple), not a specific number to cite.

---

## 8. FL-Studio-specific web clones

**MED/LOW** — read via GitHub README fetch, not deep source audit (repos
are small/early-stage; treat findings as directional).

- **[Apex-dev01/fl-studio-25-web-clone](https://github.com/Apex-dev01/fl-studio-25-web-clone)**
  — React 18 + Vite + **Tone.js** + Tailwind + Supabase, explicitly modeling
  Channel Rack (16/32/64-step configurable), Piano Roll, Mixer (8–10
  channels with FX slots), matching this project's target stack closely
  (Next.js instead of Vite, otherwise nearly identical toolchain choice —
  **corroborates lane 3's Tone.js recommendation and lane 7's stack**, an
  independent project reaching the same conclusion). Self-reported, own
  README (**MED**, project's own claim not independently verified):
  "large sample files may cause performance issues," mobile support
  "limited," and their own 3-phase plan shipped Phase 1 (core audio+UI) and
  Phase 2 (auth/persistence) but left Phase 3 (deployment/testing) "pending"
  — i.e. even a scoped-down FL clone following this exact stack didn't reach
  a finished, tested state in its public phases. Read as a caution on
  scope, not a red flag on the stack itself.
- **[Jaybee18/butterDAWg](https://github.com/Jaybee18/butterDAWg)** — FL
  Studio 20 clone, but built on **Electron** (native shell), not a pure
  browser app — out of scope as an architecture reference for this
  browser-only project, noted only so it isn't mistaken for a relevant
  comparable if found again later.
- **[vinaysharma14/step-sequencer](https://github.com/vinaysharma14/step-sequencer)**
  and **[kalopilato/webstep_midi_sequencer](https://github.com/kalopilato/webstep_midi_sequencer)**
  — small React step-sequencer toys "inspired by" FL Studio's Channel Rack;
  not deep-read (too small to carry independent architectural lessons beyond
  what Tone.js's own example already covers).

---

## 9. JSequencer

**LOW.** [github.com/Eden12345/JSequencer](https://github.com/Eden12345/JSequencer).
Attempted to read `index.html`/bundled source directly; the actual step
grid and Tone.js wiring live in a webpack bundle (`scripts/bundle.js`) not
retrievable through available tools in this pass — findings here are from
search-result summaries only, not primary-source reading, so weight
accordingly. Uses Tone.js for both samples and synthesis, was reportedly
built on jQuery for DOM sync (a dated pattern — not a recommendation, just
noting it predates the DOM-vs-canvas question this lane cares about; jQuery
DOM manipulation for a ~16-32 cell step grid is not evidence against DOM
rendering at that scale, since it's the same order of magnitude as
ToneMatrix above).

---

## 10. BandLab / Soundtrap / Audiotool — closed source, background only

**LOW.** No engineering blog, public repo, or primary source found for any
of the three at the level of "how they schedule audio" or "DOM vs canvas
for their piano roll/playlist" — these are commercial, closed-source
products. What's findable is generic Audio-Worklet background material (MDN,
Chrome DevRel) not tied to a specific confirmed implementation detail from
these three products, so it isn't cited as evidence about them specifically.
**Do not treat any claim about BandLab/Soundtrap/Audiotool's internal
architecture as sourced** — if lane 2 or 3 wants to reason about them,
that requires new primary-source research (e.g. inspecting their shipped
JS bundles), which is out of scope for this lane's time budget. Audiotool's
own ToneMatrix Flash-era toy (§7) is the one thing from this group that *is*
verifiable, via its open-source community ports.

Chrome Music Lab's **Song Maker** is also not usable as prior art here: its
source was never included in the archived
[googlecreativelab/chrome-music-lab](https://github.com/googlecreativelab/chrome-music-lab)
repo — a [still-unanswered 2026 issue](https://github.com/googlecreativelab/chrome-music-lab/issues/14)
on that repo asks "Is it possible to get the song maker source" with no
response, and the repo itself is archived/read-only. Treat Song Maker as
observable-behavior-only (screenshots/live demo), same as FL Studio itself,
not as a source-readable comparable.

---

## Patterns to reuse (lanes 2 & 3)

1. **One scheduler, the Wilson lookahead pattern** (§1) — `setTimeout`/timer
   at ~10-25ms driving a `while` loop that enqueues anything due inside a
   ~100ms lookahead window onto the real Web Audio timeline via each node's
   own `time` argument. This is what `Tone.Transport` already does — lane 3
   doesn't need to hand-roll it if Tone.js is adopted, only needs to hand
   the transport's scheduled `time` through to every voice-trigger call,
   never substitute wall-clock time.
2. **Step grid and piano roll share one transport, different resolutions**
   (§2) — Tone's own example treats the pattern store as a separate concern
   from the scheduler; apply the same split here so the Channel Rack's fixed
   16th-note grid and the Piano Roll's free-tick timing both just enqueue
   note-on/off events against the same `Transport`, rather than each owning
   a private clock.
3. **Canvas/WebGL for the Piano Roll, with a thin custom binding — not a
   React-canvas library** (§3) — Signal's own author built and benchmarked
   this: raw canvas/WebGL beats DOM at scale, but React-wrapped canvas
   libraries (`react-pixi`, `react-konva`) are slower than plain DOM. If
   this project's Piano Roll ends up React-based, either drop to raw
   canvas/WebGL imperatively inside a `useEffect`/ref (Signal's approach) or
   accept DOM — never adopt a "canvas but still a React component per note"
   library.
4. **Split persisted domain state from ephemeral UI/selection state**
   (§3, §5) — Signal splits MobX (document) from Jotai (transient UI); at
   minimum, keep "is this note currently being dragged" and similar
   in-progress-interaction state out of the Note/Pattern record itself.
5. **Canvas for per-track/per-block previews in the Playlist too** (§6) —
   waveform-playlist's answer to "many tracks over a long timeline" is
   canvas-rendered blocks, not one DOM node per pattern block; the same
   answer for FL's Playlist pattern blocks as arrangement length grows.
6. **Minimal, orthogonal Note record** (§5) — position/length/pitch/velocity
   as independent scalar fields, nothing interaction-mode-specific folded
   in.

## Mistakes to avoid (lanes 2 & 3)

1. **Don't schedule audio off `Date.now()`/immediate JS-callback time** —
   every project surveyed that got scheduling right routes the Web-Audio
   `time` parameter through to the actual `.start(time)` call; the ones that
   don't are the ones described as jittery (§1).
2. **Don't pre-schedule a fixed batch of future notes on the audio timeline**
   — it can't respond to a tempo change or stop mid-flight (§1); always use
   the rolling lookahead window, even though it's more code than "just
   schedule the whole pattern up front."
3. **Don't reach for `react-pixi`/`react-konva`/equivalent "canvas as React
   components" abstractions** for the Piano Roll or Playlist — measured
   slower than plain DOM (§3); if canvas is chosen, go imperative/thin
   binding.
4. **Don't assume DOM is automatically wrong at this project's actual
   scale** — DOM was competitive with raw canvas at 1,000 rendered items in
   Signal's own author's production-build benchmark (§3); the step grid
   (tens of channels × tens of steps, order of magnitude smaller than 1,000)
   is very unlikely to need canvas at all per ToneMatrix's precedent (§7) —
   reserve canvas/WebGL specifically for the Piano Roll (many octaves × many
   bars, the surface Signal actually needed it for) and consider it
   optional-but-recommended for the Playlist at longer arrangement lengths,
   rather than mandating canvas everywhere by default.
5. **Don't treat a "full rewrite" changelog entry as a rendering-technology
   verdict without the source to back it** — GridSound's piano-roll rewrite
   (§4) is real but its cause (scroll/selection behavior, not necessarily
   DOM-vs-canvas) isn't confirmed; don't over-cite it.
6. **Don't cite closed-source products' internal architecture as if it were
   observed** (§10) — BandLab/Soundtrap/Audiotool's actual scheduling and
   rendering choices are not publicly documented; anything claimed about
   them needs new primary-source work, not a repeat of this lane's search
   summaries.

## 10-line summary

1. The load-bearing scheduling primitive across every project surveyed is
   Chris Wilson's lookahead pattern (~25ms timer, ~100ms window, scheduling
   via the audio node's own `time` argument) — Tone.js's `Transport`
   productizes it; lane 3 should adopt `Transport` rather than reinvent it.
2. Keep the pattern/note store and the scheduler as separate concerns that
   only talk one direction (store → scheduler), the way Tone's own step
   sequencer example and Signal's MobX/Jotai split both do.
3. Signal (ryohey/signal) is the closest public analog to the Piano Roll
   surface and is read in the most depth here — MIT-licensed, TypeScript,
   worth treating as the primary comparable for lanes 2/3.
4. **Piano Roll: canvas/WebGL**, via a thin custom binding, not a
   React-canvas wrapper library — Signal's own author measured
   React-canvas-library approaches as slower than plain DOM, and built a
   raw-WebGL renderer specifically to avoid that penalty.
5. **Channel Rack step grid: DOM is fine** — the surface is small (tens of
   channels × tens of steps), an order of magnitude below where canvas
   started mattering in the benchmark, and every step-grid toy surveyed
   (ToneMatrix, webaudio-pianoroll's grid mode, Tone's own example) treats
   it as a trivial rendering problem.
6. **Playlist: DOM is viable at "make a beat" scope, canvas is the scale-out
   answer** — waveform-playlist's precedent for "many tracks, long
   timeline" is canvas-rendered blocks; adopt DOM first (matches this
   project's Next.js/React conventions) and revisit only if playlist length
   in practice causes visible jank.
7. A commercial-stack-following FL clone in this exact toolchain (React +
   Vite + Tone.js + Tailwind) independently corroborates lane 3's Tone.js
   direction, but its own README shows even a scoped clone didn't reach a
   finished/tested state — a caution on scope, not on the stack.
8. GridSound is real, active, AGPL-licensed prior art but its source
   wasn't readable in this pass — cite its measured wiki-documented
   interactions (independent zoom axes, key-linking, rect-select), not
   claims about its internals.
9. BandLab/Soundtrap/Audiotool are closed-source and contribute nothing
   verifiable here beyond Audiotool's open-ported ToneMatrix toy; treat any
   other claim about them as unsourced.
10. No project surveyed publishes a hard "notes/blocks per screen before it
    breaks" number — the canvas-vs-DOM recommendations above are directional
    (matched to each surface's realistic note/block density), not backed by
    a benchmark run at this project's exact scale; flag that as a gap lane
    2/3 (or a later perf-testing pass) should close empirically once the
    Piano Roll/Playlist exist.
