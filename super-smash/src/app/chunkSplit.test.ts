// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * three.js (~200 KB gzipped) belongs in the chunk the play page loads after it
 * mounts, never in a page's initial JavaScript (Plan 4): the menu must not pay
 * for it at all, and /play only once its loading screen is up. The bundler puts
 * every module reachable through *static* imports in a page's initial chunk, so
 * this walks that graph from each page and fails if it reaches `three`.
 * `import type` and `import()` are not static edges.
 *
 * `src/render3d/` mixes modules that import three (the presenter, the stage,
 * the fighters) with ones that do not (the anchors, the skeleton tables), so
 * the walk follows every static path rather than trusting a directory: one
 * three-free module importing `camera3d` would put three back in a page.
 */

const SRC = join(process.cwd(), "src");
const EXT = [".ts", ".tsx", "/index.ts", "/index.tsx", ".json", ""];

function resolveSpec(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (base === null) return null;
  for (const e of EXT) if (existsSync(base + e) && (e !== "" || /\.(tsx?|json)$/.test(base))) return base + e;
  throw new Error(`cannot resolve ${spec} from ${from}`);
}

/** Bare packages and dynamically imported files reachable from `entry` through static imports. */
function walk(entry: string): { packages: Set<string>; dynamic: Set<string> } {
  const packages = new Set<string>();
  const dynamic = new Set<string>();
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file) || file.endsWith(".json")) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm)) {
      const target = resolveSpec(file, m[1]);
      if (target === null) packages.add(m[1].split("/").slice(0, m[1].startsWith("@") ? 2 : 1).join("/"));
      else queue.push(target);
    }
    for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
      const target = resolveSpec(file, m[1]);
      if (target !== null) dynamic.add(target.slice(SRC.length + 1));
    }
  }
  return { packages, dynamic };
}

const isThree = (p: string) => p === "three" || p.startsWith("three/");

describe("three.js stays out of every page's initial chunk (Plan 4)", () => {
  // Every page the game ships, the animation lab's included: its model sheet (`Lab3D`) loads through `import()` too.
  for (const page of [
    "page.tsx",
    "anim/page.tsx",
    "menu/page.tsx",
    "rules/page.tsx",
    "stage/page.tsx",
    "fighters/page.tsx",
    "controls/page.tsx",
    "online/page.tsx",
    "play/page.tsx",
    "results/page.tsx",
  ]) {
    it(`src/app/${page} reaches no three.js through static imports`, () => {
      expect([...walk(join(SRC, "app", page)).packages].filter(isThree)).toEqual([]);
    });
  }

  it("the play page still loads the 3D world, as a separate chunk", () => {
    expect(walk(join(SRC, "app", "play", "page.tsx")).dynamic).toContain("game/world3d.ts");
  });

  it("the lobby's character select preloads the fighters' models only through import()", () => {
    const fighters = walk(join(SRC, "app", "fighters", "page.tsx"));
    expect(fighters.dynamic).toContain("game/world3d.ts");
    expect([...fighters.packages].filter(isThree)).toEqual([]);
  });

  it("the animation lab loads its model sheet only through import(), and the sheet itself does use three", () => {
    expect(walk(join(SRC, "app", "anim", "page.tsx")).dynamic).toContain("app/anim/Lab3D.tsx");
    expect(walk(join(SRC, "app", "anim", "Lab3D.tsx")).packages).toContain("three");
  });

  it("the walk does see three where it is static (the 3D world itself)", () => {
    expect(walk(join(SRC, "game", "world3d.ts")).packages).toContain("three");
  });
});
