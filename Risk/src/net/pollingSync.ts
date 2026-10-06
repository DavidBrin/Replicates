import type { Action, AttackIntent, GameState } from "@/engine/types";
import type { ChatSend, LoggedAction, SyncPort, SyncStatus } from "@/ports/sync";

import {
  createPollingLoop,
  MY_TURN_MS,
  OTHER_TURN_MS,
  type Cancel,
  type PollingLoop,
  type VisibilitySource,
} from "./pollingLoop";
import { SyncHttpError, type ActionPostBody, type GameSyncBody } from "./types";

/**
 * The polling `SyncPort` (SPEC §4.16, §5.5) — the only implementation in v1
 * (D10).
 *
 * The interface is S4's and lives in `src/ports/sync.ts`; this adapter is
 * S5's, and S4 never imports it. What it adds on top of `SyncPort` is
 * {@link PollingSyncPort.onSync}: POLL 3 returns presence, the turn deadline
 * and chat alongside the delta, because one poll per screen is the whole cost
 * design (D12), and `/play/online/[gameId]` has to pass those three into
 * `GameScreen`'s prop bag. `SyncPort` has no listener for them, so rather
 * than add a fourth request this port republishes the response it already
 * had.
 *
 * Three behaviours that are the protocol rather than the plumbing:
 *
 * - **`If-None-Match` and the 204 fast path.** The port sends back the ETag
 *   it last saw; the server answers `204 No Content` with no body when
 *   `seq === since`, and the port does nothing at all with it. That is the
 *   common case and the whole cost argument.
 * - **An immediate re-poll after your own POST**, so the actions your move
 *   provoked — a bot's reply, a card award — arrive without waiting out an
 *   interval.
 * - **An attack is an intent, never an action.** `submitIntent` sends
 *   `{ kind: "intent" }` and resolves with the authoritative `ATTACK` carrying
 *   the numbers; the client must not predict dice, so there is no optimistic
 *   path for one (F11).
 */

export interface PollingSyncOptions {
  readonly gameId: string;
  readonly since: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly schedule?: (fn: () => void, ms: number) => Cancel;
  /** Injected so a test can assert the jitter bounds at both extremes. */
  readonly random?: () => number;
  readonly visibility?: VisibilitySource;
  /**
   * Whether it is the viewer's turn, which is what picks 2,000 ms over
   * 4,000 ms.
   *
   * It is a callback rather than something the port derives, because
   * answering it means knowing the current seat, and the current seat comes
   * from the folded state — which is the **session's**, not the port's. A
   * port that folded state to schedule itself would be a second, quieter
   * implementation of §5.5's fold.
   */
  readonly isMyTurn?: () => boolean;
  /** Start polling on creation. Default `true`. */
  readonly autoStart?: boolean;
}

export interface PollingSyncPort extends SyncPort {
  /** The whole POLL 3 body, for the presence / deadline / chat props (§7). */
  onSync(listener: (body: GameSyncBody) => void): () => void;
  /** The chat cursor the next poll will send. */
  readonly chatSince: number;
  /** The last delay the loop scheduled, in ms. Read by the debug hook. */
  readonly lastDelayMs: number;
  /** Send one preset chat line or emoji into this game's scope (§5.9). */
  say(line: ChatSend): Promise<void>;
  /** Resign: `SEAT_TO_BOT { reason: "resigned" }` (D76). */
  resign(): Promise<readonly LoggedAction[]>;
}

type Listener<T> = (value: T) => void;

function listeners<T>(): {
  add(listener: Listener<T>): () => void;
  emit(value: T): void;
} {
  const set = new Set<Listener<T>>();
  return {
    add(listener) {
      set.add(listener);
      return () => set.delete(listener);
    },
    emit(value) {
      for (const listener of [...set]) {
        try {
          listener(value);
        } catch (error) {
          // One misbehaving subscriber must not stop the others, and must not
          // make the poll look like it failed.
          console.error("[sync] listener threw", error);
        }
      }
    },
  };
}

export function createPollingSync(options: PollingSyncOptions): PollingSyncPort {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const actionListeners = listeners<readonly LoggedAction[]>();
  const statusListeners = listeners<SyncStatus>();
  const snapshotListeners = listeners<{ snapshot: GameState; seq: number }>();
  const syncListeners = listeners<GameSyncBody>();

  let seq = options.since;
  let chatSince = 0;
  let etag: string | null = null;
  let status: SyncStatus = "idle";
  let overrideMs: number | null = null;
  let closed = false;

  function setStatus(next: SyncStatus): void {
    if (status === next) return;
    status = next;
    statusListeners.emit(next);
  }

  function base(): string {
    return `/api/games/${encodeURIComponent(options.gameId)}`;
  }

  function intervalMs(): number {
    if (overrideMs !== null) return overrideMs;
    return options.isMyTurn?.() === true ? MY_TURN_MS : OTHER_TURN_MS;
  }

  /** Fold one POLL 3 body into the port's cursors and out to the listeners. */
  function accept(body: GameSyncBody): void {
    // Order matters: a snapshot replaces the client's confirmed state, so it
    // has to land before the actions that follow it (§5.5).
    if (body.snapshot !== undefined) {
      snapshotListeners.emit({
        snapshot: body.snapshot,
        seq: body.snapshotSeq ?? body.seq,
      });
    }
    if (body.actions.length > 0) actionListeners.emit(body.actions);

    for (const line of body.chat) chatSince = Math.max(chatSince, line.id);
    // `seq` only ever moves forward: a response that overtook another must
    // not walk the cursor back and re-deliver actions already folded.
    seq = Math.max(seq, body.seq);
    etag = `W/"${body.seq}"`;
    syncListeners.emit(body);

    if (body.status !== "playing") {
      setStatus("idle");
      loop.stop();
    }
  }

  async function pollOnce(): Promise<void> {
    if (closed) return;
    setStatus("polling");
    const url = `${base()}?since=${seq}&chatSince=${chatSince}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (etag !== null) headers["If-None-Match"] = etag;

    const response = await doFetch(url, { method: "GET", headers, cache: "no-store" });

    if (response.status === 204) {
      // The fast path: no body, nothing to fold, nothing to emit.
      setStatus("idle");
      return;
    }
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      setStatus("offline");
      loop.stop();
      throw new SyncHttpError(response.status);
    }
    if (!response.ok) {
      setStatus("behind");
      throw new SyncHttpError(response.status);
    }

    accept((await response.json()) as GameSyncBody);
    setStatus("idle");
  }

  const loop: PollingLoop = createPollingLoop({
    poll: pollOnce,
    intervalMs,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.schedule === undefined ? {} : { schedule: options.schedule }),
    ...(options.random === undefined ? {} : { random: options.random }),
    ...(options.visibility === undefined ? {} : { visibility: options.visibility }),
  });

  async function post<T>(path: string, body: unknown): Promise<T> {
    const response = await doFetch(`${base()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      let code: string | undefined;
      try {
        code = ((await response.json()) as { code?: string }).code;
      } catch {
        code = undefined;
      }
      if (response.status === 422 || response.status === 409) setStatus("behind");
      throw new SyncHttpError(response.status, code);
    }
    return (await response.json()) as T;
  }

  /**
   * Submit, fold the authoritative answer, then re-poll immediately.
   *
   * The re-poll is not belt and braces: the authority may have appended more
   * than the one action — a card award, a bot's whole reply turn — and
   * waiting out an interval to see it is the difference between the board
   * feeling live and feeling laggy.
   */
  async function send(body: unknown): Promise<readonly LoggedAction[]> {
    const answer = await post<ActionPostBody>("/actions", body);
    if (answer.actions.length > 0) actionListeners.emit(answer.actions);
    seq = Math.max(seq, answer.seq);
    etag = `W/"${answer.seq}"`;
    void loop.pollNow();
    return answer.actions;
  }

  if (options.autoStart !== false) loop.start();

  return {
    poll: () => loop.pollNow(),
    submit: (action: Action, clientActionId: string) =>
      send({ clientActionId, kind: "action", action }),
    submitIntent: (intent: AttackIntent, clientActionId: string) =>
      send({ clientActionId, kind: "intent", intent }),
    onActions: (listener) => actionListeners.add(listener),
    onStatus: (listener) => statusListeners.add(listener),
    onSnapshot: (listener) =>
      snapshotListeners.add(({ snapshot, seq: at }) => listener(snapshot, at)),
    onSync: (listener) => syncListeners.add(listener),
    setIntervalMs(ms: number) {
      overrideMs = ms > 0 ? ms : null;
      loop.resume();
    },
    get seq() {
      return seq;
    },
    get chatSince() {
      return chatSince;
    },
    get lastDelayMs() {
      return loop.lastDelayMs;
    },
    async say(line: ChatSend) {
      await doFetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ scope: "game", scopeId: options.gameId, ...line }),
      });
      void loop.pollNow();
    },
    async resign() {
      const answer = await post<ActionPostBody>("/resign", {});
      if (answer.actions.length > 0) actionListeners.emit(answer.actions);
      seq = Math.max(seq, answer.seq);
      void loop.pollNow();
      return answer.actions;
    },
    close() {
      closed = true;
      loop.stop();
      setStatus("offline");
    },
  };
}
