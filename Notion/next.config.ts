import path from "node:path";
import type { NextConfig } from "next";

/**
 * Intentionally minimal.
 *
 * No `output: "export"` — a static export would remove Route Handlers, and
 * `/api/workspace` is the documented upgrade path from browser storage to a
 * real database. Everything else is Next's default, which is also what Vercel
 * detects with zero configuration.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  // This app lives in a subdirectory of its repository. Without an explicit
  // root, Turbopack walks upwards looking for a lockfile and can settle on
  // one outside the project.
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },

  // Don't emit AGENTS.md / CLAUDE.md into the deliverable.
  agentRules: false,
};

export default nextConfig;
