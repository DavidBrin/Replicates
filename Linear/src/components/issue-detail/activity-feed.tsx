"use client";

import type { ActivityType, IssueRelationType } from "@/domain/entities";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";

import { buildThreads, CommentThreadCard } from "./comment-thread";
import { RelativeTime } from "./relative-time";
import type { DetailActivity, DetailComment, DetailUser } from "./types";

/**
 * The activity feed.
 *
 * ## The rule this component exists to honour
 *
 * **Every sentence is built from the payload's labels, never from a lookup.**
 *
 * `activities.payload` carries both sides of a change as an id *and* a display
 * label — `{"fromId":"sta_…","fromLabel":"Todo","toId":"sta_…","toLabel":"In
 * Progress"}`. A feed that resolved those ids against the current workflow
 * states would look identical today and be wrong tomorrow: renaming "In
 * Progress" to "Doing" would silently rewrite a year of history to claim the
 * issue moved to "Doing", and deleting the state would leave "David changed
 * status from Todo to" with nothing after it.
 *
 * So {@link describeActivity} takes an activity and nothing else. It has no
 * access to the workflow states, the label set or the member list, which is the
 * strongest available guarantee that it cannot consult them. The suite renames
 * and deletes a state and asserts the sentence is unchanged.
 *
 * ## What is not implemented
 *
 * Linear groups similar consecutive events and collapses older activity between
 * comment threads (`research/02-features.md` §12.2). Both are display
 * refinements over a correct feed; the feed here is complete and chronological,
 * and grouping is the kind of change that is safe to add later because it
 * cannot alter what any single entry says.
 */

/** A sentence fragment. `value` fragments are the emphasised nouns. */
export type ActivitySegment =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "value"; readonly value: string };

const text = (value: string): ActivitySegment => ({ kind: "text", value });
const value = (value: string): ActivitySegment => ({ kind: "value", value });

function stringOrNull(input: unknown): string | null {
  return typeof input === "string" && input !== "" ? input : null;
}

const RELATION_PHRASES: Readonly<Record<IssueRelationType, string>> = Object.freeze({
  blocks: "blocking",
  blocked_by: "blocked by",
  related: "related to",
  duplicate: "duplicated by",
  duplicate_of: "a duplicate of",
});

function relationPhrase(input: unknown): string {
  const raw = stringOrNull(input);
  if (raw === null) return "related to";
  return RELATION_PHRASES[raw as IssueRelationType] ?? "related to";
}

/**
 * One activity → the sentence that follows the actor's name.
 *
 * Pure, and takes no context. Every unhandled or half-populated case degrades
 * to something readable rather than to a blank: a payload with neither side is
 * still an event that happened, and "David updated this issue" is a better
 * record of it than an empty row.
 */
export function describeActivity(activity: {
  readonly type: ActivityType;
  readonly payload: Readonly<Record<string, unknown>>;
}): readonly ActivitySegment[] {
  const from = stringOrNull(activity.payload["fromLabel"]);
  const to = stringOrNull(activity.payload["toLabel"]);

  const changed = (noun: string): readonly ActivitySegment[] => {
    if (from !== null && to !== null) {
      return [text(`changed ${noun} from `), value(from), text(" to "), value(to)];
    }
    if (to !== null) return [text(`set ${noun} to `), value(to)];
    if (from !== null) return [text(`removed ${noun} `), value(from)];
    return [text(`updated ${noun}`)];
  };

  switch (activity.type) {
    case "issue_created":
      return [text("created the issue")];

    case "state_changed":
      return changed("status");

    case "assignee_changed":
      if (to !== null && from !== null) {
        return [text("reassigned this from "), value(from), text(" to "), value(to)];
      }
      if (to !== null) return [text("assigned this to "), value(to)];
      if (from !== null) return [text("unassigned "), value(from)];
      return [text("changed the assignee")];

    case "priority_changed":
      return changed("priority");

    case "title_changed":
      return to !== null
        ? [text("changed the title to "), value(to)]
        : [text("changed the title")];

    case "description_changed":
      return [text("updated the description")];

    case "estimate_changed":
      return changed("the estimate");

    case "due_date_changed":
      return changed("the due date");

    case "label_added":
      return to !== null
        ? [text("added label "), value(to)]
        : [text("added a label")];

    case "label_removed":
      return from !== null
        ? [text("removed label "), value(from)]
        : [text("removed a label")];

    case "project_changed":
      if (to !== null && from !== null) {
        return [text("moved this from project "), value(from), text(" to "), value(to)];
      }
      if (to !== null) return [text("added this to project "), value(to)];
      if (from !== null) return [text("removed this from project "), value(from)];
      return [text("changed the project")];

    case "milestone_changed":
      return changed("the milestone");

    case "parent_changed":
      if (to !== null) return [text("set the parent to "), value(to)];
      if (from !== null) return [text("removed the parent "), value(from)];
      return [text("changed the parent")];

    case "relation_added": {
      const phrase = relationPhrase(activity.payload["relationType"]);
      return to !== null
        ? [text(`marked this as ${phrase} `), value(to)]
        : [text(`added a ${phrase} relation`)];
    }

    case "relation_removed": {
      const phrase = relationPhrase(activity.payload["relationType"]);
      return from !== null
        ? [text(`removed the ${phrase} relation to `), value(from)]
        : [text(`removed a ${phrase} relation`)];
    }

    case "issue_archived":
      return [text("archived the issue")];

    case "issue_unarchived":
      return [text("restored the issue from the archive")];

    case "issue_moved_team":
      return to !== null
        ? [text("moved this to "), value(to)]
        : [text("moved this to another team")];
  }
}

/** The whole line as plain text — what a test asserts and what print reads. */
export function activitySentence(activity: DetailActivity): string {
  const actor = activity.user?.name ?? "Someone";
  const body = describeActivity(activity)
    .map((segment) => segment.value)
    .join("");
  return `${actor} ${body}`;
}

export interface ActivityFeedProps {
  activity: readonly DetailActivity[];
  comments: readonly DetailComment[];
  viewer: DetailUser;
  mentions: Readonly<Record<string, string>>;
  issueHref?: (identifier: string) => string | null;
  canComment: boolean;
  onReply: (rootId: string, body: string) => void | Promise<void>;
  onEditComment: (commentId: string, body: string) => void | Promise<void>;
  onDeleteComment: (commentId: string) => void;
  onToggleCommentReaction: (
    commentId: string,
    emoji: string,
    existingId: string | null,
  ) => void;
}

type TimelineEntry =
  | { readonly kind: "activity"; readonly at: string; readonly activity: DetailActivity }
  | {
      readonly kind: "thread";
      readonly at: string;
      readonly thread: ReturnType<typeof buildThreads>[number];
    };

export function ActivityFeed({
  activity,
  comments,
  viewer,
  mentions,
  issueHref,
  canComment,
  onReply,
  onEditComment,
  onDeleteComment,
  onToggleCommentReaction,
}: ActivityFeedProps) {
  // One chronological timeline, exactly as §1.6 draws it: property changes and
  // comment threads interleaved, oldest first. A thread sorts by its *root*, so
  // a reply added today does not drag a month-old conversation to the bottom.
  const timeline: TimelineEntry[] = [
    ...activity.map(
      (entry): TimelineEntry => ({ kind: "activity", at: entry.createdAt, activity: entry }),
    ),
    ...buildThreads(comments).map(
      (thread): TimelineEntry => ({ kind: "thread", at: thread.root.createdAt, thread }),
    ),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  return (
    <div data-testid="issue-activity" className="flex flex-col gap-2">
      {timeline.map((entry) =>
        entry.kind === "activity" ? (
          <ActivityEntry key={entry.activity.id} activity={entry.activity} />
        ) : (
          <div key={entry.thread.root.id} className="my-2">
            <CommentThreadCard
              thread={entry.thread}
              viewer={viewer}
              mentions={mentions}
              issueHref={issueHref}
              canComment={canComment}
              onReply={onReply}
              onEdit={onEditComment}
              onDelete={onDeleteComment}
              onToggleReaction={onToggleCommentReaction}
            />
          </div>
        ),
      )}
    </div>
  );
}

function ActivityEntry({ activity }: { activity: DetailActivity }) {
  const actor = activity.user;

  return (
    <div
      data-testid={`activity-${activity.id}`}
      data-activity-type={activity.type}
      className="flex items-center gap-2 text-small text-tertiary"
    >
      {actor ? (
        <Avatar
          id={actor.id}
          name={actor.name}
          src={actor.avatarUrl}
          color={actor.avatarColor}
          size={16}
          decorative
        />
      ) : (
        <span className="inline-block size-4 rounded-full bg-elevated" />
      )}
      <span className="min-w-0">
        <span className="text-secondary">{actor?.name ?? "Someone"}</span>{" "}
        {describeActivity(activity).map((segment, index) =>
          segment.kind === "value" ? (
            <span key={index} className={cn("text-secondary")}>
              {segment.value}
            </span>
          ) : (
            <span key={index}>{segment.value}</span>
          ),
        )}
        {" · "}
        <RelativeTime value={activity.createdAt} />
      </span>
    </div>
  );
}
