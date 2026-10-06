# Research Brief — Risk (a browser replica of SMG Studio's *RISK: Global Domination*)

Consolidated from research lanes `00`–`06` (eight documents, ~8,500 lines), plus the machine-readable
map corpus in `research/map-data/` and 304 reference images catalogued in `04a-visual-evidence-index.md`.
This brief is the single document `SPEC.md` is derived from. Every number below names the lane file and
section it came from; where two lanes disagree, both readings are given and the ruling is stated.

Written 2026-10-05. Target: `Replicates/Risk/` — a Next.js 16 app, sibling of `island-empire`.

---

## 0. How to read this · evidence index

### 0.1 The lane documents

| Lane | File | What it settles |
|---|---|---|
| 00 | `00-repo-conventions.md` | Stack pins, port, scaffolding, engine/session/render layering, persistence, deploy, doc shapes |
| 01 | `01-core-rules.md` | Rules, cited to the 2003 Hasbro rulebook and SMG's own Freshdesk "WIKI -" articles |
| 02 | `02-maps-and-fan-code.md` | The 134-map SMG catalogue, the verified Classic graph, licence audit of every fan source, the 4-tier map plan |
| 03 | `03-ux-flow-modes-dialog.md` | Menus, modes, modifiers, HUD flow, chat/emote policy, identity, the 42-line dialog roster |
| 04 | `04-visual-design.md` | Art direction, measured palette, HUD geometry, motion, responsive, the design-token sheet |
| 04a | `04a-visual-evidence-index.md` | What each of the 304 reference files shows, and the coverage gaps |
| 05 | `05-bots-and-ai.md` | Persona architecture, tier table, exact dice maths, Balanced Blitz reverse-engineered, determinism rules |
| 06 | `06-online-play-free-tier.md` | Vercel Hobby / Neon free-tier limits, four evaluated options, the Option A schema + routes + protocol |

### 0.2 Evidence on disk

- `research/map-data/INDEX.json` — machine-readable index of every map source and its licence.
- `research/map-data/canonical/classic-world.json` — the verified 42/6/83 Classic graph with sea links,
  adjudication record and 9-source provenance (`02-maps-and-fan-code.md §A.2`).
- `research/map-data/totalrisk/` — Unlicense: `worldMap.svg`, `worldMapExtended.svg`, `napoleonMap.svg`
  plus the three matching JSON graphs (`02 §A.3`).
- `research/map-data/{risk-codelab,preeminence,conquete,conquest-tracker,gfceccon,risk-neighborhood}/` —
  permissive graph sources kept for provenance (`02 §A.2` table).
- `research/map-data/{naturalearth,topojson-atlas,wikimedia,country-borders}/` — public-domain/ISC
  geometry toolkit for generated maps (`02 §B.5`).
- `research/map-data/smg-catalogue/all-maps.json` — all 134 SMG maps: counts, packs, size bucket,
  blizzard/portal counts, per-region bonuses (`02 §A.1`).
- `research/screenshots/store/` (48), `screenshots/web/` (162), `screenshots/video/` (71),
  `screenshots/crop-*.png` (23) — all third-party copyrighted; reference only, never shipped
  (`04a` header). The official SMG "Basic Training" frames (`bt1`–`bt6`) are the clean 1600×900
  captures and the best pixel evidence (`04a §3`).

### 0.3 Confidence convention used throughout

- **[rulebook]** — the 2003 Hasbro/Parker Brothers PDF, read in full (`01 §9 Sources`).
- **[SMG]** — SMG Studio's own Freshdesk article, GitHub repo, or official social post.
- **[measured]** — recomputed or pixel-sampled in a lane (dice maths in `05 §4`–`§5`; hexes in `04 §2`).
- **[community]** — Steam/fandom/guide, corroborated but not first-party.
- **[ours]** — a decision for the replica with no RGD equivalent, flagged as a deviation.

### 0.4 Three traps the lanes found, recorded so nobody re-introduces them

1. **Never ship the Wikimedia "Risk board" SVGs.** `Risk_board.svg` / `Risk_game_board.svg` carry
   CC BY-SA tags but were traced from a retail Hasbro board, which the uploader had no right to
   license (`02 §B.5`). The brief's original assumption that a clean PD Risk SVG exists on Commons is
   wrong and must be unlearned.
2. **Never use the "attack with twice as many armies" rule.** It descends from Tan (1997), whose
   2v2 probabilities contain an independence error Osborne corrected; the real break-even is
   `A ≥ D + 1` (`05 §2.2`, `§2.3`, `§3.2`).
3. **Never clamp the win-chance table indices independently.** `W[min(A,128)][min(D,128)]` destroys the
   ratio and reads 129v381 (≈0%) as 85.65% (`05 §4.5`). Use the fitted logistic beyond the table.

---

## 1. What the product is, and what is in scope

### 1.1 The original

*RISK: Global Domination* (RGD), SMG Studio, published with Hasbro/Marmalade; Steam appid 1128810
(released 2020-02-19), iOS 1051334048, Google Play `com.hasbro.riskbigscreen` (`03 §0`, `04a §1`).
SMG built the digital ruleset with Hasbro over about a year, comparing the 1993, 2003 and 2010 Hasbro
rulesets and landing on *"the best combination of the 1993 and 2003 rules, which are very similar"*
**[SMG]** (`03 §0`). Turn structure is **Draft → Attack → Fortify**, named in SMG's own wiki article
titles (`01 §2.1`). The catalogue is **134 maps** (19–104 territories), of which only **2 are free**
(`02 §A.1`). Max **6 players** per game, humans + bots combined (`03 §2.4`).

Disambiguation, recorded because it poisoned early searches: the 2003 Atari/Cyberlore PS2 game of the
same name is a *different product* with its own "Generals" AI cast — never import it (`03 §0`). And
`dominating12.com` is an unrelated fan implementation whose house rules are not RGD's (`01` header).

### 1.2 Keep / trim

| Feature | RGD | Replica | Why |
|---|---|---|---|
| Solo vs bots, 2–6 seats | yes | **keep** | `03 §4.1` |
| Pass & Play hot-seat 2–6 | yes | **keep** | `03 §4.2`; hand-off overlay is ours (`03 §4.2` could not confirm RGD's) |
| Casual online play, lobby + code | yes | **keep** | `03 §4.3`; Option A architecture (`06 §0`) |
| 3-phase turn, Blitz/Manual, Blitz Win Chance | yes | **keep** | `01 §2.1`, `§4.2` |
| Fixed / Progressive cards | yes | **keep** | `01 §3.4` |
| Continent bonuses, Continent Overlay | yes | **keep** | `01 §2.3`, `04 §4.8` |
| Fog of War · Capitals · Percentage Domination · Blizzards · Portals · Max Rounds · Manual Placement · Turn Timer · Alliances toggle | yes | **keep** | `01 §6`, `03 §2.2`, `02 §A.1` |
| 12+ maps | 134 | **keep (12+)** | `02` Recommendation; Tier 1 + Tier 3 + Tier 4 |
| Preset chat + emote reactions | yes | **keep** | `03 §5` |
| Temporary discoverable account | platform-linked names | **keep, reshaped** | `03 §6`, `06 §4.5.2` |
| Rank/class label (flavour only) | Novice→Grandmaster | **trim** | `03 §1`, `§6` — monetised ladder |
| Gems, Tokens, Premium Pack play-gate | yes | **trim** | `03 §1` |
| Cosmetic shop: dice skins, avatar frames, troop counters, emote DLC | yes | **trim** | `03 §1`, `§5.2` |
| DLC map packs (~32) | yes | **trim** | `02 §A.1`; everything free |
| Zombies / Zombie Apocalypse | yes | **out of v1** | numbers unverified (`01 §6.6`); dice augment kept in the model (`05 §4.6`) |
| Secret Missions · Secret Assassin | yes | **out of v1** | `01 §7.3`, `03 §2.1` |
| Teams (2v2/3v3) | **not shipped** | **out of v1** | `01 §6.10`, `03 §4.4` — roadmap only; building it would not be parity |
| Ranked / leagues / seasons | yes | **out of v1** | `03 §6` |
| Friends list, Friend ID | yes | **out of v1** | `03 §1`; replaced by the 4-letter lobby code |
| Replay viewer, spectator mode | **not shipped** | **out of v1** | `03 §3`, `§4.5` — community asks for both |
| Tutorial ("Basic Training", 6 modules) | yes | **out of v1, designed for** | `04a §3`; the tip-card component is specified (`04 §4.18`) |

**Out of v1, listed as future:** Zombies, Secret Missions, Secret Assassin, teams, ranked/leagues,
shop/gems/tokens, cosmetics, friends list, replay viewer. *(Ruling 4.)*

---

## 2. Rules, with every number

### 2.1 Setup

**Starting armies** **[rulebook]** (`01 §1.1`): 3 players → 35, 4 → 30, 5 → 25, 6 → 20.
Two players use the rulebook's dedicated variant: **40 each plus a 40-army neutral set** (`01 §1.1`).

**2-player neutral buffer** **[rulebook]** (`01 §1.3`): remove the Mission cards and the 2 Wild cards,
deal the remaining 42 territory cards into three 14-card piles (14 + 14 + 14 = 42), one army on each of
your 14, your opponent's 14 and the neutral 14. Remaining armies alternate: *place 2 on any 1 or 2 of
your own territories, then 1 neutral army on any neutral territory*. Return the Wild cards and shuffle.
In play: **neutral armies never attack and never receive reinforcements**; the opposing human rolls the
defence for a neutral territory; you win by eliminating your opponent, not the neutrals (`01 §1.3`).
RGD's own 1v1 figures could not be confirmed (fandom page returned HTTP 402) — default to the rulebook
(`01 §1.3`, `§Open items`).

**Territory distribution** (`01 §1.2`, `03 §2.2`):
- **Auto Placement** (RGD default, Manual Placement = Off): the computer assigns territories *"fairly
  randomly across the map"* and places starting armies automatically **[community]**. The setup screen
  reads **`Setup: Auto`** (`04a §3`, frame `c3d-0001`).
- **Manual Placement = On** activates a **Claim Phase**: players alternate placing one army at a time
  until all territories are claimed, then alternate placing remaining armies **[rulebook]** (`01 §1.2`).
- No per-turn "auto-draft" exists; the brief's "automated troops placement" is the same toggle
  (`01 §6.9`).

**Seat order** **[rulebook]** (`01 §1.4`): highest single die roll takes the first placement and the
first turn; reroll ties (convention, not in the excerpt). **[ours]** The resolver draws seat order and
the opening deal together in one `dealTerritories(...)` call so one action carries the whole opening.

**Decision (ruling 1).** Seat order and the opening deal are produced by the resolver and carried in the
`game_started` action at `seq = 1` — public information anyway (`06 §5.2`).

### 2.2 Draft (phase 1)

**Formula** **[rulebook + SMG, verbatim agreement]** (`01 §2.2`):
`reinforcements = max(3, floor(territoriesOwned / 3))`. SMG's own "WIKI - Draft" restates it:
*"16 territories / 3 = 5 troops… cannot be less than 3."* Rulebook examples: 11→3, 14→4, 17→5.

**Continent bonuses, Classic map** **[SMG, direct fetch]** (`01 §2.3`; same values in
`02 §A.2` and `map-data/canonical/classic-world.json`): Africa **3**, Asia **7**, Australia **2**,
Europe **5**, North America **5**, South America **2** (total 24). Control is checked **at the start of
the owner's turn** (`01 §2.3`).

**Rules** (`01 §2.4`, `03 §3`): all drafted troops must be placed before advancing; troops may go on any
owned territory; a numeric stepper/slider opens on territory tap. The card-trade bonus is added into the
same counter.

### 2.3 Cards

**Deck** **[rulebook]** (`01 §3.1`): 56 cards = 42 territory cards (Infantry / Cavalry / Artillery) +
2 Wild + 12 Mission (Mission cards used only in Secret Mission Risk, excluded from v1). RGD names four
families: Infantry, Cavalry, Artillery, **Joker/Wild** **[SMG]** (`01 §3.1`).

**Earning** **[rulebook + SMG]** (`01 §3.2`): exactly **one** card at the end of any turn in which you
captured at least one territory, no matter how many you captured.

**Valid sets** **[rulebook + SMG, identical]** (`01 §3.3`): three of a kind · one of each · any two plus
a Wild.

**Fixed values** **[SMG, direct fetch]** (`01 §3.4`): Infantry×3 = **4**, Cavalry×3 = **6**,
Artillery×3 = **8**, one-of-each (or any set using a Wild) = **10**. The in-game Bonus legend prints
exactly `4 Infantry · 6 Cavalry · 8 Artillery · 10 All Three` (`04 §4.11`, `04a` crop
`crop-card-bonus-legend.png`). Lane 03 adds a **cap of 12 per trade-in including the territory bonus**
**[community]** (`03 §2.2`) — which is just 10 + 2, consistent with `01 §3.5`.

**Progressive values** **[rulebook + SMG, verbatim agreement]** (`01 §3.4`): 4, 6, 8, 10, 12, 15, then
**+5 per set forever**: 20, 25, 30, 35, 40, 45, 50, 55, 60, …

> The rulebook's *optional* "Rules Variations for RISK Experts" slower scheme (4,5,6,7…) is **not** an
> RGD option; recorded only so it is not confused with Progressive (`01 §3.4`).
> Lane 05 §3.1 notes SMG's sandbox docs also list **Exponential** and **Per-Player** card modes; no
> numbers were found. **[ours]** Out of v1.

**Territory bonus** **[rulebook + SMG]** (`01 §3.5`): if a traded card shows a territory you occupy,
**+2 armies placed directly on that territory**, capped at **+2 total per turn** regardless of how many
traded cards match.

**The three card-timing branches — model all three distinctly** (`01 §3.6`, `§3.7`, `§8.3`):

1. **Start of turn with 5 or 6 cards** → you **must** trade at least one set, and **may** trade a second
   if you still hold one **[rulebook]**. SMG's article was paraphrased as *"exactly 5"*; the lane's
   assessment is that this is loose phrasing for "5 or more" and the rulebook wins (`01 §3.6`).
   **Ruling: implement "≥5 at turn start forces at least one set".**
2. **Drawing your own end-of-turn reward card to 5 or 6** → forces **nothing** now; the check happens at
   the start of your next turn. Rulebook, verbatim: *"if this brings your total to 6, you must wait until
   your next turn to trade in"* (`01 §3.7`).
3. **Inheriting an eliminated player's hand mid-turn to 6 or more** → **immediate**, same-turn forced
   trade-down to **≤4**, one set at a time, stopping as soon as you reach **4, 3 or 2** (`01 §3.7`).
   If the inheritance leaves you under 6, you wait until your next turn.

**Elimination transfers the whole hand** **[rulebook]** (`01 §3.7`, `§7.4`). Practically a hand never
exceeds 6; treat 7+ as unreachable and assert it (`01 §8.2`).

### 2.4 Attack (phase 2) — dice

**Core rules** **[rulebook + SMG "WIKI - Manual Roll", verbatim]** (`01 §4.1`):
- Attacker rolls 1, 2 or 3 dice and must hold **at least one more army than dice rolled**.
- Defender rolls 1 or 2 dice; 2 requires **≥2 armies** on the defending territory.
- Compare highest vs highest, then second vs second. **Ties go to the defender.**
- The attacker can never lose more than 2 armies in a single roll.
- You must always have **≥2 armies** in the territory you attack from.
- Manual Roll always uses **True Random**, *"as by design"*, and *"function[s] identically to the
  original board game"* **[SMG]**.

**Edge cases** (`01 §8.1`): 2 armies → max 1 attacking die; 1 army → cannot attack at all; defender with
1 army rolls 1 die.

**The six single-roll distributions — exhaustively enumerated, exact fractions** **[measured]**
(`05 §4.1`):

| Roll | Outcomes | Att loses 0 | Att loses 1 | Att loses 2 | Fractions |
|---|---|---|---|---|---|
| 3 v 2 | 7,776 | 37.1656% | 33.5777% | 29.2567% | 2890 / 2611 / 2275 over 7776 |
| 3 v 1 | 1,296 | 65.9722% | 34.0278% | — | 855 / 441 over 1296 |
| 2 v 2 | 1,296 | 22.7623% | 32.4074% | 44.8302% | 295 / 420 / 581 over 1296 |
| 2 v 1 | 216 | 57.8704% | 42.1296% | — | 125 / 91 over 216 |
| 1 v 2 | 216 | 25.4630% | 74.5370% | — | 55 / 161 over 216 |
| 1 v 1 | 36 | 41.6667% | 58.3333% | — | 15 / 21 over 36 |

Cross-check: SMG's own `risk-dice` README prints `AttackLossChances[2] = 0.292566872427984`; the lane's
enumeration gives `2275/7776 = 0.2925668724279835` — **exact match**, first-party confirmation that RGD
uses textbook ties-to-defender rules (`05 §4.1`). Osborne's published Table 2 agrees independently, so
three derivations concur (`05 §2.2`).

**Expected casualties per roll** **[measured]** (`05 §4.2`):

| Roll | E[att loss] | E[def loss] | def per att |
|---|---|---|---|
| 3 v 2 | 0.9209 | 1.0791 | **1.172** |
| 3 v 1 | 0.3403 | 0.6597 | 1.939 |
| 2 v 2 | 1.2207 | 0.7793 | 0.638 |
| 2 v 1 | 0.4213 | 0.5787 | 1.374 |
| 1 v 2 | 0.7454 | 0.2546 | 0.342 |
| 1 v 1 | 0.5833 | 0.4167 | 0.714 |

3v2 is only a 1.172 : 1 edge; 2v2 and 1v2 are *losing* trades. Bot gate that follows: **never initiate
from a territory with fewer than 4 troops** unless the target holds 1 or the move completes/denies a
continent (`05 §4.2`).

**Full-battle win probability — the DP** **[measured]** (`05 §4.3`). `A` excludes the army that must
stay behind, matching SMG's own convention (*"do not include the single attack troop that stays
behind"*), so a 20-army territory attacking 10 is `BattleConfig(19, 10, 0)`:

```
a = min(A,3); d = min(D,2); c = min(a,d); r[a][d][k] = P(attacker loses k of c)   // §2.4 table
W[A][0] = 1   for all A ≥ 0
W[0][D] = 0   for all D ≥ 1
W[A][D] = Σ(k = 0..c)  r[a][d][k] · W[A−k][D−(c−k)]
```

Solved by DP in reverse lexicographic order of `A+D` (every transition decreases `A+D` by exactly
`c ≥ 1`): **O(A·D)**, exact to floating point, no matrix inversion. Validation against the one large
number SMG publish — 300 attackers vs 800 zombies, their `0.8897331` — the lane's DP returns
`0.8897332621740284`, agreeing to 7 significant figures (`05 §4.3`).

For the **full outcome distribution** (needed for Balanced Blitz and for `sunkCost`) run the same
recursion forward: `attackLoss[i<A]` = P(win having lost i), `attackLoss[A]` = P(lose the battle);
`defendLoss[j<D]` = P(defender wins having lost j), `defendLoss[D]` = P(attacker wins) (`05 §4.3`).

**Reference conquer odds, standard 3v2, %** (`05 §4.4`, rows = A excluding the garrison):

| A\D | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 41.67 | 10.61 | 2.70 | 0.69 | 0.18 | 0.04 | 0.00 | 0.00 | 0.00 |
| 2 | 75.42 | 36.27 | 20.61 | 9.13 | 4.91 | 2.14 | 0.49 | 0.11 | 0.03 |
| 3 | 91.64 | 65.60 | 47.03 | 31.50 | 20.59 | 13.37 | 5.35 | 2.08 | 0.79 |
| 5 | 99.03 | 88.98 | 76.94 | 63.83 | 50.62 | 39.68 | 22.40 | 11.83 | 5.94 |
| 8 | 99.96 | 98.03 | 94.68 | 88.78 | 81.84 | 72.96 | 54.74 | 37.99 | 24.70 |
| 10 | 100.00 | 99.42 | 98.11 | 95.39 | 91.63 | 86.11 | 72.40 | 56.76 | 41.75 |
| 15 | 100.00 | 99.98 | 99.87 | 99.60 | 99.02 | 98.06 | 94.32 | 87.70 | 78.28 |
| 20 | 100.00 | 100.00 | 99.99 | 99.97 | 99.91 | 99.78 | 99.11 | 97.47 | 94.29 |

(Full 20×12 table in `05 §4.4`.) Break-evens: `D=1→A=2`, `2→3`, `3→4`, `5→5`, `10→10`, `20→18`,
`30→27`, `50→44`; for ≥80%: `1→3`, `2→5`, `3→6`, `5→8`, `10→14`, `20→24`, `30→34`, `50→53`
(`05 §4.4`). Parity is roughly a coin flip at small scale and *favours the attacker* at large scale
because the attacker rolls more dice.

**Correct gate: `A ≥ D + 1`** (every `A = D+1` cell sits just above 50%: 0.754, 0.656, 0.642, 0.638,
0.640, 0.643, 0.646, 0.650), and **`A = D ≥ 5` is already favourable** (Osborne) (`05 §3.2`, `§2.2`).

### 2.5 Blitz, the attack limiter, and Balanced Blitz

**Blitz** **[SMG]** (`01 §4.2`): the default each turn; performs *"consecutive rolls with the best
attacking option available (for example, 3 v 2)"* and *"will finish when all committed troops are lost
or the territory has been conquered."* Per-attack ◀ ▶ steppers toggle Blitz ↔ manual dice counts and
**reset to Blitz every new turn** (`01 §4.2`, `03 §3-2`). A **Blitz Win Chance** percentage shows at the
top of the attack screen (`01 §4.2`, `04 §4.9`).

**Attack Limiter** (`01 §4.2` **[community]**, `04 §4.9` **[measured]**): a slider capping how many
troops are committed; the HUD reads `100%` over `7/7 Troops`. SMG's dice code models it as `stopUntil`,
which truncates the distribution and introduces a third `UnresolvedChance` outcome (`05 §2.13`).
**Every published odds table assumes fight-to-the-death**, so with a stop rule those probabilities are
*lower bounds* on the value of attacking; optimal withdrawal is unsolved and we must not claim
optimality for our stop rule (`05 §2.13`).

**Balanced Blitz — fully reverse-engineered** **[SMG source + measured]** (`05 §5`). It is **not** a
dice filter and **not** a streak-breaker: it computes the exact whole-battle outcome distribution,
reshapes it, and draws **one** sample. Hence SMG's own constraint that Balanced Blitz only supports the
`OddsBasedBattle` method — one random float resolves the entire battle (`05 §5.1`).

Default constants from `Core/Config/BalanceConfig.cs` (`05 §5.2`):

```
winChanceCutoff = 0.05
winChancePower  = 1.3
outcomeCutoff   = 0.10
outcomePower    = 1.8
```

`ApplyBalance()` runs four stages **in this order** (`05 §5.2`):

1. **`ApplyWinChanceCutoff` (0.05)** — if either side's overall win chance is ≤ 0.05 it snaps to **0%**
   and the other to **100%**; the losing side collapses onto its "lost everything" entry and the winner
   renormalises. SMG's own comment: *"97% win chance with a 5% cutoff will turn into 100% win chance."*
   This is literally the source of the community "5 vs 1 wins 100%" complaint, and it is intended.
2. **`ApplyWinChancePower` (1.3)** — push the overall win chance toward the favourite:
   `w' = w^p / (w^p + (1−w)^p)`. Fixed point at `w = 0.5`, monotone. Each side's outcome array is
   renormalised to its new total. Verified against SMG's inline examples at `p = 1.4`: 56.8→59.46%,
   43.2→40.54%, 86.1→92.78% — exact agreement.
3. **`ApplyOutcomeCutoff` (0.10)** — concatenate the attacker-side and defender-side arrays into one
   distribution ordered most-favourable-to-attacker → most-favourable-to-defender, then **shave 10% of
   probability mass off each tail** (walk in from each end zeroing entries until the cut reaches 0.10,
   partially trimming the straddling entry), then renormalise. This is the real "no extreme streaks"
   mechanism: crushing wins and catastrophic losses become *literally impossible*, not merely rare.
4. **`ApplyOutcomePower` (1.8)** — raise every individual outcome probability to the power 1.8 and
   renormalise each side **preserving the win chance set by stages 1–3**. Sharpens around the mode;
   per SMG's comment it *"will NOT change the overall win chance or make any currently existing outcomes
   impossible or certain."*

**Bit-exact validation** (`05 §5.3`) — SMG README example 3, chance of losing exactly 12 of 30 troops
attacking a **capital** held by 15 (defender rolls 3 dice):

| | SMG published | Lane reimplementation |
|---|---|---|
| True Random | `0.0222128001707278` | `0.0222128001707278` |
| Balanced Blitz | `0.0100282888709122` | `0.0100282888709122` |

Identical to all 16 printed digits, both modes. README example 6 — fewest attackers for ≥80% BB win
chance against 50 defenders — SMG print **49**; the lane's pipeline gives A=47 → 72.03%, A=48 → 77.10%,
**A=49 → 82.15%** (first ≥80%), A=50 → 86.35%. Note the win-chance-power stage *alone* gives only 75.7%
at A=49: any implementation modelling BB as "just raise the odds to a power" is visibly wrong.

**How BB changes the game** **[measured]** (`05 §5.4`):

| A v D | True Random | Balanced Blitz | Δ pp |
|---|---|---|---|
| 3 v 3 | 47.03% | 45.17% | −1.86 |
| 4 v 4 | 47.65% | 46.19% | −1.46 |
| 5 v 5 | 50.62% | 51.01% | +0.39 |
| 10 v 10 | 56.76% | 60.94% | +4.18 |
| 20 v 20 | 63.34% | 71.33% | +7.99 |
| 2 v 1 | 75.42% | 88.90% | **+13.47** |
| 3 v 2 | 65.60% | 74.78% | +9.18 |
| 5 v 3 | 76.94% | 90.91% | **+13.97** |
| 10 v 8 | 72.40% | 84.74% | +12.34 |
| **20 v 15** | 86.04% | **100.00%** | **+13.96** |

Three consequences: (a) **the break-even does not move** — the minimum `A` to be a favourite is
identical in both modes at every `D` tested, so `A ≥ D+1` is one rule for both; (b) the *payoff* of a
favourable attack is amplified +8 to +14 points while marginal underdogs get ~1.5 points worse, so BB
**rewards patience and punishes coin-flips** and a bot should *raise* `minWinChance` under BB; (c)
strong attacks become **certain** — anything past 95% snaps to 100%, which lets a BB-aware bot chain
conquests with no hedging (`05 §5.4`).

**Decision (ruling 1 + 5).** Build **one odds table per dice mode** and hand the bot the one matching
the match setting — a bot using the TR table in a BB game underestimates its own odds by up to 14
points. This is a correctness issue, not tuning (`05 §5.4`). Expose a `certainWin` predicate
(`W_bb ≥ 1 − ε`).

**SMG's large-battle fallback is a deliberate divergence**: SMG admit they fall back to polynomial
regression over smaller same-ratio battles for big stacks, that *"the estimation source code is not
provided"*, and that it *"can result in discrepancies between the game and this code"* (`05 §5.5`,
`01 §4.3`). Our DP is O(A·D) and fast, so **we use the exact DP at all sizes and are more accurate than
RGD** — record it as intentional, not a bug.

**Licence note, load-bearing** (`05 §5.5`): `risk-dice` is **not open source** — it grants only a
*"non-exclusive, limited right to use and install one (1) copy … for internal evaluation purposes
only"* and forbids reproduction. The four constants and the staged algorithm are facts about the game's
behaviour; the C# source text is theirs. **Write our own implementation from this spec; never copy or
vendor the repo.**

### 2.6 Post-conquest move

**[rulebook]** (`01 §4.5`): on taking the last defending army you must occupy immediately, moving in
**at least as many armies as the number of dice rolled in the final battle** (1, 2 or 3), and must leave
**at least one** behind. So the slider range is `[dice used in the conquering roll … sourceTroops − 1]`.
SMG's own "WIKI - Attack Blitz Roll" states the Blitz form: conquering after attacking with 3+ troops
**requires moving a minimum of 3** (`03 §3-2`). A "Move All" jump-to-max is a natural affordance; no SMG
label was found (`01 §4.5`) — **[ours]**.

UI: reuse the shared count slider with the title **`Move Troops`** and the fortify chevron path drawn
between the two territories (`04 §4.12`; no dedicated frame exists — `04 §9.6`).

### 2.7 Fortify (phase 3)

**RGD = the connected-path variant, once per turn** (`01 §5` ruling; `03 §2.5`, `§3-3`). Evidence:
SMG's "WIKI - Fortify" says *"Troops can only travel between connecting territories"*, *"At least one
troop must remain in the original territory"*, and *"The player can also skip the fortify phase"*; its
strategic tip about strengthening *"the borders of a continent"* implies multi-hop repositioning. The
print rulebook's **standard** fortify is single-hop adjacency; the **expert variant** (p.8) is
*"you may move armies from one or more territories to any number of your other territories… you must
occupy all the territories in between"* — the connected-path rule. duxaris independently describes RGD
fortify as *"following a continuous path of your own territories"* (`01 §5`).

**Ruling:** one fortify action per turn — one source, one destination, any number of troops minus the 1
left behind, with a **graph-reachability check through friendly-owned territories only**. Confirmed by
SMG's own tutorial tip cards: *"You can only fortify once per turn"* and *"Fortify is optional and can
be skipped"* (`04a §3`, frames `bt4-0036`, `bt4-0120`). Attacking, unlike fortifying, requires **direct**
adjacency (or an explicit dashed sea route) (`03 §2.5`).

### 2.8 Modifiers and modes in scope

| Modifier | Numbers | Source |
|---|---|---|
| **World / Global Domination** | conquer every territory | `01 §7.1` |
| **Percentage Domination** | **70%** of the current map's territories (not a fixed 42); official SMG/RISK Facebook post: *"Percentage Domination: Whoever rules 70% of the world, wins!"*. Became a *modifier*, i.e. an adjustable number, not a separate mode | `01 §6.5`, `03 §2.2` |
| **Capitals** | every player gets a capital at start; win by holding **every** capital; **defender at a capital rolls 3 dice instead of 2** (3 independent sources incl. SMG's own `risk-dice`) | `01 §4.1`, `§6.2`, `03 §2.1` |
| **Fog of War** | territories not adjacent to one you occupy are hidden — **owner identity and troop count both concealed**; reveals update live as holdings change | `01 §6.1` |
| **Card Bonus** | Fixed / Progressive, chosen at creation | `01 §3.4`, `§6.3` |
| **Dice Rolls** | Balanced Blitz / True Random, chosen at creation, fixed for the match; Manual Roll is always True Random per roll | `01 §4.3`, `§6.4` |
| **Blizzards** | per-map count **2–11**, scaling with size; the tile becomes an impassable, unconquerable blockade for the whole game; **does not block the region bonus** — you still hold the bonus if you own all the *other* territories | `02 §A.1` |
| **Portals** | per-map count **3–7**; randomised each game; link two non-adjacent territories as dynamic extra edges; **Stable** = fixed all game, always active; **Unstable** = relocates every few turns and is inactive for one turn after moving | `02 §A.1` |
| **Manual Placement** | On/Off, Off = default | `01 §1.2`, `03 §2.2` |
| **Max Rounds** | a modifier, not a mode; **5-Rounds Rumble = Max Rounds 5** (official FB post); lane 03 describes "Fast Blitz" as *whoever owns more territory than everyone else when turn 5 ends* | `01 §6.5`, `03 §2.1`, `§2.2` |
| **Round Delay** | exists as a modifier | `03 §2.2` |
| **Turn Timer** | **60 / 90 / 120 / 180 / 300 s**, covering the *whole* turn (all three phases); ~90% of hosted online games use 60 s; the setup screen reads `Turn Timer: 60s` | `01 §6.8`, `03 §2.2`, `§4.3`, `04a §3` |
| **Alliances** | On/Off per game (`Alliances: Off` on the setup screen); **non-binding** — no "cannot attack ally" lock, attacking an ally breaks nothing; request/accept between two players; ally-only preset lines | `01 §6.7`, `03 §2.2`, `§4.6`, `04a §3` |
| **AI Difficulty** | Beginner / Easy / Medium / Hard / Expert — see §6 | `05 §1.2` |

**Max Rounds tiebreak** is unresolved in the sources (`01 §6.5`, `§Open items`).
**Ruling 4: tiebreak = most territories, then most troops.** **[ours]**

**Percentage Domination range.** Only 70% is sourced. **Ruling 4: default 70%, adjustable 50–90%.**
**[ours]**, consistent with it being "a game modifier instead of a separate game mode" (`01 §6.5`).

### 2.9 Elimination and win conditions

- **World Domination:** eliminate every opponent by capturing all territories **[rulebook]**
  (`01 §7.1`).
- **Percentage Domination:** first to the threshold share of the map (`01 §6.5`).
- **Capitals:** hold every capital (`01 §6.2`). The print rulebook's "Capital RISK" is a *different*
  variant — 4 players capture any 2 opposing HQs, 5–6 players any 3, and losing your own HQ does **not**
  eliminate you (you hand over the card) — and it has no dice mechanic at all. **These are two distinct
  implementations; implement RGD's** (`01 §6.2`).
- **Max Rounds:** highest territory count at the end of the last round, then troops **[ours]**.
- Eliminating a player transfers their whole card hand, with the §2.3 branch-3 forced trade-down
  (`01 §3.7`, `§7.4`).
- A player with 0 territories is eliminated; the game can stall if a reduced opponent is never finished
  off — a corner case to design around (`03 §3`).

### 2.10 Edge cases to encode as tests

1. 2 armies → 1 attacking die; 1 army → cannot attack; defender with 1 army → 1 die (`01 §8.1`).
2. Hand never exceeds 6 under the two trigger points; 7+ is an invalid state (`01 §8.2`).
3. The three-way card-timing distinction (`01 §8.3`) — *"the single most important and easy-to-get-wrong
   card-timing rule in the whole ruleset"*.
4. Blizzard tiles still count toward their region's bonus (`02 §A.1`).
5. Capital dice augment is `defendDice = min(D, 3)`, so it is **identical to standard play when the
   defender holds 1 or 2 troops** — it only bites at `D ≥ 3` (`05 §4.6`).
6. Augments **stack**: SMG state *"These also STACK!"*, so a capital behind a wall gives the defender up
   to 4 dice (`05 §1.1`, `§4.6`).
7. Neutral armies in 2-player: never attack, never reinforce, defended by the opposing human
   (`01 §1.3`).

---

## 3. Maps

### 3.1 The honest finding

**No public source documents adjacency for ANY SMG map** except Classic (`02 §TL;DR 2`, `§A.3`). The
Fandom catalogue gives each map's *shape* — territory count, region count, map pack, size bucket,
blizzard/portal counts, per-region bonuses — but never which territory touches which. Map layouts exist
only as flat PNGs of SMG's own artwork. Licences were checked individually on Domination (107 maps),
Lux Delux (1000+), Warzone, TripleA (343 repos) and MapGenie (~120 graphs that mirror SMG's catalogue
almost exactly): **all are unlicensed, proprietary or copyleft** (`02 §TL;DR 2`, `§B.4`). MapGenie is the
closest thing to "adjacency for the SMG maps" that exists and is unusable.

So the route to 12+ maps is **generating them from public-domain geodata**, not finding them
(`02 §TL;DR 6`).

### 3.2 Tier 1 — ship immediately (3 maps, real geometry, zero work)

| Map | T | Regions | Edges | Geometry | Licence | Confidence |
|---|---|---|---|---|---|---|
| **Classic world** | 42 | 6 | 83 | `totalrisk/worldMap.svg` (1024×643) **or** `risk-codelab/board.svg` (800×540) | Unlicense / Apache-2.0 | **HIGHEST** |
| **World Extended** | 47 | 6 | 94 | `totalrisk/worldMapExtended.svg` | Unlicense | MEDIUM (one asymmetric edge, Kamchatka→Hawaii, repaired) |
| **Napoleonic Europe** | 59 | 11 | 127 | `totalrisk/napoleonMap.svg` | Unlicense | MEDIUM-HIGH (fully symmetric, no repairs) |

(`02 §A.3`, `map-data/INDEX.json`.) Geometry was verified territory-by-territory against SVG `id`
attributes: **42/42, 47/47, 59/59**, plus all 6/6/11 continent group ids (`02 §A.3`).

Note the naming: SMG has no map called "Napoleonic Europe" — it ships a *Napoleon's Battles* pack of
79–97-territory battle maps. "Napoleonic Europe" is TotalRisk's own fan map (`02 §A.1` corrections).
Likewise SMG's 47-territory world map is **World Conquest** (Premium), not "World Extended" (`02 §A.1`).

**Two loader gotchas** (`02 §A.3`): attribute order in the TotalRisk SVGs is `d=` **before** `id=`, so a
naive `id="X"[^>]*d=` regex finds nothing — match on the element, not attribute order. And territory
names containing `&` appear HTML-escaped (`id="Aragon &amp; Castile"`); decode entities first or 8 of
Napoleonic Europe's 59 territories silently fail to bind.

### 3.3 The Classic graph — exact and adjudicated

**42 territories · 6 continents · 83 undirected edges** (`02 §A.2`,
`map-data/canonical/classic-world.json`). Nine independent machine-readable adjacency lists were
diffed edge by edge; **seven agree exactly** (conquete MIT, Conquest-Tracker MIT, Preeminence MIT,
gfceccon CC0, ai-at-risk MIT, risk-codelab Apache-2.0, hcekne Apache-2.0) across four languages and
five licences. Two disagreed and were overruled 7-to-2, cross-checked against Wikipedia and the
canonical board:

| Disputed edge | Verdict |
|---|---|
| Afghanistan–India | **PRESENT** |
| China–Middle East | **ABSENT** |
| East Africa–Middle East | **PRESENT** |
| New Guinea–Western Australia | **PRESENT** |
| Northwest Territory–Quebec | **ABSENT** (a common fan-data error) |

Also confirmed: **Eastern Australia–New Guinea IS an edge** (`02 §A.2`). Name traps: Preeminence calls
Afghanistan "Kazakhstan" and New Guinea "Papua New Guinea" (and misspells "Scandanavia");
risk-codelab misspells Yakutsk as "yakursk". Alias maps are recorded under
`verification.name_aliases_needed` (`02 §A.2`).

**9 sea/cross-ocean links**: Alaska–Kamchatka, Greenland–Iceland, Brazil–North Africa, North
Africa–Western Europe, North Africa–Southern Europe, Southern Europe–Egypt, East Africa–Middle East,
Siam–Indonesia, Central America–Venezuela (`02 §A.2`; also `sea_links` in the canonical JSON).

**Graph shape, useful for AI and balance:** 7 territories have degree 6 (China, East Africa, Middle
East, North Africa, Ontario, Southern Europe, Ukraine); 4 have degree 2 (Argentina, Eastern Australia,
Japan, Madagascar). Degree distribution 2→4, 3→13, 4→13, 5→5, 6→7 (`02 §A.2`).

**Defensibility** (`02 §A.2`, mirrored in `05 §3.1`):

| Continent | Bonus | T | Border terr. | External edges | Entry territories | Bonus/border |
|---|---|---|---|---|---|---|
| Australia | +2 | 4 | **1** | 1 | Indonesia | **2.00** |
| North America | +5 | 9 | 3 | 3 | Alaska, Central America, Greenland | 1.67 |
| Asia | +7 | 12 | 5 | 8 | Afghanistan, Kamchatka, Middle East, Siam, Ural | 1.40 |
| Europe | +5 | 7 | 4 | 8 | Iceland, Southern Europe, Ukraine, Western Europe | 1.25 |
| South America | +2 | 4 | 2 | 2 | Brazil, Venezuela | 1.00 |
| Africa | +3 | 6 | 3 | 6 | East Africa, Egypt, North Africa | 1.00 |

Australia is the turtle, North America the best value for a real push, Africa the trap.

### 3.4 The one map JSON schema (the L2 recommendation)

Re-implement `go-risk-it`'s shape — the cleanest data model found, from a repo with **no licence**, so
copy the design and not the file (`02 §B.4`, Recommendation Tier 2):

```json
{
  "slug": "classic-world",
  "name": "Classic World",
  "viewBox": "0 8 1024 643",
  "continents": [ { "id": "asia", "name": "Asia", "bonus": 7, "color": "#E08A24", "territories": ["afghanistan", "..."] } ],
  "territories": [ { "id": "afghanistan", "name": "Afghanistan", "continent": "asia",
                     "adjacent": ["china", "india", "middle_east", "ukraine", "ural"],
                     "labelX": 0, "labelY": 0, "d": "M…" } ],
  "seaLinks": [ { "from": "alaska", "to": "kamchatka" } ],
  "modifierSlots": { "blizzards": 4, "portals": 3, "capitals": 6 }
}
```

**Keep the SVG path `d` inside the JSON** rather than in a separate SVG file — one fetch per map and the
renderer never reconciles two sources of truth (`02` Tier 2). The existing
`canonical/classic-world.json` already uses `{id, name, continent, adjacent}` plus `continents[].bonus`
and `sea_links`, so the conversion is additive: attach `d`, `labelX/Y` and `modifierSlots`.

**Build-time validator** — mandatory, and the reason two of the nine upstream sources shipped bugs
(`02` Tier 2): adjacency **symmetry**; **no dangling refs**; **every territory has a `d`**; **every
continent's territory list matches** the territories' own `continent` field; plus (ours) every territory
has a label anchor and the `viewBox` contains all geometry.

### 3.5 Tier 3 — generated regional maps (the main work)

Pipeline (`02` Tier 3):

1. Start from `naturalearth/ne_110m_admin_0_countries.geojson` (public domain, 177 countries, carries
   `ADMIN`, `ISO_A3`, **`CONTINENT`**, `SUBREGION`) for world-scale maps, and
   `ne_50m_admin_1_states_provinces.geojson` / `topojson-atlas/us-atlas-states-10m.json` (ISC;
   56 states + nation, and **pre-projected** `*-albers-10m.json` at 975×610) for sub-national ones.
2. Group polygons into territories and **dissolve** with `mapshaper` or `topojson-client`'s `merge`.
3. **Derive adjacency topologically** from shared polygon edges — do not hand-type it. Cross-check
   against `country-borders/GEODATASOURCE-COUNTRY-BORDERS.CSV` (728 pairs, CC BY-SA 4.0 → use it only
   as a **test oracle**, which sidesteps the ShareAlike question).
4. **Add sea links by hand** — the one thing geometry cannot tell you (only 9 on Classic, so minutes
   per map).
5. Project to a flat `viewBox`, simplify to ~2–5% for web weight, emit the Tier-2 schema.

**Targets (ruling 3):** Europe, USA (states), Asia, Africa, South America, North America
(Canada + USA regions), Australia & New Zealand, Middle East, World Simple (~24). Tune territory counts
against `smg-catalogue/all-maps.json` so the maps *feel* like the originals without copying them, and
use the catalogue's bonus values plus the §3.3 bonus-per-border metric as the balance reference
(`02` Tier 3). Reference sizes from the catalogue: Simple World 19/6, Europe 44/7, United States 42/9,
Africa 37/7, Asia 1800s 48/9, Canada 53/10, New Zealand and Australia 38/8, Ottoman Empire 38/5
(`02 §A.1`).

Geometry anchors: use each polygon's **pole of inaccessibility** (`polylabel`), not the bounding-box
centre, so the token lands inside Norway rather than in the sea (`04 §8.6`). Classic can reuse
`conquest-tracker/classic-world.json`'s per-territory `x,y` label points (`02` "Also worth building").

### 3.6 Tier 4 — a seeded Voronoi random-map generator

Re-implement the `nullobject/risk` (MIT) approach — hexgrid → Voronoi tessellation → merge cells into
territories → **adjacency falls out of the tessellation for free** (`02 §B.4`, `§B.6` approach 4,
Tier 4). A few hundred lines, zero IP risk, unlimited boards, and it gives "random map" as a mode. Not
a substitute for real geography — it cannot produce "Europe Advanced". The generator is a **resolver**,
seeded (ruling 1), so a map slug plus seed reproduces a board exactly.

**Total: 3 + 9 + 1 generator = 13 maps with defensible provenance** (`02` Recommendation: "3 + 8 +
random generator = 12").

### 3.7 Middle Earth — conditional

`preeminence/middle-earth.json` is **MIT, 38 territories / 8 regions / 54 edges, fully symmetric, no
dangling refs** — but it has **no geometry**, and Tolkien place-names are Tolkien Estate IP
(`02 §A.3`, `INDEX.json` warning). **Ruling 3: ship it only with original names of our own, and only if
geometry can be generated for it; otherwise skip.** Also available graph-only and geometry-free:
Quad (20/4/26), Mini (6/2/7), Tiny3 (3/1/3), Tiny4 (4/1/6) — **Tiny3/Tiny4/Mini are ideal engine
unit-test fixtures and the "tiny map" for the solo-to-victory e2e test** (`02 §A.3`).

### 3.8 Blizzards, Portals and Capitals are global modifiers, not map rules

This is the architectural correction in `02 §A.1`: they are toggles that work on *any* map; each map
merely declares a count. So the replica needs **one** blizzard system, **one** portal system and
**one** capital system plus per-map counts — not bespoke rules per map. Blizzard counts run 2–11,
portals 3–7, both scaling with map size. *"This is the highest-leverage feature in the whole catalogue —
it multiplies every map you have."* (Ruling 3.)

### 3.9 Legal posture

- **Facts are free** — territory names, adjacency graphs, territory counts and bonus values are facts
  about a published game and are not copyrightable. Reuse them (`02 §Legal posture`).
- **Artwork is not** — never ship SMG's map PNGs, and never ship the Wikimedia `Risk_board.svg` /
  `Risk_game_board.svg` family or the raster board reproductions (`02 §B.5`).
  `Risk_game_graph.svg` (CC BY-SA 4.0) may be *read* as a cross-check; a graph is a fact.
- **ShareAlike is viral** — CC BY-SA assets (and the geodatasource CSV) would force our map data to
  CC BY-SA. Prefer PD/CC0/MIT/Apache/ISC, which is why Tier 3 is built on Natural Earth
  (public domain, *"Crediting the authors is unnecessary"*) (`02 §B.5`).
- **GPL/AGPL code** (Domination, openfrontio, P1sec) may be read for ideas, never copied (`02`).
- **Licence laundering** — a permissive LICENSE cannot grant rights the uploader never held; two repos
  ship a `.map` whose own header reads `author=Sean O'Connor` under MIT. Check the *data's* provenance,
  not just the repo's licence (`02 §B.4`).
- **"RISK" is a Hasbro trademark** (`02 §B.4` note, `00 §5` Wikipedia section). Ruling 10: the app is
  titled **"Risk"** like its siblings are titled after their originals, and `DECISIONS.md` must state
  plainly that RISK is a Hasbro trademark, that this is a non-commercial portfolio replica, and that no
  original assets are used.
- **Moscow was removed from RGD** after the invasion of Ukraine and may never return — don't ship it
  (`02 §A.1`).
- Download gotcha: legacy `naturalearthdata.com/http//...` URLs now return **HTTP 406**; use
  `naciscdn.org/naturalearth/...` or the GitHub raw GeoJSON paths (`02 §B.5`).

---

## 4. Screens and flow — with the verbatim UI vocabulary

### 4.1 Vocabulary to use on screen (confirmed strings)

From SMG's own article titles, setup screen and tutorial cards (`01 §9`, `03 §2`, `04a §3`):

- Phases: **`DRAFT`** · **`ATTACK`** · **`FORTIFY`** (and **`CAPITAL`** in Capitals mode —
  `ita-0030`). Use these, **not** "Deploy" (that is Hasbro's separate marketing-site wording).
- Buttons: **`End Attack Phase`** · **`End Turn`** · **`Trade In Now +10`** · **`BATTLE`** ·
  **`Join`** · **`No Matching Cards`** (disabled) · **`Opponent's Turn`** (disabled) ·
  **`I'M READY`** (lobby).
- Titles/pills: **`Continent Overlay`** · **`Cards`** · **`Deploy Troops`** · **`Fortify Troops`** ·
  **`Get Ready`** · **`Victory!`** · **`Blitz Win Chance`** · **`Attack Limit`** · **`Bonus`** ·
  **`Received Troops`** · **`Troop Bonus!`** · **`Territory Cards Seized!`** ·
  **`Territory Card Bonus!`** · **`Modes and Modifiers`**.
- Prompts: *"Tap any of your territories to begin deploying troops"* · *"Select an adjacent territory
  to attack"* · *"Select a territory to move your troops from"* · *"You must draft all of your
  available troops during your draft phase"*.
- Settings rows (the setup screen's rules readout, verbatim from `c3d-0001`, `04a §3`):
  **`Setup: Auto`** · **`Turn Timer: 60s`** · **`AI Difficulty: Expert`** · **`Card Bonus: Fixed`** ·
  **`Dice Rolls: Balanced Blitz`** · **`Alliances: Off`**. (Drop `Ranked: Yes` and
  `Min/Max Rank: Novice–Master` — out of scope.)
- Mode plate: **`World Domination`**, with a **`CUSTOM`** sub-chip (`04 §5.2`).
- Modifier names: **`Blizzards`** · **`Fog of War`** · **`Portals`** · **`Capitals`** ·
  **`Percentage Domination`** · **`Manual Placement`** · **`Max Rounds`** · **`Round Delay`**
  (`01 §9`, `03 §2.2`).
- Dialog copy: **`End Turn`** / *"Skip Fortify phase?"* / *"(This confirmation can be turned off in
  game settings)"* (`04 §4.15`).
- Get Ready copy: *"You are **player 2** – General of the ● **Red** Troops"* and
  *"Each turn you will DRAFT > ATTACK > FORTIFY."* (`04 §4.16`).
- Victory copy: **`Victory!`** / *"You conquered all your opponents!"* (`04 §4.14`).
- System notice precedent: *"The host has deactivated alliances for this game. No private chat
  allowed."* (`04a §3`, `nyc-0200`).

### 4.2 Flow

```
Home  →  Select a game type  →  Map picker  →  Modes and Modifiers  →  [lobby]  →  Game  →  Victory/Defeat
```

**Game types** — the five cards RGD shows (`04a §3`, `c3d-0813`): *Basic Training* (guided tutorials),
*Solo* (battle AI in solo games and scenarios), *Ranked 1v1*, *Casual* (unranked vs friends or online),
*Pass & Play* (local, one shared device). **Ours:** **Solo** · **Pass & Play** · **Online (Casual)**,
with Basic Training and Ranked omitted (§1.2). Footer carries the segmented **`FFA | 1v1`** toggle and
the green **`BATTLE`** pill (`04 §5.1`).

**Setup** is two steps: pick a map, tap the green **`Next`**, land on **`Modes and Modifiers`**; bot
difficulty lives behind a **`Modifiers`** button at the bottom (`03 §2`, both **[SMG]**).

**Lobby (online).** Seat list, per-seat human/bot/open, host-only controls (title, map, rules, add or
remove a bot, kick), an **`I'M READY`** button, a **4-letter lobby code** to join, a global chat column
and the **online-players list** (`03 §4.3`, `06 §4.5.1`, `§4.5.5`). RGD's 10-second ready check is a
source of complaints — **[ours]** no ready-check timer (`03 §4.3`).

**Game HUD** (measured at 1600×900, `04 §4.1`):

```
┌──────────────────────────────────────────────────────────┐
│ ⚙ ? 🎲                 [ title pill ]                    │ y 0–8 %H
│ [overlay                                       ┌────────┐│ roster, right edge
│  toolbar]            M A P                     │ player ││ x 87–100 %W
│  x 3–9 %W                                      │  rows  ││ y 25–80 %H
│ ▣ stats                                        └────────┘│
│ ▭ cards  ▣ emote    [avatar] PHASE  [btn]  [dice]        │ y 84–100 %H
└──────────────────────────────────────────────────────────┘
```

- **Top-left utility:** three circular outline-only buttons — ⚙ settings, ? help, 🎲 dice settings —
  centres (52,52)/(130,52)/(210,52), r ≈ 22 px, 3 px white stroke (`04 §4.2`).
- **Player roster is on the RIGHT EDGE, not a top bar**, and each capsule bleeds off the right side of
  the screen. *"This is a defining layout choice."* Row pitch ≈ 125 px, row height ≈ 96 px, avatar
  r ≈ 38 px, capsule radius = height/2 (`04 §4.4`). Row anatomy: capsule with a 2 px owner-colour
  stroke (active player's capsule is *filled* with the owner colour, ~40 px wider, with a white chevron
  tab); troop icon + count; territory icon + count; a tilted cream card-count tag rotated −12°;
  the avatar (gold laurel wreath + a **`YOU`** pill for the human; a robot-glyph chip for bots; a dark
  disc with a white **skull** when eliminated); `???` counts under Fog of War; chat bubbles pop out to
  the **left** of a row (`04 §4.4`).
- **Bottom action bar:** avatar (r ≈ 55) at 36%W, phase label in letter-spaced caps at y ≈ 790,
  **three phase pips** (92×12 px, radius 6, gap 12 — a progress bar, not tabs; active white, inactive
  `#6B7378`), the **primary green pill 238 × 48 px** at x 680–918, and a circular dice/mode button
  (r ≈ 58) (`04 §4.7`).
- **Bottom-left stack:** Stats (90×90 rounded square, grey tray, gold bar-chart), **Cards chip**
  (parchment card shape ≈95×112 rotated −8° with the held count, red badge when a trade is available),
  Emote/chat button (90×90, red unread badge) (`04 §4.5`).
- **Continent Overlay toolbar** (overlay mode only): vertical dark-teal capsule x 45–145, y 365–700,
  three 44 px toggles (troop view / globe overlay / player view), active one **gold `#E8C43A`**, plus a
  detached grey tray holding a red circular close ✗ (`04 §4.6`).

### 4.3 Dialogs and overlays — all specified with geometry in lane 04

| Dialog | Key spec | Source |
|---|---|---|
| **Count slider** (deploy / fortify / move-troops) | full-width dark strip y 600–738, red ✗ (r 40) left, green ✓ (r 40) right, numerals between fading `#C9CFD2`→`#6D8792`, selected value inside the **notched ring** (outer r 55, stroke 16) with a downward triangular notch; horizontally draggable | `04 §4.10`, `§4.12` |
| **Dice / Blitz popup** | a **full-screen takeover**, not a box: attacker disc top-left (r 150, laurel if you), defender top-right (robot chip if a bot), `Blitz Win Chance ?` at y 42, the percentage in **constant gold `#F0C40F`** at y 92, three 3D dice ~150 px with a white radial burst, blocky ◀ ▶ steppers, the `Blitz` label, Attack Limit slider bottom-right (`100%` / `7/7 Troops`), board scrimmed except the two combatants which show 3D troop figurines | `04 §4.9` |
| **Manual dice roll** | the same dice thrown *onto the board* at the contested border, tumbling then settling face-up | `04 §4.9` |
| **Card-trade panel** | shallow fan of 175×320 cards (aspect ≈0.55, radius 18, paper `#F3E6CB` with a 4 px `#D8C9A4` inset rule, ±4–6° alternating rotation, 20 px overlap), Bonus legend panel right (x 1320–1565) with a red `Bonus` header pill and four rows `4 Infantry · 6 Cavalry · 8 Artillery · 10 All Three`, the matching row ringed by the notched red ring; selected card lifts −14 px and gains a **white dashed border 8 px outside**; green `Trade In Now +10` pill (530×58). **Forced trade = the same panel with the ✗ removed** | `04 §4.11` |
| **End-turn confirmation** | a full-width **amber banner sliding down from the top**, y 0–440, rounded bottom corners r 20, gradient `#E6A93A`→`#EFCB55`, 4 px `#EDC94F` border; title `End Turn` 58 px; body `Skip Fortify phase?` in `#4A3410`; two large circular ✗/✓ buttons (r 54, 200 px apart) | `04 §4.15` |
| **Get Ready** | scrimmed board, owner-coloured radial sunburst, laurel-ringed portrait, name plate pill, the two copy lines | `04 §4.16` |
| **Received Troops** | owner-coloured turn banner across the top (h ≈78), owner-coloured header pill `Received Troops` (≈840 wide), the notched ring (r 62) holding the number, caption `Total troops`, then *"Troops awarded for occupying **10 territories**"* | `04 §4.17` |
| **Continent-bonus legend** | per-continent badge at the centroid: **radial donut progress ring** (outer r 36, thickness 7, white arc from 12 o'clock — North America 3/9 → a 33% arc), `+N` inside, a dark name plate below, caption `3/9 (33%)` in `--text-muted` | `04 §4.8` |
| **Elimination / seizure** | roster row flips to a skull disc and desaturates; seized cards animate to the attacker's card chip with a `+2`. **No full-screen "Defeated!" frame exists in the evidence** — design it to mirror Victory with a desaturated portrait | `04 §4.13`, `§9.7` |
| **Victory** | board entirely the winner's colour behind; `Victory!` 56 px at y 95; laurel-ringed portrait (r 150) at centre; ~24 white stars fanning out over ~240°; name plate pill; subtitle *"You conquered all your opponents!"* | `04 §4.14` |
| **Tip / tutorial card** | full-width `#203A5F` top banner with the logo, a large rounded card x 570–1480 y 330–760 (gradient `#304064`→`#103059`, broad specular sheen), cyan shield badge, 54 px outlined body copy, modal and dismiss-on-tap. **There is no small corner toast anywhere in the evidence** | `04 §4.18` |
| **Chat / emote panel** | a **left drawer** ~22 %W, full height, `rgba(20,24,28,.88)`: own avatar in a gold frame, a channel pill `ALL`, a **3×3 emote grid** (78×60 tiles, 9th slot `…`), then canned lines as full-width light pills `#DFE3E6` h ≈46, radius 23 — the four seen are "Good luck!", "Well played!", "Victory!", "Good game!" | `04 §4.19`, `04a §3` |
| **Hand-off overlay (Pass & Play)** | **[ours]** full-screen, opaque, owner-colour-tinted, "pass the device to `<name>`" with a `CONTINUE` button; purely presentational, never dismisses itself | `00 §2` (island-empire `HandOffOverlay`), ruling 9 |

**Pacing toggles** (`03 §3`, `§8`): **Camera Animations**, **Phase Change Animations** and **End Phase
Confirmation** exist as Settings > Gameplay toggles specifically so players can speed through turns —
their existence proves the default experience *has* a camera pan, an animated phase transition and an
end-phase confirm. Implement all three as settings, default on.

### 4.4 Pass & Play (ruling 9)

Hot-seat **2–6** on one device (`03 §4.2`). RGD's own hand-off interstitial could not be confirmed —
it probably leans on Fog of War to keep players honest — so the replica deliberately adds a full-screen
**"pass the device to `<name>`"** overlay between human turns, copied from island-empire's
`HandOffOverlay` pattern and its `hotSeat`/`handOff` session state machine (`00 §2`, `03 §4.2`).
**Fog is respected per seat**, so the board stays hidden behind the overlay (`hidden: true`) until
CONTINUE. Session resume: RGD pops up an offer to continue the last Pass & Play session on relaunch
(`03 §4.2`) — our equivalent is the autosave in `§9.5`.

---

## 5. Dialog roster (ruling 6)

### 5.1 Policy

**No free-text chat, ever** — SMG state repeatedly that the game is rated/licensed family-friendly and
open chat would let *"an unsupervised minor chat with an adult stranger"*. Communication is **preset
messages and emotes only** (`03 §5`, **[SMG]**). The replica keeps this exactly: preset-only, no free
text anywhere.

Five strings are **RGD-verbatim** and must be kept word-for-word (`03 §5.1`, `§5.4`):
**`NO DICE`** (current live name, confirmed by developer *IvanErtlov*: *"We did not REMOVE it, we
renamed it to 'NO DICE' because it was the least popular one"*), its predecessor
**`THE DICE HATE ME!`**, **`Great game.`** (one of ~7 pre-typed messages on an avatar tap), and the two
ally-only lines **`attack my territory if you need to`** and **`sorry, i need to attack your
territory`**. SMG also runs a **weekly "community expression"** rotation — one community-submitted,
vetted line elected per week (`03 §5.1`). **[ours]** out of scope; recorded as a future idea.

### 5.2 The 42-line roster (`03 §5.4`, grouped as published)

**Greetings** — 1 Hello! · 2 Good luck, everyone! · 3 Let's have a good game. · 4 Ready when you are. ·
5 Back again — let's go!

**Diplomacy (truce / alliance)** — 6 Truce? · 7 Alliance? Let's team up. · 8 I won't attack you this
turn — deal? · 9 Let's take down the leader together. · 10 Your border is safe with me... for now. ·
11 Can we talk strategy? · 12 I'll trade you intel for safety.

**Threats / taunts** — 13 Your territory looks... undefended. · 14 I'm coming for that continent. ·
15 This is my land now. · 16 You should have fortified that. · 17 Nowhere left to run. · 18 I'm going
to win this. · 19 Big mistake leaving that border open.

**Reactions (combat / dice)** — 20 **NO DICE!** *(RGD-verbatim)* · 21 **THE DICE HATE ME!**
*(RGD-verbatim, legacy alt)* · 22 Nice move. · 23 Didn't see that coming. · 24 Lucky roll. · 25 That
hurt. · 26 Not bad, not bad. · 27 Ouch.

**Apologies / appeasement** — 28 **Sorry, I need to attack your territory.** *(RGD-verbatim,
ally-only)* · 29 **Attack my territory if you need to.** *(RGD-verbatim, ally-only)* · 30 My bad. ·
31 Nothing personal. · 32 I had no choice.

**Encouragement / banter** — 33 Thanks! · 34 **Great game.** *(RGD-verbatim)* · 35 Nice try. ·
36 Respect. · 37 You're tougher than you look.

**Endgame** — 38 GG! · 39 Well played. · 40 Down but not out. · 41 I'll be back. · 42 Good game, see
you next time.

Lines 28 and 29 are **ally-only** and are offered only when an alliance is active; the rest are
lobby-wide (`03 §4.6`, `§5.4`).

### 5.3 Emoji reactions **[ours]**

RGD's emotes are paid sticker art — *Laughing / Angry / Weeping / Thumbs-Up General*, the Prime Gaming
*Fistbump Human / Pirate / Zombie* pack, and the base-game *Mika Raspberry* (`03 §5.2`). We ship none of
that art. **Ruling 6: a small code-drawn emoji-reaction set** (8 glyphs, e.g. 👍 😄 😮 😤 😢 🤝 ⚔️ 🏳️)
rendered as SVG in the 3×3 grid slot pattern of `04 §4.19`, with the 9th slot reserved for `…`.

### 5.4 Presentation

A line appears as a **speech balloon to the left of the sender's roster capsule** for **~4 s**, then
auto-dismisses, and is also written to a scrollable log in the chat drawer (`04 §4.4`, `§4.19`;
motion #17 in `04 §6`: scale 0.6→1.06→1 over 240 ms back-out, auto-dismiss after 3.5 s with a 200 ms
fade — **ruling 6 rounds this to ~4 s**). Exact duration is not confirmed in the evidence
(`03 §5.2`).

Availability: **online casual play and lobbies** (RGD: *"Emotes can be used both in multiplayer lobbies
and multiplayer game chat with other human players"*, `03 §5.2`). **[ours, flagged as our addition]**
bots may fire a small number of reaction lines on events (losing a territory, a terrible roll, being
eliminated) purely as cosmetic flavour — `04 §6` motion #18 already documents a bot *"…" thinking*
balloon in the store art, so the affordance exists.

---

## 6. Bots (ruling 5)

### 6.1 Architecture — copy SMG's, because it is cheap and it is why their bots read as characters

**[SMG, "Our RISK AI"]** (`05 §1.1`): the AI is *"not a single entity but a mixture of various
'personas'"* — **Friendly, Defensive** (*"only attacks when it really knows it can win"*),
**Continental** (continent control), **Aggressive**, **Stacker** (*"likes to stack up and then
steamroll"*), **Zombie** — each with *"around 40 different attributes"*. **Difficulty selects which
personas are in the pool**, not a smartness slider: *"if you play on 'Expert' you will get a different
set of personas than on 'easy'."* The **game mode also selects personas** — *"Capitals is the best
example as [it] adds a new dimension for the AI to focus on"* — so the pool is a function of
`(difficulty, gameMode)`, not difficulty alone.

Also first-party (`05 §1.1`): the AI uses **the same dice code and the same RNG** as humans (no dice
advantage); it **does see through Fog of War** (the only admitted information edge); it *"considers all
players equal opponents"* **except** on Beginner/Easy where there is *"a slight preference for the AI to
take out other AI first"*; turn order and cards are random; SMG explicitly rejected ML on cost grounds.

The "bots gang up on the leader" feeling is **explicitly denied as a coded rule** and is emergent from
border count — we get the same effect free from a local target score, and we should *not* hard-code a
dogpile rule at low tiers, but should expose `leaderBias` as a knob (`05 §1.1`).

### 6.2 Difficulty tiers — labelled exactly as the real game's "AI Difficulty" setting

**Beginner · Easy · Medium · Hard · Expert** (ruling 5). Evidence grading (`05 §1.2`): Beginner, Easy,
Medium and Expert are **[SMG]** (the difficulty article's *"Choose from Beginner to Expert"*, the
attached screenshot showing the cycler set to **Medium**, and the Steam achievement *"Defeat 5 expert
AIs…"*); **Hard is player testimony only**; the count of five comes from a since-removed Steam bullet
*"5 difficulty AI settings"*. The setting is labelled **`AI Difficulty`** and lives under
*Modifiers → Advanced Options*.

> ⚠️ **Never write "Intermediate" or "Advanced"** — an automated summary confabulated
> "Beginner, Intermediate, Advanced, Expert"; the raw page contains no such list (`05 §1.2`).
> Lane 05 §1.2 *recommends* shipping only Easy/Medium/Hard/Expert with Beginner in reserve;
> **ruling 5 overrides this and ships all five**, matching the real setting.

`Inactivity Behaviour` is a *separate* setting controlling what a bot-out does — **Automated** (AI plays
the seat) vs **Neutral** (minimal moves only) (`05 §1.2`). Keep the two independent. Our online timeout
path (`§7.4`) is the Automated behaviour.

### 6.3 The tier table (`05 §3.5`) — each tier *adds*, nothing is removed

| | **Beginner** | **Easy** | **Medium** | **Hard** | **Expert** |
|---|---|---|---|---|---|
| Persona pool | Friendly, Defensive (softest jitter) | Friendly, Defensive | + Continental, Stacker | + Aggressive | all, weighted Continental/Aggressive |
| Odds model | troop-ratio guess | troop-ratio guess | exact table | exact table | exact table + loss distribution |
| `minWinChance` | 0.25 | 0.25 | 0.45 | 0.55 | dynamic (`score ≤ 0`) |
| `blunderRate` | 0.40 **[ours]** | 0.30 | 0.12 | 0.03 | 0.00 |
| Placement | `spread` | `spread` | `secure` | `secure` + springboard | `secure` + planned springboard |
| Fortify | none | random legal / none | drain interior → nearest border | threat-weighted | threat-weighted + springboard tiebreak |
| Continent logic | none | none | completes if 1 away | full acquire/hold + breaks | + denies pending bonuses |
| Cards | when forced | when forced | trades at 3 (fixed) | progressive timing | + tracks all players' counts |
| Kill for cards | no | no | no | yes | yes, sets it up a turn ahead |
| Domination / capitals | ignores | ignores | own progress | own + leader's | full denial |
| Fog | honest + pessimistic | honest + pessimistic | honest | honest | **sees through fog** (RGD parity) |
| Lookahead | 0 | 0 | 0 | 1 (best reply) | 2 (our turn + worst-case reply) |
| Alliance loyalty | 1.0 | 1.0 | 1.0 | 0.9 | 0.6, breaks decisively |
| Anti-AI bias | yes **[SMG]** | yes **[SMG]** | no | no | no |

(Beginner's row is interpolated below Easy; `05 §3.5` publishes Easy–Expert.)

**`blunderRate` is the honest way to build the low tiers** (`05 §3.5`): do not make them *compute
badly* — make them compute correctly and then pick the k-th best move. One code path, vital for
determinism, and it avoids the classic bug where a "dumb" bot is accidentally strong.

### 6.4 Persona table (`05 §3.5`) — drawn once at match start and stored in state

```ts
interface BotPersona {
  name: string;
  aggression: number; minWinChance: number; reserveFactor: number;
  continentFocus: number; expansionism: number; stackiness: number; turtleAversion: number;
  leaderBias: number; grudgeWeight: number; grudgeDecay: number; allianceLoyalty: number;
  lookahead: 0 | 1 | 2;
  seesKillForCards: boolean; seesCardTradeTiming: boolean; seesDominationThreshold: boolean;
  usesExactOdds: boolean; fogHonest: boolean; blunderRate: number;
}
```

| Our persona | RGD name | Lux equivalent | Defining knobs |
|---|---|---|---|
| Rusher | Aggressive | Angry / EvilPixie | `aggression` 0.9, `minWinChance` 0.3, `reserveFactor` 0.5 |
| Continental | Continental | Pixie | `continentFocus` 1.0, `expansionism` 0.4 |
| Clusterer | — | Cluster | connectivity over bonuses, `continentFocus` 0.3 |
| Hoarder | Stacker | Shaft | `stackiness` 1.0, attacks only when dominant |
| Turtle | Defensive | Bort | one attack per turn, `minWinChance` 0.8, `reserveFactor` 2.0 |
| Opportunist | Friendly | Yakool / Boscoe | card-seeking + leader-continent denial, moderate aggression |
| Assassin | — | Killbot / Reaper | `seesKillForCards`, **border reserve ≈ 20** (Killbot's published value) |
| Wildcard | — | Chimera | samples another persona at match start — RGD's own mechanism |

Killbot's *"20 armies on each border, then masses armies for the next attack"* is the only **published
absolute reserve number** found anywhere; use it as the Assassin's `reserveFloor` and as a sanity check
that `reserveFactor` produces numbers in that ballpark on a mature board (`05 §3.5`).

**Decision (ruling 5).** Personas are **drawn once at match start from `rngFor("personaAssign", 0)`,
with attribute jitter from `rngFor("personaJitter", 0)`, and both are stored in match state** — never
re-derived per turn, so a replay on another device reconstructs identical opponents (`05 §7.2`).

### 6.5 Heuristics

**Draft / placement** (`05 §3.1`):

```
contValue(c) = bonus(c) / (acquireCost(c) + holdCost(c))
  acquireCost(c) = Σ over unowned territories ( 1 + enemyTroops(t) · wAcquire )
  holdCost(c)    = borderTerritories(c) · wHold            // wHold ≈ 2.0
```

With `wHold = 2.0` on an empty board: Australia 0.33, North America 0.33, Europe 0.33, Asia 0.32,
South America 0.25, Africa 0.25. **The hold-cost term is what stops Europe/Asia looking cheap**, and
tuning `wHold` upward is the turtle-vs-sprawl dial. Bonus ÷ territory-count alone ranks Europe first
and makes a bot dive in and get eaten; **bonus ÷ border territories ranks Australia first (2.00)**,
matching human expert play and the "bots always take Australia" folk observation (`05 §3.1`).

**Gibson et al.'s learned draft evaluator — the only empirically validated one** (`05 §3.1`, `§2.6`):

```
draftScore(p) = continentCurve(territoriesOwnedPerContinent)
              + 13.38·(turnPosition == 1) + 5.35·(turnPosition == 2)
              − 0.07·distinctEnemyBorderingTerritories
              + 0.96·pairsOfAdjacentOwnedTerritories
value(draft)  = max(0, score(me)) / Σ_players max(0, score(p))
```

Clustering is worth ~14× per unit what a border costs, and going first is worth about 14 adjacent
pairs. Cheap fallback policy to hard-code for Medium: *claim a contiguous block in North America and
deny opponents by taking the last free territory in South America or Africa*. Completing a **small**
continent is worth far more than progress toward a big one (`05 §3.1`).

**Position evaluation — the root objective** (Lozano & Bratz, 73% against Lux's best, ~15 lines)
(`05 §3.1`, `§2.7`):

```
V(state) = expectedIncome(me) − max over opponents p of expectedIncome(p)
  expectedIncome(x) = max(3, floor(territories(x)/3)) + Σ continentBonuses(x) + expectedCardValue(x)
```

The `− max opponent income` term **gives leader-targeting for free, with no special-case rule**.

**Border Security Ratio (Hahn's definition — higher BSR means MORE danger)** (`05 §3.1`):

```
BST(t)  = Σ enemyTroops(y) over enemy territories y adjacent to t
BSR(t)  = BST(t) / ownTroops(t)                 // ≥1 → takeable: a liability.  ≤0.67 → comfortable
NBSR(t) = BSR(t) / Σ_z BSR(z) over our territories    // reinforcement share
```

Distribute reinforcements proportionally to `NBSR` (Hahn's best-measured configuration), **zeroing any
BSR below a floor before normalising** (otherwise NBSR spreads single troops uselessly — "0.53 units on
country 2"), rounding by largest remainder with leftovers to the highest BSR. Supplying a *high*-BSR
territory raises defence; supplying a *low*-BSR one raises offence — the same code path, different
personality. **Test fixture to catch the inversion bug** (`05 §3.1`): enemy stacks of 7, 4, 5 adjacent to
a territory holding 5 → `BST = 16`, `BSR = 3.2`, and with sibling BSRs 4 and 1.25, `NBSR = 3.2/8.45 =
0.37`.

Placement policies by tier: `spread` (Easy) · `secure` (Medium+ default: fill lowest-BSR borders to
`bsrTarget`, remainder to the springboard) · `frontLoad` (Hard/Expert with a plan) · `stack` (the
Stacker persona) (`05 §3.1`).

**Attack scoring** (`05 §3.2`):

```
score(src,dst) = p·gain(dst) − (1−p)·sunkCost(src) − risk(dst)
  p        = winChance[src.troops − 1][dst.troops]            // table lookup, the mode-correct table
  gain     = w_terr + w_contComplete·completesContinent + w_contBreak·breaksEnemyContinent
           + w_kill·killValue(owner) + w_card·(firstConquestThisTurn ? expectedCardValue : 0)
  sunkCost = expected troops lost from the loss distribution, not a constant
  risk     = Σ enemy troops adjacent to dst after capture
killValue(P) = cardSetValue(ourCards + P's cards) + P.territoryCount·w_terr
```

**Three stacked stop conditions** (`05 §3.2`): a win-probability floor per tier; a **border reserve** —
never attack out of a territory if that drops it below `ceil(maxAdjacentEnemyStack(t) ·
tierReserveFactor)`; and, for Expert, stop when `score(best) ≤ 0` — *"the single biggest strength jump
between Hard and Expert and it costs nothing"*.

**Continent breaking** (`05 §3.2`): worth the opponent's bonus *per turn, for every turn they stay
broken* — `w_contBreak = bonus(c) · expectedTurnsBroken` with
`expectedTurnsBroken ≈ 1/(1 + theirReconquestEase)`. **Only break if the captured territory's
post-capture BSR ≥ 1.0, or the bonus denied ≥ 5.**

**Domination awareness** (`05 §3.2`): when *we* approach the threshold, switch from value-maximising to
**territory-count maximising** (cheap targets, not valuable ones); when an *opponent* approaches it,
switch to **denial** — `if leaderShare > dominationThreshold − 0.1 then leaderBias = 1.0`.

**Capitals awareness** (`05 §3.2`, `§4.6`): the capital table is a **correctness requirement**. 10v10
drops from 56.76% (standard) to 19.02% (capital) to 5.31% (capital + wall). A bot using the standard
table in Capitals mode suicides into capitals every game. Capitals get a large flat `gain` bonus and
capital defence a large `reserve` multiplier.

**Fortify** (`05 §3.3`): drain the interior, feed the most-threatened border —
`destination = argmax over reachable owned d of threat(d) / max(1, d.troops)`, weighting borders of
continents we hold; Expert breaks ties toward the best springboard for next turn.

**Target selection among players** (`05 §3.4`): Knudsen's calibrated strength heuristic
`H(p) = armies(p) + 0.3·territories(p) + continentBonuses(p)`, normalised; plus collusion detection
from `AD[i][j]` (the share of i's attacks aimed at j) with Knudsen's calibrated thresholds —
`beingTargetedBy(p) = AD[p][me] ≥ 0.75`, `ignoringMe(p) = AD[p][me] ≤ 0.25`. A per-opponent `hostility`
combines leader weight (phase-dependent), weakness, `grudge[P] += troopsLostTo(P)` decayed 0.5–0.9 per
turn, card count, border contact, **minus** `turtleScore(P)` (mean troops per border territory — *"don't
poke a turtle"*, which removes most of the "bot throws armies into a meat grinder" complaint) and minus
an alliance term.

**Where we deliberately beat RGD** (`05 §1.3`, `§3.2`): RGD's bots **do not kill for cards**, handle
Capitals poorly (SMG acknowledge it), are *"quite handicapped at unusual game modes"*, leave exactly 1
troop behind on every conquest, and cannot stop a Blitz early. We implement `seesKillForCards` on
Hard/Expert, mode-correct tables, a real `moveArmiesIn` decision and a real stop rule. SMG themselves
say *"a lot of our higher level players do find our bots too easy"* — these are improvements, not bugs,
and nobody should "fix" them back.

### 6.6 Odds tables at runtime (ruling 5)

1. **True Random:** precompute `W[A][D]` for **A, D ≤ 128** at engine init as a **`Float32Array`**
   (65 KiB; `Float64Array` at 101×101 measured 2.07 ms / 80 KiB, 201×201 measured 1.80 ms / 316 KiB;
   lookups ~1.15 ns) (`05 §4.5`, `§6`).
2. **One table per dice variant**, keyed on the resulting `(attackDice, defendDice,
   favourDefenderOnDraw)` triple with the augment modelled as an **integer `defendDiceBonus` /
   `attackDicePenalty` summed from all active modifiers**. Do **not** enumerate named modes — that is
   how you miss the stacked combination. With `attackDice ∈ {1,2,3}`, `defendDice ∈ {1,2,3,4}` and two
   tie rules, the complete set is **24 round distributions**, trivially precomputable (`05 §4.6`).
3. **Balanced Blitz is NOT a full table at init.** The BB win chance needs the full outcome
   distribution per `(A,D)` pair, so a complete table is ~O(A²D²): measured **4.4 ms at 32×32,
   37.2 ms at 64×64, 199.8 ms at 100×100** — over budget synchronously (`05 §6`).
   **Ruling 5: compute BB distributions lazily and memoise**; a real game queries far fewer than 10,000
   distinct pairs and small battles dominate. (`05 §6` also offers shipping a 40 KiB precomputed binary,
   which additionally removes the `Math.pow` portability risk — a fine later optimisation.)
4. **Beyond the table, use the fitted logistic — and do not clamp** (`05 §4.5`):
   `p ≈ σ((A − 0.860·D) / (0.630·√(A+D)))`, max abs error 0.0318, RMS 0.0088, 0.37% of 50% decisions
   flipped over `A,D ∈ [129,400]`. Independent clamping has max error **0.8565**.
5. **Never Monte-Carlo a battle** — orders of magnitude slower than a lookup *and* it consumes PRNG
   draws, breaking determinism (`05 §4.5`).

### 6.7 Determinism rules (ruling 1 + `05 §7`)

- **PRNG: explicit, seeded PCG32** (SMG default to PCG among their six generators) — tiny state that
  serialises into the save/replay as plain integers, integer ops only (`Math.imul`, `>>> 0`) so it is
  bit-identical everywhere. Threaded as an object, never a module singleton:
  `interface Rng { nextU32(): number; nextFloat(): number; state: readonly [number, number] }`
  (`05 §7.1`).
- **Purpose-tagged sub-streams:** `rngFor(purpose, turn) = pcg32(hash(matchSeed, purpose, turn))` with
  purposes `"deal"`, `"turnOrder"`, `"battle"`, `"bot:<playerId>"`, `"cardDeck"`, `"personaAssign"`,
  `"personaJitter"`. *"This is the single most important determinism decision in the whole design.
  Without it, any bot tweak that adds or removes one PRNG draw breaks every stored replay"*
  (`05 §7.1`).
- **One draw per battle**, via inverse-CDF sampling of the (balanced or raw) outcome distribution —
  not one per roll (`05 §5.5`).
- **Pin the CDF walk direction and the tie comparison** (`u < cum` vs `u <= cum`) and test
  `u ∈ {0, ε, 0.5, 1−ε}` (`05 §5.5`).
- **Quantise before comparing.** `Math.pow` is **not bit-identical across JS engines** and appears in BB
  stages 2 and 4, so round each cumulative value to a fixed grid (e.g. `round(x · 2^32)`) before
  comparing against `u`; prefer integer/fixed-point arithmetic in scoring so `>` is exact
  (`05 §5.5`, `§7.2`).
- **A bot decision consumes a fixed, predictable number of draws** — ideally zero in the common path,
  at most one for blunder/tie-break. Never `while (rng.nextFloat() < x)` (`05 §7.2`).
- **Never iterate a Map/Set/Object whose insertion order can vary**; sort by stable id first. **Ban
  `Array.prototype.sort` without a total comparator** — always `byScoreThenId = (a,b) => (b.score −
  a.score) || (a.id − b.id)` (`05 §7.2`, `§8`).
- **No wall clock, no animation state, no UI state in the engine.** Bot "thinking time" is a
  presentation delay applied *after* the decision is computed (`05 §7.2`).
- **Golden replay tests:** store `(seed, map, settings, personaAssignment)` plus a state hash after
  every turn for a few hundred full bot-vs-bot games; any heuristic change that alters a hash is an
  explicit, versioned change (`05 §7.2`).

### 6.8 Bot interface (ruling 1)

```ts
// Pure. Same inputs → same outputs, always. Lives in the engine package.
function decideTurn(
  view: BoardView,       // immutable; fog already applied per persona.fogHonest
  seat: PlayerId,
  persona: BotPersona,   // drawn once at match start, stored in match state
  odds: OddsTables,      // the precomputed Float32Array tables, mode-correct
  rng: Rng,              // rngFor("bot:" + seat, turn)
): TurnPlan              // { cardTrade, placements[], attacks[], fortify }
```

`TurnPlan` is **data, not side effects**, so the UI can animate it at any speed, it serialises straight
into the replay log, and a replay can be verified without re-running the bot (`05 §8`). An attack chain
is adaptive, so **re-enter `decideTurn` after each battle** with the updated view — microseconds per
call (`05 §8`). For Hard/Expert, adopt Warzone's **tasks-propose-scheduler-decides** decomposition: a
persona becomes *which tasks are enabled at what priority*, and `NoPlan*` fallback tasks guarantee a bot
always does something sensible (`05 §8`). **This same `decideTurn` runs bot seats in online games on the
server** — one implementation, one test suite (`06 §4.5.3`, ruling 1).

**Build order** (`05 §8`): odds tables and their tests first (independently verifiable against §2.4 and
§2.5), then a ply-0 greedy bot with one persona, then the persona table, then tiering, then Expert's
ply-1 lookahead.

**The literature's clearest instruction** (`05 §2.15`): three independent results say **the draft
decides the game** — Gibson et al. (identical post-draft play, random draft ⇒ collapse), Gnecco &
Cazenave (net-for-draft-then-random *beat* their full trained agent), Hahn (the eventual winner is
statistically identifiable 60% of the way in). **Expert's compute budget belongs in the draft**, which is
the opposite of where intuition points. MCTS and rollouts are out: Wolf measured per-turn branching at
10³³–10⁸⁵ against Go's ~250 (`05 §2.1`, `§6`).

---

## 7. Online architecture — Option A (ruling 2)

### 7.1 The decision and why

**Server-authoritative engine behind Next.js route handlers, an append-only action log in Postgres, one
adaptive short poll per client** (`06 §0`, `§4.1`). The three rejected options, one line each
(`06 §0`, `§4.2`–`§4.4`): **SSE** makes the invocation line beautiful and the three *tighter* lines
(Active CPU 4 h, Provisioned Memory 360 GB-hr, Neon 100 CU-h) worse and unpredictable, and *"a design
whose cost model you cannot compute is worse than a slightly slower one you can"*; **Supabase Realtime**
is the best push story and the worst fit — a second free tier, and free projects **pause after one week
of inactivity**, which for a portfolio replica means the link is dead when it matters most;
**Trystero P2P** puts the authoritative state in one visitor's tab, so the host closing it ends the
game and a refresh is indistinguishable from a quit. A fifth option exists for the record — a
**Cloudflare Durable Object as a pure notification bus** (`06 §4.4b`) — which is the only option that
beats A without giving anything up; build the `Sync` port so it is one adapter, and do not build it now.

The folklore is out of date: Hobby functions now run to **300 s** (not 10 s), WebSockets are supported
in public beta on all plans, and streaming works — but **Hobby cron can only fire once per day**, so
every periodic duty must be lazy anyway (`06 §1.1`, `§1.2`, `§1.5`).

### 7.2 Schema (condensed from `06 §4.5.1`; full SQL there, applied by `db:push`)

```sql
players      (id pk, display_name, name_key uniq, secret_hash, color, created_at, last_seen_at)
             -- name 2–20 chars, ^[A-Za-z0-9][A-Za-z0-9 ._-]*$ ; color ^#[0-9A-Fa-f]{6}$
             -- presence is FOLDED IN, not a second table
lobbies      (id pk = 4-letter code, host_id → players, title, status, map_id, max_seats 2..6,
              settings jsonb, game_id, created_at, updated_at, version bigint)
             -- status in (open, starting, playing, closed); `version` is the ?since= for lobbies
lobby_seats  (lobby_id, seat) pk, kind in (open|human|bot), player_id, bot_level, ready
             -- a check constraint enforces the kind/player_id/bot_level shape
             -- unique (lobby_id, player_id) where player_id is not null → one seat per player
games        (id pk, lobby_id, map_id, rules jsonb, seed text  -- SERVER-ONLY, never serialised
              status in (playing|finished|abandoned), seq bigint, snapshot jsonb, snapshot_seq,
              state_hash, current_seat, phase, turn_deadline, tick_lease, winner_seat, timestamps)
game_players (game_id, seat) pk, kind in (human|bot), player_id, bot_level,
              display_name, color,            -- denormalised: outlives player expiry
              standing in (active|eliminated|resigned|away), missed_turns, last_seen_at
game_actions (game_id, seq) pk, seat, type, payload jsonb,   -- payload carries server-rolled dice
              actor in (human|bot|server), client_action_id, state_hash, created_at
             -- unique (game_id, client_action_id) where not null  → the idempotency fence
chat_messages(id bigserial, scope in (global|lobby|game), scope_id, player_id,
              display_name, body 1–300 chars, created_at)
```

Three shape notes (`06 §4.5.1`): `games.seq` **deliberately duplicates** `max(game_actions.seq)`
because the poll's hot path is "has anything happened since n" and one indexed row answers it;
`display_name` is denormalised so a finished game's scoreboard never becomes "(unknown)"; and
`games.seed` is never sent to a client — keep it **off the `GameState` type entirely** so the response
serialiser cannot reach it.

### 7.3 Routes (`06 §4.5.5`) — exactly three poll endpoints, "resist a fourth"

```
POST   /api/session                    claim a display name → sets risk_sid, returns {playerId, displayName, color}
PATCH  /api/session                    change colour / re-claim after expiry
DELETE /api/session                    leave: clear the cookie, release the name

GET    /api/lobby?since=<v>            POLL 1 — online players + open lobbies + global chat + heartbeat
POST   /api/lobbies                    create → {code}
GET    /api/lobbies/:code?since=<v>    POLL 2 — seats + settings + lobby chat + heartbeat
POST   /api/lobbies/:code/join         take the first open (or a named) seat
POST   /api/lobbies/:code/leave        vacate; if host, hand off or close
PATCH  /api/lobbies/:code              host only: title, map, rules, add/remove bot, kick, ready
POST   /api/lobbies/:code/start        host only: create the game → {gameId}

GET    /api/games/:id?since=<seq>      POLL 3 — delta-or-snapshot + presence + deadline + game chat
                                       + heartbeat + the lazy tick. 204 when seq === since.
POST   /api/games/:id/actions          submit one action {clientActionId, type, payload}
POST   /api/games/:id/resign
POST   /api/chat                       {scope, scopeId, body} — the only chat write; reads ride the polls
GET    /api/health                     one `select 1` (the ArtWall precedent)
```

**The single game poll does five jobs in one invocation** (`06 §4.1`): stamps the caller's
`last_seen_at` (presence heartbeat, not a separate request); runs the lazy tick; returns the action
delta (or the snapshot); returns the other seats' presence and `turn_deadline`; returns chat since the
client's last id. *"This folding is what makes the budget work."*

### 7.4 Poll protocol (`06 §4.1`, `§5.3`, `§4.5.4`)

| Situation | Interval |
|---|---|
| It is your turn | **2,000 ms** |
| Someone else's turn, tab visible | **4,000 ms** |
| Lobby / browse, tab visible | 5,000 ms |
| Tab hidden | **15,000 ms**, and **stop entirely after 5 minutes hidden** |
| Game finished, or you are eliminated | stop |

Plus: re-poll immediately on `visibilitychange → visible` (the ArtWall pattern), immediately after your
own `POST .../actions` returns, and apply **±15% jitter** so four clients in one game do not
synchronise into a thundering herd (`06 §4.1`).

Response shape (`06 §5.3`):

```
seq === since              → 204 No Content          (the common case; near-zero CPU, ~0 bytes)
since >= snapshot_seq      → { seq, fromSeq, actions: [...] }                      -- delta
since <  snapshot_seq, >0  → { seq, snapshot, snapshotSeq, actions: [...] }
since === 0                → { seq, snapshot, snapshotSeq, actions: [] }
```

Plus `presence`, `turnDeadline`, `chat` and `you` (your seat, your cards) on every non-204 response, and
`ETag: W/"<seq>"` + `If-None-Match` so the 204 path is a string compare. **204-on-no-change is the cost
design and the correctness design at the same time**: a delta-returning poll is CPU-co-binding with the
invocation line at ~1.4 M, while a snapshot-returning poll binds first at 576 K (`06 §4.1`).

**Append** (`POST .../actions`, one transaction over the WebSocket pool) (`06 §5.3`):
`select … for update` on the games row (the fence that stops a double-clicked Attack racing for
`seq+1`) → authorise cookie → player → `game_players.seat`, reject if `seat ≠ current_seat` → fold
forward → `validate()` (422 on a rule error) → **roll the dice server-side and splice them into the
payload** → insert at `seq+1` with `state_hash` → update `games`. Respond
`{ seq, actions: [theOneJustApplied] }` so the submitter needs no extra poll.

**Idempotency** (`06 §5.4`): the client mints `clientActionId = crypto.randomUUID()` **once per
intent (the click), not per send**, and reuses it verbatim on retry. The unique index refuses the
duplicate; the handler catches Postgres `23505` and responds **200 with the already-recorded action**,
so a retry is indistinguishable from a slow success. *"A resend with a fresh id is a second attack."*

**Client loop** (`06 §5.3`): `confirmedState = fold(apply, snapshot, actions)`;
`displayedState = fold(apply, confirmedState, pendingActions)`. On each response, apply actions in
`seq` order, drop confirmed pending ones, and **assert `hashState(confirmedState) === action.stateHash`**.
Dropped, duplicated and out-of-order responses are all handled by the same code — `seq` is the only
thing that orders anything. **Desync is not reconciled**: drop local state, refetch the snapshot, and
make it loud, because a desync is a bug in `apply` (`06 §5.5`). The hash must be over a **canonical**
serialisation (sorted keys, integers not floats, no `undefined`) with its own fast-check property test.

**Bot turns and timeouts run lazily, inside whichever poll arrives next** (`06 §4.5.3`): read
`games.seq/current_seat/turn_deadline/tick_lease` in one statement; if the current seat is a bot or the
deadline has passed, take the lease
(`UPDATE games SET tick_lease = now() + '10s' WHERE id = $1 AND (tick_lease IS NULL OR tick_lease <
now()) RETURNING seq` — 0 rows means another poll is already ticking, so answer from the log), then in
one transaction fold the state and loop at most **`MAX_TICK_ACTIONS ≈ 40`** times appending bot or
auto-skip actions until the current seat is a live human or the game ends. *There is always at least one
client polling whenever anyone is watching — and when nobody is watching, nothing needs to happen.*

**Turn timer / leaving / reconnect is one mechanism** (`06 §4.5.4`). `games.turn_deadline = now() +
rules.turn_seconds` on every turn change. On the lazy tick: deadline passed with a legal "do nothing"
→ append `end_phase`/`end_turn`, `missed_turns += 1`; deadline passed with armies undeployed → append
`auto_deploy` chosen by the bot policy, then `end_turn`; `missed_turns ≥ 2` **and** `last_seen_at` older
than 2 min → append `seat_to_bot` (`kind = 'bot'`, `standing = 'away'`); that player polls again →
append `seat_to_human`, reset `missed_turns`. **Every one of those is a row in the action log, not a
side effect**, so every client learns about a takeover exactly the way it learns about a dice roll and
can render "Napoleon went away — the bot took over" from the log. A game where every human seat is away
for 30 minutes → `status = 'abandoned'` and the bots simply stop being run.

**The lazy reaper** (`06 §4.6`), once per ~60 s per process via a `globalThis` timestamp, `limit` on
every statement: open lobbies idle 20 min → closed; games with every human away 30 min → abandoned;
finished/abandoned games older than 7 days → deleted (cascades the log); players unseen 24 h with no
live seat → deleted; chat older than 7 days → deleted (`limit 500`); and **snapshot compaction when
`seq − snapshot_seq > 50`**. One daily Hobby cron (`/api/cron/sweep`) as belt and braces.

### 7.5 Identity — the temporary discoverable account (ruling 7)

RGD itself has **no custom usernames** — *"We do not support fully custom usernames… The only way to
add a custom name is to use either a Game Center, Google Play, Facebook, Apple or Steam name"*
**[SMG]**, edited at *Settings > Profile > Change Profile Name*, with a one-way sync from the platform
name at creation (`03 §6`). Its procedural fallback name was described by a player as
**"Lucius The Cruel 33"** — a `[Name] [Epithet] [Number]` pattern — **[unconfirmed]** (`03 §6`).
Discovery is by a short **Friend ID** like `37VGVCCC` (`03 §6`).

**Ruling 7, our version** (`06 §4.5.2`):
1. **Display name chosen on arrival** — that *is* the account. No password, no email.
   2–20 characters, `^[A-Za-z0-9][A-Za-z0-9 ._-]*$`, normalised to
   `name_key = lower(btrim(collapse_ws(name)))`.
2. **A generated default** in a `<Adjective> <Noun> <NN>` shape of **our own wording** — deliberately
   not RGD's "Lucius The Cruel 33" phrasing, which is unverified anyway.
3. `POST /api/session` reaps a dead holder of that name **conditionally and atomically** — only if
   `last_seen_at < now() − 2 minutes` **and** they hold no seat in a playing game **and** no lobby seat
   — then inserts with `on conflict (name_key) do nothing`. Zero rows → genuinely taken by someone live
   → **409 with suggestions** (`Napoleon-2`, `Napoleon_1944`) probed from `name_key`.
   **Never silently rename** — the player chose that name and should be told.
4. **The server mints the secret** (32 random bytes), stores `sha256(secret)` and sets
   `risk_sid = <playerId>.<secret>` as an **httpOnly, Secure, SameSite=Lax** cookie, 30-day Max-Age.
   **Nothing secret is reachable from JavaScript.** `localStorage` holds only the display name and
   colour, for instant first paint. Every later request authenticates by splitting the cookie and
   comparing the hash in constant time. *That is the entire auth system.*
5. **A name is held only while its owner is live** — yours while you are here, free **2 minutes** after
   you leave, unless you are seated in a lobby or a live game, in which case you are never reaped.
6. **Online-players list on the lobby screen**: `last_seen_at > now() − 5 minutes`, flagged `online`
   when `> now() − 45 seconds`, ordered by `last_seen_at desc limit 100`, and the same request stamps
   the caller's own heartbeat. A 45 s window against a ≤15 s poll means two missed polls before you look
   offline. Row deleted after 24 h by the reaper unless a live game references it.
7. **A 4-letter lobby code** to join, using super-smash's alphabet — four uppercase letters minus `I`
   and `O`, *"short enough to say in one breath, and free of the pairs that get misheard"*,
   **24⁴ = 331,776** codes (`06 §4.4`).

### 7.6 Where randomness lives (ruling 1 + `06 §5.2`)

**The engine contains no randomness at all, not even a seeded generator.** The reason is cheating, not
determinism: if the PRNG state sits in the client's copy of the state, a modified client can run the
generator forward and read the next dice roll **before deciding whether to attack** — the single most
attractive cheat available, and it costs nothing to close.

| Random thing | Decided by | What the log carries |
|---|---|---|
| Territory deal + seat order | server, at game creation, from `games.seed` | action `seq=1` `game_started` with the full assignment (public anyway) |
| Card deck order | server only, derived from `seed`, **never serialised** | nothing — deck order is not in the state |
| A card draw | server, when it happens | `card_drawn` with the concrete card |
| Attack dice / Blitz outcome | server, inside `POST .../actions` | `attack` with `payload.attackerDice: [6,4,2]`, `payload.defenderDice: [5,3]` (or the sampled BB outcome) |

Consequence for the client: **it must not predict dice.** It submits `attack`, shows the tumbling-dice
animation, and resolves when the authoritative action returns with the numbers — which is exactly what
the original game's UI does, so the constraint and the feel agree. Every *other* action is fully
determined and is applied optimistically (`06 §5.2`).

**Offline (ruling 1):** the local session runner owns the RNG; its seed is written into the saved local
state. **Online:** the server owns it and `games.seed` never leaves the server. Both paths call the same
resolver layer — `rollAttack(state, intent, rng)`, `drawCard(…)`, `dealTerritories(…)` — and the same
pure `apply(state, action)`.

### 7.7 Cost envelope (`06 §0`, `§1.4`, `§2.1`, `§4.1`)

| Budget line | Hobby/Free allowance | Option A consumes | Headroom |
|---|---|---|---|
| Vercel Function Invocations | 1,000,000 / mo | ~1,100 / player-hour (adaptive mix) | **~900 player-hours/mo** |
| Vercel Active CPU | **4 hours / mo** (= 14.4 M CPU-ms) | ~5 ms per 204, ~10 ms per delta | ~1.4 M polls — co-binds with invocations |
| Vercel Provisioned Memory | 360 GB-hr (Hobby is a fixed 2 GB / 1 vCPU → 180 instance-hours) | negligible for short handlers | the argument against SSE |
| Vercel Fast Data Transfer | 100 GB / mo | ~1.5 KB / poll | ~66 M polls — never binds |
| Neon compute | **100 CU-hours / mo** = 400 awake-hours at 0.25 CU | awake only while someone polls | ~13.3 h/day, every day |
| Neon storage | 1 GB / project | ~250 B / action row; 400–600 actions per 5-player game | ~4 M rows ≈ 7,000 games |
| Neon egress | 5 GB / project / mo | ~1–2 KB / poll | ~2.5 M polls |

Invocations per player-hour `= 3600 / interval`: 2 s → 1,800; 4 s → 900; 15 s → 240. In a 4-player game
you are on your own turn ~25% of the time, so the mix is `0.25·1800 + 0.75·900 ≈ 1,125`.
**20 players online 24/7 does not fit** (14,600 player-hours ≈ 21× over, and no interval fixes it);
**20 players for an hour a day fits with 34% headroom** (600 player-hours ≈ 660 K invocations);
90 minutes a day sits exactly at the line. *"That is the honest shape of the free tier, and it is the
right shape for a personal project."*

**The hard requirement that follows from Neon** (`06 §2.1`): scale-to-zero after 5 min idle is **fixed
and cannot be disabled** on Free, and **a single abandoned tab polling forever costs 182.5 CU-hours —
1.8× the allowance, exhausted around day 17.** Stopping the poll when the tab is hidden for a few
minutes is *not* an optimisation; it is the difference between a free database and a dead one. Neon
reactivates *"within a few hundred milliseconds"*, the cold start lands on the first person through the
door (fix it in the UI by rendering the lobby shell immediately), and it **never lands mid-game**
because a 2–4 s poll is far inside the 5-minute window (`06 §2.2`).

---

## 8. Visual design tokens (ruling 8; condensed from lane 04)

### 8.1 The one-sentence read (`04 §1.1`)

*A flat-shaded, chunky, extruded "board game on a glass tray"* — hard-edged vector landmasses with
near-black outlines raised a few millimetres above a bright cyan ocean, lit from directly above, no
textures, no gradients inside the land, under a heavy cartoon-UI chrome of glossy pill buttons and
circular discs. **Not painterly, and only nominally low-poly** — the polygons are in the silhouette,
not the shading.

### 8.2 Camera and board (`04 §1.2`–`§1.7`)

- Default view is **near-orthographic top-down with a 5–10° pitch**; side-walls show only along bottom
  edges at ~6–10 px. Zoomed/battle views pitch **25–35°** with 18–24 px extrusion.
- **Render the map as flat 2D SVG and apply the tilt with one property:**
  `transform: perspective(1400px) rotateX(θ)` on the wrapper — θ = `4deg` at rest, `18deg` + `scale(2.2)`
  for the battle close-up. **Do not model real 3D.**
- **Ocean is a flat fill, not a gradient** — `#22A4C8`, under 3% variance over 120 px. Three cheap
  overlays: a **coastal glow** (`feGaussianBlur` + `feFlood #7FE3FF` on the land-union path, drawn
  *under* the land), a sparse **white line net** (1 px, white at 8–12% alpha, 400–900 px segments,
  ~25–40 per screen), and optional coastal mottling. **No animated waves, no grid.**
- **Land is filled per OWNER, not per continent** — *"the single most important finding, and it
  contradicts the classic board game."* Continent identity shows only via the **Continent Overlay**, and
  a continent you fully control gets a glowing perimeter even without the overlay. Off-board land is
  neutral grey `#6B7785`.
- Edges: coastline **12–14 px** near-black (model as a 3 px `#0B0B0D` stroke per territory plus a
  land-union path offset +6 px in Y filled `#000` at 70% to fake the slab); internal borders **4–7 px**.
  Relief is a soft top-left inner highlight + bottom-right inner shadow only.
- Full-bleed to all four frame edges, plus a **strong radial vignette** toward `#06202A`. Modals dim the
  board by `rgba(0,0,0,0.42)` (measured factor 0.78–0.88) plus the modal's own tint.
- **Landscape-first:** all 304 evidence files are landscape, including the 1920×1080 iPhone store shots.

### 8.3 Core tokens (`04 §8.1`, abbreviated)

```css
--ocean:#22A4C8  --ocean-deep:#06202A  --ocean-glow:#7FE3FF  --ocean-line:rgba(255,255,255,.10)
--land-neutral:#6B7785  --land-outline:#0B0B0D  --land-wall:#07070A  --sea-route:rgba(255,255,255,.85)
--chrome-900:#0D1E30  --chrome-800:#101D24  --chrome-700:rgba(12,42,52,.70)
--chrome-600:#2A7F9E  --chrome-650:#1B5570  --chrome-line:#4E9CBB
--tray:linear-gradient(#B9B6B0,#8E8B85)  --scrim:rgba(0,0,0,.42)  --scrim-heavy:rgba(0,0,0,.55)
--go:#A6DC5F  --go-mid:#7FBE42  --go-deep:#4E7C2A  --go-bezel:#3E6420
--danger:#D8415C --danger-deep:#8C2739  --ok:#7ED957 --ok-deep:#55B13C
--gold:#F0C40F   --cyan:#19A7DB   --amber-top:#E6A93A --amber-bottom:#EFCB55 --amber-border:#EDC94F
--brand-red:#C42A30  --disabled:#757575 --disabled-line:#505050
--paper:#F3E6CB  --paper-edge:#D8C9A4  --suit:#BE2E36
--text:#FFFFFF --text-muted:#A9B6BC --text-dim:#6D8792 --text-on-amber:#4A3410 --stroke-dark:#161616
--c-na:#36B0EA/#0A2431  --c-sa:#DA3A4F/#300B0C  --c-eu:#5FBF2A/#1B310B
--c-af:#9B4AE8/#1E0D31  --c-as:#E08A24/#180D02  --c-au:#F0C33A/#312A0F     /* accent / tinted fill */
--r-pill:999px --r-card:18px --r-panel:12px --r-menu:10px --r-tray:18px --r-tip:30px --r-sheet:20px
--s-1..8: 4 8 12 16 24 32 48 64 px
z: ocean 0, land 10, routes 20, highlight 30, arrow 40, tokens 50, labels 60, floaters 70,
   hud 100, scrim 200, modal 210, banner 220, tip 230, toast 240
```

**Player colours** (`04 §2.2`, `§8.2`) — nine, each with `-light` (token face), `-dark` (land top face),
`-wall`, `-hot` (selected) and `-on` (text) variants:
Red `#D93244`/`#A8293A`/`#F4001A` · Green `#8FC94F`/`#4A7A3C`/`#5FE800` ·
Blue `#4DABF1`/`#3A7FB5`/`#009BFF` · Yellow `#E0B52E`/`#B59525`/`#FFC800` ·
Orange `#E7773D`/`#B5652C`/`#FF6A00` · Pink `#D139AD`/`#9B2A80`/`#FF00C8` ·
Black `#3D3D3D`/`#2B2B2D`/`#000000` · White `#D3D4D4`/`#B4B7BA`/`#FFFFFF` ·
Purple (9th, optional) `#7B3FE0`/`#4A2A86`/`#4A00E9`.
RGD's own free rotation is Red/Green/Yellow/Blue/Orange with Pink/Black/White premium (`03 §2.4`) —
**ours: all nine free, six seats max.** Selected state keeps the hue and clamps saturation to 100%
(`hsl(var(--h) 100% 46%)`). **Accessibility:** Red/Pink and Green/Yellow are the risky pairs — offer a
per-player **pattern overlay** (dots / diagonal / cross-hatch at 12% white) as a toggle; the game's own
blizzard hatching shows the style already fits (`04 §8.2`).

### 8.4 Troop tokens (`04 §3`, `§8.3`)

Flat circular **poker chip** seen from ~10° above: r ≈ **19 px** at 1600×900 on Classic (≈2.4% of frame
width), r ≈ 15 px on a dense map; **fixed screen-space size per map, it does not scale with the
territory**. Body depth 5–6 px (a second ellipse at ~65% lightness offset +5 px in Y, behind the face);
2 px rim at ~55% lightness; drop shadow `0 4px 6px rgba(0,0,0,.45)`. **Fill is the owner colour at the
bright token value, noticeably lighter than the land it sits on** (green token `#91CB5C` on green land
`#47763C`) — *this two-value system is what makes tokens pop.* Numerals: weight 800/900, white, **3 px
near-black outline**, cap height ≈ 0.62 × diameter for one digit, condensed to ≈0.52× for two; for three
digits **widen the disc into a stadium** (`rx = r`, width `38 + 11·(digits−1)`) rather than shrinking
type below 0.42× — never observed above 14 (`04 §9.10`), so this is extrapolated. `tabular-nums` is
essential so a 1 and a 7 occupy the same disc.

Token states (`04 §3.3`): idle · actionable (soft owner glow on the territory) · **selected** (fill
jumps to full saturation + a **3 px pure-white outline** following the path + an outer glow; the token
itself is unchanged) · legal target (lit while non-participants darken) · battle (both keep white
outlines, everything else heavily scrimmed, tokens replaced by 3D figurines) · just conquered (a
floating `−1`/`−4` rises, then the fill wipes to the new owner) · fog (`?` on the token, `???` in the
roster). **No pulsing ring or marching ants was observed** — any pulse is our addition.

**Attack arrow** (`04 §3.4`): one white solid gently-curved arrow, ~8 px tapering, 22 px triangular
head, 1.5 px dark outline, quadratic Bézier with the control point offset ~22% of the chord
perpendicular; above the figurines, below the dice popup. **Fortify path** (`04 §3.5`) is deliberately
different: a line of discrete **white chevrons `›`** (~22×26 px, 7 px stroke, 34 px pitch) along a
spline through the connected chain, animated source→destination on a 900 ms loop.

### 8.5 Type (`04 §5.5`)

**Titillium Web 700/900** for headlines and all numerals; **Barlow 400/500/600** for body; Barlow Semi
Condensed 700/800 as the alternate headline. Rejected: Oswald, Bebas Neue (too condensed), Russo One
(too geometric), Lato (too open). The exact RGD typeface is unidentified (`04 §9.3`) — observed traits
were a very heavy, slightly condensed face with flat horizontal terminals, a **single-storey `g` with an
open descender hook**, and flat-sided `D`/`B` bowls.

**The outline is the font** — every piece of text over the board carries it, and *"without this the
replica will not read as RGD, whatever font you pick"*:

```css
.on-board-text { font-family: var(--font-head); font-weight: 900; color: #fff;
  paint-order: stroke fill; -webkit-text-stroke: 3px #161616;
  text-shadow: 0 2px 3px rgba(0,0,0,.55); }
```

### 8.6 How to draw the map (`04 §8.5`, `§8.6`)

**One `<path>` per territory, one CSS variable per owner. That is the whole architecture.** Layer order:
flat ocean rect → line-net pattern → blurred land-union (coastal halo) → land-union offset +7 px
(extrusion) → `<g class="territories">` under the relief filter → continent perimeter glows → dashed sea
routes with white nodes (4 px, dash 14/12, r 7 nodes) → vignette rect (`pointer-events: none`).

Two load-bearing implementation notes:
1. **Keep the `d` strings chunky.** Real coastlines look wrong — the reference silhouettes are
   **12–30 vertices per territory** with visibly straight runs and angular corners. Run geodata through
   Douglas–Peucker at a tolerance that leaves that count, then round the joins. (This is the same
   simplification the Tier-3 pipeline needs, `02` Tier 3 step 5.)
2. **Tokens and labels are HTML above the SVG, not SVG children** — so they do not inherit the
   `rotateX` skew (which would make numbers look wrong), they use normal text rendering and
   `text-stroke`, and they are trivially animatable and accessible. Position with `translate3d` from a
   precomputed anchor.

Labels (`04 §8.6`): two anchors per territory — a **token** point and a **label** point ~26 px below it;
the anchor is the **pole of inaccessibility** (`polylabel`), not the bbox centre. **RGD makes no attempt
at collision avoidance** — labels spill onto the ocean and overlap neighbours; don't over-engineer it.
Hide labels when the territory's on-screen area is under ~2,500 px². Style: head 700, 19–22 px, white,
3 px dark stroke, `nowrap`, `pointer-events: none`.

### 8.7 Blitz win chance — constant gold by default (ruling 8)

The lane sampled the percentage readout at **100, 100, 99, 99, 91, 46 and 6 percent** and got
`#E3C108`, `#CBB82D`, `#CAB62F`, `#C7B738`, `#E6C40B`, `#E7C20F`, `#E3C10A` — i.e. **a constant gold
`#F0C40F` at every probability; the only thing that changes is the number** (`04 §2.7`). Variance is
JPEG noise and the per-frame scrim. **Ruling 8: keep the constant gold as the default.** The lane's
optional opt-in ramp, available as a clearly-flagged usability setting:
`≥90% #7ED957 · 70–89% #C6D84A · 40–69% #F0C40F · 15–39% #E8863A · <15% #D8415C`.

### 8.8 Motion (`04 §6`) — 25 animations; all durations are recommendations, not measured

Highlights: turn-start banner slides down 320 ms `cubic-bezier(.16,1,.3,1)`, holds 1200 ms, out 240 ms ·
received-troops ring scale 0.7→1 over 260 ms back-out with a 500 ms number tick · phase pip 220 ms
ease-out with a 160 ms label cross-fade · camera pan+zoom+tilt to the attack 420 ms
`cubic-bezier(.22,.61,.36,1)` · arrow draw-on 260 ms then a 120 ms arrowhead pop · dice tumble 3 dice
staggered 60 ms, 900 ms `rotate3d` with decreasing amplitude, 140 ms settle bounce, one-frame white
flash · **Blitz resolve 90 ms per round, max 12 rounds visible, then jump to the result** · troop-count
tick `min(600, 80·Δ)` ms with a 1.15× disc pulse · damage numeral translateY −40 px + fade over 700 ms
in `#FF4D5F` · territory capture = radial colour wipe 380 ms, 180 ms white flash at 35%, then the token
swaps · continent-captured glow 0→1→0.6 over 500 ms plus one outward ring pulse · cards-seized stagger
80 ms × 420 ms along an arc · victory stars fan out over 900 ms staggered 25 ms then rotate slowly for
8 s · modal scrim 180 ms in / 140 ms out · button press scale 0.96 with the bezel collapsing 4→1 px over
90 ms. **Respect `prefers-reduced-motion`:** keep the phase pip, troop tick and capture wipe as instant
state changes; drop the dice tumble, victory burst and ocean drift (`04 §6`).

### 8.9 Responsive (`04 §7`)

Landscape is one design scaled, with the HUD anchored to the four edges by percentage. Breakpoints:
**< 820 px** (phone landscape) — roster rows collapse to avatar + troop count at 56 px, title pill
22 px, utility icons 36 px, the icon stack goes horizontal; **820–1280 px** — full roster, token r 15;
**≥ 1280 px** — the reference layout; **≥ 1700 px** — reveal cards-held as a number. Cap HUD scale
above 1920 px and let the map take the extra area.

**Portrait has no evidence anywhere — §7.2 is entirely the lane's design** (`04 §9.2`), and
**ruling 8 adopts it**: do not rotate the map; scale-to-fit the width and fill the bands above and
below with HUD; roster becomes a horizontal strip of compact owner chips at the top (scrollable past 4
players, active chip filled and widened); action bar stays full-width at the bottom with the phase label
and pips above the button; the icon stack becomes one row above the action bar; modals become
full-width sheets, the card fan a horizontal scroller, and the Blitz view stacks attacker-above-defender;
offer a dismissible "rotate for the best view" hint on first portrait load.

### 8.10 What the visual lane could not see (`04 §9`) — ranked

1. **No video, only stills** — every duration and easing in §8.8 is a recommendation.
2. **No portrait layout exists** anywhere in the evidence.
3. **The exact typeface is unidentified.**
4. **All hexes are sampled from lossy JPEG under scrims and vignettes** — the *relationships* (token
   lighter than land, constant gold, flat ocean) are solid; absolute values may be off a few percent.
5. **Turn timer**: a 60 s timer provably exists; the only visual is a thin progress bar in older
   marketing art. **There is no evidence of a timer ring** — the 4 px bar under the phase label
   (`--accent-cyan` → `--danger` under 10 s) is invention.
6. Post-conquest slider, 7. the full-screen elimination banner, 8. Wild-card art, 9. the card
   silhouette's owner tint (one-frame sample), 10. three-digit tokens, 11. locked-map badges, 13.
   Settings / secret-mission / shop / rank / alliance-request screens, 14. Blizzards / Fog / Portals in
   play — all absent or single-sample; build them from the chrome tokens and the menu patterns.
12. **Two art generations are mixed in the evidence** — the 2021 store shots are flatter, lighter-blue,
    pill-token, bottom-centre-player-bar; the `bt*` video frames are the current darker, extruded,
    right-edge-roster style. **Everything specified here is the current `bt*` style**; store shots were
    used only where they are the sole evidence (chat bubbles, bot "thinking", turn-timer bar, skull
    disc) and those uses are flagged.
15. HUD pixel figures are ±8 px except the measured green button (238×48) and the pip row — **treat them
    as proportions, not a redline.**

**No SMG assets are used or required** — everything is geometry, colour, type and motion reproducible in
SVG, CSS and canvas (`04` header, ruling 8).

---

## 9. Architecture and conventions (ruling 1 + 10)

### 9.1 Layering

```
src/engine/      pure. apply(state, action) + validate + legalActions + hashState + decideTurn (bots)
                 + the odds tables + the Balanced Blitz reshaper.  NO randomness, NO clock, NO DOM.
src/engine/resolver/   pure but rng-taking: rollAttack(state, intent, rng), drawCard(state, rng),
                 dealTerritories(map, seats, rng).  Produces the ACTION whose payload carries the outcome.
src/game/        the session runner: holds GameState in a closure, mirrors UI slices into a
                 zustand/vanilla store, dispatches, feeds events to animations, autosaves. Owns the
                 RNG offline.  (island-empire's createSession() is the shape to copy — 00 §2.)
src/render/      pure render(ctx|svg, state, ui, camera, now). No React.
src/components/  React shells; GameCanvas-style ref+rAF loop with a dirty flag.
src/net/         the Sync port + PollingSync adapter (room for SseSync / DurableObjectSync later).
src/ports/       interfaces (SettingsPort, LocalProgressPort, SyncPort).
src/adapters/    db (PGlite | Neon via getDb()), localStorage.
src/app/api/     route handlers — the only place the server engine is invoked.
src/content/     map JSON (lazy-loaded per map), dialog roster, persona table.
src/config/      env.ts — driver selection + the production PGlite guard.
```

**The engine's public contract** mirrors island-empire's `src/engine/index.ts` (`00 §2`):
`createInitialState`, `apply`, `legalActions`, `validate`, `hashState`, plus Risk-specific selectors —
`legalAttackTargets`, `legalFortifyMoves`, `cardTradeValue`, `winChance`, `decideTurn`,
`generateRandomMap`, `validateMap`, `serializeState`/`deserializeState`.

**Every reducer branch validates first and returns `{ state: input, events: [], error }` on a rule
violation — nothing in the reducer throws for an illegal action.** Legal transitions build through an
immutable draft helper and push typed `events` the session runner turns into animations: Risk's union is
`{ type: "diceRolled" }`, `{ type: "territoryCaptured" }`, `{ type: "cardAwarded" }`,
`{ type: "continentHeld" }`, `{ type: "playerEliminated" }`, `{ type: "seatToBot" }` (`00 §2`).

Action set: `TRADE_CARDS` · `DRAFT` · `ATTACK` · `MOVE_IN` · `FORTIFY` · `END_PHASE` · `END_TURN`
(+ server-only `AUTO_DEPLOY`, `SEAT_TO_BOT`, `SEAT_TO_HUMAN`, `GAME_STARTED`, `CARD_DRAWN`) — the Risk
equivalent of island-empire's `MOVE/BUY/UNDO/END_TURN` (`00 §2`).

**`EngineApi`** — a narrow interface wrapping `@/engine` so tests can inject a scripted engine
(`00 §2`).

### 9.2 The layering test (ruling 1)

Copy the *shape* of `super-smash/src/engine/layering.test.ts` / island-empire's 214-line version
(`00 §2`, `06 §5.1`). It walks `src/engine/**/*.ts(x)` **off disk** (not the bundler graph), strips
comments and string literals first so its own banned-word list cannot trip itself, then asserts:

1. no import of `["react", "react-dom", "next", "zustand", "zod"]`;
2. no import of a sibling layer by first path segment — for Risk:
   `["render", "game", "components", "app", "net", "ports", "adapters", "content", "config", "lib"]`;
3. no relative import escaping `src/engine/`;
4. **no call to `Math.random`, `Date.now`, `performance.now`, `new Date`, `crypto.`** — *"non-negotiable
   for Risk: dice rolls must go through a seeded PRNG, never `Math.random()`, or replay/undo/AI-vs-human
   determinism all break"*;
5. no reference to `window`, `document`, `localStorage`, `navigator`, `fetch(`, `process.env`;
6. and the guard **unit-tests itself** (catches a forbidden import, does not false-positive on a comment
   or string).

The resolver layer sits *outside* this ban list only in that it accepts an `Rng` **parameter** — it still
may not call `Math.random`.

### 9.3 Stack pins — exactly as read off island-empire's `package.json` (`00 §1`)

```
next 16.3.0 · react 19.2.8 · react-dom 19.2.8 · zustand ^5.0.15 · tailwindcss ^4 ·
@tailwindcss/postcss ^4 · typescript ^5 · eslint ^9 · eslint-config-next 16.3.0 ·
@playwright/test ^1.62.1 · vitest ^4.1.10 · @vitest/coverage-v8 ^4.1.10 · jsdom ^30.0.1 ·
vite ^8.2.1 · vite-tsconfig-paths ^6.1.1 · @vitejs/plugin-react ^6.0.5 · fast-check ^4.3.0 ·
@testing-library/{jest-dom ^7.0.0, react ^16.3.2, user-event ^14.6.3} · clsx ^2.1.1 ·
@types/{node ^20, react ^19, react-dom ^19} ·
@electric-sql/pglite ^0.5.5 · @neondatabase/serverless ^1.1.0 · server-only ^0.0.1 ·
ws ^8.21.3 + @types/ws ^8.18.1 · nanoid ^6.0.1 · zod ^4 (island-empire pins ^4.4.3)
```

**pnpm. No `trystero`** (`00 §1`, `§3` recommendation; `06 §4.4`). Scripts: the six core
(`dev build start lint test test:watch test:e2e test:e2e:ui typecheck`) plus
`db:push` (`node --experimental-strip-types scripts/db-push.ts`), `build:schema`, `prebuild`, and
**`verify` = `pnpm run typecheck && pnpm run lint && pnpm run test`** (`00 §1`).

`tsconfig.json`: island-empire's, **with `noUncheckedIndexedAccess`** — *"a 42-territory board with
adjacency arrays is exactly the kind of indexing code it catches real bugs in"* (`00 §1`).
`eslint.config.mjs` and `postcss.config.mjs`: byte-identical to every sibling, copy verbatim.

`next.config.ts` (`00 §1`): `reactStrictMode: true`, `devIndicators: false`,
**`agentRules: false`** (keeps CLAUDE.md/AGENTS.md out of the deliverable),
`serverExternalPackages: ["@electric-sql/pglite", "@neondatabase/serverless"]`,
`outputFileTracingIncludes: { "/*": ["./node_modules/@neondatabase/serverless/**/*"] }`, and the
**Turbopack root pin** `turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) }` — without it
Turbopack walks up and can land on a sibling project's lockfile.

`vitest.config.mts` (`00 §1`): island-empire's verbatim — `tsconfigPaths()` + `react()`, the
`server-only` → `src/test-support/empty-module.ts` alias, jsdom, globals, `vitest.setup.ts`,
`include: ["src/**/*.test.{ts,tsx}"]`, and **`testTimeout`/`hookTimeout` 30_000** because PGlite boots a
WASM Postgres per suite. **Use `fileURLToPath`, not `URL.pathname`** — this repo's path contains a
space and `.pathname` percent-encodes it, silently breaking the alias. `vitest.setup.ts` copies the
`next/navigation` mock plus the jsdom shims for `matchMedia`, `ResizeObserver`,
`IntersectionObserver`, `scrollIntoView` and **pointer capture** (which Risk needs for dragging troop
sliders).

`playwright.config.ts` (`00 §1`, `06 §6.2`): **`PORT = 3300`** (3000 dollar-pixels/super-smash, 3100
Linear, 3200 island-empire, 3211 Wikipedia, 3400/3401 youtube/fl-studio are taken),
**`fullyParallel: false`, `workers: 1` — load-bearing**, because two workers means two `next start`
processes means two PGlite instances means the two online players are in different universes.
`webServer.command = "pnpm run build && pnpm exec next start --port 3300"` (test what deploys),
`timeout: 600_000`, env `DB_DRIVER=pglite`, `DB_DATA_DIR=:memory:`,
`E2E_ALLOW_PGLITE_PRODUCTION_BUILD=true`, `RISK_TURN_SECONDS=3`, `RISK_FIXED_SEED=e2e-seed`,
`NEXT_PUBLIC_RISK_DEBUG=1`. Projects: **`desktop-chrome` and `mobile-chrome` (Pixel 7)**, viewport
1280×800.

Deploy (`00 §6`): `.vercel/project.json` name **`risk-david`** (the `<slug>-david` norm; `davids-wikipedia`
and `art-wall` are the two exceptions), org `team_BC3HgrHfxsteTwroadm1TaKB`;
`vercel.json` = `{ "buildCommand": "pnpm run db:push && pnpm run build" }`; manual
`npx vercel deploy --prod --yes` from inside the folder; `DATABASE_URL` set as a Vercel env var.
Commits go **straight to `main`**, no PR flow (`00 §6`).

### 9.4 Stores

- **`GameState` never enters React state or the zustand store** — only derived UI slices do
  (`00 §2`). The canvas/SVG loop repaints from the live state via a dirty flag, bypassing React's render
  cycle; *"this is the one rule to copy exactly — a territory map painted from `apply()`'s output must
  not go through React state, or clicking a territory will visibly lag behind a re-render."*
- UI store (`zustand/vanilla`): `selected`, `litZone` (legal targets), `phase`, `actionMode`,
  `bannerText`, `actingSeat`, `botPlaying`, `handOff`, `gameOver`, `modal`, `toast`, `settings`,
  `overlayMode`, `attackLimit`, `blitzWinChance`, `syncStatus`.
- `SessionOptions` takes injected `now()` and `schedule()` (a `(fn, ms) => cancel` swappable for a
  synchronous test scheduler), `skipAnimations`, and `resume?: SavedSession | null` (`00 §2`).
- **Bot pacing** (`00 §2`): `AI_STEP_MS = 300`, `AI_TURN_BUDGET_MS = 4000`, `AI_STEP_MIN_MS = 40`,
  `aiStepMs(n) = max(40, min(300, floor(4000 / max(1, n))))` — so a long late-game bot turn still
  finishes in ~4 s. Purely presentational; the decision is already computed (`05 §7.2`).

### 9.5 localStorage keys (`00 §4`) — the `:v1` suffix is the convention; bump, never migrate

| Key | Contents |
|---|---|
| `risk:settings:v1` | `{ cameraAnimations, phaseAnimations, endPhaseConfirmation, music, sound, colourPatterns, winChanceRamp }` |
| `risk:progress:v1` | `{ maps: Record<slug, MapRecord>, deviceId }` — `deviceId` from `crypto.randomUUID()` with a `Math.random` fallback |
| `risk:session:v1:<sourceKey>` | the resumable in-progress offline game, **including the RNG seed and state** (ruling 1) |
| `risk:identity:v1` | display name + colour only, for first paint. **Never a secret** (`06 §4.5.2`) |

`sourceKey(config)` must encode everything that shapes the initial state — map slug, seat configuration
(who is human/bot and at what difficulty), player count, rules hash — *"anything that changes what a
resumed GameState even means"* (`00 §4`). All reads/writes wrapped
`try { … } catch { /* storage unavailable — the feature simply doesn't persist */ }` with
`typeof window !== "undefined"` guards, and a module-level listener `Set` so every open tab reacts.

### 9.6 Database adapters (`00 §3`, `06 §3.1`, `§6.1`)

Copy island-empire's `src/adapters/db/*`, `src/config/env.ts`, `scripts/db-push.ts`,
`scripts/build-schema.mjs` and the `vercel.json` buildCommand verbatim, changing
`Symbol.for("island-empire.db")` → **`Symbol.for("risk.db")`**. The `globalThis` registry is **not
optional**: *"Next builds several module graphs per app… a module-scoped singleton is a singleton per
graph, not per process,"* and with PGlite that means multiple WASM Postgres instances against one data
directory corrupting its WAL. `env.ts` picks the driver (`DATABASE_URL` present → `neon`, else
`pglite`), **throws** on an unrecognised `DB_DRIVER` (never silently falls back), and **refuses
`pglite` under `NODE_ENV=production`** unless `E2E_ALLOW_PGLITE_PRODUCTION_BUILD` is set *and* no
serverless marker (`VERCEL`, `AWS_LAMBDA_FUNCTION_NAME`, …) is present — so the escape hatch can never
fire on a real deployment. `scripts/db-push.ts` re-implements driver selection standalone because
`server-only` plus TS parameter properties do not survive `node --experimental-strip-types`.

Local dev: `DATABASE_URL` unset → PGlite at `.data/risk` → `pnpm install && pnpm run dev` and **an
online game works between two browser windows on one machine with nothing to install and no account**
(`06 §6.1`).

### 9.7 e2e harness (`06 §6.3`, `00 §5`)

Expose a debug handle only when `NEXT_PUBLIC_RISK_DEBUG === "1"` (the super-smash `window.__smashDebug`
pattern):

```ts
window.__riskDebug = {
  seq:   () => confirmedSeq,
  state: () => structuredClone(confirmedState),   // simulation truth, not pixels
  pollNow: () => pollOnce(),                      // resolves when the response is applied
  setInterval: (ms: number) => { pollEveryMs = ms },
};
```

**Drive the poll instead of sleeping** — the naive two-player test sleeps 2.5 s after every move and
takes ten minutes. Helpers: `sync(...pages)` (all `pollNow()` in parallel) and
`expectSeq(page, seq)`. Two players = **two Playwright contexts** (separate cookie jars → genuinely two
`risk_sid`s); two *pages* in one context is a different, also-worth-having test (one account, two tabs).
**Assert on `__riskDebug.state()`, not on the canvas** — *"pixels can only tell you something was
painted, not whether the simulation moved."* The renderer gets its own unit tests.

**Screenshot capture** (`00 §5`): `CAPTURE=1`-gated spec, `test.describe.configure({ mode: "serial" })`,
`test.skip(!CAPTURE, …)`, `shot(name) => "docs/screenshots/${name}.png"`, run as
`CAPTURE=1 npx playwright test screenshots --project=desktop-chrome` plus a `mobile-chrome` pass
suffixing `-mobile`. **Wait for a photographable moment by reading state truth, not a fixed delay** —
for Risk, "the dice have resolved and both troop counts have updated" before snapping a combat shot.

### 9.8 Documents (`00 §5`)

`README.md` — `# Risk` → bold one-line hook → one lead paragraph → two 3-image screenshot tables
(`<img … width="240" alt="…">`) → 3–4 bold-led "the bet" paragraphs → a stats line; plus super-smash's
`## Index` table of every doc/src path and a closing `## Known gaps` / `## What this is`, *"worth
keeping for Risk given how many rules-interpretation calls a Risk clone has to make and disclose."*

`SPEC.md` — island-empire's section list exactly, all at `##` level (never Linear's `###` nesting):
Vocabulary · Scope · Rules · Architecture · Data flow · HTTP surface · Screens · Visual design ·
Controls · Efficiency plan · Testing · Work-stream decomposition · Out of scope.

`DECISIONS.md` — `# Risk — Decision Log`, then sequential `## D1 — <full-sentence title describing the
choice and its consequence>`, **never renumbered or reused**, each with **Decision. / Why. /
Consequence.** paragraphs.

`research/` keeps the `00-`…`07-` numbering; `docs/screenshots/*.png` holds the app's own shots and is a
**different directory** from `research/screenshots/` (raw third-party reference). Wikipedia sibling:
add a `projects.ts` entry, a `riskMeta` in `articles/meta.ts`, `articles/risk.tsx`, registration in
`articles/index.ts`, and `public/images/<Slug>.png`, once there is a live deployment (`00 §5`).

### 9.9 Testing bar (ruling 11)

| Suite | Content |
|---|---|
| **Engine unit** | every rule in §2; the three card-timing branches as three separate tests; the §2.10 edge cases |
| **Dice tables** | the **six verified single-roll probabilities** with their exact fractions (`05 §4.1`); SMG's `0.292566872427984` 3v2 cross-check; the 300v800-zombie DP check `0.8897332621740284`; spot cells from the §2.4 conquer table; the break-even rows |
| **Balanced Blitz bit-exact** | 30v15 at a capital, losing exactly 12 → TR **`0.0222128001707278`** and BB **`0.0100282888709122`**; **49 attackers** is the fewest for ≥80% BB against 50 (47→72.03%, 48→77.10%, 49→82.15%); the stage-2-only value at A=49 is 75.7% so a power-only implementation fails; `20 v 15` BB = exactly 100% |
| **Property (fast-check)** | `∀ state. hashState(state) === hashState(roundTrip(state))`; `apply` never throws on an arbitrary action; adjacency symmetry survives every modifier; troop conservation across a battle; `W[A][D]` monotone in A and antitone in D; the CDF walk over `u ∈ {0, ε, 0.5, 1−ε}` |
| **Golden replays** | `(seed, map, settings, personaAssignment)` + a state hash after every turn for a few hundred bot-vs-bot games; a changed hash must be an explicit versioned change (`05 §7.2`) |
| **Map validator** | run against **every shipped map**: symmetry, no dangling refs, every territory has geometry, continent membership complete, label anchors present, viewBox contains all geometry (`02` Tier 2) |
| **Layering** | §9.2, build-failing, self-testing |
| **API routes on PGlite** | claim/409/suggestions; `FOR UPDATE` serialises two simultaneous POSTs into contiguous `seq`; one `clientActionId` twice → one row, both 200s; 204 on no change; snapshot only when cold; the lazy tick runs a bot with no cron and chains under `MAX_TICK_ACTIONS`; the reaper closes a stale lobby |
| **Playwright e2e** | (1) solo game to victory on a **tiny map** (`preeminence/tiny4` or Mini); (2) pass-and-play hand-off between two seats with fog respected; (3) **online two-context game**: create lobby → join by code → play a turn each → send a chat line → force a timeout (`RISK_TURN_SECONDS=3`) → assert bot takeover, then reconnect → `seat_to_human`; (4) client replays the log from `seq=0` and `hashState` matches every `state_hash` — **write this one first; it is the determinism proof and everything else depends on it**; (5) `CAPTURE=1` screenshots |
| **Cost assertions** | a dev-only `Server-Timing` header read over 200 driven polls (the 204 path must stay under ~5 ms) and an assertion that the 204 path has no body and a one-action delta is under 1 KB (`06 §6.5`) |

---

## 10. Efficiency notes

**Bot compute** (`05 §6`, measured in Node, single-threaded): the true-random 101×101 DP table builds in
**2.07 ms / 80 KiB** (201×201: 1.80 ms / 316 KiB); 5 M lookups take 5.75 ms (**~1.15 ns each**); a greedy
scan of 400 candidate attacks with ~8-flop scoring is **0.0013 ms**, and 20 such passes (draft + attack
chain + fortify) ≈ **0.027 ms**. *"The 100 ms budget is ~3,700× larger than a full greedy bot turn
needs."* Per-phase complexity at T=100: strength/hostility O(T+P) ~100 ops; BSR O(E) ~200; continent
scoring ~120; draft placement O(n log T); attack scoring O(E) per pass; **ply-0 total O(T·E) ≈ 0.03 ms**.
Ply-1 (top ~8 candidates × each opponent's best reply) is 1–5 ms — **the right Expert design**. Ply-2 is
20–200 ms and borderline; if wanted, restrict to the top 3 candidates × 3 opponent replies. **MCTS and
rollouts are out.** Use flat `Int16Array`/`Float32Array` for board state inside the bot (no object
churn, no GC pauses mid-turn), allocate nothing inside the candidate loop.

**The one real cost is the Balanced Blitz table** — 4.4 ms at 32×32, 37.2 ms at 64×64, **199.8 ms at
100×100**, because each cell needs its own O(A·D) outcome distribution. **Never at init, never per
turn**: memoise lazily (small battles dominate), or later ship a 40 KiB precomputed `Float32Array`
asset, which also removes the `Math.pow` portability risk (`05 §6`, `§5.5`).

**Poll cost** — see §7.7. The three rules that keep it inside the free tier: **204 on no change**
(the common case), **delta not snapshot** (snapshot-every-poll binds Active CPU at 576 K vs 1.4 M),
and **stop polling when hidden** (one abandoned tab is 1.8× the whole Neon allowance). Fold presence,
chat and the tick into the one poll — separate polls would cost 3× for no added capability
(`06 §4.1`, `§2.1`).

**Render cost** (`00 §2`, `04 §8.5`): one SVG board with one `<path>` per territory and one CSS variable
per owner; tokens and labels in an HTML layer above it; the whole camera language is a single
`transform` on the wrapper. Repaint only on a dirty flag plus a slow ~500 ms ambient bucket; the live
state never passes through React. Territory `d` strings are simplified to **12–30 vertices**, which is
both the correct art direction and the cheap one.

**Bundle** (ruling 3 + 10): **map data is lazy-loaded per map** — one JSON fetch carrying its own
geometry, so the initial bundle never contains 13 boards. Reference weights from the corpus: the
TotalRisk world SVG is ~140 KB, `world-atlas` countries-110m is **108 KB**, `BlankMap-World.svg` is
1.1 MB raw (`02 §B.6`, `§B.5`) — simplify to ~2–5% in the build step and keep each shipped map well
under 100 KB. Natural Earth/us-atlas sources stay in `research/map-data/` and in the build pipeline;
**they are never shipped to the client.**

**No server compute per turn offline** (`00 §2`): solo and pass-and-play run entirely client-side, so
Vercel serves static assets plus the online routes only.

---

## 11. Open items and contradictions — each with the chosen default

| # | Item | Lanes | Chosen default |
|---|---|---|---|
| 1 | **Forced-trade threshold**: rulebook "5 or 6" vs an RGD article paraphrased as "exactly 5" | `01 §3.6` | **≥5 at turn start forces at least one set** (the paraphrase is loose phrasing; card count cannot normally exceed 6 anyway) |
| 2 | **Fortify hop count**: the rulebook's *standard* rule is single-hop adjacency; its *expert* variant and SMG's own wording are connected-path | `01 §5`, `03 §2.5` | **Connected path through own territories, one move per turn**, with a graph-reachability check |
| 3 | **Capitals also grant +2 troops every Draft?** Lane 03 says yes **[guide]**; lane 01's sourcing covers only the win condition and the defender's 3rd die | `03 §2.1` vs `01 §6.2` | **Implement win condition + defender +1 die only** (ruling 4). Keep the +2 as a documented, off-by-default modifier flag |
| 4 | **Portals Unstable semantics**: "relocates every few turns, inactive for one turn after moving" vs "randomised destination each time" | `02 §A.1` vs `03 §2.2` | **Relocate on a fixed cadence (every 3 rounds) and be inactive for the round after moving** — the more specific reading |
| 5 | **Max Rounds tiebreak** — not found in any source | `01 §6.5` | **Most territories, then most troops** (ruling 4) |
| 6 | **Percentage Domination range** — only 70% is sourced | `01 §6.5` | **Default 70%, adjustable 50–90%** (ruling 4) |
| 7 | **Turn-timer list** 60/90/120/180/300 s is community-sourced only | `01 §6.8` | **Ship exactly that list, online only; default 90 s** (RGD's matchmaking default is 60 s but 90 s suits a slower casual game) |
| 8 | **Timeout behaviour** — no official rule for "after N missed turns" | `03 §4.3` | **Auto-end the turn on timeout; after 2 missed turns AND 2 min unseen, the seat becomes a bot; it flips back on the player's next poll** (`06 §4.5.4`) |
| 9 | **Bot difficulty tier names** — "Hard" is player testimony; lane 05 recommended dropping Beginner | `05 §1.2` | **Ship all five: Beginner / Easy / Medium / Hard / Expert**, labelled as RGD's `AI Difficulty` (ruling 5) |
| 10 | **Persona → difficulty mapping** is nowhere published | `05 §1.3` | Use the `05 §3.5` tier table as ours and say so |
| 11 | **Bots and alliances** — no first-party statement; one 2020 bug report says a replacement AI will not attack its ally | `05 §1.3` | `allianceLoyalty` 1.0 at Beginner–Medium, 0.9 Hard, **0.6 Expert with rare, decisive betrayal** |
| 12 | **Bot card policy in Progressive** — nothing published | `05 §3.1` | The derived rules in `05 §3.1`: trade immediately under Fixed; hold under Progressive while the next set value is rising and the hand is ≤4 |
| 13 | **2-player neutral figures in RGD** — fandom page unfetchable | `01 §1.3` | **The rulebook's 40/40/40 + 14/14/14** |
| 14 | **Auto Placement's army distribution formula** — none found | `01 §1.5` | Even distribution across the seat's assigned territories, remainder placed by the `secure` policy, seeded |
| 15 | **"Move All" button label** — no SMG citation | `01 §4.5` | Ship a jump-to-max affordance labelled **`Move All`** **[ours]** |
| 16 | **Blitz Attack Limiter exact behaviour** — medium confidence; SMG's code models it as `stopUntil` with a third `UnresolvedChance` outcome | `01 §4.2`, `05 §2.13` | Implement `stopUntil` truncation; **do not claim the stop rule is optimal** |
| 17 | **Elimination banner** — no frame in 304 files | `04 §9.7` | Mirror the Victory screen with a desaturated portrait and `Defeated!` |
| 18 | **Turn-timer visual** — no ring anywhere | `04 §9.5` | A **4 px bar under the phase label**, `--cyan` draining to `--danger` with a 1 Hz pulse under 10 s |
| 19 | **Three-digit troop tokens** — never observed above 14 | `04 §9.10` | Widen the disc into a stadium (`rx = r`), cap at 3 digits, then `99+`-style truncation |
| 20 | **Wild-card art** — never shown | `04 §9.8` | All three suit silhouettes overlapping, in `--suit` |
| 21 | **Card silhouette tint = owner colour?** one-frame sample | `04 §9.9` | Tint by **owner**, as sampled |
| 22 | **Portrait layout** — no evidence at all | `04 §9.2` | Adopt `04 §7.2` wholesale (ruling 8) |
| 23 | **Motion durations** — all recommendations, stills only | `04 §9.1` | Adopt `04 §6`'s 25 entries as written, and honour `prefers-reduced-motion` |
| 24 | **Exact typeface** unidentified | `04 §9.3` | **Titillium Web 700/900 + Barlow**; A/B against Barlow Semi Condensed later |
| 25 | **Palette hexes** sampled from lossy JPEG under scrims | `04 §9.4` | Ship `04 §8.1` as the token sheet; treat relationships as fixed, values as tunable |
| 26 | **Two mixed art generations** in the evidence | `04 §9.12` | **The current `bt*` style everywhere**; store-shot-only details (chat bubbles, bot "thinking", timer bar, skull disc) are flagged where used |
| 27 | **Atlantis** 8 vs 9 regions; **Europe Advanced** 84 vs 83 territories (two wiki surfaces disagree) | `02 §A.1` | Irrelevant — neither map ships; recorded so the catalogue is not trusted blindly |
| 28 | **Dino Canyon's `-: 0` region** on the wiki | `02 §A.1` | A wiki data gap, not a rule: **no map has a zero-value region** |
| 29 | **Middle Earth** has a clean MIT graph but no geometry and Tolkien IP in the names | `02 §A.3` | **Original names only, and only if geometry can be generated; otherwise skip** (ruling 3) |
| 30 | **Zombies numbers** (outbreak %, conversion %, dice augment) all unverified | `01 §6.6` | **Out of v1.** The `attackDicePenalty` / ties-to-attacker augment stays in the dice model (`05 §4.6`) so the mode is cheap to add later |
| 31 | **Teams (2v2/3v3)** — not shipped in RGD, roadmap only | `01 §6.10`, `03 §4.4` | **Out of v1.** Building it would be a new feature, not parity |
| 32 | **5-Rounds-Rumble vs "Fast Blitz"** naming and whether the win is "most territories at the end of turn 5" | `01 §6.5`, `03 §2.1` | **`Max Rounds` modifier, default off, preset 5 labelled `5-Rounds Rumble`**, with the §11-5 tiebreak |
| 33 | **Weekly "community expression"** rotating chat line | `03 §5.1` | Out of v1; recorded as a future idea |
| 34 | **`Math.pow` is not bit-identical across JS engines** and appears in BB stages 2 and 4 | `05 §5.5` | **Quantise the CDF** to a `round(x · 2^32)` grid before comparing against `u`; ship our own `pow` for p=1.3/1.8 only if a divergence is ever observed |
| 35 | **Neon egress accounting** — the docs do not settle whether same-region Vercel traffic counts | `06 §4.1` | Assume it does (the conservative reading) |

---

## 12. Decision candidates for `DECISIONS.md`

Numbered D-candidates; one-line reasoning each. Final numbering is assigned when the log is created,
sequentially and never reused (`00 §5`).

| # | Decision | Why |
|---|---|---|
| **D-1** | The app is titled **"Risk"**, and `DECISIONS.md` states that RISK is a Hasbro trademark, that this is a non-commercial portfolio replica, and that it contains no original assets. | Siblings are titled after their originals; the trademark and the absence of copied artwork must both be on the record (`02 §B.4`, `00 §5`). |
| **D-2** | `apply(state, action)` is **pure and contains no randomness at all**, not even a seeded generator. | A PRNG in client state lets a modified client read the next dice roll before deciding to attack — the single most attractive cheat, closed for free (`06 §5.2`). |
| **D-3** | Every random outcome — opening deal + seat order, card draws, dice, the Balanced Blitz sample — is **carried inside the action payload**. | Makes the log the single source of truth and lets a replay be verified without re-running anything (`06 §5.2`, `05 §8`). |
| **D-4** | A separate pure **resolver** layer (`rollAttack`, `drawCard`, `dealTerritories`) takes an explicit **seeded PCG32** with **purpose-tagged sub-streams**. | *"The single most important determinism decision in the whole design"* — without it any bot tweak that shifts one draw breaks every stored replay (`05 §7.1`). |
| **D-5** | **Offline the session runner owns the RNG and its seed is saved in local state; online the server owns it and `games.seed` never leaves the server.** | One engine, two authorities, no secret in the browser (`06 §5.2`, `00 §4`). |
| **D-6** | **One PRNG draw per battle**, by inverse-CDF sampling of the outcome distribution, not one per roll. | SMG's own `OddsBasedBattle` method and the only one Balanced Blitz supports; a battle costs one draw however long it "lasts" (`05 §5.5`). |
| **D-7** | **Quantise every float that decides a branch** (notably the BB CDF walk) before comparing. | `Math.pow` is not bit-identical across JS engines and appears in BB stages 2 and 4 (`05 §5.5`). |
| **D-8** | `decideTurn(view, seat, persona, odds, rng)` is **pure, lives in the engine package, and returns a `TurnPlan` as data**. | Solo and online bot seats share one implementation and one test suite; the UI can animate the plan at any speed (`05 §8`, `06 §4.5.3`). |
| **D-9** | A **build-failing layering test**, copied from super-smash/island-empire, bans React/Next/zustand/zod, sibling layers, relative escapes, `Math.random`/`Date.now`/`new Date`/`crypto.`, and DOM globals inside `src/engine/`, and unit-tests itself. | Mechanically enforces D-2 and D-4, which otherwise rot (`00 §2`, `06 §5.1`). |
| **D-10** | Online is **Option A**: server-authoritative engine behind route handlers, append-only `game_actions` with contiguous `seq`, adaptive polling, 204 on no change, **three** poll endpoints, lazy ticks, cookie identity, PGlite locally and Neon deployed. | The only option whose cost model can be computed on Hobby + Neon free, and the one that survives a refresh and a closed tab (`06 §0`, `§4.1`). |
| **D-11** | Polling is **2 s on your turn / 4 s off it / 5 s in the lobby / 15 s hidden, stopping entirely after 5 minutes hidden**, with ±15% jitter and an immediate re-poll on visibility-regain and after your own POST. | Stopping when hidden is the difference between a free Neon database and a dead one — one abandoned tab is 1.8× the whole allowance (`06 §2.1`, `§4.1`). |
| **D-12** | The game poll **folds presence, chat, the delta and the lazy tick into one invocation**, returns **204 with no body** when nothing changed, and returns a snapshot only to a cold or compaction-lagging client. | Separate polls cost 3× for no capability; snapshot-every-poll binds Active CPU at 576 K instead of 1.4 M (`06 §4.1`). |
| **D-13** | Bot turns, turn-timer expiry, seat-to-bot takeover and garbage collection all run **lazily inside whichever poll arrives next**, under a `tick_lease` and an `MAX_TICK_ACTIONS ≈ 40` cap; one daily cron is belt-and-braces only. | Hobby cron fires **once per day**, so nothing periodic can depend on it — and work that only happens when someone is watching is strictly better (`06 §1.5`, `§4.5.3`). |
| **D-14** | Every timeout, takeover and reconnect is **a row in the action log**, never a side effect. | Clients learn about a takeover exactly as they learn about a dice roll, and replay it identically (`06 §4.5.4`). |
| **D-15** | `clientActionId` is minted **once per intent (the click)**, enforced by a unique index, and a duplicate POST returns **200 with the already-recorded action**. | A retry must be indistinguishable from a slow success; a resend with a fresh id is a second attack (`06 §5.4`). |
| **D-16** | Every action row carries a `state_hash` over a **canonical** serialisation; the client asserts it and on mismatch **drops local state and refetches** rather than reconciling. | A desync is a bug in `apply`; the only useful response is loud and recoverable (`06 §5.5`). |
| **D-17** | Identity is a **display name chosen on arrival** (or a generated `<Adjective> <Noun> <NN>` default of our own wording), a **server-minted httpOnly cookie**, a name held only while live and released **2 minutes** after leaving unless seated, an online-players list, and a **4-letter lobby code** (24⁴ = 331,776, no `I`/`O`). | RGD has no custom usernames at all, so this is ours; the server-minted secret means nothing sensitive is reachable from JavaScript (`03 §6`, `06 §4.5.2`, `§4.4`). |
| **D-18** | **Reinforcements = `max(3, floor(territories / 3))`**, with Classic continent bonuses NA 5 · SA 2 · EU 5 · AF 3 · AS 7 · AU 2, checked at the start of the owner's turn. | Rulebook and SMG's own "WIKI - Draft" / "WIKI - Conquering Continents" agree verbatim (`01 §2.2`, `§2.3`). |
| **D-19** | **Fixed card bonuses are 4/6/8/10 with a +2 territory bonus capped at +2 per turn (so 12 max); Progressive is 4, 6, 8, 10, 12, 15, then +5 per set forever.** | Two independent high-authority sources agree verbatim on both schemes (`01 §3.4`, `§3.5`). |
| **D-20** | **The three card-timing branches are modelled distinctly**: ≥5 at turn start forces a trade; your own reward draw to 5–6 forces nothing until next turn; inheriting a hand to ≥6 mid-turn forces an immediate trade-down to ≤4, stopping at 4, 3 or 2. | *"The single most important and easy-to-get-wrong card-timing rule in the whole ruleset"* (`01 §3.6`, `§3.7`, `§8.3`). |
| **D-21** | **Dice are textbook: attacker ≤3, defender ≤2, highest-vs-highest, ties to the defender, attacker loses at most 2 per roll, attack only from ≥2 armies.** The six single-roll distributions are the exact fractions in §2.4. | SMG's own published `0.292566872427984` for 3v2 matches `2275/7776` exactly — first-party confirmation (`01 §4.1`, `05 §4.1`). |
| **D-22** | Full-battle odds come from an **O(A·D) DP over `W[A][D]`** with `A` excluding the garrison, precomputed to **A, D ≤ 128** as `Float32Array`, **one table per `(attackDice, defendDice, favourDefenderOnDraw)` triple**, with a **fitted logistic** `σ((A − 0.860·D)/(0.630·√(A+D)))` beyond the table. | Exact, 2 ms, ~1.15 ns per lookup; independent clamping has 0.8565 max error, and simulation would both be slower and consume PRNG draws (`05 §4.3`, `§4.5`). |
| **D-23** | **Balanced Blitz is implemented as the exact 4-stage reshape with SMG's published constants** (winChanceCutoff 0.05, winChancePower 1.3, outcomeCutoff 0.10, outcomePower 1.8), **written from the behavioural spec — never copying SMG's source**, which is licensed for internal evaluation only. | Both of SMG's README examples reproduce to all 16 printed digits, so the spec is complete; the C# text is theirs (`05 §5.2`, `§5.3`, `§5.5`). |
| **D-24** | **Balanced Blitz distributions are computed lazily and memoised, not tabulated at init.** | A full 100×100 BB table measures **199.8 ms**, over the init budget; small battles dominate real play (`05 §6`). |
| **D-25** | **Bots are given the odds table matching the active dice mode**, and Expert exploits a `certainWin` predicate. | A TR table in a BB game underestimates the bot's own odds by up to 14 points — a correctness bug, not tuning; and `20 v 15` BB is exactly 100% (`05 §5.4`). |
| **D-26** | We use the **exact DP at all battle sizes**, diverging from SMG's polynomial-regression fallback for large stacks. | Our DP is cheap, and SMG themselves warn their estimator *"can result in discrepancies"* — we are deliberately more accurate (`05 §5.5`). |
| **D-27** | Dice augments are modelled as **integer `defendDiceBonus` / `attackDicePenalty` summed from all active modifiers**, never as named modes; capitals and walls share one code path. | SMG state augments **stack**, so enumerating named modes is how you miss `capital + wall` = 4 defender dice (`05 §4.6`). |
| **D-28** | **Five bot tiers labelled exactly as RGD's `AI Difficulty`: Beginner, Easy, Medium, Hard, Expert**, implemented per the `05 §3.5` tier table, with **personas drawn once at match start and stored in match state**. | Difficulty in RGD is a persona pool, not a smartness slider, and that is why its bots read as characters (`05 §1.1`, `§1.2`, `§7.2`). |
| **D-29** | **Low tiers blunder, they do not miscompute** — one code path, `blunderRate` picks the k-th best move. | Keeps determinism simple and avoids the classic bug where a "dumb" bot is accidentally strong (`05 §3.5`). |
| **D-30** | **Expert's compute goes into the draft (and a ply-1 reply check), not into deeper attack search.** | Three independent published results say the draft decides the game; MCTS is out because per-turn branching is 10³³–10⁸⁵ (`05 §2.15`, `§6`). |
| **D-31** | Bots **see through fog only at Expert**; lower tiers keep an honest belief with a `fogPessimism` inflation. | RGD's AI cheats at every level; giving the edge only to Expert keeps low tiers fair-feeling while matching RGD where it matters (`05 §3.2`). |
| **D-32** | Fortify is **connected-path, one move per turn, ≥1 left behind, optional**; attacking still requires direct adjacency or an explicit sea route. | SMG's own wiki wording plus an independent secondary source, against only the rulebook's stricter default (`01 §5`, `03 §2.5`). |
| **D-33** | **Post-conquest move range is `[dice used in the conquering roll … source − 1]`**, with a `Move All` jump-to-max. | Rulebook-exact; SMG's Blitz form (minimum 3 after attacking with 3+) is the same rule (`01 §4.5`, `03 §3-2`). |
| **D-34** | In-scope modes/modifiers are exactly: World Domination, Percentage Domination (70% default, 50–90% adjustable), Capitals (every-capital win + defender's 3rd die), Fog of War, Fixed/Progressive cards, Balanced Blitz / True Random, Blizzards, Portals, Manual vs Auto placement, Max Rounds (5-Rounds Rumble = 5), Turn Timer (online only), Alliances toggle. | Each is sourced; the rest (Zombies, Secret Missions, Secret Assassin, teams, ranked) is either unverified, unshipped in RGD, or monetisation (`01 §6`, `03 §2`). |
| **D-35** | **Blizzards, Portals and Capitals are global modifier systems with a per-map count, not per-map rules**, and a blizzard tile **still counts toward its region's bonus**. | They are toggles that work on any map in RGD; *"the highest-leverage feature in the whole catalogue — it multiplies every map you have"* (`02 §A.1`). |
| **D-36** | **One JSON map schema with the SVG `d` inline per territory**, plus a build-time validator (symmetry, no dangling refs, geometry present, continent membership complete) run against every shipped map. | One fetch per map and no two-sources-of-truth problem; the validator would have caught the bugs that two of the nine upstream graph sources shipped (`02` Tier 2). |
| **D-37** | Ship **Tier 1** (Classic 42 from `canonical/classic-world.json` + TotalRisk `worldMap.svg`; World Extended 47; Napoleonic Europe 59 — all Unlicense) + **Tier 3** nine generated regional maps from Natural Earth / world-atlas / us-atlas + **Tier 4** a seeded Voronoi generator, for 13 maps. | It is the only route to 12+ maps with defensible provenance — adjacency for 133 of the 134 SMG maps exists nowhere public, and every source that has it is unlicensed or copyleft (`02 §TL;DR`, Recommendation). |
| **D-38** | **Never ship SMG artwork or the Wikimedia Hasbro-derived SVGs**; facts (names, graphs, counts, bonuses) are reused freely, ShareAlike sources are used only as test oracles, GPL/AGPL code is read and never copied. | The CC BY-SA tags on `Risk_board.svg` cannot grant rights the uploader never held, and ShareAlike is viral (`02 §B.5`, `§Legal posture`). |
| **D-39** | **Middle Earth ships only with original names, and only if geometry can be generated**; otherwise it is skipped. Tiny3/Tiny4/Mini ship as engine fixtures and the e2e tiny map. | The graph is MIT but the place-names are Tolkien Estate IP, and it has no geometry at all (`02 §A.3`). |
| **D-40** | **Map data is lazy-loaded per map**; geodata sources stay in `research/map-data/` and the build pipeline, never in the client bundle. | Thirteen boards in the initial bundle would dominate it; simplified per-map JSON stays well under 100 KB (`02 §B.6`). |
| **D-41** | **Preset-only chat** — the 42-line roster grouped by category, five lines kept RGD-verbatim, two ally-only, plus a small code-drawn emoji-reaction set; shown as a speech bubble on the sender's roster capsule for ~4 s and logged. | SMG's family-friendly licensing forbids free text, and we draw our own glyphs rather than reproducing their paid emote art (`03 §5`, `§5.4`, `04 §4.19`). |
| **D-42** | **Bots may fire a few reaction lines on events** (losing a territory, a bad roll, elimination) — explicitly flagged as our addition. | Cheap characterisation; the store art already shows a bot "…" thinking balloon, so the affordance exists (`04 §6` #18). |
| **D-43** | **Land is filled per owner, not per continent**; continent identity appears only in the Continent Overlay and as a perimeter glow on a continent you fully hold. | *"The single most important finding, and it contradicts the classic board game"* (`04 §1.4`). |
| **D-44** | **The player roster is a vertical stack of capsules flush to the right edge, bleeding off-screen** — not a top bar. | *"This is a defining layout choice"* of RGD's HUD (`04 §4.4`). |
| **D-45** | **Every piece of text over the board carries a 3 px dark outline plus a 2 px drop shadow** (`paint-order: stroke fill`). | *"The outline is the font"* — without it the replica will not read as RGD whatever typeface is chosen (`04 §5.5`). |
| **D-46** | **The camera is 2D SVG plus one `transform: perspective(1400px) rotateX(θ)`** — 4° at rest, 18° + 2.2× for the battle close-up. No real 3D. | Reproduces RGD's whole camera language with one property (`04 §1.2`). |
| **D-47** | **The Blitz win chance is constant gold `#F0C40F` at every probability**, with an opt-in colour ramp as a flagged usability deviation. | Sampled at 100/99/91/46/6% and it never changes — only the number does (`04 §2.7`). |
| **D-48** | **Tokens and labels live in an HTML layer above the SVG**, anchored at each territory's pole of inaccessibility, with no collision avoidance. | They must not inherit the `rotateX` skew, and RGD itself lets labels spill onto the ocean (`04 §8.5`, `§8.6`). |
| **D-49** | **Landscape-first with a designed portrait layout** (roster → top strip, modals → full-width sheets, Blitz view stacked), plus a per-player **pattern overlay** toggle for colour-vision deficiency. | All 304 reference files are landscape, but a browser cannot lock orientation; Red/Pink and Green/Yellow are the risky pairs (`04 §7`, `§8.2`). |
| **D-50** | **Pass & Play is hot-seat 2–6 with a full-screen "pass the device to `<name>`" overlay between human turns**, fog respected per seat, copied from island-empire's `HandOffOverlay` pattern. | RGD's own interstitial could not be confirmed; the overlay is the honest way to keep hot-seat players from seeing each other's fog (`03 §4.2`, `00 §2`). |
| **D-51** | **The stack is exactly island-empire's pin set**, port **3300**, pnpm, a `verify` script, `CAPTURE=1` screenshots, `.vercel` project `risk-david`, `vercel.json` `"pnpm run db:push && pnpm run build"`, the production PGlite guard, the Turbopack root pin, and `agentRules: false`. | Every one of those was read off a sibling file today, and every port below 3300 is already claimed (`00 §1`, `§6`). |
| **D-52** | **`getDb()` is memoised on `globalThis` via `Symbol.for("risk.db")`**, and PGlite is refused under `NODE_ENV=production` unless an e2e flag is set *and* no serverless marker is present. | Next builds several module graphs per app, and two PGlite instances against one data directory corrupt its WAL (`00 §3`, `06 §6.1`). |
| **D-53** | **`workers: 1` and `fullyParallel: false` in Playwright are load-bearing**, and the e2e suite drives the poll through `window.__riskDebug.pollNow()` rather than sleeping. | Two workers means two servers means two PGlite instances means the two "players" are in different universes; sleeping 2.5 s per move makes the suite take ten minutes (`06 §6.2`, `§6.3`). |
| **D-54** | **The first test written is the replay determinism proof** — fold the log from `seq = 0` and assert `hashState` matches every `state_hash`. | It needs no second context and every other guarantee in the design depends on it (`06 §6.4`). |
| **D-55** | **Golden replay hashes for bot-vs-bot games are versioned artefacts**; any heuristic change that moves a hash is an explicit, recorded change, and the ruleset is versioned so old replays keep playing back. | Otherwise every bot tweak silently invalidates the regression suite (`05 §7.2`). |
