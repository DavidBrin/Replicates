import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

const run = promisify(execFile);

/**
 * `scripts/fightsheet.mjs` photographs a move as the match plays it, and the one
 * thing it must never do is photograph a different move under the name asked for.
 * A keyboard reaches a standing tilt only with its Tilt key held (Plan 5, Task 21b):
 * without it, direction and attack read as a smash or a dash attack. The script
 * throws its tilts the other way, with a fake pad's part-way push (`Btn.Soft`,
 * `input/gamepad.ts`). The script prints
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
