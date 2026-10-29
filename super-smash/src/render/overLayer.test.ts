/**
 * The overlay has to drain the effect's over-queue.
 *
 * `drawMoveFx` hands back the paints an effect deferred, and everything about
 * whether they reach the screen is the *caller's* obligation — a `for` loop
 * after the effect in the renderer. (The animation lab drew a 2D figure and
 * drained it too, until Plan 4 replaced its 2D cells with the 3D sheet.)
 * Forgetting it is silent in the worst way: the effect still paints its under
 * layer, so the move looks like a slightly incomplete version of itself rather
 * than like a bug, and the author reads that as their own drawing being wrong.
 *
 * No character defers a paint yet, which is exactly why this is mocked. A test
 * written against the real table would pass today by drawing nothing and go on
 * passing after someone deleted the loop — the vacuous-fixture failure this
 * codebase has already shipped once, in `chars.test.ts`.
 */

import { describe, expect, it, vi } from "vitest";

const OVER_MARK = { x: 12345, y: 54321, w: 7, h: 7 } as const;

vi.mock("./specialFx", async (importOriginal) => {
  const real = await importOriginal<typeof import("./specialFx")>();
  return {
    ...real,
    drawMoveFx: (ctx: CanvasRenderingContext2D) => ({
      hideFigure: false,
      over: [() => ctx.fillRect(OVER_MARK.x, OVER_MARK.y, OVER_MARK.w, OVER_MARK.h)],
    }),
  };
});

const { render } = await import("./renderer");
const { createCamera } = await import("./camera");
const { PANEL_INK, withAlpha } = await import("./characterArt");
const { createHudState } = await import("./hud");
const { createVfx } = await import("./vfx");
const { createMockContext } = await import("./mockContext");
const { makeDef, makeEvents, makeFighter, makeStage, makeState } = await import("./testFixtures");

describe("the renderer drains what an effect deferred", () => {
  function marks(): { marks: number; after: boolean } {
    const ctx = createMockContext(1600, 900);
    const current = makeState({ fighters: [makeFighter({ action: "special", move: "neutralB" })] });
    render(
      ctx,
      {
        current,
        previous: null,
        stage: makeStage(),
        fighters: current.fighters.map(() => makeDef()),
        vfx: createVfx(),
        hud: createHudState(),
      },
      makeEvents(),
      createCamera(makeStage()),
      0,
    );
    return order(ctx);
  }

  /**
   * Where the mark landed relative to the port tag.
   *
   * Counting the mark proves it was painted; it does not prove *where* in the
   * fighter's layers. The figure is the 3D model now, under this canvas, so the
   * deferred layer is over it whenever it is painted at all; what is left to get
   * wrong is the port tag, which is readability the player needs and a move
   * graphic must not bury. The tag's sentinel is its panel, the only shape
   * painted in `PANEL_INK` at 0.82.
   */
  function order(ctx: ReturnType<typeof createMockContext>): { marks: number; after: boolean } {
    const mark = ctx.calls.findIndex((c) => c.method === "fillRect" && c.args[0] === OVER_MARK.x);
    const tag = ctx.calls.findIndex((c) => c.method === "set:fillStyle" && c.args[0] === withAlpha(PANEL_INK, 0.82));
    return {
      marks: ctx.calls.filter((c) => c.method === "fillRect" && c.args[0] === OVER_MARK.x).length,
      after: mark >= 0 && tag > mark,
    };
  }

  it("paints it once per fighter, under the port tag", () => {
    const { marks: n, after } = marks();
    expect(n, "the over-queue never reached the canvas").toBe(1);
    expect(after, "the deferred paint landed over the port tag").toBe(true);
  });
});
