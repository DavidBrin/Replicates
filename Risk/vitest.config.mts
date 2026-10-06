import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * `server-only` resolves to a file that throws on import outside Next's
 * bundler; the persistence adapters import it, so alias it to an empty module
 * under Vitest. `fileURLToPath`, not `URL.pathname`: this repository lives
 * under a directory with a space in its name.
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
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    css: false,
    // PGlite boots a WASM Postgres per suite; the default 5s is not enough
    // on a cold run, and a flaky timeout here would read as a schema bug.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
