/**
 * The domain never calls `nanoid()` (or any id generator) directly — every
 * new id goes through an `IdGen`, so tests can supply deterministic,
 * predictable ids instead of random ones.
 */
export interface IdGen {
  /** Generates a fresh unique id, prefixed for readability/debuggability
   * (e.g. `next("usr")` -> `"usr_..."`). The prefix is not parsed back out
   * by anything — it's purely a debugging aid. */
  next(prefix: string): string;
}
