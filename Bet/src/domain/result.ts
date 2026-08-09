/**
 * Generic result type for domain/service operations that can fail in an
 * expected, typed way. Pure — no exceptions in the happy path of consumers
 * that choose to use it (they still may throw for programmer errors, e.g.
 * invalid construction in `money.ts`).
 */

export type ErrorCode =
  | "not_found"
  | "forbidden"
  | "validation"
  | "conflict"
  | "insufficient_balance"
  | "market_closed"
  | "rate_limited"
  | "internal";

export type AppError = {
  code: ErrorCode;
  message: string;
  fields?: Record<string, string>;
};

export type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T, E = AppError>(value: T): Result<T, E> {
  return { ok: true, value };
}

export function err<T = never, E = AppError>(error: E): Result<T, E> {
  return { ok: false, error };
}

export function isOk<T, E>(
  result: Result<T, E>,
): result is { ok: true; value: T } {
  return result.ok === true;
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
