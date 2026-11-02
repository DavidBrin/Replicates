// @vitest-environment node
/**
 * The online e2e's server (Plan 6, Task 1): `scripts/e2e/wrangler-e2e.mjs` starts wrangler's
 * dev server through its programmatic API with watching off, so nothing written to `out/`
 * after the start reloads it, and the specs wait for its E2E-READY line.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { e2eWorkerInput } from "../../scripts/e2e/wrangler-e2e.mjs";

const ROOT = join(__dirname, "..", "..");

describe("the online e2e's wrangler (Plan 6, Task 1)", () => {
  it("serves the repo's own config with every watcher off, on the given port, with fresh state", () => {
    const input = e2eWorkerInput(ROOT, 8790);
    expect(input.config).toBe(join(ROOT, "wrangler.jsonc"));
    expect(input.dev.watch).toBe(false);
    expect(input.dev.server.port).toBe(8790);
    expect(input.dev.persist).toBe(join(ROOT, ".wrangler", "e2e-state"));
  });
});
