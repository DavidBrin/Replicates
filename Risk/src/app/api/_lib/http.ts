import type { ZodError } from "zod";

/**
 * The response shapes every route shares (SPEC §6).
 *
 * Three rules, applied by these helpers rather than remembered per handler:
 *
 * - **`Cache-Control: no-store` on everything.** A cached poll is a poll that
 *   lies about `seq`, and a cached `/api/session` is somebody else's cookie.
 * - **an error is always `{ error: string }`**, with its extra fields beside
 *   it (`suggestions`, `code`) — never a stack trace and never a driver
 *   message, which on Neon carries the connection string's host.
 * - **nothing escapes unformatted**: {@link withErrors} is the outermost
 *   frame of every handler, so a thrown driver error is a logged `500` and
 *   not an HTML error page.
 */

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** `204 No Content`: no body at all, which is the point of the fast path. */
export function noContent(headers: HeadersInit = {}): Response {
  return new Response(null, { status: 204, headers: { ...NO_STORE, ...headers } });
}

export function jsonError(
  status: number,
  error: string,
  extra?: Record<string, unknown>,
): Response {
  return json({ error, ...extra }, status);
}

export function badRequest(error = "bad request", extra?: Record<string, unknown>): Response {
  return jsonError(400, error, extra);
}

export function unauthorized(): Response {
  return jsonError(401, "no session");
}

export function forbidden(error = "forbidden"): Response {
  return jsonError(403, error);
}

export function notFound(error = "not found"): Response {
  return jsonError(404, error);
}

export function conflict(error: string, extra?: Record<string, unknown>): Response {
  return jsonError(409, error, extra);
}

/** The rule-violation answer: `422 { error, code: RuleErrorCode }`. */
export function unprocessable(code: string, error = "rule violation"): Response {
  return json({ error, code }, 422);
}

/** Flatten a `zod` error into the one-line messages a client can show. */
export function issueMessages(error: ZodError): string[] {
  return error.issues.map((issue) =>
    issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
  );
}

/** Parse a JSON body, or `undefined` when it is not JSON at all. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    return undefined;
  }
}

/** A non-negative integer query parameter, or `fallback`. */
export function intParam(url: URL, name: string, fallback = 0): number {
  const raw = url.searchParams.get(name);
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return fallback;
  return value;
}

/** Run a handler; anything thrown becomes a logged JSON `500`. */
export async function withErrors(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    console.error("[api]", error);
    return jsonError(500, "internal error");
  }
}
