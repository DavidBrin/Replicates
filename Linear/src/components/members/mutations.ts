/**
 * The client half of a refusal.
 *
 * Every mutation in this slice is a `fetch` to a route handler that either
 * succeeds or returns `{ error, code }`. The `code` is what matters: it is a
 * closed set from `domain/policy.ts`, so the UI can phrase the refusal in
 * product language without string-matching a server message.
 *
 * ## Why the wording is here and not in `explainDenial`
 *
 * `explainDenial` is written to be safe to return over the wire — no ids, no
 * emails, no confirmation that a resource exists. That makes it correct and
 * slightly bloodless: "A workspace must keep at least one owner." is true, and
 * it is not what somebody who just tried to demote themselves needs to read.
 * The map below says the same thing from the operator's side, and names the way
 * out. The server message is the fallback for a code this map has not met.
 */

export interface MutationFailure {
  readonly code: string;
  readonly message: string;
  readonly status: number;
}

export type MutationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: MutationFailure };

interface ErrorBody {
  readonly error?: unknown;
  readonly code?: unknown;
}

/**
 * `fetch` with the three things every call site would otherwise repeat: JSON in
 * and out, a network error that reads as a failure rather than a rejected
 * promise nobody caught, and a request that outlives the page that made it.
 *
 * ## `keepalive`, and why a write must not be page-bound
 *
 * Every caller here is optimistic: the row is on screen before the server has
 * been asked. An ordinary `fetch` is tied to the document that issued it, so
 * anything that tears the document down in the window between the click and the
 * response — a navigation, a closed tab, `router.refresh()` landing on a route
 * that remounts the tree — cancels the request. With an optimistic UI that is
 * not a slow save, it is a *silent lost write*: the operator saw the member
 * appear and the row was never written. Measured, not assumed: adding somebody
 * to a project and navigating away in the same tick leaves no `POST` in the
 * server log at all.
 *
 * `keepalive` is exactly the guarantee these calls need — the browser finishes
 * the request even if the document is gone. Its one constraint is a 64 KB body
 * cap across all in-flight keepalive requests, which is not a limit any
 * membership mutation can approach; the bodies here are one or two ids.
 *
 * It is not a licence to fire and forget. The response still decides whether the
 * optimistic state stands, and the callers still have to say, on screen, that a
 * write has not been acknowledged yet — see the `pending` state in
 * `members-table.tsx` and `project-members-panel.tsx`.
 */
export async function callApi<T>(
  url: string,
  init: {
    readonly method: "POST" | "PATCH" | "DELETE" | "GET";
    readonly body?: unknown;
  },
): Promise<MutationResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      keepalive: true,
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    return {
      ok: false,
      failure: {
        code: "NETWORK",
        message: "The change could not be sent. Check your connection.",
        status: 0,
      },
    };
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const body = (payload ?? {}) as ErrorBody;
    return {
      ok: false,
      failure: {
        code: typeof body.code === "string" ? body.code : "UNKNOWN",
        message:
          typeof body.error === "string" ? body.error : "Something went wrong.",
        status: response.status,
      },
    };
  }

  return { ok: true, value: payload as T };
}

/**
 * The refusal, in the words the person who hit it needs.
 *
 * `LAST_OWNER` is the one the permission journey asserts on by name, and the
 * reason it says "last owner" rather than "at least one owner": the sentence
 * has to name the rule that was hit, not restate the invariant it protects.
 */
const MESSAGES: Readonly<Record<string, string>> = {
  LAST_OWNER:
    "The last owner cannot be demoted or removed. Promote another owner first.",
  LAST_TEAM_ADMIN:
    "A team must keep at least one admin. Promote another admin first.",
  RANK_NOT_ABOVE_TARGET:
    "You cannot act on somebody at or above your own role.",
  CANNOT_GRANT_ABOVE_OWN_RANK: "You cannot grant a role above your own.",
  GUEST_CANNOT_HOLD_ROLE:
    "Guests cannot hold an admin or lead role. Change their workspace role first.",
  INSUFFICIENT_ROLE: "Your role does not allow this.",
  MEMBERSHIP_SUSPENDED: "Your membership is suspended.",
  NOT_A_MEMBER: "You are not a member of this workspace.",
  UNAUTHENTICATED: "Your session has expired. Sign in again.",
};

export function refusalMessage(failure: MutationFailure): string {
  return MESSAGES[failure.code] ?? failure.message;
}
