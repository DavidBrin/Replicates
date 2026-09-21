# Island Empire — Visual Design Reference

> **Correction (coordinator, 2026-09-21):** the HUD bar colour is the colour of the player whose turn it is — blue while the human (blue) plays, red/green while the red/green AI plays (level 24 frames alternate blue → green → red with identical gold values, and UNDO/NEXT DAY are disabled in the non-blue states). It is not a "nothing affordable" state. Unaffordable purchases are signalled per card (red BUY / red MONEY label), and the 2025 build adds a separate low-income alert icon.


Source: direct pixel measurement (PIL `Image.getpixel`, edge/grid detection, color histograms) of the on-disk screenshots listed in **Sources** at the end of this document. All hex values below were sampled from the actual files, not estimated by eye, unless explicitly marked "visual estimate." Coordinates refer to the original screenshot pixel grid (Google Play screenshots are 1080×1920 PNG; 2021 walkthrough frames are 608×1080 JPEG).

This is a redraw spec: nothing here is meant to be extracted as an asset. It's measurements and descriptions for building an equivalent code-drawn pixel-art renderer on an HTML canvas.

---

## 1. Grid & camera

- **Tiles are square** and rendered in a strict axis-aligned grid, isometric-free top-down (true top-down, not 3/4 perspective — buildings/units are drawn "standing up" on their tile with a drop shadow, like classic Zelda/Stardew-style top-down, not raised-relief).
- **Tile pixel size is NOT fixed** — the camera has continuous zoom. Measured tile size (grid-line spacing) across the seven Play-Store screenshots, all 1080 px wide:

  | Screenshot | Scene | Tile size (px) | Tiles visible across 1080px width |
  |---|---|---|---|
  | play-03.png | grass, close gameplay | 216 px | 5.0 |
  | play-04.png | grass/water, close gameplay | 180 px | 6.0 |
  | play-10.png | grass/water, online match | 154 px | 7.0 |
  | play-08.png | desert, Level 20 | 145 px | 7.5 |
  | play-09.png | grass, Level 23 | 100 px | 10.8 |
  | play-07.png | snow, Level 33 (overview) | 94 px | 11.5 |

  Reproduce as: a `camera.zoom` (tile-px) value the player can pinch/scroll between roughly **90 px** (wide overview, ~11+ tiles across a phone-width canvas) and **220 px** (close-up, ~5 tiles across), with default gameplay sitting around **145–180 px** (~6–7.5 tiles across). Treat this as continuous zoom, not discrete steps.
- **Grid lines**: a thin (2–3 px at 216px tile scale, i.e. ~1–1.5% of tile size) darker line of the *same hue* as the terrain, not a neutral gray — e.g. grass grid line `#8DAD3A` is a darker/desaturated version of grass fill `#B0D848`. Same pattern on desert (`#C39A5C` line vs `#F4BF73` fill) and snow (`#C2C2C2` line vs `#F2F2F2` fill). Implementer takeaway: derive the grid-line color procedurally (darken terrain fill ~20% + slightly desaturate) rather than using one global grid color.
- **World-map framing (2021 UI)**: the level is drawn inside a bordered rectangular "map card" that sits on top of a static tan/parchment background depicting an unrelated blurred desert/terrain texture (`#DBC177` family) — see `wt-0005.jpg`. The map card has a thin cream/gold outline. This parchment surround only appears in the 2021 campaign UI; current-version screenshots (play-03..10) fill the entire screen with the tile grid, no parchment frame.
- **HUD bar** occupies a fixed-height band at the bottom of the screen below the map viewport (see §6).

## 2. Terrain tiles per biome

Three biomes confirmed: **grass** (temperate/default), **desert** (sand), **snow** (arctic). Same building/decoration vocabulary is reused across all three; only the ground/grid/water dressing changes.

| Element | Grass | Desert | Snow |
|---|---|---|---|
| Ground fill | `#B0D848` (yellow-green) | `#F4BF73` (warm tan) | `#F2F2F2` (near-white) |
| Grid line | `#8DAD3A` | `#C39A5C` | `#C2C2C2` |
| Ground texture | scattered darker fleck (`#586C24`) + tiny white/lavender flower clusters, single gray pebbles | scattered darker tan flecks, sparse pebbles, no flowers | scattered pale-blue/gray snow-drift flecks, no flowers |
| Mountain/rock | `#A86061` mid, `#BF806F` highlight, `#784049` shadow — dusty rose-mauve stacked-boulder cluster, 2×2 or larger tile footprint | **same palette** `#A86061`/`#BF806F`/`#784049` — mountains are biome-independent | icy blue-white boulder variant (not separately sampled; visually a pale-blue-tinted version of the same rock silhouette) |
| Road / path | `#F0CE70` warm gold-tan (sampled `#F4D372`/`#EFCE6D`/`#ECCB6A`), no grid line drawn over it, connects buildings in dirt-road curves/right-angles | same tan family, blends into desert ground (lower contrast) | tan path visible against white snow (high contrast) |
| Water | `#2898F0` main, `#1453BB` shading/current-line, sandy-tan beach fringe where it meets grass/desert | same blue | icy pale blue `#D5EFFE` band (frozen-looking, lighter/flatter than open-biome water) with visible ice-floe chunks |

**Forests**: dense pine clusters, dark-green canopy `#209058` with a darker shadow lobe `#1F5847`/`#0E623E` and a brighter highlight fleck `#60C05F`; trunks are small brown stubs at the base (`#502820`/`#7D4F1F`). Trees are drawn as a tessellated mass of individual triangular pine "blobs" (not one big canopy) so a forest tile-cluster reads as a texture of overlapping pine shapes with visible dark gaps between them — this is the single most recognizable large-scale texture in the game. Isolated single/double trees (non-forest) use the same pine silhouette at smaller count.

**Grass field** (the lighter rounded "can't farm here" patch, seen in the in-game "Strength" dialog and on the map as an empty light-green rounded square): distinctly more saturated/lighter apple-green than base grass — `#99D333` vs base `#B0D848`. Drawn as a rounded-corner square inset within the tile with a darker green border, visually reading as "mowed lawn" distinct from wild grass.

**Decorations** (non-blocking, sit on top of ground fill): small gray 1–2px pebble clusters, single or paired white/red/purple flower sprites (4–6px), light-green low bushes with a darker outline, all scattered sparsely and randomly — these exist purely as ambient noise breaking up flat ground tiles.

## 3. Territory rendering

- **Territory border**: a dotted line of small circular "beads" running exactly along the tile-grid edges that bound a player's contiguous owned area — not a solid outline. Each bead is a small filled circle (~8–10% of tile width) in the owner's player color with a thin black outline, spaced at regular intervals (~1 bead per 12–16 screen px at 216px tile scale, i.e. roughly 14–18 beads per tile edge). Confirmed colors (measured directly from dotted borders in play-03/04/10 and the weekly-challenge minimaps in play-06):
  - Blue: `#337DF8` (shadow/alt `#1453BB`)
  - Red: `#C6293B` (shadow/alt `#AD192E`, minimap variant `#CD2E43`)
  - Green: `#52C73F`
  - Magenta/Pink: `#DE26D3`
  - Gray/neutral: `#595959`
  - (A cyan-leaning blue variant `#2DA2F2`/`#2898F0` also appears — likely the same "blue" player rendered at a different UI scale/anti-aliasing, not a 6th color.)
  - The game markets "local multiplayer for up to 8 players" — only 5 distinct territory colors were directly confirmed in available screenshots; yellow, purple, and white/black slots likely exist but weren't visible in this screenshot set. Implementer should plan a palette of **8 saturated, mutually-distinguishable hues**: blue, red, green, magenta/pink, gray, plus yellow, purple, and one more (orange or teal) to fill out 8.
- **Border between two adjacent provinces** (different owners touching): each owner's dotted bead line runs on their own side of the shared edge, so a contested border shows two parallel dotted lines of different colors a few pixels apart (visible in play-06 minimaps where red and blue dotted squares abut).
- **Protected-tile shield badges**: a small shield icon (rounded-top pentagon, ~35–40% of tile size) rendered in the owner's territory color with a bold black outline and a white number centered on it, floating above/on top of the tile (drawn like a UI badge, with its own small drop shadow) — confirmed in `wt-0135.jpg`/`wt-0145.jpg` (blue shields with "2"/"3") and `play-08.png`/`play-09.png` in the current version (red shields with numbers on enemy walls/towers). The number represents remaining defense/hits-to-break the fortification on that tile. These badges appear specifically on wall/tower tiles guarding a border, not on plain territory tiles.
- **Selection / move highlight**: when a unit is selected, tiles it can legally move to stay at full brightness/normal color; all other tiles on screen get a **semi-transparent dark overlay** (visible in `wt-0115.jpg`, `wt-0135.jpg`, `wt-0955`-equivalent frames as a grayish-green wash, roughly 25–35% black alpha over the normal terrain color) — i.e. dim-everything-except-reachable rather than highlight-the-reachable-tiles-with-a-border. The reachable tile set is also framed by its own dotted selection-color border distinct from territory borders.

## 4. Buildings

All buildings sit centered on a single tile (or a building's roof cluster overlapping slightly into the tile above, isometric-style overlap) and cast a soft flat drop shadow (semi-transparent dark green/gray ellipse) beneath them.

- **Capital/city**: a cluster of 3–5 small peaked-roof cottages tightly grouped with a connecting dirt path, one taller central building. **Roof color = player color**: confirmed red-roofed capital cluster (play-03 top-right, play-08/09/10), blue-roofed cluster (play-04, play-09, play-10), walls/timber of the houses stay a neutral cream/white or light-brown regardless of player — only the roof recolors. At higher zoom (play-06 minimap) a "stone-age" skin with tan tent/yurt-like conical roofs and a "snow village" skin with pale blue-white roofs and darker timber were both visible, confirming **city visuals differ by biome/theme** while the underlying "roof = player color" rule holds.
- **Farm**: small single house + a large yellow rounded hay-bale/haystack shape beside it (`#FED942`/`#FFD800` gold, with a darker `#D79403` shading arc), connected to the house by a short dirt path. Farms show a floating `+N` gold-coin income bubble when the camera view calls out income (white speech-bubble UI element, not part of the sprite itself).
- **Mine**: a gray rocky mound (same `#A86061`-family rock palette or a cooler gray-purple variant) with a dark tunnel/entrance carved into it and a small wooden cart/timber support at the base; also shows a floating `+N` gold income bubble.
- **Chest**: small brown wooden trunk with a black metal clasp/lock, sits alone on a tile (play-10, play-01-style icon crops).
- **Grave**: gray stone tombstone (rounded-top rectangle) with a small cross/arch carved into the face, sometimes accompanied by a tiny white flower at its base — appears to mark a location where a unit died or a razed building once stood.
- **Wooden tower**: a tall narrow brown log-built watchtower, visibly taller than 1 tile height (extends up into the tile above it), with horizontal plank banding; unmistakably a defensive/vision structure, distinct silhouette from houses.
- **Stone tower / castle**: gray stone construction (`#AFB9D2` light stone, `#838A9C` mid, `#4D525E` deep shadow) — ranges from a single tall crenellated cylindrical tower to a full castle keep with twin flanking towers and a connecting stone wall segment with an arched gate (seen clearly in play-04's snow-adjacent capital, and the fortress at the bottom of play-09).
- **Palisade wall**: a horizontal row of sharpened brown wooden stakes/logs lashed together, auto-tiles along a border — i.e. it visually connects seamlessly tile-to-tile forming a continuous fence line, with distinct end-caps where the line terminates and a gate-like gap where a path crosses it. In play-04 a **wall tile carries a small colored flag/pennant** (blue triangular flag on a pole) marking which player controls/garrisons that wall segment — same "ownership marker on a defensive tile" pattern as the shield badges.
- **Stone castle wall**: crenellated gray stone wall (battlements), a heavier/later-game upgrade of the wooden palisade, also auto-tiles into a continuous line and is topped by lookout crenellations every tile.
- **Bridge**: brown wooden-plank bridge auto-tiling across water tiles in a straight line, with visible plank cross-ties and side rails; terminates on both banks with a short ramp onto the grass/sand.

## 5. Units

- **Four knight levels**, confirmed via the in-game "Strength" help dialog (`crop-strength-chart.png` / `wt-0225.jpg`) which shows all four side by side with their upgrade targets:
  1. **L1 — Peasant**: plain blue short-sleeve shirt, brown trousers, no weapon visible, bare head with brown hair. This is the base "villager/settler" unit.
  2. **L2 — Soldier**: same body but now holding a sword (gray blade, brown hilt) and wearing a small round/kite shield strapped to the off arm; shirt reads as a slightly darker/more armored blue.
  3. **L3 — Guard**: adds a helmet (open-face steel cap) and a larger kite shield (blue-painted face on the shield, matching player color), a visible sword.
  4. **L4 — Knight**: full helm with a **colored plume/crest** on top (player-colored feather/fin), matching-color shield, most detailed armor read (layered plates suggested via shading, not literal polygon detail — it's still only ~20-ish px tall).
  - All four are recolored per player: the shirt/shield/plume areas take the player's territory color; skin tone, hair, sword-blade gray, and shield metal rim stay constant across players.
- **Enemy variants**: a distinct "red shirt" / bare-chested red-trousered civilian look appears for neutral/enemy townsfolk in the walkthrough (not wearing the same blue tunic as the player's units) — i.e. non-player-color characters (villagers belonging to a not-yet-conquered city, or a rival AI) are drawn in a plain earth-tone outfit rather than a saturated player color, then re-skin to the conquering player's color once captured.
- **Idle motion**: could not confirm animation frames from static screenshots; sprites are shown standing with arms in a fixed "at rest" pose (L1/L2 arms crossed or resting near belt). No visible mid-stride/attack pose was captured in this screenshot set — treat idle bob as a reasonable inference (common in this art style) rather than a confirmed observation.
- **Unit portrait on cards**: identical sprite art to the on-map unit, just shown large (whole-card) against a solid mid-green (`#9AD334`-ish, brighter than terrain grass) card-interior background — no separate "portrait" art style, it's the same sprite scaled up.

## 6. HUD / UI

Two UI generations are visible: an **older 2021 campaign HUD** (blue/red bottom bar, walkthrough frames) and the **current HUD** (yellow cards, seen in Play-Store screenshots). Both share the same pixel-font and icon language.

- **Bottom bar** (both eras): fixed band, diamond-quilted fabric-texture fill (small repeating diamond pattern, not flat color) —
  - Old UI: **blue** `#5468E1` (darker diamond accent `#4457CF`) during normal play, or **red** `#FA474B` (darker accent `#EE3B3F`/`#570000`) — red is shown at Level 1 *before* any purchase is available (i.e. red = "nothing affordable / preview" state, blue = normal active state). Confirmed via `wt-0005.jpg` (red) vs `wt-0025.jpg` (blue), same level.
  - Left side of the bar: two stacked stat rows — **income** (gold coin icon with a small green "+" badge overlapping its top-left corner, value in white pixel-font) and **gold/treasury** (plain gold coin icon, value in white). Coin icon gold ≈ `#D7A800`/`#E7C42C`/`#FED942` family.
  - Right side: a **NEXT DAY** button — a yellow-bordered square button with a brown/wood-plank interior and a cyan-blue arrow icon (old UI) pointing right, label "NEXT DAY" in small pixel caps beneath.
- **BUY cards** (current UI, `crop-hud-cards.png`, `play-05/06`): a row of square cards to the right of the coin stats, each showing the unit/building portrait on a green background:
  - **Green** card body + "BUY" label = affordable and available (green ≈ `#228F00`).
  - **Red/orange** card body + "MONEY" label (in place of "BUY") = too expensive, can't afford (red-orange gradient ≈ `#DF2607` → `#F65B2F`).
  - Cards have a thick black rounded-rect border in both states; only the bottom label strip changes color/text (green "BUY" vs red "MONEY"), the portrait area stays green in both.
  - The larger pre-purchase "strategy" cards (play-05) use a different chrome: tan/khaki header+border `#E3C798` (dark-brown `#805128` inner border line), cream lower text panel `#F1E2B2`, a gold coin icon `#FFD800` next to the price number in the header, and a big green "Buy" button below (separate from the card, not the card's own bottom strip).
- **Unit info card** (`crop-hud-unitcard.png`/`-l2.png`): a horizontally-laid card — green-background portrait thumbnail on the left inside a black-outlined square, and to its right on an off-white panel: the unit name in bold pixel caps with a blue drop-shadow/outline style ("KNIGHT LEVEL 1"), then three icon+number stats in a row: **gold coin icon** = purchase cost (e.g. 10), **small red/maroon coin-purse icon** = upkeep cost (e.g. 2), **gray hourglass/droplet-shaped icon** = strength (e.g. 1). (Confirmed L1: cost 10, upkeep 2, strength 1; L2: cost 20, upkeep 5, strength 2 — stats scale roughly 2×/level.)
- **UNDO**: a square button with a counter-clockwise circular-arrow icon (dark gray arrow) on a matching-style button, sits between the last BUY card and NEXT DAY.
- **HELP!**: a small rounded speech-bubble-shaped button top-right of the screen, cream background, black text/outline, tail pointing up toward the top edge — opens the Strength dialog.
- **Level label**: top-right corner, "Level: N" in white pixel-caps with black outline, no background box (floats directly over terrain).
- **Pixel font**: chunky, low-resolution bitmap sans-serif, ALL CAPS, consistently rendered white fill with a thick (1.5–2px at this scale) black outline — used identically for in-world banners ("EVERY MOVE MATTERS"), dialog titles ("- Strength -"), buttons, and HUD numbers. Outline color is not pure black but a very dark warm brown-black (`#1A1010`/`#201010`/`#211010` sampled repeatedly across different assets) — a deliberate warm-black used throughout the game's outlines (terrain, sprites, and text alike), not neutral `#000000`. Implementer note: use this warm near-black (`#1A1010`) for ALL pixel-art outlines, not pure black, to match the game's look.
- **Speech bubbles**: white rounded-rectangle with a black outline and a small triangular tail pointing at the speaking character/building, black pixel-font text inside (not the white-on-black HUD style — bubble text is plain black on white). Used both for tutorial dialogue ("I CAN'T PASS THE WALL!", "WE SHOULD COLLECT MORE... AND THEN ATTACK HIM") and for floating income call-outs ("+8", "+10" next to a coin icon).
- **"Next day..." banner**: large centered pixel-font text "Next day..." in the same white/black-outline style, overlaid directly on the map (no background panel) during the day-transition, accompanied by **flying gold coin sprites** animating from producing buildings toward the HUD/treasury counter and floating `+N`/`-N` gold-colored number call-outs appearing briefly over buildings that produced/cost money that turn.
- **Strength dialog**: modal popup, solid gold/amber background `#FBC856`-ish (visually a flat warm yellow, close to the card-header tan family but more saturated — matches `crop-strength-chart.png`), cream-white bold title "- Strength -" centered at top, 4 rows each showing `[unit sprite] → sword-arrow-icon → [defeats: unit/building sprite] [building/tower sprite]` illustrating the 4 knight-level matchups, and a large flat **green OK button** (`#228F00`-family, matching BUY green) with white pixel-caps "OK" at the bottom.
- **Weekly-challenges cards**: sky-blue page background (`#2898F0`/`#337DF8`-ish bright blue, plain flat, not diamond-textured), individual challenge entries drawn as brown wood-plank panels (`#804A1D`/`#91651A`/`#A1632D` wood-grain browns) with a darker wood footer strip showing "Available Xd Xh Xm" countdown; each panel has a trophy-rank icon (gold/silver/bronze cup or hourglass), "Creator:" and "ID:" text lines in white pixel-font, a green "Play" button (same green family), and a small embedded minimap thumbnail of that challenge's level on the right in its own cream-bordered frame.
- **Online HUD**: adds a top info strip over the normal blue bar area — "Enemy is playing (242s)" countdown text center, "Game-ID:1272" top-right, and per-player XP readout ("Blue: 944XP", "Red: 1056XP") stacked below the Game-ID, all in the same white/black-outline pixel font, colored player-name labels tinted to match that player's territory color.

## 7. Overworld / level select

Confirmed via `crop-overworld.jpg` and `wt-0015.jpg`/`wt-0075.jpg`: a single continuous top-down island landmass (same tile art as in-level terrain — grass, forest clusters, a lone farm building) with a **dirt path** winding across it connecting a series of **circular level nodes** — each node is a ring (tan/gold outer ring, darker brown inner ring) sitting directly on the path, unlabeled in these frames (numbers likely appear on closer zoom/tap). A small player-avatar sprite (same chunky humanoid style, blue shirt) stands on the path at the current/selected node, functioning as a "walking figure" marker rather than a cursor — i.e. the meta-progression map is literally a tiny inhabited island the player's avatar walks across between missions, using the exact same rendering pipeline as gameplay (same trees, same water/shoreline treatment) rather than a distinct stylized "world map" art style.

## 8. Colour palette table

| Name | Hex | Where sampled / used |
|---|---|---|
| Grass fill | `#B0D848` | base grass ground |
| Grass grid line | `#8DAD3A` | grass tile boundary |
| Grass field (mowed patch) | `#99D333` | non-farmable light patch, Strength dialog |
| Desert fill | `#F4BF73` | sand ground |
| Desert grid line | `#C39A5C` | desert tile boundary |
| Snow fill | `#F2F2F2` | snow ground |
| Snow grid line | `#C2C2C2` | snow tile boundary |
| Water | `#2898F0` | open water, all biomes |
| Water shading/current | `#1453BB` | water depth line/shadow |
| Icy water (snow biome) | `#D5EFFE` | frozen-looking shallow water |
| Road / path | `#F0CE70` (≈`#F4D372`/`#ECCB6A`) | dirt roads, all biomes |
| Mountain/rock mid | `#A86061` | boulders, all biomes (biome-independent) |
| Mountain/rock highlight | `#BF806F` | boulder highlight |
| Mountain/rock shadow | `#784049` | boulder shadow |
| Pine canopy | `#209058` | forest tiles |
| Pine shadow | `#1F5847` / `#0E623E` | forest tiles, shaded lobe |
| Pine highlight | `#60C05F` | forest tiles, lit fleck |
| Tree trunk | `#502820` / `#7D4F1F` | base of trees |
| Bridge/wood | `#A28444` / `#7D4F1F` / `#C08A4F` / `#B08324` | bridges, wooden towers, palisades |
| Stone (light) | `#AFB9D2` | tower/castle stone highlight |
| Stone (mid) | `#838A9C` | tower/castle stone base |
| Stone (dark) | `#4D525E` | tower/castle stone shadow |
| Gold coin | `#D7A800` / `#FED942` / `#FFD800` | coin icon, gold UI accents |
| Warm-black outline | `#1A1010` (≈`#201010`/`#211010`) | ALL pixel-art outlines (terrain, sprites, text) — not pure black |
| White (text fill) | `#FFFFFF` | HUD/banner text |
| HUD bar blue (old UI) | `#5468E1` (accent `#4457CF`) | 2021 bottom bar, active state |
| HUD bar red (old UI) | `#FA474B` (accent `#EE3B3F`) | 2021 bottom bar, nothing-affordable state |
| BUY / OK green | `#228F00` | affordable card, dialog OK button, Play buttons |
| MONEY / unaffordable red-orange | `#DF2607` → `#F65B2F` | unaffordable card |
| Card tan/khaki (strategy cards) | `#E3C798` | large pre-purchase card border/header |
| Card cream (strategy cards) | `#F1E2B2` | large pre-purchase card body |
| Weekly-challenge blue bg | `#2898F0`/`#337DF8` | Weekly Challenges page background |
| Weekly-challenge wood panel | `#804A1D`/`#91651A`/`#A1632D` | challenge card panels |
| **Player — Blue** | `#337DF8` (alt `#2DA2F2`/`#1453BB` shade) | territory border, unit/roof tint |
| **Player — Red** | `#C6293B` (alt `#CD2E43`, shade `#AD192E`) | territory border, unit/roof tint |
| **Player — Green** | `#52C73F` | territory border (minimap) |
| **Player — Magenta/Pink** | `#DE26D3` | territory border (minimap) |
| **Player — Gray/Neutral** | `#595959` | territory border (minimap) |
| Player — Yellow/Purple/8th | *not confirmed in screenshots* | inferred from "up to 8 players" marketing copy; pick 3 more saturated, distinguishable hues (suggest yellow, purple, orange/teal) |

## 9. Motion & feedback

Static screenshots can't confirm continuous animation, but the following transient/state effects are directly evidenced:
- **Day-transition banner**: "Next day..." pixel-font text fades in centered over the map; simultaneously small gold coin sprites appear to fly outward from income-producing buildings (farms, mines, captured cities) toward the HUD treasury counter, each paired with a floating `+N`/`-N` gold-colored number that appears briefly above the building and presumably drifts/fades.
- **Selection dim/highlight swap**: instant (not obviously animated) — non-reachable tiles darken under a semi-transparent overlay the moment a unit is selected; reachable tiles' dotted-border box appears at the same time.
- **Floating income call-outs**: white speech-bubble "+N [coin]" labels appear pinned above farms/mines even outside the day-transition (seen anchored above buildings in normal play screenshots), suggesting they're a persistent/toggleable overlay rather than a one-shot animation.
- **HUD state swap**: the bottom bar's entire color scheme flips red→blue depending on whether any purchase is affordable — a clear, high-contrast state signal rather than a subtle one.
- No sprite walk-cycle, attack animation, or building-construction animation frames were captured in the available stills; treat idle bob / walk-cycle as a reasonable implementation choice, not a confirmed spec.

## 10. Typography and iconography

- **Coin icon**: a flat gold circular coin, sometimes with a small embossed detail, used identically for "cost" and "treasury" stats — differs from the **income icon** only by a small green circular "+" badge overlapping its upper-left, which marks it specifically as the *income* stat.
- **Upkeep icon**: a small red/maroon rounded coin-purse or pouch shape, visually a "bag of money" in a warning-red tone — distinct enough from the plain gold coin to read as a cost-drain rather than a cost-gain at a glance.
- **Strength icon**: a simple gray sword-blade silhouette (used both as the stat icon on unit cards and as the literal "attacks/defeats" arrow-icon inside the Strength dialog's matchup rows, there rendered as a green arrow with a small sword on it).
- **Shield badge**: rounded-top pentagon shield shape, filled with the owning player's color, thick black outline, white pixel-font number centered — reused identically for both the "protected tile" defense-count badge and (recolored) the wall-ownership flag context.
- **Font**: one consistent bitmap pixel font throughout — blocky, monospaced-feeling, ALL CAPS only (no lowercase glyphs observed anywhere), white fill, thick warm-black (`#1A1010`) outline, used at multiple scales from tiny HUD numbers to full-screen marketing headlines ("DIFFICULT TO MASTER") without any style change — just size.

---

## Sprite pixel resolution (estimate)

Measured a clean, non-JPEG close-up sprite (play-05.png peasant portrait card) for stair-step block size: a horizontal scanline through the shirt/arm produced solid-color runs of 8, 16, 24 screen px — a consistent 8px base unit. The portrait's green card interior is ~190 screen px wide, i.e. roughly **24 "native" pixels wide** at that block size. Combined with the level of readable detail (hair part, individual eyes, shirt fold shading, belt buckle, distinct boot shapes) visible at that block count, the source art is consistent with a **~24×24 to 32×32 px native character canvas**, scaled up with hard nearest-neighbor scaling (no anti-aliasing blur at any zoom level — edges are always crisp stair-steps, confirmed visually in `sprite-zoom2.png` derived from play-05.png). Terrain tiles read as a similar or slightly larger native resolution (16–32px) given the grid-line-to-detail ratio.

**Implementer recommendation**: draw all sprites/tiles on an offscreen canvas at a fixed native resolution — **32×32 px is a safe, detail-comfortable working size** for both units and terrain tiles — then blit scaled with `imageSmoothingEnabled = false` (canvas) / `image-rendering: pixelated` (CSS) to reproduce the game's crisp, unblurred pixel-art look at any zoom level.

---

## Asset-pack / licensing check

Web search confirms:
- Developer: **Michael Haberzeth** (studio/package id `com.hbrz.wodan`, "HBRZ-Developer"), marketed as "easy to learn, but hard to master," local multiplayer up to 8 players.
- **Music** is credited to **Matthew Pablo** (matthewpablo.com), a commercial composer-for-hire whose tracks are licensed by many indie games — a music credit, not a visual-asset source.
- **No evidence found** connecting Island Empire's visuals to any known stock pixel-art pack (Kenney, Tiny Swords, Sprout Lands, Pixel Frog, OpenGameArt/LPC, etc.) — searches for the game name alongside each pack name returned no results tying them together. The art's specific traits (warm near-black outlines instead of pure black, uniform ~24–32px chunky proportions, biome-shared rock palette, dotted-bead territory borders) don't match the visual signature of any of those named packs closely enough to suggest a direct source either. Best assessment: **bespoke/commissioned pixel art**, not a licensed asset pack.
- Since we are redrawing everything from scratch in code regardless, there is no licensing blocker either way — this section is informational only.

---

## Sources

All paths relative to `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/island-empire/research/`.

- `screenshots/store/play-01.png` through `play-10.png` — official Google Play screenshots, current version (2025–26), 1080×1920.
- `screenshots/video/wt-0005.jpg` … `wt-1500.jpg` (57 frames), `sheet-a00.jpg`…`sheet-b04.jpg` (contact sheets) — 2021 walkthrough video frames, 608×1080, older campaign UI.
- `screenshots/video/crop-hud-cards.png`, `crop-hud-unitcard.png`, `crop-hud-unitcard-l2.png`, `crop-strength-chart.png`, `crop-overworld.jpg` — pre-made enlarged crops.
- Pixel measurements performed in-session with Python 3 / Pillow (`Image.getpixel`, grid-line edge detection, color-frequency histograms) directly against the above files.
- Web search (2026-09-21): developer/music attribution via app-store listing aggregators (AppGrooves, AppAgg) and matthewpablo.com reference; no direct source URLs quoted verbatim as none contained the specific attribution sentence — synthesized from multiple listing pages returned for query `"Island Empire" hbrz Haberzeth "Matthew Pablo" music`.
