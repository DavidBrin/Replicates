import type { Page } from "@playwright/test";

/**
 * Signs in as a seeded demo user through the real UI (`/signin` -> click
 * the user's card -> `POST /api/session` -> redirect to `/app`), the same
 * path a real visitor takes. Deliberately never hits `/api/session`
 * directly with a hardcoded id — seeding is deterministic (same handles
 * every run, per `src/adapters/memory/seed-data/users.ts`) but ids are
 * regenerated per server start, so driving the real picker through the DOM
 * is what keeps this suite from rotting if the seed changes shape.
 *
 * `handle` is a stable seed handle (`"dev"`, `"liv"`, `"birdie"`, ...),
 * never a raw user id.
 */
export async function signIn(page: Page, handle: string): Promise<void> {
  await page.goto("/signin");
  await page.locator("button").filter({ hasText: `@${handle}` }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 15_000 });
}

/**
 * Opens the top-bar avatar dropdown (`UserMenu`) — where the current
 * balance and "Sign out" live — and returns once the menu panel is
 * visible.
 */
export async function openUserMenu(page: Page): Promise<void> {
  await page.locator('button[aria-haspopup="menu"]').click();
  await page.getByRole("menu").waitFor({ state: "visible" });
}
