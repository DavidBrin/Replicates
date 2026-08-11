import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  BLOCK_PX,
  ZOOM_LEVELS,
  gridPixelWidth,
  type GridDims,
  type ZoomLevel,
} from "@/domain/geometry";
import type { GridSnapshot, SnapshotClaim } from "@/domain/snapshot";
import {
  DEFAULT_THEME,
  hitTest,
  paintBase,
  paintOverlay,
  prepareContext,
  sizeCanvas,
  type GridContext,
  type OverlayState,
} from "@/components/grid/paint";

/* ------------------------------------------------------------- fake ctx -- */

/**
 * jsdom implements no canvas, so the tests paint into a recorder.
 *
 * Every op captures the drawing state that mattered at the moment of the call —
 * fill style, alpha, smoothing — because that ordering is precisely what the
 * assertions are about (a tile drawn before smoothing is disabled is a bug the
 * pixels would show and a call-count assertion would not).
 */
type Op =
  | { readonly op: "transform"; readonly a: number; readonly d: number }
  | { readonly op: "clear"; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | {
      readonly op: "fill";
      readonly style: string;
      readonly alpha: number;
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
    }
  | {
      readonly op: "stroke";
      readonly style: string;
      readonly lineWidth: number;
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
    }
  | {
      readonly op: "image";
      readonly image: CanvasImageSource;
      readonly smoothing: boolean;
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
    };

function createFakeContext(): { ctx: GridContext; ops: Op[] } {
  const ops: Op[] = [];
  const ctx: GridContext = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    setTransform(a, _b, _c, d) {
      ops.push({ op: "transform", a, d });
    },
    clearRect(x, y, w, h) {
      ops.push({ op: "clear", x, y, w, h });
    },
    fillRect(x, y, w, h) {
      ops.push({
        op: "fill",
        style: String(ctx.fillStyle),
        alpha: ctx.globalAlpha,
        x,
        y,
        w,
        h,
      });
    },
    strokeRect(x, y, w, h) {
      ops.push({
        op: "stroke",
        style: String(ctx.strokeStyle),
        lineWidth: ctx.lineWidth,
        x,
        y,
        w,
        h,
      });
    },
    drawImage(image, x, y, w, h) {
      ops.push({
        op: "image",
        image,
        smoothing: ctx.imageSmoothingEnabled,
        x,
        y,
        w,
        h,
      });
    },
  };
  return { ctx, ops };
}

/* -------------------------------------------------------------- helpers -- */

function claim(over: Partial<SnapshotClaim> = {}): SnapshotClaim {
  return {
    id: "c1",
    rect: { bx: 1, by: 2, bw: 2, bh: 1 },
    caption: "hello",
    colour: "#ff0000",
    tile: null,
    ownerName: "Ada",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function snapshotOf(
  wBlocks: number,
  hBlocks: number,
  claims: readonly SnapshotClaim[] = [],
): GridSnapshot {
  return {
    slug: "the-wall",
    title: "The Wall",
    kind: "flagship",
    size: "full",
    wBlocks,
    hBlocks,
    totalBlocks: wBlocks * hBlocks,
    soldBlocks: claims.reduce((n, c) => n + c.rect.bw * c.rect.bh, 0),
    claims,
    holds: [],
    takenAt: "2026-01-01T00:00:00.000Z",
  };
}

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

const fills = (ops: readonly Op[]) => ops.filter((o) => o.op === "fill");

/* ----------------------------------------------------------- paintBase --- */

describe("paintBase", () => {
  it("lays a two-tone checker of exactly one square per block", () => {
    const { ctx, ops } = createFakeContext();
    paintBase(ctx, snapshotOf(4, 3), new Map(), DEFAULT_THEME);

    const painted = fills(ops);
    expect(painted[0]).toMatchObject({
      style: DEFAULT_THEME.emptyA,
      x: 0,
      y: 0,
      w: 12,
      h: 9,
    });

    const dark = painted.slice(1);
    expect(dark).toHaveLength(6); // half of 4 x 3, alternating
    expect(dark.every((f) => f.style === DEFAULT_THEME.emptyB)).toBe(true);
    expect(dark.every((f) => f.w === BLOCK_PX && f.h === BLOCK_PX)).toBe(true);
    expect(dark.map((f) => `${f.x},${f.y}`)).toEqual([
      "3,0",
      "9,0",
      "0,3",
      "6,3",
      "3,6",
      "9,6",
    ]);
  });

  it("fills a claim at its exact pixel rectangle", () => {
    const { ctx, ops } = createFakeContext();
    paintBase(
      ctx,
      snapshotOf(4, 3, [claim({ rect: { bx: 1, by: 2, bw: 2, bh: 1 } })]),
      new Map(),
      DEFAULT_THEME,
    );

    const claimFill = fills(ops).at(-1);
    expect(claimFill).toMatchObject({
      style: "#ff0000",
      alpha: 1,
      x: 3,
      y: 6,
      w: 6,
      h: 3,
    });
  });

  it("disables smoothing before drawing a tile, and draws it at the claim's size", () => {
    const { ctx, ops } = createFakeContext();
    const image = new Image();
    paintBase(
      ctx,
      snapshotOf(4, 3, [claim({ tile: "data:image/png;base64,AAA" })]),
      new Map([["c1", image]]),
      DEFAULT_THEME,
    );

    const drawn = ops.filter((o) => o.op === "image");
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({ smoothing: false, x: 3, y: 6, w: 6, h: 3 });
    // The colour goes down first, so a transparent PNG still reads as sold.
    const claimFillIndex = ops.findIndex((o) => o.op === "fill" && o.style === "#ff0000");
    expect(claimFillIndex).toBeLessThan(ops.indexOf(drawn[0]));
  });

  it("draws the solid colour and carries on when a tile never decoded", () => {
    const { ctx, ops } = createFakeContext();
    const good = new Image();
    paintBase(
      ctx,
      snapshotOf(8, 8, [
        claim({ id: "broken", colour: "#00ff00", tile: "data:image/png;base64,zzz" }),
        claim({
          id: "fine",
          colour: "#0000ff",
          rect: { bx: 4, by: 4, bw: 1, bh: 1 },
          tile: "data:image/png;base64,AAA",
        }),
      ]),
      new Map([["fine", good]]), // "broken" failed to decode and is simply absent
      DEFAULT_THEME,
    );

    expect(fills(ops).some((f) => f.style === "#00ff00")).toBe(true);
    const drawn = ops.filter((o) => o.op === "image");
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({ x: 12, y: 12, w: 3, h: 3 });
  });
});

/* -------------------------------------------------------- paintOverlay --- */

describe("paintOverlay", () => {
  const dims: GridDims = { wBlocks: 10, hBlocks: 10 };
  const base: OverlayState = {
    zoom: 1,
    hover: null,
    cursor: null,
    selection: null,
    blocked: false,
    hoveredClaim: null,
    holds: [],
  };

  it("clears the whole layer before drawing", () => {
    const { ctx, ops } = createFakeContext();
    paintOverlay(ctx, base, dims, DEFAULT_THEME);
    expect(ops[0]).toEqual({ op: "clear", x: 0, y: 0, w: 30, h: 30 });
  });

  it("tints holds, highlights the hovered block and outlines the hovered claim", () => {
    const { ctx, ops } = createFakeContext();
    paintOverlay(
      ctx,
      {
        ...base,
        hover: { bx: 2, by: 3 },
        hoveredClaim: { bx: 2, by: 3, bw: 2, bh: 2 },
        holds: [{ bx: 0, by: 0, bw: 1, bh: 1 }],
      },
      dims,
      DEFAULT_THEME,
    );

    const hold = fills(ops).find((f) => f.style === DEFAULT_THEME.unavailable);
    expect(hold).toMatchObject({ x: 0, y: 0, w: 3, h: 3 });
    expect(hold?.alpha).toBeLessThan(1);

    const hover = fills(ops).find((f) => f.style === DEFAULT_THEME.select);
    expect(hover).toMatchObject({ x: 6, y: 9, w: 3, h: 3 });

    const outline = ops.find((o) => o.op === "stroke");
    expect(outline).toMatchObject({ style: DEFAULT_THEME.rule });
  });

  it("draws the selection in the select colour, and in the warning colour when blocked", () => {
    const selection = { bx: 1, by: 1, bw: 3, bh: 2 };

    const ok = createFakeContext();
    paintOverlay(ok.ctx, { ...base, selection }, dims, DEFAULT_THEME);
    const okStroke = ok.ops.find((o) => o.op === "stroke");
    expect(okStroke?.style).toBe(DEFAULT_THEME.select);

    const bad = createFakeContext();
    paintOverlay(bad.ctx, { ...base, selection, blocked: true }, dims, DEFAULT_THEME);
    const badStroke = bad.ops.find((o) => o.op === "stroke");
    expect(badStroke?.style).toBe(DEFAULT_THEME.unavailable);
    expect(
      bad.ops.some((o) => o.op === "fill" && o.style === DEFAULT_THEME.unavailable),
    ).toBe(true);
  });

  it("keeps outlines one CSS pixel wide at every zoom", () => {
    for (const zoom of ZOOM_LEVELS) {
      const { ctx, ops } = createFakeContext();
      paintOverlay(
        ctx,
        { ...base, zoom, selection: { bx: 0, by: 0, bw: 1, bh: 1 } },
        dims,
        DEFAULT_THEME,
      );
      const stroke = ops.find((o) => o.op === "stroke");
      // Units are grid pixels; the context is scaled by `zoom`, so 1/zoom units
      // land as one CSS pixel.
      expect(stroke?.lineWidth).toBeCloseTo(1 / zoom);
    }
  });
});

/* ------------------------------------------------------------- sizing ---- */

describe("sizeCanvas and prepareContext", () => {
  const dims: GridDims = { wBlocks: 400, hBlocks: 400 };

  it("sizes the backing store in device pixels and the box in CSS pixels", () => {
    const canvas = document.createElement("canvas");
    const sizing = sizeCanvas(canvas, dims, 2, 2);

    expect(sizing).toEqual({
      cssWidth: 2400,
      cssHeight: 2400,
      backingWidth: 4800,
      backingHeight: 4800,
    });
    expect(canvas.width).toBe(4800);
    expect(canvas.style.width).toBe("2400px");
  });

  it("keeps full resolution under a responsive downscale", () => {
    const canvas = document.createElement("canvas");
    const sizing = sizeCanvas(canvas, dims, 1, 2, 0.5);

    expect(sizing.cssWidth).toBe(600);
    expect(sizing.backingWidth).toBe(2400); // the bitmap is not thrown away
  });

  it("scales the context by zoom x dpr so paint code works in grid pixels", () => {
    const { ctx, ops } = createFakeContext();
    prepareContext(ctx, 4, 2);
    expect(ops[0]).toEqual({ op: "transform", a: 8, d: 8 });
  });
});

/* ------------------------------------------------------------ hitTest ---- */

describe("hitTest", () => {
  const dims: GridDims = { wBlocks: 400, hBlocks: 400 };
  const natural = gridPixelWidth(dims); // 1200

  it("maps the first and last pixel of a block to that block", () => {
    const rect = domRect(0, 0, natural, natural);
    expect(hitTest(0, 0, rect, dims, 1)).toEqual({ bx: 0, by: 0 });
    expect(hitTest(2.9, 0, rect, dims, 1)).toEqual({ bx: 0, by: 0 });
    expect(hitTest(3, 0, rect, dims, 1)).toEqual({ bx: 1, by: 0 });
    expect(hitTest(0, 3, rect, dims, 1)).toEqual({ bx: 0, by: 1 });
  });

  it("returns the last block at the last pixel of the grid, and null one past it", () => {
    const rect = domRect(0, 0, natural, natural);
    expect(hitTest(1199, 1199, rect, dims, 1)).toEqual({ bx: 399, by: 399 });
    expect(hitTest(1199.999, 1199.999, rect, dims, 1)).toEqual({ bx: 399, by: 399 });
    expect(hitTest(1200, 600, rect, dims, 1)).toBeNull();
    expect(hitTest(600, 1200, rect, dims, 1)).toBeNull();
  });

  it("returns null outside the grid, including above and left of it", () => {
    const rect = domRect(100, 50, natural, natural);
    expect(hitTest(99, 60, rect, dims, 1)).toBeNull();
    expect(hitTest(120, 49, rect, dims, 1)).toBeNull();
    expect(hitTest(5000, 5000, rect, dims, 1)).toBeNull();
    expect(hitTest(100, 50, rect, dims, 1)).toEqual({ bx: 0, by: 0 });
  });

  it("accounts for the element's offset on the page", () => {
    const rect = domRect(37, 11, natural, natural);
    expect(hitTest(37 + 3, 11 + 6, rect, dims, 1)).toEqual({ bx: 1, by: 2 });
  });

  it("divides by the zoomed block size at every zoom level", () => {
    for (const zoom of ZOOM_LEVELS) {
      const rect = domRect(0, 0, natural * zoom, natural * zoom);
      const blockCss = BLOCK_PX * zoom;
      expect(hitTest(0, 0, rect, dims, zoom)).toEqual({ bx: 0, by: 0 });
      expect(hitTest(blockCss - 0.001, 0, rect, dims, zoom)).toEqual({ bx: 0, by: 0 });
      expect(hitTest(blockCss, 0, rect, dims, zoom)).toEqual({ bx: 1, by: 0 });
      expect(hitTest(blockCss * 399.5, 0, rect, dims, zoom)).toEqual({
        bx: 399,
        by: 0,
      });
      expect(hitTest(natural * zoom, 0, rect, dims, zoom)).toBeNull();
    }
  });

  it("stays exact when the canvas is downscaled to fit a narrow screen", () => {
    // A 390px phone showing a 1200px grid: every block is 0.975 CSS pixels.
    const width = 390;
    const rect = domRect(0, 0, width, width);
    const scale = width / natural;

    expect(hitTest(0, 0, rect, dims, 1)).toEqual({ bx: 0, by: 0 });
    expect(hitTest(width - 0.001, width - 0.001, rect, dims, 1)).toEqual({
      bx: 399,
      by: 399,
    });
    expect(hitTest(width, 0, rect, dims, 1)).toBeNull();
    // Centre of block 200,150 in the downscaled box.
    expect(
      hitTest((200 * 3 + 1.5) * scale, (150 * 3 + 1.5) * scale, rect, dims, 1),
    ).toEqual({ bx: 200, by: 150 });
    // …and at 4x, where the box is still 390 wide but each block covers 4x more.
    const zoomed = domRect(0, 0, width, width);
    expect(hitTest(width / 2, width / 2, zoomed, dims, 4)).toEqual({
      bx: 200,
      by: 200,
    });
  });

  it("gives the same answer at devicePixelRatio 1 and 2", () => {
    // DPR changes the backing store, never the CSS box the client rect reports,
    // so a retina hit must land on the same block as a non-retina one.
    // The CSS box is fixed by geometry, not by the device: zoom 2 at half scale
    // is 1200 CSS pixels wide whatever the screen. Deriving the rect from that
    // constant rather than from `sizeCanvas` is the point — it is what fails if
    // DPR ever leaks out of the backing store and into the box.
    const cssBox = natural * 2 * 0.5;
    const results = [1, 2].map((dpr) => {
      const canvas = document.createElement("canvas");
      const sizing = sizeCanvas(canvas, dims, 2, dpr, 0.5);
      expect(sizing.cssWidth).toBe(cssBox);
      expect(canvas.width).toBe(Math.round(natural * 2 * dpr));

      const rect = domRect(0, 0, cssBox, cssBox);
      return {
        corner: hitTest(0, 0, rect, dims, 2),
        middle: hitTest(cssBox / 2, cssBox / 2, rect, dims, 2),
        last: hitTest(cssBox - 0.001, cssBox - 0.001, rect, dims, 2),
      };
    });
    expect(results[0]).toEqual(results[1]);
    expect(results[0].corner).toEqual({ bx: 0, by: 0 });
    expect(results[0].middle).toEqual({ bx: 200, by: 200 });
    expect(results[0].last).toEqual({ bx: 399, by: 399 });
  });

  it("returns null for a collapsed rect rather than dividing by zero", () => {
    expect(hitTest(10, 10, domRect(0, 0, 0, 0), dims, 1)).toBeNull();
  });

  it("round-trips the centre of any block at any zoom and any downscale", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: dims.wBlocks - 1 }),
        fc.integer({ min: 0, max: dims.hBlocks - 1 }),
        fc.constantFrom<ZoomLevel>(...ZOOM_LEVELS),
        fc.double({ min: 0.2, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -500, max: 500, noNaN: true, noDefaultInfinity: true }),
        (bx, by, zoom, cssScale, offset) => {
          const size = natural * zoom * cssScale;
          const rect = domRect(offset, offset, size, size);
          const centre = (b: number) => offset + (b * BLOCK_PX + BLOCK_PX / 2) * zoom * cssScale;
          expect(hitTest(centre(bx), centre(by), rect, dims, zoom)).toEqual({ bx, by });
        },
      ),
    );
  });
});
