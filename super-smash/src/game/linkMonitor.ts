/**
 * Whether the other players are still there, during an online match.
 *
 * Four signals, one verdict. A player's link closing is final. Silence is
 * judged by a watchdog per player (net/online/watchdog.ts), fed only by that
 * player's packets, so the others talking never covers for one gone quiet. A
 * tab going to the background tells the others first — through the room,
 * which a hidden tab can still reach — so their watchdog for it waits a minute
 * instead of ten seconds. And a match that stops confirming frames is over
 * even while packets arrive: a peer stuck at its prediction cap still sends a
 * heartbeat every frame, so silence alone would wait on it forever.
 *
 * Any one player lost is the match lost, for everyone (Plan 7, Phase B): the
 * rollback session cannot play on with a port nobody drives.
 *
 * The verdict is given once. The first "lost" stops everything here, so a
 * packet straggling in afterwards cannot revive a match that has already been
 * handed to the results screen.
 */

import type { OnlineSessionLike } from "@/net/online/session";
import { AWAY_LOST_MS, ConnectionWatchdog, type LinkHealth } from "@/net/online/watchdog";
import type { Transport } from "@/net/transport";

export const LINK_CHECK_MS = 250;

/**
 * How long a match may confirm no frame, while this tab is on screen and the
 * the other players' are too, before it is lost however many packets still arrive.
 *
 * The same ten seconds silence gets (`SILENCE_LOST_MS`), and a player who
 * said it is away gets the same minute. Nothing in a running match stops the
 * confirmed frame for anywhere near this long on its own: it counts ticks,
 * which a KO's freeze does not stop (the simulation still steps), and an
 * online match has no pause (Esc only opens the way out). A spike pause or a
 * time-sync stall is a few frames.
 */
export const STALL_LOST_MS = 10_000;

export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", cb: () => void): void;
  removeEventListener(type: "visibilitychange", cb: () => void): void;
}

export interface LinkMonitorOptions {
  readonly transport: Pick<Transport, "onMessage" | "onPeerLeave">;
  readonly session: Pick<OnlineSessionLike, "on" | "sendLobby">;
  /**
   * The match's other players, by peer id: the begun room's roster. Each is
   * watched on its own. A leave, a packet or an `away` from anyone else (a
   * stranger who typed the code) changes nothing.
   */
  readonly peers: readonly string[];
  /** The worst player's health, and whether any of them said they switched tabs. */
  readonly onHealth: (health: LinkHealth, peerAway: boolean) => void;
  readonly onLost: () => void;
  /**
   * The rollback session's confirmed frame: the highest frame with every
   * player's input in hand. Absent, silence alone decides.
   */
  readonly confirmedFrame?: () => number;
  /** Monotonic milliseconds; `performance.now()` unless given. */
  readonly now?: () => number;
  /** Defaults to `document`; null for none. */
  readonly visibility?: VisibilitySource | null;
  readonly every?: (cb: () => void, ms: number) => () => void;
}

export function startLinkMonitor(options: LinkMonitorOptions): () => void {
  const now = options.now ?? (() => performance.now());
  const every =
    options.every ??
    ((cb: () => void, ms: number) => {
      const id = window.setInterval(cb, ms);
      return () => window.clearInterval(id);
    });
  const visibility =
    options.visibility === undefined
      ? typeof document === "undefined"
        ? null
        : // One cast at the boundary: Document's overloaded listener types are wider than this slice.
          (document as unknown as VisibilitySource)
      : options.visibility;

  const start = now();
  const dogs = new Map(options.peers.map((peer) => [peer, new ConnectionWatchdog(start)]));
  const anyAway = (): boolean => [...dogs.values()].some((dog) => dog.peerAway);
  /** The worst of the players' readings: one lost is the match lost, one quiet is the match waiting. */
  const worstHealth = (at: number): LinkHealth => {
    let worst: LinkHealth = "ok";
    for (const dog of dogs.values()) {
      const health = dog.check(at);
      if (health === "lost") return health;
      if (health === "waiting") worst = health;
    }
    return worst;
  };
  let lost = false;
  let stopped = false;
  let lastHealth: LinkHealth | null = null;
  let lastAway = false;
  // When the confirmed frame last moved, judged like silence: from the start,
  // and afresh whenever this tab returns or a player says it left or came back.
  let confirmed = options.confirmedFrame?.() ?? -1;
  let progressAt = start;

  const stalledOut = (at: number): boolean => {
    if (!options.confirmedFrame) return false;
    const frame = options.confirmedFrame();
    if (frame > confirmed) {
      confirmed = frame;
      progressAt = at;
      return false;
    }
    // One player away stalls the confirmed frame for everyone, so with three
    // or four the whole match gets their minute (and any player's away resets it).
    return at - progressAt >= (anyAway() ? AWAY_LOST_MS : STALL_LOST_MS);
  };

  const declareLost = () => {
    if (lost || stopped) return;
    lost = true;
    stop();
    options.onLost();
  };

  const report = () => {
    if (stopped) return;
    // While this tab is hidden its own timers and packets can stall, so any
    // silence measured then says nothing about the other players. It is judged
    // again from the moment the tab is back (see `onVisibility`).
    if (visibility?.hidden) return;
    const at = now();
    const health = worstHealth(at);
    if (health === "lost" || stalledOut(at)) {
      declareLost();
      return;
    }
    const away = anyAway();
    if (health !== lastHealth || away !== lastAway) {
      lastHealth = health;
      lastAway = away;
      options.onHealth(health, away);
    }
  };

  const onVisibility = () => {
    if (!visibility) return;
    options.session.sendLobby({ kind: "away", away: visibility.hidden });
    // Back on screen: each player gets a fresh ten seconds from now, not
    // whatever was left of them when this tab went away. So does the match,
    // which stopped confirming when this tab stopped drawing.
    if (!visibility.hidden) {
      const at = now();
      for (const dog of dogs.values()) dog.heard(at);
      progressAt = at;
    }
  };

  const offs = [
    options.transport.onMessage((_bytes, peer) => dogs.get(peer)?.heard(now())),
    options.transport.onPeerLeave((peer) => {
      if (dogs.has(peer)) declareLost();
    }),
    options.session.on((event) => {
      if (event.type !== "lobby" || event.message.kind !== "away") return;
      const dog = dogs.get(event.from);
      if (!dog) return;
      const at = now();
      dog.setPeerAway(event.message.away, at);
      progressAt = at;
      report();
    }),
  ];
  visibility?.addEventListener("visibilitychange", onVisibility);
  const cancel = every(report, LINK_CHECK_MS);
  // A match that starts in a background tab never sees the change that would
  // say so, and the other players would give up on it after ten seconds.
  if (visibility?.hidden) onVisibility();

  function stop(): void {
    if (stopped) return;
    stopped = true;
    cancel();
    for (const off of offs) off();
    visibility?.removeEventListener("visibilitychange", onVisibility);
  }

  return stop;
}
