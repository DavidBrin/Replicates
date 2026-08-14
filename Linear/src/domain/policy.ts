/**
 * Authorization — one table, one function, no I/O.
 *
 * Every "may this person do this?" question in the application resolves here.
 * The rule the rest of the codebase must keep is stated in `SPEC.md` §4 and is
 * worth repeating: **no `if (user.role === "admin")` anywhere else**. A role
 * comparison written inline is a policy decision that no test can find and no
 * reviewer can diff against the matrix; `__tests__/policy.test.ts` greps for
 * them.
 *
 * ## The three axes and the union
 *
 * A user holds at most one workspace role, at most one role in the resource's
 * team, and at most one role in the resource's project. Effective permission is
 * the **union**: if any held role grants the action, it is granted. Deny by
 * default. That is GitLab's "highest role wins", and it is the only rule that
 * stays comprehensible when a person is a workspace guest, a team member and a
 * project lead at the same time.
 *
 * Two things sit *outside* the union and are checked first, because no grant
 * can rescue them: a user with no `workspace_members` row is not a principal of
 * this workspace at all, and a suspended member is denied everything including
 * leaving (`research/05-oss-architecture.md` §2.1, R9).
 *
 * ## Why the table is typed the way it is
 *
 * `POLICY` is declared `satisfies Record<Action, Record<RoleKey, Cell>>`. That
 * one line is what makes the matrix a matrix: `tsc` rejects a missing action
 * row, a missing role cell, and a typo'd key. `satisfies` rather than a type
 * annotation, because an annotation widens the value and the tests need the
 * literal cells.
 *
 * Rows are written with {@link row}, which merges over an all-deny base. The
 * base is where a newly added `RoleKey` produces its compile error — one place,
 * and the place where the decision actually has to be made.
 *
 * ## Where this table came from
 *
 * `research/05-oss-architecture.md` §2.2, transcribed row for row, footnote
 * markers preserved in the comments. The footnotes that describe a *fact* about
 * the resource (is the team public, is the actor the author, is a workspace
 * setting on) become predicate cells here. The footnotes that describe a
 * *transition* invariant — never demote the last owner, never promote above
 * your own rank — are not cells at all: they need a lock and a count, so they
 * live in {@link checkWorkspaceRoleChange} and friends at the bottom of this
 * file and are applied by `domain/services/membership.ts` inside a transaction.
 * Mixing the two would put a fact that requires `select … for update` behind a
 * function documented as pure.
 *
 * ## The one deliberate divergence from Linear
 *
 * In Linear, project membership carries no permissions. Here `proj:member`
 * grants edit on the project and on its issues, because the brief requires that
 * people added to a project can add to and edit it (`SPEC.md` §4). The grant is
 * strictly additive — every cell it fills was already `⛔` for that column, so
 * nothing Linear would allow is taken away.
 */

import {
  WORKSPACE_ROLE_RANK,
  type ProjectId,
  type ProjectRole,
  type TeamId,
  type TeamRole,
  type UserId,
  type WorkspaceRole,
} from "./entities";

/* ============================================================= role keys == */

/**
 * One column of the matrix.
 *
 * Built as a literal union rather than a template-literal type over the three
 * role enums, because the brief names these eight strings exactly and a
 * template type would silently absorb a new role instead of breaking the build
 * at {@link NOBODY}, which is where the decision belongs.
 */
export type RoleKey =
  | "ws:owner"
  | "ws:admin"
  | "ws:member"
  | "ws:guest"
  | "team:admin"
  | "team:member"
  | "proj:lead"
  | "proj:member";

export const ROLE_KEYS = [
  "ws:owner",
  "ws:admin",
  "ws:member",
  "ws:guest",
  "team:admin",
  "team:member",
  "proj:lead",
  "proj:member",
] as const satisfies readonly RoleKey[];

/**
 * Ranks for the escalation rules — never for the matrix.
 *
 * The workspace ranks come from `entities.ts` rather than being restated here:
 * the same enum defined twice is the anti-pattern this module exists to avoid
 * (`research/05-oss-architecture.md` §8, A1).
 */
export const TEAM_ROLE_RANK: Readonly<Record<TeamRole, number>> = Object.freeze({
  admin: 2,
  member: 1,
});

export const PROJECT_ROLE_RANK: Readonly<Record<ProjectRole, number>> =
  Object.freeze({ lead: 2, member: 1 });

/* =============================================================== actions == */

/**
 * The 48 rows of the matrix, in matrix order.
 *
 * `cycle.manage` is here although cycles are cut from the product (`SPEC.md`
 * §1). Dropping it would make the transcription a paraphrase, and the cost of
 * an unused row is one line; the cost of a matrix that no longer lines up with
 * its source is every future review of it.
 *
 * `team.view` and `team.view_private` are two actions rather than one action
 * with a predicate because the source table splits them into two rows with
 * different columns. Callers should not pick between them by hand —
 * {@link canViewTeam} does it.
 */
export const ACTIONS = [
  // Workspace
  "workspace.view",
  "workspace.update",
  "workspace.delete",
  "workspace.transfer_ownership",
  "workspace.view_members",
  "workspace.view_audit_log",
  "workspace_label.manage",
  // Membership
  "member.invite",
  "member.remove",
  "member.change_role",
  "member.leave",
  "invite.revoke",
  // Team
  "team.create",
  "team.view",
  "team.view_private",
  "team.join",
  "team.update",
  "team.set_private",
  "team.delete",
  "team.add_member",
  "team.add_guest",
  "team.remove_member",
  "team.change_member_role",
  "state.manage",
  "label.create",
  "label.update_delete",
  "cycle.manage",
  // Project
  "project.create",
  "project.view",
  "project.update",
  "project.archive",
  "project.delete",
  "project.add_member",
  "project.remove_member",
  "project.change_member_role",
  "project.add_team",
  "project.reorder",
  // Issue
  "issue.view",
  "issue.create",
  "issue.update_own",
  "issue.update_any",
  "issue.reorder",
  "issue.delete",
  "comment.create",
  "comment.update_delete",
  // Views
  "view.create_personal",
  "view.create_shared",
  "view.update_delete_shared",
] as const;

export type Action = (typeof ACTIONS)[number];

/* ============================================================== settings == */

/**
 * The only configurable cells in the matrix.
 *
 * Three footnotes (2, 6, 8) read a stored policy toggle instead of a fixed
 * decision, and one escalation rule (R3) does. Everything else is fixed, which
 * is what keeps the table a table.
 *
 * There is no settings column in `schema.sql` for these yet, so the defaults
 * below are the shipped behaviour and the type is what a settings screen would
 * write into. They are defaults, not constants: a predicate that read
 * `process.env` or a module-level mutable would make `can()` untestable.
 */
export interface WorkspacePolicySettings {
  /** Footnote 2: may a plain member invite people? */
  readonly memberInvitePolicy: "adminsOnly" | "anyMember";
  /** Footnote 6: may a plain member create a team? */
  readonly teamCreatePolicy: "adminsOnly" | "anyMember";
  /** R3: may an admin mint another admin, or only an owner? */
  readonly adminCanPromoteToAdmin: boolean;
}

export const DEFAULT_WORKSPACE_POLICY_SETTINGS: WorkspacePolicySettings =
  Object.freeze({
    memberInvitePolicy: "adminsOnly",
    teamCreatePolicy: "anyMember",
    adminCanPromoteToAdmin: true,
  });

/** Footnote 8: may a plain team member add another member to the team? */
export type TeamMembershipPolicy = "adminsOnly" | "anyMember";

/* ======================================================= actor & resource = */

/**
 * Who is asking, expressed entirely as memberships.
 *
 * Assembled by the caller from the three membership tables — `can()` does no
 * I/O and never will, so an actor is a snapshot rather than a handle. The two
 * role maps are keyed by id because the resource decides which entry counts: a
 * team lead of project A holds no project role at all when the question is
 * about project B.
 *
 * `settings` rides on the actor rather than on a third parameter because an
 * actor is already workspace-scoped — it is assembled per request for one
 * workspace, and these are that workspace's settings.
 */
export interface Actor {
  readonly userId: UserId | null;
  /** `null` = no `workspace_members` row. Denies everything, always. */
  readonly workspaceRole: WorkspaceRole | null;
  /** R9. Denies everything including `member.leave`. */
  readonly suspended?: boolean;
  readonly teamRoles?: Readonly<Record<TeamId, TeamRole>>;
  readonly projectRoles?: Readonly<Record<ProjectId, ProjectRole>>;
  readonly settings?: WorkspacePolicySettings;
}

/** The anonymous actor. Denied everything by the preconditions in {@link can}. */
export const ANONYMOUS: Actor = Object.freeze({
  userId: null,
  workspaceRole: null,
});

export type ResourceKind =
  | "workspace"
  | "member"
  | "invite"
  | "team"
  | "project"
  | "issue"
  | "comment"
  | "label"
  | "view";

/**
 * What is being acted on, and which containers own it.
 *
 * Deliberately one open shape rather than a discriminated union. `kind` is
 * documentation and a guard against passing an issue where a team was meant;
 * the fields that decide anything are the owning team and project, because
 * those are what select the actor's team and project role. Every fact is
 * optional and every predicate that reads a missing one **fails closed** — a
 * caller who forgets to attach the team gets a denial, never a throw and never
 * an accidental grant.
 */
export interface Resource {
  readonly kind: ResourceKind;
  /** The team that owns the resource, or the team itself. */
  readonly team?: {
    readonly id: TeamId;
    readonly private: boolean;
    /** Footnote 8. Defaults to `anyMember` when absent. */
    readonly membershipPolicy?: TeamMembershipPolicy;
  };
  /** The project that owns the resource, or the project itself. */
  readonly project?: {
    readonly id: ProjectId;
    /** Footnote 11: one private team on a project hides the project. */
    readonly allTeamsPublic: boolean;
  };
  /** Who created it — the "own" in footnotes 5, 13, 14 and 15. */
  readonly authorId?: UserId | null;
  /** Issues only. Footnote 13 counts the assignee as an owner. */
  readonly assigneeId?: UserId | null;
}

/* ================================================================ cells === */

export const ALLOW = "allow" as const;
export const DENY = "deny" as const;

/** A footnote, as code. Pure, total, and false on any fact it cannot see. */
export type Predicate = (actor: Actor, resource: Resource) => boolean;

export type Cell = typeof ALLOW | typeof DENY | Predicate;

export type PolicyRow = Readonly<Record<RoleKey, Cell>>;

/**
 * The all-deny base every row is written over.
 *
 * Adding a `RoleKey` breaks the build here and nowhere else, which is the point:
 * one edit, one decision, and every row inherits a deny until someone grants it
 * deliberately.
 */
const NOBODY: PolicyRow = {
  "ws:owner": DENY,
  "ws:admin": DENY,
  "ws:member": DENY,
  "ws:guest": DENY,
  "team:admin": DENY,
  "team:member": DENY,
  "proj:lead": DENY,
  "proj:member": DENY,
};

const row = (overrides: Partial<PolicyRow>): PolicyRow => ({
  ...NOBODY,
  ...overrides,
});

/* =========================================================== predicates == */

function settingsOf(actor: Actor): WorkspacePolicySettings {
  return actor.settings ?? DEFAULT_WORKSPACE_POLICY_SETTINGS;
}

/** Footnote 2. */
export const memberInvitesAllowed: Predicate = (actor) =>
  settingsOf(actor).memberInvitePolicy === "anyMember";

/** Footnote 6. */
export const memberTeamCreateAllowed: Predicate = (actor) =>
  settingsOf(actor).teamCreatePolicy === "anyMember";

/**
 * Footnote 8. Absent policy means open, which is the documented default; a team
 * that has never opened its settings screen behaves like Linear's.
 */
export const teamOpenMembership: Predicate = (_actor, resource) =>
  (resource.team?.membershipPolicy ?? "anyMember") === "anyMember";

/** Footnote 11, team half: a workspace member reaches public teams only. */
export const inPublicTeam: Predicate = (_actor, resource) =>
  resource.team?.private === false;

/**
 * Footnote 11, project half.
 *
 * "Every team attached to the resource is public" — for a project that is the
 * `allTeamsPublic` roll-up, and a project reached through a private team is
 * hidden even if its other teams are public.
 */
export const projectFullyPublic: Predicate = (_actor, resource) =>
  (resource.project?.allTeamsPublic ?? false) && resource.team?.private !== true;

/** Footnotes 5, 14, 15 — "their own". */
export const isAuthor: Predicate = (actor, resource) =>
  actor.userId !== null && resource.authorId === actor.userId;

const isAuthorOrAssignee: Predicate = (actor, resource) =>
  isAuthor(actor, resource) ||
  (actor.userId !== null && resource.assigneeId === actor.userId);

/** Footnote 13: their own issue, in a public team. */
export const authorInPublicTeam: Predicate = (actor, resource) =>
  isAuthorOrAssignee(actor, resource) && inPublicTeam(actor, resource);

/* ================================================================ table == */

/**
 * The matrix. `research/05-oss-architecture.md` §2.2, row for row.
 *
 * `–` in the source ("this role does not reach this resource kind") is written
 * as a deny, exactly as the source says it behaves. The distinction is intent,
 * not code, and it is preserved in the source rather than duplicated here.
 */
export const POLICY = {
  /* -- workspace ------------------------------------------------------- */

  // 1 — guests get the app shell and their own settings, nothing workspace-wide.
  "workspace.view": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "ws:member": ALLOW,
    "ws:guest": ALLOW,
  }),
  // 2
  "workspace.update": row({ "ws:owner": ALLOW, "ws:admin": ALLOW }),
  // 3
  "workspace.delete": row({ "ws:owner": ALLOW }),
  // 4
  "workspace.transfer_ownership": row({ "ws:owner": ALLOW }),
  // 5
  "workspace.view_members": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "ws:member": ALLOW,
  }),
  // 6
  "workspace.view_audit_log": row({ "ws:owner": ALLOW, "ws:admin": ALLOW }),
  // 7
  "workspace_label.manage": row({ "ws:owner": ALLOW, "ws:admin": ALLOW }),

  /* -- membership ------------------------------------------------------ */

  // 8 — fn 2
  "member.invite": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "ws:member": memberInvitesAllowed,
  }),
  // 9 — fn 3 (rank and last-owner limits are R2/R4, not cells)
  "member.remove": row({ "ws:owner": ALLOW, "ws:admin": ALLOW }),
  // 10 — fn 3
  "member.change_role": row({ "ws:owner": ALLOW, "ws:admin": ALLOW }),
  // 11 — fn 4 (an owner leaving is gated by R4, under the workspace lock)
  "member.leave": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "ws:member": ALLOW,
    "ws:guest": ALLOW,
  }),
  // 12 — fn 5
  "invite.revoke": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "ws:member": isAuthor,
  }),

  /* -- team ------------------------------------------------------------ */

  // 13 — fn 6
  "team.create": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "ws:member": memberTeamCreateAllowed,
  }),
  // 14 — public team
  "team.view": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "ws:member": ALLOW,
    "team:admin": ALLOW,
    "team:member": ALLOW,
  }),
  // 15 — private team. fn 7: owners and admins may *list* it and self-join;
  // reading inside it still needs a `team_members` row, which is what makes
  // the grant visible in an audit log instead of silent.
  "team.view_private": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
    "team:member": ALLOW,
  }),
  // 16 — public teams only; there is no self-join path into a private team.
  "team.join": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "ws:member": ALLOW,
  }),
  // 17
  "team.update": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
  }),
  // 18
  "team.set_private": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
  }),
  // 19
  "team.delete": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
  }),
  // 20 — fn 8
  "team.add_member": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
    "team:member": teamOpenMembership,
  }),
  // 21 — a guest's team scoping is decided by whoever invites them.
  "team.add_guest": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
  }),
  // 22
  "team.remove_member": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
  }),
  // 23 — fn 9 (last team admin is R5)
  "team.change_member_role": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
  }),
  // 24
  "state.manage": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
  }),
  // 25 — creating a label is work, not administration.
  "label.create": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
    "team:member": ALLOW,
  }),
  // 26 — editing one is administration: it changes what everyone else sees.
  "label.update_delete": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
  }),
  // 27
  "cycle.manage": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
  }),

  /* -- project --------------------------------------------------------- */

  // 28 — fn 10: projects are owned by teams, so creating one is team-scoped.
  "project.create": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
    "team:member": ALLOW,
  }),
  // 29 — fn 11
  "project.view": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "ws:member": projectFullyPublic,
    "team:admin": ALLOW,
    "team:member": ALLOW,
    "proj:lead": ALLOW,
    "proj:member": ALLOW,
  }),
  // 30 — the deviation: `proj:member` edits.
  "project.update": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
    "proj:lead": ALLOW,
    "proj:member": ALLOW,
  }),
  // 31
  "project.archive": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
    "proj:lead": ALLOW,
  }),
  // 32
  "project.delete": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
    "proj:lead": ALLOW,
  }),
  // 33 — fn 12: the deviation again, narrowed by R1 at the transition (a
  // project member may add members, never leads, never guests, never teams).
  "project.add_member": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
    "proj:lead": ALLOW,
    "proj:member": ALLOW,
  }),
  // 34
  "project.remove_member": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
    "proj:lead": ALLOW,
  }),
  // 35
  "project.change_member_role": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
    "proj:lead": ALLOW,
  }),
  // 36
  "project.add_team": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
    "proj:lead": ALLOW,
  }),
  // 37
  "project.reorder": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
    "proj:lead": ALLOW,
    "proj:member": ALLOW,
  }),

  /* -- issue ----------------------------------------------------------- */

  // 38 — fn 11
  "issue.view": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "ws:member": inPublicTeam,
    "team:admin": ALLOW,
    "team:member": ALLOW,
    "proj:lead": ALLOW,
    "proj:member": ALLOW,
  }),
  // 39 — fn 11: read follows visibility, so filing into a public team is open.
  "issue.create": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "ws:member": inPublicTeam,
    "team:admin": ALLOW,
    "team:member": ALLOW,
    "proj:lead": ALLOW,
    "proj:member": ALLOW,
  }),
  // 40 — fn 13
  "issue.update_own": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "ws:member": authorInPublicTeam,
    "team:admin": ALLOW,
    "team:member": ALLOW,
    "proj:lead": ALLOW,
    "proj:member": ALLOW,
  }),
  // 41 — write follows membership: editing someone else's issue needs a
  // container role, and the project column is the deviation.
  "issue.update_any": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
    "team:member": ALLOW,
    "proj:lead": ALLOW,
    "proj:member": ALLOW,
  }),
  // 42 — one global order, so reordering is editing everyone's view.
  "issue.reorder": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
    "team:member": ALLOW,
    "proj:lead": ALLOW,
    "proj:member": ALLOW,
  }),
  // 43 — fn 14. Not role-gated beyond this: the 30-day trash window is the
  // safety net, matching Linear (`SPEC.md` §4).
  "issue.delete": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
    "team:member": isAuthor,
    "proj:lead": ALLOW,
    "proj:member": isAuthor,
  }),
  // 44 — fn 11
  "comment.create": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "ws:member": inPublicTeam,
    "team:admin": ALLOW,
    "team:member": ALLOW,
    "proj:lead": ALLOW,
    "proj:member": ALLOW,
  }),
  // 45 — fn 15
  "comment.update_delete": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "ws:member": isAuthor,
    "team:admin": ALLOW,
    "team:member": isAuthor,
    "proj:lead": ALLOW,
    "proj:member": isAuthor,
  }),

  /* -- views ----------------------------------------------------------- */

  // 46 — a personal view is a bookmark; everyone gets one, guests included.
  "view.create_personal": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "ws:member": ALLOW,
    "ws:guest": ALLOW,
    "team:admin": ALLOW,
    "team:member": ALLOW,
    "proj:lead": ALLOW,
    "proj:member": ALLOW,
  }),
  // 47 — a shared view is workspace furniture; it needs a container role.
  "view.create_shared": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
    "team:member": ALLOW,
    "proj:lead": ALLOW,
    "proj:member": ALLOW,
  }),
  // 48 — fn 15
  "view.update_delete_shared": row({
    "ws:owner": ALLOW,
    "ws:admin": ALLOW,
    "team:admin": ALLOW,
    "team:member": isAuthor,
    "proj:lead": ALLOW,
    "proj:member": isAuthor,
  }),
} as const satisfies Record<Action, PolicyRow>;

/* ================================================================= can === */

/**
 * The role keys this actor holds *for this resource*.
 *
 * Note what is not here: workspace owners and admins are not given a synthetic
 * `team:admin` key even though `SPEC.md` §4 calls them implicit team admins.
 * They do not need one — every cell where `team:admin` is granted, `ws:owner`
 * and `ws:admin` are granted too. Synthesising the key would add a second place
 * where that equivalence has to stay true.
 */
function heldRoleKeys(actor: Actor, resource: Resource): RoleKey[] {
  const keys: RoleKey[] = [];
  if (actor.workspaceRole) keys.push(`ws:${actor.workspaceRole}`);

  const teamId = resource.team?.id;
  const teamRole = teamId ? actor.teamRoles?.[teamId] : undefined;
  if (teamRole) keys.push(`team:${teamRole}`);

  const projectId = resource.project?.id;
  const projectRole = projectId ? actor.projectRoles?.[projectId] : undefined;
  if (projectRole) keys.push(`proj:${projectRole}`);

  return keys;
}

/**
 * May `actor` perform `action` on `resource`?
 *
 * Pure, synchronous, and it never throws — a predicate that cannot see the fact
 * it needs returns false rather than exploding, so a caller who under-populates
 * the resource gets a denial they can debug instead of a 500.
 */
export function can(actor: Actor, action: Action, resource: Resource): boolean {
  // Preconditions, outside the matrix on purpose: no grant can rescue a
  // non-member or a suspended member.
  if (actor.userId === null) return false;
  if (actor.workspaceRole === null) return false;
  if (actor.suspended === true) return false;

  const policyRow: PolicyRow = POLICY[action];
  for (const key of heldRoleKeys(actor, resource)) {
    const cell = policyRow[key];
    if (cell === DENY) continue;
    if (cell === ALLOW) return true;
    if (cell(actor, resource)) return true;
  }
  return false;
}

/**
 * Reading a team, with the public/private split handled once.
 *
 * The matrix splits `team.view` across two rows because the columns differ, and
 * a caller choosing the wrong row is a silent privacy bug. Nobody should be
 * writing `can(actor, "team.view", …)` by hand.
 */
export function canViewTeam(
  actor: Actor,
  team: { readonly id: TeamId; readonly private: boolean },
): boolean {
  return can(actor, team.private ? "team.view_private" : "team.view", {
    kind: "team",
    team,
  });
}

/**
 * Which action adding someone to a team really is.
 *
 * The matrix has two rows — `team.add_member` and `team.add_guest` — because a
 * team admin may do both while a plain team member may do neither to a guest
 * (footnote 8). Picking between them by hand at the call site would put a role
 * comparison outside this module, which is the thing `SPEC.md` §4 forbids.
 */
export function teamAddAction(targetWorkspaceRole: WorkspaceRole): Action {
  return targetWorkspaceRole === "guest" ? "team.add_guest" : "team.add_member";
}

/**
 * R7, second half: does demoting someone to this workspace role oblige us to
 * strip their container admin roles in the same transaction?
 *
 * Only a demotion to guest does. Leaving it out is the quiet version of the
 * bug: the workspace list shows a guest while `team_members` still says admin,
 * and every subsequent union grants on the stale row.
 */
export function demotesContainerRoles(nextRole: WorkspaceRole): boolean {
  return nextRole === "guest";
}

/* ============================================== transitions (R1–R7, R9) == */

/**
 * A refusal that has to explain itself.
 *
 * `can()` returns a boolean because the matrix is a boolean table. Role
 * transitions cannot: "you may not demote this person" is useless without
 * "because they are the last owner", and the UI has to render the difference.
 */
export type Denial =
  | { readonly code: "NOT_A_MEMBER" }
  | { readonly code: "MEMBERSHIP_SUSPENDED" }
  | { readonly code: "INSUFFICIENT_ROLE"; readonly action: Action }
  | {
      readonly code: "RANK_NOT_ABOVE_TARGET";
      readonly targetRole: WorkspaceRole | TeamRole | ProjectRole;
    }
  | {
      readonly code: "CANNOT_GRANT_ABOVE_OWN_RANK";
      readonly requested: WorkspaceRole | TeamRole | ProjectRole;
    }
  | { readonly code: "LAST_OWNER" }
  | { readonly code: "LAST_TEAM_ADMIN"; readonly teamId: TeamId }
  | {
      readonly code: "GUEST_CANNOT_HOLD_ROLE";
      readonly role: TeamRole | ProjectRole;
    }
  | {
      readonly code: "NOT_FOUND";
      readonly what: "workspace" | "team" | "project" | "member" | "invite";
    }
  | { readonly code: "INVITE_INVALID" }
  | { readonly code: "INVITE_EXPIRED" }
  | { readonly code: "INVITE_ALREADY_USED" };

export type Authorized<T = void> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly denial: Denial };

export function allowed<T>(value: T): Authorized<T> {
  return { ok: true, value };
}

export function denied<T = void>(denial: Denial): Authorized<T> {
  return { ok: false, denial };
}

/** Human-readable, and safe to return to a client: no ids, no emails. */
export function explainDenial(denial: Denial): string {
  switch (denial.code) {
    case "NOT_A_MEMBER":
      return "You are not a member of this workspace.";
    case "MEMBERSHIP_SUSPENDED":
      return "Your membership is suspended.";
    case "INSUFFICIENT_ROLE":
      return "Your role does not allow this.";
    case "RANK_NOT_ABOVE_TARGET":
      return "You cannot act on a member at or above your own role.";
    case "CANNOT_GRANT_ABOVE_OWN_RANK":
      return "You cannot grant a role above your own.";
    case "LAST_OWNER":
      return "A workspace must keep at least one owner.";
    case "LAST_TEAM_ADMIN":
      return "A team must keep at least one admin.";
    case "GUEST_CANNOT_HOLD_ROLE":
      return "Guests cannot hold an admin or lead role.";
    case "NOT_FOUND":
      return "Not found.";
    case "INVITE_INVALID":
      return "This invite link is no longer valid.";
    case "INVITE_EXPIRED":
      return "This invite link has expired.";
    case "INVITE_ALREADY_USED":
      return "This invite link has already been used.";
  }
}

/**
 * R1–R4 and R7 for a workspace role change, as one pure decision.
 *
 * `activeOwnerCount` is a parameter rather than a lookup because of the bug the
 * spec calls out by name: two concurrent demotions that each *read* two owners
 * both pass. The count is only meaningful when it was read inside the same
 * transaction as the write, under `select … for update` on the workspace row —
 * see `domain/services/membership.ts`, which is the only caller allowed to
 * produce it.
 *
 * Order matters. R4 is checked first so "a workspace must keep an owner" is the
 * message an owner demoting themselves sees, rather than a rank complaint that
 * would be true but unhelpful.
 */
export function checkWorkspaceRoleChange(
  actorRole: WorkspaceRole,
  target: { readonly currentRole: WorkspaceRole; readonly isSelf: boolean },
  nextRole: WorkspaceRole,
  activeOwnerCount: number,
  settings: WorkspacePolicySettings = DEFAULT_WORKSPACE_POLICY_SETTINGS,
): Authorized {
  const actorRank = WORKSPACE_ROLE_RANK[actorRole];

  // R4 — the last owner is immovable.
  if (
    target.currentRole === "owner" &&
    nextRole !== "owner" &&
    activeOwnerCount <= 1
  ) {
    return denied({ code: "LAST_OWNER" });
  }

  // R2 — never act on an equal or higher rank. Self is carved out here and
  // only here: an owner demoting themselves is legitimate (R4 already stopped
  // the last one), and folding it in elsewhere is where the classic "an admin
  // can demote themselves but not another admin, except sometimes" bug lives.
  if (
    !target.isSelf &&
    WORKSPACE_ROLE_RANK[target.currentRole] >= actorRank
  ) {
    return denied({
      code: "RANK_NOT_ABOVE_TARGET",
      targetRole: target.currentRole,
    });
  }

  // R1 — never grant above your own rank.
  if (WORKSPACE_ROLE_RANK[nextRole] > actorRank) {
    return denied({ code: "CANNOT_GRANT_ABOVE_OWN_RANK", requested: nextRole });
  }

  // R3 — admin-to-admin promotion is legal but one-way, so it is a setting.
  if (
    nextRole === "admin" &&
    actorRole === "admin" &&
    !settings.adminCanPromoteToAdmin
  ) {
    return denied({ code: "CANNOT_GRANT_ABOVE_OWN_RANK", requested: nextRole });
  }

  return allowed(undefined);
}

/**
 * R4 for removal and for leaving — the same rule, a different verb.
 *
 * Removal and departure differ in who initiates them and in nothing else that
 * matters here, so they share one check rather than two that could drift.
 */
export function checkWorkspaceRemoval(
  actorRole: WorkspaceRole,
  target: { readonly currentRole: WorkspaceRole; readonly isSelf: boolean },
  activeOwnerCount: number,
): Authorized {
  if (target.currentRole === "owner" && activeOwnerCount <= 1) {
    return denied({ code: "LAST_OWNER" });
  }
  if (target.isSelf) return allowed(undefined);
  if (WORKSPACE_ROLE_RANK[target.currentRole] >= WORKSPACE_ROLE_RANK[actorRole]) {
    return denied({
      code: "RANK_NOT_ABOVE_TARGET",
      targetRole: target.currentRole,
    });
  }
  return allowed(undefined);
}

/**
 * R1, R5 and R7 for a team role change.
 *
 * `adminCount` carries the same warning as `activeOwnerCount`: it is only worth
 * anything read under the lock. R7 is the reason a workspace role is a
 * parameter here — a guest may hold `team:member` but never `team:admin`, and
 * the check belongs on the transition, not on every read afterwards.
 */
export function checkTeamRoleChange(
  teamId: TeamId,
  actor: { readonly workspaceRole: WorkspaceRole; readonly teamRole: TeamRole | null },
  target: {
    readonly currentRole: TeamRole | null;
    readonly workspaceRole: WorkspaceRole;
    readonly isSelf: boolean;
  },
  nextRole: TeamRole,
  adminCount: number,
): Authorized {
  // R7 — guests are never container admins.
  if (target.workspaceRole === "guest" && nextRole === "admin") {
    return denied({ code: "GUEST_CANNOT_HOLD_ROLE", role: "admin" });
  }

  // R5 — the last team admin is immovable. A team with no admin cannot change
  // its own states or membership and needs a workspace admin to rescue it.
  if (
    target.currentRole === "admin" &&
    nextRole !== "admin" &&
    adminCount <= 1
  ) {
    return denied({ code: "LAST_TEAM_ADMIN", teamId });
  }

  // Workspace admins and owners administer every team they can reach, so the
  // team-scope rank rules only bind someone acting purely as a team admin.
  const actsAsWorkspaceAdmin =
    actor.workspaceRole === "owner" || actor.workspaceRole === "admin";
  if (actsAsWorkspaceAdmin) return allowed(undefined);

  if (actor.teamRole === null) {
    return denied({ code: "INSUFFICIENT_ROLE", action: "team.change_member_role" });
  }

  // R1 at team scope.
  if (TEAM_ROLE_RANK[nextRole] > TEAM_ROLE_RANK[actor.teamRole]) {
    return denied({ code: "CANNOT_GRANT_ABOVE_OWN_RANK", requested: nextRole });
  }

  // R2 at team scope, with the same self carve-out as the workspace rule.
  if (
    !target.isSelf &&
    target.currentRole !== null &&
    TEAM_ROLE_RANK[target.currentRole] >= TEAM_ROLE_RANK[actor.teamRole]
  ) {
    return denied({ code: "RANK_NOT_ABOVE_TARGET", targetRole: target.currentRole });
  }

  return allowed(undefined);
}

/**
 * R5 and R8 for leaving or being removed from a team.
 *
 * Same lock, same count, different verb. Leaving a private team is one-way —
 * there is no self-join path back in (row 16 is public teams only) — but that
 * is a product consequence, not a refusal, so it is not checked here.
 */
export function checkTeamRemoval(
  teamId: TeamId,
  actor: { readonly workspaceRole: WorkspaceRole; readonly teamRole: TeamRole | null },
  target: { readonly currentRole: TeamRole; readonly isSelf: boolean },
  adminCount: number,
): Authorized {
  if (target.currentRole === "admin" && adminCount <= 1) {
    return denied({ code: "LAST_TEAM_ADMIN", teamId });
  }
  if (target.isSelf) return allowed(undefined);

  const actsAsWorkspaceAdmin =
    actor.workspaceRole === "owner" || actor.workspaceRole === "admin";
  if (actsAsWorkspaceAdmin) return allowed(undefined);

  if (actor.teamRole !== "admin") {
    return denied({ code: "INSUFFICIENT_ROLE", action: "team.remove_member" });
  }
  return allowed(undefined);
}

/**
 * R6 — there is deliberately no "last project lead" rule.
 *
 * A project may legitimately have zero leads; team and workspace admins can
 * still administer it. The only transition rule at project scope is R7 and R1:
 * a guest is never a lead, and a project member may not mint one.
 */
export function checkProjectRoleChange(
  actor: { readonly workspaceRole: WorkspaceRole; readonly projectRole: ProjectRole | null },
  target: { readonly workspaceRole: WorkspaceRole },
  nextRole: ProjectRole,
): Authorized {
  if (target.workspaceRole === "guest" && nextRole === "lead") {
    return denied({ code: "GUEST_CANNOT_HOLD_ROLE", role: "lead" });
  }

  const actsAsWorkspaceAdmin =
    actor.workspaceRole === "owner" || actor.workspaceRole === "admin";
  if (actsAsWorkspaceAdmin) return allowed(undefined);

  if (
    actor.projectRole !== null &&
    PROJECT_ROLE_RANK[nextRole] > PROJECT_ROLE_RANK[actor.projectRole]
  ) {
    return denied({ code: "CANNOT_GRANT_ABOVE_OWN_RANK", requested: nextRole });
  }

  return allowed(undefined);
}
