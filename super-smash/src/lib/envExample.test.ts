// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseLobbyMessage } from "@/net/online/lobby";
import nextConfig from "../../next.config";

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

  /**
   * Save one constant Next inlines at build time: the deploy's id, which
   * next.config.ts stamps itself (from the commit), for online peers to
   * compare. Nothing to configure, so nothing for .env.example to name.
   */
  it("is right that the browser code reads no environment but the build id Next stamps", () => {
    const reads = sources(join(ROOT, "src")).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/process\.env(?:\.[A-Za-z0-9_]+)?/g)].map((m) => `${file.slice(ROOT.length + 1)}: ${m[0]}`),
    );
    expect(reads).toEqual(["src/game/onlineConfig.ts: process.env.NEXT_PUBLIC_BUILD_ID"]);
  });

  /** Every build Next makes, `next dev` and the deploy's `next build` alike, carries the commit it was built from. */
  it("has next.config.ts stamp the build with this checkout's commit, in a form the lobby reads", () => {
    const stamped = nextConfig.env?.NEXT_PUBLIC_BUILD_ID;
    expect(stamped).toBe(execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8" }).trim());
    const hello = { kind: "hello", build: stamped, protocol: 2, bones: "0123abcd" };
    expect(parseLobbyMessage(hello)).toEqual(hello);
  });
});
