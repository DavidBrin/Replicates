#!/usr/bin/env node
/**
 * Apply `schema.sql` to Neon.
 *
 * Run by `pnpm run db:push` and by the Vercel build command, before `next
 * build`. Every statement in the schema is idempotent, so applying it on
 * every deploy is safe — and doing it in the build rather than on first
 * request matters: Hobby builds one deployment at a time, which makes this
 * race-free, while a function that migrates on cold start migrates once per
 * instance from however many happen to be warming.
 *
 * This script talks to the driver directly and reads `schema.sql` off disk.
 * The runtime cannot do that: on Vercel the function's working directory is
 * not the repository. This runs during the build, in the checkout.
 *
 * The schema is executed as **one script** rather than statement by statement.
 * Neon's WebSocket session uses the simple query protocol, which accepts the
 * whole file. An error names a character offset, which {@link report} turns
 * back into a line and its surrounding text.
 */

import { readFileSync } from "node:fs";

const SCHEMA_SQL = readFileSync(
  new URL("../src/adapters/store/schema.sql", import.meta.url),
  "utf8",
);

interface NeonClientLike {
  query(sql: string): Promise<unknown>;
  release(): void;
}

interface NeonPoolLike {
  connect(): Promise<NeonClientLike>;
  end(): Promise<void>;
}

function databaseUrl(): string {
  const url = process.env["DATABASE_URL"]?.trim();
  if (!url) {
    throw new Error("db:push requires DATABASE_URL");
  }
  return url;
}

async function applyToNeon(connectionString: string): Promise<void> {
  const neon = (await import("@neondatabase/serverless")) as unknown as {
    Pool: new (config: { connectionString: string }) => NeonPoolLike;
    neonConfig: { webSocketConstructor?: unknown };
  };

  if (typeof globalThis.WebSocket === "undefined") {
    // Node has had a global WebSocket since 22, so this is a fallback for a
    // build image running something older rather than the expected path.
    const wsSpecifier = "ws";
    const ws = (await import(/* webpackIgnore: true */ wsSpecifier)) as {
      default: unknown;
    };
    neon.neonConfig.webSocketConstructor = ws.default;
  }

  const pool = new neon.Pool({ connectionString });
  try {
    // A pooled `query()` would go over HTTP, which takes one statement. A
    // connection is a real Postgres session, and the simple query protocol
    // accepts the whole script.
    const client = await pool.connect();
    try {
      await client.query(SCHEMA_SQL);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

function report(error: unknown): string {
  const position = Number(
    (error as { position?: string | number } | null)?.position ?? Number.NaN,
  );
  const message = error instanceof Error ? error.message : String(error);
  if (!Number.isFinite(position)) return message;

  const upTo = SCHEMA_SQL.slice(0, position);
  const line = upTo.split("\n").length;
  const lines = SCHEMA_SQL.split("\n");
  const context = lines
    .slice(Math.max(0, line - 3), line + 2)
    .map((text, index) => `  ${Math.max(1, line - 2) + index} | ${text}`)
    .join("\n");
  return `${message}\n\nschema.sql:${line}\n${context}`;
}

async function main(): Promise<void> {
  const url = databaseUrl();
  process.stdout.write("Applying schema to neon…\n");
  const started = Date.now();
  try {
    await applyToNeon(url);
  } catch (error) {
    process.stderr.write(`Schema failed.\n${report(error)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Schema applied in ${Date.now() - started}ms.\n`);
}

await main();
