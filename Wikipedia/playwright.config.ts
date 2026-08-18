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
    // No `--` separator: this pnpm version (11.x) forwards it through
    // literally instead of stripping it the way npm does, which makes
    // `next dev` see a literal `--` token and fail to parse `--port`.
    command: `pnpm run dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
