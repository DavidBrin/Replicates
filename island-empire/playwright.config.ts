import { defineConfig, devices } from "@playwright/test";

/**
 * The port is configurable, and that is not a nicety: this package is one of
 * several sibling Next apps in the same repository, and a stray `next dev`
 * from one of the others holds :3000 often enough that it has already
 * happened. `PORT` moves both the server and the baseURL together.
 */
const PORT = Number(process.env.PORT ?? 3200);
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
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    /**
     * A production build, not `next dev`: a dev server compiles each route the
     * first time something asks for it, and that cost lands inside whichever
     * assertion is first through a page. `next build` pays it once, up front,
     * and the suite then tests the artifact that actually deploys.
     */
    command: `pnpm run build && pnpm run start -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 600_000,
    env: {
      // Pin PGlite in memory so the suite never touches a real DATABASE_URL
      // and gets a fresh database per run.
      DB_DRIVER: "pglite",
      DB_DATA_DIR: ":memory:",
      // `next start` is NODE_ENV=production and config() refuses PGlite there
      // — rightly, for serverless. This is one process on a real filesystem.
      E2E_ALLOW_PGLITE_PRODUCTION_BUILD: "true",
    },
  },
});
