"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import GameScreen from "@/components/game/GameScreen";
import { createOdds } from "@/engine/odds";
import type { GameConfig, GameState, PlayerColour, SeatConfig } from "@/engine/types";
import { engineApi } from "@/game/engineApi";
import { createSession, type SavedSession, type Session } from "@/game/session";
import { registerRiskDebug, unregisterRiskDebug } from "@/net/debugBridgeClient";
import { loadMapForSlug } from "@/net/mapClient";
import {
  createPollingSync,
  foldableActions,
  isMaskedView,
  type PollingSyncPort,
} from "@/net/pollingSync";
import type { GameSyncBody } from "@/net/types";
import type { ChatLine, ChatSend } from "@/ports/sync";

/**
 * `/play/online/[gameId]` — **a composition and nothing else** (SPEC §7, F26).
 *
 * S4 owns `GameScreen` and builds every part of it, including the three
 * pieces only an online game uses: the turn-timer bar, the presence dots on
 * the roster capsules, and the chat drawer. This component's whole job is to
 * create the `SyncPort`, hold the POLL 3 response, and pass `presence`,
 * `turnDeadline`, `chat` and `onChat` down. No timer, no dot and no drawer is
 * implemented twice.
 *
 * The session wiring is `createSession({ …, sync, mySeat })`: with `sync` set,
 * S4's runner subscribes to the port's `onActions` / `onSnapshot` itself, so
 * there is nothing to forward — non-attack actions go out optimistically
 * through `submit`, and an attack only ever through `submitIntent`, because
 * the client must not predict dice (F11).
 *
 * It also registers S5's half of `window.__riskDebug` — `pollNow` and
 * `setInterval` — which is what lets T10's specs drive the loop instead of
 * sleeping through it. S4 registers `state` and `seq` from the session, and
 * `registerDebug` merges rather than replaces.
 *
 * **`games.seed` is never here.** The `GameConfig` handed to `createSession`
 * carries an empty seed on purpose: online, every random outcome is already a
 * value inside an action's payload, decided by the authority, so the session
 * has no randomness left to resolve (D5, §5.2).
 */

export interface OnlineGameProps {
  readonly gameId: string;
}

/**
 * The port rides the `ready` state rather than being read off a ref during
 * render: a ref's `current` is not a render input, and `GameScreen` needs the
 * same port the session was built with — so the two are published together,
 * in one transition, the moment both exist.
 */
type Phase =
  | { readonly kind: "connecting" }
  | { readonly kind: "ready"; readonly session: Session; readonly port: PollingSyncPort }
  | { readonly kind: "unavailable"; readonly reason: string };

/**
 * The small, **derived** slice of a POLL 3 body that render actually reads.
 *
 * The whole body used to go into state, `snapshot: GameState` and all — a
 * 42-territory board, a full seat roster and every card, re-identified on
 * every poll, held alive by React for as long as the screen is open and
 * diffed against the previous one on every commit. None of it is a render
 * input: the snapshot's only consumer is `session.ingestSnapshot`, which the
 * session subscribes to itself. So the body stays in a ref and only these
 * fields — all primitives or already-published arrays — become state.
 */
interface SyncView {
  readonly seq: number;
  /** `null` until the first body lands, which the panel renders as `—`. */
  readonly status: GameSyncBody["status"] | null;
  readonly seat: number | null;
  readonly presence: GameSyncBody["presence"];
  readonly turnDeadline: string | null;
  /** The viewer's own seat is out: `eliminated` or `resigned` (§5.5). */
  readonly eliminated: boolean;
}

const EMPTY_VIEW: SyncView = {
  seq: 0,
  status: null,
  seat: null,
  presence: [],
  turnDeadline: null,
  eliminated: false,
};

function viewOf(body: GameSyncBody): SyncView {
  const seat = body.you.seat;
  const standing = seat === null ? null : body.presence.find((row) => row.seat === seat)?.standing;
  return {
    seq: body.seq,
    status: body.status,
    seat,
    presence: body.presence,
    turnDeadline: body.turnDeadline,
    eliminated: standing === "eliminated" || standing === "resigned",
  };
}

/** How many chat lines the drawer keeps. The log scrolls; memory does not grow. */
const CHAT_WINDOW = 200;

/**
 * Accumulate a chat delta the way {@link useScreenPoll} does for the lobby.
 *
 * POLL 3 sends only the lines newer than `chatSince`, so rendering the latest
 * body's `chat` array emptied the drawer on the very next poll — every line
 * visible for one interval and then gone. Deduped by `id` because a retried or
 * overtaken response can repeat one, and ordered by `id` because that is the
 * only ordering the server guarantees.
 */
function mergeChat(
  previous: readonly ChatLine[],
  delta: readonly ChatLine[],
): readonly ChatLine[] {
  if (delta.length === 0) return previous;
  const byId = new Map(previous.map((line) => [line.id, line]));
  for (const line of delta) byId.set(line.id, line);
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-CHAT_WINDOW);
}

/** Rebuild the seat configuration from the snapshot the authority sent. */
function seatsOf(state: GameState): SeatConfig[] {
  return state.seats.map((seat) => ({
    kind: seat.kind,
    name: seat.name,
    colour: seat.colour as PlayerColour,
    tier: seat.tier,
  }));
}

export default function OnlineGame({ gameId }: OnlineGameProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "connecting" });
  const [view, setView] = useState<SyncView>(EMPTY_VIEW);
  const [chat, setChat] = useState<readonly ChatLine[]>([]);
  const [watching, setWatching] = useState(false);
  const port = useRef<PollingSyncPort | null>(null);
  const session = useRef<Session | null>(null);
  const latest = useRef<GameSyncBody | null>(null);
  /**
   * Every POLL 3 body seen before the session existed, in order.
   *
   * Building the session is **asynchronous** — the map has to load first — so
   * between the body that carries the opening snapshot and the moment
   * `createSession` subscribes to the port, more bodies can arrive, and the
   * body that triggered the build has already finished being published. Those
   * actions are not resent: the port's cursor has moved past them, and a
   * non-fog game sends no second snapshot to recover from. Replaying this
   * buffer into the new session is what closes that window; without it the
   * session sat on the snapshot at `snapshot_seq` while believing it was at
   * `seq`, and folded the next action onto a state several moves old — which
   * surfaced, correctly, as `[risk] desync` in the console.
   */
  const buffered = useRef<GameSyncBody[]>([]);
  const starting = useRef(false);

  /**
   * Whether it is the viewer's turn — what picks 2,000 ms over 4,000 ms.
   *
   * The session is read from a **ref** and the callback has no dependencies,
   * which is load-bearing rather than tidy: it is passed into
   * `createPollingSync` inside the effect below, so a callback that changed
   * whenever the poll response did would re-run that effect, close the port
   * and create a new one on **every response** — resetting `seq` to 0 each
   * time and making `__riskDebug.seq()` permanently 0. The two-window smoke
   * test is how that was found.
   */
  const isMyTurn = useCallback(() => {
    const live = session.current;
    if (!live) return false;
    const state = live.confirmed();
    return state.turnOrder[state.currentIndex] === live.mySeat();
  }, []);

  useEffect(() => {
    const created = createPollingSync({ gameId, since: 0, isMyTurn });
    port.current = created;
    /**
     * This mount's generation.
     *
     * `startIfReady` awaits the map before it builds a session, and nothing
     * stopped the continuation: an unmount or a re-keyed `gameId` ran the
     * cleanup, closed the port — and then the resolved `loadMapForSlug`
     * carried on and called `createSession({ sync: created })` on that closed
     * port, producing a live session nobody held, subscribed to a dead port,
     * and a `setPhase` on an unmounted tree. The flag is checked both sides of
     * the await.
     */
    let live = true;

    const offSync = created.onSync((body) => {
      latest.current = body;
      if (session.current === null) buffered.current.push(body);
      setView(viewOf(body));
      if (body.chat.length > 0) setChat((previous) => mergeChat(previous, body.chat));
      startIfReady();
    });

    /*
     * The session needs **two** things from the authority, and takes whichever
     * arrives last as its cue: a snapshot (online there is no local opening to
     * fold, and the snapshot IS the resume envelope, §4.15's `SavedSession`)
     * and `you.seat` (a fog snapshot is masked *for* a seat, so `mySeat` has
     * to be told, not inferred).
     *
     * Both come in one body on a cold poll, so the order they are published in
     * should not matter — and this is written so that it does not. Depending
     * on the snapshot arriving second left the screen on "Connecting…" forever
     * with a healthy `seq`, because after the cold poll a non-fog game never
     * sends another snapshot to retry with.
     */
    function startIfReady(): void {
      if (!live || session.current !== null || starting.current) return;
      const first = buffered.current.find((body) => body.snapshot !== undefined);
      const snapshot = first?.snapshot;
      const mySeat = latest.current?.you.seat;
      if (!snapshot || mySeat === null || mySeat === undefined) return;

      starting.current = true;
      void (async () => {
        try {
          const map = await loadMapForSlug(snapshot.mapSlug);
          if (!live) return;
          const config: GameConfig = {
            mapSlug: snapshot.mapSlug,
            rules: snapshot.rules,
            seats: seatsOf(snapshot),
            seed: "",
          };
          const resume: SavedSession = {
            version: 1,
            config,
            state: snapshot,
            turn: snapshot.turn,
            grudge: [],
            savedAt: Date.now(),
          };
          const built = createSession({
            map,
            config,
            engine: engineApi,
            odds: createOdds(snapshot.rules.diceMode),
            sync: created,
            mySeat,
            resume,
          });
          session.current = built;
          built.start();

          // Catch the session up on everything that arrived while the map was
          // loading, in the same order `accept` publishes a live body in:
          // an authoritative snapshot replaces the confirmed state and the
          // actions fold on top of it, while a **masked** view goes last,
          // because its actions are animation at the head seq and folding them
          // after it would skip every one (§5.5). `ingest` ignores anything at
          // or below what it has already folded, so a body the port also
          // delivered through the subscription is harmless.
          for (const body of buffered.current) {
            const rows = foldableActions(body.actions);
            const masked = body.snapshot !== undefined && isMaskedView(body.snapshot);
            if (masked && rows.length > 0) built.ingest(rows);
            if (body.snapshot !== undefined) {
              built.ingestSnapshot(body.snapshot, body.snapshotSeq ?? body.seq);
            }
            if (!masked && rows.length > 0) built.ingest(rows);
          }
          buffered.current = [];

          setPhase({ kind: "ready", session: built, port: created });
        } catch (error) {
          starting.current = false;
          if (!live) return;
          setPhase({
            kind: "unavailable",
            reason: error instanceof Error ? error.message : "could not start the game",
          });
        }
      })();
    }

    // The snapshot itself rides `onSync`'s body, which is published first
    // (see `accept`), so this listener exists only to cover the order the
    // other way round — a port that emitted the snapshot first would still
    // get a session built.
    const offSnapshot = created.onSnapshot(() => {
      startIfReady();
    });

    registerRiskDebug({
      pollNow: () => created.poll(),
      setInterval: (ms: number) => created.setIntervalMs(ms),
    });

    return () => {
      live = false;
      offSync();
      offSnapshot();
      created.close();
      session.current?.destroy();
      session.current = null;
      port.current = null;
      latest.current = null;
      buffered.current = [];
      starting.current = false;
      unregisterRiskDebug();
    };
  }, [gameId, isMyTurn]);

  const onChat = useCallback((line: ChatSend) => {
    void port.current?.say(line);
  }, []);

  /**
   * The one exception to "eliminated → stop" (§5.5).
   *
   * The port has already paused the loop; this re-arms it at the 15 s hidden
   * cadence, which is the slowest interval the design has and the only one a
   * screen nobody is playing on may use.
   */
  const watch = useCallback(() => {
    setWatching(true);
    port.current?.watch();
  }, []);

  /**
   * Offered only while the game is still running: once `status` leaves
   * `playing` the game is over for everyone, and "watch" has nothing left to
   * show.
   */
  const offerWatch = view.eliminated && !watching && view.status === "playing";

  if (phase.kind === "ready") {
    return (
      <>
        <GameScreen
          session={phase.session}
          sync={phase.port}
          presence={view.presence}
          turnDeadline={view.turnDeadline}
          chat={chat}
          onChat={onChat}
        />
        {offerWatch && (
          <div
            data-testid="online-eliminated"
            role="status"
            className="fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-center justify-center gap-3 border-t border-[color:var(--chrome-line)] bg-[color:var(--chrome-900)] px-4 py-3 text-center"
          >
            <p className="font-head text-sm font-bold text-[color:var(--text)]">
              You were eliminated — the board has stopped updating.
            </p>
            <button
              type="button"
              data-testid="online-watch"
              onClick={watch}
              className="rounded-lg bg-[color:var(--go)] px-4 py-1.5 font-head text-sm font-bold text-white"
            >
              Watch
            </button>
          </div>
        )}
      </>
    );
  }

  // A status panel, not a spinner: it keeps polling, so `__riskDebug.pollNow()`
  // works and T10's online spec can drive the protocol even on a screen with
  // no board on it — the moment before the first snapshot lands, or a map that
  // will not load.
  return (
    <main
      data-testid="online-game-status"
      data-seq={view.seq}
      data-status={phase.kind}
      className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <h1 className="font-head text-2xl font-bold text-[color:var(--text)]">
        {phase.kind === "connecting" ? "Connecting…" : "The board is not ready"}
      </h1>
      <p className="text-sm text-[color:var(--text-muted)]">
        {phase.kind === "connecting"
          ? "Waiting for the first snapshot from the authority."
          : phase.reason}
      </p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-[color:var(--text-dim)]">
        <dt>seq</dt>
        <dd data-testid="online-seq">{view.seq}</dd>
        <dt>your seat</dt>
        <dd data-testid="online-seat">{view.seat ?? "—"}</dd>
        <dt>status</dt>
        <dd data-testid="online-status">{view.status ?? "—"}</dd>
        <dt>turn deadline</dt>
        <dd data-testid="online-deadline">{view.turnDeadline ?? "—"}</dd>
      </dl>
    </main>
  );
}
