# Instrument sound sourcing & licensing

Research lane 4. Fetched against Versilian Studios, Freesound, Image-Line's own forum
and DMCA history, Ableton's published trademark guidelines, and comparable open-source
DAW clones, August 2026. Applies the enforcement-risk framework from
[`super-smash/research/art-audio-and-licensing.md`](../../super-smash/research/art-audio-and-licensing.md):
rank by what actually draws enforcement (ripped/recreated proprietary assets first,
trademarked names second, look-and-feel a distant third), verify licenses at the primary
source rather than trusting a search snippet, and prefer synthesis over sample licensing
whenever a synthesis path is fully viable — the same call `super-smash` made for its SFX.

---

## 1. The two approaches, compared

### (a) Synthesis-only — zero assets, zero licensing risk

Every sound built from `OscillatorNode` / `GainNode` / `BiquadFilterNode` / noise from
`AudioBufferSourceNode`, driven by envelope automation, exactly as `super-smash` did for
its entire SFX vocabulary (kick, clap, hat, snare and a bass/lead synth are all well
within reach of the same handful of primitives that project used for hit/shield/KO
sounds — see its §3 recipe table). **Risk: LOW, structurally** — there is no third-party
asset in the dependency graph to infringe, mis-license, or lose a source for. This is not
a hedge, it's an elimination of the entire licensing question for the instruments it
covers. **HIGH** confidence this generalizes: 808-style kicks (sine sweep + click),
closed/open hats and claps (filtered noise bursts), snares (noise + tonal body), and a
subtractive bass/lead synth (oscillator → filter → amp envelope) are all textbook
Web-Audio subtractive-synthesis patterns, not FL-specific engineering.

### (b) Sample-backed via openly licensed sources — verified per source, not assumed

Checked each candidate the brief named, plus what turned up researching them, at the
primary license page rather than a marketplace blurb:

| Source | Actual license (verified) | Verdict |
|---|---|---|
| **VSCO 2 Community Edition** (Versilian Studios) | **CC0** — confirmed on [versilian-studios.com/vsco-community](https://versilian-studios.com/vsco-community/): "Licensed under CC0 ... you can download 3GB of samples for free with no rules, no royalties, no limits on how or when you can use it." Orchestral/melodic instrument samples (strings, brass, winds, piano, percussion), not a drum-machine kit. | **LOW risk, HIGH confidence.** Good fit for a melodic instrument (keys/pads), not for 808/909-style drum sounds — VSCO doesn't contain those. |
| **GoldMidiSf2** (soundfont aggregator, spike's other candidate) | **Unverified / no license found.** The site ([goldmidisf2.com](https://goldmidisf2.com/en/)) shows no CC0, freeware, or any license statement on its product pages — only Terms & Conditions/Privacy boilerplate. It's an aggregator of GM soundfonts scraped from many original authors of varying provenance (e.g. the GXSCC soundfont it redistributes is separately documented elsewhere as **CC-BY 4.0**, requiring attribution — [Musical Artifacts](https://musical-artifacts.com/artifacts/9)), and soundfont aggregators routinely repackage material with no clear chain of title. | **MED-HIGH risk. Do not use.** No verifiable license = can't clear it; this is exactly the "trust but verify" failure mode the brief warned about. |
| **jsfxr / sfxr-style procedural generation** | **Unlicense** (public domain equivalent) on the maintained fork ([github.com/grumdrig/jsfxr](https://github.com/grumdrig/jsfxr)). This is a *generator*, not a sample pack — output is code-synthesized at runtime, so it's really approach (a) wearing different clothes. | **LOW risk.** Useful precedent that procedural/chiptune-style synthesis is an established, license-clean pattern; less useful for FL's genre (house/hip-hop/trap sounds), more useful validating the synthesis approach generally. |
| **Freesound.org CC0-filtered packs** | Freesound's own FAQ ([freesound.org/help/faq](https://freesound.org/help/faq/)) confirms CC0 sounds: "you can do pretty much what you want with the sound... but you can't claim you are the author." Filtering to CC0 explicitly (not "Freesound license," not CC-BY, not CC-BY-NC) is mandatory — most uploads are **not** CC0. | **LOW risk if filtered correctly, MED risk if not** — same landmine `super-smash` flagged for the same platform. |
| **"The classic 808/909 sample situation"** | **Confirmed NOT clearly free**, and the risk is subtler than "Roland might sue." Freesound's own FAQ states outright: "if the synth you sampled from is a digital 'ROM' synth, you might actually be recording the samples stored in the memory of the synth. And this is illegal!" — and names **the TR-909 specifically** (its cymbals/hi-hats are PCM-sampled, not analog-synthesized) alongside the TR-707, LinnDrm, and Boss DR-550 as machines whose "808/909 samples" floating around the internet may themselves contain Roland's copyrighted ROM content, however many times they've been re-recorded and repackaged as "royalty-free." The TR-808 is fully analog (its sounds come from real oscillator/noise/filter circuits, so a *recreation* built the same way carries no such risk), but the TR-909 is a hybrid with digital PCM samples for the cymbal-family sounds specifically. | **MED-HIGH risk for any "free 808/909 sample pack" of unclear provenance** (the download sites the initial search surfaced — hiphopmakers, BVKER, Drumkito, etc. — all present themselves as "free" or "royalty-free" but none publish a chain of title back to an original recording; several explicitly warn "you can't re-distribute them," which is the opposite of what a source-code repo needs). **LOW risk if the 808/909 *sound* is synthesized from circuit-description recipes** (sine sweep for the 808 kick, noise+VCA for the hats, etc.) rather than sampled from any machine, real or "recreated" — this sidesteps the ROM question entirely, which is exactly approach (a). |

**Conclusion on (a) vs (b):** synthesis wins for drums outright — it's the only option
with zero provenance risk for exactly the sounds (808/909-style hits) where the "free"
sample ecosystem is murkiest. For melodic instruments, VSCO2 CE is a clean, verified CC0
source if a *sampled* piano/keys/pad timbre is wanted, but it's not required — a
subtractive or FM synth voice covers the same ground with zero asset dependency and
matches the "at least one synthesized instrument" requirement the brief already sets as a
floor.

---

## 2. Trademark / trade-dress: the name, the look, and enforcement history

### Using "FL Studio" in a replica's own README

**Nominative fair use is well-established for exactly this case**: truthfully naming the
product you're referencing/inspired-by, without implying sponsorship, without using their
logo, and without folding the mark into your own product's name. Ableton's own published
guidelines ([ableton.com/en/legal/branding-trademark-guidelines](https://www.ableton.com/en/legal/branding-trademark-guidelines/))
state the general shape other DAW makers apply: referential use is fine ("compatible
with," "inspired by," "a study of X") but the third party's mark must not be more
prominent than your own product's name, must not be used as part of *your* product name,
must not use their logo/visual identity, and should carry a disclaimer of non-affiliation.
Image-Line hasn't published an equivalent public brand-use page, but its actual
enforcement history (below) is consistent with the same posture. **HIGH** — apply the
same wording pattern `super-smash` used for its own README disclaimer (SRB2-derived):
name the real product, state non-affiliation, name what's actually reproduced (workflow)
vs. not (assets, code, binaries).

### Copying the UI look: genre convention vs. specific execution

The same line the `super-smash` framework draws for fighting-game HUDs applies here.
**Not inherently risky:** a step-sequencer grid of cells, a piano-roll of horizontal note
bars against a pitch axis, a horizontal timeline of colored pattern blocks, channel strips
with volume/pan — these are functional conventions of the *DAW/tracker/sequencer genre*
going back to trackers and drum machines that predate FL Studio itself (Roland MC-303,
Propellerhead ReCycle, generic MIDI piano rolls). **What would be risky:** copying
Image-Line's *specific* icon art, its exact color values/gradients as branded visual
identity, its logo/wordmark lettering, or literal FL-branded skin assets. Lane 1's job is
the measurement; this lane's job is the ceiling — reproduce the interaction pattern,
not the branded execution.

### Actual enforcement history against FL-alikes and DAW clones

This is the strongest evidence in this lane, because it's not hypothetical — it's the
observed pattern:

- **Image-Line's only found DMCA action is against literal piracy, not clones.** The
  2018 GitHub DMCA notice ([github.com/github/dmca/2018-03-15-ImagineLine.md](https://github.com/github/dmca/blob/master/2018/2018-03-15-ImagineLine.md))
  targeted a repo shipping `FLEngine_x64.dll` — Image-Line's actual compiled binary,
  redistributed wholesale — not a reimplementation. **HIGH.**
- **Image-Line's own forum has an on-record, decade-old thread about exactly this
  question** ("SharpFL, Open Source FL Studio alternative,"
  [forum.image-line.com/viewtopic.php?t=87425](https://forum.image-line.com/viewtopic.php?t=87425),
  2012). A staff member (`gol`) responded to "can I build an open-source clone using FL's
  default skin for a similar look" with pushback specifically on **reusing the skin
  asset** ("you're obviously not allowed to steal an app's [design/skin]...", "why not
  make your own design anyway?") — not on the idea of an open-source clone itself, which
  went unchallenged once the asset-reuse question was dropped. **MED** (full thread text
  is behind an older forum's pagination the fetch tool truncated; the shape of the
  exchange — object to asset reuse, not to the clone concept — is consistent across every
  quoted fragment and is the same pattern super-smash's own precedent table shows: assets
  and names draw action, UI conventions don't).
- **Multiple FL Studio clones exist publicly on GitHub today with no visible enforcement
  action**: `Jaybee18/butterDAWg` ("FL Studio 20 clone with Electron"),
  `Apex-dev01/fl-studio-25-web-clone` ("1:1 FL Studio 25 Web Clone — React + Tone.js"),
  `Kivans/sampler` ("fl-studio clone"). None hide the comparison — several put "FL Studio
  clone" in their repo name/description. **MED** (absence of a lawsuit isn't proof of
  safety, but it is the same "quiet public precedent" signal `super-smash` used for
  SRB2).
- **LMMS is the load-bearing long-run precedent**: a 20+ year old, still-actively
  developed, publicly funded open-source DAW whose pattern-based sequencer and piano roll
  are explicitly and repeatedly described in its own press coverage as FL-Studio-like
  ("closest workflow to FL Studio" —
  [Hardware Busters](https://hwbusters.com/audio/lmms-a-2024-review-on-the-best-free-daw/)),
  with no lawsuit history found. This is this project's `SRB2` — the comparable posture
  to adopt: long-running, public, name-checked as FL-like by its own users, never
  challenged, because it ships its own code and no Image-Line assets. **HIGH** confidence
  in "no lawsuit found" as a research negative; can't prove a negative absolutely, but the
  search turned up nothing across multiple query angles.

**Overall trademark/trade-dress risk for this project: LOW**, conditioned on the same two
things super-smash's framework conditions on — no Image-Line assets (art, skins, actual
audio, binaries) ship, and the name is used referentially with a disclaimer, never as
part of this project's own name/branding.

---

## 3. Recommended minimal instrument set for the "make a beat" loop

All entries below are **synthesis-only**, chosen deliberately over any sample dependency
for the reason §1 makes concrete: it's the only option with zero provenance risk for
exactly the sounds (808/909-style drums) where "free" sample sourcing is murkiest, and it
fully satisfies the brief's "at least one synthesized instrument and one sample-backed
kit" framing by making *both* halves synthesis — a sample-backed kit is optional
enhancement, not required, once the licensing math is done.

| Instrument | Recipe (Web Audio primitives) | License risk | Precedent |
|---|---|---|---|
| **Kick (808-style)** | Sine oscillator, pitch envelope ~150→40Hz over ~150ms, exponential amplitude decay, optional short click transient (1-2ms noise burst) for attack | **LOW** — analog-circuit-derived recipe, no ROM/PCM involved | `super-smash`'s heavy-smash thump recipe is the same shape (§3 of that doc) |
| **Clap** | 3-4 layered short noise bursts (~10ms each, slightly time-offset) through a bandpass filter (~1-2kHz), fast decay | **LOW** — pure noise synthesis | Standard 808-clap-emulation technique, no sampled source |
| **Closed hat** | High-passed white noise (~7kHz+) through a very fast decay envelope (~30-50ms) | **LOW** | — |
| **Open hat** | Same noise chain, longer decay (~200-300ms), can share the closed-hat's oscillator bank with an alternate envelope (hi-hat choke behavior — closed hat cuts off open hat, a real 808/909 circuit behavior, not a copyrightable one) | **LOW** | — |
| **Snare** | Layered tonal body (2 detuned triangle/sine oscillators ~180-200Hz, short decay) + bandpassed noise "snare buzz" layer | **LOW** | `super-smash`'s light-hit + noise-crack layering technique generalizes directly |
| **Bass synth** | Subtractive: sawtooth/square oscillator → lowpass filter with envelope-modulated cutoff → amp envelope; optional sub-oscillator (sine, -1 octave) for weight | **LOW** | Textbook Web Audio subtractive synth patch |
| **Lead/keys synth** | Subtractive or simple FM: 1-2 detuned oscillators → filter → ADSR amp envelope; polyphonic voice pool for chords/piano-roll melodic parts | **LOW** | Same pattern, tuned for sustain/polyphony rather than percussive decay |

This set covers every Channel Rack row the "make a beat" loop needs (kick, clap, hat ×2,
snare for the step sequencer; bass + lead for piano-roll melodic content) with **no
external asset of any kind** — no license file to track, no attribution string to render
in a credits page, no source that could go offline or change terms later.

**If sample-backed instruments are wanted later** (e.g. a more "real" piano for the
melodic voice), VSCO 2 Community Edition is the one candidate in this lane's research that
cleared verification cleanly (CC0, confirmed at the primary source) — but it should be
treated as an enhancement path, not a dependency of the initial build, both because it's
unnecessary once synthesis covers the loop and because it reintroduces exactly the kind of
external-asset dependency §1 shows this project doesn't need.

---

## Summary

1. Synthesis-only instruments (oscillator/envelope/filter) carry **zero** licensing risk
   because there is no third-party asset in the chain — this is the `super-smash`
   precedent applied to audio a second time in this repo family.
2. VSCO 2 Community Edition is genuinely **CC0**, verified at the primary source
   ([versilian-studios.com/vsco-community](https://versilian-studios.com/vsco-community/))
   — safe if a sampled melodic instrument is ever wanted, but not needed.
3. **GoldMidiSf2 has no verifiable license and should not be used** — its aggregated
   soundfonts (e.g. GXSCC, which is separately CC-BY 4.0 elsewhere) have no clear chain of
   title on that site.
4. **"Free 808/909 sample packs" are the single biggest hidden risk this lane found**:
   Freesound's own FAQ confirms the TR-909's PCM cymbal/hi-hat samples specifically may
   still carry Roland's copyright even after re-recording and redistribution as
   "royalty-free" — the TR-808 (fully analog) does not have this problem, but avoid
   sampled 909 content regardless of source.
5. Freesound CC0 packs are safe **only if filtered to the CC0 tag explicitly** — most
   Freesound content is CC-BY or CC-BY-NC, not CC0.
6. jsfxr/sfxr-style procedural generation (Unlicense) is a useful validating precedent for
   the synthesis approach but not itself the right genre fit for FL's house/hip-hop
   target sound.
7. Naming "FL Studio" in this replica's README is standard, low-risk nominative fair
   use — name the real product, disclaim affiliation, don't fold the mark into this
   project's own name, don't use their logo.
8. Copying UI *genre conventions* (step grid, piano roll, pattern timeline, channel
   strips) is low risk; copying Image-Line's *specific* icon/skin art or logo lettering
   is not — that's the line every precedent below draws.
9. Image-Line's only found enforcement action targeted literal pirated binaries
   (`FLEngine_x64.dll`), not a clone; its own forum staff objected to reusing the actual
   skin asset, not to the concept of an open-source alternative; and LMMS (20+ years,
   openly FL-Studio-like, unchallenged) is this project's SRB2-equivalent precedent.
10. **Recommendation:** build the entire minimal instrument set — kick, clap, closed hat,
    open hat, snare, bass synth, lead/keys synth — from Web Audio synthesis primitives
    with no external assets at all; treat any sample-backed instrument (VSCO2 CE or a
    CC0-filtered Freesound pack) as an optional later enhancement, never a dependency of
    the initial "make a beat" build.
