/**
 * Fixtures for the issue store and the views built on it.
 *
 * `IssueWithRelations` has thirty fields and a test cares about three of them.
 * Building one inline per test would bury the assertion; building it here means
 * a test reads as the difference from a plausible issue, which is what it
 * actually is.
 *
 * Lives under `lib/store` rather than beside the component tests because the
 * store is the lower layer: a component test importing downwards is ordinary, a
 * store test importing from `components/` would invert the dependency.
 */

import type {
  IssueWithRelations,
  Label,
  LabelId,
  Priority,
  Project,
  ProjectId,
  StateId,
  StateType,
  TeamId,
  User,
  UserId,
  WorkflowState,
} from "@/domain/entities";

export const TEAM_ID = "tem_test" as TeamId;

export function makeState(
  id: string,
  name: string,
  type: StateType,
  position = 0,
): WorkflowState {
  return {
    id: id as StateId,
    teamId: TEAM_ID,
    name,
    type,
    color: "#5e6ad2",
    description: null,
    position,
  };
}

export function makeUser(id: string, name: string): User {
  return {
    id: id as UserId,
    email: `${id}@demo.test`,
    name,
    displayName: id,
    avatarUrl: null,
    avatarColor: "#5e6ad2",
    createdAt: "2026-01-01T00:00:00.000Z",
    active: true,
  };
}

export function makeLabel(id: string, name: string, color = "#eb5757"): Label {
  return {
    id: id as LabelId,
    workspaceId: "wsp_test",
    teamId: null,
    name,
    color,
    description: null,
    parentId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

export function makeProject(
  id: string,
  name: string,
): Pick<Project, "id" | "name" | "icon" | "color"> {
  return { id: id as ProjectId, name, icon: "Box", color: "#26b5ce" };
}

export const TODO = makeState("sta_todo", "Todo", "unstarted", 1);
export const IN_PROGRESS = makeState("sta_wip", "In Progress", "started", 2);
export const DONE = makeState("sta_done", "Done", "completed", 3);
export const BACKLOG = makeState("sta_backlog", "Backlog", "backlog", 0);

export interface IssueOverrides {
  readonly id?: string;
  readonly number?: number;
  readonly title?: string;
  readonly state?: WorkflowState;
  readonly priority?: Priority;
  readonly assignee?: User | null;
  readonly project?: Pick<Project, "id" | "name" | "icon" | "color"> | null;
  readonly labels?: readonly Label[];
  readonly sortOrder?: string;
  readonly dueDate?: string | null;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export function makeIssue(overrides: IssueOverrides = {}): IssueWithRelations {
  const number = overrides.number ?? 1;
  const state = overrides.state ?? TODO;
  const assignee = overrides.assignee ?? null;
  const project = overrides.project ?? null;
  return {
    id: (overrides.id ?? `iss_${number}`) as IssueWithRelations["id"],
    teamId: TEAM_ID,
    number,
    identifier: `ENG-${number}`,
    title: overrides.title ?? `Issue ${number}`,
    description: "",
    stateId: state.id,
    state,
    priority: overrides.priority ?? 0,
    assigneeId: assignee?.id ?? null,
    assignee,
    creatorId: "usr_owner" as UserId,
    creator: null,
    projectId: project?.id ?? null,
    project,
    milestoneId: null,
    parentId: null,
    estimate: null,
    dueDate: overrides.dueDate ?? null,
    sortOrder: overrides.sortOrder ?? `a${number}`,
    subIssueSortOrder: null,
    createdAt: overrides.createdAt ?? "2026-03-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-02T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    archivedAt: null,
    triagedAt: null,
    team: {
      id: TEAM_ID,
      key: "ENG",
      name: "Engineering",
      color: "#5e6ad2",
      icon: "Cpu",
    },
    labels: overrides.labels ?? [],
    subIssueCount: 0,
    completedSubIssueCount: 0,
    commentCount: 0,
  };
}
