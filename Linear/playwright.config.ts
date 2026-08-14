import { defineConfig, devices } from "@playwright/test";

/**
 * The port is configurable, and that is not a nicety.
 *
 * This package is one of several sibling Next apps in the same repository, and
 * a stray `next dev` from one of the others holds :3000 often enough that it
 * has already happened. With a fixed port and `reuseExistingServer`, Playwright
 * would cheerfully attach to *that* server and run this suite against a
 * different application — green or red, the result would be meaningless.
 * Setting `PORT` moves both the server and the baseURL together.
 */
const PORT = Number(process.env.PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",

  /**
   * Serial, single worker, and a database of its own.
   *
   * Every spec signs in, mutates a shared workspace and asserts on lists that
   * other specs also write to. Running them in parallel against one database
   * would make each suite's fixtures visible to the others — the multi-user
   * permission specs in particular assert on exact member counts, and one is a
   * sequence where a removal in step four must still be gone in step five.
   */
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    // Linear is a three-pane desktop application. Below ~1024px the app
    // collapses the sidebar, which is a different set of assertions; the
    // responsive behaviour has its own project.
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      /**
       * Pin PGlite explicitly rather than letting the driver be inferred.
       *
       * `config()` picks Neon whenever `DATABASE_URL` is set, which is the
       * right default for a deployment and the wrong one here: a developer who
       * happens to have a real connection string exported would have this
       * suite seed a demo workspace into it and then assert on member removal.
       * Naming the driver makes that impossible.
       */
      DB_DRIVER: "pglite",
      // A scratch database per run, separate from the dev server's `.data/linear`.
      DB_DATA_DIR: ".data/e2e",
      AUTH_SECRET: "e2e-secret-not-for-production-use-only-0123456789",
      SEED_DEMO_DATA: "true",
    },
  },
});
