import { z } from "zod";

/**
 * Configuration, resolved once and validated at the edge.
 *
 * The promise this file is responsible for keeping is that `pnpm install &&
 * pnpm dev` works against a completely empty environment. Every variable below
 * either has a development default or is only required by a code path that a
 * default run never reaches.
 */

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  /* ------------------------------------------------------------ database - */

  /**
   * Which engine. Inferred from `DATABASE_URL` when unset, which is the right
   * default for a deployment; naming it explicitly is how the test suites stop
   * a developer's exported connection string from being seeded with demo data.
   */
  DB_DRIVER: z.enum(["pglite", "neon"]).optional(),
  DATABASE_URL: z.string().optional(),
  /** PGlite's data directory, or `:memory:` for a database per process. */
  DB_DATA_DIR: z.string().default(".data/db"),

  /* ---------------------------------------------------------- blob store - */

  BLOB_DRIVER: z.enum(["filesystem", "r2"]).optional(),
  BLOB_FS_ROOT: z.string().default(".data/blobs"),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  /**
   * The custom domain or `r2.dev` origin segments are served from. Its presence
   * is what lets `publicUrl` return a real URL and take our server out of the
   * media path entirely — which is the whole economic argument for R2.
   */
  R2_PUBLIC_BASE_URL: z.string().optional(),

  /* ----------------------------------------------------------------- auth - */

  /**
   * Signing key for session cookies. A development default exists so a fresh
   * clone boots; production refuses it, because a shipped app whose session
   * secret is in a public repository is not authenticated at all.
   */
  AUTH_SECRET: z
    .string()
    .min(32)
    .default("development-only-secret-do-not-use-in-production-0000"),

  /* -------------------------------------------------------------- feature - */

  SEED_DEMO_DATA: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  /** Off, and there is no adapter to turn on. See `ports/live-ingest.ts`. */
  LIVE_INGEST_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  /**
   * Lets the Playwright suite run a production build against PGlite. Scoped
   * narrowly and refused on Vercel, so it cannot travel from the test harness
   * to a deployment.
   */
  E2E_ALLOW_PGLITE_PRODUCTION_BUILD: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  VERCEL: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: ResolvedConfig | null = null;

export interface ResolvedConfig {
  readonly env: Env;
  readonly dbDriver: "pglite" | "neon";
  readonly blobDriver: "filesystem" | "r2";
  readonly isProduction: boolean;
}

export function config(): ResolvedConfig {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment:\n${parsed.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n")}`,
    );
  }
  const env = parsed.data;
  const isProduction = env.NODE_ENV === "production";

  const dbDriver = env.DB_DRIVER ?? (env.DATABASE_URL ? "neon" : "pglite");

  /**
   * PGlite writes to a directory. On Vercel that directory is discarded when
   * the invocation that created it ends, so a deployment backed by PGlite
   * would appear to work, serve one request, and then present as an app that
   * has forgotten everything. Refusing here turns a confusing production
   * symptom into a boot-time error.
   *
   * The escape hatch is for the e2e suite, which really does have a filesystem
   * and one long-lived process. It is refused on Vercel specifically so that
   * setting it cannot make a deployment boot.
   */
  if (
    dbDriver === "pglite" &&
    isProduction &&
    !(env.E2E_ALLOW_PGLITE_PRODUCTION_BUILD && !env.VERCEL)
  ) {
    throw new Error(
      "PGlite cannot back a production deployment: its data directory does " +
        "not survive the invocation that wrote to it. Set DATABASE_URL to a " +
        "Neon connection string.",
    );
  }

  if (dbDriver === "neon" && !env.DATABASE_URL) {
    throw new Error("DB_DRIVER=neon requires DATABASE_URL.");
  }

  const blobDriver =
    env.BLOB_DRIVER ?? (env.R2_ACCOUNT_ID ? "r2" : "filesystem");

  if (blobDriver === "r2") {
    const missing = (
      [
        "R2_ACCOUNT_ID",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET",
      ] as const
    ).filter((k) => !env[k]);
    if (missing.length > 0) {
      throw new Error(`BLOB_DRIVER=r2 requires: ${missing.join(", ")}`);
    }
  }

  /**
   * The filesystem blob adapter has the same problem PGlite does, and it is
   * worth failing separately rather than folding into the database check —
   * a deployment could plausibly use Neon for metadata and then quietly lose
   * every uploaded segment, which is a much harder symptom to read.
   */
  if (
    blobDriver === "filesystem" &&
    isProduction &&
    !(env.E2E_ALLOW_PGLITE_PRODUCTION_BUILD && !env.VERCEL)
  ) {
    throw new Error(
      "The filesystem blob store cannot back a production deployment: " +
        "uploaded segments would not survive the invocation that wrote them. " +
        "Configure R2.",
    );
  }

  if (
    isProduction &&
    env.AUTH_SECRET.startsWith("development-only-secret")
  ) {
    throw new Error("AUTH_SECRET must be set in production.");
  }

  cached = { env, dbDriver, blobDriver, isProduction };
  return cached;
}

/** Tests only: forget the memoised config so a new environment takes effect. */
export function resetConfigForTests(): void {
  cached = null;
}
