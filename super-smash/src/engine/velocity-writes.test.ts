import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Every change to a fighter's velocity goes through the KineticModule.
 *
 * `vx`/`vy` are the *sum* of the energies (`kinetic.ts`). A direct write to
 * one makes the sum and the energies disagree; `kineticAdopt` papers over it by
 * folding the difference into a carrier, which is right for the legacy code it
 * was built for and wrong for anything that also holds a launch or a scripted
 * motion — the difference lands on the wrong energy and decays by the wrong
 * rule. So nothing outside `kinetic.ts` may write them, except on a line that
 * says it is legacy and names the task that removes it:
 *
 *   f.vy = m.y; // kinetic: legacy-write (Task 18 moves this to MOTION)
 *
 * The marker covers the write it is on: a comment on any line of the write
 * (the whole expression for an assignment or `++`/`--`; just the target for a
 * `for…in/of`; the call's first line through its first argument for
 * `Object.assign` and friends, so a marker inside a loop body or an object
 * literal's payload covers nothing), or a comment standing alone on the line
 * just above it. A *trailing* marker never reaches the next line:
 * `f.vx = 0; // kinetic: legacy-write (Task 18)` does not excuse an unmarked
 * `f.vy = 0;` below it.
 *
 * **How it looks.** A line regex cannot see `s.fighters[0].vx = 0`,
 * `(f as FighterState).vx >>= 1`, `[f.vx, f.vy] = …`, `Object.assign(f, { vx })`
 * or a write split over three lines, and it exempted any receiver *named* `p`
 * or `ball`. So this reads the syntax tree and asks the type checker: a write
 * is flagged when its target is a `vx`/`vy` property *declared on
 * `FighterState`*. Projectiles and the Smash Ball have their own `vx`/`vy`
 * (`ProjectileState`, `SmashBallState`), so they are exempt by type, not by
 * what the variable is called, and a fighter held in a variable called `p` is
 * still a fighter. A receiver the checker cannot type (`any`) is flagged too.
 *
 * It scans every non-test `.ts`/`.tsx` under `src/` except `src/render/` (the
 * renderer keeps float particles of its own and only ever reads the engine's
 * state). Comments and strings are not code, so the AST ignores them.
 *
 * A "write" is: the target of any assignment operator (`=`, `+=`, … `>>>=`,
 * `&&=`, `||=`, `??=`); the operand of `++`/`--`; a destructuring-assignment
 * or `for…in/of` target; `f["vx"]` (or a key whose type is `"vx"`/`"vy"`) in any
 * of those positions; and `Object.assign`/`defineProperties` into a fighter from
 * something that carries `vx`/`vy`, `Object.defineProperty` and `Reflect.set`
 * of `"vx"`/`"vy"`.
 *
 * **Not caught** (each pinned under "does not see" below, so closing one fails
 * a test and the list gets updated; do not over-trust this guard):
 * - a fighter replaced wholesale (`s.fighters[0] = {…}`);
 * - a receiver whose *type* no longer says fighter: a structural alias or helper
 *   parameter (`const g: { vx: number } = f; g.vx = 0`,
 *   `function z(o: { vx: number }) { o.vx = 0 } z(f)`) or a double cast
 *   (`(f as unknown as { vx: number }).vx = 0`);
 * - a dynamic key through `any` or `string` (`(f as any)[name] = 0`);
 * - a call the scanner cannot read as `Object.assign(…)`/`Reflect.set(…)`:
 *   `Object["assign"](f, …)`, a destructured `const { assign } = Object`, or
 *   `const set: Function = Object.assign`.
 */

const SRC = join(process.cwd(), "src");
const KINETIC = join(SRC, "engine", "kinetic.ts");
const MARKER = /kinetic: legacy-write \(Task \d+/;
const VELOCITY = new Set(["vx", "vy"]);

/* ------------------------------------------------------------ the tree -- */

/** Every non-test source under `dir` as absolute paths, recursively, skipping `src/render/`. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (full !== join(SRC, "render")) out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/* ----------------------------------------------------------- the scanner -- */

interface Write {
  /** 1-based line the write starts on. */
  line: number;
  /** First line of the write, trimmed. */
  text: string;
  /** Whether a `kinetic: legacy-write (Task N…)` comment covers it. */
  marked: boolean;
}

/** A TypeScript program over `files` (plus in-memory `virtual` sources) and the scanner that reads it. */
function createScanner(files: string[], virtual: ReadonlyMap<string, string>) {
  const config = ts.readConfigFile(join(process.cwd(), "tsconfig.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
  const options: ts.CompilerOptions = {
    ...parsed.options,
    noEmit: true,
    incremental: false,
    composite: false,
    plugins: undefined,
  };
  const host = ts.createCompilerHost(options, true);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (name) => virtual.has(name) || fileExists.call(host, name);
  host.readFile = (name) => virtual.get(name) ?? readFile.call(host, name);
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) => {
    const text = virtual.get(name);
    return text === undefined
      ? getSourceFile.call(host, name, languageVersion, onError, shouldCreate)
      : ts.createSourceFile(name, text, languageVersion, true);
  };
  const program = ts.createProgram({ rootNames: [...files, ...virtual.keys()], options, host });
  const checker = program.getTypeChecker();

  /** `FighterState`'s own `vx`/`vy` — not a projectile's, not the ball's, not an animation record's. */
  const isFighterMember = (decl: ts.Declaration): boolean =>
    ts.isPropertySignature(decl) &&
    ts.isInterfaceDeclaration(decl.parent) &&
    decl.parent.name.text === "FighterState" &&
    decl.getSourceFile().fileName.endsWith("/engine/types.ts");

  /** Does a value of this type have a `vx`/`vy` that is a fighter's (or may be: `any`)? */
  function velocityOf(type: ts.Type, key: string): "fighter" | "other" | "any" {
    const t = checker.getNonNullableType(type);
    if (t.flags & ts.TypeFlags.Any) return "any";
    const symbol = checker.getPropertyOfType(t, key);
    return symbol?.declarations?.some(isFighterMember) ? "fighter" : "other";
  }

  const strip = (e: ts.Node): ts.Node =>
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isTypeAssertionExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isSatisfiesExpression(e)
      ? strip(e.expression)
      : e;

  /** The `vx`/`vy` keys an element-access argument can be: a literal, or a type made of them. */
  function keysOf(arg: ts.Expression): string[] {
    const keys: string[] = [];
    const add = (t: ts.Type): void => {
      if (t.isUnion()) t.types.forEach(add);
      else if (t.isStringLiteral()) keys.push(t.value);
    };
    add(checker.getTypeAtLocation(arg));
    if (ts.isStringLiteralLike(arg)) keys.push(arg.text);
    return keys.filter((k) => VELOCITY.has(k));
  }

  /** The receiver and keys of `x.vx` / `x["vy"]`, or null when the node is neither. */
  function velocityAccess(node: ts.Node): { receiver: ts.Expression; keys: string[] } | null {
    if (ts.isPropertyAccessExpression(node)) {
      return VELOCITY.has(node.name.text) ? { receiver: node.expression, keys: [node.name.text] } : null;
    }
    if (ts.isElementAccessExpression(node)) {
      const keys = keysOf(node.argumentExpression);
      return keys.length > 0 ? { receiver: node.expression, keys } : null;
    }
    return null;
  }

  /** The source files this scanner can answer for: the ones it was given, and the virtual ones. */
  function sourceOf(file: string): ts.SourceFile {
    const sf = program.getSourceFile(file);
    if (sf === undefined) throw new Error(`not in the program: ${file}`);
    return sf;
  }

  /** Every comment in `sf` that carries the legacy marker: its lines, and whether nothing else is on them. */
  function markerComments(sf: ts.SourceFile): { start: number; end: number; own: boolean }[] {
    const markers: { start: number; end: number; own: boolean }[] = [];
    const seen = new Set<number>();
    const visit = (node: ts.Node): void => {
      const ranges = [
        ...(ts.getLeadingCommentRanges(sf.text, node.pos) ?? []),
        ...(ts.getTrailingCommentRanges(sf.text, node.end) ?? []),
      ];
      for (const r of ranges) {
        if (seen.has(r.pos)) continue;
        seen.add(r.pos);
        if (!MARKER.test(sf.text.slice(r.pos, r.end))) continue;
        const start = sf.getLineAndCharacterOfPosition(r.pos).line;
        const end = sf.getLineAndCharacterOfPosition(r.end).line;
        const before = sf.text.slice(sf.getLineStarts()[start], r.pos);
        const after = sf.text.slice(r.end, sf.getLineEndOfPosition(r.end));
        markers.push({ start, end, own: before.trim() === "" && after.trim() === "" });
      }
      node.getChildren(sf).forEach(visit);
    };
    visit(sf);
    return markers;
  }

  /** Every write to a fighter's `vx`/`vy` in `file`, marked or not. */
  function scan(file: string): Write[] {
    const sf = sourceOf(file);
    /** What a marker may cover: the lines of `show`'s source text from `from` to `to`. */
    interface Extent {
      show: ts.Node;
      from: number;
      to: number;
    }
    const whole = (node: ts.Node): Extent => ({ show: node, from: node.getStart(sf), to: node.getEnd() });

    const found: { show: ts.Node; start: number; end: number }[] = [];
    const flagged = new Set<ts.Node>();

    const flag = (extent: Extent, at: ts.Node): void => {
      if (flagged.has(at)) return;
      flagged.add(at);
      found.push({
        show: extent.show,
        start: sf.getLineAndCharacterOfPosition(extent.from).line,
        end: sf.getLineAndCharacterOfPosition(extent.to).line,
      });
    };

    /** `raw` is being written: flag it if it is a fighter's `vx`/`vy`, or look inside a destructuring pattern. */
    const target = (raw: ts.Node, write: Extent): void => {
      const t = strip(raw);
      if (ts.isArrayLiteralExpression(t)) {
        for (const el of t.elements) {
          if (ts.isOmittedExpression(el)) continue;
          if (ts.isSpreadElement(el)) target(el.expression, write);
          // `[f.vx = 1] = …`: the default's own assignment is visited in its own right.
          else if (!(ts.isBinaryExpression(el) && isAssignment(el.operatorToken.kind))) target(el, write);
        }
        return;
      }
      if (ts.isObjectLiteralExpression(t)) {
        for (const p of t.properties) {
          if (ts.isPropertyAssignment(p)) {
            const init = strip(p.initializer);
            if (!(ts.isBinaryExpression(init) && isAssignment(init.operatorToken.kind))) target(init, write);
          } else if (ts.isSpreadAssignment(p)) target(p.expression, write);
        }
        return;
      }
      const access = velocityAccess(t);
      if (access === null) return;
      for (const key of access.keys) {
        if (velocityOf(checker.getTypeAtLocation(access.receiver), key) !== "other") {
          flag(write, t);
          return;
        }
      }
    };

    const isFighter = (e: ts.Expression): boolean =>
      [...VELOCITY].some((k) => velocityOf(checker.getTypeAtLocation(e), k) !== "other");

    /** Does a value carry a `vx`/`vy` (or an index signature that may hold one)? */
    const carriesVelocity = (e: ts.Expression): boolean => {
      const t = checker.getNonNullableType(checker.getTypeAtLocation(e));
      return (
        (t.flags & ts.TypeFlags.Any) !== 0 ||
        [...VELOCITY].some((k) => checker.getPropertyOfType(t, k) !== undefined) ||
        checker.getIndexInfoOfType(t, ts.IndexKind.String) !== undefined
      );
    };

    const call = (node: ts.CallExpression): void => {
      const callee = node.expression;
      if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return;
      const name = `${callee.expression.text}.${callee.name.text}`;
      const [subject, second] = node.arguments;
      if (subject === undefined) return;
      // The write is the call's head, through the fighter it names; the payload is not the write.
      const head: Extent = { show: node, from: node.getStart(sf), to: subject.getEnd() };
      if (name === "Object.assign" || name === "Object.defineProperties") {
        if (isFighter(subject) && node.arguments.slice(1).some(carriesVelocity)) flag(head, node);
      } else if (name === "Object.defineProperty" || name === "Reflect.set" || name === "Reflect.defineProperty") {
        if (second !== undefined && keysOf(second).length > 0 && isFighter(subject)) flag(head, node);
      }
    };

    const visit = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node) && isAssignment(node.operatorToken.kind)) {
        target(node.left, whole(node));
      } else if (
        (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
      ) {
        target(node.operand, whole(node));
      } else if (
        (ts.isForOfStatement(node) || ts.isForInStatement(node)) &&
        !ts.isVariableDeclarationList(node.initializer)
      ) {
        target(node.initializer, whole(node.initializer)); // the header's target, not the loop body
      } else if (ts.isCallExpression(node)) {
        call(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);

    if (found.length === 0) return [];
    const markers = markerComments(sf);
    return found
      .sort((a, b) => a.start - b.start)
      .map(({ show, start, end }) => ({
        line: start + 1,
        text: show.getText(sf).split("\n")[0].trim(),
        marked: markers.some(
          (m) =>
            // A comment on one of the write's own lines...
            (m.start >= start && m.start <= end) ||
            // ...or one standing alone on the line just above it: a trailing marker covers its own statement only.
            (m.own && m.end === start - 1),
        ),
      }));
  }

  return { scan };
}

function isAssignment(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

/* ------------------------------------------------------ the snippet table -- */

/** Declarations every snippet may use; the snippet itself is the body of `snippet()`. */
const PRELUDE = `import type { FighterState, GameState, ProjectileState, SmashBallState } from "../types";
declare const f: FighterState;
declare const s: GameState;
declare const p: ProjectileState;
declare const ball: SmashBallState;
declare const k: "vx" | "vy";
declare const anim: { vx: number; vy: number };
declare const bag: Record<string, number>;
declare const u: FighterState | ProjectileState;
declare const pv: Pick<FighterState, "vx">;
declare const loose: any;
export function snippet(): void {
`;
const POSTLUDE = "\n}\n";

const ASSIGNMENT_OPERATORS = ["=", "+=", "-=", "*=", "/=", "%=", "**=", "<<=", ">>=", ">>>=", "&=", "|=", "^=", "&&=", "||=", "??="];

/** [what the snippet is, its body, how many writes to a fighter's `vx`/`vy` it holds]. */
const MUST_FLAG: [string, string, number][] = [
  ...ASSIGNMENT_OPERATORS.flatMap((op): [string, string, number][] => [
    [`f.vx ${op} 1`, `f.vx ${op} 1;`, 1],
    [`f.vy ${op} 1`, `f.vy ${op} 1;`, 1],
  ]),
  ["f.vx++", "f.vx++;", 1],
  ["++f.vx", "++f.vx;", 1],
  ["f.vy--", "f.vy--;", 1],
  ["--f.vy", "--f.vy;", 1],
  ["a chain of assignments", "f.vx = f.vy = 0;", 2],
  ["an element of s.fighters", "s.fighters[0].vx = 0;", 1],
  ["a non-null .at()", "s.fighters.at(0)!.vx = 0;", 1],
  ["an `as` cast", "(f as FighterState).vx = 0;", 1],
  ["an angle-bracket cast", "(<FighterState>f).vy = 0;", 1],
  ["a `satisfies` cast", "(f satisfies FighterState).vx = 0;", 1],
  ["a callback's fighter", "s.fighters.forEach((x) => { x.vy = 0; });", 1],
  ["a generic bound by FighterState", "function g<T extends FighterState>(x: T): void { x.vx = 0; }", 1],
  ["a union with a projectile", "u.vx = 0;", 1],
  ["a Pick of FighterState", "pv.vx = 0;", 1],
  ["an `any` receiver", "loose.vx = 0;", 1],
  ["a fighter held in a variable called p", "const p = s.fighters[0]; p.vx = 0;", 1],
  ["a fighter held in a variable called ball", "const ball = f; ball.vy += 1;", 1],
  ["an array destructuring target", "[f.vx, f.vy] = [0, 0];", 2],
  ["an object destructuring target", "({ vx: f.vx } = { vx: 0 });", 1],
  ["a nested destructuring target", "({ a: [f.vy] } = { a: [0] });", 1],
  ["a destructuring target with a default", "[f.vx = 1] = [];", 1],
  ["a rest destructuring target", "[...[f.vy]] = [0];", 1],
  ["a for-of target", "for (f.vx of [1, 2]) { /* nothing */ }", 1],
  ["a for-in target", "for (f.vy in { a: 1 }) { /* nothing */ }", 1],
  ["Object.assign with a literal", "Object.assign(f, { vx: 0 });", 1],
  ["Object.assign with a shorthand", "const vy = 0; Object.assign(f, { vy });", 1],
  ["Object.assign with a computed key", `Object.assign(f, { ["vx"]: 0 });`, 1],
  ["Object.assign from another fighter", "Object.assign(f, s.fighters[1]);", 1],
  ["Object.assign with a spread", "Object.assign(f, { ...s.fighters[1] });", 1],
  ["Object.assign from a record", "Object.assign(f, bag);", 1],
  ["Object.defineProperties", "Object.defineProperties(f, { vx: { value: 0 } });", 1],
  ["Object.defineProperty", `Object.defineProperty(f, "vy", { value: 0 });`, 1],
  ["Reflect.set", `Reflect.set(f, "vx", 0);`, 1],
  ["a double-quoted element access", `f["vx"] = 0;`, 1],
  ["a single-quoted element access", `f['vy'] += 1;`, 1],
  ["a template-literal element access", "f[`vx`] = 0;", 1],
  ["a key typed as a literal union", "f[k] = 0;", 1],
  ["a write split across lines", "f\n  .vx\n  =\n  0;", 1],
  ["a write whose line starts with `*`", "const z = 2\n  * (f.vx = 3);", 1],
  ["a write after a block comment", "/* reset */ f.vx = 0;", 1],
  ["a write inside a call's argument", "console.log((f.vx = 0));", 1],
  ["a marker that names no task", "// kinetic: legacy-write\nf.vx = 0;", 1],
  ["a marker with a task that is not a number", "// kinetic: legacy-write (Task x)\nf.vx = 0;", 1],
  ["a marker two lines above", "// kinetic: legacy-write (Task 18)\nconst a = 1;\nf.vx = a;", 1],
  ["a marker below the write", "f.vx = 0;\n// kinetic: legacy-write (Task 18)\nconst a = 1;", 1],
  ["a marker only in a string", `const m = "kinetic: legacy-write (Task 18)"; f.vx = 0;`, 1],
  ["a marker covering one of two writes", "// kinetic: legacy-write (Task 18)\nf.vx = 0;\nf.vy = 0;", 1],
  // A trailing marker excuses its own write and nothing after it (physics.ts and states.ts have adjacent marked pairs).
  ["a trailing marker does not cover the next line", "f.vx = 0; // kinetic: legacy-write (Task 18)\nf.vy = 0;", 1],
  [
    "a trailing marker on a wrapped write does not cover the next line",
    "f.vx = Math.trunc(\n  (f.vx * 2) / 3,\n); // kinetic: legacy-write (Task 17)\nf.vy = 0;",
    1,
  ],
  ["a marker with code after it does not cover the next line", "/* kinetic: legacy-write (Task 18) */ const a = 1;\nf.vx = a;", 1],
  // The marker belongs to the write's target, not to the statement or call around it.
  ["a marker in a for-of body does not cover its header", "for (f.vx of [1, 2]) {\n  // kinetic: legacy-write (Task 18)\n  void 0;\n}", 1],
  ["a marker in a for-in body does not cover its header", "for (f.vy in { a: 1 }) {\n  void 0; // kinetic: legacy-write (Task 18)\n}", 1],
  ["a marker in an Object.assign payload does not cover the call", "Object.assign(f, {\n  vx: 0, // kinetic: legacy-write (Task 18)\n});", 1],
];

const MUST_ALLOW: [string, string][] = [
  ["a marker on the write's line", "f.vx = 0; // kinetic: legacy-write (Task 18 moves this to MOTION)"],
  ["a marker on the line above", "// kinetic: legacy-write (Task 17 moves this to DAMAGE)\nf.vy = 0;"],
  ["a marker in a block comment above", "/* kinetic: legacy-write (Task 17) */\nf.vy -= 1;"],
  ["a marker after a wrapped write", "f.vx = Math.trunc(\n  (f.vx * 2) / 3,\n); // kinetic: legacy-write (Task 17)"],
  ["a marker on a for-of header", "for (f.vx of [1, 2]) { // kinetic: legacy-write (Task 18)\n  void 0;\n}"],
  ["a marker above a for-of header", "// kinetic: legacy-write (Task 18)\nfor (f.vy of [1]) { void 0; }"],
  ["a marker on the first line of an Object.assign", "Object.assign(f, { // kinetic: legacy-write (Task 18)\n  vx: 0,\n});"],
  ["a marker above an Object.assign", "// kinetic: legacy-write (Task 18)\nObject.assign(f, { vx: 0 });"],
  ["a block marker of several lines directly above", "/* kinetic: legacy-write (Task 17)\n * the explanation */\nf.vx = 0;"],
  ["a marker on both of two lines", "f.vx = 0; // kinetic: legacy-write (Task 18)\nf.vy = 0; // kinetic: legacy-write (Task 18)"],
  ["a projectile write", "p.vx = -p.vx; p.vy -= 1; p.vx++;"],
  ["a Smash Ball write", "ball.vx += 1; ball.vy = 0;"],
  ["an Object.assign into a projectile", "Object.assign(p, { vx: 0 });"],
  ["an Object.assign that does not move the fighter", "Object.assign(f, { damage: 0 });"],
  ["an Object.assign that copies a fighter's velocity out", "Object.assign(anim, f);"],
  ["an unrelated record with vx", "anim.vx = 1; anim.vy++;"],
  ["a write in a line comment", "// f.vx = 0;"],
  ["a write in a block comment", "/* f.vx = 0;\n * f.vy = 0; */"],
  ["a write in a string", `const t = "f.vx = 0"; const u = \`f.vy = \${t}\`;`],
  ["a local called vx", "let vx = 0; vx = 1; vx++; vx += 2;"],
  ["a read", "const v = f.vx; if (f.vy === 0) return; if (f.vx >= 2 || f.vy != 3) return;"],
  ["a read that feeds a write to something else", "f.x += f.vx; f.y -= f.vy;"],
  ["a destructured read", "const { vx, vy } = f; void vx; void vy;"],
  ["a read in an object literal", "const o = { vx: f.vx, vy: f.vy }; void o;"],
  ["building a velocity", "const o = { vx: 0, vy: 0 }; void o;"],
  ["a read through element access", `const v = f["vx"]; void v;`],
];

/** Writes the guard cannot see: pinned so the header's "Not caught" list is true, and so closing a gap fails a test. */
const KNOWN_GAPS: [string, string][] = [
  ["a fighter replaced wholesale", "s.fighters[0] = { ...s.fighters[0], vx: 0 };"],
  ["a structural alias", "const g: { vx: number } = f; g.vx = 0;"],
  ["a helper parameter typed { vx: number }", "function z(o: { vx: number }): void { o.vx = 0; }\n  z(f);"],
  ["a double cast to { vx: number }", "(f as unknown as { vx: number }).vx = 0;"],
  ["a dynamic key through any", "const name: string = k; (f as any)[name] = 0;"],
  ["Object[\"assign\"]", `Object["assign"](f, { vx: 0 });`],
  ["a destructured assign", "const { assign } = Object; assign(f, { vx: 0 });"],
  ["an any-typed alias of Object.assign", "const set: Function = Object.assign; set(f, { vx: 0 });"],
];

const SNIPPET_DIR = join(SRC, "engine", "__snippets__");
const snippetPath = (i: number): string => join(SNIPPET_DIR, `case${i}.ts`);
const SNIPPETS = new Map<string, string>(
  [...MUST_FLAG.map(([, body]) => body), ...MUST_ALLOW.map(([, body]) => body), ...KNOWN_GAPS.map(([, body]) => body)].map((body, i) => [
    snippetPath(i),
    PRELUDE + body + POSTLUDE,
  ]),
);

/* -------------------------------------------------------------- the tests -- */

describe("fighter velocity writes", () => {
  const files = walk(SRC);
  let scanner: ReturnType<typeof createScanner>;

  // One program for the tree and every snippet: type-checking `src/` is about a second.
  beforeAll(() => {
    scanner = createScanner(files, SNIPPETS);
  }, 60_000);

  it("happen only through kinetic.ts, or on a marked legacy line", () => {
    const violations: string[] = [];
    for (const file of files) {
      if (file === KINETIC) continue;
      for (const w of scanner.scan(file)) {
        if (!w.marked) violations.push(`${file.slice(SRC.length + 1)}:${w.line} ${w.text}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("walks subdirectories and the layers beside engine/, but not render/", () => {
    const names = files.map((file) => file.slice(SRC.length + 1));
    expect(names).toContain("engine/simulate.ts");
    expect(names).toContain("engine/kinetic.ts");
    expect(names).toContain("engine/status/index.ts");
    expect(names).toContain("ai/behaviours.ts");
    expect(names.filter((name) => name.startsWith("render/"))).toEqual([]);
    expect(names.filter((name) => /\.test\.tsx?$/.test(name))).toEqual([]);
  });

  it("sees the raw writes in kinetic.ts, which is exempt by file and not by blindness", () => {
    const writes = scanner.scan(KINETIC).map((w) => w.text);
    expect(writes).toContain("f.vx = kineticSumX(f)");
    expect(writes).toContain("f.vy = kineticSumY(f)");
  });

  describe("flags", () => {
    it.each(MUST_FLAG.map(([name, , count], i) => [name, count, i] as const))("%s", (_name, count, i) => {
      const writes = scanner.scan(snippetPath(i)).filter((w) => !w.marked);
      expect(writes.map((w) => w.text)).toHaveLength(count);
    });
  });

  describe("allows", () => {
    it.each(MUST_ALLOW.map(([name], i) => [name, i + MUST_FLAG.length] as const))("%s", (_name, i) => {
      const writes = scanner.scan(snippetPath(i)).filter((w) => !w.marked);
      expect(writes.map((w) => w.text)).toEqual([]);
    });
  });

  describe("does not see (known gaps)", () => {
    it.each(KNOWN_GAPS.map(([name], i) => [name, i + MUST_FLAG.length + MUST_ALLOW.length] as const))("%s", (_name, i) => {
      expect(scanner.scan(snippetPath(i)).filter((w) => !w.marked)).toEqual([]);
    });
  });

  it("counts a marked write as a write, so the legacy list stays visible", () => {
    const i = MUST_FLAG.length + MUST_ALLOW.findIndex(([name]) => name === "a marker on the write's line");
    expect(scanner.scan(snippetPath(i)).map((w) => w.marked)).toEqual([true]);
  });
});
