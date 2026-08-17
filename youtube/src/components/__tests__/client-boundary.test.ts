// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dirname, join, relative, resolve } from "node:path";

/**
 * The boundary this project got wrong five times.
 *
 * Next turns **every** export of a `"use client"` module into a client
 * *reference* — not only components, but plain strings and pure functions too.
 * A server component that imports one and *calls* it throws at request time:
 *
 *   Attempted to call thumbnailSrc() from the server but thumbnailSrc is on
 *   the client.
 *
 * It happened to `THEME_ATTRIBUTE`, `chipsForFeed`, `historyRowMenu`,
 * `thumbnailSrc` and `shortHref`. The last one alone broke ten routes.
 *
 * Every one of them passed the entire unit suite, because a unit test imports
 * the module directly and never crosses the boundary. Four of the five also
 * passed a route probe, because a `<Suspense>` fallback swallowed the error in
 * development, and one passed a probe against a *production* build too — it
 * only failed once the database had rows, since an empty feed never reached
 * the call.
 *
 * So no amount of ordinary testing finds this. It needs a rule checked
 * structurally, which is what this file is.
 *
 * ## What counts as a violation
 *
 * A file under `src/app/` with no `"use client"` directive — a server
 * component — importing a **value** (a lowercase-initial function or a
 * SCREAMING_CASE constant) that a `"use client"` module exports. Components
 * are fine: rendering a client component from a server one is the entire point
 * of the boundary. Types are fine: they are erased.
 *
 * ## The corollary this also enforces
 *
 * Re-exporting a value *through* a client module does not launder it. The
 * first fix for `chipsForFeed` moved it to a server-safe module and had the
 * client module re-export it for compatibility — and the barrel still
 * forwarded from the client module, so the bug survived its own fix. This
 * check resolves what a barrel forwards, so that shape fails here too.
 */

const SRC = resolve(fileURLToPath(new URL("../../", import.meta.url)));

function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function isClientModule(source: string): boolean {
  return /^\s*["']use client["']/.test(source);
}

/** Value exports: pure functions and constants, never components or types. */
function valueExports(source: string): string[] {
  const names = new Set<string>();
  for (const m of source.matchAll(
    /^export\s+(?:const|function)\s+([a-z][A-Za-z0-9_]*)/gm,
  )) {
    if (m[1]) names.add(m[1]);
  }
  for (const m of source.matchAll(/^export\s+const\s+([A-Z][A-Z0-9_]+)\b/gm)) {
    if (m[1]) names.add(m[1]);
  }
  return [...names];
}

/** `export { a, b } from "./x"` — what a barrel forwards, and from where. */
function reExports(source: string): Array<{ names: string[]; from: string }> {
  const out: Array<{ names: string[]; from: string }> = [];
  for (const m of source.matchAll(
    /export\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g,
  )) {
    const names = (m[1] ?? "")
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n.length > 0 && !n.startsWith("type "))
      .map((n) => (n.split(/\s+as\s+/)[1] ?? n).trim());
    out.push({ names, from: m[2] ?? "" });
  }
  return out;
}

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? join(SRC, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(fromFile), specifier)
      : null;
  if (!base) return null;
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (read(candidate)) return candidate;
  }
  return null;
}

/**
 * Trace a name to its definition, reporting whether **any** module on the way
 * carries `"use client"`.
 *
 * The "any module on the way" part is the whole correctness of this check, and
 * the first version got it wrong: it followed the chain to the defining module
 * and reported only *that* file's directive. Under those semantics a barrel
 * forwarding a value *through* a client module looked clean, which is exactly
 * the bug it was written to catch — `chipsForFeed` had already been moved to a
 * server-safe module, and re-exporting it through `home-feed.tsx` kept it a
 * client reference anyway.
 *
 * The flaw was found by mutation: reintroducing that precise shape left the
 * suite green. A structural check that has never failed is not evidence, and
 * this one had to be made to fail before it was worth keeping.
 */
function origin(
  file: string,
  name: string,
  depth = 0,
  taintedByPath = false,
): { file: string; client: boolean } | null {
  if (depth > 6) return null;
  const source = read(file);
  if (!source) return null;

  const tainted = taintedByPath || isClientModule(source);

  if (valueExports(source).includes(name)) {
    return { file, client: tainted };
  }
  for (const { names, from } of reExports(source)) {
    if (!names.includes(name)) continue;
    const next = resolveSpecifier(file, from);
    if (next) {
      const found = origin(next, name, depth + 1, tainted);
      if (found) return found;
    }
  }
  return null;
}

describe("the server/client boundary", () => {
  /**
   * A plain recursive walk rather than a glob helper: `node:fs`'s `globSync`
   * is not available across the Node versions this repository is expected to
   * build on, and importing it failed the *production build* while leaving the
   * test suite green — which is the same class of mistake this whole file
   * exists to catch.
   */
  const walk = (directory: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  };

  /**
   * `src/components` as well as `src/app`, because a server component does not
   * have to be a page.
   *
   * The first version of this check only walked `src/app`, and missed a real
   * violation for exactly that reason: `video-grid.tsx` carries no directive,
   * renders on the server, and imported its default href builders from the
   * client card module. It threw on the channel page's tab routes — the only
   * ones that fall back to those defaults — while every page file was clean.
   */
  const serverFiles = [...walk(join(SRC, "app")), ...walk(join(SRC, "components"))]
    .filter((f) => !f.includes("__tests__"))
    .filter((f) => !isClientModule(read(f)));

  it("finds server files to check", () => {
    // Guards the guard: a glob that silently matches nothing would make every
    // assertion below vacuously true, which is the classic way a structural
    // check stops checking anything.
    expect(serverFiles.length).toBeGreaterThan(5);
  });

  it("no server component imports a value from a client module", () => {
    const violations: string[] = [];

    for (const file of serverFiles) {
      const source = read(file);
      for (const m of source.matchAll(
        /import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g,
      )) {
        const specifier = m[2] ?? "";
        const target = resolveSpecifier(file, specifier);
        if (!target) continue;

        const imported = (m[1] ?? "")
          .split(",")
          .map((n) => n.trim())
          .filter((n) => n.length > 0 && !n.startsWith("type "))
          .map((n) => (n.split(/\s+as\s+/)[0] ?? n).trim());

        for (const name of imported) {
          // Components are legitimate across the boundary; only values break.
          if (!/^[a-z]/.test(name) && !/^[A-Z][A-Z0-9_]+$/.test(name)) continue;
          const found = origin(target, name);
          if (found?.client) {
            // Names the import path rather than the defining file: when a
            // barrel forwards a value *through* a client module, the
            // definition itself is innocent and saying otherwise sends the
            // reader to the wrong file.
            violations.push(
              `${relative(SRC, file)} imports \`${name}\` via ` +
                `"${specifier}" (defined in ${relative(SRC, found.file)}), and ` +
                `something on that path is a "use client" module. Import it ` +
                `from the module that defines it, and make sure no module on ` +
                `the way carries the directive.`,
            );
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
