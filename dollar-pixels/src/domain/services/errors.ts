/**
 * One error type for everything the services refuse to do.
 *
 * The code is what the HTTP layer maps to a status and what the client
 * branches on; the message is what a person reads. Keeping both on one object
 * stops the two drifting apart in a dozen route handlers.
 */

export type AppErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "conflict"
  | "unavailable"
  | "payment_failed"
  | "misconfigured"
  | "internal";

const STATUS: Record<AppErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 422,
  conflict: 409,
  unavailable: 409,
  payment_failed: 402,
  misconfigured: 500,
  internal: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly detail: unknown;

  constructor(code: AppErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.detail = detail;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function fail(code: AppErrorCode, message: string, detail?: unknown): never {
  throw new AppError(code, message, detail);
}
