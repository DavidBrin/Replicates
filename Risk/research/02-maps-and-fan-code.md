# Maps & fan-created code — research for a browser RISK: Global Domination replica

Research lane: **maps + fan/open-source code**. Compiled 2026-10-05.

- Machine-readable output: `research/map-data/` (JSON + geometry + a licence note per source)
- Scratch working copy of every repo inspected: `/private/tmp/claude-501/-Users-fobrizzlemynizzle-Documents-Personal-Projects/60739de2-ff7c-4d89-8fd4-e5ee0b393543/scratchpad/risk-fan-code/`

## TL;DR

1. **The real game has 134 maps**, not ~20. I scraped the complete catalogue — territory count, region count, map pack, size bucket, blizzard/portal counts and **per-region bonus values** — for all 134, and cross-verified 132 of them against a second, independent wiki surface. Territory counts run 19→104. See `map-data/smg-catalogue/all-maps.json`.
2. **No public source documents adjacency for ANY SMG map.** Not the wiki, not Steam, not fan sites, not any of the map platforms. The catalogue gives you the *shape* of each map (how many territories, how many regions, what the bonuses are) but never *which territory touches which*. Map layouts exist only as flat PNGs of SMG's own artwork. **This is the one hard gap in this lane**, and it's a firm finding — I checked licences individually on Domination (107 maps), Lux Delux (1000+), Warzone, TripleA (343 repos) and MapGenie (~120 graphs); all are unlicensed, proprietary or copyleft.
3. **The classic 42-territory map is now exact, verified against 9 independent sources — 7 of which agree perfectly** (42 territories, 83 undirected edges, 6 bonuses, zero differences, across 4 languages and 5 different licences). The 2 that disagreed had 5 bad edges between them, all adjudicated. See `map-data/canonical/classic-world.json`. Notably **Northwest Territory–Quebec is NOT an edge** (a common fan-data error) and **Eastern Australia–New Guinea is**.
4. **7 playable boards with verified graphs, 3 of them with real per-territory SVG geometry** — all permissively licensed. The standout is `sonesson89/TotalRisk` (**Unlicense / public domain**, actively maintained): Classic (42), World Extended (47) and Napoleonic Europe (59), each with one `<path id="Territory Name">` per territory, verified 42/42, 47/47 and 59/59. A second permissive classic SVG comes from `dartlangfr/risk-codelab` (Apache-2.0). Plus 4 graph-only boards including **Middle Earth** (38).
5. **Every "Risk board" SVG on Wikimedia Commons is a trap.** They exist and they have per-territory ids — but they were traced from a retail Hasbro board, so the CC BY-SA tags don't actually grant what they appear to. Do not ship them. The brief's assumption that there's a clean public-domain Risk SVG on Commons is the thing to unlearn.
6. **The route to 10+ maps is generating them from public-domain geodata**, not finding them. Natural Earth (public domain), `world-atlas`/`us-atlas` (ISC) and `BlankMap-World.svg` (public domain, per-country ISO ids) are all downloaded into `map-data/`. Dissolve polygons into territories, derive adjacency topologically, hand-add sea links. See the 4-tier plan at the end.

---

# Part A — the real game's maps

## A.1 The SMG map catalogue

**Method.** The RISK: Global Domination Fandom wiki keeps one page per map, each with a uniform `article-table` infobox. I enumerated `Category:Maps` via the MediaWiki action API (138 pages), pulled the wikitext for all of them, and parsed the infoboxes. Every map page carries the same fields, so this is a structured scrape rather than prose reading:

| Field | Meaning |
|---|---|
| Number of Territories | territory count |
| Number of Continents | number of bonus **regions** (the game calls them continents even on a castle or spaceship map) |
| Number of Blizzards | how many blizzard tiles that map places when Blizzard mode is on, and the resulting playable territory count |
| Number of Portals | how many portals that map places when Portals mode is on |
| Map pack | the DLC that sells it, or `None (Free)` |
| Bonus | **per-region bonus troop values** |
| Map size | SMG's own Small / Medium / Big bucket |

**Scale.** 134 maps with pages. Territory counts run **19 → 104**; region counts run **4 → 20**.

| Bucket | Rule | Count |
|---|---|---|
| Small | ≤ 35 territories | 16 |
| Medium | 36–48 territories | 45 |
| Big | ≥ 49 territories | 73 |

> The wiki's own "Totals" section still says 16 / 44 / 71 = **131** maps. That total is stale; the live per-map pages and the live size list both come to **134**. Treat 134 as current-as-of-2026-10-05 and expect it to keep growing — SMG ships new packs regularly, including a user-made **Community Map Pack**.

**Verification.** The wiki exposes the same numbers twice: once per map page, and once on *List of all maps by size*, which encodes them in link labels as `Name (territories) [continents]`. I parsed both independently and diffed:

- **132 of 134 maps agree exactly on both counts.**
- 2 genuine discrepancies, unresolved — flag these if either map matters:
  - **Atlantis** — map page says 8 regions, size list says 9.
  - **Europe Advanced** — map page says 84 territories, size list says 83.
- 0 bucket anomalies: every map's Small/Medium/Big label matches its territory count under the wiki's own numeric rule.
- 1 map has a page but is missing from the size list (**River Town Advanced**); 1 is on the size list but has no page (**The Fungle**).
- **Bonus values are documented for 124 of 134 maps.** The 10 without are blank on the wiki, not mis-parsed: Battle of Waterloo, Battle of Charleroi, Battle for Plancenoit, Battle of Ligny, Way to Valhalla, Russia 2010 Advanced, Roots of Yggdrasil, Ratatoskr and Friends, Yggdrasil The World Tree, Moscow.

### Corrections to the brief's assumed map list

Several names in the task description don't exist in the game, and several of the ones that do have different sizes than you'd guess. All figures below are from the scrape, not from memory:

| Assumed in the brief | Reality (territories/regions, verified) |
|---|---|
| "Classic / World" | Two separate maps: **Classic** (42/6) (free) and **World Conquest** (47/6) (Premium). Plus **Classic Frozen** (42/6). |
| "Europe Advanced" | Real: **Europe Advanced** (84/14), Advanced Map Pack — the biggest Europe map. Also **Europe** (44/7). |
| "USA" | Real: **United States** (42/9) and **United States Advanced** (77/12). Plus 4 regional maps (**US Midwest** (64/12), **US West** (55/11), **US South** (54/15), **US Northeast** (34/9)) and 4 city maps (**Las Vegas, Nevada** (58/10), **Boston** (42/11), **Los Angeles** (41/7), **New York** (34/5)). |
| "Asia" | No plain Asia map. Closest: **Asia 1800s** (48/9). Also **Qing Dynasty** (35/8), **Japan** (50/9). |
| "Africa" | Real: **Africa** (37/7) and **Africa Advanced** (50/9). |
| "Americas" | Does not exist. Regional equivalents: **Central America** (61/10), **Brazil** (23/5), **Brazil Advanced** (56/8), **Canada** (53/10), **Canada Advanced** (91/13). |
| "Middle East" | No such map. Region is covered by **Ottoman Empire** (38/5), **Ottoman Empire Advanced** (59/7), **Turkey** (63/7). |
| "Napoleonic Europe" | Not an SMG name. SMG ships a **Napoleon's Battles** pack: **Battle of Waterloo** (97/19), **Battle of Charleroi** (88/14), **Battle of Ligny** (79/15), **Battle for Plancenoit** (79/14). (The TotalRisk repo separately has a fan-made map it calls "Napoleonic Europe" — see A.3.) |
| "Ancient World" | Does not exist. Ancient-themed: **Roman Empire** (43/7), **Roman Empire Advanced** (62/12), **Troy** (67/13), **Greece** (64/14), **Nan Madol** (42/7), **Machu Picchu** (38/8), **Lost Temple** (45/7). |
| "Pangea" | Spelled **Pangaea** — **Pangaea** (65/7), New World Views pack. |
| "Ring of Fire" / volcanic | No such map. Nearest thematically: **Stairs of Knowledge & Power** (41/12) (lava), **Dino Canyon** (44/8). |
| "Hub maps" | Not a category in the game. No map or pack uses the term. |
| "Great Britain" | Called **Britannia** — **Britannia** (20/4) and **Britannia Advanced** (49/4). Also **Conwy Castle** (63/9). |
| "Mars" | No Mars map. Off-world maps: **Terraformed Venus** (79/10), **Lunar Mining Facility** (62/10), **Arrakis** (36/9), **Spaceport Sigma** (96/10), **Command Base C1X** (100/11), **Orbital Objectives** (55/13). |
| "Pyramid" | Does not exist. Egyptian-themed: **City of the Dead** (75/14). |
| "the Dragon map" | No map with Dragon in the name. Fantasy packs: Enchanted Realms, Fantasy, Fantasy 2, The Younger Scrolls, Dracon Fortress (**Dracon Fortress** (44/14)). |

Only **2 maps are free**: **Classic** and **Ibai & Buddies** (a streamer collab). Everything else sits behind one of ~32 map packs. Two maps are time-limited and may be unobtainable: **Arrakeen / Arrakis** (Dune collab, until patch 3.14) and **Arkeanos** (limited edition).

### Special rules — what's actually per-map and what isn't

This matters for the replica's architecture, and the brief's framing is slightly off:

- **Blizzards and Portals are global game *modifiers*, not per-map special rules.** They are toggles (like Fog of War and Capitals) that can be turned on for *any* map; each map simply declares how many it places. So the replica needs **one** blizzard system and **one** portal system, plus a per-map count — not bespoke rules per map.
  - **Blizzard**: the tile becomes an impassable, unconquerable blockade for the whole game — it creates choke points. Crucially, *a blizzard does not block the region bonus*: you still hold the bonus if you own all the other territories in it. ([SMG discussion](https://steamcommunity.com/app/1128810/discussions/0/4630359473422153173/))
  - **Portals**: randomised each game; link two non-adjacent territories, i.e. dynamic extra edges. Two sub-types — **Stable** (fixed all game, always active) and **Unstable** (relocate every few turns, inactive for one turn after moving). ([Level Winner guide](https://www.levelwinner.com/risk-global-domination-guide-tips-tricks-strategies/))
  - Blizzard counts range 2–11; portal counts 3–7. Both scale with map size.
- **No map has "no continent bonus"**, and no map has a genuinely zero-value region. One map, **Dino Canyon** (44/8), lists its 8th region on the wiki as the literal text `-: 0` — almost certainly an unfinished wiki edit rather than a game feature, since its other 7 regions are all +4/+6. Treat as a data gap, not a rule.
- **Bonus values are not derivable from territory count.** They're hand-tuned per region. Extremes: **Pirate's Bay** has a region worth **+13**; Los Angeles, Alcatraz and New York each have a **+12**.
- **Capitals** is another cross-map mode (referenced on the Moscow and Britannia pages) — the replica should treat it as a modifier too.
- **Moscow** was **removed from the game** after the invasion of Ukraine and may never return. Its page is still up. Don't ship it.

### Full catalogue

Ordered by size bucket, then territory count. `T` = territories, `C` = bonus regions. Full data including blizzard/portal counts in `map-data/smg-catalogue/all-maps.json`.

| # | Map | T | C | Bucket | Map pack | Bonuses (region: value) |
|---:|---|---:|---:|---|---|---|
| 1 | [Simple World](https://risk-global-domination.fandom.com/wiki/Simple_World_Map) | 19 | 6 | Small | New World Views | Australia: 1, Africa: 2, South America: 2, Europe: 3, North America: 3, Asia: 5 |
| 2 | [Britannia](https://risk-global-domination.fandom.com/wiki/Britannia_Map) | 20 | 4 | Small | Empires | Pitchland: 3, Cymry: 4, Erlu: 5, Aenglaland: 7 |
| 3 | [Iceland](https://risk-global-domination.fandom.com/wiki/Iceland_Map) | 21 | 4 | Small | Northern | Westleninga Fiordung: 2, Sunnlandinga Fiordung: 3, Austlendinga Fiordung: 4, Nordlendinga Fiordung: 5 |
| 4 | [Brazil](https://risk-global-domination.fandom.com/wiki/Brazil_Map) | 23 | 5 | Small | Countries & Continents | Centro-Oeaste: 3, Sul: 3, Nordeste: 4, Sudeste: 4, Norte: 6 |
| 5 | [River Town](https://risk-global-domination.fandom.com/wiki/River_Town_Map) | 24 | 7 | Small | Fantasy | Bridge: 2, East Roads: 2, Mayor's District: 2, West Roads: 2, Fishing District: 3, General District: 3, Merchant District: 4 |
| 6 | [France](https://risk-global-domination.fandom.com/wiki/France_map) | 26 | 6 | Small | Premium | Northern France: 2, Southern France: 2, Eastern France: 3, Southwestern France: 3, Western France: 4, Central France: 5 |
| 7 | [Arrakeen Residence](https://risk-global-domination.fandom.com/wiki/Arrakeen_Residence_Map) | 30 | 9 | Small | Dune | Council Services: 2, Living Services: 2, East wing: 3, Residency Entrance: 3, West Wing: 3, Observation Deck: 4, Royal Corridor: 5, War Corridor: 5, Atreides' Quarters: 7 |
| 8 | [Castle](https://risk-global-domination.fandom.com/wiki/Castle_Map) | 31 | 6 | Small | Fantasy | Inner Distric: 2, South Guard: 2, Castle Exterior: 3, Central Plaza: 3, Military Division: 4, Royal Sanctum: 5 |
| 9 | [Mother of All Boards](https://risk-global-domination.fandom.com/wiki/Mother_of_All_Boards_Map) | 31 | 8 | Small | Resistor is Futile | Drive: 2, Memory: 3, Microchips: 3, Ram: 3, CPU: 4, Extensions: 4, Output: 4, GPU: 8 |
| 10 | [Enchanted Lands](https://risk-global-domination.fandom.com/wiki/Enchanted_Lands_Map) | 32 | 7 | Small | Fantasy | Realm of the Dead: 3, The Nether: 3, Vahalla: 3, Eternia: 4, Invisible Lands: 4, Magic Realms: 4, Mortals Retreat: 4 |
| 11 | [Moscow](https://risk-global-domination.fandom.com/wiki/Moscow_Map) | 33 | 10 | Small | Northern | _not documented on the wiki_ |
| 12 | [New York](https://risk-global-domination.fandom.com/wiki/New_York_Map) | 34 | 5 | Small | US City | Staten Island: 3, The Bronx: 3, Manhattan: 5, Brooklyn: 12, Queens: 12 |
| 13 | [US Northeast](https://risk-global-domination.fandom.com/wiki/US_Northeast_Map) | 34 | 9 | Small | USA Advanced | Maine: 2, New Jersey: 2, New York: 2, Vermon: 2, Connecticut: 3, Massachusetts: 3, New Hampshire: 3, Upstate New York: 4, Pennsylvania: 5 |
| 14 | [Greenland Saga](https://risk-global-domination.fandom.com/wiki/Greenland_Saga_Map) | 35 | 9 | Small | Viking Conquest | Helluland: 2, Stone Steps: 2, Thjodhild: 2, Iceland: 3, Markland: 3, North Stones: 3, Greenland: 4, Vinland: 4, Leif's Expedition: 7 |
| 15 | [Lindisfarne Raid](https://risk-global-domination.fandom.com/wiki/Lindisfarne_Raid_Map) | 35 | 9 | Small | Viking Conquest | Monastary: 3, Monastary Walls: 3, Priory: 3, Raiders: 3, Sanctuary: 3, Crag Top Castle: 4, Holy Island: 4, Salt Marshes: 4, Ravens Land: 5 |
| 16 | [Qing Dynasty](https://risk-global-domination.fandom.com/wiki/Qing_Dynasty_Map) | 35 | 8 | Small | Empires | Manchuria: 2, Mongolia: 2, Tartary: 2, Liangjiang: 3, Tibet: 3, Shaan-Gan: 4, Zhili: 4, Liangguang: 5 |
| 17 | [Arrakis](https://risk-global-domination.fandom.com/wiki/Arrakis_Map) | 36 | 9 | Medium | Dune | False Wall South: 1, Cielago Depression: 2, Habbanya Erg: 2, Pasty Mesa: 2, Sihaya Ridge: 2, Minor erg: 3, Funeral-Platic: 4, Hagga-Imperial: 4, Polar Sink: 4 |
| 18 | [Italy](https://risk-global-domination.fandom.com/wiki/Italy_Map) | 36 | 7 | Medium | European | Italian Islands: 2, Adriadic Coast: 3, Ottoman Creece: 3, South Eastern France: 4, Nothern Italy: 5, Italian Peninsula: 6, Austrian Empire: 7 |
| 19 | [The Imperium](https://risk-global-domination.fandom.com/wiki/The_Imperium_Map) | 36 | 9 | Medium | Dune | Flagships: 2, Frigates: 2, Heighliner Fleet: 2, Salusa Secundus: 2, Transports: 2, Giedi Prime: 3, Kaitan: 3, Wallach IX: 3, Arrakis: 7 |
| 20 | [Africa](https://risk-global-domination.fandom.com/wiki/Africa_map) | 37 | 7 | Medium | Countries & Continents | Southern Africa: 3, West Africa: 3, East Africa: 4, Horn of Africa: 4, North Africa: 5, Sahara: 5, Central Africa: 6 |
| 21 | [End of the King](https://risk-global-domination.fandom.com/wiki/End_of_the_King_Map) | 37 | 11 | Medium | Viking Conquest | Canute's Ravens: 2, Ironside's Fall: 2, First Defence: 3, Gatehouse: 3, Kingsguard: 3, Viper Fleet: 3, West Keep: 3, King's Quarters: 4, Lower Yard: 4, Battlements: 5, Crown Jewel: 5 |
| 22 | [Machu Picchu](https://risk-global-domination.fandom.com/wiki/Machu_Picchu_Map) | 38 | 8 | Medium | Lost Cities | Agriculture: 3, Farm Land: 3, Sun Temple: 3, Quarry: 3, Water Mirror: 4, Sacred Rock: 5, Temple of the Condor: 5, Principal Plaza: 6 |
| 23 | [New Zealand and Australia](https://risk-global-domination.fandom.com/wiki/New_Zealand_and_Australia_Map) | 38 | 8 | Medium | Countries & Continents 2 | North Island: 3, South Australia: 3, Victoria and Tasmania: 3, South Island: 4, Western Australia: 4, Northern Territory: 5, Queensland: 5, New South Wales: 6 |
| 24 | [Ottoman Empire](https://risk-global-domination.fandom.com/wiki/Ottoman_Empire_Map) | 38 | 5 | Medium | Empires | Mauren Provinces: 3, Ottoman Europe: 4, African Territories: 5, Asia Minor: 6, Arabia: 7 |
| 25 | [Alcatraz](https://risk-global-domination.fandom.com/wiki/Alcatraz_Map) | 39 | 5 | Medium | Zombie | Second Floor East End: 4, Basement: 6, Stockade: 6, Second Floor West end: 8, First Floor: 12 |
| 26 | [Arrakeen](https://risk-global-domination.fandom.com/wiki/Arrakeen_Map) | 39 | 9 | Medium | Dune | Deep Arrakeen: 2, Spaceport South: 2, Atreides Flank: 3, Atreides Frontline: 3, Harkonnen Frontline: 3, Marketplace & Streets: 3, Spaceport North: 3, Arrakeen Residency: 4, Harkonnen Camp: 5 |
| 27 | [Dicey Trajectories](https://risk-global-domination.fandom.com/wiki/Dicey_Trajectories_Map) | 39 | 8 | Medium | Universal Domination | Delta Quadrant: 2, Formerly Neutral Zone: 3, Zeta Cluster: 3, Sector 42: 3, Dark System: 4, Marable Twilight: 4, The Cube: 4, Worm Hole: 4 |
| 28 | [Dino World](https://risk-global-domination.fandom.com/wiki/Dino_World_Map) | 39 | 9 | Medium | Dawn of the Dinos | Frozen Wastes: 3, Mist Lands: 3, Red Lands: 3, Seasonal Frost: 3, Thundering Plains: 3, East Blossom: 4, Hunting Thickets: 4, North Verdent: 4, Roaming Plains: 4 |
| 29 | [Los Angeles](https://risk-global-domination.fandom.com/wiki/Los_Angeles_Map) | 41 | 7 | Medium | US City | Baverly Hills: 3, San Fernando Valley: 5, Central LA: 7, South Vay: 7, Westside LA: 7, Gateway Cities: 11, South LA: 12 |
| 30 | [Seaport](https://risk-global-domination.fandom.com/wiki/Seaport_Map) | 41 | 8 | Medium | Pirate | East Rock: 2, North Head: 2, Wharf: 2, Cove: 3, Pier: 4, Docks: 5, Precinct: 6, Pirate Fleet: 7 |
| 31 | [Stairs of Knowledge & Power](https://risk-global-domination.fandom.com/wiki/Stairs_of_Knowledge_&_Power_Map) | 41 | 12 | Medium | Dawn of the Dinos | Cozy Corner: 2, Fiction: 2, Private Library: 2, Dino Research: 3, Lava Learning: 3, Lost Library: 3, Lost-fiction: 3, Residential: 3, The Council: 3, VIP Room: 3, Watched City: 3, Public Library: 4 |
| 32 | [Boston](https://risk-global-domination.fandom.com/wiki/Boston_Map) | 42 | 11 | Medium | US City | Allston Brighton: 2, Charlestown: 2, Downtown: 3, East Boston: 3, Harbor Islands: 4, Jamaica Plain: 5, The Fens: 5, Waterfront: 5, West Roxbury: 5, Roxbury: 7, Dorchester: 10 |
| 33 | [Classic Frozen](https://risk-global-domination.fandom.com/wiki/Classic_Frozen_map) | 42 | 6 | Medium | Premium | Australia: 2, South America: 2, Africa: 3, Europe: 5, North America: 5, Asia: 7 |
| 34 | [Classic](https://risk-global-domination.fandom.com/wiki/Classic_Map) | 42 | 6 | Medium | — (free) | Australia: 2, South America: 2, Africa: 3, Europe: 5, North America: 5, Asia: 7 |
| 35 | [Jules Verne's Mysterious Island](https://risk-global-domination.fandom.com/wiki/Jules_Verne's_Mysterious_Island_Map) | 42 | 8 | Medium | Fantasy | Shark Gulf: 3, Serpentine Peninsula: 3, Lavaland: 4, Tadorn's Fen: 4, Washington Bay: 4, Lake Grant: 5, Mount Franklin: 5, Western Forest: 6 |
| 36 | [Nan Madol](https://risk-global-domination.fandom.com/wiki/Nan_Madol_Map) | 42 | 7 | Medium | Lost Cities | Pah: 3, Pahnwi: 3, Dapahu: 4, Idedh: 4, Nan Dowas: 5, Powe: 5, Peinkitel: 7 |
| 37 | [Ratatoskr and Friends](https://risk-global-domination.fandom.com/wiki/Ratatoskr_and_Friends_Map) | 42 | 8 | Medium | Viking Legends | _not documented on the wiki_ |
| 38 | [Supermax Prison](https://risk-global-domination.fandom.com/wiki/Supermax_Prison_Map) | 42 | 7 | Medium | Zombie | High Security: 5, Low Security: 5, Death Row: 6, General Population: 6, Max Security: 6, Solitary Confinment: 7, Admin: 9 |
| 39 | [United States](https://risk-global-domination.fandom.com/wiki/United_States_map) | 42 | 9 | Medium | Premium | New England: 1, Mid-Atlantic: 2, Pacific Coast: 2, Midwest: 3, Southeast: 3, Appalachian Highlands: 4, Rocky Mountains: 4, Southwest: 4, Heartland: 5 |
| 40 | [Yggdrasil, The World Tree](https://risk-global-domination.fandom.com/wiki/Yggdrasil,_The_World_Tree_Map) | 42 | 9 | Medium | Viking Legends | _not documented on the wiki_ |
| 41 | [Koenigsberg](https://risk-global-domination.fandom.com/wiki/Koenigsberg_Map) | 43 | 10 | Medium | European | Rossgarten: 2, Wiesen Front: 2, Friedrichsburg: 3, Haberberg: 3, Tragheim: 3, Keiphof: 4, Steindamm: 4, Vorstadt: 4, Altstadt: 5, Sackheim: 6 |
| 42 | [Lübeck](https://risk-global-domination.fandom.com/wiki/Lübeck_Map) | 43 | 9 | Medium | Northern | St Gertrud: 2, St Lorenz Nord: 2, Walhalbinsel: 2, Mühlentor: 3, Wallanlagen: 3, Huxtertor: 4, Ost Lübeck: 4, West Lübeck: 4, Lübeck Zentrum: 5 |
| 43 | [Roman Empire](https://risk-global-domination.fandom.com/wiki/Roman_Empire_Map) | 43 | 7 | Medium | Empires | Provincia V: 2, Provincia VII: 2, Provincia II: 3, Provincia III: 4, Provincia IV: 5, Provincia VI: 5, Provincia I: 6 |
| 44 | [Battle of Svolder](https://risk-global-domination.fandom.com/wiki/Battle_of_Svolder_Map) | 44 | 12 | Medium | Viking Conquest | Dreki: 2, Forkbeard Ambush: 2, Jarl Onslaught: 2, Oresund: 2, Ormen Lange: 2, Crane: 3, Iron Ram: 3, Ormen Korte: 3, Aegir's Fury: 4, Thyri's Honour: 4, Einar's Bow: 5, Saltholm: 5 |
| 45 | [Blackbeard's Wrath](https://risk-global-domination.fandom.com/wiki/Blackbeard's_Wrath_Map) | 44 | 6 | Medium | Pirate | Kraken Island: 2, La Buse: 3, New Drake: 3, L'Olonnais: 4, Port Royale: 5, Blackbeard's Providence: 7 |
| 46 | [Dino Canyon](https://risk-global-domination.fandom.com/wiki/Dino_Canyon_Map) | 44 | 8 | Medium | Dawn of the Dinos | -: 0, Carnivore Clutch: 4, Carnotaurus Cliff: 4, Hadrosaurus Plane: 4, Herbivore Hatchery: 4, Pen: 4, Temple of Bob: 4, Pterodactyl Terrace: 6 |
| 47 | [Dracon Fortress](https://risk-global-domination.fandom.com/wiki/Dracon_Fortress_Map) | 44 | 14 | Medium | Dawn of the Dinos | Lower Courtyard: 2, Nomads Path: 2, Southern Parapet: 2, Breezy Bulwark: 3, Drafty Yard: 3, Pperadactyl Nursery: 3, Pteranodon Tower: 3, Royal Observatory: 3, Tempest Rampart: 3, Wall of Winds: 3, Windy Causeway: 3, Zephyr Alley: 3, Wind District: 4, Sky King's Castle: 5 |
| 48 | [Europe](https://risk-global-domination.fandom.com/wiki/Europe_Map) | 44 | 7 | Medium | European Conquest | British Empire: 3, Ottoman Empire: 4, Russian Empire: 4, Austrian Empire: 5, French Empire: 5, German Empire: 6, Independent States: 11 |
| 49 | [Grip of the North](https://risk-global-domination.fandom.com/wiki/Grip_of_the_North_Map) | 44 | 9 | Medium | Countries & Continents 2 | Scotland: 2, Denmark: 3, Finland: 3, Greenland: 3, Northern-Europe: 3, Iceland: 4, Sweden North: 4, Sweden South: 4, Norway: 5 |
| 50 | [Skull & Crossbones](https://risk-global-domination.fandom.com/wiki/Skull_&_Crossbones_Map) | 44 | 7 | Medium | Pirate | Easton: 2, Lafitte: 2, St Bonny: 2, Morgania: 3, Corsaire: 4, Rackham: 5, New Barbarossa: 7 |
| 51 | [Lost Temple](https://risk-global-domination.fandom.com/wiki/Lost_Temple_Map) | 45 | 7 | Medium | Fantasy | Caverns of Fate: 4, Citadel of Doom: 4, Cursed Pond: 5, Shores of Hell: 6, Dungeons of Morubai: 7, Haunted Keep: 7, Abandoned Barracks: 8 |
| 52 | [SMG Spaceport](https://risk-global-domination.fandom.com/wiki/SMG_Spaceport_Map) | 45 | 12 | Medium | Universal Domination | Common Room: 2, Core: 2, Emergency: 2, Reactors: 2, Storage: 2, Weapon: 2, Connections: 3, Security: 3, Shields: 3, The Bridge: 3, Communications: 4, Cling Ons: 5 |
| 53 | [Forsaken Lands](https://risk-global-domination.fandom.com/wiki/Forsaken_Lands_Map) | 46 | 7 | Medium | Fantasy | Southern Trident: 2, Human Kingdoms: 3, Northern Barren: 3, Dragonland: 4, Dwarf Mines: 5, Eastern Barbaria: 5, Elf realm: 5 |
| 54 | [47 Ronin](https://risk-global-domination.fandom.com/wiki/47_Ronin_Map) | 47 | 9 | Medium | Feudal Japan | Charcoal Shed: 3, Inner Garden: 4, Palace Chambers: 4, Palace Residences: 4, Outer Garden: 4, Outer wall: 4, Corridors: 5, Courtyard: 5, Garden Path: 5 |
| 55 | [Arctic](https://risk-global-domination.fandom.com/wiki/Arctic_Map) | 47 | 6 | Medium | Northern | Greenland: 3, Scandinavia: 3, North America: 4, Western Russia: 4, Eastern Russia: 5, Arctic Circle: 6 |
| 56 | [Command and Controller](https://risk-global-domination.fandom.com/wiki/Command_and_Controller_Map) | 47 | 7 | Medium | Resistor is Futile | Boardlink: 3, CStick: 3, Control and Cable: 4, DPad: 5, System: 5, Analog Stick: 7, Buttons: 7 |
| 57 | [Modern Spain](https://risk-global-domination.fandom.com/wiki/Modern_Spain_Map) | 47 | 12 | Medium | Countries & Continents | Ceuta y Melilla: 2, Euskadi: 2, Extremadura: 2, Islas Canarias: 2, Aragon: 3, Cataluna: 3, Communidad Valencianna y Region De Murcia: 3, Galicia: 3, Islas Baleares: 3, Madrid y Castilla-La Mancha: 6, Andalucia: 8, Asturias, Cantabria, Castilla y Leon: 10 |
| 58 | [Moonstone Forest](https://risk-global-domination.fandom.com/wiki/Moonstone_Forest_Map) | 47 | 9 | Medium | Enchanted Realms | Green Grove: 2, Golden Root: 3, Lower forest: 3, Shady Forest: 4, Winter: 4, Autumn: 5, Summer: 5, Forest Clearing: 6, Spring: 6 |
| 59 | [REDACTED](https://risk-global-domination.fandom.com/wiki/REDACTED_Map) | 47 | 11 | Medium | Sci-Fi | Caucasus Mountains: 2, Copernicus Valley: 2, Space Port: 2, Apennines: 3, Dark Craters: 3, Helium 3 Mining: 3, Command Center: 4, Plato: 4, Outer Rim: 5, South Basin: 6, North Basin: 7 |
| 60 | [World Conquest](https://risk-global-domination.fandom.com/wiki/World_Conquest_Map) | 47 | 6 | Medium | Premium | Africa: 3, South America: 3, Oceania: 4, Europe: 5, North America: 5, Asia: 7 |
| 61 | [Asia 1800s](https://risk-global-domination.fandom.com/wiki/Asia_1800s_map) | 48 | 9 | Medium | Premium | Afghanistan: 2, Japan: 2, Korean Peninsula: 2, Mongolia: 3, Tibet: 3, Indochina: 4, India: 5, South East Asia: 6, China: 7 |
| 62 | [Britannia Advanced](https://risk-global-domination.fandom.com/wiki/Britannia_Advanced_Map) | 49 | 4 | Big | Empires | Cymry: 6, Pitchland: 6, Aenglaland: 7, Eriu: 8 |
| 63 | [28 Turns Later](https://risk-global-domination.fandom.com/wiki/28_Turns_Later_Map) | 50 | 10 | Big | Zombie | Southwark: 2, Whitechapel: 2, Covert Garden: 3, Hackney: 3, tower Hamlets: 3, Westminster: 3, Clerkenwell: 4, St Paul's Cathedral: 5, Mayfair: 6, Landmarks: 9 |
| 64 | [Africa Advanced](https://risk-global-domination.fandom.com/wiki/Africa_Advanced_Map) | 50 | 9 | Big | Advanced | Asia Minor: 3, East Africa: 3, Europe: 3, Southern Africa: 3, West Africa: 3, Horn of Arica: 4, Central Africa: 6, North Africa: 6, Sahara: 6 |
| 65 | [General Processing Unit](https://risk-global-domination.fandom.com/wiki/General_Processing_Unit_Map) | 50 | 11 | Big | Resistor is Futile | Interface: 2, Parallel Link: 2, Power Delivery: 2, VCore Capacitors: 3, VMem VRM: 3, Display Port: 4, PWM Plane: 4, VCore Inductors: 4, VCore MOSFETs: 4, XUltra-590 GPU: 4, VRAM Modules: 5 |
| 66 | [Japan](https://risk-global-domination.fandom.com/wiki/Japan_Map) | 50 | 9 | Big | Countries & Continents 2 | Hokkaido: 3, Ryukyu Islands: 3, Kyushu & Okinawa: 4, Shikoku: 4, Chugoku: 5, Kansai: 5, Kanto: 5, Tohuku: 5, Chubu: 8 |
| 67 | [Dracula's Castle](https://risk-global-domination.fandom.com/wiki/Dracula's_Castle_Map) | 51 | 7 | Big | Fantasy | Crypt: 5, Dracula's Lair: 5, Secret Passage: 5, Feasting Hall: 6, War rooms: 6, Midnight Sanctum: 7, Forbidden Floor: 8 |
| 68 | [Russia 2010](https://risk-global-domination.fandom.com/wiki/Russia_2010_map) | 51 | 7 | Big | Countries & Continents | Far Eastern: 4, Southern: 4, Central: 5, Northwestern: 6, Ural: 6, Volga: 6, Siberian: 7 |
| 69 | [Emergency Calls Only](https://risk-global-domination.fandom.com/wiki/Emergency_Calls_Only_Map) | 52 | 9 | Big | Resistor is Futile | Charging: 2, SIM Module: 3, Capacitor Bank: 4, Communications & Audio: 4, Radio: 4, Snake Chip: 4, Power Management: 5, Oscillation Central: 5, Signal Crossing: 5 |
| 70 | [Mira HQ](https://risk-global-domination.fandom.com/wiki/Mira_HQ_Map) | 52 | 11 | Big | Among Us | Admin: 2, Balcony: 2, Cafeteria: 2, Greenhouse: 2, Medbay: 2, Office: 2, LaunchPad: 2, Lower Hallway: 2, Decontamination: 3, Reactor: 3, Upper Hallway: 4 |
| 71 | [Operation A.D.A.M.](https://risk-global-domination.fandom.com/wiki/Operation_A.D.A.M._Map) | 52 | 13 | Big | Universal Domination | Defense Fleet Resonance: 2, Defense Fleet Tweet: 2, Zy-Lons: 2, Bismuthia: 3, Defense Fleet Landfill: 3, Galaticons: 3, Lithiupia: 3, Mercuropia: 3, Promethei Terra: 3, Sabaea: 3, Neurope: 4, Tungstania: 4, Utopia Planitia: 4 |
| 72 | [Canada](https://risk-global-domination.fandom.com/wiki/Canada_Map) | 53 | 10 | Big | Countries & Continents | Yukon: 2, Newfoundland and Labrador: 3, Alberta: 4, British Columbia: 5, Manitoba: 5, Ontario: 5, Saskatchewan: 5, Northwest Territory: 6, Nunavut: 6, Quebec: 6 |
| 73 | [Drained Great Lakes](https://risk-global-domination.fandom.com/wiki/Drained_Great_Lakes_Map) | 53 | 10 | Big | Community | Algonquin: 3, Apostle: 3, Maumee: 3, Erie: 4, Georgians Plains: 4, Huron: 4, Royale: 4, Stanley: 4, Chippewa: 5, Yooperland: 5 |
| 74 | [Crown of the Skies](https://risk-global-domination.fandom.com/wiki/Crown_of_the_Skies_Map) | 54 | 8 | Big | Community | Observatory: 2, Crown Plaza: 3, Lighthouse: 3, Artisan District: 4, Industrial Zone: 4, Docks: 6, Commercial Hub: 7, Waterworks: 7 |
| 75 | [Fort Goryokaku](https://risk-global-domination.fandom.com/wiki/Fort_Goryokaku_Map) | 54 | 11 | Big | Feudal Japan | East Point: 3, North Point: 3, West Point: 3, South East Point: 3, South West Point: 3, East Bastion: 4, Gatehouse: 4, South Bastion: 4, North East Bastion: 5, Central Bastion: 6, North West Bastion: 6 |
| 76 | [US South](https://risk-global-domination.fandom.com/wiki/US_South_Map) | 54 | 15 | Big | USA Advanced | West Virginia: 1, Georgia: 2, Kentucky: 2, South Carolina: 2, Tennessee: 2, Alabama: 3, Arkansas: 3, Florida: 3, Louisiana: 3, Mississippi: 3, North Carolina: 3, Virginia: 3, Oklahoma: 4, South Texas: 4, North Texas: 5 |
| 77 | [Orbital Objectives](https://risk-global-domination.fandom.com/wiki/Orbital_Objectives_Map) | 55 | 13 | Big | Universal Domination | Neptune: 2, Uranus: 2, Asteroids: 3, Lower Jupiter: 3, Mars: 3, Satellites and Space Stations: 3, Saturn: 3, Upper Jupiter: 3, Venus: 3, Earth: 4, Mercury: 4, Moons: 4, Sun: 7 |
| 78 | [Roots of Yggdrasil](https://risk-global-domination.fandom.com/wiki/Roots_of_Yggdrasil_Map) | 55 | 13 | Big | Viking Legends | _not documented on the wiki_ |
| 79 | [US West](https://risk-global-domination.fandom.com/wiki/US_West_Map) | 55 | 11 | Big | USA Advanced | Colorado: 3, Washington: 3, Arizona: 4, California: 4, Montana: 4, Nevada: 4, New Mexico: 4, Oregon: 4, Utah: 4, Wyoming: 4, Idaho: 5 |
| 80 | [Abandoned Crystal Mines](https://risk-global-domination.fandom.com/wiki/Abandoned_Crystal_Mines_Map) | 56 | 9 | Big | Community | Cryptic Cave: 4, Surface Access: 4, Mushroom Alcove: 5, Void  Chamber: 5, Crumbling Walkway: 6, Crystal Tunnel: 6, Old Barracks: 6, Spirit's Rest: 6, The Core: 6 |
| 81 | [Brazil Advanced](https://risk-global-domination.fandom.com/wiki/Brazil_Advanced_Map) | 56 | 8 | Big | Advanced | Sudeste: 3, Leste: 3, Centro: 4, Nordeste: 4, Sul: 7, Panama: 8, Norte: 9, Oeste: 10 |
| 82 | [Atlantis](https://risk-global-domination.fandom.com/wiki/Atlantis_Map) | 57 | 8 | Big | Lost Cities | West Gardens: 3, Market City: 4, Green City: 5, Scholar District: 5, Temple City: 5, Thera Arena: 5, Temple: 7, South Gardens: 8 |
| 83 | [Deutschland](https://risk-global-domination.fandom.com/wiki/Deutschland_Map) | 57 | 9 | Big | European | Nordrhein-Westfalen: 3, Sachsen: 4, Schleswig-Holstein: 4, Thüringen: 4, Niedersachsen: 6, Südwestdeutschland: 6, Baden-Württemberg: 8, Nordostdeutschland: 8, Bayern: 9 |
| 84 | [Ibai & Buddies](https://risk-global-domination.fandom.com/wiki/Ibai_&_Buddies_Map) | 58 | 8 | Big | — (free) | Cristinini: 4, IlloJuan: 4, Reven: 4, Ibai: 5, Werlyb: 5, Ander: 6, BarbeQ: 6, Knekro: 6 |
| 85 | [Las Vegas, Nevada](https://risk-global-domination.fandom.com/wiki/Las_Vegas,_Nevada_Map) | 58 | 10 | Big | US City | Sunrise Manor: 2, Paradise: 3, The Strip: 3, Enterprise: 4, Greater Whitney: 4, North Las Vega: 4, Lake Mead: 4, Spring valley: 4, Henderson: 7, Las Vegas: 7 |
| 86 | [Ottoman Empire Advanced](https://risk-global-domination.fandom.com/wiki/Ottoman_Empire_Advanced_Map) | 59 | 7 | Big | Advanced II | East Africa: 3, Central Africa: 4, Mauren Province: 5, Asia Minor: 6, North Africa: 6, Arabia: 7, Ottoman Europe: 7 |
| 87 | [Polus](https://risk-global-domination.fandom.com/wiki/Polus_Map) | 59 | 12 | Big | Among Us | Electrical: 1, Weapons: 1, Admin: 2, Comms: 2, DropShip: 2, Security: 2, Specimen Room: 2, Storage: 2, Lab: 3, 02: 3, Office: 4, Hallways: 8 |
| 88 | [Sietch](https://risk-global-domination.fandom.com/wiki/Sietch_Map) | 59 | 14 | Big | Dune | Communal Area: 2, Dead Gallery: 2, Fremen Camp East: 2, Fremen Camp West: 2, Living Quarters: 2, Rammallo's Den: 2, Room of The Dead: 2, Sietch Entry: 2, Cistern of Souls: 3, Council Gallery: 3, Chapel Council: 4, Resident Hall: 4, Community Loop: 5, Wide Gallery: 5 |
| 89 | [Himeji Castle](https://risk-global-domination.fandom.com/wiki/Himeji_Castle_Map) | 60 | 11 | Big | Strongholds & Castles | Koko-en Garden: 2, Koko-en: 3, Oyashiki Park: 3, Farms: 4, Himeji Castle: 4, Himeji Garden: 4, Himeji Senhime: 5, Village: 5, Himeji Castle Courts: 6, Himeji North: 6, Himeji City: 7 |
| 90 | [Central America](https://risk-global-domination.fandom.com/wiki/Central_America_Map) | 61 | 10 | Big | Premium | Central America: 3, Louisiana: 3, Old Northwest: 3, South America: 3, Caribbean Isles: 4, Northern U.S.: 4, Southern U.S.: 4, Great Plains: 5, Mexico: 5, Canada: 6 |
| 91 | [Russia 2010 Advanced](https://risk-global-domination.fandom.com/wiki/Russia_2010_Advanced_Map) | 61 | 7 | Big | Advanced | _not documented on the wiki_ |
| 92 | [Lunar Mining Facility](https://risk-global-domination.fandom.com/wiki/Lunar_Mining_Facility_Map) | 62 | 10 | Big | Sci-Fi | Drilling Plant: 3, Laboratories: 4, Launch Platforms: 4, Living Quarters: 4, Space Gate: 4, Communication Bay: 5, Storage Bay: 5, Headquarters: 6, Engineering Bay: 7, Helium-3 Processing: 7 |
| 93 | [Roman Empire Advanced](https://risk-global-domination.fandom.com/wiki/Roman_Empire_Advanced_Map) | 62 | 12 | Big | Advanced II | Celtic Tribes: 1, Provincia VII: 2, Roman-Parthian Conflict: 2, Provincia V: 3, Provincia VIII: 3, Sarmatians: 3, German Tribes: 4, Provincia I: 4, Provincia III: 4, Provincia II: 5, Provincia IV: 5, Provincia VI: 7 |
| 94 | [Conwy Castle](https://risk-global-domination.fandom.com/wiki/Conwy_Castle_Map) | 63 | 9 | Big | Strongholds & Castles | West Barbican: 2, East Barbican: 3, Common Ward: 4, Inner Ward: 4, North Wall: 5, South Wall: 5, Stalls: 5, Outer Ward: 6, Towers: 7 |
| 95 | [Turkey](https://risk-global-domination.fandom.com/wiki/Turkey_Map) | 63 | 7 | Big | Countries & Continents 2 | Marmara: 5, Souther Anatolia: 5, Aegean: 6, Mediterranean Coast: 6, Black Sea Coast: 9, Central Anatolia: 9, Eastern Anatolia: 9 |
| 96 | [Greece](https://risk-global-domination.fandom.com/wiki/Greece_Map) | 64 | 14 | Big | Countries & Continents | Dodecanese: 2, Attica: 3, Crete: 3, Cyclades: 3, Epirus: 3, Ionian Islands: 3, West Macedonia: 3, Western Greece: 3, East Macedonia & Thrace: 4, North Aegean: 4, Peloponessos: 4, Central Greece: 5, Thessaly: 5, Central Macedonia: 6 |
| 97 | [Red Sands Fort](https://risk-global-domination.fandom.com/wiki/Red_Sands_Fort_Map) | 64 | 9 | Big | Strongholds & Castles | Gun Towerr Arti: 3, Gun Tower West: 4, Maintenance: 4, Gangway: 5, Gun Tower Coast: 5, Gun Tower East: 5, Gun Tower North: 5, Gun Tower Main: 6, Center Tower: 7 |
| 98 | [US Midwest](https://risk-global-domination.fandom.com/wiki/US_Midwest_Map) | 64 | 12 | Big | USA Advanced | Ohio: 2, Indiana: 3, Illinois: 4, Kansas: 4, Michigan: 4, Minnesota: 4, Missouri: 4, Nebraska: 4, North Dakota: 4, South Dakota: 4, Wisconsin: 4, Iowa: 5 |
| 99 | [Bohus Fortress](https://risk-global-domination.fandom.com/wiki/Bohus_Fortress_Map) | 65 | 10 | Big | Northern Conquest | Gamla Magasinet: 3, Hemlig Promenad: 3, Huvudentré: 3, Neder Flatt: 4, Ofre Flatt: 4, Varselalarm: 4, Vattenhäll: 4, Kyrkohornet: 5, Skarpe Nord: 6, Bohus fästning: 8 |
| 100 | [Himeji Remastered](https://risk-global-domination.fandom.com/wiki/Himeji_Remastered_Map) | 65 | 10 | Big | Feudal Japan | Hishi Gate: 3, Ni Gate: 3, Nu Gate: 4, Ri Gate: 4, Ha Gate: 6, Moat: 6, Ro Gate: 6, Tenshu: 6, West Garden: 6, Bizen Gate: 8 |
| 101 | [Pangaea](https://risk-global-domination.fandom.com/wiki/Pangaea_Map) | 65 | 7 | Big | New World Views | Antartica: 2, Oceania: 2, North America: 5, South America: 5, Europe: 6, Asia: 9, Africa: 11 |
| 102 | [Reverse World](https://risk-global-domination.fandom.com/wiki/Reverse_World_Map) | 66 | 10 | Big | New World Views | Eastern Arctic: 3, Mediterranea: 3, West arctic: 3, Central Arctic: 4, Lower Atlantica: 4, North Pacifica: 4, Pacifica East: 5, South Pacifica: 5, Atlantica: 7, India: 7 |
| 103 | [The Younger Scrolls](https://risk-global-domination.fandom.com/wiki/The_Younger_Scrolls_Map) | 66 | 9 | Big | Fantasy | Stoneloft: 3, Darkmire: 4, Swolsnyr: 5, Symmrholm: 5, Wodnynvale: 5, Helmfylnr: 6, Windmeyer: 6, Clouds Edge: 7, Dylcirro: 8 |
| 104 | [Troy](https://risk-global-domination.fandom.com/wiki/Troy_Map) | 67 | 13 | Big | Lost Cities | Scaean Gate: 2, Temple: 2, Rich Housing: 3, Scholars: 3, South Town: 3, North Town: 4, Step Housing: 4, West Town: 4, Labour Housing: 5, Lower Town: 5, Troja: 5, City Market: 6, Upper Town: 8 |
| 105 | [River Town Advanced](https://risk-global-domination.fandom.com/wiki/River_Town_Advanced_Map) | 68 | 12 | Big | Fantasy | Court District: 2, Mayor's District: 2, North Watch: 2, Bridge: 3, Clerical Quarter: 3, East Roads: 3, West Roads: 3, Western Ruins: 3, Merchant District: 4, The Slums: 4, Fishing District: 5, General District: 5 |
| 106 | [Arkeanos](https://risk-global-domination.fandom.com/wiki/Arkeanos_Map) | 69 | 10 | Big | Limited Edition Map (only available if you grabbed it in time), no | Bicho: 4, Mercado Carbonobix: 4, Armadillo: 5, Halfoncity: 5, Isla Cangrejo: 5, Isla Tortuga: 5, Mithril: 5, Necrocity: 6, Rasitania: 6, Caminos: 7 |
| 107 | [Moscow Advanced](https://risk-global-domination.fandom.com/wiki/Moscow_Advanced_Map) | 69 | 10 | Big | Northern | -: 8 |
| 108 | [The Skeld](https://risk-global-domination.fandom.com/wiki/The_Skeld_Map) | 69 | 14 | Big | Among Us | Admin: 2, Comms: 2, Electrical: 2, Medbay: 2, Lower Engine: 2, Navigation: 2, Reactor: 2, Upper engine: 2, Shields: 2, Weapons: 2, Security: 3, Storage: 3, 02 Hallways: 3, Cafeteria: 4 |
| 109 | [Way to Valhalla](https://risk-global-domination.fandom.com/wiki/Way_to_Valhalla_Map) | 69 | 13 | Big | Viking Legends | _not documented on the wiki_ |
| 110 | [Ground Zero](https://risk-global-domination.fandom.com/wiki/Ground_Zero_Map) | 70 | 11 | Big | Zombie | Site Zero: 1, Freightside: 2, Galleries: 2, City Center: 4, Downtown: 4, Entertainment: 4, Flats: 4, Shopping: 4, The Square: 4, Eat Street: 5, Uptown: 8 |
| 111 | [Mall of the Dead](https://risk-global-domination.fandom.com/wiki/Mall_of_the_Dead_Map) | 72 | 8 | Big | Zombie | Grocers: 4, Furniture zone: 5, Entrance: 6, Music Area: 6, Clothing District: 7, Business Corner: 8, Food Court: 9, Bridge: 10 |
| 112 | [New Zealand and Australia Advanced](https://risk-global-domination.fandom.com/wiki/New_Zealand_and_Australia_Advanced_Map) | 72 | 14 | Big | Advanced II | Arnhem Land & Groote Eylandt: 2, Central Australia: 2, Far North Queensland: 2, Kimberley: 2, Gulf & North Queensland: 3, Top End & Tiwi Islands: 3, Western NSW: 3, Eastern NSW: 4, North Island: 4, South Island: 4, Victoria & Tasmania: 4, South Australia: 5, South Queensland: 5, Greater Western A... |
| 113 | [Conquest of Stockholm](https://risk-global-domination.fandom.com/wiki/Conquest_of_Stockholm_Map) | 73 | 13 | Big | Northern Conquest | Helgeands Holmen: 3, Södra Mälarens Strand: 3, Tre Kronor: 3, Norra Mälarens Strand: 4, Södra Saltsjöns Strand: 4, Grämunke Holmen: 5, Norrmalm: 5, Norra Gamla Stan: 5, Norra Saltsjöns Strand: 5, Södermalm: 5, Västra Gamla Stan: 5, Centrala Gaml: 6, Kornhamnstorg: 6 |
| 114 | [Overworld](https://risk-global-domination.fandom.com/wiki/Overworld_Map) | 74 | 6 | Big | Enchanted Realms | Trigons Maze: 4, Moonstone Forest: 5, Seagrogs Fortress: 8, Forest: 9, Mountains: 9, Desert: 10 |
| 115 | [City of the Dead](https://risk-global-domination.fandom.com/wiki/City_of_the_Dead_Map) | 75 | 14 | Big | Zombie | Docklands: 2, Brunswick: 3, Caulfield: 3, Port Melbourne: 3, Kew: 3, Williamstown: 3, Carlton North: 4, Moonee Ponds: 4, Richmond: 4, Hawthorn: 5, Altona: 6, Surrey Hills: 6, Footscray: 7, St Kilda: 7 |
| 116 | [Dead End Depot](https://risk-global-domination.fandom.com/wiki/Dead_End_Depot_Map) | 75 | 13 | Big | Zombie | Nursery: 2, Timber Yard: 2, Cafe: 3, Landscaping: 3, Car Park: 5, Cleaning: 5, Patio: 5, Power Tools: 5, Outdoors: 5, Tool Shop: 5, Road: 6, Electrical: 7, Plumbing: 8 |
| 117 | [Seagrogs Fortress](https://risk-global-domination.fandom.com/wiki/Seagrogs_Fortress_Map) | 76 | 7 | Big | Enchanted Realms | Fortress Tower: 4, Docks: 6, Old Shore: 7, Rusty Barracks: 8, Port Town: 9, Inner Market: 10, Outer Market: 11 |
| 118 | [State of Emergency](https://risk-global-domination.fandom.com/wiki/State_of_Emergency_Map) | 76 | 14 | Big | Zombie | Gippsland Outskirts: 3, Helbourne: 3, Shepparton Front: 3, Bend-i-gone: 4, Central DIElands: 4, Collapsed Corridor: 4, Fort Ballarat: 4, Great Scorched Coast: 4, Hume Horde: 4, Safe Zone: 4, The Greyline: 5, The Mallet: 5, Dead Swan Hill: 6, St KILLda: 6 |
| 119 | [Edo City](https://risk-global-domination.fandom.com/wiki/Edo_City_Map) | 77 | 10 | Big | Feudal Japan | Edo Bay: 3, Edo Castle: 4, Ushigome: 4, Nihonbashi: 5, Ichigaya: 6, Azabu: 7, Ahasaka: 8, Fukugawa: 8, Shiba: 8, Hongo: 10 |
| 120 | [United States Advanced](https://risk-global-domination.fandom.com/wiki/United_States_Advanced_Map) | 77 | 12 | Big | Advanced II | Alaska: 1, Hawaii: 1, New England: 1, Mid Atlantic: 2, Pacific South: 3, Pacific North: 4, East North Central: 6, South Atlantic: 6, West South Central: 7, Mountain North: 8, West North Central: 8, Mountain South: 9 |
| 121 | [Battle for Plancenoit](https://risk-global-domination.fandom.com/wiki/Battle_for_Plancenoit_Map) | 79 | 14 | Big | Napoleon's Battles | _not documented on the wiki_ |
| 122 | [Battle of Ligny](https://risk-global-domination.fandom.com/wiki/Battle_of_Ligny_Map) | 79 | 15 | Big | Napoleon's Battles | _not documented on the wiki_ |
| 123 | [Terraformed Venus](https://risk-global-domination.fandom.com/wiki/Terraformed_Venus_Map) | 79 | 10 | Big | Community | Alpha: 2, Aphrodite East: 4, Aphrodite South: 4, Atla: 4, Eistla: 4, Hellan Ocean: 4, Aphrodite West: 5, Ishtar: 5, Lada: 5, Phoebe: 6 |
| 124 | [Trigons Labyrinth](https://risk-global-domination.fandom.com/wiki/Trigons_Labyrinth_Map) | 80 | 10 | Big | Enchanted Realms | Void Stone: 3, Soul Stone: 4, Crystal Garden: 6, Shadow Maze: 6, Ghostly Plateau: 7, Ice Maze: 7, Madmans Maze: 7, Trigons Maze: 7, Void Halls: 8, Soul Halls: 9 |
| 125 | [Pirate's Bay](https://risk-global-domination.fandom.com/wiki/Pirate's_Bay_Map) | 83 | 11 | Big | Pirate | Haag's Bounty: 4, Lee's Landing: 5, Here be Kraken: 7, Davy Jone's Landing: 8, Siren Rocks: 8, Liberallia: 9, Governor's Graveyard: 10, The Hold: 11, The Pastures: 11, The Fort: 12, Paradise: 13 |
| 126 | [Europe Advanced](https://risk-global-domination.fandom.com/wiki/Europe_Advanced_Map) | 84 | 14 | Big | Advanced | Iceland: 2, British Empire: 3, North Africa: 3, Scandinavia: 3, Dinaric Alps: 4, South Eastern Europe: 4, South Western Europe: 4, Southern Europe: 4, Western europe: 4, Central Europe: 5, Orient: 6, West Africa: 6, Russian Empire: 7, Eastern Europe: 8 |
| 127 | [Earth 2209 A.D.](https://risk-global-domination.fandom.com/wiki/Earth_2209_A.D._Map) | 86 | 11 | Big | New World Views | North America: 4, Northern Europe: 4, Western Arctic: 4, Oceania: 5, North Africa: 6, South Africa: 6, Mainland Europe: 7, Russia: 7, South America: 7, Western Asia: 7, Eastern Asia: 9 |
| 128 | [Battle of Charleroi](https://risk-global-domination.fandom.com/wiki/Battle_of_Charleroi_Map) | 88 | 14 | Big | Napoleon's Battles | _not documented on the wiki_ |
| 129 | [Mont Saint Michel](https://risk-global-domination.fandom.com/wiki/Mont_Saint_Michel_Map) | 88 | 14 | Big | Strongholds & Castles | Abbey: 3, Residence: 3, West Wall: 3, Court Yard: 4, Hill Road: 4, North Passage: 4, Old Town: 4, North Wall: 5, Port: 6, Stores: 6, Markets: 7, Mont Saint-Michel: 7, Saint Pierre: 7, East Wall: 9 |
| 130 | [Canada Advanced](https://risk-global-domination.fandom.com/wiki/Canada_Advanced_Map) | 91 | 13 | Big | Advanced | Yukon: 3, Alaska: 4, Manitoba: 4, Saskatchewan: 4, Alberta: 5, British Columbia: 5, Greenland: 5, Newfoundland and Labrador: 5, Ontario: 6, Northwest Territory: 7, Nunavut: 8, Quebec: 8, United States: 10 |
| 131 | [Spaceport Sigma](https://risk-global-domination.fandom.com/wiki/Spaceport_Sigma_Map) | 96 | 10 | Big | Sci-Fi | Mare Nubium Station: 4, Launch Pad A: 4, Launch Pad B: 4, Launch Pad C: 4, Command Tower: 6, Expedition Command: 6, Keplers Deck: 6, Terminal A: 6, Terminal B: 6, High-bay Warehouses: 8 |
| 132 | [Battle of Waterloo](https://risk-global-domination.fandom.com/wiki/Battle_of_Waterloo_Map) | 97 | 19 | Big | Napoleon's Battles | _not documented on the wiki_ |
| 133 | [Command Base C1X](https://risk-global-domination.fandom.com/wiki/Command_Base_C1X_Map) | 100 | 11 | Big | Sci-Fi | Hangar B: 4, Hangar A: 5, Sector C: 5, Sector D: 5, Sector E: 7, Sector F: 7, Sector H: 7, Command: 8, Sector B: 8, Sector A: 10, Sector G: 10 |
| 134 | [The Airship](https://risk-global-domination.fandom.com/wiki/The_Airship_Map) | 104 | 20 | Big | Among Us | Bathrooms: 1, Exterior: 1, Fan Room: 1, Meeting Room: 1, Armoury: 2, Cockpit: 2, Comms: 2, Lounge: 2, Medical: 2, Security: 2, Vault: 2, Viewing Deck: 2, Kitchen: 3, Records: 3, Showers: 3, Electrical: 4, Gap Room: 4, Storage: 4, Engine Room: 5, Main Hall: 6 |
### Map packs

| Map pack | Maps | Territory range |
|---|---|---|
| Fantasy | 9: River Town, Castle, Enchanted Lands, Jules Verne's Mysterious Island, Lost Temple, Forsaken Lands, Dracula's Castle, The Younger Scrolls, River Town Advanced | 24–68 |
| Zombie | 8: Alcatraz, Supermax Prison, 28 Turns Later, Ground Zero, Mall of the Dead, City of the Dead, Dead End Depot, State of Emergency | 39–76 |
| Countries & Continents | 6: Brazil, Africa, Modern Spain, Russia 2010, Canada, Greece | 23–64 |
| Premium | 6: France, Classic Frozen, United States, World Conquest, Asia 1800s, Central America | 26–61 |
| Advanced | 5: Africa Advanced, Brazil Advanced, Russia 2010 Advanced, Europe Advanced, Canada Advanced | 50–91 |
| Dune | 5: Arrakeen Residence, Arrakis, The Imperium, Arrakeen, Sietch | 30–59 |
| Empires | 5: Britannia, Qing Dynasty, Ottoman Empire, Roman Empire, Britannia Advanced | 20–49 |
| Northern | 5: Iceland, Moscow, Lübeck, Arctic, Moscow Advanced | 21–69 |
| Advanced II | 4: Ottoman Empire Advanced, Roman Empire Advanced, New Zealand and Australia Advanced, United States Advanced | 59–77 |
| Among Us | 4: Mira HQ, Polus, The Skeld, The Airship | 52–104 |
| Community | 4: Drained Great Lakes, Crown of the Skies, Abandoned Crystal Mines, Terraformed Venus | 53–79 |
| Countries & Continents 2 | 4: New Zealand and Australia, Grip of the North, Japan, Turkey | 38–63 |
| Dawn of the Dinos | 4: Dino World, Stairs of Knowledge & Power, Dino Canyon, Dracon Fortress | 39–44 |
| Enchanted Realms | 4: Moonstone Forest, Overworld, Seagrogs Fortress, Trigons Labyrinth | 47–80 |
| Feudal Japan | 4: 47 Ronin, Fort Goryokaku, Himeji Remastered, Edo City | 47–77 |
| Lost Cities | 4: Machu Picchu, Nan Madol, Atlantis, Troy | 38–67 |
| Napoleon's Battles | 4: Battle for Plancenoit, Battle of Ligny, Battle of Charleroi, Battle of Waterloo | 79–97 |
| New World Views | 4: Simple World, Pangaea, Reverse World, Earth 2209 A.D. | 19–86 |
| Pirate | 4: Seaport, Blackbeard's Wrath, Skull & Crossbones, Pirate's Bay | 41–83 |
| Resistor is Futile | 4: Mother of All Boards, Command and Controller, General Processing Unit, Emergency Calls Only | 31–52 |
| Sci-Fi | 4: REDACTED, Lunar Mining Facility, Spaceport Sigma, Command Base C1X | 47–100 |
| Strongholds & Castles | 4: Himeji Castle, Conwy Castle, Red Sands Fort, Mont Saint Michel | 60–88 |
| US City | 4: New York, Los Angeles, Boston, Las Vegas, Nevada | 34–58 |
| USA Advanced | 4: US Northeast, US South, US West, US Midwest | 34–64 |
| Universal Domination | 4: Dicey Trajectories, SMG Spaceport, Operation A.D.A.M., Orbital Objectives | 39–55 |
| Viking Conquest | 4: Greenland Saga, Lindisfarne Raid, End of the King, Battle of Svolder | 35–44 |
| Viking Legends | 4: Ratatoskr and Friends, Yggdrasil, The World Tree, Roots of Yggdrasil, Way to Valhalla | 42–69 |
| European | 3: Italy, Koenigsberg, Deutschland | 36–57 |
| Northern Conquest | 2: Bohus Fortress, Conquest of Stockholm | 65–73 |
| — (free) | 2: Classic, Ibai & Buddies | 42–58 |
| European Conquest | 1: Europe | 44–44 |
| Limited Edition Map (only available if you grabbed it in time), no | 1: Arkeanos | 69–69 |
## A.2 The Classic world map — exact and verified

**Deliverable: `map-data/canonical/classic-world.json`.**

**42 territories · 6 continents · 83 undirected edges.** Bonuses: North America +5, South America +2, Europe +5, Africa +3, Asia +7, Australia +2 (total 24).

The continent bonuses agree across the RGD wiki Classic Map page and Wikipedia's Risk article, and the 42/6 split agrees with both.

### How the adjacency was verified

No single source was trusted. I found **nine** independent machine-readable adjacency lists and diffed every one of them edge by edge against the others. **Seven agree with each other exactly** — same 42 territories, same 83 undirected edges, same 6 bonus values, zero differences — and they come from different authors, languages and licences, so this is about as pinned down as a fan-sourced fact gets:

| Source | Licence | Lang | T | Edges | Agrees exactly |
|---|---|---|---:|---:|---|
| [arjanfrans/conquete](https://github.com/arjanfrans/conquete) `lib/maps/classic.js` | MIT | JS | 42 | 83 | ✅ |
| [Zach-Hayton/Conquest-Tracker](https://github.com/Zach-Hayton/Conquest-Tracker) `src/map-data.js` | MIT | JS | 42 | 83 | ✅ |
| [DouglasOrr/Preeminence](https://github.com/DouglasOrr/Preeminence) `maps/classic.json` | MIT | Python | 42 | 83 | ✅ (after name aliasing) |
| [gfceccon/risk](https://github.com/gfceccon/risk) `world.json` | **CC0** | Python | 42 | 83 | ✅ |
| [AndreasThinks/ai-at-risk](https://github.com/AndreasThinks/ai-at-risk) `src/data/territories.json` | MIT | Python | 42 | 83 | ✅ |
| [dartlangfr/risk-codelab](https://github.com/dartlangfr/risk-codelab) `map.dart` | Apache-2.0 | Dart | 42 | 83 | ✅ |
| [hcekne/risk-game](https://github.com/hcekne/risk-game) `game_constants.py` | Apache-2.0 | Python | 42 | 83 | ✅ |
| [sonesson89/TotalRisk](https://github.com/sonesson89/TotalRisk) `worldMapConfiguration.js` | Unlicense | JS | 42 | 83 | ✗ 2 errors |
| [brunoscopelliti/risk-neighborhood](https://github.com/brunoscopelliti/risk-neighborhood) `index.js` | MIT | JS | 42 | 82 | ✗ 3 errors |

All nine are internally consistent (no dangling references, every edge reciprocal), but the last two **disagree on 5 edges**. Each was adjudicated 7-to-2 and cross-checked against Wikipedia and the canonical Hasbro board:

| Disputed edge | The 7 | TotalRisk | risk-neighborhood | **Verdict** | Basis |
|---|---|---|---|---|---|
| Afghanistan–India | present | present | **missing** | **PRESENT** | 7-of-9; canonical board |
| China–Middle East | absent | absent | **present** | **ABSENT** | 7-of-9; Middle East does not reach China |
| East Africa–Middle East | present | present | **missing** | **PRESENT** | 7-of-9; Wikipedia explicitly names the East Africa–Middle East route |
| New Guinea–Western Australia | present | **missing** | present | **PRESENT** | 7-of-9; canonical board |
| Northwest Territory–Quebec | absent | **present** | absent | **ABSENT** | 7-of-9; NW Territory reaches only Alaska/Alberta/Ontario/Greenland |

Two naming traps worth knowing, since they make sources *look* like they disagree when they don't: Preeminence calls Afghanistan **"Kazakhstan"** and New Guinea **"Papua New Guinea"** (and misspells "Scandanavia"); risk-codelab misspells Yakutsk as **"yakursk"**. The alias maps are recorded in `canonical/classic-world.json` under `verification.name_aliases_needed`.

TotalRisk has 2 errors (one spurious edge, one missing); risk-neighborhood has 3 (plus a `new-guniea` typo and it renames Australia to Oceania). Every source is preserved verbatim in its own `map-data/<source>/` folder so the provenance is auditable.

### Specifically-requested link checks

| Link | Verdict |
|---|---|
| Alaska – Kamchatka | ✅ yes (the Bering crossing) |
| Greenland – Iceland | ✅ yes |
| Brazil – North Africa | ✅ yes |
| Southern Europe – Egypt | ✅ yes |
| Southern Europe – North Africa | ✅ yes |
| Western Europe – North Africa | ✅ yes |
| Siam – Indonesia | ✅ yes |
| Eastern Australia – New Guinea | ✅ **yes** (confirmed — it was worth checking) |
| Northwest Territory – Quebec | ❌ **no** (a common fan-data error) |
| Afghanistan – India | ✅ yes |
| China – Middle East | ❌ no |

There are **9 sea/cross-ocean links** in total: Alaska–Kamchatka, Greenland–Iceland, Brazil–North Africa, North Africa–Western Europe, North Africa–Southern Europe, Southern Europe–Egypt, East Africa–Middle East, Siam–Indonesia, Central America–Venezuela. (The last is a land-ish isthmus but is modelled as a single narrow link; Conquest-Tracker's own `bridges` set lists 6 of these as "bridges" and omits the three Mediterranean/isthmus ones — a presentation choice, not a rules difference.)

Graph shape, useful for AI and balance work — **7 territories have degree 6** (China, East Africa, Middle East, North Africa, Ontario, Southern Europe, Ukraine) and **4 have degree 2** (Argentina, Eastern Australia, Japan, Madagascar). Full degree distribution: 2→4 territories, 3→13, 4→13, 5→5, 6→7.

Defensibility per continent (external edges = how many border crossings you must garrison to hold the bonus):

| Continent | Bonus | Territories | External edges | Entry territories | Bonus per border |
|---|---:|---:|---:|---|---:|
| Australia | +2 | 4 | **1** | Indonesia | 2.00 |
| South America | +2 | 4 | 2 | Brazil, Venezuela | 1.00 |
| North America | +5 | 9 | 3 | Alaska, Central America, Greenland | 1.67 |
| Africa | +3 | 6 | 6 | East Africa, Egypt, North Africa | 0.50 |
| Europe | +5 | 7 | 8 | Iceland, Southern Europe, Ukraine, Western Europe | 0.63 |
| Asia | +7 | 12 | 8 | Afghanistan, Kamchatka, Middle East, Siam, Ural | 0.88 |

This reproduces the well-known balance of the board: Australia is the turtle (one chokepoint for +2), North America is the best value for a real push (+5 behind 3 borders), and Africa is the trap (+3 behind 6 borders).

### Full territory list and adjacency


**North America — bonus +5, 9 territories**

| Territory | Borders |
|---|---|
| Alaska | Alberta, Kamchatka, Northwest Territory |
| Alberta | Alaska, Northwest Territory, Ontario, Western United States |
| Central America | Eastern United States, Venezuela, Western United States |
| Eastern United States | Central America, Ontario, Quebec, Western United States |
| Greenland | Iceland, Northwest Territory, Ontario, Quebec |
| Northwest Territory | Alaska, Alberta, Greenland, Ontario |
| Ontario | Alberta, Eastern United States, Greenland, Northwest Territory, Quebec, Western United States |
| Quebec | Eastern United States, Greenland, Ontario |
| Western United States | Alberta, Central America, Eastern United States, Ontario |

**South America — bonus +2, 4 territories**

| Territory | Borders |
|---|---|
| Argentina | Brazil, Peru |
| Brazil | Argentina, North Africa, Peru, Venezuela |
| Peru | Argentina, Brazil, Venezuela |
| Venezuela | Brazil, Central America, Peru |

**Europe — bonus +5, 7 territories**

| Territory | Borders |
|---|---|
| Great Britain | Iceland, Northern Europe, Scandinavia, Western Europe |
| Iceland | Great Britain, Greenland, Scandinavia |
| Northern Europe | Great Britain, Scandinavia, Southern Europe, Ukraine, Western Europe |
| Scandinavia | Great Britain, Iceland, Northern Europe, Ukraine |
| Southern Europe | Egypt, Middle East, North Africa, Northern Europe, Ukraine, Western Europe |
| Ukraine | Afghanistan, Middle East, Northern Europe, Scandinavia, Southern Europe, Ural |
| Western Europe | Great Britain, North Africa, Northern Europe, Southern Europe |

**Africa — bonus +3, 6 territories**

| Territory | Borders |
|---|---|
| Congo | East Africa, North Africa, South Africa |
| East Africa | Congo, Egypt, Madagascar, Middle East, North Africa, South Africa |
| Egypt | East Africa, Middle East, North Africa, Southern Europe |
| Madagascar | East Africa, South Africa |
| North Africa | Brazil, Congo, East Africa, Egypt, Southern Europe, Western Europe |
| South Africa | Congo, East Africa, Madagascar |

**Asia — bonus +7, 12 territories**

| Territory | Borders |
|---|---|
| Afghanistan | China, India, Middle East, Ukraine, Ural |
| China | Afghanistan, India, Mongolia, Siam, Siberia, Ural |
| India | Afghanistan, China, Middle East, Siam |
| Irkutsk | Kamchatka, Mongolia, Siberia, Yakutsk |
| Japan | Kamchatka, Mongolia |
| Kamchatka | Alaska, Irkutsk, Japan, Mongolia, Yakutsk |
| Middle East | Afghanistan, East Africa, Egypt, India, Southern Europe, Ukraine |
| Mongolia | China, Irkutsk, Japan, Kamchatka, Siberia |
| Siam | China, India, Indonesia |
| Siberia | China, Irkutsk, Mongolia, Ural, Yakutsk |
| Ural | Afghanistan, China, Siberia, Ukraine |
| Yakutsk | Irkutsk, Kamchatka, Siberia |

**Australia — bonus +2, 4 territories**

| Territory | Borders |
|---|---|
| Eastern Australia | New Guinea, Western Australia |
| Indonesia | New Guinea, Siam, Western Australia |
| New Guinea | Eastern Australia, Indonesia, Western Australia |
| Western Australia | Eastern Australia, Indonesia, New Guinea |
## A.3 Machine-readable map data extracted

**The honest finding first: adjacency for the SMG maps is not publicly documented anywhere.** I checked the Fandom wiki (every one of the 138 pages — the infoboxes carry counts and bonuses but never a border list), the Steam DLC pages, the SMG support site, and fan strategy content. Map *layouts* exist only as flat PNG screenshots on the wiki (`[[File:<Map> Map.png]]`), which are copyrighted SMG artwork and carry no machine-readable geometry. So for **133 of the 134 SMG maps** (everything except Classic), the only route to adjacency is to rebuild the map yourself (see the Recommendation).

What I did get, with full geometry, is below. "Confidence" is about the data being correct and complete, not about it matching SMG's version of that map.

| Map | T | C | Edges | Geometry | Licence | Confidence | File |
|---|---:|---:|---:|---|---|---|---|
| **Classic world** | 42 | 6 | 83 | **per-territory SVG paths ×2** | Unlicense / Apache-2.0 (geometry); MIT & CC0 (graph) | **HIGHEST** — 7 independent sources agree exactly | `canonical/classic-world.json` + `totalrisk/worldMap.svg` or `risk-codelab/board.svg` |
| **World Extended** | 47 | 6 | 94 | per-territory SVG paths | Unlicense | **MEDIUM** — one asymmetric edge (Kamchatka→Hawaii) repaired. TotalRisk original, not an SMG map. | `totalrisk/world-extended.json` + `worldMapExtended.svg` |
| **Napoleonic Europe** | 59 | 11 | 127 | per-territory SVG paths | Unlicense | **MEDIUM-HIGH** — fully symmetric, no repairs needed. TotalRisk original. | `totalrisk/napoleonic-europe.json` + `napoleonMap.svg` |
| **Middle Earth** | 38 | 8 | 54 | ❌ none | MIT | **MEDIUM-HIGH** — fully symmetric, no dangling refs. ⚠️ Tolkien place-names are Tolkien Estate IP — rename before shipping. | `preeminence/middle-earth.json` |
| **Quad** | 20 | 4 | 26 | ❌ none | MIT | **HIGH** — clean small board, good for fast games | `preeminence/quad.json` |
| **Mini** | 6 | 2 | 7 | ❌ none | MIT | **HIGH** — test board | `preeminence/mini.json` |
| **Tiny3 / Tiny4** | 3 / 4 | 1 | 3 / 6 | ❌ none | MIT | **HIGH** — toy boards, useful as engine unit-test fixtures | `preeminence/tiny3.json`, `tiny4.json` |
| Classic (5 more copies) | 42 | 6 | 83 | varies | MIT / CC0 / Apache-2.0 | **HIGH** graph — all exact matches, kept for provenance | `conquete/`, `conquest-tracker/`, `preeminence/classic.json`, `gfceccon/`, `risk-codelab/` |
| Classic (bad copy) | 42 | — | 82 | none | MIT | **reference only** — 3 known errors, do not ship | `risk-neighborhood/classic-world.json` |

**So: 7 distinct playable boards with verified graphs, 3 of them with real per-territory geometry.** Every one of the 9 graphs was integrity-checked (symmetry + dangling references); only the two known-bad ones failed anything.

**Geometry verification.** I did not take the SVGs on trust. For each of the three TotalRisk maps I parsed the SVG and checked every territory name in the JSON against the SVG's `id` attributes:

- Classic world: **42/42** territories have a `<path>` with real `d=` geometry.
- World Extended: **47/47**.
- Napoleonic Europe: **59/59**.
- All 6 / 6 / 11 continent group ids are present too.

Two gotchas for whoever writes the loader:
1. Attribute order is `d=` **before** `id=`, so a naive `id="X"[^>]*d=` regex finds nothing. Match on the element, not the attribute order.
2. Territory names containing `&` appear HTML-escaped in the id (`id="Aragon &amp; Castile"`). Decode entities before matching, or 8 of Napoleonic Europe's 59 territories silently fail to bind.

The 134-map catalogue itself is in `smg-catalogue/all-maps.json` — **HIGH confidence** for counts/packs/bonuses (132/134 double-verified), **no adjacency or geometry**.


---

# Part B — fan-created / open-source code

## B.4 Open-source Risk implementations

**Method.** GitHub repo search is close to useless for this ("risk" is dominated by financial-risk and Risk-of-Rain repos). What worked was **code search for classic territory names** — `gh api 'search/code?q=Kamchatka+Ural+Afghanistan+language:javascript'` and similar surface the repos that actually contain map data, regardless of how they're described. That's the technique to reuse if this needs extending.

### Reusable (permissive licence — safe to copy or adapt)

| Repo | ★ | Licence | Lang | What's reusable | Geometry approach |
|---|---:|---|---|---|---|
| **[sonesson89/TotalRisk](https://github.com/sonesson89/TotalRisk)** | 18 | **Unlicense** (public domain) | JS / Angular | ⭐ **The single best find.** 3 complete maps (42, 47, 59 territories) each with region bonuses, full adjacency, region colours, **and a production-quality SVG**. Plus a working engine: `mapService.js`, troop-movement arrows (`mapArrow.js`), reinforcement maths, card redemption, an AI, sound. Actively maintained (last push 2026-09-22). | **Per-territory SVG `<path id="Territory Name">` grouped in `<g id="Continent">`.** Exactly the model to adopt. Separate decorative `<g id="Seas">`. |
| **[arjanfrans/conquete](https://github.com/arjanfrans/conquete)** | 6 | **MIT** | JS (Node) | Clean, headless **rules engine** — the best-structured rules code found. `lib/Board.js`, `Territory.js`, `Continent.js`, `CardManager.js`, `Battle.js`, `phases/`, `state-builder.js`, plus an `ai/`. Classic map data in `lib/maps/classic.js` (verified exact). Event-driven API, has a functional test suite. | **None** — pure graph, no coordinates. Pair it with TotalRisk's SVG. |
| **[Zach-Hayton/Conquest-Tracker](https://github.com/Zach-Hayton/Conquest-Tracker)** | 0 | **MIT** | JS | The **canonical 42-territory graph** (verified exact), continent bonuses, per-territory `x,y` label points, an explicit `bridges` set for sea links, `validateAdjacency()`, plus `probability.js` and `strategy.js` (attack-odds / strategy heuristics). Tiny (74 KB) and easy to read. | **Per-continent blob `<path>` + per-territory `x,y` point.** Schematic only — good for troop markers, not real outlines. |
| **[brunoscopelliti/risk-neighborhood](https://github.com/brunoscopelliti/risk-neighborhood)** | 2 | **MIT** | JS | Adjacency only. **Has 3 verified errors** — kept purely as a cross-check source. Don't ship it. | None. |
| **[dartlangfr/risk-codelab](https://github.com/dartlangfr/risk-codelab)** | 10 | **Apache-2.0** | Dart | **A second permissive per-territory classic SVG** (`samples/s3_game/web/img/board.svg`, 800×540, 42 semantic ids) + `map.dart` adjacency (verified exact) + a turn/attack/fortify engine. The only other permissively-licensed real vector Risk board found. | **Per-territory SVG `<path id="snake_case">`.** Inkscape-authored with gradients/filters. |
| **[DouglasOrr/Preeminence](https://github.com/DouglasOrr/Preeminence)** | 0 | **MIT** | Python | **6 maps**: classic (verified exact), **middle_earth (38 territories)**, quad (20), mini (6), tiny3, tiny4. Compact `[name, continent, [neighbours]]` format. The only permissive source with *more than one* real board. | **None** — graph only, no coordinates. |
| **[gfceccon/risk](https://github.com/gfceccon/risk)** | 0 | **CC0-1.0** | Python | Classic graph (verified exact). **CC0 = public-domain dedication, no attribution required** — the cleanest-licensed copy of the classic graph. | None. |
| **[AndreasThinks/ai-at-risk](https://github.com/AndreasThinks/ai-at-risk)** | 1 | **MIT** | Python | Classic graph (verified exact) as `{continent, adjacent[]}`. Also an LLM-driven AI harness worth skimming. | None. |
| **[hcekne/risk-game](https://github.com/hcekne/risk-game)** | 10 | **Apache-2.0** | Python / Jupyter | Classic graph (verified exact) as `TERRITORIES` + `TERRITORY_CONNECTIONS`. Notebooks on strategy/RL. | None. |
| **[kbennett2000/lan-games](https://github.com/kbennett2000/lan-games)** | 16 | **MIT** | JS | Self-hosted LAN platform with 8 turn-based board games incl. Risk — `server/games/risk/config/board.json`, `cards.json`, `settings.json`. Useful as a **multiplayer-server reference**. | None. |
| **[nullobject/risk](https://github.com/nullobject/risk)** | 103 | **MIT** | JS | Most-starred Risk repo on GitHub. Not the classic board — it **procedurally generates** boards: hexgrid → **Voronoi tessellation** → merge cells into countries → derive the adjacency graph (`voronoi.js`, `geom/`, `World.js`, `Graph.js`). Also a decent `ai.js` and `reinforcement.js`. | **Procedurally generated polygons.** A genuine third option: infinite maps, zero licensing risk, but no real-world geography. |
| **[CollegeFootballRisk/Risk](https://github.com/CollegeFootballRisk/Risk)** | 8 | **MPL-2.0** (weak copyleft — file-level) | Rust | A real, production multiplayer Risk server (massively-multiplayer territory war). Useful for **server/API architecture** and turn resolution at scale. MPL means modified *files* must stay MPL; you can link to it from proprietary code, so it's usable but it's a server, not map data. | n/a |

> **⚠️ Licence-laundering caveat.** A permissive LICENSE file cannot grant rights the uploader never held. Two repos ship a `.map` whose own header reads `author=Sean O'Connor` (the format from Sean O'Connor's shareware *Conquest*) under an MIT licence, and another ships Domination's bundled maps verbatim under MIT. In those cases the MIT grant covers only the repo's *code* — treat the bundled map data as unlicensed. Check the data's own provenance, not just the repo's LICENSE.

### Read-for-ideas only (GPL / no licence / proprietary)

Per the brief: these may be **read** for approach but **nothing may be copied**.

| Repo / project | Licence status | Why it's interesting | Constraint |
|---|---|---|---|
| **[Soularflare/RiskOnline](https://github.com/Soularflare/RiskOnline)** | **No LICENSE file** → all rights reserved by default | `gameboard/src/MapSVG.js` — a React SVG Risk board; worth reading for how it binds click handlers per territory path | ❌ Cannot copy. No licence = no permission. |
| **[AlexWilton/Risk-World-Domination-Game](https://github.com/AlexWilton/Risk-World-Domination-Game)** | **No LICENSE** | `web_client/js/risk/gameData.js`; full Java multiplayer + AI | ❌ Cannot copy |
| **[tlmader/risk](https://github.com/tlmader/risk)** | **No LICENSE** | `continents.txt` / `countries.txt` — plain-text map data | ❌ Cannot copy |
| **[rzencoder/risk](https://github.com/rzencoder/risk)**, **[AbsentMoniker/RISK](https://github.com/AbsentMoniker/RISK)** | **No LICENSE** | JS/HTML Risk boards | ❌ Cannot copy |
| **[LeonardoVal/ludorum-risky.js](https://github.com/LeonardoVal/ludorum-risky.js)** | `NOASSERTION` (unclear) | `src/maps/map-classic.js`; game-theory framework with Risk map support, MCTS-style AI | ⚠️ Licence unclear — treat as unusable until clarified |
| **[krajzeg/compact-conflict](https://github.com/krajzeg/compact-conflict)** | `NOASSERTION` | JS13k Risk-like in ~13 KB; extremely instructive for compact procedural map generation and minimal AI | ⚠️ Read only |
| **[diegomachadosoares/War](https://github.com/diegomachadosoares/War)** | **GPL-3.0** | `vizinhos.txt` (Portuguese for "neighbours") — adjacency data | ❌ **GPL: read for ideas, do not copy.** Copying would force the whole replica to GPL. |
| **[PukkaVXR/MapGenie](https://github.com/PukkaVXR/MapGenie)** | **No LICENSE** | **The biggest adjacency haul anywhere — ~120 map graphs** in `public/Index Data/*.json` whose names mirror SMG's catalogue almost exactly (classic, classicAdvanced, europe/europeAdvanced, usa + 4 US regions, asia, africa, canada, russia, japan, greece, turkey, spain, germany, france, brazil, nzaus, scandinavia, iceland, romanEmpire, ottomanEmpire, pangea, solarSystem, 5 Among Us maps, 5 Dune maps…). No coordinates or geometry at all. | ❌ **Cannot use.** No licence, and the names make it near-certain the graphs were transcribed from RISK: Global Domination itself. The closest thing to "adjacency for the SMG maps" that exists — and it's unusable. |
| **[go-risk-it/go-risk-it-frontend](https://github.com/go-risk-it/go-risk-it-frontend)** | **No LICENSE** | `src/assets/risk.json` — **the cleanest data model found**: `{id, name, viewBox, continents:[{id,name,bonus_troops}], layers:[{id,name,continent,d:"M…"}]}` with the SVG path inline per territory | ⚠️ **Copy the schema idea, not the file.** Recommended as the shape for our own format (see Recommendation Tier 2). |
| **[termorrell/WorldDomination](https://github.com/termorrell/WorldDomination)** | **No LICENSE** | `war/xml/risk-paths-complete.svg` + per-territory SVGs in `war/img/territories/` — genuinely good vector geometry | ❌ Cannot copy |
| **Lux Delux** ([maps](https://sillysoft.net/lux/maps/), [.luxb spec](https://sillysoft.net/lux/maps/mapspec.php)) | Proprietary; [terms](https://sillysoft.net/terms.php) forbid copying materials | 1000+ community maps. **Technically the nicest format**: XML with `<polygon>` vector coordinate lists and `<adjoining>` ids, multiple polygons per country for non-contiguous territories. | ❌ **Not reusable** — and there are no direct download URLs; maps ship inside the paid app. Best *format* reference. |
| **Warzone / War.app** ([Map Making](https://war.app/wiki/Map_Making)) | No licence statement; maps user-copyrighted | SVG-based: authors upload an SVG then enter connections/bonuses via the UI. Large community library. | ❌ **Not reusable.** The API has no read/export endpoint for territories, connections or SVGs — only a *write* endpoint for map authors. |
| **[TripleA maps](https://github.com/triplea-maps)** | **342 of 343 repos have NO licence** (1 is GPL-3.0); [issue #7021](https://github.com/triplea-game/triplea/issues/7021) documents the gap | 343 maps, each with `map/polygons.txt` (per-territory polygon point lists), `centers.txt` (label points) and `games/*.xml` (connections). `triplea-maps/domination` is the Risk-style one. | ❌ **Read for ideas only.** The `polygons.txt` + `centers.txt` two-file split is a good pattern worth imitating. |
| **Domination / "yura.net"** ([SourceForge](https://sourceforge.net/projects/domination/)) | Engine **GPL** | The longest-running open Risk clone. Documented plain-text `.map` format with `[continents]` / `[countries]` (incl. x,y) / `[borders]` sections, a bundled map editor, and a large community map library. | ❌ **GPL engine: read for ideas, do not copy.** The map *format* is a specification (fine to implement); individual community maps are third-party works with their own unclear rights. Geometry is a **colour-keyed raster GIF**, which is the weakest of the three approaches anyway. |

**Note on name/IP risk, which applies to all of the above:** "RISK" is a Hasbro trademark and the 42-territory board art is Hasbro's. The *adjacency graph and territory names are facts* and not copyrightable; the *artwork and the trademark* are. Safe posture: reuse graphs freely, reuse only permissively-licensed geometry, don't call the product "Risk", and don't reproduce Hasbro's board art.

## B.5 Risk-style world SVGs and public-domain country outlines

### The Wikimedia "Risk map" — found, and it is a trap

The brief assumed there's "a well-known public-domain Risk game map SVG on Wikimedia". **There is a well-known one, but it is not safely reusable.** `Category:Risk (game)` is empty; the real categories are `Category:Risk (board game)` and `Category:Risk board diagrams` (18 files). Full audit:

| File | Licence | Geometry | Verdict |
|---|---|---|---|
| [Risk_board.svg](https://commons.wikimedia.org/wiki/File:Risk_board.svg) | CC BY-SA 3.0 / GFDL | 147 paths, **per-territory `id=`** (`afghanistan`, `east_africa`…), Inkscape layers incl. `flightpaths` | ❌ **Do not ship.** Source field says verbatim *"Own work by uploader — based on a Risk board i own."* The uploader cannot license Hasbro's board art. Plus viral ShareAlike. |
| [Risk_game_board.svg](https://commons.wikimedia.org/wiki/File:Risk_game_board.svg) | CC BY-SA 4.0 | 45 paths, per-territory `id=` for all 42 | ❌ **Do not ship.** 2nd-generation derivative of the above, so it inherits the same defect. |
| [Risk_game_graph.svg](https://commons.wikimedia.org/wiki/File:Risk_game_graph.svg) | CC BY-SA 4.0 | The cleanest published **adjacency graph** (asterisks mark links absent from the 40th-Anniversary edition) | ✅ **Best legitimate use:** read the adjacency off it, encode it in your own data file, don't ship the SVG. A graph is a fact. (I used it as a sanity check on the 4-way result; it agrees.) |
| [Risk_schematic.svg](https://commons.wikimedia.org/wiki/File:Risk_schematic.svg) | CC BY-SA 4.0, `{{own}}` | Abstract rounded blocks, non-geographic | ⚠️ Lowest Hasbro exposure (not a trace) but needs attribution **and** ShareAlike on your map asset. |
| `Risk_game_map*.png`, `Risk_Game_Map_2004_Edition.png`, `Spillebræt_til_Risk.png`, `Riskgame2.png` | CC BY-SA 3.0 | Raster board reproductions | ❌ Hasbro derivatives, and raster — no addressable geometry anyway. |
| `Risk_2210_AD_*`, `Risk_Godstorm_*`, `Castle_Risk_schematic_map.svg` | CC BY-SA 4.0 | Variant-edition schematics (Castle Risk = Europe-only, 4 empires) | ⚠️ ShareAlike + Hasbro variant IP. Reference only. |
| [Planisfero a scacchiera di Lamorisse.png](https://commons.wikimedia.org/wiki/File:Planisfero_a_scacchiera_di_Lamorisse.png) | CC BY-SA 4.0 | Reconstruction of Lamorisse's original **65-cell planisphere** from *La Conquête du Monde* (1957), i.e. **pre-Hasbro** | ⚠️ ShareAlike, but historically the most interesting — the ancestor board, before Hasbro's expression existed. |

There is **no** German "Risiko Weltkarte" board on Commons.

### Public-domain geometry that *is* safe — the real answer

| Source | Licence | Format | Geometry | Verdict |
|---|---|---|---|---|
| **[Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/)** ([repo](https://github.com/nvkelso/natural-earth-vector/blob/master/LICENSE.md)) | **Public domain** (≈ CC0). Verbatim: *"Everything here is public domain… No permission is needed to use Natural Earth. Crediting the authors is unnecessary."* | Shapefile + GeoJSON | `ne_110m_admin_0_countries`: **177 country polygons** with `ADMIN`, `ISO_A3`, **`CONTINENT`**, `SUBREGION` properties — you can group countries into Risk continents from the data itself. `ne_50m_admin_1_states_provinces`: 294 admin-1 units but **only 9 countries** (RU 85, US 51, IN 36, ID 33, CN 31, BR 27, CA 13, AU 9, ZA 9) — use `10m` for worldwide admin-1. | ✅ **The gold standard. Safe commercially, no attribution required.** |
| **[topojson/world-atlas](https://github.com/topojson/world-atlas)** | **ISC** (permissive, non-copyleft); underlying data is Natural Earth 4.1.0 = PD | TopoJSON | `countries-{110m,50m,10m}.json`; 110m = 177 countries + land, only **108 KB**. `id` = ISO numeric, `properties.name` = country name. Unprojected spherical degrees. | ✅ **Safe.** Just keep the LICENSE text next to the file. Best size/quality trade-off for the web. |
| **[topojson/us-atlas](https://github.com/topojson/us-atlas)** | **ISC**; underlying US Census data is a US federal work (17 U.S.C. §105) ⇒ effectively PD | TopoJSON | `states-10m.json` = 56 states/territories + nation; also counties, and **pre-projected** `*-albers-10m.json` (975×610 viewport) — drop-in for a USA map | ✅ **Safe.** This is how to build the USA maps. |
| **[File:BlankMap-World.svg](https://commons.wikimedia.org/wiki/File:BlankMap-World.svg)** | **Public domain**, `attribution_required=false` | SVG | ⭐ 2,213 `<path>` with **per-country ISO 3166-1 alpha-2 `id=`** (`id="fr"`, `id="br"`) and semantic classes (`class="landxx coastxx aq"`). Deliberately hand-editable, not Inkscape-mangled. | ✅ **Safe, no attribution.** The fastest path: no projection work needed, merge paths by `id`. Caveat: it's a drawn map, so you can't reproject it; disputed-territory codes (`xk`, `eh`, Crimea) need an explicit decision. |
| [File:BlankMap-Africa.svg](https://commons.wikimedia.org/wiki/File:BlankMap-Africa.svg) | **Public domain** | SVG | 111 paths, ISO-coded | ✅ Safe — ready-made Africa base |
| [File:Europe_blank_map.svg](https://commons.wikimedia.org/wiki/File:Europe_blank_map.svg) | **Public domain** | SVG | Only 4 paths, generic Inkscape ids | ⚠️ Licence-safe but **not addressable** — backdrop only |
| `BlankMap-Eurasia.svg` | PD tag, but credited as cropped from a CC BY-SA sibling | SVG | 1 path for the whole landmass | ⚠️ Tag inconsistency + unusable. Crop from Natural Earth instead. |
| **simplemaps.com SVG maps** | ⚠️ **Bespoke terms, not MIT** (third-party claims of MIT are wrong). Commercial use OK, attribution optional, **but** *"You may not make our SVG maps 'as is' available for distribution elsewhere."* | SVG | Per-country paths | ⚠️ Usable but the redistribution clause makes Natural Earth / BlankMap-World the lower-risk choice. |
| **amCharts geodata** | ❌ **Linkware.** Free tier forbids removing the branding link and forbids distributing the data on its own. | GeoJSON/JS | — | ❌ **Not usable** without a paid licence. |
| **github.com/djaiss/mapsicon** | ❌ No LICENSE file; README says *"mention me… Please don't resell them — I forbid it!"* | PNG/SVG icons | per-country *icons*, not an addressable map | ❌ **Not usable**; also abandoned. |

Note: `BlankMap-Asia.svg`, `BlankMap-NorthAmerica.svg`, `BlankMap-USA-states.svg` and similar **do not exist** on Commons under those names — most Europe/Asia regional blank maps there are CC BY-SA, not PD. For those regions, generate from Natural Earth.

**Download gotcha worth recording:** the legacy `naturalearthdata.com/http//www.naturalearthdata.com/download/...` URLs that are still all over the web now return **HTTP 406**. Use `https://naciscdn.org/naturalearth/...` or the GitHub raw GeoJSON paths.

## B.6 Territory-geometry approaches, with file paths

Four distinct approaches showed up. This is the decision the build has to make:

| # | Approach | Exemplar (file path) | Pros | Cons |
|---|---|---|---|---|
| 1 | **Per-territory SVG `<path>`, hand-authored, id = territory name** | `map-data/totalrisk/worldMap.svg` (and `worldMapExtended.svg`, `napoleonMap.svg`); engine in `map-data/totalrisk/_engine_mapService.js` | Pixel-perfect artistic control; trivial hit-testing and per-territory fill/hover; resolution-independent; tiny code. **This is what the real game effectively does.** | Someone must draw each map. ~140 KB per world map. |
| 2 | **Generated polygons from geodata** (dissolve country/admin-1 polygons into territories) | `map-data/naturalearth/ne_110m_admin_0_countries.geojson`, `map-data/topojson-atlas/world-atlas-countries-110m.json`, `us-atlas-states-10m.json` | Unlimited legitimate maps for any region; real geography; adjacency can be **derived** from shared polygon borders instead of hand-typed | Needs a build step (`topojson-client` `merge`, or `mapshaper`); coastline detail needs simplification tuning; sea links must still be added by hand |
| 3 | **Per-country SVG paths keyed by ISO code, merged into territories** | `map-data/wikimedia/BlankMap-World.svg` (PD, 2,213 paths, `id="fr"`) | No projection maths, no GIS toolchain — just group `<path>`s by id; PD with no attribution | Fixed projection, can't reproject; disputed-territory codes need decisions; 1.1 MB raw |
| 4 | **Procedural generation** (hexgrid → Voronoi → merge cells) | `nullobject/risk` `src/voronoi.js`, `src/geom/`, `src/World.js` (MIT) | Infinite maps, zero IP risk, adjacency falls out of the tessellation for free | Not real geography — can't give you "Europe Advanced" |
| — | *(rejected)* **Colour-keyed raster** | Domination's `board_map.gif` + `.map` file | Simple to author with a paint program | No scaling, no crisp hover, no vector styling; GPL engine. Don't. |

A fifth thing seen but not an approach in its own right: **continent-blob + label-point** (`map-data/conquest-tracker/classic-world.json`) — 6 crude continent shapes plus an `x,y` per territory. Not viable as map geometry, but the `x,y` label points are directly useful for placing troop-count markers over any of the above.


---

# Recommendation: how to get 10+ maps into the replica with legitimate geometry

## What we actually have, and the one real gap

| | Status |
|---|---|
| Classic 42-territory graph | ✅ **Nailed down.** 7 independent sources agree exactly. |
| Classic geometry | ✅ **Two** permissive per-territory SVGs (Unlicense + Apache-2.0). |
| 2 more maps with full geometry | ✅ World Extended (47), Napoleonic Europe (59) — Unlicense. |
| 4 more maps, graph only | ✅ Middle Earth (38), Quad (20), Mini (6), Tiny3/4 — MIT. |
| The other 131 SMG maps | ❌ **No adjacency and no geometry exists publicly.** Only flat PNG screenshots of SMG's own artwork. |
| Public-domain geometry to build new maps | ✅ Natural Earth (PD), world-atlas/us-atlas (ISC), BlankMap-World.svg (PD). |

**The gap is geometry for non-classic regional maps.** Nothing permissively licensed exists for Europe/USA/Asia regional boards. Everything that does exist — Lux Delux (1000+ maps, nice vector polygons), Warzone (SVG-based, big community library), TripleA (343 map repos with beautiful `polygons.txt`), Domination (107 maps), MapGenie (~120 adjacency graphs that mirror SMG's catalogue exactly) — is **unlicensed, proprietary, or copyleft**. None of it can be shipped. That is a firm finding, not a gap in the search: I checked licences on all of them individually.

## Recommended plan — a 4-tier ladder to 12+ maps

**Tier 1 — ship immediately (3 maps, zero work, real geometry).**
Take `canonical/classic-world.json` + `totalrisk/worldMap.svg`, plus World Extended and Napoleonic Europe as-is. All Unlicense/Apache-2.0. This alone gets a playable product with 3 maps and proves the renderer.

**Tier 2 — the schema + loader (no new maps, but unblocks everything).**
Adopt **one** map format and write a single loader. Recommended shape (this is `go-risk-it`'s design, which is the cleanest I saw — re-implement it, don't copy it, as that repo has no licence):

```
{ "slug", "name", "viewBox": "0 8 1024 643",
  "continents": [ { "id", "name", "bonus", "color", "territories": [ids] } ],
  "territories": [ { "id", "name", "continent", "adjacent": [ids], "labelX", "labelY", "d": "M…" } ] }
```

Keep the SVG path `d` **in the JSON** rather than in a separate SVG file — one fetch per map, and the renderer never has to reconcile two sources of truth. Add a build-time validator that enforces: adjacency symmetry, no dangling refs, every territory has a `d`, every continent's territory list matches. All 9 sources I examined would have caught their own bugs with that validator; TotalRisk and risk-neighborhood shipped theirs because nobody ran one.

**Tier 3 — generate 6–8 regional maps from public-domain geodata (the main work).**
This is how to get to 10+ **legitimately**. Pipeline:

1. Start from `naturalearth/ne_110m_admin_0_countries.geojson` (PD, 177 countries, has `CONTINENT`/`SUBREGION` properties) for world-scale maps, and `ne_50m_admin_1_states_provinces.geojson` / `topojson-atlas/us-atlas-states-10m.json` for sub-national ones.
2. Group polygons into territories and **dissolve** with `mapshaper` or `topojson-client`'s `merge`.
3. **Derive adjacency topologically** from shared polygon edges — don't hand-type it. Cross-check the country-level result against `country-borders/GEODATASOURCE-COUNTRY-BORDERS.CSV` (728 pairs; CC BY-SA 4.0, so attribute it or use it only as a test oracle, which avoids the ShareAlike question entirely).
4. Add sea links by hand — they're the one thing geometry can't tell you (there are only 9 in the classic map, so this is minutes of work per map).
5. Project to a flat `viewBox` and simplify to ~2–5% for web weight; emit the Tier-2 schema.

Realistic targets, all buildable this way: **Europe**, **USA (states)**, **Asia**, **Africa**, **South America**, **Canada (provinces)**, **Australia/NZ**, **World Simple (~19–24 territories)**. Tune territory counts to match the SMG catalogue's numbers (`smg-catalogue/all-maps.json`) so the maps *feel* like the originals without copying them. Use the catalogue's bonus values as a **balance reference** — bonus-per-border-crossing from the A.2 table is the metric to match.

**Tier 4 — procedural maps for infinite variety (cheap bonus).**
Port the `nullobject/risk` (MIT) approach: hexgrid → Voronoi tessellation → merge cells into territories → adjacency falls out of the tessellation for free. Zero IP risk, zero authoring, and it gives "random map" as a game mode. Not a substitute for real geography, but it's a few hundred lines for unlimited boards.

**Total: 3 + 8 + 1 random generator = 12 maps, all with defensible provenance.**

## Also worth building, since it's nearly free

- **Blizzards and Portals as engine modifiers, not map data.** Both are global toggles in the real game; each map just declares a count (blizzards 2–11, portals 3–7, scaling with size). One blizzard system (mark territory impassable; *still counts toward the region bonus*) and one portal system (inject dynamic edges; Stable = fixed, Unstable = relocates every few turns with a one-turn inactive window) covers all 134 maps. This is the highest-leverage feature in the whole catalogue — it multiplies every map you have.
- **Rules engine**: read `arjanfrans/conquete` (MIT) — `lib/Board.js`, `phases/`, `CardManager.js`, `Battle.js`, `state-builder.js`. Best-structured open Risk rules code found, and it's MIT so it can be adapted directly.
- **Attack odds / strategy**: `Conquest-Tracker`'s `probability.js` and `strategy.js` (MIT).
- **Troop markers**: `conquest-tracker/classic-world.json` has per-territory `x,y` label points for the classic map; for generated maps use each polygon's centroid (or pole of inaccessibility for concave shapes, so the marker lands inside Norway rather than in the sea).

## Legal posture — the short version

- **Facts are free.** Territory names, adjacency graphs, territory counts and bonus values are facts about a published game and are not copyrightable. Reuse them.
- **Artwork is not.** Never ship SMG's map PNGs, and never ship the Wikimedia `Risk_board.svg` / `Risk_game_board.svg` family — despite the CC BY-SA tags, those were traced from a retail Hasbro board, which the uploader had no right to license. This is the single biggest trap in this research area, and the brief's assumption that there's a clean PD Risk SVG on Commons is the thing to unlearn.
- **"RISK" is a Hasbro trademark.** Don't name the product that. Renaming the territories too (and the paid-DLC map names) removes the last trademark exposure, at the cost of some familiarity.
- **ShareAlike is viral.** CC BY-SA assets (and the geodatasource CSV) would force your map data to be CC BY-SA. Prefer the PD/CC0/MIT/Apache/ISC sources, which is why the Tier-3 pipeline is built on Natural Earth.
- **GPL/AGPL code (Domination, openfrontio, P1sec) may be read for ideas but not copied** — copying would force the whole replica to GPL.

---

# Appendix: `map-data/` contents

See `map-data/INDEX.json` for the machine-readable version of this.

| Folder | Licence | Contents |
|---|---|---|
| `canonical/` | derived (facts) | **`classic-world.json` — start here.** The verified classic 42/6/83 graph with bonuses, sea links, adjudication record and 9-source provenance. |
| `totalrisk/` | **Unlicense** (PD) | 3 maps (42/47/59) as JSON + **3 per-territory SVGs** + 3 engine helper files for reference. |
| `risk-codelab/` | **Apache-2.0** | 2nd permissive classic SVG (`board.svg`, 800×540) + `map.dart` + JSON. |
| `preeminence/` | **MIT** | 6 graph-only maps: classic, **middle-earth (38)**, quad (20), mini (6), tiny3, tiny4. |
| `conquete/` | **MIT** | Exact classic graph. (Repo also has the best rules engine.) |
| `conquest-tracker/` | **MIT** | Exact classic graph + per-territory `x,y` label points + continent blobs + `bridges` set. |
| `gfceccon/` | **CC0-1.0** | Exact classic graph, public-domain dedication — the cleanest-licensed copy. |
| `risk-neighborhood/` | MIT | Classic graph **with 3 documented errors** — cross-check only, do not ship. |
| `smg-catalogue/` | CC BY-SA 3.0 (text); numbers are facts | **`all-maps.json` — all 134 SMG maps** with counts, packs, size buckets, blizzard/portal counts, per-region bonuses, wiki URLs, and the 2-surface cross-check record. |
| `naturalearth/` | **Public domain** | `ne_110m_admin_0_countries` (177 countries, GeoJSON + shapefile), `ne_50m_admin_1_states_provinces` (294 admin-1). |
| `topojson-atlas/` | **ISC** | `world-atlas` countries 110m + 50m, `us-atlas` states 10m. |
| `wikimedia/` | **Public domain** | `BlankMap-World.svg` (per-country ISO ids), `BlankMap-Africa.svg`, `Europe_blank_map.svg`, `BlankMap-Eurasia.svg`. **The Hasbro-derivative Risk board files were deliberately NOT copied here** — see B.5. |
| `country-borders/` | **CC BY-SA 4.0** | 728 country land-border pairs for auto-deriving adjacency. Attribution required. |

Every folder carries its own `LICENSE`, `LICENSE-NOTE.txt` or `NOTE.txt`.

---

# Sources

### RISK: Global Domination map catalogue (Part A.1)
- RGD Wiki — [Category:Maps](https://risk-global-domination.fandom.com/wiki/Category:Maps) (138 pages, scraped via the MediaWiki action API)
- RGD Wiki — [List of all maps by size](https://risk-global-domination.fandom.com/wiki/List_of_all_maps_by_size) (independent cross-check surface)
- RGD Wiki — [All maps with Map packs](https://risk-global-domination.fandom.com/wiki/All_maps_with_Map_packs)
- RGD Wiki — [Classic Map](https://risk-global-domination.fandom.com/wiki/Classic_Map), [Europe Map](https://risk-global-domination.fandom.com/wiki/Europe_Map), [Europe Advanced](https://risk-global-domination.fandom.com/wiki/Europe_Advanced_Map), [Pangaea](https://risk-global-domination.fandom.com/wiki/Pangaea_Map), [Simple World](https://risk-global-domination.fandom.com/wiki/Simple_World_Map), [Reverse World](https://risk-global-domination.fandom.com/wiki/Reverse_World_Map), [Arrakis](https://risk-global-domination.fandom.com/wiki/Arrakis_Map), [Mother of All Boards](https://risk-global-domination.fandom.com/wiki/Mother_of_All_Boards_Map), [Dino Canyon](https://risk-global-domination.fandom.com/wiki/Dino_Canyon_Map), [Moscow](https://risk-global-domination.fandom.com/wiki/Moscow_Map), [REDACTED](https://risk-global-domination.fandom.com/wiki/REDACTED_Map), [Operation A.D.A.M.](https://risk-global-domination.fandom.com/wiki/Operation_A.D.A.M._Map), [General Processing Unit](https://risk-global-domination.fandom.com/wiki/General_Processing_Unit_Map) (all 134 map pages are linked individually in the catalogue table above and in `all-maps.json`)
- Steam — [RISK: Global Domination](https://store.steampowered.com/app/1128810/RISK_Global_Domination/) and DLC pages: [Countries & Continents](https://store.steampowered.com/app/1295330/), [Countries & Continents 2](https://store.steampowered.com/app/1416090/), [Community Map Pack](https://store.steampowered.com/app/3918100), [Universal Domination](https://store.steampowered.com/app/2385960/), [Advanced 2](https://store.steampowered.com/app/2690000/), [Sci-Fi](https://store.steampowered.com/app/1761140/), [US City](https://store.steampowered.com/app/1179456/), [New World Views](https://store.steampowered.com/app/1179458/)
- [Wikipedia — Risk: Global Domination](https://en.wikipedia.org/wiki/Risk:_Global_Domination)
- [SMG Studio support / FAQ](https://smgstudio.freshdesk.com/support/solutions/folders/11000005092)
- [Apple App Store listing](https://apps.apple.com/us/app/risk-global-domination/id1051334048)

### Game mechanics (blizzards, portals, capitals)
- [Level Winner — RISK: Global Domination guide](https://www.levelwinner.com/risk-global-domination-guide-tips-tricks-strategies/)
- [Steam discussion — fog of war, blizzards, capitals](https://steamcommunity.com/app/1128810/discussions/0/4630359473422153173/)
- [Steam discussion — map advice](https://steamcommunity.com/app/1128810/discussions/0/568164715699815859/)
- [RISK Community Bulletin #8](https://steamcommunity.com/app/1128810/eventcomments/4911755446829889652/)

### Classic map rules & adjacency (Part A.2)
- [Wikipedia — Risk (game)](https://en.wikipedia.org/wiki/Risk_(game)) (42 territories by continent, bonus values, trans-oceanic routes)
- [Wikimedia — File:Risk_game_graph.svg](https://commons.wikimedia.org/wiki/File:Risk_game_graph.svg) (published adjacency graph; CC BY-SA 4.0 — used as reference, not shipped)

### Open-source implementations (Part B.4)
Reusable: [sonesson89/TotalRisk](https://github.com/sonesson89/TotalRisk) (Unlicense) · [arjanfrans/conquete](https://github.com/arjanfrans/conquete) (MIT) · [Zach-Hayton/Conquest-Tracker](https://github.com/Zach-Hayton/Conquest-Tracker) (MIT) · [dartlangfr/risk-codelab](https://github.com/dartlangfr/risk-codelab) (Apache-2.0) · [DouglasOrr/Preeminence](https://github.com/DouglasOrr/Preeminence) (MIT) · [gfceccon/risk](https://github.com/gfceccon/risk) (CC0) · [AndreasThinks/ai-at-risk](https://github.com/AndreasThinks/ai-at-risk) (MIT) · [hcekne/risk-game](https://github.com/hcekne/risk-game) (Apache-2.0) · [kbennett2000/lan-games](https://github.com/kbennett2000/lan-games) (MIT) · [seanperkins/riskety-rekt](https://github.com/seanperkins/riskety-rekt) (MIT) · [brunoscopelliti/risk-neighborhood](https://github.com/brunoscopelliti/risk-neighborhood) (MIT) · [nullobject/risk](https://github.com/nullobject/risk) (MIT) · [CollegeFootballRisk/Risk](https://github.com/CollegeFootballRisk/Risk) (MPL-2.0)

Read-for-ideas only: [Soularflare/RiskOnline](https://github.com/Soularflare/RiskOnline) · [AlexWilton/Risk-World-Domination-Game](https://github.com/AlexWilton/Risk-World-Domination-Game) · [tlmader/risk](https://github.com/tlmader/risk) · [rzencoder/risk](https://github.com/rzencoder/risk) · [AbsentMoniker/RISK](https://github.com/AbsentMoniker/RISK) · [LeonardoVal/ludorum-risky.js](https://github.com/LeonardoVal/ludorum-risky.js) · [krajzeg/compact-conflict](https://github.com/krajzeg/compact-conflict) · [diegomachadosoares/War](https://github.com/diegomachadosoares/War) (GPL-3.0) · [PukkaVXR/MapGenie](https://github.com/PukkaVXR/MapGenie) (~120 adjacency graphs, no licence) · [go-risk-it/go-risk-it-frontend](https://github.com/go-risk-it/go-risk-it-frontend) (best schema, no licence) · [termorrell/WorldDomination](https://github.com/termorrell/WorldDomination) · [deveshkumars/RiskAI](https://github.com/deveshkumars/RiskAI) · [micheledepra/WEBRISK_Render](https://github.com/micheledepra/WEBRISK_Render) · [openfrontio/OpenFrontIO](https://github.com/openfrontio/OpenFrontIO) (AGPL-3.0) · [dalemorris2021/risk-board-game](https://github.com/dalemorris2021/risk-board-game) (GPL-3.0) · [UnimibSoftEngCourse2022 riskgame](https://github.com/UnimibSoftEngCourse2022/riskgame-malnati-negro-persico-romano-radaelli-mvc-guru-1)

### Other map platforms (Part B.4)
- Domination — [project](https://sourceforge.net/projects/domination/) · [making maps (format spec)](https://domination.sourceforge.io/makemaps.shtml) · [map library](https://domination.sourceforge.io/getmaps.shtml) · [map editor help](https://domination.sourceforge.io/applet/help/swing_maps.htm) — engine GPL-3.0, **maps carry no licence**; geometry is a colour-keyed raster GIF
- Lux Delux — [map repository](https://sillysoft.net/lux/maps/) · [.luxb format spec](https://sillysoft.net/lux/maps/mapspec.php) · [terms](https://sillysoft.net/terms.php) — proprietary, no direct map downloads
- Warzone / War.app — [Map Making](https://war.app/wiki/Map_Making) · [API category](https://war.app/wiki/Category:API) — SVG-based but **no read/export API**; maps user-copyrighted
- TripleA — [map org (343 repos)](https://github.com/triplea-maps) · [maps list](https://triplea-game.org/maps-list/maps/) · [issue #7021 documenting the map-licence gap](https://github.com/triplea-game/triplea/issues/7021) · [upload guidelines](https://forums.triplea-game.org/topic/2446/map-requirements-guidelines-for-official-upload) — 342 of 343 repos have no licence
- [jdimeo/triplea-map-tools](https://github.com/jdimeo/triplea-map-tools) (MIT) — map editing tools

### Geometry and licences (Part B.5)
- Natural Earth — [terms of use](https://www.naturalearthdata.com/about/terms-of-use/) · [LICENSE.md](https://github.com/nvkelso/natural-earth-vector/blob/master/LICENSE.md) · downloads via `https://naciscdn.org/naturalearth/...` and [GeoJSON in-repo](https://github.com/nvkelso/natural-earth-vector/tree/master/geojson)
- [topojson/world-atlas](https://github.com/topojson/world-atlas) (ISC) · [topojson/us-atlas](https://github.com/topojson/us-atlas) (ISC)
- Wikimedia Commons — [Category:Risk (board game)](https://commons.wikimedia.org/wiki/Category:Risk_(board_game)) · [Category:Risk board diagrams](https://commons.wikimedia.org/wiki/Category:Risk_board_diagrams) · [File:Risk_board.svg](https://commons.wikimedia.org/wiki/File:Risk_board.svg) · [File:Risk_game_board.svg](https://commons.wikimedia.org/wiki/File:Risk_game_board.svg) · [File:Risk_schematic.svg](https://commons.wikimedia.org/wiki/File:Risk_schematic.svg) · [File:Castle_Risk_schematic_map.svg](https://commons.wikimedia.org/wiki/File:Castle_Risk_schematic_map.svg) · [File:Planisfero a scacchiera di Lamorisse.png](https://commons.wikimedia.org/wiki/File:Planisfero_a_scacchiera_di_Lamorisse.png) · [File:BlankMap-World.svg](https://commons.wikimedia.org/wiki/File:BlankMap-World.svg) · [File:BlankMap-Africa.svg](https://commons.wikimedia.org/wiki/File:BlankMap-Africa.svg) · [File:Europe_blank_map.svg](https://commons.wikimedia.org/wiki/File:Europe_blank_map.svg) · [Fandom licensing](https://www.fandom.com/licensing)
- [simplemaps SVG licence](https://simplemaps.com/resources/svg-license) (bespoke terms, not MIT) · [amCharts geodata](https://github.com/amcharts/amcharts5-geodata) (linkware) · [djaiss/mapsicon](https://github.com/djaiss/mapsicon) (no licence)
- [geodatasource/country-borders](https://github.com/geodatasource/country-borders) (CC BY-SA 4.0) · [P1sec/country_adjacency](https://github.com/P1sec/country_adjacency) (AGPL-3.0) · [wmgeolab/geoBoundaries](https://github.com/wmgeolab/geoBoundaries)
