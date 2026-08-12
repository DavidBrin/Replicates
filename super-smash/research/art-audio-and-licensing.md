# Shipping a Smash homage as source code

Research lane 7. Fetched against takedown reporting, comparable commercial platform
fighters, Google Fonts licensing and the Web Audio documentation, August 2026.

The constraint driving this lane: **no Nintendo assets ship, because there is no legitimate
way to obtain them.** No sprites, no models, no music, no logos. Everything visible and
audible in this project is generated from code. This document is how that was made
possible rather than merely promised.

---

## 1. What actually draws enforcement

| Case | What happened | Trigger |
|---|---|---|
| AM2R | Full DMCA takedown, dev stopped | A complete game using Metroid's characters and world, shortly before an official Metroid release |
| Pokémon Uranium | Devs pulled their own links pre-emptively after 1.5M downloads | The trademarked name and official character likenesses |
| Game Jolt sweep, Dec 2020 | **379 fan games removed in one blanket action** | Struck at the name/character level across a whole platform, regardless of quality or completeness |
| The Big House / Slippi | C&D shut down a monetised, broadcast tournament | A different and more severe category — running and modifying Nintendo's own game code |
| Project M | No formal C&D, but banned from tournaments and Miiverse | Community-level pressure can end a project with zero legal action |

Synthesised, in rough order of risk: **ripped or recreated character art**, then **the
trademarked names**, then **using Nintendo's own code or ROMs**, then **copyrighted music**.
Commercial or broadcast context accelerates enforcement, and **being free is not a shield** —
Nintendo routinely acts against free passion projects. **HIGH**

What is *not* inherently risky: genre-level interface conventions. Diagonal panels, a
percent-based damage HUD, a character-select grid, a "READY GO" countdown — these are
functional patterns of the fighting-game genre rather than protected expression. What is
off-limits is the specific execution: their logo lettering, their icon art, their character
models, their music.

That distinction is precisely where this project sits. **The interface is reproduced; the
assets are not, because there are none.**

---

## 2. How the fighters are drawn

A bone hierarchy of capsules and circles, posed from keyframe data, painted to canvas.
Root → hip → torso → head, with two-bone limbs. Each fighter differs by bone-length
scaling, palette, and a small set of attached props (a sword, a cannon, a shield, ears, a
tail, a cap) rather than by a separate art pipeline.

This was chosen over sprite sheets and over physics ragdolls for a specific reason: a
fighting game demands that players parse startup, active and recovery frames at a glance.
Authored key poses guarantee that; emergent ragdoll physics does not. It also means the
whole game ships as source, with nothing to license and nothing to stall on — which is the
failure mode that stopped several of the open-source clones in
[`stages-and-rendering.md`](stages-and-rendering.md) §2.

Comparable commercial games solve the same constraint by owning their cast: **Rivals of
Aether** built an original elemental roster, **Brawlhalla** generates variety
combinatorially from 13 weapon types crossed with stat dials, **Slap City** reuses
Ludosity's own characters. **Fraymakers** considered original characters and deliberately
chose licensed indie crossovers instead, because recognisable characters carry pre-built
appeal — the exact trade this project's brief made in the other direction. **HIGH**

---

## 3. Audio, synthesised

No audio files ship. Everything is built from `OscillatorNode`, `GainNode`,
`BiquadFilterNode` and noise from an `AudioBufferSourceNode`, driven by ramp automation.
The whole sonic vocabulary of a fighting game fits in a few hundred lines.

| Sound | Recipe |
|---|---|
| Light hit | Sine/triangle 400→150Hz over ~50ms; 2ms attack, ~50ms exponential decay; 1–2ms square click for snap |
| Heavy smash | Two layers — a 120→40Hz thump over ~180ms for weight, plus a bandpass noise crack (1–3kHz, ~15ms) whose lowpass sweeps 4kHz→500Hz |
| Shield | Two detuned oscillators (220 + 224Hz) through a lowpass with a ~2Hz LFO on cutoff; 50ms in, sustain, 80ms out |
| Jump | Square/triangle 300→850Hz over ~120ms with a short noise puff |
| KO blast | 15ms noise crack, then sine 800→30Hz over ~500ms with the lowpass closing 8kHz→200Hz so the sound recedes |
| Menu move / confirm | 550Hz blip; rising 660→880Hz pair; falling 880→660Hz for back |

The KO blast is the game's signature moment and got the most tuning. **HIGH** —
[MDN Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API),
[Synthesising Sounds with Web Audio API](https://sonoport.github.io/synthesising-sounds-webaudio.html).

CC0 sound libraries (Kenney, OpenGameArt) were considered and rejected — not on licensing
grounds, which are clean, but because shipping third-party audio files would be an
unforced departure from the project's own premise when a fully viable synthesis path
exists. Note for anyone reusing that research: **Freesound's licences vary per upload** and
must be filtered to CC0 explicitly; a lot of it is CC-BY-NC, which is a landmine for a
public repository.

---

## 4. Fonts

**Anton** and **M PLUS Rounded 1c**, both under the **SIL Open Font License 1.1** — free to
use, embed, modify and redistribute; the only real restriction is against selling the font
file itself under its original name. Verified per font rather than assumed, since a small
number of Google Fonts ship under Apache 2.0 instead. **HIGH** —
[openfontlicense.org](https://openfontlicense.org/).

Explicitly avoided: any "Smash Bros font" from a font-aggregator site. Those are
unlicensed traces of Nintendo's proprietary logo lettering and carry the same infringement
profile as ripped art, whatever the download page says.

---

## 5. Framing

The comparable posture is Sonic Robo Blast 2's — a long-running, publicly hosted fan
project with no permission from the rights holder, which states plainly that it is
unaffiliated and acknowledges the trademarks. Taisei Project's posture is *not* comparable:
Touhou's rights holder explicitly permits fan works under stated conditions, and Nintendo
grants no such licence. **HIGH** — [srb2.org](https://www.srb2.org/).

Worth recording honestly: **a disclaimer provides no legal protection by itself.** It is a
good-faith signal to readers, not a shield. The actual protection comes from not
infringing — which here means the absence of any Nintendo asset, not the presence of a
paragraph.

The wording used in the README, adapted from SRB2's:

> Super Smash is a study in agentic software development — a rebuild of Super Smash Bros.
> Ultimate's versus mode, not a copy of it. It is not affiliated with, endorsed by, or
> sponsored by Nintendo. Every character, sound and image in this project is generated
> from code: no Nintendo sprites, models, music or logos are used, reproduced or
> distributed anywhere in this repository. Super Smash Bros. and all related characters
> and trademarks are the property of Nintendo. Non-commercial, educational, and free.

---

## Citations

- [Nintendo Life — 379 fan games removed](https://www.nintendolife.com/news/2021/01/nintendo_issues_mass_dmca_takedown_379_fan-made_games_forcibly_removed) ·
  [AM2R takedown](https://www.nintendolife.com/news/2016/09/nintendo_of_america_issues_takedown_request_on_am2r_ending_the_project) ·
  [Pokémon Uranium](https://kotaku.com/pokemon-uranium-creators-pull-game-after-1-5-million-do-1785258831) ·
  [The Big House / Slippi](https://techraptor.net/gaming/news/nintendo-shuts-down-smash-bros-tournament-over-online-play-mod) ·
  [Project M](https://kotaku.com/smash-community-in-shock-over-sudden-end-to-popular-mod-1745742674)
- [Rivals of Aether creator showcase](https://smashboards.com/threads/creator-showcase-rivals-of-aether.447033/) ·
  [Brawlhalla character design](https://www.bluestacks.com/blog/game-guides/brawlhalla/bh-characters-guide-en.html) ·
  [Fraymakers Backer Q&A](https://fraymakers.com/backer-qa-1/) ·
  [The design of Slap City](https://slapcity.se/blogs/design)
- [MDN Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) ·
  [Synthesising sounds with Web Audio](https://sonoport.github.io/synthesising-sounds-webaudio.html)
- [SIL Open Font License](https://openfontlicense.org/) ·
  [Anton](https://fonts.google.com/specimen/Anton) ·
  [M PLUS Rounded 1c](https://fonts.google.com/specimen/M+PLUS+Rounded+1c)
- [Sonic Robo Blast 2](https://www.srb2.org/)
