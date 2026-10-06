import type { Action, AttackIntent, GameState, Standing } from "@/engine/types";
import type { ChatSend, LoggedAction, SyncPort, SyncStatus } from "@/ports/sync";

import {
  createPollingLoop,
  HIDDEN_MS,
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
  /** Always present on this adapter (optional on the port): see the member's doc comment. */
  resync(): Promise<void>;
  /**
   * Whether the viewer's own seat is out — `eliminated` or `resigned`.
   *
   * §5.5's cadence table ends "Game finished, or you are eliminated → stop",
   * and the port is where that is enforced, because `presence[].standing` for
   * `you.seat` is a field of the poll body and nothing else has to be folded
   * to read it.
   */
  readonly eliminated: boolean;
  /**
   * Resume as a watcher at the 15 s cadence — the one exception to the stop.
   *
   * It is opt-in on purpose: an eliminated tab left open is exactly the
   * abandoned-tab cost D11 is about, so the player has to ask. Once asked,
   * a later poll must not stop the loop again.
   */
  watch(): void;
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

/**
 * Rows the session must **not** fold, dropped before `onActions` (§5.5, F36).
 *
 * A fog poll carries its actions "FOR ANIMATION ONLY", and two of their shapes
 * are deliberately not replayable:
 *
 * - **`HIDDEN`** stands in for an action the viewer may not see at all. It is
 *   not an `Action` the engine knows, so folding one answers `illegalAction`
 *   and flips the session to `desynced` on every poll of every fog game.
 * - **`CARD_DRAWN` with `card: null`** is another seat's draw with the card
 *   redacted. The size is already in the masked snapshot's `cardCount`, so
 *   there is nothing to fold and a null card would invent a card that is not
 *   there.
 *
 * Both are matched structurally rather than through the `Action` union:
 * `HIDDEN` is a wire shape the authority mints for a masked view, and the
 * client's job is to survive one, not to be able to construct one.
 */
function foldable(row: LoggedAction): boolean {
  const action = row.action as { readonly type: string; readonly card?: unknown };
  if (action.type === "HIDDEN") return false;
  if (action.type === "CARD_DRAWN" && (action.card === null || action.card === undefined)) {
    return false;
  }
  return true;
}

/**
 * {@link foldable} over a batch, exported for the **one** other place that
 * hands rows to a session: `/play/online/[gameId]`'s replay of the bodies that
 * arrived while the map was still loading. Two copies of this filter would be
 * two places for a `HIDDEN` row to reach `engine.apply`.
 */
export function foldableActions(actions: readonly LoggedAction[]): readonly LoggedAction[] {
  return actions.filter(foldable);
}

/**
 * Whether a snapshot is a **masked view** rather than authoritative state.
 *
 * `viewFor` stamps `fogged: true`, which is what makes a state unhashable
 * (F36) — and unfoldable-onto, which is what matters here: the actions in the
 * same body are animation, not a delta to apply after it.
 */
export function isMaskedView(snapshot: GameState): boolean {
  const view = snapshot as {
    readonly fogged?: boolean;
    readonly rules?: { readonly fogOfWar?: boolean };
  };
  return view.fogged === true || view.rules?.fogOfWar === true;
}

/** The highest `seq` in a batch, or `0`. What an idempotent retry needs. */
function highestSeq(actions: readonly LoggedAction[]): number {
  let top = 0;
  for (const row of actions) top = Math.max(top, row.seq);
  return top;
}

/** The viewer's own `standing`, off `presence`, or `null` if they hold no seat. */
function viewerStanding(body: GameSyncBody): Standing | null {
  const mine = body.you.seat;
  if (mine === null || mine === undefined) return null;
  return body.presence.find((row) => row.seat === mine)?.standing ?? null;
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
  let eliminated = false;
  let watching = false;
  /** Set by `resync()`: the next accepted body MUST carry a snapshot (§5.8, D16). */
  let awaitingSnapshot = false;
  let resyncing: Promise<void> | null = null;

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

  /**
   * Fold one POLL 3 body into the port's cursors and out to the listeners.
   *
   * The order is deliberate, and all three steps matter:
   *
   * 1. **`onSync` first.** It carries the response's *metadata* — presence,
   *    the turn deadline, chat, and `you.seat` — none of which is game state.
   *    `you.seat` is what the online screen needs to build a session at all
   *    (`mySeat`), and on a cold poll the snapshot and the seat arrive in the
   *    same body; emitting the snapshot first meant the screen was handed a
   *    board before it knew whose board it was, and the session was never
   *    built. The two-window smoke test caught it as a game stuck on
   *    "Connecting…" with a perfectly healthy `seq`.
   * 2. **then the snapshot**, which replaces the confirmed state.
   * 3. **then the actions**, which fold on top of it (§5.5).
   *
   * **Except in view mode, where 2 and 3 swap.** A fog body carries the
   * viewer's masked snapshot at `snapshotSeq === seq` *and* the actions since
   * `since` for animation. Emitting the snapshot first set the session's
   * `folded` cursor to the head, so every one of those rows was then skipped
   * as already folded and a fog game animated nothing at all — no dice, no
   * troop arcs, no capture flash. The masked snapshot is also the last word on
   * the state either way (it is authoritative-for-this-viewer and replaces
   * whatever the animation rows did to it), so animating first and replacing
   * second is both the right order and the safe one.
   */
  function accept(body: GameSyncBody): void {
    // A resync asked the authority for a cold read. Until a snapshot answers
    // it, a delta — from the resync poll or from one that was already in
    // flight — is exactly what the client can no longer apply, so it is
    // refused and the desync stays visible rather than being folded over.
    if (awaitingSnapshot && body.snapshot === undefined) {
      setStatus("desynced");
      return;
    }
    awaitingSnapshot = false;
    for (const line of body.chat) chatSince = Math.max(chatSince, line.id);
    // `seq` only ever moves forward: a response that overtook another must
    // not walk the cursor back and re-deliver actions already folded.
    seq = Math.max(seq, body.seq);
    etag = `W/"${body.seq}"`;
    syncListeners.emit(body);

    const rows = body.actions.filter(foldable);
    const masked = body.snapshot !== undefined && isMaskedView(body.snapshot);

    if (masked && rows.length > 0) actionListeners.emit(rows);
    if (body.snapshot !== undefined) {
      snapshotListeners.emit({
        snapshot: body.snapshot,
        seq: body.snapshotSeq ?? body.seq,
      });
    }
    if (!masked && rows.length > 0) actionListeners.emit(rows);

    // §5.5's cadence table: "Game finished, or you are eliminated → stop".
    // `pause` rather than `stop`, so a viewer who asks to watch comes back
    // with the hidden-tab cadence and the five-minute hidden stop intact.
    const standing = viewerStanding(body);
    eliminated = standing === "eliminated" || standing === "resigned";

    if (body.status !== "playing" || (eliminated && !watching)) {
      setStatus("idle");
      loop.pause();
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
    const rows = answer.actions.filter(foldable);
    if (rows.length > 0) actionListeners.emit(rows);
    // An **idempotent retry** answers with the ORIGINAL `seq` — the one the
    // first attempt was assigned — plus every action appended since. Trusting
    // `answer.seq` alone would walk the cursor back behind rows this port has
    // just delivered and ask for them all again on the next poll, so the
    // cursor takes whichever is further on.
    seq = Math.max(seq, answer.seq, highestSeq(answer.actions));
    etag = `W/"${seq}"`;
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
    /**
     * `SyncPort.resync` (§5.8, D16): throw the folded state away and start again
     * from the authority. Reset both cursors so the next poll is a cold read,
     * poll once, and resolve once that response has been delivered. Idempotent —
     * a second call while one is in flight joins it — and safe under racing
     * polls, because `accept` refuses every delta until a snapshot has landed.
     */
    resync(): Promise<void> {
      if (resyncing) return resyncing;
      seq = 0;
      chatSince = 0;
      etag = null;
      awaitingSnapshot = true;
      resyncing = loop
        .pollNow()
        .catch(() => {
          setStatus("desynced");
        })
        .finally(() => {
          resyncing = null;
        });
      return resyncing;
    },
    async resign() {
      const answer = await post<ActionPostBody>("/resign", {});
      const rows = answer.actions.filter(foldable);
      if (rows.length > 0) actionListeners.emit(rows);
      seq = Math.max(seq, answer.seq, highestSeq(answer.actions));
      void loop.pollNow();
      return answer.actions;
    },
    get eliminated() {
      return eliminated;
    },
    watch() {
      watching = true;
      overrideMs = HIDDEN_MS;
      loop.resume();
    },
    close() {
      closed = true;
      loop.stop();
      setStatus("offline");
    },
  };
}
