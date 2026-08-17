import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * Intentionally minimal — everything else is Next's default, which is also
 * what Vercel detects with zero configuration.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  // The dev badge floats over the bottom-left corner, which on a watch page is
  // exactly where the player's control bar and its fullscreen button live. It
  // gets in the way of both the app and its screenshots.
  devIndicators: false,

  // Don't emit AGENTS.md / CLAUDE.md into the deliverable.
  agentRules: false,

  // PGlite ships a ~3 MB WASM build of Postgres and Neon's driver opens raw
  // sockets; neither survives being traced and re-bundled. The S3 client is
  // only loaded when the R2 adapter is selected, and pulling it into the
  // default server bundle would cost every route a dependency that a
  // filesystem-backed development run never touches.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "@neondatabase/serverless",
    "@aws-sdk/client-s3",
  ],

  // Pin Turbopack's inferred workspace root to this package. Without it,
  // Turbopack walks up from cwd looking for the "highest" lockfile and can land
  // on a sibling project's one — this package is a subdirectory of a larger
  // multi-project repo, not its own git root.
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },

  /**
   * `/@handle` → the `[handle]` route.
   *
   * The channel slice established that Next owns the `@` prefix for *folder*
   * names — `app/(main)/@[handle]` declares a parallel-route slot rather than a
   * path segment — and concluded that a plain `[handle]` segment would capture
   * `/@veritasium` whole, `@` included. It does not: the router does not match
   * a leading `@` in the **URL** to a dynamic segment either, so every channel
   * page 404'd without the page component ever running. No error, no log line,
   * just a miss — which is why it survived a route probe that only checked for
   * 500s.
   *
   * The rewrite restores the product's URL without a redirect: the address bar
   * keeps `/@fieldnotes`, and the route sees a segment it will match. The page
   * still requires the `@` to have been present, so `/fieldnotes` remains a 404
   * rather than a second address for the same channel.
   */
  async rewrites() {
    return [
      { source: "/@:handle", destination: "/:handle/__at" },
      { source: "/@:handle/:tab", destination: "/:handle/__at/:tab" },
    ];
  },

  async headers() {
    return [
      {
        /**
         * The encode ladder runs in a Worker and wants
         * `SharedArrayBuffer`-adjacent isolation guarantees for the codec
         * pipeline. More importantly, cross-origin isolation is what unlocks
         * `performance.measureUserAgentSpecificMemory` and keeps
         * `VideoFrame` transfers off the structured-clone slow path.
         *
         * Scoped to the studio routes rather than applied site-wide: COEP
         * `require-corp` makes every cross-origin subresource opt in, and the
         * watch page has no reason to pay that.
         */
        source: "/studio/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default nextConfig;
