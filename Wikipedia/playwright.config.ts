import { defineConfig, devices } from "@playwright/test";

/**
 * The port is configurable, and that is not a nicety.
 *
 * This package is one of several sibling Next apps in the same repository,
 * and a stray `next dev` from one of the others camps on a low port often
 * enough that it has already happened once. Default here is 3211, well away
 * from the siblings' defaults, so a run of this suite can never silently
 * attach to someone else's dev server.
 */
const PORT = Number(process.env.PORT ?? 3211);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    // Desktop-only: this replica's whole product is the desktop Vector 2022
    // chrome comparison, so there is no mobile surface to gate on.
    {
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    /**
     * A production build, not `next dev`.
     *
     * The `/wiki/%25` 500 that `src/proxy.ts` fixes is a production-only
     * regression: Next's dev server doesn't run the same route-matching
     * path (or doesn't crash the same way) that `next start` does after
     * `next build`, so a suite that boots via `next dev` would pass while
     * the deployed artifact 500s. Matching the youtube sibling's config
     * (`../youtube/playwright.config.ts`) so this suite tests what actually
     * ships.
     *
     * No `--` separator: this pnpm version (11.x) forwards it through
     * literally instead of stripping it the way npm does, which makes
     * `pnpm exec next start -- --port` see a literal `--` token and fail to
     * parse `--port` (`next start -- --port 3211` reads `--` as the project
     * directory and exits immediately).
     */
    command: `pnpm run build && pnpm exec next start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 600_000,
  },
});
