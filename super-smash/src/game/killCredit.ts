/**
 * Who gets credit for a kill (moved out of the play page in Plan 5, Task 6 fix
 * round 1, to be tested).
 *
 * `StepEvents.kos` reports who died, not who did it — the simulation has no
 * reason to care, since a stock is a stock. The results screen does care, so
 * the attribution is done here, in the presentation layer, the way the real
 * game does it: whoever last landed a hit on you owns your death, and if nobody
 * has touched you recently, you walked off the stage yourself.
 */

import type { StepEvents } from "@/engine/types";

/**
 * Three seconds, because that is Ultimate's own rule — a KO only counts as a
 * self-destruct if no opponent has hit you within the last three minutes of
 * game time in their scoring, but for a single stock the practical window that
 * feels right is much shorter. Anything longer and a fighter who was hit once
 * at the start of the stock and then dived into the blast zone reads as a kill.
 */
export const KILL_CREDIT_FRAMES = 180;

export interface StatTracker {
  readonly kos: number[];
  readonly falls: number[];
  readonly sds: number[];
  readonly lastHitBy: number[];
  readonly lastHitFrame: number[];
}

export function createTracker(count: number): StatTracker {
  return {
    kos: new Array(count).fill(0),
    falls: new Array(count).fill(0),
    sds: new Array(count).fill(0),
    lastHitBy: new Array(count).fill(-1),
    lastHitFrame: new Array(count).fill(-99999),
  };
}

/**
 * Fold one frame's events into the tracker: who touched whom, then who fell. A
 * windbox's push touches as a hit does (Plan 5, Task 6 fix round 1): SmashWiki
 * "Windbox" (https://www.ssbwiki.com/Windbox), "if a player is hit with a
 * non-damaging windbox by an opponent, and then promptly SDs, it will count as
 * a KO for the opponent". So does a footstool (Plan 5, Task 11): SmashWiki
 * "Footstool Jump" (https://www.ssbwiki.com/Footstool_Jump), "if this results in
 * a Fall, it will count as a KO for the footstooling player".
 */
export function trackFrame(tracker: StatTracker, frame: number, events: Pick<StepEvents, "hits" | "pushes" | "footstools" | "kos">): void {
  const stoodOn = events.footstools.map((s) => ({ attacker: s.jumper, victim: s.victim }));
  for (const touch of [...events.hits, ...events.pushes, ...stoodOn]) {
    if (touch.attacker === touch.victim) continue;
    // A hit whose launch was outranked leaves the credit with the step's launch that
    // stands, the hit before it (Plan 6, Task 17 fix round 1), whichever port it was.
    if ("outranked" in touch && touch.outranked === true) continue;
    tracker.lastHitBy[touch.victim] = touch.attacker;
    tracker.lastHitFrame[touch.victim] = frame;
  }
  for (const ko of events.kos) {
    tracker.falls[ko.port] += 1;
    const killer = tracker.lastHitBy[ko.port];
    const recent = frame - tracker.lastHitFrame[ko.port] <= KILL_CREDIT_FRAMES;
    if (killer >= 0 && recent) tracker.kos[killer] += 1;
    else tracker.sds[ko.port] += 1;
    tracker.lastHitBy[ko.port] = -1;
  }
}
