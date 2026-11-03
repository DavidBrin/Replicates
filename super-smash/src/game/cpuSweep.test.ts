// @vitest-environment node
/**
 * The CPU sweep (Plan 6, Tasks 23-27). The full measure is opt-in:
 * `CPU_SWEEP=1 pnpm vitest run src/game/cpuSweep.test.ts --reporter=verbose` prints the figures a
 * CPU task reports in its commit (`--reporter=verbose`: vitest 4's default reporter drops a passing
 * test's output when it goes to a file); `pnpm test` skips it. A short run stays in the suite, so
 * the harness itself keeps working.
 */

import { describe, expect, it } from "vitest";

import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";
import { sweep } from "./cpuSweep";

const IDS = FIGHTERS.map((f) => f.id);
const PAIRS = IDS.flatMap((a) => IDS.filter((b) => b !== a).map((b) => [a, b] as const));
/** The sweep's seeds: 1-6 (2,016 matches), or `CPU_SWEEP_SEEDS`, comma-separated, for one half of them. */
const SEEDS = (process.env.CPU_SWEEP_SEEDS ?? "1,2,3,4,5,6").split(",").map(Number);

describe("the CPU sweep's harness", () => {
  it("plays a short match to its end and counts it", () => {
    const stats = sweep({ pairs: [["mario", "fox"]], stages: ["battlefield"], seeds: [1], frames: 240, ball: false, level: 9 });
    expect(stats.matches).toBe(1);
    expect(stats.longestStandby).toBe(0);
    expect(stats.holds).toEqual({});
  }, 60_000);
});

describe.skipIf(process.env.CPU_SWEEP !== "1")("the CPU sweep (opt-in)", () => {
  it("measures the 56 ordered pairs on the six stages, the Smash Ball on, each seed", () => {
    const stats = sweep({ pairs: PAIRS, stages: STAGES.map((s) => s.id), seeds: SEEDS, frames: 3_600, ball: true, level: 9 });
    console.log(JSON.stringify(stats, null, 2));
    // Ruling R-P6-19's figures, one line a fighter: landed, and the mean hold.
    for (const id of IDS) {
      const f = stats.finalSmashes[id] ?? { fired: 0, landed: 0 };
      const h = stats.holds[id] ?? { holds: 0, frames: 0 };
      console.log(`${id}: fired ${f.fired}, landed ${f.landed}, holds ${h.holds}, mean hold ${h.holds === 0 ? 0 : Math.round(h.frames / h.holds)} frames`);
    }
    expect(stats.matches).toBe(PAIRS.length * STAGES.length * SEEDS.length);
  }, 3_600_000);
});
