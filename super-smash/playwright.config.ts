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
   * Desktop only, and only Chromium — this is a two-players-one-keyboard game.
   *
   * The sibling projects run a mobile project too. This one deliberately does
   * not: every control scheme in SPEC §6 is a physical key, a phone has no
   * keys, and a "responsive" pass would be testing a configuration nobody can
   * actually play. The app says so itself on a touch device rather than
   * pretending. Chromium alone because the thing under test is a fixed-step
   * canvas simulation driven by `KeyboardEvent.code`; that surface does not
   * vary meaningfully by engine, and a second browser would triple the suite's
   * runtime to re-prove the same frame counts.
   */
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    // The game renders at a 16:9 internal resolution and letterboxes into
    // whatever it is given. 1280x720 is the smallest viewport that shows the
    // HUD at its intended scale without the letterbox eating the screenshot.
    viewport: { width: 1280, height: 720 },
  },
  projects: [{ name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
