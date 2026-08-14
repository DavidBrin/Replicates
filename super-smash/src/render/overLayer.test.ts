/**
 * The two callers who draw a fighter have to drain the effect's over-queue.
 *
 * `drawMoveFx` hands back the paints an effect deferred, and everything about
 * whether they reach the screen is the *caller's* obligation — a `for` loop
 * after `drawFigure` in the renderer, and the same loop in the animation lab.
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
   * Where the mark landed relative to the figure.
   *
   * Counting the mark proves it was painted; it does not prove it was painted
   * *after* the body, which is the entire point of the layer. A caller that
   * drained the queue before `drawFigure` would paint exactly one mark, under
   * the fighter, and satisfy a test that only counts.
   *
   * The figure's own sentinel is the round line cap: capsules are the only
   * thing drawn that way, and nothing before the fighters uses it.
   */
  function order(ctx: ReturnType<typeof createMockContext>): { marks: number; after: boolean } {
    const mark = ctx.calls.findIndex((c) => c.method === "fillRect" && c.args[0] === OVER_MARK.x);
    const figure = ctx.calls.findIndex((c) => c.method === "set:lineCap" && c.args[0] === "round");
    return {
      marks: ctx.calls.filter((c) => c.method === "fillRect" && c.args[0] === OVER_MARK.x).length,
      after: mark > figure && figure >= 0,
    };
  }

  it("paints it once per fighter, after the figure", () => {
    const { marks: n, after } = marks();
    expect(n, "the over-queue never reached the canvas").toBe(1);
    expect(after, "the deferred paint landed under the figure, not over it").toBe(true);
  });
});

/**
 * The lab is the other half of the contract, and it was not being checked.
 *
 * This file said "both callers that draw a fighter must drain the queue" and
 * then only ever called `render`. Deleting the lab's own `for (const paint of
 * fx.over)` loop left every assertion above green — so the test named the
 * contract it was failing to enforce, which is the most expensive kind of test
 * to have: it reads as coverage.
 */
describe("the animation lab drains it too", () => {
  it("paints the deferred layer in the authoring view", async () => {
    const { drawCell } = await import("@/app/anim/page");
    const ctx = createMockContext(800, 600);
    drawCell(
      ctx as unknown as CanvasRenderingContext2D,
      {
        fighterId: "kirby",
        action: "special",
        move: "downB",
        jumpsUsed: 0,
        fastFalling: false,
      },
      12,
      400,
      500,
      9,
    );
    const mark = ctx.calls.findIndex((c) => c.method === "fillRect" && c.args[0] === OVER_MARK.x);
    const figure = ctx.calls.findIndex((c) => c.method === "set:lineCap" && c.args[0] === "round");
    expect(
      ctx.calls.filter((c) => c.method === "fillRect" && c.args[0] === OVER_MARK.x).length,
      "the lab never drained the over-queue",
    ).toBe(1);
    // Kirby's Stone hides the figure, so there is no body sentinel on this
    // frame — pick a fighter who is drawn, so ordering is observable at all.
    expect(figure, "no figure was drawn, so ordering proves nothing here").toBeGreaterThan(-1);
    expect(mark > figure, "the lab painted the deferred layer under the figure").toBe(true);
  });
});
