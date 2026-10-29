import { expect, test } from "@playwright/test";

/**
 * The animation lab is a development tool, and the reason it gets an e2e test
 * anyway is that it is the only thing that can *see* a broken animation.
 *
 * Every clip in the library goes through the lab's contact sheet, so a clip
 * that throws while sampling — a malformed keyframe, a bone name that is not a
 * bone, a period of zero — takes the page down and takes with it the only way
 * anyone would notice. A unit test proves a clip is well-formed; this proves it
 * can be drawn.
 */

/** One action from each family, which between them touch every clip file. */
const ACTIONS = [
  "stand", "walk", "dashStart", "run", "runBrake", "turnaround",
  "crouchStart", "crouch", "crouchEnd",
  "jumpSquat", "jump", "fall", "land", "landingLag",
  "shield", "shieldRelease", "shieldBroken", "roll", "spotDodge", "airDodge",
  "hitstun", "tumble", "downed", "getUp", "grabbed", "thrown",
  "ledgeHang", "ledgeGetUp", "ledgeJump",
  "attack", "special", "grab", "throw",
];

test("every action draws a contact sheet without throwing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/anim");
  await expect(page.getByLabel("Contact sheet")).toBeVisible();

  for (const action of ACTIONS) {
    await page.getByLabel("Action").selectOption(action);
    // The heading names the clip and its length, so a clip with no frames — a
    // period of zero, an empty key list — shows up here rather than silently
    // drawing one cell.
    const heading = await page.locator("h1").innerText();
    const frames = Number(/\((\d+) frames\)/.exec(heading)?.[1] ?? 0);
    expect(frames, `${action} has no frames`).toBeGreaterThan(0);
  }

  expect(errors, errors.join("\n")).toEqual([]);
});

test("every fighter's rig survives the same clip", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/anim");
  const fighters = await page.getByLabel("Fighter").locator("option").allTextContents();
  expect(fighters.length).toBeGreaterThanOrEqual(8);

  await page.getByLabel("Action").selectOption("roll");
  for (const id of fighters) {
    await page.getByLabel("Fighter").selectOption(id);
    await expect(page.getByLabel("Contact sheet")).toBeVisible();
  }

  expect(errors, errors.join("\n")).toEqual([]);
});

/**
 * The model sheet (Plan 4, Task 21): the fighter's model posed by the match's own
 * pose, with the sim's boxes over it. Photographed in Chromium, whose WebGL is
 * real (software-rendered on a machine with no GPU); the fighters are their
 * models, or the stand-ins where `pnpm models` has not been run.
 */

/** Per cell of the sheet: how many pixels of the model sheet's GL canvas differ from its background, and how many of the overlay are the hitboxes' red. */
async function cellPixels(page: import("@playwright/test").Page): Promise<{ model: number[]; red: number[] }> {
  return page.getByLabel("Model sheet").evaluate((sheet) => {
    const [gl, over] = Array.from(sheet.querySelectorAll("canvas"));
    const cell = 150;
    const cols = gl.width / cell;
    const rows = gl.height / cell;
    // The GL canvas through a 2D one: its drawing buffer is kept (`preserveDrawingBuffer`).
    const copy = document.createElement("canvas");
    copy.width = gl.width;
    copy.height = gl.height;
    const g = copy.getContext("2d")!;
    g.drawImage(gl, 0, 0);
    const model: number[] = [];
    const red: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let m = 0;
        let h = 0;
        const px = g.getImageData(c * cell, r * cell, cell, cell).data;
        const ov = over.getContext("2d")!.getImageData(c * cell, r * cell, cell, cell).data;
        for (let i = 0; i < px.length; i += 4) {
          // The sheet's background is 0x12151a.
          if (Math.abs(px[i] - 0x12) + Math.abs(px[i + 1] - 0x15) + Math.abs(px[i + 2] - 0x1a) > 40) m++;
          if (ov[i + 3] > 128 && ov[i] > 200 && ov[i + 1] < 120 && ov[i + 2] < 120) h++;
        }
        model.push(m);
        red.push(h);
      }
    }
    return { model, red };
  });
}

test("the model sheet draws a forward tilt: the model in every cell, the hitboxes on frames 5 to 7 only", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/anim");
  await page.getByLabel("Action").selectOption("attack");
  await page.getByLabel("Move").selectOption("ftilt");
  await expect(page.locator('[aria-label="Model sheet"][data-drawn="true"]')).toBeVisible({ timeout: 30_000 });

  // 25 frames, in cells of 150 px.
  const { model, red } = await cellPixels(page);
  expect(model.slice(0, 25).every((n) => n > 500), `a cell is blank: ${model.slice(0, 25).join(",")}`).toBe(true);
  // Mario's forward tilt is live on move frames 5 to 7 (https://ultimateframedata.com/mario), cells 4 to 6.
  const live = red.slice(0, 25).flatMap((n, i) => (n > 0 ? [i] : []));
  expect(live).toEqual([4, 5, 6]);

  expect(errors, errors.join("\n")).toEqual([]);
});

test("every fighter's model sheet draws, one renderer at a time", async ({ page }) => {
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (/WebGL/i.test(m.text())) warnings.push(m.text());
  });

  await page.goto("/anim");
  const fighters = await page.getByLabel("Fighter").locator("option").allTextContents();
  await page.getByLabel("Action").selectOption("land");
  for (const id of fighters) {
    await page.getByLabel("Fighter").selectOption(id);
    await expect(page.locator('[aria-label="Model sheet"][data-drawn="true"]'), id).toBeVisible({ timeout: 30_000 });
    const { model } = await cellPixels(page);
    expect(model.every((n) => n > 200), `${id}: a cell is blank: ${model.join(",")}`).toBe(true);
  }

  // Chromium warns when a page makes too many WebGL contexts ("Too many active WebGL contexts").
  expect(warnings, warnings.join("\n")).toEqual([]);
  expect(errors, errors.join("\n")).toEqual([]);
});
