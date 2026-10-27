import { cn } from "@/lib/cn";
import type { LinkHealth } from "@/net/online/watchdog";
import type { NetStats } from "@/net/rollback";

export interface NetHudProps {
  readonly stats: Pick<NetStats, "rttMs" | "inputDelay" | "rollbacks"> | null;
  readonly health: LinkHealth;
  readonly peerAway: boolean;
}

/**
 * The three numbers that say how an online match is going, in a corner.
 *
 * Ping is the measured round trip; delay is the frames of input lag the
 * session chose from it (1–8, auto-tuned); rollbacks count the corrections
 * prediction needed. Below them, a line only when the opponent has gone quiet.
 *
 * That line is a status region that is always there and only changes its
 * words: a screen reader announces a change to a live region it already
 * knows, not one that arrives with its text in it. The numbers stay out of
 * it — they change four times a second and are for looking at.
 */
export function NetHud({ stats, health, peerAway }: NetHudProps) {
  const message = health === "ok" ? "" : peerAway ? "Opponent switched tabs…" : "Waiting for opponent…";
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
