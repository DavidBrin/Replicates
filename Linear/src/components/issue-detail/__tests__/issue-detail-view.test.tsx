import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { IssueDetailView } from "@/components/issue-detail/issue-detail-view";

import { activity, comment, detailData, issueRef, MIRA, stubFetch } from "./fixtures";

/**
 * The pane, assembled.
 *
 * Two things are asserted here that no smaller component can be asked about:
 * the **keyboard map**, which is global to the pane by definition, and the fact
 * that a picker selection **reaches the network** rather than only updating
 * local state — an optimistic UI that never sends the request looks perfect in
 * a component test and loses every edit in production.
 */

const originalFetch = globalThis.fetch;

describe("IssueDetailView — layout", () => {
  beforeEach(() => {
    stubFetch();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders the header, the editors, the affordances and the activity section", () => {
    render(
      <IssueDetailView
        data={detailData({
          comments: [comment({ id: "cmt_1" })],
          activity: [activity({ id: "act_1" })],
        })}
      />,
    );

    expect(screen.getByTestId("issue-header")).toHaveTextContent("ENG-1");
    expect(screen.getByTestId("issue-position")).toHaveTextContent("1 / 9");
    expect(screen.getByTestId("issue-title")).toHaveValue("An issue title");
    expect(screen.getByTestId("issue-description")).toHaveTextContent(
      "Since we depend on AWS",
    );
    expect(screen.getByTestId("issue-reactions-add")).toBeInTheDocument();
    expect(screen.getByTestId("issue-attach")).toBeDisabled();
    expect(screen.getByTestId("add-sub-issue")).toBeInTheDocument();
    expect(screen.getByTestId("issue-activity")).toBeInTheDocument();
    expect(screen.getByTestId("comment-composer")).toBeInTheDocument();
    expect(screen.getByTestId("comment-submit")).toBeInTheDocument();
    expect(screen.getByTestId("issue-properties")).toBeInTheDocument();
  });

  it("disables the previous arrow at the top of the list and links the next", () => {
    render(<IssueDetailView data={detailData()} />);
    expect(screen.getByTestId("issue-prev")).toBeDisabled();
    expect(screen.getByTestId("issue-next")).toHaveAttribute(
      "href",
      "/demo/issue/ENG-2",
    );
  });

  it("renders sub-issues with their progress", () => {
    render(
      <IssueDetailView
        data={detailData({
          subIssues: [
            issueRef({ id: "iss_a", identifier: "ENG-2", stateType: "completed" }),
            issueRef({ id: "iss_b", identifier: "ENG-3" }),
          ],
        })}
      />,
    );
    expect(screen.getByTestId("sub-issue-progress")).toHaveTextContent("1/2");
    expect(screen.getByTestId("sub-issue-ENG-2")).toBeInTheDocument();
  });

  it("groups relations, and demotes a resolved blocker to Related", () => {
    // §1.5: "Once the blocking issue has been resolved, the relationship moves
    // under Related." A display rule — the stored type is untouched.
    render(
      <IssueDetailView
        data={detailData({
          relations: [
            {
              id: "rel_open",
              type: "blocked_by",
              relatedIdentifier: "ENG-9",
              relatedTitle: "Still open",
              relatedStateType: "started",
            },
            {
              id: "rel_done",
              type: "blocked_by",
              relatedIdentifier: "ENG-8",
              relatedTitle: "Finished",
              relatedStateType: "completed",
            },
          ],
        })}
      />,
    );

    expect(screen.getByTestId("relation-group-blocked_by")).toBeInTheDocument();
    expect(screen.getByTestId("relation-group-related")).toBeInTheDocument();
    // The stored type survives the regrouping.
    expect(screen.getByTestId("relation-rel_done")).toHaveAttribute(
      "data-relation-type",
      "blocked_by",
    );
  });

  it("renders read-only when the viewer may not edit", () => {
    render(<IssueDetailView data={detailData({ canEdit: false, canComment: false })} />);
    expect(screen.getByTestId("issue-title")).toHaveAttribute("readonly");
    expect(screen.getByTestId("issue-property-status")).toBeDisabled();
    expect(screen.getByTestId("add-sub-issue")).toBeDisabled();
    expect(screen.getByTestId("comment-composer")).toBeDisabled();
  });
});

describe("IssueDetailView — keyboard", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("opens the matching picker for S, A, P and L", async () => {
    const user = userEvent.setup();
    stubFetch();
    render(<IssueDetailView data={detailData()} />);

    for (const [key, testId] of [
      ["s", "status-picker"],
      ["a", "assignee-picker"],
      ["p", "priority-picker"],
      ["l", "label-picker"],
    ] as const) {
      await user.keyboard(`{Escape}${key}`);
      expect(screen.getByTestId(testId), key).toBeInTheDocument();
    }
  });

  it("puts the due date on Shift+D, not on bare D", async () => {
    const user = userEvent.setup();
    stubFetch();
    render(<IssueDetailView data={detailData()} />);

    await user.keyboard("d");
    expect(screen.queryByTestId("due-date-picker")).toBeNull();

    await user.keyboard("{Shift>}D{/Shift}");
    expect(screen.getByTestId("due-date-picker")).toBeInTheDocument();
  });

  it("treats M as a chord prefix and never as a binding", async () => {
    const user = userEvent.setup();
    stubFetch();
    render(<IssueDetailView data={detailData()} />);

    await user.keyboard("m");
    expect(screen.queryByTestId("relation-picker")).toBeNull();

    await user.keyboard("b");
    expect(screen.getByTestId("relation-picker")).toBeInTheDocument();
  });

  it("opens a relation picker for each of B, X and R", async () => {
    const user = userEvent.setup();
    stubFetch();
    render(<IssueDetailView data={detailData()} />);

    for (const key of ["b", "x", "r"] as const) {
      await user.keyboard(`{Escape}m${key}`);
      expect(screen.getByTestId("relation-picker"), key).toBeInTheDocument();
    }
  });

  it("closes any picker on Escape", async () => {
    const user = userEvent.setup();
    stubFetch();
    render(<IssueDetailView data={detailData()} />);

    await user.keyboard("s");
    expect(screen.getByTestId("status-picker")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("status-picker")).toBeNull());
  });

  it("does not fire shortcuts while a text field has focus", async () => {
    // Typing "Ship the parser" would otherwise open the status picker on S and
    // the priority picker on P.
    const user = userEvent.setup();
    stubFetch();
    render(<IssueDetailView data={detailData()} />);

    await user.click(screen.getByTestId("issue-title"));
    await user.keyboard("sapl");

    expect(screen.queryByTestId("status-picker")).toBeNull();
    expect(screen.queryByTestId("assignee-picker")).toBeNull();
    expect(screen.queryByTestId("priority-picker")).toBeNull();
    expect(screen.queryByTestId("label-picker")).toBeNull();
  });

  it("does not arm shortcuts at all on a read-only issue", async () => {
    const user = userEvent.setup();
    stubFetch();
    render(<IssueDetailView data={detailData({ canEdit: false })} />);

    await user.keyboard("s");
    expect(screen.queryByTestId("status-picker")).toBeNull();
  });
});

describe("IssueDetailView — mutations reach the network", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("PATCHes the issue when a picker applies, and updates the chip first", async () => {
    const user = userEvent.setup();
    const { calls } = stubFetch();
    render(<IssueDetailView data={detailData()} />);

    await user.click(screen.getByTestId("issue-property-status"));
    await user.click(
      within(screen.getByTestId("status-picker")).getByTestId("picker-option-completed"),
    );

    expect(screen.getByTestId("issue-property-status")).toHaveTextContent("Done");
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.url).toBe("/api/issues/iss_1");
    expect(calls[0]?.init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ stateId: "sta_done" });
  });

  it("rolls back only the field it touched when the request fails", async () => {
    const user = userEvent.setup();
    // The response is held open so the optimistic state is observable. Letting
    // it resolve immediately would make this assert only the end state, and an
    // implementation that never applied the change optimistically would pass.
    let release = (): void => {};
    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => {
        release = () =>
          resolve({
            ok: false,
            status: 403,
            json: () => Promise.resolve({ error: "Your role does not allow this." }),
          } as Response);
      })) as unknown as typeof fetch;

    render(<IssueDetailView data={detailData()} />);

    await user.click(screen.getByTestId("issue-property-priority"));
    await user.click(
      within(screen.getByTestId("priority-picker")).getByTestId("picker-option-1"),
    );

    // Applied before the round trip finishes — that is the whole point.
    expect(screen.getByTestId("issue-property-priority")).toHaveTextContent("Urgent");

    release();
    await waitFor(() =>
      expect(screen.getByTestId("issue-property-priority")).toHaveTextContent("Medium"),
    );
    // …and only that field moved back. The rest is untouched.
    expect(screen.getByTestId("issue-property-status")).toHaveTextContent("In Progress");
    expect(screen.getByTestId("issue-property-assignee")).toHaveTextContent(
      "Dana Okafor",
    );
  });

  it("posts a comment on Cmd+Enter and renders it optimistically", async () => {
    const user = userEvent.setup();
    const { calls } = stubFetch(() => ({
      id: "cmt_server",
      parentId: null,
      createdAt: "2026-08-04T09:00:00.000Z",
      editedAt: null,
    }));
    render(<IssueDetailView data={detailData()} />);

    await user.click(screen.getByTestId("comment-composer"));
    await user.keyboard("looks good to me");
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.url).toBe("/api/comments");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      issueId: "iss_1",
      body: "looks good to me",
      parentId: null,
    });
    await waitFor(() =>
      expect(screen.getByTestId("comment-cmt_server")).toBeInTheDocument(),
    );
  });

  it("posts a sub-issue title and leaves the field ready for the next one", async () => {
    const user = userEvent.setup();
    const { calls } = stubFetch(() => ({ id: "iss_new", identifier: "ENG-10" }));
    render(<IssueDetailView data={detailData()} />);

    await user.click(screen.getByTestId("add-sub-issue"));
    const field = screen.getByTestId("sub-issue-title");
    await user.type(field, "Write the parser{Enter}");

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.url).toBe("/api/issues");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      parentId: "iss_1",
      title: "Write the parser",
    });
    // §1.4: saving reopens the editor for the next one.
    await waitFor(() => expect(field).toHaveValue(""));
    expect(field).toHaveFocus();
  });

  it("posts a relation to the issue's relations endpoint", async () => {
    const user = userEvent.setup();
    const { calls } = stubFetch(() => ({
      id: "rel_new",
      type: "blocked_by",
      relatedIdentifier: "ENG-2",
      relatedTitle: "Second issue",
      relatedStateType: "unstarted",
    }));
    render(<IssueDetailView data={detailData()} />);

    await user.keyboard("mb");
    await user.click(
      within(screen.getByTestId("relation-picker")).getByTestId("picker-option-iss_2"),
    );

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.url).toBe("/api/issues/iss_1/relations");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      relatedIssueId: "iss_2",
      type: "blocked_by",
    });
    await waitFor(() =>
      expect(screen.getByTestId("relation-rel_new")).toBeInTheDocument(),
    );
  });

  it("toggles a reaction on the description through the reactions endpoint", async () => {
    const user = userEvent.setup();
    const { calls } = stubFetch(() => ({ id: "rct_server", emoji: "🎉", userId: "usr_dana" }));
    render(<IssueDetailView data={detailData()} />);

    await user.click(screen.getByTestId("issue-reactions-add"));
    await user.click(screen.getByTestId("emoji-option-🎉"));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.url).toBe("/api/reactions");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      issueId: "iss_1",
      emoji: "🎉",
    });
  });

  it("deletes a comment through its own endpoint", async () => {
    const user = userEvent.setup();
    const { calls } = stubFetch();
    render(
      <IssueDetailView data={detailData({ comments: [comment({ id: "cmt_mine" })] })} />,
    );

    await user.click(screen.getByTestId("comment-delete-cmt_mine"));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.url).toBe("/api/comments/cmt_mine");
    expect(calls[0]?.init.method).toBe("DELETE");
    expect(screen.queryByTestId("comment-cmt_mine")).toBeNull();
  });

  it("does not offer edit or delete on someone else's comment", () => {
    stubFetch();
    render(
      <IssueDetailView
        data={detailData({ comments: [comment({ id: "cmt_theirs", user: MIRA })] })}
      />,
    );
    expect(screen.queryByTestId("comment-edit-cmt_theirs")).toBeNull();
    expect(screen.queryByTestId("comment-delete-cmt_theirs")).toBeNull();
  });
});
