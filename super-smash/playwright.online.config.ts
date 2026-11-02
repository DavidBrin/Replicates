import { defineConfig, devices } from "@playwright/test";

/**
 * The online suite: two (or three) browser contexts in one room.
 *
 * It needs the Worker, not `next dev` — rooms and /api/ice live there — so it
 * builds the static export and serves it with wrangler's dev server
 * (`scripts/e2e/wrangler-e2e.mjs`), or, with SMASH_URL set, runs against the
 * deployed site.
 *
 * Chromium hides host ICE candidates behind mDNS names by default; two
 * contexts on one machine connect faster and more reliably with real ones.
 */
const PORT = Number(process.env.PORT ?? 8787);
// `||`, not `??`: an empty SMASH_URL means unset, not a base URL of "".
const PUBLIC_URL = process.env.SMASH_URL || undefined;
const BASE_URL = PUBLIC_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e-online",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 180_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: "desktop-chrome",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] },
      },
    },
  ],
  webServer: PUBLIC_URL
    ? undefined
    : {
        // Builds, then serves out/ and the Worker with every watcher off, and says E2E-READY
        // once it serves (Plan 6, Task 1: `wrangler dev` reloaded on out/'s file events and
        // dropped the room mid-test). No `url`: Playwright races a url against `wait`, and
        // the url would win as soon as wrangler first answered.
        command: `node scripts/e2e/wrangler-e2e.mjs ${PORT}`,
        wait: { stdout: /E2E-READY/ },
        gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
        reuseExistingServer: false,
        timeout: 300_000,
      },
});
