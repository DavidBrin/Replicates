import { expect, test } from "@playwright/test";

import { signIn, signOut, WORKSPACE } from "./fixtures";

/**
 * The DAG view, end to end.
 *
 * The layout is proved as arithmetic in `graph-layout.test.ts` and the query is
 * proved against Postgres in `dependency-graph.test.ts`. What only a browser can
 * answer is whether the three layers actually meet: whether the server-rendered
 * positions arrive as a drawing, whether a card is a link that navigates, and —
 * the one that matters — whether the same URL shows two different people two
 * different graphs.
 *
 * Serial, and against the seeded workspace, whose `RELATIONS` block was written
 * to make the cross-team case reachable: `DES-3` blocks `ENG-5`, and Design is
 * private.
 */

test.describe.configure({ mode: "serial" });

const DAG = `/${WORKSPACE}/team/ENG/dag`;

test.describe("the dependency graph", () => {
  /**
   * Every test signs in, because every test gets its own browser context.
   *
   * Playwright's default isolation is per test, not per file, so a session
   * established in the first test is gone by the second — which presents as the
   * graph rendering once and then being empty, an extremely convincing
   * impression of a data bug.
   *
   * The specs that need somebody else must `signOut` first: `/signin` redirects
   * an authenticated visitor into the app, so signing in over a live session
   * hangs waiting for a form that will never render.
   */
  test.beforeEach(async ({ page }) => {
    await signIn(page, "owner@demo.test");
  });

  test("is reachable from the team's tab row", async ({ page }) => {
    await page.goto(`/${WORKSPACE}/team/ENG/all`);

    await page.getByTestId("view-tab-dag").click();
    await expect(page).toHaveURL(new RegExp(`${DAG}$`));
    await expect(page.getByTestId("dependency-graph")).toBeVisible();
  });

  test("draws the seeded chain", async ({ page }) => {
    await page.goto(DAG);

    // The sync/ordering web: ENG-11 blocks ENG-1, and both block ENG-9.
    await expect(page.getByTestId("graph-node-ENG-11")).toBeVisible();
    await expect(page.getByTestId("graph-node-ENG-1")).toBeVisible();
    await expect(page.getByTestId("graph-node-ENG-9")).toBeVisible();

    const edges = page.getByTestId("graph-edge");
    expect(await edges.count()).toBeGreaterThanOrEqual(7);
  });

  /**
   * Blockers to the left of what they block. This is the entire promise of the
   * view, and it is the one thing that a layout regression would break while
   * still rendering a perfectly plausible-looking graph.
   */
  test("puts a blocker to the left of the issue it blocks", async ({ page }) => {
    await page.goto(DAG);

    const blocker = await page.getByTestId("graph-node-ENG-11").boundingBox();
    const blocked = await page.getByTestId("graph-node-ENG-1").boundingBox();
    const last = await page.getByTestId("graph-node-ENG-9").boundingBox();

    expect(blocker!.x).toBeLessThan(blocked!.x);
    expect(blocked!.x).toBeLessThan(last!.x);
  });

  test("navigates to the issue when a card is clicked", async ({ page }) => {
    await page.goto(DAG);
    await page.getByTestId("graph-node-ENG-1").click();
    await expect(page).toHaveURL(new RegExp(`/${WORKSPACE}/issue/ENG-1$`));
  });

  test("counts the issues it is not drawing", async ({ page }) => {
    await page.goto(DAG);
    // Most of Engineering has no blocking relation; the summary says so rather
    // than the graph implying the team is nine issues long.
    await expect(page.getByTestId("graph-not-drawn")).toBeVisible();
  });

  test("zooms", async ({ page }) => {
    await page.goto(DAG);
    await expect(page.getByTestId("graph-zoom-reset")).toHaveText("100%");
    await page.getByTestId("graph-zoom-in").click();
    await expect(page.getByTestId("graph-zoom-reset")).toHaveText("120%");
  });

  /**
   * The same URL, two people, two graphs.
   *
   * The owner is in Design and sees `DES-3` in Engineering's graph. A member
   * who is not in Design must see neither the card nor the edge — and `ENG-5`,
   * whose only blocker is that Design issue, drops out of the drawing rather
   * than appearing as an unexplained island.
   */
  test.describe("across a private team boundary", () => {
    test("the owner sees the Design issue that blocks Engineering", async ({
      page,
    }) => {
      await page.goto(DAG);

      const foreign = page.getByTestId("graph-node-DES-3");
      await expect(foreign).toBeVisible();
      await expect(foreign).toHaveAttribute("data-foreign", "");
      await expect(page.getByTestId("graph-node-ENG-5")).toBeVisible();
    });

    test("a member outside Design sees neither it nor what it blocks", async ({
      page,
    }) => {
      await signOut(page);
      await signIn(page, "member@demo.test");
      await page.goto(DAG);

      await expect(page.getByTestId("dependency-graph")).toBeVisible();
      // The Engineering half of the graph is still there…
      await expect(page.getByTestId("graph-node-ENG-11")).toBeVisible();
      // …and the private team's issue, and the issue it blocked, are not.
      await expect(page.getByTestId("graph-node-DES-3")).toHaveCount(0);
      await expect(page.getByTestId("graph-node-ENG-5")).toHaveCount(0);
    });

    test("a guest cannot reach the graph of a team they are not in", async ({
      page,
    }) => {
      await signOut(page);
      await signIn(page, "guest@demo.test");
      const response = await page.goto(`/${WORKSPACE}/team/OPS/dag`);
      expect(response?.status()).toBe(404);
    });
  });
});
