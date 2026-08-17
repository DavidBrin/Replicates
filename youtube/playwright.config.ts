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
const PORT = Number(process.env.PORT ?? 3400);
const BASE_URL = `http://localhost:${PORT}`;

/**
 * The desktop width the layout research measured at.
 *
 * Named because it has to be applied per project rather than once in `use` —
 * see the note on `desktop-chrome`.
 */
const DESKTOP_VIEWPORT = { width: 1440, height: 900 } as const;

export default defineConfig({
  testDir: "./e2e",

  /**
   * Serial, single worker, and a database of its own.
   *
   * Specs upload videos, subscribe to channels and post comments against one
   * shared library, and the recommender specs assert on exact co-visitation
   * orderings that another spec's watch event would perturb. Parallel workers
   * against one database would make each suite's writes visible to the others.
   */
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    viewport: { width: 1440, height: 900 },
    /**
     * Real codecs, not the stubbed ones.
     *
     * Playwright's bundled Chromium ships without the proprietary codecs by
     * default, which for this project is not a detail — it is the entire
     * upload path. `--use-fake-device-for-media-stream` keeps camera prompts
     * out of the way; the autoplay override lets the player's autoplay
     * assertions run without a user gesture, which no headless run has.
     */
    launchOptions: {
      args: [
        "--autoplay-policy=no-user-gesture-required",
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
    },
  },
  projects: [
    /**
     * The viewport comes *after* the device descriptor.
     *
     * `use.viewport` at the top level is overridden by every `devices[…]`
     * spread, because a descriptor carries its own — Desktop Chrome's is
     * 1280×720. So the 1440×900 configured above applied to nothing, and the
     * desktop project ran at a width the research never measured. Restated
     * here, after the spread, where it wins.
     */
    {
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"], viewport: DESKTOP_VIEWPORT },
    },

    /**
     * Shorts is a different application wearing the same library: a vertical
     * player, swipe navigation, muted autoplay and a right-hand action rail
     * that only exists at this aspect ratio.
     */
    {
      name: "mobile-chrome",
      testMatch: /shorts|mobile/,
      use: { ...devices["Pixel 7"] },
    },

    /**
     * The no-WebCodecs upload path, which is the one that rots.
     *
     * Roughly one browser in twenty cannot encode in the page — Firefox on
     * Android, older Safari — and falls back to uploading the source file
     * untouched, to be served as a single progressive rendition over HTTP
     * `Range`. That is a second, structurally different upload path and a
     * second, structurally different playback path, and nothing in a normal
     * run ever exercises either.
     *
     * Rather than chase a real browser that lacks the API, this project
     * removes it: an init script deletes the WebCodecs constructors before any
     * page script runs, so feature detection genuinely fails and the app takes
     * the fallback in earnest.
     *
     * The deletion lives in `e2e/support/no-webcodecs.ts`, which the fallback
     * specs import as a fixture. It cannot be configured here: `addInitScript`
     * is a method on a context or page, and a project's `use` block has no
     * hook for one. The config previously named an `e2e/fallback.setup.ts`
     * that did not exist and was not referenced by any `dependencies` entry
     * either — so even once specs were written, the project would have run
     * them against a browser that still had WebCodecs and quietly tested the
     * ordinary path twice.
     */
    {
      name: "no-webcodecs",
      testMatch: /fallback/,
      use: { ...devices["Desktop Chrome"], viewport: DESKTOP_VIEWPORT },
    },
  ],
  webServer: {
    /**
     * A production build, not `next dev`.
     *
     * `next dev` compiles a route the first time something asks for it, and
     * that cost lands *inside* whichever assertion is first through a given
     * page — so a spec fails on a missing element while the truth is that the
     * route was still being built. It presents as a product bug and it moves
     * around between runs. `next build` pays the cost once, and the suite then
     * tests the artifact that actually deploys.
     */
    /**
     * `pnpm exec next start`, not `pnpm run start -- --port`.
     *
     * pnpm forwards the `--` to the script rather than consuming it, so the
     * command that actually ran was `next start -- --port 3400`, and Next read
     * `--` as the project directory:
     *
     *     Invalid project directory provided, no such directory: …/youtube/--
     *
     * The server therefore exited immediately and Playwright waited out its
     * ten-minute timeout every run. Nothing caught it because `e2e/` was empty
     * — a suite with no specs never starts its web server — so the config was
     * broken for as long as it has existed and the first person to write a
     * spec would have inherited it.
     */
    command: `pnpm run build && pnpm exec next start --port ${PORT}`,
    url: BASE_URL,
    /**
     * Never reuse. The comment at the top of this file explains that a stray
     * `next dev` from a sibling project holding a port has already happened
     * here — and `reuseExistingServer` is exactly the setting that would let
     * Playwright attach to it, run this suite against a different application,
     * and leave it running afterwards. A configurable `PORT` reduces the
     * chance of a collision; only this makes attaching to the wrong thing
     * impossible.
     */
    reuseExistingServer: false,
    timeout: 600_000,
    env: {
      /**
       * Pin PGlite explicitly rather than letting the driver be inferred.
       * `config()` picks Neon whenever `DATABASE_URL` is set, which is right
       * for a deployment and wrong here: a developer with a real connection
       * string exported would have this suite seed a demo library into it.
       */
      DB_DRIVER: "pglite",
      DB_DATA_DIR: ":memory:",
      /**
       * The blob store gets a scratch directory per run rather than an
       * in-memory adapter, because HTTP `Range` serving off the filesystem is
       * itself under test and an in-memory adapter would not exercise it.
       */
      BLOB_DRIVER: "filesystem",
      BLOB_FS_ROOT: ".data/e2e-blobs",
      AUTH_SECRET: "e2e-secret-not-for-production-use-only-0123456789",
      SEED_DEMO_DATA: "true",
      E2E_ALLOW_PGLITE_PRODUCTION_BUILD: "true",
    },
  },
});
