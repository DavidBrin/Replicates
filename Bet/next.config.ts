import type { NextConfig } from "next";

/**
 * Intentionally minimal. Everything else is Next's default, which is also
 * what Vercel detects with zero configuration.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Don't emit AGENTS.md / CLAUDE.md into the deliverable.
  agentRules: false,
};

export default nextConfig;
