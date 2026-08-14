import "server-only";

/**
 * The demo workspace.
 *
 * A clone that opens on an empty state is a clone nobody can evaluate. This
 * builds one that looks like a real week of work: three teams, forty issues
 * spread across every workflow state, three projects with milestones, labels,
 * threaded comments, an activity feed with a past in it, and four accounts at
 * four different permission levels so the authorization rules have something to
 * be true about.
 *
 * ## Deterministic, and why that is not a nicety
 *
 * No `Math.random()`, no `Date.now()`, no `new Date()`. Ids come from
 * {@link deterministicId}, timestamps from a base date that can be passed in,
 * and order keys from `keysBetween`. Three things depend on it:
 *
 * - **Idempotence.** Re-running has to converge on the same workspace, not a
 *   second one. The guard is a lookup on the URL key, but the ids being stable
 *   is what makes "already seeded" a fact rather than a guess.
 * - **The e2e suite.** Playwright asserts on `ENG-4` and on issue titles. A
 *   seed whose numbering depended on insertion timing would make those tests
 *   flake for reasons that have nothing to do with the app.
 * - **Bookmarks.** Rebuilding the database in development should not break the
 *   tab you left open.
 *
 * ## Why it writes SQL rather than calling the repositories
 *
 * The repositories stamp `now()` and generate ids — that is their job, and it
 * is the opposite of what a fixture needs. Every issue here has a creation date
 * in the past, an activity feed whose entries are ordered days apart, and an id
 * that has to survive a rebuild. Driving the repositories would mean injecting
 * a clock that advances differently for every row and then overwriting the ids
 * anyway. The rules the repositories enforce that *matter* to a fixture — the
 * category-transition stamps, the per-team numbering, the order keys — are
 * applied here explicitly, and `seed.test.ts` asserts them by reading the data
 * back through the repositories.
 *
 * ## The password hash is injectable, and should be injected
 *
 * All four accounts share the password `demo1234`. The default hasher below is
 * a scrypt implementation with a deterministic per-email salt, in a documented
 * format — but the only hash that matters is the one the sign-in path can
 * verify. Pass `hashPassword` from the auth adapter and this becomes its
 * problem rather than a second implementation that has to agree with it.
 */

import { createHash, scrypt as scryptCallback } from "node:crypto";

import type { SqlDatabase, SqlExecutor, SqlValue } from "@/adapters/db/driver";
import { DEFAULT_STATES } from "@/adapters/repositories/teams";
import type {
  EstimationScale,
  Priority,
  ProjectHealth,
  ProjectState,
  StateType,
  Timestamp,
} from "@/domain/entities";
import { keysBetween } from "@/domain/ordering";
import { deterministicId, slugify } from "@/lib/ids";

/* =============================================================== options = */

export interface SeedOptions {
  /**
   * The "now" the fixture is built backwards from. Every timestamp in the
   * workspace is an offset from it, so passing a fixed value makes the whole
   * data set reproducible byte for byte.
   */
  readonly now?: Timestamp;
  /** The workspace URL key, and the idempotence check. */
  readonly urlKey?: string;
  readonly password?: string;
  /**
   * The auth slice's hasher. Strongly recommended: the default below produces
   * a hash in *this* module's format, and a sign-in path that cannot parse it
   * leaves four demo accounts nobody can log into.
   */
  readonly hashPassword?: (plain: string, email: string) => Promise<string>;
}

export interface SeedResult {
  readonly workspaceId: string;
  readonly urlKey: string;
  /** False when the workspace already existed and nothing was written. */
  readonly created: boolean;
  readonly users: Readonly<Record<SeedUserKey, string>>;
  readonly teams: Readonly<Record<SeedTeamKey, string>>;
  readonly projects: Readonly<Record<SeedProjectKey, string>>;
  readonly issueCount: number;
}

const DEFAULT_NOW = "2026-03-16T09:00:00.000Z";
const DEFAULT_URL_KEY = "demo";
export const DEMO_PASSWORD = "demo1234";

/* ================================================================ people = */

type SeedUserKey = "owner" | "admin" | "member" | "guest";

const USERS: readonly {
  key: SeedUserKey;
  email: string;
  name: string;
  displayName: string;
  avatarColor: string;
  role: "owner" | "admin" | "member" | "guest";
}[] = [
  {
    key: "owner",
    email: "owner@demo.test",
    name: "Dana Ortega",
    displayName: "dana",
    avatarColor: "#5e6ad2",
    role: "owner",
  },
  {
    key: "admin",
    email: "admin@demo.test",
    name: "Aziz Rahman",
    displayName: "aziz",
    avatarColor: "#26b5ce",
    role: "admin",
  },
  {
    key: "member",
    email: "member@demo.test",
    name: "Mira Castellanos",
    displayName: "mira",
    avatarColor: "#eb5757",
    role: "member",
  },
  {
    key: "guest",
    email: "guest@demo.test",
    name: "Gil Petrov",
    displayName: "gil",
    avatarColor: "#f2994a",
    role: "guest",
  },
];

/* ================================================================= teams = */

type SeedTeamKey = "eng" | "des" | "ops";

const TEAMS: readonly {
  key: SeedTeamKey;
  name: string;
  identifier: string;
  icon: string;
  color: string;
  private: boolean;
  triageEnabled: boolean;
  estimationScale: EstimationScale;
  /**
   * Membership. The guest appears in exactly one team, and `des` is private —
   * together they are what the permission journey asserts against: the guest
   * cannot see `des`, and neither can a plain member who is not in it.
   */
  members: readonly { user: SeedUserKey; role: "admin" | "member" }[];
}[] = [
  {
    key: "eng",
    name: "Engineering",
    identifier: "ENG",
    icon: "Cpu",
    color: "#5e6ad2",
    private: false,
    triageEnabled: true,
    estimationScale: "fibonacci",
    members: [
      { user: "owner", role: "admin" },
      { user: "admin", role: "member" },
      { user: "member", role: "member" },
      { user: "guest", role: "member" },
    ],
  },
  {
    key: "des",
    name: "Design",
    identifier: "DES",
    icon: "Brush",
    color: "#eb5757",
    private: true,
    triageEnabled: false,
    estimationScale: "tShirt",
    members: [
      { user: "owner", role: "admin" },
      { user: "admin", role: "admin" },
    ],
  },
  {
    key: "ops",
    name: "Operations",
    identifier: "OPS",
    icon: "Server",
    color: "#26b5ce",
    private: false,
    triageEnabled: false,
    estimationScale: "linear",
    members: [
      { user: "owner", role: "admin" },
      { user: "member", role: "admin" },
    ],
  },
];

/* ================================================================ labels = */

const LABELS: readonly {
  name: string;
  color: string;
  team: SeedTeamKey | null;
}[] = [
  { name: "Bug", color: "#eb5757", team: null },
  { name: "Feature", color: "#5e6ad2", team: null },
  { name: "Improvement", color: "#26b5ce", team: null },
  { name: "Documentation", color: "#f2c94c", team: null },
  { name: "Chore", color: "#95a2b3", team: null },
  { name: "Security", color: "#f2994a", team: null },
  { name: "Backend", color: "#4ea7fc", team: "eng" },
  { name: "Frontend", color: "#bb87fc", team: "eng" },
  { name: "Research", color: "#f7c8c1", team: "des" },
  { name: "Runbook", color: "#95a2b3", team: "ops" },
];

/* ============================================================== projects = */

type SeedProjectKey = "sync" | "system" | "onboarding" | "redesign";

const PROJECTS: readonly {
  key: SeedProjectKey;
  name: string;
  description: string;
  summary: string;
  icon: string;
  color: string;
  state: ProjectState;
  health: ProjectHealth | null;
  lead: SeedUserKey;
  members: readonly SeedUserKey[];
  teams: readonly SeedTeamKey[];
  startInDays: number;
  targetInDays: number;
  milestones: readonly { name: string; targetInDays: number }[];
  updates: readonly { by: SeedUserKey; health: ProjectHealth; body: string; daysAgo: number }[];
}[] = [
  {
    key: "sync",
    name: "Realtime Sync",
    description:
      "Replace the 15-second poll with a cursor the client can hold across " +
      "reconnects, without adding a persistent connection per open tab.",
    summary: "Cursor-based sync over the change feed.",
    icon: "Bolt",
    color: "#5e6ad2",
    state: "started",
    health: "onTrack",
    lead: "owner",
    members: ["owner", "member"],
    teams: ["eng"],
    startInDays: -28,
    targetInDays: 24,
    milestones: [
      { name: "Cursor protocol", targetInDays: -4 },
      { name: "Client reconciliation", targetInDays: 12 },
      { name: "Rollout", targetInDays: 24 },
    ],
    updates: [
      {
        by: "owner",
        health: "onTrack",
        body:
          "Cursor protocol landed and has been running against the demo " +
          "workspace for a week with no drift. Reconciliation is next.",
        daysAgo: 6,
      },
    ],
  },
  {
    key: "system",
    name: "Design System 2.0",
    description:
      "One token set for both themes, with the component library re-pointed " +
      "at it so a theme change is a single block of custom properties.",
    summary: "Tokens first, components second.",
    icon: "Palette",
    color: "#eb5757",
    state: "started",
    health: "atRisk",
    lead: "admin",
    members: ["admin", "owner"],
    teams: ["des", "eng"],
    startInDays: -42,
    targetInDays: 10,
    milestones: [
      { name: "Token audit", targetInDays: -12 },
      { name: "Component parity", targetInDays: 10 },
    ],
    updates: [
      {
        by: "admin",
        health: "atRisk",
        body:
          "Parity work is behind: the audit turned up 40 hard-coded greys " +
          "outside the component library. Target date is at risk, scope is not.",
        daysAgo: 3,
      },
    ],
  },
  {
    key: "onboarding",
    name: "Onboarding Revamp",
    description:
      "Get a new workspace from sign-up to a first issue without a support " +
      "conversation.",
    summary: "Sign-up to first issue, unattended.",
    icon: "Rocket",
    color: "#26b5ce",
    state: "planned",
    health: null,
    lead: "member",
    members: ["member", "guest"],
    teams: ["ops", "eng"],
    startInDays: 5,
    targetInDays: 60,
    milestones: [
      { name: "Research", targetInDays: 18 },
      { name: "Copy pass", targetInDays: 34 },
      { name: "Launch", targetInDays: 60 },
    ],
    updates: [],
  },
  {
    /**
     * The fixture the permission journey turns on.
     *
     * Every other project here touches `eng`, and the guest is in `eng` — so
     * the guest can reach all of them through team membership, and there is
     * nothing to demonstrate. This one lives entirely inside `des`, which is
     * private and which the guest is not in, so it is the only project in the
     * workspace they genuinely cannot see.
     *
     * That makes it the test for the brief's headline requirement and this
     * clone's one deliberate divergence from Linear (DECISIONS D8): adding the
     * guest as a *project* member must grant them access to a project whose
     * team they will never be in, and removing them must take it away again.
     * The guest is deliberately absent from `members` — the journey adds them.
     */
    key: "redesign",
    name: "Website Redesign",
    description:
      "Rebuild the marketing site against the new token set, so a theme " +
      "change is one block of custom properties rather than a sweep.",
    summary: "Marketing site on the new tokens.",
    icon: "Layout",
    color: "#bb87fc",
    state: "planned",
    health: "onTrack",
    lead: "admin",
    members: ["admin", "owner"],
    teams: ["des"],
    startInDays: -7,
    targetInDays: 45,
    milestones: [
      { name: "Page inventory", targetInDays: 6 },
      { name: "Template pass", targetInDays: 28 },
    ],
    updates: [],
  },
];

/* ================================================================ issues = */

interface SeedIssue {
  readonly team: SeedTeamKey;
  readonly title: string;
  /** A state *name* from the team's workflow. */
  readonly state: string;
  readonly priority: Priority;
  readonly assignee: SeedUserKey | null;
  readonly labels: readonly string[];
  readonly estimate?: number;
  readonly project?: SeedProjectKey;
  readonly milestone?: string;
  readonly dueInDays?: number;
  readonly description?: string;
  /** How long ago the issue was filed. Drives every stamp on the row. */
  readonly daysAgo: number;
}

/**
 * Forty issues that read like a real backlog.
 *
 * Spread deliberately rather than evenly: Engineering carries the bulk and every
 * state including Triage and Duplicate, Design has the in-flight work, and
 * Operations has the long tail. Several are unassigned and several have no
 * project, because both are the states that break a naive list query.
 */
const ISSUES: readonly SeedIssue[] = [
  // ---- Engineering -------------------------------------------------------
  {
    team: "eng",
    title: "Issue list drops manual order after a bulk status change",
    state: "In Progress",
    priority: 1,
    assignee: "owner",
    labels: ["Bug", "Frontend"],
    estimate: 3,
    project: "sync",
    milestone: "Client reconciliation",
    daysAgo: 9,
    description:
      "Selecting eight issues and moving them to Done re-sorts the whole list " +
      "on the next poll. The optimistic store keeps the old order key while the " +
      "server writes a new one.",
  },
  {
    team: "eng",
    title: "Cursor poll returns duplicate events across a reconnect",
    state: "In Review",
    priority: 1,
    assignee: "member",
    labels: ["Bug", "Backend"],
    estimate: 5,
    project: "sync",
    milestone: "Cursor protocol",
    daysAgo: 14,
  },
  {
    team: "eng",
    title: "Command palette does not scope to the selected issues",
    state: "Todo",
    priority: 2,
    assignee: "admin",
    labels: ["Feature", "Frontend"],
    estimate: 3,
    daysAgo: 5,
  },
  {
    team: "eng",
    title: "Add keyboard shortcut map to the help sheet",
    state: "Backlog",
    priority: 4,
    assignee: null,
    labels: ["Documentation"],
    estimate: 1,
    daysAgo: 21,
  },
  {
    team: "eng",
    title: "Sub-issue progress donut counts canceled children as complete",
    state: "Done",
    priority: 2,
    assignee: "owner",
    labels: ["Bug"],
    estimate: 2,
    daysAgo: 26,
  },
  {
    team: "eng",
    title: "Persist the last used view per team",
    state: "Todo",
    priority: 3,
    assignee: "member",
    labels: ["Improvement", "Frontend"],
    estimate: 2,
    daysAgo: 7,
  },
  {
    team: "eng",
    title: "Rate-limit the AI summary endpoint per workspace",
    state: "Backlog",
    priority: 2,
    assignee: null,
    labels: ["Security", "Backend"],
    estimate: 3,
    daysAgo: 18,
  },
  {
    team: "eng",
    title: "Session cookie is not cleared on sign-out from a second tab",
    state: "In Progress",
    priority: 1,
    assignee: "admin",
    labels: ["Bug", "Security"],
    estimate: 2,
    dueInDays: 3,
    daysAgo: 4,
  },
  {
    team: "eng",
    title: "Board columns should keep their scroll position across a poll",
    state: "Todo",
    priority: 3,
    assignee: null,
    labels: ["Improvement", "Frontend"],
    estimate: 1,
    daysAgo: 11,
  },
  {
    team: "eng",
    title: "Move issue between teams renumbers but keeps the old identifier",
    state: "Backlog",
    priority: 2,
    assignee: "owner",
    labels: ["Bug", "Backend"],
    estimate: 5,
    daysAgo: 30,
  },
  {
    team: "eng",
    title: "Reconcile optimistic issue creation by id, not by position",
    state: "Done",
    priority: 1,
    assignee: "member",
    labels: ["Improvement", "Frontend"],
    estimate: 3,
    project: "sync",
    milestone: "Cursor protocol",
    daysAgo: 34,
  },
  {
    team: "eng",
    title: "Filter bar loses the unassigned chip on reload",
    state: "In Review",
    priority: 3,
    assignee: "admin",
    labels: ["Bug", "Frontend"],
    estimate: 1,
    daysAgo: 6,
  },
  {
    team: "eng",
    title: "Add an index on issues(updated_at) for the recently-updated view",
    state: "Done",
    priority: 3,
    assignee: "owner",
    labels: ["Chore", "Backend"],
    estimate: 1,
    daysAgo: 40,
  },
  {
    team: "eng",
    title: "Guest can see team names in the project picker",
    state: "In Progress",
    priority: 1,
    assignee: "owner",
    labels: ["Security", "Bug"],
    estimate: 2,
    dueInDays: 1,
    daysAgo: 3,
    description:
      "The picker lists every team in the workspace rather than the ones the " +
      "viewer belongs to. Discoverability is a permission, not a display option.",
  },
  {
    team: "eng",
    title: "Support markdown tables in issue descriptions",
    state: "Backlog",
    priority: 4,
    assignee: null,
    labels: ["Feature"],
    estimate: 3,
    daysAgo: 45,
  },
  {
    team: "eng",
    title: "Order keys grow unbounded when dragging into the same gap",
    state: "Canceled",
    priority: 4,
    assignee: "member",
    labels: ["Chore", "Backend"],
    estimate: 2,
    daysAgo: 38,
    description:
      "Closed: the fractional index has no precision cliff, so long keys are " +
      "a storage nicety rather than a correctness problem.",
  },
  {
    team: "eng",
    title: "Duplicate: board drag writes two rows",
    state: "Duplicate",
    priority: 3,
    assignee: null,
    labels: ["Bug"],
    daysAgo: 24,
  },
  {
    team: "eng",
    title: "Crash on an issue whose assignee was deactivated",
    state: "Triage",
    priority: 1,
    assignee: null,
    labels: ["Bug"],
    daysAgo: 1,
  },
  {
    team: "eng",
    title: "Slow first paint on the My Issues screen",
    state: "Triage",
    priority: 3,
    assignee: null,
    labels: [],
    daysAgo: 2,
  },
  {
    team: "eng",
    title: "Batch the change-feed poll across open tabs",
    state: "Todo",
    priority: 2,
    assignee: "member",
    labels: ["Improvement", "Frontend"],
    estimate: 5,
    project: "sync",
    milestone: "Rollout",
    daysAgo: 8,
  },
  {
    team: "eng",
    title: "Write the sync protocol into the architecture notes",
    state: "Backlog",
    priority: 4,
    assignee: "owner",
    labels: ["Documentation"],
    estimate: 1,
    project: "sync",
    milestone: "Rollout",
    daysAgo: 12,
  },
  {
    team: "eng",
    title: "Escape ladder closes the modal and the palette together",
    state: "Done",
    priority: 2,
    assignee: "admin",
    labels: ["Bug", "Frontend"],
    estimate: 2,
    daysAgo: 29,
  },

  // ---- Design ------------------------------------------------------------
  {
    team: "des",
    title: "Audit every hard-coded grey outside the component library",
    state: "In Progress",
    priority: 1,
    assignee: "admin",
    labels: ["Research"],
    estimate: 3,
    project: "system",
    milestone: "Token audit",
    daysAgo: 16,
    description:
      "Forty so far. Every neutral in the app should be lch(L 0.4–1.5 272); " +
      "true neutrals are the most obvious tell in a clone.",
  },
  {
    team: "des",
    title: "Status icons should be drawn, not imported",
    state: "Done",
    priority: 2,
    assignee: "admin",
    labels: ["Improvement"],
    estimate: 2,
    project: "system",
    milestone: "Token audit",
    daysAgo: 33,
  },
  {
    team: "des",
    title: "In-progress glyph needs a pie wedge proportional to the state",
    state: "In Review",
    priority: 2,
    assignee: "owner",
    labels: ["Feature"],
    estimate: 2,
    project: "system",
    milestone: "Component parity",
    daysAgo: 10,
  },
  {
    team: "des",
    title: "Row hover contrast is too slight at 100% zoom",
    state: "Todo",
    priority: 3,
    assignee: null,
    labels: ["Improvement"],
    estimate: 1,
    daysAgo: 13,
  },
  {
    team: "des",
    title: "Enable cv11 so l, I and 1 are distinguishable in identifiers",
    state: "Done",
    priority: 2,
    assignee: "admin",
    labels: ["Improvement"],
    estimate: 1,
    daysAgo: 36,
  },
  {
    team: "des",
    title: "Light theme borders read as grey rather than violet",
    state: "Todo",
    priority: 3,
    assignee: "admin",
    labels: ["Bug"],
    estimate: 2,
    project: "system",
    milestone: "Component parity",
    daysAgo: 9,
  },
  {
    team: "des",
    title: "Define the four background steps as tokens",
    state: "Backlog",
    priority: 3,
    assignee: null,
    labels: ["Research"],
    estimate: 2,
    daysAgo: 20,
  },
  {
    team: "des",
    title: "Priority bars need an urgent variant that is not just red",
    state: "Backlog",
    priority: 4,
    assignee: null,
    labels: ["Feature"],
    estimate: 1,
    daysAgo: 27,
  },
  {
    team: "des",
    title: "Empty states are inconsistent between list and board",
    state: "Canceled",
    priority: 4,
    assignee: "owner",
    labels: [],
    daysAgo: 31,
  },
  {
    team: "des",
    title: "Motion curve is applied to layout, not just to colour",
    state: "In Progress",
    priority: 2,
    assignee: "admin",
    labels: ["Improvement"],
    estimate: 2,
    project: "system",
    milestone: "Component parity",
    daysAgo: 11,
  },

  // ---- Operations --------------------------------------------------------
  {
    team: "ops",
    title: "Document the database push step in the deploy runbook",
    state: "Done",
    priority: 2,
    assignee: "member",
    labels: ["Runbook", "Documentation"],
    estimate: 2,
    daysAgo: 22,
  },
  {
    team: "ops",
    title: "Add a smoke check that the schema applied before traffic shifts",
    state: "In Progress",
    priority: 1,
    assignee: "member",
    labels: ["Runbook"],
    estimate: 3,
    dueInDays: 6,
    daysAgo: 5,
  },
  {
    team: "ops",
    title: "Sign-up flow needs a workspace name suggestion",
    state: "Todo",
    priority: 3,
    assignee: "guest",
    labels: ["Feature"],
    estimate: 2,
    project: "onboarding",
    milestone: "Copy pass",
    daysAgo: 7,
  },
  {
    team: "ops",
    title: "Invite links should say which teams they grant",
    state: "Todo",
    priority: 2,
    assignee: "guest",
    labels: ["Improvement"],
    estimate: 1,
    project: "onboarding",
    milestone: "Copy pass",
    daysAgo: 6,
  },
  {
    team: "ops",
    title: "Interview five new workspaces about their first hour",
    state: "Backlog",
    priority: 3,
    assignee: "member",
    labels: [],
    estimate: 3,
    project: "onboarding",
    milestone: "Research",
    daysAgo: 15,
  },
  {
    team: "ops",
    title: "Rotate the demo workspace weekly",
    state: "Backlog",
    priority: 4,
    assignee: null,
    labels: ["Chore", "Runbook"],
    estimate: 1,
    daysAgo: 19,
  },
  {
    team: "ops",
    title: "Alert when the change-events table passes a million rows",
    state: "Backlog",
    priority: 3,
    assignee: null,
    labels: ["Runbook"],
    estimate: 2,
    daysAgo: 23,
  },
  {
    team: "ops",
    title: "Retire the staging workspace nobody has opened since January",
    state: "Done",
    priority: 4,
    assignee: "member",
    labels: ["Chore"],
    estimate: 1,
    daysAgo: 35,
  },
];

/* ============================================================== comments = */

const COMMENTS: readonly {
  /** Index into {@link ISSUES}. */
  issue: number;
  by: SeedUserKey;
  body: string;
  daysAgo: number;
  /** Index into this array — a reply attaches to that comment's thread. */
  replyTo?: number;
}[] = [
  {
    issue: 0,
    by: "member",
    body:
      "Reproduced. The store keeps the pre-move key, so the next poll sorts " +
      "the row back where it was.",
    daysAgo: 8,
  },
  {
    issue: 0,
    by: "owner",
    body: "Right — the bulk path needs to reconcile keys, not just ids.",
    daysAgo: 7,
    replyTo: 0,
  },
  {
    issue: 1,
    by: "owner",
    body:
      "The cursor is inclusive on reconnect. Making it exclusive fixes the " +
      "duplicate without losing an event.",
    daysAgo: 12,
  },
  {
    issue: 7,
    by: "owner",
    body: "Holding this for the security pass; it is one line but it is a session bug.",
    daysAgo: 3,
  },
  {
    issue: 13,
    by: "admin",
    body:
      "This is the one I would fix first. A guest seeing a team name is a leak " +
      "even if they cannot open it.",
    daysAgo: 2,
  },
  {
    issue: 22,
    by: "owner",
    body: "Forty is more than I expected. Worth splitting the audit per surface.",
    daysAgo: 14,
  },
  {
    issue: 22,
    by: "admin",
    body: "Agreed — I will file one per surface under the same milestone.",
    daysAgo: 13,
    replyTo: 5,
  },
  {
    issue: 33,
    by: "member",
    body: "Copy draft is in the project description; happy to take the review.",
    daysAgo: 4,
  },
];

/* ========================================================= notifications = */

const NOTIFICATIONS: readonly {
  to: SeedUserKey;
  from: SeedUserKey;
  type: string;
  issue: number;
  daysAgo: number;
  read: boolean;
}[] = [
  { to: "member", from: "owner", type: "issue_assigned", issue: 1, daysAgo: 14, read: false },
  { to: "member", from: "owner", type: "issue_commented", issue: 0, daysAgo: 7, read: false },
  { to: "admin", from: "owner", type: "issue_status_changed", issue: 11, daysAgo: 5, read: true },
  { to: "guest", from: "member", type: "issue_assigned", issue: 33, daysAgo: 6, read: false },
  { to: "owner", from: "admin", type: "comment_replied", issue: 22, daysAgo: 13, read: false },
];

/* ================================================================= seed == */

/**
 * Build (or recognise) the demo workspace.
 *
 * The whole thing runs in one transaction: a half-seeded workspace — teams with
 * no states, issues with no labels — is worse than none, because it looks
 * usable until the first click.
 */
export async function seedDemoWorkspace(
  db: SqlDatabase,
  options: SeedOptions = {},
): Promise<SeedResult> {
  const urlKey = options.urlKey ?? DEFAULT_URL_KEY;
  const base = Date.parse(options.now ?? DEFAULT_NOW);
  const hash =
    options.hashPassword ?? ((plain: string, email: string) => scryptHash(plain, email));
  const password = options.password ?? DEMO_PASSWORD;

  const ids = buildIds(urlKey);
  const result: Omit<SeedResult, "created"> = {
    workspaceId: ids.workspace,
    urlKey,
    users: ids.users,
    teams: ids.teams,
    projects: ids.projects,
    issueCount: ISSUES.length,
  };

  return db.transaction(async (t) => {
    const existing = await t.query(
      `select id from workspaces where lower(url_key) = lower($1)`,
      [urlKey],
    );
    if (existing.length > 0) return { ...result, created: false };

    const at = (daysAgo: number): Timestamp =>
      new Date(base - daysAgo * 86_400_000).toISOString();
    const date = (inDays: number): string =>
      new Date(base + inDays * 86_400_000).toISOString().slice(0, 10);

    /* -- people ---------------------------------------------------------- */

    const hashes = await Promise.all(
      USERS.map((user) => hash(password, user.email)),
    );
    for (const [index, user] of USERS.entries()) {
      await t.execute(
        `insert into users (id, email, password_hash, name, display_name,
                            avatar_url, avatar_color, active, created_at, updated_at)
         values ($1,$2,$3,$4,$5,null,$6,true,$7,$7)`,
        [
          ids.users[user.key],
          user.email,
          hashes[index] ?? "",
          user.name,
          user.displayName,
          user.avatarColor,
          at(90),
        ],
      );
    }

    await t.execute(
      `insert into workspaces (id, name, url_key, created_at, updated_at)
       values ($1,$2,$3,$4,$4)`,
      [ids.workspace, "Demo Workspace", urlKey, at(90)],
    );
    for (const user of USERS) {
      await t.execute(
        `insert into workspace_members (workspace_id, user_id, role, joined_at)
         values ($1,$2,$3,$4)`,
        [ids.workspace, ids.users[user.key], user.role, at(90)],
      );
    }

    /* -- teams and their states ------------------------------------------ */

    const stateIds = new Map<string, string>();
    const stateTypes = new Map<string, StateType>();

    for (const team of TEAMS) {
      await t.execute(
        `insert into teams (id, workspace_id, name, key, description, icon, color,
                            private, triage_enabled, estimation_scale,
                            issue_counter, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,$11)`,
        [
          ids.teams[team.key],
          ids.workspace,
          team.name,
          team.identifier,
          null,
          team.icon,
          team.color,
          team.private,
          team.triageEnabled,
          team.estimationScale,
          at(89),
        ],
      );
      const states = DEFAULT_STATES.filter(
        (state) => state.type !== "triage" || team.triageEnabled,
      );
      for (const [position, state] of states.entries()) {
        const stateId = deterministicId("sta", `${urlKey}:${team.key}:${state.name}`);
        stateIds.set(`${team.key}:${state.name}`, stateId);
        stateTypes.set(`${team.key}:${state.name}`, state.type);
        await t.execute(
          `insert into workflow_states (id, team_id, name, type, color, position, created_at)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [
            stateId,
            ids.teams[team.key],
            state.name,
            state.type,
            state.color,
            position,
            at(89),
          ],
        );
      }
      for (const membership of team.members) {
        await t.execute(
          `insert into team_members (team_id, user_id, role, joined_at)
           values ($1,$2,$3,$4)`,
          [ids.teams[team.key], ids.users[membership.user], membership.role, at(88)],
        );
      }
    }

    /* -- labels ----------------------------------------------------------- */

    const labelIds = new Map<string, string>();
    for (const label of LABELS) {
      const id = deterministicId("lbl", `${urlKey}:${label.team ?? "all"}:${label.name}`);
      labelIds.set(label.name, id);
      await t.execute(
        `insert into labels (id, workspace_id, team_id, name, color, description,
                             parent_id, created_at)
         values ($1,$2,$3,$4,$5,null,null,$6)`,
        [
          id,
          ids.workspace,
          label.team === null ? null : ids.teams[label.team],
          label.name,
          label.color,
          at(87),
        ],
      );
    }

    /* -- projects --------------------------------------------------------- */

    const projectKeys = keysBetween(null, null, PROJECTS.length);
    const milestoneIds = new Map<string, string>();

    for (const [index, project] of PROJECTS.entries()) {
      const projectId = ids.projects[project.key];
      await t.execute(
        `insert into projects (id, workspace_id, name, slug_id, description, summary,
                               icon, color, state, health, lead_id, start_date,
                               target_date, sort_order, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)`,
        [
          projectId,
          ids.workspace,
          project.name,
          /**
           * A clean slug, deliberately without the usual suffix.
           *
           * `projectSlug()` appends a random token because two people can name
           * two projects the same thing and the URL has to stay unique — the
           * same reason Linear carries a `slugId`. A curated fixture has no
           * such problem: these four names are chosen and cannot collide.
           *
           * So the demo gets `/demo/project/website-redesign` rather than
           * `/demo/project/website-redesign-pnhjzc4m1uvt`, which reads better
           * in a demo and means the permission journey can navigate to a
           * project by name instead of computing a token from seed internals.
           * User-created projects still go through `projectSlug()`.
           */
          slugify(project.name, "project"),
          project.description,
          project.summary,
          project.icon,
          project.color,
          project.state,
          project.health,
          ids.users[project.lead],
          date(project.startInDays),
          date(project.targetInDays),
          projectKeys[index] ?? "a0",
          at(60),
        ],
      );
      for (const teamKey of project.teams) {
        await t.execute(
          `insert into project_teams (project_id, team_id) values ($1,$2)`,
          [projectId, ids.teams[teamKey]],
        );
      }
      for (const userKey of project.members) {
        await t.execute(
          `insert into project_members (project_id, user_id, role, joined_at)
           values ($1,$2,$3,$4)`,
          [
            projectId,
            ids.users[userKey],
            userKey === project.lead ? "lead" : "member",
            at(59),
          ],
        );
      }
      const milestoneKeys = keysBetween(null, null, project.milestones.length);
      for (const [order, milestone] of project.milestones.entries()) {
        const milestoneId = deterministicId(
          "mil",
          `${urlKey}:${project.key}:${milestone.name}`,
        );
        milestoneIds.set(`${project.key}:${milestone.name}`, milestoneId);
        await t.execute(
          `insert into project_milestones (id, project_id, name, description,
                                           target_date, sort_order, created_at)
           values ($1,$2,$3,null,$4,$5,$6)`,
          [
            milestoneId,
            projectId,
            milestone.name,
            date(milestone.targetInDays),
            milestoneKeys[order] ?? "a0",
            at(58),
          ],
        );
      }
      for (const [order, update] of project.updates.entries()) {
        await t.execute(
          `insert into project_updates (id, project_id, user_id, body, health, created_at)
           values ($1,$2,$3,$4,$5,$6)`,
          [
            deterministicId("upd", `${urlKey}:${project.key}:${order}`),
            projectId,
            ids.users[update.by],
            update.body,
            update.health,
            at(update.daysAgo),
          ],
        );
      }
    }

    /* -- issues ----------------------------------------------------------- */

    // Order keys per team, in one pass. The first issue of each team sits at
    // the top of its list, which is where a newly created issue lands.
    const perTeam = new Map<SeedTeamKey, number[]>();
    for (const [index, issue] of ISSUES.entries()) {
      const bucket = perTeam.get(issue.team);
      if (bucket) bucket.push(index);
      else perTeam.set(issue.team, [index]);
    }
    const sortOrders = new Map<number, string>();
    const numbers = new Map<number, number>();
    for (const [teamKey, indices] of perTeam) {
      const keys = keysBetween(null, null, indices.length);
      for (const [position, issueIndex] of indices.entries()) {
        sortOrders.set(issueIndex, keys[position] ?? "a0");
        numbers.set(issueIndex, position + 1);
      }
      await t.execute(`update teams set issue_counter = $2 where id = $1`, [
        ids.teams[teamKey],
        indices.length,
      ]);
    }

    const issueIds: string[] = [];

    for (const [index, issue] of ISSUES.entries()) {
      const issueId = deterministicId("iss", `${urlKey}:${issue.team}:${index}`);
      issueIds.push(issueId);

      const stateKey = `${issue.team}:${issue.state}`;
      const stateId = stateIds.get(stateKey);
      const stateType = stateTypes.get(stateKey);
      if (stateId === undefined || stateType === undefined) {
        throw new Error(`Seed issue ${index} names an unknown state "${issue.state}"`);
      }

      const createdAt = at(issue.daysAgo);
      // The category-transition rule, applied to a fixture: an issue in a
      // started state has been started, one in a completed state has also been
      // started and then completed, and one that was canceled was never
      // started. Deriving them any other way produces a demo workspace whose
      // cycle-time numbers are nonsense.
      const startedAt =
        stateType === "started" || stateType === "completed"
          ? at(issue.daysAgo - 1)
          : null;
      const completedAt = stateType === "completed" ? at(issue.daysAgo - 2) : null;
      const canceledAt = stateType === "canceled" ? at(issue.daysAgo - 2) : null;

      await t.execute(
        `insert into issues (id, team_id, number, title, description, state_id,
                             priority, assignee_id, creator_id, project_id,
                             milestone_id, parent_id, estimate, due_date,
                             sort_order, sub_issue_sort_order,
                             created_at, updated_at, started_at, completed_at,
                             canceled_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,null,$12,$13,$14,null,
                 $15,$16,$17,$18,$19)`,
        [
          issueId,
          ids.teams[issue.team],
          numbers.get(index) ?? index + 1,
          issue.title,
          issue.description ?? "",
          stateId,
          issue.priority,
          issue.assignee === null ? null : ids.users[issue.assignee],
          ids.users[index % 2 === 0 ? "owner" : "admin"],
          issue.project === undefined ? null : ids.projects[issue.project],
          issue.milestone === undefined || issue.project === undefined
            ? null
            : (milestoneIds.get(`${issue.project}:${issue.milestone}`) ?? null),
          issue.estimate ?? null,
          issue.dueInDays === undefined ? null : date(issue.dueInDays),
          sortOrders.get(index) ?? "a0",
          createdAt,
          completedAt ?? canceledAt ?? startedAt ?? createdAt,
          startedAt,
          completedAt,
          canceledAt,
        ],
      );

      for (const labelName of issue.labels) {
        const labelId = labelIds.get(labelName);
        if (labelId === undefined) {
          throw new Error(`Seed issue ${index} names an unknown label "${labelName}"`);
        }
        await t.execute(
          `insert into issue_labels (issue_id, label_id) values ($1,$2)`,
          [issueId, labelId],
        );
      }

      const subscribers = new Set<string>([
        ids.users[index % 2 === 0 ? "owner" : "admin"],
        ...(issue.assignee === null ? [] : [ids.users[issue.assignee]]),
      ]);
      for (const userId of subscribers) {
        await t.execute(
          `insert into issue_subscribers (issue_id, user_id, subscribed_at)
           values ($1,$2,$3) on conflict do nothing`,
          [issueId, userId, createdAt],
        );
      }

      /* -- the feed ----------------------------------------------------- */

      const creatorId = ids.users[index % 2 === 0 ? "owner" : "admin"];
      await writeActivity(t, {
        id: deterministicId("act", `${urlKey}:${index}:created`),
        issueId,
        userId: creatorId,
        type: "issue_created",
        payload: {
          fromId: null,
          fromLabel: null,
          toId: issueId,
          toLabel: `${teamIdentifier(issue.team)}-${numbers.get(index) ?? index + 1}`,
          title: issue.title,
        },
        createdAt,
      });

      if (issue.assignee !== null) {
        await writeActivity(t, {
          id: deterministicId("act", `${urlKey}:${index}:assigned`),
          issueId,
          userId: creatorId,
          type: "assignee_changed",
          payload: {
            fromId: null,
            fromLabel: null,
            toId: ids.users[issue.assignee],
            toLabel: userName(issue.assignee),
          },
          createdAt: at(issue.daysAgo - 0.5),
        });
      }

      if (issue.state !== "Backlog" && issue.state !== "Triage") {
        const backlogKey = `${issue.team}:Backlog`;
        await writeActivity(t, {
          id: deterministicId("act", `${urlKey}:${index}:state`),
          issueId,
          userId: issue.assignee === null ? creatorId : ids.users[issue.assignee],
          type: "state_changed",
          payload: {
            fromId: stateIds.get(backlogKey) ?? null,
            fromLabel: "Backlog",
            toId: stateId,
            toLabel: issue.state,
            fromType: "backlog",
            toType: stateType,
          },
          createdAt: at(Math.max(0, issue.daysAgo - 1)),
        });
      }
    }

    /* -- comments --------------------------------------------------------- */

    const commentIds: string[] = [];
    for (const [index, comment] of COMMENTS.entries()) {
      const id = deterministicId("cmt", `${urlKey}:${index}`);
      commentIds.push(id);
      const issueId = issueIds[comment.issue];
      if (issueId === undefined) {
        throw new Error(`Seed comment ${index} names issue ${comment.issue}`);
      }
      const parentId =
        comment.replyTo === undefined ? null : (commentIds[comment.replyTo] ?? null);
      await t.execute(
        `insert into comments (id, issue_id, user_id, body, parent_id,
                               created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$6)`,
        [id, issueId, ids.users[comment.by], comment.body, parentId, at(comment.daysAgo)],
      );
      await t.execute(
        `insert into issue_subscribers (issue_id, user_id, subscribed_at)
         values ($1,$2,$3) on conflict do nothing`,
        [issueId, ids.users[comment.by], at(comment.daysAgo)],
      );
    }

    /* -- notifications ----------------------------------------------------- */

    for (const [index, notification] of NOTIFICATIONS.entries()) {
      const issueId = issueIds[notification.issue];
      if (issueId === undefined) continue;
      await t.execute(
        `insert into notifications (id, user_id, type, issue_id, actor_id,
                                    read_at, created_at)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          deterministicId("ntf", `${urlKey}:${index}`),
          ids.users[notification.to],
          notification.type,
          issueId,
          ids.users[notification.from],
          notification.read ? at(notification.daysAgo - 1) : null,
          at(notification.daysAgo),
        ],
      );
    }

    /* -- the changefeed ---------------------------------------------------- */

    // One event, not one per row. A client's first poll starts from
    // `latestSeq()`, so seeding four hundred events would give a brand-new
    // client a backlog describing a workspace it is about to load in full
    // anyway. The single event is what a workspace picker needs to notice that
    // this workspace now exists.
    await t.execute(
      `insert into change_events (workspace_id, entity, entity_id, action, actor_id, payload)
       values ($1,'workspace',$1,'create',$2,$3::jsonb)`,
      [ids.workspace, ids.users.owner, JSON.stringify({ seeded: true, urlKey })],
    );

    return { ...result, created: true };
  });
}

/* =============================================================== helpers = */

interface ActivityRow {
  id: string;
  issueId: string;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: Timestamp;
}

async function writeActivity(t: SqlExecutor, row: ActivityRow): Promise<void> {
  await t.execute(
    `insert into activities (id, issue_id, user_id, type, payload, created_at)
     values ($1,$2,$3,$4,$5::jsonb,$6)`,
    [
      row.id,
      row.issueId,
      row.userId,
      row.type,
      JSON.stringify(row.payload),
      row.createdAt,
    ] satisfies SqlValue[],
  );
}

function teamIdentifier(key: SeedTeamKey): string {
  return TEAMS.find((team) => team.key === key)?.identifier ?? key.toUpperCase();
}

function userName(key: SeedUserKey): string {
  return USERS.find((user) => user.key === key)?.name ?? key;
}

interface SeedIds {
  workspace: string;
  users: Record<SeedUserKey, string>;
  teams: Record<SeedTeamKey, string>;
  projects: Record<SeedProjectKey, string>;
}

/** Every id the fixture uses, derived from the URL key so two seeds can coexist. */
function buildIds(urlKey: string): SeedIds {
  return {
    workspace: deterministicId("wsp", urlKey),
    users: Object.fromEntries(
      USERS.map((user) => [user.key, deterministicId("usr", user.email)]),
    ) as Record<SeedUserKey, string>,
    teams: Object.fromEntries(
      TEAMS.map((team) => [team.key, deterministicId("tem", `${urlKey}:${team.key}`)]),
    ) as Record<SeedTeamKey, string>,
    projects: Object.fromEntries(
      PROJECTS.map((project) => [
        project.key,
        deterministicId("prj", `${urlKey}:${project.key}`),
      ]),
    ) as Record<SeedProjectKey, string>,
  };
}

/**
 * The fallback password hasher.
 *
 * `scrypt$N$r$p$salt$hash`, base64, with the salt derived from the email rather
 * than drawn at random — which is exactly what you must not do in an
 * authentication system and exactly what a reproducible fixture needs. It is
 * safe here only because these four accounts share one published password and
 * exist to be logged into.
 *
 * Pass {@link SeedOptions.hashPassword} to use the real one.
 */
async function scryptHash(plain: string, email: string): Promise<string> {
  const N = 16_384;
  const r = 8;
  const p = 1;
  const salt = createHash("sha256")
    .update(`linear-clone-demo-salt:${email}`)
    .digest()
    .subarray(0, 16);
  // Wrapped by hand rather than with `promisify`: the callback form of
  // `scrypt` is overloaded, and `promisify` resolves to the three-argument
  // overload, which has no room for the cost parameters.
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(plain, salt, 64, { N, r, p }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
  return [
    "scrypt",
    N,
    r,
    p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}
