import { expect, test } from "@playwright/test";

/**
 * S4's e2e (SPEC §11): the editor saves a map, it loads at `/maps/[id]`,
 * Play starts it, and `/challenges` lists three maps with a countdown.
 *
 * Selectors and routes are re-declared here rather than imported from
 * `src/` — the spec tests the artifact that deploys, not the module graph.
 * The editor opens on a draft that is already valid (two 3×3 provinces with
 * a city each), so Save is enabled without painting; one brush stroke is
 * made anyway to prove the grid takes input.
 */

const ROUTES = {
  editor: "/editor",
  challenges: "/challenges",
  map: (id: string) => `/maps/${id}`,
  play: (id: string) => `/play/custom/${id}`,
} as const;

test.describe("map editor", () => {
  test("saves a map, loads its share page, and Play starts it", async ({ page }) => {
    await page.goto(ROUTES.editor);
    await expect(page.getByTestId("editor")).toBeVisible();

    const name = `E2E Isle ${Date.now().toString(36)}`;
    await page.getByTestId("editor-name").fill(name);
    await page.getByTestId("editor-author").fill("playwright");

    // Paint one water tile at the far corner (outside both provinces).
    await page.getByTestId("tool-terrain-water").click();
    const canvas = page.getByTestId("editor-canvas");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width - 5, box!.y + 5);

    // The validate panel must still report a valid map.
    await expect(page.getByTestId("editor-validate")).toHaveAttribute("data-valid", "true");

    await page.getByTestId("editor-save").click();
    await page.waitForURL(/\/maps\/[A-Za-z0-9_-]+$/);
    const id = page.url().split("/").pop()!;
    expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);

    await expect(page.getByTestId("map-share")).toBeVisible();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByTestId("map-author")).toHaveText("playwright");
    await expect(page.getByTestId("map-id")).toHaveText(id);
    await expect(page.getByTestId("map-thumbnail")).toBeVisible();

    // The API serves the same row.
    const response = await page.request.get(`/api/maps/${id}`);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { id: string; name: string; tiles: unknown[] };
    expect(body.id).toBe(id);
    expect(body.name).toBe(name);
    expect(body.tiles).toHaveLength(144);

    await page.getByTestId("map-play").click();
    await page.waitForURL(new RegExp(`${ROUTES.play(id)}$`));

    // The in-game screen (S2) exposes the live state outside production.
    await page.waitForFunction(
      () => {
        const dbg = (window as unknown as { __islandDebug?: { state(): unknown } }).__islandDebug;
        return Boolean(dbg && dbg.state());
      },
      undefined,
      { timeout: 20_000 },
    );
  });

  test("reopens a saved map in the editor via ?from=", async ({ page }) => {
    const create = await page.request.post("/api/maps", {
      data: await defaultMapBody(page),
    });
    expect(create.status()).toBe(201);
    const { id } = (await create.json()) as { id: string };

    await page.goto(`${ROUTES.editor}?from=${id}`);
    await expect(page.getByTestId("editor-name")).toHaveValue("Reopened", { timeout: 15_000 });
  });
});

test.describe("weekly challenges", () => {
  test("lists three maps with a live countdown", async ({ page }) => {
    // Make sure the pool holds at least three maps even if the bundled
    // levels are unavailable: save three through the API.
    for (let i = 0; i < 3; i += 1) {
      const response = await page.request.post("/api/maps", {
        data: { ...(await defaultMapBody(page)), name: `Pool ${i}` },
      });
      expect(response.status()).toBe(201);
    }

    await page.goto(ROUTES.challenges);
    await expect(page.getByTestId("challenges")).toBeVisible();
    await expect(page.getByTestId("challenge-card")).toHaveCount(3);
    await expect(page.getByTestId("challenge-week").first()).toHaveText(/^\d{4}-W\d{2}$/);

    const countdown = page.getByTestId("challenge-countdown").first();
    await expect(countdown).toHaveText(/^\d+d \d+h \d+m$/);

    // Every card fetched its definition and drew a thumbnail.
    await expect(page.getByTestId("challenge-thumbnail")).toHaveCount(3);
    await expect(page.getByTestId("medal-dots")).toHaveCount(3);

    // Playing #1 lands on the custom play route with the week attached.
    const first = page.getByTestId("challenge-card").first();
    const mapId = await first.getAttribute("data-map-id");
    await first.getByTestId("difficulty-easy").click();
    await first.getByTestId("challenge-play").click();
    await page.waitForURL(new RegExp(`/play/custom/${encodeURIComponent(mapId!)}\\?challenge=\\d{4}-W\\d{2}&difficulty=easy$`));
  });
});

/**
 * The editor's own default draft, fetched from the page so the spec does not
 * carry a 144-tile literal: open the editor, export, read the textarea.
 */
async function defaultMapBody(page: import("@playwright/test").Page): Promise<Record<string, unknown>> {
  await page.goto(ROUTES.editor);
  await page.getByTestId("editor-name").fill("Reopened");
  await page.getByTestId("editor-export").click();
  const json = await page.getByTestId("editor-json").inputValue();
  const { id: _id, ...body } = JSON.parse(json) as Record<string, unknown>;
  void _id;
  return body;
}
