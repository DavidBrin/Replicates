import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every change to a fighter's velocity goes through the KineticModule.
 *
 * `vx`/`vy` are the *sum* of the energies (`kinetic.ts`). A direct write to
 * one makes the sum and the energies disagree; `kineticAdopt` papers over it by
 * folding the difference into a carrier, which is right for the legacy code it
 * was built for and wrong for anything that also holds a launch or a scripted
 * motion — the difference lands on the wrong energy and decays by the wrong
 * rule. So the engine may not write them, outside `kinetic.ts`, except on a
 * line that says it is legacy and names the task that removes it.
 *
 * Projectiles (`p.vx`) and the Smash Ball (`ball.vx`) are not fighters.
 */

const ENGINE = join(process.cwd(), "src", "engine");
const MARKER = "kinetic: legacy-write";
const WRITE = /\b(?!(?:p|ball)\.)[A-Za-z_]\w*\.v[xy]\s*(?:[-+*/]?=)(?!=)/;

/** Every non-test source under `dir`, recursively, as [path relative to `dir`, text]. */
function walk(dir: string, rel = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const name = rel === "" ? entry : `${rel}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...walk(full, name));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push([name, readFileSync(full, "utf8")]);
  }
  return out;
}

function sources(): [string, string][] {
  return walk(ENGINE).filter(([name]) => name !== "kinetic.ts");
}

describe("fighter velocity writes", () => {
  it("happen only through kinetic.ts, or on a marked legacy line", () => {
    const violations: string[] = [];
    for (const [file, src] of sources()) {
      src.split("\n").forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
        if (!WRITE.test(line)) return;
        if (line.includes(MARKER)) return;
        violations.push(`${file}:${i + 1} ${code}`);
      });
    }
    expect(violations).toEqual([]);
  });

  it("walks subdirectories, so engine/status/ and engine/acmd/ are guarded too", () => {
    const names = walk(join(process.cwd(), "src")).map(([name]) => name);
    expect(names).toContain("engine/simulate.ts");
    expect(names).toContain("engine/kinetic.ts");
  });

  it("catches the write it exists to catch", () => {
    expect(WRITE.test("    f.vx = 0;")).toBe(true);
    expect(WRITE.test("    victim.vy += 1;")).toBe(true);
    expect(WRITE.test("    p.vx = -p.vx;")).toBe(false);
    expect(WRITE.test("    if (f.vy === 0) return;")).toBe(false);
    expect(WRITE.test("    const v = f.vx;")).toBe(false);
  });
});
