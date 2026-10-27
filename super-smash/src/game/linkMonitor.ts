/**
 * Whether the other player is still there, during an online match.
 *
 * Three signals, one verdict. The data channel closing is final. Silence is
 * judged by the watchdog (net/online/watchdog.ts). And a tab going to the
 * background tells the opponent first — through the room, which a hidden tab
 * can still reach — so their watchdog waits a minute instead of ten seconds.
 *
 * The verdict is given once. The first "lost" stops everything here, so a
 * packet straggling in afterwards cannot revive a match that has already been
 * handed to the results screen.
 */

import type { OnlineSessionLike } from "@/net/online/session";
import { ConnectionWatchdog, type LinkHealth } from "@/net/online/watchdog";
import type { Transport } from "@/net/transport";

export const LINK_CHECK_MS = 250;

export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", cb: () => void): void;
  removeEventListener(type: "visibilitychange", cb: () => void): void;
}

export interface LinkMonitorOptions {
  readonly transport: Pick<Transport, "onMessage" | "onPeerLeave">;
  readonly session: Pick<OnlineSessionLike, "on" | "sendLobby">;
  readonly onHealth: (health: LinkHealth, peerAway: boolean) => void;
  readonly onLost: () => void;
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

  const dog = new ConnectionWatchdog(now());
  let lost = false;
  let stopped = false;
  let lastHealth: LinkHealth | null = null;
  let lastAway = false;

  const declareLost = () => {
    if (lost || stopped) return;
    lost = true;
    stop();
    options.onLost();
  };

  const report = () => {
    if (stopped) return;
    // While this tab is hidden its own timers and packets can stall, so any
    // silence measured then says nothing about the opponent. It is judged
    // again from the moment the tab is back (see `onVisibility`).
    if (visibility?.hidden) return;
    const health = dog.check(now());
    if (health === "lost") {
      declareLost();
      return;
    }
    if (health !== lastHealth || dog.peerAway !== lastAway) {
      lastHealth = health;
      lastAway = dog.peerAway;
      options.onHealth(health, dog.peerAway);
    }
  };

  const onVisibility = () => {
    if (!visibility) return;
    options.session.sendLobby({ kind: "away", away: visibility.hidden });
    // Back on screen: the opponent gets a fresh ten seconds from now, not
    // whatever was left of them when this tab went away.
    if (!visibility.hidden) dog.heard(now());
  };

  const offs = [
    options.transport.onMessage(() => dog.heard(now())),
    options.transport.onPeerLeave(() => declareLost()),
    options.session.on((event) => {
      if (event.type === "lobby" && event.message.kind === "away") {
        dog.setPeerAway(event.message.away, now());
        report();
      }
    }),
  ];
  visibility?.addEventListener("visibilitychange", onVisibility);
  const cancel = every(report, LINK_CHECK_MS);
  // A match that starts in a background tab never sees the change that would
  // say so, and the opponent would give up on it after ten seconds.
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
