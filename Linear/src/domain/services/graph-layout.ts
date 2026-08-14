/**
 * Layered graph layout — the Sugiyama framework, as a pure function.
 *
 * Given nodes and directed edges it answers where each node goes and what path
 * each edge takes. It knows nothing about issues, SVG, React or the DOM: the
 * input is `string` ids and the output is numbers. That is what makes the
 * interesting half of this feature testable without a browser — the crossing
 * count, the layer assignment and the cycle handling are all assertions against
 * a returned object.
 *
 * ## The five phases
 *
 * Sugiyama's method is the standard for drawing directed graphs where direction
 * carries meaning, and every serious library — dagre, ELK, d3-dag — is an
 * implementation of it. The phases, and what this file chose for each:
 *
 * | Phase | Choice | Why |
 * |---|---|---|
 * | Cycle removal | DFS back-edge reversal | Linear time, and the reversed set is exactly the report the UI wants |
 * | Layer assignment | Longest path | A blocker is *always* strictly left of what it blocks, which is the promise the view makes |
 * | Crossing reduction | Median heuristic, alternating sweeps, keep the best | The classic; close to optimal on sparse graphs at a fraction of the cost |
 * | Coordinate assignment | Priority method (Sander) | Straightens long edges without Brandes–Köpf's four-pass machinery — see below |
 * | Edge routing | Polyline through dummy centres | Bends land exactly where the layout reserved space for them |
 *
 * ## Why the priority method rather than Brandes–Köpf
 *
 * Brandes–Köpf produces better coordinates and costs about four times the code:
 * four independent alignment passes (up/down × left/right), a conflict-marking
 * step for inner segments, and a final median-of-four combination. Every one of
 * those is a place to be subtly wrong in a way that still *looks* like a graph,
 * which is the worst failure mode a layout can have — it does not throw, it
 * just quietly draws something misleading.
 *
 * The priority method gets most of the benefit from one idea: dummy nodes (the
 * waypoints of a long edge) outrank real nodes, so when positions compete the
 * long edge stays straight and the real node moves. Sparse dependency graphs
 * are where that heuristic is at its best, and a wrong answer here is visible
 * in a rendered test rather than hidden in an alignment table.
 *
 * ## Nothing here is a magic number
 *
 * Every dimension and every iteration count arrives in {@link LayoutOptions}.
 * The renderer owns the sizes because the renderer is what knows how big an
 * issue card is; changing the card does not mean hunting through this file.
 */

/* ================================================================ input == */

/** A directed edge. `from` is drawn to the left of `to`, arrow at `to`. */
export interface LayoutEdge {
  readonly from: string;
  readonly to: string;
}

export interface LayoutOptions {
  /** Node box width, in user units. */
  readonly nodeWidth: number;
  /** Node box height, in user units. */
  readonly nodeHeight: number;
  /** Horizontal space between one layer's right edge and the next one's left. */
  readonly layerGap: number;
  /** Minimum vertical space between two boxes in the same layer. */
  readonly siblingGap: number;
  /**
   * Vertical space between two independent chains.
   *
   * Larger than {@link siblingGap} on purpose: the space is what says these
   * two groups have nothing to do with each other.
   */
  readonly componentGap: number;
  /**
   * Alternating median sweeps. Each sweep re-sorts every layer; the ordering
   * with the fewest crossings across every sweep is the one kept, so raising
   * this can only improve the result — it can never make it worse.
   */
  readonly sweeps: number;
  /** Passes of the coordinate-assignment relaxation. */
  readonly coordinatePasses: number;
  /** Blank space around the whole drawing. */
  readonly padding: number;
}

/**
 * Sizes that suit the issue card in `dependency-graph.tsx`, and iteration
 * counts that finish in single-digit milliseconds at the node cap.
 */
export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = Object.freeze({
  nodeWidth: 224,
  nodeHeight: 60,
  layerGap: 88,
  siblingGap: 18,
  componentGap: 44,
  sweeps: 8,
  coordinatePasses: 4,
  padding: 28,
});

/* =============================================================== output == */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface PositionedNode {
  readonly id: string;
  /** Top-left corner. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** 0 is the leftmost layer — issues that nothing blocks. */
  readonly layer: number;
}

export interface PositionedEdge {
  readonly from: string;
  readonly to: string;
  /**
   * Always in semantic order: `points[0]` touches `from`, the last point
   * touches `to`, and the arrowhead belongs at the last point. An edge that had
   * to be reversed to break a cycle is emitted in this same order, which is why
   * it visibly runs backwards across the drawing — that *is* the finding.
   */
  readonly points: readonly Point[];
  /** True when this edge was reversed to make the graph acyclic. */
  readonly reversed: boolean;
}

export interface GraphLayout {
  readonly nodes: readonly PositionedNode[];
  readonly edges: readonly PositionedEdge[];
  readonly width: number;
  readonly height: number;
  readonly layerCount: number;
  /** Edge crossings in the final ordering. Reported so tests can assert on it. */
  readonly crossings: number;
}

const EMPTY_LAYOUT: GraphLayout = Object.freeze({
  nodes: [],
  edges: [],
  width: 0,
  height: 0,
  layerCount: 0,
  crossings: 0,
});

/* ========================================================== the machine == */

/**
 * A node in the working graph — real or a waypoint invented for a long edge.
 *
 * Dummies are what let phases 3–5 treat every edge as though it spanned exactly
 * one layer. Without them a five-layer edge is invisible to crossing reduction,
 * and it then routes straight through whatever boxes happen to be in the way.
 */
interface WorkNode {
  readonly id: string;
  readonly dummy: boolean;
  readonly layer: number;
  y: number;
  /** Higher wins a position dispute. Dummies outrank every real node. */
  priority: number;
}

/**
 * An edge in the working graph.
 *
 * `reversed` is carried on the edge itself rather than looked up in a set of
 * `"from to"` strings. The string version worked and was one id containing a
 * space away from silently mismatching, which would have shown up as an
 * arrowhead on the wrong end rather than as an error.
 */
interface WorkEdge {
  readonly from: string;
  readonly to: string;
  readonly reversed: boolean;
}

/** One edge and the waypoints invented for it, left to right. */
interface Chain {
  readonly edge: WorkEdge;
  readonly waypoints: readonly string[];
}

/**
 * Lay out a graph.
 *
 * ## Independent chains are laid out independently, then stacked
 *
 * A dependency graph is almost never one connected shape — a team has a
 * handful of unrelated chains — and running them through one pass makes them
 * fight. They share layers, so crossing reduction orders them against each
 * other for no reason, and coordinate assignment propagates one chain's spacing
 * into the next: on the seeded workspace, a single long edge in the first chain
 * opened a three-hundred-pixel hole above the second, which reads as a rendering
 * failure rather than as a gap.
 *
 * Splitting first is what `dagre` and ELK both do, and it is strictly better
 * here: each chain is laid out as though it were the only thing on screen, and
 * the packing afterwards is one addition per node.
 */
export function layoutGraph(
  nodeIds: readonly string[],
  edges: readonly LayoutEdge[],
  options: LayoutOptions = DEFAULT_LAYOUT_OPTIONS,
): GraphLayout {
  const ids = dedupe(nodeIds);
  if (ids.length === 0) return EMPTY_LAYOUT;

  const clean = cleanEdges(edges, new Set(ids));
  const components = splitComponents(ids, clean);
  if (components.length === 1) return layoutComponent(ids, clean, options);

  return stack(
    components.map((component) =>
      layoutComponent(component.ids, component.edges, options),
    ),
    options,
  );
}

/**
 * Weakly connected components, in input order.
 *
 * *Weakly*: direction is irrelevant to whether two issues belong on the same
 * canvas together. `A blocks B` and `B blocks A` put A and B in one group
 * either way.
 */
function splitComponents(
  ids: readonly string[],
  edges: readonly WorkEdge[],
): { ids: string[]; edges: WorkEdge[] }[] {
  const neighbours = new Map<string, string[]>();
  for (const id of ids) neighbours.set(id, []);
  for (const edge of edges) {
    bucket(neighbours, edge.from).push(edge.to);
    bucket(neighbours, edge.to).push(edge.from);
  }

  const group = new Map<string, number>();
  const groups: string[][] = [];
  for (const root of ids) {
    if (group.has(root)) continue;
    const index = groups.length;
    const members: string[] = [];
    const queue = [root];
    group.set(root, index);
    let head = 0;
    while (head < queue.length) {
      const id = queue[head]!;
      head += 1;
      members.push(id);
      for (const next of neighbours.get(id) ?? []) {
        if (group.has(next)) continue;
        group.set(next, index);
        queue.push(next);
      }
    }
    // Input order within the group, so the layout is stable regardless of the
    // order the traversal happened to reach the members in.
    const rank = new Map(ids.map((id, position) => [id, position]));
    members.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
    groups.push(members);
  }

  return groups.map((members, index) => ({
    ids: members,
    edges: edges.filter((edge) => group.get(edge.from) === index),
  }));
}

/**
 * Stack finished layouts one above another.
 *
 * Each already carries `padding` on every side, so the join subtracts one
 * padding from each side of the seam and inserts `componentGap` instead —
 * otherwise the space between two chains would be whatever the padding happened
 * to be, twice, and would change every time the padding did.
 */
function stack(
  layouts: readonly GraphLayout[],
  options: LayoutOptions,
): GraphLayout {
  const nodes: PositionedNode[] = [];
  const edges: PositionedEdge[] = [];
  let offset = 0;
  let width = 0;
  let layerCount = 0;
  let crossings = 0;

  for (const layout of layouts) {
    for (const node of layout.nodes) nodes.push({ ...node, y: node.y + offset });
    for (const edge of layout.edges) {
      edges.push({
        ...edge,
        points: edge.points.map((point) => ({ x: point.x, y: point.y + offset })),
      });
    }
    width = Math.max(width, layout.width);
    layerCount = Math.max(layerCount, layout.layerCount);
    crossings += layout.crossings;
    offset += layout.height - 2 * options.padding + options.componentGap;
  }

  const bottom = nodes.reduce((max, node) => Math.max(max, node.y + node.height), 0);
  return {
    nodes,
    edges,
    width,
    height: bottom + options.padding,
    layerCount,
    crossings,
  };
}

function layoutComponent(
  ids: readonly string[],
  clean: readonly WorkEdge[],
  options: LayoutOptions,
): GraphLayout {
  const acyclic = breakCycles(ids, clean);
  const layerOf = assignLayers(ids, acyclic);

  const { nodes, chains, segments } = insertDummies(ids, acyclic, layerOf);
  const layers = groupByLayer(nodes);

  const crossings = minimizeCrossings(layers, segments, options.sweeps);
  assignCoordinates(layers, segments, options);

  return finish(nodes, layers.length, chains, options, crossings);
}

/* ------------------------------------------------------------ phase 0 -- */

function dedupe(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** `map.get(key)`, creating an empty array the first time. */
function bucket<K, V>(map: Map<K, V[]>, key: K): V[] {
  const existing = map.get(key);
  if (existing) return existing;
  const created: V[] = [];
  map.set(key, created);
  return created;
}

/**
 * Drop what cannot be drawn, before anything downstream has to cope with it.
 *
 * Self-edges have no layer to span, duplicates would be drawn twice on top of
 * each other, and an edge to an id outside the node set is a dangling reference
 * that would crash coordinate assignment. All three are the caller's business
 * to avoid and none of them should take the page down.
 */
function cleanEdges(
  edges: readonly LayoutEdge[],
  known: ReadonlySet<string>,
): WorkEdge[] {
  const seen = new Set<string>();
  const out: WorkEdge[] = [];
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    if (!known.has(edge.from) || !known.has(edge.to)) continue;
    const key = `${edge.from} ${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from: edge.from, to: edge.to, reversed: false });
  }
  return out;
}

/* ------------------------------------------------------------ phase 1 -- */

/**
 * Reverse the edges that close a cycle, so the rest of the pipeline may assume
 * a DAG.
 *
 * Iterative DFS with three colours: an edge into a node still on the stack
 * (grey) is a back edge. The traversal starts from every node in input order,
 * so the same graph always yields the same reversed set — a layout that
 * reshuffled itself between two renders of unchanged data would look like a bug
 * even though the drawing is equally correct.
 *
 * The reversal is recorded on the edge rather than swallowed: a dependency
 * cycle is a planning error worth showing, and this is the only place that
 * knows which edges close one.
 */
function breakCycles(
  ids: readonly string[],
  edges: readonly WorkEdge[],
): WorkEdge[] {
  const outgoing = new Map<string, WorkEdge[]>();
  for (const id of ids) outgoing.set(id, []);
  for (const edge of edges) bucket(outgoing, edge.from).push(edge);

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>(ids.map((id) => [id, WHITE]));
  const back = new Set<WorkEdge>();

  for (const root of ids) {
    if (colour.get(root) !== WHITE) continue;
    // Each frame is a node plus how far through its out-edges we are, which is
    // what makes this iterative rather than a recursion that a long chain of
    // blockers could overflow.
    const stack: { id: string; index: number }[] = [{ id: root, index: 0 }];
    colour.set(root, GREY);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const edges_ = outgoing.get(frame.id) ?? [];
      if (frame.index >= edges_.length) {
        colour.set(frame.id, BLACK);
        stack.pop();
        continue;
      }
      const edge = edges_[frame.index]!;
      frame.index += 1;
      const target = colour.get(edge.to);
      if (target === GREY) {
        back.add(edge);
        continue;
      }
      if (target === WHITE) {
        colour.set(edge.to, GREY);
        stack.push({ id: edge.to, index: 0 });
      }
    }
  }

  return edges.map((edge) =>
    back.has(edge) ? { from: edge.to, to: edge.from, reversed: true } : edge,
  );
}

/* ------------------------------------------------------------ phase 2 -- */

/**
 * Longest-path layering: a node sits one layer right of its deepest blocker.
 *
 * The alternative — network simplex, which minimises total edge length — makes
 * prettier compact drawings and breaks the promise this view exists to make.
 * Under longest path, "further right" always means "blocked by something to the
 * left", so reading order and dependency order are the same thing.
 *
 * Kahn's algorithm supplies the topological order. The graph is acyclic by now,
 * so every node is emitted; the `remaining` guard is belt and braces against a
 * phase-1 regression silently producing an infinite layer.
 */
function assignLayers(
  ids: readonly string[],
  edges: readonly WorkEdge[],
): Map<string, number> {
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of ids) {
    outgoing.set(id, []);
    indegree.set(id, 0);
  }
  for (const edge of edges) {
    bucket(outgoing, edge.from).push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => indegree.get(id) === 0);
  let head = 0;
  let remaining = ids.length;

  while (head < queue.length && remaining > 0) {
    const id = queue[head]!;
    head += 1;
    remaining -= 1;
    const depth = layer.get(id) ?? 0;
    for (const next of outgoing.get(id) ?? []) {
      layer.set(next, Math.max(layer.get(next) ?? 0, depth + 1));
      const left = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, left);
      if (left === 0) queue.push(next);
    }
  }

  return layer;
}

/* ------------------------------------------------------------ phase 3 -- */

interface DummyResult {
  readonly nodes: WorkNode[];
  readonly chains: Chain[];
  /** Every one-layer-long segment, which is all crossing reduction can see. */
  readonly segments: WorkEdge[];
}

/**
 * A prefix no generated id can collide with — `newId()` produces
 * `prefix_nanoid`, and a NUL byte appears in neither half.
 */
const DUMMY_PREFIX = " dummy:";

function insertDummies(
  ids: readonly string[],
  edges: readonly WorkEdge[],
  layerOf: ReadonlyMap<string, number>,
): DummyResult {
  const nodes: WorkNode[] = ids.map((id) => ({
    id,
    dummy: false,
    layer: layerOf.get(id) ?? 0,
    y: 0,
    priority: 0,
  }));

  const chains: Chain[] = [];
  const segments: WorkEdge[] = [];
  let counter = 0;

  for (const edge of edges) {
    const from = layerOf.get(edge.from) ?? 0;
    const to = layerOf.get(edge.to) ?? 0;
    if (to - from <= 1) {
      chains.push({ edge, waypoints: [] });
      segments.push(edge);
      continue;
    }
    const waypoints: string[] = [];
    let previous = edge.from;
    for (let layer = from + 1; layer < to; layer += 1) {
      const id = `${DUMMY_PREFIX}${counter}`;
      counter += 1;
      waypoints.push(id);
      nodes.push({ id, dummy: true, layer, y: 0, priority: 0 });
      segments.push({ from: previous, to: id, reversed: false });
      previous = id;
    }
    segments.push({ from: previous, to: edge.to, reversed: false });
    chains.push({ edge, waypoints });
  }

  // Degree drives the tie-break in coordinate assignment: a node with many
  // neighbours has more to gain from sitting at their median than a leaf does.
  // Dummies outrank every real node no matter how well connected, which is the
  // whole point of the priority method.
  const degree = new Map<string, number>();
  for (const segment of segments) {
    degree.set(segment.from, (degree.get(segment.from) ?? 0) + 1);
    degree.set(segment.to, (degree.get(segment.to) ?? 0) + 1);
  }
  for (const node of nodes) {
    node.priority = node.dummy
      ? Number.MAX_SAFE_INTEGER
      : (degree.get(node.id) ?? 0);
  }

  return { nodes, chains, segments };
}

function groupByLayer(nodes: readonly WorkNode[]): WorkNode[][] {
  const depth = nodes.reduce((max, node) => Math.max(max, node.layer), 0);
  const layers: WorkNode[][] = Array.from({ length: depth + 1 }, () => []);
  for (const node of nodes) layers[node.layer]!.push(node);
  return layers;
}

/* ------------------------------------------------------------ phase 4 -- */

interface Adjacency {
  readonly predecessors: ReadonlyMap<string, readonly string[]>;
  readonly successors: ReadonlyMap<string, readonly string[]>;
}

function adjacency(segments: readonly WorkEdge[]): Adjacency {
  const predecessors = new Map<string, string[]>();
  const successors = new Map<string, string[]>();
  for (const segment of segments) {
    bucket(successors, segment.from).push(segment.to);
    bucket(predecessors, segment.to).push(segment.from);
  }
  return { predecessors, successors };
}

/**
 * Alternating median sweeps, keeping the best ordering seen.
 *
 * The median heuristic places each node at the median position of its
 * neighbours in the layer just fixed, then re-sorts. Sweeping down then up
 * repeatedly lets an improvement propagate in both directions.
 *
 * Snapshotting the best is what makes `sweeps` monotone: the heuristic is not,
 * and a later sweep is perfectly capable of producing a worse ordering than an
 * earlier one. Without the snapshot, "more sweeps" would sometimes mean "worse
 * drawing", which is an unpleasant thing for a tuning knob to do.
 */
function minimizeCrossings(
  layers: WorkNode[][],
  segments: readonly WorkEdge[],
  sweeps: number,
): number {
  if (layers.length < 2) return 0;
  const { predecessors, successors } = adjacency(segments);

  let best = snapshot(layers);
  let bestCrossings = countCrossings(layers, segments);

  for (let sweep = 0; sweep < sweeps; sweep += 1) {
    if (sweep % 2 === 0) {
      for (let index = 1; index < layers.length; index += 1) {
        reorder(layers[index]!, layers[index - 1]!, predecessors);
      }
    } else {
      for (let index = layers.length - 2; index >= 0; index -= 1) {
        reorder(layers[index]!, layers[index + 1]!, successors);
      }
    }
    const crossings = countCrossings(layers, segments);
    if (crossings < bestCrossings) {
      bestCrossings = crossings;
      best = snapshot(layers);
    }
  }

  restore(layers, best);
  // Counted again from the ordering that will actually be drawn, rather than
  // returning `bestCrossings` on trust. The two are the same number when
  // `restore` does its job, and the point is that they stop being the same the
  // moment it does not — a layout that reports the best ordering it saw while
  // drawing a different one is the kind of wrong that no test would otherwise
  // notice, because the number it prints is still true of *something*.
  return countCrossings(layers, segments);
}

function reorder(
  layer: WorkNode[],
  fixed: readonly WorkNode[],
  neighbours: ReadonlyMap<string, readonly string[]>,
): void {
  const position = new Map<string, number>(
    fixed.map((node, index) => [node.id, index]),
  );
  const original = new Map<string, number>(
    layer.map((node, index) => [node.id, index]),
  );
  const median = new Map<string, number>();

  for (const node of layer) {
    const indices = (neighbours.get(node.id) ?? [])
      .map((id) => position.get(id))
      .filter((index): index is number => index !== undefined)
      .sort((a, b) => a - b);
    // A node with no neighbour in the fixed layer has no opinion, and is
    // pinned to where it already was rather than being swept to one end.
    median.set(node.id, indices.length === 0 ? -1 : medianOf(indices));
  }

  layer.sort((a, b) => {
    const left = median.get(a.id) ?? -1;
    const right = median.get(b.id) ?? -1;
    const orderA = original.get(a.id) ?? 0;
    const orderB = original.get(b.id) ?? 0;
    if (left < 0 || right < 0 || left === right) return orderA - orderB;
    return left - right;
  });
}

/**
 * The median, biased the way Eades and Wormald's original recommends.
 *
 * For an even count the two middles are weighted by how far each half reaches,
 * which pulls a node toward the denser side instead of splitting the difference
 * and sitting between two clusters it belongs to neither of.
 */
function medianOf(sorted: readonly number[]): number {
  const count = sorted.length;
  const middle = Math.floor(count / 2);
  if (count % 2 === 1) return sorted[middle]!;
  if (count === 2) return (sorted[0]! + sorted[1]!) / 2;
  const left = sorted[middle - 1]! - sorted[0]!;
  const right = sorted[count - 1]! - sorted[middle]!;
  if (left + right === 0) return (sorted[middle - 1]! + sorted[middle]!) / 2;
  return (sorted[middle - 1]! * right + sorted[middle]! * left) / (left + right);
}

/**
 * Crossings between every adjacent pair of layers.
 *
 * Two segments cross exactly when their endpoints are in opposite order on the
 * two layers, so this counts inversions. The pairwise count is quadratic in the
 * segments between one pair of layers, which at the node cap this feature
 * enforces is a few thousand comparisons per sweep — cheaper than the
 * accumulator tree that would replace it, and considerably easier to be sure
 * about.
 */
function countCrossings(
  layers: readonly (readonly WorkNode[])[],
  segments: readonly WorkEdge[],
): number {
  const order = new Map<string, number>();
  const layerIndex = new Map<string, number>();
  layers.forEach((layer, index) => {
    layer.forEach((node, position) => {
      order.set(node.id, position);
      layerIndex.set(node.id, index);
    });
  });

  const byLayer = new Map<number, { from: number; to: number }[]>();
  for (const segment of segments) {
    const layer = layerIndex.get(segment.from);
    const from = order.get(segment.from);
    const to = order.get(segment.to);
    if (layer === undefined || from === undefined || to === undefined) continue;
    bucket(byLayer, layer).push({ from, to });
  }

  let crossings = 0;
  for (const pairs of byLayer.values()) {
    for (let i = 0; i < pairs.length; i += 1) {
      for (let j = i + 1; j < pairs.length; j += 1) {
        const a = pairs[i]!;
        const b = pairs[j]!;
        if ((a.from - b.from) * (a.to - b.to) < 0) crossings += 1;
      }
    }
  }
  return crossings;
}

function snapshot(layers: readonly (readonly WorkNode[])[]): string[][] {
  return layers.map((layer) => layer.map((node) => node.id));
}

function restore(layers: WorkNode[][], best: readonly (readonly string[])[]): void {
  layers.forEach((layer, index) => {
    const wanted = best[index] ?? [];
    const byId = new Map(layer.map((node) => [node.id, node]));
    layer.length = 0;
    for (const id of wanted) {
      const node = byId.get(id);
      if (node) layer.push(node);
    }
  });
}

/* ------------------------------------------------------------ phase 5 -- */

/**
 * Vertical positions, by the priority method.
 *
 * Each node would like to sit at the median of its neighbours in the adjacent
 * layer. They cannot all have that, so they are served in descending priority
 * and a node may push nodes of *strictly lower* priority out of its way,
 * subject to the minimum separation. Dummies have the top priority, so a long
 * edge is drawn as a straight line and the real nodes bend around it — the
 * opposite of what happens when every node is treated equally, which is a
 * drawing full of gently curving long edges that are hard to follow.
 */
function assignCoordinates(
  layers: WorkNode[][],
  segments: readonly WorkEdge[],
  options: LayoutOptions,
): void {
  const separation = options.nodeHeight + options.siblingGap;
  for (const layer of layers) {
    layer.forEach((node, index) => {
      node.y = index * separation;
    });
  }
  if (layers.length < 2) return;

  const { predecessors, successors } = adjacency(segments);
  const indices = layers.map((_, index) => index);

  for (let pass = 0; pass < options.coordinatePasses; pass += 1) {
    const downward = pass % 2 === 0;
    for (const index of downward ? indices : [...indices].reverse()) {
      const reference = layers[downward ? index - 1 : index + 1];
      if (!reference) continue;
      const neighbours = downward ? predecessors : successors;
      const position = new Map(reference.map((node) => [node.id, node.y]));
      const layer = layers[index]!;

      for (const node of [...layer].sort((a, b) => b.priority - a.priority)) {
        const targets = (neighbours.get(node.id) ?? [])
          .map((id) => position.get(id))
          .filter((value): value is number => value !== undefined)
          .sort((a, b) => a - b);
        if (targets.length === 0) continue;
        shiftToward(layer, node, medianOf(targets), separation);
      }
    }
  }
}

/**
 * Move `node` toward `desired`, pushing lower-priority neighbours along and
 * stopping short of anything that outranks it.
 *
 * The blocker is the first node in the direction of travel whose priority is at
 * least this node's; it will not yield, so the mover has to leave room for
 * everything between them. Nodes of strictly lower priority are simply carried,
 * which is what keeps the layer's order intact — this phase changes positions,
 * never the ordering that phase 4 worked out.
 */
function shiftToward(
  layer: readonly WorkNode[],
  node: WorkNode,
  desired: number,
  separation: number,
): void {
  const index = layer.indexOf(node);
  if (index < 0 || desired === node.y) return;

  if (desired > node.y) {
    let limit = Number.POSITIVE_INFINITY;
    for (let j = index + 1; j < layer.length; j += 1) {
      if (layer[j]!.priority >= node.priority) {
        limit = layer[j]!.y - (j - index) * separation;
        break;
      }
    }
    node.y = Math.min(desired, limit);
    for (let j = index + 1; j < layer.length; j += 1) {
      layer[j]!.y = Math.max(layer[j]!.y, layer[j - 1]!.y + separation);
    }
    return;
  }

  let limit = Number.NEGATIVE_INFINITY;
  for (let j = index - 1; j >= 0; j -= 1) {
    if (layer[j]!.priority >= node.priority) {
      limit = layer[j]!.y + (index - j) * separation;
      break;
    }
  }
  node.y = Math.max(desired, limit);
  for (let j = index - 1; j >= 0; j -= 1) {
    layer[j]!.y = Math.min(layer[j]!.y, layer[j + 1]!.y - separation);
  }
}

/* ------------------------------------------------------------- output -- */

function finish(
  nodes: readonly WorkNode[],
  layerCount: number,
  chains: readonly Chain[],
  options: LayoutOptions,
  crossings: number,
): GraphLayout {
  const xOf = (layer: number): number =>
    layer * (options.nodeWidth + options.layerGap);

  const centre = new Map<string, Point>();
  for (const node of nodes) {
    centre.set(node.id, {
      x: xOf(node.layer) + options.nodeWidth / 2,
      y: node.y + options.nodeHeight / 2,
    });
  }

  const positioned: PositionedNode[] = nodes
    .filter((node) => !node.dummy)
    .map((node) => ({
      id: node.id,
      x: xOf(node.layer),
      y: node.y,
      width: options.nodeWidth,
      height: options.nodeHeight,
      layer: node.layer,
    }));

  const edges: PositionedEdge[] = [];
  for (const { edge, waypoints } of chains) {
    const start = centre.get(edge.from);
    const end = centre.get(edge.to);
    if (!start || !end) continue;

    const path: Point[] = [
      anchor(start, options, true),
      ...waypoints
        .map((id) => centre.get(id))
        .filter((point): point is Point => point !== undefined),
      anchor(end, options, false),
    ];

    // The chain was built on the *acyclic* edge, so a reversed one runs
    // right-to-left in layout terms. Flipping both the endpoints and the point
    // list puts it back into semantic order — blocker first — so the renderer
    // can always put the arrowhead on the last point without knowing any of
    // this.
    edges.push(
      edge.reversed
        ? {
            from: edge.to,
            to: edge.from,
            points: [...path].reverse(),
            reversed: true,
          }
        : { from: edge.from, to: edge.to, points: path, reversed: false },
    );
  }

  return translateToOrigin(positioned, edges, layerCount, crossings, options);
}

/**
 * Move the drawing so its top-left corner sits at `padding`, and size the
 * canvas to what is actually drawn.
 *
 * The origin used to come from the minimum `y` across all *working* nodes,
 * dummies included. A dummy is a waypoint, not a box — it is never rendered —
 * so a long edge routing above the first card set the top of the canvas from
 * something nobody can see, and the page drew a two-hundred-and-fifty-pixel
 * hole above the graph. Every unit test passed; it took looking at it.
 * Measuring what is drawn cannot make that mistake, and the tests hold it: zero
 * the translation below and eight of them go red.
 *
 * Edge points are measured as well as boxes, and that half earns its keep too:
 * on the seeded workspace a reversed edge bends *above every card*, so dropping
 * the edge points from these bounds clips it. The fixture in the bounds tests
 * is that graph, node order and all.
 */
function translateToOrigin(
  nodes: readonly PositionedNode[],
  edges: readonly PositionedEdge[],
  layerCount: number,
  crossings: number,
  options: LayoutOptions,
): GraphLayout {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const see = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const node of nodes) {
    see(node.x, node.y);
    see(node.x + node.width, node.y + node.height);
  }
  for (const edge of edges) {
    for (const point of edge.points) see(point.x, point.y);
  }
  if (!Number.isFinite(minX)) return EMPTY_LAYOUT;

  const dx = options.padding - minX;
  const dy = options.padding - minY;

  return {
    nodes: nodes.map((node) => ({ ...node, x: node.x + dx, y: node.y + dy })),
    edges: edges.map((edge) => ({
      ...edge,
      points: edge.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
    })),
    width: maxX - minX + 2 * options.padding,
    height: maxY - minY + 2 * options.padding,
    layerCount,
    crossings,
  };
}

/** Edges leave a box at its right edge and arrive at the next one's left. */
function anchor(point: Point, options: LayoutOptions, leaving: boolean): Point {
  const half = options.nodeWidth / 2;
  return { x: leaving ? point.x + half : point.x - half, y: point.y };
}
