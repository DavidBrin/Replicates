# 04 — The Genealogy: Slay & Antiyoy Engine, Map Gen, AI, Hex Math

> **Correction (coordinator, 2026-09-21):** this lane worked from text sources and assumed a HEX grid from the Slay/Antiyoy genealogy. Direct inspection of the official screenshots and walkthrough frames shows Island Empire uses a **square grid with 4-neighbour adjacency**. Read every "hex" below as "tile"; the consolidated, screenshot-verified facts are in `06-research-brief.md`, which overrides this file wherever they differ.


Lens: exact rules of **Slay** (Sean O'Connor, 1995) and **Antiyoy** (yiotro, open-source Android descendant), read at the source-code level, plus hex-grid math and AI design notes, for reimplementing Island Empire's engine in TypeScript.

## 0. Summary

- **Slay's rules are fully documented** on the author's own site (verbatim rules quoted below). Core loop: hex "territories" (provinces) of ≥2 connected same-owner hexes have one capital that banks the province's gold; income = 1/hex/turn (trees pay nothing); four unit tiers (peasant/spearman/knight/baron, strength 1–4, upkeep 2/6/18/54) are built by spending money on a peasant (cost 10) and merged by stacking (sum of strengths, capped effectively at 4 = baron); castles cost 15, no upkeep, defend at strength 2; capitals defend at strength 1; a unit/building/capital defends its own hex **and all 6 neighbours in the same province** at its strength (max wins); bankruptcy (negative money) kills every unit in the province, turning each into a grave, which sprouts a tree the following turn; a province that drops under 2 hexes loses its capital (no capital = no banking).
- **Antiyoy is the same game with the numbers exposed as constants** and, crucially, **two full alternate rulesets living side by side in one codebase**: `RulesetSlay` (a faithful clone of the above) and `RulesetGeneric` (Antiyoy's own evolved ruleset — farms, towers with tax, tree-cut rewards, weaker strength-4 upkeep). Both share one `GameController`/`FieldManager`/`Province`/`Hex` engine, so the same engine cleanly supports "classic Slay mode" and "modern Antiyoy mode" as a strategy-pattern switch (`GameRules.slayRules`). This is a strong architecture reference for Island Empire: keep the mechanics generic, inject the numbers/behaviors via a `Ruleset` interface.
- Antiyoy's **province split/merge algorithm** (`FieldManager.splitProvince` / `checkToUniteProvinces`) is a concrete, byte-exact answer to "how does a split province pick a new capital and split the treasury": it is **not** a 50/50 split — the single largest surviving fragment inherits the *entire* former treasury; every other fragment starts at 0 gold; fragments under 2 hexes get no province object at all and lose any building on them.
- **Move-zone detection is a bounded flood fill through your own province** (`MoveZoneDetection.detectMoveZone`), capped at `UNIT_MOVE_LIMIT = 4` hexes of own territory for interactive play (but effectively unlimited for AI capital-based attack planning) — not literally "unlimited" as some fan summaries claim.
- **Map generation** is "spawn N island blobs via weighted random flood fill, connect them with roads, crop to bounds, then run 4 balancing passes" — fully pseudo-codable from `MapGenerator.java` (below).
- **AI is a two-phase greedy heuristic system**, not minimax/MCTS: (1) move every unit that's ready — attack the "most attractive" reachable enemy hex (most friendly neighbours = highest allure; barons prefer towers), else clear a tree, else retreat to a safer interior hex; (2) spend money — build towers where defense-gain ≥ threshold, then build-and-attack in ascending unit strength. Difficulty levels are the *same* algorithm with different guardrails switched on/off (easy AI can't build towers, merges only 1+1, moves randomly; normal AI has a 50% chance to skip a unit's action; hard/expert add "move idle units to a random front-line hex" and safety checks before attacking). This is corroborated by an indie Slay-successor ("Konkr"), whose dev describes the same two-phase heuristic-candidates → utility-score design.
- Hex math: use **axial coordinates** for storage, convert to **cube coordinates** for neighbor/distance/range math, and the standard Red Blob Games pointy/flat-top pixel formulas for canvas rendering.

---

## 1. Slay — the canonical rules (verbatim, from the source)

Primary source: Sean O'Connor's own rules page, **https://www.windowsgames.co.uk/slayRules.html** (fetched in full 2026-09-21; there is no separate "manual" PDF — this HTML page is the manual). Secondary: **https://en.wikipedia.org/wiki/Slay_(video_game)**.

### 1.1 Territories, capitals, income

> "The land that you own is divided into territories of adjoining hexagons. Each territory of two or more hexagons in size will have its own capital, shown by a house. The money that a territory has is kept in the capital."

> "At the beginning of every turn each of your territories earns 1 credit for each hexagon which is in it that does not have a tree on it."

- A **province** = a maximal connected component of same-owner hexes (hex adjacency, same fraction). Ownership graph, not a designer-placed region.
- **Capital rule**: a province needs **≥ 2 hexes** to have (and keep) a capital. A lone captured hex is not a province and cannot bank gold or build anything.
- **Income = 1 gold per non-tree hex per turn**, collected into the province's capital (banked centrally, not per-hex).

### 1.2 Wages / upkeep and unit purchase

> "The costs for different men are (the more expensive men are created by combining the cheaper ones): Peasant 2, Spearman 6, Knight 18, Baron 54. Castles cost nothing to maintain. ... A new peasant costs 10 and a castle costs 15."

| Unit | Strength | Purchase cost | Upkeep/turn |
|---|---|---|---|
| Peasant | 1 | 10 | 2 |
| Spearman | 2 | *(built by merging, not purchased directly)* | 6 |
| Knight | 3 | *(built by merging)* | 18 |
| Baron | 4 | *(built by merging)* | 54 |
| Castle | — | 15 | 0 |

Only the peasant is directly purchasable in classic Slay; stronger units are produced only by merging (see 1.4). (Antiyoy generalizes this — see §2 — letting you directly buy any strength for `10 × strength`.)

### 1.3 Bankruptcy

> "If a territory does not have enough money to pay its people it will go bankrupt and all its men will die, turning into gravestones. Next turn, a tree will grow on the grave."

- Net = income − total upkeep of all units in the province (dotations/etc. don't exist in classic Slay). If the province's money would go negative after paying wages, **the whole province goes bankrupt**: every unit in it dies simultaneously and becomes a grave (`Obj.GRAVE` in Antiyoy's terms) on its hex. On the *following* turn, each grave spawns a tree (pine or palm depending on coastal adjacency — Antiyoy: `spawnTree` picks PALM if `hex.isNearWater()`, else PINE).

### 1.4 Movement, merging, one action per unit per turn

> "If your men have neither captured an enemy hexagon nor chopped down a tree during this turn they will jump up and down to show that they can still be moved. You can pick up a jumping man and drag him as many times as you want within his own territory, but he can make only one attack per turn onto an enemy hexagon adjoining his territory or chop down one tree in his own territory."

- A unit can be **repositioned freely, any number of times, within its own connected province** in a turn (free repositioning, no cost) — bounded in Antiyoy to `UNIT_MOVE_LIMIT` hexes deep of own territory (see §2.6), which is a stricter cap than "as many times as you want."
- It gets **exactly one offensive action per turn**: either **attack** one adjoining enemy/neutral hex, or **chop down one tree** in its own province. Doing either stops it "jumping" (marks it as moved) for the rest of the turn.
- **Newly bought units** appear "jumping" (ready) immediately — the manual's own change-log entry for the Windows CE (2001) port explicitly says **"you can now attack on the first turn"** confirming a freshly purchased peasant can move/attack the turn it's bought.
- **Merging**: "You can create stronger men by placing one of your men on top of another one in the same territory. The strength of the new man that you create will be the sum of the strengths of the two individual men." Peasant+Peasant→Spearman(2), Peasant+Spearman→Knight(3), Spearman+Spearman→Baron(4). The move that performs the merge *is itself a move* of the unit being dragged onto the other; whether the merged unit is still able to act again this turn is governed in Antiyoy by an explicit rule (see §2.5): **a merged unit is ready to move only if *both* source units were still ready to move** (hadn't yet acted this turn).

### 1.5 Combat / defense — "protection of adjacent hexes"

> "Men, capitals and castles defend the hexagon that they are standing on and all the hexagons immediately surrounding them in their same territory. Castles defend at the strength of a spearman, capitals with the strength of a peasant."
>
> "To make a successful attack, the attacking piece must be stronger than the enemy's defence... A peasant could not take a hexagon which has an enemy peasant on it nor any of the hexagons that the enemy peasant is defending. A spearman could kill the peasant or take any of the hexagons surrounding the peasant... It takes at least a knight to capture an enemy castle, or a hexagon defended by it."

- **Defense number of a hex** = the **maximum** strength among: any unit standing on it, any building on it (capital = 1, castle = 2), and the same for every same-owner neighbouring hex (a unit/capital/castle one hex away "reaches over" to defend). This is a **max, not a sum** — one strong defender shields its whole neighbourhood.
- **Attack succeeds iff attacker strength > target hex's defense number** (strictly greater; equal strength does not capture).
- Strength caps at 4 (baron); there is no unit stronger than baron in classic Slay.

### 1.6 Capturing a capital / linking territories

> "If a capital is destroyed a new one will be formed but all of its money will be lost."
>
> "If you capture a hexagon which links two of your territories together, the capital of the smaller territory will disappear and its money will be transferred to the larger territory's capital."

- Capturing the enemy's capital hex directly **wipes that province's treasury to zero** and (if the remaining fragment is still ≥2 hexes) forms a fresh capital somewhere in it.
- If **your own** capture links two of *your own* separate provinces into one contiguous province, the smaller province's capital is dissolved and its balance is folded into the (surviving) larger province's capital.
- The rules page doesn't spell out the inverse case — a capture that **splits an enemy's province into two pieces** — in prose; Antiyoy's source (§2.7 below) is the load-bearing reference for the exact algorithm, and matches the "smaller loses, larger keeps the treasury" spirit of the linking rule.

### 1.7 Trees

> "Trees grow on your hexagons at the beginning of your turn. You do not collect any money from hexagons which have trees on them."
> "Pine trees: Grow on empty hexagons which are surrounded by two or more pine trees."
> "Palm trees: Grow on hexagons on the coast which are next to another palm tree."

- Two species, mutually exclusive spread conditions:
  - **Pine**: spawns on an *empty* hex (no unit, no building) that has **≥2 pine-tree neighbours**.
  - **Palm**: spawns on an *empty*, **coastal** hex (adjacent to at least one inactive/off-map hex, i.e. "next to water") that has **≥1 palm-tree neighbour**.
- A unit standing on a tree hex can spend its one action to "chop it down" (clearing the hex, which then earns income again) instead of attacking.
- Graves become trees the turn after a bankruptcy (species chosen the same way — palm if coastal, else pine).

### 1.8 Development history (relevant precedent, from the same page)

The "History Of The Game" section on the rules page is itself a useful design-precedent log:
- 1989 Atari ST BASIC prototype ("Battle Hex"): 4 human players, 4 unit strengths, castles, money — the core loop was already fixed at this stage.
- 1990 Atari ST assembler ("Empire"): added per-territory capitals holding money, trees, mountains (later cut — "they didn't add anything to the game"), first weak computer AI.
- 1994 Windows 3.1 ("Slay"): much better island generator, much better AI, AI surrender offers.
- 2001 Windows CE/PocketPC: **capitals changed to defend at peasant strength** (a rules change, meaning the strength-1 capital-defense rule postdates the original release) and **first-turn attacks enabled**.
- Later: network multiplayer for up to 6 players.

Sources:
- [Sean O'Connor's Games — Slay Rules](https://www.windowsgames.co.uk/slayRules.html)
- [Slay (video game) — Wikipedia](https://en.wikipedia.org/wiki/Slay_(video_game))
- [Slay (Video Game) — TV Tropes](https://tvtropes.org/pmwiki/pmwiki.php/VideoGame/Slay)
- [Slay — Sean O'Connor · Game Solver](https://game-solver.com/slay/)

---

## 2. Antiyoy — source-level rules and numbers

Repo: **https://github.com/yiotro/Antiyoy** (Java/libGDX, "core" module). Engine package: `core/src/yio/tro/antiyoy/gameplay/`; AI package: `core/src/yio/tro/antiyoy/ai/`. All file paths below are relative to `core/src/yio/tro/antiyoy/`. All line numbers are from the `master` branch as fetched 2026-09-21 via `raw.githubusercontent.com`.

### 2.1 The dual-ruleset architecture (the key reusable idea)

`gameplay/rules/Ruleset.java` is an abstract strategy class with hooks the rest of the engine calls into:

```java
public abstract class Ruleset {
    public abstract boolean canSpawnPineOnHex(Hex hex);
    public abstract boolean canSpawnPalmOnHex(Hex hex);
    public abstract void onUnitAdd(Hex hex);
    public abstract void onTurnEnd();
    public abstract boolean canMergeUnits(Unit unit1, Unit unit2);
    public abstract int getHexIncome(Hex hex);
    public abstract int getHexTax(Hex hex);
    public abstract int getUnitTax(int strength);
    public abstract boolean canBuildUnit(Province province, int strength);
    public abstract void onUnitMoveToHex(Unit unit, Hex hex);
    public abstract boolean canUnitAttackHex(int unitStrength, Hex hex);
}
```

Two concrete implementations, selected by a single boolean flag `GameRules.slayRules` at game-setup time and consumed by `AiFactory` (see §4.1) and by the engine everywhere (`gameController.ruleset.xxx()`):
- **`RulesetSlay`** — faithful reproduction of §1's rules.
- **`RulesetGeneric`** — Antiyoy's own evolved ruleset (farms, towers with upkeep, tree-felling reward).

**Reimplementation takeaway**: model this exact seam in TypeScript — one `Ruleset` interface, one `GameEngine` that only calls through it, and swap implementations to support "authentic Slay" vs. "Island Empire's own balance" without forking the engine.

### 2.2 Numeric constants — `gameplay/rules/GameRules.java`

```java
public static final int MAX_FRACTIONS_QUANTITY = 11;
public static final int NEUTRAL_FRACTION = 7;
public static final int UNIT_MOVE_LIMIT = 4;

public static final int PRICE_UNIT = 10;          // × strength
public static final int PRICE_TOWER = 15;
public static final int PRICE_FARM = 12;
public static final int PRICE_STRONG_TOWER = 35;

public static final int PRICE_TREE = 10;           // cost to hand-plant a tree (editor / generic)
public static final int FARM_INCOME = 4;            // bonus on top of the base 1/hex
public static final int TREE_CUT_REWARD = 3;        // gold refunded for clearing a tree (generic only)

public static final int TAX_TOWER = 1;
public static final int TAX_STRONG_TOWER = 6;
public static final int TAX_UNIT_GENERIC_1 = 2;
public static final int TAX_UNIT_GENERIC_2 = 6;
public static final int TAX_UNIT_GENERIC_3 = 18;
public static final int TAX_UNIT_GENERIC_4 = 36;    // NOTE: generic ruleset's baron upkeep is 36, not 54
```

`Province.DEFAULT_MONEY = 10` (starting treasury for any freshly created province, including the player's starting province).

### 2.3 Units and taxes, by ruleset — `RulesetSlay.java` / `RulesetGeneric.java`

| Strength | Unit (Slay name) | Purchase cost (`PRICE_UNIT × strength`) | Upkeep — **Slay** ruleset | Upkeep — **Generic** ruleset |
|---|---|---|---|---|
| 1 | Peasant | 10 | 2 | 2 |
| 2 | Spearman | 20 | 6 | 6 |
| 3 | Knight | 30 | 18 | 18 |
| 4 | Baron | 40 | **54** | **36** |

Both rulesets let you **directly buy any strength** (`province.money >= GameRules.PRICE_UNIT * strength`), unlike classic Slay's "only peasants are purchasable, everything else is merged" — a deliberate Antiyoy convenience feature. Merging is still available and identical in both: `mergedUnitStrength = unit1.strength + unit2.strength`, allowed only if the result is `<= 4` (`canMergeUnits`, both rulesets, `GameController.mergedUnitStrength`).

Buildings:

| Building | Cost | Defense strength | Upkeep |
|---|---|---|---|
| Town (capital) | — (auto-placed) | 1 | 0 |
| Tower | 15 | 2 | Slay: 0 · Generic: `TAX_TOWER = 1` |
| Strong Tower (Generic only) | 35 | 3 | `TAX_STRONG_TOWER = 6` |
| Farm (Generic only) | `12 + 2 × (existing farms in province)` — `Province.getExtraFarmCost()` | n/a (not a defensive object) | 0 |

Income per hex (`getHexIncome`):
- Both rulesets: **0** if the hex has a tree.
- Slay: **1** otherwise.
- Generic: **1** otherwise, **`FARM_INCOME + 1 = 5`** if the hex holds a farm (i.e. farms add a **net +4** on top of the hex's normal 1 — matching the "income +4" figure in the task brief exactly).

Farm cost escalates by **+2 gold per farm already in the province** (`Province.getExtraFarmCost()`, `FieldManager.java` / `Province.java:340-350`) — so the 1st farm costs 12, the 2nd costs 14, the 3rd 16, etc. — this stacking-cost mechanic is unique to Antiyoy's Generic ruleset; it is the concrete implementation of "farm cost 12 + 2 per farm" from the task brief.

Tree spread chance (`Ruleset.canSpawnPineOnHex` / `canSpawnPalmOnHex`):

| | Slay ruleset | Generic ruleset |
|---|---|---|
| Pine spreads onto an eligible empty hex (≥2 pine neighbours, no expansion-lock) | **80%** chance/turn (`random.nextDouble() < 0.8`) | **20%** chance/turn |
| Palm spreads onto an eligible empty coastal hex (≥1 palm neighbour) | **100%** (unconditional once eligible) | **30%** chance/turn |

Both share the same *eligibility* test (`Ruleset.howManyTreesNearby`, counts same as §1.7); only the per-turn roll differs. `hex.blockToTreeFromExpanding` prevents a hex that *just* spawned a tree (e.g. a fresh grave) from being counted as a valid "ready to expand" neighbour until the following turn (`Hex.hasPineReadyToExpandNearby` / `hasPalmReadyToExpandNearby` both check `!adjHex.blockToTreeFromExpanding`), and `expandTrees()` clears the flag for all existing trees right after applying new growth (`FieldManager.java:506-510`).

`onUnitAdd`/`onUnitMoveToHex` implement the **tree-felling reward**: only in the Generic ruleset, crushing/moving onto a tree hex refunds `TREE_CUT_REWARD = 3` gold to the province (`RulesetGeneric.java:28-37,105-112`); Slay ruleset has no such reward (both hooks are no-ops).

`canUnitAttackHex` — the only rules difference in the actual combat check between the two: Generic gives strength-4 units (barons) an unconditional "always wins" clause even against a defense number ≥4 (`if (unitStrength == 4) return true;`), while Slay strictly requires `unitStrength > hex.getDefenseNumber()` with no exception (`RulesetSlay.java:92-94` vs `RulesetGeneric.java:116-120`). Practically this only matters if the Generic ruleset lets some defense stack above 4 (it can, via a strong tower (3) sharing a hex with an adjacent unit).

### 2.4 Defense number — `gameplay/Hex.java:216-242`

```java
public int getDefenseNumber(Unit ignoreUnit) {
    int defenseNumber = 0;
    if (objectInside == Obj.TOWN) defenseNumber = 1;
    if (objectInside == Obj.TOWER) defenseNumber = 2;
    if (objectInside == Obj.STRONG_TOWER) defenseNumber = 3;
    if (containsUnit() && unit != ignoreUnit)
        defenseNumber = Math.max(defenseNumber, unit.strength);

    for (each of 6 neighbours of the same fraction) {
        defenseNumber = Math.max(defenseNumber, neighbour_building_or_unit_strength);
    }
    return defenseNumber;
}
```

This is exactly §1.5's "max across self + 6 same-owner neighbours" rule, implemented as a literal max-reduce over 7 hexes (self + 6 neighbours), each contributing `{unit strength, or 1/2/3 for town/tower/strong-tower, or 0}`. `canUnitAttackHex` (per ruleset, §2.3) then compares the attacker's raw strength against this number.

### 2.5 Movement eligibility & merge-readiness — `GameController.java`

- `isUnitValidForMovement(unit)` (`:409-413`): a unit is `readyToMove` at the start of its owner's turn iff it's that fraction's turn **and** `unit.currentHex.numberOfFriendlyHexesNearby() > 0` (i.e. it isn't fully surrounded/isolated — see the starvation rule below).
- `prepareCertainUnitsToMove()` (`:400-406`) runs at the top of every turn, flags eligible units `readyToMove = true`.
- After any move/attack/chop, `Unit.setReadyToMove(false)` is called (`Unit.moveToHex`, and end-of-turn `endTurnActions` force-clears all).
- **Merge readiness** (`GameController.mergeUnits`, `:778-792`):
  ```java
  mergedUnit.setReadyToMove(true);
  if (!unit1.isReadyToMove() || !unit2.isReadyToMove()) {
      mergedUnit.setReadyToMove(false);
  }
  ```
  i.e. the merged unit **can act again this turn only if both source units had not yet acted** — an exact, literal confirmation of the brief's "merged units can move if neither has moved."
- **Newly bought units**: `FieldManager.buildUnit` → `buildUnitByAttack`/peaceful path adds the unit via `Hex.addUnit`; nothing marks it not-ready, and it is created with `Unit`'s default `readyToMove = false`... but the AI code explicitly treats freshly-built units as immediately actionable (`spendMoney` is called *before* `moveUnits` isn't the order — actually `moveUnits()` runs first, then `spendMoneyAndMergeUnits()`, so a unit bought this turn simply won't get a *second* action from `moveUnits()` in the same AI pass; a human player, however, can drag it immediately in the UI because the "can this unit currently move" check for player input is really "is there a legal move-zone from this hex," not the `readyToMove` jump-flag — the jump-flag purely drives the *idle-animation* hint). Net effect matches the manual: **a unit you just bought can act the same turn.**

### 2.6 Move-zone (how far a unit can go) — `gameplay/MoveZoneDetection.java`

`detectMoveZone(startHex, strength, moveLimit)` is a **breadth-first flood fill**:
- Start at the unit's hex with a `moveZoneNumber = moveLimit` budget.
- Expanding through a same-fraction neighbour **decrements the budget by 1** and continues the flood from there (any distance through your own connected province, capped by the budget).
- Reaching a **different-fraction** neighbour **adds it to the result but does not continue flooding past it**, and only if `ruleset.canUnitAttackHex(strength, hex)` says the attacker could actually beat that hex's defense (so hexes you can't currently beat are simply never offered as move-zone targets/attack options).
- Two call sites use different budgets: interactive per-unit movement uses `GameRules.UNIT_MOVE_LIMIT = 4`; AI's "could a unit built at the capital eventually reach and take this hex" planning query (`tryToAttackWithStrength`) calls the 2-arg overload, which defaults the limit to `9001` (i.e., **effectively unlimited** depth for that specific plan-level query only).

So: **normal per-unit movement is bounded to 4 hexes of own territory** in Antiyoy — tighter than Slay manual's "as many times as you want" — while AI's build-then-attack *planning* pretends movement is unlimited from the capital. Decide deliberately which of these two behaviors Island Empire wants; they diverge.

### 2.7 Province detection, splitting, merging — the exact algorithm

**Flood-fill province detection** (`gameplay/DetectorProvince.java`, `FieldManager.detectProvinces`) — classic same-owner BFS:
```java
ArrayList<Hex> detectProvince(Hex startHex) {
    // BFS over hexes with hex.fraction == startHex.fraction (skip NEUTRAL, which
    // is never grouped into provinces — every neutral hex is its own thing)
}
```
A component is only registered as a `Province` object (gets a capital, banks money) if `tempList.size() >= 2` (`FieldManager.java:383`) — **directly implements** "provinces < 2 hexes lose/never get a capital."

**On every hex-ownership change** (`FieldManager.setHexFraction`, `:1308-1330`), the engine does *not* re-run the whole-map flood fill; it does three targeted, incremental steps:

1. **`splitProvince(hex, previousFraction, previousObject)`** (`:1205-1252`) — re-floods each of the (up to 6) directions still owned by the *previous* owner from the just-captured hex, discovering however many disconnected fragments the old province broke into:
   ```
   for each of the 6 neighbour directions of the captured hex:
       if that neighbour still belongs to previousFraction and isn't visited yet:
           BFS-flood through same-previousFraction hexes -> fragment
           if fragment.size >= 2:
               create new Province(fragment), money = 0
               if fragment has no capital: place one (placeCapitalInRandomPlace)
           else:                                  # fragment.size == 1 (or 0)
               destroyBuildingsOnHex(that lone hex)   # loses any tower/farm/capital on it
   # after enumerating all fragments:
   if any fragments were created (and the captured hex itself wasn't the old capital):
       the SINGLE LARGEST fragment inherits the ENTIRE old province's money
       # every other, smaller fragment keeps its money = 0
   remove the old Province object
   ```
   **This is the concrete, load-bearing answer to "how does a split province pick a new capital and split treasury": it does not split evenly — the largest fragment takes 100% of the treasury, and every other fragment restarts at 0.** New capitals for fragments that don't already contain one are placed via `Province.placeCapitalInRandomPlace`: prefer a random *free* hex (no unit/building) in the fragment; if none is free, a random hex that isn't a tower; if that's empty too, any random hex in the fragment (`Province.java:33-53,95-103,114-122`).
   - *Implementation quirk worth a deliberate decision in your reimplementation*: the guard meant to skip money-inheritance "when the captured hex itself was the capital" tests `hex.objectInside == Obj.TOWN`, but by that point in `setHexFraction` the hex has already been through `cleanOutHex()` (called earlier in the same method), which always zeroes `objectInside` first — so as written in the current source, this guard is effectively always false and **the money-inheritance-to-the-largest-fragment rule fires even when the province's capital itself was the hex just captured.** The Slay manual's prose ("if a capital is destroyed... all its money will be lost") suggests the *intended* behavior was full loss on direct capital capture; Antiyoy's code as shipped does not actually special-case that. Pick one on purpose.
2. **`checkToUniteProvinces(hex)`** (`:1255-1277`) — if the *new* owner's captured hex is now touching 2+ of their own previously-separate provinces, merge them into one: sum all their money, keep the capital of whichever was largest (`getMaxProvinceFromList(...).getCapital()`), combine hex lists, remove the old Province objects, add one united Province. This is the literal implementation of §1.6's "capital of the smaller territory disappears, money transfers to the larger territory's capital" — except *money is summed from all merging fragments*, not just donated from the smaller one, and the capital location (not a fresh one) is reused from the largest fragment.
3. **`joinHexToAdjacentProvince(hex)`** (`:1285-1299`) — the simple case: if the new hex merely extends an existing province of the new owner (no split, no multi-province union), just append it (and any same-owner orphan neighbours) to that Province object directly, keeping its existing money untouched.

### 2.8 Turn sequence — `GameController.java`

```
turnStartActions():
    deselect everything
    if this is fraction 0's turn (i.e. a new "round" begins):
        expandTrees()                    # tree growth — see §2.3 — runs ONCE PER ROUND, not per player-turn
    prepareCertainUnitsToMove()          # flag eligible units as "ready" (jumping)
    transformGraves()                    # graves owned by the fraction now moving -> spawn tree, lock from expansion this round
    collectTributesAndPayTaxes()         # province.money += income - taxes (+ diplomacy dotations if enabled)
    checkForStarvation():
        checkForBankrupts()              # money < 0 -> money = 0, kill every unit in the province -> graves
        checkForAloneUnits()             # a unit with 0 friendly neighbouring hexes also dies by starvation, regardless of province money
    (fog of war / camera / UI bookkeeping)

... player or AI acts (moveUnit, buildUnit, buildTower, mergeUnits, buildFarm, endTurn) ...

endTurnActions():
    ruleset.onTurnEnd()
    clear every unit's readyToMove flag
    advance turn = next fraction (skipping the neutral fraction id 7)
```

Two starvation triggers exist, independently of each other: **province bankruptcy** (negative treasury after wages) kills the whole province's units, and **isolated-unit starvation** (a unit with zero same-owner neighbouring hexes, e.g. stranded on a single captured hex that never joined a province) kills that one unit even if its owner is rich elsewhere — this second rule has no equivalent stated in the classic Slay manual and is worth deciding on purpose.

### 2.9 Neutral fraction and the fraction-count constant

`GameRules.NEUTRAL_FRACTION = 7` — neutral/unclaimed hexes are a magic fraction id, always excluded from province grouping (`DetectorProvince.detectProvince` treats it as "always its own province of exactly that one hex, never merged with anything"). `MAX_FRACTIONS_QUANTITY = 11` caps total factions (players + AI) at 10 real players + 1 neutral slot.

### 2.10 Sources (Antiyoy)

- Repo root: [github.com/yiotro/Antiyoy](https://github.com/yiotro/Antiyoy)
- Rules/numbers: [`gameplay/rules/GameRules.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/gameplay/rules/GameRules.java), [`Ruleset.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/gameplay/rules/Ruleset.java), [`RulesetSlay.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/gameplay/rules/RulesetSlay.java), [`RulesetGeneric.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/gameplay/rules/RulesetGeneric.java)
- Entities: [`gameplay/Unit.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/gameplay/Unit.java), [`gameplay/Hex.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/gameplay/Hex.java), [`gameplay/Province.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/gameplay/Province.java), [`gameplay/Obj.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/gameplay/Obj.java)
- Engine/turn logic: [`gameplay/GameController.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/gameplay/GameController.java), [`gameplay/FieldManager.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/gameplay/FieldManager.java), [`gameplay/DetectorProvince.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/gameplay/DetectorProvince.java), [`gameplay/MoveZoneDetection.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/gameplay/MoveZoneDetection.java)
- Map gen: [`gameplay/MapGenerator.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/gameplay/MapGenerator.java), [`gameplay/MapGeneratorGeneric.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/gameplay/MapGeneratorGeneric.java), [`gameplay/LevelSize.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/gameplay/LevelSize.java), [`gameplay/LevelSizeManager.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/gameplay/LevelSizeManager.java)
- AI: [`ai/AiFactory.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/ai/AiFactory.java), [`ai/Difficulty.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/ai/Difficulty.java), [`ai/AbstractAi.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/ai/AbstractAi.java), [`ai/ArtificialIntelligence.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/ai/ArtificialIntelligence.java), [`ai/AiExpertSlayRules.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/ai/AiExpertSlayRules.java), [`ai/AiEasy.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/ai/AiEasy.java), [`ai/AiNormalSlayRules.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/ai/AiNormalSlayRules.java), [`ai/AiHardSlayRules.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/ai/AiHardSlayRules.java)
- Repo file-tree enumerated via `https://api.github.com/repos/yiotro/Antiyoy/git/trees/master?recursive=1` (1030 `.java` files under `core/src/yio/tro/antiyoy/`); the newer "master AI" (`ai/master/AiMaster.java` and friends, a more elaborate multi-candidate planner used only for the `MASTER` difficulty on the Generic ruleset) exists but was not read in full for this pass — flagged for a follow-up read if Island Empire wants a "master"-tier AI.

---

## 3. Map generation — algorithm and pseudo-code

Source: `gameplay/MapGenerator.java` (771 lines, read in full). This generates the "island(s)" map; `MapGeneratorGeneric.java` is a thin subclass adding farm-placement passes for the Generic ruleset (not detailed further here — flag for follow-up if needed).

### 3.1 High-level pipeline — `generateMap()`

```
generateMap(random, field):
    setValues(random, field)     # cache board bounds (from LevelSizeManager), field dims
    beginGeneration()            # allocate field matrix, island-center list, road-link list
    createLand()                 # 3.2 — spawn island blobs until the result "isGood()"
    removeSingleHoles()          # fill any single-hex hole fully surrounded by 6 active hexes
    addTrees()                   # scatter initial trees at GameRules.treesSpawnChance per empty hex
    balanceMap()                 # 3.3 — fairness passes (only if fractionsQuantity >= 4)
    endGeneration()
```

### 3.2 Land shape — island-blob flood fill + road-linking

```
createLand():
    repeat:
        deactivate all hexes
        N = numberOfIslandsByLevelSize()      # SMALL:2  MEDIUM:4  BIG:20  HUGE:35
        for i in 1..N:
            hex = getRandomHexInsideBounds()   # small/medium: uniform random cell;
                                                # big/huge: radially biased toward map center
            islandCenters.add(hex.pos)
            spawnIsland(hex, size=7)           # 3.2.1 — probabilistic blob flood fill, radius budget 7
        uniteIslandsWithRoads()                # 3.2.2 — connect each island to its nearest unlinked neighbour
        centerLand()                            # recenter the whole active-hex bounding box on the map center
        cutOffHexesOutsideOfBounds()            # trim anything outside the level's rectangular bounds
    until isGood()                              # isGood = map is one connected blob AND active hexes > 25% of the bounded area

spawnIsland(startHex, size):
    startHex.genPotential = size
    BFS from startHex, each visited hex gets a genPotential = parent.genPotential - 1
    at each hex: if random.nextInt(size) > hex.genPotential: stop expanding this branch (probabilistic falloff — the
                 deeper from the seed, the less likely a hex activates, giving organic/blobby coastlines, not disks)
                 else: activateHex(hex, random_non_neutral_fraction)   # every activated hex gets a RANDOM owner
                 continue flooding to unvisited neighbours with potential-1, unless genPotential has hit 0
```

`spawnIsland` is called both for the initial island seeds (potential 7) and, inside `createRoadBetweenIslands`, repeatedly with potential 2 along a straight line between two island centers — i.e. **roads are literally a chain of tiny probabilistic blobs dropped along the line connecting two island centroids**, at intervals of `hexSize/2`, which is what fuses separate islands into one connected landmass so `isLinked()` can eventually pass.

`isHexInsideBounds(hex)` crops a margin (10% width each side, 15%/10% height top/bottom) off the raw canvas bounds — the playable island never touches the literal edge of the level rectangle.

**Every activated hex is immediately assigned a uniformly-random non-neutral fraction** at creation time — ownership isn't decided after the fact; the whole land/ownership split happens in one pass, then §3.3 spends four fairness passes cleaning up the resulting mess.

### 3.3 Fairness/balance passes — `balanceMap()`

```
balanceMap():
    checkToFixNoPlayerProblem()          # if fraction 0 (the human, presumably) has literally zero
                                          # territory of size >=2 after random assignment, forcibly
                                          # grab one hex adjacent to any of its existing hexes
    if fractionsQuantity < 4: return     # guards against an infinite loop with too few factions

    spawnManySmallProvinces()            # every hex with "no province nearby" seeds a fresh
                                          # 2-hex-radius probabilistic province of its own random fraction
    cutProvincesToSmallSizes()           # iteratively: any province > SMALL_PROVINCE_SIZE(=5) hexes has its
                                          # weakest-connected hex reassigned to a different random fraction,
                                          # looped up to 100 times, until no province exceeds 5 hexes
    achieveFairNumberOfProvincesForEveryPlayer()
                                          # count each fraction's number of (>=2-hex) provinces; while the
                                          # max-min spread across fractions exceeds 1, take one whole province
                                          # from the fraction with the most and give it to any neighbouring
                                          # fraction that ISN'T already touching it elsewhere (avoids instantly
                                          # re-merging); loop up to 50 times
    applyBalanceMeasures()               # hand-tuned per-seat handicaps, see below
```

`applyBalanceMeasures()` — explicit, hard-coded handicap curve (comment in source records empirical hex-count outcomes from tuning runs):
```
giveAdvantageToPlayer(lastSeat,        0.053)   # each of a province's hexes has a 5.3% chance per
giveAdvantageToPlayer(secondToLastSeat,0.033)   # neighbouring foreign hex to flip to it (biased growth)
if fractionsQuantity >= 5:
    giveAdvantageToPlayer(seat2, 0.0165)
else:
    giveAdvantageToPlayer(seat1, 0.0065)
    giveAdvantageToPlayer(lastSeat, 0.01)
giveDisadvantageToPlayer(seat0, 0.048)          # seat 0 (human?) has each hex w/ enemies nearby a 4.8%
                                                 # chance to defect to a random fraction (net shrinkage)
```
i.e., turn order / AI seat position is empirically *not* fair by default, so the generator hand-nudges: later AI seats get a small random-growth bonus, seat 0 gets a small random-shrink penalty — a pragmatic, playtested fudge rather than a principled algorithm. Directly reusable idea for Island Empire's own map balancer.

`increaseProvince`/`decreaseProvince` are the primitive operators behind advantage/disadvantage: for every hex in a target province, roll `power` chance per foreign neighbour to flip that neighbour to the province's fraction (grow) or, for shrink, roll `power` chance for a hex *with enemies nearby* to defect to a uniformly random other fraction.

### 3.4 Trees and provinces-per-player, initial money

- `addTrees()`: for every active hex, with probability `GameRules.treesSpawnChance` (default `0.1`, i.e. 10%) and only if the hex is otherwise empty, spawn a tree (palm if coastal, else pine).
- `GameRules.treesSpawnChance` and `GameRules.genProvinces` are both exposed as tunables (`genProvinces` defaults to 0 and appears to be a hook for a "desired provinces per player" setting used by the skirmish-setup UI, not by `MapGenerator` itself — the actual per-player province count is an emergent result of §3.3's fairness pass, not a directly dialed parameter).
- **Initial money**: every freshly created `Province` (including the ones the map generator produces) starts at `Province.DEFAULT_MONEY = 10`, per §2.2 — there is no separate "starting money" concept for map-gen; it's the same constant used for every province born at runtime (including a post-split fragment absent its inherited treasury).
- **Land ratio**: not a single dialed constant — it's the emergent result of the `isGood()` acceptance test (`activeHexes.size() > 0.25 * numberOfAvailableHexes()`, i.e. **at least 25% of the bounded canvas area must end up land**) combined with the island count/size knobs above; the generator retries the whole `createLand()` pipeline from scratch until that threshold is met.

### 3.5 Sources (map gen)

- [`gameplay/MapGenerator.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/gameplay/MapGenerator.java) — full algorithm, read in full for this report.
- [`gameplay/MapGeneratorGeneric.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/gameplay/MapGeneratorGeneric.java) — farm-placement subclass, not detailed here (follow-up candidate).
- [`gameplay/LevelSize.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/gameplay/LevelSize.java) / [`LevelSizeManager.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/gameplay/LevelSizeManager.java) — SMALL/MEDIUM/BIG/HUGE bound multipliers (1×, 2×1, 2×2, 3×3 screens).

---

## 4. AI — algorithm and pseudo-code

Source: `ai/ArtificialIntelligence.java` (the shared base class implementing almost the entire behavior, 488 lines, read in full), plus the per-difficulty override files.

### 4.1 Difficulty ladder and how rulesets map to AI classes — `ai/Difficulty.java`, `ai/AiFactory.java`

```java
EASY = 0, NORMAL = 1, HARD = 2, EXPERT = 3, BALANCER = 4, MASTER = 5
```

`AiFactory.addAiToList(difficulty, fraction)` selects a class; note `AiEasy` is difficulty-and-ruleset-agnostic (used for both Slay and Generic rules), while every other tier forks by ruleset:

| Difficulty | Slay-ruleset class | Generic-ruleset class |
|---|---|---|
| Easy | `AiEasy` | `AiEasy` |
| Normal | `AiNormalSlayRules` | `AiNormalGenericRules` |
| Hard | `AiHardSlayRules` | `AiHardGenericRules` |
| Expert | `AiExpertSlayRules` | `AiExpertGenericRules` |
| Balancer | `AiBalancerSlayRules` | `AiBalancerGenericRules` |
| Master | `AiExpertSlayRules` (reused) | `ai/master/AiMaster.java` (separate, more elaborate planner — not read in detail for this pass) |

Every difficulty is a **subclass of the same `ArtificialIntelligence` base** (itself an `AbstractAi`), overriding only a handful of hook methods — this is a clean "strategy + template method" shape worth mirroring directly in TypeScript (one `BaseAi` class implementing the whole decision tree, difficulty tiers override 3–6 named hooks).

### 4.2 Per-turn structure — `AbstractAi.perform()` → `makeMove()`

```
perform():
    numberOfUnitsBuiltThisTurn = 0
    makeMove()                     # difficulty-specific, but nearly always this shape:

makeMove():                        # e.g. AiExpertSlayRules / AiHardSlayRules
    moveUnits()                    # 4.3 — act with every unit that's ready
    spendMoneyAndMergeUnits()      # 4.4 — for every owned province: build towers, build/attack units, merge
    moveAfkUnits()                 # 4.5 — only hard/expert+: nudge idle units in big provinces toward the front
                                    # (AiEasy/AiNormal skip this step)
```

### 4.3 Per-unit decision — `decideAboutUnit(unit, moveZone, province)` (base + Expert override)

```
decideAboutUnit(unit, moveZone, province):
    moveZone = floodfill(unit.currentHex, unit.strength, UNIT_MOVE_LIMIT)   # §2.6
    exclude own buildings and own units from moveZone (can't move onto them)

    if unit.strength <= 2 and there's a reachable PALM tree on own territory:
        chop it (highest priority — clears expansion-blocking coastal trees early)
        return

    attackable = [hex in moveZone if hex.fraction != my fraction]   # includes neutral & enemy
    if attackable is non-empty:
        # EXPERT ONLY extra guard before committing to attack:
        if expert AND NOT unitCanMoveSafely(unit): return   # see 4.3.1 below — don't over-extend
        target = findMostAttractiveHex(attackable, province, unit.strength)   # 4.3.2
        move/attack target
    else:
        if there's a reachable tree on own territory: chop it
        elif unit.currentHex.isInPerimeter():          # sitting on a border hex with nothing to do
            pushUnitToBetterDefense(unit, province)     # step into a free, same-owner neighbour hex that
                                                         # itself has ZERO enemy neighbours (retreat inward)
```

#### 4.3.1 Safety check (Expert only) — `unitCanMoveSafely`

```
unitCanMoveSafely(unit):
    count same-owner border neighbours of unit.currentHex that are:
        - not defended by any OTHER building/unit, AND
        - themselves on the province's perimeter (adjacent to a foreign hex)
    return count <= 3
```
i.e., **don't move a unit away if doing so would strip defense from 4+ otherwise-undefended border hexes it's the sole guardian of.** This is the one heuristic in the base pack that reasons about the *defensive value of staying put*, not just the offensive value of moving.

#### 4.3.2 Target selection — `findMostAttractiveHex` / `getAttackAllure` / `findHexAttractiveToBaron`

```
findMostAttractiveHex(attackableHexes, province, strength):
    if strength in {3, 4}:                       # knight/baron
        prefer a tower hex (any strength>=3 can hit a normal tower; strength==4 can also hit a strong tower)
        else prefer any hex that isDefendedByTower()    # snipe the thing propping up enemy defense
        if found: return it
    # otherwise (or if no tower target): pick the reachable hex with the highest "attack allure" —
    allure(hex, myFraction) = count of hex's 6 neighbours that are already MY fraction
    return hex with max allure   # i.e. prefer captures that consolidate/round out your own border,
                                  # not captures that create a new exposed salient
```
This "allure = friendly-neighbour count" heuristic is simple, cheap, and directly reusable: it's effectively "prefer the move that maximizes your own post-capture defensibility (more same-owner neighbours around the new hex = more mutual protection), and specifically hunt down enemy towers with your heavy units."

### 4.4 Spending money — `spendMoney(province)` → `tryToBuildTowers` + `tryToBuildUnits`

```
tryToBuildTowers(province):
    while province.hasMoneyForTower():
        hex = first own, empty hex where needTowerOnHex(hex) is true
        if none: stop
        build tower there

needTowerOnHex(hex):                              # base/normal/hard
    getPredictedDefenseGainByNewTower(hex) >= 5
needTowerOnHex(hex):                              # Expert override — cheaper threshold, but border-only
    only consider hexes that are near an ENEMY province at all (updateNearbyProvinces(hex))
    getPredictedDefenseGainByNewTower(hex) >= 3

getPredictedDefenseGainByNewTower(hex):
    score = 0
    if hex itself isn't already covered by a tower: score += 1
    for each of hex's 6 same-owner neighbours not already covered by a tower: score += 1
    for each neighbour that ALREADY has a tower: score -= 1     # penalize redundant placement
    return score
```

```
tryToBuildUnits(province):                        # base/normal/hard shape
    tryToBuildUnitsOnPalms(province)               # spend on strength-1 units specifically to clear palm trees
    for strength in 1..4:
        if !province.canAiAffordUnit(strength): break      # canAiAffordUnit projects `strength+1` turns of
                                                             # upkeep ahead — see below — so it stops raising
                                                             # strength once it can't sustain the next tier
        while canProvinceBuildUnit(province, strength):
            if !tryToAttackWithStrength(province, strength): break   # only buys a unit if there's something
                                                                       # useful for it to immediately attack —
                                                                       # AI never stockpiles idle units by design
    if canProvinceBuildUnit(province, 1) and howManyUnitsInProvince(province) <= 1:
        tryToAttackWithStrength(province, 1)        # "kick-start" clause: a province with 0-1 units always
                                                      # tries to get its first defender/attacker out, even if
                                                      # the main loop above didn't trigger
```

`tryToAttackWithStrength(province, strength)`: computes an *unbounded* move-zone from the province's **capital** (§2.6's `9001` overload), finds attackable hexes in it, picks `findMostAttractiveHex`, and **builds the new unit directly on the target hex if it's a peaceful build, or builds-then-attacks** (`buildUnit` → `buildUnitByAttack` when the target hex isn't already the same fraction). This is the mechanism by which the AI "teleports" newly purchased force to the front line in one action — it doesn't march a peasant from the capital over several turns, it deploys directly to the calculated best contact point.

`Province.canAiAffordUnit(strength, turnsToSurvive = strength + 1)`:
```
newIncome = province.profit - ruleset.getUnitTax(strength)
return province.money + turnsToSurvive * newIncome >= 0
```
i.e. the AI look-aheads `strength + 1` turns of net income *after* hypothetically adding this unit's upkeep, and only proceeds if the province wouldn't go bankrupt within that window — a simple, cheap solvency forecast rather than true planning.

### 4.5 Difficulty-tier deltas (concrete diffs read from source)

| Behavior | Easy | Normal | Hard | Expert |
|---|---|---|---|---|
| `moveAfkUnits` (push idle units in provinces >20 hexes toward a border) | no | no | **yes** | yes (Expert overrides target-picking to a *random* perimeter hex + mass-march pathing instead of a random reachable hex) |
| Chance to skip a unit's turn entirely | 0% | **50%** (`checkChance(0.5)` gate before `decideAboutUnit`) | 0% | 0% |
| `unitCanMoveSafely` pre-attack guard | no | no | no | **yes** (§4.3.1) |
| Target selection sophistication | random reachable hex (ignores allure) | full `findMostAttractiveHex` | full | full, plus tower-sniping priority reinforced, plus a disabled (commented-out) "prefer hexes near my own buildings" tweak left in the code as a noted but unused experiment |
| Can build towers | **no** (`tryToBuildTowers` is overridden to a no-op) | yes | yes | yes, with a lower/tighter threshold restricted to border hexes only |
| Merge units | only 1+1→2, and only **25% of the time** it even attempts a merge pass at all (`mergeUnits` gated by `random.nextDouble() < 0.25`) | any legal merge, every turn | any legal merge, every turn | any legal merge, every turn |
| Unit-build loop shape | build-inside-province opportunistically (`tryToBuiltUnitInsideProvince`), not attack-directed | build directed at an attack target (`tryToAttackWithStrength`), one strength tier at a time, stops on first non-attack | same as Normal | same shape, but **doesn't break out of the strength loop on a successful attack** — resets `i = 0` and keeps building/attacking at strength 1 again immediately, letting a rich province chain many attacks in one turn instead of pausing between tiers |
| Palm-clearing priority in per-unit decisions | no special case (falls through to generic tree-chop) | (inherits base `decideAboutUnit`, which does prioritize palms for strength ≤2) | inherits base | explicit override, same palm-first priority as base |

The `Balancer` tier (`AiBalancerSlayRules`/`AiBalancerGenericRules`, not read in full this pass) is used specifically by the game's difficulty-auto-tuning/handicap system, not as a normal opponent — flagged for follow-up if Island Empire wants adaptive difficulty.

### 4.6 External corroboration — Konkr (an indie "Slay-like")

**Konkr.io** (embair, itch.io), explicitly "heavily inspired by Sean O'Connor's Slay!," describes its own AI in dev-log comments as a very similar two-phase design, useful as independent confirmation this class of heuristic AI is both standard and sufficient for the genre:
1. **Cheap heuristic candidate generation**: simulate a handful of different move plans using heuristics that "cheaply guess which moves make sense," backed by auxiliary data structures tracking which tiles are important to defend or capture (i.e., something like Antiyoy's `nearbyProvinces`/perimeter/allure computations).
2. **Expensive utility scoring**: run a proper (more expensive) evaluation function over each candidate plan's *end state* and pick the best-scoring one.
3. Explicit fix for the defense/offense balance problem: **always generate one candidate that commits 100% to offense** ("sometimes that's the best defense"), alongside other candidates at varying offense/defense splits — an insight worth carrying into Island Empire's AI even though Antiyoy itself doesn't do explicit multi-candidate scoring (Antiyoy is pure greedy-heuristic, no candidate comparison step).

Source: [Konkr.io by embair — itch.io](https://embair.itch.io/konkr) and its devlog/comments (aggregated via search; the "Rivals making stupid faces" devlog post in particular discusses AI opponent personality, not the core algorithm).

### 4.7 Sources (AI)

- [`ai/ArtificialIntelligence.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/ai/ArtificialIntelligence.java) — full base-class algorithm, read in full.
- [`ai/AiExpertSlayRules.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/ai/AiExpertSlayRules.java), [`ai/AiEasy.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/ai/AiEasy.java), [`ai/AiNormalSlayRules.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/ai/AiNormalSlayRules.java), [`ai/AiHardSlayRules.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/ai/AiHardSlayRules.java) — read in full.
- [`ai/AiFactory.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/ai/AiFactory.java), [`ai/Difficulty.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/ai/Difficulty.java), [`ai/AbstractAi.java`](https://github.com/yiotro/Antiyoy/blob/master/core/src/yio/tro/antiyoy/ai/AbstractAi.java) — read in full.
- Not read this pass (follow-up candidates): `ai/master/AiMaster.java` and the `ai/master/*` package (a more elaborate multi-manager planner — `AttackManager`, `DefenseManager`, `PropagationCaster`, etc. — used for the Generic ruleset's Master difficulty); `ai/AiExpertGenericRules.java`, `ai/AiNormalGenericRules.java`, `ai/AiHardGenericRules.java` (Generic-ruleset counterparts — likely close variants of the Slay ones given the pattern above, but not diffed).
- [Konkr.io — embair — itch.io](https://embair.itch.io/konkr)

---

## 5. Hex-grid implementation notes (Red Blob Games)

Primary reference: **https://www.redblobgames.com/grids/hexagons/** (the canonical, interactive guide; also see its sibling pages `.../hexagons/implementation.html` for copy-pasteable code and `.../grids/parts/` for the underlying math). Use this over ad-hoc formulas; it's the standard the whole hex-game dev community cites.

### 5.1 Coordinate system choice

- **Store hex coordinates as axial `(q, r)`** — two integers, simplest for a hash-map-backed sparse or dense grid, and directly convertible to cube.
- **Convert to cube `(q, r, s)` with `s = -q - r`** whenever doing neighbor/distance/range/rotation math — cube coordinates make those operations simple vector arithmetic; the constraint `q + r + s = 0` is what makes it work, so never store `s` independently (always derive it).
- Avoid **offset coordinates** (`row, col` with every-other-row/column shoved half a step) for algorithmic code — vector math (add, subtract, distance) isn't uniform across parity, which produces exactly the class of off-by-one hex bugs that plague naive hex-grid implementations. Offset coordinates are fine only for a *storage/display* convenience layer (e.g. mapping to a 2D array for a specific renderer), converted to/from axial at the boundary.

### 5.2 Neighbors

Six fixed direction vectors in cube space (order is a convention, pick one and stay consistent — e.g. clockwise from "east"); axial neighbor vectors are simply the cube ones with `s` dropped. Because the vectors are the same everywhere on the grid (unlike offset coordinates), "get neighbor in direction `d`" is a single vector add — this is what both Antiyoy's `Hex.getAdjacentHex(direction)` (§2, six fixed directions 0–5) and Island Empire's engine should rely on.

### 5.3 Distance

- **Cube distance** = `(|Δq| + |Δr| + |Δs|) / 2`, equivalently `max(|Δq|, |Δr|, |Δs|)`.
- **Axial distance** (no need to materialize `s`) = `(|Δq| + |Δq + Δr| + |Δr|) / 2`.
Use this for anything wanting "how many hexes away," e.g. move-limit budgeting (§2.6) or AI perimeter/allure heuristics.

### 5.4 Range / flood fill

- **Unbounded-terrain range within radius N** (no obstacles): a direct double loop over cube coordinates, `q` from `-N..N`, and for each `q`, `r` from `max(-N,-q-N)..min(N,-q+N)` — O(N²) hexes, no BFS needed, because it's a plain geometric disk.
- **Obstacle-aware range / move-zone** (Antiyoy's actual need, §2.6, and Island Empire's actual need for "can this unit reach/attack this hex"): a **breadth-first search**, tracking remaining "budget" per hex, exactly as `MoveZoneDetection` implements it — this is the right tool whenever movement cost/legality varies by hex (own-territory-only movement, attack-stops-the-flood, etc.), not the geometric range formula.

### 5.5 Pixel conversion (for canvas rendering)

Pick an orientation up front — **pointy-top** (flat sides left/right, points up/down) or **flat-top** (points left/right) — and use the matching formula pair consistently; Island Empire should confirm which orientation matches its planned art direction before wiring this up, since it affects both these formulas and the sprite/tile art.

- **Pointy-top, hex→pixel** (hex size = distance from center to a corner):
  `x = size * √3 * (q + r/2)`
  `y = size * 3/2 * r`
- **Flat-top, hex→pixel**:
  `x = size * 3/2 * q`
  `y = size * √3 * (r + q/2)`
- **Pixel→hex** is the matrix inverse of the above, producing a *fractional* `(q, r, s)` that must be **rounded** with cube-rounding: round each of `q, r, s` independently to the nearest integer, compute the rounding error/residual for each, then **discard the rounded value with the largest error and recompute it from the other two** so `q + r + s = 0` still holds exactly. This is the standard, correct way to do hit-testing (mouse/touch → which hex) on a canvas; naive independent rounding of `q` and `r` alone produces wrong results near hex edges.

### 5.6 Rendering considerations for a TypeScript/canvas port

- Keep hex→pixel (deterministic, pure function) and pixel→hex (needs rounding) as two clearly separate utilities; almost all game-logic code only ever needs hex→pixel (for drawing) plus axial/cube math (for gameplay), while pixel→hex is needed only at the input layer (click/tap handling).
- Store the canonical game-state coordinate as axial `{q, r}`; compute `s` inline wherever cube math is needed rather than persisting a third field, to avoid state that can drift out of the `q+r+s=0` invariant.
- A flood-fill-heavy engine like this one (province detection, move-zone, tree-eligibility, island generation are *all* BFS/flood-fill over hex adjacency, per §§2–3 above) benefits from a fast, allocation-light neighbor iterator (`for (let d = 0; d < 6; d++) yield neighbor(hex, d)`) since it's the single hottest inner loop across nearly the entire engine.

### 5.7 Sources (hex grids)

- [Red Blob Games — Hexagonal Grids](https://www.redblobgames.com/grids/hexagons/) (axial/cube/offset coordinates, neighbors, distance, range, rounding, pointy/flat-top pixel formulas — the guide this section summarizes).

---

## 6. Open follow-ups (flagged, not blocking)

- `ai/master/AiMaster.java` and the `ai/master/*` package (Master-difficulty planner for the Generic ruleset) were located but not read in detail — worth a dedicated pass if Island Empire wants an AI tier above "Expert."
- `ai/AiExpertGenericRules.java` / `AiNormalGenericRules.java` / `AiHardGenericRules.java` (Generic-ruleset counterparts to the Slay-ruleset AI classes read in §4) were not diffed against their Slay counterparts — likely close variants given the `RulesetSlay`/`RulesetGeneric` pattern, but not confirmed.
- `gameplay/MapGeneratorGeneric.java` (farm-placement additions to map gen) was located but not read in full.
- No English-language academic paper specifically on "Slay AI" or "hex province game AI" was found; the closest corroboration is Konkr's own dev commentary (§4.6). If deeper AI research is wanted, general Hex-*board-game* (Piet Hein's connection game) AI literature turned up in search is a different game and not directly relevant.
