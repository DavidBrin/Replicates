import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * Intentionally minimal. Everything else is Next's default, which is also
 * what Vercel detects with zero configuration.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  // The dev badge floats over the bottom-left corner, exactly where a
  // fidelity-comparison screenshot wants to be clean. Nothing here needs it.
  devIndicators: false,

  // Pin Turbopack's inferred workspace root to this package. Without it,
  // Turbopack walks up from cwd looking for the "highest" lockfile and can
  // land on a sibling project's one — this package is a subdirectory of a
  // larger multi-project repo, not its own git root.
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
};

export default nextConfig;
