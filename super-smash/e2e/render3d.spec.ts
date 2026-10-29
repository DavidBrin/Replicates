import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { MAX_DRAW_CALLS, MAX_TRIANGLES_PER_FRAME } from "../src/render3d/budget";
import { P1, ROUTES, pauseMatch, simFrame, startFromTitle, startMatch, startMatchFromMenu, waitForMatch } from "./helpers";

/**
 * The 3D renderer in a real browser (Plan 4, Task 22).
 *
 * The canvases are opaque to a test, so every assertion reads one of two
 * things: `window.__smashRender.info()` (draw calls, triangles, the drawing
 * buffer, whether the context is lost, and what each fighter was drawn with)
 * or the simulation's own frame counter, which keeps climbing exactly while
 * the match survives. A few tests also read the WebGL context itself (its
 * drawing buffer, a count of the draw and link calls it was handed), which is
 * what "painted" and "compiled again" come to.
 *
 * ## Without the models
 *
 * The glbs are built locally by `pnpm models` into the git-ignored
 * `public/models/`, and CI never runs it, so a checkout can have none, some or
 * all of them. Nothing here fails for the lack of one:
 *
 * - The stand-in tests do not need the models at all: they take the models away
 *   themselves (a 404 for everything under /models/), so they run the same
 *   everywhere.
 * - The context, resize and DPR tests do not look at what the fighters are
 *   drawn with.
 * - The budget test asks the page's own server for the model index
 *   (`/models/index.json`) and expects exactly what it lists: a fighter in the
 *   index is drawn from its glb, one that is not (or every one, with no index)
 *   as a stand-in. The same match also runs with the models taken away, so the
 *   stand-ins' own cost is held to the budget on every machine too.
 *   `REQUIRE_MODELS=1` (after `pnpm models`) refuses a degrade: every fighter
 *   must be its glb.
 */

type FighterKind = "glb" | "standIn" | "loading";

interface RenderInfo {
  calls: number;
  triangles: number;
  lost: boolean;
  buffer: { width: number; height: number };
  fighters: FighterKind[];
}

/** What a page that counted its WebGL calls reports (`countGLCalls`). */
interface GLCounts {
  draws: number;
  links: number;
}

const renderInfo = (page: Page): Promise<RenderInfo | null> =>
  page.evaluate(() => (window as unknown as { __smashRender?: { info(): RenderInfo } }).__smashRender?.info() ?? null);

/** The sim has run on by a good half second (30 frames), whatever the picture is doing. */
async function framesAdvance(page: Page): Promise<void> {
  const before = await simFrame(page);
  await expect.poll(() => simFrame(page), { timeout: 10_000 }).toBeGreaterThan(before + 30);
}

/** The page's own error screen (`play/page.tsx`); Next's route announcer is a `role="alert"` too, so this asks by its words. */
const matchFailed = (page: Page) => page.getByText("THE MATCH COULD NOT START");

/** A request for the models directory (`/models/index.json` or a glb), and nothing else the app serves. */
const isModelRequest = (url: URL): boolean => url.pathname.startsWith("/models/");

/** Answer every model request the way a static host answers a file it does not have: a 404 with an HTML page, never JSON. */
async function withoutModels(page: Page): Promise<void> {
  await page.route(isModelRequest, (route) => route.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html><title>404</title>" }));
}

/**
 * Errors the page threw, and the console's errors and warnings, from now on.
 * The browser's own "Failed to load resource" for a model that is not served
 * is no error of the page's (that is the stand-in path working, and a checkout
 * that never ran `pnpm models` has one for every fighter), so it is left out.
 */
function watchPage(page: Page): { pageErrors: string[]; errors: string[]; warnings: string[] } {
  const seen = { pageErrors: [] as string[], errors: [] as string[], warnings: [] as string[] };
  page.on("pageerror", (e) => seen.pageErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.location().url.includes("/models/")) seen.errors.push(m.text());
    else if (m.type() === "warning") seen.warnings.push(m.text());
  });
  return seen;
}

/** Fighter ids that the page said it drew as a stand-in (`David-Smash: drawing mario as a stand-in — …`). */
function standInsWarnedOf(warnings: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const w of warnings) {
    const id = /drawing (\w+) as a stand-in/.exec(w)?.[1];
    if (id !== undefined) ids.add(id);
  }
  return [...ids].sort();
}

/**
 * Count the draw and shader-link calls the page's WebGL2 context is handed, in
 * `window.__gl`. A draw call that was never issued is the one honest sign that
 * nothing was painted, and a link after a restore is the shaders compiling
 * again. Must run before the page loads.
 */
async function countGLCalls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const counts = { draws: 0, links: 0 };
    (window as unknown as { __gl: GLCounts }).__gl = counts;
    const proto = WebGL2RenderingContext.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
    const wrap = (name: string, key: keyof GLCounts) => {
      const original = proto[name];
      proto[name] = function (this: unknown, ...args: unknown[]) {
        counts[key]++;
        return original.apply(this, args);
      };
    };
    for (const name of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced", "drawRangeElements"]) wrap(name, "draws");
    wrap("linkProgram", "links");
  });
}

/** Paint the paused match's frame again, without stepping it. */
const repaint = (page: Page): Promise<void> => page.evaluate(() => (window as unknown as { __smashDebug: { step(n: number): void } }).__smashDebug.step(0));

const glCounts = (page: Page): Promise<GLCounts> => page.evaluate(() => ({ ...(window as unknown as { __gl: GLCounts }).__gl }));

test.describe("stand-ins when the models are not there", () => {
  test("plays with stand-ins when no model index is served (a 404)", async ({ page }) => {
    await withoutModels(page);
    const seen = watchPage(page);
    await startMatch(page);

    // Both fighters settle on their stand-in: neither is stuck "loading", and the match started.
    await expect.poll(async () => (await renderInfo(page))?.fighters ?? []).toEqual(["standIn", "standIn"]);
    await framesAdvance(page);
    // A stand-in is drawn, not skipped.
    expect((await renderInfo(page))?.calls ?? 0).toBeGreaterThan(0);
    await expect(matchFailed(page)).toHaveCount(0);
    expect(seen.pageErrors).toEqual([]);
    // Said once per fighter, naming it, so a missing model is never silent.
    expect(standInsWarnedOf(seen.warnings)).toHaveLength(2);
    expect(seen.warnings.some((w) => w.includes("no model index"))).toBe(true);
  });

  test("plays with stand-ins when the index is there but its glbs 404", async ({ page }) => {
    // An index naming every fighter (what `pnpm models` writes), over glbs the server does not have:
    // the per-model path, which a plain 404 for the index never reaches. Synthetic, so it needs no build.
    const ids = ["donkeyKong", "fox", "kirby", "link", "mario", "marth", "pikachu", "samus"];
    const index = { schema: 1, models: Object.fromEntries(ids.map((id) => [id, { file: `${id}.00000000.glb`, bytes: 1, sha256: "0".repeat(64) }])) };
    await page.route((url) => url.pathname === "/models/index.json", (route) => route.fulfill({ json: index }));
    await page.route((url) => /^\/models\/[^/]+\.glb$/.test(url.pathname), (route) => route.fulfill({ status: 404, body: "" }));
    const seen = watchPage(page);
    await startMatch(page);

    await expect.poll(async () => (await renderInfo(page))?.fighters ?? []).toEqual(["standIn", "standIn"]);
    await framesAdvance(page);
    await expect(matchFailed(page)).toHaveCount(0);
    expect(seen.pageErrors).toEqual([]);
    expect(standInsWarnedOf(seen.warnings)).toHaveLength(2);
    expect(seen.warnings.some((w) => w.includes("HTTP 404"))).toBe(true);
  });
});

test.describe("a lost WebGL context", () => {
  test("pauses painting, keeps the sim running, and paints again after the restore", async ({ page }) => {
    test.setTimeout(60_000);
    await countGLCalls(page);
    const seen = watchPage(page);
    await startMatch(page);
    await expect.poll(async () => (await renderInfo(page))?.fighters ?? []).not.toContain("loading");

    // The context's own handle on losing and restoring itself, taken while it is alive:
    // a lost context hands out no extensions.
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-layer="world"]')!;
      const ext = canvas.getContext("webgl2")!.getExtension("WEBGL_lose_context")!;
      (window as unknown as { __lose: { lose(): void; restore(): void } }).__lose = { lose: () => ext.loseContext(), restore: () => ext.restoreContext() };
    });
    const isLost = (): Promise<boolean> =>
      page.evaluate(() => document.querySelector<HTMLCanvasElement>('canvas[data-layer="world"]')!.getContext("webgl2")!.isContextLost());

    // Painting before anything happens: draw calls climb, and shaders were linked to make them.
    const first = await glCounts(page);
    await expect.poll(async () => (await glCounts(page)).draws).toBeGreaterThan(first.draws);
    expect(first.links).toBeGreaterThan(0);
    expect((await renderInfo(page))?.lost).toBe(false);
    expect((await renderInfo(page))?.calls ?? 0).toBeGreaterThan(0);

    // Twice, so a restore is shown to leave the presenter ready for the next loss and not just for one.
    for (const round of [1, 2]) {
      const label = `loss ${round}`;
      await page.evaluate(() => (window as unknown as { __lose: { lose(): void } }).__lose.lose());
      await expect.poll(async () => (await renderInfo(page))?.lost, label).toBe(true);
      expect(await isLost(), label).toBe(true);

      // Lost: not one draw call is issued across half a second of the match, and the sim runs on.
      const lost = await glCounts(page);
      await framesAdvance(page);
      expect((await glCounts(page)).draws, `${label}: nothing painted while lost`).toBe(lost.draws);
      expect((await renderInfo(page))?.lost, label).toBe(true);
      await expect(matchFailed(page), label).toHaveCount(0);

      await page.evaluate(() => (window as unknown as { __lose: { restore(): void } }).__lose.restore());
      await expect.poll(async () => (await renderInfo(page))?.lost, label).toBe(false);
      expect(await isLost(), label).toBe(false);

      // Restored: painting resumes, on shaders compiled again (the old programs went with the context), and draws what it drew.
      await expect.poll(async () => (await glCounts(page)).draws, `${label}: painting resumed`).toBeGreaterThan(lost.draws);
      expect((await glCounts(page)).links, `${label}: materials recompiled`).toBeGreaterThan(lost.links);
      await expect.poll(async () => (await renderInfo(page))?.calls ?? 0, label).toBeGreaterThan(0);
      await framesAdvance(page);
    }

    // Restored to the same picture, not a lesser one: with the match held on one frame, the frame costs the
    // same calls and triangles after a loss and a restore as it did before them.
    await pauseMatch(page);
    await repaint(page);
    const held = (await renderInfo(page))!;
    expect(held.calls).toBeGreaterThan(0);
    await page.evaluate(() => (window as unknown as { __lose: { lose(): void } }).__lose.lose());
    await expect.poll(async () => (await renderInfo(page))?.lost).toBe(true);
    await page.evaluate(() => (window as unknown as { __lose: { restore(): void } }).__lose.restore());
    await expect.poll(async () => (await renderInfo(page))?.lost).toBe(false);
    await repaint(page);
    const again = (await renderInfo(page))!;
    expect({ calls: again.calls, triangles: again.triangles }).toEqual({ calls: held.calls, triangles: held.triangles });
    await expect(matchFailed(page)).toHaveCount(0);

    // Leaving the match frees everything the presenter drew: against the context it has now, not the one it lost.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "QUIT MATCH" }).click();
    await page.waitForURL(`**${ROUTES.menu}`);
    // The next match, on a page that has seen a context lost and restored, draws as the first did.
    await startMatchFromMenu(page);
    await expect.poll(async () => (await renderInfo(page))?.calls ?? 0).toBeGreaterThan(0);
    expect((await renderInfo(page))?.lost).toBe(false);
    await expect(matchFailed(page)).toHaveCount(0);

    expect(seen.pageErrors).toEqual([]);
    // three and the browser report a draw into a dead object or a bad shader as a console error, and a
    // delete aimed at an object of another context as a warning.
    expect(seen.errors).toEqual([]);
    expect(seen.warnings.filter((w) => /does not belong to this context|INVALID_/.test(w))).toEqual([]);
  });
});

/**
 * The drawing buffer for a viewport and a display density: the largest 16:9
 * box the canvas holds, in device pixels, capped at the game's 1920×1080. It
 * is always exactly 16:9, because the camera frames 16:9 whatever buffer it is
 * given, and the overlay it must line up with is 16:9.
 */
const BUFFER_CASES = [
  { name: "1280x720 at 1x", viewport: { width: 1280, height: 720 }, dpr: 1, buffer: { width: 1280, height: 720 } },
  { name: "1600x900 at 1x", viewport: { width: 1600, height: 900 }, dpr: 1, buffer: { width: 1600, height: 900 } },
  { name: "800x600 (4:3) at 1x", viewport: { width: 800, height: 600 }, dpr: 1, buffer: { width: 800, height: 450 } },
  { name: "800x600 (4:3) at 2x", viewport: { width: 800, height: 600 }, dpr: 2, buffer: { width: 1600, height: 900 } },
  { name: "1280x720 at 2x, capped at 1920x1080", viewport: { width: 1280, height: 720 }, dpr: 2, buffer: { width: 1920, height: 1080 } },
] as const;

const expectSixteenByNine = (b: { width: number; height: number }, label: string) => {
  expect(b.width * 9, label).toBe(b.height * 16);
  expect(b.width, label).toBeLessThanOrEqual(1920);
  expect(b.height, label).toBeLessThanOrEqual(1080);
};

test.describe("resize and DPR", () => {
  for (const c of BUFFER_CASES) {
    test.describe(c.name, () => {
      test.use({ viewport: c.viewport, deviceScaleFactor: c.dpr });

      test("draws into the right 16:9 buffer", async ({ page }) => {
        await startMatch(page);
        await expect.poll(async () => (await renderInfo(page))?.buffer).toEqual(c.buffer);
        expectSixteenByNine(c.buffer, "the case's own expectation");

        const dom = await page.evaluate(() => {
          const world = document.querySelector<HTMLCanvasElement>('canvas[data-layer="world"]')!;
          const overlay = document.querySelector<HTMLCanvasElement>('canvas[data-layer="overlay"]')!;
          const gl = world.getContext("webgl2")!;
          const box = (el: HTMLElement) => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          };
          return {
            dpr: window.devicePixelRatio,
            canvas: { width: world.width, height: world.height },
            drawing: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
            worldBox: box(world),
            overlayBox: box(overlay),
          };
        });
        // The emulation took, and `info()` tells the truth about the canvas and the context behind it.
        expect(dom.dpr).toBe(c.dpr);
        expect(dom.canvas).toEqual(c.buffer);
        expect(dom.drawing).toEqual(c.buffer);
        // The 3D layer and the 2D overlay are stretched over the same box, so they line up at any size.
        expect(dom.worldBox).toEqual(dom.overlayBox);
        expect({ width: dom.worldBox.width, height: dom.worldBox.height }).toEqual(c.viewport);

        await framesAdvance(page);
        expect((await renderInfo(page))?.calls ?? 0).toBeGreaterThan(0);
        await expect(matchFailed(page)).toHaveCount(0);
      });
    });
  }

  // A change of density alone (a window dragged to another display) has no test here: Chromium's emulated
  // pixel ratio changes `devicePixelRatio` but dispatches no `change` to the `matchMedia` query `followSize`
  // listens on, so a browser test cannot reach that listener (`world3d.test.ts` drives it with a fake query).
  // Each density above is a fresh page at that density instead.
  test("follows the window as it is resized", async ({ page }) => {
    test.setTimeout(60_000);
    const seen = watchPage(page);
    await startMatch(page);
    await expect.poll(async () => (await renderInfo(page))?.buffer).toEqual({ width: 1280, height: 720 });

    // A window dragged to other sizes: the buffer follows without a reload, and the match plays on.
    for (const viewport of [
      { width: 1600, height: 900 },
      { width: 640, height: 360 },
    ]) {
      await page.setViewportSize(viewport);
      await expect.poll(async () => (await renderInfo(page))?.buffer, `${viewport.width}x${viewport.height}`).toEqual(viewport);
    }

    // A window that is not 16:9 gets the largest 16:9 buffer that fits it, to within one 16-pixel step.
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect.poll(async () => Math.abs(((await renderInfo(page))?.buffer.width ?? 0) - 1000), "1000x800").toBeLessThanOrEqual(16);
    expectSixteenByNine((await renderInfo(page))!.buffer, "1000x800");

    await framesAdvance(page);
    expect((await renderInfo(page))?.calls ?? 0).toBeGreaterThan(0);
    await expect(matchFailed(page)).toHaveCount(0);
    expect(seen.pageErrors).toEqual([]);
  });
});

/**
 * The four who cost most today: the fighters whose glbs have the most
 * primitives (a draw call each), by what a match of each against itself drew
 * in a browser (Fox, Marth and Link well ahead, then Mario a hair over Samus).
 * That is a choice of fixture: no number is pinned from it, and only the
 * budget's own constants are asserted. By display name, the way the select
 * screen labels its tiles.
 */
const HEAVIEST_FOUR = [
  { name: "Fox", id: "fox" },
  { name: "Marth", id: "marth" },
  { name: "Link", id: "link" },
  { name: "Mario", id: "mario" },
] as const;

/** The fighter ids `/models/index.json` lists, or none: a checkout that never ran `pnpm models` serves a 404. */
async function modelsBuilt(request: APIRequestContext): Promise<ReadonlySet<string>> {
  const res = await request.get("/models/index.json");
  if (!res.ok()) return new Set();
  try {
    const index = (await res.json()) as { models?: Record<string, unknown> };
    return new Set(Object.keys(index.models ?? {}));
  } catch {
    return new Set();
  }
}

/** The menu path of `startMatchFromMenu`, with every wait it makes, for a match of four on the first stage. */
async function startFourFighterMatch(page: Page, names: readonly string[]): Promise<void> {
  await startFromTitle(page);
  await page.getByRole("button", { name: /smash/i }).first().click();
  await page.waitForURL(`**${ROUTES.rules}`);
  await page.getByRole("button", { name: /next|stage|continue/i }).first().click();

  await page.waitForURL(`**${ROUTES.stage}`);
  // The first stage is Battlefield: the most platforms of the six, and a platform is a draw call.
  await page.getByLabel("Stages").getByRole("button").first().click();
  await page.getByRole("button", { name: /next|fighters|continue/i }).first().click();

  await page.waitForURL(`**${ROUTES.fighters}`);
  const add = page.getByRole("button", { name: "Add a player" });
  await add.click();
  await add.click();
  // Each pick hands the cursor to the next empty panel, so four picks fill four ports in order.
  for (const name of names) await page.getByLabel("Fighters").getByRole("button", { name: new RegExp(`^${name},`) }).click();

  await page.getByRole("button", { name: /ready|fight/i }).first().click();
  await page.waitForURL(`**${ROUTES.play}`);
  await waitForMatch(page);
}

/**
 * The most a frame's calls and triangles have been over `frames` simulation
 * frames of the paused match, painted one by one (each step paints once, so
 * `info()` is that frame's). Also counts the frames the effects were up on: a
 * fighter took a hit (a spark and a burst are drawn then) and port 0's shield
 * was out (its bubble is drawn).
 */
async function brawl(page: Page, frames: number): Promise<{ calls: number; triangles: number; hitFrames: number; shieldFrames: number }> {
  return page.evaluate((n) => {
    const w = window as unknown as {
      __smashDebug: { step(n: number): void; fighters(): { port: number; action: string; damage: number }[] };
      __smashRender: { info(): RenderInfo };
    };
    const worst = { calls: 0, triangles: 0, hitFrames: 0, shieldFrames: 0 };
    let last = 0;
    for (let i = 0; i < n; i++) {
      w.__smashDebug.step(1);
      const info = w.__smashRender.info();
      worst.calls = Math.max(worst.calls, info.calls);
      worst.triangles = Math.max(worst.triangles, info.triangles);
      const fighters = w.__smashDebug.fighters();
      const damage = fighters.reduce((sum, f) => sum + f.damage, 0);
      if (i > 0 && damage > last) worst.hitFrames++;
      last = damage;
      if (fighters.some((f) => f.port === 0 && f.action === "shield")) worst.shieldFrames++;
    }
    return worst;
  }, frames);
}

test.describe("four fighters", () => {
  test.describe.configure({ timeout: 90_000 });

  for (const drawnAs of ["whatever the build has", "stand-ins"] as const) {
    test(`stay inside the draw-call and triangle budget (${drawnAs})`, async ({ page, request }) => {
      const built = drawnAs === "stand-ins" ? new Set<string>() : await modelsBuilt(request);
      if (drawnAs === "stand-ins") {
        // Every glb and the index 404: the worst case of the fallback, which is what CI and a failed download get.
        await withoutModels(page);
      }
      const seen = watchPage(page);
      await startFourFighterMatch(page, HEAVIEST_FOUR.map((f) => f.name));

      await expect.poll(async () => (await renderInfo(page))?.fighters.length).toBe(4);
      // Four ports, each drawn as its glb if the build has one and as a stand-in if not: never stuck loading.
      // `REQUIRE_MODELS=1` allows no degrade: against a build that ran `pnpm models`, all four must be glbs.
      const requireGlb = process.env.REQUIRE_MODELS === "1" && drawnAs !== "stand-ins";
      const want = HEAVIEST_FOUR.map((f) => (requireGlb || built.has(f.id) ? "glb" : "standIn"));
      await expect.poll(async () => (await renderInfo(page))?.fighters).toEqual(want);

      // The match as it runs on its own clock...
      const live = { calls: 0, triangles: 0 };
      for (let i = 0; i < 20; i++) {
        const now = (await renderInfo(page))!;
        live.calls = Math.max(live.calls, now.calls);
        live.triangles = Math.max(live.triangles, now.triangles);
        await page.waitForTimeout(50);
      }
      // ...and then frame by frame through a brawl: three CPUs and a fourth who holds a shield up (the shield
      // bubble is an effect on every frame), 900 frames, so hit sparks and bursts come and go with the hits.
      await pauseMatch(page);
      await page.keyboard.down(P1.shield);
      const stepped = await brawl(page, 900);
      await page.keyboard.up(P1.shield);

      const worst = { calls: Math.max(live.calls, stepped.calls), triangles: Math.max(live.triangles, stepped.triangles) };
      test.info().annotations.push({ type: "measured", description: `${drawnAs}: ${worst.calls} calls, ${worst.triangles} triangles, ${stepped.hitFrames} hit frames, ${stepped.shieldFrames} shield frames` });
      // Something was drawn for every fighter, and the effects were up during the frames that were counted.
      expect(worst.calls).toBeGreaterThanOrEqual(4);
      expect(stepped.hitFrames).toBeGreaterThan(0);
      expect(stepped.shieldFrames).toBeGreaterThan(0);
      expect(worst.calls).toBeLessThan(MAX_DRAW_CALLS);
      expect(worst.triangles).toBeLessThan(MAX_TRIANGLES_PER_FRAME);
      await expect(matchFailed(page)).toHaveCount(0);
      expect(seen.pageErrors).toEqual([]);
    });
  }
});
