// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FIGHTERS } from "@/fighters";
import { getCharacterRig } from "@/render/chars";
import { BONE_NAMES } from "@/render/skeleton";
import { referenceScriptBones } from "../bake/roster";
import { parseBoneDump, skeletonFromDump } from "../pipeline/dump";
import { PIVOT_BONE, driveFor } from "../retarget/map";
import { calibrate } from "../retarget/retarget";
import { buildRig, parseSkeletonFile } from "../skeleton/skeleton";
import { hurtBonesFor } from "./hurtBones";

/**
 * The committed skeletons (Plan 4 Task 6): trimmed from the SDNA reader's
 * dumps (`pnpm models:skeletons` → `.model-cache/dumps/<id>.sdna.json`, no
 * Blender) by
 *
 *   UPDATE_SKELETONS=1 pnpm vitest run src/render3d/skeletons/skeletons.test.ts
 *
 * and checked here on every run, with no model cache needed.
 */

const DIR = join(process.cwd(), "src", "render3d", "skeletons");
const DUMPS = join(process.cwd(), ".model-cache", "dumps");
/** Bones a reference script names that a fighter's skeleton does not have, with the reason. Starts empty. */
const MISSING: Readonly<Record<string, Readonly<Record<string, string>>>> = JSON.parse(readFileSync(join(DIR, "missing.json"), "utf8"));

function neededBones(fighterId: string): Set<string> {
  const out = new Set<string>([PIVOT_BONE.toLowerCase()]);
  for (const name of BONE_NAMES) {
    const drive = driveFor(fighterId, name);
    for (const b of [...(drive?.bones ?? []), ...(drive?.tips ?? [])]) if (b !== null) out.add(b.toLowerCase());
  }
  for (const b of referenceScriptBones(fighterId)) out.add(b);
  for (const b of hurtBonesFor(fighterId).bones) out.add(b.toLowerCase());
  return out;
}

/**
 * The committed files' SHA-256s: the values Plan 4 Task 6 pins (R8), byte for
 * byte. A different hash means a different reader, input or trim, so changing
 * one is a decision to record, not a refresh.
 */
const PINNED_SHA256: Readonly<Record<string, string>> = {
  mario: "bce25b5f8c91da0b2d4797d6d3505a4d01b128e3b152e019e794008bb58e1437",
  donkeyKong: "6abbf23b65b4cd0567e58f5df468995ae1f04b400b794819efe68ca7b082d231",
  link: "af59feb06d05b2385237cd932a9dbdc3be3f40b1c50134e6fbc85219cbcf1df0",
  samus: "7bbd7692dab8c7b19b5b8413991c4f6455231e257661120eef52a6329b6914bc",
  kirby: "5071914b55e84bdd9bd29fdcad595875772304dcfb24c75d66df00113126089c",
  fox: "31ccc011338a1ab5e21778441b3bc0c37a274020f3bd3cd61d9e46f8a7a4a9ae",
  pikachu: "228b9d901863d3df75733ea3dfdd362b39782215509b258fb55e0f9f16c1c1a1",
  marth: "90c99d5187e581be0d9dd98866eeb6ad21dc74d8fa10ff8fc3a9d5b08ad52d4b",
};

const dumpFile = (fighterId: string) => join(DUMPS, `${fighterId}.sdna.json`);

/**
 * A fighter's committed text, trimmed from its local dump. It is re-read the way
 * `index.ts` reads it (`parseSkeletonFile`, the committed 2e-3 tolerance), so a
 * dump-only residue between 2e-3 and the dump's 5e-3 that survives the trim is
 * refused here, not at every import after the write.
 */
function skeletonText(fighterId: string): string {
  if (!existsSync(dumpFile(fighterId))) throw new Error(`no dump for ${fighterId}: run pnpm models:fetch && pnpm models:skeletons first`);
  const dump = parseBoneDump(JSON.parse(readFileSync(dumpFile(fighterId), "utf8")));
  const text = JSON.stringify(skeletonFromDump(dump, neededBones(fighterId)), null, 1) + "\n";
  parseSkeletonFile(JSON.parse(text));
  return text;
}

describe("the committed fighter skeletons", () => {
  if (process.env.UPDATE_SKELETONS === "1") {
    it("trims every SDNA dump in .model-cache/dumps/ into src/render3d/skeletons/", () => {
      // Every fighter is trimmed and re-checked before any file is written.
      const texts = FIGHTERS.map((def) => [def.id, skeletonText(def.id)] as const);
      for (const [id, text] of texts) writeFileSync(join(DIR, `${id}.json`), text);
    });
    return;
  }

  it("pins exactly the roster's skeletons to the plan's SHA-256s", () => {
    expect(Object.keys(PINNED_SHA256).sort()).toEqual(FIGHTERS.map((d) => d.id).sort());
  });

  for (const def of FIGHTERS) {
    it(`${def.id}: is byte-identical to the skeleton the plan pins (SHA-256, R8)`, () => {
      expect(createHash("sha256").update(readFileSync(join(DIR, `${def.id}.json`))).digest("hex")).toBe(PINNED_SHA256[def.id]);
    });

    it.skipIf(!existsSync(dumpFile(def.id)))(`${def.id}: is what its local dump trims to today (not stale)`, () => {
      expect(readFileSync(join(DIR, `${def.id}.json`), "utf8")).toBe(skeletonText(def.id));
    });

    it(`${def.id}: calibrates against the retarget map (fails loudly naming a missing mapped bone)`, () => {
      const skeleton = parseSkeletonFile(JSON.parse(readFileSync(join(DIR, `${def.id}.json`), "utf8")));
      expect(skeleton.fighter).toBe(def.id);
      const cal = calibrate(buildRig(skeleton), getCharacterRig(def.id).bones);
      expect(cal.drives.length).toBeGreaterThanOrEqual(15);
    });

    it(`${def.id}: has every bone its published scripts hang hitboxes on, or says why not`, () => {
      const skeleton = parseSkeletonFile(JSON.parse(readFileSync(join(DIR, `${def.id}.json`), "utf8")));
      const have = new Set(skeleton.bones.map((b) => b.name.toLowerCase()));
      const missing = [...referenceScriptBones(def.id)].filter((b) => !have.has(b)).sort();
      expect(missing).toEqual(Object.keys(MISSING[def.id] ?? {}).sort());
    });

    it(`${def.id}: has a hurt capsule on every bone hurtBones.json lists, the head among them`, () => {
      const skeleton = parseSkeletonFile(JSON.parse(readFileSync(join(DIR, `${def.id}.json`), "utf8")));
      const { head, bones } = hurtBonesFor(def.id);
      expect(skeleton.hurt.map((h) => h.bone)).toEqual(bones);
      expect(bones).toContain(head);
      expect(skeleton.hurt.length).toBeGreaterThanOrEqual(7);
    });
  }
});
