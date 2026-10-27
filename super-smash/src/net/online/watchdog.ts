/**
 * When to stop waiting for the other player.
 *
 * A rollback session sends a packet every frame, stalled or not, so silence is
 * a real signal: a second of it is worth telling the player about, ten
 * seconds means the peer is gone. One case breaks that rule. A browser stops
 * `requestAnimationFrame` in a background tab, so an opponent who switches
 * tabs goes silent while still connected — and says so first, with a lobby
 * `away` message. They get a minute.
 *
 * Times are monotonic milliseconds supplied by the caller (e.g.
 * `performance.now()`), never `Date.now()`. This is outside the simulation
 * (SPEC §3): nothing here feeds `step()`.
 */

export const SILENCE_WAITING_MS = 1_000;
export const SILENCE_LOST_MS = 10_000;
export const AWAY_LOST_MS = 60_000;

export type LinkHealth = "ok" | "waiting" | "lost";

export class ConnectionWatchdog {
  private lastHeard: number;
  private away = false;

  constructor(now: number) {
    this.lastHeard = now;
  }

  get peerAway(): boolean {
    return this.away;
  }

  heard(now: number): void {
    this.lastHeard = now;
  }

  /** Hearing "I am away" is hearing from them, so it also resets the clock. */
  setPeerAway(away: boolean, now: number): void {
    this.away = away;
    this.lastHeard = now;
  }

  /**
   * Reports how long the peer has been quiet. It does not latch: a "lost" is
   * only a reading, and a later `heard()` makes it "ok" again. Acting on the
   * first "lost" (and ignoring any packet after it) belongs to the caller.
   */
  check(now: number): LinkHealth {
    const silent = now - this.lastHeard;
    if (silent >= (this.away ? AWAY_LOST_MS : SILENCE_LOST_MS)) return "lost";
    return this.away || silent >= SILENCE_WAITING_MS ? "waiting" : "ok";
  }
}
