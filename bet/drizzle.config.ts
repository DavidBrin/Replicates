import { defineConfig } from "drizzle-kit";

/**
 * Optional: `pnpm db:push` against a Neon/Postgres URL. Runtime opens
 * apply the same schema via `src/adapters/postgres/ddl.ts` without needing
 * this CLI on Vercel.
 */
export default defineConfig({
  schema: "./src/adapters/postgres/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "memory://" },
});
