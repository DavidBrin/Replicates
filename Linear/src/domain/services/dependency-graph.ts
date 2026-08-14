/**
 * Issue relations → a blocking graph.
 *
 * The half of the DAG view that knows what an issue relation *means*, with none
 * of the geometry (`graph-layout.ts`) and none of the SQL
 * (`adapters/repositories/issues.ts`). It is generic over the node type: the
 * repository's row shape never reaches this module, so the rules below can be
 * tested against three-character fixtures.
 *
 * ## Only blocking is directional
 *
 * Of the five relation types, `related` is undirected and `duplicate` /
 * `duplicate_of` describe sameness rather than order. Neither has a position in
 * a layered drawing: putting `related` in as an edge would create layers that
 * mean nothing, and a reader who has been told that "further right is blocked
 * by further left" would be reading a false statement off the screen. So the
 * graph is built from `blocks` and `blocked_by` alone.
 *
 * ## One row, both directions — again
 *
 * `issue_relations` stores a relation once, in the direction it was created,
 * and the inverse is derived on read (`entities.ts`, `INVERSE_RELATION`). The
 * consequence here is that a single stored row arrives as either `A blocks B`
 * or `B blocked_by A` depending on which way round somebody clicked, and both
 * have to normalise to the same edge. That is {@link toBlockingEdges}, and it
 * is why the flip is not written inline in SQL — the knowledge of what the
 * inverse *is* already lives in `entities.ts`, and a second copy in a query
 * would be a second thing to keep in step.
 *
 * ## A cycle is a finding, not an error
 *
 * The schema forbids an issue blocking itself and permits `A → B → C → A`.
 * Nothing in the product stops you creating one and nothing tells you that you
 * have: the issue detail pane shows one hop, so a three-issue deadlock is
 * invisible from every screen that exists today. {@link findCycles} is what
 * makes it visible, and it reports every member of the cycle rather than the
 * single edge that happened to close it — "these four issues are waiting on
 * each other" is actionable, "this edge is a back edge" is trivia.
 */

import { type IssueRelationType } from "@/domain/entities";

/** A relation as stored: one row, one direction, whichever way it was created. */
export interface RelationRow {
  readonly issueId: string;
  readonly relatedIssueId: string;
  readonly type: IssueRelationType;
}

/** A normalised dependency: `blockerId` must finish before `blockedId` can. */
export interface BlockingEdge {
  readonly blockerId: string;
  readonly blockedId: string;
}

export interface DependencyGraph<N> {
  /** Nodes that take part in at least one blocking relation. */
  readonly nodes: readonly N[];
  readonly edges: readonly BlockingEdge[];
  /** Nodes with no blocking relation at all — counted, not drawn. */
  readonly isolated: readonly N[];
  /**
   * Every set of issues that block each other, directly or through a chain.
   * Each is at least two issues; members are in input order.
   */
  readonly cycles: readonly (readonly string[])[];
}

/**
 * Normalise stored relations into blocker → blocked edges.
 *
 * `blocks` reads forwards and `blocked_by` reads backwards, which is the whole
 * of the transformation. Self-relations cannot exist (the schema has a check
 * constraint) but are dropped anyway, because this function is also the seam
 * where a future relation type would arrive and the layout must never be handed
 * an edge it cannot lay out.
 */
export function toBlockingEdges(
  relations: readonly RelationRow[],
): BlockingEdge[] {
  const seen = new Set<string>();
  const edges: BlockingEdge[] = [];

  for (const relation of relations) {
    let blockerId: string;
    let blockedId: string;
    if (relation.type === "blocks") {
      blockerId = relation.issueId;
      blockedId = relation.relatedIssueId;
    } else if (relation.type === "blocked_by") {
      blockerId = relation.relatedIssueId;
      blockedId = relation.issueId;
    } else {
      continue;
    }

    if (blockerId === blockedId) continue;
    // The same dependency can be stored twice — once as `A blocks B` and once
    // as `B blocked_by A` — because the unique index is on
    // (issue_id, related_issue_id, type) and those are two different rows.
    // Drawing it twice would put two arrowheads on one line.
    const key = `${blockerId} ${blockedId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ blockerId, blockedId });
  }

  return edges;
}

/**
 * Build the graph the view draws.
 *
 * Edges naming an issue outside `nodes` are dropped rather than pulling a
 * phantom node into existence: the caller has already decided which issues the
 * viewer may see, and an edge is not a licence to render one they may not.
 */
export function buildDependencyGraph<N extends { readonly id: string }>(
  nodes: readonly N[],
  relations: readonly RelationRow[],
): DependencyGraph<N> {
  const known = new Set(nodes.map((node) => node.id));
  const edges = toBlockingEdges(relations).filter(
    (edge) => known.has(edge.blockerId) && known.has(edge.blockedId),
  );

  const connected = new Set<string>();
  for (const edge of edges) {
    connected.add(edge.blockerId);
    connected.add(edge.blockedId);
  }

  return {
    nodes: nodes.filter((node) => connected.has(node.id)),
    edges,
    isolated: nodes.filter((node) => !connected.has(node.id)),
    cycles: findCycles([...connected], edges),
  };
}

/* ================================================================ cycles = */

/**
 * Every group of issues that transitively block each other, by Tarjan's
 * algorithm.
 *
 * A strongly connected component of two or more nodes is precisely a set of
 * issues each of which can be reached from every other — which is what a
 * dependency deadlock is. Reporting components rather than back edges means the
 * message can name the issues involved instead of an arbitrary one of the edges
 * that closes the loop, and it does not depend on which node the traversal
 * happened to start from.
 *
 * The implementation is iterative. Recursion would be more readable and would
 * be bounded by the length of the longest dependency chain, which is not a
 * number this codebase controls — an imported backlog with a chain a few
 * thousand deep would take the page down with a stack overflow.
 */
export function findCycles(
  ids: readonly string[],
  edges: readonly BlockingEdge[],
): (readonly string[])[] {
  const successors = new Map<string, string[]>();
  for (const id of ids) successors.set(id, []);
  for (const edge of edges) successors.get(edge.blockerId)?.push(edge.blockedId);

  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  interface Frame {
    readonly id: string;
    next: number;
  }

  for (const root of ids) {
    if (index.has(root)) continue;
    const work: Frame[] = [{ id: root, next: 0 }];

    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      if (frame.next === 0) {
        index.set(frame.id, counter);
        lowlink.set(frame.id, counter);
        counter += 1;
        stack.push(frame.id);
        onStack.add(frame.id);
      }

      const adjacent = successors.get(frame.id) ?? [];
      let descended = false;
      while (frame.next < adjacent.length) {
        const next = adjacent[frame.next]!;
        frame.next += 1;
        if (!index.has(next)) {
          work.push({ id: next, next: 0 });
          descended = true;
          break;
        }
        if (onStack.has(next)) {
          lowlink.set(
            frame.id,
            Math.min(lowlink.get(frame.id)!, index.get(next)!),
          );
        }
      }
      if (descended) continue;

      if (lowlink.get(frame.id) === index.get(frame.id)) {
        const component: string[] = [];
        for (;;) {
          const member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
          if (member === frame.id) break;
        }
        components.push(component);
      }

      work.pop();
      const parent = work[work.length - 1];
      if (parent) {
        lowlink.set(
          parent.id,
          Math.min(lowlink.get(parent.id)!, lowlink.get(frame.id)!),
        );
      }
    }
  }

  // Input order for the members, and for the components themselves. The
  // traversal's own order is an artefact of where it started; a banner whose
  // issues reshuffle between two loads of unchanged data reads as a bug.
  const rank = new Map(ids.map((id, position) => [id, position]));
  return components
    .filter((component) => component.length > 1)
    .map((component) =>
      [...component].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0)),
    )
    .sort((a, b) => (rank.get(a[0]!) ?? 0) - (rank.get(b[0]!) ?? 0));
}

/* ============================================================ highlights = */

export interface ConnectedPaths {
  /** Everything that must finish before this issue can start. */
  readonly upstream: ReadonlySet<string>;
  /** Everything waiting on this issue, directly or transitively. */
  readonly downstream: ReadonlySet<string>;
}

/**
 * The full chain through one issue, for the hover highlight.
 *
 * Showing less is the fix for a dense graph, and dimming everything that is not
 * on the hovered issue's chain is the cheapest version of that — no filtering
 * controls, no state, and it answers the question the view is actually opened
 * to answer: *what is this waiting on, and what is waiting on it?*
 *
 * Breadth-first from the issue in both directions, so a cycle terminates on the
 * visited set rather than looping. The issue itself is in neither set; the
 * renderer already knows which node the pointer is over.
 */
export function connectedPaths(
  edges: readonly BlockingEdge[],
  id: string,
): ConnectedPaths {
  const blockers = new Map<string, string[]>();
  const blocked = new Map<string, string[]>();
  for (const edge of edges) {
    (blockers.get(edge.blockedId) ?? setEmpty(blockers, edge.blockedId)).push(
      edge.blockerId,
    );
    (blocked.get(edge.blockerId) ?? setEmpty(blocked, edge.blockerId)).push(
      edge.blockedId,
    );
  }

  return {
    upstream: walk(blockers, id),
    downstream: walk(blocked, id),
  };
}

function setEmpty(map: Map<string, string[]>, key: string): string[] {
  const created: string[] = [];
  map.set(key, created);
  return created;
}

function walk(
  adjacency: ReadonlyMap<string, readonly string[]>,
  start: string,
): Set<string> {
  const seen = new Set<string>();
  const queue = [...(adjacency.get(start) ?? [])];
  let head = 0;
  while (head < queue.length) {
    const id = queue[head]!;
    head += 1;
    if (id === start || seen.has(id)) continue;
    seen.add(id);
    queue.push(...(adjacency.get(id) ?? []));
  }
  return seen;
}
