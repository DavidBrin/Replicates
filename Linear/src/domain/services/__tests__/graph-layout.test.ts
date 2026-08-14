import { describe, expect, it } from "vitest";

import {
  DEFAULT_LAYOUT_OPTIONS,
  layoutGraph,
  type LayoutEdge,
  type LayoutOptions,
} from "@/domain/services/graph-layout";

function edge(from: string, to: string): LayoutEdge {
  return { from, to };
}

function layerOf(
  layout: ReturnType<typeof layoutGraph>,
  id: string,
): number | undefined {
  return layout.nodes.find((node) => node.id === id)?.layer;
}

type Segment = readonly [Point, Point];
interface Point {
  readonly x: number;
  readonly y: number;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Do two segments cross at a point interior to both?
 *
 * Strict signs on all four orientations, so segments that merely share an
 * endpoint — every pair of edges leaving the same node does — are not counted.
 */
function properlyIntersect([p1, p2]: Segment, [q1, q2]: Segment): boolean {
  const d1 = cross(p1, p2, q1);
  const d2 = cross(p1, p2, q2);
  const d3 = cross(q1, q2, p1);
  const d4 = cross(q1, q2, p2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Intersections among the polylines the renderer will actually draw. */
function drawnCrossings(layout: ReturnType<typeof layoutGraph>): number {
  const segments: Segment[] = [];
  for (const drawn of layout.edges) {
    for (let i = 1; i < drawn.points.length; i += 1) {
      segments.push([drawn.points[i - 1]!, drawn.points[i]!]);
    }
  }
  let count = 0;
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      if (properlyIntersect(segments[i]!, segments[j]!)) count += 1;
    }
  }
  return count;
}

describe("layoutGraph", () => {
  it("returns nothing for no nodes", () => {
    const layout = layoutGraph([], []);
    expect(layout.nodes).toEqual([]);
    expect(layout.width).toBe(0);
    expect(layout.height).toBe(0);
  });

  it("places a lone node in the first layer", () => {
    const layout = layoutGraph(["a"], []);
    expect(layout.nodes).toHaveLength(1);
    expect(layout.nodes[0]!.layer).toBe(0);
    expect(layout.layerCount).toBe(1);
  });

  it("puts a blocker to the left of what it blocks", () => {
    const layout = layoutGraph(["a", "b", "c"], [edge("a", "b"), edge("b", "c")]);
    expect(layerOf(layout, "a")).toBe(0);
    expect(layerOf(layout, "b")).toBe(1);
    expect(layerOf(layout, "c")).toBe(2);

    const [a, b] = ["a", "b"].map((id) =>
      layout.nodes.find((node) => node.id === id),
    );
    expect(a!.x).toBeLessThan(b!.x);
  });

  /**
   * The whole reason for longest-path layering rather than the shorter, prettier
   * alternatives: `c` must sit right of *both* its blockers, not right of the
   * nearest one.
   */
  it("puts a node right of its deepest blocker, not its nearest", () => {
    const layout = layoutGraph(
      ["a", "b", "c"],
      [edge("a", "b"), edge("b", "c"), edge("a", "c")],
    );
    expect(layerOf(layout, "a")).toBe(0);
    expect(layerOf(layout, "b")).toBe(1);
    expect(layerOf(layout, "c")).toBe(2);
  });

  it("keeps a diamond free of crossings", () => {
    const layout = layoutGraph(
      ["a", "b", "c", "d"],
      [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")],
    );
    expect(layout.crossings).toBe(0);
  });

  it("never overlaps two nodes in the same layer", () => {
    const layout = layoutGraph(
      ["root", "a", "b", "c", "d"],
      [
        edge("root", "a"),
        edge("root", "b"),
        edge("root", "c"),
        edge("root", "d"),
      ],
    );
    const second = layout.nodes
      .filter((node) => node.layer === 1)
      .sort((left, right) => left.y - right.y);
    expect(second).toHaveLength(4);
    for (let i = 1; i < second.length; i += 1) {
      const gap = second[i]!.y - (second[i - 1]!.y + second[i - 1]!.height);
      expect(gap).toBeGreaterThanOrEqual(DEFAULT_LAYOUT_OPTIONS.siblingGap - 1e-9);
    }
  });

  it("bends an edge that spans more than one layer", () => {
    const layout = layoutGraph(
      ["a", "b", "c", "d"],
      [edge("a", "b"), edge("b", "c"), edge("c", "d"), edge("a", "d")],
    );
    const long = layout.edges.find((e) => e.from === "a" && e.to === "d");
    // Two endpoints plus a waypoint per layer skipped.
    expect(long!.points.length).toBeGreaterThan(2);
  });

  describe("edges that cannot be drawn", () => {
    it("drops a self-edge", () => {
      const layout = layoutGraph(["a"], [edge("a", "a")]);
      expect(layout.edges).toEqual([]);
    });

    it("drops an edge naming an unknown node", () => {
      const layout = layoutGraph(["a"], [edge("a", "ghost")]);
      expect(layout.edges).toEqual([]);
      expect(layout.nodes).toHaveLength(1);
    });

    it("draws a duplicated edge once", () => {
      const layout = layoutGraph(["a", "b"], [edge("a", "b"), edge("a", "b")]);
      expect(layout.edges).toHaveLength(1);
    });
  });

  describe("cycles", () => {
    it("lays out a cycle rather than hanging or dropping a node", () => {
      const layout = layoutGraph(
        ["a", "b", "c"],
        [edge("a", "b"), edge("b", "c"), edge("c", "a")],
      );
      expect(layout.nodes.map((node) => node.id).sort()).toEqual(["a", "b", "c"]);
      expect(layout.edges).toHaveLength(3);
      for (const node of layout.nodes) {
        expect(Number.isFinite(node.x)).toBe(true);
        expect(Number.isFinite(node.y)).toBe(true);
      }
    });

    it("reverses exactly the edge that closes the cycle", () => {
      const layout = layoutGraph(
        ["a", "b", "c"],
        [edge("a", "b"), edge("b", "c"), edge("c", "a")],
      );
      const reversed = layout.edges.filter((e) => e.reversed);
      expect(reversed).toHaveLength(1);
      expect(reversed[0]!.from).toBe("c");
      expect(reversed[0]!.to).toBe("a");
    });

    /**
     * The arrowhead is drawn at the last point, always. A reversed edge is the
     * one case where "last point" and "rightmost point" disagree, and getting
     * this backwards would draw the deadlock pointing the wrong way — which
     * would be worse than not drawing it at all.
     */
    it("emits a reversed edge in semantic order, running backwards", () => {
      const layout = layoutGraph(
        ["a", "b", "c"],
        [edge("a", "b"), edge("b", "c"), edge("c", "a")],
      );
      const back = layout.edges.find((e) => e.reversed)!;
      const first = back.points[0]!;
      const last = back.points[back.points.length - 1]!;
      expect(first.x).toBeGreaterThan(last.x);

      const forward = layout.edges.find((e) => !e.reversed)!;
      expect(forward.points[0]!.x).toBeLessThan(
        forward.points[forward.points.length - 1]!.x,
      );
    });
  });

  /**
   * Independent chains are laid out on their own and then stacked.
   *
   * Before this, four unrelated pairs shared the same layers: crossing
   * reduction ordered them against each other for no reason, and one chain's
   * long edge pushed a three-hundred-pixel hole into the next. The seeded demo
   * workspace is exactly this shape, which is how it was found — every test
   * passed and the page looked broken.
   */
  describe("independent chains", () => {
    const four = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const pairs = [edge("a", "b"), edge("c", "d"), edge("e", "f"), edge("g", "h")];

    it("stacks them without leaving a hole", () => {
      const layout = layoutGraph(four, pairs);
      const blockers = layout.nodes
        .filter((node) => node.layer === 0)
        .sort((left, right) => left.y - right.y);
      expect(blockers).toHaveLength(4);

      for (let i = 1; i < blockers.length; i += 1) {
        const gap = blockers[i]!.y - (blockers[i - 1]!.y + blockers[i - 1]!.height);
        expect(gap).toBeCloseTo(DEFAULT_LAYOUT_OPTIONS.componentGap, 6);
      }
    });

    it("gives every chain the same left edge", () => {
      const layout = layoutGraph(four, pairs);
      const xs = new Set(
        layout.nodes.filter((node) => node.layer === 0).map((node) => node.x),
      );
      expect(xs.size).toBe(1);
    });

    /**
     * The case that motivated this: one chain has a long edge, which needs
     * vertical room *within* that chain. That room must not become a gap in
     * the chain next to it.
     */
    it("does not let one chain's long edge space out another", () => {
      const layout = layoutGraph(
        ["a", "b", "c", "x", "y"],
        [edge("a", "b"), edge("b", "c"), edge("a", "c"), edge("x", "y")],
      );
      const x = layout.nodes.find((node) => node.id === "x")!;
      const y = layout.nodes.find((node) => node.id === "y")!;
      // The unrelated pair is still a tidy pair: same row, adjacent layers.
      expect(y.y).toBeCloseTo(x.y, 6);
      expect(y.layer).toBe(1);
    });

    it("keeps each chain's edges with it", () => {
      const layout = layoutGraph(four, pairs);
      expect(layout.edges).toHaveLength(4);
      for (const drawn of layout.edges) {
        const from = layout.nodes.find((node) => node.id === drawn.from)!;
        const to = layout.nodes.find((node) => node.id === drawn.to)!;
        expect(from.x).toBeLessThan(to.x);
        expect(drawn.points[0]!.y).toBeCloseTo(
          from.y + from.height / 2,
          6,
        );
      }
    });
  });

  /**
   * The canvas is sized to what is drawn — boxes *and* the lines between them.
   *
   * The origin used to come from the minimum `y` over the working node set,
   * which includes the invisible waypoints a long edge is routed through. A
   * waypoint above the first card therefore set the top of the canvas from
   * something nobody can see, and the page rendered with a two-hundred-and-fifty
   * pixel hole above the graph. Every unit test passed; it took looking at it.
   */
  describe("the canvas bounds", () => {
    const fixtures: readonly (readonly [readonly string[], readonly LayoutEdge[]])[] =
      [
        [["a", "b"], [edge("a", "b")]],
        [
          ["a", "b", "c", "d"],
          [edge("a", "b"), edge("b", "c"), edge("c", "d"), edge("a", "d")],
        ],
        // The shape that showed the bug: a long edge and a cycle together.
        [
          ["a", "b", "c", "d", "e"],
          [
            edge("a", "b"),
            edge("a", "c"),
            edge("b", "c"),
            edge("d", "e"),
            edge("e", "c"),
            edge("c", "a"),
          ],
        ],
        [
          ["a", "b", "c", "d"],
          [edge("a", "b"), edge("c", "d")],
        ],
        /**
         * The seeded workspace's own shape, node order and all — four chains,
         * a long edge, and a cycle.
         *
         * This is the fixture where an edge bend really does sit above every
         * card, so it is the one that holds the *edge points* half of the
         * bounds: measure only the boxes and this graph's topmost drawn thing
         * lands 72px above the canvas, clipped. The tidy fixtures above cannot
         * show that, and the node order matters — it decides which edge the
         * depth-first search picks to reverse, and therefore where the bend
         * goes.
         */
        [
          ["e1", "e2", "e3", "e5", "e9", "e11", "e13", "e19", "e20", "e22", "d3"],
          [
            edge("e11", "e1"),
            edge("e11", "e9"),
            edge("e1", "e9"),
            edge("e2", "e20"),
            edge("e20", "e9"),
            edge("e13", "e19"),
            edge("e22", "e3"),
            edge("d3", "e5"),
            edge("e9", "e11"),
          ],
        ],
      ];

    function extent(layout: ReturnType<typeof layoutGraph>) {
      const xs = [
        ...layout.nodes.flatMap((node) => [node.x, node.x + node.width]),
        ...layout.edges.flatMap((drawn) => drawn.points.map((p) => p.x)),
      ];
      const ys = [
        ...layout.nodes.flatMap((node) => [node.y, node.y + node.height]),
        ...layout.edges.flatMap((drawn) => drawn.points.map((p) => p.y)),
      ];
      return {
        top: Math.min(...ys),
        left: Math.min(...xs),
        bottom: Math.max(...ys),
        right: Math.max(...xs),
      };
    }

    it.each(fixtures.map((f, i) => [i, f] as const))(
      "leaves exactly the padding above and left of the drawing (%i)",
      (_index, [ids, edges]) => {
        const layout = layoutGraph(ids, edges);
        const { top, left } = extent(layout);
        expect(top).toBeCloseTo(DEFAULT_LAYOUT_OPTIONS.padding, 6);
        expect(left).toBeCloseTo(DEFAULT_LAYOUT_OPTIONS.padding, 6);
      },
    );

    it.each(fixtures.map((f, i) => [i, f] as const))(
      "sizes the canvas to the drawing plus the padding (%i)",
      (_index, [ids, edges]) => {
        const layout = layoutGraph(ids, edges);
        const { bottom, right } = extent(layout);
        expect(layout.height).toBeCloseTo(
          bottom + DEFAULT_LAYOUT_OPTIONS.padding,
          6,
        );
        expect(layout.width).toBeGreaterThanOrEqual(
          right + DEFAULT_LAYOUT_OPTIONS.padding - 1e-6,
        );
      },
    );
  });

  describe("determinism and tuning", () => {
    const nodes = ["a", "b", "c", "d", "e", "f"];
    const edges = [
      edge("a", "d"),
      edge("b", "d"),
      edge("b", "e"),
      edge("c", "e"),
      edge("c", "f"),
      edge("a", "f"),
    ];

    it("produces byte-identical output for identical input", () => {
      expect(JSON.stringify(layoutGraph(nodes, edges))).toBe(
        JSON.stringify(layoutGraph(nodes, edges)),
      );
    });

    /**
     * The median heuristic is not monotone — a later sweep can be worse than an
     * earlier one. Keeping a snapshot of the best ordering is what turns
     * `sweeps` into a knob that only ever helps, and this is the assertion that
     * would fail if the snapshot were dropped.
     */
    it("never gets worse with more sweeps", () => {
      let previous = Number.POSITIVE_INFINITY;
      for (const sweeps of [0, 1, 2, 4, 8, 16]) {
        const layout = layoutGraph(nodes, edges, {
          ...DEFAULT_LAYOUT_OPTIONS,
          sweeps,
        });
        expect(layout.crossings).toBeLessThanOrEqual(previous);
        previous = layout.crossings;
      }
    });

    /**
     * A crossed graph really does come out untangled — checked in the drawn
     * polylines, not only in the algorithm's own tally.
     *
     * The two measures agree here because this fixture spans a single layer
     * boundary and so has no long edges. They do *not* agree in general: a long
     * edge is anchored at its endpoints' box edges but passes through its
     * waypoints' centres, so its segments cover a narrower x-range than a
     * one-layer edge in the same band and the geometry can differ from the
     * ordering count either way. Reaching for this as a universal oracle was
     * tempting and would have been wrong.
     */
    it("untangles a crossed graph, in the geometry and not just the tally", () => {
      const tangled = ["a1", "a2", "a3", "a4", "b1", "b2", "b3", "b4"];
      // `a2 → b2` is what holds this together as a single component. Without
      // it the graph is two independent halves, which `layoutGraph` now
      // separates before laying out — and separating them removes most of the
      // crossings on its own, leaving nothing for this test to measure.
      const crossed = [
        edge("a1", "b4"),
        edge("a2", "b3"),
        edge("a3", "b2"),
        edge("a4", "b1"),
        edge("a1", "b3"),
        edge("a4", "b2"),
        edge("a2", "b2"),
      ];

      const before = layoutGraph(tangled, crossed, {
        ...DEFAULT_LAYOUT_OPTIONS,
        sweeps: 0,
      });
      const after = layoutGraph(tangled, crossed, {
        ...DEFAULT_LAYOUT_OPTIONS,
        sweeps: 8,
      });

      expect(before.crossings).toBeGreaterThan(5);
      expect(after.crossings).toBe(0);
      expect(drawnCrossings(before)).toBeGreaterThan(0);
      expect(drawnCrossings(after)).toBe(0);
    });

    /**
     * A graph whose *last* sweep is worse than its best one.
     *
     * It was found by searching random DAGs for a case where the drawn geometry
     * disagreed with the reported count, because the tidy fixtures above all
     * happen to end on their best ordering and so cannot tell the two apart.
     * Without the snapshot-and-restore in `minimizeCrossings`, this graph is
     * laid out with the final sweep's ordering and the count goes up between
     * eight sweeps and sixteen — a tuning knob that makes the drawing worse.
     */
    it("keeps the best ordering on a graph whose last sweep is worse", () => {
      const ids = Array.from({ length: 13 }, (_, i) => `n${i}`);
      const pairs: readonly (readonly [number, number])[] = [
        [0, 9], [0, 10], [1, 2], [1, 4], [1, 5], [1, 7], [1, 9], [1, 12],
        [2, 5], [2, 6], [2, 8], [2, 12], [3, 4], [3, 9], [4, 5], [4, 10],
        [4, 12], [5, 7], [5, 8], [5, 9], [5, 11], [6, 8], [6, 11], [7, 9],
        [7, 12], [9, 10], [9, 11], [10, 12],
      ];
      const tricky = pairs.map(([from, to]) => edge(`n${from}`, `n${to}`));

      let previous = Number.POSITIVE_INFINITY;
      for (const sweeps of [1, 2, 4, 8, 16, 32]) {
        const layout = layoutGraph(ids, tricky, {
          ...DEFAULT_LAYOUT_OPTIONS,
          sweeps,
        });
        expect(layout.crossings).toBeLessThanOrEqual(previous);
        previous = layout.crossings;
      }
    });

    it("takes every dimension from the options", () => {
      const options: LayoutOptions = {
        ...DEFAULT_LAYOUT_OPTIONS,
        nodeWidth: 100,
        layerGap: 50,
        padding: 10,
      };
      const layout = layoutGraph(["a", "b"], [edge("a", "b")], options);
      const a = layout.nodes.find((node) => node.id === "a")!;
      const b = layout.nodes.find((node) => node.id === "b")!;
      expect(a.x).toBe(10);
      expect(a.width).toBe(100);
      expect(b.x).toBe(10 + 100 + 50);
    });
  });
});
