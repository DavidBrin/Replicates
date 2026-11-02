#!/usr/bin/env node
/**
 * Starts the online e2e's server (Plan 6, Task 1): builds, then serves `out/` and the Worker
 * through wrangler's programmatic dev API with every watcher off, and prints E2E-READY once it
 * serves. `playwright.online.config.ts` waits for that line (`webServer.wait.stdout`).
 *
 * `wrangler dev` (the CLI) watches its assets directory and has no switch to stop it: after a
 * build it reloaded 3-8 times on `out/`'s file events and dropped the room Durable Object
 * mid-test (Plan 5's final gate). Its programmatic API takes `dev.watch: false`, which turns
 * off the assets watcher, the config watcher and the bundler's (wrangler 4.146,
 * `wrangler-dist/cli.js`: "config2.dev.watch !== false && config2.assets?.directory").
 * `unstable_startWorker` is that API's name in 4.146: a wrangler upgrade that changes it
 * fails here, at the start, never silently.
 *
 * Usage: node scripts/e2e/wrangler-e2e.mjs <port>
 */

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** What the dev server is started with: the repo's own config, every watcher off, fresh local state. */
export function e2eWorkerInput(root, port) {
  return {
    config: join(root, "wrangler.jsonc"),
    dev: { watch: false, server: { port }, persist: join(root, ".wrangler", "e2e-state") },
  };
}

async function main() {
  const port = Number(process.argv[2] ?? 8787);
  const build = spawnSync("pnpm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);

  const input = e2eWorkerInput(ROOT, port);
  rmSync(input.dev.persist, { recursive: true, force: true });
  process.env.WRANGLER_SEND_METRICS = "false";
  const { unstable_startWorker } = await import("wrangler");
  const worker = await unstable_startWorker(input);
  await worker.ready;
  process.stdout.write("E2E-READY\n");
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      void worker.dispose().finally(() => process.exit(0));
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
