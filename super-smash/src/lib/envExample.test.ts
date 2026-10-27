// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe(".env.example", () => {
  it("names only the two Worker secrets, which the Worker actually declares", () => {
    const example = readFileSync(join(ROOT, ".env.example"), "utf8");
    const names = [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]).sort();
    expect(names).toEqual(["TURN_KEY_API_TOKEN", "TURN_KEY_ID"]);
    const env = readFileSync(join(ROOT, "worker", "src", "env.ts"), "utf8");
    for (const name of names) expect(env).toContain(name);
  });

  it("is right that the browser code reads no environment at all", () => {
    const offenders = sources(join(ROOT, "src")).filter((file) => readFileSync(file, "utf8").includes("process.env"));
    expect(offenders).toEqual([]);
  });
});
