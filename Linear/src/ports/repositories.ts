/**
 * The persistence port: one interface per aggregate, in domain vocabulary.
 *
 * Nothing here mentions a table, a column, a placeholder or a row. The types
 * are the ones in `domain/entities.ts`, and a caller reading this file learns
 * what the application can *do* to its data without learning anything about how
 * it is stored. `adapters/repositories/*` is the Postgres implementation and is
 * the only place SQL exists.
 *
 * ## The one type that does cross the line, and why
 *
 * Every method takes an optional trailing {@link Tx}. It is the database port's
 * executor, imported as a type and therefore erased at build time — this file
 * emits no import at runtime and can be read by the browser.
 *
 * It is here because the alternative is worse. Creating an issue has to bump
 * `teams.issue_counter`, insert the issue, attach its labels, write an activity
 * row and append a change event, and either all five happen or none do. Without
 * a way to pass a transaction *into* a repository, that composition has to
 * happen inside a single god-method on one repository, which then needs to know
 * about activities and change events — or each repository opens its own
 * transaction and the guarantee is gone. A trailing executor keeps the
 * aggregates apart and lets a service compose them atomically:
 *
 * ```ts
 * await db.transaction(async (tx) => {
 *   const issue = await issues.create(input, actorId, tx);
 *   await notifications.create({ ... }, tx);
 * });
 * ```
 *
 * **Passing an executor transfers the transaction boundary to the caller.** A
 * repository given one will not open a transaction of its own, so a caller that
 * passes the pool instead of a real transaction gets non-atomic writes and no
 * warning. Pass what `db.transaction()` handed you, or pass nothing.
 *
 * ## Actors
 *
 * Mutations take an `actorId` separate from the entity's own fields, because
 * every one of them writes an activity row and a change event naming who did
 * it. It is not derived from the input: `assigneeId` is who the work is for and
 * `actorId` is who made the change, and conflating them makes the feed read
 * "David assigned this to David" for every self-assignment someone else made.
 * Authorization is *not* done here — see `domain/policy` — this is an audit
 * trail, not a gate.
 */

import type { SqlExecutor } from "@/adapters/db/driver";
import type {
  Activity,
  ActivityPayload,
  ActivityType,
  Comment,
  CommentId,
  DisplayOptions,
  EstimationScale,
  Invite,
  InviteStatus,
  IssueFilter,
  IssueId,
  IssueRelation,
  IssueRelationType,
  IssueWithRelations,
  Label,
  LabelId,
  MilestoneId,
  Notification,
  NotificationType,
  OrderBy,
  Priority,
  Project,
  ProjectHealth,
  ProjectId,
  ProjectMember,
  ProjectMilestone,
  ProjectRole,
  ProjectState,
  ProjectUpdate,
  Reaction,
  SavedView,
  StateId,
  StateType,
  Team,
  TeamId,
  TeamMember,
  TeamRole,
  Timestamp,
  User,
  UserId,
  ViewId,
  Workspace,
  WorkspaceId,
  WorkspaceMember,
  WorkspaceRole,
  WorkflowState,
} from "@/domain/entities";
import type { SortDirection } from "@/domain/sorting";

/**
 * A handle that can run statements — the pool, or a live transaction.
 *
 * Aliased rather than re-exported under its own name so that call sites read
 * `tx?: Tx` and the intent ("this is where you hand me your transaction") is
 * legible without knowing the database port.
 */
export type Tx = SqlExecutor;

/** Thrown when a repository is asked to act on a row that is not there. */
export class NotFoundError extends Error {
  constructor(
    readonly entity: string,
    readonly id: string,
  ) {
    super(`${entity} ${id} not found`);
    this.name = "NotFoundError";
  }
}

/** Thrown when a write would break an invariant the schema cannot express. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/**
 * A `Partial<T>` where `null` means "clear this" and `undefined` means "leave
 * it alone".
 *
 * The distinction is load-bearing for every patch type below. `{}` must not
 * unassign an issue, and `{ assigneeId: null }` must. Spreading a form's state
 * into a patch makes the difference invisible unless the type insists on it.
 */
export type Patch<T> = { readonly [K in keyof T]?: T[K] };

/* ============================================================ workspaces = */

export interface CreateWorkspaceInput {
  readonly id?: WorkspaceId;
  readonly name: string;
  /** Defaults to a slug of the name, uniquified if taken. */
  readonly urlKey?: string;
  /** Becomes the workspace's first — and, until another is promoted, only — owner. */
  readonly ownerId: UserId;
}

/** A membership joined to the user it names, which is what a list ever needs. */
export interface WorkspaceMemberWithUser extends WorkspaceMember {
  readonly user: User;
}

/**
 * An invite as stored.
 *
 * `Invite.token` is deliberately absent: only a hash of the token reaches the
 * database, so the plaintext exists once, in the response that creates the
 * invite, and never again. A repository that could return it would be a
 * repository that could leak every pending invite in a workspace dump.
 */
export type StoredInvite = Omit<Invite, "token">;

export interface CreateInviteInput {
  readonly id?: Invite["id"];
  readonly workspaceId: WorkspaceId;
  readonly email: string | null;
  readonly role: WorkspaceRole;
  readonly teamIds: readonly TeamId[];
  /** The hash of the token in the link. The repository never sees the token. */
  readonly tokenHash: string;
  readonly invitedById: UserId;
  readonly expiresAt: Timestamp;
}

export interface WorkspaceRepository {
  create(input: CreateWorkspaceInput, tx?: Tx): Promise<Workspace>;
  byId(id: WorkspaceId, tx?: Tx): Promise<Workspace | null>;
  byUrlKey(urlKey: string, tx?: Tx): Promise<Workspace | null>;
  /** Every workspace the user is a member of, oldest membership first. */
  listForUser(userId: UserId, tx?: Tx): Promise<Workspace[]>;
  update(
    id: WorkspaceId,
    patch: Patch<Pick<Workspace, "name" | "logoUrl" | "allowJoinByDomain" | "allowedDomain">>,
    actorId: UserId,
    tx?: Tx,
  ): Promise<Workspace>;

  listMembers(id: WorkspaceId, tx?: Tx): Promise<WorkspaceMemberWithUser[]>;
  memberOf(
    workspaceId: WorkspaceId,
    userId: UserId,
    tx?: Tx,
  ): Promise<WorkspaceMember | null>;
  addMember(
    workspaceId: WorkspaceId,
    userId: UserId,
    role: WorkspaceRole,
    tx?: Tx,
  ): Promise<WorkspaceMember>;
  /**
   * Change a member's role.
   *
   * Refuses to demote the last owner. Two concurrent demotions that each read
   * `owners = 2` would otherwise both conclude they are safe and leave a
   * workspace nobody can administer (SPEC §4), so the count is a *predicate of
   * the update statement* rather than an `if` in front of it, under a row lock
   * on the workspace.
   */
  setMemberRole(
    workspaceId: WorkspaceId,
    userId: UserId,
    role: WorkspaceRole,
    actorId: UserId,
    tx?: Tx,
  ): Promise<WorkspaceMember>;
  /** Refuses to remove the last owner, by the same mechanism. */
  removeMember(
    workspaceId: WorkspaceId,
    userId: UserId,
    actorId: UserId,
    tx?: Tx,
  ): Promise<void>;
  countOwners(workspaceId: WorkspaceId, tx?: Tx): Promise<number>;

  createInvite(input: CreateInviteInput, tx?: Tx): Promise<StoredInvite>;
  inviteByTokenHash(tokenHash: string, tx?: Tx): Promise<StoredInvite | null>;
  listInvites(
    workspaceId: WorkspaceId,
    status?: InviteStatus,
    tx?: Tx,
  ): Promise<StoredInvite[]>;
  /**
   * Mark an invite accepted and add the user to the workspace and its teams.
   *
   * One call rather than three, because an invite that is consumed without the
   * membership landing is a token spent for nothing and no way to tell.
   */
  acceptInvite(
    inviteId: Invite["id"],
    userId: UserId,
    tx?: Tx,
  ): Promise<WorkspaceMember>;
  revokeInvite(inviteId: Invite["id"], actorId: UserId, tx?: Tx): Promise<void>;
}

/* ================================================================= teams = */

export interface CreateTeamInput {
  readonly id?: TeamId;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  /** Defaults to initials of the name, uniquified if taken. */
  readonly key?: string;
  readonly description?: string | null;
  readonly icon?: string;
  readonly color?: string;
  readonly private?: boolean;
  readonly triageEnabled?: boolean;
  readonly estimationScale?: EstimationScale;
  /**
   * Skip creating the default workflow states.
   *
   * A team with no states cannot hold an issue, so this exists only for an
   * importer that is about to supply its own set.
   */
  readonly withoutDefaultStates?: boolean;
}

export interface TeamMemberWithUser extends TeamMember {
  readonly user: User;
}

export interface CreateWorkflowStateInput {
  readonly id?: StateId;
  readonly teamId: TeamId;
  readonly name: string;
  readonly type: StateType;
  readonly color: string;
  readonly description?: string | null;
  /** Defaults to the end of the state's own type group. */
  readonly position?: number;
}

export interface TeamRepository {
  create(input: CreateTeamInput, actorId: UserId, tx?: Tx): Promise<Team>;
  byId(id: TeamId, tx?: Tx): Promise<Team | null>;
  byKey(workspaceId: WorkspaceId, key: string, tx?: Tx): Promise<Team | null>;
  /** Every team in the workspace, including private ones. */
  listForWorkspace(workspaceId: WorkspaceId, tx?: Tx): Promise<Team[]>;
  /**
   * The teams a user may see: their own memberships, plus every public team in
   * the workspace unless they are a guest.
   *
   * The guest rule is the reason this is a query rather than a filter applied
   * afterwards — a guest must not be able to *discover* a team, so an unlisted
   * team is one that was never selected, not one that was fetched and hidden.
   */
  listForUser(workspaceId: WorkspaceId, userId: UserId, tx?: Tx): Promise<Team[]>;
  update(
    id: TeamId,
    patch: Patch<
      Pick<
        Team,
        | "name"
        | "key"
        | "description"
        | "icon"
        | "color"
        | "private"
        | "triageEnabled"
        | "estimationScale"
      >
    >,
    actorId: UserId,
    tx?: Tx,
  ): Promise<Team>;
  delete(id: TeamId, actorId: UserId, tx?: Tx): Promise<void>;

  listMembers(teamId: TeamId, tx?: Tx): Promise<TeamMemberWithUser[]>;
  addMember(
    teamId: TeamId,
    userId: UserId,
    role: TeamRole,
    tx?: Tx,
  ): Promise<TeamMember>;
  setMemberRole(
    teamId: TeamId,
    userId: UserId,
    role: TeamRole,
    tx?: Tx,
  ): Promise<TeamMember>;
  removeMember(teamId: TeamId, userId: UserId, tx?: Tx): Promise<void>;

  listStates(teamId: TeamId, tx?: Tx): Promise<WorkflowState[]>;
  createState(input: CreateWorkflowStateInput, tx?: Tx): Promise<WorkflowState>;
  updateState(
    id: StateId,
    patch: Patch<Pick<WorkflowState, "name" | "color" | "description" | "position">>,
    tx?: Tx,
  ): Promise<WorkflowState>;
  /**
   * Delete a state, moving its issues to `reassignToId`.
   *
   * The reassignment is not optional: `issues.state_id` is `not null` with no
   * cascade, so deleting a state with issues in it either fails or orphans
   * them, and neither is a thing a settings screen should be able to do.
   */
  deleteState(id: StateId, reassignToId: StateId, tx?: Tx): Promise<void>;
  /** The state a new issue lands in: triage if enabled, else the first unstarted. */
  defaultStateFor(teamId: TeamId, tx?: Tx): Promise<WorkflowState>;
}

/* ================================================================ labels = */

export interface CreateLabelInput {
  readonly id?: LabelId;
  readonly workspaceId: WorkspaceId;
  /** Null for a workspace-wide label. */
  readonly teamId?: TeamId | null;
  readonly name: string;
  readonly color: string;
  readonly description?: string | null;
  readonly parentId?: LabelId | null;
}

export interface LabelRepository {
  create(input: CreateLabelInput, tx?: Tx): Promise<Label>;
  byId(id: LabelId, tx?: Tx): Promise<Label | null>;
  /**
   * Every label usable by `teamId`: the workspace-wide ones plus that team's.
   * Omit `teamId` for the workspace-wide set alone.
   */
  listForWorkspace(
    workspaceId: WorkspaceId,
    teamId?: TeamId | null,
    tx?: Tx,
  ): Promise<Label[]>;
  update(
    id: LabelId,
    patch: Patch<Pick<Label, "name" | "color" | "description" | "parentId">>,
    tx?: Tx,
  ): Promise<Label>;
  delete(id: LabelId, tx?: Tx): Promise<void>;
}

/* ================================================================ issues = */

export interface CreateIssueInput {
  /**
   * Supply it to reconcile an optimistic row by id.
   *
   * The client renders the issue before the request leaves, so the id has to
   * exist first; without this the reconcile is by position and any concurrent
   * insert breaks it.
   */
  readonly id?: IssueId;
  readonly teamId: TeamId;
  readonly title: string;
  readonly description?: string;
  /** Defaults to the team's default state. */
  readonly stateId?: StateId;
  readonly priority?: Priority;
  readonly assigneeId?: UserId | null;
  readonly creatorId: UserId;
  readonly projectId?: ProjectId | null;
  readonly milestoneId?: MilestoneId | null;
  readonly parentId?: IssueId | null;
  readonly estimate?: number | null;
  readonly dueDate?: string | null;
  readonly labelIds?: readonly LabelId[];
  readonly subscriberIds?: readonly UserId[];
  /**
   * A client-computed order key. Omit to place the issue at the top of its
   * team's list, which is where Linear puts a new issue.
   */
  readonly sortOrder?: string;
}

/**
 * A patch. `undefined` leaves a field alone; `null` clears it.
 *
 * `sortOrder` is here because ordering is client-computed — the server does no
 * "move to index 5" arithmetic — but {@link IssueRepository.move} is the
 * better call for a drag, since it takes the neighbours rather than the answer.
 */
export interface UpdateIssueInput {
  readonly title?: string;
  readonly description?: string;
  readonly stateId?: StateId;
  readonly priority?: Priority;
  readonly assigneeId?: UserId | null;
  readonly projectId?: ProjectId | null;
  readonly milestoneId?: MilestoneId | null;
  readonly parentId?: IssueId | null;
  readonly estimate?: number | null;
  readonly dueDate?: string | null;
  readonly sortOrder?: string;
  readonly subIssueSortOrder?: string | null;
}

export interface IssueQuery {
  /** Every issue query is scoped to one workspace. */
  readonly workspaceId: WorkspaceId;
  readonly filter?: IssueFilter;
  readonly orderBy?: OrderBy;
  readonly direction?: SortDirection;
  readonly limit?: number;
  readonly offset?: number;
}

/** A relation joined to the issue on its other end, for rendering the list. */
export interface IssueRelationWithTarget extends IssueRelation {
  readonly relatedIdentifier: string;
  readonly relatedTitle: string;
  readonly relatedStateType: StateType;
}

export interface IssueRepository {
  create(
    input: CreateIssueInput,
    actorId: UserId,
    tx?: Tx,
  ): Promise<IssueWithRelations>;
  /**
   * Create several issues in one pass.
   *
   * Not a loop over {@link create}: sequential inserts each subdivide the same
   * leading gap and produce keys that grow a character per issue, so a paste of
   * 200 issues would end with 200-character keys. This distributes them in one
   * pass (`ordering.keysBetween`).
   */
  createMany(
    inputs: readonly CreateIssueInput[],
    actorId: UserId,
    tx?: Tx,
  ): Promise<IssueWithRelations[]>;

  byId(id: IssueId, tx?: Tx): Promise<IssueWithRelations | null>;
  /** By `ENG-123`, case-insensitively, within one workspace. */
  byIdentifier(
    workspaceId: WorkspaceId,
    identifier: string,
    tx?: Tx,
  ): Promise<IssueWithRelations | null>;
  list(query: IssueQuery, tx?: Tx): Promise<IssueWithRelations[]>;
  count(query: Omit<IssueQuery, "limit" | "offset">, tx?: Tx): Promise<number>;
  listSubIssues(parentId: IssueId, tx?: Tx): Promise<IssueWithRelations[]>;

  update(
    id: IssueId,
    patch: UpdateIssueInput,
    actorId: UserId,
    tx?: Tx,
  ): Promise<IssueWithRelations>;
  /** The same patch applied to many issues — the list view's bulk edit. */
  updateMany(
    ids: readonly IssueId[],
    patch: UpdateIssueInput,
    actorId: UserId,
    tx?: Tx,
  ): Promise<IssueWithRelations[]>;
  /**
   * Reposition an issue between two neighbours.
   *
   * Takes the *keys* either side of the drop, not an index: the client knows
   * what the list looks like, the server does not, and an index would have to
   * be resolved against a snapshot that may already have moved. Writes exactly
   * one row. Pass null for either side to mean the start or end of the list.
   */
  move(
    id: IssueId,
    beforeKey: string | null,
    afterKey: string | null,
    actorId: UserId,
    tx?: Tx,
  ): Promise<IssueWithRelations>;

  addLabel(issueId: IssueId, labelId: LabelId, actorId: UserId, tx?: Tx): Promise<void>;
  removeLabel(
    issueId: IssueId,
    labelId: LabelId,
    actorId: UserId,
    tx?: Tx,
  ): Promise<void>;
  /** Replace the whole label set, writing one activity row per difference. */
  setLabels(
    issueId: IssueId,
    labelIds: readonly LabelId[],
    actorId: UserId,
    tx?: Tx,
  ): Promise<void>;

  addRelation(
    issueId: IssueId,
    relatedIssueId: IssueId,
    type: IssueRelationType,
    actorId: UserId,
    tx?: Tx,
  ): Promise<IssueRelation>;
  removeRelation(
    relationId: IssueRelation["id"],
    actorId: UserId,
    tx?: Tx,
  ): Promise<void>;
  /**
   * Both directions at once.
   *
   * A row is stored once, in the direction it was created; `A blocks B` is
   * listed on B as `blocked_by A`. Storing both halves would let them drift
   * apart — `entities.ts`, `INVERSE_RELATION`.
   */
  listRelations(issueId: IssueId, tx?: Tx): Promise<IssueRelationWithTarget[]>;

  subscribe(issueId: IssueId, userId: UserId, tx?: Tx): Promise<void>;
  unsubscribe(issueId: IssueId, userId: UserId, tx?: Tx): Promise<void>;
  listSubscribers(issueId: IssueId, tx?: Tx): Promise<User[]>;

  archive(id: IssueId, actorId: UserId, tx?: Tx): Promise<IssueWithRelations>;
  unarchive(id: IssueId, actorId: UserId, tx?: Tx): Promise<IssueWithRelations>;
  /** The 30-day recovery window. Not role-gated — SPEC §4. */
  trash(id: IssueId, actorId: UserId, tx?: Tx): Promise<void>;
  restore(id: IssueId, actorId: UserId, tx?: Tx): Promise<IssueWithRelations>;
  /** Irreversible. Cascades to comments, labels, relations and activity. */
  purge(id: IssueId, actorId: UserId, tx?: Tx): Promise<void>;
}

/* ============================================================== projects = */

export interface CreateProjectInput {
  readonly id?: ProjectId;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly description?: string;
  readonly summary?: string;
  readonly icon?: string;
  readonly color?: string;
  readonly state?: ProjectState;
  readonly health?: ProjectHealth | null;
  readonly leadId?: UserId | null;
  readonly startDate?: string | null;
  readonly targetDate?: string | null;
  readonly teamIds?: readonly TeamId[];
  readonly memberIds?: readonly UserId[];
  /** Defaults to `projectSlug(name)`; supplied by the seed for stable URLs. */
  readonly slugId?: string;
  readonly sortOrder?: string;
}

export interface ProjectMemberWithUser extends ProjectMember {
  readonly user: User;
}

/** Counts a project overview shows without loading its issues. */
export interface ProjectProgress {
  readonly total: number;
  readonly completed: number;
  readonly canceled: number;
  readonly started: number;
  /** Sum of estimates over all issues; null when the teams do not estimate. */
  readonly scope: number | null;
  readonly completedScope: number | null;
}

export interface ProjectRepository {
  create(input: CreateProjectInput, actorId: UserId, tx?: Tx): Promise<Project>;
  byId(id: ProjectId, tx?: Tx): Promise<Project | null>;
  bySlug(workspaceId: WorkspaceId, slugId: string, tx?: Tx): Promise<Project | null>;
  listForWorkspace(workspaceId: WorkspaceId, tx?: Tx): Promise<Project[]>;
  /** A guest sees only the projects they were added to — SPEC §4. */
  listForUser(workspaceId: WorkspaceId, userId: UserId, tx?: Tx): Promise<Project[]>;
  update(
    id: ProjectId,
    patch: Patch<
      Pick<
        Project,
        | "name"
        | "description"
        | "summary"
        | "icon"
        | "color"
        | "state"
        | "health"
        | "leadId"
        | "startDate"
        | "targetDate"
        | "sortOrder"
      >
    >,
    actorId: UserId,
    tx?: Tx,
  ): Promise<Project>;
  archive(id: ProjectId, actorId: UserId, tx?: Tx): Promise<Project>;
  delete(id: ProjectId, actorId: UserId, tx?: Tx): Promise<void>;
  progress(id: ProjectId, tx?: Tx): Promise<ProjectProgress>;

  listMembers(id: ProjectId, tx?: Tx): Promise<ProjectMemberWithUser[]>;
  addMember(
    projectId: ProjectId,
    userId: UserId,
    role: ProjectRole,
    actorId: UserId,
    tx?: Tx,
  ): Promise<ProjectMember>;
  removeMember(
    projectId: ProjectId,
    userId: UserId,
    actorId: UserId,
    tx?: Tx,
  ): Promise<void>;

  listTeams(id: ProjectId, tx?: Tx): Promise<TeamId[]>;
  addTeam(projectId: ProjectId, teamId: TeamId, actorId: UserId, tx?: Tx): Promise<void>;
  removeTeam(
    projectId: ProjectId,
    teamId: TeamId,
    actorId: UserId,
    tx?: Tx,
  ): Promise<void>;

  listMilestones(projectId: ProjectId, tx?: Tx): Promise<ProjectMilestone[]>;
  createMilestone(
    input: {
      readonly id?: MilestoneId;
      readonly projectId: ProjectId;
      readonly name: string;
      readonly description?: string | null;
      readonly targetDate?: string | null;
      readonly sortOrder?: string;
    },
    actorId: UserId,
    tx?: Tx,
  ): Promise<ProjectMilestone>;
  updateMilestone(
    id: MilestoneId,
    patch: Patch<Pick<ProjectMilestone, "name" | "description" | "targetDate" | "sortOrder">>,
    actorId: UserId,
    tx?: Tx,
  ): Promise<ProjectMilestone>;
  deleteMilestone(id: MilestoneId, actorId: UserId, tx?: Tx): Promise<void>;

  listUpdates(projectId: ProjectId, tx?: Tx): Promise<ProjectUpdate[]>;
  /**
   * Post a status update.
   *
   * Also writes the project's `health`, because an update *is* how health
   * changes — it is the lead's weekly judgement, never derived from the issue
   * list (`research/03-data-model.md` §1.7).
   */
  postUpdate(
    input: {
      readonly id?: ProjectUpdate["id"];
      readonly projectId: ProjectId;
      readonly userId: UserId;
      readonly body: string;
      readonly health: ProjectHealth;
    },
    tx?: Tx,
  ): Promise<ProjectUpdate>;
}

/* ============================================================== comments = */

export interface CreateCommentInput {
  readonly id?: CommentId;
  readonly issueId: IssueId;
  readonly userId: UserId;
  readonly body: string;
  /** A reply. Replying to a reply attaches to the same thread root. */
  readonly parentId?: CommentId | null;
}

export interface CommentWithAuthor extends Comment {
  readonly user: User;
  readonly reactions: readonly Reaction[];
}

export interface CommentRepository {
  create(input: CreateCommentInput, tx?: Tx): Promise<CommentWithAuthor>;
  byId(id: CommentId, tx?: Tx): Promise<CommentWithAuthor | null>;
  /** Oldest first — a discussion reads top to bottom. */
  listForIssue(issueId: IssueId, tx?: Tx): Promise<CommentWithAuthor[]>;
  update(
    id: CommentId,
    body: string,
    actorId: UserId,
    tx?: Tx,
  ): Promise<CommentWithAuthor>;
  delete(id: CommentId, actorId: UserId, tx?: Tx): Promise<void>;

  addReaction(
    target: { readonly commentId?: CommentId; readonly issueId?: IssueId },
    userId: UserId,
    emoji: string,
    tx?: Tx,
  ): Promise<Reaction>;
  removeReaction(id: Reaction["id"], userId: UserId, tx?: Tx): Promise<void>;
}

/* ============================================================== activity = */

export interface RecordActivityInput {
  readonly id?: Activity["id"];
  readonly issueId: IssueId;
  readonly userId: UserId;
  readonly type: ActivityType;
  readonly payload: ActivityPayload;
  /** Defaults to now. The seed sets it to build a feed with a past in it. */
  readonly createdAt?: Timestamp;
}

export interface ActivityWithActor extends Activity {
  readonly user: User | null;
}

export interface ActivityRepository {
  record(input: RecordActivityInput, tx?: Tx): Promise<Activity>;
  /** Oldest first, matching the issue detail feed. */
  listForIssue(
    issueId: IssueId,
    options?: { readonly limit?: number },
    tx?: Tx,
  ): Promise<ActivityWithActor[]>;
}

/* ========================================================= notifications = */

export interface CreateNotificationInput {
  readonly id?: Notification["id"];
  readonly userId: UserId;
  readonly type: NotificationType;
  readonly issueId?: IssueId | null;
  readonly commentId?: CommentId | null;
  readonly projectId?: ProjectId | null;
  readonly actorId: UserId;
  readonly createdAt?: Timestamp;
}

export interface NotificationRepository {
  /**
   * Create one, unless the actor is the recipient.
   *
   * Returns null in that case rather than throwing: every call site would
   * otherwise repeat the same guard, and forgetting it once produces an inbox
   * that tells you what you just did.
   */
  create(input: CreateNotificationInput, tx?: Tx): Promise<Notification | null>;
  listForUser(
    userId: UserId,
    options?: {
      readonly unreadOnly?: boolean;
      /** Hide notifications snoozed past now. Defaults to true. */
      readonly hideSnoozed?: boolean;
      readonly limit?: number;
      readonly offset?: number;
    },
    tx?: Tx,
  ): Promise<Notification[]>;
  unreadCount(userId: UserId, tx?: Tx): Promise<number>;
  markRead(ids: readonly Notification["id"][], userId: UserId, tx?: Tx): Promise<void>;
  markUnread(ids: readonly Notification["id"][], userId: UserId, tx?: Tx): Promise<void>;
  markAllRead(userId: UserId, tx?: Tx): Promise<number>;
  snooze(
    id: Notification["id"],
    until: Timestamp | null,
    userId: UserId,
    tx?: Tx,
  ): Promise<Notification>;
  delete(id: Notification["id"], userId: UserId, tx?: Tx): Promise<void>;
}

/* ================================================================= views = */

export interface CreateSavedViewInput {
  readonly id?: ViewId;
  readonly workspaceId: WorkspaceId;
  readonly teamId?: TeamId | null;
  readonly ownerId: UserId;
  readonly name: string;
  readonly description?: string | null;
  readonly icon?: string;
  readonly color?: string;
  readonly filter: IssueFilter;
  readonly display: DisplayOptions;
  readonly shared?: boolean;
}

/** A sidebar bookmark. Polymorphic by design — `research/03-data-model.md` §6. */
export const FAVORITE_KINDS = ["issue", "project", "view", "team", "label"] as const;
export type FavoriteKind = (typeof FAVORITE_KINDS)[number];

export interface Favorite {
  readonly id: string;
  readonly userId: UserId;
  readonly kind: FavoriteKind;
  readonly targetId: string;
  readonly sortOrder: string;
  readonly createdAt: Timestamp;
}

export interface ViewRepository {
  create(input: CreateSavedViewInput, tx?: Tx): Promise<SavedView>;
  byId(id: ViewId, tx?: Tx): Promise<SavedView | null>;
  /** The user's own views plus the shared ones, alphabetically. */
  listForUser(workspaceId: WorkspaceId, userId: UserId, tx?: Tx): Promise<SavedView[]>;
  update(
    id: ViewId,
    patch: Patch<
      Pick<
        SavedView,
        "name" | "description" | "icon" | "color" | "filter" | "display" | "shared"
      >
    >,
    actorId: UserId,
    tx?: Tx,
  ): Promise<SavedView>;
  delete(id: ViewId, actorId: UserId, tx?: Tx): Promise<void>;

  listFavorites(userId: UserId, tx?: Tx): Promise<Favorite[]>;
  addFavorite(
    userId: UserId,
    kind: FavoriteKind,
    targetId: string,
    tx?: Tx,
  ): Promise<Favorite>;
  removeFavorite(
    userId: UserId,
    kind: FavoriteKind,
    targetId: string,
    tx?: Tx,
  ): Promise<void>;
}

/* ============================================================ changefeed = */

/**
 * The realtime bus.
 *
 * A serverless host has nowhere to keep a pub/sub broker and Vercel Hobby's
 * memory budget cannot afford a connection per open tab (SPEC §2), so clients
 * poll a cursor over an append-only table. One monotonic sequence per workspace
 * is all a last-write-wins client needs — and Linear's own sync is documented as
 * last-write-wins rather than CRDT, so this is the same guarantee, not a weaker
 * one.
 */
export const CHANGE_ENTITIES = [
  "workspace",
  "workspaceMember",
  "team",
  "teamMember",
  "workflowState",
  "label",
  "issue",
  "issueRelation",
  "project",
  "projectMember",
  "milestone",
  "projectUpdate",
  "comment",
  "reaction",
  "view",
  "favorite",
  "invite",
  "notification",
] as const;
export type ChangeEntity = (typeof CHANGE_ENTITIES)[number];

export const CHANGE_ACTIONS = ["create", "update", "delete"] as const;
export type ChangeAction = (typeof CHANGE_ACTIONS)[number];

export interface ChangeEvent {
  /** Monotonic within a workspace. The cursor a client holds. */
  readonly seq: number;
  readonly workspaceId: WorkspaceId;
  readonly entity: ChangeEntity;
  readonly entityId: string;
  readonly action: ChangeAction;
  readonly actorId: UserId | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: Timestamp;
}

export interface AppendChangeInput {
  readonly workspaceId: WorkspaceId;
  readonly entity: ChangeEntity;
  readonly entityId: string;
  readonly action: ChangeAction;
  readonly actorId?: UserId | null;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface ChangefeedRepository {
  append(input: AppendChangeInput, tx?: Tx): Promise<ChangeEvent>;
  /**
   * Everything after `seq`, oldest first.
   *
   * A client holding `seq = 0` gets the whole retained feed, which is the
   * correct behaviour for a first poll: it has no state to be inconsistent
   * with. `limit` caps the batch; a client that falls far behind catches up
   * over several polls rather than in one response it cannot parse.
   */
  since(
    workspaceId: WorkspaceId,
    seq: number,
    options?: { readonly limit?: number },
    tx?: Tx,
  ): Promise<ChangeEvent[]>;
  /** The cursor a client should start from when it has no state to reconcile. */
  latestSeq(workspaceId: WorkspaceId, tx?: Tx): Promise<number>;
}

/* =========================================================== composition = */

/** Every repository, as one object. Built by `adapters/repositories`. */
export interface Repositories {
  readonly workspaces: WorkspaceRepository;
  readonly teams: TeamRepository;
  readonly labels: LabelRepository;
  readonly issues: IssueRepository;
  readonly projects: ProjectRepository;
  readonly comments: CommentRepository;
  readonly activity: ActivityRepository;
  readonly notifications: NotificationRepository;
  readonly views: ViewRepository;
  readonly changefeed: ChangefeedRepository;
}
