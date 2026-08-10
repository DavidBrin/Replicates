import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * Intentionally minimal. Everything else is Next's default, which is also
 * what Vercel detects with zero configuration.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Don't emit AGENTS.md / CLAUDE.md into the deliverable.
  agentRules: false,

  // Pin Turbopack's inferred workspace root to this package. Without this,
  // Turbopack walks up from cwd looking for the "highest" lockfile and can
  // land on an unrelated one elsewhere under the developer's home directory
  // (this repo isn't its own git root — `Bet/` is a subdirectory of a
  // larger repo), which desyncs the root used for root-level file
  // conventions (notably `proxy.ts`, Task 4) from this package's actual
  // directory. Symptom without this: `proxy.ts` silently never runs (empty
  // `middleware-manifest.json`), no error, alongside a
  // "Next.js ignored package-lock.json in ... because it is outside the
  // current Git repository" warning at startup.
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
};

export default nextConfig;
