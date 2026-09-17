# Lane 6 — UX scope boundary

Turns the spike's scope decision (`00-research-brief.md`) and lanes 1–5's
findings into a concrete IN/OUT feature list for each surface, in the format
`Linear/research/02-features.md` used: a table per surface, one acceptance
criterion per IN feature, OUT features named and justified rather than
silently dropped. This is what the spec-writing agent should lift directly.

Cut rule applied throughout: **IN = load-bearing for "program a 16-step drum
pattern, add a bassline in the piano roll, arrange two patterns into a song,
hear it through a master fader, save and reload it."** Everything else is
FL-specific power-user depth — named explicitly as OUT, not silently
omitted, per the brief's instruction not to relitigate scope but to make it
concrete.

---

## 1. Channel Rack

| # | Feature | IN/OUT | Acceptance criterion (IN only) |
|---|---|---|---|
| 1 | Instrument rows (add/rename/delete/reorder channel) | IN | User can add a channel, pick synth or sampler kind, rename it inline, delete it (cascades note deletion per lane 2 §2), and reorder rows by drag. |
| 2 | 16-step grid, left-click toggles step on | IN | Clicking an empty cell inserts a zero-length `Note` at that step's tick position (lane 2 §1); the cell renders filled immediately. |
| 3 | Right-click deactivates a step | IN | Right-clicking a filled cell removes its `Note`; matches FL's universal right-click-delete idiom (lane 1 §8). |
| 4 | Per-channel mute LED | IN | Clicking the LED sets `Channel.muted`; a muted channel's steps still render but produce no sound during playback. |
| 5 | Per-channel pan knob | IN | Drag vertically to adjust `Channel.pan` (-1..1); double-click or Alt-click resets to 0 (center). |
| 6 | Per-channel volume knob | IN | Drag vertically to adjust `Channel.volume` (0..1); double-click/Alt-click resets to a sane default (e.g. 0.8). |
| 7 | 4-step beat-group shading (odd/even hue alternation) | IN | Steps 1–4/9–12 render one hue family, 5–8/13–16 another, per lane 1 §2.4 — cheap to implement (a CSS class per group), and it's "the single most-missed detail" per lane 1's own note, so worth the small cost. |
| 8 | Pattern selector (name + prev/next) | IN | A dropdown/stepper switches which `Pattern` the rack and step grid are editing; see §5 Transport. |
| 9 | Click channel name → opens Piano Roll for that channel | IN | Matches FL's "Channel Button… click opens the plugin" (lane 1 §2.1); for this clone, "opens the plugin" becomes "opens the Piano Roll scoped to this channel." |
| 10 | Mixer-track routing box on each row | IN | Shows the channel's `routedToMixerTrackId`; click/drag or a dropdown reassigns it (default: master). Small, and load-bearing once the Mixer exists at all — a channel with no visible routing control is a dead end in the loop. |
| 11 | Undo/redo for step edits | IN | See §7 (cross-cutting). |
| 12 | Per-step velocity / Graph Editor (Note/Velocity/Release/Fine-Pitch/Mod X/Mod Y/Shift/Rep lanes) | OUT | FL's Graph Editor (`Ctrl+K`) is an eight-property editor per step (lane 1 §2.2) — real depth, but a drum step's default velocity (1.0) is enough for "make a beat"; velocity nuance belongs to the Piano Roll where it's already IN (see §2). |
| 13 | Per-channel Swing knob (independent of global swing) | OUT | Global swing (a single project-level slider, §5) delivers the audible "swing" feel; per-channel swing multiplies complexity for a difference only a mixing-critical ear would isolate. Cut per lane 2 §6's own framing of it as a refinement on top of global swing, not a replacement for it. |
| 14 | Piano-roll preview strip (melodic channel shows notes instead of steps) | OUT, with a **substitute**: clicking a melodic channel's row opens the Piano Roll window instead of rendering an inline preview strip. FL's inline strip (lane 1 §2.1) is a nice-to-have; a full Piano Roll open is equally functional for the core loop and is simpler to build (no second note-rendering surface). |
| 15 | Channel filter-group dropdown, `+` add-plugin picker beyond synth/sampler, channel cloning/grouping | OUT | Organizational conveniences for large projects (dozens of channels) — this clone's "make a beat" scope is a handful of channels; zero loop value. |
| 16 | Pattern length beyond a fixed 16 steps / Auto vs Fixed length modes | OUT | Lane 2 §3 documents FL's Auto/Fixed length modeling in full and the data model (`positionTicks`/`lengthTicks`) already supports it — but exposing pattern-length editing UI is deferred; ship one fixed 16-step (1 bar) pattern length for v1. **OPEN, recommendation: cut for v1, but do not block it in the data model** (it already isn't, per lane 2). |
| 17 | Error-state red channel button (missing sample) | OUT | Only meaningful once external sample files can go missing; this clone's instruments are synthesized/bundled (lane 4), so the failure mode doesn't exist. |
| 18 | Channel-rack-level swing slider (global) | See §5 Transport | Modeled as a project-level transport control, not a Channel Rack control, to match lane 2 §6's `Project.globalSwing`. |

---

## 2. Piano Roll

| # | Feature | IN/OUT | Acceptance criterion (IN only) |
|---|---|---|---|
| 1 | Draw tool: left-click adds a note at default length | IN | Clicking empty grid space inserts a `Note` at the clicked pitch/tick, default length = 1 beat (or current snap unit), default velocity 100/127 (lane 1 §3.7 MED). |
| 2 | Right-click deletes a note | IN | Matches the universal right-click-delete idiom; single click removes the note under the cursor. |
| 3 | Drag-to-resize (right edge) | IN | Hovering a note's right edge shows a resize cursor; dragging changes `lengthTicks`, snapped to the current snap setting unless Alt is held. |
| 4 | Drag to move (reposition + repitch) | IN | Left-click-drag on a note body moves it in both pitch and time; Shift locks pitch (vertical lock, lane 1 §3.5/§8), Ctrl locks timing (horizontal lock). |
| 5 | Velocity editing | IN | Alt+mouse-wheel over a note (or a below-grid velocity lane with draggable stems, lane 1 §3.7) adjusts `Note.velocity`; both are acceptable — pick the mouse-wheel binding as the required minimum, the stem lane as a stretch. |
| 6 | Snap to grid (global toggle + per-window override) | IN | A snap selector (at minimum: Bar / Beat / 1/2 Beat / 1/4 Beat / off) constrains where drawn/dragged notes land; `Alt` held during drag bypasses snap for that gesture (lane 1 §3.4/§8). |
| 7 | Horizontal/vertical scroll + zoom | IN | Mouse-wheel or a zoom control changes visible bar range and octave range; the grid remains usable at both a full-pattern and a single-bar zoom level. |
| 8 | Keyboard preview column (click a key to hear its pitch) | IN | Clicking the left-edge keyboard column plays that pitch through the current channel's instrument — cheap (reuses the note-trigger path) and closes the loop between "see a pitch" and "hear a pitch," which matters for a melodic workflow. |
| 9 | Note name label rendering, black/white key row shading | IN | Visual only, no new interaction — cheap per lane 1 §3.2/§3.3, and this is literally why a piano roll reads as a piano roll rather than a generic grid. |
| 10 | Undo/redo | IN | See §7. |
| 11 | Per-note pan, release, filter cutoff/resonance, fine pitch (Event Editor's full property list) | OUT | Lane 1 §3.7 documents seven note properties FL exposes in the Event Editor; velocity is the one that's load-bearing for "a beat with dynamics" — the rest are sound-design depth this clone's minimal synths (lane 4) don't have parameters for anyway (no per-note filter cutoff on an oscillator+envelope kick). |
| 12 | Ghost notes (other channels' notes shown behind, from same or overlapping patterns) | OUT | A power-user aid for arranging harmony across channels; not needed to draw one channel's melody. Cut per brief's "power-user depth" framing. |
| 13 | Note colour = MIDI channel (16-colour system), slide/portamento notes | OUT | MIDI-channel-based colouring and slide/porta articulation are FL-specific depth with no analog need in a from-scratch clone with one instrument per Channel already (lane 2's model ties notes to `Channel`, not a MIDI-channel int). |
| 14 | Chord/scale helper, Arpeggiator, Strum, humanize tools | OUT | Not mentioned as core in any lane; these are composition-assist tools layered on top of the basic draw/edit loop. |
| 15 | Slice tool, Slip Edit | OUT | Note-splitting and content-slide tools are precision-editing depth beyond "draw/resize/delete/velocity." |
| 16 | Left-edge resize (`Ctrl+Alt+Home` toggle) | OUT | FL disables this by default too (lane 1 §3.5) — right-edge-only resize is the FL default behavior, so matching it is zero extra scope, not a cut of something users expect on. |

---

## 3. Playlist

| # | Feature | IN/OUT | Acceptance criterion (IN only) |
|---|---|---|---|
| 1 | Pattern picker panel (list of patterns to paint) | IN | A left-side panel lists every `Pattern` by name/colour; clicking one selects it as the "currently selected clip" for the Draw/Paint tools. |
| 2 | Paint/draw pattern clips onto a track | IN | Left-click on an empty track cell places a `PatternClip` referencing the selected pattern at that tick position (lane 2 §4). |
| 3 | Erase pattern clips (right-click) | IN | Right-click on a clip deletes it; matches the universal idiom. |
| 4 | Drag to reposition a placed clip | IN | Left-click-drag on a clip moves its `startTick`, snapped to the current snap setting. |
| 5 | Pattern reuse / shared-reference editing | IN | Placing the same pattern at two positions and editing it in the Channel Rack or Piano Roll updates both placements simultaneously — this is lane 2 §4's central data-model fact and must be visibly true, not just modeled. |
| 6 | Track headers: name, colour, mute | IN | Each `PlaylistTrack` shows its name and a mute LED; muting silences every clip on that track during Song-mode playback. |
| 7 | Song-mode playhead + horizontal scroll/zoom | IN | A vertical playhead line tracks playback position across the timeline in Song mode; horizontal zoom/scroll lets the user see either the whole arrangement or one bar in detail. |
| 8 | Pattern-mode vs Song-mode playback toggle | See §5 Transport | Modeled as a single transport-level switch shared by the whole app, not a Playlist-local control (lane 2 §4.1). |
| 9 | Undo/redo | IN | See §7. |
| 10 | Track height dragging, per-track colour override via NOTE/CHAN/PAT modes | OUT | Visual-organization depth; a single default colouring rule (pattern colour) is enough for the core loop. **OPEN, recommendation: cut the three-way toggle, keep `Pattern.color` as the only clip colour source** — matches lane 2's own §4 note that `colorMode` exists structurally but doesn't have to be exposed as a UI choice yet. |
| 11 | Audio clips (waveform import/playback in the Playlist) | OUT | Brief explicitly scopes out audio recording/import; no audio-clip type needed. |
| 12 | Automation clips (envelope curves drawn in the Playlist) | OUT | Brief explicitly scopes out full automation fidelity. `PatternClip` is the only clip kind in scope (lane 2 §8 models `kind: 'pattern'` as effectively the only variant needed). |
| 13 | Slip Edit, Slice tool for clips | OUT | Precision-editing depth on top of an already-out-of-scope clip-trim workflow. |
| 14 | Time markers / song loop points beyond a basic loop-whole-pattern | OUT | Named markers, loop-region dragging, and marker types (lane 1 §4.5) are arrangement-polish features; a fixed "loop the whole Song-mode arrangement" behavior is enough. **OPEN, recommendation: cut markers entirely for v1** — nothing else in the core loop depends on them. |
| 15 | 1:1 Track-mode (instrument bound directly to a playlist track) | OUT | Lane 1 §4.7 flags this as a newer FL mode that coexists with classic pattern-painting; the classic mode alone (patterns painted onto generic tracks) is the one this clone needs — don't build two competing playlist paradigms. |
| 16 | "Make unique" (fork a shared pattern reference) | **OPEN, recommendation: IN, cheap.** | Right-click a placed clip → "Make unique" clones its referenced pattern (lane 2 §4's documented mechanism) and repoints only that clip. Flagged OPEN because it's not strictly required to demonstrate reuse (item 5 already does that), but it's a small, well-specified operation (lane 2 §8/§9 already gives the exact algorithm) that closes an obvious "wait, now I can't edit just this one" dead end the moment a user actually tries reuse. Recommend building it. |

---

## 4. Mixer

| # | Feature | IN/OUT | Acceptance criterion (IN only) |
|---|---|---|---|
| 1 | N insert tracks + 1 master track | IN | The Mixer shows a fixed or user-extendable row of vertical strips (e.g. 8) plus a distinct, always-present Master strip (lane 2 §7). |
| 2 | Per-track fader (volume) | IN | Vertical drag adjusts `MixerTrack.volume`; unity/default position is clearly marked. |
| 3 | Per-track pan knob | IN | Horizontal drag or rotary control adjusts `MixerTrack.pan`. |
| 4 | Per-track mute | IN | Click toggles `MixerTrack.muted`; a muted track's routed channels produce no audible output on the master bus. |
| 5 | Per-track peak meter | IN | An `AnalyserNode` tap (lane 3 §5) drives a live vertical meter per strip; green through most of the range, a distinct top colour near clipping (lane 1 §5.2 gives the exact measured hues if visual fidelity is wanted). |
| 6 | Master strip with clip indicator | IN | Only Master needs a red clip indicator — lane 1 §5.4 quotes FL's own manual that insert tracks can't practically clip, so this clone should apply the limiter/compressor (lane 3 §5) on the master bus only and only light a clip warning there. |
| 7 | Channel → mixer-track routing (already listed under Channel Rack item 10) | IN | Cross-referenced; the Mixer and Channel Rack must agree on the same `routedToMixerTrackId` field. |
| 8 | Undo/redo for mixer parameter changes | IN | See §7. |
| 9 | 10-slot FX chain per track (even as inert placeholder rows) | OUT | Lane 1 §5.3 explicitly frames this as "draw the rows, don't implement FX — the visual idea is the ladder of ten named rows" for a *visual-fidelity* build; this clone's brief caps the Mixer at "routing to master," and empty FX-slot rows with no function add UI surface with zero loop value. Cut entirely rather than build inert chrome. |
| 10 | Sends to arbitrary other tracks (full send graph) | OUT | Brief explicitly caps the mixer below full sends/inserts (lane 2 §7 `PROPOSED`: every non-master track sums straight to master, no arbitrary graph). |
| 11 | Invert phase, swap stereo, stereo separation, latency compensation, record-arm | OUT | Per-track engineering controls with no purpose in a synthesis-only, non-recording context (brief scopes out audio recording entirely). |
| 12 | Rotated vertical track-name label | OUT (visual-only cut) | A nice-to-have visual signature (lane 1 §5.2 calls it "one of the Mixer's most recognisable visual traits") but purely cosmetic — a horizontal label above the strip is equally functional. **OPEN, recommendation: cut for effort, revisit if the spec writer wants closer visual fidelity to lane 1's findings** — it's cheap CSS (`writing-mode: vertical-rl`) if picked back up. |
| 13 | Routing view (drag-to-route diagram) | OUT | A power-user visualization of the full send graph, which itself is already OUT (item 10). |

---

## 5. Transport / toolbar

| # | Feature | IN/OUT | Acceptance criterion (IN only) |
|---|---|---|---|
| 1 | Play / Pause / Stop | IN | Play starts playback from the current position (lazily creating the `AudioContext` on this first gesture per lane 3 §3); Stop halts and rewinds to pattern/song start; matches the FL button semantics in lane 1 §1.2. |
| 2 | Pattern / Song mode switch | IN | Toggles `Project.playbackMode`; in Pattern mode the transport loops only `activePatternId` ignoring the Playlist entirely; in Song mode it plays the full Playlist arrangement (lane 2 §4.1). This is, per lane 1 §10, "the single most important FL binding after Space" — it must exist and must visibly change what plays. |
| 3 | BPM control | IN | A numeric display/stepper sets `Project.tempo`; changes apply live during playback without audio glitches (Tone.js `Transport.bpm`, lane 3 §2). |
| 4 | Pattern selector (name, next/prev) | IN | Cross-referenced with Channel Rack item 8 — one control, shared state. |
| 5 | Global swing slider | IN | Sets `Project.globalSwing` (lane 2 §6); applied at the scheduler as a playback-time delay on off-beat steps, never baked into stored note ticks. |
| 6 | Master volume slider | IN | A single fader controlling the final gain stage before `AudioContext.destination` (lane 3 §5) — distinct from `MixerTrack('master').volume` only if the spec writer wants two knobs; **OPEN, recommendation: collapse these into one control** (the master mixer strip's own fader) rather than duplicating a "main volume" toolbar slider and a "master track fader" that do the same thing — FL has both for historical/routing reasons (lane 1 §1.2 item 4) this clone doesn't need to replicate. |
| 7 | Undo/redo buttons (+ shortcuts) | IN | See §7. |
| 8 | Save / Load project | IN | See §6. |
| 9 | Window toggles (Channel Rack / Piano Roll / Playlist / Mixer visibility) | IN | At minimum, buttons or shortcuts to show/hide each of the four windows — required by whichever window model is chosen (§8). |
| 10 | Metronome (count-in click during recording/playback) | **OPEN, recommendation: IN, trivial.** | A simple on/off toggle that clicks on each beat during playback, built from the same noise/click synthesis primitives already in lane 4's kit — near-zero marginal cost once the audio engine exists, and it's a real, expected DAW-toolbar affordance. No recording exists in this clone (brief scopes it out), so frame it as a playback aid, not a record count-in. |
| 11 | Export to WAV | **OPEN, recommendation: IN if `OfflineAudioContext` is trivial, else defer.** | Web Audio's `OfflineAudioContext` can render a Song-mode arrangement to a WAV `Blob` without real-time playback — genuinely cheap given the scheduler (lane 3) already exists, and "make a beat, then take it with you" is a satisfying capstone for the whole loop. Recommend building a single "Export WAV" button once the scheduler is stable; if it turns out to need per-instrument re-plumbing beyond the live playback graph, defer to a follow-up rather than blocking v1. |
| 12 | Time panel (Bar:Beat:Tick / Minute:Second display) | OUT | Redundant with the playhead position already visible in the Playlist/Piano Roll; a toolbar numeric readout is chrome, not workflow. |
| 13 | CPU/memory/voice-count panel | OUT | Debug/perf chrome with no user-workflow purpose in a browser toy. |
| 14 | Record button / record-filter options | OUT | Brief explicitly scopes out audio recording. No MIDI-input recording either (see §9 below). |
| 15 | Menu bar (FILE/EDIT/ADD/PATTERNS/VIEW/OPTIONS/TOOLS/HELP) | **OPEN, recommendation: a minimal subset only** (File: Save/Load/Export WAV; Edit: Undo/Redo) rather than the full eight-menu bar — most of FL's menu bar addresses features (plugin browser, project options, full help system) this clone doesn't have. |
| 16 | MIDI input / MIDI keyboard support | OUT | Brief explicitly scopes out MIDI input; notes are drawn with mouse only. |

---

## 6. Project save / load

| # | Feature | IN/OUT | Acceptance criterion (IN only) |
|---|---|---|---|
| 1 | Save current project to `localStorage` | IN | A Save action serializes `Project` (lane 2 §8/§9's `SaveFile { schemaVersion, project }` envelope) to `localStorage` under a stable key; debounced on drag operations, explicit on pointer-up/menu action (lane 2 §9). |
| 2 | Load project from `localStorage` on app start | IN | On load, the app reads the saved envelope, runs it through a `migrate()` dispatch keyed on `schemaVersion` (even a no-op v1→v1 migrator is fine to start), and populates state; if nothing is saved, start from an empty default project (one empty pattern, one synth channel, one master mixer track). |
| 3 | New/"reset" project action | IN | Clears state back to the same empty default described above; should not require a page reload. |
| 4 | Named multi-project management (save-as, project list/switcher) | OUT | The brief's "make a beat" loop needs one working project remembered across a reload, not a project library. **OPEN, recommendation: cut for v1**, but keep the save key namespaced (e.g. `flclone:project:v1`) so multi-project support is additive later, not a migration. |
| 5 | Export/import as a downloadable `.json` file | **OPEN, recommendation: IN, cheap.** | A "Download project" button that serializes the same `SaveFile` envelope to a downloadable `.json`, and an "Import" file picker that reads one back — near-zero cost on top of the localStorage envelope already being JSON-safe, and it's the only way a user moves work between browsers/machines without a backend. Recommend building both alongside localStorage save/load rather than as a stretch goal. |
| 6 | Cloud sync / account-backed persistence | OUT | No backend in scope per the brief's stack (client-side-only audio app, lane 7). |
| 7 | `.flp` file compatibility (import/export FL's actual binary format) | OUT | Explicitly rejected by lane 2's own framing — "not FL's binary `.flp` format... a clean, from-scratch model." Never in scope, not even as a stretch goal — it's undocumented, proprietary, and irrelevant to the workflow being replicated. |

---

## 7. Cross-cutting: undo/redo

**IN**, across every surface above — step toggles, note draws/moves/resizes,
clip placement/deletion, channel/pattern/track add-delete, mixer fader/knob
changes, pattern-length or routing changes. Not optional: FL's own shortcut
table treats `Ctrl+Z`/`Ctrl+Alt+Z` as a base-level editing primitive (lane 1
§9), and lane 2 §9 already specifies the mechanism — a command-object stack
with forward/inverse patches, drag-gesture coalescing (one undo step per
completed drag, not per pixel), and explicit handling for cross-cutting
operations like channel deletion (must restore notes across *every* pattern
atomically) and "Make unique" (must both delete the clone and repoint the
clip). Acceptance criterion: every state-mutating action in scope above has
a paired inverse in the command stack, and `Ctrl+Z`/`Ctrl+Y` (or `Ctrl+Shift+Z`)
walk it in both directions from any window.

---

## 8. Window-management model

**Recommendation: fixed, docked layout — not FL's floating/draggable
panel-over-workspace model.**

FL's actual model (lane 1 §1.1, **HIGH**, quoted from Image-Line's own
manual): "floating windows within a unified workspace... snap together when
dragged nearby... configured as either docked... or detached for
multi-monitor setups," each with its own title bar, z-order, and
minimise/maximise/close controls, freely overlapping. Lane 1 itself flags
the implementation cost this implies for a browser build: "absolutely-
positioned draggable/resizable panels over a fixed workspace div... not a
CSS grid of fixed regions" (§1.1, marked **LOW** — an inference, not a
requirement).

Reasons to cut it for this clone:

1. **Effort is disproportionate to the loop.** Floating/draggable/resizable/
   z-ordered/snapping panels are a genuine sub-system (drag state, resize
   handles, z-order management, snap-detection, per-window minimize state,
   persisting layout across reloads) that touches every surface above without
   adding a single new *musical* capability. None of the IN features in §1–§6
   depend on windows being movable — they depend on the four surfaces being
   *simultaneously visible and correctly wired to shared state* (selected
   pattern, selected channel, transport position).
2. **The comparable prior art split supports a fixed layout at this scope.**
   Lane 5 found DOM to be entirely adequate for the Channel Rack and viable
   for the Playlist at this project's scale (§5/§6 of lane 5), and flagged
   canvas/WebGL as needed only for the Piano Roll's note-density problem —
   none of that reasoning touches window *chrome*; it's about what's *inside*
   a panel, which is orthogonal to whether the panel can be dragged.
3. **A fixed layout still reads as "FL-shaped."** The four windows (Channel
   Rack, Piano Roll, Playlist, Mixer) can be arranged in a single static
   grid — e.g. Channel Rack + Piano Roll stacked or tabbed on the left/
   center, Playlist across the top or right, Mixer as a right-hand rail —
   that preserves the genre convention (lane 4 §2 draws the line at genre
   convention vs. specific execution; window *behavior* was never called out
   as part of FL's protectable-in-any-sense visual identity) without the
   engineering cost of the floating system.
4. **A toolbar toggle still gives the "which windows are open" affordance**
   (§5 item 9) even in a fixed layout — e.g. Channel Rack and Piano Roll
   share a tabbed region so only one is visible at a time (mirroring how FL
   itself often shows the Piano Roll on top of the rack for one channel);
   Playlist and Mixer get their own fixed regions since a user typically
   wants both visible alongside whichever of Rack/Roll is active.

**OPEN, recommendation: fixed docked layout for v1** (per above), **with the
data/state layer kept window-model-agnostic** — i.e. don't let "which window
is focused" leak into the `Project`/`Pattern`/`Note` state lane 2 defines;
keep it as local UI state (matching lane 5 §3's Signal precedent of splitting
persisted domain state from ephemeral UI state). This means a later pass
*could* add draggable/floating panels without touching the data model at
all — the cut is purely a v1 UI-effort decision, not an architectural one.

---

## Summary

1. Every surface's IN list is built around one test: does cutting it break
   "program a beat, arrange it, hear it through a fader, save it, reload
   it"? Everything else is named OUT explicitly, never silently dropped.
2. Channel Rack IN: add/rename/delete/reorder channels, step toggle (left
   add/right delete), mute/pan/volume knobs, 4-step hue grouping, pattern
   selector, mixer routing. OUT: per-step Graph Editor, per-channel swing,
   inline piano-roll preview strip, filter groups/cloning.
3. Piano Roll IN: draw/resize/move/delete notes, velocity, snap, zoom/scroll,
   keyboard-column preview-play. OUT: ghost notes, MIDI-channel colouring/
   slide notes, chord/arp tools, slice/slip-edit.
4. Playlist IN: pattern picker, paint/erase pattern clips, drag-reposition,
   shared-reference pattern reuse (the data model's central fact, must be
   visibly true), track mute. OUT: audio/automation clip types, Slip Edit/
   Slice, named time markers, 1:1 Track-mode. "Make unique" is a cheap,
   well-specified add — recommend building it.
5. Mixer IN: N insert tracks + master, fader/pan/mute/meter per track,
   channel routing, master clip indicator. OUT: the 10-slot FX ladder (cut
   entirely, not even as inert chrome), full send graph, phase/stereo/
   latency/record-arm controls, rotated vertical label (cosmetic-only cut).
6. Transport IN: Play/Stop, Pattern/Song toggle (the single most important
   binding besides Space per lane 1), BPM, global swing, master volume
   (collapsed into the master mixer fader, not duplicated), undo/redo,
   window toggles. Metronome and WAV export are cheap wins worth building;
   full menu bar, CPU/time panels, recording, and MIDI input are OUT.
7. Save/load IN: `localStorage` save/load with a `schemaVersion` envelope
   (per lane 2's own recommendation) plus JSON file export/import as a cheap
   add. OUT: multi-project management, cloud sync, and `.flp` compatibility
   (never in scope, per lane 2's explicit rejection of binary-format work).
8. Undo/redo is cross-cutting and mandatory everywhere — command-object
   stack with drag coalescing, per lane 2 §9's already-specified mechanism.
9. Window model: **fixed docked layout, not FL's floating/draggable panel
   system** — the floating-window sub-system is pure engineering overhead
   with no musical payoff; keep window-focus/layout state out of the
   persisted domain model so a later pass could add floating panels without
   a data migration.
10. Five items are flagged **OPEN** with a recommendation rather than a flat
    cut, because they're genuinely cheap relative to their payoff and the
    call is closer than the rest: metronome (in), WAV export (in), JSON
    file export/import (in), "Make unique" (in), rotated vertical mixer
    label (cut, revisit only for visual-fidelity polish) — the spec writer
    should treat these as pre-decided but flagged, not as open questions to
    re-litigate.
