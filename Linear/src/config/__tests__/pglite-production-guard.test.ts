// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { config, resetConfigForTests } from "../env";

/**
 * The guard that keeps an embedded database out of a deployment — and the one
 * escape hatch that is allowed past it.
 *
 * PGlite writes to a directory. On Vercel that directory is discarded when the
 * invocation ends, so a deployment that fell back to it would serve traffic
 * while forgetting every write: green health checks, empty workspace. The guard
 * turns that into a refusal at boot.
 *
 * The e2e suite then needs past it, because it runs the production build on a
 * real filesystem where the discard does not happen (`playwright.config.ts`).
 * An escape hatch around a guard like this is exactly the kind of thing that
 * ends up in a deployment's environment one day, so both of its conditions are
 * pinned here rather than trusted to the comment that explains them.
 */

const ENV_KEYS = [
  "NODE_ENV",
  "DB_DRIVER",
  "DATABASE_URL",
  "E2E_ALLOW_PGLITE_PRODUCTION_BUILD",
  "VERCEL",
  "VITEST",
  "AUTH_SECRET",
] as const;

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) saved.set(key, process.env[key]);
  // `config()` treats a Vitest run as a test environment, which is a different
  // branch from the one under test here.
  vi.stubEnv("VITEST", "");
  delete process.env.VITEST;
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  delete process.env.E2E_ALLOW_PGLITE_PRODUCTION_BUILD;
  // Production has a second requirement, and it is not the one under test: a
  // case that gets *past* the driver guard would otherwise fail on the missing
  // signing key and look like the guard rejecting it.
  process.env.AUTH_SECRET = "guard-test-secret-not-for-production-0123456789";
  resetConfigForTests();
});

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllEnvs();
  resetConfigForTests();
});

function buildWith(env: Record<string, string | undefined>): () => unknown {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfigForTests();
  return () => config();
}

describe("PGlite under NODE_ENV=production", () => {
  it("is refused by default", () => {
    expect(
      buildWith({ NODE_ENV: "production", DB_DRIVER: "pglite" }),
    ).toThrow(/does not survive a serverless invocation/);
  });

  it("is allowed when the e2e opt-in is set", () => {
    const built = buildWith({
      NODE_ENV: "production",
      DB_DRIVER: "pglite",
      E2E_ALLOW_PGLITE_PRODUCTION_BUILD: "true",
    })() as { db: { driver: string } };
    expect(built.db.driver).toBe("pglite");
  });

  it("is refused again on a host that announces itself as Vercel", () => {
    // The belt to the flag's braces. If the variable is ever pasted into a real
    // deployment's environment — the single most likely way this hatch becomes
    // the outage it exists to prevent — the host still wins.
    expect(
      buildWith({
        NODE_ENV: "production",
        DB_DRIVER: "pglite",
        E2E_ALLOW_PGLITE_PRODUCTION_BUILD: "true",
        VERCEL: "1",
      }),
    ).toThrow(/does not survive a serverless invocation/);
  });

  it("takes only the exact string, not any truthy value", () => {
    // `"1"`, `"yes"` and `""` are what a person types when they are guessing.
    // None of them should work: an opt-in that answers to approximations is one
    // a stray value can trip.
    for (const value of ["1", "yes", "TRUE", ""]) {
      expect(
        buildWith({
          NODE_ENV: "production",
          DB_DRIVER: "pglite",
          E2E_ALLOW_PGLITE_PRODUCTION_BUILD: value,
        }),
        `E2E_ALLOW_PGLITE_PRODUCTION_BUILD=${JSON.stringify(value)}`,
      ).toThrow(/does not survive a serverless invocation/);
    }
  });

  it("does not affect a deployment that has a real connection string", () => {
    // The opt-in is about the driver choice under production, not a licence to
    // ignore `DATABASE_URL` when one is present.
    const built = buildWith({
      NODE_ENV: "production",
      DB_DRIVER: undefined,
      DATABASE_URL: "postgres://user:pw@example.test/db",
    })() as { db: { driver: string } };
    expect(built.db.driver).toBe("neon");
  });
});
