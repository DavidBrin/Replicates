/**
 * Slice hand-over, in one place.
 *
 * S1, S2 and S3 publish barrels whose every member throws `"<slice> pending"`
 * until that slice lands. S4 is built and tested against its own fixtures, so
 * the screens must still run: each accessor below probes the real barrel once
 * and falls back to S4's stand-in, memoising the answer.
 *
 * **This whole module is deletable** the day S1–S3 are merged — nothing but
 * the three `useReal*` probes depends on the fallbacks, and every fallback
 * lives under `src/game/__fixtures__/`.
 */
import * as bots from "@/engine/bots";
import type { GameView, TurnPlan } from "@/engine/bots/types";
import { createOdds } from "@/engine/odds";
import type {
  BotPersona, BotTier, DiceMode, GameState, MapDef, MapFile, OddsTables, Rng, Seat,
} from "@/engine/types";
import { generateVoronoiMap, loadMap, type VoronoiOptions } from "@/engine/map";
import { FIXTURE_SLUGS, MAP_SLUGS, loadMapFile } from "@/content/maps";

import { buildDemoMap } from "./__fixtures__/demoMap";
import * as fakeBots from "./__fixtures__/fakeBots";
import { createFakeOdds } from "./__fixtures__/fakeOdds";
import { scriptedEngine } from "./__fixtures__/scriptedEngine";
import { TINY4_FILE } from "./__fixtures__/tiny4";
import type { EngineApi } from "./engineApi";
import { engineApi } from "./engineApi";
import { toMapDefCached } from "./mapLoader";

/** True when `error` is one of the published "slice pending" stubs. */
export function isPending(error: unknown): boolean {
  return error instanceof Error && /^S[0-9]+ pending/.test(error.message);
}

function probe<T>(real: () => T, fallback: () => T, label: string): T {
  try {
    return real();
  } catch (error) {
    if (!isPending(error)) throw error;
    if (typeof console !== "undefined") {
      console.warn(`[risk] ${label} is still stubbed — using S4's development stand-in.`);
    }
    return fallback();
  }
}

/* -------------------------------------------------------------- engine -- */

let engineChoice: EngineApi | null = null;

/** The real `@/engine`, or S4's scripted stand-in while S1 is still stubbed. */
export function playEngine(): EngineApi {
  if (engineChoice) return engineChoice;
  engineChoice = probe(
    () => {
      // One cheap call that every real implementation answers and every stub throws on.
      engineApi.cardSets([]);
      return engineApi;
    },
    () => scriptedEngine,
    "@/engine",
  );
  return engineChoice;
}

/** True when the real engine answered the probe. */
export function engineIsReal(): boolean {
  return playEngine() === engineApi;
}

/* ---------------------------------------------------------------- odds -- */

const oddsCache = new Map<DiceMode, OddsTables>();

/** The real `@/engine/odds`, or S4's smooth stand-in while S2 is still stubbed. */
export function playOdds(mode: DiceMode): OddsTables {
  const hit = oddsCache.get(mode);
  if (hit) return hit;
  const tables = probe(() => createOdds(mode), () => createFakeOdds(mode), "@/engine/odds");
  oddsCache.set(mode, tables);
  return tables;
}

/* ---------------------------------------------------------------- bots -- */

/**
 * The three `@/engine/bots` entry points the session runner needs, probed as
 * one unit: a half-real bots barrel would be worse than either whole.
 */
export interface BotsApi {
  drawPersonas(tiers: readonly (BotTier | null)[], assignRng: Rng, jitterRng: Rng):
    readonly (BotPersona | null)[];
  makeView(state: GameState, map: MapDef, seat: Seat, persona: BotPersona, grudge?: Float32Array): GameView;
  decideTurn(view: GameView, odds: OddsTables, rng: Rng): TurnPlan;
}

let botsChoice: BotsApi | null = null;

export function playBots(): BotsApi {
  if (botsChoice) return botsChoice;
  botsChoice = probe<BotsApi>(
    () => {
      bots.drawPersonas([null], { nextU32: () => 0, nextFloat: () => 0, state: [0, 0] },
        { nextU32: () => 0, nextFloat: () => 0, state: [0, 0] });
      return bots;
    },
    () => fakeBots,
    "@/engine/bots",
  );
  return botsChoice;
}

/* ---------------------------------------------------------------- maps -- */

/** S4's development catalogue, used only while `MAP_SLUGS` is still empty. */
const FALLBACK_MAPS: Readonly<Record<string, () => MapFile>> = {
  "demo-grid": () => buildDemoMap({ slug: "demo-grid", name: "Demo Grid", cols: 4, rows: 3 }),
  "demo-wide": () => buildDemoMap({ slug: "demo-wide", name: "Demo Wide", cols: 6, rows: 4 }),
  tiny4: () => TINY4_FILE,
};

/**
 * Every slug the picker should offer: S3's catalogue minus the engine
 * fixtures (`tiny3`/`tiny4`/`mini`/`quad` exist for tests, not for players),
 * or S4's stand-in while the catalogue is empty.
 */
export function playMapSlugs(): readonly string[] {
  if (MAP_SLUGS.length === 0) return Object.keys(FALLBACK_MAPS);
  return MAP_SLUGS.filter((slug) => !FIXTURE_SLUGS.includes(slug));
}

/** True when S3's real catalogue is in place. */
export function mapsAreReal(): boolean {
  return MAP_SLUGS.length > 0;
}

/** Load one map file by slug, through S3's loader when it exists. */
export async function playMapFile(slug: string): Promise<MapFile> {
  if (MAP_SLUGS.includes(slug)) return loadMapFile(slug);
  const fallback = FALLBACK_MAPS[slug];
  if (fallback) return fallback();
  // Unknown to S4; let S3's loader produce its own rejection.
  return loadMapFile(slug);
}

/**
 * `MapFile` → `MapDef` through S3's `loadMap`, which is the canonical one.
 * S4's `toMapDefCached` stays as the fallback for its own fixtures, and the
 * two agree on the contract that matters: the sea-link union (F45).
 */
export function indexMap(file: MapFile): MapDef {
  try {
    return loadMap(file);
  } catch (error) {
    if (!isPending(error)) throw error;
    return toMapDefCached(file);
  }
}

/** Load and index one map by slug. */
export async function playMapDef(slug: string): Promise<MapDef> {
  return indexMap(await playMapFile(slug));
}

/**
 * The seeded random map (§4.14). `generateVoronoiMap` takes the options and a
 * seed; the slug is minted from that seed, so `GameState` never has to
 * describe a generator.
 */
export function playRandomMap(options: VoronoiOptions, seed: string): MapDef {
  return indexMap(generateVoronoiMap(options, seed));
}
