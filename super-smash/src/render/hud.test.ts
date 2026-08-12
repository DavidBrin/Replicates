import { describe, expect, it } from "vitest";

import { fx, toFloat } from "@/engine/fixed";
import { hexToRgb } from "./characterArt";
import { assignmentsTo, callsOf, countOf, createMockContext } from "./mockContext";
import {
  HUD_SHAKE_FRAMES,
  HUD_SHEAR,
  HUD_SKEW_DEGREES,
  PANEL_HEIGHT,
  PANEL_WIDTH,
  PERCENT_STOPS,
  createHudState,
  drawDamagePanel,
  drawEndSlate,
  drawHud,
  drawPercent,
  drawStocks,
  drawTimer,
  formatTime,
  parallelogramPath,
  percentColour,
  smallCaps,
  splitPercent,
  updateHud,
  type HudScene,
} from "./hud";
import { makeDef, makeFighter, makeState } from "./testFixtures";

function scene(overrides: Partial<HudScene> = {}): HudScene {
  const state = overrides.state ?? makeState();
  return {
    state,
    hud: overrides.hud ?? createHudState(),
    info:
      overrides.info ??
      state.fighters.map((f) => ({ def: makeDef(), label: "Mario", isCpu: f.port === 1 })),
  };
}

describe("the percent ramp", () => {
  it("hits its named stops exactly", () => {
    expect(percentColour(0)).toBe("#FFFFFF");
    expect(percentColour(50)).toBe("#FFD500");
    expect(percentColour(100)).toBe("#C10500");
    expect(percentColour(200)).toBe("#AD0000");
    expect(percentColour(300)).toBe("#5A0000");
  });

  it("clamps outside the range rather than extrapolating", () => {
    expect(percentColour(-40)).toBe("#FFFFFF");
    expect(percentColour(999)).toBe("#5A0000");
    expect(percentColour(Number.NaN)).toBe("#FFFFFF");
  });

  it("interpolates between stops", () => {
    const mid = percentColour(25);
    expect(mid).not.toBe("#FFFFFF");
    expect(mid).not.toBe("#FFD500");
    const [r, g, b] = hexToRgb(mid);
    expect(r).toBe(255);
    expect(g).toBeGreaterThan(hexToRgb("#FFD500")[1]);
    expect(b).toBeLessThan(255);
  });

  it("gets darker all the way from white to maroon", () => {
    const luminance = (p: number) => {
      const [r, g, b] = hexToRgb(percentColour(p));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    let last = Infinity;
    for (let p = 0; p <= 300; p += 10) {
      const l = luminance(p);
      expect(l).toBeLessThanOrEqual(last + 1e-6);
      last = l;
    }
  });

  it("uses the sampled Smash reds in the middle of the ramp", () => {
    const stops = PERCENT_STOPS.map(([, c]) => c);
    expect(stops).toContain("#C10500"); // --smash-red-lit
    expect(stops).toContain("#AD0000"); // --smash-red
    expect(stops).toContain("#FFD500"); // --smash-yellow
  });
});

describe("the shear", () => {
  it("is about 12 degrees", () => {
    expect(HUD_SKEW_DEGREES).toBe(12);
    expect(HUD_SHEAR).toBeCloseTo(Math.tan((12 * Math.PI) / 180), 9);
  });

  it("makes every panel a parallelogram, not a rectangle", () => {
    const ctx = createMockContext();
    parallelogramPath(ctx, 100, 200, PANEL_WIDTH, PANEL_HEIGHT);
    const pts = [
      callsOf(ctx, "moveTo")[0].args as [number, number],
      ...callsOf(ctx, "lineTo").map((c) => c.args as [number, number]),
    ];
    expect(pts).toHaveLength(4);
    const [tl, tr, br, bl] = pts;
    // Top edge shifted right of the bottom edge by height × tan(skew).
    expect(tl[0] - bl[0]).toBeCloseTo(PANEL_HEIGHT * HUD_SHEAR, 6);
    expect(tr[0] - br[0]).toBeCloseTo(PANEL_HEIGHT * HUD_SHEAR, 6);
    // ...and the two horizontal edges are still the same length.
    expect(tr[0] - tl[0]).toBeCloseTo(br[0] - bl[0], 6);
  });

  it("is applied to the text as a real transform, not a font italic", () => {
    const ctx = createMockContext();
    drawPercent(ctx, createHudState(), makeFighter(), 88.4, 0, 0, 200);
    const shears = callsOf(ctx, "transform").map((c) => c.args as number[]);
    expect(shears.length).toBeGreaterThan(0);
    for (const m of shears) {
      expect(m[0]).toBe(1);
      expect(m[3]).toBe(1);
      expect(m[2]).toBeCloseTo(-HUD_SHEAR, 9); // the shear term
    }
  });
});

describe("the percent readout", () => {
  it("sets the integer part markedly larger than the tenths and the sign", () => {
    const ctx = createMockContext();
    drawPercent(ctx, createHudState(), makeFighter(), 137.6, 0, 0, 300);
    const texts = callsOf(ctx, "fillText").map((c) => String(c.args[0]));
    expect(texts).toContain("137");
    expect(texts).toContain(".6%");

    const sizes = assignmentsTo(ctx, "font")
      .map((f) => Number(/(\d+)px/.exec(String(f))?.[1] ?? 0))
      .filter((n) => n > 0);
    const big = Math.max(...sizes);
    const small = Math.min(...sizes);
    expect(small / big).toBeLessThan(0.6);
    expect(small / big).toBeGreaterThan(0.4);
  });

  it("outlines and shadows the numerals so they survive a busy stage", () => {
    const ctx = createMockContext();
    drawPercent(ctx, createHudState(), makeFighter(), 42.0, 0, 0, 300);
    expect(countOf(ctx, "strokeText")).toBeGreaterThanOrEqual(2);
    expect(assignmentsTo(ctx, "shadowBlur").some((v) => Number(v) > 0)).toBe(true);
  });

  it("colours the numerals from the ramp", () => {
    const ctx = createMockContext();
    drawPercent(ctx, createHudState(), makeFighter(), 100, 0, 0, 300);
    expect(assignmentsTo(ctx, "fillStyle")).toContain("#C10500");
  });

  it("splits a Q12 damage value into the right tenth", () => {
    // 137.6% is stored as fx(137.6) and comes back as 137.5999...; a naive
    // `(p - floor(p)) * 10` floors that to 5 and the meter reads 137.5%.
    for (const value of [0, 0.1, 12.3, 99.9, 137.6, 200.4, 299.9]) {
      const round = toFloat(fx(value));
      const { whole, tenth } = splitPercent(round);
      expect(`${whole}.${tenth}`, `${value} round-tripped`).toBe(value.toFixed(1));
    }
  });

  it("truncates rather than rounds the tenths — 99.99% is not 100%", () => {
    const ctx = createMockContext();
    drawPercent(ctx, createHudState(), makeFighter(), 99.99, 0, 0, 300);
    const texts = callsOf(ctx, "fillText").map((c) => String(c.args[0]));
    expect(texts).toContain("99");
    expect(texts).toContain(".9%");
  });
});

describe("the shake", () => {
  it("triggers on taking damage and decays to nothing", () => {
    const hud = createHudState();
    const state = makeState({ fighters: [makeFighter({ port: 0, damage: 0 })] });
    updateHud(hud, state);
    expect(hud.shake[0]).toBe(0);

    updateHud(hud, makeState({ fighters: [makeFighter({ port: 0, damage: fx(12) })] }));
    expect(hud.shake[0]).toBeGreaterThan(0);

    for (let i = 0; i < HUD_SHAKE_FRAMES + 2; i++) {
      updateHud(hud, makeState({ fighters: [makeFighter({ port: 0, damage: fx(12) })] }));
    }
    expect(hud.shake[0]).toBe(0);
  });

  it("does not trigger on healing or on standing still", () => {
    const hud = createHudState();
    updateHud(hud, makeState({ fighters: [makeFighter({ port: 0, damage: fx(50) })] }));
    hud.shake[0] = 0;
    updateHud(hud, makeState({ fighters: [makeFighter({ port: 0, damage: fx(50) })] }));
    expect(hud.shake[0]).toBe(0);
    updateHud(hud, makeState({ fighters: [makeFighter({ port: 0, damage: fx(0) })] }));
    expect(hud.shake[0]).toBe(0);
  });

  it("offsets the numerals while it lasts", () => {
    const still = createMockContext();
    const shaking = createMockContext();
    const hud = createHudState();
    drawPercent(still, hud, makeFighter(), 60, 100, 100, 300);
    hud.shake[0] = HUD_SHAKE_FRAMES;
    drawPercent(shaking, hud, makeFighter(), 60, 100, 100, 300);
    const at = (c: typeof still) => (callsOf(c, "translate")[0].args as number[])[0];
    expect(at(shaking)).not.toBeCloseTo(at(still), 3);
  });
});

describe("panels", () => {
  it("draws one per fighter, centred as a row", () => {
    const ctx = createMockContext();
    const s = scene({ state: makeState({ fighters: [makeFighter({ port: 0 }), makeFighter({ port: 1 })] }) });
    drawHud(ctx, s);
    const gradients = countOf(ctx, "createLinearGradient");
    expect(gradients).toBe(2);
  });

  it("carries the port colour on the name bar and the stock icons", () => {
    const ctx = createMockContext();
    drawDamagePanel(ctx, scene(), makeFighter({ port: 1 }), 100, 800);
    const fills = assignmentsTo(ctx, "fillStyle").map(String);
    expect(fills).toContain("#3B7BFE");
  });

  it("labels a CPU as CPU", () => {
    const ctx = createMockContext();
    drawDamagePanel(ctx, scene(), makeFighter({ port: 1 }), 100, 800);
    expect(callsOf(ctx, "fillText").map((c) => String(c.args[0]))).toContain("CPU");
  });

  it("sets the name in small caps", () => {
    const ctx = createMockContext();
    drawDamagePanel(ctx, scene(), makeFighter({ port: 0 }), 100, 800);
    expect(callsOf(ctx, "fillText").map((c) => String(c.args[0]))).toContain("MARIO");
    expect(smallCaps("Donkey Kong")).toBe("DONKEY KONG");
  });

  it("smokes above 120% and not below", () => {
    const cool = createMockContext();
    const hot = createMockContext();
    drawDamagePanel(cool, scene(), makeFighter({ damage: fx(119) }), 100, 800);
    drawDamagePanel(hot, scene(), makeFighter({ damage: fx(190) }), 100, 800);
    expect(countOf(hot, "arc")).toBeGreaterThan(countOf(cool, "arc"));
  });

  it("draws one stock icon per life remaining", () => {
    const counts = [0, 1, 3].map((stocks) => {
      const ctx = createMockContext();
      drawStocks(ctx, makeFighter({ stocks }), { def: makeDef(), label: "Mario", isCpu: false }, 0, 0);
      return countOf(ctx, "stroke");
    });
    expect(counts[0]).toBe(0);
    expect(counts[2]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(0);
  });

  it("dims an eliminated fighter's panel", () => {
    const ctx = createMockContext();
    drawDamagePanel(ctx, scene(), makeFighter({ stocks: 0 }), 100, 800);
    expect(assignmentsTo(ctx, "globalAlpha").some((v) => Number(v) < 1)).toBe(true);
  });

  it("survives a fighter whose definition has not loaded yet", () => {
    const ctx = createMockContext();
    const s: HudScene = {
      state: makeState(),
      hud: createHudState(),
      info: [{ def: null, label: "", isCpu: false }],
    };
    expect(() => drawDamagePanel(ctx, s, makeFighter(), 0, 0)).not.toThrow();
  });
});

describe("the timer", () => {
  it("formats minutes, seconds and hundredths", () => {
    expect(formatTime(0)).toBe("0:00.00");
    expect(formatTime(60)).toBe("0:01.00");
    expect(formatTime(60 * 60 * 3)).toBe("3:00.00");
    expect(formatTime(60 * 65 + 30)).toBe("1:05.50");
    expect(formatTime(-10)).toBe("0:00.00");
  });

  it("appears only in a timed match", () => {
    const stock = createMockContext();
    drawHud(stock, scene());
    expect(callsOf(stock, "fillText").some((c) => String(c.args[0]).includes(":"))).toBe(false);

    const timed = createMockContext();
    const state = makeState({ rules: { ...makeState().rules, mode: "time" }, timeRemaining: 3600 });
    drawHud(timed, scene({ state }));
    expect(callsOf(timed, "fillText").some((c) => String(c.args[0]).includes(":"))).toBe(true);
  });

  it("goes yellow in the last ten seconds", () => {
    const calm = createMockContext();
    const urgent = createMockContext();
    drawTimer(calm, 3600);
    drawTimer(urgent, 400);
    expect(assignmentsTo(urgent, "strokeStyle")).toContain("#FFD500");
    expect(assignmentsTo(calm, "strokeStyle")).not.toContain("#FFD500");
  });
});

describe("the end slate", () => {
  it("says GAME! on a stock-out and TIME! on the clock", () => {
    const game = createMockContext();
    drawEndSlate(game, { kind: "stockOut", placings: [0, 1] });
    expect(callsOf(game, "fillText").map((c) => String(c.args[0]))).toContain("GAME!");

    const time = createMockContext();
    drawEndSlate(time, { kind: "timeUp", placings: [0, 1] });
    expect(callsOf(time, "fillText").map((c) => String(c.args[0]))).toContain("TIME!");

    const sd = createMockContext();
    drawEndSlate(sd, { kind: "suddenDeath", placings: [0, 1] });
    expect(callsOf(sd, "fillText").map((c) => String(c.args[0]))).toContain("SUDDEN DEATH");
  });

  it("is a sheared red banner with yellow rules, like the real one", () => {
    const ctx = createMockContext();
    drawEndSlate(ctx, { kind: "stockOut", placings: [0] });
    const fills = assignmentsTo(ctx, "fillStyle").map(String);
    expect(fills).toContain("#FFD500");
    expect(fills.some((f) => f.includes("173,0,0"))).toBe(true);
  });

  it("is drawn automatically once the match has an outcome", () => {
    const ctx = createMockContext();
    drawHud(ctx, scene({ state: makeState({ outcome: { kind: "stockOut", placings: [0, 1] } }) }));
    expect(callsOf(ctx, "fillText").map((c) => String(c.args[0]))).toContain("GAME!");
  });
});
