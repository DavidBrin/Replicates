import { describe, expect, it } from "vitest";

import { fx } from "@/engine/fixed";
import { createCamera } from "./camera";
import { createHudState } from "./hud";
import { assignmentsTo, callsOf, countOf, createMockContext } from "./mockContext";
import {
  INTERNAL_HEIGHT,
  INTERNAL_WIDTH,
  INTERPOLATION_SNAP_UNITS,
  computeLetterbox,
  drawScene,
  interpolatePosition,
  projectileVisual,
  render,
  visualHeight,
  type RenderState,
} from "./renderer";
import { getCharacterRig } from "./characterArt";
import { DIZZY_STARS, HIT_FLASH_FRAMES, createVfx, stepVfx } from "./vfx";
import {
  makeDef,
  makeEvents,
  makeFighter,
  makeProjectile,
  makeProjectileDef,
  makeStage,
  makeState,
} from "./testFixtures";

const stage = makeStage();

function renderState(over: Partial<RenderState> = {}): RenderState {
  const current = over.current ?? makeState();
  return {
    current,
    previous: over.previous ?? null,
    stage,
    fighters: over.fighters ?? current.fighters.map(() => makeDef()),
    labels: over.labels,
    cpu: over.cpu,
    vfx: over.vfx ?? createVfx(),
    hud: over.hud ?? createHudState(),
    debugSilhouette: over.debugSilhouette,
    showBlastZone: over.showBlastZone,
  };
}

describe("letterboxing", () => {
  it("composes at a fixed 1920×1080 whatever the canvas is", () => {
    expect(INTERNAL_WIDTH).toBe(1920);
    expect(INTERNAL_HEIGHT).toBe(1080);
  });

  it("fills a 16:9 canvas exactly, with no bars", () => {
    const box = computeLetterbox(1280, 720);
    expect(box.scale).toBeCloseTo(1280 / 1920, 9);
    expect(box.offsetX).toBeCloseTo(0, 9);
    expect(box.offsetY).toBeCloseTo(0, 9);
  });

  it("bars the top and bottom on a taller canvas", () => {
    const box = computeLetterbox(1920, 1440);
    expect(box.scale).toBe(1);
    expect(box.offsetX).toBe(0);
    expect(box.offsetY).toBe(180);
  });

  it("bars the sides on a wider canvas", () => {
    const box = computeLetterbox(2560, 1080);
    expect(box.scale).toBe(1);
    expect(box.offsetY).toBe(0);
    expect(box.offsetX).toBe(320);
  });

  it("never crops — the whole frame always fits", () => {
    for (const [w, h] of [
      [800, 600],
      [1366, 768],
      [3840, 2160],
      [1000, 1000],
    ]) {
      const box = computeLetterbox(w, h);
      expect(box.width).toBeLessThanOrEqual(w + 1e-9);
      expect(box.height).toBeLessThanOrEqual(h + 1e-9);
      expect(box.width / box.height).toBeCloseTo(16 / 9, 6);
    }
  });

  it("paints the bars black and clips to the frame", () => {
    const ctx = createMockContext(2560, 1080);
    render(ctx, renderState(), null, createCamera(stage), 0);
    expect(assignmentsTo(ctx, "fillStyle")[0]).toBe("#000000");
    expect(countOf(ctx, "clip")).toBeGreaterThan(0);
    const scales = callsOf(ctx, "scale").map((c) => c.args as number[]);
    expect(scales[0]).toEqual([1, 1]);
    const translates = callsOf(ctx, "translate").map((c) => c.args as number[]);
    expect(translates[0]).toEqual([320, 0]);
  });
});

describe("interpolation", () => {
  it("blends between the previous and current position", () => {
    const prev = makeFighter({ x: fx(0), y: fx(0) });
    const cur = makeFighter({ x: fx(10), y: fx(4) });
    expect(interpolatePosition(prev, cur, 0).x).toBeCloseTo(0, 6);
    expect(interpolatePosition(prev, cur, 0.5).x).toBeCloseTo(5, 6);
    expect(interpolatePosition(prev, cur, 1).x).toBeCloseTo(10, 6);
    expect(interpolatePosition(prev, cur, 0.5).y).toBeCloseTo(2, 6);
  });

  it("clamps alpha rather than extrapolating past the current frame", () => {
    const prev = makeFighter({ x: fx(0) });
    const cur = makeFighter({ x: fx(10) });
    expect(interpolatePosition(prev, cur, 2).x).toBeCloseTo(10, 6);
    expect(interpolatePosition(prev, cur, -1).x).toBeCloseTo(0, 6);
  });

  it("uses the current position when there is no previous frame", () => {
    expect(interpolatePosition(undefined, makeFighter({ x: fx(7) }), 0.5).x).toBeCloseTo(7, 6);
  });

  it("snaps across a respawn rather than streaking the fighter over the stage", () => {
    const prev = makeFighter({ x: fx(200), y: fx(-130) });
    const cur = makeFighter({ x: fx(0), y: fx(120) });
    const p = interpolatePosition(prev, cur, 0.5);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(120, 6);
  });

  it("still blends movement just under the snap threshold", () => {
    const prev = makeFighter({ x: 0 });
    const cur = makeFighter({ x: fx(INTERPOLATION_SNAP_UNITS - 1) });
    const p = interpolatePosition(prev, cur, 0.5);
    expect(p.x).toBeCloseTo((INTERPOLATION_SNAP_UNITS - 1) / 2, 4);
  });

  it("moves a fighter on screen as alpha advances", () => {
    const previous = makeState({ fighters: [makeFighter({ port: 0, x: fx(-10) })] });
    const current = makeState({ fighters: [makeFighter({ port: 0, x: fx(10) })] });
    const cam = createCamera(stage);

    const at = (alpha: number) => {
      const ctx = createMockContext();
      drawScene(ctx, renderState({ current, previous }), null, cam, alpha);
      // The first capsule's start point — the background also draws paths, so
      // anchor on the first round-capped stroke rather than on call zero.
      const firstBone = ctx.calls.findIndex((c) => c.method === "set:lineCap" && c.args[0] === "round");
      const move = ctx.calls.slice(firstBone).find((c) => c.method === "moveTo");
      return move!.args[0] as number;
    };
    expect(at(0.9)).toBeGreaterThan(at(0.1));
  });
});

describe("draw order", () => {
  function orderOf(ctx: ReturnType<typeof createMockContext>): string[] {
    // The one marker each layer leaves that no earlier layer does.
    const marks: { at: number; name: string }[] = [];
    const first = (predicate: (m: string, a: readonly unknown[]) => boolean, name: string) => {
      const at = ctx.calls.findIndex((c) => predicate(c.method, c.args));
      if (at >= 0) marks.push({ at, name });
    };
    // The sky is the only thing that fills the whole frame.
    first((m, a) => m === "fillRect" && a[2] === 1920 && a[3] === 1080, "background");
    // Battlefield's platform top is the only use of this colour.
    first((m, a) => m === "set:fillStyle" && a[0] === "#6FA8D6", "platforms");
    first((m, a) => m === "set:lineCap" && a[0] === "round", "fighters");
    first((m, a) => m === "fillText" && String(a[0]) === "0", "hud");
    return marks.sort((x, y) => x.at - y.at).map((m) => m.name);
  }

  it("runs background, platforms, fighters, HUD in that order", () => {
    const ctx = createMockContext();
    drawScene(ctx, renderState(), null, createCamera(stage), 1);
    expect(orderOf(ctx)).toEqual(["background", "platforms", "fighters", "hud"]);
  });

  it("draws each fighter's rim before its body", () => {
    const ctx = createMockContext();
    drawScene(ctx, renderState({ current: makeState({ fighters: [makeFighter()] }) }), null, createCamera(stage), 1);
    // The rim pass is the wider of the two, and it comes first.
    const widths = ctx.calls
      .filter((c) => c.method === "set:lineWidth")
      .map((c) => c.args[0] as number);
    const torsoWidths = widths.filter((w) => w > 5);
    expect(torsoWidths.length).toBeGreaterThan(1);
    expect(Math.max(...torsoWidths.slice(0, 15))).toBeGreaterThan(
      Math.max(...torsoWidths.slice(15, 30)),
    );
  });

  it("skips the rim entirely in silhouette mode", () => {
    const plain = createMockContext();
    const flat = createMockContext();
    const s = renderState({ current: makeState({ fighters: [makeFighter()] }) });
    drawScene(plain, s, null, createCamera(stage), 1);
    drawScene(flat, { ...s, debugSilhouette: true }, null, createCamera(stage), 1);
    expect(countOf(flat, "stroke")).toBeLessThan(countOf(plain, "stroke"));
  });

  it("does not draw a dead fighter's body", () => {
    const alive = createMockContext();
    const dead = createMockContext();
    drawScene(alive, renderState({ current: makeState({ fighters: [makeFighter()] }) }), null, createCamera(stage), 1);
    drawScene(
      dead,
      renderState({ current: makeState({ fighters: [makeFighter({ action: "dead" })] }) }),
      null,
      createCamera(stage),
      1,
    );
    expect(countOf(dead, "stroke")).toBeLessThan(countOf(alive, "stroke"));
  });

  /*
   * The hit flash used to be a `source-atop` rect 800px on a side, which
   * composited against the *scene* — every cloud, mountain and platform inside
   * it went pale. At the scene level the symptom is exact and easy to state: a
   * flashing fighter must not add a single area fill to the frame, because
   * everything the flash paints is a bone.
   */
  it("a hit flash adds no wash over the scene", () => {
    const plain = createMockContext();
    const flashing = createMockContext();
    const s = renderState({ current: makeState({ fighters: [makeFighter()] }) });
    const flashed = createVfx();
    flashed.hitFlash[0] = HIT_FLASH_FRAMES;

    drawScene(plain, s, null, createCamera(stage), 1);
    drawScene(flashing, { ...s, vfx: flashed }, null, createCamera(stage), 1);

    expect(countOf(flashing, "fillRect")).toBe(countOf(plain, "fillRect"));
    expect(assignmentsTo(flashing, "globalCompositeOperation").filter((m) => m !== "source-over")).toEqual([]);
    // And it did flash: one extra flat pass over the fighter's own bones.
    expect(countOf(flashing, "stroke")).toBeGreaterThan(countOf(plain, "stroke"));
  });

  it("draws the blast zone only when asked", () => {
    const off = createMockContext();
    const on = createMockContext();
    drawScene(off, renderState(), null, createCamera(stage), 1);
    drawScene(on, renderState({ showBlastZone: true }), null, createCamera(stage), 1);
    expect(countOf(off, "setLineDash")).toBe(0);
    expect(countOf(on, "setLineDash")).toBeGreaterThan(0);
  });
});

describe("projectiles", () => {
  it("resolves a visual from the launching move's definition", () => {
    const def = makeDef({
      moves: {
        neutralB: {
          slot: "neutralB",
          name: "Bow",
          totalFrames: 40,
          hitboxes: [],
          projectiles: [makeProjectileDef({ id: "linkArrow", visual: "arrow" })],
        },
      },
    });
    const lookup = projectileVisual(renderState({ fighters: [def] }));
    expect(lookup("linkArrow").visual).toBe("arrow");
  });

  it("falls back to a visible shape for an unknown id — an invisible projectile cannot be dodged", () => {
    const lookup = projectileVisual(renderState({ fighters: [makeDef()] }));
    expect(lookup("nothing-like-this").visual).toBe("energy");
  });

  it("draws one per projectile in flight", () => {
    const none = createMockContext();
    const some = createMockContext();
    drawScene(none, renderState(), null, createCamera(stage), 1);
    drawScene(
      some,
      renderState({
        current: makeState({
          projectiles: [makeProjectile({ instanceId: 1 }), makeProjectile({ instanceId: 2, x: fx(-30) })],
        }),
      }),
      null,
      createCamera(stage),
      1,
    );
    expect(countOf(some, "translate")).toBeGreaterThan(countOf(none, "translate"));
  });
});

describe("the whole frame", () => {
  it("draws a four-player match with hits, KOs and a Smash Ball without emitting NaN", () => {
    const current = makeState({
      frame: 412,
      smashBall: { active: true, x: fx(30), y: fx(70), vx: fx(1), vy: 0, health: fx(30), driftTimer: 5 },
      projectiles: [makeProjectile()],
      fighters: [
        makeFighter({ port: 0, x: fx(-60), damage: fx(137.6), action: "attack", move: "fsmash", actionFrame: 12, charge: 20 }),
        makeFighter({ port: 1, x: fx(20), y: fx(30), damage: fx(64.2), action: "tumble", actionFrame: 9, grounded: false }),
        makeFighter({ port: 2, x: fx(90), damage: fx(210), action: "shield", shieldHealth: fx(18) }),
        makeFighter({ port: 3, x: fx(-140), y: fx(-40), action: "roll", intangible: 6, actionFrame: 4, stocks: 1 }),
      ],
    });
    const events = makeEvents({
      hits: [{ attacker: 0, victim: 1, damage: fx(16), x: fx(-40), y: fx(10), knockback: fx(180), angle: fx(45) }],
      kos: [{ port: 3, x: fx(-240), y: fx(-140), kind: "blast" }],
      lands: [{ port: 2, x: fx(90), y: 0 }],
      clanks: [{ x: 0, y: fx(8) }],
    });

    const state = renderState({ current, cpu: [false, false, true, true], labels: ["Mario", "Link", "Fox", "Kirby"] });
    stepVfx(state.vfx, events, current);

    const cam = createCamera(stage);
    const ctx = createMockContext(1600, 900);
    render(ctx, state, events, cam, 0.5);

    expect(ctx.calls.length).toBeGreaterThan(200);
    for (const call of ctx.calls) {
      for (const arg of call.args) {
        if (typeof arg === "number") {
          expect(Number.isFinite(arg), `${call.method} emitted ${arg}`).toBe(true);
        }
        if (typeof arg === "string") {
          expect(arg.includes("NaN"), `${call.method} emitted ${arg}`).toBe(false);
        }
      }
    }
  });

  it("balances every save with a restore", () => {
    const ctx = createMockContext();
    render(ctx, renderState(), null, createCamera(stage), 0.5);
    expect(countOf(ctx, "save")).toBe(countOf(ctx, "restore"));
  });

  it("survives a fighter whose definition has not loaded", () => {
    const ctx = createMockContext();
    expect(() =>
      render(ctx, renderState({ fighters: [null, null] }), null, createCamera(stage), 0),
    ).not.toThrow();
  });

  it("draws every stage theme", () => {
    for (const theme of ["battlefield", "finalDestination", "smashville", "townAndCity", "pokemonStadium2", "who knows"]) {
      const ctx = createMockContext();
      const s = { ...renderState(), stage: makeStage({ theme }) };
      expect(() => drawScene(ctx, s, null, createCamera(s.stage), 1), theme).not.toThrow();
      expect(countOf(ctx, "fillRect"), theme).toBeGreaterThan(0);
    }
  });

  it("moves Smashville's platform with the frame, without asking the simulation", () => {
    const sweeping = makeStage({
      theme: "smashville",
      platforms: [
        { x: 0, y: 0, halfWidth: fx(70), soft: false, ledges: true },
        {
          x: 0,
          y: fx(31),
          halfWidth: fx(28),
          soft: true,
          ledges: false,
          motion: { kind: "sweep", amplitude: fx(60), periodFrames: 480 },
        },
      ],
    });
    const at = (frame: number) => {
      const ctx = createMockContext();
      drawScene(
        ctx,
        { ...renderState({ current: makeState({ frame }) }), stage: sweeping },
        null,
        createCamera(sweeping),
        1,
      );
      return callsOf(ctx, "moveTo").map((c) => c.args[0] as number);
    };
    expect(at(0)).not.toEqual(at(120));
  });
});

describe("visual height", () => {
  it("is measured from the same rig the match draws", () => {
    expect(visualHeight(getCharacterRig("kirby"))).toBeLessThan(visualHeight(getCharacterRig("mario")));
    expect(visualHeight(getCharacterRig("marth"))).toBeGreaterThan(visualHeight(getCharacterRig("mario")));
    // Roughly Ultimate's scale against a 160-unit Battlefield platform.
    expect(visualHeight(getCharacterRig("mario"))).toBeGreaterThan(8);
    expect(visualHeight(getCharacterRig("mario"))).toBeLessThan(20);
  });
});

describe("effects reach the screen", () => {
  /**
   * Written at the call site rather than against the effect function, because
   * the whole point is that the renderer calls it.
   *
   * Every dead feature this codebase has turned up — pose blending, move
   * momentum, super armour, the rebinding store, the thrown state — was
   * correct, exported and tested in isolation. What none of them had was
   * anything asserting that the thing which is supposed to use them does.
   */
  function fillsDrawn(fighter: Parameters<typeof makeFighter>[0]): number {
    const state = renderState({ current: makeState({ fighters: [makeFighter(fighter)] }) });
    const ctx = createMockContext(1600, 900);
    render(ctx, state, makeEvents(), createCamera(stage), 0);
    return countOf(ctx, "fill");
  }

  it("circles a broken shield with stars, and nothing else with them", () => {
    const dizzy = fillsDrawn({ action: "shieldBroken", actionFrame: 30 });
    const standing = fillsDrawn({ action: "stand", actionFrame: 30 });
    expect(dizzy).toBeGreaterThan(standing + DIZZY_STARS - 1);
  });
});
