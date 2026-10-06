# Risk — Specification

A browser rebuild of **RISK: Global Domination** (SMG Studio / Hasbro): the three-phase
**Draft → Attack → Fortify** world-conquest game, with solo play against persona-driven bots,
pass-and-play hot-seat, and casual online games joined by a 4-letter code. One self-contained
Next.js 16 app; PGlite locally, Neon in production; no passwords and no accounts beyond a
display name held while you are online.

RISK is a trademark of Hasbro. This is a non-commercial portfolio replica. It contains no SMG
or Hasbro artwork, no board SVGs traced from a retail board, and no licensed code — every pixel
is geometry, colour, type and motion generated here (`DECISIONS.md` D1, D38).

This document is the contract every build slice works against. Every number is carried from
[`research/07-research-brief.md`](research/07-research-brief.md) — itself consolidated from
research lanes `00`–`06` — unless marked **[SPEC]**, meaning this document resolves an ambiguity
the brief left open. Reasoning and evidence for every non-obvious choice live in
[`DECISIONS.md`](DECISIONS.md), which already holds D1–D76.

**The TypeScript blocks in §4 are the real contract.** Slices S1, S2 and S3 run in parallel, so
S2 and S3 code against the shapes written here rather than waiting for S1's files — copy them
exactly (§12).

---

## 1. Vocabulary

| Term | Meaning |
|---|---|
| **Territory** | One claimable region of a map. The atom of ownership. Identified in map JSON by a string slug (`"afghanistan"`) and in `GameState` by its **numeric index** into `MapDef.territories`. |
| **Adjacency** | The undirected edge set. Attacks require **direct** adjacency (a land border or an explicit sea link); fortify requires only a connected path. An active portal adds two directed-both-ways edges for both purposes. |
| **Sea link** | An adjacency with no shared border, drawn as a dashed white route with round nodes. Classic has 9. Geometry cannot derive them; they are hand-authored per map. |
| **Continent / region** | A named group of territories carrying a **bonus** paid at the start of the owner's Draft if that seat owns every territory in it. "Continent" is RGD's word on Classic; "region" is the generic one the catalogue uses. |
| **Seat** | A player slot, `0 … seats.length − 1`. Fixed for the match: colour, kind, standing and (for bots) persona all hang off the seat, not off a person. |
| **Player** | A human occupying a seat. Online, a `players` row; offline, just the device. |
| **Neutral** | The 2-player variant's third, non-playing holding (`SEAT_NEUTRAL = -2`). It never takes a turn, never attacks and never receives reinforcements; it defends normally. |
| **Bot** | A seat played by `decideTurn`. One implementation runs bots offline in the session runner and online inside the lazy tick. |
| **Persona** | The ~20-attribute plain-data character of one bot (Rusher, Turtle, Assassin, …), **drawn once at match start and stored in `GameState`** so a replay reconstructs identical opponents. |
| **Tier** | The `AI Difficulty` setting: `beginner · easy · medium · hard · expert`. A tier is a **persona pool plus a capability row**, not a smartness slider. |
| **Draft** | Phase 1. Place `reinforcements` troops on owned territories; optionally trade cards first. |
| **Attack** | Phase 2. Any number of battles from owned territories holding ≥2 troops into directly adjacent enemy territories. |
| **Fortify** | Phase 3. **One** move of troops along a connected path of own territories, then the turn ends. |
| **Claim phase** | The Manual Placement opening: seats alternate placing one army until every territory is claimed, then alternate placing the remainder. |
| **Round** | One full pass through `turnOrder`, from the first live seat back to it. `round` increments on wrap. |
| **Turn** | One seat's Draft→Attack→Fortify between two `END_TURN`s. `turn` is a monotonic counter used as the RNG sub-stream index. |
| **Blitz** | The default attack mode: the whole battle resolves in one action, from one PRNG draw, fighting to the death unless the Attack Limiter stops it. |
| **Manual roll** | The opt-in alternative: one roll of 1–3 attacker dice vs 1–2 defender dice, shown as dice on the board. **Always True Random, by design.** |
| **Attack Limiter** | A slider capping how many of the source territory's troops are committed to a Blitz. Modelled as `stopUntil`: the battle stops when the attacker is reduced to that many troops, producing an *unresolved* outcome. |
| **Dice mode** | `balancedBlitz` or `trueRandom`, chosen at creation and fixed for the match. |
| **True Random** | Textbook dice: the exact single-roll distributions of R24, composed by the battle DP. |
| **Balanced Blitz** | A four-stage reshape of the exact whole-battle outcome distribution (cutoff → power → tail shave → sharpen) from which **one** sample is drawn. Not a dice filter and not a streak-breaker. |
| **Battle DP** | `W[A][D]`, the exact probability the attacker takes the territory fighting to the death, where **`A` excludes the one army that must stay behind**. |
| **Dice augment** | The integer pair `{ defendDiceBonus, attackDicePenalty }` plus `favourDefenderOnDraw`, summed from every active modifier. Capitals contribute `defendDiceBonus: +1`. Augments **stack**. |
| **Card suit** | `infantry · cavalry · artillery`, or `wild`. |
| **Set** | Three cards: three of a kind, one of each, or any two plus a Wild. |
| **Fixed / Progressive** | The two card-bonus schemes: fixed 4/6/8/10 by suit, or a global escalating ladder 4, 6, 8, 10, 12, 15, +5 forever. |
| **Territory bonus** | +2 troops placed directly on a territory you occupy whose card you traded, capped at +2 per turn however many match. |
| **Capital** | One territory per seat, assigned at setup. Its defender rolls one extra die. In Capitals mode you win by holding **every** capital. |
| **Blizzard** | A territory frozen for the whole game: impassable, unconquerable, ownerless — but it **still counts toward its region's bonus**. |
| **Portal** | A pair of non-adjacent territories linked as an extra edge. **Stable** portals never move and are always active. **Unstable** portals relocate at the start of every round where `round % 3 === 0` and are inactive for the whole of that round. |
| **Fog** | Fog of War: a territory not adjacent to one you occupy hides **both** its owner and its troop count. Reveals update live. |
| **Percentage domination** | A win at a share of the current map's territories — default **70%**, adjustable 50–90% — not a fixed count. |
| **Max Rounds** | A modifier ending the game after N rounds; the preset 5 is labelled `5-Rounds Rumble`. Ties break on territories, then troops, then lowest seat. |
| **Alliance** | A non-binding pact between two seats. Nothing is locked: attacking an ally is legal and breaks nothing automatically. Unlocks two ally-only chat lines. |
| **Lobby** | The pre-game room for an online match: seats, host controls, chat, ready flags. |
| **Lobby code** | Four uppercase letters from the 24-letter alphabet minus `I` and `O` — 24⁴ = 331,776 codes — used to join. |
| **Action** | One entry in the append-only log; the only thing that changes `GameState`. A discriminated union (§4). Chat is **not** an action. |
| **`seq`** | The contiguous 1-based ordinal of an action within one game. The only thing that orders anything. |
| **Snapshot** | A serialised `GameState` at a known `seq`, so a cold client need not replay from 1. |
| **State hash** | `hashState(state)`: a 64-bit hex digest over a canonical serialisation, stored on every action row and asserted by every client. |
| **Resolver** | The pure-but-RNG-taking layer (`rollAttack`, `drawCard`, `dealTerritories`, `placeModifiers`, `movePortals`) that turns an *intent* into the **action whose payload carries the outcome**. The only place randomness enters. |
| **RNG sub-stream** | `rngFor(seed, purpose, turn)` — a PCG32 seeded by `hash(seed, purpose, turn)`, so adding or removing a draw in one purpose never shifts another. |
| **Intent** | What the player asked for, before dice: `{ from, to, mode, attackerDice?, stopUntil? }`. Clients submit intents; the authority returns actions. |
| **Hand-off** | The full-screen "pass the device to `<name>`" overlay between two human turns in Pass & Play. Presentational; it never dismisses itself. |
| **View** | `viewFor(state, seat)`: a `GameState` with every fogged territory's owner and troops replaced by sentinels. What a client is allowed to see, and what a non-cheating bot reasons over. |
| **`GameView`** | A bot-facing flat read-model (typed arrays) projected from a `GameState` or a view by S2. Distinct from `viewFor`'s output. |
| **`TurnPlan`** | A bot's whole-turn decision as **data** — trade, placements, attacks, fortify — never side effects. |
| **Session** | One client-side run of a game: a `GameState` plus UI-only concerns (selection, camera, animation) that never enter `GameState`. |
| **Standing** | A seat's lifecycle: `active · eliminated · resigned · away`. |

---

## 2. Scope

### In

- **Solo** vs 1–5 bots (2–6 seats total), five `AI Difficulty` tiers, persona-driven.
- **Pass & Play** hot-seat 2–6 on one device, with a hand-off overlay and per-seat fog.
- **Online (Casual)**: create a lobby, share a 4-letter code, 2–6 seats mixing humans and bots, preset chat, a turn timer, bot takeover on timeout, reconnect.
- The full three-phase turn, **Blitz** and **Manual Roll**, the **Blitz Win Chance** readout and the **Attack Limiter**.
- **Cards**: Fixed and Progressive, the three timing branches, the +2 territory bonus, seizure on elimination.
- **Modes and modifiers**: World Domination, Percentage Domination (70% default, 50–90%), Capitals, Fog of War, Blizzards, Portals (stable and unstable), Manual Placement, Max Rounds (`5-Rounds Rumble`), Round Delay, Turn Timer (online only), Alliances toggle, Card Bonus, Dice Rolls, AI Difficulty.
- **Continent bonuses** and the **Continent Overlay**.
- **13 maps**: Classic World (42/6/83), World Extended (47/6/94), Napoleonic Europe (59/11/127), nine generated regional maps, plus a seeded Voronoi **random map** generator. Engine fixtures `tiny3`, `tiny4`, `mini`, `quad`.
- **Preset-only communication**: a 42-line dialog roster grouped by category, two ally-only lines, an 8-glyph code-drawn emoji set, speech balloons plus a scrollable log.
- **Identity**: a display name chosen on arrival, a server-minted httpOnly cookie, an online-players list.
- Settings (camera animations, phase animations, end-phase confirmation, sound, music, colour-vision patterns, win-chance ramp), autosave and resume of the offline session.

### Out (deliberately)

Zombies / Zombie Apocalypse, Secret Missions, Secret Assassin, teams (2v2/3v3), ranked / leagues / seasons, the gem-token-shop economy and every cosmetic DLC, DLC map packs, friends list and Friend ID, replay viewer, spectator mode, Basic Training's guided tutorial, free-text chat of any kind, the weekly community expression line, and the Exponential / Per-Player card modes. Full list with reasons in §13.

---

## 3. Rules

Every rule is numbered `Rn` and is the normative statement of its number. Rules marked **[SPEC]**
resolve an open item from the brief's §11 table; rules marked **[ours]** have no RGD equivalent.

### 3.1 Setup

- **R1 — Seat count.** 2–6 seats, humans and bots combined.
- **R2 — Starting armies.** 3 seats → **35** each · 4 → **30** · 5 → **25** · 6 → **20**. Two seats use the dedicated variant: **40 each, plus a 40-army neutral holding**.
- **R3 — Territory deal (Auto Placement, the default).** `dealTerritories` assigns every non-blizzard territory to a seat, dealing round-robin from a shuffled territory order so counts differ by at most 1, then places one army on each owned territory and distributes the remainder evenly across that seat's territories (remainder-by-largest-share, leftovers to the lowest-index territory). Seeded, so a `(mapSlug, seed)` pair reproduces the board exactly. **[SPEC]** — no RGD formula was found (brief §11-14).
- **R4 — Seat order.** Drawn by the resolver in the same call as R3 and carried in `GAME_STARTED` at `seq = 1`. Highest single die first, ties rerolled; equivalently, a seeded shuffle of the seat list.
- **R5 — 2-player deal.** On a 42-territory map: deal the 42 territory cards into three 14-card piles — yours, your opponent's, the neutral's — and place one army on each of those 42 territories. On any other map, deal the `T` non-blizzard territories into **three piles whose sizes differ by at most 1**, assigning the larger piles to **seat 0, then seat 1, then neutral**. **[SPEC]**
- **R6 — 2-player remainder.** Remaining armies alternate: the acting seat places **2 on any one or two of its own territories**, then **1 neutral army on any neutral territory**, until both seats are exhausted. Under Auto Placement this is performed by the resolver inside R3; under Manual Placement it is the claim-phase loop (R9).
- **R7 — Neutral behaviour.** The neutral holding never takes a turn, never attacks, never receives reinforcements and holds no cards. It defends exactly like a seat (R24–R27). It is excluded from elimination, win and tiebreak checks: you win a 2-player game by eliminating your **opponent**, not the neutrals.
- **R8 — Capitals assignment [SPEC].** With Capitals on, each seat's capital is one of its own dealt territories, chosen by the resolver and carried in `GAME_STARTED`. Capitals are never placed on a blizzard.
- **R9 — Manual Placement (claim phase).** With Manual Placement on, R3 assigns no owners. The game opens in `phase: "claim"`: seats alternate in `turnOrder`, each `CLAIM` placing exactly one army — onto an unowned non-blizzard territory while any remain, thereafter onto one of their own. The phase ends when every seat's starting armies are placed; play then begins at `turnOrder[0]`'s Draft.
- **R10 — Blizzards.** `placeModifiers` freezes `map.modifierSlots.blizzards` territories (per-map count **2–11**), chosen seeded and uniformly at random from territories with no capital, never more than one per continent while alternatives remain. A blizzard territory has no owner and no troops for the whole game.
- **R11 — Portals.** `placeModifiers` creates `map.modifierSlots.portals` portals (per-map count **3–7**), each a pair of **non-adjacent, non-blizzard** territories, no territory in two portals. The modifier setting fixes whether they are `stable` or `unstable`.

### 3.2 Draft

- **R12 — Reinforcements.** `reinforcements = max(3, floor(territoriesOwned / 3))`. Examples that must hold: 11 → 3, 14 → 4, 16 → 5, 17 → 5.
- **R13 — Continent bonuses.** Add `bonus` for every continent the seat owns entirely. Classic: Africa **3**, Asia **7**, Australia **2**, Europe **5**, North America **5**, South America **2** (total 24). Ownership is evaluated **at the start of the owner's turn**, once, and the result is what pays.
- **R14 — Blizzards do not break a bonus.** A continent counts as fully owned when the seat owns every **non-blizzard** territory in it.
- **R15 — Capital draft bonus.** `rules.capitalDraftBonus` adds +2 troops per held capital at Draft. **Default `false`** — only the win condition and the defender's extra die are sourced (brief §11-3).
- **R16 — Placing.** `DRAFT { territory, count }` places `count` troops on an owned territory; `count ≥ 1` and `count ≤ troopsToPlace`. Troops may go on any owned territory, in any number of actions.
- **R17 — Draft is exhaustive.** `END_PHASE` out of `draft` is illegal while `troopsToPlace > 0`. The UI copy is *"You must draft all of your available troops during your draft phase"*.
- **R18 — The trade bonus lands in the same counter.** A card trade's armies are added to `troopsToPlace`; the +2 territory bonus (R23) is placed immediately on the named territory and is **not** added to the counter.

### 3.3 Cards

- **R19 — Deck.** 42 territory cards (one per Classic territory; one per territory on any other map), each `infantry`, `cavalry` or `artillery`, plus **2 Wild**. Mission cards are out of scope. Deck **order is never stored in state**: `drawCard` computes the remaining pool as `allCards − everyHand − discard`, and when that pool is empty it reshuffles the discard and clears it.
- **R20 — Earning.** Exactly **one** card at the end of any turn in which the seat captured at least one territory, however many it captured. Emitted as a server/runner-resolved `CARD_DRAWN`.
- **R21 — Valid sets.** Three of a kind · one of each · any two plus a Wild.
- **R22 — Values.** **Fixed:** Infantry×3 = **4**, Cavalry×3 = **6**, Artillery×3 = **8**, one-of-each **or any set containing a Wild** = **10**. **Progressive:** the *n*-th set traded in the whole game is worth **4, 6, 8, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, …** — `n ≤ 6` from the literal list, then `15 + 5·(n − 6)`.
- **R23 — Territory bonus.** If a traded card names a territory the trader occupies, **+2 armies placed directly on that territory**, capped at **+2 per turn** however many traded cards match. So a Fixed trade is worth at most **12** in one turn.
- **R24 — Timing branch 1: forced at turn start.** Holding **≥5** cards at the start of your turn, you **must** trade at least one set before `DRAFT`, and **may** trade a second if you still hold one. `legalActions` in `draft` with `hand.length ≥ 5` and `setsTradedThisTurn === 0` returns only `TRADE_CARDS`.
- **R25 — Timing branch 2: your own reward draw forces nothing.** Drawing your end-of-turn card to 5 or 6 forces nothing now; the R24 check happens at the start of your **next** turn.
- **R26 — Timing branch 3: inheritance forces an immediate trade-down.** Inheriting an eliminated seat's hand mid-turn to **≥6** forces an **immediate, same-turn** trade-down to **≤4**, one set at a time, stopping as soon as the hand reaches 4, 3 or 2. If the inheritance leaves you under 6, you wait until your next turn. These three branches are three separate rules and three separate tests.
- **R27 — Forced trade-down during Attack.** When R26 fires in `attack`, the bonus troops go into `troopsToPlace` and the phase **reverts to `draft`** until they are placed; `END_PHASE` then returns play to `attack` with `conqueredThisTurn` and every other turn flag intact. **[SPEC]**
- **R28 — Seizure.** Eliminating a seat transfers its **whole hand**. A hand never exceeds 6 under R24–R26; 7+ is an invalid state and is asserted, not handled.

### 3.4 Attack — dice

- **R29 — Who may attack.** From an owned territory holding **≥2** troops, into a **directly adjacent** (or sea-linked, or active-portal-linked) territory owned by another seat or the neutral. Never into a blizzard.
- **R30 — Dice counts.** The attacker rolls 1, 2 or 3 dice and must hold **at least one more army than dice rolled**: `attackDice ≤ min(3, sourceTroops − 1)`. The defender rolls `defendDice = min(defenderTroops, 2 + defendDiceBonus)`.
- **R31 — Comparison.** Sort both sets descending; compare highest vs highest, then second vs second (and third vs third when both have three). **Ties go to the defender.** Each comparison the attacker loses costs the attacker one army; each it wins costs the defender one.
- **R32 — Loss cap.** The attacker can never lose more than 2 armies in a single roll — a consequence of comparing at most `min(attackDice, defendDice) ≤ 2` pairs in standard play, and the reason `defendDiceBonus` changes the shape of the game.
- **R33 — Edge cases.** 2 troops → at most 1 attacking die. 1 troop → cannot attack. A defender with 1 troop rolls 1 die. The capital augment is `min(D, 3)`, so it is **identical to standard play at `D ≤ 2`** and only bites at `D ≥ 3`.
- **R34 — The six single-roll distributions.** Exact, as fractions, and these are the numeric oracle:

| Roll | Outcomes | Att loses 0 | Att loses 1 | Att loses 2 | Exact fractions |
|---|---|---|---|---|---|
| 3 v 2 | 7,776 | 37.1656% | 33.5777% | 29.2567% | 2890 / 2611 / 2275 over 7776 |
| 3 v 1 | 1,296 | 65.9722% | 34.0278% | — | 855 / 441 over 1296 |
| 2 v 2 | 1,296 | 22.7623% | 32.4074% | 44.8302% | 295 / 420 / 581 over 1296 |
| 2 v 1 | 216 | 57.8704% | 42.1296% | — | 125 / 91 over 216 |
| 1 v 2 | 216 | 25.4630% | 74.5370% | — | 55 / 161 over 216 |
| 1 v 1 | 36 | 41.6667% | 58.3333% | — | 15 / 21 over 36 |

  SMG's own `risk-dice` prints `AttackLossChances[2] = 0.292566872427984` for 3v2; `2275/7776 = 0.2925668724279835`. That exact match is first-party confirmation of ties-to-defender.

- **R35 — Expected casualties per roll.** 3v2 → 0.9209 attacker / 1.0791 defender (1.172 : 1) · 3v1 → 0.3403 / 0.6597 (1.939) · 2v2 → 1.2207 / 0.7793 (0.638) · 2v1 → 0.4213 / 0.5787 (1.374) · 1v2 → 0.7454 / 0.2546 (0.342) · 1v1 → 0.5833 / 0.4167 (0.714). 2v2 and 1v2 are **losing trades**.
- **R36 — Dice augments are integers, never named modes.** Every active modifier contributes to `{ defendDiceBonus, attackDicePenalty, favourDefenderOnDraw }`, and the sums select the round distribution. Capitals contribute `defendDiceBonus: +1`. With `attackDice ∈ {1,2,3}`, `defendDice ∈ {1,2,3,4}` and two tie rules the complete set is **24 round distributions**, all precomputable. Enumerating named modes is how you miss `capital + wall` = 4 defender dice; augments **stack**.
- **R37 — Never the "twice as many armies" rule.** It descends from a 1997 independence error. The real break-even is `A ≥ D + 1`.

### 3.5 Attack — the battle DP

- **R38 — Definition.** `A` **excludes** the army that must stay behind, matching SMG's convention: a 20-army territory attacking 10 is `(A, D) = (19, 10)`.

  ```
  a = min(A, 3 − attackDicePenalty); d = min(D, 2 + defendDiceBonus); c = min(a, d)
  r[a][d][k] = P(attacker loses k of the c compared pairs)        // R34, augmented
  W[A][0] = 1                        for all A ≥ 0
  W[0][D] = 0                        for all D ≥ 1
  W[A][D] = Σ(k = 0..c)  r[a][d][k] · W[A−k][D−(c−k)]
  ```

- **R39 — Solution order and cost.** Reverse lexicographic order of `A+D`; every transition decreases `A+D` by exactly `c ≥ 1`. **O(A·D)**, exact to floating point, no matrix inversion. Oracle: 300 attackers vs 800 defenders returns **0.8897332621740284** against SMG's published `0.8897331`.
- **R40 — Full outcome distribution.** The same recursion run forward gives `attackLoss[i < A]` = P(win having lost `i`), `attackLoss[A]` = P(lose the battle), `defendLoss[j < D]` = P(defender wins having lost `j`), `defendLoss[D]` = P(attacker wins). Needed for Balanced Blitz and for the bots' `sunkCost`.
- **R41 — Reference conquer odds (True Random, standard 3v2, %, rows = `A` excluding the garrison).** Spot cells are tests:

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

- **R42 — Break-evens.** Minimum `A` to be a favourite: `D=1 → 2`, `2 → 3`, `3 → 4`, `5 → 5`, `10 → 10`, `20 → 18`, `30 → 27`, `50 → 44`. For ≥80%: `1 → 3`, `2 → 5`, `3 → 6`, `5 → 8`, `10 → 14`, `20 → 24`, `30 → 34`, `50 → 53`. Every `A = D+1` cell sits just above 50% (0.754, 0.656, 0.642, 0.638, 0.640, 0.643, 0.646, 0.650); `A = D ≥ 5` is already favourable.
- **R43 — Table size and the tail.** Precompute `W[A][D]` for `A, D ≤ 128` per augment as a `Float32Array`. Beyond the table use the fitted logistic `p ≈ σ((A − 0.860·D) / (0.630·√(A+D)))` (max abs error 0.0318, RMS 0.0088). **Never clamp indices independently** — `W[min(A,128)][min(D,128)]` reads 129 v 381 (≈0%) as 85.65%.
- **R44 — Never simulate.** A Monte-Carlo battle is orders of magnitude slower than a lookup *and* consumes PRNG draws, breaking determinism.
- **R45 — The exact DP at every size.** SMG fall back to polynomial regression over same-ratio battles for large stacks and warn it *"can result in discrepancies"*. We use the exact DP at all sizes and are deliberately more accurate than RGD. Recorded as intentional.

### 3.6 Attack — Blitz, the limiter, and Balanced Blitz

- **R46 — Blitz.** The default each turn: consecutive rolls at the best available option (3 v 2 where possible), finishing when all committed troops are lost or the territory is conquered. The per-attack ◀ ▶ steppers toggle Blitz ↔ a manual dice count and **reset to Blitz at the start of every turn**.
- **R47 — Blitz Win Chance.** The percentage shown at the top of the attack view is `odds.winChance(sourceTroops − 1, targetTroops, augment)` for the **active dice mode**, rendered in constant gold.
- **R48 — Attack Limiter (`stopUntil`).** The limiter caps committed troops: the battle stops when the source would be reduced to `stopUntil` troops. It truncates the outcome distribution and introduces a third, **unresolved** outcome — neither side eliminated. Published odds tables assume fight-to-the-death, so with a stop rule they are **lower bounds**. Optimal withdrawal is unsolved: the stop rule is not claimed to be optimal.
- **R49 — Balanced Blitz is one sample of a reshaped whole-battle distribution.** Constants, from `BalanceConfig`: `winChanceCutoff = 0.05`, `winChancePower = 1.3`, `outcomeCutoff = 0.10`, `outcomePower = 1.8`.
- **R50 — Stage 1, `ApplyWinChanceCutoff` (0.05).** If either side's overall win chance is ≤ 0.05 it snaps to **0%** and the other to **100%**; the losing side collapses onto its "lost everything" entry and the winner renormalises. A 97% win chance becomes 100%. This is the source of the "5 vs 1 wins 100%" complaint, and it is intended.
- **R51 — Stage 2, `ApplyWinChancePower` (1.3).** `w' = w^p / (w^p + (1−w)^p)`; fixed point at `w = 0.5`, monotone. Each side's array is renormalised to its new total. Oracle at `p = 1.4`: 56.8 → 59.46%, 43.2 → 40.54%, 86.1 → 92.78%.
- **R52 — Stage 3, `ApplyOutcomeCutoff` (0.10).** Concatenate the attacker-side and defender-side arrays into one distribution ordered most-favourable-to-attacker → most-favourable-to-defender, then **shave 0.10 of probability mass off each tail** — walk in from each end zeroing entries until the cut reaches 0.10, partially trimming the straddling entry — then renormalise. This is the real no-extreme-streaks mechanism: crushing wins and catastrophic losses become *impossible*, not merely rare.
- **R53 — Stage 4, `ApplyOutcomePower` (1.8).** Raise every individual outcome probability to the power 1.8 and renormalise **each side separately, preserving the win chance set by stages 1–3**. It must not change the overall win chance, nor make an existing outcome impossible or certain.
- **R54 — Stage order is load-bearing.** 1 → 2 → 3 → 4. A power-only implementation is visibly wrong: at A=49 vs D=50, stage 2 alone gives 75.7% where the full pipeline gives 82.15%.
- **R55 — Bit-exact oracles.** 30 attackers vs a capital held by 15 (defender rolls 3), probability of losing exactly 12: True Random **`0.0222128001707278`**, Balanced Blitz **`0.0100282888709122`** — both to all 16 printed digits. Fewest attackers for ≥80% BB win chance against 50 defenders: **49** (47 → 72.03%, 48 → 77.10%, 49 → 82.15%, 50 → 86.35%). `20 v 15` BB is **exactly 100%**.
- **R56 — How BB changes the game.** 3v3 47.03 → 45.17 · 4v4 47.65 → 46.19 · 5v5 50.62 → 51.01 · 10v10 56.76 → 60.94 · 20v20 63.34 → 71.33 · 2v1 75.42 → 88.90 · 3v2 65.60 → 74.78 · 5v3 76.94 → 90.91 · 10v8 72.40 → 84.74 · 20v15 86.04 → 100.00. The **break-even does not move**, so `A ≥ D+1` is one rule for both modes; favourable attacks gain +8 to +14 points while marginal underdogs lose ~1.5; past ~95% a win becomes certain.
- **R57 — One table per dice mode, handed to the bot.** A bot using the True Random table in a Balanced Blitz game underestimates its own odds by up to 14 points. That is a correctness bug, not tuning. Expose `certainWin(a, d, aug) = winChance ≥ 1 − 1e−9`.
- **R58 — One PRNG draw per battle.** Inverse-CDF sampling of the (reshaped or raw) outcome distribution — never one draw per roll. A battle costs one draw however long it "lasts".
- **R59 — Quantise before comparing.** `Math.pow` is not bit-identical across JS engines and appears in R51 and R53, so each cumulative value is rounded to a fixed grid (`Math.round(x * 2**32)`) before comparison against the quantised `u`. The walk direction and the tie comparison (`u < cum`) are pinned and tested at `u ∈ {0, ε, 0.5, 1−ε}`.
- **R60 — Never copy SMG's code.** `risk-dice` is licensed for internal evaluation only. The four constants and the staged algorithm are facts about the game's behaviour; the C# text is theirs. This implementation is written from R49–R55 and nothing else.
- **R61 — Manual Roll is always True Random.** Per roll, by design, whatever `rules.diceMode` says — *"functions identically to the original board game"*.

### 3.7 Post-conquest move

- **R62 — Conquest.** The defender losing its last army transfers the territory to the attacker, who **must occupy immediately**.
- **R63 — Move range.** `[dice used in the conquering roll … sourceTroops − 1]`. So 1, 2 or 3 minimum (Blitz at 3+ troops means a minimum of 3), and at least one army must stay behind. The engine blocks `END_PHASE`, `END_TURN` and further `ATTACK`s while `pendingMoveIn` is set.
- **R64 — `Move All`.** A jump-to-max affordance labelled `Move All` **[ours]**; no SMG label was found.
- **R65 — Continent and win checks run on the capture, not on the move.** `MOVE_IN` only redistributes troops.

### 3.8 Fortify

- **R66 — One move per turn.** One source, one destination, any count from 1 to `sourceTroops − 1`, with a **graph-reachability check through the seat's own territories only** (the connected-path variant). Multi-hop is legal; the intermediate territories must all be owned by the mover.
- **R67 — Fortify is optional and ends the turn.** `END_PHASE` is **not legal out of `fortify`**; the phase exits only via `END_TURN`, which also performs the end-of-turn card award (R20). **[SPEC]**
- **R68 — Active portals count as edges for fortify reachability** exactly as they do for attack adjacency.
- **R69 — Attacking is stricter than fortifying.** Attack needs direct adjacency or an explicit sea route; fortify needs only a path.

### 3.9 Modifiers

- **R70 — World Domination.** Own every non-blizzard territory. The default mode.
- **R71 — Percentage Domination.** Own `≥ ceil(threshold · nonBlizzardTerritoryCount)` territories. `rules.dominationThreshold` default **0.70**, adjustable **0.50–0.90**.
- **R72 — Capitals.** Every seat gets one capital at setup (R8). Win by holding **every** capital. The defender at a capital contributes `defendDiceBonus: +1`, i.e. rolls up to 3 dice. Losing your own capital does **not** by itself eliminate you — elimination is still R81. RGD's implementation, not the rulebook's "Capital RISK".
- **R73 — Fog of War.** A territory not adjacent to any territory the viewer occupies hides **both** owner and troop count; the roster shows `???` for every other seat's totals. Reveals update live as holdings change. The engine applies fog in `viewFor`, never in `apply`.
- **R74 — Blizzards.** Impassable and unconquerable: not a legal attack target, not a legal draft/fortify endpoint, not a path node for fortify reachability, never owned, never counted in territory totals — but still counted toward its region's bonus (R14).
- **R75 — Stable portals.** Fixed for the whole game, always active, adding one undirected edge each.
- **R76 — Unstable portals.** At the start of every round where `round % 3 === 0`, every unstable portal relocates to a fresh non-adjacent pair and is **inactive for the whole of that round** (`activeFrom = round + 1`). The relocation is emitted as a server/runner-resolved **`PORTALS_MOVED`** action in the log, so every client learns about it the way it learns about a dice roll.
- **R77 — Max Rounds.** With `rules.maxRounds = N`, the game ends the instant `END_TURN` completes round `N`. The preset `N = 5` is labelled `5-Rounds Rumble`.
- **R78 — Max Rounds tiebreak.** Most **territories**, then most **troops**, then **lowest seat index**. An outcome decided this way carries `tiebreak: true`. **[SPEC]**
- **R79 — Turn Timer.** `60 / 90 / 120 / 180 / 300` seconds, covering the **whole** turn (all three phases). Online only; default **90**. Offline sessions ignore it.
- **R80 — Alliances.** `rules.alliances` on/off per game. Alliances are **non-binding**: there is no "cannot attack ally" lock and attacking an ally breaks nothing automatically. `ALLIANCE_PROPOSE` / `ALLIANCE_ACCEPT` / `ALLIANCE_BREAK` between two seats; an active alliance unlocks dialog lines 28 and 29.

### 3.10 Elimination and winning

- **R81 — Elimination.** A seat owning **0 territories** is eliminated (`standing: "eliminated"`), checked after every capture and again at `END_TURN`. Its hand transfers under R26/R28; its capital stays on the board and still counts for R72.
- **R82 — Resign.** A resigning seat **becomes a bot** — the same transition as the away takeover, a `SEAT_TO_BOT` with `reason: "resigned"` — and **cannot be reclaimed**. In an offline solo game, resigning ends the session for the human, who may watch the bots finish or leave. **[SPEC]**
- **R83 — Win evaluation order.** After every action, in order: World/Percentage domination (R70/R71) → Capitals (R72) → last seat standing → Max Rounds expiry (R77/R78). The first that fires sets `outcome` and no further action is accepted.
- **R84 — Last seat standing.** When exactly one non-eliminated, non-resigned playing seat remains, it wins. The neutral is never counted.
- **R85 — Stalls are a designed-for corner case.** A reduced opponent that is never finished off can stall a game; Max Rounds, Percentage Domination and resignation are the three exits, and the UI never pretends the game has ended when it has not.

### 3.11 Reducer invariants

- **R86 — `apply` never throws.** Every branch validates first and returns `{ state: input, events: [], error }` on a rule violation. An illegal action is data, not an exception.
- **R87 — `apply` never mutates.** It returns a fresh `GameState`; the caller owns both.
- **R88 — `apply` contains no randomness, not even a seeded generator**, no clock and no DOM. Every random outcome arrives inside the action payload.
- **R89 — Troop conservation.** Across a battle, `attackerLosses + defenderLosses` equals the total troops removed from the board, and no action creates troops except `DRAFT`, `CLAIM`, `AUTO_DEPLOY` and the trade bonus.
- **R90 — Adjacency symmetry is an invariant, not an assumption.** It is checked by the map validator at build time and by a property test over every modifier combination.
- **R91 — Determinism of iteration.** Nothing in the engine iterates a `Map`, `Set` or object whose insertion order can vary; every ordered pass sorts by a stable id first, and every `sort` uses a total comparator (`(a, b) => (b.score − a.score) || (a.id − b.id)`).
- **R92 — Ruleset version.** `GameState.version` is the ruleset version. A change that alters a golden replay hash bumps it, so stored replays keep playing back.

---

## 4. Architecture

Hexagonal, matching the siblings, with the engine held to `super-smash`'s purity standard. **S0 has
already built everything marked *(scaffold)*** — it is committed and typechecks; no slice recreates it.

```
src/
  engine/                      pure. NO randomness, NO clock, NO DOM, NO React. Four barrels, disjoint owners.
    types.ts                   S1 — GameState, Rules, MapDef, Card, Action, Event, BotPersona, BotTier,
                               Rng, every id type and constant. PUBLISHED FIRST (§12).
    index.ts                   S1 — the `@/engine` public API. PUBLISHED FIRST, stubbed to throw.
    rules.ts                   S1 — reinforcements, continent bonuses, set values, reachability, win checks
    reducer.ts                 S1 — apply(state, action) -> ApplyResult, one branch per Action
    validate.ts                S1 — validate(state, action) -> RuleError | null
    legalActions.ts            S1 — legalActions(state, seat) and the per-phase target selectors
    graph.ts                   S1 — adjacency, active-portal edges, friendly-path reachability
    continents.ts              S1 — ownership, bonus payment, perimeter sets for the overlay
    cards.ts                   S1 — deck composition, set detection, set values, the three timing branches
    modifiers.ts               S1 — blizzard/portal/capital/fog predicates and the DiceAugment sum
    fog.ts                     S1 — viewFor(state, seat)
    hash.ts                    S1 — canonical serialisation + hashState
    serialize.ts               S1 — serializeState / deserializeState
    prng.ts                    S1 — PCG32, rngFor(seed, purpose, turn)
    resolver/
      index.ts                 S1 — the resolver barrel
      rollAttack.ts            S1 — the only caller of odds + rng for a battle
      drawCard.ts              S1
      dealTerritories.ts       S1 — deal + seat order + starting armies
      placeModifiers.ts        S1 — blizzards, portals, capitals at setup
      movePortals.ts           S1 — the round-start unstable relocation
    odds/
      index.ts                 S2 — `@/engine/odds` public API: createOdds, DiceAugment helpers
      types.ts                 S2 — OddsTables, OutcomeDist, DiceAugment
      rounds.ts                S2 — the 24 single-roll distributions, exact rational -> float
      dp.ts                    S2 — W[A][D] and the forward outcome distribution
      logistic.ts              S2 — the beyond-table fit
      balance.ts               S2 — the four Balanced Blitz stages
      sample.ts                S2 — quantised inverse-CDF sampling
    bots/
      index.ts                 S2 — `@/engine/bots` public API: decideTurn, personas, tiers
      types.ts                 S2 — TurnPlan, GameView, BotWeights
      view.ts                  S2 — makeView(state, seat, persona): GameView (flat typed arrays)
      personas.ts              S2 — the eight persona literals and drawPersonas()
      tiers.ts                 S2 — the five tier rows
      score.ts                 S2 — attack scoring, BSR, hostility, continent value
      draft.ts  attack.ts  fortify.ts  cards.ts  lookahead.ts
    map/
      index.ts                 S3 — `@/engine/map` public API
      schema.ts                S3 — MapFile -> MapDef loader + validateMap
      voronoi.ts               S3 — the seeded random-map generator
      anchors.ts               S3 — polylabel token/label anchors
      slots.ts                 S3 — modifier-slot placement helpers used by the resolver
    layering.test.ts           (scaffold) the purity guard; S1 extends ENGINE_ENTRY_POINTS
  render/                      S4 — pure painters: render(svg, state, ui, camera, now). No React.
    board.ts tokens.ts arrows.ts camera.ts palette.ts animations.ts
  game/                        S4 — the session runner
    session.ts                 createSession(options): Session
    sessionConfig.ts           zustand/vanilla store: GameConfig, SeatConfig, MapSource
    engineApi.ts               EngineApi — the narrow interface tests inject a scripted engine through
    botRunner.ts               aiStepMs pacing, TurnPlan -> actions
    autosave.ts                risk:session:v1:<sourceKey>
    input.ts                   pointer -> TerritoryId, drag, pinch
  components/
    game/                      S4 — HUD, roster, action bar, dialogs, overlays
    setup/                     S4 — identity sheet, game-type picker, map picker, Modes and Modifiers,
                               HandOffOverlay.tsx
    ui/                        S4 — Pill, Tray, NotchedRing, SegmentedToggle, CountSlider
    chat/                      S4 — drawer, roster, emoji grid, balloons
    online/                    S5 — lobby list, lobby room, seat rows, online-players list
  app/
    layout.tsx globals.css     (scaffold)
    page.tsx                   S4 — Home
    new/                       S4 — /new (game type), /new/map, /new/rules
    play/solo/ pass-and-play/  S4
    play/online/[gameId]/      S5
    lobby/ lobby/[code]/       S5
    api/                       S5 — the only place the server engine is invoked (§6)
  net/                         S5 — SyncPort + PollingSync (+ room for SseSync, DurableObjectSync)
  ports/                       S4 — SettingsPort, LocalProgressPort, SyncPort, IdentityPort
  adapters/
    db/                        (scaffold) driver.ts index.ts neon.ts pglite.ts schema.sql schema.ts
    db/repositories/           S5 — players.ts lobbies.ts games.ts actions.ts chat.ts
    localStorage/              S4 — settings.ts progress.ts identity.ts session.ts
  content/
    maps/                      S3 — one JSON per map, lazy-loaded; index.ts is a loader map, never a barrel
    dialog.ts                  S4 — the 42-line roster + the 8 emoji
    personaNames.ts            S2 — display names for the eight personas
  config/env.ts                (scaffold)
  test-support/empty-module.ts (scaffold)
scripts/
  build-schema.mjs             (scaffold) schema.sql -> schema.ts
  db-push.ts                   (scaffold) standalone driver selection
  build-maps.ts                S3 — the `build:maps` entry point already wired in package.json
  maps/                        S3 — the Natural Earth / us-atlas pipeline modules
e2e/                           S6 — helpers.ts + the five specs
docs/screenshots/              S6
```

### 4.1 Layering, enforced

`src/engine/layering.test.ts` *(scaffold)* walks `src/engine/**/*.ts(x)` **off disk**, strips comments
and string literals first, and fails the build on: an import of `react · react-dom · next · zustand ·
zod`; an import whose first path segment is `render · game · components · app · net · ports · adapters ·
content · config · lib`; a relative import escaping `src/engine/`; a call to `Math.random · Date.now ·
performance.now · new Date · crypto.`; a reference to `window · document · localStorage · navigator ·
fetch( · requestAnimationFrame · process.env`. It also unit-tests itself. The resolver is **not**
exempt: it takes an `Rng` **parameter** and still may not call `Math.random`.

**S1 extends `ENGINE_ENTRY_POINTS`** (currently `["layering.test.ts"]`) with `types.ts`, `index.ts`,
`reducer.ts`, `hash.ts`, `prng.ts`, `resolver/index.ts`, so a misplaced directory cannot silently
empty the guard. S2 adds `odds/index.ts`, `bots/index.ts`; S3 adds `map/index.ts`.

### 4.2 The four barrels, and why

Slice ownership must be disjoint and the layering must stay pure, so the engine publishes four entry
points rather than one:

| Barrel | Owner | Contents |
|---|---|---|
| `@/engine` | **S1** | types, the rules reducer, `validate`, `legalActions`, `hashState`, `serializeState`, the fog view, cards, continents, graph, modifiers, `prng`, `resolver/**` |
| `@/engine/odds` | **S2** | the 24 round distributions, the DP, the logistic tail, the Balanced Blitz reshaper, quantised sampling |
| `@/engine/bots` | **S2** | personas, tiers, `decideTurn`, scoring, lookahead |
| `@/engine/map` | **S3** | the map schema validator, the loader, the Voronoi generator, modifier-slot placement |

Dependency direction is one-way: `bots → odds → engine`, `map → engine` (types only), and **nothing
in `@/engine` imports `odds`, `bots` or `map`**. The resolver takes an `OddsTables` as a *parameter*,
so `rollAttack` needs no import of S2's barrel.

**Plain-data `BotPersona` and `BotTier` live in S1's `types.ts`** because they are stored inside
`GameState`. `TurnPlan`, `OddsTables`, `OutcomeDist`, `DiceAugment` and `GameView` live in S2's
`odds/types.ts` / `bots/types.ts`.

### 4.3 Stack pins

Exactly island-empire's set, already in `package.json` *(scaffold)*: `next 16.3.0 · react 19.2.8 ·
react-dom 19.2.8 · zustand ^5.0.15 · tailwindcss ^4 · @tailwindcss/postcss ^4 · typescript ^5 ·
eslint ^9 · eslint-config-next 16.3.0 · @playwright/test ^1.62.1 · vitest ^4.1.10 ·
@vitest/coverage-v8 ^4.1.10 · jsdom ^30.0.1 · vite ^8.2.1 · vite-tsconfig-paths ^6.1.1 ·
@vitejs/plugin-react ^6.0.5 · fast-check ^4.3.0 · @testing-library/{jest-dom ^7.0.0, react ^16.3.2,
user-event ^14.6.3} · clsx ^2.1.1 · @types/{node ^20, react ^19, react-dom ^19} ·
@electric-sql/pglite ^0.5.5 · @neondatabase/serverless ^1.1.0 · server-only ^0.0.1 · ws ^8.21.3 +
@types/ws ^8.18.1 · nanoid ^6.0.1 · zod ^4.4.3`. pnpm. **No `trystero`.** Scripts: `dev build start
lint test test:watch test:e2e test:e2e:ui typecheck db:push build:schema prebuild verify
test:e2e:capture build:maps`, where `verify = typecheck && lint && test`.

**The only four additions to the pin list, all owned by S3:**

| Package | Where it may be imported | Why |
|---|---|---|
| **`polylabel`** | **runtime dependency**, imported by `src/engine/map/anchors.ts` | the Voronoi generator computes token/label anchors in the browser, so the pole-of-inaccessibility solver must ship |
| `topojson-client` | **build-time only**, `scripts/maps/**` | `merge` for dissolving admin polygons into territories |
| `mapshaper` | **build-time only**, `scripts/maps/**` | dissolve + Douglas–Peucker simplify to 12–30 vertices |
| `d3-geo` | **build-time only**, `scripts/maps/**` | projection to a flat `viewBox` |

The three build-time packages go in `devDependencies` and **are never imported from `src/`**; a test
asserts that (§11). Nothing else is added: no charting library, no geometry library at runtime, no
dice library (`risk-dice` is never vendored — R60).

Config files, all *(scaffold)*: `tsconfig.json` with **`noUncheckedIndexedAccess`**;
`eslint.config.mjs` and `postcss.config.mjs` byte-identical to the siblings; `next.config.ts` with
`reactStrictMode: true`, `devIndicators: false`, `agentRules: false`,
`serverExternalPackages: ["@electric-sql/pglite", "@neondatabase/serverless"]`,
`outputFileTracingIncludes`, and the Turbopack root pin via `fileURLToPath`; `vitest.config.mts` with
`tsconfigPaths() + react()`, the `server-only → src/test-support/empty-module.ts` alias, jsdom,
`vitest.setup.ts`, `include: ["src/**/*.test.{ts,tsx}"]` and `testTimeout`/`hookTimeout` `30_000`;
`playwright.config.ts` on **port 3300**, `fullyParallel: false`, `workers: 1`, projects
`desktop-chrome` + `mobile-chrome (Pixel 7)`, viewport 1280×800, and the five env pins
(`DB_DRIVER=pglite`, `DB_DATA_DIR=:memory:`, `E2E_ALLOW_PGLITE_PRODUCTION_BUILD=true`,
`NEXT_PUBLIC_RISK_DEBUG=1`, plus `RISK_TURN_SECONDS=3` and `RISK_FIXED_SEED=e2e-seed` added by S5).
Deploy: `.vercel/project.json` name **`risk-david`**, `vercel.json` =
`{ "buildCommand": "pnpm run db:push && pnpm run build" }`, manual `npx vercel deploy --prod --yes`,
commits straight to `main`.

### 4.4 Identifiers and constants (`src/engine/types.ts`)

```ts
export type Seat = number;                  // 0 .. seats.length - 1
export type TerritoryId = number;           // index into MapDef.territories
export type ContinentId = number;           // index into MapDef.continents

export const SEAT_NONE = -1;                 // unowned: a blizzard tile, or pre-claim
export const SEAT_NEUTRAL = -2;              // the 2-player variant's neutral holding
export const SEAT_UNKNOWN = -3;              // hidden by fog (only ever present in a view)
export const TROOPS_UNKNOWN = -1;            // ditto
export const MAX_SEATS = 6;
export const RULESET_VERSION = 1 as const;

export type Phase = "claim" | "draft" | "attack" | "fortify" | "over";
export type Suit = "infantry" | "cavalry" | "artillery" | "wild";
export type DiceMode = "balancedBlitz" | "trueRandom";
export type CardBonusScheme = "fixed" | "progressive";
export type WinCondition = "world" | "percentage" | "capitals";
export type PortalMode = "off" | "stable" | "unstable";
export type Standing = "active" | "eliminated" | "resigned" | "away";
export type SeatKind = "human" | "bot" | "neutral";
export type BotTier = "beginner" | "easy" | "medium" | "hard" | "expert";
export type PlayerColour =
  | "red" | "green" | "blue" | "yellow" | "orange" | "pink" | "black" | "white" | "purple";

/** Turn-timer options (R79). Online only. */
export const TURN_SECONDS = [60, 90, 120, 180, 300] as const;
/** Starting armies by seat count (R2); 2 seats use the 40/40/40 variant. */
export const STARTING_ARMIES: Record<number, number> = { 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 };
/** Fixed card values by suit, and for any mixed/Wild set (R22). */
export const FIXED_SET_VALUE: Record<Suit, number> = { infantry: 4, cavalry: 6, artillery: 8, wild: 10 };
export const FIXED_MIXED_VALUE = 10;
/** Progressive ladder (R22): index n-1 for the n-th set, then 15 + 5*(n-6). */
export const PROGRESSIVE_SET_VALUES = [4, 6, 8, 10, 12, 15] as const;
export const TERRITORY_BONUS = 2;
export const TERRITORY_BONUS_CAP = 2;
export const UNSTABLE_PORTAL_PERIOD = 3;     // relocate when round % 3 === 0 (R76)
```

### 4.5 `MapFile` and `MapDef`

`MapFile` is what sits in `src/content/maps/*.json` — string ids, one fetch, geometry inline.
`MapDef` is the loaded, index-resolved runtime shape the engine and renderer use.

```ts
// ---- on disk: src/content/maps/<slug>.json (S3 owns the files and the schema) ----
export interface MapFile {
  readonly slug: string;
  readonly name: string;
  readonly tagline?: string;
  readonly viewBox: string;                      // e.g. "0 8 1024 643"
  readonly continents: readonly {
    readonly id: string; readonly name: string; readonly bonus: number;
    readonly color: string;                      // the continent accent token value
    readonly territories: readonly string[];
  }[];
  readonly territories: readonly {
    readonly id: string; readonly name: string; readonly continent: string;
    readonly adjacent: readonly string[];        // undirected; symmetry is validated
    readonly d: string;                          // SVG path, 12-30 vertices (R-visual §8)
    readonly tokenX: number; readonly tokenY: number;   // pole of inaccessibility
    readonly labelX: number; readonly labelY: number;   // ~26px below the token
  }[];
  readonly seaLinks: readonly { readonly from: string; readonly to: string }[];
  readonly modifierSlots: {
    readonly blizzards: number;                  // 2..11
    readonly portals: number;                    // 3..7
    readonly capitals: number;                   // = MAX_SEATS on every shipped map [SPEC]
  };
}

// ---- loaded: the engine's view ----
export interface Territory {
  readonly index: TerritoryId;
  readonly id: string;
  readonly name: string;
  readonly continent: ContinentId;
  readonly adjacent: readonly TerritoryId[];     // sorted ascending (R91)
  readonly seaLinked: readonly TerritoryId[];    // the subset drawn as dashed routes
  readonly d: string;
  readonly token: readonly [number, number];
  readonly label: readonly [number, number];
}

export interface Continent {
  readonly index: ContinentId;
  readonly id: string;
  readonly name: string;
  readonly bonus: number;
  readonly color: string;
  readonly territories: readonly TerritoryId[];  // sorted ascending
  readonly border: readonly TerritoryId[];       // territories with an external edge
}

export interface MapDef {
  readonly slug: string;
  readonly name: string;
  readonly viewBox: readonly [number, number, number, number];
  readonly territories: readonly Territory[];
  readonly continents: readonly Continent[];
  readonly modifierSlots: MapFile["modifierSlots"];
  /** Row i lists i's static neighbours. Portal edges are added at query time by graph.ts. */
  readonly adjacency: readonly (readonly TerritoryId[])[];
}
```

### 4.6 `Rules` and `GameConfig`

```ts
export interface Rules {
  readonly winCondition: WinCondition;
  readonly dominationThreshold: number;   // 0.50 .. 0.90, default 0.70 (R71)
  readonly cardBonus: CardBonusScheme;
  readonly diceMode: DiceMode;
  readonly fogOfWar: boolean;
  readonly capitals: boolean;
  readonly capitalDraftBonus: boolean;    // default false (R15)
  readonly blizzards: boolean;
  readonly portals: PortalMode;
  readonly manualPlacement: boolean;      // default false (R9)
  readonly maxRounds: number | null;      // 5 => "5-Rounds Rumble" (R77)
  readonly roundDelayMs: number;          // presentation pacing only; 0 by default
  readonly turnSeconds: number | null;    // online only; null offline (R79)
  readonly alliances: boolean;
  readonly aiDifficulty: BotTier;         // the pool every bot seat is drawn from
}

export const DEFAULT_RULES: Rules = {
  winCondition: "world", dominationThreshold: 0.7, cardBonus: "fixed",
  diceMode: "balancedBlitz", fogOfWar: false, capitals: false, capitalDraftBonus: false,
  blizzards: false, portals: "off", manualPlacement: false, maxRounds: null,
  roundDelayMs: 0, turnSeconds: null, alliances: false, aiDifficulty: "medium",
};

/** Everything that shapes an initial state. `seed` never reaches a client online (D5). */
export interface GameConfig {
  readonly mapSlug: string;
  readonly rules: Rules;
  readonly seats: readonly SeatConfig[];   // 2..6
  readonly seed: string;
}

export interface SeatConfig {
  readonly kind: Exclude<SeatKind, "neutral">;
  readonly name: string;
  readonly colour: PlayerColour;
  readonly tier: BotTier | null;           // non-null iff kind === "bot"
  readonly playerId?: string;              // online only
}
```

### 4.7 `Card`, `SeatState`, `GameState`

```ts
export interface Card {
  /** Stable, canonical id: a territory slug, or "wild-1" / "wild-2". */
  readonly id: string;
  readonly suit: Suit;
  readonly territory: TerritoryId | null;  // null iff suit === "wild"
}

export interface BotPersona {
  readonly name: string;                   // "rusher" | "turtle" | ... (display name in content/)
  readonly aggression: number;             // 0..1
  readonly minWinChance: number;
  readonly reserveFactor: number;          // border troops kept = factor * largest adjacent enemy stack
  readonly reserveFloor: number;           // absolute minimum border garrison (Assassin: 20)
  readonly continentFocus: number;         // 0..1
  readonly expansionism: number;           // 0..1
  readonly stackiness: number;             // 0..1
  readonly turtleAversion: number;         // 0..1
  readonly leaderBias: number;             // 0..1
  readonly grudgeWeight: number;
  readonly grudgeDecay: number;            // 0.5 .. 0.95
  readonly allianceLoyalty: number;        // 0..1, 1 = never betrays
  readonly lookahead: 0 | 1 | 2;
  readonly seesKillForCards: boolean;
  readonly seesCardTradeTiming: boolean;
  readonly seesDominationThreshold: boolean;
  readonly usesExactOdds: boolean;
  readonly fogHonest: boolean;
  readonly fogPessimism: number;           // multiplier on unknown stacks when fogHonest
  readonly blunderRate: number;            // P(take the k-th best move)
  readonly placement: "spread" | "secure" | "frontLoad" | "stack";
}

export interface PortalState {
  readonly a: TerritoryId;
  readonly b: TerritoryId;
  readonly kind: Exclude<PortalMode, "off">;
  /** The first round in which this portal conducts. Stable portals are always 0. */
  readonly activeFrom: number;
}

export interface TerritoryState {
  readonly owner: Seat;                    // a seat, SEAT_NONE, SEAT_NEUTRAL, or SEAT_UNKNOWN in a view
  readonly troops: number;                 // TROOPS_UNKNOWN in a view
  readonly blizzard: boolean;
}

export interface SeatState {
  readonly seat: Seat;
  readonly kind: SeatKind;
  readonly name: string;
  readonly colour: PlayerColour;
  readonly standing: Standing;
  readonly cards: readonly Card[];
  readonly capital: TerritoryId | null;
  readonly tier: BotTier | null;
  readonly persona: BotPersona | null;     // drawn once at match start, stored here (D28)
  readonly allies: readonly Seat[];        // sorted ascending; symmetric
  readonly missedTurns: number;
  readonly armiesToClaim: number;          // claim phase only (R9)
}

export interface Outcome {
  readonly winner: Seat;
  readonly reason: "world" | "percentage" | "capitals" | "lastStanding" | "maxRounds";
  readonly tiebreak: boolean;              // true only when R78 decided it
  readonly round: number;
}

export interface GameState {
  readonly version: typeof RULESET_VERSION;
  readonly mapSlug: string;
  readonly rules: Rules;
  readonly seats: readonly SeatState[];
  readonly turnOrder: readonly Seat[];     // excludes the neutral holding (R7)
  readonly territories: readonly TerritoryState[];   // index === TerritoryId
  readonly currentIndex: number;           // index into turnOrder
  readonly phase: Phase;
  readonly round: number;                  // 1-based; increments on wrap
  readonly turn: number;                   // monotonic; the rngFor sub-stream index
  readonly troopsToPlace: number;
  readonly territoryBonusLeft: number;     // 0..2, reset each turn (R23)
  readonly setsTradedThisTurn: number;
  readonly setsTradedTotal: number;        // drives the Progressive ladder (R22)
  readonly conqueredThisTurn: boolean;     // drives the card award (R20)
  readonly fortifyUsed: boolean;
  readonly pendingMoveIn: {
    readonly from: TerritoryId; readonly to: TerritoryId;
    readonly min: number; readonly max: number;        // R63
  } | null;
  /** Set when a forced mid-Attack trade-down bounced the phase back to draft (R27). */
  readonly resumePhase: Phase | null;
  readonly portals: readonly PortalState[];
  readonly discard: readonly Card[];       // traded-in cards; the deck order is never stored (R19)
  readonly outcome: Outcome | null;
  /** True only on the result of `viewFor`. The authoritative state always has `false`. */
  readonly fogged: boolean;
}
```

`GameState` holds **no seed, no RNG state, no deck order, no wall clock and no UI state**. Online,
`games.seed` lives on the database row and is unreachable from the response serialiser; offline, the
seed lives in the session runner and in the autosave envelope, never in `GameState`.

### 4.8 The `Action` union

Every action is one log row. **Chat is not an action** — it has its own table and its own route, and
it never touches `GameState`. Actions whose `actor` is `server` are produced only by the resolver.

```ts
export interface SeatInit {
  readonly seat: Seat; readonly kind: Exclude<SeatKind, "neutral">; readonly name: string;
  readonly colour: PlayerColour; readonly tier: BotTier | null; readonly persona: BotPersona | null;
}

export type Action =
  // ---- seq 1, server/runner-resolved: the whole opening (R3, R4, R8, R10, R11; D3) ----
  | { readonly type: "GAME_STARTED"; readonly seat: Seat /* = turnOrder[0] */;
      readonly mapSlug: string; readonly rules: Rules;
      readonly seats: readonly SeatInit[];
      readonly turnOrder: readonly Seat[];
      readonly neutral: boolean;                      // true in the 2-seat variant
      readonly startingArmies: number;
      readonly deal: readonly { readonly territory: TerritoryId; readonly owner: Seat; readonly troops: number }[];
      readonly blizzards: readonly TerritoryId[];
      readonly portals: readonly PortalState[];
      readonly capitals: readonly (TerritoryId | null)[] }  // by seat index

  // ---- claim phase (R9) ----
  | { readonly type: "CLAIM"; readonly seat: Seat; readonly territory: TerritoryId }

  // ---- draft ----
  | { readonly type: "TRADE_CARDS"; readonly seat: Seat;
      readonly cards: readonly [string, string, string];   // Card.id triple
      readonly bonusTerritory: TerritoryId | null }        // which match takes the +2 (R23)
  | { readonly type: "DRAFT"; readonly seat: Seat; readonly territory: TerritoryId; readonly count: number }

  // ---- attack: two payload shapes, one action type (R46, R48, R58, R61) ----
  | { readonly type: "ATTACK"; readonly seat: Seat;
      readonly from: TerritoryId; readonly to: TerritoryId;
      readonly mode: "manual";
      readonly attackerDice: readonly number[];            // 1..3 values in 1..6, as rolled
      readonly defenderDice: readonly number[] }           // 1..4 values; the reducer derives losses
  | { readonly type: "ATTACK"; readonly seat: Seat;
      readonly from: TerritoryId; readonly to: TerritoryId;
      readonly mode: "blitz";
      readonly attackerLosses: number;
      readonly defenderLosses: number;
      readonly stopUntil?: number }                        // the Attack Limiter floor, if one was set

  | { readonly type: "MOVE_IN"; readonly seat: Seat; readonly count: number }   // R62, R63

  // ---- fortify ----
  | { readonly type: "FORTIFY"; readonly seat: Seat;
      readonly from: TerritoryId; readonly to: TerritoryId; readonly count: number }

  // ---- phase/turn ----
  | { readonly type: "END_PHASE"; readonly seat: Seat }    // illegal out of fortify (R67)
  | { readonly type: "END_TURN"; readonly seat: Seat }

  // ---- server/runner-resolved ----
  | { readonly type: "CARD_DRAWN"; readonly seat: Seat; readonly card: Card }   // R20
  | { readonly type: "AUTO_DEPLOY"; readonly seat: Seat;
      readonly placements: readonly { readonly territory: TerritoryId; readonly count: number }[] }
  | { readonly type: "SEAT_TO_BOT"; readonly seat: Seat;
      readonly reason: "away" | "timeout" | "resigned";
      readonly tier: BotTier; readonly persona: BotPersona }
  | { readonly type: "SEAT_TO_HUMAN"; readonly seat: Seat }
  | { readonly type: "PORTALS_MOVED"; readonly seat: Seat; readonly portals: readonly PortalState[] }

  // ---- alliances (R80) ----
  | { readonly type: "ALLIANCE_PROPOSE"; readonly seat: Seat; readonly to: Seat }
  | { readonly type: "ALLIANCE_ACCEPT"; readonly seat: Seat; readonly from: Seat }
  | { readonly type: "ALLIANCE_BREAK"; readonly seat: Seat; readonly with: Seat };

export type ActionKind = Action["type"];

/** What a client submits. The authority turns an intent into the action above. */
export type AttackIntent = {
  readonly from: TerritoryId; readonly to: TerritoryId;
} & ({ readonly mode: "manual"; readonly attackerDice: 1 | 2 | 3 }
   | { readonly mode: "blitz"; readonly stopUntil?: number });
```

### 4.9 The `Event` union

Events are the engine's only output besides state: they drive every animation and never enter
`GameState`.

```ts
export type Event =
  | { readonly type: "turnStarted"; readonly seat: Seat; readonly round: number }
  | { readonly type: "phaseChanged"; readonly from: Phase; readonly to: Phase }
  | { readonly type: "troopsAwarded"; readonly seat: Seat; readonly base: number;
      readonly continents: readonly ContinentId[]; readonly bonus: number; readonly total: number }
  | { readonly type: "cardsTraded"; readonly seat: Seat; readonly cards: readonly string[];
      readonly value: number; readonly territoryBonus: TerritoryId | null }
  | { readonly type: "troopsPlaced"; readonly territory: TerritoryId; readonly count: number }
  | { readonly type: "diceRolled"; readonly from: TerritoryId; readonly to: TerritoryId;
      readonly attackerDice: readonly number[]; readonly defenderDice: readonly number[] }
  | { readonly type: "battleResolved"; readonly from: TerritoryId; readonly to: TerritoryId;
      readonly attackerLosses: number; readonly defenderLosses: number;
      readonly conquered: boolean; readonly unresolved: boolean }
  | { readonly type: "territoryCaptured"; readonly territory: TerritoryId;
      readonly from: Seat; readonly to: Seat }
  | { readonly type: "troopsMoved"; readonly from: TerritoryId; readonly to: TerritoryId; readonly count: number }
  | { readonly type: "cardAwarded"; readonly seat: Seat; readonly card: Card }
  | { readonly type: "cardsSeized"; readonly seat: Seat; readonly from: Seat; readonly count: number }
  | { readonly type: "continentHeld"; readonly seat: Seat; readonly continent: ContinentId; readonly bonus: number }
  | { readonly type: "continentBroken"; readonly seat: Seat; readonly continent: ContinentId }
  | { readonly type: "playerEliminated"; readonly seat: Seat; readonly by: Seat }
  | { readonly type: "seatToBot"; readonly seat: Seat; readonly reason: "away" | "timeout" | "resigned" }
  | { readonly type: "seatToHuman"; readonly seat: Seat }
  | { readonly type: "portalsMoved"; readonly portals: readonly PortalState[] }
  | { readonly type: "allianceChanged"; readonly a: Seat; readonly b: Seat;
      readonly state: "proposed" | "accepted" | "broken" }
  | { readonly type: "gameOver"; readonly outcome: Outcome };
```

### 4.10 `@/engine` public API (`src/engine/index.ts`)

```ts
export * from "./types";

export interface ApplyResult {
  readonly state: GameState;      // === the input state when `error` is set (R86)
  readonly events: readonly Event[];
  readonly error?: RuleError;
}

export interface RuleError { readonly code: RuleErrorCode; readonly message: string }
export type RuleErrorCode =
  | "notYourTurn" | "wrongPhase" | "gameOver" | "unknownTerritory" | "notOwned" | "notAdjacent"
  | "tooFewTroops" | "tooManyTroops" | "blizzard" | "mustPlaceAllTroops" | "mustTradeCards"
  | "invalidSet" | "notHeld" | "noPath" | "fortifyUsed" | "moveInPending" | "moveInRange"
  | "diceCount" | "notAlliable" | "illegalAction";

/** Folds `GAME_STARTED` into an empty board. The map must already be loaded. */
export function createInitialState(map: MapDef, started: Extract<Action, { type: "GAME_STARTED" }>): GameState;

/** The one door into the rules. Pure, total, non-mutating (R86–R88). */
export function apply(state: GameState, action: Action): ApplyResult;

/** Why `action` would be refused, or null. Never mutates and never throws. */
export function validate(state: GameState, action: Action): RuleError | null;

/** The action kinds `seat` may submit right now, in a stable order. */
export function legalActions(state: GameState, seat: Seat): readonly ActionKind[];

// ---- selectors the UI and the bots share ----
export function reinforcementsFor(state: GameState, map: MapDef, seat: Seat): {
  base: number; continents: readonly ContinentId[]; bonus: number; capitals: number; total: number;
};
export function legalAttackTargets(state: GameState, map: MapDef, from: TerritoryId): readonly TerritoryId[];
export function legalFortifyMoves(state: GameState, map: MapDef, from: TerritoryId): readonly TerritoryId[];
export function legalDraftTargets(state: GameState, seat: Seat): readonly TerritoryId[];
export function cardSets(cards: readonly Card[]): readonly (readonly [string, string, string])[];
export function cardTradeValue(state: GameState, set: readonly [string, string, string]): number;
export function mustTradeNow(state: GameState, seat: Seat): boolean;          // R24 / R26
export function diceAugmentFor(state: GameState, from: TerritoryId, to: TerritoryId): DiceAugment;
export function dicePlan(state: GameState, from: TerritoryId, to: TerritoryId): {
  maxAttackDice: 1 | 2 | 3; defendDice: 1 | 2 | 3 | 4;
};
export function territoryCounts(state: GameState): readonly number[];          // by seat; fog-safe
export function troopCounts(state: GameState): readonly number[];
export function continentsHeldBy(state: GameState, map: MapDef, seat: Seat): readonly ContinentId[];
export function isGameOver(state: GameState): boolean;

// ---- fog, hashing, serialisation ----
/** Masks every territory `seat` cannot see (R73). Sets `fogged: true`. Identity when fog is off. */
export function viewFor(state: GameState, map: MapDef, seat: Seat): GameState;
/** Canonical: sorted keys, integers not floats, no `undefined`. 64-bit hex (D16). */
export function hashState(state: GameState): string;
export function canonicalize(state: GameState): string;
export function serializeState(state: GameState): string;
export function deserializeState(json: string): GameState;

// ---- the resolver barrel (pure, but RNG-taking) ----
export * from "./resolver";
export { pcg32, rngFor, type Rng, type RngPurpose } from "./prng";
```

### 4.11 The resolver

The resolver is the **only** place randomness enters, and it never mutates state: it returns the
**action** whose payload carries the outcome (D2, D3, D4).

```ts
export type RngPurpose =
  | "deal" | "turnOrder" | "cardDeck" | "battle"
  | "modifierPlace" | "portalMove"
  | "personaAssign" | "personaJitter"
  | `bot:${number}`;

export interface Rng {
  nextU32(): number;
  nextFloat(): number;                     // [0,1), = nextU32() / 2**32
  readonly state: readonly [number, number];
}

/** PCG32 over a 64-bit state held as two u32s; integer ops only (Math.imul, >>> 0). */
export function pcg32(seedHi: number, seedLo: number): Rng;
/** Purpose-tagged sub-stream: pcg32(hash(seed, purpose, turn)). The determinism keystone (D4). */
export function rngFor(seed: string, purpose: RngPurpose, turn: number): Rng;

// ---- resolver signatures (src/engine/resolver/) ----
export function dealTerritories(
  map: MapDef, config: GameConfig, rng: Rng,
): Extract<Action, { type: "GAME_STARTED" }>;

export function placeModifiers(
  map: MapDef, rules: Rules, owners: readonly Seat[], rng: Rng,
): { blizzards: readonly TerritoryId[]; portals: readonly PortalState[]; capitals: readonly (TerritoryId | null)[] };

export function rollAttack(
  state: GameState, map: MapDef, intent: AttackIntent, rng: Rng,
  odds: OddsTables, diceMode: DiceMode,
): Extract<Action, { type: "ATTACK" }>;

export function drawCard(
  state: GameState, map: MapDef, seat: Seat, rng: Rng,
): Extract<Action, { type: "CARD_DRAWN" }>;

export function movePortals(
  state: GameState, map: MapDef, rng: Rng,
): Extract<Action, { type: "PORTALS_MOVED" }> | null;   // null when nothing is due

export function drawPersonas(
  tiers: readonly (BotTier | null)[], assignRng: Rng, jitterRng: Rng,
): readonly (BotPersona | null)[];
```

`rollAttack` consumes **exactly one** `nextFloat()` for a Blitz (inverse-CDF over the reshaped
distribution, R58) and exactly `attackerDice + defendDice` `nextU32()`s for a Manual roll — which is
always True Random (R61). `drawCard` consumes one draw. `dealTerritories` consumes a bounded number
fixed by `(territoryCount, seatCount)`. Every one of those counts is asserted by a test, because a
change to a draw count is a replay-breaking change (D4).

### 4.12 `@/engine/odds`

```ts
export interface DiceAugment {
  readonly defendDiceBonus: number;        // +1 per capital / wall (R36)
  readonly attackDicePenalty: number;      // reserved for the Zombie augment
  readonly favourDefenderOnDraw: boolean;  // true in every in-scope mode
}
export const STANDARD_AUGMENT: DiceAugment =
  { defendDiceBonus: 0, attackDicePenalty: 0, favourDefenderOnDraw: true };

/** Terminal-state distribution of one whole battle (R40, R48). */
export interface OutcomeDist {
  readonly a: number;                      // A, excluding the garrison
  readonly d: number;
  /** attackLoss[i<A] = P(win having lost i); attackLoss[A] = P(lose the battle). */
  readonly attackLoss: Float64Array;
  /** defendLoss[j<D] = P(defender wins having lost j); defendLoss[D] = P(attacker wins). */
  readonly defendLoss: Float64Array;
  /** P(the Attack Limiter stopped the battle with both sides alive). 0 without `stopUntil`. */
  readonly unresolved: number;
  readonly winChance: number;
}

export interface OddsTables {
  readonly mode: DiceMode;
  /** P(attacker takes the territory) fighting to the death. Table lookup, ~1.15 ns. */
  winChance(a: number, d: number, aug?: DiceAugment): number;
  /** The full reshaped (or raw) distribution; memoised, never part of game state. */
  outcome(a: number, d: number, aug?: DiceAugment, stopUntil?: number): OutcomeDist;
  expectedAttackerLoss(a: number, d: number, aug?: DiceAugment): number;
  certainWin(a: number, d: number, aug?: DiceAugment): boolean;      // winChance >= 1 - CERTAIN_EPS
}

export const TABLE_MAX = 128;
export const CERTAIN_EPS = 1e-9;          // [SPEC]: the brief gives the predicate, not the epsilon
export const LOGISTIC_ALPHA = 0.86;
export const LOGISTIC_BETA = 0.63;
export const BALANCE_CONFIG = {
  winChanceCutoff: 0.05, winChancePower: 1.3, outcomeCutoff: 0.1, outcomePower: 1.8,
} as const;
export const CDF_QUANTUM = 2 ** 32;       // R59

export function createOdds(mode: DiceMode): OddsTables;
/** The 24 single-roll distributions, keyed by (attackDice, defendDice, favourDefenderOnDraw). */
export function roundDistribution(attackDice: number, defendDice: number, favourDefender: boolean): Float64Array;
export function battleTable(aug: DiceAugment): Float32Array;         // (TABLE_MAX+1)^2, row-major
export function balance(raw: OutcomeDist, cfg?: typeof BALANCE_CONFIG): OutcomeDist;
export function sampleOutcome(dist: OutcomeDist, u: number): {
  attackerLosses: number; defenderLosses: number; conquered: boolean; unresolved: boolean;
};
```

**Initialisation budget.** `createOdds("trueRandom")` builds the True Random `Float32Array` tables
eagerly: 129×129 per augment, 65 KiB each, ~2 ms for all of them. `createOdds("balancedBlitz")`
builds the same True Random tables (the bot still needs `expectedAttackerLoss` and the break-even is
shared) and computes **Balanced Blitz distributions lazily, memoised on
`(a, d, attackDice, defendDice, favourDefenderOnDraw, stopUntil)`** — a full 100×100 BB table measures
199.8 ms, which is over the init budget (D24). The memo is pure and **never serialised**; a cache-warm
difference must never become a replay divergence. Outside the table, `winChance` uses the logistic and
**never clamps indices** (R43).

### 4.13 `@/engine/bots`

```ts
/** Flat read-model. Built from an authoritative state, or from `viewFor`'s output for honest bots. */
export interface GameView {
  readonly map: MapDef;
  readonly rules: Rules;
  readonly me: Seat;
  readonly turn: number;
  readonly round: number;
  readonly phase: Phase;
  readonly owner: Int16Array;              // by TerritoryId; SEAT_* sentinels preserved
  readonly troops: Int16Array;             // beliefs, already inflated by persona.fogPessimism
  readonly known: Uint8Array;              // 1 when the true value is known
  readonly blizzard: Uint8Array;
  readonly territoryCount: Int16Array;     // by seat
  readonly troopCount: Int32Array;
  readonly cardCount: Int16Array;
  readonly myCards: readonly Card[];
  readonly allies: Uint8Array;             // by seat
  readonly standing: readonly Standing[];
  readonly troopsToPlace: number;
  readonly grudge: Float32Array;           // by seat, carried across turns by the bot runner
}

export interface TurnPlan {
  readonly cardTrade: readonly [string, string, string] | null;
  readonly placements: readonly { readonly territory: TerritoryId; readonly count: number }[];
  readonly attacks: readonly {
    readonly from: TerritoryId; readonly to: TerritoryId;
    readonly mode: "blitz" | "manual";
    readonly attackerDice?: 1 | 2 | 3;     // manual only
    readonly stopUntil?: number;
    readonly moveIn: "min" | "max" | number;
  }[];
  readonly fortify: { readonly from: TerritoryId; readonly to: TerritoryId; readonly count: number } | null;
  /** True when the plan is complete; false asks the runner to re-enter after the next battle. */
  readonly done: boolean;
}

export function makeView(state: GameState, map: MapDef, seat: Seat, persona: BotPersona, grudge?: Float32Array): GameView;

/** Pure. Same inputs -> same outputs, always (D8). Re-entered after each battle. */
export function decideTurn(
  view: GameView, seat: Seat, persona: BotPersona, odds: OddsTables, rng: Rng,
): TurnPlan;

export interface TierRow {
  readonly pool: readonly string[];        // persona names this tier draws from
  readonly minWinChance: number | "dynamic";
  readonly blunderRate: number;
  readonly tierReserveFactor: number;
  readonly placement: BotPersona["placement"];
  readonly lookahead: 0 | 1 | 2;
  readonly usesExactOdds: boolean;
  readonly fogHonest: boolean;
  readonly fogPessimism: number;
  readonly allianceLoyalty: number;
  readonly seesKillForCards: boolean;
  readonly seesCardTradeTiming: boolean;
  readonly seesDominationThreshold: boolean;
  readonly antiBotBias: boolean;
}

export function personaFor(tier: BotTier, rng: Rng): BotPersona;
export const TIERS: Record<BotTier, TierRow>;
export const PERSONAS: Record<string, BotPersona>;
export const DEFAULT_WEIGHTS: BotWeights;
```

**The tier table** (`src/engine/bots/tiers.ts`). Each tier *adds*; nothing is removed. Beginner is
interpolated below Easy.

| | **beginner** | **easy** | **medium** | **hard** | **expert** |
|---|---|---|---|---|---|
| Persona pool | turtle, opportunist (softest jitter) | turtle, opportunist | + continental, hoarder | + rusher | all, weighted continental/rusher |
| `usesExactOdds` | false | false | true | true | true (+ loss distribution) |
| `minWinChance` | 0.25 | 0.25 | 0.45 | 0.55 | dynamic (`score ≤ 0`) |
| `blunderRate` | 0.40 **[ours]** | 0.30 | 0.12 | 0.03 | 0.00 |
| `placement` | spread | spread | secure | secure + springboard | secure + planned springboard |
| Fortify | none | random legal / none | drain interior → nearest border | threat-weighted | + springboard tiebreak |
| Continent logic | none | none | completes if 1 away | full acquire/hold + breaks | + denies pending bonuses |
| Cards | when forced | when forced | trades at 3 (fixed) | progressive timing | + tracks every seat's count |
| `seesKillForCards` | false | false | false | true | true, set up a turn ahead |
| `seesDominationThreshold` | false | false | own progress | own + leader's | full denial |
| `fogHonest` | true, `fogPessimism` 1.5 | true, 1.4 | true, 1.2 | true, 1.1 | **false** (RGD parity) — per D31, every honest tier inflates unknown stacks; the brief's tier table said only "honest" for Medium/Hard |
| `lookahead` | 0 | 0 | 0 | 1 | 2 |
| `allianceLoyalty` | 1.0 | 1.0 | 1.0 | 0.9 | 0.6 |
| `tierReserveFactor` | 0.4 | 0.5 | 0.8 | 1.0 | 1.2 **[SPEC]** |
| Anti-bot bias | yes **[SMG]** | yes **[SMG]** | no | no | no |

**The eight personas** (`src/engine/bots/personas.ts`). The **Defining knobs** column is sourced; the
remaining fields are **[SPEC]** fills consistent with the persona's description, jittered ±10% at match
start from `rngFor(seed, "personaJitter", 0)`.

| Persona | RGD name | `aggression` | `minWinChance` | `reserveFactor` | `reserveFloor` | `continentFocus` | `expansionism` | `stackiness` | `leaderBias` | `placement` |
|---|---|---|---|---|---|---|---|---|---|---|
| **rusher** | Aggressive | **0.90** | **0.30** | **0.50** | 2 | 0.4 | 0.8 | 0.3 | 0.5 | frontLoad |
| **continental** | Continental | 0.55 | 0.50 | 1.0 | 3 | **1.00** | **0.40** | 0.4 | 0.4 | secure |
| **clusterer** | — | 0.50 | 0.50 | 1.0 | 3 | **0.30** | 0.6 | 0.5 | 0.3 | secure |
| **hoarder** | Stacker | 0.35 | 0.65 | 1.4 | 6 | 0.3 | 0.3 | **1.00** | 0.3 | stack |
| **turtle** | Defensive | 0.15 | **0.80** | **2.00** | 4 | 0.5 | 0.2 | 0.6 | 0.2 | secure |
| **opportunist** | Friendly | 0.50 | 0.45 | 1.0 | 3 | 0.5 | 0.5 | 0.4 | 0.7 | secure |
| **assassin** | — | 0.70 | 0.40 | 1.0 | **20** | 0.3 | 0.6 | 0.7 | 0.6 | frontLoad |
| **wildcard** | — | samples another persona at match start from `rngFor(seed, "personaAssign", 0)` | | | | | | | | |

`turtle` additionally caps itself at **one attack per turn**; `hoarder` attacks only when dominant;
`assassin` sets `seesKillForCards: true` at every tier that draws it. Killbot's published "20 armies
on each border" is the only absolute reserve number in any source and is used both as the assassin's
`reserveFloor` and as the sanity check that `reserveFactor` lands in that ballpark on a mature board.

**The scoring weights** (`DEFAULT_WEIGHTS`). The brief gives the *formulae* and `wHold ≈ 2.0`; every
other value here is **[SPEC]** — a tuning default, not a sourced number, and the golden-replay hashes
(§11) are what pin them.

```ts
export interface BotWeights {
  readonly wTerr: number; readonly wContComplete: number; readonly wKill: number; readonly wCard: number;
  readonly wAcquire: number; readonly wHold: number;
  readonly bsrTarget: number; readonly bsrFloor: number;
  readonly panicThreshold: number;
  readonly hostility: {
    readonly lead: number; readonly weak: number; readonly grudge: number;
    readonly cards: number; readonly prox: number; readonly turtle: number; readonly ally: number;
  };
}
export const DEFAULT_WEIGHTS: BotWeights = {
  wTerr: 1.0, wContComplete: 6.0, wKill: 1.0, wCard: 0.6,
  wAcquire: 0.35, wHold: 2.0,              // wHold is the only sourced value
  bsrTarget: 0.67, bsrFloor: 0.35, panicThreshold: 0.25,
  hostility: { lead: 1.0, weak: 0.4, grudge: 0.25, cards: 0.3, prox: 0.5, turtle: 0.6, ally: 3.0 },
};
```

The formulae those weights sit in, all from the brief:

```
contValue(c)   = bonus(c) / (acquireCost(c) + holdCost(c))
  acquireCost(c) = Σ over unowned t in c ( 1 + enemyTroops(t) * wAcquire )
  holdCost(c)    = borderTerritories(c) * wHold                       // wHold = 2.0

draftScore(p)  = continentCurve(ownedPerContinent)
               + 13.38*(turnPosition == 1) + 5.35*(turnPosition == 2)
               - 0.07*distinctEnemyBorderingTerritories
               + 0.96*pairsOfAdjacentOwnedTerritories

V(state)       = expectedIncome(me) - max over opponents p of expectedIncome(p)
  expectedIncome(x) = max(3, floor(territories(x)/3)) + Σ continentBonuses(x) + expectedCardValue(x)

BST(t)         = Σ enemyTroops(y) over enemy y adjacent to t
BSR(t)         = BST(t) / ownTroops(t)          // >= 1 takeable; <= 0.67 comfortable
NBSR(t)        = BSR(t) / Σ_z BSR(z)            // reinforcement share; zero out BSR < bsrFloor first,
                                                 // round by largest remainder, leftovers to highest BSR
score(src,dst) = p*gain(dst) - (1-p)*sunkCost(src) - risk(dst)
  p        = odds.winChance(src.troops - 1, dst.troops, augment(src,dst))
  gain     = wTerr + wContComplete*completesContinent + wContBreak*breaksEnemyContinent
           + wKill*killValue(owner) + wCard*(firstConquestThisTurn ? expectedCardValue : 0)
  wContBreak = bonus(c) * expectedTurnsBroken,  expectedTurnsBroken = 1/(1 + theirReconquestEase)
             // break only if post-capture BSR >= 1.0 or the bonus denied >= 5
  sunkCost = odds.expectedAttackerLoss(...)      // from the distribution, never a constant
  risk     = Σ enemy troops adjacent to dst after capture
killValue(P)   = cardTradeValue(ourCards + P's cards) + P.territoryCount * wTerr
reserve(t)     = max(persona.reserveFloor, ceil(maxAdjacentEnemyStack(t) * tierReserveFactor))

H(p)           = armies(p) + 0.3*territories(p) + continentBonuses(p)
AD[i][j]       = share of i's attacks aimed at j;  beingTargetedBy(p) = AD[p][me] >= 0.75
                                                   ignoringMe(p)      = AD[p][me] <= 0.25
grudge[P]     += troopsLostTo(P)  each turn, then *= persona.grudgeDecay
turtleScore(P) = mean troops per border territory of P
if leaderShare > rules.dominationThreshold - 0.1 then leaderBias = 1.0
destination    = argmax over reachable owned d of threat(d) / max(1, d.troops)
byScoreThenId  = (a, b) => (b.score - a.score) || (a.id - b.id)      // always a total comparator
```

**Draw discipline.** A `decideTurn` call consumes **zero** draws in the common path and **at most
one** for a blunder or a tie-break. Never `while (rng.nextFloat() < x)`. Expert's compute goes into
the draft and a ply-1 reply check over the top ~8 candidates (1–5 ms), not into deeper attack search;
MCTS and rollouts are out (per-turn branching is 10³³–10⁸⁵).

### 4.14 `@/engine/map`

```ts
export function loadMap(file: MapFile): MapDef;                       // throws only on a validator failure
export function validateMap(file: MapFile): { valid: boolean; errors: readonly string[] };
export function generateVoronoiMap(options: GeneratorOptions, rng: Rng): MapFile;
export function anchorsFor(d: string): { token: [number, number]; label: [number, number] };

export interface GeneratorOptions {
  readonly territories: number;      // 19 .. 104
  readonly continents: number;       // 4 .. 11
  readonly width: number; readonly height: number;   // viewBox, default 1600 x 900
  readonly seaLinks: number;         // extra long edges, default round(territories / 6)
  readonly name?: string;
}
```

`validateMap` checks, and these are the build-time gates run against **every** shipped map (D36):
adjacency **symmetry**; no dangling territory or continent reference; every territory has a non-empty
`d`; every continent's territory list exactly matches the territories' own `continent` field; every
territory has both anchors; the `viewBox` contains all geometry; `modifierSlots.blizzards` ∈ 2–11 and
`portals` ∈ 3–7; no continent has a zero or negative bonus; every territory reachable from every
other. The validator is the reason two of the nine upstream Classic graphs shipped bugs.

**Loader gotchas, carried from the research** (S3 owns `scripts/maps/**`): attribute order in the
TotalRisk SVGs is `d=` **before** `id=`, so match the element rather than attribute order; territory
names containing `&` arrive HTML-escaped (`id="Aragon &amp; Castile"`), so decode entities first or 8
of Napoleonic Europe's 59 territories silently fail to bind; legacy `naturalearthdata.com/http//…`
URLs return HTTP 406, so use `naciscdn.org` or the GitHub raw paths. Adjacency is **derived
topologically** from shared polygon edges and cross-checked against the GeoDataSource CSV **only as a
test oracle** (CC BY-SA is viral; an oracle sidesteps it). Sea links are hand-authored.

### 4.15 The session runner (`src/game/session.ts`)

Copied in shape from island-empire's `createSession`. **`GameState` never enters React state or the
zustand store** — only derived UI slices do; the board repaints from the live state through a dirty
flag, bypassing React's render cycle.

```ts
export const AI_STEP_MS = 300;
export const AI_TURN_BUDGET_MS = 4000;
export const AI_STEP_MIN_MS = 40;
export function aiStepMs(actionCount: number): number {
  return Math.max(AI_STEP_MIN_MS, Math.min(AI_STEP_MS, Math.floor(AI_TURN_BUDGET_MS / Math.max(1, actionCount))));
}

export interface SessionUiState {
  version: number;                      // bumps on every GameState change
  selected: TerritoryId | null;
  litZone: readonly TerritoryId[];      // legal targets for the current intent
  actionMode: "idle" | "draft" | "attackFrom" | "attackTo" | "moveIn" | "fortifyFrom" | "fortifyTo";
  phase: Phase;
  actingSeat: Seat;
  viewerSeat: Seat;                     // the seat whose fog and HUD are shown
  botPlaying: boolean;
  bannerText: string | null;
  overlayMode: "none" | "troops" | "continents" | "players";
  attackLimit: number | null;           // stopUntil, or null for fight-to-the-death
  blitzWinChance: number | null;
  dice: { attacker: readonly number[]; defender: readonly number[] } | null;
  handOff: { seat: Seat } | null;
  hidden: boolean;                      // board concealed behind the hand-off overlay
  modal: "cards" | "dice" | "count" | "settings" | "help" | "endTurn" | "getReady" | null;
  toast: string | null;
  chatOpen: boolean;
  gameOver: Outcome | null;
  syncStatus: "offline" | "idle" | "polling" | "behind" | "desynced";
  settings: Settings;
}

export interface SessionOptions {
  map: MapDef;
  config: GameConfig;
  engine: EngineApi;                    // the narrow wrapper tests inject a scripted engine through
  odds: OddsTables;
  sync?: SyncPort | null;               // null offline
  settings?: SettingsPort | null;
  progress?: LocalProgressPort | null;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;   // swappable for a synchronous test scheduler
  skipAnimations?: boolean;
  viewport?: { w: number; h: number };
  resume?: SavedSession | null;
  save?: (saved: SavedSession | null) => void;
}

export interface SavedSession {
  readonly version: 1;
  readonly config: GameConfig;          // carries the seed (D5)
  readonly state: GameState;
  readonly turn: number;
  readonly grudge: readonly number[];
  readonly savedAt: number;
}

export interface Session {
  readonly state: GameState;
  readonly view: GameState;             // viewFor(state, map, viewerSeat)
  readonly map: MapDef;
  readonly store: StoreApi<SessionUiState>;
  start(): void;
  tapTerritory(at: TerritoryId): void;
  setMode(mode: SessionUiState["actionMode"]): void;
  setAttackLimit(stopUntil: number | null): void;
  submitAttack(intent: AttackIntent): void;
  submit(action: Action): ApplyResult;  // the offline path: resolve, then apply
  tradeCards(set: readonly [string, string, string], bonusTerritory: TerritoryId | null): void;
  moveIn(count: number): void;
  fortify(from: TerritoryId, to: TerritoryId, count: number): void;
  endPhase(): void;
  endTurn(): void;
  resign(): void;
  continueHandOff(): void;
  setOverlay(mode: SessionUiState["overlayMode"]): void;
  setModal(modal: SessionUiState["modal"]): void;
  updateSettings(patch: Partial<Settings>): void;
  say(lineId: number): void;            // preset dialog; writes chat, never an action
  takeDirty(): boolean;
  markDirty(): void;
  tick(now: number): boolean;
  destroy(): void;
  applyForTest(action: Action): void;
}

export function createSession(options: SessionOptions): Session;
```

**Autosave.** `risk:session:v1:<sourceKey>` holds a `SavedSession`, **including the seed**, written
after every `END_TURN` and on `visibilitychange → hidden`. `sourceKey(config)` hashes everything that
shapes the initial state — map slug, seat configuration (who is human or bot and at what tier),
seat count, and a hash of `Rules` — because anything that changes what a resumed `GameState` even
means must change the key.

**`EngineApi`** is a narrow interface over `@/engine` (`createInitialState`, `apply`, `validate`,
`legalActions`, `viewFor`, `hashState`, the resolver functions) so a test can inject a scripted
engine and assert the runner's behaviour without the rules.

### 4.16 Ports and adapters

```ts
// src/ports/sync.ts — one port, three possible adapters (D10)
export interface SyncPort {
  /** One poll. Resolves when the response has been folded in. */
  poll(): Promise<void>;
  /** Submit an intent-derived action; resolves with the authoritative action(s). */
  submit(action: Action, clientActionId: string): Promise<readonly LoggedAction[]>;
  onActions(listener: (actions: readonly LoggedAction[]) => void): () => void;
  onStatus(listener: (status: SessionUiState["syncStatus"]) => void): () => void;
  setIntervalMs(ms: number): void;
  readonly seq: number;
  close(): void;
}
export interface LoggedAction {
  readonly seq: number; readonly seat: Seat; readonly action: Action;
  readonly actor: "human" | "bot" | "server";
  readonly clientActionId: string | null; readonly stateHash: string;
}
export function createPollingSync(options: {
  gameId: string; since: number; fetch?: typeof globalThis.fetch;
  now?: () => number; schedule?: (fn: () => void, ms: number) => () => void;
}): SyncPort;

// src/ports/settings.ts
export interface Settings {
  cameraAnimations: boolean;   // default true
  phaseAnimations: boolean;    // default true
  endPhaseConfirmation: boolean; // default true
  sound: boolean; music: boolean;
  colourPatterns: boolean;     // the colour-vision pattern overlay, default false
  winChanceRamp: boolean;      // the opt-in colour ramp, default false (R-visual: gold is default)
}
export interface SettingsPort { read(): Settings; write(patch: Partial<Settings>): void;
  subscribe(fn: (s: Settings) => void): () => void }

// src/ports/localProgress.ts
export interface MapRecord { played: number; won: number; lastSeats: number }
export interface LocalProgress { maps: Record<string, MapRecord>; deviceId: string }
export interface LocalProgressPort { read(): LocalProgress; recordResult(mapSlug: string, won: boolean): void }

// src/ports/identity.ts
export interface Identity { playerId: string; displayName: string; colour: PlayerColour }
export interface IdentityPort { readCached(): Pick<Identity, "displayName" | "colour"> | null;
  claim(displayName: string): Promise<Identity>;      // POST /api/session
  setColour(colour: PlayerColour): Promise<Identity>; // PATCH /api/session
  leave(): Promise<void> }                            // DELETE /api/session
```

**localStorage keys** — the `:v1` suffix is the convention; bump, never migrate. Every read and write
is wrapped `try { … } catch { /* storage unavailable — the feature simply does not persist */ }`
behind a `typeof window !== "undefined"` guard, with a module-level listener `Set` so every open tab
reacts.

| Key | Contents |
|---|---|
| `risk:settings:v1` | `Settings` |
| `risk:progress:v1` | `LocalProgress` — `deviceId` from `crypto.randomUUID()` with a `Math.random` fallback |
| `risk:session:v1:<sourceKey>` | the resumable offline game, **including the seed** |
| `risk:identity:v1` | display name + colour only, for first paint. **Never a secret.** |

**Database** *(scaffold)*. `src/adapters/db/driver.ts` defines `SqlValue`, `SqlRow`, `SqlExecutor`,
`SqlDatabase` and `splitStatements()`; `index.ts` exposes `getDb()` memoised on
**`Symbol.for("risk.db")`** on `globalThis` — not optional, because Next builds several module graphs
per app and two PGlite instances against one data directory corrupt its WAL. `scripts/db-push.ts`
re-implements driver selection standalone, because `server-only` plus TS parameter properties do not
survive `node --experimental-strip-types`.

**`src/config/env.ts`** *(scaffold)* is the only file in `src/` that reads `process.env`. It picks
`neon` when `DATABASE_URL` is set and `pglite` otherwise, **throws** on an unrecognised `DB_DRIVER`
rather than falling back, and **refuses `pglite` under `NODE_ENV=production`** unless
`E2E_ALLOW_PGLITE_PRODUCTION_BUILD=true` *and* no serverless marker (`VERCEL`,
`AWS_LAMBDA_FUNCTION_NAME`, `AWS_EXECUTION_ENV`, `NETLIFY`, `RENDER`, `FLY_APP_NAME`, `K_SERVICE`,
`FUNCTION_TARGET`, `FUNCTIONS_WORKER_RUNTIME`, `CF_PAGES`) is present, so the escape hatch can never
fire on a deployment. S5 extends it with `RISK_TURN_SECONDS` and `RISK_FIXED_SEED`, both read only
there.

---

## 5. Data flow

### 5.1 Starting a game (all three modes)

`/new/rules` holds a `GameConfig` in the `sessionConfig` store. On BATTLE:

1. **Load the map** with a per-slug dynamic import through `src/content/maps/index.ts`'s loader map —
   `await loadMapFile(slug)`, never a barrel import, so one board's geometry never ships with another's
   page (D40) — then `loadMap(file)` to get the `MapDef`.
2. **Mint the seed.** Offline: `crypto.randomUUID()` in the runner, written into the autosave.
   Online: the server mints it into `games.seed` and it never leaves (D5). `RISK_FIXED_SEED` overrides
   it for e2e.
3. **Resolve the opening.** `dealTerritories(map, config, rngFor(seed, "deal", 0))` returns the whole
   `GAME_STARTED` action — seat order, the deal, starting armies, blizzards, portals, capitals — and
   `drawPersonas(...)` has already filled each bot seat's persona from `rngFor(seed, "personaAssign", 0)`
   and `rngFor(seed, "personaJitter", 0)` (D4).
4. `createInitialState(map, started)` → `createSession({ map, config, engine, odds, … })` →
   `session.start()`, which shows **Get Ready** and then runs the first turn.

`createOdds(rules.diceMode)` is built once per session and shared by the renderer's win-chance readout
and by every bot (R57).

### 5.2 An offline human turn

```
turn start  →  apply(END_TURN) of the previous seat already emitted turnStarted + troopsAwarded;
               the runner shows the turn banner and the Received Troops popup from those events
tap own territory  →  store.actionMode = "draft", litZone = legalDraftTargets()
                   →  CountSlider opens (1 .. troopsToPlace)
confirm            →  session.submit({ type:"DRAFT", ... })  →  apply  →  events  →  dirty flag
                   →  repeat until troopsToPlace === 0
End Draft Phase    →  apply(END_PHASE)  (refused with `mustPlaceAllTroops` while troops remain, R17)
tap own territory  →  actionMode "attackFrom", litZone = legalAttackTargets()
tap enemy          →  the full-screen Blitz view opens; blitzWinChance = odds.winChance(...)
                   →  steppers pick blitz | 1 | 2 | 3 dice; the Attack Limiter sets stopUntil
BATTLE             →  session.submitAttack(intent)
                   →  rollAttack(state, map, intent, rngFor(seed, "battle", turn), odds, diceMode)
                   →  the ATTACK action  →  apply  →  diceRolled / battleResolved / territoryCaptured
                   →  on conquest, pendingMoveIn is set and the Move Troops slider opens (R63)
End Attack Phase   →  apply(END_PHASE)
fortify            →  tap source, tap a reachable own territory, slider, apply(FORTIFY)
End Turn           →  the amber confirmation (if `endPhaseConfirmation`), then apply(END_TURN);
                      if conqueredThisTurn, the runner first resolves drawCard(...) → CARD_DRAWN
```

Every `apply` returns a new `GameState` the runner holds in a closure and a fresh `Event[]` the
animation queue consumes. The renderer repaints from the live state on the dirty flag plus a slow
~500 ms ambient bucket. Nothing in that loop passes through React state.

### 5.3 An offline bot turn

When `turnOrder[currentIndex]` is a bot seat, the runner:

1. builds `view = makeView(engine.viewFor(state, map, seat), map, seat, persona, grudge)` — the fog
   view for an honest persona, the authoritative state for Expert (`fogHonest: false`, D31);
2. calls `decideTurn(view, seat, persona, odds, rngFor(seed, "bot:"+seat, turn))` **synchronously**;
3. converts the `TurnPlan` into actions and replays them one at a time on a schedule of
   `aiStepMs(plan actions)` ms — purely presentational: the decision is already computed;
4. **re-enters `decideTurn` after each battle** with the updated view, because an attack chain is
   adaptive and a call costs microseconds;
5. stops when `plan.done` and the plan's `fortify` has been applied, then `END_TURN`.

`botPlaying` is true throughout, so every control is disabled and the HUD recolours to the acting
seat. Bot "thinking time" is a delay applied *after* the decision, never a computation budget.

### 5.4 Pass & Play hand-off

A state machine in the runner, with `hidden` gating the board:

```
END_TURN applied
  → next live seat is a bot?            → run 5.3, board visible
  → next live seat is human and there are ≥2 human seats?
        → store.handOff = { seat }, store.hidden = true
        → <HandOffOverlay playerName colour onContinue /> (opaque, full-screen, owner-tinted)
        → CONTINUE → handOff = null, hidden = false, viewerSeat = seat
        → Get Ready → the turn proceeds as 5.2 with that seat's fog view
  → otherwise (single human)            → straight into 5.2
```

The overlay is presentational only: it never dismisses itself and never touches game state. `hidden`
is what keeps the outgoing player from reading the incoming player's fog — which is the whole reason
the overlay exists, since RGD's own interstitial could not be confirmed (D50).

### 5.5 Online: submit → append → poll → fold

**Submit.** The client mints `clientActionId = crypto.randomUUID()` **once per intent (the click)** and
reuses it verbatim on every retry (D15). It then `POST`s the action to `/api/games/:id/actions`.
Non-dice actions are applied **optimistically** into `pendingActions`; an `ATTACK` is **not** — the
client must not predict dice, so it submits the intent, plays the tumbling-dice animation, and resolves
when the authoritative action returns with the numbers. That is exactly what the original's UI does.

**Append**, one transaction over the WebSocket pool:

```
begin;
  select seq, snapshot, snapshot_seq, current_seat, phase, status
    from games where id = $1 for update;          -- the fence that stops a double-clicked Attack
                                                  --   racing two inserts for seq+1
  authorise: cookie → player → game_players.seat; 403 if no seat, 409 if seat <> current_seat
  fold forward to `state`; validate(state, action) → 422 on a RuleError
  roll the dice server-side (rollAttack with rngFor(games.seed, "battle", turn)) and splice
    the outcome into the payload
  insert into game_actions (...) values ($1, $seq+1, ..., state_hash);   -- 23505 on a retry
  update games set seq, snapshot, snapshot_seq, state_hash, current_seat, phase,
                   turn_deadline = now() + rules.turn_seconds, updated_at = now();
commit;
```

The response is `{ seq, actions: [theOneJustApplied] }`, so the submitter needs no extra poll. A
`23505` unique violation on `(game_id, client_action_id)` is caught and answered **200 with the
already-recorded action**, making a retry indistinguishable from a slow success.

**Poll.** One `GET /api/games/:id?since=<seq>` does five jobs in one invocation: stamps the caller's
`players.last_seen_at` (presence heartbeat, never a separate request), runs the lazy tick, returns the
action delta (or a snapshot), returns the other seats' presence and `turn_deadline`, and returns chat
since the client's last chat id. **That folding is what makes the budget work.**

**Client fold.**

```
confirmedState  = fold(apply, snapshot, actions)          // authoritative
pendingActions  = my optimistic actions, not yet confirmed
displayedState  = fold(apply, confirmedState, pendingActions)

on each response, for each action in seq order:
  if action.clientActionId is mine  → drop it from pendingActions
  confirmedState = apply(confirmedState, action).state
  assert hashState(confirmedState) === action.stateHash
displayedState = fold(apply, confirmedState, pendingActions)
```

A dropped, duplicated or out-of-order response is handled by the same code: `seq` is the only thing
that orders anything, actions at or below `since` are never re-applied, and a client behind the
compaction horizon gets a snapshot. The client never reasons about the network.

**Poll cadence** (D11), with **±15% jitter** so four clients in one game do not form a thundering herd:

| Situation | Interval |
|---|---|
| It is your turn | **2,000 ms** |
| Someone else's turn, tab visible | **4,000 ms** |
| Lobby or browse, tab visible | 5,000 ms |
| Tab hidden | **15,000 ms**, and **stop entirely after 5 minutes hidden** |
| Game finished, or you are eliminated | stop |

Plus an immediate re-poll on `visibilitychange → visible` and immediately after your own POST returns.
Stopping when hidden is not an optimisation: one abandoned tab polling forever costs 182.5 Neon
CU-hours, 1.8× the whole monthly allowance, exhausted around day 17.

### 5.6 The lazy tick: bots, timeouts and takeovers

Bots are not a background job — **a bot's turn is executed by the next poll that arrives**, in the same
request, by the same pure engine. Hobby cron fires once per day, so nothing periodic may depend on it;
and there is always at least one client polling whenever anyone is watching.

```
GET /api/games/:id?since=n
  read games.seq, current_seat, turn_deadline, tick_lease                     (one statement)
  needs a tick?  current seat is a bot  OR  turn_deadline < now()
    no  → seq === n ? 204 : return actions where seq > n
    yes → UPDATE games SET tick_lease = now() + interval '10 seconds'
            WHERE id = $1 AND (tick_lease IS NULL OR tick_lease < now()) RETURNING seq;
          0 rows ⇒ another poll is already ticking → answer from the log, next poll picks it up
          fold snapshot + actions > snapshot_seq → state
          loop at most MAX_TICK_ACTIONS = 40 times:
            action = isBot(seat) ? botAction(state, seat) : autoSkip(state, seat)
            state  = apply(state, action).state ; append with seq+1 and state_hash
            stop when the current seat is a live human, or the game ends
          UPDATE games SET seq, snapshot, snapshot_seq, state_hash, current_seat, phase,
                           turn_deadline, tick_lease = NULL
  return actions where seq > n        (now including the bots')
```

The 40-action cap matters because a chain of three consecutive bot seats is not a handful of actions:
cap it, return what was done, and let the next poll 2 s later continue. The player sees the bots move
in sequence, which is better than a frozen four-second request.

**Turn timer, leaving and reconnect are one mechanism**, and **every step is a row in the action log,
never a side effect** (D14):

| Condition on the tick | What the server appends |
|---|---|
| `turn_deadline` passed and the phase has a legal "do nothing" | `END_PHASE` / `END_TURN`, `missed_turns += 1` |
| `turn_deadline` passed with troops still undrafted | `AUTO_DEPLOY` (placements chosen by the bot policy), then `END_TURN` |
| `missed_turns >= 2` **and** `last_seen_at` older than 2 min | `SEAT_TO_BOT { reason: "away" }`, `game_players.kind='bot'`, `standing='away'` |
| that player polls again | `SEAT_TO_HUMAN`, `kind='human'`, `missed_turns = 0` |
| `POST /api/games/:id/resign` | `SEAT_TO_BOT { reason: "resigned" }`, `standing='resigned'` — **never reclaimable** (R82) |
| every human seat away for 30 min | `games.status = 'abandoned'`; the bots simply stop being run |

So a client renders "Napoleon went away — the bot took over" from the log, exactly as it renders a dice
roll, and a replay reproduces it identically.

### 5.7 Round-start work

At the start of each round (when `currentIndex` wraps to 0 and `round` increments), the authority — the
session runner offline, the tick or the submitting handler online — asks
`movePortals(state, map, rngFor(seed, "portalMove", turn))`. It returns a `PORTALS_MOVED` action when
`rules.portals === "unstable"` and `round % 3 === 0`, and `null` otherwise. The action is appended
before the round's first seat acts, so `activeFrom = round + 1` is already visible to everyone (R76).

### 5.8 Desync

Every action row carries `state_hash` over a **canonical** serialisation (sorted keys, integers not
floats, no `undefined`). The client asserts after each apply. On mismatch it does **not** reconcile: it
drops local state, refetches the snapshot, sets `syncStatus: "desynced"` and makes it loud (a console
error, and a thrown error in dev). A desync is a bug in `apply`, and the only useful response is loud
and recoverable (D16).

### 5.9 Chat

Preset-only, and **not an action**. `POST /api/chat { scope, scopeId, body }` is the single write; every
read rides one of the three polls. `body` is the roster line's text, server-validated against the
42-line table plus the 8 emoji ids — there is no free-text path anywhere in the app, by design. A line
renders as a balloon to the **left** of the sender's roster capsule for ~4 s and is appended to the
drawer's scrollable log.

---

## 6. HTTP surface

Offline play makes **no** network calls during a game: solo and pass-and-play run entirely client-side,
so Vercel serves static assets plus these routes only. Every handler validates with `zod` at the
boundary, sets `Cache-Control: no-store`, and never lets a schema or driver error escape unformatted.
Routes are `export const dynamic = "force-dynamic"`.

**Auth** is one cookie. `risk_sid = <playerId>.<secret>`, **httpOnly · Secure · SameSite=Lax ·
Path=/ · Max-Age 30 days**, value minted server-side (32 random bytes; `sha256(secret)` stored in
`players.secret_hash`). Every request splits the cookie and compares the hash in **constant time**.
That is the entire auth system: no passwords, no email, no library. `localStorage` holds only the
display name and colour, for first paint, and **never a secret**.

| Route | Method | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| `/api/session` | POST | — | `{ displayName }` | `200 { playerId, displayName, colour }` + `Set-Cookie: risk_sid` | `400` bad shape · **`409 { error:"nameTaken", suggestions: string[] }`** |
| `/api/session` | PATCH | cookie | `{ colour?, displayName? }` | `200 { playerId, displayName, colour }` | `401` no/stale cookie · `409` name taken |
| `/api/session` | DELETE | cookie | — | `204`, cookie cleared, name releasable | `401` |
| `/api/lobby` | GET | cookie | `?since=<version>` | **POLL 1** (below) | `204` when unchanged · `401` |
| `/api/lobbies` | POST | cookie | `{ title, mapSlug, rules, maxSeats }` | `201 { code }` | `400` · `401` · `409` already hosting |
| `/api/lobbies/:code` | GET | cookie | `?since=<version>` | **POLL 2** (below) | `204` unchanged · `401` · `404` |
| `/api/lobbies/:code` | PATCH | cookie, **host only** | `{ title?, mapSlug?, rules?, seats?: SeatPatch[] }` | `200` POLL 2 body at the new version | `400` · `401` · `403` not host · `404` · `409` game already started |
| `/api/lobbies/:code/join` | POST | cookie | `{ seat?: number }` | `200 { seat }` + POLL 2 body | `401` · `404` · `409 { error:"lobbyFull" \| "seatTaken" \| "alreadySeated" }` |
| `/api/lobbies/:code/leave` | POST | cookie | — | `204` (host hands off to the next human, or the lobby closes) | `401` · `404` |
| `/api/lobbies/:code/ready` | POST | cookie | `{ ready: boolean }` | `200` POLL 2 body | `401` · `404` | **[SPEC]** any seated player sets their own flag; the brief folded `ready` into the host-only PATCH, which cannot be right |
| `/api/lobbies/:code/start` | POST | cookie, **host only** | — | `201 { gameId }` | `401` · `403` · `409 { error:"needTwoSeats" \| "notAllReady" }` |
| `/api/games/:id` | GET | cookie | `?since=<seq>&chatSince=<id>`, `If-None-Match` | **POLL 3** (below) | **`204`** when `seq === since` · `401` · `403` not seated · `404` |
| `/api/games/:id/actions` | POST | cookie | `{ clientActionId, type, payload }` | `200 { seq, actions: [LoggedAction] }` | `400` · `401` · `403` not seated · **`409`** not your turn · **`422 { error, code: RuleErrorCode }`** rule violation · `404` |
| `/api/games/:id/resign` | POST | cookie | — | `200 { seq, actions: [SEAT_TO_BOT] }` | `401` · `403` · `404` · `409` already finished |
| `/api/chat` | POST | cookie | `{ scope: "global"\|"lobby"\|"game", scopeId, lineId?, emoji? }` | `201 { id }` | `400` unknown line/emoji · `401` · `403` not in that scope |
| `/api/health` | GET | — | — | `200 { ok: true }` after one `select 1` | `503` on a driver error |
| `/api/cron/sweep` | GET | Vercel cron | — | `200 { swept: {...} }` | `401` without the cron header |

**`SeatPatch`** (host-only, in `PATCH /api/lobbies/:code`): `{ seat, kind: "open"|"bot", tier?: BotTier }`
to add or remove a bot, or `{ seat, kind: "open" }` to kick the occupant.

Three poll endpoints, and **no fourth**: one per screen, each returning everything that screen shows.
Chat is never its own poll; presence is never its own request. `?since` is the screen's own cursor —
`lobbies.version` for polls 1 and 2, `games.seq` for poll 3 — and poll 3 additionally takes
`chatSince`, the client's last chat id.

```ts
// POLL 1 — GET /api/lobby?since=<version>
interface LobbyBrowse {
  version: number;
  players: { id: string; displayName: string; colour: PlayerColour; online: boolean }[];
  lobbies: { code: string; title: string; hostName: string; mapSlug: string;
             seatsTaken: number; maxSeats: number; status: "open" | "starting" }[];
  chat: ChatLine[];
  you: { playerId: string; displayName: string; colour: PlayerColour };
}

// POLL 2 — GET /api/lobbies/:code?since=<version>
interface LobbyRoom {
  version: number;
  code: string; title: string; hostId: string;
  status: "open" | "starting" | "playing" | "closed";
  mapSlug: string; rules: Rules; maxSeats: number;
  gameId: string | null;
  seats: { seat: number; kind: "open" | "human" | "bot"; playerId: string | null;
           displayName: string | null; colour: PlayerColour | null;
           tier: BotTier | null; ready: boolean; online: boolean }[];
  chat: ChatLine[];
}

// POLL 3 — GET /api/games/:id?since=<seq>&chatSince=<id>
//   seq === since            → 204 No Content, no body, ETag: W/"<seq>"
//   since >= snapshot_seq    → { seq, fromSeq, actions, ... }                       (delta)
//   0 < since < snapshot_seq → { seq, snapshot, snapshotSeq, actions, ... }          (compacted past)
//   since === 0              → { seq, snapshot, snapshotSeq, actions: [], ... }      (cold client)
interface GameSync {
  seq: number;
  fromSeq?: number;
  snapshot?: GameState;          // already fog-masked for the caller's seat
  snapshotSeq?: number;
  actions: LoggedAction[];
  presence: { seat: number; standing: Standing; online: boolean; missedTurns: number }[];
  turnDeadline: string | null;   // ISO 8601
  chat: ChatLine[];
  you: { seat: number | null; cards: Card[] };
  status: "playing" | "finished" | "abandoned";
}

interface ChatLine {
  id: number; scope: "global" | "lobby" | "game"; displayName: string;
  lineId: number | null; emoji: string | null; createdAt: string;
}
```

`ETag: W/"<seq>"` plus `If-None-Match` make the 204 path a string compare. **204-on-no-change is the
cost design and the correctness design at the same time**: a delta-returning poll co-binds Active CPU
with the invocation line at ~1.4 M polls, while a snapshot-returning poll binds first at 576 K (D12).
The snapshot is sent only to a cold client or one behind the compaction horizon, and it is **always the
caller's fog view**, never the authoritative state.

### 6.1 Identity rules

`POST /api/session` normalises (`btrim`, collapse internal whitespace,
`name_key = lower(name)`), then **conditionally and atomically reaps** a dead holder and inserts:

```sql
delete from players p
 where p.name_key = $1
   and p.last_seen_at < now() - interval '2 minutes'
   and not exists (select 1 from game_players gp join games g on g.id = gp.game_id
                    where gp.player_id = p.id and g.status = 'playing')
   and not exists (select 1 from lobby_seats ls where ls.player_id = p.id);

insert into players (id, display_name, name_key, secret_hash, color)
values ($1,$2,$3,$4,$5) on conflict (name_key) do nothing returning id;
```

Zero rows means the name is genuinely held by someone live → **409 with suggestions**, probed from
`name_key` by appending `-2`, `-3`, `_1944`-style suffixes until three are free. **Never silently
rename** — the player chose that name and should be told. A name is held only while its owner is live:
free **2 minutes** after they leave, unless they are seated in a lobby or a live game, in which case
they are never reaped. Validation (enforced by both `zod` and a database `check`): 2–20 characters
after trimming, `^[A-Za-z0-9][A-Za-z0-9 ._-]*$`; colour `^#[0-9A-Fa-f]{6}$`.

The generated default name is a **`<Adjective> <Noun> <NN>`** of our own wording — deliberately not
RGD's unverified "Lucius The Cruel 33" phrasing.

**Online-players list** (poll 1): `last_seen_at > now() - interval '5 minutes'`, flagged `online` when
`> now() - interval '45 seconds'`, `order by last_seen_at desc limit 100`; the same request stamps the
caller's heartbeat. A 45 s window against a ≤15 s poll means two missed polls before you look offline.

**Lobby codes** are four uppercase letters from the 24-letter alphabet **minus `I` and `O`** — short
enough to say in one breath and free of the pairs that get misheard — giving **24⁴ = 331,776** codes.
Generation retries on collision against the primary key.

### 6.2 Schema

`src/adapters/db/schema.sql` is the source of truth, idempotent, applied by `pnpm run db:push` inside
`vercel.json`'s build command and by the PGlite adapter on first boot; `scripts/build-schema.mjs`
regenerates `schema.ts` from it. S5 replaces the scaffold's `schema_meta` placeholder with:

```sql
players       (id text pk, display_name, name_key, secret_hash, color,
               created_at, last_seen_at)
  check char_length(btrim(display_name)) between 2 and 20
  check display_name ~ '^[A-Za-z0-9][A-Za-z0-9 ._-]*$'
  check color ~ '^#[0-9A-Fa-f]{6}$'
  unique index on (name_key) · index on (last_seen_at desc)
  -- presence is FOLDED IN, not a second table: an account whose whole lifetime is the
  -- session would give a presence row the same lifetime, one more write per poll and
  -- one more join per read

lobbies       (id text pk = the 4-letter code, host_id → players on delete cascade, title,
               status, map_id, max_seats, settings jsonb, game_id → games on delete set null,
               created_at, updated_at, version bigint)
  check status in ('open','starting','playing','closed') · check max_seats between 2 and 6
  check char_length(btrim(title)) between 1 and 40
  index on (status, updated_at desc)
  -- `version` is the ?since= cursor for polls 1 and 2

lobby_seats   (lobby_id → lobbies cascade, seat, kind, player_id → players on delete set null,
               bot_level, ready, joined_at)   primary key (lobby_id, seat)
  check seat between 0 and 5 · check kind in ('open','human','bot')
  check ((kind='human' and player_id is not null and bot_level is null)
      or (kind='bot'   and player_id is null     and bot_level is not null)
      or (kind='open'  and player_id is null     and bot_level is null))
  unique index on (lobby_id, player_id) where player_id is not null   -- one seat per player

games         (id text pk, lobby_id → lobbies on delete set null, map_id, rules jsonb,
               seed text,  -- SERVER-ONLY; off the GameState type entirely so the response
                           -- serialiser cannot reach it
               status, seq bigint, snapshot jsonb, snapshot_seq bigint, state_hash,
               current_seat, phase, turn_deadline, tick_lease, winner_seat,
               created_at, updated_at)
  check status in ('playing','finished','abandoned') · check current_seat between 0 and 5
  index on (status, updated_at desc)
  -- games.seq deliberately duplicates max(game_actions.seq): the poll's hot path is
  -- "has anything happened since n", and one indexed row answers it. Maintained inside
  -- the appending transaction, so it cannot drift.

game_players  (game_id → games cascade, seat, kind, player_id → players on delete set null,
               bot_level, display_name, color, standing, missed_turns, last_seen_at)
               primary key (game_id, seat)
  check kind in ('human','bot') · check standing in ('active','eliminated','resigned','away')
  check seat between 0 and 5
  index on (player_id) where player_id is not null
  -- display_name and color are denormalised so a finished game's scoreboard never
  -- becomes "(unknown)" after the temporary account expires

game_actions  (game_id → games cascade, seq bigint, seat, type, payload jsonb,
               actor, client_action_id, state_hash, created_at)
               primary key (game_id, seq)
  check actor in ('human','bot','server') · check seq > 0 · check seat between -1 and 5
  unique index on (game_id, client_action_id) where client_action_id is not null
  -- the idempotency fence: a retried POST hits this and becomes a no-op
  -- payload carries every server-rolled value (dice, the deal, a drawn card)

chat_messages (id bigserial pk, scope, scope_id, player_id → players on delete set null,
               display_name, line_id int, emoji text, created_at)
  check scope in ('global','lobby','game')
  check (line_id is not null) <> (emoji is not null)   -- exactly one of the two
  index on (scope, scope_id, id desc)
  -- no `body` column: there is no free-text path (D41). [SPEC] the brief's `body 1–300`
  -- column and `POST /api/chat { body }` are replaced by `line_id` / `emoji`; the server
  -- resolves the display text from the roster, so a client can never submit free text.
```

**Invariants** (asserted by the route tests): `game_actions(game_id, seq)` is contiguous from 1 with
no gaps and no reordering; `games.seq = max(game_actions.seq)`, maintained in the appending
transaction; `games.snapshot = fold(apply, initialState, actions[1..snapshot_seq])` and
`games.state_hash = hashState(games.snapshot)`; `game_actions.state_hash` is the hash **after**
applying that action.

`ids` are generated in application code (`nanoid`), never `gen_random_uuid()` — PGlite has no
pgcrypto.

### 6.3 The lazy reaper

Garbage collection rides the polls, once per ~60 s per process via a `globalThis` timestamp, with a
`limit` on every statement so no single request can be slow:

| Sweep | Rule |
|---|---|
| Stale lobbies | `status='open'` and `updated_at < now() - 20 min` → `closed` |
| Abandoned games | every human seat `last_seen_at < now() - 30 min` → `abandoned` |
| Old games | `status in ('finished','abandoned')` and `updated_at < now() - 7 days` → delete (cascades the log) |
| Dead players | `last_seen_at < now() - 24 h` and no live game or lobby seat → delete |
| Old chat | `created_at < now() - 7 days` → delete, `limit 500` |
| Snapshot compaction | when `seq - snapshot_seq > 50` → refold and rewrite `snapshot` |

The append path writes `snapshot_seq = seq + 1` every time, so compaction only ever has work after a
tick path that appended several actions under one lease — which is exactly the case the `since <
snapshot_seq` poll branch exists for. One daily Hobby cron (`/api/cron/sweep`, the unbounded version of
the same sweeps) is belt and braces for the week nobody visits.

### 6.4 Cost envelope

| Budget line | Free allowance | Option A consumes | Headroom |
|---|---|---|---|
| Vercel Function Invocations | 1,000,000 / mo | ~1,125 / player-hour (the adaptive mix) | ~900 player-hours/mo |
| Vercel Active CPU | **4 h / mo** (14.4 M CPU-ms) | ~5 ms per 204, ~10 ms per delta | ~1.4 M polls — co-binds with invocations |
| Vercel Provisioned Memory | 360 GB-hr (fixed 2 GB / 1 vCPU → 180 instance-hours) | negligible for short handlers | the argument against SSE |
| Vercel Fast Data Transfer | 100 GB / mo | ~1.5 KB / poll | ~66 M polls — never binds |
| Neon compute | **100 CU-hours / mo** = 400 awake-hours at 0.25 CU | awake only while someone polls | ~13.3 h/day |
| Neon storage | 1 GB | ~250 B / action row; 400–600 actions per 5-seat game | ~7,000 games |
| Neon egress | 5 GB / mo | ~1–2 KB / poll | ~2.5 M polls |

Invocations per player-hour = `3600 / interval`: 2 s → 1,800, 4 s → 900, 15 s → 240. In a 4-seat game
you are on your own turn ~25% of the time, so `0.25·1800 + 0.75·900 ≈ 1,125`. **20 players online
24/7 does not fit** (21× over, and no interval fixes it); **20 players for an hour a day fits with 34%
headroom**; 90 minutes a day sits exactly at the line. Neon's scale-to-zero after 5 min idle is fixed
and cannot be disabled on Free; it reactivates in a few hundred milliseconds, the cold start lands on
the first person through the door (fixed in the UI by rendering the lobby shell immediately), and it
never lands mid-game because a 2–4 s poll is far inside the window.

---

## 7. Screens

All UI strings below in `code` are **verbatim from the original** and must be kept word-for-word.
Geometry is measured at 1600×900 and is **proportions, not a redline** — ±8 px except the green
primary button (238×48) and the phase-pip row, which are measured.

| Route | Screen | Owner |
|---|---|---|
| — | **Identity sheet** on first arrival: a generated `<Adjective> <Noun> <NN>` name prefilled, editable (2–20 chars), nine colour swatches, `Continue`. Claims via `POST /api/session`; a 409 shows the three suggestions inline. Shown once, re-openable from Settings. | S4 shell, S5 claim |
| `/` | **Home**: dark teal-navy field with a faintly ghosted world map, radial sunburst behind a gold-framed circular avatar, name + colour chip below, and the huge green `BATTLE` pill (~290×72) that leads to `/new`. No shop, no news, no rank. | S4 |
| `/new` | **Select a game type**: three cards in one row (RGD shows five; `Basic Training` and `Ranked 1v1` are out of scope), each ≈230×445, radius 10, gradient `--chrome-600 → --chrome-650`, 2 px `--chrome-line` border, a flat monochrome glyph in the top ~45%, title 30 px, description 22 px in `#E2EAEE`, a `?` info circle top-right. Selected: olive-green fill, glowing border, sparkle behind the glyph, green ✓ (r 34) straddling the bottom edge. Cards: **Solo** (person glyph, "Battle the AI"), **Pass & Play** (screen glyph, "Local, one shared device"), **Online** (globe glyph, "Casual games with other players"). Footer: the segmented `FFA | 1v1` toggle (dark `#242424` track, 270×56, radius 28, active segment `--cyan`) and the green `BATTLE` pill. | S4 |
| `/new/map` | **Map picker**: a grid of ~8:7 tiles — name 40 px with a 4 px dark outline at ~9% of tile height, then the board rendered on a translucent blue glass tray tilted ~30° back and ~6° yawed with a soft elliptical contact shadow (land parchment `#F3DCC0`, coasts `#B8894A` 3 px, internal borders `#9AA0A4` 1.5 px, continent perimeters 2.5 px in the accent, white dotted sea routes), then a 26 px tagline at ~85–95%. Background is a pale-blue radial ray burst fading to `#0E2430`. **No locked tiles — every map is free.** Green `Next`. | S4 |
| `/new/rules` | **`Modes and Modifiers`**: the chosen map as a 3D tilted hero with a player-count chip (`3/6`) overlapping its bottom edge and a red mode plate (gradient `#D8415C → #A3203A`, radius 8, 34 px) with a dark `CUSTOM` sub-chip. The rules readout is three centred `**Label:** value` lines, labels bold white, values `#CBD6DB` 26 px, 40 px apart, **no boxes**: `Setup: Auto` · `Turn Timer: 60s` · `AI Difficulty: Expert` · `Card Bonus: Fixed` · `Dice Rolls: Balanced Blitz` · `Alliances: Off`. A right-hand vertical stack of 68×68 radius-18 icon toggles with labels beneath — `Blizzards` ❄ · `Fog of War` ? · `Portals` · `Capitals` · `Percentage Domination` · `Manual Placement` · `Max Rounds` · `Round Delay` — enabled = `--danger` + white glyph, off = desaturated grey-blue with a `#6E7F88` label. A `Modifiers` button at the bottom opens the per-seat panel: seat rows (human/bot, name, colour, `AI Difficulty`), the `% Domination` slider (50–90, default 70), the `Max Rounds` stepper (preset 5 labelled `5-Rounds Rumble`), `Turn Timer` (60/90/120/180/300, online only, default 90), `Round Delay`. Green `BATTLE`. | S4 |
| `/lobby` | **Online lobby browser**: the online-players column (avatar, name, a green dot when `online`), the open-lobbies list (title, host, map, `2/6`, `Join`), a global chat column, `Create` and a four-letter code entry field. Renders its shell immediately so Neon's cold start is invisible. Poll 1 at 5 s. | S5 |
| `/lobby/[code]` | **Lobby room**: six seat rows, each `open` / a human (avatar, name, colour, online dot, ready tick) / a bot (robot chip, tier). Host-only controls: title, map, rules, add or remove a bot, kick, and the code itself shown large for reading aloud. Everyone gets `I'M READY` and the lobby chat column. **No ready-check timer** — RGD's 10-second check is a source of complaints **[ours]**. Host `BATTLE` is enabled at ≥2 occupied seats and all ready. Poll 2 at 5 s. | S5 |
| `/play/solo` · `/play/pass-and-play` | **Game**, offline. Identical screen; Pass & Play adds `HandOffOverlay`. | S4 |
| `/play/online/[gameId]` | **Game**, online. The same screen with `SyncPort` wired, the turn-timer bar live, presence dots on roster rows, and the chat drawer enabled. | S5 |
| — | **Victory / Defeat**, a full-screen overlay on the game route. | S4 |

### 7.1 Game HUD anatomy

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

- **Top-left utility**: three circular outline-only buttons — ⚙ settings, ? help, 🎲 dice settings — centres (52,52) / (130,52) / (210,52), pitch 78 px, r ≈ 22, **3 px white stroke, no fill**. Online adds a connection glyph at x ≈ 315.
- **Title pill**: centred, y 20–62, auto width, `rgba(14,42,51,.72)`, radius 10, padding 10/26, bold white 30 px with a dark outline.
- **Player roster — on the RIGHT EDGE, not a top bar, each capsule bleeding off the right side.** *This is the defining layout choice.* Stack x 1395 → 1600+ (clipped), first row centre y ≈ 265 at four seats, **row pitch ≈ 125, row height ≈ 96**, capsule radius = height/2, body `rgba(14,18,20,.80)` with a **2 px owner-colour stroke**. The active seat's capsule is **filled** with the owner colour, extends ~40 px further left, and carries a white chevron tab off the right edge. Row anatomy: troop silhouette 22 px + count 28 px; map-pin 22 px + count 28 px; a tilted cream card tag ≈30×38 rotated **−12°** overlapping the avatar's top-left; avatar disc r ≈ 38 — gold laurel wreath plus a `YOU` pill for the viewer, a robot-glyph chip for a bot, a dark disc with a white **skull** when eliminated. Under Fog of War both counts read `???`. Chat balloons pop out to the **left** of a row.
- **Bottom action bar**, band y 770–900: avatar disc centre (575, 815) r ≈ 55; phase label (`DRAFT` / `ATTACK` / `FORTIFY`, and `CAPITAL` in Capitals mode) in letter-spaced caps, 28 px, ~3 px tracking, baseline y ≈ 790; **three phase pips** y 795–807, segments **92×12, radius 6, gap 12**, total width ≈ 300 centred on x 800, active white, inactive `#6B7378` — a progress bar, not tabs; the **primary green pill x 680–918, y 822–870 = 238×48**, gradient `--go → --go-mid`, 3 px `--go-deep` border, a 2 px lighter inner top highlight, `0 4px 0 --go-bezel` bezel, label bold white ~24 px with a 3 px dark outline (`End Attack Phase` · `End Turn` · `Trade In Now +10` · `BATTLE` · disabled `No Matching Cards` / `Opponent's Turn` in flat `--disabled` with a `--disabled-line` border); a circular dice/mode button centre (995, 812) r ≈ 58. Online only: a **4 px turn-timer bar** under the phase label draining left→right, `--cyan` → `--danger` with a 1 Hz pulse under 10 s (invention — no ring exists anywhere in the evidence).
- **Bottom-left stack**: Stats 90×90 radius 16 on the grey `--tray` gradient with a gold bar-chart, centre (80, 675); **Cards chip** ≈95×112 rotated **−8°** carrying the held count with a red badge when a trade is available, centre (85, 820); Emote/chat 90×90 with a speaking-head glyph and a red unread badge, centre (215, 818).
- **Continent Overlay toolbar** (overlay mode only): vertical dark-teal capsule x 45–145, y 365–700, radius 50, three stacked **44 px** toggles (troop view / globe overlay / player view), active one gold `#E8C43A`; below it a detached 90×100 radius-18 grey tray holding a red circular close ✗ (r 34, `--danger` with a `--danger-deep` rim).

### 7.2 Dialogs and overlays

| Dialog | Spec |
|---|---|
| **Count slider** (`Deploy Troops` / `Fortify Troops` / `Move Troops`) | Full-width dark strip y 600–738 (h 138), `rgba(10,45,55,.55)`. Red ✗ at (480, 668) r 40 (`#E04A5C → #C42B3E`, 4 px `#8E1F2C` rim, 6 px bezel); green ✓ at (1122, 668) r 40 (`--go → #7AB53F`, `--go-deep` rim). Numerals at x 553/678/800/925/1050, bold `#C9CFD2` ~52 px fading to `--text-dim` with distance; the selected value sits inside the **notched ring** — outer r ≈ 55, stroke ≈ 16, `#E2455A`, with a downward triangular notch cut into the bottom — numeral white with a 4 px dark outline. Horizontally draggable; numerals scroll through. `Move All` jumps to max **[ours]**. |
| **Dice / Blitz popup** | A **full-screen takeover**, not a box. Attacker disc (230, 200) r 150, gold laurel ring if it is you; a flag chip r 36 at 7 o'clock carrying the committed count. Defender disc (1400, 230) mirrored, robot chip for a bot. `Blitz Win Chance ?` centred y ≈ 42, 30 px; the percentage y ≈ 92 in **constant gold `--gold`** ~44 px. Three 3D rounded-cube dice ~150 px per face, body `#E02030` lit / `#B01525` shaded, cream `#F5F0E8` pips, on a white radial burst, y 540–840. Blocky ◀ ▶ steppers ≈60×75 at (620, 775) and (975, 775) in `#C8233A`, cycling `Blitz` ↔ 1/2/3 dice; the `Blitz` label y ≈ 855, 34 px. Bottom-right: `100%` 40 px over `7/7 Troops` 24 px, and the **Attack Limit** slider — track x 1215–1475, y 790, h ≈ 14 fully rounded, unfilled `#8E1F2C`, filled `#D9344A`, knob r ≈ 24 with a white soldier glyph, label `Attack Limit ?` 20 px. The board is scrimmed except the two combatants, which keep white outlines and show up to three 3D troop figurines on pedestals. |
| **Manual dice roll** | The same dice thrown **onto the board** at the contested border, tumbling then settling face-up. |
| **Card-trade panel** | Board scrim `--scrim-heavy`; red ✗ on a grey tray at (75, 512). A shallow fan across y 110–430 of **175×320** cards (aspect ≈0.55, radius 18, `--paper` with a 4 px `--paper-edge` inset rule, ±4–6° alternating rotation with the middle card upright, ~20 px overlap, `--sh-card`). Suit art in the top ~45%, owner-tinted territory silhouette in the lower ~35%, name bold white ~30 px with a 4 px outline. Selected: `translateY(-14px)` plus a **white dashed border 8 px outside** (dash ≈14/10, 4 px). Bonus legend panel x 1320–1565, y 150–490, `--chrome-800` at 92%, radius 12, 2 px `#243640` stroke, a red `Bonus` header pill (radius 10, 26 px) and four rows — `4 Infantry` · `6 Cavalry` · `8 Artillery` · `10 All Three` — number 34 px left, label `#D4DBDF` 26 px right, the matching row ringed by the notched red ring. Green `Trade In Now +10` pill ≈530×58 at (795, 530). **A forced trade is the same panel with the ✗ removed.** |
| **End-turn confirmation** | A full-width **amber banner sliding down from the top**, y 0–440, rounded bottom corners r 20, gradient `--amber-top → --amber-bottom`, 4 px `--amber-border`. Title `End Turn` y ≈ 75, 58 px; body `Skip Fortify phase?` in `--text-on-amber` 34 px; sub-note `(This confirmation can be turned off in game settings)` 22 px. Two circular buttons at y ≈ 338, r 54, 200 px apart: ✗ `--danger`/`--danger-deep`, ✓ `--ok`/`--ok-deep`, 6 px bezel. |
| **`Get Ready`** | Scrimmed board, owner-coloured radial sunburst, laurel-ringed portrait, name plate pill. Title y ≈ 118, 56 px. Line 1 white 36 px with a filled colour disc before the colour word: *"You are **player 2** – General of the ● **Red** Troops"*. Line 2 `#C6D2D8` 24 px: *"Each turn you will DRAFT > ATTACK > FORTIFY."* |
| **`Received Troops`** (the card-trade variant of the same popup is titled **`Troop Bonus!`**; the +2 variant **`Territory Card Bonus!`**) | Owner-coloured turn banner across the top, h ≈ 78, rounded bottom corners, 34 px. Header pill at y 212–270, owner-coloured, ≈840 wide, 36 px. The notched ring at (800, 383), outer r 62, stroke 14, number white 60 px; caption `Total troops` `#C9D4D8` 24 px; then the award line 32 px: *"Troops awarded for occupying **10 territories**"*. |
| **Continent-bonus legend** | Per continent, at its centroid: a **radial donut progress ring**, outer r ≈ 36, thickness ≈ 7, dark track `rgba(0,0,0,.55)`, white arc **from 12 o'clock clockwise** (North America 3/9 → a 33% arc), `+N` inside in 30 px, a dark name plate below (radius 8, 2 px light stroke, padding 4/14, 22 px), caption `3/9 (33%)` in `--text-muted` 16 px. |
| **Elimination / seizure** (banner title **`Territory Cards Seized!`**) | The roster row flips to a dark disc with a white skull and desaturates over 400 ms with a brief grey flash; seized cards fly to the attacker's card chip on an 80 ms stagger with a `+2`. No full-screen "Defeated!" frame exists in the evidence, so **`Defeated!` mirrors Victory with a desaturated portrait**. |
| **`Victory!`** | The board entirely the winner's colour behind. Title centred y ≈ 95, 56 px with a 5 px outline; laurel-ringed portrait at (800, 420) r 150; **~24 white five-pointed stars** fanning over ~240° at 20–60 px; name plate pill ≈620×60 radius 30 with the name at 36 px; subtitle *"You conquered all your opponents!"* in `#D6DEE2` 30 px at y ≈ 790. A Max-Rounds win adds the tiebreak line (*"Most territories at the end of round 5"*). |
| **Tip card** | Top banner `--chrome-900`-ish `#203A5F`, y 0–240, bottom corners r 24; card x 570–1480, y 330–760, radius 30, gradient `#304064 → #103059` with a broad specular sheen across the upper third; a cyan shield badge ≈70×80 at the card's left; body copy bold white 54 px with a 4 px outline, two lines max. Modal, dismiss-on-tap. **There is no small corner toast anywhere in the evidence** — never add one. |
| **Hand-off overlay** | **[ours]** Full-screen, opaque, owner-colour-tinted, `data-testid="handoff-overlay"`, `role="dialog" aria-modal="true"`: *"Pass the device to"* over the seat name, and a `CONTINUE` button. Purely presentational: it never dismisses itself and never touches game state (§5.4). |
| **Settings** | A modal, not a route, from the ⚙ button on any in-game screen, reading and writing `SettingsPort`: **Camera Animations**, **Phase Change Animations**, **End Phase Confirmation** (all default on — their existence in the original proves the default experience has a camera pan, an animated phase transition and an end-phase confirm), Sound, Music, **Colour-vision patterns**, **Win-chance colour ramp**, plus `Change display name` and the resign/leave actions. |

### 7.3 Chat drawer and the dialog roster

A **left drawer** ≈22 %W, full height, `rgba(20,24,28,.88)`, `--z-modal`. Top row: own avatar in a gold
frame, a channel pill `ALL` (grey `#B9B6B0`, radius 20), a chat-bubble button. Then a **3×3 grid of
emoji tiles**, each ≈78×60, radius 10, the **9th slot `…`**; then the roster as full-width light pills
`--paper`-adjacent `#DFE3E6`, h ≈ 46, radius 23, dark centred text, grouped by category and
scrollable; then the scrollable log, with system notices as plain light text in the same column
(precedent: *"The host has deactivated alliances for this game. No private chat allowed."*).

**Emoji set [ours]** — eight code-drawn SVG glyphs, none of the original's paid sticker art:
👍 · 😄 · 😮 · 😤 · 😢 · 🤝 · ⚔️ · 🏳️, with the ninth slot reserved for `…`.

**The 42 lines, verbatim, grouped as published.** Lines **28** and **29** are **ally-only** and are
offered only while an alliance is active; the rest are lobby-wide. Five lines are RGD-verbatim and must
never be reworded: 20, 21, 28, 29, 34.

*Greetings* — 1 `Hello!` · 2 `Good luck, everyone!` · 3 `Let's have a good game.` ·
4 `Ready when you are.` · 5 `Back again — let's go!`

*Diplomacy (truce / alliance)* — 6 `Truce?` · 7 `Alliance? Let's team up.` ·
8 `I won't attack you this turn — deal?` · 9 `Let's take down the leader together.` ·
10 `Your border is safe with me... for now.` · 11 `Can we talk strategy?` ·
12 `I'll trade you intel for safety.`

*Threats / taunts* — 13 `Your territory looks... undefended.` · 14 `I'm coming for that continent.` ·
15 `This is my land now.` · 16 `You should have fortified that.` · 17 `Nowhere left to run.` ·
18 `I'm going to win this.` · 19 `Big mistake leaving that border open.`

*Reactions (combat / dice)* — 20 `NO DICE!` *(RGD-verbatim)* · 21 `THE DICE HATE ME!`
*(RGD-verbatim, legacy alt)* · 22 `Nice move.` · 23 `Didn't see that coming.` · 24 `Lucky roll.` ·
25 `That hurt.` · 26 `Not bad, not bad.` · 27 `Ouch.`

*Apologies / appeasement* — 28 `Sorry, I need to attack your territory.` *(RGD-verbatim, ally-only)* ·
29 `Attack my territory if you need to.` *(RGD-verbatim, ally-only)* · 30 `My bad.` ·
31 `Nothing personal.` · 32 `I had no choice.`

*Encouragement / banter* — 33 `Thanks!` · 34 `Great game.` *(RGD-verbatim)* · 35 `Nice try.` ·
36 `Respect.` · 37 `You're tougher than you look.`

*Endgame* — 38 `GG!` · 39 `Well played.` · 40 `Down but not out.` · 41 `I'll be back.` ·
42 `Good game, see you next time.`

Presentation: a balloon to the **left** of the sender's roster capsule, scale 0.6→1.06→1 over 240 ms
back-out, auto-dismissed after ~4 s with a 200 ms fade, and appended to the log. **Bots may fire a
small number of reaction lines** on events (losing a territory, a terrible roll, elimination) as
cosmetic flavour, flagged as our addition. There is **no free-text path anywhere in the app**.

### 7.4 Prompts

Verbatim, shown in the action bar's prompt line per phase: *"Tap any of your territories to begin
deploying troops"* · *"Select an adjacent territory to attack"* · *"Select a territory to move your
troops from"* · *"You must draft all of your available troops during your draft phase"*.

---

## 8. Visual design

A **flat-shaded, chunky, extruded "board game on a glass tray"**: hard-edged vector landmasses with
near-black outlines raised a few millimetres above a bright cyan ocean, lit from directly above, no
textures and no gradients inside the land, under a heavy cartoon-UI chrome of glossy pill buttons and
circular discs. Not painterly, and only nominally low-poly — the polygons are in the silhouette, not
the shading. **No original assets are used or required**: everything is geometry, colour, type and
motion in SVG and CSS.

**Tokens.** `src/app/globals.css` *(scaffold)* already defines every value as a CSS custom property;
reference them by name and never hard-code a hex in a component. Board: `--ocean --ocean-deep
--ocean-glow --ocean-line --land-neutral --land-outline --land-wall --sea-route`. Chrome: `--chrome-900
--chrome-800 --chrome-700 --chrome-600 --chrome-650 --chrome-line --tray --scrim --scrim-heavy`.
Semantic: `--go --go-mid --go-deep --go-bezel --danger --danger-deep --ok --ok-deep --gold --cyan
--amber-top --amber-bottom --amber-border --brand-red --disabled --disabled-line`. Paper: `--paper
--paper-edge --suit`. Text: `--text --text-muted --text-dim --text-on-amber --text-on-paper
--stroke-dark`. Continents: `--c-na/-fill --c-sa/-fill --c-eu/-fill --c-af/-fill --c-as/-fill
--c-au/-fill`. Plus `--r-*` radii, `--sh-*`/`--bezel-*` shadows, `--fw-*`/`--ts-*` type, `--s-1…8`
spacing (4 px base), and the `--z-*` layer scale (ocean 0, land 10, routes 20, highlight 30, arrow 40,
tokens 50, labels 60, floaters 70, hud 100, scrim 200, modal 210, banner 220, tip 230, toast 240).
Fonts are wired in `layout.tsx` *(scaffold)*: **Titillium Web 600/700/900** as `--font-head`, **Barlow
400/500/600/700** as `--font-body`, both via `next/font/google` so there is no runtime request.

**Player colours** — nine, all free, six seats maximum. Each has six variants already in `globals.css`:
`--p-<name>` (token face), `-light` (face highlight), `-dark` (land top face), `-wall` (extrusion /
rim), `-hot` (selected), `-on` (text on the colour).

| Colour | token | land | selected |
|---|---|---|---|
| red | `#D93244` | `#A8293A` | `#F4001A` |
| green | `#8FC94F` | `#4A7A3C` | `#5FE800` |
| blue | `#4DABF1` | `#3A7FB5` | `#009BFF` |
| yellow | `#E0B52E` | `#B59525` | `#FFC800` |
| orange | `#E7773D` | `#B5652C` | `#FF6A00` |
| pink | `#D139AD` | `#9B2A80` | `#FF00C8` |
| black | `#3D3D3D` | `#2B2B2D` | `#000000` |
| white | `#D3D4D4` | `#B4B7BA` | `#FFFFFF` |
| purple | `#7B3FE0` | `#4A2A86` | `#4A00E9` |

**Colour-vision overlay.** Red/pink and green/yellow are the risky pairs. The `colourPatterns` setting
adds a per-seat SVG `<pattern>` fill overlay — dots / diagonal / cross-hatch at **12% white** — over
each owner's territories. The blizzard hatching already establishes the style.

**How to draw the map.** *One `<path>` per territory, one CSS variable per owner. That is the whole
architecture.* Layer order inside one `<svg viewBox="0 0 W H" preserveAspectRatio="xMidYMid meet">`:

1. flat `--ocean` `<rect>` (**a flat fill, never a gradient** — under 3% variance over 120 px);
2. the line-net `<rect>` filled with `<pattern id="net" width="600" height="600">` — 1 px strokes at
   `--ocean-line` (white 8–12%), segments 400–900 px, ~25–40 per screen. **No animated waves, no grid.**
3. the **land-union** path under `filter="url(#coast)"` — `feGaussianBlur stdDeviation="14"` on
   `SourceAlpha`, `feFlood flood-color="#7FE3FF" flood-opacity=".75"`, `feComposite operator="in"` —
   the coastal halo, bleeding ~20–40 px, drawn **under** the land;
4. the same union again at `transform="translate(0,7)"` filled `--land-wall` — the fake slab;
5. `<g class="territories" filter="url(#relief)">`, one `<path>` per territory. The relief filter is a
   soft top-left inner highlight plus a bottom-right inner shadow and nothing else:
   `feOffset dy="-3"` → `feGaussianBlur stdDeviation="3"` → `feComposite operator="out"` vs
   `SourceAlpha` → `feFlood #fff opacity .30` → `feComposite in2 operator="in"`, then the mirror with
   `dy="4"`, `stdDeviation="4"`, `#000` at `.42`, then `feMerge` of `SourceGraphic`, highlight, shadow;
6. `<g class="continent-rings">` — the perimeter glow of any continent a seat fully holds, and every
   continent in overlay mode;
7. `<g class="routes" stroke="var(--sea-route)" stroke-width="4" stroke-dasharray="14 12"
   stroke-linecap="round">` plus `<circle r="7" fill="#fff">` nodes;
8. the vignette `<rect fill="url(#vignette)" pointer-events="none">` — a radial toward `#02161E` at 85%
   from 55% out, darkening the outer ~20% of the frame.

```css
.territory { fill: var(--p-dark); stroke: var(--land-outline); stroke-width: 3;
             stroke-linejoin: round; transition: fill 240ms ease-out; cursor: pointer; }
.territory[data-owner="green"] { --p: var(--p-green); --p-dark: var(--p-green-dark);
                                 --p-hot: var(--p-green-hot); }           /* one rule per colour */
.territory[data-owner="none"]  { --p-dark: var(--land-neutral); }
.territory[data-state="selected"], .territory[data-state="target"] {
  fill: var(--p-hot); stroke: #fff; stroke-width: 4;
  filter: drop-shadow(0 0 10px rgba(255,255,255,.75)); }
.territory[data-state="dimmed"] { filter: brightness(.45) saturate(.6); }

#board            { transform: perspective(1400px) rotateX(4deg); transform-origin: 50% 55%; }
#board[data-view="battle"] { transform: perspective(1400px) rotateX(18deg) scale(2.2); }
```

**Land is filled per OWNER, not per continent** — the single most important finding, and it contradicts
the board game. Continent identity appears only in the Continent Overlay and as a perimeter glow on a
continent you fully hold. Off-board land is `--land-neutral`. Coastlines read 12–14 px near-black and
internal borders 4–7 px; both come from the 3 px per-territory stroke plus the +7 px union offset, not
from thicker strokes. **Keep the `d` strings chunky — 12–30 vertices per territory** with visibly
straight runs and angular corners; real coastlines look wrong. **The camera is this one `transform`
and nothing else: no real 3D.**

**Tokens and labels are HTML above the SVG, not SVG children**, so they do not inherit the `rotateX`
skew, they use normal text rendering and `-webkit-text-stroke`, and they are animatable and
accessible. Each territory carries two precomputed anchors — a **token** point and a **label** point
~26 px below it — both the **pole of inaccessibility** (`polylabel`), never the bbox centre. Position
with `translate3d`. Labels: `--font-head` 700, 19–22 px, white, 3 px dark stroke,
`text-shadow: 0 2px 2px rgba(0,0,0,.6)`, `nowrap`, `pointer-events: none`, **hidden when the
territory's on-screen area is under ~2,500 px²**. There is **no collision avoidance** — labels spill
onto the ocean and overlap neighbours, exactly as the original does.

**Troop token.** A flat circular poker chip seen from ~10° above, drawn in a 48×56 viewBox with
**r = 19** at 1600×900 on Classic (≈2.4% of frame width) and r = 15 on a dense map — **a fixed
screen-space size per map; it does not scale with the territory**. Body: a `--p-dark` circle at
`cy=29`; face: a circle at `cy=24` filled by a radial `--p-light → --p` with a 2 px `--p-wall` stroke;
a `#fff` specular `<ellipse rx="12" ry="4.5"` at 16%; `--sh-token` via `feDropShadow dy="3"
stdDeviation="2.5"`. **The fill is the owner's bright token value, noticeably lighter than the land it
sits on** (green token `#8FC94F` on green land `#4A7A3C`) — *this two-value system is what makes the
tokens pop.* Numerals: `--font-head` 900, white, **3 px near-black outline** via `paint-order: stroke
fill`, `tabular-nums` so a 1 and a 7 fill the same disc, cap height ≈0.62× the diameter at one digit
and ≈0.52× at two, never below 0.42×. At three digits swap the circles for `<rect rx="19">` with
`width = 38 + 11·(digits − 1)` so it reads as a stadium.

Token states: idle · actionable (a soft owner glow on the territory) · **selected** (fill jumps to
`--p-hot`, a 3 px pure-white outline follows the path, an outer glow — the token itself unchanged) ·
legal target (lit while non-participants darken) · battle (both keep white outlines, everything else
heavily scrimmed, tokens replaced by 3D figurines) · just conquered (a floating `−1`/`−4` rises, then
the fill wipes to the new owner) · fog (`?` on the token, `???` in the roster).

**Card.** 175×320, radius 18, `--paper` under a radial `#FBF2DF → --paper` sunburst, a 7 px-inset 3 px
`--paper-edge` rule, `--sh-card` via `feDropShadow dy="10" stdDeviation="9"`, 16 faint `#A98C52` wedges
at 8% behind the suit. Suit glyphs as flat `--suit` silhouettes: **Infantry** a standing rifleman with
a shouldered musket, **Cavalry** a rearing horse and rider, **Artillery** a two-wheeled field cannon,
**Wild** all three overlapping. The territory silhouette below is tinted by the **current owner**.

**Attack arrow**: one white solid gently-curved arrow, ~8 px tapering, 22 px triangular head, 1.5 px
dark outline, a quadratic Bézier with the control point offset ~22% of the chord perpendicular; above
the figurines, below the dice popup. **Fortify path** is deliberately different: discrete white
chevrons `›` ≈22×26, 7 px stroke, 34 px pitch, along a spline through the connected chain, animated
source→destination on a 900 ms loop.

**Blitz win chance is constant gold `--gold` at every probability** — it was sampled at 100, 100, 99,
99, 91, 46 and 6 percent and never changed; only the number does. The opt-in `winChanceRamp` setting,
clearly flagged as a usability deviation, applies `≥90% --ok · 70–89% #C6D84A · 40–69% --gold ·
15–39% #E8863A · <15% --danger`.

**Motion** — 25 entries; **every duration and easing is a recommendation** (the evidence is stills
only). Turn-start banner in 320 ms `cubic-bezier(.16,1,.3,1)`, hold 1200 ms, out 240 ms · received-troops
ring 0.7→1 over 260 ms back-out with a 500 ms number tick · phase pip 220 ms ease-out, label cross-fade
160 ms · camera pan+zoom+tilt 420 ms `cubic-bezier(.22,.61,.36,1)` · arrow draw-on 260 ms then a 120 ms
head pop · dice tumble: 3 dice staggered 60 ms, 900 ms `rotate3d` with decreasing amplitude, 140 ms
settle bounce, one-frame white flash · **Blitz resolve 90 ms per round, 12 rounds visible maximum, then
jump to the result** · troop tick `min(600, 80·Δ)` ms with a 1.15× disc pulse over 180 ms · damage
numeral `translateY(-40px)` + fade over 700 ms in `#FF4D5F` · capture: a radial colour wipe 380 ms, a
180 ms white flash at 35%, then the token swaps · continent glow 0→1→0.6 over 500 ms plus one outward
ring pulse · fortify chevrons 900 ms linear loop · card award 520 ms then 300 ms into the chip · card
select `translateY(-14px)` 160 ms back-out plus a 1.2 s dash loop · cards seized 80 ms stagger × 420 ms
along an arc · elimination 400 ms desaturate · chat balloon 240 ms back-out, 3.5 s hold, 200 ms fade ·
bot "thinking" `…` 1.2 s loop, 0.15 s stagger · turn-timer bar linear with a 1 Hz pulse under 10 s ·
modal scrim 180 ms in / 140 ms out · amber banner 280 ms with buttons staggered 60 ms · victory stars
fan over 900 ms staggered 25 ms then rotate for 8 s · menu card select 200 ms cross-fade plus a 260 ms
✓ pop · button press scale 0.96 with the bezel collapsing 4→1 px over 90 ms · optional ocean-net drift
2 px over 20 s. **`prefers-reduced-motion`** keeps the phase pip, troop tick and capture wipe as
instant state changes and drops the dice tumble, victory burst and ocean drift; `globals.css` already
carries the blanket duration override.

**Responsive.** Landscape-first — every one of the 304 reference frames is landscape — and it is one
design scaled, with the HUD anchored to the four edges by percentage: utility icons fixed 44 px circles
with a 16 px gutter; title pill auto; roster 13 %W with rows `clamp(64px, 10.7vh, 104px)`; icon stack
72–90 px squares; action button `clamp(180px, 15vw, 280px)` × 48 px. **< 820 px** (phone landscape):
roster rows drop the territory line and keep avatar + troop count at 56 px, title pill 22 px, utility
icons 36 px, the icon stack goes horizontal. **820–1280 px**: full roster, token r 15. **≥ 1280 px**:
the reference layout. **≥ 1700 px**: reveal cards-held as a number. Above **1920 px** cap the HUD scale
and let the map take the extra area. **Portrait** has no evidence anywhere and is entirely our design:
do **not** rotate the map — scale it to fit the width and fill the bands above and below with HUD; the
roster becomes a horizontal strip of compact owner chips at the top (scrollable past four seats, the
active chip filled and widened); the action bar stays full-width at the bottom with the phase label and
pips above the button; the icon stack becomes one row immediately above it; modals become full-width
sheets, the card fan a horizontal scroller, and the Blitz view stacks attacker above defender. Offer a
dismissible "rotate for the best view" hint on first portrait load.

**Icons** are flat, monochrome, chunky rounded silhouettes with no internal detail and no outlines —
person, robot, globe, soldier, map-pin, tank, die, speaking head, bar-chart, snowflake, stopwatch,
skull — on two chassis: a **circle** for board actions and dialog ✗/✓, and a **rounded-square grey
`--tray`** for utilities, radius ≈20% of the box.

---

## 9. Controls

| Action | Mouse / touch | Keyboard |
|---|---|---|
| Select one of your territories | Click / tap the path | `Tab` cycles your territories, `Enter` selects |
| Draft troops | Tap an own territory → the count slider opens → drag or tap a numeral → ✓ | `1` `5` `0` set 1 / 5 / max; `Enter` confirms, `Esc` cancels |
| Choose an attack | Tap your source, then tap a lit adjacent target | arrows move the target among `legalAttackTargets`, `Enter` opens the Blitz view |
| Pick Blitz or a dice count | The ◀ ▶ steppers in the Blitz view | `←` `→` |
| Set the Attack Limiter | Drag the bottom-right slider knob | `-` / `+` |
| Commit | The green `BATTLE` pill | `Enter` |
| Move in after a conquest | The count slider, minimum = dice used; `Move All` jumps to max | `Enter` = min, `A` = all |
| Fortify | Tap your source, tap a reachable own territory, slider, ✓ | as Draft |
| End phase / end turn | The green primary pill | `Space` |
| Open cards | The bottom-left Cards chip | `C` |
| Continent Overlay | The overlay toolbar's globe toggle | `O` cycles troops → continents → players → off |
| Chat drawer | The emote button | `T` |
| Settings / help | The ⚙ / ? buttons | `Esc` closes any modal |
| **Pan** | Drag anywhere on the board | `←→↑↓` / `WASD` |
| **Zoom** | Wheel, or two-finger pinch | `+` / `-`, `0` resets |
| Hand-off | `CONTINUE` | `Enter` |

Touch and mouse share one path in `src/game/input.ts`: a pointer event hit-tests the SVG to a
`TerritoryId` (`document.elementFromPoint` on the `.territory` paths, inverse-transformed through the
camera), and a drag beyond 8 px becomes a pan rather than a tap. Pinch and wheel both change one
`camera.scale`; the map is clamped so it always covers the viewport. Every interactive control is at
least a 44 px touch target. Keyboard shortcuts are **additive and never required** — mobile has none
of them — and the three steppers/sliders exist because the original's own placement widget is a
stepper or slider, never free-text entry.

---

## 10. Efficiency plan

**Odds table init.** `createOdds` builds the True Random `W[A][D]` tables eagerly: 129×129 per
augment as a `Float32Array` (65 KiB each; measured 2.07 ms / 80 KiB at 101×101 and 1.80 ms / 316 KiB at
201×201 in `Float64Array`), shared across every bot and every session. Lookups measure **~1.15 ns**
(5 M in 5.75 ms). Four augments — standard, `defendDiceBonus:+1`, `+2`, and ties-to-attacker — is
260 KiB and still 2 ms. **Never Monte-Carlo a battle**: slower than a lookup, and it consumes PRNG
draws.

**Balanced Blitz, lazily.** A BB cell needs its own O(A·D) outcome distribution, so a full table is
~O(A²D²): measured **4.4 ms at 32×32, 37.2 ms at 64×64, 199.8 ms at 100×100** — over the init budget.
Memoise on `(a, d, attackDice, defendDice, favourDefenderOnDraw, stopUntil)`; a real game queries far
fewer than 10,000 distinct pairs and small battles dominate. The memo is pure and never serialised. A
later optimisation is shipping a 40 KiB precomputed `Float32Array` asset, which also removes the
`Math.pow` portability risk.

**Bot compute.** A greedy scan of 400 candidate attacks with ~8-flop scoring is **0.0013 ms**; 20 such
passes (draft + attack chain + fortify) ≈ **0.027 ms** — the 100 ms budget is ~3,700× larger than a
ply-0 turn needs. Per phase at T=100: strength/hostility O(T+P) ~100 ops, BSR O(E) ~200, continent
scoring ~120, draft placement O(n log T), attack scoring O(E) per pass; **ply-0 total O(T·E) ≈
0.03 ms**. Expert's ply-1 over the top ~8 candidates × each opponent's best reply is 1–5 ms. Ply-2 is
20–200 ms and borderline: if used at all, restrict to the top 3 candidates × the 3 strongest replies.
Use flat `Int16Array` / `Float32Array` inside the bot (`GameView`), allocate nothing inside the
candidate loop, and be allocation-free after warm-up.

**Poll budget.** The three rules that keep it inside the free tier: **204 on no change** (the common
case, ~0 bytes and ~5 ms), **delta not snapshot** (snapshot-every-poll binds Active CPU at 576 K polls
instead of 1.4 M), and **stop polling when hidden** (one abandoned tab is 1.8× the whole Neon
allowance). Presence, chat, the delta and the tick ride **one** invocation; separate polls would cost
3× for no added capability.

**Render loop.** One SVG board, one `<path>` per territory, one CSS variable per owner — a capture is a
`data-owner` attribute change and a 240 ms `fill` transition, not a re-render. Tokens and labels are an
HTML layer positioned by `translate3d`. The whole camera language is a single `transform` on the
wrapper. Repaint only on the session's **dirty flag** plus a slow ~500 ms ambient bucket, and **never
pass the live `GameState` through React state** — a territory map painted from `apply()`'s output must
not go through React's render cycle, or clicking a territory visibly lags behind a re-render.

**Map loading and bundle.** Map JSON is **lazy-loaded per map** through a per-slug loader map, never a
barrel, so the initial bundle never contains 13 boards. Each shipped map stays **well under 100 KB**
after Douglas–Peucker simplification to 12–30 vertices per territory — which is both the correct art
direction and the cheap one. Natural Earth, world-atlas and us-atlas sources stay in
`research/map-data/` and in `scripts/maps/**` and are **never shipped to the client**. Targets: initial
JS under 200 KB gzipped for `/`, under 320 KB for a play route including the engine and the odds
tables; no map on the critical path.

**No server compute per turn offline.** Solo and pass-and-play run entirely client-side, so Vercel
serves static assets plus the §6 routes only.

---

## 11. Testing

`pnpm run verify` = `typecheck && lint && test`. Numbered so a slice can claim a specific gate.

**T1 — Layering** (`src/engine/layering.test.ts`, scaffold, build-failing and self-testing). Asserts
§4.1's five bans across `src/engine/**` read off disk, plus `ENGINE_ENTRY_POINTS`. **T1b** asserts
`topojson-client`, `mapshaper` and `d3-geo` appear nowhere under `src/`.

**T2 — Engine unit.** Every rule in §3, one fixture file per area: setup table and the 2-player
40/40/40 + 14/14/14 deal (R2–R7); the draft formula at 11→3, 14→4, 16→5, 17→5 (R12); Classic bonuses
3/7/2/5/5/2 (R13); blizzards still paying a bonus (R14); **the three card-timing branches as three
separate tests** (R24, R25, R26) and the mid-Attack trade-down bouncing to `draft` (R27); Fixed 4/6/8/10
and the +2 cap at 12 (R22, R23); Progressive 4,6,8,10,12,15,20,…,60 (R22); the conquest move range
(R63); connected-path fortify and the `END_PHASE`-out-of-fortify refusal (R66, R67); every modifier's
exact behaviour (R70–R80); the win-evaluation order and the Max-Rounds tiebreak flag (R78, R83); the
§3.11 invariants. Edge cases as their own tests: 2 troops → 1 die, 1 troop → no attack, defender with 1
troop → 1 die; a hand never exceeding 6; the capital augment being a no-op at `D ≤ 2`; augments
stacking to 4 defender dice; neutral armies never attacking or reinforcing.

**T3 — Dice tables.** The **six single-roll distributions** against their exact fractions
(2890/2611/2275 over 7776 · 855/441 over 1296 · 295/420/581 over 1296 · 125/91 over 216 · 55/161 over
216 · 15/21 over 36); SMG's `0.292566872427984` for 3v2; the capital rows (3v3 = 13.7603 / 21.4699 /
26.4660 / 38.3038 %) and the stacked 3v4 row (7.3285 / 14.8359 / 23.4107 / 54.4249 %), both from
`research/05-bots-and-ai.md` §4.6; the
300-attackers-vs-800 DP check **0.8897332621740284**; spot cells from the R41 table (1v1 41.67, 3v3
47.03, 5v5 50.62, 10v10 56.76, 20v12 94.29); the capital comparison **10v10: 56.76 / 19.02 / 5.31 %**;
every R42 break-even row; the logistic's max abs error ≤ 0.0318 over `A,D ∈ [129,400]` and a test that
**independent clamping is not used** (129 v 381 must not read 85.65%).

**T4 — Balanced Blitz, bit-exact.** 30 attackers vs a capital held by 15, losing exactly 12: True
Random **`0.0222128001707278`** and Balanced Blitz **`0.0100282888709122`**, to all 16 digits.
**49** attackers is the fewest for ≥80% BB against 50 (47 → 72.03, 48 → 77.10, 49 → 82.15, 50 → 86.35);
a stage-2-only implementation gives 75.7% at A=49 and must fail. `20 v 15` BB is exactly 100%. The
stage-2 oracle at `p = 1.4`: 56.8 → 59.46, 43.2 → 40.54, 86.1 → 92.78. The R56 Δ table within 0.01 pp.

**T5 — Property (`fast-check`).** `∀ state. hashState(state) === hashState(roundTrip(state))`;
`apply` never throws on an arbitrary `(state, action)` pair and never mutates its input; adjacency
symmetry survives every modifier combination; troop conservation across a battle; `W[A][D]` monotone in
`A` and antitone in `D`; the quantised CDF walk at `u ∈ {0, ε, 0.5, 1−ε}` picking a fixed outcome; a
`decideTurn` call consuming a fixed draw count; `viewFor` never leaking a hidden owner or count.

**T6 — Golden replays.** `(seed, mapSlug, rules, personaAssignment)` plus a `hashState` after every
turn, for a few hundred full bot-vs-bot games across all five tiers, stored as a versioned artefact.
A heuristic change that moves a hash must be an explicit, recorded change and must bump
`RULESET_VERSION`.

**T7 — Map validator.** `validateMap` run against **every shipped map** and the four fixtures:
symmetry, no dangling refs, geometry on every territory, complete continent membership, both anchors
present, the `viewBox` containing all geometry, slot counts in range, full connectivity. Plus the
Classic graph's own facts: 42 territories, 6 continents, **83 undirected edges**, 9 sea links, the five
adjudicated edges (Afghanistan–India present · China–Middle East absent · East Africa–Middle East
present · New Guinea–Western Australia present · Northwest Territory–Quebec absent), and the degree
distribution 2→4, 3→13, 4→13, 5→5, 6→7.

**T8 — Bot behaviour.** The BSR inversion fixture: enemy stacks 7, 4, 5 adjacent to a territory
holding 5 → `BST = 16`, `BSR = 3.2`, and with sibling BSRs 4 and 1.25, `NBSR = 3.2 / 8.45 = 0.37`.
`contValue` with `wHold = 2.0` on an empty Classic board ranking Australia and North America first at
0.33 (and bonus-per-territory alone ranking Europe first, which is the bug). An Expert bot never
attacking at `score ≤ 0`. A bot given the True Random table in a BB game measurably underperforming
one given the right table. A `blunderRate: 0.4` bot losing to a `0.0` bot over 50 seeded matches.

**T9 — API routes on PGlite** (in-memory, per suite). Name claim, `409` with suggestions, no duplicate
row; `FOR UPDATE` serialising two simultaneous POSTs into contiguous `seq`; one `clientActionId` sent
twice → one row and two `200`s with the same `seq`; `204` on no change with no body; a snapshot only to
a cold or compaction-lagging client; the lazy tick running a bot with no cron and chaining under
`MAX_TICK_ACTIONS`; the auto-skip → `SEAT_TO_BOT` → `SEAT_TO_HUMAN` sequence appearing as log rows; the
reaper closing a stale lobby; `games.seed` absent from every response body (asserted by scanning the
serialised JSON).

**T10 — Playwright e2e** (`workers: 1`, `fullyParallel: false`, both `desktop-chrome` and
`mobile-chrome`, every spec driving `window.__riskDebug.pollNow()` rather than sleeping):

1. **`e2e/replay.spec.ts` — write this one first.** It is the determinism proof and every other
   guarantee depends on it: fold the log from `seq = 0` and assert `hashState` matches every
   `state_hash`. It needs no second context.
2. `e2e/solo.spec.ts` — a solo game to victory on a **tiny map** (`tiny4`), asserting the outcome
   through `__riskDebug.state()`.
3. `e2e/pass-and-play.spec.ts` — a hand-off between two seats with fog respected: the overlay appears,
   the board is `hidden` behind it, and the incoming seat's view differs from the outgoing one's.
4. `e2e/online.spec.ts` — two Playwright **contexts** (separate cookie jars → genuinely two
   `risk_sid`s): create a lobby → join by code → a turn each → send a chat line → force a timeout with
   `RISK_TURN_SECONDS=3` → assert the bot takeover → reconnect → assert `SEAT_TO_HUMAN`. Plus the
   both-claim-one-name `409`, the refresh-mid-game `?since=` reconnect, and the two-tabs-one-account
   variant.
5. `e2e/screenshots.spec.ts` — `CAPTURE=1`-gated, `test.describe.configure({ mode: "serial" })`,
   `shot(name) => docs/screenshots/${name}.png`, run as
   `CAPTURE=1 npx playwright test screenshots --project=desktop-chrome` plus a `mobile-chrome` pass
   suffixing `-mobile`. **Wait for a photographable moment by reading state truth, not a fixed delay** —
   for a combat shot, "the dice have resolved and both troop counts have updated".

```ts
// installed only when NEXT_PUBLIC_RISK_DEBUG === "1"
window.__riskDebug = {
  seq:   () => confirmedSeq,
  state: () => structuredClone(confirmedState),   // simulation truth, not pixels
  pollNow: () => pollOnce(),                      // resolves when the response is applied
  setInterval: (ms: number) => { pollEveryMs = ms },
};
// e2e/helpers.ts
async function sync(...pages: Page[]) { await Promise.all(pages.map(p => p.evaluate(() => window.__riskDebug.pollNow()))); }
async function expectSeq(page: Page, seq: number) { await expect.poll(() => page.evaluate(() => window.__riskDebug.seq())).toBe(seq); }
```

**Assert on `__riskDebug.state()`, never on the canvas** — pixels can only tell you something was
painted, not whether the simulation moved. The renderer gets its own unit tests (**T11**: the layer
order, the per-owner `data-owner` mapping, the stadium token at three digits, label hiding below
2,500 px², the two camera transforms).

**T12 — Cost assertions.** A dev-only `Server-Timing` header on the game poll, read over 200 driven
polls: the **204 path must stay under ~5 ms** and have **no body**, and a one-action delta must be
**under 1 KB**. That last one is really a guard against accidentally returning the whole snapshot every
poll — the single regression that would blow the budget.

**T13 — Perf budgets** (vitest): True Random table init < 10 ms; 1,000 `winChance` lookups < 0.1 ms; a
ply-0 `decideTurn` on Classic < 1 ms; a ply-1 Expert `decideTurn` < 10 ms; `apply` of a 60-action bot
turn < 20 ms; `hashState` on a 100-territory state < 2 ms.

---

## 12. Work-stream decomposition

Seven slices with **disjoint file ownership**. **S1's very first commit publishes
`src/engine/types.ts` and `src/engine/index.ts`** — fully typed, stub-implemented, throwing — and
nothing else blocks on it, because **S2, S3, S4 and S5 code against the type shapes written in §4 of
this document and must copy them exactly.** Where prose and a §4 code block differ, the code block
wins; where §4 and S1's published file differ, the published file wins and S1 announces the change.

**Dependency order: S0 → {S1, S2, S3} → {S4, S5} → S6.**

| Slice | Scope | Owns (disjoint) | Consumes | Provides | Acceptance | Tests |
|---|---|---|---|---|---|---|
| **S0 — Scaffold** ✅ **DONE** | The committed Next 16 app: pins, config, tokens, fonts, DB adapters, scripts, the layering guard | `package.json` · `tsconfig.json` · `next.config.ts` · `eslint.config.mjs` · `postcss.config.mjs` · `vitest.config.mts` · `vitest.setup.ts` · `playwright.config.ts` · `vercel.json` · `.env.example` · `src/app/{layout.tsx,globals.css,page.tsx}` · `src/config/env.ts` · `src/adapters/db/*` · `src/test-support/*` · `scripts/{build-schema.mjs,db-push.ts}` · `src/engine/layering.test.ts` | — | the token sheet, the nine player palettes, `--font-head`/`--font-body`, `getDb()`, the production PGlite guard, port 3300, `NEXT_PUBLIC_RISK_DEBUG`, the purity guard with `ENGINE_ENTRY_POINTS` | `pnpm run verify` green; `pnpm run dev` serves a placeholder `/` | T1 |
| **S1 — Engine core** | §3 in full, minus the odds maths and the map pipeline | `src/engine/*.ts` (not `odds/`, `bots/`, `map/`) · `src/engine/resolver/**` · their `*.test.ts` | nothing (takes `OddsTables` as a parameter) | `@/engine`: every type in §4.4–§4.9, `apply`, `validate`, `legalActions`, the selectors, `viewFor`, `hashState`, `canonicalize`, `serializeState`, `pcg32`, `rngFor`, the five resolvers, `drawPersonas` | every rule R1–R92 implemented; `apply` never throws and never mutates; the three card branches distinct; fixed draw counts per resolver call; `ENGINE_ENTRY_POINTS` raised | T1, T2, T5, T13 |
| **S2 — Odds + Balanced Blitz + bots** | The dice maths and all five bot tiers | `src/engine/odds/**` · `src/engine/bots/**` · `src/content/personaNames.ts` · their tests | S1's `types.ts` (**stub against §4 while S1 builds**) | `@/engine/odds`: `createOdds`, `OddsTables`, `OutcomeDist`, `DiceAugment`, `balance`, `sampleOutcome`. `@/engine/bots`: `GameView`, `TurnPlan`, `decideTurn`, `makeView`, `PERSONAS`, `TIERS`, `DEFAULT_WEIGHTS` | T3 and T4 green to the printed digit; BB lazy and memoised, never at init; one table per dice mode; `decideTurn` pure with a fixed draw count; Expert stops at `score ≤ 0` | T3, T4, T5, T8, T13 |
| **S3 — Maps** | The schema, the loader, 12 boards and the generator | `src/engine/map/**` · `src/content/maps/**` · `scripts/build-maps.ts` · `scripts/maps/**` · their tests | S1's `MapDef`/`MapFile` types only — **S3 needs nothing else from any slice** | `@/engine/map`: `loadMap`, `validateMap`, `generateVoronoiMap`, `anchorsFor`; `src/content/maps/*.json` for Classic (42/6/83), World Extended (47/6/94), Napoleonic Europe (59/11/127), nine generated regional maps, and the `tiny3` / `tiny4` / `mini` / `quad` fixtures | every shipped map passes T7; each under 100 KB; 12–30 vertices per territory; `polylabel` anchors inside every polygon; the generator reproducible from `(options, seed)`; no build-time package imported from `src/` | T1b, T7 |
| **S4 — Render + session + offline screens** | Everything a player touches offline | `src/render/**` · `src/game/**` · `src/components/{game,setup,ui,chat}/**` · `src/app/page.tsx` · `src/app/new/**` · `src/app/play/{solo,pass-and-play}/**` · `src/adapters/localStorage/**` · `src/ports/**` · `src/content/dialog.ts` | S1's `types.ts` + `index.ts`; S3's **`tiny4` fixture** to develop against before the real maps land; S2's `OddsTables` for the win-chance readout | `createSession`, `SessionUiState`, `Session`, `EngineApi`, `SettingsPort`, `LocalProgressPort`, `IdentityPort`, `SyncPort` (the interface; S5 implements it), `HandOffOverlay`, the 42-line roster | §7's HUD, dialogs and prompts rendered to the measured geometry; `GameState` never in React state; the dirty-flag loop; autosave and resume; the hand-off state machine with fog respected; `window.__riskDebug` in non-production builds | T10.1–3, T10.5, T11 |
| **S5 — Online** | Option A end to end | `src/net/**` · `src/app/api/**` · `src/app/lobby/**` · `src/app/play/online/**` · `src/components/online/**` · `src/adapters/db/schema.sql` + regenerated `schema.ts` · `src/adapters/db/repositories/**` · their tests | S1's `apply` / `validate` / `hashState` / resolvers (**stub against §4 while S1 builds**); S2's `decideTurn` for the lazy tick; S4's `SyncPort` interface | every §6 route; `createPollingSync`; the lobby and online play screens; the schema and repositories | contiguous `seq` under concurrency; `204` with no body; idempotent retries; the lazy tick running bots and timeouts with no cron; the reaper; `games.seed` never serialised; the adaptive poll schedule with jitter and the hidden-tab stop | T9, T10.1, T10.4, T12 |
| **S6 — e2e + docs** | The proof and the shop window | `e2e/**` · `docs/screenshots/**` · `README.md`; **appends** to `DECISIONS.md` (D1–D76 already exist — never renumber or reuse) | every slice | the five specs, `e2e/helpers.ts`, the captured screenshots, the README | T10 green on both projects; `CAPTURE=1` produces the README's two 3-image tables; `DECISIONS.md` carries an entry for every **[SPEC]** call in this document | T10, T12 |

**Stubs each slice may use while its dependency is incomplete.** Every stub is a file the *consumer*
owns in its own tree, never a mutation of someone else's:

- **S2** codes against §4.4–§4.9's types copied verbatim into a local `types.ts` re-export, and tests
  its maths with hand-built `GameView` literals — it needs **no** working `apply`.
- **S3** needs only `MapFile`/`MapDef`; its validator and generator tests are pure data.
- **S4** develops against S1's published `types.ts` plus S3's **`tiny4`** fixture (4 territories, 1
  region, 6 edges) hand-written into `src/content/maps/tiny4.json` until S3 ships the real boards, and
  injects a scripted `EngineApi` so the HUD can be built before the reducer is finished.
- **S5** needs only `apply`, `validate` and `hashState` to be *callable*; its route tests fold a
  two-action log and compare hashes, so a stubbed `apply` that increments a counter is enough to prove
  the transaction, the idempotency fence and the 204 path.

**Integration.** S1 lands `types.ts` + `index.ts` first, then a minimal working `apply` + resolvers
even before full rule coverage, so S4 and S5 can start. S2 and S3 publish their barrels as soon as
their types compile. Final integration is three wirings: S4's `/new/rules` BATTLE handing a real
`GameConfig` to a real `MapDef`; S5's `SyncPort` adapter dropped into S4's `createSession`; and S3's
real maps replacing the `tiny4` placeholder in the picker. **Not owned by any slice** and integrated
last: the root `Replicates/README.md` section and the Wikipedia sibling entry (`projects.ts`,
`riskMeta` in `articles/meta.ts`, `articles/risk.tsx`, registration in `articles/index.ts`,
`public/images/Risk.png`), once there is a live deployment.

---

## 13. Out of scope

**Deliberately not built in v1**, each because the research found it unverifiable, unshipped in the
original, or monetisation rather than game:

Zombies / Zombie Apocalypse (outbreak %, conversion % and the dice augment are all unverified — but the
`attackDicePenalty` and ties-to-attacker augments stay in the dice model so the mode is cheap to add
later) · Secret Missions · Secret Assassin · teams 2v2 / 3v3 (never shipped in the original; building it
would be a new feature, not parity) · ranked play, leagues, seasons, ELO and the Novice→Grandmaster
class ladder · gems, tokens and the premium-pack play-gate · every cosmetic (dice skins, avatar frames,
troop counters, emote DLC) · DLC map packs and locked maps — **every map here is free** · the friends
list and Friend ID (replaced by the 4-letter lobby code) · the replay viewer and spectator mode (both
community requests the original has not shipped) · Basic Training's six guided tutorial modules (the tip
card component is specified, so the slot exists) · the weekly rotating "community expression" chat line
· the Exponential and Per-Player card modes (no numbers found anywhere) · the rulebook's "Rules
Variations for RISK Experts" 4,5,6,7 card ladder (recorded only so it is never confused with
Progressive) · the rulebook's Capital RISK variant (a *different* implementation from the original's
Capitals, with no dice mechanic) · Middle Earth as a map unless original names replace the Tolkien ones
*and* geometry can be generated for it · SMG's own artwork, the Wikimedia Hasbro-derived board SVGs, and
any map, name or graph whose provenance cannot be traced to a public-domain or permissive source ·
free-text chat of any kind, anywhere · accounts, passwords, email, cloud sync and cross-device
persistence · a leaderboard · haptics · localisation beyond English · and a push transport: the `Sync`
port exists so SSE or a Cloudflare Durable Object notification bus is one adapter later, and it is
deliberately not built now.
