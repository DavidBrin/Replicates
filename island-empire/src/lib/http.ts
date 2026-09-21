/**
 * The few response shapes every route handler shares (SPEC §6): an error is
 * always `{ error: string }` with the right status, never a stack trace or a
 * driver message. `withErrors` is the outermost frame of every handler so
 * nothing escapes unformatted.
 */

export function jsonError(status: number, error: string, extra?: Record<string, unknown>): Response {
  return Response.json({ error, ...extra }, { status });
}

export function badRequest(error: string, extra?: Record<string, unknown>): Response {
  return jsonError(400, error, extra);
}

export function notFound(what = "not found"): Response {
  return jsonError(404, what);
}

export function unprocessable(errors: string[]): Response {
  return Response.json({ error: "map failed validation", errors }, { status: 422 });
}

/** Run a handler; anything thrown becomes a JSON 500 (logged, not leaked). */
export async function withErrors(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    console.error("[api]", error);
    return jsonError(500, "internal error");
  }
}
