/**
 * The shortcut map, as data.
 *
 * One declarative list, and everything that shows a shortcut reads from it: the
 * `?` help overlay, the command palette's right-aligned hints, and the
 * dispatcher itself, which takes a binding's keys and scope from here when the
 * caller supplies only an id. `research/04-interaction.md` §1.11 asks for
 * exactly this — "keep bindings declarative in one file so the `?` help modal
 * and the command palette can both be generated from it" — and the reason is
 * drift: a help overlay written by hand documents the app as it was, and the
 * only thing worse than no shortcut documentation is confidently wrong shortcut
 * documentation.
 *
 * ## What is deliberately not here
 *
 * The research resolves several bindings that this clone does not ship, and the
 * omissions are decisions rather than gaps (§1.10):
 *
 * - **`E`.** KeyCombiner, pie-menu and FastShortcuts all say "edit issue";
 *   ShortcutFoo says `Option+E`. The sources genuinely disagree, the action is
 *   low value next to `Enter` (open) and `R` (rename), and a bare `E` sitting
 *   between `S` and `A` on the home row is an expensive thing to guess wrong.
 *   `research/04-interaction.md` §1.10 recommends not shipping it. Not shipped.
 * - **`D` / `Cmd+D` (duplicate).** Palette-only, for the same reason: `D` is
 *   one key away from `S` and `A`, and an accidental duplicate is a row the
 *   user has to find and delete.
 * - **Bare `1`–`4`.** Reserved for Triage. This is *why* priority is on
 *   `Shift+1..4`; binding both would make the reservation meaningless.
 * - **The `O` chord family** (quick-open pickers). The command palette and `/`
 *   search reach every one of those destinations, so a second, less
 *   discoverable path to them is surface area without capability.
 * - **Cycles** (`Shift+C`, `G` `C`, `G` `V`). Cut from the product entirely,
 *   `SPEC.md` §1.
 *
 * ## The corrections that matter
 *
 * Four bindings below contradict the obvious guess, and each is a place a clone
 * built from intuition gets it wrong:
 *
 * | Key | This app | The obvious guess |
 * |---|---|---|
 * | `Cmd+B` | list ⇄ board | toggle sidebar |
 * | `[` | toggle sidebar | — |
 * | `Shift+D` | due date | `D` |
 * | `Shift+1..4` | priority | bare `1..4` |
 * | `M` | chord prefix only, never bare | "move"/"mark" as a single key |
 *
 * ## `G` `I`
 *
 * `SPEC.md` §6 lists `G` then `I` as *My Issues*. `research/04-interaction.md`
 * §1.3 records `G` `I` as **Inbox** and `G` `M` as **My Issues**, both tagged
 * **C** — confirmed from Linear's own documentation. `SPEC.md` §6's own
 * preamble defers to that document ("Conflicts are resolved there"), so this
 * registry ships the research's mapping and puts My Issues on `G` `M`, where
 * Linear has it. Both destinations are reachable; only the letter differs from
 * the SPEC's summary table.
 */

import { parseSequence, sequenceKey, type KeyToken } from "./keys";

/* ================================================================ scopes = */

/**
 * Where a binding lives in the stack.
 *
 * Four levels, lowest first. The **topmost scope that claims a key wins**, and
 * levels are ranked rather than merely stacked so that mount order cannot
 * decide precedence — React mounts a list before the modal that covers it, and
 * a LIFO-only stack would then let the list keep `Escape`.
 *
 * - `global` — always mounted. Palette, search, help, theme, sidebar.
 * - `view` — a list, a board, the inbox. Cursor movement, view-level toggles.
 * - `selection` — one or more issues focused or selected. Property actions.
 * - `modal` — a dialog, the palette, a picker, an open editor. **Blocking**:
 *   resolution stops here, except for a small allowlist, because a modal that
 *   lets `s` through to the list behind it is a modal that changes a status the
 *   user cannot see.
 */
export const SCOPES = ["global", "view", "selection", "modal"] as const;
export type Scope = (typeof SCOPES)[number];

export const SCOPE_LEVEL: Readonly<Record<Scope, number>> = Object.freeze({
  global: 0,
  view: 1,
  selection: 2,
  modal: 3,
});

/** Scopes that stop the walk down the stack. */
export function isBlockingScope(scope: Scope): boolean {
  return scope === "modal";
}

/**
 * What a blocking scope still lets past.
 *
 * `research/04-interaction.md` §1.11: "on a `modal: true` scope it stops after
 * that scope (plus a small allowlist: `Escape`, `Cmd+Enter`, `Cmd+K`,
 * `Cmd+Z`)". Without the allowlist, `Cmd+K` inside the create-issue modal does
 * nothing and the palette stops being the app's universal surface.
 */
export const MODAL_PASSTHROUGH: readonly KeyToken[] = [
  "escape",
  "mod+enter",
  "mod+k",
  "mod+z",
  "mod+shift+z",
];

/* ================================================================ groups = */

/**
 * The help overlay's sections, in display order.
 *
 * Also the palette's grouping, which is why the two lists are one list —
 * `research/04-interaction.md` §1.11 asks for the `group` field to serve "the
 * `?` modal AND the palette grouping".
 */
export const SHORTCUT_GROUPS = [
  "Application",
  "Navigation",
  "Issue",
  "View",
  "Inbox",
] as const;
export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

/* =============================================================== entries = */

export interface ShortcutSpec {
  /** Stable identity. The dispatcher binds behaviour to this. */
  readonly id: string;
  /**
   * The key expression, in the same spelling `<Shortcut keys>` renders.
   *
   * `"s"`, `"shift+d"`, `"mod+k"`, `"g i"`. A space means a chord: press and
   * release the first key, then the second.
   */
  readonly keys: string;
  readonly scope: Scope;
  readonly group: ShortcutGroup;
  /** Imperative, and the same string the palette shows. */
  readonly label: string;
  /** Shown under the label in the help overlay when the label needs a caveat. */
  readonly note?: string;
  /**
   * Extra search terms for the palette and the searchable help overlay.
   *
   * The palette's matcher already indexes the label and the key expression;
   * this is for the words a user would type that are in neither ("state" for
   * "Change status", "owner" for "Change assignee").
   */
  readonly keywords?: string;
  /**
   * Hide from the palette — true for pure cursor movement.
   *
   * "Move down" is a real binding that belongs in the help overlay and is
   * meaningless as a palette command: by the time you have typed it, the row
   * you wanted to move to has scrolled past.
   */
  readonly paletteHidden?: boolean;
}

/**
 * Every shortcut this app ships.
 *
 * Ordered by group, then by how often a hand reaches for it, because this order
 * is what the help overlay renders and the palette falls back to when no query
 * has been typed.
 */
export const SHORTCUTS: readonly ShortcutSpec[] = [
  /* ---------------------------------------------------------- application */
  {
    id: "app.palette",
    keys: "mod+k",
    scope: "global",
    group: "Application",
    label: "Open command palette",
    keywords: "command menu actions cmdk",
  },
  {
    id: "app.search",
    keys: "/",
    scope: "global",
    group: "Application",
    label: "Search",
    keywords: "find issues projects identifier",
  },
  {
    id: "app.help",
    keys: "?",
    scope: "global",
    group: "Application",
    label: "Keyboard shortcuts",
    keywords: "help cheatsheet keys bindings",
  },
  {
    id: "app.escape",
    keys: "escape",
    scope: "global",
    group: "Application",
    label: "Close, or clear the selection",
    note: "One level per press — picker, then modal, then selection.",
    paletteHidden: true,
  },
  {
    id: "app.sidebar",
    keys: "[",
    scope: "global",
    group: "Application",
    label: "Toggle sidebar",
    note: "Not Cmd+B — that is the list/board toggle.",
    keywords: "collapse expand navigation rail",
  },
  {
    id: "app.theme",
    keys: "mod+shift+l",
    scope: "global",
    group: "Application",
    label: "Toggle theme",
    keywords: "dark light appearance",
  },
  {
    id: "app.submit",
    keys: "mod+enter",
    scope: "modal",
    group: "Application",
    label: "Save and close",
    paletteHidden: true,
  },

  /* ----------------------------------------------------------- navigation */
  {
    id: "nav.inbox",
    keys: "g i",
    scope: "global",
    group: "Navigation",
    label: "Go to Inbox",
    keywords: "notifications unread",
  },
  {
    id: "nav.myIssues",
    keys: "g m",
    scope: "global",
    group: "Navigation",
    label: "Go to My Issues",
    keywords: "assigned created subscribed mine",
  },
  {
    id: "nav.backlog",
    keys: "g b",
    scope: "global",
    group: "Navigation",
    label: "Go to Backlog",
    keywords: "unstarted later",
  },
  {
    id: "nav.active",
    keys: "g a",
    scope: "global",
    group: "Navigation",
    label: "Go to Active issues",
    keywords: "in progress started",
  },
  {
    id: "nav.projects",
    keys: "g p",
    scope: "global",
    group: "Navigation",
    label: "Go to Projects",
    keywords: "roadmap initiatives milestones",
  },
  {
    id: "nav.settings",
    keys: "g s",
    scope: "global",
    group: "Navigation",
    label: "Go to Settings",
    keywords: "preferences members teams workspace",
  },

  /* ---------------------------------------------------------------- issue */
  {
    id: "issue.create",
    keys: "c",
    scope: "global",
    group: "Issue",
    label: "New issue",
    keywords: "create add file ticket",
  },
  {
    id: "issue.status",
    keys: "s",
    scope: "selection",
    group: "Issue",
    label: "Change status…",
    keywords: "state workflow todo done progress",
  },
  {
    id: "issue.assignee",
    keys: "a",
    scope: "selection",
    group: "Issue",
    label: "Change assignee…",
    keywords: "owner who person",
  },
  {
    id: "issue.assignToMe",
    keys: "i",
    scope: "selection",
    group: "Issue",
    label: "Assign to me",
    keywords: "self mine take",
  },
  {
    id: "issue.priority",
    keys: "p",
    scope: "selection",
    group: "Issue",
    label: "Change priority…",
    keywords: "urgent high medium low",
  },
  {
    id: "issue.label",
    keys: "l",
    scope: "selection",
    group: "Issue",
    label: "Add label…",
    keywords: "tag category",
  },
  {
    id: "issue.project",
    keys: "shift+p",
    scope: "selection",
    group: "Issue",
    label: "Add to project…",
    keywords: "move project",
  },
  {
    id: "issue.estimate",
    keys: "shift+e",
    scope: "selection",
    group: "Issue",
    label: "Change estimate…",
    keywords: "points size fibonacci",
  },
  {
    id: "issue.dueDate",
    keys: "shift+d",
    scope: "selection",
    group: "Issue",
    label: "Set due date…",
    note: "Shift+D, not D — Linear's docs supersede the stale Cmd+D sheets.",
    keywords: "deadline date target",
  },
  {
    id: "issue.priority.urgent",
    keys: "shift+1",
    scope: "selection",
    group: "Issue",
    label: "Set priority to Urgent",
    note: "Bare 1–3 belong to Triage, which is why priority is shifted.",
    keywords: "p0 urgent",
  },
  {
    id: "issue.priority.high",
    keys: "shift+2",
    scope: "selection",
    group: "Issue",
    label: "Set priority to High",
    keywords: "p1 high",
  },
  {
    id: "issue.priority.medium",
    keys: "shift+3",
    scope: "selection",
    group: "Issue",
    label: "Set priority to Medium",
    keywords: "p2 medium",
  },
  {
    id: "issue.priority.low",
    keys: "shift+4",
    scope: "selection",
    group: "Issue",
    label: "Set priority to Low",
    keywords: "p3 low",
  },
  {
    id: "issue.priority.none",
    keys: "shift+0",
    scope: "selection",
    group: "Issue",
    label: "Clear priority",
    keywords: "no priority none",
  },
  {
    id: "issue.subscribe",
    keys: "shift+s",
    scope: "selection",
    group: "Issue",
    label: "Subscribe / unsubscribe",
    keywords: "watch follow notifications",
  },
  {
    id: "issue.favorite",
    keys: "alt+f",
    scope: "selection",
    group: "Issue",
    label: "Toggle favorite",
    keywords: "star bookmark pin",
  },
  {
    id: "issue.rename",
    keys: "r",
    scope: "selection",
    group: "Issue",
    label: "Rename",
    note: "Inline title edit. There is deliberately no bare E — see §1.10.",
    keywords: "edit title",
  },
  {
    id: "issue.blockedBy",
    keys: "m b",
    scope: "selection",
    group: "Issue",
    label: "Mark as blocked by…",
    note: "M is only ever a chord prefix; there is no bare M.",
    keywords: "relation blocker depends",
  },
  {
    id: "issue.blocking",
    keys: "m x",
    scope: "selection",
    group: "Issue",
    label: "Mark as blocking…",
    keywords: "relation blocks",
  },
  {
    id: "issue.related",
    keys: "m r",
    scope: "selection",
    group: "Issue",
    label: "Mark as related to…",
    keywords: "relation link",
  },
  {
    id: "issue.archive",
    keys: "#",
    scope: "selection",
    group: "Issue",
    label: "Archive",
    keywords: "hide remove close",
  },
  {
    id: "issue.delete",
    keys: "mod+backspace",
    scope: "selection",
    group: "Issue",
    label: "Delete",
    note: "Recoverable — 30 days in Recently deleted.",
    keywords: "trash remove",
  },

  /* ----------------------------------------------------------------- view */
  {
    id: "view.layout",
    keys: "mod+b",
    scope: "view",
    group: "View",
    label: "Toggle list / board",
    note: "Cmd+B is the layout toggle. The sidebar is [.",
    keywords: "board list kanban layout",
  },
  {
    id: "view.display",
    keys: "shift+v",
    scope: "view",
    group: "View",
    label: "Display options…",
    keywords: "grouping ordering properties",
  },
  {
    id: "view.filter",
    keys: "f",
    scope: "view",
    group: "View",
    label: "Add filter…",
    keywords: "filter narrow where",
  },
  {
    id: "view.findInView",
    keys: "mod+f",
    scope: "view",
    group: "View",
    label: "Find in view",
    keywords: "search filter rows",
  },
  {
    id: "view.selectAll",
    keys: "mod+a",
    scope: "view",
    group: "View",
    label: "Select all",
    paletteHidden: true,
  },
  {
    id: "view.toggleSelect",
    keys: "x",
    scope: "view",
    group: "View",
    label: "Toggle selection",
    paletteHidden: true,
  },
  {
    id: "view.cursorDown",
    keys: "j",
    scope: "view",
    group: "View",
    label: "Move down",
    paletteHidden: true,
  },
  {
    id: "view.cursorUp",
    keys: "k",
    scope: "view",
    group: "View",
    label: "Move up",
    paletteHidden: true,
  },
  {
    id: "view.open",
    keys: "enter",
    scope: "view",
    group: "View",
    label: "Open",
    paletteHidden: true,
  },

  /* ---------------------------------------------------------------- inbox */
  {
    id: "inbox.toggleRead",
    keys: "u",
    scope: "view",
    group: "Inbox",
    label: "Mark read / unread",
    keywords: "seen unseen",
  },
  {
    id: "inbox.markAllRead",
    keys: "alt+u",
    scope: "view",
    group: "Inbox",
    label: "Mark all as read",
    keywords: "clear inbox zero",
  },
  {
    id: "inbox.snooze",
    keys: "h",
    scope: "view",
    group: "Inbox",
    label: "Snooze",
    note: "Reappears when the timestamp passes — there is no unsnooze job.",
    keywords: "remind later defer",
  },
  {
    id: "inbox.delete",
    keys: "backspace",
    scope: "view",
    group: "Inbox",
    label: "Delete notification",
    keywords: "dismiss remove",
  },
];

/* =============================================================== indexes = */

const BY_ID = new Map<string, ShortcutSpec>(
  SHORTCUTS.map((entry) => [entry.id, entry]),
);

export function shortcutById(id: string): ShortcutSpec | undefined {
  return BY_ID.get(id);
}

export function shortcutsInGroup(group: ShortcutGroup): ShortcutSpec[] {
  return SHORTCUTS.filter((entry) => entry.group === group);
}

/**
 * The first token of every multi-token binding — the live chord prefixes.
 *
 * Derived rather than declared, so adding `M` `M` (duplicate) later arms `m`
 * automatically and adding a chord under a prefix nobody armed is impossible.
 * `research/04-interaction.md` §1.11 hard-codes `{g, o, m}`; deriving it is the
 * same set today and cannot drift tomorrow.
 */
export const CHORD_PREFIXES: ReadonlySet<KeyToken> = new Set(
  SHORTCUTS.flatMap((entry) => {
    const sequence = parseSequence(entry.keys);
    return sequence.length > 1 && sequence[0] !== undefined ? [sequence[0]] : [];
  }),
);

/**
 * Every registry entry keyed by its normalised sequence, per scope.
 *
 * Exported for the tests that assert the map has no collisions — two bindings
 * on the same keys in the same scope is a bug the compiler cannot see, and the
 * one that produces "sometimes it archives and sometimes it does nothing".
 */
export function sequenceIndex(): Map<string, ShortcutSpec[]> {
  const index = new Map<string, ShortcutSpec[]>();
  for (const entry of SHORTCUTS) {
    const key = `${entry.scope}:${sequenceKey(parseSequence(entry.keys))}`;
    const bucket = index.get(key);
    if (bucket) bucket.push(entry);
    else index.set(key, [entry]);
  }
  return index;
}
