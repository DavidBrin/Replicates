// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ChatLine } from "@/ports/sync";

import { GET as health } from "@/app/api/health/route";
import { GET as cronSweep } from "@/app/api/cron/sweep/route";

import { EMOJI_IDS } from "../schemas";
import { CRON_LIMIT, maybeSweep, resetSweepClockForTests, sweep, SWEEP_INTERVAL_MS } from "../reaper";
import { COMPACTION_THRESHOLD } from "../gameState";
import {
  createLobby,
  joinLobby,
  mustClaim,
  poll,
  req,
  routes,
  startHarness,
  twoPlayerGame,
  type Harness,
  type Session,
} from "./harness";

/**
 * Chat (SPEC §5.9), the lazy reaper (§6.3), `/api/health` and
 * `/api/cron/sweep` (§6).
 */

let harness: Harness;

beforeEach(async () => {
  harness = await startHarness();
});

afterEach(async () => {
  await harness.dispose();
});

function chat(session: Session, body: unknown): Promise<Response> {
  return routes.postChat(req("/api/chat", { method: "POST", cookie: session.cookie, body }));
}

describe("POST /api/chat", () => {
  it("accepts a line id and an emoji id, one at a time", async () => {
    const player = await mustClaim("Napoleon");
    const line = await chat(player, { scope: "global", lineId: 20 });
    expect(line.status).toBe(201);
    expect(await line.json()).toMatchObject({ id: expect.any(Number) });

    const emoji = await chat(player, { scope: "global", emoji: "swords" });
    expect(emoji.status).toBe(201);
  });

  it("refuses both fields at once, and neither", async () => {
    const player = await mustClaim("Napoleon");
    expect((await chat(player, { scope: "global", lineId: 1, emoji: "grin" })).status).toBe(400);
    expect((await chat(player, { scope: "global" })).status).toBe(400);
  });

  it("refuses a line outside the 42-line roster and an unknown emoji id", async () => {
    const player = await mustClaim("Napoleon");
    expect((await chat(player, { scope: "global", lineId: 0 })).status).toBe(400);
    expect((await chat(player, { scope: "global", lineId: 43 })).status).toBe(400);
    expect((await chat(player, { scope: "global", emoji: "sparkles" })).status).toBe(400);
  });

  it("has no free-text path at all", async () => {
    const player = await mustClaim("Napoleon");
    // The body a free-text design would send; there is no column for it and
    // no field in the schema, so it is a 400 rather than a stored string.
    expect((await chat(player, { scope: "global", body: "gg" })).status).toBe(400);
    const rows = await harness.db.query("select id from chat_messages");
    expect(rows).toHaveLength(0);
  });

  it("accepts all eight glyph ids", async () => {
    const player = await mustClaim("Napoleon");
    for (const emoji of EMOJI_IDS) {
      expect((await chat(player, { scope: "global", emoji })).status, emoji).toBe(201);
    }
  });

  it("refuses a lobby or game scope with no scopeId", async () => {
    const player = await mustClaim("Napoleon");
    expect((await chat(player, { scope: "lobby", lineId: 1 })).status).toBe(400);
    expect((await chat(player, { scope: "game", lineId: 1 })).status).toBe(400);
  });

  it("403s a lobby line from somebody not seated in it", async () => {
    const host = await mustClaim("Napoleon");
    const outsider = await mustClaim("Wellington");
    const code = await createLobby(host, { maxSeats: 2 });

    expect((await chat(host, { scope: "lobby", scopeId: code, lineId: 1 })).status).toBe(201);
    expect((await chat(outsider, { scope: "lobby", scopeId: code, lineId: 1 })).status).toBe(403);

    await joinLobby(outsider, code);
    expect((await chat(outsider, { scope: "lobby", scopeId: code, lineId: 1 })).status).toBe(201);
  });

  it("403s a game line from somebody with no seat", async () => {
    const game = await twoPlayerGame();
    const outsider = await mustClaim("Blucher");
    expect((await chat(game.a, { scope: "game", scopeId: game.gameId, lineId: 34 })).status).toBe(
      201,
    );
    expect(
      (await chat(outsider, { scope: "game", scopeId: game.gameId, lineId: 34 })).status,
    ).toBe(403);
  });

  it("401s without a cookie", async () => {
    expect(
      (await routes.postChat(req("/api/chat", { method: "POST", body: { scope: "global", lineId: 1 } })))
        .status,
    ).toBe(401);
  });
});

describe("chat rides the polls", () => {
  it("arrives on POLL 3 and moves the client's chat cursor", async () => {
    const game = await twoPlayerGame();
    await chat(game.a, { scope: "game", scopeId: game.gameId, lineId: 20 });

    const response = await poll(game.b, game.gameId, 0, 0);
    const body = (await response.json()) as { chat: ChatLine[] };
    expect(body.chat).toHaveLength(1);
    expect(body.chat[0]).toMatchObject({
      scope: "game",
      displayName: "Alpha",
      lineId: 20,
      emoji: null,
    });
    expect(body.chat[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Already seen: the next poll with that cursor carries nothing new.
    const again = await poll(game.b, game.gameId, body.chat[0]!.id, body.chat[0]!.id);
    expect(again.status).toBe(204);
  });

  it("breaks the 204 for a new line even when seq has not moved", async () => {
    const game = await twoPlayerGame();
    const first = (await (await poll(game.a, game.gameId, 0)).json()) as { seq: number };
    expect((await poll(game.a, game.gameId, first.seq)).status).toBe(204);

    await chat(game.b, { scope: "game", scopeId: game.gameId, emoji: "handshake" });
    const response = await poll(game.a, game.gameId, first.seq, 0);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { chat: ChatLine[]; actions: unknown[] };
    expect(body.chat).toHaveLength(1);
    expect(body.actions).toEqual([]);
  });

  it("arrives on POLL 1 for the global scope and POLL 2 for a lobby", async () => {
    const host = await mustClaim("Napoleon");
    const code = await createLobby(host, { maxSeats: 2 });
    await chat(host, { scope: "global", lineId: 1 });
    await chat(host, { scope: "lobby", scopeId: code, lineId: 2 });

    const browse = (await (
      await routes.pollLobby(req("/api/lobby?since=0&chatSince=0", { cookie: host.cookie }))
    ).json()) as { chat: ChatLine[] };
    expect(browse.chat.map((line) => line.lineId)).toEqual([1]);

    const room = (await (
      await routes.pollRoom(
        code,
        req(`/api/lobbies/${code}?since=0&chatSince=0`, { cookie: host.cookie }),
      )
    ).json()) as { chat: ChatLine[] };
    expect(room.chat.map((line) => line.lineId)).toEqual([2]);
  });

  it("keeps the scopes apart", async () => {
    const game = await twoPlayerGame();
    await chat(game.a, { scope: "global", lineId: 1 });
    const body = (await (await poll(game.a, game.gameId, 0, 0)).json()) as { chat: ChatLine[] };
    expect(body.chat).toEqual([]);
  });

  it("returns lines oldest first so a client can append them", async () => {
    const game = await twoPlayerGame();
    for (const lineId of [1, 2, 3]) {
      await chat(game.a, { scope: "game", scopeId: game.gameId, lineId });
    }
    const body = (await (await poll(game.b, game.gameId, 0, 0)).json()) as { chat: ChatLine[] };
    expect(body.chat.map((line) => line.lineId)).toEqual([1, 2, 3]);
    expect(body.chat.map((line) => line.id)).toEqual([...body.chat.map((line) => line.id)].sort((a, b) => a - b));
  });
});

describe("the lazy reaper (§6.3)", () => {
  it("closes a lobby that has been open and untouched for 20 minutes", async () => {
    const host = await mustClaim("Napoleon");
    const code = await createLobby(host);
    await harness.db.execute(
      "update lobbies set updated_at = now() - interval '25 minutes' where id = $1",
      [code],
    );

    const report = await sweep(50);
    expect(report.staleLobbies).toBe(1);

    const rows = await harness.db.query<{ status: string }>(
      "select status from lobbies where id = $1",
      [code],
    );
    expect(rows[0]?.status).toBe("closed");
  });

  it("leaves a fresh lobby alone", async () => {
    const host = await mustClaim("Napoleon");
    await createLobby(host);
    expect((await sweep(50)).staleLobbies).toBe(0);
  });

  it("abandons a game whose every human seat has been unseen for 30 minutes", async () => {
    const game = await twoPlayerGame();
    await harness.db.execute(
      "update game_players set last_seen_at = now() - interval '40 minutes' where game_id = $1",
      [game.gameId],
    );
    expect((await sweep(50)).abandonedGames).toBe(1);

    const rows = await harness.db.query<{ status: string }>(
      "select status from games where id = $1",
      [game.gameId],
    );
    expect(rows[0]?.status).toBe("abandoned");
  });

  it("leaves a game alone while one human is still there", async () => {
    const game = await twoPlayerGame();
    await harness.db.execute(
      "update game_players set last_seen_at = now() - interval '40 minutes' where game_id = $1 and seat = 0",
      [game.gameId],
    );
    expect((await sweep(50)).abandonedGames).toBe(0);
  });

  it("deletes a finished game older than seven days, cascading its log", async () => {
    const game = await twoPlayerGame();
    await harness.db.execute(
      `update games set status = 'finished', updated_at = now() - interval '8 days' where id = $1`,
      [game.gameId],
    );
    expect((await sweep(50)).oldGames).toBe(1);
    expect(await harness.db.query("select seq from game_actions where game_id = $1", [game.gameId]))
      .toHaveLength(0);
  });

  it("deletes a player unseen for a day with no live seat, and spares one with a seat", async () => {
    const stale = await mustClaim("Ghost");
    const seated = await twoPlayerGame(undefined, ["Alpha", "Bravo"]);
    await harness.db.execute("update players set last_seen_at = now() - interval '2 days'");

    const report = await sweep(50);
    expect(report.deadPlayers).toBe(1);
    expect(
      await harness.db.query("select id from players where id = $1", [stale.playerId]),
    ).toHaveLength(0);
    expect(
      await harness.db.query("select id from players where id = $1", [seated.a.playerId]),
    ).toHaveLength(1);
  });

  it("deletes chat older than seven days", async () => {
    const player = await mustClaim("Napoleon");
    await chat(player, { scope: "global", lineId: 1 });
    await harness.db.execute("update chat_messages set created_at = now() - interval '8 days'");
    expect((await sweep(50)).oldChat).toBe(1);
    expect(await harness.db.query("select id from chat_messages")).toHaveLength(0);
  });

  it("bounds every sweep by its limit so no one request can be slow", async () => {
    // One lobby per host, because one live lobby per host is now a unique
    // index (`lobbies_one_live_per_host`) rather than a handler's read — four
    // open lobbies for one player is no longer a state the database will
    // hold. What is under test here is the sweep's `limit`.
    const codes = ["AAAA", "BBBB", "CCCC", "DDDD"];
    for (const [index, code] of codes.entries()) {
      const host = await mustClaim(`Host ${index}`);
      await harness.db.execute(
        `insert into lobbies (id, host_id, title, updated_at)
         values ($1, $2, 'Stale', now() - interval '25 minutes')`,
        [code, host.playerId],
      );
    }

    expect((await sweep(2)).staleLobbies).toBe(2);
    expect((await sweep(2)).staleLobbies).toBe(2);
    expect((await sweep(2)).staleLobbies).toBe(0);
  });

  it("compacts a game whose log has run past the snapshot threshold", async () => {
    const game = await twoPlayerGame();
    await harness.db.execute("update games set seq = $2 where id = $1", [
      game.gameId,
      COMPACTION_THRESHOLD + 5,
    ]);
    // The log only has seq 1, so the fold is a no-op and the snapshot is
    // rewritten at the game's own seq — which is exactly what makes the
    // `since < snapshot_seq` poll branch reachable.
    const report = await sweep(50);
    expect(report.compacted).toBe(1);

    const rows = await harness.db.query<{ snapshot_seq: string | number }>(
      "select snapshot_seq from games where id = $1",
      [game.gameId],
    );
    expect(Number(rows[0]?.snapshot_seq)).toBe(COMPACTION_THRESHOLD + 5);
  });

  it("runs at most once per minute per process", async () => {
    const host = await mustClaim("Napoleon");
    const code = await createLobby(host);
    await harness.db.execute(
      "update lobbies set updated_at = now() - interval '25 minutes' where id = $1",
      [code],
    );

    resetSweepClockForTests();
    const first = await maybeSweep(1_000_000);
    expect(first?.staleLobbies).toBe(1);

    // Inside the window: no work, not even a statement.
    expect(await maybeSweep(1_000_000 + SWEEP_INTERVAL_MS - 1)).toBeNull();
    // Past it: a sweep runs again, finding nothing this time.
    const third = await maybeSweep(1_000_000 + SWEEP_INTERVAL_MS);
    expect(third?.staleLobbies).toBe(0);
  });
});

describe("GET /api/health", () => {
  it("answers 200 { ok: true } with no-store", async () => {
    const response = await health();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET /api/cron/sweep", () => {
  it("401s without the cron header", async () => {
    const response = await cronSweep(req("/api/cron/sweep"));
    expect(response.status).toBe(401);
  });

  it("runs the unbounded sweeps with the header present", async () => {
    const host = await mustClaim("Napoleon");
    const code = await createLobby(host);
    await harness.db.execute(
      "update lobbies set updated_at = now() - interval '25 minutes' where id = $1",
      [code],
    );

    const response = await cronSweep(req("/api/cron/sweep", { headers: { "x-vercel-cron": "1" } }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { swept: { staleLobbies: number } };
    expect(body.swept.staleLobbies).toBe(1);
    expect(CRON_LIMIT).toBeGreaterThan(100);
  });
});
