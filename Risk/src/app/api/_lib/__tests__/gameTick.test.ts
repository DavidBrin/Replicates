// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Action, GameState, MapDef } from "@/engine/types";

import { createGame, runLazyTick } from "../gameService";
import { MAX_TICK_ACTIONS, spreadPlacements } from "../gameState";
import {
  actionId,
  humanVsBotGame,
  poll,
  startHarness,
  submit,
  TEST_RULES,
  twoPlayerGame,
  type Harness,
} from "./harness";
import { fakeEngine } from "./fakeEngine";

/**
 * The lazy tick (SPEC §5.6, T9): bot turns with no cron, the turn timer, the
 * two seat-to-bot reasons, the reclaim, the lease, and the
 * `MAX_TICK_ACTIONS` cap.
 */

let harness: Harness;

beforeEach(async () => {
  harness = await startHarness();
});

afterEach(async () => {
  await harness.dispose();
});

async function log(gameId: string): Promise<{ seq: number; type: string; actor: string; payload: Action }[]> {
  const rows = await harness.db.query<{
    seq: string | number;
    type: string;
    actor: string;
    payload: Action;
  }>("select seq, type, actor, payload from game_actions where game_id = $1 order by seq", [
    gameId,
  ]);
  return rows.map((row) => ({ ...row, seq: Number(row.seq) }));
}

async function expire(gameId: string): Promise<void> {
  await harness.db.execute(
    "update games set turn_deadline = now() - interval '1 second' where id = $1",
    [gameId],
  );
}

async function seen(gameId: string, seat: number, ago: string): Promise<void> {
  await harness.db.execute(
    `update game_players set last_seen_at = now() - $3::interval
      where game_id = $1 and seat = $2`,
    [gameId, seat, ago],
  );
}

describe("spreadPlacements", () => {
  it("spreads round-robin over the lowest ids first", () => {
    expect(spreadPlacements([4, 0, 2], 4)).toEqual([
      { territory: 0, count: 2 },
      { territory: 2, count: 1 },
      { territory: 4, count: 1 },
    ]);
  });

  it("places every troop and nothing more", () => {
    for (const troops of [1, 3, 7, 20]) {
      const placements = spreadPlacements([1, 2, 3], troops);
      expect(placements.reduce((sum, row) => sum + row.count, 0)).toBe(troops);
    }
  });

  it("places nothing with no targets or no troops", () => {
    expect(spreadPlacements([], 5)).toEqual([]);
    expect(spreadPlacements([1, 2], 0)).toEqual([]);
  });
});

describe("a bot's turn runs inside whichever poll arrives (D13)", () => {
  it("needs no cron: a human's END_TURN is followed by the bot's actions", async () => {
    const game = await humanVsBotGame();

    await submit(game.a, game.gameId, {
      clientActionId: actionId("draft"),
      kind: "action",
      action: { type: "DRAFT", seat: 0, territory: 0, count: 3 },
    });
    await submit(game.a, game.gameId, {
      clientActionId: actionId("end"),
      kind: "action",
      action: { type: "END_TURN", seat: 0 },
    });

    const before = await log(game.gameId);
    expect(before.at(-1)?.type).toBe("END_TURN");

    // One poll, no scheduler, no cron.
    const response = await poll(game.a, game.gameId, before.at(-1)!.seq);
    expect(response.status).toBe(200);

    const after = await log(game.gameId);
    expect(after.length).toBeGreaterThan(before.length);
    const botRows = after.filter((row) => row.actor === "bot");
    expect(botRows.length).toBeGreaterThan(0);
    // It stopped at the live human's turn rather than playing for them.
    expect(after.at(-1)?.type).toBe("END_TURN");
    const head = await harness.db.query<{ current_seat: number }>(
      "select current_seat from games where id = $1",
      [game.gameId],
    );
    expect(Number(head[0]?.current_seat)).toBe(0);
  });

  it("delivers the bot's actions to the poll that ran them", async () => {
    const game = await humanVsBotGame();
    await submit(game.a, game.gameId, {
      clientActionId: actionId("draft"),
      kind: "action",
      action: { type: "DRAFT", seat: 0, territory: 0, count: 3 },
    });
    await submit(game.a, game.gameId, {
      clientActionId: actionId("end"),
      kind: "action",
      action: { type: "END_TURN", seat: 0 },
    });

    const response = await poll(game.a, game.gameId, 3);
    const body = (await response.json()) as { actions: { actor: string }[] };
    expect(body.actions.some((action) => action.actor === "bot")).toBe(true);
  });

  it("clears the lease it took, so the next poll can tick again", async () => {
    const game = await humanVsBotGame();
    await submit(game.a, game.gameId, {
      clientActionId: actionId("draft"),
      kind: "action",
      action: { type: "DRAFT", seat: 0, territory: 0, count: 3 },
    });
    await submit(game.a, game.gameId, {
      clientActionId: actionId("end"),
      kind: "action",
      action: { type: "END_TURN", seat: 0 },
    });
    await poll(game.a, game.gameId, 3);

    const rows = await harness.db.query<{ tick_lease: string | null }>(
      "select tick_lease from games where id = $1",
      [game.gameId],
    );
    expect(rows[0]?.tick_lease).toBeNull();
  });

  it("does not tick at all while a live human is inside their deadline", async () => {
    const game = await twoPlayerGame();
    const before = await log(game.gameId);
    const report = await runLazyTick(game.gameId);
    expect(report).toEqual({ ticked: false, appended: 0, capped: false });
    expect(await log(game.gameId)).toHaveLength(before.length);
  });

  it("refuses the lease to a second tick while the first holds it", async () => {
    const game = await humanVsBotGame();
    await harness.db.execute(
      "update games set tick_lease = now() + interval '10 seconds' where id = $1",
      [game.gameId],
    );
    await expire(game.gameId);
    const report = await runLazyTick(game.gameId);
    expect(report.ticked).toBe(false);
  });

  it("takes an expired lease over from a tick that died", async () => {
    const game = await humanVsBotGame();
    await harness.db.execute(
      "update games set tick_lease = now() - interval '1 second' where id = $1",
      [game.gameId],
    );
    await expire(game.gameId);
    const report = await runLazyTick(game.gameId);
    expect(report.ticked).toBe(true);
    expect(report.appended).toBeGreaterThan(0);
  });

  it("writes bot_memory in the same transaction that appends the tick", async () => {
    const game = await humanVsBotGame();
    await submit(game.a, game.gameId, {
      clientActionId: actionId("draft"),
      kind: "action",
      action: { type: "DRAFT", seat: 0, territory: 0, count: 3 },
    });
    await submit(game.a, game.gameId, {
      clientActionId: actionId("end"),
      kind: "action",
      action: { type: "END_TURN", seat: 0 },
    });
    await runLazyTick(game.gameId);

    const rows = await harness.db.query<{ bot_memory: Record<string, { grudge: number[] }> }>(
      "select bot_memory from games where id = $1",
      [game.gameId],
    );
    expect(rows[0]?.bot_memory["1"]?.grudge).toHaveLength(2);
  });
});

describe("the MAX_TICK_ACTIONS cap", () => {
  it("chains consecutive bot seats and stops at the cap, leaving the rest for the next poll", async () => {
    // A bot-only game: nothing in the loop is a live human, so the only thing
    // that can stop it is the cap.
    const gameId = await createGame({
      lobbyId: null,
      mapSlug: "ring",
      rules: TEST_RULES,
      seats: [
        {
          seat: 0,
          kind: "bot",
          playerId: null,
          tier: "medium",
          displayName: "Bot A",
          colour: "red",
        },
        {
          seat: 1,
          kind: "bot",
          playerId: null,
          tier: "medium",
          displayName: "Bot B",
          colour: "blue",
        },
      ],
    });

    const first = await runLazyTick(gameId);
    expect(first.ticked).toBe(true);
    expect(first.appended).toBe(MAX_TICK_ACTIONS);
    expect(first.capped).toBe(true);

    const after = await log(gameId);
    expect(after).toHaveLength(MAX_TICK_ACTIONS + 1);
    expect(after.map((row) => row.seq)).toEqual(
      Array.from({ length: MAX_TICK_ACTIONS + 1 }, (_, index) => index + 1),
    );

    // The next poll picks the work up where this one left off.
    const second = await runLazyTick(gameId);
    expect(second.appended).toBe(MAX_TICK_ACTIONS);
    expect(await log(gameId)).toHaveLength(MAX_TICK_ACTIONS * 2 + 1);
  });

  it("keeps games.seq in step with the log it just appended", async () => {
    const gameId = await createGame({
      lobbyId: null,
      mapSlug: "ring",
      rules: TEST_RULES,
      seats: [
        { seat: 0, kind: "bot", playerId: null, tier: "easy", displayName: "A", colour: "red" },
        { seat: 1, kind: "bot", playerId: null, tier: "easy", displayName: "B", colour: "blue" },
      ],
    });
    await runLazyTick(gameId);
    const rows = await harness.db.query<{ seq: string | number; max: string | number }>(
      `select g.seq, (select max(seq) from game_actions where game_id = g.id) as max
         from games g where g.id = $1`,
      [gameId],
    );
    expect(Number(rows[0]?.seq)).toBe(Number(rows[0]?.max));
  });
});

describe("the turn timer (§5.6)", () => {
  it("auto-deploys an undrafted turn and ends it, counting one missed turn", async () => {
    const game = await twoPlayerGame();
    await expire(game.gameId);
    await seen(game.gameId, 0, "1 second");
    await seen(game.gameId, 1, "1 second");

    const report = await runLazyTick(game.gameId);
    expect(report.ticked).toBe(true);

    const rows = await log(game.gameId);
    expect(rows.map((row) => row.type)).toEqual(["GAME_STARTED", "AUTO_DEPLOY", "END_TURN"]);
    expect(rows[1]?.actor).toBe("server");

    const seat = await harness.db.query<{ missed_turns: number }>(
      "select missed_turns from game_players where game_id = $1 and seat = 0",
      [game.gameId],
    );
    expect(Number(seat[0]?.missed_turns)).toBe(1);
  });

  it("hands the seat to a bot with reason 'timeout' once two turns are missed", async () => {
    const game = await twoPlayerGame();
    await harness.db.execute(
      "update game_players set missed_turns = 2 where game_id = $1 and seat = 0",
      [game.gameId],
    );
    await expire(game.gameId);
    await seen(game.gameId, 0, "1 second");
    await seen(game.gameId, 1, "1 second");

    await runLazyTick(game.gameId);
    const rows = await log(game.gameId);
    const takeover = rows.find((row) => row.type === "SEAT_TO_BOT");
    expect(takeover?.payload).toMatchObject({ seat: 0, reason: "timeout" });
    expect(takeover?.actor).toBe("server");

    const seat = await harness.db.query<{ kind: string; standing: string }>(
      "select kind, standing from game_players where game_id = $1 and seat = 0",
      [game.gameId],
    );
    expect(seat[0]).toMatchObject({ kind: "bot", standing: "away" });
  });

  it("hands the seat to a bot with reason 'away' when unseen for two minutes, whatever the turn count", async () => {
    const game = await twoPlayerGame();
    await seen(game.gameId, 0, "3 minutes");

    await runLazyTick(game.gameId);
    const takeover = (await log(game.gameId)).find((row) => row.type === "SEAT_TO_BOT");
    expect(takeover?.payload).toMatchObject({ seat: 0, reason: "away" });
  });

  it("carries the persona the SEAT_TO_BOT row has to have", async () => {
    const game = await twoPlayerGame();
    await seen(game.gameId, 0, "3 minutes");
    await runLazyTick(game.gameId);

    const takeover = (await log(game.gameId)).find((row) => row.type === "SEAT_TO_BOT");
    const payload = takeover?.payload as Extract<Action, { type: "SEAT_TO_BOT" }>;
    expect(payload.tier).toBe(TEST_RULES.aiDifficulty);
    expect(payload.persona).toMatchObject({ name: expect.any(String), tier: "medium" });
  });

  it("plays the newly-botted seat out in the same tick and hands the clock to the next human", async () => {
    const game = await twoPlayerGame();
    await seen(game.gameId, 0, "3 minutes");
    await runLazyTick(game.gameId);

    const rows = await log(game.gameId);
    const takeoverAt = rows.findIndex((row) => row.type === "SEAT_TO_BOT");
    // The bot does not wait for the next poll: the loop sees the seat is now
    // a bot and plays it, which is the whole point of appending the takeover
    // as an action rather than as a side effect.
    expect(rows.slice(takeoverAt + 1).some((row) => row.actor === "bot")).toBe(true);

    const head = await harness.db.query<{ turn_deadline: string | null; current_seat: number }>(
      "select turn_deadline, current_seat from games where id = $1",
      [game.gameId],
    );
    expect(Number(head[0]?.current_seat)).toBe(1);
    expect(head[0]?.turn_deadline).not.toBeNull();
  });

  it("clears the turn deadline while a bot seat is the current one", async () => {
    const game = await humanVsBotGame();
    await submit(game.a, game.gameId, {
      clientActionId: actionId("draft"),
      kind: "action",
      action: { type: "DRAFT", seat: 0, territory: 0, count: 3 },
    });
    await submit(game.a, game.gameId, {
      clientActionId: actionId("end"),
      kind: "action",
      action: { type: "END_TURN", seat: 0 },
    });
    // Between the human's END_TURN and the tick, seat 1 (a bot) is current
    // and there is nobody to time out.
    const head = await harness.db.query<{ turn_deadline: string | null; current_seat: number }>(
      "select turn_deadline, current_seat from games where id = $1",
      [game.gameId],
    );
    expect(Number(head[0]?.current_seat)).toBe(1);
    expect(head[0]?.turn_deadline).toBeNull();
  });
});

describe("the reclaim (§5.6, R82)", () => {
  it("flips an away seat back to its human on their next poll", async () => {
    const game = await twoPlayerGame();
    await seen(game.gameId, 0, "3 minutes");
    await runLazyTick(game.gameId);
    expect(
      (await log(game.gameId)).some((row) => row.type === "SEAT_TO_BOT"),
    ).toBe(true);

    // Alpha comes back. One poll both reclaims the seat and sees the game.
    const response = await poll(game.a, game.gameId, 1);
    expect(response.status).toBe(200);

    const rows = await log(game.gameId);
    expect(rows.some((row) => row.type === "SEAT_TO_HUMAN")).toBe(true);

    const seat = await harness.db.query<{ kind: string; standing: string; missed_turns: number }>(
      "select kind, standing, missed_turns from game_players where game_id = $1 and seat = 0",
      [game.gameId],
    );
    expect(seat[0]).toMatchObject({ kind: "human", standing: "active" });
    expect(Number(seat[0]?.missed_turns)).toBe(0);
  });

  it("never reclaims a resigned seat", async () => {
    const game = await twoPlayerGame();
    await harness.db.execute(
      "update game_players set kind = 'bot', standing = 'resigned' where game_id = $1 and seat = 1",
      [game.gameId],
    );
    await poll(game.b, game.gameId, 1);
    expect((await log(game.gameId)).some((row) => row.type === "SEAT_TO_HUMAN")).toBe(false);
  });

  it("is a no-op for a seat that is already a human", async () => {
    const game = await twoPlayerGame();
    const before = await log(game.gameId);
    await poll(game.a, game.gameId, 1);
    expect(await log(game.gameId)).toHaveLength(before.length);
  });
});

describe("the tick stops at a finished game", () => {
  it("never appends past an outcome", async () => {
    const overEngine = fakeEngine();
    const restore = await startHarness({
      ...overEngine,
      apply: (state: GameState, map: MapDef, action: Action) => {
        const result = overEngine.apply(state, map, action);
        if (result.error || action.type !== "END_TURN") return result;
        return {
          ...result,
          state: {
            ...result.state,
            outcome: { winner: 0, reason: "world" as const, tiebreak: false, round: 1 },
          },
        };
      },
    });
    try {
      const gameId = await createGame({
        lobbyId: null,
        mapSlug: "ring",
        rules: TEST_RULES,
        seats: [
          { seat: 0, kind: "bot", playerId: null, tier: "easy", displayName: "A", colour: "red" },
          { seat: 1, kind: "bot", playerId: null, tier: "easy", displayName: "B", colour: "blue" },
        ],
      });
      const report = await runLazyTick(gameId);
      expect(report.capped).toBe(false);
      expect(report.appended).toBeLessThan(MAX_TICK_ACTIONS);

      const rows = await restore.db.query<{ status: string; winner_seat: number | null }>(
        "select status, winner_seat from games where id = $1",
        [gameId],
      );
      expect(rows[0]).toMatchObject({ status: "finished" });
      expect(Number(rows[0]?.winner_seat)).toBe(0);

      // And a second tick adds nothing at all.
      const again = await runLazyTick(gameId);
      expect(again).toEqual({ ticked: false, appended: 0, capped: false });
    } finally {
      await restore.dispose();
    }
  });
});
