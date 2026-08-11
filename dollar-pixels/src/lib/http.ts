import { NextResponse } from "next/server";
import { AppError, isAppError } from "@/domain/services/errors";

/**
 * One response envelope, and one place errors become status codes.
 *
 * Route handlers stay thin because everything they can go wrong with is an
 * `AppError` that already knows its own status. Anything that is not an
 * AppError is a bug, so it becomes a 500 with a generic message and the real
 * detail goes to the server log rather than to the client.
 */

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: { code: string; message: string; detail?: unknown } };
export type ApiResponse<T> = ApiOk<T> | ApiErr;

export function ok<T>(data: T, init?: ResponseInit): NextResponse<ApiOk<T>> {
  return NextResponse.json({ ok: true, data } as const, init);
}

export function err(
  code: string,
  message: string,
  status: number,
  detail?: unknown,
): NextResponse<ApiErr> {
  return NextResponse.json({ ok: false, error: { code, message, detail } } as const, {
    status,
  });
}

/**
 * Wrap a handler so a thrown AppError becomes its status.
 *
 * Deliberately catches everything: an unhandled rejection inside a route
 * handler otherwise surfaces as an opaque framework error page, which tells
 * the user nothing and tells us nothing either.
 */
export function handler<Args extends unknown[]>(
  fn: (...args: Args) => Promise<NextResponse>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (isAppError(error)) {
        return err(error.code, error.message, error.status, error.detail);
      }
      console.error("[dollar-pixels] unhandled route error", error);
      return err("internal", "Something went wrong.", 500);
    }
  };
}

/** Parse a JSON body, turning a malformed one into a 422 rather than a 500. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError("invalid", "Expected a JSON body.");
  }
}

/**
 * The absolute origin this request arrived on.
 *
 * Payment providers need absolute return URLs and we do not want to require an
 * env var for something the request already knows. Behind Vercel's proxy the
 * forwarded headers are authoritative; `req.url`'s host is not.
 */
export function originOf(req: Request): string {
  const headers = req.headers;
  const forwardedHost = headers.get("x-forwarded-host");
  const forwardedProto = headers.get("x-forwarded-proto");
  if (forwardedHost) {
    return `${forwardedProto ?? "https"}://${forwardedHost}`;
  }
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}
