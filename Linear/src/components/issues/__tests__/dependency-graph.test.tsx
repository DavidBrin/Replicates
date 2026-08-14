/**
 * The DAG canvas.
 *
 * jsdom has no layout engine, so nothing here can assert on where a box ended
 * up — that is `domain/services/graph-layout.ts`'s job, and it is tested as
 * arithmetic. What this file holds is the part that is genuinely the
 * component's: that every card is a real link to the right issue, that the
 * cycle warning appears with the issues in it, that a reversed edge is marked
 * as more than red, and that hovering dims what is not on the chain.
 */

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { BlockingEdge } from "@/domain/services/dependency-graph";
import { layoutGraph } from "@/domain/services/graph-layout";
import { DEPENDENCY_GRAPH_CONFIG } from "@/config/dependency-graph";
import {
  DependencyGraph,
  type GraphIssue,
} from "@/components/issues/dependency-graph";

function issue(overrides: Partial<GraphIssue> & { id: string }): GraphIssue {
  return {
    identifier: `ENG-${overrides.id.slice(-1)}`,
    title: `Issue ${overrides.id}`,
    teamKey: "ENG",
    stateName: "Todo",
    stateType: "unstarted",
    stateColor: "#8a8f98",
    priority: 0,
    assigneeName: null,
    assigneeAvatarColor: null,
    assigneeAvatarUrl: null,
    ...overrides,
  };
}

function edge(blockerId: string, blockedId: string): BlockingEdge {
  return { blockerId, blockedId };
}

function renderGraph(
  issues: readonly GraphIssue[],
  edges: readonly BlockingEdge[],
  cycles: readonly (readonly string[])[] = [],
) {
  const layout = layoutGraph(
    issues.map((i) => i.id),
    edges.map((e) => ({ from: e.blockerId, to: e.blockedId })),
    DEPENDENCY_GRAPH_CONFIG.layout,
  );
  return render(
    <DependencyGraph
      issues={issues}
      edges={edges}
      layout={layout}
      cycles={cycles}
      issueBasePath="/acme/issue"
      teamKey="ENG"
    />,
  );
}

const a = issue({ id: "iss_a", identifier: "ENG-1", title: "Design the API" });
const b = issue({ id: "iss_b", identifier: "ENG-2", title: "Build the client" });
const c = issue({ id: "iss_c", identifier: "ENG-3", title: "Ship it" });

describe("DependencyGraph", () => {
  it("draws a card per issue and an edge per dependency", () => {
    renderGraph([a, b, c], [edge(a.id, b.id), edge(b.id, c.id)]);
    expect(screen.getByTestId("graph-node-ENG-1")).toBeInTheDocument();
    expect(screen.getByTestId("graph-node-ENG-2")).toBeInTheDocument();
    expect(screen.getAllByTestId("graph-edge")).toHaveLength(2);
  });

  /**
   * `view-tabs.tsx` makes the argument for the tab row and it applies here for
   * the same reasons: ⌘-click, middle-click and "copy link address" are not
   * optional behaviours that a `div` with an `onClick` can approximate.
   */
  it("makes every card a real link to its issue", () => {
    renderGraph([a, b], [edge(a.id, b.id)]);
    const card = screen.getByTestId("graph-node-ENG-1");
    expect(card.tagName).toBe("A");
    expect(card).toHaveAttribute("href", "/acme/issue/ENG-1");
  });

  it("shows the title and identifier on the card", () => {
    renderGraph([a, b], [edge(a.id, b.id)]);
    const card = screen.getByTestId("graph-node-ENG-1");
    expect(within(card).getByText("Design the API")).toBeInTheDocument();
    expect(within(card).getByText("ENG-1")).toBeInTheDocument();
  });

  it("marks an issue from another team with its key", () => {
    const foreign = issue({
      id: "iss_d",
      identifier: "DES-9",
      title: "Mockups",
      teamKey: "DES",
    });
    renderGraph([foreign, b], [edge(foreign.id, b.id)]);
    const card = screen.getByTestId("graph-node-DES-9");
    expect(card).toHaveAttribute("data-foreign");
    expect(within(card).getByText("DES")).toBeInTheDocument();
    expect(screen.getByTestId("graph-node-ENG-2")).not.toHaveAttribute(
      "data-foreign",
    );
  });

  describe("cycles", () => {
    const cyclic = [edge(a.id, b.id), edge(b.id, c.id), edge(c.id, a.id)];

    it("warns, and names the issues in the loop", () => {
      renderGraph([a, b, c], cyclic, [[a.id, b.id, c.id]]);
      const warning = screen.getByTestId("graph-cycle-warning");
      expect(within(warning).getByText("ENG-1")).toBeInTheDocument();
      expect(within(warning).getByText("ENG-2")).toBeInTheDocument();
      expect(within(warning).getByText("ENG-3")).toBeInTheDocument();
    });

    it("says nothing when there is no cycle", () => {
      renderGraph([a, b], [edge(a.id, b.id)]);
      expect(screen.queryByTestId("graph-cycle-warning")).toBeNull();
    });

    it("marks the issues in the loop on their cards too", () => {
      renderGraph([a, b, c], cyclic, [[a.id, b.id, c.id]]);
      expect(screen.getByTestId("graph-node-ENG-1")).toHaveAttribute(
        "data-cyclic",
      );
    });

    /**
     * Red is not enough on its own. The dash is what carries the meaning for a
     * reader who cannot tell the two stroke colours apart, which is roughly one
     * man in twelve.
     */
    it("distinguishes the reversed edge by more than colour", () => {
      renderGraph([a, b, c], cyclic, [[a.id, b.id, c.id]]);
      const reversed = screen
        .getAllByTestId("graph-edge")
        .filter((element) => element.hasAttribute("data-reversed"));
      expect(reversed).toHaveLength(1);
      expect(reversed[0]).toHaveAttribute("stroke-dasharray");
    });
  });

  describe("the hover highlight", () => {
    it("dims what is not on the hovered issue's chain", async () => {
      const user = userEvent.setup();
      const unrelated = issue({ id: "iss_x", identifier: "ENG-8" });
      const other = issue({ id: "iss_y", identifier: "ENG-9" });
      renderGraph(
        [a, b, c, unrelated, other],
        [edge(a.id, b.id), edge(b.id, c.id), edge(unrelated.id, other.id)],
      );

      await user.hover(screen.getByTestId("graph-node-ENG-2"));

      // The whole chain through ENG-2 stays lit…
      for (const id of ["ENG-1", "ENG-2", "ENG-3"]) {
        expect(screen.getByTestId(`graph-node-${id}`).className).toContain(
          "opacity-100",
        );
      }
      // …and the pair that has nothing to do with it recedes.
      for (const id of ["ENG-8", "ENG-9"]) {
        expect(screen.getByTestId(`graph-node-${id}`).className).toContain(
          "opacity-30",
        );
      }
    });

    it("restores everything when the pointer leaves", async () => {
      const user = userEvent.setup();
      const unrelated = issue({ id: "iss_x", identifier: "ENG-8" });
      const other = issue({ id: "iss_y", identifier: "ENG-9" });
      renderGraph(
        [a, b, unrelated, other],
        [edge(a.id, b.id), edge(unrelated.id, other.id)],
      );

      const card = screen.getByTestId("graph-node-ENG-1");
      await user.hover(card);
      await user.unhover(card);
      expect(screen.getByTestId("graph-node-ENG-8").className).toContain(
        "opacity-100",
      );
    });

    /**
     * The keyboard has to get the feature, not a version of the page with the
     * feature missing — focus does what hover does.
     */
    it("highlights on keyboard focus as well as hover", async () => {
      const user = userEvent.setup();
      const unrelated = issue({ id: "iss_x", identifier: "ENG-8" });
      const other = issue({ id: "iss_y", identifier: "ENG-9" });
      renderGraph(
        [a, b, unrelated, other],
        [edge(a.id, b.id), edge(unrelated.id, other.id)],
      );

      await user.tab();
      expect(screen.getByTestId("graph-node-ENG-1")).toHaveFocus();
      expect(screen.getByTestId("graph-node-ENG-8").className).toContain(
        "opacity-30",
      );
    });
  });

  describe("zoom", () => {
    it("changes the scale and reports it", async () => {
      const user = userEvent.setup();
      renderGraph([a, b], [edge(a.id, b.id)]);

      expect(screen.getByTestId("graph-zoom-reset")).toHaveTextContent("100%");
      await user.click(screen.getByTestId("graph-zoom-in"));
      expect(screen.getByTestId("graph-zoom-reset")).toHaveTextContent("120%");
      await user.click(screen.getByTestId("graph-zoom-reset"));
      expect(screen.getByTestId("graph-zoom-reset")).toHaveTextContent("100%");
    });

    it("stops at the configured limits", async () => {
      const user = userEvent.setup();
      renderGraph([a, b], [edge(a.id, b.id)]);

      const zoomIn = screen.getByTestId("graph-zoom-in");
      for (let i = 0; i < 20; i += 1) {
        if (!zoomIn.hasAttribute("disabled")) await user.click(zoomIn);
      }
      expect(screen.getByTestId("graph-zoom-reset")).toHaveTextContent(
        `${DEPENDENCY_GRAPH_CONFIG.maxZoom * 100}%`,
      );
      expect(zoomIn).toBeDisabled();
    });
  });
});
