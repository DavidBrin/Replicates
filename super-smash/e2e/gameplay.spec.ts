import { expect, test, type Page } from "@playwright/test";
import { P1, holdForFrames, readFighters, simFrame, startMatch, stepFrames } from "./helpers";

/**
 * Does pressing a key move your fighter?
 *
 * The suite shipped without this test, and the game shipped with the answer
 * "no": `play/page.tsx` built the keyboard reader and never attached its
 * listeners, so every human port drained an all-zero input on every frame for
 * the entire match. Nothing else caught it. The unit tests were green because
 * the input layer, the engine and the renderer were each correct in isolation;
 * `flow.spec.ts` was green because the frame counter advances whether or not
 * anybody is playing; and `controls.spec.ts` was green because it tests the
 * page that *documents* the controls rather than the controls.
 *
 * The lesson these tests encode: assert on the fighter, not on the frame
 * counter. A match nobody can control still runs.
 *
 * And a second, learned from the one that flaked (about one run in eight): do
 * not let the wall clock decide which frame an input lands on. The first draft
 * held keys for milliseconds, then for simulated frames counted by polling, and
 * both left the key's release a different number of frames late every run, so
 * the CPU, which answers what it sees, fought a different fight each time and
 * sometimes never lost a hit to the pattern. Every test here starts a `stepped`
 * match: the clock stops as it mounts, and the test runs it a frame at a time
 * (`stepFrames`), with the keys held down through the page's real listeners. The
 * same inputs on the same frames play the same match, on any machine and under
 * any load.
 */

// Deliberately not serial. Each test drives the menu into its own match and
// shares no state, and serial mode would abandon the remaining three the moment
// one failed — which is the opposite of what you want from the suite whose job
// is to say *which* inputs are dead.

test("holding a direction moves the player's fighter", async ({ page }) => {
  await startMatch(page, { stepped: true });

  const before = await readFighters(page);
  expect(before.length).toBeGreaterThan(1);
  const startX = before[0].x;

  await holdForFrames(page, P1.right, 30);
  const afterRight = (await readFighters(page))[0];
  expect(afterRight.x).toBeGreaterThan(startX);

  // And back, so the test cannot pass on a fighter that merely drifts — a
  // one-directional assertion would be satisfied by knockback, by a slope, or
  // by the CPU shoving them.
  await holdForFrames(page, P1.left, 45);
  const afterLeft = (await readFighters(page))[0];
  expect(afterLeft.x).toBeLessThan(afterRight.x);
});

test("the jump key leaves the ground", async ({ page }) => {
  await startMatch(page, { stepped: true });

  const groundY = (await readFighters(page))[0].y;

  await page.keyboard.down(P1.jump);
  // Past the 3-frame jumpsquat and into the rise, but well short of the apex.
  await stepFrames(page, 9);
  const airborne = (await readFighters(page))[0];
  await page.keyboard.up(P1.jump);

  expect(airborne.y).toBeGreaterThan(groundY);
});

/**
 * Up is the stick, not a spare key.
 *
 * On a Switch you jump by pushing the stick up, and the same stick aims every
 * up-attack. Both halves are checked here rather than only the jump, because
 * the naive way to make up jump — fire on the press — silently costs you
 * up-tilt, up-smash and up-special from the arrow cluster, and each of those
 * failures looks like "the jump works" from a test that only presses up.
 */
test("the up arrow jumps, like the stick", async ({ page }) => {
  await startMatch(page, { stepped: true });

  const groundY = (await readFighters(page))[0].y;

  await page.keyboard.down(P1.up);
  // Longer than for the jump key: up spends five frames finding out whether it
  // was a jump or an aimed attack before it commits.
  await stepFrames(page, 15);
  const airborne = (await readFighters(page))[0];
  await page.keyboard.up(P1.up);

  expect(airborne.y).toBeGreaterThan(groundY);
});

test("up plus attack is still an up-attack, not a jump", async ({ page }) => {
  await startMatch(page, { stepped: true });

  await page.keyboard.down(P1.up);
  await stepFrames(page, 2);
  await page.keyboard.down(P1.attack);
  await stepFrames(page, 4);
  const acting = (await readFighters(page))[0];
  await page.keyboard.up(P1.attack);
  await page.keyboard.up(P1.up);

  expect(acting.action).toBe("attack");
  expect(acting.move).toMatch(/^u(smash|tilt)$/);
});

test("the attack key puts the fighter into an attacking state", async ({ page }) => {
  await startMatch(page, { stepped: true });

  await page.keyboard.down(P1.attack);
  await stepFrames(page, 5);
  const acting = (await readFighters(page))[0];
  await page.keyboard.up(P1.attack);

  // Any attack state will do — which one depends on whether a direction was
  // fresh, and that timing distinction has its own tests in the engine. The
  // claim here is only that the button reached the simulation at all.
  expect(acting.action).toMatch(/jab|tilt|smash|attack|aerial|dash/i);
});

test("the player can actually damage the CPU", async ({ page }) => {
  // The match starts on `READY_FRAME` with nothing pressed, so it is in the
  // same state on every run, and so is every frame after it that gets the same
  // keys. (A change to the combat rules can move where this lands; it cannot
  // make one run differ from the next.)
  await startMatch(page, { stepped: true });

  // Specifically the CPU's percent, on port 1 — not "somebody's". A player
  // whose inputs go nowhere still watches their own percent climb as the CPU
  // beats on them, so `fighters.some(f => f.damage > 0)` passes cleanly against
  // the exact bug this file exists to catch. The only honest claim is that the
  // *opponent* got hit.
  //
  // The player is played as a player plays, one frame at a time: run at the
  // CPU, attack once it is close and in front, and stand down when dead or
  // reeling. An earlier version ran a fixed back-and-forth pattern blind, and
  // that left the CPU unhurt in about one match in eight, however the clock
  // was kept: in the run traced, it ran the player off the stage and to a
  // finish. The budget is 20 seconds of simulated time. The slowest hit of 120
  // starting frames tried came inside nine.
  const budget = (await simFrame(page)) + 20 * 60;
  const holdKey = keyHolder(page);
  let cpuDamage = 0;
  while (cpuDamage === 0 && (await simFrame(page)) < budget) {
    await playOneFrame(page, holdKey);
    cpuDamage = (await readFighters(page)).find((f) => f.port === 1)?.damage ?? 0;
  }
  await holdKey(null);

  expect(cpuDamage).toBeGreaterThan(0);
});

/** How close, in stage units, the player attacks from: inside a dash attack's reach. */
const ATTACK_RANGE = 22;
/** The player does not run past here (the first stage's ledge is at about 80), so a chase cannot end in a fall. */
const EDGE_MARGIN = 70;

/**
 * Holds one key at a time, through the page's key listeners: `holdKey(code)`
 * lets go of the key held and presses `code`; `holdKey(null)` just lets go.
 */
function keyHolder(page: Page): (code: string | null) => Promise<void> {
  let held: string | null = null;
  return async (code) => {
    if (held === code) return;
    if (held !== null) await page.keyboard.up(held);
    if (code !== null) await page.keyboard.down(code);
    held = code;
  };
}

/** Choose this frame's key from what the fighters are doing, hold it, and run the frame. */
async function playOneFrame(page: Page, holdKey: (code: string | null) => Promise<void>): Promise<void> {
  const fighters = await readFighters(page);
  const me = fighters.find((f) => f.port === 0);
  const cpu = fighters.find((f) => f.port === 1);
  if (!me || !cpu) throw new Error("expected a player on port 0 and the CPU on port 1");

  const toward = cpu.x > me.x ? 1 : -1;
  const level = Math.abs(cpu.y - me.y) < 14;
  const cannotAct = me.action === "dead" || me.action === "entering" || me.action === "hitstun";
  if (cannotAct) await holdKey(null);
  else if (level && Math.abs(cpu.x - me.x) <= ATTACK_RANGE && me.facing === toward) await holdKey(P1.attack);
  else if (Math.abs(me.x + toward * 6) < EDGE_MARGIN) await holdKey(toward > 0 ? P1.right : P1.left);
  else await holdKey(null);
  await stepFrames(page, 1);
}
