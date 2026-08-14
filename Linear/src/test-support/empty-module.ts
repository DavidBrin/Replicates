/**
 * Stands in for `server-only` under Vitest.
 *
 * See the alias in `vitest.config.mts`: the real package throws on import so
 * that pulling a server module into a client component is a build error. That
 * guard belongs in the bundler, not in the test runner, where it would break
 * every repository and adapter suite at module load.
 */
export {};
