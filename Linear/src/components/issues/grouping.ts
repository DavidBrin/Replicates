/**
 * Grouping and ordering for the list and the board.
 *
 * The list and the board are the same data twice — `research/04-interaction.md`
 * §5.5 says it outright: *"implement list and board over the same hooks,
 * differing only in the 'next in direction' function"*. So the partition lives
 * here, in a module with no React in it, and both views render whatever it
 * returns. A board column and a list group are the same {@link IssueGroup}.
 *
 * ## Why a group carries a `patchFor` function rather than a value
 *
 * Dropping a card into a column writes the grouped field (§5.3). For status,
 * assignee, priority and project that is a plain assignment. For **labels** it
 * is not: a label group means "has this label", and an issue can hold several,
 * so the drop has to add one to a set rather than replace a scalar. Expressing
 * the drop as a function of the dragged issue keeps that difference here
 * instead of forcing a `switch (groupBy)` into the board's drop handler, where
 * it would be a second place the grouping semantics are defined.
 *
 * A group whose field cannot be written by dragging — grouping by team, or not
 * grouping at all — is marked `droppable: false`, and the board refuses the
 * gesture rather than silently reordering. That is a different fact from
 * `patchFor` returning `{}`, which is what a drop into the group an issue is
 * *already* in means: reorder, change nothing.
 *
 * ## Ordering
 *
 * Groups come out in the order the domain defines: workflow states by
 * {@link compareWorkflowStates}, priorities by `PRIORITY_SORT_RANK` (Urgent
 * first, *No priority* last — the trap `sorting.ts` exists to prevent), and the
 * "empty" bucket of every other axis last, because "Unassigned" at the top of a
 * list is noise ahead of the work.
 *
 * Issues inside a group come out via `compareIssues`, which is the same
 * comparator the SQL `order by` mirrors — two implementations that disagree
 * produce a row that jumps when the server's answer arrives.
 */

import type {
  GroupBy,
  IssueWithRelations,
  Label,
  LabelId,
  OrderBy,
  Priority,
  Project,
  ProjectId,
  StateId,
  StateType,
  Team,
  TeamId,
  User,
  UserId,
  WorkflowState,
} from "@/domain/entities";
import {
  PRIORITY_LABELS,
  PRIORITY_SORT_RANK,
  PRIORITY_VALUES,
} from "@/domain/entities";
import {
  compareIssues,
  compareWorkflowStates,
  type SortDirection,
} from "@/domain/sorting";
import { startedStateProgress } from "@/components/ui/icons/status-icon";

import type { IssueFieldPatch } from "@/lib/store/issues";

/** What the group header and the board column draw to the left of the name. */
export type GroupGlyph =
  | {
      readonly kind: "status";
      readonly type: StateType;
      readonly color: string;
      readonly progress: number;
      readonly label: string;
    }
  | { readonly kind: "priority"; readonly priority: Priority }
  | { readonly kind: "user"; readonly user: User | null }
  | { readonly kind: "swatch"; readonly color: string | null }
  | { readonly kind: "none" };

export interface IssueGroup {
  /** Stable across re-renders; the React key and the collapse-state key. */
  readonly id: string;
  /** Display name, and the suffix of `issue-group-{name}` / `board-column-{name}`. */
  readonly name: string;
  readonly glyph: GroupGlyph;
  readonly issues: readonly IssueWithRelations[];
  /**
   * Whether a card may be dropped into this group at all.
   *
   * Separate from {@link IssueGroup.patchFor} returning an empty patch, and the
   * distinction is load-bearing: "this axis cannot be written by dragging"
   * (grouped by team) and "this issue already has this value, so the drop only
   * reorders" are different answers, and collapsing them into one nullable
   * return makes a within-column reorder look like a refused drop.
   */
  readonly droppable: boolean;
  /**
   * The field change a drop into this group implies — `{}` when the issue is
   * already in it and the gesture is a reorder.
   */
  readonly patchFor: (issue: IssueWithRelations) => IssueFieldPatch;
}

export interface GroupingCatalog {
  readonly states: readonly WorkflowState[];
  readonly users: readonly User[];
  readonly projects: readonly Pick<Project, "id" | "name" | "icon" | "color">[];
  readonly labels: readonly Label[];
  readonly teams: readonly Pick<Team, "id" | "key" | "name" | "color">[];
}

export interface GroupingOptions extends GroupingCatalog {
  readonly groupBy: GroupBy;
  readonly orderBy: OrderBy;
  readonly direction: SortDirection;
  /**
   * Render a group with no issues in it.
   *
   * Always true on a board — a column you cannot drop into is a column that
   * does not exist — and off by default in a list, where an empty group is a
   * row of chrome saying nothing.
   */
  readonly showEmptyGroups: boolean;
}

const NO_CHANGE = (): IssueFieldPatch => ({});

/**
 * Where a started state's wedge sits, keyed by state id.
 *
 * Computed once per grouping rather than per row: the rule needs the state's
 * index among *its team's* started states, which is a fact about the whole set
 * and not about the state in hand (`status-icon.tsx`, {@link startedStateProgress}).
 */
export function startedProgressByState(
  states: readonly WorkflowState[],
): ReadonlyMap<StateId, number> {
  const byTeam = new Map<TeamId, WorkflowState[]>();
  for (const state of states) {
    if (state.type !== "started") continue;
    const bucket = byTeam.get(state.teamId);
    if (bucket) bucket.push(state);
    else byTeam.set(state.teamId, [state]);
  }

  const progress = new Map<StateId, number>();
  for (const bucket of byTeam.values()) {
    const ordered = [...bucket].sort(compareWorkflowStates);
    ordered.forEach((state, index) => {
      progress.set(state.id, startedStateProgress(index, ordered.length));
    });
  }
  return progress;
}

export function groupIssues(
  issues: readonly IssueWithRelations[],
  options: GroupingOptions,
): readonly IssueGroup[] {
  const compare = compareIssues(options.orderBy, options.direction);
  const sorted = [...issues].sort(compare);

  switch (options.groupBy) {
    case "status":
      return byStatus(sorted, options);
    case "assignee":
      return byAssignee(sorted, options);
    case "priority":
      return byPriority(sorted, options);
    case "project":
      return byProject(sorted, options);
    case "label":
      return byLabel(sorted, options);
    case "team":
      return byTeam(sorted, options);
    case "none":
    default:
      return [
        {
          id: "all",
          name: "All issues",
          glyph: { kind: "none" },
          issues: sorted,
          droppable: false,
          patchFor: NO_CHANGE,
        },
      ];
  }
}

/* ================================================================ axes === */

function byStatus(
  issues: readonly IssueWithRelations[],
  options: GroupingOptions,
): readonly IssueGroup[] {
  const progress = startedProgressByState(options.states);
  const buckets = new Map<StateId, IssueWithRelations[]>();
  for (const issue of issues) push(buckets, issue.stateId, issue);

  // States a team defines, plus any state an issue references that the catalog
  // did not carry — a cross-team list would otherwise silently drop rows.
  const known = new Map(options.states.map((state) => [state.id, state]));
  for (const issue of issues) {
    if (!known.has(issue.stateId)) known.set(issue.stateId, issue.state);
  }

  return [...known.values()]
    .sort(compareWorkflowStates)
    .flatMap((state) => {
      const rows = buckets.get(state.id) ?? [];
      if (rows.length === 0 && !options.showEmptyGroups) return [];
      return [
        {
          id: `status:${state.id}`,
          name: state.name,
          glyph: {
            kind: "status" as const,
            type: state.type,
            color: state.color,
            progress: progress.get(state.id) ?? 0.5,
            label: state.name,
          },
          issues: rows,
          droppable: true,
          patchFor: (issue: IssueWithRelations) =>
            issue.stateId === state.id ? {} : { stateId: state.id },
        },
      ];
    });
}

function byAssignee(
  issues: readonly IssueWithRelations[],
  options: GroupingOptions,
): readonly IssueGroup[] {
  const buckets = new Map<UserId | null, IssueWithRelations[]>();
  for (const issue of issues) push(buckets, issue.assigneeId, issue);

  const known = new Map(options.users.map((user) => [user.id, user]));
  for (const issue of issues) {
    if (issue.assignee && !known.has(issue.assignee.id)) {
      known.set(issue.assignee.id, issue.assignee);
    }
  }

  // Annotated rather than inferred: the "Unassigned" bucket appended below is
  // the *same* kind of group with a null user, and `GroupGlyph` already says
  // so. Letting inference narrow the array to "groups that have a user" would
  // make the honest case the one that needs a cast.
  const groups: IssueGroup[] = [...known.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((user) => {
      const rows = buckets.get(user.id) ?? [];
      if (rows.length === 0 && !options.showEmptyGroups) return [];
      return [
        {
          id: `assignee:${user.id}`,
          name: user.name,
          glyph: { kind: "user" as const, user },
          issues: rows,
          droppable: true,
          patchFor: (issue: IssueWithRelations) =>
            issue.assigneeId === user.id ? {} : { assigneeId: user.id },
        },
      ];
    });

  const unassigned = buckets.get(null) ?? [];
  if (unassigned.length > 0 || options.showEmptyGroups) {
    groups.push({
      id: "assignee:none",
      name: "Unassigned",
      glyph: { kind: "user", user: null },
      issues: unassigned,
      droppable: true,
      patchFor: (issue: IssueWithRelations) =>
        issue.assigneeId === null ? {} : { assigneeId: null },
    });
  }
  return groups;
}

function byPriority(
  issues: readonly IssueWithRelations[],
  options: GroupingOptions,
): readonly IssueGroup[] {
  const buckets = new Map<Priority, IssueWithRelations[]>();
  for (const issue of issues) push(buckets, issue.priority, issue);

  return [...PRIORITY_VALUES]
    .sort((a, b) => PRIORITY_SORT_RANK[a] - PRIORITY_SORT_RANK[b])
    .flatMap((priority) => {
      const rows = buckets.get(priority) ?? [];
      if (rows.length === 0 && !options.showEmptyGroups) return [];
      return [
        {
          id: `priority:${priority}`,
          name: PRIORITY_LABELS[priority],
          glyph: { kind: "priority" as const, priority },
          issues: rows,
          droppable: true,
          patchFor: (issue: IssueWithRelations) =>
            issue.priority === priority ? {} : { priority },
        },
      ];
    });
}

function byProject(
  issues: readonly IssueWithRelations[],
  options: GroupingOptions,
): readonly IssueGroup[] {
  const buckets = new Map<ProjectId | null, IssueWithRelations[]>();
  for (const issue of issues) push(buckets, issue.projectId, issue);

  const known = new Map(options.projects.map((project) => [project.id, project]));
  for (const issue of issues) {
    if (issue.project && !known.has(issue.project.id)) {
      known.set(issue.project.id, issue.project);
    }
  }

  const groups: IssueGroup[] = [...known.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((project) => {
      const rows = buckets.get(project.id) ?? [];
      if (rows.length === 0 && !options.showEmptyGroups) return [];
      return [
        {
          id: `project:${project.id}`,
          name: project.name,
          glyph: { kind: "swatch" as const, color: project.color },
          issues: rows,
          droppable: true,
          patchFor: (issue: IssueWithRelations) =>
            issue.projectId === project.id ? {} : { projectId: project.id },
        },
      ];
    });

  const none = buckets.get(null) ?? [];
  if (none.length > 0 || options.showEmptyGroups) {
    groups.push({
      id: "project:none",
      name: "No project",
      glyph: { kind: "swatch", color: null },
      issues: none,
      droppable: true,
      patchFor: (issue: IssueWithRelations) =>
        issue.projectId === null ? {} : { projectId: null },
    });
  }
  return groups;
}

/**
 * Grouping by label, where one issue can appear in several groups.
 *
 * That duplication is deliberate and matches Linear: an issue labelled both
 * `Bug` and `Auth` shows under each. It is also why the flattened cursor order
 * ({@link flattenGroups}) de-duplicates — the keyboard must not visit the same
 * issue twice on its way down the list.
 */
function byLabel(
  issues: readonly IssueWithRelations[],
  options: GroupingOptions,
): readonly IssueGroup[] {
  const buckets = new Map<LabelId, IssueWithRelations[]>();
  const unlabelled: IssueWithRelations[] = [];
  for (const issue of issues) {
    if (issue.labels.length === 0) unlabelled.push(issue);
    for (const label of issue.labels) push(buckets, label.id, issue);
  }

  const known = new Map(options.labels.map((label) => [label.id, label]));
  for (const issue of issues) {
    for (const label of issue.labels) {
      if (!known.has(label.id)) known.set(label.id, label);
    }
  }

  const groups: IssueGroup[] = [...known.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((label) => {
      const rows = buckets.get(label.id) ?? [];
      if (rows.length === 0 && !options.showEmptyGroups) return [];
      return [
        {
          id: `label:${label.id}`,
          name: label.name,
          glyph: { kind: "swatch" as const, color: label.color },
          issues: rows,
          droppable: true,
          // Adding, not replacing: an issue carries a set of labels, so the
          // drop unions rather than overwriting the ones already on it.
          patchFor: (issue: IssueWithRelations) =>
            issue.labels.some((existing) => existing.id === label.id)
              ? {}
              : { labelIds: [...issue.labels.map((l) => l.id), label.id] },
        },
      ];
    });

  if (unlabelled.length > 0 || options.showEmptyGroups) {
    groups.push({
      id: "label:none",
      name: "No label",
      glyph: { kind: "swatch", color: null },
      issues: unlabelled,
      droppable: true,
      patchFor: (issue: IssueWithRelations) =>
        issue.labels.length === 0 ? {} : { labelIds: [] },
    });
  }
  return groups;
}

/**
 * Grouping by team.
 *
 * Not draggable: moving an issue between teams renumbers it (`ENG-4` becomes
 * `OPS-19`) and is a deliberate, confirmable action rather than something a
 * slipped drag should do.
 */
function byTeam(
  issues: readonly IssueWithRelations[],
  options: GroupingOptions,
): readonly IssueGroup[] {
  const buckets = new Map<TeamId, IssueWithRelations[]>();
  for (const issue of issues) push(buckets, issue.teamId, issue);

  const known = new Map(options.teams.map((team) => [team.id, team]));
  for (const issue of issues) {
    if (!known.has(issue.teamId)) known.set(issue.teamId, issue.team);
  }

  return [...known.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .flatMap((team) => {
      const rows = buckets.get(team.id) ?? [];
      if (rows.length === 0 && !options.showEmptyGroups) return [];
      return [
        {
          id: `team:${team.id}`,
          name: team.name,
          glyph: { kind: "swatch" as const, color: team.color },
          issues: rows,
          droppable: false,
          patchFor: NO_CHANGE,
        },
      ];
    });
}

function push<K>(
  buckets: Map<K, IssueWithRelations[]>,
  key: K,
  issue: IssueWithRelations,
): void {
  const bucket = buckets.get(key);
  if (bucket) bucket.push(issue);
  else buckets.set(key, [issue]);
}

/* =========================================================== navigation == */

/**
 * The visual order the keyboard cursor walks — collapsed groups skipped, each
 * issue visited once.
 *
 * Range selection (`Shift+↑/↓`, `Shift+click`) is defined against *this* order
 * and not against the underlying array, which is what makes a range select the
 * rows the user can actually see between the two ends.
 */
export function flattenGroups(
  groups: readonly IssueGroup[],
  collapsed: ReadonlySet<string> = new Set(),
): readonly IssueWithRelations[] {
  const seen = new Set<string>();
  const flat: IssueWithRelations[] = [];
  for (const group of groups) {
    if (collapsed.has(group.id)) continue;
    for (const issue of group.issues) {
      if (seen.has(issue.id)) continue;
      seen.add(issue.id);
      flat.push(issue);
    }
  }
  return flat;
}

/**
 * The inclusive range between two ids in visual order.
 *
 * Returns the endpoints alone when either is not on screen — a range anchored
 * to a row that has since been filtered away should select what you can see,
 * not everything.
 */
export function rangeBetween(
  order: readonly IssueWithRelations[],
  from: string,
  to: string,
): readonly string[] {
  const start = order.findIndex((issue) => issue.id === from);
  const end = order.findIndex((issue) => issue.id === to);
  if (start === -1 || end === -1) return from === to ? [from] : [from, to];
  const [low, high] = start <= end ? [start, end] : [end, start];
  return order.slice(low, high + 1).map((issue) => issue.id);
}
