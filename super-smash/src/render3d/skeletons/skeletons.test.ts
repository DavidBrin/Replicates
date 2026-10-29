// @vitest-environment node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FIGHTERS } from "@/fighters";
import { getCharacterRig } from "@/render/chars";
import { BONE_NAMES } from "@/render/skeleton";
import { referenceScriptBones } from "../bake/roster";
import { parseBoneDump, skeletonFromDump } from "../pipeline/dump";
import { PIVOT_BONE, RETARGET, RETARGET_OVERRIDES } from "../retarget/map";
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
    const drive = RETARGET_OVERRIDES[fighterId]?.[name] ?? RETARGET[name];
    for (const b of [...(drive?.bones ?? []), ...(drive?.tips ?? [])]) if (b !== null) out.add(b.toLowerCase());
  }
  for (const b of referenceScriptBones(fighterId)) out.add(b);
  for (const b of hurtBonesFor(fighterId).bones) out.add(b.toLowerCase());
  return out;
}

describe("the committed fighter skeletons", () => {
  if (process.env.UPDATE_SKELETONS === "1") {
    it("trims every SDNA dump in .model-cache/dumps/ into src/render3d/skeletons/", () => {
      for (const def of FIGHTERS) {
        const file = join(DUMPS, `${def.id}.sdna.json`);
        if (!existsSync(file)) throw new Error(`no dump for ${def.id}: run pnpm models:fetch && pnpm models:skeletons first`);
        const dump = parseBoneDump(JSON.parse(readFileSync(file, "utf8")));
        const skeleton = skeletonFromDump(dump, neededBones(def.id));
        writeFileSync(join(DIR, `${def.id}.json`), JSON.stringify(skeleton, null, 1) + "\n");
      }
    });
    return;
  }

  for (const def of FIGHTERS) {
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
