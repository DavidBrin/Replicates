/**
 * Grouping and ordering.
 *
 * Two things are worth testing here and the rest follows from them: that the
 * *group* order comes from the domain rather than from insertion order, and
 * that "no value" lands at the end of every axis. The priority case is the one
 * with a trap in it — `0` means *No priority* and must sort **last**, not
 * first (`domain/sorting.ts`), and a grouping that gets it wrong looks
 * plausible until you notice the unprioritised work at the top of the list.
 */

import { describe, expect, it } from "vitest";

import {
  flattenGroups,
  groupIssues,
  rangeBetween,
  startedProgressByState,
  type GroupingOptions,
} from "@/components/issues/grouping";
import {
  BACKLOG,
  DONE,
  IN_PROGRESS,
  makeIssue,
  makeLabel,
  makeProject,
  makeState,
  makeUser,
  TODO,
} from "@/lib/store/__tests__/fixtures";

const alice = makeUser("usr_alice", "Alice");
const bob = makeUser("usr_bob", "Bob");
const bug = makeLabel("lbl_bug", "Bug");
const auth = makeLabel("lbl_auth", "Auth", "#26b5ce");
const website = makeProject("prj_web", "Website");

function options(overrides: Partial<GroupingOptions> = {}): GroupingOptions {
  return {
    groupBy: "status",
    orderBy: "manual",
    direction: "asc",
    showEmptyGroups: false,
    states: [BACKLOG, TODO, IN_PROGRESS, DONE],
    users: [alice, bob],
    labels: [auth, bug],
    projects: [website],
    teams: [],
    ...overrides,
  };
}

describe("groupIssues — status", () => {
  it("orders groups by state type, then by the team's own arrangement", () => {
    const groups = groupIssues(
      [
        makeIssue({ id: "a", number: 1, state: DONE }),
        makeIssue({ id: "b", number: 2, state: BACKLOG }),
        makeIssue({ id: "c", number: 3, state: IN_PROGRESS }),
      ],
      options(),
    );

    expect(groups.map((group) => group.name)).toEqual([
      "Backlog",
      "In Progress",
      "Done",
    ]);
  });

  it("hides empty groups by default and shows them on request", () => {
    const issues = [makeIssue({ id: "a", state: TODO })];

    expect(groupIssues(issues, options()).map((g) => g.name)).toEqual(["Todo"]);
    expect(
      groupIssues(issues, options({ showEmptyGroups: true })).map((g) => g.name),
    ).toEqual(["Backlog", "Todo", "In Progress", "Done"]);
  });

  it("keeps a state the catalog did not carry rather than dropping its issues", () => {
    const foreign = makeState("sta_review", "In Review", "started", 9);
    const groups = groupIssues(
      [makeIssue({ id: "a", state: foreign })],
      options({ states: [TODO] }),
    );

    expect(groups.map((group) => group.name)).toEqual(["In Review"]);
    expect(groups[0]?.issues).toHaveLength(1);
  });

  it("writes the grouped field on a drop, and nothing on a same-column drop", () => {
    const [todo, wip] = groupIssues(
      [
        makeIssue({ id: "a", state: TODO }),
        makeIssue({ id: "b", number: 2, state: IN_PROGRESS }),
      ],
      options(),
    );

    const fromTodo = makeIssue({ id: "a", state: TODO });
    expect(wip?.patchFor(fromTodo)).toEqual({ stateId: IN_PROGRESS.id });
    expect(todo?.patchFor(fromTodo)).toEqual({});
    expect(wip?.droppable).toBe(true);
  });
});

describe("groupIssues — priority", () => {
  it("puts Urgent first and No priority last", () => {
    const groups = groupIssues(
      [
        makeIssue({ id: "a", number: 1, priority: 0 }),
        makeIssue({ id: "b", number: 2, priority: 4 }),
        makeIssue({ id: "c", number: 3, priority: 1 }),
        makeIssue({ id: "d", number: 4, priority: 3 }),
      ],
      options({ groupBy: "priority" }),
    );

    expect(groups.map((group) => group.name)).toEqual([
      "Urgent",
      "Medium",
      "Low",
      "No priority",
    ]);
  });
});

describe("groupIssues — assignee", () => {
  it("sorts people by name and puts Unassigned at the end", () => {
    const groups = groupIssues(
      [
        makeIssue({ id: "a", number: 1, assignee: bob }),
        makeIssue({ id: "b", number: 2 }),
        makeIssue({ id: "c", number: 3, assignee: alice }),
      ],
      options({ groupBy: "assignee" }),
    );

    expect(groups.map((group) => group.name)).toEqual([
      "Alice",
      "Bob",
      "Unassigned",
    ]);
    expect(groups[2]?.patchFor(makeIssue({ assignee: alice }))).toEqual({
      assigneeId: null,
    });
  });
});

describe("groupIssues — project and label", () => {
  it("puts 'No project' last", () => {
    const groups = groupIssues(
      [
        makeIssue({ id: "a", number: 1 }),
        makeIssue({ id: "b", number: 2, project: website }),
      ],
      options({ groupBy: "project" }),
    );

    expect(groups.map((group) => group.name)).toEqual(["Website", "No project"]);
  });

  it("shows an issue under every label it carries", () => {
    const groups = groupIssues(
      [makeIssue({ id: "a", labels: [bug, auth] })],
      options({ groupBy: "label" }),
    );

    expect(groups.map((group) => group.name)).toEqual(["Auth", "Bug"]);
    expect(groups[0]?.issues).toHaveLength(1);
    expect(groups[1]?.issues).toHaveLength(1);
  });

  it("adds to the label set on a drop rather than replacing it", () => {
    const groups = groupIssues(
      [
        makeIssue({ id: "a", labels: [bug] }),
        makeIssue({ id: "b", number: 2, labels: [auth] }),
      ],
      options({ groupBy: "label" }),
    );
    const authGroup = groups.find((group) => group.name === "Auth");

    expect(authGroup?.patchFor(makeIssue({ labels: [bug] }))).toEqual({
      labelIds: [bug.id, auth.id],
    });
    // Already in the group: reorder, change nothing.
    expect(authGroup?.patchFor(makeIssue({ labels: [auth] }))).toEqual({});
  });
});

describe("groupIssues — team and none", () => {
  it("refuses drops when the axis is not writable by dragging", () => {
    const byTeam = groupIssues(
      [makeIssue({ id: "a" })],
      options({ groupBy: "team" }),
    );
    const ungrouped = groupIssues(
      [makeIssue({ id: "a" })],
      options({ groupBy: "none" }),
    );

    expect(byTeam[0]?.droppable).toBe(false);
    expect(ungrouped[0]?.droppable).toBe(false);
    expect(ungrouped[0]?.name).toBe("All issues");
  });
});

describe("ordering within a group", () => {
  it("sorts by the manual key byte-wise", () => {
    const groups = groupIssues(
      [
        makeIssue({ id: "a", number: 1, sortOrder: "a2" }),
        makeIssue({ id: "b", number: 2, sortOrder: "Zz" }),
        makeIssue({ id: "c", number: 3, sortOrder: "a1" }),
      ],
      options({ groupBy: "none" }),
    );

    // "Zz" is the key for "drag to the top" and must sort first — the ICU
    // collation bug this codebase declares `collate "C"` to avoid.
    expect(groups[0]?.issues.map((issue) => issue.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts by priority with No priority last", () => {
    const groups = groupIssues(
      [
        makeIssue({ id: "a", number: 1, priority: 0 }),
        makeIssue({ id: "b", number: 2, priority: 3 }),
        makeIssue({ id: "c", number: 3, priority: 1 }),
      ],
      options({ groupBy: "none", orderBy: "priority" }),
    );

    expect(groups[0]?.issues.map((issue) => issue.id)).toEqual(["c", "b", "a"]);
  });

  it("honours the direction", () => {
    const groups = groupIssues(
      [
        makeIssue({ id: "a", number: 1, title: "Alpha" }),
        makeIssue({ id: "b", number: 2, title: "Zulu" }),
      ],
      options({ groupBy: "none", orderBy: "title", direction: "desc" }),
    );

    expect(groups[0]?.issues.map((issue) => issue.id)).toEqual(["b", "a"]);
  });
});

describe("startedProgressByState", () => {
  it("gives a lone started state a half wedge", () => {
    const progress = startedProgressByState([TODO, IN_PROGRESS, DONE]);
    expect(progress.get(IN_PROGRESS.id)).toBe(0.5);
  });

  it("gives two started states ½ and ¾, not ⅓ and ⅔", () => {
    const review = makeState("sta_review", "In Review", "started", 3);
    const progress = startedProgressByState([IN_PROGRESS, review]);

    expect(progress.get(IN_PROGRESS.id)).toBe(0.5);
    expect(progress.get(review.id)).toBe(0.75);
  });
});

describe("flattenGroups", () => {
  it("skips collapsed groups", () => {
    const groups = groupIssues(
      [
        makeIssue({ id: "a", number: 1, state: TODO }),
        makeIssue({ id: "b", number: 2, state: DONE }),
      ],
      options(),
    );
    const collapsed = new Set([groups[0]?.id ?? ""]);

    expect(flattenGroups(groups, collapsed).map((issue) => issue.id)).toEqual([
      "b",
    ]);
  });

  it("visits an issue once even when it appears in several label groups", () => {
    const groups = groupIssues(
      [makeIssue({ id: "a", labels: [bug, auth] })],
      options({ groupBy: "label" }),
    );

    expect(flattenGroups(groups).map((issue) => issue.id)).toEqual(["a"]);
  });
});

describe("rangeBetween", () => {
  const order = [
    makeIssue({ id: "a", number: 1 }),
    makeIssue({ id: "b", number: 2 }),
    makeIssue({ id: "c", number: 3 }),
    makeIssue({ id: "d", number: 4 }),
  ];

  it("selects the inclusive range in visual order", () => {
    expect(rangeBetween(order, "b", "d")).toEqual(["b", "c", "d"]);
  });

  it("works upwards as well as downwards", () => {
    expect(rangeBetween(order, "d", "b")).toEqual(["b", "c", "d"]);
  });

  it("falls back to the endpoints when an anchor has been filtered away", () => {
    expect(rangeBetween(order, "gone", "c")).toEqual(["gone", "c"]);
  });
});
