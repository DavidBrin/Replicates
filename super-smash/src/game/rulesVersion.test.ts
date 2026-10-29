import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ENGINE_RULES_VERSION } from "@/engine/constants";
import { FNV_OFFSET, mixInt, mixString } from "@/engine/hash";

/**
 * What keeps the rules version honest (Plan 3, Task 20).
 *
 * `ENGINE_RULES_VERSION` is bumped by hand, once per plan, so that two peers on
 * builds from either side of a plan refuse each other online
 * (`engineFingerprint`). Inside a plan the rules still move task by task, and
 * the one record of what `step()` does is the golden trace (`golden.test.ts`):
 * any change that makes the engine behave differently fails that test until the
 * trace is regenerated. So the trace's digest is pinned here beside the version,
 * and a regenerated trace fails this test until the pin is rewritten on purpose.
 *
 * To clear a failure here:
 * - Because you regenerated the golden trace inside a plan: set
 *   `RULES_PIN.golden` to the digest the failure prints. Leave the versions.
 * - Because a new plan changes what `step()` does for the first time: bump
 *   `ENGINE_RULES_VERSION` (src/engine/constants.ts) and `RULES_PIN.version`
 *   together, once, and set `RULES_PIN.golden` too if its trace moved.
 *
 * What it cannot see: a change to behaviour the six golden matches do not
 * exercise, and the difference between a bump and a rewrite of the pin by hand
 * (the version beside the digest in the diff is what a reviewer checks).
 */
const RULES_PIN = { version: 4, golden: "f9971fe8" } as const;

const FIXTURE = join(import.meta.dirname, "__golden__", "engine-trace.json");

/** The trace's digests, in order, as 8 hex digits: the same FNV-1a the engine's state hash uses. */
function goldenDigest(): string {
  const trace = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, number[]>;
  let h = FNV_OFFSET;
  for (const name of Object.keys(trace).sort()) {
    h = mixString(h, name);
    h = mixInt(h, trace[name].length);
    for (const digest of trace[name]) h = mixInt(h, digest);
  }
  return h.toString(16).padStart(8, "0");
}

describe("the engine rules version", () => {
  it("is pinned to the golden trace: a regenerated trace is looked at on purpose", () => {
    const digest = goldenDigest();
    expect(
      digest,
      `src/game/__golden__/engine-trace.json changed, so step() behaves differently. Inside a plan, set RULES_PIN.golden in src/game/rulesVersion.test.ts to "${digest}" and leave the version; the first behaviour change of a new plan also bumps ENGINE_RULES_VERSION and RULES_PIN.version together`,
    ).toBe(RULES_PIN.golden);
  });

  it("is bumped with its pin, once per plan, and by nothing else", () => {
    expect(
      ENGINE_RULES_VERSION,
      "ENGINE_RULES_VERSION (src/engine/constants.ts) and RULES_PIN.version move together, once per plan: a new plan bumps both, and nothing else touches either",
    ).toBe(RULES_PIN.version);
  });
});
