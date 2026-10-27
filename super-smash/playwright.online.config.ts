import { defineConfig, devices } from "@playwright/test";

/**
 * The online suite: two (or three) browser contexts in one room.
 *
 * It needs the Worker, not `next dev` — rooms and /api/ice live there — so it
 * builds the static export and serves it with `wrangler dev`, or, with
 * SMASH_URL set, runs against the deployed site.
 *
 * Chromium hides host ICE candidates behind mDNS names by default; two
 * contexts on one machine connect faster and more reliably with real ones.
 */
const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_URL = process.env.SMASH_URL;
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
        command: `pnpm run build && WRANGLER_SEND_METRICS=false pnpm exec wrangler dev --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 300_000,
      },
});
