import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * No `server-only` alias here (unlike the sibling `youtube` project) — this
 * project has no server/DB layer for it to guard. If one is added later,
 * alias it the same way `youtube/vitest.config.mts` does, resolving the path
 * with `fileURLToPath(new URL(..., import.meta.url))` rather than
 * `URL.pathname` — this repo's path contains a space (`Personal Projects`,
 * and `FL Studio` itself), and `.pathname` percent-encodes it, silently
 * resolving to nothing.
 */
export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
