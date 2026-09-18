import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * Intentionally minimal — everything else is Next's default, which is also
 * what Vercel detects with zero configuration.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  // The open sign-up page is gone: this is a portfolio demo, and a self-serve
  // account had no workspace to land in and no UI to make one, so it only ever
  // bounced back to the marketing page. Anyone still holding a `/signup` link —
  // an old bookmark, or the marketing CTAs before this change — lands on the
  // demo sign-in instead of a 404. Real membership still arrives through an
  // invitation at `/invite/[token]`, which is untouched. `permanent: false`
  // (307) leaves the door open to restoring real sign-up later.
  async redirects() {
    return [{ source: "/signup", destination: "/signin", permanent: false }];
  },

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
  // ever simplified away. Neon must still land in the serverless function:
  // `webpackIgnore` on a variable specifier hid it from file tracing, which
  // is why production 500'd with "Cannot find package '@neondatabase/serverless'".
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
