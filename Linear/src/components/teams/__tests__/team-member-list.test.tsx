import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  TeamMemberList,
  type TeamCandidateView,
  type TeamMemberView,
} from "../team-member-list";

/**
 * Team membership, and the two rules that are checked on the server rather than
 * pre-empted here: a guest is never a team admin (R7), and the last admin
 * cannot be demoted or removed (R5).
 *
 * Both are counts or facts about the *target's workspace role*, which this
 * component deliberately does not know. Knowing it would mean comparing it,
 * which is the one thing `SPEC.md` §4 forbids outside the policy module — so
 * the control offers the choice, the server refuses it, and the row reverts.
 */

const ADMIN: TeamMemberView = {
  id: "usr_owner",
  name: "Dana Ortega",
  email: "owner@demo.test",
  avatarUrl: null,
  avatarColor: "#5e6ad2",
  role: "admin",
};

const MEMBER: TeamMemberView = {
  id: "usr_guest",
  name: "Gil Petrov",
  email: "guest@demo.test",
  avatarUrl: null,
  avatarColor: "#f2994a",
  role: "member",
};

const CANDIDATE: TeamCandidateView = {
  id: "usr_member",
  name: "Mira Castellanos",
  email: "member@demo.test",
  avatarUrl: null,
  avatarColor: "#eb5757",
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

function renderList(canManage = true) {
  return render(
    <TeamMemberList
      teamId="tem_eng"
      members={[ADMIN, MEMBER]}
      candidates={[CANDIDATE]}
      canManage={canManage}
    />,
  );
}

describe("role changes", () => {
  it("posts the change and keeps it when the server accepts", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { role: "admin" }));
    const user = userEvent.setup();
    renderList();

    const select = screen.getByTestId("team-member-role-guest@demo.test");
    await user.selectOptions(select, "admin");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/teams/tem_eng/members");
    expect(init.method).toBe("PATCH");
    expect(select).toHaveValue("admin");
  });

  it("reverts when the server says a guest cannot administer a team", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, {
        error: "Guests cannot hold an admin or lead role.",
        code: "GUEST_CANNOT_HOLD_ROLE",
      }),
    );
    const user = userEvent.setup();
    renderList();

    const select = screen.getByTestId("team-member-role-guest@demo.test");
    await user.selectOptions(select, "admin");

    await waitFor(() => {
      expect(select).toHaveValue("member");
    });
    expect(screen.getByTestId("toast")).toHaveTextContent(/guests cannot/i);
  });

  it("reverts and explains when the last admin is demoted", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        error: "A team must keep at least one admin.",
        code: "LAST_TEAM_ADMIN",
      }),
    );
    const user = userEvent.setup();
    renderList();

    const select = screen.getByTestId("team-member-role-owner@demo.test");
    expect(select).toBeEnabled();
    await user.selectOptions(select, "member");

    await waitFor(() => {
      expect(screen.getByTestId("toast")).toHaveTextContent(
        /at least one admin/i,
      );
    });
    expect(select).toHaveValue("admin");
  });
});

/* ============================================================ concurrency = */

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Two role changes for one member, overlapping.
 *
 * Both of this screen's rules — a guest may not hold admin (R7), a team keeps
 * one admin (R5) — are decided against the row the server currently holds, so
 * two writes for the same member are *ordered* operations. Sent together they
 * arrive in whichever order the network chooses, and the row is left showing
 * the second value while the database holds the first: the select says Member,
 * the team says Admin, and nothing on screen ever says otherwise.
 *
 * The requests are genuine deferred promises settled concurrently rather than a
 * simulated ordering, because "can a second write leave before the first is
 * answered" is the whole question.
 */
describe("overlapping role changes", () => {
  it("refuses a second write for a member whose first is unanswered", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    fetchMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const user = userEvent.setup();
    renderList();
    const select = screen.getByTestId("team-member-role-guest@demo.test");

    await user.selectOptions(select, "admin");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Unanswered, and it says so: the row is busy rather than forbidden.
    expect(select).toBeDisabled();
    expect(screen.getByTestId("team-member-guest@demo.test")).toHaveAttribute(
      "data-pending",
      "true",
    );

    // A second change attempted before the answer lands — through the DOM
    // event, because a disabled control is a hint and the guard is the code.
    fireEvent.change(select, { target: { value: "member" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await Promise.all([
        first.resolve(jsonResponse(200, { role: "admin" })),
        second.resolve(jsonResponse(200, { role: "member" })),
      ]);
    });

    // The value on screen is the value of the one request that was sent.
    await waitFor(() => {
      expect(select).toBeEnabled();
    });
    expect(select).toHaveValue("admin");
    const bodies = fetchMock.mock.calls.map(([, init]) =>
      JSON.parse(String((init as RequestInit).body)),
    );
    expect(bodies).toStrictEqual([{ userId: "usr_guest", role: "admin" }]);
  });

  it("does not make one member's write wait behind another's", async () => {
    const forGuest = deferred<Response>();
    const forOwner = deferred<Response>();
    fetchMock
      .mockReturnValueOnce(forGuest.promise)
      .mockReturnValueOnce(forOwner.promise);

    const user = userEvent.setup();
    renderList();

    await user.selectOptions(
      screen.getByTestId("team-member-role-guest@demo.test"),
      "admin",
    );
    await user.selectOptions(
      screen.getByTestId("team-member-role-owner@demo.test"),
      "member",
    );

    // Per member, not per table: a queue that serialised the whole screen would
    // make administering a team feel broken.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await Promise.all([
        forOwner.resolve(jsonResponse(200, { role: "member" })),
        forGuest.resolve(jsonResponse(200, { role: "admin" })),
      ]);
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("team-member-role-guest@demo.test"),
      ).toBeEnabled();
    });
    expect(screen.getByTestId("team-member-role-guest@demo.test")).toHaveValue(
      "admin",
    );
    expect(screen.getByTestId("team-member-role-owner@demo.test")).toHaveValue(
      "member",
    );
  });

  it("refuses a removal for a member whose role change is still in flight", async () => {
    const first = deferred<Response>();
    fetchMock.mockReturnValueOnce(first.promise);

    const user = userEvent.setup();
    renderList();
    const row = screen.getByTestId("team-member-guest@demo.test");

    await user.selectOptions(
      screen.getByTestId("team-member-role-guest@demo.test"),
      "admin",
    );
    expect(within(row).getByRole("button", { name: /remove/i })).toBeDisabled();

    // Promotion then removal is the ordered pair the server's answer depends on.
    fireEvent.click(within(row).getByRole("button", { name: /remove/i }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("team-member-guest@demo.test")).toBeInTheDocument();

    await act(async () => {
      first.resolve(jsonResponse(200, { role: "admin" }));
    });
    await waitFor(() => {
      expect(
        within(row).getByRole("button", { name: /remove/i }),
      ).toBeEnabled();
    });
  });
});

describe("membership", () => {
  it("adds from the picker", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, { added: true, userId: "usr_member" }),
    );
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByTestId("team-add-member"));
    await user.click(screen.getByTestId("picker-option-member@demo.test"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/teams/tem_eng/members");
    expect(JSON.parse(String(init.body))).toStrictEqual({
      userId: "usr_member",
      role: "member",
    });
  });

  it("puts a row back when removal is refused", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        error: "A team must keep at least one admin.",
        code: "LAST_TEAM_ADMIN",
      }),
    );
    const user = userEvent.setup();
    renderList();

    const row = screen.getByTestId("team-member-owner@demo.test");
    await user.click(within(row).getByRole("button", { name: /remove/i }));

    await waitFor(() => {
      expect(screen.getByTestId("toast")).toHaveTextContent(
        /at least one admin/i,
      );
    });
    expect(screen.getByTestId("team-member-owner@demo.test")).toBeInTheDocument();
  });

  it("renders roles as text and offers no controls to somebody who may not manage", () => {
    renderList(false);
    expect(screen.queryByTestId("team-add-member")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("team-member-role-guest@demo.test"),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("team-member-guest@demo.test")).queryByRole(
        "button",
      ),
    ).not.toBeInTheDocument();
  });
});
