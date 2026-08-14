import { expect, type Page } from "@playwright/test";

/**
 * Shared helpers for the e2e suite.
 *
 * Signing in goes through the real form rather than through a forged cookie.
 * A helper that mints a session directly is faster and tests less: every one
 * of these specs depends on the session cookie being set the way the
 * application sets it — `httpOnly`, `sameSite=lax` — and a shortcut that skips
 * that is a shortcut around the thing most likely to break in a deployment.
 */

/** The seeded demo password. See `src/lib/seed.ts`. */
export const DEMO_PASSWORD = "demo1234";

/** The seeded workspace's URL key. */
export const WORKSPACE = "demo";

export async function signIn(
  page: Page,
  email: string,
  password: string = DEMO_PASSWORD,
): Promise<void> {
  await page.goto("/signin");
  await page.getByTestId("signin-email").fill(email);
  await page.getByTestId("signin-password").fill(password);
  await page.getByTestId("signin-submit").click();

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
