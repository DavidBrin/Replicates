import "server-only";

/**
 * Every environment variable the server reads, in one place, read once.
 *
 * Two rules hold this file together:
 *
 *  - **Nothing else in `src/` reads `process.env`.** A value that is worth
 *    configuring is worth naming, defaulting and validating exactly once; a
 *    `process.env.X ?? 5` scattered through a component is a constant with
 *    extra steps and no error message. There is a unit test that greps for
 *    violations.
 *  - **A wrong value is a boot failure, never a fallback.** The sibling project
 *    `dollar-pixels` learned this the expensive way: an unrecognised driver
 *    name fell through to the default, and a deployment served traffic while
 *    quietly forgetting every write. Here an unknown `DB_DRIVER` throws.
 */

/* ------------------------------------------------------------- helpers --- */

function raw(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function str(name: string, fallback: string): string {
  return raw(name) ?? fallback;
}

function int(name: string, fallback: number): number {
  const value = raw(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer, got "${value}"`);
  }
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const value = raw(name)?.toLowerCase();
  if (value === undefined) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`${name} must be a boolean, got "${value}"`);
}

function oneOf<T extends string>(
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = raw(name)?.toLowerCase();
  if (value === undefined) return fallback;
  const match = allowed.find((candidate) => candidate === value);
  if (!match) {
    throw new Error(
      `${name} must be one of ${allowed.join(", ")}, got "${raw(name)}"`,
    );
  }
  return match;
}

/* --------------------------------------------------------------- types --- */

/**
 * The two engines, both Postgres.
 *
 * `pglite` is Postgres compiled to WASM, running in-process — the local
 * default, and what the test suite pins. `neon` is a hosted Postgres, which is
 * what a deployment needs, because Vercel's filesystem does not survive the
 * invocation that wrote to it. There is deliberately no third "memory" driver:
 * an in-memory store that is not Postgres would let the suite pass on
 * semantics the deployment does not share.
 */
export const DB_DRIVERS = ["pglite", "neon"] as const;
export type DbDriver = (typeof DB_DRIVERS)[number];

export const AI_PROVIDERS = ["anthropic", "openai", "none"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

export interface ServerConfig {
  readonly isProduction: boolean;
  readonly isTest: boolean;

  readonly db: {
    readonly driver: DbDriver;
    /** PGlite's data directory, or `":memory:"`. Ignored by the Neon driver. */
    readonly dataDir: string;
    readonly url: string | undefined;
  };

  readonly auth: {
    readonly secret: string;
    readonly sessionTtlSeconds: number;
    readonly cookieName: string;
    readonly allowOpenSignup: boolean;
    /** How long an unaccepted workspace invite stays valid. */
    readonly inviteTtlSeconds: number;
  };

  readonly workspace: {
    readonly seedDemoData: boolean;
  };

  readonly ai: {
    readonly defaultProvider: AiProviderId;
    readonly anthropic: {
      readonly apiKey: string | undefined;
      readonly model: string;
      readonly baseUrl: string;
      readonly apiVersion: string;
      readonly maxTokens: number;
      readonly effort: string;
    };
    readonly openai: {
      readonly apiKey: string | undefined;
      readonly model: string;
      readonly baseUrl: string;
      readonly maxTokens: number;
    };
    readonly timeoutMs: number;
  };
}

/* ---------------------------------------------------------- the secret --- */

/**
 * A development-only session key, derived rather than hardcoded.
 *
 * In production `AUTH_SECRET` is mandatory — a signing key committed to a
 * repository is not a signing key. In development an unset secret produces a
 * per-process random one, so sessions work immediately and die on restart,
 * which is the honest behaviour: it can never be mistaken for a configured
 * deployment.
 */
let developmentSecret: string | undefined;

function authSecret(isProduction: boolean): string {
  const configured = raw("AUTH_SECRET");
  if (configured) {
    if (configured.length < 32 && isProduction) {
      throw new Error("AUTH_SECRET must be at least 32 characters");
    }
    return configured;
  }
  if (isProduction) {
    throw new Error(
      "AUTH_SECRET is required in production. Generate one with: openssl rand -base64 32",
    );
  }
  if (!developmentSecret) {
    developmentSecret = `dev-only-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`.padEnd(
      48,
      "0",
    );
    console.warn(
      "[config] AUTH_SECRET is unset — using an ephemeral development key. " +
        "Every restart signs out every session. Set AUTH_SECRET to stop this.",
    );
  }
  return developmentSecret;
}

/* --------------------------------------------------------------- build --- */

function build(): ServerConfig {
  const nodeEnv = process.env.NODE_ENV;
  const isProduction = nodeEnv === "production";
  const isTest = nodeEnv === "test" || raw("VITEST") !== undefined;

  const url = raw("DATABASE_URL");
  // A connection string is the signal, not a separate switch: if one is
  // present the deployment clearly means to use it, and if it is absent there
  // is nothing for the Neon driver to connect to. `DB_DRIVER` stays available
  // to force the choice, which is what the e2e suite uses to pin PGlite even
  // when a developer has a real DATABASE_URL exported.
  const driver = oneOf<DbDriver>("DB_DRIVER", DB_DRIVERS, url ? "neon" : "pglite");

  if (driver === "neon" && !url) {
    throw new Error("DB_DRIVER=neon requires DATABASE_URL");
  }

  // Loud rather than silent. PGlite writes to a directory, and on Vercel that
  // directory is discarded when the invocation ends — a deployment that fell
  // back to it would serve traffic while forgetting every write, which is
  // exactly the failure the sibling project `dollar-pixels` shipped once.
  if (isProduction && driver === "pglite") {
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
      dataDir: str("DB_DATA_DIR", isTest ? ":memory:" : ".data/linear"),
      url,
    },

    auth: {
      secret: authSecret(isProduction),
      sessionTtlSeconds: int("SESSION_TTL_SECONDS", 60 * 60 * 24 * 30),
      cookieName: str("SESSION_COOKIE_NAME", "linear_session"),
      allowOpenSignup: bool("ALLOW_OPEN_SIGNUP", true),
      inviteTtlSeconds: int("INVITE_TTL_SECONDS", 60 * 60 * 24 * 14),
    },

    workspace: {
      seedDemoData: bool("SEED_DEMO_DATA", false),
    },

    ai: {
      defaultProvider: oneOf<AiProviderId>(
        "AI_DEFAULT_PROVIDER",
        AI_PROVIDERS,
        "anthropic",
      ),
      anthropic: {
        apiKey: raw("ANTHROPIC_API_KEY"),
        model: str("ANTHROPIC_MODEL", "claude-opus-5"),
        baseUrl: str("ANTHROPIC_BASE_URL", "https://api.anthropic.com"),
        apiVersion: str("ANTHROPIC_API_VERSION", "2023-06-01"),
        // Thinking is on by default on this model family, and `max_tokens` caps
        // thinking *plus* response text. 4096 leaves room for both on the short,
        // structured completions this app asks for; `effort: low` keeps the
        // latency of an issue-summary request in the range a UI can wait for.
        maxTokens: int("ANTHROPIC_MAX_TOKENS", 4096),
        effort: str("ANTHROPIC_EFFORT", "low"),
      },
      openai: {
        apiKey: raw("OPENAI_API_KEY"),
        model: str("OPENAI_MODEL", "gpt-5"),
        baseUrl: str("OPENAI_BASE_URL", "https://api.openai.com"),
        maxTokens: int("OPENAI_MAX_TOKENS", 4096),
      },
      timeoutMs: int("AI_TIMEOUT_MS", 60_000),
    },
  };
}

let cached: ServerConfig | undefined;

/**
 * The config for this process.
 *
 * Memoised, because the validation should run once and because
 * `authSecret`'s development fallback must return the same key for the life of
 * the process or every request would invalidate the last one's cookie.
 * {@link resetConfigForTests} exists so a suite can vary the environment.
 */
export function config(): ServerConfig {
  return (cached ??= build());
}

export function resetConfigForTests(): void {
  cached = undefined;
  developmentSecret = undefined;
}
