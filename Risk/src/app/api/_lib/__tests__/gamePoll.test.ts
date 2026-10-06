// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GameState } from "@/engine/types";
import { SEAT_UNKNOWN, TROOPS_UNKNOWN } from "@/engine/types";
import type { ChatLine, LoggedAction, PresenceRow } from "@/ports/sync";

import {
  actionId,
  mustClaim,
  poll,
  req,
  routes,
  startHarness,
  submit,
  TEST_RULES,
  twoPlayerGame,
  type Harness,
  type TwoPlayerGame,
} from "./harness";

/**
 * POLL 3 — `GET /api/games/:id` (SPEC §5.5, §6, T9, T12).
 *
 * The `204` fast path, delta versus snapshot, the fog mode's masked snapshot
 * at `snapshotSeq === seq`, and `games.seed` absent from every response body —
 * asserted by scanning the serialised JSON, not by reading a field.
 */

interface SyncBody {
  seq: number;
  fromSeq?: number;
  snapshot?: GameState;
  snapshotSeq?: number;
  actions: LoggedAction[];
  presence: PresenceRow[];
  turnDeadline: string | null;
  chat: ChatLine[];
  you: { seat: number | null; cards: unknown[] };
  status: string;
}

let harness: Harness;
let game: TwoPlayerGame;

beforeEach(async () => {
  harness = await startHarness();
  game = await twoPlayerGame();
});

afterEach(async () => {
  await harness.dispose();
});

async function body(response: Response): Promise<SyncBody> {
  expect(response.status).toBe(200);
  return (await response.json()) as SyncBody;
}

async function seedOf(gameId: string): Promise<string> {
  const rows = await harness.db.query<{ seed: string }>("select seed from games where id = $1", [
    gameId,
  ]);
  return rows[0]!.seed;
}

describe("the 204 fast path", () => {
  it("answers 204 with no body when seq === since", async () => {
    const first = await body(await poll(game.a, game.gameId, 0));
    const second = await poll(game.a, game.gameId, first.seq);
    expect(second.status).toBe(204);
    expect(await second.text()).toBe("");
    expect(second.headers.get("content-type")).toBeNull();
    expect(second.headers.get("etag")).toBe(`W/"${first.seq}"`);
    expect(second.headers.get("cache-control")).toBe("no-store");
  });

  it("honours If-None-Match as the same statement as ?since=", async () => {
    const first = await body(await poll(game.a, game.gameId, 0));
    const response = await poll(game.a, game.gameId, 0, 0, {
      "if-none-match": `W/"${first.seq}"`,
    });
    expect(response.status).toBe(204);
  });

  it("ignores a malformed If-None-Match rather than trusting it", async () => {
    const response = await poll(game.a, game.gameId, 0, 0, { "if-none-match": 'W/"garbage"' });
    expect(response.status).toBe(200);
  });

  it("carries a dev-only Server-Timing header on the 204 path", async () => {
    const first = await body(await poll(game.a, game.gameId, 0));
    const response = await poll(game.a, game.gameId, first.seq);
    expect(response.headers.get("server-timing")).toMatch(/^poll;dur=\d+$/);
  });

  it("stays well under 1 KB for a one-action delta (T12)", async () => {
    const first = await body(await poll(game.a, game.gameId, 0));
    await submit(game.a, game.gameId, {
      clientActionId: actionId("draft"),
      kind: "action",
      action: { type: "DRAFT", seat: 0, territory: 0, count: 3 },
    });
    const delta = await poll(game.a, game.gameId, first.seq);
    const text = await delta.text();
    expect(delta.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ fromSeq: first.seq });
    expect(text.length).toBeLessThan(1024);
  });
});

describe("delta versus snapshot, with fog off", () => {
  it("sends the snapshot to a cold client, fogged: false", async () => {
    const cold = await body(await poll(game.a, game.gameId, 0));
    expect(cold.snapshot).toBeDefined();
    expect(cold.snapshot?.fogged).toBe(false);
    expect(cold.snapshotSeq).toBe(1);
    expect(cold.actions).toEqual([]);
    expect(cold.fromSeq).toBeUndefined();
  });

  it("sends a delta — and no snapshot — to a client that is merely behind", async () => {
    const cold = await body(await poll(game.a, game.gameId, 0));
    await submit(game.a, game.gameId, {
      clientActionId: actionId("draft"),
      kind: "action",
      action: { type: "DRAFT", seat: 0, territory: 0, count: 3 },
    });

    const delta = await body(await poll(game.a, game.gameId, cold.seq));
    expect(delta.snapshot).toBeUndefined();
    expect(delta.snapshotSeq).toBeUndefined();
    expect(delta.fromSeq).toBe(cold.seq);
    expect(delta.actions).toHaveLength(1);
    expect(delta.actions[0]?.action).toMatchObject({ type: "DRAFT" });
  });

  it("sends the snapshot to a client behind the compaction horizon", async () => {
    for (let i = 0; i < 3; i += 1) {
      await submit(game.a, game.gameId, {
        clientActionId: actionId(`d${i}`),
        kind: "action",
        action: { type: "DRAFT", seat: 0, territory: 0, count: 1 },
      });
    }
    // Compaction is what moves `snapshot_seq` past a lagging client; forcing
    // it directly is the same state the reaper's sweep produces.
    await harness.db.execute("update games set snapshot_seq = seq where id = $1", [game.gameId]);

    const behind = await body(await poll(game.a, game.gameId, 2));
    expect(behind.snapshot).toBeDefined();
    expect(behind.snapshotSeq).toBe(behind.seq);
    expect(behind.fromSeq).toBeUndefined();
  });

  it("includes presence, the turn deadline, chat and you on every body", async () => {
    const cold = await body(await poll(game.a, game.gameId, 0));
    expect(cold.presence).toHaveLength(2);
    expect(cold.presence[0]).toMatchObject({ seat: 0, standing: "active", missedTurns: 0 });
    expect(cold.presence[0]?.online).toBe(true);
    expect(cold.turnDeadline).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(cold.chat).toEqual([]);
    expect(cold.you).toMatchObject({ seat: 0 });
    expect(cold.status).toBe("playing");
  });

  it("reports a seat offline once its heartbeat is stale", async () => {
    await harness.db.execute(
      "update game_players set last_seen_at = now() - interval '2 minutes' where game_id = $1 and seat = 1",
      [game.gameId],
    );
    const cold = await body(await poll(game.a, game.gameId, 0));
    expect(cold.presence[1]?.online).toBe(false);
  });

  it("gives each seat its own `you`", async () => {
    const mine = await body(await poll(game.a, game.gameId, 0));
    const theirs = await body(await poll(game.b, game.gameId, 0));
    expect(mine.you.seat).toBe(0);
    expect(theirs.you.seat).toBe(1);
  });
});

describe("fog mode (F36)", () => {
  let fogGame: TwoPlayerGame;

  beforeEach(async () => {
    fogGame = await twoPlayerGame(
      { ...TEST_RULES, fogOfWar: true },
      ["Charlie", "Delta"],
    );
  });

  it("returns the caller's masked snapshot at snapshotSeq === seq on every changed poll", async () => {
    const cold = await body(await poll(fogGame.a, fogGame.gameId, 0));
    expect(cold.snapshot).toBeDefined();
    expect(cold.snapshotSeq).toBe(cold.seq);
    expect(cold.snapshot?.fogged).toBe(true);

    await submit(fogGame.a, fogGame.gameId, {
      clientActionId: actionId("draft"),
      kind: "action",
      action: { type: "DRAFT", seat: 0, territory: 0, count: 3 },
    });

    // Changed again — and still a snapshot, not a delta.
    const changed = await body(await poll(fogGame.a, fogGame.gameId, cold.seq));
    expect(changed.snapshot).toBeDefined();
    expect(changed.snapshotSeq).toBe(changed.seq);
    expect(changed.actions).toHaveLength(1);
  });

  it("masks the territories the caller cannot see", async () => {
    const cold = await body(await poll(fogGame.a, fogGame.gameId, 0));
    const territories = cold.snapshot!.territories;
    const hidden = territories.filter((row) => row.owner === SEAT_UNKNOWN);
    expect(hidden.length).toBeGreaterThan(0);
    for (const row of hidden) expect(row.troops).toBe(TROOPS_UNKNOWN);
  });

  it("gives the two seats different masked views", async () => {
    const mine = await body(await poll(fogGame.a, fogGame.gameId, 0));
    const theirs = await body(await poll(fogGame.b, fogGame.gameId, 0));
    expect(mine.snapshot!.territories).not.toEqual(theirs.snapshot!.territories);
  });

  it("empties every other seat's hand while keeping cardCount (F12)", async () => {
    const theirs = await body(await poll(fogGame.b, fogGame.gameId, 0));
    for (const seat of theirs.snapshot!.seats) {
      if (seat.seat === 1) continue;
      expect(seat.cards).toEqual([]);
    }
  });

  it("keeps the 204 path byte-for-byte identical to the non-fog one", async () => {
    const first = await body(await poll(fogGame.a, fogGame.gameId, 0));
    const response = await poll(fogGame.a, fogGame.gameId, first.seq);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("etag")).toBe(`W/"${first.seq}"`);
  });

  it("keeps the masked snapshot under 4 KB on this board (T12)", async () => {
    const response = await poll(fogGame.a, fogGame.gameId, 0);
    expect((await response.text()).length).toBeLessThan(4096);
  });
});

describe("games.seed never reaches a client (D5)", () => {
  it("is absent from the cold snapshot, a delta, and a fog view", async () => {
    const fogGame = await twoPlayerGame({ ...TEST_RULES, fogOfWar: true }, ["Echo", "Foxtrot"]);
    const seeds = [await seedOf(game.gameId), await seedOf(fogGame.gameId)];

    const cold = await (await poll(game.a, game.gameId, 0)).text();
    await submit(game.a, game.gameId, {
      clientActionId: actionId("draft"),
      kind: "action",
      action: { type: "DRAFT", seat: 0, territory: 0, count: 3 },
    });
    const delta = await (await poll(game.a, game.gameId, 1)).text();
    const fog = await (await poll(fogGame.a, fogGame.gameId, 0)).text();

    for (const payload of [cold, delta, fog]) {
      expect(payload).not.toContain("seed");
      for (const seed of seeds) expect(payload).not.toContain(seed);
    }
  });

  it("is absent from the submit response and the debug log", async () => {
    process.env["NEXT_PUBLIC_RISK_DEBUG"] = "1";
    try {
      const seed = await seedOf(game.gameId);
      const submitted = await (
        await submit(game.a, game.gameId, {
          clientActionId: actionId("draft"),
          kind: "action",
          action: { type: "DRAFT", seat: 0, territory: 0, count: 3 },
        })
      ).text();
      const log = await (
        await routes.debugActions(
          game.gameId,
          req(`/api/games/${game.gameId}/actions?from=0`, { cookie: game.a.cookie }),
        )
      ).text();
      for (const payload of [submitted, log]) {
        expect(payload).not.toContain(seed);
        expect(payload).not.toContain('"seed"');
      }
    } finally {
      delete process.env["NEXT_PUBLIC_RISK_DEBUG"];
    }
  });
});

describe("the debug action log (F37)", () => {
  afterEach(() => {
    delete process.env["NEXT_PUBLIC_RISK_DEBUG"];
  });

  it("returns the raw, unmasked log from from+1 when the flag is on", async () => {
    process.env["NEXT_PUBLIC_RISK_DEBUG"] = "1";
    const fogGame = await twoPlayerGame({ ...TEST_RULES, fogOfWar: true }, ["Golf", "Hotel"]);
    const response = await routes.debugActions(
      fogGame.gameId,
      req(`/api/games/${fogGame.gameId}/actions?from=0`, { cookie: fogGame.a.cookie }),
    );
    expect(response.status).toBe(200);
    const parsed = (await response.json()) as { actions: LoggedAction[] };
    expect(parsed.actions).toHaveLength(1);
    expect(parsed.actions[0]).toMatchObject({ seq: 1, stateHash: expect.any(String) });
    // Unmasked: the whole deal is there, with real owners, in a FOG game.
    const started = parsed.actions[0]!.action as { type: string; deal: { owner: number }[] };
    expect(started.type).toBe("GAME_STARTED");
    expect(started.deal.every((row) => row.owner >= 0)).toBe(true);
  });

  it("honours ?from= as an exclusive cursor", async () => {
    process.env["NEXT_PUBLIC_RISK_DEBUG"] = "1";
    await submit(game.a, game.gameId, {
      clientActionId: actionId("draft"),
      kind: "action",
      action: { type: "DRAFT", seat: 0, territory: 0, count: 3 },
    });
    const parsed = (await (
      await routes.debugActions(
        game.gameId,
        req(`/api/games/${game.gameId}/actions?from=1`, { cookie: game.a.cookie }),
      )
    ).json()) as { actions: LoggedAction[] };
    expect(parsed.actions.map((action) => action.seq)).toEqual([2]);
  });

  it("404s with the flag off, even for a seated player", async () => {
    delete process.env["NEXT_PUBLIC_RISK_DEBUG"];
    const response = await routes.debugActions(
      game.gameId,
      req(`/api/games/${game.gameId}/actions?from=0`, { cookie: game.a.cookie }),
    );
    expect(response.status).toBe(404);
  });

  it("still requires a cookie and a seat with the flag on", async () => {
    process.env["NEXT_PUBLIC_RISK_DEBUG"] = "1";
    const outsider = await mustClaim("India");
    expect(
      (
        await routes.debugActions(
          game.gameId,
          req(`/api/games/${game.gameId}/actions?from=0`),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await routes.debugActions(
          game.gameId,
          req(`/api/games/${game.gameId}/actions?from=0`, { cookie: outsider.cookie }),
        )
      ).status,
    ).toBe(403);
  });
});

describe("the poll's status codes", () => {
  it("401s without a cookie, 403s an outsider, 404s an unknown game", async () => {
    const outsider = await mustClaim("Juliet");
    expect(
      (await routes.pollGame(game.gameId, req(`/api/games/${game.gameId}`))).status,
    ).toBe(401);
    expect((await poll(outsider, game.gameId, 0)).status).toBe(403);
    expect((await poll(game.a, "g_nope", 0)).status).toBe(404);
  });
});
