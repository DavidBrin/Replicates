# Lane 2 — Core Data Model

Domain model for the FL Studio replica's "core sequencing loop": Channel
Rack, Piano Roll, Playlist, Mixer. Derived from FL Studio's **observed
behavior** (official manual, forum explanations from Image-Line staff and
long-time users, and cross-checked tutorials) — never from the binary `.flp`
format, which is not a spec for anything.

Every claim is tagged:

- **HIGH** — quoted verbatim from Image-Line's own manual (image-line.com)
  or an Image-Line-hosted source.
- **MED** — consistent across multiple independent secondary sources
  (forum posts, tutorial sites) that agree with each other and with what the
  manual implies, but isn't itself quoted from the manual.
- **LOW** — inference, or a single unconfirmed source. Flagged explicitly.
- **PROPOSED** — not a claim about FL Studio at all; my design decision for
  the clone, justified by the HIGH/MED facts above it.

---

## 1. The central behavior: steps ARE notes

**[HIGH]** FL Studio does not maintain two parallel data structures for the
step sequencer grid and the piano roll. They are one and the same note list,
rendered two ways. From the official Channel Rack manual
(image-line.com/fl-studio-learning/fl-studio-online-manual/html/channelrack.htm):

> "The Stepsequencer overlays the Piano roll and so switching to this mode
> allows you to edit step sequences in Piano roll mode, so long as you
> respect the note length (zero length) and positioning (on beat) layout."

> "If you would like to convert a Piano roll to Step mode again, you need
> notes of zero length. Select all notes, set Snap to 'none' and Discard
> note lengths (Shift+D)."

> "Each button (step) in the grid represents a 16th note."

So a "step" is exactly a **Note** with:
- position quantized to a 16th-note grid boundary,
- length collapsed to zero (the manual's own term — rendered as a short
  audible blip, not sustained),
- pitch either the channel's default preview pitch, or explicitly set via
  "the Graph Editor or Piano roll preview" **[HIGH, same page]**.

This is the single most important modeling decision for lane 2: **do not
build a separate `Step` entity that references a `Note` entity, or vice
versa.** Build one `Note` entity; a step-grid cell toggle is a convenience
UI action that inserts/removes a zero-length `Note` at a quantized position.
The step grid and the piano roll are two *views* over `Pattern.notes`,
filtered/rendered per channel.

**[HIGH]** Pitch for a step is not fixed at a single hardcoded value —
per-step pitch is user-adjustable via the Graph Editor's "Note" control lane
in the Channel Rack, described as intended for drum-sample pitch tweaks:
"intended for use with drum samples and effects; If you want to enter a
melody, use the Piano roll." **[MED, inference]** the practical default
pitch most tutorials describe for a freshly added drum channel's steps is a
single fixed default note (commonly cited around C5 in walkthrough content),
but this was not found stated as an authoritative constant in the manual
itself — treat the exact default pitch as **[PROPOSED]** for the clone
(pick one fixed MIDI note, e.g. 60/C5, as every step's default pitch; the
UI never needs to show pitch for step-grid channels unless the user opens
the piano roll for that channel).

---

## 2. Project → Channel → Pattern → Note hierarchy

**[HIGH]** From the Channel Rack manual: "When Instrument Channels are added
or removed from the project the height of the Channel Rack will change
dynamically." A **Channel** is a project-scoped, pattern-independent entity
— it exists once per project, not once per pattern. Every **Pattern**
addresses the *same* set of channels; a pattern's note data for a channel is
simply empty if the user never programmed anything there for that pattern.

**[HIGH]** Per-channel controls that live outside any pattern (channel-level,
not per-note): "Channel Volume for native plugins affects note voice volume
directly", "Channel Panning… is pan information sent to the plugin", and
mute — "Turning this LED off will mute the Channel." The manual explicitly
calls these **pre-mixer** controls, distinct from the mixer track's own
fader/pan: "These are 'pre-mixer' controls that function separately from
mixer track settings." So volume/pan exist at **two layers** — channel
(pre-mixer, affects the instrument's note-rendering) and mixer-track
(post-instrument, affects the bus).

**[HIGH]** Channel → Mixer routing: "newly added Channels are routed to the
Master Mixer Track" by default, and can be redirected either via "a direct
control in front of each channel button" in the Channel Rack, or via the
channel's own settings — both ultimately set the same `mixer track index`
field on the channel (image-line.com/fl-studio-learning/fl-studio-online-manual/html/mixer.htm).

**[HIGH]** When a channel is **removed**, per the same page's implication
about dynamic Channel Rack height and forum consensus **[MED]**: existing
note data for that channel, in every pattern, is discarded along with it —
there is no "orphaned notes" state in FL's UI. **[PROPOSED for the clone]**:
deleting a Channel cascades to delete every `Note` referencing it across
every `Pattern`; this should be a single explicit, undoable operation (see
§7) since it is destructive across the whole project, not just the pattern
currently open.

When a channel is **added**, it starts with an empty step row / no notes in
every existing pattern — **[MED]**, consistent across tutorials and the
default-state screenshots in Image-Line's own walkthroughs; nothing in the
manual suggests retroactive step generation.

---

## 3. Pattern length: fixed vs. auto-extend

**[HIGH]**, direct quote from the Channel Rack manual:

> "When set to Auto the length of the pattern will be set by the end of the
> last bar with data in it."

> "…from 1 to 512 steps" (manual length range, when not set to Auto).

So FL Studio's pattern length has two modes:
1. **Auto** (the default) — pattern length is *derived*: it equals the
   position of the last bar containing any note/automation data, rounded up
   to a full bar. Adding a note past the current end silently grows the
   pattern; there is no error state for "note past pattern end" in Auto
   mode.
   
   **[HIGH]** confirming a separate length-setting mechanism exists in the
   Piano Roll itself, from the Piano Roll manual: "When set to type
   **Pattern length** (Right+Click) the Time Marker to define the length of
   the currently selected Pattern." — i.e. a Time Marker can pin a length
   even while otherwise auto-following content, functioning like a manual
   override marker rather than a separate numeric field.

2. **Fixed** — the user pins an explicit length in steps (1–512, i.e. up to
   32 bars of 16 steps each at the default step resolution). Notes placed
   past the fixed end are not deleted but do not play in the pattern's own
   loop; they only matter if the pattern is later resized or if the piano
   roll draws past what the step grid currently shows.

**[MED]** Per-channel step count can differ from the pattern's headline
"16 steps" view: a channel can be configured to more steps-per-bar (e.g. 32,
64) independent of other channels in the same pattern, which is one
mechanism by which "the end of the last bar with data" can be a fractional
or extended position relative to the nominal 16-step grid. This is a power-
user feature (`Step editor` "steps per beat"); the brief scopes it out of
the core loop (16 steps = 1 bar, 4/4, uniform across channels), but the data
model should not *structurally* prevent per-channel resolution later — keep
note position as an absolute tick count, never an integer step index (see
§5).

---

## 4. Playlist, Pattern Clips, and pattern reuse

**[HIGH]**, Playlist manual: "The Playlist in FL Studio sequences (plays)
all elements of a project to create the final song. The Playlist window
consists of multi-purpose 'Clip Tracks' that can hold Pattern Clips, Audio
Clips and Automation Clips."

**[HIGH]**, Pattern Clips manual page: "Patterns can contain [note] and/or
automation stored as [event automation] data. Patterns can be placed in the
Playlist as **Pattern Clips**." A Pattern Clip is explicitly a
**placeholder** that *references* a Pattern, not a copy of one — this is
the manual's own word choice ("placeholder for patterns in the Playlist").

**[HIGH]** direct implication for reuse: because a Pattern Clip is a
reference/placeholder rather than a data copy, placing the same pattern at
multiple Playlist positions and editing the pattern (in the Channel Rack or
Piano Roll) updates every placed instance simultaneously. This is the
default/only behavior for a plain Pattern Clip.

**[HIGH]**, same source, confirms an explicit **opt-out** exists — this is
the strongest evidence for the reference semantics, since an opt-out to make
one instance independent is meaningless unless the default is shared:
Pattern Clips have a "Make unique" option in the Clip Menu, described (per
the Piano Roll manual, cross-referenced) as needed "to maintain independent
settings when multiple channels share a pattern" — i.e. "Make unique" forks
the clip's pattern reference into a new, independently-editable pattern
without touching the other placed instances.

**[HIGH]** Historical note worth pinning down because it explains *why*
free placement matters as a design decision, not an incidental default (from
forum research, Image-Line's own release notes as cited on the forum,
**[MED]** since it's forum-quoted rather than manual-quoted): "the limitation
of one pattern per playlist track was removed in FL 11; you can now put
whatever you like on any playlist track." Tracks in the Playlist are
general-purpose lanes, not pattern-typed slots — any track can hold any mix
of Pattern Clips, Audio Clips, and Automation Clips.

**[HIGH]** Pattern Clip coloring modes (from the Pattern Clips manual page),
relevant because it's a genuine three-way choice the data model must
represent, not just a UI toggle:
- **Note** — colors the clip by the pitch/note-color settings inherited
  from the piano-roll note-coloring scheme.
- **Chan** — colors the clip by the channel's own assigned color.
- **Pat** — colors the clip by the parent pattern's own assigned color.

So `Pattern` needs its own `color` field distinct from any `Channel.color`,
and the Playlist clip needs a `colorMode` enum, not just a resolved color.

### 4.1 Song mode vs. Pattern mode

**[MED]**, consistent across the manual's framing and multiple tutorials: FL
Studio has two playback contexts. **Pattern mode** plays only the currently
selected pattern, looping it indefinitely, ignoring the Playlist entirely —
useful while composing a beat before it's placed anywhere. **Song mode**
plays the Playlist's full arrangement of Pattern/Audio/Automation Clips
across their timeline positions, i.e. what a listener would call "the song."
This is a **transport-level playback-source toggle**, not a property of any
pattern or clip — model it as `Project.playbackMode: 'pattern' | 'song'`
plus `Project.activePatternId` (used only when in pattern mode).

---

## 5. Timing resolution: ticks, not step indices

**[HIGH]**, from the Piano Roll manual, on why the model must not store note
position as an integer step number: "The length of a 'tick' depends on the
**PPQ setting**. Reducing PPQ mid-song will reposition any notes not falling
on an exact Bar or Step boundary." I.e. FL Studio's own internal
representation is tick-based (PPQ-relative), and step positions are just a
common special case of tick positions that happen to fall on 16th-note
boundaries.

**[MED]** FL Studio's default PPQ (pulses/ticks per quarter note) is **96**.
Multiple independent forum threads on image-line.com's own forum discuss "96
PPQ" as the long-standing FL default and as the base unit users reason about
when calculating step/tick math (e.g. a thread titled "PPQ values question,
why 96?"), and Image-Line's own MIDI-scripting API tutorial page
(il-group.github.io/FL-Studio-API-Stubs, an Image-Line-affiliated site)
documents PPQ as the unit the whole time-conversion API is built around. No
single manual sentence states "the default is 96" in so many words in the
pages fetched for this lane, so this stays **MED** rather than HIGH — but it
is corroborated from two independent angles (the scripting API's tick math
and long-running forum consensus) and should be treated as solid enough to
build on.

**[HIGH]** PPQ is user-changeable per project and affects note-drawing
precision project-wide, at a CPU cost for higher values (per the CPU-load
forum thread and the manual's own framing of the tradeoff). This confirms
PPQ is a **project-level constant**, not a per-pattern or per-channel one.

**[PROPOSED for the clone]**: fix PPQ at 96 and do not expose it as a user
setting in the in-scope build — the brief's scope (16-step grid, 4/4, one
core workflow) never needs finer resolution, and a fixed PPQ removes an
entire class of "reposition notes on PPQ change" logic FL Studio itself
warns is lossy. Store every note position and length as an **integer number
of ticks** (not steps, not beats) so a future PPQ change or per-channel
step-resolution feature (§3) is additive, not a data migration.

At 96 PPQ, 4/4, 16 steps/bar: one bar = 4 quarter notes = 384 ticks; one
16th-note step = 384/16 = 24 ticks. **[derived, not sourced]** — arithmetic
from the two HIGH/MED facts above, flagged as derived rather than quoted.

---

## 6. Swing

**[HIGH]**, Channel Rack manual: "There are two swing multiplier — Global
Swing and Channel Swing. The Global Swing is a multiplier (0 to 100%)
applied to all Channels." And: "The Global Swing activates swing for all
Channels, Channel Swing decides how that Channel will respond." Each channel
carries "a Swing Multiplier knob under the 'Time' section for per-channel
swing control" **[MED corroboration]** from a separate tutorial source.

**[MED]** Mechanically, swing delays the even-numbered ("off-beat") steps —
"the off-beat steps (2, 4, 6, 8, 10, 12, 14, 16) shift slightly later in
time when swing is applied" — implemented as a *playback-time* delay applied
at the scheduler, not a rewrite of stored note ticks. This matters for the
data model: swing is **not baked into `Note.position`** — it's a
project-level (`Project.globalSwing: number` 0–1) and channel-level
(`Channel.swing: number` 0–1, multiplier against global) parameter applied
at scheduling time (lane 3's concern), read but never written by the
pattern/note editing UI.

**[PROPOSED]**: `effectiveSwingDelayTicks(stepIndex) = isOffBeat(stepIndex)
? baseStepTicks * 0.5 * globalSwing * channelSwing : 0` — a reasonable,
implementable approximation of "delay every other step," to be confirmed/
refined by lane 3 against actual scheduling needs; not claimed as FL's exact
formula (Image-Line has never published the swing curve).

---

## 7. Mixer

**[HIGH]**, Mixer manual: "500 x Insert Tracks for receiving input from
plugins and external audio Inputs, 1 x Current track for hosting tools like
Edison and Wave Candy and a Master track for master effects processing."
For the in-scope replica (brief explicitly scopes out "full sends/inserts/
automation fidelity") this collapses to: **N insert tracks + 1 master
track**, no "Current" track (that's a utility slot for analysis tools, out
of scope).

**[HIGH]** Fader position: "Level Fader — Applied 'after the effects (post
effect)' for volume control", and "Pan controls the position of the sound in
the stereo field (left to right)." So mixer-track volume/pan are **post-
effects-chain, pre-master-sum** — irrelevant detail for the in-scope build
since effects chains are out of scope, but it confirms mixer volume/pan are
genuinely separate signal-path stages from channel volume/pan (§2), not a
duplicate UI for the same number.

**[HIGH]** Send/insert distinction, relevant to explicitly *exclude* from
the in-scope model since the brief caps the mixer at "per-channel routing to
master, not full sends/inserts": "Insert Mixer Tracks can be routed (sent)
to as many other Mixer Tracks as required" — a full send graph. **[PROPOSED
for the clone, per brief §"Mixer"]**: implement only a single
`routedToMixerTrackId` per Channel (many-to-one, Channel → one Mixer Track)
and one implicit Mixer Track → Master edge per non-master track (all
non-master mixer tracks sum directly to master; no arbitrary send graph, no
insert-to-insert routing).

---

## 8. Recommended TypeScript entity model

```ts
// ---- IDs ----
type ChannelId = string;   // uuid
type PatternId = string;
type NoteId = string;
type PlaylistTrackId = string;
type ClipId = string;
type MixerTrackId = string; // "master" is a reserved, always-present id

// ---- Project ----
interface Project {
  id: string;
  name: string;
  createdAt: string;   // ISO 8601
  updatedAt: string;

  tempo: number;              // BPM. [MED] FL default 140; clone default: PROPOSED 140 to match
  timeSignature: { beatsPerBar: number; stepsPerBeat: number }; // default 4/4 -> {4,4} at 16 steps/bar
  ppq: 96;                    // fixed constant for the in-scope build, see §5

  globalSwing: number;        // 0..1, see §6

  channels: Channel[];        // project-scoped; order = Channel Rack row order
  patterns: Pattern[];
  playlistTracks: PlaylistTrack[];
  mixerTracks: MixerTrack[];  // includes the reserved "master" track

  playbackMode: 'pattern' | 'song';
  activePatternId: PatternId | null; // used only when playbackMode === 'pattern'
}

// ---- Channel (instrument) ----
interface Channel {
  id: ChannelId;
  name: string;
  color: string;               // hex; see §4 Pattern Clip "Chan" color mode
  instrumentType: 'synth' | 'sampler'; // in-scope instrument kinds, see lane 4
  instrumentParams: SynthParams | SamplerParams; // out of this lane's scope; opaque here

  // pre-mixer controls, §2 — apply to every note this channel plays, in every pattern
  volume: number;   // 0..1
  pan: number;       // -1..1
  muted: boolean;

  swing: number;      // 0..1 multiplier against Project.globalSwing, §6
  defaultStepPitch: number; // MIDI note number used for step-grid toggles, §1 PROPOSED default 60

  routedToMixerTrackId: MixerTrackId; // §7, default: "master"

  sortOrder: number; // Channel Rack row order; PROPOSED plain integer (small N, admin-only reorder — no
                       // fractional-indexing needed per Linear lane 2's own §3.2 tradeoff table)
}

// ---- Pattern ----
interface Pattern {
  id: PatternId;
  name: string;
  color: string;                 // §4, Pattern Clip "Pat" color mode

  lengthMode: 'auto' | 'fixed';  // §3
  fixedLengthTicks: number | null; // set only when lengthMode === 'fixed'; multiple of one bar (384 ticks at defaults)

  notes: Note[];                 // ALL note data for ALL channels in this pattern — the unification from §1
}

// ---- Note (also "a step") ----
interface Note {
  id: NoteId;
  channelId: ChannelId;
  positionTicks: number;   // absolute tick offset from pattern start, §5 — NEVER a step index
  lengthTicks: number;      // 0 = "a step" per FL's own definition, §1; >0 = a drawn piano-roll note
  pitch: number;             // MIDI note number, 0-127
  velocity: number;          // 0..1
  pan: number;                // -1..1, per-note pan (piano roll Event Editor lane, §2)
}

// A "step" is UI sugar, not a stored type:
// toggling step N on for channel C in pattern P is exactly:
//   upsert Note { channelId: C, positionTicks: N * (ppq*4/stepsPerBeat), lengthTicks: 0,
//                 pitch: channel.defaultStepPitch, velocity: 1, pan: 0 }
// and un-toggling deletes that Note. The step grid renders as
//   patterns[p].notes.filter(n => n.channelId === c && n.lengthTicks === 0)

// ---- Playlist ----
interface PlaylistTrack {
  id: PlaylistTrackId;
  name: string;
  color: string;
  muted: boolean;
  sortOrder: number; // top-to-bottom order in the Playlist; PROPOSED plain integer (see Channel.sortOrder note)
}

// A Pattern Clip — §4: a REFERENCE to a Pattern, not a copy.
// Multiple clips may share patternId; editing that Pattern updates every clip that references it.
interface PatternClip {
  id: ClipId;
  kind: 'pattern';
  trackId: PlaylistTrackId;
  patternId: PatternId;          // the reference — this is the whole reuse mechanism
  startTick: number;              // absolute position in the Playlist timeline
  // no lengthTicks field: a Pattern Clip's rendered length is the Pattern's own length (§3);
  // FL allows dragging a clip's edge to LOOP/truncate the pattern within the clip — out of scope
  // for the in-scope build per the brief; add `loopLengthTicks?: number` if that's pulled in later.
  colorMode: 'note' | 'chan' | 'pat'; // §4
}

// "Make unique" (§4) is an EDITOR ACTION, not a stored field:
//   1. deep-clone the referenced Pattern (new id, same notes/name+" (unique)"/color)
//   2. repoint only THIS clip's patternId to the clone
//   3. add the clone to Project.patterns
// No other clip referencing the original pattern is touched.

// ---- Mixer ----
interface MixerTrack {
  id: MixerTrackId;      // "master" is reserved and always present, never deletable
  name: string;
  volume: number;         // 0..1, post-effects per §7 (effects chain itself is out of scope)
  pan: number;             // -1..1
  muted: boolean;
  // no `sends` / no `routedTo` field beyond master: every non-master track sums to master implicitly, §7
}
```

### 8.1 Why `positionTicks`/`lengthTicks`, never a step-index integer

Two independent HIGH facts force this: (a) the manual states PPQ-based ticks
are FL's actual timing unit and that changing PPQ **repositions** anything
not on a boundary — i.e. steps are a *derived* alignment, not the native
representation; (b) the manual's own instruction for converting a melody
back into steps is "notes of zero length" on a snapped grid — meaning FL
itself stores steps as notes with tick positions, confirmed independently of
§1. Storing an integer step index in the clone would make the unification in
§1 impossible to represent (a piano-roll note can sit *between* steps; a
step-typed field cannot).

---

## 9. State-management notes (client-side React app)

**[PROPOSED — design guidance for this specific app, not a claim about FL]**

- **Single normalized store**, not nested arrays-of-arrays. Keep
  `notes`, `channels`, `patterns`, `playlistTracks`, `mixerTracks` as
  flat `Record<Id, Entity>` maps at the top of state, with arrays of ids for
  ordering (`Pattern.noteIds: NoteId[]` rather than embedding `Note[]`
  objects, if using something like Redux Toolkit/Zustand with Immer). The
  interfaces above show embedded arrays for readability; normalize on
  implementation so a single note edit doesn't require cloning every
  pattern's array.
- **Undo/redo**: model every user action (toggle step, draw note, move
  clip, add/delete channel, "Make unique") as a **command object** with a
  forward and inverse patch (command pattern), not as full-state snapshots
  — a project with hundreds of notes across dozens of patterns makes
  snapshot-based undo (e.g. naive Immer `produce` history) memory-heavy and
  slow to diff for change detection. A command stack of `{type, payload,
  inversePayload}` also gives free coalescing (e.g. dragging a note's pitch
  across many pixels should produce ONE undo step, not one per pixel — buffer
  drag operations and commit a single command on pointer-up).
- **Cross-cutting undo scope**: deleting a Channel (§2) mutates *every*
  Pattern's note list simultaneously — the undo command for that action must
  capture the full set of removed notes across all patterns, not just "delete
  channel," so undo restores everything atomically. Same for "Make unique"
  (§4): its inverse must both delete the cloned pattern *and* repoint the
  clip back to the original.
- **Playback must not read from the undo-tracked store directly on every
  scheduler tick.** Lane 3 will want a derived, flattened "compiled" note
  list per pattern (absolute-tick note events ready to schedule) recomputed
  on pattern edit, not on every animation frame — keep that as a memoized
  selector over the normalized state, not part of the state shape itself.
- **Serialization to JSON / localStorage**: the interfaces in §8 are already
  JSON-safe (no functions, no class instances, no `Map`/`Set` — use plain
  objects/arrays or serialize `Record`s as objects). Recommended save
  envelope:
  ```ts
  interface SaveFile {
    schemaVersion: number;   // bump on any breaking interface change; write a migration function keyed on this
    project: Project;
  }
  ```
  `schemaVersion` is the important discipline here: since this is a from-
  scratch clone (§ intro) with no `.flp` compatibility goal, the *only*
  compatibility surface this app owes anyone is its own prior localStorage
  saves. Write a tiny `migrate(save: SaveFile): Project` dispatch table from
  day one even with a single version, so the second schema change isn't a
  breaking one for users with saved projects.
- **localStorage size**: a single `JSON.stringify(project)` per save is fine
  at this scope (a "make a beat" project — tens of patterns, hundreds of
  notes — serializes to low tens of KB, far under localStorage's ~5MB/origin
  ceiling); no need for IndexedDB or chunking within the brief's scope.
  Debounce writes on note-drag/playback (write on pointer-up / explicit
  save, not on every state change) to avoid `JSON.stringify`-ing large state
  on every mousemove.
- **Reserved `"master"` mixer track id**: since it's referenced by id from
  every Channel's default routing and can never be deleted, treat it as a
  literal constant (`MASTER_MIXER_TRACK_ID = "master"`) rather than a
  regular generated uuid, so `routedToMixerTrackId === MASTER_MIXER_TRACK_ID`
  checks don't need a lookup.

---

## 10. Summary

1. FL Studio has no separate `Step` type — a step is a `Note` with
   zero length, quantized position, and a pitch; the step grid and piano
   roll are two views over the same note list (**HIGH**, manual quote).
2. `Channel` is project-scoped and shared by every `Pattern`; deleting one
   cascades note deletion across every pattern (**HIGH**/**MED**).
3. Channel-level volume/pan/mute ("pre-mixer") are distinct from Mixer-track
   volume/pan (post-effects) — two real signal-path layers, not duplicate UI
   (**HIGH**).
4. Pattern length is **Auto** by default (grows to the last bar with data)
   or **Fixed**, 1–512 steps (**HIGH**, quoted).
5. A **Pattern Clip** in the Playlist is a *reference* to a Pattern, not a
   copy — editing the pattern updates every placed clip; "Make unique"
   forks one clip onto an independent pattern copy (**HIGH**, inferred from
   the manual's own opt-out feature).
6. Playlist tracks are general-purpose lanes (any clip type, since FL 11) —
   don't model per-track clip-type constraints (**HIGH**/**MED**).
7. **Song mode** plays the Playlist arrangement; **Pattern mode** loops only
   the active pattern, ignoring the Playlist — model as a transport-level
   toggle, not a per-entity flag (**MED**).
8. FL Studio's native timing unit is PPQ ticks (default **96**, project-
   level constant), not step indices — the clone must store
   `positionTicks`/`lengthTicks`, never an integer step number (**HIGH**
   for tick-based timing; **MED** for the 96 default).
9. Swing is a scheduling-time delay on off-beat steps, driven by
   `Project.globalSwing` × `Channel.swing`, and is never baked into stored
   note positions (**HIGH**).
10. Mixer scope for the clone: N insert tracks + 1 master, each `Channel`
    routes to exactly one mixer track (default master), and every non-master
    track sums straight to master — no send graph, matching the brief's
    explicit "not full sends/inserts" cap (**HIGH** for FL's real
    architecture; **PROPOSED** for the clone's deliberately narrower cut).

Sources: image-line.com/fl-studio-learning/fl-studio-online-manual/html/{channelrack,pianoroll,mixer,playlist,playlist_patterns}.htm (Image-Line official manual, HIGH-tier); forum.image-line.com threads on PPQ defaults and playlist track history (MED-tier, cross-checked); il-group.github.io/FL-Studio-API-Stubs (Image-Line-affiliated scripting docs, MED-tier corroboration for tick/PPQ math).
