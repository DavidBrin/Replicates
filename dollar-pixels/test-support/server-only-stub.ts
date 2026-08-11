/**
 * Stands in for the `server-only` package under vitest.
 *
 * The real package exists to make a client import fail the build. That is the
 * right behaviour in the build and useless in a unit test, where every module
 * is imported by a test runner that is neither a client nor a server. Aliased
 * in `vitest.config.mts`.
 */
export {};
