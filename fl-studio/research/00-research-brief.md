# Research brief — FL Studio, the core sequencing loop

This is a brief, not a spec. It defines what the research lanes below must
establish before anyone writes `fl-studio/SPEC.md`. **Do not write the
implementation spec from this document alone** — it hands off to a
spec-writing agent only once every lane's deliverable exists in
`fl-studio/research/`, matching the process this repo already ran for
[`Linear`](../../Linear/research), [`Wikipedia`](../../Wikipedia/research)
and [`super-smash`](../../super-smash/research).

## What's being replicated

Confirmed in the spike conversation that produced this brief (2026-08-20):
the target is **[FL Studio](https://www.image-line.com/fl-studio/)'s core
sequencing loop** — the addictive "make a beat" workflow — not full DAW
parity and not a pixel-only UI study. In scope:

- **Channel Rack** — instrument rows, step sequencer grid, per-channel
  pan/volume/mute, piano-roll preview
- **Piano Roll** — draw/edit notes across pitch and time for melodic channels
- **Playlist** — arrange patterns into a timeline (pattern blocks, track
  coloring)
- **Mixer** — a minimal version: per-channel routing to master, not full
  sends/inserts/automation
- A **small set of instruments** — at least one synthesized instrument (pure
  oscillator/envelope, no samples) and one sample-backed kit — enough to
  make a beat, not a plugin ecosystem
- Playback via the **Web Audio API**, browser-only, no native audio/VST
  hosting, no audio recording

Explicitly out of scope for this spike (confirm this hasn't shifted before
research starts, but don't relitigate it — it was a scoping decision, not an
open question): FL's actual synth engines (Sytrus, FLEX, etc.) and stock
sample library, full automation/mixer-routing fidelity, plugin hosting,
audio recording, anything requiring a desktop runtime.

## Constraints every lane inherits

- **No proprietary FL Studio assets.** Not just UI chrome — its stock
  samples, presets, and synth engines are copyrighted. A replica reproduces
  the *idea* of a channel with an instrument, never Image-Line's actual
  sounds. This is the same posture `super-smash` took toward Nintendo
  assets — see
  [`art-audio-and-licensing.md`](../../super-smash/research/art-audio-and-licensing.md)
  for the enforcement-risk framework to apply here (name/trademark use,
  UI-genre-convention vs. specific-execution copying, what's actually drawn
  takedowns for comparable projects).
- **Repo stack conventions carry over unless a lane finds a real-time-audio
  reason they can't.** Next.js App Router, pnpm, Vercel, Vitest + Playwright,
  Tailwind — see
  [`Wikipedia/research/01-repo-conventions.md`](../../Wikipedia/research/01-repo-conventions.md)
  for the exact pinned versions and config gotchas. Lane 7 below verifies
  this rather than re-deriving it from scratch.
- **Deliverable format matches siblings.** One markdown file per lane in
  this folder, numbered `01-…` onward. Mark every claim **HIGH** (primary
  source, quoted), **MED** (secondary source, consistent across several) or
  **LOW** (inference, flagged as unverified) — see
  `Linear/research/06-stack-deployment.md` for the convention in practice.
  Cite real URLs. Reference captures of the real product (screenshots,
  measurements) go in `research/screenshots/`, matching `Linear` and
  `Wikipedia`.
- **Measure, don't guess.** Where a sibling project measured something from
  the running product rather than trusting marketing copy or memory (Linear's
  hex colors, its glyph radius, its fractional-index scheme), this project
  should do the same for FL Studio's layout, spacing, color roles, and
  interaction timing wherever a demo/trial/screenshots make that possible.

## Research lanes

Each lane is one markdown file. A lane is done when the spec-writing agent
could read only that file and make correct, specific implementation
decisions for its area — vague summaries ("FL Studio has a piano roll with
notes") are not a deliverable; measured specifics ("note height is Npx at
100% zoom, velocity is a separate lane below the grid, drag-to-resize snaps
to the current grid setting") are.

### Lane 1 — Visual & interaction design

Channel Rack, Piano Roll, Playlist and Mixer: layout, spacing, color roles
(including per-channel/per-pattern user coloring), typography, iconography,
and the interaction vocabulary — click/drag/right-click behavior for
drawing steps, drawing/resizing/velocity-editing notes, arranging pattern
blocks, zooming/scrolling, keyboard shortcuts for the workflows a beat-maker
actually uses. Source from Image-Line's own documentation, demo/trial
screenshots and walkthrough videos — never pirated software. Follow
`Linear/research/01-visual-design.md` and `04-interaction.md` as the model
for how much precision is expected.

### Lane 2 — Core data model

The domain model underneath the UI: how a Channel, a Step/Pattern, a Note
(pitch, position, length, velocity), a Playlist track, a Pattern block, and
a Mixer channel relate to each other and to the project as a whole. Not
FL's binary `.flp` format — a clean, from-scratch model that supports the
same *workflow* (e.g., a pattern is reused across multiple playlist
positions; editing it edits every instance). Follow
`Linear/research/03-data-model.md`'s approach: derive the model from
observed behavior, not from guessing at internal structure.

### Lane 3 — Audio engine architecture

How to actually schedule and play sound accurately in a browser: Web Audio
API's look-ahead scheduling pattern (`AudioContext.currentTime`, queuing
notes ahead of playback to avoid JS-timer jitter), and a reasoned recommendation
on **Tone.js vs. raw Web Audio API** — precedent from the spike's initial
search (Tone.js gives a transport/BPM clock and prebuilt synths at the cost
of bundle size and a musical rather than functional API) needs verifying in
more depth: how sibling browser-DAW projects (JSequencer, JSDJ, and others
this lane should find) actually structured their scheduler, how they
handled a step sequencer's fixed grid vs. the piano roll's free timing on
the same transport, and what latency/drift issues they hit. Also cover:
`AudioContext` requiring a user gesture to start (interaction with Next.js
SSR), voice/polyphony management, and basic effects (at minimum a
volume/gain stage per channel and a master bus).

### Lane 4 — Instrument sound sourcing & licensing

How to produce actual sound without shipping anything proprietary. Compare
two approaches in depth rather than assuming one: (a) synthesis-only
instruments built from oscillators/envelopes/filters in Web Audio, which
sidesteps licensing entirely, and (b) sample-backed instruments using
openly-licensed soundfonts/sample packs (the spike surfaced VSCO Community
Edition and GoldMidiSf2 as candidates — verify their actual license terms,
don't take a search snippet's word for it). Recommend a specific minimal
instrument set (e.g., one synth lead/bass, one sample-backed drum kit) with
named, license-checked sources for anything sample-based. Apply the same
enforcement-risk lens as
[`super-smash/research/art-audio-and-licensing.md`](../../super-smash/research/art-audio-and-licensing.md).

### Lane 5 — Comparable prior art

Survey existing browser-based sequencers/DAWs and step-sequencer toys
(Tone.js's own demos, JSequencer, JSDJ/LSDJ-inspired clones, BandLab,
Soundtrap, Audiotool, and whatever else this lane turns up) for architecture
patterns worth reusing or explicitly avoiding — how they structured
transport/scheduling, how they represented patterns/channels in state, what
broke at scale (e.g., long playlists, many simultaneous voices), and where
they cut scope compared to a real DAW. This lane exists to stop lanes 2 and
3 from re-deriving mistakes others already made in public repos.

### Lane 6 — UX scope boundary

A closer look at exactly where "core sequencing loop" should cut off in
practice, once lanes 1–5 have made the full FL Studio surface concrete:
which Channel Rack / Piano Roll / Playlist / Mixer features are load-bearing
for the "make a beat" loop versus which are FL-specific power-user depth
that can be cut without the replica feeling hollow. This lane's job is to
turn the spike's scope decision into a concrete in/out feature list the
spec-writing agent can lift directly, the way `Linear/research/02-features.md`
did for the Linear clone.

### Lane 7 — Stack & deployment fit

Verify (not re-derive) that this repo's standard stack —
`Wikipedia/research/01-repo-conventions.md`'s pinned versions, Next.js App
Router, Vercel — has no real-time-audio-specific blocker: SSR interaction
with `AudioContext` and any Web Audio globals, whether audio-buffer/soundfont
assets need special Next.js static-asset handling, bundle-size implications
of Tone.js if lane 3 recommends it, and whether Vercel's static/serverless
hosting has any relevance at all to a client-side-only audio app (it likely
doesn't — confirm rather than assume). Flag anything that would justify
deviating from the sibling stack; expect this lane to be short.

## Handoff

Once all seven lane files exist in this folder (plus any
`research/screenshots/` captures they produced), a spec-writing agent reads
this brief and every lane doc, then writes `fl-studio/SPEC.md` following the
sibling `SPEC.md`/`README.md`/`DECISIONS.md` conventions. That agent may
also add a short lane index if useful, but should not need to re-research
anything this brief scoped — if it finds a gap, that's this brief's bug,
fix the brief and rerun the affected lane rather than letting the spec
writer improvise.
