/**
 * Every special has to look like itself.
 *
 * The failure this guards against is quiet by construction: a typo in a table
 * key, or a move renamed in `fighters/`, and the effect simply stops being
 * drawn. Nothing errors, nothing goes red, and the symptom is that Kirby's
 * Stone looks like Samus's Charge Shot again — which is precisely the state
 * this module was written to get out of.
 */

import { describe, expect, it } from "vitest";
import { FIGHTERS } from "@/fighters";
import type { MoveSlot } from "@/engine/types";
import { createCamera } from "./camera";
import { createMockContext, countOf } from "./mockContext";
import { SPECIAL_FX_KEYS, drawSpecialFx } from "./specialFx";
import { makeFighter, makeStage } from "./testFixtures";

const cam = createCamera(makeStage());
const byId = new Map(FIGHTERS.map((f) => [f.id, f]));

function draw(id: string, slot: MoveSlot, frame: number, over: Record<string, unknown> = {}) {
  const ctx = createMockContext();
  const def = byId.get(id);
  expect(def, `no fighter ${id}`).toBeDefined();
  const result = drawSpecialFx(
    ctx,
    def,
    makeFighter({ action: "special", move: slot, actionFrame: frame, ...over }),
    cam,
    13,
    960,
    540,
  );
  return { ctx, result };
}

describe("the effect table", () => {
  it("names only moves that exist", () => {
    expect(SPECIAL_FX_KEYS.length).toBeGreaterThan(5);
    for (const key of SPECIAL_FX_KEYS) {
      const [id, slot] = key.split(".");
      const def = byId.get(id);
      expect(def, `${key}: no such fighter`).toBeDefined();
      expect(def?.moves[slot as MoveSlot], `${key}: no such move`).toBeDefined();
    }
  });

  it("covers at least half the roster, so specials are not all one look", () => {
    const covered = new Set(SPECIAL_FX_KEYS.map((k) => k.split(".")[0]));
    expect(covered.size).toBeGreaterThanOrEqual(FIGHTERS.length / 2);
  });

  it("draws nothing for a fighter who is not doing a special", () => {
    const ctx = createMockContext();
    const before = ctx.calls.length;
    drawSpecialFx(ctx, byId.get("kirby"), makeFighter({ action: "stand", move: null }), cam, 13, 0, 0);
    expect(ctx.calls.length).toBe(before);
  });
});

describe("Kirby's Stone replaces Kirby", () => {
  const armour = byId.get("kirby")?.moves.downB?.superArmourFrames as [number, number];

  it("hides the fighter for exactly the frames he is a rock", () => {
    // `moveFrameOf` is +1, so the action frame that lands on move frame `n` is
    // `n - 1`. Checked at both edges because an off-by-one here shows up as
    // Kirby flickering in and out of existence for a frame.
    expect(draw("kirby", "downB", armour[0] - 1).result.hideFigure).toBe(true);
    expect(draw("kirby", "downB", armour[1] - 1).result.hideFigure).toBe(true);
    expect(draw("kirby", "downB", armour[0] - 2).result.hideFigure).toBe(false);
    expect(draw("kirby", "downB", armour[1]).result.hideFigure).toBe(false);
  });

  it("actually paints a rock while it is hiding him", () => {
    // Hiding the fighter and drawing nothing in their place would make Kirby
    // vanish, which is a far worse bug than the one this fixes.
    const { ctx } = draw("kirby", "downB", armour[0] + 4);
    expect(countOf(ctx, "fill")).toBeGreaterThan(2);
    expect(countOf(ctx, "stroke")).toBeGreaterThan(0);
  });
});

describe("Samus's Charge Shot shows its charge", () => {
  it("grows with the charge rather than being a fixed blob", () => {
    const radii: number[] = [];
    for (const charge of [4, 30, 60]) {
      const { ctx } = draw("samus", "neutralB", 1, { charge });
      // The plasma is the largest circle drawn.
      const arcs = ctx.calls.filter((c) => c.method === "arc").map((c) => c.args[2] as number);
      radii.push(Math.max(...arcs));
    }
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeGreaterThan(radii[i - 1]);
  });

  it("draws nothing of the charge once it has been fired", () => {
    const { ctx } = draw("samus", "neutralB", 30, { charge: 0 });
    expect(countOf(ctx, "arc")).toBe(0);
  });
});

describe("the rest", () => {
  it("paints something on the frames each effect claims", () => {
    const cases: [string, MoveSlot, number][] = [
      ["fox", "downB", 6],
      ["marth", "downB", 10],
      ["donkeyKong", "neutralB", 12],
      ["pikachu", "downB", 20],
      ["mario", "downB", 40],
      ["link", "neutralB", 8],
    ];
    for (const [id, slot, frame] of cases) {
      const { ctx } = draw(id, slot, frame);
      expect(ctx.calls.length, `${id}.${slot} drew nothing`).toBeGreaterThan(0);
    }
  });
});
