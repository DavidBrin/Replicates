import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The guard that keeps the engine pure (SPEC §4 "The engine contract", D31).
 *
 * `src/engine/**` must be a deterministic function of its inputs so that UNDO
 * replays, AI action lists and serialised states reproduce exactly. Two things
 * break that quietly: a forbidden import (React, Next, the DOM, or a sibling
 * layer that drags a browser API or a module singleton in) and a banned call
 * (`Math.random` is unseedable; `Date.now` / `performance.now` / `new Date`
 * are wall-clock; `crypto` is both). This test walks the actual source, strips
 * comments and string literals first so its own list cannot trip it, and
 * fails with file:line for every violation.
 */

// Resolved from the working directory: vitest always runs from the project root.
const ENGINE_DIR = join(process.cwd(), "src", "engine") + "/";

/** Package names the engine may not reach for. */
const BANNED_PACKAGES = ["react", "react-dom", "next", "zustand", "zod"];

/** Sibling layers the engine may not reach for, by first path segment (D31). */
const BANNED_LAYERS = ["render", "game", "components", "app", "ports", "adapters", "content", "config", "lib"];

/** Calls that make a state transition irreproducible. */
const BANNED_CALLS = ["Math\\.random", "Date\\.now", "performance\\.now", "new Date", "crypto\\."];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
  return out.sort();
}

/** Blank out comments and string literals, preserving line breaks. */
export function stripCommentsAndStrings(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === "\n") out += "\n";
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Every module specifier a file imports, re-exports or requires. */
function importSpecifiers(src: string): string[] {
  const out: string[] = [];
  const patterns = [
    "(?:import|export)[^;]*?from\\s*[\"']([^\"']+)[\"']",
    "import\\s*[\"']([^\"']+)[\"']",
    "import\\s*\\(\\s*[\"']([^\"']+)[\"']",
    "require\\s*\\(\\s*[\"']([^\"']+)[\"']",
  ];
  for (const p of patterns) {
    const re = new RegExp(p, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) out.push(m[1] as string);
  }
  return out;
}

/** The first meaningful path segment of a relative or aliased specifier. */
function layerOf(spec: string): string | null {
  let s = spec;
  if (s.startsWith("@/")) s = s.slice(2);
  else if (s.startsWith("../")) s = s.replace(/^(\.\.\/)+/, "");
  else return null; // "./x" stays inside engine/; bare packages are handled separately
  return s.split("/")[0] as string;
}

/** A relative import that climbs out of `src/engine` altogether. */
function escapesEngine(file: string, spec: string): boolean {
  if (!spec.startsWith(".")) return false;
  const dir = file.slice(0, file.lastIndexOf("/"));
  const resolved = join(dir, spec);
  return !resolved.startsWith(ENGINE_DIR.slice(0, -1));
}

const FILES = walk(ENGINE_DIR);
const SOURCES = new Map(FILES.map((f) => [f, readFileSync(f, "utf8")]));
const STRIPPED = new Map(FILES.map((f) => [f, stripCommentsAndStrings(SOURCES.get(f) as string)]));

function relative(file: string): string {
  return file.slice(ENGINE_DIR.length);
}

describe("engine layering", () => {
  it("finds the engine sources to check", () => {
    expect(FILES.length).toBeGreaterThan(10);
    for (const name of ["index.ts", "types.ts", "reducer.ts", "provinces.ts", "moveZone.ts", "ai/index.ts", "generator/index.ts"]) {
      expect(FILES.map(relative)).toContain(name);
    }
  });

  it("imports nothing from react, next, or a layer outside the engine", () => {
    const violations: string[] = [];
    for (const file of FILES) {
      if (relative(file) === "layering.test.ts") continue;
      const isTest = relative(file).endsWith(".test.ts");
      for (const spec of importSpecifiers(SOURCES.get(file) as string)) {
        const bare = spec.split("/")[0] as string;
        if (BANNED_PACKAGES.includes(bare)) violations.push(`${relative(file)} imports ${spec}`);
        else if (!spec.startsWith(".") && !spec.startsWith("@/") && !isTest && bare !== "vitest") {
          violations.push(`${relative(file)} imports package ${spec}`);
        }
        const layer = layerOf(spec);
        if (layer !== null && BANNED_LAYERS.includes(layer)) violations.push(`${relative(file)} imports ${spec}`);
        if (escapesEngine(file, spec)) violations.push(`${relative(file)} escapes src/engine via ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("pins its own imports, since it is the one file exempt from the scan", () => {
    const self = SOURCES.get(join(ENGINE_DIR, "layering.test.ts")) as string;
    const header = self.slice(0, self.indexOf("const ENGINE_DIR"));
    expect(new Set(importSpecifiers(header))).toEqual(new Set(["node:fs", "node:path", "vitest"]));
  });

  it("calls nothing that makes a transition irreproducible", () => {
    const violations: string[] = [];
    for (const file of FILES) {
      // Test files may time themselves (perf budgets); the engine proper may not.
      if (relative(file).endsWith(".test.ts")) continue;
      const lines = (STRIPPED.get(file) as string).split("\n");
      for (const pattern of BANNED_CALLS) {
        const re = new RegExp(pattern);
        for (let n = 0; n < lines.length; n++) {
          if (re.test(lines[n] as string)) violations.push(`${relative(file)}:${n + 1} ${(lines[n] as string).trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("touches no browser or Node global", () => {
    const banned = ["\\bwindow\\b", "\\bdocument\\b", "\\blocalStorage\\b", "\\bnavigator\\b", "\\bfetch\\s*\\(", "\\brequestAnimationFrame\\b", "\\bprocess\\.env\\b"];
    const violations: string[] = [];
    for (const file of FILES) {
      if (relative(file) === "layering.test.ts") continue;
      const stripped = STRIPPED.get(file) as string;
      for (const pattern of banned) if (new RegExp(pattern).test(stripped)) violations.push(`${relative(file)} references ${pattern}`);
    }
    expect(violations).toEqual([]);
  });

  describe("the guard itself", () => {
    it("catches a forbidden import", () => {
      const spec = importSpecifiers('import { paint } from "../render/canvas";')[0] as string;
      expect(BANNED_LAYERS).toContain(layerOf(spec));
    });
    it("catches an aliased forbidden import", () => {
      expect(BANNED_LAYERS).toContain(layerOf(importSpecifiers('import x from "@/game/session";')[0] as string));
    });
    it("catches a React import", () => {
      expect(BANNED_PACKAGES).toContain((importSpecifiers('import { useState } from "react";')[0] as string).split("/")[0]);
    });
    it("allows a sibling engine import", () => {
      expect(layerOf(importSpecifiers('import { next } from "./prng";')[0] as string)).toBeNull();
    });
    it("catches a banned call in live code", () => {
      expect(BANNED_CALLS.some((p) => new RegExp(p).test(stripCommentsAndStrings("const r = Math.random();")))).toBe(true);
    });
    it("does not catch a banned call named only in a comment or string", () => {
      const fine = '// never call Math.random here\nconst label = "Date.now";\nconst r = next(seed);';
      expect(BANNED_CALLS.some((p) => new RegExp(p).test(stripCommentsAndStrings(fine)))).toBe(false);
    });
    it("keeps line numbers stable across a multi-line comment", () => {
      const stripped = stripCommentsAndStrings("const a = 1;\n/* one\n two\n three */\nconst b = Math.random();");
      expect(stripped.split("\n")).toHaveLength(5);
      expect(stripped.split("\n")[4]).toContain("Math.random");
    });
  });
});
