/**
 * Reading the committed bake from disk, for vitest and Node scripts (Plan 4).
 * The browser goes through `bake.ts`; both verify the same digest.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { decodeBake } from "@/engine/acmd/bakeCodec";
import { bakeTables, type BakeTables } from "@/engine/acmd/bakeTables";
import { BAKE_DIGEST } from "@/fighters/bake/digest";

export function readBakeFromDisk(root = process.cwd()): BakeTables {
  const bytes = gunzipSync(readFileSync(join(root, "public", "bake", "roster.bin.gz")));
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== BAKE_DIGEST) {
    throw new Error("public/bake/roster.bin.gz does not match BAKE_DIGEST — run UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts");
  }
  return bakeTables(decodeBake(new Uint8Array(bytes)), digest);
}
