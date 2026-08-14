/**
 * What the command palette offers, and in what order.
 *
 * Pure data and pure functions. The palette component renders these and hands
 * every chosen one back to its owner as a {@link CommandEffect}; nothing here
 * performs a mutation, navigates, or closes anything. Two reasons that seam is
 * where it is:
 *
 * - **The palette is built by this slice and the mutations are not.** Changing
 *   a status belongs to the issue slice's optimistic store. A palette that
 *   imported it would couple the app's most central surface to whichever slice
 *   happened to land first.
 * - **Ranking is the part worth testing, and it tests better as data.**
 *   `buildCommands` with three issues selected returns a specific list in a
 *   specific order, and asserting on that needs no DOM.
 *
 * ## Contextual scoping — the rule, verbatim
 *
 * Linear's changelog: *"Groups are then prioritized based on what you are
 * focusing on or the view you're currently in… if you are looking at cycles,
 * the command menu will first display commands that are related to cycles."*
 * and *"[the command menu shows] all actions applicable to your view or
 * selection"* (`research/04-interaction.md` §2.2).
 *
 * So the group order is a function of the context, not a constant:
 *
 * | Situation | First group |
 * |---|---|
 * | Issues selected or an issue open | **Issue** — labelled with the count |
 * | A project page | **Project** |
 * | A list or board with nothing selected | **View** |
 * | Anywhere else | **Navigation** |
 *
 * Ranking is `(groupPriority, matchScore)`. Group priority is applied *before*
 * the score, which is what makes "Change status" beat a fuzzy hit on "Go to
 * Settings" when three issues are selected — and stops doing so when none are.
 *
 * ## Sub-menus
 *
 * Picking "Change status…" must **not** execute. It pushes a page: the input
 * clears, the placeholder becomes `Change status to…`, and the list becomes the
 * team's workflow states (§2.3). The ellipsis in a label is the promise that
 * this will happen, and every command whose effect is a `submenu` carries one.
 */

import { PRIORITY_LABELS, PRIORITY_VALUES, type Priority } from "@/domain/entities";
import { shortcutById } from "@/lib/keyboard";

/* ================================================================ context = */

export interface PaletteIssue {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
}

export interface PaletteStatus {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly color: string;
}

export interface PalettePerson {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
}

export interface PaletteLabel {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

/** Which surface the palette was opened from. Drives group priority. */
export type PaletteSurface =
  | "list"
  | "board"
  | "issue"
  | "project"
  | "inbox"
  | "other";

export interface PaletteContext {
  /** The workspace URL key, for building navigation hrefs. */
  readonly workspaceKey: string;
  readonly surface: PaletteSurface;
  /**
   * The issues the next issue action would apply to.
   *
   * One list, whether it came from a multi-select, from the list cursor, or
   * from the issue detail page being open — `research/04-interaction.md` §1.11
   * calls this `targets()` and the whole point is that bulk is not a separate
   * mode. The palette shows the count and never branches on it.
   */
  readonly selection: readonly PaletteIssue[];
  /** The workflow states of the team in view, in workflow order. */
  readonly statuses: readonly PaletteStatus[];
  readonly people: readonly PalettePerson[];
  readonly labels: readonly PaletteLabel[];
  /** Teams for the navigation group. */
  readonly teams: readonly { readonly key: string; readonly name: string }[];
}

export const EMPTY_CONTEXT: PaletteContext = Object.freeze({
  workspaceKey: "",
  surface: "other",
  selection: [],
  statuses: [],
  people: [],
  labels: [],
  teams: [],
});

/* =============================================================== commands = */

export const COMMAND_GROUPS = [
  "Issue",
  "Project",
  "View",
  "Navigation",
  "Create",
  "Settings",
] as const;
export type CommandGroup = (typeof COMMAND_GROUPS)[number];

/** The sub-pages a command can push. */
export const SUBMENUS = ["status", "assignee", "priority", "label"] as const;
export type Submenu = (typeof SUBMENUS)[number];

/**
 * What the owner should do when a command is chosen.
 *
 * A closed union rather than a callback per command, so the palette can be
 * rendered in a test and its output asserted on without stubbing behaviour, and
 * so a new action is a compile error at the one place that handles them rather
 * than a silently missing branch.
 */
export type CommandEffect =
  | { readonly kind: "navigate"; readonly href: string }
  | { readonly kind: "submenu"; readonly submenu: Submenu }
  | {
      readonly kind: "run";
      /** The registry id when there is one, so the shell can reuse its handler. */
      readonly action: string;
      /** The chosen value, on a command that came from a sub-menu. */
      readonly value?: string;
    };

export interface Command {
  readonly id: string;
  readonly label: string;
  readonly group: CommandGroup;
  readonly effect: CommandEffect;
  /** Terms that are not in the label. Matched, never displayed. */
  readonly keywords?: string;
  /** A key expression from the registry, rendered as right-aligned caps. */
  readonly shortcut?: string;
  /** A swatch colour for a status or label row. */
  readonly color?: string;
  /** A status glyph type, for the rows that have one. */
  readonly stateType?: string;
}

/** A group as the palette renders it: a heading and its rows. */
export interface CommandSection {
  readonly group: CommandGroup;
  /** `Issue` becomes `3 issues` when a selection is what the actions apply to. */
  readonly label: string;
  readonly commands: readonly Command[];
}

/* ================================================================= build = */

/** Pull the key expression out of the registry so the two cannot drift. */
function keysFor(id: string): string | undefined {
  return shortcutById(id)?.keys;
}

function issueCommands(): Command[] {
  const withKeys = (
    id: string,
    label: string,
    effect: CommandEffect,
    keywords?: string,
  ): Command => {
    const shortcut = keysFor(id);
    return {
      id,
      label,
      group: "Issue",
      effect,
      ...(shortcut === undefined ? {} : { shortcut }),
      ...(keywords === undefined ? {} : { keywords }),
    };
  };

  return [
    withKeys(
      "issue.status",
      "Change status…",
      { kind: "submenu", submenu: "status" },
      "state workflow todo done progress",
    ),
    withKeys(
      "issue.assignee",
      "Change assignee…",
      { kind: "submenu", submenu: "assignee" },
      "owner who person",
    ),
    withKeys(
      "issue.priority",
      "Change priority…",
      { kind: "submenu", submenu: "priority" },
      "urgent high medium low",
    ),
    withKeys(
      "issue.label",
      "Add label…",
      { kind: "submenu", submenu: "label" },
      "tag category",
    ),
    withKeys("issue.assignToMe", "Assign to me", {
      kind: "run",
      action: "issue.assignToMe",
    }),
    withKeys("issue.dueDate", "Set due date…", {
      kind: "run",
      action: "issue.dueDate",
    }),
    withKeys("issue.estimate", "Change estimate…", {
      kind: "run",
      action: "issue.estimate",
    }),
    withKeys("issue.project", "Add to project…", {
      kind: "run",
      action: "issue.project",
    }),
    withKeys("issue.subscribe", "Subscribe / unsubscribe", {
      kind: "run",
      action: "issue.subscribe",
    }),
    withKeys("issue.blockedBy", "Mark as blocked by…", {
      kind: "run",
      action: "issue.blockedBy",
    }),
    withKeys("issue.blocking", "Mark as blocking…", {
      kind: "run",
      action: "issue.blocking",
    }),
    withKeys("issue.related", "Mark as related to…", {
      kind: "run",
      action: "issue.related",
    }),
    // `research/04-interaction.md` §1.10: duplicate is palette-only in v1,
    // because `D` sits next to `S` and `A` and an accidental duplicate is a row
    // somebody has to find and delete.
    {
      id: "issue.duplicate",
      label: "Duplicate issue",
      group: "Issue",
      effect: { kind: "run", action: "issue.duplicate" },
      keywords: "copy clone",
    },
    withKeys("issue.archive", "Archive", { kind: "run", action: "issue.archive" }),
    withKeys("issue.delete", "Delete", { kind: "run", action: "issue.delete" }),
  ];
}

function navigationCommands(context: PaletteContext): Command[] {
  const base = `/${context.workspaceKey}`;
  const nav = (
    id: string,
    label: string,
    href: string,
    keywords?: string,
  ): Command => {
    const shortcut = keysFor(id);
    return {
      id,
      label,
      group: "Navigation",
      effect: { kind: "navigate", href },
      ...(shortcut === undefined ? {} : { shortcut }),
      ...(keywords === undefined ? {} : { keywords }),
    };
  };

  const commands = [
    nav("nav.inbox", "Go to Inbox", `${base}/inbox`, "notifications unread"),
    nav("nav.myIssues", "Go to My Issues", `${base}/my-issues`, "assigned mine"),
    nav("nav.projects", "Go to Projects", `${base}/projects`, "roadmap"),
    nav("nav.settings", "Go to Settings", `${base}/settings/members`, "members teams"),
  ];

  // Every team is a destination, so a workspace with nine teams needs no
  // sidebar scroll to reach the ninth. §2.7: "every sidebar destination, every
  // team, every saved view".
  for (const team of context.teams) {
    commands.push({
      id: `nav.team.${team.key}`,
      label: `Go to ${team.name}`,
      group: "Navigation",
      effect: { kind: "navigate", href: `${base}/team/${team.key}/all` },
      keywords: `team ${team.key}`,
    });
  }
  return commands;
}

function viewCommands(): Command[] {
  const view = (id: string, label: string, keywords?: string): Command => {
    const shortcut = keysFor(id);
    return {
      id,
      label,
      group: "View",
      effect: { kind: "run", action: id },
      ...(shortcut === undefined ? {} : { shortcut }),
      ...(keywords === undefined ? {} : { keywords }),
    };
  };

  return [
    view("view.layout", "Toggle list / board", "kanban layout columns"),
    view("view.display", "Display options…", "grouping ordering properties"),
    view("view.filter", "Add filter…", "narrow where"),
    view("app.sidebar", "Toggle sidebar", "collapse expand"),
  ];
}

function createCommands(): Command[] {
  const shortcut = keysFor("issue.create");
  return [
    {
      id: "issue.create",
      label: "New issue",
      group: "Create",
      effect: { kind: "run", action: "issue.create" },
      keywords: "add file ticket create",
      ...(shortcut === undefined ? {} : { shortcut }),
    },
    {
      id: "project.create",
      label: "New project",
      group: "Create",
      effect: { kind: "run", action: "project.create" },
      keywords: "add create",
    },
  ];
}

function projectCommands(): Command[] {
  return [
    {
      id: "project.update",
      label: "Post a project update",
      group: "Project",
      effect: { kind: "run", action: "project.update" },
      keywords: "status health report",
    },
    {
      id: "project.addMember",
      label: "Add a project member…",
      group: "Project",
      effect: { kind: "run", action: "project.addMember" },
      keywords: "invite people",
    },
  ];
}

function settingsCommands(context: PaletteContext): Command[] {
  const themeShortcut = keysFor("app.theme");
  const helpShortcut = keysFor("app.help");
  return [
    {
      id: "app.theme",
      label: "Toggle theme",
      group: "Settings",
      effect: { kind: "run", action: "app.theme" },
      keywords: "dark light appearance colour color",
      ...(themeShortcut === undefined ? {} : { shortcut: themeShortcut }),
    },
    {
      id: "app.help",
      label: "Keyboard shortcuts",
      group: "Settings",
      effect: { kind: "run", action: "app.help" },
      keywords: "help cheatsheet keys",
      ...(helpShortcut === undefined ? {} : { shortcut: helpShortcut }),
    },
    {
      id: "settings.members",
      label: "Workspace members",
      group: "Settings",
      effect: {
        kind: "navigate",
        href: `/${context.workspaceKey}/settings/members`,
      },
      keywords: "people roles invitations",
    },
    {
      id: "app.signout",
      label: "Sign out",
      group: "Settings",
      effect: { kind: "run", action: "app.signout" },
      keywords: "log out leave",
    },
  ];
}

/**
 * Group priority for a context.
 *
 * Returned as an ordered list rather than a comparator so the palette can also
 * *render* in this order when no query has been typed — the ranking and the
 * resting order are the same fact, and computing them separately is how they
 * come apart.
 */
export function groupOrder(context: PaletteContext): CommandGroup[] {
  if (context.selection.length > 0 || context.surface === "issue") {
    return ["Issue", "View", "Navigation", "Create", "Project", "Settings"];
  }
  if (context.surface === "project") {
    return ["Project", "Issue", "View", "Navigation", "Create", "Settings"];
  }
  if (context.surface === "list" || context.surface === "board") {
    return ["View", "Navigation", "Create", "Issue", "Project", "Settings"];
  }
  return ["Navigation", "Create", "View", "Issue", "Project", "Settings"];
}

/**
 * Every command reachable right now, already ordered by group priority.
 *
 * Issue commands are omitted entirely when nothing is selected and no issue is
 * open, rather than shown disabled: `research/04-interaction.md` §2.7 gates
 * commands on "every registered binding whose `when()` passes", and a palette
 * full of greyed-out rows is a palette whose first three results are never the
 * answer.
 */
export function buildCommands(context: PaletteContext): Command[] {
  const targeted = context.selection.length > 0 || context.surface === "issue";
  const byGroup: Readonly<Record<CommandGroup, Command[]>> = {
    Issue: targeted ? issueCommands() : [],
    Project: context.surface === "project" ? projectCommands() : [],
    View:
      context.surface === "list" || context.surface === "board"
        ? viewCommands()
        : [],
    Navigation: navigationCommands(context),
    Create: createCommands(),
    Settings: settingsCommands(context),
  };

  return groupOrder(context).flatMap((group) => byGroup[group]);
}

/**
 * The rows of a pushed sub-page.
 *
 * The priority page is built from `PRIORITY_VALUES` rather than a literal list
 * so it cannot drift from the domain, and it is ordered Urgent → No priority
 * because that is the order the shortcuts are in (`Shift+1..4`, then
 * `Shift+0`), and the digits are shown as accelerators.
 */
export function buildSubmenu(
  submenu: Submenu,
  context: PaletteContext,
): Command[] {
  switch (submenu) {
    case "status":
      return context.statuses.map((status) => ({
        id: `status.${status.id}`,
        label: status.name,
        group: "Issue" as const,
        effect: { kind: "run" as const, action: "issue.status", value: status.id },
        color: status.color,
        stateType: status.type,
      }));

    case "assignee":
      return [
        {
          id: "assignee.none",
          label: "No assignee",
          group: "Issue" as const,
          effect: { kind: "run" as const, action: "issue.assignee", value: "" },
          keywords: "unassigned nobody clear",
        },
        ...context.people.map((person) => ({
          id: `assignee.${person.id}`,
          label: person.name,
          group: "Issue" as const,
          effect: {
            kind: "run" as const,
            action: "issue.assignee",
            value: person.id,
          },
          keywords: person.displayName,
        })),
      ];

    case "priority": {
      const ordered: Priority[] = [
        ...PRIORITY_VALUES.filter((value) => value !== 0),
        0,
      ];
      return ordered.map((value) => {
        const shortcut =
          value === 0 ? keysFor("issue.priority.none") : `shift+${value}`;
        return {
          id: `priority.${value}`,
          label: PRIORITY_LABELS[value],
          group: "Issue" as const,
          effect: {
            kind: "run" as const,
            action: "issue.priority",
            value: String(value),
          },
          ...(shortcut === undefined ? {} : { shortcut }),
        };
      });
    }

    case "label":
      return context.labels.map((label) => ({
        id: `label.${label.id}`,
        label: label.name,
        group: "Issue" as const,
        effect: { kind: "run" as const, action: "issue.label", value: label.id },
        color: label.color,
      }));
  }
}

/** The placeholder a pushed page shows, and the pill left of the input. */
export const SUBMENU_TITLES: Readonly<Record<Submenu, string>> = Object.freeze({
  status: "Change status to…",
  assignee: "Assign to…",
  priority: "Set priority to…",
  label: "Add label…",
});

/* =============================================================== ranking = */

/**
 * Score one command against a query. Higher is better; 0 means no match.
 *
 * A subsequence matcher with positional bonuses, per §2.6 — not
 * `String.includes`, which fails the two queries people actually type:
 * `cs` for "Change status" and `gi` for "Go to Inbox". The bonuses, in the
 * order they matter:
 *
 * | Signal | Why it ranks where it does |
 * |---|---|
 * | Exact prefix of the label | The user has typed the beginning of the answer |
 * | Initialism (`cs` → **C**hange **s**tatus) | The power-user's shorthand |
 * | Contiguous run | `stat` matching `status` beats it matching `Set…tags` |
 * | Match after a separator | Word starts read as intentional |
 * | Gap penalty | Decays, so a long stringy match loses to a tight one |
 * | Keyword-only hit | Real, but always below any label hit |
 *
 * The shortcut expression is indexed too, so typing `gi` surfaces "Go to
 * Inbox" even though its label contains no `gi` — §2.6 asks for exactly that.
 */
export function scoreCommand(command: Command, query: string): number {
  const needle = query.trim().toLowerCase().replace(/\s+/g, "");
  if (needle === "") return 1;

  const label = command.label.toLowerCase();

  if (label.startsWith(needle)) return 10_000 - label.length;

  const initials = label
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "")
    .map((word) => word[0] ?? "")
    .join("");
  if (initials.startsWith(needle)) return 9_000 - label.length;

  const subsequence = scoreSubsequence(label, needle);
  if (subsequence > 0) return subsequence;

  // The shortcut, spelled without separators: `gi` finds `g i`, `modk` finds
  // `mod+k`. Below every label match, because a user who typed letters that
  // happen to spell a key expression usually meant the letters.
  const shortcut = (command.shortcut ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (shortcut !== "" && shortcut.startsWith(needle)) return 2_000;

  const keywords = (command.keywords ?? "").toLowerCase();
  if (keywords.includes(needle)) return 1_000;

  return 0;
}

function scoreSubsequence(haystack: string, needle: string): number {
  let cursor = 0;
  let score = 5_000;
  let previous = -2;

  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found === -1) return 0;
    if (found === previous + 1) score += 30;
    else if (/[\s\-_/(]/.test(haystack[found - 1] ?? "")) score += 20;
    // A decaying penalty: the first skipped characters cost most, so an early
    // tight match outranks a late one without a long label being unmatchable.
    else score -= Math.min(15, found - cursor);
    previous = found;
    cursor = found + 1;
  }
  return Math.max(1, score);
}

/**
 * Filter and group, ready to render.
 *
 * Group priority is applied as a sort key *before* the score (§2.6), which is
 * the difference between a palette that adapts to context and one that merely
 * has a context-dependent list in it.
 */
export function rankCommands(
  commands: readonly Command[],
  query: string,
  context: PaletteContext,
): CommandSection[] {
  const order = groupOrder(context);
  const scored = commands
    .map((command, index) => ({
      command,
      index,
      score: scoreCommand(command, query),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        order.indexOf(a.command.group) - order.indexOf(b.command.group) ||
        b.score - a.score ||
        // Stable within a tie, so an empty query leaves the caller's order —
        // which is workflow order for statuses and priority order for
        // priorities — exactly as it was.
        a.index - b.index,
    );

  const sections: CommandSection[] = [];
  for (const entry of scored) {
    const last = sections[sections.length - 1];
    if (last !== undefined && last.group === entry.command.group) {
      (last.commands as Command[]).push(entry.command);
      continue;
    }
    sections.push({
      group: entry.command.group,
      label: sectionLabel(entry.command.group, context),
      commands: [entry.command],
    });
  }
  return sections;
}

/**
 * The heading above a group.
 *
 * `Issue` becomes `3 issues` when a selection is what the actions would apply
 * to — §2.2 asks for the group to be "labelled with the count, e.g. *3
 * issues*", and it is the only feedback in the palette that says a bulk edit is
 * about to happen.
 */
export function sectionLabel(
  group: CommandGroup,
  context: PaletteContext,
): string {
  if (group !== "Issue") return group;
  const count = context.selection.length;
  if (count === 0) return "Issue";
  if (count === 1) return context.selection[0]?.identifier ?? "Issue";
  return `${count} issues`;
}
