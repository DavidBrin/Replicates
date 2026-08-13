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
 *   --hold      simulation frames to hold the button before releasing, for a
 *               move that charges. Default 0, i.e. tapped.
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
// Simulation frames to hold the attack button before releasing, for the moves
// that charge. Documented since the first version and never parsed until a
// review pointed out that `--hold 90` produced an identical uncharged sheet.
const hold = Math.max(0, Number(flag("hold", "0")) || 0);
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
  moveFrames: () => page.evaluate(() => window.__smashDebug.moveFrames()),
  where: () => page.evaluate(() => window.__smashDebug.screenPositions()),
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

// A dash attack is a *second* input thrown out of an existing run, so it needs
// the run to exist first: hold the direction for `run` frames, then add attack
// without letting go. Declared in the table from the start and never read —
// the script pressed right, never pressed attack, and exited saying the move
// was never entered.
if (plan.then) {
  await debug.step(plan.run ?? 12);
  for (const k of plan.then) {
    if (!plan.keys.includes(k)) await page.keyboard.down(KEY[k]);
  }
  await debug.step(1);
  for (const k of plan.then) await page.keyboard.up(KEY[k]).catch(() => {});
}

// Find the frame the move actually starts on, *before* releasing anything. The
// input is buffered and a grounded attack waits out whatever the fighter was
// already doing, so counting from the keypress would put every cell one or two
// frames early — and stepping a charge's worth of frames first would step
// clean past the move and report it as never entered.
// `grab` from a run is `dashGrab`; both are the grab that was asked for.
const isRequested = (slot) =>
  slot === move || (move === "grab" && slot === "dashGrab") || (move === "jab" && slot === "jab1");

let started = false;
let wrongMove = null;
for (let i = 0; i < 30 && !started; i++) {
  const [me] = await debug.fighters();
  const offensive = me.action === "attack" || me.action === "special" || me.action === "grab";
  // Accepting *any* offensive action is how a sheet comes back labelled
  // `fsmash` showing an ftilt: a smash input read one frame too slow is a
  // tilt, and both are `action: "attack"`. A capture that quietly photographs
  // a different move is worse than one that fails.
  if (offensive && isRequested(me.move)) started = true;
  else {
    if (offensive) wrongMove = me.move;
    await debug.step(1);
  }
}

// A charge is held, not tapped. `states.ts` charges on `attackHeld` — the
// attack button, even for a special like the Charge Shot — and pins
// `actionFrame` one frame short of the first hitbox while it does, so the
// clock can run without the move going anywhere. That is why this holds
// `attack` rather than the move's own keys, and why it happens after the move
// has started rather than before.
if (started && hold > 0) {
  await page.keyboard.down(KEY.attack);
  await debug.step(hold);
  await page.keyboard.up(KEY.attack);
}

// Released, but *not* stepped. The move has already started at actionFrame 0
// and the baseline below is read from it, so an extra step here would make
// frame 0 of every smash sheet actually be frame 1 and shift the whole strip —
// startup and contact landing one frame late on the one tool used to check
// exactly that. The release registers on the capture loop's own first step.
for (const k of plan.keys) await page.keyboard.up(KEY[k]);
if (!started) {
  console.error(
    wrongMove
      ? `${fighter} performed ${wrongMove}, not ${move} — the input was read as a different move`
      : `${fighter} never entered ${move} — the input did not take`,
  );
  await browser.close();
  process.exit(1);
}

const [me] = await debug.fighters();
const startFrame = me.actionFrame;

/* ------------------------------------------------------------- the sheet -- */

// The move's real length, read off the running match rather than guessed.
const lengths = await debug.moveFrames();
const total = lengths.find((m) => m.port === 0)?.total ?? 0;
// From wherever the capture starts to the end of the move. With `--hold` the
// charge pins `actionFrame` partway in, so the baseline is not frame 0 — and
// spreading samples across the *whole* move from there ran the last few of them
// off the end, past the move's own last frame.
const remaining = total > 0 ? Math.max(1, total - startFrame) : 34;
const wanted = frames.length ? frames : DEFAULT_FRAMES(remaining);
const shots = [];
let at = startFrame;
for (const target of wanted) {
  const forward = target - (at - startFrame);
  if (forward > 0) await debug.step(forward);
  at += Math.max(0, forward);
  const [self] = await debug.fighters();
  // Where the driven fighter actually is on screen, so the crop can follow
  // them. Cropping the middle of the frame crops the middle of the *stage*,
  // and a fighter who spawns near an edge lands on the crop boundary sixty
  // pixels tall — which is how a whole moveset came to be reviewed from
  // thumbnails.
  const [spot] = await debug.where();
  const png = await page.getByLabel("Match").screenshot();
  shots.push({ frame: target, action: self.action, actionFrame: self.actionFrame, png, spot });
}

/**
 * Nine cells spread across the move's own length.
 *
 * Weighted toward the front, because the startup and the contact frame are
 * where the read is and the recovery is where nothing changes fast — but scaled
 * to the move, so a 19-frame jab does not spend four cells photographing the
 * fighter standing still afterwards, and a 91-frame Fire Fox does not stop a
 * third of the way in.
 */
function DEFAULT_FRAMES(total) {
  const last = Math.max(1, total - 1);
  // Fractions of the move, front-loaded. 0 is the first frame of the move.
  const at = [0, 0.06, 0.12, 0.2, 0.28, 0.4, 0.55, 0.75, 1];
  const cells = at.map((f) => Math.round(f * last));
  // Round-tripping can collide on a very short move; keep them distinct.
  return [...new Set(cells)];
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
    const w = crop ? Math.round(images[0].width * 0.34) : images[0].width;
    const h = crop ? Math.round(images[0].height * 0.46) : images[0].height;
    const scale = 470 / w;
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
      // Centre on the fighter, then clamp so the window stays on the image —
      // a fighter at the very edge gets an off-centre crop rather than a band
      // of nothing.
      const spot = cells[i].at ?? { x: 0.5, y: 0.5 };
      const sx = crop ? Math.max(0, Math.min(img.width - w, img.width * spot.x - w / 2)) : 0;
      const sy = crop ? Math.max(0, Math.min(img.height - h, img.height * spot.y - h * 0.78)) : 0;
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
      at: s.spot ? { x: s.spot.x, y: s.spot.y } : null,
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
