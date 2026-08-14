import { describe, expect, it } from "vitest";

import {
  buildDependencyGraph,
  connectedPaths,
  findCycles,
  toBlockingEdges,
  type BlockingEdge,
  type RelationRow,
} from "@/domain/services/dependency-graph";

function node(id: string) {
  return { id, title: id.toUpperCase() };
}

function blocks(blockerId: string, blockedId: string): BlockingEdge {
  return { blockerId, blockedId };
}

describe("toBlockingEdges", () => {
  it("reads `blocks` forwards", () => {
    const rows: RelationRow[] = [
      { issueId: "a", relatedIssueId: "b", type: "blocks" },
    ];
    expect(toBlockingEdges(rows)).toEqual([blocks("a", "b")]);
  });

  it("reads `blocked_by` backwards", () => {
    const rows: RelationRow[] = [
      { issueId: "b", relatedIssueId: "a", type: "blocked_by" },
    ];
    expect(toBlockingEdges(rows)).toEqual([blocks("a", "b")]);
  });

  /**
   * `(issue_id, related_issue_id, type)` is the unique index, so "A blocks B"
   * and "B blocked_by A" are two legal rows describing one dependency. Without
   * the dedupe they are drawn as two arrows between the same pair of boxes.
   */
  it("collapses the two ways of storing one dependency", () => {
    const rows: RelationRow[] = [
      { issueId: "a", relatedIssueId: "b", type: "blocks" },
      { issueId: "b", relatedIssueId: "a", type: "blocked_by" },
    ];
    expect(toBlockingEdges(rows)).toEqual([blocks("a", "b")]);
  });

  it("keeps both directions when two issues genuinely block each other", () => {
    const rows: RelationRow[] = [
      { issueId: "a", relatedIssueId: "b", type: "blocks" },
      { issueId: "b", relatedIssueId: "a", type: "blocks" },
    ];
    expect(toBlockingEdges(rows)).toEqual([blocks("a", "b"), blocks("b", "a")]);
  });

  it.each(["related", "duplicate", "duplicate_of"] as const)(
    "ignores `%s`, which has no direction to draw",
    (type) => {
      expect(toBlockingEdges([{ issueId: "a", relatedIssueId: "b", type }])).toEqual(
        [],
      );
    },
  );
});

describe("buildDependencyGraph", () => {
  it("separates the issues that take part from the ones that do not", () => {
    const graph = buildDependencyGraph(
      [node("a"), node("b"), node("c")],
      [{ issueId: "a", relatedIssueId: "b", type: "blocks" }],
    );
    expect(graph.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(graph.isolated.map((n) => n.id)).toEqual(["c"]);
    expect(graph.edges).toEqual([blocks("a", "b")]);
  });

  /**
   * The caller has already decided what the viewer may see. An edge pointing at
   * an issue outside that set must not conjure it back onto the page — that is
   * the private-team leak this view could most easily have introduced.
   */
  it("drops an edge naming an issue the caller did not supply", () => {
    const graph = buildDependencyGraph(
      [node("a")],
      [{ issueId: "a", relatedIssueId: "secret", type: "blocked_by" }],
    );
    expect(graph.edges).toEqual([]);
    expect(graph.nodes).toEqual([]);
    expect(graph.isolated.map((n) => n.id)).toEqual(["a"]);
  });

  it("reports a cycle it finds", () => {
    const graph = buildDependencyGraph(
      [node("a"), node("b"), node("c")],
      [
        { issueId: "a", relatedIssueId: "b", type: "blocks" },
        { issueId: "b", relatedIssueId: "c", type: "blocks" },
        { issueId: "c", relatedIssueId: "a", type: "blocks" },
      ],
    );
    expect(graph.cycles).toEqual([["a", "b", "c"]]);
  });
});

describe("findCycles", () => {
  it("finds nothing in a DAG", () => {
    expect(
      findCycles(["a", "b", "c"], [blocks("a", "b"), blocks("b", "c"), blocks("a", "c")]),
    ).toEqual([]);
  });

  it("finds a two-issue deadlock", () => {
    expect(findCycles(["a", "b"], [blocks("a", "b"), blocks("b", "a")])).toEqual([
      ["a", "b"],
    ]);
  });

  it("finds each independent cycle separately", () => {
    const cycles = findCycles(
      ["a", "b", "c", "d", "e"],
      [
        blocks("a", "b"),
        blocks("b", "a"),
        blocks("c", "d"),
        blocks("d", "c"),
        blocks("e", "a"),
      ],
    );
    expect(cycles).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("reports members in input order, not traversal order", () => {
    const cycles = findCycles(
      ["c", "b", "a"],
      [blocks("a", "b"), blocks("b", "c"), blocks("c", "a")],
    );
    expect(cycles).toEqual([["c", "b", "a"]]);
  });

  it("survives a chain far deeper than the call stack would allow", () => {
    const ids = Array.from({ length: 20_000 }, (_, i) => `n${i}`);
    const edges = ids
      .slice(0, -1)
      .map((id, i) => blocks(id, ids[i + 1]!));
    expect(findCycles(ids, edges)).toEqual([]);
  });
});

describe("connectedPaths", () => {
  const edges = [
    blocks("a", "b"),
    blocks("b", "c"),
    blocks("c", "d"),
    blocks("x", "c"),
  ];

  it("walks the whole chain in both directions", () => {
    const { upstream, downstream } = connectedPaths(edges, "c");
    expect([...upstream].sort()).toEqual(["a", "b", "x"]);
    expect([...downstream].sort()).toEqual(["d"]);
  });

  it("excludes the issue itself", () => {
    const { upstream, downstream } = connectedPaths(edges, "c");
    expect(upstream.has("c")).toBe(false);
    expect(downstream.has("c")).toBe(false);
  });

  it("terminates inside a cycle", () => {
    const cycle = [blocks("a", "b"), blocks("b", "c"), blocks("c", "a")];
    const { upstream, downstream } = connectedPaths(cycle, "a");
    expect([...upstream].sort()).toEqual(["b", "c"]);
    expect([...downstream].sort()).toEqual(["b", "c"]);
  });

  it("returns nothing for an issue with no relations", () => {
    const { upstream, downstream } = connectedPaths(edges, "lonely");
    expect(upstream.size).toBe(0);
    expect(downstream.size).toBe(0);
  });
});
