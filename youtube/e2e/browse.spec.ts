import {
  FIXTURE,
  expect,
  gotoAndSettle,
  masthead,
  signIn,
  test,
} from "./support/fixtures";

/**
 * The routes a visitor actually walks, against a production build.
 *
 * These are the assertions unit tests structurally cannot make. Every one of
 * the five client-boundary bugs this project shipped passed the whole unit
 * suite, because a unit test imports a module directly and never crosses the
 * server/client boundary; four of them also survived a route probe, because a
 * `<Suspense>` fallback swallowed the error in development. One survived a
 * probe against a production build and only failed once the database had rows.
 *
 * So the shape that catches that class of bug is exactly this: a production
 * build, a populated database, and an assertion on rendered content rather
 * than on a status code.
 */

test.describe("the home feed", () => {
  test("renders cards from the seeded corpus", async ({ page }) => {
    await gotoAndSettle(page, "/");

    // Content, not a 200. An empty feed also returns 200, and an empty feed is
    // precisely the state in which the `chipsForFeed` boundary bug hid.
    await expect(page.getByText(FIXTURE.videos.river.title)).toBeVisible();
    await expect(page.getByText(FIXTURE.videos.cables.title)).toBeVisible();
  });

  test("has no console errors on first paint", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await gotoAndSettle(page, "/");

    // "Attempted to call X from the server" arrives here and nowhere else.
    expect(errors).toEqual([]);
  });

  test("filters the grid by chip", async ({ page }) => {
    await gotoAndSettle(page, "/");

    const chip = page.getByRole("tab", { name: FIXTURE.channels.patchbay.name });
    await chip.click();

    await expect(page.getByText(FIXTURE.videos.cables.title)).toBeVisible();
    await expect(page.getByText(FIXTURE.videos.river.title)).toHaveCount(0);
  });
});

test.describe("navigation", () => {
  /**
   * Every internal link in this app was a raw `<a>` until recently, which made
   * each navigation a full document load: no client-side routing, no prefetch,
   * and a watch page that tore down and rebuilt its player on every hop. The
   * assertion is that the document is *not* replaced.
   */
  test("moves between routes without reloading the document", async ({ page }) => {
    await gotoAndSettle(page, "/");

    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__stillTheSameDocument = true;
    });

    await page.getByText(FIXTURE.videos.river.title).first().click();
    await page.waitForURL(/\/watch/);

    const survived = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__stillTheSameDocument,
    );
    expect(survived).toBe(true);
  });

  test("opens a channel from its @handle", async ({ page }) => {
    // The route that 404'd silently: Next does not match a leading `@` in a
    // URL to a dynamic segment, and the page component never ran.
    await gotoAndSettle(page, `/@${FIXTURE.channels.fieldnotes.handle}`);
    await expect(
      page.getByRole("heading", { name: FIXTURE.channels.fieldnotes.name }),
    ).toBeVisible();
  });

  test("serves the channel's tab routes too", async ({ page }) => {
    // `video-grid.tsx` fell back to its default href builders only here, which
    // is why this route alone threw while every page file looked clean.
    await gotoAndSettle(page, `/@${FIXTURE.channels.fieldnotes.handle}/videos`);
    await expect(page.getByText(FIXTURE.videos.river.title)).toBeVisible();
  });

  test("404s a handle without its @", async ({ page }) => {
    // The rewrite must not become a second address for the same channel.
    const response = await page.goto(`/${FIXTURE.channels.fieldnotes.handle}`);
    expect(response?.status()).toBe(404);
  });
});

test.describe("the watch page", () => {
  test("shows the video, its channel and its comments", async ({ page }) => {
    await gotoAndSettle(page, `/watch?v=${FIXTURE.videos.river.id}`);

    await expect(
      page.getByRole("heading", { name: FIXTURE.videos.river.title }),
    ).toBeVisible();

    // Scoped to the owner row. A bare `getByText` matches three elements here
    // — the owner, plus the channel link on every sidebar card — and the
    // strict-mode violation that produces is the locator's fault, not the
    // page's.
    await expect(page.locator("[data-owner-name]")).toHaveText(
      FIXTURE.channels.fieldnotes.name,
    );
    await expect(page.getByText(/extraordinary/)).toBeVisible();
  });

  /**
   * The sidebar has to be a *recommendation*, not the popularity backfill.
   *
   * The seeded graph puts three distinct sessions across both Field Notes
   * videos, which is exactly `MIN_COVISIT_WEIGHT`, so the pair clears the
   * floor. If the fixture ever drops to two sessions this fails — which is the
   * point, because the backfill would still fill the sidebar and the surface
   * would look identical.
   */
  test("recommends the co-visited video in the sidebar", async ({ page }) => {
    await gotoAndSettle(page, `/watch?v=${FIXTURE.videos.river.id}`);
    await expect(page.getByText(FIXTURE.videos.quietest.title)).toBeVisible();
  });

  test("carries the masthead, like every other route", async ({ page }) => {
    // The watch page sits outside the `(main)` group because theatre mode
    // rearranges its two columns, and it went without chrome for that reason.
    await gotoAndSettle(page, `/watch?v=${FIXTURE.videos.river.id}`);
    await expect(page.getByRole("link", { name: "YouTube Home" })).toBeVisible();
  });
});

test.describe("search", () => {
  test("finds a video by a word in its title", async ({ page }) => {
    await gotoAndSettle(page, "/results?search_query=river");
    await expect(page.getByText(FIXTURE.videos.river.title)).toBeVisible();
  });

  test("submits from the masthead field", async ({ page }) => {
    await gotoAndSettle(page, "/");
    // `searchbox`, not `combobox`: the field is `<input type="search">`, and
    // it only becomes a combobox when `SearchSuggestions` mounts and writes
    // the type-ahead ARIA onto it.
    await page.getByRole("searchbox", { name: /search/i }).fill("cable");
    await page.keyboard.press("Enter");

    await page.waitForURL(/\/results\?/);
    await expect(page.getByText(FIXTURE.videos.cables.title)).toBeVisible();
  });

  test("says so plainly when nothing matches", async ({ page }) => {
    await gotoAndSettle(page, "/results?search_query=zzzznotathing");
    await expect(page.getByText(/no results/i)).toBeVisible();
  });
});

test.describe("signing in", () => {
  /**
   * The route that did not exist.
   *
   * `verifyCredentials`, `createSession` and `sessionCookie` were all written
   * and tested, and nothing in the application called any of them — so the
   * masthead's Sign in button pointed at a 404 and the product was
   * permanently signed out. Several separately-recorded gaps ("subscribe does
   * not persist", "no watch event is recorded", "upload needs an owner") were
   * that one absence seen from three surfaces.
   */
  test("swaps the masthead for a signed-in one", async ({ page }) => {
    await gotoAndSettle(page, "/");
    await expect(masthead(page).getByRole("link", { name: /sign in/i })).toBeVisible();

    await signIn(page);

    await expect(masthead(page).getByRole("button", { name: /create/i })).toBeVisible();
    await expect(masthead(page).getByRole("link", { name: /sign in/i })).toHaveCount(0);
  });

  test("refuses a wrong password without saying which half was wrong", async ({
    page,
  }) => {
    await gotoAndSettle(page, "/signin");
    await page.getByLabel("Email").fill("ada@example.test");
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: /^sign in$/i }).click();

    const error = page.locator("[data-signin-error]");
    await expect(error).toBeVisible();

    // The same wording an unknown address gets. A message that distinguishes
    // them is an account-enumeration oracle on the one page everyone reaches.
    const wrongPassword = await error.textContent();

    await page.getByLabel("Email").fill("nobody@example.test");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(error).toHaveText(wrongPassword ?? "");
  });

  test("survives a reload, and signs back out", async ({ page }) => {
    await signIn(page);

    // The cookie is the session; a reload is what proves it was actually set
    // rather than held in a React state that a navigation discards.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(masthead(page).getByRole("button", { name: /create/i })).toBeVisible();

    const response = await page.request.delete("/api/auth/session");
    expect(response.status()).toBe(204);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(masthead(page).getByRole("link", { name: /sign in/i })).toBeVisible();
  });
});

test.describe("the library surfaces", () => {
  for (const path of [
    "/feed/subscriptions",
    "/feed/history",
    "/feed/playlists",
    "/feed/you",
    "/feed/channels",
  ]) {
    test(`renders ${path} without erroring`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));

      const response = await page.goto(path, { waitUntil: "domcontentloaded" });

      expect(response?.status()).toBe(200);
      expect(errors).toEqual([]);
    });
  }
});
