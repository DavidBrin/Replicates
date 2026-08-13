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
 *
 * Needs the dev server up (npm run dev).
 */

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const argv = process.argv.slice(2);
const action = argv.find((a) => !a.startsWith("--")) ?? "land";
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const fighter = flag("fighter", "mario");
const move = flag("move", "fsmash");
const base = flag("base", "http://localhost:3000");
const out = resolve(flag("out", `anim-${fighter}-${action}.png`));
const which = argv.includes("--playback") ? "Playback" : "Contact sheet";

mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
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

const title = (await page.locator("h1").innerText()).replace(/\s+/g, " ");
await page.getByLabel(which).screenshot({ path: out });
await browser.close();

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`${title}\n${out}`);
