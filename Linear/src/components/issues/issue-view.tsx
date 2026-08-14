"use client";

/**
 * The client half of an issue view: the store, the selection, the keyboard, and
 * the pickers — with the list and the board as two renderings of the same
 * state.
 *
 * `research/04-interaction.md` §5.5 asks for exactly this shape: *"implement
 * list and board over the same `useIssueCursor` / `useIssueSelection` hooks,
 * differing only in the 'next in direction' function. Do not fork the logic."*
 * Everything below the layout switch is shared; the switch chooses a renderer.
 *
 * ## One target function, so bulk edit is free
 *
 * §1.6 is the heart of the interaction model: *"the same key does the same
 * thing whether one issue is focused in a list, many are selected, or you are
 * inside issue detail. Bulk is not a separate mode."* {@link targetIds} is the
 * one place that decides — selection wins, then the cursor — and every property
 * binding goes through it, so pressing `S` with five rows selected changes five
 * issues without a single line of bulk-specific code.
 *
 * ## Why the store is created here and not in a provider
 *
 * The store's lifetime is the view's. A navigation from one team to another
 * replaces the issues wholesale, and a store that outlived the view would have
 * to be told to forget the previous team's rows — which is the same work as
 * building a new one, plus a way to get it wrong. Pending mutations are not
 * lost by this: the failure toast is raised from the queue, not from a
 * component (§6.4), so a row that unmounts mid-flight still reports.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  type DisplayOptions,
  type GroupBy,
  type IssueId,
  type IssueWithRelations,
  type Label,
  type LabelId,
  type Priority,
  type Project,
  type ProjectId,
  type StateId,
  type Team,
  type User,
  type UserId,
  type ViewLayout,
  type WorkflowState,
} from "@/domain/entities";
import { keyForIndex } from "@/domain/ordering";
import { newId } from "@/lib/ids";
import {
  createIssueStore,
  fetchTransport,
  type IssueCatalog,
  type IssueFieldPatch,
  type IssueStore,
  type IssueTransport,
  type ReorderRequest,
} from "@/lib/store/issues";
import { toast } from "@/components/ui/toast-provider";
import { AppHeader, SubHeader } from "@/components/app-shell/header";
import type { Crumb } from "@/components/app-shell/breadcrumbs";
import { ViewTabs, type TeamView } from "@/components/app-shell/view-tabs";
import { ViewToolbar } from "@/components/app-shell/toolbar";
import { workspacePath } from "@/components/app-shell/workspace-context";
import {
  DisplayOptionsPanel,
  DEFAULT_DISPLAY,
} from "@/components/issues/display-options";
import {
  applyViewFilter,
  EMPTY_FILTER,
  FilterBar,
  filterIsEmpty,
  type ViewFilter,
} from "@/components/issues/filter-bar";
import {
  flattenGroups,
  groupIssues,
  rangeBetween,
  startedProgressByState,
  type IssueGroup,
} from "@/components/issues/grouping";
import { IssueBoard } from "@/components/issues/issue-board";
import { IssueList } from "@/components/issues/issue-list";
import type { RowProperty } from "@/components/issues/issue-row";
import { useShortcuts, type Binding } from "@/components/issues/keyboard";
import {
  NewIssueModal,
  type NewIssueDefaults,
  type NewIssueDraft,
} from "@/components/issues/new-issue-modal";
import {
  AssigneePicker,
  LabelPicker,
  PriorityPicker,
  ProjectPicker,
  StatusPicker,
} from "@/components/issues/property-pickers";

export interface IssueViewCatalog {
  readonly states: readonly WorkflowState[];
  readonly users: readonly User[];
  readonly labels: readonly Label[];
  readonly projects: readonly Pick<Project, "id" | "name" | "icon" | "color">[];
  readonly teams: readonly Pick<Team, "id" | "key" | "name" | "color">[];
}

export interface IssueViewProps {
  readonly workspaceUrlKey: string;
  readonly crumbs: readonly Crumb[];
  /** The team new issues are filed into. Null on a cross-team view. */
  readonly team: Pick<Team, "id" | "key" | "name"> | null;
  /** Present on a team view: which tab is current and where the tabs point. */
  readonly currentView: TeamView | null;
  readonly basePath: string | null;
  readonly issues: readonly IssueWithRelations[];
  readonly catalog: IssueViewCatalog;
  readonly initialLayout: ViewLayout;
  readonly initialGroupBy?: GroupBy;
  /** The state a new issue lands in — the team's default, resolved server-side. */
  readonly defaultStateId: StateId | null;
  /** Injected by the tests; production uses the Route Handlers. */
  readonly transport?: IssueTransport;
}

type PickerKind = RowProperty | null;

export function IssueView({
  workspaceUrlKey,
  crumbs,
  team,
  currentView,
  basePath,
  issues,
  catalog,
  initialLayout,
  initialGroupBy,
  defaultStateId,
  transport,
}: IssueViewProps) {
  const router = useRouter();

  /* --- store --------------------------------------------------------- */

  const catalogMaps = useMemo<IssueCatalog>(
    () => ({
      states: new Map(catalog.states.map((state) => [state.id, state])),
      users: new Map(catalog.users.map((user) => [user.id, user])),
      projects: new Map(
        catalog.projects.map((project) => [project.id, project]),
      ),
      labels: new Map(catalog.labels.map((label) => [label.id, label])),
    }),
    [catalog],
  );

  const [store] = useState<IssueStore>(() =>
    createIssueStore({
      transport: transport ?? fetchTransport(),
      catalog: catalogMaps,
      issues,
      onFailure: (failure) =>
        toast({
          // One card per issue, replaced on retry rather than stacked.
          id: `issue-${failure.issueId}`,
          variant: "error",
          title: `Couldn't update ${failure.identifier}`,
          description: failure.message,
          action: { label: "Retry", onClick: failure.retry },
        }),
    }),
  );

  const [snapshot, setSnapshot] = useState(() => store.state.getState());
  useEffect(() => store.state.subscribe(() => setSnapshot(store.state.getState())), [store]);

  useEffect(() => {
    store.setCatalog(catalogMaps);
  }, [store, catalogMaps]);

  useEffect(() => {
    store.hydrate(issues);
  }, [store, issues]);

  /* --- view options --------------------------------------------------- */

  const [display, setDisplay] = useState<DisplayOptions>(() => ({
    ...DEFAULT_DISPLAY,
    layout: initialLayout,
    groupBy: initialGroupBy ?? DEFAULT_DISPLAY.groupBy,
  }));
  const [filter, setFilter] = useState<ViewFilter>(EMPTY_FILTER);
  const [filterOpen, setFilterOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const displayRef = useRef<HTMLButtonElement | null>(null);

  const visible = useMemo(() => {
    const filtered = applyViewFilter(snapshot.list, filter);
    return display.showCompletedIssues
      ? filtered
      : filtered.filter(
          (issue) =>
            issue.state.type !== "completed" && issue.state.type !== "canceled",
        );
  }, [snapshot.list, filter, display.showCompletedIssues]);

  const groups = useMemo<readonly IssueGroup[]>(
    () =>
      groupIssues(visible, {
        groupBy: display.groupBy,
        orderBy: display.orderBy,
        direction: display.orderDirection,
        // A board column you cannot drop into is a column that does not exist,
        // so the board always shows the empty ones (§5.1).
        showEmptyGroups: display.layout === "board" || display.showEmptyGroups,
        ...catalog,
      }),
    [visible, display, catalog],
  );

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const order = useMemo(
    () => flattenGroups(groups, collapsed),
    [groups, collapsed],
  );
  const progressByState = useMemo(
    () => startedProgressByState(catalog.states),
    [catalog.states],
  );

  /* --- selection ------------------------------------------------------ */

  const [selected, setSelected] = useState<ReadonlySet<IssueId>>(
    () => new Set(),
  );
  const [cursorId, setFocusedId] = useState<IssueId | null>(null);
  const [anchorId, setAnchorId] = useState<IssueId | null>(null);

  /**
   * The cursor, derived rather than corrected.
   *
   * It has to survive a re-sort — an optimistic status change moves a row to
   * another group and the cursor goes with it — but not a *disappearance*: an
   * issue filtered out from under the cursor would leave it pointing at a row
   * nobody can see, and the next arrow press would have no origin. Deriving the
   * effective value each render says that in one expression; an effect that
   * watched for the case and called `setFocusedId` would say the same thing one
   * render later, having rendered the invalid state first.
   */
  const focusedId = useMemo(
    () =>
      cursorId && order.some((issue) => issue.id === cursorId) ? cursorId : null,
    [cursorId, order],
  );

  const targetIds = useCallback((): readonly IssueId[] => {
    if (selected.size > 0) return [...selected];
    return focusedId ? [focusedId] : [];
  }, [selected, focusedId]);

  const targets = useMemo(
    () =>
      targetIds().flatMap((id) => {
        const issue = snapshot.byId[id];
        return issue ? [issue] : [];
      }),
    [targetIds, snapshot.byId],
  );

  const moveCursor = useCallback(
    (delta: number, extend: boolean): void => {
      if (order.length === 0) return;
      const current = order.findIndex((issue) => issue.id === focusedId);
      const next = Math.max(
        0,
        Math.min(order.length - 1, current === -1 ? 0 : current + delta),
      );
      const target = order[next];
      if (!target) return;
      setFocusedId(target.id);
      if (!extend) return;
      const from = anchorId ?? focusedId ?? target.id;
      setAnchorId(from);
      setSelected(new Set(rangeBetween(order, from, target.id)));
    },
    [order, focusedId, anchorId],
  );

  const selectIssue = useCallback(
    (
      issue: IssueWithRelations,
      mode: "toggle" | "additive" | "range",
    ): void => {
      setFocusedId(issue.id);
      if (mode === "range") {
        const from = anchorId ?? focusedId ?? issue.id;
        setAnchorId(from);
        setSelected(new Set(rangeBetween(order, from, issue.id)));
        return;
      }
      setAnchorId(issue.id);
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(issue.id)) next.delete(issue.id);
        else next.add(issue.id);
        return next;
      });
    },
    [order, anchorId, focusedId],
  );

  /* --- pickers -------------------------------------------------------- */

  const [picker, setPicker] = useState<PickerKind>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  /**
   * Anchor a keyboard-opened picker to the row it will act on.
   *
   * A picker that opens in the corner of the screen while the cursor is on row
   * forty is disorienting; anchoring it to the focused row keeps the popover
   * where the user is looking. Falls back to the view root when the row is not
   * rendered — which happens on an empty selection, where the picker should not
   * open at all, and on a collapsed group.
   */
  const openPickerForTargets = useCallback(
    (kind: RowProperty): void => {
      if (targetIds().length === 0) return;
      const id = focusedId ?? targetIds()[0];
      const row =
        id && rootRef.current
          ? rootRef.current.querySelector<HTMLElement>(`[data-issue-id="${id}"]`)
          : null;
      anchorRef.current = row ?? rootRef.current;
      setPicker(kind);
    },
    [targetIds, focusedId],
  );

  const openPickerFromRow = useCallback(
    (property: RowProperty, issue: IssueWithRelations, anchor: HTMLElement) => {
      // Clicking a chip on an unselected row acts on that row alone; clicking
      // one inside the selection acts on the whole selection, which is what
      // §3.7's "bulk semantics" means for the mouse.
      if (!selected.has(issue.id)) {
        setSelected(new Set());
        setAnchorId(issue.id);
      }
      setFocusedId(issue.id);
      anchorRef.current = anchor;
      setPicker(property);
    },
    [selected],
  );

  /** The shared value across the targets, or null when they disagree. */
  function common<T>(read: (issue: IssueWithRelations) => T): T | null {
    if (targets.length === 0) return null;
    const first = read(targets[0] as IssueWithRelations);
    return targets.every((issue) => read(issue) === first) ? first : null;
  }

  const apply = useCallback(
    (patch: IssueFieldPatch): void => {
      const ids = targetIds();
      if (ids.length > 0) store.mutate(ids, patch);
    },
    [store, targetIds],
  );

  /* --- creation ------------------------------------------------------- */

  const [creating, setCreating] = useState(false);
  const [createDefaults, setCreateDefaults] = useState<NewIssueDefaults>({});
  /**
   * Bumped on every open, and used as the modal's `key`.
   *
   * Remounting is React's documented way to reset a form's state when a prop
   * changes, and it is the right one here: the modal has seven fields seeded
   * from `defaults`, and clearing them in an effect would render the *previous*
   * issue's properties for one frame before wiping them.
   */
  const [createSeq, setCreateSeq] = useState(0);

  const openCreate = useCallback(
    (defaults: NewIssueDefaults = {}): void => {
      setCreateDefaults({ stateId: defaultStateId ?? undefined, ...defaults });
      setCreateSeq((seq) => seq + 1);
      setCreating(true);
    },
    [defaultStateId],
  );

  const createIssue = (draft: NewIssueDraft): void => {
    if (!team) return;
    const state = catalog.states.find((entry) => entry.id === draft.stateId);
    if (!state) return;

    const id = newId("iss");
    const now = new Date().toISOString();
    const teamIssues = snapshot.list.filter((issue) => issue.teamId === team.id);
    // A new issue goes to the top of its team's list, which is where Linear
    // puts it. The number is a guess — the counter is the database's — and it
    // is corrected by the reconcile a moment later; guessing keeps the row from
    // rendering with a placeholder identifier in the meantime.
    const sortOrder = keyForIndex(
      [...teamIssues]
        .map((issue) => issue.sortOrder)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      0,
    );
    const number =
      teamIssues.reduce((max, issue) => Math.max(max, issue.number), 0) + 1;

    const optimistic: IssueWithRelations = {
      id,
      teamId: team.id,
      number,
      identifier: `${team.key}-${number}`,
      title: draft.title,
      description: draft.description,
      stateId: state.id,
      state,
      priority: draft.priority,
      assigneeId: draft.assigneeId,
      assignee:
        catalog.users.find((user) => user.id === draft.assigneeId) ?? null,
      creatorId: "" as UserId,
      creator: null,
      projectId: draft.projectId,
      project:
        catalog.projects.find((project) => project.id === draft.projectId) ??
        null,
      milestoneId: null,
      parentId: null,
      estimate: null,
      dueDate: null,
      sortOrder,
      subIssueSortOrder: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      canceledAt: null,
      archivedAt: null,
      triagedAt: null,
      team: {
        id: team.id,
        key: team.key,
        name: team.name,
        color: "#5e6ad2",
        icon: "Box",
      },
      labels: catalog.labels.filter((label) => draft.labelIds.includes(label.id)),
      subIssueCount: 0,
      completedSubIssueCount: 0,
      commentCount: 0,
    };

    store.create(optimistic, {
      id,
      teamId: team.id,
      title: draft.title,
      description: draft.description,
      stateId: state.id,
      priority: draft.priority,
      assigneeId: draft.assigneeId,
      projectId: draft.projectId,
      dueDate: null,
      labelIds: draft.labelIds,
      sortOrder,
    });
    setFocusedId(id);
  };

  /* --- keyboard ------------------------------------------------------- */

  const setLayout = useCallback(
    (layout: ViewLayout): void => {
      setDisplay((current) => ({ ...current, layout }));
      // Keep the URL honest on a team view, so a reload lands on the same
      // layout and the board is linkable.
      if (basePath && currentView) {
        const next = layout === "board" ? "board" : "all";
        if (next !== currentView) router.replace(`${basePath}/${next}`);
      }
    },
    [basePath, currentView, router],
  );

  const bindings = useMemo<readonly Binding[]>(() => {
    const hasTargets = (): boolean => targetIds().length > 0;
    const priorityBinding = (digit: number, priority: Priority): Binding => ({
      id: `issue.priority.${priority}`,
      keys: `shift+${digit}`,
      when: hasTargets,
      run: () => apply({ priority }),
    });

    return [
      { id: "issue.create", keys: "c", run: () => openCreate() },
      {
        id: "list.toggleSelect",
        keys: "x",
        when: () => focusedId !== null,
        run: () => {
          const issue = focusedId ? snapshot.byId[focusedId] : undefined;
          if (issue) selectIssue(issue, "toggle");
        },
      },
      { id: "list.down", keys: "j", run: () => moveCursor(1, false) },
      { id: "list.up", keys: "k", run: () => moveCursor(-1, false) },
      { id: "list.downArrow", keys: "ArrowDown", run: () => moveCursor(1, false) },
      { id: "list.upArrow", keys: "ArrowUp", run: () => moveCursor(-1, false) },
      {
        id: "list.extendDown",
        keys: "shift+ArrowDown",
        run: () => moveCursor(1, true),
      },
      {
        id: "list.extendUp",
        keys: "shift+ArrowUp",
        run: () => moveCursor(-1, true),
      },
      {
        id: "list.open",
        keys: "Enter",
        when: () => focusedId !== null && picker === null && !creating,
        run: () => {
          const issue = focusedId ? snapshot.byId[focusedId] : undefined;
          if (issue) {
            router.push(
              workspacePath(workspaceUrlKey, "issue", issue.identifier),
            );
          }
        },
      },
      {
        id: "list.selectAll",
        keys: "mod+a",
        run: () => setSelected(new Set(order.map((issue) => issue.id))),
      },
      {
        id: "issue.status",
        keys: "s",
        when: hasTargets,
        run: () => openPickerForTargets("status"),
      },
      {
        id: "issue.assignee",
        keys: "a",
        when: hasTargets,
        run: () => openPickerForTargets("assignee"),
      },
      {
        id: "issue.priority",
        keys: "p",
        when: hasTargets,
        run: () => openPickerForTargets("priority"),
      },
      {
        id: "issue.labels",
        keys: "l",
        when: hasTargets,
        run: () => openPickerForTargets("labels"),
      },
      {
        id: "issue.project",
        keys: "shift+p",
        when: hasTargets,
        run: () => openPickerForTargets("project"),
      },
      // Urgent…Low on Shift+1..4, and Shift+0 clears. Bare digits belong to
      // Triage (§1.10), which is why the modifier is not optional.
      priorityBinding(1, 1),
      priorityBinding(2, 2),
      priorityBinding(3, 3),
      priorityBinding(4, 4),
      priorityBinding(0, 0),
      {
        id: "view.layout",
        keys: "mod+b",
        run: () => setLayout(display.layout === "board" ? "list" : "board"),
      },
      { id: "view.filter", keys: "f", run: () => setFilterOpen(true) },
      { id: "view.display", keys: "shift+v", run: () => setDisplayOpen(true) },
      {
        // The Escape ladder's list rung (§1.11). The pickers and the modal
        // handle their own Escape and stop it, so by the time it reaches here
        // nothing else is open.
        id: "list.clearSelection",
        keys: "Escape",
        when: () => selected.size > 0,
        run: () => {
          setSelected(new Set());
          setAnchorId(null);
        },
      },
    ];
  }, [
    apply,
    creating,
    display.layout,
    focusedId,
    moveCursor,
    openCreate,
    openPickerForTargets,
    order,
    picker,
    router,
    selectIssue,
    selected.size,
    setLayout,
    snapshot.byId,
    targetIds,
    workspaceUrlKey,
  ]);

  useShortcuts(bindings);

  /* --- render --------------------------------------------------------- */

  const hrefFor = (issue: IssueWithRelations): string =>
    workspacePath(workspaceUrlKey, "issue", issue.identifier);

  const openIssue = (issue: IssueWithRelations): void => {
    router.push(hrefFor(issue));
  };

  const onCreateInGroup = (group: IssueGroup): void => {
    const first = group.issues[0];
    // The group's own patch, read through any issue in it. `patchFor` returns
    // `{}` for an issue already in the group, so a sample from a *different*
    // group is what actually yields the value — hence the fallback.
    const patch = first
      ? group.patchFor({ ...first, stateId: "" as StateId })
      : {};
    openCreate({
      stateId: patch.stateId ?? defaultStateId ?? undefined,
      priority: patch.priority,
      assigneeId: patch.assigneeId,
      projectId: patch.projectId,
    });
  };

  const onMove = (requests: readonly ReorderRequest[]): void => {
    for (const request of requests) store.move(request);
  };

  const shared = {
    selected,
    focusedId,
    pending: snapshot.pending,
    progressByState,
    properties: display.properties,
    hrefFor,
    onOpen: openIssue,
    onSelect: selectIssue,
    onFocus: (issue: IssueWithRelations) => setFocusedId(issue.id),
    onOpenPicker: openPickerFromRow,
  };

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <AppHeader crumbs={crumbs} />

      <SubHeader
        actions={
          <ViewToolbar
            layout={display.layout}
            onLayoutChange={setLayout}
            onOpenFilter={() => setFilterOpen(true)}
            filterActive={!filterIsEmpty(filter)}
            displayRef={displayRef}
            onOpenDisplay={() => setDisplayOpen(true)}
            onNewIssue={() => openCreate()}
          />
        }
      >
        {basePath && currentView ? (
          <ViewTabs current={currentView} basePath={basePath} />
        ) : (
          <span className="px-1 text-small text-tertiary">
            {selected.size > 0 ? `${selected.size} selected` : ""}
          </span>
        )}
      </SubHeader>

      <FilterBar
        filter={filter}
        onChange={setFilter}
        states={catalog.states}
        users={catalog.users}
        labels={catalog.labels}
        requestOpen={filterOpen}
        onRequestOpenChange={setFilterOpen}
      />

      {display.layout === "board" ? (
        <IssueBoard
          groups={groups}
          {...shared}
          onCreateInGroup={onCreateInGroup}
          onMove={onMove}
        />
      ) : (
        <IssueList
          groups={groups}
          showGroupHeaders={display.groupBy !== "none"}
          collapsed={collapsed}
          onToggleGroup={(groupId) =>
            setCollapsed((current) => {
              const next = new Set(current);
              if (next.has(groupId)) next.delete(groupId);
              else next.add(groupId);
              return next;
            })
          }
          onCreateInGroup={onCreateInGroup}
          {...shared}
        />
      )}

      <DisplayOptionsPanel
        open={displayOpen}
        onOpenChange={setDisplayOpen}
        anchor={displayRef}
        value={display}
        onChange={setDisplay}
      />

      <StatusPicker
        open={picker === "status"}
        onOpenChange={(open) => setPicker(open ? "status" : null)}
        anchor={anchorRef}
        states={catalog.states}
        value={common((issue) => issue.stateId)}
        onSelect={(stateId, meta) => {
          apply({ stateId });
          if (meta.close) setPicker(null);
        }}
      />
      <PriorityPicker
        open={picker === "priority"}
        onOpenChange={(open) => setPicker(open ? "priority" : null)}
        anchor={anchorRef}
        value={common((issue) => issue.priority)}
        onSelect={(priority, meta) => {
          apply({ priority });
          if (meta.close) setPicker(null);
        }}
      />
      <AssigneePicker
        open={picker === "assignee"}
        onOpenChange={(open) => setPicker(open ? "assignee" : null)}
        anchor={anchorRef}
        users={catalog.users}
        value={common((issue) => issue.assigneeId)}
        onSelect={(assigneeId, meta) => {
          apply({ assigneeId });
          if (meta.close) setPicker(null);
        }}
      />
      <LabelPicker
        open={picker === "labels"}
        onOpenChange={(open) => setPicker(open ? "labels" : null)}
        anchor={anchorRef}
        labels={catalog.labels}
        values={sharedLabelIds(targets)}
        onToggle={(labelId) => {
          // Toggling against the *shared* set: adding a label everyone already
          // has would otherwise remove it from all of them.
          const shared = new Set(sharedLabelIds(targets));
          for (const issue of targets) {
            const current = issue.labels.map((label) => label.id);
            const next = shared.has(labelId)
              ? current.filter((id) => id !== labelId)
              : [...new Set([...current, labelId])];
            store.mutate([issue.id], { labelIds: next });
          }
        }}
      />
      <ProjectPicker
        open={picker === "project"}
        onOpenChange={(open) => setPicker(open ? "project" : null)}
        anchor={anchorRef}
        projects={catalog.projects}
        value={common((issue) => issue.projectId)}
        onSelect={(projectId, meta) => {
          apply({ projectId });
          if (meta.close) setPicker(null);
        }}
      />

      {team ? (
        <NewIssueModal
          key={createSeq}
          open={creating}
          onOpenChange={setCreating}
          team={team}
          states={catalog.states}
          users={catalog.users}
          labels={catalog.labels}
          projects={catalog.projects}
          defaults={createDefaults}
          onCreate={createIssue}
        />
      ) : null}
    </div>
  );
}

/** The labels every target carries — the ones a multi-select picker ticks. */
function sharedLabelIds(
  targets: readonly IssueWithRelations[],
): readonly LabelId[] {
  const first = targets[0];
  if (!first) return [];
  return first.labels
    .map((label) => label.id)
    .filter((id) =>
      targets.every((issue) => issue.labels.some((label) => label.id === id)),
    );
}

/** Re-exported so a page can name the type without importing the module twice. */
export type { ProjectId, StateId, UserId };
