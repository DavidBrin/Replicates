#!/usr/bin/env node
/**
 * Vercel build hook: apply schema and seed the flagship wall when Neon is wired.
 *
 * Skipped locally when DATABASE_URL is unset so `pnpm build` still works without
 * a database. On Vercel the Neon integration injects DATABASE_URL before build.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const nodeArgs = ["--experimental-strip-types"];

function run(script: string): void {
  const result = spawnSync(process.execPath, [...nodeArgs, script], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  process.stdout.write(
    "prebuild: DATABASE_URL unset — skipping db:push and seed-flagship.\n",
  );
  process.exit(0);
}

process.stdout.write("prebuild: applying schema and seeding the flagship wall…\n");
run(fileURLToPath(new URL("./db-push.ts", import.meta.url)));
run(fileURLToPath(new URL("./seed-flagship.ts", import.meta.url)));
