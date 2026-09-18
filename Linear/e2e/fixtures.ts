import { expect, type Page } from "@playwright/test";

/**
 * Shared helpers for the e2e suite.
 *
 * Signing in goes through the real UI rather than through a forged cookie. A
 * helper that mints a session directly is faster and tests less: every one of
 * these specs depends on the session cookie being set the way the application
 * sets it — `httpOnly`, `sameSite=lax` — and a shortcut that skips that is a
 * shortcut around the thing most likely to break in a deployment.
 *
 * `/signin` is now a demo-account chooser (the typable email/password form is
 * archived — see `src/components/auth/demo-sign-in.tsx`), so this clicks the
 * seeded account's one-click button. Every account uses the same seeded
 * password, filled by the button, so the session is set exactly as it is for a
 * real visitor.
 */

/** The seeded demo password. See `src/lib/seed.ts`. */
export const DEMO_PASSWORD = "demo1234";

/** The seeded workspace's URL key. */
export const WORKSPACE = "demo";

/**
 * Sign in as a seeded demo account by clicking its button.
 *
 * `email` is one of the four seeded addresses (`owner@`, `admin@`, `member@`,
 * `guest@demo.test`); the local-part is the button's id suffix
 * (`demo-signin-owner`, …), which is how the chooser labels them.
 */
export async function signIn(page: Page, email: string): Promise<void> {
  const label = email.split("@")[0];
  await page.goto("/signin");
  await page.getByTestId(`demo-signin-${label}`).click();

  // Landing on the app shell is the signal that the session took. Asserting on
  // it here means a broken sign-in fails in the helper, naming the cause,
  // rather than fifteen lines later as a mysteriously absent issue list.
  await expect(page.getByTestId("sidebar")).toBeVisible({ timeout: 15_000 });
}

/**
 * Sign out through the API, then land somewhere unauthenticated.
 *
 * `POST`, not a navigation: sign-out is a state change, and the route is
 * POST-only for the ordinary reason — a GET that destroys a session can be
 * triggered by any image tag pointed at it. Navigating to it instead returns a
 * 405 and leaves the cookie in place, which then reads as "the next sign-in
 * silently reused the previous user".
 */
export async function signOut(page: Page): Promise<void> {
  const response = await page.request.post("/api/auth/signout");
  if (!response.ok()) {
    throw new Error(`Sign-out failed: ${response.status()}`);
  }
  // The cookie jar is shared between `page.request` and the page, so the
  // session is gone; land on a public route so the next `signIn` starts clean.
  await page.goto("/signin");
}

/**
 * Open the command palette and run a command by its visible label.
 *
 * The palette is the app's other primary navigation surface, so several specs
 * drive it; keeping the keystroke in one place means a change to the binding
 * is a one-line edit rather than a sweep.
 */
export async function runCommand(page: Page, label: string): Promise<void> {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await page.getByTestId("command-palette-input").fill(label);
  await page.keyboard.press("Enter");
}
