// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

import { parseLobbyMessage } from "@/net/online/lobby";
import nextConfig, { readCheckout, resolveBuildId } from "../../next.config";

const ROOT = process.cwd();

/** This checkout's commit as next.config.ts abbreviates it, or null outside a git checkout. */
function gitHead(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

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

  /**
   * Every build Next makes, `next dev` and the deploy's `next build` alike,
   * carries an id the lobby reads. Which one depends on where it runs, so this
   * holds in any of them: `BUILD_ID` set, a git checkout (clean or not), or a
   * copy with no git at all.
   */
  it("has next.config.ts stamp the build with this checkout's id, in a form the lobby reads", () => {
    const stamped = nextConfig(PHASE_DEVELOPMENT_SERVER).env?.NEXT_PUBLIC_BUILD_ID;
    const head = gitHead();
    if (process.env.BUILD_ID) expect(stamped).toBe(process.env.BUILD_ID);
    else if (head !== null) expect(stamped).toMatch(new RegExp(`^${head}(-[0-9a-f]{8})?$`));
    else expect(stamped).toBe("dev");
    const hello = { kind: "hello", build: stamped, protocol: 2, bones: "0123abcd" };
    expect(parseLobbyMessage(hello)).toEqual(hello);
  });
});

describe("the build id (next.config.ts)", () => {
  const clean = { commit: "0123456789ab", dirty: null };

  it("is BUILD_ID when set, else the commit, marked with a hash of any uncommitted changes", () => {
    expect(resolveBuildId({ BUILD_ID: "fedcba987654" }, true, clean)).toBe("fedcba987654");
    expect(resolveBuildId({}, true, clean)).toBe("0123456789ab");
    expect(resolveBuildId({}, true, { commit: "0123456789ab", dirty: "89abcdef" })).toBe("0123456789ab-89abcdef");
  });

  it('is "dev" with no git, but a production build refuses that unless BUILD_ID=dev says so', () => {
    expect(resolveBuildId({}, false, null)).toBe("dev");
    expect(() => resolveBuildId({}, true, null)).toThrow(/production build.*BUILD_ID/);
    expect(resolveBuildId({ BUILD_ID: "dev" }, true, null)).toBe("dev");
  });

  it("refuses a BUILD_ID the lobby could not read", () => {
    for (const bad of ["v1.2.3", "0123456789AB", "012345", "0123456789ab-dirty"]) {
      expect(() => resolveBuildId({ BUILD_ID: bad }, false, clean), bad).toThrow(/BUILD_ID must be/);
    }
  });

  it("changes with the uncommitted changes, and stays put without them", () => {
    const checkout = readCheckout();
    if (checkout === null) return; // no git here: nothing to read
    expect(checkout.commit).toBe(gitHead());
    expect(readCheckout()).toEqual(checkout);
  });
});
