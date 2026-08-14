import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MembersTable, type MemberRow } from "../members-table";

/**
 * The members table, driven the way the permission journey drives it.
 *
 * The server is a stub here on purpose. What this file checks is the half the
 * route handler tests cannot see: that a refusal *reverts the control* and
 * *reaches the screen*, in that order and at the same time. `routes.test.ts`
 * proves the server refuses; this proves the person finds out.
 *
 * The last-owner case is the one that matters. It is easy to build a table
 * where the select snaps back and no message appears — which reads as the app
 * dropping the click — and just as easy to build one where the message appears
 * over a select still showing the role the server refused to grant.
 */

const OWNER: MemberRow = {
  userId: "usr_owner",
  email: "owner@demo.test",
  name: "Dana Ortega",
  displayName: "dana",
  avatarUrl: null,
  avatarColor: "#5e6ad2",
  role: "owner",
  joinedAt: "2026-01-01T00:00:00.000Z",
  active: true,
};

const NEWCOMER: MemberRow = {
  userId: "usr_newcomer",
  email: "newcomer@demo.test",
  name: "Newcomer",
  displayName: "newcomer",
  avatarUrl: null,
  avatarColor: "#26b5ce",
  role: "member",
  joinedAt: "2026-02-01T00:00:00.000Z",
  active: true,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderTable(members: readonly MemberRow[] = [OWNER, NEWCOMER]) {
  return render(
    <MembersTable
      workspaceId="wsp_demo"
      members={members}
      currentUserId={OWNER.userId}
    />,
  );
}

describe("role changes", () => {
  it("sends the change and keeps the new value when the server accepts", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { role: "admin" }));
    const user = userEvent.setup();
    renderTable();

    const select = screen.getByTestId("member-role-newcomer@demo.test");
    await user.selectOptions(select, "admin");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/workspaces/wsp_demo/members");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toStrictEqual({
      userId: "usr_newcomer",
      role: "admin",
    });

    expect(select).toHaveValue("admin");
    expect(screen.queryByTestId("toast")).not.toBeInTheDocument();
  });

  it("reverts to the stored role and explains when the server refuses", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, {
        error: "You cannot act on a member at or above your own role.",
        code: "RANK_NOT_ABOVE_TARGET",
      }),
    );
    const user = userEvent.setup();
    renderTable();

    const select = screen.getByTestId("member-role-newcomer@demo.test");
    await user.selectOptions(select, "admin");

    await waitFor(() => {
      expect(select).toHaveValue("member");
    });
    expect(screen.getByTestId("toast")).toHaveTextContent(
      /at or above your own role/i,
    );
  });
});

describe("the last owner", () => {
  it("leaves the control live and surfaces the server's refusal", async () => {
    // Not disabled. Whether this owner is the last one is a count that is only
    // true inside the transaction that writes; a control greyed out from a
    // stale render is both wrong and unexplained.
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        error: "A workspace must keep at least one owner.",
        code: "LAST_OWNER",
      }),
    );
    const user = userEvent.setup();
    renderTable();

    const select = screen.getByTestId("member-role-owner@demo.test");
    expect(select).toBeEnabled();

    await user.selectOptions(select, "admin");

    // The wording the e2e journey asserts on: the message has to name the rule
    // that was hit, not restate the invariant behind it.
    await waitFor(() => {
      expect(screen.getByTestId("toast")).toHaveTextContent(/last owner/i);
    });
    expect(select).toHaveValue("owner");
  });

  it("refuses removal the same way, leaving the row in place", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        error: "A workspace must keep at least one owner.",
        code: "LAST_OWNER",
      }),
    );
    const user = userEvent.setup();
    renderTable();

    const row = screen.getByTestId("member-row-owner@demo.test");
    await user.click(within(row).getByRole("button", { name: /remove/i }));
    await user.click(screen.getByRole("button", { name: /^remove$/i }));

    await waitFor(() => {
      expect(screen.getByTestId("toast")).toHaveTextContent(/last owner/i);
    });
    expect(screen.getByTestId("member-row-owner@demo.test")).toBeInTheDocument();
  });
});

/**
 * The difference between "sent" and "saved", which the table used to hide.
 *
 * An optimistic control that snaps to the new value and then goes quiet is
 * indistinguishable from one whose write landed — so a *dependent* action can be
 * fired against a change the server has not committed, and the outcome is
 * decided by which request the server happens to finish first. That is exactly
 * how the permission journey lost a promotion: it promoted somebody and removed
 * them in the next breath, the removal was answered first, and the removal of a
 * still-`member` account legitimately succeeded.
 */
describe("an unanswered write", () => {
  /** A `fetch` that hangs until the test decides the server has answered. */
  function deferredFetch(): (response: Response) => void {
    let release!: (response: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    return release;
  }

  it("says so on the table and on the row until the server answers", async () => {
    const release = deferredFetch();
    const user = userEvent.setup();
    renderTable();

    await user.selectOptions(
      screen.getByTestId("member-role-newcomer@demo.test"),
      "admin",
    );

    expect(screen.getByTestId("members-table")).toHaveAttribute(
      "data-pending",
      "true",
    );
    const row = screen.getByTestId("member-row-newcomer@demo.test");
    expect(row).toHaveAttribute("data-pending", "true");
    expect(row).toHaveAttribute("aria-busy", "true");
    // The owner's row is somebody else's business and stays live.
    expect(
      screen.getByTestId("member-row-owner@demo.test"),
    ).toHaveAttribute("data-pending", "false");

    release(jsonResponse(200, { role: "admin" }));

    await waitFor(() => {
      expect(screen.getByTestId("members-table")).toHaveAttribute(
        "data-pending",
        "false",
      );
    });
    expect(screen.getByTestId("member-role-newcomer@demo.test")).toHaveValue(
      "admin",
    );
  });

  it("will not let a removal overtake the role change it depends on", async () => {
    const release = deferredFetch();
    const user = userEvent.setup();
    renderTable();

    const select = screen.getByTestId("member-role-newcomer@demo.test");
    await user.selectOptions(select, "admin");

    const row = screen.getByTestId("member-row-newcomer@demo.test");
    const removeButton = within(row).getByRole("button", { name: /remove/i });
    expect(removeButton).toBeDisabled();
    expect(select).toBeDisabled();

    await user.click(removeButton);
    // Still one request: the `PATCH`. A `DELETE` here would be answered against
    // whichever role the server had at the moment it ran.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release(jsonResponse(200, { role: "admin" }));

    await waitFor(() => {
      expect(
        within(
          screen.getByTestId("member-row-newcomer@demo.test"),
        ).getByRole("button", { name: /remove/i }),
      ).toBeEnabled();
    });
  });

  it("keeps a removal outstanding until the server confirms it", async () => {
    const release = deferredFetch();
    const user = userEvent.setup();
    renderTable();

    const row = screen.getByTestId("member-row-newcomer@demo.test");
    await user.click(within(row).getByRole("button", { name: /remove/i }));
    await user.click(screen.getByRole("button", { name: /^remove$/i }));

    // The row is gone optimistically — which is precisely why its absence is
    // not yet evidence of anything. The table is the thing that knows.
    expect(
      screen.queryByTestId("member-row-newcomer@demo.test"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("members-table")).toHaveAttribute(
      "data-pending",
      "true",
    );

    release(jsonResponse(200, { removed: "usr_newcomer" }));

    await waitFor(() => {
      expect(screen.getByTestId("members-table")).toHaveAttribute(
        "data-pending",
        "false",
      );
    });
  });
});

describe("removal", () => {
  it("asks for confirmation before sending anything", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { removed: "usr_newcomer" }));
    const user = userEvent.setup();
    renderTable();

    const row = screen.getByTestId("member-row-newcomer@demo.test");
    await user.click(within(row).getByRole("button", { name: /remove/i }));
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^remove$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/workspaces/wsp_demo/members");
    expect(init.method).toBe("DELETE");
    await waitFor(() => {
      expect(
        screen.queryByTestId("member-row-newcomer@demo.test"),
      ).not.toBeInTheDocument();
    });
  });

  it("abandons cleanly when the confirmation is dismissed", async () => {
    const user = userEvent.setup();
    renderTable();

    const row = screen.getByTestId("member-row-newcomer@demo.test");
    await user.click(within(row).getByRole("button", { name: /remove/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("member-row-newcomer@demo.test"),
    ).toBeInTheDocument();
  });

  it("names the person on the row button, so the confirm button is unambiguous", () => {
    renderTable();
    // Both buttons answering to /^remove$/ would make every assertion on either
    // of them ambiguous — Playwright's strict mode turns that into a failure.
    const row = screen.getByTestId("member-row-newcomer@demo.test");
    expect(
      within(row).getByRole("button", { name: "Remove Newcomer" }),
    ).toBeInTheDocument();
    expect(
      within(row).queryByRole("button", { name: /^remove$/i }),
    ).not.toBeInTheDocument();
  });
});
