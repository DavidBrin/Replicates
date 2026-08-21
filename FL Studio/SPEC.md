# FL Studio — Specification

> **toggle sixteen steps, press space, and it's a beat**

A browser rebuild of **FL Studio's core sequencing loop** — Channel Rack, Piano Roll,
Playlist, minimal Mixer — with every sound synthesized from Web Audio primitives,
because there is no legitimate way to ship Image-Line's (lane 4 §1). The visuals are
reproduced from measured values (lane 1), the domain model from observed behavior
(lane 2), and the scheduler from the pattern every working browser sequencer uses
(lanes 3, 5).

This document is the contract the implementation is built against. Evidence lives in
[`research/`](research) — implementers should not need to reopen it except for visual
detail: **each UI surface's builder must read lane 1's section for that surface**
(`research/01-visual-interaction-design.md`) before drawing anything.

Not affiliated with or endorsed by Image-Line. No FL Studio assets, skins, icons,
samples, or binaries are used or shipped (lane 4 §2).

---

## 1. Goal and scope

The whole project passes or fails on one loop (lane 6, cut rule):

> Program a 16-step drum pattern, add a bassline in the piano roll, arrange two
> patterns into a song, hear it through a master fader, save it, reload it.

### 1.1 In / out by surface

Condensed from lane 6's tables; acceptance criteria are lane 6's, normative here.

**Channel Rack** (lane 6 §1)

| IN | Acceptance |
|---|---|
| Add/rename/delete/reorder channels | Add picks a voice kind; delete cascades note deletion across all patterns, undoably (lane 2 §2) |
| 16-step grid: left-click adds, right-click deletes | Toggle inserts/removes a zero-length Note at that step's tick (lane 2 §1); renders immediately |
| Per-channel mute LED, pan knob, volume knob | Muted channel renders steps but plays nothing; Alt-click resets knobs to default (lane 1 §1.4) |
| 4-step cool/warm hue grouping on cells | Steps 1–4/9–12 cool slate, 5–8/13–16 warm rose per lane 1 §2.4 |
| Pattern selector (name + prev/next/add) | Switches which Pattern the rack edits; shared with the toolbar |
| Channel name click → opens Piano Roll for that channel | Substitute for FL's "opens the plugin" (lane 6 §1 item 9) |
| Mixer-routing box per row | Shows/edits `routedToMixerTrackId`; default master |

OUT: Graph Editor / per-step velocity lanes, per-channel swing, inline piano-roll
preview strip, filter groups, cloning/grouping, error-state red buttons, pattern
length other than 16 steps (lane 6 §1 items 12–17).

**Piano Roll** (lane 6 §2)

| IN | Acceptance |
|---|---|
| Draw tool: left-click adds a note | Default length = current snap unit; default velocity 100/127 (lane 1 §3.7) |
| Right-click deletes | Single click removes the note under the cursor |
| Right-edge drag-to-resize | Snapped unless Alt held; left-edge resize stays off, matching FL's default (lane 1 §3.5) |
| Drag to move (pitch + time) | Shift locks pitch, Ctrl locks time (lane 1 §3.5) |
| Velocity: Alt+wheel over a note | Required minimum; the below-grid stem lane is a stretch goal |
| Snap selector (Bar / Beat / 1/2 Beat / 1/4 Beat / off) | Alt bypasses per gesture; `Backspace` toggles (lane 1 §3.4) |
| Scroll + zoom both axes | Usable at full-pattern and single-bar zoom |
| Keyboard preview column | Clicking a key plays that pitch through the channel's voice |
| Black/white row shading, beat column shading, note name labels | Per lane 1 §3.2–3.3 measured values |

OUT: Event Editor's non-velocity properties, ghost notes, MIDI-channel note colors,
slide/porta, chord/arp/strum tools, slice, slip edit (lane 6 §2 items 11–15).

**Playlist** (lane 6 §3)

| IN | Acceptance |
|---|---|
| Pattern picker panel | Lists patterns by name/color; selects the clip to paint |
| Paint clips (left-click), erase (right-click), drag to move | Snapped placement of `PatternClip`s referencing the selected pattern |
| Shared-reference reuse — **must be visibly true** | Place one pattern twice, edit it in the rack: both clips' miniatures update (lane 2 §4) |
| "Make unique" on a clip's context menu | Forks the pattern for that one clip only, per lane 2 §8's exact algorithm |
| Track headers: name, color, mute | Muting silences that track in song mode |
| Playhead + horizontal scroll/zoom | Tracks song-mode position |
| Clip rendering: header strip + live miniature of the pattern's notes | Lane 1 §4.2 — a flat labeled rectangle is the classic replica failure |

OUT: audio clips, automation clips, slip/slice, time markers, 1:1 track mode,
NOTE/CHAN/PAT color-mode toggle, track-height drag (lane 6 §3 items 10–15).

**Mixer** (lane 6 §4)

| IN | Acceptance |
|---|---|
| N insert strips (default 8) + always-present Master | Master undeletable, id `"master"` (lane 2 §8) |
| Fader, pan, mute per strip | Unity position marked; fader handle turns orange off-default (lane 1 §5.2) |
| Live peak meter per strip | AnalyserNode tap (lane 3 §5); green body, yellow top per lane 1 §5.2 hexes |
| Master clip indicator (master only) | Only Master can clip (lane 1 §5.4); limiter sits on master only |

OUT: 10-slot FX ladder (not even inert chrome), send graph, phase/stereo/latency/
record-arm, rotated vertical labels, routing view (lane 6 §4 items 9–13).

**Transport / toolbar** (lane 6 §5)

IN: Play/Stop (Play is the AudioContext-creating first gesture), Pattern/Song switch,
BPM display (drag + type-in, live-safe), pattern selector, global swing slider,
undo/redo, window toggles, metronome toggle, Save/Load, Export WAV, JSON
export/import. OUT: record, MIDI input, time panel, CPU panel, full menu bar.

**Persistence** (lane 6 §6): save/load one project in `localStorage` under a
versioned envelope, "new project" reset, JSON file download/import. OUT:
multi-project library, cloud sync, `.flp` compatibility (never; lane 2 intro).

**Undo/redo** (lane 6 §7): cross-cutting and mandatory — every mutating action above
has an inverse on the command stack; `Ctrl+Z` / `Ctrl+Shift+Z` (accept `Ctrl+Y`)
work from any window.

### 1.2 The five OPEN items — decided

Lane 6 flagged five items OPEN with recommendations. Each recommendation is
**adopted as-is**; these are settled, not to be relitigated:

| # | Item | Decision |
|---|---|---|
| D1 | Metronome | **IN.** Playback-aid click on each beat, synthesized from the existing noise primitives (lane 6 §5 item 10). |
| D2 | Export WAV | **IN.** One "Export WAV" button rendering the song-mode arrangement through `OfflineAudioContext`. If it demands re-plumbing beyond the live graph, it defers to a follow-up rather than blocking v1 (lane 6 §5 item 11). |
| D3 | JSON file export/import | **IN.** Download/import the same `SaveFile` envelope used for localStorage (lane 6 §6 item 5). |
| D4 | "Make unique" | **IN.** Clip context-menu action; algorithm verbatim from lane 2 §8 (clone pattern → repoint this clip only → single undoable command). |
| D5 | Rotated vertical mixer label | **CUT.** Horizontal strip labels; revisit only as visual-fidelity polish (lane 6 §4 item 12). |

Sub-OPEN recommendations in lane 6's tables are likewise adopted: pattern length
fixed at 16 steps for v1 (unblocked in the data model), clip color always =
`Pattern.color` (no NOTE/CHAN/PAT toggle), no time markers, toolbar master volume
collapsed into the Master strip's fader (one control, not two), menu reduced to
toolbar buttons (no eight-menu bar), single-project persistence with a namespaced
key (`fl-studio:project:v1`).

---

## 2. Domain model

Adopted from lane 2 §8 with the D-decisions above applied. Four load-bearing facts:

1. **Steps ARE notes** (lane 2 §1, HIGH). There is no `Step` entity. A step-grid
   toggle upserts/deletes a `Note` with `lengthTicks: 0` at a quantized position;
   the grid and the piano roll are two views over `Pattern`'s notes.
2. **Tick-based timing, PPQ 96, fixed** (lane 2 §5). Positions and lengths are
   integer ticks, never step indices. At 96 PPQ in 4/4: 1 bar = 384 ticks,
   1 sixteenth step = 24 ticks. PPQ is a constant, not a setting.
3. **Pattern clips are references** (lane 2 §4). Editing a pattern updates every
   placed clip; "Make unique" is the only fork.
4. **Two volume/pan layers** (lane 2 §2). Channel volume/pan are pre-mixer (shape
   the voice); mixer-track volume/pan are a later bus stage. Never merge them.

```ts
// src/domain/types.ts — the seam file every slice imports
export type ChannelId = string; export type PatternId = string;
export type NoteId = string; export type PlaylistTrackId = string;
export type ClipId = string; export type MixerTrackId = string;

export const PPQ = 96;
export const TICKS_PER_STEP = 24;      // PPQ * 4 beats / 16 steps
export const TICKS_PER_BAR = 384;
export const PATTERN_LENGTH_TICKS = 384; // v1: every pattern is one 4/4 bar (D-sub, §1.2)
export const MASTER_MIXER_TRACK_ID: MixerTrackId = "master";
export const DEFAULT_VELOCITY = 100 / 127; // lane 1 §3.7 (MED); steps AND drawn notes.
// Spec decision: deliberately overrides lane 2 §8's velocity:1.0 step-upsert example — one constant everywhere.

export interface Project {
  id: string; name: string; createdAt: string; updatedAt: string;
  tempo: number;                 // BPM, default 140 (lane 2 §8), clamp 10–522 (lane 1 §1.2)
  globalSwing: number;           // 0..1 (lane 2 §6)
  channels: Record<ChannelId, Channel>;   channelOrder: ChannelId[];
  patterns: Record<PatternId, Pattern>;   patternOrder: PatternId[];
  playlistTracks: Record<PlaylistTrackId, PlaylistTrack>; playlistTrackOrder: PlaylistTrackId[];
  clips: Record<ClipId, PatternClip>;
  mixerTracks: Record<MixerTrackId, MixerTrack>; mixerTrackOrder: MixerTrackId[];
  playbackMode: "pattern" | "song";
  activePatternId: PatternId;    // the pattern the rack/roll edit; the loop source in pattern mode
}

export type VoiceKind = "kick" | "clap" | "hatClosed" | "hatOpen" | "snare" | "bass" | "lead";

export interface Channel {
  id: ChannelId; name: string; color: string;
  voice: VoiceKind;              // lane 4 §3's synthesis-only instrument set
  volume: number;                // 0..1 pre-mixer (lane 2 §2), default 0.8
  pan: number;                   // -1..1
  muted: boolean;
  defaultStepPitch: number;      // MIDI note for step toggles; default 60 (lane 2 §1 PROPOSED)
  chokeGroup?: string;           // engine choke rule, §3.3; default project: hatClosed+hatOpen in "hats"
  routedToMixerTrackId: MixerTrackId; // default "master" (lane 2 §7)
}

export interface Pattern {
  id: PatternId; name: string; color: string;
  notes: Record<NoteId, Note>;   // ALL channels' notes for this pattern (lane 2 §1)
}

export interface Note {
  id: NoteId; channelId: ChannelId;
  positionTicks: number;         // from pattern start; NEVER a step index (lane 2 §8.1)
  lengthTicks: number;           // 0 = a step (FL's own definition, lane 2 §1)
  pitch: number;                 // MIDI 0–127
  velocity: number;              // 0..1
}

export interface PlaylistTrack { id: PlaylistTrackId; name: string; color: string; muted: boolean; }

export interface PatternClip {
  id: ClipId; trackId: PlaylistTrackId;
  patternId: PatternId;          // the reference — the entire reuse mechanism (lane 2 §4)
  startTick: number;             // absolute timeline position
}

export interface MixerTrack { id: MixerTrackId; name: string; volume: number; pan: number; muted: boolean; }

export interface SaveFile { schemaVersion: 1; project: Project; }
```

Refinements vs. lane 2's sketch, each deliberate: entities are **normalized**
(`Record<Id, T>` + order arrays) per lane 2 §9 rather than nested arrays;
`Note.pan` is dropped (per-note pan is OUT, lane 6 §2 item 11); `Channel.swing`
is dropped (per-channel swing OUT, lane 6 §1 item 13); `Pattern.lengthMode` /
`fixedLengthTicks` are deferred with the constant `PATTERN_LENGTH_TICKS` — the
tick representation keeps variable length additive later (lane 2 §3);
`PatternClip.colorMode` is dropped (D-sub: clips always render `Pattern.color`);
`instrumentParams` collapses to `voice: VoiceKind` because all voices are
hand-built presets (lane 4 §3), not user-editable synths.

### 2.1 Commands and undo/redo

Command pattern, per lane 2 §9. Every mutation is a `Command` with `apply(project)`
and `invert(projectBefore)` producing the inverse. Rules:

- **Drag coalescing:** knob drags, note moves/resizes, and clip drags buffer
  during the gesture and commit **one** command on pointer-up.
- **Cross-cutting atomicity:** `deleteChannel` captures the removed notes from
  every pattern in one command; `makeUnique`'s inverse deletes the cloned pattern
  and repoints the clip back. One `Ctrl+Z` restores everything.
- The undo stack lives outside the persisted `Project` and is capped at 200
  entries (engineering default, uncited).
- Playback reads a **memoized compiled event list** (absolute-tick note events per
  pattern), recomputed on edit — never walked from raw state per scheduler tick
  (lane 2 §9; lane 5 §2's store→scheduler one-way rule).

### 2.2 Persistence

`SaveFile { schemaVersion, project }` to `localStorage["fl-studio:project:v1"]`.
A `migrate(save): Project` dispatch table exists from day one, even as v1→v1
identity (lane 2 §9). Writes are debounced and never fire mid-drag. Load on boot;
absent/corrupt saves fall back to the **default project**: channels Kick, Clap,
Hat, Snare (step channels) + Bass and Lead (melodic), one empty pattern, two
playlist tracks, 8 insert strips + master, 140 BPM. JSON export downloads the same
envelope; import validates `schemaVersion` and replaces state (undoably).

---

## 3. Audio engine

Architecture from lane 3, verbatim where it made a recommendation.

### 3.1 Boot: lazy, gesture-gated

Nothing audio exists until the first Play (or keyboard-preview) gesture. The
lifecycle is exactly: first gesture → dynamic `import()` of Tone.js and the
engine module → `await Tone.start()` (which creates *and* resumes the context) →
every native voice/mixer node is constructed against
`Tone.getContext().rawContext`. **One context, one clock** — never a manual
`new AudioContext()` anywhere. This one code path satisfies both Chrome's
autoplay policy and Next SSR safety (lane 3 §3, lane 7 §1). Audio modules are
`"use client"`-only and never touch audio globals at module scope or render time.
Guard every play with `if (ctx.state !== "running") await ctx.resume()`.

### 3.2 Transport and scheduling

- **Tone.js `Transport`** is the single clock (lane 3 §2): BPM as a live-settable
  signal, start/stop/seek, `loopStart`/`loopEnd` for pattern-mode looping. Pin the
  version at implementation time; ~75 KB gzip is acceptable behind the dynamic
  import (lane 3 §2; this figure, from Bundlephobia, supersedes lane 7 §4's ~20 KB
  secondary-source guess).
- **One transport, two enqueue paths, same clock** (lanes 3 §2, 5 §2): step notes
  and free-timed piano-roll notes are both scheduled from the compiled event list
  against Transport ticks — do not give any surface a private clock.
- **Every voice trigger uses the scheduler's `time` argument** — never `Tone.now()`
  or `Date.now()` inside a callback (lane 5 §2, the API-level lesson).
- **Song vs. pattern mode:** pattern mode loops `activePatternId` over
  `PATTERN_LENGTH_TICKS`; song mode compiles the playlist (each clip contributes
  its pattern's events offset by `startTick`, muted tracks excluded) and loops the
  arrangement end. Toggling `L` re-arms the transport source.
- **Swing at scheduling time only** (lane 2 §6): notes on off-beat 16th positions
  get `delayTicks = TICKS_PER_STEP * 0.5 * globalSwing` added when scheduled.
  Stored ticks are never rewritten.
- **Stop over pause:** the Stop button (and Space) uses `Transport.stop()` +
  fresh `start()`, not rapid `pause()`/`start()` cycling (lane 3 §2's issue-#370
  caveat).
- **Worker tick, if needed:** Tone's transport already runs its clock off the main
  thread's throttling path; if backgrounded-tab drift is observed in practice,
  move the tick to a Web Worker timer per lane 3 §1a/§6 — that is the sanctioned
  fix. AudioWorklet is explicitly not used (lane 3 §1a).

### 3.3 Voices — hand-built native nodes

Tone.js is used for transport/scheduling and mixer-chain plumbing only. **Voices
are built directly on native `OscillatorNode` / `GainNode` / `BiquadFilterNode` /
`AudioBufferSourceNode`** — no `Tone.Synth`/`MembraneSynth` presets (lane 3 §2 net
recommendation; keeps the sound and the licensing posture ours, lane 4 §3). No
sample files ship; a single shared white-noise `AudioBuffer` is generated once
(lane 3 §7).

Recipes — kick/snare/hats per lane 3 §7; clap/bass/lead and the choke behavior
per lane 4 §3. Parameters are starting points, tune by ear:

| Voice | Recipe |
|---|---|
| **kick** | Sine osc, pitch env ~150→40 Hz exponential over ~150 ms, fast-attack (~10 ms) exponential amp decay ~100–150 ms; optional 1–2 ms noise click |
| **clap** | 3–4 layered ~10 ms noise bursts, slightly offset, bandpass ~1–2 kHz, fast decay |
| **hatClosed** | Highpassed noise (~7 kHz+), decay ~30–50 ms |
| **hatOpen** | Same chain, decay ~200–300 ms; choking is the cross-channel choke-group rule below, not an intra-channel behavior |
| **snare** | Two detuned triangle/sine oscs ~180–200 Hz short-decay body + bandpassed noise buzz layer |
| **bass** | Subtractive: saw/square → lowpass with envelope-modulated cutoff → amp ADSR; optional −1-octave sine sub |
| **lead** | 1–2 detuned oscs → filter → ADSR, polyphonic for piano-roll parts |

Voice management (lane 3 §4): fixed pool per channel (8 voices), **oldest-voice
(FIFO) stealing**; every note-off and every steal releases via
`setValueAtTime(current, now)` then `linearRampToValueAtTime(0, now + release)`
before `stop()` — never a hard cut (click avoidance). Anchor with
`setValueAtTime` before every ramp.

**Choke groups:** triggering any voice on a channel with a `chokeGroup` releases
(ramped, never hard-cut) the ringing voices of *other* channels in the same
group. The default project puts hatClosed and hatOpen in group `"hats"`, so a
closed hat chokes a ringing open hat (lane 4 §3's 808 choke behavior).

### 3.4 Signal chain and metering

Per lane 3 §5, exactly:

```
voice → channel GainNode (Channel.volume·velocity) → StereoPannerNode (Channel.pan)
      → mixer-track GainNode+Panner (MixerTrack.volume/pan)
      → master GainNode → DynamicsCompressorNode (limiter: low threshold, high ratio)
      → AudioContext.destination
```

`AnalyserNode` taps hang in parallel off each mixer track and the master (post-
limiter for the clip light) — reads via `getFloatTimeDomainData()` per animation
frame, never inline in the chain. Channel/track mutes are gains to 0 (ramped).
Only the master shows a clip indicator (lane 1 §5.4). The metronome is a tiny
scheduled click voice on the master bus, bypassing mixer strips.

### 3.5 Export WAV (D2)

Rebuild the song-mode compiled event list against an `OfflineAudioContext` of the
arrangement's length, reusing the same voice constructors (they take a
`BaseAudioContext`), render, encode 16-bit PCM WAV, download. Pattern mode
exports one loop of the active pattern.

---

## 4. UI architecture

### 4.1 Layout: fixed docked windows (lane 6 §8 — adopted)

No floating/draggable windows. A fixed grid under a single toolbar:

```
┌──────────────────────────────────────────────────────────────┐
│ Toolbar: transport · BPM LCD · swing · pattern selector ·    │
│          undo/redo · window toggles · save/export            │
├──────────────────────────────┬───────────────────────────────┤
│ Playlist (top left, wide)    │ Mixer (right rail)            │
├──────────────────────────────┤                               │
│ Channel Rack ⇄ Piano Roll    │                               │
│ (tabbed region — F6/F7 pick) │                               │
└──────────────────────────────┴───────────────────────────────┘
```

Each region keeps FL's window chrome *idea*: a slim title bar reading
`Channel rack`, `Piano roll - <channel>`, etc. (lane 1 §1.1). `F5`/`F6`/`F7`/`F9`
focus/toggle regions (lane 1 §9); hiding Playlist or Mixer collapses its region.
Layout/focus state is ephemeral UI state, never persisted in `Project` (lane 6 §8).

### 4.2 Rendering technology per surface

- **Channel Rack: DOM.** Tens of channels × 16 steps is trivial (lane 5 §7 and
  mistakes-to-avoid item 4).
- **Playlist: DOM.** Viable at make-a-beat scale (lane 5 §6); clip miniatures are
  small `<canvas>` elements or SVG inside DOM-positioned clips.
- **Piano Roll: one `<canvas>` 2D, imperative.** Painted from a `ref` +
  `requestAnimationFrame`-on-dirty; React owns the surrounding chrome only.
  **Never** react-konva/react-pixi or any per-note React component — measured
  slower than DOM (lane 5 §3). Choosing Canvas 2D over WebGL is **this spec's
  own decision, deviating from Signal's WebGL choice** (lane 5 §3) at full-DAW
  scale: our note density is a beat-loop's, not a multi-track MIDI editor's,
  and only the playhead animates continuously. Profile once the roll exists;
  WebGL behind the same painter interface is the escape hatch.

### 4.3 Measured visual constants (lane 1 — normative)

Theme is a token sheet (CSS custom properties), never hard-coded hexes in
components — FL itself is themeable (lane 1 §6). Core tokens (lane 1 §6.1):

| Token | Value |
|---|---|
| workspace | `#475056` · window chrome/title bars `#4E585E` |
| rack body | `#727C81` · deep recess `#2D3438` |
| piano-roll lanes | white-key `#42545F`, black-key `#394B56`, beat band `#32444F` |
| gridlines (3 weights) | step `#394B56` < beat `#2E404B` (flank `#3E4F5A`) < bar `#1A2C37` |
| ruler | `#2A363F` (roll) / `#2B3840` (playlist) · playlist lane `#3A4C57` |
| note block | body `#BCF1C6`, top edge `#C6FBD0`, shadow `#83AB89`, right grip `#4E8756` (~9 px) |
| step cells | cool OFF `#6E7579` / ON `#D2E4EF`; warm OFF `#806D6E` / ON `#FFCED0`; outline `#5E676C` |
| LEDs / selection green | `#A8E1B0`/`#B8F0BF` · accent orange `#FFD27C` over `#FF8A00` glow |
| LCD plate | `#E6F7FF`→`#E1F1F9`, dark navy digits (light-on-dark inversion, lane 1 §1.3) |
| mixer meter | green `#AAFD43`, yellow `#FEFE3F`, trough `#3B4D5F`; fader default pale `#C6CDD1`, off-default orange `#F0A020` |
| text | `#D8E1E6` / `#BDC2C6`; error red `#C0392B`-family |

Geometry — ratios are HIGH, absolutes indicative (lane 1 §2.3 caveat); adopt the
absolutes as our 100% zoom:

- **Step cell 20×32 px** (portrait ~1:1.6 — *not square*), 4 px gutter, 24 px step
  pitch, **45 px channel row pitch**. Cells render as soft 3-D switches: bright
  1–2 px top cap, vertical gradient, dark bottom lip (lane 1 §2.3–2.4).
- **Piano roll: ~21 px semitone rows, ~104 px keyboard column** at default zoom;
  white keys gradient `#D9DDE5`→`#FFFFFF` left-to-right, black keys `#494A4C`
  inset bars (lane 1 §3.2). Notes are square-cornered rectangles with the darker
  right-edge resize grip and a truncating note-name label at the left (lane 1 §3.3).
- **Playlist clips: 1-line header strip (icon + name) + live miniature body** of
  the pattern's notes at real pitch/time (lane 1 §4.2, §10.4).
- Typography: one condensed grotesque (Barlow Semi Condensed or Roboto Condensed —
  lane 1 §7 stand-ins), light-on-dark, ALL-CAPS letter-spaced only in the toolbar;
  italic = disabled. Icons: flat monochrome ~16 px line glyphs, drawn ourselves —
  FL's `flicon_*.png` files are shape reference only, never shipped (lane 1 §7).
- Channel/pattern/track color picker: an invented safe palette, HSL-clamped
  S 35–60%, L 45–65% (lane 1 §11), plus a "random color" action.

### 4.4 Interaction vocabulary (lane 1 §8–9 — normative)

The three primitives lane 1 §10 ranks first are non-negotiable: **right-click =
delete everywhere; middle-drag = 2-axis pan and Ctrl+wheel = zoom-at-cursor in
roll and playlist; `L` flips Pattern/Song and audibly changes what plays.**

| Gesture | Meaning (surfaces) |
|---|---|
| Left-click | draw/add/activate (step, note, clip) |
| Left-click-drag on fresh click | reposition before release |
| Right-click | delete (content areas); context menu (chrome/non-content) |
| Right-click-drag | delete multiple |
| Shift+Left-click on item | clone selection (roll, playlist) |
| Ctrl+Left-click / +Shift | select / add to selection |
| Right-edge drag | resize note/…; left edge inert |
| Middle-drag | pan both axes (roll, playlist) |
| Ctrl+wheel | horizontal zoom at cursor (roll, playlist) |
| Alt held | bypass snap for this gesture |
| Alt+wheel over note | velocity |
| Shift / Ctrl during note drag | lock pitch / lock time |
| Alt+click (or middle-click) knob | reset to default; Ctrl-drag = fine |
| Double-left-click note/clip | properties (name/color where applicable) |

Keyboard (lane 1 §9): `Space` play/stop · `L` pattern/song · `Ctrl+H` panic ·
`F5` Playlist · `F6` Rack · `F7` Roll · `F9` Mixer · `Ctrl+Z` undo ·
`Ctrl+Shift+Z`/`Ctrl+Y` redo (lane 6 §7 / standard convention — lane 1 §9
documents only `Ctrl+Z`/`Ctrl+Alt+Z`) · `Backspace` snap toggle · `Ctrl+A`/`Ctrl+D`
select/deselect all · `Del` delete selection · `F4` next empty pattern · `F2`
rename current pattern · `Ctrl+S` save · `Ctrl+↑/↓` transpose octave (roll) ·
`1..9,0` mute channels 1–10, `Ctrl+1..9,0` solo · `↑/↓` channel select ·
`PgUp/PgDn` zoom. Browser-conflicting keys (`Ctrl+S`, F-keys) call
`preventDefault` while the app has focus.

---

## 5. State management

**zustand** (`^5.0.15`, the pinned sibling version — lane 7 §0; siblings already
use it, no justification needed for an alternative). One client-side store:

- **Domain slice** — the normalized `Project` of §2, mutated **only** by
  dispatching domain commands (`store.dispatch(cmd)` applies + pushes undo).
  Components never write domain fields directly.
- **Non-undoable navigation:** writes to `activePatternId` and `playbackMode`
  are persisted domain state but bypass the command/undo stack entirely —
  they are navigation, not edits, so switching patterns or flipping `L` never
  floods (or pollutes) undo.
- **Ephemeral UI slice(s)** — selection sets, hover, active tool, snap setting,
  zoom/scroll offsets, drag-in-progress state, focused window, transport UI
  position. Separate from the domain slice and excluded from persistence —
  Signal's MobX/Jotai split precedent (lane 5 §3; lane 6 §8). Zustand serves both;
  the boundary is the slice, not the library.
- **Composition (the seam mechanism):** `src/lib/store.ts` (slice A) is a
  **composer**, not a monolith. It defines the domain slice + dispatch/undo and
  spreads surface-contributed UI slices. Each surface owns
  `src/components/<surface>/uiState.ts`, exporting a typed zustand slice
  creator — `const createPianoRollUi: StateCreator<AppState, [], [],
  PianoRollUiSlice>` — plus its slice interface. Registering a slice is one
  import + one spread line in the composer, requested from slice A via the
  orchestrator; no other slice edits `store.ts`.
- Playback position for playheads comes from a rAF loop reading the Transport,
  not from store subscriptions per tick.
- Derived data (compiled event lists, per-pattern miniatures) are memoized
  selectors, not stored state (lane 2 §9).

---

## 6. Module layout and layering

```
src/
  domain/        pure logic — NO React, Next, Tone, or browser APIs
    types.ts         entities + constants (§2) — the seam file
    commands/        every Command + apply/invert + coalescing
    tickMath.ts      step↔tick, snap, swing-delay, arrangement-length math
    compile.ts       Project → compiled note-event lists (pattern & song mode)
    serialization.ts SaveFile envelope, migrate(), validation
    defaultProject.ts
  audio/         engine — imports domain ONLY (+ Tone.js, Web Audio)
    engine.ts        boot (lazy ctx), transport wiring, play/stop/mode/seek
    scheduler.ts     compiled events → Transport scheduling, swing, metronome
    voices/          kick.ts clap.ts hats.ts snare.ts bass.ts lead.ts noise.ts voicePool.ts
    mixerGraph.ts    channel→track→master chain, AnalyserNode taps
    exportWav.ts     OfflineAudioContext render (D2)
  lib/
    store.ts         zustand COMPOSER (§5): domain slice + dispatch/undo,
                     spreads surface-owned uiState slices
    theme.css        GLOBAL design tokens only (§4.3) [imported by globals.css];
                     per-surface tokens live in a surface-owned CSS file
    keyboard.ts      binding REGISTRY (§4.4): surfaces call registerBindings()
                     from their own modules
  components/
    shell/           docked layout, window chrome, toolbar mount points
    transport/       play/stop, mode switch, BPM LCD, swing, pattern selector, save/export
    channel-rack/    rows, step grid, knobs/LEDs, routing box
    piano-roll/      canvas painter, interaction controller, keyboard column, snap UI
    playlist/        tracks, clip painting, picker panel, miniatures
    mixer/           strips, faders, meters (rAF), clip light
  app/           routes, page shell (server components stay trivial)
```

**Layering rule (enforced):** `src/domain` imports nothing from React, Next,
Tone.js, zustand, or any browser API; `src/audio` imports only `src/domain` (+
Tone/Web Audio); `src/components` and `src/lib` may import both; nothing imports
from `src/app`. A unit test (`src/domain/layering.test.ts`) walks the import
graph and fails on violation — same guard as super-smash's `engine/layering.test.ts`.

Config obligations (lane 7 §5, HIGH): keep `next.config.ts`'s `turbopack.root`
pinned via `fileURLToPath(new URL(".", import.meta.url))` and use `fileURLToPath`
(never `URL.pathname`) anywhere a config resolves paths — the repo path contains
spaces. The local half of lane 7's flagged space-in-path risk is **retired**:
the scaffold has already run `pnpm build` and the Playwright e2e suite green
under this path. What remains is one deployment-checklist item — verify
Vercel's root-directory setting handles the space at first deploy. Root
configs (`next.config.ts`, `vitest.config.mts`, `playwright.config.ts`) are
**owned by slice A**; every other slice requests config changes via the
orchestrator and never edits them.

---

## 7. Test strategy

Stack is already scaffolded (Vitest 4 + jsdom, Playwright, `pnpm verify`) — see
`package.json` and lane 7 §0; do not respec it.

**Unit — domain (the bulk):** tick math (step↔tick, snap rounding, swing delay,
song-length computation); every command's apply/invert round-trip (`invert(apply(p))
≡ p`), including the cross-cutting ones (channel delete restores notes across all
patterns; makeUnique inverse removes the clone); step-toggle ≡ zero-length-note
upsert/delete; compile.ts output for pattern and song mode (clip offsets, muted
tracks excluded, shared patterns compiled once per placement); serialization
round-trip + migrate dispatch + corrupt-input fallback.

**Unit — audio:** scheduling *decisions* against a **hand-rolled AudioContext
stub** aliased in `vitest.config.mts` (lane 7 §2's recommendation at our node-type
count): assert which events get scheduled for a window, that swing offsets apply
at schedule time, that voice pools steal oldest and always ramp before stop, and
that the mixer graph wires channel→track→master→limiter as specced. jsdom has no
Web Audio (lane 7 §2); nothing real renders in unit tests.

**Component (where cheap):** step-cell toggle dispatches the right command;
transport buttons flip mode; knob drag coalesces to one undo entry; pattern
selector switches `activePatternId`. Skip canvas internals — the piano-roll
painter is covered by domain math + e2e.

**Playwright e2e — the beat-making loop** (reuse `youtube`'s
`--autoplay-policy=no-user-gesture-required` launch flag, lane 7 §2):

1. Toggle four kick steps → press Space → playhead advances, `AudioContext`
   reports `running`, step-highlight follows the transport.
2. Open the Piano Roll for Bass → draw, resize, move, re-velocity notes → hear
   playback in pattern mode; right-click deletes.
3. Paint the pattern twice in the Playlist, switch to Song mode with `L` →
   playhead traverses both clips; edit the pattern → both miniatures update
   (reference semantics, visibly).
4. Undo/redo across surfaces restores exact prior state.
5. Save → reload page → project persists; JSON export downloads; import restores.
6. Mixer: drop a fader → channel audibly/measurably attenuates (assert via a
   page-evaluated analyser reading, not by ear).

---

## 8. Work-stream decomposition (parallel build agents)

Seven slices. **File ownership is disjoint** — a slice writes only inside its
listed paths (plus its own tests). Seams are extended by **composition, never
co-editing**:

- `src/lib/store.ts` (A) is the composer of §5 — a UI slice lands its own
  `uiState.ts` in its surface directory and requests the one-line registration
  from A via the orchestrator.
- `src/lib/theme.css` (C) holds global tokens only; per-surface tokens live in
  a CSS file inside the surface's own directory, imported from that surface's
  own components — nothing per-surface goes into the global sheet.
- `src/lib/keyboard.ts` (C) is a binding registry; each surface calls
  `registerBindings()` from its own module with its own bindings.
- Root configs (`next.config.ts`, `vitest.config.mts`, `playwright.config.ts`)
  are owned by A (§6); other slices request changes via the orchestrator.

| Slice | Deliverables | Paths owned | Depends on | Model tier |
|---|---|---|---|---|
| **A — Domain + store** | §2 entirely: types, all commands + undo, tick math, compile, serialization/migrate, default project, layering test; the store composer (§5) with dispatch/undo wiring | `src/domain/**`, `src/lib/store.ts`, root configs (§6) | — | **opus/fable** (correctness-critical, everything else builds on it) |
| **B — Audio engine** | §3 entirely: lazy boot, transport, scheduler, 7 voices, pools, choke groups, mixer graph, meter taps, metronome, `previewNote`, WAV export; audio unit tests + AudioContext stub | `src/audio/**`, `src/test-support/audio-stub.ts` | A (types + compile output only) | **opus/fable** (highest engineering risk) |
| **C — Shell + theme + transport** | Docked layout + window chrome (§4.1), theme tokens (§4.3), global keyboard map, toolbar: play/stop, L-switch, BPM LCD, swing, pattern selector, undo/redo, save/export buttons | `src/components/shell/**`, `src/components/transport/**`, `src/lib/theme.css`, `src/lib/keyboard.ts`, `src/app/**` | A (store); starts chrome/tokens immediately, wires last | sonnet |
| **D — Channel Rack** | §1.1 rack table: rows, 20×32 step grid with cool/warm groups, knobs/LEDs/routing, channel CRUD + reorder, open-roll action | `src/components/channel-rack/**` | A, C | sonnet |
| **E — Piano Roll** | Canvas painter (grid shading, notes with grip + labels, keyboard column, playhead), full interaction controller (§4.4), snap UI, velocity wheel; key preview via `previewNote` | `src/components/piano-roll/**` | A, C, B (types only — stub the engine until B lands) | **opus/fable** (imperative canvas + dense interaction model) |
| **F — Playlist** | Picker panel, tracks, clip paint/erase/drag, live miniatures, Make-unique menu, song playhead, zoom/pan | `src/components/playlist/**` | A, C | sonnet |
| **G — Mixer** | Strips, faders (orange off-default), pan, mute, rAF meters off analyser taps, master clip light | `src/components/mixer/**` | A, B (analyser tap API), C | sonnet |

Sequencing: **A and C start immediately in parallel** (C's store wiring waits for
A's `store.ts`, everything else in C doesn't). B starts once A's `types.ts` +
`compile.ts` signatures exist. D/E/F start on A+C; G last-ish, needing B's tap
API. Integration e2e (§7's loop) runs after D+E+F+G land and belongs to whoever
integrates (recommend the A or E agent, opus/fable tier).

Contract points to freeze in slice A/B's first commits so UI slices never block:
`store.dispatch(command)`, the store's selector names for each surface, and
`audio/engine.ts`'s public surface
(`ensureStarted() · play() · stop() · setMode() · previewNote(channelId, pitch,
durationSec?) · getMeterTap(trackId) · exportWav()`).

---

## 9. Definition of done

The project is done when all of the following hold on the deployed Vercel build:

1. **The loop:** a first-time user can program a 16-step drum pattern, draw a
   bassline in the Piano Roll, arrange two patterns into a song, adjust a mixer
   fader while it plays, save, close the tab, reopen, and continue — with no
   console errors and no audible clicks/glitches at 140 BPM. Click-freedom is
   gated by a manual listen check plus the §3.3 gain-ramp rules enforced in
   the audio unit tests.
2. **The three FL primitives** (lane 1 §10) work everywhere they're specced:
   right-click deletes; middle-drag pans + Ctrl+wheel zooms in roll and playlist;
   `L` audibly switches pattern/song.
3. **Reference semantics are visible:** editing a shared pattern updates every
   placed clip's miniature and its song-mode playback; Make unique detaches
   exactly one clip.
4. **Undo/redo** inverts every mutating action in §1.1, atomically for
   cross-cutting ones, one entry per drag gesture.
5. **It reads as FL:** portrait 20×32 steps with cool/warm 4-group hues; two-axis
   piano-roll shading with three gridline weights and square-cornered
   grip-handled notes; playlist clips with header + live miniature; all colors
   from the token sheet. Gated by the run's design-comparison iteration loop —
   screenshot-vs-reference reviews against lane 1's captures.
6. **Quality gates:** `pnpm verify` (typecheck, lint, unit) and `pnpm test:e2e`
   green in CI; the layering test passes; the Playwright loop of §7 passes
   headless.
7. **Clean provenance:** zero Image-Line assets in the repo or bundle; README
   carries the nominative-use disclaimer (lane 4 §2); all audio is synthesized
   at runtime.
8. D1–D4 shipped (metronome, WAV export, JSON export/import, Make unique); D5
   and every OUT row of §1.1 remain unbuilt.
