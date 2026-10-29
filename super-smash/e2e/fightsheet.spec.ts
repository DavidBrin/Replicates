import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

const run = promisify(execFile);

/**
 * `scripts/fightsheet.mjs` photographs a move as the match plays it, and the one
 * thing it must never do is photograph a different move under the name asked for.
 * A keyboard cannot throw a tilt (direction and attack press on one frame, so it
 * reads as a smash or a dash attack; `Btn.Soft` comes only from an analog stick,
 * `input/gamepad.ts`), so the tilts are driven with a fake pad. The script prints
 * the move the match played, and exits 1 when it is not the one asked for.
 *
 * The captures go to Playwright's output folder (`test-results/`, git-ignored): a
 * picture of a model is never committed.
 */
test("fightsheet captures each tilt as that tilt, not as a smash or a dash attack", async ({ baseURL }, testInfo) => {
  test.setTimeout(180_000);
  for (const move of ["ftilt", "utilt", "dtilt"]) {
    const out = testInfo.outputPath(`fight-mario-${move}.png`);
    const { stdout } = await run(process.execPath, ["scripts/fightsheet.mjs", "--fighter", "mario", "--move", move, "--base", baseURL!, "--out", out], {
      cwd: process.cwd(),
      timeout: 120_000,
    });
    expect(stdout, move).toContain(`mario ${move} (performed ${move})`);
  }
});
