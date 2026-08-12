# Stages, prior art, and how to draw a fighting game in a browser

Research lane 5. Fetched against SmashWiki, Kurogane Hammer, several open-source clones'
repositories, and the game-feel literature, August 2026.

---

## 1. Stage geometry, in the game's own units

From [Kurogane Hammer's Ultimate stage database](https://kuroganehammer.com/Ultimate/Stages).
These are exact and are used directly as seed data in `src/stages/`. **HIGH**

| Stage | Blast L | Blast R | Blast T | Blast B | Ledge L | Ledge R | Floor Y |
|---|---|---|---|---|---|---|---|
| Battlefield | −240 | 240 | 192 | −140 | −79.99 | 79.99 | 0.111 |
| Final Destination | −240 | 240 | 180 | −140 | −80 | 79.99 | 0.005 |
| Small Battlefield | −240 | 240 | 180 | −140 | −80 | 80 | 0 |
| Smashville | −229 | 230 | 190 | −115 | −69.05 | 70.25 | 0.100 |
| Town & City | −230 | 230 | 195 | −118 | −81.78 | 83.22 | 0 |
| Pokémon Stadium 2 | −250 | 250 | 180 | −125 | −93.78 | 93.78 | 0 |

For scale: Battlefield and Final Destination's main platform is **16 metres wide**,
independently confirmed by placing Minecraft blocks with Steve. **MED**, and a genuinely
delightful measurement technique.

Layouts: Battlefield has three soft platforms in a triangle; Small Battlefield is
Battlefield with the top one removed; Smashville has one that sweeps horizontally; Town &
City alternates between three and two on a ~30s cycle; Pokémon Stadium 2 has two flanking;
Final Destination has none.

### Ω and Battlefield forms

Every stage has both, cycled with a single button on stage select. **Ω** flattens to Final
Destination's geometry; **Battlefield form** reshapes to Battlefield's — and per Sakurai,
**all Battlefield forms are geometrically identical**, differing only in skin and music.
**HIGH** — [Ω form](https://www.ssbwiki.com/%CE%A9_form).

That is a gift architecturally: the game needs three canonical geometries plus a handful of
unique layouts, and any number of visual skins on top. It is implemented as a data
transform rather than as hand-written variants.

### Platform mechanics

**Hard** platforms are fully solid with walls, ceilings and grabbable ledges. **Soft**
platforms are passable in both directions and can be dropped through with a down input —
which carries a **4-frame buffer window**. **Semisoft** are passable upward only.
**Supersoft** additionally let a fighter in downward hitstun pass through. **HIGH** —
[Platform](https://www.ssbwiki.com/Platform).

Wall jumps lose height on each successive use against the same wall until they cap at zero.
Wall teching is universal, with an 11-frame window in Ultimate (up from 8). **HIGH**

### Camera

Frames all fighters, zooming out as they separate. The **magnifying glass** draws an
offscreen-but-alive fighter in a small circle with a directional arrow at the screen edge,
and ticks 1%/second until they reach 150%. **Special Zoom** (blue) fires on select heavy
hits; **Finish Zoom** (red) fires when the engine predicts a match-ending KO and always
zooms regardless of player count. **HIGH**

---

## 2. Prior art, read critically

| Project | Stack | The useful lesson |
|---|---|---|
| [Super Smash Flash 2](https://www.mcleodgaming.com/) | ActionScript 3, later Adobe AIR | The entire pre-2010 codebase was **scrapped and rewritten** when the team grew past one person. Budget for a rewrite checkpoint rather than assuming the first architecture survives. |
| [meleelight](https://github.com/schmooblidon/meleelight) | Vanilla JS, Canvas 2D | Reproduces Melee physics at competitive fidelity **on Canvas 2D alone**. Direct evidence that a full roster does not need WebGL. Never built netcode. |
| [Super_Bash_Folds](https://github.com/blancmathis/Super_Bash_Folds) | TypeScript, Three.js | Closest analog to this project. Fighters and stages as **folder-based content packs** validated by tooling, no core-engine edits. Explicitly "a playable foundation, not a finished game" — stalled on animation quality, not on engine work. Local-only. |
| [universalSmashSystem](https://github.com/digiholic/universalSmashSystem) | Python, Pygame | Extensibility-first with a character builder, but its physics presets are "mostly unimplemented, reminders for later". A caution about which half to build first. |
| [SuperTuxSmash](https://github.com/jagoly/SuperTuxSmash) | C++, custom renderer | Only one character playable. A from-scratch rendering pipeline is a large time sink relative to the game. |

**The pattern across all of them:** nobody has shipped a competitively rigorous
open-source Smash clone, and the failure modes are consistent — stalling on asset
production once the engine works, never building netcode, and physics presets that stay
"planned" forever. This project's ordering (formulas first, procedural art so there are no
assets to stall on, netcode designed into the state layout from day one) is a direct
response to that.

Commercial platform fighters, for reference: **Rivals of Aether** shipped GGPO-style
rollback and exposes the same GML scripting to Workshop characters that its own cast uses;
**Brawlhalla** uses classic rollback with state as one contiguous struct; **Fraymakers**
prioritised rollback from day one and uses **false-colour palette mapping** so one painted
sprite generates every costume. **HIGH**

---

## 3. Rendering

Canvas 2D handles roughly 1,000–3,000 simple draws per frame at 60fps; PixiJS (WebGL,
batched) pushes far more. For **four fighters, particles and a parallax background**, Canvas
2D is comfortably sufficient — and meleelight proves it at full roster scale. This project
uses **Canvas 2D with no rendering library**, which also matches the sibling projects in
this repo, all of which ship dependency-free canvas renderers. Reaching for WebGL here
would be paying a complexity budget to solve a problem the profiler has not reported.
**MED**

### Drawing characters without art files

Three options: hand-drawn sprite sheets (highest ceiling, needs animators — where
SuperTuxSmash and TUSSLE stalled), skeletal rigs with authored key poses, or fully
procedural physics ragdolls (Stick Fight-style — cheapest, but reads poorly for a game
where players must parse startup/active/recovery at a glance).

**Skeletal rigs win**, and the reasoning is specifically about a *fighting* game: Smash's
design language depends on readable silhouettes and clearly telegraphed hitboxes, which
authored key poses guarantee and emergent ragdoll physics do not. A rig also gives cheap
IK in-betweens, trivial palette swaps, and a natural home for squash-and-stretch.

Implementation notes gathered:
- A **two-bone analytic IK solver** (law of cosines) is all a humanoid limb needs. FABRIK
  and CCD are for longer chains — a tail or a whip — and are not worth the complexity here.
- Interpolate joint **angles** with shortest-path wraparound and an easing curve.
- Author poses as plain `bone → angle` maps and share one pose library across the roster,
  scaling bone lengths per fighter. This is the leverage that makes eight fighters
  tractable.

### Readability with four fighters onscreen

- **Squint test**: block each pose as flat black and confirm it still reads. Applied via a
  `debugSilhouette` flag in the renderer.
- **Rim outline** — a slightly larger dark silhouette drawn behind each fighter separates
  them from busy stage art and from each other. Standard technique for exactly this problem.
- Maximally separated saturated hues per port; distinct proportions per fighter, not just
  palette swaps.
- Give the striking limb its own colour so spectators read *what* hit, not just *that*
  something hit.

**HIGH** — [Dan Fornace on silhouettes](https://fornace.medium.com/fighting-game-design-with-dan-fornace-the-power-of-silhouettes-915fde48318f).

---

## 4. Game feel, with numbers

**Hitstop** is the biggest single contributor and Ultimate's formula is known exactly:
`floor(damage × 0.65 + 6)`, capped at 30. A 15% move gives 15 frames — versus 10 in Smash 4
and 8 in Melee. **HIGH** — [Hitlag](https://www.ssbwiki.com/Hitlag).

**Screen shake** from a decaying trauma scalar: `trauma += impact` on a hit,
`shake = trauma²`, decay each frame. The **squared** falloff is what makes it read as
punchy rather than wobbly. Starting values: ~8–16px offset, ~2–4° rotation, trauma clearing
in 0.3–0.5s for a normal hit and longer for a KO.

**White flash** on the victim for 2–4 frames before the hit-reaction pose plays — very
cheap, disproportionate payoff.

**Squash and stretch** on impact: 0.85× on the hit axis, 1.15× perpendicular, over 4–6
frames. On a skeletal rig this is one scale on the root bone.

**Fixed timestep** with render interpolation, per Fiedler's "Fix Your Timestep!": accumulate
elapsed time, step the simulation in whole 60Hz ticks, and lerp the render between the last
two states by the leftover fraction. Clamp the accumulator to avoid the spiral of death.
Because hitstun, IASA and ledge invincibility are all frame counts, the simulation runs on
an integer frame counter rather than a float accumulator — the two must not drift apart.
**HIGH** — [gafferongames.com](https://gafferongames.com/post/fix_your_timestep/).

---

## Citations

- [Kurogane Hammer stage data](https://kuroganehammer.com/Ultimate/Stages) ·
  [Battlefield](https://www.ssbwiki.com/Battlefield_(SSBU)) ·
  [Final Destination](https://www.ssbwiki.com/Final_Destination_(SSBU)) ·
  [Smashville](https://www.ssbwiki.com/Smashville) ·
  [Town and City](https://www.ssbwiki.com/Town_and_City) ·
  [Pokémon Stadium 2](https://www.ssbwiki.com/Pok%C3%A9mon_Stadium_2)
- [Ω form](https://www.ssbwiki.com/%CE%A9_form) ·
  [Platform](https://www.ssbwiki.com/Platform) ·
  [Stage legality](https://www.ssbwiki.com/Stage_legality) ·
  [Camera](https://www.ssbwiki.com/Camera)
- [meleelight](https://github.com/schmooblidon/meleelight) ·
  [Super_Bash_Folds](https://github.com/blancmathis/Super_Bash_Folds) ·
  [universalSmashSystem](https://github.com/digiholic/universalSmashSystem) ·
  [SuperTuxSmash](https://github.com/jagoly/SuperTuxSmash) ·
  [Fraymakers Backer Q&A](https://fraymakers.com/backer-qa-1/)
- [Fix Your Timestep!](https://gafferongames.com/post/fix_your_timestep/) ·
  [The power of silhouettes](https://fornace.medium.com/fighting-game-design-with-dan-fornace-the-power-of-silhouettes-915fde48318f) ·
  [Hitlag](https://www.ssbwiki.com/Hitlag)
