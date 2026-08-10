import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * Intentionally minimal — Vercel detects the rest with zero configuration.
 *
 * `turbopack.root` is pinned for the same reason as in `bet/`: this package is
 * a subdirectory of a larger repo, and Turbopack otherwise walks up looking for
 * the "highest" lockfile and pins the workspace root somewhere unrelated.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,

  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },

  async headers() {
    return [
      {
        // The service worker must be re-fetched, never served stale, or an
        // install-to-home-screen user is pinned to an old build forever.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Content-Type", value: "application/manifest+json" }],
      },
    ];
  },
};

export default nextConfig;
