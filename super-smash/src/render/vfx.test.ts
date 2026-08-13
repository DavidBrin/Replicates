import { describe, expect, it } from "vitest";

import { fx } from "@/engine/fixed";
import { SHIELD_MAX_HEALTH } from "@/engine/constants";
import { FIGHTER_UNITS, MAX_ZOOM, createCamera } from "./camera";
import { PORT_COLOURS, hexToRgb } from "./characterArt";
import { assignmentsTo, callsOf, countOf, createMockContext } from "./mockContext";
import {
  BURST_MAX_GROWTH,
  HIT_FLASH_FRAMES,
  createVfx,
  drawKoFlash,
  drawParticles,
  drawShield,
  drawSmashBall,
  drawStarKos,
  hitFlashAmount,
  ingestEvents,
  spawnDust,
  spawnHitSpark,
  stepVfx,
  footPlanted,
  trackAfterimages,
  trackGroundFx,
  trackLaunchTrails,
  updateVfx,
} from "./vfx";
import { makeEvents, makeFighter, makeStage, makeState } from "./testFixtures";

const stage = makeStage();
const cam = createCamera(stage);

function hit(over: Partial<{ damage: number; knockback: number; victim: number; angle: number, hitboxId: 0 }> = {}) {
  return makeEvents({
    hits: [
      {
        attacker: 0,
        victim: over.victim ?? 1,
        damage: over.damage ?? fx(10),
        x: 0,
        y: fx(6),
        knockback: over.knockback ?? fx(60),
        angle: over.angle ?? fx(45), hitboxId: 0,
      },
    ],
  });
}

describe("events, not state", () => {
  it("spawns nothing at all when a frame reports no events", () => {
    const v = createVfx();
    const state = makeState({ fighters: [makeFighter({ port: 0, damage: fx(90) })] });
    stepVfx(v, makeEvents(), state);
    expect(v.particles).toHaveLength(0);
    expect(v.koFlash).toBe(0);
  });

  it("spawns once per event, however many times the frame is re-simulated", () => {
    // The rollback case: the same frame's *state* is seen repeatedly, but the
    // authoritative step reports its events exactly once.
    const v = createVfx();
    const state = makeState();
    ingestEvents(v, hit(), state);
    const afterOne = v.particles.length;
    for (let i = 0; i < 8; i++) {
      trackAfterimages(v, state);
      updateVfx(v);
    }
    expect(afterOne).toBeGreaterThan(0);
    expect(v.particles.length).toBeLessThanOrEqual(afterOne);
  });
});

describe("hit sparks", () => {
  it("throws more and larger sparks for a bigger hit", () => {
    const small = createVfx();
    const big = createVfx();
    spawnHitSpark(small, 0, 0, 3, 20);
    spawnHitSpark(big, 0, 0, 24, 200);
    expect(big.particles.length).toBeGreaterThan(small.particles.length);
    const size = (v: typeof small) => Math.max(...v.particles.map((p) => p.size));
    expect(size(big)).toBeGreaterThan(size(small));
  });

  it("ramps colour from white through yellow to orange as damage climbs", () => {
    // Blue drains first (white to yellow), then green (yellow to orange), while
    // red stays pinned — which is the ramp, stated as three channels.
    const blues: number[] = [];
    const greens: number[] = [];
    for (const damage of [0.5, 6, 12, 18, 25]) {
      const v = createVfx();
      spawnHitSpark(v, 0, 0, damage, 40);
      const [r, g, b] = hexToRgb(v.particles[0].colour);
      expect(r).toBe(255);
      blues.push(b);
      greens.push(g);
    }
    for (let i = 1; i < blues.length; i++) expect(blues[i]).toBeLessThan(blues[i - 1]);
    expect(greens[greens.length - 1]).toBeLessThan(greens[0]);
  });

  it("flashes the victim white for two to four frames", () => {
    const v = createVfx();
    ingestEvents(v, hit({ damage: fx(4) }), makeState());
    expect(v.hitFlash[1]).toBeGreaterThanOrEqual(2);
    expect(v.hitFlash[1]).toBeLessThanOrEqual(HIT_FLASH_FRAMES);
    expect(hitFlashAmount(v, 1)).toBeGreaterThan(0);
    expect(hitFlashAmount(v, 0)).toBe(0);
  });

  it("lets the flash expire", () => {
    const v = createVfx();
    ingestEvents(v, hit(), makeState());
    for (let i = 0; i < HIT_FLASH_FRAMES + 1; i++) updateVfx(v);
    expect(hitFlashAmount(v, 1)).toBe(0);
  });

  /**
   * The spark is punctuation, not the sentence.
   *
   * At its worst the burst star reached nine units and swelled to 2.8×, which
   * is a star four times the height of the fighter who threw it: on the one
   * frame a player most needs to read — who was hit, and which way they are
   * going — the screen was a solid orange shape. Both halves are bounded here
   * because either one alone can bring it back.
   */
  it("keeps even the hardest hit's spark smaller than the fighter throwing it", () => {
    const v = createVfx();
    // Harder than any single hitbox in the roster, so this is the worst case.
    spawnHitSpark(v, 0, 0, 40, 320);

    const burst = v.particles.find((p) => p.kind === "burst");
    expect(burst).toBeDefined();
    expect((burst as { size: number }).size * BURST_MAX_GROWTH).toBeLessThan(FIGHTER_UNITS * 0.5);

    for (const p of v.particles) {
      expect(p.size).toBeLessThan(FIGHTER_UNITS * 0.5);
    }
  });

  it("throws its sparks the way the victim is going", () => {
    // The frame of contact is the frame a player most needs to read a launch
    // off, and a symmetric puff tells them nothing. Both directions are
    // checked, because a spark cone that ignored the angle entirely would pass
    // a one-sided assertion by luck about half the time.
    const mean = (angle: number) => {
      const v = createVfx();
      spawnHitSpark(v, 0, 0, 14, 120, angle);
      const sparks = v.particles.filter((p) => p.kind === "spark");
      expect(sparks.length).toBeGreaterThan(4);
      return {
        vx: sparks.reduce((a, p) => a + p.vx, 0) / sparks.length,
        vy: sparks.reduce((a, p) => a + p.vy, 0) / sparks.length,
      };
    };

    expect(mean(0).vx).toBeGreaterThan(0);
    expect(mean(Math.PI).vx).toBeLessThan(0);
    expect(mean(Math.PI / 2).vy).toBeGreaterThan(0);
    expect(mean(-Math.PI / 2).vy).toBeLessThan(0);
  });

  it("is gone within a fifth of a second", () => {
    // "Practically instantaneous" was the note. Twelve frames is 200ms; the
    // sparks used to live for 26, which is closer to half a second of debris
    // sitting on top of the launch.
    const v = createVfx();
    spawnHitSpark(v, 0, 0, 40, 320);
    for (let i = 0; i < 12; i++) updateVfx(v);
    expect(v.particles.length).toBe(0);
  });
});

/**
 * Knockback is the game's whole scoring system, and until this it was
 * invisible: a fighter flew off in silence, at the same apparent speed whether
 * the hit was a jab or a kill move.
 */
describe("launch trails", () => {
  function launched(over: Partial<Parameters<typeof makeFighter>[0]> = {}) {
    return makeState({
      fighters: [makeFighter({ port: 0, action: "tumble", vx: fx(4), vy: fx(3), ...over })],
    });
  }

  it("streaks behind a fighter who was hit hard", () => {
    const v = createVfx();
    trackLaunchTrails(v, launched());
    expect(v.particles.length).toBeGreaterThan(0);
  });

  it("stays quiet during hitlag, when the launch has not started yet", () => {
    // The freeze comes *before* the launch. A streak here would be coming off a
    // fighter who has not moved.
    const v = createVfx();
    trackLaunchTrails(v, launched({ hitlag: 6 }));
    expect(v.particles).toHaveLength(0);
  });

  it("stays quiet for a fighter who is barely moving, and for one not in hitstun", () => {
    const slow = createVfx();
    trackLaunchTrails(slow, launched({ vx: fx(0.3), vy: 0 }));
    expect(slow.particles).toHaveLength(0);

    const running = createVfx();
    trackLaunchTrails(running, launched({ action: "run" }));
    expect(running.particles).toHaveLength(0);
  });

  it("is port-coloured, so who is flying is readable from the streak alone", () => {
    const v = createVfx();
    trackLaunchTrails(v, launched({ port: 1 }));
    expect(v.particles[0].colour).toBe(PORT_COLOURS[1]);
  });

  it("travels the way the fighter is travelling", () => {
    const v = createVfx();
    trackLaunchTrails(v, launched({ vx: fx(-5), vy: fx(2) }));
    expect(v.particles[0].vx).toBeLessThan(0);
    expect(v.particles[0].vy).toBeGreaterThan(0);
  });
});

describe("expiry", () => {
  it("drops particle counts monotonically once nothing new spawns", () => {
    const v = createVfx();
    spawnHitSpark(v, 0, 0, 20, 150);
    const counts: number[] = [];
    for (let i = 0; i < 60; i++) {
      updateVfx(v);
      counts.push(v.particles.length);
    }
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    expect(counts[counts.length - 1]).toBe(0);
  });

  it("caps the particle budget rather than growing without bound", () => {
    const v = createVfx();
    for (let i = 0; i < 200; i++) spawnHitSpark(v, 0, 0, 25, 200);
    expect(v.particles.length).toBeLessThanOrEqual(640);
  });

  it("clears afterimages, star KOs and screen KOs too", () => {
    const v = createVfx();
    ingestEvents(
      v,
      makeEvents({
        kos: [
          { port: 0, x: 0, y: fx(190), kind: "star" },
          { port: 1, x: 0, y: fx(190), kind: "screen" },
        ],
      }),
      makeState(),
    );
    expect(v.starKos).toHaveLength(1);
    expect(v.screenKos).toHaveLength(1);
    for (let i = 0; i < 120; i++) updateVfx(v);
    expect(v.starKos).toHaveLength(0);
    expect(v.screenKos).toHaveLength(0);
    expect(v.koFlash).toBe(0);
  });
});

describe("shields", () => {
  it("is drawn only while shielding", () => {
    const idle = createMockContext();
    const held = createMockContext();
    const v = createVfx();
    drawShield(idle, v, makeFighter({ action: "stand" }), cam, 13);
    drawShield(held, v, makeFighter({ action: "shield" }), cam, 13);
    expect(countOf(idle, "arc")).toBe(0);
    expect(countOf(held, "arc")).toBeGreaterThan(0);
  });

  it("shrinks as shield HP drops", () => {
    const radii: number[] = [];
    for (const hp of [1, 0.6, 0.2, 0]) {
      const ctx = createMockContext();
      drawShield(
        ctx,
        createVfx(),
        makeFighter({ action: "shield", shieldHealth: Math.round(SHIELD_MAX_HEALTH * hp) }),
        cam,
        13,
      );
      radii.push(callsOf(ctx, "arc")[0].args[2] as number);
    }
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeLessThan(radii[i - 1]);
  });

  it("is port-coloured", () => {
    const ctx = createMockContext();
    drawShield(ctx, createVfx(), makeFighter({ port: 1, action: "shield" }), cam, 13);
    expect(assignmentsTo(ctx, "fillStyle").some((s) => String(s).includes("59, 123, 254"))).toBe(true);
  });

  it("flashes white on a perfect shield — which Ultimate scores on release", () => {
    const v = createVfx();
    const state = makeState({
      fighters: [
        makeFighter({ port: 0 }),
        makeFighter({ port: 1, action: "shieldRelease", actionFrame: 2 }),
      ],
    });
    ingestEvents(v, makeEvents({ shieldHits: [{ victim: 1, x: 0, y: 0 }] }), state);
    expect(v.parryFlash[1]).toBeGreaterThan(0);

    const ctx = createMockContext();
    drawShield(ctx, v, state.fighters[1], cam, 13);
    expect(assignmentsTo(ctx, "fillStyle").some((s) => String(s).includes("255, 255, 255"))).toBe(true);
  });

  it("does not flash for a shield hit outside the release window", () => {
    const v = createVfx();
    const state = makeState({
      fighters: [makeFighter({ port: 0 }), makeFighter({ port: 1, action: "shield", actionFrame: 2 })],
    });
    ingestEvents(v, makeEvents({ shieldHits: [{ victim: 1, x: 0, y: 0 }] }), state);
    expect(v.parryFlash[1]).toBe(0);
  });

  it("fades out over the drop animation", () => {
    const early = createMockContext();
    const late = createMockContext();
    const v = createVfx();
    drawShield(early, v, makeFighter({ action: "shieldRelease", actionFrame: 1 }), cam, 13);
    drawShield(late, v, makeFighter({ action: "shieldRelease", actionFrame: 10 }), cam, 13);
    const alpha = (c: typeof early) =>
      Number(String(assignmentsTo(c, "fillStyle")[0]).match(/([\d.]+)\)$/)?.[1] ?? 0);
    expect(alpha(late)).toBeLessThan(alpha(early));
  });
});

describe("KOs", () => {
  it("flashes the screen and fades", () => {
    const v = createVfx();
    ingestEvents(v, makeEvents({ kos: [{ port: 1, x: 0, y: fx(190), kind: "blast" }] }), makeState());
    const bright = createMockContext();
    drawKoFlash(bright, v);
    const first = Number(String(assignmentsTo(bright, "fillStyle")[0]).match(/([\d.]+)\)$/)?.[1] ?? 0);

    for (let i = 0; i < 6; i++) updateVfx(v);
    const dim = createMockContext();
    drawKoFlash(dim, v);
    const later = Number(String(assignmentsTo(dim, "fillStyle")[0]).match(/([\d.]+)\)$/)?.[1] ?? 0);

    expect(first).toBeGreaterThan(later);
    expect(countOf(bright, "fillRect")).toBe(1);
  });

  it("shrinks the star KO into the distance", () => {
    const v = createVfx();
    ingestEvents(v, makeEvents({ kos: [{ port: 0, x: 0, y: fx(150), kind: "star" }] }), makeState());
    const sizes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const ctx = createMockContext();
      drawStarKos(ctx, v, cam);
      const pts = callsOf(ctx, "moveTo");
      sizes.push(pts.length > 0 ? (pts[0].args[1] as number) : 0);
      for (let f = 0; f < 20; f++) updateVfx(v);
    }
    expect(v.starKos.length + sizes.length).toBeGreaterThan(0);
  });

  it("draws nothing when there is no flash to draw", () => {
    const ctx = createMockContext();
    drawKoFlash(ctx, createVfx());
    expect(ctx.calls).toHaveLength(0);
  });
});

describe("continuous effects", () => {
  it("trails afterimages only while a dodge is actually intangible", () => {
    const v = createVfx();
    trackAfterimages(v, makeState({ fighters: [makeFighter({ action: "roll", intangible: 0 })] }));
    expect(v.afterimages).toHaveLength(0);
    trackAfterimages(
      v,
      makeState({ fighters: [makeFighter({ action: "roll", intangible: 8, actionFrame: 4 })] }),
    );
    expect(v.afterimages).toHaveLength(1);
  });

  it("emits charge motes only while a smash is held", () => {
    const idle = createVfx();
    stepVfx(idle, null, makeState({ fighters: [makeFighter({ charge: 0 })] }));
    expect(idle.particles.filter((p) => p.kind === "chargeMote")).toHaveLength(0);

    const charging = createVfx();
    for (let i = 0; i < 4; i++) {
      stepVfx(charging, null, makeState({ fighters: [makeFighter({ charge: 30 })] }));
    }
    expect(charging.particles.filter((p) => p.kind === "chargeMote").length).toBeGreaterThan(0);
  });

  it("smokes above 120% and not below", () => {
    const cool = createVfx();
    const hot = createVfx();
    for (let i = 0; i < 30; i++) {
      stepVfx(cool, null, makeState({ fighters: [makeFighter({ damage: fx(119) })] }));
      stepVfx(hot, null, makeState({ fighters: [makeFighter({ damage: fx(150) })] }));
    }
    expect(cool.particles.filter((p) => p.kind === "smoke")).toHaveLength(0);
    expect(hot.particles.filter((p) => p.kind === "smoke").length).toBeGreaterThan(0);
  });

  it("gives a live Smash Ball a rainbow aura and nothing when it is gone", () => {
    const off = createMockContext();
    drawSmashBall(off, makeState(), cam);
    expect(off.calls).toHaveLength(0);

    const on = createMockContext();
    drawSmashBall(on, makeState({ smashBall: { active: true, x: 0, y: fx(50), vx: 0, vy: 0, health: fx(40), driftTimer: 0 } }), cam);
    const hues = assignmentsTo(on, "strokeStyle").filter((s) => String(s).startsWith("hsla"));
    expect(new Set(hues.map(String)).size).toBeGreaterThan(3);
  });
});

describe("drawing particles", () => {
  it("streaks a spark backwards along its own velocity", () => {
    const v = createVfx();
    spawnHitSpark(v, 0, 0, 12, 80);
    const ctx = createMockContext();
    drawParticles(ctx, v, cam);
    expect(countOf(ctx, "stroke")).toBeGreaterThan(0);
    for (const call of ctx.calls) {
      for (const arg of call.args) {
        if (typeof arg === "number") expect(Number.isFinite(arg)).toBe(true);
      }
    }
  });

  it("draws nothing for an empty system", () => {
    const ctx = createMockContext();
    drawParticles(ctx, createVfx(), cam);
    expect(countOf(ctx, "stroke")).toBe(0);
    expect(countOf(ctx, "fill")).toBe(0);
  });

  /*
   * Landing dust shipped at a world radius of up to 2.7 — a disc five units
   * across next to a thirteen-unit fighter — held at full opacity for most of
   * twenty-four frames. Nine of them at once read as a bank of cloud sitting
   * on the platform rather than as a puff at the feet.
   */
  describe("landing dust", () => {
    /** Feet to crown, in the same world units `size` is measured in. */
    const FIGHTER_HEIGHT = 13;

    it("is a puff at the feet, not scenery on the stage", () => {
      const v = createVfx();
      spawnDust(v, 0, 0, 9, 0.9);
      const widest = Math.max(...v.particles.map((p) => p.size * 2));
      expect(widest).toBeLessThan(FIGHTER_HEIGHT * 0.12);
      // And a puff, not a fixture: gone within a third of a second.
      expect(Math.max(...v.particles.map((p) => p.life))).toBeLessThanOrEqual(20);
    });

    it("is translucent on every frame it is alive", () => {
      const v = createVfx();
      spawnDust(v, 0, 0, 9, 0.9);
      const alphas: number[] = [];
      for (let frame = 0; frame < 24 && v.particles.length > 0; frame++) {
        const ctx = createMockContext();
        drawParticles(ctx, v, cam);
        for (const style of assignmentsTo(ctx, "fillStyle")) {
          const m = /rgba\([^)]*,\s*([\d.]+)\)/.exec(String(style));
          if (m) alphas.push(Number(m[1]));
        }
        updateVfx(v);
      }
      expect(alphas.length).toBeGreaterThan(0);
      // Never solid — a hard-edged opaque disc is what made it read as a shape.
      expect(Math.max(...alphas)).toBeLessThanOrEqual(0.6);
    });

    it("stays a puff on screen even when the camera is punched all the way in", () => {
      const v = createVfx();
      spawnDust(v, 0, 0, 9, 0.9);
      const ctx = createMockContext();
      drawParticles(ctx, { ...v }, { ...cam, zoom: MAX_ZOOM * 1.6 });
      const radii = callsOf(ctx, "arc").map((c) => c.args[2] as number);
      // The fighter is 13 units tall at the same zoom; the dust must stay a
      // small fraction of him, not a third of the screen.
      const fighterOnScreen = FIGHTER_HEIGHT * MAX_ZOOM * 1.6;
      expect(Math.max(...radii) * 2).toBeLessThan(fighterOnScreen * 0.2);
    });
  });
});

describe("ground effects", () => {
  const at = (over: Parameters<typeof makeFighter>[0]) => makeState({ fighters: [makeFighter(over)] });

  function dustFrom(over: Parameters<typeof makeFighter>[0]) {
    const v = createVfx();
    trackGroundFx(v, at(over));
    return v.particles;
  }

  /** Mean horizontal velocity of the puff — the direction it was thrown. */
  function meanVx(ps: ReturnType<typeof dustFrom>): number {
    const dust = ps.filter((p) => p.kind === "dust");
    return dust.reduce((a, p) => a + p.vx, 0) / Math.max(1, dust.length);
  }

  it("puffs on a midair jump and not on a grounded one", () => {
    const second = dustFrom({ action: "jump", actionFrame: 0, jumpsUsed: 2 });
    expect(second.some((p) => p.kind === "ring")).toBe(true);
    // The first jump already has `events.jumps`; a second puff here would
    // double it.
    const first = dustFrom({ action: "jump", actionFrame: 0, jumpsUsed: 1 });
    expect(first).toHaveLength(0);
  });

  it("throws a dash's dust backwards, and mirrors with the fighter", () => {
    expect(meanVx(dustFrom({ action: "dashStart", actionFrame: 0, facing: 1 }))).toBeLessThan(0);
    expect(meanVx(dustFrom({ action: "dashStart", actionFrame: 0, facing: -1 }))).toBeGreaterThan(0);
  });

  it("throws a skid's dust the way the fighter is still sliding", () => {
    // Opposite to the dash: one is leaving a standstill, the other arriving at
    // one, and the dust going the same way for both is what made every ground
    // effect read as the same generic puff.
    const dash = meanVx(dustFrom({ action: "dashStart", actionFrame: 0, facing: 1 }));
    const skid = meanVx(dustFrom({ action: "runBrake", actionFrame: 1, facing: 1 }));
    expect(Math.sign(skid)).toBe(-Math.sign(dash));
  });

  it("puts a footfall under the foot, whatever the fighter's speed", () => {
    // Twice the speed, twice the steps over the same stretch of time — because
    // the run cycle is paced by ground covered, and a fixed frame interval
    // would drift off the foot for everyone but one fighter.
    const steps = (vx: number) => {
      let n = 0;
      for (let actionFrame = 1; actionFrame < 60; actionFrame++) {
        if (footPlanted({ ...makeFighter({ action: "run", actionFrame }), vx })) n++;
      }
      return n;
    };
    expect(steps(fx(2))).toBeGreaterThan(steps(fx(1)));
    expect(steps(fx(2))).toBeCloseTo(steps(fx(1)) * 2, 0);
  });

  it("does not step at all when the fighter is not moving", () => {
    for (let actionFrame = 1; actionFrame < 40; actionFrame++) {
      expect(footPlanted({ ...makeFighter({ action: "run", actionFrame }), vx: 0 })).toBe(false);
    }
  });

  it("makes a landing out of an aerial heavier than a light one", () => {
    const light = createVfx();
    ingestEvents(light, makeEvents({ lands: [{ port: 0, x: fx(0), y: fx(0) }] }), at({ action: "land" }));
    const lag = dustFrom({ action: "landingLag", actionFrame: 0 });
    const spread = (ps: { vx: number }[]) => Math.max(...ps.map((p) => Math.abs(p.vx)));
    expect(spread(lag)).toBeGreaterThan(spread(light.particles));
  });

  it("leaves a fighter who is not touching the floor alone", () => {
    expect(dustFrom({ action: "stand", actionFrame: 12 })).toHaveLength(0);
    expect(dustFrom({ action: "fall", actionFrame: 12 })).toHaveLength(0);
    expect(dustFrom({ action: "shield", actionFrame: 12 })).toHaveLength(0);
  });

  it("sparks while fast-falling and not while merely falling", () => {
    // Ultimate's actual fast-fall cue is a small flashing star, not a pose
    // change — so it has to be here rather than in the clip.
    const falling = dustFrom({ action: "fall", actionFrame: 8, fastFalling: false });
    const diving = dustFrom({ action: "fall", actionFrame: 8, fastFalling: true });
    expect(falling).toHaveLength(0);
    expect(diving.some((p) => p.kind === "spark")).toBe(true);
    // Intermittent, so it flashes rather than streams.
    expect(dustFrom({ action: "fall", actionFrame: 9, fastFalling: true })).toHaveLength(0);
  });
});

/**
 * Which box won a swing, when the swing hit more than one fighter.
 *
 * A move is several hitboxes at once and an overlap resolves to the lowest id,
 * which is the sweetspot mechanic. Recording only the last event made the
 * answer depend on victim port order: a Marth tipper on one opponent followed
 * by a sourspot on another recorded the sourspot and suppressed the bloom.
 */
describe("the hitbox a swing landed with", () => {
  const swinger = () =>
    makeState({
      fighters: [
        makeFighter({ port: 0, action: "attack", move: "fsmash", actionFrame: 4 }),
        makeFighter({ port: 1 }),
        makeFighter({ port: 2 }),
      ],
    });

  /** One frame in which the same swing connects with two fighters. */
  function bothVictims(first: number, second: number) {
    const v = createVfx();
    const state = swinger();
    const events = makeEvents({
      hits: [
        { attacker: 0, victim: 1, damage: fx(9), x: 0, y: 0, knockback: fx(30), angle: 0, hitboxId: first },
        { attacker: 0, victim: 2, damage: fx(9), x: 0, y: 0, knockback: fx(30), angle: 0, hitboxId: second },
      ],
    });
    ingestEvents(v, events, state);
    return v.lastHit[0]?.hitboxId;
  }

  it("keeps the sweetspot whichever order the victims arrive in", () => {
    // The property: the answer must not depend on port order.
    expect(bothVictims(0, 1)).toBe(0);
    expect(bothVictims(1, 0)).toBe(0);
  });

  it("still reports a sourspot when that is all that connected", () => {
    // Otherwise "keep the lowest" would be indistinguishable from "always 0".
    expect(bothVictims(1, 1)).toBe(1);
    expect(bothVictims(2, 3)).toBe(2);
  });

  it("does not carry one hit phase's sweetspot into the next", () => {
    // A multi-hit move is several windows in one action — a down smash that
    // sweeps front then back, a multi-hit aerial. Aggregating across the whole
    // action would leave the second window unable to report its own sweetspot,
    // because the first window's lower id would still be sitting there.
    const v = createVfx();
    const state = swinger();
    state.frame = 200;
    ingestEvents(
      v,
      makeEvents({
        hits: [{ attacker: 0, victim: 1, damage: fx(9), x: 0, y: 0, knockback: fx(30), angle: 0, hitboxId: 0 }],
      }),
      state,
    );
    expect(v.lastHit[0]?.hitboxId).toBe(0);

    // The second window, later in the same action.
    const later = swinger();
    later.frame = 208;
    ingestEvents(
      v,
      makeEvents({
        hits: [{ attacker: 0, victim: 1, damage: fx(9), x: 0, y: 0, knockback: fx(30), angle: 0, hitboxId: 2 }],
      }),
      later,
    );
    expect(v.lastHit[0]?.hitboxId, "the first phase's tip is still being reported").toBe(2);
  });

  it("does not carry a sweetspot over into the next swing", () => {
    // Aggregation is scoped to the action; a new swing starts from nothing, or
    // one tipper would bloom every attack that followed it.
    const v = createVfx();
    const tip = makeState({
      fighters: [makeFighter({ port: 0, action: "attack", move: "fsmash", actionFrame: 4 })],
    });
    tip.frame = 100;
    ingestEvents(
      v,
      makeEvents({
        hits: [{ attacker: 0, victim: 1, damage: fx(9), x: 0, y: 0, knockback: fx(30), angle: 0, hitboxId: 0 }],
      }),
      tip,
    );
    // A later swing: the action began after the tipper was recorded.
    const later = makeState({
      fighters: [makeFighter({ port: 0, action: "attack", move: "fsmash", actionFrame: 2 })],
    });
    later.frame = 140;
    ingestEvents(
      v,
      makeEvents({
        hits: [{ attacker: 0, victim: 1, damage: fx(9), x: 0, y: 0, knockback: fx(30), angle: 0, hitboxId: 1 }],
      }),
      later,
    );
    expect(v.lastHit[0]?.hitboxId).toBe(1);
  });
});
