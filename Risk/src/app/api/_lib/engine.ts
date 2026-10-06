import "server-only";

import * as engine from "@/engine";
import * as bots from "@/engine/bots";
import type { GameView, TurnPlan } from "@/engine/bots";
import * as odds from "@/engine/odds";
import type {
  Action,
  ActionKind,
  ApplyResult,
  AttackIntent,
  BotPersona,
  BotTier,
  DiceMode,
  GameConfig,
  GameState,
  MapDef,
  MapFile,
  OddsTables,
  Rng,
  RngPurpose,
  RuleError,
  Seat,
  TerritoryId,
} from "@/engine/types";
import { loadMapFile } from "@/content/maps";

/**
 * The server's seam onto the engine (SPEC §12, S5's "stubs" row).
 *
 * Every engine function a route handler calls is named here, once, and bound
 * from the real barrels by {@link realServerEngine}. The point is not
 * abstraction for its own sake: `apply`, `validate`, `hashState`, the
 * resolvers, `createOdds`, `decideTurn` and `loadMapFile` all **throw
 * "pending"** while S1, S2 and S3 build them, and the transaction, the
 * idempotency fence, the `204` path, the lazy tick and the seat-takeover
 * logic are all provable without any of the real rules. A route test injects
 * a counter-state `apply`, a fixed `hashState`, a `rollAttack` that returns
 * fixed dice and a `decideTurn` that returns a one-action plan, and proves
 * the plumbing on PGlite `:memory:`.
 *
 * It is also where the two engine-adjacent concerns that are genuinely the
 * server's live: resolving a slug to a `MapDef` (memoised per slug per
 * process, §5.1) and holding one `OddsTables` per dice mode.
 */

export interface ServerEngine {
  // ---- the rules ----
  createInitialState(
    map: MapDef,
    started: Extract<Action, { type: "GAME_STARTED" }>,
  ): GameState;
  apply(state: GameState, map: MapDef, action: Action): ApplyResult;
  validate(state: GameState, map: MapDef, action: Action): RuleError | null;
  legalActions(state: GameState, map: MapDef, seat: Seat): readonly ActionKind[];
  legalDraftTargets(state: GameState, seat: Seat): readonly TerritoryId[];
  viewFor(state: GameState, map: MapDef, seat: Seat): GameState;
  hashState(state: GameState): string;
  isGameOver(state: GameState): boolean;

  // ---- randomness: the resolver and the one PRNG entry point ----
  rngFor(seed: string, purpose: RngPurpose, turn: number): Rng;
  dealTerritories(
    map: MapDef,
    config: GameConfig,
    personas: readonly (BotPersona | null)[],
    rngs: { deal: Rng; turnOrder: Rng; modifierPlace: Rng },
  ): Extract<Action, { type: "GAME_STARTED" }>;
  rollAttack(
    state: GameState,
    map: MapDef,
    intent: AttackIntent,
    rng: Rng,
    odds: OddsTables,
    diceMode: DiceMode,
  ): Extract<Action, { type: "ATTACK" }>;
  drawCard(
    state: GameState,
    map: MapDef,
    seat: Seat,
    rng: Rng,
  ): Extract<Action, { type: "CARD_DRAWN" }>;
  movePortals(
    state: GameState,
    map: MapDef,
    rng: Rng,
  ): Extract<Action, { type: "PORTALS_MOVED" }> | null;

  // ---- the bots the lazy tick runs ----
  createOdds(mode: DiceMode): OddsTables;
  makeView(
    state: GameState,
    map: MapDef,
    seat: Seat,
    persona: BotPersona,
    grudge?: Float32Array,
  ): GameView;
  decideTurn(view: GameView, odds: OddsTables, rng: Rng): TurnPlan;
  drawPersonas(
    tiers: readonly (BotTier | null)[],
    assignRng: Rng,
    jitterRng: Rng,
  ): readonly (BotPersona | null)[];

  // ---- maps ----
  /** `src/content/maps/index.ts`'s per-slug dynamic import (S3). */
  loadMapFile(slug: string): Promise<MapFile>;
  /** `@/engine/map`'s loader — unions the sea links in (F45). */
  loadMap(file: MapFile): MapDef;
}

/**
 * `loadMap` lives in `src/engine/map/**`, which is S3's directory and does
 * not exist yet, so a static `import … from "@/engine/map"` would not
 * typecheck. The specifier is held in a variable so TypeScript does not
 * resolve it and the bundlers leave the import alone; the moment S3's barrel
 * lands this becomes a plain static import and this function goes away.
 *
 * Nothing on the test path reaches it — every route test injects a fake
 * engine whose `loadMap` returns a fixture `MapDef`.
 */
const ENGINE_MAP_SPECIFIER = "@/engine/map";
let engineMapModule: Promise<{ loadMap(file: MapFile): MapDef }> | null = null;

function engineMap(): Promise<{ loadMap(file: MapFile): MapDef }> {
  engineMapModule ??= (async () => {
    try {
      return (await import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ ENGINE_MAP_SPECIFIER
      )) as { loadMap(file: MapFile): MapDef };
    } catch (cause) {
      throw new Error("S3 pending: @/engine/map is not available", { cause });
    }
  })();
  return engineMapModule;
}

/** Every member bound straight from the published barrels. */
export const realServerEngine: ServerEngine = {
  createInitialState: engine.createInitialState,
  apply: engine.apply,
  validate: engine.validate,
  legalActions: engine.legalActions,
  legalDraftTargets: engine.legalDraftTargets,
  viewFor: engine.viewFor,
  hashState: engine.hashState,
  isGameOver: engine.isGameOver,

  rngFor: engine.rngFor,
  dealTerritories: engine.dealTerritories,
  rollAttack: engine.rollAttack,
  drawCard: engine.drawCard,
  movePortals: engine.movePortals,

  createOdds: odds.createOdds,
  makeView: bots.makeView,
  decideTurn: bots.decideTurn,
  drawPersonas: bots.drawPersonas,

  loadMapFile,
  // Synchronous by contract, asynchronous to resolve while S3 is pending.
  // `loadMapDef` awaits the module before calling it, so this is only ever
  // reached through that path.
  loadMap: () => {
    throw new Error("S3 pending: call loadMapDef(), which awaits @/engine/map");
  },
};

/**
 * The process's engine, memoised on `globalThis` for the same reason
 * `getDb()` is: Next evaluates several module graphs per app, and a
 * module-scoped `let` would be a singleton per graph.
 */
const ENGINE_KEY = Symbol.for("risk.serverEngine");
const ODDS_KEY = Symbol.for("risk.serverOdds");
const MAPS_KEY = Symbol.for("risk.serverMaps");

interface Registry {
  [ENGINE_KEY]?: ServerEngine;
  [ODDS_KEY]?: Map<DiceMode, OddsTables>;
  [MAPS_KEY]?: Map<string, Promise<MapDef>>;
}

function registry(): Registry {
  return globalThis as unknown as Registry;
}

export function serverEngine(): ServerEngine {
  return (registry()[ENGINE_KEY] ??= realServerEngine);
}

/**
 * Replace the process's engine, returning a disposer. Tests inject a fake
 * here; nothing in the application calls it.
 */
export function setServerEngineForTests(partial: Partial<ServerEngine>): () => void {
  const previous = registry()[ENGINE_KEY];
  registry()[ENGINE_KEY] = { ...realServerEngine, ...partial };
  resetServerCaches();
  return () => {
    if (previous) registry()[ENGINE_KEY] = previous;
    else delete registry()[ENGINE_KEY];
    resetServerCaches();
  };
}

/** Drop the per-process odds and map caches. */
export function resetServerCaches(): void {
  delete registry()[ODDS_KEY];
  delete registry()[MAPS_KEY];
}

/** One `OddsTables` per dice mode per process; building one costs ~2 ms. */
export function oddsFor(mode: DiceMode): OddsTables {
  const cache = (registry()[ODDS_KEY] ??= new Map<DiceMode, OddsTables>());
  const existing = cache.get(mode);
  if (existing) return existing;
  const built = serverEngine().createOdds(mode);
  cache.set(mode, built);
  return built;
}

/**
 * A slug to a loaded `MapDef`, memoised per slug per process (§5.1).
 *
 * Every fold needs the map, and the map is immutable, so loading it once per
 * process is the difference between ~1 ms and ~25 ms of Active CPU on the
 * poll's tick path. A rejected load is evicted so a transient import failure
 * is not cached forever.
 */
export function loadMapDef(slug: string): Promise<MapDef> {
  const cache = (registry()[MAPS_KEY] ??= new Map<string, Promise<MapDef>>());
  const existing = cache.get(slug);
  if (existing) return existing;

  const loading = (async () => {
    const api = serverEngine();
    const file = await api.loadMapFile(slug);
    if (api.loadMap !== realServerEngine.loadMap) return api.loadMap(file);
    const { loadMap } = await engineMap();
    return loadMap(file);
  })().catch((error: unknown) => {
    cache.delete(slug);
    throw error;
  });

  cache.set(slug, loading);
  return loading;
}
