/**
 * Shared HTTP helpers for every `src/app/api/**\/route.ts` (docs/plan.md
 * Task 4 item 4b, reused by Tasks 6 and 7 — "Do not create a second HTTP
 * helper module"). Owns:
 *   - the response envelope (G4): `{ data }` or `{ error: { code, message,
 *     fields? } }`, nothing else ever goes over the wire;
 *   - Zod body parsing that turns a validation failure into the envelope's
 *     `validation` error shape automatically;
 *   - the `handler()` wrapper every route exports through, which catches
 *     thrown `AppError`s (from `parseBody`, `authorizeOr404`, or a route's
 *     own domain-error throw) and unexpected exceptions alike, and maps
 *     every `ErrorCode` to its HTTP status per the table in the Task 4
 *     brief;
 *   - `authorizeOr404`, the route-layer half of `src/domain/authz.ts`'s
 *     `can()` — see its doc comment for the 404-vs-403 policy.
 *
 * `src/lib/` is cross-cutting glue (G1) — it may import `next/server` and
 * domain/port types, but this module itself does no I/O beyond parsing the
 * `Request` it's given.
 */

import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";
import type { AppError, ErrorCode } from "@/domain/result";

// ---------------------------------------------------------------------------
// AppError as a throwable
// ---------------------------------------------------------------------------

/** Structural check for "is this thrown value one of our typed errors" —
 * deliberately not a class/`instanceof` check, so any code that throws a
 * plain `{code, message}` object (not just ones constructed via `throwApp`)
 * is still recognized by `handler()`. */
export function isAppError(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.code === "string" &&
    STATUS_BY_CODE[v.code as ErrorCode] !== undefined &&
    typeof v.message === "string"
  );
}

/** Throws `error` as an `AppError` for `handler()` to catch. The standard
 * way a route or a domain service signals a typed failure — prefer this
 * over hand-rolling `throw { code, message }` so the shape stays checked. */
export function throwApp(error: AppError): never {
  throw error;
}

// ---------------------------------------------------------------------------
// Status mapping (G4 / Task 4 brief)
// ---------------------------------------------------------------------------

export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  validation: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  market_closed: 409,
  insufficient_balance: 422,
  rate_limited: 429,
  internal: 500,
};

// ---------------------------------------------------------------------------
// Envelope helpers
// ---------------------------------------------------------------------------

export type Envelope<T> = { data: T } | { error: AppError };

/** `{ data }` success envelope. */
export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse<{ data: T }> {
  return NextResponse.json({ data }, init);
}

/** `{ error }` failure envelope. Status defaults from `STATUS_BY_CODE`;
 * pass `status` to override (rarely needed — prefer picking the right
 * `ErrorCode` over overriding the status). */
export function jsonErr(
  error: AppError,
  status?: number,
): NextResponse<{ error: AppError }> {
  return NextResponse.json(
    { error },
    { status: status ?? STATUS_BY_CODE[error.code] },
  );
}

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------

/** Formats Zod's `issues` into the envelope's flat `fields` map: dotted
 * path -> message. Root-level (path-less) issues key under `"_"`. */
function fieldsFromZodError(error: { issues: { path: PropertyKey[]; message: string }[] }): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "_";
    // First message per field wins — enough detail for a demo app's forms
    // without concatenating multiple issues into one unreadable string.
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

/**
 * Parses `req`'s JSON body against `schema`, throwing a `validation`
 * `AppError` (caught by `handler()`) on malformed JSON or a failed schema
 * check. Returns the parsed, validated, typed value on success.
 */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return throwApp({
      code: "validation",
      message: "Request body must be valid JSON.",
    });
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return throwApp({
      code: "validation",
      message: "Request body failed validation.",
      fields: fieldsFromZodError(result.error),
    });
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// authorizeOr404 — the route-layer half of authz.ts's can()
// ---------------------------------------------------------------------------

/**
 * `src/domain/authz.ts`'s `can()` returns a plain boolean and never decides
 * an HTTP status (it doesn't know one) — 404-vs-403 is a route-layer policy
 * decision (Task 4 brief, "ambiguity resolutions"), made here:
 *
 *   - `sensitive: true` (the default) — a denial reads as `not_found`
 *     (404). Use this for **existence-sensitive** resources, where telling
 *     an unauthorized caller "exists but you can't see it" (403) would leak
 *     that the resource exists at all: **market, room, position, group**
 *     (research §7.1's "membership gates every read" — a private
 *     market/room/group/position's very existence is private).
 *   - `sensitive: false` — a denial reads as `forbidden` (403). Use this for
 *     **non-existence-sensitive** resources, where the caller already knows
 *     the resource exists (they're acting on something they can see, just
 *     not something they're allowed to mutate/view further): **invite**
 *     (you were handed the id/token — its existence isn't secret, only who
 *     may act on it is) and **friendGraph** (you already know the target
 *     user exists; only their friend list's contents are hidden — research
 *     §1.6/§2.5's "uniform response shape" reasoning, applied to the graph
 *     rather than the username-probe case §2.5 itself covers).
 *
 * Throws the appropriate `AppError` (caught by `handler()`) when `allowed`
 * is false; otherwise a no-op.
 */
export function authorizeOr404(
  allowed: boolean,
  options?: { sensitive?: boolean; message?: string },
): void {
  if (allowed) return;
  const sensitive = options?.sensitive ?? true;
  if (sensitive) {
    throwApp({
      code: "not_found",
      message: options?.message ?? "Not found.",
    });
  }
  throwApp({
    code: "forbidden",
    message: options?.message ?? "You don't have permission to do that.",
  });
}

// ---------------------------------------------------------------------------
// handler() wrapper
// ---------------------------------------------------------------------------

export type RouteContext<P extends Record<string, string> = Record<string, string>> = {
  params: Promise<P>;
};

export type RouteHandlerFn<P extends Record<string, string> = Record<string, string>> = (
  req: NextRequest,
  ctx: RouteContext<P>,
) => Promise<Response>;

/**
 * Wraps a Next 16 Route Handler body so every route follows the same
 * ergonomic shape:
 *
 *   export const POST = handler(async (req, ctx) => {
 *     const { id } = await ctx.params;
 *     const body = await parseBody(req, someSchema);
 *     ...
 *     return jsonOk(result);
 *   });
 *
 * Catches every thrown `AppError` (from `parseBody`, `authorizeOr404`, or a
 * route/service throwing `throwApp(...)` directly) and serializes it via
 * `jsonErr`. Catches anything else too — logs it server-side (so real bugs
 * are never silent) and returns a generic `internal` error, never the raw
 * message/stack (G4: never leak internals to the client).
 */
export function handler<P extends Record<string, string> = Record<string, string>>(
  fn: RouteHandlerFn<P>,
) {
  return async (req: NextRequest, ctx?: RouteContext<P>): Promise<Response> => {
    const resolvedCtx: RouteContext<P> = ctx ?? { params: Promise.resolve({} as P) };
    try {
      return await fn(req, resolvedCtx);
    } catch (error) {
      if (isAppError(error)) {
        return jsonErr(error);
      }
      // Unexpected errors must be visible server-side even though the
      // client only ever sees the generic "internal" message below.
      console.error("[handler] unexpected error", error);
      return jsonErr({ code: "internal", message: "Something went wrong." });
    }
  };
}
