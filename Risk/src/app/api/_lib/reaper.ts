import "server-only";

import { getDb } from "@/adapters/db";
import { ActionsRepository } from "@/adapters/db/repositories/actions";
import { GamesRepository } from "@/adapters/db/repositories/games";
import { ReaperRepository, type SweepCounts } from "@/adapters/db/repositories/reaper";

import { loadMapDef, serverEngine } from "./engine";
import { COMPACTION_THRESHOLD, foldActions } from "./gameState";

/**
 * The lazy reaper (SPEC §6.3).
 *
 * Garbage collection rides the polls: **once per ~60 s per process**, gated on
 * a timestamp held on `globalThis` for the same reason `getDb()` is — Next
 * evaluates several module graphs per app, and a module-scoped `let` would be
 * one clock per graph rather than one per process.
 *
 * Every statement is bounded by a `limit` so no single request can be slow.
 * `GET /api/cron/sweep` runs the same sweeps with a much larger limit: the
 * belt-and-braces pass for the week nobody visits, which is all a Hobby cron
 * firing once a day can usefully be.
 */

export const SWEEP_INTERVAL_MS = 60_000;
/** The per-sweep bound on the polling path. */
export const LAZY_LIMIT = 25;
/** The bound `GET /api/cron/sweep` uses instead. */
export const CRON_LIMIT = 500;

const CLOCK_KEY = Symbol.for("risk.lastSweepAt");

interface Registry {
  [CLOCK_KEY]?: number;
}

function registry(): Registry {
  return globalThis as unknown as Registry;
}

/** Test hook: forget when the last sweep ran. */
export function resetSweepClockForTests(): void {
  delete registry()[CLOCK_KEY];
}

export interface SweepReport extends SweepCounts {
  compacted: number;
}

const EMPTY: SweepReport = {
  staleLobbies: 0,
  abandonedGames: 0,
  oldGames: 0,
  deadPlayers: 0,
  oldChat: 0,
  compacted: 0,
};

/**
 * Sweep if it is time to, otherwise do nothing.
 *
 * The clock is stamped **before** the work rather than after, so a sweep that
 * throws does not make the next poll try again immediately — one slow or
 * failing sweep per minute is the worst case either way.
 */
export async function maybeSweep(now = Date.now()): Promise<SweepReport | null> {
  const last = registry()[CLOCK_KEY] ?? 0;
  if (now - last < SWEEP_INTERVAL_MS) return null;
  registry()[CLOCK_KEY] = now;
  return sweep(LAZY_LIMIT);
}

/** Run every sweep, bounded by `limit`. */
export async function sweep(limit = LAZY_LIMIT): Promise<SweepReport> {
  const db = getDb();
  const reaper = new ReaperRepository(db);

  const report: SweepReport = {
    ...EMPTY,
    staleLobbies: await reaper.closeStaleLobbies(limit),
    abandonedGames: await reaper.abandonDeadGames(limit),
    oldGames: await reaper.deleteOldGames(limit),
    deadPlayers: await reaper.deleteDeadPlayers(limit),
    oldChat: await reaper.deleteOldChat(limit),
  };

  report.compacted = await compact(limit);
  return report;
}

/**
 * Refold and rewrite the snapshot of every game whose log has run more than
 * {@link COMPACTION_THRESHOLD} actions past it.
 *
 * This is what bounds the fold the submit path and the fog poll pay for, and
 * it is the only thing that advances `snapshot_seq` outside the append path's
 * own self-limiting rewrite — so it is also what makes §6's
 * `0 < since < snapshot_seq` branch reachable at all.
 *
 * A game whose map or rules the engine cannot load yet is skipped rather than
 * failing the sweep: compaction is a cache refresh, and a poll that 500s
 * because a cache could not be rebuilt is strictly worse than a slow fold.
 */
export async function compact(limit: number): Promise<number> {
  const engine = serverEngine();
  const db = getDb();
  const games = new GamesRepository(db);
  const candidates = await new ReaperRepository(db).compactionCandidates(
    COMPACTION_THRESHOLD,
    limit,
  );

  let done = 0;
  for (const gameId of candidates) {
    try {
      const row = await games.secret(gameId);
      if (!row) continue;
      const map = await loadMapDef(row.mapSlug);
      const log = await new ActionsRepository(db).between(gameId, row.snapshotSeq, row.seq);
      const state = foldActions(engine, row.snapshot, map, log);
      await games.rewriteSnapshot(gameId, state, row.seq, engine.hashState(state));
      done += 1;
    } catch (error) {
      console.error("[reaper] compaction skipped", gameId, error);
    }
  }
  return done;
}
