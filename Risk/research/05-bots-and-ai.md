# 05 — Bots and AI

Research lane: AI / bots for a browser replica of SMG Studio's **RISK: Global Domination** (RGD).

Status: research complete. All dice numbers in this document were **independently recomputed**
(brute force + DP) and cross-validated bit-for-bit against SMG Studio's own published dice source.
See §4 and §5 for the validation receipts.

**Headline findings**

1. RGD's bots are **not** a single difficulty-scaled algorithm. SMG use a pool of **named personas**
   (Friendly, Defensive, Continental, Aggressive, Stacker, Zombie), each with *"around 40 different
   attributes"*, and **difficulty selects which personas are in the pool** rather than turning a
   single "smartness" dial. Our tiering should copy this architecture, because it is cheap and it is
   the reason RGD bots feel like characters. (§1)
2. **Balanced Blitz is fully reverse-engineered.** SMG open-sourced the dice code
   ([github.com/smgstudio/risk-dice](https://github.com/smgstudio/risk-dice)). It is a deterministic
   4-stage post-processing of the exact outcome distribution, with published default constants
   `(winChanceCutoff 0.05, winChancePower 1.3, outcomeCutoff 0.1, outcomePower 1.8)`. My
   reimplementation reproduces both worked examples in their README **to all 16 printed digits**. (§5)
3. The whole bot stack fits in **well under 1 ms**, not 100 ms. A 101×101 win-chance DP table builds
   in **2.07 ms once** (80 KiB) and a greedy 400-candidate attack scan costs **0.0013 ms**. The
   complexity budget is a non-issue; it buys us room for ply-2 lookahead on Expert. (§6)
4. The published Risk-AI literature is unanimous on one point: **Risk is far too big for search**
   (Wolf measured per-turn branching of 10³³–10⁸⁵ against Go's ~250), so every practical agent —
   academic or commercial — is a **hand-weighted heuristic evaluation over a small set of
   candidate "goals"**. That is exactly what we should build. (§2)
5. **Three independent results say the opening draft decides the game**, not the attack phase —
   Gibson et al. (identical post-draft play, random draft ⇒ collapse), Gnecco & Cazenave
   (net-for-draft-then-random *beat* their full trained agent), and Hahn (the eventual winner is
   statistically identifiable 60 % of the way in). **Expert's compute budget belongs in the draft.**
   This is the opposite of where intuition points. (§2.6, §2.9, §2.15)
6. **Balanced Blitz changes bot strategy, not just dice.** BB leaves the `A ≥ D+1` break-even
   **unchanged** (the transform's fixed point is 50 %), but amplifies favourable attacks by **+8 to
   +14 points** and *penalises* marginal ones — and anything past 95 % snaps to a **guaranteed win**
   (20 v 15 = exactly 100 %). So a bot must be given the **BB-adjusted odds table** when BB is on, or
   it misjudges its own odds by up to 14 points. This is a correctness issue. (§5.4)
7. **Two live traps.** (a) The widespread "attack with twice as many armies" rule descends from
   Tan (1997), whose 2-dice-vs-2-dice probabilities are **wrong** (an independence error Osborne
   corrected); the real break-even is `A ≥ D + 1`, and Tan's rule makes a bot far too passive.
   (b) Osborne's conquer-odds table **text-extracts transposed** — rows are attackers. Either
   mistake ships a badly broken bot. (§2.2, §2.3)

---

## 1. What RGD's bots actually do

### 1.1 SMG's own published description

The single authoritative source is SMG Studio's support article **"Our RISK AI"**
([smgstudio.freshdesk.com](https://smgstudio.freshdesk.com/support/solutions/articles/11000077687-our-risk-ai)).
Key claims, which are *SMG's own statements* (not player speculation):

| Claim | Detail |
|---|---|
| AI version | The AI was rebuilt as **"a new and improved system V2.0"** in **February 2019**, replacing a *"static"* single-algorithm AI that players had learned to game. |
| Architecture | Not one AI. A pool of **"personas"** with *"different ways of approaching the game"*. |
| Named personas | **Friendly**, **Defensive** (*attacks only when victory is certain*), **Continental** (*prioritises continent control*), **Aggressive**, **Stacker** (*accumulates forces before attacking*), **Zombie**. |
| Persona size | Each persona has **"around 40 different attributes"** driving its decisions. |
| Difficulty mechanism | **Some personas are restricted to certain difficulties** — *"you will get a different set of personas on 'Expert' than on 'easy'"*. Difficulty = persona pool + attribute ranges, **not** a smartness slider. |
| Dice fairness | The AI uses **the same dice code and the same RNG as humans**. No dice advantage, no dice penalty. |
| Fog of War | **The AI does cheat here.** It *"can see the player's troops and factors that into its calculations"*. This is the only admitted information advantage. |
| Targeting | The AI *"considers all players equal opponents"* and does **not** preferentially target humans — **except** on **Beginner** and **Easy**, where there is *"a slight preference for the AI to take out other AI first"* to ease the player in. |
| Turn order / cards | Turn order is random; cards are dealt randomly from the available deck. |
| **Game mode changes the persona pool** | *"Also depending on the game mode also will determine which persona is used. **Capitals is the best example as adds a new dimension for the AI to focus on.**"* |
| Why not ML | SMG say they *"spoken to machine learning companies and they are interested but the price to implement it, with no guarantee it'll be good, is many times monthly revenue we earn from the game."* So: **incremental heuristic refinement, explicitly not ML.** |

**Mode-dependent persona selection is a first-party design decision we should copy**: the persona pool
is a function of `(difficulty, gameMode)`, not difficulty alone. Capitals in particular deserves its
own persona weighting, because the dice maths changes materially (§4.6).

**SMG's RNG and dice-modifier statements** (from their separate dice article, *"How are the dice
rolling odds calculated for RISK computer players?"*, modified 19 Aug 2019):

> *"RISK does not modify dice rolling odds in favour of computer players in any of the difficulty
> settings. RISK does not modify dice rolling odds in favour of higher-ranked players… We use the
> **Mersenne Twister** for cards, player order and dice… The RISK dice rolling algorithm is tested
> against a control probability matrix of expected attack and defence dice rolls… The results are
> within +-5% of the control comparison, which is acceptable."*

And, critically, the official list of mode dice modifiers — which **independently confirms the
augment semantics I derived from their source code** (§4.6) and adds one fact the code alone does not
make obvious:

> *"Human attacking Zombie: Ties favor attacker instead of defender / Zombie attacking Human: -1 max
> attack die / Player attacking Capital: +1 max defender die / Attacking over Wall: +1 max defender
> die. **These also STACK!**"*

**Design consequence.** The "bots gang up on the leader" feeling that players report is *explicitly
denied* by SMG as a coded behaviour — officially all players are equal opponents. The feeling is an
emergent artefact: the leader has the most borders, so the leader is the most frequent *local* best
target for many independent bots at once. **We get the same emergent effect for free from a
per-bot local target score, and we should not hard-code a global "dogpile the leader" rule at
low tiers** — but we *should* expose it as a tunable `leaderBias` knob (§3.5) because it is a
behaviour players repeatedly ask SMG for (a player feature request on the Steam forum asks that the
AI *"have some capacity to work with other players when someone has become too powerful"* —
[Steam discussion](https://steamcommunity.com/app/1128810/discussions/0/604142224713712839)).

### 1.2 Difficulty tier names

The in-game setting is labelled **"AI Difficulty"**, it lives under *Modifiers → Advanced Options*,
and the ladder has **five** tiers: **Beginner / Easy / Medium / Hard / Expert**. Evidence, graded:

| Tier | Status | Evidence |
|---|---|---|
| **Beginner** | **Official** | *"Except with Beginner and Easy…"* — SMG's "Our RISK AI" article; and the difficulty article's *"Choose from **Beginner** to Expert."* |
| **Easy** | **Official** | same article |
| **Medium** | **Official** | the screenshot attached to SMG's own difficulty article shows the **"AI Difficulty"** cycler set to **"Medium"** ([image](https://s3.amazonaws.com/cdn.freshdesk.com/data/helpdesk/attachments/production/11092627820/original/lDVzZ3-DGoqdffZPjwV3CwMne_ckT_adFA.png?1666677511)) |
| **Hard** | ⚠️ **Player testimony only** | multiple Steam posters refer to the *"next difficulty (hard)"* and *"5 AI players on the 'hard' setting"*; **no first-party source names it** |
| **Expert** | **Official** | Steam achievements: *"Defeat 5 **expert** AIs in a single game of Classic World Domination Map"* |
| **count = 5** | **Official, but stale** | the old Steam store "About This Game" bullet *"• **5 difficulty AI settings** for rookies and veterans"* — **since removed from the live store page** |

The full body of SMG's difficulty article is a single sentence: *"Tap the green Next button after
selecting a map and tap on the Modifiers button… Choose from Beginner to Expert."* `hasbrorisk.com`'s
FAQ adds only *"there will be a range of options including 'AI Difficulty', choose which difficulty
you would like the AI to be."*

> ⚠️ **Do not write "Intermediate" or "Advanced".** An automated summary of SMG's difficulty article
> produced *"Beginner, Intermediate, Advanced, and Expert"*; the raw page contains no such list. That
> is a confabulation and it would be easy to propagate into a spec.

**Recommendation:** ship **Easy / Medium / Hard / Expert** (the brief's set, and a clean subset of
RGD's) and keep **Beginner** in reserve as a softer tier if playtesting wants one.

**Adjacent official setting, easily confused:** **"Inactivity Behaviour"** controls what a *bot-out*
does, not bot skill — *"**Automated**: If a player goes inactive, AI will step in and play as an
active bot. / **Neutral**: AI will only make minimal moves (reinforce or skip)…"* (v3.20 notes,
8 Sep 2025). Keep these as two independent settings in our config.

**Timeline — the system we are replicating is the 2019 one.** The persona architecture dates to a
support article first published **27 Sep 2019** (mirror timestamp) and last modified **15 Jul 2021**.
Across all 294 Steam news items for the game, **the only patch note describing an AI-logic change is
v2.5 (23 Apr 2020): *"Improved AI after taking over for a player."*** SMG staff have repeatedly
promised a rework and repeatedly deferred it — Nick (CM), 5 Nov 2025: *"a lot of our higher level
players do find our bots too easy. We actually want to revisit our AI… planned for sometime next
year"*; Lee | SMG, 17 Oct 2025: *"An AI revisit is overdue"*; Lee | SMG, **6 Aug 2026**: *"AI
improvements are on the cards for next year, ideally Q1-2."* **As of today the rework has not
shipped**, so the 2019 persona system is still live and is the correct replication target. (Per-AI
difficulty — setting each opponent's level individually — was promised for Q1 and is worth designing
for.)

### 1.3 Player-reported bot tendencies

These are **community observations**, not SMG statements, and several directly contradict SMG's
official position. Flagged accordingly. (Steam Community app 1128810 discussions:
[AI Problems](https://steamcommunity.com/app/1128810/discussions/0/2243300286284412490/),
[Bot AI changes](https://steamcommunity.com/app/1128810/discussions/0/600768722043449897/),
[Bots are absolutely horrible](https://steamcommunity.com/app/1128810/discussions/0/3192488348527650080/),
[Does bot difficulty skew random chance?](https://steamcommunity.com/app/1128810/discussions/0/3081016749018365058/).)

| Player claim | Verdict |
|---|---|
| "Bots gang up on the leader" | **Contradicted by SMG** as an explicit rule; emergent from border count. Keep as an optional knob. |
| "Bots cheat on dice" | **Explicitly denied by SMG** — same dice code, same RNG. The real asymmetry is Fog of War vision. |
| "Bots target the human" | **Denied by SMG**, with the stated *inverse* bias on Beginner/Easy (bots prefer eating other bots). |
| "Bots are erratic / inconsistent in strength" | **Consistent with SMG's design** — persona pools mean two games at the same difficulty draw different opponents. SMG say your play style *"may clash with one of those personas which makes it appear 'stupid / too easy' or 'impossible to beat!'"* |
| "Expert bots prioritise continents" | **Consistent** with the **Continental** persona being difficulty-gated. Plausible but not first-party-confirmed as Expert-specific. |
| "Bots always take Australia" | **Not first-party confirmed.** It is the correct opening by every published heuristic (§3.1: Australia has the best bonus-per-border ratio on the classic map, 2.00), so a Continental persona will converge on it. Treat as emergent, not scripted. |
| "Bots never break alliances" | **Not verifiable from any first-party source.** RGD alliances are largely a multiplayer-diplomacy feature; I found no SMG statement on bot alliance-breaking. **Flag as an open question for the rules lane.** |
| "Bots stack armies pointlessly" | **Consistent** — this is literally the **Stacker** persona (*accumulates forces before attacking*). |
| "Bots attack only when certain" | **Consistent** — the **Defensive** persona, described by SMG as attacking *"only when victory is certain"*. |

**Corroboration that no threat-assessment exists.** Players who have studied the bots describe
targeting as positional, not strategic: *"While they don't gang up or particularly target anyone,
bots totally lack any self preservation"*; *"who ends up being 'targetted' is mere chance… You can
imagine the AI seeing all the players as the same colour, essentially."* The repeated **feature
requests** are themselves evidence of absence — *"a power assessment should be done so that the AI is
more likely to try and stop other players from getting bonuses and have some capacity to work with
other players when someone has become too powerful."* One dissenting account: *"Maybe 1 out of 10
games the A.I. will gun for you, so 3 vs 1 is not unheard of"* — consistent with randomness, not a
rule.

**Target selection: "first acceptable odds", not "weakest" or "strongest".** The most mechanical
player account: *"The bot will look at each neighbouring territory (biased like I said), and just
attack the first one that meets a 'likely win' condition. It doesn't care about the bigger picture of
the game."* And: *"Often it will follow the path of least resistance — if the human player defends
most countries with a single unit, that nomadic AI might chew through them. And if a well-defended
country is the only valid target (and the odds are not completely horrible), it will attack to
acquire a card."* On tie-breaks: *"if both country A and B are in reach, and they have the same amount
of defenders, the bot will always prefer to attack A… I assume targets are sorted by gain and risk,
and if it's a tie, the country with the lower (or higher) internal identification number comes
first."* **That tie-break-by-territory-id is exactly the determinism discipline §7.2 recommends** —
and it is also precisely what makes a bot exploitable, which is why we prefer *seeded random*
tie-breaks.

**Reinforcement and fortify (player accounts, no first-party source).** These are specific and
actionable:
- **Draft is proportional to bordering enemy troops** — *"They will place troops sort-of relative to
  the number of troops currently bordering their territories. So if you have the least, it'll
  generally place the least against you."* **This is NBSR behaviour (§3.1) arrived at independently**,
  which is reassuring for our design.
- **Stack-vs-split rule, with an exploit:** *"If you do have a defending stack, and it neighbours 1
  bot territory, then the bot will fully stack that 1 territory. So if you're defending from bots,
  always make sure your 1 point borders multiple of its territories, because then it will split its
  stacks during draft phase."* A bot whose placement can be split by board geometry is exploitable;
  our `secure` policy should allocate by **threat weight**, not by neighbour count.
- **Fortify looks random:** *"bots can swap half their stack between 2 targets occasionally until
  they're able to hit something. Essentially a coin toss who actually gets slammed."*
- **Incremental stacking + card dump:** *"sometimes they don't stack it all at once. They will
  sneakily only add 2 or 3 troops at a time… Then when they get close, they will trade in a set of
  cards, dump all those troops on that stack, and totally demolish that defensive stack."* This is
  good behaviour and worth copying for the Hoarder persona.
- **Post-conquest garrison is 1:** *"The bot who likes having that one big stack will always leave
  only 1 troop behind on every territory he conquers, and this can be easily used against him."*
  Our `moveArmiesIn` decision should be smarter than this (§2.14).

**Bots do *not* kill for cards** — *"A player can have 4 single territories with only 1 unit on each
territory and sitting there with 5 cards and it's the bot's turn with a huge army next to the player
that's ripe to be killed and the bot won't take the 5 cards."* This is a real RGD weakness.
**We should deliberately diverge**: `seesKillForCards` on Hard/Expert (§3.5) makes our high tiers
stronger than RGD's, which is the right call given SMG themselves say *"a lot of our higher level
players do find our bots too easy."*

**Mode-specific behaviour.** Officially *"the game mode also will determine which persona is used.
Capitals is the best example."* But players report the Capitals handling is weak — *"the AI usually
doesn't seem to value capitals… Against 5 expert AI a few weeks ago I think exactly one bot was cap
stacking"*; *"The bots are particularly bad in the first few rounds of capitals."* SMG acknowledge it
— **Lee | SMG, 4 Mar 2026**: *"We are planning to spend time on the AI logic later this year. In the
short term, there are some tests we can explore related to Capitals to affect their
defensiveness."* For 70 % domination: *"AI is quite handicapped at unusual game modes"*, to which
SMG's Nick replied *"This is good to know thanks!"*. Fog reportedly makes bot games *harder for the
human* rather than the bots smarter — *"Large (many territory) map + Blizzards + Fog Of War… can
allow 1 or 2 bots to snowball… and the player can't see it happening."* **Our §3.2 domination- and
capital-awareness rules are therefore an improvement on RGD, not a replication of it** — worth
calling out so nobody "fixes" them to match.

**⚠️ Bots play Balanced Blitz, and that interacts with their odds gate — see §5.4.** Player reports:
*"The only thing that bothers me is that the bots use Blitz… this is also limiting the AI bots to
just go all in because they can't stop on time to see that it's maybe better to stop the attack"*,
and critically *"the AI only takes favourable odds, which in Balanced Blitz **favours the
attacker**."* This is the most important player-sourced insight in this section and it has direct
consequences for our implementation.

**Player persona taxonomies — keep separate from SMG's six.** Regular players have independently
catalogued observed behaviours, which is useful validation that persona-based design *reads* to
players: *"This Is Mine"* (takes a continent no matter what), *"Bonus Buster"* (ignores its own bonus,
denies neighbours'), *"Gonna Get You"* (harasses one player; *"will attack me with 8 vs 5, risking a
loss, when he could have attacked his other neighbour 8 vs 1"*), *"Random Chaos"* (no plan; trades
cards, dumps 20 on one territory), *"Slow Burn"* (defensive, takes 1–2 territories per turn for the
card). Others report only *"the 'taker'… and 'breaker'"*. Note the scepticism too: *"They supposedly
have personas on hard and above. But in practice, they don't play a part that matters."* And the
design intent as understood by regulars — *"The bots are not made to emulate human players. They
represent certain playstyles, so you can learn how to deal with them"* — which is a good articulation
of what our tiers should feel like.

**SMG on why Risk AI is hard** (Studio Head, 15 Mar 2020): *"To be fair (to our devs who try to make
the AI smart) if the AI persona it picks goes against your style it will be harder. But we havent
coded Deep Blue… Compared to Chess, RISK is much harder to code AI for."* That matches Wolf's
complexity measurements exactly (§2.1).

> **Explicit not-found list** (do not assert these without a citation):
> (a) no official enumeration of all five difficulty names — **"Hard" is player testimony only**;
> (b) **no official persona → difficulty mapping**, so "Expert bots prioritise continents" is an
> inference, not a fact; (c) **nothing at all** on bot card policy in Progressive or Exponential;
> (d) no official statement on bots and alliances — only a single unanswered 2020 bug report that
> *"if you are an ally with a player and they either quit or drop, the AI that replaces them will not
> attack you"*; (e) no official statement on target selection beyond *"considers all players equal
> opponents"*; (f) **no systematic evidence of a hard-coded continent priority** (the Australia claim
> rests on one third-party guide noting *"AIs had already started aiming for Australia"*, plus
> counter-example threads where bots ignored obvious continents).
>
> **Research gaps worth closing later:** Reddit was unreachable from this environment, so **r/Risk**
> and SMG's **July 2024 live Q&A** ([thread](https://www.reddit.com/r/Risk/comments/1ebfwfn/live_qa_with_smg_studio_developers_of_risk/))
> were not read — note that SMG's own published "Dev Q&A Highlights" write-up of that AMA contains no
> AI/bot-logic questions at all. SMG's **Discord** (`discord.gg/risk`), which the studio head calls
> their primary channel, is also unchecked. Also unretrievable: the *"video we took of the AI playing
> itself"* referenced in the official article. Note too that **r/RiskGlobalDomination does not
> exist** — the community subreddit is **r/Risk**.

---

## 2. Published Risk AI approaches

Every PDF cited here was downloaded and text-extracted, not summarised from search snippets. Two
items could not be read in full and are flagged in place.

### 2.1 Michael Wolf, *An Intelligent Artificial Player for the Game of Risk* (2005, TU Darmstadt)

⚠️ **Secondary sourcing.** The original PDF is not online (the cited TU Darmstadt URL is dead). The
figures below come from Blomqvist's KTH thesis §2.2.1, which summarises Wolf at length
([PDF](https://forums.triplea-game.org/assets/uploads/files/1637032761173-fulltext01.pdf)); the
catalogue record is on [Semantic Scholar](https://www.semanticscholar.org/paper/An-Intelligent-Artificial-Player-for-the-Game-of-Wolf/abca9c507f1120116d8ea6d98fcd8d01b2e26c7f).

- **Representation.** Armies per territory + owner. Wolf's structural point: nothing forces a player
  to attack, so armies can accumulate without bound and **Risk's state space is theoretically
  infinite**; his worked example gives ≈**10⁴⁷** states for 4 players with 200 armies on the board.
- **Complexity.** Branching measured **per whole turn** (a turn being a *sequence* of decisions):
  ≈**10³³** and **10⁸⁵** by two approximations, reducible to ≈**10⁶** after restructuring the
  place-troops decision. Chess ≈31, Go ≈250. **The place-troops phase dominates**, because it is
  every distribution of N armies over owned territories.
- **Evaluation / search.** Enumerate each legal decision, simulate it, score with a **linear
  evaluation function over handcrafted features**, pick greedily. **No lookahead.** This basic player
  was weak and, tellingly, showed **no coordination between the decisions within a single turn**.
- **The fix that matters.** An **enhanced player** computes features first to decide whether a
  **high-level goal** activates (*conquer continent X*, *eliminate weak player Y*); if active, actions
  consistent with it are **scored higher inside the same linear eval**. Goals bias the evaluation
  rather than replacing it.
- **Results.** High-level plans improved the basic player by ≈**60×** on his rating scale;
  **TD-learning the feature weights added a further ~20 %**. Final strength: beat human beginners
  regularly, occasional wins against experienced humans.
- **Lift for us.** (i) **Plan-as-score-bias** — one scalar `planBonus` in the same linear eval buys
  turn coherence for free, and directly fixes the incoherent-turn failure we would otherwise hit.
  (ii) **Place-troops compression** — offer "place 1 / place half / place all" instead of every
  distribution.
- **Latency: fully online.** Linear eval over 42 territories + 1-ply greedy = microseconds. TD
  *learning* is offline; ship the weights as constants.

### 2.2 Jason A. Osborne, *Markov Chains for the RISK Board Game Revisited* (Mathematics Magazine 76(2), 2003, 129–135)

[PDF](https://www4.stat.ncsu.edu/~jaosborn/research/osborne.mathmag.pdf) — **the single most
important citation in this document.**

- **Representation.** `Xₙ = (aₙ, dₙ)` armies remaining after roll *n*, `X₀ = (A, D)`. `A·D` transient
  states, `A + D` absorbing. Attacker rolls `min(3, a)`, defender `min(2, d)`.
- **Transition matrix.** `P = [[Q, R], [0, I]]`, built from only **14 distinct probabilities** `π_ijk`
  (defender loses *k* when rolling *j* dice against attacker's *i*), computed from the **joint**
  distributions of order statistics.
- **Search method.** Absorbing-chain closed form: `F = Σₙ Q^(n−1) R = (I − Q)⁻¹ R`.
  `P(attacker wins | A, D)` is the sum of the last *A* entries of row `AD` of `F`.
- **Results.** *"The chances of winning a battle are considerably more favorable for the attacker than
  was originally suspected."* When `A = D`, **the attacker wins more than 50 %** provided the stakes
  are **at least 5 each** — directly contradicting Tan. Worked `A = D = 5` case: `E(L_D) = 3.56`
  (SD 1.70), `E(L_A) = 3.37` (SD 1.83).
- **Independent confirmation of our numbers.** Osborne's Table 2 gives `π₃₂₂ = 2890/7776`,
  `π₃₂₁ = 2611/7776`, `π₃₂₀ = 2275/7776`, and the 1v1/1v2/2v1/3v1/2v2 rows — **all identical to my
  own enumeration in §4.1**, which in turn matches SMG's shipped code. Three independent
  derivations agree.
- ⚠️ **Transcription trap.** In the published PDF the corner cell of Table 3 renders such that text
  extraction suggests *columns = A, rows = D*. **That reading is wrong: rows = A (attackers),
  columns = D (defenders).** Proof: `(row 1, col 2) = 0.106 = π₁₂₁ × π₁₁₁ = 0.255 × 0.417`. Hahn
  (2010) reprints the table explicitly headed `A\D` with A down the rows. **Do not copy it
  transposed** — this is an easy way to ship a bot that is catastrophically wrong.
- **Lift.** Ship the conquer-odds table as a constant; gate every attack on it. Rules of thumb:
  **`A = D ≥ 5` → attack**, and **`A ≥ D + 1` wins on average**.
- **Latency: fully online.** Memoised recursion builds the full 100×100 table in **5.2 ms** in plain
  CPython; O(1) lookups thereafter.

### 2.3 Baris Tan, *Markov Chains and the RISK Board Game* (Mathematics Magazine 70(5), 1997, 349–357) — and the exact nature of Osborne's correction

[PDF](https://faculty.ozyegin.edu.tr/baristan/files/2024/05/MMrisk97.pdf) ·
[JSTOR](http://www.jstor.org/stable/2691171)

- **What Tan did.** He *originated* the formulation — the state definition, the transient/absorbing
  ordering, `P = [[Q,R],[0,I]]`, `F = (I − Q)⁻¹ R`, and the expected-remaining-armies matrix
  `E_R = F·E`. Osborne adopts **Tan's notation and chain structure unchanged**. Tan tabulated
  `0 < a, d ≤ 30` and noted matrix dimension grows as `O(a²d²)`.
- **The error — be precise.** It is **not arithmetic** and **not structural**. It is a **mistaken
  assumption of independence**. Tan's Table 2 gives only the **marginal** distributions of the max and
  2nd-max of 1/2/3 dice, then asserts (verbatim) *"Since Y⁽¹⁾ and Z⁽¹⁾, Y⁽²⁾ and Z⁽²⁾ are independent
  of each other"* and multiplies marginals:
  `π₃₂₂ = Pr(Y⁽¹⁾>Z⁽¹⁾)·Pr(Y⁽²⁾>Z⁽²⁾) = 0.471 × 0.551 = 0.259`.
  Osborne, verbatim: *"Tan's mistake is in assuming the independence of events such as Y⁽¹⁾ > Z⁽¹⁾ and
  Y⁽²⁾ > Z⁽²⁾."* **The order statistics of one roll of three dice are not independent**, so the joint
  distribution is required. Correct value: **`π₃₂₂ = 2890/7776 = 0.372`, not 0.259.**
- **Scope of the damage.** Confined to the two-dice-vs-two-dice rows — `π₂₂₂, π₂₂₁, π₂₂₀, π₃₂₂, π₃₂₁,
  π₃₂₀`. Tan: 0.152 / 0.475 / 0.373 and 0.259 / 0.504 / 0.237. Correct: 0.228 / 0.324 / 0.448 and
  0.372 / 0.336 / 0.293. The eight single-comparison probabilities agree to ±0.001. But `π₃₂·`
  governs nearly every real battle, so **every downstream conquer probability and expected-loss
  figure in Tan is wrong, and systematically understates the attacker.**
- **The consequence for bot design.** Tan concluded *"when both attacker and defender have the same
  number of armies, the probability that the attacker wins is below 50 %"* and gave the rule of thumb
  **attack if you have twice as many armies** (`A ≥ 2D`). Osborne overturns both; his explicit
  recommendation is *"for the attacker to be more aggressive."* **A bot built on Tan's numbers or on
  the folk "2×" rule will be materially too passive.** Use `A ≥ D + 1`.
- **Still-useful framing from Tan.** Judge an attack by **how many armies you can leave on the
  conquered territory before the next opponent's turn**, not merely by whether you win the battle.
  Tan also flags the attacker's **option to withdraw mid-battle** as an open problem he did not
  solve — see the caveat at the end of this section.

### 2.4 Sharon Blatt, *RISKy Business: An In-Depth Look at the Game RISK* (Rose-Hulman Undergrad. Math. J. 3(2), 2002)

[Landing page](https://scholar.rose-hulman.edu/rhumj/vol3/iss2/3/) (the PDF 403s behind Cloudflare).

⚠️ **I could not read the full text** and found no mirror. From the publisher's abstract plus how
authors who *did* read it characterise it: Blatt addresses **the same two Tan questions** —
`P(capture a territory)` and `E(losses in a war)` as a function of defending armies — **via
probability theory and Markov chains**. Hendel et al. describe the lineage precisely: the conquer
odds *"were first investigated by Tan… that derivation contained a discrepancy that was corrected by
Osborne **and extended by Blatt**"*. So Blatt is an **extension** of the corrected analysis, not a
further correction.

⚠️ **Do not cite interior numbers.** A search snippet attributes "0.4702" and "1.8895" to this paper.
`0.470` *is* the A=3 vs D=3 cell in Osborne and in my own table, which is corroborating but **not
proof** it is the same quantity in her paper. **Obtain the PDF before quoting either figure.**

### 2.5 Franz Hahn, *Evaluating Heuristics in the Game Risk* (Maastricht University BSc paper, 2010) — the source of BSR

[PDF](https://project.dke.maastrichtuniversity.nl/games/files/bsc/Hahn_Bsc-paper.pdf) —
**the highest value-per-line result in the whole review, and the origin of the Border Security Ratio.**

- **Exact published formulas (verbatim definitions):**
  - `BST_x = Σ_y AmountOfUnits_y` over **enemy** countries *y* adjacent to *x* — *Border Security
    Threat*.
  - **`BSR_x = BST_x / AmountOfUnits_x`** — *Border Security Ratio*. **Note the direction: higher BSR
    = more dangerous.**
  - `NBSR_x = BSR_x / Σ_z BSR_z` over the player's own countries — used **directly as the proportion
    of reinforcements to send to each border country**.
  - Worked example: `BST₅ = 7 + 4 + 5 = 16`, `BSR₅ = 16/5 = 3.2`, `NBSR₅ = 3.2/(3.2+4+1.25) = 0.37`.
- **Semantics.** Supplying a **high**-BSR country raises its defence (lowering its BSR); supplying a
  **low**-BSR country raises its offensive potential. Hahn notes NBSR degenerates with few
  reinforcements ("0.53 units on country 2") and suggests a **threshold below which BSRs are zeroed**
  — but **did not use one** in his experiments. We should.
- **Method.** 3 supply heuristics (Random / Border / **BSR**), 3 attack heuristics (Random /
  **Full Force** = always attack with max units / **High Chance** = Full Force **plus a
  battle-win-probability check against Osborne's table**), 2 reinforce (Random / Border Reinforce).
  **18 configurations, 1,000 games round robin** including self-play, each pair run twice.
- **Results.** **High Chance > Full Force > Random in every column** —
  *"the single strongest impact on the performance of the AI was achieved with improvements in the
  strategies used to attack."* Both non-random supply heuristics clearly beat Random, and the **best
  overall configuration is BSR Supply + High Chance Attack**. **Reinforcement heuristics showed no
  measurable benefit** (he attributes this to attacks leaving nothing behind and BSR Supply already
  balancing borders). Measured **first-player advantage: 66.59 % mean win rate for player 1 in
  self-play, 95 % CI [58.42 %, 74.77 %]**, shrinking as the two configurations diverge in strength.
  In 10,000 self-play games, **by 60 % into the game the eventual winner already holds a
  statistically significant unit advantage (>97.5 % confidence)**.
- **Timings.** Random+Random games averaged ≈**1 s per game**; **every other configuration completed a
  whole game in under 50 ms.**
- **Lift.** `BSR`, `NBSR`-proportional reinforcement with a floor threshold, and attack-only-when-
  table-favoured. Published, measured, ~30 lines of JS.
- **Latency: fully online.** O(edges) per turn plus table lookups.

### 2.6 Gibson, Desai & Zhao, *An Automated Technique for Drafting Territories in the Board Game Risk* (AIIDE-10)

[PDF](https://pages.cpsc.ucalgary.ca/~richard.zhao1/publications/2010aiide-UCT.pdf)

- **Scope.** **The opening draft only**, 3-player Risk. A draft outcome is `Z = (A₁, A₂, A₃)`; actions
  = pick one unclaimed territory (42 at the root).
- **Features, per player.** (i) for each continent, **number of territories owned in it**;
  (ii) **position in turn order**; (iii) **number of distinct enemy-owned territories bordering
  owned territories**; (iv) **number of pairs of owned adjacent territories**.
- **Learning the evaluator (offline).** 7,364 random drafts → 22,092 `(S, v)` pairs; each outcome
  played out **100 full games** with all players using Lux Delux's **Quo** for post-draft play;
  `v ∈ [0,100]` = games won. **Weka linear regression.** Normalised to
  `V_i(Z) = v_i⁺ / Σ_j v_j⁺`, `v_i⁺ = max(0, f(S_i))` — so you maximise yours *and* suppress
  opponents'.
- **Exact published weights (their Table 1).** `first to play = +13.38`, `second to play = +5.35`,
  **each distinct enemy neighbour = −0.07**, **each pair of friendly neighbours = +0.96**. Per-
  continent curves are in their Fig. 3 (a chart, not extractable), but the paper states the shape:
  **Europe has the biggest jump from 0 → 1 territory**; **North America's weights grow much larger
  with many territories**; **large jumps from all-but-one → all for South America and Africa.**
- **Search.** **UCT**, `c = 0.01`, **3,000 simulations per pick**, simulating **only to the end of the
  draft** (fixed length) and scoring the leaf with `V_i(Z)`. That is the key trick — it removes the
  need for full-game rollouts that may never terminate under random play.
- **Results.** UCT-Quo beat **all four "difficult" Lux Delux bots** (Quo, EvilPixie, KillBot, Boscoe)
  in a 5-bot/3-player round robin, roughly **double to triple** the next best bot's wins. Against
  Boscoe + KillBot, changing **only the draft rules** took it to **>75 %** where KillBot had been
  strongest at ~60 %. **Random-Quo — identical post-draft play, random draft — won only a small
  share.** Direct evidence that **the draft alone is game-deciding.**
- **Lift.** (1) The **"simulate only to the end of a fixed-length phase, then score the leaf"**
  pattern — ideal for our draft. (2) Copyable signs and magnitudes: **−0.07 per bordering enemy
  territory, +0.96 per adjacent owned pair** — clustering is worth ~14× as much per unit as a border
  costs. (3) Their emergent policy, worth hard-coding as a fallback: **claim a contiguous block in
  North America, and deny opponents by taking the last free territory in South America or Africa.**
- **Latency: online.** Authors report **<1 s per pick** for 3,000 sims on a 2006 Core 2 Duo @ 2.0 GHz;
  a few hundred sims fits 100 ms in a modern JS engine easily. **Regression training is offline**
  (≈736,400 simulated games) — ship the weights.

### 2.7 Lozano & Bratz, *A Risky Proposal: Designing a Risk Game Playing Agent* (Stanford CS229, 2012)

[PDF](https://cs229.stanford.edu/proj2012/LozanoBratz-ARiskyProposalDesigningARiskGamePlayingAgent.pdf)

- **Scope.** **UCT on the attack phase only**; initial placement, per-turn placement, fortify and
  card turn-in are all delegated to Lux API heuristics. Node = game-state matrix `N_ij` (armies of
  player *i* on country *j*); children = all states reachable by one legal attack. Battles simulated
  to completion.
- **Evaluation function — one line, and it carries most of the signal.**
  **`V(state) = (our expected troop income) − (the largest expected troop income of any one
  opponent)`**, where income is a function of **countries held, continents controlled and cards
  held.** Their stated finding: **maximising next-turn troop income is "an incredibly effective
  strategy."**
- **Goal-parallel search.** Instead of one rollout policy, they run **several default strategies in
  parallel, each a high-level goal** — *take a continent*, *eliminate an opponent for their cards*,
  *prevent an opponent securing a continent* — building a **separate partial tree per goal for equal
  time**, then executing the root of the highest-valued tree. **The agent stops attacking when no
  strategy yields positive expected value.**
- **Results.** Beat the best provided Lux AIs **73 %** of the time, where the strongest built-in bot
  managed **38 %**. ⚠️ Unrefereed course project; **no match count or confidence interval** is given
  for that figure.
- **Lift — strongest overall candidate for our bot.** (1) The **income-differential eval** is ~15
  lines of JS. (2) **Goal-parallel short searches** recover Wolf's turn coherence with no
  plan-activation machinery. (3) **Stop-attacking rule = "no strategy has positive expected
  value"** — which is exactly the dynamic Expert stop condition in §3.2.
- **Latency: online with a tuned simulation budget.** No timings published — that is the gap. Per-node
  cost is one battle resolution (replaceable by a table lookup) plus an income computation.

### 2.8 Carr, *Using Graph Convolutional Networks and TD(λ) to play the game of Risk* (arXiv:2009.06355, 2020)

[arXiv](https://arxiv.org/abs/2009.06355) — agent **"D.A.D"**.

- **Approach.** Deliberately minimal handcrafted features; low-level board inputs into a deep net
  containing a **GCN**, trained with **TD(λ)**, estimating values for **all players** rather than a
  scalar. Training games generated with Lux Delux's built-in bots.
- **The key engineering idea.** It **makes the attack phase deterministic by enumerating possible
  end-of-turn states via a lookup table of attack outcomes**, then runs a **breadth-first search**
  over those end-turn states and picks the most promising. The abstract credits *"a new method of
  interpreting attack moves necessary for the search."*
- **Results.** Wins **35 % of games against 5 of the best built-in Lux Delux AIs** — roughly double
  chance (~17 %) in a 6-player game, against strong opposition. Gnecco & Cazenave call this the
  strongest published Risk agent they surveyed.
- **Lift — the single most transferable idea here.** **Collapse the whole attack phase into
  "enumerate reachable end-of-turn states using a precomputed battle-outcome table, then score
  them."** That converts a stochastic multi-decision phase into a deterministic one-shot choice —
  cheap, replay-friendly, and empirically the thing that made the strongest agent work. It composes
  perfectly with our §4 tables.
- ⚠️ I read the abstract plus a detailed third-party description, **not the full PDF**; I have no
  figure for the end-turn enumeration's branching factor or inference time.
- **Latency: architecture online, weights offline.**

### 2.9 Gnecco Heredia & Cazenave, *Expert Iteration for Risk* (ACG 2021, LNCS 13262)

[PDF](https://www.lamsade.dauphine.fr/~cazenave/papers/RiskConferencePaper.pdf)

- **Representation.** Board as a **directed unweighted graph**, one input tensor per country (share of
  total armies, owner, continent, continent bonus, …). Tabula rasa by design.
- **Network.** Deep GCNs (DeeperGCN residual blocks, PyTorch Geometric): 4 shared layers → 4 more per
  head, **5 heads** — pick-country and place-armies as **per-node** distributions, attack and fortify
  as **per-edge** distributions, plus a **value head emitting a 6-vector** (one value per player).
  Boards permuted so the player to move is index 0. Because every policy is a distribution over
  nodes or edges, **the same network works on any map** — a genuinely good idea for a game with
  custom maps.
- **Search/learning.** **Expert Iteration** / AlphaZero-style **PUCT**, **4,000 simulations** per
  expert labelling step. Non-terminal value targets shaped from **armies the player would receive at
  the start of their turn**, normalised and **capped below 0.9**, specifically because earlier agents
  failed to close out won games.
- **Results — honest negative, and instructive.** On a **6-country, 3-continent synthetic hex map**
  with simplified rules, **the draft policy learned fast and well** (it learns to take the
  bonus-9 continent, then the next, and to deny the opponent when the best country is gone). **But**
  policy-only with no search was **worse than random** post-draft, and **"init-only" (net for the
  draft, then random play) outperformed the full agent even after 100 Expert-Iteration iterations.**
  Failure modes: stops attacking while winning, lets opponents recover, hoards armies. They attribute
  this to **chance nodes in the attack phase** needing far more simulations, and say explicitly that
  **Carr's trick of making the attack phase deterministic via a lookup table was probably the key to
  Carr's success.** Hardware: 100-core EPYC, no GPU.
- **Lift.** (1) **Independent confirmation of Gibson: the draft is the learnable, high-leverage
  phase.** (2) The **≤0.9 cap on non-terminal value targets** as a cheap fix for "winning but won't
  close". (3) Their own diagnosis *is* our design recommendation: **precompute the battle-outcome
  distribution instead of sampling dice.**
- **Latency: strictly offline to train.** 4,000 PUCT sims per decision is not a browser budget, and
  their own result shows shipping the net alone is not a shortcut.

### 2.10 Blomqvist, *Playing the Game of Risk with an AlphaZero Agent* (KTH MSc, 2020)

[PDF](https://forums.triplea-game.org/assets/uploads/files/1637032761173-fulltext01.pdf)

- **Setup.** 1 v 1 plus a dormant **neutral** player; 14 random territories and 36 troops each; cards
  auto-traded and **open**; blitz attacks; all-but-one armies move forward.
- **The action-space engineering — the most directly useful part.** Place-troops as one distribution
  has **Tᴺ/N!** unique actions. Instead (following Wolf) it is **N one-troop decisions plus the
  options "place all" and "place half (rounded up)"** — only **two extra legal options per owned
  territory**. Troops may only be placed in **territories that have an enemy neighbour**. Fortify:
  42 × 41 = 1,722 pairs, discretised to **all or half** → **3,445** actions, restricted at play time
  to targets with enemy neighbours. Attack/fortify MCTS uses a **two-level hierarchical node: first
  expand {act, skip}, then all legal actions under "act"** — so **ending the phase is a first-class
  decision**.
- **Search/learning.** MCTS + flat-input net with five policy heads and a scalar value head; Expert
  Iteration; **300 sims** for the apprentice, **10,000** at the expert; rollouts truncated to **8
  turns**; `c₁ = 1.5`.
- **Results — partial.** Zero learning **did** improve MCTS when the learned policy was used as a
  prior, but **performance did not improve with further training iterations** and **the network
  failed to learn a good scalar state evaluation.**
- **Lift.** **Place-all / place-half compression**, **"only reinforce territories with enemy
  neighbours"** pruning, and the **{act, skip} hierarchical node**. All three are pure win for us and
  cost nothing.
- ⚠️ **One claim not to repeat.** The thesis asserts that attacking/defending with the maximum number
  of dice *"has been proven to always be"* optimal, citing Osborne. **Osborne contains no such
  proof** — he computes odds *under* max-dice play. The claim is near-certainly true for blitz, but
  it is not Osborne's result.
- **Latency: offline.**

### 2.11 Knudsen, *Impact of Collusion and Coalitions in RISK* (University of Maryland)

[PDF](https://www.cs.umd.edu/sites/default/files/scholarly_papers/Knudsen_1.pdf)

Not an agent paper — an **empirical study of human coalitions**, which is exactly what we need for
§3.4. Played on Warfish.net, 4 humans + 1 dormant neutral, ties to defender, **fixed 5-unit card
trade-in and card-capture disabled** (to remove the incentive to farm weak players).

- **Operational definition of collusion (transferable).** With `AD_ij` = share of *i*'s attacks
  directed at *j*: **defensive collusion ⇔ `AD_ij ≤ θ_def`**, **offensive collusion ⇔
  `AD_ij ≥ 1 − θ_def`**. Calibrated against secret expert "oracles" who annotated their own games →
  **θ_def = 0.25, θ_off = 0.75**.
- **Power heuristic, directly liftable:**
  **`H_i = (#armies)_i + 0.3 × (#territories)_i + (bonuses)_i`**, players ranked descending;
  coalition impact = `Rank_start − Rank_end` summed over members.
- **Results.** 75 games analysed, 14 with oracles; games ran 7–40 days (async online play).
  **Fog level had no noticeable effect** on turns per game or attacks per turn. A **power-based**
  detector found ~10 % more coalition windows than the attack-distribution one. The thresholds missed
  explicit coalitions that **swapped territories to consolidate bonuses**.
- **Lift.** (1) `H = armies + 0.3·territories + bonuses` as a dirt-cheap "who is winning" ranking to
  drive leader-targeting (§3.4). (2) The **`AD_ij` ratio with 0.25 / 0.75 thresholds** as a
  **detector**, so a bot can notice it is being double-teamed and retaliate or realign.
- **Latency: fully online** — O(territories) arithmetic.

**Related, noted not fetched:** Zuckerman, Felner & Kraus, *Mixing Search Strategies for Multi-player
Games* (IJCAI 2009) — the **MP-Mix** algorithm, which **dynamically switches between maxⁿ, Paranoid
and an Offensive strategy** based on relative power and opponent impact. Gibson et al. record that
MP-Mix was evaluated on Risk by **restricting the branching factor to 3 promising moves, where a
move was an entire sequence of territories to conquer.** That **move-as-conquest-sequence**
abstraction is itself a good browser-bot idea, and the strategy-switching matches our
`leaderBias`/phase logic in §3.4.

### 2.12 Evolutionary Tabletop Game Design: A Case Study in the Risk Game (SBGames/ACM 2023)

[arXiv](https://arxiv.org/abs/2310.20008) · [ACM](https://dl.acm.org/doi/10.1145/3631085.3631236)

Not a player — **game *design* automation.** A **genetic algorithm** evolves Risk's parameters (map
size, balance mechanics), auto-playtested by a rules-based agent against quality criteria. Produced
variants with **smaller maps → shorter matches** and more balanced matches *"maintaining the usual
drama"*; honest limitation: **in many cases the objective was satisfied but the generated games were
nearly trivial.** Relevant to us only if we ship custom maps — their quality criteria are a template
for auto-validating that a map is not degenerate. **Strictly offline.**

### 2.13 Two caveats that apply to every table above

1. **Every published odds table assumes fight-to-the-death.** If our UI lets a player (or bot) stop
   mid-battle — and RGD's "Stop Until" blitz limit does exactly that — then the published conquer
   probabilities are **lower bounds on the value of attacking**, because withdrawal is a free option.
   **Tan himself flagged optimal withdrawal as an unsolved problem and none of these papers solve
   it.** SMG handle it with a `stopUntil` parameter that truncates the distribution and introduces an
   `UnresolvedChance` third outcome (see §4.3 / §5.2) — we should do the same, and we should *not*
   claim optimality for our stop rule.
2. **Hendel, Hoffman, Manack & Wagaman** ([PDF](https://web.williams.edu/Mathematics/sjmiller/public_html/cm/HendelHoffManackWagaman021014.pdf),
   arXiv:1512.04333) extend the lineage combinatorially and give the memorable **"86 % + 2" rule**:
   `Â* = (7161/8391)(D̂ − 1) + 3` armies for a >50 % chance. **But** this is stated for their
   **"virtual conquer" (VC)** odds, which they describe as a close but **conservative** approximation
   to actual conquer odds, and it uses a different army convention (`A = Â − 3`, `D = D̂ − 1`, so `Â`
   counts the garrison). Their Table 4 shows VC consistently demanding ~1 more attacker.
   **Use Osborne's exact table for the gate; treat "86 % + 2" only as a human-facing mnemonic.**

### 2.14 Commercial and open-source Risk bots: Lux Delux and Warzone

The two most relevant non-academic bodies of work, because both are **shipping products with published
bot designs**, and both are what the academic papers above benchmark against.

#### Lux Delux (Sillysoft) — the de-facto heuristic vocabulary

Lux Delux ships an open Java AI SDK ([sillysoft.net/sdk/](https://sillysoft.net/sdk/)) including
*"source code to all the AIs that ship with Lux"*. Its interface is worth copying almost verbatim,
because it is a 20-year-proven decomposition of a Risk turn.

**The `LuxAgent` decision hooks** (verified from the interface source,
[LuxAgent.java](https://github.com/ladnir/Risk_AI_1/blob/master/Risk_AI_1/src/com/sillysoft/lux/agent/LuxAgent.java)):

| Hook | When Lux calls it |
|---|---|
| `setPrefs(int ID, Board board)` | once, at construction |
| `pickCountry()` | repeatedly during the draft, if players pick initial countries |
| `placeInitialArmies(int numberOfArmies)` | after the draft, to place starting armies |
| `cardsPhase(Card[] cards)` | at the very beginning of the agent's turn |
| `placeArmies(int numberOfArmies)` | each turn, to place that turn's income |
| `attackPhase()` | at the start of the attack phase |
| `moveArmiesIn(int attackerCC, int defenderCC)` | **whenever a country is taken over** — how many armies advance |
| `fortifyPhase()` | last phase of the turn |
| `name()`, `version()`, `description()`, `youWon()`, `message(String, Object)` | identity / notifications |

Two things to steal: **`cardsPhase` runs before `placeArmies`** (so a cash-in increases the troops you
then place — our §3.1 card timing depends on this ordering), and **`moveArmiesIn` is a separate
decision** from the attack itself. How many armies you advance into a conquered territory is a real
strategic choice that most clones hard-code to "all but one"; making it a hook is the better design.

**`BoardHelper` utilities** (verified from
[BoardHelper.java](https://github.com/ladnir/Risk_AI_1/blob/master/Risk_AI_1/src/com/sillysoft/lux/util/BoardHelper.java),
1,849 lines — this is effectively the standard heuristic toolkit for Risk bots):

- *Continent queries:* `getContinentSize`, `getContinentBorders`, `getContinentBordersBeyond`,
  `getCountryInContinent`, `numberOfContinents`, `playerOwnsContinent`, `playerOwnsContinentCountry`,
  `playerOwnsAnyContinent`, `playerOwnsAnyPositiveContinent`, `anyPlayerOwnsContinent`
- *Draft / expansion targets:* `getSmallestEmptyCont`, `getSmallestOpenCont`,
  `getSmallestPositiveEmptyCont`, `getSmallestPositiveOpenCont`
- *Strength queries:* `getPlayerArmies`, `getPlayerCountries`, `getPlayerArmiesInContinent`,
  `getEnemyArmiesInContinent`, `getPlayerArmiesAdjoiningContinent`, `getPlayersBiggestArmy`,
  **`getPlayersBiggestArmyWithEnemyNeighbor`**, `playerIsStillInTheGame`
- *Defence:* **`getDefensibleBorders`**, `getDefensibleBordersBeyond`, `getAttackList`
- *Pathing:* `friendlyPathBetweenCountries`, **`cheapestRouteFromOwnerToCont`**,
  `easyCostBetweenCountries`, `easyCostCountryWithOwner`, `easyCostFromCountryToContinent`,
  `closestCountryWithOwner`

**We should provide this exact set as our engine's bot-facing query API.** The highlighted ones
encode real insight: `getPlayersBiggestArmyWithEnemyNeighbor` (the stack that actually threatens you,
not the biggest stack), `getDefensibleBorders` (the *minimal* border set, which is what makes
continent-holding cheap), and `cheapestRouteFromOwnerToCont` (plan a continent acquisition as a path,
not a single attack). `getSmallestPositive*Cont` encodes "prefer small continents with a nonzero
bonus" — the Australia heuristic, generalised to arbitrary maps.

**The shipped bots and their published strategies** (from Sillysoft's
[AgentProfiles](https://sillysoft.net/wiki/?AgentProfiles), quoted):

| Bot | Sillysoft's description | Knob it isolates |
|---|---|---|
| **Stinky** | *"has no brain. He attacks totally randomly… some of the worst strategy, comparable only to the worst n00b imaginable"* | our Easy baseline |
| **Angry** | *"Just attacks as much as possible"* | pure aggression, no evaluation |
| **Communist** | distributes armies **equally** across countries, attacks minimally, fortifies defensively | `spread` placement |
| **Cluster** | *"Considers a 'cluster' of countries rather than the continent as the primary consideration. Defends its cluster… tries to join up multiple clusters into one super-cluster"* | **connectivity over bonuses** |
| **Pixie** | *"The opposite of Cluster — Pixie is primarily motivated by taking and holding continents"* | `continentFocus = 1` |
| **EvilPixie** | *"Like Pixie, with a mean streak. She likes to attack neighbors"* | Pixie + aggression |
| **Yakool** | *"A child of Cluster with the additions that it tries to get cards and tries to take out the continents of people who are too strong"* | + card-seeking, + leader denial |
| **Boscoe** | *"Subclass of Yakool that moderates its attacks… If one player is too strong Boscoe tries to take out all their continents"* | + attack moderation |
| **Bort** | *"Subclass of Boscoe that tries to do only one attack per turn"* | extreme conservatism |
| **Shaft** | *"Will only attack under certain situations"* — hoards armies until dominant, then rapid conquest | the **Stacker** archetype |
| **Quo** | *"One of the smarter bot designs out there."* In a 500-game test across various boards **Quo won 47 % against Nefarious, Boscoe, EvilPixie, Shaft and Bort** | the strong all-rounder |
| **Killbot** | *"Goes out of its way to take out individual players. Goes for continents aggressively and defends them with a force of 20 armies on each border, then masses armies for the next attack"* | explicit **border reserve = 20** |
| **Nefarious** | *"Teams up against humans: extra dangerous when multiple are present… Likes to kill off weak players"* | anti-human teaming |
| **Reaper** | *"A highly advanced bot… Teaming behavior is customizable through chat commands. Likes to kill weak players for their cards, and pop or steal continents"* | kill-for-cards |
| **Chimera** | *"Randomly chooses the behavior from other hard AIs. You can configure the list of bots it chooses from"* | **persona sampling — exactly RGD's design** |
| **Defender** | *"will not try to win the game, but he will work hard to protect the countries he was assigned"* | scenario-only |

**What this tells us.** Lux's whole bot family is a **subclass lattice over one evaluation function**
(`Cluster → Yakool → Boscoe → Bort`; `Pixie → EvilPixie`), where each child adds exactly one
behaviour. That is precisely the tier design in §3.5 — each tier adds behaviours rather than
replacing them — and it is strong evidence the approach produces distinguishable opponents cheaply.
**Chimera is RGD's persona-pool mechanism under another name.** Note also that Quo's 47 % against
five strong siblings is the realistic ceiling for a heuristic bot in a 6-way field (chance ≈ 17 %) —
worth remembering before we over-engineer Expert.

#### Warzone (formerly WarLight) — a task-based architecture, open source

Warzone's AI was **open-sourced in February 2016**
([announcement](https://www.warzone.com/blog/index.php/2016/02/the-warlight-ai-goes-open-source/)),
and the repository ([FizzerWL/WarLight.AI](https://github.com/FizzerWL/WarLight.AI); live mirror
[JustinReiter/WarLight.AI](https://github.com/JustinReiter/WarLight.AI), 235 C# files) contains the
**actual production AI** plus donated competition bots. Rules differ from Risk (simultaneous turns,
bonuses instead of continents, a large card set), so the *mechanics* don't transfer — but the
**architecture does, and it is the best-documented Risk-like bot architecture available.**

Per Warzone's own [AI wiki page](https://www.warzone.com/wiki/AI): *"The AI evaluates a set of
possible actions each turn and assigns a value to each one based on how desirable it believes that
action to be"*, then selects *"using a weighted random process"* — so behaviour is consistent but not
fully predictable. Documented heuristics: prioritise expansion into **neutral** bonuses meeting its
criteria; prefer **nearby** bonuses before attacking opponents; cooperate with teammates.

**The design insight we should adopt wholesale.** The release notes that competition bots were tuned
to *"win the maximum number of games at all costs"*, whereas the production AI prioritises being
**"fun to play against" over pure competitive strength**. That is the correct objective for our
tiers too, and it is the justification for `blunderRate` and personas over raw strength (§3.5).

**The `Prod` (production) AI's decomposition** — note how closely it matches §3:

- *Draft:* `MakePicks/PickTerritories`, **`PickByWeight`**, **`PickCluster`** — a weighted scorer plus
  an explicit clustering picker, independently confirming Gibson et al.'s +0.96-per-adjacent-pair
  finding (§2.6).
- *Orders:* `Expand`, `ExpandNormal`, `MultiAttackExpand`, **`MultiAttackPathToBonus`**,
  `MultiAttackPlan`, `DefendAttack`, **`MoveLandlockedUp`**, **`UtilizeSpareArmies`**,
  `DeployRemaining`, `PlayCards`.
- *Support:* `BonusPath`, `CaptureTerritories`, `ExpansionHelper`, `FindPath`, `Neighbor`.

`MoveLandlockedUp` is exactly our fortify rule ("drain the interior", §3.3) and
`MultiAttackPathToBonus` is exactly "plan a continent acquisition as a path" — both arrived at
independently, which is reassuring.

**`Wunderwaffe` / `JBot`: a task catalogue worth copying as our behaviour list.** These bots decompose
a turn into *tasks* that each propose moves, which are then scheduled and pruned
(`Strategy/MovesCalculator`, `MovesScheduler`, `TransferMovesChooser`, `Move/MovesCleaner`,
`MovesCommitter`). The task list is effectively a complete enumeration of Risk-like bot behaviours:

`ExpansionTask` · `AttackTerritoriesTask` · `BreakTerritoryTask` · `BreakTerritoriesTask` ·
`OneHitBreakTerritoryTask` · `DefendTerritoryTask` · `DefendTerritoriesTask` · `DefendBonusTask` ·
`TakeBonusOverTask` · `FlankBonusTask` · `PreventBonusTask` · `PreventOpponentExpandBonusTask` ·
`PreventTerritoriesTask` · `JoinInAttacksTask` · `MoveIdleArmiesTask` · `PlayCardsTask` ·
`DelayTask` · `DeleteBadMovesTask` · plus `NoPlan*` fallbacks
(`NoPlanAttackBestTerritoryTask`, `NoPlanBreakBestTerritoryTask`, `NoPlanDefendBestTerritoryTask`,
`NoPlanTryoutAttackTask`, `NoPlanCleanupTask`).

Its evaluation layer is equally instructive: `BonusValueCalculator`,
`BonusExpansionValueCalculator`, `TerritoryValueCalculator`, `GameStateEvaluator`, `PicksEvaluator`
(draft), **`OpponentDeploymentGuesser`** (predicts what opponents will place), and
**`StatefulFogRemover` / `StatelessFogRemover`** (two explicit fog-inference strategies) plus
`LastVisibleMapUpdater`. The fog pair is the honest alternative to RGD's fog cheating (§3.2): keep a
last-visible map and *infer*, rather than reading true state.

**Recommendation.** Adopt the **task-proposes-moves + scheduler** architecture for Hard/Expert. It
gives turn coherence (Wolf's problem, §2.1) without search, makes personas trivially expressible as
*which tasks are enabled and their priorities*, and the `NoPlan*` fallbacks are a clean way to make
sure a bot always does something sensible. For Easy/Medium a flat greedy scorer is enough.

> **Licensing.** Lux's SDK is distributed for writing bots for Lux; Warzone's AI release did not state
> explicit licence terms in the announcement. Treat both as **design references read for ideas**, as
> with SMG's dice code (§5.5) — **do not vendor or copy either codebase.** Method *names* and
> architectural decompositions are facts about the design space; their source text is not ours.

#### Lux: the reusable heuristic library and its actual constants

Every shipped Lux bot subclasses `SmartAgentBase`, which is where the real design lives. Verified
behaviours and **concrete tuned constants** — these are the numbers to start our personas from:

- **Continent valuation.** `getEasiestContToTake()` — *"For each continent we calculate the ratio of
  (our armies):(enemy armies). The biggest one wins"*, restricted to `getContinentBonus(cont) > 0`.
  Cheap, map-agnostic, and it reproduces "grab the small continent" without naming Australia.
- **Attack primitives** that bots compose — this composition *is* the difficulty ladder:
  `attackEasyExpand` (hit a border with exactly one enemy neighbour where you outnumber it),
  `attackFillOut` (*"kills little islands to fill out our territory"* — targets enemies with no
  other non-you neighbours, moving **0** armies in), `attackConsolidate` (attack one enemy from two+
  of your borders to **reduce border count**), `attackSplitUp(root, attackRatio)` (split a stack into
  all enemy neighbours, only when `ourArmies > enemyArmies * attackRatio`), and
  `tripleAttackPack` = `attackEasyExpand` + `attackFillOut` + `attackConsolidate`, described as
  *"a combination of the three almost always helpful attacks"*. **Start Medium here.**
- **Tuned constants:** `attackRatio` = **1.2** (Cluster) vs **0.01** (attack-as-much-as-possible);
  `borderForce` = **20** (Pixie/BetterPixie — matching Killbot's published "20 armies on each
  border"); **EvilPixie randomises it: `borderForce = 7 + rand(15)`, `outnumberBy = 1.3`**.
- **Card farming.** `attackForCard(outnumberTimes)` is gated on
  `board.useCards() && !board.tookOverACountry()` and takes the best army-ratio matchup if
  `ourArmies > theirArmies * outnumberTimes`. **Pixie/Yakool/Quo/Boscoe use 1; EvilPixie uses 5.**
  That single parameter is the whole "does this bot farm cards greedily or safely" dial.
- **Leader-ganging, with an explicit trigger.** `placeArmiesToKillDominantPlayer()` fires when
  *"an enemy player has half of all armies or half of all income"* — concretely
  `armies[i] >= totalArmies*0.5 || incomes[i] >= totalIncome*0.5 || countries[i] >= numCountries*0.5`
  — then deploys at the start of the cheapest route to the leader's **cheapest-to-break continent**
  and pops their continents **largest-bonus-first**. **This is a ready-made `leaderBias`
  implementation** (§3.4), and note Lux *does* gang up where Warzone and RGD deliberately do not.
- **Kill valuation discounts for cards.** `Vulture`/`Killbot` reduce each opponent's effective army
  count by `cardsWorth * (theirCards / 3.0)` — i.e. **a victim holding cards is worth more dead** —
  and only commit if `ourArmies > lowestArmyCount * 2`. Exactly our `killValue` in §3.2, with a
  published functional form.
- **Escalation safety valves.** `hogWildCheck()` — *"If we outnumber all the other players combined
  then go HOGWILD"* — and `attackStalemate()`, which triggers when your own armies exceed **1500**:
  *"the game has probably hit a stalemate. Shake things up."* Worth copying; stalemates are a real
  failure mode in bot-only games.
- **Draft.** `setGoalToLeastBordersCont()` (smallest *totally empty* positive-bonus continent first,
  else smallest partially empty), then `pickCountryInContinent()`: prefer an unowned country in the
  goal continent **adjacent to one you already own**, else the one with the **fewest neighbours**.
  Independently the same conclusion as Gibson et al.'s +0.96-per-adjacent-pair weight (§2.6).
- **Useful `Board` / `Country` queries** beyond `BoardHelper`: `getPlayerIncome(player)`,
  `getNextCardSetValue()`, **`tookOverACountry()`** (the card gate), `getPlayerCards(player)`,
  `getContinentBonus`, `getAgentName(player)` (how bots recognise their own kind and team up), and on
  `Country`: `getWeakestEnemyNeighbor()`, `getWeakestEnemyNeighborInContinent()`,
  `getStrongestNeighborOwnedBy()`, `getHostileAdjoiningCodeList()`, `getNumberEnemyNeighbors()`, and
  `canGoto()` — *"maps can contain one-way connections"*, so **adjacency must be directed** in our
  map model. Iterators worth having: `OrderedNeighborIterator` (*"least enemy neighbors first"*),
  `ArmiesIterator(player, minArmies)`, `ClusterBorderIterator(root)`.
- **Card set selection.** `Card.getBestSet(cards, player, countries)` returns a set *"that uses as
  many cards owned by player as possible"* and **prefers sets burning no wildcards**, then one.
  A good default for our auto-trade.

> **Corrections to the brief's assumptions.** `getBestCountryToAttack` **does not exist** in
> `BoardHelper`; the nearest equivalents are `Country.getWeakestEnemyNeighbor()` and
> `SmartAgentBase`'s attack primitives. And **`Mapleman`, `Hopeless`, `Pulsar`, `Ragnarok` and
> `Stengun` are not Lux bots** — they appear nowhere in AgentProfiles or the SDK tree. Bots that *do*
> exist but are not on AgentProfiles: `Trotsky` (*"Communism with some added smarts"*), `BetterPixie`,
> `Vulture`, `Defendo`, `HumanFriendly`. Also `sillysoft.net/lux/dev/` is **404** — the docs are at
> `sillysoft.net/wiki/?WritingYourOwnAI`, and `?AgentProfiles` must be fetched **without** a trailing
> `=` or it silently serves the wiki index.

**Lux's official position on difficulty** (Sillysoft developer, Steam, 29 Apr 2015): *"Lux has sweet
A.I.s for you. It comes with **10 different A.I. personalities of Easy, Medium, and Hard**… The two
strongest are Reaper and BotOfDoom… **None of the A.I.s cheat or have different dice then humans
do.**"* So Lux, RGD and our design all independently land on the same answer: **difficulty is a label
on a set of named personas, not a parameterised knob.** Sillysoft's own dev wiki is candid that the
shipped bots *"use an 'expert system' approach… There is much room for improvement in this."*

**`BotOMatic`** is Sillysoft's user-facing persona editor — *"you can either have BotOMatic imitate
the strategy of an existing bot, or … selectively turn on or off features from BotOfDoom"* — i.e.
**the closest published analogue to RGD's "personas with ~40 attributes"**, and a good model for our
`BotPersona` schema (§3.5).

**Viking** ([JohnMTorgerson/Viking](https://github.com/JohnMTorgerson/Viking)) is the strongest
community Lux bot and the best middle ground between an expert system and MCTS. Each turn it builds a
`masterObjectiveList` of candidate objectives of four types — **takeover**, **knockout** (break a
bonus), **wipeout** (eliminate a player), **landgrab** — scores them all, sorts, and executes the
best. The published scoring:

```
takeover : 10 * (gain + enemyLoss - alliedLoss) / ((cost + ε) * sqrt(turns))
wipeout  : 10 * (gain + enemyLoss) / (cost + ε)
landgrab : 10 * (gain + enemyLoss - alliedLoss) / (cost + ε)
knockout : 10 * (countriesGain + continentGain) / (cost + ε)
draft    : bonus / numBorders * (ourCountries + ε) / totalCountries
```

**The `/ sqrt(turns)` term is the good idea** — *"to discourage large projects"* — and it is exactly
what stops a bot committing to a continent it cannot finish. Viking also has **`smartAreas`**:
*"each area is based on a continent of the map, but may contain extra countries outside of that
continent **to reduce the number of borders to defend**"* — a genuinely better abstraction than
"continent", and one we should consider for Expert. Note its draft formula is literally
`bonus / numBorders`, confirming the bonus-per-border framing in §3.1 is what practitioners use.

#### Warzone: concrete heuristics and two anti-exploit tricks

> **URL note:** `warzone.com` now 302-redirects to **`war.app`**; old wiki/blog links need rewriting.
> Beware that **Warzone 2100 is a different game** — most search results about "Easy/Medium/Hard/
> Insane AI" are that RTS, not this Risk-like.

Per [war.app/wiki/Autopilot](https://war.app/wiki/Autopilot), the shipped AIs are **Prod 1.0**,
**Prod 2.0**, **Prod 2.0 with randomness** (*"the same AI that plays in multi-player, as well as most
single-player levels"*), **Wunderwaffe** and **Cowzow**. So, like RGD, **Warzone has no difficulty
ladder** — it has one AI plus a randomness flag plus boss scripting.

**Warzone explicitly does *not* target the human or the leader** — [war.app/wiki/Cheaters](https://war.app/wiki/Cheaters):
*"the AI does not prefer to attack the human player… In fact, **the AI's code doesn't even look at the
IsHuman flag anywhere** (with the exception of bosses)."* Confirmed in source: `Prod/BotMain.cs`
`WeightNeighbors()` weights opponents purely by **local border pressure** (their attack power on your
borders minus your defence next to them), with **no global leader or income term**. Contrast Lux,
which does gang up. **Pick a stance deliberately:** Lux's trigger is the better *game-feel* choice,
Warzone's the better *fairness* choice; RGD officially sides with Warzone.

Stated design priorities, in SMG-like order of precedence: (1) fun to play against in single-player,
(2) performance, (3) beat humans, (4) fun in multiplayer, (5) beat other bots — with the explicit note
that **being fun matters more than being good**, and a hard budget of roughly **one second per move**
*"even on large maps and relatively slow devices"*. Our budget (§6) is 100 ms, and we are ~3,000×
inside it, so we have strictly more room than a shipped commercial Risk-like AI.

**Bonus weighting** (`Prod/ExpansionHelper.cs`) — a clean, portable scoring function:

```
weight  = 1000 + bonusFuzz(bonus)                  // per-bonus random offset when randomness is on
weight += bonusValue * (isFFA ? 7 : 4)             // FFA values income more
weight -= bonusValue * (turnsToTake - 1)           // penalise slow bonuses
weight -= territoryCount * oneArmyMustStandGuard
armyMult = defenseKillRate + 0.8
per territory:  ours     -> += attackPower  * armyMult
                neutral  -> -= defensePower * armyMult
                opponent -> -= defensePower * 3 * armyMult   // "expansion less likely"
```

and when several bonuses overlap, *"the biggest bonus weight applies at 100%, and all other positive
bonus weights get added in at a reduced weight"* — **divided by 10**. The **`- bonusValue *
(turnsToTake - 1)`** term is the key one: it is the generalisation of "take Australia first" to
arbitrary maps, and it pairs with the wiki's payback rule (below).

**Other portable Prod constants.** Offence/defence split `baseOffenseRatio = isFFA ? 0.3 : 0.6`
(±0.15 with randomness). Armies needed to take a territory:
`round(defensePower / offenseKillRate - 0.5)`, then **+10 % deterministically or up to +20 %
randomly**. Fog: `GuessNumberOfArmies()` — *"we have no way of knowing what's there, so just assume
the minimum"* (the honest fog policy, versus RGD's cheat). Turn pipeline order:
`PlayCards → SpecialUnits → ResolveTeamBonuses → Expand(good) → DefendAttack → Expand(rest) →
DeployRemaining → MoveLandlockedUp → UtilizeSpareArmies`.

**The two anti-exploit tricks worth stealing outright:**

1. **Weighted-random selection over a scored action set** — *"the AI tends to make similar decisions
   in similar situations, but it will not always make the exact same move."* This is the principled
   version of our `blunderRate` (§3.5) and it is what stops players solving the bot. It costs one
   PRNG draw, so seed it per §7.2.
2. **The 1-in-20 deliberately bad attack**, straight from `DefendAttack.TryDoAttack`:
   *"Once in a while, be willing to do a stupid attack. Sometimes it will work out, sometimes it will
   fail catastrophically."* Cheap, and it is the single best line in the repo for making a bot feel
   human rather than mechanical.

**Warzone's human-strategy wiki** also gives a rule we should encode directly — the **bonus payback
period**: *"Bonuses only pay off if they generate more income than you lost armies taking them.
Example: A bonus worth 4 with 10 neutrals in it will cost you (neutrals × defensive kill rate)
armies, say 10 × 0.7 = ~7 armies on average. It will pay off in the 2nd turn already. Taking a bonus
worth 4 with 20 neutrals you may lose ~14 armies, so it will only pay off if you can hold it for at
least 4 turns."* Plus: *"Aim for those bonuses first that can be completed in the least amount of
turns"*, and *"in heads-up games, breaking an opponent's bonus is just as good as (sometimes better
than) taking a bonus yourself"* — which justifies a high `w_contBreak` in 1v1 and a lower one in FFA,
matching Prod's `isFFA ? 4 : 10`.

### 2.15 What the literature collectively tells us to build

| Component | Source | Cost |
|---|---|---|
| Exact conquer odds + expected losses, precomputed | Osborne (verified three ways) | 2 ms build, O(1) lookup |
| Attack gate `A ≥ D + 1`; `A = D ≥ 5` → attack | Osborne; Hahn | free |
| Reinforce by `NBSR` with a floor threshold | Hahn (exact formulas) | O(edges) |
| Attack only when table-favoured ("High Chance Attack") | Hahn — **best measured config** | O(1)/candidate |
| Position eval `myIncome − maxOpponentIncome` | Lozano & Bratz (73 % vs 38 %) | ~15 lines |
| Threat ranking `H = armies + 0.3·territories + bonuses` | Knudsen | O(n) |
| Draft eval `−0.07/enemy-border + 0.96/friendly-pair` + continent curve | Gibson et al. (learned weights) | O(1) |
| Draft search: UCT to end-of-draft only, score the leaf | Gibson et al. | few hundred sims in <100 ms |
| Turn coherence: goal-parallel short searches, or plan-as-score-bias | Lozano & Bratz; Wolf | tunable |
| Action compression: place-all/place-half; reinforce only enemy-adjacent; `{act, skip}` | Blomqvist (after Wolf) | cuts branching by orders of magnitude |
| Attack phase: enumerate end-of-turn states via the precomputed table, then score | Carr; endorsed by Gnecco & Cazenave | cheap, deterministic, replay-friendly |

**Strictly offline:** all weight and network training — Wolf's TD(λ), Gibson's Weka regression over
≈736 k simulated games, Carr's TD(λ)+GCN, Blomqvist's and Gnecco-Cazenave's Expert Iteration at
4,000–10,000 sims/decision, and the 2023 design GA. **Ship learned constants, not learners.**

Three independent results say **the draft decides the game** (Gibson's Random-Quo collapse,
Gnecco-Cazenave's "init-only beats the full agent", Hahn's finding that the eventual winner is
identifiable 60 % of the way in). **Our Expert tier should spend its compute budget on the draft, not
on the attack phase.** That is the single clearest design instruction in the literature, and it is
the opposite of where intuition points.

---

## 3. Concrete heuristics for a tiered bot

### 3.1 Draft / placement

**Continent value heuristic.** The standard formulation across Lux, Warzone and the literature is a
ratio of bonus to cost-of-holding. There are three competing denominators and they rank the classic
map differently — this matters, so here are all three computed for the classic 42-territory map:

| Continent | Terr | Bonus | Border terr. | Ext. adjacencies | Bonus/Terr | **Bonus/Border** | Bonus/(T+B) | Bonus/Ext |
|---|---|---|---|---|---|---|---|---|
| Australia | 4 | 2 | **1** | 1 | 0.50 | **2.00** | 0.40 | **2.00** |
| North America | 9 | 5 | 3 | 3 | 0.56 | 1.67 | 0.42 | 1.67 |
| Asia | 12 | 7 | 5 | 6 | 0.58 | 1.40 | 0.41 | 1.17 |
| Europe | 7 | 5 | 4 | 7 | **0.71** | 1.25 | **0.45** | 0.71 |
| South America | 4 | 2 | 2 | 2 | 0.50 | 1.00 | 0.33 | 1.00 |
| Africa | 6 | 3 | 3 | 6 | 0.50 | 1.00 | 0.33 | 0.50 |

Read this carefully, because it is the single most important table for bot flavour:

- **Bonus ÷ territory count** ranks **Europe first** and Australia joint-last. A bot using only this
  denominator will do the thing players hate — dive into Europe and get eaten.
- **Bonus ÷ border territories** ranks **Australia first (2.00)**, then North America. This is the
  ranking that matches human expert play and the "bots always take Australia" folk observation.
- The defensible scoring function therefore needs **both** terms:

```
contValue(c) = bonus(c) / (acquireCost(c) + holdCost(c))
  acquireCost(c) = Σ over territories not owned ( 1 + enemyTroops(t) * wAcquire )
  holdCost(c)    = borderTerritories(c) * wHold          // wHold ≈ 2.0
```

With `wHold = 2.0` and an empty board this gives Australia 2/(4+2)=0.33, North America
5/(9+6)=0.33, South America 2/(4+4)=0.25, Africa 3/(6+6)=0.25, Europe 5/(7+8)=0.33,
Asia 7/(12+10)=0.32 — i.e. **the hold-cost term is what stops Europe/Asia looking cheap**, and
tuning `wHold` upward is exactly the "turtle vs sprawl" personality dial.

> **Provenance note.** The table above is **computed from the board by me**, not taken from a paper.
> The only *published, learned* continent-value numbers I could verify are Gibson et al.'s regression
> weights (§2.6). Do not cite a "bonus-to-border ratio table" to any paper — several secondary
> summaries claim Robinson's MIT notes contain one and its text does not.

**Published draft weights (use these for Hard/Expert).** Gibson et al.'s learned linear evaluator
(§2.6) is directly copyable and is the only empirically validated draft scorer in the literature:

```
draftScore(player) = continentCurve(territoriesOwnedPerContinent)      // their Fig. 3 shape
                   + 13.38 * (turnPosition == 1)
                   +  5.35 * (turnPosition == 2)
                   -  0.07 * distinctEnemyBorderingTerritories
                   +  0.96 * pairsOfAdjacentOwnedTerritories
value(draft) = max(0, score(me)) / Σ_players max(0, score(p))          // maximise mine, suppress theirs
```

Two things to read off it: **clustering is worth ~14× as much per unit as a border costs**
(+0.96 vs −0.07), and **turn position is worth about as much as 14 adjacent pairs** — so going first
is enormous. Their emergent policy, worth hard-coding as the cheap fallback for Medium:
**claim a contiguous block in North America, and deny opponents by taking the last free territory in
South America or Africa.** For continent-count shape, the paper states Europe has the biggest 0→1
jump, North America's weights rise steeply with count, and South America and Africa have large
all-but-one → all jumps — i.e. **completing a small continent is worth far more than progress toward
a big one**, which is the behaviour players read as "the bot grabbed Australia".

**Position evaluation (the whole-board score).** Lozano & Bratz's one-line evaluator (§2.7) carried
a bot to 73 % against Lux's best, and is ~15 lines:

```
V(state) = expectedIncome(me) - max over opponents p of expectedIncome(p)
  expectedIncome(x) = max(3, floor(territories(x)/3)) + Σ continentBonuses(x) + expectedCardValue(x)
```

Use this as the **root objective** that `TurnPlan` candidates are scored against, with the per-move
`score()` in §3.2 as the cheap proxy inside the loop. It also gives leader-targeting for free: the
`− max opponent income` term means hurting the leader is automatically worth more than hurting
anyone else, **without a special-case rule**.

**Border Security Ratio (BSR).** Use **Hahn's published definition** (§2.5) and **mind the
direction — higher BSR means *more* danger**, which is the opposite of the intuitive reading:

```
BST(t) = Σ enemyTroops(y)  over enemy territories y adjacent to t     // Border Security Threat
BSR(t) = BST(t) / ownTroops(t)                                        // higher = more at risk
NBSR(t) = BSR(t) / Σ_z BSR(z)   over our own territories              // reinforcement share
```

- `BSR ≥ 1` → the attacker has at least parity, so this territory is realistically takeable
  (parity is ≈ a coin flip, §4.4). **Liability.**
- `BSR ≤ 0.67` → comfortable, because the attacker would need ~1.5× to be a solid favourite at small
  scale.
- **Placement rule (Hahn's, and his best-measured configuration):** distribute reinforcements
  **proportionally to `NBSR`**, i.e. the most-threatened borders get the biggest share.
- **Add the threshold Hahn suggested but did not test:** zero out any `BSR` below a floor before
  normalising, otherwise `NBSR` spreads single troops uselessly across many territories ("0.53 units
  on country 2"). With few reinforcements, round to whole troops by largest remainder and give the
  leftovers to the highest-`BSR` territory.
- Supplying a **high**-BSR territory raises its defence; supplying a **low**-BSR territory raises its
  **offensive** potential. That is the knob that separates a turtle from an attacker, and it is the
  same code path.

> **Watch this in review:** it is extremely easy to implement BSR inverted. Hahn's worked example is
> the test fixture: enemy stacks of 7, 4 and 5 adjacent to a territory holding 5 gives
> `BST = 16`, `BSR = 16/5 = 3.2`, and with sibling BSRs of 4 and 1.25, `NBSR = 3.2/8.45 = 0.37`.

**"Reinforce the front", spreading vs stacking.** Three placement policies, assigned by tier:

| Policy | Behaviour | Use |
|---|---|---|
| `spread` | 1 troop at a time onto a random owned territory | Easy — looks naive, is naive |
| `frontLoad` | all troops onto the single best attack springboard | Hard/Expert when an attack plan exists |
| `secure` | fill lowest-BSR borders to `bsrTarget`, remainder to the springboard | Medium+ default |
| `stack` | everything onto one territory regardless of plan | the **Stacker** persona |

**Card-trade timing.** RGD ships **four** card modes — **Fixed**, **Progressive**, **Exponential**
and **Per-Player** — with Fixed being **4 / 6 / 8 / 10** (per SMG's sandbox documentation). Correct
play differs sharply by mode, and **I found no first-party or player statement about what RGD's bots
actually do with cards** beyond "they trade and dump the troops onto one stack", so the rules below
are derived, not replicated:

- **Fixed sets** (4/6/8/10/12/15 then +5): the set value is independent of who cashes, so **trade
  as soon as you legally can** — there is no option value in holding, only risk of elimination.
  Only exception: hold if cashing *this* turn would put you below the troop count needed to survive,
  which essentially never happens.
- **Progressive sets** (a single escalating global counter): the set value rises with every set
  cashed by *anybody*, so holding has real option value. The decision rule:
  - **Hold** while `nextSetValue` is still rising fast relative to the number of turns you expect to
    survive, and while holding ≤ 4 cards (5 forces a trade).
  - **Trade immediately** if (a) you hold 5 cards (forced), (b) cashing now converts into a
    continent break or a kill that is worth more than the future set, or (c) your survival
    probability this round is below `panicThreshold` — dead players' cards go to their killer, so a
    hoarded hand is a bounty on your head.
  - **Expert extra:** track every player's card count (public information) and estimate the next
    *two* set values; if an opponent is about to cash a huge set, pre-emptively break their
    continent so the troops land on a weaker position.
- **Eliminate-for-cards:** if killing player *P* this turn hands us cards that complete a set, the
  set's troop value is added to the kill's score. This is the single highest-value play in Risk and
  **only Hard and Expert should see it** (§3.2).

### 3.2 Attack

**Core decision.** For every (source, target) adjacent pair where `source.troops ≥ 2`, score:

```
score(src, dst) = p * gain(dst) - (1 - p) * sunkCost(src) - risk(dst)
  p        = winChance[src.troops - 1][dst.troops]        // table lookup, §4.5
  gain     = w_terr
           + w_contComplete * completesContinent(dst)
           + w_contBreak    * breaksEnemyContinent(dst)
           + w_kill         * (eliminates(dst.owner) ? killValue(dst.owner) : 0)
           + w_card         * (firstConquestThisTurn ? expectedCardValue : 0)
  sunkCost = expected troops lost, from the loss distribution, not a constant
  risk     = exposure of dst after capture = Σ enemy troops adjacent to dst
```

`killValue(P)` = `cardSetValue(our cards + P's cards)` + `P`'s territory count × `w_terr`. This is
why eliminating a player is usually the best move available and why only high tiers should see it.

**The attack gate — and the folk rule to avoid.** Hahn's best-measured configuration (§2.5) is
*"Full Force Attack + a battle-win-probability check against Osborne's table"*, and he found
**attack-heuristic quality was the single largest driver of bot strength**. The correct break-even
is **`A ≥ D + 1`** (Osborne; confirmed by my own table in §4.4, where every `A = D + 1` cell sits
just above 50 %: 0.754, 0.656, 0.642, 0.638, 0.640, 0.643, 0.646, 0.650), and **`A = D ≥ 5` is
already favourable**.

> ⚠️ **Do not use the "attack with twice as many armies" rule.** It comes from Tan (1997), whose
> two-dice-vs-two-dice probabilities are wrong because of an independence error (§2.3), and it makes a
> bot **materially too passive**. Osborne's explicit recommendation is *"for the attacker to be more
> aggressive."* This folk rule is widespread in online Risk guides, so expect it to resurface in
> review.

**Collapse the attack phase into end-of-turn states (Hard/Expert).** Carr's agent — the strongest
published Risk AI (§2.8) — **enumerates reachable end-of-turn states using a precomputed
battle-outcome table and searches over those**, rather than deciding one attack at a time against
sampled dice. Gnecco & Cazenave explicitly credit this as the reason it worked where their own
AlphaZero agent failed. For us this is nearly free, because §4's tables are exactly the lookup it
needs, and it has a second benefit: **it is deterministic**, so it consumes no PRNG draws during
planning (§7). Use **conquest *sequences*, not single attacks, as the unit of choice** — the same
abstraction MP-Mix used to make Risk tractable (§2.11).

**Stop conditions.** A bot must stop attacking before it is overextended. Three stacked gates:

1. **Win-probability floor:** stop when the best `p` falls below the tier's `minWinChance`
   (Easy 0.25, Medium 0.45, Hard 0.55, Expert dynamic — see below).
2. **Border reserve:** never attack out of a territory if doing so drops it below
   `reserve(t) = ceil(maxAdjacentEnemyStack(t) * tierReserveFactor)`. This is the concrete form of
   "keep X troops on borders".
3. **Marginal value:** Expert stops when `score(best) ≤ 0`, i.e. it stops *because the maths says so*
   rather than at a fixed threshold. This is the single biggest strength jump between Hard and
   Expert and it costs nothing (one extra comparison).

**When to break a continent.** Breaking is worth the opponent's bonus **per turn, for every turn
they stay broken**. Score it as `w_contBreak = bonus(c) * expectedTurnsBroken`, with
`expectedTurnsBroken ≈ 1 / (1 + theirReconquestEase)`. A one-territory poke into a 7-troop Asia is
usually *bad* (they retake it and you fed them a card); a break that leaves the broken territory
defensible is excellent. **Rule: only break if post-capture BSR of the captured territory ≥ 1.0, or
if the bonus denied ≥ 5.**

**70%-domination awareness.** RGD's standard win condition is holding a share of the map. A bot must
(a) notice when *it* is near the threshold and switch from value-maximising to **territory-count
maximising** (cheap targets, not valuable ones), and (b) notice when *an opponent* is near it and
switch to **denial** — attack the leader's thinnest territories to drag their count down, even at
negative local score. Gate: `if leaderShare > dominationThreshold - 0.1 then leaderBias = 1.0`.

**Capitals awareness.** From SMG's dice source, a **capital grants the defender +1 die**
(`DiceAugment.OnCapital` → `defendDiceCount += 1`), i.e. a capital assault is **3v3, not 3v2**. That
is a large swing and the bot *must* use the capital-specific table, not the standard one. My DP
confirms a 30v15 capital assault is only **69.79%** for the attacker, where 30v15 on open ground is
far higher. Capital mode also changes the win condition (hold all capitals), so capitals get a large
flat `gain` bonus and capital defence gets a large `reserve` multiplier.

Also from the same source: `IsBehindWall` → **defender +1 die** (same as capital), and `IsZombie` →
attacker **−1 die** when the attacker is a zombie, and **ties go to the attacker** when the defender
is a zombie (`favourDefenderOnDraw = false`). We need all four variants of the table if we ship
those modes (§4.5).

**Fog awareness.** SMG admit their AI sees through fog. We have a choice:
- **Honest bots** (recommended default): maintain a per-bot belief of last-seen troop counts, and
  inflate unknown stacks by a `fogPessimism` factor. This makes bots behave plausibly and is a
  genuine difficulty dial.
- **Cheating bots** (RGD parity): read true state. Cheaper, and matches RGD.
Recommendation: **honest for Easy/Medium, cheating for Expert**, and document it. It gives Expert a
real edge in fog games exactly as RGD does, while keeping low tiers fair-feeling.

### 3.3 Fortify

Classic Risk allows one fortify move (RGD variants allow more). The rule is simple and effective:

```
for each owned territory t, interiorness(t) = (no adjacent enemy) ? 1 : 0
moveable(t) = t.troops - 1                       // interior territories only
destination = argmax over owned, adjacent-reachable d of  threat(d) / max(1, d.troops)
  threat(d) = Σ enemy troops adjacent to d, weighted by whether d is a border of a continent we hold
```

So: **drain the interior, feed the most-threatened border**, preferring borders of continents whose
bonus we are collecting. Expert adds a second term — prefer the border that is also the best
*springboard* for next turn's plan, breaking ties toward offence.

### 3.4 Target selection among players

**Strength ranking — use Knudsen's published heuristic** (§2.11), measured against expert-annotated
human games:

```
H(p) = armies(p) + 0.3 * territories(p) + continentBonuses(p)
normalisedStrength(p) = H(p) / Σ_q H(q)
```

**Detecting that you are being double-teamed — also Knudsen's, also calibrated.** Track `AD_ij`, the
share of player *i*'s attacks directed at *j*:

```
beingTargetedBy(p) = AD[p][me] >= 0.75      // offensive collusion threshold
ignoringMe(p)      = AD[p][me] <= 0.25      // defensive collusion threshold
```

These two thresholds (0.25 / 0.75) were calibrated against secret expert players who annotated their
own games. A bot that notices `beingTargetedBy` and responds — by turtling, by realigning, or by
retaliating — will feel markedly smarter than one that does not, for about ten lines of code. This
is also the honest way to deliver the "bots gang up / bots respond to coalitions" behaviour players
ask SMG for (§1.1): **make it reactive and observable rather than a hidden global rule.**

A per-opponent `hostility` score, recomputed each turn:

```
hostility(P) =  w_lead    * normalisedStrength(P)        // hit the leader
              + w_weak    * (1 - normalisedStrength(P))  // or farm the weak
              + w_grudge  * grudge[P]                    // retaliate
              + w_cards   * cardCount(P)                 // deny a big cash-in
              + w_prox    * borderContact(us, P)
              - w_turtle  * turtleScore(P)               // don't poke a turtle
              - w_ally    * allied(P)
```

- **Hit the leader:** `w_lead` high. Correct late, bad early (you bleed while others grow).
  Make it **phase-dependent**: `w_lead` scales with game progress.
- **Don't poke a turtle:** `turtleScore(P)` = mean troops per border territory of *P*. A player with
  20 troops on one Australian border is a terrible target — high cost, low gain. This single term
  removes most of the "bot throws armies into a meat grinder" complaint.
- **Retaliate:** `grudge[P] += troopsLostTo(P)` each turn, decayed by `grudgeDecay` per turn
  (0.5–0.9). Grudge memory is what makes bots feel like they have a personality and is nearly free.
- **Alliances:** if alliances are enabled, `w_ally` is huge for Easy/Medium (bots honour alliances —
  matching the folk claim that "bots never break alliances") and **finite** for Expert, which will
  break an alliance when `score(betrayal) > allianceValue`, typically when a betrayal wins the game
  outright or when the ally is the runaway leader. Expert betrayal should be **rare and decisive**,
  never a repeated nibble.

### 3.5 Personality knobs

Mirror SMG's persona architecture: a `BotPersona` is a named struct of weights, and **difficulty
selects the pool of personas plus the competence caps**, not a single slider.

```ts
interface BotPersona {
  name: string;
  // aggression
  aggression: number;        // 0..1  scales minWinChance down, attack chain length up
  minWinChance: number;      // attack-stop floor
  reserveFactor: number;     // border troops kept = factor * largest adjacent enemy stack
  // strategy
  continentFocus: number;    // 0..1  weight on contComplete / contBreak
  expansionism: number;      // 0..1  territory count vs territory quality
  stackiness: number;        // 0..1  frontLoad/stack vs secure/spread placement
  turtleAversion: number;    // 0..1  weight on not poking high-BSR players
  // social
  leaderBias: number;        // 0..1  hit-the-leader weight
  grudgeWeight: number;
  grudgeDecay: number;       // 0.5 .. 0.95
  allianceLoyalty: number;   // 0..1, 1 = never betrays
  // competence (the real difficulty dial)
  lookahead: 0 | 1 | 2;
  seesKillForCards: boolean;
  seesCardTradeTiming: boolean;
  seesDominationThreshold: boolean;
  usesExactOdds: boolean;    // exact table vs a crude troop-ratio guess
  fogHonest: boolean;
  blunderRate: number;       // probability of taking the 2nd..k-th best move instead of the best
}
```

**Recommended tiers.** Each tier *adds* behaviours; nothing is removed.

| | **Easy** | **Medium** | **Hard** | **Expert** |
|---|---|---|---|---|
| Persona pool | Friendly, Defensive | + Continental, Stacker | + Aggressive | all, weighted to Continental/Aggressive |
| Odds model | troop-ratio guess (`usesExactOdds=false`) | exact table | exact table | exact table + loss distribution |
| `minWinChance` | 0.25 | 0.45 | 0.55 | dynamic (`score ≤ 0`) |
| `blunderRate` | 0.30 | 0.12 | 0.03 | 0.00 |
| Placement | `spread` | `secure` | `secure` + springboard | `secure` + planned springboard |
| Fortify | random legal / none | drain interior → nearest border | threat-weighted | threat-weighted + springboard tiebreak |
| Continent logic | none | completes a continent if 1 territory away | full acquire/hold scoring, breaks continents | + denies opponents' pending bonuses |
| Cards | trades when forced | trades at 3 (fixed) | progressive timing | + tracks all players' card counts |
| Kill for cards | no | no | yes | yes, and sets it up a turn ahead |
| Domination/capitals | ignores | notices own progress | notices own + leader's | full denial behaviour |
| Fog | honest + pessimistic | honest | honest | **sees through fog** (RGD parity) |
| Lookahead | 0 | 0 | 1 (best reply) | 2 (our turn + worst-case reply) |
| Alliances | `allianceLoyalty` 1.0 | 1.0 | 0.9 | 0.6, breaks decisively |

**Concrete persona set**, mapped to RGD's named personas and their proven Lux equivalents (§2.14) so
each one has a published behavioural reference rather than being invented:

| Our persona | RGD name | Lux equivalent | Defining knobs |
|---|---|---|---|
| Rusher | Aggressive | Angry / EvilPixie | `aggression` 0.9, `minWinChance` 0.3, `reserveFactor` 0.5 |
| Continental | Continental | Pixie | `continentFocus` 1.0, `expansionism` 0.4 |
| Clusterer | — | Cluster | scores connectivity over bonuses; `continentFocus` 0.3 |
| Hoarder | Stacker | Shaft | `stackiness` 1.0, attacks only when dominant |
| Turtle | Defensive | Bort | one attack per turn, `minWinChance` 0.8, `reserveFactor` 2.0 |
| Opportunist | Friendly | Yakool / Boscoe | card-seeking + leader-continent denial, moderate aggression |
| Assassin | — | Killbot / Reaper | `seesKillForCards`, **border reserve ≈ 20** (Killbot's published value), masses between kills |
| Wildcard | — | Chimera | samples another persona at match start — RGD's own mechanism |

Killbot's *"defends them with a force of 20 armies on each border, then masses armies for the next
attack"* is the only **published absolute reserve number** I found anywhere; use it as the Assassin's
`reserveFloor` and as a sanity check that our `reserveFactor` produces numbers in that ballpark on a
mature board.

**`blunderRate` is the honest way to build Easy.** Do not make Easy bots *compute badly* — make them
compute correctly and then pick a worse move. This keeps one code path (vital for determinism, §7),
makes Easy bots fast, and avoids the classic bug where a "dumb" bot is accidentally strong.

---

## 4. Exact dice math

### 4.1 Single-roll probabilities — verified

Standard rules: attacker rolls up to 3 dice, defender up to 2, highest-vs-highest and
second-vs-second compared, **ties go to the defender**, `min(attackerDice, defenderDice)` casualties
are inflicted per roll. Computed by exhaustive enumeration of all `6^(a+d)` outcomes:

| Roll | Outcomes | Attacker loses 0 | Attacker loses 1 | Attacker loses 2 | Exact fractions |
|---|---|---|---|---|---|
| **3 v 2** | 7 776 | **37.1656 %** (def −2) | **33.5777 %** (split) | **29.2567 %** (att −2) | 2890/7776, 2611/7776, 2275/7776 |
| **3 v 1** | 1 296 | **65.9722 %** | **34.0278 %** | — | 855/1296, 441/1296 |
| **2 v 2** | 1 296 | **22.7623 %** (def −2) | **32.4074 %** (split) | **44.8302 %** (att −2) | 295/1296, 420/1296, 581/1296 |
| **2 v 1** | 216 | **57.8704 %** | **42.1296 %** | — | 125/216, 91/216 |
| **1 v 2** | 216 | **25.4630 %** | **74.5370 %** | — | 55/216, 161/216 |
| **1 v 1** | 36 | **41.6667 %** | **58.3333 %** | — | 15/36, 21/36 |

All six verified. Note `2890/7776 = 1445/3888` and `420/1296 = 35/108` reduce — the unreduced forms
above all share the natural denominator and are easier to sanity-check (rows sum to the denominator).

**Independent cross-check against SMG's own code.** The risk-dice README prints
`roundInfo.AttackLossChances[2] // 0.292566872427984` for a standard 3v2 round. My enumeration gives
`2275/7776 = 0.2925668724279835`. **Exact match.** This is first-party confirmation that RGD uses
textbook ties-to-defender rules and that the numbers above are the ones the real game uses.

### 4.2 Expected casualties per roll

Useful for cheap heuristics at low tiers (and for `sunkCost`):

| Roll | E[attacker loss] | E[defender loss] | Defender losses per attacker loss |
|---|---|---|---|
| 3 v 2 | 0.9209 | 1.0791 | **1.172** |
| 3 v 1 | 0.3403 | 0.6597 | 1.939 |
| 2 v 2 | 1.2207 | 0.7793 | 0.638 |
| 2 v 1 | 0.4213 | 0.5787 | 1.374 |
| 1 v 2 | 0.7454 | 0.2546 | 0.342 |
| 1 v 1 | 0.5833 | 0.4167 | 0.714 |

**The strategic fact that falls out of this table:** 3v2 is only a **1.172 : 1** edge — attacking is
barely profitable at full dice, and is *losing* at 2v2 (0.638) and 1v2 (0.342). A bot that attacks
with fewer than 3 dice, or into 2 defenders without a big stack, is throwing troops away. Encode as
a hard gate: **never initiate an attack from a territory with fewer than 4 troops** (3 attacking
dice + 1 left behind) unless the target has 1 troop or the move completes/denies a continent.

### 4.3 Full-battle win probability — the DP formulation

Let `A` = attacking troops *excluding the one that must stay behind*, `D` = defending troops. (This
matches SMG's convention: their README states calculations *"do not include the single attack troop
that stays behind"*, so a 20-troop territory attacking a 10-troop one is `BattleConfig(19, 10, 0)`.)

Let `a = min(A, 3)`, `d = min(D, 2)`, `c = min(a, d)`, and `r[a][d][k] = P(attacker loses k of c)`
from §4.1. Then:

```
W[A][0] = 1                      for all A ≥ 0      (defender annihilated)
W[0][D] = 0                      for all D ≥ 1      (attacker exhausted)
W[A][D] = Σ(k = 0 .. c)  r[a][d][k] · W[A − k][D − (c − k)]
```

This is an absorbing Markov chain solved by **dynamic programming in reverse lexicographic order of
`A + D`**, which is legitimate because every transition strictly decreases `A + D` by exactly `c ≥ 1`.
No matrix inversion, no iteration to convergence, **O(A·D) time and O(A·D) space**, exact to
floating-point.

For the **full outcome distribution** (needed for Balanced Blitz and for `sunkCost`), run the same
recursion *forward* over reachable states and accumulate into two arrays, exactly as SMG's
`BattleInfo` does:

```
attackLoss[i]  for i < A  = P(attacker wins having lost i troops)
attackLoss[A]             = P(attacker loses the battle)       // = DefendWinChance
defendLoss[j]  for j < D  = P(defender wins having lost j troops)
defendLoss[D]             = P(attacker wins the battle)        // = AttackWinChance
```

**Validation.** I implemented this and checked it against the one large non-trivial number SMG
publish: *"the win chance for attacking 800 zombies with 300 troops"*, which their code prints as
`0.8897331`. Zombie defenders set `favourDefenderOnDraw = false`. My DP returns
**0.8897332621740284**. Agreement to 7 significant figures (their value is a 32-bit float print of
the same double). **The DP formulation above is the one RGD uses.**

### 4.4 Reference table: P(attacker conquers), standard 3v2

`A` excludes the troop left behind. Percentages.

| A\D | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 41.67 | 10.61 | 2.70 | 0.69 | 0.18 | 0.04 | 0.01 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| 2 | 75.42 | 36.27 | 20.61 | 9.13 | 4.91 | 2.14 | 1.13 | 0.49 | 0.26 | 0.11 | 0.06 | 0.03 |
| 3 | 91.64 | 65.60 | 47.03 | 31.50 | 20.59 | 13.37 | 8.37 | 5.35 | 3.28 | 2.08 | 1.26 | 0.79 |
| 4 | 97.15 | 78.55 | 64.16 | 47.65 | 35.86 | 25.25 | 18.15 | 12.34 | 8.62 | 5.72 | 3.92 | 2.55 |
| 5 | 99.03 | 88.98 | 76.94 | 63.83 | 50.62 | 39.68 | 29.74 | 22.40 | 16.16 | 11.83 | 8.29 | 5.94 |
| 6 | 99.67 | 93.40 | 85.69 | 74.49 | 63.77 | 52.07 | 42.33 | 32.95 | 25.78 | 19.34 | 14.70 | 10.72 |
| 7 | 99.89 | 96.66 | 90.99 | 83.37 | 73.64 | 64.01 | 53.55 | 44.56 | 35.69 | 28.68 | 22.19 | 17.33 |
| 8 | 99.96 | 98.03 | 94.68 | 88.78 | 81.84 | 72.96 | 64.29 | 54.74 | 46.40 | 37.99 | 31.17 | 24.70 |
| 9 | 99.99 | 99.01 | 96.70 | 92.98 | 87.29 | 80.76 | 72.61 | 64.64 | 55.81 | 47.99 | 39.99 | 33.37 |
| 10 | 100.00 | 99.42 | 98.11 | 95.39 | 91.63 | 86.11 | 79.98 | 72.40 | 65.01 | 56.76 | 49.40 | 41.75 |
| 11 | 100.00 | 99.71 | 98.84 | 97.20 | 94.30 | 90.52 | 85.20 | 79.41 | 72.30 | 65.38 | 57.63 | 50.65 |
| 12 | 100.00 | 99.83 | 99.35 | 98.20 | 96.37 | 93.35 | 89.61 | 84.49 | 78.99 | 72.28 | 65.76 | 58.43 |
| 13 | 100.00 | 99.91 | 99.60 | 98.93 | 97.58 | 95.61 | 92.54 | 88.86 | 83.92 | 78.68 | 72.32 | 66.14 |
| 14 | 100.00 | 99.95 | 99.78 | 99.32 | 98.50 | 96.99 | 94.93 | 91.84 | 88.23 | 83.46 | 78.45 | 72.40 |
| 15 | 100.00 | 99.98 | 99.87 | 99.60 | 99.02 | 98.06 | 96.44 | 94.32 | 91.23 | 87.70 | 83.09 | 78.28 |
| 16 | 100.00 | 99.99 | 99.93 | 99.75 | 99.40 | 98.70 | 97.64 | 95.93 | 93.77 | 90.70 | 87.25 | 82.79 |
| 17 | 100.00 | 99.99 | 99.96 | 99.86 | 99.61 | 99.18 | 98.38 | 97.24 | 95.47 | 93.28 | 90.25 | 86.87 |
| 18 | 100.00 | 100.00 | 99.98 | 99.91 | 99.77 | 99.46 | 98.95 | 98.06 | 96.86 | 95.04 | 92.85 | 89.85 |
| 19 | 100.00 | 100.00 | 99.99 | 99.95 | 99.85 | 99.66 | 99.29 | 98.71 | 97.76 | 96.50 | 94.65 | 92.46 |
| 20 | 100.00 | 100.00 | 99.99 | 99.97 | 99.91 | 99.78 | 99.55 | 99.11 | 98.48 | 97.47 | 96.17 | 94.29 |

**Break-even ratios** (minimum `A` to be a favourite / to reach 80 %):

| D | A for ≥50 % | ratio | A for ≥80 % |
|---|---|---|---|
| 1 | 2 | 2.00 | 3 |
| 2 | 3 | 1.50 | 5 |
| 3 | 4 | 1.33 | 6 |
| 5 | 5 | 1.00 | 8 |
| 10 | 10 | 1.00 | 14 |
| 20 | 18 | 0.90 | 24 |
| 30 | 27 | 0.90 | 34 |
| 50 | 44 | 0.88 | 53 |

The headline heuristic for low tiers that can't afford a lookup: **parity is roughly a coin flip, and
the attacker needs ~1.2× for comfort at small scale, converging to ~0.9× (a slight attacker
advantage) at large scale** because the attacker rolls more dice. Small battles favour the defender,
large battles favour the attacker — a bot that doesn't know this will misjudge both ends.

### 4.5 Runtime strategy: precompute, then approximate

Measured in Node (see §6): building the DP table for `A, D ≤ 100` takes **2.07 ms** and occupies
**80 KiB** as a `Float64Array`; for `A, D ≤ 200`, **1.80 ms** and **316 KiB**. Lookups run at
**~1.15 ns** each.

Recommendation:

1. **Precompute `W[A][D]` for `A, D ≤ 128` at engine init** (`Float32Array` is ample precision for
   a heuristic — halves memory to 65 KiB). Build once, share across all bots and all games.
2. **One table per dice variant.** From SMG's `DiceAugment` we need: standard (3v2), capital /
   behind-wall (3v3, defender +1 die), zombie-attacker (2v2), zombie-defender (3v2 with ties to the
   attacker). Four 128×128 `Float32Array`s = **260 KiB total**. Still trivial.
3. **Beyond the table, use a fitted logistic — and do *not* clamp.** Win chance is well described by
   a logistic in the *normalised troop difference*:

   ```
   p ≈ σ( (A − α·D) / (β·√(A + D)) )        α = 0.860, β = 0.630
   ```

   I grid-fitted `α, β` against the exact table on the `A, D ∈ [64, 128]` band and then measured the
   extrapolation error:

   | Strategy | Max abs error | RMS error | 50 % decision flips |
   |---|---|---|---|
   | **Logistic, α=0.860 β=0.630** | **0.0318** | **0.0088** | 31 / 8281 (0.37 %) |
   | Ratio-preserving rescale into the 128 table | 0.1468 | 0.0479 | 3 / 8281 |
   | **Clamp `W[min(A,128)][min(D,128)]`** | **0.8565** | — | — |

   (errors measured over `A, D ∈ [129, 400]`; fit-band max error is 0.0142)

   **Clamping each index independently is badly wrong** — it destroys the *ratio*, which is the
   entire signal, so 129 attackers vs 381 defenders (true win chance ≈ 0 %) reads as 85.65 %. Use
   the logistic. The ratio-preserving rescale `s = 128/max(A,D)` is an acceptable fallback if we want
   to avoid `exp` — it flips fewer 50 % calls — but it is poorly calibrated (RMS 0.048), so prefer
   the logistic for anything that compares scores across candidates.

   In practice a 128-entry table already covers essentially all real play; stacks above ~128 on a
   single territory are vanishingly rare outside extreme progressive-card games.
4. **Do not simulate.** Monte-Carlo battle estimation is the obvious wrong turn here: it is orders of
   magnitude slower than a table lookup *and* it consumes PRNG draws, which breaks determinism (§7).

### 4.6 Mode variants: capital, wall, zombie

From `DiceAugment` / `RoundConfig.ApplyAugments` (see Sources), the four variants and their
single-roll tables, all recomputed here:

**Capital / behind-wall — defender rolls up to 3 dice.** Note `defendDice = min(D, 3)`, so this is
**identical to standard play when the defender has only 1 or 2 troops**; it only bites at `D ≥ 3`.

| Roll | att −0 | att −1 | att −2 | att −3 |
|---|---|---|---|---|
| 3 v 3 | **13.7603 %** (def −3) | 21.4699 % | 26.4660 % | **38.3038 %** |
| 2 v 3 | 12.5900 % (def −2) | 25.4758 % | 61.9342 % | — |
| 1 v 3 | 17.3611 % | 82.6389 % | — | — |

**Zombie defender — ties go to the attacker** (`favourDefenderOnDraw = false`):

| Roll | att −0 | att −1 | att −2 |
|---|---|---|---|
| 3 v 2 | **61.9342 %** | 25.4758 % | 12.5900 % |
| 2 v 2 | 44.8302 % | 32.4074 % | 22.7623 % |
| 1 v 2 | 42.1296 % | 57.8704 % | — |
| 3 v 1 | 82.6389 % | 17.3611 % | — |
| 1 v 1 | 58.3333 % | 41.6667 % | — |

**Zombie attacker — attacker loses a die** (`max 2 dice`, ties still to defender): use the standard
`2 v 2` and `2 v 1` rows from §4.1.

**How much capitals matter.** `P(attacker conquers)`, capital (3v3) / standard (3v2), %:

| A\D | 1 | 2 | 3 | 5 | 8 | 10 |
|---|---|---|---|---|---|---|
| 2 | 75.42 / 75.42 | 36.27 / 36.27 | 12.20 / 20.61 | 1.62 / 4.91 | 0.08 / 0.49 | 0.01 / 0.11 |
| 3 | 91.64 / 91.64 | 65.60 / 65.60 | 32.76 / 47.03 | 11.73 / 20.59 | 1.75 / 5.35 | 0.46 / 2.08 |
| 5 | 99.03 / 99.03 | 88.98 / 88.98 | 56.65 / 76.94 | 27.78 / 50.62 | 7.05 / 22.40 | 2.62 / 11.83 |
| 8 | 99.96 / 99.96 | 98.03 / 98.03 | 81.62 / 94.68 | 54.20 / 81.84 | 21.86 / 54.74 | 10.62 / 37.99 |
| 10 | 100.00 / 100.00 | 99.42 / 99.42 | 90.08 / 98.11 | 68.14 / 91.63 | 34.11 / 72.40 | 19.02 / 56.76 |
| 15 | 100.00 / 100.00 | 99.98 / 99.98 | 98.01 / 99.87 | 88.53 / 99.02 | 63.12 / 94.32 | 44.76 / 87.70 |
| 20 | 100.00 / 100.00 | 100.00 / 100.00 | 99.58 / 99.99 | 96.40 / 99.91 | 82.64 / 99.11 | 68.39 / 97.47 |

**Augments stack** — SMG state this explicitly (§1.1): *"These also STACK!"*. So a **capital behind a
wall gives the defender up to 4 dice**, and a zombie attacker hitting a capital is 2 v 3. The stacked
single-roll rows:

| Roll | att −0 | att −1 | att −2 | att −3 |
|---|---|---|---|---|
| 3 v 4 | **7.3285 %** (def −3) | 14.8359 % | 23.4107 % | **54.4249 %** |
| 2 v 4 | 7.5939 % (def −2) | 20.1346 % | 72.2715 % | — |
| 1 v 4 | 12.5900 % | 87.4100 % | — | — |

`P(attacker conquers)`, **standard / capital / capital+wall**, %:

| A\D | 3 | 5 | 10 |
|---|---|---|---|
| 5 | 76.94 / 56.65 / 56.65 | 50.62 / 27.78 / 16.47 | 11.83 / 2.62 / 0.57 |
| 10 | 98.11 / 90.08 / 90.08 | 91.63 / 68.14 / 48.96 | 56.76 / 19.02 / 5.31 |
| 15 | 99.87 / 98.01 / 98.01 | 99.02 / 88.53 / 72.89 | 87.70 / 44.76 / 16.55 |
| 20 | 99.99 / 99.58 / 99.58 | 99.91 / 96.40 / 86.93 | 97.47 / 68.39 / 32.80 |
| 30 | 100.00 / 99.98 / 99.98 | 100.00 / 99.71 / 97.39 | 99.95 / 92.87 / 65.20 |

(Capital and capital+wall coincide at `D = 3` because `defendDice = min(D, maxDefDice)`.)

**Implementation consequence:** model the augment as an **integer `defendDiceBonus` / `attackDicePenalty`
per battle, summed from all active modifiers**, and key the odds-table cache on the resulting
`(attackDice, defendDice, favourDefenderOnDraw)` triple. Do **not** enumerate named modes — that is
how you end up missing the stacked combination. With `attackDice ∈ {1,2,3}` and
`defendDice ∈ {1,2,3,4}` plus two tie rules, the complete set is 24 round distributions, trivially
precomputable.

**This is a huge effect** — 10 v 10 drops from 56.76 % to 19.02 % (capital) to 5.31 % (capital+wall).
A bot that uses the standard table
in Capitals mode will suicide into capitals every game. Treat the correct table as a **correctness
requirement, not a polish item**, and expose `defendDiceBonus` on the territory so walls and capitals
share one code path.

---

## 5. Balanced Blitz — fully reverse-engineered

### 5.1 What it is

RGD offers **True Random** and **Balanced Blitz** dice. SMG describe Balanced Blitz as created
*"for players who complained about wild outcomes being possible with true random dice"*, and are
candid that it *"isn't designed to completely avoid unusual results, but it does skew more against
them"* — i.e. it is explicitly **less realistic than true random**
([Steam: Blitz Dice Updates](https://steamcommunity.com/app/1128810/discussions/0/664957480854367938/),
[SMG forum: Balanced Blitz discussion](https://smgstudio.freshdesk.com/support/discussions/topics/11000028320)).

Crucially — and this is the part most community reverse-engineering attempts miss — Balanced Blitz
is **not** a dice-roll filter and **not** a streak-breaker. Per SMG's own README it
*"works by adjusting the true probabilities of every possible outcome in a given Risk battle"*,
where an outcome means a **terminal state** such as *"attacker winning with 5 troops remaining"*.
It computes the exact outcome distribution (§4.3), **reshapes that distribution**, then draws a
single sample from it. Hence the constraint in their own docs that
**Balanced Blitz only supports the `OddsBasedBattle` blitz method** — one random float resolves the
entire battle.

### 5.2 The algorithm, exactly

From `Core/Config/BalanceConfig.cs` and `Core/Info/BalancedBattleInfo.cs`, the default configuration
is:

```
winChanceCutoff = 0.05
winChancePower  = 1.3
outcomeCutoff   = 0.10
outcomePower    = 1.8
```

and `ApplyBalance()` runs four stages **in this order**:

**Stage 1 — `ApplyWinChanceCutoff` (0.05).** If either side's overall win chance is `≤ 0.05`, it is
snapped to **0 %** and the other side to **100 %**. SMG's own comment: *"97% win chance with a 5%
cutoff will turn into 100% win chance"*. The losing side's distribution collapses onto its single
"lost everything" entry and the winning side is renormalised to 1. **This is the source of the
community complaint that "5 vs 1 wins 100%"** — it is literal and intended.

**Stage 2 — `ApplyWinChancePower` (1.3).** The overall win chance is pushed *toward the favourite*:

```
w' = w^p / ( w^p + (1 − w)^p )          with p = winChancePower
```

Each side's outcome array is then renormalised to sum to its new total. This is a standard
odds-exponentiation (it raises the *odds ratio* to the power `p`): fixed point at `w = 0.5`,
monotone, and it amplifies more the further from even you are. Verified against SMG's own inline
examples at `p = 1.4`: they document 56.8 %→59.4 %, 43.2 %→40.6 %, 86.1 %→92.8 %; my formula gives
**59.46 %, 40.54 %, 92.78 %**. Exact agreement.

**Stage 3 — `ApplyOutcomeCutoff` (0.10).** The attacker-side and defender-side outcome arrays are
concatenated into **one distribution ordered from most-favourable-to-attacker to
most-favourable-to-defender**, then **10 % of probability mass is shaved off each tail** (walking in
from each end, zeroing entries until the cumulative cut reaches 0.10, then partially trimming the
straddling entry), and the whole thing is renormalised. This is the actual "no extreme streaks"
mechanism — it makes crushing wins and catastrophic losses *literally impossible*, not merely rare.
SMG note it *"may or may not"* change the overall win chance; in practice it does, and it moves it
further toward the favourite.

**Stage 4 — `ApplyOutcomePower` (1.8).** Every individual outcome probability is raised to the power
1.8 and each side is renormalised **to preserve the win chance set by stages 1–3**. This sharpens the
distribution around its mode — results cluster near expectation — while, per SMG's comment, it
*"will NOT change the overall win chance or make any currently existing outcomes impossible or
certain."*

### 5.3 Validation: bit-exact

I reimplemented the exact outcome DP plus all four stages and ran SMG's own README examples.

**README example 3** — chance of losing exactly 12 of 30 troops attacking a **capital** held by 15
(so defender rolls 3 dice):

| | SMG's published value | My reimplementation |
|---|---|---|
| True Random | `0.0222128001707278` | **`0.0222128001707278`** |
| Balanced Blitz | `0.0100282888709122` | **`0.0100282888709122`** |

**Identical to all 16 printed digits, on both modes.**

**README example 6** — fewest attackers for ≥80 % Balanced Blitz win chance against 50 defenders.
SMG print **49**. My pipeline:

| A | True Random | Balanced Blitz (4-stage) |
|---|---|---|
| 47 | 63.80 % | 72.03 % |
| 48 | 67.13 % | 77.10 % |
| **49** | 70.57 % | **82.15 %** ← first ≥80 % |
| 50 | 73.55 % | 86.35 % |

**49 is the answer, matching SMG exactly.** Note this also demonstrates that the win-chance-power
stage alone is *not* sufficient (it gives only 75.7 % at A=49) — the outcome-cutoff stage contributes
the remaining ~6 points. Any reimplementation that models Balanced Blitz as "just raise the odds to
a power" will be visibly wrong.

### 5.4 How Balanced Blitz changes bot strategy (and why bots must use the BB table)

This fell out of a player observation — *"the AI only takes favourable odds, which in Balanced Blitz
**favours the attacker**"* (§1.3) — which turns out to be exactly right, and quantifiable. True-random
vs full 4-stage Balanced Blitz win chance, computed with my validated pipeline:

| A v D | True Random | Balanced Blitz | Δ (pp) |
|---|---|---|---|
| 3 v 3 | 47.03 % | 45.17 % | **−1.86** |
| 4 v 4 | 47.65 % | 46.19 % | **−1.46** |
| 5 v 5 | 50.62 % | 51.01 % | +0.39 |
| 8 v 8 | 54.74 % | 57.68 % | +2.94 |
| 10 v 10 | 56.76 % | 60.94 % | +4.18 |
| 15 v 15 | 60.52 % | 66.93 % | +6.40 |
| 20 v 20 | 63.34 % | 71.33 % | +7.99 |
| 2 v 1 | 75.42 % | 88.90 % | **+13.47** |
| 3 v 2 | 65.60 % | 74.78 % | +9.18 |
| 5 v 4 | 63.83 % | 72.08 % | +8.25 |
| 5 v 3 | 76.94 % | 90.91 % | **+13.97** |
| 10 v 8 | 72.40 % | 84.74 % | **+12.34** |
| **20 v 15** | 86.04 % | **100.00 %** | **+13.96** |

Three consequences, all of which change bot design:

1. **The break-even point does not move.** Because the win-chance-power transform has a fixed point at
   `w = 0.5`, the minimum `A` needed to be a favourite is **identical** under both modes at every `D`
   I tested (D = 2, 3, 5, 8, 10, 15, 20 → A ≥ 3, 4, 5, 8, 10, 14, 18 in *both* modes). So **`A ≥ D+1`
   remains the correct gate regardless of dice mode.** Good: one rule.
2. **But the *payoff* of a favourable attack is massively amplified** — +8 to +14 points for
   moderate-to-strong favourites — while **marginal underdogs get slightly worse** (3v3 and 4v4 both
   lose ~1.5 points). Balanced Blitz therefore **rewards patience and punishes coin-flips**. A bot
   should raise `minWinChance` under BB, not lower it: the extra value is in the attacks it was
   already going to make, not in new marginal ones.
3. **Strong attacks become *certain*.** `20 v 15` is 86.04 % true-random but **exactly 100 %** under
   Balanced Blitz, because stage 1's `winChanceCutoff = 0.05` snaps anything past 95 % to certainty.
   This is a **qualitative** change: above that threshold an attack carries *no risk at all*, so a
   BB-aware bot can chain conquests through territories it would otherwise have to hedge against.
   It is also the mechanism behind the community complaint that *"5 vs 1 wins 100%"* (§5.2).

**Implementation requirements:**

- **Build one odds table per dice mode and give the bot the one matching the active match setting.**
  A bot using the true-random table in a Balanced Blitz game systematically **underestimates its own
  odds by up to 14 points** and plays far too conservatively; the reverse overestimates and suicides.
  This is a correctness issue, not a tuning nicety.
- **Precompute the BB win-chance table the same way as the true-random one** — the balance transform
  is a pure function of the exact outcome distribution, so `W_bb[A][D]` is just as cacheable.
  (Cost note: the *full outcome distribution* DP is O(A·D) per `(A,D)` pair rather than O(1), so
  building a complete BB table is O(A²D²)-ish if done naively. Build it **lazily with memoisation**
  on the pairs the bot actually queries, or precompute a coarse grid and interpolate. This is the one
  place in the design where the cost is non-trivial — see §6.)
- **Expose a `certainWin` predicate** (`W_bb ≥ 1.0 − ε`) and let Expert exploit it explicitly when
  planning conquest chains. It is the single biggest strategic lever Balanced Blitz creates.
- **Also note RGD's bots blitz** — players report they *"can't stop on time to see that it's maybe
  better to stop the attack"*. Our `stopUntil` support (§2.13) plus a real stop rule (§3.2) is a
  deliberate improvement over RGD here.

### 5.5 Implementing it deterministically from a seeded PRNG

The good news: **Balanced Blitz is already deterministic.** Stages 1–4 are pure functions of
`(A, D, roundConfig, balanceConfig)` — no randomness anywhere. Randomness enters at exactly one
point, resolving the battle:

```
function resolveBattle(A, D, cfg, rng):           # rng = seeded, pure
    dist = balancedOutcomeDistribution(A, D, cfg)  # cached, deterministic
    u    = rng.nextFloat()                         # EXACTLY ONE draw per battle
    return inverseCdfSample(dist, u)                # -> (attackerLosses, defenderLosses)
```

Design rules that follow:

1. **One PRNG draw per battle, not per roll.** This is SMG's `OddsBasedBattle` method and it is the
   only one Balanced Blitz supports. It makes replay cheap and robust: a battle consumes one draw
   regardless of how long it "lasts".
2. **Cache keyed on the full config.** `(A, D, attackDice, defendDice, favourDefenderOnDraw,
   stopUntil, balanceConfig)`. SMG use three caches (`RoundCache`, `BattleCache`, `WinChanceCache`)
   for the same reason. Caches must be **pure memoisation** — never part of game state, never
   serialised into a save, or a cache-warm difference becomes a replay divergence.
3. **Fix the CDF walk direction and the tie rule.** Inverse-CDF sampling is only reproducible if the
   array order and the comparison (`u < cum` vs `u <= cum`) are pinned. Write a test that walks all
   `u` in `{0, ε, 0.5, 1−ε}` and asserts the chosen outcome.
4. **Beware float non-determinism across platforms.** The distribution is built from `Math.pow` and
   repeated multiplication. IEEE-754 `+`, `−`, `×`, `÷` are exactly specified, but **`Math.pow` is
   not bit-identical across JS engines**. Since `pow` appears in stages 2 and 4, a replay generated
   in V8 could in principle diverge from one in JavaScriptCore at a CDF boundary. Mitigations, in
   order of preference:
   - **(a) Quantise the CDF.** Round each cumulative value to a fixed grid (e.g. `round(x * 2^32)`)
     before comparing against `u`. This makes the sampling decision robust to last-bit differences.
     **Recommended.**
   - **(b) Ship our own `pow`** for the two exponents we actually use. With only `p = 1.3` and
     `p = 1.8`, `x^p = exp(p · ln x)` with our own polynomial `ln`/`exp` is bit-reproducible.
   - **(c) Precompute and ship the tables** as fixed binary assets for the common `(A, D)` range.
     Also removes the 2 ms init.
5. **Keep a `diceMode` field in the match seed/config** so a replay knows which mode to reconstruct.
   True Random and Balanced Blitz consume the same number of draws under `OddsBasedBattle`, which
   means **mode is replay-compatible in draw count** — but the *outcomes* differ, so it must be
   recorded, not inferred.
6. **Large battles:** SMG admit they fall back to **polynomial regression over smaller battles of
   similar ratio** for large troop counts (because brute force is too expensive), and that *"the
   estimation source code is not provided"* and *"can result in discrepancies between the game and
   this code."* We do not need their fallback — our DP is O(A·D) and fast (§6) — so **we should use
   the exact DP at all sizes and will be *more* accurate than RGD.** Worth noting as a deliberate
   divergence rather than a bug.

> **Licensing.** The risk-dice repo is **not open source**: it grants only a *"non-exclusive, limited
> right to use and install one (1) copy ... for internal evaluation purposes only"* and forbids
> reproduction or redistribution. Everything in §5 is a **behavioural specification derived by
> reading and independently reimplementing** published algorithm descriptions and numeric examples —
> we must write our own implementation from this spec and **must not copy their code or vendor the
> repo.** The four constants and the staged algorithm are facts about the game's behaviour; the C#
> source text is theirs.

---

## 6. Performance / efficiency budget

Measured on this machine with Node (`process.hrtime.bigint`), single-threaded:

| Operation | Cost |
|---|---|
| Build 101×101 **true-random** win-chance DP table (incl. all 6 round distributions) | **2.07 ms**, 80 KiB |
| Build 201×201 true-random win-chance DP table | **1.80 ms**, 316 KiB |
| Build 32×32 **Balanced Blitz** win-chance table | **4.4 ms** (4.3 µs/cell) |
| Build 64×64 Balanced Blitz win-chance table | **37.2 ms** (9.1 µs/cell) |
| Build 100×100 Balanced Blitz win-chance table | **199.8 ms** (20.0 µs/cell) |
| 5,000,000 table lookups | **5.75 ms** (≈ **1.15 ns** each) |
| Greedy scan of 400 candidate attacks with ~8-flop scoring | **0.0013 ms** |
| 20 such passes (draft + attack chain + fortify) | **≈ 0.027 ms** |

**Conclusion: the 100 ms budget is ~3,700× larger than a full greedy bot turn needs.** The stated
constraint is not a real constraint for tiers Easy–Hard.

> ⚠️ **The one real cost in the whole design is the Balanced Blitz table.** True-random win chances
> come from a single shared O(A·D) DP, so the whole table costs 2 ms. Balanced Blitz needs the **full
> outcome distribution per `(A, D)` pair** (§5.2), which is itself O(A·D) — so a complete table is
> ~O(A²D²) and measures **200 ms at 100×100**, i.e. **over budget if built synchronously at init**.
> It is still only a *one-time* cost, never per-decision. Three mitigations, in order of preference:
> **(a) ship it as a precomputed binary asset** — 100×100 `Float32Array` is 40 KiB, which also removes
> the `Math.pow` portability risk (§5.5 rule 4); **(b) build it lazily with memoisation** — a real
> game queries far fewer than 10,000 distinct `(A, D)` pairs, and small battles dominate (32×32 is
> only 4.4 ms); **(c) build it once during a loading screen** with a yield between rows. Do **not**
> compute it per turn.
>
> *(This JS implementation independently reproduced my Python pipeline — 10 v 10 → 0.6094, 20 v 15 →
> 1.0000 — so the §5.3 validation holds across two languages.)* Complexity analysis for a map with `T`
territories (42–100), `E` adjacencies (`E ≈ 2T`), `P` players:

| Phase | Complexity | At T=100 | Fits? |
|---|---|---|---|
| Table init (once per session) | O(A·D) | 2 ms, amortised to ~0 | yes |
| Per-player strength / hostility | O(T + P) | ~100 ops | yes |
| BSR for all owned territories | O(E) | ~200 ops | yes |
| Continent scoring | O(T + continents) | ~120 ops | yes |
| Draft placement, `n` troops | O(n log T) with a heap, or O(n·T) naive | ≤ 10⁴ ops | yes |
| Attack candidate scoring (ply 0) | O(E) per pass, ≤ T passes | ≤ 2·10⁴ ops | yes |
| Fortify | O(E) | ~200 ops | yes |
| **Total, ply-0 greedy turn** | **O(T·E)** | **~0.03 ms** | **yes, with 3000× headroom** |
| Ply-1 (evaluate each opponent's best reply) | O(P·E) extra per candidate | ~10⁵–10⁶ ops | yes, ~1–5 ms |
| Ply-2 | O((P·E)²) | ~10⁷–10⁸ ops | **borderline — 20–200 ms** |
| MCTS / rollouts | thousands of full-turn sims | ≫ 100 ms | **no** |

**What fits, by tier:**
- **Easy / Medium / Hard: ply-0 greedy with exact odds.** Microseconds. Ship it.
- **Expert: ply-1 lookahead** — for the top ~8 candidate moves only, evaluate the opponents' best
  single reply and subtract it. Comfortably inside 10 ms. **This is the right Expert design.**
- **Expert ply-2 is the first thing that threatens the budget.** If we want it, restrict it to the
  top 3 candidates and cap opponent replies to the 3 strongest — that is ~10⁵ ops, a few ms. Full
  ply-2 is not worth it.
- **MCTS and any rollout-based method are out**, and the literature agrees they are not needed to
  beat human casual play (§2).

Practical notes: use flat `Int16Array` / `Float32Array` for board state (no object churn, no GC
pauses mid-turn); avoid allocating inside the candidate loop; the whole bot should be allocation-free
after warm-up. If we ever do want heavier Expert search, run it in a Web Worker and *still* keep the
result deterministic by seeding the worker's PRNG from the match seed — but note that a worker makes
the decision asynchronous, which conflicts with a pure synchronous engine step (§7).

---

## 7. Determinism

**Requirement:** the whole engine, bots included, must be a pure function of
`(state, action, seed)`. No `Math.random`, no `Date.now`, no iteration over unordered collections,
no floating-point dependence on platform math. This is what makes pass-and-play, online replay and
server-side verification all work from the same code.

### 7.1 PRNG

Use a small, explicit, serialisable PRNG. SMG ship six (PCG, Mersenne Twister, XorShift+, system,
crypto, Unity) and default to **PCG**. Recommendation: **PCG32 or xoshiro128\*\***, chosen because:
- tiny state (2×32 or 4×32 bits) that **serialises into the save/replay** as plain integers;
- no platform math — integer ops only, so bit-identical everywhere (use `Math.imul` and `>>> 0`);
- fast enough to be irrelevant.

Expose it as an explicit object threaded through the engine, never a module-level singleton:

```ts
interface Rng { nextU32(): number; nextFloat(): number; state: readonly [number, number]; }
```

**Stream separation.** Derive independent sub-streams by hashing the seed with a purpose tag, so that
adding a new random consumer doesn't shift every other draw and invalidate old replays:

```
rngFor(purpose, turn) = pcg32(hash(matchSeed, purpose, turn))
purposes: "deal", "turnOrder", "battle", "bot:<playerId>", "cardDeck"
```

This is the single most important determinism decision in the whole design. Without it, any bot
tweak that adds or removes one PRNG draw **breaks every stored replay**.

### 7.2 Which heuristics need randomness, and how to seed them

| Heuristic | Needs randomness? | How to seed |
|---|---|---|
| Win-chance tables (§4) | **No** — pure DP | — |
| Balanced Blitz distribution (§5) | **No** — pure, then **one** draw to sample | `rngFor("battle", turn)`, one `nextFloat()` per battle |
| BSR, continent scoring, hostility, fortify | **No** — pure arithmetic | — |
| `blunderRate` (pick the k-th best move) | **Yes** | `rngFor("bot:"+id, turn)`; one draw per decision point |
| Tie-breaking between equal-scoring moves | **Yes, if we want variety** | same stream. **Alternative: break ties by a deterministic key** (lowest territory id) — cheaper and replay-stable, but makes bots look robotic. Recommend seeded random tie-breaks. |
| Persona assignment at match start | **Yes** | `rngFor("personaAssign", 0)`, drawn **once** at match creation and then **stored in match state**. Do not re-derive it per turn. |
| Persona attribute jitter (so two Aggressive bots differ) | **Yes** | draw once at match start from `rngFor("personaJitter", 0)`, store the resulting weights in the bot's state |
| Grudge decay, aggression ramp | **No** — deterministic functions of turn number | — |
| Initial territory draft (if randomised) | **Yes** | `rngFor("deal", 0)` |

**Rules to enforce in code review:**

1. **A bot's decision must consume a fixed, predictable number of draws** — or, better, **zero draws
   in the common path**. Design: compute all scores deterministically, then make *at most one* draw
   for blunder/tie-break. Never `while (rng.nextFloat() < x)`.
2. **Never iterate a `Map`/`Set`/`Object` whose insertion order can vary.** Sort by a stable id
   before any scan that feeds a decision. This is the most common source of "works on my machine"
   replay divergence.
3. **Ban `Array.prototype.sort` without a total comparator.** `sort` is not stable across all engines
   for non-total orders and ties will reorder. Always compare score **then id**.
4. **No wall-clock, no animation state, no UI state** inside the engine. Bot "thinking time" is a
   presentation-layer delay, applied *after* the decision is computed.
5. **Quantise before comparing** anywhere a float decides a branch (see §5.5 rule 4) — notably the
   Balanced Blitz CDF walk and any `score > best` comparison that could be affected by `Math.pow`.
   For scores, prefer integer or fixed-point arithmetic in the scoring function so `>` is exact.
6. **Golden replay tests.** Store `(seed, map, settings, persona assignment)` plus a hash of the
   state after every turn for a few hundred full bot-vs-bot games. Any heuristic change that alters
   a hash must be an explicit, versioned change. Version the ruleset so old replays keep playing
   back against the old bot code.
7. **Persona and jitter live in match state, not in the bot.** They are drawn once and persisted, so
   a replay loaded on another device reconstructs identical opponents without re-deriving anything.

---

## 8. Recommended implementation shape

A single bot module, pure and synchronous, with no knowledge of the UI:

```ts
// Pure: same inputs -> same outputs, always.
function decideTurn(
  view: BoardView,        // immutable, fog already applied per persona.fogHonest
  me: PlayerId,
  persona: BotPersona,    // drawn once at match start, stored in match state
  odds: OddsTables,       // the four precomputed Float32Array tables (§4.5)
  rng: Rng,               // seeded sub-stream rngFor("bot:"+me, turn)
): TurnPlan              // { cardTrade, placements[], attacks[], fortify }
```

`TurnPlan` is **data, not side effects** — the engine then applies it action by action, which means:
- the UI can animate the plan at any speed without affecting the outcome;
- the plan is serialisable, so it goes straight into the replay log;
- attacks are *declared*, and each one's resolution consumes exactly one PRNG draw (§5.5), so a
  replay can be verified without re-running the bot at all.

One subtlety worth designing for up front: an attack chain is **adaptive** — whether you make the
second attack depends on how the first went. Two options:

1. **Re-enter `decideTurn` after each battle** (pass the updated view). Clean, and the per-call cost
   is microseconds (§6), so this is affordable. **Recommended.**
2. Emit a conditional plan. More complex, no real benefit here.

Shared ordering helper used everywhere a decision is made, to guarantee replay stability (§7.2):

```ts
const byScoreThenId = (a, b) => (b.score - a.score) || (a.id - b.id);
```

**Architecture for Hard/Expert: tasks propose, a scheduler decides.** Adopt Warzone's decomposition
(§2.14) — a set of `Task` objects each proposing candidate moves with a value, then a scheduler that
prunes conflicts and commits. It buys turn coherence without search (Wolf's unsolved problem, §2.1),
makes a persona expressible as **which tasks are enabled and at what priority**, and the `NoPlan*`
fallback tasks guarantee a bot always does something sensible when no plan applies. Easy and Medium
can stay on a flat greedy scorer.

**Guiding objective.** Warzone's own statement of intent is the right one for us: their production AI
prioritises being **"fun to play against" over pure competitive strength** (§2.14). Our Expert tier
should be *strong*; Easy–Hard should be *characterful*. Quo's 47 % against five strong siblings is a
realistic ceiling for a good heuristic bot — we do not need to beat it.

**Build order suggestion:** odds tables and their tests first (they are the foundation and they are
independently verifiable against the numbers in §4 and §5.3), then a ply-0 greedy bot with one
persona, then the persona table, then tiering, then Expert's ply-1 lookahead.

---

## Sources

| Source | URL | What it supported |
|---|---|---|
| SMG Studio, **"Our RISK AI"** (support article) | https://smgstudio.freshdesk.com/support/solutions/articles/11000077687-our-risk-ai | **First-party.** AI V2.0 (Feb 2019); persona architecture; the six named personas and their descriptions; "~40 attributes" per persona; difficulty = persona pool; no dice advantage; Fog of War vision advantage; equal-opponent targeting with the Beginner/Easy anti-AI bias; rejection of ML in favour of heuristics. §1.1, §1.3 |
| SMG Studio, **risk-dice** source repository | https://github.com/smgstudio/risk-dice | **First-party.** README: brute-force outcome calculation, Balanced Blitz, dice augments, blitz-limit, six RNGs, "one troop left behind" convention, the three blitz methods, the polynomial-regression fallback and its accuracy caveat, the non-commercial licence, and the four worked numeric examples used as validation targets. §4.1, §4.3, §5, §7.1 |
| risk-dice `Core/Config/BalanceConfig.cs` | https://github.com/smgstudio/risk-dice/blob/master/Core/Config/BalanceConfig.cs | The four Balanced Blitz constants and their defaults `(0.05, 1.3, 0.1, 1.8)`. §5.2 |
| risk-dice `Core/Info/BalancedBattleInfo.cs` | https://github.com/smgstudio/risk-dice/blob/master/Core/Info/BalancedBattleInfo.cs | The exact four-stage `ApplyBalance` pipeline, its ordering, the inline worked examples at power 1.4, and the "may or may not change win chance" / "will NOT change win chance" guarantees. §5.2, §5.3 |
| risk-dice `Core/Info/BattleInfo.cs` | https://github.com/smgstudio/risk-dice/blob/master/Core/Info/BattleInfo.cs | The memoised full-battle recursion and the `attackLossChances` / `defendLossChances` array semantics (incl. the sentinel last entries). §4.3 |
| risk-dice `Core/Info/RoundInfo.cs` | https://github.com/smgstudio/risk-dice/blob/master/Core/Info/RoundInfo.cs | Single-round enumeration, `favourDefenderOnDraw`, `challengeCount = min(attackDice, defendDice)`. §4.1 |
| risk-dice `Core/Config/RoundConfig.cs` + `Core/DiceAugment.cs` | https://github.com/smgstudio/risk-dice/blob/master/Core/Config/RoundConfig.cs | Default `RoundConfig(6, 3, 2, true)`; augment semantics — **Capital: defender +1 die**, **BehindWall: defender +1 die**, **Zombie attacker: −1 die**, **Zombie defender: ties go to attacker**. §3.2, §4.5 |
| Steam: **Blitz Dice Updates** (SMG announcement thread) | https://steamcommunity.com/app/1128810/discussions/0/664957480854367938/ | SMG's framing of Balanced Blitz as a response to complaints about wild true-random outcomes, and that it skews against them rather than eliminating them. §5.1 |
| SMG forum: **"Balanced Blitz is horrendous"** | https://smgstudio.freshdesk.com/support/discussions/topics/11000028320 | Community perception of Balanced Blitz as too predictable, incl. the "5 v 1 wins 100%" complaint that §5.2 stage 1 explains. §5.1, §5.2 |
| Steam: **AI Problems** | https://steamcommunity.com/app/1128810/discussions/0/2243300286284412490/ | Player reports of bot inconsistency and the persona-clash explanation. §1.3 |
| Steam: **Bot AI changes** | https://steamcommunity.com/app/1128810/discussions/0/600768722043449897/ | The V2.0 AI changeover and player reaction. §1.1, §1.3 |
| Steam: **Bots are absolutely horrible** | https://steamcommunity.com/app/1128810/discussions/0/3192488348527650080/ | Player complaints about bot attack/stacking behaviour. §1.3 |
| Steam: **Does bot difficulty skew the random chance?** | https://steamcommunity.com/app/1128810/discussions/0/3081016749018365058/ | Difficulty-name evidence and the dice-fairness question. §1.2, §1.3 |
| Steam: **AI should stop others getting bonuses / work together** | https://steamcommunity.com/app/1128810/discussions/0/604142224713712839 | Player feature request for coalition-against-the-leader behaviour — evidence that it is *not* currently coded. §1.1 |
| SMG Studio, **"How do I change the RISK computer players' difficulty?"** (mod. 2 Nov 2022) | https://smgstudio.freshdesk.com/support/solutions/articles/11000024863-how-do-i-change-the-risk-computer-players-difficulty- | **First-party.** The full one-sentence body: *"Choose from Beginner to Expert."* §1.2 |
| SMG Studio, **the screenshot attached to that article** | https://s3.amazonaws.com/cdn.freshdesk.com/data/helpdesk/attachments/production/11092627820/original/lDVzZ3-DGoqdffZPjwV3CwMne_ckT_adFA.png?1666677511 | **First-party image.** Shows the UI label **"AI Difficulty"** set to **"Medium"**, alongside Manual Placement / Card Bonus / Turn Timer / Dice Rolls ("Balanced Blitz"). The only official attestation of "Medium". §1.2 |
| SMG Studio, **"How are the dice rolling odds calculated for RISK computer players?"** (mod. 19 Aug 2019) | https://smgstudio.freshdesk.com/support/solutions/articles/11000024866-how-are-the-dice-rolling-odds-calculated-for-risk-computer-players- | **First-party.** No dice advantage at any difficulty or rank; **Mersenne Twister for cards, player order and dice**; ±5 % tolerance vs a control matrix; and the **mode dice modifiers that STACK** (zombie ties-to-attacker, zombie −1 attack die, capital +1 defend die, wall +1 defend die). §1.1, §4.6, §7.1 |
| **Steam achievements** for app 1128810 | https://steamcommunity.com/stats/1128810/achievements | **First-party.** *"Defeat 5 **expert** AIs…"* — the official attestation of the "Expert" tier name. §1.2 |
| RGD fandom wiki, **Steam Version Details** (archive of removed store copy) | https://risk-global-domination.fandom.com/wiki/Steam_Version_Details | Verbatim archive of the official store bullet *"5 difficulty AI settings for rookies and veterans"* — **since removed from the live store page**, so the count of 5 is officially attested but stale. §1.2 |
| RGD fandom wiki, **Our RISK AI** (mirror, wikitext ts. 27 Sep 2019) | https://risk-global-domination.fandom.com/wiki/Our_RISK_AI | Dates the persona claim to **2019**, crediting the freshdesk original. §1.2 |
| Steam news, **v3.20 release notes** (8 Sep 2025) | https://store.steampowered.com/news/app/1128810/view/1809869180155683 | **First-party.** The **"Inactivity Behaviour"** setting (Automated vs Neutral) — a bot-out control distinct from AI Difficulty. §1.2 |
| Steam news, **v3.19 release notes** (21 Jul 2025) | https://store.steampowered.com/news/app/1128810/view/1805431065452143 | *"Playing Secret Assassin shouldn't change your remembered bot difficulty"* — evidence difficulty is persisted per-mode. §1.2 |
| Steam news, **v2.5** (23 Apr 2020) | https://store.steampowered.com/news/app/1128810/view/3112493747265982072 | *"Improved AI after taking over for a player"* — **the only AI-logic patch note in the game's entire Steam news history** (294 items swept). §1.2 |
| Steam, **Lee \| SMG [developer] on Capitals AI** (4 Mar 2026) | https://steamcommunity.com/app/1128810/discussions/0/732532498321513703/ | **First-party dev.** *"We are planning to spend time on the AI logic later this year. In the short term, there are some tests we can explore related to Capitals to affect their defensiveness."* §1.3 |
| Steam, **Lee \| SMG [developer] on the AI revisit** (6 Aug 2026) | https://steamcommunity.com/app/1128810/discussions/0/570418160339170096/ | **First-party dev.** *"AI improvements are on the cards for next year, ideally Q1-2."* — confirms the rework has **not** shipped. §1.2 |
| Steam, **Lee \| SMG on per-AI difficulty** (19 Dec 2025) | https://steamcommunity.com/app/1128810/discussions/0/688618329542370515/ | **First-party dev.** Per-opponent difficulty *"is something we're adding in Q1 next year"* — worth designing for. §1.2 |
| Steam, **SMG Studio (Studio Head) on AI difficulty of Risk** (15 Mar 2020) | https://steamcommunity.com/app/1128810/discussions/0/1744521326160009019/ | **First-party.** *"we havent coded Deep Blue… Compared to Chess, RISK is much harder to code AI for."* Also the player feature request for power assessment / coalitions. §1.1, §1.3 |
| Steam, **"AI should know…" (CaptainCanadaEhh) + Lee \| SMG reply** | https://steamcommunity.com/app/1128810/discussions/0/573770913622907062/ | Competitive player claim that *"expert bots start to pick on the weakest player and don't break bonus territories like they should"*, with the dev reply *"An AI revisit is overdue."* Also alliance fog-vision mechanics. §1.3 |
| Steam, **persona taxonomy thread** (Kenpoleon Bonaparte, FlappyJak) | https://steamcommunity.com/app/1128810/discussions/0/591769151491562584/ | The clearest player accounts of bot mechanics: *"attack the first one that meets a 'likely win' condition"*; draft placement proportional to bordering enemy troops; the stack-vs-split exploit; fortify randomness; the five observed personas; *"They supposedly have personas on hard and above."* §1.3 |
| Steam, **bot targeting / botpath thread** (Vlarimov) | https://steamcommunity.com/app/1128810/discussions/0/833871463312420311/ | *"path of least resistance"*; tie-break by internal territory id; *"Suicidal does not make a smarter AI"*. §1.3 |
| Steam, **"bots use Blitz"** (Dwarfblood) | https://steamcommunity.com/app/1128810/discussions/0/591770858068912839/ | *"limiting the AI bots to just go all in because they can't stop on time"*. §1.3, §5.4 |
| Steam, **"Ai cheats, dice loaded"** (FlappyJak) | https://steamcommunity.com/app/1128810/discussions/0/688615792191915528/ | **The key insight for §5.4:** *"the AI only takes favourable odds, which in Balanced Blitz FAVOURS THE ATTACKER."* §1.3, §5.4 |
| Steam, **70 % domination / unusual modes** (Vlarimov + SMG's Nick) | https://steamcommunity.com/app/1128810/discussions/0/601917691382528228/ | *"AI is quite handicapped at unusual game modes"*, with the dev reply *"we actually want to revisit our AI to improve them."* §1.3 |
| Steam, **alliance bot-out bug report** (MarshalRay, 29 Sep 2020) | https://steamcommunity.com/app/1128810/discussions/0/2838914020281199410/ | Unanswered report that a bot replacing an ally *"will not attack you, even if you attack them"* — the only alliance-related bot datum found. §1.3 |
| SMG Studio, **Sandbox documentation** | https://smgstudio.freshdesk.com/support/solutions/articles/11000135637-everything-you-need-to-know-about-sandbox | **First-party.** The four card modes — Fixed / Progressive / Exponential / Per-Player — and Fixed = 4/6/8/10. §3.1 |
| SteamAH, **RISK: Global Domination Beginners' Guide** | https://steamah.com/risk-global-domination-beginners-guide/ | Secondary; the only (weak) evidence for bots favouring Australia: *"AIs had already started aiming for Australia."* §1.2, §1.3 |
| **Jason A. Osborne**, *Markov Chains for the RISK Board Game Revisited*, Mathematics Magazine 76(2) 2003, 129–135 | https://www4.stat.ncsu.edu/~jaosborn/research/osborne.mathmag.pdf | The exact 14 single-roll probabilities incl. `π₃₂₂ = 2890/7776`; the absorbing-chain formulation `F = (I−Q)⁻¹R`; the conquer-odds table; `A = D ≥ 5` favours the attacker; expected losses for A=D=5; the table-orientation warning. §2.2, §4.1, §4.3 |
| **Baris Tan**, *Markov Chains and the RISK Board Game*, Mathematics Magazine 70(5) 1997, 349–357 | https://faculty.ozyegin.edu.tr/baristan/files/2024/05/MMrisk97.pdf | The original chain formulation; the verbatim independence assumption that is the error; Tan's wrong 2v2/3v2 values; the "attack with twice as many" rule we must avoid; the unsolved mid-battle-withdrawal problem. §2.3, §2.13 |
| **Franz Hahn**, *Evaluating Heuristics in the Game Risk*, Maastricht Univ. BSc paper, 2010 | https://project.dke.maastrichtuniversity.nl/games/files/bsc/Hahn_Bsc-paper.pdf | **The exact published BSR / BST / NBSR definitions and worked example**; 18-configuration 1,000-game study; "High Chance Attack" being the strongest single lever; reinforcement heuristics showing no benefit; first-player advantage 66.59 % CI [58.42, 74.77]; full game under 50 ms; correctly oriented reprint of Osborne's table. §2.5, §3.1, §3.2 |
| **Gibson, Desai & Zhao**, *An Automated Technique for Drafting Territories in the Board Game Risk*, AIIDE-10 | https://pages.cpsc.ucalgary.ca/~richard.zhao1/publications/2010aiide-UCT.pdf | The learned draft weights (+13.38 / +5.35 / −0.07 / +0.96); the four draft features; UCT-to-end-of-draft-then-score method; continent-curve shape; beating all four hard Lux bots; Random-Quo collapse proving the draft decides the game; <1 s per pick on 2006 hardware. §2.6, §3.1 |
| **Lozano & Bratz**, *A Risky Proposal: Designing a Risk Game Playing Agent*, Stanford CS229, 2012 | https://cs229.stanford.edu/proj2012/LozanoBratz-ARiskyProposalDesigningARiskGamePlayingAgent.pdf | The income-differential evaluation function; goal-parallel partial trees; the "stop when no strategy has positive expected value" rule; 73 % vs the best Lux bot's 38 % (unrefereed, no CI). §2.7, §3.1, §3.2 |
| **Jamie Carr**, *Using Graph Convolutional Networks and TD(λ) to play the game of Risk*, arXiv:2009.06355, 2020 | https://arxiv.org/abs/2009.06355 | Agent "D.A.D"; the end-of-turn-state enumeration via a precomputed attack-outcome table; 35 % against 5 strong Lux bots. §2.8, §3.2 |
| **Gnecco Heredia & Cazenave**, *Expert Iteration for Risk*, ACG 2021 (LNCS 13262) | https://www.lamsade.dauphine.fr/~cazenave/papers/RiskConferencePaper.pdf | GCN-per-node/edge policy architecture; PUCT + Expert Iteration at 4,000 sims; the ≤0.9 value cap; the negative result (policy-only worse than random post-draft, init-only beating the full agent); their endorsement of Carr's deterministic-attack-table trick. §2.9 |
| **Erik Blomqvist**, *Playing the Game of Risk with an AlphaZero Agent*, KTH MSc thesis, 2020 | https://forums.triplea-game.org/assets/uploads/files/1637032761173-fulltext01.pdf | Place-all / place-half action compression; "reinforce only enemy-adjacent territories"; the {act, skip} hierarchical node; the partial/negative Expert-Iteration result. **Also the only accessible account of Wolf's 2005 thesis** (§2.2.1 of this document). §2.1, §2.10 |
| **Ken Knudsen**, *Impact of Collusion and Coalitions in RISK*, Univ. of Maryland | https://www.cs.umd.edu/sites/default/files/scholarly_papers/Knudsen_1.pdf | The power heuristic `H = armies + 0.3·territories + bonuses`; the `AD_ij` collusion detector with calibrated 0.25 / 0.75 thresholds; 75 games / 14 with oracles; fog level having no measurable effect on pace. §2.11, §3.4 |
| **Michael Wolf**, *An Intelligent Artificial Player for the Game of Risk*, TU Darmstadt, 2005 | https://www.semanticscholar.org/paper/An-Intelligent-Artificial-Player-for-the-Game-of-Wolf/abca9c507f1120116d8ea6d98fcd8d01b2e26c7f | State space ≈10⁴⁷ / infinite in principle; per-turn branching 10³³–10⁸⁵ reducible to ≈10⁶; linear eval over handcrafted features; plan-as-score-bias; ~60× from plans and ~20 % more from TD. **⚠️ Original PDF not located — reported via Blomqvist §2.2.1.** §2.1 |
| **Sharon Blatt**, *RISKy Business*, Rose-Hulman Undergrad. Math. J. 3(2), 2002 | https://scholar.rose-hulman.edu/rhumj/vol3/iss2/3/ | Extends the corrected conquer-odds / expected-loss analysis via Markov chains. **⚠️ PDF 403s; abstract only — do not quote interior figures.** §2.4 |
| **Hendel, Hoffman, Manack & Wagaman**, combinatorial extension | https://web.williams.edu/Mathematics/sjmiller/public_html/cm/HendelHoffManackWagaman021014.pdf · arXiv:1512.04333 | The "86 % + 2" mnemonic `Â* = (7161/8391)(D̂−1)+3`, and the caveat that it is stated for *virtual* conquer odds and is conservative. §2.13 |
| **Evolutionary Tabletop Game Design: A Case Study in the Risk Game**, SBGames/ACM 2023 | https://arxiv.org/abs/2310.20008 · https://dl.acm.org/doi/10.1145/3631085.3631236 | GA over Risk's design parameters; smaller maps → shorter matches; the "objective met but game trivial" limitation. Relevant only to custom-map validation. §2.12 |
| **Zuckerman, Felner & Kraus**, *Mixing Search Strategies for Multi-player Games*, IJCAI 2009 | (noted via Gibson et al.) | MP-Mix switching between maxⁿ / Paranoid / Offensive; the move-as-conquest-sequence abstraction. §2.11, §3.2 |
| **Sillysoft, Lux Delux AI SDK** | https://sillysoft.net/sdk/ | That the SDK ships API docs plus source to every bundled AI. §2.14 |
| **Sillysoft, `LuxAgent` interface source** | https://github.com/ladnir/Risk_AI_1/blob/master/Risk_AI_1/src/com/sillysoft/lux/agent/LuxAgent.java | **Verified** full list of bot decision hooks and when each is called — incl. `cardsPhase` running before `placeArmies`, and `moveArmiesIn` being a separate decision. §2.14 |
| **Sillysoft, `BoardHelper` source** (1,849 lines) | https://github.com/ladnir/Risk_AI_1/blob/master/Risk_AI_1/src/com/sillysoft/lux/util/BoardHelper.java | **Verified** full list of 32 utility query methods — the de-facto heuristic vocabulary for Risk bots (`getDefensibleBorders`, `cheapestRouteFromOwnerToCont`, `getPlayersBiggestArmyWithEnemyNeighbor`, `getSmallestPositiveEmptyCont`, …). §2.14 |
| **Sillysoft, Lux AgentProfiles** | https://sillysoft.net/wiki/?AgentProfiles | Quoted published strategy for every shipped Lux bot (Stinky, Angry, Communist, Cluster, Pixie, EvilPixie, Yakool, Boscoe, Bort, Shaft, Quo, Killbot, Nefarious, Reaper, Chimera, Defender); Killbot's explicit 20-army border reserve; Quo's 47 % over 500 games; Chimera's persona sampling; the subclass lattice. §2.14, §3.5 |
| **Sillysoft, WritingYourOwnAI / Lux docs** | https://sillysoft.net/wiki/?WritingYourOwnAI= | Phase ordering and `board.placeArmies(n, countryCode)` usage. §2.14 |
| **Warzone, AI wiki page** | https://www.warzone.com/wiki/AI | *"evaluates a set of possible actions… assigns a value"* + *"weighted random process"*; documented heuristics (neutral bonuses first, nearby bonuses before opponents, team cooperation, card policy when teamed with humans). §2.14 |
| **Warzone, "The WarLight AI goes open source!"** (Feb 2016) | https://www.warzone.com/blog/index.php/2016/02/the-warlight-ai-goes-open-source/ | That `Prod` (production) and `Wunderwaffe` (Norman's competition bot) are both released; GreenTea/Norman/cowzow donations; **and the key design statement that the production AI prioritises being "fun to play against" over maximum win rate.** §2.14, §3.5 |
| **Warzone AI source** | https://github.com/FizzerWL/WarLight.AI · mirror https://github.com/JustinReiter/WarLight.AI | **Verified** file-level architecture of `Prod`, `Wunderwaffe`, `JBot`, `Cowzow`: the task catalogue (`ExpansionTask`, `BreakTerritoryTask`, `DefendBonusTask`, `PreventBonusTask`, `NoPlan*`, …), the evaluation layer (`BonusValueCalculator`, `TerritoryValueCalculator`, `GameStateEvaluator`, `PicksEvaluator`, `OpponentDeploymentGuesser`, `Stateful`/`StatelessFogRemover`), and `Prod`'s `PickByWeight` / `PickCluster` / `MoveLandlockedUp` / `MultiAttackPathToBonus`. §2.14, §3.3 |
| **Garrett Robinson**, *The Strategy of Risk*, MIT sp.268 | https://web.mit.edu/sp.268/www/risk.pdf | Continent bonuses; "take small continents first" (Australia 1 entry point, South America 2); "attack conservatively". **⚠️ Contains no bonus-to-border-ratio table despite secondary claims.** §3.1 |
| Own computation — `dice.py` (exhaustive enumeration) | n/a (scratch) | All six single-roll probability rows, exact fractions, expected casualties. Validated against SMG's printed `0.292566872427984` **and against Osborne's Table 2**. §4.1, §4.2 |
| Own computation — `battle.py` / `bbfull.py` (DP + 4-stage balance) | n/a (scratch) | Full-battle win-chance table, break-even ratios, and bit-exact reproduction of SMG README examples 2, 3 and 6. §4.3, §4.4, §5.3 |
| Own benchmark — `bench.mjs` (Node) | n/a (scratch) | All §6 timings. |
