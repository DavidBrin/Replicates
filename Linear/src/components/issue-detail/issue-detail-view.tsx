"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/cn";
import type { IssueRelationType, Priority } from "@/domain/entities";
import { newId } from "@/lib/ids";
import { Tooltip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast-provider";

import { ActivityFeed } from "./activity-feed";
import * as api from "./api";
import { CommentComposer } from "./comment-composer";
import { DescriptionEditor } from "./description-editor";
import { IssueHeader } from "./issue-header";
import { PropertiesRail, type PickerKind } from "./properties-rail";
import { Reactions } from "./reactions";
import { RelationsSection } from "./relations-section";
import { SubIssuesSection } from "./sub-issues-section";
import { TitleEditor } from "./title-editor";
import { useIssueShortcuts } from "./use-issue-shortcuts";
import {
  mentionDirectory,
  type DetailComment,
  type DetailIssue,
  type DetailReaction,
  type DetailRelation,
  type IssueDetailData,
} from "./types";

/**
 * The issue detail pane.
 *
 * A centred 80ch column with the 260px properties rail beside it, matching the
 * reference capture: title, description, the reaction and attach affordances,
 * `+ Add sub-issues`, a divider, then Activity.
 *
 * ## Mutation shape
 *
 * Optimistic by default (`SPEC.md` §6): apply locally, POST to a Route Handler,
 * and on failure **roll back only the fields the patch touched**. That last part
 * is the whole reason {@link applyPatch} takes the patch rather than a whole
 * issue — restoring a snapshot would also undo a concurrent edit to an unrelated
 * field that happened to land while the failed request was in flight.
 *
 * `router.refresh()` after a successful write is what brings the *derived* data
 * back: the activity row the server wrote, the identifier it minted for a new
 * sub-issue, the inverse of a relation. Those cannot be computed here without
 * reimplementing the server, and an optimistic guess at them would be a second
 * implementation to keep in step.
 */

export interface IssueDetailViewProps {
  data: IssueDetailData;
}

export function IssueDetailView({ data }: IssueDetailViewProps) {
  const router = useRouter();

  const [issue, setIssue] = useState<DetailIssue>(data.issue);
  const [comments, setComments] = useState<readonly DetailComment[]>(data.comments);
  const [issueReactions, setIssueReactions] = useState<readonly DetailReaction[]>(
    data.issueReactions,
  );
  const [relations, setRelations] = useState<readonly DetailRelation[]>(data.relations);
  const [isFavorite, setIsFavorite] = useState(data.isFavorite);
  const [openPicker, setOpenPicker] = useState<PickerKind | null>(null);
  const [openRelationPicker, setOpenRelationPicker] =
    useState<IssueRelationType | null>(null);

  const mentions = useMemo(() => mentionDirectory(data.members), [data.members]);
  const issueHref = useCallback(
    (identifier: string) => `/${data.workspaceUrlKey}/issue/${identifier}`,
    [data.workspaceUrlKey],
  );

  const fail = (error: unknown, fallback: string): void => {
    toast({
      title: error instanceof api.ApiError ? error.message : fallback,
      variant: "error",
    });
  };

  /**
   * Apply a patch locally, send it, and undo exactly what it touched on failure.
   */
  const applyPatch = useCallback(
    (local: Partial<DetailIssue>, remote: api.IssuePatch): void => {
      const keys = Object.keys(local) as (keyof DetailIssue)[];
      let restore: Partial<DetailIssue> = {};

      setIssue((current) => {
        restore = Object.fromEntries(
          keys.map((key) => [key, current[key]]),
        ) as Partial<DetailIssue>;
        return { ...current, ...local };
      });

      void api
        .patchIssue(data.issue.id, remote)
        .then(() => router.refresh())
        .catch((error: unknown) => {
          setIssue((current) => ({ ...current, ...restore }));
          fail(error, "Could not save that change.");
        });
    },
    [data.issue.id, router],
  );

  /* ------------------------------------------------------------ comments -- */

  const addComment = async (body: string, parentId: string | null): Promise<void> => {
    // An optimistic id so the comment renders before the round trip, and so the
    // reconcile is by id rather than by position — the rule in `ports/repositories`.
    const optimisticId = newId("cmt");
    const optimistic: DetailComment = {
      id: optimisticId,
      body,
      parentId,
      createdAt: new Date().toISOString(),
      editedAt: null,
      user: data.viewer,
      reactions: [],
    };
    setComments((current) => [...current, optimistic]);

    try {
      const created = await api.createComment({
        issueId: data.issue.id,
        body,
        parentId,
      });
      setComments((current) =>
        current.map((comment) =>
          comment.id === optimisticId
            ? { ...comment, id: created.id, parentId: created.parentId }
            : comment,
        ),
      );
      router.refresh();
    } catch (error) {
      setComments((current) => current.filter((comment) => comment.id !== optimisticId));
      fail(error, "Could not post that comment.");
    }
  };

  const editComment = async (commentId: string, body: string): Promise<void> => {
    const previous = comments.find((comment) => comment.id === commentId);
    setComments((current) =>
      current.map((comment) =>
        comment.id === commentId
          ? { ...comment, body, editedAt: new Date().toISOString() }
          : comment,
      ),
    );
    try {
      await api.updateComment(commentId, body);
      router.refresh();
    } catch (error) {
      if (previous) {
        setComments((current) =>
          current.map((comment) => (comment.id === commentId ? previous : comment)),
        );
      }
      fail(error, "Could not save that comment.");
    }
  };

  const deleteComment = (commentId: string): void => {
    const previous = comments;
    // A reply's root going away takes the replies with it, matching the
    // cascade on `comments.parent_id`.
    setComments((current) =>
      current.filter(
        (comment) => comment.id !== commentId && comment.parentId !== commentId,
      ),
    );
    void api
      .deleteComment(commentId)
      .then(() => router.refresh())
      .catch((error: unknown) => {
        setComments(previous);
        fail(error, "Could not delete that comment.");
      });
  };

  /* ----------------------------------------------------------- reactions -- */

  const toggleReaction = (
    target: { commentId?: string; issueId?: string },
    emoji: string,
    existingId: string | null,
    update: (mutate: (current: readonly DetailReaction[]) => readonly DetailReaction[]) => void,
    rollback: () => void,
  ): void => {
    if (existingId !== null) {
      update((current) => current.filter((reaction) => reaction.id !== existingId));
      void api.removeReaction(existingId).catch((error: unknown) => {
        rollback();
        fail(error, "Could not remove that reaction.");
      });
      return;
    }

    const optimisticId = newId("rct");
    update((current) => [
      ...current,
      { id: optimisticId, emoji, userId: data.viewer.id, userName: data.viewer.name },
    ]);
    void api
      .addReaction(target, emoji)
      .then((created) => {
        update((current) =>
          current.map((reaction) =>
            reaction.id === optimisticId ? { ...reaction, id: created.id } : reaction,
          ),
        );
      })
      .catch((error: unknown) => {
        rollback();
        fail(error, "Could not add that reaction.");
      });
  };

  const toggleCommentReaction = (
    commentId: string,
    emoji: string,
    existingId: string | null,
  ): void => {
    const previous = comments;
    toggleReaction(
      { commentId },
      emoji,
      existingId,
      (mutate) =>
        setComments((current) =>
          current.map((comment) =>
            comment.id === commentId
              ? { ...comment, reactions: mutate(comment.reactions) }
              : comment,
          ),
        ),
      () => setComments(previous),
    );
  };

  const toggleIssueReaction = (emoji: string, existingId: string | null): void => {
    const previous = issueReactions;
    toggleReaction(
      { issueId: data.issue.id },
      emoji,
      existingId,
      (mutate) => setIssueReactions((current) => mutate(current)),
      () => setIssueReactions(previous),
    );
  };

  /* ---------------------------------------------- sub-issues & relations -- */

  const createSubIssue = async (title: string): Promise<void> => {
    try {
      await api.createSubIssue({ parentId: data.issue.id, title });
      // The identifier comes from the team's counter inside the insert's
      // transaction, so the server is the only place that knows it.
      router.refresh();
    } catch (error) {
      fail(error, "Could not create that sub-issue.");
    }
  };

  const addRelation = (relatedIssueId: string, type: IssueRelationType): void => {
    void api
      .addRelation(data.issue.id, relatedIssueId, type)
      .then((created) => {
        setRelations((current) => [
          ...current,
          {
            id: created.id,
            type: created.type,
            relatedIdentifier: created.relatedIdentifier,
            relatedTitle: created.relatedTitle,
            relatedStateType: created.relatedStateType as DetailRelation["relatedStateType"],
          },
        ]);
        router.refresh();
      })
      .catch((error: unknown) => fail(error, "Could not add that relation."));
  };

  const removeRelation = (relationId: string): void => {
    const previous = relations;
    setRelations((current) => current.filter((relation) => relation.id !== relationId));
    void api
      .removeRelation(data.issue.id, relationId)
      .then(() => router.refresh())
      .catch((error: unknown) => {
        setRelations(previous);
        fail(error, "Could not remove that relation.");
      });
  };

  /* ------------------------------------------------------------ keyboard -- */

  useIssueShortcutsBound({
    enabled: data.canEdit,
    setOpenPicker,
    setOpenRelationPicker,
  });

  /* -------------------------------------------------------------- render -- */

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <IssueHeader
        identifier={issue.identifier}
        title={issue.title}
        workspaceUrlKey={data.workspaceUrlKey}
        siblings={data.siblings}
        isFavorite={isFavorite}
        onToggleFavorite={() => setIsFavorite((current) => !current)}
        onOpenMenu={() => toast({ title: "Issue actions are in the command palette." })}
      />

      <div className="flex min-h-0 flex-1 justify-center overflow-y-auto">
        <div className="flex w-full max-w-[calc(var(--detail-max-width)+var(--properties-width)+3rem)] gap-6 px-6">
          <main className="min-w-0 flex-1 py-6 [max-width:var(--detail-max-width)]">
            <TitleEditor
              value={issue.title}
              readOnly={!data.canEdit}
              onCommit={(title) => applyPatch({ title }, { title })}
            />

            <div className="mt-3">
              <DescriptionEditor
                value={issue.description}
                readOnly={!data.canEdit}
                mentions={mentions}
                issueHref={issueHref}
                onCommit={(description) =>
                  applyPatch({ description }, { description })
                }
              />
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Reactions
                reactions={issueReactions}
                viewerId={data.viewer.id}
                testId="issue-reactions"
                alwaysShowAdd
                disabled={!data.canComment}
                onToggle={toggleIssueReaction}
              />
              <Tooltip content="Attachments are not part of this build">
                <button
                  type="button"
                  disabled
                  aria-label="Attach a file"
                  data-testid="issue-attach"
                  className="inline-flex size-6 items-center justify-center rounded-full text-tertiary opacity-50"
                >
                  <PaperclipIcon />
                </button>
              </Tooltip>
            </div>

            <SubIssuesSection
              subIssues={data.subIssues}
              workspaceUrlKey={data.workspaceUrlKey}
              canEdit={data.canEdit}
              onCreate={createSubIssue}
            />

            <RelationsSection
              relations={relations}
              candidates={data.relationCandidates}
              workspaceUrlKey={data.workspaceUrlKey}
              canEdit={data.canEdit}
              openRelationPicker={openRelationPicker}
              onOpenRelationPicker={setOpenRelationPicker}
              onAdd={addRelation}
              onRemove={removeRelation}
            />

            <hr className="my-5 border-0 border-t border-subtle" />

            <section aria-labelledby="activity-heading">
              <h2
                id="activity-heading"
                className={cn(
                  "mb-3 text-small text-primary",
                  "[font-weight:var(--weight-medium)]",
                )}
              >
                Activity
              </h2>

              <ActivityFeed
                activity={data.activity}
                comments={comments}
                viewer={data.viewer}
                mentions={mentions}
                issueHref={issueHref}
                canComment={data.canComment}
                onReply={(rootId, body) => addComment(body, rootId)}
                onEditComment={editComment}
                onDeleteComment={deleteComment}
                onToggleCommentReaction={toggleCommentReaction}
              />

              <div className="mt-4">
                <CommentComposer
                  testId="comment-composer"
                  submitTestId="comment-submit"
                  disabled={!data.canComment}
                  onSubmit={(body) => addComment(body, null)}
                />
              </div>
            </section>
          </main>

          <PropertiesRail
            states={data.states}
            labels={data.labels}
            projects={data.projects}
            members={data.members}
            subIssues={data.subIssues}
            stateId={issue.stateId}
            priority={issue.priority}
            assigneeId={issue.assigneeId}
            labelIds={issue.labelIds}
            projectId={issue.projectId}
            dueDate={issue.dueDate}
            readOnly={!data.canEdit}
            openPicker={openPicker}
            onOpenPicker={setOpenPicker}
            onStateChange={(stateId) => applyPatch({ stateId }, { stateId })}
            onPriorityChange={(priority: Priority) =>
              applyPatch({ priority }, { priority })
            }
            onAssigneeChange={(assigneeId) => applyPatch({ assigneeId }, { assigneeId })}
            onProjectChange={(projectId) => applyPatch({ projectId }, { projectId })}
            onDueDateChange={(dueDate) => applyPatch({ dueDate }, { dueDate })}
            onLabelToggle={(labelId) => {
              const next = issue.labelIds.includes(labelId)
                ? issue.labelIds.filter((id) => id !== labelId)
                : [...issue.labelIds, labelId];
              applyPatch({ labelIds: next }, { labelIds: next });
            }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The shortcut wiring, extracted so the view body stays readable.
 *
 * A picker opened from the keyboard closes any relation picker and vice versa —
 * two open popovers would both hold focus and the second would steal it from
 * the first mid-selection.
 */
function useIssueShortcutsBound({
  enabled,
  setOpenPicker,
  setOpenRelationPicker,
}: {
  enabled: boolean;
  setOpenPicker: (kind: PickerKind | null) => void;
  setOpenRelationPicker: (type: IssueRelationType | null) => void;
}): void {
  useIssueShortcuts({
    enabled,
    onOpenPicker: (kind) => {
      setOpenRelationPicker(null);
      setOpenPicker(kind);
    },
    onOpenRelationPicker: (type) => {
      setOpenPicker(null);
      setOpenRelationPicker(type);
    },
    onEscape: () => {
      setOpenPicker(null);
      setOpenRelationPicker(null);
    },
  });
}

/** Verbatim from Linear's attachment affordance in the reference capture. */
function PaperclipIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden focusable="false">
      <path
        d="M10.5 4.5 5.75 9.25a1.75 1.75 0 0 0 2.475 2.475l4.75-4.75a3.25 3.25 0 0 0-4.596-4.596L3.5 7.25a4.75 4.75 0 0 0 6.718 6.718L14 10.25"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
