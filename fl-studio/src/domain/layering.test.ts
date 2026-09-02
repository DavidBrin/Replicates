import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The layering guard SPEC.md §6 demands — the same shape as the sibling
 * `super-smash` project's `engine/layering.test.ts`.
 *
 * `src/domain` is pure logic: entities, tick math, commands, compilation,
 * serialization. The rule is that it imports **nothing** from React, Next,
 * Tone.js, zustand or a browser API, and reaches for no layer above itself.
 * Two things break it, both quietly:
 *
 * 1. **A forbidden import.** One `import { useState }` and the domain can no
 *    longer be tested, compiled offline, or reused by the WAV exporter's
 *    `OfflineAudioContext` pass.
 * 2. **A browser global.** `localStorage` inside `serialization.ts` would make
 *    the save path untestable and SSR-unsafe; `Date.now()` inside a command
 *    would make `invert(apply(p)) ≡ p` false by a millisecond.
 *
 * The scan walks the real source rather than a bundler's import graph, so it
 * catches call sites too, and strips comments and string literals first — a
 * doc comment that *mentions* `crypto.randomUUID` (ids.ts has one, on purpose)
 * is not a violation.
 */

// Resolved from the working directory rather than `import.meta.url`: vitest
// serves this file over an http: URL under jsdom and `fileURLToPath` refuses
// it. Vitest always runs from the project root.
const DOMAIN_DIR = join(process.cwd(), "src", "domain") + "/";

/** Packages the domain may not reach for. */
const BANNED_PACKAGES = ["react", "react-dom", "next", "zustand", "tone", "clsx"];

/** Layers above the domain, by first path segment of the specifier. */
const BANNED_LAYERS = ["components", "app", "lib", "audio"];

/**
 * Globals that would make the domain impure, SSR-unsafe or untestable. Written
 * as strings and compiled to regexes at run time, so stripping string literals
 * removes this very list from a scan of this file.
 */
const BANNED_GLOBALS = [
  "\\bwindow\\b",
  "\\bdocument\\b",
  "\\blocalStorage\\b",
  "\\bnavigator\\b",
  "\\bfetch\\s*\\(",
  "\\brequestAnimationFrame\\b",
  "\\bprocess\\.env\\b",
  "\\bcrypto\\.",
  "\\bnew Date\\b",
  "\\bDate\\.now\\b",
  "\\bperformance\\.now\\b",
  "\\bAudioContext\\b",
  "\\bMath\\.random\\b",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
  return out.sort();
}

/**
 * Blank out comments and string literals, preserving line breaks.
 *
 * Character-by-character rather than a regex: a regex that removes comments
 * eats the `//` inside a URL string, and one that removes strings eats a quote
 * inside a comment.
 */
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
    let m = re.exec(src);
    while (m !== null) {
      out.push(m[1] as string);
      m = re.exec(src);
    }
  }
  return out;
}

/** The first meaningful path segment of a relative or aliased specifier. */
function layerOf(spec: string): string | null {
  let s = spec;
  if (s.startsWith("@/")) s = s.slice(2);
  else if (s.startsWith("../")) s = s.replace(/^(\.\.\/)+/, "");
  else if (s.startsWith("./")) return null; // inside domain/
  else return null; // a bare package, handled separately
  return s.split("/")[0] ?? null;
}

const FILES = walk(DOMAIN_DIR);
const SOURCES = new Map(FILES.map((f) => [f, readFileSync(f, "utf8")]));
const STRIPPED = new Map(FILES.map((f) => [f, stripCommentsAndStrings(SOURCES.get(f) as string)]));

function relative(file: string): string {
  return file.slice(DOMAIN_DIR.length);
}

describe("domain layering", () => {
  it("finds the domain sources to check", () => {
    const names = FILES.map(relative);
    expect(FILES.length).toBeGreaterThan(5);
    expect(names).toContain("types.ts");
    expect(names).toContain("tickMath.ts");
    expect(names).toContain("serialization.ts");
    expect(names).toContain("defaultProject.ts");
    expect(names).toContain("commands/index.ts");
  });

  it("imports nothing from React, Next, zustand, Tone, or a layer above the domain", () => {
    const violations: string[] = [];
    for (const file of FILES) {
      // This file quotes forbidden imports as fixtures, so it would report
      // itself; its own imports are pinned by the next case.
      if (relative(file) === "layering.test.ts") continue;
      for (const spec of importSpecifiers(SOURCES.get(file) as string)) {
        const bare = spec.split("/")[0] as string;
        if (BANNED_PACKAGES.includes(bare)) {
          violations.push(`${relative(file)} imports ${spec}`);
          continue;
        }
        const layer = layerOf(spec);
        if (layer !== null && BANNED_LAYERS.includes(layer)) {
          violations.push(`${relative(file)} imports ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("pins its own imports, since it is the one file exempt from the scan", () => {
    const self = SOURCES.get(join(DOMAIN_DIR, "layering.test.ts")) as string;
    const header = self.slice(0, self.indexOf("const DOMAIN_DIR"));
    expect(new Set(importSpecifiers(header))).toEqual(new Set(["node:fs", "node:path", "vitest"]));
  });

  it("touches no browser global, clock or randomness", () => {
    const violations: string[] = [];
    for (const file of FILES) {
      // The layering test itself reads the filesystem; that is its whole job.
      if (relative(file) === "layering.test.ts") continue;
      const lines = (STRIPPED.get(file) as string).split("\n");
      for (const pattern of BANNED_GLOBALS) {
        const re = new RegExp(pattern);
        lines.forEach((line, n) => {
          if (re.test(line)) violations.push(`${relative(file)}:${n + 1} ${line.trim()}`);
        });
      }
    }
    expect(violations).toEqual([]);
  });

  /**
   * A guard that cannot fail is decoration. These run the same checks over
   * source written to trip them.
   */
  describe("the guard itself", () => {
    it("catches a React import", () => {
      const spec = importSpecifiers('import { useState } from "react";')[0] as string;
      expect(BANNED_PACKAGES).toContain(spec.split("/")[0]);
    });

    it("catches a zustand import — the store lives in lib, not the domain", () => {
      const spec = importSpecifiers('import { create } from "zustand";')[0] as string;
      expect(BANNED_PACKAGES).toContain(spec);
    });

    it("catches a Tone.js import", () => {
      const spec = importSpecifiers('import * as Tone from "tone";')[0] as string;
      expect(BANNED_PACKAGES).toContain(spec);
    });

    it("catches an aliased import of a layer above", () => {
      const spec = importSpecifiers('import { useAppStore } from "@/lib/store";')[0] as string;
      expect(BANNED_LAYERS).toContain(layerOf(spec));
    });

    it("catches a relative import of the audio engine", () => {
      const spec = importSpecifiers('import { play } from "../audio/engine";')[0] as string;
      expect(BANNED_LAYERS).toContain(layerOf(spec));
    });

    it("catches a dynamic import too", () => {
      const spec = importSpecifiers('const t = await import("tone");')[0] as string;
      expect(BANNED_PACKAGES).toContain(spec);
    });

    it("allows a sibling domain import", () => {
      const spec = importSpecifiers('import { PPQ } from "./types";')[0] as string;
      expect(layerOf(spec)).toBeNull();
      expect(BANNED_PACKAGES).not.toContain(spec);
    });

    it("catches localStorage in live code", () => {
      const bad = "const raw = localStorage.getItem(KEY);";
      const hit = BANNED_GLOBALS.some((p) => new RegExp(p).test(stripCommentsAndStrings(bad)));
      expect(hit).toBe(true);
    });

    it("catches a clock read in a command", () => {
      const bad = "return { ...project, updatedAt: new Date().toISOString() };";
      const hit = BANNED_GLOBALS.some((p) => new RegExp(p).test(stripCommentsAndStrings(bad)));
      expect(hit).toBe(true);
    });

    it("catches crypto.randomUUID for an id", () => {
      const bad = "const id = crypto.randomUUID();";
      const hit = BANNED_GLOBALS.some((p) => new RegExp(p).test(stripCommentsAndStrings(bad)));
      expect(hit).toBe(true);
    });

    it("does not flag a banned name that appears only in a comment", () => {
      const fine = "// deliberately not crypto.randomUUID\nconst id = nextId();";
      const hit = BANNED_GLOBALS.some((p) => new RegExp(p).test(stripCommentsAndStrings(fine)));
      expect(hit).toBe(false);
    });

    it("does not flag a banned name that appears only in a string", () => {
      const fine = 'const key = "localStorage";';
      const hit = BANNED_GLOBALS.some((p) => new RegExp(p).test(stripCommentsAndStrings(fine)));
      expect(hit).toBe(false);
    });

    it("does not mistake division or a URL for a comment", () => {
      const fine = 'const half = total / 2;\nconst u = "https://example.com/x";\nconst kept = 1;';
      const stripped = stripCommentsAndStrings(fine);
      expect(stripped).toContain("total / 2");
      expect(stripped).toContain("kept");
    });

    it("keeps line numbers stable across a multi-line comment", () => {
      const src = "const a = 1;\n/* one\n two\n three */\nconst b = window.name;";
      const stripped = stripCommentsAndStrings(src);
      expect(stripped.split("\n")).toHaveLength(5);
      expect(stripped.split("\n")[4]).toContain("window");
    });
  });
});
