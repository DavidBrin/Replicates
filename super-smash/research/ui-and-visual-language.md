# Ultimate's visual language

Research lane 2. Fetched against SmashWiki, smashbros.com, Game UI Database and EventHubs
in August 2026, and **pixel-sampled from screenshots of the real game** for every colour
below.

The brief asked for the visuals to be 1:1. This document is what "1:1" actually consists
of, because the interface turns out to be built from a small number of repeated moves.

---

## 1. The one thing that matters most

**Everything is a parallelogram.** Panels, tabs, banners, buttons, the HUD plates, the
mode tiles — all of them lean, typically around 12°. Rectangles are the single most common
reason a Smash homage looks wrong, and no amount of correct colour rescues it. **HIGH** —
direct observation of the character select and HUD screenshots.

The second-most important move is the **diagonal slash**: hard-edged black and white
diagonal bands across a red field, carried over from the box art and the wordmark. It is a
graphic element, never a gradient.

---

## 2. Colours, sampled rather than guessed

No authoritative hex values are published by Nintendo, and the one Smashboards thread
claiming a compiled collection returns 403. So these were sampled directly from
screenshots of the character select screen at 1200px:

| Element | Value |
|---|---|
| Top banner red | `#AD0000`, with a lighter band at `#C10500` |
| Mode tab yellow | `#FFD500` |
| Panel border ink | `#090B0C` |
| P1 panel red | `#FE3636` |
| CPU panel greys | `#DBDBDB` / `#A0A0A0` / `#F5F5F5` |

Player colours are a confirmed franchise convention: **P1 red, P2 blue, P3 yellow, P4
green**. Shields take the same four colours, and **a CPU's shield is always grey**
regardless of port. **HIGH** — [Shield](https://www.ssbwiki.com/Shield).

The damage percentage ramps **white → yellow → red → dark maroon**, reaching its darkest
around 300%. **HIGH** — [Damage](https://www.ssbwiki.com/Damage). The exact breakpoints are
not documented anywhere; the implementation uses even thirds, which is a **LOW**-confidence
choice made explicit in the code.

---

## 3. Screens

### Main menu
Five destinations — **Smash, Spirits, Games & More, Vault, Online** — as large
diagonally-slashed colour tiles around a circular character-collage medallion. A pop-out
sidebar (Collection, Local Wireless, News, Options, Help) greys out what is unavailable in
context. **HIGH** — [Mode](https://www.ssbwiki.com/Mode),
[Dashboard](https://www.ssbwiki.com/Dashboard).

### Character select — the most important screen
Measured from the reference screenshot:

- A **red angled top banner** with a circular back arrow, a rules icon, and a **yellow
  parallelogram tab** carrying the mode name and a dropdown caret.
- A dense **13-column portrait grid**, ordered strictly by **fighter number** (series debut
  order), each portrait a square with the character art, a small-caps name on a dark
  translucent strip along the bottom, and the fighter number in a corner. Echo fighters
  stack into their base's slot; Mii Fighters are always last regardless of number.
  **HIGH** — [Fighter number](https://www.ssbwiki.com/Fighter_number).
- **Player panels along the bottom**, one per port, each a sheared parallelogram skinned in
  the port colour, containing a large white **gloved hand cursor** carrying "P1" in the
  port colour, a name plate, an HMN/CPU toggle, a **CPU Lv. row with a red 1–9**, and an
  alternate-costume selector.
- `+`/`−` controls change the number of slots, 2 through 8.
- Hovering a portrait slides in large art with a name-banner stinger.

### Stage select
In Ultimate, **stage select comes before character select** — the reverse of earlier games.
The Normal / Battlefield / Ω control is a **three-state text toggle that cycles on press**,
not three separate buttons. **HIGH** —
[Ω form](https://www.ssbwiki.com/%CE%A9_form).

### In-game HUD
Each fighter gets a sheared plate: an **angled portrait** on the left over a darkened name
bar carrying the series symbol, **stock icons** as small head silhouettes, and the damage
percentage **to one decimal place** — Ultimate is the first game to show tenths — in a
heavy italic condensed numeral face with the tenths and `%` noticeably smaller than the
integer part.

Behaviours worth reproducing because they carry all the feedback: the percentage **shakes**
when hit; the panel goes **semi-transparent** when a fighter passes behind it; above
**120% it emits smoke**, worsening with damage; it **crackles with electricity** during
Final Smash standby; and it **pops** on a KO. **HIGH** —
[Damage meter](https://www.ssbwiki.com/Damage_meter).

---

## 4. Combat feedback

- **Hitlag** freezes both fighters and vibrates them in place — horizontal on the ground,
  vertical in the air, amplitude scaled by camera distance. Hurtboxes do not move, so it
  cannot cause a phantom hit.
- **Special Zoom** — on select heavy hits, the background flashes blue with radial spark
  lines, the camera snaps in, and time slows. Suppressed with 3+ players. **Finish Zoom**
  is the same effect in red, triggered when the engine predicts a match-ending KO. **HIGH** —
  [Special Zoom](https://www.ssbwiki.com/Special_Zoom).
- **Perfect shield** flashes the shielder white, glows their eyes yellow, and briefly
  freezes the attacker. **HIGH**
- **Star KO vs. Screen KO** off the top blast line is **random** in Ultimate, not
  threshold-based — except that very fast launches always get a plain Blast KO instead.
  Screen KOs resolve faster than Star KOs. **HIGH** —
  [Star KO](https://www.ssbwiki.com/Star_KO), [Screen KO](https://www.ssbwiki.com/Screen_KO).
- **Magnifying glass** — a fighter offscreen but inside the blast zone is drawn in a small
  circle with a directional arrow, and takes 1%/second until reaching 150%. **HIGH** —
  [Magnifying-Glass Damage](https://www.ssbwiki.com/Magnifying-Glass_Damage).
- **Screen shake** is best driven from a decaying "trauma" scalar with a **squared**
  falloff — `shake = trauma²` reads markedly punchier than linear. **HIGH** — standard
  Vlambeer-lineage technique.

---

## 5. The Smash Ball

A floating Smash logo cycling through rainbow hues with a trailing colour streak. It
drifts erratically, **favouring trailing players over the leader**. **40 HP**, decaying
2 every 60 frames; players with fewer KOs deal bonus damage to it. On breaking, the screen
darkens and greys out except the winner, whose eyes turn yellow and whose body glows
rainbow while in standby — held until the Final Smash is input, and lost if they are hit
out of it. There is a 20% chance it spawns with "heavy" physics and rolls instead of
floating. **HIGH** — [Smash Ball](https://www.ssbwiki.com/Smash_Ball).

---

## 6. Type

Nintendo has never published the typefaces. Community identification gives **FOT-Rodin
Pro** for menus, custom hand-drawn lettering for the wordmark (structurally derived from
Times New Roman), and **Serpentine Bold** behind "ULTIMATE". The HUD numeral face was not
identified by anyone and appears to be bespoke. **MED** —
[dafont forum](https://www.dafont.com/forum/read/499686/super-smash-bros-ultimate-menu-font).

Free substitutes chosen, both SIL Open Font License:

- **Anton** — display and HUD numerals. Ultra-bold and condensed; skewed in CSS to fake the
  italic aggression of the original numerals.
- **M PLUS Rounded 1c** — menus. The closest free analogue to Rodin's rounded,
  even-weight geometric feel.

Downloading a "Smash Bros font" from a font-aggregator site was rejected outright: those
are unlicensed traces of Nintendo's logo lettering and carry the same infringement profile
as ripped art.

---

## 7. What could not be pinned down

- Exact damage-percentage colour breakpoints. Even thirds used.
- The precise main-menu tile hover transform (skew angle, scale, parallax depth) — needs
  frame-by-frame video, not text.
- Whether there is genuinely a coloured arrow above each fighter's head, versus only the
  team-battle character outline. Sources only confirm the outline. Both are implemented,
  the arrow as a port indicator, which is at minimum useful.
- Exact "GAME SET" typography.

---

## Citations

- [Mode](https://www.ssbwiki.com/Mode) · [Dashboard](https://www.ssbwiki.com/Dashboard) ·
  [Rules](https://www.ssbwiki.com/Rules) ·
  [Character selection screen](https://www.ssbwiki.com/Character_selection_screen) ·
  [Fighter number](https://www.ssbwiki.com/Fighter_number)
- [Ω form](https://www.ssbwiki.com/%CE%A9_form) ·
  [Damage meter](https://www.ssbwiki.com/Damage_meter) ·
  [Damage](https://www.ssbwiki.com/Damage) · [Shield](https://www.ssbwiki.com/Shield) ·
  [Perfect shield](https://www.ssbwiki.com/Perfect_shield)
- [Special Zoom](https://www.ssbwiki.com/Special_Zoom) ·
  [Star KO](https://www.ssbwiki.com/Star_KO) · [Screen KO](https://www.ssbwiki.com/Screen_KO) ·
  [Magnifying-Glass Damage](https://www.ssbwiki.com/Magnifying-Glass_Damage) ·
  [Smash Ball](https://www.ssbwiki.com/Smash_Ball) ·
  [Results screen](https://www.ssbwiki.com/Results_screen)
- [Game UI Database — Super Smash Bros Ultimate](https://www.gameuidatabase.com/gameData.php?id=89)
