import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProjectHeader } from "../project-header";
import type { ProjectAbilities, ProjectDetailView } from "../types";

/**
 * The header, and the two things the permission journey depends on it doing.
 *
 * 1. The **first textbox inside `project-header` is the name**, and blurring it
 *    commits. The spec reaches it as
 *    `getByTestId("project-header").getByRole("textbox").first()`, so the DOM
 *    order is load-bearing and is asserted here rather than left to a reviewer
 *    to notice when a field is added above it.
 * 2. **Health is not editable.** It is written only by posting an update, which
 *    is what keeps the project row and its latest update from disagreeing about
 *    the same fact. A dropdown here would break that quietly.
 */

const PROJECT: ProjectDetailView = {
  id: "prj_site",
  slugId: "website-redesign",
  name: "Website redesign",
  summary: "",
  description: "The marketing site, rebuilt.",
  icon: "Rocket",
  color: "#5e6ad2",
  state: "started",
  health: "atRisk",
  startDate: "2026-02-01",
  targetDate: "2026-05-01",
  lead: null,
  members: [],
  teams: [],
  progress: {
    total: 4,
    completed: 1,
    started: 1,
    canceled: 0,
    scope: null,
    completedScope: null,
  },
};

const EDITABLE: ProjectAbilities = {
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

describe("editing the name", () => {
  it("is the first textbox in the header", () => {
    render(<ProjectHeader project={PROJECT} abilities={EDITABLE} />);
    const header = screen.getByTestId("project-header");
    const first = within(header).getAllByRole("textbox")[0];
    expect(first).toHaveAccessibleName("Project name");
    expect(first).toHaveValue("Website redesign");
  });

  it("commits on blur and sends only the changed field", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { project: PROJECT }));
    const user = userEvent.setup();
    render(<ProjectHeader project={PROJECT} abilities={EDITABLE} />);

    const name = screen.getByRole("textbox", { name: "Project name" });
    await user.clear(name);
    await user.type(name, "Website redesign (edited by a project member)");
    await user.tab();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/projects/prj_site");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toStrictEqual({
      name: "Website redesign (edited by a project member)",
    });
  });

  it("says the rename is outstanding until the server answers", async () => {
    // A commit-on-blur field shows the new value before anyone has been asked,
    // so the field alone cannot say whether the rename was written. Reloading
    // straight after a blur — which is what the permission journey does — is a
    // guess unless the header says the `PATCH` has been answered.
    let release!: (response: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<ProjectHeader project={PROJECT} abilities={EDITABLE} />);

    const name = screen.getByRole("textbox", { name: "Project name" });
    await user.clear(name);
    await user.type(name, "Website redesign (edited by a project member)");
    await user.tab();

    expect(name).toHaveValue("Website redesign (edited by a project member)");
    expect(screen.getByTestId("project-header")).toHaveAttribute(
      "data-pending",
      "true",
    );

    release(jsonResponse(200, { project: PROJECT }));

    await waitFor(() => {
      expect(screen.getByTestId("project-header")).toHaveAttribute(
        "data-pending",
        "false",
      );
    });
  });

  it("sends nothing when the value is unchanged", async () => {
    const user = userEvent.setup();
    render(<ProjectHeader project={PROJECT} abilities={EDITABLE} />);

    const name = screen.getByRole("textbox", { name: "Project name" });
    await user.click(name);
    await user.tab();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("restores the stored name when the server refuses", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, {
        error: "Your role does not allow this.",
        code: "INSUFFICIENT_ROLE",
      }),
    );
    const user = userEvent.setup();
    render(<ProjectHeader project={PROJECT} abilities={EDITABLE} />);

    const name = screen.getByRole("textbox", { name: "Project name" });
    await user.clear(name);
    await user.type(name, "Renamed anyway");
    await user.tab();

    await waitFor(() => {
      expect(name).toHaveValue("Website redesign");
    });
    expect(screen.getByTestId("toast")).toHaveTextContent(
      /role does not allow/i,
    );
  });

  it("renders a heading rather than a field for somebody who cannot edit", () => {
    render(
      <ProjectHeader
        project={PROJECT}
        abilities={{ ...EDITABLE, canEdit: false }}
      />,
    );
    const header = screen.getByTestId("project-header");
    expect(within(header).queryAllByRole("textbox")).toHaveLength(0);
    expect(
      within(header).getByRole("heading", { name: "Website redesign" }),
    ).toBeInTheDocument();
  });
});

describe("status and health", () => {
  it("offers status as a control", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { project: PROJECT }));
    const user = userEvent.setup();
    render(<ProjectHeader project={PROJECT} abilities={EDITABLE} />);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Project status" }),
      "completed",
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toStrictEqual({ state: "completed" });
  });

  it("shows health as a readout, never as a control", () => {
    render(<ProjectHeader project={PROJECT} abilities={EDITABLE} />);
    const header = screen.getByTestId("project-header");
    expect(header).toHaveTextContent("At risk");
    // Exactly one combobox in the header: status. Health is written by posting
    // an update and by nothing else.
    expect(within(header).getAllByRole("combobox")).toHaveLength(1);
  });
});
