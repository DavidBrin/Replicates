# 04a — Visual Evidence Index

Reference imagery of SMG Studio's **RISK: Global Domination** (RGD), collected 2026-10-05.

> **Research evidence only.** Every file below is third-party copyrighted material (Hasbro / SMG Studio,
> or a YouTube creator's recording of their game). Nothing here is a shippable asset — these are
> look-and-behaviour references for building our own replica. Do not copy artwork into the product.

**Total: 304 files, ~53 MB**

| Folder | Files | Size | What |
|---|---|---|---|
| `screenshots/store/` | 48 | 17 MB | Official Google Play, App Store and Steam listing screenshots |
| `screenshots/web/` | 162 | 15 MB | Steam DLC map-pack screenshots + Fandom wiki map-picker tiles |
| `screenshots/video/` | 71 | 9.6 MB | Frames pulled from 9 YouTube gameplay/tutorial videos |
| `screenshots/crop-*.png` | 23 | 12 MB | 2× enlarged crops of individual UI elements |

---

## 1. Store screenshots — `screenshots/store/`

### Google Play — `play-01.jpg` … `play-22.jpg`, `play-feature-graphic.jpg`, `play-icon.png`
Source listing: <https://play.google.com/store/apps/details?id=com.hasbro.riskbigscreen>
Images pulled from `play-lh.googleusercontent.com` at `=w2560`, then re-encoded to JPEG ≤1920 px wide.

- `play-01` … `play-08` — 1920×1080 phone/Chromebook marketing screenshots (board views, battle shots, map montages, premium/map-pack promos).
- `play-09` … `play-15` — 1920×1200 tablet screenshots.
- `play-16` … `play-22` — 2560×1600 large-tablet screenshots (highest-detail store art available; best for reading HUD text).
- `play-feature-graphic.jpg` — 1296×728 store feature graphic.
- `play-icon.png` — 512×512 app icon.

### Apple App Store — `appstore-iphone-*.jpg`, `appstore-ipad-*.jpg`
Source listing: <https://apps.apple.com/us/app/risk-global-domination/id1051334048> (track id 1051334048, version 3.23, released 2026-04-22).
Fetched via the iTunes Lookup API; the publisher's own filenames name each screen, so these are the most reliably labelled store images:

| File | Screen |
|---|---|
| `appstore-iphone-01-battle.jpg` | Battle / attack view |
| `appstore-iphone-02-maps.jpg` / `appstore-ipad-01-maps.jpg` | Map selection montage |
| `appstore-iphone-03-customize.jpg` / `appstore-ipad-02-customize.jpg` | Customisation (troop skins / avatars / dice) |
| `appstore-iphone-04-rules.jpg` / `appstore-ipad-03-rules.jpg` | Game rules / setup options |
| `appstore-iphone-05-multiplayer.jpg` / `appstore-ipad-04-multiplayer.jpg` | Online multiplayer |
| `appstore-iphone-06-challenge.jpg` / `appstore-ipad-05-challenge.jpg` | Challenges / scenarios |
| `appstore-iphone-07-ranks.jpg` / `appstore-ipad-06-ranks.jpg` | Rank ladder / progression |

iPhone shots are 2048×1152, iPad shots 2048×1535 (both downscaled to ≤1920 px wide).

### Steam — `steam-01.jpg` … `steam-10.jpg`, `steam-header.jpg`
Source: <https://store.steampowered.com/app/1128810/RISK_Global_Domination/> (app 1128810, released 2020-02-19).
Native 1920×1080 capsule screenshots via the Steam `appdetails` API. `steam-header.jpg` is the store header capsule.

---

## 2. Map imagery — `screenshots/web/`

### 2a. Steam DLC map-pack screenshots — `map-<pack-slug>-01..03.jpg`
90 files: the first three store screenshots of each of RGD's **30 Steam DLC packs**, 1152 px wide.
Each pack's store page is `https://store.steampowered.com/app/<id>/`.

| Pack slug | Steam app id | Pack name |
|---|---|---|
| `advanced-map-pack` | 1761150 | Advanced Map Pack |
| `advanced-map-pack-2` | 2690000 | Advanced Map Pack 2 |
| `among-us-map-pack` | 3367050 | Among Us Map Pack |
| `community-map-pack` | 3918100 | Community Map Pack |
| `countries-continents-map-pack` | 1295330 | Countries & Continents Map Pack |
| `countries-continents-map-pack-2` | 1416090 | Countries & Continents Map Pack 2 |
| `dawn-of-the-dinos-map-pack` | 1944070 | Dawn of the Dinos Map Pack |
| `empires-map-pack` | 1179451 | Empires Map Pack |
| `enchanted-realms-map-pack` | 1850310 | Enchanted Realms Map Pack |
| `european-conquest-map-pack` | 1179453 | European Conquest Map Pack |
| `fantasy-map-pack` | 1179452 | Fantasy Map Pack |
| `feudal-japan-map-pack` | 4257580 | Feudal Japan Map Pack |
| `lost-cities-map-pack` | 1761160 | Lost Cities Map Pack |
| `myths-legends-map-pack` | 1486240 | Myths & Legends Map Pack |
| `napoleon-s-battles-map-pack` | 3564210 | Napoleon's Battles Map Pack |
| `new-world-views-map-pack` | 1179458 | New World Views Map Pack |
| `northern-map-pack` | 1179454 | Northern Map Pack |
| `pirate-map-pack` | 1179455 | Pirate Map Pack |
| `pirate-map-pack-2` | 4624950 | Pirate Map Pack 2 |
| `premium-mode` | 1179450 | Premium Mode (not a map pack — premium UI/feature shots) |
| `resistor-is-futile-map-pack` | 2236670 | Resistor is Futile Map Pack |
| `sci-fi-map-pack` | 1761140 | Sci-Fi Map Pack |
| `strongholds-castles-map-pack` | 1486241 | Strongholds & Castles Map Pack |
| `universal-domination-map-pack` | 2385960 | Universal Domination Map Pack |
| `us-city-map-pack` | 1179456 | US City Map Pack |
| `usa-advanced-map-pack` | 3269720 | USA Advanced Map Pack |
| `viking-conquest-map-pack` | 2514860 | Viking Conquest Map Pack |
| `viking-legends-map-pack` | 2831630 | Viking Legends Map Pack |
| `zombie-map-pack` | 1179457 | Zombie Map Pack |
| `zombie-map-pack-2` | 3918350 | Zombie Map Pack 2 |

### 2b. Per-map picker tiles — `mappick-<slug>.jpg`
70 files, 640 px wide, from the Risk: Global Domination Fandom wiki
(`static.wikia.nocookie.net/risk-global-domination/...`, pages under <https://risk-global-domination.fandom.com/wiki/Maps>).

These are the game's **own map-picker card art**: map name heading, an isometric render of the board with
continent outlines, and the in-game tagline. The single best reference for per-map board shape and
continent colouring.

World / global: `classic-frozen`, `simple-world`, `world-conquest`, `reverse-world`, `pangaea`, `earth-2209-a-d`, `overworld`
Continents & regions: `europe`, `europe-advanced`, `africa`, `africa-advanced`, `asia-1800s`, `central-america`, `arctic`, `new-zealand-and-australia`
Countries: `usa`, `united-states-advanced`, `us-midwest`, `us-west`, `us-northeast`, `us-south`, `canada`, `canada-advanced`, `brazil`, `brittania`, `britannia-advanced`, `france`, `deutschland`, `spain`, `italy`, `japan`, `greece`, `turkey`, `iceland`, `russia`, `moscow`, `moscow-advanced`
Historical: `roman-empire`, `roman-empire-advanced`, `ottoman-empire`, `ottoman-empire-advanced`, `qing-dynasty`, `troy`, `machu-picchu`, `himeji-castle`, `edo-city`
Cities: `new-york`, `los-angeles`, `boston`, `las-vegas-nevada`
Fantasy / sci-fi / themed: `atlantis`, `enchanted-lands`, `forsaken-lands`, `yggdrasil-the-world-tree`, `terraformed-venus`, `arrakis`, `dino-world`, `castle`, `alcatraz`, `supermax-prison`, `seaport`, `river-town`, `the-pirate-s-bay`, `skull-crossbones`, `blackbeard-s-wrath`, `mall-of-the-dead`, `city-of-the-dead`
Among Us crossover: `the-skeld`, `polus`, `mira-hq`

Two of these (`mappick-city-of-the-dead.jpg`, `mappick-edo-city.jpg`) are actually full **"Map Preview"
screen** captures rather than bare tiles — they show the in-game map-preview panel with territory count,
player count, pack box art and the green `BATTLE` button. Useful UI evidence in their own right.

### 2c. Other web images
- `wiki-classic-map.jpg` — Classic map picker tile, 812×671. Tagline: "Battle your way to global domination in the original world of RISK." Source: <https://risk-global-domination.fandom.com/wiki/Classic_Map>
- `wiki-all-maps-by-size.jpg` — SMG promo graphic listing all maps by size.

**Not collected:** `risk.smgstudio.com` does not resolve and `www.smgstudio.com/risk` returns HTTP 403 to
both `curl` and a real Chrome session. No SMG-hosted news-post imagery was obtainable; the Steam DLC
screenshots and wiki tiles cover the same ground.

---

## 3. Gameplay video frames — `screenshots/video/`

Videos were downloaded at ≤1080p with `yt-dlp` into the session scratchpad (not the repo) and frames cut
with `ffmpeg`. Filenames are `<tag>-<mmss>-<what>.jpg` where **`mmss` is the real timestamp in the source
video** (verified against contact sheets, then relabelled to match what the frame actually shows).
Frames are ≤1600 px wide, JPEG q4.

### Sources

| Tag | Video | Channel | Uploaded | Len | URL |
|---|---|---|---|---|---|
| `c3d` | Risk Global Domination 10 minutes or less — Classic map fixed 1 v 1 | Uncle Traveling Matty | 2025-01-29 | 8:15 | <https://www.youtube.com/watch?v=c3dOf3mqDUk> |
| `nyc` | RISK : Me vs 5 Bots in NYC | Drying Paint Gaming | 2025-03-18 | 13:16 | <https://www.youtube.com/watch?v=cv7OzHsmc2c> |
| `ita` | RISK — Map Showcase — ITALIAN CONQUEST | RISK It All | 2023-12-08 | 30:53 | <https://www.youtube.com/watch?v=2XgENrxYPIw> |
| `bt1` | RISK: Global Domination — Basic Training \| Draft | **SMG Studio (official)** | — | 2:43 | <https://www.youtube.com/watch?v=xRzc9bGSJcQ> |
| `bt2` | Basic Training \| Attack: Blitz Roll | **SMG Studio (official)** | — | 2:34 | <https://www.youtube.com/watch?v=IH0PzpwGJ_w> |
| `bt3` | Basic Training \| Attack: Conquering Continents | **SMG Studio (official)** | — | 1:36 | <https://www.youtube.com/watch?v=jtUNhYOBJZ4> |
| `bt4` | Basic Training \| Fortify | **SMG Studio (official)** | — | 1:47 | <https://www.youtube.com/watch?v=aRP8mDzs76A> |
| `bt5` | Basic Training \| Territory Card Trading | **SMG Studio (official)** | — | 2:37 | <https://www.youtube.com/watch?v=D3xKTUuGr4E> |
| `bt6` | Basic Training \| Attack: Manual Dice Roll | **SMG Studio (official)** | — | 2:17 | <https://www.youtube.com/watch?v=BLWuxfGuB3Y> |

Note: the `c3d` frames carry a webcam overlay in the lower-left corner (streamer facecam) that covers a
small part of the HUD. The `bt*` (official SMG) frames are clean full-screen captures and are the better
source for pixel-level UI detail.

### Frames

#### Menus, setup and lobby
| File | Shows |
|---|---|
| `c3d-0001-game-setup-ranked-1v1-rules-toggles.jpg` | **"Play Ranked 1v1 Online" setup screen** — map thumbnail (Classic), game mode (World Domination), player slots 1/2, rank band 5/8, and the full rules readout: Setup: Auto · Turn Timer: 60s · AI Difficulty: Expert · Ranked: Yes · Card Bonus: Fixed · Dice Rolls: Balanced Blitz · Min/Max Rank: Novice–Master · Alliances: Off. Blizzards / Fog of War / Portals modifier toggles on the right; FFA / 1v1 tabs and green Join button at the bottom. **The single most important setup reference.** |
| `c3d-0012-lobby-waiting-for-host.jpg` | Lobby "Waiting for host…" state, with the "Each turn you will DRAFT • ATTACK • FORTIFY" hint |
| `c3d-0813-select-a-game-type-menu.jpg` | **"Select a game type"** — five cards: Basic Training (guided tutorials) · Solo (battle AI in solo games and scenarios) · Ranked 1v1 (competitive online 1v1) · Casual (unranked vs friends or online) · Pass & Play (local, one shared device). FFA/1v1 toggle + BATTLE button |
| `c3d-0801-home-main-menu.jpg`, `c3d-0811-home-main-menu-2.jpg` | **Home / main menu** — 3D troop model, player avatar + name, rank/battle-points bar, loot box, timed map-pack sale banner (Dune / Viking Legends), News + Shop buttons, big green BATTLE button with games-played count |
| `bt3-0124-training-menu-basic-training-3of6.jpg`, `bt4-0008-basic-training-title-card.jpg` | Training menu: the 6-module Basic Training list (Draft, Attack: Blitz Dice Roll, Attack: Conquering Continents, Fortify, Territory Card Trading, Attack: Manual Dice Roll) with per-module reward (+50) and Replay state |
| `bt1-0115-get-ready-player-assignment.jpg` | "Get Ready" / "You are player 2 — General of the Red Troops" |
| `c3d-0030-turn-start-banner-plus5-3d-token.jpg` | Turn-start banner with 3D troop model and the +N reinforcement count |
| `nyc-0445-turn-banner-troops-awarded-6-territories.jpg` | Turn-start banner: "Troops awarded for occupying **6** territories" (+3) |
| `bt1-0055-received-troops-award-popup.jpg` | "Received Troops — 3 — Total troops / Troops awarded for occupying 10 territories" |

#### Board, maps and the HUD
| File | Shows |
|---|---|
| `c3d-0042-classic-map-draft-phase.jpg` | **Classic world map**, draft phase, red vs green, full HUD |
| `c3d-0140-draft-prompt-territories-highlighted.jpg` | Draft prompt "Tap any of your territories to begin deploying troops", owned territories glowing |
| `bt1-0200-deploy-troops-slider-territory-labels.jpg` | Classic map with **territory names rendered** (Western Europe, Southern Europe, Egypt, Middle East, India, China, Siam, Indonesia, New Guinea, Western/Eastern Australia, Congo, East Africa, North Africa, Madagascar, Brazil, Peru, Argentina, Venezuela, Central America…) — best territory-label reference |
| `bt3-0052-continent-overlay-bonus-legend.jpg` | **Continent Overlay** — the continent-bonus legend. North America +5 (3/9, 33%) · Europe +5 (1/7, 14%) · Asia +7 (5/12, 42%) · South America +2 (4/4, 100%) · Africa +3 (0/6, 0%) · Australia +2 (0/4, 0%). Also shows the left vertical overlay toolbar |
| `bt3-0104-continent-overlay-australia-zoom.jpg` | Continent overlay zoomed on Australia (+2, 0/4) |
| `ita-0130-continent-overlay-italian-conquest.jpg` | Continent overlay on the **Italian Conquest** map with named custom regions and bonuses (+4 South-Eastern France, +3 Northern Italy, +6 Eastern Empire, +2 Italian Islands, +6 Potion Peninsula, +3 Adriatic Coast) |
| `ita-0030-capital-phase-bottom-bar.jpg` | **Capital Conquest mode** — the CAPITAL phase in the bottom action bar |
| `ita-0700-italian-conquest-draft-round3.jpg` | Italian Conquest board mid-game; note the `Round 3` counter top-left |
| `nyc-0030-nyc-map-attack-phase.jpg`, `nyc-0115-nyc-map-six-player-sidebar.jpg` | **New York City map**, 6-player free-for-all; right-hand player roster with six colour-coded rows |
| `c3d-0740-late-game-board.jpg` | Late-game board, one colour dominant |
| `bt5-0030-draft-phase-map.jpg`, `bt5-0100-draft-phase-map-2.jpg`, `bt2-0155-attack-phase-map.jpg` | Additional clean board states |

#### Draft / deploy
| File | Shows |
|---|---|
| `bt1-0145-deploy-troops-slider.jpg`, `bt1-0200-…` | **"Deploy Troops"** count slider: red ✗, 1 2 **3** 4 5 with the selected value ringed, green ✓ |
| `c3d-0620-troop-bonus-no-matching-cards.jpg` | **"Troop Bonus!"** banner — "2 troops deployed to Argentina for controlling that territory. You have 10 more to deploy." Shows the card-bonus table (4 Infantry / 6 Cavalry / 8 Artillery / 10 All Three) and the greyed **"No Matching Cards"** button |

#### Attack — dice, blitz, conquest
| File | Shows |
|---|---|
| `bt6-0030-manual-dice-rolling-midroll.jpg` | **Manual dice roll mid-roll** — 3D red dice tumbling over the contested border |
| `bt6-0135-manual-dice-results-on-map.jpg` | Manual dice settled, result pips readable |
| `bt2-0025-blitz-win-chance-100-attack-limit.jpg` | **Battle view**: "Blitz Win Chance 100%", three stacked dice, `Blitz` button with ◀ ▶ steppers, attacker/defender avatar discs with troop counts, and the **Attack Limit** slider ("100% · 7/7 Troops") |
| `bt2-0045-blitz-win-chance-99-dice.jpg`, `bt2-0135-blitz-win-chance-91.jpg`, `bt5-0105-blitz-win-chance-99.jpg`, `bt3-0032-blitz-win-chance-100-vs-green.jpg` | Blitz odds at 99 / 91 / 100 % |
| `bt6-0050-blitz-win-chance-46-attack-limit.jpg` | Blitz odds at **46 %** — low-odds styling |
| `bt2-0150-blitz-win-chance-6-low-odds.jpg` | Blitz odds at **6 %** — worst-case styling |
| `bt2-0105-attack-select-adjacent-territory.jpg` | "Select an adjacent territory to attack" prompt with legal targets highlighted |
| `bt3-0036-blitz-conquest-minus1.jpg`, `bt6-0140-conquest-after-manual-roll.jpg` | Conquest moment — the floating −1 loss indicator and territory flip |
| `bt6-0015-tip-manual-dice-roll.jpg` | Tutorial card: "Manual dice roll: An attack which mimics the RISK board game experience" |
| `bt6-0040-tip-blitz-purpose.jpg` | Tutorial card: "Purpose: Take control of a territory with less risk" |
| `bt6-0200-tip-three-dice-higher-success.jpg` | Tutorial card: "A manual roll with 3 dice will have a much higher success rate" |

#### Territory cards
| File | Shows |
|---|---|
| `bt5-0025-card-trade-panel-plus10.jpg` | **Cards panel** — three selected cards (Japan Infantry, Indonesia Cavalry, Ukraine Artillery), the **Bonus legend** (4 Infantry · 6 Cavalry · 8 Artillery · **10** All Three), and the green **"Trade In Now +10"** button. Best single card-UI reference |
| `bt5-0045-card-trade-panel-plus6.jpg` | Cards panel, matched-set trade worth +6 |
| `bt5-0115-card-trade-panel-plus12.jpg` | Cards panel, 5 cards held, trade worth +12 |
| `bt5-0145-forced-card-trade-in-panel.jpg` | **"Forced card trade in"** — the mandatory trade at the 5-card cap |
| `bt5-0120-tip-fixed-card-bonus.jpg` | Tutorial card: "Fixed Bonus: Fixed amount of troops determined by the card type" |
| `bt5-0125-tip-progressive-card-bonus.jpg` | Tutorial card: "Progressive Bonus: A progressive increase in troops every trade" |
| `bt5-0015-tip-cards-traded-for-troops.jpg` | Tutorial card: "Territory cards can be traded in for troops" |
| `c3d-0250-territory-card-bonus-madagascar-award.jpg` | **"Territory Card Bonus!"** end-of-turn card award — the drawn card (Madagascar) flying up with a `+1` |

#### Fortify and end of turn
| File | Shows |
|---|---|
| `bt4-0024-fortify-select-source-territory.jpg`, `bt4-0100-fortify-select-source-2.jpg` | "Select a territory to move your troops from" |
| `bt4-0028-fortify-troops-slider-arrow-path.jpg` | **"Fortify Troops"** — count slider plus the chevron arrow path drawn across the connected territories |
| `bt4-0036-tip-fortify-once-per-turn.jpg` | Tutorial card: "You can only fortify once per turn" |
| `bt4-0120-tip-fortify-optional.jpg` | Tutorial card: "Fortify is optional and can be skipped" |
| `bt4-0126-end-turn-skip-fortify-confirm-dialog.jpg` | **End-turn confirm dialog** — amber banner "End Turn / Skip Fortify phase? (This confirmation can be turned off in game settings)" with ✗ / ✓ buttons |
| `bt4-0124-fortify-phase-end-turn-button.jpg`, `c3d-0230-fortify-phase-end-turn-button.jpg`, `c3d-0420-fortify-select-source.jpg` | FORTIFY phase bottom bar with the green `End Turn` button |
| `c3d-0400-attack-phase-end-attack-phase.jpg` | ATTACK phase bottom bar with the green `End Attack Phase` button |

#### Elimination, victory and social
| File | Shows |
|---|---|
| `bt5-0104-blitz-win-chance-99-zoomed-battle.jpg` | **Zoomed Blitz battle view at 99 %** — tilted camera, attacker/defender portraits, three red dice, Attack Limit slider at 7/7. (Originally mislabelled as a "Defeated!" banner; no elimination-banner frame was captured.) |
| `bt5-0108-territory-cards-seized-on-elimination.jpg`, `c3d-0743-territory-cards-seized-plus2.jpg` | **"Territory Cards Seized!"** — the defeated player's cards transferring to the attacker (`+2`) |
| `c3d-0749-victory-conquered-all-opponents.jpg` | **Victory!** — "You conquered all your opponents!" |
| `c3d-0751-victory-battle-points-earned.jpg` | Victory screen with the Battle Points Earned readout |
| `bt1-0025-victory-screen-conquered-all.jpg`, `bt3-0032-…`, `bt4-0130-fortify-training-complete.jpg`, `bt4-0128-outro-and-thats-it.jpg` | Tutorial victory / module-complete screens |
| `c3d-0610-chat-emote-quickchat-panel.jpg` | **Chat / emote panel** — emote sticker grid (9 slots + "…"), channel selector (`ALL`), and canned quick-chat lines: "Good luck!", "Well played!", "Victory!", "Good game!" |
| `nyc-0200-chat-emote-panel-alliances-off.jpg` | Chat panel with the system notice **"The host has deactivated alliances for this game. No private chat allowed."** and a "Let's Attack" emote — evidence for the alliance/chat gating rules |
| `ita-0600-chat-panel-alliances-disabled.jpg` | Same panel on the Italian Conquest map |

---

## 4. UI element crops — `screenshots/crop-*.png`

2× nearest-free (Lanczos) enlargements cut from the frames above with PIL. Each filename says what it is.

| File | Source frame | Element |
|---|---|---|
| `crop-troop-tokens-multicolour.png` | `bt1-0200` | Troop tokens — circular discs with a drop shadow and a bold white number, in green, red, purple and magenta, sitting over the territory with the territory name under them |
| `crop-troop-tokens-purple-magenta.png` | `bt1-0200` | Same, South America, purple / magenta variants |
| `crop-3d-troop-figures-on-territory.png` | `bt2-0025` | The 3D troop *figurines* used in the zoomed battle view (an alternative to flat tokens) |
| `crop-dice-blitz-popup.png` | `bt2-0025` | **Dice popup** — three red 3D dice, the ◀ ▶ steppers and the `Blitz` label |
| `crop-manual-dice-roll.png` | `bt6-0030` | Manual dice mid-roll across the contested border |
| `crop-blitz-win-chance-header.png` | `bt2-0025` | "Blitz Win Chance ? / 100%" header treatment (yellow percentage) |
| `crop-attack-limit-slider.png` | `bt2-0025` | Attack Limit slider + "100% / 7/7 Troops" readout |
| `crop-attacker-avatar-disc.png`, `crop-defender-avatar-disc.png` | `bt2-0025` | The two combatant discs — laurel-ringed portrait, flag badge, troop count; the bot version carries a robot glyph |
| `crop-player-roster-sidebar.png` | `bt1-0200` | **Player bar** (RGD puts it on the right edge, not the top): per-player row with avatar, troop icon + count, territory icon + count, card-count badge and a `YOU` tag |
| `crop-player-roster-fogged.png` | `c3d-0610` | Same roster with `???` counts — what fog of war hides |
| `crop-bottom-action-bar-attack.png` | `bt3-0052` | **Bottom action bar** — phase label `ATTACK`, segmented phase progress pips, green `End Attack Phase` button, avatar on the left and the dice button on the right |
| `crop-bottom-action-bar-opponents-turn.png` | `c3d-0610` | Bottom bar during an opponent's turn (greyed `Opponent's Turn`) |
| `crop-deploy-troops-count-slider.png` | `bt1-0200` | Deploy count slider — ✗ / 1 2 **3** 4 5 / ✓ |
| `crop-card-single-infantry-japan.png` | `bt5-0025` | **A single territory card** — cream card, red Infantry silhouette, territory outline, territory name |
| `crop-card-set-three.png` | `bt5-0025` | A full three-card set: Infantry (Japan) / Cavalry (Indonesia) / Artillery (Ukraine) |
| `crop-card-bonus-legend.png` | `bt5-0025` | The **card bonus legend** panel: 4 Infantry · 6 Cavalry · 8 Artillery · 10 All Three |
| `crop-trade-in-now-button.png` | `bt5-0025` | The green "Trade In Now +10" button |
| `crop-continent-bonus-overlay.png` | `bt3-0052` | **Continent-bonus legend** — all six continents tinted and outlined, each with a `+N` badge and an `owned/total (pct)` line |
| `crop-continent-bonus-badge.png` | `bt3-0052` | A single continent badge close-up (North America +5, 3/9 33%) |
| `crop-chat-emote-panel.png` | `c3d-0610` | **Chat / emote panel** — emote grid and canned quick-chat lines |
| `crop-left-toolbar-overlay-buttons.png` | `bt3-0052` | The left vertical toolbar (troop view / globe-overlay / player view toggles + red close) |
| `crop-cards-and-emote-buttons.png` | `bt3-0052` | The bottom-left card-count chip and the emote/chat button with its unread badge |

---

## 5. Coverage gaps

Screens with **no evidence collected**:

- **Alliance request / accept prompt.** Both long-form games used had alliances disabled by the host, so the
  prompt never appeared. The two chat-panel frames do document the "alliances deactivated" system message.
- **Settings screen** (audio/graphics/account options). Not reached in any sampled video.
- **Secret Mission / mission-card UI.** Mode exists (`Jo3utRIdGKk` covers it) but was not sampled.
- **Shop / store and loot-box opening.** Visible only as a thumbnail on the home-menu frames.
- **Rank ladder / progression detail.** Only the App Store `…-ranks` marketing screenshot, not the live screen.
- **Blizzards, Fog of War and Portals modifiers in play.** Named in the setup screen (`c3d-0001`); the
  `c3d-0610` and `ita` frames show a few snowflake/`?` tiles, but no clean capture of each modifier.
- **SMG Studio's own site imagery.** `risk.smgstudio.com` does not resolve; `www.smgstudio.com/risk`
  returns HTTP 403 to both curl and a real Chrome session.
