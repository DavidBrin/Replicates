/**
 * `POST /api/issues/[id]/relations` and `DELETE …?relationId=…`
 *
 * Create or remove an issue relation.
 *
 * ## One row, both directions
 *
 * `A blocks B` is stored once, in the direction it was created;
 * `IssueRepository.listRelations` re-reads it from the other end and flips the
 * type through `INVERSE_RELATION`, so B shows `blocked_by A` without a second
 * row. Storing both halves would let them drift, and there would be no way to
 * tell which one was authoritative.
 *
 * The consequence for this handler: `type` is validated against the full
 * `ISSUE_RELATION_TYPES` enum, but there is no code path that writes an inverse.
 * A client that asks for `blocked_by` gets exactly one row, whose inverse
 * appears on the other issue for free.
 *
 * ## Authorization, on both ends
 *
 * A relation is an edit to *two* issues — it becomes visible on the other one —
 * so both are checked. Only checking the issue in the URL would let someone with
 * write access to one team attach a relation onto an issue in a private team
 * they cannot see, which is a write into a container they were never granted and
 * a disclosure of that issue's identifier and title on a page they can read.
 */

import { z } from "zod";

import {
  canEditIssue,
  jsonError,
  loadIssueContext,
} from "@/app/api/_lib/issue-access";
import { ISSUE_RELATION_TYPES, type IssueRelationType } from "@/domain/entities";
import { ConflictError, NotFoundError } from "@/ports/repositories";

const Body = z.object({
  relatedIssueId: z.string().min(1).max(64),
  type: z.enum(ISSUE_RELATION_TYPES),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  request: Request,
  { params }: RouteContext,
): Promise<Response> {
  const { id } = await params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(400, "A relation needs a target issue and a type.");
  }

  const context = await loadIssueContext(request, id);
  if (context instanceof Response) return context;

  if (!canEditIssue(context.actor, context.resource)) {
    return jsonError(403, "Your role does not allow this.", context.headers);
  }

  // The far end, checked as its own resource. `loadIssueContext` answers 404
  // for an issue the actor cannot view, which is the right answer here too:
  // "that issue does not exist, as far as you are concerned".
  const target = await loadIssueContext(request, parsed.data.relatedIssueId);
  if (target instanceof Response) return target;
  if (!canEditIssue(target.actor, target.resource)) {
    return jsonError(403, "Your role does not allow this.", context.headers);
  }

  try {
    const relation = await context.repos.issues.addRelation(
      id,
      parsed.data.relatedIssueId,
      parsed.data.type as IssueRelationType,
      context.userId,
    );

    return Response.json(
      {
        id: relation.id,
        type: relation.type,
        relatedIdentifier: target.issue.identifier,
        relatedTitle: target.issue.title,
        relatedStateType: target.issue.state.type,
      },
      { status: 201, headers: context.headers },
    );
  } catch (error) {
    if (error instanceof ConflictError) {
      return jsonError(409, error.message, context.headers);
    }
    throw error;
  }
}

export async function DELETE(
  request: Request,
  { params }: RouteContext,
): Promise<Response> {
  const { id } = await params;
  const relationId = new URL(request.url).searchParams.get("relationId");
  if (relationId === null || relationId === "") {
    return jsonError(400, "A relation id is required.");
  }

  const context = await loadIssueContext(request, id);
  if (context instanceof Response) return context;

  if (!canEditIssue(context.actor, context.resource)) {
    return jsonError(403, "Your role does not allow this.", context.headers);
  }

  // The relation must belong to this issue — at either end, because the
  // inverse is what the client is looking at half the time. Without this, a
  // relation id from any issue in the workspace could be deleted through an
  // issue the actor happens to be able to edit.
  const owned = await context.repos.issues.listRelations(id);
  if (!owned.some((relation) => relation.id === relationId)) {
    return jsonError(404, "Not found.", context.headers);
  }

  try {
    await context.repos.issues.removeRelation(relationId, context.userId);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return Response.json({ id: relationId }, { status: 200, headers: context.headers });
    }
    throw error;
  }

  return Response.json({ id: relationId }, { status: 200, headers: context.headers });
}
