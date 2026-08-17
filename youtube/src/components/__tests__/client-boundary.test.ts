// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The boundary this project got wrong five times.
 *
 * Next turns **every** export of a `"use client"` module into a client
 * *reference* — not only components, but plain strings and pure functions too.
 * A server component that imports one and *uses its value* throws at request
 * time:
 *
 *   Attempted to call thumbnailSrc() from the server but thumbnailSrc is on
 *   the client.
 *
 * It happened to `THEME_ATTRIBUTE`, `chipsForFeed`, `historyRowMenu`,
 * `thumbnailSrc` and `shortHref`. One of them alone broke ten routes.
 *
 * Every instance passed the whole unit suite, because a unit test imports the
 * module directly and never crosses the boundary. Four also passed a route
 * probe, because a `<Suspense>` fallback swallowed the error in development.
 * One passed a probe against a *production* build too — it only failed once
 * the database had rows, since an empty feed never reached the call. So no
 * amount of ordinary testing finds this. It needs a rule checked structurally,
 * which is what this file is.
 *
 * ## Why this is an AST walk and not a set of regexes
 *
 * It was regexes, and a review took it apart. They matched `import { a } from`
 * and `export { a } from` and nothing else, so **every other import form was
 * invisible**: a default import, `import * as x`, an `export *` barrel, a
 * dynamic `import()`. The re-export handling read the alias on the wrong side
 * of `as`. And the decision about *what* was dangerous rested on the name —
 * lowercase-initial or SCREAMING_CASE — so a value called `Theme` or `mapURL`
 * was waved through while a component called `renderRow` was flagged.
 *
 * None of that was theoretical: `export *` alone would launder any value in
 * the codebase past the check, and the guard reported clean the whole time.
 * TypeScript is already a dependency and its parser answers all of it exactly,
 * so the heuristics are gone.
 *
 * ## The rule, stated precisely
 *
 * A module with no `"use client"` directive is a server module. If it imports
 * a binding whose resolution passes through **any** `"use client"` module, and
 * it then *uses that binding as a value* — calls it, reads it, spreads it,
 * passes it as an argument — that is a violation.
 *
 * Rendering it as JSX is not. `<Menu />` on a client component is the entire
 * point of the boundary, and a client reference is exactly what React needs
 * there. So the discriminator is **how the identifier is used**, which the AST
 * knows and a naming convention only guesses at. That is what replaced the
 * casing rule, and it is why `VideoCardView` (rendered) and `watchHref`
 * (called) no longer have to be told apart by their capital letters.
 *
 * ## The corollary
 *
 * Re-exporting a value *through* a client module does not launder it. The
 * first fix for `chipsForFeed` moved it to a server-safe module and had the
 * client module re-export it for compatibility — and the barrel still
 * forwarded from the client module, so the bug survived its own fix. Every
 * module on the resolution path is checked, not just the defining one.
 */

const SRC = resolve(fileURLToPath(new URL("../../", import.meta.url)));

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function parse(path: string): ts.SourceFile | null {
  const source = read(path);
  if (source === null) return null;
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/**
 * `"use client"` as the compiler sees it.
 *
 * A directive prologue is an expression statement whose expression is a string
 * literal, before any other statement. Reading it off the AST rather than with
 * `/^\s*["']use client["']/` means a file that opens with a comment, a shebang
 * or a `/** @jsxImportSource *\/` pragma is still classified correctly.
 */
function isClientModule(file: ts.SourceFile): boolean {
  for (const statement of file.statements) {
    if (!ts.isExpressionStatement(statement)) break;
    const { expression } = statement;
    if (!ts.isStringLiteral(expression)) break;
    if (expression.text === "use client") return true;
  }
  return false;
}

/** `@/x` and `./x` to a file on disk. Bare specifiers are node_modules. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? join(SRC, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(fromFile), specifier)
      : null;
  if (base === null) return null;

  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (read(candidate) !== null) return candidate;
  }
  return null;
}

/* ------------------------------------------------------------ resolution -- */

interface Origin {
  /** The module that declares the binding. */
  readonly file: string;
  /** Whether any module on the path from importer to declaration is a client module. */
  readonly throughClient: boolean;
}

/**
 * Follow an exported name to where it is declared, remembering whether the
 * path crossed a client module.
 *
 * Handles every export form TypeScript has: a local declaration, a named
 * re-export with or without an alias, a default re-export, and `export *`.
 * The last is the one the regex version could not see at all.
 */
function origin(
  file: string,
  name: string,
  seen: ReadonlySet<string> = new Set(),
  tainted = false,
): Origin | null {
  if (seen.has(`${file}#${name}`)) return null; // A cycle; not a violation.
  const source = parse(file);
  if (source === null) return null;

  const here = tainted || isClientModule(source);
  const visited = new Set(seen).add(`${file}#${name}`);

  const starExports: string[] = [];

  for (const statement of source.statements) {
    /* export { a, b as c } from "./x"  |  export { a, b as c } */
    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      if (!ts.isNamedExports(statement.exportClause)) continue;
      if (statement.isTypeOnly) continue;

      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;
        // `exported as local` — `element.name` is what importers see and
        // `element.propertyName` is the name in the source module. The regex
        // version read these the wrong way round.
        if (element.name.text !== name) continue;
        const inner = (element.propertyName ?? element.name).text;

        if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
          const next = resolveSpecifier(file, statement.moduleSpecifier.text);
          if (next === null) return { file, throughClient: here };
          const found = origin(next, inner, visited, here);
          if (found) return found;
          continue;
        }
        // A local `export { … }` — the declaration is in this file.
        return { file, throughClient: here };
      }
      continue;
    }

    /* export * from "./x" */
    if (
      ts.isExportDeclaration(statement) &&
      !statement.exportClause &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      !statement.isTypeOnly
    ) {
      starExports.push(statement.moduleSpecifier.text);
      continue;
    }

    /* export default … — declaration or expression */
    if (name === "default") {
      if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
        return { file, throughClient: here };
      }
      if (
        (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
        ts
          .getModifiers(statement)
          ?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
      ) {
        return { file, throughClient: here };
      }
    }

    /* export const x = … | export function x() {} | export class X {} */
    if (
      ts.canHaveModifiers(statement) &&
      ts
        .getModifiers(statement)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
            return { file, throughClient: here };
          }
        }
      }
      if (
        (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
        statement.name?.text === name
      ) {
        return { file, throughClient: here };
      }
    }
  }

  // `export *` last: a named export shadows a starred one, so the explicit
  // forms above have to be exhausted before falling through to these.
  for (const specifier of starExports) {
    const next = resolveSpecifier(file, specifier);
    if (next === null) continue;
    const found = origin(next, name, visited, here);
    if (found) return found;
  }

  return null;
}

/* --------------------------------------------------------------- imports -- */

interface ImportedBinding {
  /** The name as bound in the importing file. */
  readonly local: string;
  /** The name as exported by the target, or `default`. */
  readonly exported: string;
  readonly specifier: string;
}

/**
 * Every value binding a file imports, in every form.
 *
 * Type-only imports are skipped: types are erased and cross the boundary
 * freely. `import * as ns` binds the whole module object, which is a client
 * reference in its entirety, so it is recorded under the sentinel `*`.
 */
function valueImports(source: ts.SourceFile): ImportedBinding[] {
  const out: ImportedBinding[] = [];

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;

    if (clause.name) {
      out.push({ local: clause.name.text, exported: "default", specifier });
    }

    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        out.push({ local: clause.namedBindings.name.text, exported: "*", specifier });
      } else {
        for (const element of clause.namedBindings.elements) {
          if (element.isTypeOnly) continue;
          out.push({
            local: element.name.text,
            exported: (element.propertyName ?? element.name).text,
            specifier,
          });
        }
      }
    }
  }

  return out;
}

/**
 * Is this identifier being used *as a value*, or only rendered?
 *
 * The whole soundness of the check sits here. A client reference may be
 * rendered — `<VideoCardView />` is the boundary working as designed — and may
 * not be called, read, spread or passed. So an occurrence is safe only when it
 * is the tag of a JSX element, and dangerous otherwise.
 *
 * Everything else is deliberately treated as dangerous rather than
 * enumerated: `f()`, `x.y`, `[...x]`, `g(x)`, `{ ...x }`, a template
 * substitution, a default parameter — the list of ways to use a value is
 * open, and a check that allow-lists it is a check with a hole in it.
 */
function usedAsValue(source: ts.SourceFile, local: string): boolean {
  let used = false;

  const isJsxTag = (node: ts.Node): boolean => {
    const parent = node.parent;
    if (!parent) return false;
    if (
      (ts.isJsxOpeningElement(parent) ||
        ts.isJsxSelfClosingElement(parent) ||
        ts.isJsxClosingElement(parent)) &&
      parent.tagName === node
    ) {
      return true;
    }
    // `<ns.Thing />` — the namespace qualifier of a JSX tag.
    if (
      ts.isPropertyAccessExpression(parent) &&
      parent.expression === node &&
      parent.parent &&
      (ts.isJsxOpeningElement(parent.parent) ||
        ts.isJsxSelfClosingElement(parent.parent) ||
        ts.isJsxClosingElement(parent.parent)) &&
      parent.parent.tagName === parent
    ) {
      return true;
    }
    return false;
  };

  const visit = (node: ts.Node): void => {
    if (used) return;

    // Skip the import statement that introduced the binding.
    if (ts.isImportDeclaration(node)) return;
    // A re-export is a forward, not a use — and is caught on the far side.
    if (ts.isExportDeclaration(node)) return;

    if (ts.isIdentifier(node) && node.text === local && !isJsxTag(node)) {
      // A property *name* is not a reference: `{ shortHref: … }` and
      // `obj.shortHref` both contain the identifier and neither reads the
      // import.
      const parent = node.parent;
      const isPropertyName =
        parent &&
        ((ts.isPropertyAccessExpression(parent) && parent.name === node) ||
          (ts.isPropertyAssignment(parent) && parent.name === node) ||
          (ts.isPropertySignature(parent) && parent.name === node) ||
          (ts.isJsxAttribute(parent) && parent.name === node));
      if (!isPropertyName) {
        used = true;
        return;
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
  return used;
}

/* ------------------------------------------------------------------ walk -- */

function walk(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("the server/client boundary", () => {
  /**
   * `src/app` and `src/components` both, because a server component does not
   * have to be a page.
   *
   * The first version of this check only walked `src/app`, and missed a real
   * violation for exactly that reason: `video-grid.tsx` carries no directive,
   * renders on the server, and imported its default href builders from the
   * client card module. It threw on the channel page's tab routes — the only
   * ones that fall back to those defaults — while every page file was clean.
   */
  const serverFiles = [...walk(join(SRC, "app")), ...walk(join(SRC, "components"))]
    .filter((file) => !file.includes("__tests__"))
    .filter((file) => {
      const source = parse(file);
      return source !== null && !isClientModule(source);
    });

  it("finds server files to check", () => {
    // Guards the guard: a walk that silently matched nothing would make every
    // assertion below vacuously true, which is the classic way a structural
    // check stops checking anything.
    expect(serverFiles.length).toBeGreaterThan(5);
  });

  it("no server component uses a value that came through a client module", () => {
    const violations: string[] = [];

    for (const file of serverFiles) {
      const source = parse(file);
      if (source === null) continue;

      for (const binding of valueImports(source)) {
        const target = resolveSpecifier(file, binding.specifier);
        if (target === null) continue;

        // A namespace import binds the whole module. Any use of it is a use of
        // a client reference if the target is a client module.
        const found =
          binding.exported === "*"
            ? ((): Origin | null => {
                const parsed = parse(target);
                return parsed === null
                  ? null
                  : { file: target, throughClient: isClientModule(parsed) };
              })()
            : origin(target, binding.exported);

        if (!found?.throughClient) continue;
        if (!usedAsValue(source, binding.local)) continue;

        violations.push(
          `${relative(SRC, file)} uses \`${binding.local}\` as a value. It is ` +
            `imported from "${binding.specifier}" (declared in ` +
            `${relative(SRC, found.file)}) and something on that path is a ` +
            `"use client" module, so it is a client reference at runtime. ` +
            `Import it from the module that declares it, and make sure no ` +
            `module on the way carries the directive.`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
