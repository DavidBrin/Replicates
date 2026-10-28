// @vitest-environment node
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

import { parseLobbyMessage } from "@/net/online/lobby";
import nextConfig, { DIRTY_UNKNOWN, readCheckout, resolveBuildId } from "../../next.config";

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
    else if (head !== null) expect(stamped).toMatch(new RegExp(`^${head}(-[0-9a-f]{8}|-${DIRTY_UNKNOWN})?$`));
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

  it("marks an id whose uncommitted changes could not be read, which a production build refuses", () => {
    const unknown = { commit: "0123456789ab", dirty: DIRTY_UNKNOWN };
    expect(resolveBuildId({}, false, unknown)).toBe(`0123456789ab-${DIRTY_UNKNOWN}`);
    expect(() => resolveBuildId({}, true, unknown)).toThrow(/uncommitted changes.*BUILD_ID/);
    expect(resolveBuildId({ BUILD_ID: "fedcba987654" }, true, unknown)).toBe("fedcba987654");
    // Both regexes take what the config emits, or every hello would be dropped.
    const build = resolveBuildId({}, false, unknown);
    const hello = { kind: "hello", build, protocol: 2, bones: "0123abcd" };
    expect(parseLobbyMessage(hello)).toEqual(hello);
  });
});

/**
 * `readCheckout` against a repository this test builds: the real thing is
 * whichever checkout the suite runs in, which is clean or dirty by accident.
 */
describe("readCheckout, on a throwaway git repository", () => {
  let dir: string;

  function git(...args: string[]): void {
    execFileSync("git", ["-c", "user.name=smash", "-c", "user.email=smash@example.com", "-c", "commit.gpgsign=false", ...args], {
      cwd: dir,
      stdio: "ignore",
    });
  }

  /** 8 hex digits: dirty, and readable. */
  const MARK = /^[0-9a-f]{8}$/;
  /** Well over the 1 MiB `execFileSync` buffers by default. */
  const BIG = 3 * 1024 * 1024;
  const bigText = (fill: string) => `${fill.repeat(79)}\n`.repeat(Math.ceil(BIG / 80));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "smash-build-id-"));
    git("init", "--quiet");
    writeFileSync(join(dir, "tracked.txt"), "one\n");
    git("add", "tracked.txt");
    git("commit", "--quiet", "-m", "first");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("has no dirty mark on a clean tree", () => {
    const checkout = readCheckout(dir);
    expect(checkout?.commit).toMatch(/^[0-9a-f]{12}$/);
    expect(checkout?.dirty).toBeNull();
  });

  it("marks an edit to a tracked file, and the mark follows the edit", () => {
    writeFileSync(join(dir, "tracked.txt"), "two\n");
    const two = readCheckout(dir)?.dirty;
    expect(two).toMatch(MARK);
    writeFileSync(join(dir, "tracked.txt"), "three\n");
    const three = readCheckout(dir)?.dirty;
    expect(three).toMatch(MARK);
    expect(three).not.toBe(two);
    writeFileSync(join(dir, "tracked.txt"), "one\n");
    expect(readCheckout(dir)?.dirty).toBeNull();
  });

  it("marks a tracked change bigger than a megabyte, hashing all of it rather than calling the tree clean", () => {
    writeFileSync(join(dir, "tracked.txt"), bigText("a"));
    const a = readCheckout(dir)?.dirty;
    expect(a).toMatch(MARK);
    writeFileSync(join(dir, "tracked.txt"), bigText("b"));
    expect(readCheckout(dir)?.dirty).toMatch(MARK);
    expect(readCheckout(dir)?.dirty).not.toBe(a);
  });

  it("marks an untracked file bigger than a megabyte, and its content", () => {
    writeFileSync(join(dir, "big.txt"), bigText("a"));
    const a = readCheckout(dir)?.dirty;
    expect(a).toMatch(MARK);
    writeFileSync(join(dir, "big.txt"), bigText("b"));
    expect(readCheckout(dir)?.dirty).not.toBe(a);
  });

  it("marks an untracked file, and its content", () => {
    writeFileSync(join(dir, "new.txt"), "a\n");
    const a = readCheckout(dir)?.dirty;
    expect(a).toMatch(MARK);
    writeFileSync(join(dir, "new.txt"), "b\n");
    expect(readCheckout(dir)?.dirty).not.toBe(a);
  });

  it("does not throw on an untracked nested git repository, which git lists as a directory", () => {
    mkdirSync(join(dir, "nested"));
    execFileSync("git", ["init", "--quiet"], { cwd: join(dir, "nested"), stdio: "ignore" });
    writeFileSync(join(dir, "nested", "inside.txt"), "x\n");
    expect(readCheckout(dir)?.dirty).toMatch(MARK);
  });

  it("does not throw on a symlink to a directory", () => {
    mkdirSync(join(dir, "real"));
    symlinkSync("real", join(dir, "to-dir"));
    expect(readCheckout(dir)?.dirty).toMatch(MARK);
  });

  it("does not throw on a dangling symlink", () => {
    symlinkSync("nowhere", join(dir, "dangling"));
    expect(readCheckout(dir)?.dirty).toMatch(MARK);
  });

  it("tells two symlinks apart by where they point", () => {
    symlinkSync("one", join(dir, "link"));
    const one = readCheckout(dir)?.dirty;
    expect(one).toMatch(MARK);
    rmSync(join(dir, "link"));
    symlinkSync("two", join(dir, "link"));
    expect(readCheckout(dir)?.dirty).toMatch(MARK);
    expect(readCheckout(dir)?.dirty).not.toBe(one);
  });

  it.skipIf(process.getuid?.() === 0)("calls a tree with an untracked file it cannot read unknown, never clean", () => {
    writeFileSync(join(dir, "secret.txt"), "x\n");
    chmodSync(join(dir, "secret.txt"), 0o000);
    expect(readCheckout(dir)?.dirty).toBe(DIRTY_UNKNOWN);
  });

  it("calls a tree whose diff git cannot produce unknown, never clean", () => {
    writeFileSync(join(dir, ".git", "index"), "not an index");
    expect(readCheckout(dir)?.dirty).toBe(DIRTY_UNKNOWN);
  });
});
