/**
 * Photograph a move as it is actually played, frame by frame.
 *
 * `animsheet.mjs` draws a pose in the lab, which is the right tool for the
 * *pose* and blind to everything around it: the swing arc, the projectile, the
 * hit spark, the dust, the opponent flinching. Those are drawn by the match and
 * only by the match, so this drives a real one.
 *
 * The trick that makes it possible is `window.__smashDebug.pause()` and
 * `.step()`. A screenshot costs about a quarter of a second — fifteen
 * simulation frames — so a *running* match cannot be photographed mid-attack at
 * all. Stopping the clock and hand-cranking it is the difference between "the
 * forward smash looks wrong" and knowing which frame of it is wrong.
 *
 *   node scripts/fightsheet.mjs --fighter link --move fsmash
 *   node scripts/fightsheet.mjs --fighter samus --move neutralB --hold 90 --frames 0,8,16,24,32
 *   node scripts/fightsheet.mjs --fighter pikachu --move upB --out /tmp/pika-upb.png --full
 *
 * Needs the dev server up (npm run dev).
 *
 * Flags
 *   --fighter   who to play as. Default mario.
 *   --against   who to fight. Default donkeyKong — a wide target that a hitbox
 *               finds without needing the driver to aim.
 *   --move      one of jab, ftilt, utilt, dtilt, dashAttack, fsmash, usmash,
 *               dsmash, nair, fair, bair, uair, dair, neutralB, sideB, upB,
 *               downB, grab. Default fsmash.
 *   --frames    which frames of the move to capture, comma separated.
 *               Default is nine spread across the move.
 *   --hold      simulation frames to run before starting to capture, so the
 *               move has room to develop. Default is chosen per move.
 *   --full      capture the whole 1920×1080 frame per cell rather than a crop
 *               around the fighter.
 *   --out       where to write. Default fight-<fighter>-<move>.png
 */

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const fighter = flag("fighter", "mario");
const against = flag("against", "donkeyKong");
const move = flag("move", "fsmash");
const base = flag("base", "http://localhost:3000");
const full = has("full");
const out = resolve(flag("out", `fight-${fighter}-${move}.png`));

/**
 * Which keys make each move happen, as a player would press them.
 *
 * Driving the input layer rather than poking the state is the point: a move
 * that cannot be reached from the controls is a move nobody will ever see, and
 * the capture failing is the correct outcome in that case.
 */
const INPUT = {
  jab: { keys: ["attack"] },
  ftilt: { keys: ["right", "attack"] },
  utilt: { keys: ["up", "attack"] },
  dtilt: { keys: ["down", "attack"] },
  dashAttack: { keys: ["right"], then: ["right", "attack"], run: 12 },
  fsmash: { keys: ["right", "attack"], smash: true },
  usmash: { keys: ["up", "attack"], smash: true },
  dsmash: { keys: ["down", "attack"], smash: true },
  nair: { keys: ["attack"], air: true },
  fair: { keys: ["right", "attack"], air: true },
  bair: { keys: ["left", "attack"], air: true },
  uair: { keys: ["up", "attack"], air: true },
  dair: { keys: ["down", "attack"], air: true },
  neutralB: { keys: ["special"] },
  sideB: { keys: ["right", "special"] },
  upB: { keys: ["up", "special"] },
  downB: { keys: ["down", "special"] },
  grab: { keys: ["grab"] },
};

const KEY = {
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
  special: "KeyA",
  attack: "KeyD",
  grab: "KeyQ",
  shield: "KeyE",
  jump: "KeyW",
};

const plan = INPUT[move];
if (!plan) {
  console.error(`unknown move "${move}". Try one of: ${Object.keys(INPUT).join(", ")}`);
  process.exit(1);
}

// `"".split(",")` is `[""]` and `Number("")` is 0, so the empty case has to be
// thrown out before parsing or "no --frames given" silently means "frame 0".
const frames = (flag("frames", "") || "")
  .split(",")
  .map((n) => n.trim())
  .filter((n) => n !== "")
  .map(Number)
  .filter((n) => Number.isFinite(n));

mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

/* ------------------------------------------------------------ into a match -- */

await page.goto(`${base}/`, { waitUntil: "networkidle" });
await page.getByLabel("Press any button to continue").waitFor();
await page.keyboard.press("Enter");
await page.waitForURL("**/menu");

await page.getByRole("button", { name: /smash/i }).first().click();
await page.waitForURL("**/rules");
await page.getByRole("button", { name: /next|stage|continue/i }).first().click();

await page.waitForURL("**/stage");
await page.getByLabel("Stages").getByRole("button").first().click();
await page.getByRole("button", { name: /next|fighters|continue/i }).first().click();

await page.waitForURL("**/fighters");
await pick(fighter);
await pick(against);
await page.getByRole("button", { name: /ready|fight/i }).first().click();
await page.waitForURL("**/play");
await page.getByLabel("Match").waitFor();
await page.waitForTimeout(1400);

/**
 * Click a fighter's portrait by name.
 *
 * Matched against the roster's own display names rather than ids, because that
 * is what the tile carries — and the mismatch between the two spellings is a
 * bug this project has shipped once already.
 */
async function pick(id) {
  const tiles = page.getByLabel("Fighters").getByRole("button");
  const wanted = id.toLowerCase().replace(/[^a-z0-9]/g, "");
  const count = await tiles.count();
  for (let i = 0; i < count; i++) {
    const label = (await tiles.nth(i).getAttribute("aria-label")) ?? "";
    const name = label.split(",")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
    if (name === wanted) {
      await tiles.nth(i).click();
      return;
    }
  }
  const labels = [];
  for (let i = 0; i < count; i++) {
    labels.push(((await tiles.nth(i).getAttribute("aria-label")) ?? "").split(",")[0]);
  }
  console.error(`unknown fighter "${id}". The select offers: ${labels.join(", ")}`);
  await browser.close();
  process.exit(1);
}

/* -------------------------------------------------------- crank the clock -- */

const debug = {
  pause: () => page.evaluate(() => window.__smashDebug.pause()),
  step: (n) => page.evaluate((k) => window.__smashDebug.step(k), n),
  fighters: () => page.evaluate(() => window.__smashDebug.fighters()),
};

// Face the opponent and close the gap, so a hitbox has something to hit — an
// attack that connects looks nothing like one swung at empty air, and the hit
// spark is half of what this capture exists to show.
await page.keyboard.down(KEY.right);
await page.waitForTimeout(plan.air ? 200 : 320);
await page.keyboard.up(KEY.right);

if (plan.air) {
  await page.keyboard.press(KEY.jump);
  await page.waitForTimeout(180);
}

await debug.pause();

// Wait for the footing the move needs. A grounded attack pressed while the
// fighter happens to be airborne silently performs the *aerial* of the same
// direction, and the capture comes back labelled `fsmash` showing a forward
// air — which is exactly the kind of quiet wrong answer a review tool must not
// give.
for (let i = 0; i < 90; i++) {
  const [who] = await debug.fighters();
  const airborne = who.action === "jump" || who.action === "fall" || who.action === "land";
  if (Boolean(plan.air) === airborne) break;
  await debug.step(1);
}

// A smash is charged by holding attack, so pressing and releasing on the same
// frame gives the uncharged version — which is the one the frame data
// describes and the one worth photographing.
for (const k of plan.keys) await page.keyboard.down(KEY[k]);
await debug.step(1);
for (const k of plan.keys) await page.keyboard.up(KEY[k]);
if (plan.smash) await debug.step(1);

// Find the frame the move actually starts on. The input is buffered and a
// grounded attack waits out whatever the fighter was already doing, so counting
// from the keypress would put every cell one or two frames early.
let started = false;
for (let i = 0; i < 30 && !started; i++) {
  const [me] = await debug.fighters();
  if (me.action === "attack" || me.action === "special" || me.action === "grab") started = true;
  else await debug.step(1);
}
if (!started) {
  console.error(`${fighter} never entered ${move} — the input did not take`);
  await browser.close();
  process.exit(1);
}

const [me] = await debug.fighters();
const startFrame = me.actionFrame;

/* ------------------------------------------------------------- the sheet -- */

const wanted = frames.length ? frames : DEFAULT_FRAMES(move);
const shots = [];
let at = startFrame;
for (const target of wanted) {
  const forward = target - (at - startFrame);
  if (forward > 0) await debug.step(forward);
  at += Math.max(0, forward);
  const [self] = await debug.fighters();
  const png = await page.getByLabel("Match").screenshot();
  shots.push({ frame: target, action: self.action, actionFrame: self.actionFrame, png });
}

function DEFAULT_FRAMES(slot) {
  // Nine cells: dense through the startup where the read happens, sparser
  // through the recovery where nothing changes fast.
  const dense = [0, 2, 4, 6, 8, 11, 15, 22, 30];
  return slot.endsWith("smash") ? dense.map((n) => n + 2) : dense;
}

/* --------------------------------------------------------------- compose -- */

// Stitched in the page, because the browser already has a canvas and the
// alternative is a native image dependency for something used only by hand.
const composed = await page.evaluate(
  async ({ cells, cols, crop }) => {
    const images = await Promise.all(
      cells.map(
        (c) =>
          new Promise((done) => {
            const img = new Image();
            img.onload = () => done(img);
            img.src = `data:image/png;base64,${c.data}`;
          }),
      ),
    );
    const w = crop ? Math.round(images[0].width * 0.6) : images[0].width;
    const h = crop ? Math.round(images[0].height * 0.55) : images[0].height;
    const scale = 420 / w;
    const cw = Math.round(w * scale);
    const ch = Math.round(h * scale);
    const label = 26;
    const rows = Math.ceil(images.length / cols);

    const canvas = document.createElement("canvas");
    canvas.width = cw * cols;
    canvas.height = (ch + label) * rows;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0B0D10";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    images.forEach((img, i) => {
      const x = (i % cols) * cw;
      const y = Math.floor(i / cols) * (ch + label);
      const sx = crop ? (img.width - w) / 2 : 0;
      const sy = crop ? (img.height - h) * 0.5 : 0;
      ctx.drawImage(img, sx, sy, w, h, x, y + label, cw, ch);
      ctx.fillStyle = "#8FA3B8";
      ctx.font = "13px monospace";
      ctx.fillText(`${cells[i].label}`, x + 8, y + 18);
      ctx.strokeStyle = "#1E252D";
      ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch + label - 1);
    });
    return canvas.toDataURL("image/png");
  },
  {
    cols: 3,
    crop: !full,
    cells: shots.map((s) => ({
      data: s.png.toString("base64"),
      label: `f${s.frame}  ${s.action}:${s.actionFrame}`,
    })),
  },
);

writeFileSync(out, Buffer.from(composed.split(",")[1], "base64"));
await browser.close();

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`${fighter} ${move} vs ${against} — frames ${wanted.join(", ")}\n${out}`);
