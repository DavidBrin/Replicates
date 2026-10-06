#!/usr/bin/env node
/**
 * `pnpm run build:maps` — regenerate every map in `src/content/maps/`.
 *
 * The JSON is **committed**, so this is the regeneration step rather than a
 * build-time dependency: a reviewer sees a board's graph change in a diff
 * (D36), and `next build` never touches geodata (D40). Running it twice in a
 * row changes nothing — every stage is a pure function of the files in
 * `research/map-data/` and the specs in `scripts/maps/`.
 *
 * ## What it builds
 *
 *  - **Tier 1** (`maps/tier1.ts`) — Classic World 42/6/83, World Extended
 *    47/6/94 and Napoleonic Europe 59/11/127, from TotalRisk's Unlicense SVGs
 *    with the Classic graph taken from the seven-source-verified canonical file.
 *  - **Fixtures** (`maps/fixtures.ts`) — Tiny3, Tiny4, Mini and Quad, from
 *    Preeminence's MIT graphs with schematic grid geometry (D39).
 *  - **Tier 3** (`maps/regions.ts` + `maps/specs.ts`) — nine regional boards
 *    generated from Natural Earth and the ISC TopoJSON atlases.
 *
 * ## Why validation runs in a subprocess
 *
 * `validateMap` is the single gate every shipped map passes (D36, T7), and it
 * lives in `src/engine/map/schema.ts`, which this process cannot import:
 * `node --experimental-strip-types` needs a `.ts` extension on every relative
 * specifier and `tsc` forbids one (see `maps/engine.ts`). Rather than keep a
 * second validator here, the build writes the files and then runs the T7 suite,
 * which imports the real one. So a malformed map still fails the build — through
 * one validator, not two.
 *
 * Flags: `--suggest` prints the sea links each regional board still needs (how
 * the committed lists were authored); `--no-verify` skips the T7 subprocess.
 */

import { spawnSync } from "node:child_process";

import type { MapFile } from "../src/engine/types";

const TIER1_MODULE = "./maps/tier1.ts";
const FIXTURES_MODULE = "./maps/fixtures.ts";
const REGIONS_MODULE = "./maps/regions.ts";
const SPECS_MODULE = "./maps/specs.ts";
const EMIT_MODULE = "./maps/emit.ts";

const tier1 = (await import(TIER1_MODULE)) as typeof import("./maps/tier1");
const fixtures = (await import(FIXTURES_MODULE)) as typeof import("./maps/fixtures");
const regions = (await import(REGIONS_MODULE)) as typeof import("./maps/regions");
const specs = (await import(SPECS_MODULE)) as typeof import("./maps/specs");
const emit = (await import(EMIT_MODULE)) as typeof import("./maps/emit");

const flags = new Set(process.argv.slice(2));
const suggest = flags.has("--suggest");
const verify = !flags.has("--no-verify");

function section(title: string): void {
  process.stdout.write(`\n${title}\n`);
}

const built: MapFile[] = [];
let changed = 0;
let failures = 0;

function write(file: MapFile): void {
  try {
    const report = emit.writeMap(file);
    built.push(file);
    if (report.changed) changed++;
    process.stdout.write(`  ${emit.formatReport(report)}\n`);
  } catch (error) {
    failures++;
    process.stdout.write(`  ${file.slug.padEnd(24)}  FAILED: ${(error as Error).message}\n`);
  }
}

/* ------------------------------------------------------------------ tier 1 -- */

section("Tier 1 — real boards with licensed geometry (TotalRisk, Unlicense)");
for (const build of [tier1.classicWorld, tier1.worldExtended, tier1.napoleonicEurope]) {
  write(build());
}

/* ------------------------------------------------------------------ fixtures -- */

section("Fixtures — engine test boards, never in the picker (D39)");
for (const file of fixtures.buildFixtures()) write(file);

/* ------------------------------------------------------------------ tier 3 -- */

section("Tier 3 — generated from public-domain geodata (Natural Earth, world-atlas, us-atlas)");
for (const spec of specs.REGION_SPECS) {
  let result: import("./maps/regions").RegionBuild;
  try {
    result = regions.buildRegion(spec);
  } catch (error) {
    failures++;
    process.stdout.write(`  ${spec.slug.padEnd(24)}  FAILED: ${(error as Error).message}\n`);
    continue;
  }
  write(result.file);
  if (result.suggestions.length > 0) {
    // Not a failure here: the T7 connectivity gate is what refuses a board no
    // player could finish. This is the shortlist for authoring the fix.
    process.stdout.write(`    ${result.suggestions.length} unreachable component(s); suggested sea links:\n`);
    for (const [a, b] of result.suggestions) process.stdout.write(`      ["${a}", "${b}"],\n`);
  } else if (suggest) {
    process.stdout.write("    fully connected; no further sea links needed\n");
  }
}

/* ------------------------------------------------------------------ summary -- */

section("Summary");
const bytes = built.reduce((n, f) => n + JSON.stringify(f).length, 0);
const territories = built.reduce((n, f) => n + f.territories.length, 0);
process.stdout.write(
  `  ${built.length} maps, ${territories} territories, ${(bytes / 1024).toFixed(1)} KB total`
  + ` (largest ${(Math.max(0, ...built.map((f) => JSON.stringify(f).length)) / 1024).toFixed(1)} KB`
  + ` against a ${emit.SIZE_LIMIT / 1024} KB ceiling), ${changed} file(s) rewritten\n`,
);

if (failures > 0) {
  process.stdout.write(`  ${failures} map(s) failed to build\n`);
  process.exitCode = 1;
} else if (verify) {
  section("Validating with the T7 suite (the one validateMap)");
  const result = spawnSync(
    "npx",
    ["vitest", "run", "src/content/maps", "--reporter=dot"],
    { stdio: "inherit", shell: false },
  );
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}
