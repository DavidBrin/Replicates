import { expect, test, type Page } from "@playwright/test";
import {
  P1,
  ROUTES,
  readFighters,
  readInputs,
  startFromTitle,
  startMatch,
  startMatchFromMenu,
  stepFrames,
  type DebugFighter,
  type MatchOptions,
} from "./helpers";

/**
 * Plan 5's control options on /controls: Stick Jump per player (Task 20), a
 * gamepad remap captured from a real `navigator.getGamepads()` poll, with the
 * right stick's mode (Task 21), and the keyboard's Tilt key (Task 21b).
 *
 * Each option has to reach a running match, not just the store: the lesson of
 * `rebinding.spec.ts`, where every layer was right on its own and the match
 * read none of it. So each match test sets its option on /controls and plays
 * in the same page session, since the match configuration is a client-side
 * store that a reload would wipe.
 *
 * No pad is plugged into the test browser, so a fake one stands behind the
 * API; the page cannot tell the difference, because the API is all it ever
 * reads. It reports the W3C "standard" mapping, without which the right stick
 * is never read. A match polls it once a simulation frame (`runner.advance`,
 * which `__smashDebug.step` runs), so a stepped match reads exactly what the
 * test set before each step.
 *
 * Every match here is stepped: inputs are held for counted simulation frames,
 * not milliseconds, and the fighter is read after every frame, so a jumpsquat
 * three frames long cannot fall between two samples. And P2 is a human nobody
 * plays (`idleP2`), not the CPU, so nothing races the test: it is checked to
 * stand still, and to have been given no input at all, on every frame read (a
 * Tilt or a stick short of the walk threshold would leave it standing). A
 * fighter that should do nothing is
 * checked to have only stood, so a wrong action cannot hide a jump.
 */

/** A key that no preset claims, so it cannot pass by coincidence. */
const NEW_TILT = "KeyM";

/** Every match here: stepped, against a P2 nobody plays. */
const MATCH: MatchOptions = { stepped: true, idleP2: true };

/** What the fake pad holds: button numbers in the standard mapping (0 is A, 3 is Y), and its four axes. */
interface FakePad {
  __padPressed: number[];
  __padAxes: number[];
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as FakePad;
    w.__padPressed = [];
    w.__padAxes = [0, 0, 0, 0];
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [
        {
          index: 0,
          id: "e2e pad",
          connected: true,
          mapping: "standard",
          axes: [...w.__padAxes],
          buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: w.__padPressed.includes(i), touched: false, value: w.__padPressed.includes(i) ? 1 : 0 })),
        },
      ],
    });
  });
});

/** Hold exactly these pad buttons from now on; `[]` lets go of every one. */
async function setPadButtons(page: Page, buttons: readonly number[]): Promise<void> {
  await page.evaluate((b) => {
    (window as unknown as FakePad).__padPressed = [...b];
  }, buttons);
}

/** Set the pad's axes: left stick x and y, then right stick x and y, each -1 to 1 (+y is down, as pads report it). */
async function setPadAxes(page: Page, axes: readonly number[]): Promise<void> {
  await page.evaluate((a) => {
    (window as unknown as FakePad).__padAxes = [...a];
  }, axes);
}

/**
 * Port 0 after each of `frames` simulation frames, run one at a time, with
 * whatever is held. P2 is checked on every one of them: it stands still, and
 * its input frame is 0, or something other than the test is playing the match.
 */
async function eachFrame(page: Page, frames: number): Promise<DebugFighter[]> {
  const seen: DebugFighter[] = [];
  for (let i = 0; i < frames; i++) {
    await stepFrames(page, 1);
    const [p1, p2] = await readFighters(page);
    expect(p2.action, `P2 is not idle: ${p2.action}`).toBe("stand");
    const [, p2Input] = await readInputs(page);
    expect(p2Input, `P2 was given input ${p2Input}`).toBe(0);
    seen.push(p1);
  }
  return seen;
}

/** Port 0 after each of `frames` frames with `codes` held: pressed before the first frame, released after the last. */
async function whileHoldingKeys(page: Page, codes: readonly string[], frames: number): Promise<DebugFighter[]> {
  for (const code of codes) await page.keyboard.down(code);
  const seen = await eachFrame(page, frames);
  for (const code of codes) await page.keyboard.up(code);
  return seen;
}

/** The same with the pad's `buttons` held. */
async function whilePressingPad(page: Page, buttons: readonly number[], frames: number): Promise<DebugFighter[]> {
  await setPadButtons(page, buttons);
  const seen = await eachFrame(page, frames);
  await setPadButtons(page, []);
  return seen;
}

/** Both fighters stand as the match is handed over: port 0 to be played, P2 idle. */
async function expectBothStanding(page: Page): Promise<void> {
  const [p1, p2] = await readFighters(page);
  expect([p1.action, p2.action], "at the start, P1 and P2 should both stand").toEqual(["stand", "stand"]);
}

/** Run frames, with nothing held, until port 0 stands again out of a move's end lag. */
async function untilStanding(page: Page, limit = 90): Promise<void> {
  for (let i = 0; i < limit && (await readFighters(page))[0].action !== "stand"; i++) await eachFrame(page, 1);
  expect((await readFighters(page))[0].action, `port 0 was not standing again ${limit} frames later`).toBe("stand");
}

/** The action states passed through, each once, in order. */
const statesOf = (seen: readonly DebugFighter[]): string[] => [...new Set(seen.map((f) => f.action))];

/** The first move started, or null. */
const firstMove = (seen: readonly DebugFighter[]): string | null => seen.find((f) => f.move !== null)?.move ?? null;

/** Each frame's action, and its move if any, for a failure message. */
const played = (seen: readonly DebugFighter[]): string => seen.map((f) => (f.move ? `${f.action}/${f.move}` : f.action)).join(", ");

const jumping = /^(jumpSquat|jump|fall)$/;

/** From the title to /controls through the menu, keeping the page session. */
async function openControls(page: Page): Promise<void> {
  await startFromTitle(page);
  await page.getByRole("link", { name: /controls/i }).click();
  await page.waitForURL("**/controls");
}

/** Back from /controls to the menu, the way a player goes. */
async function backToMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: /back to the main menu/i }).click();
  await page.waitForURL("**/menu");
}

test("stick jump can be turned off for player 1", async ({ page }) => {
  await page.goto(ROUTES.controls);
  const toggle = page.getByRole("switch", { name: "P1 stick jump", exact: true });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
});

test("a gamepad button is rebound by pressing it", async ({ page }) => {
  await page.goto(ROUTES.controls);
  await page.getByRole("button", { name: "P1 attack: A", exact: true }).click();
  await expect(page.getByText("Press a button on your gamepad…", { exact: true })).toBeVisible();
  await setPadButtons(page, [3]);
  await expect(page.getByRole("button", { name: "P1 attack: Y", exact: true })).toBeVisible();
  // Y has left jump. Exact, as every name here: a string name is otherwise a
  // substring match, and "P1 jump: X/Y" would pass for "P1 jump: X".
  await expect(page.getByRole("button", { name: "P1 jump: X", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "P1 right stick", exact: true }).selectOption("special");
  await expect(page.getByRole("combobox", { name: "P1 right stick", exact: true })).toHaveValue("special");
});

test("stick jump off reaches the match: up no longer jumps but still up-tilts, and the jump button still jumps", async ({ page }) => {
  await openControls(page);
  const toggle = page.getByRole("switch", { name: "P1 stick jump", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await backToMenu(page);
  await startMatchFromMenu(page, MATCH);
  await expectBothStanding(page);

  // Twelve frames: with Stick Jump on, a held up jumps once five pass unclaimed.
  await page.keyboard.down(P1.up);
  const onUp = await eachFrame(page, 12);
  expect(statesOf(onUp), `up did more than stand: ${statesOf(onUp).join(", ")}`).toEqual(["stand"]);
  // Up is still up, which is what the option is for: Attack with it held is an
  // up tilt. Without this, an option that swallowed Up whole would pass.
  const upAttack = await whileHoldingKeys(page, [P1.attack], 3);
  await page.keyboard.up(P1.up);
  expect(firstMove(upAttack), `up and Attack: ${played(upAttack)}`).toBe("utilt");

  await untilStanding(page);
  // The positive half, without which "nothing jumps" would pass a fighter that never moves.
  const onJump = await whileHoldingKeys(page, [P1.jump], 8);
  expect(statesOf(onJump).some((a) => jumping.test(a)), `the jump button did nothing: ${statesOf(onJump).join(", ")}`).toBe(true);
});

test("a rebound pad button plays the match: the new button attacks, the old one does nothing", async ({ page }) => {
  await openControls(page);
  await page.getByRole("button", { name: "P1 attack: A", exact: true }).click();
  await setPadButtons(page, [3]);
  await expect(page.getByRole("button", { name: "P1 attack: Y", exact: true })).toBeVisible();
  // Let go before the match: a button down when it starts reads as a press on its first frame.
  await setPadButtons(page, []);
  await backToMenu(page);
  await startMatchFromMenu(page, MATCH);
  await expectBothStanding(page);

  const onOld = await whilePressingPad(page, [0], 8);
  expect(statesOf(onOld), `A did more than stand: ${statesOf(onOld).join(", ")}`).toEqual(["stand"]);
  await eachFrame(page, 4);
  const onNew = await whilePressingPad(page, [3], 8);
  expect(statesOf(onNew).some((a) => a === "attack"), `Y did not attack: ${statesOf(onNew).join(", ")}`).toBe(true);
});

test("the right stick set to special plays the match: a flick is a side special, not a smash", async ({ page }) => {
  await openControls(page);
  const stick = page.getByRole("combobox", { name: "P1 right stick", exact: true });
  await stick.selectOption("special");
  await expect(stick).toHaveValue("special");
  await backToMenu(page);
  await startMatchFromMenu(page, MATCH);
  await expectBothStanding(page);

  // A flick starts from rest: the stick arms only once a poll has read it
  // there. It has been at rest on every frame so far; one more says so.
  await eachFrame(page, 1);
  await setPadAxes(page, [0, 0, 1, 0]);
  const flick = await eachFrame(page, 6);
  await setPadAxes(page, [0, 0, 0, 0]);
  // On the default setting, the same flick is a forward smash.
  expect(firstMove(flick), `the flick right was not a side special: ${played(flick)}`).toBe("sideB");
});

test("the keyboard's Tilt key, from stand: Tilt + Right and Attack is a forward tilt; Tilt + Up never jumps, and Attack is an up tilt", async ({
  page,
}) => {
  await startMatch(page, MATCH);
  await expectBothStanding(page);
  await page.keyboard.down(P1.tilt);
  await page.keyboard.down(P1.right);
  await eachFrame(page, 1);
  // A frame after a fresh Right: without Tilt, inside the smash window, a forward smash.
  const forward = await whileHoldingKeys(page, [P1.attack], 3);
  await page.keyboard.up(P1.right);
  await page.keyboard.up(P1.tilt);
  expect(firstMove(forward), `Tilt + Right and Attack: ${played(forward)}`).toBe("ftilt");

  await untilStanding(page);
  await page.keyboard.down(P1.tilt);
  await page.keyboard.down(P1.up);
  // Twelve frames: without Tilt, a held up jumps once five pass unclaimed.
  const held = await eachFrame(page, 12);
  expect(statesOf(held), `Tilt + Up did more than stand: ${statesOf(held).join(", ")}`).toEqual(["stand"]);
  const up = await whileHoldingKeys(page, [P1.attack], 3);
  await page.keyboard.up(P1.up);
  await page.keyboard.up(P1.tilt);
  expect(firstMove(up), `Tilt + Up and Attack: ${played(up)}`).toBe("utilt");
});

test("a Tilt key rebound on /controls plays the match: the new key holds up short of a jump, the old one no longer does", async ({ page }) => {
  await openControls(page);
  await page.getByRole("button", { name: /^Rebind Tilt/i }).click();
  await page.keyboard.press(NEW_TILT);
  await expect(page.getByRole("button", { name: /^Rebind Tilt, currently M$/i })).toBeVisible();
  await backToMenu(page);
  await startMatchFromMenu(page, MATCH);
  await expectBothStanding(page);

  // Twelve frames: a full up jumps once five pass unclaimed, and a soft one never does.
  const onNew = await whileHoldingKeys(page, [NEW_TILT, P1.up], 12);
  expect(statesOf(onNew), `the rebound Tilt key + up did more than stand: ${statesOf(onNew).join(", ")}`).toEqual(["stand"]);
  await eachFrame(page, 4);
  const onOld = await whileHoldingKeys(page, [P1.tilt, P1.up], 12);
  expect(statesOf(onOld).some((a) => jumping.test(a)), `the old Tilt key still softened up: ${statesOf(onOld).join(", ")}`).toBe(true);
});
