import { defineConfig, devices } from "@playwright/test";

/**
 * The port is configurable, and that is not a nicety.
 *
 * This package is one of several sibling Next apps in the same repository,
 * and a stray `next dev` from one of the others holds :3000 often enough
 * that it has already happened (see `youtube/playwright.config.ts`). With a
 * fixed port and `reuseExistingServer`, Playwright would cheerfully attach
 * to *that* server and run this suite against a different application.
 * Setting `PORT` moves both the server and the baseURL together. Uses a
 * different default port than `youtube` (3400) to avoid colliding with it
 * if both dev servers happen to be up at once.
 */
const PORT = Number(process.env.PORT ?? 3401);
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
    viewport: { width: 1440, height: 900 },
    /**
     * Real codecs, not the stubbed ones — and the autoplay override lets
     * `AudioContext`/`<audio>` playback assertions run without a user
     * gesture, which no headless run has. Copied verbatim from
     * `youtube/playwright.config.ts`; see `research/07-stack-deployment.md`
     * (Lane 7) §2 for why this carries over to a Web Audio project.
     *
     * `--disable-audio-output` keeps Chromium off the real CoreAudio device.
     * Confirmed by direct instrumentation (not guessed): after a couple of
     * earlier specs boot and tear down a real `AudioContext` — `beat-loop`
     * presses Play/Space, nothing else in the suite touches audio — a later
     * spec's context reports `state: "running"` but its `currentTime` is
     * frozen at the first render quantum; `Tone.Transport.ticks` (driven by
     * that clock) never leaves 0, so `playlist.spec.ts`'s song-mode playhead
     * assertion times out. Waiting longer doesn't help (tried up to 60s) and
     * neither does a stop/replay retry — the render thread itself has
     * stopped pulling samples, which is real-device contention across
     * sequential pages in one Chromium process, not a slow boot and not a
     * product bug (the engine already resumes the context on every Play).
     * This switch routes Web Audio through Chromium's fake output stream
     * instead, which self-clocks in software and doesn't compete for the
     * host's audio device.
     */
    launchOptions: {
      args: ["--autoplay-policy=no-user-gesture-required", "--disable-audio-output"],
    },
  },
  projects: [
    {
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    // A production build, not `next dev` — see `youtube/playwright.config.ts`
    // for why (route-compile latency inside the first assertion).
    command: `pnpm run build && pnpm exec next start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 600_000,
  },
});
