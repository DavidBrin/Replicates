import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { walkTsFiles } from "./fs-walk";

/**
 * Enforces G1 (docs/plan.md) at the file-system level, independent of the
 * bundler: `src/domain/**` must stay pure TS with no dependency on `next`,
 * `react`, `react-dom`, `@/adapters`, or `@/app`. A regex over the raw
 * import specifiers is deliberately simpler and more trustworthy here than
 * a bundler plugin — it can't be fooled by resolution config, and it runs
 * the same way in CI as it does locally.
 */

const DOMAIN_ROOT = join(__dirname, "..");

const FORBIDDEN_SPECIFIER = /^(next|react|react-dom)(\/|$)|^@\/adapters(\/|$)|^@\/app(\/|$)/;

// Matches `import ... from "specifier"`, `export ... from "specifier"`, and
// bare `import "specifier"`, single- or double-quoted.
const IMPORT_SPECIFIER = /(?:import|export)(?:[^'"]*?from)?\s*["']([^"']+)["']/g;

describe("domain layering (G1)", () => {
  it("finds domain source files to scan", () => {
    const files = walkTsFiles(DOMAIN_ROOT);
    // Guards against the scan silently finding nothing (e.g. a bad root
    // path) and the assertions below passing vacuously.
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it("never imports next, react, react-dom, @/adapters, or @/app", () => {
    const files = walkTsFiles(DOMAIN_ROOT);
    expect(files.length).toBeGreaterThanOrEqual(3);

    const violations: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(IMPORT_SPECIFIER)) {
        const specifier = match[1];
        if (FORBIDDEN_SPECIFIER.test(specifier)) {
          violations.push(`${file} imports "${specifier}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
