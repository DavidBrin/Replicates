import { dirname, resolve, sep } from "node:path";

/** Bare package specifiers forbidden outright, regardless of resolution:
 * next, any next subpath, react, and react-dom (including its subpaths). */
export const FORBIDDEN_BARE_PACKAGE = /^(next|react|react-dom)(\/|$)/;

/**
 * Recognizes every shape a module specifier can appear in: a static import
 * or export with a trailing "from" clause, a bare side-effect-only import
 * with no "from" clause, and a dynamic call form, which likewise has no
 * "from" clause and may or may not have a space before its opening
 * parenthesis.
 *
 * NOTE for anyone editing this file: keep example specifier strings in
 * comments split (e.g. string concatenation, or spelled out in prose)
 * rather than written as literal syntax — this file lives under
 * src/domain and is itself scanned by layering.test.ts, so a comment that
 * accidentally *looks like* a real import/export statement gets matched by
 * this very regex and reported as a false violation.
 */
export const IMPORT_SPECIFIER =
  /(?:import|export)(?:[^'"(]*?from)?\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

export function extractSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[1] ?? match[2];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

function isInside(candidate: string, dir: string): boolean {
  const normalizedDir = dir.endsWith(sep) ? dir : dir + sep;
  return candidate === dir || candidate.startsWith(normalizedDir);
}

/**
 * Resolves a module specifier written inside `file` (an absolute path) to
 * an absolute path, or `null` if it is a bare package specifier with
 * nothing to resolve (an unscoped package name with no leading dot or
 * alias, e.g. a styling utility library or a next subpath).
 *
 * Handles both the `@` path alias and relative (dot-prefixed) specifiers.
 * This matters because the domain, adapters and app directories are
 * siblings under src: a domain file can reach the adapters directory just
 * as easily by walking up and back down through a relative path as it can
 * through the alias, and string-matching only the alias prefix misses that
 * route entirely.
 */
export function resolveSpecifier(
  file: string,
  specifier: string,
  srcRoot: string,
): string | null {
  if (specifier.startsWith(".")) {
    return resolve(dirname(file), specifier);
  }
  if (specifier.startsWith("@/")) {
    return resolve(srcRoot, specifier.slice(2));
  }
  return null;
}

/** True if `specifier`, written inside `file`, is forbidden under G1: a bare
 * next/react/react-dom import, or anything — alias or relative — that
 * resolves inside the adapters or app directories under `srcRoot`. */
export function isForbiddenImport(
  file: string,
  specifier: string,
  srcRoot: string,
): boolean {
  if (FORBIDDEN_BARE_PACKAGE.test(specifier)) return true;

  const resolved = resolveSpecifier(file, specifier, srcRoot);
  if (resolved === null) return false;

  return (
    isInside(resolved, resolve(srcRoot, "adapters")) ||
    isInside(resolved, resolve(srcRoot, "app"))
  );
}
