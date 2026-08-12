import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The guard that keeps rollback possible.
 *
 * `engine/` is a pure function of its state and its inputs, and every other rule
 * in this codebase depends on that staying true. Two things break it, and both
 * break it *quietly* — the symptom is not a crash, it is two players watching
 * the same match end differently forty frames later:
 *
 * 1. **A forbidden import.** Reaching into `render/`, `net/`, `components/`,
 *    `app/`, `audio/`, React or Next drags a browser API, a module-level
 *    singleton or a render-time value into the simulation. Re-simulating a frame
 *    then depends on something that is not in `GameState`.
 * 2. **A banned call.** `Math.random` is unseedable. `Date.now` and
 *    `performance.now` are wall-clock, and a rollback re-simulates the same frame
 *    at a different wall-clock time. `Math.sin`/`cos`/`tan`/`pow`/`exp`/`log`/
 *    `atan2` are *recommended*, not required, by ECMA-262 — two engines may
 *    legally disagree in the last bits, which is exactly the kind of divergence
 *    that survives for two hundred frames before it surfaces.
 *
 * This test walks the actual source rather than the import graph a bundler
 * produces, so it also catches the call sites, and it strips comments and string
 * literals first so its own list of banned patterns cannot trip it and a doc
 * comment mentioning `Math.sin` is not a violation.
 */

// Resolved from the working directory rather than `import.meta.url`, because
// vitest serves this file over an http: URL under the jsdom environment and
// `fileURLToPath` refuses it. Vitest always runs from the project root.
const ENGINE_DIR = join(process.cwd(), "src", "engine") + "/";

/** Package names the simulation may not reach for. */
const BANNED_PACKAGES = ["react", "react-dom", "next"];

/** Sibling layers the simulation may not reach for, by first path segment. */
const BANNED_LAYERS = ["render", "net", "components", "app", "audio", "ai", "input"];

/**
 * Calls that make a frame irreproducible. Written as strings and turned into
 * regexes at run time, so that stripping string literals removes this list from
 * the scan of this very file.
 */
const BANNED_CALLS = [
  "Math\\.random",
  "Math\\.sin",
  "Math\\.cos",
  "Math\\.tan",
  "Math\\.pow",
  "Math\\.exp",
  "Math\\.log",
  "Math\\.atan",
  "Date\\.now",
  "performance\\.now",
  "new Date",
  "crypto\\.",
];

/**
 * The one documented exception.
 *
 * `fixed.ts` builds its sine table with `Math.sin` once at module load and
 * quantises every entry to an integer immediately. The gap between adjacent Q12
 * values is around 200,000 times larger than the worst disagreement between two
 * engines' `Math.sin`, so both round to the same integer for all 3,600 entries.
 * What would be unsafe is calling it *inside* `step` on an arbitrary angle, so
 * the exemption is pinned to the one line that builds the table.
 */
const TABLE_BUILDER_MARKER = "SIN_TABLE";

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
 * A character-by-character pass rather than a regex, because a regex that
 * removes comments will happily eat the `//` inside a URL string, and one that
 * removes strings will happily eat a quote inside a comment. Newlines are kept
 * so reported line numbers still point at the real source.
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
      out.push(m[1]);
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
  else if (s.startsWith("./")) return null; // inside engine/
  else return null; // a bare package, handled separately
  return s.split("/")[0];
}

const FILES = walk(ENGINE_DIR);
const SOURCES = new Map(FILES.map((f) => [f, readFileSync(f, "utf8")]));
const STRIPPED = new Map(FILES.map((f) => [f, stripCommentsAndStrings(SOURCES.get(f) as string)]));

function relative(file: string): string {
  return file.slice(ENGINE_DIR.length);
}

describe("engine layering", () => {
  it("finds the engine sources to check", () => {
    expect(FILES.length).toBeGreaterThan(5);
    expect(FILES.map(relative)).toContain("simulate.ts");
    expect(FILES.map(relative)).toContain("fixed.ts");
  });

  it("imports nothing from react, next, or a layer above the simulation", () => {
    const violations: string[] = [];
    for (const file of FILES) {
      // This file quotes forbidden import statements as test fixtures, so it
      // would report itself. Its own imports are pinned by the next case.
      if (relative(file) === "layering.test.ts") continue;
      for (const spec of importSpecifiers(SOURCES.get(file) as string)) {
        const bare = spec.split("/")[0];
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
    const self = SOURCES.get(join(ENGINE_DIR, "layering.test.ts")) as string;
    // Only the real import block counts: everything the fixtures quote lives
    // further down, inside the test bodies.
    const header = self.slice(0, self.indexOf("const ENGINE_DIR"));
    expect(new Set(importSpecifiers(header))).toEqual(
      new Set(["node:fs", "node:path", "vitest"]),
    );
  });

  it("calls nothing that makes a frame irreproducible", () => {
    const violations: string[] = [];
    for (const file of FILES) {
      const stripped = STRIPPED.get(file) as string;
      const lines = stripped.split("\n");
      for (const pattern of BANNED_CALLS) {
        const re = new RegExp(pattern, "g");
        for (let n = 0; n < lines.length; n++) {
          if (!re.test(lines[n])) continue;
          re.lastIndex = 0;
          if (relative(file) === "fixed.ts" && lines[n].includes(TABLE_BUILDER_MARKER)) continue;
          violations.push(`${relative(file)}:${n + 1} ${lines[n].trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("confines the one Math.sin exemption to the trig table builder", () => {
    const fixed = STRIPPED.get(join(ENGINE_DIR, "fixed.ts")) as string;
    const hits = fixed.split("\n").filter((l) => new RegExp("Math\\.sin").test(l));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain(TABLE_BUILDER_MARKER);
  });

  it("touches no browser or Node global", () => {
    const banned = [
      "\\bwindow\\b",
      "\\bdocument\\b",
      "\\blocalStorage\\b",
      "\\bnavigator\\b",
      "\\bfetch\\s*\\(",
      "\\brequestAnimationFrame\\b",
      "\\bprocess\\.env\\b",
    ];
    const violations: string[] = [];
    for (const file of FILES) {
      // The layering test itself reads the filesystem; that is its whole job.
      if (relative(file) === "layering.test.ts") continue;
      const stripped = STRIPPED.get(file) as string;
      for (const pattern of banned) {
        if (new RegExp(pattern).test(stripped)) {
          violations.push(`${relative(file)} references ${pattern}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  /**
   * The guard has to be able to fail, or it is decoration. These run the same
   * checks over source text written to trip them.
   */
  describe("the guard itself", () => {
    it("catches a forbidden import", () => {
      const bad = 'import { paint } from "../render/canvas";';
      const spec = importSpecifiers(bad)[0];
      expect(spec).toBe("../render/canvas");
      expect(BANNED_LAYERS).toContain(layerOf(spec));
    });

    it("catches an aliased forbidden import", () => {
      const spec = importSpecifiers('import x from "@/net/session";')[0];
      expect(BANNED_LAYERS).toContain(layerOf(spec));
    });

    it("catches a React import", () => {
      const spec = importSpecifiers('import { useState } from "react";')[0];
      expect(BANNED_PACKAGES).toContain(spec.split("/")[0]);
    });

    it("allows a sibling engine import", () => {
      const spec = importSpecifiers('import { fx } from "./fixed";')[0];
      expect(layerOf(spec)).toBeNull();
      expect(BANNED_PACKAGES).not.toContain(spec);
    });

    it("catches a banned call in live code", () => {
      const bad = "const r = Math.random();";
      const hit = BANNED_CALLS.some((p) => new RegExp(p).test(stripCommentsAndStrings(bad)));
      expect(hit).toBe(true);
    });

    it("does not catch a banned call named only in a comment", () => {
      const fine = "// never call Math.random here\nconst r = nextRandom(seed);";
      const hit = BANNED_CALLS.some((p) => new RegExp(p).test(stripCommentsAndStrings(fine)));
      expect(hit).toBe(false);
    });

    it("does not catch a banned call named only in a string", () => {
      const fine = 'const label = "Date.now";';
      const hit = BANNED_CALLS.some((p) => new RegExp(p).test(stripCommentsAndStrings(fine)));
      expect(hit).toBe(false);
    });

    it("does not mistake division for a comment", () => {
      const fine = "const half = total / 2;\nconst q = a /b;";
      expect(stripCommentsAndStrings(fine)).toContain("total / 2");
      expect(stripCommentsAndStrings(fine)).toContain("a /b");
    });

    it("does not mistake a URL inside a string for a comment", () => {
      const src = 'const u = "https://example.com/x";\nconst kept = 1;';
      expect(stripCommentsAndStrings(src)).toContain("kept");
    });

    it("keeps line numbers stable across a multi-line comment", () => {
      const src = "const a = 1;\n/* one\n two\n three */\nconst b = Math.random();";
      const stripped = stripCommentsAndStrings(src);
      expect(stripped.split("\n")).toHaveLength(5);
      expect(stripped.split("\n")[4]).toContain("Math.random");
    });
  });
});
