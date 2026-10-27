import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import type { LinkHealth } from "@/net/online/watchdog";
import type { NetStats } from "@/net/rollback";

/**
 * How long the match may stand still before the HUD says why. A stall of a
 * few frames is ordinary rollback waiting on a late packet; one this long is
 * an opponent the player should be told about.
 */
export const STALL_HINT_MS = 1_000;

export interface NetHudProps {
  readonly stats: Pick<NetStats, "rttMs" | "inputDelay" | "rollbacks"> | null;
  readonly health: LinkHealth;
  readonly peerAway: boolean;
  /** The match is held at the prediction cap, waiting on the opponent's input. */
  readonly stalled: boolean;
}

/**
 * The three numbers that say how an online match is going, in a corner.
 *
 * Ping is the measured round trip; delay is the frames of input lag the
 * session chose from it (2–8, auto-tuned); rollbacks count the corrections
 * prediction needed. Below them, a line only when the opponent has gone quiet,
 * or when their packets still arrive but the match has stood still for over
 * `STALL_HINT_MS` — link health reflects silence alone, and says nothing then.
 *
 * That line is a status region that is always there and only changes its
 * words: a screen reader announces a change to a live region it already
 * knows, not one that arrives with its text in it. The numbers stay out of
 * it — they change four times a second and are for looking at.
 */
export function NetHud({ stats, health, peerAway, stalled }: NetHudProps) {
  const [stallOutlasted, setStallOutlasted] = useState(false);
  useEffect(() => {
    if (!stalled) return;
    const timer = setTimeout(() => setStallOutlasted(true), STALL_HINT_MS);
    return () => {
      clearTimeout(timer);
      setStallOutlasted(false);
    };
  }, [stalled]);
  const longStall = stalled && stallOutlasted;

  const message =
    health !== "ok" ? (peerAway ? "Opponent switched tabs…" : "Waiting for opponent…") : longStall ? "Waiting for opponent…" : "";
  return (
    <div
      role="group"
      aria-label="Connection"
      className="pointer-events-none absolute top-3 right-3 flex flex-col items-end gap-1 font-menu text-xs font-bold text-white/85"
    >
      {stats ? (
        <p className="rounded bg-black/55 px-2 py-1 tabular-nums">
          {`PING ${Math.round(stats.rttMs)} ms · DELAY ${stats.inputDelay}f · ROLLBACKS ${stats.rollbacks}`}
        </p>
      ) : null}
      <p role="status" className={cn(message && "rounded bg-smash-red px-2 py-1 text-white")}>
        {message}
      </p>
    </div>
  );
}
