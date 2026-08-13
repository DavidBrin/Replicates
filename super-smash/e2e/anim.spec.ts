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
