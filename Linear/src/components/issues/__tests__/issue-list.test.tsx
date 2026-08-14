/**
 * The list, driven the way a user drives it.
 *
 * These run against the whole {@link IssueView} rather than against
 * `IssueList` in isolation, because the behaviours worth protecting are the
 * ones that span the pieces: a keystroke reaching the dispatcher, resolving a
 * target through the selection, opening a picker, and landing as a patch on the
 * transport. Rendering the list alone would test the props I passed it.
 *
 * The transport is injected and records calls, so "did the bulk edit reach
 * every selected issue" is a fact about requests rather than about pixels.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { IssueId, IssueWithRelations } from "@/domain/entities";
import {
  applyPatch,
  type IssueCatalog,
  type IssueFieldPatch,
  type IssueTransport,
} from "@/lib/store/issues";
import { IssueView } from "@/components/issues/issue-view";
import {
  DONE,
  IN_PROGRESS,
  makeIssue,
  makeLabel,
  makeProject,
  makeUser,
  TEAM_ID,
  TODO,
} from "@/lib/store/__tests__/fixtures";

const alice = makeUser("usr_alice", "Alice");
const bob = makeUser("usr_bob", "Bob");
const bug = makeLabel("lbl_bug", "Bug");
const website = makeProject("prj_web", "Website");

interface Recorded {
  readonly id: IssueId;
  readonly patch: IssueFieldPatch;
}

const catalog: IssueCatalog = {
  states: new Map([
    [TODO.id, TODO],
    [IN_PROGRESS.id, IN_PROGRESS],
    [DONE.id, DONE],
  ]),
  users: new Map([
    [alice.id, alice],
    [bob.id, bob],
  ]),
  projects: new Map([[website.id, website]]),
  labels: new Map([[bug.id, bug]]),
};

/**
 * A transport that records what it was sent and **echoes the patch back**.
 *
 * Echoing matters: the store treats a response as authoritative and writes it
 * whole, so a stub that returned the unmodified row would undo every optimistic
 * change the moment it resolved — and the test would be measuring the stub's
 * dishonesty rather than the component.
 */
function recordingTransport(): {
  transport: IssueTransport;
  updates: Recorded[];
  creates: string[];
} {
  const updates: Recorded[] = [];
  const creates: string[] = [];
  const answer = (id: IssueId, patch: IssueFieldPatch): IssueWithRelations => {
    const existing = issues.find((issue) => issue.id === id) ?? makeIssue({ id });
    return applyPatch(existing, patch, catalog);
  };

  return {
    updates,
    creates,
    transport: {
      create: (request) => {
        creates.push(request.title);
        return Promise.resolve(
          makeIssue({ id: request.id, number: 99, title: request.title }),
        );
      },
      update: (id, patch) => {
        updates.push({ id, patch });
        return Promise.resolve(answer(id, patch));
      },
      reorder: (request) => {
        updates.push({ id: request.id, patch: request.patch });
        return Promise.resolve(answer(request.id, request.patch));
      },
    },
  };
}

const issues: IssueWithRelations[] = [
  makeIssue({ id: "iss_1", number: 1, title: "First", state: TODO, sortOrder: "a1" }),
  makeIssue({
    id: "iss_2",
    number: 2,
    title: "Second",
    state: TODO,
    sortOrder: "a2",
    assignee: alice,
  }),
  makeIssue({
    id: "iss_3",
    number: 3,
    title: "Third",
    state: IN_PROGRESS,
    sortOrder: "a3",
  }),
];

function renderView(transport: IssueTransport) {
  return render(
    <IssueView
      workspaceUrlKey="demo"
      crumbs={[{ label: "Engineering" }, { label: "Issues" }]}
      team={{ id: TEAM_ID, key: "ENG", name: "Engineering" }}
      currentView="all"
      basePath="/demo/team/ENG"
      issues={issues}
      catalog={{
        states: [TODO, IN_PROGRESS, DONE],
        users: [alice, bob],
        labels: [bug],
        projects: [website],
        teams: [
          { id: TEAM_ID, key: "ENG", name: "Engineering", color: "#5e6ad2" },
        ],
      }}
      initialLayout="list"
      initialGroupBy="status"
      defaultStateId={TODO.id}
      transport={transport}
    />,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IssueView — rendering", () => {
  it("renders the list, its groups and its rows by the ids the e2e suite uses", () => {
    renderView(recordingTransport().transport);

    expect(screen.getByTestId("issue-list")).toBeInTheDocument();
    expect(screen.getByTestId("issue-group-Todo")).toBeInTheDocument();
    expect(screen.getByTestId("issue-group-In Progress")).toBeInTheDocument();
    expect(screen.getByTestId("issue-row-ENG-1")).toBeInTheDocument();
    expect(screen.getByTestId("issue-row-ENG-3")).toBeInTheDocument();
  });

  it("puts the title in the row under its own id", () => {
    renderView(recordingTransport().transport);

    const row = screen.getByTestId("issue-row-ENG-1");
    expect(within(row).getByTestId("issue-row-title")).toHaveTextContent(
      "First",
    );
  });

  it("groups rows under the status they are in", () => {
    renderView(recordingTransport().transport);
    const groups = screen.getAllByRole("option");

    // Todo's two rows come before In Progress's one, because the group order is
    // the workflow's.
    expect(groups.map((row) => row.getAttribute("data-testid"))).toEqual([
      "issue-row-ENG-1",
      "issue-row-ENG-2",
      "issue-row-ENG-3",
    ]);
  });

  it("collapses a group from its header", async () => {
    const user = userEvent.setup();
    renderView(recordingTransport().transport);

    const header = screen.getByTestId("issue-group-Todo");
    await user.click(within(header).getByRole("button", { expanded: true }));

    expect(screen.queryByTestId("issue-row-ENG-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("issue-row-ENG-3")).toBeInTheDocument();
  });
});

describe("IssueView — selection", () => {
  it("selects a row with X and clears it with Escape", async () => {
    const user = userEvent.setup();
    renderView(recordingTransport().transport);

    await user.keyboard("j");
    await user.keyboard("x");
    expect(screen.getByTestId("issue-row-ENG-1")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.keyboard("{Escape}");
    expect(screen.getByTestId("issue-row-ENG-1")).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("moves the cursor with J and K", async () => {
    const user = userEvent.setup();
    renderView(recordingTransport().transport);

    await user.keyboard("jj");
    await user.keyboard("x");
    expect(screen.getByTestId("issue-row-ENG-2")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.keyboard("{Escape}k");
    await user.keyboard("x");
    expect(screen.getByTestId("issue-row-ENG-1")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("extends the selection with Shift+ArrowDown", async () => {
    const user = userEvent.setup();
    renderView(recordingTransport().transport);

    await user.keyboard("j");
    await user.keyboard("x");
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");

    expect(screen.getByTestId("issue-row-ENG-1")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("issue-row-ENG-2")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("range-selects across groups with Shift+click", async () => {
    const user = userEvent.setup();
    renderView(recordingTransport().transport);

    await user.click(
      within(screen.getByTestId("issue-row-ENG-1")).getByRole("checkbox"),
    );
    await user.keyboard("{Shift>}");
    await user.click(screen.getByTestId("issue-row-ENG-3"));
    await user.keyboard("{/Shift}");

    for (const identifier of ["ENG-1", "ENG-2", "ENG-3"]) {
      expect(screen.getByTestId(`issue-row-${identifier}`)).toHaveAttribute(
        "aria-selected",
        "true",
      );
    }
  });

  it("does not fire shortcuts while a text field has focus", async () => {
    const user = userEvent.setup();
    renderView(recordingTransport().transport);

    // `C` opens the create modal; typing `c` into its title field must not
    // re-open it, and must not fire `x`, `s` or anything else.
    await user.keyboard("c");
    const title = screen.getByTestId("new-issue-title");
    await user.type(title, "cxsapl");

    expect(title).toHaveValue("cxsapl");
    expect(screen.queryByTestId("status-picker")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("new-issue-modal")).toHaveLength(1);
  });
});

describe("IssueView — property edits", () => {
  it("opens the status picker with S and writes the chosen state", async () => {
    const user = userEvent.setup();
    const { transport, updates } = recordingTransport();
    renderView(transport);

    await user.keyboard("j");
    await user.keyboard("s");

    expect(screen.getByTestId("status-picker")).toBeInTheDocument();
    await user.click(screen.getAllByTestId("picker-option-started")[0] as Element);

    expect(updates).toEqual([
      { id: "iss_1", patch: { stateId: IN_PROGRESS.id } },
    ]);
  });

  it("applies a property edit to every selected issue", async () => {
    const user = userEvent.setup();
    const { transport, updates } = recordingTransport();
    renderView(transport);

    await user.keyboard("j");
    await user.keyboard("x");
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    await user.keyboard("a");

    expect(screen.getByTestId("assignee-picker")).toBeInTheDocument();
    await user.click(screen.getByTestId("picker-option-usr_bob@demo.test"));

    // Bulk is not a separate mode: the same key, the same picker, N requests.
    expect(updates).toEqual([
      { id: "iss_1", patch: { assigneeId: bob.id } },
      { id: "iss_2", patch: { assigneeId: bob.id } },
    ]);
  });

  it("sets priority from Shift+1 without opening anything", async () => {
    const user = userEvent.setup();
    const { transport, updates } = recordingTransport();
    renderView(transport);

    await user.keyboard("j");
    await user.keyboard("{Shift>}1{/Shift}");

    expect(updates).toEqual([{ id: "iss_1", patch: { priority: 1 } }]);
    expect(screen.queryByTestId("priority-picker")).not.toBeInTheDocument();
  });

  it("applies optimistically, before the request settles", async () => {
    const user = userEvent.setup();
    const { transport } = recordingTransport();
    renderView(transport);

    await user.keyboard("j");
    await user.keyboard("s");
    await user.click(screen.getAllByTestId("picker-option-completed")[0] as Element);

    // The row has already moved into Done's group.
    const done = screen.getByTestId("issue-group-Done");
    expect(done).toBeInTheDocument();
    expect(screen.getByTestId("issue-row-ENG-1")).toBeInTheDocument();
  });

  it("opens a picker from a row's own chip without navigating", async () => {
    const user = userEvent.setup();
    const { transport, updates } = recordingTransport();
    renderView(transport);

    const row = screen.getByTestId("issue-row-ENG-2");
    await user.click(within(row).getByLabelText(/^Priority:/));
    expect(screen.getByTestId("priority-picker")).toBeInTheDocument();

    await user.click(screen.getByTestId("picker-option-high"));
    expect(updates).toEqual([{ id: "iss_2", patch: { priority: 2 } }]);
  });
});

describe("IssueView — layout and creation", () => {
  it("toggles list and board with Cmd+B", async () => {
    const user = userEvent.setup();
    renderView(recordingTransport().transport);

    expect(screen.getByTestId("issue-list")).toBeInTheDocument();
    await user.keyboard("{Meta>}b{/Meta}");

    expect(screen.getByTestId("issue-board")).toBeInTheDocument();
    expect(screen.queryByTestId("issue-list")).not.toBeInTheDocument();
  });

  it("creates an issue optimistically and posts it", async () => {
    const user = userEvent.setup();
    const { transport, creates } = recordingTransport();
    renderView(transport);

    await user.click(screen.getByTestId("new-issue-button"));
    await user.type(screen.getByTestId("new-issue-title"), "Something new");
    await user.click(screen.getByTestId("new-issue-submit"));

    expect(creates).toEqual(["Something new"]);
    expect(screen.getByText("Something new")).toBeInTheDocument();
  });

  it("refuses to submit an empty title", async () => {
    const user = userEvent.setup();
    const { transport, creates } = recordingTransport();
    renderView(transport);

    await user.keyboard("c");
    expect(screen.getByTestId("new-issue-submit")).toBeDisabled();
    expect(creates).toEqual([]);
  });
});
