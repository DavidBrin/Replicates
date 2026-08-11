/**
 * The layering rule, as code.
 *
 * A rule written in a README decays on the first deadline. A rule that fails
 * the test run does not (DECISIONS D19). Inherited from the sibling project
 * `bet`, where it already earns its keep.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export interface Violation {
  readonly file: string;
  readonly specifier: string;
  readonly rule: string;
}

/** `import x from "y"`, `export … from "y"`, `import("y")`, `require("y")`. */
const SPECIFIER_RE =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;

export function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

export function specifiersIn(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(SPECIFIER_RE)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier) found.push(specifier);
  }
  return found;
}

/**
 * Resolve a specifier to a path under `src`, or null if it leaves the project.
 *
 * Handles both the `@/` alias and relative paths, because a rule that only
 * catches one of them is a rule with an obvious way around it.
 */
export function resolveToSrc(
  specifier: string,
  fromFile: string,
  srcRoot: string,
): string | null {
  if (specifier.startsWith("@/")) {
    return join(srcRoot, specifier.slice(2));
  }
  if (specifier.startsWith(".")) {
    const abs = resolve(dirname(fromFile), specifier);
    const rel = relative(srcRoot, abs);
    return rel.startsWith("..") ? null : abs;
  }
  return null;
}

const BANNED_PACKAGES_IN_DOMAIN = ["next", "react", "react-dom", "server-only"];

export function findViolations(srcRoot: string): Violation[] {
  const violations: Violation[] = [];

  for (const file of walk(srcRoot)) {
    const rel = relative(srcRoot, file).replaceAll("\\", "/");

    // Tests are exempt, and deliberately so. The rule protects the shape of
    // the shipped code; an integration test's whole job is to wire a real
    // adapter to a real service and see whether they actually fit. Excluding
    // them is what stops the rule pushing integration coverage out of the
    // codebase to keep itself green.
    if (rel.includes("__tests__/") || /\.test\.tsx?$/.test(rel)) continue;

    const inDomain = rel.startsWith("domain/");
    const inComponents = rel.startsWith("components/");
    if (!inDomain && !inComponents) continue;

    const source = readFileSync(file, "utf8");

    for (const specifier of specifiersIn(source)) {
      if (inDomain) {
        const bare = specifier.split("/")[0];
        if (BANNED_PACKAGES_IN_DOMAIN.includes(bare) || specifier.startsWith("next/")) {
          violations.push({
            file: rel,
            specifier,
            rule: "domain must not import a framework",
          });
          continue;
        }
      }

      const resolved = resolveToSrc(specifier, file, srcRoot);
      if (!resolved) continue;
      const target = relative(srcRoot, resolved).replaceAll("\\", "/");

      if (inDomain && (target.startsWith("adapters/") || target.startsWith("app/"))) {
        violations.push({
          file: rel,
          specifier,
          rule: "domain must not import adapters or routes",
        });
      }
      if (inComponents && target.startsWith("adapters/")) {
        violations.push({
          file: rel,
          specifier,
          rule: "components must not import adapters",
        });
      }
    }
  }

  return violations;
}
