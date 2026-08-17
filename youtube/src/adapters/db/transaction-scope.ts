import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Telling a **nested** transaction apart from a **concurrent** one.
 *
 * Both adapters refuse to nest, and they are right to: PGlite has one
 * connection whose queue would deadlock, and Neon takes a fresh pooled
 * connection and opens a genuinely independent transaction that can commit
 * while the outer one rolls back. That refusal is `DECISIONS.md`'s and it
 * stands.
 *
 * What both got wrong is *how they detected it*. Each held a boolean on the
 * adapter instance:
 *
 * ```ts
 * #inTransaction = false;               // one flag, one process-wide handle
 * ```
 *
 * `database()` is memoised on `globalThis`, so that one flag is shared by every
 * request the server is handling. It does not mean "this call chain is inside a
 * transaction". It means **"somebody, somewhere, is"** — so two unrelated
 * viewers whose requests overlap by a millisecond are diagnosed as a nested
 * transaction, and the second one is refused with an error explaining a
 * programming mistake nobody made.
 *
 * That was survivable while transactions were rare. `POST /api/watch` made it
 * ordinary traffic: the reporter posts every five seconds per viewer, and
 * crossing the view threshold opens a transaction. Two viewers finishing a
 * video at the same moment is not an edge case, it is a Tuesday.
 *
 * ## Why `AsyncLocalStorage`
 *
 * The question the guard has to answer is "is *this* asynchronous call chain
 * already inside a transaction", and a value scoped to an async chain is
 * exactly what `AsyncLocalStorage` provides. `run()` makes the flag visible to
 * everything the callback awaits, including through promise chains and timers,
 * and invisible to anything running beside it. So:
 *
 *   - a repository handed the outer `SqlDatabase` and opening its own
 *     transaction inside the callback still sees the flag and is still refused,
 *     which is the whole reason the guard exists;
 *   - two requests running concurrently each see their own absent flag, and
 *     both proceed.
 *
 * It is a Node built-in with no dependency and no measurable cost here — one
 * store lookup per `transaction()` call, against a statement that is about to
 * touch a database.
 *
 * Shared by both adapters rather than written twice, because "the two adapters
 * must agree" is this project's rule about ports, and a guard that differed
 * between development and production would be a divergence in the one place
 * that decides whether a request succeeds.
 */

const scope = new AsyncLocalStorage<true>();

/** Is the current call chain already inside a transaction on this handle? */
export function inTransactionScope(): boolean {
  return scope.getStore() === true;
}

/**
 * Run `fn` marked as inside a transaction.
 *
 * The mark is unwound by `AsyncLocalStorage` when the callback settles, so
 * there is no `finally` to forget and no way for a thrown error to leave the
 * flag set — which was the other hazard of the boolean: an adapter that threw
 * between setting and clearing would refuse every transaction for the rest of
 * the process's life.
 */
export function runInTransactionScope<T>(fn: () => Promise<T>): Promise<T> {
  return scope.run(true, fn);
}

/** The message both adapters raise. Identical wording, one definition. */
export function nestedTransactionError(engine: "PGlite" | "Neon"): Error {
  const why =
    engine === "PGlite"
      ? "PGlite has a single connection, so the inner call would wait for a " +
        "queue slot the outer call is holding."
      : "Neon would take a second pooled connection, so the inner call would " +
        "be a genuinely independent transaction that can commit while the " +
        "outer one rolls back.";
  return new Error(
    `Nested transaction: this call chain already has one open. ${why} Pass the ` +
      "`SqlExecutor` the outer transaction gave you down to the inner function " +
      "instead.",
  );
}
