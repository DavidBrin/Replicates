/**
 * A recording stand-in for `CanvasRenderingContext2D`.
 *
 * jsdom ships no canvas implementation at all — `getContext("2d")` returns
 * `null` — so the renderer cannot be exercised in a unit test without one of
 * two things: the `canvas` native package (a C++ build step, for a project
 * whose whole point is zero dependencies), or a fake. This is the fake.
 *
 * It records every method call and every property assignment in order, which
 * is enough to assert *structure*: that a posed skeleton emits fifteen
 * capsules, that the HUD applies a shear transform, that the rim pass runs
 * before the body pass. It deliberately does not attempt to rasterise
 * anything — pixels are verified by eye and by the Playwright capture, not
 * here.
 *
 * Lives outside a `*.test.ts` file on purpose: importing one test file from
 * another registers its suites twice.
 */

export interface RecordedCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

export interface MockContext extends CanvasRenderingContext2D {
  readonly calls: RecordedCall[];
}

const DEFAULT_PROPS: Record<string, unknown> = {
  fillStyle: "#000000",
  strokeStyle: "#000000",
  lineWidth: 1,
  lineCap: "butt",
  lineJoin: "miter",
  miterLimit: 10,
  globalAlpha: 1,
  globalCompositeOperation: "source-over",
  font: "10px sans-serif",
  textAlign: "start",
  textBaseline: "alphabetic",
  shadowColor: "rgba(0, 0, 0, 0)",
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  filter: "none",
  letterSpacing: "0px",
  imageSmoothingEnabled: true,
  imageSmoothingQuality: "low",
  lineDashOffset: 0,
};

function stubGradient(): CanvasGradient {
  return { addColorStop: () => {} } as unknown as CanvasGradient;
}

export function createMockContext(width = 1920, height = 1080): MockContext {
  const calls: RecordedCall[] = [];
  const props: Record<string, unknown> = {
    ...DEFAULT_PROPS,
    canvas: { width, height },
  };
  const bound = new Map<string, (...args: unknown[]) => unknown>();

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, key) {
      if (key === "calls") return calls;
      if (typeof key !== "string") return undefined;
      if (key in props) return props[key];

      let fn = bound.get(key);
      if (!fn) {
        fn = (...args: unknown[]): unknown => {
          calls.push({ method: key, args });
          switch (key) {
            case "measureText":
              // Enough of a TextMetrics for layout code that centres text.
              return {
                width: String(args[0] ?? "").length * 0.55 * numericFontSize(props.font),
                actualBoundingBoxAscent: numericFontSize(props.font) * 0.72,
                actualBoundingBoxDescent: numericFontSize(props.font) * 0.2,
                actualBoundingBoxLeft: 0,
                actualBoundingBoxRight: String(args[0] ?? "").length * 0.55 * numericFontSize(props.font),
              };
            case "createLinearGradient":
            case "createRadialGradient":
            case "createConicGradient":
              return stubGradient();
            case "createPattern":
              return null;
            case "getLineDash":
              return [];
            case "getTransform":
              return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
            case "isPointInPath":
            case "isPointInStroke":
              return false;
            default:
              return undefined;
          }
        };
        bound.set(key, fn);
      }
      return fn;
    },
    set(_target, key, value) {
      if (typeof key === "string") {
        props[key] = value;
        calls.push({ method: `set:${key}`, args: [value] });
      }
      return true;
    },
    has() {
      return true;
    },
  };

  return new Proxy({} as Record<string, unknown>, handler) as unknown as MockContext;
}

function numericFontSize(font: unknown): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(String(font ?? ""));
  return m ? Number(m[1]) : 10;
}

/* -------------------------------------------------------------- queries -- */

export function callsOf(ctx: MockContext, method: string): RecordedCall[] {
  return ctx.calls.filter((c) => c.method === method);
}

export function countOf(ctx: MockContext, method: string): number {
  return callsOf(ctx, method).length;
}

/** Every value assigned to a property, in order. */
export function assignmentsTo(ctx: MockContext, prop: string): unknown[] {
  return callsOf(ctx, `set:${prop}`).map((c) => c.args[0]);
}

/** Index of the first call to `method`, or -1. */
export function firstIndexOf(ctx: MockContext, method: string): number {
  return ctx.calls.findIndex((c) => c.method === method);
}

/**
 * How many capsules were emitted.
 *
 * `drawCapsule` is the only thing in `render/` that assigns `lineCap = "round"`,
 * and it assigns it on every call rather than hoisting it — precisely so that
 * counting the assignments counts the capsules. Anything else that strokes
 * picks "butt" or "square" explicitly.
 */
export function countCapsules(ctx: MockContext): number {
  return assignmentsTo(ctx, "lineCap").filter((v) => v === "round").length;
}
