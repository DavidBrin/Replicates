import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

/**
 * A build id's form: a commit id as git abbreviates it, optionally followed by
 * `-` and 8 hex digits of uncommitted changes, or "dev". The lobby reads the
 * same form (`BUILD_ID` in src/net/online/lobby.ts), or every hello would be
 * dropped and every match refused, so anything else fails the build here.
 */
const BUILD_ID_FORM = /^([0-9a-f]{7,40}(-[0-9a-f]{8})?|dev)$/;

/** What git says about this package's checkout; null with no git (an archive, a bare CI copy). */
export interface Checkout {
  readonly commit: string;
  /** 8 hex digits of a hash of the uncommitted changes in this package, or null for a clean tree. */
  readonly dirty: string | null;
}

/**
 * Which deploy this is, inlined into the bundle as `NEXT_PUBLIC_BUILD_ID` for
 * two online players to compare (`localBuild`, Plan 2 Task 27). A tab left
 * open across a deploy would otherwise pair with the new one and go out of
 * sync on the first frame the simulation changed.
 *
 * - `BUILD_ID` names it when set.
 * - Otherwise the commit this checkout is on, as `pnpm run deploy` builds it;
 *   with uncommitted changes in this package (tracked or untracked), the commit
 *   plus `-` and a hash of them, so two deploys built from different edits of
 *   one commit refuse each other instead of pairing and desyncing.
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
  return id;
}

function git(args: readonly string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/** This package's commit, and a hash of `git diff HEAD -- .` plus every untracked file in it, if any. */
export function readCheckout(): Checkout | null {
  const commit = git(["rev-parse", "--short=12", "HEAD"])?.trim();
  if (!commit) return null;
  const diff = git(["-c", "core.quotepath=off", "diff", "--no-ext-diff", "--no-color", "--binary", "HEAD", "--", "."]) ?? "";
  const untracked = (git(["ls-files", "--others", "--exclude-standard", "-z", "--", "."]) ?? "").split("\0").filter(Boolean).sort();
  if (diff === "" && untracked.length === 0) return { commit, dirty: null };
  const hash = createHash("sha256").update(diff);
  for (const file of untracked) hash.update(`\0${file}\0`).update(readFileSync(join(ROOT, file)));
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
