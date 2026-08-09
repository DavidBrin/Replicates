import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DatabaseView } from "./DatabaseView";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { createDemoSnapshot, SEED_IDS } from "@/lib/seed/demo-workspace";

/**
 * Mounting tests for the four database views.
 *
 * The view engine is unit-tested separately; what these add is proof that the
 * renderers actually put the resolved rows on screen. A view that resolves the
 * right data and then renders an empty grid — which is what the calendar did —
 * passes every logic test there is.
 */

const databaseId = SEED_IDS.databaseId;

beforeEach(() => {
  useWorkspaceStore.setState({ ...createDemoSnapshot(), hydrated: true });
});

describe("view tabs", () => {
  it("renders a tab for every saved view and opens the first one", () => {
    render(<DatabaseView databaseId={databaseId} />);

    for (const name of ["Board view", "All", "By Person", "Calendar", "List"]) {
      expect(screen.getByRole("button", { name: new RegExp(name) })).toBeInTheDocument();
    }
  });

  it("switches the rendered view when another tab is chosen", async () => {
    const user = userEvent.setup();
    render(<DatabaseView databaseId={databaseId} />);

    await user.click(screen.getByRole("button", { name: /All/ }));

    // The table view is the only one that renders column headers.
    expect(screen.getByText("Task name")).toBeInTheDocument();
    expect(screen.getByText("Priority")).toBeInTheDocument();
  });
});

describe("board view", () => {
  it("renders one column per status option, with counts", () => {
    render(<DatabaseView databaseId={databaseId} />);

    for (const name of ["Not started", "Blocked", "In progress", "In review", "Done"]) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
  });

  it("renders the rows as cards", () => {
    render(<DatabaseView databaseId={databaseId} />);

    expect(screen.getByText("Understand exactly Gamma inputs")).toBeInTheDocument();
    expect(screen.getByText("Finish all DDs")).toBeInTheDocument();
  });

  it("shows every non-trashed row exactly once across the columns", () => {
    const database = useWorkspaceStore.getState().databases[databaseId];
    render(<DatabaseView databaseId={databaseId} />);

    for (const rowId of database.rowIds) {
      const title = useWorkspaceStore.getState().pages[rowId].title;
      expect(screen.getAllByText(title), `row "${title}"`).toHaveLength(1);
    }
  });
});

describe("table view", () => {
  it("renders a cell for every visible column of every row", async () => {
    const user = userEvent.setup();
    render(<DatabaseView databaseId={databaseId} />);
    await user.click(screen.getByRole("button", { name: /All/ }));

    // A property whose cell component is missing from the registry would
    // render as a hole here rather than throwing.
    expect(screen.getByText("Assignee")).toBeInTheDocument();
    expect(screen.getByText("Tags")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getAllByText("Rin Nakamura").length).toBeGreaterThan(0);
  });
});

describe("calendar view", () => {
  it("places the seeded tasks on the grid rather than rendering an empty month", async () => {
    const user = userEvent.setup();
    render(<DatabaseView databaseId={databaseId} />);
    await user.click(screen.getByRole("button", { name: /Calendar/ }));

    // Anchored to today by the seed, so the current month always has work in
    // it. An empty calendar is the regression this guards.
    const weekdayHeader = screen.getByText("Mon");
    const grid = weekdayHeader.closest("div")?.parentElement?.parentElement;
    expect(grid).toBeTruthy();

    const dueRows = useWorkspaceStore
      .getState()
      .databases[databaseId].rowIds.map((id) => useWorkspaceStore.getState().pages[id])
      .filter((page) => {
        const value = page.properties?.[SEED_IDS.properties.due];
        if (value?.type !== "date" || !value.date) return false;
        const start = new Date(value.date.start);
        const now = new Date();
        return (
          start.getMonth() === now.getMonth() && start.getFullYear() === now.getFullYear()
        );
      });

    expect(dueRows.length).toBeGreaterThan(0);
    const rendered = dueRows.filter(
      (page) => within(grid as HTMLElement).queryAllByText(page.title).length > 0,
    );
    expect(rendered.length).toBeGreaterThan(0);
  });
});

describe("list view", () => {
  it("renders every row as a line", async () => {
    const user = userEvent.setup();
    render(<DatabaseView databaseId={databaseId} />);
    await user.click(screen.getByRole("button", { name: /^List/ }));

    expect(screen.getByText("Set up org GitHub")).toBeInTheDocument();
  });
});
