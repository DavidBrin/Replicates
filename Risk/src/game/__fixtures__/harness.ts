/**
 * The session test harness: a synchronous scheduler, the scripted engine, a
 * fake odds table and a deterministic seed, so every runner test is a pure
 * function of its inputs and no test ever sleeps.
 */
import {
  DEFAULT_RULES, type GameConfig, type MapDef, type Rules, type SeatConfig,
} from "@/engine/types";

import { createSession, type Session, type SessionOptions } from "../session";
import { toMapDef } from "../mapLoader";
import { createMemoryProgress } from "@/adapters/localStorage/progress";
import { createMemorySettings } from "@/adapters/localStorage/settings";

import { buildDemoMap } from "./demoMap";
import * as fakeBots from "./fakeBots";
import { createFakeOdds } from "./fakeOdds";
import { createScriptedEngine } from "./scriptedEngine";
import { TINY4 } from "./tiny4";

export { TINY4 };

/** A 12-territory, 4-region board — big enough for three seats and a real turn. */
export const DEMO: MapDef = toMapDef(buildDemoMap({ slug: "harness", cols: 4, rows: 3 }));

/**
 * A scheduler that runs every callback immediately and in order. Bot pacing
 * is presentational, so collapsing it makes a whole bot turn synchronous.
 */
export function syncScheduler(): { schedule: SessionOptions["schedule"]; pending: number } {
  const box = {
    pending: 0,
    schedule: (fn: () => void) => {
      box.pending += 1;
      fn();
      box.pending -= 1;
      return () => {};
    },
  };
  return box;
}

/** A scheduler that queues, so a test can step a bot turn one action at a time. */
export function manualScheduler(): {
  schedule: SessionOptions["schedule"];
  flush(limit?: number): number;
  size(): number;
} {
  const queue: (() => void)[] = [];
  return {
    schedule: (fn: () => void) => {
      queue.push(fn);
      return () => {
        const i = queue.indexOf(fn);
        if (i >= 0) queue.splice(i, 1);
      };
    },
    flush(limit = 500): number {
      let ran = 0;
      while (queue.length && ran < limit) {
        const fn = queue.shift();
        fn?.();
        ran += 1;
      }
      return ran;
    },
    size: () => queue.length,
  };
}

export interface HarnessOptions {
  readonly map?: MapDef;
  readonly seats?: readonly SeatConfig[];
  readonly rules?: Partial<Rules>;
  readonly seed?: string;
  readonly sync?: SessionOptions["sync"];
  readonly schedule?: SessionOptions["schedule"];
  readonly resume?: SessionOptions["resume"];
  readonly save?: SessionOptions["save"];
  readonly mySeat?: number;
}

export function seat(
  kind: SeatConfig["kind"], name: string, colour: SeatConfig["colour"], tier: SeatConfig["tier"] = null,
): SeatConfig {
  return { kind, name, colour, tier: kind === "bot" ? (tier ?? "medium") : null };
}

/** One human and two bots, the default solo shape. */
export const SOLO_SEATS: readonly SeatConfig[] = [
  seat("human", "You", "red"),
  seat("bot", "Napoleon", "green", "medium"),
  seat("bot", "Boudica", "blue", "medium"),
];

/** Three humans on one device, the Pass & Play shape. */
export const HOTSEAT_SEATS: readonly SeatConfig[] = [
  seat("human", "Ada", "red"),
  seat("human", "Grace", "green"),
  seat("human", "Alan", "blue"),
];

export function gameConfig(options: HarnessOptions = {}): GameConfig {
  return {
    mapSlug: (options.map ?? DEMO).slug,
    rules: { ...DEFAULT_RULES, ...options.rules },
    seats: options.seats ?? SOLO_SEATS,
    seed: options.seed ?? "harness-seed",
  };
}

export interface Harness {
  readonly session: Session;
  readonly map: MapDef;
  readonly config: GameConfig;
  readonly saves: (import("../session").SavedSession | null)[];
  destroy(): void;
}

export function makeSession(options: HarnessOptions = {}): Harness {
  const map = options.map ?? DEMO;
  const config = gameConfig(options);
  const saves: (import("../session").SavedSession | null)[] = [];
  const session = createSession({
    map,
    config,
    engine: createScriptedEngine(),
    odds: createFakeOdds(config.rules.diceMode),
    bots: fakeBots,
    settings: createMemorySettings(),
    progress: createMemoryProgress(),
    schedule: options.schedule ?? syncScheduler().schedule,
    skipAnimations: true,
    now: () => 0,
    sync: options.sync ?? null,
    resume: options.resume ?? null,
    save: options.save ?? ((s) => saves.push(s)),
    ...(options.mySeat !== undefined ? { mySeat: options.mySeat } : {}),
  });
  return { session, map, config, saves, destroy: () => session.destroy() };
}
