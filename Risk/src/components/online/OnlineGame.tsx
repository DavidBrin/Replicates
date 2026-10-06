"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createOdds } from "@/engine/odds";
import type { GameConfig, GameState, PlayerColour, SeatConfig } from "@/engine/types";
import GameScreen from "@/components/game/GameScreen";
import { engineApi } from "@/game/engineApi";
import { createSession, type SavedSession, type Session } from "@/game/session";
import { registerRiskDebug, unregisterRiskDebug } from "@/net/debugBridgeClient";
import { loadMapForSlug } from "@/net/mapClient";
import { createPollingSync, type PollingSyncPort } from "@/net/pollingSync";
import type { GameSyncBody } from "@/net/types";
import type { ChatSend } from "@/ports/sync";

/**
 * `/play/online/[gameId]` — **a composition and nothing else** (SPEC §7, F26).
 *
 * S4 owns `GameScreen` and builds every part of it, including the three
 * pieces only an online game uses: the turn-timer bar, the presence dots on
 * the roster capsules, and the chat drawer. This component's whole job is to
 * create the `SyncPort`, hold the poll response, and pass `presence`,
 * `turnDeadline`, `chat` and `onChat` down. No timer, no dot and no drawer is
 * implemented twice.
 *
 * It also registers S5's half of `window.__riskDebug` — `seq`, `pollNow` and
 * `setInterval` — which is what lets T10's specs drive the loop instead of
 * sleeping through it. S4 registers `state` from the session.
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
  const [sync, setSync] = useState<GameSyncBody | null>(null);
  const port = useRef<PollingSyncPort | null>(null);
  const session = useRef<Session | null>(null);

  // `isMyTurn` picks 2,000 ms over 4,000 ms, and only the session knows whose
  // turn it is — so the port asks through a ref rather than folding state of
  // its own (see `PollingSyncOptions.isMyTurn`).
  const isMyTurn = useCallback(() => {
    const live = session.current;
    const body = sync;
    if (!live || !body || body.you.seat === null) return false;
    const state = live.confirmed();
    return state.turnOrder[state.currentIndex] === body.you.seat;
  }, [sync]);

  useEffect(() => {
    const created = createPollingSync({ gameId, since: 0, isMyTurn });
    port.current = created;

    const offSync = created.onSync((body) => setSync(body));

    // The session can only be built once the authority has sent a snapshot:
    // online there is no local opening to fold, and the snapshot IS the
    // resume envelope (§4.15's `SavedSession`).
    const offSnapshot = created.onSnapshot((snapshot) => {
      if (session.current !== null) return;
      void (async () => {
        try {
          const map = await loadMapForSlug(snapshot.mapSlug);
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
            resume,
          });
          session.current = built;
          built.start();
          setPhase({ kind: "ready", session: built, port: created });
        } catch (error) {
          setPhase({
            kind: "unavailable",
            reason: error instanceof Error ? error.message : "could not start the game",
          });
        }
      })();
    });

    void registerRiskDebug({
      seq: () => created.seq,
      pollNow: () => created.poll(),
      setInterval: (ms: number) => created.setIntervalMs(ms),
    });

    return () => {
      offSync();
      offSnapshot();
      created.close();
      session.current?.destroy();
      session.current = null;
      port.current = null;
      unregisterRiskDebug(["seq", "pollNow", "setInterval"]);
    };
  }, [gameId, isMyTurn]);

  const onChat = useCallback((line: ChatSend) => {
    void port.current?.say(line);
  }, []);

  if (phase.kind === "ready") {
    return (
      <GameScreen
        session={phase.session}
        sync={phase.port}
        presence={sync?.presence ?? []}
        turnDeadline={sync?.turnDeadline ?? null}
        chat={sync?.chat ?? []}
        onChat={onChat}
      />
    );
  }

  // The status panel, not a spinner: while S4's session runner or S3's map
  // catalogue is still in flight this is the screen, and it still polls — so
  // `__riskDebug.seq()` and `pollNow()` work and T10's online spec can drive
  // the protocol before any board exists.
  return (
    <main
      data-testid="online-game-status"
      data-seq={sync?.seq ?? 0}
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
        <dd data-testid="online-seq">{sync?.seq ?? 0}</dd>
        <dt>your seat</dt>
        <dd data-testid="online-seat">{sync?.you.seat ?? "—"}</dd>
        <dt>status</dt>
        <dd data-testid="online-status">{sync?.status ?? "—"}</dd>
        <dt>turn deadline</dt>
        <dd data-testid="online-deadline">{sync?.turnDeadline ?? "—"}</dd>
      </dl>
    </main>
  );
}
