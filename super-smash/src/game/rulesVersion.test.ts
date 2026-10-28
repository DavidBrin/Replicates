import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ENGINE_RULES_VERSION } from "@/engine/constants";
import { mixInt, mixString } from "@/engine/hash";

/**
 * What makes a rules change impossible to forget (Plan 3, Task 20).
 *
 * `ENGINE_RULES_VERSION` is bumped by hand, and a hand bump can be missed. The
 * one record of what `step()` does is the golden trace (`golden.test.ts`): any
 * change that makes the engine behave differently fails that test until the
 * trace is regenerated. So the trace's own digest is pinned here beside the
 * version it belongs to, and a regenerated trace fails this test until the pin
 * is rewritten, which is where the version is.
 *
 * To clear a failure here, because you regenerated the trace:
 *   1. bump `ENGINE_RULES_VERSION` in src/engine/constants.ts by one;
 *   2. set `RULES_PIN` below to the new version and the digest the failure prints.
 * Two peers on different versions refuse each other online (`engineFingerprint`),
 * and one that forgot the bump would play on and desync at the first changed hit.
 *
 * The pin cannot tell a bump from a rewrite of the old pin's digest alone; the
 * version beside it in the diff is what a reviewer checks.
 */
const RULES_PIN = { version: 3, golden: "ac146651" } as const;

const FIXTURE = join(import.meta.dirname, "__golden__", "engine-trace.json");

/** The trace's digests, in order, as 8 hex digits: the same FNV-1a the engine's state hash uses. */
function goldenDigest(): string {
  const trace = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, number[]>;
  let h = 0x811c9dc5;
  for (const name of Object.keys(trace).sort()) {
    h = mixString(h, name);
    h = mixInt(h, trace[name].length);
    for (const digest of trace[name]) h = mixInt(h, digest);
  }
  return h.toString(16).padStart(8, "0");
}

describe("the engine rules version", () => {
  it("moves with the golden trace: a change in what step() does bumps it", () => {
    expect(
      goldenDigest(),
      "src/game/__golden__/engine-trace.json changed, so step() now behaves differently. Bump ENGINE_RULES_VERSION (src/engine/constants.ts) and set RULES_PIN in this file to the new version and this digest",
    ).toBe(RULES_PIN.golden);
    expect(ENGINE_RULES_VERSION, "ENGINE_RULES_VERSION and RULES_PIN.version must be bumped together, with the new golden digest").toBe(
      RULES_PIN.version,
    );
  });
});
