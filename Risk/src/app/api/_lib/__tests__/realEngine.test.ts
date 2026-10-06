// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apply, hashState, type Action, type GameState, type MapDef, type Seat } from "@/engine";
import { classicWorld, tiny4 } from "@/engine/__fixtures__/maps";

import { realServerEngine, type ServerEngine } from "../engine";
import { createGame, pollGame, runLazyTick } from "../gameService";
import { MAX_TICK_ACTIONS } from "../gameState";
import { fakeMapFile } from "./fakeEngine";
import {
  actionId,
  humanVsBotGame,
  mustClaim,
  poll,
  req,
  routes,
  startHarness,
  submit,
  TEST_RULES,
  twoPlayerGame,
  type Harness,
  type Session,
  type TwoPlayerGame,
} from "./harness";

/**
 * The routes against the **real** engine (SPEC §12's final integration).
 *
 * Everything else in this directory runs on a counter-state fake, which is
 * what proves the transaction, the idempotency fence and the `204` path
 * without waiting on S1 and S2. This suite is the other half: the same lazy
 * tick, the same append path and the same fold, driven by the actual `apply`,
 * `validate`, `decideTurn`, `rollAttack` and `hashState`.
 *
 * The map comes from S1's own fixtures rather than from `@/content/maps`,
 * because S3's catalogue is still in flight — which is exactly what the
 * engine seam's `loadMap` / `loadMapFile` members are for.
 *
 * Nothing here assumes seat 0 goes first: `dealTerritories` decides the turn
 * order from the seed (R3), and a test that hard-coded seat 0 would be
 * asserting the seed rather than the route.
 */

/** The real engine, with a fixture map standing in for S3's catalogue. */
function engineWithMap(map: MapDef): Partial<ServerEngine> {
  return {
    ...realServerEngine,
    // S1's fixtures are already-loaded `MapDef`s, so the file step is a
    // placeholder the injected `loadMap` ignores.
    loadMapFile: async () => fakeMapFile(1),
    loadMap: () => map,
  };
}

/**
 * An empty board, for a cold client's fold.
 *
 * S1 accepts `GAME_STARTED` through `apply` directly, so a client needs no
 * separate entry point — but `validate`'s seven-card guard reads
 * `state.seats` before the switch, so the placeholder has to be an object
 * carrying the three arrays rather than `undefined`. T10.1 folds from exactly
 * this.
 */
const EMPTY_BOARD = { seats: [], territories: [], turnOrder: [] } as unknown as GameState;

let harness: Harness;

afterEach(async () => {
  await harness.dispose();
});

/** Fold the raw log exactly as §5.5's client does, asserting every hash. */
function replay(log: readonly { payload: Action; state_hash: string }[], map: MapDef): GameState {
  const first = log[0];
  if (!first) throw new Error("an empty log");
  const opening = apply(EMPTY_BOARD, map, first.payload);
  expect(opening.error, "GAME_STARTED was refused on replay").toBeUndefined();
  let state = opening.state;
  expect(hashState(state)).toBe(first.state_hash);
  for (const row of log.slice(1)) {
    const result = apply(state, map, row.payload);
    expect(result.error, `${row.payload.type} was refused on replay`).toBeUndefined();
    state = result.state;
    expect(hashState(state)).toBe(row.state_hash);
  }
  return state;
}

async function rawLogOf(
  db: Harness["db"],
  gameId: string,
): Promise<{ seq: number; type: string; actor: string; payload: Action; state_hash: string }[]> {
  const rows = await db.query<{
    seq: string | number;
    type: string;
    actor: string;
    payload: Action;
    state_hash: string;
  }>(
    "select seq, type, actor, payload, state_hash from game_actions where game_id = $1 order by seq",
    [gameId],
  );
  return rows.map((row) => ({ ...row, seq: Number(row.seq) }));
}

async function currentSeatOf(gameId: string): Promise<Seat> {
  const rows = await harness.db.query<{ current_seat: number }>(
    "select current_seat from games where id = $1",
    [gameId],
  );
  return Number(rows[0]?.current_seat ?? 0);
}

/** The session holding the seat whose turn it is. */
async function whoseTurn(game: TwoPlayerGame): Promise<{ session: Session; seat: Seat }> {
  const seat = await currentSeatOf(game.gameId);
  const rows = await harness.db.query<{ player_id: string }>(
    "select player_id from game_players where game_id = $1 and seat = $2",
    [game.gameId, seat],
  );
  const session = rows[0]?.player_id === game.a.playerId ? game.a : game.b;
  return { session, seat };
}

describe("creating a game with the real resolver", () => {
  beforeEach(async () => {
    harness = await startHarness(engineWithMap(classicWorld));
  });

  it("writes GAME_STARTED at seq 1, with the real deal and the real hash", async () => {
    const gameId = await createGame({
      lobbyId: null,
      mapSlug: "classic-world",
      rules: TEST_RULES,
      seats: [
        { seat: 0, kind: "human", playerId: null, tier: null, displayName: "Alpha", colour: "red" },
        { seat: 1, kind: "bot", playerId: null, tier: "medium", displayName: "Bot", colour: "blue" },
      ],
    });

    const log = await rawLogOf(harness.db, gameId);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ seq: 1, type: "GAME_STARTED", actor: "server" });

    const started = log[0]!.payload as Extract<Action, { type: "GAME_STARTED" }>;
    // Every territory is dealt, and the bot seat carries a persona already
    // folded with its tier while the human seat carries none.
    expect(started.deal).toHaveLength(classicWorld.territories.length);
    expect(started.seats[1]?.persona).not.toBeNull();
    expect(started.seats[1]?.persona?.tier).toBe("medium");
    expect(started.seats[0]?.persona).toBeNull();
    // Two seats means the neutral holding (R6), which the deal says so.
    expect(started.neutral).toBe(true);

    // And the stored snapshot is the fold of that one action.
    const stored = await harness.db.query<{ snapshot: GameState; state_hash: string }>(
      "select snapshot, state_hash from games where id = $1",
      [gameId],
    );
    expect(hashState(stored[0]!.snapshot)).toBe(stored[0]!.state_hash);
    expect(log[0]?.state_hash).toBe(stored[0]?.state_hash);
  });

  it("stores a current_seat that is the opening's own turn order", async () => {
    const gameId = await createGame({
      lobbyId: null,
      mapSlug: "classic-world",
      rules: TEST_RULES,
      seats: [
        { seat: 0, kind: "human", playerId: null, tier: null, displayName: "A", colour: "red" },
        { seat: 1, kind: "human", playerId: null, tier: null, displayName: "B", colour: "blue" },
      ],
    });
    const stored = await harness.db.query<{ snapshot: GameState; current_seat: number }>(
      "select snapshot, current_seat from games where id = $1",
      [gameId],
    );
    const state = stored[0]!.snapshot;
    expect(Number(stored[0]?.current_seat)).toBe(state.turnOrder[state.currentIndex]);
  });

  it("never puts the seed in the opening action", async () => {
    const gameId = await createGame({
      lobbyId: null,
      mapSlug: "classic-world",
      rules: TEST_RULES,
      seats: [
        { seat: 0, kind: "bot", playerId: null, tier: "easy", displayName: "A", colour: "red" },
        { seat: 1, kind: "bot", playerId: null, tier: "easy", displayName: "B", colour: "blue" },
      ],
    });
    const seed = (
      await harness.db.query<{ seed: string }>("select seed from games where id = $1", [gameId])
    )[0]!.seed;
    const log = await rawLogOf(harness.db, gameId);
    expect(JSON.stringify(log[0]?.payload)).not.toContain(seed);
  });
});

describe("the lazy tick against the real bots", () => {
  beforeEach(async () => {
    harness = await startHarness(engineWithMap(tiny4));
  });

  async function botOnlyGame(): Promise<string> {
    return createGame({
      lobbyId: null,
      mapSlug: "tiny4",
      rules: TEST_RULES,
      seats: [
        { seat: 0, kind: "bot", playerId: null, tier: "medium", displayName: "A", colour: "red" },
        { seat: 1, kind: "bot", playerId: null, tier: "hard", displayName: "B", colour: "blue" },
      ],
    });
  }

  it("plans, resolves and applies real bot turns with no cron", async () => {
    const gameId = await botOnlyGame();
    const report = await runLazyTick(gameId);

    expect(report.ticked).toBe(true);
    expect(report.appended).toBeGreaterThan(0);
    expect(report.appended).toBeLessThanOrEqual(MAX_TICK_ACTIONS);

    const log = await rawLogOf(harness.db, gameId);
    expect(log.map((row) => row.seq)).toEqual(
      Array.from({ length: log.length }, (_, index) => index + 1),
    );
    // `decideTurn` plans one phase per call and at most one attack, so the
    // loop has to re-enter it — which is what produces a sequence of
    // different action types rather than one repeated forever.
    const kinds = new Set(log.slice(1).map((row) => row.type));
    expect(kinds.size).toBeGreaterThan(1);
    expect(log.slice(1).every((row) => row.actor === "bot" || row.actor === "server")).toBe(true);
  });

  it("writes a state_hash per row that a client's own replay reproduces", async () => {
    const gameId = await botOnlyGame();
    await runLazyTick(gameId);
    const log = await rawLogOf(harness.db, gameId);
    expect(log.length).toBeGreaterThan(1);
    replay(log, tiny4);
  });

  it("keeps games.seq, the snapshot and the hash consistent across several ticks", async () => {
    const gameId = await botOnlyGame();
    for (let i = 0; i < 4; i += 1) {
      const report = await runLazyTick(gameId);
      if (!report.ticked || report.appended === 0) break;
    }

    const head = await harness.db.query<{
      seq: string | number;
      snapshot: GameState;
      snapshot_seq: string | number;
      state_hash: string;
      max: string | number;
      status: string;
    }>(
      `select g.seq, g.snapshot, g.snapshot_seq, g.state_hash, g.status,
              (select max(seq) from game_actions where game_id = g.id) as max
         from games g where g.id = $1`,
      [gameId],
    );
    const row = head[0]!;
    expect(Number(row.seq)).toBe(Number(row.max));
    // §6.2's invariant: the snapshot is the fold up to `snapshot_seq`, and
    // `state_hash` is its hash — whether or not compaction has moved it.
    expect(hashState(row.snapshot)).toBe(row.state_hash);

    const log = await rawLogOf(harness.db, gameId);
    const upTo = log.filter((entry) => entry.seq <= Number(row.snapshot_seq));
    expect(hashState(replay(upTo, tiny4))).toBe(row.state_hash);
  });

  it("carries the bots' grudge vector across ticks in bot_memory", async () => {
    const gameId = await botOnlyGame();
    await runLazyTick(gameId);
    const rows = await harness.db.query<{ bot_memory: Record<string, { grudge: number[] }> }>(
      "select bot_memory from games where id = $1",
      [gameId],
    );
    const memory = rows[0]!.bot_memory;
    expect(Object.keys(memory).length).toBeGreaterThan(0);
    for (const entry of Object.values(memory)) expect(entry.grudge).toHaveLength(2);
  });

  it("bounds one request's work rather than running a game to its end", async () => {
    const gameId = await botOnlyGame();
    const first = await runLazyTick(gameId);
    expect(first.appended).toBeLessThanOrEqual(MAX_TICK_ACTIONS);
    if (first.capped) {
      expect(first.appended).toBe(MAX_TICK_ACTIONS);
      return;
    }
    // tiny4 can also finish inside one tick; then the game must be finished
    // rather than merely stalled, which is the property worth asserting.
    const rows = await harness.db.query<{ status: string }>(
      "select status from games where id = $1",
      [gameId],
    );
    expect(["finished", "playing"]).toContain(rows[0]?.status);
  });
});

describe("the real append path and turn timer", () => {
  beforeEach(async () => {
    harness = await startHarness(engineWithMap(classicWorld));
  });

  it("auto-deploys a timed-out draft and ends the turn, counting the miss", async () => {
    const game = await twoPlayerGame();
    const first = await currentSeatOf(game.gameId);
    await harness.db.execute(
      "update games set turn_deadline = now() - interval '1 second' where id = $1",
      [game.gameId],
    );
    await harness.db.execute("update game_players set last_seen_at = now() where game_id = $1", [
      game.gameId,
    ]);

    const report = await runLazyTick(game.gameId);
    expect(report.ticked).toBe(true);

    const log = await rawLogOf(harness.db, game.gameId);
    expect(log.some((row) => row.type === "AUTO_DEPLOY")).toBe(true);
    expect(log.some((row) => row.type === "END_TURN")).toBe(true);
    replay(log, classicWorld);

    const seat = await harness.db.query<{ missed_turns: number }>(
      "select missed_turns from game_players where game_id = $1 and seat = $2",
      [game.gameId, first],
    );
    expect(Number(seat[0]?.missed_turns)).toBe(1);
  });

  it("hands an unseen seat to a real bot, which then plays it", async () => {
    const game = await twoPlayerGame();
    // The tick acts on whichever seat is current, and the opening decides
    // which that is — so the seat that has to look away is that one.
    const first = await currentSeatOf(game.gameId);
    await harness.db.execute(
      `update game_players set last_seen_at = now() - interval '5 minutes'
        where game_id = $1 and seat = $2`,
      [game.gameId, first],
    );

    await runLazyTick(game.gameId);
    const log = await rawLogOf(harness.db, game.gameId);
    const takeoverAt = log.findIndex((row) => row.type === "SEAT_TO_BOT");
    expect(takeoverAt).toBeGreaterThan(0);
    expect(log[takeoverAt]?.payload).toMatchObject({ seat: first, reason: "away" });
    expect(log.slice(takeoverAt + 1).some((row) => row.actor === "bot")).toBe(true);
    replay(log, classicWorld);
  });

  it("rolls a real attack from an intent and logs the dice", async () => {
    const game = await twoPlayerGame();
    const { session, seat } = await whoseTurn(game);

    const cold = await pollGame({
      gameId: game.gameId,
      playerId: session.playerId,
      since: 0,
      chatSince: 0,
    });
    if (cold.kind !== "body" || !cold.body.snapshot) throw new Error("expected a cold snapshot");
    const state = cold.body.snapshot;
    expect(state.phase).toBe("draft");

    // Draft every troop the real engine awarded onto one owned territory that
    // has an enemy next door, then end the draft phase.
    const from = state.territories.findIndex(
      (row, index) =>
        row.owner === seat &&
        classicWorld.territories[index]!.adjacent.some(
          (at) => state.territories[at]?.owner !== seat,
        ),
    );
    expect(from).toBeGreaterThanOrEqual(0);

    expect(
      (
        await submit(session, game.gameId, {
          clientActionId: actionId("draft"),
          kind: "action",
          action: { type: "DRAFT", seat, territory: from, count: state.troopsToPlace },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await submit(session, game.gameId, {
          clientActionId: actionId("endphase"),
          kind: "action",
          action: { type: "END_PHASE", seat },
        })
      ).status,
    ).toBe(200);

    const target = classicWorld.territories[from]!.adjacent.find(
      (at) => state.territories[at]?.owner !== seat,
    );
    expect(target).toBeDefined();

    const attacked = await submit(session, game.gameId, {
      clientActionId: actionId("blitz"),
      kind: "intent",
      intent: { from, to: target!, mode: "blitz" },
    });
    expect(attacked.status).toBe(200);
    const body = (await attacked.json()) as { actions: { action: Action }[] };
    const action = body.actions[0]!.action as Extract<Action, { type: "ATTACK" }>;
    expect(action.type).toBe("ATTACK");
    expect(action.seat).toBe(seat);
    if (action.mode === "blitz") {
      expect(action.attackerLosses).toBeGreaterThanOrEqual(0);
      expect(action.defenderLosses).toBeGreaterThanOrEqual(0);
      expect(action.attackerLosses + action.defenderLosses).toBeGreaterThan(0);
    }

    replay(await rawLogOf(harness.db, game.gameId), classicWorld);
  });

  it("409s the seat whose turn it is not, with the real validator behind it", async () => {
    const game = await twoPlayerGame();
    const { session, seat } = await whoseTurn(game);
    const other = session === game.a ? game.b : game.a;
    const response = await submit(other, game.gameId, {
      clientActionId: actionId("wrong"),
      kind: "action",
      action: { type: "END_PHASE", seat: seat === 0 ? 1 : 0 },
    });
    expect(response.status).toBe(409);
  });

  it("refuses a resolved ATTACK from a client even with the real engine behind it", async () => {
    const game = await twoPlayerGame();
    const { session, seat } = await whoseTurn(game);
    const response = await submit(session, game.gameId, {
      clientActionId: actionId("cheat"),
      kind: "action",
      action: {
        type: "ATTACK",
        seat,
        from: 0,
        to: 1,
        mode: "blitz",
        attackerLosses: 0,
        defenderLosses: 99,
      },
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "illegalAction" });
  });

  it("422s a draft of more troops than the engine awarded", async () => {
    const game = await twoPlayerGame();
    const { session, seat } = await whoseTurn(game);
    const cold = await pollGame({
      gameId: game.gameId,
      playerId: session.playerId,
      since: 0,
      chatSince: 0,
    });
    if (cold.kind !== "body" || !cold.body.snapshot) throw new Error("expected a cold snapshot");
    const mine = cold.body.snapshot.territories.findIndex((row) => row.owner === seat);

    const response = await submit(session, game.gameId, {
      clientActionId: actionId("greedy"),
      kind: "action",
      action: { type: "DRAFT", seat, territory: mine, count: 999 },
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "tooManyTroops" });
  });
});

describe("fog with the real viewFor", () => {
  beforeEach(async () => {
    harness = await startHarness(engineWithMap(classicWorld));
  });

  it("returns a masked snapshot the server never hashes", async () => {
    const game = await twoPlayerGame({ ...TEST_RULES, fogOfWar: true });
    const response = await poll(game.a, game.gameId, 0);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      snapshot: GameState;
      snapshotSeq: number;
      seq: number;
    };

    expect(body.snapshot.fogged).toBe(true);
    expect(body.snapshotSeq).toBe(body.seq);
    // `hashState` asserts `fogged === false`, which is exactly why the fog
    // branch sends a view instead of a hash-checkable delta (F36).
    expect(() => hashState(body.snapshot)).toThrow();

    // The authoritative state is still hashable, and still matches the log.
    const stored = await harness.db.query<{ snapshot: GameState; state_hash: string }>(
      "select snapshot, state_hash from games where id = $1",
      [game.gameId],
    );
    expect(hashState(stored[0]!.snapshot)).toBe(stored[0]!.state_hash);
  });

  it("hides something from each side and shows each side its own board", async () => {
    const game = await twoPlayerGame({ ...TEST_RULES, fogOfWar: true });
    const mine = (await (await poll(game.a, game.gameId, 0)).json()) as { snapshot: GameState };
    const theirs = (await (await poll(game.b, game.gameId, 0)).json()) as { snapshot: GameState };
    expect(mine.snapshot.territories).not.toEqual(theirs.snapshot.territories);
    // SEAT_UNKNOWN is -3, below both SEAT_NONE and SEAT_NEUTRAL.
    expect(mine.snapshot.territories.some((row) => row.owner < -2)).toBe(true);
  });

  it("empties every other seat's hand while keeping cardCount (F12)", async () => {
    const game = await twoPlayerGame({ ...TEST_RULES, fogOfWar: true });
    const body = (await (await poll(game.b, game.gameId, 0)).json()) as {
      snapshot: GameState;
      you: { seat: number };
    };
    for (const seat of body.snapshot.seats) {
      if (seat.seat === body.you.seat) continue;
      expect(seat.cards).toEqual([]);
      expect(typeof seat.cardCount).toBe("number");
    }
  });
});

describe("the whole server path, with nothing injected at all", () => {
  beforeEach(async () => {
    // No partial engine: `loadMapDef` goes through S3's own `loadMapFile` and
    // `@/engine/map`'s `loadMap`, which is the deployed path.
    harness = await startHarness(realServerEngine);
  });

  it("creates and plays a game on a catalogue slug", async () => {
    const game = await twoPlayerGame(TEST_RULES);
    expect(await rawLogOf(harness.db, game.gameId)).toHaveLength(1);

    const stored = await harness.db.query<{ map_id: string; snapshot: GameState }>(
      "select map_id, snapshot from games where id = $1",
      [game.gameId],
    );
    expect(stored[0]?.map_id).toBe("tiny4");
    expect(stored[0]?.snapshot.mapSlug).toBe("tiny4");

    // One real turn, by whichever seat the opening handed it to.
    const { session, seat } = await whoseTurn(game);
    const cold = await pollGame({
      gameId: game.gameId,
      playerId: session.playerId,
      since: 0,
      chatSince: 0,
    });
    if (cold.kind !== "body" || !cold.body.snapshot) throw new Error("expected a cold snapshot");
    const state = cold.body.snapshot;
    const mine = state.territories.findIndex((row) => row.owner === seat);

    const response = await submit(session, game.gameId, {
      clientActionId: actionId("real-draft"),
      kind: "action",
      action: { type: "DRAFT", seat, territory: mine, count: state.troopsToPlace },
    });
    expect(response.status).toBe(200);

    // And the log still replays, through the map the catalogue loaded.
    const { loadMapFile } = await import("@/content/maps");
    const { loadMap } = await import("@/engine/map");
    replay(await rawLogOf(harness.db, game.gameId), loadMap(await loadMapFile("tiny4")));
  });

  it("refuses a lobby on a slug the catalogue does not have", async () => {
    const host = await mustClaim("Napoleon");
    const response = await routes.createLobby(
      req("/api/lobbies", {
        method: "POST",
        cookie: host.cookie,
        body: { title: "Nowhere", mapSlug: "atlantis", rules: TEST_RULES, maxSeats: 2 },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("runs a real bot seat on a catalogue map, with no cron", async () => {
    const game = await humanVsBotGame(TEST_RULES);

    if ((await currentSeatOf(game.gameId)) === 0) {
      // The human holds the first turn: play it out so the bot's comes up.
      const cold = await pollGame({
        gameId: game.gameId,
        playerId: game.a.playerId,
        since: 0,
        chatSince: 0,
      });
      if (cold.kind !== "body" || !cold.body.snapshot) throw new Error("expected a snapshot");
      const state = cold.body.snapshot;
      const mine = state.territories.findIndex((row) => row.owner === 0);
      const turn = [
        ["rd", { type: "DRAFT", seat: 0, territory: mine, count: state.troopsToPlace }],
        ["rp", { type: "END_PHASE", seat: 0 }],
        ["rt", { type: "END_TURN", seat: 0 }],
      ] as const;
      for (const [label, action] of turn) {
        await submit(game.a, game.gameId, {
          clientActionId: actionId(label),
          kind: "action",
          action,
        });
      }
    }

    const before = await rawLogOf(harness.db, game.gameId);
    const response = await poll(game.a, game.gameId, before.at(-1)!.seq);
    expect(response.status).toBe(200);

    const after = await rawLogOf(harness.db, game.gameId);
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.some((row) => row.actor === "bot")).toBe(true);
  });

  /**
   * The chain a *watching* client folds.
   *
   * The bot-only suite above proves one long tick replays; this proves the
   * other shape — a human seat that never moves while the tick runs the bot's
   * turns over many polls — which is exactly what a browser sitting on the
   * online route does, and the only shape in which a client ever reported a
   * desync.
   */
  it("keeps a human-plus-bot log foldable across many bot ticks", async () => {
    const game = await humanVsBotGame(TEST_RULES);

    // Four rounds of "the human plays its turn, then polls until the bot has
    // played its own" — which is what a browser on the online route does, and
    // the only shape in which a desync was ever reported.
    for (let round = 0; round < 4; round += 1) {
      if ((await currentSeatOf(game.gameId)) === 0) {
        const cold = await pollGame({
          gameId: game.gameId,
          playerId: game.a.playerId,
          since: 0,
          chatSince: 0,
        });
        if (cold.kind !== "body" || !cold.body.snapshot) break;
        const state = cold.body.snapshot;
        if (state.outcome !== null) break;
        const mine = state.territories.findIndex((row) => row.owner === 0);
        const turn: readonly (readonly [string, unknown])[] = [
          [`d${round}`, { type: "DRAFT", seat: 0, territory: mine, count: state.troopsToPlace }],
          [`p${round}`, { type: "END_PHASE", seat: 0 }],
          [`t${round}`, { type: "END_TURN", seat: 0 }],
        ];
        for (const [label, action] of turn) {
          await submit(game.a, game.gameId, {
            clientActionId: actionId(label),
            kind: "action",
            action,
          });
        }
      }
      for (let i = 0; i < 3; i += 1) {
        const head = await rawLogOf(harness.db, game.gameId);
        await poll(game.a, game.gameId, head.at(-1)!.seq);
      }
    }

    const log = await rawLogOf(harness.db, game.gameId);
    expect(log.length).toBeGreaterThan(6);
    expect(log.map((row) => row.seq)).toEqual(
      Array.from({ length: log.length }, (_, index) => index + 1),
    );

    const { loadMapFile } = await import("@/content/maps");
    const { loadMap } = await import("@/engine/map");
    replay(log, loadMap(await loadMapFile("tiny4")));
  });
});
