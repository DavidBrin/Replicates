import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * Intentionally minimal, mirroring the sibling `youtube` project's
 * `next.config.ts` — see `research/07-stack-deployment.md` (Lane 7) and
 * `Wikipedia/research/01-repo-conventions.md`.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  // The dev badge floats over the bottom-left corner, which is exactly where
  // a DAW's transport controls live.
  devIndicators: false,

  // Don't emit AGENTS.md / CLAUDE.md into the deliverable.
  agentRules: false,

  // Pin Turbopack's inferred workspace root to this package. Without it,
  // Turbopack walks up from cwd looking for the "highest" lockfile and can
  // land on a sibling project's one — this package is a subdirectory of a
  // larger multi-project repo, not its own git root. `fileURLToPath`, not
  // `URL.pathname`: this repository lives under a directory with a space in
  // its name (`Personal Projects`), and `.pathname` hands back a
  // percent-encoded path that resolves to nothing. The package folder itself
  // is `fl-studio` (no space) so Vercel serverless function names stay valid.
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
};

export default nextConfig;
