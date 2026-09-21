# Island Empire — Specification

A browser rebuild of **Island Empire** (HBRZ-Developer): a Slay/Antiyoy-style
turn-based territory game on a **square, 4-neighbour grid**. Deployed on
Vercel; PGlite locally, Neon in production; no accounts, no online play.

This document is the contract every build slice works against. Every number
is carried from `research/06-research-brief.md` (screenshot-verified, the
ground truth) unless marked **[SPEC]**, meaning this document resolves an
ambiguity the brief left open. Reasoning and evidence for every non-obvious
choice live in [`DECISIONS.md`](DECISIONS.md).

---

## 1. Vocabulary

| Term | Meaning |
|---|---|
| **Tile** | One cell of the square grid. Adjacency is **4-neighbour (orthogonal)** — never diagonal. |
| **Province** | A maximal connected group of ≥2 same-owner tiles. Has one **city** and one shared treasury. |
| **Lone tile** | A captured tile with no same-owner province (size 1). Owned, but banks no gold and cannot build. |
| **City** | The capital of a province. Destroying it eliminates the province (and, if it was the owner's last one, the player). |
| **Defence number** | The max strength projected onto a tile by every unit/building on it and on its same-province 4-neighbours. |
| **Strength** | A unit's or building's combat rating, 0 (buildings with no combat role) to 4 (Knight L4). |
| **Ready** (a unit) | Has not yet attacked or cleared a field/grave this turn; may still be moved. |
| **Move zone** | The set of tiles a unit can reach in one MOVE/ATTACK action: a 4-step budget flood fill through its own province, plus the capturable tiles fringing it. |
| **Turn** | One player's (human or AI's) complete set of actions between two `END_TURN` events. |
| **Day / round** | One full pass through every seat, seat 0 back to seat 0. |
| **MapDefinition** | The serialisable static description of a map: terrain, owners, buildings, units, players, tutorial script. |
| **GameState** | The engine's live, serialisable game state: tiles, provinces, players, turn, RNG seed. |
| **Session** | A client-side run of one game: a `GameState` plus UI-only concerns (selection, camera, undo animation) that never enter `GameState`. |
| **Seat** | A player slot, 0–7, each with a fixed colour. |

---

## 2. Scope

### In

- **Campaign**: one island of **12 hand-made levels** (5 tutorial + 7 puzzle), each playable on Easy/Normal/Hard, an overworld with both a walking avatar **and** direct tap-to-jump to any unlocked node, stars per level per difficulty.
- **Random maps** vs. 1–7 AI opponents (2–8 total seats), with a size/player/seed setup screen.
- **Hot-seat local multiplayer**, up to 8 players (at least two human, the rest optionally AI), pass-and-play hand-off screen.
- **Weekly challenges**: three maps chosen **deterministically by ISO week** from a shared pool of seeded + community maps, medals per difficulty beaten.
- **Map editor**: paint terrain/biome, place cities/units/buildings/decorations, set owners, validate, save, play, and share by URL (`/play/custom/[mapId]`).
- Settings (one-click-move toggle, sound/music toggles), undo, pause.

### Out (deliberately)

Online/networked multiplayer, IAP, ads, unlockable-skin economy, King/"Superiority" win condition (undocumented mechanics, not load-bearing to the genre), Battle Mode/Card Mode (unconfirmed to exist — §12 of `02-modes-maps-editor.md`), cloud accounts/sync, leaderboards beyond per-map medal storage, more than one biome skin set per terrain (one skin per biome, cosmetic only). Full list in §13.

---

## 3. Rules

### 3.1 Tiles

| Terrain | Ownable | Income | Passable to move through | Notes |
|---|---|---|---|---|
| Grass / Sand / Snow (biome base) | yes | **+1** | yes (if owned) | three biome palettes |
| Bridge | yes | **+1** | yes | spans a 1-tile water gap |
| Grass field | yes | **0** | yes (if owned) | any unit strength ≥0 clears it by moving onto it, converting it to the biome's plain terrain; ends the mover's turn |
| Grave | yes | **0** | yes (if owned) | a unit moving onto its own grave clears it immediately (same as a field); untouched, it auto-converts to a grass field after **2** of its owner's turn-starts |
| Water | no | — | no (except via bridge) | |
| Forest (pine/palm/ice-pine by biome) | no | — | no | never spreads (see D6) |
| Mountain | no | — | no | |
| Road | n/a (cosmetic overlay on an ownable tile) | inherits base tile | yes | |
| Decoration (rock/flower/bush/tree) | n/a (cosmetic overlay) | inherits base tile | yes | |

### 3.2 Economy

| Item | Cost | Upkeep/turn | Income/turn | Strength | Defence radius |
|---|---|---|---|---|---|
| Owned plain tile | — | — | +1 | — | — |
| Farm | 12 + 2 × (farms already in the province) | 0 | +5 (replaces the tile's +1; net +4) | 0 | none |
| Mine | not buyable — map-authored only | 0 | +8 | 0 | none |
| Chest | not buyable — map-authored only | — | **+10 once**, when captured — or, for a chest authored inside a player's own land, when one of their units steps onto it (D40) | — | — |
| Knight L1 | 10 | 2 | — | 1 | self + 4 same-province neighbours |
| Knight L2 | 20 | 5 | — | 2 | self + 4 same-province neighbours |
| Knight L3 | 30 | 12 | — | 3 | self + 4 same-province neighbours |
| Knight L4 | 40 | 30 | — | 4 | self + 4 same-province neighbours |
| Woodwall | 5 | 0 | — | 2 | **self only** |
| Stone tower | 15 | 1 | — | 3 | **self only** |
| City | auto (never bought) | 0 | — | 1 | self + 4 same-province neighbours |

- **Defence number of a tile** = max over `{self, and every same-province 4-neighbour}` of `{unit strength, building strength, 0}`.
- **Attack succeeds iff attacker strength > target tile's defence number** (strict). No randomness anywhere in combat.
- **Bankruptcy**: at the start of a province's turn, if `gold + income − upkeep < 0`, every unit in that province dies and leaves a grave on its tile; buildings survive; gold floors at 0. A unit standing on a bridge or on a mine dies without a grave — a grave is a terrain and cannot replace a bridge, and a mine keeps its building (D40).
- **Starvation**: independently of bankruptcy, a unit with zero same-owner 4-neighbours at its owner's turn-start dies with no grave.
- **Random-map starting gold**: every province starts at **10 gold**.
- **Campaign starting gold**: authored per level in its `MapDefinition` (`players[].startGold`), small values (1–13), scaled by AI difficulty — see §3.5.

### 3.3 Provinces — detection, split, merge

Adapted from Antiyoy's `FieldManager` (genealogy §2.7), 4-adjacency instead of 6.

- A province is a **≥2-tile** connected (4-adjacency) same-owner group with one city and one treasury.
- A **1-tile** captured group is a *lone tile*: owned, generates income that is discarded (not banked anywhere), cannot build, and starves its occupant if still friendless at the next turn-start.
- **On every capture** of tile `T` from owner `O` to owner `N`:
  1. Re-flood `O`'s land from each of `T`'s up-to-4 neighbours still owned by `O`, through `O`-owned tiles only. Each connected result is a fragment.
     - Fragment size ≥2 and it had no city already → place one via `placeCapitalInRandomPlace`: prefer a tile with no building/unit; else any tile in the fragment.
     - Fragment size 1 → not a province; any building on it is destroyed.
  2. **If more than one fragment resulted** (a real split): the single largest fragment inherits the *entire* pre-capture treasury; every other fragment starts at **0**.
  3. **If `T` was `O`'s city tile**, `O`'s province treasury is zeroed outright, regardless of fragment count — this explicitly resolves the ambiguity Antiyoy's own shipped code leaves open (genealogy §2.7's "implementation quirk"): capturing a capital always destroys its money.
  4. For `N`: gather `N`-owned 4-neighbours of `T`.
     - Zero → `T` becomes a lone tile under `N`.
     - Touches exactly one `N` fragment/province → `T` joins it; existing city and gold unchanged.
     - Touches ≥2 → merge every touched fragment (plus `T`) into one province: gold = **sum** of all merging fragments' gold; surviving city = the **largest** merging fragment's city (tie-break: lowest `(y, x)` tile index — deterministic); if none of the merging pieces had a city and the combined size ≥2, place a new one.
  5. Elimination check for `O`: if `O` now owns zero provinces with a city, `O` is eliminated.

### 3.4 Movement, attack, merge, build

- A **MOVE/ATTACK** targets a destination reachable by a **breadth-first flood fill of budget 4** through the unit's own province (4-adjacency). The budget counts every step, and the **last** of the four may be the step onto an adjacent enemy/neutral/field/grave tile the unit can legally interact with — so a capture is at most four tiles from the unit, never a fifth step beyond four own tiles (Antiyoy `UNIT_MOVE_LIMIT`; codex round 2 asked for the alternative reading and this is the deliberate one). The unit may **not** pass through forest, mountain, water (except a bridge), enemy tiles, or its own buildings/units (except to merge onto a friendly unit).
- **A move to an empty owned tile does not end the unit's turn** — it stays `readyToMove` and may be issued another MOVE/ATTACK from its new position (budget 4 again, computed fresh), any number of times per turn. This reproduces Slay's "free repositioning" while keeping Antiyoy's bounded per-move flood.
- **An ATTACK (capture) or a CLEAR (moving onto an owned grass field/grave) ends the unit's turn** (`readyToMove = false`).
- **Merge**: moving a friendly unit onto another friendly unit sums their levels (max 4) and ends the merged unit's turn **unless both source units were still `readyToMove`**, in which case the merged unit stays ready.
- **Buy** (see §3.5 for the exact card set): places a new unit/building. A new knight of **any level** placed onto an adjacent **capturable** tile it can beat (rather than an empty owned tile) performs the capture immediately as part of the purchase (Antiyoy's `buildUnitByAttack`; the original's shop sells every level directly, `play-05.png`) — a freshly bought unit may act the same turn it is bought. The human shop exposes the Level 1 card for placement and reaches higher levels through merge-buy at the identical total cost; the AI buys higher levels directly (D41).
- **Killed unit** (lost an attack, or was the defender of a successful enemy capture): vanishes with no grave. **Only bankruptcy produces graves.**
- **Captured buildings**: a farm, woodwall or stone tower on a captured tile is **destroyed** (`buildingDestroyed` event; the tile reverts to plain terrain under the capturer). A **chest** is collected (+10 to the capturer's province, `chestCollected`) and removed. A **city** is destroyed (§3.3). A **mine survives** capture and pays its +8 to whoever owns it — mines are map-authored contested objectives (D35).
- **BUY-merge readiness** (§3.5): the bought unit counts as ready, so the merged unit stays `readyToMove` iff the selected unit was still ready; merging onto a unit that already acted this turn yields a spent unit.

### 3.5 Buying, merging, and the shop (this section resolves the brief's ambiguous shop wording — see D10)

- **Nothing selected**: the shop shows exactly four cards, horizontally scrollable if the viewport is narrow: **Knight L1, Woodwall, Stone Tower, Farm**. Buying places the item as described in §3.4; gold is spent from the province that owns (or, for a capture-purchase, that is adjacent to and would own) the target tile.
- **A friendly unit selected**: the shop shows exactly four cards, **Knight L1 – L4**; buying one merges it onto the selected unit (§3.4); a card is disabled (greyed, unbuyable) if `selectedUnit.level + cardLevel > 4`. Gold is spent from the selected unit's own province.
- **AI difficulty and starting gold** (campaign only): a level's `MapDefinition.difficulty` table multiplies each AI seat's authored `startGold` — Easy ×0.5, Normal ×1, Hard ×1.5, each rounded to the nearest integer, applied once at `createInitialState`.

### 3.6 One-click-move (settings toggle, default OFF)

When ON: tapping a capturable tile adjacent to any of the player's ready units attacks from the **weakest ready unit that still beats the tile's defence number**; if no adjacent ready unit qualifies, the tap is a no-op.

### 3.7 Undo, elimination, win

- **UNDO** removes the last entry of `state.history` and rebuilds the state by **replaying the remaining history from `state.turnStart`** (the snapshot taken after the turn-start pipeline). Deterministic because `apply` is pure; cost is `O(actions this turn)`, and a turn rarely exceeds 30 actions. Greys out when `history` is empty. `END_TURN` clears it. UNDO is never recorded in `history`.
- A player is **eliminated** the instant they own zero provinces with a city (checked after every capture and once more at end of turn as a fallback).
- The game ends the instant only one un-eliminated player remains — evaluated immediately after every elimination check, including mid-turn; that player wins and no further actions are accepted (`outcome` is set, `gameOver` event).

### 3.8 Turn sequence (ordered)

1. **Turn start for the acting player P** (human or AI). **On day 1 (`turnNumber === 0`) steps c–f are skipped for every seat** — nobody collects income before they have played once (campaign level 1 starts with 1 gold and income 2 and stays at 1 gold until the human's second turn; `wt-0005`).
   a. Clear selection and the undo stack; after step f, store `state.turnStart` = the core state (undo replays `history` from it).
   b. Flag every unit of `P` `readyToMove = true`.
   c. "Next day…" banner (cosmetic, driven by engine events): for every province of `P`, `gold = max(0, gold + income − upkeep)`; floating `+N`/`−N` numbers at the city.
   d. **Bankruptcy**: any province of `P` whose pre-floor total was negative — every unit in it dies → grave.
   e. **Starvation**: any unit of `P` with zero same-owner neighbours dies, no grave.
   f. **Grave aging**: every grave owned by `P` increments its age; age reaching 2 auto-converts it to a grass field.
2. **`P` acts**: any sequence of MOVE / ATTACK / CLEAR / MERGE / BUY / UNDO, each validated and applied by `apply()`, until `END_TURN`.
3. **Turn end**: force every unit's `readyToMove = false`; clear the undo stack.
4. **Elimination check** (§3.7).
5. **Win check**; else advance to the next non-eliminated seat and repeat from step 1. Advancing from the highest seat back to seat 0 increments `turnNumber` (the "day" counter shown as "Level: N" is the *level id*, unrelated — see Vocabulary).

---

## 4. Architecture

Hexagonal, matching the siblings, with the engine held to the same purity
standard `super-smash` uses for its simulation.

```
src/
  engine/          pure, deterministic TypeScript — the ONLY place game rules live
    types.ts        GameState, Action, MapDefinition, all shared types — published FIRST
    index.ts        the public API — published FIRST, alongside types.ts
    rules.ts         defence, legality checks
    reducer.ts        apply(state, action) -> { state, events, error? }
    provinces.ts     detect / split / merge (§3.3)
    moveZone.ts        4-step flood fill
    ai/               two-phase greedy heuristic (§ genealogy 4, adapted)
    generator/        random map generator (§ genealogy 3, adapted)
    prng.ts            seeded PRNG (mulberry32 or xorshift — no Math.random)
    serialize.ts      GameState <-> JSON, MapDefinition <-> JSON
    layering.test.ts   forbids imports from render/game/components/app/ports/adapters/content and react/next; forbids Math.random, Date.now, performance.now, new Date, crypto.*
  render/          canvas painters, code-drawn pixel-art sprite atlas — no image assets
  game/            the client session runner
    sessionConfig.ts  zustand store: how a session was configured — published SECOND
    session.ts        turn loop, undo stack, AI animation queue, autosave hook
    input.ts           pixel -> tile, gesture handling
    tutorialTriggers.ts  the fixed set of tutorial trigger ids S2 emits and S3 scripts against
  components/
    game/            in-game HUD, shop cards, info card, strength chart, pause/settings
    menu/            title, overworld, level intro, mode setup screens
    editor/          map editor toolbox
  app/
    (menu)/          title, campaign overworld, level intro
    play/            campaign/custom/session play routes (§7)
    random/ hotseat/ challenges/ editor/ maps/  setup + share screens
    api/             route handlers (§6)
  ports/           persistence interfaces (maps, challenge records, local progress/settings)
  adapters/
    db/              pglite.ts, neon.ts, index.ts, driver.ts, schema.sql/.ts — same shape as Linear
    localStorage/    progress.ts, settings.ts
  content/
    levels/          12 MapDefinition literals + tutorial scripts
    overworld.ts     node layout for the campaign map
```

### 4.1 Published contracts — already in the repository

These files exist and typecheck **before any slice starts**; they are the exact contracts, and this document defers to them wherever prose and code differ:

| File | Owner after publication | Contents |
|---|---|---|
| `src/engine/types.ts` | S1 (additive changes only, announced) | `MapDefinition`, `TileDefinition`, `PlayerSlotDefinition`, `TutorialStep`, `TutorialTriggerId` (exhaustive union), `MapSummary`, `GameState`, `GameStateCore`, `RuntimeTile`, `Province`, `PlayerState`, `Action`, `BuyItem`, `EngineEvent`, `ApplyResult`, `GeneratorOptions`, `MapSize`, `MAP_SIZE_DIMENSIONS`, `PLAYER_COLOURS`, and `RULES` (every number in §3.2) |
| `src/engine/index.ts` | S1 | the public API below, stubbed to throw until implemented; also `legalBuildZone(state, item)` |
| `src/game/sessionConfig.ts` | S2 | zustand `useSessionConfig` store with `SessionConfig`, `MapSource` (`campaign` / `custom` / `generated` / `challenge`), `SeatConfig` |
| `src/game/tutorialTriggers.ts` | S2 | `TUTORIAL_TRIGGERS` — when each `TutorialTriggerId` fires |
| `src/ports/settings.ts`, `src/ports/localProgress.ts`, `src/ports/maps.ts` | S4 | `SettingsPort`, `ProgressPort`, `MapsRepository` interfaces |
| `src/adapters/localStorage/settings.ts`, `src/adapters/localStorage/progress.ts` | S4 | `localSettings`, `localProgress` — guarded localStorage implementations, usable by S2/S3 today |
| `src/adapters/db/*`, `src/config/env.ts`, `scripts/*` | S4 | PGlite/Neon adapters carried over from Linear; `schema.sql` (extend, do not recreate) |

### The engine contract

```ts
function apply(state: GameState, action: Action): { state: GameState; events: EngineEvent[]; error?: string };
```

Same four rules `super-smash` enforces, applied to this domain:
1. No `Math.random` — only `nextRandom(state.rng.seed)`, whose seed lives in `GameState`.
2. No `Date.now`/`performance.now` — the engine has no notion of wall-clock time at all.
3. No DOM/React/Next/render/game/components/app/ports/adapters/content imports.
4. No mutation of the input state — `apply` returns a new `GameState`; the caller owns both.

`EngineEvent` (analogous to super-smash's `StepEvents`) drives every cosmetic effect — coin flight, floating numbers, capture flash, grave fade, city-destroy crumble — without any of that entering `GameState`:

```ts
type EngineEvent =
  | { type: "income"; provinceId: string; amount: number }
  | { type: "upkeepPaid"; provinceId: string; amount: number }
  | { type: "bankrupt"; provinceId: string }
  | { type: "starved"; at: TileCoord }
  | { type: "graveAged"; at: TileCoord; nowField: boolean }
  | { type: "captured"; at: TileCoord; from: number | null; to: number }
  | { type: "cityDestroyed"; provinceId: string; owner: number }
  | { type: "provinceSplit"; parentId: string; fragmentIds: string[] }
  | { type: "provinceMerged"; survivingId: string; absorbedIds: string[] }
  | { type: "merged"; at: TileCoord; newLevel: 1 | 2 | 3 | 4 }
  | { type: "chestCollected"; at: TileCoord; amount: number }
  | { type: "eliminated"; player: number }
  | { type: "gameOver"; winner: number };
```

### `MapDefinition` (exact schema)

```ts
type Biome = "grass" | "desert" | "snow";
type Terrain =
  | "grass" | "sand" | "snow" | "water" | "bridge"
  | "grassField" | "grave"
  | "forestPine" | "forestPalm" | "forestIcePine" | "mountain";
type Building = "city" | "farm" | "mine" | "chest" | "woodwall" | "stoneTower";
type PlayerColour = "red" | "blue" | "green" | "yellow" | "purple" | "orange" | "teal" | "pink";
type Difficulty = "easy" | "normal" | "hard";

interface TileDefinition {
  terrain: Terrain;
  owner: number | null;              // index into players[], or null
  building: Building | null;
  unit: { level: 1 | 2 | 3 | 4 } | null;
  decoration: "rock" | "flowerWhite" | "flowerPurple" | "bush" | "tree" | null;
  road: boolean;                      // cosmetic overlay, independent of terrain
  graveAge?: 0 | 1;                   // present only when terrain === "grave"
}

interface PlayerSlotDefinition {
  index: number;                      // 0..7, also the seat/colour order
  colour: PlayerColour;
  kind: "human" | "ai" | "empty";     // "empty" only valid pre-game (random/hotseat setup)
  startGold: number;
}

interface TutorialStep {
  triggerId: string;                  // one of src/game/tutorialTriggers.ts's fixed ids, e.g. "turnStart:0", "unitSelected:first", "attackBlocked:wall"
  text: string;                       // upper-case speech-bubble copy
  highlightTile?: { x: number; y: number };
}

interface DifficultyTuning {
  aiStartGoldMultiplier: number;      // default table: easy 0.5, normal 1, hard 1.5
}

interface MapDefinition {
  id: string | null;                  // null for an unsaved editor draft; a nanoid once persisted
  name: string;
  author: string;                     // free-text display name, no accounts
  width: number;                      // 6..40
  height: number;                     // 6..40
  biome: Biome;
  tiles: TileDefinition[];            // length === width*height, row-major: index = y*width + x
  players: PlayerSlotDefinition[];    // 2..8
  tutorial: TutorialStep[];           // [] for non-tutorial maps
  difficulty: Record<Difficulty, DifficultyTuning> | null; // null for non-campaign maps
}
```

### `GameState` (exact shape)

```ts
interface RuntimeTile {
  x: number; y: number;
  terrain: Terrain;
  owner: number | null;
  building: Building | null;
  unit: { level: 1 | 2 | 3 | 4; readyToMove: boolean } | null;
  decoration: TileDefinition["decoration"];
  road: boolean;
  graveAge: number;
  provinceId: string | null;          // null for water/forest/mountain/unowned AND for lone tiles
}

interface Province {
  id: string;
  owner: number;
  tileKeys: string[];                 // "x,y", stable order = discovery order
  city: { x: number; y: number };
  gold: number;
}

interface PlayerState {
  index: number;
  colour: PlayerColour;
  kind: "human" | "ai";
  aiDifficulty: Difficulty | null;
  eliminated: boolean;
}

interface GameState {
  width: number; height: number; biome: Biome;
  tiles: RuntimeTile[];               // row-major, width*height
  provinces: Record<string, Province>;
  players: PlayerState[];
  activePlayerIndex: number;
  turnNumber: number;                 // increments when the active seat wraps to 0
  rng: { seed: number };
  history: Action[];                  // this turn only; cleared on END_TURN
  outcome: { winner: number } | null;
}
```

### `Action` union (exact)

```ts
type TileCoord = { x: number; y: number };

type Action =
  | { type: "MOVE"; unitAt: TileCoord; to: TileCoord }
  // reducer classifies `to` by contents: empty own tile -> reposition (stays ready);
  // own grass field/grave -> clear (ends turn); own unit -> merge (§3.4);
  // enemy/neutral tile -> attack if strength > defence, else rejected (ends turn on success)
  | { type: "BUY"; item: "knight1" | "knight2" | "knight3" | "knight4" | "woodwall" | "stoneTower" | "farm"; at: TileCoord }
  // knightN on an empty own tile = peaceful build; knightN on an adjacent capturable tile the new
  // knight can beat = attack-buy (any level, cost 10·N — the original's shop sells every level directly,
  // D41); knightN on a tile holding the buyer's own unit = merge-buy (§3.5); woodwall/stoneTower/farm
  // are legal only on an empty tile the buyer already owns
  | { type: "UNDO" }
  | { type: "END_TURN" };
```

Selection, hover, and camera are **not** engine concerns — they live in `src/game/session.ts` and the zustand `sessionConfig`/UI stores, exactly as super-smash keeps live simulation state out of its `matchConfig` store.

### Engine public API (`src/engine/index.ts`)

```ts
export function createInitialState(map: MapDefinition, seed: number): GameState;
export function apply(state: GameState, action: Action): { state: GameState; events: EngineEvent[]; error?: string };
export function legalMoveZone(state: GameState, from: TileCoord): TileCoord[];
export function defenceNumber(state: GameState, at: TileCoord): number;
export function provinceAt(state: GameState, at: TileCoord): Province | null;
export function isGameOver(state: GameState): boolean;
export function aiTakeTurn(state: GameState, playerIndex: number, seed: number): { actions: Action[]; nextSeed: number };
export function generateRandomMap(options: GeneratorOptions, seed: number): MapDefinition;
export function validateMap(map: MapDefinition): { valid: boolean; errors: string[] };
export function serializeState(state: GameState): string;
export function deserializeState(json: string): GameState;
export function serializeMap(map: MapDefinition): string;
export function deserializeMap(json: string): MapDefinition;
```

---

## 5. Data flow

**Starting a campaign level.** `/play/campaign/[levelId]` (client) loads the level's `MapDefinition` with a **per-id dynamic import** (`await import(\`@/content/levels/${levelId}\`)` through `src/content/levels/index.ts`'s loader map — never a barrel import, so one level's tiles never ship with another's page; works with an empty DB) → `createInitialState(map, seed)` → `session.ts` holds `GameState` in a ref, mirrors UI-observable slices (selection, shop mode, active tutorial step) into a zustand store → if `tutorial[0].triggerId === "levelIntro"`, show it before turn 1.

**A human turn.** Tap → `input.ts` converts canvas pixel to integer tile coords (no rounding ambiguity, unlike a hex grid) → dispatch a UI-only `SELECT` → `legalMoveZone()` renders lit/dim overlay → tap destination → `apply(state, {type:"MOVE"|"BUY", ...})` → new `state` + `events`; `events` drive floating numbers/flashes in `render/`; `history` grows; UNDO enables → repeat → NEXT DAY → `apply(state, {type:"END_TURN"})`, whose internal turn-start pipeline (§3.8 step 1) for the *next* seat runs inside the same `apply` call and returns its events for the "Next day…" banner animation.

**An AI turn.** When `activePlayerIndex` becomes an AI seat, `session.ts` calls `aiTakeTurn(state, idx, seed)` once, synchronously (pure, fast, no timers) — it returns the whole turn's ordered `actions[]` (ending in `END_TURN`). The runner then replays them one at a time through `apply()` on an animation queue (~300ms between actions), repainting after each, while UNDO/NEXT DAY stay disabled and the HUD recolours to the AI's seat colour.

**Saving/loading a custom map.** Editor builds a `MapDefinition` in a zustand editor store → `validateMap()` client-side for instant feedback → Save → `POST /api/maps` (zod-validated at the boundary) → `db.insert` returns `{id}` → navigate to `/maps/[id]`. Loading: `/maps/[id]` (server component) → `GET`-equivalent repository call → hydrate → "Play" routes to `/play/custom/[id]`, which fetches the same row via `/api/maps/[id]`.

**Weekly challenge selection.** A pure function, `src/content/weekly.ts:selectWeeklyChallenge(date, pool)`: compute the ISO week (`isoYear`, `isoWeek`) from `date` → seed a PRNG with `isoYear * 100 + isoWeek` → deterministically pick 3 distinct ids from `pool` (the 7 non-tutorial seeded levels **plus every community map in the `maps` table**, ordered by id — see D24; no eligibility flag, no created-at pinning in v1). `GET /api/challenges/current` calls this with `new Date()` and the current pool, so **nothing is stored per-week** — every visitor in the same ISO week gets the same 3 maps, recomputed on every request. Medals are stored per device in `localProgress` (`challengeMedals["<isoYear>-W<isoWeek>:<mapId>"]`); there is no server-side record (D26). Countdown to next Monday 00:00 UTC is computed client-side from `Date.now()`.

**Hot-seat hand-off.** After `END_TURN`, if the next seat is human and ≥2 human seats are configured, `session.ts` shows a full-screen "Player {colour}'s turn — pass the device" overlay (tap to reveal) before rendering the board, then proceeds exactly as a human turn.

---

## 6. HTTP surface

All route handlers validate input with `zod` at the boundary and never let a schema/DB error escape unformatted.

| Route | Method | Body / Query | Response | Errors |
|---|---|---|---|---|
| `/api/maps` | POST | `MapDefinitionInput` (zod, minus `id`) | `201 { id }` | `400` bad schema · `422 { errors: string[] }` failed `validateMap` |
| `/api/maps` | GET | `?cursor=&limit=20` | `{ maps: MapSummary[]; nextCursor: string \| null }` | `400` bad query |
| `/api/maps/[id]` | GET | — | `MapDefinition` | `404` |
| `/api/challenges/current` | GET | — | `{ weekKey: string; weekStart: string; weekEnd: string; maps: MapSummary[] }` — seeded picks carry ids `seed:<levelId>` and are served by `/api/maps/[id]` too | never (pure, no DB write) |

```ts
// zod (illustrative, not exhaustive)
const TileDefinitionSchema = z.object({ terrain: z.enum([...]), owner: z.number().int().nullable(), building: z.enum([...]).nullable(), unit: z.object({ level: z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)]) }).nullable(), decoration: z.enum([...]).nullable(), road: z.boolean(), graveAge: z.union([z.literal(0),z.literal(1)]).optional() });
const MapDefinitionInputSchema = z.object({ name: z.string().min(1).max(60), author: z.string().min(1).max(40), width: z.number().int().min(6).max(40), height: z.number().int().min(6).max(40), biome: z.enum(["grass","desert","snow"]), tiles: z.array(TileDefinitionSchema), players: z.array(PlayerSlotDefinitionSchema).min(2).max(8), tutorial: z.array(TutorialStepSchema), difficulty: DifficultyTableSchema.nullable() }).refine(m => m.tiles.length === m.width * m.height, "tiles length must equal width*height");
```

### DB tables (Postgres — PGlite locally, Neon in production; same driver-selection/guard pattern as Linear, §4 architecture)

```sql
create table maps (
  id text primary key,                 -- nanoid; PGlite has no pgcrypto, so ids are generated in application code, never gen_random_uuid()
  name text not null,
  author text not null,
  width integer not null,
  height integer not null,
  biome text not null,
  definition jsonb not null,           -- the full MapDefinition (tiles/players/tutorial/difficulty)
  created_at timestamptz not null default now()
);
create index maps_created_at_idx on maps (created_at desc);

```

---

## 7. Screens

| Route | Screen | Owner slice |
|---|---|---|
| `/` | Title / main menu | S3 |
| `/campaign` | Overworld: path with nodes + direct tap-to-jump on any unlocked node, stars per node, avatar walk animation on sequential advance | S3 |
| `/campaign/[levelId]/intro` | Level intro: difficulty picker (Easy/Normal/Hard), "Start" | S3 |
| `/play/campaign/[levelId]` | In-game: canvas board; HUD bar coloured by the acting player with income ⊕ and gold ◎; shop cards (yellow affordable / red unaffordable; the four knight cards with green BUY when a unit is selected); info card on tap; **shield/defence badges in the defender's colour on every capturable tile of `legalMoveZone()` while a unit is selected**; lit/dim move highlight; **"<" back button bottom-left while anything is selected**; HELP! strength chart; gear; UNDO; NEXT DAY; "Level: N"; tutorial speech bubbles; "Next day…" banner with coin flight and floating ±N; pause/settings modal; victory/defeat modal with stars | S2 |
| `/play/custom/[mapId]` | Same in-game screen, sourced from `/api/maps/[id]` — used by editor "Play" and the custom-map share flow | S2 (screen) + S4 (data fetch) |
| `/play/session` | Same in-game screen, sourced from the client `sessionConfig` store — used by random and hot-seat, whose maps are generated/configured just-in-time and not persisted | S2 |
| `/random` | Random map setup: size (S/M/L), 2–8 seats each human/AI, difficulty, seed | S5 |
| `/hotseat` | Hot-seat setup: 2–8 seats of which **at least the first two are human** (locked); further seats may be AI; colours; then a "Player X's turn" hand-off screen at every human-to-human turn boundary | S5 |
| `/challenges` | Weekly challenges list: 3 wood-panel cards (creator, ID, thumbnail, 3 medal dots, countdown, Play) | S4 |
| `/editor` | Map editor: terrain/biome brush, place city/unit/building/decoration, set owner, player count, name, validate, save | S4 |
| `/maps/[id]` | Custom map share page: preview, author, "Play" | S4 |

**Pause/settings** is a modal, not a route, reachable from the gear icon on any in-game screen; it reads/writes `src/ports/settings.ts` (one-click-move, music, sound), shared by S2 and S3 (see §12 shared contracts).

**Desktop and mobile**: the canvas board supports mouse drag-to-pan + wheel-to-zoom on desktop and touch drag-pan + pinch-to-zoom on mobile; the HUD bar is fixed-height at the bottom on both, sized for a 44px minimum touch target; menu/overworld/editor screens reflow to a single column under 768px.

---

## 8. Visual design

Pixel art on canvas, code-drawn — no image assets (there is no legitimate way to obtain HBRZ's art, and `super-smash` set the precedent). Every colour below was **measured** from the store screenshots by the visual-research lane (`research/05-visual-design.md`); where the game has more than one UI generation, the 2025 look wins.

- **Native resolution**: every tile, building and unit is drawn once onto a **32×32 px offscreen canvas** (units may overflow upward by up to 8 px for heads/plumes) and blitted with `imageSmoothingEnabled = false`. Outlines are the warm near-black `#1A1010`, never pure black.
- **Camera / zoom**: continuous, not stepped. `camera.tilePx` ranges **48 → 160 px** on desktop (default 96) and **56 → 200 px** on phones (default 128, ~6 tiles across a 390 px viewport, matching the measured 5–11 tiles across a phone width). Pinch/wheel changes `tilePx`; drag pans; the map is clamped so at least one tile stays on screen. The `render/` layer blits the 32 px sprites at `tilePx/32` (fractional allowed — the source is already crisp and the blit stays nearest-neighbour).
- **Grid lines**: 1 px per 32 native px (scaled), drawn in a darker, slightly desaturated version of the ground fill (grass `#8DAD3A`, desert `#C39A5C`, snow `#C2C2C2`) — never a neutral grey.
- **Territory borders**: beads along the tile edges bounding each owner's land — filled circles of ~3 native px in the owner's colour with a 1 px `#1A1010` outline, 4 beads per tile edge, inset 1 px into the owner's tile. Two owners touching get two parallel bead rows, one on each side of the edge.
- **Shield badges**: rounded-top pentagon (~12 native px wide) in the defender's colour with a 1 px outline and a white number, drawn as a UI overlay above the tile centre while a unit is selected.
- **Move highlight**: reachable tiles keep full colour and get a dotted white-in-`#1A1010` frame; every other tile gets a `rgba(0,0,0,0.30)` wash.

### Palette (measured)

| Element | Colour |
|---|---|
| Grass fill / grid | `#B0D848` / `#8DAD3A`; fleck `#586C24` |
| Grass field (mowed patch) | `#99D333`, border darker 20% |
| Desert fill / grid | `#F4BF73` / `#C39A5C` |
| Snow fill / grid | `#F2F2F2` / `#C2C2C2` |
| Water / shading | `#2898F0` / `#1453BB`; snow-biome icy water `#D5EFFE`; beach fringe `#F0CE70` |
| Road / bridge planks | `#F0CE70`; wood `#A28444` / `#7D4F1F` / `#C08A4F` |
| Pine canopy / shadow / highlight / trunk | `#209058` / `#1F5847` / `#60C05F` / `#502820` (palm: same greens on a `#7D4F1F` trunk with fan fronds; ice-pine: `#9FD3E8` / `#5E9BC2`) |
| Mountain mid / highlight / shadow (all biomes) | `#A86061` / `#BF806F` / `#784049` |
| Stone light / mid / dark | `#AFB9D2` / `#838A9C` / `#4D525E` |
| Gold coin | `#FED942` face, `#D7A800` rim |
| Grave | `#AFB9D2` stone, `#4D525E` shadow, mound `#8DAD3A` |
| Outline (everything) | `#1A1010` |
| Text | white `#FFFFFF` fill, `#1A1010` 2 px outline |
| HUD bar (acting player's colour, darkened 15%) | blue `#3D4FC4`, red `#C6293B` … per player table |
| BUY / OK / Play green | `#228F00` |
| Unaffordable red | `#DF2607` |
| Card yellow | `#F6D83C`, card cream `#F1E2B2`, khaki border `#E3C798` |
| Wood panel (challenge cards, dialogs) | `#804A1D` / `#A1632D` |
| Sky / menu background | `#2898F0` |

### Player colours (8, fixed seat order)

`blue #337DF8` · `red #C6293B` · `green #52C73F` · `yellow #F2C531` · `purple #8E44AD` · `pink #DE26D3` · `orange #F07C2A` · `grey #595959` — blue/red/green/pink/grey measured on screen; yellow/purple/orange chosen for hue separation (D20). Seat 0 is blue (the human in every campaign level), seat 1 red, seat 2 green, matching the levels seen.

### Type

**Pixelify Sans** (Google Fonts, self-hosted via `next/font/google` in `src/app/layout.tsx`, variable `--font-pixel`), weight 700 for HUD numbers and headings, all caps in HUD/banners; white fill with a `#1A1010` outline via a four-direction `text-shadow` stack (`-2px -2px 0, 2px -2px 0, -2px 2px 0, 2px 2px 0`). In-canvas text (floating numbers, shield digits) uses the same face through `ctx.font` with a stroked outline.

### How each element is drawn (code, 32×32 native)

| Element | Construction |
|---|---|
| Grass/sand/snow tile | flat fill + 4–6 seeded fleck pixels in the fleck colour + optional decoration |
| Water | flat fill, 1 px `#1453BB` wave dashes that shift every 500 ms (2 frames); beach fringe drawn on edges adjacent to land |
| Forest | 4 overlapping pine triangles (2 rows) with a `#1F5847` shadow lobe and `#60C05F` fleck, trunks 2×3 px; palm = 5 fronds from a top point; ice-pine = same shape in the ice palette |
| Mountain | 3 stacked rounded boulders (mid), 2 px highlight on the upper-left of each, `#784049` crevices between |
| Grass field | base tile + an inset 24×24 rounded square in `#99D333` with a 1 px darker border |
| Grave | 8×10 rounded-top tombstone in stone light/mid with a cross scratch, on a 12×4 mound |
| Farm | 12×10 house (wall `#C08A4F`, roof `#C6293B` on grass, `#7D4F1F` on desert, `#5E9BC2` on snow) beside two `#FED942` hay bales |
| Mine | mountain boulder with a 6×6 `#1A1010` doorway and two gold ore pixels |
| Chest | 14×10 `#A28444` box, `#7D4F1F` lid band, `#FED942` clasp |
| Woodwall | 5 vertical planks with pointed tops (`#C08A4F`, `#7D4F1F` shading), a cross brace, a small shield in the owner's colour |
| Stone tower | 12×24 tapered body (stone mid), 3 crenels (light), 1 dark window slit, owner-colour pennant |
| City | 3-house cluster; roofs in the owner's colour, walls `#F1E2B2`, a 1 px path between; snow biome uses white walls, desert uses tents for the "stone-age" skin |
| Knight L1 | 10×16 figure: skin `#E8B48A`, shirt in owner colour, brown trousers, no gear |
| Knight L2 | + a spear (2 px shaft, light tip) and a small round shield in owner colour |
| Knight L3 | + a `#AFB9D2` helmet and a kite shield |
| Knight L4 | + a plume in owner colour, full armour (`#838A9C` torso), longsword |
| Bridge | 6 plank rows across the water tile in bridge wood, 1 px rails |

Enemy units use the same sprites tinted with their owner's colour; the sprite atlas is keyed by `(kind, ownerColour, biome)` and rasterised lazily.

### Animation list

Unit slide (150 ms) · capture flash (200 ms in the attacker's colour, then the loser vanishes) · coin flight (coin sprites arc from income tiles to the city, 400 ms, staggered 40 ms) · floating `+N`/`−N` (rise 16 px and fade over 600 ms) · "Next day…" banner (slide in, hold 500 ms, slide out) · bankruptcy (units fade to graves, 300 ms) · grave→field fade (400 ms) · city crumble (250 ms shake + fade) · shield badge pop (100 ms) on selection · move-zone wash cross-fade (100 ms) · AI action highlight (camera nudge toward the acting tile + the same move/capture animations) · victory stars pop-in (150 ms each) · idle unit bob (1 px, 1 s period) for units that are still `readyToMove`.

## 9. Controls

| Action | Mouse / touch | Keyboard |
|---|---|---|
| Select a unit / tile | Click / tap | — |
| Move / attack | Click / tap a lit destination after selecting | — |
| Deselect | The "<" button (bottom-left, visible while anything is selected), or click / tap empty space | `Esc` |
| Pan | Drag | `←→↑↓` / `WASD` |
| Zoom | Wheel / pinch | `+` / `-` |
| Undo | UNDO button | `Z` |
| Next day | NEXT DAY button | `Enter` |
| One-click attack (setting ON) | Tap an adjacent enemy tile directly | — |

Touch and mouse share one input path in `src/game/input.ts`; keyboard shortcuts are additive and never required (mobile has none of them).

---

## 10. Efficiency plan

- The whole engine (`src/engine/**`, including AI and the map generator) is a pure, synchronous TypeScript module — `state → state`, no React, no DOM, enforced by the layering test (§4). A full AI turn or a map generation call runs in well under a frame budget's worth of wall time even on a modest device, because it is plain object/array manipulation with no allocation-heavy abstractions.
- Sprites are **pre-rasterised once per `(shape, colour)` pair into offscreen canvases** at the resolved integer scale, then blitted — a 40×40 map (the largest allowed) redraws in low single-digit milliseconds.
- Rendering uses a **dirty flag**: the board only repaints when `GameState` reference-changes (every `apply()` call) or the camera moves, never on an idle timer.
- Every turn is resolved **entirely client-side** — no server round-trip during play. The only network calls are: loading a custom/weekly `MapDefinition` once, saving an editor map once, and posting a challenge medal once.
- Vercel serves static assets plus five tiny API routes; there is no per-turn server compute.

---

## 11. Testing

- **Unit** (`vitest`) — one fixture file per rule area under `src/engine/*.test.ts`: economy (farm escalation, upkeep, bankruptcy floor), defence/attack (strict-greater, self-only vs. projecting), movement (4-step budget, chained repositioning, blocked terrain), merge (level cap, readiness propagation), province split/merge (largest-fragment treasury, city tie-break, lone-tile behaviour), turn sequence (grave aging, starvation).
- **Property** (`fast-check`) — province invariants (every tile's `provinceId` points to a province that actually contains it; every province has ≥2 tiles and exactly one city; treasuries never go negative) hold after any sequence of valid random actions; `apply()` is deterministic (same state + action + seed ⇒ byte-identical output, twice); `generateRandomMap` is deterministic per seed and always produces a connected landmass ≥25% of the bounded area with every seat given a starting province.
- **AI** — a Normal-difficulty AI never ends its own turn bankrupt on any of the 12 seeded levels, run to completion 50× with different seeds; every seeded campaign level is winnable on Easy by a scripted action sequence (recorded as a fixture) or, at minimum, is a fully `validateMap`-clean map.
- **Integration** (`vitest` + PGlite in-memory) — every `/api/**` route against a real embedded Postgres: create/list/get a map, current-week challenge selection is stable within an ISO week and changes across the boundary, medal recording is idempotent per `(mapId, deviceId, difficulty)`.
- **Perf** (vitest): 200 captures with province re-flood on a 40×40 map with 8 seats complete in < 200 ms; UNDO of a 30-action turn < 20 ms; `aiTakeTurn` on a 26×26 map < 100 ms.
- **E2E** (Playwright; every spec reads truth through `window.__islandDebug.state()` and polls it rather than sleeping past animations; AI seeds are fixed through the setup screen's seed field):
  - `e2e/campaign.spec.ts` (S2) — tutorial level 1 to victory through the real UI, on **both** `desktop-chrome` and `mobile-chrome`; UNDO restores the previous state.
  - `e2e/touch.spec.ts` (S2) — mobile-chrome only: pinch-zoom and drag-pan change the camera, tap-select → tap-attack captures a tile.
  - `e2e/random.spec.ts` (S5) — random map vs one AI with seed 42 runs 20 turns with no thrown error or stuck state; hot-seat with two humans shows the hand-off screen at the boundary.
  - `e2e/editor.spec.ts` (S4) — the editor saves a map, it loads at `/maps/[id]`, Play starts it, and `/challenges` lists three maps with a countdown.
  - `e2e/screenshots.spec.ts` (parent, after integration) — captures into `docs/screenshots/` gated by `CAPTURE=1`, following `super-smash/e2e/screenshots.spec.ts`.
- **`window.__islandDebug`** (exposed only outside production, mirroring `super-smash/e2e/helpers.ts`'s `__smashDebug`):
  ```ts
  interface IslandDebug {
    state(): GameState;                 // the live GameState, for assertions that don't trust pixels
    applyForTest(action: Action): void; // bypass animation, for fast e2e setup
  }
  ```
  e2e specs read game truth through this handle, never by pixel-sampling the canvas, and re-declare routes/selectors locally rather than importing `src/`, per `super-smash/e2e/helpers.ts`'s documented reasoning.

---

## 12. Work-stream decomposition

Five disjoint slices. **S1 publishes `src/engine/types.ts` and `src/engine/index.ts` as its very first commit**, and **S2 publishes `src/game/sessionConfig.ts` and `src/game/tutorialTriggers.ts` immediately after** (both stub-implemented, fully typed) — every other slice compiles against these two contracts from day one without needing S1/S2 to be feature-complete.

| Slice | Owns | Depends on | Acceptance criteria |
|---|---|---|---|
| **S1 — Engine** | `src/engine/**` (incl. `ai/`, `generator/`), its tests | nothing | `apply()` implements every rule in §3 with the fixtures/property tests in §11 green; `layering.test.ts` passes; `aiTakeTurn` never bankrupts a Normal AI province on its own turn (50-seed sweep); `generateRandomMap` always produces a valid, connected, fairly-seated map |
| **S2 — Render + game runner + in-game screen** | `src/render/**`, `src/game/**`, `src/components/game/**`, `src/app/play/**`, `e2e/campaign.spec.ts`, `e2e/touch.spec.ts`, `e2e/helpers.ts` | S1's `engine/types.ts`, `engine/index.ts` | Canvas board renders every terrain/building/unit per §8 at any integer scale; HUD matches §7's element list exactly; AI turns animate legibly; UNDO/NEXT DAY work; `window.__islandDebug` exposed in non-production builds |
| **S3 — Content: 12 seeded levels + tutorials + overworld + menus** | `src/content/**`, `src/app/page.tsx` (replace the placeholder), `src/app/layout.tsx`, `src/app/globals.css`, `src/app/campaign/**`, `src/components/menu/**`, `src/components/ui/**` | S1's types, S2's `sessionConfig.ts`/`tutorialTriggers.ts` | 12 `MapDefinition`s pass `validateMap`; 5 tutorial levels' `TutorialStep[]` reference only ids S2 actually emits; overworld shows sequential walk + tap-to-jump with correct unlock/star state read from `ports/localProgress.ts` |
| **S4 — Persistence + API + editor + custom maps + weekly challenges** | `src/ports/**`, `src/adapters/**`, `src/app/api/**`, `src/app/editor/**`, `src/app/maps/**`, `src/app/challenges/**`, `src/components/editor/**`, `src/lib/weekly.ts`, `scripts/db-push.ts`, `schema.sql`, `e2e/editor.spec.ts` | S1's types (`MapDefinition`, `validateMap`) | All five routes in §6 pass their zod schema + PGlite integration tests; editor produces a `validateMap`-clean map and round-trips through save/load; weekly selection is deterministic per ISO week (property test) |
| **S5 — AI setup + generator screens + hot-seat** | `src/app/random/**`, `src/app/hotseat/**`, `src/components/setup/**`, `e2e/random.spec.ts` (screens only — the AI/generator *engine code* is S1's) | S1's `generateRandomMap`, `aiTakeTurn` types; S2's `sessionConfig.ts` | Random setup writes a valid `sessionConfig` for 2–8 seats and any size; hot-seat's hand-off screen appears at every human-to-human turn boundary; a full random match vs. AI runs to completion via `/play/session` |

**Not owned by any slice** (the parent integrates them last): `README.md`, `docs/screenshots/`, `e2e/screenshots.spec.ts`, the root `Replicates/README.md` section and the Wikipedia article.

**Integration order**: S1 first (types + a minimal working `apply`/`generateRandomMap`/`aiTakeTurn`, even before full rule coverage) → S2's `sessionConfig.ts`/`tutorialTriggers.ts` stubs land immediately after → S2, S3, S4, S5 proceed in parallel, each compiling against the two published contracts; final integration is wiring S3/S5's screens to actually populate `sessionConfig` and navigate to S2's `/play/**` routes, and S4's editor/`maps` screens to call S1's `validateMap`.

---

## 13. Out of scope

Online/networked multiplayer, in-app purchases, ads, an unlockable-skin monetisation economy, the "King"/"Superiority" win condition (undocumented mechanics — genealogy has no equivalent and the brief only confirms the UI exists), Battle Mode / Card Mode (never independently confirmed to exist — `02-modes-maps-editor.md` §"Random Maps"), more than 12 campaign levels or more than one island, cloud accounts, sign-in, cross-device sync, a leaderboard beyond per-map medal storage, tree/field spreading over time, diagonal adjacency anywhere, fog of war, replays, spectating, localization beyond English.
