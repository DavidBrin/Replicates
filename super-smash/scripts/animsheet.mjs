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
 *   node scripts/animsheet.mjs attack --move ftilt --view 3d
 *
 * `--view 3d` photographs the model sheet: the fighter's real model posed by the
 * match's own pose, with the sim's hitboxes (red) and hurtboxes (yellow) over
 * each cell. It needs the models built locally (`pnpm models`); without them the
 * sheet is drawn with the stand-ins and says so.
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
const action = argv.find((a) => !a.startsWith("--")) ?? "land";
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const fighter = flag("fighter", "mario");
const move = flag("move", "fsmash");
const base = flag("base", "http://localhost:3000");
const out = resolve(flag("out", join("test-results", "anim", `anim-${fighter}-${action}.png`)));
// --view 3d photographs the model sheet (Plan 4); the 2D views remain until Task 23.
const which = flag("view", "2d") === "3d" ? "Model sheet" : argv.includes("--playback") ? "Playback" : "Contact sheet";

mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch();
// The model sheet is 12 cells of 150 px (1800 px) wide: a viewport narrower than the page leaves part of it outside the screenshot's frame.
const page = await browser.newPage({ viewport: { width: which === "Model sheet" ? 1900 : 1700, height: 1000 } });
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
// Freeze playback so the strip is reproducible run to run.
await page.getByRole("button", { name: /pause|play/ }).click().catch(() => {});
await page.waitForTimeout(200);

if (which === "Model sheet") {
  // The sheet says what it is drawing once the fighter's model (or its stand-in) is in, and marks itself drawn
  // when every cell is: wait for both, or the photograph catches a blank canvas.
  await page.getByText(/model sheet — (model|stand-in)/).waitFor({ timeout: 30000 });
  await page.locator('[aria-label="Model sheet"][data-drawn="true"]').waitFor({ timeout: 30000 });
}
const title = (await page.locator("h1").innerText()).replace(/\s+/g, " ");
await page.getByLabel(which).screenshot({ path: out });
await browser.close();

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`${title}\n${out}`);
