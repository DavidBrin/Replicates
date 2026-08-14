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
const { createMockContext, callsOf } = await import("./mockContext");
const { makeDef, makeEvents, makeFighter, makeStage, makeState } = await import("./testFixtures");

describe("the renderer drains what an effect deferred", () => {
  function marks(): number {
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
    return callsOf(ctx, "fillRect").filter((c) => c.args[0] === OVER_MARK.x).length;
  }

  it("paints it once per fighter", () => {
    expect(marks(), "the over-queue never reached the canvas").toBe(1);
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
    const marks = callsOf(ctx, "fillRect").filter((c) => c.args[0] === OVER_MARK.x);
    expect(marks.length, "the lab never drained the over-queue").toBe(1);
  });
});
