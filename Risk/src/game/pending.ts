/**
 * The slice entry points the screens and the session runner call through.
 *
 * This file used to be a hand-over shim: while S1, S2 and S3 published barrels whose every member
 * threw `"<slice> pending"`, each accessor below **probed** the real barrel once and fell back to
 * S4's stand-in, memoising the answer. All three slices have landed, so the probes are gone and the
 * real barrels are imported directly — a probe that can only ever take one branch is a `try/catch`
 * around production code, and it kept S4's fake engine, fake odds and demo maps in the production
 * bundle for the sake of a branch nothing reaches.
 *
 * The fixtures themselves live on under `src/game/__fixtures__/` and `src/engine/__fixtures__/`,
 * where the tests that inject them can find them. Nothing here imports one.
 *
 * What remains is the indirection the screens actually want: one place that knows which catalogue
 * the map picker offers, which `OddsTables` a dice mode means, and that `engineApi` is the engine.
 */
import * as bots from "@/engine/bots";
import type { GameView, TurnPlan } from "@/engine/bots/types";
import { createOdds } from "@/engine/odds";
import type {
  BotPersona, BotTier, DiceMode, GameState, MapDef, MapFile, OddsTables, Rng, Seat,
} from "@/engine/types";
import { generateVoronoiMap, loadMap, type VoronoiOptions } from "@/engine/map";
import { FIXTURE_SLUGS, MAP_SLUGS, loadMapFile } from "@/content/maps";

import type { EngineApi } from "./engineApi";
import { engineApi } from "./engineApi";

/* -------------------------------------------------------------- engine -- */

/** The engine. */
export function playEngine(): EngineApi {
  return engineApi;
}

/* ---------------------------------------------------------------- odds -- */

const oddsCache = new Map<DiceMode, OddsTables>();

/**
 * The `OddsTables` for a dice mode, built once per mode.
 *
 * Memoised because `createOdds` builds the 129×129 `W[A][D]` table eagerly (D22) and two screens
 * asking for the same mode must share it — a second table is 65 KiB and a cold start, never a
 * different answer.
 */
export function playOdds(mode: DiceMode): OddsTables {
  const hit = oddsCache.get(mode);
  if (hit) return hit;
  const tables = createOdds(mode);
  oddsCache.set(mode, tables);
  return tables;
}

/* ---------------------------------------------------------------- bots -- */

/**
 * The three `@/engine/bots` entry points the session runner needs.
 *
 * Still an interface rather than the module type, because `createSession` takes it as an option so
 * a test can hand the runner a scripted planner (F33).
 */
export interface BotsApi {
  drawPersonas(tiers: readonly (BotTier | null)[], assignRng: Rng, jitterRng: Rng):
    readonly (BotPersona | null)[];
  makeView(state: GameState, map: MapDef, seat: Seat, persona: BotPersona, grudge?: Float32Array): GameView;
  decideTurn(view: GameView, odds: OddsTables, rng: Rng): TurnPlan;
}

export function playBots(): BotsApi {
  return bots;
}

/* ---------------------------------------------------------------- maps -- */

/**
 * Every slug the picker should offer: S3's catalogue minus the engine fixtures
 * (`tiny3`/`tiny4`/`mini`/`quad` exist for tests, not for players).
 */
export function playMapSlugs(): readonly string[] {
  return MAP_SLUGS.filter((slug) => !FIXTURE_SLUGS.includes(slug));
}

/** Load one map file by slug, through S3's loader. */
export async function playMapFile(slug: string): Promise<MapFile> {
  return loadMapFile(slug);
}

/** `MapFile` → `MapDef`, through S3's canonical indexer. */
export function indexMap(file: MapFile): MapDef {
  return loadMap(file);
}

/** Load and index one map by slug. */
export async function playMapDef(slug: string): Promise<MapDef> {
  return indexMap(await playMapFile(slug));
}

/**
 * The seeded random map (§4.14). `generateVoronoiMap` takes the options and a seed; the slug is
 * minted from that seed, so `GameState` never has to describe a generator.
 */
export function playRandomMap(options: VoronoiOptions, seed: string): MapDef {
  return indexMap(generateVoronoiMap(options, seed));
}
