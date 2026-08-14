import { describe, expect, it } from "vitest";

import {
  buildCommands,
  buildSubmenu,
  EMPTY_CONTEXT,
  groupOrder,
  rankCommands,
  scoreCommand,
  sectionLabel,
  type Command,
  type PaletteContext,
} from "@/components/command-palette/commands";

/**
 * The palette's model: what it offers, in what order, and how it scores.
 *
 * Asserted as data rather than through the rendered component, because the
 * behaviour worth protecting here is a *ranking* — and a ranking asserted by
 * reading DOM rows tests the renderer as well, which means it can go green for
 * the wrong reason and red for a class name.
 */

const ISSUE = { id: "iss_1", identifier: "ENG-12", title: "Fix the drift" };

function context(overrides: Partial<PaletteContext> = {}): PaletteContext {
  return {
    ...EMPTY_CONTEXT,
    workspaceKey: "demo",
    teams: [{ key: "ENG", name: "Engineering" }],
    statuses: [
      { id: "sta_backlog", name: "Backlog", type: "backlog", color: "#8a8f98" },
      { id: "sta_todo", name: "Todo", type: "unstarted", color: "#8a8f98" },
      { id: "sta_prog", name: "In Progress", type: "started", color: "#f2c94c" },
      { id: "sta_done", name: "Done", type: "completed", color: "#5e6ad2" },
    ],
    people: [
      { id: "usr_1", name: "Dana Ortega", displayName: "dana" },
      { id: "usr_2", name: "Mira Castellanos", displayName: "mira" },
    ],
    labels: [{ id: "lbl_1", name: "Bug", color: "#eb5757" }],
    ...overrides,
  };
}

const ids = (commands: readonly Command[]): string[] =>
  commands.map((command) => command.id);

/* ==================================================== contextual scoping = */

describe("context sensitivity", () => {
  it("offers no issue actions when nothing is selected", () => {
    // Not disabled rows: a palette whose first three results are always greyed
    // out is a palette whose first three results are never the answer.
    const commands = buildCommands(context());
    expect(ids(commands)).not.toContain("issue.status");
    expect(ids(commands)).toContain("nav.inbox");
  });

  it("offers this issue's actions the moment one is selected", () => {
    const commands = buildCommands(context({ selection: [ISSUE] }));
    expect(ids(commands)).toContain("issue.status");
    expect(ids(commands)).toContain("issue.assignee");
    expect(ids(commands)).toContain("issue.priority");
  });

  it("offers them on the issue detail page with no selection", () => {
    // §1.11's `targets()`: the issue in the route counts, so bulk is not a
    // separate mode and the detail page needs no second code path.
    const commands = buildCommands(context({ surface: "issue" }));
    expect(ids(commands)).toContain("issue.status");
  });

  it("puts the Issue group first when there is a selection", () => {
    expect(groupOrder(context({ selection: [ISSUE] }))[0]).toBe("Issue");
  });

  it("puts the View group first on a list with nothing selected", () => {
    expect(groupOrder(context({ surface: "list" }))[0]).toBe("View");
  });

  it("puts the Project group first on a project page", () => {
    expect(groupOrder(context({ surface: "project" }))[0]).toBe("Project");
  });

  it("labels the Issue group with the count of what it will touch", () => {
    // §2.2 asks for "3 issues"; it is the only feedback in the palette that
    // says a bulk edit is about to happen.
    expect(sectionLabel("Issue", context({ selection: [ISSUE] }))).toBe("ENG-12");
    expect(
      sectionLabel(
        "Issue",
        context({
          selection: [ISSUE, { ...ISSUE, id: "iss_2" }, { ...ISSUE, id: "iss_3" }],
        }),
      ),
    ).toBe("3 issues");
  });

  it("makes every team a navigation destination", () => {
    const commands = buildCommands(
      context({ teams: [{ key: "ENG", name: "Engineering" }] }),
    );
    const team = commands.find((command) => command.id === "nav.team.ENG");
    expect(team?.effect).toEqual({
      kind: "navigate",
      href: "/demo/team/ENG/all",
    });
  });

  it("ranks issue actions above navigation when a selection exists", () => {
    // Group priority is a sort key applied *before* the score (§2.6). Without
    // it, a fuzzy hit on "Go to Settings" can outrank "Change status".
    const ctx = context({ selection: [ISSUE] });
    const sections = rankCommands(buildCommands(ctx), "s", ctx);
    expect(sections[0]?.group).toBe("Issue");
  });

  it("stops ranking them first when the selection goes away", () => {
    const ctx = context({ surface: "list" });
    const sections = rankCommands(buildCommands(ctx), "", ctx);
    expect(sections[0]?.group).toBe("View");
  });
});

/* =============================================================== submenus = */

describe("sub-menus", () => {
  it("makes Change status a submenu rather than an action", () => {
    // The distinction the whole two-step flow rests on: picking it must push a
    // page, not apply a status the user never chose.
    const status = buildCommands(context({ selection: [ISSUE] })).find(
      (command) => command.id === "issue.status",
    );
    expect(status?.effect).toEqual({ kind: "submenu", submenu: "status" });
    expect(status?.label).toMatch(/…$/);
  });

  it("builds the status page from the team's workflow, in workflow order", () => {
    const page = buildSubmenu("status", context());
    expect(page.map((command) => command.label)).toEqual([
      "Backlog",
      "Todo",
      "In Progress",
      "Done",
    ]);
    expect(page[2]?.effect).toEqual({
      kind: "run",
      action: "issue.status",
      value: "sta_prog",
    });
  });

  it("keeps the workflow order when the query is empty", () => {
    const ctx = context();
    const sections = rankCommands(buildSubmenu("status", ctx), "", ctx);
    expect(sections[0]?.commands.map((command) => command.label)).toEqual([
      "Backlog",
      "Todo",
      "In Progress",
      "Done",
    ]);
  });

  it("offers No assignee before the people", () => {
    const page = buildSubmenu("assignee", context());
    expect(page[0]?.label).toBe("No assignee");
    expect(page[0]?.effect).toEqual({
      kind: "run",
      action: "issue.assignee",
      value: "",
    });
  });

  it("orders priority urgent-first and hangs the digits off it", () => {
    // Urgent…Low then No priority, matching the Shift+1..4 / Shift+0 order the
    // shortcuts already impose.
    const page = buildSubmenu("priority", context());
    expect(page.map((command) => command.label)).toEqual([
      "Urgent",
      "High",
      "Medium",
      "Low",
      "No priority",
    ]);
    expect(page[0]?.shortcut).toBe("shift+1");
    expect(page[4]?.shortcut).toBe("shift+0");
  });
});

/* ================================================================ scoring = */

describe("fuzzy matching", () => {
  const command = (label: string, extra: Partial<Command> = {}): Command => ({
    id: label,
    label,
    group: "Issue",
    effect: { kind: "run", action: label },
    ...extra,
  });

  it("prefers an exact prefix over anything else", () => {
    const prefix = scoreCommand(command("Change status…"), "chan");
    const middle = scoreCommand(command("Quickly change something"), "chan");
    expect(prefix).toBeGreaterThan(middle);
  });

  it("matches an initialism — cs finds Change status", () => {
    // The query a power user actually types, and the one `String.includes`
    // cannot answer at all.
    expect(scoreCommand(command("Change status…"), "cs")).toBeGreaterThan(0);
    expect(scoreCommand(command("Change status…"), "cs")).toBeGreaterThan(
      scoreCommand(command("Copy the issue's slug"), "cs"),
    );
  });

  it("matches a subsequence — ip finds In Progress", () => {
    expect(scoreCommand(command("In Progress"), "ip")).toBeGreaterThan(0);
  });

  it("indexes the shortcut expression — gi finds Go to Inbox", () => {
    // §2.6 asks for this explicitly. The label contains no "gi".
    const inbox = command("Go to Inbox", { shortcut: "g i" });
    expect(scoreCommand(inbox, "gi")).toBeGreaterThan(0);
  });

  it("indexes keywords, but below every label match", () => {
    const byKeyword = command("Change status…", { keywords: "workflow state" });
    const byLabel = command("Workflow settings");
    expect(scoreCommand(byKeyword, "workflow")).toBeGreaterThan(0);
    expect(scoreCommand(byLabel, "workflow")).toBeGreaterThan(
      scoreCommand(byKeyword, "workflow"),
    );
  });

  it("returns zero for a genuine miss", () => {
    expect(scoreCommand(command("Change status…"), "zzz")).toBe(0);
  });

  it("keeps every command when the query is empty", () => {
    const ctx = context({ selection: [ISSUE] });
    const all = buildCommands(ctx);
    const ranked = rankCommands(all, "", ctx).flatMap((s) => s.commands);
    expect(ranked).toHaveLength(all.length);
  });
});
