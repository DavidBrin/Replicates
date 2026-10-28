// @vitest-environment node
import { basename, join } from "node:path";

import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { describe, expect, it } from "vitest";

import { SRC_DIR, sourceFiles } from "@/lib/testing/sourceFiles";

import nextConfigFor from "../../next.config";

// Only the build id depends on the phase (next.config.ts); the export settings
// do not, and the dev phase reads them without needing a build id.
const nextConfig = nextConfigFor(PHASE_DEVELOPMENT_SERVER);

describe("the static export", () => {
  it("builds into out/ rather than needing a Node server", () => {
    expect(nextConfig.output).toBe("export");
  });

  it("keeps every route static: no route handlers anywhere under app/", () => {
    const handlers = sourceFiles(join(SRC_DIR, "app")).filter((file) =>
      /^route\.(ts|tsx)$/.test(basename(file)),
    );
    expect(handlers).toEqual([]);
  });

  it("emits /menu as out/menu.html, which is what Workers' auto-trailing-slash serves", () => {
    expect(nextConfig.trailingSlash ?? false).toBe(false);
  });
});
