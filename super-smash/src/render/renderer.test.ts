import { describe, expect, it } from "vitest";

import { fx } from "@/engine/fixed";
import { createCamera } from "./camera";
import { createHudState } from "./hud";
import { assignmentsTo, callsOf, countCapsules, countOf, createMockContext } from "./mockContext";
import {
  INTERNAL_HEIGHT,
  INTERNAL_WIDTH,
  INTERPOLATION_SNAP_UNITS,
  computeLetterbox,
  drawDepth,
  drawScene,
  interpolatePosition,
  projectileVisual,
  render,
  renderBackground,
  visualHeight,
  type RenderState,
} from "./renderer";
import { CHARACTER_RIGS, PANEL_INK, getCharacterRig, withAlpha } from "./characterArt";
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

  /** The overlay over the 3D world (Plan 4): cleared, so the world shows through, never painted over. */
  it("clears the whole canvas rather than painting it, and clips to the frame", () => {
    const ctx = createMockContext(2560, 1080);
    render(ctx, renderState(), null, createCamera(stage), 0);
    expect(callsOf(ctx, "clearRect")[0].args).toEqual([0, 0, 2560, 1080]);
    expect(ctx.calls.some((c) => c.method === "fillRect" && c.args[2] === 2560 && c.args[3] === 1080)).toBe(false);
    expect(countOf(ctx, "clip")).toBeGreaterThan(0);
    const scales = callsOf(ctx, "scale").map((c) => c.args as number[]);
    expect(scales[0]).toEqual([1, 1]);
    const translates = callsOf(ctx, "translate").map((c) => c.args as number[]);
    expect(translates[0]).toEqual([320, 0]);
  });

  /** The bars belong to the sky under the 3D layer (`renderBackground`), letterboxed the same way. */
  it("paints the bars black under the 3D layer", () => {
    const ctx = createMockContext(2560, 1080);
    renderBackground(ctx, stage, createCamera(stage), 0);
    expect(assignmentsTo(ctx, "fillStyle")[0]).toBe("#000000");
    expect(callsOf(ctx, "fillRect")[0].args).toEqual([0, 0, 2560, 1080]);
    expect(callsOf(ctx, "scale").map((c) => c.args)[0]).toEqual([1, 1]);
    expect(callsOf(ctx, "translate").map((c) => c.args)[0]).toEqual([320, 0]);
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

    // Where the port tag goes: the overlay hangs it on the drawn fighter, so it
    // follows the same interpolated position the 3D layer draws the model at.
    // The tag panel is the only shape painted in `PANEL_INK` at 0.82; the path
    // op that opened it is its first point.
    const at = (alpha: number) => {
      const ctx = createMockContext();
      drawScene(ctx, renderState({ current, previous }), null, cam, alpha);
      const panel = ctx.calls.findIndex((c) => c.method === "set:fillStyle" && c.args[0] === withAlpha(PANEL_INK, 0.82));
      expect(panel, "no port tag was drawn").toBeGreaterThan(-1);
      const move = ctx.calls.slice(0, panel).reverse().find((c) => c.method === "moveTo");
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
    // The sky was the only thing that filled the whole frame.
    first((m, a) => m === "fillRect" && a[2] === 1920 && a[3] === 1080, "background");
    // Battlefield's platform top was the only use of this colour.
    first((m, a) => m === "set:fillStyle" && a[0] === "#6FA8D6", "platforms");
    // The port tag's panel is the only shape painted in this ink.
    first((m, a) => m === "set:fillStyle" && a[0] === withAlpha(PANEL_INK, 0.82), "tags");
    first((m, a) => m === "fillText" && String(a[0]) === "0", "hud");
    return marks.sort((x, y) => x.at - y.at).map((m) => m.name);
  }

  /** The sky, the platforms and the fighters are the 3D layer's now (Plan 4); the overlay hangs the tags and the HUD over them. */
  it("draws no sky and no platforms, and puts the HUD over the fighters' tags", () => {
    const ctx = createMockContext();
    drawScene(ctx, renderState(), null, createCamera(stage), 1);
    expect(orderOf(ctx)).toEqual(["tags", "hud"]);
  });

  /**
   * The figure is the 3D model (Plan 4, Task 23). Capsules are the 2D figure's
   * mark (`countCapsules`: `drawCapsule` is the only round line cap in
   * `render/`), and the HUD's portraits are drawn with them too, so the frame is
   * measured against the same frame with nobody on the stage: the HUD is the
   * same, and a living fighter adds no capsule of their own.
   */
  it("draws no fighter's body, living or dead: the 3D layer draws them", () => {
    const alive = createMockContext();
    const dead = createMockContext();
    const fighters = (action: "stand" | "dead") => [makeFighter({ port: 0, x: fx(-20), action }), makeFighter({ port: 1, x: fx(20), action })];
    drawScene(alive, renderState({ current: makeState({ fighters: fighters("stand") }) }), null, createCamera(stage), 1);
    drawScene(dead, renderState({ current: makeState({ fighters: fighters("dead") }) }), null, createCamera(stage), 1);
    expect(countCapsules(alive)).toBe(countCapsules(dead));
  });

  /**
   * The hit flash brightens the model (`render3d/fighter3d.ts`); the overlay
   * draws nothing for it. It used to be a `source-atop` rect 800px on a side,
   * which composited against the *scene*, and then a flat pass over the 2D
   * figure's bones; over the 3D world, any wash here would sit on the model.
   */
  it("a hit flash adds nothing to the overlay", () => {
    const plain = createMockContext();
    const flashing = createMockContext();
    const current = makeState({ fighters: [makeFighter()] });
    const flashed = createVfx();
    flashed.hitFlash[0] = HIT_FLASH_FRAMES;

    drawScene(plain, renderState({ current }), null, createCamera(stage), 1);
    drawScene(flashing, renderState({ current, vfx: flashed }), null, createCamera(stage), 1);

    // As data: a gradient the HUD makes is a fresh object with its own closures each frame.
    expect(JSON.stringify(flashing.calls)).toBe(JSON.stringify(plain.calls));
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

describe("draw depth", () => {
  it("draws a fighter being hit or floored behind, and keeps a tumble behind when its hitstun ends", () => {
    for (const action of ["hitstun", "tumble", "tumbleFall", "downed"] as const) {
      expect(drawDepth(makeFighter({ action })), action).toBe(0);
    }
    expect(drawDepth(makeFighter({ action: "fall" }))).toBe(1);
    expect(drawDepth(makeFighter({ action: "attack" }))).toBe(2);
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
      hits: [{ attacker: 0, victim: 1, damage: fx(16), x: fx(-40), y: fx(10), contactX: fx(-40), contactY: fx(10), knockback: fx(180), angle: fx(45), hitboxId: 0 }],
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

  /** The sky under the 3D layer (`renderBackground`); the 3D stage draws each theme's platforms (`render3d/stage3d.ts`). */
  it("draws every stage theme's sky", () => {
    for (const theme of ["battlefield", "finalDestination", "smashville", "townAndCity", "pokemonStadium2", "who knows"]) {
      const ctx = createMockContext();
      const themed = makeStage({ theme });
      expect(() => renderBackground(ctx, themed, createCamera(themed), 1), theme).not.toThrow();
      expect(countOf(ctx, "fillRect"), theme).toBeGreaterThan(1);
    }
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

/**
 * The port tag clears the fighter's silhouette, not their skeleton.
 *
 * `visualHeight` measures bones and the head circle and knows nothing about
 * props, so a fighter whose identifying shape sits on top of their head wore
 * the tag on it. Four agents reported this independently, on four characters
 * and for four different reasons — Pikachu's ears, Samus's drill tip, Mario's
 * Super Jump Punch, and Link's boomerang, where the tag clipped the inboard
 * arm of the V and left one arm, which reads as a hank of hair.
 *
 * Measured off the drawing rather than off the arithmetic: the tag is the
 * highest ink a fighter has, so the topmost coordinate in the call log is it.
 */
describe("where the port tag sits", () => {
  function tagTop(id: string, clearance?: number): number {
    const rig = CHARACTER_RIGS[id];
    const original = rig.tagClearance;
    Object.defineProperty(rig, "tagClearance", { value: clearance, configurable: true, writable: true });
    try {
      const ctx = createMockContext(1600, 900);
      // The rig is resolved from the *definition's* id (`renderer.ts:221`),
      // not from `FighterState.defId` — so a fixture that sets only `defId`
      // renders the default Mario rig and every measurement below comes back
      // identical no matter what clearance is declared.
      const state = renderState({
        current: makeState({ fighters: [makeFighter({ defId: id })] }),
        fighters: [makeDef({ id })],
      });
      render(ctx, state, makeEvents(), createCamera(stage), 0);
      // The tag has to be isolated by its own fill, not found as "the highest
      // ink on the canvas". The first version of this took the topmost
      // `moveTo` in the whole call log and got the stage's mountains, which do
      // not move when a fighter's clearance changes — so it reported the same
      // number for every input and would have passed against a fix that did
      // nothing at all.
      //
      // The tag panel is the only shape painted in `PANEL_INK` at 0.82, so
      // find that fill and take the path op that opened it.
      const ink = withAlpha(PANEL_INK, 0.82);
      const at = ctx.calls.findIndex((c) => c.method === "set:fillStyle" && c.args[0] === ink);
      expect(at, "no port tag was drawn at all").toBeGreaterThan(-1);
      for (let i = at; i >= 0; i--) {
        if (ctx.calls[i].method === "moveTo") return ctx.calls[i].args[1] as number;
      }
      throw new Error("the tag's fill had no path before it");
    } finally {
      Object.defineProperty(rig, "tagClearance", { value: original, configurable: true, writable: true });
    }
  }

  it("rises for a fighter who declares headroom", () => {
    const withNone = tagTop("pikachu", 0);
    const withEars = tagTop("pikachu", 3.2);
    expect(withEars, "declaring clearance did not move the tag").toBeLessThan(withNone);
  });

  it("scales the clearance by the rig, so it means rig units and not pixels", () => {
    // Compared across two rigs, because comparing a fighter against itself
    // cannot see this. The first version asserted `lift / rig.scale > lift`,
    // which is true for any fighter under 1.0 whatever the code does — it
    // passed against a mutation that dropped the scaling entirely, and a test
    // that survives its own bug is worse than none.
    //
    // The same declared clearance must lift a big rig further than a small
    // one, in proportion: Marth is 1.16 and Pikachu 0.72.
    const small = CHARACTER_RIGS["pikachu"];
    const big = CHARACTER_RIGS["marth"];
    const smallLift = tagTop("pikachu", 0) - tagTop("pikachu", 4);
    const bigLift = tagTop("marth", 0) - tagTop("marth", 4);
    expect(smallLift).toBeGreaterThan(0);
    expect(bigLift / smallLift, "clearance is in pixels, not rig units").toBeCloseTo(
      big.scale / small.scale,
      4,
    );
  });

  it("leaves a fighter who declares nothing exactly where they were", () => {
    expect(tagTop("mario", undefined)).toBe(tagTop("mario", 0));
  });

  /**
   * The declaration itself, not just the mechanism.
   *
   * Every test above overrides `tagClearance` with a value of its own, so all
   * of them pass just as happily after Pikachu's production declaration is
   * deleted — which is the actual defect: the ears are the shape that names him
   * at sixty pixels and the tag sat across them. The mechanism was covered and
   * the fix was not.
   */
  /**
   * Pikachu's shipped declaration, and the honest limit of what this asserts.
   *
   * What is checked: that he declares headroom at all, and that the renderer
   * consumes it. Every other test in this block overrides `tagClearance` with a
   * value of its own, so all of them stay green after the production
   * declaration is deleted — which is the defect itself, since the ears are the
   * shape that names him at sixty pixels.
   *
   * What is **not** checked, and should be said rather than implied: that 3.2
   * is *enough*. Proving non-overlap needs the ears' ink in canvas space, and a
   * prop paints inside `translate`/`scale` while `mockContext` returns an
   * identity matrix from `getTransform` — so a path op records its own local
   * coordinates and comparing them to a canvas y is meaningless. An attempt at
   * it here reported Pikachu's ears overhanging by 18 rig units, on a fighter
   * seven units tall.
   *
   * The value was set the only way currently available: by capture. See
   * `/tmp/pika-tag.png` in the round-two pass — tag fully clear of both ears
   * across the jab. Making this assertable means teaching the mock to track the
   * CTM, which is worth doing and is not this change.
   */
  it("declares headroom, and the renderer spends it", () => {
    const declared = CHARACTER_RIGS["pikachu"].tagClearance;
    expect(declared, "Pikachu no longer declares any headroom").toBeGreaterThan(0);
    expect(tagTop("pikachu", declared)).toBeLessThan(tagTop("pikachu", 0));
  });

  it("is the only fighter on the roster who needs it", () => {
    // Not decoration: it says the mechanism is opt-in and that nobody else has
    // quietly acquired a value, which would make the tag float for no reason.
    const declaring = Object.entries(CHARACTER_RIGS)
      .filter(([k]) => !["default", "dk", "donkey-kong"].includes(k))
      .filter(([, r]) => (r.tagClearance ?? 0) > 0)
      .map(([k]) => k);
    expect(declaring).toEqual(["pikachu"]);
  });
});
