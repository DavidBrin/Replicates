/**
 * Server startup.
 *
 * Next calls `register()` once, before it serves the first request, which is
 * the only hook in the framework that can promise "this ran before anything
 * queried the database". That promise is what the zero-config claim in
 * `SPEC.md` §2 rests on: a fresh clone has no schema, and PGlite has no
 * provisioning step to hang one off, so something has to apply it.
 *
 * The alternative — calling `ensureReady()` at the top of every route handler
 * and server component — was the shape this started as, and it is a discipline
 * rather than a guarantee: the first handler that forgets does not fail
 * visibly, it fails as `relation "users" does not exist` inside a sign-in
 * attempt, which reads like an auth bug.
 *
 * On a deployment the schema is already applied by `scripts/db-push.ts` from
 * the build command, and `ensureReady` skips migration for the Neon driver
 * entirely — so this costs a deployment nothing beyond one branch.
 */

export async function register(): Promise<void> {
  // Guarded because `register` also runs in the edge runtime, where neither
  // the database drivers nor `node:fs` exist.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { ensureReady } = await import("@/lib/boot");
  await ensureReady();
}
