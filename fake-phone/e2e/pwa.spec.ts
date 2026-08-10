import { expect, test } from "@playwright/test";

import { seedSilentRing } from "./helpers";

/**
 * The installable-app surface. These assertions look pedantic, but each one
 * corresponds to a specific way an iPhone stops treating this as an app:
 * a missing `viewport-fit=cover` collapses every safe-area inset to zero, a
 * missing apple-touch-icon gives a screenshot tile on the home screen, and a
 * page that scrolls horizontally reveals a browser under the call screen.
 */
test.describe("installable on a phone", () => {
  test("serves a valid manifest with real icons", async ({ page, request }) => {
    await page.goto("/");

    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(href).toBeTruthy();

    const response = await request.get(href!);
    expect(response.status()).toBe(200);

    const manifest = await response.json();
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    // A maskable icon is what stops Android cropping the mark into a circle
    // badge with white corners.
    expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === "maskable")).toBe(
      true,
    );

    for (const icon of manifest.icons as { src: string }[]) {
      const iconResponse = await request.get(icon.src);
      expect(iconResponse.status(), `${icon.src} must exist`).toBe(200);
      expect(iconResponse.headers()["content-type"]).toContain("image/png");
    }

    const appleIcon = await request.get("/icons/apple-touch-icon.png");
    expect(appleIcon.status()).toBe(200);
  });

  test("declares the iOS web-app meta tags", async ({ page }) => {
    await page.goto("/");

    const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
    // Without this, env(safe-area-inset-*) resolves to 0 and the call screen
    // sits under the notch and the home indicator.
    expect(viewport).toContain("viewport-fit=cover");

    // Both names, deliberately: Safari 17+ reads the unprefixed one (which is
    // what Next emits for `appleWebApp.capable`), everything older reads the
    // Apple-prefixed one.
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
      "content",
      "yes",
    );
    await expect(page.locator('meta[name="mobile-web-app-capable"]').first()).toHaveAttribute(
      "content",
      "yes",
    );
    await expect(
      page.locator('meta[name="apple-mobile-web-app-status-bar-style"]'),
    ).toHaveAttribute("content", "black-translucent");
    // iOS turns anything number-shaped into a tel: link, which on a call
    // screen is an instant tell.
    await expect(page.locator('meta[name="format-detection"]')).toHaveAttribute(
      "content",
      /telephone=no/,
    );
  });

  test("never scrolls horizontally on a phone viewport", async ({ page }) => {
    await seedSilentRing(page);
    for (const path of ["/", "/home", "/live"]) {
      await page.goto(path);
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(overflows, `${path} must not scroll horizontally`).toBe(false);
    }
  });

  test("the app fills the viewport with no page scroll behind it", async ({ page }) => {
    await seedSilentRing(page);
    await page.goto("/");
    const frame = page.locator(".app-frame");
    await expect(frame).toBeVisible();

    const fills = await frame.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return Math.abs(rect.height - window.innerHeight) < 2 && Math.abs(rect.width - window.innerWidth) < 2;
    });
    expect(fills).toBe(true);
  });
});
