# Island Empire (HBRZ-Developer) — UX / UI Flow Research

> **Correction (coordinator, 2026-09-21):** this lane worked from text sources and assumed a HEX grid from the Slay/Antiyoy genealogy. Direct inspection of the official screenshots and walkthrough frames shows Island Empire uses a **square grid with 4-neighbour adjacency**. Read every "hex" below as "tile"; the consolidated, screenshot-verified facts are in `06-research-brief.md`, which overrides this file wherever they differ.


**Scope of this document:** how the game plays moment to moment — screens, controls, gestures, HUD, feedback, tutorialization. Visual/art style is intentionally out of scope (covered elsewhere). Where Island Empire specifics could not be confirmed, the equivalent **Slay/Antiyoy** mechanic is given and explicitly labeled **[genealogy]** — Island Empire is a direct descendant of Sean O'Connor's *Slay*, via the open-source *Antiyoy* (github.com/yiotro/Antiyoy) lineage of hex area-control games.

Developer: Michael Haberzeth (solo dev, "HBRZ-Developer" / hbrz.developer@gmail.com). Android package `com.hbrz.wodan`; iOS id 1552391458, "Island Empire: Build & Conquer." Tagline on the App Store: **"No luck, no money, no upgrades. Only your skill counts."**

---

## Summary

Island Empire is a solo-dev, offline-first, turn-based hex strategy game in the Slay/Antiyoy tradition: you own contiguous "provinces" of hex tiles that generate income each turn, and you spend that income on units (soldiers), walls, and farms to expand, defend, and out-economy AI or human opponents. Confirmed UX facts are sparse in secondary sources because most coverage (store listings, aggregator sites, APK mirrors) repeats marketing copy rather than describing controls; the richest primary evidence found was the developer's own **version-history changelog** (which repeatedly patches specific UI elements — the tutorial, a "one-click-move" toggle, field-highlighting graphics, a money/income display, and a "Superiority UI"/king win-condition screen) and one third-party review (Slyther Droid) that specifically criticized the level-select overworld's navigation. No full screenshots, no playable build, and no complete official rulebook text were retrievable through web search/fetch in this session — GameFAQs guide id 63829 under this URL is confirmed to belong to a **different, unrelated game** (Tap4Fun's 2011 MMO "Island Empire") and has been excluded entirely, as has a Gamezebo "walkthrough" that describes fisheries/lumber mills/warehouses/ports — those are Tap4Fun's city-builder, not HBRZ's hex strategy game, and must not be cited for this project.

Because primary UI documentation is thin, most of the moment-to-moment interaction detail below is reconstructed from (a) HBRZ's own changelog entries, which name real screens/features, (b) the Slyther Droid review's direct observations of play, and (c) Slay/Antiyoy genealogy, clearly flagged.

---

## Screen-by-screen walkthrough

### 1. Title / main menu
Not directly documented. Store copy implies a top-level menu leading to: Campaign, Random Map, Multiplayer, Map Editor, Weekly Challenge, Shop/Skins, Settings. *(Confidence: low — inferred from feature list, not observed directly.)*

### 2. Campaign world map / level-select ("overworld")
Confirmed by the Slyther Droid review: level selection is **not** a menu grid but a literal walk. Quote: players must **"tap to slowly move your character to each level in a single-file path,"** which the reviewer found tedious for revisiting earlier levels, suggesting **"a level list or perhaps if they were grouped into chapters you could jump between"** as a fix. This implies:
- A small avatar/token sits on an island overworld map.
- Tapping a point ahead on the path animates the avatar walking there, tile by tile (not an instant jump).
- Levels are arranged in a single linear sequence per island (campaign spans multiple islands — "all 3 islands" plus an "Island X" DLC/bonus set referenced in search results and a YouTube video titled "Island Empire - MapX Level8 Playthrough").
- No shortcut/level-list jump existed at review time (2022-era); unclear if later updates (up to current v1.8.35) added one.

*(Confidence: medium-high for the walk-to-select mechanic itself — directly quoted from a review that played the game; low for whether a level-list shortcut was later added.)*

### 3. Level intro / pre-level screen
Not directly documented for Island Empire. Confirmed to exist in some form: a **difficulty selector** per level — Slyther Droid: **"Three selectable difficulty tiers per level"** (matches an App Store aggregator's "Easy, Hard, Hardcore" description). *(Confidence: medium.)*

### 4. In-game screen
This is the core play screen: a hex map showing province ownership by player color, with a persistent HUD (see HUD section) and a unit/building "shop" for spending income. Confirmed mechanics from changelog + review evidence:
- **Territory/income:** "the more ground you claim, the higher your income climbs" (bluestacks marketing copy, consistent with Slay-style income-per-tile).
- **Buying units/buildings:** review confirms you "spend that money on knights to conquer more land," and can "invest currency in new units to up your army's strength, build protective walls around your cities, or drop down farms for even better cash flow." This describes a shop of at least three purchasable things: **units (knights), walls, farms.**
- **Upkeep:** confirmed via minireview.io paraphrase: **"each unit and structure under our control requires a steady upkeep that gets deducted from our gold reserve on each turn."** Failing to pay upkeep has consequences — Slyther Droid: **"if you don't have enough farms or territory in one section, your army will fall apart and disband."** minireview.io adds that under-funded regions can become **cut off and turn into separate breakaway kingdoms**, opening a "divide and conquer" opportunity for the opponent.
- **Field highlighting:** a changelog entry (v1.8.17.1 / v1.8.18) explicitly says the game gives **"Moveable-, Buildable-, Upgradable- field[s] got new graphic"** — i.e., legal-move/legal-build tiles are visually marked with distinct graphics (this is the closest primary-source confirmation of "legal moves highlighted").
- **One-click-move:** a dedicated toggle exists. Changelog history: added in v1.8.7.1 ("One-Click-Move feature added"), set to **default deactivated** in v1.8.7.2, then reconfirmed **"deactivated by default"** again in v1.8.17.1/v1.8.18. This means the default interaction is presumably tap-to-select-unit, then tap-destination (two taps), while an optional "one-click move" mode lets a single tap move the currently-selected/last unit directly — this is a real, named, toggleable control scheme, not inferred.
- **Money/income display revision:** the same v1.8.17.1 changelog entry lists **"new graphic[s]"** for a **money alert** and a **revised income layout**, i.e., there is an on-screen money display and some kind of low-funds/bankruptcy alert graphic that HBRZ specifically redesigned.
- **Merging units:** confirmed via minireview.io paraphrase and independent web search corroboration: **"a key mechanic allows merging two units to create higher-tier warriors"** — i.e., combining two same-level units produces a stronger unit, consistent with Slay/Antiyoy's unit-tier system (level 1–4 units, moving one onto a friendly same-level unit upgrades it).
- **Undo:** no confirmed evidence either way for Island Empire. *(Confidence: none — flagged as open question below.)*
- **Combat resolution:** minireview.io: "hiring warriors, moving them strategically, and attacking enemy troops of matching levels" — attack requires level parity/superiority, matching Slay/Antiyoy's rule that a unit can only conquer a hex defended by an equal-or-lower-level unit.
- **Win condition — "Superiority" / king:** changelog entries reference bugfixes for **"Superiority-Win with king"** and **"Superiority UI"** (v1.8.6.2 era), meaning there is a specific king unit and an alternate win condition (economic/territorial "superiority" rather than outright elimination) with its own UI screen. Exact trigger/threshold not confirmed.
- **Skins:** a changelog bugfix references "skins" (cosmetic, confirmed to exist as "unlockable skins for your civilization" per store copy) — implies a shop/customization screen, separate from the unit shop.

### 5. Pause menu
Not directly documented. Presumed to exist (standard for the genre) with settings/quit/restart options. *(Confidence: none — unconfirmed.)*

### 6. Victory / defeat screen
Not directly documented in detail. Confirmed indirectly: a "Cup position fixed" changelog bugfix (v1.8.12) suggests a trophy/cup icon appears somewhere in a results or menu screen, but its exact context (per-level rating? campaign completion?) is unconfirmed. Review quotes ("I just beat the game and feel a little empty," "Just completed all 3 islands!") confirm there is a definite campaign-completion state players reach and react to. *(Confidence: low on specifics, medium that *some* end-state screen exists.)*

### 7. Settings screen
Confirmed to include (from changelog): a one-click-move on/off toggle, language options (Arabic language bugfix referenced), ad-related settings (ad localization bugfix), ad-removal / ad-free options. *(Confidence: medium — pieced together from changelog bugfixes rather than a direct settings-screen description.)*

### 8. Shop / skins screen
Confirmed to exist as a distinct concept from the in-level unit-shop bar: "unlockable skins for your civilization," in-app purchases at $0.99–$14.99 including a "full game unlock" ($8.99) and "ad removal" ($2.99). *(Confidence: medium.)*

### 9. Map editor
Confirmed to exist ("Map editor for custom gameplay" / "Mapeditor" in feature lists) but no interaction details (drag-to-paint terrain? tile picker?) were retrievable. *(Confidence: existence confirmed, mechanics unconfirmed.)*

### 10. Multiplayer setup (local)
Confirmed: local multiplayer for "up to 8 players" (current store copy) — earlier/other listings say "up to 6 players," which may reflect a version difference over time (older APK-mirror listings show 6, current Apple/Google copy says 8). No confirmation of whether this is pass-and-play/hotseat (each player takes a full turn passing the device) or simultaneous/local-network; hotseat is the standard implementation for this genre and is the reasonable inference given "local multiplayer" phrasing and no mention of Wi-Fi/network play. *(Confidence: player count confirmed but inconsistent across sources/versions; turn-passing structure inferred, not confirmed.)*

### 11. Random map setup
Confirmed to exist ("Random maps... for endless replayability") but generator options (island size, player count, seed) not documented in any retrievable source.

### 12. Weekly challenge screen
Confirmed to exist ("Weekly challenges with fresh levels" — current store copy) with a "rating" of some kind (Apple-store scrape mentioned "Weekly challenge ratings" as a UI element, though this may be an AI-summarization artifact rather than a verbatim feature name — treat as low confidence).

---

## Interaction table

| Action | Gesture / control | Feedback | Confidence | Source |
|---|---|---|---|---|
| Move avatar between campaign levels on overworld | Tap ahead on a single-file path | Avatar animates walking tile-by-tile toward the tapped point | High | Slyther Droid review (direct quote) |
| Select a province / unit in-level | Tap the hex | (unconfirmed exact feedback — presumed highlight, per genre convention) | Low (inferred) | Genealogy [Slay/Antiyoy] |
| See legal move/build/upgrade destinations | Automatic after selection | Distinct highlighted graphic for "Moveable," "Buildable," "Upgradable" fields (named, redesigned in a changelog entry) | Medium-high | HBRZ changelog v1.8.17.1/1.8.18 |
| Buy a unit / wall / farm | Tap the item in an in-level shop, spending gold; exact placement gesture (drag vs. tap-then-tap) unconfirmed for Island Empire specifically | Gold total decreases; unit/structure appears on the target hex | Medium (purchase confirmed) / Low (exact gesture) | minireview.io, Slyther Droid; genealogy for gesture detail |
| Move a unit | Two-tap by default: tap unit, then tap destination. Alternative single-tap "One-Click-Move" mode exists as a toggleable setting (added v1.8.7.1, default OFF since v1.8.7.2/confirmed again v1.8.18) | Unit relocates; province may split/merge with adjacent territory | High (mode's existence/default) / Medium (exact default gesture inferred from toggle's framing) | HBRZ changelog |
| Merge two units | Move one unit onto a friendly unit of the same level (genealogy) | Produces a single higher-tier unit | Medium | minireview.io paraphrase + Slay/Antiyoy genealogy |
| Attack an enemy hex | Move a unit onto an enemy-held hex of equal or lower unit level | Enemy unit/structure destroyed, hex captured, income recalculated | Medium | minireview.io ("attacking enemy troops of matching levels") |
| Pay upkeep | Automatic each turn-end, deducted from gold reserve | If insufficient: units die / territory disconnects into a new breakaway "kingdom" | Medium-high | minireview.io, Slyther Droid ("army will fall apart and disband") |
| Low-funds / bankruptcy warning | Automatic | A dedicated "money alert" graphic (redesigned in changelog) | Medium (existence) / Low (exact trigger/visual) | HBRZ changelog v1.8.17.1 |
| End turn | Unconfirmed button/placement for Island Empire specifically | Triggers AI/other players' turns | None confirmed (Low) | Genealogy only [Slay/Antiyoy: dedicated "End Turn" button, typically bottom-right] |
| Undo a move | Unconfirmed for Island Empire | — | None confirmed | — (open question) |
| Win via elimination or "Superiority" | Automatic once win condition met; a king unit and a "Superiority UI" screen are involved | Distinct victory UI referenced in bugfix history ("Superiority-Win with king," "Superiority UI") | Medium (existence) / Low (mechanics) | HBRZ changelog v1.8.6.2 era |
| Change settings (one-click-move, language, ads) | Settings screen, toggles | Immediate effect on control scheme / display | Medium | HBRZ changelog |
| Zoom / pan camera | Unconfirmed for Island Empire; a bugfix "Don't move unit at scroll" implies scrolling/dragging the map was previously colliding with unit-move taps, and "Change Map by swipe at Homescreen" implies swipe gestures are used for map/level navigation | Camera pans; fixed version no longer misfires a unit move during a scroll | Medium (existence of scroll-vs-move conflict, now patched) | HBRZ changelog (WebSearch snippet) |
| Play local multiplayer | Presumed pass-and-play/hotseat, up to 6–8 players depending on version | Turn passes to next player on same device | Low-Medium (player count varies 6 vs. 8 across sources) | Store listings (inconsistent) |

---

## HUD (in-level)

Directly confirmed elements:
- **Money/gold total**, with a redesigned display ("income layout" revision, "money alert" graphic) — v1.8.17.1 changelog.
- **Legal-tile highlighting overlay** (moveable/buildable/upgradable fields) — v1.8.17.1/1.8.18 changelog.
- **Player-color territory rendering** on the hex map (implied by "player color" being how ownership is shown; not independently confirmed but standard to the genre and implied by all marketing screenshots referenced, which were not retrievable as images in this session).

Not confirmed but expected per genre convention (Slay/Antiyoy) — **[genealogy, not observed]**:
- Turn counter
- End-turn button (bottom-right in Antiyoy)
- Menu/pause button
- Current player indicator
- Per-province income/unit-cost tooltip on tap-and-hold

---

## Tutorial

Strong evidence the campaign's earliest levels function as an enforced tutorial:
- A search result explicitly notes: **"Level 1-5 Tutorial has been optimized and made mandatory"** — i.e., the developer changed it from skippable to mandatory at some point, implying it was previously possible (and apparently common enough to warrant a fix) for players to skip the tutorial and get lost. This is corroborated by a changelog bugfix line: **"bugfixes for skipping tutorial... Level5 Tutorial."**
- The v1.8.17.1/1.8.18 changelog separately lists a **"revised tutorial"** as its own line item, distinct from the "Level optimized" line, suggesting the tutorial's instructional content (not just level layout) was rewritten.
- minireview.io (paraphrased): **"gradually the game introduces its mechanics through a series of engaging campaign levels. Step by step, we learn of its tactical intricacies"** — i.e., no separate rules-explainer/manual screen; rules are taught level-by-level through the campaign, consistent with the Slay/Antiyoy design tradition of teaching via scripted early levels rather than text tutorials.
- No exact in-game tutorial text/dialogue was retrievable through web search — the actual wording of tutorial popups is an open question.

---

## Feedback (sounds, animations)

Almost no direct evidence retrievable. Confirmed only:
- Soundtrack exists, composed by Matthew Pablo, described by marketing copy as providing "immersive and catchy tunes" (this is about music, not situational SFX — out of scope but noted since it's the only audio fact found).
- Visual feedback on territory fragmentation: Slyther Droid explicitly calls out **"visual feedback on territory splitting when empires fragment"** — when an under-funded/cut-off section of a player's territory breaks away into an independent AI-controlled area, this is shown on-screen distinctly (exact animation/color-change mechanism not described).
- No confirmed detail on: capture animation, unit-death animation/sound, bankruptcy sting, city/capital destruction sequence. **[Open question — see below.]**

---

## Quoted in-game rule text

None of the sources fetched in this session contained verbatim in-game tutorial or help-screen text (no screenshots or transcripts of the actual tutorial dialogue were retrievable). The only verbatim first-party copy recovered is marketing/store text:
- **"Island Empire is a captivating turn-based strategy game that's easy to learn but challenging to master."**
- **"No luck, no money, no upgrades. Only your skill counts."**
- **"Each turn, you can choose whether you want to advance your army to gain ground or produce new units."** (paraphrase source, not confirmed 100% verbatim to the app's own copy — flagged)

Changelog lines (verbatim from search snippets, high confidence these are near-exact developer changelog wording):
> "Level optimized. One-click-move deactivated by default. Moveable-, Buildable-, Upgradable- field got new graphic." (v1.8.18, Nov 2025)

> "Moveable-, Buildable-, Upgradable- field got new graphic" + level optimizations, one-click-move deactivated by default, new money-alert graphics, revised income layout, tutorial revisions, bugfixes for skipping tutorial, ad localization, first click in game, and Level5 Tutorial (v1.8.17.1)

> "Cup position fixed" (v1.8.12)

> "UI optimization, better error log" + bugfixes for "superiority-win with king," skins, Arabic language (v1.8.6.2)

> "One-Click-Move feature added" (v1.8.7.1); "One-Click-Move default deactivated" (v1.8.7.2)

---

## Player reviews on UX

- **Slyther Droid (8/10, "strong controls" score)**: praised the mechanics as "simple to grasp," praised the incremental teaching ("step by step, we learn of its tactical intricacies" — paraphrased across sources), but explicitly criticized overworld level-select navigation as clunky/tedious ("tap to slowly move your character to each level in a single-file path"), recommending a level list or chapter groupings instead. Also flagged that even the easiest of three difficulty tiers "still feels tough."
- **App Store reviews** (via scrape): generally positive, "extremely dynamic," one player completed "all 3 islands" and asked for more content; feature requests included cloud saves (iCloud sync), online multiplayer, a hardcore difficulty mode, and a score/competitive system — suggesting the existing difficulty/mode options, while present, aren't felt to be enough for veteran players.
- No Reddit threads specifically about Island Empire (HBRZ) were found via search in this session — the game does not appear to have meaningful Reddit discussion presence.
- No TouchArcade coverage found (TouchArcade itself ceased operating in Sept 2024, per search).

---

## YouTube

Searched "Island Empire hbrz gameplay" and related terms. Relevant videos identified (titles/existence confirmed via search; full transcripts/descriptions were **not** retrievable — YouTube's page content did not expose description text to the fetch tool in this session):
- **"[Android] Island Empire - Turn based Strategy - HBRZ-Developer"** — youtube.com/watch?v=V46ji1xTSW4 (appears to be either an official trailer or an early reviewer video; full description not retrievable).
- **"Island Empire - Strategy. Levels 1-5. Walkthrough."** — youtube.com/watch?v=z4-EUwGFnc0 (published Aug 28, 2022) — a straightforward level walkthrough, part of a full playlist (youtube.com/playlist?list=PL65oiWAfzGm6qus3i5CmnG4AtzStP7HIO) covering the whole campaign level-by-level. Likely the single best available "watch the actual UI" resource, but could not be transcribed via the tools in this session.
- **"Island Empire - Strategy. Level 15. Walkthrough."** — youtube.com/watch?v=fl9G_Adcgbs
- **"Island Empire - MapX Level8 Playthrough"** — youtube.com/watch?v=qPbz7KPYs_o (confirms "Island X" is a distinct map/bonus campaign referenced elsewhere as DLC).
- ChapterCheats.com hosts a 21-part embedded video-walkthrough index (chaptercheats.com/cheat/android/559803/island-empire-turn-strategy/video-walkthrough/), levels 1–5 through higher levels, sourced from the same or a similar YouTube walkthrough series — useful as a level-by-level index if visual review is later needed.

**Recommendation for a follow-up pass:** these videos should be opened directly (not via text-fetch) if actual on-screen UI needs to be observed — this session's tooling could retrieve titles/existence but not frame content or transcripts.

---

## Open questions

1. **Exact buy/place gesture** — is buying a unit "tap shop icon, then tap destination hex" or "drag icon onto hex"? Not confirmed for Island Empire; both are plausible extensions of the confirmed two-tap move pattern, but no source states it directly.
2. **Exact move gesture under default (non-one-click) mode** — confirmed a toggle exists and defaults to "off," but the *specific* default gesture (tap-tap vs. drag) is inferred, not quoted.
3. **End-turn control** — no source at all confirms button placement, label, or whether ending turn requires confirming pending purchases/moves.
4. **Undo** — entirely unconfirmed either way.
5. **Pause menu contents** — unconfirmed.
6. **Camera controls** — pinch-to-zoom not directly confirmed; only inferred from a "Don't move unit at scroll" bugfix (implying scroll/drag existed and once conflicted with unit-move taps) and a "Change Map by swipe at Homescreen" feature note (implying swipe navigation on some menu/overworld screen).
7. **"Cup" UI element** — appears in a changelog bugfix ("Cup position fixed," v1.8.12) with no explanation of what it represents (trophy for level rating? campaign-completion icon? multiplayer scoring?).
8. **Local multiplayer player-count discrepancy** — some listings say up to 6, current official store pages say up to 8; unclear if this changed over versions or is inconsistent copy.
9. **Enemy-turn animation** — completely unconfirmed (does the camera follow AI moves, or resolve silently and show a result?).
10. **Superiority/king win condition mechanics** — confirmed to exist (dedicated UI + bugfixes) but exact trigger, threshold, and screen layout unconfirmed.
11. **Weekly Challenge screen specifics** — "ratings" mentioned once in an AI-summarized scrape; could not verify wording, may be an artifact of the summarization rather than real UI copy.
12. **Actual verbatim tutorial/help text** — never recovered; would require either playing the game directly or transcribing the YouTube walkthrough videos.

---

## Sources

- [Google Play Store listing](https://play.google.com/store/apps/details?id=com.hbrz.wodan&hl=en_US) — description, feature list (fetches were repeatedly truncated by the fetch tool; only partial text recovered)
- [Apple App Store listing](https://apps.apple.com/us/app/island-empire-build-conquer/id1552391458) — full description, feature list, latest version notes, customer review excerpts
- ~~GameFAQs guide (gamefaqs.gamespot.com/iphone/636101-island-empire/faqs/63829)~~ — **excluded: confirmed to be for a different, unrelated game (Tap4Fun's 2011 MMO "Island Empire"), not HBRZ's hex strategy game. Do not cite.**
- [Slyther Droid review](https://slytherdroid.com/island-empire-review/) — direct, played-the-game review; source of overworld navigation critique, difficulty tiers, upkeep/disband mechanic, territory-split visual feedback, 8/10 controls score
- [MiniReview.io](https://minireview.io/strategy/island-empire-turn-strategy) — review with upkeep, merge-unit, and campaign-as-tutorial details (note: paraphrase described the grid as "square"; Island Empire is hex-based per the task brief, so this specific detail is treated with caution)
- ~~apppage.net preview~~ — inaccessible (bot-check wall / 402 via all fetch methods tried)
- ~~skich.app~~ — accessible but only generic marketing copy, no UX specifics
- [BlueStacks PC listing](https://www.bluestacks.com/apps/strategy/island-empire-turn-based-on-pc.html) — marketing copy including "no timers pushing you along," territory/income mechanic description
- [Uptodown Android listing](https://island-empire.en.uptodown.com/android) — merge/fusion system description, "each turn choose to advance army or produce units" gameplay-loop line
- [AppBrain listing](https://www.appbrain.com/app/island-empire-turn-strategy/com.hbrz.wodan) — feature list, partial version history
- [ApkCombo listing](https://apkcombo.com/island-empire-strategy/com.hbrz.wodan/) / [ApkCombo build-conquer listing](https://apkcombo.com/island-empire-build-conquer/com.hbrz.wodan/) — version list (limited changelog text exposed)
- [apk.watch v1.8.17.1 page](http://island-empire-turn-strategy.apk.watch/1.8.17.1) and related WebSearch snippets — richest source of verbatim changelog text (one-click-move, field-highlight graphics, tutorial revisions, superiority/king win condition, "Cup position fixed")
- [YouTube: "[Android] Island Empire - Turn based Strategy - HBRZ-Developer"](https://www.youtube.com/watch?v=V46ji1xTSW4)
- [YouTube: "Island Empire - Strategy. Levels 1-5. Walkthrough."](https://www.youtube.com/watch?v=z4-EUwGFnc0) and [full walkthrough playlist](https://www.youtube.com/playlist?list=PL65oiWAfzGm6qus3i5CmnG4AtzStP7HIO)
- [YouTube: "Island Empire - Strategy. Level 15. Walkthrough."](https://www.youtube.com/watch?v=fl9G_Adcgbs)
- [YouTube: "Island Empire - MapX Level8 Playthrough"](https://www.youtube.com/watch?v=qPbz7KPYs_o)
- [ChapterCheats video-walkthrough index](https://www.chaptercheats.com/cheats/android/559803/island-empire-turn-strategy-cheat-codes) — 21-part level index, video content not transcribable via available tools
- [AppGrooves listing](https://appgrooves.com/app/island-empire-turn-based-strategy-by-michael-haberzeth) — found via search only, direct fetch failed (DNS)
- Antiyoy genealogy (referenced for unconfirmed mechanics, not directly fetchable this session — fandom wiki pages returned HTTP 402 via all fetch paths tried): [github.com/yiotro/Antiyoy](https://github.com/yiotro/Antiyoy), [Antiyoy Wiki — Units](https://antiyoy.fandom.com/wiki/Units), [Antiyoy Wiki — Moving provinces](https://antiyoy.fandom.com/wiki/Moving_provinces), [Antiyoy Wiki — Beginner's guide](https://antiyoy.fandom.com/wiki/Beginner's_guide) — summarized from WebSearch snippets only: units created by tapping a province then tapping a unit icon at the bottom of the screen (repeated taps cycle through unit types), map dims except highlighted legal hexes, a unit can move up to 4 hexes per turn provided all but the last are the player's own province, purchase/upkeep cost scale with unit tier.
