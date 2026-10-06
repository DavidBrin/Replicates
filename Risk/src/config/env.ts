import "server-only";

/**
 * Every environment variable the server reads, in one place, read once.
 *
 *  - Nothing else in `src/` reads `process.env`.
 *  - A wrong value is a boot failure, never a fallback: an unknown `DB_DRIVER`
 *    throws instead of silently choosing a default.
 *
 * Shape and reasoning follow the sibling replica `Linear/src/config/env.ts`.
 */

function raw(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function str(name: string, fallback: string): string {
  return raw(name) ?? fallback;
}

function oneOf<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const value = raw(name)?.toLowerCase();
  if (value === undefined) return fallback;
  const match = allowed.find((candidate) => candidate === value);
  if (!match) {
    throw new Error(`${name} must be one of ${allowed.join(", ")}, got "${raw(name)}"`);
  }
  return match;
}

export const DB_DRIVERS = ["pglite", "neon"] as const;
export type DbDriver = (typeof DB_DRIVERS)[number];

export interface ServerConfig {
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly db: {
    readonly driver: DbDriver;
    /** PGlite's data directory, or `":memory:"`. Ignored by the Neon driver. */
    readonly dataDir: string;
    readonly url: string | undefined;
  };
}

/**
 * The one case where PGlite under `NODE_ENV=production` is not a mistake: the
 * e2e suite runs `next build && next start` on a real filesystem. The flag
 * must be set explicitly AND no serverless host may be announcing itself, so
 * the escape hatch can never travel to a deployment.
 */
function allowsPgliteUnderProduction(): boolean {
  return raw("E2E_ALLOW_PGLITE_PRODUCTION_BUILD") === "true" && !isServerless();
}

function isServerless(): boolean {
  return SERVERLESS_MARKERS.some((name) => Boolean(raw(name)));
}

const SERVERLESS_MARKERS = [
  "VERCEL",
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_EXECUTION_ENV",
  "NETLIFY",
  "RENDER",
  "FLY_APP_NAME",
  "K_SERVICE",
  "FUNCTION_TARGET",
  "FUNCTIONS_WORKER_RUNTIME",
  "CF_PAGES",
] as const;

function build(): ServerConfig {
  const nodeEnv = process.env.NODE_ENV;
  const isProduction = nodeEnv === "production";
  const isTest = nodeEnv === "test" || raw("VITEST") !== undefined;

  const url = raw("DATABASE_URL");
  // A connection string is the signal, not a separate switch. `DB_DRIVER`
  // stays available to force the choice, which is what the e2e suite uses.
  const driver = oneOf<DbDriver>("DB_DRIVER", DB_DRIVERS, url ? "neon" : "pglite");

  if (driver === "neon" && !url) {
    throw new Error("DB_DRIVER=neon requires DATABASE_URL");
  }

  if (isProduction && driver === "pglite" && !allowsPgliteUnderProduction()) {
    throw new Error(
      "DB_DRIVER=pglite cannot be used in production: its storage does not " +
        "survive a serverless invocation. Set DATABASE_URL to a Postgres " +
        "connection string.",
    );
  }

  return {
    isProduction,
    isTest,
    db: {
      driver,
      dataDir: str("DB_DATA_DIR", isTest ? ":memory:" : ".data/risk"),
      url,
    },
  };
}

let cached: ServerConfig | undefined;

/** The validated server configuration, built once per process. */
export function config(): ServerConfig {
  if (!cached) cached = build();
  return cached;
}

/** Test hook: forget the cached config so the next `config()` re-reads env. */
export function resetConfigForTests(): void {
  cached = undefined;
}
