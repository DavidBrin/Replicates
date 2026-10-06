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
| **Neutral** | The 2-player variant's third, non-playing holding. It is a **sentinel owner only** (`SEAT_NEUTRAL = -2`) — there is **no `SeatState` for it** and no `"neutral"` member of `SeatKind` (R7, F17 **[SPEC]**). It never takes a turn, never attacks, never receives reinforcements and holds no cards; it defends like any other territory, with dice the resolver rolls for it. |
| **Bot** | A seat played by `decideTurn`. One implementation runs bots offline in the session runner and online inside the lazy tick. |
| **Persona** | The ~20-attribute plain-data character of one bot (Rusher, Turtle, Assassin, …), **drawn once at match start and stored in `GameState`** so a replay reconstructs identical opponents. |
| **Tier** | The `AI Difficulty` setting: `beginner · easy · medium · hard · expert`. A tier is a **persona pool plus a capability row**, not a smartness slider. |
| **Draft** | Phase 1. Place `reinforcements` troops on owned territories; optionally trade cards first. |
| **Attack** | Phase 2. Any number of battles from owned territories holding ≥2 troops into directly adjacent enemy territories. |
| **Fortify** | Phase 3. **One** move of troops along a connected path of own territories, then the turn ends. |
| **Claim phase** | The Manual Placement opening: seats alternate placing one army until every territory is claimed, then alternate placing the remainder. |
| **Round** | One full pass through `turnOrder`, from the first live seat back to it. `round` increments on wrap. |
| **Turn** | One seat's Draft→Attack→Fortify between two `END_TURN`s. `turn` is a monotonic counter; it is **not** the RNG sub-stream index — that is the action's `seq` (see **RNG sub-stream**). |
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
| **RNG sub-stream** | `rngFor(seed, purpose, index)` — a PCG32 seeded by `hash(seed, purpose, index)`, so adding or removing a draw in one purpose never shifts another. `index` is the **seq of the action being produced** (the session's / the server's `nextSeq`), never `state.turn`; personas and the opening deal use index 0. |
| **Intent** | What the player asked for, before dice: `{ from, to, mode, attackerDice?, stopUntil? }`. Clients submit intents; the authority returns actions. |
| **Hand-off** | The full-screen "pass the device to `<name>`" overlay between two human turns in Pass & Play. Presentational; it never dismisses itself. |
| **View** | `viewFor(state, map, seat)`: a `GameState` with every fogged territory's owner and troops replaced by sentinels and every other seat's hand emptied down to a `cardCount`. What a client is allowed to see, and what a non-cheating bot reasons over. `fogged: true`, so it is never hashed. |
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

  **Opening order is fixed and load-bearing (F39) [SPEC]:** `dealTerritories` performs the whole opening in **one** order — ① seat order (R4) · ② **blizzards and portals** (R10, R11) via `placeModifiers` · ③ **the deal over the non-blizzard territories only** (R3/R5) · ④ **capitals, each drawn from that seat's own dealt territories** (R8). Blizzards must precede the deal because a blizzard tile is never dealt; capitals must follow it because a capital is one of the seat's dealt territories. The three sub-streams are passed in as `rngs: { deal, turnOrder, modifierPlace }`, so adding a draw to one never shifts another (§4.11).
- **R4 — Seat order.** Drawn by the resolver in the same call as R3 (from the `turnOrder` sub-stream) and carried in `GAME_STARTED` at `seq = 1`. Highest single die first, ties rerolled; equivalently, a seeded shuffle of the seat list.
- **R5 — 2-player deal.** On a 42-territory map: deal the 42 territory cards into three 14-card piles — yours, your opponent's, the neutral's — and place one army on each of those 42 territories. On any other map, deal the `T` non-blizzard territories into **three piles whose sizes differ by at most 1**, assigning the larger piles to **seat 0, then seat 1, then neutral**. **[SPEC]**
- **R6 — 2-player remainder.** Remaining armies alternate: the acting seat places **2 on any one or two of its own territories**, then **1 neutral army on any neutral territory**, until both seats are exhausted. **When a seat's remainder is odd its final step places 1, not 2** (F50 **[SPEC]**) — the alternation never overshoots the starting-army total. Under Auto Placement this is performed by the resolver inside R3; under Manual Placement it is the claim-phase loop (R9), where the neutral placement is a `CLAIM` with `forNeutral: true`.
- **R7 — Neutral behaviour.** The neutral holding is a **sentinel owner, not a seat**: `SEAT_NEUTRAL` appears in `TerritoryState.owner` and nowhere else, there is no `SeatState` for it, and `SeatKind` has no `"neutral"` member (F17 **[SPEC]**). It never takes a turn, never attacks, never receives reinforcements and holds no cards. It **defends exactly like a seat** (R24–R27): the resolver rolls its dice the way it rolls any defender's, with no special case. It is excluded from elimination, win and tiebreak checks: you win a 2-player game by eliminating your **opponent**, not the neutrals.
- **R8 — Capitals assignment [SPEC].** With Capitals on, each seat's capital is one of its **own dealt** territories, chosen by the resolver **after** the deal (R3 ④) and carried in `GAME_STARTED`. Capitals are never placed on a blizzard — which is automatic, because a blizzard tile is never dealt to a seat.
- **R9 — Manual Placement (claim phase).** With Manual Placement on, R3 assigns no owners (steps ② and ④ still run; the capital is drawn once the seat's claims have resolved). The game opens in `phase: "claim"`: seats alternate in `turnOrder`, each `CLAIM` placing exactly one army — onto an unowned non-blizzard territory while any remain, thereafter onto one of their own. The phase ends when every seat's starting armies are placed; play then begins at `turnOrder[0]`'s Draft. The capital drawn at that point is the seat's **most-garrisoned owned territory, ties broken by the lowest index** — deterministic, so `apply` still takes no RNG (R88), and it reads as the stack the player chose to build rather than an accident of territory numbering. **[SPEC]**
- **R10 — Blizzards.** `placeModifiers` freezes `map.modifierSlots.blizzards` territories (per-map count **2–11**), chosen seeded and uniformly at random, **before the deal** (R3 ②) and therefore before any capital exists — so the old "territories with no capital" filter is vacuous and is dropped **[SPEC]**; never more than one per continent while alternatives remain. A blizzard territory has no owner and no troops for the whole game.
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
- **R24 — Timing branch 1: forced at turn start.** Holding **≥5** cards at the start of your turn, you **must** trade at least one set before `DRAFT`, and **may** trade a second if you still hold one. `legalActions` in `draft` with `hand.length ≥ 5` and `setsTradedThisTurn === 0` returns `TRADE_CARDS` as the only **play** — plus whichever of R80's alliance kinds are available, because `validateAlliance` never reads the hand and so accepts them throughout the forced trade (§4.7). Returning a bare `["TRADE_CARDS"]` advertised less than the validator accepts, which is a disagreement in the direction that costs the player a move rather than one that offers an illegal one. **A hand of seven or more is the one case where it really is `TRADE_CARDS` alone**, and that falls out of R28's guard rather than needing a case of its own: the guard refuses every action carrying that seat but the exempt list, alliance actions included. **[SPEC]**
- **R25 — Timing branch 2: your own reward draw forces nothing.** Drawing your end-of-turn card to 5 or 6 forces nothing now; the R24 check happens at the start of your **next** turn. **Including the draw that lands on six**: `validateCardDrawn` admits the award at a hand of five (R28's guard is on the hand *going in*), so the award legitimately reaches six in `fortify`, and R26 must not read that as an inheritance. Doing so left the seat with **no legal action at all** — `END_TURN` refused `mustTradeCards`, `END_PHASE` illegal out of fortify (R67), `TRADE_CARDS` draft-only (R24, R27) — while `legalActions` went on offering `END_TURN`. **[SPEC]**
- **R26 — Timing branch 3: inheritance forces an immediate trade-down.** Inheriting an eliminated seat's hand mid-turn to **≥5** (`SEIZURE_TRADE_THRESHOLD`, D114; it was 6 before review round 2) forces an **immediate, same-turn** trade-down to **≤4**, one set at a time, stopping as soon as the hand reaches 4, 3 or 2. If the inheritance leaves you under 5, you wait until your next turn. These three branches are three separate rules and three separate tests. **The floor is four, not six**: one trade removes exactly three cards, so a hand of 8 reaches 5 and must be traded again (8 -> 5 -> 2). `mustTradeDown` therefore keeps forcing above the floor while a trade-down is under way, which R27's `resumePhase` bounce plus `setsTradedThisTurn > 0` identifies without a new `GameState` field. **Both of `mustTradeDown`'s branches are gated on that bounce**, the `≥ 6` one included, because the bounce is the only thing that tells an inheritance from R25's reward draw to six. For that key to hold, **every route a seizure to ≥6 can arrive by sets `resumePhase`** — the `MOVE_IN` branch after a conquest and `END_TURN`'s R81 re-check, whatever phase it ran in. It must **not** be re-derived from the hand size (`hand.length + 3 * setsTradedThisTurn >= 6`): a seat that traded at turn start and then inherited back up to five satisfies that without ever having held six, and R26 defers exactly that hand to the next turn. **[SPEC]**
- **R27 — Forced trade-down during Attack.** When R26 fires in `attack`, the bonus troops go into `troopsToPlace` and the phase **reverts to `draft`** until they are placed; `END_PHASE` then returns play to `attack` with `conqueredThisTurn` and every other turn flag intact. **[SPEC]**

  **Ordering against a conquest (F41) [SPEC].** An elimination always arrives on a capture, and a capture always sets `pendingMoveIn` (R63). **`MOVE_IN` resolves first**: the `ATTACK` branch sets `pendingMoveIn`, records the seizure, and leaves the phase at `attack`; the **`MOVE_IN` branch** is where the R27 bounce to `draft` is applied, after the troops have moved. Only when no move-in is pending — a seizure that did not come with a conquest, which `END_TURN`'s R81 re-check can still produce — does the branch that saw it apply the bounce itself. One site per route, one order, one test each.

  Two consequences the implementation has to honour:

  - **R28's hand-size guard exempts `MOVE_IN` as well as `TRADE_CARDS`.** The bounce is *behind* `MOVE_IN`, so gating `MOVE_IN` on "a hand of seven or more must be traded down first" wedges the seat completely: `legalActions` offers `["MOVE_IN"]` and nothing else, `validate` refuses it, and `TRADE_CARDS` is refused outside `draft`. A four-card attacker eliminating a four-card victim is enough to reach it.
  - **It exempts the three administrative actions too: `SEAT_TO_BOT`, `SEAT_TO_HUMAN` and `PORTALS_MOVED` [SPEC].** The guard reads `action.seat`, and on those three that field is the seat the action is *about* — or, for a relocation, nothing but a log stamp naming whoever is to play — never a seat taking a play of its own. All three are server-resolved and §6's schema refuses a client body carrying one, so the exemption adds no surface a player can reach. Gating them wedged the game the same way: the lazy tick's away branch (§5.6) produces `SEAT_TO_BOT` and nothing else, so a seat that went away owing a 7-or-8-card trade-down could not be handed to a bot, the tick came back `appended === 0`, `missedTurns` never climbed (only the *timeout* branch below it counts a miss), and `POST /resign` answered `422` to the one player who had decided to leave. `AUTO_DEPLOY` is **not** exempt — a draft placement is the seat's own play, and R26's floor already refuses it with the precise `mustTradeCards` code.
  - **`END_TURN`'s elimination sweep bounces before it advances — for a hand the sweep itself grew.** The seizure it can make is an inheritance like any other and R26 calls for the trade-down *in the same turn*, so when the bounce fires the turn does not advance — advancing would clear `resumePhase` and hand the next seat's play a holder who may take no action at all. The seat trades down, `END_PHASE` returns it to the phase it was in, and it ends its turn again. The branch compares the hand across the sweep rather than just testing its size, because a hand of six also reaches `END_TURN` by R25's reward draw, and bouncing *that* one would force the same-turn trade R25 says is not owed. **[SPEC]**
- **R28 — Seizure.** Eliminating a seat transfers its **whole hand**. A hand never exceeds 6 under R24–R26. A state that presents 7+ is a rule violation like any other: `apply` **returns `{ state: input, events: [], error: { code: "illegalAction" } }` and never asserts or throws** (F51 **[SPEC]**, and R86).

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

- **R39 — Solution order and cost.** Reverse lexicographic order of `A+D`; every transition decreases `A+D` by exactly `c ≥ 1`. **O(A·D)**, exact to floating point, no matrix inversion.

  **Oracles, each with its augment stated — this matters, because the published one is not standard play.**

  | Oracle | Augment | Value |
  |---|---|---|
  | 300 attackers vs 800 defenders | **ZOMBIE-DEFENDER**: `{ defendDiceBonus: 0, attackDicePenalty: 0, favourDefenderOnDraw: false }` — i.e. **ties to the ATTACKER**, defender rolls 2 dice | **0.8897332621740284** (SMG publish `0.8897331`) |
  | `W[5][2]` | standard 3v2, ties to defender | **0.8897887238900141** **[SPEC, computed]** |
  | `W[300][300]` | standard 3v2, ties to defender | **0.9517567082839995** **[SPEC, computed]** |

  The first row's numeric near-coincidence with `W[5][2]` is exactly that — a coincidence of the first
  four digits. Under the **standard** augment `W[300][800] ≈ 2.4 × 10⁻²⁹`, so a test that quotes
  `0.8897332621740284` without `tiesToAttacker: true` is asserting the wrong table. The two
  standard-augment rows are self-computed from the R38 recursion and are the ones T3 uses to prove the
  everyday table.
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

- **R42 — Break-evens.** Minimum `A` to be a favourite: `D=1 → 2`, `2 → 3`, `3 → 4`, `5 → 5`, `10 → 10`, `20 → 18`, `30 → 27`, `50 → 44`. For ≥80%: `1 → 3`, `2 → 5`, `3 → 6`, `5 → 8`, `10 → 14`, `20 → 24`, `30 → 34`, `50 → 53`. Every `A = D+1` cell sits just above 50%: for **`D = 1…9`** the series is 0.754, 0.656, 0.642, 0.638, 0.638, 0.640, 0.643, 0.646, 0.650 (nine values, one per `D` — the series bottoms out at `D = 5` and climbs again). `A = D ≥ 5` is already favourable.
- **R43 — Table size and the tail.** Precompute `W[A][D]` for `A, D ≤ 128` per augment as a `Float32Array`. Beyond the table use the fitted logistic `p ≈ σ((A − 0.860·D) / (0.630·√(A+D)))`: over `A, D ∈ [129, 400]` the **max abs error is 0.03205, at `(A, D) = (333, 400)`**, so the asserted bound is **≤ 0.0321**, and the RMS error is **0.0088** **[SPEC, computed]**. **The logistic is fitted to the STANDARD augment only** (F48 **[SPEC]**): for any non-standard augment there is no fit, and a query above the table **extends the DP on demand and memoises the result** rather than reaching for the curve. **Never clamp indices independently** — `W[min(A,128)][min(D,128)]` reads 129 v 381 (≈0%) as 85.65%.
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

  **The concatenation, written out (F46), from `research/05-bots-and-ai.md` §5.2–§5.3.** The combined array is

  ```
  combined = [ attackLoss[0], attackLoss[1], …, attackLoss[A−1],      // attacker wins, having lost i
               defendLoss[D−1], defendLoss[D−2], …, defendLoss[0] ]   // defender wins, having lost j
  ```

  — length `A + D`, **index 0 = most favourable to the attacker** (conquers losing nothing) and the
  last index = most favourable to the defender (holds, losing nothing). **The two aggregate cells are
  excluded**: `attackLoss[A]` (= P(attacker loses the battle)) and `defendLoss[D]` (= P(attacker wins))
  are totals, not outcomes, and double-counting them would shave the wrong mass. The defender half is
  **reversed**, because `defendLoss[D−1]` (the defender barely survives) is the defender outcome
  closest to an attacker win. The low tail is cut from index 0 inward and the high tail from
  `A + D − 1` inward; stage 4 then renormalises **each half separately** (R53).

  The lane states the ordering in prose, not as an index expression, so **S2's acceptance is the
  bit-exact T4 oracle, not this paragraph**: if any ambiguity remains, S2 pins whichever ordering
  reproduces `0.0100282888709122` and records the choice in `DECISIONS.md`. **[SPEC]**
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

  **`END_TURN` is legal out of `attack` and `fortify`, and nowhere else [SPEC].** `claim`, `draft` and `over` are all refused with `wrongPhase`. The phase list used to deny only `claim` and `over`, which let a `draft` with every troop placed end the turn there — skipping the Attack phase R27 promises every turn — and let a hand owing R24's turn-start trade skip that too, `validateEndTurn` reading R26's `mustTradeDown` rather than `mustTradeNow`. `legalActions` never advertised either, so only a crafted client could reach them, and the ruling is that the validator rather than the advertiser is the authority. Nothing the authority produces relied on the `draft` path: `autoSkipAction` (§5.6), `decideTurn` (§4.13) and the offline runner's `endBotTurn` all offer `END_PHASE` before `END_TURN`, and in a finished `draft` `END_PHASE` is the action that takes play on — to `resumePhase` when R27 bounced it there, to `attack` otherwise.
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
- **R80 — Alliances.** `rules.alliances` on/off per game. Alliances are **non-binding**: there is no "cannot attack ally" lock and attacking an ally breaks nothing automatically. `ALLIANCE_PROPOSE` / `ALLIANCE_ACCEPT` / `ALLIANCE_BREAK` between two seats; an active alliance unlocks dialog lines 28 and 29. **One offer at a time per pair**: a `PROPOSE` is refused (`notAlliable`) while an unanswered offer between those two seats is on the table in either direction — `GameState.pendingAlliances` (§4.7) is what records it, and `ACCEPT`, `BREAK`, an elimination and a resignation all clear it.

  **An `ACCEPT` answers an offer, so one has to exist [SPEC].** `ALLIANCE_ACCEPT { seat, from }` is refused (`notAlliable`) unless `pendingAlliances` holds the **directed** pair `[from, seat]` — the offer `from` made to `seat`. `[seat, from]` is the seat's own outstanding proposal and accepting it is not an answer. Without the gate a seat could forge a pact nobody offered it, and — the three alliance actions being the only ones exempt from §5.5's online turn fence — churn `ACCEPT`/`BREAK` off-turn as fast as it could POST, every repeat a log row, every row a `games.seq` bump, and the poll's `204` fast path gone with it. `legalActions` narrows its `ALLIANCE_ACCEPT` the same way, which is what keeps the two sides in agreement.

  **Leaving the game ends a seat's diplomacy — offers *and* pacts [SPEC].** An elimination (R81) and a resignation (R82) drop the seat from every other seat's `allies` as well as clearing its `pendingAlliances`, each removal emitting the `allianceChanged … "broken"` every other end of a pact emits. Dropping only the offers left survivors holding a pact with a seat that was out: `legalActions` advertised an `ALLIANCE_BREAK` for it and `validateAlliance` refused that same action ("both seats must still be playing"), which is a dead entry in the list and a dead button in the UI. An **away** or **timeout** takeover is not leaving the game (D76) and keeps both.

  **`legalActions` offers the alliance kinds only to a *contender*.** That is `isContender`, not the `takesTurns` the function's own gate uses: a resigned seat keeps taking turns (D76) but has stopped being a contender (R84), and `validateAlliance` asks for two contenders. It also mirrors R28's hand guard, so a seat owing a 7-or-8-card trade-down is offered no diplomacy either.

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

  **`STATE_FORMAT_VERSION` is the separate *envelope* version, and a new `GameState` field bumps it [SPEC].** It is **2**; the 1 → 2 move is `pendingAlliances` (§4.7). `deserializeState` accepts every supported version and runs the migrations in order up to the current one, each step purely additive — a step that reinterpreted a stored value would move `hashState` and break the promise above. Adding the field *without* the bump left a v1 envelope being accepted as a current state that was in fact half understood: `validate`, `legalActions` and `apply` all read `pendingAlliances`, so all three threw a `TypeError` on the first alliance question and a resumed autosave crashed, which is exactly the silent misreading the envelope exists to prevent. The envelope is not the only door, so it is not the only defence: `games.snapshot`, a POLL 3 body and a `risk:session:v1:` save are **already-parsed** states that never pass through it, and each of those boundaries defaults the field in as it reads it (`foldActions`, `createSession`'s resume, `ingestSnapshot`). `pendingAlliancesOf` is what the engine itself reads through, so `apply` stays total (R86).

---

## 4. Architecture

Hexagonal, matching the siblings, with the engine held to `super-smash`'s purity standard. **S0 has
already built everything marked *(scaffold)*** — it is committed and typechecks; no slice recreates it.

```
src/
  engine/                      pure. NO randomness, NO clock, NO DOM, NO React. Four barrels, disjoint owners.
    types.ts                   S1 — GameState, Rules, MapDef, Card, Action, Event, ApplyResult,
                               RuleError(Code), BotPersona, BotTier, Rng, RngPurpose, DiceAugment,
                               OutcomeDist, OddsTables, every id type and constant at its real
                               value. PUBLISHED FIRST, hour one, typecheck-only (§12).
    index.ts                   S1 — the `@/engine` public API. PUBLISHED FIRST, stubbed to throw.
    rules.ts                   S1 — reinforcements, continent bonuses, set values, reachability, win checks
    reducer.ts                 S1 — apply(state, map, action) -> ApplyResult, one branch per Action
    validate.ts                S1 — validate(state, map, action) -> RuleError | null
    legalActions.ts            S1 — legalActions(state, map, seat) + the per-phase target selectors
    graph.ts                   S1 — adjacency, active-portal edges, friendly-path reachability
    continents.ts              S1 — ownership, bonus payment, perimeter sets for the overlay
    cards.ts                   S1 — deck composition, set detection, set values, the three timing branches
    modifiers.ts               S1 — blizzard/portal/capital/fog predicates and the DiceAugment sum
    fog.ts                     S1 — viewFor(state, map, seat)
    hash.ts                    S1 — canonical serialisation + hashState
    serialize.ts               S1 — serializeState / deserializeState
    prng.ts                    S1 — PCG32, rngFor(seed, purpose, index)   // index = the action's seq
    resolver/
      index.ts                 S1 — the resolver barrel
      rollAttack.ts            S1 — the only caller of odds + rng for a battle
      drawCard.ts              S1
      dealTerritories.ts       S1 — the whole opening in R3's order: seat order, modifiers, the deal,
                               starting armies, then capitals from each seat's dealt territories
      placeModifiers.ts        S1 — blizzards + portals, before the deal (R10, R11)
      movePortals.ts           S1 — the round-start unstable relocation
    odds/
      index.ts                 S2 — `@/engine/odds` public API: createOdds, DiceAugment helpers
      types.ts                 S2 — re-exports S1's OddsTables/OutcomeDist/DiceAugment (§4.2) and
                               adds STANDARD_AUGMENT, the augment helpers and the table constants
      rounds.ts                S2 — the 24 single-roll distributions, exact rational -> float
      dp.ts                    S2 — W[A][D] and the forward outcome distribution
      logistic.ts              S2 — the beyond-table fit
      balance.ts               S2 — the four Balanced Blitz stages
      sample.ts                S2 — quantised inverse-CDF sampling
    bots/
      index.ts                 S2 — `@/engine/bots` public API: decideTurn, drawPersonas, tiers
      types.ts                 S2 — TurnPlan, GameView, BotWeights
      view.ts                  S2 — makeView(state, map, seat, persona): GameView (typed arrays)
      personas.ts              S2 — the eight persona literals and drawPersonas()
      tiers.ts                 S2 — the five tier rows
      score.ts                 S2 — attack scoring, BSR, hostility, continent value
      draft.ts  attack.ts  fortify.ts  cards.ts  lookahead.ts
    map/
      index.ts                 S3 — `@/engine/map` public API
      schema.ts                S3 — MapFile -> MapDef loader (sea links unioned in) + validateMap
      voronoi.ts               S3 — the seeded random-map generator
      anchors.ts               S3 — polylabel token/label anchors
      slots.ts                 S3 — modifier-slot placement helpers used by the resolver
    entryPoints.ts             (scaffold) ENGINE_ENTRY_POINTS + ALLOWED_PACKAGES — the guard's only
                               editable surface; append-only, one line per slice (§4.1)
    layering.test.ts           (scaffold) the purity guard; reads entryPoints.ts, never a literal
  render/                      S4 — pure painters: render(svg, state, ui, camera, now). No React.
    board.ts tokens.ts arrows.ts camera.ts palette.ts animations.ts
  game/                        S4 — the session runner
    session.ts                 createSession(options): Session
    sessionConfig.ts           zustand/vanilla store: GameConfig, SeatConfig, MapSource (§4.14)
    debugBridge.ts             S4 — the `declare global` for window.__riskDebug + registerDebug()
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
  net/                         S5 — pollingSync.ts: createPollingSync (+ room for SseSync,
                               DurableObjectSync). The SyncPort *interface* lives in ports/, not here.
  ports/                       S4 — SettingsPort, LocalProgressPort, SyncPort + SyncStatus +
                               PresenceRow/ChatLine/ChatSend, IdentityPort
  adapters/
    db/                        (scaffold) driver.ts index.ts neon.ts pglite.ts schema.sql schema.ts
    db/repositories/           S5 — players.ts lobbies.ts games.ts actions.ts chat.ts
    localStorage/              S4 — settings.ts progress.ts identity.ts session.ts
  content/
    maps/                      S3 — one JSON per map, lazy-loaded; index.ts is a loader map, never a
                               barrel: MAP_SLUGS + loadMapFile(slug) only (§4.14)
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

**The guard's two lists live in `src/engine/entryPoints.ts`, not in the test** *(scaffold — **DONE**,
landed by S0)*, so four slices can extend them without four slices editing one test file (F21/F22):

```ts
// src/engine/entryPoints.ts — APPEND-ONLY. One line per slice, never a rewrite.
export const ENGINE_ENTRY_POINTS: readonly string[] = [
  "layering.test.ts",          // S0
  // S1 appends: "types.ts", "index.ts", "reducer.ts", "hash.ts", "prng.ts", "resolver/index.ts"
  // S2 appends: "odds/index.ts", "bots/index.ts"
  // S3 appends: "map/index.ts"
];

/** The only third-party packages `src/engine/**` may import, and where. */
export const ALLOWED_PACKAGES: readonly { readonly pkg: string; readonly under: string }[] = [
  { pkg: "polylabel", under: "src/engine/map/" },   // S3's anchors.ts, and nothing else (§4.3)
];
```

`layering.test.ts` imports both and never carries a literal of its own, so a misplaced directory
cannot silently empty the guard and a new runtime dependency cannot be smuggled in by editing the
test. An import of `polylabel` from anywhere outside `src/engine/map/**` fails T1, as does any
package not in `ALLOWED_PACKAGES`.

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
`GameState`. **So do `DiceAugment`, `OutcomeDist` and a minimal structural `OddsTables`** (F2): the
resolver's `rollAttack` takes an `OddsTables` parameter and `diceAugmentFor` returns a `DiceAugment`,
so S1 cannot type its own public API without them, and S1 may not import S2. S2's `odds/types.ts`
**re-exports all three unchanged** (`export type { DiceAugment, OutcomeDist, OddsTables } from
"@/engine"`) and adds everything S1 does not need — `STANDARD_AUGMENT`, the augment-composition
helpers, `BALANCE_CONFIG`, the table constants. There is exactly one declaration of each, in
`types.ts`. `TurnPlan`, `GameView` and `BotWeights` live in S2's `bots/types.ts`.

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

**The map additions to the pin list — all pinned by S0 *(DONE)*, not by S3.** Package manifests are
S0's file, so **S3 edits no `package.json`** (F23): the pins below are already committed, and S3 only
imports them.

| Package | `package.json` section | Where it may be imported | Why |
|---|---|---|---|
| **`polylabel`** | **`dependencies`** | **only** `src/engine/map/anchors.ts` — enforced by `ALLOWED_PACKAGES` (§4.1) | the Voronoi generator computes token/label anchors in the browser, so the pole-of-inaccessibility solver must ship |
| `topojson-client` | `devDependencies` | **build-time only**, `scripts/maps/**` | `merge` for dissolving admin polygons into territories |
| `mapshaper` | `devDependencies` | **build-time only**, `scripts/maps/**` | dissolve + Douglas–Peucker simplify to 12–30 vertices |
| `d3-geo` | `devDependencies` | **build-time only**, `scripts/maps/**` | projection to a flat `viewBox` |
| `@types/d3-geo`, `@types/polylabel` | `devDependencies` | types only | neither ships its own |

The build-time packages are **never imported from `src/`**; a test asserts that (T1b). Nothing else is
added: no charting library, no geometry library at runtime, no dice library (`risk-dice` is never
vendored — R60).

Config files, all *(scaffold)*: `tsconfig.json` with **`noUncheckedIndexedAccess`**;
`eslint.config.mjs` and `postcss.config.mjs` byte-identical to the siblings; `next.config.ts` with
`reactStrictMode: true`, `devIndicators: false`, `agentRules: false`,
`serverExternalPackages: ["@electric-sql/pglite", "@neondatabase/serverless"]`,
`outputFileTracingIncludes`, and the Turbopack root pin via `fileURLToPath`; `vitest.config.mts` with
`tsconfigPaths() + react()`, the `server-only → src/test-support/empty-module.ts` alias, jsdom,
`vitest.setup.ts`, `include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"]` — **the `scripts/**`
entry is landed, DONE** (F35), so S3's map-pipeline tests run under `pnpm test` instead of silently
never running — and `testTimeout`/`hookTimeout` `30_000`;
`playwright.config.ts` on **port 3300**, `fullyParallel: false`, `workers: 1`, projects
`desktop-chrome` + `mobile-chrome (Pixel 7)`, viewport 1280×800, and **six env pins, all already
landed by S0 (F29, DONE)**: `DB_DRIVER=pglite`, `DB_DATA_DIR=:memory:`,
`E2E_ALLOW_PGLITE_PRODUCTION_BUILD=true`, `NEXT_PUBLIC_RISK_DEBUG=1`, **`RISK_TURN_SECONDS=3`** and
**`RISK_FIXED_SEED=e2e-seed`**. The last two are read through `src/config/env.ts`, which already
declares them; S5 consumes them and adds nothing.
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
/** Only the two things a SEAT can be. The neutral holding is the SEAT_NEUTRAL sentinel, never a
 *  SeatState and never a SeatKind (R7, F17). */
export type SeatKind = "human" | "bot";
export type BotTier = "beginner" | "easy" | "medium" | "hard" | "expert";
export type PlayerColour =
  | "red" | "green" | "blue" | "yellow" | "orange" | "pink" | "black" | "white" | "purple";

/** Turn-timer options (R79). Online only. */
export const TURN_SECONDS = [60, 90, 120, 180, 300] as const;
/** Starting armies by seat count (R2); 2 seats use the 40/40/40 variant. */
export const STARTING_ARMIES: Record<number, number> = { 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 };
/** Fixed card values for a three-of-a-kind, by suit (R22). There is no three-of-a-kind in Wilds —
 *  the deck holds two — so `wild` has no entry and any set containing a Wild is FIXED_MIXED_VALUE. */
export const FIXED_SET_VALUE: Record<Exclude<Suit, "wild">, number> =
  { infantry: 4, cavalry: 6, artillery: 8 };
export const FIXED_MIXED_VALUE = 10;   // one-of-each, or any set containing a Wild
/** Progressive ladder (R22): index n-1 for the n-th set, then 15 + 5*(n-6). */
export const PROGRESSIVE_SET_VALUES = [4, 6, 8, 10, 12, 15] as const;
export const TERRITORY_BONUS = 2;
export const TERRITORY_BONUS_CAP = 2;
export const UNSTABLE_PORTAL_PERIOD = 3;     // relocate when round % 3 === 0 (R76)
```

**The RNG types are declared HERE and nowhere else** (F13). `prng.ts` *implements* `pcg32` and
`rngFor` and imports these types; `index.ts` re-exports the two **functions** from `./prng` and the
two **types** through `export * from "./types"`. Two declarations of `Rng` is how a slice ends up
with two structurally identical but nominally awkward interfaces.

```ts
export type RngPurpose =
  | "deal" | "turnOrder" | "cardDeck" | "battle"
  | "modifierPlace" | "portalMove"
  | "personaAssign" | "personaJitter"
  | `bot:${number}`;                         // template-literal, built as `bot:${seat}` (F18)

export interface Rng {
  nextU32(): number;
  nextFloat(): number;                       // [0,1), = nextU32() / 2**32
  readonly state: readonly [number, number];
}
```

**The three dice-maths shapes S1 needs are also declared here** (F2), because `rollAttack` takes an
`OddsTables` and `diceAugmentFor` returns a `DiceAugment`, and S1 may not import S2 (§4.2). S2's
`odds/types.ts` re-exports them verbatim and adds its own constants and helpers on top.

```ts
export interface DiceAugment {
  readonly defendDiceBonus: number;          // +1 per capital / wall (R36)
  readonly attackDicePenalty: number;        // reserved for the Zombie augment
  readonly favourDefenderOnDraw: boolean;    // true in every in-scope mode; false = ties to attacker
}

/** Terminal-state distribution of one whole battle (R40, R48). */
export interface OutcomeDist {
  readonly a: number;                        // A, excluding the garrison
  readonly d: number;
  /** attackLoss[i<A] = P(win having lost i); attackLoss[A] = P(lose the battle). */
  readonly attackLoss: Float64Array;
  /** defendLoss[j<D] = P(defender wins having lost j); defendLoss[D] = P(attacker wins). */
  readonly defendLoss: Float64Array;
  /** P(the Attack Limiter stopped the battle with both sides alive). 0 without `stopUntil`. */
  readonly unresolved: number;
  readonly winChance: number;
  /**
   * The per-pair breakdown of `unresolved`, sorted by `attackerLosses` then `defenderLosses`.
   *
   * **The stopped mass lives here and nowhere else**: `attackLoss` and `defendLoss` describe
   * resolved battles only, so with a limiter the two arrays sum to `1 - unresolved` and a walk over
   * them alone cannot reach the stopped tail at all (R48, F46). `rollAttack` appends one slot per
   * entry after R52's combined array, which is also the order `sampleOutcome` walks. Optional: a
   * distribution with no limiter has nothing to break down.
   */
  readonly stopped?: readonly StoppedOutcome[];
}

/** One terminal state of a battle the Attack Limiter stopped with **both sides alive** (R48). */
export interface StoppedOutcome {
  readonly attackerLosses: number;
  readonly defenderLosses: number;
  readonly p: number;
}

/** The MINIMAL structural contract the resolver calls through. S2's `createOdds` returns something
 *  that satisfies it; S1 never constructs one and never looks inside. */
export interface OddsTables {
  readonly mode: DiceMode;
  winChance(a: number, d: number, aug?: DiceAugment): number;
  outcome(a: number, d: number, aug?: DiceAugment, stopUntil?: number): OutcomeDist;
  expectedAttackerLoss(a: number, d: number, aug?: DiceAugment): number;
  certainWin(a: number, d: number, aug?: DiceAugment): boolean;
}
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
    /** The suit of this territory's card (R19). Authored, never derived at runtime, so a map's
     *  card deck is stable across builds. Validated by T7: the three counts differ by <= 1. */
    readonly suit: Exclude<Suit, "wild">;
    readonly adjacent: readonly string[];        // undirected LAND borders; symmetry is validated
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
  /** EVERY neighbour: the file's land `adjacent` UNIONED with its `seaLinks` (F45). Sorted
   *  ascending (R91). This is the set attack adjacency and fortify reachability both read. */
  readonly adjacent: readonly TerritoryId[];
  readonly seaLinked: readonly TerritoryId[];    // the subset drawn as dashed routes; a subset of `adjacent`
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
  /** Row i lists i's static neighbours — land edges UNION sea links, matching Territory.adjacent
   *  exactly (F45). Portal edges are added at query time by graph.ts. */
  readonly adjacency: readonly (readonly TerritoryId[])[];
}
```

**`loadMap` unions the sea links in** (F45): `Territory.adjacent` and `MapDef.adjacency` each carry
land borders **and** sea links, so no caller ever has to remember to check `seaLinked` as well —
`legalAttackTargets`, `graph.ts`'s reachability and the validator's symmetry check all read one set.
`Territory.seaLinked` survives purely so §8's renderer knows which of those edges to draw as a dashed
route. Classic's **83 undirected edges include the 9 sea links** (74 land borders + 9), which is the
number T7 asserts.

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
  readonly neutralHolding: boolean;       // the 2-seat neutral holding, OPT-IN (D106); default false
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
  readonly kind: SeatKind;                 // "human" | "bot" — there is no neutral seat (R7)
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

/**
 * A persona ALREADY FOLDED WITH ITS TIER (F10). `drawPersonas` computes `persona ⊕ TIERS[tier]` once
 * at match start and stores the result; nothing downstream ever consults the tier row again, so a
 * bot's behaviour is fully described by this one object and a replay cannot drift when a tier row is
 * retuned. `SeatState.tier` survives only as a label for the HUD.
 */
export interface BotPersona {
  readonly name: string;                   // "rusher" | "turtle" | ... (display name in content/)
  readonly tier: BotTier;                  // the row it was folded with, for display and golden replays
  readonly aggression: number;             // 0..1
  readonly minWinChance: number;
  /** Expert's `minWinChance: "dynamic"` resolves to this flag; when true the floor is `score <= 0`
   *  and `minWinChance` is ignored. A number|string union inside GameState would not serialise
   *  canonically (R91/D16), so the tier's "dynamic" becomes a boolean here. [SPEC] */
  readonly dynamicMinWinChance: boolean;
  readonly reserveFactor: number;          // border troops kept = factor * largest adjacent enemy stack
  readonly tierReserveFactor: number;      // the tier's multiplier in `reserve(t)` (§4.13)
  readonly antiBotBias: number;            // 0 = none; > 0 biases target selection toward bot seats
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
  readonly kind: SeatKind;                 // "human" | "bot"; the neutral holding is not a seat (R7)
  readonly name: string;
  readonly colour: PlayerColour;
  readonly standing: Standing;
  /** The hand. In a VIEW this is `[]` for every seat but the viewer (F12); `cardCount` is what
   *  survives masking, so the roster can show "3 cards" without showing which three. */
  readonly cards: readonly Card[];
  /** Always the true hand size, in authoritative state and in every view. */
  readonly cardCount: number;
  readonly capital: TerritoryId | null;
  readonly tier: BotTier | null;           // display label only; the behaviour is folded into `persona`
  readonly persona: BotPersona | null;     // persona (+) tier, drawn once at match start (D28, F10)
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
  /** The ruleset version this state was produced under (R92). A plain `number`, not
   *  `typeof RULESET_VERSION`: a state deserialised from an older replay legitimately carries an
   *  older number, and a literal type makes that unrepresentable. [SPEC] */
  readonly version: number;
  readonly mapSlug: string;
  readonly rules: Rules;
  readonly seats: readonly SeatState[];
  readonly turnOrder: readonly Seat[];     // excludes the neutral holding (R7)
  readonly territories: readonly TerritoryState[];   // index === TerritoryId
  readonly currentIndex: number;           // index into turnOrder
  readonly phase: Phase;
  readonly round: number;                  // 1-based; increments on wrap
  readonly turn: number;                   // monotonic turn counter; NOT the rngFor sub-stream
                                           //   index — that is the action's seq (D5, R88)
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
  /** R80's unanswered offers, `[proposer, target]`, in proposal order. `ALLIANCE_PROPOSE` is the
   *  one action with no other trace in the state, and the three alliance actions are the only ones
   *  exempt from the online turn fence, so without this a seated player could append the same
   *  proposal in a loop — every repeat a log row, every row a `games.seq` bump, and the poll's
   *  `204` fast path gone with it. It cannot be derived from `allies`: an unaccepted offer leaves
   *  that array untouched by construction. Cleared by the `ALLIANCE_ACCEPT` or `ALLIANCE_BREAK`
   *  that answers it (both directions — an alliance is symmetric) and by the elimination or
   *  resignation of either seat, and covered by `hashState` like every other field.
   *
   *  It is also what an `ALLIANCE_ACCEPT` is **gated on**: the directed pair `[from, seat]` must be
   *  here, or the accept is refused `notAlliable` (R80). Accepting your own `[seat, from]` offer is
   *  not an answer to it.
   *
   *  Adding this field bumped `STATE_FORMAT_VERSION` to **2** (R92): a persisted state written
   *  before it exists lacks it, and reading `.some` on `undefined` threw a `TypeError` out of
   *  `validate`, `legalActions` and `apply` alike. `deserializeState` migrates a v1 envelope, and
   *  every boundary that reads an already-parsed foreign state — `foldActions` on `games.snapshot`,
   *  `createSession`'s resume, `ingestSnapshot` on a POLL 3 body — defaults it to `[]`. The engine
   *  itself reads it through `pendingAlliancesOf`, so `apply` stays total (R86). [SPEC] */
  readonly pendingAlliances: readonly (readonly [Seat, Seat])[];
  readonly portals: readonly PortalState[];
  readonly discard: readonly Card[];       // traded-in cards; the deck order is never stored (R19)
  readonly outcome: Outcome | null;
  /** True only on the result of `viewFor`. The authoritative state always has `false`. */
  readonly fogged: boolean;
}
```

`GameState` holds **no map, no seed, no RNG state, no deck order, no wall clock and no UI state**. It
carries `mapSlug` and nothing more of the board, so **`hashState` never covers the map** — two clients
agreeing on a hash have agreed about the game, not about the geometry, and the `MapDef` is passed
alongside the state into every function that needs it (F1). Online,
`games.seed` lives on the database row and is unreachable from the response serialiser; offline, the
seed lives in the session runner and in the autosave envelope, never in `GameState`.

### 4.8 The `Action` union

Every action is one log row. **Chat is not an action** — it has its own table and its own route, and
it never touches `GameState`. Actions whose `actor` is `server` are produced only by the resolver.

```ts
export interface SeatInit {
  readonly seat: Seat; readonly kind: SeatKind; readonly name: string;
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
  /** `forNeutral: true` is the 2-player variant's "then 1 neutral army" step (R6): the acting seat
   *  is still `seat`, but the army lands on a SEAT_NEUTRAL territory. Absent or false everywhere
   *  else, so a 3-6 seat claim log is unchanged. (F50) */
  | { readonly type: "CLAIM"; readonly seat: Seat; readonly territory: TerritoryId;
      readonly forNeutral?: boolean }

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
      readonly continents: readonly ContinentId[]; readonly bonus: number;
      readonly capitals: number;                     // R15's +2 per held capital; 0 unless
                                                     //   rules.capitalDraftBonus (F14)
      readonly total: number }                       // base + bonus + capitals
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

**`apply`'s result type lives in `types.ts` too** (F15), because every consumer — the reducer, the
session runner, the API routes, S5's stubs — needs it before `index.ts` is implementable, and because
`ApplyResult` references `Event`, declared immediately above:

```ts
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
```

### 4.10 `@/engine` public API (`src/engine/index.ts`)

**Every function that reasons about the board takes the `MapDef` as its second parameter** (F1).
`GameState` holds only `mapSlug` (§4.7), so `apply`, `validate` and `legalActions` are
`(state, map, …)` exactly like the selectors already were — one shape across the whole API, and no
hidden global map. `hashState` is the one deliberate exception: it takes the state alone and **never
covers the map**.

```ts
export * from "./types";      // includes ApplyResult, RuleError, RuleErrorCode, Rng, RngPurpose,
                              //   DiceAugment, OutcomeDist, OddsTables

/** Folds `GAME_STARTED` into an empty board. The map must already be loaded. */
export function createInitialState(map: MapDef, started: Extract<Action, { type: "GAME_STARTED" }>): GameState;

/** The one door into the rules. Pure, total, non-mutating (R86–R88). */
export function apply(state: GameState, map: MapDef, action: Action): ApplyResult;

/** Why `action` would be refused, or null. Never mutates and never throws. */
export function validate(state: GameState, map: MapDef, action: Action): RuleError | null;

/**
 * The action kinds `seat` may submit right now, in a stable order (`ACTION_ORDER`, R91).
 *
 * **`legalActions` and `validate` must agree, and the agreement is a property T5 asserts [SPEC].**
 * Over a few hundred reachable states — driven games on `mini` and `classic-world` with alliances
 * on, plus the corner states each round of review has found a bug in — for **every** seat and not
 * only the one to play:
 *
 *   - every kind this returns has at least one concrete action `validate` accepts;
 *   - every concrete action `validate` accepts has its kind returned here.
 *
 * Asserting one side at a time is how every disagreement so far shipped: an advertised kind the
 * validator refused (`MOVE_IN` past a six-card hand, `ALLIANCE_BREAK` for a dead ally,
 * `ALLIANCE_ACCEPT` with no offer on the table, any alliance kind for a resigned seat) or an
 * accepted action it never offered (`END_TURN` out of `draft`, the alliance kinds R24's early
 * return dropped). The property is scoped to `ACTION_ORDER`, which deliberately omits
 * `GAME_STARTED`, `SEAT_TO_BOT`, `SEAT_TO_HUMAN` and `PORTALS_MOVED`: those are the authority's to
 * produce and never a seat's to submit, so not advertising them is the contract, not a
 * disagreement.
 */
export function legalActions(state: GameState, map: MapDef, seat: Seat): readonly ActionKind[];

// ---- selectors the UI and the bots share ----
export function reinforcementsFor(state: GameState, map: MapDef, seat: Seat): {
  base: number; continents: readonly ContinentId[]; bonus: number; capitals: number; total: number;
};
export function legalAttackTargets(state: GameState, map: MapDef, from: TerritoryId): readonly TerritoryId[];
export function legalFortifyMoves(state: GameState, map: MapDef, from: TerritoryId): readonly TerritoryId[];
export function legalDraftTargets(state: GameState, seat: Seat): readonly TerritoryId[];
/**
 * R6/R9 — which `CLAIM` the claim phase is waiting for from `seat`.
 *
 * `"neutral"` means the next claim must carry `forNeutral: true`. The alternation is a RULE, not a
 * courtesy — `validate` refuses the seat's own claim while the neutral army its pair owes is still
 * outstanding — so a caller that only ever sends `CLAIM { seat, territory }` stalls the 2-seat
 * setup outright. The UI and the bot runner ask; neither guesses. A 3-to-6-seat game never answers
 * `"neutral"`, and `"none"` means the seat has nothing left to place.
 */
export function claimOwed(state: GameState, seat: Seat): "own" | "neutral" | "none";
/** Where R6's neutral army may land: the neutral's own tiles, plus any still unclaimed. */
export function legalNeutralClaimTargets(state: GameState): readonly TerritoryId[];
/** Where the seat's own claim army may land: unclaimed while any remain, else its own (R9). */
export function legalOwnClaimTargets(state: GameState, seat: Seat): readonly TerritoryId[];
export function cardSets(cards: readonly Card[]): readonly (readonly [string, string, string])[];
/**
 * The value of ONE set, as a function of its three cards and the two things the scheme needs — not
 * of a whole `GameState` (F4). The bots score hypothetical hands ("what would seizing P's cards be
 * worth?", §4.13's `killValue`), and those hands do not exist in any state.
 *   - `cards`   the three cards, in any order
 *   - `setsTradedTotal`  sets traded in the whole game SO FAR; the n-th set is `setsTradedTotal + 1`
 *   - `scheme`  "fixed" | "progressive" (R22)
 */
export function cardTradeValue(
  cards: readonly Card[], setsTradedTotal: number, scheme: CardBonusScheme,
): number;
export function mustTradeNow(state: GameState, seat: Seat): boolean;          // R24 / R26
export function diceAugmentFor(
  state: GameState, map: MapDef, from: TerritoryId, to: TerritoryId,
): DiceAugment;
export function dicePlan(state: GameState, map: MapDef, from: TerritoryId, to: TerritoryId): {
  maxAttackDice: 1 | 2 | 3; defendDice: 1 | 2 | 3 | 4;
};
/** By seat. `null` where fog hides the total from the viewer (R73) — the roster's `???` (F52).
 *  On authoritative state every entry is a number. */
export function territoryCounts(state: GameState): readonly (number | null)[];
export function troopCounts(state: GameState): readonly (number | null)[];
export function continentsHeldBy(state: GameState, map: MapDef, seat: Seat): readonly ContinentId[];
export function isGameOver(state: GameState): boolean;

// ---- fog, hashing, serialisation ----
/**
 * Two maskings, one function. Always: **every other seat's `cards` is emptied to `[]`, with
 * `cardCount` left at the true size** (F12) — a hand is secret whether or not fog is on, and
 * `cardCount` is what the roster's card tag renders. Conditionally, when `rules.fogOfWar`: every
 * territory `seat` cannot see has its `owner` and `troops` replaced by sentinels (R73).
 * Always sets `fogged: true`, so the result is **never hashable** (see `hashState`); with fog off it
 * is the identity over the TERRITORIES, not over the hands.
 */
export function viewFor(state: GameState, map: MapDef, seat: Seat): GameState;
/**
 * Canonical: sorted keys, integers not floats, no `undefined`. 64-bit hex (D16).
 * **Asserts `state.fogged === false`** and is therefore only ever computed over authoritative state
 * (F36): a masked view is a different byte string and would hash differently per viewer.
 */
export function hashState(state: GameState): string;
export function canonicalize(state: GameState): string;
export function serializeState(state: GameState): string;
export function deserializeState(json: string): GameState;

// ---- the resolver barrel (pure, but RNG-taking) ----
export * from "./resolver";
/** The FUNCTIONS only. `Rng` and `RngPurpose` are types from `./types`, re-exported above (F13). */
export { pcg32, rngFor } from "./prng";
```

### 4.11 The resolver

The resolver is the **only** place randomness enters, and it never mutates state: it returns the
**action** whose payload carries the outcome (D2, D3, D4).

`Rng` and `RngPurpose` are declared in `types.ts` (§4.4) and implemented here (F13):

```ts
/** PCG32 over a 64-bit state held as two u32s; integer ops only (Math.imul, >>> 0). */
export function pcg32(seedHi: number, seedLo: number): Rng;
/**
 * Purpose-tagged sub-stream: pcg32(hash(seed, purpose, index)). The determinism keystone (D4).
 * `index` is the SEQ OF THE ACTION BEING PRODUCED (the session's / server's `nextSeq`), never
 * `state.turn` — keyed on the turn, every attack in a turn would reuse the stream's first draw
 * (codex round 1, finding 7). Personas and the deal use index 0. [SPEC]
 */
export function rngFor(seed: string, purpose: RngPurpose, index: number): Rng;

// ---- resolver signatures (src/engine/resolver/) ----
/**
 * The whole opening, in the fixed order of R3 (F39): seat order -> blizzards + portals -> the deal
 * over the non-blizzard territories -> each seat's capital from its OWN dealt territories.
 *   - `personas`  by seat index, null for a human seat. DRAWN BY S2's `drawPersonas` (F3) and passed
 *                 in, so the resolver neither owns the persona pools nor imports `@/engine/bots`.
 *   - `rngs`      one sub-stream per purpose, never one stream re-used: adding a draw to the deal
 *                 must not shift the modifier placement (D4).
 */
export function dealTerritories(
  map: MapDef,
  config: GameConfig,
  personas: readonly (BotPersona | null)[],
  rngs: { deal: Rng; turnOrder: Rng; modifierPlace: Rng },
): Extract<Action, { type: "GAME_STARTED" }>;

/** Blizzards and portals only — called by `dealTerritories` BEFORE the deal, so no capital exists
 *  yet and none can be excluded (R10). Capitals are chosen by `dealTerritories` after the deal. */
export function placeModifiers(
  map: MapDef, rules: Rules, rng: Rng,
): { blizzards: readonly TerritoryId[]; portals: readonly PortalState[] };

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
```

**`drawPersonas` is NOT a resolver** (F3). It reads the persona literals and the tier rows, both of
which live in `src/engine/bots/`, so it is **S2's**, declared in `src/engine/bots/personas.ts` and
exported from `@/engine/bots` (§4.13). S1 neither owns it nor lists it in its Provides; the caller
draws the personas and hands them to `dealTerritories`.

`rollAttack` consumes **exactly one** `nextFloat()` for a Blitz (inverse-CDF over the reshaped
distribution, R58) and exactly `attackerDice + defendDice` `nextU32()`s for a Manual roll — which is
always True Random (R61). A **neutral defender is rolled by the same code path with no special
case** (R7, F17). `drawCard` consumes one draw. `dealTerritories` consumes a bounded number per
sub-stream, fixed by `(territoryCount, seatCount)`. Every one of those counts is asserted by a test,
because a change to a draw count is a replay-breaking change (D4).

### 4.12 `@/engine/odds`

`DiceAugment`, `OutcomeDist` and the structural `OddsTables` are **declared in S1's `types.ts`**
(§4.4) because S1's own public API mentions all three; `src/engine/odds/types.ts` **re-exports them
unchanged** and owns everything else here (F2).

```ts
// src/engine/odds/types.ts — re-export, never redeclare
export type { DiceAugment, OutcomeDist, OddsTables } from "@/engine";

// ---- the helpers and constants that are S2's alone ----
export const STANDARD_AUGMENT: DiceAugment =
  { defendDiceBonus: 0, attackDicePenalty: 0, favourDefenderOnDraw: true };
/** The Zombie augment kept alive for §13's "cheap to add later": ties to the ATTACKER. */
export const ZOMBIE_DEFENDER_AUGMENT: DiceAugment =
  { defendDiceBonus: 0, attackDicePenalty: 0, favourDefenderOnDraw: false };
/** Sum two augments (R36 — augments STACK). Integers add; the tie rule ORs toward the defender. */
export function addAugments(a: DiceAugment, b: DiceAugment): DiceAugment;
/** The canonical memo/table key for an augment: `${defendDiceBonus}:${attackDicePenalty}:${0|1}`. */
export function augmentKey(aug: DiceAugment): string;
export function isStandard(aug: DiceAugment): boolean;

export const TABLE_MAX = 128;
export const CERTAIN_EPS = 1e-9;          // [SPEC]: the brief gives the predicate, not the epsilon
export const LOGISTIC_ALPHA = 0.86;
export const LOGISTIC_BETA = 0.63;
export const BALANCE_CONFIG = {
  winChanceCutoff: 0.05, winChancePower: 1.3, outcomeCutoff: 0.1, outcomePower: 1.8,
} as const;
export const CDF_QUANTUM = 2 ** 32;       // R59

// ---- src/engine/odds/index.ts — the `@/engine/odds` barrel ----
export function createOdds(mode: DiceMode): OddsTables;
/** The 24 single-roll distributions, keyed by (attackDice, defendDice, favourDefenderOnDraw). */
export function roundDistribution(attackDice: number, defendDice: number, favourDefender: boolean): Float64Array;
/** (TABLE_MAX+1)^2, row-major. Built eagerly for STANDARD_AUGMENT only; every other augment is
 *  built here on first call and memoised on `augmentKey(aug)` (F49). */
export function battleTable(aug: DiceAugment): Float32Array;
export function balance(raw: OutcomeDist, cfg?: typeof BALANCE_CONFIG): OutcomeDist;
/**
 * The walk itself is **S1's** `sampledOutcomes` + `walkCdf`, imported from `@/engine` (the
 * permitted direction, §4.2): `rollAttack` resolves live battles through the same two functions, so
 * there is exactly one implementation of R52's order and R59's tie rule and the two cannot drift.
 * What lives here is only the index → losses mapping. A resolved defender-hold costs the attacker
 * **all of `a`** — the DP writes `defendLoss[j < D]` only on the transition that empties the
 * attacker's force; a limiter that stopped the battle early is in `dist.stopped` with its own losses.
 */
export function sampleOutcome(dist: OutcomeDist, u: number): {
  attackerLosses: number; defenderLosses: number; conquered: boolean; unresolved: boolean;
};
```

**Initialisation budget.** `createOdds` builds **exactly one** table eagerly: the True Random
`Float32Array` for the **standard 3v2, ties-to-defender augment**, 129×129, 65 KiB, ~2 ms (F49). That
is the augment the overwhelming majority of queries use. **Every other augment** — `+1` defender die
(Capitals), `+2` (capital + wall), ties-to-attacker (Zombie), any `attackDicePenalty` — **is built on
first use and memoised**, keyed by `augmentKey(aug)`. A Capitals game pays ~2 ms once, the first time
someone looks at a capital's odds, instead of every game paying for four tables it may never read.

`createOdds("balancedBlitz")` builds the same single True Random table (the bot still needs
`expectedAttackerLoss` and the break-even is shared) and computes **Balanced Blitz distributions
lazily, memoised on `(a, d, attackDice, defendDice, favourDefenderOnDraw, stopUntil)`** — a full
100×100 BB table measures 199.8 ms, which is over the init budget (D24). Every memo here is pure and
**never serialised**; a cache-warm difference must never become a replay divergence.

Outside the table, `winChance` **never clamps indices** (R43). For the standard augment it uses the
fitted logistic; **for any other augment there is no fit**, so it extends the DP to the requested
`(A, D)` on demand and memoises that too (F48). Above-table queries at a non-standard augment are
rare enough — a 129+ stack attacking a capital — that an O(A·D) build on the spot is the right trade
against shipping four more curves nobody validated.

### 4.13 `@/engine/bots`

```ts
/** Flat read-model. Built from an authoritative state, or from `viewFor`'s output for honest bots. */
export interface GameView {
  readonly map: MapDef;
  readonly rules: Rules;
  /** The acting seat. `decideTurn` reads it from here — it is never also a parameter (F20). */
  readonly me: Seat;
  /** `me`'s persona, already folded with its tier (F10, F20). Same rule: never also a parameter. */
  readonly persona: BotPersona;
  readonly turn: number;
  readonly round: number;
  readonly phase: Phase;
  readonly owner: Int16Array;              // by TerritoryId; SEAT_* sentinels preserved
  readonly troops: Int16Array;             // beliefs, already inflated by persona.fogPessimism
  readonly known: Uint8Array;              // 1 when the true value is known
  readonly blizzard: Uint8Array;
  /** The live portal set, so the bot sees portal edges as attack adjacency and fortify reachability
   *  exactly as the engine does (R68, R75, R76) — including `activeFrom`, so it does not plan an
   *  attack through a portal that is inactive this round (F9). */
  readonly portals: readonly PortalState[];
  /** By seat: that seat's capital, or -1 for none. Needed for the +1 defender die on the way in and
   *  for Capitals' win condition on the way out (R72) (F9). */
  readonly capital: Int16Array;
  readonly territoryCount: Int16Array;     // by seat
  readonly troopCount: Int32Array;
  readonly cardCount: Int16Array;
  readonly myCards: readonly Card[];
  readonly allies: Uint8Array;             // by seat
  readonly standing: readonly Standing[];
  readonly troopsToPlace: number;
  /** Sets traded in the whole game so far — the Progressive ladder's position (R22). Without it the
   *  bot cannot price its own hand or a seizure, which is what `killValue` is (F9). */
  readonly setsTradedTotal: number;
  /** Already conquered something this turn, so the end-of-turn card is already earned (R20) — the
   *  difference between "attack for the card" and "attack for the territory" (F9). */
  readonly conqueredThisTurn: boolean;
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

/**
 * Pure. Same inputs -> same outputs, always (D8). Re-entered after each battle.
 * **Three parameters, not five** (F20): the acting seat is `view.me` and its persona is
 * `view.persona`, so there is exactly one source for each and no way to pass a mismatched pair.
 */
export function decideTurn(view: GameView, odds: OddsTables, rng: Rng): TurnPlan;

/**
 * The persona draw, moved here from the resolver (F3). Returns one entry per seat, null for a human
 * seat, each **already folded with its tier row** (F10) — so `GameState` stores behaviour, not a
 * reference to a table that may be retuned later. Two sub-streams: `assignRng` picks the persona
 * from `TIERS[tier].pool` (and resolves `wildcard`), `jitterRng` applies the +/-10% jitter.
 */
export function drawPersonas(
  tiers: readonly (BotTier | null)[], assignRng: Rng, jitterRng: Rng,
): readonly (BotPersona | null)[];

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

/** The magnitude `antiBotBias: true` folds to. [SPEC] — the sources say only "yes"/"no". */
export const ANTI_BOT_BIAS = 0.5;

/** Draw one persona for one tier and fold the row into it. `drawPersonas` is this, per seat. */
export function personaFor(tier: BotTier, assignRng: Rng, jitterRng: Rng): BotPersona;
export const TIERS: Record<BotTier, TierRow>;
/** The eight UNFOLDED persona literals. `GameState` never holds one of these — it holds the fold. */
export const PERSONAS: Record<string, BotPersona>;
export const DEFAULT_WEIGHTS: BotWeights;
```

**The fold, `persona ⊕ tier`, written out (F10).** `drawPersonas` picks the persona literal, jitters
the sourced knobs, then overwrites from the tier row — the tier always wins, because the tier is the
player's `AI Difficulty` setting:

```
tier                        -> persona.tier
row.minWinChance === "dynamic"
  ? { minWinChance: 0, dynamicMinWinChance: true }
  : { minWinChance: row.minWinChance, dynamicMinWinChance: false }
row.blunderRate             -> blunderRate
row.tierReserveFactor       -> tierReserveFactor     // used by reserve(t), §4.13's formulae
row.placement               -> placement
row.lookahead               -> lookahead
row.usesExactOdds           -> usesExactOdds
row.fogHonest               -> fogHonest
row.fogPessimism            -> fogPessimism
row.allianceLoyalty         -> allianceLoyalty
row.seesKillForCards || persona.seesKillForCards     -> seesKillForCards   // the assassin keeps it
row.seesCardTradeTiming     -> seesCardTradeTiming
row.seesDominationThreshold -> seesDominationThreshold
row.antiBotBias ? ANTI_BOT_BIAS : 0                  -> antiBotBias
```

Everything else — `aggression`, `reserveFactor`, `reserveFloor`, `continentFocus`, `expansionism`,
`stackiness`, `turtleAversion`, `leaderBias`, `grudgeWeight`, `grudgeDecay` — comes from the persona
and its jitter. The tier contributes no value that is not in the table above.

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
killValue(P)   = cardTradeValue(bestSetOf(myCards + P's cards), view.setsTradedTotal,
                                view.rules.cardBonus)                        // F4's signature
               + P.territoryCount * wTerr
reserve(t)     = max(persona.reserveFloor,
                     ceil(maxAdjacentEnemyStack(t) * persona.tierReserveFactor))   // F10

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
one** for a blunder or a tie-break — so the count is **0 or 1, and which one is a pure function of
the inputs**, not a constant (F57). A `blunderRate: 0` persona therefore draws nothing, ever, and
T5 asserts the function, not a fixed number. Never `while (rng.nextFloat() < x)`. Expert's compute goes into
the draft and a ply-1 reply check over the top ~8 candidates (1–5 ms), not into deeper attack search;
MCTS and rollouts are out (per-turn branching is 10³³–10⁸⁵).

### 4.14 `@/engine/map`

```ts
/** Unions `file.seaLinks` into every Territory.adjacent and into MapDef.adjacency (F45).
 *  Throws only on a validator failure. */
export function loadMap(file: MapFile): MapDef;
export function validateMap(file: MapFile): { valid: boolean; errors: readonly string[] };
export function generateVoronoiMap(options: VoronoiOptions, rng: Rng): MapFile;
export function anchorsFor(d: string): { token: [number, number]; label: [number, number] };

export interface VoronoiOptions {
  readonly territories: number;      // 19 .. 104
  readonly continents: number;       // 4 .. 11
  readonly width: number; readonly height: number;   // viewBox, default 1600 x 900
  readonly seaLinks: number;         // extra long edges, default round(territories / 6)
  readonly name?: string;
}
```

**The loader map** (`src/content/maps/index.ts`, S3). It publishes exactly two things and **is never a
barrel** — importing it must not pull a single board's geometry into the bundle (D40, F6):

```ts
/** Every shipped slug, in picker order. The only enumeration of the catalogue. */
export const MAP_SLUGS: readonly string[];
/** Per-slug dynamic import. Rejects on an unknown slug. */
export function loadMapFile(slug: string): Promise<MapFile>;
```

**Where a map comes from** (`src/game/sessionConfig.ts`, **S4** — it is a setup-flow concern, not a map
concern, and S3 must not own a file under `src/game/`):

```ts
export type MapSource =
  | { readonly kind: "slug"; readonly slug: string }
  | { readonly kind: "random"; readonly options: VoronoiOptions; readonly seed: string };
```

`/new/map` writes a `MapSource` into the `sessionConfig` store; `/new/rules`'s BATTLE resolves it —
`loadMapFile(slug)` for `"slug"`, `generateVoronoiMap(options, rngFor(seed, "deal", 0))` for
`"random"` — and only then is there a `MapFile` to hand to `loadMap`. `GameConfig.mapSlug` is the
resolved slug either way (a generated map's slug is minted from its seed), so `GameState` never has
to describe a generator.

`validateMap` checks, and these are the build-time gates run against **every** shipped map (D36):
adjacency **symmetry**; no dangling territory or continent reference; every territory has a non-empty
`d`; every continent's territory list exactly matches the territories' own `continent` field; every
territory has both anchors; the `viewBox` contains all geometry; `modifierSlots.blizzards` ∈ 2–11 and
`portals` ∈ 3–7; no continent has a zero or negative bonus; every territory reachable from every
other; **and every territory carries a `suit`, with the three suit counts differing by at most 1**
(F7). The validator is the reason two of the nine upstream Classic graphs shipped bugs.

**Assigning the suits** (F7). The deck is one card per territory plus 2 Wilds (R19), and a lopsided
deck changes what a Fixed trade is worth, so the balance is a build-time gate, not a hope. Classic
uses the **real RGD/rulebook suit for every territory the research data records**; where a shipped map
has no sourced suit — the generated regional maps, Napoleonic Europe, the Voronoi output — the build
assigns **round-robin by territory index** (`["infantry", "cavalry", "artillery"][index % 3]`), which
satisfies the ≤1 rule by construction. **[SPEC]**

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
  /** The ◀ ▶ steppers' current position: Blitz, or a manual dice count (R46). Resets to "blitz"
   *  at the start of every turn. The Blitz view reads it; it is not part of GameState. (F42) */
  attackDice: "blitz" | 1 | 2 | 3;
  blitzWinChance: number | null;
  dice: { attacker: readonly number[]; defender: readonly number[] } | null;
  handOff: { seat: Seat } | null;
  hidden: boolean;                      // board concealed behind the hand-off overlay
  modal: "cards" | "dice" | "count" | "settings" | "help" | "endTurn" | "getReady" | null;
  toast: string | null;
  chatOpen: boolean;
  gameOver: Outcome | null;
  syncStatus: SyncStatus;               // from src/ports/sync.ts (F31)
  /** How many of my optimistic actions are still unconfirmed (§5.5's `pendingActions.length`).
   *  Drives the "sending…" affordance and the disabled state while a submit is in flight. 0
   *  offline, always. (F42) */
  pending: number;
  /** The authority's `turn_deadline`, ISO 8601, straight off POLL 3 — the timer bar reads this and
   *  never computes a deadline of its own. `null` offline and whenever no timer is set. (F42) */
  turnDeadline: string | null;
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
  /**
   * The runner's monotonic action counter: the seq of the action about to be produced, and the
   * sub-stream index EVERY resolver call is keyed on — `rngFor(seed, "battle", nextSeq)`,
   * `"cardDeck"`, `"portalMove"` and `` `bot:${seat}` ``. Never `state.turn`, which changes once a
   * turn and so handed two attacks in one turn the same dice. Persisted because re-deriving it on
   * resume would re-spend a sub-stream the pre-save game had already used. Optional: an envelope
   * written before this existed falls back to the folded count. (D5, R88)
   */
  readonly nextSeq?: number;
}

export interface Session {
  /**
   * The **displayed** state: `confirmed()` with my still-unconfirmed optimistic actions folded on
   * top (§5.5's `displayedState`). This is what the board paints and what every selector in the HUD
   * reads, because it is what the player just did. Offline it is identical to `confirmed()`. (F42)
   */
  readonly state: GameState;
  /** The **authoritative** state: the fold of the log, nothing optimistic. The hash assertion, the
   *  autosave and `__riskDebug.state()` all read this one — never `state`. (F42) */
  confirmed(): GameState;
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

**`EngineApi`** (`src/game/engineApi.ts`) is the **exact** subset of `@/engine` the session runner
calls — written out here because "a narrow interface" is not a contract, and because a test injects a
scripted implementation of precisely this and nothing more (F33):

```ts
export interface EngineApi {
  // ---- the rules ----
  createInitialState(map: MapDef, started: Extract<Action, { type: "GAME_STARTED" }>): GameState;
  apply(state: GameState, map: MapDef, action: Action): ApplyResult;
  validate(state: GameState, map: MapDef, action: Action): RuleError | null;
  legalActions(state: GameState, map: MapDef, seat: Seat): readonly ActionKind[];

  // ---- the selectors the HUD and the runner actually read ----
  reinforcementsFor(state: GameState, map: MapDef, seat: Seat): {
    base: number; continents: readonly ContinentId[]; bonus: number; capitals: number; total: number;
  };
  legalAttackTargets(state: GameState, map: MapDef, from: TerritoryId): readonly TerritoryId[];
  legalFortifyMoves(state: GameState, map: MapDef, from: TerritoryId): readonly TerritoryId[];
  legalDraftTargets(state: GameState, seat: Seat): readonly TerritoryId[];
  cardSets(cards: readonly Card[]): readonly (readonly [string, string, string])[];
  cardTradeValue(cards: readonly Card[], setsTradedTotal: number, scheme: CardBonusScheme): number;
  mustTradeNow(state: GameState, seat: Seat): boolean;
  diceAugmentFor(state: GameState, map: MapDef, from: TerritoryId, to: TerritoryId): DiceAugment;
  dicePlan(state: GameState, map: MapDef, from: TerritoryId, to: TerritoryId): {
    maxAttackDice: 1 | 2 | 3; defendDice: 1 | 2 | 3 | 4;
  };
  territoryCounts(state: GameState): readonly (number | null)[];
  troopCounts(state: GameState): readonly (number | null)[];
  continentsHeldBy(state: GameState, map: MapDef, seat: Seat): readonly ContinentId[];
  isGameOver(state: GameState): boolean;

  // ---- fog, hashing, serialisation ----
  viewFor(state: GameState, map: MapDef, seat: Seat): GameState;
  hashState(state: GameState): string;
  serializeState(state: GameState): string;
  deserializeState(json: string): GameState;

  // ---- the resolver, plus the one PRNG entry point ----
  dealTerritories(
    map: MapDef, config: GameConfig, personas: readonly (BotPersona | null)[],
    rngs: { deal: Rng; turnOrder: Rng; modifierPlace: Rng },
  ): Extract<Action, { type: "GAME_STARTED" }>;
  rollAttack(
    state: GameState, map: MapDef, intent: AttackIntent, rng: Rng,
    odds: OddsTables, diceMode: DiceMode,
  ): Extract<Action, { type: "ATTACK" }>;
  drawCard(
    state: GameState, map: MapDef, seat: Seat, rng: Rng,
  ): Extract<Action, { type: "CARD_DRAWN" }>;
  movePortals(
    state: GameState, map: MapDef, rng: Rng,
  ): Extract<Action, { type: "PORTALS_MOVED" }> | null;
  /** `index` = the seq of the action being produced, never `state.turn`; personas/deal at 0. */
  rngFor(seed: string, purpose: RngPurpose, index: number): Rng;
}

/** The real one: every member bound straight from `@/engine`. */
export const engineApi: EngineApi;
```

`placeModifiers` is deliberately **absent** — `dealTerritories` calls it (§4.11) and the runner never
does. `pcg32` is absent for the same reason: the runner only ever asks for a sub-stream. `canonicalize`
is absent because only `hashState` and the desync path need it, and both live behind `hashState`.

### 4.16 Ports and adapters

```ts
// src/ports/sync.ts — the INTERFACE and its data shapes, owned by S4 (F30).
// The polling ADAPTER is src/net/pollingSync.ts, owned by S5. S4 never imports src/net/**.

export type SyncStatus = "offline" | "idle" | "polling" | "behind" | "desynced";   // (F31)

export interface SyncPort {
  /** One poll. Resolves when the response has been folded in. */
  poll(): Promise<void>;
  /** Submit an already-resolved action; resolves with the authoritative action(s). */
  submit(action: Action, clientActionId: string): Promise<readonly LoggedAction[]>;
  /**
   * Submit an ATTACK **intent** and let the authority roll (F11). The client must not predict dice
   * (§5.5), so this — not `submit` — is the attack path online. Resolves with the authoritative
   * ATTACK action carrying the numbers.
   */
  submitIntent(intent: AttackIntent, clientActionId: string): Promise<readonly LoggedAction[]>;
  onActions(listener: (actions: readonly LoggedAction[]) => void): () => void;
  onStatus(listener: (status: SyncStatus) => void): () => void;
  /**
   * The caller's masked snapshot, when the authority sent one instead of a delta (§5.5, F36).
   *
   * The third argument is optional and additive: rows the listener should play the **events** of
   * without folding them or moving `seq`. A fog game's snapshot is a masked view, and the actions
   * behind it ride along purely so the board can animate what just happened.
   */
  onSnapshot(
    listener: (snapshot: GameState, snapshotSeq: number, animate?: readonly LoggedAction[]) => void,
  ): () => void;
  setIntervalMs(ms: number): void;
  readonly seq: number;
  close(): void;

  // ---- added after S5 shipped; both OPTIONAL, so the existing adapter still satisfies the type --

  /**
   * Throw this client's folded state away and start again from the authority (§5.8, D16).
   *
   * The adapter resets its action cursor to **0**, polls once, and lets the authority answer with a
   * masked snapshot, which the session folds through `ingestSnapshot` and nothing else. Idempotent
   * and safe to call while a poll is in flight, because a desync is exactly when polls race.
   * Absent, the session falls back to `setIntervalMs` + `poll` — which nudges the cadence but
   * cannot reset the cursor, so it is a degradation, not a fix.
   */
  resync?(): Promise<void>;

  /**
   * Resign this seat (D76). The authority owns the action — `SEAT_TO_BOT { reason: "resigned" }` —
   * because it has to re-seat the bot and re-time the turn, so it goes to its own route and **not**
   * through `submit`, which refuses a client-submitted `SEAT_TO_BOT`.
   */
  resign?(): Promise<readonly LoggedAction[] | void>;
}

export interface LoggedAction {
  readonly seq: number; readonly seat: Seat; readonly action: Action;
  readonly actor: "human" | "bot" | "server";
  readonly clientActionId: string | null; readonly stateHash: string;
}

/** One roster row's online-ness, straight off POLL 3's `presence` (F26). */
export interface PresenceRow {
  readonly seat: Seat; readonly standing: Standing;
  readonly online: boolean; readonly missedTurns: number;
}

/** One chat line as it is READ. Shared verbatim by all three polls (§6). (F26) */
export interface ChatLine {
  readonly id: number;
  readonly scope: "global" | "lobby" | "game";
  readonly displayName: string;
  readonly lineId: number | null;      // the 42-line roster index (§7.3)
  readonly emoji: string | null;       // or one of the 8 glyph ids; exactly one of the two
  readonly createdAt: string;          // ISO 8601
}

/** One chat line as it is WRITTEN — exactly one of the two fields, never free text (F26, R-chat). */
export type ChatSend = { readonly lineId: number } | { readonly emoji: string };

// src/net/pollingSync.ts — S5's adapter, the only implementation in v1 (D10)
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

**Database.** Ownership splits inside one directory and the split is exact (F24): **S0 owns
`src/adapters/db/{driver,index,neon,pglite}.ts`** *(scaffold, DONE)* and no slice reopens them; **S5
owns `schema.sql` and the regenerated `schema.ts` outright** — not as an edit to a scaffold file, but
as its own file, replacing the placeholder wholesale (§6.2). `schema.ts` is generated, never
hand-edited: `pnpm run build:schema` regenerates it from `schema.sql` and the diff is committed.

`src/adapters/db/driver.ts` defines `SqlValue`, `SqlRow`, `SqlExecutor`,
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
fire on a deployment. It **already declares `RISK_TURN_SECONDS` and `RISK_FIXED_SEED`** — landed by
S0, **DONE** (F29), together with their `playwright.config.ts` pins (§4.3) and their `.env.example`
entries. S5 reads them and adds no env key of its own.

---

## 5. Data flow

### 5.1 Starting a game (all three modes)

`/new/rules` holds a `GameConfig` in the `sessionConfig` store. On BATTLE:

1. **Load the map** with a per-slug dynamic import through `src/content/maps/index.ts`'s loader map —
   `await loadMapFile(slug)`, never a barrel import, so one board's geometry never ships with another's
   page (D40) — then `loadMap(file)` to get the `MapDef`.

   **This step is unconditional and comes first, on the server as well as the client** (F44). `apply`,
   `validate`, `legalActions` and every selector take the `MapDef` (§4.10), and `GameState` carries
   only `mapSlug` (§4.7), so **the map is resolved from `mapSlug` via `loadMapFile` before any fold
   happens** — before `createInitialState` offline, and in the API route and the lazy tick before they
   fold the log online (§5.5, §5.6). There is no path on which a state is folded without its map, and
   no cached global map: each handler resolves the slug for the game it is serving. The resolved
   `MapDef` is memoised per slug per process, because `loadMap` is pure.
2. **Mint the seed.** Offline: `crypto.randomUUID()` in the runner, written into the autosave.
   Online: the server mints it into `games.seed` and it never leaves (D5). `RISK_FIXED_SEED` overrides
   it for e2e.
3. **Draw the personas, then resolve the opening** — in that order, because the deal takes the
   personas as an argument (F3, F39):

   ```ts
   const personas = drawPersonas(                           // @/engine/bots — S2's, not the resolver's
     config.seats.map(s => s.tier),
     rngFor(seed, "personaAssign", 0),
     rngFor(seed, "personaJitter", 0),
   );
   const started = dealTerritories(map, config, personas, {  // the whole GAME_STARTED action
     deal:          rngFor(seed, "deal", 0),
     turnOrder:     rngFor(seed, "turnOrder", 0),
     modifierPlace: rngFor(seed, "modifierPlace", 0),
   });
   ```

   `dealTerritories` runs R3's fixed order internally — seat order → blizzards and portals → the deal
   over the non-blizzard territories → capitals from each seat's own dealt territories — and returns
   seat order, the deal, starting armies, blizzards, portals and capitals in one action (D4).
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
                   →  rollAttack(state, map, intent, rngFor(seed, "battle", nextSeq), odds, diceMode)
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
   view for an honest persona, the authoritative state for Expert (`fogHonest: false`, D31). `seat`
   and `persona` land on the view as `view.me` and `view.persona` (F20);
2. calls <code>decideTurn(view, odds, rngFor(seed, \`bot:${seat}\`, nextSeq))</code> **synchronously** —
   a template literal, matching `RngPurpose`'s `` `bot:${number}` `` member exactly (F18), never a
   hand-built `"bot:" + seat` concatenation;
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
reuses it verbatim on every retry (D15). It then `POST`s to `/api/games/:id/actions`, whose body is a
**discriminated union of the two things a client can send** (F11):

```ts
type ActionPost =
  | { clientActionId: string; kind: "action"; action: Action }
  | { clientActionId: string; kind: "intent"; intent: AttackIntent };
```

`kind: "action"` is every non-dice action, already resolved client-side and applied
**optimistically** into `pendingActions`. `kind: "intent"` is an attack and is **never** applied
optimistically — the client must not predict dice, so `syncPort.submitIntent(intent, id)` sends the
intent, plays the tumbling-dice animation, and resolves when the authoritative `ATTACK` returns with
the numbers. That is exactly what the original's UI does. The server rejects a `kind: "action"` body
carrying an `ATTACK` with `422 { code: "illegalAction" }`: dice are the authority's to roll.

**Append**, one transaction over the WebSocket pool:

```
begin;
  select seq, snapshot, snapshot_seq, current_seat, phase, status
    from games where id = $1 for update;          -- the fence that stops a double-clicked Attack
                                                  --   racing two inserts for seq+1
  authorise: cookie → player → game_players.seat; 403 if no seat, 409 if seat <> current_seat
  map = loadMapFile(games.map_id) |> loadMap            -- memoised per slug per process (§5.1)
  fold forward to `state`; validate(state, map, action) → 422 on a RuleError
  roll the dice server-side (rollAttack with rngFor(games.seed, "battle", seq+1)) and splice
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

**Client fold — and the one place fog changes it.** `hashState` asserts `state.fogged === false` and is
only ever computed over authoritative state (§4.10, F36). A client in a **fog** game is *given* a
masked view, so it has nothing to hash and, having been told nothing about the territories it cannot
see, nothing it could correctly fold either. **Hence two modes, chosen by `rules.fogOfWar`, and
nothing in between:**

**Non-fog games — delta fold plus the hash assertion, exactly as designed:**

```
confirmedState  = fold(apply, snapshot, actions)          // authoritative, fogged === false
pendingActions  = my optimistic actions, not yet confirmed
displayedState  = fold(apply, confirmedState, pendingActions)

on each response, for each action in seq order:
  if action.clientActionId is mine  → drop it from pendingActions
  confirmedState = apply(confirmedState, map, action).state
  assert hashState(confirmedState) === action.stateHash
displayedState = fold(apply, confirmedState, pendingActions)
```

**Fog games — snapshot every time, no fold, no hash** (F36 **[SPEC]**). When `rules.fogOfWar` is
true, **every non-204 game poll returns the caller's masked view snapshot** with
`snapshotSeq === seq`, plus the actions since `since` **for animation only**:

```
on each response (fog):
  if action.clientActionId is mine  → drop it from pendingActions
  confirmedState = response.snapshot        // viewFor(authoritative, map, mySeat); fogged === true
  // NO apply(), NO hashState(), NO stateHash comparison — there is nothing valid to compare
  queue response.actions into the animation queue, in seq order
displayedState = fold(apply, confirmedState, pendingActions)   // my own moves only, all visible to me
```

**The fog action list is REDACTED** (codex round 1, finding 17 **[SPEC]**): `GAME_STARTED` is omitted
entirely; an action naming any territory the viewer cannot see (not owned, not adjacent) arrives as
exactly `{ type: "HIDDEN", seat }`; another seat's card award arrives as
`{ type: "CARD_DRAWN", seat, card: null }`. The client animates what it can and folds nothing — an
unknown `type` or a null card is a no-op, never a desync. The raw rows stay in the log, so the
debug route and the server fold are unaffected.

The cost is one masked snapshot per changed poll instead of a delta — paid only by fog games, which
are the opt-in minority, and §6.4's envelope absorbs it because the 204 path is untouched and a
masked snapshot of a 42-territory board is ~2 KB. The correctness win is that **no client ever
hash-checks a state it was not given in full**, which is the only way the §5.8 desync assertion stays
a real bug detector rather than a false alarm that fires on every fog game.

A dropped, duplicated or out-of-order response is handled by the same code in both modes: `seq` is the
only thing that orders anything, actions at or below `since` are never re-applied, and a non-fog client
behind the compaction horizon gets a snapshot. The client never reasons about the network.

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
    no  → seq === n ? 204 : respond (see the two modes below)
    yes → UPDATE games SET tick_lease = now() + interval '10 seconds'
            WHERE id = $1 AND (tick_lease IS NULL OR tick_lease < now()) RETURNING seq;
          0 rows ⇒ another poll is already ticking → answer from the log, next poll picks it up
          map = loadMapFile(games.map_id) |> loadMap     -- before ANY fold (§5.1, F44)
          fold snapshot + actions > snapshot_seq → state
          grudge = games.bot_memory                      -- the bots' cross-turn memory (F43)
          loop at most MAX_TICK_ACTIONS = 40 times:
            action = isBot(seat) ? botAction(state, map, seat, grudge)
                                 : autoSkip(state, map, seat)
            state  = apply(state, map, action).state ; append with seq+1 and state_hash
            stop when the current seat is a live human, or the game ends
          UPDATE games SET seq, snapshot, snapshot_seq, state_hash, current_seat, phase,
                           turn_deadline, bot_memory = grudge, tick_lease = NULL
  respond:
    rules.fogOfWar ? { seq, snapshot: viewFor(state, map, yourSeat), snapshotSeq: seq,
                       actions where seq > n }                        -- view mode (F36)
                   : actions where seq > n                            -- delta mode
                     (now including the bots')
```

The 40-action cap matters because a chain of three consecutive bot seats is not a handful of actions:
cap it, return what was done, and let the next poll 2 s later continue. The player sees the bots move
in sequence, which is better than a frozen four-second request.

**Turn timer, leaving and reconnect are one mechanism**, and **every step is a row in the action log,
never a side effect** (D14):

| Condition on the tick | What the server appends |
|---|---|
| `turn_deadline` passed with a **forced trade** owed (R24 at turn start, or R26's trade-down mid-flight) | `TRADE_CARDS` with the first set the hand holds and no R23 bonus — it is the **first** candidate offered, because it is the one state in which `validate` refuses every other action, so without it the tick appended nothing and a present-but-idle seat held the game up indefinitely **[SPEC]** |
| `turn_deadline` passed and the phase has a legal "do nothing" | the server **walks the phases**: `END_PHASE` first, `END_TURN` only when `END_PHASE` is illegal (fortify), `missed_turns += 1` |
| `turn_deadline` passed with troops still undrafted | `AUTO_DEPLOY` (placements chosen by the bot policy), then the same walk — `END_PHASE` first, `END_TURN` only when `END_PHASE` is illegal (fortify), so a capturing turn still reaches fortify and earns its card (R20, R67) |
| `missed_turns >= 2` (they are still polling — just not playing) | `SEAT_TO_BOT { reason: **"timeout"** }`, `game_players.kind='bot'`, `standing='away'` |
| `last_seen_at` older than 2 min (they are gone, whatever their turn count) | `SEAT_TO_BOT { reason: **"away"** }`, `kind='bot'`, `standing='away'`. This branch sits **above** the timeout one and produces that one action and nothing else, so it is the branch R28's hand guard has to exempt: a seat that went away owing a 7-or-8-card trade-down could not be handed over, the tick returned `appended === 0`, and the `missed_turns` escape below is never reached from here (only the *timeout* branch counts a miss) **[SPEC]** |
| that player polls again (either path) | `SEAT_TO_HUMAN`, `kind='human'`, `missed_turns = 0` |
| `POST /api/games/:id/resign` | `SEAT_TO_BOT { reason: "resigned" }`, `standing='resigned'` — **never reclaimable** (R82) |
| every human seat away for 30 min | `games.status = 'abandoned'`; the bots simply stop being run |

`missed_turns` is written **before** the tick's empty-handed exit, not after it: a tick that counts a
miss and then finds nothing legal to append is exactly the case the counter exists for, and dropping
that increment means `missed_turns` never reaches 2, the seat never changes hands, and the game stands
still for as long as the seat keeps polling. There is no state or action row to commit on that path —
only the column moves. **[SPEC]**

The miss counter is also only **cleared by playing**: `POST /api/games/:id/actions` resets it for the
acting seat *on its own turn*, never for an off-turn `ALLIANCE_*` POST, which the turn fence exempts
(R80, §6). Otherwise a seat could keep its counter at zero with diplomacy alone and never take a
turn. **[SPEC]**

So a client renders "Napoleon went away — the bot took over" from the log, exactly as it renders a dice
roll, and a replay reproduces it identically. **The three `SEAT_TO_BOT` reasons all stay** (F54) and
each has exactly one producer: **`"timeout"`** for the missed-turns path (they are present but not
playing — the UI says *"ran out of time"*), **`"away"`** for the unseen-for-2-minutes path (*"went
away"*), and **`"resigned"`** for `POST /resign`, the only one that is never reclaimable (R82). Two
different causes with two different copy lines must not share one enum member.

### 5.7 Round-start work

At the start of each round — **the condition is `round` increasing**, compared across the `END_TURN`
apply (`roundBefore !== state.round`), *not* `currentIndex === 0`: `nextTurnIndex` skips eliminated
seats, so once `turnOrder[0]` is out the wrap lands on index 1 or later and a `currentIndex === 0`
gate silently stops firing for the rest of the game — the authority (the session runner offline, the
tick or the submitting handler online) asks
`movePortals(state, map, rngFor(seed, "portalMove", nextSeq))`. It returns a `PORTALS_MOVED` action when
`rules.portals === "unstable"` and `round % 3 === 0`, and `null` otherwise. The action is appended
before the round's first seat acts, so `activeFrom = round + 1` is already visible to everyone (R76).

### 5.8 Desync

Every action row carries `state_hash` over a **canonical** serialisation of the **authoritative,
unmasked** state (sorted keys, integers not floats, no `undefined`) — `hashState` asserts
`fogged === false`, so there is never a per-viewer hash (F36). **In a non-fog game** the client
asserts after each apply; on mismatch it does **not** reconcile: it drops local state, refetches the
snapshot, sets `syncStatus: "desynced"` and makes it loud (a console error, and a thrown error in
dev). A desync is a bug in `apply`, and the only useful response is loud and recoverable (D16).

The resync ask is **de-duplicated, not one-shot**: one ask is in flight at a time, and the latch is
released when a snapshot lands, when the port's `resync()` rejects, and in any case after 10 s. An
ask that is refused, dropped, or answered by an adapter that cannot actually rewind its cursor must
not leave the session unable to ask ever again.

**In a fog game the client does not fold and therefore cannot desync** (§5.5): it is handed a masked
snapshot at `snapshotSeq === seq` on every changed poll, so `syncStatus` never reaches `"desynced"`
there. That is a property the client enforces for itself, not a promise it extracts from the
authority: a batch of action rows that arrives while the confirmed state is a masked view is
replayed **for its events only** — against a scratch copy, tolerating every refusal, with `folded`,
`nextSeq` and the confirmed state all left where they were — and a snapshot is asked for. `apply` is
never called on a `fogged: true` state in a way that can move the fold, because a view's numbers are
not a state any authority ever held. The hash is still written on every row and is still asserted — by the **server**, which folds
the authoritative state anyway, and by **T10.1**, which replays the whole log off the debug route
(§6) and compares every `state_hash`. Fog removes the client-side assertion, not the guarantee.

### 5.9 Chat

Preset-only, and **not an action**. `POST /api/chat { scope, scopeId, ...ChatSend }` is the single
write; every read rides one of the three polls. **`ChatSend` is `{ lineId }` or `{ emoji }` — exactly
one, and never free text** (§4.16, F26): the client sends an *index*, the server resolves the display
string from the 42-line roster or the 8 emoji ids, and `chat_messages` has no `body` column at all
(§6.2, D41). There is therefore no free-text path anywhere in the app, by construction rather than by
validation. A line
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
| `/api/games/:id/actions` | POST | cookie | **`{ clientActionId, kind: "action", action }`** or **`{ clientActionId, kind: "intent", intent }`** (F11) | `200 { seq, actions: [LoggedAction] }` | `400` · `401` · `403` not seated · **`409`** not your turn · **`422 { error, code: RuleErrorCode }`** rule violation · `404` |
| `/api/games/:id/actions` | GET | cookie, **debug only** | `?from=<seq>` | `200 { actions: LoggedAction[] }` — the **raw, UNMASKED** log from `from+1`, including the **seedless** `GAME_STARTED` (F37) | **`404` unless `NEXT_PUBLIC_RISK_DEBUG === "1"`** · `401` · `403` not seated |
| `/api/games/:id/resign` | POST | cookie | — | `200 { seq, actions: [SEAT_TO_BOT] }` | `401` · `403` · `404` · `409` already finished |
| `/api/chat` | POST | cookie | `{ scope: "global"\|"lobby"\|"game", scopeId, lineId?, emoji? }` | `201 { id }` | `400` unknown line/emoji · `401` · `403` not in that scope |
| `/api/health` | GET | — | — | `200 { ok: true }` after one `select 1` | `503` on a driver error |
| `/api/cron/sweep` | GET | Vercel cron | — | `200 { swept: {...} }` | `401` without the cron header |

**`SeatPatch`** (host-only, in `PATCH /api/lobbies/:code`): `{ seat, kind: "open"|"bot", tier?: BotTier }`
to add or remove a bot, or `{ seat, kind: "open" }` to kick the occupant.

**`GET /api/games/:id/actions` is the determinism proof's only door** (F37 **[SPEC]**). POLL 3 returns
the caller's **fog view**, which is exactly what a replay check must not be given, so the proof needs
a route that returns the log as stored: unmasked payloads, every `state_hash`, and the `GAME_STARTED`
row **with `games.seed` still absent from it** — the seed is a column, never a payload field (D5,
§6.2), so there is nothing to strip and nothing that can leak. The route is **gated on
`NEXT_PUBLIC_RISK_DEBUG === "1"` and returns `404` otherwise**, so it does not exist in production,
and it still requires a cookie and a seat in that game. **T10.1 drives it on a non-fog game**, folds
from `seq = 0` and asserts `hashState` against every row.

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
//   seq === since            → 204 No Content, no body, ETag: W/"<seq>"      (BOTH modes)
//
//   rules.fogOfWar === false (delta mode):
//     since >= snapshot_seq    → { seq, fromSeq, actions, ... }                     (delta)
//     0 < since < snapshot_seq → { seq, snapshot, snapshotSeq, actions, ... }        (compacted past)
//     since === 0              → { seq, snapshot, snapshotSeq, actions: [], ... }    (cold client)
//
//   rules.fogOfWar === true (view mode, F36): EVERY non-204 response carries the caller's masked
//     snapshot with snapshotSeq === seq, plus `actions` since `since` FOR ANIMATION ONLY.
//     The client never folds them and never hash-checks (§5.5).
//                              → { seq, snapshot, snapshotSeq: seq, actions, ... }
interface GameSync {
  seq: number;
  fromSeq?: number;
  /** Fog game: `viewFor(authoritative, map, yourSeat)` — masked, `fogged: true`, not hashable.
   *  Non-fog game: the authoritative state, `fogged: false`, because the client must hash it to
   *  keep folding (F12 ∧ F36; see the note under this block). */
  snapshot?: GameState;
  snapshotSeq?: number;
  actions: LoggedAction[];
  presence: PresenceRow[];       // from src/ports/sync.ts (F26)
  turnDeadline: string | null;   // ISO 8601
  chat: ChatLine[];              // from src/ports/sync.ts (F26)
  you: { seat: number | null; cards: Card[] };
  status: "playing" | "finished" | "abandoned";
}
```

`PresenceRow` and `ChatLine` are **declared once**, in `src/ports/sync.ts` (§4.16, F26); all three
polls and `GameSync` reference those declarations rather than restating the shape. `LoggedAction` is
from the same file.

`ETag: W/"<seq>"` plus `If-None-Match` make the 204 path a string compare. **204-on-no-change is the
cost design and the correctness design at the same time**: a delta-returning poll co-binds Active CPU
with the invocation line at ~1.4 M polls, while a snapshot-returning poll binds first at 576 K (D12).
In a non-fog game the snapshot is sent only to a cold client or one behind the compaction horizon; in a
**fog** game it is sent on every changed poll (F36). The 204 path, which is the common case and the
whole cost argument, is identical in both modes.

**What the snapshot contains differs between the two modes, and it has to** (F12 ∧ F36). `viewFor`
always empties other seats' hands and always sets `fogged: true`, so its output can never be hashed:

- **fog game** → the snapshot **is** `viewFor(state, map, yourSeat)`: masked territories, emptied
  hands, `fogged: true`. The client does not fold it and does not hash it (§5.5).
- **non-fog game** → the snapshot is the **authoritative** state, `fogged: false`, because the client
  *must* hash it to continue the §5.5 fold — and it reveals nothing the client was not already
  getting, since a non-fog client replays the whole action log including every `CARD_DRAWN`. Hands
  are hidden from the *UI* by the renderer, not from the wire, in a mode where the client is the
  folding authority. A game that wants hands genuinely off the wire turns fog on.

`games.seed` is absent from both, in both modes, because it is a column and never a payload (D5).

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
after trimming, `^[A-Za-z0-9][A-Za-z0-9 ._-]*$`.

**Colour is a NAME, never a hex, on the wire and in the database** (F8). `PlayerColour` is the
nine-member name union (§4.4) and that is what `POST`/`PATCH /api/session` accept and return, what
`lobby_seats` and `game_players` store, and what `data-owner` carries in the DOM (§8). The `zod`
schema is `z.enum(["red","green","blue","yellow","orange","pink","black","white","purple"])` and the
database `check` is `color in ('red',…,'purple')` — not a hex pattern. **Every hex lives in exactly
one place: `globals.css`'s `--p-<name>` token family** (`--p-red`, `--p-red-light`, `--p-red-dark`,
`--p-red-wall`, `--p-red-hot`, `--p-red-on`), so re-tuning a palette value is a one-line CSS change
that cannot invalidate a stored row, and no component or API response ever repeats a colour literal.
§8's table is documentation of those tokens, not a second source.

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
  check color in ('red','green','blue','yellow','orange','pink','black','white','purple')
                 -- a PlayerColour NAME, never a hex (F8). The hex lives only in globals.css's
                 -- --p-<name> tokens, so a palette change touches no row and no response.
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
               bot_memory jsonb not null default '{}'::jsonb,
                           -- the bots' cross-turn memory: `{ "<seat>": { "grudge": number[] } }`,
                           -- §4.13's grudge vector per bot seat, carried into makeView's `grudge`
                           -- argument. WRITTEN BY THE LAZY TICK, inside the same transaction that
                           -- appends the tick's actions, so it can never disagree with `seq`.
                           -- NOT game state: it is never hashed, never serialised into a snapshot
                           -- and never returned by a poll, so losing it degrades bot flavour and
                           -- nothing else. Offline the same vector rides the autosave envelope
                           -- (`SavedSession.grudge`, §4.15). (F43)
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
  check actor in ('human','bot','server') · check seq > 0
  check seat between -2 and 5   -- -1 = SEAT_NONE, -2 = SEAT_NEUTRAL (§4.4, F5): a server-resolved
                                -- row can legitimately name the neutral holding
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
| `/play/online/[gameId]` | **Game**, online. The *same* `GameScreen` with the online props supplied: `SyncPort` wired, the turn-timer bar live, presence dots on roster rows, and the chat drawer enabled. S5 **composes**; it builds no game UI. | S5 (route), S4 (screen) |
| — | **Victory / Defeat**, a full-screen overlay on the game route. | S4 |

**One game screen, one owner** (F26). `src/components/game/GameScreen.tsx` is **S4's**, and S4 builds
**every** part of it — including the three pieces only an online game uses: the **turn-timer bar**
(§7.1's 4 px drain), the **presence dots** on the roster capsules, and the **chat drawer** (§7.3). S4
develops all three behind fixtures, with no `SyncPort` and no network, driven by an explicit prop bag:

```ts
export interface GameScreenProps {
  readonly session: Session;
  // ---- online only; every one of these is absent or null offline ----
  readonly sync?: SyncPort | null;
  readonly presence?: readonly PresenceRow[];
  readonly turnDeadline?: string | null;        // ISO 8601, straight from POLL 3
  readonly chat?: readonly ChatLine[];
  readonly onChat?: (line: ChatSend) => void;
}
```

`PresenceRow`, `ChatLine` and `ChatSend` are S4's too, declared in `src/ports/sync.ts` (§4.16). **S5's
`/play/online/[gameId]` is a composition and nothing else**: it creates the `SyncPort`, holds the poll
response, and passes `presence`, `turnDeadline`, `chat` and `onChat` down. No timer, no dot and no
drawer is implemented twice, and S4 can ship the whole screen before any route exists.

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
rim), `-hot` (selected), `-on` (text on the colour). **`globals.css` is the only place these hexes
exist** (F8): `PlayerColour` is the name union everywhere else — wire, database, `data-owner` — and
the table below documents the token values rather than duplicating them (§6.1).

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

#stage            { transform: perspective(1400px) rotateX(4deg); transform-origin: 50% 55%; }
#stage[data-view="battle"] { transform: perspective(1400px) rotateX(18deg); }
#board            { transform: translate(var(--pan-x), var(--pan-y)) scale(var(--zoom)); }
.token, .label    { transform: translate3d(var(--x), var(--y), 0)
                               rotateX(calc(-1 * var(--tilt))) scale(calc(1 / var(--zoom))); }
```

**The coordinate contract** (F40 **[SPEC]**) — pinned here because three files project points
(`render/tokens.ts`, `render/camera.ts`, `game/input.ts`) and two of them must agree with the third
to the pixel:

1. **Map units are CSS pixels, 1:1, before the camera.** The **board wrapper** (`#board`) is sized to
   the map's own `MapFile.viewBox` — **origin honoured**, so a `viewBox` of `"0 8 1024 643"` means a
   1024×643 wrapper whose content is offset by `(0, −8)`, not a 1024×651 one. The `<svg>` inside uses
   that same `viewBox`, so one map unit is one CSS px at `zoom = 1`.
2. **The camera is two transforms on two elements, and nothing else.** `translate(pan) scale(zoom)` on
   the **wrapper**; `perspective(1400px) rotateX(θ)` on an **outer stage** (`#stage`) that the wrapper
   sits inside. Pan and zoom therefore never interact with the perspective matrix, and the tilt is one
   number the whole scene shares.
3. **Tokens and labels live INSIDE the wrapper**, not in a sibling layer above it — so they pan and
   zoom with the map for free, positioned at raw map coordinates by `translate3d`. Each then applies a
   **counter `rotateX(-θ)`** (so it faces the viewer rather than lying on the tilted plane) and a
   **`scale(1 / zoom)`** (so it keeps a fixed *screen* size however far you zoom in — §8's "fixed
   screen-space size per map"). This supersedes "tokens and labels are HTML above the SVG": they are
   still HTML, still outside the `<svg>`, but inside the same transformed wrapper.
4. **`render/camera.ts` exports the only projection, and both other files call it:**

   ```ts
   export interface Camera { pan: readonly [number, number]; zoom: number; tilt: number }
   /** map units -> client (screen) px, through pan, zoom and the tilt. */
   export function toScreen(cam: Camera, pt: readonly [number, number]): readonly [number, number];
   /** The exact inverse: client px -> map units. */
   export function toMap(cam: Camera, pt: readonly [number, number]): readonly [number, number];
   ```

   `tokens.ts` positions with `toScreen`; `input.ts` hit-tests with `toMap`. Neither re-derives a
   matrix, and a unit test asserts `toMap(toScreen(p)) ≈ p` across the zoom and tilt ranges — the
   cheapest possible guard against a tap landing one territory away from the finger.
5. **Pan is clamped so the board always covers the viewport**, and **minimum zoom is the cover
   scale** — `max(viewportW / boardW, viewportH / boardH)` — so the ocean never runs out and no letterbox
   is ever visible. `0` resets to cover, centred (§9).

**Land is filled per OWNER, not per continent** — the single most important finding, and it contradicts
the board game. Continent identity appears only in the Continent Overlay and as a perimeter glow on a
continent you fully hold. Off-board land is `--land-neutral`. Coastlines read 12–14 px near-black and
internal borders 4–7 px; both come from the 3 px per-territory stroke plus the +7 px union offset, not
from thicker strokes. **Keep the `d` strings chunky — 12–30 vertices per territory** with visibly
straight runs and angular corners; real coastlines look wrong. **The camera is those two `transform`s
and nothing else: no real 3D** (see the coordinate contract above).

**Tokens and labels are HTML, not SVG children** — so they use normal text rendering and
`-webkit-text-stroke`, and they are animatable and accessible — but they sit **inside the board
wrapper**, carrying the counter `rotateX(-θ)` and `scale(1/zoom)` of the coordinate contract above, so
they pan and zoom with the map while staying upright and screen-sized. Each territory carries two
precomputed anchors — a **token** point and a **label** point
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
`TerritoryId` (`document.elementFromPoint` on the `.territory` paths, with the point taken back to map
units by **`camera.toMap`** — the single projection of §8's coordinate contract, never a second
inverse-transform written here), and a drag beyond 8 px becomes a pan rather than a tap. Pinch and
wheel both change one `camera.zoom`; pan is clamped and minimum zoom is the cover scale, so the board
always covers the viewport (§8). Every interactive control is at
least a 44 px touch target. Keyboard shortcuts are **additive and never required** — mobile has none
of them — and the three steppers/sliders exist because the original's own placement widget is a
stepper or slider, never free-text entry.

---

## 10. Efficiency plan

**Odds table init.** `createOdds` builds **exactly one** `W[A][D]` table eagerly — **standard 3v2,
ties to defender**, 129×129 as a `Float32Array`, 65 KiB, ~2 ms (measured 2.07 ms / 80 KiB at 101×101
and 1.80 ms / 316 KiB at 201×201 in `Float64Array`) — shared across every bot and every session.
Lookups measure **~1.15 ns** (5 M in 5.75 ms). **Every other augment is built lazily and memoised**
(F49): `defendDiceBonus: +1` only when a Capitals game first prices a capital, `+2` only when a
capital stacks with a wall, ties-to-attacker only if Zombies ever ship. Four eager tables would be
260 KiB and ~8 ms for three tables most games never read; one is 65 KiB and ~2 ms. Above the table,
only the standard augment has a logistic — the rest extend the DP on demand (R43, F48). **Never
Monte-Carlo a battle**: slower than a lookup, and it consumes PRNG draws.

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

**Fog games pay the snapshot price, deliberately** (F36). A fog game cannot let its clients fold —
they are only ever shown a masked view, and `hashState` asserts `fogged === false` — so every
**changed** poll returns the caller's masked snapshot instead of a delta (§5.5). That is the 576 K-poll
binding curve, not the 1.4 M one, **for fog games only**: the 204 path is unchanged and still carries
the common case, a masked 42-territory snapshot is ~2 KB (well inside T12's 1 KB-per-delta guard being
scoped to deltas), and fog is an opt-in modifier rather than the default. Trading some of a
non-default mode's headroom for "no client ever hash-checks a state it was not given in full" is the
right way round.

**Render loop.** One SVG board, one `<path>` per territory, one CSS variable per owner — a capture is a
`data-owner` attribute change and a 240 ms `fill` transition, not a re-render. Tokens and labels are an
HTML layer positioned by `translate3d` **inside** the board wrapper, so pan and zoom move them with no
per-token work at all; the counter `rotateX(-θ)` and `scale(1/zoom)` are two CSS variables the camera
writes once per frame, not per token (§8's coordinate contract). The whole camera language is
`translate(pan) scale(zoom)` on the wrapper plus `perspective() rotateX()` on the stage — two
composited transforms, no layout, and **one** projection function (`camera.toScreen` / `toMap`) shared
by the token layer and the input layer, so there is no second matrix to drift. Repaint only on the
session's **dirty flag** plus a slow ~500 ms ambient bucket, and **never
pass the live `GameState` through React state** — a territory map painted from `apply()`'s output must
not go through React's render cycle, or clicking a territory visibly lags behind a re-render.

**Map loading and bundle.** Map JSON is **lazy-loaded per map** through a per-slug loader map, never a
barrel, so the initial bundle never contains 13 boards. Each shipped map stays **well under 100 KB**
after Douglas–Peucker simplification to 12–30 vertices per territory — which is both the correct art
direction and the cheap one. **The sizes are verified, not assumed** (F53 **[SPEC, measured]**):
Classic (42 territories) ≈ **25 KB**, the 59-territory board ≈ **36 KB**, and the largest generated
map (104 territories) ≈ **62 KB**, each as minified JSON before transport compression — so even the
densest board is ~38% of the 100 KB ceiling and the headroom is real rather than hoped for. A map that
exceeds 100 KB fails the build (T7). Natural Earth, world-atlas and us-atlas sources stay in
`research/map-data/` and in `scripts/maps/**` and are **never shipped to the client**. Targets: initial
JS under 200 KB gzipped for `/`, under 320 KB for a play route including the engine and the odds
tables; no map on the critical path.

**No server compute per turn offline.** Solo and pass-and-play run entirely client-side, so Vercel
serves static assets plus the §6 routes only.

---

## 11. Testing

`pnpm run verify` = `typecheck && lint && test`. Numbered so a slice can claim a specific gate.

**T1 — Layering** (`src/engine/layering.test.ts`, scaffold, build-failing and self-testing). Asserts
§4.1's five bans across `src/engine/**` read off disk, reading `ENGINE_ENTRY_POINTS` **and**
`ALLOWED_PACKAGES` from `src/engine/entryPoints.ts` rather than from a literal of its own (F21/F22),
and asserts that every entry point names a file that exists and that `polylabel` is imported **only**
under `src/engine/map/**`. **T1b** asserts `topojson-client`, `mapshaper` and `d3-geo` appear nowhere
under `src/`.

**T2 — Engine unit.** Every rule in §3, one fixture file per area: setup table and the 2-player
40/40/40 + 14/14/14 deal (R2–R7); the draft formula at 11→3, 14→4, 16→5, 17→5 (R12); Classic bonuses
3/7/2/5/5/2 (R13); blizzards still paying a bonus (R14); **the three card-timing branches as three
separate tests** (R24, R25, R26) and the mid-Attack trade-down bouncing to `draft` (R27); Fixed 4/6/8/10
and the +2 cap at 12 (R22, R23); Progressive 4,6,8,10,12,15,20,…,60 (R22); the conquest move range
(R63); connected-path fortify and the `END_PHASE`-out-of-fortify refusal (R66, R67); every modifier's
exact behaviour (R70–R80); the win-evaluation order and the Max-Rounds tiebreak flag (R78, R83); the
§3.11 invariants. Edge cases as their own tests: 2 troops → 1 die, 1 troop → no attack, defender with 1
troop → 1 die; **a 7-card hand returning `{ error: { code: "illegalAction" } }` rather than throwing**
(R28, F51); the capital augment being a no-op at `D ≤ 2`; augments stacking to 4 defender dice;
neutral armies never attacking or reinforcing, with **no `SeatState` for the neutral and no
`"neutral"` in `SeatKind`** (R7, F17); **`dealTerritories`' fixed order — a blizzard is never dealt
and a capital is always one of its seat's dealt territories** (R3, R8, R10, F39); the **odd 2-player
remainder placing 1 on its final step** and `CLAIM { forNeutral: true }` under Manual Placement (R6,
F50); and **the R27 trade-down bounce firing in the `MOVE_IN` branch after a conquest, and in the
`ATTACK` branch only when no move-in is pending** (F41) — two tests, one per path.

**T3 — Dice tables.** The **six single-roll distributions** against their exact fractions
(2890/2611/2275 over 7776 · 855/441 over 1296 · 295/420/581 over 1296 · 125/91 over 216 · 55/161 over
216 · 15/21 over 36); SMG's `0.292566872427984` for 3v2; the capital rows (3v3 = 13.7603 / 21.4699 /
26.4660 / 38.3038 %) and the stacked 3v4 row (7.3285 / 14.8359 / 23.4107 / 54.4249 %), both from
`research/05-bots-and-ai.md` §4.6; the
**300-attackers-vs-800 DP check `0.8897332621740284` asserted against the ZOMBIE-DEFENDER augment**
(`favourDefenderOnDraw: false`, defender 2 dice) — and, in the same test, that the **standard**
augment returns ~`2.4e-29` there, so the two can never be confused (R39, F38); the two self-computed
standard-augment oracles **`W[5][2] = 0.8897887238900141`** and
**`W[300][300] = 0.9517567082839995`** (F38); spot cells from the R41 table (1v1 41.67, 3v3
47.03, 5v5 50.62, 10v10 56.76, 20v12 94.29); the capital comparison **10v10: 56.76 / 19.02 / 5.31 %**;
every R42 break-even row and the nine-value `D = 1…9` `A = D+1` series (F56); the logistic's **max abs
error ≤ 0.0321, attained as 0.03205 at `(333, 400)`**, and **RMS 0.0088**, over `A,D ∈ [129,400]`
(F47); that the logistic is **not** consulted for a non-standard augment, which extends the DP instead
(F48); and a test that **independent clamping is not used** (129 v 381 must not read 85.65%).

**T4 — Balanced Blitz, bit-exact.** 30 attackers vs a capital held by 15, losing exactly 12. The
assertions are written exactly as (F55):

```ts
expect(trueRandom).toBeCloseTo(0.02221280017072782, 15);
expect(balancedBlitz).toBeCloseTo(0.0100282888709122, 15);
```

`toBeCloseTo(x, 15)` — not `toBe` — because `Math.pow` appears twice in the pipeline (R59) and is not
bit-identical across JS engines; 15 decimal places is tighter than any plausible engine difference and
still asserts every digit that matters. `0.02221280017072782` is the double our DP produces; SMG print
`0.0222128001707278`, and the two agree to well inside the tolerance. **This test is S2's acceptance
gate for the stage-3 ordering** (R52, F46).

**49** attackers is the fewest for ≥80% BB against 50 (47 → 72.03, 48 → 77.10, 49 → 82.15, 50 → 86.35);
a stage-2-only implementation gives 75.7% at A=49 and must fail. `20 v 15` BB is exactly 100%. The
stage-2 oracle at `p = 1.4`: 56.8 → 59.46, 43.2 → 40.54, 86.1 → 92.78. The R56 Δ table within 0.01 pp.

**T5 — Property (`fast-check`).** `∀ state. hashState(state) === hashState(roundTrip(state))`;
`apply` never throws on an arbitrary `(state, map, action)` triple and never mutates its input;
adjacency symmetry survives every modifier combination; troop conservation across a battle; `W[A][D]`
monotone in `A` and antitone in `D`; the quantised CDF walk at `u ∈ {0, ε, 0.5, 1−ε}` picking a fixed
outcome; **`decideTurn`'s draw count being a pure function of its inputs — 0 or 1, the same value
every time for the same `(view, odds, rng state)`, and exactly 0 whenever `persona.blunderRate === 0`
and no tie is broken — rather than one fixed constant for all inputs** (F57); `viewFor` never leaking a
hidden owner, a hidden count, or another seat's `cards` while still reporting the right `cardCount`
(F12); and `hashState` throwing on a `fogged: true` state (F36).

**T6 — Golden replays.** `(seed, mapSlug, rules, personaAssignment)` plus a `hashState` after every
turn, for a few hundred full bot-vs-bot games across all five tiers, stored as a versioned artefact.
A heuristic change that moves a hash must be an explicit, recorded change and must bump
`RULESET_VERSION`.

**T7 — Map validator.** `validateMap` run against **every shipped map** and the four fixtures:
symmetry, no dangling refs, geometry on every territory, complete continent membership, both anchors
present, the `viewBox` containing all geometry, slot counts in range, full connectivity, **a `suit` on
every territory with the three suit counts differing by at most 1** (F7), and **the minified JSON
under 100 KB** (F53). Plus the
Classic graph's own facts: 42 territories, 6 continents, **83 undirected edges — 74 land borders plus
the 9 sea links, counted after `loadMap`'s union, not 83 land borders and 9 more** (F45), the five
adjudicated edges (Afghanistan–India present · China–Middle East absent · East Africa–Middle East
present · New Guinea–Western Australia present · Northwest Territory–Quebec absent), and the degree
distribution 2→4, 3→13, 4→13, 5→5, 6→7.

**T8 — Bot behaviour.** The BSR inversion fixture: enemy stacks 7, 4, 5 adjacent to a territory
holding 5 → `BST = 16`, `BSR = 3.2`, and with sibling BSRs 4 and 1.25, **`NBSR = 3.2 / 8.45 =
0.3787` before any rounding** (F58). The test asserts that number; the *integer* troop split is then
whatever §4.13's rounding rule produces from it — zero out `BSR < bsrFloor` first, round by largest
remainder, leftovers to the highest BSR — and is asserted separately. Quoting a rounded `0.37` as if
it were the share is how a rounding bug hides.
`contValue` with `wHold = 2.0` on an empty Classic board ranking Australia and North America first at
0.33 (and bonus-per-territory alone ranking Europe first, which is the bug). An Expert bot never
attacking at `score ≤ 0`. A bot given the True Random table in a BB game measurably underperforming
one given the right table. A `blunderRate: 0.4` bot losing to a `0.0` bot over 50 seeded matches.

**T9 — API routes on PGlite** (in-memory, per suite). Name claim, `409` with suggestions, no duplicate
row; `FOR UPDATE` serialising two simultaneous POSTs into contiguous `seq`; one `clientActionId` sent
twice → one row and two `200`s with the same `seq`; `204` on no change with no body; **in a non-fog
game a snapshot only to a cold or compaction-lagging client, and that snapshot `fogged: false`; in a
fog game a masked snapshot with `snapshotSeq === seq` on every changed poll, `fogged: true`** (F36,
F12); the debug `GET /actions?from=` returning the raw log with the flag on and `404` with it off
(F37); the lazy tick running a bot with no cron and chaining under
`MAX_TICK_ACTIONS`; the auto-skip → `SEAT_TO_BOT` → `SEAT_TO_HUMAN` sequence appearing as log rows; the
reaper closing a stale lobby; `games.seed` absent from every response body (asserted by scanning the
serialised JSON).

**T10 — Playwright e2e** (`workers: 1`, `fullyParallel: false`, both `desktop-chrome` and
`mobile-chrome`, every spec driving `window.__riskDebug.pollNow()` rather than sleeping).
**`e2e/**` is S6's, and S6's alone** (F28): S4 and S5 write no spec and no helper there. What they owe
instead is the *surface* — **S4 provides the `data-testid`s and the `window.__riskDebug` hooks the
T10.x items below name** (via `registerDebug`, §12), and **S5 provides the routes, the debug actions
endpoint and the `RISK_TURN_SECONDS` behaviour they drive**. A missing `data-testid` is an S4 bug; a
red spec is S6's to write and S4/S5's to fix.

1. **`e2e/replay.spec.ts` — write this one first.** It is the determinism proof and every other
   guarantee depends on it: read the raw log from **`GET /api/games/:id/actions?from=0`** (the
   debug-gated route, §6, F37 — POLL 3 would hand back a fog view and a replay cannot be checked
   against a masked state), fold it from `seq = 0`, and assert `hashState` matches every `state_hash`.
   **Run on a non-fog game**, which is the only configuration in which a client-side fold is defined
   at all (§5.5). It needs no second context.
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
// src/game/debugBridge.ts — S4's file, and the ONLY `declare global` for this (F27).
// Installed only when NEXT_PUBLIC_RISK_DEBUG === "1".
export interface RiskDebug {
  seq(): number;
  state(): GameState;                             // the CONFIRMED state (§4.15), cloned
  pollNow(): Promise<void>;                       // resolves when the response is applied
  setInterval(ms: number): void;
}
declare global { interface Window { __riskDebug?: Partial<RiskDebug> } }

/** Merges `partial` into `window.__riskDebug`, creating it on first call. No-op when the debug flag
 *  is off. S4 registers `state`/`seq` from the session; S5 calls it for `pollNow`/`setInterval`. */
export function registerDebug(partial: Partial<RiskDebug>): void;

// what the two slices register, between them:
window.__riskDebug = {
  seq:   () => confirmedSeq,                      // S5 (offline: the session's own counter)
  state: () => structuredClone(confirmedState),   // S4 — simulation truth, not pixels
  pollNow: () => pollOnce(),                      // S5
  setInterval: (ms: number) => { pollEveryMs = ms },  // S5
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
poll — the single regression that would blow the budget — so it is asserted on a **non-fog** game,
where a delta is what a changed poll must return. A fog game returns a masked snapshot by design
(F36); its complementary assertions are that the snapshot stays **under 4 KB** on Classic and that the
204 path is byte-for-byte unchanged.

**T13 — Perf budgets** (vitest): the single eager True Random table init < 10 ms (F49), and a lazily
built non-standard augment also < 10 ms on first use; 1,000 `winChance` lookups < 0.1 ms; a ply-0
`decideTurn` on Classic < 1 ms; a ply-1 Expert `decideTurn` < 10 ms; `apply` of a 60-action bot turn
< 20 ms; `hashState` on a 100-territory state < 2 ms.

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
| **S0 — Scaffold** ✅ **DONE** | The committed Next 16 app: pins, config, tokens, fonts, DB adapters, scripts, the layering guard | `package.json` · `tsconfig.json` · `next.config.ts` · `eslint.config.mjs` · `postcss.config.mjs` · `vitest.config.mts` · `vitest.setup.ts` · `playwright.config.ts` · `vercel.json` · `.env.example` · `src/app/{layout.tsx,globals.css}` **(not `page.tsx` — S4's, F32)** · `src/config/env.ts` · `src/adapters/db/{driver,index,neon,pglite}.ts` **(not `schema.sql`/`schema.ts` — S5's, F24)** · `src/test-support/*` · `scripts/{build-schema.mjs,db-push.ts}` · `src/engine/{entryPoints.ts,layering.test.ts}` | — | the token sheet, the nine player palettes, `--font-head`/`--font-body`, `getDb()`, the production PGlite guard, port 3300, `NEXT_PUBLIC_RISK_DEBUG`, and **five things the review asked for, all landed: ① `src/engine/entryPoints.ts` carrying `ENGINE_ENTRY_POINTS` + `ALLOWED_PACKAGES = ["polylabel"]`, read by the guard (F21/F22) · ② the map pins — `polylabel` in `dependencies`, `topojson-client`/`mapshaper`/`d3-geo`/`@types/d3-geo`/`@types/polylabel` in `devDependencies` (F23) · ③ `RISK_TURN_SECONDS` and `RISK_FIXED_SEED` in `env.ts`, `playwright.config.ts` and `.env.example` (F29) · ④ vitest `include` extended to `scripts/**/*.test.ts` (F35) · ⑤ the four DB adapter files as S0's, with `schema.sql`/`schema.ts` left to S5 (F24)** | `pnpm run verify` green; `pnpm run dev` serves a placeholder `/` | T1 |
| **S1 — Engine core** | §3 in full, minus the odds maths and the map pipeline | `src/engine/*.ts` (not `odds/`, `bots/`, `map/`) · `src/engine/resolver/**` · their `*.test.ts` | nothing (takes `OddsTables` as a parameter) | `@/engine`: every type in §4.4–§4.9 — including `Rng`/`RngPurpose` (F13), `ApplyResult`/`RuleError`/`RuleErrorCode` (F15) and `DiceAugment`/`OutcomeDist`/`OddsTables` (F2) — plus `apply(state, map, action)`, `validate(state, map, action)`, `legalActions(state, map, seat)`, the selectors, `viewFor`, `hashState`, `canonicalize`, `serializeState`, `pcg32`, `rngFor`, and **four** resolvers: `dealTerritories`, `placeModifiers`, `rollAttack`, `drawCard`, `movePortals`. **`drawPersonas` is NOT S1's** — it is S2's (F3) | every rule R1–R92 implemented; `apply` never throws and never mutates; the three card branches distinct; fixed draw counts per resolver call per sub-stream; `ENGINE_ENTRY_POINTS` appended to | T1, T2, T5, T13 |
| **S2 — Odds + Balanced Blitz + bots** | The dice maths and all five bot tiers | `src/engine/odds/**` · `src/engine/bots/**` · `src/content/personaNames.ts` · their tests | S1's `types.ts` (**stub against §4 while S1 builds**) | `@/engine/odds`: `createOdds`, `balance`, `sampleOutcome`, `STANDARD_AUGMENT`, the augment helpers, and a **re-export** of S1's `OddsTables`/`OutcomeDist`/`DiceAugment` (F2 — never a second declaration). `@/engine/bots`: `GameView`, `TurnPlan`, `decideTurn(view, odds, rng)`, `makeView`, **`drawPersonas`** and `personaFor` (F3), `PERSONAS`, `TIERS`, `ANTI_BOT_BIAS`, `DEFAULT_WEIGHTS` | **T4 green bit-exact is the acceptance gate, and it is what pins the stage-3 ordering (R52, F46)**; T3 green to the printed digit with every oracle's augment named (F38); one eager table — standard 3v2 only — everything else lazy and memoised (F49); the logistic standard-augment-only (F48); one table per dice mode; `decideTurn` pure, draw count a pure function of its inputs (F57); Expert stops at `score ≤ 0` | T3, T4, T5, T8, T13 |
| **S3 — Maps** | The schema, the loader, 12 boards and the generator | `src/engine/map/**` · `src/content/maps/**` (including `index.ts`'s `MAP_SLUGS` + `loadMapFile`, and `tiny4.json`) · `scripts/build-maps.ts` · `scripts/maps/**` · their tests. **S3 edits no `package.json`** — its four pins are S0's and already landed (F23) | S1's `MapDef`/`MapFile` types only — **S3 needs nothing else from any slice** | `@/engine/map`: `loadMap` (sea links unioned in, F45), `validateMap`, `generateVoronoiMap(options: VoronoiOptions, rng)`, `anchorsFor`; `src/content/maps/index.ts`'s `MAP_SLUGS` and `loadMapFile(slug)` (F6); `src/content/maps/*.json` for Classic (42/6/83), World Extended (47/6/94), Napoleonic Europe (59/11/127), nine generated regional maps, and the `tiny3` / `tiny4` / `mini` / `quad` fixtures | every shipped map passes T7; each under 100 KB (verified sizes in §10, F53); a `suit` on every territory with counts within 1 (F7); 12–30 vertices per territory; `polylabel` anchors inside every polygon; the generator reproducible from `(options, seed)`; no build-time package imported from `src/` | T1b, T7 |
| **S4 — Render + session + offline screens** | Everything a player touches offline — **plus every piece of the game screen an online game uses** | `src/render/**` (incl. `camera.ts`'s `toScreen`/`toMap`, §8) · `src/game/**` (incl. `sessionConfig.ts`'s `MapSource`, `engineApi.ts`'s `EngineApi`, `debugBridge.ts`, and the `src/game/__fixtures__/tiny4.ts` fixture) · `src/components/{game,setup,ui,chat}/**` (incl. `game/GameScreen.tsx` with the timer bar, presence dots and chat drawer) · **`src/app/page.tsx`** (F32) · `src/app/new/**` · `src/app/play/{solo,pass-and-play}/**` · `src/adapters/localStorage/**` · `src/ports/**` · `src/content/dialog.ts`. **Not `e2e/**`** (F28) | S1's `types.ts` + `index.ts`; **its own `src/game/__fixtures__/tiny4.ts`** to develop against before the real maps land (F25); S2's `OddsTables` for the win-chance readout | `createSession`, `SessionUiState`, `Session` (with `confirmed()`, F42), `EngineApi` (§4.15, F33), `SettingsPort`, `LocalProgressPort`, `IdentityPort`, `SyncPort` + `SyncStatus` + `PresenceRow`/`ChatLine`/`ChatSend` (the interfaces; S5 implements the adapter — F30, F31, F26), `GameScreen` + `GameScreenProps` (F26), `debugBridge.ts`'s `registerDebug` and the one `declare global` (F27), `HandOffOverlay`, the 42-line roster | §7's HUD, dialogs and prompts rendered to the measured geometry; §8's coordinate contract with one projection (F40); `GameState` never in React state; the dirty-flag loop; autosave and resume; the hand-off state machine with fog respected; **provides the `data-testid`s and `__riskDebug` hooks T10.1–T10.5 name** (F28) | T11 (+ the hooks T10 drives) |
| **S5 — Online** | Option A end to end | **`src/net/pollingSync.ts`** (the adapter only — the `SyncPort` interface is S4's, F30) · `src/app/api/**` (incl. the debug `GET /api/games/:id/actions`, F37) · `src/app/lobby/**` · `src/app/play/online/**` · `src/components/online/**` · **`src/adapters/db/schema.sql` + the regenerated `schema.ts`, outright** (F24) · `src/adapters/db/repositories/**` · their tests. **Not `e2e/**`** (F28) | S1's `apply` / `validate` / `hashState` / resolvers (**stub against §4 while S1 builds**); S2's `decideTurn` and `drawPersonas` for the lazy tick; S4's `SyncPort` interface and `GameScreen` | every §6 route; `createPollingSync`; the lobby and online play screens as **compositions** of S4's `GameScreen` (F26); the schema (incl. `games.bot_memory`, F43) and repositories | contiguous `seq` under concurrency; `204` with no body; idempotent retries on the `{ kind: "action" \| "intent" }` body (F11); the fog poll returning the caller's masked snapshot at `snapshotSeq === seq` (F36); the lazy tick running bots and timeouts with no cron, writing `bot_memory` in the same transaction; the reaper; `games.seed` never serialised; the adaptive poll schedule with jitter and the hidden-tab stop; **provides the routes and env behaviour T10 drives** (F28) | T9, T12 (+ the routes T10 drives) |
| **S6 — e2e + docs** | The proof and the shop window | **`e2e/**` — S6's alone, no other slice writes a spec or a helper there (F28)** · `docs/screenshots/**` · `README.md`; **appends** to `DECISIONS.md` (D1–D76 already exist — never renumber or reuse) | every slice | the five specs, `e2e/helpers.ts`, the captured screenshots, the README | T10 green on both projects; `CAPTURE=1` produces the README's two 3-image tables; `DECISIONS.md` carries an entry for every **[SPEC]** call in this document | T10, T12 |

**S1's hour-one commit, stated as an acceptance gate** (F34). **S1's first commit is
`src/engine/types.ts` carrying every declaration in §4.4–§4.9 at its real value — every type, every
interface, and every constant with its final number, not a placeholder — together with
`src/engine/index.ts` whose every function body is `throw new Error('S1 pending')`. Its acceptance is
`pnpm run typecheck` green, and nothing else.** No rule need work; no test need pass. That commit is
what unblocks S2, S4 and S5, so it is a gate in its own right rather than a step inside "S1 — Engine
core", and a constant landing as `0` to be filled in later defeats the whole point: S2 would compile
against a lie.

**Stubs each slice may use while its dependency is incomplete.** Every stub is a file the *consumer*
owns in its own tree, never a mutation of someone else's:

- **S2** codes against §4.4–§4.9's types copied verbatim into a local `types.ts` re-export, and tests
  its maths with hand-built `GameView` literals — it needs **no** working `apply`.
- **S3** needs only `MapFile`/`MapDef`; its validator and generator tests are pure data.
- **S4** develops against S1's published `types.ts` plus **its own** `tiny4` fixture — a `MapFile`
  literal at **`src/game/__fixtures__/tiny4.ts`** (4 territories, 1 region, 6 edges), inside S4's own
  tree, so S4 never waits on S3 and the two never contend for one file (F25). **S3 independently ships
  `src/content/maps/tiny4.json`** for the engine and e2e fixtures; the two are allowed to coexist and
  are **not** required to be byte-identical — a test asserts only that both satisfy `validateMap`. S4
  also injects a scripted `EngineApi` (§4.15) so the HUD can be built before the reducer is finished.
- **S5** needs only `apply`, `validate` and `hashState` to be *callable*; its route tests fold a
  two-action log and compare hashes, so a stubbed `apply` that increments a counter is enough to prove
  the transaction, the idempotency fence and the 204 path.

**Integration.** S1 lands `types.ts` + `index.ts` first, then a minimal working `apply` + resolvers
even before full rule coverage, so S4 and S5 can start. S2 and S3 publish their barrels as soon as
their types compile. Final integration is three wirings: S4's `/new/rules` BATTLE handing a real
`GameConfig` to a real `MapDef`; S5's `SyncPort` adapter dropped into S4's `createSession` and S5's
poll data passed into S4's `GameScreen` prop bag (§7); and S3's `MAP_SLUGS` / `loadMapFile` replacing
S4's `src/game/__fixtures__/tiny4.ts` in the picker. **Not owned by any slice** and integrated
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
