// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SEAT_NONE, type Action, type GameState, type MapDef, type RuleError } from "@/engine/types";
import { lobbiesRepository } from "@/adapters/db/repositories/lobbies";
import type { LoggedAction } from "@/ports/sync";

import { createGame, runLazyTick } from "../gameService";
import {
  actionId,
  createLobby,
  humanVsBotGame,
  joinLobby,
  mustClaim,
  poll,
  readyUp,
  req,
  routes,
  startGame,
  startHarness,
  submit,
  TEST_RULES,
  twoPlayerGame,
  type Harness,
  type Session,
} from "./harness";
import { fakeApply, fakeEngine, fakeInitialState, fakeValidate } from "./fakeEngine";

/**
 * The online-server repair pass (SPEC §5.5–§5.9, §6).
 *
 * One test per confirmed finding from the review, each naming the behaviour
 * rather than the finding — the point of a regression test is to say what the
 * server owes, so that the next person to change the append path or the tick
 * finds out which promise they broke.
 */

let harness: Harness;

afterEach(async () => {
  await harness.dispose();
});

async function log(
  gameId: string,
): Promise<{ seq: number; type: string; actor: string; payload: Action }[]> {
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

async function deadlineOf(gameId: string): Promise<string | null> {
  const rows = await harness.db.query<{ turn_deadline: string | Date | null }>(
    "select turn_deadline from games where id = $1",
    [gameId],
  );
  const value = rows[0]?.turn_deadline ?? null;
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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

async function draftAndEnd(session: Session, gameId: string, territory: number, tag: string) {
  await submit(session, gameId, {
    clientActionId: actionId(`d-${tag}`),
    kind: "action",
    action: { type: "DRAFT", seat: territory < 3 ? 0 : 1, territory, count: 3 },
  });
  return submit(session, gameId, {
    clientActionId: actionId(`e-${tag}`),
    kind: "action",
    action: { type: "END_TURN", seat: territory < 3 ? 0 : 1 },
  });
}

/* ------------------------------------------------------------ the append -- */

describe("the turn timer belongs to a turn, not to a write (§5.6)", () => {
  beforeEach(async () => {
    harness = await startHarness();
  });

  it("leaves turn_deadline alone when the same seat appends again", async () => {
    const game = await twoPlayerGame();
    await harness.db.execute(
      "update games set turn_deadline = now() + interval '30 seconds' where id = $1",
      [game.gameId],
    );
    const before = await deadlineOf(game.gameId);

    await submit(game.a, game.gameId, {
      clientActionId: actionId("one"),
      kind: "action",
      action: { type: "DRAFT", seat: 0, territory: 0, count: 1 },
    });

    // A seat that drafts one troop every eighty seconds must not be able to
    // hold the board forever.
    expect(await deadlineOf(game.gameId)).toBe(before);
  });

  it("renews it the moment the seat changes hands", async () => {
    const game = await twoPlayerGame();
    await harness.db.execute(
      "update games set turn_deadline = now() + interval '30 seconds' where id = $1",
      [game.gameId],
    );
    const before = await deadlineOf(game.gameId);

    await submit(game.a, game.gameId, {
      clientActionId: actionId("all"),
      kind: "action",
      action: { type: "DRAFT", seat: 0, territory: 0, count: 3 },
    });
    await submit(game.a, game.gameId, {
      clientActionId: actionId("end"),
      kind: "action",
      action: { type: "END_TURN", seat: 0 },
    });

    const after = await deadlineOf(game.gameId);
    expect(after).not.toBe(before);
    expect(Date.parse(after!)).toBeGreaterThan(Date.parse(before!));
  });
});

describe("the card award is the authority's, online too (R20, §5.7)", () => {
  beforeEach(async () => {
    harness = await startHarness();
  });

  /** Three blitz rolls take the fake defender's three troops. */
  async function conquer(session: Session, gameId: string): Promise<void> {
    await submit(session, gameId, {
      clientActionId: actionId("draft"),
      kind: "action",
      action: { type: "DRAFT", seat: 0, territory: 0, count: 3 },
    });
    await submit(session, gameId, {
      clientActionId: actionId("phase"),
      kind: "action",
      action: { type: "END_PHASE", seat: 0 },
    });
    for (let i = 0; i < 3; i += 1) {
      await submit(session, gameId, {
        clientActionId: actionId(`atk${i}`),
        kind: "intent",
        intent: { from: 2, to: 3, mode: "blitz" },
      });
    }
  }

  it("appends CARD_DRAWN when an action leaves the turn in fortify having conquered", async () => {
    const game = await twoPlayerGame();
    await conquer(game.a, game.gameId);

    const before = await log(game.gameId);
    expect(before.some((row) => row.type === "CARD_DRAWN")).toBe(false);

    // END_PHASE out of attack is what puts the turn in fortify, and the award
    // rides the same transaction.
    const response = await submit(game.a, game.gameId, {
      clientActionId: actionId("fortify"),
      kind: "action",
      action: { type: "END_PHASE", seat: 0 },
    });
    expect(response.status).toBe(200);

    const rows = await log(game.gameId);
    const awarded = rows.filter((row) => row.type === "CARD_DRAWN");
    expect(awarded).toHaveLength(1);
    expect(awarded[0]?.actor).toBe("server");
    expect(awarded[0]?.seq).toBe(rows.at(-1)?.seq);

    // The submitter sees it without a second poll, and `seq` names the award.
    const parsed = (await response.json()) as { seq: number; actions: LoggedAction[] };
    expect(parsed.actions.map((action) => action.action.type)).toEqual([
      "END_PHASE",
      "CARD_DRAWN",
    ]);
    expect(parsed.seq).toBe(awarded[0]?.seq);
  });

  it("awards exactly one card per capturing turn", async () => {
    const game = await twoPlayerGame();
    await conquer(game.a, game.gameId);
    await submit(game.a, game.gameId, {
      clientActionId: actionId("fortify"),
      kind: "action",
      action: { type: "END_PHASE", seat: 0 },
    });
    // A second append in the same fortify phase: `conqueredThisTurn` is
    // cleared by the award, so there is nothing more owed.
    await submit(game.a, game.gameId, {
      clientActionId: actionId("end"),
      kind: "action",
      action: { type: "END_TURN", seat: 0 },
    });

    const rows = await log(game.gameId);
    expect(rows.filter((row) => row.type === "CARD_DRAWN")).toHaveLength(1);
  });
});

describe("unstable portals relocate at the start of a round (R76, §5.7)", () => {
  beforeEach(async () => {
    const base = fakeEngine();
    harness = await startHarness({
      ...base,
      // The fake resolver answers `null` always; this one applies R76's own
      // condition, which is what the authority is supposed to ask about.
      movePortals: (state: GameState) =>
        state.round % 3 === 0 ? { type: "PORTALS_MOVED", seat: 0, portals: [] } : null,
    });
  });

  it("appends PORTALS_MOVED after the END_TURN that opens round 3, and not before", async () => {
    const game = await twoPlayerGame({ ...TEST_RULES, portals: "unstable" });

    await draftAndEnd(game.a, game.gameId, 0, "r1a");
    await draftAndEnd(game.b, game.gameId, 3, "r1b"); // → round 2
    expect((await log(game.gameId)).some((row) => row.type === "PORTALS_MOVED")).toBe(false);

    await draftAndEnd(game.a, game.gameId, 0, "r2a");
    await draftAndEnd(game.b, game.gameId, 3, "r2b"); // → round 3

    const rows = await log(game.gameId);
    const moved = rows.filter((row) => row.type === "PORTALS_MOVED");
    expect(moved).toHaveLength(1);
    expect(moved[0]?.actor).toBe("server");
    // Immediately after the END_TURN that opened the round: no seat may act
    // in a round whose portals have not moved yet.
    expect(rows.at(-1)?.type).toBe("PORTALS_MOVED");
    expect(rows.at(-2)?.type).toBe("END_TURN");
  });
});

/* -------------------------------------------------------------- the tick -- */

describe("the timeout fallback can always move the game on (§5.6)", () => {
  beforeEach(async () => {
    const base = fakeEngine();
    harness = await startHarness({
      ...base,
      // An unclaimed board in the claim phase, which is where Manual
      // Placement starts (R9).
      createInitialState: (map: MapDef, started) => ({
        ...fakeInitialState(map, started),
        phase: "claim" as const,
        territories: map.territories.map(() => ({
          owner: SEAT_NONE,
          troops: 0,
          blizzard: false,
        })),
      }),
      // The real validator refuses both phase exits in `claim`; the counter
      // -state one accepts them, which would hide the bug entirely.
      validate: (state: GameState, map: MapDef, action: Action): RuleError | null => {
        if (
          state.phase === "claim" &&
          (action.type === "END_TURN" || action.type === "END_PHASE")
        ) {
          return { code: "wrongPhase", message: "not legal in claim" };
        }
        return fakeValidate(state, map, action);
      },
    });
  });

  it("claims for a seat that times out in the claim phase", async () => {
    const game = await twoPlayerGame({ ...TEST_RULES, manualPlacement: true });
    await expire(game.gameId);
    await seen(game.gameId, 0, "1 second");
    await seen(game.gameId, 1, "1 second");

    const report = await runLazyTick(game.gameId);
    expect(report.ticked).toBe(true);
    // Without a CLAIM candidate the tick finds no legal action at all and
    // every later poll repeats the same no-op: the game is wedged.
    expect(report.appended).toBeGreaterThan(0);

    const rows = await log(game.gameId);
    const claimed = rows.filter((row) => row.type === "CLAIM");
    expect(claimed.length).toBeGreaterThan(0);
    expect(claimed[0]?.actor).toBe("server");
  });
});

describe("the seat takeover counts the miss it is deciding on (§5.6)", () => {
  beforeEach(async () => {
    harness = await startHarness();
  });

  it("hands the seat to a bot on the SECOND expiry, not the third", async () => {
    const game = await twoPlayerGame();
    await harness.db.execute(
      "update game_players set missed_turns = 1 where game_id = $1 and seat = 0",
      [game.gameId],
    );
    await expire(game.gameId);
    await seen(game.gameId, 0, "1 second");
    await seen(game.gameId, 1, "1 second");

    await runLazyTick(game.gameId);
    const takeover = (await log(game.gameId)).find((row) => row.type === "SEAT_TO_BOT");
    expect(takeover?.payload).toMatchObject({ seat: 0, reason: "timeout" });
  });

  it("counts one miss per timed-out turn, not one per auto-skipped action", async () => {
    const game = await twoPlayerGame();
    await expire(game.gameId);
    await seen(game.gameId, 0, "1 second");
    await seen(game.gameId, 1, "1 second");

    await runLazyTick(game.gameId);
    // The turn is AUTO_DEPLOY, then the phase exits down to `END_TURN`: four
    // actions, one missed turn. The count is per timed-out TURN, so it does
    // not matter how many auto-skips the turn takes.
    const rows = await log(game.gameId);
    expect(rows.map((row) => row.type)).toEqual([
      "GAME_STARTED",
      "AUTO_DEPLOY",
      "END_PHASE",
      "END_PHASE",
      "END_TURN",
    ]);
    const seat = await harness.db.query<{ missed_turns: number }>(
      "select missed_turns from game_players where game_id = $1 and seat = 0",
      [game.gameId],
    );
    expect(Number(seat[0]?.missed_turns)).toBe(1);
  });
});

/* -------------------------------------------------------------- the poll -- */

describe("POLL 3 authorises before it changes anything (§6)", () => {
  beforeEach(async () => {
    harness = await startHarness();
  });

  it("403s an outsider without reclaiming a seat or running the tick", async () => {
    const game = await humanVsBotGame();
    await expire(game.gameId); // a tick is now due
    const before = await log(game.gameId);

    const outsider = await mustClaim("Interloper");
    const response = await poll(outsider, game.gameId, 0);
    expect(response.status).toBe(403);

    // The refused request must not have auto-skipped somebody's turn.
    expect(await log(game.gameId)).toHaveLength(before.length);
  });

  it("stamps only the seat of the game being polled", async () => {
    const game = await twoPlayerGame();
    const other = await createGame({
      lobbyId: null,
      mapSlug: "tiny4",
      rules: TEST_RULES,
      seats: [
        {
          seat: 0,
          kind: "human",
          playerId: game.a.playerId,
          tier: null,
          displayName: "Alpha",
          colour: "red",
        },
        {
          seat: 1,
          kind: "human",
          playerId: game.b.playerId,
          tier: null,
          displayName: "Bravo",
          colour: "blue",
        },
      ],
    });
    await harness.db.execute(
      "update game_players set last_seen_at = now() - interval '5 minutes'",
    );

    await poll(game.a, game.gameId, 0);

    const rows = await harness.db.query<{ game_id: string; fresh: boolean }>(
      `select game_id, last_seen_at > now() - interval '10 seconds' as fresh
         from game_players where seat = 0 order by game_id`,
      [],
    );
    const byGame = new Map(rows.map((row) => [row.game_id, row.fresh]));
    expect(byGame.get(game.gameId)).toBe(true);
    // A seat stamp claims "its owner is at THIS board": the other game's seat
    // has to go on ageing towards its away takeover.
    expect(byGame.get(other)).toBe(false);
  });
});

describe("a fog poll's action log is masked like its snapshot (R73, F36)", () => {
  beforeEach(async () => {
    harness = await startHarness();
  });

  /**
   * On the fixture ring, `fakeDeal` gives seat 0 territories 0–2 and seat 1
   * territories 3–5, so seat 1 sees everything except territory 1.
   */
  it("hides an action naming a territory the viewer cannot see, and shows one that does not", async () => {
    const game = await twoPlayerGame({ ...TEST_RULES, fogOfWar: true }, ["Mist", "Haze"]);

    await submit(game.a, game.gameId, {
      clientActionId: actionId("draft"),
      kind: "action",
      action: { type: "DRAFT", seat: 0, territory: 0, count: 3 },
    });
    await submit(game.a, game.gameId, {
      clientActionId: actionId("phase"),
      kind: "action",
      action: { type: "END_PHASE", seat: 0 },
    });
    // 2 → 3 is on seat 1's own border; 1 → 2 starts in the one territory
    // seat 1 cannot see.
    await submit(game.a, game.gameId, {
      clientActionId: actionId("near"),
      kind: "intent",
      intent: { from: 2, to: 3, mode: "blitz" },
    });
    await submit(game.a, game.gameId, {
      clientActionId: actionId("far"),
      kind: "intent",
      intent: { from: 1, to: 2, mode: "blitz" },
    });

    const response = await poll(game.b, game.gameId, 1);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { actions: { action: Record<string, unknown> }[] };

    const attacks = body.actions.filter((row) => row.action["type"] === "ATTACK");
    expect(attacks).toHaveLength(1);
    expect(attacks[0]?.action).toMatchObject({ from: 2, to: 3 });

    const hidden = body.actions.filter((row) => row.action["type"] === "HIDDEN");
    expect(hidden).toHaveLength(1);
    expect(hidden[0]?.action).toEqual({ type: "HIDDEN", seat: 0 });
    // A hidden payload carries the actor and nothing else: no territory, no
    // dice, no losses.
    expect(Object.keys(hidden[0]!.action).sort()).toEqual(["seat", "type"]);

    // The row IS in the log, unredacted — the masking is the poll's, not the
    // append path's (the reducer always sees the truth, R73).
    process.env["NEXT_PUBLIC_RISK_DEBUG"] = "1";
    try {
      const raw = (await (
        await routes.debugActions(
          game.gameId,
          req(`/api/games/${game.gameId}/actions?from=0`, { cookie: game.b.cookie }),
        )
      ).json()) as { actions: { action: Record<string, unknown> }[] };
      expect(
        raw.actions.filter((entry) => entry.action["type"] === "ATTACK"),
      ).toHaveLength(2);
      expect(raw.actions.some((entry) => entry.action["from"] === 1)).toBe(true);
    } finally {
      delete process.env["NEXT_PUBLIC_RISK_DEBUG"];
    }
  });

  it("omits GAME_STARTED entirely", async () => {
    const game = await twoPlayerGame({ ...TEST_RULES, fogOfWar: true }, ["Mist", "Haze"]);
    const response = await poll(game.b, game.gameId, 0);
    const body = (await response.json()) as { actions: { action: { type: string } }[] };
    expect(body.actions.some((row) => row.action.type === "GAME_STARTED")).toBe(false);
  });

  it("keeps another seat's CARD_DRAWN but not their card", async () => {
    const game = await twoPlayerGame({ ...TEST_RULES, fogOfWar: true }, ["Mist", "Haze"]);
    await submit(game.a, game.gameId, {
      clientActionId: actionId("draft"),
      kind: "action",
      action: { type: "DRAFT", seat: 0, territory: 0, count: 3 },
    });
    await submit(game.a, game.gameId, {
      clientActionId: actionId("phase"),
      kind: "action",
      action: { type: "END_PHASE", seat: 0 },
    });
    for (let i = 0; i < 3; i += 1) {
      await submit(game.a, game.gameId, {
        clientActionId: actionId(`atk${i}`),
        kind: "intent",
        intent: { from: 2, to: 3, mode: "blitz" },
      });
    }
    await submit(game.a, game.gameId, {
      clientActionId: actionId("fortify"),
      kind: "action",
      action: { type: "END_PHASE", seat: 0 },
    });

    const theirs = (await (await poll(game.b, game.gameId, 1)).json()) as {
      actions: { action: Record<string, unknown> }[];
    };
    const masked = theirs.actions.find((row) => row.action["type"] === "CARD_DRAWN");
    expect(masked?.action).toEqual({ type: "CARD_DRAWN", seat: 0, card: null });

    const mine = (await (await poll(game.a, game.gameId, 1)).json()) as {
      actions: { action: Record<string, unknown> }[];
    };
    const own = mine.actions.find((row) => row.action["type"] === "CARD_DRAWN");
    expect(own?.action["card"]).toMatchObject({ id: expect.any(String) });
  });
});

/* ------------------------------------------------------------- the lobby -- */

describe("one lobby becomes one game (§6, §7)", () => {
  beforeEach(async () => {
    harness = await startHarness();
  });

  it("creates one game from two simultaneous BATTLE presses", async () => {
    const host = await mustClaim("Napoleon");
    const guest = await mustClaim("Wellington");
    const code = await createLobby(host, { maxSeats: 2 });
    await joinLobby(guest, code);
    await readyUp(host, code);
    await readyUp(guest, code);

    const [first, second] = await Promise.all([
      startGame(host, code),
      startGame(host, code),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(await harness.db.query("select id from games")).toHaveLength(1);
  });

  it("refuses a join once the lobby has left `open`, in the seat-taking statement itself", async () => {
    const host = await mustClaim("Napoleon");
    const guest = await mustClaim("Wellington");
    const code = await createLobby(host, { maxSeats: 3 });
    // The state a `BATTLE` press leaves behind while it deals the board. The
    // handler's own status read is bypassed here on purpose: what is under
    // test is the fence inside the `update`.
    await harness.db.execute("update lobbies set status = 'starting' where id = $1", [code]);

    const seat = await lobbiesRepository(harness.db).join(code, guest.playerId, null);
    expect(seat).toBe("gameAlreadyStarted");
    const rows = await harness.db.query<{ kind: string }>(
      "select kind from lobby_seats where lobby_id = $1 and seat = 1",
      [code],
    );
    expect(rows[0]?.kind).toBe("open");
  });

  it("holds one live lobby per host in the database, not in a handler's read", async () => {
    const host = await mustClaim("Napoleon");
    const lobbies = lobbiesRepository(harness.db);
    const input = {
      hostId: host.playerId,
      title: "Austerlitz",
      mapSlug: "tiny4",
      rules: TEST_RULES,
      maxSeats: 2,
    };
    // The handler's `hostedBy` read is bypassed on purpose: two create
    // requests from one player both pass it, and what has to stop the second
    // lobby existing is `lobbies_one_live_per_host`.
    expect(await lobbies.create(input)).not.toBe("alreadyHosting");
    expect(await lobbies.create(input)).toBe("alreadyHosting");
    expect(await harness.db.query("select id from lobbies")).toHaveLength(1);
  });

  it("answers 409 alreadyHosting from the index as well as from the read", async () => {
    const host = await mustClaim("Napoleon");
    const body = { title: "Austerlitz", mapSlug: "tiny4", rules: TEST_RULES, maxSeats: 2 };
    const [first, second] = await Promise.all([
      routes.createLobby(req("/api/lobbies", { method: "POST", cookie: host.cookie, body })),
      routes.createLobby(req("/api/lobbies", { method: "POST", cookie: host.cookie, body })),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const loser = first.status === 409 ? first : second;
    expect(await loser.json()).toMatchObject({ error: "alreadyHosting" });
    expect(await harness.db.query("select id from lobbies")).toHaveLength(1);
  });
});

describe("a presence change is never a 204 (§6, D12)", () => {
  beforeEach(async () => {
    harness = await startHarness();
  });

  it("moves POLL 1's version when a listed player goes offline", async () => {
    const watcher = await mustClaim("Napoleon");
    const other = await mustClaim("Wellington");

    const first = (await (
      await routes.pollLobby(req("/api/lobby?since=0", { cookie: watcher.cookie }))
    ).json()) as { version: number; players: { online: boolean }[] };
    expect(first.players).toHaveLength(2);
    expect(first.players.every((player) => player.online)).toBe(true);

    // Still listed (seen inside five minutes), no longer `online` (45 s) — so
    // the count this cursor used to carry has not moved at all.
    await harness.db.execute(
      "update players set last_seen_at = now() - interval '2 minutes' where id = $1",
      [other.playerId],
    );

    const second = await routes.pollLobby(
      req(`/api/lobby?since=${first.version}`, { cookie: watcher.cookie }),
    );
    expect(second.status).toBe(200);
    const body = (await second.json()) as { version: number; players: { online: boolean }[] };
    expect(body.version).not.toBe(first.version);
    expect(body.players.filter((player) => player.online)).toHaveLength(1);
  });

  it("moves POLL 2's version when a seat's occupant goes offline", async () => {
    const host = await mustClaim("Napoleon");
    const guest = await mustClaim("Wellington");
    const code = await createLobby(host, { maxSeats: 2 });
    await joinLobby(guest, code);

    const first = (await (
      await routes.pollRoom(code, req(`/api/lobbies/${code}?since=0`, { cookie: host.cookie }))
    ).json()) as { version: number };

    await harness.db.execute(
      "update players set last_seen_at = now() - interval '2 minutes' where id = $1",
      [guest.playerId],
    );

    // Nothing bumped `lobbies.version`, and the body's `seats[].online` has
    // changed, so a `204` here would leave every client showing a player who
    // has gone.
    const second = await routes.pollRoom(
      code,
      req(`/api/lobbies/${code}?since=${first.version}`, { cookie: host.cookie }),
    );
    expect(second.status).toBe(200);
    const body = (await second.json()) as { version: number; seats: { online: boolean }[] };
    expect(body.version).not.toBe(first.version);
    expect(body.seats[1]?.online).toBe(false);
  });

  it("still answers 204 when nothing at all has moved", async () => {
    const host = await mustClaim("Napoleon");
    const code = await createLobby(host, { maxSeats: 2 });
    const first = (await (
      await routes.pollRoom(code, req(`/api/lobbies/${code}?since=0`, { cookie: host.cookie }))
    ).json()) as { version: number };
    const again = await routes.pollRoom(
      code,
      req(`/api/lobbies/${code}?since=${first.version}`, { cookie: host.cookie }),
    );
    expect(again.status).toBe(204);
  });
});

/* -------------------------------------------------------------- the chat -- */

describe("the ally-only lines need an alliance (R80, §5.9)", () => {
  beforeEach(async () => {
    const base = fakeEngine();
    harness = await startHarness({
      ...base,
      // The counter-state reducer ignores the alliance actions; this one
      // records the pact, which is what the gate reads.
      apply: (state: GameState, map: MapDef, action: Action) => {
        if (action.type !== "ALLIANCE_ACCEPT") return fakeApply(state, map, action);
        const pair = [action.seat, action.from];
        return {
          state: {
            ...state,
            seats: state.seats.map((row) =>
              pair.includes(row.seat)
                ? { ...row, allies: pair.filter((other) => other !== row.seat) }
                : row,
            ),
          },
          events: [],
        };
      },
    });
  });

  async function say(session: Session, gameId: string, lineId: number): Promise<Response> {
    return routes.postChat(
      req("/api/chat", {
        method: "POST",
        cookie: session.cookie,
        body: { scope: "game", scopeId: gameId, lineId },
      }),
    );
  }

  it("422s line 28 from a seat with no pact, and 201s an ordinary line", async () => {
    const game = await twoPlayerGame({ ...TEST_RULES, alliances: true });

    const refused = await say(game.a, game.gameId, 28);
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ code: "illegalAction" });

    expect((await say(game.a, game.gameId, 1)).status).toBe(201);
    expect(await harness.db.query("select id from chat_messages")).toHaveLength(1);
  });

  it("accepts lines 28 and 29 once the alliance is in the log", async () => {
    const game = await twoPlayerGame({ ...TEST_RULES, alliances: true });
    const accepted = await submit(game.a, game.gameId, {
      clientActionId: actionId("ally"),
      kind: "action",
      action: { type: "ALLIANCE_ACCEPT", seat: 0, from: 1 },
    });
    expect(accepted.status).toBe(200);

    expect((await say(game.a, game.gameId, 28)).status).toBe(201);
    expect((await say(game.b, game.gameId, 29)).status).toBe(201);
  });
});
