import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProjectMembersPanel } from "../project-members-panel";
import type { ProjectAbilities, ProjectMemberView, PersonView } from "../types";

/**
 * The panel that operates this clone's one deliberate divergence from Linear.
 *
 * Adding somebody here grants them edit on the project and its issues, so the
 * two assertions that matter are that the grant is *sent* and that removing
 * *sends the revocation* — an optimistic row that never reaches the server
 * would look identical on screen and leave the person locked out on reload.
 *
 * The picker's option ids are asserted by name. `e2e/README.md` makes
 * `picker-option-{value}` part of the contract, and the permission journey
 * clicks `picker-option-guest@demo.test` directly.
 */

const LEAD: ProjectMemberView = {
  id: "usr_owner",
  name: "Dana Ortega",
  email: "owner@demo.test",
  avatarUrl: null,
  avatarColor: "#5e6ad2",
  role: "lead",
};

const GUEST: PersonView = {
  id: "usr_guest",
  name: "Gil Petrov",
  email: "guest@demo.test",
  avatarUrl: null,
  avatarColor: "#f2994a",
};

const MEMBER: PersonView = {
  id: "usr_member",
  name: "Mira Castellanos",
  email: "member@demo.test",
  avatarUrl: null,
  avatarColor: "#eb5757",
};

const FULL: ProjectAbilities = {
  canEdit: true,
  canAddMember: true,
  canRemoveMember: true,
  canDelete: true,
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

function renderPanel(
  overrides: {
    members?: readonly ProjectMemberView[];
    candidates?: readonly PersonView[];
    abilities?: ProjectAbilities;
  } = {},
) {
  return render(
    <ProjectMembersPanel
      projectId="prj_site"
      members={overrides.members ?? [LEAD]}
      candidates={overrides.candidates ?? [GUEST, MEMBER]}
      abilities={overrides.abilities ?? FULL}
    />,
  );
}

describe("adding a member", () => {
  it("offers the workspace roster and posts the chosen person", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, { added: true, userId: "usr_guest" }),
    );
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByTestId("project-add-member"));
    await user.click(screen.getByTestId("picker-option-guest@demo.test"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/projects/prj_site/members");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toStrictEqual({
      userId: "usr_guest",
      role: "member",
    });

    expect(
      await screen.findByTestId("project-member-guest@demo.test"),
    ).toBeInTheDocument();
  });

  it("does not offer anybody who is already on the project", async () => {
    const user = userEvent.setup();
    renderPanel({
      members: [LEAD, { ...GUEST, role: "member" }],
    });

    await user.click(screen.getByTestId("project-add-member"));
    expect(
      screen.queryByTestId("picker-option-guest@demo.test"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("picker-option-member@demo.test"),
    ).toBeInTheDocument();
  });

  it("takes the optimistic row back and explains when the server refuses", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, {
        error: "Guests cannot hold an admin or lead role.",
        code: "GUEST_CANNOT_HOLD_ROLE",
      }),
    );
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByTestId("project-add-member"));
    await user.click(screen.getByTestId("picker-option-guest@demo.test"));

    await waitFor(() => {
      expect(screen.getByTestId("toast")).toHaveTextContent(/guests cannot/i);
    });
    expect(
      screen.queryByTestId("project-member-guest@demo.test"),
    ).not.toBeInTheDocument();
  });

  it("hides the picker entirely when the viewer may not add anybody", () => {
    renderPanel({ abilities: { ...FULL, canAddMember: false } });
    expect(screen.queryByTestId("project-add-member")).not.toBeInTheDocument();
  });
});

/**
 * A grant is not a grant until the server says so.
 *
 * The optimistic row used to be indistinguishable from a saved one, which is how
 * a `POST` that the browser cancelled on its way out of the page read as a
 * successful add — on screen, and to the permission journey, which then opened
 * the project as somebody who had never been given access to it.
 */
describe("an unanswered grant", () => {
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

  it("marks the panel and the new row pending until the POST is answered", async () => {
    const release = deferredFetch();
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByTestId("project-add-member"));
    await user.click(screen.getByTestId("picker-option-guest@demo.test"));

    const panel = screen.getByTestId("project-members");
    expect(panel).toHaveAttribute("data-pending", "true");
    const row = screen.getByTestId("project-member-guest@demo.test");
    expect(row).toHaveAttribute("data-pending", "true");
    expect(row).toHaveAttribute("aria-busy", "true");
    // Removing a grant that has not been granted yet has no correct outcome.
    expect(within(row).getByRole("button", { name: /remove/i })).toBeDisabled();

    release(jsonResponse(201, { added: true, userId: "usr_guest" }));

    await waitFor(() => {
      expect(panel).toHaveAttribute("data-pending", "false");
    });
    expect(
      screen.getByTestId("project-member-guest@demo.test"),
    ).toHaveAttribute("data-pending", "false");
  });

  it("keeps a revocation outstanding until the server confirms it", async () => {
    const release = deferredFetch();
    const user = userEvent.setup();
    renderPanel({ members: [LEAD, { ...GUEST, role: "member" }] });

    const row = screen.getByTestId("project-member-guest@demo.test");
    await user.click(within(row).getByRole("button", { name: /remove/i }));

    expect(
      screen.queryByTestId("project-member-guest@demo.test"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("project-members")).toHaveAttribute(
      "data-pending",
      "true",
    );

    release(jsonResponse(200, { removed: "usr_guest" }));

    await waitFor(() => {
      expect(screen.getByTestId("project-members")).toHaveAttribute(
        "data-pending",
        "false",
      );
    });
  });

  it("shows the person once, not twice, when the refreshed props catch up", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, { added: true, userId: "usr_guest" }),
    );
    const user = userEvent.setup();
    const view = renderPanel();

    await user.click(screen.getByTestId("project-add-member"));
    await user.click(screen.getByTestId("picker-option-guest@demo.test"));
    await waitFor(() => {
      expect(screen.getByTestId("project-members")).toHaveAttribute(
        "data-pending",
        "false",
      );
    });

    // What `router.refresh()` produces: the same person, now in the server's
    // list. The optimistic copy has to give way rather than stack on top of it —
    // two `<li>`s under one React key is a duplicated row and a console error.
    view.rerender(
      <ProjectMembersPanel
        projectId="prj_site"
        members={[LEAD, { ...GUEST, role: "member" }]}
        candidates={[MEMBER]}
        abilities={FULL}
      />,
    );

    expect(
      screen.getAllByTestId("project-member-guest@demo.test"),
    ).toHaveLength(1);
  });
});

describe("removing a member", () => {
  it("sends the revocation immediately, with no confirmation step", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { removed: "usr_guest" }));
    const user = userEvent.setup();
    renderPanel({ members: [LEAD, { ...GUEST, role: "member" }] });

    const row = screen.getByTestId("project-member-guest@demo.test");
    await user.click(within(row).getByRole("button", { name: /remove/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/projects/prj_site/members");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(String(init.body))).toStrictEqual({ userId: "usr_guest" });

    await waitFor(() => {
      expect(
        screen.queryByTestId("project-member-guest@demo.test"),
      ).not.toBeInTheDocument();
    });
  });

  it("puts the row back when the server refuses", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, {
        error: "Your role does not allow this.",
        code: "INSUFFICIENT_ROLE",
      }),
    );
    const user = userEvent.setup();
    renderPanel({ members: [LEAD, { ...GUEST, role: "member" }] });

    const row = screen.getByTestId("project-member-guest@demo.test");
    await user.click(within(row).getByRole("button", { name: /remove/i }));

    await waitFor(() => {
      expect(screen.getByTestId("toast")).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("project-member-guest@demo.test"),
    ).toBeInTheDocument();
  });

  it("offers no remove button when the viewer may not remove", () => {
    renderPanel({
      members: [LEAD, { ...GUEST, role: "member" }],
      abilities: { ...FULL, canRemoveMember: false },
    });
    const row = screen.getByTestId("project-member-guest@demo.test");
    expect(
      within(row).queryByRole("button", { name: /remove/i }),
    ).not.toBeInTheDocument();
  });
});
