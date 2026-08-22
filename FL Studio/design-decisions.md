# FL Studio — Design Decision Log

Every non-obvious choice, with the reasoning that produced it and what it costs.
Named `design-decisions.md` rather than `DECISIONS.md` (the sibling convention)
at the project owner's request; the format below is otherwise modeled on
[`../super-smash/DECISIONS.md`](../super-smash/DECISIONS.md).

Backed by [`SPEC.md`](SPEC.md) and the research lanes in
[`research/`](research) — `00-research-brief.md` through
`07-stack-deployment.md`.

---

## D1 — Steps ARE notes; there is no `Step` entity

**Decision.** A Channel Rack step toggle upserts/deletes a `Note` with
`lengthTicks: 0` at a quantized tick position (SPEC §2, point 1). The rack grid
and the piano roll are two views over the same `Pattern.notes`.

**Rejected.** A separate `Step` type parallel to `Note`, which is what FL's UI
metaphor suggests and what a first pass would naturally reach for.

**Cost.** A "step" is FL's own definition of a zero-length note, so this is
free correctness, not a simplification with a hole in it — but every step-grid
consumer has to remember that a step *is* a note with `lengthTicks === 0`
rather than a distinct kind, so filtering/rendering code must branch on that
field instead of a type tag.

---

## D2 — Tick-based timing, PPQ 96, fixed

**Decision.** Positions and lengths are integer ticks (`PPQ = 96`,
`TICKS_PER_STEP = 24`, `TICKS_PER_BAR = 384`), never step indices. PPQ is a
constant, not a setting (SPEC §2, point 2).

**Rejected.** Step-index storage (`stepNumber: 0..15`), which is simpler for
the rack alone but cannot represent a free-timed piano-roll note, off-grid
drag, or swing delay without a second coordinate system living alongside it.

**Cost.** Every surface that draws a grid — rack, roll, playlist — needs
tick↔pixel and tick↔step conversions (`tickMath.ts`) rather than reading an
index straight off the model; the discipline pays for itself the moment the
piano roll needs non-16th-note note lengths.

---

## D3 — Tone.js transport, but hand-built native voices, not Tone instruments

**Decision.** `Tone.Transport` is the single clock (BPM signal, start/stop/
seek, loop bounds). Every voice is built directly on native
`OscillatorNode`/`GainNode`/`BiquadFilterNode`/`AudioBufferSourceNode` — no
`Tone.Synth`/`MembraneSynth` presets (SPEC §3.2–3.3).

**Rejected.** *Full Tone.js instruments* — fastest to build, but the sound
would be Tone's factory presets, not ours, which undercuts the "everything is
ours" posture D4 exists for. *Raw Web Audio for scheduling too* — Tone's
transport solves sample-accurate look-ahead scheduling and BPM-as-signal
correctly, and reimplementing it is exactly the kind of engineering risk this
project didn't need to take on.

**Cost.** Two mental models coexist in `src/audio`: Tone objects for timing
and native nodes for synthesis, joined at `Tone.getContext().rawContext`. The
seam is a single rule — one context, one clock — enforced by never calling
`new AudioContext()` anywhere.

---

## D4 — Synthesis-only sounds; zero sample assets

**Decision.** No sample files ship. Every drum/bass/lead voice is synthesized
from oscillators, noise and envelopes at runtime; the one shared white-noise
buffer is generated in code, not loaded (SPEC §3.3, lane 4 §3).

**Why — the 909 trap.** The obvious shortcut for kick/clap/hat/snare is a
handful of royalty-free 808/909-style one-shots, which sound better for less
work than any oscillator recipe will on the first pass. Those samples are
themselves derivative of copyrighted hardware sample sets in ways that are
murky to license cleanly, and once one sample file is in the repo the
"synthesis-only" posture is gone — there's no partial version of "no assets
ship." Committing to synthesis-only before any voice exists closes that door
rather than requiring restraint at every future addition.

**Cost.** Drum voices take real tuning effort to sound acceptable (pitch-enveloped
sine kicks, layered noise claps) and will never sound as punchy as a sampled
909. Traded for a repo with zero licensing exposure and a README that can
honestly say "all audio is synthesized at runtime" (SPEC §9, point 7).

---

## D5 — Canvas 2D piano roll: an owned deviation from Signal's WebGL, with an escape hatch

**Decision.** The piano roll is one `<canvas>` 2D, painted imperatively from a
`ref` + `requestAnimationFrame`-on-dirty. React owns only the surrounding
chrome (SPEC §4.2).

**Rejected.** *react-konva/react-pixi or per-note React components* — measured
slower than DOM at this scale (lane 5 §3). *WebGL*, which is what Signal (the
prior-art reference DAW) uses at full-multitrack-MIDI-editor scale.

**Why the deviation is deliberate, not an oversight.** This replica's note
density is a single beat-loop's, not a multi-track song's; only the playhead
animates continuously. Signal's WebGL choice solves a scale problem this
project doesn't have yet.

**Cost/escape hatch.** If profiling ever shows Canvas 2D straining, the
painter sits behind a single interface so a WebGL implementation can be
swapped in without touching the interaction controller — named explicitly in
SPEC §4.2 so the decision doesn't have to be rediscovered under pressure.

---

## D6 — Channel Rack and Playlist are DOM, not canvas

**Decision.** Both surfaces are plain DOM/React (SPEC §4.2); only the piano
roll gets a canvas.

**Why.** Tens of channels × 16 steps, and a handful of playlist tracks × clips,
are trivially inside DOM's budget (lane 5 §6–§7) — canvas would trade CSS
styling, hit-testing, and accessibility for a performance win nowhere near
needed. Clip miniatures inside DOM-positioned playlist clips are themselves
small `<canvas>`/SVG elements, so the split is per-surface, not per-project.

**Cost.** Two different rendering disciplines live in the same codebase (DOM
components vs. an imperative painter), which is more surface area to onboard
against than a single uniform choice — accepted because uniformity here would
mean either a canvas rack (unjustified complexity) or a DOM piano roll
(measured slower).

---

## D7 — Fixed docked layout, not FL's floating windows; layout state stays out of the model

**Decision.** A single fixed grid under one toolbar — Playlist top-left,
Mixer right rail, Rack/Roll tabbed — replaces FL's draggable/floating windows
(SPEC §4.1). `F5`/`F6`/`F7`/`F9` toggle/focus regions.

**Rejected.** A floating-window manager faithful to FL's actual UI, which is
real complexity (z-order, drag, resize, collision, persistence of arbitrary
window rects) in service of a UX FL users don't specifically ask for — the
spec's cut rule is the *sequencing loop*, not the window chrome.

**Why layout state is excluded from `Project`.** Focus/collapse state is
ephemeral UI state, not a fact about the song — saving and reloading a project
should restore the *music*, not which panel happened to be focused when you
saved. Persisting it would also mean every layout tweak touches the save
schema and its migration table for no musical reason.

**Cost.** No per-user window arrangement preference persists across sessions;
accepted because it isn't part of what "reload it" (§1) means for this
project.

---

## D8 — Zustand slice-composer, with per-surface ephemeral UI slices

**Decision.** One store. `src/lib/store.ts` (slice A) composes the domain
slice (dispatch/undo) with UI slices each surface owns and registers itself
(`src/components/<surface>/uiState.ts`, one import + one spread line) — never
co-edited by other slices (SPEC §5, §8).

**Why.** Seven build slices worked on this codebase in parallel (§8's
work-stream table). A monolithic store file is a guaranteed merge conflict
between every pair of them; a composer where each surface owns its own slice
file turns "add piano-roll zoom state" into a change that touches zero files
another agent owns. This is the seam-ownership mechanism the whole parallel
build depended on, not just a state-management preference.

**Cost.** Registering a new UI slice is two lines of ceremony (define +
spread) rather than "just add a field," and the domain/UI slice boundary has
to be enforced by convention (ephemeral UI state must never leak into the
persisted domain slice) rather than by the type system.

---

## D9 — Command-pattern undo, the coalescing-inverse bug, and its fix

**Decision.** Every mutation is a `Command` with `apply`/`invert`. A drag
gesture coalesces multiple dispatches into one `HistoryEntry` when they share
a `coalesceKey`, folding both the applied commands *and* their inverses into
composites (`src/domain/undo.ts`).

**The bug.** The first version kept the *first* dispatch's inverse verbatim
across a coalesced gesture, reasoning "the first inverse already undoes back
to the start." That's only true when every coalesced command overwrites the
same field (a knob drag). It silently lost work the moment a gesture touched
different entities — four coalesced note-adds undid to three notes, because
the entry's only inverse removed the first note. The Channel Rack slice
surfaced it; the fix landed at integration (git log: "fix the undo it
exposed," commit `4c9a7ef`).

**The fix.** Fold inverses in the **reverse** order their commands were
applied: `composite([inverse, ...parts(top.inverse)])`. Each inverse is
captured against the state just before its own command, so prepending lands
exactly on the state the previous inverse was captured against — general
enough to still collapse to one entry for a same-field knob drag, and correct
for a multi-entity paint stroke.

**Cost.** `undo.ts` carries a load-bearing comment explaining why order
matters, because the wrong-but-plausible version compiles, type-checks, and
passes any test that only exercises single-field coalescing.

---

## D10 — Navigation writes bypass the undo stack entirely

**Decision.** `activePatternId` and `playbackMode` are persisted domain state
but are written outside `dispatchCommand` — no command, no inverse, no undo
entry (SPEC §5).

**Why.** These are navigation, not edits. If switching patterns or pressing
`L` pushed an undo entry, flipping between two patterns while auditing a song
would flood the undo stack with no-op-feeling entries, and `Ctrl+Z` during
normal browsing would undo *navigation* instead of the last actual edit —
exactly backwards from what a user reaching for undo wants.

**Cost.** These two fields are a deliberate exception to "components never
write domain fields directly" (SPEC §5) — the store must special-case them
rather than routing every domain write through one path, which is a small
crack in an otherwise uniform rule.

---

## D11 — Pattern clips are references; "Make unique" is the only fork

**Decision.** `PatternClip.patternId` points at a shared `Pattern`; editing
that pattern updates every clip that references it, including their playlist
miniatures. Forking one clip's pattern is a single explicit action —
clone pattern → repoint this clip only → one undoable command (SPEC §2 point
3, §1.2 D4).

**Rejected.** Copy-on-place (each painted clip gets its own pattern copy),
which is what a naive "drag pattern onto timeline" implementation does by
default and is *not* what FL does — FL's whole arrangement workflow depends
on editing a pattern once and having every placement follow.

**Cost.** Reference semantics have to be *visibly* true or the feature reads
as broken rather than as a feature — SPEC §7's e2e loop explicitly asserts
"paint twice, edit once, both miniatures update" as a first-class scenario,
and any code path that snapshots note data at paint time (e.g. a naive
miniature cache) silently reintroduces copy-on-place.

---

## D12 — Hand-rolled offline WAV render, not Tone on `OfflineAudioContext`

**Decision.** WAV export rebuilds the song-mode compiled event list against a
plain `OfflineAudioContext`, reusing the same native-node voice constructors
(they already take a `BaseAudioContext`), renders, and encodes 16-bit PCM WAV
by hand (SPEC §3.5).

**Why.** Because voices were already built on native nodes (D3) rather than
Tone instruments, they work unmodified against an offline context — the only
thing D2's spec flagged as possibly needing "re-plumbing beyond the live
graph" turned out not to, since the voice layer never depended on Tone's
realtime-only machinery in the first place.

**Cost.** WAV encoding itself is hand-rolled rather than pulled from a
library, which is a small, contained, well-understood piece of code (PCM
framing) — traded for one fewer dependency in a code path that only runs once
per export.

---

## D13 — Push-based engine sync (`syncProject`), to preserve the layering rule

**Decision.** `src/audio` never reads the store. The store's wiring layer
subscribes and calls `engine.syncProject(project)`; the engine re-arms the
transport only when the compiled schedule actually changed (SPEC §5,
`engine.ts` header comment).

**Why.** The layering rule (`src/domain` imports nothing browser-ish;
`src/audio` imports only `src/domain` + Tone/Web Audio) would be violated by
the engine importing zustand to read state itself. Push-based sync keeps that
rule intact by construction rather than by discipline — the audio module has
no way to reach back into the store even if someone tried.

**Cost.** `syncProject` has to be cheap and idempotent since it's called on
every store change, and its re-arm decision (`needsRearm`) has to enumerate
exactly which fields affect the *schedule* (patterns, clips, mode, swing,
metronome) versus which are ramped continuously (tempo, channel volume/pan) —
get that enumeration wrong and either the transport re-arms on every fader
tweak (audible glitch) or a real schedule change gets missed (stale playback).

---

## D14 — Choke groups are cross-channel, not FL-accurate same-channel cut-itself

**Decision.** Triggering a voice on a channel with a `chokeGroup` releases the
ringing voices of *other* channels in the same group, and never its own
channel — a closed hat chokes a ringing open hat, but a closed hat retriggering
itself is handled by ordinary voice-pool stealing, a separate mechanism
(SPEC §3.3, `voicePool.ts`).

**Why this reading, not FL's literal same-channel-cuts-itself semantics.**
The two mechanisms address different problems: a channel retriggering itself
is normal polyphony/stealing (already handled by the fixed 8-voice FIFO
pool), while the *musical* 808/909 choke behavior — a closed hat cutting a
still-ringing open hat — is inherently a relationship between two different
channels. Modeling choke as "a channel can choke itself" would double up with
stealing and complicate the one thing choke groups are actually for.

**Cost.** A project author who wants two *different* hat channels in the same
choke group (e.g. two open-hat variations) needs to set `chokeGroup` on both;
the default project only sets it on `hatClosed`/`hatOpen`, so the behavior is
opt-in per channel rather than an FL-style built-in same-channel rule nobody
has to configure.

---

## D15 — Velocity scales per-note amplitude envelope, not channel gain

**Decision.** Each voice trigger carries its own `velocity` (0..1), consumed
by `velocityPeak(velocity, …)` inside that note's own ADSR/envelope
construction — not applied as a gain multiplier on the channel's persistent
signal chain (`src/audio/voices/shared.ts`, `voicePool.ts` triggers).

**Rejected.** Scaling `Channel.volume` (the pre-mixer gain node) per note,
which would be simpler to wire but conflates two different things: channel
volume is a static mix-level property of the channel (SPEC §2's "two
volume/pan layers," point 4), while velocity is a per-event performance
value. Routing velocity through the channel gain node would also make
velocity affect every voice currently ringing on that channel, not just the
one note it belongs to.

**Cost.** Every voice recipe has to accept and apply velocity itself
(`velocityPeak` with a floor so velocity 0 isn't silence), rather than getting
it for free from one shared gain stage — more code per voice, in exchange for
notes at different velocities being independently correct even when they
overlap in time on the same channel.

---

## D16 — Single-project `localStorage` persistence, with a repairing deserializer

**Decision.** One `SaveFile { schemaVersion, project }` at a namespaced key
(`fl-studio:project:v1`). `parseSaveFile` reconstructs every entity field by
field rather than casting, and distinguishes two failure classes: structural
nonsense (not an object, no patterns, unknown `schemaVersion`) returns `null`
and the caller falls back to the default project; *referential* damage
(orphan notes/clips, a missing Master strip, an `activePatternId` pointing at
nothing) is repaired in place (SPEC §2.2, `serialization.ts` header).

**Why repair rather than reject on referential damage.** Losing an entire
project because one clip still points at a since-deleted pattern is a worse
failure than silently dropping that one dangling clip and recreating a Master
strip that should never have been deletable in the first place. The
distinction (structural vs. referential) is what keeps "repair" from becoming
"accept anything" — genuinely malformed input still falls back cleanly to the
default project rather than being coerced into something load-bearing but
wrong.

**Cost.** The deserializer is meaningfully more code than `JSON.parse` +
cast, and a `migrate()` dispatch table exists from day one as a v1→v1 identity
function purely so the *second* schema version isn't the first migration ever
written under pressure.

---

## D17 — The pinned sibling stack

**Decision.** Next 16.3.0, React 19.2.8, Tailwind v4, Zustand `^5.0.15`,
Vitest 4 + jsdom, Playwright, `pnpm verify` — matched to the other replicas in
this repo rather than independently chosen (`package.json`; lane 7 §0).

**Why.** Every sibling project (super-smash included) already runs this
stack, scaffolded and proven at this repo's specific trap: a project path
containing spaces (`FL Studio`). `turbopack.root` is pinned via
`fileURLToPath(new URL(".", import.meta.url))`, and every config path
resolution uses `fileURLToPath` rather than `URL.pathname`, because that's the
one thing this repo's directory naming actually breaks if done the ordinary
way (SPEC §6).

**Cost.** No independent evaluation of alternatives per project — a version
bump or a library swap here is a repo-wide conversation, not a per-project
one, per the memory rule that version constants are never changed unilaterally.

---

## D18 — A paint stroke crossing rack rows commits per row; it is not one session

**Decision.** The Channel Rack buffers a paint/erase stroke **per row**. A
sweep that walks from one row into the next is two buffers under one press:
each row's session is scoped to the `pointerId` and press token that opened
it (`lib/gestureHold.ts`), the shared same-press exemption keeps the second
row's `hold()` from pre-empting the first, and the one physical `pointerup`
reaches both rows' window backstops, so **each row commits what it painted**
(`ChannelRackRow.tsx`, "Crossing rows mid-stroke").

**Rejected.** Lifting the stroke into `ChannelRack` as one session spanning
every row, which is closer to what FL does and would make a cross-row sweep a
single undo entry. It would also have to move each row's optimistic `preview`
and its per-step idempotence bookkeeping up with it, for a gesture whose
per-row commits are individually correct.

**Also rejected:** the behaviour this replaced — the second row's hold
pre-empting the first, whose `onCancel` *abandoned* its buffer. Every cell
erased in the row the sweep started in silently came back on release. If a
buffer cannot be committed it must be because the project moved under it
(`projectRevision`), never because the pointer moved.

**Cost.** One cross-row sweep is one undo entry *per row* rather than one
entry overall — Ctrl+Z takes back the row you finished in, then the row you
started in. Left-drag entering another row still starts nothing there (a
stroke's on/off mode is decided from the cell it began on).

---

## D19 — One mutating gesture at a time, app-wide; history segments are not built

**Decision.** At most one mutating pointer gesture is open across the whole
app. Beginning a new one — `GestureSession.begin`, `keyForEdit`, `keyFor` —
first *ends* whichever gesture was active, sealing its undo entry and dropping
its autosave hold, enforced by a module-level registry of open gestures
(`lib/gestureHold.ts`, `openGestures`). `domain/undo.ts` serializes again in
the dispatch path, so the history is still correct if a surface dispatches with
a `gestureId` it never took a session for.

**Rejected.** Letting several gestures be open at once and modelling the undo
stack as *segments* — an entry per live `gestureId`, so interleaved dispatches
extend whichever entry they belong to rather than only the top one. That is the
general solution, and it is a second timeline data structure to keep coherent
with undo, redo, coalescing and the stack cap, in service of a case no
conventional DAW offers. The problem is prevented instead of modelled.

**Cost.** Multi-pointer simultaneous editing is out of scope: a second pointer
starting a drag ends the first one rather than editing beside it. Two sessions
opened by the *same press* (the tempo wrapper around the BPM plate, a rack
stroke walking into the next row) need an explicit exemption, and it is keyed
on the pointer id **and** a press token — a mouse keeps pointer id 1 for life,
so an id-only exemption would also exempt a session leaked five clicks ago.

---

## D20 — A blur commit flushes before the next gesture's first dispatch, rather than pre-empting it

**Decision.** Blur commits (`keyForCommit` / `commitGestureKey` — the channel
rename box, the BPM field, the pattern rename) are exempt from D19: they take
an id without pre-empting anything. Instead, every gesture entry point
**flushes the open editors first**, through `flushPendingCommits` and the
`usePendingCommit` hook each editor registers its existing commit path with.

**Rejected.** Making the commit itself pre-empting, like every other gesture.
`blur` is delivered *after* the `pointerdown` that caused it, so the commit
reaches the registry one step too late: it kills the gesture that press has
just opened. Also rejected: leaving the ordering to `blur` alone — a
pointer-down that mutates immediately (a drawn note, a velocity stem, a
shift-clone, a painted clip) has already dispatched by then, so the commit
stacked *on top* of it, inverting the undo order and cutting the new drag's
coalescing dead.

**Cost.** Two mechanisms where there could be one, and a registration each
editor has to make. The commit is the tail of an editing session that already
ended, so there is nothing for it to be serialized *against* — only something
for it to land *before*.

---

## D21 — `Command.empty` is a structural flag dropped at dispatch; value equality belongs to the call site

**Decision.** Every command constructor declares `empty: true` when its own
payload is structurally empty — no note patches, no ids, `{}` as a patch — and
`dispatchCommand` drops such a command before it reaches history
(`domain/commands/types.ts`, `isEmptyCommand`). A composite is empty when all
its parts are. The test is O(1) and reads the flag; it never compares patch
values against the project.

**Rejected.** Diffing the command's payload against the project at dispatch
time. That is a per-field comparison over a set whose size is the caller's
business, and `dispatch` sits on the pointermove path where a note drag calls
it sixty times a second. So **value equality is the call site's job**, done
where the values being overwritten are already in hand and the set is bounded:
the resize drag's `lastLengths` in `piano-roll/interactions.ts`, the rack's
velocity nudge and routing cycle, the roll's `applyVelocity`.

**Cost.** The responsibility is split across two layers, and a call site that
forgets its own equality check produces an undo entry that undoes nothing
unless its payload also happens to be structurally empty. The structural guard
is the last line of defence, not the whole defence — which is why it is
documented as such at both ends.

---

## D22 — A 1000-bar arrangement bound at the import boundary, and a separate 600-second export ceiling

**Decision.** `MAX_ARRANGEMENT_BARS = 1000` (`domain/types.ts`), enforced where
untrusted data enters — `readClip` in `domain/serialization.ts` drops an
out-of-range clip exactly as it drops an out-of-bar note. Separately,
`EXPORT_MAX_SECONDS = 600` (`audio/exportWav.ts`) refuses a render longer than
ten minutes, naming the number so the user can shorten the arrangement or raise
the tempo.

**Rejected.** Trusting the file, and clamping at each consumer instead. A clip
position is a *number* in a save file, and every consumer sizes something
proportional to it: `TimelineRuler` builds `Array.from({ length: totalBars })`,
which throws `RangeError: Invalid array length` past 2^32, and the WAV export
allocates a buffer of `arrangementLengthTicks` worth of samples. A
finite-but-enormous `startTick` (`1e308` passes `Number.isFinite`) took the app
down at *render* time, after the import had already reported success.

**Also rejected:** deriving the export ceiling from the bar bound. Bars are
measured in ticks, so the *tempo* decides how much audio 1000 bars is — at the
minimum 10 BPM it is about 6.7 hours, ~8.5 GB of float PCM allocated up front,
plus a second buffer for the encoder. The ceiling is deliberately the
**export's**, not the arrangement's: a long, slow arrangement stays a legal
project to write, play and save; it is only rendering the whole of it to one
in-memory WAV that has no answer.

**Cost.** Two constants rather than one derived from the other, and a legal
project that cannot be exported in a single pass. Ten minutes is ~106 MB of
float PCM plus ~53 MB of 16-bit output, which every browser handles, and it is
longer than any track this app is for.

---

*Companion document: [`SPEC.md`](SPEC.md) is the contract; this file is why
the contract says what it says where that isn't self-evident.*
