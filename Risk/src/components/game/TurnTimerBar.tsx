"use client";

/**
 * The turn timer (SPEC §7.1, D69) — **online only**.
 *
 * A 4 px bar under the phase label draining left→right, `--cyan` → `--danger`
 * with a 1 Hz pulse under 10 s. It is an invention: no ring exists anywhere
 * in the evidence. It reads the authority's `turn_deadline` straight off
 * POLL 3 and **never computes a deadline of its own** (F42).
 */
import { useEffect, useState } from "react";
import clsx from "clsx";

export interface TurnTimerBarProps {
  /** ISO 8601, straight from the authority. `null` offline. */
  readonly deadline: string | null;
  /** The configured turn length, so the bar knows what "full" is. */
  readonly totalSeconds: number | null;
  /** Injected in tests; otherwise the bar ticks on its own. */
  readonly now?: number;
}

export const PULSE_UNDER_SECONDS = 10;

/** The remaining fraction, clamped to [0, 1]. */
export function timerFraction(deadline: string, totalSeconds: number, now: number): number {
  const end = Date.parse(deadline);
  if (!Number.isFinite(end) || totalSeconds <= 0) return 0;
  const left = (end - now) / 1000;
  return Math.max(0, Math.min(1, left / totalSeconds));
}

export function secondsLeft(deadline: string, now: number): number {
  const end = Date.parse(deadline);
  return Number.isFinite(end) ? Math.max(0, (end - now) / 1000) : 0;
}

export function TurnTimerBar({ deadline, totalSeconds, now }: TurnTimerBarProps) {
  const [tick, setTick] = useState(() => now ?? Date.now());

  useEffect(() => {
    if (now !== undefined || !deadline) return;
    const id = setInterval(() => setTick(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline, now]);

  if (!deadline) return null;
  const at = now ?? tick;
  const total = totalSeconds ?? 90;
  const fraction = timerFraction(deadline, total, at);
  const left = secondsLeft(deadline, at);
  const urgent = left < PULSE_UNDER_SECONDS;

  return (
    <div
      data-testid="turn-timer"
      data-urgent={urgent ? "true" : "false"}
      role="timer"
      aria-label={`${Math.ceil(left)} seconds left in this turn`}
      className="w-[300px] overflow-hidden rounded-full"
      style={{ height: 4, background: "rgba(0,0,0,.45)" }}
    >
      <div
        data-testid="turn-timer-fill"
        className={clsx("h-full rounded-full", urgent && "motion-safe:animate-pulse")}
        style={{
          width: `${fraction * 100}%`,
          background: urgent ? "var(--danger)" : "var(--cyan)",
          transition: "width 250ms linear",
        }}
      />
    </div>
  );
}

export default TurnTimerBar;
