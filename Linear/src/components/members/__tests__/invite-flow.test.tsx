import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { InviteControl } from "../invite-modal";

/**
 * The invitation flow, which on this deployment has no email in it at all.
 *
 * The assertion that matters is the last one: after a successful create, the
 * modal shows a **field containing the link**, because that field is the only
 * copy of the token that will ever exist. `lib/auth/invites.ts` stores
 * `sha256(token)` and hands the plaintext back once; a modal that closed on
 * success, or showed "Invitation sent", would silently destroy it.
 */

const TEAMS = [
  { id: "tem_eng", key: "ENG", name: "Engineering" },
  { id: "tem_des", key: "DES", name: "Design" },
];

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

describe("creating an invitation", () => {
  it("posts the form and shows the link exactly once", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, {
        url: "http://localhost:3000/invite/tok_abcdefghijklmnop",
        invite: {
          id: "inv_1",
          email: "newcomer@demo.test",
          role: "member",
          teamIds: [],
          expiresAt: "2026-04-01T00:00:00.000Z",
        },
      }),
    );
    const user = userEvent.setup();
    render(
      <InviteControl workspaceId="wsp_demo" actorRole="admin" teams={TEAMS} />,
    );

    // The dialog is not on the page until it is asked for — a member who never
    // reaches this screen cannot find its markup by reading the DOM.
    expect(screen.queryByTestId("invite-modal")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("invite-button"));
    expect(screen.getByTestId("invite-modal")).toBeInTheDocument();

    await user.type(
      screen.getByTestId("invite-email"),
      "newcomer@demo.test",
    );
    await user.selectOptions(screen.getByTestId("invite-role"), "member");
    await user.click(screen.getByTestId("invite-submit"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/invites");
    expect(JSON.parse(String(init.body))).toStrictEqual({
      workspaceId: "wsp_demo",
      email: "newcomer@demo.test",
      role: "member",
      teamIds: [],
    });

    const link = await screen.findByTestId("invite-link");
    expect(link).toHaveValue("http://localhost:3000/invite/tok_abcdefghijklmnop");
    expect(String((link as HTMLInputElement).value)).toContain("/invite/");
  });

  it("carries the selected teams, because a guest with no team sees nothing", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, {
        url: "http://localhost:3000/invite/tok_qrstuvwxyz012345",
        invite: {
          id: "inv_2",
          email: null,
          role: "guest",
          teamIds: ["tem_des"],
          expiresAt: "2026-04-01T00:00:00.000Z",
        },
      }),
    );
    const user = userEvent.setup();
    render(
      <InviteControl workspaceId="wsp_demo" actorRole="owner" teams={TEAMS} />,
    );

    await user.click(screen.getByTestId("invite-button"));
    await user.selectOptions(screen.getByTestId("invite-role"), "guest");
    await user.click(screen.getByText("Design"));
    await user.click(screen.getByTestId("invite-submit"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      role: "guest",
      teamIds: ["tem_des"],
      email: null,
    });
  });

  it("offers no role above the actor's own", async () => {
    const user = userEvent.setup();
    render(
      <InviteControl workspaceId="wsp_demo" actorRole="admin" teams={TEAMS} />,
    );
    await user.click(screen.getByTestId("invite-button"));

    const select = screen.getByTestId("invite-role");
    const values = Array.from(
      select.querySelectorAll("option"),
      (option) => option.value,
    );
    // Cosmetic only — `createInvite` refuses it under the workspace lock either
    // way — but offering a choice that always fails is its own kind of bug.
    expect(values).toStrictEqual(["admin", "member", "guest"]);
  });

  it("keeps the form open and explains when the server refuses", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, {
        error: "Your role does not allow this.",
        code: "INSUFFICIENT_ROLE",
      }),
    );
    const user = userEvent.setup();
    render(
      <InviteControl workspaceId="wsp_demo" actorRole="member" teams={TEAMS} />,
    );

    await user.click(screen.getByTestId("invite-button"));
    await user.click(screen.getByTestId("invite-submit"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /role does not allow/i,
    );
    expect(screen.queryByTestId("invite-link")).not.toBeInTheDocument();
    expect(screen.getByTestId("invite-modal")).toBeInTheDocument();
  });
});
