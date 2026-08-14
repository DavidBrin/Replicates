import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * Intentionally minimal — everything else is Next's default, which is also
 * what Vercel detects with zero configuration.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  // The dev badge floats over the bottom-left corner, which is where the
  // sidebar's workspace switcher and the "new issue" affordance live. It gets
  // in the way of both the app and its screenshots.
  devIndicators: false,

  // Don't emit AGENTS.md / CLAUDE.md into the deliverable.
  agentRules: false,

  // PGlite ships a ~3 MB WASM build of Postgres and Neon's driver opens raw
  // sockets; neither survives being traced and re-bundled. Both are also
  // imported through variable specifiers so no bundler follows them, but
  // marking them external keeps the server build honest if that indirection is
  // ever simplified away.
  serverExternalPackages: ["@electric-sql/pglite", "@neondatabase/serverless"],

  // Pin Turbopack's inferred workspace root to this package. Without it,
  // Turbopack walks up from cwd looking for the "highest" lockfile and can land
  // on a sibling project's one — this package is a subdirectory of a larger
  // multi-project repo, not its own git root.
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
};

export default nextConfig;
