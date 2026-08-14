import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * `server-only` exists to make importing a server module from a client
 * component a build error, which it does by resolving to a file that throws on
 * import. That is correct in Next's bundler and useless in Vitest — the
 * repositories and database adapters all import it, so every one of their
 * suites would fail at module load. Aliasing it to an empty module keeps the
 * guard where it matters and out of the way where it does not.
 *
 * `fileURLToPath`, not `URL.pathname`: this repository lives under a directory
 * with a space in its name, and `.pathname` hands back a percent-encoded path
 * that resolves to nothing. The alias then falls through silently and the
 * error blames the missing package instead of the bad path.
 */
const serverOnlyStub = fileURLToPath(
  new URL("./src/test-support/empty-module.ts", import.meta.url),
);

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    alias: { "server-only": serverOnlyStub },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    // PGlite boots a WASM Postgres per suite, and the default 5s is not enough
    // on a cold run. A flaky timeout here would read as a schema bug.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
