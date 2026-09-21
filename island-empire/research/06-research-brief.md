# Research Brief — Island Empire (HBRZ-Developer)

Consolidated from lanes 00–05 plus direct inspection of 10 official store screenshots and ~200 frames captured from three YouTube walkthroughs (campaign levels 1–10 from 2021, levels 18 and 24 from 2022). Where lanes disagree with the screenshots, the screenshots win. Every number is tagged **[confirmed]** (seen on screen or in store copy), **[inferred]** (derived from the Slay/Antiyoy genealogy or extrapolated) or **[decision]** (chosen for the replica; recorded in DECISIONS.md).

Written 2026-09-21. Evidence files: `research/screenshots/store/play-03..10.png`, `research/screenshots/video/wt-*.jpg` (levels 1–10), `research/screenshots/video/l24/f-*.jpg` (level 24), `research/screenshots/video/crop-*.png` (enlarged HUD/strength-chart/shield crops), `research/screenshots/video/l18-infocards.jpg`.

---

## 1. Identity

| Fact | Value | Source |
|---|---|---|
| Title | *Island Empire — Strategy* (Google Play, `com.hbrz.wodan`) / *Island Empire: Build & Conquer* (iOS 1552391458) | store pages |
| Developer | Michael Haberzeth, solo, publishing as HBRZ-Developer (Roding, Germany); music by Matthew Pablo | store pages |
| Released | 9 Aug 2020 (Android); 1M+ installs, 4.2★ / 19.6K ratings (Play), 4.8★ / 151 (iOS) | store pages |
| Genealogy | Developer's own words (Play review reply, 12 Jul 2026): *"I always love the gameplay from Slay and Antiyoy, i just missed some nice graphics and a level selector. That's why i maked my own game with this gameplay."* | Play reviews |
| Tagline | *"No luck, no money, no upgrades. Only your skill counts."* — fully deterministic, no RNG in combat | Play description |
| Engine | Unity (changelog "Unity: Security update") | App Store what's-new |
| Unrelated namesake | GameFAQs/Neoseeker/Gamezebo "Island Empire" guides describe Tap4Fun's 2011 MMO. **Never cite them.** | verified by reading |

## 2. The board — a SQUARE grid, not hex

**[confirmed]** Every screenshot and frame shows a square tile grid with thin grid lines, 4-neighbour (orthogonal) adjacency for protection (diagonal tiles never carry a shield badge; see `crop-shields-wt-0330.png`), and territory borders drawn as rows of coloured beads along tile edges. Lanes 01–03 assumed hex from the genealogy; that assumption is wrong and the spec must not carry it.

Map sizes seen: campaign levels are roughly 10×12 to 14×18 tiles, larger than one phone screen (the camera pans; the level-24 map is ~12 wide). The level map is drawn as a framed window over a parchment world map (2021 build) — the world map bleeds around the framed level.

### Terrain types **[confirmed by sight]**

| Tile | Passable / ownable | Income | Notes |
|---|---|---|---|
| Grass (biome: grass), Sand (desert), Snow | yes | +1 per turn when owned | three biome palettes; desert added v1.4.7.3; snow seen in campaign level 33 |
| Water (with sand shoreline) | no | — | bounds the island; ponds inside |
| Bridge | yes, ownable | +1 | wooden plank tile spanning a 1-tile water gap; units cross it |
| Forest (pine / palm / blue-ice pine by biome) | **no** — dense forest blocks like mountains | — | provinces route around them; units never stand in forest |
| Mountain (pink rock piles; ice crystals in snow) | no | — | choke points |
| Grass field (lighter rounded patch on an ownable tile) | yes | **0** (tutorial: *"WE CAN'T EARN [coin] WITH THIS GRASS FIELD"*) | any unit (even L1) may clear it by moving onto it (strength chart row 1: L1 → farm, grass field). Equivalent of Slay's tree. Store screenshot shows "−1" bubble over it in the 2025 income layout. |
| Grave (tombstone) | yes | 0 ("−1" bubble) | left where a unit died; clears when a unit steps on it; **[decision]** turns into a grass field after 2 turns |
| Road (sand path) | cosmetic | — | purely visual; passes under walls |
| Decorations: rocks, flowers, bushes, small trees | cosmetic | — | scattered on ownable tiles |

**[decision]** Grass fields do not spread (no evidence of spreading anywhere in 200 frames; maps use them as fixed obstacles). Graves become fields.

## 3. Provinces, cities, win condition

- **[confirmed]** Territory = connected groups of same-colour tiles (4-adjacency). Each group of ≥2 tiles is a *province* with one **City** (capital) that banks the province's gold. Slyther Droid: *"when your territory is split in half, a new empire will form… with its own economy."*
- **[confirmed]** Win: *"Destroy the enemy cities to win the game."* A player is eliminated when they have no province with a city left. Capturing a city tile destroys it.
- **[inferred, Antiyoy `FieldManager.splitProvince`] [decision]** On a split, the largest fragment keeps the treasury; other fragments start at 0 and get a new city on a random free tile; fragments of 1 tile lose buildings and cannot buy. Capturing the city tile itself zeroes the treasury (Slay manual). On a merge of two own provinces the treasuries are summed and the larger province's city survives.
- **[decision]** A lone tile (province of size 1) still counts as owned land and pays income into nothing; a unit standing there with no friendly neighbour starves at turn start (Antiyoy `checkForAloneUnits`).

## 4. Economy **[numbers on screen]**

| Item | Cost | Upkeep / turn | Income / turn | Strength | Evidence |
|---|---|---|---|---|---|
| Owned plain tile | — | — | **+1** | — | income equals tile count in early levels (level 1: 2 tiles → income 2) |
| Farm | **12** | 0 | **+5** (replaces the tile's +1; net +4) | 0 | `l24 f-0243` info card "FARM · 12 · +5 · 0"; store bubble "+5" |
| Mine (goldmine) | not buyable; pre-placed by level/editor (v1.6.90) | 0 | **+8** | 0 | store `play-03` bubble "+8" on a mine tile |
| Treasure chest | pre-placed | — | **+10 one-time** when captured | — | store `play-03` bubble "+10" on a chest |
| Knight Level 1 | **10** | **2** | — | **1** | info card |
| Knight Level 2 | **20** | **5** | — | **2** | info card (`crop-hud-unitcard-l2.png`) |
| Knight Level 3 | **30** [inferred: 10×level pattern] | **12** [decision] | — | **3** | strength chart; upkeep extrapolated 2→5→12→30 |
| Knight Level 4 | **40** [confirmed, store `play-05` card "Lvl 4 · 40"] | **30** [decision] | — | **4** | store card |
| Woodwall (wooden palisade/tower) | **5** | **0** | — | **2** | `l18-infocards.jpg` "WOODWALL · 5 · 0 · 2" |
| Stone wall / stone tower | **15** [decision] | **1** [decision; review: "stone walls… have upkeep"] | — | **3** | strength chart row 4 shows a stone tower as an L4-only target |
| City | auto | 0 | — | 1 | strength chart row 2: L2 destroys a city |

- **[confirmed]** Treasury and income are per province; the HUD shows the *selected/active* province's income (green ⊕ icon) and gold (coin icon). Starting gold on campaign levels is small (1–13 seen); **[decision]** random maps start every province at 10 gold (Antiyoy `DEFAULT_MONEY`).
- **[decision]** Farm price escalates +2 per farm already in the province (Antiyoy), and the shop card always shows the current price; farms must be built on an owned plain tile.
- **[confirmed]** Bankruptcy: if a province cannot pay upkeep at the start of its turn, all its units die and leave graves ("if you run out of coins, your soldiers will die"). Money floors at 0.
- **[confirmed]** The Strength/HELP chart (`crop-strength-chart.png`): L1 beats farm & grass field; L2 beats L1 and city; L3 beats L2 and woodwall; L4 beats L3, (another L3-class unit) and the stone tower. This is exactly "attacker strength must be strictly greater than the tile's defence".

## 5. Protection and combat **[confirmed by shield badges]**

- A unit protects its own tile and the **4 orthogonal neighbours that belong to the same province** at its strength. A city protects itself and its 4 neighbours at strength 1.
- **Walls protect only their own tile** (woodwall tile shows "2", the tile next to it shows the city's "1" — `crop-shields-wt-0330.png`). Unlike Slay castles they do not project. **[decision]** Stone towers likewise self-only at 3.
- Defence of a tile = max over all protectors. Attack succeeds iff attacker strength > defence. No randomness.
- When a unit is selected, every enemy tile it could reach shows a shield badge in the *defender's* colour with the defence number; own tiles show blue shields when a wall/tower is selected.
- Capturing a tile with a unit/building on it destroys that unit/building (units leave a grave only on bankruptcy; a killed unit simply vanishes — **[decision]**).

## 6. Movement and actions **[confirmed by highlight frames]**

- Tap a unit → its reachable tiles light up and the rest of the map dims (`wt-0135`, `crop-shields-wt-1050.png`); a "<" back button appears bottom-left; the HUD shows the unit's info card.
- **[decision, matches the compact lit regions]** A unit may move up to **4 steps** through tiles of its own province (4-adjacency), and the final step may be an adjacent enemy/neutral/field tile it can capture (Antiyoy `UNIT_MOVE_LIMIT = 4`). It cannot pass through forest, mountain, water (except bridges), enemy tiles or own buildings/units (except to merge).
- One action per unit per turn: a capture or a field/grave clear ends its turn; a pure move inside own territory does not (**[decision]** Slay semantics: free repositioning, one attack).
- **Merging [confirmed]**: with a unit selected the shop shows the four knight cards; buying one places it *onto the selected unit* and the levels add (L1+L1=L2, L1+L2=L3, L2+L2=L4, max 4). Moving a unit onto a friendly unit also merges. A merged unit can still act this turn only if both parts were unacted (Antiyoy rule) **[decision]**.
- **Buying [confirmed]**: with nothing selected the HUD shows Knight L1 and Woodwall cards (level 4+ also Farm; the row scrolls when more items exist **[decision]**); tapping a card enters placement mode — buildable tiles light up (own province tiles; a new unit may also be placed directly onto an adjacent capturable tile, Antiyoy `buildUnitByAttack`, **[decision]** because newly bought units act immediately per Slay). A newly bought unit is ready to move immediately.
- **UNDO [confirmed]** reverts the last action within the turn (button greys out when nothing to undo). **NEXT DAY** ends the turn.
- "One-click move" setting (v1.8.7.1, default off since v1.8.18): with it on, tapping an enemy tile adjacent to an own unit attacks without selecting first. **[decision]** implement as a settings toggle, default off.

## 7. Turn structure **[confirmed]**

1. Banner **"Next day…"** slides across; coins fly from farms/tiles to each of the player's cities ("+17" style floating text) — income is collected, then upkeep paid (floating "−12" next to the city).
2. Bankrupt provinces lose all units (→ graves). Graves owned by the mover turn to fields after their delay.
3. Player acts (buy, move, merge, undo) and taps NEXT DAY.
4. AI players act in seat order with a short animation per action; the HUD bar recolours to the acting player's colour and UNDO/NEXT DAY are disabled while they play. Online mode shows "Enemy is playing (242s)".
5. Elimination check; victory/defeat screen.

## 8. Campaign, modes, progression

| Mode | Facts | Replica decision |
|---|---|---|
| Campaign | 3 "islands" × 40 hand-made levels; Island 1 free, 2 & 3 DLC; levels 1–5 are tutorials with speech-bubble text; level counter "Level: N" top-right; every level has 3 difficulties (Easy/Normal/Hard) → "120 stars per island". Level select = walk an avatar along a dirt path with circular nodes on an island overworld (`wt-0015`, `l24 f-0003`), bridges lead to other islands. Reviewers hate that you cannot jump between levels. | Ship **one island of 12 hand-made levels** (≥10 required): 5 tutorials + 7 puzzles, with a path overworld **plus** direct tap-to-jump (fixing the complaint). Stars per difficulty stored per level. |
| Difficulties | Same map, AI difficulty differs (and probably starting gold). | Easy/Normal/Hard = AI tier (see §10) and starting-gold handicap for the AI. |
| Random maps | "Random maps… for endless replayability", up to 8 players, local hot-seat. No setup screen documented. | Setup screen: size (S/M/L), players 2–8 (human/AI per seat, colour), difficulty, seed; generator §11. |
| Local multiplayer | hot-seat, up to 8 colours (Island 1 has 4 colours, DLC up to 8). | Pass-and-play with a "Player X's turn" hand-off screen. |
| Weekly challenges | Community-made maps (creator name, map ID, thumbnail, 3 medals, "Available 6d 13h 59m"), rotate weekly (`play-06`). | **Weekly challenge = three maps chosen deterministically from the seeded pool + the community pool by ISO week**; medals for each difficulty beaten; countdown to next Monday 00:00 UTC. |
| Online (2025+) | Async online vs a remote player with Game-ID and XP (`play-10`). | Out of scope (documented). |
| Map editor | IAP; tools undocumented. | **In scope**: paint terrain/biome, place cities/units/walls/farms/mines/chests/fields, set owner per tile, player count, name; validate (every player has a city, land connected); save to DB; play; share by URL. |
| Skins | "Unlockable skins for your civilization" — city sprites differ (stone-age tents, medieval, snow village). | One skin per biome (cosmetic), no unlock economy. |
| Undo, settings | Undo exists; settings gear top-left; music/sound toggles; one-click-move toggle. | Same. |
| Ads/IAP | Free + ads + DLC + coins. | None. Everything free. |

## 9. UI inventory (see 03-ux-flow.md and 05-visual-design.md)

- **Top bar**: gear (settings) top-left; "Level: N" top-right; "HELP!" speech-bubble button below it (opens the Strength chart with OK).
- **Bottom HUD bar** (colour = acting player): left column income "⊕ N" and gold "◎ N"; then cards: `[unit portrait] BUY` (yellow = affordable, red "MONEY"/red BUY = unaffordable, green BUY = selected/affordable in merge mode); `UNDO` (curved arrow, greyed when empty); `NEXT DAY` (blue arrow). With a unit selected: four knight cards (L1–L4) replace the shop; with a unit/building tapped once: an info card "KNIGHT LEVEL 2 · ◎20 · [upkeep]5 · [sword]2" / "WOODWALL · 5 · 0 · 2" / "FARM · 12 · ⊕5 · 0".
- **Tutorial speech bubbles** (white rounded box, small caps pixel font, tail to the speaker): "LET'S DESTROY THE ENEMY CITY", "I CAN'T PASS THE WALL!", "WE SHOULD COLLECT MORE [coin] AND THEN ATTACK HIM", "WE NEED A LEVEL 2 KNIGHT TO DESTROY HIM", "WE CAN'T EARN [coin] WITH THIS GRASS FIELD".
- **Floating numbers**: "+5", "+17", "−12", "+1" over tiles/cities during Next day.
- **Weekly challenge cards**: brown wood panels on blue: trophy icon, "#1", "Creator: name", "ID: 3859", green Play button, three medal dots, map thumbnail, "Available 6d 13h 59m".
- **Overworld**: island with dirt path, circular nodes, avatar walks node to node; tap a node to open the level; stars shown per node.
- **Victory/defeat**: not captured; **[decision]** modal with stars earned, "Next level" / "Retry" / "Menu".

## 10. AI (from Antiyoy source, lane 04 §4) — **[decision]** reuse the two-phase greedy heuristic

Per province each turn: (1) for every ready unit: attack the reachable enemy tile with the highest *allure* (count of own neighbours), heavy units prefer walls; else clear a field; else retreat off an exposed border tile. (2) Spend: build walls where predicted defence gain ≥ threshold; then buy units in ascending level only when they can attack something now and the province stays solvent for `level+1` turns; merge when it enables a needed capture. Difficulty deltas: Easy — no walls, 50% chance to skip a unit, random target; Normal — full heuristic; Hard — plus idle-unit push to the front and expert safety check before leaving a border tile. Runs synchronously in the pure engine with a seeded PRNG; the UI animates the resulting action list.

## 11. Random map generation — **[decision]** adapted from Antiyoy `MapGenerator` to a square grid

Seeded PRNG → island blob flood fill (1–4 blobs by size) → road-link blobs → crop to bounds → require one connected landmass ≥ 25% of bounds → scatter mountains/forest clusters/fields/ponds → assign every land tile a random owner → balance passes (split provinces > 5 tiles, equalise province counts per player within 1, place a city in every ≥2-tile province, give every seat at least one province of ≥3 tiles near a distinct start) → every province starts with 10 gold and one L1 unit. Roads/bridges decorative except bridges over 1-tile channels.

## 12. Efficiency note

- The engine is a pure TypeScript module (state in, state out), no React, no DOM; AI and generator run in it. Rendering is a single `<canvas>` painted per frame from immutable state with a dirty flag; sprites are pre-rasterised once per (tile, colour) into offscreen canvases so a 20×20 map draws in < 2 ms.
- Persistence is only needed for: campaign progress/stars, settings, custom maps, weekly-medal records. Progress and settings live in `localStorage` (instant, offline). Custom maps and challenge records go to Postgres (PGlite locally, Neon on Vercel) through thin API routes so maps can be shared by URL — the same pattern as the Linear replica (`00-repo-conventions.md`).
- No server compute per turn: the whole game runs client-side, so Vercel only serves static assets plus a few tiny API routes.

## 13. Open questions and the defaults taken

| Question | Default |
|---|---|
| L3/L4 upkeep | 12 / 30 (curve 2,5,12,30) |
| Stone tower numbers | 15 gold, 1 upkeep, strength 3, self-only |
| Do fields spread? | No |
| Movement range | 4 steps through own province |
| Newly bought unit may attack immediately? | Yes (Slay 2001 change, Antiyoy) |
| Starting money random maps | 10 per province |
| Farm price escalation | +2 per existing farm in the province |
| Killed unit leaves a grave? | Only bankruptcy leaves graves |

## 14. Sources

Store: https://play.google.com/store/apps/details?id=com.hbrz.wodan · https://apps.apple.com/us/app/island-empire-build-conquer/id1552391458 · Reviews: https://slytherdroid.com/island-empire-review/ · https://minireview.io/strategy/island-empire-turn-strategy · Walkthroughs: https://www.youtube.com/watch?v=8FN22pM9ydI (levels 1–10, 2021), https://www.youtube.com/watch?v=Uf2mxrsrAp0 (level 24), https://www.youtube.com/watch?v=0Cy5bG4vWuI (level 18), developer playlist https://youtube.com/playlist?list=PLKDsu1IdTKoqmdeH7fn9HbGYaY5mVFn2A · Genealogy: https://www.windowsgames.co.uk/slayRules.html · https://github.com/yiotro/Antiyoy · https://www.redblobgames.com/grids/hexagons/ (not used: square grid) · Lane docs 00–05 in this folder.
