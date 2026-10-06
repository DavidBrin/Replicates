/**
 * The one read of `NEXT_PUBLIC_RISK_DEBUG` (SPEC §11's `__riskDebug` hooks,
 * §6's debug-gated `GET /api/games/:id/actions`).
 *
 * `src/config/env.ts` is otherwise the only file in `src/` that touches
 * `process.env`, and this is the single unavoidable exception: `config()` is
 * `server-only`, while this flag has to be readable from a client component
 * that installs `window.__riskDebug`. Next inlines a `NEXT_PUBLIC_*` variable
 * at build time **only** when it appears as a literal member access, so it
 * cannot be read through a helper that takes the name as a string either.
 *
 * Confining it to one tiny module keeps the rule's intent — one place to look,
 * one place to change — and this file is deliberately not `server-only` so
 * both sides can import it.
 */

/** Is the debug surface installed? Pinned to `"1"` by `playwright.config.ts`. */
export function riskDebugEnabled(): boolean {
  return process.env.NEXT_PUBLIC_RISK_DEBUG === "1";
}
