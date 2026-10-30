/**
 * Capture the animation lab's contact sheet for one action, as a PNG.
 *
 * The point is to make an animation reviewable without a human watching a
 * match. `/anim` renders one cell per simulation frame at the action's true
 * length; this drives it headlessly and writes the strip to disk, so a change
 * to a clip can be looked at in a second rather than provoked in a match and
 * caught by a lucky screenshot.
 *
 *   node scripts/animsheet.mjs land                       # contact sheet
 *   node scripts/animsheet.mjs fsmash --move fsmash       # an attack
 *   node scripts/animsheet.mjs jump --fighter kirby --out /tmp/k.png
 *   node scripts/animsheet.mjs attack --move ftilt
 *
 * The sheet is the 3D one (Plan 4): the fighter's real model posed by the
 * match's own pose, with the sim's hitboxes (red) and hurtboxes (yellow) over
 * each cell. It needs the models built locally (`pnpm models`); without them the
 * sheet is drawn with the stand-ins and says so. (The 2D sheet and its
 * `--view`/`--playback` flags went with the 2D figure in Plan 4, Task 23; an
 * old command line that still passes either is refused, exit 2, rather than
 * quietly given the 3D sheet.)
 *
 * Without --out the PNG goes to the git-ignored test-results/anim/, never the
 * repo root, so a capture cannot ride along in a commit. A picture of a model
 * is as unshippable as the model: never commit one.
 *
 * Needs the dev server up (npm run dev).
 */

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const argv = process.argv.slice(2);
if (argv.some((a) => /^--(view|playback)(=|$)/.test(a))) {
  console.error("animsheet: --view and --playback were removed in Plan 4 (Task 23): the contact sheet is the 3D one. Run it without them.");
  process.exit(2);
}
const action = argv.find((a) => !a.startsWith("--")) ?? "land";
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const fighter = flag("fighter", "mario");
const move = flag("move", "fsmash");
const base = flag("base", "http://localhost:3000");
const out = resolve(flag("out", join("test-results", "anim", `anim-${fighter}-${action}.png`)));
const SHEET = "Contact sheet";

mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch();
// The sheet is 12 cells of 150 px (1800 px) wide: a viewport narrower than the page leaves part of it outside the screenshot's frame.
const page = await browser.newPage({ viewport: { width: 1900, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${base}/anim`, { waitUntil: "networkidle" });

const ids = await page.getByLabel("Fighter").locator("option").allTextContents();
const picked = ids.find((id) => id.toLowerCase() === fighter.toLowerCase());
if (!picked) {
  console.error(`unknown fighter "${fighter}". Try one of: ${ids.join(", ")}`);
  await browser.close();
  process.exit(1);
}
await page.getByLabel("Fighter").selectOption(picked);
await page.getByLabel("Action").selectOption(action);
if (await page.getByLabel("Move").count()) await page.getByLabel("Move").selectOption(move);
// Freeze the frame counter so the caption is reproducible run to run.
await page.getByRole("button", { name: /pause|play/ }).click().catch(() => {});
await page.waitForTimeout(200);

// The sheet marks itself `data-drawn` when every cell is drawn, or `data-error` with the reason when it cannot be
// (the bake did not load, or the fighter's model would not build). Wait for either: a photograph of a canvas that
// is not drawn yet is blank, and a failure should be reported as itself, not as a 30 s timeout.
await page.waitForFunction(
  (label) => {
    const sheet = document.querySelector(`[aria-label="${label}"]`);
    return sheet !== null && (sheet.getAttribute("data-drawn") === "true" || sheet.hasAttribute("data-error"));
  },
  SHEET,
  { timeout: 30000 },
);
const failure = await page.getByLabel(SHEET).getAttribute("data-error");
if (failure !== null) {
  console.error(`the contact sheet could not be drawn: ${failure}`);
  await browser.close();
  process.exit(1);
}
const title = (await page.locator("h1").innerText()).replace(/\s+/g, " ");
await page.getByLabel(SHEET).screenshot({ path: out });
await browser.close();

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`${title}\n${out}`);
