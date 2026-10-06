/**
 * §8's Motion list, pinned by name — these are recommendations, so the point
 * of the test is that one table holds them and a retune is one diff.
 */
import { describe, expect, it } from "vitest";

import {
  BLITZ_MAX_VISIBLE_ROUNDS,
  CAPTURE_FLASH_AT,
  createAnimState,
  DURATION,
  EASING,
  enqueue,
  KIND_DURATION,
  progress,
  pruneAnims,
  REDUCED_MOTION_DROPPED,
  REDUCED_MOTION_KEPT,
  reducedMotionDuration,
  troopTickDuration,
  type Anim,
  type AnimKind,
} from "./animations";

function anim(kind: AnimKind, start: number, duration: number): Anim {
  return { kind, start, duration };
}

describe("the Motion table", () => {
  it("carries every duration in §8's Motion list, by name", () => {
    expect({
      banner: DURATION.banner,
      bannerHold: DURATION.bannerHold,
      bannerOut: DURATION.bannerOut,
      phasePip: DURATION.phasePip,
      phaseLabel: DURATION.phaseLabel,
      cameraPan: DURATION.cameraPan,
      arrowDraw: DURATION.arrowDraw,
      arrowHeadPop: DURATION.arrowHeadPop,
      diceTumble: DURATION.diceTumble,
      diceStagger: DURATION.diceStagger,
      diceSettle: DURATION.diceSettle,
      blitzRound: DURATION.blitzRound,
      troopPulse: DURATION.troopPulse,
      captureWipe: DURATION.captureWipe,
      captureFlash: DURATION.captureFlash,
      damage: DURATION.damage,
      continentGlow: DURATION.continentGlow,
      fortifyLoop: DURATION.fortifyLoop,
      cardAward: DURATION.cardAward,
      cardToChip: DURATION.cardToChip,
      cardsSeizedStagger: DURATION.cardsSeizedStagger,
      cardsSeizedEach: DURATION.cardsSeizedEach,
      elimination: DURATION.elimination,
      balloonIn: DURATION.balloonIn,
      balloonHold: DURATION.balloonHold,
      balloonOut: DURATION.balloonOut,
      victoryStars: DURATION.victoryStars,
      victoryStarStagger: DURATION.victoryStarStagger,
      oceanDrift: DURATION.oceanDrift,
    }).toEqual({
      banner: 320, bannerHold: 1200, bannerOut: 240, phasePip: 220, phaseLabel: 160,
      cameraPan: 420, arrowDraw: 260, arrowHeadPop: 120,
      diceTumble: 900, diceStagger: 60, diceSettle: 140, blitzRound: 90, troopPulse: 180,
      captureWipe: 380, captureFlash: 180, damage: 700, continentGlow: 500, fortifyLoop: 900,
      cardAward: 520, cardToChip: 300, cardsSeizedStagger: 80, cardsSeizedEach: 420,
      elimination: 400, balloonIn: 240, balloonHold: 3500, balloonOut: 200,
      victoryStars: 900, victoryStarStagger: 25, oceanDrift: 20000,
    });
    // The two §8 numbers that are a count and a fraction, not a clock.
    expect(BLITZ_MAX_VISIBLE_ROUNDS).toBe(12);
    expect(CAPTURE_FLASH_AT).toBe(0.35);
  });

  it("carries §8's two named easings", () => {
    expect(EASING.banner).toBe("cubic-bezier(.16,1,.3,1)");
    expect(EASING.camera).toBe("cubic-bezier(.22,.61,.36,1)");
  });

  it("computes the troop tick as min(600, 80·Δ)", () => {
    expect(troopTickDuration(0)).toBe(0);
    expect(troopTickDuration(1)).toBe(80);
    expect(troopTickDuration(7)).toBe(560);
    expect(troopTickDuration(8)).toBe(600);
    expect(troopTickDuration(40)).toBe(600);
    expect(troopTickDuration(-5)).toBe(400);
    expect(DURATION.troopPulse).toBe(180);
  });

  it("agrees with itself: each kind's nominal duration is the table's", () => {
    expect(KIND_DURATION.captureWipe).toBe(DURATION.captureWipe);
    expect(KIND_DURATION.diceTumble).toBe(DURATION.diceTumble);
    expect(KIND_DURATION.banner).toBe(DURATION.banner);
    expect(KIND_DURATION.balloon).toBe(DURATION.balloonIn);
  });
});

describe("progress", () => {
  it("clamps to [0,1] either side of the window", () => {
    const a = anim("banner", 1000, 320);
    expect(progress(a, 900)).toBe(0);
    expect(progress(a, 1000)).toBe(0);
    expect(progress(a, 1160)).toBeCloseTo(0.5, 10);
    expect(progress(a, 1320)).toBe(1);
    expect(progress(a, 99999)).toBe(1);
  });

  it("reports a zero-length animation as already done", () => {
    expect(progress(anim("captureWipe", 500, 0), 0)).toBe(1);
    expect(progress(anim("captureWipe", 500, 0), 500)).toBe(1);
  });
});

describe("the queue", () => {
  it("drops finished items and reports what is still in flight", () => {
    const state = createAnimState(false);
    enqueue(state, anim("captureWipe", 0, 380));
    enqueue(state, anim("damage", 0, 700));
    enqueue(state, anim("banner", 500, 320));
    expect(state.items).toHaveLength(3);

    expect(pruneAnims(state, 400)).toBe(true);
    expect(state.items.map((a) => a.kind)).toEqual(["damage", "banner"]);

    expect(pruneAnims(state, 700)).toBe(true);
    expect(state.items.map((a) => a.kind)).toEqual(["banner"]);

    expect(pruneAnims(state, 820)).toBe(false);
    expect(state.items).toEqual([]);
  });

  it("keeps an item that has not started yet", () => {
    const state = createAnimState(false);
    enqueue(state, anim("balloon", 5000, 240));
    expect(pruneAnims(state, 0)).toBe(true);
  });

  it("lands every enqueue already finished in skip mode", () => {
    const state = createAnimState(true);
    enqueue(state, anim("diceTumble", 1000, 900));
    enqueue(state, anim("captureWipe", 1000, 380));
    expect(state.items.map((a) => a.duration)).toEqual([0, 0]);
    for (const item of state.items) expect(progress(item, item.start)).toBe(1);
    expect(pruneAnims(state, 1000)).toBe(false);
    expect(state.items).toEqual([]);
  });

  it("carries the payload a floater needs through the queue", () => {
    const state = createAnimState(false);
    enqueue(state, { kind: "damage", at: [120, 40], text: "−4", colour: "#FF4D5F", start: 0, duration: 700 });
    expect(state.items[0]?.at).toEqual([120, 40]);
    expect(state.items[0]?.text).toBe("−4");
  });
});

describe("prefers-reduced-motion", () => {
  it("drops the dice tumble and the victory burst", () => {
    expect(REDUCED_MOTION_DROPPED).toEqual(["diceTumble", "victoryStars"]);
    expect(reducedMotionDuration("diceTumble")).toBe(0);
    expect(reducedMotionDuration("victoryStars")).toBe(0);
  });

  it("keeps the capture wipe and the troop tick as instant state changes", () => {
    // Kept, not dropped: the end state still lands, it just lands at once.
    expect(REDUCED_MOTION_KEPT).toContain("captureWipe");
    expect(REDUCED_MOTION_KEPT).toContain("troopTick");
    expect(REDUCED_MOTION_DROPPED).not.toContain("captureWipe");
    expect(reducedMotionDuration("captureWipe")).toBe(0);
    expect(reducedMotionDuration("troopTick")).toBe(0);
    // …and the full-motion table is untouched, so turning the setting off restores it.
    expect(KIND_DURATION.captureWipe).toBe(380);
  });

  it("gives every other kind the blanket zero too", () => {
    const kinds: readonly AnimKind[] = Object.keys(KIND_DURATION) as AnimKind[];
    for (const kind of kinds) expect(reducedMotionDuration(kind)).toBe(0);
  });
});
