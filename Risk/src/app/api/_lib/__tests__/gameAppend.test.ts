// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LoggedAction } from "@/ports/sync";

import {
  actionId,
  mustClaim,
  req,
  routes,
  startHarness,
  submit,
  twoPlayerGame,
  type Harness,
  type TwoPlayerGame,
} from "./harness";
import { fakeApply, fakeHash, fakeInitialState, fakeMapDef } from "./fakeEngine";

/**
 * `POST /api/games/:id/actions` — the append path (SPEC §5.5, §6, T9).
 *
 * The transaction, the `FOR UPDATE` fence, the idempotency index and the
 * `{ kind: "action" | "intent" }` body, all proven against the fake engine:
 * none of §3's rules need to work for any of this to be wrong or right.
 */

let harness: Harness;
let game: TwoPlayerGame;

beforeEach(async () => {
  harness = await startHarness();
  game = await twoPlayerGame();
});

afterEach(async () => {
  await harness.dispose();
});

/** Seat 0 owns territories 0, 2 and 4 under the fake deal. */
const MINE = 0;

function draft(count = 3, territory = MINE) {
  return { type: "DRAFT", seat: 0, territory, count } as const;
}

async function rows(gameId: string): Promise<
  { seq: number; type: string; actor: string; client_action_id: string | null; state_hash: string }[]
> {
  const result = await harness.db.query<{
    seq: string | number;
    type: string;
    actor: string;
    client_action_id: string | null;
    state_hash: string;
  }>(
    `select seq, type, actor, client_action_id, state_hash from game_actions
      where game_id = $1 order by seq`,
    [gameId],
  );
  return result.map((row) => ({ ...row, seq: Number(row.seq) }));
}

describe("the opening", () => {
  it("writes GAME_STARTED at seq 1, with games.seq and snapshot_seq agreeing", async () => {
    const log = await rows(game.gameId);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ seq: 1, type: "GAME_STARTED", actor: "server" });

    const head = await harness.db.query<{ seq: string | number; snapshot_seq: string | number }>(
      "select seq, snapshot_seq from games where id = $1",
      [game.gameId],
    );
    expect(Number(head[0]?.seq)).toBe(1);
    expect(Number(head[0]?.snapshot_seq)).toBe(1);
  });

  it("stamps the opening row with the hash of the state after it", async () => {
    const log = await rows(game.gameId);
    const stored = await harness.db.query<{ snapshot: unknown; state_hash: string }>(
      "select snapshot, state_hash from games where id = $1",
      [game.gameId],
    );
    expect(log[0]?.state_hash).toBe(stored[0]?.state_hash);
  });

  it("sets a turn deadline for a human seat", async () => {
    const head = await harness.db.query<{ future: boolean }>(
      "select turn_deadline > now() as future from games where id = $1",
      [game.gameId],
    );
    expect(head[0]?.future).toBe(true);
  });

  it("keeps the seed on the row and off every response", async () => {
    const stored = await harness.db.query<{ seed: string }>(
      "select seed from games where id = $1",
      [game.gameId],
    );
    expect(stored[0]?.seed).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("appending one action", () => {
  it("answers 200 { seq, actions: [the one just applied] }", async () => {
    const response = await submit(game.a, game.gameId, {
      clientActionId: actionId("draft"),
      kind: "action",
      action: draft(),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { seq: number; actions: LoggedAction[] };
    expect(body.seq).toBe(2);
    expect(body.actions).toHaveLength(1);
    expect(body.actions[0]).toMatchObject({
      seq: 2,
      seat: 0,
      actor: "human",
      clientActionId: actionId("draft"),
    });
    expect(body.actions[0]?.action).toMatchObject({ type: "DRAFT", territory: MINE, count: 3 });
  });

  it("moves games.seq, current_seat and phase in the same transaction", async () => {
    await submit(game.a, game.gameId, {
      clientActionId: actionId("draft"),
      kind: "action",
      action: draft(),
    });
    await submit(game.a, game.gameId, {
      clientActionId: actionId("endphase"),
      kind: "action",
      action: { type: "END_PHASE", seat: 0 },
    });
    const head = await harness.db.query<{
      seq: string | number;
      current_seat: number;
      phase: string;
    }>("select seq, current_seat, phase from games where id = $1", [game.gameId]);
    expect(Number(head[0]?.seq)).toBe(3);
    expect(Number(head[0]?.current_seat)).toBe(0);
    expect(head[0]?.phase).toBe("attack");
  });

  it("keeps the log contiguous from 1 and agreeing with games.seq", async () => {
    for (const [index, count] of [1, 1, 1].entries()) {
      await submit(game.a, game.gameId, {
        clientActionId: actionId(`d${index}`),
        kind: "action",
        action: draft(count),
      });
    }
    const log = await rows(game.gameId);
    expect(log.map((row) => row.seq)).toEqual([1, 2, 3, 4]);
    const head = await harness.db.query<{ seq: string | number }>(
      "select seq from games where id = $1",
      [game.gameId],
    );
    expect(Number(head[0]?.seq)).toBe(4);
  });

  it("writes a state_hash per row that a client's own fold reproduces", async () => {
    await submit(game.a, game.gameId, {
      clientActionId: actionId("draft"),
      kind: "action",
      action: draft(),
    });
    await submit(game.a, game.gameId, {
      clientActionId: actionId("endphase"),
      kind: "action",
      action: { type: "END_PHASE", seat: 0 },
    });

    // Replay the log exactly as §5.5's client fold does, from the opening.
    const payloads = await harness.db.query<{ payload: unknown; state_hash: string }>(
      "select payload, state_hash from game_actions where game_id = $1 order by seq",
      [game.gameId],
    );
    const map = fakeMapDef();
    const first = payloads[0]!;
    let state = fakeInitialState(
      map,
      first.payload as Parameters<typeof fakeInitialState>[1],
    );
    expect(fakeHash(state)).toBe(first.state_hash);
    for (const row of payloads.slice(1)) {
      const result = fakeApply(state, map, row.payload as Parameters<typeof fakeApply>[2]);
      expect(result.error).toBeUndefined();
      state = result.state;
      expect(fakeHash(state)).toBe(row.state_hash);
    }
  });

  it("resets the acting seat's missed_turns", async () => {
    await harness.db.execute(
      "update game_players set missed_turns = 2 where game_id = $1 and seat = 0",
      [game.gameId],
    );
    await submit(game.a, game.gameId, {
      clientActionId: actionId("draft"),
      kind: "action",
      action: draft(),
    });
    const seat = await harness.db.query<{ missed_turns: number }>(
      "select missed_turns from game_players where game_id = $1 and seat = 0",
      [game.gameId],
    );
    expect(Number(seat[0]?.missed_turns)).toBe(0);
  });
});

describe("the status codes", () => {
  it("409s a submitter whose turn it is not, and writes nothing", async () => {
    const response = await submit(game.b, game.gameId, {
      clientActionId: actionId("b"),
      kind: "action",
      action: { type: "DRAFT", seat: 1, territory: 1, count: 3 },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "notYourTurn" });
    expect(await rows(game.gameId)).toHaveLength(1);
  });

  it("403s somebody with no seat in the game", async () => {
    const outsider = await mustClaim("Blucher");
    const response = await submit(outsider, game.gameId, {
      clientActionId: actionId("out"),
      kind: "action",
      action: draft(),
    });
    expect(response.status).toBe(403);
  });

  it("401s without a cookie and 404s an unknown game", async () => {
    expect(
      (
        await routes.postAction(
          game.gameId,
          req(`/api/games/${game.gameId}/actions`, {
            method: "POST",
            body: { clientActionId: actionId("x"), kind: "action", action: draft() },
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await submit(game.a, "g_nope", {
          clientActionId: actionId("x"),
          kind: "action",
          action: draft(),
        })
      ).status,
    ).toBe(404);
  });

  it("422s a rule violation with the engine's own code", async () => {
    const response = await submit(game.a, game.gameId, {
      clientActionId: actionId("too-many"),
      kind: "action",
      action: draft(99),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "tooManyTroops" });
    expect(await rows(game.gameId)).toHaveLength(1);
  });

  it("422 illegalAction for an ATTACK sent as a resolved action — dice are the authority's", async () => {
    const response = await submit(game.a, game.gameId, {
      clientActionId: actionId("cheat"),
      kind: "action",
      action: {
        type: "ATTACK",
        seat: 0,
        from: 0,
        to: 1,
        mode: "blitz",
        attackerLosses: 0,
        defenderLosses: 99,
      },
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "illegalAction" });
    expect(await rows(game.gameId)).toHaveLength(1);
  });

  it("400s a body that is not the two-member union", async () => {
    for (const body of [
      "{nope",
      { clientActionId: "short", kind: "action", action: draft() },
      { clientActionId: actionId("x"), kind: "nonsense", action: draft() },
      { clientActionId: actionId("x"), kind: "action", action: { type: "GAME_STARTED", seat: 0 } },
      { clientActionId: actionId("x"), kind: "action", action: { type: "SEAT_TO_HUMAN", seat: 0 } },
      { clientActionId: actionId("x"), kind: "intent", intent: { from: 0, to: 1, mode: "psychic" } },
    ]) {
      const response = await submit(game.a, game.gameId, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("ignores the seat the body claims and uses the authenticated one", async () => {
    const response = await submit(game.a, game.gameId, {
      clientActionId: actionId("spoof"),
      kind: "action",
      // Seat 1 is Bravo's. The cookie says seat 0, and the cookie wins.
      action: { type: "DRAFT", seat: 1, territory: MINE, count: 3 },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { actions: LoggedAction[] };
    expect(body.actions[0]?.seat).toBe(0);
    expect(body.actions[0]?.action).toMatchObject({ seat: 0 });
  });
});

describe("the attack intent", () => {
  async function reachAttackPhase(): Promise<void> {
    await submit(game.a, game.gameId, {
      clientActionId: actionId("draft"),
      kind: "action",
      action: draft(),
    });
    await submit(game.a, game.gameId, {
      clientActionId: actionId("endphase"),
      kind: "action",
      action: { type: "END_PHASE", seat: 0 },
    });
  }

  it("rolls server-side and returns the authoritative ATTACK with the numbers", async () => {
    await reachAttackPhase();
    const response = await submit(game.a, game.gameId, {
      clientActionId: actionId("blitz"),
      kind: "intent",
      intent: { from: 0, to: 1, mode: "blitz" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { actions: LoggedAction[] };
    expect(body.actions[0]?.action).toMatchObject({
      type: "ATTACK",
      seat: 0,
      from: 0,
      to: 1,
      mode: "blitz",
      attackerLosses: 1,
      defenderLosses: 1,
    });
  });

  it("carries the dice for a manual roll, and the limiter for a blitz", async () => {
    await reachAttackPhase();
    const manual = (await (
      await submit(game.a, game.gameId, {
        clientActionId: actionId("manual"),
        kind: "intent",
        intent: { from: 0, to: 1, mode: "manual", attackerDice: 2 },
      })
    ).json()) as { actions: LoggedAction[] };
    expect(manual.actions[0]?.action).toMatchObject({
      mode: "manual",
      attackerDice: [6, 5],
      defenderDice: [2, 1],
    });

    const blitz = (await (
      await submit(game.a, game.gameId, {
        clientActionId: actionId("limited"),
        kind: "intent",
        intent: { from: 0, to: 1, mode: "blitz", stopUntil: 4 },
      })
    ).json()) as { actions: LoggedAction[] };
    expect(blitz.actions[0]?.action).toMatchObject({ stopUntil: 4 });
  });

  it("422s an intent the rules refuse, without writing a row", async () => {
    // Still in the draft phase, so attacking is `wrongPhase`.
    const response = await submit(game.a, game.gameId, {
      clientActionId: actionId("early"),
      kind: "intent",
      intent: { from: 0, to: 1, mode: "blitz" },
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "wrongPhase" });
    expect(await rows(game.gameId)).toHaveLength(1);
  });
});

describe("idempotency (D15)", () => {
  it("writes one row for one clientActionId sent twice, and answers 200 both times", async () => {
    const body = {
      clientActionId: actionId("once"),
      kind: "action" as const,
      action: draft(),
    };
    const first = await submit(game.a, game.gameId, body);
    const second = await submit(game.a, game.gameId, body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const a = (await first.json()) as { seq: number; actions: LoggedAction[] };
    const b = (await second.json()) as { seq: number; actions: LoggedAction[] };
    expect(b.seq).toBe(a.seq);
    expect(b.actions[0]?.seq).toBe(a.actions[0]?.seq);
    expect(b.actions[0]?.action).toEqual(a.actions[0]?.action);

    const log = await rows(game.gameId);
    expect(log).toHaveLength(2);
    expect(log.filter((row) => row.client_action_id === actionId("once"))).toHaveLength(1);
  });

  it("answers the already-recorded action even once the state has moved on", async () => {
    const body = {
      clientActionId: actionId("once"),
      kind: "action" as const,
      action: draft(1),
    };
    await submit(game.a, game.gameId, body);
    await submit(game.a, game.gameId, {
      clientActionId: actionId("after"),
      kind: "action",
      action: draft(2),
    });

    const retry = await submit(game.a, game.gameId, body);
    expect(retry.status).toBe(200);
    const parsed = (await retry.json()) as { seq: number; actions: LoggedAction[] };
    // `seq` is the game's current one; the action is the one that was
    // recorded at the time, not a replay of it.
    expect(parsed.seq).toBe(3);
    expect(parsed.actions[0]?.seq).toBe(2);
  });

  it("treats a retry with a FRESH id as a second, distinct action", async () => {
    await submit(game.a, game.gameId, {
      clientActionId: actionId("first"),
      kind: "action",
      action: draft(1),
    });
    await submit(game.a, game.gameId, {
      clientActionId: actionId("second"),
      kind: "action",
      action: draft(1),
    });
    expect(await rows(game.gameId)).toHaveLength(3);
  });

  it("is per game, so the same id in two games is two actions", async () => {
    const other = await twoPlayerGame(undefined, ["Blucher", "Kutuzov"]);
    const body = { clientActionId: actionId("shared"), kind: "action" as const, action: draft(1) };
    expect((await submit(game.a, game.gameId, body)).status).toBe(200);
    expect((await submit(other.a, other.gameId, body)).status).toBe(200);
    expect(await rows(game.gameId)).toHaveLength(2);
    expect(await rows(other.gameId)).toHaveLength(2);
  });
});

describe("concurrency (the FOR UPDATE fence)", () => {
  it("serialises two simultaneous POSTs into contiguous seq", async () => {
    const [first, second] = await Promise.all([
      submit(game.a, game.gameId, {
        clientActionId: actionId("sim-a"),
        kind: "action",
        action: draft(1),
      }),
      submit(game.a, game.gameId, {
        clientActionId: actionId("sim-b"),
        kind: "action",
        action: draft(1),
      }),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const seqs = [
      ((await first.json()) as { seq: number }).seq,
      ((await second.json()) as { seq: number }).seq,
    ].sort((a, b) => a - b);
    expect(seqs).toEqual([2, 3]);

    const log = await rows(game.gameId);
    expect(log.map((row) => row.seq)).toEqual([1, 2, 3]);
  });

  it("serialises a double-clicked Attack into one row via the idempotency index", async () => {
    await submit(game.a, game.gameId, {
      clientActionId: actionId("draft"),
      kind: "action",
      action: draft(),
    });
    await submit(game.a, game.gameId, {
      clientActionId: actionId("endphase"),
      kind: "action",
      action: { type: "END_PHASE", seat: 0 },
    });

    // One click, one id, two sends — which is exactly what a double-click on
    // a slow connection produces.
    const body = {
      clientActionId: actionId("one-click"),
      kind: "intent" as const,
      intent: { from: 0, to: 1, mode: "blitz" as const },
    };
    const [first, second] = await Promise.all([
      submit(game.a, game.gameId, body),
      submit(game.a, game.gameId, body),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const attacks = (await rows(game.gameId)).filter((row) => row.type === "ATTACK");
    expect(attacks).toHaveLength(1);
  });

  it("gives the non-current seat a 409 while the current one succeeds", async () => {
    const [mine, theirs] = await Promise.all([
      submit(game.a, game.gameId, {
        clientActionId: actionId("mine"),
        kind: "action",
        action: draft(1),
      }),
      submit(game.b, game.gameId, {
        clientActionId: actionId("theirs"),
        kind: "action",
        action: { type: "DRAFT", seat: 1, territory: 1, count: 1 },
      }),
    ]);
    expect(mine.status).toBe(200);
    expect(theirs.status).toBe(409);
    expect(await rows(game.gameId)).toHaveLength(2);
  });
});

describe("POST /api/games/:id/resign (D76)", () => {
  it("appends SEAT_TO_BOT { reason: 'resigned' } and marks the seat resigned", async () => {
    const response = await routes.resign(
      game.gameId,
      req(`/api/games/${game.gameId}/resign`, { method: "POST", cookie: game.b.cookie }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { actions: LoggedAction[] };
    expect(body.actions[0]?.action).toMatchObject({
      type: "SEAT_TO_BOT",
      seat: 1,
      reason: "resigned",
    });
    expect(body.actions[0]?.actor).toBe("server");

    const seat = await harness.db.query<{ kind: string; standing: string }>(
      "select kind, standing from game_players where game_id = $1 and seat = 1",
      [game.gameId],
    );
    expect(seat[0]).toMatchObject({ kind: "bot", standing: "resigned" });
  });

  it("does not require it to be your turn", async () => {
    const response = await routes.resign(
      game.gameId,
      req(`/api/games/${game.gameId}/resign`, { method: "POST", cookie: game.b.cookie }),
    );
    expect(response.status).toBe(200);
  });

  it("403s an outsider and 404s an unknown game", async () => {
    const outsider = await mustClaim("Blucher");
    expect(
      (
        await routes.resign(
          game.gameId,
          req(`/api/games/${game.gameId}/resign`, { method: "POST", cookie: outsider.cookie }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await routes.resign(
          "g_nope",
          req("/api/games/g_nope/resign", { method: "POST", cookie: game.a.cookie }),
        )
      ).status,
    ).toBe(404);
  });
});
