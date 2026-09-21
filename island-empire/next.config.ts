import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * Intentionally minimal — everything else is Next's default, which is also
 * what Vercel detects with zero configuration. The shape mirrors the sibling
 * replicas (`Linear`, `dollar-pixels`); see `research/00-repo-conventions.md`.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  // The dev badge floats over the bottom-left corner, which is exactly where
  // the in-game HUD's income/gold column lives. It gets in the way of the game
  // and of its screenshots.
  devIndicators: false,

  // Don't emit AGENTS.md / CLAUDE.md into the deliverable.
  agentRules: false,

  // PGlite ships a ~3 MB WASM build of Postgres and Neon's driver opens raw
  // sockets; neither survives being traced and re-bundled. Neon must still land
  // in the serverless function, hence the explicit tracing include.
  serverExternalPackages: ["@electric-sql/pglite", "@neondatabase/serverless"],
  outputFileTracingIncludes: {
    "/*": ["./node_modules/@neondatabase/serverless/**/*"],
  },

  // Pin Turbopack's inferred workspace root to this package. Without it,
  // Turbopack walks up from cwd looking for the "highest" lockfile and can land
  // on a sibling project's one — this package is a subdirectory of a larger
  // multi-project repo, not its own git root.
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
};

export default nextConfig;
