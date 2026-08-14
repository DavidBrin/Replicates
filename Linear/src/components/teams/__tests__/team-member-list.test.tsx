import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
