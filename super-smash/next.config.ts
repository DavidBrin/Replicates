import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

/**
 * Which deploy this is, inlined into the bundle as `NEXT_PUBLIC_BUILD_ID` for
 * two online players to compare (`localBuild`, Plan 2 Task 27). A tab left
 * open across a deploy would otherwise pair with the new one and go out of
 * sync on the first frame the simulation changed.
 *
 * `BUILD_ID` names it when set; otherwise the commit this checkout is on, as
 * `pnpm run deploy` builds it; "dev" when git cannot say. It must be what the
 * lobby reads (`BUILD_ID` in src/net/online/lobby.ts), or every hello would be
 * dropped and every match refused, so anything else fails the build here.
 */
function buildId(): string {
  const id = process.env.BUILD_ID || commit() || "dev";
  if (!/^([0-9a-f]{7,40}|dev)$/.test(id)) {
    throw new Error(`BUILD_ID must be a lowercase hex commit id (7 to 40 digits) or "dev", not ${JSON.stringify(id)}`);
  }
  return id;
}

function commit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * A static export, served by the `david-smash` Cloudflare Worker's static
 * assets (wrangler.jsonc). Every route already prerenders — there is no route
 * handler, cookie, header, rewrite or image loader to lose (spec §3.3) — so
 * the whole game is files, and the Worker only runs for /api/* and /ws/*.
 */
const nextConfig: NextConfig = {
  output: "export",

  reactStrictMode: true,

  // The dev badge floats over the bottom-left corner of the grid, which is
  // exactly where a screenshot of the wall wants to be clean. Nothing here
  // needs it.
  devIndicators: false,

  // Don't emit AGENTS.md / CLAUDE.md into the deliverable.
  agentRules: false,

  env: { NEXT_PUBLIC_BUILD_ID: buildId() },

  // Pin Turbopack's inferred workspace root to this package. Without it,
  // Turbopack walks up from cwd looking for the "highest" lockfile and can
  // land on a sibling project's one — this package is a subdirectory of a
  // larger multi-project repo, not its own git root. The sibling project
  // `bet` hit this and lost `proxy.ts` silently; pinning is cheap insurance.
  turbopack: {
    root: ROOT,
  },
};

export default nextConfig;
