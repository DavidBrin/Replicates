import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { Hash } from "node:crypto";
import { closeSync, lstatSync, openSync, readlinkSync, readSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

/**
 * `Checkout.dirty` for a tree whose uncommitted changes git could not be made
 * to say (a diff or a file list that failed, an untracked file that would not
 * read). Never "clean": see `resolveBuildId`.
 */
export const DIRTY_UNKNOWN = "dirty-unknown";

/**
 * A build id's form: a commit id as git abbreviates it, optionally followed by
 * `-` and 8 hex digits of uncommitted changes (or `-dirty-unknown`, the mark of
 * changes that could not be read), or "dev". The lobby reads the same form
 * (`BUILD_ID` in src/net/online/lobby.ts), or every hello would be dropped and
 * every match refused, so anything else fails the build here.
 */
const BUILD_ID_FORM = /^([0-9a-f]{7,40}(-([0-9a-f]{8}|dirty-unknown))?|dev)$/;

/** What git says about this package's checkout; null with no git (an archive, a bare CI copy). */
export interface Checkout {
  readonly commit: string;
  /**
   * 8 hex digits of a hash of the uncommitted changes in this package, null for
   * a clean tree, or `DIRTY_UNKNOWN` when there are changes (or may be) that
   * could not be read.
   */
  readonly dirty: string | null;
}

/**
 * Which deploy this is, inlined into the bundle as `NEXT_PUBLIC_BUILD_ID` for
 * two online players to compare (`localBuild`, Plan 2 Task 27). A tab left
 * open across a deploy would otherwise pair with the new one and go out of
 * sync on the first frame the simulation changed.
 *
 * The id fails closed: whatever cannot be told, two builds must not share a
 * name over it.
 *
 * - `BUILD_ID` names it when set.
 * - Otherwise the commit this checkout is on, as `pnpm run deploy` builds it;
 *   with uncommitted changes in this package (tracked or untracked), the commit
 *   plus `-` and a hash of them, so two deploys built from different edits of
 *   one commit refuse each other instead of pairing and desyncing.
 * - Changes git could not read (`DIRTY_UNKNOWN`) are marked `-dirty-unknown`
 *   in `next dev` and tests, and refused by a production build, which would
 *   otherwise ship under a name another build can also carry.
 * - "dev" when git cannot say. Every git-less build would share that name, so
 *   a production build refuses it unless `BUILD_ID=dev` asks for it outright.
 */
export function resolveBuildId(
  env: Readonly<Record<string, string | undefined>>,
  production: boolean,
  checkout: Checkout | null,
): string {
  const named = env.BUILD_ID;
  const id = named || (checkout === null ? "dev" : checkout.dirty ? `${checkout.commit}-${checkout.dirty}` : checkout.commit);
  if (!BUILD_ID_FORM.test(id)) {
    throw new Error(
      `BUILD_ID must be a lowercase hex commit id (7 to 40 digits, optionally -<8 hex>) or "dev", not ${JSON.stringify(id)}`,
    );
  }
  if (production && id === "dev" && named !== "dev") {
    throw new Error(
      'This production build has no commit to name it after (no git here), so it would be "dev" and pair with every other such build. Set BUILD_ID, or BUILD_ID=dev to mean it.',
    );
  }
  if (production && !named && checkout?.dirty === DIRTY_UNKNOWN) {
    throw new Error(
      `This production build could not read the uncommitted changes in this checkout (git diff or ls-files failed, or an untracked file would not read), so it cannot tell whether it is ${checkout.commit} or an edit of it, and another deploy could carry the same id. Fix git here, commit or remove the changes, or set BUILD_ID.`,
    );
  }
  return id;
}

/**
 * git's stdout as bytes, or null when it failed (not installed, not a
 * repository, a corrupt index, ...). No cap on the output: a big diff is still
 * a diff, and the 1 MiB default would fail it, which used to read as clean.
 */
function git(cwd: string, args: readonly string[]): Buffer | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "buffer", maxBuffer: Infinity, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/** Feeds a regular file's bytes into `hash` a megabyte at a time, so no file is too big to read. */
function hashFileContent(hash: Hash, path: string): void {
  const fd = openSync(path, "r");
  try {
    const chunk = Buffer.allocUnsafe(1 << 20);
    for (let n = readSync(fd, chunk, 0, chunk.length, null); n > 0; n = readSync(fd, chunk, 0, chunk.length, null)) {
      hash.update(chunk.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * One untracked entry into `hash`: a regular file by its content; a symlink by
 * its target (dangling or not, to a directory or not, it is not followed); and
 * anything else (a directory, which is how git lists an untracked nested
 * repository, or a pipe or socket) by its path alone. Each kind is tagged, so
 * a file cannot stand in for a link. Throws only when a regular file's content
 * will not read, which the caller turns into `DIRTY_UNKNOWN`.
 */
function hashUntracked(hash: Hash, cwd: string, entry: string): void {
  const path = join(cwd, entry);
  const stat = lstatSync(path);
  if (stat.isFile()) {
    hash.update(`\0file\0${entry}\0`);
    hashFileContent(hash, path);
  } else if (stat.isSymbolicLink()) {
    hash.update(`\0link\0${entry}\0${readlinkSync(path)}`);
  } else {
    hash.update(`\0other\0${entry}`);
  }
}

/**
 * This package's commit, and a hash of `git diff HEAD -- .` plus every
 * untracked entry in it, if any. Never throws, and never calls a tree clean
 * that it could not read: a failed diff or file list, or a regular file that
 * will not read, is `DIRTY_UNKNOWN`.
 */
export function readCheckout(cwd: string = ROOT): Checkout | null {
  const commit = git(cwd, ["rev-parse", "--short=12", "HEAD"])?.toString("utf8").trim();
  if (!commit) return null;
  const diff = git(cwd, ["-c", "core.quotepath=off", "diff", "--no-ext-diff", "--no-color", "--binary", "HEAD", "--", "."]);
  const listing = git(cwd, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."]);
  if (diff === null || listing === null) return { commit, dirty: DIRTY_UNKNOWN };
  const untracked = listing.toString("utf8").split("\0").filter(Boolean).sort();
  if (diff.length === 0 && untracked.length === 0) return { commit, dirty: null };
  const hash = createHash("sha256").update(diff);
  try {
    for (const entry of untracked) hashUntracked(hash, cwd, entry);
  } catch {
    return { commit, dirty: DIRTY_UNKNOWN };
  }
  return { commit, dirty: hash.digest("hex").slice(0, 8) };
}

/**
 * A static export, served by the `david-smash` Cloudflare Worker's static
 * assets (wrangler.jsonc). Every route already prerenders — there is no route
 * handler, cookie, header, rewrite or image loader to lose (spec §3.3) — so
 * the whole game is files, and the Worker only runs for /api/* and /ws/*.
 *
 * A function of Next's phase, so the build id knows a production build
 * (`next build`) from `next dev` (see `resolveBuildId`).
 */
export default function nextConfig(phase: string): NextConfig {
  return {
    output: "export",

    reactStrictMode: true,

    // The dev badge floats over the bottom-left corner of the grid, which is
    // exactly where a screenshot of the wall wants to be clean. Nothing here
    // needs it.
    devIndicators: false,

    // Don't emit AGENTS.md / CLAUDE.md into the deliverable.
    agentRules: false,

    env: { NEXT_PUBLIC_BUILD_ID: resolveBuildId(process.env, phase === PHASE_PRODUCTION_BUILD, readCheckout()) },

    // Pin Turbopack's inferred workspace root to this package. Without it,
    // Turbopack walks up from cwd looking for the "highest" lockfile and can
    // land on a sibling project's one — this package is a subdirectory of a
    // larger multi-project repo, not its own git root. The sibling project
    // `bet` hit this and lost `proxy.ts` silently; pinning is cheap insurance.
    turbopack: {
      root: ROOT,
    },
  };
}
