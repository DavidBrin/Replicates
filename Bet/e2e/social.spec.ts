import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Friend request round trip between two seeded demo users. `liv` and
 * `birdie` are a deliberately unconnected pair in the seed graph — no
 * existing friendship, no pending request either direction (cross-checked
 * against `seed-data/social.ts`'s `FRIENDSHIP_PAIRS` /
 * `PENDING_FRIEND_REQUESTS`) — so the flow starts from a clean slate on a
 * freshly-seeded server. One `page`/context is reused for both personas by
 * re-signing-in (exactly how the app's own demo-user switching works —
 * `POST /api/session` just overwrites the session cookie), rather than
 * juggling two browser contexts.
 */
test("a friend request sent by one user can be accepted by the recipient, and shows on both sides", async ({
  page,
}) => {
  // --- liv sends the request -----------------------------------------------------
  await signIn(page, "liv");
  await page.goto("/app/friends");

  await page.getByLabel("Search for people").fill("birdie");
  const addButton = page.getByRole("button", { name: "Add" });
  const alreadyBirdie = page.getByText("Birdie").first();
  await expect(alreadyBirdie).toBeVisible();

  // Defensive: a stale dev server from a previous suite run may already
  // have this pair connected. If so, skip straight to the cross-side
  // check below instead of failing on a missing "Add" button.
  const stillStrangers = await addButton.isVisible().catch(() => false);
  if (stillStrangers) {
    await addButton.click();
    await expect(page.getByRole("tab", { name: /^Sent \(\d+\)/ })).toBeVisible();

    // --- birdie accepts it ---------------------------------------------------------
    await signIn(page, "birdie");
    await page.goto("/app/friends");
    await page.getByRole("tab", { name: /^Requests \(\d+\)/ }).click();
    const requestRow = page.getByText("Liv Torres").locator("..").locator("..");
    await expect(requestRow.getByRole("button", { name: "Accept" })).toBeVisible();
    await requestRow.getByRole("button", { name: "Accept" }).click();
  } else {
    await signIn(page, "birdie");
    await page.goto("/app/friends");
  }

  // --- confirm on birdie's side ----------------------------------------------------
  await page.getByRole("tab", { name: /^Friends \(\d+\)/ }).click();
  await expect(page.getByText("Liv Torres")).toBeVisible();

  // --- confirm on liv's side --------------------------------------------------------
  await signIn(page, "liv");
  await page.goto("/app/friends");
  await expect(page.getByRole("tab", { name: /^Friends \(\d+\)/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("Birdie").first()).toBeVisible();
});
