"use client";

import type { IssueRelationType, Priority } from "@/domain/entities";

/**
 * The detail pane's mutations, as one module.
 *
 * Every call here goes to a Route Handler rather than a Server Action, for the
 * reason `DECISIONS.md` D6 gives: Server Actions dispatch one at a time per
 * client, and this pane can easily have three edits in flight (a status change,
 * a description autosave and a comment).
 *
 * Addressed by URL rather than by importing the handlers' modules. The issue
 * routes belong to another slice, and a `fetch("/api/issues/…")` couples to the
 * wire contract they publish instead of to their implementation — which is also
 * what lets a component test stub `globalThis.fetch` and assert on the request
 * that would have gone out.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  url: string,
  init: { method: string; body?: unknown },
): Promise<T> {
  const response = await fetch(url, {
    method: init.method,
    headers: init.body === undefined ? {} : { "content-type": "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload !== null &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof (payload as { error: unknown }).error === "string"
        ? (payload as { error: string }).error
        : "Something went wrong.";
    throw new ApiError(response.status, message);
  }
  return payload as T;
}

/* ================================================================ issues == */

export interface IssuePatch {
  readonly title?: string;
  readonly description?: string;
  readonly stateId?: string;
  readonly priority?: Priority;
  readonly assigneeId?: string | null;
  readonly projectId?: string | null;
  readonly labelIds?: readonly string[];
  readonly dueDate?: string | null;
  readonly estimate?: number | null;
}

export async function patchIssue(id: string, patch: IssuePatch): Promise<void> {
  await request(`/api/issues/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: patch,
  });
}

export interface CreateSubIssueInput {
  readonly teamId?: string;
  readonly parentId: string;
  readonly title: string;
  readonly priority?: Priority;
  readonly projectId?: string | null;
}

export interface CreatedIssue {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly stateType: string;
  readonly stateName: string;
  readonly stateColor: string;
}

export async function createSubIssue(
  input: CreateSubIssueInput,
): Promise<CreatedIssue> {
  return request<CreatedIssue>("/api/issues", { method: "POST", body: input });
}

/* ============================================================== comments == */

export interface CreateCommentInput {
  readonly issueId: string;
  readonly body: string;
  readonly parentId?: string | null;
}

export interface CommentResponse {
  readonly id: string;
  readonly parentId: string | null;
  readonly createdAt: string;
  readonly editedAt: string | null;
}

export async function createComment(
  input: CreateCommentInput,
): Promise<CommentResponse> {
  return request<CommentResponse>("/api/comments", { method: "POST", body: input });
}

export async function updateComment(
  id: string,
  body: string,
): Promise<CommentResponse> {
  return request<CommentResponse>(`/api/comments/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { body },
  });
}

export async function deleteComment(id: string): Promise<void> {
  await request(`/api/comments/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* ============================================================= reactions == */

export interface ReactionResponse {
  readonly id: string;
  readonly emoji: string;
  readonly userId: string;
}

export async function addReaction(
  target: { readonly commentId?: string; readonly issueId?: string },
  emoji: string,
): Promise<ReactionResponse> {
  return request<ReactionResponse>("/api/reactions", {
    method: "POST",
    body: { ...target, emoji },
  });
}

export async function removeReaction(id: string): Promise<void> {
  await request(`/api/reactions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* ============================================================= relations == */

export interface RelationResponse {
  readonly id: string;
  readonly type: IssueRelationType;
  readonly relatedIdentifier: string;
  readonly relatedTitle: string;
  readonly relatedStateType: string;
}

export async function addRelation(
  issueId: string,
  relatedIssueId: string,
  type: IssueRelationType,
): Promise<RelationResponse> {
  return request<RelationResponse>(
    `/api/issues/${encodeURIComponent(issueId)}/relations`,
    { method: "POST", body: { relatedIssueId, type } },
  );
}

export async function removeRelation(
  issueId: string,
  relationId: string,
): Promise<void> {
  await request(
    `/api/issues/${encodeURIComponent(issueId)}/relations?relationId=${encodeURIComponent(relationId)}`,
    { method: "DELETE" },
  );
}
