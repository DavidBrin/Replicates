/**
 * T11's token half: the stadium at three digits, label hiding below
 * 2,500 px², and §10's promise that the counter transform is two variables on
 * the layer rather than two writes per token.
 */
import { describe, expect, it } from "vitest";

import { TINY4, TINY4_FILE, T4 } from "@/game/__fixtures__/tiny4";
import { toMapDef } from "@/game/mapLoader";
import { TROOPS_UNKNOWN } from "@/engine/types";

import type { Camera } from "./camera";
import {
  createTokenLayer, labelBoxSize, labelFontSize, labelVisible, LABEL_FONT, LABEL_FONT_DENSE,
  LABEL_MIN_AREA, LABEL_NUDGE, planLabels, tokenSvg, type TokenPaint,
} from "./tokens";

const CAM: Camera = {
  pan: [0, 0],
  zoom: 1,
  tilt: 4,
  viewport: { w: 400, h: 300 },
  board: { w: 400, h: 300 },
};

function paintOf(overrides: Partial<TokenPaint> = {}): TokenPaint {
  return {
    owners: TINY4.territories.map(() => "none"),
    troops: TINY4.territories.map(() => 1),
    selected: null,
    radius: 19,
    showLabels: true,
    ...overrides,
  };
}

describe("tokenSvg — §8's chip recipe", () => {
  it("is two circles at one digit: body cy 29, face cy 24, r 19", () => {
    const html = tokenSvg(19, 1);
    expect(html).toContain('viewBox="0 0 48 56"');
    expect(html).toContain('<circle class="chip-body" cx="24" cy="29" r="19"/>');
    expect(html).toContain('<circle class="chip-face" cx="24" cy="24" r="19"/>');
    expect(html).not.toContain("<rect");
  });

  it("is still circles at two digits — tabular-nums keeps the disc the same size", () => {
    expect(tokenSvg(19, 2)).toBe(tokenSvg(19, 1));
  });

  it("swaps to a stadium at three digits, width 38 + 11·(digits − 1) (D70)", () => {
    for (const digits of [3, 4, 5]) {
      const width = 38 + 11 * (digits - 1);
      const html = tokenSvg(19, digits);
      expect(html).toContain(`<rect class="chip-body" x="5" y="10" width="${width}" height="38" rx="19"/>`);
      expect(html).toContain(`<rect class="chip-face" x="5" y="5" width="${width}" height="38" rx="19"/>`);
      expect(html).toContain(`viewBox="0 0 ${width + 10} 56"`);
      expect(html).not.toContain("<circle");
    }
  });

  it("carries the #fff specular ellipse at 16%", () => {
    expect(tokenSvg(19, 1)).toContain('<ellipse class="chip-spec" cx="24" cy="15.5" rx="12" ry="4.5"/>');
  });

  it("scales the whole chip off the radius — r 15 on a dense map", () => {
    const dense = tokenSvg(15, 1);
    expect(dense).toContain('viewBox="0 0 48 56"');
    expect(dense).toContain(`width="${((48 * 15) / 19).toFixed(2)}"`);
    expect(dense).toContain(`height="${((56 * 15) / 19).toFixed(2)}"`);
  });
});

describe("labelVisible — §8's 2,500 px² floor", () => {
  it("hides a label below the floor and shows it above", () => {
    // Alpha's polygon is 19,550 map units², so the floor falls at zoom ≈ 0.358.
    expect(labelVisible(TINY4, T4.alpha, { ...CAM, zoom: 0.3 })).toBe(false);
    expect(labelVisible(TINY4, T4.alpha, { ...CAM, zoom: 0.5 })).toBe(true);
    expect(19550 * 0.3 * 0.3).toBeLessThan(LABEL_MIN_AREA);
    expect(19550 * 0.5 * 0.5).toBeGreaterThan(LABEL_MIN_AREA);
  });

  it("hides a label whose token has been panned off the viewport", () => {
    expect(labelVisible(TINY4, T4.alpha, CAM)).toBe(true);
    expect(labelVisible(TINY4, T4.alpha, { ...CAM, pan: [-1000, 0] })).toBe(false);
  });

  it("is false for an index the map does not have", () => {
    expect(labelVisible(TINY4, 99, CAM)).toBe(false);
  });
});

describe("planLabels — the greedy collision pass [ours]", () => {
  /** Four territories on a big board, at anchors the test dictates. */
  function mapOf(anchors: readonly (readonly [number, number])[]) {
    return toMapDef({
      ...TINY4_FILE,
      viewBox: "0 0 2000 2000",
      territories: TINY4_FILE.territories.map((t, i) => {
        const [x, y] = anchors[i] ?? [0, 0];
        return { ...t, tokenX: x, tokenY: y, labelX: x, labelY: y + 26 };
      }),
    });
  }

  const APART = mapOf([[200, 200], [1200, 200], [1200, 1200], [200, 1200]]);
  const FLAT = { zoom: 1, tilt: 0 } as const;

  it("leaves every label on its §8.6 anchor when nothing collides", () => {
    const plan = planLabels(APART, FLAT, 19);
    expect(plan).toHaveLength(4);
    for (const place of plan) expect(place).toEqual({ dy: 0, crowded: false });
  });

  it("nudges a label 12 px down off a near-miss with the label above it", () => {
    // Bravo's label lands on the bottom edge of Alpha's; 12 px clears it.
    const near = mapOf([[200, 174], [255, 200], [1200, 1200], [200, 1200]]);
    const plan = planLabels(near, FLAT, 19);
    expect(plan[0]).toEqual({ dy: 0, crowded: false });
    expect(plan[1]).toEqual({ dy: LABEL_NUDGE, crowded: false });
  });

  it("flips a label above its token when neither the anchor nor the nudge is free", () => {
    const pile = mapOf([[200, 200], [200, 200], [1200, 1200], [200, 1200]]);
    const plan = planLabels(pile, FLAT, 19);
    expect(plan[0]?.dy).toBe(LABEL_NUDGE);
    expect(plan[1]?.dy).toBeLessThan(0);
    expect(plan[1]?.crowded).toBe(false);
  });

  it("marks a label crowded once all three candidates are taken", () => {
    const pile = mapOf([[200, 200], [200, 200], [200, 200], [200, 200]]);
    const plan = planLabels(pile, FLAT, 19);
    expect(plan.map((p) => p.crowded)).toEqual([false, false, true, true]);
    // A crowded label keeps its anchor; it is hidden, not moved somewhere odd.
    for (const place of plan) if (place.crowded) expect(place.dy).toBe(0);
  });

  it("stops moving labels once the zoom has pulled the anchors apart", () => {
    const near = mapOf([[200, 174], [255, 200], [1200, 1200], [200, 1200]]);
    expect(planLabels(near, { zoom: 1, tilt: 0 }, 19)[1]?.dy).toBe(LABEL_NUDGE);
    expect(planLabels(near, { zoom: 4, tilt: 0 }, 19)[1]?.dy).toBe(0);
  });

  it("steps the label type down one notch above 50 territories (§8.6)", () => {
    expect(labelFontSize(42)).toBe(LABEL_FONT);
    expect(labelFontSize(50)).toBe(LABEL_FONT);
    expect(labelFontSize(59)).toBe(LABEL_FONT_DENSE);
    expect(labelBoxSize("Alpha", LABEL_FONT_DENSE).w)
      .toBeLessThan(labelBoxSize("Alpha", LABEL_FONT).w);
  });
});

describe("token layer", () => {
  it("positions at raw map coordinates minus the viewBox origin", () => {
    const shifted = toMapDef({ ...TINY4_FILE, viewBox: "10 8 400 300" });
    const layer = createTokenLayer(shifted);
    const token = layer.element.querySelector<HTMLElement>('.token[data-token="0"]');
    const label = layer.element.querySelector<HTMLElement>('.label[data-label="0"]');
    // alpha's token is (105, 76) and its label (105, 102) in map units.
    expect(token?.style.getPropertyValue("--x")).toBe("95px");
    expect(token?.style.getPropertyValue("--y")).toBe("68px");
    expect(label?.style.getPropertyValue("--x")).toBe("95px");
    expect(label?.style.getPropertyValue("--y")).toBe("94px");
  });

  it("writes --tilt and --zoom on the layer, never per token", () => {
    const layer = createTokenLayer(TINY4);
    layer.paint(paintOf(), { ...CAM, zoom: 2.5, tilt: 18 });
    expect(layer.element.style.getPropertyValue("--tilt")).toBe("18deg");
    expect(layer.element.style.getPropertyValue("--zoom")).toBe("2.5");
    for (const node of layer.element.querySelectorAll<HTMLElement>(".token, .label")) {
      expect(node.style.getPropertyValue("--tilt")).toBe("");
      expect(node.style.getPropertyValue("--zoom")).toBe("");
    }
  });

  it("uses §8's verbatim counter transform", () => {
    const css = createTokenLayer(TINY4).element.querySelector("style")?.textContent ?? "";
    expect(css.replace(/\s+/g, " ")).toContain(
      "transform: translate3d(var(--x), var(--y), 0) " +
        "rotateX(calc(-1 * var(--tilt))) scale(calc(1 / var(--zoom)));",
    );
  });

  it("renders TROOPS_UNKNOWN as ? on a one-digit chip", () => {
    const layer = createTokenLayer(TINY4);
    layer.paint(paintOf({ troops: [TROOPS_UNKNOWN, 7, 12, 140] }), CAM);
    const numerals = Array.from(
      layer.element.querySelectorAll<HTMLElement>(".troops"),
      (n) => n.textContent,
    );
    expect(numerals).toEqual(["?", "7", "12", "140"]);
    const chips = layer.element.querySelectorAll(".chip-holder");
    expect(chips[0]?.innerHTML).toContain("<circle");
    expect(chips[2]?.innerHTML).toContain("<circle");
    // 140 is three digits, so that one and only that one is a stadium.
    expect(chips[3]?.innerHTML).toContain('rx="19"');
    expect(chips[3]?.innerHTML).toContain("<rect");
  });

  it("leaves the numeral BLANK on a 0-troop tile — the R62/R63 conquest moment", () => {
    // A conquered territory is owned with 0 armies until its MOVE_IN lands, and
    // the board paints that step. "0" is not a troop count the game ever shows.
    const layer = createTokenLayer(TINY4);
    layer.paint(paintOf({ troops: [0, 1, 2, 3] }), CAM);
    const numerals = Array.from(
      layer.element.querySelectorAll<HTMLElement>(".troops"),
      (n) => n.textContent,
    );
    expect(numerals).toEqual(["", "1", "2", "3"]);
    // The chip itself stays: the tile is owned, it is only waiting for armies.
    expect(layer.element.querySelectorAll(".chip-holder")[0]?.innerHTML).toContain("<circle");
  });

  it("repaints the numeral the moment the armies land", () => {
    const layer = createTokenLayer(TINY4);
    layer.paint(paintOf({ troops: [0, 1, 2, 3] }), CAM);
    layer.paint(paintOf({ troops: [4, 1, 2, 3] }), CAM);
    const numerals = Array.from(
      layer.element.querySelectorAll<HTMLElement>(".troops"),
      (n) => n.textContent,
    );
    expect(numerals).toEqual(["4", "1", "2", "3"]);
  });

  it("re-cuts the chip only when the digit count or the radius changes", () => {
    const layer = createTokenLayer(TINY4);
    layer.paint(paintOf({ troops: [9, 1, 1, 1] }), CAM);
    const chip = layer.element.querySelector('.token[data-token="0"] .chip-holder');
    const svg = chip?.firstElementChild;
    layer.paint(paintOf({ troops: [8, 1, 1, 1] }), CAM);
    expect(chip?.firstElementChild).toBe(svg); // 9 → 8 is a text swap, not a rebuild
    layer.paint(paintOf({ troops: [100, 1, 1, 1] }), CAM);
    expect(chip?.firstElementChild).not.toBe(svg);
    expect(chip?.innerHTML).toContain('width="60"');
  });

  it("mirrors the owner onto the token and the label, and flags the selection", () => {
    const layer = createTokenLayer(TINY4);
    layer.paint(paintOf({ owners: ["red", "green", "neutral", "unknown"], selected: 1 }), CAM);
    const owner = (sel: string) => layer.element.querySelector(sel)?.getAttribute("data-owner");
    expect(owner('.token[data-token="0"]')).toBe("red");
    expect(owner('.label[data-label="0"]')).toBe("red");
    expect(owner('.token[data-token="3"]')).toBe("unknown");
    expect(layer.element.querySelector('.token[data-token="1"]')?.getAttribute("data-selected")).toBe("1");
    layer.paint(paintOf({ owners: ["red", "green", "neutral", "unknown"], selected: null }), CAM);
    expect(layer.element.querySelector('.token[data-token="1"]')?.hasAttribute("data-selected")).toBe(false);
  });

  it("hides labels globally and per territory", () => {
    const layer = createTokenLayer(TINY4);
    layer.paint(paintOf({ showLabels: false }), CAM);
    expect(layer.element.getAttribute("data-labels")).toBe("0");
    layer.paint(paintOf(), CAM);
    expect(layer.element.getAttribute("data-labels")).toBe("1");
    expect(layer.element.querySelector('.label[data-label="0"]')?.hasAttribute("data-hidden")).toBe(false);
    // Zoomed out past the 2,500 px² floor, every label goes.
    layer.paint(paintOf(), { ...CAM, zoom: 0.3 });
    for (const label of layer.element.querySelectorAll(".label")) {
      expect(label.getAttribute("data-hidden")).toBe("1");
    }
  });

  it("gives each colour its own face gradient, since stops resolve on the gradient", () => {
    const layer = createTokenLayer(TINY4);
    const css = layer.element.querySelector("style")?.textContent ?? "";
    expect(css).toMatch(/\.token\[data-owner="red"\] \{[^}]*--p-face: url\(#rtf\d+-red\)/);
    const stop = layer.element.querySelector('radialGradient[id$="-red"] stop');
    expect(stop?.getAttribute("style")).toBe("stop-color: var(--p-red-light)");
    expect(layer.element.querySelectorAll("radialGradient")).toHaveLength(9);
  });

  it("writes the plan's offset, hides a crowded label and reveals it on hover or selection", () => {
    const stacked = toMapDef({
      ...TINY4_FILE,
      territories: TINY4_FILE.territories.map((t) => ({
        ...t, tokenX: 105, tokenY: 76, labelX: 105, labelY: 102,
      })),
    });
    const layer = createTokenLayer(stacked);
    layer.paint({
      owners: stacked.territories.map(() => "none"),
      troops: stacked.territories.map(() => 1),
      selected: null,
      radius: 19,
      showLabels: true,
    }, CAM);
    const label = (i: number) => layer.element.querySelector<HTMLElement>(`.label[data-label="${i}"]`);
    expect(label(0)?.style.getPropertyValue("--label-dy")).toBe("12.0px");
    expect(label(3)?.getAttribute("data-crowded")).toBe("1");
    expect(label(3)?.hasAttribute("data-reveal")).toBe(false);

    layer.paint({
      owners: stacked.territories.map(() => "none"),
      troops: stacked.territories.map(() => 1),
      selected: null,
      radius: 19,
      showLabels: true,
      hovered: 3,
    }, CAM);
    expect(label(3)?.getAttribute("data-reveal")).toBe("1");
  });

  it("carries the label size on the layer, once, not per label", () => {
    const layer = createTokenLayer(TINY4);
    expect(layer.element.style.getPropertyValue("--label-font")).toBe(`${LABEL_FONT}px`);
    for (const text of layer.element.querySelectorAll<HTMLElement>(".label-text")) {
      expect(text.style.fontSize).toBe("");
    }
  });

  it("destroy detaches the layer and empties it", () => {
    const layer = createTokenLayer(TINY4);
    document.body.appendChild(layer.element);
    expect(document.querySelectorAll(".risk-tokens .token")).toHaveLength(4);
    layer.destroy();
    expect(document.querySelector(".risk-tokens")).toBeNull();
    expect(layer.element.children).toHaveLength(0);
  });
});
