# Island Empire (HBRZ-Developer) — Core Rules & Mechanics Research

> **Correction (coordinator, 2026-09-21):** this lane worked from text sources and assumed a HEX grid from the Slay/Antiyoy genealogy. Direct inspection of the official screenshots and walkthrough frames shows Island Empire uses a **square grid with 4-neighbour adjacency**. Read every "hex" below as "tile"; the consolidated, screenshot-verified facts are in `06-research-brief.md`, which overrides this file wherever they differ.


**Game:** Island Empire — "Build & Conquer" (iOS, app id `1552391458`) / "Island Empire - Strategy" (Google Play, package `com.hbrz.wodan`)
**Developer:** HBRZ-Developer, an individual developer named **Michael Haberzeth** ("HBRZ" = his initials/handle).
**Genre:** Turn-based hex/grid area-control strategy, explicitly in the lineage of Sean O'Connor's 1995 PC game **Slay**, and comparable to **Antiyoy** (Android).
**First release:** Google Play listing dates the app to **August 9, 2020** (confirmed via ChapterCheats walkthrough metadata: "developer: Hbrz-developer, genre: Strategy, release date: Aug 9, 2020").
**Current state (as researched):** actively updated; Android version researched was v1.8.29–1.8.35 (Apr–Aug 2026 builds); 1M+ Android installs; ~4.18–4.3/5 average rating on ~19–20K ratings.

---

## IMPORTANT CORRECTION — sources that turned out to be a DIFFERENT game

Several of the assigned/discovered sources are about an **unrelated, same-named game** and must **not** be used as evidence for HBRZ's Island Empire. This was confirmed by directly reading their content:

- **`gamefaqs.gamespot.com/iphone/636101-island-empire/faqs/63829`** (FAQ by "chandralibra", dated ~April 2012) — this is a strategy guide for a **2011 social/city-builder MMO called "Island Empire"** (published by Tap4Fun-style studio), not HBRZ's game. Its content is about Fishery/Lumber mill/Smelter/Warehouse/Barracks/Port/Market/Embassy/Townhall buildings, a chat system, a "map of neighboring towns," and red/blue city coloring based on player score — none of which match a Slay-like hex conquest game.
- **`neoseeker.com/island-empire/faqs/250498-walkthrough.html`** ("Island Empire FAQ/Strategy Guide v1.5.1") — almost certainly the same old city-builder game (blocked from direct read, but bundled with the same GameFAQs-era guide family and title).
- **`gamezebo.com/walkthroughs/island-empire-walkthrough/`** — confirmed directly: this is the same city-builder game (Fishery, Lumber mill, Smelter, Warehouse, Port, Townhall, Barracks, leagues). **Not** HBRZ's game.
- **`supercheats.com/iphoneipad/islandempire.htm`** — content sampled mentions gems, potions, armor, and an auction/pub system; not consistent with either Island Empire and likely also the old game or a third unrelated title. Excluded.

None of the numbers from these four sources appear anywhere in this document. This correction was independently reached during research and was also confirmed mid-task by the task coordinator.

**Working, on-target sources** used below: Slyther Droid review, minireview.io review (via proxy), Google Play listing + description + user reviews, Apple App Store listing + description, AppBrain/ApkCombo/Uptodown/ApkPure mirrors (description + version-history/changelog pages), ChapterCheats walkthrough metadata, and web-search snippets aggregating the above. Where Island-Empire-specific numbers were not published anywhere findable, the genre baselines **Slay** (official rules page by Sean O'Connor, hosted at windowsgames.co.uk) and **Antiyoy** (Fandom wiki, via search-result snippets after the wiki itself blocked direct fetches with bot-protection) are used and clearly labeled as such.

---

## 1. Summary

Island Empire is a turn-based, hex/grid territory-conquest game: each player controls one or more **provinces** (connected groups of owned tiles, each anchored by a city/capital-equivalent). On your turn you spend gold to buy and move units, build farms/walls, and capture adjacent tiles; income scales with how much territory you hold; every unit and building has ongoing per-turn upkeep; if a province can't pay its upkeep its units die (Slay/Antiyoy-style bankruptcy); capturing a tile that disconnects part of your territory spins the disconnected part off into a brand-new empire/province with its own separate economy. You win a level/match by destroying/capturing the enemy's cities. Units can be **merged** (combined) into stronger, higher-upkeep tiers; walls provide defense but cost money and upkeep; natural terrain (forests, mountains, ponds/water) acts as barriers/choke points. None of the app-store or review sources publish Island-Empire's exact numeric costs, incomes, or strengths (no wiki or FAQ with hard numbers could be located for this specific game) — the qualitative rules above are directly confirmed by the developer's own store description and by two independent reviews, but the **exact numbers** in the table below are mostly carried over from Slay and Antiyoy, the two games this one is explicitly modeled on, and are marked accordingly.

---

## 2. Turn structure

**Confirmed for Island Empire (qualitative only):**
- Official Google Play description: *"Each turn you can move your units to expand you[r] empire. The bigger the empire, the bigger your income. Destroy the enemy cities to win the game."*
- Players "buy new units, defend your kingdom with walls or build farms to improve your income" within a turn (Google Play description).
- A 2026 changelog entry (v1.8.18) mentions an **"income layout"** UI change with "new money alert graphics," implying income/upkeep is resolved and displayed at a defined point each turn (consistent with a start-of-turn income tick).
- v1.8.18 also disabled a **"one-click-move"** feature by default, meaning normally moving a unit takes more than one tap/step — implying a deliberate move-then-confirm action model rather than free-form movement, though this is a UI detail, not necessarily a rules limit.

**Inferred from Slay (windowsgames.co.uk official rules):**
- At the start of every turn, each territory earns income (see Economy section).
- Units are not limited by tile-distance; a unit takes **one action per turn**, and may move to any hex reachable via a chain of hexes in the friendly territory it starts in (movement is "one action," not a fixed tile-range).
- After income/upkeep resolves and bankruptcies (if any) are applied, the player buys/moves units, then ends the turn.

**Inferred from Antiyoy (Fandom wiki via search snippets):**
- A unit may move **up to 4 hexes** in a single turn, provided all hexes but the last are already part of its own province; the final hex (if friendly) must be unoccupied by a building. This is a materially different movement model from Slay's "one action, unlimited hexes through own territory."
- Capturing a hex requires unit strength to exceed the hex's protection; protection is projected onto adjacent own-territory hexes by units/buildings equal to their strength.

**Open question:** Which movement model (Slay's "1 action, any distance through own territory" vs. Antiyoy's "≤4 hexes per move") Island Empire actually uses is **not confirmed** by any source read. This is a first-order mechanical question for a clone and should be verified from direct gameplay/video footage.

---

## 3. Territory / Province model

**Confirmed for Island Empire:**
- Slyther Droid review (direct quote): *"when your territory is split in half, a new empire will form. This becomes a new territory with its own economy based on what's in it."* — confirms Slay/Antiyoy-style province splitting: cutting a connected group of tiles in two spins off a brand-new, independently-financed empire/province.
- minireview.io (via proxy): disconnected regions become "independent kingdoms" and can "collapse" if they lack sufficient farms/resources — i.e., a disconnected fragment can go bankrupt on its own even if the player's main empire is fine, and "divide and conquer" (splitting an opponent's territory) is called out as an effective tactic because "disconnected regions operate with separate economies and armies, creating strategic vulnerability even against stronger opponents."
- The game has **cities** that must be destroyed to win ("Destroy the enemy cities to win the game" — Google Play description). This strongly implies a capital/city-per-province model exactly like Slay's capitals and Antiyoy's castles, though Island Empire's exact term is "city," not "capital" or "castle."
- Weekly-challenge/Battle-Mode changelog notes reference a **"goldmine"** as a placeable resource building distinct from farms (added to the map editor in v1.6.90, later enabled in Battle Mode) — suggests provinces may have more than one economic building type.

**Inferred from Slay:**
- Territories are connected groups of hexes; each has one capital (or, if a hex containing a captured enemy capital merges into the group, that becomes a castle).
- If you capture a hex that links two of your own territories, they **merge**: the smaller territory's capital disappears and its treasury is added to the larger territory's capital.
- Capitals/castles defend their own hex plus all immediately-adjacent hexes within the same territory (capital defends at peasant-strength 1; a captured enemy castle defends at spearman-strength 2).
- Win condition: capture the whole island by killing all enemy units and capturing all their land.

**Inferred from Antiyoy:**
- Called **"Provinces"** rather than "territories." A capture that disconnects part of a province into two-or-more separated groups (each with ≥2 friendly hexes) splits it into multiple provinces, each getting its own new Castle.
- Provinces can be deliberately merged (recombines coin balance and income) or deliberately kept split (each province gets its own, cheaper, farm-cost curve — see Economy). A named tactic: expand out to a distant point, leave one link-hex ungarrisoned, and let the enemy capture it — this deliberately splits off a chunk of your own territory to seed a second, cheap-farm province with a free new Castle.

**Open question:** Does Island Empire call the anchor building a "city," "castle," or "capital," and is there a size/tile-count distinction between a starting capital and a captured enemy city (as in Slay's capital-vs-castle strength difference)? Not confirmed anywhere in the sources read.

---

## 4. Economy

**Confirmed for Island Empire (qualitative):**
- Income scales with territory size: "The more land you conquer, the more money you'll earn per turn" (Uptodown description) / "The bigger the empire, the bigger your income" (Google Play).
- Upkeep is real and continuous: uptodown review text: *"your moves cost money, and in this case, money is life. If you run out of coins, your soldiers will die, leaving your territory completely exposed to your enemy."* — confirms **Slay-style bankruptcy** (unpaid upkeep kills your own units) rather than, e.g., a soft debt/interest system.
- minireview.io: "Each unit and structure requires steady upkeep that gets deducted from our gold reserve on each turn... Failure to pay results in unit starvation and death."
- Farms exist and generate income: *"maybe you can offset those expenses by placing a few farms for income"* (Slyther Droid). No cost or income value is published anywhere found.
- Walls have both a purchase cost and ongoing upkeep: *"That can dig into your money and have upkeep too if you pay for stone walls"* (Slyther Droid).
- A **goldmine** building exists (introduced to the map editor in v1.6.90, later usable in Battle Mode) as a resource-producing structure distinct from farms; no cost/income numbers found.
- **Treasures** exist as level pickups/collectibles (Apple App Store description) — likely a one-time gold bonus rather than recurring income, but this is unconfirmed.
- Monetization (not gameplay economy, but relevant): free base game with ads + optional IAPs ranging **$0.99–$42.99** (minireview.io); Island 2 & Island 3 DLC chapters priced at **$5.49 each** per one web-search aggregation (a separate source states **$4.99 each**, likely reflecting regional pricing or a price change over time — both figures found, unresolved); a "full pack" (both DLC chapters + map editor + ad removal) is **$9.49**; the standalone **Map Editor IAP is $2.99**. The developer states in the app description: *"No luck, no money, no upgrades. Only your skill counts."* — i.e., IAPs are cosmetic/content-unlock only, not pay-to-win (also stated directly: "no pay-to-win" in the Google Play short description).

**Inferred from Slay (exact numbers, officially documented):**
- Income: **1 credit per turn for every hex in your territory that does not have a tree on it.**
- Unit purchase cost: a new peasant costs **10**; founding a castle costs **15**.
- Unit upkeep (wages deducted every turn): Peasant **2**, Spearman **6**, Knight **18**, Baron **54** (each tier's upkeep is roughly 3x the previous — "geometrically more expensive"). **Castles cost nothing to maintain.**
- Bankruptcy: if a territory can't pay its people, **all its men die**, turning into gravestones; a tree grows on the grave the following turn.
- Treasury is **per-territory** (province), not global — confirmed by both the merge rule (smaller capital's money transfers into the larger one on a link-capture) and the fact that disconnected territories each independently pay their own upkeep from their own income.

**Inferred from Antiyoy (exact numbers, from Fandom wiki via search-result snippets):**
- Income: 1 coin per hex per turn is implied as the baseline (mirrors Slay); trees reduce a hex's net income to 0 (see Terrain).
- Unit upkeep: **2, 6, 18, or 54 coins per turn** for the four unit tiers respectively — numerically identical to Slay's figures (possibly because the wiki's phrasing is itself derived from/cross-referencing Slay's page; flagged as a real risk of circularity, but still the most-cited number for Antiyoy specifically).
- Farm: gives **4 coins per turn**. **Each Farm purchase increases the cost of the next Farm bought in the same Province by 2 coins** (i.e., an escalating, per-province farm-cost curve — a farm-cost mechanic the task specifically asked about, confirmed present in Antiyoy). A new Farm must be built adjacent to the Castle or to another already-built Farm.
- Strategic consequence of the per-province farm-cost curve: keeping provinces **split** lets each one buy farms starting back at the cheap end of the curve, so multiple small provinces can out-produce one big merged province on total farms-per-turn, even though a merged province has a single combined treasury and income stream. This is an explicit, named trade-off on the wiki's Beginner's Guide/Provinces pages.
- Tree: costs the owner **1 coin/turn** while standing on a captured hex (net income of that hex becomes 0). Trees spread to other hexes at a random "propagation rate," and also spawn on a hex the turn after a gravestone appears there, and can spawn from cut-off/abandoned castles.

**Open questions:**
- Island Empire's actual per-hex income figure, farm cost/income figures, and whether farm cost rises per farm (Antiyoy-style) are **not confirmed anywhere**. Given the game explicitly borrows the split-province/bankruptcy/farm mechanics wholesale, an escalating per-province farm cost is a reasonable design guess but is unverified.
- Whether Island Empire has a **global** treasury option/setting or is strictly per-province like both ancestors — not confirmed, though the split-territory-has-its-own-economy quote strongly implies strictly per-province.

---

## 5. Units

**Confirmed for Island Empire (qualitative only):**
- The generic/most-cited unit name in reviews is **"knight"** (used loosely to mean "a purchasable military unit," not necessarily a specific tier name) — *"you can then spend that money on knights to conquer more land"* and *"Higher level Knights always beat lower level knights, but the upkeep is way more"* (Slyther Droid / aggregated search result).
- **Merging/combining** is a confirmed core mechanic: *"Combine your units to make stronger versions as you try to hold the frontline"* (Slyther Droid); minireview.io: *"Two units to create a warrior of a higher tier"*; Uptodown: fusion system, *"merging two with the same level"* strengthens a unit. This matches Slay's "place one unit on top of another to sum their strengths" and Antiyoy's tier-merge mechanic.
- Upkeep scales sharply by tier: *"if you want to create stronger knights to defeat stronger enemies, you'll need to pay much more"* — a stated resource-management tension (build farms first, or take a short-term economic hit to field the higher tier) is called out explicitly in an aggregated search summary.
- A **King unit** was added in v1.5.6 as a new/special unit type (per Google Play changelog aggregation) — likely a story-mode/campaign-specific unit rather than a normal purchasable tier; not otherwise documented.
- **Population is implicitly capped by upkeep**, not by a hard unit-count limit (minireview.io: "Cannot spawn infinite soldiers due to upkeep constraints").
- Combat rule confirmed qualitatively: a player must weigh "the gap between your level and your enemy's" before engaging, and "if enemy soldiers start to surround you... retreat and wait for backup" (Uptodown) — implies units of insufficient strength lose to higher-strength defenders, i.e., a strict strength-comparison combat model (no randomness), consistent with both Slay and Antiyoy ("no luck" is also literally the tagline: *"No luck, no money, no upgrades. Only your skill counts."*).

**Inferred from Slay (exact numbers):**
| Tier | Strength | Upkeep/turn |
|---|---|---|
| Peasant | 1 | 2 |
| Spearman | 2 | 6 |
| Knight | 3 | 18 |
| Baron | 4 | 54 |

- New peasant purchase cost: **10**.
- Merge rule: place one unit on another **in the same territory**; new unit's strength = **sum** of the two strengths (peasant+peasant=2=Spearman; peasant+spearman=3=Knight; spearman+spearman=4=Baron, etc.).
- A unit can capture any hex whose defenders have strength ≤ the attacker's strength (see Protection, below).

**Inferred from Antiyoy (exact numbers via wiki search snippets):**
- **4 unit tiers, differing only by strength**, in ascending order — **Peasant (1) < Spearman (2) < Knight (3) < Baron (4)** (one aggregated search snippet garbled this as "peasant, spearman, baron, knight," but that ordering contradicts every other Slay-lineage source including the numeric upkeep table below, and is treated as a search-summarization error, not a real rule difference).
- Upkeep: **2 / 6 / 18 / 54 coins per turn** for the four tiers (identical to Slay's numbers — see the circularity caveat above).
- Movement: **up to 4 hexes per move**, all but the last hex must already be the mover's own province, and the final hex (if friendly, i.e. not a capture) must be building-free.
- Capture rule: attacker's strength must be **strictly greater than** the target hex's protection value.

**Open questions:**
- Island Empire's exact tier names beyond "knight" (used generically) — is there a Peasant-equivalent starting unit, and is there a Baron-equivalent top tier, or does it use different naming ("Warrior," etc.)? Not confirmed.
- Exact unit purchase costs, strengths, and upkeep numbers for Island Empire — **not confirmed anywhere**.
- Whether merging consumes the unit's move for the turn (cannot merge then move) — not confirmed for Island Empire; inferred as likely from the general "one action per turn" framing in Slay, but this is a guess, not a documented rule.
- Which units can capture which structures (e.g., can only strong units take towers/cities, as in Antiyoy where only Knight/Baron can take a Tower) — not confirmed for Island Empire.

---

## 6. Protection radius / combat resolution

**Confirmed for Island Empire:** combat is deterministic/skill-based (no RNG) per the tagline and reviewer description of weighing "the gap between your level and your enemy's"; nothing more specific is published.

**Inferred from Antiyoy (exact rule, most precise ancestor source found):**
- *"To capture a cell the unit strength must be bigger than protection. Additionally, units give adjacent cells under your control protection equal to strength."* I.e., every friendly unit (and defensive building) projects a protection value, equal to its own strength, onto its own hex and all adjacent hexes that are part of the same province. An attacker needs strength **strictly greater than** the highest protection value covering the target hex to capture it.
- A **Tower** provides protection equal to a Spearman (protection = 2) but is stationary (cannot move, presumably cannot attack); consequently only Knight (3) or Baron (4) strength units can capture a hex a Tower is protecting. A separate, presumably-stronger **"Strong Tower"** building also exists (name only found; numbers not retrieved).
- Recommended placement tactic: space towers **2 hexes apart** so their protection zones don't wastefully overlap; weak towers suffice early (vs. enemy Peasants/Spearmen only), stronger towers needed once enemies field Barons.

**Inferred from Slay (exact rule):**
- A Castle defends its own hex and all adjacent hexes in the same territory at **Spearman strength (2)**; a Capital defends the same footprint at **Peasant strength (1)**. (Slay does not appear to have a separate "Tower" building distinct from the castle/capital — defense radius is provided only by the capital/castle itself, unlike Antiyoy which adds standalone Towers.)

**Open question:** Does Island Empire's wall (its named defensive structure) function like Slay's castle (no standalone defense building, city itself projects protection) or like Antiyoy's Tower (a separate, buildable, stationary protection-projecting structure independent of the city)? Reviewer language ("build some walls to protect a new area you've expanded into") reads much more like Antiyoy's Tower concept — a purpose-built, place-anywhere defensive structure — than Slay's city-only defense. This is the single most game-relevant unconfirmed mechanic for cloning purposes.

---

## 7. Defensive structures (walls / towers / cities)

**Confirmed for Island Empire:**
- **Walls** ("stone walls") are the named defensive structure: cost money to build and have ongoing upkeep (Slyther Droid, direct quote, see above). Used specifically to "protect a new area you've expanded into" — i.e., built at the frontier, not just anywhere.
- **Team-colored walls** were added in changelog v1.6.90, implying walls render distinctly per player/team in multiplayer and Battle Mode.
- **Choke points**: reviewer notes you can "take advantage of natural choke points or try to create your own using walls" — confirms walls can be placed to constrict the routes an enemy can use to attack, i.e., walls block or raise the cost of movement/capture through a hex, not merely add protection value to it.
- **Cities**: the win condition is "destroy the enemy cities" (Google Play) — city/cities are the anchor/capital-equivalent buildings; no cost, strength, or build-anywhere rule confirmed.
- **Goldmine**: a placeable economic (not defensive) building, added to the map editor in v1.6.90 and later enabled in Battle Mode; no cost/output numbers found.

**Inferred from Antiyoy (exact numbers):**
- **Tower**: protection equal to Spearman (2), stationary, capturable only by Knight/Baron-strength attackers (strength >2). A "Strong Tower" variant also exists in the game's building roster (numbers not retrieved from available sources).
- Recommended spacing: build towers 2 hexes apart to avoid overlapping protection wastefully.

**Inferred from Slay:**
- No standalone "tower" — defense radius is provided by the Capital (strength-1 protection) or a captured enemy Castle (strength-2 protection) over their own hex and all same-territory adjacent hexes. This differs materially from Antiyoy's separately-buildable Tower.

**Open questions:**
- Can Island Empire walls be built on any owned tile, or only at province borders / adjacent to a city, and do they have a fixed cost or an escalating cost like Antiyoy's farms? Not confirmed.
- Can walls themselves be attacked/destroyed directly (as opposed to simply raising the strength needed to capture the tile they occupy)? Not confirmed by any source read.
- Exact wall cost and upkeep numbers: not confirmed anywhere.

---

## 8. Terrain

**Confirmed for Island Empire:**
- Slyther Droid, direct quote: *"you'll need to strategize around natural barriers like **forests, mountains, and ponds** in the way."* — three terrain types are explicitly named as impassable/obstructing natural barriers.
- No source found states whether forests spread over time (Antiyoy-style tree propagation) or are static; no source states whether forests suppress income on the hex they occupy.
- "Sand" and "graves" (asked about by the task) are **not mentioned in any Island-Empire-specific source found** — their presence in Island Empire is unconfirmed either way.

**Inferred from Antiyoy (exact rule):**
- **Trees**: cost the owner 1 coin/turn while on a captured hex (net hex income becomes 0); spread to other hexes according to a random propagation rate; spawn on a hex one turn after a gravestone appears there; can also spawn from cut-off/abandoned castles.
- **Gravestones**: appear where units died (from a lost capture attempt or from province bankruptcy); a tree grows on a grave hex one turn later.

**Inferred from Slay (exact rule):**
- Hexes with a tree on them earn **0** income instead of 1 (i.e., trees zero out a hex's income rather than costing extra, a subtly different implementation from Antiyoy's "tree costs 1, making net income 0" — functionally identical outcome, different accounting).
- Bankruptcy produces gravestones; **a tree grows on a grave the following turn** (identical timing rule to Antiyoy).

**Open questions:**
- Do "mountains" and "ponds" in Island Empire ever get captured/traversed with enough strength, or are they permanently unownable/impassable (unlike Slay/Antiyoy's trees, which occupy a capturable hex)? Not confirmed — this is actually a meaningful departure point if true, since neither Slay nor Antiyoy have a genuinely impassable terrain type (trees are just a capturable hex with bad income).
- Does "sand" exist as a terrain type in Island Empire (task explicitly asks) — no evidence found either way.

---

## 9. Special mechanics

**Confirmed for Island Empire:**
- **Difficulty**: every level offers **three difficulty settings** (confirmed by both Apple App Store listing and Slyther Droid review: *"every level has three different difficulties that you can pick... the easiest one still feels tough"*). Three campaign-wide difficulty tiers (Easy/Normal/Hard) were introduced in changelog **v1.5.4** (Oct 19, 2023) alongside a set of **120 collectible stars per island** and **weekly battle challenges**.
- **Weekly Challenges**: rotating maps/objectives with rewards (App Store description: "Weekly challenges with fresh levels"); "already played weekly challenges" became viewable via a v1.6.90 changelog fix, implying a persistent history/leaderboard of past weekly challenges.
- **Unlockable skins**: Pirate, Tribe, and Ninja civilization skins (App Store description), plus desert and snow tilesets.
- **Random maps**: procedurally generated maps confirmed (both stores); a "seed" system for these is not explicitly confirmed by name, but procedural generation implies one exists internally.
- **Map editor**: create and share custom maps; App Store copy states support for **up to 50 maps**; save/load for map-editor games added in v1.6.90; standalone IAP price **$2.99**.
- **Local multiplayer**: Google Play/most aggregated listings say **up to 6 players**; the Apple App Store page and a couple of aggregated search results say **up to 8 players**. A Google Play user review clarifies a version-dependent/content-dependent cap: *"The first chapter only has 4 colors (so you vs 3 ai) whereas chapter 2 & 3 have up to 8."* This resolves the discrepancy: player-slot count is **content-dependent** (4 in the free Island 1 campaign content, up to 8 once Island 2/3 DLC or certain modes are unlocked), not a flat platform difference — though it's still not fully clear whether "6" (seen in some listings) reflects an older build.
- **Battle Mode** and **Card Mode**: named alternate modes (App Store description); Battle Mode's map-size cap for non-DLC-buyers was removed in v1.6.90, and Kings/Goldmine/Treasures were enabled in Battle Mode the same update.
- **Campaign structure**: "Island 1" ships free with **40 levels**; DLC adds "Island 2" and "Island 3" (**40 more levels**, i.e., 80 total per some aggregations, though one search summary states "80 additional level[s]" for the DLC alone — the exact 40-vs-80 DLC-level split is not fully resolved, see Open Questions); there is also an **"Island X"** mentioned in one App Store extraction.
- **Undo**: no source confirms or denies an undo feature.
- **King unit**, **story mode**, and **separate sound/music volume sliders** were all added in **v1.5.6** (Nov 14, 2023), alongside "improved AI difficulty scaling."
- **One-click-move**: an optional move-confirmation shortcut, present in the game but **disabled by default as of v1.8.18** (Nov 15, 2025); that same update revised the tutorial, fixed an ad-localization bug and a tutorial-skip bug, and reworked the income-alert UI ("Moveable-, Buildable-, Upgradable- field got new graphic" per the task coordinator's confirmed note).
- **Soundtrack** by Matthew Pablo (both stores).
- Monetization: ads (one ad "between each round," roughly every ~5 minutes in the early game per one long-term reviewer) plus optional IAPs; explicitly **no pay-to-win** design (stated directly in store copy) and the tagline "No luck, no money, no upgrades. Only your skill counts."

**Version-history mechanics timeline (from aggregated changelog searches):**
| Version | Date | Mechanic-relevant changes |
|---|---|---|
| v1.5.4 | 2023-10-19 | Introduced 3 campaign difficulty tiers; 120 collectible stars/island; weekly battle challenges |
| v1.5.6 | 2023-11-14 | Added King unit; added story mode; separate sound/music volume; improved AI difficulty scaling |
| v1.6.90 | 2024-07-18 | Goldmine added to map editor; Battle Mode map-size cap removed for non-buyers; Kings/Goldmine/Treasures enabled in Battle Mode; team-colored walls; weekly challenges become viewable after being played; save/load for map-editor games; bugfix preventing farms being built without enough money (confirms farms have a hard affordability gate, not a debt-purchase option); Level 18 rebalanced easier (esp. Island 3)
| v1.7.4 | 2024-11-30 | Added lap-record tracking for Map1; removed an ad test |
| v1.8.18 | 2025-11-15 | One-click-move disabled by default; tutorial revised; income/money-alert UI reworked; various bugfixes |

---

## 10. Differences from Slay / Antiyoy noted by reviewers or the developer

- No review or store listing explicitly enumerates "how Island Empire differs from Slay/Antiyoy" — none of the marketing copy or reviews name either ancestor game directly except the **minireview.io** review, which states outright that Island Empire is *"a turn-based strategy game inspired by the 1995 PC game 'Slay.'"* (This is the only source read that names the inspiration explicitly; the task's framing of Island Empire as Slay/Antiyoy-descended is corroborated by this independent review, not just by the task prompt.)
- One notable terminology/possible-mechanic difference: Island Empire calls its capturable-anchor building a **"city"** (not "capital" or "castle" as in Slay/Antiyoy), and its defensive structure a **"wall"** (not "tower" as in Antiyoy) — whether these are just renamed reskins of the same mechanics or functionally different is unconfirmed (see Open Questions).
- minireview.io states the grid is a **"square grid,"** not hex: *"Players compete for territory dominance on a square grid by strategically positioning troops."* This conflicts with the task's framing (and general genre convention — both Slay and Antiyoy use hexagonal tiles) and with the visual impression from store screenshots, which is not something this text-only research could directly verify. This is flagged as a likely reviewer imprecision (squares vs. hexes are an easy thing to misstate in prose), but it could not be independently confirmed or refuted from the sources read, so it is listed here rather than silently corrected.
- Reviewers frame the economic tension identically to the Slay/Antiyoy genre standard (build farms vs. build army vs. build walls, all draining the same treasury) without calling out any novel economic twist.

---

## 11. Table of every numeric value found

| # | Value | Applies to | Confidence |
|---|---|---|---|
| 1 | Income = 1 credit/turn per hex without a tree | Slay | inferred-from-Slay |
| 2 | New peasant costs 10 | Slay | inferred-from-Slay |
| 3 | New castle (founding) costs 15 | Slay | inferred-from-Slay |
| 4 | Peasant upkeep = 2/turn | Slay | inferred-from-Slay |
| 5 | Spearman upkeep = 6/turn | Slay | inferred-from-Slay |
| 6 | Knight upkeep = 18/turn | Slay | inferred-from-Slay |
| 7 | Baron upkeep = 54/turn | Slay | inferred-from-Slay |
| 8 | Castles: 0 upkeep | Slay | inferred-from-Slay |
| 9 | Peasant strength = 1 | Slay | inferred-from-Slay |
| 10 | Spearman strength = 2 | Slay | inferred-from-Slay |
| 11 | Knight strength = 3 | Slay | inferred-from-Slay |
| 12 | Baron strength = 4 | Slay | inferred-from-Slay |
| 13 | Merge result strength = sum of two merged units' strengths | Slay | inferred-from-Slay |
| 14 | Capital protection = strength 1 (self + adjacent, same territory) | Slay | inferred-from-Slay |
| 15 | Castle (captured) protection = strength 2 | Slay | inferred-from-Slay |
| 16 | Tree on a hex → hex income becomes 0 | Slay | inferred-from-Slay |
| 17 | Bankruptcy → all territory's units die → become gravestones | Slay | inferred-from-Slay |
| 18 | Gravestone → tree grows 1 turn later | Slay | inferred-from-Slay |
| 19 | 4 unit tiers, strength 1/2/3/4 (Peasant/Spearman/Knight/Baron) | Antiyoy | inferred-from-Antiyoy |
| 20 | Unit upkeep 2 / 6 / 18 / 54 coins/turn (4 tiers) | Antiyoy | inferred-from-Antiyoy (numerically identical to Slay; possible wiki cross-contamination) |
| 21 | Farm income = 4 coins/turn | Antiyoy | inferred-from-Antiyoy |
| 22 | Each farm bought raises the next farm's cost by +2 coins, per-province | Antiyoy | inferred-from-Antiyoy |
| 23 | New farm must be adjacent to Castle or another Farm | Antiyoy | inferred-from-Antiyoy |
| 24 | Tree costs owner 1 coin/turn (net hex income 0) | Antiyoy | inferred-from-Antiyoy |
| 25 | Tower protection = strength 2 (equal to Spearman), stationary | Antiyoy | inferred-from-Antiyoy |
| 26 | Tower capturable only by strength >2 (Knight/Baron) | Antiyoy | inferred-from-Antiyoy |
| 27 | Recommended tower spacing = 2 hexes apart | Antiyoy | inferred-from-Antiyoy (tactical tip, not a hard rule) |
| 28 | Unit movement ≤ 4 hexes/turn, all-but-last must be own province, last (if friendly) must be building-free | Antiyoy | inferred-from-Antiyoy |
| 29 | Capture requires attacker strength strictly > defender's protection value | Antiyoy | inferred-from-Antiyoy |
| 30 | Island Empire: 3 difficulty settings per level | Island Empire | confirmed |
| 31 | Island Empire: Island 1 campaign = 40 free levels | Island Empire | confirmed |
| 32 | Island Empire: DLC adds ~40 more levels (Island 2 + Island 3), possibly 80 per one source | Island Empire | confirmed (level count imprecise — see Open Questions) |
| 33 | Island Empire: 120 collectible stars per island (added v1.5.4) | Island Empire | confirmed |
| 34 | Island Empire: local multiplayer up to 8 players (Island 2/3 content); 4 players/colors in free Island 1 content | Island Empire | confirmed |
| 35 | Island Empire: map editor supports up to 50 maps | Island Empire | confirmed |
| 36 | Island Empire: Map Editor IAP price $2.99 | Island Empire | confirmed |
| 37 | Island Empire: Island 2 & 3 DLC chapters $5.49 each (alt. figure: $4.99 each found elsewhere) | Island Empire | confirmed, with an unresolved price discrepancy |
| 38 | Island Empire: "Full pack" (both DLC + map editor + ad removal) = $9.49 | Island Empire | confirmed |
| 39 | Island Empire: overall IAP range $0.99–$42.99 | Island Empire | confirmed |
| 40 | Island Empire: ~1 ad per round, ~5 min cadence in early game | Island Empire | confirmed (single reviewer's estimate, not a developer-stated figure) |
| 41 | Island Empire: release date August 9, 2020 | Island Empire | confirmed |
| 42 | Island Empire: rating ~4.18–4.3/5 on ~19–20K ratings, 1M+ Android installs | Island Empire | confirmed |
| 43 | Island Empire farm/wall/unit/city exact costs, strengths, upkeep, income-per-hex | Island Empire | **not found — no confidence value assignable; genre baseline (rows 1–29) is the best available substitute** |

---

## 12. Open questions (things a rules document could not resolve)

1. **Exact Island Empire numbers** for: income per hex, farm cost/income (and whether cost escalates per farm, Antiyoy-style), unit purchase costs, unit strengths, unit upkeep per tier, wall cost/upkeep, city/capital protection value. No source (official or third-party) publishes these; would require direct gameplay capture (screenshots of the in-game shop/HUD) to confirm.
2. **Exact tier names and count** for Island Empire's unit roster beyond the generic "knight" — is there a Peasant-equivalent base unit and a Baron-equivalent top unit, and how many tiers total?
3. **Movement model**: unlimited-hex "one action per turn" (Slay-style) vs. capped-distance-per-turn (Antiyoy's ≤4 hexes)?
4. **Wall mechanics in detail**: buildable anywhere vs. only at the frontier/adjacent to owned territory; fixed vs. escalating cost; can walls be attacked/destroyed directly, or only bypassed by exceeding the protection value they grant the tile; do walls project protection onto adjacent tiles the way Antiyoy Towers do, or only harden the tile they sit on?
5. **City vs. capital distinction**: does a starting city and a captured enemy city have different protection values (as in Slay's capital-1 vs castle-2), or are all cities equal?
6. **Terrain specifics**: do forests/mountains/ponds spread or regenerate over time; are they ever capturable/passable with enough force, or permanently impassable; does income get suppressed on a forest tile the way Slay/Antiyoy trees do; does "sand" or "graves" exist as terrain in this game at all (task explicitly asked; no evidence found either way).
7. **Merge-then-move**: can a freshly-merged unit still move/act in the same turn, or does merging consume the turn's action?
8. **Treasury scope**: strictly per-province (as strongly implied) or is there ever a global/shared treasury option?
9. **DLC level-count precision**: is the DLC 40 additional levels total (Island 2 + Island 3 combined) or 80 (40 each)? Sources conflict (one aggregated search says "80 additional level[s]" for the whole DLC bundle, most others imply 40 total split across two islands).
10. **6 vs 8 player cap**: fully resolved as content-dependent (4 base, up to 8 with DLC) by one direct user review, but some listings/aggregations still state a flat "6" — unclear if that reflects an older build or a different platform cap.
11. **Grid shape**: hex (expected, matches genre convention and task framing) vs. "square grid" (stated once by minireview.io) — unresolved from text sources alone; would need a screenshot to confirm definitively.
12. **Undo feature**: no evidence either way.
13. **Seeds for random maps**: procedural generation is confirmed, but whether players can input/share a specific seed is not confirmed.

---

## 13. Sources

**On-target (confirmed to be about HBRZ's Island Empire, `com.hbrz.wodan` / iOS id `1552391458`):**
- https://slytherdroid.com/island-empire-review/ — read directly; richest qualitative source; direct quotes on knights, merging, walls, farms, terrain barriers, territory-splitting, difficulty.
- https://minireview.io/strategy/island-empire-turn-strategy — read via proxy (direct fetch initially returned only a title header); confirms Slay inspiration, income-per-tile, upkeep/bankruptcy, merging, IAP pricing.
- https://play.google.com/store/apps/details?id=com.hbrz.wodan&hl=en_US — official Google Play listing; description, changelog snippets, user reviews (multiplayer player-count clarification, ad cadence, DLC pricing).
- https://apps.apple.com/us/app/island-empire-build-conquer/id1552391458 — official Apple App Store listing; description, feature list (map editor, weekly challenges, skins, King unit, treasures, goldmine, difficulty settings).
- https://www.appbrain.com/app/island-empire-build-conquer/com.hbrz.wodan — mirror description + version metadata.
- https://island-empire.en.uptodown.com/android — mirror description with additional mechanic phrasing (fusion system, income scaling, bankruptcy consequence).
- https://apkcombo.com/island-empire-strategy/com.hbrz.wodan/ (via proxy) and general apkpure/apkpure.net/apk.dog/moddroid mirrors — version numbers, description repeats, aggregated changelog data (v1.5.4, v1.5.6, v1.6.90, v1.7.4, v1.8.18 patch notes).
- https://www.chaptercheats.com/cheat/android/559803/island-empire-turn-strategy/video-walkthrough/360441 — confirmed developer name and **release date (Aug 9, 2020)** via listing metadata.
- https://m-apps.qoo-app.com/en-US/app/20826 — mirror listing, version v1.8.29 (Apr 28, 2026), confirms local multiplayer language and level count.
- WebSearch aggregations across the above plus skich.app, appgrooves.com (unreachable directly — DNS failure), soft112.com — used to cross-reference version-history and pricing figures.

**Genre-baseline sources (used only to fill gaps, explicitly NOT Island-Empire-specific — all numbers from these are marked inferred-from-Slay / inferred-from-Antiyoy in the table above):**
- https://www.windowsgames.co.uk/slayRules.html — Sean O'Connor's own official Slay rules page; read in full; primary source for all Slay numbers in this document.
- https://en.wikipedia.org/wiki/Slay_(video_game) — read; low mechanical detail, used only for corroboration.
- https://antiyoy.fandom.com/wiki/* (Economy, Settings - information, Defensive grid, Beginner's guide, Tower, Farm, Tree, Provinces, Units, Castle) — the wiki itself returned HTTP 402/429 bot-protection errors on every direct and proxied fetch attempt; all Antiyoy figures in this document are reconstructed from WebSearch result snippets that quote the wiki's text, not from directly reading the pages. This is a meaningfully weaker sourcing tier than the Slay numbers and is flagged inline throughout.
- github.com/yiotro/Antiyoy — **not read** (time/tool constraints); the open-source repository would be the strongest possible source for exact Antiyoy numbers (readable from game data/config files) and is recommended as a follow-up if more precision is needed on the Antiyoy baseline specifically.

**Excluded — confirmed to be about a different, same-named game (see Section "Important Correction" above), NOT used as evidence anywhere in this document:**
- https://gamefaqs.gamespot.com/iphone/636101-island-empire/faqs/63829
- https://www.neoseeker.com/island-empire/faqs/250498-walkthrough.html
- https://www.gamezebo.com/walkthroughs/island-empire-walkthrough/
- https://www.supercheats.com/iphoneipad/islandempire.htm

**Attempted but inaccessible (blocked/failed, not used):**
- https://apppage.net/preview/com.hbrz.wodan — HTTP 403 on both direct and proxied fetch.
- https://appgrooves.com/app/island-empire-turn-based-strategy-by-michael-haberzeth — DNS resolution failure.
- https://apkpure.com/island-empire-turn-strategy/com.hbrz.wodan/versions — HTTP 403.
- www.youtube.com/watch?v=V46ji1xTSW4 — page returned only navigation chrome, no transcript/description text retrievable via fetch tool.
- web.archive.org mirrors — fetch tool explicitly refused (unsupported host).
