import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { apply, createInitialState, hashState, validate } from "@/engine";
import { loadMap } from "@/engine/map";
import type { Action, GameState, MapDef, MapFile, Seat } from "@/engine/types";

import { API, api, apiJson, uniqueName, type LogRow } from "./helpers";

/**
 * **T10.1 — the replay determinism proof.** The first spec written, because
 * every other guarantee in the project rests on it (SPEC §11, D54).
 *
 * The claim: the action log *is* the game. Folding it with the same pure
 * `apply` the authority used must reproduce the authority's own `state_hash`
 * at **every** row — not just at the end — because that is what makes an
 * append-only log a safe substitute for shipping state around, and what makes
 * a client's optimistic fold checkable against the server for free (§5.5,
 * D2/D3/D16).
 *
 * Three deliberate choices:
 *
 *  - **`GET /api/games/:id/actions?from=0`**, the debug-gated raw log, not
 *    POLL 3 (§6, F37). POLL 3 would hand back the caller's *view*; a replay
 *    checked against a masked state proves nothing.
 *  - **A non-fog game**, which is the only configuration in which a
 *    client-side fold is defined at all — `hashState` refuses a fogged state
 *    outright (F36).
 *  - **`import` from `@/engine`.** Every other spec in `e2e/**` re-declares
 *    what it touches, on the principle that a suite importing the app's own
 *    constants can only prove self-consistency. This one is the exception
 *    *because* reproducing the engine's fold is the thing being proved: a
 *    second implementation of `apply` would be testing the copy. The route and
 *    the shapes still come from `./helpers`.
 */

/** The map JSON, read off disk rather than through `@/content/maps`. */
function loadBoard(slug: string): MapDef {
  const file = path.join(process.cwd(), "src", "content", "maps", `${slug}.json`);
  return loadMap(JSON.parse(readFileSync(file, "utf8")) as MapFile);
}

/** The non-fog rules a lobby is created with. Fog is checked by T9, not here. */
const RULES = {
  winCondition: "world",
  dominationThreshold: 0.7,
  cardBonus: "fixed",
  diceMode: "balancedBlitz",
  fogOfWar: false,
  capitals: false,
  capitalDraftBonus: false,
  blizzards: false,
  portals: "off",
  manualPlacement: false,
  maxRounds: null,
  roundDelayMs: 0,
  turnSeconds: 60,
  alliances: false,
  aiDifficulty: "medium",
} as const;

interface Seated {
  readonly request: APIRequestContext;
  readonly seat: Seat;
}

/** Fold the whole log from `seq = 0`, hashing after every row. */
function foldAndHash(map: MapDef, rows: readonly LogRow[]): {
  state: GameState;
  mismatches: { seq: number; type: string; expected: string; actual: string }[];
  hashed: number;
} {
  let state: GameState | null = null;
  const mismatches: { seq: number; type: string; expected: string; actual: string }[] = [];
  let hashed = 0;

  for (const row of rows) {
    const action = row.action as unknown as Action;
    if (action.type === "GAME_STARTED") {
      state = createInitialState(map, action);
    } else {
      expect(state, `the log does not open with GAME_STARTED (seq ${row.seq})`).not.toBeNull();
      const result = apply(state!, map, action);
      expect(
        result.error,
        `the log is not foldable at seq ${row.seq} (${action.type}): ${result.error?.code} ${result.error?.message}`,
      ).toBeUndefined();
      state = result.state;
    }

    const actual = hashState(state!);
    hashed += 1;
    if (actual !== row.stateHash) {
      mismatches.push({ seq: row.seq, type: action.type, expected: row.stateHash, actual });
    }
  }

  expect(state, "the log was empty").not.toBeNull();
  return { state: state!, mismatches, hashed };
}

/** The next action this seat can legally take, chosen from the folded state. */
function nextAction(state: GameState, map: MapDef, seat: Seat): Action | null {
  const candidates: Action[] = [];

  if (state.pendingMoveIn) {
    candidates.push({ type: "MOVE_IN", seat, count: state.pendingMoveIn.max });
  }
  if (state.troopsToPlace > 0) {
    const mine = state.territories.findIndex((t) => t.owner === seat);
    if (mine >= 0) {
      candidates.push({ type: "DRAFT", seat, territory: mine, count: state.troopsToPlace });
    }
  }
  candidates.push({ type: "END_PHASE", seat });
  candidates.push({ type: "END_TURN", seat });

  for (const candidate of candidates) {
    if (validate(state, map, candidate) === null) return candidate;
  }
  return null;
}

/** An attack **intent** for this seat, or null. The authority rolls (F11). */
function nextIntent(
  state: GameState,
  map: MapDef,
  seat: Seat,
): { from: number; to: number; mode: "blitz" } | null {
  if (state.phase !== "attack" || state.pendingMoveIn) return null;
  for (let from = 0; from < state.territories.length; from += 1) {
    const tile = state.territories[from]!;
    if (tile.owner !== seat || tile.troops < 2) continue;
    for (const to of map.adjacency[from] ?? []) {
      const target = state.territories[to]!;
      if (target.owner !== seat && !target.blizzard) return { from, to, mode: "blitz" };
    }
  }
  return null;
}

test("T10.1 — folding the raw action log reproduces every stored state hash", async ({ browser }) => {
  const slug = "tiny4";
  const map = loadBoard(slug);

  // ---- two genuinely separate cookie jars, so two `risk_sid`s ------------
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = hostContext.request;
  const guest = guestContext.request;

  try {
    const hostName = uniqueName("Replay Host");
    const guestName = uniqueName("Replay Guest");
    await apiJson(host, API.session, { method: "POST", body: { displayName: hostName, colour: "red" } });
    await apiJson(guest, API.session, { method: "POST", body: { displayName: guestName, colour: "blue" } });

    const created = await apiJson<{ code: string }>(host, API.lobbies, {
      method: "POST",
      body: { title: "Determinism", mapSlug: slug, rules: RULES, maxSeats: 2 },
    });
    expect(created.code, "a lobby code is four unambiguous capitals").toMatch(/^[A-HJ-NP-Z]{4}$/);

    await apiJson(guest, API.join(created.code), { method: "POST", body: {} });
    await apiJson(host, API.ready(created.code), { method: "POST", body: { ready: true } });
    await apiJson(guest, API.ready(created.code), { method: "POST", body: { ready: true } });
    const started = await apiJson<{ gameId: string }>(host, API.start(created.code), { method: "POST" });
    const gameId = started.gameId;

    // Which seat each jar holds. Nothing may assume seat 0 plays first: the
    // turn order comes out of the seed.
    const hostSync = await apiJson<{ you: { seat: Seat } }>(host, API.gameSync(gameId));
    const guestSync = await apiJson<{ you: { seat: Seat } }>(guest, API.gameSync(gameId));
    expect(hostSync.you.seat).not.toBe(guestSync.you.seat);
    const seats: readonly Seated[] = [
      { request: host, seat: hostSync.you.seat },
      { request: guest, seat: guestSync.you.seat },
    ];

    // ---- play a few actions, each one decided from the folded log --------
    let appended = 0;
    for (let step = 0; step < 14 && appended < 8; step += 1) {
      const log = await apiJson<{ actions: LogRow[] }>(host, API.rawLog(gameId, 0));
      const { state } = foldAndHash(map, log.actions);
      if (state.outcome) break;

      const acting = state.turnOrder[state.currentIndex]!;
      const player = seats.find((s) => s.seat === acting);
      // A seat the turn timer has already handed to a bot is nobody's to play.
      if (!player || state.seats[acting]?.kind !== "human") break;

      const intent = nextIntent(state, map, acting);
      const body = intent
        ? { clientActionId: `replay-i-${step}`, kind: "intent" as const, intent }
        : (() => {
            const action = nextAction(state, map, acting);
            return action === null
              ? null
              : { clientActionId: `replay-a-${step}`, kind: "action" as const, action };
          })();
      if (body === null) break;

      const posted = await api(player.request, API.gameActions(gameId), { method: "POST", body });
      // 409 `notYourTurn` is the lazy tick having moved on between the fold
      // and the POST — re-read and try again rather than failing.
      if (posted.status === 409) continue;
      expect(posted.status, `POST ${JSON.stringify(body)} → ${posted.status}`).toBe(200);
      appended += 1;
    }

    expect(appended, "no action was ever appended").toBeGreaterThan(0);

    // ---- the proof --------------------------------------------------------
    const raw = await api<{ actions: LogRow[] }>(host, API.rawLog(gameId, 0));
    expect(raw.status, "the debug log answers while NEXT_PUBLIC_RISK_DEBUG=1 (F37)").toBe(200);
    const rows = raw.body!.actions;

    expect(rows.length, "the log has more than the opening row").toBeGreaterThan(1);
    expect(rows[0]!.seq, "the log starts at seq 1").toBe(1);
    expect(rows[0]!.action.type, "the first row is the opening deal").toBe("GAME_STARTED");
    expect(
      rows.map((r) => r.seq),
      "the log is contiguous and in order",
    ).toEqual(rows.map((_, i) => i + 1));
    for (const row of rows) {
      expect(row.stateHash, `seq ${row.seq} carries a state hash`).toMatch(/\S/);
    }

    // `games.seed` is a column and never a payload field (D5), so there is
    // nothing to strip and nothing that can leak — including out of the
    // GAME_STARTED row, which is the one that carries the deal.
    expect(JSON.stringify(rows), "no seed anywhere in the raw log").not.toContain("seed");

    const { state, mismatches, hashed } = foldAndHash(map, rows);
    expect(
      mismatches,
      `every stored hash must match the local fold; ${mismatches.length} of ${hashed} did not`,
    ).toEqual([]);
    expect(hashed, "a hash was checked for every row").toBe(rows.length);

    // A non-fog game is the only one this fold is defined for, and the state
    // it produced is authoritative rather than a view.
    expect(state.rules.fogOfWar).toBe(false);
    expect(state.fogged).toBe(false);
    expect(state.mapSlug).toBe(slug);

    // Folding a suffix from the hash the client already holds must agree with
    // folding the whole thing — which is exactly what a reconnecting client
    // does with `?since=`.
    const tail = await apiJson<{ actions: LogRow[] }>(host, API.rawLog(gameId, 1));
    expect(tail.actions[0]?.seq, "?from=1 starts after seq 1").toBe(2);
    expect(tail.actions.map((r) => r.stateHash)).toEqual(rows.slice(1).map((r) => r.stateHash));
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
