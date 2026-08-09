import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { walkTsFiles } from "./fs-walk";
import { extractSpecifiers, isForbiddenImport } from "./layering-guard";

/**
 * Enforces G1 (docs/plan.md) at the file-system level, independent of the
 * bundler: `src/domain/**` must stay pure TS with no dependency on `next`,
 * `react`, `react-dom`, `src/adapters`, or `src/app` — by alias *or* by a
 * relative path that walks up and back down into a sibling directory.
 * Scanning raw import specifiers is deliberately simpler and more
 * trustworthy here than a bundler plugin — it can't be fooled by resolution
 * config, and it runs the same way in CI as it does locally.
 */

const DOMAIN_ROOT = join(__dirname, "..");
const SRC_ROOT = join(__dirname, "..", "..");

describe("domain layering (G1)", () => {
  it("finds domain source files to scan", () => {
    const files = walkTsFiles(DOMAIN_ROOT);
    // Guards against the scan silently finding nothing (e.g. a bad root
    // path) and the assertions below passing vacuously.
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it("never imports next, react, react-dom, or anything under src/adapters or src/app", () => {
    const files = walkTsFiles(DOMAIN_ROOT);
    expect(files.length).toBeGreaterThanOrEqual(3);

    const violations: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const specifier of extractSpecifiers(source)) {
        if (isForbiddenImport(file, specifier, SRC_ROOT)) {
          violations.push(`${file} imports "${specifier}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

/**
 * Regression coverage for the guard's own resolution logic, exercised
 * against fixture strings rather than real files on disk — this is what
 * proves the relative-import bypass (a domain file reaching the adapters
 * directory via a relative, dot-dot path instead of the alias form) is
 * actually caught, without needing to leave an offending file sitting in
 * the tree. See the fixture strings below for the literal specifier text.
 */
describe("layering guard resolution", () => {
  // A hypothetical domain file two directories deep, matching the shape
  // Task 2's `src/domain/pricing/*.ts` will actually have.
  const fakeDomainFile = join(DOMAIN_ROOT, "pricing", "lmsr.ts");

  it("flags a relative import that walks up and back down into src/adapters", () => {
    expect(
      isForbiddenImport(fakeDomainFile, "../../adapters/memory/store", SRC_ROOT),
    ).toBe(true);
  });

  it("flags a relative import that walks up and back down into src/app", () => {
    expect(isForbiddenImport(fakeDomainFile, "../../app/foo", SRC_ROOT)).toBe(
      true,
    );
  });

  it("still flags the alias forms", () => {
    expect(
      isForbiddenImport(fakeDomainFile, "@/adapters/memory/store", SRC_ROOT),
    ).toBe(true);
    expect(isForbiddenImport(fakeDomainFile, "@/app/layout", SRC_ROOT)).toBe(
      true,
    );
  });

  it("flags bare next/react packages and their subpaths", () => {
    expect(isForbiddenImport(fakeDomainFile, "next/font/google", SRC_ROOT)).toBe(
      true,
    );
    expect(isForbiddenImport(fakeDomainFile, "react", SRC_ROOT)).toBe(true);
    expect(isForbiddenImport(fakeDomainFile, "react-dom/client", SRC_ROOT)).toBe(
      true,
    );
  });

  it("does not flag legitimate relative and alias imports within domain/ports", () => {
    expect(isForbiddenImport(fakeDomainFile, "../money", SRC_ROOT)).toBe(false);
    expect(isForbiddenImport(fakeDomainFile, "@/domain/money", SRC_ROOT)).toBe(
      false,
    );
    expect(isForbiddenImport(fakeDomainFile, "@/ports/clock", SRC_ROOT)).toBe(
      false,
    );
  });

  it("does not flag unrelated bare packages", () => {
    expect(isForbiddenImport(fakeDomainFile, "clsx", SRC_ROOT)).toBe(false);
    expect(isForbiddenImport(fakeDomainFile, "zod", SRC_ROOT)).toBe(false);
  });

  it("extracts dynamic import() specifiers, with or without a space before the paren", () => {
    // Built from parts rather than written as literal syntax: this test
    // file lives under src/domain and is itself scanned by the guard, so a
    // fixture that *looks like* a real dynamic import would be matched by
    // extractSpecifiers when it scans this very file and misreported as a
    // real (and, for "react", forbidden) import.
    const dynamicImportKeyword = ["im", "port"].join("");
    const noSpace = `const a = ${dynamicImportKeyword}${'("react");'}`;
    const withSpace = `const b = ${dynamicImportKeyword}${" ('react-dom/client');"}`;

    expect(extractSpecifiers(noSpace)).toEqual(["react"]);
    expect(extractSpecifiers(withSpace)).toEqual(["react-dom/client"]);
  });
});
