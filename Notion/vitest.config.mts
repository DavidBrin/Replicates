import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * `server-only` exists to make importing a server module from a client
 * component a build error. That is correct in Next's bundler and useless in
 * Vitest — persistence and other server modules import it, so their suites
 * would fail at module load. Aliasing it to an empty module keeps the guard
 * where it matters.
 *
 * `fileURLToPath`, not `URL.pathname`: this repository lives under a directory
 * with a space in its name, and `.pathname` hands back a percent-encoded path.
 */
const serverOnlyStub = fileURLToPath(
  new URL("./src/test-support/server-only-stub.ts", import.meta.url),
);

export default defineConfig({
  plugins: [react()],
  // Vite resolves the `@/*` alias from tsconfig natively; no path plugin needed.
  resolve: {
    tsconfigPaths: true,
    alias: { "server-only": serverOnlyStub },
  },
  test: {
    environment: "jsdom",
    // jsdom refuses localStorage on an opaque origin (the default
    // "about:blank"), which would make the storage adapters untestable.
    environmentOptions: { jsdom: { url: "http://localhost:3000" } },
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
