import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CommandPalette } from "@/components/command-palette/command-palette";
import {
  EMPTY_CONTEXT,
  type CommandEffect,
  type PaletteContext,
} from "@/components/command-palette/commands";
import { KeyboardDispatcher, KeyboardProvider } from "@/lib/keyboard";

/**
 * The palette, driven the way a user drives it.
 *
 * The e2e suite's `runCommand` helper depends on exactly two ids —
 * `command-palette` and `command-palette-input` — and on `Cmd+K` opening the
 * thing. Those are asserted first and by name, because renaming one is a
 * breaking change to a contract this slice does not own (`e2e/README.md`).
 *
 * Everything after that is the behaviour that distinguishes a palette from a
 * filtered list: it adapts to the selection, and a two-step command pushes a
 * page instead of executing.
 */

const ISSUE = { id: "iss_1", identifier: "ENG-12", title: "Fix the drift" };

function context(overrides: Partial<PaletteContext> = {}): PaletteContext {
  return {
    ...EMPTY_CONTEXT,
    workspaceKey: "demo",
    statuses: [
      { id: "sta_todo", name: "Todo", type: "unstarted", color: "#8a8f98" },
      { id: "sta_prog", name: "In Progress", type: "started", color: "#f2c94c" },
      { id: "sta_done", name: "Done", type: "completed", color: "#5e6ad2" },
    ],
    people: [{ id: "usr_1", name: "Dana Ortega", displayName: "dana" }],
    labels: [{ id: "lbl_1", name: "Bug", color: "#eb5757" }],
    teams: [{ key: "ENG", name: "Engineering" }],
    ...overrides,
  };
}

/**
 * Mount the palette with its own dispatcher.
 *
 * A fresh dispatcher per test rather than the ambient one, so a scope left
 * registered by a previous test cannot decide this one's outcome.
 */
function mount(overrides: Partial<PaletteContext> = {}) {
  const onCommand = vi.fn<(effect: CommandEffect) => void>();
  const dispatcher = new KeyboardDispatcher();
  const view = render(
    <KeyboardProvider dispatcher={dispatcher}>
      <CommandPalette context={context(overrides)} onCommand={onCommand} />
    </KeyboardProvider>,
  );
  return { onCommand, dispatcher, view };
}

async function open(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.keyboard("{Meta>}k{/Meta}");
}

/* ================================================================ opening = */

describe("the e2e contract", () => {
  it("opens on Cmd+K and exposes command-palette and command-palette-input", async () => {
    const user = userEvent.setup();
    mount();

    expect(screen.queryByTestId("command-palette")).toBeNull();
    await open(user);

    expect(screen.getByTestId("command-palette")).toBeVisible();
    expect(screen.getByTestId("command-palette-input")).toBeVisible();
  });

  it("opens on Ctrl+K too", async () => {
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.getByTestId("command-palette")).toBeVisible();
  });

  it("runs the top match on Enter after typing a label", async () => {
    // This is `runCommand` in `e2e/fixtures.ts`, exactly: fill, press Enter.
    const user = userEvent.setup();
    const { onCommand } = mount({ surface: "list" });
    await open(user);

    await user.type(screen.getByTestId("command-palette-input"), "Toggle theme");
    await user.keyboard("{Enter}");

    expect(onCommand).toHaveBeenCalledWith(
      { kind: "run", action: "app.theme" },
      expect.objectContaining({ id: "app.theme" }),
    );
    expect(screen.queryByTestId("command-palette")).toBeNull();
  });

  it("is a dialog, and the input is a combobox that keeps focus", async () => {
    const user = userEvent.setup();
    mount();
    await open(user);

    const palette = screen.getByTestId("command-palette");
    expect(palette).toHaveAttribute("role", "dialog");
    expect(palette).toHaveAttribute("aria-modal", "true");

    const input = screen.getByTestId("command-palette-input");
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("role", "combobox");

    // Arrowing must not move DOM focus — that is what lets you keep typing.
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveFocus();
    expect(input.getAttribute("aria-activedescendant")).toBeTruthy();
  });
});

/* ==================================================== context sensitivity = */

describe("context sensitivity", () => {
  it("offers no issue actions with nothing selected", async () => {
    const user = userEvent.setup();
    mount();
    await open(user);

    expect(screen.queryByTestId("command-issue.status")).toBeNull();
    expect(screen.getByTestId("command-nav.inbox")).toBeInTheDocument();
  });

  it("offers the selected issue's actions, headed by its identifier", async () => {
    const user = userEvent.setup();
    mount({ selection: [ISSUE] });
    await open(user);

    expect(screen.getByTestId("command-issue.status")).toBeInTheDocument();
    expect(screen.getByText("ENG-12")).toBeInTheDocument();
  });

  it("heads the group with a count when several are selected", async () => {
    const user = userEvent.setup();
    mount({
      selection: [ISSUE, { ...ISSUE, id: "iss_2" }, { ...ISSUE, id: "iss_3" }],
    });
    await open(user);

    expect(screen.getByText("3 issues")).toBeInTheDocument();
  });

  it("shows the shortcut for a command that has one", async () => {
    const user = userEvent.setup();
    mount({ selection: [ISSUE] });
    await open(user);

    // The hint reads from the registry, so it cannot name a key the dispatcher
    // does not bind. `Shortcut` renders the spoken form for screen readers.
    const row = screen.getByTestId("command-issue.dueDate");
    expect(within(row).getByText("shift+d")).toBeInTheDocument();
  });
});

/* =============================================================== submenus = */

describe("sub-menus", () => {
  it("pushes a page instead of executing when a submenu command is chosen", async () => {
    const user = userEvent.setup();
    const { onCommand } = mount({ selection: [ISSUE] });
    await open(user);

    await user.click(screen.getByTestId("command-issue.status"));

    // Nothing ran, the palette is still open, and the rows are now statuses.
    expect(onCommand).not.toHaveBeenCalled();
    expect(screen.getByTestId("command-palette")).toBeVisible();
    expect(screen.getByTestId("command-status.sta_prog")).toBeInTheDocument();
    expect(screen.getByTestId("command-palette-breadcrumb")).toHaveTextContent(
      "Change status to",
    );
  });

  it("clears the query when it pushes", async () => {
    const user = userEvent.setup();
    mount({ selection: [ISSUE] });
    await open(user);

    const input = screen.getByTestId("command-palette-input");
    await user.type(input, "status");
    await user.click(screen.getByTestId("command-issue.status"));

    // Otherwise the query that found "Change status…" also filters the statuses,
    // and the page opens showing nothing.
    expect(input).toHaveValue("");
    expect(screen.getByTestId("command-status.sta_todo")).toBeInTheDocument();
  });

  it("executes the chosen status and closes", async () => {
    const user = userEvent.setup();
    const { onCommand } = mount({ selection: [ISSUE] });
    await open(user);

    await user.click(screen.getByTestId("command-issue.status"));
    await user.click(screen.getByTestId("command-status.sta_done"));

    expect(onCommand).toHaveBeenCalledWith(
      { kind: "run", action: "issue.status", value: "sta_done" },
      expect.objectContaining({ label: "Done" }),
    );
    expect(screen.queryByTestId("command-palette")).toBeNull();
  });

  it("pops the page on Backspace at an empty input, and not otherwise", async () => {
    const user = userEvent.setup();
    mount({ selection: [ISSUE] });
    await open(user);
    await user.click(screen.getByTestId("command-issue.status"));

    const input = screen.getByTestId("command-palette-input");
    await user.type(input, "don");
    await user.keyboard("{Backspace}");

    // Backspacing over a typo must not throw away the page you are on.
    expect(input).toHaveValue("do");
    expect(screen.getByTestId("command-status.sta_done")).toBeInTheDocument();

    await user.keyboard("{Backspace}{Backspace}{Backspace}");
    expect(screen.getByTestId("command-issue.status")).toBeInTheDocument();
  });

  it("pops one level on Escape, and closes at the root", async () => {
    const user = userEvent.setup();
    mount({ selection: [ISSUE] });
    await open(user);
    await user.click(screen.getByTestId("command-issue.status"));

    await user.keyboard("{Escape}");
    expect(screen.getByTestId("command-palette")).toBeVisible();
    expect(screen.getByTestId("command-issue.status")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("command-palette")).toBeNull();
  });
});

/* ============================================================== searching = */

describe("searching", () => {
  it("narrows on an initialism", async () => {
    const user = userEvent.setup();
    mount({ selection: [ISSUE] });
    await open(user);

    await user.type(screen.getByTestId("command-palette-input"), "cs");
    expect(screen.getByTestId("command-issue.status")).toBeInTheDocument();
  });

  it("shows an empty state rather than nothing at all", async () => {
    const user = userEvent.setup();
    mount();
    await open(user);

    await user.type(screen.getByTestId("command-palette-input"), "zzzzzz");
    expect(screen.getByTestId("command-palette-empty")).toBeInTheDocument();
  });

  it("navigates with the arrows and runs the highlighted row", async () => {
    const user = userEvent.setup();
    const { onCommand } = mount();
    await open(user);

    await user.type(screen.getByTestId("command-palette-input"), "go to");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onCommand).toHaveBeenCalledTimes(1);
    const [effect] = onCommand.mock.calls[0] ?? [];
    expect(effect).toMatchObject({ kind: "navigate" });
  });
});

/* ============================================================= the modal = */

describe("as a modal scope", () => {
  it("blocks the list underneath from claiming a key", async () => {
    const user = userEvent.setup();
    const { dispatcher } = mount();
    const fired: string[] = [];
    dispatcher.register("view", [
      { id: "view.filter", keys: "f", run: () => fired.push("filter") },
    ]);

    await open(user);
    // `f` typed into the palette's own input is a character, not a shortcut —
    // both the input guard and the modal scope have to hold for this to pass.
    await user.type(screen.getByTestId("command-palette-input"), "f");

    expect(fired).toEqual([]);
  });
});
