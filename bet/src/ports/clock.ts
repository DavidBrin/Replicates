/**
 * The domain never calls `Date.now()` directly — every "what time is it"
 * question goes through a `Clock`, so tests can supply a deterministic one.
 */
export interface Clock {
  now(): Date;
}
