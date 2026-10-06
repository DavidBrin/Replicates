// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameState, Standing } from "@/engine/types";
import type { LoggedAction, SyncStatus } from "@/ports/sync";

import { createPollingSync } from "../pollingSync";
import { HIDDEN_MS, MY_TURN_MS, OTHER_TURN_MS, type VisibilitySource } from "../pollingLoop";
import { SyncHttpError, type GameSyncBody } from "../types";

/**
 * `createPollingSync` (SPEC §4.16, §5.5): the `SyncPort` the session is
 * handed online.
 *
 * Driven through an injected `fetch`, an injected scheduler and an injected
 * `random`, so every assertion here is about the protocol rather than about
 * timing.
 */

/* ------------------------------------------------------------- scaffolding -- */

interface Clock {
  now(): number;
  tick(): Promise<void>;
  readonly pending: number | null;
  readonly delays: number[];
  schedule(fn: () => void, ms: number): () => void;
}

function clock(): Clock {
  let time = 0;
  let queued: { fn: () => void; at: number } | null = null;
  const delays: number[] = [];
  return {
    now: () => time,
    get pending() {
      return queued === null ? null : queued.at - time;
    },
    get delays() {
      return delays;
    },
    schedule(fn, ms) {
      queued = { fn, at: time + ms };
      delays.push(ms);
      return () => {
        queued = null;
      };
    },
    async tick() {
      const next = queued;
      if (!next) throw new Error("nothing scheduled");
      queued = null;
      time = Math.max(time, next.at);
      next.fn();
      await settle();
    },
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function visibility(): VisibilitySource & { set(next: boolean): void } {
  let state = true;
  const listeners = new Set<() => void>();
  return {
    isVisible: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      state = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

function state(overrides: Partial<GameState> = {}): GameState {
  return { fogged: false, seq: 0, ...overrides } as unknown as GameState;
}

function action(seq: number, clientActionId: string | null = null): LoggedAction {
  return {
    seq,
    seat: 0,
    action: { type: "END_TURN", seat: 0 },
    actor: "human",
    clientActionId,
    stateHash: `h${seq}`,
  };
}

function syncBody(overrides: Partial<GameSyncBody> = {}): GameSyncBody {
  return {
    seq: 1,
    actions: [],
    presence: [],
    turnDeadline: null,
    chat: [],
    you: { seat: 0, cards: [] },
    status: "playing",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

function recorder(answers: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[key.toLowerCase()] = value;
    }
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return answers(call);
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetchImpl };
}

/* -------------------------------------------------------------------- tests -- */

let time: Clock;

beforeEach(() => {
  time = clock();
});

describe("the poll request", () => {
  it("asks for the delta from its cursor and sets no ETag on the first call", async () => {
    const { calls, fetchImpl } = recorder(() => jsonResponse(syncBody({ seq: 7 })));
    const port = createPollingSync({
      gameId: "g_1",
      since: 3,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      random: () => 0.5,
      visibility: visibility(),
    });
    await settle();

    expect(calls[0]?.url).toBe("/api/games/g_1?since=3&chatSince=0");
    expect(calls[0]?.headers["if-none-match"]).toBeUndefined();
    expect(port.seq).toBe(7);
    port.close();
  });

  it("sends If-None-Match from the seq it last saw", async () => {
    const { calls, fetchImpl } = recorder(() => jsonResponse(syncBody({ seq: 7 })));
    const port = createPollingSync({
      gameId: "g_1",
      since: 0,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      random: () => 0.5,
      visibility: visibility(),
    });
    await settle();
    await time.tick();

    expect(calls[1]?.headers["if-none-match"]).toBe('W/"7"');
    expect(calls[1]?.url).toBe("/api/games/g_1?since=7&chatSince=0");
    port.close();
  });

  it("encodes the game id", async () => {
    const { calls, fetchImpl } = recorder(() => jsonResponse(syncBody()));
    const port = createPollingSync({
      gameId: "a b/c",
      since: 0,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
    });
    await settle();
    expect(calls[0]?.url).toContain("a%20b%2Fc");
    port.close();
  });
});

describe("the 204 fast path", () => {
  it("emits nothing, moves nothing, and keeps polling", async () => {
    let first = true;
    const { calls, fetchImpl } = recorder(() => {
      if (first) {
        first = false;
        return jsonResponse(syncBody({ seq: 5, actions: [action(5)] }));
      }
      return new Response(null, { status: 204 });
    });
    const actions = vi.fn();
    const snapshots = vi.fn();
    const port = createPollingSync({
      gameId: "g_1",
      since: 0,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      random: () => 0.5,
      visibility: visibility(),
    });
    port.onActions(actions);
    port.onSnapshot(snapshots);
    await settle();
    expect(port.seq).toBe(5);
    const emitted = actions.mock.calls.length;

    await time.tick();
    expect(calls).toHaveLength(2);
    // Nothing new was emitted by the 204, and the cursor did not move.
    expect(actions.mock.calls.length).toBe(emitted);
    expect(snapshots).not.toHaveBeenCalled();
    expect(port.seq).toBe(5);
    expect(time.pending).toBe(OTHER_TURN_MS);
    port.close();
  });

  it("reports idle around a 204 rather than behind", async () => {
    const { fetchImpl } = recorder(() => new Response(null, { status: 204 }));
    const seen: SyncStatus[] = [];
    const port = createPollingSync({
      gameId: "g_1",
      since: 1,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
      // Subscribed before the first poll, so the `polling` transition is seen
      // rather than having already happened inside the constructor.
      autoStart: false,
    });
    port.onStatus((status) => seen.push(status));
    await port.poll();
    expect(seen).toContain("polling");
    expect(seen.at(-1)).toBe("idle");
    port.close();
  });
});

describe("folding a response", () => {
  it("emits the snapshot before the actions that follow it", async () => {
    const order: string[] = [];
    const { fetchImpl } = recorder(() =>
      jsonResponse(
        syncBody({ seq: 9, snapshot: state(), snapshotSeq: 9, actions: [action(8), action(9)] }),
      ),
    );
    const port = createPollingSync({
      gameId: "g_1",
      since: 0,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
    });
    port.onSnapshot((_snapshot, at) => order.push(`snapshot:${at}`));
    port.onActions((rows) => order.push(`actions:${rows.map((row) => row.seq).join(",")}`));
    await settle();

    expect(order).toEqual(["snapshot:9", "actions:8,9"]);
    port.close();
  });

  it("publishes the whole body for the presence / deadline / chat props", async () => {
    const { fetchImpl } = recorder(() =>
      jsonResponse(
        syncBody({
          seq: 2,
          presence: [{ seat: 0, standing: "active", online: true, missedTurns: 0 }],
          turnDeadline: "2026-10-05T12:00:00.000Z",
          chat: [
            {
              id: 4,
              scope: "game",
              displayName: "Alpha",
              lineId: 20,
              emoji: null,
              createdAt: "2026-10-05T11:59:00.000Z",
            },
          ],
        }),
      ),
    );
    const bodies: GameSyncBody[] = [];
    const port = createPollingSync({
      gameId: "g_1",
      since: 0,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
    });
    port.onSync((body) => bodies.push(body));
    await settle();

    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.presence[0]?.online).toBe(true);
    expect(bodies[0]?.turnDeadline).toBe("2026-10-05T12:00:00.000Z");
    // The chat cursor moved, so the next poll asks only for newer lines.
    expect(port.chatSince).toBe(4);
    port.close();
  });

  it("never walks seq backwards when a response arrives out of order", async () => {
    const seqs = [9, 4];
    const { fetchImpl } = recorder(() => jsonResponse(syncBody({ seq: seqs.shift() ?? 9 })));
    const port = createPollingSync({
      gameId: "g_1",
      since: 0,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      random: () => 0.5,
      visibility: visibility(),
    });
    await settle();
    expect(port.seq).toBe(9);
    await time.tick();
    expect(port.seq).toBe(9);
    port.close();
  });

  it("stops polling once the game is no longer playing", async () => {
    const { calls, fetchImpl } = recorder(() =>
      jsonResponse(syncBody({ seq: 20, status: "finished" })),
    );
    const port = createPollingSync({
      gameId: "g_1",
      since: 0,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
    });
    await settle();
    expect(time.pending).toBeNull();
    expect(calls).toHaveLength(1);
    port.close();
  });

  it("survives a listener that throws", async () => {
    const { fetchImpl } = recorder(() => jsonResponse(syncBody({ seq: 3, actions: [action(3)] })));
    const port = createPollingSync({
      gameId: "g_1",
      since: 0,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
    });
    const good = vi.fn();
    port.onActions(() => {
      throw new Error("boom");
    });
    port.onActions(good);
    await settle();
    expect(good).toHaveBeenCalled();
    expect(port.seq).toBe(3);
    port.close();
  });
});

describe("the schedule", () => {
  it("uses 2 s on your turn and 4 s off it", async () => {
    let myTurn = false;
    const { fetchImpl } = recorder(() => new Response(null, { status: 204 }));
    const port = createPollingSync({
      gameId: "g_1",
      since: 1,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      random: () => 0.5,
      visibility: visibility(),
      isMyTurn: () => myTurn,
    });
    await settle();
    expect(time.pending).toBe(OTHER_TURN_MS);

    myTurn = true;
    await time.tick();
    expect(time.delays.at(-1)).toBe(MY_TURN_MS);
    port.close();
  });

  it("jitters every delay inside ±15 %", async () => {
    const { fetchImpl } = recorder(() => new Response(null, { status: 204 }));
    const port = createPollingSync({
      gameId: "g_1",
      since: 1,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
    });
    await settle();
    for (let i = 0; i < 20; i += 1) await time.tick();
    for (const delay of time.delays) {
      expect(delay).toBeGreaterThanOrEqual(Math.round(OTHER_TURN_MS * 0.85));
      expect(delay).toBeLessThanOrEqual(Math.round(OTHER_TURN_MS * 1.15));
    }
    port.close();
  });

  it("setIntervalMs overrides the adaptive choice, and 0 restores it", async () => {
    const { fetchImpl } = recorder(() => new Response(null, { status: 204 }));
    const port = createPollingSync({
      gameId: "g_1",
      since: 1,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      random: () => 0.5,
      visibility: visibility(),
      isMyTurn: () => true,
    });
    await settle();
    expect(time.pending).toBe(MY_TURN_MS);

    port.setIntervalMs(50);
    await settle();
    expect(time.delays.at(-1)).toBe(50);

    port.setIntervalMs(0);
    await settle();
    expect(time.delays.at(-1)).toBe(MY_TURN_MS);
    port.close();
  });

  it("re-polls immediately on regaining visibility", async () => {
    const vis = visibility();
    const { calls, fetchImpl } = recorder(() => new Response(null, { status: 204 }));
    const port = createPollingSync({
      gameId: "g_1",
      since: 1,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      random: () => 0.5,
      visibility: vis,
    });
    await settle();
    const before = calls.length;

    vis.set(false);
    await settle();
    expect(calls).toHaveLength(before);

    vis.set(true);
    await settle();
    expect(calls).toHaveLength(before + 1);
    port.close();
  });

  it("does not start when autoStart is false", async () => {
    const { calls, fetchImpl } = recorder(() => new Response(null, { status: 204 }));
    const port = createPollingSync({
      gameId: "g_1",
      since: 1,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
      autoStart: false,
    });
    await settle();
    expect(calls).toHaveLength(0);
    await port.poll();
    expect(calls).toHaveLength(1);
    port.close();
  });

  it("close() stops the loop and reports offline", async () => {
    const { calls, fetchImpl } = recorder(() => new Response(null, { status: 204 }));
    const seen: SyncStatus[] = [];
    const port = createPollingSync({
      gameId: "g_1",
      since: 1,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
    });
    port.onStatus((status) => seen.push(status));
    await settle();
    port.close();
    expect(seen.at(-1)).toBe("offline");
    expect(time.pending).toBeNull();
    const before = calls.length;
    await port.poll();
    expect(calls).toHaveLength(before);
  });
});

describe("submitting", () => {
  it("sends kind: 'action' and re-polls immediately afterwards", async () => {
    const { calls, fetchImpl } = recorder((call) =>
      call.method === "POST"
        ? jsonResponse({ seq: 4, actions: [action(4, "cid-1")] })
        : new Response(null, { status: 204 }),
    );
    const port = createPollingSync({
      gameId: "g_1",
      since: 3,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      random: () => 0.5,
      visibility: visibility(),
    });
    await settle();
    const before = calls.length;

    const result = await port.submit({ type: "END_TURN", seat: 0 }, "cid-1");
    await settle();

    const post = calls.find((call) => call.method === "POST");
    expect(post?.url).toBe("/api/games/g_1/actions");
    expect(post?.body).toEqual({
      clientActionId: "cid-1",
      kind: "action",
      action: { type: "END_TURN", seat: 0 },
    });
    expect(result[0]?.seq).toBe(4);
    expect(port.seq).toBe(4);
    // The POST plus the immediate re-poll it triggers.
    expect(calls.length).toBe(before + 2);
    port.close();
  });

  it("sends kind: 'intent' for an attack and resolves with the authority's dice", async () => {
    const { calls, fetchImpl } = recorder((call) =>
      call.method === "POST"
        ? jsonResponse({
            seq: 5,
            actions: [
              {
                ...action(5, "cid-2"),
                action: {
                  type: "ATTACK",
                  seat: 0,
                  from: 1,
                  to: 2,
                  mode: "blitz",
                  attackerLosses: 1,
                  defenderLosses: 2,
                },
              },
            ],
          })
        : new Response(null, { status: 204 }),
    );
    const port = createPollingSync({
      gameId: "g_1",
      since: 4,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
    });
    await settle();

    const result = await port.submitIntent({ from: 1, to: 2, mode: "blitz" }, "cid-2");
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      clientActionId: "cid-2",
      kind: "intent",
      intent: { from: 1, to: 2, mode: "blitz" },
    });
    expect(result[0]?.action).toMatchObject({ type: "ATTACK", defenderLosses: 2 });
    port.close();
  });

  it("emits the authoritative action to the subscribers", async () => {
    const { fetchImpl } = recorder((call) =>
      call.method === "POST"
        ? jsonResponse({ seq: 4, actions: [action(4, "cid-1")] })
        : new Response(null, { status: 204 }),
    );
    const seen: number[] = [];
    const port = createPollingSync({
      gameId: "g_1",
      since: 3,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
    });
    port.onActions((rows) => seen.push(...rows.map((row) => row.seq)));
    await settle();
    await port.submit({ type: "END_TURN", seat: 0 }, "cid-1");
    expect(seen).toEqual([4]);
    port.close();
  });

  it("throws a SyncHttpError carrying the RuleErrorCode on a 422", async () => {
    const { fetchImpl } = recorder((call) =>
      call.method === "POST"
        ? jsonResponse({ error: "rule violation", code: "mustPlaceAllTroops" }, 422)
        : new Response(null, { status: 204 }),
    );
    const port = createPollingSync({
      gameId: "g_1",
      since: 1,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
    });
    await settle();

    await expect(port.submit({ type: "END_TURN", seat: 0 }, "cid-1")).rejects.toMatchObject({
      name: "SyncHttpError",
      status: 422,
      code: "mustPlaceAllTroops",
    });
    port.close();
  });

  it("throws on a 409 not-your-turn", async () => {
    const { fetchImpl } = recorder((call) =>
      call.method === "POST"
        ? jsonResponse({ error: "notYourTurn" }, 409)
        : new Response(null, { status: 204 }),
    );
    const port = createPollingSync({
      gameId: "g_1",
      since: 1,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
    });
    await settle();
    await expect(port.submit({ type: "END_TURN", seat: 0 }, "cid-1")).rejects.toBeInstanceOf(
      SyncHttpError,
    );
    port.close();
  });

  it("posts a chat line into this game's scope and re-polls", async () => {
    const { calls, fetchImpl } = recorder((call) =>
      call.method === "POST" ? jsonResponse({ id: 1 }, 201) : new Response(null, { status: 204 }),
    );
    const port = createPollingSync({
      gameId: "g_1",
      since: 1,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
    });
    await settle();
    await port.say({ lineId: 20 });
    await settle();

    const post = calls.find((call) => call.method === "POST");
    expect(post?.url).toBe("/api/chat");
    expect(post?.body).toEqual({ scope: "game", scopeId: "g_1", lineId: 20 });
    port.close();
  });

  it("resigns through its own route", async () => {
    const { calls, fetchImpl } = recorder((call) =>
      call.method === "POST"
        ? jsonResponse({ seq: 6, actions: [action(6)] })
        : new Response(null, { status: 204 }),
    );
    const port = createPollingSync({
      gameId: "g_1",
      since: 5,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
    });
    await settle();
    const result = await port.resign();
    expect(calls.find((call) => call.method === "POST")?.url).toBe("/api/games/g_1/resign");
    expect(result[0]?.seq).toBe(6);
    port.close();
  });
});

describe("resync", () => {
  it("resets the cursor, polls cold, and resolves once the snapshot has been delivered", async () => {
    const seen: number[] = [];
    const { calls, fetchImpl } = recorder((call) => {
      const since = Number(new URL(call.url, "http://x").searchParams.get("since"));
      return since === 0
        ? jsonResponse(syncBody({ seq: 12, snapshot: state(), snapshotSeq: 12 }))
        : new Response(null, { status: 204 });
    });
    const port = createPollingSync({
      gameId: "g_1",
      since: 9,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
    });
    port.onSnapshot((_snapshot, at) => seen.push(at));
    await settle();
    expect(seen).toEqual([]);

    await port.resync();

    const cold = calls.find((call) => call.url.includes("since=0"));
    expect(cold).toBeDefined();
    expect(cold?.headers["if-none-match"]).toBeUndefined();
    expect(seen).toEqual([12]);
    expect(port.seq).toBe(12);
    port.close();
  });

  it("refuses a delta while a snapshot is owed and reports desynced", async () => {
    const statuses: SyncStatus[] = [];
    const folded: number[] = [];
    const { fetchImpl } = recorder(() =>
      jsonResponse(syncBody({ seq: 11, actions: [action(10), action(11)] })),
    );
    const port = createPollingSync({
      gameId: "g_1",
      since: 9,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
      autoStart: false,
    });
    port.onStatus((status) => statuses.push(status));
    port.onActions((rows) => folded.push(...rows.map((row) => row.seq)));

    await port.resync();

    expect(folded).toEqual([]);
    expect(statuses).toContain("desynced");
    port.close();
  });
});

describe("the hard failures", () => {
  it("stops and reports offline on a 401, 403 or 404", async () => {
    for (const status of [401, 403, 404]) {
      const localTime = clock();
      const { fetchImpl } = recorder(() => jsonResponse({ error: "no" }, status));
      const seen: SyncStatus[] = [];
      const port = createPollingSync({
        gameId: "g_1",
        since: 1,
        fetch: fetchImpl,
        now: localTime.now,
        schedule: localTime.schedule,
        visibility: visibility(),
      });
      port.onStatus((value) => seen.push(value));
      await settle();
      expect(seen, String(status)).toContain("offline");
      expect(localTime.pending, String(status)).toBeNull();
      port.close();
    }
  });

  it("reports behind and keeps polling through a 500", async () => {
    const { calls, fetchImpl } = recorder(() => jsonResponse({ error: "boom" }, 500));
    const seen: SyncStatus[] = [];
    const port = createPollingSync({
      gameId: "g_1",
      since: 1,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      random: () => 0.5,
      visibility: visibility(),
    });
    port.onStatus((value) => seen.push(value));
    await settle();
    expect(seen).toContain("behind");
    expect(time.pending).toBe(OTHER_TURN_MS);
    await time.tick();
    expect(calls).toHaveLength(2);
    port.close();
  });
});

/* ------------------------------------------------------- fog: view mode -- */

/**
 * A fog poll body (§5.5, §6): the viewer's **masked** snapshot at
 * `snapshotSeq === seq`, plus the actions since `since` for animation only.
 */
function fogBody(at: number, actions: readonly LoggedAction[]): GameSyncBody {
  return syncBody({
    seq: at,
    snapshot: { fogged: true, rules: { fogOfWar: true } } as unknown as GameState,
    snapshotSeq: at,
    actions,
  });
}

/** A row carrying a wire shape the `Action` union does not declare. */
function wireRow(at: number, payload: unknown): LoggedAction {
  return { ...action(at), action: payload as LoggedAction["action"] };
}

describe("fog view mode", () => {
  it("emits the animation actions BEFORE the masked snapshot", async () => {
    const order: string[] = [];
    const { fetchImpl } = recorder(() => jsonResponse(fogBody(9, [action(8), action(9)])));
    const port = createPollingSync({
      gameId: "g_1",
      since: 7,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
    });
    port.onSnapshot((_snapshot, at) => order.push(`snapshot:${at}`));
    port.onActions((rows) => order.push(`actions:${rows.map((row) => row.seq).join(",")}`));
    await settle();

    // The other order set the session's `folded` cursor to 9 first, so both
    // rows were then skipped as already folded and nothing animated at all.
    expect(order).toEqual(["actions:8,9", "snapshot:9"]);
    port.close();
  });

  it("keeps snapshot-then-actions when the snapshot is authoritative", async () => {
    const order: string[] = [];
    const { fetchImpl } = recorder(() =>
      jsonResponse(
        syncBody({ seq: 9, snapshot: state(), snapshotSeq: 4, actions: [action(5), action(9)] }),
      ),
    );
    const port = createPollingSync({
      gameId: "g_1",
      since: 0,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
    });
    port.onSnapshot((_snapshot, at) => order.push(`snapshot:${at}`));
    port.onActions((rows) => order.push(`actions:${rows.map((row) => row.seq).join(",")}`));
    await settle();

    expect(order).toEqual(["snapshot:4", "actions:5,9"]);
    port.close();
  });

  it("drops HIDDEN rows and a redacted CARD_DRAWN, keeping the rest", async () => {
    const { fetchImpl } = recorder(() =>
      jsonResponse(
        fogBody(10, [
          wireRow(8, { type: "HIDDEN", seat: 2 }),
          wireRow(9, { type: "CARD_DRAWN", seat: 2, card: null }),
          action(10),
        ]),
      ),
    );
    const batches: number[][] = [];
    const port = createPollingSync({
      gameId: "g_1",
      since: 7,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
    });
    port.onActions((rows) => batches.push(rows.map((row) => row.seq)));
    await settle();

    // Neither shape is foldable: one is not an `Action` at all, the other has
    // no card to put in a hand.
    expect(batches).toEqual([[10]]);
    // The cursor still moved past them, so they are never asked for again.
    expect(port.seq).toBe(10);
    port.close();
  });

  it("emits nothing when every fog row is unfoldable", async () => {
    const { fetchImpl } = recorder(() =>
      jsonResponse(fogBody(8, [wireRow(8, { type: "HIDDEN", seat: 1 })])),
    );
    const actions = vi.fn();
    const port = createPollingSync({
      gameId: "g_1",
      since: 7,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
    });
    port.onActions(actions);
    await settle();
    expect(actions).not.toHaveBeenCalled();
    port.close();
  });
});

/* --------------------------------------------------- the eliminated seat -- */

/** A body in which `you.seat` holds `standing`. */
function standingBody(at: number, seat: number, standing: Standing): GameSyncBody {
  return syncBody({
    seq: at,
    you: { seat, cards: [] },
    presence: [{ seat, standing, online: true, missedTurns: 0 }],
  });
}

describe("an eliminated viewer", () => {
  it("stops polling once its own seat is eliminated", async () => {
    const { calls, fetchImpl } = recorder(() =>
      jsonResponse(standingBody(20, 1, "eliminated")),
    );
    const port = createPollingSync({
      gameId: "g_1",
      since: 0,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
    });
    await settle();

    expect(port.eliminated).toBe(true);
    expect(time.pending).toBeNull();
    expect(calls).toHaveLength(1);
    port.close();
  });

  it("treats a resigned seat the same way", async () => {
    const { fetchImpl } = recorder(() => jsonResponse(standingBody(20, 0, "resigned")));
    const port = createPollingSync({
      gameId: "g_1",
      since: 0,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
    });
    await settle();
    expect(port.eliminated).toBe(true);
    expect(time.pending).toBeNull();
    port.close();
  });

  it("keeps polling while its own seat is active and somebody else is out", async () => {
    const { fetchImpl } = recorder(() =>
      jsonResponse(
        syncBody({
          seq: 20,
          you: { seat: 1, cards: [] },
          presence: [
            { seat: 0, standing: "eliminated", online: true, missedTurns: 0 },
            { seat: 1, standing: "active", online: true, missedTurns: 0 },
          ],
        }),
      ),
    );
    const port = createPollingSync({
      gameId: "g_1",
      since: 0,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      random: () => 0.5,
      visibility: visibility(),
    });
    await settle();
    expect(port.eliminated).toBe(false);
    expect(time.pending).toBe(OTHER_TURN_MS);
    port.close();
  });

  it("watch() resumes at the 15 s cadence and is never stopped again", async () => {
    const { calls, fetchImpl } = recorder(() =>
      jsonResponse(standingBody(20, 1, "eliminated")),
    );
    const port = createPollingSync({
      gameId: "g_1",
      since: 0,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      random: () => 0.5,
      visibility: visibility(),
    });
    await settle();
    expect(time.pending).toBeNull();

    port.watch();
    await settle();
    expect(calls).toHaveLength(2);
    // The one exception the cadence table allows, at the slowest interval the
    // design has.
    expect(time.pending).toBe(HIDDEN_MS);

    // The next body still says "eliminated", and must not stop the watcher.
    await time.tick();
    expect(calls).toHaveLength(3);
    expect(time.pending).toBe(HIDDEN_MS);
    port.close();
  });

  it("still stops when the game itself finishes, watcher or not", async () => {
    const bodies: GameSyncBody[] = [
      standingBody(20, 1, "eliminated"),
      { ...standingBody(21, 1, "eliminated"), status: "finished" },
    ];
    const { fetchImpl } = recorder(() => jsonResponse(bodies.shift() ?? bodies[0]));
    const port = createPollingSync({
      gameId: "g_1",
      since: 0,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      random: () => 0.5,
      visibility: visibility(),
    });
    await settle();
    port.watch();
    await settle();
    expect(time.pending).toBeNull();
    port.close();
  });
});

/* ----------------------------------------------- an idempotent POST retry -- */

describe("an idempotent retry", () => {
  it("advances the cursor to the newest action, not to the replayed seq", async () => {
    const { calls, fetchImpl } = recorder((call) =>
      call.method === "POST"
        ? // The retry answers with the ORIGINAL seq plus everything appended
          // since — a bot's whole reply turn, here.
          jsonResponse({ seq: 6, actions: [action(6), action(7), action(8)] })
        : new Response(null, { status: 204 }),
    );
    const port = createPollingSync({
      gameId: "g_1",
      since: 5,
      fetch: fetchImpl,
      now: time.now,
      schedule: time.schedule,
      visibility: visibility(),
    });
    await settle();
    await port.submit({ type: "END_TURN", seat: 0 }, "c1");
    await settle();

    expect(port.seq).toBe(8);
    const poll = calls.filter((call) => call.method === "GET").at(-1);
    expect(poll?.url).toBe("/api/games/g_1?since=8&chatSince=0");
    expect(poll?.headers["if-none-match"]).toBe('W/"8"');
    port.close();
  });
});
