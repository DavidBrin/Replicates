# 04 — Visual Design Specification

A from-scratch art and UI specification for a browser replica of SMG Studio's **RISK: Global Domination**
(RGD), derived entirely from the reference imagery catalogued in
[`04a-visual-evidence-index.md`](04a-visual-evidence-index.md).

> **No SMG assets are used or required.** Everything below is expressed as geometry, colour, type and
> motion that can be reproduced with SVG, CSS and canvas. Hex values are *estimates sampled from
> JPEG/compressed reference frames* with Pillow, then rounded to a clean, self-consistent palette —
> they are "looks like" values, not extracted brand colours. Every claim names the evidence file it
> came from. Section 9 lists what I could not see.

Resolutions referenced: the `bt*` official SMG frames and `nyc`/`ita` frames are **1600×900**; the `c3d`
frames are **1272×720**; store tablet shots are up to **2560×1600**. Pixel measurements are quoted at
1600×900 with a percentage of the frame so they scale.

---

## 1. Overall art direction

### 1.1 The one-sentence read

A **flat-shaded, chunky, extruded "board game on a glass tray"**: hard-edged vector landmasses with
near-black outlines, raised a few millimetres above a bright cyan ocean, lit from directly above with a
single soft key light, no textures, no gradients inside the land, and a heavy cartoon-UI chrome of
glossy pill buttons and circular discs sitting on top. It is **not** painterly, and it is only
*nominally* low-poly — the polygons are in the silhouette, not in the shading.

### 1.2 Camera

- **Default board view is near-orthographic top-down with a very slight forward tilt** — roughly
  **5–10° of pitch** and no yaw. Evidence: in `video/bt3-0052-continent-overlay-bonus-legend.jpg` and
  `video/bt1-0200-deploy-troops-slider-territory-labels.jpg` the territory side-walls are visible only
  along the *bottom* edges of each landmass and are only ~6–10 px tall; the top faces are undistorted.
- **Zoomed views tilt much harder.** `video/bt5-0108-territory-cards-seized-on-elimination.jpg` shows a
  clear perspective with the **far edge of the board slab visible as a lit bevel** running diagonally
  across the top-right, with pure black beyond it. Pitch there reads as **25–35°**, plus a ~8° roll.
  `video/bt2-0025-blitz-win-chance-100-attack-limit.jpg` and `video/bt2-0150-blitz-win-chance-6-low-odds.jpg`
  (the Blitz battle view) are at a similar tilt with heavy extrusion visible (~18–24 px side-walls).
- **Practical conclusion for a CSS/SVG replica:** render the map as a flat 2D SVG and apply the tilt
  with a single `transform: perspective(1400px) rotateX(θ)` on the map wrapper. θ = `4deg` at rest,
  animating to `18deg` for the battle close-up. This reproduces the whole camera language with one
  property. Do **not** try to model real 3D.
- The map-picker tiles (`web/wiki-classic-map.jpg`, `web/mappick-classic-frozen.jpg`,
  `web/mappick-europe.jpg`) use a much stronger, fixed **~30° tilt plus ~6° yaw** — the board reads as a
  physical translucent tray with rounded corners and a soft contact shadow. That is the "product shot"
  camera, used only in menus.

### 1.3 Ocean

- **Base colour is a saturated mid cyan-teal, essentially flat.** A vertical scan of open ocean in
  `bt3-0052` at x=560 gives `#22A4C8 … #2AA5C9 … #1EA4C1` from y=620 to y=740 — less than 3% variance
  over 120 px. A horizontal scan at y=760 gives `#22A4C8 … #26A1C2 … #23A5C5` across 1500 px. **The
  ocean is a flat fill, not a gradient**, across the playfield.
- **It is darkened toward the frame edges by a vignette**, not by an ocean gradient:
  `crop-troop-tokens-multicolour.png` (a 2× crop of the centre of `bt1-0200`) samples `#2A97B9`/`#56C4D6`
  while the same frame's far corners sample `#08242D` and `#020C0F`. The vignette is a large radial
  black overlay, confirmed because UI chrome in the corners is darkened equally.
- **Three overlays sit on the flat cyan**, all cheap to reproduce:
  1. **A coastal glow.** Every landmass has a bright cyan halo bleeding ~20–40 px into the water —
     sampled `#3FACEF`/`#6EC6D2` immediately offshore in `bt1-0200` versus `#22A4C8` in open water.
     Reproduce with an SVG `feGaussianBlur` + `feFlood #7FE3FF` on the union-of-land path, drawn
     *under* the land.
  2. **A sparse "great-circle / constellation" line net.** Long straight white lines at low alpha
     crossing the whole ocean, meeting at scattered nodes. Clearly visible in
     `bt3-0052`, `bt1-0025-victory-screen-conquered-all.jpg` and `web/mappick-classic-frozen.jpg`.
     Estimated **1 px, white at 8–12% alpha**, segments 400–900 px long, ~25–40 lines per screen.
  3. **A faint lighter "contour/ice-floe" mottling** near coasts — soft, organic, low contrast. Seen
     best in `crop-troop-tokens-multicolour.png` and `nyc-0115`. Optional; an SVG turbulence filter at
     5% opacity does it.
- There are **no animated waves and no visible grid** in any frame. The `c3d-0001` *menu* map thumbnail
  does show a faint square grid on the tray, but that is the picker render, not the playfield.

### 1.4 Land fill — per owner, NOT per continent

This is the single most important finding and it contradicts the classic board game.

- **In play, each territory's top face is filled with its current owner's colour.** In
  `bt1-0200-deploy-troops-slider-territory-labels.jpg`, North Africa / Egypt / Middle East are green
  while China / India / Siam are red and Brazil / Peru / Argentina are purple — these cut *across*
  continent boundaries. `nyc-0115-nyc-map-six-player-sidebar.jpg` shows six owner colours interleaved
  inside one small map.
- **Continent identity is only shown on demand**, via the **Continent Overlay**
  (`bt3-0052-continent-overlay-bonus-legend.jpg`, `crop-continent-bonus-overlay.png`), which replaces the
  owner fills with per-continent tints *and* draws a glowing coloured stroke round each continent's
  outer perimeter.
- **A continent you fully control is outlined with a glow in play**, without the overlay:
  `c3d-0610-chat-emote-quickchat-panel.jpg` shows South America and Australia (both fully green) ringed
  by a bright green halo while the rest of the green territories have none.
- **Off-board / unplayable land is neutral grey**: `#65717F` in `nyc-0115`, `#5A6570`/`#6E7372` in
  `bt3-0052` (the Americas sit outside the NYC board and render as flat grey silhouettes).
- The **menu/picker renders invert this**: there, land is parchment cream `#F3DCC0` with a warm ochre
  coast and the *continent* is the coloured outline (`web/wiki-classic-map.jpg`,
  `web/mappick-europe.jpg`). Keep that treatment for picker tiles only.

### 1.5 Territory borders and relief

Sampled by scanning pixel rows across borders in `bt1-0200`:

| Edge | Measured width @1600px | Colour | Evidence |
|---|---|---|---|
| **Coastline** (land ↔ ocean) | 12–14 px (0.78–0.88% of width) | near black `#050102`→`#000000` | scan y=300, x 400–470 |
| **Internal border, different owners** | 5–7 px | `#211809`/`#230000` | scan y=170, x 900–960 |
| **Internal border, same owner** | 4–6 px, slightly softer | `#230000` | scan y=430, x 600–660 |

The thick coastline is really **outline + extrusion side-wall merged**. Model it as two strokes:
a `stroke: #0B0B0D; stroke-width: 3` on every territory path, plus a separate "land union" path behind
it offset `+6px` in Y and filled `#000` at 70% to fake the slab.

Relief inside a territory is produced by a **soft top-left inner highlight and bottom-right inner
shadow** only — there is no texture. In `crop-troop-tokens-multicolour.png` the green of North Africa is
~8% lighter along its north edge than along its south edge.

### 1.6 Map edge and vignette

- At rest the board bleeds **full-bleed to all four frame edges** — no frame, no border.
  (`bt1-0200`, `bt3-0052`, `nyc-0115`.)
- A **strong radial vignette** darkens the outer ~20% of the frame toward `#06202A`.
- When zoomed in past the board's extent, the **slab edge** appears: a 10 px lit bevel with pure black
  beyond (`bt5-0108`, top-right corner). Implement as a `box-shadow`/bevel on the map wrapper, visible
  only at high zoom.
- During any modal (deploy slider, cards panel, end-turn dialog) the whole board is **dimmed by a dark
  scrim**. Measured dim factor ≈ **0.78–0.88** of the undimmed value (red token `#D93244` → `#C12F3F`
  in `bt4-0028`); modelled as `rgba(0,0,0,0.42)` over the map, plus the modal's own warm/cool tint
  (`bt1-0055-received-troops-award-popup.jpg` tints the board *red* because the active player is red).

### 1.7 How the map sits in the viewport

- **The game is landscape-locked.** Every single piece of evidence — including the iPhone store
  screenshots (`store/appstore-iphone-01-battle.jpg`, 1920×1080) — is landscape. There is no portrait
  frame anywhere in 304 files.
- The map is **fit-to-contain with generous bleed**: the board is scaled so the *continents* fill
  roughly the central 72% of the width and 80% of the height, with ocean (and therefore HUD safe area)
  on all sides. The right ~13% is reserved for the player roster, the bottom ~14% for the action bar,
  the left ~10% for the icon stack.
- Panning and pinch-zoom are free-form; `bt5-0108` is a ~2.5× zoom of the North Atlantic, `bt3-0104` a
  zoom on Australia.

---

## 2. Palette

All values are estimates sampled from compressed frames. Where a "dimmed" and "bright" reading differ,
the **bright** reading (from an undimmed frame) is the canonical token.

### 2.1 Ocean and board

| Token | Hex | Evidence |
|---|---|---|
| `--ocean` (flat playfield water) | `#22A4C8` | `bt3-0052` scans at x=560 / y=760 |
| `--ocean-coast-glow` | `#7FE3FF` → transparent | `bt1-0200` offshore `#3FACEF`, `#6EC6D2` |
| `--ocean-deep` (vignette target) | `#06202A` | `bt1-0200` corners `#08242D`, `#020C0F` |
| `--ocean-lines` | `rgba(255,255,255,0.10)` | visible net in `bt3-0052`, `bt1-0025` |
| `--land-neutral` (off-board / unplayable) | `#6B7785` | `nyc-0115` `#65717F`; `bt3-0052` `#5A6570` |
| `--land-outline` | `#0B0B0D` | border scans, `bt1-0200` |
| `--land-wall` (extrusion side) | `#07070A` | `bt5-0108` side-walls |
| `--sea-route` (dashed adjacency) | `#FFFFFF` @ 85%, 4 px dash 14/12 | `bt1-0200`, `bt5-0108`, `nyc-0115` |
| `--sea-route-node` | `#FFFFFF` solid disc r=7 | same |

### 2.2 Player colours

Sampled from **troop tokens** (the purest read of a player colour — the disc is the brightest surface)
using a median-of-ring sampler.

| Player | Token / canonical | Land top face | Measured | Evidence |
|---|---|---|---|---|
| **Red** | `#D93244` | `#A8293A` | `#D93244`, `#D53443`, `#CD3243` | `nyc-0115`, `bt1-0200` |
| **Green** | `#8FC94F` | `#4A7A3C` | `#91CB5C`, `#9CD864`, `#8EC45C` | `bt1-0200` |
| **Blue** | `#4DABF1` | `#3A7FB5` | `#4DABF1`, `#46A9EE` | `nyc-0115` |
| **Yellow** | `#E0B52E` | `#B59525` | `#DCAF2D`, `#BD9726` | `bt4-0028` |
| **Orange** | `#E7773D` | `#B5652C` | `#E7773D`, `#C47039` | `nyc-0115`, `bt5-0108` |
| **Pink / Magenta** | `#D139AD` | `#9B2A80` | `#D139AD`, `#CE33AB`, `#BE329E` | `nyc-0115`, `bt4-0028` |
| **Black** | `#3D3D3D` | `#2B2B2D` | `#3D3D3D`, `#3F3F3F` | `nyc-0115` |
| **White** | `#D3D4D4` | `#B4B7BA` | `#D3D5D3`, `#D3D4D4` | `nyc-0115` |
| **Purple** *(9th, premium?)* | `#7B3FE0` | `#4A2A86` | badge `#6828BC`, ring `#461D75` | `bt2-0025` |

Note the deep plum readings in `bt1-0200` (`#82246C`, `#681C55`) — that frame is dimmed by the deploy
modal; undimmed they resolve to the Pink/Magenta family, not a separate colour.

**Selected / highlighted state pushes the owner hue to near-full saturation.** In
`crop-troop-tokens-multicolour.png` the selected East Africa reads `#DB0001` (pure red) against the
owner red `#A8293A`; in `bt2-0025` the selected purple territory reads `#4A00E9`. Reproduce as
`hsl(var(--h) 100% 46%)`, i.e. keep the hue, clamp saturation to 100%.

### 2.3 Continent accents (Continent Overlay only)

From `bt3-0052-continent-overlay-bonus-legend.jpg` / `crop-continent-bonus-overlay.png`. Each continent
gets a **glowing perimeter stroke** (the bright value) and a **dark tinted fill** (the dark value).

| Continent | Accent stroke | Tinted fill | Evidence |
|---|---|---|---|
| North America | `#36B0EA` | `#0A2431` | outline `#3EABE7`/`#2FB5EA`, fill `#073147` |
| South America | `#DA3A4F` | `#300B0C` | outline `#DA3A4F`/`#D84256` |
| Europe | `#5FBF2A` | `#1B310B` | outline `#2F6112` (dimmed), fill `#1B310B` |
| Africa | `#9B4AE8` | `#1E0D31` | fill `#1E0D31`, violet rim |
| Asia | `#E08A24` | `#0E0903` | fill `#623207`, orange rim |
| Australia | `#F0C33A` | `#312A0F` | fill `#564419`, amber rim |

These match the classic Hasbro continent colours closely enough to read as "RISK" without copying art.
The picker-tile renders use the same hue set as thin outlines (`web/wiki-classic-map.jpg`).

### 2.4 UI chrome

The chrome is **dark navy-teal glass**, not wood and not parchment. (Parchment is reserved for cards.)

| Token | Hex | Where |
|---|---|---|
| `--chrome-900` (menu background base) | `#0D1E30` | `c3d-0813` header bar, sampled `#0D1E30` flat |
| `--chrome-800` (panel) | `#101D24` | `bt5-0025` Bonus panel `#0D1213`/`#071C21` |
| `--chrome-700` (HUD bar / toolbar, translucent) | `rgba(12,42,52,0.70)` | `bt3-0052` toolbar `#125163` over ocean |
| `--chrome-600` (menu card top) | `#2A7F9E` | `c3d-0813` card `#277B94` |
| `--chrome-650` (menu card bottom) | `#1B5570` | `c3d-0813` card `#206177` |
| `--chrome-tray` (grey icon-button tray) | `#B9B6B0` → `#8E8B85` | `c3d-0813` back button `#B6B3AC`; `bt3-0052` close tray |
| `--menu-ray` (radial sunburst behind hero) | `rgba(90,175,215,0.22)` | `c3d-0001`, `c3d-0801` |
| `--scrim` (modal dim over board) | `rgba(0,0,0,0.42)` | measured dim factor 0.78–0.88 |

### 2.5 Semantic / action colours

| Token | Hex | Evidence |
|---|---|---|
| `--go` primary green (fill, top) | `#A6DC5F` | `bt5-0025` Trade-In button `#EAF5E0`→`#79A75D`; `c3d-0813` BATTLE `#ACE170` |
| `--go-mid` | `#7FBE42` | `bt3-0052` End Attack Phase `#76A057` |
| `--go-deep` (bottom + border) | `#4E7C2A` | `bt5-0025` `#496827` |
| `--danger` red (fill) | `#D8415C` | `bt1-0200` ✗ button `#BE2D3E`; `bt5-0025` close `#B52A3B` |
| `--danger-deep` (rim) | `#8C2739` | `bt4-0126` dialog ✗ rim `#8C2739` |
| `--ok` green circle button | `#7ED957` → `#55B13C` | `bt4-0126` `#69BD55`; `bt1-0200` ✓ `#91C85C` |
| `--accent-gold` (win chance, active toggle icon) | `#F0C40F` | measured below, §2.6 |
| `--accent-cyan` (active segmented toggle) | `#19A7DB` | `c3d-0813` 1v1 pill `#19A7DB`/`#12C8F9` |
| `--warn-amber` dialog top | `#E6A93A` | `bt4-0126` `#E7B449` |
| `--warn-amber-bottom` | `#EFCB55` | `bt4-0126` `#EBC651` |
| `--warn-amber-border` | `#EDC94F` | `bt4-0126` |
| `--brand-red` (RISK logo / ribbon) | `#C42A30` | `bt4-0036` logo `#C42A30`; `c3d-0801` sale ribbon |
| `--tip-card-top` | `#304064` | `bt4-0036` |
| `--tip-card-bottom` | `#103059` | `bt4-0036` |
| `--card-paper` | `#F3E6CB` | `crop-card-single-infantry-japan.png`, `#F6EAD2` |
| `--card-paper-edge` | `#D8C9A4` | same, inner rule |
| `--card-suit` deep red | `#BE2E36` | `bt5-0025` suit figures `#A82636`/`#B93546` |

### 2.6 Text

| Token | Hex | Notes |
|---|---|---|
| `--text` | `#FFFFFF` | all headings and most HUD text |
| `--text-outline` | `#161616` | **every piece of text over the board carries a 3–4 px dark outline + 2 px drop shadow.** This is the single most characteristic typographic move. (`bt1-0200` territory labels, `Deploy Troops` title, token numbers.) |
| `--text-muted` | `#A9B6BC` | "3/9 (33%)" under continent names (`crop-continent-bonus-badge.png`); "7/7 Troops" (`crop-attack-limit-slider.png`) |
| `--text-dim` | `#6D8792` | far/inactive slider numerals (`crop-deploy-troops-count-slider.png`) |
| `--text-on-amber` | `#4A3410` | body copy inside the End Turn dialog (`bt4-0126`) |
| `--text-on-paper` | `#2A2318` | card body (rare; card names are white-on-outline) |

### 2.7 Blitz win-chance colour ramp — **there isn't one**

The brief assumed a probability colour ramp. **There is not one.** I pulled the most-saturated bright
pixel cluster from the percentage readout in all five odds frames:

| Frame | Odds | Sampled readout colour |
|---|---|---|
| `bt2-0025-blitz-win-chance-100-attack-limit.jpg` | 100% | `#E3C108` |
| `bt3-0032-blitz-win-chance-100-vs-green.jpg` | 100% | `#CBB82D` |
| `bt2-0045-blitz-win-chance-99-dice.jpg` | 99% | `#CAB62F` |
| `bt5-0105-blitz-win-chance-99.jpg` | 99% | `#C7B738` |
| `bt2-0135-blitz-win-chance-91.jpg` | 91% | `#E6C40B` |
| `bt6-0050-blitz-win-chance-46-attack-limit.jpg` | 46% | `#E7C20F` |
| `bt2-0150-blitz-win-chance-6-low-odds.jpg` | 6% | `#E3C10A` (visually identical in the frame) |

**The percentage is a constant gold `#F0C40F` at every probability**, 100% down to 6%. The only thing
that changes is the number. Everything else in the battle view (dice colour, arrow, discs) is also
unchanged. Variance in the table is JPEG noise and the per-frame scrim.

**Recommendation:** keep the constant gold to stay faithful, but add an *optional* opt-in ramp as a
usability improvement, clearly flagged as a deviation:
`≥90% #7ED957` · `70–89% #C6D84A` · `40–69% #F0C40F` · `15–39% #E8863A` · `<15% #D8415C`.

---

## 3. Troop tokens

Best evidence: `crop-troop-tokens-multicolour.png` and `crop-troop-tokens-purple-magenta.png`
(2× crops of `bt1-0200`), plus `nyc-0115` for small-territory behaviour.

### 3.1 Geometry

- **A flat circular chip with a short cylindrical body** — like a poker chip seen from ~10° above.
  At 1600×900 on the Classic map the disc is **r ≈ 19 px** (diameter 38 px ≈ **2.4% of frame width**).
  On the denser NYC map (`nyc-0115`) it is **r ≈ 15 px**. It does **not** scale with the territory;
  it is a fixed screen-space size per map, so it stays legible when territories are tiny.
- **Body depth ≈ 5–6 px**: a second ellipse of the owner colour at ~65% lightness, offset +5 px in Y,
  drawn behind the face. Clearly visible on every token in `crop-troop-tokens-multicolour.png`.
- **Rim**: a 2 px stroke of the owner colour at ~55% lightness around the face.
- **Drop shadow**: soft, offset `0 4px 6px rgba(0,0,0,0.45)` — the token floats above the land.
- **Fill = owner colour at the bright "token" value** (§2.2), which is noticeably **lighter than the
  territory it sits on** (green token `#91CB5C` on green land `#47763C`). This two-value system is what
  makes tokens pop.

### 3.2 Number

- Heavy weight (800/900), **white**, with a **3 px near-black outline** and a subtle dark drop shadow.
- Cap height ≈ **0.62 × disc diameter** for one digit (≈24 px on a 38 px disc).
- **Two digits**: the disc stays the same size, the type is condensed/tracked down to ≈0.52×.
  `bt5-0108` shows a "10" and `nyc-0115` a "10" at the same disc size as a "1".
- **Three digits**: no direct evidence. Recommendation — **widen the disc into a stadium/pill**
  (`rx = r`, width grows) rather than shrinking the type below ~0.42×. The store shots
  (`store/play-16.jpg`) already show stadium-shaped tokens in the older art style, so the pill reads as
  in-family. Cap at 3 digits; beyond that show `99+`-style truncation.

### 3.3 States

| State | Treatment | Evidence |
|---|---|---|
| **Idle** | as above | `bt1-0200` |
| **Owned & actionable (your turn, draft)** | territory gets a soft owner-coloured outer glow; token unchanged | `c3d-0140-draft-prompt-territories-highlighted.jpg` |
| **Selected (source)** | **territory fill jumps to full saturation** + a **3 px pure-white outline** following the territory path + an outer white glow. Token itself unchanged. | `crop-troop-tokens-multicolour.png` (East Africa), `bt4-0028` (Brazil), `bt2-0025` |
| **Legal attack target** | the territory is *lit* while all non-participants are darkened; a white outline is drawn on the target too | `bt2-0105-attack-select-adjacent-territory.jpg`, `bt2-0150` (grey defender outlined white) |
| **Under attack (battle view)** | both territories keep white outlines; everything else gets a heavy dark scrim; tokens are **replaced by 3D troop figurines** | `bt2-0025`, `crop-3d-troop-figures-on-territory.png` |
| **Just conquered** | a floating `−1` / `−4` damage numeral rises off the territory, then the fill wipes to the new owner colour | `bt3-0036-blitz-conquest-minus1.jpg`, `store/play-16.jpg` (`-4`, `-1`) |
| **Fog of war** | token shows `?` and the roster shows `???` | `c3d-0610`, `crop-player-roster-fogged.png` |

**I did not observe a pulsing ring or an animated marching-ants selection** — the selected state is a
static white outline plus a glow. Any pulse is my recommendation, not evidence.

### 3.4 Attack arrow

`bt2-0025`, `bt2-0045`, `bt2-0150`:

- A single **white, solid, gently curved arrow** from the source territory to the target.
- Stroke ≈ **8 px**, tapering slightly; solid **triangular arrowhead ≈ 22 px long**.
- It has a thin dark outline (1.5 px `#1A1A1A`) so it reads over both land and water.
- It arcs upward — a quadratic Bézier with the control point offset perpendicular to the chord by
  ~22% of the chord length.
- It is drawn **above** the troop figurines and below the dice popup.

### 3.5 Fortify path indicator

`bt4-0028-fortify-troops-slider-arrow-path.jpg` — distinct from the attack arrow:

- **A line of discrete white chevrons (`›`) marching along the route**, not a continuous arrow.
- Each chevron ≈ **22 px wide × 26 px tall**, stroke weight ~7 px, white with a 2 px dark outline.
- Spacing ≈ **34 px** centre to centre; they follow a smooth spline through the chain of connected
  territories (Brazil → … → Western Europe in that frame, crossing the Atlantic).
- Both endpoints get the bright-saturated + white-outline **selected** treatment.
- Recommendation: animate them with `stroke-dashoffset` or a staggered opacity pulse travelling
  source→destination, 900 ms loop.

---

## 4. HUD layout

Measured on `bt3-0052` and `bt1-0200` (both 1600×900). `%W` / `%H` are fractions of the frame.

### 4.1 Global frame

```
┌──────────────────────────────────────────────────────────┐
│ ⚙ ? 🎲                 [ title pill ]                    │ top, y 0–8%H
│                                                          │
│ [overlay                                       ┌────────┐│ roster, right edge
│  toolbar]            M A P                     │ player ││ x 87–100 %W
│  x 3–9%W                                       │  rows  ││ y 25–80 %H
│                                                └────────┘│
│ ▣ stats                                                  │
│ ▭ cards  ▣ emote    [avatar] PHASE  [btn]  [dice]        │ bottom, y 84–100%H
└──────────────────────────────────────────────────────────┘
```

### 4.2 Top-left utility icons

`bt3-0052`, `nyc-0115`, `bt1-0200`.

- Three circular **outline-only** buttons: ⚙ settings, ? help, 🎲 dice-settings.
- Centres ≈ **(52, 52) (130, 52) (210, 52)** → r ≈ 22 px (1.4%W), pitch 78 px (4.9%W).
- 3 px white stroke, no fill, white glyph. In some states only `?` is shown (`bt1-0200`, `bt5-0025`).
- A Wi-Fi/connection glyph may follow at x≈315 (`nyc-0115`).

### 4.3 Title pill

- Centred, y **20–62 px** (2.2–6.9 %H), auto width.
- Dark translucent `rgba(14,42,51,0.72)`, radius 10 px, padding 10 px 26 px.
- Bold white 30 px with dark outline. Used for "Continent Overlay", "Cards", "Deploy Troops",
  "Fortify Troops", "Get Ready", "Victory!", "Blitz Win Chance".
- Some variants have no pill at all and rely on the text outline (`bt1-0200`, `bt1-0025`).

### 4.4 Player roster — **right edge, not a top bar**

`crop-player-roster-sidebar.png`, `crop-player-roster-fogged.png`, `nyc-0115`, `bt5-0108`.

> RGD does **not** use a top player bar. The roster is a vertical stack of capsules flush to the right
> edge, and each capsule **bleeds off the right side of the screen**. This is a defining layout choice.

| Property | Value @1600×900 | %  |
|---|---|---|
| Stack x range | 1395 → 1600+ (clipped) | 87.2 → 100 %W |
| Row pitch | ≈ 125 px | 13.9 %H |
| Row height | ≈ 96 px | 10.7 %H |
| First row centre y (4 players) | ≈ 265 px | 29.4 %H |
| Avatar disc r | ≈ 38 px | 2.4 %W |
| Capsule radius | = height/2 (full pill) | — |

Row anatomy, left → right:
1. **Capsule body** — translucent near-black `rgba(14,18,20,0.80)` with a **2 px stroke in the owner
   colour**; the *active* player's capsule is instead **filled with the owner colour** and is wider
   (it extends ~40 px further left) with a small white chevron tab poking out of the right edge.
2. **Troop icon** (soldier silhouette, white, 22 px) + **count** (bold white 28 px).
3. **Territory icon** (map-pin, white, 22 px) + **count** (bold white 28 px).
4. **Card-count tag** — a small **tilted cream card** (≈30×38 px, rotated −12°) carrying a dark number,
   overlapping the top-left of the avatar.
5. **Avatar** — circular portrait with a ring in the owner colour. The **human player's avatar gets a
   gold laurel wreath** instead of a plain ring (`crop-attacker-avatar-disc.png`) and a white **`YOU`**
   pill hanging below it.
6. **Bot badge** — a small circular white **robot glyph** chip hanging below the avatar
   (`crop-player-roster-sidebar.png`).
7. **Eliminated** — the avatar is replaced by a dark disc with a **white skull** glyph
   (`bt5-0108`, bottom row; `store/play-16.jpg` top row).
8. **Fog of war** — counts render `???` (`crop-player-roster-fogged.png`).
9. **Chat bubbles** pop out to the *left* of a row (`store/play-16.jpg`: "Wow!", a sword emote).

**Turn timer:** I found **no ring timer on the roster**. The only timer evidence is the thin horizontal
progress bar under the player name in the bottom bar of the older store art
(`store/play-16.jpg`, `store/appstore-iphone-01-battle.jpg` — a blue bar under "Alexa The Great"). The
setup screen confirms a turn timer exists ("Turn Timer: 60s", `c3d-0001`). Recommendation: a 4 px
progress bar under the phase label, draining left→right, tinted `--accent-cyan` → `--danger` under 10 s.

### 4.5 Left icon stack (bottom-left)

`bt3-0052`, `bt1-0200`, `nyc-0115`:

- **Stats button** — rounded square **90×90 px** (radius 16), grey tray `#B9B6B0`→`#8E8B85`, gold bar-chart
  glyph. Centre ≈ (80, 675) = (5%W, 75%H).
- **Cards chip** — a **parchment card shape**, ≈95×112 px, rotated ≈ −8°, with the held-card count in
  bold dark numerals. Centre ≈ (85, 820) = (5.3%W, 91%H). A **red badge** appears top-right when a
  trade is available.
- **Emote/chat button** — rounded square 90×90, grey tray, a speaking-head glyph, with a **red unread
  badge** (`crop-cards-and-emote-buttons.png`). Centre ≈ (215, 818).

### 4.6 Overlay toolbar (Continent Overlay mode only)

`crop-left-toolbar-overlay-buttons.png`, `bt3-0052`:

- A **vertical dark-teal translucent capsule**, x 45–145 px (w 100 = 6.25%W), y 365–700 px, radius 50.
- Three stacked 44 px icon toggles: *troop view* / *globe overlay* / *player view*.
  The **active** one is **gold `#E8C43A`**, inactive are white.
- Below, detached: a **grey rounded-square tray** (90×100, radius 18) holding a **red circular close
  button** (r 34, `#D8415C` with `#8C2739` rim and a white ✗).

### 4.7 Bottom action bar

`crop-bottom-action-bar-attack.png`, `crop-bottom-action-bar-opponents-turn.png`, `bt3-0052`, `ita-0030`.

| Element | Measured @1600×900 | % |
|---|---|---|
| Bar band (translucent) | y 770 → 900 | 85.6 → 100 %H |
| Avatar disc (with laurel) | centre ≈ (575, 815), r ≈ 55 | 36%W, 90.5%H |
| Phase label baseline | y ≈ 790 | 87.8 %H |
| Phase pip row | y 795–807, total w ≈ 300 centred on 800 | 18.8 %W, h 1.3 %H |
| **Primary button** | **x 680–918, y 822–870 → 238 × 48 px** | **14.9 %W × 5.3 %H** |
| Dice / mode button | centre ≈ (995, 812), r ≈ 58 | 62%W, 90%H |

- **Phase label**: `DRAFT` / `ATTACK` / `FORTIFY` / `CAPITAL` (`ita-0030-capital-phase-bottom-bar.jpg`),
  bold white ~28 px, **letter-spaced ≈ 3 px**, with a dark outline.
- **Phase pips**: a 3-segment progress bar, not tabs. Each segment ≈ 92 × 12 px, radius 6, gap 12 px.
  Active = **white**, inactive = `#6B7378`. In `bt3-0052` the middle (Attack) pip is white.
- **Primary button**: a full-radius **pill**, green gradient `#A6DC5F → #7FBE42`, **3 px `#4E7C2A`
  border**, a 2 px lighter inner top highlight, `0 4px 0 #3E6420` bottom bezel plus a soft shadow.
  Label bold white ~24 px with a 3 px dark outline. Copy varies: `End Attack Phase`, `End Turn`,
  `Trade In Now +10`, `BATTLE`, `Join`.
- **Disabled / opponent's turn**: the pill goes **flat grey** `#757575` with `#505050` border and
  mid-grey text, label `Opponent's Turn` (`crop-bottom-action-bar-opponents-turn.png`).
- **Card tag** rides on the avatar's top-left, same tilted-cream-card motif as the roster.
- **Dice button**: a circular owner-tinted disc holding a large white-pipped red die face; in
  `c3d-0610` it instead shows a green map-route glyph (mode toggle).

### 4.8 Continent-bonus legend overlay

`bt3-0052`, `crop-continent-bonus-overlay.png`, `crop-continent-bonus-badge.png`, `ita-0130`.

Each continent gets a badge anchored at its centroid:

1. **A radial progress ring.** Outer r ≈ 36 px, ring thickness ≈ 7 px, dark track `rgba(0,0,0,0.55)`,
   progress arc in **white**, starting at 12 o'clock going clockwise. North America shows 3/9 → a 33%
   arc. *This is a donut progress indicator, not decoration* — a lovely detail to reproduce.
2. **`+N`** inside the ring, bold white ~30 px with dark outline.
3. **A name plate** directly below: dark pill `rgba(10,18,22,0.85)`, radius 8, 2 px light stroke,
   padding 4 px 14 px, bold white ~22 px.
4. **A caption** below that: `3/9 (33%)` in `--text-muted` ~16 px.

The continent itself is filled with its dark tint and stroked with its glowing accent (§2.3).
`ita-0130` proves the same component works for arbitrary custom regions with long names.

### 4.9 Dice / Blitz popup

`bt2-0025`, `bt2-0150`, `crop-dice-blitz-popup.png`, `bt6-0030`, `bt6-0135`.

This is a **full-screen takeover of the board**, not a dialog box. Layout:

| Element | Position | Detail |
|---|---|---|
| **Attacker disc** | top-left, centre ≈ (230, 200), r ≈ 150 | circular portrait, **gold laurel wreath ring** if it's you; a plain 10 px ring in the player colour if not. A **country-flag chip** (r 36) hangs at 7 o'clock carrying the **committed troop count** in bold white. |
| **Defender disc** | top-right, mirrored, centre ≈ (1400, 230) | same, but bots get a **plain grey/owner ring + a robot glyph chip** instead of the laurel (`bt2-0150`, `crop-defender-avatar-disc.png`). |
| **"Blitz Win Chance ?"** | centred, y ≈ 42 | bold white ~30 px + a small `?` help affordance |
| **Percentage** | centred, y ≈ 92 | bold **gold `#F0C40F`** ~44 px — constant at all odds (§2.7) |
| **Dice cluster** | centred low, y ≈ 540–840 | **three 3D rounded-cube dice**, ≈150 px per face, body `#E02030` lit / `#B01525` shaded, pips cream `#F5F0E8` and slightly ovoid. A **white radial burst** glows behind the stack. |
| **◀ ▶ steppers** | flanking the dice, centres ≈ (620, 775) and (975, 775) | thick **blocky chevrons** (not thin arrows), ≈ 60×75 px, `#C8233A` with a lighter top bevel and a dark bottom edge |
| **"Blitz" label** | under the dice, y ≈ 855 | bold white ~34 px with dark outline; the steppers cycle this between `Blitz` and manual dice counts |
| **Attack-limit readout** | bottom-right | `100%` bold white 40 px; `7/7 Troops` `--text-muted` 24 px beneath |
| **Attack-limit slider** | bottom-right, track x ≈ 1215–1475, y ≈ 790 | track h ≈ 14 px fully rounded, unfilled `#8E1F2C`, filled `#D9344A`; **knob r ≈ 24** in owner red with a white soldier glyph. Label `Attack Limit ?` below in bold white 20 px. (`crop-attack-limit-slider.png`) |
| **Board behind** | | heavily scrimmed except the two combatant territories, which keep white outlines and show **3D troop figurines** (up to 3) standing on small light pedestals |

**Manual dice roll** (`bt6-0030`, `crop-manual-dice-roll.png`) throws the same dice *onto the board* at
the contested border, tumbling, then settles them face-up (`bt6-0135`).

### 4.10 Troop-count slider (deploy / fortify / post-conquest move)

`crop-deploy-troops-count-slider.png`, `bt1-0145`, `bt1-0200`, `bt4-0028`.

A single reusable component. At 1600×900:

- **A dark translucent horizontal strip** spanning the full width, y ≈ 600–738 (h 138 px, 15.3 %H),
  `rgba(10,45,55,0.55)`.
- **Left: red circular ✗** — centre (480, 668), r ≈ 40. Radial fill `#E04A5C → #C42B3E`, 4 px `#8E1F2C`
  rim, 6 px bottom bezel, white ✗ glyph with a soft inner shadow.
- **Right: green circular ✓** — centre (1122, 668), r ≈ 40. `#A6DC5F → #7AB53F`, `#4E7C2A` rim, white ✓.
- **The numerals** run between them, roughly evenly spaced (1 2 3 4 5 at x ≈ 553, 678, 800, 925, 1050).
  Unselected: bold **grey** `#C9CFD2` ~52 px, fading to `#6D8792` as they get further from the value.
- **The selected value sits inside the "notched ring"** — the signature RGD motif: a thick ring
  (outer r ≈ 55, stroke ≈ 16) in `#E2455A`, with a **small downward triangular notch cut into the
  bottom** so it reads like a map pin / speech bubble. The numeral inside is white with a 4 px dark
  outline.
- The strip is **horizontally draggable** — the numerals scroll through it.

**The same notched ring recurs** in the Received-Troops popup (`bt1-0055`) and as the active-row marker
in the card Bonus legend (`bt5-0025`). Make it a shared component.

### 4.11 Card-trade panel

`bt5-0025-card-trade-panel-plus10.jpg` (+6: `bt5-0045`, +12 / 5 cards: `bt5-0115`, forced: `bt5-0145`),
`crop-card-single-infantry-japan.png`, `crop-card-set-three.png`, `crop-card-bonus-legend.png`.

- Board is scrimmed to ~`rgba(0,0,0,0.55)`; title pill **"Cards"** at the top; red circular ✗ on a grey
  tray at mid-left (centre ≈ (75, 512)).
- **Cards** are laid out in a shallow fan across the centre, y ≈ 110–430 at 1600×900.
  - Size ≈ **175 × 320 px** (aspect **≈ 0.55**, i.e. a tall 5:9 card).
  - Radius ≈ **18 px**.
  - Fill `--card-paper` `#F3E6CB`, with a **4 px inset rule** in `#D8C9A4` tracing the card edge.
  - A very faint **radial sunburst** of slightly lighter cream radiating from the suit figure.
  - **Rotation**: ±4–6°, alternating; the middle card is upright. Overlap ≈ 20 px.
  - **Drop shadow** `0 10px 18px rgba(0,0,0,0.5)`.
- **Suit art**: a silhouette figure in `--card-suit` `#BE2E36`, occupying the top ~45% —
  **Infantry** = a standing rifleman; **Cavalry** = a rearing horse and rider; **Artillery** = a
  field cannon; **Wild** = not observed (see §9).
- **Territory silhouette**: the territory's actual outline, filled in what appears to be the
  **current owner's colour** (Japan and Indonesia ochre, Ukraine near-black in `bt5-0025`, matching
  their owners on that board). *Moderate confidence.* Placed in the lower ~35%.
- **Territory name**: bold white ~30 px with a heavy 4 px dark outline, overlapping the silhouette,
  horizontally centred.
- **Selected state**: a **white dashed border** drawn ~8 px *outside* the card
  (dash ≈ 14/10, 4 px) — unmistakable in `crop-card-single-infantry-japan.png`. The card also lifts
  (translateY −14 px) and gains a stronger shadow.
- **Bonus legend** (right, x ≈ 1320–1565, y ≈ 150–490):
  - Panel `#101D24` at ~92%, radius 12, 2 px `#243640` stroke.
  - **Header pill "Bonus"** — red gradient `#D8415C → #A3203A`, radius 10, bold white 26 px, overlapping
    the panel's top edge.
  - Four rows: `4 Infantry` · `6 Cavalry` · `8 Artillery` · `10 All Three`. Number bold white 34 px
    left, label `#D4DBDF` 26 px right.
  - **The row matching the current selection is ringed by the notched red ring** (`10 All Three` in
    `bt5-0025`).
- **Primary action**: the green pill **`Trade In Now` + `+10`** centred at (795, 530), ≈ 530 × 58 px —
  noticeably larger than the in-board End-Turn pill. (`crop-trade-in-now-button.png`.)
- **Forced trade** (`bt5-0145`) is the same panel with the ✗ removed.
- Card award (`c3d-0250`) animates a single card flying up off the board with a `+1`.

### 4.12 Post-conquest troop move

No dedicated frame exists, but `bt6-0140-conquest-after-manual-roll.jpg` and the identical slider used by
deploy/fortify make the answer obvious: **reuse the §4.10 slider** with the title `Move Troops`, the
range being `[attacking dice count … source troops − 1]`, and the fortify chevron path drawn between the
two territories.

### 4.13 Elimination and seizure

- `bt5-0108-territory-cards-seized-on-elimination.jpg` and `c3d-0743-territory-cards-seized-plus2.jpg`:
  the defeated player's **roster row flips to a dark disc with a white skull glyph** and the row's
  colour stroke desaturates. The seized cards animate toward the attacker's card chip with a `+2`.
- `store/play-16.jpg` top roster row shows the same skull-disc treatment at high resolution.
- The index lists `bt5-0104` as a "Defeated!" banner but **that frame actually shows the 99 % Blitz
  view** — the full-screen elimination banner is not in the evidence set (see §9). Design it to match
  the Victory screen (§4.14) with a desaturated portrait and the word `Defeated!`.

### 4.14 Victory screen

`bt1-0025-victory-screen-conquered-all.jpg`, `c3d-0749`, `c3d-0751`.

- The board stays visible behind, now entirely the winner's colour, with the vignette and ocean intact.
- **Title `Victory!`** centred at y ≈ 95 px, bold white ~56 px with a 5 px dark outline.
- **A circular portrait** at centre (800, 420), r ≈ 150, ringed by a **thick gold laurel wreath**.
- **A radiating burst of ~24 white five-pointed stars** fanning out from behind the portrait across
  ~240° — varying sizes 20–60 px, soft white glow.
- **A name plate** below: translucent white/grey rounded pill ≈ 620 × 60 px, radius 30, containing a
  flag chip, the player name in bold white 36 px, and a small red verified tick.
- **Subtitle** `You conquered all your opponents!` in `#D6DEE2` ~30 px at y ≈ 790.
- `c3d-0751` adds a **Battle Points Earned** readout below.

### 4.15 End-turn confirmation dialog

`bt4-0126-end-turn-skip-fortify-confirm-dialog.jpg`.

- A **full-width amber banner that slides down from the top**, y 0 → 440 px (49 %H), with **rounded
  bottom corners (r ≈ 20 px)** only.
- Fill: vertical gradient `#E6A93A` (top) → `#EFCB55` (bottom); **4 px border `#EDC94F`** with a darker
  outer line; a soft shadow onto the board.
- Title `End Turn` centred at y ≈ 75, bold white ~58 px with a **brown-black outline** and drop shadow.
- Body `Skip Fortify phase?` in `#4A3410` ~34 px; sub-note
  `(This confirmation can be turned off in game settings)` ~22 px, same colour.
- Two **large circular buttons** at y ≈ 338, r ≈ 54, 200 px apart:
  **✗** `#D8415C` with `#8C2739` rim · **✓** `#7ED957` with `#55B13C` rim. Both with a 6 px bottom
  bezel and white glyphs.
- The board behind is scrimmed and tinted warm.

### 4.16 "Get Ready" player assignment

`bt1-0115-get-ready-player-assignment.jpg`.

- Same composition as Victory: scrimmed board, a **radial sunburst of rays in the player's colour**
  behind a laurel-ringed circular portrait at centre.
- Title `Get Ready` at y ≈ 118, bold white 56 px.
- Name plate pill (as §4.14).
- Line 1: `You are **player 2** – General of the ● **Red** Troops` — white 36 px, with the colour word
  preceded by a **filled disc swatch in that colour**.
- Line 2: `Each turn you will DRAFT > ATTACK > FORTIFY.` — `#C6D2D8` 24 px, the phase names in bold
  caps. (`c3d-0012-lobby-waiting-for-host.jpg` carries the same hint in the lobby.)

### 4.17 Received-troops popup

`bt1-0055-received-troops-award-popup.jpg`.

- **A turn banner across the very top**: full-width, owner-coloured (`#F1455F` for red), h ≈ 78 px,
  rounded bottom corners, containing `🇦🇺 Solace ✓ turn (YOU)` in bold white 34 px.
- **A header bar** below it at y 212–270: a wide owner-coloured pill ≈ 840 px wide with the text
  `Received Troops` in bold white 36 px, with a lighter top highlight.
- **The notched ring** (§4.10 motif) at centre (800, 383), outer r ≈ 62, stroke 14, in the owner colour,
  containing the number in white 60 px.
- Caption `Total troops` in `#C9D4D8` 24 px, then
  `Troops awarded for occupying **10 territories**` in white 32 px.
- The board behind is scrimmed *and tinted the owner colour*, with an owner-coloured sunburst.
- `c3d-0030` and `nyc-0445` are the same component at turn start with a 3D troop model.

### 4.18 Tip / tutorial card

`bt4-0036-tip-fortify-once-per-turn.jpg`, `bt4-0120`, `bt5-0015/0120/0125`, `bt6-0015/0040/0200`.

- **A full-width top banner** (`#203A5F`, y 0–240, bottom corners r ≈ 24) carrying the **RISK logo**
  (`#C42A30` block letters with a white outline and a cavalry silhouette).
- **A large rounded card** below-right: x 570–1480, y 330–760, radius ≈ 30 px.
  Vertical gradient `#304064` → `#103059`, with a **broad specular sheen** across the upper third and a
  2 px lighter top edge.
- **A badge icon** at the left of the card: a small cyan shield with an `R`, ≈ 70×80 px.
- **Body copy**: bold white 54 px with a 4 px dark outline, 2 lines max, left-aligned after the badge.
- **A character render** (the General) stands at the far left, overlapping both banner and card — in a
  replica, substitute an SVG silhouette or omit.
- These are **modal, dismiss-on-tap**, not transient toasts. I saw no small corner toast anywhere.

### 4.19 Chat / emote panel

`c3d-0610-chat-emote-quickchat-panel.jpg`, `crop-chat-emote-panel.png`, `nyc-0200`, `ita-0600`.

- A **left drawer**, width ≈ 280 / 1272 = **22 %W**, full height, `rgba(20,24,28,0.88)`.
- Top row: own avatar in a gold frame, a **channel pill `ALL`** (grey `#B9B6B0`, radius 20), and a chat
  bubble button.
- **A 3×3 grid of emote tiles**, each ≈ 78×60 px, radius 10, dark tile with the sticker art; the 9th
  slot is `…` (more).
- **Canned quick-chat lines** below as full-width light pills `#DFE3E6`, h ≈ 46 px, radius 23, dark
  centred text: "Good luck!", "Well played!", "Victory!", "Good game!".
- System notices render as plain light text in the same column
  ("The host has deactivated alliances…", `nyc-0200`).
- In-world, an emote appears as a **speech balloon to the left of the sender's roster row**
  (`store/play-16.jpg`).

### 4.20 Troop-bonus / no-matching-cards banner

`c3d-0620-troop-bonus-no-matching-cards.jpg`: a header pill `Troop Bonus!`, body text, the same
4/6/8/10 bonus table, and a **greyed-out disabled button** reading `No Matching Cards` —
flat `#757575` fill, `#505050` border, `#9A9A9A` text. Use this as the canonical disabled-button style.

---

## 5. Menus

### 5.1 Game-type menu — `c3d-0813-select-a-game-type-menu.jpg`

- **Background**: flat `#0D1E30` header strip (h ≈ 95/720 = 13 %H), then a body with a broad
  **radial light-blue ray gradient** from upper-centre, fading to `#0B2A3C` at the corners.
- **Header**: a grey rounded-rect **back button with a chevron** at the far left (overhanging the left
  edge, ≈ 130×58, radius 29, `#B9B6B0`); the page title centred in bold white 34 px with a dark outline;
  a green "emote/friends" chip at the far right.
- **Five equal cards** in a single row, x 42 → 1230 of 1272 (93 %W), y 110 → 555 (62 %H).
  - Card ≈ **230 × 445 px** → **aspect ≈ 0.52** (tall).
  - **Radius ≈ 10 px** — these are *gently* rounded rectangles, not pills.
  - Fill: vertical gradient `#2A7F9E` (top) → `#1B5570` (bottom), with a **lighter horizontal band
    across the middle** (a soft inner glow).
  - **2 px border** in a lighter blue `#4E9CBB`; a subtle outer shadow.
  - A small `?` info circle at the top-right of each card.
  - **Icon zone** (top ~45%): large flat **white/grey glyphs** — person, robot, globe, screen.
    Chunky, rounded, monochrome, no outlines. Easy to redraw as SVG.
  - **Title** bold white ~30 px with a dark outline; **description** `#E2EAEE` 22 px, centred,
    2–4 lines.
  - **Selected card**: the fill switches to an **olive-green gradient** (`#2C391F` base with a bright
    rim), the border glows green, a **sparkle burst** sits behind the icon, a red ribbon badge hangs off
    the top-left, and a **large green circular ✓** (r ≈ 34) straddles the bottom edge.
  - Cards carry extra chips: a progress bar (`PROGRESS 6/6` with an amber fill bar), a season countdown
    pill with a stopwatch icon, and a gold caution line (`NO FRIENDS ALLOWED`).
- **Footer row**, y ≈ 610–690:
  - **Segmented toggle `FFA | 1v1`**: dark track `#242424`, radius 28, h ≈ 56 px, w ≈ 270 px; the
    **active segment is a bright cyan pill `#19A7DB`** with bold white text; inactive text `#BFC6CA`.
  - **Primary `BATTLE` pill**: ≈ 250 × 64 px, green gradient `#ACE170 → #7FBE42`, `#4E7C2A` border,
    bold white 36 px, with a **dark sub-chip** beneath carrying `🌐 GAMES 1`.

### 5.2 Setup / rules screen — `c3d-0001-game-setup-ranked-1v1-rules-toggles.jpg`

- Same header treatment; title `Play Ranked 1v1 Online`; currency chips at the right
  (a gold coin with `∞`, a green emote chip).
- **Centre: the map hero** — a 3D tilted translucent board tray showing the Classic map in parchment
  with continent-coloured outlines, map name `Classic` in bold white above, and:
  - a **player-count chip** overlapping the board's bottom (dark pill, two-person glyph, `1/2`);
  - a **red mode plate** `World Domination` (gradient `#D8415C → #A3203A`, radius 8, bold white 34 px
    with a dark outline), with a small dark `CUSTOM` sub-chip hanging below it.
- **Rules readout**: three centred lines of `**Label:** value` pairs — labels bold white, values
  regular `#CBD6DB`, ~26 px, separated by ~40 px of space. No boxes, no table rules. Very clean.
- **Modifier toggles** at the right: a vertical stack of three **rounded-square icon buttons**
  (≈ 68×68, radius 18) with a label beneath each.
  - **Enabled/available** = red fill `#D8415C` with a white glyph (Blizzards ❄, Fog of War ?).
  - **Disabled/locked** = desaturated grey-blue fill with a dim glyph and `#6E7F88` label (Portals).
- **Rank stepper** at the far right: a chevron-up button, a dark pill showing `5/8`, a chevron-down
  button. Chevrons are large flat light-grey glyphs, ~70 px.
- **Footer**: the same `FFA | 1v1` toggle plus a green `Join` pill carrying a gold coin and cost.

### 5.3 Map picker tiles

`web/mappick-*.jpg` (70 tiles), `web/wiki-classic-map.jpg`.

- **Tile aspect**: 640 × 572 ≈ **1.12 : 1** (near square, slightly landscape). The Classic tile is
  812 × 671 ≈ 1.21 : 1. Design for **~8:7**.
- **Composition** (top → bottom): map name · board render · tagline.
  - **Name**: bold white ~40 px with a 4 px dark outline, centred, at ~9% of tile height.
  - **Board render**: a **translucent blue glass tray** with rounded corners (r ≈ 4% of tile width),
    tilted ~30° back and ~6° yawed, with a **soft elliptical contact shadow** beneath it. Land is
    parchment `#F3DCC0`, coasts a warm ochre `#B8894A` 3 px, internal territory borders thin grey
    `#9AA0A4` 1.5 px, continent perimeters a **2.5 px glowing accent stroke** in the §2.3 hues, and
    **white dotted sea routes** with small white nodes.
  - **Tagline**: regular white ~26 px, 1–2 centred lines, at ~85–95% of tile height.
- **Background**: a **radial ray burst** — pale blue `#5FA8C8` near the centre-left fading to
  `#0E2430`/`#0A1A22` at the corners. The rays are visible as soft alternating wedges.
- **No lock badge is visible on any tile in the evidence.** Locked/DLC state is conveyed on a separate
  **Map Preview** screen (`web/mappick-edo-city.jpg`, `web/mappick-city-of-the-dead.jpg`) which shows
  a left info panel: map name, two stat chips (a globe glyph + continent count, a troop glyph +
  territory count), a description paragraph, `Included in:` plus the pack name in light blue, a 3D
  **pack box-art render**, and the green `BATTLE` pill bottom-right. Recommendation: add a small gold
  padlock chip at the tile's top-right for locked maps, drawn in the same rounded-square-tray style as
  the HUD icon buttons.

### 5.4 Home / main menu

`c3d-0801-home-main-menu.jpg`, `c3d-0811`.

Dark teal-navy field with a faint ghosted world map; a **radial sunburst** behind a central gold-framed
circular avatar; the player name below with a flag chip; a rank/battle-points progress bar; flanking 3D
"loot" renders on dark pedestal plates with name + rarity captions; a **red diagonal sale ribbon** card
top-right with a countdown; a huge green `BATTLE` pill (≈ 290 × 72 px) with a dark `🌐 GAMES 39` sub-chip;
`News` (with a red count badge) and `Shop` (with a `NEW` flag) buttons bottom-right; currency chips
across the top-right; a hamburger and a stats button top-left on cyan/grey trays.

### 5.5 Typography

I enlarged `Deploy Troops` (`bt1-0200`), `Basic Training / Guided tutorials` (`c3d-0813`) and the tip
body (`bt4-0036`) 3–4× to study letterforms.

Observed traits: very heavy weight; **slightly condensed**; tall x-height; **flat, horizontally cut
terminals**; a **single-storey `g` with an open, un-closed descender hook**; a double-storey `a` with a
small bowl; a straight diagonal `y` tail; a short flat `r` arm; a square-ish dot on the `i`; flat-sided
`D`/`B` bowls.

| Role | Recommendation | Why |
|---|---|---|
| **Headline / UI** | **Titillium Web** 700 / 900 | Closest Google Font to the observed open single-storey `g`, flat terminals and mild condensation. Free, variable-ish, excellent numerals. |
| Alternate headline | **Barlow Semi Condensed** 700 / 800 | If Titillium reads too technical; slightly warmer, same proportions. |
| **Body / captions** | **Barlow** 400 / 500 / 600 | Neutral companion, matches x-height. |
| **Numerals on tokens / dice / counts** | Titillium Web **900**, `font-variant-numeric: tabular-nums` | Tabular is essential so a `1` and a `7` occupy the same disc. |
| Rejected | Oswald, Bebas Neue (far too condensed and tall), Russo One (too geometric/techy), Lato (too open) | — |

**The outline is the font.** Every piece of text over the board uses:
```css
-webkit-text-stroke: 3px #161616;    /* or a paint-order trick */
paint-order: stroke fill;
text-shadow: 0 2px 3px rgba(0,0,0,0.55);
```
Without this the replica will not read as RGD, whatever font you pick.

### 5.6 Icon style

Flat, monochrome, **chunky rounded silhouettes with no internal detail and no outlines** — person,
robot, globe, soldier, map-pin, tank, die, speech-head, bar-chart, snowflake, stopwatch, skull. Stroke
weight where strokes exist is heavy (≈ 8% of the icon box). All are trivially reproducible as SVG paths.
Icon buttons come in two chassis: a **circle** (board actions, dialog ✗/✓) and a **rounded-square grey
tray** (utility: stats, emote, close, modifiers), radius ≈ 20% of the box.

---

## 6. Motion

Nothing below is measured from video (I worked from stills) — **all durations and easings are
recommendations**, chosen to match the weight of the art. Animations marked **(observed)** have direct
still evidence that they exist.

| # | Animation | Evidence | Recommendation |
|---|---|---|---|
| 1 | **Turn-start banner** slides down from the top, holds, slides away | **(observed)** `bt1-0055`, `c3d-0030`, `nyc-0445` | in 320 ms `cubic-bezier(.16,1,.3,1)`, hold 1200 ms, out 240 ms ease-in |
| 2 | **Received-troops ring** counts up and the ring scales in | **(observed)** `bt1-0055` | scale 0.7→1 over 260 ms back-out; number ticks over 500 ms |
| 3 | **Phase transition** — pip slides, label cross-fades, button label swaps | **(observed)** pips in `bt3-0052` | pip 220 ms ease-out; label cross-fade 160 ms |
| 4 | **Camera pan + zoom + tilt to the attack** | **(observed)** `bt2-0025` vs `bt2-0155` are the same map at ~2.2× difference | 420 ms `cubic-bezier(.22,.61,.36,1)` on `transform` (translate+scale+rotateX) |
| 5 | **Attack arrow draw-on** | **(observed)** `bt2-0025` | `stroke-dashoffset` 0→full, 260 ms ease-out, arrowhead pops at the end (scale 0→1, 120 ms) |
| 6 | **Dice tumble** | **(observed)** `bt6-0030` mid-roll, `bt6-0135` settled | 3 dice, staggered 60 ms; 900 ms of `rotate3d` with decreasing amplitude, then a 140 ms settle bounce; add a 1-frame white flash on landing |
| 7 | **Blitz resolve** — rapid repeated dice + ticking counts | implied by Blitz mode | 90 ms per round, max 12 rounds visible, then jump to the result |
| 8 | **Troop-count tick** on a token | **(observed)** counts change between frames | count-up over `min(600, 80·Δ)` ms, ease-out; the disc does a 1.15× scale pulse, 180 ms |
| 9 | **Damage numeral** (`−1`, `−4`) floats up and fades | **(observed)** `bt3-0036`, `store/play-16.jpg` | translateY −40 px + opacity 1→0 over 700 ms ease-out; colour `#FF4D5F` with a dark outline |
| 10 | **Territory capture** — colour wipe to the new owner | **(observed)** `bt6-0140`, `bt3-0036` | a radial colour wipe from the attacking border across the path, 380 ms; then a 180 ms white flash at 35% opacity; then the token swaps |
| 11 | **Continent captured** — the perimeter glow ignites | **(observed)** `c3d-0610` | glow opacity 0→1→0.6 over 500 ms, plus a single outward ring pulse |
| 12 | **Fortify chevrons** march along the path | **(observed)** `bt4-0028` | staggered opacity pulse travelling source→dest, 900 ms loop, linear |
| 13 | **Card deal / award** — a card flies up off the board with a `+1` | **(observed)** `c3d-0250` | 520 ms: scale 0.4→1, translateY −160 px, rotate −8°, then into the card chip over 300 ms ease-in |
| 14 | **Card select** — lift + dashed border appear | **(observed)** `bt5-0025` | translateY −14 px, 160 ms back-out; dashes then animate (`stroke-dashoffset` loop, 1.2 s linear) |
| 15 | **Cards seized** — N cards fly from the victim's roster row to your chip | **(observed)** `bt5-0108`, `c3d-0743` | stagger 80 ms, 420 ms each, ease-in-out along an arc |
| 16 | **Elimination** — roster row desaturates, skull fades in | **(observed)** `bt5-0108` | 400 ms; add a brief grey flash on the row |
| 17 | **Chat bubble pop** beside a roster row | **(observed)** `store/play-16.jpg` | scale 0.6→1.06→1 over 240 ms back-out; auto-dismiss after 3.5 s with a 200 ms fade |
| 18 | **Bot "thinking" indicator** — a `…` bubble | **(observed)** `store/play-16.jpg` shows a `…` balloon on a bot row | three dots, 1.2 s loop, 0.15 s stagger, translateY 0→−4 px |
| 19 | **Turn-timer ring/bar** drain | implied by `c3d-0001` "Turn Timer: 60s" + the bar in `store/play-16.jpg` | linear over the turn length; switch to `--danger` and pulse at 1 Hz under 10 s |
| 20 | **Modal scrim** fade | **(observed)** every modal frame | 180 ms ease-out in, 140 ms out |
| 21 | **Top amber confirm** slides down | **(observed)** `bt4-0126` | 280 ms `cubic-bezier(.16,1,.3,1)`; the two buttons stagger in 60 ms apart |
| 22 | **Victory stars burst** | **(observed)** `bt1-0025` | stars scale 0→1 and fan outward over 900 ms, staggered 25 ms, with a slow 8 s rotation afterwards |
| 23 | **Menu card select** — green wash, sparkle, ✓ pop | **(observed)** `c3d-0813` | fill cross-fade 200 ms; ✓ scale 0→1.15→1, 260 ms back-out |
| 24 | **Button press** | — | scale 0.96 + bezel collapse (bottom shadow 4px→1px) over 90 ms |
| 25 | **Coastal glow / ocean lines** idle drift | — | optional: translate the line net 2 px over 20 s, linear, infinite. Keep it almost imperceptible. |

Respect `prefers-reduced-motion`: keep #3, #8, #10 as instant state changes and drop #6, #22, #25.

---

## 7. Responsive

**The reference game is landscape-only at every size** (all 304 files are landscape, including the
1920×1080 iPhone store shots). The layout is one design scaled, not three designs.

### 7.1 Landscape (the primary mode, phone through desktop)

The HUD is **anchored to the four edges with percentage positions**, so it genuinely just scales:

| Zone | Anchor | Size |
|---|---|---|
| Utility icons | top-left | fixed 44 px circles, 16 px gutter |
| Title pill | top-centre | auto |
| Player roster | right edge, vertically centred | 13 %W, rows `clamp(64px, 10.7vh, 104px)` |
| Icon stack | bottom-left | fixed 72–90 px squares |
| Action bar | bottom-centre | button `clamp(180px, 15vw, 280px)` × 48 px |

Breakpoint adjustments:

- **< 820 px wide (phone landscape).** Roster rows collapse: drop the territory-count line, keep the
  avatar + troop count; row height → 56 px. Title pill font → 22 px. Utility icons → 36 px. The three
  icon-stack buttons stack horizontally along the bottom-left instead of vertically.
- **820–1280 px (large phone / small tablet).** Full roster, slightly reduced token radius (15 px).
- **≥ 1280 px (tablet / desktop).** The reference layout as measured. Above 1920 px, cap the HUD scale
  (the chrome should not keep growing) and let the map take the extra area.
- **≥ 1700 px.** Optionally reveal the roster's secondary line (cards held as a number rather than a
  tag), as the store tablet shots do (`store/play-16.jpg`).

### 7.2 Portrait (no evidence — my design)

A browser replica cannot lock orientation, so portrait needs a real answer:

- **Rotate the board 0°, do not rotate the map.** Scale-to-fit the map width; the Classic map at 2:1
  leaves large bands above and below — fill them with HUD.
- **Roster moves to a horizontal strip at the top**, one row of compact owner chips
  (avatar + troop count), scrollable if > 4 players. Active player's chip is filled and widened.
- **Action bar stays at the bottom**, full width, with the phase label and pips above the button.
- **Icon stack moves to a single row immediately above the action bar.**
- **Modals go full-width sheets** rather than centred panels; the card fan becomes a horizontal
  scroller; the Blitz view stacks attacker-above-defender instead of left/right.
- Offer a dismissible "rotate for the best view" hint on first portrait load.

---

## 8. Design-token sheet

### 8.1 CSS custom properties

```css
:root {
  /* ---------- board ---------- */
  --ocean:            #22A4C8;
  --ocean-deep:       #06202A;
  --ocean-glow:       #7FE3FF;
  --ocean-line:       rgba(255,255,255,.10);
  --land-neutral:     #6B7785;
  --land-outline:     #0B0B0D;
  --land-wall:        #07070A;
  --sea-route:        rgba(255,255,255,.85);

  /* ---------- chrome ---------- */
  --chrome-900:       #0D1E30;   /* menu base            */
  --chrome-800:       #101D24;   /* solid panel          */
  --chrome-700:       rgba(12,42,52,.70);  /* HUD glass  */
  --chrome-600:       #2A7F9E;   /* menu card top        */
  --chrome-650:       #1B5570;   /* menu card bottom     */
  --chrome-line:      #4E9CBB;   /* card border          */
  --tray:             linear-gradient(#B9B6B0,#8E8B85);
  --scrim:            rgba(0,0,0,.42);
  --scrim-heavy:      rgba(0,0,0,.55);

  /* ---------- semantic ---------- */
  --go:               #A6DC5F;
  --go-mid:           #7FBE42;
  --go-deep:          #4E7C2A;
  --go-bezel:         #3E6420;
  --danger:           #D8415C;
  --danger-deep:      #8C2739;
  --ok:               #7ED957;
  --ok-deep:          #55B13C;
  --gold:             #F0C40F;   /* win chance, active toggle glyph */
  --cyan:             #19A7DB;   /* active segmented toggle         */
  --amber-top:        #E6A93A;
  --amber-bottom:     #EFCB55;
  --amber-border:     #EDC94F;
  --brand-red:        #C42A30;
  --disabled:         #757575;
  --disabled-line:    #505050;

  /* ---------- paper (cards) ---------- */
  --paper:            #F3E6CB;
  --paper-edge:       #D8C9A4;
  --suit:             #BE2E36;

  /* ---------- text ---------- */
  --text:             #FFFFFF;
  --text-muted:       #A9B6BC;
  --text-dim:         #6D8792;
  --text-on-amber:    #4A3410;
  --text-on-paper:    #2A2318;
  --stroke-dark:      #161616;

  /* ---------- continents ---------- */
  --c-na: #36B0EA;  --c-na-fill: #0A2431;
  --c-sa: #DA3A4F;  --c-sa-fill: #300B0C;
  --c-eu: #5FBF2A;  --c-eu-fill: #1B310B;
  --c-af: #9B4AE8;  --c-af-fill: #1E0D31;
  --c-as: #E08A24;  --c-as-fill: #180D02;
  --c-au: #F0C33A;  --c-au-fill: #312A0F;

  /* ---------- radii ---------- */
  --r-pill:  999px;
  --r-card:  18px;   /* territory card            */
  --r-panel: 12px;   /* dark panels               */
  --r-menu:  10px;   /* menu tiles                */
  --r-tray:  18px;   /* grey icon-button tray     */
  --r-tip:   30px;   /* tutorial card             */
  --r-sheet: 20px;   /* top amber banner, bottom  */

  /* ---------- shadows ---------- */
  --sh-token:  0 4px 6px rgba(0,0,0,.45);
  --sh-chip:   0 3px 6px rgba(0,0,0,.40);
  --sh-panel:  0 10px 26px rgba(0,0,0,.50);
  --sh-card:   0 10px 18px rgba(0,0,0,.50);
  --sh-float:  0 14px 40px rgba(0,0,0,.60);
  --bezel-go:   0 4px 0 var(--go-bezel);
  --bezel-red:  0 4px 0 #6F1A28;

  /* ---------- type ---------- */
  --font-head: "Titillium Web", "Barlow Semi Condensed", system-ui, sans-serif;
  --font-body: "Barlow", "Titillium Web", system-ui, sans-serif;
  --fw-head: 700;  --fw-black: 900;  --fw-body: 500;
  --ts-xs: .75rem; --ts-sm: .875rem; --ts-md: 1rem;
  --ts-lg: 1.375rem; --ts-xl: 1.875rem; --ts-2xl: 2.5rem; --ts-3xl: 3.5rem;

  /* ---------- spacing (4px base) ---------- */
  --s-1: 4px;  --s-2: 8px;  --s-3: 12px; --s-4: 16px;
  --s-5: 24px; --s-6: 32px; --s-7: 48px; --s-8: 64px;

  /* ---------- z layers ---------- */
  --z-ocean:        0;
  --z-land:        10;
  --z-routes:      20;
  --z-highlight:   30;   /* selected outlines, continent glow */
  --z-arrow:       40;
  --z-tokens:      50;
  --z-labels:      60;
  --z-floaters:    70;   /* damage numerals, +N          */
  --z-hud:        100;   /* roster, action bar, icons    */
  --z-scrim:      200;
  --z-modal:      210;   /* cards, dice, sliders         */
  --z-banner:     220;   /* turn banner, amber confirm   */
  --z-tip:        230;
  --z-toast:      240;
}

/* The signature treatment: outlined text over the board. */
.on-board-text {
  font-family: var(--font-head);
  font-weight: var(--fw-black);
  color: var(--text);
  paint-order: stroke fill;
  -webkit-text-stroke: 3px var(--stroke-dark);
  text-shadow: 0 2px 3px rgba(0,0,0,.55);
}
```

### 8.2 Per-player colour table

`--p-N` is the canonical token colour. `-light` is the token face highlight, `-dark` the territory top
face, `-wall` the extrusion, `-hot` the selected/saturated state, `-on` the text colour that passes
contrast on the token.

| # | Name | `--p` | `-light` | `-dark` (land) | `-wall` | `-hot` (selected) | `-on` |
|---|---|---|---|---|---|---|---|
| 1 | Red | `#D93244` | `#EC5C6B` | `#A8293A` | `#6E1A25` | `#F4001A` | `#FFFFFF` |
| 2 | Green | `#8FC94F` | `#AEDB78` | `#4A7A3C` | `#2E4E26` | `#5FE800` | `#12300A` |
| 3 | Blue | `#4DABF1` | `#7DC5F6` | `#3A7FB5` | `#245173` | `#009BFF` | `#06243A` |
| 4 | Yellow | `#E0B52E` | `#EFCE63` | `#B59525` | `#745F17` | `#FFC800` | `#3A2C00` |
| 5 | Orange | `#E7773D` | `#F29A6C` | `#B5652C` | `#73401C` | `#FF6A00` | `#3A1704` |
| 6 | Pink | `#D139AD` | `#E36CC6` | `#9B2A80` | `#631A52` | `#FF00C8` | `#FFFFFF` |
| 7 | Black | `#3D3D3D` | `#5E5E5E` | `#2B2B2D` | `#141415` | `#000000` | `#FFFFFF` |
| 8 | White | `#D3D4D4` | `#EDEEEE` | `#B4B7BA` | `#7B8085` | `#FFFFFF` | `#1A1D1F` |
| 9 | Purple* | `#7B3FE0` | `#9D6FEB` | `#4A2A86` | `#2E1A55` | `#4A00E9` | `#FFFFFF` |

\* Purple appears in `bt2-0025`/`bt2-0150` but not in the 6-player `nyc-0115` set; treat as a 9th
optional colour.

```css
.player { --p: var(--p-red); --p-dark: var(--p-red-dark); /* …etc */ }
.territory { fill: var(--p-dark); }
.territory[data-selected] { fill: var(--p-hot); stroke: #fff; stroke-width: 3; }
.token      { fill: var(--p); }
.token text { fill: var(--p-on); }
```

Accessibility: Red/Pink and Green/Yellow are the risky pairs for colour-vision deficiency. Offer a
**pattern overlay** per player (dots / diagonal / cross-hatch at 12% white) as a toggle — the game's own
blizzard hatching (`store/play-16.jpg`) shows the style already fits the art.

### 8.3 SVG recipe — troop token

```svg
<!-- 48×56 viewBox so the chip body and shadow fit. r = 19. -->
<svg viewBox="0 0 48 56" width="48" height="56" class="token">
  <defs>
    <filter id="tok-sh" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#000" flood-opacity=".45"/>
    </filter>
    <radialGradient id="tok-face" cx="38%" cy="30%" r="80%">
      <stop offset="0"   stop-color="var(--p-light)"/>
      <stop offset="0.7" stop-color="var(--p)"/>
      <stop offset="1"   stop-color="var(--p)"/>
    </radialGradient>
  </defs>

  <g filter="url(#tok-sh)">
    <!-- chip body (the 5px cylinder wall) -->
    <circle cx="24" cy="29" r="19" fill="var(--p-dark)"/>
    <!-- face -->
    <circle cx="24" cy="24" r="19" fill="url(#tok-face)"
            stroke="var(--p-wall)" stroke-width="2"/>
    <!-- top specular sliver -->
    <ellipse cx="24" cy="15" rx="12" ry="4.5" fill="#fff" opacity=".16"/>
  </g>

  <text x="24" y="24" text-anchor="middle" dominant-baseline="central"
        font-family="var(--font-head)" font-weight="900" font-size="23"
        style="paint-order:stroke fill" stroke="#161616" stroke-width="3"
        fill="#fff" font-variant-numeric="tabular-nums">7</text>
</svg>
```

For 3-digit counts swap the two `<circle>`s for `<rect rx="19">` with `width = 38 + 11·(digits−1)`,
keeping `rx` at 19 so it reads as a stadium.

### 8.4 SVG recipe — territory card

```svg
<svg viewBox="0 0 175 320" width="175" height="320" class="card">
  <defs>
    <radialGradient id="card-sun" cx="50%" cy="34%" r="70%">
      <stop offset="0"   stop-color="#FBF2DF"/>
      <stop offset="1"   stop-color="var(--paper)"/>
    </radialGradient>
    <filter id="card-sh"><feDropShadow dx="0" dy="10" stdDeviation="9"
            flood-color="#000" flood-opacity=".5"/></filter>
  </defs>

  <g filter="url(#card-sh)">
    <rect x="0" y="0" width="175" height="320" rx="18" fill="url(#card-sun)"/>
    <rect x="7" y="7" width="161" height="306" rx="13"
          fill="none" stroke="var(--paper-edge)" stroke-width="3"/>
  </g>

  <!-- faint sunburst wedges behind the suit -->
  <g opacity=".08" fill="#A98C52">
    <!-- 16 wedges generated from (87,108) -->
  </g>

  <!-- suit figure: infantry | cavalry | artillery | wild -->
  <path d="…" fill="var(--suit)" transform="translate(87,108)"/>

  <!-- territory silhouette, tinted by the current owner -->
  <path d="…" fill="var(--p)" opacity=".9" transform="translate(87,235)"/>

  <text x="87" y="246" text-anchor="middle" font-family="var(--font-head)"
        font-weight="900" font-size="27" style="paint-order:stroke fill"
        stroke="#161616" stroke-width="4" fill="#fff">Japan</text>
</svg>

<!-- selected -->
<style>
.card[data-selected] { transform: translateY(-14px); }
.card[data-selected]::after {       /* the dashed halo, 8px outside */
  content:""; position:absolute; inset:-8px; border-radius:26px;
  border:4px dashed #fff; animation: dash 1.2s linear infinite;
}
</style>
```

Suit glyphs to draw: **Infantry** = standing rifleman with a shouldered musket; **Cavalry** = rearing
horse with a rider; **Artillery** = a two-wheeled field cannon. All in `--suit` as flat silhouettes
(`crop-card-set-three.png`). **Wild** is not in the evidence — recommend a RISK-style cavalry-plus-flag
emblem using all three silhouettes overlapping.

### 8.5 How to draw the map

**One `<path>` per territory, one CSS variable per owner.** This is the whole architecture.

```svg
<svg viewBox="0 0 2000 1000" preserveAspectRatio="xMidYMid meet" id="board">
  <defs>
    <!-- 1. ocean: flat fill + vignette -->
    <radialGradient id="vignette" cx="50%" cy="48%" r="78%">
      <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
      <stop offset="1"    stop-color="#02161E" stop-opacity=".85"/>
    </radialGradient>

    <!-- 2. coastal glow: blur the land union and flood it cyan -->
    <filter id="coast" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="14" result="b"/>
      <feFlood flood-color="#7FE3FF" flood-opacity=".75"/>
      <feComposite in2="b" operator="in"/>
    </filter>

    <!-- 3. the relief bevel: inner highlight top-left, inner shade bottom-right -->
    <filter id="relief" x="-10%" y="-10%" width="120%" height="120%">
      <feOffset in="SourceAlpha" dx="0" dy="-3" result="up"/>
      <feGaussianBlur in="up" stdDeviation="3" result="upb"/>
      <feComposite in="upb" in2="SourceAlpha" operator="out" result="hi"/>
      <feFlood flood-color="#fff" flood-opacity=".30"/>
      <feComposite in2="hi" operator="in" result="hiC"/>

      <feOffset in="SourceAlpha" dx="0" dy="4" result="dn"/>
      <feGaussianBlur in="dn" stdDeviation="4" result="dnb"/>
      <feComposite in="dnb" in2="SourceAlpha" operator="out" result="lo"/>
      <feFlood flood-color="#000" flood-opacity=".42"/>
      <feComposite in2="lo" operator="in" result="loC"/>

      <feMerge><feMergeNode in="SourceGraphic"/>
               <feMergeNode in="hiC"/><feMergeNode in="loC"/></feMerge>
    </filter>

    <!-- 4. optional ocean line net -->
    <pattern id="net" width="600" height="600" patternUnits="userSpaceOnUse">
      <path d="M0,520 L600,60 M-40,180 L640,460 M120,-20 L300,620"
            stroke="var(--ocean-line)" stroke-width="1" fill="none"/>
    </pattern>
  </defs>

  <rect class="ocean"  width="100%" height="100%" fill="var(--ocean)"/>
  <rect class="net"    width="100%" height="100%" fill="url(#net)"/>

  <!-- coastal halo: the union of all land, blurred -->
  <path class="land-union" d="…" filter="url(#coast)"/>

  <!-- extrusion: the same union, offset down, pure dark -->
  <path class="land-wall" d="…" transform="translate(0,7)" fill="var(--land-wall)"/>

  <!-- territories -->
  <g class="territories" filter="url(#relief)">
    <path id="t-egypt" class="territory" data-owner="green" d="…"/>
    <!-- … -->
  </g>

  <!-- continent perimeter glows (held continents / overlay mode) -->
  <g class="continent-rings">…</g>

  <!-- sea routes -->
  <g class="routes" stroke="var(--sea-route)" stroke-width="4"
     stroke-dasharray="14 12" stroke-linecap="round" fill="none">
    <path d="M…"/><circle cx="…" cy="…" r="7" fill="#fff"/>
  </g>

  <rect class="vignette" width="100%" height="100%" fill="url(#vignette)"
        pointer-events="none"/>

  <!-- tokens and labels live in HTML above the SVG, positioned absolutely -->
</svg>
```

```css
.territory {
  fill: var(--p-dark);
  stroke: var(--land-outline);
  stroke-width: 3;
  stroke-linejoin: round;
  transition: fill 240ms ease-out;
  cursor: pointer;
}
.territory[data-owner="green"] { --p-dark: #4A7A3C; --p: #8FC94F; --p-hot: #5FE800; }
/* …one rule per player… */

.territory[data-state="selected"],
.territory[data-state="target"] {
  fill: var(--p-hot);
  stroke: #fff;
  stroke-width: 4;
  filter: drop-shadow(0 0 10px rgba(255,255,255,.75));
}
.territory[data-state="dimmed"] { filter: brightness(.45) saturate(.6); }
.territory[data-owner="none"]   { --p-dark: var(--land-neutral); }

#board { transform: perspective(1400px) rotateX(4deg); transform-origin: 50% 55%; }
#board[data-view="battle"] { transform: perspective(1400px) rotateX(18deg) scale(2.2); }
```

Two important implementation notes:

1. **Keep the `<path>` d-strings chunky.** Real coastlines look wrong. The reference silhouettes are
   simplified to roughly **12–30 vertices per territory** with visibly straight runs and angular
   corners (`bt1-0200`, `nyc-0115`). Run any real geodata through a Douglas–Peucker simplify at a
   tolerance that leaves that count, then round the joins.
2. **Tokens and labels are HTML, not SVG children.** Keeping them in a DOM layer above the SVG means
   they do not inherit the `rotateX` skew (which would make the numbers look wrong), they can use
   normal text rendering and `text-stroke`, and they are trivially animatable and accessible. Compute
   each territory's anchor point once (see below) and position with `translate3d`.

### 8.6 Label placement

- Each territory carries **two anchors**: a `token` point and a `label` point, with the label sitting
  **directly below the token** (~26 px gap at 1600×900) — consistent in `bt1-0200`, `bt4-0028`,
  `bt5-0108`, `crop-troop-tokens-multicolour.png`.
- The anchor is **not** the bounding-box centre — it is the **pole of inaccessibility** (the point
  furthest from the polygon's edge). Precompute it per territory with `polylabel`; this keeps the token
  inside awkward shapes like Indonesia and Scandinavia.
- Where that fails (tiny territories: Iceland, Madagascar, Great Britain), the token sits on the
  territory and **the label is allowed to overflow onto the ocean** — `bt5-0108` shows
  "Northwest Territory" and "Eastern United States" spilling well past their borders, and they simply
  overlap neighbouring labels. RGD makes no attempt at collision avoidance; don't over-engineer it.
- Labels are **hidden below a zoom threshold** on dense maps — `nyc-0115` shows tokens with no labels at
  all, while `bt5-0108` (zoomed in) shows them. Rule: show labels when the territory's on-screen area
  exceeds ~2500 px².
- Label style: `--font-head` 700, 19–22 px, white, 3 px dark stroke, `text-shadow 0 2px 2px rgba(0,0,0,.6)`,
  centred, `white-space: nowrap`, `pointer-events: none`.

---

## 9. What I could not see — explicit inferences

Ranked by how much the replica depends on it.

1. **No video, only stills.** Every duration, easing and animation curve in §6 is a recommendation.
   I can confirm *that* an animation exists (two frames differ) but never *how* it moves.
2. **No portrait layout exists anywhere in the evidence.** §7.2 is entirely my design.
3. **Exact typeface is unidentified.** §5.5 is a visual match from 3–4× enlargements, not a
   verified font. Titillium Web is my best Google Font approximation; a developer should A/B it against
   Barlow Semi Condensed.
4. **All hexes are sampled from lossy JPEG frames**, many of them under a modal scrim or a radial
   vignette. I corrected for the scrim where I could measure it (factor ≈ 0.78–0.88) but every value
   could be off by a few percent. The *relationships* (token lighter than land, constant gold
   percentage, flat ocean) are solid; the absolute values are approximations.
5. **Turn timer.** `c3d-0001` proves a 60 s turn timer exists; the only visual is a thin progress bar in
   the older marketing art (`store/play-16.jpg`). **There is no evidence of a timer ring.** §4.4's
   recommendation is invention.
6. **Post-conquest troop-move slider** — no frame. §4.12 reuses the deploy slider by analogy.
7. **Elimination banner** — the index labels `bt5-0104` as the "Defeated!" banner, but that file
   actually contains the 99 % Blitz view. I have the *roster* elimination treatment (skull disc,
   `bt5-0108`, `store/play-16.jpg`) but not the full-screen banner. §4.13 extrapolates from the Victory
   screen.
8. **Wild card art** — never shown. Three suits confirmed (`crop-card-set-three.png`), wild inferred.
9. **Card silhouette tint = owner colour** — strongly suggested by `bt5-0025` (Japan/Indonesia ochre
   matching the orange owner, Ukraine near-black matching the black owner), but a one-frame sample.
   It could equally be a continent tint.
10. **Three-digit troop tokens** — never observed above `14`. The stadium-pill recommendation in §3.2 is
    extrapolated from the older marketing art's pill tokens.
11. **Locked / DLC map tiles** — no lock badge in any of the 70 picker tiles; the lock state lives on the
    Map Preview screen. §5.3's badge is a recommendation.
12. **Two art generations are mixed in the evidence.** The store screenshots
    (`store/play-*.jpg`, `store/appstore-*.jpg`, © 2021) show a flatter, lighter-blue, pill-token style
    with a bottom-centre player bar; the `bt*` video frames (current) show the darker, extruded,
    right-edge-roster style. **Everything in this document specifies the current `bt*` style**; store
    shots were used only where they are the sole evidence (chat bubbles, bot "thinking", turn-timer bar,
    skull disc at high resolution), and those uses are flagged.
13. **Settings, secret-mission, shop/loot-box, rank-ladder and alliance-request screens** have no
    evidence at all (confirmed in `04a-visual-evidence-index.md` §5). Build them from the chrome tokens
    in §8.1 and the menu patterns in §5.1.
14. **Blizzards / Fog of War / Portals in play** — partially seen (hatched tiles and ❄ glyphs in
    `nyc-0115`, `?` tokens in `c3d-0610`) but never a clean capture of each modifier's full treatment.
15. **Exact HUD pixel measurements** were taken by masking and bbox-scanning two 1600×900 frames. The
    green primary button (238 × 48 px) and the phase-pip row are measured; most other figures are read
    off the image to ±8 px. Treat them as proportions, not as a redline.
