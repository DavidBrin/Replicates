import { test, expect } from "@playwright/test";

/**
 * SPEC.md §3: every unset "Website" row is a red-link stub
 * (`src/components/wiki/ExternalLink.tsx`, class `new external-link`,
 * `title="the project is not deployed yet"`) that routes to the shared
 * "page does not exist" screen (`src/app/wiki/[slug]/NoArticle.tsx`).
 */
test.describe("stub links", () => {
  test("a project's Website red-link carries the red-link styling class", async ({ page }) => {
    await page.goto("/wiki/Linear_(replica)");

    const infobox = page.locator("table.infobox");
    const websiteRow = infobox.locator("tr", { has: page.getByRole("rowheader", { name: "Website" }) });
    const stubLink = websiteRow.getByRole("link");

    await expect(stubLink).toHaveClass(/\bnew\b/);
    await expect(stubLink).toHaveClass(/external-link/);
    await expect(stubLink).toHaveAttribute("title", "the project is not deployed yet");
  });

  test("navigating a Website stub lands on the page-does-not-exist screen, which links home", async ({
    page,
  }) => {
    await page.goto("/wiki/Linear_(replica)");

    const infobox = page.locator("table.infobox");
    const websiteRow = infobox.locator("tr", { has: page.getByRole("rowheader", { name: "Website" }) });
    await websiteRow.getByRole("link").click();

    await expect(page).toHaveURL(/\/wiki\/Website_not_yet_deployed$/);
    await expect(page.locator("#noarticletext")).toBeVisible();
    await expect(page.locator("#noarticletext")).toContainText(
      "This page is not deployed yet or does not exist.",
    );

    await page.locator("#noarticletext").getByRole("link", { name: "Main page" }).click();
    await expect(page.locator("h1#firstHeading")).toHaveText("David's Internet");
  });

  // finding 4: the stub target genuinely doesn't exist, so a *hard*
  // navigation to it must carry a real HTTP 404 — not the soft 200 the
  // inline `<NoArticle />` render used to give. (Client-side `<Link>`
  // transitions, exercised above, don't surface a document-level status the
  // way a fresh navigation does, so that's checked here instead.)
  test("an unregistered /wiki/ slug returns HTTP 404 directly", async ({ page }) => {
    const response = await page.goto("/wiki/This_Article_Does_Not_Exist");
    expect(response?.status()).toBe(404);
    await expect(page.locator("#noarticletext")).toBeVisible();

    const stubResponse = await page.goto("/wiki/Website_not_yet_deployed");
    expect(stubResponse?.status()).toBe(404);
    await expect(page.locator("#noarticletext")).toBeVisible();
  });

  // finding 1: a plain object map's `in`/bracket-indexing resolves
  // inherited `Object.prototype` properties too, so these slugs used to
  // pass `articleExists` and crash the route instead of 404ing.
  test("a prototype-key slug (__proto__, constructor) is treated as missing, not a server error", async ({
    page,
  }) => {
    for (const slug of ["__proto__", "constructor", "toString"]) {
      const response = await page.goto(`/wiki/${slug}`);
      expect(response?.status(), `/wiki/${slug} should 404, not crash`).toBe(404);
      await expect(page.locator("#noarticletext")).toBeVisible();
    }
  });

  // finding 2: registry.ts and NoArticle.tsx used to `decodeURIComponent`
  // a param Next had already decoded, throwing a `URIError` on a slug like
  // "%" that isn't itself valid percent-encoding. That app-code double
  // decode is fixed (see src/lib/__tests__/registry.test.ts's `safeDecode`
  // suite and NoArticle.test.tsx's "falls back to the raw slug..." case).
  //
  // A *direct* request for the literal URL `/wiki/%25` still 500s before
  // our route code ever runs, though: verified against `next build && next
  // start` (Next logs its own "failed to decode param" error) that Next
  // 16.3.0's router decodes the path segment a second time internally
  // while matching the dynamic route, independent of anything in this
  // app's route/page code. `src/proxy.ts` (Next 16.3's middleware
  // convention) now catches this ahead of route matching — it tries the
  // same double-decode itself and, on failure, redirects to a slug
  // guaranteed to look up as missing, landing on the shared "page does not
  // exist" screen with a real HTTP 404 instead of a 500. See that file's
  // module comment for why a redirect rather than a rewrite (a rewrite
  // fixes `/wiki/%25` but not an incomplete escape like `/wiki/foo%2`,
  // verified empirically).
  test("a malformed percent-encoded slug redirects to the page-does-not-exist screen with 404, not a 500", async ({
    page,
  }) => {
    const response = await page.goto("/wiki/%25");
    expect(response?.status()).toBe(404);
    await expect(page.locator("#noarticletext")).toBeVisible();

    const incompleteEscape = await page.goto("/wiki/foo%2");
    expect(incompleteEscape?.status()).toBe(404);
    await expect(page.locator("#noarticletext")).toBeVisible();
  });
});
