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
    /**
     * A production build, not `next dev` — and this suite is the reason.
     *
     * `next dev` compiles a route the first time something asks for it. That
     * cost lands *inside* whichever assertion happens to be first through a
     * given page, so a spec fails with `getByTestId('sidebar')` not found
     * while the truth is that the route was still being built. It presents as
     * a product bug and moves around between runs: the same suite failed at
     * test 6 on one cold start and test 11 on the next, and passed 14/14
     * against a server that happened to be warm. That is the worst kind of
     * red — one that indicts the application for something the harness did.
     *
     * `next build` pays the whole cost once, before any test runs, and
     * `next start` then serves routes that are already compiled. The suite
     * also stops testing a development bundle and starts testing the artifact
     * that actually deploys, which is the thing the assertions are supposed to
     * be about.
     *
     * `reuseExistingServer` still lets a developer point the suite at a dev
     * server they already have running — the flake is a cold-start property,
     * and a warm server does not have it.
     */
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    // The build is inside this budget now, so it buys minutes rather than the
    // seconds a dev server needed to boot.
    timeout: 600_000,
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
      /**
       * In memory, so the suite really does get a fresh database per run.
       *
       * This was `.data/e2e`, described as "a scratch database per run" — and
       * it was scratch, but it was the *same* scratch directory every time.
       * `seedDemoWorkspace` writes nothing when the workspace already exists,
       * so once that directory had been seeded, every later change to the seed
       * was invisible to this suite: new fixtures simply never appeared, and
       * the specs that needed them failed as though the feature were broken.
       * The DAG specs found it, because they were the first to need seed data
       * that had not existed before.
       *
       * A directory that is deleted before each run would work too, and would
       * be one more thing to remember. The suite is one server process and
       * every spec seeds what it needs, so there is nothing to persist.
       */
      DB_DATA_DIR: ":memory:",
      AUTH_SECRET: "e2e-secret-not-for-production-use-only-0123456789",
      SEED_DEMO_DATA: "true",
      /**
       * `next start` is `NODE_ENV=production`, and `config()` refuses PGlite
       * there — rightly, because on Vercel the directory it writes to is
       * discarded when the invocation ends. That reasoning is about serverless,
       * not about `NODE_ENV`, and this suite is the case where the two come
       * apart: a real filesystem, one process, `.data/e2e` intact for the whole
       * run. The opt-in refuses to work on a host that announces itself as
       * Vercel, so it cannot travel from here to a deployment. See
       * `src/config/env.ts`.
       */
      E2E_ALLOW_PGLITE_PRODUCTION_BUILD: "true",
    },
  },
});
