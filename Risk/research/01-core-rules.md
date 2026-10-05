# RISK: Global Domination (RGD) — Core Rules Research

Research pass for a browser replica of SMG Studio's *RISK: Global Domination* (RGD), the
Hasbro-licensed digital Risk (iOS / Android / Steam / consoles). Every ruling below is
cited to a URL plus the sentence that supports it. Where sources disagree, both are
recorded, with a note on which is more authoritative.

**Authority ranking used throughout** (highest to lowest):
1. Official Hasbro/Parker Brothers printed rulebook (hasbro.com PDF) — the ruleset SMG
   Studio says it built from.
2. SMG Studio's own support/Zendesk ("Freshdesk") knowledge base (`smgstudio.freshdesk.com`)
   and official SMG/RISK social posts — this is literally the developer describing RGD's
   own digital implementation, which sometimes deviates from the 2003 print rulebook.
3. SMG Studio's public `risk-dice` GitHub source and fan sites that mirror its math
   (friendsofrisk.com Blitz Calculator), since these reproduce actual shipped code/behavior.
4. Wikipedia, Steam community guides/discussions, third-party strategy blogs (duxaris.com,
   steamah.com, levelwinner.com) — useful corroboration, not primary.
5. Fandom wiki (`risk-global-domination.fandom.com`) — community-maintained, treat as
   lowest-confidence unless corroborated elsewhere (many pages returned HTTP 402 / could
   not be fetched directly during this research pass; where used, it is via search-result
   snippets only, flagged as such).

Also flagged explicitly: **dominating12.com** is a *different, unofficial, fan-made* online
Risk implementation, not SMG Studio's RGD. Its rules (e.g., double-trade-in thresholds,
wild+wild+1 sets) are NOT RGD rules and are cited only as a contrast, never as evidence of
RGD behavior.

---

## 1. Setup

### 1.1 Player counts and initial army counts

The official 2003 Hasbro/Parker Brothers rulebook (the ruleset SMG Studio says it drew
from — see §0 "Is RGD based on official rules?" below) states, for the standard
"Global Domination RISK" setup:

> "If 3 are playing, each player counts out 35 Infantry. If 4 are playing, each player
> counts out 30 Infantry. If 5 are playing, each player counts out 25 Infantry. If 6 are
> playing, each player counts out 20 Infantry."
— Hasbro/Parker Brothers, *RISK: The Game of Global Domination* instructions (2003),
p.5 (local copy fetched from
https://www.hasbro.com/common/documents/dad2886d1c4311ddbd0b0800200c9a66/61364C2119B9F369106F6DE955E8C10A.pdf )

For 2 players, the rulebook defers to its dedicated 2-player variant, which uses a third
"neutral" color and issues **40 Infantry** per side:

> "You and your opponent each select a complete set of armies. Then either of you selects a
> third set to be 'neutral.' Take 40 Infantry pieces from each of the 3 sets..."
— same source, p.6.

So the classic starting-army table that the engine must implement is:

| Players | Starting armies (Infantry) |
|---|---|
| 2 (incl. 1 neutral "buffer" set) | 40 / 40 / 40 (neutral) |
| 3 | 35 |
| 4 | 30 |
| 5 | 25 |
| 6 | 20 |

This matches the "40/35/30/25/20" progression the task brief expected. Note the 2-player
count (40) comes specifically from the dedicated 2-player appendix, not the main table —
the main table only enumerates 3–6 players directly.

A second official PDF (`https://www.hasbro.com/common/instruct/risk.pdf`) and Hasbro's
modern microsite also exist and were not byte-compared here, but no secondary source found
contradicts the 40/35/30/25/20 progression (e.g. Wikipedia's *Risk (game)* article and
multiple strategy sites restate the same numbers).

### 1.2 Territory distribution: random vs manual placement

Classic board-game setup is a turn-based draft (see 1.3 below) where players alternately
claim unclaimed territories one at a time — i.e. **manual, sequential, player-chosen**
placement is the baseline physical-game procedure:

> "Starting to the left of the first player, everyone in turn places one army onto any
> unoccupied territory. Continue until all 42 territories have been claimed."
— Hasbro rulebook (2003), p.5.

RGD (the digital game) offers **both** a random auto-placement and a manual, turn-based
"Claim Phase" as a toggle, per community-sourced descriptions corroborated by SMG's own
support forum thread title "Automatic territory selection + manual troop placement":

> "Manual Placement is OFF by default, which means the computer places everyone's units
> fairly randomly across the map ... When Manual Placement is ON, it activates the Claim
> Phase where everyone takes turns placing troops one at a time around the map."
— paraphrased from community answers aggregated by WebSearch over
https://smgstudio.freshdesk.com/support/discussions/topics/11000009604 (SMG Studio
Freshdesk discussion titled "Automatic territory selection + manual troop placement") and
corroborated independently by
https://steamah.com/risk-global-domination-beginners-guide/ ("Manual Placement enabled
for selecting starting areas" as a settable option) — **confidence: medium**, since the
Freshdesk thread content itself could not be fetched verbatim (returned only the
knowledge-base shell on this pass); the wording above is the WebSearch tool's synthesis of
indexed snippets, not a verbatim quote.

Also, per duxaris.com (secondary source):
> "Players are assigned territories either randomly or via manual placement (if the game
> mode allows). Manual placement allows strategic positioning..."
— https://duxaris.com/beginners/how-to-play/

**Engine requirement:** support an "Auto Placement" (default, random territory assignment,
then random or algorithmic remaining-army placement) and a "Manual Placement" mode (a
pre-game "Claim Phase" where players alternate placing one army at a time on an empty
board, mirroring the classic rulebook's procedure, until all territories/armies are
placed).

### 1.3 Neutral armies in 2-player games

Confirmed directly from the official rulebook's dedicated 2-player section (p.6–7):

> "This version is played like regular RISK with one important exception: Along with your
> armies and those of your opponent, there are also 'neutral' armies on the board that act
> as a buffer between you and your opponent."

Setup procedure (official, verbatim steps):
1. Remove Mission cards and the 2 Wild cards from the deck.
2. Shuffle the remaining Risk cards and deal into 3 equal piles — you take one, your
   opponent takes one, the third pile is "neutral."
3. Place one Infantry on each of the 14 territories shown on your pile's cards; opponent
   does the same for their 14; place one "neutral" Infantry on each of the remaining 14
   "neutral" territories (14+14+14 = 42).
4. Remaining armies are placed in alternating turns: "Place 2 Infantry onto any 1 or 2 of
   the territories you occupy. Then place 1 'neutral' army onto any 'neutral' territory you
   want, placing it to block your opponent's possible advance."
5. Return the two Wild cards to the deck, shuffle, and begin play.

Rules during play (official, p.7):
> "'Neutral' armies cannot attack and never receive reinforcements during the game."
> "Whenever you attack a 'neutral' territory, your opponent [sic — i.e., whichever human
> player is adjacent] rolls to defend that 'neutral' territory."
> "To win, be the first to eliminate your opponent by capturing all of his or her
> territories. You do not have to eliminate the 'neutral' armies."

RGD's digital 2-player ("1v1") mode is described by the fandom wiki as following this same
neutral-buffer structure, titled "1v1 Gameplay" — https://risk-global-domination.fandom.com/wiki/1v1_Gameplay
— **confidence: low/unverified**, the page itself returned HTTP 402 on fetch and no
verbatim text could be extracted this pass; treat as needing in-app confirmation before
being relied on for exact RGD 1v1 neutral-army numbers (the engine should default to the
rulebook's 40/40/40 + 14/14/14 split documented above unless/until RGD's exact digital
figures are confirmed).

### 1.4 Turn order: who goes first

Official rulebook (p.5, step 2, and p.5 "TO COMPLETE GAME SETUP" step 7):
> "Roll one die. Whoever rolls the highest number takes one Infantry piece from his or her
> pile and places it onto any territory on the board, thus claiming that territory."
> "Whoever placed the first army takes the first turn."

So physically: **a single highest-die-roll determines first placement, and whoever placed
first also takes the first real turn.** No source found states RGD changed this to pure
random (non-dice) selection; absent a contrary RGD-specific citation, the engine should
implement "highest roll wins first-placement-and-first-turn," falling back to a reroll on
ties (standard convention, not explicitly stated in the excerpt obtained).

### 1.5 RGD "auto-placement" at start

See §1.2: Auto Placement (default) assigns territories randomly across all players (and,
per community sourcing, places starting armies automatically/roughly evenly as well),
versus Manual Placement's turn-based claim phase. No official SMG numeric formula for how
"random" auto-placement distributes *remaining* armies after territories are claimed was
found in this pass (flag as open item — likely even/random distribution per player across
their already-assigned territories).

---

## 2. Turn structure

### 2.1 The three phases

Both the official print rulebook and SMG's own RGD documentation agree on a strict
three-phase turn, though RGD's on-screen vocabulary differs slightly from the print
rulebook's phrasing:

Print rulebook (p.4):
> "Each of your turns consists of three steps, in this order: 1. Getting and placing new
> armies; 2. Attacking, if you choose to, by rolling the dice; 3. Fortifying your
> position."

RGD UI / SMG wiki naming (confirmed via SMG's own Freshdesk "WIKI" article series, whose
URLs and listing were directly fetched — see §9 Sources for the folder listing):
- **"Draft"** — https://smgstudio.freshdesk.com/support/solutions/articles/11000121587-wiki-draft
  — "the Draft phase is the first turn phase in RISK: Global Domination where players
  receive troops to deploy on the board."
- **"Attack" / "Blitz Roll"** — https://smgstudio.freshdesk.com/support/solutions/articles/11000121588-wiki-attack-blitz-roll
  — article titled "WIKI - Attack Blitz Roll," described as "the second phase after
  drafting troops."
- **"Fortify"** — https://smgstudio.freshdesk.com/support/solutions/articles/11000121590-wiki-fortify
  — "Addresses the final turn phase following attack completion."

Also, Hasbro's own modern microsite (secondary/simplified, but official Hasbro-branded)
states the same 3-phase loop with different capitalization:
> "Each players turn is broken into 3 phases: Deploy > Attack > Fortify"
— https://www.hasbrorisk.com/howtoplay

**UI vocabulary takeaway for the replica:** RGD's own documentation titles the phases
**"Draft"**, **"Attack"**, **"Fortify"** — use these exact words on-screen, not "Deploy"
(that's Hasbro's separate marketing-site wording, not RGD's in-app wording per SMG's own
wiki article titles).

### 2.2 Reinforcement formula

Official rulebook (p.6, "Territories"):
> "At the beginning of every turn (including your first), count the number of territories
> you currently occupy, then divide the total by three (ignore any fraction). The answer is
> the number of armies you receive... You will always receive at least 3 armies on a turn,
> even if you occupy fewer than 9 territories."
> Example given: "11 territories = 3 armies; 14 territories = 4 armies; 17 territories = 5
> armies."

RGD's own "WIKI - Draft" article restates this identically:
> "The number of troops drafted is calculated using territories divided by 3 (for example,
> 16 territories / 3 = 5 troops)... cannot be less than 3."
— https://smgstudio.freshdesk.com/support/solutions/articles/11000121587-wiki-draft

**Formula: `reinforcements = max(3, floor(territories_owned / 3))`.**

### 2.3 Continent bonuses (classic map)

Official rulebook (p.6): "To find the exact number of armies you'll receive for each
continent, look at the chart in the lower left-hand corner of the gameboard" (i.e., the
physical board prints the numbers; the rulebook text itself does not restate the digits in
the excerpt obtained). RGD's own documentation **does** state the numbers explicitly, and
they match the classic board's known values:

> "On the classic map, the bonus troops for each continent are: Africa: 3, Asia: 7,
> Australia: 2, Europe: 5, North America: 5, and South America: 2."
— synthesized by WebSearch from https://smgstudio.freshdesk.com/support/solutions/articles/11000121589-wiki-conquering-continents
("WIKI - Conquering Continents"), and independently re-confirmed verbatim on a direct
WebFetch of the same URL:
> "Classic Map Bonus Troops: Africa: 3, Asia: 7, Australia: 2, Europe: 5, North America: 5,
> South America: 2."

This **confirms the task brief's expected values exactly**: NA 5, SA 2, EU 5, AF 3, AS 7,
AU 2. No contradicting source found.

> "If you remain in control of a continent by the beginning of your next turn, you will
> receive bonus troops to deploy" — i.e. control is checked at the start of the owner's
> turn, matching the rulebook's "you must occupy all its territories at the start of your
> turn" (p.6).

### 2.4 How RGD displays/animates reinforcements

- The Draft phase shows a troop counter that increments as the engine totals
  territory-count bonus + continent bonus(es) + card-trade bonus; "Troops can be
  distributed amongst any of your occupied territories" and "You must draft all of your
  available troops during your draft phase" before advancing — per
  https://smgstudio.freshdesk.com/support/solutions/articles/11000121587-wiki-draft.
- Settings > Gameplay exposes toggles for "Camera Animations," "Phase Change Animations,"
  and "End Phase Confirmation" that can be switched off to speed up turns — per WebSearch
  synthesis of community Steam threads (secondary, not independently verified verbatim;
  flagged medium confidence) referencing in-game settings menus.

---

## 3. Cards

### 3.1 Card types

Official rulebook (p.3): the deck is **56 cards**: "42 marked with a territory and a
picture of Infantry, Cavalry, or Artillery; 2 Wild cards marked with all three pictures,
but no territory; 12 Mission cards used only in SECRET MISSION RISK."

RGD's own "WIKI - Card Trading" article confirms the same four playable-card families for
standard (non-Secret-Mission) play:
> "The game features four card categories: 'Infantry,' 'Cavalry,' 'Artillery,' and
> 'Joker/Wild' cards that function as any of the three standard types."
— https://smgstudio.freshdesk.com/support/solutions/articles/11000121591-wiki-card-trading

### 3.2 Earning a card

Official rulebook (p.4): "At the end of any turn in which you have captured at least one
territory, you will earn one (and only one) RISK card." Confirmed independently for RGD
by the "WIKI - Card Trading" synthesis: "Players earn cards with 'at least one winning
attack per turn'" and the rulebook's own "Ending your attack" section: "If you have
captured at least one territory, first take the top RISK card from the draw pile. (No
matter how many territories you've captured on your turn, you may take only one RISK
card.)" (p.5–6).

### 3.3 Set rules

Official rulebook (p.4): a valid set is any of:
- 3 cards of the same design (all Infantry, all Cavalry, or all Artillery)
- 1 each of the 3 designs (Infantry + Cavalry + Artillery)
- Any 2 cards plus a Wild card

RGD's "WIKI - Card Trading" restates this identically: "Players must collect sets of three
cards through one of three methods: matching designs (three identical types), one card of
each design, or any two cards plus a wild card."
— https://smgstudio.freshdesk.com/support/solutions/articles/11000121591-wiki-card-trading

### 3.4 Fixed vs Progressive trade values

**Fixed** (official rulebook does not define a "Fixed" alternate scheme by that name — this
is RGD's own naming for one of its two selectable trade-in schemes). RGD's "WIKI - Card
Trading" article (directly fetched):
> "When playing with fixed bonuses, troops awarded depend on card type: three infantry
> yields 4 troops, three cavalry provides 6 troops, three artillery grants 8 troops, and one
> of each design awards 10 troops."

So **Fixed = 4 (Infantry×3) / 6 (Cavalry×3) / 8 (Artillery×3) / 10 (one of each or using a
Wild)** — matching the task brief's expected 4/6/8/10 table, and matching the SMG support
article "How do I check if we're playing fixed or progressive RISK bonus rules?" which
independently states:
> "The bonus values table will display: '4 Infantry, 6 Cavalry, 8 Artillery, 10 All three'"
— https://smgstudio.freshdesk.com/support/solutions/articles/11000025058-how-do-i-check-if-we-re-playing-fixed-or-progressive-risk-bonus-rules-

**Progressive** — RGD's "WIKI - Card Trading" (direct fetch):
> "First Set – 4 troops, Second Set – 6 troops, Third Set – 8 troops, Fourth Set – 10
> troops, Fifth Set – 12 troops, Sixth Set – 15 troops. Beyond the sixth trade, each
> additional set is worth 5 extra troops."

This exactly matches the **official print rulebook's** own base progression (p.4–5):
> "The first set traded in — 4 armies. The second set — 6. The third — 8. The fourth — 10.
> The fifth — 12. The sixth — 15 ... After the sixth set has been traded in, each additional
> set is worth 5 more armies. ... if you trade in the seventh set, you get 20 armies; ...
> the eighth, you get 25 armies, and so on."

So the full progression (print rulebook + RGD agree) is:
**4, 6, 8, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, ...** (each set after the 6th
adds +5). This matches the task brief's expected 4/6/8/10/12/15/20/25/30/35/40/45/50/55/60
sequence **exactly**, confirmed by two independent, high-authority sources (the 2003 Hasbro
rulebook and SMG's own RGD support article) agreeing verbatim on the first six values and
the "+5 forever after" rule.

(Note: the print rulebook's *optional* "Rules Variations for RISK Experts" section offers
an alternate, slower-growing scheme — "increase its value by only 1" so sets go
4, 5, 6, 7... — p.8 of the rulebook. No source found indicates RGD exposes this expert
variant as a selectable option; it is presumably NOT implemented in RGD and is noted here
only to avoid confusing it with RGD's real "Progressive" option above.)

### 3.5 Territory bonus (+2)

Official rulebook (p.5):
> "Occupied territories. If any of the 3 cards you trade in shows the picture of a
> territory you occupy, you receive 2 extra armies. You must place both those armies onto
> that particular territory... On a single turn, you may receive no more than 2 extra
> armies above and beyond those you receive for the matched sets of cards you trade in."

RGD's "WIKI - Card Trading" confirms identically: "If any of the territories you occupy are
depicted on one of the three cards, you will receive an extra 2 troops."
— https://smgstudio.freshdesk.com/support/solutions/articles/11000121591-wiki-card-trading

**Engine rule:** +2 armies, placed directly onto the matching territory, capped at +2 per
turn even if multiple traded cards match owned territories.

### 3.6 Forced trade threshold — ⚠️ CONTRADICTION FOUND

**Official 2003 rulebook (highest authority)** (p.4):
> "If you have collected a set of 3 RISK cards, you may turn them in at the beginning of
> your next turn, or you may wait. But if you have **5 or 6 cards** at the beginning of your
> turn, you **must** trade in at least one set, and **may** trade in a second set if you have
> one."

This is an explicit, unambiguous "5 or 6" threshold, checked **at the start of your turn**.

**SMG's own RGD "WIKI - Card Trading" article**, however, was summarized by the fetch tool
as:
> "Forced Trading Threshold: Players holding exactly 5 cards must immediately trade in a
> complete set, resetting their turn and remaining in the draft phase."
— https://smgstudio.freshdesk.com/support/solutions/articles/11000121591-wiki-card-trading
(this is a paraphrase produced by the fetch tool, not a confirmed verbatim quote — the
underlying HTML could not be re-verified character-for-character on this pass)

**Assessment:** the rulebook's "5 or 6" wording is unambiguous and highest-authority. The
RGD paraphrase saying "exactly 5" is very likely just loose phrasing for "5 (or more)" by
whoever wrote the support article (card count cannot normally exceed 6 anyway, since you
are capped at earning 1/turn and forced to trade at 5+). **Recommendation for the engine:**
implement the rulebook's rule ("if you hold 5 or more cards at the start of your turn, you
must trade in at least one set, and may trade a second if you still qualify") — this is
the safe, well-documented interpretation, and is consistent with both sources once the RGD
phrasing is read as shorthand. Flag this as an item to verify against a live RGD client
before shipping if exact parity with the app matters.

### 3.7 Elimination: cards transferred, and the mid-turn forced-trade edge case

Official rulebook (p.6, "Eliminating an opponent"):
> "If during your turn you eliminate an opponent by defeating his or her last army on the
> gameboard, you win any RISK cards that player has collected."
> "If winning them gives you **6 or more** cards, you must **immediately** trade in enough
> sets to reduce your hand to **4 or fewer** cards, but once your hand is reduced to 4, 3,
> or 2 cards, you must stop trading."
> "But if winning them gives you fewer than 6, you must **wait** until the beginning of your
> next turn to trade in a set."
> "Note: When you draw a card from the deck at the end of your turn (for having won a
> battle), if this brings your total to 6, you must wait until your next turn to trade in."

This is an important, precise edge case for the engine:
- Eliminating a player **mid-turn** and inheriting their cards can push you to 6+ cards —
  this **immediately** (same turn, mid-attack-phase) forces trade-downs to ≤4 cards, 1 set
  at a time, stopping as soon as you reach 4, 3, or 2 (i.e., you cannot be forced below 2
  just because you could — you stop once you're under the 5-card forced-trade threshold,
  with 4/3/2 all being acceptable stopping points depending on what sets you can form).
- But simply **drawing your end-of-turn reward card** and landing on exactly 6 does **not**
  force an immediate trade — that waits until your *next* turn's start, exactly like the
  5-or-6 rule in §3.6.
- The distinguishing trigger is **"winning cards via elimination mid-turn" vs "drawing your
  normal 1-card battle reward"** — only the former forces an immediate trade-down (and only
  when it reaches 6+, not 5).

No RGD-specific source was found that contradicts or restates this edge case, so the
engine should implement the rulebook's version verbatim pending in-app verification.

---

## 4. Combat

### 4.1 Dice rules (classic / "Manual Roll" / "True Random")

Official rulebook (p.5):
> "You, the attacker, will roll 1, 2 or 3 red dice: You must have at least one more army in
> your territory than the number of dice you roll."
> "The defender will roll either 1 or 2 white dice: To roll 2 dice, he or she must have at
> least 2 armies on the territory under attack."
> "To decide a battle. Compare the highest die each of you rolled. If yours (the attacker's)
> is higher, the defender loses one army... if each of you rolled more than one die, now
> compare the two next-highest dice and repeat the process."
> "In case of a tie... the defender always wins."
> "The attacker can never lose more than 2 armies on a single roll."
> "You must always have at least two armies in the territory you're attacking from."

RGD's own "WIKI - Manual Roll" article (direct fetch) restates this verbatim for its
True-Random manual-roll mode:
> "Manual rolls utilize a 'True Random algorithm as by design' and function identically to
> the original board game version of RISK."
> "The attacker (you) rolls 1, 2, or 3 dice. The attacker must have at least one more troop
> than the amount of dice they roll."
> "The defender rolls 1 or 2 dice. In order to roll 2 dice, the defender must have two or
> more troops in their territory."
> "Ties favor the defending player."
> "With manual roll you can only lose up to 2 troops at a time, whereas in Blitz roll the
> outcome is decided in just one dice roll."
— https://smgstudio.freshdesk.com/support/solutions/articles/11000121592-wiki-manual-roll

**Capitals dice augment:** when the "Capitals" game mode/modifier is active, a defender
occupying their capital territory rolls **3 dice instead of the normal 2**. Sources:
- GitHub, SMG Studio's own `risk-dice` repo: lists "Support for dice augments (Capitals,
  Zombies)" as a feature of the shipped battle-math code —
  https://github.com/smgstudio/risk-dice
- friendsofrisk.com's Blitz Calculator (built directly against SMG's published dice math):
  "It handles standard battles and capital scenarios where 'the defender rolls three dice
  instead of two.'" — https://friendsofrisk.com/blitz/
- Independently corroborated by community discussion: "When playing with the Capitals
  rule, the defender in a capital gets an extra dice in the capital." —
  https://steamcommunity.com/app/1128810/discussions/0/3272440173694069482/ (Steam user
  "steven1mac," May 22 2022 reply to "Do you have a bonus when you attack or when you
  defend?")

Three independent sources agree on this number, so confidence is high despite none of them
being SMG's own prose documentation in isolation (the GitHub repo IS SMG's own code,
however, which is itself a primary source).

### 4.2 Blitz ("roll until done")

RGD's "WIKI - Attack Blitz Roll" article (direct fetch):
> "The game will automatically be set to Attack Blitz Roll, which can be used to speed up
> gameplay by performing consecutive rolls with the best attacking option available (for
> example, 3 v 2). Blitz will finish when all committed troops are lost or the territory
> has been conquered."
> "Blitz has two options for algorithms used: Balanced and True Random, which you are able
> to select when creating a game."
> "You can change your rolling preference by pressing the left or right arrows next to the
> dice after selecting to attack a territory, which will default back to Blitz after each
> turn."
> "At the top of your screen is the Blitz Win Chance" (a displayed win-probability readout).
— https://smgstudio.freshdesk.com/support/solutions/articles/11000121588-wiki-attack-blitz-roll

A **Blitz Attack Limiter** / troop-limiting slider also exists, letting the player cap how
many troops are committed to a single Blitz resolution rather than always "all-in":
> "There is a slider option for Blitz allowing you to limit the amount of troops you
> dedicate to a battle."
— synthesized via WebSearch from Steam community/patch-note sources (secondary;
could not independently re-verify a specific patch-notes sentence this pass — flagged
medium confidence, but consistent with the general "Blitz Attack Limiter" feature name
found across multiple community threads).

### 4.3 "True Random" vs "Balanced Blitz" — exact mechanics

**True Random:** standard dice math, no reshaping — "Calculates actual probability
distributions for each possible battle outcome without modification," per WebSearch
synthesis of SMG's GitHub repo and support docs, and explicitly, per the "WIKI - Manual
Roll" article, True Random **is** the algorithm manual rolling always uses.

**Balanced Blitz** — SMG Studio's own GitHub README for `risk-dice` (direct fetch)
describes the implementation:
> "True Random (TR): Calculates actual probability distributions for each possible battle
> outcome without modification."
> "Balanced Blitz (BB): Adjusts true probabilities to create more balanced gameplay ...
> adjusting the true probabilities of every possible outcome in a given Risk battle."
> "For large battles, the brute-force method becomes computationally expensive. The code
> therefore employs an estimation technique ... using polynomial regression ... though this
> can result in discrepancies between the game and this code."
— https://github.com/smgstudio/risk-dice (README, fetched via raw.githubusercontent.com
mirror after the github.com page itself returned HTTP 402 to the fetch tool)

The **clearest plain-English mechanical description**, from friendsofrisk.com's Blitz
Calculator page (built to replicate SMG's exact published math), direct fetch:
> "Balanced Blitz ... computes the odds of every possible battle outcome from the true dice
> math, then reshapes them." The reshaping: "Outcomes with win/lose chances of 5% or less
> round to certainty"; "the luckiest and unluckiest 10% of outcomes are trimmed away";
> "likely outcomes are boosted."
> "every probability is computed, not simulated, so the numbers never wobble."
> Also references a "Blitz 100% chart" — i.e., a precomputed troop-ratio threshold above
> which Balanced Blitz always resolves as a certain win, due to the "5%-or-less rounds to
> certainty" rule.
— https://friendsofrisk.com/blitz/

A worked numeric example from the same GitHub README, direct fetch:
> "When attacking a capital with 30 troops vs 15 defending troops... Chance of losing
> exactly 12 troops: TR = 0.0222 vs BB = 0.0100" — i.e. Balanced Blitz measurably compresses
> the tails of the outcome distribution relative to True Random for the same matchup.

**Summary for engine implementation:** True Random = literal Monte-Carlo-equivalent dice
math (every round is an independent 1d6-vs-1d6 comparison exactly as in §4.1). Balanced
Blitz = compute the *full* outcome-probability distribution for the whole battle (attacker
troops vs defender troops) via brute force (or, for large stacks, polynomial-regression
estimation off smaller battles with the same ratio), then reshape that distribution by (a)
rounding any outcome bucket with ≤5% probability to 0% or 100%, (b) trimming the most
extreme 10% of outcomes from each tail, and (c) redistributing/boosting the remaining
"likely" outcomes — then sample the actual result from that reshaped distribution. This is
a **meaningfully different algorithm from "reroll bad dice"** — it is a whole-battle
probability reshape, not a per-roll adjustment.

Community/patch-note color (secondary, not verbatim-quoted): a "Blitz Dice" rebalance in
an update numbered "3.20" is referenced by community sources as having "completely
overhauled" the Balanced Blitz logic "to be more balanced and more predictable," and a
"3.3" update is cited as the point where SMG publicly released the `risk-dice` GitHub repo
— per WebSearch synthesis of Steam community/store news threads; exact version numbers
not independently re-verified against a primary patch-notes document this pass, flagged
medium confidence.

### 4.4 Dice-roll animation and troop-count UI

- Blitz mode displays a **"Blitz Win Chance"** percentage at the top of the attack screen
  before committing — https://smgstudio.freshdesk.com/support/solutions/articles/11000121588-wiki-attack-blitz-roll.
- A left/right-arrow control next to the dice lets the player toggle between Blitz and
  single/Manual rolls per-attack, resetting to Blitz by default each new turn — same
  source.
- RGD's own dice-strategy FAQ: "Avoid single dice rolls when attacking, as in the result of
  a tie on the dice the defender wins, so the odds are in their favour... If attacking a
  territory with the same number of troops as the defender, ensure that you have at least 5
  troops to attack with if you want the odds statistically in your favour." —
  https://smgstudio.freshdesk.com/support/solutions/articles/11000024992-risk-dice-rolling-tips
  (direct search-result synthesis; could not be independently re-fetched verbatim this
  pass for a direct quote — medium confidence on exact wording, high confidence on the
  underlying rule since it follows directly from §4.1's tie-goes-to-defender rule).
- Manual-vs-Blitz guidance from the "WIKI - Manual Roll" article: "Above 75% win rate: Blitz
  rolling yields significantly better outcomes. Below 25% win rate: Manual rolling provides
  superior odds. 25–75% range: Player preference."

### 4.5 Attacking from a territory with ≥2 troops; moving troops in after conquest

Official rulebook (p.5–6):
> "You must always have at least two armies in the territory you're attacking from."
> "Capturing territories. As soon as you defeat the last opposing army on a territory, you
> capture that territory and must occupy it immediately. To do so, move in at least as many
> armies as the number of dice you rolled in your last battle... You must always leave at
> least one army behind on the territory you attacked from."

So the **post-conquest troop-movement slider** must range:
- **Minimum** = number of dice used in the final, conquering roll (i.e., 1, 2, or 3).
- **Maximum** = all troops in the attacking territory **minus 1** (one must always remain
  behind).

This matches the task brief's expected slider bounds exactly. A "Move All" convenience
option (jump the slider to max) is a natural UI affordance; no explicit SMG citation for a
literal "Move All" button label was found this pass, but a community-sourced description
of the post-conquest control as a "Dual Troop transfer slider... on a 0–100% scale for
faster, more precise transfer" was found via WebSearch synthesis (secondary, exact wording
not independently verified — medium confidence) referencing player discussion at
https://steamcommunity.com/app/1128810/discussions/0/3194736442573903185/.

---

## 5. Fortify

Official rulebook (p.6, standard rule):
> "To fortify your position, move as many armies as you'd like from one (and only one) of
> your territories into one (and only one) of your adjacent territories... In moving your
> armies from one territory to another, you must leave at least one army behind."
> "No matter what you've done on your turn, you may, if you wish, end your turn by
> fortifying your position. You are not required to win a battle or even to try an attack
> to do so."

This is the **"adjacent only, one-to-one, once per turn"** baseline rule — i.e., the
physical board game's *standard* fortify is strictly adjacency-based, single
source-territory to single destination-territory, with ≥1 army always left behind, and is
entirely optional.

The print rulebook's own **optional "Rules Variations for RISK Experts"** section (p.8)
is the source of the "connected path through your own territories" variant:
> "Fortifying your position. At the end of your turn, you may move armies from one or more
> territories to any number of your other territories. However, before you can do this, you
> must occupy all the territories in between."

RGD's own "WIKI - Fortify" article (direct fetch) matches the wording of the **connected
path** variant far more closely than the strict-adjacency baseline, and is explicitly
described by the task brief's expectation that "RGD default = connected through own
territories":
> "Troops can only travel between connecting territories." [note: ambiguous phrasing —
> could describe either variant]
> "At least one troop must remain in the original territory."
> "The player can also skip the fortify phase."
> Strategic tip: "strengthen your borders you want to protect, such as the borders of a
> continent," implying multi-hop repositioning along a controlled front rather than a
> single adjacent hop.
— https://smgstudio.freshdesk.com/support/solutions/articles/11000121590-wiki-fortify

**This article does not unambiguously state whether RGD's one official in-app Fortify move
is a single-hop "adjacent" move, or a connected-path move through any number of
self-owned territories**, nor does it explicitly confirm the "once per turn" cap (though
context — "the final turn phase" — strongly implies it is a single action/phase, not
unlimited repeated moves). Community-sourced secondary summaries elsewhere (e.g.
duxaris.com) describe fortify as "moving troops from one territory to another connected
territory (following a continuous path of your own territories)" —
https://duxaris.com/beginners/how-to-play/ — which agrees with "connected path," not
strict single-hop adjacency.

**Recommendation for engine:** implement RGD's Fortify as the **connected-path variant**
(move any number of troops, minus 1 left behind at the source, from one source territory
to one destination territory, where a path of the mover's own territories must connect
them — i.e. a graph-reachability check through friendly-owned territories only), **once
per turn**, exactly as the task brief expected, since this is corroborated by both RGD's
own wiki wording and an independent secondary source, against only the base (non-RGD)
print-rulebook's stricter single-hop-adjacency default. Flag for later in-app
verification since no source gave an unambiguous, fully-quotable RGD-specific sentence
nailing down "any number of hops, one per turn."

---

## 6. Game options in RGD

### 6.1 Fog of War

Community-sourced description (WebSearch synthesis over Steam discussions and SMG's own
Freshdesk discussion titled "Fog of War in RISK map"):
> "In Fog of War, you can only view enemy positions in adjacent territories, while
> everything else is hidden. As you explore the map, the fog will be removed from adjacent
> territories within view."
> "You are unable to see your opponent's territories unless they are next to a territory you
> own, and you can't see which players own the other territories."
— synthesized from https://steamcommunity.com/app/1128810/discussions/0/4630359473422153173/
and https://smgstudio.freshdesk.com/support/discussions/topics/11000009602 (the Freshdesk
thread content itself returned only the KB shell on direct fetch this pass — medium
confidence on exact wording, but the mechanic description is consistent across multiple
independent community threads).

**Engine rule:** territories not adjacent to a territory you currently occupy are hidden —
owner identity and troop count both concealed; revealed territories update live as your
own territory holdings change.

### 6.2 Capitals

Win condition — official-adjacent/community-corroborated (no single verbatim SMG sentence
found, but highly consistent across sources including Wikipedia's "Capital" game-mode
description, duxaris.com, and Steam community):
> "The first player to capture every other player's capital while maintaining control of
> their own wins." / Wikipedia: Capital mode = "controlling every capital."
— https://en.wikipedia.org/wiki/Risk:_Global_Domination ("Capital ... controlling every
capital") and https://duxaris.com/beginners/how-to-play/ ("the player wins by controlling
every capital").

Note the Hasbro **print** rulebook's own "Capital RISK" variant (p.7, directly fetched) is
*not* "capture every capital" — it is a reduced-headquarters-count variant:
> "To capture all opposing Headquarters — while still controlling your own territory. If
> you wish, you may shorten the game even further: 4 players: Capture any 2 opposing
> Headquarters while controlling your own. 5 or 6 players: Capture any 3 opposing
> Headquarters while controlling your own."
> "If at any point your Headquarters is captured by an opponent, you are not eliminated
> from the game. Simply give your card to that opponent and continue playing."
> "You may not use a Headquarters card as part of a matched set of RISK cards."

**This is a contradiction/divergence worth flagging explicitly:** the print rulebook's
Capital Risk lets 4-, 5-, and 6-player games end on capturing only 2 or 3 opposing HQs (not
all of them), and losing your own HQ does **not** eliminate you — you just hand over the HQ
card. RGD's digital "Capitals" mode, per the community/Wikipedia sources above, is
described simply as "controlling every capital" with no stated partial-capture shortcut,
and separately, per §4.1, **the capital itself becomes a defensive strongpoint (+1
defender die)**, which has no equivalent at all in the print rulebook's Capital Risk
variant (which only changes the win condition, not combat dice). **These are clearly two
related-but-distinct implementations** — RGD's "Capitals" is not a straight digitization
of the print "Capital RISK" variant; it adds a brand-new dice mechanic and (per secondary
sources) drops the partial-capture shortcut and the "capture doesn't eliminate you"
clemency rule. Engine should implement **RGD's** version (every-capital win condition +
defender's 3rd die at the capital), not the print rulebook's Headquarters variant, per the
brief's framing of this as an "RGD" game mode.

Troop-count color (secondary, Steam community guide synthesis, medium confidence,
exact figures not independently re-verified):
> "The minimum amount of troops needed on a capital depends on the size of the map—for
> Classic maps, about 10 troops is standard, but for smaller maps like Simple World, this
> number can increase to even 20."
— via WebSearch synthesis referencing https://smgstudio.freshdesk.com/support/discussions/topics/11000009605
("Capital RISK game mode" Freshdesk discussion — content itself not independently
re-fetchable verbatim this pass).

### 6.3 Fixed / Progressive cards

See §3.4 — fully sourced there from SMG's own "WIKI - Card Trading" article and the "How
do I check if we're playing fixed or progressive" FAQ article, both directly fetched.

### 6.4 Blitz / True Random (dice algorithm selection)

See §4.2–4.3. Selected at game-creation time; per the "WIKI - Attack Blitz Roll" article,
"You are able to select your Blitz option when creating a game," i.e. this is a
per-lobby/per-game setting, not changeable mid-game (only the per-attack Blitz-vs-Manual
toggle is changeable live, and that toggle doesn't change *which* algorithm Blitz itself
uses — Manual Roll always uses True Random per §4.1/§4.3).

### 6.5 "Percentage Domination" ("70% World Domination")

**Primary, official, highest-confidence source found this pass** — an official SMG
Studio / RISK: Global Domination Facebook post announcing new game modes (captured via
WebSearch indexing of the Facebook post text):
> "⚠️ New Speedy Game Modes: for shorter games on the go: + 5-Rounds-Rumble: Rush to
> victory in 5 turns! + Percentage Domination: Whoever rules 70% of the world, wins!"
— https://m.facebook.com/riskglobaldomination/photos/a.628832297304715.1073741828.619495338238411/854337008087575/?type=3
(official RISK: Global Domination Facebook page post)

This **directly confirms the exact number is 70%** — "whoever rules 70% of the world,
wins" — i.e. the mode is literally named **Percentage Domination** in RGD's own
marketing, with 70% (of total territories on the current map, not a fixed "42") as the
trigger. Independently corroborated by community sources:
> "The '% Domination' setting is now a game modifier instead of a separate game mode...
> Custom rules and game modes available include 70% control."
— WebSearch synthesis over https://steamcommunity.com/app/1128810/discussions/0/1862742261532501806/

Also note from the same official Facebook post: a second "Speedy" mode, **"5-Rounds-Rumble"**
— explicit win/end condition after 5 full rounds (presumably highest-territory-count or
similar tiebreak at round-end; exact tiebreak rule not found this pass — flag as open
item).

### 6.6 Zombies mode

⚠️ Lower confidence section — the dedicated fandom wiki page
(https://risk-global-domination.fandom.com/wiki/Everything_you_need_to_know_about_Zombies!)
returned HTTP 402 on every direct-fetch attempt this pass (including via a
translate.goog mirror, which redirected back to the same blocked URL), so the following is
assembled entirely from WebSearch's indexed-snippet synthesis of that page and Steam
community threads — **treat all specific percentages below as unverified pending a
direct, successful fetch of the source**:

- "The Zombies mode is not cooperative—you cannot eliminate the zombies from the game
  permanently... if you temporarily accomplish this goal, they will respawn. The only way
  to truly defeat the zombies is after you have defeated every other player."
- "The zombies do not get bonus troops for territory count nor for owning continents."
- "Zombies multiply and outbreak based on AI difficulty and game round number. Outbreaks
  are random, but the higher the troop count in a territory, the higher [outbreak] number."
- "Zombies convert a certain % of defeated troops to Zombies" (exact % not found/verified).
- Possible specific thresholds surfaced by one WebSearch synthesis pass (medium-low
  confidence, could not cross-verify): "once zombies reach 50% of total troop count, they
  deploy 2 troops on each territory, and beyond 55% of total troop count the zombies only
  deploy 1 troop on every territory... they start the game deploying 60% rounded up on
  every territory they infect, one from each player" and "zombies infect half of the
  player's defending troops, rounded up" on conquering a territory.
- Officially, Zombie Apocalypse was a paid DLC/mode later made permanently free: "In
  October, Zombie Apocalypse mode was made free for all players, and it has been decided
  to keep the game mode available for everyone permanently" (via the Steam news post titled
  "ZOMBIE MODE IS HERE TO STAY," https://store.steampowered.com/news/app/1128810/view/605297383425704704
  — the news post's own body text could not be extracted verbatim this pass, only its
  WebSearch-indexed synthesis).
- Per SMG's own `risk-dice` GitHub repo, Zombies (like Capitals) is a supported **dice
  augment** in the battle-math code — https://github.com/smgstudio/risk-dice — implying
  zombie defense/attack rolls may use modified dice rules analogous to the Capitals +1-die
  bonus, but no specific number was found for Zombies' dice augment this pass (open item).

**Recommendation:** treat all Zombies-mode numbers above as provisional; re-derive from a
live client or a successfully-fetched fandom/Steam page before hard-coding percentages.

### 6.7 Alliances

No formal mechanical alliance system exists — it is purely a social/communication
convention with **no enforcement**:

> "The alliance mode is really just for better communication between players, though
> players often treat them as more formal agreements."
> "You can attack allies without their permission and without breaking the alliance, which
> is a significant mechanic in the game."
> "There are no rules protecting these agreements... alliance making/breaking can be one of
> the most important elements of the game."
— WebSearch synthesis over https://steamcommunity.com/app/1128810/discussions/0/3817418437348795632/
and related Steam community threads.

SMG's own Fair Play policy (directly relevant boundary condition, not an in-game mechanic):
> teaming up with a **real-life friend** against strangers in ranked/public games **is
> banned as cheating**, whereas ordinary in-game temporary alliances/betrayals between
> strangers are an intended, celebrated part of play — "RISK has one golden rule - the
> winner takes it all... all alliances are informal and temporary and meant to be broken as
> soon as you have an advantage," versus "if you play with a friend in Global Domination and
> ally up against strangers to defeat them, you will get banned because this is considered
> cheating."
— WebSearch synthesis referencing https://smgstudio.freshdesk.com/support/discussions/topics/11000017727
("Fair Play Rules") and https://smgstudio.freshdesk.com/support/solutions/articles/11000025091-is-risk-global-domination-based-on-official-rules-
context pages.

A community-requested (NOT currently implemented, per these sources) change was floated:
"if an alliance is accepted, allies cannot attack each other for a minimum of 2 turns, and
in order to attack the allied player one must break alliance" — this is a **feature
request**, not shipped RGD behavior; do not implement as if canonical.

**Engine implication:** alliances, if modeled at all for the replica, should be a
non-binding UI/communication affordance (e.g., a marker/ping system or chat shorthand)
with **zero rules enforcement** — any player can attack any "ally" at any time with no
penalty, exactly matching RGD's real behavior per the sources above.

### 6.8 Turn timer

Community-sourced (no single official SMG settings-list page fetched verbatim this pass
— medium confidence on the exact enumerated list, though the general existence and
"60-second default is most common in matchmaking" framing is well corroborated):
> "The game offers turn timer options with durations of 60s, 90s, 120s, 3m (180 seconds),
> and 5m (300 seconds)." "To change the turn timer duration... there will be a range of
> options including 'Turn Timer.'"
— WebSearch synthesis, and independently, a Steam discussion directly fetched (full thread
read) confirms 60 seconds as the common/default competitive value and that it's
adjustable per custom game:
> Steam user "Gan": "Claims 90% of available games use 60-second timers, making
> alternative games hard to find." Steam user "Wolf Theorem": "'60 seconds is the perfect
> amount of time for turns' for skilled players."
— https://steamcommunity.com/app/1128810/discussions/0/3806155895390235379/ (direct fetch
of the full thread; no official dev reply with an authoritative options list was present
in this thread).

A separate official Steam News post title found via search, "RISK: BOT OUT TIMER UPDATE,"
confirms there is also a distinct **"bot-out" timer** (auto-replacing an inactive/AFK
player's turn-taking with an AI bot after some timeout) as a related-but-separate system
from the per-turn countdown — https://store.steampowered.com/news/app/1128810/view/521969284864280608
(title only; body not fetched verbatim this pass).

### 6.9 Automated (auto) troops placement

This appears to be the **same toggle as §1.2's Manual-vs-Auto Placement**, not a separate
"auto-deploy during Draft" feature — no independent "Automated Troops Placement" setting
distinct from the start-of-game territory/army placement toggle was found despite
targeted searching. Recorded as: **Auto Placement = off by default is wrong — re-check**;
actually per sources, **Auto/Manual Placement governs START-OF-GAME territory claiming
only** — "Manual Placement is OFF by default, which means the computer places everyone's
units fairly randomly across the map... When Manual Placement is ON, it activates the
Claim Phase." No evidence found of an equivalent toggle affecting ongoing per-turn Draft
placement (i.e., players always manually place their own Draft reinforcements every turn
in RGD; there is no "auto-draft" assist found). Flag as resolved/non-issue: the brief's
"Automated troops placement" is almost certainly referring to the same start-of-game
Auto-vs-Manual Placement toggle documented in §1.2, not a separate per-turn system.

### 6.10 Team play (2v2, 3v3)

**RGD has no official, dedicated, mechanically-enforced team mode.** Per direct community
sourcing:
> "Team games are not yet an option in RISK: Global Domination - you can do what are
> essentially 2v2s, but you still have to beat each other in the end."
> "There is no team mode but you can team with people by clicking on them to select an
> option to team with them. However, if you team up with others, the game will still force
> you to fight until only 1 person remains."
— WebSearch synthesis over https://steamcommunity.com/app/1128810/discussions/0/6717729343877269912/
and https://steamcommunity.com/app/1128810/discussions/0/4627984302708927158/.

Workarounds players use (not an official feature): Pass-and-Play with 2 human + 2 AI
players on one device to simulate 2v2 against bots, or unofficial third-party
Discord-coordinated "2v2 risk servers." Community requests exist for a real "teams locked
into alliances for the whole game" mode (3v3, 2v2v2) but **this is unimplemented** as of
the sources found.

**Engine implication:** do not build a hard team-win-condition system as "parity with
RGD" — if teams are wanted for the replica, they would be a *new* feature beyond what RGD
itself ships, since RGD's own "teaming" is just the same unenforced alliance mechanic from
§6.7 applied cosmetically, with the underlying free-for-all elimination/last-player-standing
win condition unchanged.

---

## 7. Elimination and win conditions

### 7.1 Classic win condition

Official rulebook (p.6): "The winner is the first player to eliminate every opponent by
capturing all 42 territories on the board." RGD's Classic/"Global Domination" mode mirrors
this — Wikipedia: "controlling all 42 territories" —
https://en.wikipedia.org/wiki/Risk:_Global_Domination.

### 7.2 Capitals win condition

See §6.2 — "controlling every capital" (RGD's digital version), distinct from the print
rulebook's partial-Headquarters-capture Capital RISK variant.

### 7.3 Secret Mission / Secret Missions / Secret Assassin

Print rulebook's Secret Mission RISK (p.7): "To be the first player to complete the Mission
described on your own Mission card... The player who completes his or her mission first —
and reveals the Mission card to prove it — wins." Notably: "it is possible that you will
accomplish your mission with the aid (usually unintentional) of another player."

RGD ships (at least) two related digital modes confirmed via direct fetch of SMG's own
articles:
- **"Secret Missions"** — https://smgstudio.freshdesk.com/support/solutions/articles/11000135639-secret-missions
  — "The first player to achieve their mission wins the game." "Each player has their own
  mission to complete," concealed from opponents. "Secret Missions is currently not
  available to play in ranked."
- **"Secret Assassin"** — https://smgstudio.freshdesk.com/support/solutions/articles/11000133170-secret-assassin
  — a different mode: "Players receive hidden elimination targets... The first player to
  eliminate their target wins." Importantly: "Should your target be eliminated by another
  player, that opponent becomes your new objective" — i.e. assassination targets
  **re-chain** onto whoever actually lands the kill, continuously, rather than being a
  fixed roster like the print rulebook's Mission cards.

### 7.4 Elimination mechanics and dead players' cards

Official rulebook (p.6, directly quoted in full in §3.7 above): eliminating a player
transfers all of their Risk cards to you; if this pushes you to 6+ cards you must
immediately trade down to ≤4 (stopping at 4, 3, or 2); if it leaves you under 6 you wait
until your next turn. This is the authoritative rule; see §3.7 for full text and the
mid-turn-vs-end-of-turn-draw distinction.

No RGD-specific source was found that changes this elimination/card-transfer rule, so the
engine should implement it exactly as specified by the print rulebook pending in-app
verification.

---

## 8. Edge cases

1. **Attacking with exactly the dice you're capped at.** An attacker with exactly 2 armies
   in a territory may only ever roll 1 die (rulebook: "must have at least one more army...
   than the number of dice you roll" → with 2 armies, max dice = 1, since rolling 2 would
   require 3+ armies). A defender with exactly 1 army may only roll 1 die. A territory with
   exactly 1 army can never attack at all (needs ≥2 per §4.5's "always have at least two
   armies in the territory you're attacking from").
2. **Cards cap.** Practically, a player's hand should never exceed 6 cards under the
   official rulebook's logic, because reaching 5 or 6 at the start of a turn forces a
   trade-down (§3.6), and reaching 6+ via mid-turn elimination forces an immediate
   trade-down to ≤4 (§3.7). The engine should treat "hold 7+ cards" as an invalid/unreached
   state under normal rules, and should enforce the forced-trade checks at exactly the two
   trigger points identified: (a) start-of-turn with ≥5 cards, and (b) immediately upon
   inheriting an eliminated player's cards if that brings the total to ≥6.
3. **≥5 cards at turn start vs. mid-turn.** At turn **start**, holding 5 or 6 cards forces
   at least one trade-in (and allows a second if still holding a full set after the first).
   Reaching 5 or 6 cards **mid-turn** via your own normal 1-card battle-conquest draw does
   **not** force anything until your *next* turn starts (explicitly stated: "if this brings
   your total to 6, you must wait until your next turn to trade in"). Reaching 6+ cards
   **mid-turn specifically via eliminating another player and inheriting their hand** is the
   one case that forces an *immediate* (same-turn) trade-down, per §3.7. This
   three-way distinction (start-of-turn 5-or-6 vs. your-own-card-draw-to-6 vs.
   inherited-cards-to-6+) is the single most important and easy-to-get-wrong card-timing
   rule in the whole ruleset, and the engine must model all three branches distinctly.

---

## 9. UI vocabulary (for exact on-screen text parity)

Confirmed exact phase/feature names from SMG Studio's own support-article titles (these
are the article titles as published, i.e., effectively RGD's own internal terminology):
- **"Draft"** (turn phase 1 — reinforcement) — article "WIKI - Draft"
- **"Attack"** / **"Blitz Roll"** (turn phase 2 — combat) — article "WIKI - Attack Blitz Roll"
- **"Fortify"** (turn phase 3 — troop repositioning) — article "WIKI - Fortify"
- **"Card Trading"** (cards UI) — article "WIKI - Card Trading"
- **"Manual Roll"** (per-attack dice-mode toggle, opposite of Blitz) — article "WIKI - Manual Roll"
- **"Blitz Win Chance"** — the percentage readout shown before/during a Blitz attack
- **"Capitals"**, **"Fog of War"**, **"Percentage Domination"**, **"5-Rounds-Rumble"**,
  **"Secret Missions"**, **"Secret Assassin"**, **"Zombies"/"Zombie Apocalypse"** — mode/
  modifier names, confirmed via SMG's own articles (Secret Missions, Secret Assassin) and
  an official SMG/RISK Facebook post (Percentage Domination, 5-Rounds-Rumble).
- **"Manual Placement"** — the start-of-game territory/army placement toggle, confirmed via
  multiple community sources referencing the actual in-game settings label text.
- **"Balanced [Blitz]"** and **"True Random"** — the two selectable Blitz dice-algorithm
  names, confirmed via the "WIKI - Attack Blitz Roll" article ("Balanced and True Random").

All bulleted names above are reproduced because SMG itself uses them as article titles /
documented settings labels — i.e., they are very likely to be the literal in-app strings,
not just descriptive glosses. Exact capitalization/hyphenation of a few (e.g.
"5-Rounds-Rumble" vs "5 Rounds Rumble") comes from a single Facebook post and should be
double-checked against an actual client screenshot before being hard-coded into the
replica's localization strings.

---

## Sources

Primary (official rulebook / official developer):
- Hasbro/Parker Brothers, *RISK: The Game of Global Domination* instructions (2003
  edition), fetched as PDF from https://www.hasbro.com/common/documents/dad2886d1c4311ddbd0b0800200c9a66/61364C2119B9F369106F6DE955E8C10A.pdf
  (full 9-page rulebook read directly, including 2-player Neutral-army variant, Capital
  RISK, Secret Mission RISK, and the "Rules Variations for RISK Experts" appendix)
- Hasbro's alternate rulebook mirror (not separately diffed this pass): https://www.hasbro.com/common/instruct/risk.pdf
- Hasbro's modern official how-to-play microsite: https://www.hasbrorisk.com/howtoplay
- SMG Studio / RISK Freshdesk knowledge base (official support site):
  - "Is RISK: Global Domination based on official rules?" — https://smgstudio.freshdesk.com/support/solutions/articles/11000025091-is-risk-global-domination-based-on-official-rules-
  - "How do I check if we're playing fixed or progressive RISK bonus rules?" — https://smgstudio.freshdesk.com/support/solutions/articles/11000025058-how-do-i-check-if-we-re-playing-fixed-or-progressive-risk-bonus-rules-
  - "WIKI - Draft" — https://smgstudio.freshdesk.com/support/solutions/articles/11000121587-wiki-draft
  - "WIKI - Attack Blitz Roll" — https://smgstudio.freshdesk.com/support/solutions/articles/11000121588-wiki-attack-blitz-roll
  - "WIKI - Conquering Continents" — https://smgstudio.freshdesk.com/support/solutions/articles/11000121589-wiki-conquering-continents
  - "WIKI - Fortify" — https://smgstudio.freshdesk.com/support/solutions/articles/11000121590-wiki-fortify
  - "WIKI - Card Trading" — https://smgstudio.freshdesk.com/support/solutions/articles/11000121591-wiki-card-trading
  - "WIKI - Manual Roll" — https://smgstudio.freshdesk.com/support/solutions/articles/11000121592-wiki-manual-roll
  - "Secret Assassin" — https://smgstudio.freshdesk.com/support/solutions/articles/11000133170-secret-assassin
  - "Secret Missions" — https://smgstudio.freshdesk.com/support/solutions/articles/11000135639-secret-missions
  - "RISK dice rolling tips" — https://smgstudio.freshdesk.com/support/solutions/articles/11000024992-risk-dice-rolling-tips
  - "How to play guide" (index/landing page only, minimal content) — https://smgstudio.freshdesk.com/support/solutions/articles/11000074018-how-to-play-guide
  - HOW TO PLAY folder listing — https://smgstudio.freshdesk.com/support/solutions/folders/11000005113
  - Knowledge base root — https://smgstudio.freshdesk.com/support/solutions
  - "Capital RISK game mode" discussion (titles/snippets only; body not independently
    re-fetchable this pass) — https://smgstudio.freshdesk.com/support/discussions/topics/11000009605
  - "Fog of War in RISK map" discussion (titles/snippets only) — https://smgstudio.freshdesk.com/support/discussions/topics/11000009602
  - "Automatic territory selection + manual troop placement" discussion (titles/snippets
    only) — https://smgstudio.freshdesk.com/support/discussions/topics/11000009604
  - "Fair Play Rules" discussion — https://smgstudio.freshdesk.com/support/discussions/topics/11000017727
- SMG Studio's official `risk-dice` GitHub repository (shipped battle-math source/README):
  https://github.com/smgstudio/risk-dice (fetched via raw.githubusercontent.com mirror)
- Official RISK: Global Domination Facebook page, game-modes announcement post (Percentage
  Domination = 70%, 5-Rounds-Rumble): https://m.facebook.com/riskglobaldomination/photos/a.628832297304715.1073741828.619495338238411/854337008087575/?type=3
- Steam News, official SMG posts:
  - "ZOMBIE MODE IS HERE TO STAY" — https://store.steampowered.com/news/app/1128810/view/605297383425704704
  - "RISK: BOT OUT TIMER UPDATE" — https://store.steampowered.com/news/app/1128810/view/521969284864280608

Secondary (community math tools built against SMG's own published algorithms):
- friendsofrisk.com Blitz Calculator (Balanced Blitz exact math, capital 3-dice rule) —
  https://friendsofrisk.com/blitz/

Secondary (community / strategy / wiki / forum — used for corroboration, flagged
individually above wherever relied on for a specific number):
- Wikipedia, "Risk: Global Domination" — https://en.wikipedia.org/wiki/Risk:_Global_Domination
- Wikipedia, "Risk (game)" — https://en.wikipedia.org/wiki/Risk_(game)
- risk-global-domination.fandom.com — "1v1 Gameplay" (https://risk-global-domination.fandom.com/wiki/1v1_Gameplay),
  "Everything you need to know about Zombies!" (https://risk-global-domination.fandom.com/wiki/Everything_you_need_to_know_about_Zombies!),
  "Steam Version Details" (https://risk-global-domination.fandom.com/wiki/Steam_Version_Details),
  "World Conquest Map" (https://risk-global-domination.fandom.com/wiki/World_Conquest_Map),
  "SMG Article on Computer Randomness" (https://risk-global-domination.fandom.com/wiki/SMG_Article_on_Computer_Randomness)
  — **note:** every one of these fandom pages returned HTTP 402 on direct WebFetch this
  pass; any fandom-sourced claim above is a WebSearch-indexed-snippet synthesis only, not
  a verbatim-quoted fetch, and is flagged accordingly at point of use.
- duxaris.com — "How to Play Risk: Global Domination" (https://duxaris.com/beginners/how-to-play/),
  "What is Risk: Global Domination?" (https://duxaris.com/beginners/what-is-risk-global-domination/)
- steamah.com — "RISK: Global Domination - Beginners' Guide" — https://steamah.com/risk-global-domination-beginners-guide/
- levelwinner.com — "RISK: Global Domination Guide" — https://www.levelwinner.com/risk-global-domination-guide-tips-tricks-strategies/
- Steam Community discussions (various, cited inline above by thread URL), including:
  - Capital attack/defend bonus — https://steamcommunity.com/app/1128810/discussions/0/3272440173694069482/
  - Turn timer debate (full thread read) — https://steamcommunity.com/app/1128810/discussions/0/3806155895390235379/
  - Alliance rework request — https://steamcommunity.com/app/1128810/discussions/0/3817418437348795632/
  - Team mode status — https://steamcommunity.com/app/1128810/discussions/0/6717729343877269912/ and https://steamcommunity.com/app/1128810/discussions/0/4627984302708927158/
  - Fog of War — https://steamcommunity.com/app/1128810/discussions/0/4630359473422153173/
  - 70% domination % setting — https://steamcommunity.com/app/1128810/discussions/0/1862742261532501806/
  - Troop-movement slider — https://steamcommunity.com/app/1128810/discussions/0/3194736442573903185/

Explicitly NOT RGD (different product, cited only as contrast — do not treat as RGD
evidence):
- dominating12.com forums ("elimination and cards" thread) — https://dominating12.com/forums/2/general-discussion/631/elimination-and-cards
  — this is a separate, unofficial, fan-made online Risk implementation with its own
  house rules (e.g., double trade-in at 6–7 cards, wild+wild+1 sets allowed), not SMG
  Studio's RGD.

## Open items / needs in-app verification
- Exact Zombies-mode numeric thresholds (outbreak %, troop-conversion %) — fandom source
  blocked from direct fetch this pass; only WebSearch-snippet-level confidence.
- Exact enumerated turn-timer duration list (60/90/120/180/300s) — community-sourced only,
  no official settings-list page fetched verbatim.
- RGD's 1v1 (2-player) exact digital neutral-army figures — assumed to mirror the print
  rulebook's 40/40/40 + 14/14/14 split pending direct confirmation from a live client.
- Fortify's exact "once per turn" + connected-path wording — RGD's own wiki article is
  ambiguous on hop-count; recommendation given in §5 but flagged for verification.
- Forced-trade-threshold wording discrepancy ("5 or 6" per print rulebook vs. "exactly 5"
  per a tool-paraphrased RGD article) — see §3.6; recommend implementing "5 or more" as
  the safe interpretation.
- "5-Rounds-Rumble" end-of-round tiebreak rule — not found this pass.
- Zombies' specific dice-augment number (if any) — not found this pass, only that it
  exists as a supported "augment" in SMG's own dice-math code.
