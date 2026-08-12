import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * Intentionally minimal. Everything else is Next's default, which is also
 * what Vercel detects with zero configuration.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  // The dev badge floats over the bottom-left corner of the grid, which is
  // exactly where a screenshot of the wall wants to be clean. Nothing here
  // needs it.
  devIndicators: false,

  // Don't emit AGENTS.md / CLAUDE.md into the deliverable.
  agentRules: false,

  // Pin Turbopack's inferred workspace root to this package. Without it,
  // Turbopack walks up from cwd looking for the "highest" lockfile and can
  // land on a sibling project's one — this package is a subdirectory of a
  // larger multi-project repo, not its own git root. The sibling project
  // `bet` hit this and lost `proxy.ts` silently; pinning is cheap insurance.
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
};

export default nextConfig;
