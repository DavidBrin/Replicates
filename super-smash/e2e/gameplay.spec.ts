import { expect, test } from "@playwright/test";
import { P1, holdFor, readFighters, startMatch } from "./helpers";

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
 */

// Deliberately not serial. Each test drives the menu into its own match and
// shares no state, and serial mode would abandon the remaining three the moment
// one failed — which is the opposite of what you want from the suite whose job
// is to say *which* inputs are dead.

test("holding a direction moves the player's fighter", async ({ page }) => {
  await startMatch(page);

  const before = await readFighters(page);
  expect(before.length).toBeGreaterThan(1);
  const startX = before[0].x;

  await holdFor(page, P1.right, 30);
  const afterRight = (await readFighters(page))[0];
  expect(afterRight.x).toBeGreaterThan(startX);

  // And back, so the test cannot pass on a fighter that merely drifts — a
  // one-directional assertion would be satisfied by knockback, by a slope, or
  // by the CPU shoving them.
  await holdFor(page, P1.left, 45);
  const afterLeft = (await readFighters(page))[0];
  expect(afterLeft.x).toBeLessThan(afterRight.x);
});

test("the jump key leaves the ground", async ({ page }) => {
  await startMatch(page);

  const groundY = (await readFighters(page))[0].y;

  await page.keyboard.down(P1.jump);
  // Past the 3-frame jumpsquat and into the rise, but well short of the apex.
  await page.waitForTimeout(150);
  const airborne = (await readFighters(page))[0];
  await page.keyboard.up(P1.jump);

  expect(airborne.y).toBeGreaterThan(groundY);
});

test("the attack key puts the fighter into an attacking state", async ({ page }) => {
  await startMatch(page);

  await page.keyboard.down(P1.attack);
  await page.waitForTimeout(80);
  const acting = (await readFighters(page))[0];
  await page.keyboard.up(P1.attack);

  // Any attack state will do — which one depends on whether a direction was
  // fresh, and that timing distinction has its own tests in the engine. The
  // claim here is only that the button reached the simulation at all.
  expect(acting.action).toMatch(/jab|tilt|smash|attack|aerial|dash/i);
});

test("the player can actually damage the CPU", async ({ page }) => {
  await startMatch(page);

  // Specifically the CPU's percent, on port 1 — not "somebody's". A player
  // whose inputs go nowhere still watches their own percent climb as the CPU
  // beats on them, so `fighters.some(f => f.damage > 0)` passes cleanly against
  // the exact bug this file exists to catch. The only honest claim is that the
  // *opponent* got hit.
  const deadline = Date.now() + 20_000;
  let cpuDamage = 0;
  while (Date.now() < deadline && cpuDamage === 0) {
    await holdFor(page, P1.right, 14);
    await holdFor(page, P1.attack, 4);
    await holdFor(page, P1.left, 14);
    await holdFor(page, P1.attack, 4);
    const fighters = await readFighters(page);
    cpuDamage = fighters.find((f) => f.port === 1)?.damage ?? 0;
  }

  expect(cpuDamage).toBeGreaterThan(0);
});
