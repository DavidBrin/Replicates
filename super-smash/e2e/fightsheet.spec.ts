import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
 * The captures go to a temporary directory outside the repo and are deleted after the
 * run, even on a failure: with the models built locally they are real-model frames, and
 * a picture of a model is never kept in the repo (R-P6-6, R-P6-21). The spec asserts
 * only on the script's output.
 */
test("fightsheet captures each tilt as that tilt, not as a smash or a dash attack", async ({ baseURL }) => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), "fightsheet-"));
  try {
    for (const move of ["ftilt", "utilt", "dtilt"]) {
      const out = join(dir, `fight-mario-${move}.png`);
      const { stdout } = await run(process.execPath, ["scripts/fightsheet.mjs", "--fighter", "mario", "--move", move, "--base", baseURL!, "--out", out], {
        cwd: process.cwd(),
        timeout: 120_000,
      });
      expect(stdout, move).toContain(`mario ${move} (performed ${move})`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
