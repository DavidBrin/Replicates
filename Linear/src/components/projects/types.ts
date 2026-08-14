/**
 * The shapes a project screen is rendered from.
 *
 * Deliberately not the repository's return types. A Server Component hands
 * these across the serialization boundary to a Client Component, and the domain
 * entities carry things that boundary should not — a `Project` has
 * `workspaceId` and `sortOrder`, a `User` has an email and an `active` flag,
 * and the members panel needs one of those and not the others. Naming the
 * projection makes "what does the browser get to know" a decision somebody
 * made rather than whatever the query happened to select.
 *
 * Everything here is JSON-safe: strings, numbers, booleans and nulls. No Dates
 * — the repositories already hand back ISO strings, and a `Date` crossing the
 * boundary arrives as a string anyway, silently typed as a `Date`.
 */

import type {
  ProjectHealth,
  ProjectRole,
  ProjectState,
  Priority,
  StateType,
} from "@/domain/entities";

export interface PersonView {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly avatarUrl: string | null;
  readonly avatarColor: string;
}

export interface ProjectMemberView extends PersonView {
  readonly role: ProjectRole;
}

export interface ProjectTeamView {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly color: string;
}

/** The counts a card and an overview both show, computed never stored. */
export interface ProjectProgressView {
  readonly total: number;
  readonly completed: number;
  readonly started: number;
  readonly canceled: number;
  readonly scope: number | null;
  readonly completedScope: number | null;
}

export interface ProjectCardView {
  readonly id: string;
  readonly slugId: string;
  readonly name: string;
  readonly summary: string;
  readonly icon: string;
  readonly color: string;
  readonly state: ProjectState;
  readonly health: ProjectHealth | null;
  readonly targetDate: string | null;
  readonly lead: PersonView | null;
  readonly progress: ProjectProgressView;
}

export interface ProjectDetailView extends ProjectCardView {
  readonly description: string;
  readonly startDate: string | null;
  readonly members: readonly ProjectMemberView[];
  readonly teams: readonly ProjectTeamView[];
}

export interface MilestoneView {
  readonly id: string;
  readonly name: string;
  readonly targetDate: string | null;
  /** Issues attached to this milestone, and how many of them are done. */
  readonly total: number;
  readonly completed: number;
}

export interface UpdateView {
  readonly id: string;
  readonly body: string;
  readonly health: ProjectHealth;
  readonly createdAt: string;
  readonly author: PersonView | null;
}

export interface ProjectIssueView {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly priority: Priority;
  readonly stateName: string;
  readonly stateType: StateType;
  readonly stateColor: string;
  readonly assignee: PersonView | null;
}

/**
 * What the viewer may do here, decided on the server by `can()` and passed down
 * as facts rather than as a role.
 *
 * The distinction matters: a component handed `role: "admin"` will eventually
 * compare it to something, which is the one thing `SPEC.md` §4 forbids outside
 * the policy module. A component handed `canEdit: false` cannot.
 */
export interface ProjectAbilities {
  readonly canEdit: boolean;
  readonly canAddMember: boolean;
  readonly canRemoveMember: boolean;
  readonly canDelete: boolean;
}

/* ================================================================ labels = */

export const PROJECT_STATE_LABELS: Readonly<Record<ProjectState, string>> = {
  backlog: "Backlog",
  planned: "Planned",
  started: "In Progress",
  paused: "Paused",
  completed: "Completed",
  canceled: "Canceled",
};

export const PROJECT_HEALTH_LABELS: Readonly<Record<ProjectHealth, string>> = {
  onTrack: "On track",
  atRisk: "At risk",
  offTrack: "Off track",
};

/**
 * Health colours, from the semantic tokens rather than fresh hexes.
 *
 * `SPEC.md` §5 and `globals.css` own every colour in the app; a component that
 * invents `#e5a000` for "at risk" is a component the light theme forgets about.
 */
export const PROJECT_HEALTH_COLORS: Readonly<Record<ProjectHealth, string>> = {
  onTrack: "var(--success)",
  atRisk: "var(--warning)",
  offTrack: "var(--danger)",
};

/** `2026-03-16` → `Mar 16`, or with the year when it is not the current one. */
export function formatDate(date: string | null, now = new Date()): string {
  if (date === null) return "—";
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "—";
  const sameYear = parsed.getUTCFullYear() === now.getUTCFullYear();
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

/**
 * The percentage a donut and a bar both show.
 *
 * Canceled issues count as resolved, not as outstanding — a project whose
 * remaining work was all cancelled is finished, and counting them as open would
 * leave it permanently at 80%.
 */
export function completionRatio(progress: ProjectProgressView): number {
  if (progress.total === 0) return 0;
  return (progress.completed + progress.canceled) / progress.total;
}
