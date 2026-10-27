// @vitest-environment node
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR, sourceFiles } from "@/lib/testing/sourceFiles";

import nextConfig from "../../next.config";

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
