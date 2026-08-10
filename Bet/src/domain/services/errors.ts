/**
 * A tiny throw helper shared by `trading.ts` / `resolution.ts` (and their
 * route callers), used instead of `src/lib/http.ts`'s `throwApp` so that
 * `src/domain/services/**` never imports from `src/lib` — keeping the
 * import graph domain-pure in spirit (G1's layering test only forbids
 * `next`/`react`/`react-dom` and anything under `src/adapters`/`src/app`
 * for files under `src/domain`, but `lib/http.ts` itself pulls in
 * `next/server`, and there's no reason for a domain service to reach for a
 * Next.js-flavored helper when a five-line local one does the same job).
 *
 * Throws a plain object matching `AppError`'s shape — `src/lib/http.ts`'s
 * `isAppError`/`handler()` recognize it structurally (not via
 * `instanceof`), so this round-trips through the route layer's envelope
 * exactly like `throwApp` would.
 */

import type { AppError, ErrorCode } from "@/domain/result";

export function fail(code: ErrorCode, message: string, fields?: Record<string, string>): never {
  const error: AppError = fields ? { code, message, fields } : { code, message };
  throw error;
}
