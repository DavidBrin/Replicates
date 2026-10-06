# RISK: Global Domination — UX Flow, Modes & In-Game Dialog Research

Scope note: this covers **RISK: Global Domination**, the 2019+ mobile/Steam/Switch game by **SMG Studio** (published with Hasbro/Marmalade, appid 1128810 on Steam), *not* the unrelated 2003 PS2/GameCube Atari/Cyberlore game that also carries the "RISK: Global Domination" title (that older game has its own "Generals" AI cast — George Washington, Catherine the Great, Napoleon, etc. — which is **not part of the SMG Studio game** and must not be imported into this replica). All claims below are about the SMG Studio game unless explicitly marked otherwise.

Research method: text-only (WebSearch + WebFetch) against SMG Studio's own Freshdesk support/FAQ site (`smgstudio.freshdesk.com`), the Steam store page and Steam Community discussions/announcements for appid 1128810, the `risk-global-domination.fandom.com` wiki (via search-engine snippets — the site itself returns a bot-check wall to a plain fetcher), app-store listings, and third-party guide sites (SteamAH, LevelWinner, duxaris.com). No browser tool was used, per instructions. Confidence is marked per claim: **[Official]** = SMG Studio's own support site or store copy, **[Patch/News]** = an SMG Studio Steam announcement, **[Community]** = players/Steam discussions (reliable for "this exists" but not always exact UI text), **[Guide]** = third-party strategy site, **[Unconfirmed]** = could not get a verbatim primary source, treat as a lead to verify in-app before locking the replica's copy.

---

## 0. What SMG Studio says the game *is*

Official app-store description (iOS listing), verbatim: "The battle for world domination begins now! Battle opponents in strategic warfare in the official digital version of the classic Hasbro board game loved by millions. Fight against the Axis Powers in WWI, survive war games against undead zombies and battle on fantasy, futuristic and sci-fi maps." Feature bullets: "Build an army to clash against your foes," "Use diplomacy to gain allies and fight to the death for blood and honor," "Command your troops on the battlefield," "Protect your allies & conquer your enemies," "Play with friends," "Battle in Real-Time," "Classic & Custom Rules," "Solo & Multiplayer Games," "Play 110+ Maps," "Compete Against Millions of Players," "Climb the Ranks to Grandmaster." [Official] (Apple App Store listing, https://apps.apple.com/us/app/risk-global-domination/id1051334048)

Steam store copy (paraphrased by fetch, treat wording as approximate): "the official digital version of the classic Hasbro board game," "a true test of wartime strategy, negotiation, and domination," rule variations include "Blizzards, Portals, Fog of War, Zombies, Secret Assassin, and Secret Missions," progression lets players "climb the ranks" to "Grandmaster tier," and "This game is NOT Pay to Win. All purchases unlock new maps or cosmetics." [Official] (https://store.steampowered.com/app/1128810/RISK_Global_Domination/)

SMG Studio developed the digital ruleset with Hasbro over a year, comparing the 1993, 2003, and 2010 official Hasbro rulesets, and landed on "the best combination of the 1993 and 2003 rules, which are very similar." [Official] (https://smgstudio.freshdesk.com/support/solutions/articles/11000025091-is-risk-global-domination-based-on-official-rules-)

---

## 1. Main menu / home

Confidence is lower here than elsewhere — no primary source gave a clean enumerated button list, so this section is assembled from scattered confirmations. **Flag for in-app verification before locking replica copy.**

Confirmed-to-exist top-level destinations, triangulated across sources:
- **Single Player** (vs. bots) [Official/Guide]
- **Pass & Play** (local hot-seat, 2–6 players on one device) [Official] (Steam store feature list, https://risk-global-domination.fandom.com/wiki/Steam_Version_Details via search snippet)
- **Online** play — includes both **ranked/"Global Domination online"** matchmaking and **"Play Friends online"** (custom/private games) [Community] (search snippet of fandom "Steam Version Details": "Global Domination online, Play Friends online, Single Player, and Pass & Play")
- A **"BATTLE"** button has been described as present on the home screen [Community] (Steam discussion "Suggestion - UI redesign for the Steam version," https://steamcommunity.com/app/1128810/discussions/0/1743393963179713334/)
- **Shop/Store** — sells gems, map packs, dice skins, avatars, troop counters, emotes, frames [Official-adjacent] (fandom "Gems"/"Tokens and Premium" pages via search snippet)
- **Settings** — includes Gameplay sub-section with toggles for Camera Animations, Phase Change Animations, End Phase Confirmation (see §3), and (per community reports) a colorblind accessibility option [Community] (https://steamcommunity.com/app/1128810/discussions/0/2259060982451078510/, https://smgstudio.freshdesk.com/support/discussions/topics/11000009603)
- **Profile** — reachable at Settings > Profile > Change Profile Name for editing your display name [Official] (https://smgstudio.freshdesk.com/support/solutions/articles/11000047524-how-can-i-change-my-risk-name-)
- **Friends** — add-friend flow via a green smiley "add friends" icon, or by sharing/entering a Player ID / Friend ID (format like `37VGVCCC`) [Official] (https://smgstudio.freshdesk.com/support/solutions/articles/11000024973-how-do-i-add-friends-in-risk-, https://smgstudio.freshdesk.com/support/solutions/articles/11000024869-how-d-i-find-my-friend-s-risk-game)
- **News/Events** — Steam Community "Announcements"/"Events & Announcements" feed is used for patch notes, seasonal rewards, and the rotating "community expression" chat-line vote (see §5) [Patch/News]
- A daily/seasonal login-reward system exists (e.g., a free "Jack-O-Lantern Dice" Halloween login reward) [Patch/News] (Steam news search snippet, no stable URL recovered — **Unconfirmed** exact mechanic)

**Home-screen "card" content** (triangulated, not a single verbatim source): player name/avatar, a visible **rank/class name** (see §6 — Novice/Beginner/Intermediate/Expert/Master/Grandmaster) and numeric rank points, and the gems/tokens currency balance (see below). [Community]

**Economy / monetization layer (TRIM for replica):**
- **Gems** — premium currency, buys map packs, dice skins, avatars, troop counters, emotes, frames. 2 free gems/day claimable in-store; Prime Gaming has given free gem bundles. [Official-adjacent] (fandom "Gems" page via search snippet)
- **Tokens** — a play-count gate: 5 tokens spent to start an offline (bot) game, 10 for an online game, 5 tokens refunded on an online win; a one-time **Premium Pack** purchase removes the token gate entirely (unlimited play). [Official-adjacent] (fandom "Tokens and Premium" page via search snippet)
- Cosmetic **DLC packs** exist, e.g., "RISK: Global Domination — Emotes Pack: The General" (Steam DLC) and a "Universal Domination Map Pack." [Patch/News] (https://store.steampowered.com/app/1330240/RISK_Global_Domination_Emotes_Pack__The_General/, https://store.steampowered.com/app/2385960/RISK_Global_Domination__Universal_Domination_Map_Pack/)
- Ranked **leagues/classes** (Novice → Grandmaster) exist and are explicitly a "for fun" progression system per SMG Studio, separate from any battle-pass (no evidence of a battle-pass/season-pass mechanic was found; treat as **not present**, likely because RGD monetizes via gems/maps/cosmetics instead). [Official]

**What the replica should TRIM:** gems/tokens economy, the Premium Pack play-gate, cosmetic shop (dice skins/avatar frames/troop counters), DLC map packs, ranked leaderboards tied to monetization. **What the replica should KEEP:** Single Player vs. bots, Pass & Play hot-seat, casual online play, Friends list via a shareable ID, a simple rank/class label for flavor (optional), Settings toggles for camera/animation speed.

---

## 2. Game setup screen

Creating a game is a two-step flow: pick a map, then tap a green **"Next"** button, which leads to the **"Modes and Modifiers"** screen (this exact UI label is used by SMG Studio's own support docs for both "Secret Assassin" and "Secret Missions" articles — "Players can access this mode through the 'Modes and Modifiers' screen when creating a game or joining existing lobbies"). [Official] (https://smgstudio.freshdesk.com/support/solutions/articles/11000135639-secret-missions)

To change bot difficulty specifically: "Tap the green Next button after selecting a map and tap on the Modifiers button on the bottom of the screen to open the Game Modifiers menu." [Official] (https://smgstudio.freshdesk.com/support/solutions/articles/11000024863-how-do-i-change-the-risk-computer-players-difficulty-)

### 2.1 Win-condition / game modes (chosen on this screen)

| Mode | What it does | Source |
|---|---|---|
| **World / Global Domination** (classic) | Conquer every territory on the map; last player standing wins; recommended default/beginner mode since eliminated players "have more time to recover" relative to faster modes. | [Guide] LevelWinner |
| **70% Domination** | Win by controlling 70% of the map's territories rather than all of it — "moderately faster match." A guide claims a specific example win-set (Africa, Europe, Asia, Oceania, Canada, part of the USA) but that is map-specific/approximate, not a hard rule. [Guide, partly Unconfirmed] |
| **Fast Blitz** | Fastest mode: whoever owns more territory than everyone else when Turn 5 ends wins — rewards aggression. [Guide] |
| **Capital Conquest / "Capitals"** | Each player is assigned a capital territory at game start; win by capturing every capital. Capitals defend with **3 dice instead of the usual 2**, and owning a capital grants **+2 troops every Draft Phase**. Based on 1993 "Capital RISK" rules. [Official + Guide] |
| **Zombie Apocalypse ("Zombies")** | World Domination plus an AI zombie faction. Zombies are not a cooperative/permanent kill — defeating them only "truly" ends when every human/AI player is defeated. Zombies get **no** continent/territory-count troop bonus, but **every territory they conquer infects (converts) half the defender's troops there, rounded up**, and zombie numbers/outbreaks scale with AI difficulty and round number. Progressive card bonuses are the suggested counter. Can only be **hosted by premium players** (older claim — verify if still gated). [Guide + Community] |
| **Secret Mission** | Each player gets a hidden objective (e.g., conquer two specific continents, eliminate a specific player) at game start; "Instead of trying to conquer the whole map, your goal is to complete your mission before anyone else." First to complete wins. **Not available in Ranked.** Selected from the Modes and Modifiers screen. [Official] |
| **Secret Assassin** | Each player is secretly assigned another player as their kill target; "The first player to eliminate their target wins." If your target is eliminated by someone else first, "that player becomes your new target" (target chain), so you can also be hunted. A "Secret Assassin Icon" lets you track your target's territories. [Official] |

### 2.2 Game Modifiers (toggles, with observed defaults from a beginner-guide's recommended settings table)

A beginner's-guide table gives these as a worked example of settings and their stated rationale — read as *example values*, not necessarily the shipped defaults:

| Setting | Guide's recommended value | Stated rationale (verbatim) |
|---|---|---|
| Manual Placement | On | "Helps selecting starting area/s" |
| Card Bonus | Fixed | "Fair chance of comeback" |
| Fog of War | On | "Focuses you only on the current n'hood" |
| Blizzards | On | "Increases the number of chokes/hinges" |
| Dice Rolls | Balanced Blitz | "Well, it's balanced" |

[Guide] (https://steamah.com/risk-global-domination-beginners-guide/)

Other confirmed modifiers (from Official + Guide sources), full list as best reconstructed:

- **Manual Placement** (On/Off) — **Off** (the apparent true default) skips the Claim Phase entirely; the game auto-assigns starting territories randomly and fairly. **On** adds an initial **Claim Phase** where players take turns placing their starting troops one at a time, letting everyone fight over contested spots. Community notes the player who places first can gain an advantage unless their opening spot is weak. [Official-adjacent/Community]
- **Card Bonus**: **Fixed** vs **Progressive**. Fixed: flat values per matched set — Infantry-only 3-of-a-kind = 4 troops, Cavalry 3-of-a-kind = 6, Artillery 3-of-a-kind = 8, one-of-each ("mixed"/wild set) = 10, capped at 12 max per trade-in including a territory bonus. Progressive: bonus climbs with each successive trade across the whole game — sequence **4 → 6 → 8 → 10 → 12 → 15 → 20 → 25 → 30 → 35 → 40 → 45 → 50 → 55 → 60** troops (one Official source frames the climb as "4-6-8-10-12-15-...+5 per set after"); a wild/Joker card can substitute for any of the three suit types in a set; if you hold 5+ cards you are **forced** to trade a set on your next draft. Territory-match bonus: if a traded card depicts a territory you currently occupy, +2 troops, capped at **+2 total per trade** (not per matching card). [Official]
- **Fog of War**: you can only see territories/intel adjacent to territory you already own; an unseen stacked army can "punish an aggressive player" blind-attacking into fog. Eliminated players in a fog-of-war game reportedly **cannot spectate** the rest of the match (see §4). [Guide/Community]
- **Blizzards**: blocks specific territory-to-territory crossings for the game, creating extra chokepoints that favor defenders. [Guide]
- **Portals** (Stable / Unstable): lets troops jump between two non-adjacent map points; Stable = predictable fixed link, Unstable = randomized destination each time. [Guide]
- **Dice Rolls**: **Balanced Blitz** vs **True Random**. Balanced Blitz dampens variance as force imbalance grows ("rewarding good positioning," more predictable outcomes); True Random is literal dice-for-dice randomness matching the physical board game, so a numerically dominant attack can still lose. Chosen once, at game creation, for the whole match. [Official/Guide]
- **% Domination** — the exact win-percentage threshold (e.g. the 70% in "70% Domination") is itself an adjustable modifier/number, not just a fixed preset mode. [Community]
- **Round Delay** and **Max Rounds** — modifiers that slow down or hard-cap game length. [Community] ("Percentage Domination, Round Delay and Max Rounds are now game modifiers instead of separate game modes")
- **Turn Timer** — selectable durations **60s / 90s / 120s / 3m / 5m**; the timer covers a player's *entire* turn (all three phases), not per-phase; community reports ~90% of hosted online games use the 60s setting. [Community] (multiple Steam discussion threads)
- **AI / Bot Difficulty** — see below.
- Likely also present per community complaints but not independently verified here: **Alliances allowed (on/off)** as a per-game toggle, and a **Fortify mode** toggle for "adjacent only" vs. the default "connected chain" fortify (see §3.3) — **[Unconfirmed]**, verify in-app.

### 2.3 Bot / AI difficulty — names and behavior

**Best-available name list (not 100% certain — verify in-app):** a 5-step ladder of **Beginner → Easy → Medium (sometimes called "Normal") → Hard → Expert**. SMG Studio's own support article frames the range as going "from Beginner to Expert" without enumerating every rung; two independent third-party beginner guides each separately give "Beginner, Easy, Medium and Hard" (four named rungs, possibly omitting "Expert" as a highest tier beyond their worked example); a community-discussion synthesis also converged on "Beginner, Easy, Medium, Hard, Expert." Treat **Beginner / Easy / Medium / Hard / Expert** as the working assumption for the replica, but confirm against the live app's Game Modifiers menu before finalizing copy. [Official + Guide + Community] (https://smgstudio.freshdesk.com/support/solutions/articles/11000024863-how-do-i-change-the-risk-computer-players-difficulty-, https://steamah.com/risk-global-domination-beginners-guide/, https://steamah.com/risk-global-domination/)

Do **not** use "Easier/Medium/Harder/Hardest" — that phrasing surfaced in one synthesized search result but traces to an unrelated open-source strategy-game codebase (GitHub "tactical-risk2.0"/"Godoiosis" AI-difficulty issues, referencing "Pacific win" and "Classic capital" concepts foreign to RGD) and is almost certainly cross-contamination, not RGD's real menu text.

**How the AI actually works** — SMG Studio's own "Our RISK AI" support article (quoted in full where possible): the AI is "not a single entity but a mixture of various 'personas.'" Six personas are named: **friendly**, **defensive** ("only attacks when it really knows it can win"), **continental** (focuses on taking whole continents), **aggressive**, **stacker** ("likes to stack up and then steamroll"), and **zombie** (the Zombie-mode faction's own persona). Each persona has "around 40 different attributes which affect its decision making and how it plays." Different difficulty settings surface different *sets* of personas — "if you play on 'Expert' you will get a different set of personas than on 'easy.'" Capitals-mode games require adapted AI logic. The AI "doesn't have an advantage with dice rolls" — it uses the same randomness code as human players — but **the AI can see your troops even under Fog of War**, an informational edge a human player doesn't get. On Beginner/Easy there's "a slight preference for the AI to take out other AI first," making it easier for the human player. SMG Studio acknowledges matching human strategic depth in Risk is "very tough" and ongoing work rather than solved. [Official] (https://smgstudio.freshdesk.com/support/solutions/articles/11000077687-our-risk-ai)

AI difficulty is **not** tied to your ranked class/rank points. [Official]

### 2.4 Player colors

Confirmed palette (the "classic" 5 the game reverted to, plus 3 premium-exclusive additions), per a community colors discussion: **Red, Green, Yellow, Blue, Orange** (classic/free rotation), plus **Bubblegum (Pink)**, **Charcoal (Black)**, and **Porcelain (White)** retained as **premium-exclusive** color options. [Community] (https://steamcommunity.com/app/1128810/discussions/0/1744521521323439617/, https://steamcommunity.com/app/1128810/discussions/0/3105766250704451660/) Purple has separately been referenced as an Amazon-Prime-exclusive unlock in one source — **[Unconfirmed]**, may be outdated/platform-specific. A colorblind accessibility setting exists (requested features include clearer contrast between green/yellow and blue/purple) — SMG Studio has acknowledged the ask and iterated on contrast, so treat exact behavior as evolving. [Community + Official response]

Max players: standard games cap at **6 players** (humans + bots combined); SMG Studio has not ruled out expanding to 8/10/12 in future. Map sizes range from ~20-territory "quick war" maps up to 90+-territory epics, with 110+ to 120+ total maps across the catalog; the "Classic" map itself has **42 territories** across **6 continents** with draft bonuses (per the Official continent-control article) of **Africa 3, Asia 7, Australia 2, Europe 5, North America 5, South America 2**. [Official + Community]

### 2.5 Fortify rule (adjacent vs. connected — confirm per-game modifier)

Default behavior per SMG Studio's own Fortify article: "Fortify allows you to move troops from one territory to another. Troops can only travel between connecting territories" — i.e., the default is a **connected chain** fortify (can route through any number of your own intervening territories as long as they're continuously owned), not strictly one hop. At least one troop must remain behind in the source territory; the Fortify phase is optional and can be skipped entirely. [Official] (https://smgstudio.freshdesk.com/support/solutions/articles/11000121590-wiki-fortify) Attacking, by contrast, requires direct **adjacency** (or an explicit dashed-line connection on the map) — you cannot attack through a multi-hop chain the way you can fortify. [Guide]

---

## 3. In-game HUD and turn flow

Turn structure is **3 phases**, confirmed verbatim from SMG Studio's own "WIKI -" support articles:

1. **Draft** — "The first phase of your turn in RISK: Global Domination is Draft." Troops you're awarded (base allotment + continent bonuses + card-trade bonuses) must all be placed before moving on: "You must draft all of your available troops during your draft phase." Troops "can be distributed amongst any of your occupied territories." The exact placement widget (tap a territory to open a +/- stepper or slider, a "place all"/"max" shortcut) is not spelled out in SMG's own copy, but community bug reports confirm **a numeric troop-allocation widget pops up when you select/tap a territory** during Draft, and players have specifically requested keyboard/mouse increment shortcuts for amounts like 1/5/10/50/max, implying the live control is a stepper or slider rather than free-text entry. [Official text / Community-inferred UI mechanics] (https://smgstudio.freshdesk.com/support/solutions/articles/11000121587-wiki-draft)
2. **Attack / Blitz / Roll** — "The second phase of your turn in RISK: Global Domination is Attack. Once you have drafted your troops, you may choose to attack." The game defaults each turn's attack to **Blitz** mode, which auto-rolls consecutive optimal dice combinations until either the attacker's committed troops or the defender's territory troops are wiped out: "Blitz will finish when all committed troops are lost or the territory has been conquered." Players can toggle between **Blitz** and **Manual** per-attack via small **"< >" arrow buttons next to the dice**, after selecting a target territory; the preference **resets to Blitz every new turn**. A **"Blitz Win Chance"** percentage readout is shown at the top of the screen to inform the decision. The underlying randomness algorithm (Balanced vs. True Random) was fixed at game creation (§2.2). If you conquer via Blitz having attacked with 3+ troops, you're **required to move a minimum of 3 troops** into the newly conquered territory. [Official] (https://smgstudio.freshdesk.com/support/solutions/articles/11000121588-wiki-attack-blitz-roll)
   - Manual-roll mechanics (Official, "WIKI - Manual Roll"): attacker rolls 1–3 dice (must hold at least one more troop than dice rolled), defender rolls 1–2 dice (needs 2+ troops to roll 2 dice); dice are compared highest-to-highest, pairwise; **ties go to the defender**. A community-sourced "75/25 rule" heuristic: use Manual rolls when your estimated win chance is under 25%, use Blitz when it's over 75%, and mix (manual to soften, then blitz to finish) in the 25–75% band. [Official + Guide]
   - After a successful conquest (Blitz or Manual), a **troop-move slider/control** lets you choose how many attacking troops move into the new territory, with an enforced **minimum equal to however many dice you committed with** (e.g., attacked with 3 dice → must move at least 3) and a maximum of your full remaining attacking force, leaving the option to split forces between old and new territory. Community reports describe this control as occasionally "moving unpredictably," consistent with it being a draggable slider rather than discrete +/- taps. [Guide + Community]
3. **Fortify** — "The last phase of your turn in RISK: Global Domination is Fortify… allows you to move troops from one territory to another," restricted to **connected** territory chains, leaving at least 1 troop behind, and **optional/skippable**. [Official] (https://smgstudio.freshdesk.com/support/solutions/articles/11000121590-wiki-fortify)

**Settings that affect pacing/feel** (Official, via Settings > Gameplay): toggle off **Camera Animations**, **Phase Change Animations**, and **End Phase Confirmation** to speed through turns — implying the default/live game *does* show a camera pan between phases, an animated phase-change transition, and an **end-of-phase confirmation prompt** unless disabled. [Community, corroborating a Settings menu with these exact toggle names] This directly supports building an "End Turn" confirm step and a disable-able camera pan for the replica.

**Elimination / game-end:** no primary source gave the exact elimination-banner copy, but community bug threads ("Game wont end," "Player not finishing me off and ending the game") confirm the game does detect and announce when a player is reduced to 0 territories, and that games can stall if a reduced opponent doesn't finish the kill — useful as a corner case to design around. **[Unconfirmed exact banner text]**

**Replay / spectating other players' turns:** there is **no confirmed automatic "camera tour of what the AI/opponents did" replay system** and **no confirmed post-game replay viewer** — community has explicitly and repeatedly requested a turn/game replay feature as *not yet present* ("Currently, there is no built-in way to watch replays of completed games… noted as a huge thing to implement"). **Spectating** after elimination is similarly contentious: players report that in **Fog of War** games specifically, an eliminated player "cannot spectate or do anything else," and a general "Spectator mode" removal/absence has been a long-running community complaint. Camera auto-pan **does** occur live during your own attacks within a turn (tied to the "Camera Animations" setting above), but there is no evidence of a cross-player "watch the bots play their turn" cinematic — the UI most likely just updates the board state and hands control to the next player, consistent with "moving fast" complaints in the community. [Community] (https://steamcommunity.com/app/1128810/discussions/0/800060091763003114/, https://steamcommunity.com/app/1128810/discussions/0/581649137614059752/, https://steamcommunity.com/app/1128810/discussions/0/5446505912990999317/)

**Zoom/pan:** confirmed to exist as a basic map-navigation feature (community thread titled simply "Zoom"), no further UI specifics recovered. [Community]

**Continent ownership bonus display:** shown as part of the Draft troop count each turn you still hold every territory of a continent at the start of your turn ("If you remain in control of a continent by the beginning of your next turn, you will receive bonus troops to deploy"). [Official]

---

## 4. Modes in detail

### 4.1 Single Player vs. bots
Up to 6 total seats (human + AI combined) per standard game; any of the confirmed win-condition modes (World Domination, 70% Domination, Fast Blitz, Capital Conquest, Zombie Apocalypse, Secret Mission, Secret Assassin) can be played solo against bots, with per-seat difficulty selection in the Modifiers menu (§2.3). [Official/Guide]

### 4.2 Pass & Play (hot-seat)
Confirmed to exist for **2–6 players on one device**. [Official] Confirmed session-resume behavior: if you exit the app mid-Pass & Play game without surrendering, relaunching shows a **pop-up offering to continue your last session**. [Community] (https://steamcommunity.com/app/1128810/discussions/0/4658391921157848184/) No primary source could confirm an explicit "pass the device now" hand-off screen or a deliberate info-hiding blackout between hot-seat turns (beyond whatever Fog of War already withholds) — **[Unconfirmed]**, but Fog of War stacked with Pass & Play is the most likely mechanism SMG Studio relies on to keep hot-seat players honest, rather than a dedicated "cover your eyes" interstitial. Worth explicitly designing a "Pass to Player X — tap to continue" interstitial for the replica even though RGD's own implementation of this couldn't be confirmed.

### 4.3 Online: casual/ranked matchmaking vs. "Play Friends" custom lobby
- **Global Domination online** = the ranked/quick-matchmaking path; feeds the ELO-style ranking system (§6). [Community]
- **"Play Friends online"** = custom/private lobby path, joined via sharing a Player ID / game-find flow ("How do I find my friend's RISK game," "How do I join a multiplayer RISK game?" Official articles exist for both). An **"I'M READY" button** is a confirmed lobby UI element (community thread literally titled "I'M READY 'Button'"). [Official + Community]
- A **10-second ready check** exists and has been a source of complaints when it incorrectly kicks players who briefly tab out. [Community]
- **Turn timer**: 60s/90s/120s/3m/5m, applies to the whole turn; ~90% of hosted online games reportedly use 60s. [Community] Exact **timeout behavior** (auto-end current phase vs. auto-pass vs. formal "miss count then kick") could not be pinned to an Official primary source — community bug reports describe turns sometimes auto-skipping/snapping when the timer and an action collide, which the developers have described fixing via a client-time-resync rebuild — but no article states "after N missed turns you are removed." **[Unconfirmed exact rule — recommend conservative default: auto-end-turn on timeout, remove/bot-replace a player after some small number of consecutive timeouts, confirm against live app.]**

### 4.4 Team modes
Not shipped as a standing, always-available mode as of these sources. Confirmed only as **on SMG Studio's roadmap / in development**: a developer stated "we have plans to expand this as part of a new team play mode we are designing (2v2, 3v3)" in the context of expanding ally communication tools, and separate material (lower confidence, exact citation not recoverable) frames a "Team Games" feature supporting **2v2, 2v2v2, and 3v3**, including deploying troops onto a teammate's territories and fortifying/giving troops through a teammate's land to reduce collusion incentives in regular ranked/casual games. **[Community primary quote is solid; the 2v2/2v2v2/3v3 feature-complete description and any ETA are lower-confidence/unconfirmed — verify before committing the replica's scope to it.]** (https://steamcommunity.com/app/1128810/discussions/0/4627984302708927158/)

### 4.5 Spectating
See §3 — no confirmed, currently-live, general spectator mode; community explicitly asks for its return/addition, especially for team games with friends. Treat as **out of scope / not a core RGD feature to replicate** unless you want to go beyond RGD's own feature set.

### 4.6 Alliances UI
Confirmed mechanics:
- Players can **send and accept alliance requests** with another player. [Community]
- Once allied, you get access to **limited preset chat commands and emotes that are visible only between allies** (not broadcast to the whole lobby) — e.g., clicking an ally's avatar surfaces options like *"attack my territory if you need to"* (an invitation) or *"sorry, I need to attack your territory"* (an apology/warning), triggered by clicking the person you're talking to and then clicking either your own avatar or theirs in the resulting box. [Community] (https://steamcommunity.com/app/1128810/discussions/0/1744521326159177016/, https://steamcommunity.com/app/1128810/discussions/0/3051737007086025677/)
- **Alliances are informal and non-binding**: there is **no enforced "cannot attack ally" lock** — you can attack an ally at any time without first formally breaking the alliance, which is a major, long-running community complaint. Suggested-but-not-confirmed-as-shipped improvements from the community include a mandatory cooldown (e.g., "must break alliance a turn before attacking," or "no attacks for a minimum of 2 turns post-acceptance") and reputation penalties for backstabbing. **These are player wishlist items, not confirmed RGD features** — flag clearly as proposals if adapting them. [Community]
- There is **no public broadcast/announcement banner** confirmed for "Player A and Player B have formed an alliance" — the alliance appears to be a private, two-party state, not a lobby-wide event. **[Unconfirmed — if RGD does broadcast alliances, no source surfaced it; the replica is free to add this since it only improves clarity, but don't claim it's verbatim RGD behavior.]**
- Playing with real-life friends and **secretly allying against strangers** in a public/ranked match is explicitly called out by the community as bannable/cheatable behavior ("if players play with friends in Global Domination and ally up against strangers to defeat them, they will get banned, because this is considered cheating") — useful context for how seriously SMG Studio treats collusion, relevant to the team-mode rationale in §4.4. [Community]

### 4.7 Zombies — fuller rule detail (see also §2.1)
Zombies are a persistent, non-player faction, not eliminable for good mid-game (they respawn even if wiped locally); they get no continent/territory-count bonus, start comparatively small but can gain "30 new zombies before they even own a continent" per one source, and convert/infect roughly half (rounded up) of a defeated defender's troops into new zombies on every territory they take. Difficulty scaling and random "outbreaks" scale with AI difficulty and round number, and a higher troop count sitting in one territory increases outbreak odds there. [Guide + Community-sourced fandom wiki snippet]

---

## 5. Dialog / chat / emotes

**Confirmed core policy (Official, stated repeatedly by SMG Studio support staff):** RISK: Global Domination has **no free-text chat** in casual/standard play. This is explicitly because the game is rated/licensed as **family-friendly**, and open chat would let "an unsupervised minor chat with an adult stranger." Communication is limited to **preset/canned messages and emotes**. [Official] (multiple Steam discussion dev replies, e.g. https://steamcommunity.com/app/1128810/discussions/0/1744521326159177016/)

### 5.1 Verbatim-confirmed preset chat lines and system behavior

- **"NO DICE"** — the current, live name of a preset line, confirmed directly by an SMG Studio developer (handle **IvanErtlov**): *"We did not REMOVE it, we renamed it to 'NO DICE' because it was the least popular one, the least used one."* Its direct predecessor/original wording was **"THE DICE HATE ME!"** [Official — direct developer quote] (https://steamcommunity.com/app/1128810/discussions/0/2259061617876799172/)
- **"Great game"** — confirmed as one of roughly seven pre-typed messages surfaced when you click on another player's avatar mid-game. [Community] (https://steamcommunity.com/app/1128810/discussions/0/3051737007086025677/)
- **"attack my territory if you need to"** and **"sorry, i need to attack your territory"** — confirmed ally-only preset lines, triggered by clicking the ally's avatar / your own avatar respectively in a small popup box. [Community] (https://steamcommunity.com/app/1128810/discussions/0/1744521326159177016/)
- A **"community expression"** system exists: SMG Studio rotates **one** chat line weekly, elected from community-submitted, vetted-as-family-friendly suggestions posted to Discord/Steam; "NO DICE"/"THE DICE HATE ME!" was confirmed as (one of) the rotation's entries. [Official]

Beyond these specific confirmed strings, no primary source yielded a complete, verbatim enumerated list of every preset chat line in the live game (the full roster — likely 15–25+ short lines plus a yes/no/thumbs/heart reaction set for alliance replies — exists in-app but was not fully quotable from text sources alone). The user's framing examples ("Hello!", "Good luck!", "Nice move", "Truce?", "Attack them, not me!", "Sorry", "GG", "I'm going to win", "Thanks") are **plausible in tone and length** given the two confirmed lines above and community descriptions, but **none of those specific nine strings could be independently verified as verbatim RGD text** — treat them as tone references only, not confirmed copy, pending in-app verification.

### 5.2 Emotes

Confirmed **paid DLC pack**: **"RISK: Global Domination: Emotes Pack — The General"** (Steam DLC, appid separate from base game), containing 4 named animated emotes: **Laughing General**, **Angry General**, **Weeping General**, **General Thumbs Up**. [Patch/News] (https://store.steampowered.com/app/1330240/RISK_Global_Domination_Emotes_Pack__The_General/, corroborated by https://www.keymailer.co/g/games/e9ed67a0)

Confirmed **free promotional pack** via Prime Gaming: **"Fistbump Emote Pack"**, 3 emotes: **Fistbump Human**, **Fistbump Pirate**, **Fistbump Zombie**. [Patch/News] (Steam news "Taunt your foes with FREE emotes with Prime Gaming," https://store.steampowered.com/news/app/1128810/view/3023572386962087971)

A mascot/character named **"Mika"** has an associated emote called **"Mika Raspberry"**, independently described by community members as "the most frequently spammed emote" — implying it's a base-game/default emote rather than paid DLC. [Community]

Other named avatars seen in-store/discussion (flavor, not emotes per se): **"Bubble Gum Pirate General"** avatar, an **"Elf Character"** avatar. [Community]

Emotes are bought with **gems** (premium currency) in the Store; the base roster is supplemented by paid packs and occasional free promotional packs. **Emotes are usable both in the pre-game multiplayer lobby and during the multiplayer match itself** ("Emotes can be used both in multiplayer lobbies and multiplayer game chat with other human players") and the ally-only subset is explicitly "visible only between allies" per a developer, while others are visible to the whole lobby — exact which-is-which split is **[Unconfirmed]** beyond that ally-specific distinction. Display mechanism is consistent with the user's assumption of a speech-bubble/pop graphic above the sending player's avatar/portrait for a few seconds, based on how community members describe "clicking on the person... clicking your avatar" to send a message that then evidently appears near the recipient — **exact duration and animation not independently confirmed.**

### 5.3 Seasonal / exclusive content
A **"Spooky Halloween" login reward** offered a free **Jack-O-Lantern Dice** skin. [Patch/News, exact URL not recovered — **Unconfirmed** stable source] No confirmed seasonal/holiday-exclusive *chat lines* were found (only cosmetic dice/skins); treat seasonal chat-line variety as **not confirmed to exist** in RGD, though the weekly community-expression rotation (§5.1) is the closest analog.

### 5.4 PROPOSED expanded dialog set for the replica's casual play

Below is a ~40-line expanded preset-message set for the replica, in RGD's observed tone (short, punchy, exclamation-heavy, game-specific, never hostile/profane given the family-friendly constraint RGD itself operates under). **Every line below is a NEW PROPOSAL unless explicitly marked (RGD-verbatim).** Group by category as requested.

**Greetings**
1. Hello! *(tone-consistent with RGD; not independently verified as verbatim)*
2. Good luck, everyone!
3. Let's have a good game.
4. Ready when you are.
5. Back again — let's go!

**Diplomacy: truce / alliance asks**
6. Truce?
7. Alliance? Let's team up.
8. I won't attack you this turn — deal?
9. Let's take down the leader together.
10. Your border is safe with me... for now.
11. Can we talk strategy?
12. I'll trade you intel for safety.

**Threats / taunts**
13. Your territory looks... undefended.
14. I'm coming for that continent.
15. This is my land now.
16. You should have fortified that.
17. Nowhere left to run.
18. I'm going to win this.
19. Big mistake leaving that border open.

**Reactions (combat/dice)**
20. NO DICE! *(RGD-verbatim — current live name per developer; keep as-is)*
21. THE DICE HATE ME! *(RGD-verbatim — original wording, now retired in favor of "NO DICE" per the developer; include as an optional alt/legacy line)*
22. Nice move.
23. Didn't see that coming.
24. Lucky roll.
25. That hurt.
26. Not bad, not bad.
27. Ouch.

**Apologies / appeasement**
28. Sorry, I need to attack your territory. *(RGD-verbatim ally-context line)*
29. Attack my territory if you need to. *(RGD-verbatim ally-context line)*
30. My bad.
31. Nothing personal.
32. I had no choice.

**Encouragement / banter**
33. Thanks!
34. Great game. *(RGD-verbatim — one of the ~7 confirmed pre-typed messages)*
35. Nice try.
36. Respect.
37. You're tougher than you look.

**Endgame**
38. GG!
39. Well played.
40. Down but not out.
41. I'll be back.
42. Good game, see you next time.

(42 lines total, intentionally slightly over the requested ~40 to give design room to cut; the 5 marked RGD-verbatim should be kept word-for-word, the rest are original proposals written to match RGD's confirmed tone/length.)

---

## 6. Account / identity

- **No fully custom usernames**: SMG Studio's own support article states plainly, *"We do not support fully custom usernames."* The **only** way to set a display name is by linking a platform identity — *"The only way to add a custom name is to use either a Game Center, Google Play, Facebook, Apple or Steam name."* To edit it: **Settings > Profile > Change Profile Name**. [Official] (https://smgstudio.freshdesk.com/support/solutions/articles/11000047524-how-can-i-change-my-risk-name-)
- On Steam specifically, your RISK account name is a **one-way sync from your platform name at creation time** — "your name is sent via Steam to our backend, where it creates an alias for your RISK account. Just because you change your name in Steam, Steam doesn't tell our backend to update" — i.e., renaming your Steam profile does **not** automatically update your in-game RISK name; SMG Studio has acknowledged wanting to smooth this out. [Official]
- A **randomly generated default display name** has been described by a player as looking like **"Lucius The Cruel 33"** (a [First name] [Epithet] [Number] pattern) for accounts before/absent a linked platform name — **[Unconfirmed]**: this came through only as a synthesized search snippet without a cleanly citable primary URL, so treat the *exact* format as a lead, not a locked fact, but it is a strong directional match for "temp discoverable account" naming (epic/flavorful procedural name + disambiguating number) and is a good model for the replica's own guest-name generator.
- **Player ID / Friend ID**: there are reportedly **two types of player ID**; a **Friend ID** (example format given: `37VGVCCC`) is what you share to be added as a friend, and you can also combine it with the leaderboard website URL to look up your own rank/stats page. [Community, citing fandom "Player ID" page] Adding a friend is done either by tapping a **green smiley "add friends" icon** and sharing a profile link, or by **copying/sharing your Player ID** for the other person to paste into their own add-friend screen. [Official]
- **Blocking players**: referenced as a desired feature in community discussion (one request explicitly ties it to the alliance system — wanting a block option tied to repeated bad-faith allies) but **no Official article confirming a shipped "block user" feature was found** — **[Unconfirmed]**.
- **Player-card / profile fields observed in context** (not from one single confirmed UI spec, but triangulated): display name, avatar (customizable, viewable in lobby/leaderboard/friends list/in-game), a **rank/class label**, and win/rank-point stats reachable via the Friend-ID-keyed leaderboard lookup. **Win rate** and **level** as discrete displayed fields were referenced in strategy-guide advice ("aim for at least a 40% win rate") but not confirmed as an explicit on-card stat readout — **[Unconfirmed exact player-card layout]**.
- **Ranking / league system** (Official, ELO-style, separate from AI bot-difficulty naming — do not conflate the two): starts around **1000 points**; class thresholds given as **Novice < 1,000**, **Beginner ≥ 1,000**, **Intermediate ≥ 6,000**, **Expert ≥ 11,000**, **Master ≥ 16,000**, **Grandmaster ≥ 26,000** rank points (one Official source frames "1250 points being Grand Master" as an older/alternate threshold — thresholds appear to have been revised over time; use the 6-tier Novice→Grandmaster list with the larger point values as the more recent figure). Points update with up to a **24-hour delay**, are earned only from **Ranked** multiplayer matches, and class/leaderboard position are related-but-distinct (you can win and still drop a leaderboard spot if others also won big that cycle). Seasonal **rank resets** occur (an Official article "RISK Season Rank Resets" exists). [Official]

**Design implication for the replica's "temporary discoverable account":** RGD's own system (platform-linked name, no free-text custom names, a procedurally generated fallback name, and a shareable short alphanumeric Friend ID for discovery) is actually a close structural match for a lightweight "arrival-chosen display name + lobby-visible ID" design — lean on the **procedural epithet-style name generator** and a **short shareable code** pattern rather than inventing something unrelated to RGD's own identity model.

---

## 7. Onboarding / tutorial

- A dedicated **in-game tutorial exists** and is the Official first recommendation for new players: SMG Studio's own "How to play guide" article tells players to **"play the tutorial"** before anything else, and otherwise points to the third-party **RISK4EVER YouTube channel** for "Countless 'How to' Videos for almost every game mode and situation" — meaning SMG Studio does **not** maintain its own exhaustive written rules walkthrough; the in-app tutorial and a fan video channel are the two sanctioned on-ramps. [Official] (https://smgstudio.freshdesk.com/support/solutions/articles/11000074018-how-to-play-guide)
- A separate, older community description (Hasbro's own site, not necessarily describing the SMG build 1:1) frames the on-ramp as: "start a single player game, select the tutorial map (based on the classic map) and start the game, and you will be guided through all steps needed to play RISK" — i.e., the tutorial is itself a **guided single-player match on a simplified/classic-based map**, teaching by doing rather than a separate slideshow. [Guide-adjacent, Hasbro site, treat as directional]
- Teaching order implied by the confirmed phase structure and support-article sequence (Draft → Attack/Blitz/Roll → Conquering Continents → Fortify → Card Trading → Manual Roll) is a reasonable proxy for the tutorial's own teaching order, since this is literally the order SMG Studio's own help-article folder lists the phases in. **[Reasonable inference, not a confirmed tutorial script]**
- No confirmed detail on whether the tutorial is skippable, how long it is, or whether it's forced on first launch — **[Unconfirmed]**.

---

## 8. Accessibility / feel details

- **Settings > Gameplay** toggles confirmed to exist: **Camera Animations** (on/off), **Phase Change Animations** (on/off), **End Phase Confirmation** (on/off) — all three exist specifically so advanced players can speed-run their turns; their *existence* implies the **default** experience includes a camera pan on phase/attack transitions, an animated transition between Draft/Attack/Fortify, and a confirmation prompt before ending a phase/turn. [Community, naming these exact toggles] (https://steamcommunity.com/app/1128810/discussions/0/2999900306498293447/ "Skip dice animation?" + related threads)
- **Colorblind accessibility option**: confirmed to exist in some form; SMG Studio has publicly acknowledged specific complaints (can't distinguish green/yellow or blue/purple) and said they planned to revise player/territory color contrast and solicit feedback — treat this as an **evolving, partially-implemented** feature rather than a single toggle with fixed behavior. [Official response + Community]
- **Haptics**: a third-party peripheral integration was found — SteelSeries sent RGD a kit to enable **"GameSense"**, a SteelSeries peripheral-haptic/lighting feature — but this is peripheral-specific (e.g., controller/mouse RGB+rumble on supported SteelSeries hardware), **not** a general mobile-haptics confirmation. No confirmed standard mobile vibration-on-dice-roll feature was found. [Patch/News, low relevance to a browser replica]
- **Dice sound / "troop counter spinning"**: no primary source gave named sound-effect filenames or confirmed a literal spinning-odometer troop-counter animation; the *troop-move slider described as moving "unpredictably"* (§3) is the closest confirmed analog to a dynamic troop-count UI element, and visually a spinning/ticking counter is a reasonable, low-risk UX choice for the replica even though it isn't independently confirmed as RGD's actual implementation. **[Unconfirmed]**
- **Camera auto-pan to attacks**: confirmed indirectly via the existence of a disable-able "Camera Animations" setting (implying the camera does move/pan automatically by default during combat resolution) — exact pan behavior (does it follow dice, snap to the defender's territory, etc.) is **[Unconfirmed]**.
- **Dice modes feeding "feel"**: Balanced Blitz vs. True Random (§2.2) is itself a deliberate feel/fairness-perception lever SMG Studio built specifically because dice variance is a huge source of player frustration/complaints ("very bad dice problem," "AI cheats, dice loaded" threads) — worth replicating both modes rather than just True Random, since Balanced Blitz is SMG's own answer to "the dice feel unfair." [Official + Community]

---

## Summary of what to TRIM vs. KEEP (per the brief's framing)

**Trim for the replica:** gems/tokens premium currency and the token play-gate, Premium Pack purchase, cosmetic shop (dice skins, avatar frames, troop counters, emote DLC packs), ranked ELO ladder's monetized layer (seasonal resets tied to cosmetic rewards), Zombie-mode's "premium hosts only" gate (if replicating Zombies, make it free), ranked matchmaking's real-money backing, ready-check/anti-cheat infrastructure, friend-code backend sync quirks.

**Keep for the replica:** Single Player vs. bots with named difficulty tiers, Pass & Play hot-seat (2–6 players), casual online play (simple lobby, "I'm ready" button, seat list), the 3-phase turn structure (Draft → Attack/Blitz/Roll → Fortify) with Blitz-vs-Manual dice and a Blitz-win-chance readout, Fixed/Progressive card trading, continent bonuses, Fog of War / Capitals / 70%-Domination / Zombies / Secret Mission / Secret Assassin as optional modifiers/modes, informal (non-binding) alliances with ally-only preset chat + emotes, the family-friendly preset-chat-only communication model (expanded per §5.4), a lightweight procedurally-named "temporary discoverable account" identity layer modeled on RGD's own platform-name-or-procedural-name + shareable-ID pattern, and the Camera/Phase-Animation/End-Phase-Confirmation speed-toggle pattern for accessibility/pacing.

---

## Sources

- SMG Studio Freshdesk (official support/FAQ — https://smgstudio.freshdesk.com):
  - [Our RISK AI](https://smgstudio.freshdesk.com/support/solutions/articles/11000077687-our-risk-ai)
  - [How do I change the RISK computer players' difficulty?](https://smgstudio.freshdesk.com/support/solutions/articles/11000024863-how-do-i-change-the-risk-computer-players-difficulty-)
  - [Is RISK: Global Domination based on official rules?](https://smgstudio.freshdesk.com/support/solutions/articles/11000025091-is-risk-global-domination-based-on-official-rules-)
  - [How can I change my RISK name?](https://smgstudio.freshdesk.com/support/solutions/articles/11000047524-how-can-i-change-my-risk-name-)
  - [How is my RISK rank calculated?](https://smgstudio.freshdesk.com/support/solutions/articles/11000025021-how-is-my-risk-rank-calculated-)
  - [How do I add friends in RISK?](https://smgstudio.freshdesk.com/support/solutions/articles/11000024973-how-do-i-add-friends-in-risk-)
  - [Finding your RISK Player ID](https://smgstudio.freshdesk.com/support/solutions/articles/11000028523-finding-your-risk-player-id)
  - [How do I find my friend's RISK game](https://smgstudio.freshdesk.com/support/solutions/articles/11000024869-how-do-i-find-my-friend-s-risk-game)
  - [How do I join a multiplayer RISK game?](https://smgstudio.freshdesk.com/support/solutions/articles/11000024867-how-do-i-join-a-multiplayer-risk-game-)
  - [How are the dice rolling odds calculated for RISK computer players?](https://smgstudio.freshdesk.com/support/solutions/articles/11000024866-how-are-the-dice-rolling-odds-calculated-for-risk-computer-players-)
  - [WIKI - Draft](https://smgstudio.freshdesk.com/support/solutions/articles/11000121587-wiki-draft)
  - [WIKI - Attack Blitz Roll](https://smgstudio.freshdesk.com/support/solutions/articles/11000121588-wiki-attack-blitz-roll)
  - [WIKI - Conquering Continents](https://smgstudio.freshdesk.com/support/solutions/articles/11000121589-wiki-conquering-continents)
  - [WIKI - Fortify](https://smgstudio.freshdesk.com/support/solutions/articles/11000121590-wiki-fortify)
  - [WIKI - Card Trading](https://smgstudio.freshdesk.com/support/solutions/articles/11000121591-wiki-card-trading)
  - [WIKI - Manual Roll](https://smgstudio.freshdesk.com/support/solutions/articles/11000121592-wiki-manual-roll)
  - [Secret Assassin](https://smgstudio.freshdesk.com/support/solutions/articles/11000133170-secret-assassin)
  - [Secret Missions](https://smgstudio.freshdesk.com/support/solutions/articles/11000135639-secret-missions)
  - [How to play guide](https://smgstudio.freshdesk.com/support/solutions/articles/11000074018-how-to-play-guide)
  - [RISK Season Rank Resets](https://smgstudio.freshdesk.com/support/solutions/articles/11000133278-risk-season-rank-resets) (existence referenced)
  - [FAQ folder](https://smgstudio.freshdesk.com/support/solutions/folders/11000005092) / [HOW TO PLAY folder](https://smgstudio.freshdesk.com/support/solutions/folders/11000005113)
  - Community discussion threads: [Color blind option](https://smgstudio.freshdesk.com/support/discussions/topics/11000009603), [Ability to choose default player color selection](https://smgstudio.freshdesk.com/support/discussions/topics/11000015580), [Bots](https://smgstudio.freshdesk.com/support/discussions/topics/11000016340), [Fix the AI](https://smgstudio.freshdesk.com/support/discussions/topics/11000026441), [How does Bot (AI) players affect my rank?](https://smgstudio.freshdesk.com/support/discussions/topics/11000025837), [Capital RISK game mode](https://smgstudio.freshdesk.com/support/discussions/topics/11000009605), [General RISK Chat forum](https://smgstudio.freshdesk.com/support/discussions/forums/11000000391)

- Steam (store + community, appid 1128810):
  - [Store page](https://store.steampowered.com/app/1128810/RISK_Global_Domination/)
  - [Emotes Pack: The General (DLC)](https://store.steampowered.com/app/1330240/RISK_Global_Domination_Emotes_Pack__The_General/)
  - [Universal Domination Map Pack (DLC)](https://store.steampowered.com/app/2385960/RISK_Global_Domination__Universal_Domination_Map_Pack/)
  - News: [Emotes are coming to Steam](https://store.steampowered.com/news/app/1128810/view/2373907845410035775), [Taunt your foes with FREE emotes with Prime Gaming](https://store.steampowered.com/news/app/1128810/view/3023572386962087971)
  - Discussions: [NO DICE rename (developer IvanErtlov)](https://steamcommunity.com/app/1128810/discussions/0/2259061617876799172/), [Chat messages community input](https://steamcommunity.com/app/1128810/discussions/0/2243300286303350974/), [Emotes & Text in Risk announcement thread](https://steamcommunity.com/app/1128810/eventcomments/632295528254731104/), [How can I communicate with my ally?](https://steamcommunity.com/app/1128810/discussions/0/1744521326159177016/), [I don't know how to use the Risk chat](https://steamcommunity.com/app/1128810/discussions/0/3051737007086025677/), [emote thread](https://steamcommunity.com/app/1128810/discussions/0/3192487812589678453/), [Better communication/quick chats](https://steamcommunity.com/app/1128810/discussions/0/600768941305906640/), [In-Game Communication](https://steamcommunity.com/app/1128810/discussions/0/3032599335588492737/), [How to public chat/team chat in game?](https://steamcommunity.com/app/1128810/discussions/0/1743394388076750287/), [Team play with friends AND strangers](https://steamcommunity.com/app/1128810/discussions/0/4627984302708927158/), [Spectating](https://steamcommunity.com/app/1128810/discussions/0/581649137614059752/), [Spectator mode](https://steamcommunity.com/app/1128810/discussions/0/5446505912990999317/), [More player colors](https://steamcommunity.com/app/1128810/discussions/0/1744521521323439617/), [Colours of this game](https://steamcommunity.com/app/1128810/discussions/0/3105766250704451660/), [Color blind mode](https://steamcommunity.com/app/1128810/discussions/0/4206994256767066613/), [How to Invite Friend / I'M READY button](https://steamcommunity.com/app/1128810/discussions/0/2913220877917387473/), [UI redesign suggestion](https://steamcommunity.com/app/1128810/discussions/0/1743393963179713334/), [Remove 60 second turn limit](https://steamcommunity.com/app/1128810/discussions/0/3806155895390235379/), [REMOVE 10 SEC READY CHECK](https://steamcommunity.com/app/1128810/discussions/0/601917691382643022/), [BUG report - turn auto-skipped](https://steamcommunity.com/app/1128810/discussions/0/2260188150859001758/), [Can You Save a Pass-n-Play Game?](https://steamcommunity.com/app/1128810/discussions/0/4658391921157848184/), [how do you play with a friend and make an alliance?](https://steamcommunity.com/app/1128810/discussions/0/1743393963179619575/), [Please rework alliances!!!](https://steamcommunity.com/app/1128810/discussions/0/3817418437348795632/), [Am I the only one who can't decide how many troops to move?](https://steamcommunity.com/app/1128810/discussions/0/3194736442573903185/), [Skip dice animation?](https://steamcommunity.com/app/1128810/discussions/0/2999900306498293447/), [how to use my other name](https://steamcommunity.com/app/1128810/discussions/0/1743393754709134158/), [Changing user name inside Risk game?](https://steamcommunity.com/app/1128810/discussions/0/2144217289725421337/), [How Big (map sizes)](https://steamcommunity.com/app/1128810/discussions/0/3035976310916489572/), [Z O M B I E S](https://steamcommunity.com/app/1128810/discussions/0/2790495976030156368/)

- Fandom wiki (`risk-global-domination.fandom.com`) — fetched only via search-engine snippets, direct fetch blocked by a bot-check wall: Steam Version Details, Our RISK AI, Ranking System, Player ID, Everything you need to know about Zombies!, Classic Map, 1v1 Gameplay, Gems, Tokens and Premium, Risk Rules.

- Third-party guides: [LevelWinner — RISK: Global Domination Guide](https://www.levelwinner.com/risk-global-domination-guide-tips-tricks-strategies/), [SteamAH — Beginners' Guide](https://steamah.com/risk-global-domination-beginners-guide/), [SteamAH — Guide, Tips, Cheat and Walkthrough](https://steamah.com/risk-global-domination/), [duxaris.com — How to Play Risk: Global Domination](https://duxaris.com/beginners/how-to-play/)

- App stores: [Apple App Store listing](https://apps.apple.com/us/app/risk-global-domination/id1051334048), [Google Play listing](https://play.google.com/store/apps/details?id=com.hasbro.riskbigscreen)

- Unrelated-game disambiguation note sources (to avoid cross-contamination): GitHub `04jhbickford/tactical-risk2.0` PR #64 and `Phaazoid/Godoiosis` issue #1230 — confirmed **not** about SMG Studio's RISK: Global Domination; excluded from all claims above after identification.
