# Island Empire (HBRZ-Developer) — Game Structure, Modes, Maps, AI & Map Editor

> **Correction (coordinator, 2026-09-21):** this lane worked from text sources and assumed a HEX grid from the Slay/Antiyoy genealogy. Direct inspection of the official screenshots and walkthrough frames shows Island Empire uses a **square grid with 4-neighbour adjacency**. Read every "hex" below as "tile"; the consolidated, screenshot-verified facts are in `06-research-brief.md`, which overrides this file wherever they differ.


**Target:** Island Empire: Build & Conquer / "Island Empire - Strategy" — Android `com.hbrz.wodan`, iOS app id `1552391458`.
**Developer:** Michael Haberzeth, solo indie dev, publishing as "HBRZ-Developer" (HBRZ ≈ "Haberzeth"). Personal site: michael-haberzeth.de (German web developer, TYPO3/WordPress). Active on Google Play since ~August 2020. Island Empire appears to be his only published game (App Store developer page lists no other apps). Music by Matthew Pablo (matthewpablo.com).
**Package/internal name:** `com.hbrz.wodan` — "Wodan" (Germanic god Odin/Wotan) looks like an internal codename, not a player-facing term.
**Lineage:** Multiple independent sources (search-engine summaries of app-store copy and comparison articles) describe Island Empire as directly inspired by Sean O'Connor's *Slay* (1995) and comparable to *Antiyoy*; one paraphrase attributes the developer's motive as wanting Slay/Antiyoy-style gameplay with nicer graphics and a level selector.

> **IMPORTANT SOURCE CORRECTION (mid-research):** The GameFAQs page `gamefaqs.gamespot.com/iphone/636101-island-empire/faqs/63829` and the Neoseeker "Island Empire FAQ/Strategy Guide v1.5.1" (chandralibra, 2012) are for a **different, unrelated game** — Tap4Fun's 2011 browser/mobile MMO also titled "Island Empire" (town-building, PvP raiding, leagues, gems, embassies, pubs/heroes). This was confirmed when a fetched "walkthrough" turned out to describe Townhalls, Warehouses, Embassies, leagues, and gem-based speedups — none of which match HBRZ's hex/Slay-style game. **Both sources are excluded from this report and should not be cited for this game.** Any claim in circulation that traces back to those two URLs (including the framing that reviewers describe "walking a character along a single-file path on a world map") could not be independently verified against a genuine HBRZ source and is flagged as an open question below rather than reported as fact.

---

## Summary

Island Empire is a solo-developed, turn-based hex/area-control strategy game in the Slay/Antiyoy lineage: capture territory hex-by-hex, income scales with land held, units merge into higher tiers, and higher-tier units auto-beat lower-tier ones at the cost of higher upkeep. The game ships a story campcampaign of at least three "islands" (chapters) of 40 levels each (first island free, others paid), each level offering three selectable difficulties, with a star-reward system that arithmetically lines up with 40 levels × 3 difficulties = up to 120 stars per island. It also advertises weekly challenges, procedurally generated random maps, local (same-device) multiplayer for up to 8 players, an unlockable in-app-purchase map editor, unlockable "civilization" skins, and full offline play. It's a small, long-tail-supported indie title — four-plus years of point updates (2022–2026), ~1–1.4M Android installs, 4.2–4.3★ on Google Play (~19–19.5K ratings) vs. a much smaller iOS footprint (~150 ratings, 4.8★). Primary monetization is per-chapter/feature IAP (not a subscription or heavy ad-gate), plus a small coin currency and an optional remove-ads purchase. Independent, first-party technical detail (map-generator parameters, editor tool list, hex orientation, exact weekly-challenge mechanics) is thin online — most of what exists is app-store marketing copy repeated verbatim across mirror/APK sites, plus a couple of substantive third-party reviews (slytherdroid.com, and paraphrased minireview.io content). No dedicated wiki, subreddit, or official website with documentation was found.

---

## Campaign

| Fact | Detail |
|---|---|
| Structure | Divided into "islands" (also called "chapters"). Confirmed: 3 islands total. |
| Levels per island | 40 levels each (Island 1 = free; Islands 2 and 3 = paid DLC), so ~120 levels total across the base 3 islands. |
| Difficulty | Every level offers **three selectable difficulties** (commonly rendered Easy/Normal/Hard in store copy). Per slytherdroid's review: "Every level has three different difficulties that you can pick. ... the easiest one still feels tough." |
| Star rewards | Store copy states players can "collect up to 120 stars per island." This arithmetically matches 40 levels × 3 difficulty tiers (1 star per difficulty beaten) = 120 — a plausible mechanic (beating a level on a harder difficulty likely awards an additional/better star), though the exact awarding rule (1 star per difficulty vs. graduated 1–3 stars per level) is not confirmed. slytherdroid: "If you're the type of person that loves to get as many stars as possible, you'll need to beat each level on Hard." |
| Level select / navigation | Not independently confirmed. slytherdroid's review criticizes that "there isn't an easy way to navigate between levels," which is at least consistent with (but does not prove) a sequential/path-based level-select screen rather than a free-jump menu. The specific claim that players "walk a character along a single-file path on a world map" traces back to sources that (per the correction above) may actually describe the unrelated Tap4Fun game — **could not be verified for this game** and is listed as an open question. |
| Terrain/level variety | slytherdroid: maps feature "natural barriers like forests, mountains, and ponds," and "special levels occasionally appear with unique starting conditions that alter typical gameplay." Desert tiles were added later (see changelog, v1.4.7.3, "Desert tiles"). |
| Difficulty curve | Player-review paraphrases are split: some say AI/difficulty is "bad"/too easy, others say the game "spikes to a ridiculous level from tutorial onward with no hints." slytherdroid says even "Easy" feels tough. The developer reportedly considered adding a score system or higher difficulty tier in response to feedback (low-confidence, from search-summary paraphrase, no primary link secured). |
| DLC campaigns | **Island 2** and **Island 3**, each ~40 levels, each a separate IAP. iOS pricing (coordinator-confirmed / matched in this research): Island 2 = $4.99, Island 3 = $4.99, full game bundle = $8.99. Several third-party (likely Android/Google Play-era) sources instead quote Island 2/3 at $5.49 each and a "full pack" (both islands + map editor + ad removal) at $9.49 — plausibly a different platform/region/time-period price point; both figures are reported here since they recur across independent write-ups. |
| Tutorial | Present and has been revised more than once across updates (see changelog — "Tutorial revised," bugfixes for "Skipping Tutorial," "Level5 Tutorial," etc.), suggesting an onboarding sequence baked into early campaign levels. |

---

## Weekly Challenges

- Confirmed (verbatim store copy, repeated identically across Google Play, Apple App Store, and every APK mirror checked): **"Weekly challenges with fresh levels."**
- One independent paraphrase (minireview.io, via search-engine summary) describes it as: "Weekly Challenges: Rotating battle mode levels with rewards" and "unique maps and objectives," but this specific "Battle Mode" framing was **not** reproduced in a verbatim re-check of the Apple listing and should be treated cautiously (possibly a summarizer artifact rather than an actual in-game mode name — see note under Random Maps below).
- No source found describing: how a challenge's map/seed is chosen or rotated, whether there's a global leaderboard, what the specific reward is (coins were mentioned once, unconfirmed), or whether challenges are timed/one-attempt.
- **Confidence: the feature exists (confirmed); every mechanical detail beyond "new level(s) weekly" is unconfirmed/guess.**

---

## Random Maps

- Confirmed feature, present in every store description checked: "Random maps and local multiplayer for endless replayability."
- No source — including the developer's own store listings — documents a random-map **setup/options screen** (map size, number of islands, number of players, seed input, etc.). This is a genuine gap; nothing indexed online describes the UI for configuring a random map.
- One low-confidence single-pass summary of the Apple listing produced the terms "Battle Mode" (with "two options") and "Card Mode" (a "gameplay variant with card mechanics"). A follow-up verbatim quote of the same App Store page's description text did **not** contain either term. These are flagged as likely hallucinated/misread by the summarizing pass and are **excluded from confirmed facts**; if real, they were not corroborated by any other source.
- Genealogy inference only (not confirmed for Island Empire itself, see dedicated section below): games in this lineage (Slay, Antiyoy) generate a random map by seeding a deterministic RNG, dividing a bounded hex region into starting territories, one per player, and scattering trees/neutral structures; Island Empire's own generator's actual parameter set is unknown.

---

## Local Multiplayer

- Confirmed, verbatim, across Google Play, Apple App Store, and independent mirrors: **"Random maps and local multiplayer for up to 8 players."** This exact "8 players" figure recurs consistently in every direct quote/paraphrase-of-marketing-copy source checked (Play Store, App Store, appbrain, apkcombo, apkpure, skich.app, slytherdroid-adjacent listings).
- A competing figure of **"up to 6 players"** appears repeatedly, but only inside AI-generated search-summary paraphrases, never inside a directly quoted piece of store copy or a review. This looks like a recurring summarization error (the underlying search results were the same Play Store snippet that says 8) rather than a real discrepancy between platforms or versions. **Treat "8" as confirmed and "6" as an artifact.**
- Presumed hot-seat/pass-and-play given "local multiplayer" and no evidence of any networking requirement; not explicitly described as hot-seat by any source (inferred from "offline play" + "local multiplayer" phrasing).
- Player colors: not documented anywhere found.
- Online multiplayer: not currently a shipped feature. One search-summary paraphrase (low confidence, no primary source secured) claims "the developer is currently working on an online mode... with plans to release it that year" and "started developing a more complex sequel... with more units and buildings," possibly monetized only via boosters/skins and free-to-play. This is unverified rumor-tier information and should not be treated as confirmed.

---

## AI

- Three named difficulty tiers per level (commonly Easy/Normal/Hard), confirmed via slytherdroid review and repeated store copy ("Three difficulty settings").
- Player sentiment on AI quality is mixed and inconsistent across reviews (paraphrased from aggregated app-store reviews, not individually sourced/quoted):
  - Some reviews call the AI "bad" or under-challenging even on higher settings.
  - Others describe it as "sometimes really dumb, but other times brutal."
  - slytherdroid's review (single-player campaign focus) describes AI opponents that "manage their economy while also expanding" — i.e., the AI is depicted as doing real economic/expansion play, not just static defense.
- No source documents distinct AI "personalities" (e.g., aggressive vs. turtling vs. economic archetypes); this appears to be undocumented/nonexistent as a marketed feature.
- No numeric difficulty parameters (e.g., income multipliers, aggression thresholds) were found anywhere.

---

## Map Editor

- Confirmed as a real, shipped feature, gated behind IAP: **"Map editor for custom gameplay."** iOS IAP price (coordinator-confirmed and independently matched in this research): **Map Editor = $2.99** (as a standalone purchase) or bundled into the "full game"/"full pack" purchase alongside Islands 2–3 and ad removal.
- No source (official or third-party) enumerates the actual toolset — no confirmation of specific tools like terrain painting, city/unit/tree/wall placement, or a max map-size control. A single unverified/uncorroborated summary pass claimed a cap of "up to 50 [maps] maximum," but this was not reproduced anywhere else and should be treated as a guess at best.
- No evidence of a file format, export/share code, or any player-to-player map-sharing mechanism (no cloud upload, no code-sharing UI, no community map repository found). Given the game is otherwise fully offline-capable, it's plausible custom maps are local-only with no built-in sharing — but this is an inference, not a confirmed absence.
- No screenshots, videos, or write-ups describing the editor's UI were successfully retrieved (several candidate pages — apppage.net, appbrain.com, skich.app's deeper content, minireview.io's full article — returned bot-check/CAPTCHA walls or truncated content and could not be read in this pass).

---

## Map Shapes / Hex Grid

- Whether Island Empire's grid is hex at all, and if so flat-top vs. pointy-top, is **not directly confirmed** by any source read in this research. One search-summary loosely called it "hex-based" without citing a concrete visual source; another, less reliable, summary described a "square grid" (almost certainly a confusion/hallucination, since square grids are inconsistent with the Slay/Antiyoy lineage the game is explicitly compared to). No screenshot analysis was performed (no image-bearing page was successfully fetched).
- Island-shaped maps surrounded by water are consistent with the game's title and its "natural barriers like... ponds" terrain description, but explicit "island surrounded by water" map-shape confirmation (vs., e.g., landlocked continents) was not found.
- Multiple islands per map: not confirmed either way.
- **This is a genuine, significant gap** — direct visual/gameplay-video inspection (not accomplished in this text-only research pass) would be needed to nail down grid orientation and map silhouette conventions.

### Genealogy reference: how Slay and Antiyoy generate random island maps (NOT confirmed to apply to Island Empire — background only)

- **Slay (1995, Sean O'Connor):** Wikipedia and TVTropes confirm the core loop ("conquer the island by buying soldiers and peasants and using them to capture enemies' hexagons") but do not document the map-generation algorithm. A search-derived characterization (unsourced to a primary document) describes tiles being allocated to factions in a way that "looks random but is generated by a seeded RNG," consistent with 1990s-era practice of seeding a PRNG for a reproducible-but-varied map; this could not be verified against source code (Slay's source was not released/found).
- **Antiyoy (yiotro/Antiyoy, official Android source, libgdx-based):** The README documents "Random map generator" and "Hotseat multiplayer up to 10 players" as headline features but gives no algorithmic detail beyond that.
- **chelokot/antiyoy (modern reinforcement-learning-oriented fork):** This fork's documentation is the most concrete description of an Antiyoy-style generator found in this research. It exposes a `ProceduralConfig`/`VectorEnv.procedural` interface that produces "deterministic connected maps with configurable land, players, starts, money, trees, neutral structures, and graves." Configurable parameters include: land density (island/water ratio), player count (documented range 2–8), starting positions, initial money, tree placement, neutral-structure placement, and "graves" (remnants of prior combat — a known Slay/Antiyoy convention marking where a unit died). Generated maps are guaranteed "connected" (all land reachable by at least one path), and a browser interface exposes "editable dimensions, seed, and land density" for real-time regeneration.
- **Why this matters for a from-scratch clone:** if Island Empire's own random-map generator is unconfirmed in its specifics (it is), the Antiyoy-family parameter set above (dimensions/seed/land density/player count/starts/money/trees/structures/graves, with a connectivity guarantee) is a reasonable, well-attested reference model for what a Slay-lineage hex generator typically exposes — but it should be treated as **inspiration/genealogy, not a confirmed spec of Island Empire's own generator.**

---

## Save/Resume, Undo, Settings, Skins, Ads/IAP, Offline

| Feature | Status |
|---|---|
| Offline play | Confirmed, repeatedly, verbatim: "Offline play" / "fully playable offline without internet connection." No network requirement for campaign, random maps vs. AI, or local multiplayer. |
| Save/resume | Not explicitly documented; presumed standard for a mobile campaign game (per-level progress persists, mid-level state likely autosaved given turn-based mobile conventions), but no source directly confirms mid-level save/resume behavior. |
| Undo | No source mentions an undo feature. Open question. |
| Settings | Confirmed only that sound/music exist as toggleable elements (inferred from a changelog bugfix: "Music/Sound doesn't play"). No confirmation of a broader settings menu (language switch is implied by 15+ supported languages listed on the App Store, though that specific language count came from a single non-corroborated pass and should be treated as inferred rather than confirmed). |
| Skins | Confirmed feature: "Unlockable skins for your civilization" / "unlockable civilization skins," present in every store description checked. Unlock method (currency purchase vs. achievement-based) is not documented anywhere found. |
| Ads | Confirmed: free tier shows ads. slytherdroid: "a forced ad after completing a level," but "once you get past the first few levels, sessions take longer and the ads don't feel aggressive." A dedicated **Remove Ads** IAP exists, $2.99 on iOS (coordinator-confirmed, matched here). |
| IAP model | Not pay-to-win; multiple reviews/listings state no pay-to-win mechanics. Coin packages exist (iOS: $0.99–$14.99 range across XS–XL tiers, coordinator-confirmed). Overall model = free base game (Island 1, 40 levels) + paid content unlocks (Islands 2–3, Map Editor) + optional ad removal + optional cosmetic-adjacent coin purchases. |
| Monetization philosophy | apkcombo's description of the game includes the tagline: **"No luck, no money, no upgrades. Only your skill counts."** — i.e., in actual gameplay (not the meta/IAP layer), the developer explicitly markets it as skill-determined with no pay-to-win power purchases. |

---

## Version History / Changelog (assembled from multiple mirror sites; not a complete official record)

| Version | Approx. date | Notable changes (as reported) |
|---|---|---|
| 1.4.7.3 | ~May 18, 2022 | New Tutorial; Desert tiles (new terrain type); optimized unit graphics; bugfixes: "no map at first gamestart," "Shop Full Game." |
| 1.6.5.1 / 1.6.7.3 | (mod-site version markers, undated) | No changelog text captured. |
| 1.8.7.1 | (undated) | Adds "One-Click-Move" feature (a streamlined unit-movement input mode). |
| 1.8.9 – 1.8.13 | 2024–2025 (approx.) | No changelog text captured; only version numbers seen on mirror sites (happymod, uptodown). |
| 1.8.10.2 (build 304) | (undated) | Tracked by mod-distribution forum; no notes captured. |
| 1.8.16 | (undated, listed as "latest" on apkgk at time of that page's snapshot) | No changelog captured. |
| 1.8.17.1 | (undated) | "Level optimizations, revised tutorial, several bugfixes." |
| **1.8.18** | **Nov 15, 2025** | Coordinator-confirmed/verbatim (matched independently in this research from the Apple App Store "What's New" section): *"Level optimized. One-click-move deactivated by default [i.e., changed from default-on to default-off]. Moveable-, Buildable-, Upgradable- field got new graphic. New graphic for money alert. New income layout. Tutorial revised. Bugfix: Skipping Tutorial. Bugfix: Fixed ad localization. Bugfix: First click in game don't work. Bugfix: Level5 Tutorial Unity: Security update. Bugfix: Double border at images, Island 3, Special 2 got easier. Bugfix: Alert icon for low income."* |
| 1.8.20.7 | (undated) | Tracked on Platinmods; no notes captured. |
| 1.8.21.1 | (undated) | Tracked on Platinmods; no notes captured. |
| 1.8.25 | (undated) | Tracked on Moddroid; no notes captured. |
| **1.8.29** | **Apr 28, 2026** | "Removed Welcome Message" (per skich.app's snapshot of a store changelog). |
| 1.8.31.1 | (undated) | Tracked on iOSGods (iOS mod thread — note the same version numbering appears to track across iOS/Android). |
| 1.8.32 | 2026 (approx.) | No changelog text captured. |
| 1.8.33.3 | Jun 19–21, 2026 | File size 76.8 MB; no further notes captured. |
| 1.8.34.1 | Aug 1, 2026 | File size 76.8 MB. |
| **1.8.35** | **Aug 20–28, 2026 (sources differ by ~1 week)** | "Billing Update Version 8.0.0"; "Target API-Level 38 changed" (Android Play Store compliance update). |

Overall picture: a single solo developer has shipped small point releases roughly monthly-to-quarterly from at least mid-2022 through late 2026 (4+ years), mostly tutorial/UX polish, bugfixes, and periodic Android target-API compliance bumps — no evidence of a major version-2 relaunch or the rumored "online mode"/"sequel" having shipped as of Sep 2026.

---

## Table of Concrete Facts (with confidence)

| Fact | Confidence | Source(s) |
|---|---|---|
| Developer is Michael Haberzeth, solo dev, publishing as HBRZ-Developer | Confirmed | Apple App Store developer field; apps.apple.com developer page; appadvice/appagg listings |
| Package/App ID: `com.hbrz.wodan` (Android), `1552391458` (iOS) | Confirmed | Task brief, Google Play, App Store |
| 3 "islands"/chapters, 40 levels each | Confirmed | slytherdroid review, repeated across appbrain/apkcombo/apkpure/skich summaries |
| Island 1 free, Islands 2–3 paid DLC | Confirmed | slytherdroid, multiple store-copy mirrors |
| 3 difficulty settings per level | Confirmed | slytherdroid (direct quote), store copy ("Three difficulty settings") |
| Up to 120 stars collectible per island | Inferred (plausible, arithmetically consistent with 40×3) | Single store-copy pass, cross-checked against confirmed 40-level/3-difficulty structure |
| Weekly challenges = "fresh levels" on rotation | Confirmed (existence only) | Verbatim across Google Play, App Store, all mirrors |
| Weekly challenge leaderboard/reward mechanics | Guess/unconfirmed | No source found |
| Random maps feature exists | Confirmed (existence only) | Verbatim store copy |
| Random-map generator options (size/islands/players/seed) | Unknown/unconfirmed | No source found describing the actual UI |
| Local multiplayer up to 8 players | Confirmed | Verbatim store copy (Play Store, App Store, appbrain, apkcombo, apkpure, skich) |
| "Up to 6 players" figure | Contradicted/likely search-summary artifact | Only appears in paraphrased AI summaries, never in a direct quote |
| Hot-seat/pass-and-play local multiplayer | Inferred | "Local multiplayer" + "offline play" phrasing, not explicit |
| Online multiplayer | Not shipped; in-development rumor only | Single unverified search-summary paraphrase |
| Player colors in multiplayer | Unknown | No source found |
| AI has 3 difficulty tiers, mixed player sentiment on quality | Confirmed (existence); quality assessment = anecdotal/mixed | slytherdroid, aggregated review paraphrases |
| AI "personalities" | Not documented / likely doesn't exist as a marketed feature | No source found |
| Map editor exists, gated by $2.99 IAP (iOS) or bundled in full-game purchase | Confirmed | Coordinator-confirmed, independently matched via Apple App Store IAP list |
| Map editor toolset specifics (paint terrain, place units/trees/walls, size limits) | Unknown/unconfirmed | No source found; several candidate pages inaccessible (CAPTCHA/bot-blocked) |
| Map editor save/share/export codes | Unknown, plausibly local-only (offline game) | Inferred, not confirmed |
| Hex grid, orientation (flat-top vs. pointy-top) | Unconfirmed | No reliable visual source retrieved in this pass |
| Island-shaped maps surrounded by water | Plausible/inferred from title + terrain description | slytherdroid ("ponds," natural barriers), game title |
| Multiple islands per single map | Unknown | No source found |
| Genre lineage: inspired by Slay (1995), comparable to Antiyoy | Confirmed (widely repeated characterization) | Multiple independent comparison write-ups/search summaries |
| Merge mechanic (2 same-level units → 1 higher-tier unit) | Confirmed | Search-summary paraphrase of a direct gameplay-mechanics description; consistent with Slay/Antiyoy convention |
| Income scales with territory held; troop upkeep can bankrupt you and kill units | Confirmed | Same source as merge mechanic |
| Higher-level unit always beats lower-level unit, at higher upkeep cost | Confirmed (as reported) | Same source |
| Terrain types: forests, mountains, ponds/water, desert (added v1.4.7.3) | Confirmed | slytherdroid; changelog |
| Unlockable civilization skins | Confirmed (existence only) | Verbatim store copy |
| Fully offline-playable | Confirmed | Verbatim store copy |
| Ad model: forced ad after each level completion (free tier), eases up over time | Confirmed | slytherdroid direct quote |
| Remove Ads IAP: $2.99 (iOS) | Confirmed | Coordinator |
| Full game bundle: $8.99; Island 2: $4.99; Island 3: $4.99; Map Editor: $2.99 (iOS) | Confirmed | Coordinator, independently matched |
| Alternate pricing: Islands 2/3 at $5.49 each, full pack $9.49 | Inferred (different platform/region/era, unconfirmed which) | Multiple independent search-summary paraphrases, not iOS-sourced |
| Coin IAP tiers $0.99–$14.99 (iOS) | Confirmed | Coordinator, matched |
| Android installs ~1M–1.4M; rating ~4.2–4.3★ (~19–19.5K ratings) | Confirmed (approximate, snapshot-dependent) | apkcombo, appbrain, search summaries |
| iOS ratings much smaller (~150 ratings, ~4.8★) | Confirmed (approximate) | Search-summary of App Store data |
| Version history spans ≥1.4.x (2022) through 1.8.35 (Aug 2026) | Confirmed | Aggregated from apkcombo, appbrain, skich, uptodown, platinmods, iosgods, moddroid, apkgk snapshots |
| v1.8.18 (Nov 15, 2025) exact changelog text | Confirmed | Coordinator; matched independently |
| "Battle Mode" / "Card Mode" as named game modes | Unconfirmed / likely hallucinated by a summarizer | One pass only, not reproduced in a verbatim re-check |
| Map editor cap of "50 maps maximum" | Unconfirmed / likely hallucinated | One pass only, not reproduced elsewhere |
| Developer working on online mode / more complex sequel | Unconfirmed rumor | Single search-summary paraphrase, no primary source secured |
| GameFAQs FAQ (id 63829) and Neoseeker guide (id 250498) describe Island Empire | **False — different game** (Tap4Fun MMO) | Coordinator correction; content mismatch confirmed independently (Townhall/Embassy/league/gem content found when fetched) |
| Gamezebo "Island Empire Walkthrough" page content | **False match — same Tap4Fun MMO**, not this game | Content mismatch confirmed independently when fetched (quests, PvP spying, leagues, gems) |

---

## Open Questions

1. **Level-select/world-map mechanic.** Does the campaign use a single-file path where you "walk" a token between level nodes (as the task brief suggested, sourced from what turned out to be the wrong game), a free-jump grid of level icons, or something else? Not verified from any confirmed-authentic source. slytherdroid's complaint about level navigation being non-obvious is the only tangential, indirect data point.
2. **Random-map generator UI.** What options does the player actually see when starting a random map (size, island count, player count, seed, land density)? No source documents this.
3. **Map editor toolset.** What specific placeable elements exist (terrain brush types, city/unit/tree/wall placement, player-start assignment), and is there any size cap? Several candidate pages (apppage.net, appbrain.com, deeper minireview.io/skich.app content) were blocked by bot/CAPTCHA checks in this pass and were never successfully read.
4. **Map sharing/export.** Is there any code-based or file-based way to share a custom map between players, or is the editor strictly local/offline?
5. **Hex grid orientation** (flat-top vs. pointy-top) and **overall map silhouette conventions** (always a single island surrounded by water? Can a map contain multiple islands?) — unconfirmed; would require direct screenshot/gameplay-video inspection.
6. **Weekly challenge mechanics** — rotation cadence/source of new maps, whether there's a leaderboard, and what (if anything) is awarded.
7. **AI "personality" or named difficulty labels** (Easy/Normal/Hard was inferred as the likely naming convention but never seen quoted directly from the game's own UI).
8. **Status of the rumored online mode / sequel** — no shipped evidence as of the Aug 2026 changelog entries collected; treat as unconfirmed.
9. **Exact star-award rule** — is it 1 star per difficulty tier beaten (→120 total is exact), or a more granular per-level 1–3 star system that happens to cap near 120? Not confirmed.
10. Several potentially useful primary sources could not be retrieved in this pass due to bot detection/CAPTCHA/403s and should be retried with a real browser session if higher-fidelity data is needed: `apppage.net/preview/com.hbrz.wodan`, `www.appbrain.com/app/island-empire-build-conquer/com.hbrz.wodan`, `www.neoseeker.com` (though now known to be the wrong game and not worth retrying), `minireview.io/strategy/island-empire-turn-strategy` (full article, beyond the partial paraphrase obtained), and the YouTube gameplay videos found (`V46ji1xTSW4`, `8FN22pM9ydI`, `qPbz7KPYs_o`, `CgKQDNMcWPI`) — none of which yielded usable transcript/description text via text-only fetch.

---

## Sources

**Primary store listings**
- Google Play: https://play.google.com/store/apps/details?id=com.hbrz.wodan&hl=en_US
- Apple App Store: https://apps.apple.com/us/app/island-empire-build-conquer/id1552391458
- Apple App Store (developer page): https://apps.apple.com/us/developer/michael-haberzeth/id1181364084

**Reviews / editorial**
- Slyther Droid review: https://slytherdroid.com/island-empire-review/
- MiniReview.io: https://minireview.io/strategy/island-empire-turn-strategy (partial access only)
- MiniReview.io "60+ Games Like Antiyoy Classic" (Island Empire comparison entry, accessed via search summary only): https://minireview.io/strategy/antiyoy-classic/games-like
- AppGrooves listing (accessed via search summary only, direct fetch failed — DNS error): https://appgrooves.com/app/island-empire-turn-based-strategy-by-michael-haberzeth

**Mirror / APK / aggregator sites (store-copy mirrors, changelogs, ratings)**
- Skich.app: https://skich.app/games/island-empire
- Qoo-App: https://m-apps.qoo-app.com/en-US/app/20826
- AppBrain: https://www.appbrain.com/app/island-empire-build-conquer/com.hbrz.wodan (blocked; accessed via search summary only)
- ApkCombo: https://apkcombo.com/island-empire-build-conquer/com.hbrz.wodan/
- ApkPure: https://apkpure.com/island-empire-turn-strategy/com.hbrz.wodan
- ApkPure version history: https://apkpure.com/island-empire-turn-strategy/com.hbrz.wodan/versions (blocked; accessed via search summary only)
- Malavida: https://www.malavida.com/en/soft/island-empire/android/
- BlueStacks (PC/emulator listing): https://www.bluestacks.com/apps/strategy/island-empire-turn-based-on-pc.html
- CafeBazaar: https://cafebazaar.ir/app/com.hbrz.wodan?l=en
- Apptopia (mostly inaccessible content): https://apptopia.com/google-play/app/com.hbrz.wodan/about
- ApppageNet (blocked/CAPTCHA): https://apppage.net/preview/com.hbrz.wodan

**Mod / community forums (limited, mostly install-link threads)**
- Platinmods thread: https://platinmods.com/threads/island-empire-strategy-ver-1-8-21-1-mod-apk-unlimited-money-complete-game-no-ads.250664/
- iOSGods thread: https://iosgods.com/topic/211905-island-empire-strategy-v18311-unlimited-coins-dlc

**Genealogy reference (Slay / Antiyoy — background only, not confirmed to apply to Island Empire)**
- Slay (Wikipedia): https://en.wikipedia.org/wiki/Slay_(video_game)
- Antiyoy official source (yiotro/Antiyoy README): https://github.com/yiotro/Antiyoy/blob/master/README.md
- Antiyoy modernized/RL fork with documented procedural generator (chelokot/antiyoy): https://github.com/chelokot/antiyoy

**Sources checked and found to be for a different, unrelated game (Tap4Fun's "Island Empire" MMO) — excluded from all facts above**
- https://gamefaqs.gamespot.com/iphone/636101-island-empire/faqs/63829
- https://www.neoseeker.com/island-empire/faqs/250498-walkthrough.html
- https://www.gamezebo.com/walkthroughs/island-empire-walkthrough/

**Sources attempted but inaccessible in this research pass (bot-check/CAPTCHA/403/DNS failure — not usable, listed for follow-up)**
- https://gamefaqs.gamespot.com (also excluded per above, doubly moot)
- https://www.chaptercheats.com/cheat/android/559803/island-empire-turn-strategy/video-walkthrough/360424 and .../360441 (pages exist but contain no extractable walkthrough text, only video-embed placeholders)
- https://appadvice.com/app/island-empire-strategy/1552391458 (DNS resolution failure)
- YouTube videos referenced via search but not successfully read for transcript/description: watch?v=V46ji1xTSW4, watch?v=8FN22pM9ydI, watch?v=qPbz7KPYs_o, watch?v=CgKQDNMcWPI
