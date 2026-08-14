/**
 * The board's drop → field-write mapping.
 *
 * `planDrop` is a pure function precisely so this can be a real test rather
 * than a simulation of a drag: jsdom has no layout engine, so every
 * `getBoundingClientRect` is zero and a test driven through pointer events
 * would only ever exercise index 0. Separating "where did the pointer land"
 * (measured, untestable here) from "what does landing there mean" (arithmetic,
 * entirely testable) puts the rule that matters under test.
 *
 * Two conversions are what this is really checking: the index is rebased past
 * the cards being dragged, and multi-card keys chain instead of colliding.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { keyBetween } from "@/domain/ordering";
import { groupIssues, type GroupingOptions } from "@/components/issues/grouping";
import { IssueBoard, planDrop } from "@/components/issues/issue-board";
import {
  BACKLOG,
  DONE,
  IN_PROGRESS,
  makeIssue,
  makeUser,
  TODO,
} from "@/lib/store/__tests__/fixtures";

const alice = makeUser("usr_alice", "Alice");

function options(overrides: Partial<GroupingOptions> = {}): GroupingOptions {
  return {
    groupBy: "status",
    orderBy: "manual",
    direction: "asc",
    showEmptyGroups: true,
    states: [BACKLOG, TODO, IN_PROGRESS, DONE],
    users: [alice],
    labels: [],
    projects: [],
    teams: [],
    ...overrides,
  };
}

const todoA = makeIssue({ id: "a", number: 1, state: TODO, sortOrder: "a1" });
const todoB = makeIssue({ id: "b", number: 2, state: TODO, sortOrder: "a2" });
const todoC = makeIssue({ id: "c", number: 3, state: TODO, sortOrder: "a3" });
const wipD = makeIssue({ id: "d", number: 4, state: IN_PROGRESS, sortOrder: "a5" });

function groupNamed(name: string, issues = [todoA, todoB, todoC, wipD]) {
  const group = groupIssues(issues, options()).find(
    (candidate) => candidate.name === name,
  );
  if (!group) throw new Error(`no group named ${name}`);
  return group;
}

describe("planDrop — across columns", () => {
  it("writes the grouped field and a key between the drop's neighbours", () => {
    const [request, ...rest] = planDrop({
      dragged: [todoA],
      group: groupNamed("In Progress"),
      index: 1,
    });

    expect(rest).toHaveLength(0);
    expect(request?.id).toBe("a");
    expect(request?.patch.stateId).toBe(IN_PROGRESS.id);
    expect(request?.beforeKey).toBe("a5");
    expect(request?.afterKey).toBeNull();
    expect(request?.patch.sortOrder).toBe(keyBetween("a5", null));
  });

  it("carries the neighbours the server will recompute from", () => {
    const [request] = planDrop({
      dragged: [todoA],
      group: groupNamed("In Progress"),
      index: 0,
    });

    expect(request?.beforeKey).toBeNull();
    expect(request?.afterKey).toBe("a5");
    // Deterministic on both sides, so the reconcile is a no-op.
    expect(request?.patch.sortOrder).toBe(keyBetween(null, "a5"));
  });

  it("reassigns when the board is grouped by assignee", () => {
    const grouped = groupIssues(
      [makeIssue({ id: "a", sortOrder: "a1" })],
      options({ groupBy: "assignee" }),
    );
    const aliceColumn = grouped.find((group) => group.name === "Alice");
    if (!aliceColumn) throw new Error("no Alice column");

    const [request] = planDrop({
      dragged: [makeIssue({ id: "a", sortOrder: "a1" })],
      group: aliceColumn,
      index: 0,
    });

    expect(request?.patch.assigneeId).toBe(alice.id);
  });

  it("repriorities when the board is grouped by priority", () => {
    const grouped = groupIssues(
      [makeIssue({ id: "a", priority: 0, sortOrder: "a1" })],
      options({ groupBy: "priority" }),
    );
    const urgent = grouped.find((group) => group.name === "Urgent");
    if (!urgent) throw new Error("no Urgent column");

    const [request] = planDrop({
      dragged: [makeIssue({ id: "a", priority: 0, sortOrder: "a1" })],
      group: urgent,
      index: 0,
    });

    expect(request?.patch.priority).toBe(1);
  });
});

describe("planDrop — within a column", () => {
  it("writes only the order key", () => {
    const [request] = planDrop({
      dragged: [todoA],
      group: groupNamed("Todo"),
      index: 3,
    });

    expect(request?.patch.stateId).toBeUndefined();
    expect(request?.patch.sortOrder).toBe(keyBetween("a3", null));
  });

  it("rebases the index past the cards being dragged", () => {
    // Index 2 counts the dragged card itself, which is still rendered. With
    // `a` removed the neighbours are `b` and `c`, not `c` and nothing.
    const [request] = planDrop({
      dragged: [todoA],
      group: groupNamed("Todo"),
      index: 2,
    });

    expect(request?.beforeKey).toBe("a2");
    expect(request?.afterKey).toBe("a3");
  });

  it("produces a key that genuinely sorts between the neighbours", () => {
    const [request] = planDrop({
      dragged: [todoC],
      group: groupNamed("Todo"),
      index: 1,
    });
    const key = request?.patch.sortOrder ?? "";

    expect(key > "a1").toBe(true);
    expect(key < "a2").toBe(true);
  });
});

describe("planDrop — several cards", () => {
  it("chains the keys so two cards do not collide", () => {
    const requests = planDrop({
      dragged: [todoA, todoB],
      group: groupNamed("In Progress"),
      index: 1,
    });

    expect(requests).toHaveLength(2);
    const [first, second] = requests;
    expect(first?.patch.sortOrder).not.toBe(second?.patch.sortOrder);
    expect(
      (first?.patch.sortOrder ?? "") < (second?.patch.sortOrder ?? ""),
    ).toBe(true);
    // The second card's left neighbour is the first card's brand-new key, which
    // is what the server recomputes from.
    expect(second?.beforeKey).toBe(first?.patch.sortOrder);
  });

  it("gives every dragged card the target column's field", () => {
    const requests = planDrop({
      dragged: [todoA, todoB],
      group: groupNamed("Done"),
      index: 0,
    });

    expect(requests.map((request) => request.patch.stateId)).toEqual([
      DONE.id,
      DONE.id,
    ]);
  });
});

describe("planDrop — refusals", () => {
  it("returns nothing for a column that cannot be written by dragging", () => {
    const [ungrouped] = groupIssues([todoA], options({ groupBy: "none" }));
    if (!ungrouped) throw new Error("no group");

    expect(planDrop({ dragged: [todoA], group: ungrouped, index: 0 })).toEqual(
      [],
    );
  });

  it("returns nothing when nothing is being dragged", () => {
    expect(
      planDrop({ dragged: [], group: groupNamed("Todo"), index: 0 }),
    ).toEqual([]);
  });
});

describe("IssueBoard", () => {
  const noop = (): void => {};

  function renderBoard() {
    return render(
      <IssueBoard
        groups={groupIssues([todoA, todoB, wipD], options())}
        selected={new Set()}
        focusedId={null}
        pending={{}}
        progressByState={new Map()}
        properties={["priority", "identifier", "status", "assignee"]}
        hrefFor={(issue) => `/demo/issue/${issue.identifier}`}
        onOpen={noop}
        onSelect={noop}
        onFocus={noop}
        onOpenPicker={noop}
        onCreateInGroup={noop}
        onMove={noop}
      />,
    );
  }

  it("renders one column per group, addressable by name", () => {
    renderBoard();

    expect(screen.getByTestId("issue-board")).toBeInTheDocument();
    expect(screen.getByTestId("board-column-Todo")).toBeInTheDocument();
    expect(screen.getByTestId("board-column-In Progress")).toBeInTheDocument();
    expect(screen.getByTestId("board-column-Done")).toBeInTheDocument();
  });

  it("puts each card in the column its grouped field names", () => {
    renderBoard();

    const todo = screen.getByTestId("board-column-Todo");
    expect(todo).toContainElement(screen.getByTestId("board-card-ENG-1"));
    expect(todo).toContainElement(screen.getByTestId("board-card-ENG-2"));

    expect(screen.getByTestId("board-column-In Progress")).toContainElement(
      screen.getByTestId("board-card-ENG-4"),
    );
  });

  it("makes cards draggable", () => {
    renderBoard();
    expect(screen.getByTestId("board-card-ENG-1")).toHaveAttribute(
      "draggable",
      "true",
    );
  });
});
