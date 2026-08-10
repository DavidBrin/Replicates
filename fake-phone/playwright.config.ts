import { defineConfig, devices } from "@playwright/test";

/**
 * This app is a phone-shaped app, so the *mobile* projects are the real gate and
 * the desktop project only exists to catch layout regressions in the demo shell.
 *
 * `mobile-safari` (WebKit / iPhone 15 viewport) is the closest a CI-able browser
 * gets to the actual target platform; `mobile-chrome` is what runs the tests
 * that need a synthetic camera, because Chromium is the only engine here that
 * can fake a `getUserMedia` stream deterministically.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["html"], ["list"]] : "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 7"],
        permissions: ["camera", "microphone"],
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
      },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 15"] },
    },
    {
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
