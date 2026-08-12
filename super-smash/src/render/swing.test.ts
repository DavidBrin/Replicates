/**
 * The swoosh has to tell the truth.
 *
 * It is the graphic a player reads reach and direction off, so the one thing it
 * must never do is promise range the move does not have — a swing drawn past
 * its own hitbox teaches the player a distance that will whiff, over and over,
 * and they will blame the hit detection. Everything here exists to pin the arc
 * to the move's real numbers.
 */

import { describe, expect, it } from "vitest";
import { fx, toFloat } from "@/engine/fixed";
import type { FighterDef, Hitbox, MoveDef } from "@/engine/types";
import { actionFrameOf } from "@/engine/hitbox";
import { SWING_TAIL_FRAMES, swingArcFor } from "./swing";
import { FIGHTERS } from "@/fighters";
import { makeFighter } from "./testFixtures";

const HEIGHT = 13;

function hitbox(over: Partial<Hitbox> = {}): Hitbox {
  return {
    id: 0,
    startFrame: 6,
    endFrame: 8,
    x: fx(9),
    y: fx(7),
    radius: fx(3),
    damage: fx(12),
    angle: fx(45),
    baseKnockback: fx(30),
    knockbackGrowth: fx(100),
    ...over,
  };
}

function def(move: Partial<MoveDef> = {}): FighterDef {
  const full: MoveDef = {
    slot: "fsmash",
    name: "Test",
    totalFrames: 30,
    hitboxes: [hitbox()],
    ...move,
  };
  return { moves: { fsmash: full } } as unknown as FighterDef;
}

/**
 * The fixture hitbox is live on move frames 6..8, which — because frame data is
 * quoted from one and `actionFrame` counts from zero — is action frames 5..7.
 * Named rather than inlined, because every off-by-one in this file would
 * otherwise be invisible.
 */
const FIRST_LIVE = actionFrameOf(6);
const LAST_LIVE = actionFrameOf(8);

function attacker(over: Record<string, unknown> = {}) {
  return makeFighter({ action: "attack", move: "fsmash", actionFrame: FIRST_LIVE, x: 0, y: 0, ...over });
}

describe("when there is an arc at all", () => {
  it("draws nothing before the hitbox exists", () => {
    expect(swingArcFor(def(), attacker({ actionFrame: 0 }), HEIGHT)).toBeNull();
    expect(swingArcFor(def(), attacker({ actionFrame: FIRST_LIVE - 1 }), HEIGHT)).toBeNull();
  });

  it("draws through the active window and a short tail, then stops", () => {
    for (let frame = FIRST_LIVE; frame <= LAST_LIVE + SWING_TAIL_FRAMES; frame++) {
      expect(swingArcFor(def(), attacker({ actionFrame: frame }), HEIGHT), `frame ${frame}`).not.toBeNull();
    }
    expect(
      swingArcFor(def(), attacker({ actionFrame: LAST_LIVE + SWING_TAIL_FRAMES + 1 }), HEIGHT),
    ).toBeNull();
  });

  it("fades to nothing across the tail rather than cutting out", () => {
    const alphas: number[] = [];
    for (let frame = LAST_LIVE; frame <= LAST_LIVE + SWING_TAIL_FRAMES; frame++) {
      alphas.push(swingArcFor(def(), attacker({ actionFrame: frame }), HEIGHT)?.alpha ?? 0);
    }
    for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeLessThan(alphas[i - 1]);
    expect(alphas[alphas.length - 1]).toBeLessThan(0.2);
  });

  it("draws nothing for a grab, a projectile launcher, or a fighter who is not attacking", () => {
    const grab = def({ hitboxes: [hitbox({ grabbing: true })] });
    expect(swingArcFor(grab, attacker(), HEIGHT)).toBeNull();

    const launcher = def({ hitboxes: [] });
    expect(swingArcFor(launcher, attacker(), HEIGHT)).toBeNull();

    expect(swingArcFor(def(), attacker({ action: "stand", move: null }), HEIGHT)).toBeNull();
    expect(swingArcFor(null, attacker(), HEIGHT)).toBeNull();
  });

  /**
   * A multi-hit is several swings, not one long one. Drawing a single arc from
   * the first hitbox to the last would claim the blade was out for the whole
   * move, which for a spin attack is most of a second of untrue reach.
   */
  it("gives a multi-hit one arc per hit rather than one arc across all of them", () => {
    const multi = def({
      totalFrames: 60,
      hitboxes: [hitbox({ id: 0, startFrame: 6, endFrame: 8 }), hitbox({ id: 1, startFrame: 30, endFrame: 32 })],
    });
    // Between the two windows, past the first one's tail: nothing.
    expect(swingArcFor(multi, attacker({ actionFrame: 20 }), HEIGHT)).toBeNull();
    expect(swingArcFor(multi, attacker({ actionFrame: actionFrameOf(31) }), HEIGHT)).not.toBeNull();
  });
});

describe("where the arc points", () => {
  it("puts the tip in front of the fighter, and mirrors with facing", () => {
    const right = swingArcFor(def(), attacker({ facing: 1 }), HEIGHT);
    const left = swingArcFor(def(), attacker({ facing: -1 }), HEIGHT);
    expect(right).not.toBeNull();
    expect(left).not.toBeNull();
    expect((right as { tipX: number }).tipX).toBeGreaterThan(0);
    expect((left as { tipX: number }).tipX).toBeLessThan(0);
    expect((right as { tipX: number }).tipX).toBeCloseTo(-(left as { tipX: number }).tipX, 6);
  });

  it("aims an up-attack's arc above the shoulder", () => {
    const up = def({ hitboxes: [hitbox({ x: fx(0.5), y: fx(15) })] });
    const arc = swingArcFor(up, attacker(), HEIGHT);
    expect(arc).not.toBeNull();
    expect((arc as { tipY: number }).tipY).toBeGreaterThan(HEIGHT * 0.55);
  });

  it("aims a down-attack's arc below the shoulder", () => {
    const down = def({ hitboxes: [hitbox({ x: fx(6), y: fx(1) })] });
    const arc = swingArcFor(down, attacker(), HEIGHT);
    expect(arc).not.toBeNull();
    expect((arc as { tipY: number }).tipY).toBeLessThan(HEIGHT * 0.55);
  });

  it("keeps the band a band — never a bubble round the fighter", () => {
    const arc = swingArcFor(def({ hitboxes: [hitbox({ damage: fx(40) })] }), attacker(), HEIGHT);
    expect(arc).not.toBeNull();
    const { innerRadius, outerRadius } = arc as { innerRadius: number; outerRadius: number };
    expect(innerRadius).toBeGreaterThan(outerRadius * 0.5);
  });
});

/**
 * The honesty check, against the real roster rather than a fixture. Every
 * attack every fighter has, on every frame it is drawn, must reach no further
 * than the hitbox it was derived from.
 */
describe("the arc never promises reach the move does not have", () => {
  for (const fighter of FIGHTERS) {
    it(`${fighter.id} draws no arc past its own hitboxes`, () => {
      let checked = 0;
      for (const [slot, move] of Object.entries(fighter.moves)) {
        if (!move) continue;
        const live = move.hitboxes.filter((h) => !h.grabbing);
        if (live.length === 0) continue;

        // The furthest any hitbox of this move reaches from the fighter's
        // origin — the most the arc could honestly claim.
        const furthest = Math.max(
          ...live.map((h) => Math.hypot(toFloat(h.x), toFloat(h.y) - HEIGHT * 0.55) + toFloat(h.radius)),
        );

        for (let frame = 0; frame <= move.totalFrames; frame++) {
          const arc = swingArcFor(
            fighter,
            makeFighter({ action: "attack", move: slot as never, actionFrame: frame, x: 0, y: 0 }),
            HEIGHT,
          );
          if (!arc) continue;
          checked++;
          expect(arc.outerRadius, `${fighter.id}.${slot} frame ${frame}`).toBeLessThanOrEqual(
            furthest + 1e-6,
          );
          expect(arc.outerRadius).toBeGreaterThan(0);
        }
      }
      expect(checked, `${fighter.id} drew no arcs at all`).toBeGreaterThan(20);
    });
  }
});
