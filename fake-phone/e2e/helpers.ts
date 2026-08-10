import type { Page } from "@playwright/test";

/**
 * Test ids, duplicated from `src/components/call/types.ts`.
 *
 * Deliberately re-declared rather than imported: the e2e suite is a black-box
 * consumer of the built app, and importing app source into it would let a
 * rename in the app silently rename the thing the test is supposed to be
 * pinning down. If these two lists drift, a test fails — which is the point.
 */
export const CALL = {
  screen: "call-screen",
  callerName: "caller-name",
  callerLabel: "caller-label",
  timer: "call-timer",
  subtitle: "call-subtitle",
  answer: "answer-button",
  decline: "decline-button",
  hangUp: "end-call-button",
  mute: "mute-button",
  speaker: "speaker-button",
  keypad: "keypad-button",
} as const;

const STORAGE_KEY = "fake-phone.settings.v1";

/**
 * Seeds settings before the app's first script runs.
 *
 * `addInitScript` rather than navigating and clicking through the settings UI:
 * a call-screen test should fail because the call screen broke, not because a
 * settings toggle moved. The app's `parseSettings` repairs partial input, so a
 * patch of only the fields under test is enough.
 */
export async function seedSettings(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key as string, JSON.stringify(value));
    },
    [STORAGE_KEY, patch] as const,
  );
}

/** Silences the ringtone so a test run does not depend on audio autoplay. */
export async function seedSilentRing(page: Page, patch: Record<string, unknown> = {}): Promise<void> {
  await seedSettings(page, { ringtoneEnabled: false, voiceTier: "silent", ...patch });
}

/**
 * Waits until the settings panel has hydrated and will actually accept input.
 *
 * Without this, a fast driver types into server-rendered inputs that have no
 * React listeners attached yet; the keystrokes reach the DOM, no handler ever
 * sees them, and hydration then wipes them. The app marks that window with
 * `aria-busy` (and makes it `inert`), so waiting on the flag is waiting on the
 * real readiness signal rather than on an arbitrary timeout.
 */
export async function settingsReady(page: Page): Promise<void> {
  await page.getByTestId("settings-panel").and(page.locator('[aria-busy="false"]')).waitFor();
}
