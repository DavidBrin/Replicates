import { defineConfig, devices } from "@playwright/test";

/**
 * The port is configurable, and that is not a nicety.
 *
 * This package is one of several sibling Next apps in the same repository, and
 * a stray `next dev` from one of the others holds :3000 often enough that it
 * has already happened once. With a fixed port and `reuseExistingServer`,
 * Playwright would cheerfully attach to *that* server and run this suite
 * against a different application — green or red, the result would be
 * meaningless. Setting `PORT` moves both the server and the baseURL together,
 * so the two can never disagree.
 */
const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",

  /**
   * One worker, and not as a workaround.
   *
   * Every test drives one dev server backed by one in-memory store
   * (DECISIONS D13), so the suite shares a single mutable world: the wall, the
   * slug namespace, the seeded claims. Run in parallel and tests reserve each
   * other's blocks and race each other's sign-ins, which produces a *different*
   * failure each run — the worst kind, because it reads as a flaky product
   * rather than a flaky harness. Serial is the honest configuration for shared
   * state, and the whole suite still runs in well under a minute.
   */
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
    // A 1200px grid wants a desktop viewport at 1:1. The narrow-screen
    // downscale path (DECISIONS D7) gets its own project so it is actually
    // exercised rather than assumed to work.
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
