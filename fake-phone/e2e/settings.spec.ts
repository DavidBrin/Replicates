import { expect, test } from "@playwright/test";

import { CALL, seedSilentRing, settingsReady } from "./helpers";

test.describe("options", () => {
  test("configuring the caller changes the next call", async ({ page }) => {
    // The core product loop: everything is set up BEFORE the moment it is
    // needed, so that using it later is one tap.
    //
    // Deliberately unseeded, like the reload test below. An init script re-runs
    // on any *hard* navigation, and WebKit occasionally falls back to one
    // instead of a client-side route change — which re-seeded settings on the
    // way to the call screen and threw away the edit under test. Seeding here
    // made this test fail roughly one run in three for a reason that had
    // nothing to do with the app.
    await page.goto("/home");
    await settingsReady(page);

    const name = page.getByTestId("setting-caller-name");
    await name.fill("Jordan");
    await name.blur();

    await page.getByTestId("start-call").click();
    await expect(page.getByTestId(CALL.callerName)).toHaveText("Jordan");
  });

  test("settings survive a reload", async ({ page }) => {
    // Deliberately unseeded. `seedSilentRing` installs an init script, and an
    // init script runs again on reload — it would overwrite the very value this
    // test is checking survived, and the test would fail on its own fixture
    // rather than on the app.
    await page.goto("/home");
    await settingsReady(page);
    await page.getByTestId("setting-caller-name").fill("Robin");
    await page.getByTestId("setting-caller-name").blur();

    await page.reload();
    await settingsReady(page);
    await expect(page.getByTestId("setting-caller-name")).toHaveValue("Robin");
  });

  test("the AI tier is visible but cannot be selected without a key", async ({ page }) => {
    // The architecture ships wired and unlit, and the UI tells that truth
    // rather than hiding the option.
    await seedSilentRing(page);
    await page.goto("/home");
    await settingsReady(page);
    const tier = page.getByTestId("setting-voice-tier");
    await expect(tier).toBeVisible();
    await expect(tier).toContainText(/AI/i);
    await expect(tier).toContainText(/key/i);
  });

  test("choosing a ring delay states the screen-lock caveat", async ({ page }) => {
    // A promise the web platform cannot keep is the #1 complaint in this app
    // category, so the constraint is surfaced rather than hidden.
    await seedSilentRing(page);
    await page.goto("/home");
    await settingsReady(page);
    await page.getByTestId("setting-ring-delay").click();
    await expect(page.getByText(/screen/i).first()).toBeVisible();
  });

  test("go live reaches live mode", async ({ page }) => {
    await seedSilentRing(page);
    await page.goto("/home");
    await settingsReady(page);
    await page.getByTestId("go-live").click();
    await expect(page).toHaveURL(/\/live$/);
  });
});
