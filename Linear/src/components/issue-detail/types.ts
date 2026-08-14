/**
 * The issue detail view model.
 *
 * One serialisable shape, assembled on the server by
 * `app/[workspace]/issue/[identifier]/page.tsx` and handed to the client tree
 * whole. It is deliberately *not* the domain entities: a client component's
 * props cross the RSC boundary, so everything here has to survive
 * `JSON.stringify` — no `Date`, no class instance, no method.
 *
 * The other reason it is its own shape is authorization. `canEdit` and
 * `canComment` are computed once, on the server, by the same `can()` call the
 * route handlers make. The UI reads the answer; it never re-derives it from a
 * role, which is the rule `SPEC.md` §4 states and the thing that would
 * otherwise put a policy decision in a component.
 */

import type {
  ActivityPayload,
  ActivityType,
  IssueRelationType,
  Priority,
  StateType,
  Timestamp,
} from "@/domain/entities";

export interface DetailUser {
  readonly id: string;
  readonly name: string;
  /** The `@mention` handle. Lowercase, unique per workspace. */
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly avatarColor: string | null;
}

export interface DetailState {
  readonly id: string;
  readonly name: string;
  readonly type: StateType;
  readonly color: string;
  /** Position within its type group, for the In Progress wedge fill. */
  readonly groupIndex: number;
  readonly groupCount: number;
}

export interface DetailLabel {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

export interface DetailProject {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly color: string;
}

/** Enough of an issue to render a sub-issue row or a relation row. */
export interface DetailIssueRef {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly stateType: StateType;
  readonly stateName: string;
  readonly stateColor: string;
  readonly assignee: DetailUser | null;
}

export interface DetailRelation {
  readonly id: string;
  readonly type: IssueRelationType;
  readonly relatedIdentifier: string;
  readonly relatedTitle: string;
  readonly relatedStateType: StateType;
}

export interface DetailReaction {
  readonly id: string;
  readonly emoji: string;
  readonly userId: string;
  readonly userName: string;
}

export interface DetailComment {
  readonly id: string;
  readonly body: string;
  /** Null for a thread root. Replies to a reply carry the *root's* id. */
  readonly parentId: string | null;
  readonly createdAt: Timestamp;
  readonly editedAt: Timestamp | null;
  readonly user: DetailUser;
  readonly reactions: readonly DetailReaction[];
}

export interface DetailActivity {
  readonly id: string;
  readonly type: ActivityType;
  readonly payload: ActivityPayload;
  readonly createdAt: Timestamp;
  readonly user: DetailUser | null;
}

export interface DetailIssue {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly description: string;
  readonly stateId: string;
  readonly priority: Priority;
  readonly assigneeId: string | null;
  readonly projectId: string | null;
  readonly labelIds: readonly string[];
  readonly dueDate: string | null;
  readonly estimate: number | null;
  readonly teamKey: string;
  readonly teamName: string;
  readonly createdAt: Timestamp;
}

/** The `n / m` and the up/down arrows in the header. */
export interface DetailSiblings {
  readonly index: number;
  readonly total: number;
  readonly previousIdentifier: string | null;
  readonly nextIdentifier: string | null;
}

export interface IssueDetailData {
  readonly workspaceUrlKey: string;
  readonly issue: DetailIssue;
  readonly viewer: DetailUser;
  /** `issue.update_*` — false renders the whole pane read-only. */
  readonly canEdit: boolean;
  /** `comment.create`. */
  readonly canComment: boolean;
  readonly states: readonly DetailState[];
  readonly labels: readonly DetailLabel[];
  readonly projects: readonly DetailProject[];
  readonly members: readonly DetailUser[];
  readonly subIssues: readonly DetailIssueRef[];
  readonly relations: readonly DetailRelation[];
  /** Candidates for a new relation — recent issues in the workspace. */
  readonly relationCandidates: readonly DetailIssueRef[];
  readonly comments: readonly DetailComment[];
  /** Reactions on the description itself, which Linear allows — §12.1. */
  readonly issueReactions: readonly DetailReaction[];
  readonly activity: readonly DetailActivity[];
  readonly siblings: DetailSiblings;
  readonly isFavorite: boolean;
}

/**
 * `@handle` → display name, for the markdown renderer's mention chips.
 *
 * `Object.create(null)`, not `{}`. A plain object arrives pre-populated with
 * every key on `Object.prototype`, so `@constructor` in a description would
 * resolve against a directory that was never given one and render a chip
 * reading `@function Object() { [native code] }` — and `@__proto__` is worse
 * than useless as an assignment target. The keys here are handles chosen at
 * sign-up, which makes the whole prototype an attacker-writable namespace.
 *
 * The renderer guards the read as well (`mentionName` in `lib/markdown.ts`),
 * because this is not the only map that reaches it. Both halves are cheap and
 * neither is sufficient alone: this one covers directories built here, that one
 * covers every other caller.
 */
export function mentionDirectory(
  members: readonly DetailUser[],
): Readonly<Record<string, string>> {
  const directory = Object.create(null) as Record<string, string>;
  for (const member of members) directory[member.displayName.toLowerCase()] = member.name;
  return directory;
}

export function stateById(
  states: readonly DetailState[],
  id: string | null,
): DetailState | null {
  if (id === null) return null;
  return states.find((state) => state.id === id) ?? null;
}

export function userById(
  members: readonly DetailUser[],
  id: string | null,
): DetailUser | null {
  if (id === null) return null;
  return members.find((member) => member.id === id) ?? null;
}
